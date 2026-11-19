import{test}from'node:test'
import assert from'node:assert/strict'
import{randomUUID}from'node:crypto'
import{fixture,text}from'./fixture.mjs'
import{PhotoEngine}from'../dist/photo-engine.js'
import{AutomaticSourceStore}from'../dist/automatic-sources.js'
import{worldContextRevision}from'../dist/virtual-world.js'
import{exportConversations,eraseConversations}from'../dist/data-rights.js'

async function prepared(t){
 const f=await fixture(t),a=f.account(),b=f.account();a.person.worldVersion=1;f.people.set(a.person.id,a.person)
 Object.assign(f.accounts.get(a.id),{chatPhotoStorage:{allowed:true,authorizationVersion:1},chatImageReplies:{allowed:true,authorizationVersion:1}})
 f.dependencies.virtualWorld=async()=>{const w={accountId:a.id,personId:a.person.id,personVersion:1,worldVersion:1,reality:'virtual',branch:'main',currentWorld:{id:a.person.worldId,code:'courtyard',displayName:'Synthetic world',catalogVersion:1,enabled:true},recentMovements:[]};return{...w,revision:worldContextRevision(w)}}
 f.dependencies.photoBind=async(_a,c,client,id,version)=>({conversationId:c,clientMessageId:client,media:{id,version,mimeType:'image/webp',width:20,height:20,byteSize:12},expiresAt:new Date(Date.now()+60000).toISOString()})
 f.dependencies.photoBytes=async()=>Buffer.from('RIFF0000WEBP')
 const {conversation}=await f.store.ensure(a.id,a.person.id,randomUUID()),cid=conversation.id
 const before=await f.store.send(a.id,cid,randomUUID(),text('Before image'),randomUUID())
 const input={kind:'photo',clientMessageId:randomUUID(),media:{id:randomUUID(),version:4}},photo=await f.store.photos.send(a.id,cid,randomUUID(),input,randomUUID())
 await new PhotoEngine(f.store.photos,{generate:async()=>({text:'VISUAL_PRIVATE_REPLY',provenance:{provider:'openai',model:'synthetic-contract-test',responseId:'synthetic-only',promptVersion:'person-chat-image-replies-v1'}})}).run(photo.generationJobId)
 const job=await f.store.photos.getJob(a.id,photo.generationJobId);assert.equal(job.state,'succeeded')
 return{f,a,b,cid,before,photo,reply:job.replyIds[0]}
}
test('mixed photo history keeps UUID paging, placeholder search, grant filtering and independent saved visual text',async t=>{
 const {f,a,b,cid,before,photo,reply}=await prepared(t)
 let rows=await f.store.messages(a.id,cid,'older',undefined,10);assert.deepEqual(rows.map(r=>r.id),[reply,photo.message.id,before.message.id]);assert.equal(rows[1].kind,'photo');assert.equal(rows[0].generationKind,'photo_reply');assert.equal(rows[0].canSuggestMemory,false)
 const hit=(await f.store.searchHistory(a.id,'一张照片','zh-CN')).items[0];assert.equal(hit.messageId,photo.message.id);assert.equal(hit.messageKind,'photo')
 assert.equal((await f.store.searchHistory(a.id,'a photo','en')).items[0].messageId,photo.message.id)
 assert.deepEqual((await f.store.historyContext(a.id,cid,photo.message.id,3)).items.map(r=>r.id),[before.message.id,photo.message.id,reply])
 await assert.rejects(f.store.messages(b.id,cid,'older',undefined,10),e=>e.status===404)
 f.accounts.get(a.id).chatPhotoStorage={allowed:false,authorizationVersion:2}
 rows=await f.store.messages(a.id,cid,'older',undefined,10);assert.deepEqual(rows.map(r=>r.id),[reply,before.message.id]);assert.deepEqual((await f.store.searchHistory(a.id,'一张照片','zh-CN')).items,[])
 await assert.rejects(f.store.historyContext(a.id,cid,photo.message.id,3),e=>e.status===404)
 f.accounts.get(a.id).chatPhotoStorage={allowed:true,authorizationVersion:3};f.accounts.get(a.id).chatImageReplies={allowed:false,authorizationVersion:2}
 assert.equal((await f.store.messages(a.id,cid,'older',undefined,10)).length,3)
 await f.store.removeMessage(a.id,cid,photo.message.id,randomUUID(),1,randomUUID())
 assert.equal((await f.store.messages(a.id,cid,'older',undefined,10))[0].id,reply)
 assert.equal((await f.store.photos.getJob(a.id,photo.generationJobId)).state,'succeeded')
})
test('photo and visual text cannot become old memory/model input, while rights export and erasure retain the complete new domain',async t=>{
 const {f,a,cid,photo,reply}=await prepared(t)
 for(const id of [photo.message.id,reply]){await assert.rejects(f.store.sourceContext(a.id,id),e=>e.status===404);await assert.rejects(f.store.memorySourceContext(a.id,id),e=>e.status===404)}
 const automatic=new AutomaticSourceStore(f.pool,f.dependencies)
 assert.deepEqual((await automatic.validate(a.id,a.person.id,[{id:reply,version:1},{id:photo.message.id,version:1}])).valid,[])
 const after=await f.store.send(a.id,cid,randomUUID(),text('New plain text'),randomUUID()),context=await f.store.context(await f.store.findJob(after.generationJobId))
 assert(!JSON.stringify(context).includes('VISUAL_PRIVATE_REPLY'));assert(!JSON.stringify(context).includes(photo.message.id))
 f.accounts.get(a.id).chatPhotoStorage={allowed:false,authorizationVersion:2}
 const exported=await exportConversations(f.pool,f.dependencies,a.id,'account_data');assert.equal(exported.data.messageMedia.length,1);assert.equal(exported.data.photoReplyJobs.length,1);assert.equal(exported.data.messages.find(r=>r.id===reply).photoReplyJobId,photo.generationJobId)
 await eraseConversations(f.pool,f.queueSchema,a.id,randomUUID())
 for(const table of ['message_media','photo_reply_jobs','messages','conversations'])assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM '+table+' WHERE account_id=$1',[a.id])).rows[0].n,0)
 assert.equal((await f.pool.query(`SELECT count(*)::int AS n FROM "${f.queueSchema}".job WHERE name='photo.reply.v1'`)).rows[0].n,0)
})
