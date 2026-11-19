import {test} from 'node:test'
import assert from 'node:assert/strict'
import {capture,compareSnapshots} from './policy.mjs'
const secret='PRIVATE_ECHO_QUOTE_SHOULD_NOT_APPEAR'
const make=(state='queued',memoryVersion=1)=>({
 social_memory_sources:[JSON.stringify({account_id:'a',memory_id:'m',person_id:'p',source_version:memoryVersion,state:'active',version:1})],
 social_memory_receipts:[JSON.stringify({account_id:'a',event_id:'event',outcome:'accepted'})],
 social_generation_jobs:[JSON.stringify({id:'job',account_id:'a',person_id:'p',memory_id:'m',memory_version:memoryVersion,state,version:state==='queued'?1:2,dispatch_generation:state==='queued'?1:2,attempt_id:null,lease_until:null,failure_code:state==='queued'?null:'RESTORE_REVIEW_REQUIRED',retryable:false,finished_at:state==='queued'?null:'now',world_context_ref:{revision:'world',reality:'virtual',branch:'main'},context_comment_refs:[{id:'comment',version:1}]})],
 posts:[JSON.stringify({id:'post',account_id:'a',kind:'memory_echo',body:secret,source_memory_id:'m',source_memory_version:memoryVersion,version:1,status:'active'})],
 post_comments:[JSON.stringify({id:'comment',account_id:'a',author_kind:'persona',body:secret,version:1,status:'active'})],
})
const runtime=records=>({query:async(_target,sql)=>{
 if(sql.includes('SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind'))return Object.keys(records).map(name=>({schema:'public',name,kind:'r'}))
 if(sql.includes('AS records'))return Object.entries(records).map(([name,records])=>({name:'public.'+name,records}))
 return []
}})
test('echo recovery checkpoints preserve exact source/world/comment provenance while allowing only job quarantine controls to change',async()=>{
 const before=await capture(runtime(make()),{domain:'social'}),blocked=await capture(runtime(make('blocked')),{domain:'social'}),changed=await capture(runtime(make('queued',2)),{domain:'social'})
 const provenance=v=>v.core.find(row=>row.name==='public.social_generation_jobs:provenance').digest
 assert.equal(provenance(before),provenance(blocked));assert.notEqual(provenance(before),provenance(changed))
 assert.deepEqual(before.security.resources.filter(row=>row.kind.startsWith('social_')).map(row=>[row.kind,row.id]).sort(),[['social_generation_job','job'],['social_memory_receipt','event'],['social_memory_source','m']])
 assert(compareSnapshots(before,changed).differences.some(row=>row.resourceKind==='post'&&row.change==='changed'))
 assert.equal(JSON.stringify({before,blocked,changed}).includes(secret),false)
 const records=make();records.social_generation_jobs=[JSON.stringify({...JSON.parse(records.social_generation_jobs[0]),context_comment_refs:[{id:'another',version:2}]})]
 assert.notEqual(provenance(before),provenance(await capture(runtime(records),{domain:'social'})))
})
test('source acknowledgements have stable event identities in checkpoints without exporting private originals',async()=>{
 const rows={social_memory_event_acks:[JSON.stringify({account_id:'a',event_id:'event',acknowledged_at:'now'})]}
 const snapshot=await capture(runtime(rows),{domain:'memories'})
 assert.deepEqual(snapshot.security.resources.map(row=>[row.kind,row.id]),[['social_memory_event_ack','event']])
})
