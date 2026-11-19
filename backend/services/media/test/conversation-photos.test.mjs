import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {fixture} from './fixture.mjs'
import {hash,createInput,MediaError} from '../dist/contracts.js'
import {Dependencies} from '../dist/dependencies.js'
import {MediaDataRights} from '../dist/data-rights.js'
import {createMediaApp} from '../dist/http.js'

async function photo(f,a,{conversationId=randomUUID(),clientMessageId=randomUUID(),ready=true}={}){
 f.conversationTargets.get(a).set(conversationId,{accountId:a,conversationId,personId:randomUUID()})
 const x=await f.store.create(a,randomUUID(),{purpose:'conversation_attachment',conversationId,clientMessageId,mimeType:'image/png',byteSize:f.bytes.length,sha256:hash(f.bytes)})
 await f.store.upload(a,x.media.id,x.upload.id,randomUUID(),'image/png',f.bytes)
 if(ready){await f.store.complete(a,x.media.id,x.upload.id,randomUUID());await f.engine.run(await f.engine.claim())}
 return{...x,conversationId,clientMessageId,media:await f.store.get(a,x.media.id)}
}
const ref=x=>({conversationId:x.conversationId,clientMessageId:x.clientMessageId,messageVersion:1,mediaId:x.media.id,version:x.media.version})
const key=r=>r.conversationId+':'+r.clientMessageId+':'+r.messageVersion+':'+r.mediaId+':'+r.version
const bind=(f,a,x)=>f.store.bindConversation(a,x.conversationId,x.clientMessageId,x.media.id,x.media.version)
const commit=(f,a,x)=>f.conversationSources.get(a).add(key(ref(x)))
const read=(f,a,x)=>f.store.readUrl(f.session(a),x.media.id,x.clientMessageId,'conversation_attachment',x.conversationId)
function attempt(f,a,x){const jobId=randomUUID(),attemptId=randomUUID(),source={...ref(x),messageId:randomUUID(),accountAccessVersion:1,storyAuthorizationVersion:1,photoAuthorizationVersion:1,imageAuthorizationVersion:1};f.photoReplySources.set(a+':'+jobId+':'+attemptId,source);return{jobId,attemptId,source}}

test('chat photos have an independent immutable message target, purpose and same-owner native grants',async t=>{
 const f=await fixture(t),a=f.actor();f.accounts.get(a).photoStorage.allowed=false;f.accounts.get(a).personPhotoStorage.allowed=false;f.accounts.get(a).giftPhotoStorage.allowed=false
 const x=await photo(f,a),binding=await bind(f,a,x);assert.equal(binding.conversationId,x.conversationId);assert.equal(binding.clientMessageId,x.clientMessageId);assert(Date.parse(binding.expiresAt)>Date.now()&&Date.parse(binding.expiresAt)<Date.now()+61000)
 await assert.rejects(f.pool.query('UPDATE media_objects SET chat_client_message_id=$1 WHERE id=$2',[randomUUID(),x.media.id]),/immutable/)
 await assert.rejects(f.pool.query('UPDATE media_conversation_grants SET media_version=media_version+1 WHERE media_id=$1',[x.media.id]),/immutable/)
 await assert.rejects(f.pool.query('UPDATE media_conversation_grants SET conversation_id=$1 WHERE media_id=$2',[randomUUID(),x.media.id]),/immutable/)
 await assert.rejects(f.pool.query('UPDATE media_conversation_grants SET message_version=2 WHERE media_id=$1',[x.media.id]))
 const other=f.actor();await assert.rejects(f.pool.query('INSERT INTO media_conversation_grants(account_id,media_id,conversation_id,client_message_id,media_version) VALUES($1,$2,$3,$4,$5)',[other,x.media.id,x.conversationId,x.clientMessageId,x.media.version]),{code:'23503'})
 await assert.rejects(f.store.bindConversation(a,x.conversationId,randomUUID(),x.media.id,x.media.version),{code:'PHOTO_SELECTION_INVALID'})
 f.accounts.get(a).photoStorage.allowed=true;const post=await f.ready(a);await assert.rejects(f.store.bindConversation(a,x.conversationId,x.clientMessageId,post.media.id,post.media.version),{code:'PHOTO_SELECTION_INVALID'})
 assert.throws(()=>createInput({mimeType:'image/png',byteSize:1,sha256:'0'.repeat(64),purpose:'conversation_attachment',target:{kind:'conversation_message',id:x.clientMessageId}}))
 assert.throws(()=>createInput({mimeType:'image/png',byteSize:1,sha256:'0'.repeat(64),purpose:'person_photo',target:{kind:'person_draft',id:x.clientMessageId,conversationId:x.conversationId}}))
})

test('candidate prebind is not readable; exact committed source, session and purpose fence content and deletion',async t=>{
 const f=await fixture(t),a=f.actor(),x=await photo(f,a);await bind(f,a,x)
 await assert.rejects(read(f,a,x),{code:'NOT_FOUND'});commit(f,a,x)
 const proof=await read(f,a,x),bytes=await f.store.content(f.session(a),x.media.id,proof.readProof);assert(bytes.length>0)
 await assert.rejects(f.store.content({...f.session(a),sessionId:randomUUID()},x.media.id,proof.readProof),{code:'NOT_FOUND'})
 await assert.rejects(f.store.content(f.session(f.actor()),x.media.id,proof.readProof),{code:'NOT_FOUND'})
 await assert.rejects(f.store.readUrl(f.session(a),x.media.id,x.clientMessageId,'person_photo'),{code:'NOT_FOUND'})
 await assert.rejects(f.store.remove(a,x.media.id,randomUUID(),x.media.version),{code:'MEDIA_IN_USE'})
 f.conversationSources.get(a).clear();await assert.rejects(f.store.content(f.session(a),x.media.id,proof.readProof),{code:'NOT_FOUND'})
})

test('regrant reads saved bytes but does not revive old slots, complete, unbound ready intents or verification jobs',async t=>{
 const f=await fixture(t),a=f.actor(),x=await photo(f,a),pending=await photo(f,a,{ready:false}),unbound=await photo(f,a);await bind(f,a,x);commit(f,a,x);const old=await read(f,a,x)
 f.accounts.get(a).chatPhotoStorage={allowed:false,authorizationVersion:2};await assert.rejects(read(f,a,x),{code:'CHAT_PHOTO_STORAGE_PERMISSION_REQUIRED'});await f.engine.reconcile();assert.equal((await f.store.get(a,x.media.id)).status,'ready')
 f.accounts.get(a).chatPhotoStorage={allowed:true,authorizationVersion:3};await assert.rejects(f.store.content(f.session(a),x.media.id,old.readProof),{code:'NOT_FOUND'});assert((await f.store.content(f.session(a),x.media.id,(await read(f,a,x)).readProof)).length)
 await assert.rejects(f.store.newSlot(a,pending.media.id,randomUUID(),pending.media.version),{code:'AUTHORIZATION_CHANGED'});await assert.rejects(f.store.complete(a,pending.media.id,pending.upload.id,randomUUID()),{code:'AUTHORIZATION_CHANGED'});await assert.rejects(bind(f,a,unbound),{code:'PHOTO_SELECTION_INVALID'})
 const late=await photo(f,a,{ready:false});await f.store.complete(a,late.media.id,late.upload.id,randomUUID());f.accounts.get(a).storyStorage.authorizationVersion++
 await f.engine.run(await f.engine.claim());assert.equal((await f.store.get(a,late.media.id)).status,'rejected');assert.equal((await f.storage.list('ready/'+a+'/'+late.media.id+'/')).length,0)
})

test('model bytes require live exact attempt and independent image authorization before and after IO',async t=>{
 const f=await fixture(t),a=f.actor(),x=await photo(f,a);await bind(f,a,x);commit(f,a,x);const j=attempt(f,a,x)
 assert((await f.store.photoReplyContent(a,j.jobId,j.attemptId)).length)
 await assert.rejects(f.store.photoReplyContent(a,j.jobId,randomUUID()),{code:'NOT_FOUND'})
 f.accounts.get(a).chatImageReplies={allowed:false,authorizationVersion:2};await assert.rejects(f.store.photoReplyContent(a,j.jobId,j.attemptId),{code:'CHAT_IMAGE_REPLY_PERMISSION_REQUIRED'});assert((await read(f,a,x)).readProof)
 f.accounts.get(a).chatImageReplies={allowed:true,authorizationVersion:3};await assert.rejects(f.store.photoReplyContent(a,j.jobId,j.attemptId),{code:'AUTHORIZATION_CHANGED'})
 f.accounts.get(a).chatImageReplies={allowed:true,authorizationVersion:1};const get=f.storage.get.bind(f.storage)
 f.storage.get=async(...args)=>{const data=await get(...args);f.photoReplySources.delete(a+':'+j.jobId+':'+j.attemptId);return data}
 await assert.rejects(f.store.photoReplyContent(a,j.jobId,j.attemptId),{code:'NOT_FOUND'});f.storage.get=get
 attempt(f,a,x);const current=attempt(f,a,x);f.storage.get=async(...args)=>{const data=await get(...args);f.accounts.get(a).chatImageReplies={allowed:false,authorizationVersion:2};return data};await assert.rejects(f.store.photoReplyContent(a,current.jobId,current.attemptId),{code:'CHAT_IMAGE_REPLY_PERMISSION_REQUIRED'})
})

test('source removal during byte IO denies browser content and export; rights remain independent of withdrawn normal grants',async t=>{
 const f=await fixture(t),a=f.actor(),x=await photo(f,a);await bind(f,a,x);commit(f,a,x);const proof=await read(f,a,x),get=f.storage.get.bind(f.storage),rights=new MediaDataRights(f.store)
 f.storage.get=async(...args)=>{const data=await get(...args);f.conversationSources.get(a).clear();return data};await assert.rejects(f.store.content(f.session(a),x.media.id,proof.readProof),{code:'NOT_FOUND'});commit(f,a,x);await assert.rejects(rights.export(a,f.dataRequest(a),'account_data'),{code:'EXPORT_STALE'});f.storage.get=get;commit(f,a,x)
 f.accounts.get(a).storyStorage.allowed=false;f.accounts.get(a).chatPhotoStorage.allowed=false;f.accounts.get(a).chatImageReplies.allowed=false
 const exported=await rights.export(a,f.dataRequest(a),'account_data');assert.equal(exported.data.conversationBindings.length,1);assert.equal(exported.data.conversationBindings[0].clientMessageId,x.clientMessageId);assert.equal(exported.data.media.length,1);assert.equal(hash(Buffer.from(exported.data.media[0].bytesBase64,'base64')),exported.data.media[0].sha256)
 await rights.erase(a,f.dataRequest(a,'delete_account'));for(const table of ['media_conversation_grants','media_jobs','media_objects','media_upload_slots','media_commands'])assert.equal((await f.pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n,0);assert.equal((await f.storage.list('ready/'+a+'/')).length,0);assert.equal((await f.storage.list('staging/'+a+'/')).length,0)
})

test('GC cannot treat dependency failure as deletion and fences a racing fresh bind before actual purge',async t=>{
 const f=await fixture(t),a=f.actor(),x=await photo(f,a)
 await f.pool.query("INSERT INTO media_conversation_grants(account_id,media_id,conversation_id,client_message_id,media_version,created_at,last_bound_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()-interval '17 minutes',clock_timestamp()-interval '16 minutes')",[a,x.media.id,x.conversationId,x.clientMessageId,x.media.version])
 const age=()=>f.pool.query("UPDATE media_conversation_grants SET last_bound_at=clock_timestamp()-interval '16 minutes' WHERE account_id=$1",[a])
 await age();const valid=f.store.dependencies.validConversationPhotos.bind(f.store.dependencies);f.store.dependencies.validConversationPhotos=async()=>{throw new MediaError(503,'DEPENDENCY_UNAVAILABLE')};await f.engine.reconcile();assert.equal((await f.store.get(a,x.media.id)).status,'ready')
 let enter,resume;const entered=new Promise(r=>enter=r),gate=new Promise(r=>resume=r)
 f.store.dependencies.validConversationPhotos=async(...args)=>{const result=await valid(...args);enter();await gate;return result};const sweep=f.store.reconcileConversation(await f.store.row(a,x.media.id));await entered;await bind(f,a,x);commit(f,a,x);resume();await sweep;assert.equal((await f.store.get(a,x.media.id)).status,'ready')
 f.store.dependencies.validConversationPhotos=valid;await age();f.conversationSources.get(a).clear();await f.engine.reconcile();assert.equal((await f.store.get(a,x.media.id)).status,'revoked');await f.engine.run(await f.engine.claim());assert.equal((await f.storage.list('ready/'+a+'/')).length,0)
})

test('HTTP keeps conversation bearer distinct and exposes only scoped WebP streams and private proof',async t=>{
 const f=await fixture(t),a=f.actor(),x=await photo(f,a),app=await createMediaApp(f.config,f.store);await app.listen(0,'127.0.0.1');t.after(()=>app.close());const base=await app.getUrl(),path='/internal/v1/conversations/'+x.conversationId+'/messages/'+x.clientMessageId+'/media-bindings',body=JSON.stringify({mediaId:x.media.id,version:x.media.version}),headers={Authorization:'Bearer '+f.config.conversationsToken,'X-Xijie-Account-Id':a,'Content-Type':'application/json'}
 let response=await fetch(base+path,{method:'POST',headers:{...headers,Authorization:'Bearer '+f.config.giftsToken},body});assert.equal(response.status,403)
 response=await fetch(base+path,{method:'POST',headers,body});assert.equal(response.status,200);assert((await response.json()).data.expiresAt);commit(f,a,x)
 response=await fetch(base+'/v1/media/'+x.media.id+'/read-url',{method:'POST',headers:{Cookie:'test='+a,Origin:f.config.webOrigin,'X-Xijie-Expected-Session':a,'Content-Type':'application/json'},body:JSON.stringify({purpose:'conversation_attachment',target:{kind:'conversation_message',id:x.clientMessageId,conversationId:x.conversationId}})});assert.equal(response.status,200);const proof=(await response.json()).data
 response=await fetch(base+proof.url,{headers:{Cookie:'test='+a,'X-Xijie-Expected-Session':a,'X-Media-Read-Proof':proof.readProof}});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/webp')
 const j=attempt(f,a,x),modelPath='/internal/v1/photo-reply-jobs/'+j.jobId+'/attempts/'+j.attemptId+'/media-content';response=await fetch(base+modelPath,{method:'POST',headers,body:'{}'});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/webp');assert((await response.arrayBuffer()).byteLength)
 response=await fetch(base+modelPath,{method:'POST',headers,body:'{"mediaId":"ignored"}'});assert.equal(response.status,422)
})

test('conversation dependency contracts reject malformed bool vectors and require exact source identity versions',async()=>{
 const accountId=randomUUID(),conversationId=randomUUID(),clientMessageId=randomUUID(),mediaId=randomUUID(),jobId=randomUUID(),attemptId=randomUUID(),ref={conversationId,clientMessageId,messageVersion:1,mediaId,version:3};let value={valid:[true]},seen,status=200
 const deps=new Dependencies({conversationsOrigin:'http://127.0.0.1:3103',serviceToken:'synthetic'},async(url,options)=>{seen={url:String(url),options};return Response.json({data:value},{status})})
 assert.deepEqual(await deps.validConversationPhotos(accountId,[ref]),[ref]);assert(seen.url.endsWith('/internal/v1/conversation-media/validate'));assert.equal(seen.options.headers['X-Xijie-Account-Id'],accountId)
 for(const valid of [[],[true,false],[1],[ref]]){value={valid};await assert.rejects(deps.validConversationPhotos(accountId,[ref]),{code:'DEPENDENCY_UNAVAILABLE'})}
 value={accountId,conversationId,personId:randomUUID()};assert.equal((await deps.conversationTarget(accountId,conversationId)).accountId,accountId);value.accountId=randomUUID();await assert.rejects(deps.conversationTarget(accountId,conversationId),{code:'DEPENDENCY_UNAVAILABLE'})
 value={...ref,messageId:randomUUID(),accountAccessVersion:1,storyAuthorizationVersion:2,photoAuthorizationVersion:3,imageAuthorizationVersion:4};assert.equal((await deps.photoReplySource(accountId,jobId,attemptId)).version,3);value.imageAuthorizationVersion=0;await assert.rejects(deps.photoReplySource(accountId,jobId,attemptId),{code:'DEPENDENCY_UNAVAILABLE'});status=403;await assert.rejects(deps.photoReplySource(accountId,jobId,attemptId),{code:'CHAT_IMAGE_REPLY_PERMISSION_REQUIRED'})
})

test('a removed direct target cannot publish queued canonical bytes and current storage grant is still independently required',async t=>{
 const f=await fixture(t),a=f.actor(),x=await photo(f,a,{ready:false});await f.store.complete(a,x.media.id,x.upload.id,randomUUID());const job=await f.engine.claim();f.conversationTargets.get(a).clear();await f.engine.run(job)
 assert.equal((await f.store.get(a,x.media.id)).status,'rejected');assert.equal((await f.storage.list('ready/'+a+'/'+x.media.id+'/')).length,0)
 const target=randomUUID();f.conversationTargets.get(a).set(target,{accountId:a,conversationId:target,personId:randomUUID()});f.accounts.get(a).storyStorage.allowed=false
 await assert.rejects(f.store.create(a,randomUUID(),{purpose:'conversation_attachment',conversationId:target,clientMessageId:randomUUID(),mimeType:'image/png',byteSize:f.bytes.length,sha256:hash(f.bytes)}),{code:'STORAGE_PERMISSION_REQUIRED'})
})
