import {test} from 'node:test'
import assert from 'node:assert/strict'
import {capture,compareSnapshots,quarantine} from './policy.mjs'
const target={domain:'conversations',kind:'target',runId:'world-action-unit'}
const marker='PRIVATE_WORLD_EVENT_AND_REPLY_BODY'
function fixture(){return{
 conversations:[{id:'conversation',account_id:'owner',kind:'direct',world_event_revision:'9007199254740993'}],
 messages:[{id:'source',account_id:'owner',text:marker,source_domain:'virtual_action'},{id:'reply',account_id:'owner',text:marker,source_domain:'virtual_action'}],
 person_world_events:[{id:'event',account_id:'owner',job_id:'succeeded',world_id:'world',world_version:1,sequence:'9007199254740993',version:1,reality:'virtual',branch:'main',request_quote:marker,summary:marker,memory:marker,removed_at:null}],
 conversation_commands:[{account_id:'owner',operation:'send',target:'conversation',response:{generationJobId:'succeeded',message:{id:'source',text:marker}}}],
 outbox_events:[{account_id:'owner',type:'WorldActionCommitted.v1',aggregate_type:'person_world_event',aggregate_id:'event',aggregate_version:1}],
 generation_jobs:['queued','running','failed','succeeded','blocked','canceled'].map(state=>({id:state,account_id:'owner',source_message_id:'source',state,version:3,attempt_id:state==='running'?'attempt':null,attempt_count:2,lease_until:state==='running'?'lease':null,retryable:state==='failed',updated_at:'before',
  world_action_authorization_version:7,world_action_decision:state==='succeeded'?'execute':'pending',world_event_context_refs:state==='succeeded'?[{id:'prior-event',version:1,worldVersion:1}]:[],world_action_message_refs:state==='succeeded'?[{id:'source',version:1}]:[],world_event_revision:state==='succeeded'?'9007199254740992':null,world_action_provenance:state==='succeeded'?{model:'actual-model',responseId:'actual-response',promptVersion:'person-world-actions-v1'}:null,world_context_ref:state==='succeeded'?{worldId:'world',worldVersion:1}:null,memory_context_refs:state==='succeeded'?[{kind:'automatic',id:'memory',version:2}]:[]})),
}}
function runtime(rows,{damage,skip=false}={}){return{
 async query(_target,sql){
  if(sql.includes('SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind'))return Object.keys(rows).map(name=>({schema:'public',name,kind:'r'}))
  if(sql.includes('AS records'))return Object.entries(rows).map(([name,data])=>({name:'public.'+name,records:data.map(row=>JSON.stringify(row))}))
  if(sql.includes('AS executable_jobs'))return[{executable_jobs:String(rows.generation_jobs.filter(j=>['queued','running'].includes(j.state)||j.state==='failed'&&j.retryable).length)}]
  return[]
 },
 async sql(_target,sql){
  assert.match(sql,/UPDATE public\.generation_jobs SET state='blocked'/)
  assert.match(sql,/WHERE state IN \('queued','running','failed'\)/)
  assert.doesNotMatch(sql,/(?:DELETE|INSERT)\s|UPDATE public\.(?:person_world_events|messages|conversations|conversation_commands)\s/)
  if(skip)return
  for(const row of rows.generation_jobs)if(['queued','running','failed'].includes(row.state))Object.assign(row,{state:'blocked',lease_until:null,attempt_id:null,failure_code:'RESTORE_REVIEW_REQUIRED',retryable:false,version:row.version+1,updated_at:'restored'})
  if(damage)damage(rows)
 },
}}
const provenance=s=>s.core.find(row=>row.name==='public.generation_jobs:provenance').digest

test('world-action quarantine changes only admission controls and retains exact formal events, budgets, replies and permanent receipts',async()=>{
 const rows=fixture(),original=structuredClone(rows),rt=runtime(rows),before=await capture(rt,target),proof=await quarantine(rt,target),after=await capture(rt,target)
 assert.equal(proof.assertions.noExecutableGeneration,true);assert.deepEqual(before.core,after.core)
 for(const table of ['person_world_events','conversations','messages','conversation_commands','outbox_events'])assert.deepEqual(rows[table],original[table])
 for(const state of ['succeeded','blocked','canceled'])assert.deepEqual(rows.generation_jobs.find(j=>j.id===state),original.generation_jobs.find(j=>j.id===state))
 for(const state of ['queued','running','failed']){const j=rows.generation_jobs.find(j=>j.id===state);assert.equal(j.attempt_count,2);assert.equal(j.world_action_authorization_version,7);assert.equal(j.world_action_decision,'pending');assert.equal(j.attempt_id,null);assert.equal(j.lease_until,null)}
 const resource=before.security.resources.find(r=>r.kind==='person_world_event');assert.equal(resource.id,'event');assert.equal(resource.version,1);assert.equal(resource.state,'recorded')
 assert(!JSON.stringify({before,after,proof}).includes(marker));assert(!JSON.stringify({before,after,proof}).includes('actual-response'))
})

test('all-state action provenance changes are detected even when quarantine is allowed to block the task',async()=>{
 const rows=fixture(),before=await capture(runtime(rows),target)
 for(const [field,value]of [['world_action_authorization_version',8],['world_action_decision','chat'],['world_event_context_refs',[{id:'other',version:1}]],['world_action_message_refs',[{id:'source',version:2}]],['world_event_revision','9007199254740994'],['world_action_provenance',{model:'different'}],['attempt_count',3],['memory_context_refs',[{id:'foreign-memory',version:1}]],['world_context_ref',{worldVersion:2}]]){
  const changed=structuredClone(rows);changed.generation_jobs[0][field]=value
  assert.notEqual(provenance(before),provenance(await capture(runtime(changed),target)),field)
  await assert.rejects(quarantine(runtime(fixture(),{damage:x=>x.generation_jobs[0][field]=value}),target),/preserved business content/)
 }
 await assert.rejects(quarantine(runtime(fixture(),{skip:true}),target),/assertions failed/)
})

test('formal event mutations and deletion status remain visible in recovery resource identity without private content in reports',async()=>{
 const before=await capture(runtime(fixture()),target)
 for(const change of [x=>x.person_world_events[0].summary='different',x=>x.person_world_events[0].world_version=2,x=>x.person_world_events[0].removed_at='now',x=>x.person_world_events=[]]){
  const rows=fixture();change(rows);const after=await capture(runtime(rows),target),diff=compareSnapshots(before,after)
  assert.equal(diff.equal,false);assert(diff.differences.some(d=>d.resourceKind==='person_world_event'&&d.id==='event'));assert(!JSON.stringify(diff).includes(marker))
 }
 const rows=fixture();rows.person_world_events[0].removed_at='now'
 assert.equal((await capture(runtime(rows),target)).security.resources.find(r=>r.kind==='person_world_event').state,'removed')
})
