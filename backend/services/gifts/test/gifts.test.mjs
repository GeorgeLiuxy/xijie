import 'reflect-metadata'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,randomBytes} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import pg from 'pg'
import {GiftsStore} from '../dist/store.js'
import {GiftsDataRights} from '../dist/data-rights.js'
import {displayable,GiftsError,missing} from '../dist/contracts.js'
import {createGiftsApp} from '../dist/http.js'

async function fixture(t){
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL;assert(connectionString)
 const schema='gifts_test_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString}),pool=new pg.Pool({connectionString,options:'-c search_path='+schema,max:8})
 await admin.query('CREATE SCHEMA '+schema)
 await pool.query(await readFile(new URL('../db/001_gifts.sql',import.meta.url),'utf8'))
 await pool.query(await readFile(new URL('../db/002_person_gift_returns.sql',import.meta.url),'utf8'))
 await pool.query(await readFile(new URL('../db/003_gift_delivery_photos.sql',import.meta.url),'utf8'))
 await pool.query(await readFile(new URL('../db/004_referral_rewards.sql',import.meta.url),'utf8'))
 await pool.query(await readFile(new URL('../db/005_album_rewards.sql',import.meta.url),'utf8'))
 await pool.query(await readFile(new URL('../db/006_commerce_core.sql',import.meta.url),'utf8'))
 await pool.query(await readFile(new URL('../db/007_jeepay_checkout.sql',import.meta.url),'utf8'))
 await pool.query(await readFile(new URL('../db/008_financial_operations.sql',import.meta.url),'utf8'))
 t.after(async()=>{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()})
 const account=randomUUID(),personId=randomUUID(),conversationId=randomUUID(),worldId=randomUUID(),sessionId=randomUUID(),requests=new Map(),state={allowed:true,authorizationVersion:1,person:true,projectFailure:false,projected:[]}
 const dependencies={
  async account(id){if(id!==account)throw missing();return {accountId:id,status:'active',accessVersion:1,giftStorage:{allowed:state.allowed,authorizationVersion:state.authorizationVersion}}},
  async session(cookie,expected){if(cookie!=='test=ok'||expected!==undefined&&expected!==sessionId)throw new GiftsError(401,'UNAUTHORIZED');return {accountId:account,sessionId,expiresAt:new Date(Date.now()+60000).toISOString(),giftStorage:{allowed:state.allowed,authorizationVersion:state.authorizationVersion}}},
  async person(a,id){if(a!==account||id!==personId||!state.person)throw missing();return {id,accountId:account,displayName:'Synthetic Gift Person',worldId,version:1,worldVersion:1,accessVersion:1,status:'active',audience:'person'}},
  async ensure(a,id){await this.person(a,id);return {id:conversationId,personId:id}},
  async project(a,d){if(state.projectFailure)throw new GiftsError(503,'DEPENDENCY_UNAVAILABLE');state.projected.push(d)},
  async dataRequest(id){if(!requests.has(id))throw missing();return requests.get(id)},
 }
 const store=new GiftsStore(pool,dependencies);await store.seedCatalog()
 const input=(source='trial',giftId='flowers',quantity=1)=>({personId,giftId,catalogVersion:1,quantity,source,note:'Synthetic note'})
 const grant=(postage=20,vouchers=1,inventory={})=>store.grantTrial(account,'synthetic-trial-v1:case',{postage,vouchers,inventory})
 const due=()=>pool.query("UPDATE gift_deliveries SET created_at=clock_timestamp()-interval '10 seconds',scheduled_arrival_at=clock_timestamp()-interval '1 second' WHERE account_id=$1",[account])
 const job=async kind=>{await pool.query("UPDATE gifts_jobs SET retry_at=clock_timestamp()-interval '1 second' WHERE kind=$1",[kind]);await pool.query("UPDATE gifts_jobs SET retry_at=clock_timestamp()+interval '1 hour' WHERE kind<>$1 AND state IN('queued','failed')",[kind]);return store.claim()}
 const request=(kind='export')=>{const id=randomUUID();requests.set(id,{accountId:account,requestId:id,kind,scope:'account_data',accountStatus:kind==='export'?'active':'deletion_pending',accountAccessVersion:2});return id}
 return {pool,store,account,personId,sessionId,state,input,grant,due,job,request,dependencies}
}
test('wallet reads do not grant; explicit trial grant is immutable and idempotent',async t=>{
 const f=await fixture(t);assert.deepEqual((await f.store.wallet(f.account)).balances,[])
 const first=await f.grant();assert.deepEqual(await f.grant(),first)
 await assert.rejects(f.grant(21),{code:'IDEMPOTENCY_CONFLICT'})
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM ledger_transactions')).rows[0].n,1)
 await assert.rejects(f.pool.query('UPDATE ledger_entries SET units=units+1'),e=>e.code==='42501')
 await assert.rejects(f.pool.query('DELETE FROM ledger_transactions'),e=>e.code==='42501')
})
test('two distinct commands racing for the final voucher debit once; permanent accepted replay keeps exact funding source',async t=>{
 const f=await fixture(t);await f.grant(0,1);const keys=[randomUUID(),randomUUID()]
 const results=await Promise.allSettled(keys.map(key=>f.store.send(f.account,key,f.input('voucher'))))
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'INSUFFICIENT_ASSET')
 const index=results.findIndex(r=>r.status==='fulfilled'),first=results[index].value
 assert.equal((await f.store.send(f.account,keys[index],f.input('voucher'))).id,first.id)
 await assert.rejects(f.store.send(f.account,keys[index],f.input('trial')),{code:'IDEMPOTENCY_CONFLICT'})
 assert.equal((await f.pool.query("SELECT count(*)::int n FROM ledger_transactions WHERE reason='gift_debit'")).rows[0].n,1)
 assert.equal((await f.store.wallet(f.account)).balances.find(b=>b.assetType==='voucher').availableUnits,0)
})
test('catalog/version/quantity/voucher checks preserve assets, free gifts require no ledger',async t=>{
 const f=await fixture(t);await f.grant();const count=async()=>(await f.pool.query('SELECT count(*)::int n FROM ledger_transactions')).rows[0].n
 await assert.rejects(f.store.send(f.account,randomUUID(),{...f.input(),catalogVersion:2}),{code:'CATALOG_VERSION_CHANGED'})
 await assert.rejects(f.store.send(f.account,randomUUID(),f.input('voucher','flowers',2)),{code:'VOUCHER_NOT_APPLICABLE'})
 await assert.rejects(f.store.send(f.account,randomUUID(),f.input('trial','photo-projection')),{code:'GIFT_UNAVAILABLE'})
 assert.equal(await count(),1)
 const free=await f.store.send(f.account,randomUUID(),f.input('trial','paper-crane'));assert.equal(free.cost,0);assert.equal(free.debitTransactionId,null);assert.equal(await count(),1)
})
test('Eastern keepsakes seed without changing existing gifts, debit the selected asset once, and retain their receipt snapshots',async t=>{
 const f=await fixture(t)
 const paperCrane=(await f.store.catalog(f.account)).find(gift=>gift.id==='paper-crane')
 await f.store.seedCatalog()
 assert.deepEqual((await f.store.catalog(f.account)).find(gift=>gift.id==='paper-crane'),paperCrane)
 assert.deepEqual((await f.store.wallet(f.account)).balances,[])
 await f.grant(5,1)
 const catalogue=await f.store.catalog(f.account,f.personId)
 const slip=catalogue.find(gift=>gift.id==='spark-wish-slip')
 const lantern=catalogue.find(gift=>gift.id==='blessing-river-lantern')
 assert.deepEqual([slip.cost,lantern.cost,displayable(slip),displayable(lantern)],[2,5,false,true])
 assert(slip.availableSources.includes('voucher')&&lantern.availableSources.includes('voucher'))
 await assert.rejects(f.store.send(f.account,randomUUID(),f.input('trial',lantern.id,2)),{code:'VALIDATION_FAILED'})
 const key=randomUUID(),voucherInput=f.input('voucher',slip.id)
 const sealed=await f.store.send(f.account,key,voucherInput),lamp=await f.store.send(f.account,randomUUID(),f.input('trial',lantern.id))
 assert.equal(sealed.giftSnapshot.name,'星火心愿笺')
 assert.equal(lamp.giftSnapshot.name,'祈福河灯')
 assert.equal(lamp.personId,f.personId)
 assert.equal(lamp.cost,5)
 assert.equal((await f.store.send(f.account,key,voucherInput)).id,sealed.id)
 const debits=(await f.store.ledger(f.account,10)).filter(item=>item.reason==='gift_debit')
 assert.deepEqual(debits.map(item=>item.entries.map(entry=>[entry.assetType,entry.units])).flat().sort(),[['postage',5],['voucher',1]])
 assert.deepEqual((await f.store.list(f.account,10,{displayable:true})).items,[])
 await f.due()
 await f.store.run(await f.job('deliver'))
 await f.store.run(await f.job('deliver'))
 assert.deepEqual((await f.store.list(f.account,10,{displayable:true})).items.map(item=>item.id),[lamp.id])
})
test('delivery arrival, failed projection retry and duplicate worker completion never duplicate the debit or event',async t=>{
 const f=await fixture(t);await f.grant();const delivery=await f.store.send(f.account,randomUUID(),f.input());await f.due();const j=await f.job('deliver');await f.store.run(j);await f.store.run(j)
 assert.equal((await f.store.get(f.account,delivery.id)).status,'arrived')
 f.state.projectFailure=true;const p=await f.job('project');await f.store.run(p);assert.equal((await f.pool.query('SELECT state FROM gifts_jobs WHERE id=$1',[p.id])).rows[0].state,'failed')
 f.state.projectFailure=false;await f.store.run(await f.job('project'));assert(f.state.projected.some(d=>d.status==='arrived'))
 assert.equal((await f.pool.query("SELECT count(*)::int n FROM ledger_transactions WHERE reason='gift_debit'")).rows[0].n,1)
 assert.equal((await f.pool.query("SELECT count(*)::int n FROM outbox_events WHERE type='GiftDeliveryArrived.v1'")).rows[0].n,1)
})
test('arrival versus definite failure has one terminal outcome; reversal credits exact original entries at most once',async t=>{
 const f=await fixture(t);await f.grant();const delivery=await f.store.send(f.account,randomUUID(),f.input());await f.due();const j=await f.job('deliver')
 await Promise.all([f.store.settle(j,true),f.store.settle(j,false)])
 const row=await f.store.row(f.account,delivery.id);assert(['arrived','delivery_failed'].includes(row.status))
 const reversals=(await f.pool.query("SELECT count(*)::int n FROM ledger_transactions WHERE reason='gift_reversal'")).rows[0].n;assert.equal(reversals,row.status==='delivery_failed'?1:0)
 await f.store.settle(j,true);assert.equal((await f.pool.query("SELECT count(*)::int n FROM ledger_transactions WHERE reason='gift_reversal'")).rows[0].n,reversals)
})
test('withdraw and regrant cannot resume an accepted old-authority delivery or project its note',async t=>{
 const f=await fixture(t);await f.grant();const delivery=await f.store.send(f.account,randomUUID(),f.input());await f.due();f.state.allowed=false;f.state.authorizationVersion=2
 await f.store.run(await f.job('deliver'));let row=await f.store.row(f.account,delivery.id);assert.equal(row.status,'delivery_failed');assert.equal(row.failure_code,'AUTHORIZATION_CHANGED')
 f.state.allowed=true;f.state.authorizationVersion=3;await f.store.run(await f.job('project'));assert.equal(f.state.projected.length,0)
 assert.equal((await f.store.wallet(f.account)).balances.find(b=>b.assetType==='postage').availableUnits,20)
 assert.equal((await f.store.get(f.account,delivery.id)).status,'delivery_failed')
 await assert.rejects(f.store.source(f.account,delivery.id),{code:'NOT_FOUND'})
})
test('expired assets are never charged even while a sender waits behind the account gate',async t=>{
 const f=await fixture(t);await f.grant(3,0)
 await f.pool.query("UPDATE asset_lots SET expires_at=clock_timestamp()+interval '150 milliseconds' WHERE account_id=$1",[f.account])
 const blocker=await f.pool.connect();await blocker.query('BEGIN');await blocker.query('SELECT * FROM gifts_account_write_gates WHERE account_id=$1 FOR UPDATE',[f.account])
 const sent=f.store.send(f.account,randomUUID(),f.input());await new Promise(resolve=>setTimeout(resolve,200));await blocker.query('COMMIT');blocker.release()
 await assert.rejects(sent,{code:'INSUFFICIENT_ASSET'});assert.equal((await f.pool.query('SELECT count(*)::int n FROM gift_deliveries')).rows[0].n,0)
})
test('source removal and expired original lots cannot create new spendable refunded assets',async t=>{
 const f=await fixture(t);await f.grant();const delivery=await f.store.send(f.account,randomUUID(),f.input());await f.due();await f.pool.query("UPDATE asset_lots SET issued_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour' WHERE account_id=$1",[f.account]);f.state.person=false;await f.store.run(await f.job('deliver'))
 assert.equal((await f.store.row(f.account,delivery.id)).status,'delivery_failed');assert.deepEqual((await f.store.wallet(f.account)).balances,[])
 assert.equal((await f.pool.query("SELECT balance_units FROM asset_lots WHERE asset_type='postage'")).rows[0].balance_units,20)
})
test('rights export remains available after withdrawal, erasure removes all trial records and fences late jobs',async t=>{
 const f=await fixture(t);await f.grant();const delivery=await f.store.send(f.account,randomUUID(),f.input()),job=await f.job('project');f.state.allowed=false
 const rights=new GiftsDataRights(f.store),data=await rights.export(f.account,f.request(),'account_data');assert.equal(data.data.deliveries.length,1);assert.equal(data.data.transactions.length,2)
 const request=f.request('delete_account');assert.equal((await rights.erase(f.account,request)).alreadyErased,false);assert.equal((await rights.erase(f.account,request)).alreadyErased,true)
 await f.store.run(job);for(const table of ['asset_lots','ledger_transactions','ledger_entries','gift_deliveries','gifts_jobs','outbox_events'])assert.equal((await f.pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n,0)
 f.state.allowed=true;await assert.rejects(f.store.send(f.account,randomUUID(),f.input()),{code:'NOT_FOUND'});await assert.rejects(f.store.grantTrial(f.account,'later',{postage:5,vouchers:0,inventory:{}}),{code:'NOT_FOUND'})
})
test('real Nest routes require same-origin current session and internal role; lost-response retry is one receipt',async t=>{
 const f=await fixture(t);await f.grant();const config={webOrigin:'http://127.0.0.1:5184',serviceToken:randomBytes(32).toString('hex'),conversationsToken:randomBytes(32).toString('hex'),rightsToken:randomBytes(32).toString('hex')},app=await createGiftsApp(config,f.store);await app.listen(0,'127.0.0.1');t.after(()=>app.close());const origin=await app.getUrl(),key=randomUUID(),headers={Cookie:'test=ok',Origin:config.webOrigin,'X-Xijie-Expected-Session':f.sessionId,'Idempotency-Key':key,'Content-Type':'application/json'},send=extra=>fetch(origin+'/v1/gift-deliveries',{method:'POST',headers:{...headers,...extra},body:JSON.stringify(f.input())})
 assert.equal((await send({Origin:'https://bad.example'})).status,403);assert.equal((await send({'X-Xijie-Expected-Session':randomUUID()})).status,401)
 const first=await send();assert.equal(first.status,201);const data=(await first.json()).data;assert.equal((await(await send()).json()).data.id,data.id)
 let response=await fetch(origin+'/internal/v1/gifts/deliveries/'+data.id+'?accountId='+f.account,{headers:{Authorization:'Bearer '+config.serviceToken}});assert.equal(response.status,403)
 response=await fetch(origin+'/internal/v1/gifts/deliveries/'+data.id+'?accountId='+f.account,{headers:{Authorization:'Bearer '+config.conversationsToken}});assert.equal(response.status,200);assert.equal((await response.json()).data.accountId,f.account)
})
