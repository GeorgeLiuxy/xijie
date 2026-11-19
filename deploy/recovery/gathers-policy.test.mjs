import{test}from'node:test'
import assert from'node:assert/strict'
import{capture,compareSnapshots,quarantine}from'./policy.mjs'
const target={domain:'conversations',kind:'target',runId:'gather-unit'},privateText='PRIVATE_GATHER_EXCLUDED_FROM_REPORT'
function fixture(){return{conversations:[{id:'room',account_id:'owner',kind:'gather',world_id:'world'}],messages:[{id:'source',account_id:'owner',text:privateText}],generation_jobs:[],gather_reply_participants:[{account_id:'owner',job_id:'running',person_id:'person',position:1}],gather_reply_jobs:['queued','running','failed','succeeded','blocked','canceled'].map(state=>({id:state,account_id:'owner',state,version:1,source_message_id:'source',source_version:1,roster_revision:'a'.repeat(64),eligible_count:2,updated_at:'before'})),gather_reply_slots:['queued','running','failed','succeeded','blocked','canceled'].map(state=>({account_id:'owner',job_id:state,person_id:'person',state,version:1,attempt_count:1,attempt_id:state==='running'?'attempt':null,lease_until:state==='running'?'lease':null,next_attempt_at:'fixed-retry',person_context_ref:{version:1},memory_context_refs:[{id:'memory',personId:'person',version:1}],provider_provenance:state==='succeeded'?{model:'model'}:null,updated_at:'before',retryable:state==='failed',failure_code:state==='failed'?'TEMPORARY':null}))}}
function runtime(rows,{damage=false,skip=false}={}){return{
 async query(_target,sql){
  if(sql.includes('SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind'))return Object.keys(rows).map(name=>({schema:'public',name,kind:'r'}))
  if(sql.includes('AS records'))return Object.entries(rows).map(([name,data])=>({name:'public.'+name,records:data.map(x=>JSON.stringify(x))}))
  if(sql.includes('AS executable_gather_jobs'))return[{executable_gather_jobs:String(rows.gather_reply_jobs.filter(j=>['queued','running','failed'].includes(j.state)).length+rows.gather_reply_slots.filter(j=>['queued','running','failed'].includes(j.state)||j.attempt_id!=null||j.lease_until!=null).length)}]
  if(sql.includes('AS executable_jobs'))return[{executable_jobs:'0'}]
  return[]
 },
 async sql(_target,sql){
  assert.match(sql,/UPDATE public\.gather_reply_slots SET state='blocked'/)
  assert.doesNotMatch(sql,/(?:DELETE|INSERT)\s|UPDATE public\.(?:messages|conversations|gather_reply_participants)\s/)
  if(skip)return
  for(const slot of rows.gather_reply_slots)if(['queued','running','failed'].includes(slot.state))Object.assign(slot,{state:'blocked',lease_until:null,attempt_id:null,failure_code:'RESTORE_REVIEW_REQUIRED',retryable:false,version:slot.version+1,updated_at:'restored'})
  for(const job of rows.gather_reply_jobs)if(['queued','running','failed'].includes(job.state))Object.assign(job,{state:'blocked',version:job.version+1,updated_at:'restored'})
  if(damage)rows.gather_reply_slots[0].attempt_count++
 }
}}
test('gather quarantine retains fixed participants, content, source refs, budgets and all successful replies',async()=>{
 const rows=fixture(),original=structuredClone(rows),rt=runtime(rows),before=await capture(rt,target),proof=await quarantine(rt,target),after=await capture(rt,target)
 assert.equal(proof.assertions.gatherJobsBlocked,true);assert.equal(proof.assertions.coreContentUnchanged,true);assert.deepEqual(before.core,after.core)
 for(const name of ['conversations','messages','gather_reply_participants'])assert.deepEqual(rows[name],original[name])
 for(const name of ['gather_reply_jobs','gather_reply_slots'])for(const state of ['succeeded','blocked','canceled'])assert.deepEqual(rows[name].find(j=>(j.id??j.job_id)===state),original[name].find(j=>(j.id??j.job_id)===state))
 assert.equal(before.security.resources.find(r=>r.kind==='gather_participant').id,'running:person')
 assert.equal(JSON.stringify({before,after,proof}).includes(privateText),false)
})
test('gather quarantine rejects half schemas, changed attempt budgets and executable claims',async()=>{
 const partial=fixture();delete partial.gather_reply_participants
 await assert.rejects(()=>quarantine(runtime(partial),target),/missing/)
 await assert.rejects(()=>quarantine(runtime(fixture(),{damage:true}),target),/preserved business content/)
 await assert.rejects(()=>quarantine(runtime(fixture(),{skip:true}),target),/assertions failed/)
})
test('gather checkpoints detect changed source text, roster, memory ownership and accepted authorization',async()=>{
 const rows=fixture(),before=await capture(runtime(rows),target)
 for(const mutate of [x=>x.messages[0].text='changed',x=>x.gather_reply_participants[0].person_id='other',x=>x.gather_reply_slots[0].memory_context_refs[0].personId='other',x=>x.gather_reply_jobs[0].gather_authorization_version=999]){
  const changed=structuredClone(rows);mutate(changed);assert.equal(compareSnapshots(before,await capture(runtime(changed),target)).equal,false)
 }
})
