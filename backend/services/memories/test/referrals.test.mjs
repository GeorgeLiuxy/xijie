import 'reflect-metadata'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {test} from 'node:test'
import {fixture,input} from './fixture.mjs'
import {ReferralQualification} from '../dist/referrals.js'
import {NestFactory} from '@nestjs/core'
import {MemoriesModule,MemoryErrors,memoryHeaders} from '../dist/http.js'

test('qualification reports only the first committed eligible milestone and no private source',async t=>{
 const f=await fixture(t),a=f.account(),b=f.account(),service=new ReferralQualification(f.store)
 assert.deepEqual(await service.get(a.id),{accountId:a.id,qualification:null})
 const first=await f.store.create(a.id,a.person.id,randomUUID(),input('不得外泄的正文'))
 await f.store.create(a.id,a.person.id,randomUUID(),input('后来的正文'))
 const value=await service.get(a.id)
 assert.equal(value.qualification.confirmedSeq,'1');assert.equal(value.qualification.confirmedAt,first.confirmedAt)
 assert.deepEqual(Object.keys(value.qualification).sort(),['confirmedAt','confirmedSeq','eventId','origin'])
 for(const privateValue of [first.id,a.person.id,first.body,first.title])assert.ok(!JSON.stringify(value).includes(privateValue))
 assert.equal((await service.get(b.id)).qualification,null)
 await f.store.remove(a.id,a.person.id,first.id,randomUUID(),1)
 assert.deepEqual(await service.get(a.id),value,'A deletion is not a new reward or reverse milestone')
})

test('qualification excludes ineligible origins even if an event flag is wrong',async t=>{
 const f=await fixture(t),a=f.account(),service=new ReferralQualification(f.store)
 await f.pool.query(`INSERT INTO outbox_events(type,account_id,aggregate_type,aggregate_id,aggregate_version,request_id,payload)
 VALUES('MemoryConfirmed.v1',$1,'memory',$2,1,$3,$4)`,[a.id,randomUUID(),randomUUID(),{confirmedAt:new Date().toISOString(),confirmedSeq:'1',origin:'shared_contribution',qualifiesForReferral:true}])
 assert.equal((await service.get(a.id)).qualification,null)
})

test('erasure gates and account changes suppress qualification despite retained old rows',async t=>{
 const f=await fixture(t),a=f.account(),service=new ReferralQualification(f.store)
 await f.store.create(a.id,a.person.id,randomUUID(),input())
 const original=f.dependencies.account;let reads=0
 f.dependencies.account=async id=>{const value=await original(id);value.accessVersion=++reads;return value}
 await assert.rejects(service.get(a.id),{code:'SOURCE_CHANGED'})
 f.dependencies.account=original
 await f.pool.query('INSERT INTO memory_account_write_gates(account_id,erased_at,request_id) VALUES($1,clock_timestamp(),$2) ON CONFLICT(account_id) DO UPDATE SET erased_at=clock_timestamp(),request_id=$2',[a.id,randomUUID()])
 await assert.rejects(service.get(a.id),{code:'NOT_FOUND'})
})

test('only the Gifts credential can read qualification; query and account injection fail closed',async t=>{
 const f=await fixture(t),a=f.account(),giftToken='c'.repeat(64)
 const app=await NestFactory.create(MemoriesModule.register({serviceToken:'a'.repeat(64),conversationsToken:'b'.repeat(64),giftsToken:giftToken,webOrigin:'http://127.0.0.1:5184'},f.store),{logger:false,abortOnError:false})
 app.use(memoryHeaders);app.useGlobalFilters(new MemoryErrors())
 await app.listen(0,'127.0.0.1');t.after(()=>app.close());const base=await app.getUrl(),path='/internal/v1/referrals/accounts/'+a.id+'/qualification'
 assert.equal((await fetch(base+path)).status,403)
 assert.equal((await fetch(base+path,{headers:{Authorization:'Bearer '+'b'.repeat(64)}})).status,403)
 const request=p=>fetch(base+p,{headers:{Authorization:'Bearer '+giftToken}})
 assert.equal((await request(path+'?include=body')).status,400)
 const result=await request(path);assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store')
 assert.deepEqual((await result.json()).data,{accountId:a.id,qualification:null})
})
