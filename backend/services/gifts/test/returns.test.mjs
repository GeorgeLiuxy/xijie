import 'reflect-metadata'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,randomBytes} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import pg from 'pg'
import {GiftsStore} from '../dist/store.js'
import {GiftReturnsStore} from '../dist/returns.js'
import {GiftsDataRights} from '../dist/data-rights.js'
import {GiftsError,missing} from '../dist/contracts.js'
import {createGiftsApp} from '../dist/http.js'

const provenance={provider:'openai',model:'synthetic-model',responseId:'synthetic-response',promptVersion:'person-gift-returns-v1'}
const gift=()=>({decision:'gift',giftId:'flowers',note:'A synthetic return note.',provenance})
async function fixture(t,options={}){
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL;assert(connectionString)
 const schema='gift_returns_test_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString}),pool=new pg.Pool({connectionString,options:'-c search_path='+schema,max:10})
 await admin.query('CREATE SCHEMA '+schema)
 t.after(async()=>{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()})
 for(const name of ['001_gifts.sql','002_person_gift_returns.sql','003_gift_delivery_photos.sql','004_referral_rewards.sql','005_album_rewards.sql','006_commerce_core.sql','007_jeepay_checkout.sql','008_financial_operations.sql'])await pool.query(await readFile(new URL('../db/'+name,import.meta.url),'utf8'))
 const account=randomUUID(),personId=randomUUID(),conversationId=randomUUID(),worldId=randomUUID(),sessionId=randomUUID(),requests=new Map()
 const state={giftAllowed:true,giftVersion:1,storyAllowed:true,storyVersion:1,returnAllowed:true,returnVersion:1,person:true,personVersion:1,worldVersion:1,modelCalls:0,projected:[],projectFailure:false,generate:async()=>gift()}
 const permissions=()=>({giftStorage:{allowed:state.giftAllowed,authorizationVersion:state.giftVersion},storyStorage:{allowed:state.storyAllowed,authorizationVersion:state.storyVersion},giftReturns:{allowed:state.returnAllowed,authorizationVersion:state.returnVersion}})
 const dependencies={
  async account(id){if(id!==account)throw missing();return{accountId:id,status:'active',accessVersion:1,...permissions()}},
  async session(cookie,expected){if(cookie!=='test=ok'||expected!==undefined&&expected!==sessionId)throw new GiftsError(401,'UNAUTHORIZED');return{accountId:account,sessionId,expiresAt:new Date(Date.now()+60000).toISOString(),...permissions()}},
  async person(a,id){if(a!==account||id!==personId||!state.person)throw missing();return{id,accountId:account,displayName:'Synthetic Return Person',worldId,version:state.personVersion,worldVersion:state.worldVersion,accessVersion:1,status:'active',audience:'person'}},
  async returnContext(a,id,rv,sv){if(!state.returnAllowed||!state.storyAllowed||rv!==state.returnVersion||sv!==state.storyVersion)throw new GiftsError(409,'AUTHORIZATION_CHANGED');return{person:{...await this.person(a,id),relationship:'Fictional friend',calledMe:'Friend',story:'Synthetic story only.'},accountAccessVersion:1,storyAuthorizationVersion:sv,returnAuthorizationVersion:rv}},
  async ensure(a,id){await this.person(a,id);return{id:conversationId,personId:id}},async project(){},
  async projectReceived(a,r){if(state.projectFailure)throw new GiftsError(503,'DEPENDENCY_UNAVAILABLE');state.projected.push(r)},
  async dataRequest(id){if(!requests.has(id))throw missing();return requests.get(id)},
 }
 const store=new GiftsStore(pool,dependencies,{returnEnabled:options.enabled!==false}),returns=new GiftReturnsStore(store,{async generate(input){state.modelCalls++;return state.generate(input)}});await store.seedCatalog()
 const send=()=>store.send(account,randomUUID(),{personId,giftId:'paper-crane',catalogVersion:1,quantity:1,source:'trial',note:'Synthetic outgoing note.'})
 const arrive=async()=>{const d=await send();await pool.query("UPDATE gift_deliveries SET created_at=clock_timestamp()-interval '10 seconds',scheduled_arrival_at=clock_timestamp()-interval '1 second' WHERE id=$1",[d.id]);await pool.query("UPDATE gifts_jobs SET retry_at=CASE WHEN kind='deliver' THEN clock_timestamp()-interval '1 second' ELSE clock_timestamp()+interval '1 hour' END");const j=await store.claim();assert.equal(j.kind,'deliver');await store.run(j);return d}
 const receive=async()=>{const d=await arrive(),j=await returns.claim();assert(j);await returns.run(j);const row=(await pool.query('SELECT * FROM received_gifts WHERE source_delivery_id=$1',[d.id])).rows[0];assert(row);return{delivery:d,job:j,received:await returns.get(account,row.id)}}
 const request=(kind='export')=>{const id=randomUUID();requests.set(id,{accountId:account,requestId:id,kind,scope:'account_data',accountStatus:kind==='export'?'active':'deletion_pending',accountAccessVersion:2});return id}
 const count=async table=>(await pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n
 return{pool,store,returns,account,personId,sessionId,state,dependencies,send,arrive,receive,request,count}
}

test('real-decision publication has one source receipt, one notification and no asset credit; duplicate completion and projection are safe',async t=>{
 const f=await fixture(t),r=await f.receive();await f.returns.run(r.job)
 assert.equal(await f.count('received_gifts'),1);assert.equal(await f.count('gift_notifications'),2);assert.equal(await f.count('ledger_entries'),0);assert.equal(await f.count('asset_lots'),0)
 assert.equal(r.received.origin.contentOrigin,'ai_generated');assert.equal(r.received.quantity,1);assert.equal(r.received.openedAt,null);assert.equal(r.received.placement,null)
 const p=await f.returns.claimProjection();f.state.projectFailure=true;await f.returns.runProjection(p)
 await f.pool.query("UPDATE gift_received_projection_jobs SET retry_at=clock_timestamp()-interval '1 second'");f.state.projectFailure=false;await f.returns.runProjection(await f.returns.claimProjection());assert.equal(f.state.projected.length,1)
 assert.equal(await f.count('received_gifts'),1)
})
test('read, open and placement remain independent; unknown accepted placement replay never overwrites later choice',async t=>{
 const f=await fixture(t),{received:r}=await f.receive(),n=(await f.returns.notifications(f.account,20,{})).data.find(n=>n.type==='gift_received')
 const readKey=randomUUID(),read=await f.returns.readNotification(f.account,n.id,readKey,n.version)
 assert.equal((await f.returns.get(f.account,r.id)).openedAt,null);assert.equal((await f.returns.readNotification(f.account,n.id,readKey,n.version)).data.readAt,read.data.readAt)
 await assert.rejects(f.returns.mutate(f.account,r.id,randomUUID(),'placement','space',r.version),{code:'GIFT_NOT_OPENED'})
 const openKey=randomUUID(),opened=await f.returns.mutate(f.account,r.id,openKey,'open'),key=randomUUID()
 const displayed=await f.returns.mutate(f.account,r.id,key,'placement','space',opened.data.version)
 assert.equal((await f.returns.mutate(f.account,r.id,openKey,'open')).data.placement,'space')
 assert.equal((await f.returns.mutate(f.account,r.id,randomUUID(),'open')).data.openedAt,opened.data.openedAt)
 const recorded=await f.returns.mutate(f.account,r.id,randomUUID(),'placement','record',displayed.data.version)
 const replay=await f.returns.mutate(f.account,r.id,key,'placement','space',opened.data.version)
 assert.equal(replay.data.placement,'record');assert.equal(replay.data.version,recorded.data.version);assert.equal(replay.meta.acceptedVersion,displayed.data.version);assert.equal(replay.meta.replayed,true)
 await assert.rejects(f.returns.mutate(f.account,r.id,key,'placement','record',opened.data.version),{code:'IDEMPOTENCY_CONFLICT'})
 await assert.rejects(f.returns.mutate(f.account,r.id,randomUUID(),'placement','space',opened.data.version),{code:'VERSION_CONFLICT'})
 assert.equal(await f.count('ledger_entries'),0)
})
test('two concurrent opens retain one first time; competing placement commands use one current version',async t=>{
 const f=await fixture(t),{received:r}=await f.receive(),opens=await Promise.all([f.returns.mutate(f.account,r.id,randomUUID(),'open'),f.returns.mutate(f.account,r.id,randomUUID(),'open')])
 assert.equal(opens[0].data.openedAt,opens[1].data.openedAt);assert.equal(opens[0].data.version,2)
 const updates=await Promise.allSettled([f.returns.mutate(f.account,r.id,randomUUID(),'placement','space',2),f.returns.mutate(f.account,r.id,randomUUID(),'placement','space',2)])
 assert.equal(updates.filter(v=>v.status==='fulfilled').length,1);assert.equal(updates.find(v=>v.status==='rejected').reason.status,412)
})
test('no grant at acceptance or disabled arrival never backfills; none is durable and errors never create template gifts',async t=>{
 const f=await fixture(t);f.state.returnAllowed=false;const d=await f.arrive();f.state.returnAllowed=true;f.state.returnVersion=2
 assert.equal(await f.count('gift_return_jobs'),0);assert.equal((await f.store.row(f.account,d.id)).return_authorization_version,null)
 f.state.generate=async()=>({decision:'none',provenance});await f.arrive();await f.returns.run(await f.returns.claim())
 assert.equal(await f.count('received_gifts'),0);assert.equal((await f.pool.query('SELECT decision,state FROM gift_return_jobs')).rows[0].decision,'none')
 const notifications=await f.returns.notifications(f.account,20,{});assert(notifications.data.every(n=>n.type==='gift_arrived'))
 f.state.generate=async()=>{throw new Error('provider unknown')};await f.arrive()
 for(let i=0;i<3;i++){await f.pool.query("UPDATE gift_return_jobs SET retry_at=clock_timestamp()-interval '1 second' WHERE state='failed'");const j=await f.returns.claim();assert(j);await f.returns.run(j)}
 const blocked=(await f.pool.query("SELECT * FROM gift_return_jobs WHERE state='blocked'")).rows[0];assert.equal(blocked.attempt_count,3);assert.equal(blocked.failure_code,'MODEL_RETRY_EXHAUSTED');assert.equal(await f.returns.claim(),undefined);assert.equal(await f.count('received_gifts'),0)
 const disabled=await fixture(t,{enabled:false});await disabled.arrive();assert.equal(await disabled.count('gift_return_jobs'),0)
})
test('expired worker leases count toward the same maximum and stale workers cannot publish',async t=>{
 const f=await fixture(t);await f.arrive();const first=await f.returns.claim()
 for(let i=0;i<2;i++){await f.pool.query("UPDATE gift_return_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE state='running'");assert(await f.returns.claim())}
 await f.pool.query("UPDATE gift_return_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE state='running'");assert.equal(await f.returns.claim(),undefined)
 await f.returns.run(first);assert.equal(f.state.modelCalls,0);assert.equal(await f.count('received_gifts'),0)
 assert.equal((await f.pool.query('SELECT failure_code FROM gift_return_jobs')).rows[0].failure_code,'MODEL_RETRY_EXHAUSTED')
})
test('withdraw and regrant during pending model blocks late result; saved receipts and counts require the original grants',async t=>{
 const f=await fixture(t);await f.arrive();f.state.generate=async()=>{f.state.returnAllowed=false;f.state.returnVersion=2;f.state.returnAllowed=true;f.state.returnVersion=3;return gift()};await f.returns.run(await f.returns.claim())
 assert.equal(await f.count('received_gifts'),0);assert.equal((await f.pool.query('SELECT state FROM gift_return_jobs')).rows[0].state,'blocked')
 f.state.generate=async()=>gift();const{received:r}=await f.receive();f.state.storyVersion=2
 await assert.rejects(f.returns.get(f.account,r.id),{code:'NOT_FOUND'});assert.deepEqual((await f.returns.list(f.account,20,{})).items,[])
 const n=await f.returns.notifications(f.account,20,{});assert.equal(n.data.filter(n=>n.type==='gift_received').length,0);assert.equal(n.meta.totalCount,2)
 f.state.returnAllowed=false;await assert.rejects(f.returns.list(f.account,20,{}),{code:'GIFT_RETURN_PERMISSION_REQUIRED'});assert.equal((await f.returns.notifications(f.account,20,{})).meta.totalCount,2)
})
test('late notification authority change strips incoming counts without blocking outgoing notifications',async t=>{
 const f=await fixture(t);await f.receive();const original=f.returns.notificationVisible.bind(f.returns)
 f.returns.notificationVisible=async(a,r)=>{await original(a,r);if(r.type==='gift_received'){f.state.returnAllowed=false;f.state.returnVersion++}}
 const n=await f.returns.notifications(f.account,20,{});assert.equal(n.meta.totalCount,1);assert.equal(n.meta.unreadCount,1);assert.equal(n.data[0].type,'gift_arrived')
})
test('person mutation during generation is blocked; completed snapshot survives later rename or move but not removal',async t=>{
 const f=await fixture(t);await f.arrive();f.state.generate=async()=>{f.state.personVersion++;return gift()};await f.returns.run(await f.returns.claim());assert.equal(await f.count('received_gifts'),0)
 f.state.generate=async()=>gift();const{received:r}=await f.receive();f.state.personVersion++;f.state.worldVersion++;assert.equal((await f.returns.get(f.account,r.id)).personSnapshot.version,r.personSnapshot.version)
 f.state.person=false;await assert.rejects(f.returns.get(f.account,r.id),{code:'NOT_FOUND'});assert.equal((await f.returns.notifications(f.account,20,{})).meta.totalCount,0)
})
test('rights include generated sources and mutations, and erasure fences a model response already in flight',async t=>{
 const f=await fixture(t),{received:r}=await f.receive();await f.returns.mutate(f.account,r.id,randomUUID(),'open');const rights=new GiftsDataRights(f.store),snapshot=await rights.export(f.account,f.request(),'account_data')
 assert.equal(snapshot.data.receivedGifts.length,1);assert.equal(snapshot.data.returnJobs[0].person_context.person.story,'Synthetic story only.');assert.equal(snapshot.data.notifications.length,2);assert.equal(snapshot.data.mutationReceipts.length,1)
 assert(snapshot.data.notifications.every(n=>snapshot.data.events.some(e=>e.id===n.source_event_id)))
 await f.arrive();const j=await f.returns.claim();f.state.generate=async()=>{await rights.erase(f.account,f.request('delete_account'));return gift()};await f.returns.run(j)
 for(const table of ['received_gifts','gift_return_jobs','gift_received_projection_jobs','gift_notifications','gift_mutation_receipts','gift_deliveries'])assert.equal(await f.count(table),0)
 await assert.rejects(f.returns.mutate(f.account,r.id,randomUUID(),'open'),{code:'NOT_FOUND'});assert.equal(await f.count('gifts_erase_receipts'),1)
})
test('HTTP mutations require original session, origin, idempotency and version; internal received source has its own role',async t=>{
 const f=await fixture(t),{received:r}=await f.receive(),config={webOrigin:'http://localhost:8443',sessionCookie:'test',conversationsToken:randomBytes(32).toString('hex'),rightsToken:randomBytes(32).toString('hex')}
 const app=await createGiftsApp(config,f.store);await app.listen(0,'127.0.0.1');t.after(()=>app.close());const base=await app.getUrl(),headers={cookie:'test=ok',origin:config.webOrigin,'X-Xijie-Expected-Session':f.sessionId,'Content-Type':'application/json','Idempotency-Key':randomUUID()}
 let response=await fetch(base+'/v1/received-gifts/'+r.id+'/open',{method:'POST',headers,body:'{}'});assert.equal(response.status,200);const opened=(await response.json()).data
 response=await fetch(base+'/v1/received-gifts/'+r.id,{method:'PATCH',headers:{...headers,'Idempotency-Key':randomUUID()},body:JSON.stringify({placement:'space'})});assert.equal(response.status,428)
 response=await fetch(base+'/v1/received-gifts/'+r.id,{method:'PATCH',headers:{...headers,'Idempotency-Key':randomUUID(),'If-Match':'"v'+opened.version+'"'},body:JSON.stringify({placement:'space'})});assert.equal(response.status,200)
 response=await fetch(base+'/internal/v1/gifts/received/'+r.id+'?accountId='+f.account,{headers:{Authorization:'Bearer '+config.rightsToken}});assert.equal(response.status,403)
 response=await fetch(base+'/internal/v1/gifts/received/'+r.id+'?accountId='+f.account,{headers:{Authorization:'Bearer '+config.conversationsToken}});assert.equal(response.status,200);assert.equal((await response.json()).data.accountId,f.account)
})
