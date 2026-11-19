import{test}from'node:test'
import assert from'node:assert/strict'
import{capture,compareSnapshots,quarantine}from'./policy.mjs'
const target={domain:'conversations',kind:'target',runId:'letter-unit'}
const privateText='PRIVATE_LETTER_NEVER_IN_REPORT'
function fixture(){return{conversations:[],messages:[],generation_jobs:[],letters:[{id:'letter',account_id:'owner',person_id:'person',body:privateText,reply_at:'fixed-time',version:1}],letter_replies:[{id:'reply',account_id:'owner',person_id:'person',letter_id:'letter',body:privateText}],letter_read_cursors:[{account_id:'owner',person_id:'person',last_sequence:'1',last_read_sequence:'1'}],letter_reply_jobs:['queued','running','failed','succeeded','blocked','canceled'].map((state,i)=>({id:state,account_id:'owner',person_id:'person',letter_id:'letter',state,version:1,attempt_count:i%3,attempt_id:state==='running'?'attempt':null,lease_until:state==='running'?'lease':null,scheduled_at:'fixed-time',next_attempt_at:'fixed-retry',person_context_ref:{story:privateText},world_context_ref:{revision:'revision'},provider_provenance:state==='succeeded'?{model:'model'}:null,updated_at:'before',retryable:state==='failed',failure_code:state==='failed'?'TEMPORARY':null}))}}
function runtime(rows,{damage=false,skip=false}={}){return{
 async query(_target,sql){
  if(sql.includes('SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind'))return Object.keys(rows).map(name=>({schema:'public',name,kind:'r'}))
  if(sql.includes('AS records'))return Object.entries(rows).map(([name,data])=>({name:'public.'+name,records:data.map(x=>JSON.stringify(x))}))
  if(sql.includes('AS executable_letter_jobs'))return[{executable_letter_jobs:String(rows.letter_reply_jobs.filter(j=>['queued','running','failed'].includes(j.state)||j.attempt_id!=null||j.lease_until!=null).length)}]
  if(sql.includes('AS executable_jobs'))return[{executable_jobs:'0'}]
  return[]
 },
 async sql(_target,sql){
  assert.match(sql,/UPDATE public\.letter_reply_jobs SET state='blocked'/)
  assert.doesNotMatch(sql,/(?:DELETE|INSERT)\s|UPDATE public\.(?:letters|letter_replies|letter_read_cursors)\s/)
  if(skip)return
  for(const job of rows.letter_reply_jobs)if(['queued','running','failed'].includes(job.state))Object.assign(job,{state:'blocked',lease_until:null,attempt_id:null,failure_code:'RESTORE_REVIEW_REQUIRED',retryable:false,version:job.version+1,updated_at:'restored'})
  if(damage)rows.letter_reply_jobs[0].scheduled_at='moved'
 }
}}
test('letter quarantine blocks all dispatches while retaining content, schedule, provenance and successful results',async()=>{
 const rows=fixture(),original=structuredClone(rows),rt=runtime(rows),before=await capture(rt,target),proof=await quarantine(rt,target),after=await capture(rt,target)
 assert.equal(proof.assertions.letterJobsBlocked,true);assert.equal(proof.assertions.coreContentUnchanged,true);assert.deepEqual(before.core,after.core)
 for(const table of ['letters','letter_replies','letter_read_cursors'])assert.deepEqual(rows[table],original[table])
 for(const state of ['succeeded','blocked','canceled'])assert.deepEqual(rows.letter_reply_jobs.find(j=>j.id===state),original.letter_reply_jobs.find(j=>j.id===state))
 assert.equal(before.security.resources.find(r=>r.kind==='letter_read_cursor').id,'person')
 assert.equal(JSON.stringify({before,after,proof}).includes(privateText),false)
 for(const state of ['queued','running','failed'])assert.equal(rows.letter_reply_jobs.find(j=>j.id===state).state,'blocked')
})
test('letter quarantine rejects partial schemas, altered schedules and a worker claim left executable',async()=>{
 const partial=fixture();delete partial.letter_replies
 await assert.rejects(()=>quarantine(runtime(partial),target),/missing/)
 await assert.rejects(()=>quarantine(runtime(fixture(),{damage:true}),target),/preserved business content/)
 await assert.rejects(()=>quarantine(runtime(fixture(),{skip:true}),target),/assertions failed/)
})
test('letter source, read position, schedule and provenance changes are visible to authenticated checkpoints',async()=>{
 const original=fixture(),before=await capture(runtime(original),target)
 for(const mutate of [x=>x.letters[0].body='changed',x=>x.letter_read_cursors[0].last_read_sequence='0',x=>x.letter_reply_jobs[0].scheduled_at='changed',x=>x.letter_reply_jobs[0].person_context_ref.story='changed']){
  const changed=structuredClone(original);mutate(changed);assert.equal(compareSnapshots(before,await capture(runtime(changed),target)).equal,false)
 }
})
