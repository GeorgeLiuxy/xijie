import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {validateChatPhotoReferences} from './chat-photos.mjs'
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
const A=id(1),P=id(2),C=id(3),S=id(4),R=id(5),J=id(6),M=id(7),CLIENT=id(8),W=id(9)
const T='2026-11-14T00:00:00.000Z',BEFORE='2026-11-13T23:59:00.000Z',AFTER='2026-11-14T00:00:02.000Z'
const targets=['identity','people','conversations','media'].map(domain=>({domain}))
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
function fixture(){
 const metadata={mime_type:'image/webp',width:8,height:8,byte_size:14},sha256=createHash('sha256').update('verified bytes').digest('hex'),objectKey=`ready/${A}/${M}/${id(10)}`
 const fingerprint=hash({clientMessageId:CLIENT,kind:'photo',media:{id:M,version:3}})
 const source={id:S,account_id:A,conversation_id:C,conversation_kind:'direct',sequence:'1',kind:'photo',author_kind:'self',client_message_id:CLIENT,reply_to_message_id:null,generation_job_id:null,gather_reply_job_id:null,photo_reply_job_id:J,speaker_person_id:null,has_display_name:false,request_hash:fingerprint,version:1,created_at:T,removed_at:null,text_length:0}
 const reply={...source,id:R,sequence:'2',kind:'text',author_kind:'persona',client_message_id:null,reply_to_message_id:S,speaker_person_id:P,has_display_name:true,request_hash:null,created_at:AFTER,text_length:10}
 const personRef={id:P,version:1,accessVersion:1,worldId:W,worldVersion:1},worldRef={accountId:A,personId:P,personVersion:1,worldVersion:1,worldId:W,catalogVersion:1,reality:'virtual',branch:'main',movementIds:[],revision:'b'.repeat(64)}
 return{
  schema:[{table_name:'message_media'},{table_name:'photo_reply_jobs'}],mediaSchema:[{table_name:'media_conversation_grants'}],
  rooms:[{id:C,account_id:A,person_id:P,kind:'direct',last_sequence:'2'}],messages:[source,reply],
  refs:[{account_id:A,conversation_id:C,message_id:S,client_message_id:CLIENT,message_version:1,media_id:M,media_version:3,source_kind:'photo',source_author:'self',created_at:T,...metadata}],
  jobs:[{id:J,account_id:A,conversation_id:C,person_id:P,conversation_kind:'direct',source_message_id:S,source_version:1,source_kind:'photo',source_author:'self',media_id:M,media_version:3,account_access_version:1,person_version:1,person_access_version:1,world_version:1,story_authorization_version:2,photo_authorization_version:2,image_authorization_version:2,state:'succeeded',version:3,attempt_id:null,attempt_count:1,lease_until:null,next_attempt_at:T,failure_code:null,retryable:false,reply_id:R,person_context_ref:personRef,world_context_ref:worldRef,provider_provenance:{provider:'openai',model:'test-vision',responseId:null,promptVersion:'person-chat-image-replies-v1'},created_at:T,updated_at:AFTER}],
  accounts:[{id:A,access_version:1}],
  consents:[{account_id:A,purpose:'privacy_notice',authorization_version:1,decision:'acknowledge',recorded_at:BEFORE},...['private_story_storage','private_chat_photo_storage','person_chat_image_replies'].map(purpose=>({account_id:A,purpose,authorization_version:2,decision:'grant',notice_authorization_version:1,recorded_at:BEFORE}))],
  persons:[{id:P,account_id:A,status:'active',version:1,access_version:1,world_id:W,world_version:1}],worlds:[{id:W,catalog_version:1}],movements:[],
  media:[{id:M,account_id:A,purpose:'conversation_attachment',chat_conversation_id:C,chat_client_message_id:CLIENT,client_post_id:null,person_draft_id:null,gift_delivery_id:null,gift_storage_authorization_version:null,storage_authorization_version:2,photo_authorization_version:2,account_access_version:1,version:3,status:'ready',sha256,object_key:objectKey,...metadata}],
  grants:[{account_id:A,media_id:M,conversation_id:C,client_message_id:CLIENT,message_version:1,media_version:3,state:'active',created_at:BEFORE,last_bound_at:BEFORE,confirmed_at:T,revoked_at:null}],objects:[{key:objectKey,sha256,byteSize:metadata.byte_size,contentType:'image/webp'}],
  commands:[{account_id:A,operation:'send',target:C,idempotency_key:id(11),request_hash:fingerprint,created_at:T,job_id:J,message_id:S,result_kind:'photo',result_client_id:CLIENT,result_photo:{mediaId:M,version:3,mimeType:'image/webp',width:8,height:8,byteSize:14}}],
  events:[{account_id:A,aggregate_type:'message',aggregate_id:S,aggregate_version:1,type:'MessageAccepted.v1',payload:{conversationId:C,messageId:S,kind:'photo',acceptedAt:T},occurred_at:T},{account_id:A,aggregate_type:'message',aggregate_id:R,aggregate_version:1,type:'MessageAccepted.v1',payload:{conversationId:C,messageId:R,kind:'text',generationKind:'photo_reply'},occurred_at:AFTER},{account_id:A,aggregate_type:'photo_reply_job',aggregate_id:J,aggregate_version:3,type:'GenerationChanged.v1',payload:{jobId:J,kind:'photo_reply',targetId:C,state:'succeeded',replyId:R},occurred_at:AFTER}]
 }
}
function runtime(f,seen=[]){return{query:async(t,sql)=>{
 seen.push(sql)
 if(sql.includes('information_schema.tables'))return t.domain==='media'?f.mediaSchema:f.schema
 if(sql.includes('FROM public.conversation_commands'))return f.commands
 if(sql.includes('FROM public.outbox_events'))return f.events
 if(sql.includes('FROM public.conversations WHERE'))return f.rooms
 if(sql.includes('FROM public.messages WHERE'))return f.messages
 if(sql.includes('FROM public.message_media'))return f.refs
 if(sql.includes('FROM public.photo_reply_jobs'))return f.jobs
 if(sql.includes('FROM public.accounts'))return f.accounts
 if(sql.includes('FROM public.consent_events'))return f.consents
 if(sql.includes('FROM public.persons'))return f.persons
 if(sql.includes('FROM public.worlds'))return f.worlds
 if(sql.includes('FROM public.person_world_movements'))return f.movements
 if(sql.includes('FROM public.media_objects'))return f.media
 if(sql.includes('FROM public.media_conversation_grants'))return f.grants
 throw Error('Unexpected recovery query')
}}}
const verify=f=>validateChatPhotoReferences(runtime(f),targets,f.objects)
async function rejects(mutations){for(const change of mutations){const f=fixture();change(f);await assert.rejects(verify(f),/differs/,change.toString())}}
function remove(f,index=0){
 const m=f.messages[index];m.version=2;m.removed_at=AFTER
 f.commands.push({account_id:A,operation:'remove',target:m.id,idempotency_key:id(30+index),request_hash:hash({conversationId:C,version:1}),created_at:AFTER,result_id:m.id,result_version:'2',removed_at:AFTER})
 f.events.push({account_id:A,aggregate_type:'message',aggregate_id:m.id,aggregate_version:2,type:'MessageRemoved.v1',payload:{conversationId:C,messageId:m.id,kind:m.kind},occurred_at:AFTER})
}
function pending(f){
 f.messages.pop();f.events.splice(1);Object.assign(f.jobs[0],{state:'queued',version:1,attempt_count:0,reply_id:null,person_context_ref:null,world_context_ref:null,provider_provenance:null,updated_at:T})
}
test('chat restore ties accepted immutable source, exact grant, canonical metadata and archive hash without loading private text',async()=>{
 const f=fixture(),seen=[],report=await validateChatPhotoReferences(runtime(f,seen),targets,f.objects)
 assert.deepEqual(report,{applicable:true,messageCount:2,referenceCount:1,activeReferenceCount:1,jobCount:1,replyCount:1,candidateCount:0,verified:true})
 assert(!JSON.stringify(report).includes(A));assert(!JSON.stringify(report).includes('test-vision'));assert(!JSON.stringify(report).includes('ready/'))
 const messageSql=seen.find(sql=>sql.includes('FROM public.messages WHERE')),personSql=seen.find(sql=>sql.includes('FROM public.persons'))
 assert(messageSql.includes('char_length(text) AS text_length'));assert(!messageSql.includes('SELECT *'));assert(!personSql.includes('story'));assert(!personSql.includes('display_name'))
 const commandSql=seen.find(sql=>sql.includes('FROM public.conversation_commands'))
 assert(!/SELECT[^]*\bresponse\s*(,|FROM)/.test(commandSql));assert(!commandSql.includes("->>'text'"))
 await rejects([x=>x.refs=[],x=>x.jobs=[],x=>x.messages.shift(),x=>x.messages.pop(),x=>x.media=[],x=>x.grants=[],x=>x.objects=[],x=>x.refs[0].account_id=id(77),x=>x.refs[0].conversation_id=id(77),x=>x.refs[0].client_message_id=id(77),x=>x.refs[0].message_version=2,x=>x.refs[0].source_kind='text',x=>x.refs[0].source_author='persona',x=>x.refs[0].media_id=id(77),x=>x.refs[0].media_version++,x=>x.refs[0].width++,x=>x.media[0].purpose='person_photo',x=>x.media[0].person_draft_id=id(77),x=>x.media[0].status='revoked',x=>x.media[0].chat_client_message_id=id(77),x=>x.media[0].chat_conversation_id=id(77),x=>x.media[0].storage_authorization_version++,x=>x.media[0].photo_authorization_version++,x=>x.grants[0].state='revoked',x=>x.grants[0].message_version=2,x=>x.grants[0].media_version++,x=>x.objects[0].sha256='f'.repeat(64),x=>x.objects[0].byteSize++,x=>x.objects[0].contentType='image/png',x=>{x.media[0].object_key=x.objects[0].key=`ready/${id(77)}/${M}/${id(10)}`},x=>x.refs.push({...x.refs[0]}),x=>x.grants.push({...x.grants[0]})])
})
test('permanent commands, fingerprints, source/reply events and deletion receipts cannot disappear',async()=>{
 await rejects([x=>x.commands=[],x=>x.commands[0].request_hash='f'.repeat(64),x=>x.messages[0].request_hash='f'.repeat(64),x=>x.commands[0].job_id=id(77),x=>x.commands[0].message_id=id(77),x=>x.commands[0].target=id(77),x=>x.commands[0].account_id=id(77),x=>x.commands[0].result_photo.version++,x=>x.commands[0].result_client_id=id(77),x=>x.events.shift(),x=>x.events.splice(1,1),x=>x.events.pop(),x=>x.events[0].payload.acceptedAt=AFTER,x=>x.events[1].payload.generationKind='chat_reply',x=>x.events[2].aggregate_type='generation_job',x=>x.events[2].payload.replyId=id(77),x=>x.messages[1].sequence='1',x=>x.messages[1].text_length=0,x=>x.messages[1].generation_job_id=id(77),x=>x.messages[1].speaker_person_id=id(77),x=>x.messages[0].kind='text',x=>x.messages[0].conversation_kind='gather',x=>{remove(x);x.commands.pop()},x=>{remove(x);x.events.pop()},x=>{remove(x);x.commands.at(-1).request_hash=hash({conversationId:C,version:2})}])
 const f=fixture();remove(f);remove(f,1);assert.equal((await verify(f)).replyCount,1)
 // A concurrent same-client accepted request can persist the smaller replay receipt.
 delete f.commands[0].result_kind;delete f.commands[0].result_client_id;delete f.commands[0].result_photo
 assert.equal((await verify(f)).verified,true)
})
test('historical explicit grant and privacy-notice versions are required, independent of later withdrawal or regrant',async()=>{
 await rejects([x=>x.consents.pop(),x=>x.consents[2].decision='withdraw',x=>x.consents[2].notice_authorization_version=8,x=>x.consents[2].recorded_at=AFTER,x=>x.consents[0].decision='grant',x=>x.consents[0].recorded_at=T,x=>x.jobs[0].image_authorization_version=3,x=>x.jobs[0].photo_authorization_version=0,x=>x.jobs[0].account_access_version=2,x=>x.persons[0].account_id=id(77),x=>x.jobs[0].person_access_version=2])
 const f=fixture();for(const purpose of ['private_chat_photo_storage','person_chat_image_replies'])f.consents.push({account_id:A,purpose,authorization_version:3,decision:'withdraw',notice_authorization_version:1,recorded_at:AFTER},{account_id:A,purpose,authorization_version:4,decision:'grant',notice_authorization_version:1,recorded_at:AFTER})
 f.accounts[0].access_version=2
 assert.equal((await verify(f)).verified,true)
 f.objects=[];await assert.rejects(verify(f),/differs/)
})
test('source deletion or removed person may outlive GC, while their accepted history and visual reply remain required',async()=>{
 for(const change of [f=>remove(f),f=>{f.persons[0].status='removed';f.persons[0].version++;f.persons[0].access_version++}]){
  const f=fixture();change(f);f.media=[];f.grants=[];f.objects=[]
  const report=await verify(f);assert.equal(report.activeReferenceCount,0);assert.equal(report.replyCount,1)
  f.commands=[];await assert.rejects(verify(f),/differs/)
 }
})
test('model provenance and minimal person/world context remain exact across subsequent profile changes and migration',async()=>{
 await rejects([x=>x.jobs[0].provider_provenance=null,x=>x.jobs[0].provider_provenance.promptVersion='chat-v1',x=>x.jobs[0].provider_provenance.provider='template',x=>x.jobs[0].provider_provenance.model='',x=>x.jobs[0].provider_provenance.extra='PRIVATE',x=>x.jobs[0].person_context_ref.story='PRIVATE STORY',x=>x.jobs[0].person_context_ref.version=2,x=>x.jobs[0].world_context_ref.personId=id(77),x=>x.jobs[0].world_context_ref.catalogVersion=2,x=>x.jobs[0].world_context_ref.revision='wrong',x=>x.jobs[0].world_context_ref.movementIds=[id(77)],x=>x.jobs[0].attempt_count=0,x=>x.jobs[0].attempt_id=id(77),x=>x.jobs[0].lease_until=AFTER,x=>x.jobs[0].retryable=true])
 const f=fixture();f.persons[0].version=3;f.persons[0].world_version=2;f.persons[0].world_id=id(50);f.worlds.push({id:id(50),catalog_version:1});f.movements.push({id:id(51),account_id:A,person_id:P,world_version:2,person_version:2,from_world_id:W,to_world_id:id(50)})
 assert.equal((await verify(f)).verified,true)
 f.movements[0].from_world_id=id(52);await assert.rejects(verify(f),/differs/)
})
test('pending and restore-quarantined jobs retain immutable source but no claimed execution or invented response',async()=>{
 const f=fixture();pending(f);assert.equal((await verify(f)).replyCount,0)
 Object.assign(f.jobs[0],{state:'blocked',version:2,failure_code:'RESTORE_REVIEW_REQUIRED',updated_at:AFTER});f.accounts[0].access_version++
 assert.equal((await verify(f)).verified,true)
 for(const change of [x=>x.jobs[0].attempt_id=id(77),x=>x.jobs[0].lease_until=AFTER,x=>x.jobs[0].reply_id=R,x=>x.jobs[0].attempt_count=4,x=>x.jobs[0].provider_provenance={provider:'openai'}]){const x=structuredClone(f);change(x);await assert.rejects(verify(x),/differs/)}
 Object.assign(f.jobs[0],{state:'running',attempt_id:id(77),lease_until:AFTER,attempt_count:1});assert.equal((await verify(f)).verified,true)
 f.commands.push({account_id:A,operation:'photo.cancel',target:J,idempotency_key:id(20),request_hash:hash({}),result_id:J,created_at:AFTER});assert.equal((await verify(f)).verified,true)
 f.commands.at(-1).request_hash=hash({unexpected:true});await assert.rejects(verify(f),/differs/)
})
test('prebind-only candidate stays separate from accepted sources and cannot disguise cross-account or mutable target grants',async()=>{
 const f=fixture(),m={...f.media[0],id:id(60),chat_client_message_id:id(61),object_key:`ready/${A}/${id(60)}/${id(62)}`},g={...f.grants[0],media_id:m.id,client_message_id:m.chat_client_message_id,confirmed_at:null}
 f.media.push(m);f.grants.push(g);f.objects.push({...f.objects[0],key:m.object_key})
 assert.equal((await verify(f)).candidateCount,1);assert.equal((await verify(f)).referenceCount,1)
 f.grants[1].account_id=id(77);await assert.rejects(verify(f),/differs/)
})
test('legacy package boundary is explicit; partial new schemas or missing authority databases fail closed',async()=>{
 const f=fixture()
 assert.deepEqual(await validateChatPhotoReferences(runtime(f),[],[]),{applicable:false,reason:'legacy_without_conversations'})
 f.schema=[];assert.deepEqual(await verify(f),{applicable:false,reason:'legacy_without_chat_photos'})
 f.schema=[{table_name:'message_media'}];await assert.rejects(verify(f),/incomplete/)
 f.schema=fixture().schema;f.mediaSchema=[];await assert.rejects(verify(f),/incomplete/)
 f.mediaSchema=fixture().mediaSchema
 for(const domain of ['identity','people','media'])await assert.rejects(validateChatPhotoReferences(runtime(f),targets.filter(t=>t.domain!==domain),[]),/require/)
})
