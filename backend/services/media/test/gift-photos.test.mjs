import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {fixture} from './fixture.mjs'
import {hash,createInput,MediaError} from '../dist/contracts.js'
import {MediaDataRights} from '../dist/data-rights.js'
import {createMediaApp} from '../dist/http.js'
import {Dependencies} from '../dist/dependencies.js'

async function photo(f,a,deliveryId=randomUUID(),ready=true){
 f.giftTargets.get(a).set(deliveryId,{accountId:a,deliveryId,status:'arrived',photoVersion:1})
 const x=await f.store.create(a,randomUUID(),{purpose:'gift_delivery_photo',deliveryId,mimeType:'image/png',byteSize:f.bytes.length,sha256:hash(f.bytes)})
 await f.store.upload(a,x.media.id,x.upload.id,randomUUID(),'image/png',f.bytes)
 if(ready){await f.store.complete(a,x.media.id,x.upload.id,randomUUID());await f.engine.run(await f.engine.claim())}
 return{...x,deliveryId,media:await f.store.get(a,x.media.id)}
}
function commit(f,a,binding){f.giftSources.get(a).clear();f.giftSources.get(a).add(binding.deliveryId+':'+binding.photoVersion+':'+binding.media.id+':'+binding.media.version);f.giftTargets.get(a).get(binding.deliveryId).photoVersion=binding.photoVersion}

test('gift photo purpose uses only gift storage and gift photo permission; purpose and immutable target cannot be crossed',async t=>{
 const f=await fixture(t),a=f.actor();f.accounts.get(a).storyStorage={allowed:false,authorizationVersion:0};f.accounts.get(a).photoStorage={allowed:false,authorizationVersion:0};f.accounts.get(a).personPhotoStorage={allowed:false,authorizationVersion:0}
 const x=await photo(f,a),bound=await f.store.bindGift(a,x.deliveryId,x.media.id,2);commit(f,a,bound)
 const r=await f.store.row(a,x.media.id);assert.equal(r.storage_authorization_version,null);assert.equal(r.gift_storage_authorization_version,1)
 const proof=await f.store.readUrl(f.session(a),x.media.id,x.deliveryId,'gift_delivery_photo');assert((await f.store.content(f.session(a),x.media.id,proof.readProof)).length)
 await assert.rejects(f.store.bindGift(a,randomUUID(),x.media.id,2),{code:'NOT_FOUND'})
 const other=randomUUID();f.giftTargets.get(a).set(other,{accountId:a,deliveryId:other,status:'arrived',photoVersion:1});await assert.rejects(f.store.bindGift(a,other,x.media.id,2),{code:'PHOTO_SELECTION_INVALID'})
 await assert.rejects(f.store.bindPerson(a,randomUUID(),[x.media.id]))
 f.accounts.get(a).storyStorage={allowed:true,authorizationVersion:1,privateFeedAllowed:true};f.accounts.get(a).photoStorage={allowed:true,authorizationVersion:1}
 const post=await f.ready(a);await assert.rejects(f.store.bindGift(a,x.deliveryId,post.media.id,3),{code:'PHOTO_SELECTION_INVALID'})
 assert.throws(()=>createInput({mimeType:'image/png',byteSize:1,sha256:'0'.repeat(64),purpose:'gift_delivery_photo',target:{kind:'person_draft',id:x.deliveryId}}))
})

test('additive replacement cannot break current bytes; photo version fences old proofs including the same media ABA',async t=>{
 const f=await fixture(t),a=f.actor(),x=await photo(f,a),y=await photo(f,a,x.deliveryId),first=await f.store.bindGift(a,x.deliveryId,x.media.id,2);commit(f,a,first)
 const old=await f.store.readUrl(f.session(a),x.media.id,x.deliveryId,'gift_delivery_photo'),candidate=await f.store.bindGift(a,x.deliveryId,y.media.id,3)
 assert.equal(candidate.photoVersion,3);assert(Date.parse(candidate.expiresAt)>Date.now());assert(Date.parse(candidate.expiresAt)<Date.now()+61000)
 await f.engine.reconcile();assert((await f.store.content(f.session(a),x.media.id,old.readProof)).length)
 commit(f,a,candidate);await assert.rejects(f.store.content(f.session(a),x.media.id,old.readProof),{code:'NOT_FOUND'})
 const again=await f.store.bindGift(a,x.deliveryId,x.media.id,4);commit(f,a,again)
 await assert.rejects(f.store.content(f.session(a),x.media.id,old.readProof),{code:'NOT_FOUND'})
 const current=await f.store.readUrl(f.session(a),x.media.id,x.deliveryId,'gift_delivery_photo');assert((await f.store.content(f.session(a),x.media.id,current.readProof)).length)
 await assert.rejects(f.store.remove(a,x.media.id,randomUUID(),x.media.version),{code:'MEDIA_IN_USE'})
})

test('withdrawal blocks reads, regrant reads current finished image with a new proof but cannot revive upload slots or jobs',async t=>{
 const f=await fixture(t),a=f.actor(),x=await photo(f,a),bound=await f.store.bindGift(a,x.deliveryId,x.media.id,2);commit(f,a,bound)
 const proof=await f.store.readUrl(f.session(a),x.media.id,x.deliveryId,'gift_delivery_photo'),pending=await photo(f,a,randomUUID(),false)
 f.accounts.get(a).giftPhotoStorage={allowed:false,authorizationVersion:2};await assert.rejects(f.store.readUrl(f.session(a),x.media.id,x.deliveryId,'gift_delivery_photo'),{code:'GIFT_PHOTO_PERMISSION_REQUIRED'})
 await f.engine.reconcile();assert.equal((await f.store.get(a,x.media.id)).status,'ready')
 f.accounts.get(a).giftPhotoStorage={allowed:true,authorizationVersion:3}
 await assert.rejects(f.store.content(f.session(a),x.media.id,proof.readProof),{code:'NOT_FOUND'})
 const next=await f.store.readUrl(f.session(a),x.media.id,x.deliveryId,'gift_delivery_photo');assert((await f.store.content(f.session(a),x.media.id,next.readProof)).length)
 await assert.rejects(f.store.newSlot(a,pending.media.id,randomUUID(),pending.media.version),{code:'AUTHORIZATION_CHANGED'})
 await assert.rejects(f.store.complete(a,pending.media.id,pending.upload.id,randomUUID()),{code:'AUTHORIZATION_CHANGED'})
 const job=await photo(f,a,randomUUID(),false);await f.store.complete(a,job.media.id,job.upload.id,randomUUID());f.accounts.get(a).giftStorage.authorizationVersion++
 await f.engine.run(await f.engine.claim());assert.equal((await f.store.get(a,job.media.id)).status,'rejected');assert.equal((await f.storage.list('ready/'+a+'/'+job.media.id+'/')).length,0)
})

test('source replacement cleans only expired unreferenced bytes and a racing fresh prebind fences the old sweep',async t=>{
 const f=await fixture(t),a=f.actor(),x=await photo(f,a),first=await f.store.bindGift(a,x.deliveryId,x.media.id,2);commit(f,a,first)
 await f.pool.query("UPDATE media_gift_grants SET created_at=clock_timestamp()-interval '17 minutes',last_bound_at=clock_timestamp()-interval '16 minutes' WHERE account_id=$1",[a])
 f.giftSources.get(a).clear()
 const original=f.store.dependencies.validGiftPhotos.bind(f.store.dependencies);let entered,resume;const started=new Promise(r=>entered=r),gate=new Promise(r=>resume=r)
 f.store.dependencies.validGiftPhotos=async(id,refs)=>{const result=await original(id,refs);entered();await gate;return result}
 const sweeping=f.store.reconcileGift(await f.store.row(a,x.media.id));await started
 const renewed=await f.store.bindGift(a,x.deliveryId,x.media.id,3);commit(f,a,renewed);resume();await sweeping
 assert.equal((await f.store.get(a,x.media.id)).status,'ready');f.store.dependencies.validGiftPhotos=original
 await f.pool.query("UPDATE media_gift_grants SET created_at=clock_timestamp()-interval '17 minutes',last_bound_at=clock_timestamp()-interval '16 minutes' WHERE account_id=$1",[a]);f.giftSources.get(a).clear();f.giftTargets.get(a).clear()
 await f.engine.reconcile();assert.equal((await f.store.get(a,x.media.id)).status,'revoked');await f.engine.run(await f.engine.claim());assert.equal((await f.storage.list('ready/'+a+'/')).length,0)
})

test('dependency failure never proves source deletion and image replacement during actual byte read invalidates the proof',async t=>{
 const f=await fixture(t),a=f.actor(),x=await photo(f,a),bound=await f.store.bindGift(a,x.deliveryId,x.media.id,2);commit(f,a,bound)
 const proof=await f.store.readUrl(f.session(a),x.media.id,x.deliveryId,'gift_delivery_photo'),get=f.storage.get.bind(f.storage)
 f.storage.get=async(...args)=>{const bytes=await get(...args);f.giftTargets.get(a).get(x.deliveryId).photoVersion=3;f.giftSources.get(a).clear();return bytes}
 await assert.rejects(f.store.content(f.session(a),x.media.id,proof.readProof),{code:'NOT_FOUND'});f.storage.get=get
 await f.pool.query("UPDATE media_gift_grants SET created_at=clock_timestamp()-interval '17 minutes',last_bound_at=clock_timestamp()-interval '16 minutes' WHERE account_id=$1",[a])
 f.store.dependencies.validGiftPhotos=async()=>{throw new MediaError(503,'DEPENDENCY_UNAVAILABLE')};await f.engine.reconcile();assert.equal((await f.store.get(a,x.media.id)).status,'ready')
})

test('independent export includes only current source bytes and source versions; erase cleans staged, ready and grant data',async t=>{
 const f=await fixture(t),a=f.actor(),x=await photo(f,a),y=await photo(f,a,x.deliveryId),first=await f.store.bindGift(a,x.deliveryId,x.media.id,2);commit(f,a,first)
 const second=await f.store.bindGift(a,x.deliveryId,y.media.id,3);commit(f,a,second);f.accounts.get(a).giftPhotoStorage={allowed:false,authorizationVersion:2};f.accounts.get(a).giftStorage={allowed:false,authorizationVersion:2}
 const rights=new MediaDataRights(f.store),exported=await rights.export(a,f.dataRequest(a),'account_data');assert.equal(exported.data.media.length,1);assert.equal(exported.data.giftBindings.length,1)
 const m=exported.data.media[0];assert.equal(m.id,y.media.id);assert.equal(m.photoVersion,3);assert.equal(m.deliveryId,x.deliveryId);assert.equal(hash(Buffer.from(m.bytesBase64,'base64')),m.sha256)
 await rights.erase(a,f.dataRequest(a,'delete_account'));for(const table of ['media_gift_grants','media_objects','media_jobs','media_upload_slots'])assert.equal((await f.pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n,0)
 assert.equal((await f.storage.list('ready/'+a+'/')).length,0);assert.equal((await f.storage.list('staging/'+a+'/')).length,0)
})

test('gift binding HTTP enforces the Gifts role and exact contract; public read uses the existing target shape',async t=>{
 const f=await fixture(t),a=f.actor(),x=await photo(f,a),app=await createMediaApp(f.config,f.store);await app.listen(0,'127.0.0.1');t.after(()=>app.close());const base=await app.getUrl(),path='/internal/v1/gifts/deliveries/'+x.deliveryId+'/media-bindings',body=JSON.stringify({mediaId:x.media.id,photoVersion:2})
 let response=await fetch(base+path,{method:'POST',headers:{Authorization:'Bearer '+f.config.socialToken,'X-Xijie-Account-Id':a,'Content-Type':'application/json'},body});assert.equal(response.status,403)
 response=await fetch(base+path,{method:'POST',headers:{Authorization:'Bearer '+f.config.giftsToken,'X-Xijie-Account-Id':a,'Content-Type':'application/json'},body});assert.equal(response.status,200);const binding=(await response.json()).data;commit(f,a,binding)
 response=await fetch(base+'/v1/media/'+x.media.id+'/read-url',{method:'POST',headers:{Cookie:'test='+a,Origin:f.config.webOrigin,'X-Xijie-Expected-Session':a,'Content-Type':'application/json'},body:JSON.stringify({purpose:'gift_delivery_photo',target:{kind:'gift_delivery',id:x.deliveryId}})});assert.equal(response.status,200)
 const proof=(await response.json()).data;response=await fetch(base+'/v1/media/'+x.media.id+'/content',{headers:{Cookie:'test='+a,'X-Xijie-Expected-Session':a,'X-Media-Read-Proof':proof.readProof}});assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'image/webp')
})

test('gift dependency source contract rejects changed references and distinguishes not-arrived from outage',async()=>{
 const accountId=randomUUID(),deliveryId=randomUUID(),mediaId=randomUUID(),ref={deliveryId,photoVersion:2,mediaId,version:3},config={giftsOrigin:'http://127.0.0.1:3107',serviceToken:'test-only'}
 let response={data:{deliveryId,accountId,status:'arrived',photoVersion:1}},status=200,seen
 const deps=new Dependencies(config,async(url,options)=>{seen={url:String(url),options};return Response.json(response,{status})})
 assert.equal((await deps.giftTarget(accountId,deliveryId)).photoVersion,1);assert.equal(seen.options.headers['X-Xijie-Account-Id'],accountId)
 response={error:{code:'DELIVERY_NOT_ARRIVED'}};status=409;await assert.rejects(deps.giftTarget(accountId,deliveryId),{code:'DELIVERY_NOT_ARRIVED'})
 response={error:{code:'UNKNOWN'}};await assert.rejects(deps.giftTarget(accountId,deliveryId),{code:'DEPENDENCY_UNAVAILABLE'})
 status=200;response={data:{valid:[ref]}};assert.deepEqual(await deps.validGiftPhotos(accountId,[ref]),[ref]);assert(seen.url.endsWith('/internal/v1/media/gifts/validate'))
 for(const valid of [[{...ref,photoVersion:3}],[{...ref,mediaId:randomUUID()}],[ref,ref],[null]]){response={data:{valid}};await assert.rejects(deps.validGiftPhotos(accountId,[ref]),{code:'DEPENDENCY_UNAVAILABLE'})}
})

test('late gift image verification cannot publish a removed source and native scope constraints reject cross-purpose grants',async t=>{
 const f=await fixture(t),a=f.actor(),p=await f.ready(a),x=await photo(f,a,randomUUID(),false)
 await f.store.complete(a,x.media.id,x.upload.id,randomUUID());f.giftTargets.get(a).clear();await f.engine.run(await f.engine.claim())
 assert.equal((await f.store.get(a,x.media.id)).status,'rejected');assert.equal((await f.storage.list('ready/'+a+'/'+x.media.id+'/')).length,0)
 await assert.rejects(f.pool.query('INSERT INTO media_gift_grants(account_id,media_id,delivery_id,photo_version,media_version) VALUES($1,$2,$3,2,$4)',[a,p.media.id,randomUUID(),p.media.version]),{code:'23503'})
 await assert.rejects(f.pool.query('UPDATE media_objects SET storage_authorization_version=1 WHERE account_id=$1 AND id=$2',[a,x.media.id]),{code:'23514'})
})

test('regrant cannot bind an unfinished ready capture but can reopen and rebind the exact current saved source',async t=>{
 const f=await fixture(t),a=f.actor(),saved=await photo(f,a),pending=await photo(f,a),binding=await f.store.bindGift(a,saved.deliveryId,saved.media.id,2);commit(f,a,binding)
 f.accounts.get(a).giftPhotoStorage={allowed:false,authorizationVersion:2};await assert.rejects(f.store.bindGift(a,pending.deliveryId,pending.media.id,2),{code:'GIFT_PHOTO_PERMISSION_REQUIRED'})
 f.accounts.get(a).giftPhotoStorage={allowed:true,authorizationVersion:3}
 await assert.rejects(f.store.bindGift(a,pending.deliveryId,pending.media.id,2),{code:'PHOTO_SELECTION_INVALID'})
 const proof=await f.store.readUrl(f.session(a),saved.media.id,saved.deliveryId,'gift_delivery_photo');assert((await f.store.content(f.session(a),saved.media.id,proof.readProof)).length)
 assert.equal((await f.store.bindGift(a,saved.deliveryId,saved.media.id,3)).photoVersion,3)
 f.giftSources.get(a).clear();await assert.rejects(f.store.bindGift(a,saved.deliveryId,saved.media.id,4),{code:'PHOTO_SELECTION_INVALID'})
})
