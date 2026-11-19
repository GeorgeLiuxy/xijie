import {randomUUID} from 'node:crypto'
import type {PoolClient} from 'pg'
import {GiftsError,hash} from './contracts.js'

export type FinancialRetentionPolicy={version:string;days:number}
export type FinancialRetention={status:'none'}|{status:'retained';archiveId:string;policyVersion:string;retainUntil:string}
export function financialSnapshotDigest(value:unknown):string{const stable=(v:any):string=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);return hash(stable(value))}
export function readFinancialRetention(env:NodeJS.ProcessEnv=process.env):FinancialRetentionPolicy|undefined{
 const version=env.GIFTS_FINANCIAL_RETENTION_POLICY_VERSION?.trim(),raw=env.GIFTS_FINANCIAL_RETENTION_DAYS?.trim()
 if(!version&&!raw)return
 if(!version||!/^[-a-zA-Z0-9._]{1,80}$/.test(version)||!raw||!/^\d{1,5}$/.test(raw)||Number(raw)<1||Number(raw)>36500)throw Error('Configure an explicit financial retention policy version and days')
 return{version,days:Number(raw)}
}
export async function assertSettledFinancialState(db:PoolClient,account:string){
 if((await db.query("SELECT 1 FROM commerce_payment_attempts WHERE account_id=$1 AND state IN('preparing','pending') UNION ALL SELECT 1 FROM commerce_refunds WHERE account_id=$1 AND state IN('reserved','pending','review') LIMIT 1",[account])).rowCount)throw new GiftsError(409,'FINANCIAL_RECONCILIATION_REQUIRED')
}
const retention=(r:any):FinancialRetention=>({status:'retained',archiveId:r.id,policyVersion:r.policy_version,retainUntil:r.retain_until.toISOString()})
export async function financialRetentionPlan(db:PoolClient,account:string,request:string,policy?:FinancialRetentionPolicy):Promise<FinancialRetention>{
 await assertSettledFinancialState(db,account)
 const old=(await db.query('SELECT id,request_id,policy_version,retain_until,recovery_blocked FROM financial_retention_records WHERE account_id=$1',[account])).rows[0]
 if(old){if(old.recovery_blocked)throw new GiftsError(409,'RESTORE_REVIEW_REQUIRED');if(old.request_id!==request)throw new GiftsError(409,'IDEMPOTENCY_CONFLICT');return retention(old)}
 if(!(await db.query("SELECT 1 FROM commerce_verified_evidence WHERE account_id=$1 AND outcome='paid' LIMIT 1",[account])).rowCount)return{status:'none'}
 if(!policy)throw new GiftsError(409,'FINANCIAL_RETENTION_POLICY_REQUIRED')
 const payload=await financialSnapshot(db,account)
 const row=(await db.query("INSERT INTO financial_retention_records(id,account_id,request_id,policy_version,retention_days,retain_until,payload,payload_hash) VALUES($1,$2,$3,$4,$5,clock_timestamp()+$5::integer*interval '1 day',$6,$7) RETURNING id,request_id,policy_version,retain_until",[randomUUID(),account,request,policy.version,policy.days,payload,financialSnapshotDigest(payload)])).rows[0]
 return retention(row)
}
// Whitelisted financial facts only. No order description, person, gift note,
// conversation, launch URL, authentication credential or raw channel payload.
async function financialSnapshot(db:PoolClient,account:string){
 const queries:Record<string,string>={
  orders:"SELECT o.id,o.quote_id,o.payment_state,o.fulfillment_state,o.credit_transaction_id,o.paid_at,o.closed_at,o.created_at,q.channel,q.price_amount,q.currency,q.product_snapshot->>'id' AS product_id,q.product_snapshot->'version' AS product_version,q.product_snapshot->'units' AS issued_units FROM commerce_orders o JOIN commerce_quotes q ON q.id=o.quote_id WHERE o.account_id=$1 AND o.payment_state='paid' ORDER BY o.id",
  attempts:"SELECT a.id,a.order_id,a.provider,a.provider_binding,a.state,a.started_at,a.finished_at FROM commerce_payment_attempts a JOIN commerce_orders o ON o.id=a.order_id WHERE a.account_id=$1 AND o.payment_state='paid' ORDER BY a.id",
  refunds:"SELECT r.id,r.order_id,r.provider,r.provider_binding,r.amount,r.currency,r.state,r.debit_transaction_id,r.started_at,r.finished_at,r.failure_code FROM commerce_refunds r JOIN commerce_orders o ON o.id=r.order_id WHERE r.account_id=$1 AND o.payment_state='paid' ORDER BY r.id",
  evidence:"SELECT e.id,e.order_id,e.payment_attempt_id,e.refund_id,e.provider,e.event_id,e.transaction_id,e.outcome,e.amount,e.currency,e.evidence_hash,e.occurred_at,e.verified_at FROM commerce_verified_evidence e JOIN commerce_orders o ON o.id=e.order_id WHERE e.account_id=$1 AND o.payment_state='paid' ORDER BY e.id",
  transactions:"SELECT id,reason,source_id,policy_version,original_transaction_id,request_hash AS evidence_hash,created_at FROM ledger_transactions WHERE account_id=$1 AND reason IN('purchase_credit','purchase_refund') ORDER BY id",
  entries:"SELECT e.transaction_id,e.line_no,e.lot_id,e.direction,e.units FROM ledger_entries e JOIN ledger_transactions t ON t.id=e.transaction_id WHERE e.account_id=$1 AND t.reason IN('purchase_credit','purchase_refund') ORDER BY e.transaction_id,e.line_no",
  lots:"SELECT id,asset_type,asset_id,balance_units,reserved_units,issuance_transaction_id FROM asset_lots WHERE account_id=$1 AND source='paid' ORDER BY id",
 }
 const result:Record<string,unknown>={schemaVersion:1}
 for(const[name,sql]of Object.entries(queries))result[name]=JSON.parse(JSON.stringify((await db.query(sql,[account])).rows))
 return result
}
