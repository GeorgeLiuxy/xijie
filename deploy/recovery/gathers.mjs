// Cross-domain checks use separate read-only queries. No private memory bodies
// are loaded, and reports contain counts rather than account or source data.
import {createHash} from 'node:crypto'
const tables=['gather_reply_jobs','gather_reply_participants','gather_reply_slots']
const digest=value=>createHash('sha256').update(value).digest('hex')
export async function validateGatherReferences(runtime,targets){
 const target=domain=>targets.find(t=>t.domain===domain),conversations=target('conversations')
 if(!conversations)return{applicable:false,reason:'legacy_without_conversations'}
 const schema=await runtime.query(conversations,"SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('gather_reply_jobs','gather_reply_participants','gather_reply_slots')")
 if(!schema.length)return{applicable:false,reason:'legacy_without_gathers'}
 if(schema.length!==3||tables.some(t=>!schema.some(r=>r.table_name===t)))throw new Error('Gather schema is incomplete')
 if(['identity','people','memories'].some(d=>!target(d)))throw new Error('Gathers require Identity, People and Memories authority databases')
 const queries=[
  ['conversations',"SELECT * FROM public.conversations WHERE kind='gather'"],
  ['conversations',"SELECT *,sequence::text AS sequence FROM public.messages WHERE conversation_kind='gather'"],
  ...tables.map(t=>['conversations','SELECT * FROM public.'+t]),
  ['identity','SELECT id,access_version FROM public.accounts'],
  ['identity',"SELECT account_id,purpose,decision,authorization_version,notice_authorization_version,recorded_at FROM public.consent_events WHERE purpose IN ('privacy_notice','private_story_storage','person_gather_replies','ai_text_processing')"],
  ['people','SELECT id,account_id,version,access_version,world_id,world_version FROM public.persons'],
  ['people','SELECT id,catalog_version FROM public.worlds'],
  ['people','SELECT id,account_id,person_id,world_version,person_version,from_world_id,to_world_id FROM public.person_world_movements'],
  ['memories','SELECT id,account_id,person_id,version FROM public.memories'],
  ['memories','SELECT id,account_id,person_id,version,source_kind,source_id,source_version,sources FROM public.automatic_memory_entries'],
  ['conversations',"SELECT account_id,target,operation,request_hash,response FROM public.conversation_commands WHERE operation='gather.send'"],
  ['conversations',"SELECT account_id,aggregate_type,aggregate_id,aggregate_version,type,payload FROM public.outbox_events WHERE type IN ('GatherAccepted.v1','GatherReplyCommitted.v1')"]
 ]
 const [rooms,messages,jobs,participants,slots,accounts,consents,persons,worlds,movements,memories,automatic,commands,events]=await Promise.all(queries.map(([d,sql])=>runtime.query(target(d),sql)))
 const fail=()=>{throw new Error('Gather source, participant, reply or provenance differs')}
 const positive=v=>Number.isSafeInteger(v)&&v>0,hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
 const stamp=v=>typeof v==='string'||v instanceof Date?Date.parse(v):NaN
 const seq=v=>{if(!/^\d+$/.test(String(v)))fail();return BigInt(v)}
 const index=(rows,key)=>{const result=new Map();for(const row of rows){const k=key(row);if(result.has(k))fail();result.set(k,row)}return result}
 const byRoom=index(rooms,r=>r.id),byMessage=index(messages,r=>r.id),byJob=index(jobs,r=>r.id),byPerson=index(persons,r=>r.id),byWorld=index(worlds,r=>r.id),byAccount=index(accounts,r=>r.id)
 const bySlot=index(slots,r=>r.job_id+':'+r.person_id),byParticipant=index(participants,r=>r.job_id+':'+r.person_id),byMemory=index(memories,r=>r.id),byAutomatic=index(automatic,r=>r.id)
 const byConsent=index(consents,r=>r.account_id+':'+r.purpose+':'+r.authorization_version)
 const grant=(job,purpose,version)=>{
  const c=byConsent.get(job.account_id+':'+purpose+':'+version)
  if(!positive(version)||!c||c.decision!=='grant'||!Number.isFinite(stamp(c.recorded_at))||stamp(c.recorded_at)>stamp(job.created_at))fail()
  if(purpose==='person_gather_replies'||c.notice_authorization_version!=null){
   const notice=byConsent.get(job.account_id+':privacy_notice:'+c.notice_authorization_version)
   if(!positive(c.notice_authorization_version)||!notice||notice.decision!=='acknowledge'||stamp(notice.recorded_at)>stamp(c.recorded_at))fail()
  }
 }
 const historicalWorld=(person,version)=>{
  if(!positive(version)||version>person.world_version)fail()
  const current=movements.find(m=>m.account_id===person.account_id&&m.person_id===person.id&&m.world_version===version)
  if(version>1){if(!current)fail();return current.to_world_id}
  const first=movements.find(m=>m.account_id===person.account_id&&m.person_id===person.id&&m.world_version===2)
  return first?first.from_world_id:person.world_id
 }
 const commanded=new Set()
 for(const command of commands){
   const result=command.response
   if(!result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).some(k=>!['id','jobId'].includes(k)))fail()
  const m=byMessage.get(result.id),j=byJob.get(result.jobId)
  if(!m||!j||j.source_message_id!==m.id||command.account_id!==m.account_id||command.target!==m.conversation_id||command.request_hash!==m.request_hash)fail()
  commanded.add(j.id)
 }
 const states=new Set(['queued','running','succeeded','failed','blocked','canceled']),sequences=new Set(),clients=new Set(),highest=new Map(),replySlots=new Set()
 for(const room of rooms)if(!byAccount.has(room.account_id)||!byWorld.has(room.world_id)||room.kind!=='gather'||room.person_id!=null)fail()
 for(const m of messages){
  const room=byRoom.get(m.conversation_id),j=byJob.get(m.gather_reply_job_id),n=seq(m.sequence),key=m.conversation_id+':'+n
  if(!room||!j||m.account_id!==room.account_id||j.account_id!==m.account_id||j.conversation_id!==m.conversation_id||m.conversation_kind!=='gather'||m.kind!=='text'||m.generation_job_id!=null||n<=0n||sequences.has(key)||!positive(m.version)||!Number.isFinite(stamp(m.created_at))||typeof m.text!=='string'||!m.text.trim()||[...m.text].length>4000)fail()
  if(m.version!==1+Number(m.removed_at!=null)||m.removed_at!=null&&stamp(m.removed_at)<stamp(m.created_at))fail()
  sequences.add(key);highest.set(room.id,(highest.get(room.id)??0n)>n?highest.get(room.id):n)
  if(m.author_kind==='self'){
   const client=room.id+':'+m.client_message_id
   if(m.id!==j.source_message_id||!m.client_message_id||clients.has(client)||m.reply_to_message_id!=null||m.speaker_person_id!=null||!hex(m.request_hash))fail()
   clients.add(client)
   if(!['typed','transcribed'].includes(m.input_mode??'typed')||digest(JSON.stringify({clientMessageId:m.client_message_id,kind:'text',text:m.text,inputMode:m.input_mode??'typed'}))!==m.request_hash)fail()
  }else if(m.author_kind==='persona'){
   const key=j.id+':'+m.speaker_person_id,s=bySlot.get(key),origin=byMessage.get(j.source_message_id)
   if(!s||s.state!=='succeeded'||s.reply_id!==m.id||replySlots.has(key)||m.reply_to_message_id!==j.source_message_id||m.client_message_id!=null||m.request_hash!=null||typeof m.display_name!=='string'||!m.display_name||!origin||n<=seq(origin.sequence)||stamp(m.created_at)<stamp(origin.created_at))fail()
   replySlots.add(key)
   const committed=events.filter(e=>e.type==='GatherReplyCommitted.v1'&&e.aggregate_id===m.id)
   if(committed.length!==1||committed[0].account_id!==m.account_id||committed[0].aggregate_type!=='message'||committed[0].aggregate_version!==1||committed[0].payload?.conversationId!==room.id||committed[0].payload?.messageId!==m.id||committed[0].payload?.jobId!==j.id||committed[0].payload?.personId!==m.speaker_person_id||committed[0].payload?.sourceMessageId!==j.source_message_id)fail()
  }else fail()
 }
 for(const room of rooms)if(seq(room.last_sequence)!==(highest.get(room.id)??0n))fail()
 for(const job of jobs){
  const room=byRoom.get(job.conversation_id),source=byMessage.get(job.source_message_id),roster=participants.filter(p=>p.job_id===job.id).sort((a,b)=>a.position-b.position),ownSlots=slots.filter(s=>s.job_id===job.id)
  if(!room||!source||source.author_kind!=='self'||source.gather_reply_job_id!==job.id||job.account_id!==room.account_id||job.world_id!==room.world_id||job.conversation_kind!=='gather'||job.source_version!==1||!hex(job.roster_revision)||!Number.isInteger(job.eligible_count)||job.eligible_count<2||job.eligible_count>1000||roster.length!==Math.min(job.eligible_count,3)||ownSlots.length!==roster.length||!states.has(job.state)||!positive(job.version)||!positive(job.account_access_version)||job.account_access_version>byAccount.get(job.account_id).access_version||!commanded.has(job.id))fail()
  grant(job,'private_story_storage',job.story_authorization_version);grant(job,'person_gather_replies',job.gather_authorization_version)
  if(job.memory_ai_authorization_version!=null)grant(job,'ai_text_processing',job.memory_ai_authorization_version)
  const sorted=[...roster].sort((a,b)=>digest(source.client_message_id+':'+a.person_id).localeCompare(digest(source.client_message_id+':'+b.person_id))||a.person_id.localeCompare(b.person_id))
  for(const [i,p]of roster.entries())if(p.position!==i+1||sorted[i].person_id!==p.person_id)fail()
  const state=ownSlots.some(s=>s.state==='running')?'running':ownSlots.some(s=>s.state==='queued'||s.state==='failed'&&s.retryable)?'queued':ownSlots.every(s=>s.state==='succeeded')?'succeeded':ownSlots.some(s=>s.state==='failed')?'failed':ownSlots.some(s=>s.state==='blocked')?'blocked':'canceled'
  if(state!==job.state||source.removed_at!=null&&ownSlots.some(s=>s.state==='queued'||s.state==='running'))fail()
  const accepted=events.filter(e=>e.type==='GatherAccepted.v1'&&e.aggregate_id===job.id)
  if(accepted.length!==1||accepted[0].account_id!==job.account_id||accepted[0].aggregate_version!==1||accepted[0].payload?.jobId!==job.id||accepted[0].payload?.kind!=='gather_reply'||accepted[0].payload?.targetId!==room.id||accepted[0].payload?.messageId!==source.id||accepted[0].payload?.clientMessageId!==source.client_message_id)fail()
 }
 for(const p of participants){
  const job=byJob.get(p.job_id),person=byPerson.get(p.person_id)
  if(!job||!person||p.account_id!==job.account_id||person.account_id!==p.account_id||!positive(p.person_version)||p.person_version>person.version||p.world_version>p.person_version||!positive(p.person_access_version)||p.person_access_version>person.access_version||historicalWorld(person,p.world_version)!==job.world_id||!bySlot.has(p.job_id+':'+p.person_id))fail()
  if(p.world_version>1&&movements.find(m=>m.account_id===p.account_id&&m.person_id===p.person_id&&m.world_version===p.world_version)?.person_version>p.person_version)fail()
 }
 for(const s of slots){
  const j=byJob.get(s.job_id),p=byParticipant.get(s.job_id+':'+s.person_id),person=byPerson.get(s.person_id)
  if(!j||!p||s.account_id!==j.account_id||s.conversation_id!==j.conversation_id||!states.has(s.state)||!positive(s.version)||!Number.isInteger(s.attempt_count)||s.attempt_count<0||s.attempt_count>3||(s.state==='running')!==(s.attempt_id!=null)||(s.state==='running')!==(s.lease_until!=null)||(s.state==='succeeded')!==(s.reply_id!=null)||s.state==='succeeded'&&!replySlots.has(s.job_id+':'+s.person_id)||s.retryable&&(s.state!=='failed'||s.attempt_count>=3)||!Array.isArray(s.context_message_refs)||!Array.isArray(s.memory_context_refs)||s.context_message_refs.length>1000||s.memory_context_refs.length>64)fail()
  if(s.person_context_ref!=null||s.world_context_ref!=null||s.state==='succeeded'){
   const r=s.person_context_ref,w=s.world_context_ref
   if(!r||Object.keys(r).some(k=>!['id','version','accessVersion','worldId','worldVersion'].includes(k))||r.id!==s.person_id||!positive(r.version)||r.version<p.person_version||r.version>person.version||r.accessVersion!==p.person_access_version||r.worldVersion!==p.world_version||r.worldId!==j.world_id||!w||w.accountId!==s.account_id||w.personId!==s.person_id||w.personVersion!==r.version||w.worldVersion!==r.worldVersion||w.worldId!==r.worldId||!positive(w.catalogVersion)||w.catalogVersion>byWorld.get(w.worldId)?.catalog_version||w.reality!=='virtual'||w.branch!=='main'||!hex(w.revision)||!Array.isArray(w.movementIds))fail()
   const moves=movements.filter(m=>m.account_id===s.account_id&&m.person_id===s.person_id&&m.world_version<=w.worldVersion).sort((a,b)=>b.world_version-a.world_version).slice(0,8)
   if(moves.length!==Math.min(8,w.worldVersion-1)||moves.length!==w.movementIds.length||moves.some((m,i)=>m.id!==w.movementIds[i]||m.world_version!==w.worldVersion-i||m.person_version>r.version||i>0&&moves[i-1].from_world_id!==m.to_world_id)||moves.length&&moves[0].to_world_id!==w.worldId)fail()
   const refs=index(s.context_message_refs,r=>r.id),source=byMessage.get(j.source_message_id)
   if(refs.get(source.id)?.version!==1)fail()
   // Context refs include transitive dependencies of visible shared replies.
   // Those dependencies are checked as metadata, never imported as private text.
   const inheritedMessages=new Set(),inheritedMemories=new Set(),memoryRefs=index(s.memory_context_refs,r=>r.personId+':'+r.kind+':'+r.id)
   for(const ref of refs.values()){
    const m=byMessage.get(ref.id)
    if(!m||m.account_id!==s.account_id||m.conversation_id!==s.conversation_id||!positive(ref.version)||ref.version!==1||ref.version>m.version||seq(m.sequence)>seq(source.sequence))fail()
    if(m.author_kind==='persona'){
     const old=bySlot.get(m.gather_reply_job_id+':'+m.speaker_person_id)
     if(!old)fail()
     for(const r of old.context_message_refs){
      if(refs.get(r.id)?.version!==r.version)fail()
      inheritedMessages.add(r.id+':'+r.version)
     }
     if(old.memory_context_refs.length&&byJob.get(m.gather_reply_job_id)?.memory_ai_authorization_version!==j.memory_ai_authorization_version)fail()
     for(const r of old.memory_context_refs){
      const current=memoryRefs.get(r.personId+':'+r.kind+':'+r.id)
      if(!current||current.version!==r.version||current.sourceKind!==r.sourceKind||current.sourceId!==r.sourceId||current.sourceVersion!==r.sourceVersion||JSON.stringify(current.sources)!==JSON.stringify(r.sources))fail()
      inheritedMemories.add(r.personId+':'+r.kind+':'+r.id+':'+r.version)
     }
    }
   }
   for(const ref of refs.values()){
    const m=byMessage.get(ref.id)
    if(m.id!==source.id&&!byParticipant.has(m.gather_reply_job_id+':'+s.person_id)&&!inheritedMessages.has(ref.id+':'+ref.version))fail()
   }
   const seen=new Set()
   for(const ref of s.memory_context_refs){
    const key=ref.personId+':'+ref.kind+':'+ref.id+':'+ref.version,row=(ref.kind==='cherished'?byMemory:ref.kind==='automatic'?byAutomatic:new Map()).get(ref.id)
    if(j.memory_ai_authorization_version==null||!row||row.account_id!==s.account_id||row.person_id!==ref.personId||!positive(ref.version)||ref.version>row.version||seen.has(ref.personId+':'+ref.kind+':'+ref.id)||ref.personId!==s.person_id&&!inheritedMemories.has(key))fail()
    seen.add(ref.personId+':'+ref.kind+':'+ref.id)
    if(ref.kind==='automatic'&&(ref.sourceKind!==row.source_kind||ref.sourceId!==row.source_id||ref.sourceVersion!==row.source_version||JSON.stringify(ref.sources)!==JSON.stringify(row.sources)))fail()
   }
  }else if(s.context_message_refs.length||s.memory_context_refs.length||s.provider_provenance!=null)fail()
  if(s.state==='succeeded'){
   const v=s.provider_provenance
   if(s.attempt_count<1||!v||v.provider!=='openai'||typeof v.model!=='string'||!v.model||v.promptVersion!=='person-gather-replies-v1'||v.responseId!==null&&typeof v.responseId!=='string')fail()
  }
 }
 if(events.some(e=>e.type==='GatherAccepted.v1'?!byJob.has(e.aggregate_id):!byMessage.has(e.aggregate_id)||byMessage.get(e.aggregate_id).author_kind!=='persona'))fail()
 return{applicable:true,conversationCount:rooms.length,messageCount:messages.length,jobCount:jobs.length,participantCount:participants.length,slotCount:slots.length,replyCount:replySlots.size,verified:true}
}
