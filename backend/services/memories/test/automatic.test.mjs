import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {test} from 'node:test'
import {fixture} from './automatic-fixture.mjs'
import {MemoryError} from '../dist/contracts.js'
import {AutomaticMemoryStore} from '../dist/automatic-store.js'
import {AutomaticMemoryEngine} from '../dist/automatic-engine.js'

const dispatch=job=>({jobId:job.id,dispatchId:job.dispatch_id,dispatchGeneration:job.dispatch_generation})
async function setup(t){
 const f=await fixture(t),messages=new Map(),sent=[]
 f.dependencies.automaticMessage=async(aid,id)=>{const value=messages.get(id);if(!value||value.accountId!==aid)throw new MemoryError(404,'NOT_FOUND','Missing');return structuredClone(value)}
 f.dependencies.validAutomaticRefs=async(aid,pid,refs)=>refs.filter(ref=>{const value=messages.get(ref.id);return value&&value.accountId===aid&&value.personId===pid&&value.version===ref.version})
 f.dependencies.sourceEvents=async()=>[];f.dependencies.ackSourceEvent=async()=>{}
 const store=new AutomaticMemoryStore(f.pool,f.dependencies,{async send(_db,value){sent.push(value)}})
 function message(a,text='我最喜欢蓝色。',sequence='9007199254740993',context=[]){const value={id:randomUUID(),accountId:a.id,personId:a.person.id,conversationId:randomUUID(),text,version:1,createdAt:'2026-11-12T01:00:00.000Z',sequence,aiAuthorizationVersion:1,context};messages.set(value.id,value);return value}
 const event=(a,m,change='upsert')=>({eventId:randomUUID(),accountId:a.id,personId:a.person.id,sourceKind:'message',sourceId:m.id,sourceVersion:m.version,change,occurredAt:m.createdAt})
 const fact=(body,evidence=body,supersedes=[])=>({body,topic:'偏好',timeDescription:'',evidence,supersedes})
 return {...f,store,messages,sent,message,event,fact}
}

test('automatic memories persist and re-read without a confirmed original, duplicate extraction or referral event',async t=>{
 const f=await setup(t),a=f.account(),m=f.message(a),e=f.event(a,m)
 const accepted=await Promise.all(Array.from({length:4},()=>f.store.ingest('conversations',e)))
 assert.equal((await f.pool.query('SELECT count(*) FROM automatic_memory_jobs')).rows[0].count,'1');assert.equal(f.sent.length,1)
 const job=await f.store.findJob(accepted.find(value=>value.jobId).jobId)
 await new AutomaticMemoryEngine(f.store,{async generate(){return {facts:[f.fact(m.text)]}}}).run(dispatch(job))
 const context=await new AutomaticMemoryStore(f.pool,f.dependencies).context(a.id,a.person.id,'蓝色')
 assert.equal(context.length,1);assert.equal(context[0].sourceKind,'message');assert.equal(context[0].body,m.text);assert.equal(context[0].sourceSequence,'9007199254740993')
 assert.equal(await f.store.validate(a.id,a.person.id,context.map(({id,version})=>({id,version}))),true)
 for(const table of ['memories','memory_account_cursors','outbox_events'])assert.equal((await f.pool.query('SELECT count(*) FROM '+table)).rows[0].count,'0',table)
 const replay=await f.store.ingest('conversations',{...e,eventId:randomUUID()});assert.equal(replay.jobId,job.id);assert.equal(f.sent.length,1)
 const b=f.account();assert.equal((await f.store.context(b.id,b.person.id,'')).length,0)
 await assert.rejects(f.store.context(b.id,a.person.id,''),{status:404})
 f.accounts.get(a.id).aiTextProcessing={allowed:false,authorizationVersion:2};assert.equal((await f.store.context(a.id,a.person.id,'')).length,0)
 f.accounts.get(a.id).aiTextProcessing={allowed:true,authorizationVersion:3,automaticMemoryAllowed:true};assert.equal((await f.store.context(a.id,a.person.id,'')).length,0)
})

test('profile revisions are independent automatic sources and invalidate older facts without changing originals',async t=>{
 const f=await setup(t),a=f.account(),e={eventId:randomUUID(),accountId:a.id,personId:a.person.id,sourceKind:'profile',sourceId:a.person.id,sourceVersion:1,change:'upsert',occurredAt:'2026-11-12T01:00:00.000Z'}
 const accepted=await f.store.ingest('people',e),job=await f.store.findJob(accepted.jobId)
 await new AutomaticMemoryEngine(f.store,{async generate(){return {facts:[f.fact('我们在杭州生活。','我们在杭州生活。')]}}}).run(dispatch(job))
 let context=await f.store.context(a.id,a.person.id,'');assert.equal(context.length,1);assert.equal(context[0].sourceKind,'profile');assert.equal(context[0].reality,'user_provided_profile')
 const person=f.people.get(a.person.id);person.version=2;person.story='我们现在住在苏州。'
 assert.equal((await f.store.context(a.id,a.person.id,'')).length,0,'live authoritative profile version already excludes stale output')
 const next=await f.store.ingest('people',{...e,eventId:randomUUID(),sourceVersion:2,occurredAt:'2026-11-12T02:00:00.000Z'})
 await new AutomaticMemoryEngine(f.store,{async generate(){return {facts:[f.fact('我们现在住在苏州。')]}}}).run(dispatch(await f.store.findJob(next.jobId)))
 context=await f.store.context(a.id,a.person.id,'');assert.equal(context.length,1);assert.match(context[0].body,/苏州/)
 await f.store.ingest('people',{...e,eventId:randomUUID()})
 assert.equal((await f.pool.query('SELECT source_version FROM automatic_memory_sources')).rows[0].source_version,2)
})

test('ineligible message events reach durable terminal receipts and never borrow a newer AI permission',async t=>{
 const f=await setup(t),a=f.account(),m=f.message(a);m.aiAuthorizationVersion=0
 const first=await f.store.ingest('conversations',f.event(a,m));assert.equal(first.jobId,undefined)
 f.accounts.get(a.id).aiTextProcessing={allowed:false,authorizationVersion:2}
 const second=await f.store.ingest('conversations',f.event(a,f.message(a)));assert.equal(second.jobId,undefined)
 assert.deepEqual((await f.pool.query('SELECT outcome FROM automatic_memory_receipts')).rows.map(row=>row.outcome),['ineligible','ineligible'])
 assert.equal(f.sent.length,0)
 f.accounts.get(a.id).aiTextProcessing={allowed:false,authorizationVersion:0}
 const profile={eventId:randomUUID(),accountId:a.id,personId:a.person.id,sourceKind:'profile',sourceId:a.person.id,sourceVersion:1,change:'upsert',occurredAt:new Date().toISOString()}
 await assert.rejects(f.store.ingest('people',profile),{code:'AI_PERMISSION_REQUIRED'})
 assert.equal((await f.pool.query('SELECT count(*) FROM automatic_memory_receipts')).rows[0].count,'2')
})

test('AI revocation, authorization ABA and source deletion during a model call prevent automatic output',async t=>{
 const f=await setup(t),a=f.account()
 for(const scenario of ['revoked','regranted','removed']){
  f.accounts.get(a.id).aiTextProcessing={allowed:true,authorizationVersion:1,automaticMemoryAllowed:true}
  const m=f.message(a),accepted=await f.store.ingest('conversations',f.event(a,m)),job=await f.store.findJob(accepted.jobId)
  await new AutomaticMemoryEngine(f.store,{async generate(){
   if(scenario==='removed')f.messages.delete(m.id)
   else f.accounts.get(a.id).aiTextProcessing={allowed:scenario==='regranted',authorizationVersion:scenario==='regranted'?3:2,automaticMemoryAllowed:scenario==='regranted'}
   return {facts:[f.fact(m.text)]}
  }}).run(dispatch(job))
  assert.equal((await f.store.findJob(job.id)).state,'blocked',scenario)
 }
 assert.equal((await f.pool.query('SELECT count(*) FROM automatic_memory_entries')).rows[0].count,'0')
})

test('empty evidence succeeds without invented memory, while persona-only evidence is rejected',async t=>{
 const f=await setup(t),a=f.account(),first=f.message(a,'你好。'),accepted=await f.store.ingest('conversations',f.event(a,first))
 await new AutomaticMemoryEngine(f.store,{async generate(){return {facts:[]}}}).run(dispatch(await f.store.findJob(accepted.jobId)))
 assert.equal((await f.store.findJob(accepted.jobId)).state,'succeeded')
 const second=f.message(a,'今天好吗？','9007199254740994'),next=await f.store.ingest('conversations',f.event(a,second))
 await new AutomaticMemoryEngine(f.store,{async generate(){return {facts:[f.fact('我住在月球。','我住在月球。')]}}}).run(dispatch(await f.store.findJob(next.jobId)))
 assert.equal((await f.store.findJob(next.jobId)).failure_code,'MODEL_INVALID_OUTPUT')
 assert.equal((await f.pool.query('SELECT count(*) FROM automatic_memory_entries')).rows[0].count,'0')
})

test('queue failure rolls back source and receipt, and a person can run only one extraction at a time',async t=>{
 const f=await setup(t),a=f.account(),m=f.message(a),e=f.event(a,m),broken=new AutomaticMemoryStore(f.pool,f.dependencies,{async send(){throw new Error('queue unavailable')}})
 await assert.rejects(broken.ingest('conversations',e),/queue unavailable/)
 for(const table of ['automatic_memory_receipts','automatic_memory_sources','automatic_memory_jobs'])assert.equal((await f.pool.query('SELECT count(*) FROM '+table)).rows[0].count,'0')
 const first=await f.store.ingest('conversations',e),second=await f.store.ingest('conversations',f.event(a,f.message(a,'喜欢绿色。','9007199254740994')))
 const claims=await Promise.all([first,second].map(async value=>f.store.claim(dispatch(await f.store.findJob(value.jobId)))))
 assert.equal(claims.filter(Boolean).length,1)
 const running=claims.find(Boolean);await f.store.release(running)
 assert.equal((await f.pool.query("SELECT count(*) FROM automatic_memory_jobs WHERE state='running'")).rows[0].count,'0')
})

test('legacy AI text permission never authorizes automatic collection, use, or model disclosure',async t=>{
 const f=await setup(t),a=f.account(),m=f.message(a),accepted=await f.store.ingest('conversations',f.event(a,m))
 await new AutomaticMemoryEngine(f.store,{async generate(){return {facts:[f.fact(m.text)]}}}).run(dispatch(await f.store.findJob(accepted.jobId)))
 const refs=(await f.store.context(a.id,a.person.id,'')).map(({id,version})=>({id,version}))
 assert.equal(refs.length,1)
 for(const marker of [undefined,false]){
  f.accounts.get(a.id).aiTextProcessing={allowed:true,authorizationVersion:1,automaticMemoryAllowed:true}
  const pending=f.message(a,'我喜欢种花。',marker===undefined?'9007199254740994':'9007199254740995')
  const queued=await f.store.ingest('conversations',f.event(a,pending))
  f.accounts.get(a.id).aiTextProcessing={allowed:true,authorizationVersion:1,...(marker===undefined?{}:{automaticMemoryAllowed:marker})}
  assert.equal((await f.store.context(a.id,a.person.id,'')).length,0)
  assert.equal(await f.store.validate(a.id,a.person.id,refs),false)
  let calls=0
  await new AutomaticMemoryEngine(f.store,{async generate(){calls++;return {facts:[f.fact(pending.text)]}}}).run(dispatch(await f.store.findJob(queued.jobId)))
  assert.equal(calls,0);assert.equal((await f.store.findJob(queued.jobId)).state,'blocked')
  const before=f.sent.length,newMessage=f.message(a,'我喜欢月亮。',marker===undefined?'9007199254740996':'9007199254740997')
  assert.equal((await f.store.ingest('conversations',f.event(a,newMessage))).jobId,undefined);assert.equal(f.sent.length,before)
 }
 assert.equal((await f.pool.query('SELECT count(*) FROM automatic_memory_entries')).rows[0].count,'1')
})
