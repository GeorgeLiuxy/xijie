import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {test} from 'node:test'
import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {fixture,input} from './fixture.mjs'
import {CandidateStore} from '../dist/candidates.js'
import {SuggestionEngine} from '../dist/engine.js'
import {SuggestionError,createSuggestionProvider} from '../dist/provider.js'
import {MemoryStore} from '../dist/store.js'
import {Dependencies} from '../dist/dependencies.js'
import {NestFactory} from '@nestjs/core'
import {MemoriesModule,MemoryErrors,memoryHeaders} from '../dist/http.js'

const suggestion={kind:'suggestion',title:'河边约定',body:'我们约好在河边散步。'}
const dispatch=job=>({jobId:job.id,dispatchId:job.dispatch_id,dispatchGeneration:job.dispatch_generation})
async function setup(t){
 const f=await fixture(t),sent=[]
 const candidates=new CandidateStore(f.pool,f.dependencies,{async send(_db,value){sent.push(value)}})
 return {...f,candidates,sent,store:new MemoryStore(f.pool,f.dependencies,candidates)}
}
async function begin(f,a,source=f.source(a),key=randomUUID()){
 const accepted=await f.candidates.request(a.id,a.person.id,source.id,key)
 return {accepted,source,key,job:await f.candidates.findJob(accepted.generationJobId)}
}
function ai(f,a,allowed,version){f.accounts.get(a.id).aiTextProcessing={allowed,authorizationVersion:version}}
async function noCandidate(f,id){assert.equal((await f.pool.query('SELECT count(*) FROM memory_candidates WHERE generation_job_id=$1',[id])).rows[0].count,'0')}
async function expectBlocked(f,id){const job=await f.candidates.findJob(id);assert.equal(job.state,'blocked');assert.equal(job.failure_code,'AI_PERMISSION_REQUIRED');assert.equal(job.retryable,false);await noCandidate(f,id)}

test('new suggestions require independent AI permission and never infer it from storage or source access',async t=>{
 const f=await setup(t),a=f.account(),source=f.source(a);ai(f,a,false,0)
 await assert.rejects(f.candidates.request(a.id,a.person.id,source.id,randomUUID()),{status:403,code:'AI_PERMISSION_REQUIRED'})
 assert.equal(f.sent.length,0)
 for(const table of ['memory_generation_jobs','memory_candidates','candidate_commands','memory_account_cursors'])assert.equal((await f.pool.query('SELECT count(*) FROM '+table)).rows[0].count,'0')
 const manual=await f.store.create(a.id,a.person.id,randomUUID(),input('用户自己确认的文字无需 AI 处理。'))
 assert.equal(manual.origin,'manual')
 assert.equal((await f.store.detail(a.id,a.person.id,manual.id)).id,manual.id)
 assert.equal((await f.store.context(a.id,a.person.id,'')).memories.length,1)
 await f.store.remove(a.id,a.person.id,manual.id,randomUUID(),manual.version)
})

test('queued legacy and revoked or regranted jobs cannot acquire new model permission',async t=>{
 const f=await setup(t),a=f.account()
 for(const scenario of ['revoked','regranted','legacy']){
  ai(f,a,true,1);const started=await begin(f,a);let calls=0
  if(scenario==='legacy')await f.pool.query('UPDATE memory_generation_jobs SET ai_authorization_version=0 WHERE id=$1',[started.job.id])
  else ai(f,a,scenario==='regranted',scenario==='regranted'?3:2)
  await new SuggestionEngine(f.candidates,{async generate(){calls++;return suggestion}}).run(dispatch(started.job))
  assert.equal(calls,0,scenario);await expectBlocked(f,started.job.id)
  ai(f,a,true,5)
  await assert.rejects(f.candidates.retry(a.id,started.job.id,randomUUID()),{code:'TASK_NOT_RETRYABLE'})
 }
})

test('the additive migration gives already stored tasks zero AI authority while keeping ready artifacts readable',async t=>{
 const f=await setup(t),a=f.account(),queued=await begin(f,a),ready=await begin(f,a)
 await new SuggestionEngine(f.candidates,{async generate(){return suggestion}}).run(dispatch(ready.job))
 const candidateId=(await f.candidates.job(a.id,ready.job.id)).resultRef.id
 assert.match((await f.pool.query('SELECT current_schema() AS name')).rows[0].name,/^memory_test_[a-f0-9]+$/)
 // This test alone rolls its isolated fixture back to the 002 shape, then executes the real 003 migration.
 await f.pool.query('ALTER TABLE memory_generation_jobs DROP COLUMN ai_authorization_version')
 await f.pool.query(await readFile(new URL('../db/003_ai_text_processing.sql',import.meta.url),'utf8'))
 const versions=(await f.pool.query('SELECT ai_authorization_version FROM memory_generation_jobs ORDER BY id')).rows
 assert.equal(versions.length,2);assert.ok(versions.every(row=>row.ai_authorization_version===0))
 assert.equal((await f.candidates.candidate(a.id,a.person.id,candidateId)).state,'ready')
 let calls=0;await new SuggestionEngine(f.candidates,{async generate(){calls++;return suggestion}}).run(dispatch(queued.job))
 assert.equal(calls,0);await expectBlocked(f,queued.job.id)
})

test('in-flight revoke and revoke-grant ABA block output without withdrawing existing artifacts',async t=>{
 const f=await setup(t),a=f.account()
 for(const regrant of [false,true]){
  ai(f,a,true,1);const started=await begin(f,a);let calls=0
  await new SuggestionEngine(f.candidates,{async generate(value){calls++;assert.equal(value.aiAuthorizationVersion,1);assert.equal(value.snapshot.account.aiTextProcessing.allowed,true);ai(f,a,regrant,regrant?3:2);return suggestion}}).run(dispatch(started.job))
  assert.equal(calls,1);await expectBlocked(f,started.job.id)
 }
})

test('commit performs a fresh AI authority check after the post-model snapshot',async t=>{
 const f=await setup(t),a=f.account(),started=await begin(f,a)
 const complete=f.candidates.complete.bind(f.candidates);let calls=0,commitChecks=0
 f.candidates.complete=async(...args)=>{commitChecks++;ai(f,a,true,3);return complete(...args)}
 await new SuggestionEngine(f.candidates,{async generate(){calls++;return suggestion}}).run(dispatch(started.job))
 assert.equal(calls,1);assert.equal(commitChecks,1);await expectBlocked(f,started.job.id)
})

test('revocation during slow source loading is checked again before model disclosure',async t=>{
 const f=await setup(t),a=f.account()
 for(const regrant of [false,true]){
  ai(f,a,true,1);const started=await begin(f,a),load=f.dependencies.memoryContext;let calls=0
  f.dependencies.memoryContext=async(...args)=>{const context=await load(...args);ai(f,a,regrant,regrant?3:2);return context}
  await new SuggestionEngine(f.candidates,{async generate(){calls++;return suggestion}}).run(dispatch(started.job))
  assert.equal(calls,0);await expectBlocked(f,started.job.id)
  f.dependencies.memoryContext=load
 }
})

test('AI revocation preserves ready candidates, human confirmation, history, manual work and cancellation',async t=>{
 const f=await setup(t),a=f.account(),started=await begin(f,a)
 await new SuggestionEngine(f.candidates,{async generate(){return suggestion}}).run(dispatch(started.job))
 const completed=await f.candidates.job(a.id,started.job.id),before=await f.candidates.candidate(a.id,a.person.id,completed.resultRef.id)
 const pending=await begin(f,a)
 ai(f,a,false,2)
 const after=await f.candidates.candidate(a.id,a.person.id,before.id)
 assert.equal(after.state,'ready');assert.equal(after.version,before.version);assert.equal(after.body,before.body)
 assert.deepEqual(await f.candidates.request(a.id,a.person.id,started.source.id,started.key),started.accepted)
 await assert.rejects(f.candidates.request(a.id,a.person.id,started.source.id,randomUUID()),{status:403,code:'AI_PERMISSION_REQUIRED'})
 assert.equal((await f.candidates.candidate(a.id,a.person.id,before.id)).state,'ready')
 assert.equal((await f.candidates.retry(a.id,started.job.id,randomUUID())).state,'succeeded')
 assert.equal((await f.candidates.retry(a.id,pending.job.id,randomUUID())).state,'queued')
 assert.equal(f.sent.length,2)
 const confirmed=await f.store.create(a.id,a.person.id,randomUUID(),{...input('用户编辑并确认已有建议。'),candidateId:before.id,candidateVersion:before.version})
 assert.equal(confirmed.origin,'ai_candidate')
 assert.equal((await f.candidates.candidate(a.id,a.person.id,before.id)).state,'consumed')
 assert.equal((await f.store.detail(a.id,a.person.id,confirmed.id)).body,'用户编辑并确认已有建议。')
 const manual=await f.store.create(a.id,a.person.id,randomUUID(),input('另行手写原文。'))
 assert.equal(manual.origin,'manual')
 assert.equal((await f.candidates.cancel(a.id,pending.job.id,randomUUID())).state,'canceled')
 await f.store.remove(a.id,a.person.id,manual.id,randomUUID(),manual.version)
})

test('a new explicit retry of a retryable failure captures current grant and fences the old dispatch',async t=>{
 const f=await setup(t),a=f.account(),started=await begin(f,a)
 await new SuggestionEngine(f.candidates,{async generate(){throw new SuggestionError('MODEL_REQUEST_FAILED',true)}}).run(dispatch(started.job))
 const failed=await f.candidates.findJob(started.job.id),retryKey=randomUUID()
 ai(f,a,false,2)
 await assert.rejects(f.candidates.retry(a.id,failed.id,retryKey),{status:403,code:'AI_PERMISSION_REQUIRED'})
 assert.equal((await f.candidates.findJob(failed.id)).state,'failed')
 ai(f,a,true,3)
 const retried=await f.candidates.retry(a.id,failed.id,retryKey),next=await f.candidates.findJob(failed.id)
 assert.equal(retried.id,failed.id);assert.equal(next.ai_authorization_version,3);assert.equal(next.dispatch_generation,failed.dispatch_generation+1)
 assert.notEqual(next.dispatch_id,failed.dispatch_id);assert.equal(await f.candidates.claim(dispatch(failed)),undefined)
 let calls=0
 await new SuggestionEngine(f.candidates,{async generate(value){calls++;assert.equal(value.aiAuthorizationVersion,3);return suggestion}}).run(dispatch(next))
 assert.equal(calls,1);assert.equal((await f.candidates.findJob(next.id)).state,'succeeded')
 ai(f,a,false,4)
 assert.equal((await f.candidates.retry(a.id,next.id,retryKey)).state,'succeeded')
 assert.equal((await f.candidates.request(a.id,a.person.id,started.source.id,started.key)).generationJobId,next.id)
 assert.equal(f.sent.length,2)
})

test('public HTTP gates only new model work while preserving candidate confirmation and private CRUD',async t=>{
 const f=await setup(t),a=f.account(),ready=await begin(f,a),pending=await begin(f,a)
 await new SuggestionEngine(f.candidates,{async generate(){return suggestion}}).run(dispatch(ready.job))
 const candidateId=(await f.candidates.job(a.id,ready.job.id)).resultRef.id
 ai(f,a,false,2)
 const config={webOrigin:'http://127.0.0.1:5184',serviceToken:'a'.repeat(64),conversationsToken:'b'.repeat(64)}
 const app=await NestFactory.create(MemoriesModule.register(config,f.store,f.candidates),{logger:false});app.use(memoryHeaders);app.useGlobalFilters(new MemoryErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close())
 const origin=await app.getUrl(),headers={Cookie:a.cookie,Origin:config.webOrigin,'X-Xijie-Expected-Session':a.sid,'Content-Type':'application/json','Idempotency-Key':randomUUID()},base=origin+'/v1/persons/'+a.person.id
 const denied=await fetch(base+'/memory-candidates',{method:'POST',headers,body:JSON.stringify({sourceMessageId:f.source(a).id})})
 assert.equal(denied.status,403);assert.equal((await denied.json()).error.code,'AI_PERMISSION_REQUIRED');assert.equal(f.sent.length,2)
 const candidate=await fetch(base+'/memory-candidates/'+candidateId,{headers});assert.equal(candidate.status,200);const proposal=(await candidate.json()).data;assert.equal(proposal.state,'ready')
 const confirmed=await fetch(base+'/memories',{method:'POST',headers:{...headers,'Idempotency-Key':randomUUID()},body:JSON.stringify({...input('已经生成的候选由用户确认。'),candidateId,candidateVersion:proposal.version})})
 assert.equal(confirmed.status,201);assert.equal((await confirmed.json()).data.origin,'ai_candidate')
 assert.equal((await fetch(base+'/memories?include=body',{headers})).status,200)
 const query='?kind=memory_suggestion'
 assert.equal((await fetch(origin+'/v1/generation-jobs/'+ready.job.id+query,{headers})).status,200)
 const reread=await fetch(origin+'/v1/generation-jobs/'+ready.job.id+'/retry'+query,{method:'POST',headers:{...headers,'Idempotency-Key':randomUUID()},body:'{}'})
 assert.equal(reread.status,202);assert.equal((await reread.json()).data.state,'succeeded');assert.equal(f.sent.length,2)
 const canceled=await fetch(origin+'/v1/generation-jobs/'+pending.job.id+'/cancel'+query,{method:'POST',headers:{...headers,'Idempotency-Key':randomUUID()},body:'{}'})
 assert.equal(canceled.status,200);assert.equal((await canceled.json()).data.state,'canceled')
 const manual=await fetch(base+'/memories',{method:'POST',headers:{...headers,'Idempotency-Key':randomUUID()},body:JSON.stringify(input('用户手写不需要新 AI 处理。'))})
 assert.equal(manual.status,201);const saved=(await manual.json()).data
 const removed=await fetch(base+'/memories/'+saved.id,{method:'DELETE',headers:{...headers,'Idempotency-Key':randomUUID(),'If-Match':'"v'+saved.version+'"'}})
 assert.equal(removed.status,200)
})

test('Identity AI purpose context is mandatory, runtime validated, and independently versioned',async t=>{
 const accountId=randomUUID(),sessionId=randomUUID(),credential='x'.repeat(43)
 let value={allowed:false,authorizationVersion:0},omit=false
 const server=createServer((request,response)=>{
  const shared={accountId,storyStorage:{allowed:true,authorizationVersion:1},...(omit?{}:{aiTextProcessing:value})}
  const data=request.url.includes('/accounts/')?{...shared,status:'active',accessVersion:1}:{...shared,sessionId,expiresAt:new Date(Date.now()+60000).toISOString()}
  response.end(JSON.stringify({data}))
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)))
 const origin='http://127.0.0.1:'+server.address().port,deps=new Dependencies({identityOrigin:origin,serviceToken:'a'.repeat(64),sessionCookie:'xijie_dev_session'})
 assert.deepEqual((await deps.account(accountId)).aiTextProcessing,value)
 assert.deepEqual((await deps.session('xijie_dev_session='+credential,sessionId)).aiTextProcessing,value)
 value={allowed:true,authorizationVersion:3};assert.deepEqual((await deps.account(accountId)).aiTextProcessing,value)
 for(const bad of [null,{allowed:true,authorizationVersion:0},{allowed:'yes',authorizationVersion:1},{allowed:false,authorizationVersion:-1},{allowed:false,authorizationVersion:'1'},{allowed:false,authorizationVersion:1.5}]){
  value=bad
  await assert.rejects(deps.account(accountId),{code:'DEPENDENCY_UNAVAILABLE'});await assert.rejects(deps.session('xijie_dev_session='+credential,sessionId),{code:'DEPENDENCY_UNAVAILABLE'})
 }
 omit=true;await assert.rejects(deps.account(accountId),{code:'DEPENDENCY_UNAVAILABLE'});await assert.rejects(deps.session('xijie_dev_session='+credential,sessionId),{code:'DEPENDENCY_UNAVAILABLE'})
})

test('the current OpenAI processing policy rejects different providers, paths and redirect-capable configurations',async t=>{
 const before=process.env.MODEL_BASE_URL;t.after(()=>{before===undefined?delete process.env.MODEL_BASE_URL:process.env.MODEL_BASE_URL=before})
 for(const url of ['http://127.0.0.1:9999/v1','http://api.openai.com/v1','https://other.example/v1','https://api.openai.com/v2','https://api.openai.com/v1?x=y','https://api.openai.com/v1#extra','https://user@api.openai.com/v1']){
  process.env.MODEL_BASE_URL=url;assert.throws(()=>createSuggestionProvider({fetch:async()=>{throw new Error('Should not send')}}),/MODEL_BASE_URL/)
 }
 process.env.MODEL_BASE_URL='https://api.openai.com/v1/';assert.doesNotThrow(()=>createSuggestionProvider())
})
