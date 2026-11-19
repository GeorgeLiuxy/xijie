import{test}from'node:test'
import assert from'node:assert/strict'
import{capture,compareSnapshots,quarantine}from'./policy.mjs'
const target={domain:'conversations',kind:'target',runId:'photo-unit'},privateText='PRIVATE_VISUAL_RESPONSE'
function fixture(){return{conversations:[{id:'c'}],messages:[{id:'source',kind:'photo'},{id:'reply',text:privateText}],generation_jobs:[],message_media:[{account_id:'owner',message_id:'source',media_id:'media',media_version:4,width:20}],photo_reply_jobs:['queued','running','failed','succeeded','blocked','canceled'].map(state=>({id:state,account_id:'owner',source_message_id:'source',source_version:1,media_id:'media',media_version:4,photo_authorization_version:2,image_authorization_version:3,state,version:1,attempt_count:1,attempt_id:state==='running'?'attempt':null,lease_until:state==='running'?'lease':null,next_attempt_at:'fixed',person_context_ref:{version:1},provider_provenance:state==='succeeded'?{model:'verified'}:null,updated_at:'before',retryable:state==='failed'}))}}
function runtime(rows,{damage=false,skip=false}={}){return{
 async query(_target,sql){
  if(sql.includes('SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind'))return Object.keys(rows).map(name=>({schema:'public',name,kind:'r'}))
  if(sql.includes('AS records'))return Object.entries(rows).map(([name,data])=>({name:'public.'+name,records:data.map(x=>JSON.stringify(x))}))
  if(sql.includes('AS executable_photo_jobs'))return[{executable_photo_jobs:String(rows.photo_reply_jobs.filter(j=>['queued','running','failed'].includes(j.state)||j.attempt_id||j.lease_until).length)}]
  if(sql.includes('AS executable_jobs'))return[{executable_jobs:'0'}]
  return[]
 },
 async sql(_target,sql){
  assert.match(sql,/UPDATE public\.photo_reply_jobs SET state='blocked'/);assert.doesNotMatch(sql,/(?:DELETE|INSERT)\s|UPDATE public\.(?:messages|message_media|conversations)\s/)
  if(skip)return
  for(const row of rows.photo_reply_jobs)if(['queued','running','failed'].includes(row.state))Object.assign(row,{state:'blocked',attempt_id:null,lease_until:null,failure_code:'RESTORE_REVIEW_REQUIRED',retryable:false,version:row.version+1,updated_at:'restored'})
  if(damage)rows.photo_reply_jobs[0].attempt_count++
 }
}}
test('photo restore quarantines executable attempts, retains exact accepted sources, budgets and successful visual replies',async()=>{
 const rows=fixture(),original=structuredClone(rows),rt=runtime(rows),before=await capture(rt,target),proof=await quarantine(rt,target),after=await capture(rt,target)
 assert.equal(proof.assertions.photoJobsBlocked,true);assert.deepEqual(before.core,after.core)
 for(const table of ['message_media','messages','conversations'])assert.deepEqual(rows[table],original[table])
 for(const state of ['succeeded','blocked','canceled'])assert.deepEqual(rows.photo_reply_jobs.find(j=>j.id===state),original.photo_reply_jobs.find(j=>j.id===state))
 assert.equal(before.security.resources.find(r=>r.kind==='message_media').id,'source');assert(!JSON.stringify({before,after,proof}).includes(privateText))
})
test('photo restore rejects incomplete schema, changed provenance or budgets, and remaining executable work',async()=>{
 const partial=fixture();delete partial.message_media;await assert.rejects(quarantine(runtime(partial),target),/missing/)
 await assert.rejects(quarantine(runtime(fixture(),{damage:true}),target),/preserved business content/)
 await assert.rejects(quarantine(runtime(fixture(),{skip:true}),target),/assertions failed/)
 const rows=fixture(),before=await capture(runtime(rows),target)
 for(const mutate of [x=>x.message_media[0].media_version++,x=>x.photo_reply_jobs[0].image_authorization_version++,x=>x.photo_reply_jobs[0].next_attempt_at='changed',x=>x.messages[1].text='changed']){const next=structuredClone(rows);mutate(next);assert.equal(compareSnapshots(before,await capture(runtime(next),target)).equal,false)}
})
