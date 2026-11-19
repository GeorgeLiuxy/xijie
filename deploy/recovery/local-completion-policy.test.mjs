import {test} from 'node:test'
import assert from 'node:assert/strict'
import {capture,quarantine} from './policy.mjs'

const marker='PRIVATE_CONTENT_MUST_STAY_OUT_OF_REPORT'
const empty=names=>Object.fromEntries(names.map(n=>[n,[]]))
const fixture=domain=>domain==='identity'?{
 ...empty(['accounts','app_sessions','app_session_slots','auth_attempts','auth_sms_challenges','data_requests','data_request_receipts','data_exports','data_export_grants']),
 account_profile_commands:[{account_id:'owner',idempotency_key:'nickname-key',request_hash:'original-hash',accepted_version:3}],
 model_execution_days:[{account_id:'owner',utc_day:'2026-11-15',attempts:8}],
 model_executions:[{id:'model-running',account_id:'owner',job_id:'job',service:'gifts',purpose:'gift_return',authorizations:{private:marker},claimed_at:'before',lease_until:'future',finished_at:null,result_allowed:null},{id:'model-done',account_id:'owner',job_id:'job-old',authorizations:{original:true},claimed_at:'before',lease_until:'past',finished_at:'finished',result_allowed:true}],
 content_reports:['open','reviewing','resolved'].map((state,i)=>({id:'report-'+i,account_id:'owner',owner_account_id:'source-owner',source_version:8,source_hash:'source-hash',note:marker,state,resolution:state==='resolved'?'remove':null,decision:state==='open'?null:'remove',reviewer_id:state==='open'?null:'staff',reason_code:'reason',action_key:'accepted-action',version:4,recovery_blocked:false,updated_at:'before'})),
 content_report_commands:[{account_id:'owner',operation:'create',idempotency_key:'report-key',request_hash:'original-hash',report_id:'report-1'}],
 content_report_audit:[{id:'audit',account_id:'owner',report_id:'report-1',actor:'staff',action:'resolve',reason_code:'reason'}],
}:domain==='people'?{
 persons:[{id:'person',account_id:'owner',personality:[marker],life:['original life'],unknowns:['original unknown'],catchphrase:'original'}],person_drafts:[],
 person_reminder_settings:[{account_id:'owner',person_id:'person',enabled:true,time_zone:'Asia/Shanghai',authorization_version:3,version:2,next_check_at:'due',updated_at:'before'}],
 person_reminder_notifications:[{id:'notice',account_id:'owner',person_id:'person',kind:'birthday',local_date:'2026-11-15',local_year:2026,authorization_version:3,version:1}],
 person_reminder_commands:[{account_id:'owner',idempotency_key:'reminder-key',request_hash:'original-hash'}],
}:{
 ...empty(['gifts_account_write_gates','gift_catalog_items','asset_lots','ledger_transactions','ledger_entries','gift_deliveries','gifts_jobs','outbox_events','gifts_erase_receipts','commerce_quotes','commerce_orders','commerce_payment_attempts','commerce_refunds','commerce_refund_reservations','commerce_verified_evidence','commerce_commands']),
 commerce_reconciliation_jobs:[{id:'job',account_id:'owner',state:'blocked',failure_code:'PAYMENT_OUTCOME_UNKNOWN',attempt_count:64,error_count:3,deadline_at:'original-deadline',attempt_id:null,lease_until:null,recovery_blocked:false}],
 commerce_operator_commands:[{id:'ops-running',account_id:'owner',action:'recheck',reviewer:'staff',reason_code:'reason',request_hash:'original',ordinal:1,state:'running',lease_until:'future',finished_at:null,result_code:null},{id:'ops-done',account_id:'owner',action:'read',reviewer:'staff',reason_code:'reason',request_hash:'original',state:'succeeded',lease_until:null,finished_at:'past',result_code:'READ'}],
 financial_retention_records:[{id:'archive',account_id:'owner',request_id:'delete-request',policy_version:'explicit-v1',retention_days:30,payload:{private:marker},payload_hash:'original-hash',retain_until:'original-expiry',recovery_blocked:false}],
}
function runtime(rows,{skip=false,damage}={}){return{
 async query(_target,sql){
  if(sql.includes('SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind'))return Object.keys(rows).map(name=>({schema:'public',name,kind:'r'}))
  if(sql.includes('AS records'))return Object.entries(rows).map(([name,data])=>({name:'public.'+name,records:data.map(r=>JSON.stringify(r))}))
  if(sql.includes('AS active_accounts'))return[{active_accounts:'0',usable_sessions:'0',usable_attempts:'0',sms:'0',grants:'0',exports:'0',receipts:'0',runnable_requests:'0'}]
  const key=sql.includes('AS executable_model_leases')?'executable_model_leases':sql.includes('AS executable_report_actions')?'executable_report_actions':sql.includes('AS executable_reminders')?'executable_reminders':sql.includes('AS executable_financial_operations')?'executable_financial_operations':sql.includes('AS executable_gift_jobs')?'executable_gift_jobs':null
  if(key){const count=key==='executable_model_leases'?rows.model_executions.filter(r=>r.finished_at==null&&r.lease_until==='future').length:key==='executable_report_actions'?rows.content_reports.filter(r=>r.state==='reviewing'&&!r.recovery_blocked).length:key==='executable_reminders'?rows.person_reminder_settings.filter(r=>r.enabled||r.next_check_at!=null).length:key==='executable_financial_operations'?rows.commerce_operator_commands.filter(r=>r.state==='running'||r.lease_until!=null).length+rows.commerce_reconciliation_jobs.filter(r=>r.state!=='succeeded'&&!r.recovery_blocked).length+rows.financial_retention_records.filter(r=>!r.recovery_blocked).length:0;return[{[key]:String(count)}]}
  return[]
 },
 async sql(_target,sql){
  if(rows.model_executions){assert.match(sql,/lease_until=claimed_at\+interval '1 microsecond'/);assert.doesNotMatch(sql,/UPDATE public\.model_execution_days|SET finished_at=.*model_executions/)}
  if(rows.content_reports)assert.match(sql,/WHERE state='reviewing' AND NOT recovery_blocked/)
  if(rows.person_reminder_settings)assert.match(sql,/SET enabled=false,next_check_at=NULL/)
  if(rows.financial_retention_records)assert.match(sql,/UPDATE public\.financial_retention_records SET recovery_blocked=true/)
  if(skip)return
  for(const r of rows.model_executions??[])if(r.finished_at==null&&r.lease_until==='future')r.lease_until='expired'
  for(const r of rows.content_reports??[])if(r.state==='reviewing'&&!r.recovery_blocked)Object.assign(r,{recovery_blocked:true,updated_at:'restore'})
  for(const r of rows.person_reminder_settings??[])if(r.enabled||r.next_check_at!=null)Object.assign(r,{enabled:false,next_check_at:null,version:r.version+1,updated_at:'restore'})
  for(const r of rows.commerce_operator_commands??[])if(r.state==='running')Object.assign(r,{state:'blocked',lease_until:null,finished_at:'restore',result_code:'RESTORE_REVIEW_REQUIRED'})
  for(const r of rows.commerce_reconciliation_jobs??[])if(r.state!=='succeeded')r.recovery_blocked=true
  for(const r of rows.financial_retention_records??[])r.recovery_blocked=true
  damage?.(rows)
 },
}}
for(const domain of ['identity','people','gifts'])test(domain+' local-completion recovery preserves decisions, private facts and budgets while closing executable capabilities',async()=>{
 const rows=fixture(domain),old=structuredClone(rows),target={domain,kind:'target',runId:'local-completion-policy'},rt=runtime(rows),before=await capture(rt,target),proof=await quarantine(rt,target),after=await capture(rt,target)
 assert.deepEqual(before.core,after.core);assert(Object.values(proof.assertions).every(Boolean));assert(!JSON.stringify({before,after,proof}).includes(marker))
 if(domain==='identity'){assert.deepEqual(rows.model_execution_days,old.model_execution_days);assert.deepEqual(rows.model_executions[1],old.model_executions[1]);assert.equal(rows.content_reports[1].state,'reviewing');assert.equal(rows.content_reports[1].action_key,'accepted-action');assert.equal(rows.content_reports[1].recovery_blocked,true);assert.deepEqual(rows.content_reports[0],old.content_reports[0]);assert.deepEqual(rows.content_reports[2],old.content_reports[2]);assert(before.security.resources.some(r=>r.kind==='account_profile_command'&&r.id==='nickname-key'));assert(before.security.resources.some(r=>r.kind==='model_execution_day'&&r.id==='2026-11-15'))}
 if(domain==='people'){assert.equal(rows.person_reminder_settings[0].enabled,false);assert.deepEqual(rows.person_reminder_notifications,old.person_reminder_notifications);assert.deepEqual(rows.persons,old.persons)}
 if(domain==='gifts'){assert.equal(rows.commerce_reconciliation_jobs[0].failure_code,'PAYMENT_OUTCOME_UNKNOWN');assert.equal(rows.commerce_operator_commands[0].ordinal,1);assert.deepEqual(rows.commerce_operator_commands[1],old.commerce_operator_commands[1]);assert.equal(rows.financial_retention_records[0].retain_until,'original-expiry')}
 await assert.rejects(quarantine(runtime(fixture(domain),{skip:true}),target),/assertions failed/)
})
test('local-completion recovery rejects partial schemas and any mutation to protected decisions, quota or attribution',async()=>{
 const cases={identity:[r=>r.model_execution_days[0].attempts--,r=>r.model_executions[0].authorizations={},r=>r.content_reports[1].action_key='new-key',r=>r.content_reports[1].version++,r=>r.content_report_audit[0].actor='other',r=>r.account_profile_commands[0].request_hash='changed'],people:[r=>r.person_reminder_settings[0].authorization_version++,r=>r.person_reminder_notifications=[],r=>r.persons[0].personality=[]],gifts:[r=>r.commerce_reconciliation_jobs[0].attempt_count=0,r=>r.commerce_operator_commands[0].ordinal=0,r=>r.commerce_operator_commands[1].result_code='NEW',r=>r.financial_retention_records[0].retain_until='extended']}
 for(const [domain,changes]of Object.entries(cases)){const target={domain,kind:'target',runId:'local-completion-policy'};for(const damage of changes)await assert.rejects(quarantine(runtime(fixture(domain),{damage}),target),/preserved business content/);const r=fixture(domain);delete r[domain==='identity'?'content_report_audit':domain==='people'?'person_reminder_commands':'commerce_operator_commands'];await assert.rejects(quarantine(runtime(r),target),/Expected recovery table is missing/)}
})
