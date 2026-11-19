import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import pg from 'pg'
import {GiftsStore} from '../dist/store.js'
import {GiftsDataRights} from '../dist/data-rights.js'
import {ReferralRewardsStore,ReferralRewardsWorker} from '../dist/referrals.js'
import {Dependencies} from '../dist/dependencies.js'
import {AlbumRewardsStore} from '../dist/promotions.js'
import {createGiftsApp} from '../dist/http.js'
import {missing} from '../dist/contracts.js'
import {verifyGiftCommerceFacts} from '../../../../deploy/recovery/gifts-commerce.mjs'

async function fixture(t){
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL;assert(connectionString)
 const schema='gift_referrals_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString}),pool=new pg.Pool({connectionString,options:'-c search_path='+schema,max:12})
 await admin.query('CREATE SCHEMA '+schema)
 t.after(async()=>{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()})
 for(const name of ['001_gifts.sql','002_person_gift_returns.sql','003_gift_delivery_photos.sql','004_referral_rewards.sql','005_album_rewards.sql','006_commerce_core.sql','007_jeepay_checkout.sql','008_financial_operations.sql'])await pool.query(await readFile(new URL('../db/'+name,import.meta.url),'utf8'))
 const host=randomUUID(),guest=randomUUID(),personId=randomUUID(),worldId=randomUUID(),conversationId=randomUUID(),requests=new Map(),accounts=new Map([host,guest].map(accountId=>[accountId,{accountId,status:'active',accessVersion:1,giftStorage:{allowed:false,authorizationVersion:1}}]))
 const p={id:randomUUID(),campaign:'first-memory-v1',inviterAccountId:host,inviteeAccountId:guest,registeredAt:new Date(Date.now()-20000).toISOString()}
 const q={eventId:randomUUID(),confirmedAt:new Date(Date.now()-10000).toISOString(),confirmedSeq:'9007199254740993',origin:'manual'}
 const dependencies={async account(id){const a=accounts.get(id);if(!a||a.status!=='active')throw missing();return structuredClone(a)},async person(accountId,id){await this.account(accountId);return{id,accountId,displayName:'Synthetic Person',worldId,version:1,worldVersion:1,accessVersion:1,status:'active',audience:'person'}},async ensure(a,id){return{id:conversationId,personId:id}},async project(){},async dataRequest(id){return requests.get(id)},async pendingReferrals(){return{items:[p],nextCursor:null}},async referralQualification(){return q},async acknowledgeReferral(receipt){return{id:receipt.referralId,state:'rewarded',qualifiedAt:receipt.qualifiedAt,rewardedAt:new Date().toISOString(),receiptId:receipt.receiptId}}}
 const store=new GiftsStore(pool,dependencies),rewards=new ReferralRewardsStore(store),worker=new ReferralRewardsWorker(rewards),rights=new GiftsDataRights(store);await store.seedCatalog()
 const request=(a,kind='export')=>{const id=randomUUID();requests.set(id,{accountId:a,requestId:id,kind,scope:'account_data',accountStatus:kind==='export'?'active':'deletion_pending',accountAccessVersion:2});return id}
 const count=async table=>(await pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n
 const input=(giftId='flowers',quantity=1)=>({personId,giftId,catalogVersion:1,quantity,source:'voucher',note:'Synthetic reward usage'})
 return{pool,host,guest,accounts,p,q,dependencies,store,rewards,worker,rights,request,count,input}
}

test('paired reward needs no private storage consent, is concurrent-idempotent and grants no trial assets',async t=>{
 const f=await fixture(t),all=await Promise.all(Array.from({length:12},()=>f.rewards.award(f.p,f.q)))
 assert.equal(new Set(all.map(x=>x.receiptId)).size,1)
 for(const [table,n]of [['referral_reward_awards',1],['referral_reward_receipts',2],['ledger_transactions',2],['ledger_entries',2],['asset_lots',2]])assert.equal(await f.count(table),n)
 assert.equal((await f.pool.query("SELECT count(*)::int n FROM asset_lots WHERE source='promotion' AND balance_units=1 AND expires_at IS NULL")).rows[0].n,2)
 await assert.rejects(f.store.wallet(f.host),{code:'GIFT_STORAGE_PERMISSION_REQUIRED'})
 assert.equal(f.accounts.get(f.host).giftStorage.allowed,false)
 f.accounts.get(f.host).giftStorage.allowed=true
 assert.equal((await f.store.wallet(f.host)).balances[0].source,'promotion')
 assert.equal((await f.store.wallet(f.host)).balances[0].availableUnits,1)
 const facts={};for(const name of ['asset_lots','ledger_transactions','ledger_entries','referral_reward_awards','referral_reward_receipts'])facts[({asset_lots:'lots',ledger_transactions:'transactions',ledger_entries:'entries'})[name]??name]=JSON.parse(JSON.stringify((await f.pool.query('SELECT * FROM '+name)).rows));assert.equal(verifyGiftCommerceFacts(facts).referralAwardCount,1)
 await assert.rejects(f.rewards.award(f.p,{...f.q,eventId:randomUUID()}),{code:'IDEMPOTENCY_CONFLICT'})
 await assert.rejects(f.rewards.existing({...f.p,registeredAt:new Date(Date.now()-30000).toISOString()}),{code:'REFERRAL_SOURCE_CHANGED'})
 await assert.rejects(f.pool.query('UPDATE referral_reward_receipts SET qualified_at=qualified_at'),e=>e.code==='42501')
 await assert.rejects(f.pool.query('DELETE FROM referral_reward_awards'),e=>e.code==='42501')
})

test('opposing pairs use sorted gates and a second-benefit failure rolls the entire award back',async t=>{
 const f=await fixture(t)
 await Promise.all([f.rewards.award(f.p,f.q),f.rewards.award({...f.p,id:randomUUID(),inviterAccountId:f.guest,inviteeAccountId:f.host},f.q)])
 assert.equal(await f.count('ledger_transactions'),4)
 await f.pool.query("CREATE FUNCTION reject_guest() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.role='guest' THEN RAISE EXCEPTION 'synthetic failure' USING ERRCODE='23514';END IF;RETURN NEW;END$$;CREATE TRIGGER reject_guest BEFORE INSERT ON referral_reward_receipts FOR EACH ROW EXECUTE FUNCTION reject_guest()")
 await assert.rejects(f.rewards.award({...f.p,id:randomUUID()},f.q),e=>e.code==='23514')
 assert.equal(await f.count('ledger_transactions'),4);assert.equal(await f.count('referral_reward_awards'),2)
})

test('one final promotion voucher has one winner and definite delivery failure reverses its exact original lot once',async t=>{
 const f=await fixture(t);await f.rewards.award(f.p,f.q);f.accounts.get(f.host).giftStorage.allowed=true
 const results=await Promise.allSettled([f.store.send(f.host,randomUUID(),f.input()),f.store.send(f.host,randomUUID(),f.input())])
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.code,'INSUFFICIENT_ASSET')
 const d=results.find(x=>x.status==='fulfilled').value
 await f.pool.query("UPDATE gift_deliveries SET created_at=clock_timestamp()-interval '10 seconds',scheduled_arrival_at=clock_timestamp()-interval '1 second' WHERE id=$1",[d.id])
 await f.pool.query("UPDATE gifts_jobs SET retry_at=CASE WHEN kind='deliver' THEN clock_timestamp()-interval '1 second' ELSE clock_timestamp()+interval '1 hour' END")
 const job=await f.store.claim();assert.equal(job.kind,'deliver');await f.store.settle(job,true);await f.store.settle(job,true)
 const lot=(await f.pool.query('SELECT * FROM asset_lots WHERE account_id=$1',[f.host])).rows[0];assert.equal(lot.balance_units,1);assert.equal(lot.source,'promotion')
 const tx=(await f.pool.query("SELECT * FROM ledger_transactions WHERE reason='gift_reversal'")).rows;assert.equal(tx.length,1)
 assert.equal((await f.pool.query('SELECT lot_id FROM ledger_entries WHERE transaction_id=$1',[tx[0].id])).rows[0].lot_id,lot.id)
 assert.equal((await f.store.row(f.host,d.id)).status,'delivery_failed')
 await assert.rejects(f.store.send(f.host,randomUUID(),f.input('flowers',2)),{code:'VOUCHER_NOT_APPLICABLE'})
})

test('lost acknowledgement replays permanent receipt without re-reading or replacing deleted qualification',async t=>{
 const f=await fixture(t);let lost=true,reads=0,acks=0
 f.dependencies.referralQualification=async()=>{reads++;if(reads>1)throw Error('qualification source is no longer accessible');return f.q}
 f.dependencies.acknowledgeReferral=async r=>{acks++;if(lost){lost=false;throw Error('lost response')}assert.equal(r.receiptId,(await f.rewards.existing(f.p)).receiptId)}
 assert.deepEqual(await f.worker.poll(),{scanned:1,awarded:1,acknowledged:0,failed:1})
 assert.deepEqual(await new ReferralRewardsWorker(f.rewards).poll(),{scanned:1,awarded:0,acknowledged:1,failed:0})
 assert.equal(reads,1);assert.equal(acks,2);assert.equal(await f.count('ledger_transactions'),2)
})

test('pending pagination advances past ineligible candidates and wraps without inventing qualification',async t=>{
 const f=await fixture(t),first=Array.from({length:20},()=>({...f.p,id:randomUUID(),inviteeAccountId:randomUUID()})).sort((a,b)=>a.id.localeCompare(b.id)),seen=[]
 f.dependencies.pendingReferrals=async after=>{seen.push(after);return after?{items:[f.p],nextCursor:null}:{items:first,nextCursor:first.at(-1).id}}
 f.dependencies.referralQualification=async a=>a===f.guest?f.q:null
 assert.equal((await f.worker.poll()).awarded,0);assert.equal((await f.worker.poll()).awarded,1);await f.worker.poll()
 assert.deepEqual(seen,[undefined,first.at(-1).id,undefined]);assert.equal(await f.count('referral_reward_awards'),1)
})

test('earlier or future confirmations and inactive accounts cannot receive benefits',async t=>{
 const f=await fixture(t)
 await assert.rejects(f.rewards.award(f.p,{...f.q,confirmedAt:new Date(Date.parse(f.p.registeredAt)-1).toISOString()}),{code:'REFERRAL_NOT_QUALIFIED'})
 await assert.rejects(f.rewards.award(f.p,{...f.q,confirmedAt:new Date(Date.now()+60000).toISOString()}),{code:'REFERRAL_NOT_QUALIFIED'})
 f.accounts.get(f.guest).status='deletion_pending';await assert.rejects(f.rewards.award(f.p,f.q),{code:'NOT_FOUND'})
 assert.equal(await f.count('ledger_transactions'),0)
})

test('erasing either participant removes shared identity but preserves the survivor earned benefit; late input cannot resurrect',async t=>{
 const f=await fixture(t);await f.rewards.award(f.p,f.q)
 const before=await f.rights.export(f.host,f.request(f.host),'account_data');assert.equal(before.data.referralRewards.length,1)
 assert(!JSON.stringify(before).includes(f.guest));assert(!JSON.stringify(before).includes(f.q.eventId))
 await f.rights.erase(f.guest,f.request(f.guest,'delete_account'))
 assert.equal(await f.count('referral_reward_awards'),0);assert.equal(await f.count('referral_reward_receipts'),1);assert.equal(await f.count('asset_lots'),1)
 // Simulate an already in-flight pre-erasure Identity result: the permanent local gate remains authoritative.
 await assert.rejects(f.rewards.award(f.p,f.q),{code:'NOT_FOUND'});assert.equal(await f.rewards.existing(f.p),undefined)
 const after=await f.rights.export(f.host,f.request(f.host),'account_data');assert.deepEqual(after.data.referralRewards,before.data.referralRewards);assert(!JSON.stringify(after).includes(f.guest))
 await f.rights.erase(f.host,f.request(f.host,'delete_account'))
 for(const table of ['referral_reward_awards','referral_reward_receipts','asset_lots','ledger_transactions','ledger_entries','outbox_events'])assert.equal(await f.count(table),0)
 assert.equal(await f.count('gifts_account_write_gates'),2);assert.equal(await f.count('gifts_erase_receipts'),2)
})

test('a suspended pre-award account read cannot bypass an erase committed before the pair gates',async t=>{
 const f=await fixture(t),original=f.dependencies.account.bind(f.dependencies);let release,observed;const entered=new Promise(r=>observed=r),wait=new Promise(r=>release=r)
 f.dependencies.account=async id=>{const a=await original(id);if(id===f.guest){observed();await wait}return a}
 const pending=f.rewards.award(f.p,f.q);await entered;await f.rights.erase(f.guest,f.request(f.guest,'delete_account'));release()
 await assert.rejects(pending,{code:'NOT_FOUND'});assert.equal(await f.count('ledger_transactions'),0)
})

test('internal referral adapter enforces exact ownership, campaign, cursor, milestone and acknowledgement metadata',async()=>{
 const host=randomUUID(),guest=randomUUID(),referralId=randomUUID(),receiptId=randomUUID(),eventId=randomUUID(),now=new Date().toISOString(),seen=[]
 const p={id:referralId,campaign:'first-memory-v1',inviterAccountId:host,inviteeAccountId:guest,registeredAt:now},receipt={receiptId,referralId,qualifiedAt:now}
 let body={data:[p],meta:{nextCursor:null}}
 const deps=new Dependencies({serviceToken:'synthetic-token',identityOrigin:'http://identity.local',memoriesOrigin:'http://memories.local'},async(url,init)=>{seen.push({url:String(url),init});return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}})})
 assert.deepEqual((await deps.pendingReferrals()).items,[p]);assert.equal(seen[0].init.headers.Authorization,'Bearer synthetic-token');assert(seen[0].url.endsWith('/internal/v1/referrals/pending?limit=20'))
 body={data:[{...p,campaign:'unapproved'}],meta:{nextCursor:null}};await assert.rejects(deps.pendingReferrals(),{code:'DEPENDENCY_UNAVAILABLE'})
 body={data:[p],meta:{nextCursor:randomUUID()}};await assert.rejects(deps.pendingReferrals(),{code:'DEPENDENCY_UNAVAILABLE'})
 body={data:{accountId:host,qualification:null}};await assert.rejects(deps.referralQualification(guest),{code:'DEPENDENCY_UNAVAILABLE'})
 body={data:{accountId:guest,qualification:{eventId,confirmedAt:now,confirmedSeq:'1',origin:'shared_contribution'}}};await assert.rejects(deps.referralQualification(guest),{code:'DEPENDENCY_UNAVAILABLE'})
 body={data:{accountId:guest,qualification:{eventId,confirmedAt:now,confirmedSeq:'9007199254740993',origin:'ai_candidate'}}};assert.equal((await deps.referralQualification(guest)).confirmedSeq,'9007199254740993')
 body={data:{id:referralId,state:'rewarded',qualifiedAt:now,rewardedAt:now,receiptId}};await deps.acknowledgeReferral(receipt);assert.deepEqual(JSON.parse(seen.at(-1).init.body),{receiptId,qualifiedAt:now})
 body.data.receiptId=randomUUID();await assert.rejects(deps.acknowledgeReferral(receipt),{code:'DEPENDENCY_UNAVAILABLE'})
})

test('Social-only album reward accepts no arbitrary amount and grants one independently of gift storage',async t=>{
 const f=await fixture(t),album=randomUUID(),rewards=new AlbumRewardsStore(f.store),rows=await Promise.all(Array.from({length:8},()=>rewards.reward(f.host,album)))
 assert.equal(new Set(rows.map(r=>r.receiptId)).size,1);assert.equal(await f.count('album_reward_receipts'),1)
 const config={webOrigin:'http://127.0.0.1:5184',serviceToken:'1'.repeat(64),conversationsToken:'2'.repeat(64),rightsToken:'3'.repeat(64),socialToken:'4'.repeat(64)},app=await createGiftsApp(config,f.store);await app.listen(0,'127.0.0.1');t.after(()=>app.close());const origin=await app.getUrl(),path=origin+'/internal/v1/promotions/shared-albums/'+album+'/reward'
 const send=(token,body={})=>fetch(path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','X-Xijie-Account-Id':f.host},body:JSON.stringify(body)})
 assert.equal((await send(config.serviceToken)).status,403);assert.equal((await send(config.socialToken,{units:2})).status,422)
 assert.deepEqual((await(await send(config.socialToken)).json()).data,rows[0])
 assert.deepEqual((await(await fetch(path,{headers:{Authorization:'Bearer '+config.socialToken,'X-Xijie-Account-Id':f.host}})).json()).data,rows[0]);await assert.rejects(rewards.get(f.guest,album),{code:'NOT_FOUND'});assert.equal(await f.count('album_reward_receipts'),1)
 const exported=await f.rights.export(f.host,f.request(f.host),'account_data');assert.equal(exported.data.albumRewards.length,1)
 await f.rights.erase(f.host,f.request(f.host,'delete_account'));await assert.rejects(rewards.reward(f.host,album),{code:'NOT_FOUND'});assert.equal(await f.count('album_reward_receipts'),0)
})
