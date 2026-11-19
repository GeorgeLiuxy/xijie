import {test} from 'node:test'
import assert from 'node:assert/strict'
import {capture,compareSnapshots,quarantine} from './policy.mjs'
const target={domain:'gifts',kind:'target',runId:'commerce-policy-unit'}
function fixture(){
 const f={gifts_account_write_gates:[],gift_catalog_items:[],asset_lots:[{id:'lot',account_id:'account',source:'paid',balance_units:20,reserved_units:20}],ledger_transactions:[],ledger_entries:[],gift_deliveries:[],gifts_jobs:[],outbox_events:[],gifts_erase_receipts:[],referral_reward_awards:[],referral_reward_receipts:[{account_id:'account',referral_id:'ref-a',receipt_id:'receipt-a',role:'host'},{account_id:'account',referral_id:'ref-b',receipt_id:'receipt-b',role:'host'}],album_reward_receipts:[],commerce_quotes:[{id:'quote',account_id:'account',product_snapshot:{name:'PRIVATE_PRODUCT_NOT_IN_REPORT'}}],commerce_orders:[{id:'order',account_id:'account',quote_id:'quote',payment_state:'paid'}],commerce_payment_attempts:[{id:'attempt',account_id:'account',order_id:'order',state:'succeeded',started_at:'original-transport-fence'}],commerce_refunds:[{id:'refund',account_id:'account',order_id:'order',state:'pending',started_at:'original-refund-fence'}],commerce_refund_reservations:[{account_id:'account',refund_id:'refund',lot_id:'lot',units:20,state:'held'},{account_id:'account',refund_id:'refund-old',lot_id:'lot',units:20,state:'released'}],commerce_verified_evidence:[{id:'evidence',account_id:'account',event_id:'PRIVATE_PROVIDER_EVENT_NOT_IN_REPORT'}],commerce_commands:[{account_id:'account',acceptance_key:'command-one'},{account_id:'account',acceptance_key:'command-two'}],commerce_reconciliation_jobs:[]}
 f.commerce_reconciliation_jobs=['queued','running','failed','succeeded','blocked'].map((state,i)=>({id:'job-'+state,account_id:'account',order_id:'order',kind:'refund',resource_id:'refund-'+i,state,version:2,attempt_id:state==='running'?'attempt':null,lease_until:state==='running'?'later':null,attempt_count:i%4,retry_at:'scheduled',created_at:'before',updated_at:'before',finished_at:['succeeded','blocked'].includes(state)?'before':null,failure_code:state==='blocked'?'PAYMENT_OUTCOME_UNKNOWN':null}))
 return f
}
function runtime(records){return{async query(_target,sql){
 if(sql.includes('SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind'))return Object.keys(records).map(name=>({schema:'public',name,kind:'r'}))
 if(sql.includes('AS records'))return Object.entries(records).map(([name,rows])=>({name:'public.'+name,records:rows.map(r=>JSON.stringify(r))}))
 if(sql.includes('AS executable_gift_jobs'))return[{executable_gift_jobs:String(records.commerce_reconciliation_jobs.filter(r=>['queued','running','failed'].includes(r.state)||r.attempt_id!=null||r.lease_until!=null).length)}]
 return[]
 },async sql(_target,sql){
 assert.match(sql,/UPDATE public\.commerce_reconciliation_jobs SET state='blocked'/)
 assert.doesNotMatch(sql,/UPDATE public\.(?:commerce_orders|commerce_payment_attempts|commerce_refunds|commerce_refund_reservations|asset_lots)|\bDELETE\b|\bINSERT\b/)
 for(const j of records.commerce_reconciliation_jobs)if(['queued','running','failed'].includes(j.state))Object.assign(j,{state:'blocked',attempt_id:null,lease_until:null,finished_at:'restore-time',updated_at:'restore-time',failure_code:'RESTORE_REVIEW_REQUIRED',version:j.version+1})
 }}}
test('commerce quarantine changes only executable controls and preserves payment evidence, transport fences, held assets and permanent receipts',async()=>{
 const f=fixture(),original=structuredClone(f),before=await capture(runtime(f),target),report=await quarantine(runtime(f),target),after=await capture(runtime(f),target)
 for(const [name,rows]of Object.entries(original))if(name!=='commerce_reconciliation_jobs')assert.deepEqual(f[name],rows)
 assert.deepEqual(f.commerce_reconciliation_jobs.find(j=>j.state==='succeeded'),original.commerce_reconciliation_jobs.find(j=>j.state==='succeeded'))
 assert.deepEqual(before.core,after.core)
 const comparison=compareSnapshots(before,after);assert(comparison.differences.every(d=>d.kind==='table'?d.table==='public.commerce_reconciliation_jobs':d.kind==='resource'&&d.resourceKind==='commerce_reconciliation_job'))
 const records=after.security.resources.filter(r=>r.kind==='commerce_refund_reservation');assert.equal(records.length,2);assert.equal(new Set(records.map(r=>r.id)).size,2)
 const commands=after.security.resources.filter(r=>r.kind==='commerce_command');assert.equal(commands.length,2);assert.equal(new Set(commands.map(r=>r.id)).size,2)
 const referrals=after.security.resources.filter(r=>r.kind==='referral_reward_receipt');assert.equal(referrals.length,2);assert.equal(new Set(referrals.map(r=>r.id)).size,2)
 assert(!JSON.stringify({report,comparison}).includes('PRIVATE_PRODUCT'));assert(!JSON.stringify({report,comparison}).includes('PRIVATE_PROVIDER_EVENT'))
})

test('new gateway launch and waiting budgets remain facts while isolated jobs cannot be awakened',async()=>{
 const f=fixture();Object.assign(f.commerce_payment_attempts[0],{launch_url:'https://cashier.example.test/PRIVATE_LAUNCH',launch_expires_at:'2026-11-15T00:30:00.000Z'});for(const j of f.commerce_reconciliation_jobs)Object.assign(j,{deadline_at:'2026-11-16T00:00:00.000Z',error_count:2,attempt_count:12});const before=await capture(runtime(f),target),report=await quarantine(runtime(f),target),after=await capture(runtime(f),target);assert.deepEqual(before.core,after.core);assert(f.commerce_reconciliation_jobs.every(j=>j.deadline_at==='2026-11-16T00:00:00.000Z'&&j.error_count===2&&j.attempt_count===12));assert(!JSON.stringify({report,security:after.security}).includes('PRIVATE_LAUNCH'))
})
