import {test} from 'node:test'
import assert from 'node:assert/strict'
import {capture,quarantine,compareSnapshots} from './policy.mjs'
const privateText='PRIVATE_SHARED_BODY_NOT_IN_CHECKPOINT',visitor='e'.repeat(64),at='2026-11-15T00:00:00.000Z'
const target={domain:'social',kind:'target',runId:'isolated-test'}
function records(){return{
 posts:[],post_comments:[],post_reactions:[],social_person_sync:[],social_account_write_gates:[],social_commands:[],outbox_events:[],
 shared_albums:[{id:'album',account_id:'owner',title:privateText,message:privateText,status:'active',version:2}],
 shared_album_contributions:[{id:'contribution',album_id:'album',visitor_hash:visitor,body:privateText,status:'approved',version:2}],
 shared_album_commands:[{actor:'visitor:'+visitor,idempotency_key:'same-key',album_id:'album',resource_id:'contribution',operation:'submit',request_hash:'request-1'},{actor:'owner:owner',idempotency_key:'same-key',album_id:'album',resource_id:'contribution',operation:'adopt',request_hash:'request-2'}],
 shared_album_decisions:[{id:'decision',album_id:'album',contribution_id:'contribution',decision:'approve',reviewer:'private-human-reviewer',rules_version:1}],
 shared_album_adoptions:[{contribution_id:'pending',album_id:'album',account_id:'owner',person_id:'person',source_version:2,status:'pending',memory_id:null,recovery_blocked:false},{contribution_id:'complete',album_id:'album',account_id:'owner',person_id:'person',source_version:2,status:'fulfilled',memory_id:'memory',recovery_blocked:false},{contribution_id:'revoked',album_id:'album',account_id:'owner',person_id:'person',source_version:2,status:'revoked',memory_id:'old-memory',recovery_blocked:false}],
 shared_album_rewards:[{album_id:'album',account_id:'guest',contribution_id:'pending',status:'pending',receipt_id:null,granted_at:null,dispatch_started_at:at,recovery_blocked:false},{album_id:'album',account_id:'other-guest',contribution_id:'complete',status:'fulfilled',receipt_id:'receipt',granted_at:at,dispatch_started_at:at,recovery_blocked:false},{album_id:'album',account_id:'third-guest',contribution_id:'canceled',status:'canceled',receipt_id:null,granted_at:null,dispatch_started_at:null,recovery_blocked:false}],
 shared_album_source_cleanup:[{contribution_id:'revoked',album_id:'album',account_id:'owner',erasing_account_ids:['owner','guest'],recovery_blocked:false,created_at:at}],
}}
function runtime(rows,{corrupt=false,ignoreFlags=false}={}){const writes=[];return{writes,async query(_target,sql){
 if(sql.includes('SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind'))return Object.keys(rows).map(name=>({schema:'public',name,kind:'r'}))
 if(sql.includes('AS records'))return Object.entries(rows).map(([name,values])=>({name:'public.'+name,records:values.map(r=>JSON.stringify(r))}))
 if(sql.includes('AS executable_album_jobs'))return[{executable_album_jobs:String(rows.shared_album_adoptions.filter(r=>r.status==='pending'&&!r.recovery_blocked).length+rows.shared_album_rewards.filter(r=>r.status==='pending'&&!r.recovery_blocked).length+rows.shared_album_source_cleanup.filter(r=>!r.recovery_blocked).length)}]
 if(sql.includes('AS active_accounts'))return[{active_accounts:String(rows.accounts.filter(r=>r.status==='active').length),usable_sessions:'0',usable_attempts:'0',sms:'0',grants:'0',exports:'0',receipts:'0',runnable_requests:'0'}]
 return[]
 },async sql(_target,sql){
 writes.push(sql)
 if(_target.domain==='social'){
  assert.doesNotMatch(sql,/\b(?:DELETE|INSERT)\b/)
  const updates=sql.split(';').map(s=>s.trim()).filter(s=>s.startsWith('UPDATE'))
  assert.equal(updates.length,3)
  for(const command of updates)assert.match(command,/^UPDATE public\.shared_album_(?:adoptions|rewards|source_cleanup) SET recovery_blocked=true WHERE (?:status='pending' AND )?NOT recovery_blocked$/)
  if(!ignoreFlags){for(const t of ['shared_album_adoptions','shared_album_rewards'])for(const row of rows[t])if(row.status==='pending')row.recovery_blocked=true;for(const row of rows.shared_album_source_cleanup)row.recovery_blocked=true}
  if(corrupt)rows.shared_album_rewards[0].dispatch_started_at=null
 }else if(_target.domain==='identity'){
  assert.match(sql,/UPDATE public\.accounts SET status='restricted'/)
  for(const row of rows.accounts)if(row.status==='active'){row.status='restricted';row.access_version++;row.version++;row.updated_at=at}
 }else throw new Error('Unexpected mutation domain')
 }}}

test('album quarantine changes only pending execution flags and preserves completed and revoked business rows exactly',async()=>{
 const rows=records(),before=structuredClone(rows),r=runtime(rows),result=await quarantine(r,target)
 assert.equal(result.assertions.albumEffectsBlocked,true);assert.equal(result.assertions.coreContentUnchanged,true)
 assert.equal(result.counts.executable_album_jobs,'0');assert.equal(r.writes.length,1)
 for(const [name,values]of Object.entries(rows))for(const [index,row]of values.entries()){
  const expected=structuredClone(before[name][index]);if(['shared_album_adoptions','shared_album_rewards'].includes(name)&&row.status==='pending'||name==='shared_album_source_cleanup')expected.recovery_blocked=true
  assert.deepEqual(row,expected)
 }
 assert.equal(JSON.stringify(result).includes(privateText),false);assert.equal(JSON.stringify(result).includes(visitor),false)
})
test('quarantine rejects altered dispatch provenance, an incomplete table group, and an ineffective execution fence',async()=>{
 await assert.rejects(()=>quarantine(runtime(records(),{corrupt:true}),target),/altered preserved business content/)
 const missing=records();delete missing.shared_album_source_cleanup;await assert.rejects(()=>quarantine(runtime(missing),target),/Expected recovery table is missing/)
 await assert.rejects(()=>quarantine(runtime(records(),{ignoreFlags:true}),target),/quarantine assertions failed/i)
})
test('all album resources retain distinct checkpoint identities and passive memory receipts remain immutable core content',async()=>{
 const rows=records(),before=await capture(runtime(rows),{domain:'social'}),resources=before.security.resources
 for(const kind of ['shared_album','shared_album_contribution','shared_album_command','shared_album_decision','shared_album_adoption','shared_album_reward','shared_album_source_cleanup'])assert.ok(resources.some(r=>r.kind===kind))
 const commands=resources.filter(r=>r.kind==='shared_album_command');assert.equal(new Set(commands.map(r=>r.id)).size,2);for(const c of commands)assert.match(c.id,/^[a-f0-9]{64}$/)
 assert.equal(new Set(resources.filter(r=>r.kind==='shared_album_reward').map(r=>r.accountId+':'+r.id)).size,3)
 assert.equal(JSON.stringify(before).includes(visitor),false);assert.equal(JSON.stringify(before).includes(privateText),false)
 const changed=structuredClone(rows);changed.shared_album_source_cleanup[0].erasing_account_ids.pop()
 const after=await capture(runtime(changed),{domain:'social'});assert.notDeepEqual(before.core,after.core);assert.ok(compareSnapshots(before,after).differences.some(d=>d.resourceKind==='shared_album_source_cleanup'))
 const memoryRows={shared_memory_receipts:[{account_id:'owner',album_id:'album',contribution_id:'contribution',source_version:2,person_id:'person',memory_id:'memory',state:'fulfilled',created_at:at,updated_at:at}]}
 const one=await capture(runtime(memoryRows),{domain:'memories'});memoryRows.shared_memory_receipts[0].state='revoked';const two=await capture(runtime(memoryRows),{domain:'memories'})
 assert.notDeepEqual(one.core,two.core);assert.equal(one.security.resources[0].kind,'shared_memory_receipt');assert.equal(one.security.resources[0].id,'contribution')
})
test('restored public album authority is disabled by the existing Identity account restriction without changing accepted participation',async()=>{
 const rows={accounts:[{id:'owner',status:'active',version:1,access_version:1,updated_at:at,private_profile:privateText},{id:'deleting',status:'deletion_pending',version:4,access_version:2,updated_at:at}],app_sessions:[],app_session_slots:[],auth_attempts:[],auth_sms_challenges:[],data_requests:[],data_request_receipts:[],data_exports:[],data_export_grants:[]}
 const result=await quarantine(runtime(rows),{domain:'identity',kind:'target',runId:'isolated-test'})
 assert.equal(result.assertions.credentialsAndAdmissionBlocked,true);assert.equal(result.assertions.coreContentUnchanged,true)
 assert.equal(rows.accounts[0].status,'restricted');assert.equal(rows.accounts[1].status,'deletion_pending');assert.equal(rows.accounts[0].private_profile,privateText)
})
test('new goal kind, capacity, rule version and accepted owner-review command remain immutable checkpoint business facts',async()=>{const rows=records();Object.assign(rows.shared_albums[0],{kind:'flight',rules_version:2,capacity:8});rows.shared_album_commands.push({actor:'owner:owner',idempotency_key:'owner-review-key',album_id:'album',resource_id:'contribution',operation:'owner_review',request_hash:'exact-owner-intent'});Object.assign(rows.shared_album_decisions[0],{decision:'owner_approve',actor_account_id:'owner',reviewer:null,rules_version:2});const before=await capture(runtime(rows),{domain:'social'});await quarantine(runtime(rows),target);const after=await capture(runtime(rows),target);assert.deepEqual(before.core,after.core);for(const mutate of [r=>r.shared_albums[0].kind='home',r=>r.shared_albums[0].capacity=5,r=>r.shared_albums[0].rules_version=1,r=>r.shared_album_commands.at(-1).request_hash='changed']){const copy=structuredClone(rows);mutate(copy);assert.notDeepEqual((await capture(runtime(copy),target)).core,after.core)}})
