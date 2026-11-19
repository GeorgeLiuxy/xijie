import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {test} from 'node:test'
import {fixture,text} from './fixture.mjs'
import {GenerationEngine} from '../dist/engine.js'
import {GenerationError} from '../dist/provider.js'
import {Dependencies} from '../dist/dependencies.js'

test('AI authorization is independent, versioned and fenced at each generation boundary',async t=>{
 const f=await fixture(t)
 async function prepare(){const a=f.account(),{conversation}=await f.store.ensure(a.id,a.person.id,randomUUID());return {a,cid:conversation.id}}
 const send=({a,cid},input=text(),key=randomUUID())=>f.store.send(a.id,cid,key,input,randomUUID())
 const permission=(a,allowed,authorizationVersion)=>Object.assign(f.accounts.get(a.id).aiTextProcessing,{allowed,authorizationVersion})
 async function blocked(a,id){const result=await f.store.getJob(a.id,id);assert.equal(result.state,'blocked');assert.deepEqual(result.failure,{code:'AI_PERMISSION_REQUIRED',retryable:false});assert.equal(result.replyIds.length,0)}

 await t.test('storage permission alone cannot submit or dispatch a new generation',async()=>{
  const p=await prepare();permission(p.a,false,0)
  await assert.rejects(send(p),{code:'AI_PERMISSION_REQUIRED',status:403})
  assert.equal((await f.store.messages(p.a.id,p.cid,'older',undefined,20)).length,0)
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM generation_jobs WHERE account_id=$1',[p.a.id])).rows[0].n,0)
  assert.equal(f.accounts.get(p.a.id).storyStorage.allowed,true)
 })
 await t.test('queued work cannot call a model after revoke, even after a subsequent grant',async()=>{
  for(const regrant of [false,true]){
   const p=await prepare(),sent=await send(p);let calls=0
   permission(p.a,false,2);if(regrant)permission(p.a,true,3)
   await new GenerationEngine(f.store,{async generate(){calls++;return {text:'Never generated'}}}).run(sent.generationJobId)
   await blocked(p.a,sent.generationJobId);assert.equal(calls,0)
   assert.equal((await f.store.messages(p.a.id,p.cid,'older',undefined,20)).length,1)
  }
 })
 await t.test('pre-consent migrated task version zero cannot inherit a new grant',async()=>{
  const p=await prepare(),sent=await send(p);let calls=0
  await f.pool.query('UPDATE generation_jobs SET ai_authorization_version=0 WHERE id=$1',[sent.generationJobId])
  await new GenerationEngine(f.store,{async generate(){calls++;return {text:'Old task'}}}).run(sent.generationJobId)
  await blocked(p.a,sent.generationJobId);assert.equal(calls,0)
 })
 await t.test('a revoke during remote context loading prevents the model call',async()=>{
  const p=await prepare(),sent=await send(p);let calls=0
  f.dependencies.memories=async()=>{permission(p.a,false,2);return []}
  await new GenerationEngine(f.store,{async generate(){calls++;return {text:'Not called'}}}).run(sent.generationJobId)
  await blocked(p.a,sent.generationJobId);assert.equal(calls,0)
  delete f.dependencies.memories
 })
 await t.test('in-flight revocation and revoke/regrant block the generated output',async()=>{
  for(const regrant of [false,true]){
   const p=await prepare(),sent=await send(p);let calls=0
   await new GenerationEngine(f.store,{async generate(input){calls++;assert.deepEqual(input.aiTextProcessing,{allowed:true,authorizationVersion:1});permission(p.a,false,2);if(regrant)permission(p.a,true,3);return {text:'Do not commit'}}}).run(sent.generationJobId)
   await blocked(p.a,sent.generationJobId);assert.equal(calls,1)
   permission(p.a,true,5)
   await assert.rejects(f.store.retry(p.a.id,sent.generationJobId,randomUUID(),randomUUID()),{code:'GENERATION_NOT_RETRYABLE'})
  }
 })
 await t.test('revocation after engine post-check is caught again before commit',async()=>{
  const p=await prepare(),sent=await send(p);let reads=0
  f.dependencies.memories=async()=>{if(++reads===2)permission(p.a,false,2);return []}
  await new GenerationEngine(f.store,{async generate(){return {text:'A late result'}}}).run(sent.generationJobId)
  await blocked(p.a,sent.generationJobId);assert.equal(reads,2)
  delete f.dependencies.memories
 })
 await t.test('explicit retry requires current consent and records its new version',async()=>{
  const p=await prepare(),sent=await send(p)
  await new GenerationEngine(f.store,{async generate(){throw new GenerationError('MODEL_REQUEST_FAILED',true)}}).run(sent.generationJobId)
  permission(p.a,false,2)
  await assert.rejects(f.store.retry(p.a.id,sent.generationJobId,randomUUID(),randomUUID()),{code:'AI_PERMISSION_REQUIRED',status:403})
  permission(p.a,true,3)
  const key=randomUUID();await f.store.retry(p.a.id,sent.generationJobId,key,randomUUID())
  assert.equal((await f.store.findJob(sent.generationJobId)).ai_authorization_version,3)
  await new GenerationEngine(f.store,{async generate(input){assert.equal(input.aiTextProcessing.authorizationVersion,3);return {text:'New explicitly requested attempt'}}}).run(sent.generationJobId)
  assert.equal((await f.store.getJob(p.a.id,sent.generationJobId)).state,'succeeded')
  permission(p.a,false,4)
  assert.equal((await f.store.retry(p.a.id,sent.generationJobId,key,randomUUID())).state,'succeeded')
 })
 await t.test('a lost send acknowledgement can replay after revoke without a new dispatch',async()=>{
  const p=await prepare(),input=text(),key=randomUUID(),sent=await send(p,input,key)
  await new GenerationEngine(f.store,{async generate(){return {text:'Existing reply'}}}).run(sent.generationJobId)
  permission(p.a,false,2)
  assert.deepEqual(await send(p,input,key),sent)
  assert.deepEqual(await send(p,input,randomUUID()),sent)
  assert.equal((await f.store.messages(p.a.id,p.cid,'older',undefined,20)).length,2)
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM generation_jobs WHERE account_id=$1',[p.a.id])).rows[0].n,1)
  const other=await prepare(),queued=await send(other);permission(other.a,false,2)
  assert.equal((await f.store.cancel(other.a.id,queued.generationJobId,randomUUID(),randomUUID())).state,'canceled')
  await f.store.removeMessage(other.a.id,other.cid,queued.message.id,randomUUID(),queued.message.version,randomUUID())
 })
})

test('internal Identity contexts fail closed for absent or malformed AI authorization',async t=>{
 const f=await fixture(t),a=f.account();let invalid
 const server=createServer((request,response)=>{
  const value=request.url==='/internal/v1/session-context'?structuredClone(f.sessions.get(a.credential)):structuredClone(f.accounts.get(a.id))
  if(invalid===undefined)delete value.aiTextProcessing;else value.aiTextProcessing=invalid
  response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({data:value}))
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)))
 const origin='http://127.0.0.1:'+server.address().port
 const dependency=new Dependencies({identityOrigin:origin,serviceToken:'11'.repeat(32),sessionCookie:'xijie_dev_session'})
 for(const value of [undefined,null,{allowed:true,authorizationVersion:0},{allowed:true,authorizationVersion:-1},{allowed:true,authorizationVersion:'1'},{allowed:1,authorizationVersion:1}]){
  invalid=value
  await assert.rejects(dependency.session('xijie_dev_session='+a.credential),{code:'DEPENDENCY_UNAVAILABLE'})
  await assert.rejects(dependency.account(a.id),{code:'DEPENDENCY_UNAVAILABLE'})
 }
 invalid={allowed:false,authorizationVersion:0}
 assert.deepEqual((await dependency.account(a.id)).aiTextProcessing,invalid)
})
