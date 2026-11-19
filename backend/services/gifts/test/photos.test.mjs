import 'reflect-metadata'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,randomBytes} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import pg from 'pg'
import {GiftsStore} from '../dist/store.js'
import {GiftPhotosStore} from '../dist/photos.js'
import {GiftReturnsStore} from '../dist/returns.js'
import {GiftsDataRights} from '../dist/data-rights.js'
import {GiftsError,missing} from '../dist/contracts.js'
import {Dependencies} from '../dist/dependencies.js'
import {createGiftsApp} from '../dist/http.js'

async function fixture(t){
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL;assert(connectionString)
 const schema='gift_photos_test_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString}),pool=new pg.Pool({connectionString,options:'-c search_path='+schema,max:10})
 await admin.query('CREATE SCHEMA '+schema)
 t.after(async()=>{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()})
 for(const name of ['001_gifts.sql','002_person_gift_returns.sql','003_gift_delivery_photos.sql','004_referral_rewards.sql','005_album_rewards.sql','006_commerce_core.sql','007_jeepay_checkout.sql','008_financial_operations.sql'])await pool.query(await readFile(new URL('../db/'+name,import.meta.url),'utf8'))
 const account=randomUUID(),personId=randomUUID(),worldId=randomUUID(),conversationId=randomUUID(),sessionId=randomUUID(),requests=new Map()
 const state={photoAllowed:true,photoVersion:1,giftAllowed:true,giftVersion:1,person:true,bindCalls:0,modelCalls:0,projected:[]}
 const permissions=()=>({giftStorage:{allowed:state.giftAllowed,authorizationVersion:state.giftVersion},giftPhotoStorage:{allowed:state.photoAllowed,authorizationVersion:state.photoVersion},storyStorage:{allowed:true,authorizationVersion:1},giftReturns:{allowed:true,authorizationVersion:1}})
 const dependencies={
  async account(id){if(id!==account)throw missing();return{accountId:id,status:'active',accessVersion:1,...permissions()}},
  async session(cookie,expected){if(cookie!=='test=ok'||expected!==undefined&&expected!==sessionId)throw new GiftsError(401,'UNAUTHORIZED');return{accountId:account,sessionId,expiresAt:new Date(Date.now()+60000).toISOString(),...permissions()}},
  async person(a,id){if(a!==account||id!==personId||!state.person)throw missing();return{id,accountId:account,displayName:'Synthetic Photo Person',worldId,version:1,worldVersion:1,accessVersion:1,status:'active',audience:'person'}},
  async ensure(a,id){await this.person(a,id);return{id:conversationId,personId:id}},
  async project(a,d){state.projected.push(d)},async projectReceived(){},
  async returnContext(a,id,rv,sv){return{person:{...await this.person(a,id),relationship:'Fictional friend',story:'Synthetic story only.'},accountAccessVersion:1,storyAuthorizationVersion:sv,returnAuthorizationVersion:rv}},
  async dataRequest(id){if(!requests.has(id))throw missing();return requests.get(id)},
  async bindPhoto(a,id,mediaId,photoVersion){state.bindCalls++;return state.bind?state.bind(a,id,mediaId,photoVersion):binding(id,mediaId,photoVersion)},
 }
 const store=new GiftsStore(pool,dependencies,{returnEnabled:true}),photos=new GiftPhotosStore(store),returns=new GiftReturnsStore(store,{async generate(input){state.modelCalls++;if(state.generate)await state.generate(input);return{decision:'gift',giftId:'flowers',note:'Synthetic return.',provenance:{provider:'openai',model:'synthetic-model',responseId:'synthetic-response',promptVersion:'person-gift-returns-v1'}}}})
 await store.seedCatalog()
 const send=()=>store.send(account,randomUUID(),{personId,giftId:'paper-crane',catalogVersion:1,quantity:1,source:'trial',note:'Synthetic journey.'})
 const arrive=async()=>{const d=await send();await pool.query("UPDATE gift_deliveries SET created_at=clock_timestamp()-interval '10 seconds',scheduled_arrival_at=clock_timestamp()-interval '1 second' WHERE id=$1",[d.id]);await pool.query("UPDATE gifts_jobs SET retry_at=CASE WHEN kind='deliver' AND delivery_id=$1 THEN clock_timestamp()-interval '1 second' ELSE clock_timestamp()+interval '1 hour' END",[d.id]);await store.run(await store.claim());return store.get(account,d.id)}
 const request=(kind='export')=>{const id=randomUUID();requests.set(id,{accountId:account,requestId:id,kind,scope:'account_data',accountStatus:kind==='export'?'active':'deletion_pending',accountAccessVersion:2});return id}
 const count=async table=>(await pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n
 return{pool,store,photos,returns,dependencies,state,account,personId,sessionId,send,arrive,request,count}
}
function binding(id,mediaId,photoVersion){return{deliveryId:id,photoVersion,media:{id:mediaId,version:1,mimeType:'image/webp',byteSize:1234,width:640,height:480},expiresAt:new Date(Date.now()+60000).toISOString()}}
const ref=(p)=>({deliveryId:p.deliveryId,photoVersion:p.version,mediaId:p.photo.id,version:p.photo.version})

test('empty photo GET is a pure read; photo writes leave core receipt, jobs, ledger and cards unchanged',async t=>{
 const f=await fixture(t),d=await f.arrive(),counts=await Promise.all(['gifts_jobs','gift_return_jobs','gift_notifications','ledger_entries'].map(f.count))
 const empty=await f.photos.get(f.account,d.id);assert.deepEqual(empty,{deliveryId:d.id,version:1,photo:null,updatedAt:d.createdAt,origin:'journey_capture'});assert.equal(await f.count('gift_delivery_photos'),0);assert.equal(await f.count('gift_photo_commands'),0)
 const p=await f.photos.put(f.account,d.id,randomUUID(),1,randomUUID());assert.equal(p.version,2);assert.equal(p.photo.mimeType,'image/webp')
 assert.deepEqual(await f.store.get(f.account,d.id),d);assert.deepEqual(await Promise.all(['gifts_jobs','gift_return_jobs','gift_notifications','ledger_entries'].map(f.count)),counts);assert.equal(f.state.projected.length,0)
 assert.equal((await f.pool.query('SELECT source_delivery_version FROM gift_return_jobs')).rows[0].source_delivery_version,d.version)
})
test('photos saved during actual return job execution never invalidate captured source version or enter the model input',async t=>{
 const f=await fixture(t),d=await f.arrive(),job=await f.returns.claim()
 f.state.generate=async input=>{assert.equal(input.sourceDelivery.id,d.id);assert(!JSON.stringify(input).includes('mediaId'));await f.photos.put(f.account,d.id,randomUUID(),1,randomUUID())}
 await f.returns.run(job);assert.equal(f.state.modelCalls,1);assert.equal(await f.count('received_gifts'),1);assert.equal((await f.pool.query('SELECT state FROM gift_return_jobs')).rows[0].state,'succeeded');assert.equal((await f.store.get(f.account,d.id)).version,d.version);assert.equal(await f.count('ledger_entries'),0)
 await f.photos.put(f.account,d.id,randomUUID(),2,randomUUID());await f.returns.run(job);assert.equal(await f.count('received_gifts'),1);assert.equal(await f.count('gift_return_jobs'),1)
})
test('permanent retry returns latest saved state without rebinding collected old media; changed intent conflicts',async t=>{
 const f=await fixture(t),d=await f.arrive(),key=randomUUID(),old=randomUUID(),first=await f.photos.put(f.account,d.id,key,1,old),second=await f.photos.put(f.account,d.id,randomUUID(),2,randomUUID())
 f.state.bind=()=>{throw new GiftsError(422,'PHOTO_SELECTION_INVALID')}
 assert.deepEqual(await f.photos.put(f.account,d.id,key,1,old),second);assert.equal(f.state.bindCalls,2)
 await assert.rejects(f.photos.put(f.account,d.id,key,1,randomUUID()),{code:'IDEMPOTENCY_CONFLICT'});await assert.rejects(f.photos.put(f.account,d.id,randomUUID(),1,old),{code:'VERSION_CONFLICT'});assert.equal(f.state.bindCalls,2)
 assert.deepEqual(await f.photos.validate(f.account,[ref(first),ref(second)]),{valid:[ref(second)]});assert.equal(await f.count('gift_photo_commands'),2)
})
test('same-key races commit one photo event while different-key CAS competitors cannot overwrite each other',async t=>{
 const f=await fixture(t),d=await f.arrive(),key=randomUUID(),media=randomUUID(),same=await Promise.all([f.photos.put(f.account,d.id,key,1,media),f.photos.put(f.account,d.id,key,1,media)])
 assert.equal(same[0].version,2);assert.equal(same[1].photo.id,media);assert.equal(await f.count('gift_photo_commands'),1)
 const competing=await Promise.allSettled([f.photos.put(f.account,d.id,randomUUID(),2,randomUUID()),f.photos.put(f.account,d.id,randomUUID(),2,randomUUID())]);assert.equal(competing.filter(x=>x.status==='fulfilled').length,1);assert.equal(competing.find(x=>x.status==='rejected').reason.code,'VERSION_CONFLICT')
 assert.equal((await f.pool.query("SELECT count(*)::int n FROM outbox_events WHERE type='GiftDeliveryPhotoUpdated'")).rows[0].n,2)
})
test('prebind holds no SQL lock and lease is checked by database time after lock waiting',async t=>{
 const f=await fixture(t),d=await f.arrive()
 f.state.bind=async(a,id,media,v)=>{const db=await f.pool.connect();try{await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='300ms'");await f.store.gate(db,a);await db.query('ROLLBACK')}finally{db.release()}return binding(id,media,v)}
 await f.photos.put(f.account,d.id,randomUUID(),1,randomUUID())
 const blocker=await f.pool.connect();await blocker.query('BEGIN');await f.store.gate(blocker,f.account)
 let bound;const didBind=new Promise(resolve=>{bound=resolve})
 f.state.bind=async(a,id,media,v)=>{const b=binding(id,media,v);b.expiresAt=new Date(Date.now()+100).toISOString();bound();return b}
 const attempt=f.photos.put(f.account,d.id,randomUUID(),2,randomUUID()),rejection=assert.rejects(attempt,{code:'MEDIA_BINDING_EXPIRED'})
 await didBind;await new Promise(resolve=>setTimeout(resolve,160));await blocker.query('ROLLBACK');blocker.release();await rejection
 assert.equal((await f.photos.get(f.account,d.id)).version,2);assert.equal(await f.count('gift_photo_commands'),1)
})
test('withdraw/regrant during prebind rejects old authorization; saved references survive withdrawal and current grant can read',async t=>{
 const f=await fixture(t),d=await f.arrive(),p=await f.photos.put(f.account,d.id,randomUUID(),1,randomUUID())
 f.state.bind=async(a,id,media,v)=>{f.state.photoVersion=3;return binding(id,media,v)}
 await assert.rejects(f.photos.put(f.account,d.id,randomUUID(),2,randomUUID()),{code:'AUTHORIZATION_CHANGED'});assert.equal((await f.photos.get(f.account,d.id)).version,2)
 f.state.photoAllowed=false;f.state.giftAllowed=false;await assert.rejects(f.photos.get(f.account,d.id),{code:'GIFT_STORAGE_PERMISSION_REQUIRED'});assert.deepEqual(await f.photos.validate(f.account,[ref(p)]),{valid:[ref(p)]});assert.equal((await f.photos.source(f.account,d.id)).photoVersion,2)
 f.state.giftAllowed=true;await assert.rejects(f.photos.get(f.account,d.id),{code:'GIFT_PHOTO_PERMISSION_REQUIRED'});f.state.photoAllowed=true;assert.equal((await f.photos.get(f.account,d.id)).photo.id,p.photo.id)
 f.state.person=false;assert.deepEqual(await f.photos.validate(f.account,[ref(p)]),{valid:[]});await assert.rejects(f.photos.get(f.account,d.id),{code:'NOT_FOUND'})
})
test('post-commit withdrawal keeps the accepted key recoverable without a second bind or event',async t=>{
 const f=await fixture(t),d=await f.arrive(),key=randomUUID(),media=randomUUID(),tx=f.store.tx.bind(f.store)
 f.store.tx=async(...args)=>{const result=await tx(...args);f.state.photoAllowed=false;f.state.photoVersion=2;return result}
 await assert.rejects(f.photos.put(f.account,d.id,key,1,media),{code:'GIFT_PHOTO_PERMISSION_REQUIRED'});assert.equal(await f.count('gift_photo_commands'),1)
 f.store.tx=tx;f.state.photoAllowed=true;f.state.photoVersion=3;f.state.bind=()=>{throw new Error('accepted replay must not bind')}
 assert.equal((await f.photos.put(f.account,d.id,key,1,media)).version,2);assert.equal(f.state.bindCalls,1)
})
test('unarrived, removed, mismatched and dependency-failed sources do not masquerade as a saved photo',async t=>{
 const f=await fixture(t),pending=await f.send();await assert.rejects(f.photos.get(f.account,pending.id),{code:'DELIVERY_NOT_ARRIVED'});await assert.rejects(f.photos.put(f.account,pending.id,randomUUID(),1,randomUUID()),{code:'DELIVERY_NOT_ARRIVED'});assert.equal(f.state.bindCalls,0)
 const d=await f.arrive(),p=await f.photos.put(f.account,d.id,randomUUID(),1,randomUUID())
 assert.deepEqual(await f.photos.validate(f.account,[{...ref(p),version:2},{...ref(p),photoVersion:1},{...ref(p),mediaId:randomUUID()},{...ref(p),deliveryId:pending.id}]),{valid:[]})
 await assert.rejects(f.photos.get(randomUUID(),d.id),{code:'NOT_FOUND'})
 const person=f.dependencies.person;f.dependencies.person=async()=>{throw new GiftsError(503,'DEPENDENCY_UNAVAILABLE')};await assert.rejects(f.photos.list(f.account,20),{code:'DEPENDENCY_UNAVAILABLE'});await assert.rejects(f.photos.validate(f.account,[ref(p)]),{code:'DEPENDENCY_UNAVAILABLE'});f.dependencies.person=person
})
test('list order and cursors are stable across replacement and still progress when a person is removed',async t=>{
 const f=await fixture(t),one=await f.arrive(),two=await f.arrive();await f.photos.put(f.account,one.id,randomUUID(),1,randomUUID());await f.photos.put(f.account,two.id,randomUUID(),1,randomUUID())
 const before=await f.photos.list(f.account,1);await f.photos.put(f.account,one.id,randomUUID(),2,randomUUID());assert.deepEqual((await f.photos.list(f.account,1)).items.map(x=>x.deliveryId),before.items.map(x=>x.deliveryId))
 const next=await f.photos.list(f.account,1,before.next);assert.equal(next.items.length,1);assert.notEqual(next.items[0].deliveryId,before.items[0].deliveryId)
 f.state.person=false;const removed=await f.photos.list(f.account,1);assert.equal(removed.items.length,0);assert.equal(removed.next,before.next)
})
test('rights export photos, permanent commands and events after withdrawal; erasure fences in-flight binding',async t=>{
 const f=await fixture(t),d=await f.arrive(),p=await f.photos.put(f.account,d.id,randomUUID(),1,randomUUID()),rights=new GiftsDataRights(f.store)
 f.state.giftAllowed=false;f.state.photoAllowed=false
 const exported=await rights.export(f.account,f.request(),'account_data');assert.equal(exported.data.deliveryPhotos[0].media_id,p.photo.id);assert.equal(exported.data.photoCommands.length,1);assert(exported.data.events.some(e=>e.type==='GiftDeliveryPhotoUpdated'));assert(!JSON.stringify(exported).includes('request_hash'))
 f.state.giftAllowed=true;f.state.photoAllowed=true;f.state.bind=async(a,id,media,v)=>{await rights.erase(f.account,f.request('delete_account'));return binding(id,media,v)}
 await assert.rejects(f.photos.put(f.account,d.id,randomUUID(),2,randomUUID()),{code:'NOT_FOUND'});for(const table of ['gift_delivery_photos','gift_photo_commands','gift_deliveries','outbox_events'])assert.equal(await f.count(table),0)
 assert.deepEqual(await f.photos.validate(f.account,[ref(p)]),{valid:[]});assert.equal(await f.count('gifts_erase_receipts'),1)
})
test('HTTP photos use independent ETag, required mutation headers and Media-only source role',async t=>{
 const f=await fixture(t),d=await f.arrive(),config={webOrigin:'http://localhost:8443',sessionCookie:'test',mediaOrigin:'http://127.0.0.1:3106',mediaToken:randomBytes(32).toString('hex'),conversationsToken:randomBytes(32).toString('hex'),rightsToken:randomBytes(32).toString('hex')}
 const app=await createGiftsApp(config,f.store);await app.listen(0,'127.0.0.1');t.after(()=>app.close());const base=await app.getUrl(),path='/v1/gift-deliveries/'+d.id+'/photo',headers={cookie:'test=ok',origin:config.webOrigin,'X-Xijie-Expected-Session':f.sessionId,'Content-Type':'application/json','Idempotency-Key':randomUUID()}
 let response=await fetch(base+path,{headers});assert.equal(response.status,200);assert.equal(response.headers.get('ETag'),'"v1"')
 const body=JSON.stringify({mediaId:randomUUID()}),put=extra=>fetch(base+path,{method:'PUT',headers:{...headers,...extra},body})
 assert.equal((await put({})).status,428);assert.equal((await put({'If-Match':'"v1"',Origin:'http://invalid.example'})).status,403);assert.equal((await put({'If-Match':'"v1"','X-Xijie-Expected-Session':randomUUID()})).status,401)
 response=await put({'If-Match':'"v1"'});assert.equal(response.status,200);assert.equal(response.headers.get('ETag'),'"v2"');const p=(await response.json()).data
 const sourceHeaders={Authorization:'Bearer '+config.mediaToken,'X-Xijie-Account-Id':f.account};response=await fetch(base+'/internal/v1/media/gifts/deliveries/'+d.id,{headers:sourceHeaders});assert.equal(response.status,200);assert.equal((await response.json()).data.photoVersion,2)
 response=await fetch(base+'/internal/v1/media/gifts/deliveries/'+d.id,{headers:{...sourceHeaders,Authorization:'Bearer '+config.rightsToken}});assert.equal(response.status,403)
 response=await fetch(base+'/internal/v1/media/gifts/validate',{method:'POST',headers:{...sourceHeaders,'Content-Type':'application/json'},body:JSON.stringify({refs:[ref(p)]})});assert.equal(response.status,200);assert.deepEqual((await response.json()).data.valid,[ref(p)])
 f.state.photoAllowed=false;assert.equal((await fetch(base+'/v1/gift-delivery-photos',{headers})).status,403);assert.equal((await fetch(base+'/v1/wallet',{headers})).status,200)
 config.mediaToken=undefined;config.mediaOrigin=undefined;assert.equal((await fetch(base+path,{headers})).status,503);assert.equal((await fetch(base+'/v1/wallet',{headers})).status,200)
})
test('Media binding transport sends only immutable target intent and rejects malformed metadata or untrusted errors',async()=>{
 const account=randomUUID(),delivery=randomUUID(),media=randomUUID(),config={mediaOrigin:'http://127.0.0.1:3106',mediaToken:randomBytes(32).toString('hex'),serviceToken:randomBytes(32).toString('hex')}
 let payload=binding(delivery,media,2),status=200,seen
 const deps=new Dependencies(config,async(url,options)=>{seen={url:String(url),options};return new Response(JSON.stringify(status===200?{data:payload}:{error:{code:'UNKNOWN'}}),{status})})
 assert.deepEqual(await deps.bindPhoto(account,delivery,media,2),payload);assert.equal(seen.options.headers.Authorization,'Bearer '+config.serviceToken);assert.equal(seen.options.headers['X-Xijie-Account-Id'],account);assert.deepEqual(JSON.parse(seen.options.body),{mediaId:media,photoVersion:2});assert.equal(seen.options.redirect,'error')
 payload={...payload,photoVersion:3};await assert.rejects(deps.bindPhoto(account,delivery,media,2),{code:'DEPENDENCY_UNAVAILABLE'});status=500;await assert.rejects(deps.bindPhoto(account,delivery,media,2),{code:'DEPENDENCY_UNAVAILABLE'});status=404;await assert.rejects(deps.bindPhoto(account,delivery,media,2),{code:'PHOTO_SELECTION_INVALID'})
})
