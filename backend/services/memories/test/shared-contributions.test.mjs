import 'reflect-metadata'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {test} from 'node:test'
import {NestFactory} from '@nestjs/core'
import {fixture,input} from './fixture.mjs'
import {SharedContributions} from '../dist/shared-contributions.js'
import {MemoryError} from '../dist/contracts.js'
import {MemoryDataRights} from '../dist/data-rights.js'
import {SocialMemorySources} from '../dist/social-sources.js'
import {ReferralQualification} from '../dist/referrals.js'
import {MemoriesModule,MemoryErrors,memoryHeaders} from '../dist/http.js'
async function shared(t){
 const f=await fixture(t),a=f.account(),b=f.account(),sources=new Map(),requests=new Map(),service=new SharedContributions(f.store)
 f.dependencies.sharedSource=async(accountId,albumId,id,version)=>{const source=sources.get(id);if(!source||source.accountId!==accountId||source.albumId!==albumId||source.version!==version)throw new MemoryError(404,'NOT_FOUND','Synthetic unavailable source');return structuredClone(source)}
 f.dependencies.dataRequest=async id=>{const r=requests.get(id);if(!r)throw new MemoryError(404,'NOT_FOUND','Missing');return r}
 const source=()=>{const value={accountId:a.id,personId:a.person.id,albumId:randomUUID(),contributionId:randomUUID(),version:2,title:'合成相册标题',body:'经审核并经作者允许采纳的合成正文',allowAdoption:true};sources.set(value.contributionId,value);return value}
 const request=(kind='export')=>{const id=randomUUID();requests.set(id,{requestId:id,accountId:a.id,kind,scope:'account_data',status:'processing',accountStatus:kind==='export'?'active':'deletion_pending',accountAccessVersion:kind==='export'?1:2});return id}
 return{...f,a,b,sources,service,source,request}
}
test('shared adoption has permanent source identity, actual shared origin and never qualifies for referral',async t=>{
 const f=await shared(t),s=f.source(),call=()=>f.service.adopt(f.a.id,s.albumId,s.contributionId,2)
 const values=await Promise.all([call(),call()]);assert.equal(values[0].memoryId,values[1].memoryId)
 const m=await f.store.detail(f.a.id,f.a.person.id,values[0].memoryId);assert.equal(m.origin,'shared_contribution');assert.equal(m.body,s.body);assert.deepEqual(m.source,{kind:'shared_contribution',albumId:s.albumId,contributionId:s.contributionId})
 assert.equal((await new ReferralQualification(f.store).get(f.a.id)).qualification,null)
 const event=(await f.pool.query("SELECT payload FROM outbox_events WHERE type='MemoryConfirmed.v1' AND aggregate_id=$1",[m.id])).rows[0].payload;assert.equal(event.qualifiesForReferral,false);assert.equal(event.origin,'shared_contribution')
 await assert.rejects(()=>f.service.adopt(f.a.id,s.albumId,s.contributionId,3),e=>e.code==='IDEMPOTENCY_CONFLICT');await assert.rejects(()=>f.service.adopt(f.b.id,s.albumId,s.contributionId,2),e=>e.status===404)
 await f.store.remove(f.a.id,f.a.person.id,m.id,randomUUID(),m.version);assert.equal((await call()).status,'revoked');assert.equal((await f.pool.query('SELECT count(*)::int n FROM memories')).rows[0].n,1)
})
test('source withdrawal immediately excludes shared originals from list/detail/search/model/validation/export before physical cleanup',async t=>{
 const f=await shared(t),s=f.source(),r=await f.service.adopt(f.a.id,s.albumId,s.contributionId,2),refs=[{id:r.memoryId,version:1}]
 assert.equal((await f.store.context(f.a.id,f.a.person.id)).memories.length,1);assert(await f.store.validateContextReferences(f.a.id,f.a.person.id,refs))
 f.sources.delete(s.contributionId)
 assert.equal((await f.store.list(f.a.id,f.a.person.id,undefined,20,true)).length,0);await assert.rejects(()=>f.store.detail(f.a.id,f.a.person.id,r.memoryId),e=>e.status===404)
 assert.equal((await f.store.search(f.a.id,'相册')).filter(r=>r.kind==='memory').length,0);assert.equal((await f.store.context(f.a.id,f.a.person.id)).memories.length,0);assert.equal(await f.store.validateContextReferences(f.a.id,f.a.person.id,refs),false)
 assert.deepEqual((await new SocialMemorySources(f.store).validate(f.a.id,f.a.person.id,refs)).valid,[])
 const exported=await new MemoryDataRights(f.pool,f.dependencies).export(f.a.id,f.request(),'account_data');assert.equal(exported.data.memories.length,0);assert(!JSON.stringify(exported).includes(s.body))
 await f.service.revoke(f.a.id,s.albumId,s.contributionId);assert.equal((await f.pool.query('SELECT count(*)::int n FROM memories')).rows[0].n,0)
 f.sources.set(s.contributionId,s);assert.equal((await f.service.adopt(f.a.id,s.albumId,s.contributionId,2)).status,'revoked');assert.equal((await f.pool.query('SELECT count(*)::int n FROM memories')).rows[0].n,0)
})
test('revocation tombstone wins if source was read before withdrawal but no memory had committed',async t=>{
 const f=await shared(t),s=f.source(),old=f.dependencies.sharedSource;let once=true
 f.dependencies.sharedSource=async(...args)=>{const value=await old(...args);if(once){once=false;await f.service.revoke(f.a.id,s.albumId,s.contributionId)}return value}
 const result=await f.service.adopt(f.a.id,s.albumId,s.contributionId,2);assert.equal(result.status,'revoked');assert.equal((await f.pool.query('SELECT count(*)::int n FROM memories')).rows[0].n,0)
})
test('native constraints reject half-bound shared sources and incomplete fulfilled receipts, including SQL NULL',async t=>{
 const f=await shared(t),s=f.source(),r=await f.service.adopt(f.a.id,s.albumId,s.contributionId,2)
 for(const field of ['source_album_id','source_contribution_id','source_contribution_version'])await assert.rejects(f.pool.query('UPDATE memories SET '+field+'=NULL WHERE id=$1',[r.memoryId]),e=>e.code==='23514')
 for(const field of ['source_version','person_id','memory_id'])await assert.rejects(f.pool.query('UPDATE shared_memory_receipts SET '+field+'=NULL WHERE account_id=$1 AND contribution_id=$2',[f.a.id,s.contributionId]),e=>e.code==='23514')
 await assert.rejects(f.pool.query("INSERT INTO shared_memory_receipts(account_id,album_id,contribution_id,state,source_version) VALUES($1,$2,$3,'revoked',0)",[f.a.id,s.albumId,randomUUID()]),e=>e.code==='23514')
})
test('withdrawn shared rows do not make a paged original list falsely end before later visible memories',async t=>{
 const f=await shared(t),manual=await f.store.create(f.a.id,f.a.person.id,randomUUID(),input('仍然可见的合成原文'))
 for(let i=0;i<3;i++){const s=f.source();await f.service.adopt(f.a.id,s.albumId,s.contributionId,2);f.sources.delete(s.contributionId)}
 assert.equal((await f.store.list(f.a.id,f.a.person.id,undefined,1,true))[0].id,manual.id)
})
test('source outage fails closed and erasure deletes shared receipt provenance without allowing a late adoption',async t=>{
 const f=await shared(t),s=f.source(),r=await f.service.adopt(f.a.id,s.albumId,s.contributionId,2)
 const old=f.dependencies.sharedSource;f.dependencies.sharedSource=async()=>{throw new MemoryError(503,'DEPENDENCY_UNAVAILABLE','Synthetic outage')}
 await assert.rejects(()=>f.store.detail(f.a.id,f.a.person.id,r.memoryId),e=>e.status===503);await assert.rejects(()=>new MemoryDataRights(f.pool,f.dependencies).export(f.a.id,f.request(),'account_data'),e=>e.status===503)
 f.dependencies.sharedSource=old;const rights=new MemoryDataRights(f.pool,f.dependencies),id=f.request('delete_account');await rights.erase(f.a.id,id)
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM shared_memory_receipts WHERE account_id=$1',[f.a.id])).rows[0].n,0)
 await assert.rejects(()=>f.service.adopt(f.a.id,s.albumId,s.contributionId,2));await f.service.revoke(f.a.id,s.albumId,s.contributionId);assert.equal((await f.pool.query('SELECT count(*)::int n FROM shared_memory_receipts WHERE account_id=$1',[f.a.id])).rows[0].n,0)
})
test('HTTP accepts only Social controlled source references and never client-supplied adopted prose',async t=>{
 const f=await shared(t),s=f.source(),config={socialToken:'b'.repeat(64),conversationsToken:'a'.repeat(64),webOrigin:'http://127.0.0.1:5184',serviceToken:'c'.repeat(64)}
 const app=await NestFactory.create(MemoriesModule.register(config,f.store),{logger:false});app.use(memoryHeaders);app.useGlobalFilters(new MemoryErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close());const origin=await app.getUrl(),path='/internal/v1/shared-albums/'+s.albumId+'/contributions/'+s.contributionId+'/adopt',headers={Authorization:'Bearer '+config.socialToken,'X-Xijie-Account-Id':f.a.id,'Content-Type':'application/json'}
 let r=await fetch(origin+path,{method:'POST',headers:{...headers,Authorization:'Bearer '+config.conversationsToken},body:'{"sourceVersion":2}'});assert.equal(r.status,403)
 r=await fetch(origin+path,{method:'POST',headers,body:JSON.stringify({sourceVersion:2,body:'forged'})});assert.equal(r.status,400)
 r=await fetch(origin+path,{method:'POST',headers,body:'{"sourceVersion":2}'});assert.equal(r.status,200);const value=(await r.json()).data;assert.equal(value.status,'fulfilled')
 const m=await f.store.detail(f.a.id,f.a.person.id,value.memoryId);assert.equal(m.body,s.body)
})
