import 'reflect-metadata'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {test} from 'node:test'
import {NestFactory} from '@nestjs/core'
import {fixture,input} from './fixture.mjs'
import {MemoriesModule,MemoryErrors,memoryHeaders} from '../dist/http.js'

test('cherished validation proves exact current owner and versions without returning private content',async t=>{
 const f=await fixture(t),a=f.account(),b=f.account(),peer={...a.person,id:randomUUID()};f.people.set(peer.id,peer)
 const mine=await f.store.create(a.id,a.person.id,randomUUID(),input('PRIVATE_OWNER_A'))
 const theirs=await f.store.create(a.id,peer.id,randomUUID(),input('PRIVATE_PEER_B'))
 const ref={id:mine.id,version:mine.version}
 assert.equal(await f.store.validateContextReferences(a.id,a.person.id,[ref]),true)
 assert.equal(await f.store.validateContextReferences(a.id,a.person.id,[{...ref,id:ref.id.toUpperCase()}]),true)
 assert.equal(await f.store.validateContextReferences(a.id,a.person.id,[{id:theirs.id,version:1}]),false)
 assert.equal(await f.store.validateContextReferences(b.id,b.person.id,[ref]),false)
 assert.equal(await f.store.validateContextReferences(a.id,a.person.id,[{id:randomUUID(),version:1}]),false)
 await f.store.patch(a.id,a.person.id,mine.id,randomUUID(),1,{body:'CORRECTED_OWNER_A'})
 assert.equal(await f.store.validateContextReferences(a.id,a.person.id,[ref]),false)
 assert.equal(await f.store.validateContextReferences(a.id,a.person.id,[{...ref,version:2}]),true)
 await f.store.remove(a.id,a.person.id,mine.id,randomUUID(),2)
 assert.equal(await f.store.validateContextReferences(a.id,a.person.id,[{...ref,version:3}]),false)
})

test('private validation rejects withdrawal, source changes and erasure during asynchronous authority reads',async t=>{
 const f=await fixture(t),a=f.account(),saved=await f.store.create(a.id,a.person.id,randomUUID(),input()),refs=[{id:saved.id,version:1}]
 const originalPerson=f.dependencies.person,originalAccount=f.dependencies.account,originalQuery=f.pool.query.bind(f.pool)
 let calls=0
 f.dependencies.person=async(...args)=>{const result=await originalPerson(...args);if(++calls===2)f.accounts.get(a.id).aiTextProcessing={allowed:false,authorizationVersion:2};return result}
 await assert.rejects(()=>f.store.validateContextReferences(a.id,a.person.id,refs),e=>e.code==='AI_PERMISSION_REQUIRED')
 f.dependencies.person=originalPerson;f.accounts.get(a.id).aiTextProcessing={allowed:true,authorizationVersion:3}
 calls=0;f.dependencies.account=async(...args)=>{const result=await originalAccount(...args);if(++calls===2){result.accessVersion++;f.accounts.get(a.id).accessVersion=result.accessVersion}return result}
 await assert.rejects(()=>f.store.validateContextReferences(a.id,a.person.id,refs),e=>e.code==='SOURCE_CHANGED')
 f.dependencies.account=originalAccount;calls=0
 f.dependencies.person=async(...args)=>{const result=await originalPerson(...args);if(++calls===2)await originalQuery('UPDATE memories SET version=version+1 WHERE id=$1',[saved.id]);return result}
 assert.equal(await f.store.validateContextReferences(a.id,a.person.id,refs),false)
 f.dependencies.person=originalPerson
 await originalQuery('UPDATE memory_account_write_gates SET erased_at=clock_timestamp(),request_id=$2 WHERE account_id=$1',[a.id,randomUUID()])
 await assert.rejects(()=>f.store.validateContextReferences(a.id,a.person.id,[]),e=>e.status===404)
})

test('validation rejects malformed references and wrong authority even for empty input',async t=>{
 const f=await fixture(t),a=f.account(),ref={id:randomUUID(),version:1}
 for(const value of [undefined,null,{},[null],[[]],[{...ref,body:'secret'}],[{...ref,version:0}],[ref,{...ref,id:ref.id.toUpperCase()}],Array.from({length:9},()=>({id:randomUUID(),version:1}))])await assert.rejects(()=>f.store.validateContextReferences(a.id,a.person.id,value),e=>e.status===400)
 f.accounts.get(a.id).storyStorage.allowed=false
 await assert.rejects(()=>f.store.validateContextReferences(a.id,a.person.id,[]),e=>e.status===403)
 f.accounts.get(a.id).storyStorage.allowed=true
 f.accounts.get(a.id).aiTextProcessing.authorizationVersion=0
 await assert.rejects(()=>f.store.validateContextReferences(a.id,a.person.id,[]),e=>e.status===503)
 f.accounts.get(a.id).aiTextProcessing.authorizationVersion=1
 f.people.get(a.person.id).status='removed'
 await assert.rejects(()=>f.store.validateContextReferences(a.id,a.person.id,[]),e=>e.status===404)
})

test('internal HTTP validation accepts only Conversations and emits Boolean metadata',async t=>{
 const f=await fixture(t),a=f.account(),b=f.account(),token='b'.repeat(64)
 const app=await NestFactory.create(MemoriesModule.register({webOrigin:'http://127.0.0.1:5184',serviceToken:'a'.repeat(64),conversationsToken:token},f.store),{logger:false,abortOnError:false})
 app.use(memoryHeaders);app.useGlobalFilters(new MemoryErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close())
 const saved=await f.store.create(a.id,a.person.id,randomUUID(),input('NEVER_EXPOSE_THIS_MEMORY'))
 const origin=await app.getUrl(),path='/internal/v1/persons/'+a.person.id+'/memories/validate',body={refs:[{id:saved.id,version:1}]}
 const post=(value,authorization='Bearer '+token,account=a.id,suffix='',endpoint=path)=>fetch(origin+endpoint+suffix,{method:'POST',headers:{'Content-Type':'application/json',Authorization:authorization,'X-Xijie-Account-Id':account},body:JSON.stringify(value)})
 assert.equal((await post(body,'Bearer '+'a'.repeat(64))).status,403)
 assert.equal((await post(body,'Bearer '+token,b.id)).status,404)
 assert.equal((await post({...body,body:'extra'})).status,400)
 assert.equal((await post(body,'Bearer '+token,a.id,'?q=anything')).status,400)
 const response=await post(body);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),{data:{personId:a.person.id,valid:true}})
 f.accounts.get(a.id).aiTextProcessing.allowed=false
 assert.equal((await post(body)).status,403)
 const letterPath='/internal/v1/persons/'+a.person.id+'/letter-memory/validate'
 assert.equal((await post(body,'Bearer '+'a'.repeat(64),a.id,'',letterPath)).status,403)
 assert.equal((await post(body,'Bearer '+token,b.id,'',letterPath)).status,404)
 assert.equal((await post({refs:[]},'Bearer '+token,a.id,'',letterPath)).status,400)
 const linked=await post(body,'Bearer '+token,a.id,'',letterPath)
 assert.equal(linked.status,200);assert.deepEqual(await linked.json(),{data:{personId:a.person.id,valid:true}})
 await f.store.patch(a.id,a.person.id,saved.id,randomUUID(),1,{body:'EDITED_WITHOUT_AI_TEXT_GRANT'})
 const stale=await post(body,'Bearer '+token,a.id,'',letterPath)
 assert.deepEqual(await stale.json(),{data:{personId:a.person.id,valid:false}})
 f.accounts.get(a.id).storyStorage.allowed=false
 assert.equal((await post(body,'Bearer '+token,a.id,'',letterPath)).status,403)
})
