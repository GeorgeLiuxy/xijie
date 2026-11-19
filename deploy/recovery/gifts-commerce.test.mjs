import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {verifyGiftCommerceFacts,validateGiftCommerceReferences} from './gifts-commerce.mjs'
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),stamp='2026-11-15T00:00:00.000Z'
const empty=()=>({lots:[],transactions:[],entries:[],referral_reward_awards:[],referral_reward_receipts:[],album_reward_receipts:[],commerce_quotes:[],commerce_orders:[],commerce_payment_attempts:[],commerce_refunds:[],commerce_refund_reservations:[],commerce_verified_evidence:[],commerce_commands:[],commerce_reconciliation_jobs:[]})
function referral(){const f=empty(),p={id:'referral',campaign:'first-memory-v1',inviterAccountId:'host',inviteeAccountId:'guest',registeredAt:stamp},q={eventId:'qualification',confirmedAt:stamp,confirmedSeq:'9007199254740993',origin:'manual'},fp=digest({referral:p,qualification:q})
 f.referral_reward_awards=[{id:'award',referral_id:p.id,campaign:p.campaign,inviter_account_id:'host',invitee_account_id:'guest',inviter_access_version:1,invitee_access_version:1,registered_at:stamp,qualification_event_id:q.eventId,qualified_at:stamp,confirmed_seq:q.confirmedSeq,qualification_origin:q.origin,request_hash:fp,created_at:stamp}]
 for(const [account,role]of [['host','host'],['guest','guest']]){const tx='tx-'+account,lot='lot-'+account;f.referral_reward_receipts.push({account_id:account,referral_id:p.id,receipt_id:'award',role,campaign:p.campaign,transaction_id:tx,lot_id:lot,qualified_at:stamp,created_at:stamp});f.lots.push({id:lot,account_id:account,source:'promotion',asset_type:'voucher',asset_id:'return-stamp',balance_units:1,reserved_units:0,expires_at:null,policy_version:p.campaign,issuance_transaction_id:tx});f.transactions.push({id:tx,account_id:account,reason:'referral_reward',source_id:'referral:'+p.id+':'+role,policy_version:p.campaign,request_hash:fp});f.entries.push({account_id:account,transaction_id:tx,lot_id:lot,direction:'credit',units:1,line_no:1})}
 f.attributions=[{id:p.id,campaign:p.campaign,inviter_account_id:'host',invitee_account_id:'guest',registered_at:stamp,state:'awaiting_memory',qualified_at:null,receipt_id:null}];f.qualifications=[{event_id:q.eventId,account_id:'guest',confirmed_at:stamp,confirmed_seq:q.confirmedSeq,origin:q.origin,qualifies:true}];return f
}
function paid(){const f=empty(),p={id:'synthetic-only',version:1,name:'SYNTHETIC PRIVATE PRODUCT',units:20,assetType:'postage',assetId:'postage',price:{amount:100,currency:'TST'},channel:'synthetic'},e={outcome:'paid',orderId:'order',operationId:'attempt',eventId:'paid-event',transactionId:'provider-tx',amount:100,currency:'TST',occurredAt:stamp},fp=digest(e)
 f.commerce_quotes=[{id:'quote',account_id:'a',product_snapshot:p,channel:p.channel,price_amount:100,currency:'TST',request_hash:digest({productId:p.id,quantity:1,channel:p.channel}),created_at:stamp,expires_at:'2026-11-15T00:10:00.000Z'}]
 f.commerce_orders=[{id:'order',account_id:'a',quote_id:'quote',request_hash:digest({quoteId:'quote'}),version:3,payment_state:'paid',fulfillment_state:'fulfilled',credit_transaction_id:'credit',paid_at:stamp,closed_at:null}]
 f.commerce_payment_attempts=[{id:'attempt',account_id:'a',order_id:'order',provider:'synthetic',state:'succeeded',request_hash:digest({orderId:'order'}),started_at:stamp,finished_at:stamp}]
 f.commerce_verified_evidence=[{id:'evidence',account_id:'a',order_id:'order',payment_attempt_id:'attempt',refund_id:null,provider:'synthetic',event_id:e.eventId,transaction_id:e.transactionId,outcome:'paid',amount:100,currency:'TST',occurred_at:stamp,evidence_hash:fp}]
 f.lots=[{id:'lot',account_id:'a',source:'paid',asset_type:'postage',asset_id:'postage',balance_units:20,reserved_units:0,issuance_transaction_id:'credit',policy_version:'commerce-core-v1'}]
 f.transactions=[{id:'credit',account_id:'a',reason:'purchase_credit',source_id:'order',policy_version:'commerce-core-v1',request_hash:fp}];f.entries=[{account_id:'a',transaction_id:'credit',lot_id:'lot',direction:'credit',units:20,line_no:1}]
 f.commerce_reconciliation_jobs=[{id:'job',account_id:'a',order_id:'order',kind:'payment',resource_id:'attempt',state:'succeeded',version:3,attempt_count:1,attempt_id:null,lease_until:null,finished_at:stamp}];return f
}
function refund(state='pending'){const f=paid();f.commerce_refunds=[{id:'refund',account_id:'a',order_id:'order',provider:'synthetic',request_hash:digest({orderId:'order'}),amount:100,currency:'TST',state,debit_transaction_id:null,started_at:stamp}];f.commerce_refund_reservations=[{account_id:'a',refund_id:'refund',lot_id:'lot',units:20,state:'held'}];f.lots[0].reserved_units=20;f.commerce_reconciliation_jobs.push({id:'refund-job',account_id:'a',order_id:'order',kind:'refund',resource_id:'refund',state:'running',version:2,attempt_count:1,attempt_id:'claim',lease_until:'2026-11-15T00:00:30.000Z',finished_at:null});return f}

test('paired referral accepts lost ACK but rejects changed owner, milestone, hash or incomplete benefits',()=>{
 assert.equal(verifyGiftCommerceFacts(referral()).referralReceiptCount,2)
 for(const change of [f=>f.referral_reward_receipts.pop(),f=>f.referral_reward_awards[0].qualification_origin='shared_contribution',f=>f.qualifications[0].account_id='host',f=>f.qualifications[0].qualifies=false,f=>f.referral_reward_awards[0].confirmed_seq='2',f=>f.attributions[0].receipt_id='wrong',f=>f.referral_reward_receipts[1].account_id='host',f=>f.transactions[0].source_id='unapproved']){const f=referral();if(change.toString().includes('receipt_id'))f.attributions[0].state='rewarded';change(f);assert.throws(()=>verifyGiftCommerceFacts(f),/differs/)}
})

test('counterparty erasure retains only survivor private benefit and cannot excuse two orphan paired receipts',()=>{
 const f=referral();f.referral_reward_awards=[];assert.throws(()=>verifyGiftCommerceFacts(f),/differs/)
 for(const name of ['referral_reward_receipts','lots','transactions','entries'])f[name]=f[name].filter(r=>r.account_id==='host')
 const result=verifyGiftCommerceFacts(f);assert.equal(result.referralAwardCount,0);assert.equal(result.referralReceiptCount,1);assert(!JSON.stringify(result).includes('guest'))
})

test('paid fulfillment requires exact price, operation, unique verified event and original credit linkage',()=>{
 const f=paid();const result=verifyGiftCommerceFacts(f);assert.equal(result.orderCount,1);assert(!JSON.stringify(result).includes('PRIVATE PRODUCT'))
 for(const change of [f=>f.commerce_verified_evidence=[],f=>f.commerce_verified_evidence[0].amount=101,f=>f.commerce_verified_evidence[0].payment_attempt_id='other',f=>f.commerce_verified_evidence[0].evidence_hash='f'.repeat(64),f=>f.commerce_quotes[0].product_snapshot.units=21,f=>f.entries[0].units=19,f=>f.commerce_payment_attempts[0].state='pending',f=>f.transactions[0].request_hash='bad',f=>f.commerce_verified_evidence.push({...f.commerce_verified_evidence[0],id:'duplicate'})]){const changed=paid();change(changed);assert.throws(()=>verifyGiftCommerceFacts(changed),/differs/)}
})

test('pending and quarantined refunds preserve held amounts and immutable transport state',()=>{
 const f=refund();assert.equal(verifyGiftCommerceFacts(f).refundCount,1);Object.assign(f.commerce_reconciliation_jobs[1],{state:'blocked',attempt_id:null,lease_until:null,finished_at:stamp,failure_code:'RESTORE_REVIEW_REQUIRED'});assert.equal(verifyGiftCommerceFacts(f).verified,true);assert.equal(f.commerce_refunds[0].started_at,stamp)
 for(const change of [f=>f.lots[0].reserved_units=0,f=>f.commerce_refund_reservations[0].units=19,f=>f.commerce_refund_reservations[0].state='released',f=>f.commerce_reconciliation_jobs[1].resource_id='other',f=>f.commerce_reconciliation_jobs[1].attempt_count=4,f=>f.commerce_reconciliation_jobs=[]]){const changed=refund();change(changed);assert.throws(()=>verifyGiftCommerceFacts(changed),/differs/)}
})

test('captured refund matches provider proof and inverse original lot; unknown refund is not success',()=>{
 const f=refund(),r=f.commerce_refunds[0],e={outcome:'refunded',orderId:'order',operationId:'refund',eventId:'refund-event',transactionId:'provider-refund-tx',amount:100,currency:'TST',occurredAt:stamp},fp=digest(e)
 Object.assign(r,{state:'refunded',debit_transaction_id:'reversal'});Object.assign(f.commerce_reconciliation_jobs[1],{state:'succeeded',attempt_id:null,lease_until:null,finished_at:stamp});f.commerce_refund_reservations[0].state='captured';Object.assign(f.lots[0],{reserved_units:0,balance_units:0});f.commerce_verified_evidence.push({id:'refund-evidence',account_id:'a',order_id:'order',payment_attempt_id:null,refund_id:'refund',provider:'synthetic',event_id:e.eventId,transaction_id:e.transactionId,outcome:e.outcome,amount:100,currency:'TST',occurred_at:stamp,evidence_hash:fp});f.transactions.push({id:'reversal',account_id:'a',reason:'purchase_refund',source_id:'refund',original_transaction_id:'credit',request_hash:fp});f.entries.push({account_id:'a',transaction_id:'reversal',lot_id:'lot',direction:'debit',units:20})
 assert.equal(verifyGiftCommerceFacts(f).verified,true);f.transactions.at(-1).original_transaction_id='other';assert.throws(()=>verifyGiftCommerceFacts(f),/differs/)
})

test('legacy schema absence is explicit and partial migrations fail; reports contain only counts',async()=>{
 assert.equal((await validateGiftCommerceReferences({},[])).applicable,false)
 assert.equal((await validateGiftCommerceReferences({query:async()=>[]},[{domain:'gifts'}])).reason,'legacy_without_commerce_promotions')
 await assert.rejects(validateGiftCommerceReferences({query:async()=>[{table_name:'commerce_orders'}]},[{domain:'gifts'}]),/differs/)
 const f=paid(),seen=[],runtime={async query(target,sql){seen.push(sql);if(sql.includes('information_schema'))return Object.keys(f).filter(k=>!['lots','transactions','entries'].includes(k)).map(table_name=>({table_name}));const name=/FROM public\.(\w+)/.exec(sql)?.[1];return f[name]??({asset_lots:f.lots,ledger_transactions:f.transactions,ledger_entries:f.entries}[name]??[])}}
 const result=await validateGiftCommerceReferences(runtime,[{domain:'gifts'}]);assert.equal(result.verified,true);assert.equal(result.orderCount,1);assert(!JSON.stringify(result).includes('PRIVATE PRODUCT'));assert(seen.every(q=>!q.includes('private_story')))
})

test('configured checkout metadata keeps immutable launch, deadline and separate bounded error budget across quarantine',()=>{
 const modern=()=>{const f=paid(),j=f.commerce_reconciliation_jobs[0],a=f.commerce_payment_attempts[0];Object.assign(j,{created_at:stamp,deadline_at:'2026-11-15T00:30:00.000Z',error_count:0,attempt_count:12});Object.assign(a,{launch_url:'https://cashier.example.test/pay?private=one',launch_expires_at:j.deadline_at});return f}
 assert.equal(verifyGiftCommerceFacts(modern()).verified,true)
 for(const mutate of [f=>delete f.commerce_reconciliation_jobs[0].error_count,f=>f.commerce_reconciliation_jobs[0].attempt_count=65,f=>f.commerce_reconciliation_jobs[0].error_count=4,f=>f.commerce_reconciliation_jobs[0].deadline_at='2026-11-16T00:30:00.000Z',f=>f.commerce_payment_attempts[0].launch_url='javascript:alert(1)',f=>f.commerce_payment_attempts[0].launch_expires_at='2026-11-15T00:31:00.000Z',f=>delete f.commerce_payment_attempts[0].launch_expires_at]){const f=modern();mutate(f);assert.throws(()=>verifyGiftCommerceFacts(f),/differs/)}
})

test('merchant binding is preserved per operation and a refund cannot switch the frozen payment merchant',()=>{
 const f=refund();f.commerce_payment_attempts[0].provider_binding='a'.repeat(64);f.commerce_refunds[0].provider_binding='a'.repeat(64);assert.equal(verifyGiftCommerceFacts(f).verified,true);f.commerce_refunds[0].provider_binding='b'.repeat(64);assert.throws(()=>verifyGiftCommerceFacts(f),/differs/);f.commerce_refunds[0].provider_binding='a'.repeat(64);f.commerce_payment_attempts[0].provider_binding='invalid';assert.throws(()=>verifyGiftCommerceFacts(f),/differs/)
})
