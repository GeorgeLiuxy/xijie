import 'reflect-metadata'
import assert from 'node:assert/strict'
import {randomUUID,createHash} from 'node:crypto'
import {test} from 'node:test'
import pg from 'pg'
import {NestFactory} from '@nestjs/core'
import {fixture,input} from './fixture.mjs'
import {MemoryDataRights} from '../dist/data-rights.js'
import {MemoryStore} from '../dist/store.js'
import {CandidateStore} from '../dist/candidates.js'
import {CandidateQueue} from '../dist/queue.js'
import {SuggestionEngine} from '../dist/engine.js'
import {MemoriesModule,MemoryErrors,memoryHeaders} from '../dist/http.js'
import {Dependencies} from '../dist/dependencies.js'

function contexts(f){
 const requests=new Map()
 f.dependencies.dataRequest=async id=>{const value=requests.get(id);if(!value)throw Object.assign(new Error('Missing'),{status:404});return structuredClone(value)}
 const make=(a,kind='export',scope='account_data')=>{
  const id=randomUUID();requests.set(id,{requestId:id,accountId:a.id,kind,scope,status:'processing',accountStatus:kind==='export'?'active':'deletion_pending',accountAccessVersion:kind==='export'?1:2});return id
 }
 return {requests,make}
}
async function queued(t){
 const f=await fixture(t),queueSchema='rights_queue_'+randomUUID().replaceAll('-',''),queue=await new CandidateQueue(f.connectionString,queueSchema).start()
 t.after(async()=>{await queue.stop();const admin=new pg.Pool({connectionString:f.connectionString});await admin.query('DROP SCHEMA '+queueSchema+' CASCADE');await admin.end()})
 const candidates=new CandidateStore(f.pool,f.dependencies,queue)
 return {...f,...contexts(f),queueSchema,queue,candidates,store:new MemoryStore(f.pool,f.dependencies,candidates),rights:new MemoryDataRights(f.pool,f.dependencies,queueSchema)}
}
const privateTables=['memories','memory_commands','memory_generation_jobs','memory_candidates','candidate_commands','outbox_events','memory_account_cursors']
async function assertErased(f,accountId){for(const table of privateTables)assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM '+table+' WHERE account_id=$1',[accountId])).rows[0].n,0,table)}
const dispatch=job=>({jobId:job.id,dispatchId:job.dispatch_id,dispatchGeneration:job.dispatch_generation})

test('data export is a stable complete visible-original snapshot without AI/storage permission or internal payloads',async t=>{
 const f=await fixture(t),{make,requests}=contexts(f),a=f.account(),b=f.account(),rights=new MemoryDataRights(f.pool,f.dependencies)
 const first=await f.store.create(a.id,a.person.id,randomUUID(),input('合成用户确认原文A'))
 const removed=await f.store.create(a.id,a.person.id,randomUUID(),input('合成已移除原文不可重现'))
 await f.store.remove(a.id,a.person.id,removed.id,randomUUID(),removed.version)
 await f.store.create(b.id,b.person.id,randomUUID(),input('其他账号原文不能导出'))
 const hiddenPerson={...a.person,id:randomUUID()};f.people.set(hiddenPerson.id,hiddenPerson)
 await f.store.create(a.id,hiddenPerson.id,randomUUID(),input('已删除人物的原文不能导出'));f.people.delete(hiddenPerson.id)
 f.accounts.get(a.id).aiTextProcessing={allowed:false,authorizationVersion:2};f.accounts.get(a.id).storyStorage={allowed:false,authorizationVersion:2}
 const request=make(a),exported=await rights.export(a.id,request,'account_data')
 assert.equal(exported.domain,'memories');assert.equal(exported.schemaVersion,1);assert.equal(exported.accountId,a.id)
 assert.deepEqual(exported.data.memories.map(item=>item.id),[first.id]);assert.equal(exported.data.memories[0].body,'合成用户确认原文A')
 assert.equal(exported.revision,createHash('sha256').update(JSON.stringify(exported.data)).digest('hex'))
 assert.equal((await rights.export(a.id,request,'account_data')).revision,exported.revision)
 const serialized=JSON.stringify(exported);for(const forbidden of ['request_hash','clientMemoryId','candidate_commands','已移除原文','其他账号原文','已删除人物'])assert.equal(serialized.includes(forbidden),false)
 const interactions=make(a,'export','interaction_data');assert.equal((await rights.export(a.id,interactions,'interaction_data')).revision,exported.revision)
 await assert.rejects(()=>rights.export(b.id,request,'account_data'),error=>error.status===404)
 await assert.rejects(()=>rights.export(a.id,request,'interaction_data'),error=>error.status===404)
 requests.get(request).accountStatus='deletion_pending';await assert.rejects(()=>rights.export(a.id,request,'account_data'),error=>error.status===404)
 requests.get(request).accountStatus='active';f.accounts.get(a.id).storyStorage.allowed=true
 await f.store.patch(a.id,a.person.id,first.id,randomUUID(),1,{body:'用户明确纠正后的原文'})
 assert.notEqual((await rights.export(a.id,request,'account_data')).revision,exported.revision)
})

test('erasure atomically removes private originals, candidates, commands and every owned physical queue dispatch; repeats retain only a receipt',async t=>{
 const f=await queued(t),a=f.account(),b=f.account()
 const memory=await f.store.create(a.id,a.person.id,randomUUID(),input('合成清理后不能保留的文字'))
 await f.store.remove(a.id,a.person.id,memory.id,randomUUID(),memory.version)
 const preserved=await f.store.create(b.id,b.person.id,randomUUID(),input('合成其他账号保留文字'))
 const source=f.source(a),accepted=await f.candidates.request(a.id,a.person.id,source.id,randomUUID()),job=await f.candidates.findJob(accepted.generationJobId)
 await new SuggestionEngine(f.candidates,{async generate(){return {kind:'suggestion',title:'合成候选','body':'合成候选正文需要清理'}}}).run(dispatch(job))
 const completed=await f.candidates.findJob(job.id),candidate=await f.candidates.candidate(a.id,a.person.id,completed.candidate_id)
 await f.store.create(a.id,a.person.id,randomUUID(),{...input(candidate.body),candidateId:candidate.id,candidateVersion:candidate.version})
 // Add another physical delivery for the same business reference to cover older dispatches.
 const db=await f.pool.connect();try{await f.queue.send(db,{...dispatch(job),dispatchId:randomUUID(),dispatchGeneration:8})}finally{db.release()}
 const otherSource=f.source(b),other=await f.candidates.request(b.id,b.person.id,otherSource.id,randomUUID())
 const request=f.make(a,'delete_account'),result=await f.rights.erase(a.id,request)
 assert.equal(result.alreadyErased,false);assert.equal(result.requestId,request);await assertErased(f,a.id)
 assert.equal((await f.store.detail(b.id,b.person.id,preserved.id)).body,'合成其他账号保留文字')
 assert.ok(await f.candidates.findJob(other.generationJobId))
 assert.equal((await f.queue.boss.findJobs('memory.suggest.v1',{data:{jobId:job.id},limit:100})).length,0)
 assert.ok((await f.queue.boss.findJobs('memory.suggest.v1',{data:{jobId:other.generationJobId},limit:100})).length>0)
 const repeated=await f.rights.erase(a.id,request);assert.deepEqual(repeated,{...result,alreadyErased:true})
 f.requests.get(request).accountStatus='deleted';assert.equal((await f.rights.erase(a.id,request)).alreadyErased,true)
 await assert.rejects(()=>f.rights.erase(a.id,f.make(a,'delete_account')),error=>error.status===409)
 for(const table of privateTables)await assert.rejects(()=>f.pool.query('INSERT INTO '+table+'(account_id) VALUES($1)',[a.id]),error=>error.code==='42501')
 await assert.rejects(()=>f.store.create(a.id,a.person.id,randomUUID(),input('迟到旧授权不能复活原文')),error=>error.code==='42501')
 await assertErased(f,a.id)
})

test('a pre-erasure repeatable-read snapshot cannot revive data after its gate version changes',async t=>{
 const f=await fixture(t),{make}=contexts(f),a=f.account(),rights=new MemoryDataRights(f.pool,f.dependencies)
 await f.store.create(a.id,a.person.id,randomUUID(),input())
 const stale=await f.pool.connect()
 try{
  await stale.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
  await stale.query('SELECT * FROM memories WHERE account_id=$1',[a.id])
  await rights.erase(a.id,make(a,'delete_account'))
  await assert.rejects(()=>stale.query('INSERT INTO memory_account_cursors(account_id) VALUES($1) ON CONFLICT DO NOTHING',[a.id]),error=>error.code==='40001')
  await stale.query('ROLLBACK');await assertErased(f,a.id)
 }finally{await stale.query('ROLLBACK').catch(()=>{});stale.release()}
})

test('erasure serializes behind a prior private writer and removes its just-committed text',async t=>{
 const f=await fixture(t),{make}=contexts(f),a=f.account(),writer=await f.pool.connect()
 const erasePool=new pg.Pool({connectionString:f.connectionString,application_name:'mem_erase_'+f.schema,options:'-c search_path='+f.schema})
 t.after(()=>erasePool.end())
 const rights=new MemoryDataRights(erasePool,f.dependencies)
 try{
  await writer.query('BEGIN')
  await writer.query('INSERT INTO memory_account_cursors(account_id) VALUES($1)',[a.id])
  const erasing=rights.erase(a.id,make(a,'delete_account'));let waiting=false
  for(let index=0;index<30&&!waiting;index++)waiting=(await f.pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",['mem_erase_'+f.schema])).rowCount>0
  assert.equal(waiting,true,'The real database observes erasure waiting for the writer gate')
  await writer.query('INSERT INTO memories(account_id,person_id,client_memory_id,request_hash,confirmed_seq,title,body) VALUES($1,$2,$3,$4,1,$5,$6)',[a.id,a.person.id,randomUUID(),'x','刚提交','旧写入的合成文字'])
  await writer.query('COMMIT');await erasing;await assertErased(f,a.id)
 }finally{await writer.query('ROLLBACK').catch(()=>{});writer.release()}
})

test('a model already in flight cannot restore a candidate or a job after erasure',async t=>{
 const f=await queued(t),a=f.account(),source=f.source(a),accepted=await f.candidates.request(a.id,a.person.id,source.id,randomUUID()),job=await f.candidates.findJob(accepted.generationJobId)
 let started,release;const startedPromise=new Promise(resolve=>started=resolve),resultPromise=new Promise(resolve=>release=resolve)
 const engine=new SuggestionEngine(f.candidates,{async generate(){started();await resultPromise;return {kind:'suggestion',title:'迟到结果','body':'这段合成正文不能重新入库'}}})
 const running=engine.run(dispatch(job));await startedPromise
 await f.rights.erase(a.id,f.make(a,'delete_account'));release();await running;await assertErased(f,a.id)
 assert.equal(await f.candidates.findJob(job.id),undefined)
})

test('internal HTTP rights routes require the dedicated token and matching authoritative request metadata',async t=>{
 const f=await fixture(t),{make,requests}=contexts(f),a=f.account(),config={webOrigin:'http://127.0.0.1:5184',serviceToken:'a'.repeat(64),conversationsToken:'b'.repeat(64),dataRightsToken:'c'.repeat(64)}
 const app=await NestFactory.create(MemoriesModule.register(config,f.store),{logger:false});app.use(memoryHeaders);app.useGlobalFilters(new MemoryErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close())
 const origin=await app.getUrl(),request=make(a),base=origin+'/internal/v1/accounts/'+a.id,query='?requestId='+request+'&scope=account_data',headers={Authorization:'Bearer '+config.dataRightsToken}
 assert.equal((await fetch(base+'/data-export'+query)).status,403)
 assert.equal((await fetch(base+'/data-export'+query,{headers:{Authorization:'Bearer '+config.serviceToken}})).status,403)
 const exported=await fetch(base+'/data-export'+query,{headers});assert.equal(exported.status,200);assert.equal(exported.headers.get('cache-control'),'no-store');assert.equal((await exported.json()).data.domain,'memories')
 assert.equal((await fetch(base+'/data-export'+query+'&scope=account_data',{headers})).status,400)
 assert.equal((await fetch(base+'/data-export'+query+'&extra=true',{headers})).status,400)
 requests.get(request).kind='delete_account';requests.get(request).accountStatus='deletion_pending'
 const erase=(key=request,body={requestId:request})=>fetch(base+'/erase',{method:'POST',headers:{...headers,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)})
 assert.equal((await erase(randomUUID())).status,400);assert.equal((await erase(request,{requestId:request,extra:true})).status,400)
 const erased=await erase();assert.equal(erased.status,200);assert.equal((await erased.json()).data.alreadyErased,false)
 assert.equal((await (await erase()).json()).data.alreadyErased,true)
 const late=await fetch(origin+'/v1/persons/'+a.person.id+'/memories',{method:'POST',headers:{Cookie:a.cookie,'X-Xijie-Expected-Session':a.sid,Origin:config.webOrigin,'Idempotency-Key':randomUUID(),'Content-Type':'application/json'},body:JSON.stringify(input('旧会话的迟到原文'))})
 assert.equal(late.status,404);assert.equal((await late.json()).error.code,'NOT_FOUND')
 config.dataRightsToken=null;assert.equal((await fetch(base+'/data-export'+query,{headers})).status,404)
})

test('Identity data-request decoder rejects missing, mismatched or malformed permission metadata and blocks redirects',async()=>{
 const requestId=randomUUID(),accountId=randomUUID(),config={identityOrigin:'http://127.0.0.1:3101',serviceToken:'d'.repeat(64)}
 const valid={requestId,accountId,kind:'export',scope:'account_data',status:'processing',accountStatus:'active',accountAccessVersion:1},original=globalThis.fetch
 let response=valid
 globalThis.fetch=async(url,options)=>{assert.equal(new URL(url).pathname,'/internal/v1/data-requests/'+requestId+'/context');assert.equal(options.headers.Authorization,'Bearer '+config.serviceToken);assert.equal(options.redirect,'error');return Response.json({data:response})}
 try{
  const dependency=new Dependencies(config);assert.deepEqual(await dependency.dataRequest(requestId),valid)
  for(const changed of [{...valid,requestId:randomUUID()},{...valid,status:'unknown'},{...valid,accountAccessVersion:0},{...valid,scope:null},null]){response=changed;await assert.rejects(()=>dependency.dataRequest(requestId),error=>error.status===503)}
 }finally{globalThis.fetch=original}
})
