import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {fixture,text,eventually} from './fixture.mjs'
import {PhotoStore} from '../dist/photo-store.js'
import {PhotoEngine} from '../dist/photo-engine.js'
import {createPhotoQueue} from '../dist/photo-queue.js'
import {GenerationError} from '../dist/provider.js'
import {worldContextRevision} from '../dist/virtual-world.js'
import {photoInput} from '../dist/contracts.js'
const provenance={provider:'openai',model:'synthetic-intercept',responseId:'synthetic-response',promptVersion:'person-chat-image-replies-v1'},output={text:'合成图中是一只纸船。',provenance},image=Buffer.from('RIFF\x04\0\0\0WEBP')
async function setup(t){const f=await fixture(t),a=f.account(),account=f.accounts.get(a.id);account.chatPhotoStorage={allowed:true,authorizationVersion:1};account.chatImageReplies={allowed:true,authorizationVersion:1};account.aiTextProcessing={allowed:false,authorizationVersion:2};f.people.get(a.person.id).worldVersion=1;let binds=0,hook=async()=>{},expiry=()=>new Date(Date.now()+60000).toISOString()
 f.dependencies.photoBind=async(_a,c,client,id,version)=>{binds++;await hook();return{conversationId:c,clientMessageId:client,media:{id,version,mimeType:'image/webp',width:32,height:24,byteSize:image.length},expiresAt:expiry()}}
 f.dependencies.photoBytes=async()=>image;f.dependencies.virtualWorld=async(accountId,personId)=>{const p=await f.dependencies.person(accountId,personId),v={accountId,personId,personVersion:p.version,worldVersion:p.worldVersion,reality:'virtual',branch:'main',currentWorld:{id:p.worldId,code:'courtyard',displayName:'合成庭院',catalogVersion:1,enabled:true},recentMovements:[]};return{...v,revision:worldContextRevision(v)}}
 const queue=createPhotoQueue(f.queue.boss);await queue.start();const photos=new PhotoStore(f.pool,f.dependencies,queue),c=(await f.store.ensure(a.id,a.person.id,randomUUID())).conversation.id
 return{...f,boss:f.queue.boss,newAccount:f.account,a,account,c,photos,queue,binds:()=>binds,onBind:v=>hook=v,expires:v=>expiry=v}
}
const input=()=>({clientMessageId:randomUUID(),kind:'photo',media:{id:randomUUID(),version:1}})
const send=(f,v=input(),key=randomUUID())=>f.photos.send(f.a.id,f.c,key,v,randomUUID())
async function due(f,id){await f.pool.query("UPDATE photo_reply_jobs SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=$1",[id])}

test('single-photo intent commits atomically, replays live state without bind and preserves old text-only authorization',async t=>{
 const f=await setup(t),v=input(),key=randomUUID(),accepted=await send(f,v,key)
 assert.equal(accepted.message.kind,'photo');assert.equal(accepted.message.text,'');assert.equal(accepted.message.inputMode,undefined);assert.equal(accepted.message.photo.mediaId,v.media.id);assert.equal(accepted.message.generationKind,'photo_reply')
 f.account.chatImageReplies={allowed:false,authorizationVersion:2};f.onBind(async()=>{throw new Error('Old image unavailable')})
 assert.deepEqual(await send(f,v,key),accepted);assert.deepEqual(await send(f,v),accepted);assert.equal(f.binds(),1)
 await assert.rejects(send(f,{...v,media:{id:randomUUID(),version:1}},key),{code:'IDEMPOTENCY_CONFLICT'})
 await assert.rejects(send(f),{code:'CHAT_IMAGE_REPLY_PERMISSION_REQUIRED'})
 await assert.rejects(f.store.send(f.a.id,f.c,randomUUID(),text(),randomUUID()),{code:'AI_PERMISSION_REQUIRED'})
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM photo_reply_jobs')).rows[0].n,1);assert.equal((await f.pool.query('SELECT count(*)::int n FROM generation_jobs')).rows[0].n,0)
 for(const wrong of [{...v,inputMode:'typed'},{...v,text:''},{...v,media:[v.media]},{...v,media:{...v.media,url:'https://example.test'}}])assert.throws(()=>photoInput(wrong))
})

test('binding occurs outside locks, expired lease and authorization race roll back source and receipt',async t=>{
 const f=await setup(t)
 f.onBind(async()=>{const db=await f.pool.connect();try{const ok=(await db.query("SELECT pg_try_advisory_lock(hashtextextended('xijie:conversations:erasure:' || $1,0)) ok",[f.a.id])).rows[0].ok;assert.equal(ok,true);await db.query("SELECT pg_advisory_unlock(hashtextextended('xijie:conversations:erasure:' || $1,0))",[f.a.id])}finally{db.release()}})
 f.expires(()=>new Date(Date.now()-1).toISOString());await assert.rejects(send(f),{code:'MEDIA_BINDING_EXPIRED'});assert.equal((await f.pool.query('SELECT count(*)::int n FROM message_media')).rows[0].n,0)
 f.expires(()=>new Date(Date.now()+60000).toISOString());f.onBind(async()=>{f.account.chatPhotoStorage={allowed:true,authorizationVersion:3}});await assert.rejects(send(f),{code:'AUTHORIZATION_CHANGED'});assert.equal((await f.pool.query('SELECT count(*)::int n FROM messages')).rows[0].n,0)
})

test('image engine passes only one source, commits one truthful reply, and source removal preserves saved text',async t=>{
 const f=await setup(t),accepted=await send(f);let calls=0
 const engine=new PhotoEngine(f.photos,{async generate(v){calls++;assert.deepEqual(v.image,image);assert.equal(v.memories,undefined);assert.equal(v.messages,undefined);assert.equal(v.chatImageReplies.allowed,true);return output}})
 await engine.run(accepted.generationJobId);await engine.run(accepted.generationJobId);assert.equal(calls,1)
 const j=await f.photos.find(accepted.generationJobId);assert.equal(j.state,'succeeded');assert.equal(j.attempt_id,null);assert.deepEqual(j.provider_provenance,provenance)
 const reply=(await f.pool.query('SELECT * FROM messages WHERE id=$1',[j.reply_id])).rows[0];assert.equal(reply.generation_job_id,null);assert.equal(reply.photo_reply_job_id,j.id);assert.equal(reply.reply_to_message_id,accepted.message.id)
 const ref={conversationId:f.c,clientMessageId:accepted.message.clientMessageId,messageVersion:1,mediaId:accepted.message.photo.mediaId,version:1}
 f.account.chatPhotoStorage={allowed:false,authorizationVersion:2};assert.deepEqual(await f.photos.validate(f.a.id,[ref]),{valid:[true]});await assert.rejects(f.photos.readMessage(f.a.id,accepted.message.id),{code:'CHAT_PHOTO_STORAGE_PERMISSION_REQUIRED'})
 const removed=await f.photos.remove(f.a.id,f.c,accepted.message.id,randomUUID(),1,randomUUID());assert.equal(removed.version,2);assert.deepEqual(await f.photos.validate(f.a.id,[ref]),{valid:[false]});assert.equal((await f.photos.find(j.id)).state,'succeeded');assert.equal((await f.pool.query('SELECT removed_at FROM messages WHERE id=$1',[reply.id])).rows[0].removed_at,null)
 await f.photos.remove(f.a.id,f.c,reply.id,randomUUID(),1,randomUUID());assert.equal((await f.photos.find(j.id)).state,'succeeded')
})

test('running media source never calls Media and fails after source delete, expired lease, or exact permission change',async t=>{
 const f=await setup(t),accepted=await send(f),j=await f.photos.claim(accepted.generationJobId)
 f.dependencies.photoBytes=async()=>{throw new Error('Source endpoint must not call Media')}
 const source=await f.photos.mediaSource(f.a.id,j.id,j.attempt_id);assert.equal(source.messageId,accepted.message.id);assert.equal(source.photoAuthorizationVersion,1)
 await assert.rejects(f.photos.mediaSource(randomUUID(),j.id,j.attempt_id),{code:'NOT_FOUND'});await assert.rejects(f.photos.mediaSource(f.a.id,j.id,randomUUID()),{code:'NOT_FOUND'})
 f.account.chatImageReplies={allowed:true,authorizationVersion:3};await assert.rejects(f.photos.mediaSource(f.a.id,j.id,j.attempt_id),{code:'AUTHORIZATION_CHANGED'});await f.photos.reconcile();assert.equal((await f.photos.find(j.id)).state,'blocked')
 f.account.chatImageReplies={allowed:true,authorizationVersion:1};await new PhotoEngine(f.photos,{generate:async()=>{throw new Error('revived')}}).run(j.id);assert.equal((await f.photos.find(j.id)).attempt_count,1)
})

test('late provider result cannot cross withdrawal, person version, source deletion or cancel',async t=>{
 for(const mode of ['photo','image','story','person','remove','cancel'])await t.test(mode,async t=>{const f=await setup(t),accepted=await send(f);let calls=0
  const engine=new PhotoEngine(f.photos,{async generate(){calls++;if(mode==='photo')f.account.chatPhotoStorage={allowed:false,authorizationVersion:2};if(mode==='image')f.account.chatImageReplies={allowed:true,authorizationVersion:3};if(mode==='story')f.account.storyStorage={allowed:false,authorizationVersion:2};if(mode==='person')f.people.get(f.a.person.id).version++;if(mode==='remove')await f.photos.remove(f.a.id,f.c,accepted.message.id,randomUUID(),1,randomUUID());if(mode==='cancel')await f.photos.cancel(f.a.id,accepted.generationJobId,randomUUID(),randomUUID());return output}})
  await engine.run(accepted.generationJobId);assert.equal(calls,1);const j=await f.photos.find(accepted.generationJobId);assert.equal(j.state,['remove','cancel'].includes(mode)?'canceled':'blocked');assert.equal(j.reply_id,null);assert.equal(j.attempt_id,null);assert.equal(j.lease_until,null)
 })
})

test('photo failures and expired leases consume a bounded three-attempt budget',async t=>{
 const f=await setup(t),accepted=await send(f);let calls=0;const engine=new PhotoEngine(f.photos,{async generate(){calls++;throw new GenerationError('MODEL_REQUEST_FAILED',true)}})
 for(let i=1;i<=3;i++){await due(f,accepted.generationJobId);await engine.run(accepted.generationJobId);const j=await f.photos.find(accepted.generationJobId);assert.equal(j.attempt_count,i);assert.equal(j.state,i===3?'failed':'queued');assert.equal(j.attempt_id,null)}
 await engine.run(accepted.generationJobId);assert.equal(calls,3);await assert.rejects(f.photos.retry(f.a.id,accepted.generationJobId,randomUUID(),randomUUID()),{code:'RETRY_NOT_ALLOWED'})
 const second=await send(f);for(let i=1;i<=3;i++){await due(f,second.generationJobId);await f.photos.claim(second.generationJobId);await f.pool.query("UPDATE photo_reply_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[second.generationJobId]);await f.photos.reconcile()};assert.equal((await f.photos.find(second.generationJobId)).state,'failed')
})

test('photo original and reply native constraints reject text/gather lineage and source mutation',async t=>{
 const f=await setup(t),accepted=await send(f),j=await f.photos.find(accepted.generationJobId)
 await assert.rejects(f.pool.query("UPDATE messages SET kind='text',text='invalid' WHERE id=$1",[accepted.message.id]),e=>e.code==='23514')
 await assert.rejects(f.pool.query('UPDATE photo_reply_jobs SET source_version=2 WHERE id=$1',[j.id]))
 await assert.rejects(f.pool.query('UPDATE message_media SET media_id=$2 WHERE message_id=$1',[accepted.message.id,randomUUID()]))
 await assert.rejects(f.pool.query("INSERT INTO messages(account_id,conversation_id,sequence,author_kind,text,reply_to_message_id,speaker_person_id,display_name) VALUES($1,$2,99,'persona','orphan',$3,$4,'Synthetic')",[f.a.id,f.c,accepted.message.id,f.a.person.id]),e=>e.code==='23514')
 const other=f.newAccount();await assert.rejects(f.photos.send(other.id,f.c,randomUUID(),input(),randomUUID()),{code:'NOT_FOUND'})
})

test('unknown committed send retains one receipt after authorization changes, while queue failure rolls the source back',async t=>{
 const f=await setup(t),v=input(),key=randomUUID(),original=f.queue.sendPhoto
 f.queue.sendPhoto=async(...args)=>{await original(...args);f.account.chatImageReplies={allowed:false,authorizationVersion:2}}
 await assert.rejects(send(f,v,key),{code:'CHAT_IMAGE_REPLY_PERMISSION_REQUIRED'});assert.equal((await f.pool.query('SELECT count(*)::int n FROM photo_reply_jobs')).rows[0].n,1)
 const replay=await send(f,v,key);assert.equal(replay.message.clientMessageId,v.clientMessageId);assert.equal(f.binds(),1)
 f.account.chatImageReplies={allowed:true,authorizationVersion:3};f.queue.sendPhoto=async()=>{throw new Error('synthetic queue unavailable')};await assert.rejects(send(f),/synthetic queue unavailable/)
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM message_media')).rows[0].n,1)
})

test('binding lease is checked after a conversation lock wait, not only before entering SQL',async t=>{
 const f=await setup(t),db=await f.pool.connect();await db.query('BEGIN');await db.query('SELECT id FROM conversations WHERE id=$1 FOR UPDATE',[f.c])
 try{f.expires(()=>new Date(Date.now()+150).toISOString());const pending=send(f);await new Promise(resolve=>setTimeout(resolve,350));await db.query('COMMIT');await assert.rejects(pending,{code:'MEDIA_BINDING_EXPIRED'});assert.equal((await f.pool.query('SELECT count(*)::int n FROM messages')).rows[0].n,0)}finally{await db.query('ROLLBACK');db.release()}
})

test('photo worker stop racing claim and late lease expiry never call or commit outside the current attempt',async t=>{
 const f=await setup(t),accepted=await send(f),claim=f.photos.claim.bind(f.photos);let release,entered;const ready=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve)
 f.photos.claim=async id=>{const j=await claim(id);entered();await gate;return j};let calls=0;const engine=new PhotoEngine(f.photos,{generate:async()=>{calls++;return output}}),pending=engine.run(accepted.generationJobId);await ready;engine.stop();release();await pending;assert.equal(calls,0);assert.equal((await f.photos.find(accepted.generationJobId)).state,'queued');f.photos.claim=claim
 const second=await send(f),late=new PhotoEngine(f.photos,{async generate(){await f.pool.query("UPDATE photo_reply_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[second.generationJobId]);return output}});await late.run(second.generationJobId);const j=await f.photos.find(second.generationJobId);assert.equal(j.state,'queued');assert.equal(j.reply_id,null);assert.equal(j.attempt_id,null)
})

test('actual photo queue dispatch and lost physical dispatch reconcile without duplicate saved replies',async t=>{
 const f=await setup(t),accepted=await send(f),id=accepted.generationJobId
 await f.photos.claim(id)
 await f.boss.cancel('photo.reply.v1',(await f.boss.findJobs('photo.reply.v1',{data:{jobId:id}})).map(j=>j.id))
 await f.pool.query("UPDATE photo_reply_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);await f.photos.reconcile()
 assert.equal((await f.boss.findJobs('photo.reply.v1',{data:{jobId:id}})).filter(j=>['created','retry','active'].includes(j.state)).length,1)
 const engine=new PhotoEngine(f.photos,{generate:async()=>output});await f.queue.workPhoto(jobId=>engine.run(jobId));await eventually(async()=>(await f.photos.find(id)).state==='succeeded');assert.equal((await f.pool.query("SELECT count(*)::int n FROM messages WHERE photo_reply_job_id=$1 AND author_kind='persona'",[id])).rows[0].n,1)
})
