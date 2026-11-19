import 'reflect-metadata'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {test} from 'node:test'
import pg from 'pg'
import {NestFactory} from '@nestjs/core'
import {fixture,input} from './automatic-fixture.mjs'
import {MemoryError} from '../dist/contracts.js'
import {AutomaticMemoryStore} from '../dist/automatic-store.js'
import {AutomaticMemoryEngine} from '../dist/automatic-engine.js'
import {MemoryDataRights} from '../dist/data-rights.js'
import {CandidateQueue} from '../dist/queue.js'
import {MemoriesModule,MemoryErrors,memoryHeaders} from '../dist/http.js'

const fixedTime='2026-11-10T02:00:00.000Z'
const automaticTables=['automatic_memory_entries','automatic_memory_jobs','automatic_memory_sources','automatic_memory_receipts']
const dispatch=row=>({jobId:row.id,dispatchId:row.dispatch_id,dispatchGeneration:row.dispatch_generation})
async function automaticFixture(t){
 const f=await fixture(t),messages=new Map(),deliveries=[]
 f.dependencies.sourceEvents=async()=>[]
 f.dependencies.ackSourceEvent=async()=>({})
 f.dependencies.automaticMessage=async(accountId,id)=>{
  const value=messages.get(id)
  if(!value||value.accountId!==accountId||value.authorKind!=='self')throw new MemoryError(404,'NOT_FOUND','Missing synthetic source')
  return structuredClone(value)
 }
 f.dependencies.validAutomaticRefs=async(accountId,personId,refs)=>refs.filter(ref=>{
  const value=messages.get(ref.id)
  return value?.accountId===accountId&&value.personId===personId&&value.version===ref.version
 }).map(ref=>({...ref}))
 const queue={async send(_db,value){deliveries.push({...value})},async isPending(){return false}}
 const automatic=new AutomaticMemoryStore(f.pool,f.dependencies,queue)
 function source(a,text,sequence='1',context=[],authorKind='self'){
  const row={id:randomUUID(),accountId:a.id,personId:a.person.id,conversationId:a.person.id,text,version:1,createdAt:fixedTime,sequence:String(sequence),aiAuthorizationVersion:1,context:structuredClone(context),authorKind}
  messages.set(row.id,row)
  f.sources.set(row.id,{...row,kind:'text',author:authorKind==='self'?{kind:'self'}:{kind:'persona',personId:a.person.id,aiGenerated:true}})
  return row
 }
 const event=(row,change='upsert',sourceVersion=row.version)=>({eventId:randomUUID(),accountId:row.accountId,personId:row.personId,sourceKind:'message',sourceId:row.id,sourceVersion,change,occurredAt:fixedTime})
 async function remember(row,{body=row.text,evidence=row.text,topic='synthetic preference',supersedes=[]}={}){
  const sourceEvent=event(row),result=await automatic.ingest('conversations',sourceEvent)
  assert.ok(result.jobId,'An authorized self message is accepted without a cherish action')
  const job=await automatic.findJob(result.jobId)
  await new AutomaticMemoryEngine(automatic,{async generate(){return {facts:[{body,evidence,topic,timeDescription:'',supersedes}]}}}).run(dispatch(job))
  assert.equal((await automatic.findJob(job.id)).state,'succeeded')
  const entry=(await f.pool.query('SELECT id,version,state FROM automatic_memory_entries WHERE generation_job_id=$1',[job.id])).rows[0]
  assert.ok(entry,'The automatic result is a persisted derived entry')
  return {entry,job,sourceEvent}
 }
 async function assertNoAutomaticRows(accountId){
  for(const table of automaticTables)assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM '+table+' WHERE account_id=$1',[accountId])).rows[0].n,0,table)
 }
 return {...f,messages,automatic,source,event,remember,deliveries,assertNoAutomaticRows}
}

test('private automatic memory controls preserve the original source and fence corrected or stopped versions',async t=>{
 const f=await automaticFixture(t),a=f.account(),foreign=f.account(),webOrigin='http://127.0.0.1:5184'
 const {entry}=await f.remember(f.source(a,'我记得集合地点是东门。','1'),{topic:'集合地点：东门'})
 const cherished=await f.store.create(a.id,a.person.id,randomUUID(),input('用户已珍藏的原文'))
 const app=await NestFactory.create(MemoriesModule.register({webOrigin,serviceToken:'a'.repeat(64),conversationsToken:'b'.repeat(64)},f.store,undefined,undefined,null,f.automatic),{logger:false,abortOnError:false})
 app.getHttpAdapter().getInstance().disable('etag')
 app.use(memoryHeaders);app.useGlobalFilters(new MemoryErrors());await app.listen(0,'127.0.0.1')
 t.after(()=>app.close())
 const origin=await app.getUrl(),base='/v1/persons/'+a.person.id+'/memories/automatic',path=base+'/'+entry.id
 const request=(path,actor=a,method='GET',headers={},body)=>fetch(origin+path,{method,headers:{Cookie:actor.cookie,'X-Xijie-Expected-Session':actor.sid,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})})
 const command=(actor,method,version,key,body)=>request(path,actor,method,{Origin:webOrigin,'Content-Type':'application/json','If-Match':'"v'+version+'"','Idempotency-Key':key},body)
 const list=async()=>{const result=await request(base);assert.equal(result.status,200);return (await result.json()).data}
 assert.equal((await request(base,foreign)).status,404)
 assert.equal((await request(base,a,'GET',{'X-Xijie-Expected-Session':foreign.sid})).status,401)
 const original=(await list())[0]
 assert.equal(original.source.excerpt,'我记得集合地点是东门。')
 assert.equal(original.userCorrected,false)
 const patch={title:'集合地点：西门',body:'集合地点是西门。'},key=randomUUID()
 assert.equal((await command(foreign,'PATCH',1,key,patch)).status,404)
 assert.equal((await request(path,a,'PATCH',{Origin:'https://other.invalid','Content-Type':'application/json','If-Match':'"v1"','Idempotency-Key':key},patch)).status,403)
 const correction=await command(a,'PATCH',1,key,patch)
 assert.equal(correction.status,200);assert.equal(correction.headers.get('etag'),'"v2"')
 assert.equal((await command(a,'PATCH',1,key,patch)).status,200)
 assert.equal((await command(a,'PATCH',1,key,{...patch,body:'另一个地方'})).status,409)
 assert.equal((await command(a,'DELETE',1,randomUUID())).status,412)
 const edited=(await list())[0]
 assert.deepEqual([edited.topic,edited.body,edited.source.excerpt,edited.version,edited.userCorrected],[patch.title,patch.body,original.source.excerpt,2,true])
 const [context]=await f.automatic.context(a.id,a.person.id,'西门')
 assert.equal(context.body,patch.body);assert.equal(context.evidence,'');assert.ok(context.userCorrectedAt)
 assert.equal(await f.automatic.validate(a.id,a.person.id,[{id:entry.id,version:1}]),false)
 assert.equal(await f.automatic.validate(a.id,a.person.id,[{id:entry.id,version:2}]),true)

 const source=f.source(a,'另一个真实的话题。','2')
 const accepted=await f.automatic.ingest('conversations',f.event(source))
 const queued=await f.automatic.findJob(accepted.jobId),job=await f.automatic.claim(dispatch(queued))
 const snapshot=await f.automatic.snapshot(a.id,a.person.id,'message',source.id)
 assert.ok(snapshot.previousEntries.some(value=>value.id===entry.id&&value.version===2))
 const stopKey=randomUUID()
 assert.equal((await command(a,'DELETE',2,stopKey)).status,200)
 assert.equal((await command(a,'DELETE',2,stopKey)).status,200)
 await assert.rejects(f.automatic.complete(job,[{body:source.text,topic:'另一个话题',timeDescription:'',evidence:source.text,supersedes:[]}],snapshot),{code:'SOURCE_CHANGED'})
 assert.deepEqual(await f.automatic.context(a.id,a.person.id,'西门'),[])
 assert.deepEqual(await list(),[])
 assert.equal(await f.automatic.validate(a.id,a.person.id,[{id:entry.id,version:2}]),false)
 assert.equal((await f.store.detail(a.id,a.person.id,cherished.id)).body,'用户已珍藏的原文')
 f.accounts.get(a.id).aiTextProcessing={allowed:false,authorizationVersion:2}
 assert.equal((await request(base)).status,403)
 assert.equal((await command(a,'DELETE',2,stopKey)).status,403)
})

test('a same-millisecond later correction supersedes the old fact, and deleting or replaying sources never revives it',async t=>{
 const f=await automaticFixture(t),a=f.account()
 const old=f.source(a,'我以前最喜欢红茶。','9007199254740993')
 const first=await f.remember(old)
 const correction=f.source(a,'纠正一下，我现在喜欢绿茶，不再喝红茶了。','9007199254740994')
 assert.equal(old.createdAt,correction.createdAt,'The source wall clock intentionally cannot order these messages')
 const second=await f.remember(correction,{topic:'synthetic preference',supersedes:[first.entry.id]})
 let selected=await f.automatic.context(a.id,a.person.id,'')
 assert.ok(selected.some(value=>value.id===second.entry.id))
 assert.equal(selected.some(value=>value.id===first.entry.id),false)
 assert.equal((await f.pool.query('SELECT state FROM automatic_memory_entries WHERE id=$1',[first.entry.id])).rows[0].state,'superseded')

 f.messages.delete(correction.id)
 f.sources.delete(correction.id)
 await f.automatic.ingest('conversations',f.event(correction,'remove',2))
 assert.deepEqual(await f.automatic.context(a.id,a.person.id,''),[])
 // Delivery replays, a fresh duplicate event and a stale physical dispatch are independent attack paths.
 await f.automatic.ingest('conversations',first.sourceEvent)
 await f.automatic.ingest('conversations',f.event(old))
 await new AutomaticMemoryEngine(f.automatic,{async generate(){throw new Error('A succeeded old source must not be regenerated')}}).run(dispatch(first.job))
 selected=await f.automatic.context(a.id,a.person.id,'')
 assert.deepEqual(selected,[])
 assert.equal((await f.pool.query('SELECT state FROM automatic_memory_entries WHERE id=$1',[first.entry.id])).rows[0].state,'superseded')
 assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM memory_account_cursors')).rows[0].n,0)
 assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM outbox_events WHERE type='MemoryConfirmed.v1'")).rows[0].n,0)
})

test('removing only an AI context dependency invalidates the derivative, while an independent cherished original stays readable',async t=>{
 const f=await automaticFixture(t),a=f.account()
 const prior=f.source(a,'你会去哪里散步？','1',[],'persona')
 const source=f.source(a,'我每周日会去城北公园散步。','2',[{id:prior.id,version:prior.version,authorKind:'persona',text:prior.text,createdAt:prior.createdAt}])
 const {entry}=await f.remember(source,{topic:'weekly walk'})
 const cherished=await f.store.create(a.id,a.person.id,randomUUID(),{...input(source.text),sourceMessageId:prior.id,sourceMessageVersion:1})
 assert.equal((await f.automatic.context(a.id,a.person.id,'')).some(value=>value.id===entry.id),true)
 f.messages.delete(prior.id)
 f.sources.delete(prior.id)
 // Do not deliver a removal event yet: the authorization-time source check must still prevent its use.
 assert.deepEqual(await f.automatic.context(a.id,a.person.id,''),[])
 assert.equal(f.messages.get(source.id).version,1)
 assert.equal((await f.store.detail(a.id,a.person.id,cherished.id)).body,source.text)
 await f.automatic.ingest('conversations',f.event(prior,'remove',2))
 f.messages.delete(source.id)
 f.sources.delete(source.id)
 await f.automatic.ingest('conversations',f.event(source,'remove',2))
 assert.deepEqual(await f.automatic.context(a.id,a.person.id,''),[])
 assert.equal((await f.store.detail(a.id,a.person.id,cherished.id)).body,source.text)
})

test('validation fences only the referenced facts; unrelated arrivals do not block a reply, and foreign ownership never validates',async t=>{
 const f=await automaticFixture(t),a=f.account(),b=f.account()
 const first=await f.remember(f.source(a,'我喜欢在早上骑自行车。','1'),{topic:'cycling'})
 const used=[{id:first.entry.id,version:first.entry.version}]
 assert.equal(await f.automatic.validate(a.id,a.person.id,used),true)
 await f.remember(f.source(a,'我最近在学习陶艺。','2'),{topic:'pottery'})
 assert.equal(await f.automatic.validate(a.id,a.person.id,used),true)
 assert.equal(await f.automatic.validate(b.id,b.person.id,used),false)
 const anotherPerson={...a.person,id:randomUUID()};f.people.set(anotherPerson.id,anotherPerson)
 assert.equal(await f.automatic.validate(a.id,anotherPerson.id,used),false)
 f.messages.delete(first.job.source_id)
 assert.equal(await f.automatic.validate(a.id,a.person.id,used),false)
})

test('a growing history validates source references in bounded batches instead of exceeding the source API contract',async t=>{
 const f=await automaticFixture(t),a=f.account(),validate=f.dependencies.validAutomaticRefs
 const batches=[]
 f.dependencies.validAutomaticRefs=async(accountId,personId,refs)=>{
  batches.push(refs.length)
  if(refs.length>64)throw new MemoryError(400,'INVALID_ARGUMENT','Synthetic source endpoint rejects more than 64 references')
  return validate(accountId,personId,refs)
 }
 for(let index=0;index<11;index++){
  const context=Array.from({length:6},(_unused,offset)=>{
   const row=f.source(a,'合成 AI 语境 '+index+'-'+offset,String(index*7+offset+1),[],'persona')
   return {id:row.id,version:1,authorKind:'persona',text:row.text,createdAt:row.createdAt}
  })
  await f.remember(f.source(a,'合成资料：我喜欢第'+index+'种茶。',String(index*7+7),context),{topic:'tea '+index})
 }
 const selected=await f.automatic.context(a.id,a.person.id,'')
 assert.equal(selected.length,8)
 assert.ok(batches.length>0)
 assert.ok(batches.every(count=>count<=64))
 assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM automatic_memory_entries WHERE account_id=$1 AND state='active'",[a.id])).rows[0].n,11)
})

test('a source deleted before its first delivery reaches a durable terminal outcome, while a temporary source outage stays retryable',async t=>{
 const f=await automaticFixture(t),a=f.account(),removed=f.source(a,'这条合成消息在自动整理前已经删除。','1')
 const obsolete=f.event(removed)
 f.messages.delete(removed.id);f.sources.delete(removed.id)
 const result=await f.automatic.ingest('conversations',obsolete)
 assert.equal(result.accepted,true)
 assert.equal(result.jobId,undefined)
 const receipt=(await f.pool.query('SELECT outcome FROM automatic_memory_receipts WHERE origin=$1 AND event_id=$2',['conversations',obsolete.eventId])).rows[0]
 assert.ok(receipt,'The worker must be able to acknowledge the old event without blocking later events')
 assert.ok(['removed','ineligible','stale'].includes(receipt.outcome))

 const available=f.source(a,'临时中断恢复后仍应自动整理这条合成消息。','2'),pending=f.event(available),read=f.dependencies.automaticMessage
 f.dependencies.automaticMessage=async()=>{throw new MemoryError(503,'DEPENDENCY_UNAVAILABLE','Synthetic temporary outage')}
 await assert.rejects(()=>f.automatic.ingest('conversations',pending),error=>error.status===503)
 assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM automatic_memory_receipts WHERE event_id=$1',[pending.eventId])).rows[0].n,0)
 f.dependencies.automaticMessage=read
 assert.ok((await f.automatic.ingest('conversations',pending)).jobId)
})

test('a local correction committed during remote reference validation makes that in-flight validation fail',async t=>{
 const f=await automaticFixture(t),a=f.account(),created=await f.remember(f.source(a,'合成资料：我喜欢在清晨散步。','1'))
 const validate=f.dependencies.validAutomaticRefs
 let changed=false
 f.dependencies.validAutomaticRefs=async(accountId,personId,refs)=>{
  const valid=await validate(accountId,personId,refs)
  if(!changed){
   changed=true
   await f.pool.query("UPDATE automatic_memory_entries SET state='withdrawn',version=version+1,updated_at=GREATEST(created_at,clock_timestamp()),state_changed_at=GREATEST(created_at,clock_timestamp()) WHERE id=$1",[created.entry.id])
  }
  return valid
 }
 assert.equal(await f.automatic.validate(a.id,a.person.id,[{id:created.entry.id,version:created.entry.version}]),false)
 assert.equal(changed,true)
 assert.deepEqual(await f.automatic.context(a.id,a.person.id,''),[])
})

test('AI consent withdrawal does not block a rights export, but a removed source changes its revision and suppresses the derivative text',async t=>{
 const f=await automaticFixture(t),a=f.account(),source=f.source(a,'合成资料：我在周末练习陶艺。','1')
 const {entry}=await f.remember(source,{topic:'pottery'})
 const requestId=randomUUID()
 f.dependencies.dataRequest=async id=>{
  if(id!==requestId)throw new MemoryError(404,'NOT_FOUND','Missing synthetic export request')
  return {requestId,accountId:a.id,kind:'export',scope:'account_data',status:'processing',accountStatus:'active',accountAccessVersion:1}
 }
 f.accounts.get(a.id).aiTextProcessing={allowed:false,authorizationVersion:2}
 assert.deepEqual(await f.automatic.context(a.id,a.person.id,''),[])
 const rights=new MemoryDataRights(f.pool,f.dependencies),first=await rights.export(a.id,requestId,'account_data')
 const visible=first.data.automaticMemories.find(value=>value.id===entry.id)
 assert.equal(visible.sourceAvailable,true)
 assert.equal(visible.body,source.text)
 assert.equal(visible.evidence,source.text)
 // Source deletion deliberately has not reached the Memories event consumer.
 f.messages.delete(source.id);f.sources.delete(source.id)
 assert.equal((await f.pool.query('SELECT state FROM automatic_memory_entries WHERE id=$1',[entry.id])).rows[0].state,'active')
 const next=await rights.export(a.id,requestId,'account_data'),unavailable=next.data.automaticMemories.find(value=>value.id===entry.id)
 assert.equal(unavailable.sourceAvailable,false)
 for(const field of ['body','evidence','topic','timeDescription'])assert.equal(Object.hasOwn(unavailable,field),false,field)
 assert.notEqual(first.revision,next.revision)
 assert.equal(JSON.stringify(next).includes(source.text),false)
})

test('an older AI permission with a missing or false automatic-memory capability never admits, reads or executes automatic work',async t=>{
 for(const capability of ['missing','false']){
  await t.test(capability,async subtest=>{
   const f=await automaticFixture(subtest),a=f.account()
   const saved=await f.remember(f.source(a,'合成资料：我喜欢在家读书。','1'),{topic:'reading'})
   const pending=f.source(a,'合成资料：我准备下周学习烹饪。','2'),accepted=await f.automatic.ingest('conversations',f.event(pending)),job=await f.automatic.findJob(accepted.jobId)
   const grant=f.accounts.get(a.id).aiTextProcessing
   assert.equal(grant.allowed,true)
   if(capability==='missing')delete grant.automaticMemoryAllowed
   else grant.automaticMemoryAllowed=false
   // The authorization version deliberately stays unchanged: the capability itself must be checked.
   assert.deepEqual(await f.automatic.context(a.id,a.person.id,''),[])
   assert.equal(await f.automatic.validate(a.id,a.person.id,[{id:saved.entry.id,version:saved.entry.version}]),false)
   const deliveries=f.deliveries.length
   let rejected
   try{await f.automatic.ingest('conversations',f.event(f.source(a,'这条旧用途许可下的合成消息不得自动整理。','3')))}catch(error){rejected=error}
   if(rejected)assert.equal(rejected.code,'AI_PERMISSION_REQUIRED')
   let profileRejected
   try{await f.automatic.ingest('people',{eventId:randomUUID(),accountId:a.id,personId:a.person.id,sourceKind:'profile',sourceId:a.person.id,sourceVersion:a.person.version,change:'upsert',occurredAt:fixedTime})}catch(error){profileRejected=error}
   if(profileRejected)assert.equal(profileRejected.code,'AI_PERMISSION_REQUIRED')
   assert.equal(f.deliveries.length,deliveries)
   assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM automatic_memory_jobs WHERE account_id=$1',[a.id])).rows[0].n,2)
   let calls=0
   await new AutomaticMemoryEngine(f.automatic,{async generate(){calls++;return {facts:[]}}}).run(dispatch(job))
   assert.equal(calls,0,'The provider is never entered using an old policy capability')
   assert.equal((await f.automatic.findJob(job.id)).state,'blocked')
   assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM automatic_memory_entries WHERE account_id=$1',[a.id])).rows[0].n,1)
  })
 }
})

test('removing the automatic-memory capability while generation is in flight prevents its result and never revives that dispatch',async t=>{
 const f=await automaticFixture(t),a=f.account(),source=f.source(a,'合成资料：我准备周日去逛书店。','1')
 const accepted=await f.automatic.ingest('conversations',f.event(source)),job=await f.automatic.findJob(accepted.jobId)
 let entered,release,calls=0
 const started=new Promise(resolve=>entered=resolve),barrier=new Promise(resolve=>release=resolve)
 const engine=new AutomaticMemoryEngine(f.automatic,{async generate(){calls++;entered();await barrier;return {facts:[{body:source.text,evidence:source.text,topic:'bookshop',timeDescription:'',supersedes:[]}]}}})
 const running=engine.run(dispatch(job))
 await started
 f.accounts.get(a.id).aiTextProcessing.automaticMemoryAllowed=false
 release();await running
 assert.equal((await f.automatic.findJob(job.id)).state,'blocked')
 assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM automatic_memory_entries WHERE account_id=$1',[a.id])).rows[0].n,0)
 f.accounts.get(a.id).aiTextProcessing.automaticMemoryAllowed=true
 await engine.run(dispatch(job))
 assert.equal(calls,1)
 assert.equal((await f.automatic.findJob(job.id)).state,'blocked')
})

test('account erasure removes an in-flight automatic result and every owned dispatch without touching another account',async t=>{
 const f=await automaticFixture(t),a=f.account(),b=f.account(),queueSchema='auto_audit_queue_'+randomUUID().replaceAll('-','')
 const queue=await new CandidateQueue(f.connectionString,queueSchema).start()
 t.after(async()=>{await queue.stop();const admin=new pg.Pool({connectionString:f.connectionString});try{await admin.query('DROP SCHEMA '+queueSchema+' CASCADE')}finally{await admin.end()}})
 const preserved=await f.remember(f.source(b,'合成资料：周末喜欢整理照片。','1'),{topic:'photos'})
 const source=f.source(a,'合成资料：我准备周六去植物园。','1'),accepted=await f.automatic.ingest('conversations',f.event(source)),job=await f.automatic.findJob(accepted.jobId)
 const connection=await f.pool.connect()
 try{await queue.send(connection,dispatch(job));await queue.send(connection,dispatch(preserved.job))}finally{connection.release()}
 let enter,release
 const started=new Promise(resolve=>enter=resolve),barrier=new Promise(resolve=>release=resolve)
 const running=new AutomaticMemoryEngine(f.automatic,{async generate(){enter();await barrier;return {facts:[{body:source.text,evidence:source.text,topic:'garden visit',timeDescription:'',supersedes:[]}]}}}).run(dispatch(job))
 await started
 const requestId=randomUUID()
 f.dependencies.dataRequest=async id=>{
  if(id!==requestId)throw new MemoryError(404,'NOT_FOUND','Missing synthetic request')
  return {requestId,accountId:a.id,kind:'delete_account',scope:'account_data',status:'processing',accountStatus:'deletion_pending',accountAccessVersion:2}
 }
 let eraseError
 try{await new MemoryDataRights(f.pool,f.dependencies,queueSchema).erase(a.id,requestId)}catch(error){eraseError=error}finally{release()}
 await running
 if(eraseError)throw eraseError
 await f.assertNoAutomaticRows(a.id)
 assert.equal(await f.automatic.findJob(job.id),undefined)
 assert.equal((await f.automatic.context(b.id,b.person.id,'')).some(value=>value.id===preserved.entry.id),true)
 assert.equal((await queue.boss.findJobs('memory.suggest.v1',{data:{jobId:job.id},limit:20})).length,0)
 assert.equal((await queue.boss.findJobs('memory.suggest.v1',{data:{jobId:preserved.job.id},limit:20})).length,1)
 await assert.rejects(()=>f.automatic.ingest('conversations',f.event(source)),error=>error.code==='42501'||error.status===404)
 await f.assertNoAutomaticRows(a.id)
})
