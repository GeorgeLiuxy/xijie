import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {test} from 'node:test'
import {fork} from 'node:child_process'
import {once} from 'node:events'
import {NestFactory} from '@nestjs/core'
import {fixture,input} from './fixture.mjs'
import {CandidateStore} from '../dist/candidates.js'
import {CandidateQueue} from '../dist/queue.js'
import {SuggestionEngine} from '../dist/engine.js'
import {SuggestionError} from '../dist/provider.js'
import {MemoryStore} from '../dist/store.js'
import {MemoryError} from '../dist/contracts.js'
import {MemoriesModule,MemoryErrors,memoryHeaders} from '../dist/http.js'

async function candidates(t){const f=await fixture(t),queueSchema='memory_queue_'+randomUUID().replaceAll('-',''),queue=await new CandidateQueue(f.connectionString,queueSchema).start();t.after(async()=>{await queue.stop();const pg=await import('pg'),pool=new pg.default.Pool({connectionString:f.connectionString});await pool.query('DROP SCHEMA '+queueSchema+' CASCADE');await pool.end()});const store=new CandidateStore(f.pool,f.dependencies,queue);return {...f,queue,queueSchema,candidates:store,store:new MemoryStore(f.pool,f.dependencies,store)}}
const dispatch=job=>({jobId:job.id,dispatchId:job.dispatch_id,dispatchGeneration:job.dispatch_generation})
async function start(f,a,source=f.source(a)){const result=await f.candidates.request(a.id,a.person.id,source.id,randomUUID());return {source,job:await f.candidates.findJob(result.generationJobId)}}
async function ready(f,a,source=f.source(a)){const started=await start(f,a,source);let captured;await new SuggestionEngine(f.candidates,{async generate(value){captured=value;return {kind:'suggestion',title:'河边散步',body:'毕业那年夏天，我们一起去河边散步。'}}}).run(dispatch(started.job));const job=await f.candidates.job(a.id,started.job.id);assert.equal(job.state,'succeeded');return {...started,captured,candidate:await f.candidates.candidate(a.id,a.person.id,job.resultRef.id)}}

test('candidate request permanently deduplicates accepted source and real transactional queue work',async t=>{
 const f=await candidates(t),a=f.account(),s=f.source(a),key=randomUUID(),first=await f.candidates.request(a.id,a.person.id,s.id,key)
 assert.deepEqual(await f.candidates.request(a.id,a.person.id,s.id,key),first);assert.deepEqual(await f.candidates.request(a.id,a.person.id,s.id,randomUUID()),first)
 const other=f.source(a);await assert.rejects(f.candidates.request(a.id,a.person.id,other.id,key),{code:'IDEMPOTENCY_CONFLICT'})
 assert.equal((await f.pool.query('SELECT count(*) FROM memory_generation_jobs')).rows[0].count,'1')
 assert.equal((await f.queue.boss.findJobs('memory.suggest.v1',{data:{jobId:first.generationJobId}})).length,1)
 const broken=new CandidateStore(f.pool,f.dependencies,{async send(){throw new Error('Synthetic queue refusal')}}),source=f.source(a)
 await assert.rejects(broken.request(a.id,a.person.id,source.id,randomUUID()),/Synthetic queue refusal/)
 assert.equal((await f.pool.query('SELECT count(*) FROM memory_generation_jobs WHERE source_message_id=$1',[source.id])).rows[0].count,'0')
 const b=f.account();await assert.rejects(f.candidates.job(b.id,first.generationJobId),{code:'NOT_FOUND'})
})
test('ready proposal is isolated from confirmed memory, atomically consumed once and replayed without resurrection',async t=>{
 const f=await candidates(t),a=f.account(),value=await ready(f,a)
 assert.equal(value.captured.snapshot.context.messages[0].author.kind,'self');assert.equal(value.captured.snapshot.context.messages[1].id,value.source.id)
 assert.deepEqual(await f.store.list(a.id,a.person.id,undefined,100,true),[])
 assert.equal((await f.store.search(a.id,'河边散步')).filter(hit=>hit.kind==='memory').length,0)
 assert.equal((await f.store.context(a.id,a.person.id)).memories.length,0)
 const body={...input('用户编辑确认后的原文。'),candidateId:value.candidate.id,candidateVersion:value.candidate.version},key=randomUUID()
 const original=await f.store.create(a.id,a.person.id,key,body);assert.equal(original.origin,'ai_candidate');assert.equal(original.body,body.body);assert.equal(original.source.messageId,value.source.id)
 assert.equal((await f.candidates.candidate(a.id,a.person.id,value.candidate.id)).state,'consumed')
 assert.equal((await f.store.create(a.id,a.person.id,key,body)).id,original.id)
 assert.equal((await f.store.create(a.id,a.person.id,randomUUID(),body)).id,original.id)
 await assert.rejects(f.store.create(a.id,a.person.id,randomUUID(),{...body,clientMemoryId:randomUUID()}),{code:'CANDIDATE_CONSUMED'})
 await f.store.remove(a.id,a.person.id,original.id,randomUUID(),original.version)
 await assert.rejects(f.store.create(a.id,a.person.id,key,body),{code:'NOT_FOUND'})
 f.sources.get(value.source.id).version++
 const reused=await f.candidates.request(a.id,a.person.id,value.source.id,randomUUID());assert.equal(reused.generationJobId,value.job.id)
 const metadata=await f.candidates.candidate(a.id,a.person.id,value.candidate.id);assert.ok(!metadata.body&&!metadata.title);assert.equal(metadata.consumedByMemoryId,original.id)
})
test('expiry, unavailable context and removed user evidence obey candidate lifecycle and old-key identity',async t=>{
 const f=await candidates(t),a=f.account(),s=f.source(a),key=randomUUID(),accepted=await f.candidates.request(a.id,a.person.id,s.id,key)
 await new SuggestionEngine(f.candidates,{async generate(){return {kind:'suggestion',title:'那年夏天',body:'我们曾一起在河边散步。'}}}).run(dispatch(await f.candidates.findJob(accepted.generationJobId)))
 const jid=await f.candidates.job(a.id,accepted.generationJobId),cid=jid.resultRef.id
 const previous=f.dependencies.memoryContext;f.dependencies.memoryContext=async()=>{throw new MemoryError(503,'DEPENDENCY_UNAVAILABLE','Temporary')}
 await assert.rejects(f.candidates.candidate(a.id,a.person.id,cid),{code:'DEPENDENCY_UNAVAILABLE'});assert.equal((await f.pool.query('SELECT state FROM memory_candidates WHERE id=$1',[cid])).rows[0].state,'ready');f.dependencies.memoryContext=previous
 f.sources.delete(s.replyToMessageId);const withdrawn=await f.candidates.candidate(a.id,a.person.id,cid);assert.equal(withdrawn.state,'withdrawn');assert.equal(withdrawn.body,undefined)
 await assert.rejects(f.store.create(a.id,a.person.id,randomUUID(),{...input(),candidateId:cid,candidateVersion:1}),{code:'CANDIDATE_WITHDRAWN'})
 const expired=await ready(f,a);await f.pool.query("UPDATE memory_candidates SET created_at=clock_timestamp()-interval '25 hours',state_changed_at=clock_timestamp()-interval '25 hours',expires_at=clock_timestamp()-interval '1 hour' WHERE id=$1",[expired.candidate.id])
 const state=await f.candidates.candidate(a.id,a.person.id,expired.candidate.id);assert.equal(state.state,'expired');assert.equal(state.body,undefined)
 await assert.rejects(f.store.create(a.id,a.person.id,randomUUID(),{...input(),candidateId:state.id,candidateVersion:1}),{code:'CANDIDATE_EXPIRED'})
 const newJob=await f.candidates.request(a.id,a.person.id,expired.source.id,randomUUID());assert.notEqual(newJob.generationJobId,expired.job.id)
 assert.deepEqual(await f.candidates.request(a.id,a.person.id,s.id,key),accepted)
})
test('cancel, source changes and explicit retry fence late attempts and use fresh physical dispatch',async t=>{
 const f=await candidates(t),a=f.account()
 for(const scenario of ['cancel','parent-deleted','source-version','person-version','grant']){
  const value=await start(f,a),engine=new SuggestionEngine(f.candidates,{async generate(){if(scenario==='cancel')await f.candidates.cancel(a.id,value.job.id,randomUUID());if(scenario==='parent-deleted')f.sources.delete(value.source.replyToMessageId);if(scenario==='source-version')f.sources.get(value.source.id).version++;if(scenario==='person-version')f.people.get(a.person.id).version++;if(scenario==='grant')f.accounts.get(a.id).storyStorage.allowed=false;return {kind:'suggestion',title:'旧建议',body:'不能提交的旧建议。'}}})
  await engine.run(dispatch(value.job));const job=await f.candidates.findJob(value.job.id);assert.ok(['canceled','blocked'].includes(job.state),scenario);assert.equal(job.candidate_id,null);f.accounts.get(a.id).storyStorage.allowed=true
 }
 const value=await start(f,a);await new SuggestionEngine(f.candidates,{async generate(){throw new SuggestionError('MODEL_REQUEST_FAILED',true)}}).run(dispatch(value.job))
 const failed=await f.candidates.job(a.id,value.job.id);assert.equal(failed.state,'failed');assert.equal(failed.failure.retryable,true)
 assert.equal((await f.candidates.request(a.id,a.person.id,value.source.id,randomUUID())).generationJobId,value.job.id)
 const key=randomUUID(),retry=await f.candidates.retry(a.id,value.job.id,key),next=await f.candidates.findJob(value.job.id);assert.equal(retry.id,value.job.id);assert.notEqual(next.dispatch_id,value.job.dispatch_id);assert.equal(next.dispatch_generation,value.job.dispatch_generation+1)
 assert.equal(await f.candidates.claim(dispatch(value.job)),undefined)
 assert.equal((await f.candidates.retry(a.id,value.job.id,key)).id,value.job.id)
})
test('confirmation rollback, racing consumers and insufficient evidence never manufacture originals',async t=>{
 const f=await candidates(t),a=f.account(),value=await ready(f,a)
 await f.pool.query("CREATE FUNCTION reject_confirm() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type='MemoryConfirmed.v1' THEN RAISE EXCEPTION 'synthetic event failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_confirm BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION reject_confirm()")
 const body={...input(),candidateId:value.candidate.id,candidateVersion:value.candidate.version};await assert.rejects(f.store.create(a.id,a.person.id,randomUUID(),body),/synthetic event failure/)
 assert.equal((await f.candidates.candidate(a.id,a.person.id,value.candidate.id)).state,'ready');assert.equal((await f.pool.query('SELECT last_confirmed_seq FROM memory_account_cursors WHERE account_id=$1',[a.id])).rows[0].last_confirmed_seq,'0')
 await f.pool.query('DROP TRIGGER reject_confirm ON outbox_events')
 const results=await Promise.allSettled([f.store.create(a.id,a.person.id,randomUUID(),body),f.store.create(a.id,a.person.id,randomUUID(),{...body,clientMemoryId:randomUUID()})]);assert.equal(results.filter(value=>value.status==='fulfilled').length,1);assert.equal(results.find(value=>value.status==='rejected').reason.code,'CANDIDATE_CONSUMED')
 const empty=await start(f,a);await new SuggestionEngine(f.candidates,{async generate(){return {kind:'insufficient_evidence'}}}).run(dispatch(empty.job));const blocked=await f.candidates.job(a.id,empty.job.id);assert.equal(blocked.state,'blocked');assert.equal(blocked.failure.code,'NO_MEMORY_FACTS');assert.equal(blocked.resultRef,undefined)
})
test('candidate HTTP preserves ownership, strict hint routing, expected session and conditional confirmation',async t=>{
 const f=await candidates(t),a=f.account(),source=f.source(a),config={webOrigin:'http://127.0.0.1:5184',serviceToken:'a'.repeat(64),conversationsToken:'b'.repeat(64)}
 const app=await NestFactory.create(MemoriesModule.register(config,f.store,f.candidates),{logger:false});app.use(memoryHeaders);app.useGlobalFilters(new MemoryErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close());const origin=await app.getUrl(),headers={Cookie:a.cookie,Origin:config.webOrigin,'X-Xijie-Expected-Session':a.sid,'Idempotency-Key':randomUUID(),'Content-Type':'application/json'}
 const accepted=await fetch(origin+'/v1/persons/'+a.person.id+'/memory-candidates',{method:'POST',headers,body:JSON.stringify({sourceMessageId:source.id})});assert.equal(accepted.status,202);const job=(await accepted.json()).data.generationJobId
 const url=origin+'/v1/generation-jobs/'+job;assert.equal((await fetch(url,{headers})).status,400);assert.equal((await fetch(url+'?kind=chat_reply',{headers})).status,400);assert.equal((await fetch(url+'?kind=memory_suggestion&kind=memory_suggestion',{headers})).status,400);assert.equal((await fetch(url+'?kind=memory_suggestion',{headers})).status,200)
 assert.equal((await fetch(url+'?kind=memory_suggestion',{headers:{...headers,'X-Xijie-Expected-Session':randomUUID()}})).status,401)
 const b=f.account();assert.equal((await fetch(url+'?kind=memory_suggestion',{headers:{...headers,Cookie:b.cookie,'X-Xijie-Expected-Session':b.sid}})).status,404)
 assert.equal((await fetch(url+'/cancel?kind=memory_suggestion',{method:'POST',headers:{...headers,Origin:'http://other.invalid'},body:'{}'})).status,403)
 assert.equal((await fetch(url+'/cancel?kind=memory_suggestion',{method:'POST',headers,body:'{}'})).status,200)
})

test('new versioned evidence permits a new intent while old keys and unchanged failures remain stable',async t=>{
 const f=await candidates(t),a=f.account(),source=f.source(a),oldKey=randomUUID(),first=await f.candidates.request(a.id,a.person.id,source.id,oldKey)
 f.people.get(a.person.id).story='用户补充了新的资料。';f.people.get(a.person.id).version++
 const next=await f.candidates.request(a.id,a.person.id,source.id,randomUUID());assert.notEqual(next.generationJobId,first.generationJobId)
 assert.equal((await f.candidates.job(a.id,first.generationJobId)).state,'blocked');assert.equal(await f.candidates.claim(dispatch(await f.candidates.findJob(first.generationJobId))),undefined)
 assert.deepEqual(await f.candidates.request(a.id,a.person.id,source.id,oldKey),first)
 await new SuggestionEngine(f.candidates,{async generate(){return {kind:'insufficient_evidence'}}}).run(dispatch(await f.candidates.findJob(next.generationJobId)))
 assert.equal((await f.candidates.request(a.id,a.person.id,source.id,randomUUID())).generationJobId,next.generationJobId)
 f.people.get(a.person.id).version++
 const afterBlocked=await f.candidates.request(a.id,a.person.id,source.id,randomUUID());assert.notEqual(afterBlocked.generationJobId,next.generationJobId)
 await new SuggestionEngine(f.candidates,{async generate(){throw new SuggestionError('MODEL_REQUEST_FAILED',true)}}).run(dispatch(await f.candidates.findJob(afterBlocked.generationJobId)))
 f.people.get(a.person.id).version++
 const afterFailed=await f.candidates.request(a.id,a.person.id,source.id,randomUUID());assert.notEqual(afterFailed.generationJobId,afterBlocked.generationJobId)
 await assert.rejects(f.candidates.retry(a.id,afterBlocked.generationJobId,randomUUID()),{code:'SOURCE_CHANGED'})
 f.sources.get(source.id).version++
 const afterSourceRevision=await f.candidates.request(a.id,a.person.id,source.id,randomUUID());assert.notEqual(afterSourceRevision.generationJobId,afterFailed.generationJobId)
 assert.equal((await f.candidates.job(a.id,afterFailed.generationJobId)).state,'blocked')
 assert.equal((await f.pool.query("SELECT count(*) FROM memory_generation_jobs WHERE account_id=$1 AND source_message_id=$2 AND state IN ('queued','running')",[a.id,source.id])).rows[0].count,'1')
})

async function eventually(check){const until=Date.now()+12000;while(Date.now()<until){if(await check())return;await new Promise(resolve=>setTimeout(resolve,50))}assert.fail('Expected persisted condition was not reached')}
test('stopping while the database claim is in flight releases the task before any model call',async t=>{
 const f=await candidates(t),a=f.account(),value=await start(f,a),originalClaim=f.candidates.claim.bind(f.candidates)
 let claimed,continueClaim;const didClaim=new Promise(resolve=>{claimed=resolve}),resume=new Promise(resolve=>{continueClaim=resolve})
 f.candidates.claim=async task=>{const row=await originalClaim(task);claimed();await resume;return row}
 let calls=0;const engine=new SuggestionEngine(f.candidates,{async generate(){calls++;return {kind:'suggestion',title:'不能生成',body:'已停止的 Worker 不应调用模型。'}}}),running=engine.run(dispatch(value.job))
 await didClaim;engine.stop();continueClaim();await assert.rejects(running,/stopped while claiming/)
 assert.equal(calls,0);assert.equal((await f.candidates.findJob(value.job.id)).state,'queued')
})
async function childWorker(f,a,source,beforeClaim=false){
 const child=fork(new URL('./crash-worker.mjs',import.meta.url),[],{silent:true,execArgv:[],env:{...process.env,MEMORY_CRASH_SCHEMA:f.schema,MEMORY_CRASH_QUEUE_SCHEMA:f.queueSchema,MEMORY_CRASH_CONTEXT:JSON.stringify({account:f.accounts.get(a.id),person:f.people.get(a.person.id),source:await f.dependencies.memoryContext(a.id,source.id)}),MEMORY_CRASH_BEFORE_CLAIM:String(beforeClaim)}})
 let timeout;try{const notice=await Promise.race([once(child,'message').then(([value])=>value),once(child,'exit').then(()=>{throw new Error('Synthetic worker exited before readiness')}),new Promise((_resolve,reject)=>{timeout=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Synthetic worker readiness timed out'))},10000)})]);return {child,notice}}finally{clearTimeout(timeout)}
}
test('real queue consumes a persisted task and missing-model failures contain no candidate or fake text',async t=>{
 const f=await candidates(t),a=f.account(),value=await start(f,a),engine=new SuggestionEngine(f.candidates,{async generate(){throw new SuggestionError('MODEL_NOT_CONFIGURED',true)}})
 await f.queue.work(task=>engine.run(task));await eventually(async()=>(await f.candidates.findJob(value.job.id)).state==='failed')
 const result=await f.candidates.job(a.id,value.job.id);assert.equal(result.failure.code,'MODEL_NOT_CONFIGURED');assert.equal(result.resultRef,undefined);assert.equal((await f.pool.query('SELECT count(*) FROM memory_candidates')).rows[0].count,'0')
})
test('normal candidate Worker shutdown requeues its task and a new process attempt completes it once',async t=>{
 const f=await candidates(t),a=f.account(),value=await start(f,a),{child,notice}=await childWorker(f,a,value.source)
 assert.equal(notice.stage,'model-started');const before=await f.candidates.findJob(value.job.id),exited=once(child,'exit');child.send({shutdown:true});await exited
 const released=await f.candidates.findJob(value.job.id);assert.equal(released.state,'queued');assert.equal(released.failure_code,null)
 const engine=new SuggestionEngine(f.candidates,{async generate(){return {kind:'suggestion',title:'恢复后的建议',body:'这段合成建议由恢复后的当前尝试生成。'}}});await f.queue.work(task=>engine.run(task));await eventually(async()=>(await f.candidates.findJob(value.job.id)).state==='succeeded')
 const done=await f.candidates.findJob(value.job.id);assert.notEqual(done.attempt_id,before.attempt_id);assert.equal(done.attempt_count,2);assert.equal((await f.pool.query('SELECT count(*) FROM memory_candidates')).rows[0].count,'1');assert.equal(await f.candidates.complete(before,'旧尝试','不能写入'),false)
})
test('killed candidate Worker is redelivered by the real queue and stale attempt cannot publish',async t=>{
 const f=await candidates(t),a=f.account(),value=await start(f,a),{child,notice}=await childWorker(f,a,value.source);assert.equal(notice.stage,'model-started');const before=await f.candidates.findJob(value.job.id),exited=once(child,'exit');child.kill('SIGKILL');await exited
 await f.pool.query("UPDATE memory_generation_jobs SET started_at=clock_timestamp()-interval '2 minutes',lease_until=clock_timestamp()-interval '1 minute' WHERE id=$1",[value.job.id]);await f.pool.query('UPDATE '+f.queueSchema+".job SET started_on=clock_timestamp()-interval '2 minutes' WHERE data->>'jobId'=$1",[value.job.id])
 const engine=new SuggestionEngine(f.candidates,{async generate(){return {kind:'suggestion',title:'硬中断后恢复',body:'当前有效尝试恢复并生成此建议。'}}});await f.queue.work(task=>engine.run(task));await eventually(async()=>{await f.queue.boss.supervise();return (await f.candidates.findJob(value.job.id)).state==='succeeded'})
 const done=await f.candidates.findJob(value.job.id);assert.equal(done.attempt_count,2);assert.notEqual(done.attempt_id,before.attempt_id);assert.equal(await f.candidates.complete(before,'旧结果','不可发布'),false)
})
test('exhausted physical candidate deliveries reconcile into a finite domain failure',async t=>{
 const f=await candidates(t),a=f.account(),value=await start(f,a)
 for(let i=0;i<4;i++){
  const {child,notice}=await childWorker(f,a,value.source,i===3);assert.equal(notice.stage,i===3?'fetched':'model-started');const exited=once(child,'exit');child.kill('SIGKILL');await exited
  await f.pool.query("UPDATE memory_generation_jobs SET started_at=clock_timestamp()-interval '2 minutes',lease_until=clock_timestamp()-interval '1 minute' WHERE id=$1",[value.job.id]);await f.pool.query('UPDATE '+f.queueSchema+".job SET started_on=clock_timestamp()-interval '2 minutes' WHERE data->>'jobId'=$1",[value.job.id])
  await eventually(async()=>{await f.queue.boss.supervise();const [physical]=await f.queue.boss.findJobs('memory.suggest.v1',{data:{jobId:value.job.id}});return physical.state===(i===3?'failed':'retry')})
 }
 await f.candidates.reconcileDeliveries();const job=await f.candidates.job(a.id,value.job.id);assert.equal(job.state,'failed');assert.equal(job.failure.code,'DELIVERY_EXHAUSTED');assert.equal(job.failure.retryable,false);assert.equal(job.resultRef,undefined)
})
