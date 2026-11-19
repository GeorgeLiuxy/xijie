import 'reflect-metadata'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile,readdir,mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createServer} from 'node:http'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import pg from 'pg'
import {GiftsStore} from '../dist/store.js'
import {CommerceStore} from '../dist/commerce.js'
import {GiftsDataRights} from '../dist/data-rights.js'
import {createGiftsApp} from '../dist/http.js'
import {GiftsError,missing,hash} from '../dist/contracts.js'
import {verifyGiftCommerceFacts} from '../../../../deploy/recovery/gifts-commerce.mjs'
import {configuredIntegration} from '../dist/commerce-provider.js'
import {FinancialOperations} from '../dist/financial-operations.js'
import {financialSnapshotDigest,readFinancialRetention} from '../dist/financial-rights.js'
import {captureSecurityReplay,replaySecurity} from '../../../../deploy/recovery/security-replay.mjs'
process.env.NODE_ENV='test'
async function financialFacts(pool){const f={};for(const name of ['commerce_quotes','commerce_orders','commerce_payment_attempts','commerce_refunds','commerce_refund_reservations','commerce_verified_evidence','commerce_commands','commerce_reconciliation_jobs','referral_reward_awards','referral_reward_receipts','album_reward_receipts','financial_retention_records','commerce_operator_commands','asset_lots','ledger_transactions','ledger_entries'])f[({asset_lots:'lots',ledger_transactions:'transactions',ledger_entries:'entries'})[name]??name]=JSON.parse(JSON.stringify((await pool.query('SELECT * FROM '+name)).rows));return f}
async function fixture(t){
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL;assert(connectionString)
 const schema='gift_commerce_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString}),pool=new pg.Pool({connectionString,options:'-c search_path='+schema,max:10})
 await admin.query('CREATE SCHEMA '+schema);t.after(async()=>{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()})
 for(const name of(await readdir(new URL('../db/',import.meta.url))).filter(n=>/^\d+.*\.sql$/.test(n)).sort())await pool.query(await readFile(new URL('../db/'+name,import.meta.url),'utf8'))
 const account=randomUUID(),other=randomUUID(),personId=randomUUID(),worldId=randomUUID(),conversationId=randomUUID(),sessionId=randomUUID(),requests=new Map(),state={active:true,gift:true,paymentCalls:0,refundCalls:0,inspectionCalls:0,payment:'paid',refund:'refunded'}
 const dependencies={async account(id){if(![account,other].includes(id)||!state.active)throw missing();return{accountId:id,status:'active',accessVersion:1,giftStorage:{allowed:state.gift,authorizationVersion:1}}},async session(cookie,expected){if(cookie!=='synthetic=yes'||expected!==undefined&&expected!==sessionId)throw new GiftsError(401,'UNAUTHORIZED');return{accountId:account,sessionId,expiresAt:new Date(Date.now()+60000).toISOString()}},async person(a,id){return{id,accountId:a,displayName:'Synthetic',worldId,version:1,worldVersion:1,accessVersion:1,status:'active',audience:'person'}},async ensure(a,id){return{id:conversationId,personId:id}},async dataRequest(id){return requests.get(id)}}
 const store=new GiftsStore(pool,dependencies);await store.seedCatalog()
 const product={id:'synthetic-only',version:1,name:'Synthetic test product',units:20,assetType:'postage',assetId:'postage',price:{amount:100,currency:'TST'},channel:'synthetic'}
 const answer=(request,outcome)=>outcome==='pending'?{status:'pending'}:{status:'verified',evidence:{outcome,orderId:request.orderId,operationId:request.operationId,eventId:request.operationId+'-'+outcome,transactionId:request.operationId,amount:request.amount,currency:request.currency,occurredAt:new Date().toISOString()}}
 const provider={name:'synthetic',async startPayment(r){state.paymentCalls++;return answer(r,state.payment)},async inspectPayment(r){state.inspectionCalls++;return answer(r,state.payment)},async startRefund(r){state.refundCalls++;return answer(r,state.refund)},async inspectRefund(r){state.inspectionCalls++;return answer(r,state.refund)}}
 const integration={testOnly:true,products:[product],provider},commerce=new CommerceStore(store,integration),rights=new GiftsDataRights(store)
 const request=(kind='export')=>{const id=randomUUID();requests.set(id,{accountId:account,requestId:id,kind,status:'processing',scope:'account_data',accountStatus:kind==='export'?'active':'deletion_pending',accountAccessVersion:2});return id}
 const count=async table=>(await pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n
 const create=async()=>{const q=await commerce.quote(account,randomUUID(),{productId:product.id,quantity:1,channel:product.channel});return commerce.create(account,randomUUID(),q.quoteId)}
 const pay=async()=>{const order=await create();await commerce.attempt(account,order.orderId,randomUUID());const job=await commerce.claim();assert(job);await commerce.run(job);const result=await commerce.get(account,order.orderId);assert.equal(result.paymentState,'paid');return result}
 const due=()=>pool.query("UPDATE commerce_reconciliation_jobs SET retry_at=clock_timestamp()-interval '1 second' WHERE state='failed'")
 const input=()=>({personId,giftId:'flowers',catalogVersion:1,quantity:1,source:'trial',note:'Synthetic paid asset usage'})
 return{pool,account,other,sessionId,state,dependencies,store,product,provider,integration,commerce,rights,request,count,create,pay,due,input,answer}
}

test('runtime has no merchant/product/channel and read-only HTTP cannot manufacture a payment',async t=>{
 const f=await fixture(t),disabled=new CommerceStore(f.store);assert.deepEqual(await disabled.products(f.account),{data:[],meta:{purchasingEnabled:false}})
 await assert.rejects(disabled.quote(f.account,randomUUID(),{productId:'unconfigured',quantity:1,channel:'stripe'}),{code:'PURCHASE_UNAVAILABLE'})
 assert.equal(await disabled.claim(),undefined)
 const config={webOrigin:'http://127.0.0.1:5184',serviceToken:'1'.repeat(64),conversationsToken:'2'.repeat(64),rightsToken:'3'.repeat(64)},app=await createGiftsApp(config,f.store);await app.listen(0,'127.0.0.1');t.after(()=>app.close());const origin=await app.getUrl(),headers={Cookie:'synthetic=yes',Origin:config.webOrigin,'X-Xijie-Expected-Session':f.sessionId,'Idempotency-Key':randomUUID(),'Content-Type':'application/json'}
 assert.equal((await fetch(origin+'/v1/products',{headers})).status,200)
 const response=await fetch(origin+'/v1/purchase-quotes',{method:'POST',headers,body:JSON.stringify({productId:'unconfigured',quantity:1,channel:'stripe'})});assert.equal(response.status,503);assert.equal((await response.json()).error.code,'PURCHASE_UNAVAILABLE')
 assert.equal((await fetch(origin+'/v1/orders',{headers})).status,200);assert.equal(await f.count('commerce_orders'),0);assert.equal(await f.count('ledger_entries'),0);assert.equal(f.state.paymentCalls,0)
 const old=process.env.NODE_ENV;process.env.NODE_ENV='production';try{assert.throws(()=>new CommerceStore(f.store,f.integration),/isolated tests/)}finally{process.env.NODE_ENV=old}
})

test('quotes, orders and attempts keep exact permanent intent; a verified payment credits once',async t=>{
 const f=await fixture(t),key=randomUUID(),body={productId:f.product.id,quantity:1,channel:'synthetic'},q=await f.commerce.quote(f.account,key,body)
 assert.deepEqual(await f.commerce.quote(f.account,key,body),q);await assert.rejects(f.commerce.quote(f.account,key,{...body,productId:'other'}),{code:'IDEMPOTENCY_CONFLICT'})
 const orderKey=randomUUID(),order=await f.commerce.create(f.account,orderKey,q.quoteId);assert.equal((await f.commerce.create(f.account,orderKey,q.quoteId)).orderId,order.orderId)
 await assert.rejects(f.commerce.create(f.other,randomUUID(),q.quoteId),{code:'NOT_FOUND'})
 const attemptKey=randomUUID();await Promise.all(Array.from({length:5},()=>f.commerce.attempt(f.account,order.orderId,attemptKey)));assert.equal(await f.count('commerce_payment_attempts'),1)
 for(let i=0;i<5;i++)assert.equal((await f.commerce.get(f.account,order.orderId)).paymentState,'confirming');assert.equal(f.state.paymentCalls,0)
 const job=await f.commerce.claim();await f.commerce.run(job);await f.commerce.run(job)
 assert.equal((await f.commerce.get(f.account,order.orderId)).status,'fulfilled');assert.equal(await f.count('ledger_transactions'),1);assert.equal(await f.count('commerce_verified_evidence'),1);assert.equal(f.state.paymentCalls,1)
 assert.equal((await f.store.wallet(f.account)).balances[0].availableUnits,20);assert.equal((await f.store.wallet(f.account)).balances[0].source,'paid')
 await assert.rejects(f.pool.query('UPDATE commerce_quotes SET price_amount=2'),e=>e.code==='42501')
})

test('lost provider response persists the operation and restart inspects it instead of initiating a second charge',async t=>{
 const f=await fixture(t),order=await f.create();let original=f.provider.startPayment;f.provider.startPayment=async r=>{await original(r);throw Error('synthetic response lost')}
 await f.commerce.attempt(f.account,order.orderId,randomUUID());await f.commerce.run(await f.commerce.claim());assert.equal((await f.commerce.get(f.account,order.orderId)).paymentState,'confirming');assert.equal(await f.count('asset_lots'),0)
 await assert.rejects(f.commerce.close(f.account,order.orderId,randomUUID()),{code:'PAYMENT_OUTCOME_UNKNOWN'});await assert.rejects(f.rights.erase(f.account,f.request('delete_account')),{code:'FINANCIAL_RECONCILIATION_REQUIRED'})
 await f.due();const resumed=new CommerceStore(f.store,f.integration);await resumed.run(await resumed.claim());assert.equal((await resumed.get(f.account,order.orderId)).paymentState,'paid');assert.equal(f.state.paymentCalls,1);assert.equal(f.state.inspectionCalls,1)
})

test('wrong account operation, amount or unauthenticated payment-shaped results never issue assets and retry budget is bounded',async t=>{
 const f=await fixture(t),order=await f.create();await f.commerce.attempt(f.account,order.orderId,randomUUID())
 f.provider.startPayment=async r=>{const v=f.answer(r,'paid');v.evidence.amount++;return v};f.provider.inspectPayment=async r=>{const v=f.answer(r,'paid');v.evidence.orderId=randomUUID();return v}
 for(let n=0;n<3;n++){await f.due();await f.commerce.run(await f.commerce.claim())}
 assert.equal(await f.commerce.claim(),undefined);assert.equal(await f.count('ledger_transactions'),0);assert.equal(await f.count('commerce_verified_evidence'),0)
 const j=(await f.pool.query('SELECT * FROM commerce_reconciliation_jobs')).rows[0];assert.equal(j.state,'blocked');assert.equal(j.attempt_count,3);assert.equal(j.failure_code,'PAYMENT_EVIDENCE_INVALID');assert.equal(j.attempt_id,null)
 await assert.rejects(f.pool.query('UPDATE commerce_payment_attempts SET started_at=NULL'),e=>e.code==='42501');await assert.rejects(f.pool.query('UPDATE commerce_reconciliation_jobs SET attempt_count=0'),e=>e.code==='42501')
})

test('refund reservation removes spendability atomically; verified refund captures original paid lot once',async t=>{
 const f=await fixture(t),order=await f.pay(),key=randomUUID();await Promise.all(Array.from({length:4},()=>f.commerce.refund(f.account,order.orderId,key)))
 assert.equal((await f.store.wallet(f.account)).balances[0].availableUnits,0);await assert.rejects(f.store.send(f.account,randomUUID(),f.input()),{code:'INSUFFICIENT_ASSET'})
 assert.equal(await f.count('commerce_refunds'),1);const job=await f.commerce.claim();await f.commerce.run(job);await f.commerce.run(job)
 assert.equal((await f.commerce.get(f.account,order.orderId)).refundStatus,'refunded');const l=(await f.pool.query('SELECT * FROM asset_lots')).rows[0];assert.equal(l.balance_units,0);assert.equal(l.reserved_units,0)
 assert.equal((await f.pool.query("SELECT count(*)::int n FROM ledger_transactions WHERE reason='purchase_refund'")).rows[0].n,1);assert.equal(f.state.refundCalls,1)
 await assert.rejects(f.rights.erase(f.account,f.request('delete_account')),{code:'FINANCIAL_RETENTION_POLICY_REQUIRED'})
})

test('verified failed refund releases, unknown refund remains reserved, and consumption requires explicit review',async t=>{
 const f=await fixture(t),order=await f.pay();f.state.refund='refund_failed';await f.commerce.refund(f.account,order.orderId,randomUUID());await f.commerce.run(await f.commerce.claim())
 assert.equal((await f.store.wallet(f.account)).balances[0].availableUnits,20)
 await f.store.send(f.account,randomUUID(),f.input());const key=randomUUID();await assert.rejects(f.commerce.refund(f.account,order.orderId,key),{code:'REFUND_REQUIRES_REVIEW'});await assert.rejects(f.commerce.refund(f.account,order.orderId,key),{code:'REFUND_REQUIRES_REVIEW'})
 assert.equal((await f.pool.query("SELECT count(*)::int n FROM commerce_refunds WHERE state='review'")).rows[0].n,1);assert.equal(f.state.refundCalls,1)
 const second=await f.pay();f.state.refund='pending';await f.commerce.refund(f.account,second.orderId,randomUUID());await f.commerce.run(await f.commerce.claim());assert.equal((await f.pool.query('SELECT reserved_units FROM asset_lots WHERE issuance_transaction_id=(SELECT credit_transaction_id FROM commerce_orders WHERE id=$1)',[second.orderId])).rows[0].reserved_units,20)
})

test('sender versus refund gets one authority under the account gate without negative balances',async t=>{
 const f=await fixture(t),order=await f.pay(),outcomes=await Promise.allSettled([f.store.send(f.account,randomUUID(),f.input()),f.commerce.refund(f.account,order.orderId,randomUUID())])
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert(['REFUND_REQUIRES_REVIEW','INSUFFICIENT_ASSET'].includes(outcomes.find(r=>r.status==='rejected').reason.code))
 const l=(await f.pool.query('SELECT * FROM asset_lots')).rows[0];assert(l.balance_units>=l.reserved_units&&l.reserved_units>=0)
})

test('unpaid close and rights erase are real; financial export remains available without gift storage',async t=>{
 const f=await fixture(t),order=await f.create(),key=randomUUID();assert.equal((await f.commerce.close(f.account,order.orderId,key)).status,'closed');assert.equal((await f.commerce.close(f.account,order.orderId,key)).status,'closed');await f.rights.erase(f.account,f.request('delete_account'))
 for(const table of ['commerce_quotes','commerce_orders','commerce_commands','commerce_reconciliation_jobs'])assert.equal(await f.count(table),0)
 const g=await fixture(t);await g.pay();g.state.gift=false;const exported=await g.rights.export(g.account,g.request(),'account_data');assert.equal(exported.data.orders.length,1);assert.equal(exported.data.paymentEvidence.length,1);assert.equal(exported.data.paymentAttempts.length,1);assert.equal(exported.data.lots[0].source,'paid')
})

test('expired payment claim cannot apply a late provider answer; resumed work inspects one durable operation',async t=>{
 const f=await fixture(t),order=await f.create();let release,entered;const start=new Promise(r=>entered=r)
 f.provider.startPayment=async r=>{f.state.paymentCalls++;entered();return new Promise(resolve=>release=()=>resolve(f.answer(r,'paid')))}
 await f.commerce.attempt(f.account,order.orderId,randomUUID());const old=await f.commerce.claim(),pending=f.commerce.run(old);await start
 await f.pool.query("UPDATE commerce_reconciliation_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[old.id]);const fresh=await f.commerce.claim();assert(fresh);release();await pending
 assert.equal(await f.count('ledger_transactions'),0);await f.commerce.run(fresh);assert.equal(await f.count('ledger_transactions'),1);assert.equal(f.state.paymentCalls,1);assert.equal(f.state.inspectionCalls,1)
})

test('shutdown aborts in-flight transport without credit and a new worker only inspects',async t=>{
 const f=await fixture(t),order=await f.create();let entered;const start=new Promise(r=>entered=r)
 f.provider.startPayment=async()=>{f.state.paymentCalls++;entered();return new Promise(()=>{})}
 await f.commerce.attempt(f.account,order.orderId,randomUUID());const pending=f.commerce.run(await f.commerce.claim());await start;f.commerce.stop();await pending
 assert.equal(await f.count('ledger_entries'),0);await f.due();const resumed=new CommerceStore(f.store,f.integration);await resumed.run(await resumed.claim());assert.equal(f.state.paymentCalls,1);assert.equal(f.state.inspectionCalls,1)
})

test('native checks reject detached evidence, forged paid state and reservation drift',async t=>{
 const f=await fixture(t),order=await f.create(),second=await f.create();await f.commerce.attempt(f.account,second.orderId,randomUUID());const attempt=(await f.pool.query('SELECT id FROM commerce_payment_attempts WHERE order_id=$1',[second.orderId])).rows[0].id
 await assert.rejects(f.pool.query("INSERT INTO commerce_verified_evidence(id,account_id,order_id,payment_attempt_id,provider,event_id,transaction_id,outcome,amount,currency,evidence_hash,occurred_at) VALUES($1,$2,$3,$4,'synthetic','bad-event','bad-transaction','paid',100,'TST',$5,clock_timestamp())",[randomUUID(),f.account,order.orderId,attempt,'0'.repeat(64)]),e=>e.code==='23514')
 await assert.rejects(f.pool.query("UPDATE commerce_orders SET payment_state='paid',paid_at=clock_timestamp() WHERE id=$1",[order.orderId]),e=>e.code==='23514')
 await f.commerce.run(await f.commerce.claim());await assert.rejects(f.pool.query('UPDATE asset_lots SET reserved_units=1'),e=>e.code==='23514')
})

test('recovery closure accepts actual PostgreSQL paid, reserved and captured rows without weakening evidence',async t=>{
 const f=await fixture(t),order=await f.pay(),names=['commerce_quotes','commerce_orders','commerce_payment_attempts','commerce_refunds','commerce_refund_reservations','commerce_verified_evidence','commerce_commands','commerce_reconciliation_jobs','referral_reward_awards','referral_reward_receipts','album_reward_receipts']
 const read=async()=>{const rows={};for(const name of [...names,'asset_lots','ledger_transactions','ledger_entries'])rows[({asset_lots:'lots',ledger_transactions:'transactions',ledger_entries:'entries'})[name]??name]=JSON.parse(JSON.stringify((await f.pool.query('SELECT * FROM '+name)).rows));return rows}
 assert.equal(verifyGiftCommerceFacts(await read()).orderCount,1)
 await f.commerce.refund(f.account,order.orderId,randomUUID());assert.equal(verifyGiftCommerceFacts(await read()).refundCount,1)
 await f.commerce.run(await f.commerce.claim());assert.equal(verifyGiftCommerceFacts(await read()).verified,true)
})

test('real checkout waiting preserves one launch and transport identity without exhausting the error budget or leaking launch into export',async t=>{
 const f=await fixture(t),order=await f.create();let launch
 f.provider.startPayment=async r=>{f.state.paymentCalls++;launch={type:'redirect',url:'https://cashier.example.test/cashier/index.html?private=one#/hub/token',expiresAt:r.expiresAt};return{status:'pending',launch}}
 f.provider.inspectPayment=async()=>{f.state.inspectionCalls++;return{status:'pending',launch}}
 await f.commerce.attempt(f.account,order.orderId,randomUUID());for(let i=0;i<6;i++){await f.due();await f.commerce.run(await f.commerce.claim())}
 const job=(await f.pool.query('SELECT * FROM commerce_reconciliation_jobs')).rows[0];assert.equal(job.attempt_count,6);assert.equal(job.error_count,0);assert.equal(job.state,'failed');assert.equal(f.state.paymentCalls,1);assert.equal(f.state.inspectionCalls,5)
 const view=await f.commerce.get(f.account,order.orderId);assert.deepEqual(view.attemptSummary.launch,launch);assert.equal(await f.count('ledger_entries'),0)
 const exported=await f.rights.export(f.account,f.request(),'account_data');assert(!JSON.stringify(exported).includes('private=one'));assert.equal(Date.parse(exported.data.paymentAttempts[0].launch_expires_at),Date.parse(launch.expiresAt))
 await assert.rejects(f.pool.query("UPDATE commerce_payment_attempts SET launch_url='https://cashier.example.test/changed'"),e=>e.code==='42501')
 await assert.rejects(f.pool.query("UPDATE commerce_reconciliation_jobs SET deadline_at=deadline_at+interval '1 hour'"),e=>e.code==='42501')
 const prepared=await f.pool.query('SELECT * FROM commerce_reconciliation_jobs');for(let i=0;i<3;i++)await f.commerce.get(f.account,order.orderId);assert.deepEqual((await f.pool.query('SELECT * FROM commerce_reconciliation_jobs')).rows,prepared.rows)
 f.provider.inspectPayment=async()=>({status:'pending',launch:{...launch,url:'https://cashier.example.test/another'}});await f.due();await f.commerce.run(await f.commerce.claim());assert.equal((await f.pool.query('SELECT error_count FROM commerce_reconciliation_jobs')).rows[0].error_count,1)
})

test('refund transport receives original successful payment operation and normal pending stays reserved',async t=>{
 const f=await fixture(t),order=await f.pay(),payment=(await f.pool.query("SELECT id FROM commerce_payment_attempts WHERE state='succeeded'")).rows[0].id;let captured
 f.provider.startRefund=async r=>{captured=r;f.state.refundCalls++;return{status:'pending'}}
 await f.commerce.refund(f.account,order.orderId,randomUUID());await f.commerce.run(await f.commerce.claim());assert.equal(captured.paymentOperationId,payment);assert.notEqual(captured.operationId,payment);assert.equal(f.state.refundCalls,1)
 const job=(await f.pool.query("SELECT * FROM commerce_reconciliation_jobs WHERE kind='refund'")).rows[0];assert.equal(job.error_count,0);assert.equal(job.state,'failed');assert(job.deadline_at-job.created_at>=86400000);assert.equal((await f.pool.query('SELECT reserved_units FROM asset_lots')).rows[0].reserved_units,20)
})

test('signed callback only wakes known work for authoritative inspection; it cannot revive blocked recovery or credit through a GET',async t=>{
 const f=await fixture(t),product={...f.product,channel:'jeepay'},provider={...f.provider,name:'jeepay',verifyNotification(body){return body?.signed==='yes'?{kind:'payment',operationId:body.operationId}:null}},commerce=new CommerceStore(f.store,configuredIntegration({products:[product],provider}));f.state.payment='pending'
 const create=async()=>{const q=await commerce.quote(f.account,randomUUID(),{productId:product.id,quantity:1,channel:product.channel});return commerce.create(f.account,randomUUID(),q.quoteId)},order=await create()
 await commerce.attempt(f.account,order.orderId,randomUUID());await commerce.run(await commerce.claim());const operation=(await f.pool.query('SELECT id FROM commerce_payment_attempts')).rows[0].id
 const config={webOrigin:'http://127.0.0.1:5184',serviceToken:'1'.repeat(64),conversationsToken:'2'.repeat(64),rightsToken:'3'.repeat(64)},app=await createGiftsApp(config,f.store,commerce);await app.listen(0,'127.0.0.1');t.after(()=>app.close());const origin=await app.getUrl()
 const notify=body=>fetch(origin+'/v1/callbacks/payments/jeepay',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)})
 assert.equal((await notify({signed:'no',operationId:operation})).status,403);const before=(await f.pool.query('SELECT retry_at FROM commerce_reconciliation_jobs')).rows[0].retry_at
 const response=await notify({signed:'yes',operationId:operation});assert.equal(response.status,200);assert.equal(await response.text(),'success');assert((await f.pool.query('SELECT retry_at FROM commerce_reconciliation_jobs')).rows[0].retry_at<before);assert.equal(await f.count('ledger_entries'),0)
 f.state.payment='paid';const headers={Cookie:'synthetic=yes','X-Xijie-Expected-Session':f.sessionId};assert.equal((await fetch(origin+'/v1/orders/'+order.orderId,{headers})).status,200);assert.equal(await f.count('ledger_entries'),0)
 await commerce.run(await commerce.claim());assert.equal(await f.count('ledger_entries'),1);assert.equal(f.state.paymentCalls,1);assert.equal(f.state.inspectionCalls,1)
 const another=await create();f.state.payment='pending';await commerce.attempt(f.account,another.orderId,randomUUID());await commerce.run(await commerce.claim());await f.pool.query("UPDATE commerce_reconciliation_jobs SET state='blocked',finished_at=clock_timestamp(),failure_code='RESTORE_REVIEW_REQUIRED' WHERE order_id=$1",[another.orderId]);const attempt=(await f.pool.query('SELECT id FROM commerce_payment_attempts WHERE order_id=$1',[another.orderId])).rows[0].id;assert.equal((await notify({signed:'yes',operationId:attempt})).status,200);assert.equal(await commerce.claim(),undefined)
 assert.equal((await notify({signed:'yes',operationId:randomUUID()})).status,404)
})

test('two configured gateways keep each quoted channel, frozen operation provider and refund on the same gateway',async t=>{
 const f=await fixture(t),counts={jeepay:0,hyperswitch:0,refunds:0},providers=Object.fromEntries(['jeepay','hyperswitch'].map(name=>[name,{...f.provider,name,async startPayment(r){counts[name]++;assert.equal(r.channel,name);return f.answer(r,'paid')},async startRefund(r){counts.refunds++;assert.equal(r.channel,name);assert(r.paymentOperationId);return f.answer(r,'refunded')}}])),products=Object.keys(providers).map(channel=>({...f.product,id:'product-'+channel,channel})),integration=configuredIntegration({products,provider:providers.jeepay,providers}),commerce=new CommerceStore(f.store,integration),orders=[]
 for(const product of products){const q=await commerce.quote(f.account,randomUUID(),{productId:product.id,quantity:1,channel:product.channel}),o=await commerce.create(f.account,randomUUID(),q.quoteId);orders.push(o);await commerce.attempt(f.account,o.orderId,randomUUID());await commerce.run(await commerce.claim());assert.equal((await commerce.get(f.account,o.orderId)).paymentState,'paid')}
 assert.deepEqual(counts,{jeepay:1,hyperswitch:1,refunds:0});const evidence=(await f.pool.query('SELECT provider FROM commerce_verified_evidence ORDER BY provider')).rows;assert.deepEqual(evidence.map(v=>v.provider),['hyperswitch','jeepay'])
 await commerce.refund(f.account,orders[1].orderId,randomUUID());await commerce.run(await commerce.claim());assert.equal(counts.refunds,1)
 const missing=new CommerceStore(f.store,configuredIntegration({...integration,providers:{jeepay:providers.jeepay}})),q=await commerce.quote(f.account,randomUUID(),{productId:products[1].id,quantity:1,channel:'hyperswitch'}),unpaid=await commerce.create(f.account,randomUUID(),q.quoteId);await assert.rejects(missing.attempt(f.account,unpaid.orderId,randomUUID()),{code:'PURCHASE_UNAVAILABLE'});assert.equal(counts.jeepay,1)
})

test('international notification validates exact raw JSON bytes and headers before scheduling a query',async t=>{
 const f=await fixture(t),product={...f.product,channel:'hyperswitch'},provider={...f.provider,name:'hyperswitch',verifyNotification(body,raw,headers){return raw?.toString()===' { "operationId": "'+body.operationId+'" }\n'&&headers?.['x-webhook-signature-512']==='fixture-signature'?{kind:'payment',operationId:body.operationId}:null}},commerce=new CommerceStore(f.store,configuredIntegration({products:[product],provider}));f.state.payment='pending'
 const q=await commerce.quote(f.account,randomUUID(),{productId:product.id,quantity:1,channel:product.channel}),o=await commerce.create(f.account,randomUUID(),q.quoteId);await commerce.attempt(f.account,o.orderId,randomUUID());await commerce.run(await commerce.claim());const operation=(await f.pool.query('SELECT id FROM commerce_payment_attempts')).rows[0].id
 const config={webOrigin:'http://127.0.0.1:5184',serviceToken:'1'.repeat(64),conversationsToken:'2'.repeat(64),rightsToken:'3'.repeat(64)},app=await createGiftsApp(config,f.store,commerce);await app.listen(0,'127.0.0.1');t.after(()=>app.close());const origin=await app.getUrl(),headers={'Content-Type':'application/json','x-webhook-signature-512':'fixture-signature'}
 assert.equal((await fetch(origin+'/v1/callbacks/payments/hyperswitch',{method:'POST',headers,body:JSON.stringify({operationId:operation})})).status,403)
 const exact=' { "operationId": "'+operation+'" }\n';assert.equal((await fetch(origin+'/v1/callbacks/payments/hyperswitch',{method:'POST',headers,body:exact})).status,200);assert.equal(await f.count('ledger_entries'),0)
 assert.equal((await fetch(origin+'/v1/callbacks/payments/hyperswitch',{method:'POST',headers,body:JSON.stringify({operationId:operation,padding:'x'.repeat(33000)})})).status,413)
 f.state.payment='paid';await commerce.run(await commerce.claim());assert.equal(await f.count('ledger_entries'),1);f.state.refund='pending';await commerce.refund(f.account,o.orderId,randomUUID());await commerce.run(await commerce.claim());const refund=(await f.pool.query('SELECT id FROM commerce_refunds')).rows[0].id
 provider.verifyNotification=(body,raw,h)=>raw?.toString()===' { "operationId": "'+body.operationId+'" }\n'&&h?.['x-webhook-signature-512']==='fixture-signature'?{kind:'refund',operationId:body.operationId}:null
 const before=(await f.pool.query("SELECT retry_at FROM commerce_reconciliation_jobs WHERE kind='refund'")).rows[0].retry_at;assert.equal((await fetch(origin+'/v1/callbacks/payments/hyperswitch',{method:'POST',headers,body:' { "operationId": "'+refund+'" }\n'})).status,200);assert((await f.pool.query("SELECT retry_at FROM commerce_reconciliation_jobs WHERE kind='refund'")).rows[0].retry_at<before);assert.equal(await f.count('ledger_entries'),1);assert.equal((await commerce.get(f.account,o.orderId)).refundStatus,'pending')
})

test('changing configured merchant binding blocks a frozen operation before dispatch and before a late credit',async t=>{
 const f=await fixture(t),order=await f.create();f.provider.binding='a'.repeat(64);await f.commerce.attempt(f.account,order.orderId,randomUUID());f.provider.binding='b'.repeat(64);await f.commerce.run(await f.commerce.claim());assert.equal(f.state.paymentCalls,0);let job=(await f.pool.query('SELECT * FROM commerce_reconciliation_jobs')).rows[0];assert.equal(job.state,'blocked');assert.equal(job.failure_code,'PROVIDER_CONFIGURATION_CHANGED');assert.equal(await f.count('ledger_entries'),0)
 await assert.rejects(f.pool.query("UPDATE commerce_payment_attempts SET provider_binding=$1",['c'.repeat(64)]),e=>e.code==='42501')
 const second=await f.create();await f.commerce.attempt(f.account,second.orderId,randomUUID());let enter,release;const entered=new Promise(resolve=>enter=resolve);f.provider.startPayment=async r=>{f.state.paymentCalls++;enter();return new Promise(resolve=>release=()=>resolve(f.answer(r,'paid')))};const pending=f.commerce.run(await f.commerce.claim());await entered;f.provider.binding='d'.repeat(64);release();await pending;job=(await f.pool.query('SELECT * FROM commerce_reconciliation_jobs WHERE order_id=$1',[second.orderId])).rows[0];assert.equal(job.state,'blocked');assert.equal(job.failure_code,'PROVIDER_CONFIGURATION_CHANGED');assert.equal(await f.count('ledger_entries'),0)
})

test('financial preflight refuses unresolved facts or missing policy before touching private rows; approved archive strips private data and survives erasure',async t=>{
 assert.equal(readFinancialRetention({}),undefined);assert.throws(()=>readFinancialRetention({GIFTS_FINANCIAL_RETENTION_DAYS:'30'}));assert.deepEqual(readFinancialRetention({GIFTS_FINANCIAL_RETENTION_DAYS:'30',GIFTS_FINANCIAL_RETENTION_POLICY_VERSION:'operator-approved-v1'}),{days:30,version:'operator-approved-v1'})
 const f=await fixture(t),order=await f.pay(),request=f.request('delete_account');await assert.rejects(f.rights.preflight(f.account,request),{code:'FINANCIAL_RETENTION_POLICY_REQUIRED'});assert.equal(await f.count('commerce_orders'),1);assert.equal((await f.pool.query('SELECT erased_at FROM gifts_account_write_gates WHERE account_id=$1',[f.account])).rows[0].erased_at,null)
 f.store.options.financialRetention={version:'test-policy-v1',days:30};const plan=await f.rights.preflight(f.account,request);assert.equal(plan.financialRetention.status,'retained');assert.equal((await f.rights.preflight(f.account,request)).financialRetention.archiveId,plan.financialRetention.archiveId)
 const archive=(await f.pool.query('SELECT * FROM financial_retention_records')).rows[0];assert.equal(archive.payload_hash,financialSnapshotDigest(archive.payload));for(const forbidden of ['account_id','launch_url','note','person_id','story','request_hash','acceptance_key','product_snapshot'])assert(!JSON.stringify(archive.payload).includes('"'+forbidden+'"'));assert.equal(archive.payload.orders[0].id,order.orderId)
 f.store.options.financialRetention=undefined;const erased=await f.rights.erase(f.account,request);assert.equal(erased.financialRetention.status,'retained');assert.equal(erased.financialRetention.archiveId,archive.id);assert.equal((await f.rights.erase(f.account,request)).financialRetention.archiveId,archive.id)
 for(const table of ['commerce_orders','commerce_payment_attempts','commerce_verified_evidence','ledger_entries','asset_lots','ledger_transactions','outbox_events','commerce_operator_commands'])assert.equal(await f.count(table),0);assert.equal(await f.count('financial_retention_records'),1);const facts=await financialFacts(f.pool);facts.deletionRequests=[{id:request,account_id:f.account,kind:'delete_account',scope:'account_data'}];assert.equal(verifyGiftCommerceFacts(facts).financialOperations.retainedFinancialArchiveCount,1)
 for(const change of [p=>p.orders[0].price_amount++,p=>p.orders[0].person_id=randomUUID(),p=>delete p.orders[0].created_at]){const broken=structuredClone(facts),record=broken.financial_retention_records[0];change(record.payload);record.payload_hash=financialSnapshotDigest(record.payload);assert.throws(()=>verifyGiftCommerceFacts(broken),/differs/)}const foreign=structuredClone(facts);foreign.deletionRequests[0].account_id=randomUUID();assert.throws(()=>verifyGiftCommerceFacts(foreign),/differs/)
 await assert.rejects(f.pool.query('DELETE FROM financial_retention_records'),e=>e.code==='42501');const ops=new FinancialOperations(f.store,f.commerce);assert.equal((await ops.purge(randomUUID(),'fixture-operator','scheduled')).resultCode,'PURGED_0')
})

test('operator query-only checks preserve original dispatch and worker budgets, audit exactly once, and never revive restore quarantine',async t=>{
 const f=await fixture(t),order=await f.create(),ops=new FinancialOperations(f.store,f.commerce);f.state.payment='pending';await f.commerce.attempt(f.account,order.orderId,randomUUID());await f.commerce.run(await f.commerce.claim());const a=(await f.pool.query('SELECT id FROM commerce_payment_attempts')).rows[0].id;await f.pool.query("UPDATE commerce_reconciliation_jobs SET state='blocked',failure_code='PAYMENT_OUTCOME_UNKNOWN',finished_at=clock_timestamp()")
 const base={accountId:f.account,kind:'payment',resourceId:a,action:'recheck',reviewer:'finance-operator',reasonCode:'customer_receipt'},first={...base,id:randomUUID()};assert.equal((await ops.execute(first)).resultCode,'PAYMENT_OUTCOME_UNKNOWN');assert.equal((await ops.execute(first)).replay,true);assert.equal(f.state.paymentCalls,1);assert.equal(f.state.inspectionCalls,1)
 const before=(await f.pool.query('SELECT attempt_count,error_count,deadline_at FROM commerce_reconciliation_jobs')).rows[0];f.state.payment='paid';assert.equal((await ops.execute({...base,id:randomUUID()})).resultCode,'VERIFIED_APPLIED');assert.equal(await f.count('ledger_entries'),1);assert.equal(f.state.paymentCalls,1);assert.deepEqual((await f.pool.query('SELECT attempt_count,error_count,deadline_at FROM commerce_reconciliation_jobs')).rows[0],before);assert.equal(await f.count('commerce_operator_commands'),2)
 const second=await f.create();f.state.payment='pending';await f.commerce.attempt(f.account,second.orderId,randomUUID());await f.commerce.run(await f.commerce.claim());const next=(await f.pool.query('SELECT id FROM commerce_payment_attempts WHERE order_id=$1',[second.orderId])).rows[0].id;await f.pool.query("UPDATE commerce_reconciliation_jobs SET state='blocked',failure_code='RESTORE_REVIEW_REQUIRED',finished_at=clock_timestamp() WHERE order_id=$1",[second.orderId]);await assert.rejects(ops.execute({...base,id:randomUUID(),resourceId:next}),{code:'RESTORE_REVIEW_REQUIRED'})
 const third=await f.create();await f.commerce.attempt(f.account,third.orderId,randomUUID());const last=(await f.pool.query('SELECT id FROM commerce_payment_attempts WHERE order_id=$1',[third.orderId])).rows[0].id;await f.pool.query("UPDATE commerce_reconciliation_jobs SET state='blocked',failure_code='PAYMENT_OUTCOME_UNKNOWN',finished_at=clock_timestamp(),recovery_blocked=true WHERE order_id=$1",[third.orderId]);await assert.rejects(ops.execute({...base,id:randomUUID(),resourceId:last}),{code:'RESTORE_REVIEW_REQUIRED'});await assert.rejects(f.pool.query('UPDATE commerce_reconciliation_jobs SET recovery_blocked=false WHERE order_id=$1',[third.orderId]),e=>e.code==='42501')
})

test('refund review cannot invent money: rejection is audited, approval requires original available paid lots and dispatches only original refund once',async t=>{
 const f=await fixture(t),order=await f.pay(),ops=new FinancialOperations(f.store,f.commerce);await f.store.send(f.account,randomUUID(),f.input());await assert.rejects(f.commerce.refund(f.account,order.orderId,randomUUID()),{code:'REFUND_REQUIRES_REVIEW'});const refund=(await f.pool.query('SELECT id FROM commerce_refunds')).rows[0].id,base={accountId:f.account,kind:'refund',resourceId:refund,reviewer:'finance-operator',reasonCode:'consumed_original_assets'}
 await assert.rejects(ops.execute({...base,id:randomUUID(),action:'refund_approve'}),{code:'REFUND_ASSETS_UNAVAILABLE'});assert.equal(f.state.refundCalls,0);assert.equal((await ops.execute({...base,id:randomUUID(),action:'refund_reject'})).resultCode,'REFUND_REVIEW_REJECTED');assert.equal((await f.commerce.get(f.account,order.orderId)).refund.failureCode,'OPERATOR_REFUND_REJECTED');assert.equal(verifyGiftCommerceFacts(await financialFacts(f.pool)).financialOperations.operatorCommandCount,1)
 const g=await fixture(t),paid=await g.pay(),go=new FinancialOperations(g.store,g.commerce);await g.pool.query("INSERT INTO commerce_refunds(id,account_id,order_id,acceptance_key,request_hash,provider,amount,currency,state,failure_code,finished_at) VALUES($1,$2,$3,$4,$5,'synthetic',100,'TST','review','REFUND_REQUIRES_REVIEW',clock_timestamp())",[randomUUID(),g.account,paid.orderId,randomUUID(),hash(JSON.stringify({orderId:paid.orderId}))]);const id=(await g.pool.query('SELECT id FROM commerce_refunds')).rows[0].id,input={id:randomUUID(),accountId:g.account,kind:'refund',resourceId:id,action:'refund_approve',reviewer:'finance-operator',reasonCode:'verified_available'};assert.equal((await go.execute(input)).resultCode,'REFUND_APPROVED');assert.equal((await g.commerce.get(g.account,paid.orderId)).refundStatus,'refunded');assert.equal(g.state.refundCalls,1);assert.equal((await go.execute(input)).replay,true);assert.equal(g.state.refundCalls,1)
 g.store.options.financialRetention={version:'refund-fixture-v1',days:30};await g.rights.erase(g.account,g.request('delete_account'));const retained=await financialFacts(g.pool);assert.equal(verifyGiftCommerceFacts(retained).financialOperations.retainedFinancialArchiveCount,1);for(const change of [p=>p.refunds[0].debit_transaction_id=randomUUID(),p=>p.transactions.find(t=>t.reason==='purchase_refund').original_transaction_id=randomUUID(),p=>p.entries.find(e=>e.direction==='debit').units--]){const broken=structuredClone(retained),r=broken.financial_retention_records[0];change(r.payload);r.payload_hash=financialSnapshotDigest(r.payload);assert.throws(()=>verifyGiftCommerceFacts(broken),/differs/)}
})

test('operator reconciliation settles an accepted deletion using its own request context and the finite extra query budget',async t=>{
 const f=await fixture(t),order=await f.create(),ops=new FinancialOperations(f.store,f.commerce);f.state.payment='pending';await f.commerce.attempt(f.account,order.orderId,randomUUID());await f.commerce.run(await f.commerce.claim());const operation=(await f.pool.query('SELECT id FROM commerce_payment_attempts')).rows[0].id;await f.pool.query("UPDATE commerce_reconciliation_jobs SET state='blocked',finished_at=clock_timestamp(),failure_code='PAYMENT_OUTCOME_UNKNOWN'");const base={accountId:f.account,kind:'payment',resourceId:operation,action:'recheck',reviewer:'operator',reasonCode:'uncertain_result'}
 for(let i=0;i<9;i++)assert.equal((await ops.execute({...base,id:randomUUID()})).resultCode,'PAYMENT_OUTCOME_UNKNOWN');const request=f.request('delete_account');f.state.active=false;f.state.payment='paid';assert.equal((await ops.execute({...base,id:randomUUID(),deletionRequestId:request})).resultCode,'VERIFIED_APPLIED');assert.equal(f.state.paymentCalls,1);assert.equal(f.state.inspectionCalls,10)
 const g=await fixture(t),go=new FinancialOperations(g.store,g.commerce),o=await g.create();g.state.payment='pending';await g.commerce.attempt(g.account,o.orderId,randomUUID());await g.commerce.run(await g.commerce.claim());const a=(await g.pool.query('SELECT id FROM commerce_payment_attempts')).rows[0].id;await g.pool.query("UPDATE commerce_reconciliation_jobs SET state='blocked',finished_at=clock_timestamp(),failure_code='PAYMENT_OUTCOME_UNKNOWN'");for(let i=0;i<10;i++)await go.execute({...base,id:randomUUID(),accountId:g.account,resourceId:a});await assert.rejects(go.execute({...base,id:randomUUID(),accountId:g.account,resourceId:a}),{code:'OPERATOR_CHECK_BUDGET_EXHAUSTED'})
})

test('only an undispatched blocked payment can be canceled, and expired retained records are actually purged without retaining their account in purge audit',async t=>{
 const f=await fixture(t),order=await f.create(),ops=new FinancialOperations(f.store,f.commerce);await f.commerce.attempt(f.account,order.orderId,randomUUID());const attempt=(await f.pool.query('SELECT id FROM commerce_payment_attempts')).rows[0].id;await f.pool.query("UPDATE commerce_reconciliation_jobs SET state='blocked',failure_code='PROVIDER_CONFIGURATION_CHANGED',finished_at=clock_timestamp()");assert.equal((await ops.execute({id:randomUUID(),accountId:f.account,kind:'payment',resourceId:attempt,action:'cancel_unstarted',reviewer:'operator',reasonCode:'never_dispatched'})).resultCode,'UNDISPATCHED_CLOSED');assert.equal((await f.commerce.get(f.account,order.orderId)).status,'closed');assert.equal(f.state.paymentCalls,0)
 const request=f.request('delete_account');await f.rights.erase(f.account,request);const archive=randomUUID();await f.pool.query("INSERT INTO financial_retention_records(id,account_id,request_id,policy_version,retention_days,created_at,retain_until,payload,payload_hash) VALUES($1,$2,$3,'fixture-expired',1,clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day','{}',$4)",[archive,f.account,request,financialSnapshotDigest({})]);assert.equal((await ops.purge(randomUUID(),'operator','retention_expired')).resultCode,'PURGED_1');assert.equal(await f.count('financial_retention_records'),0);assert.equal((await f.pool.query("SELECT count(*)::int n FROM commerce_operator_commands WHERE action='purge_retention' AND account_id IS NOT NULL")).rows[0].n,0)
 await f.pool.query("INSERT INTO financial_retention_records(id,account_id,request_id,policy_version,retention_days,created_at,retain_until,payload,payload_hash) VALUES($1,$2,$3,'fixture-expired',1,clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day','{}',$4)",[randomUUID(),f.account,request,financialSnapshotDigest({})]);await f.pool.query('UPDATE financial_retention_records SET recovery_blocked=true');assert.equal((await ops.purge(randomUUID(),'operator','retention_expired')).resultCode,'PURGED_0');await assert.rejects(f.pool.query('DELETE FROM financial_retention_records'),e=>e.code==='42501');await assert.rejects(f.pool.query('UPDATE financial_retention_records SET recovery_blocked=false'),e=>e.code==='42501')
})

test('the actual operator CLI requires its independent private credential and audits a real read against only the isolated account',async t=>{
 const f=await fixture(t),order=await f.create();await f.commerce.attempt(f.account,order.orderId,randomUUID());const attempt=(await f.pool.query('SELECT id FROM commerce_payment_attempts')).rows[0].id,folder=await mkdtemp(join(tmpdir(),'xijie-ops-fixture-')),file=join(folder,'operator.key'),secret='f'.repeat(64);await writeFile(file,secret+'\n',{mode:0o600});t.after(async()=>{await unlink(file);await rmdir(folder)})
 const server=createServer((req,res)=>{if(req.method!=='GET'||req.url!=='/internal/v1/accounts/'+f.account+'/context'||req.headers.authorization!=='Bearer '+'1'.repeat(64)){res.writeHead(404);res.end('{}');return}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:{accountId:f.account,status:'active',accessVersion:1}}))});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const origin='http://127.0.0.1:'+server.address().port,schema=(await f.pool.query('SELECT current_schema() name')).rows[0].name,connection=new URL(process.env.XIJIE_TEST_DATABASE_URL);assert(/^gift_commerce_[a-f0-9]+$/.test(schema));connection.searchParams.set('options','-c search_path='+schema)
 const env={...process.env,NODE_ENV:'test',GIFTS_COMMERCE_ENABLED:'false',GIFTS_AI_ENABLED:'false',DATABASE_URL:connection.href,GIFTS_OPERATOR_ENABLED:'true',GIFTS_OPERATOR_CREDENTIAL_FILE:file,XIJIE_FINANCIAL_OPERATOR_TOKEN:secret,GIFTS_WEB_ORIGIN:'http://127.0.0.1:5184',XIJIE_GIFTS_SERVICE_TOKEN:'1'.repeat(64),XIJIE_CONVERSATIONS_SERVICE_TOKEN:'2'.repeat(64),XIJIE_DATA_RIGHTS_SERVICE_TOKEN:'3'.repeat(64),XIJIE_IDENTITY_URL:origin,XIJIE_PEOPLE_URL:origin,XIJIE_CONVERSATIONS_URL:origin},run=promisify(execFile),args=[resolve('dist/commerce-ops.js'),'read',randomUUID(),f.account,'payment',attempt,'fixture-operator','verify_read'];const result=await run(process.execPath,args,{env,windowsHide:true,timeout:15000});assert.equal(JSON.parse(result.stdout).resource.id,attempt);assert(!result.stdout.includes(secret));assert.equal(await f.count('commerce_operator_commands'),1)
 await assert.rejects(run(process.execPath,[...args.slice(0,2),randomUUID(),...args.slice(3)],{env:{...env,XIJIE_FINANCIAL_OPERATOR_TOKEN:'e'.repeat(64)},windowsHide:true,timeout:15000}),e=>e.code===1&&e.stderr.includes('OPERATOR_CREDENTIAL_REQUIRED'));assert.equal(await f.count('commerce_operator_commands'),1)
})

test('security replay applies a newer paid-account erasure and its exact minimized retained archive without reviving the old ledger or changing retention',async t=>{
 const f=await fixture(t);await f.pay();const schema=(await f.pool.query('SELECT current_schema() n')).rows[0].n;assert(/^gift_commerce_[a-f0-9]+$/.test(schema));const target={domain:'gifts',kind:'target',runId:randomUUID()},convert=sql=>sql.replaceAll("n.nspname='public'","n.nspname='"+schema+"'").replaceAll('"public".','"'+schema+'".'),runtime={async query(t,sql){assert.equal(t,target);const rows=(await f.pool.query(convert(sql))).rows;return sql.includes('c.relkind AS kind')?rows.map(r=>({...r,schema:'public',foreignKeys:r.foreignKeys.map(k=>({...k,parentSchema:'public'}))})):rows},async sql(t,sql){assert.equal(t,target);return f.pool.query(convert(sql))},async assertIsolatedTarget(t){assert.equal(t,target);assert.equal((await f.pool.query('SELECT current_schema() n')).rows[0].n,schema)}},old=await captureSecurityReplay(runtime,target),rows=new Map()
 for(const t of old.tables)rows.set(t.name,(await f.pool.query('SELECT to_jsonb(r) AS row FROM "'+schema+'"."'+t.name+'" r')).rows.map(r=>r.row))
 f.store.options.financialRetention={version:'replay-fixture-v1',days:30};const receipt=await f.rights.erase(f.account,f.request('delete_account')),latest=await captureSecurityReplay(runtime,target),archive=(await f.pool.query('SELECT id,retain_until,payload_hash FROM financial_retention_records')).rows[0]
 const db=await f.pool.connect();try{await db.query("BEGIN;SET LOCAL session_replication_role='replica';TRUNCATE "+old.tables.map(t=>'"'+schema+'"."'+t.name+'"').join(',')+' CASCADE');for(const t of old.tables){const values=rows.get(t.name);if(!values.length)continue;const cols=t.columns.filter(c=>!c.generated).map(c=>'"'+c.name+'"').join(',');await db.query('INSERT INTO "'+schema+'"."'+t.name+'"('+cols+') SELECT '+cols+' FROM jsonb_populate_recordset(NULL::"'+schema+'"."'+t.name+'",$1::jsonb)',[JSON.stringify(values)])}await db.query('COMMIT')}finally{db.release()}
 assert.equal(await f.count('commerce_orders'),1);assert.equal(await f.count('financial_retention_records'),0);const proof=await replaySecurity(runtime,target,latest,{deletedAccounts:[f.account]});assert(proof.invalidatedRows>0);assert.equal(await f.count('commerce_orders'),0);assert.equal(await f.count('ledger_transactions'),0);assert.deepEqual((await f.pool.query('SELECT id,retain_until,payload_hash FROM financial_retention_records')).rows[0],archive);assert.deepEqual((await f.pool.query('SELECT financial_retention FROM gifts_erase_receipts')).rows[0].financial_retention,receipt.financialRetention)
 const changed=structuredClone(latest);changed.tables.find(t=>t.name==='financial_retention_records').rows[0].hash='f'.repeat(64);await assert.rejects(replaySecurity(runtime,target,changed,{deletedAccounts:[f.account]}),/retained financial archive changed/)
 const missing=structuredClone(latest),table=missing.tables.find(t=>t.name==='financial_retention_records');table.rows=[];table.safeRows=[];await assert.rejects(replaySecurity(runtime,target,missing,{deletedAccounts:[f.account]}),/before its retention expired/)
})
