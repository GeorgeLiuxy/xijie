// Read-only source/permission/object checks. Never load message text or person
// stories. A Media prebind is a candidate, not an accepted chat message.
import {createHash} from 'node:crypto'
const tables=['message_media','photo_reply_jobs']
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const positive=value=>Number.isSafeInteger(value)&&value>0
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
const stamp=value=>typeof value==='string'||value instanceof Date?Date.parse(value):NaN
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key))

export async function validateChatPhotoReferences(runtime,targets,objects){
 const target=domain=>targets.find(t=>t.domain===domain),conversations=target('conversations')
 if(!conversations)return{applicable:false,reason:'legacy_without_conversations'}
 const schema=await runtime.query(conversations,"SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('message_media','photo_reply_jobs')")
 if(!schema.length)return{applicable:false,reason:'legacy_without_chat_photos'}
 if(schema.length!==2||tables.some(name=>!schema.some(row=>row.table_name===name)))throw new Error('Chat photo schema is incomplete')
 if(['identity','people','media'].some(domain=>!target(domain)))throw new Error('Chat photos require Identity, People, Media and the object archive')
 const mediaSchema=await runtime.query(target('media'),"SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='media_conversation_grants'")
 if(mediaSchema.length!==1||mediaSchema[0].table_name!=='media_conversation_grants')throw new Error('Chat photo Media schema is incomplete')
 const queries=[
  ['conversations',"SELECT id,account_id,person_id,kind,last_sequence::text AS last_sequence FROM public.conversations WHERE kind='direct'"],
  ['conversations',"SELECT id,account_id,conversation_id,conversation_kind,sequence::text AS sequence,kind,author_kind,client_message_id,reply_to_message_id,generation_job_id,gather_reply_job_id,photo_reply_job_id,speaker_person_id,display_name IS NOT NULL AS has_display_name,request_hash,version,created_at,removed_at,char_length(text) AS text_length FROM public.messages WHERE kind='photo' OR photo_reply_job_id IS NOT NULL"],
  ['conversations','SELECT * FROM public.message_media'],
  ['conversations','SELECT * FROM public.photo_reply_jobs'],
  ['identity','SELECT id,access_version FROM public.accounts'],
  ['identity',"SELECT account_id,purpose,decision,authorization_version,notice_authorization_version,recorded_at FROM public.consent_events WHERE purpose IN ('privacy_notice','private_story_storage','private_chat_photo_storage','person_chat_image_replies')"],
  ['people','SELECT id,account_id,status,version,access_version,world_id,world_version FROM public.persons'],
  ['people','SELECT id,catalog_version FROM public.worlds'],
  ['people','SELECT id,account_id,person_id,world_version,person_version,from_world_id,to_world_id FROM public.person_world_movements'],
  ['media',"SELECT * FROM public.media_objects WHERE purpose='conversation_attachment'"],
  ['media','SELECT * FROM public.media_conversation_grants'],
  // Project the non-private receipt metadata. Even malformed receipts never
  // bring ordinary chat bodies into this validator.
  ['conversations',`SELECT account_id,operation,target,idempotency_key,request_hash,created_at,
    response->>'generationJobId' AS job_id,response->'message'->>'id' AS message_id,
    response->>'id' AS result_id,response->>'version' AS result_version,response->>'removedAt' AS removed_at,
    response->'message'->>'kind' AS result_kind,response->'message'->>'clientMessageId' AS result_client_id,
    response->'message'->'photo' AS result_photo
   FROM public.conversation_commands c WHERE operation IN ('photo.cancel','photo.retry')
    OR(operation='send' AND (response->'message'->>'kind'='photo' OR EXISTS(SELECT 1 FROM public.photo_reply_jobs j WHERE j.id::text=c.response->>'generationJobId') OR EXISTS(SELECT 1 FROM public.message_media r WHERE r.message_id::text=c.response->'message'->>'id')))
    OR(operation='remove' AND EXISTS(SELECT 1 FROM public.messages m WHERE m.photo_reply_job_id IS NOT NULL AND m.id::text=c.target))`],
  ['conversations',`SELECT account_id,aggregate_type,aggregate_id,aggregate_version,type,payload,occurred_at FROM public.outbox_events e
   WHERE aggregate_type='photo_reply_job' OR(type IN ('MessageAccepted.v1','MessageRemoved.v1') AND (payload->>'kind'='photo' OR payload->>'generationKind'='photo_reply' OR EXISTS(SELECT 1 FROM public.messages m WHERE m.photo_reply_job_id IS NOT NULL AND m.id=e.aggregate_id)))`]
 ]
 const [rooms,messages,refs,jobs,accounts,consents,persons,worlds,movements,photos,grants,commands,events]=await Promise.all(queries.map(([domain,sql])=>runtime.query(target(domain),sql)))
 const fail=()=>{throw new Error('Chat photo source, permission, receipt, reply or object differs')}
 const index=(rows,key)=>{const map=new Map();for(const row of rows){const k=key(row);if(map.has(k))fail();map.set(k,row)}return map}
 const byRoom=index(rooms,r=>r.id),byMessage=index(messages,r=>r.id),byRef=index(refs,r=>r.message_id),byJob=index(jobs,r=>r.id),byAccount=index(accounts,r=>r.id),byPerson=index(persons,r=>r.id),byWorld=index(worlds,r=>r.id)
 const byMedia=index(photos,r=>r.account_id+':'+r.id),byGrant=index(grants,r=>r.account_id+':'+r.media_id),byObject=index(objects,r=>r.key),byConsent=index(consents,r=>r.account_id+':'+r.purpose+':'+r.authorization_version)
 index(grants,r=>r.account_id+':'+r.conversation_id+':'+r.client_message_id)
 index(refs,r=>r.account_id+':'+r.conversation_id+':'+r.client_message_id)
 index(jobs,r=>r.source_message_id)
 index(commands,r=>r.account_id+':'+r.operation+':'+r.target+':'+r.idempotency_key)
 index(events,r=>r.type+':'+r.aggregate_id+':'+r.aggregate_version)
 const seq=value=>{if(!/^\d+$/.test(String(value)))fail();return BigInt(value)}
 const grant=(job,purpose,version)=>{
  const c=byConsent.get(job.account_id+':'+purpose+':'+version)
  if(!positive(version)||!c||c.decision!=='grant'||!Number.isFinite(stamp(c.recorded_at))||stamp(c.recorded_at)>stamp(job.created_at))fail()
  // The new photo purposes always bind an explicit privacy notice. Older
  // story consent may predate the notice-binding feature.
  if(purpose!=='private_story_storage'||c.notice_authorization_version!=null){
   const n=byConsent.get(job.account_id+':privacy_notice:'+c.notice_authorization_version)
   if(!positive(c.notice_authorization_version)||!n||n.decision!=='acknowledge'||!Number.isFinite(stamp(n.recorded_at))||stamp(n.recorded_at)>stamp(c.recorded_at))fail()
  }
 }
 const historicalWorld=(p,version)=>{
  if(!positive(version)||version>p.world_version)fail()
  const move=movements.find(m=>m.account_id===p.account_id&&m.person_id===p.id&&m.world_version===version)
  if(version>1){if(!move)fail();return move.to_world_id}
  return movements.find(m=>m.account_id===p.account_id&&m.person_id===p.id&&m.world_version===2)?.from_world_id??p.world_id
 }
 const matchingEvents=(type,id)=>events.filter(e=>e.type===type&&e.aggregate_id===id)
 const accepted=new Set(),removed=new Set(),replyIds=new Set(),sequenceKeys=new Set(),clientKeys=new Set()
 for(const command of commands){
  if(!uuid(command.idempotency_key)||!hex(command.request_hash)||!Number.isFinite(stamp(command.created_at)))fail()
  if(command.operation==='send'){
   const m=byMessage.get(command.message_id),j=byJob.get(command.job_id),r=m&&byRef.get(m.id)
   // Commands retain microsecond timestamps while messages round to millis.
   if(!m||!j||!r||m.kind!=='photo'||j.source_message_id!==m.id||command.account_id!==m.account_id||command.target!==m.conversation_id||command.request_hash!==m.request_hash||stamp(command.created_at)+1<stamp(m.created_at))fail()
   if(command.result_kind!=null&&(command.result_kind!=='photo'||command.result_client_id!==m.client_message_id||!exact(command.result_photo,['mediaId','version','mimeType','width','height','byteSize'])||command.result_photo.mediaId!==r.media_id||command.result_photo.version!==r.media_version||command.result_photo.mimeType!==r.mime_type||command.result_photo.width!==r.width||command.result_photo.height!==r.height||command.result_photo.byteSize!==r.byte_size))fail()
   accepted.add(m.id)
  }else if(command.operation==='remove'){
   const m=byMessage.get(command.target)
   if(!m||command.account_id!==m.account_id||command.result_id!==m.id||Number(command.result_version)!==2||command.request_hash!==hash({conversationId:m.conversation_id,version:1})||m.version!==2||stamp(command.removed_at)!==stamp(m.removed_at))fail()
   removed.add(m.id)
  }else{
   const j=byJob.get(command.target)
   if(!['photo.cancel','photo.retry'].includes(command.operation)||!j||command.account_id!==j.account_id||command.result_id!==j.id||command.request_hash!==hash({}))fail()
  }
 }
 for(const m of messages){
  const room=byRoom.get(m.conversation_id),j=byJob.get(m.photo_reply_job_id),n=seq(m.sequence),key=m.conversation_id+':'+n
  if(!room||room.kind!=='direct'||room.account_id!==m.account_id||!j||j.account_id!==m.account_id||j.conversation_id!==m.conversation_id||m.conversation_kind!=='direct'||m.generation_job_id!=null||m.gather_reply_job_id!=null||n<=0n||n>seq(room.last_sequence)||sequenceKeys.has(key)||m.version!==1+Number(m.removed_at!=null)||!Number.isFinite(stamp(m.created_at))||m.removed_at!=null&&(!Number.isFinite(stamp(m.removed_at))||stamp(m.removed_at)<stamp(m.created_at)))fail()
  sequenceKeys.add(key)
  const e=matchingEvents('MessageAccepted.v1',m.id)
  if(e.length!==1||e[0].account_id!==m.account_id||e[0].aggregate_type!=='message'||e[0].aggregate_version!==1||e[0].payload?.conversationId!==m.conversation_id||e[0].payload?.messageId!==m.id||e[0].payload?.kind!==m.kind)fail()
  if(m.kind==='photo'){
   const r=byRef.get(m.id),client=m.conversation_id+':'+m.client_message_id
   if(m.author_kind!=='self'||!uuid(m.client_message_id)||clientKeys.has(client)||m.reply_to_message_id!=null||m.speaker_person_id!=null||m.has_display_name||m.text_length!==0||!r||m.id!==j.source_message_id||!accepted.has(m.id)||m.request_hash!==hash({clientMessageId:m.client_message_id,kind:'photo',media:{id:r.media_id,version:r.media_version}})||stamp(e[0].payload.acceptedAt)!==stamp(m.created_at))fail()
   clientKeys.add(client)
  }else{
   const source=byMessage.get(j.source_message_id)
   if(m.kind!=='text'||m.author_kind!=='persona'||m.client_message_id!=null||m.request_hash!=null||!m.has_display_name||m.speaker_person_id!==j.person_id||m.reply_to_message_id!==j.source_message_id||!source||seq(source.sequence)>=n||j.reply_id!==m.id||j.state!=='succeeded'||!positive(m.text_length)||m.text_length>4000||e[0].payload.generationKind!=='photo_reply'||byRef.has(m.id))fail()
   replyIds.add(m.id)
  }
  const deletes=matchingEvents('MessageRemoved.v1',m.id)
  if(m.removed_at!=null){if(!removed.has(m.id)||deletes.length!==1||deletes[0].aggregate_type!=='message'||deletes[0].account_id!==m.account_id||deletes[0].aggregate_version!==2||deletes[0].payload?.conversationId!==m.conversation_id||deletes[0].payload?.messageId!==m.id||deletes[0].payload?.kind!==m.kind)fail()}
  else if(deletes.length||removed.has(m.id))fail()
 }
 const states=new Set(['queued','running','succeeded','failed','blocked','canceled'])
 for(const j of jobs){
  const room=byRoom.get(j.conversation_id),p=byPerson.get(j.person_id),a=byAccount.get(j.account_id),source=byMessage.get(j.source_message_id),r=byRef.get(j.source_message_id)
  if(!room||room.account_id!==j.account_id||room.person_id!==j.person_id||!p||p.account_id!==j.account_id||!['active','removed'].includes(p.status)||!a||!source||!r||source.kind!=='photo'||source.photo_reply_job_id!==j.id||j.conversation_kind!=='direct'||j.source_kind!=='photo'||j.source_author!=='self'||j.source_version!==1||j.media_id!==r.media_id||j.media_version!==r.media_version||!positive(j.account_access_version)||j.account_access_version>a.access_version||!positive(j.person_version)||j.person_version>p.version||!positive(j.person_access_version)||j.person_access_version>p.access_version||j.world_version>j.person_version||!states.has(j.state)||!positive(j.version)||!Number.isInteger(j.attempt_count)||j.attempt_count<0||j.attempt_count>3||(j.state==='running')!==(j.attempt_id!=null)||(j.state==='running')!==(j.lease_until!=null)||(j.state==='succeeded')!==(j.reply_id!=null)||j.state==='succeeded'&&!replyIds.has(j.reply_id)||j.retryable&&(j.state!=='failed'||j.attempt_count>=3)||!Number.isFinite(stamp(j.created_at))||!Number.isFinite(stamp(j.updated_at))||stamp(j.created_at)>stamp(j.updated_at)||stamp(j.created_at)<stamp(source.created_at))fail()
  const worldId=historicalWorld(p,j.world_version)
  if(!byWorld.has(worldId))fail()
  grant(j,'private_story_storage',j.story_authorization_version);grant(j,'private_chat_photo_storage',j.photo_authorization_version);grant(j,'person_chat_image_replies',j.image_authorization_version)
  if(j.person_context_ref!=null||j.world_context_ref!=null||j.state==='succeeded'){
   const ref=j.person_context_ref,w=j.world_context_ref
   if(!exact(ref,['id','version','accessVersion','worldId','worldVersion'])||ref.id!==p.id||ref.version!==j.person_version||ref.accessVersion!==j.person_access_version||ref.worldVersion!==j.world_version||ref.worldId!==worldId||!exact(w,['accountId','personId','personVersion','worldVersion','worldId','catalogVersion','reality','branch','movementIds','revision'])||w.accountId!==j.account_id||w.personId!==j.person_id||w.personVersion!==j.person_version||w.worldVersion!==j.world_version||w.worldId!==worldId||!positive(w.catalogVersion)||w.catalogVersion>byWorld.get(worldId).catalog_version||w.reality!=='virtual'||w.branch!=='main'||!hex(w.revision)||!Array.isArray(w.movementIds))fail()
   const moves=movements.filter(m=>m.account_id===j.account_id&&m.person_id===j.person_id&&m.world_version<=j.world_version).sort((a,b)=>b.world_version-a.world_version).slice(0,8)
   if(moves.length!==Math.min(8,j.world_version-1)||moves.length!==w.movementIds.length||moves.some((m,i)=>m.id!==w.movementIds[i]||m.world_version!==j.world_version-i||m.person_version>j.person_version||i>0&&moves[i-1].from_world_id!==m.to_world_id)||moves.length&&moves[0].to_world_id!==worldId)fail()
  }else if(j.provider_provenance!=null)fail()
  if(j.state==='succeeded'){
   const v=j.provider_provenance
   if(j.attempt_count<1||!exact(v,['provider','model','responseId','promptVersion'])||v.provider!=='openai'||typeof v.model!=='string'||!v.model||v.model.length>200||v.promptVersion!=='person-chat-image-replies-v1'||v.responseId!==null&&(typeof v.responseId!=='string'||v.responseId.length>300))fail()
   const e=matchingEvents('GenerationChanged.v1',j.id).filter(e=>e.payload?.state==='succeeded')
   if(e.length!==1||e[0].aggregate_version!==j.version||e[0].payload.replyId!==j.reply_id)fail()
  }else if(j.provider_provenance!=null)fail()
 }
 let activeReferenceCount=0
 for(const r of refs){
  const m=byMessage.get(r.message_id),j=m&&byJob.get(m.photo_reply_job_id),p=j&&byPerson.get(j.person_id)
  if(!m||!j||m.kind!=='photo'||r.account_id!==m.account_id||r.conversation_id!==m.conversation_id||r.client_message_id!==m.client_message_id||r.message_version!==1||r.source_kind!=='photo'||r.source_author!=='self'||!positive(r.media_version)||r.mime_type!=='image/webp'||!positive(r.byte_size)||r.byte_size>1048576||!positive(r.width)||r.width>8000||!positive(r.height)||r.height>8000)fail()
  // Source deletion or People removal may permit GC. A withdrawn grant alone
  // does not delete a saved source, so its archived canonical bytes are required.
  if(m.removed_at!=null||p.status==='removed')continue
  const media=byMedia.get(r.account_id+':'+r.media_id),g=byGrant.get(r.account_id+':'+r.media_id),o=media&&byObject.get(media.object_key)
  if(!media||media.status!=='ready'||media.version!==r.media_version||media.account_access_version!==j.account_access_version||media.storage_authorization_version!==j.story_authorization_version||media.photo_authorization_version!==j.photo_authorization_version||media.chat_conversation_id!==r.conversation_id||media.chat_client_message_id!==r.client_message_id||['mime_type','width','height','byte_size'].some(k=>media[k]!==r[k])||!g||g.state!=='active'||g.media_version!==r.media_version||g.conversation_id!==r.conversation_id||g.client_message_id!==r.client_message_id||!o||o.sha256!==media.sha256||o.byteSize!==media.byte_size||o.contentType!=='image/webp'||!hex(media.sha256)||!media.object_key.startsWith('ready/'+r.account_id+'/'+r.media_id+'/')||!uuid(media.object_key.split('/').at(-1)))fail()
  activeReferenceCount++
 }
 for(const m of photos){
  const room=byRoom.get(m.chat_conversation_id)
  if(!room||room.account_id!==m.account_id||m.purpose!=='conversation_attachment'||!uuid(m.chat_client_message_id)||m.client_post_id!=null||m.person_draft_id!=null||m.gift_delivery_id!=null||m.gift_storage_authorization_version!=null||!positive(m.storage_authorization_version)||!positive(m.photo_authorization_version))fail()
 }
 for(const g of grants){
  const m=byMedia.get(g.account_id+':'+g.media_id)
  if(!m||g.conversation_id!==m.chat_conversation_id||g.client_message_id!==m.chat_client_message_id||g.message_version!==1||!positive(g.media_version)||g.media_version>m.version||!['active','revoked'].includes(g.state)||(g.state==='revoked')!==(g.revoked_at!=null)||!Number.isFinite(stamp(g.created_at))||!Number.isFinite(stamp(g.last_bound_at))||stamp(g.created_at)>stamp(g.last_bound_at)||g.state==='active'&&(m.status!=='ready'||g.media_version!==m.version))fail()
 }
 for(const e of events){
  if(e.type==='GenerationChanged.v1'){
   const j=byJob.get(e.aggregate_id),v=e.payload
   if(!j||e.aggregate_type!=='photo_reply_job'||e.account_id!==j.account_id||!positive(e.aggregate_version)||e.aggregate_version>j.version||v?.jobId!==j.id||v?.kind!=='photo_reply'||v?.targetId!==j.conversation_id||!states.has(v?.state)||v.replyId!=null&&v.replyId!==j.reply_id)fail()
  }else if(!['MessageAccepted.v1','MessageRemoved.v1'].includes(e.type)||!byMessage.has(e.aggregate_id))fail()
 }
 return{applicable:true,messageCount:messages.length,referenceCount:refs.length,activeReferenceCount,jobCount:jobs.length,replyCount:replyIds.size,candidateCount:grants.filter(g=>!refs.some(r=>r.account_id===g.account_id&&r.media_id===g.media_id)).length,verified:true}
}
