// Read-only lineage checks. Text fingerprints and request-quote membership are
// computed inside PostgreSQL; no source, event or private-memory body is read.
import {createHash} from 'node:crypto'
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const positive=v=>Number.isSafeInteger(v)&&v>0
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v)
const stamp=v=>v instanceof Date?v.getTime():typeof v==='string'?Date.parse(v):NaN
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k))
const fields=['world_action_authorization_version','world_action_decision','world_event_context_refs','world_action_message_refs','world_event_revision','world_action_provenance']

export async function validateWorldActionReferences(runtime,targets){
 const target=domain=>targets.find(t=>t.domain===domain),conversations=target('conversations')
 if(!conversations)return{applicable:false,reason:'legacy_without_conversations'}
 const schema=await runtime.query(conversations,"SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND (table_name='person_world_events' AND column_name='id' OR table_name='messages' AND column_name='source_domain' OR table_name='conversations' AND column_name='world_event_revision' OR table_name='generation_jobs' AND column_name IN ('world_action_authorization_version','world_action_decision','world_event_context_refs','world_action_message_refs','world_event_revision','world_action_provenance'))")
 if(!schema.length)return{applicable:false,reason:'legacy_without_world_actions'}
 const wanted=['person_world_events:id','messages:source_domain','conversations:world_event_revision',...fields.map(f=>'generation_jobs:'+f)]
 if(schema.length!==wanted.length||wanted.some(key=>!schema.some(r=>r.table_name+':'+r.column_name===key)))throw new Error('World action schema is incomplete')
 if(['identity','people','memories'].some(d=>!target(d)))throw new Error('World actions require Identity, People and Memories authority databases')
 const queries=[
  ['conversations',"SELECT id,account_id,person_id,kind,last_sequence::text AS last_sequence,world_event_revision::text AS world_event_revision FROM public.conversations WHERE kind='direct'"],
  ['conversations',`SELECT id,account_id,conversation_id,conversation_kind,sequence::text AS sequence,kind,author_kind,client_message_id,reply_to_message_id,generation_job_id,photo_reply_job_id,gather_reply_job_id,speaker_person_id,display_name IS NOT NULL AS has_display_name,request_hash,version,created_at,removed_at,source_domain,char_length(text) AS text_length,
   CASE WHEN author_kind='self' THEN encode(sha256(convert_to('{"clientMessageId":'||to_json(client_message_id::text)::text||',"kind":"text","text":'||to_json(text)::text||',"inputMode":'||to_json(COALESCE(to_jsonb(messages)->>'input_mode','typed'))::text||'}','UTF8')),'hex') ELSE NULL END AS expected_request_hash
   FROM public.messages WHERE generation_job_id IS NOT NULL OR source_domain<>'private_text'`],
  ['conversations','SELECT id,account_id,conversation_id,person_id,source_message_id,kind,state,version,attempt_id,attempt_count,lease_until,retryable,reply_id,person_version,person_access_version,account_access_version,authorization_version,ai_authorization_version,memory_context_refs,world_context_ref,world_action_authorization_version,world_action_decision,world_event_context_refs,world_action_message_refs,world_event_revision::text AS world_event_revision,world_action_provenance,created_at,updated_at FROM public.generation_jobs'],
  ['conversations',`SELECT e.id,e.account_id,e.conversation_id,e.person_id,e.job_id,e.source_message_id,e.source_version,e.reply_id,e.world_id,e.world_version,e.sequence::text AS sequence,e.version,e.reality,e.branch,e.source_author,e.source_kind,to_jsonb(e)->>'life_run_id' AS life_run_id,e.created_at,e.removed_at,char_length(e.request_quote) AS quote_length,char_length(e.summary) AS summary_length,char_length(e.memory) AS memory_length,position(e.request_quote IN s.text)>0 AS request_quote_valid
   FROM public.person_world_events e LEFT JOIN public.messages s ON s.account_id=e.account_id AND s.id=e.source_message_id`],
  ['identity','SELECT id,access_version FROM public.accounts'],
   ['identity',`SELECT c.account_id,c.purpose,c.decision,c.authorization_version,c.notice_authorization_version,c.recorded_at,c.policy_id,c.policy_version,
    COALESCE((to_jsonb(p)->>'world_event_history_enabled')::boolean,false) AS world_event_history_enabled
    FROM public.consent_events c JOIN public.policy_versions p ON p.id=c.policy_id AND p.version=c.policy_version AND p.kind=c.purpose
    WHERE c.purpose IN ('privacy_notice','private_story_storage','ai_text_processing','person_world_actions')`],
  ['people','SELECT id,account_id,status,version,access_version,world_id,world_version FROM public.persons'],
  ['people','SELECT id,catalog_version FROM public.worlds'],
  ['people','SELECT id,account_id,person_id,world_version,person_version,from_world_id,to_world_id FROM public.person_world_movements'],
  ['memories','SELECT id,account_id,person_id,version,source_message_id FROM public.memories'],
  ['memories','SELECT id,account_id,person_id,version,source_kind,source_id,source_version,sources FROM public.automatic_memory_entries'],
  ['memories','SELECT account_id,person_id,source_kind,source_id FROM public.automatic_memory_sources'],
  ['memories','SELECT account_id,person_id,source_kind,source_id,context_refs FROM public.automatic_memory_jobs'],
  ['memories','SELECT account_id,person_id,source_message_id,context_refs FROM public.memory_generation_jobs'],
  ['memories','SELECT account_id,person_id,source_message_id,context_refs FROM public.memory_candidates'],
  ['conversations',`SELECT account_id,operation,target,idempotency_key,request_hash,created_at,response->>'generationJobId' AS job_id,response->'message'->>'id' AS message_id,response->'message'->>'clientMessageId' AS result_client_id,response->'message'->>'kind' AS result_kind,response->>'id' AS result_id,response->>'version' AS result_version,response->>'removedAt' AS removed_at
   FROM public.conversation_commands WHERE operation IN ('send','remove')`],
  ['conversations',"SELECT account_id,aggregate_type,aggregate_id,aggregate_version,type,payload,occurred_at FROM public.outbox_events WHERE type IN ('MessageAccepted.v1','MessageRemoved.v1','ReplyCommitted.v1','GenerationChanged.v1','WorldActionCommitted.v1')"]
 ]
 const [rooms,messages,jobs,episodes,accounts,consents,persons,worlds,movements,memories,automatic,autoSources,autoJobs,memoryJobs,candidates,commands,events]=await Promise.all(queries.map(([d,sql])=>runtime.query(target(d),sql)))
 const lifeRuns=episodes.some(e=>e.source_kind==='offline_life')?await runtime.query(conversations,"SELECT id,account_id,person_id,conversation_id,plan_version,plan_snapshot,state,decision,event_id,world_context_ref,memory_refs,event_refs,provider_provenance,created_at,updated_at FROM public.offline_life_runs"):[]
 const fail=()=>{throw new Error('World action source, permission, event, reply or derived lineage differs')}
 const index=(rows,key)=>{const out=new Map();for(const row of rows){const k=key(row);if(out.has(k))fail();out.set(k,row)}return out}
 const seq=v=>{if(!/^(0|[1-9][0-9]*)$/.test(String(v)))fail();return BigInt(v)}
 const byRoom=index(rooms,r=>r.id),byMessage=index(messages,r=>r.id),byJob=index(jobs,r=>r.id),byEvent=index(episodes,r=>r.id),eventByJob=index(episodes.filter(e=>e.source_kind!=='offline_life'),r=>r.job_id),byLife=index(lifeRuns,r=>r.id),byAccount=index(accounts,r=>r.id),byPerson=index(persons,r=>r.id),byWorld=index(worlds,r=>r.id),byMemory=index(memories,r=>r.id),byAutomatic=index(automatic,r=>r.id),byConsent=index(consents,r=>r.account_id+':'+r.purpose+':'+r.authorization_version)
 index(episodes,r=>r.conversation_id+':'+r.sequence);index(episodes.filter(e=>e.source_kind!=='offline_life'),r=>r.source_message_id);index(episodes.filter(e=>e.source_kind!=='offline_life'),r=>r.reply_id)
 const actionJobs=jobs.filter(j=>j.world_action_authorization_version!=null||j.world_action_decision!=null||j.world_event_context_refs?.length||j.world_action_message_refs?.length||j.world_event_revision!=null||j.world_action_provenance!=null),actionIds=new Set(actionJobs.map(j=>j.id))
 const related=messages.filter(m=>actionIds.has(m.generation_job_id)||m.source_domain!=='private_text'),relatedIds=new Set(related.map(m=>m.id))
 const occurrences=(type,id)=>events.filter(e=>e.type===type&&e.aggregate_id===id)
 const grant=(j,purpose,version)=>{
  const g=byConsent.get(j.account_id+':'+purpose+':'+version)
  if(!positive(version)||!g||g.decision!=='grant'||!Number.isFinite(stamp(g.recorded_at))||stamp(g.recorded_at)>stamp(j.created_at))fail()
   if(purpose==='person_world_actions'&&(!uuid(g.policy_id)||!positive(g.policy_version)||typeof g.world_event_history_enabled!=='boolean'))fail()
   if(purpose==='person_world_actions'||g.notice_authorization_version!=null){const n=byConsent.get(j.account_id+':privacy_notice:'+g.notice_authorization_version);if(!positive(g.notice_authorization_version)||!n||n.decision!=='acknowledge'||!Number.isFinite(stamp(n.recorded_at))||stamp(n.recorded_at)>stamp(g.recorded_at))fail()}
 }
 const historicalWorld=(p,v)=>{
  if(!positive(v)||v>p.world_version)fail()
  if(v===1){const first=movements.find(m=>m.account_id===p.account_id&&m.person_id===p.id&&m.world_version===2);if(p.world_version>1&&!first)fail();return first?.from_world_id??p.world_id}
  const move=movements.find(m=>m.account_id===p.account_id&&m.person_id===p.id&&m.world_version===v);if(!move)fail();return move.to_world_id
 }
  const eventReference=(r,j)=>{
  if(!exact(r,['id','version','personId','worldId','worldVersion','reality','branch'])||!uuid(r.id)||r.version!==1||r.reality!=='virtual'||r.branch!=='main')fail()
  const e=byEvent.get(r.id),w=j.world_context_ref,s=byMessage.get(j.source_message_id),origin=e&&byMessage.get(e.source_message_id)
   if(!e||e.account_id!==j.account_id||e.person_id!==j.person_id||e.conversation_id!==j.conversation_id||r.personId!==e.person_id||r.worldId!==e.world_id||r.worldVersion!==e.world_version||!w||!positive(e.world_version)||e.world_version>w.worldVersion||e.version!==r.version||(e.source_kind==='offline_life'?stamp(e.created_at)>=stamp(s.created_at):!origin||seq(origin.sequence)>=seq(s.sequence))||seq(e.sequence)>seq(j.world_event_revision))fail()
   // The event keeps its original execution scene. Only the exact policy used
   // by the consuming job may authorize recall from an earlier migration stage.
   // A return to the same world does not turn an old stage into the current one.
   const consent=byConsent.get(j.account_id+':person_world_actions:'+j.world_action_authorization_version)
   if(e.world_version===w.worldVersion?e.world_id!==w.worldId:consent?.world_event_history_enabled!==true)fail()
  return e
 }
 const memoryReference=(r,j)=>{
  if(!r||!['cherished','automatic'].includes(r.kind)||!uuid(r.id)||!positive(r.version))fail()
  const row=(r.kind==='cherished'?byMemory:byAutomatic).get(r.id)
  if(!row||row.account_id!==j.account_id||row.person_id!==j.person_id||row.version<r.version)fail()
  if(r.kind==='automatic'&&(r.sourceKind!==undefined&&r.sourceKind!==row.source_kind||r.sourceId!==undefined&&r.sourceId!==row.source_id||r.sourceVersion!==undefined&&r.sourceVersion!==row.source_version||r.sources!==undefined&&hash(r.sources)!==hash(row.sources)))fail()
  return r.kind+':'+r.id+':'+r.version
 }
 const accepted=new Set(),deleted=new Set()
 for(const command of commands){
  if(command.operation==='send'&&actionIds.has(command.job_id)){
   const j=byJob.get(command.job_id),m=byMessage.get(command.message_id)
   if(!m||j.source_message_id!==m.id||command.account_id!==j.account_id||command.target!==j.conversation_id||!uuid(command.idempotency_key)||command.request_hash!==m.request_hash||command.result_client_id!==m.client_message_id||command.result_kind!=='text'||!Number.isFinite(stamp(command.created_at))||stamp(command.created_at)+1<stamp(m.created_at))fail()
   accepted.add(j.id)
  }
  if(command.operation==='remove'&&relatedIds.has(command.target)){
   const m=byMessage.get(command.target)
   if(command.account_id!==m.account_id||!uuid(command.idempotency_key)||command.result_id!==m.id||command.result_version!==String(m.version)||!m.removed_at||stamp(command.removed_at)!==stamp(m.removed_at)||command.request_hash!==hash({conversationId:m.conversation_id,version:1}))fail()
   deleted.add(m.id)
  }
 }
 for(const m of related){
  const j=byJob.get(m.generation_job_id),room=byRoom.get(m.conversation_id)
  if(!j||!actionIds.has(j.id)||!room||room.kind!=='direct'||m.account_id!==j.account_id||j.conversation_id!==room.id||room.account_id!==m.account_id||m.kind!=='text'||m.conversation_kind!=='direct'||m.photo_reply_job_id!=null||m.gather_reply_job_id!=null||seq(m.sequence)<=0n||seq(m.sequence)>seq(room.last_sequence)||!Number.isFinite(stamp(m.created_at))||m.text_length<1||m.text_length>4000||m.version!==1+Number(m.removed_at!=null))fail()
  const domain=j.state!=='succeeded'?'world_action_pending':j.world_action_decision==='execute'?'virtual_action':j.world_action_decision==='clarify'||j.world_event_context_refs.length?'virtual_context':'private_text'
  if(m.source_domain!==domain)fail()
  if(m.author_kind==='self'){
   if(m.id!==j.source_message_id||!uuid(m.client_message_id)||!hex(m.request_hash)||m.request_hash!==m.expected_request_hash||m.reply_to_message_id!=null||m.speaker_person_id!=null)fail()
   const found=occurrences('MessageAccepted.v1',m.id)
   if(found.length!==1||found[0].account_id!==m.account_id||found[0].aggregate_type!=='message'||found[0].aggregate_version!==1||found[0].payload?.conversationId!==m.conversation_id||found[0].payload?.messageId!==m.id||stamp(found[0].payload?.acceptedAt)!==stamp(m.created_at))fail()
  }else if(m.author_kind==='persona'){
   const s=byMessage.get(j.source_message_id),found=occurrences('ReplyCommitted.v1',m.id)
   if(j.state!=='succeeded'||j.reply_id!==m.id||m.reply_to_message_id!==s?.id||m.speaker_person_id!==j.person_id||m.client_message_id!=null||m.request_hash!=null||m.has_display_name!==true||seq(m.sequence)<=seq(s.sequence)||stamp(m.created_at)<stamp(s.created_at)||found.length!==1||found[0].account_id!==m.account_id||found[0].aggregate_type!=='message'||found[0].aggregate_version!==1||found[0].payload?.conversationId!==m.conversation_id||found[0].payload?.messageId!==m.id||found[0].payload?.replyToMessageId!==s.id||found[0].payload?.jobId!==j.id||stamp(found[0].payload?.committedAt)!==stamp(m.created_at))fail()
  }else fail()
  if(m.removed_at){const found=occurrences('MessageRemoved.v1',m.id);if(!deleted.has(m.id)||stamp(m.removed_at)<stamp(m.created_at)||found.length!==1||found[0].account_id!==m.account_id||found[0].aggregate_type!=='message'||found[0].aggregate_version!==m.version||found[0].payload?.conversationId!==m.conversation_id||found[0].payload?.messageId!==m.id||stamp(found[0].payload?.removedAt)!==stamp(m.removed_at))fail()}
 }
 for(const j of actionJobs){
  const room=byRoom.get(j.conversation_id),s=byMessage.get(j.source_message_id),p=byPerson.get(j.person_id),a=byAccount.get(j.account_id)
  if(!room||!s||!p||!a||room.account_id!==j.account_id||room.person_id!==j.person_id||p.account_id!==j.account_id||s.generation_job_id!==j.id||s.author_kind!=='self'||!accepted.has(j.id)||j.kind!=='chat_reply'||!['queued','running','succeeded','failed','blocked','canceled'].includes(j.state)||!positive(j.version)||!positive(j.person_version)||j.person_version>p.version||!positive(j.person_access_version)||j.person_access_version>p.access_version||!positive(j.account_access_version)||j.account_access_version>a.access_version||!Number.isInteger(j.attempt_count)||j.attempt_count<0||j.attempt_count>3||(j.state==='running')!==(j.lease_until!=null)||j.state==='running'&&!uuid(j.attempt_id)||(j.state==='succeeded')!==(j.reply_id!=null)||j.retryable&&(j.state!=='failed'||j.attempt_count>=3)||!Number.isFinite(stamp(j.created_at))||stamp(j.updated_at)<stamp(j.created_at))fail()
  grant(j,'private_story_storage',j.authorization_version);grant(j,'ai_text_processing',j.ai_authorization_version);grant(j,'person_world_actions',j.world_action_authorization_version)
  if(!Array.isArray(j.world_event_context_refs)||j.world_event_context_refs.length>32||!Array.isArray(j.world_action_message_refs)||j.world_action_message_refs.length>20||!Array.isArray(j.memory_context_refs)||j.memory_context_refs.length>64)fail()
  if(byConsent.get(j.account_id+':person_world_actions:'+j.world_action_authorization_version).world_event_history_enabled&&j.memory_context_refs.some(r=>r?.kind==='automatic'&&r.sourceKind!=='message'))fail()
  if(j.state!=='succeeded'){
   if(j.world_action_decision!=='pending'||j.world_event_context_refs.length||j.world_action_message_refs.length||j.world_event_revision!=null||j.world_action_provenance!=null||eventByJob.has(j.id))fail()
   continue
  }
  const r=byMessage.get(j.reply_id),w=j.world_context_ref,provenance=j.world_action_provenance
  if(!r||r.generation_job_id!==j.id||!['chat','clarify','execute'].includes(j.world_action_decision)||!w||w.accountId!==j.account_id||w.personId!==j.person_id||w.personVersion!==j.person_version||historicalWorld(p,w.worldVersion)!==w.worldId||w.worldVersion>j.person_version||!positive(w.catalogVersion)||w.catalogVersion>byWorld.get(w.worldId)?.catalog_version||w.reality!=='virtual'||w.branch!=='main'||!hex(w.revision)||!Array.isArray(w.movementIds)||!(exact(provenance,['model','responseId','promptVersion'])||exact(provenance,['model','responseId','promptVersion','promptRevision'])&&['recipient-v2','history-v3'].includes(provenance.promptRevision))||typeof provenance.model!=='string'||!provenance.model.trim()||provenance.model.length>200||typeof provenance.responseId!=='string'||!provenance.responseId.trim()||provenance.promptVersion!=='person-world-actions-v1'||seq(j.world_event_revision)>seq(room.world_event_revision))fail()
  const moves=movements.filter(m=>m.account_id===j.account_id&&m.person_id===j.person_id&&m.world_version<=w.worldVersion).sort((a,b)=>b.world_version-a.world_version).slice(0,8)
  if(moves.length!==Math.min(8,w.worldVersion-1)||moves.length!==w.movementIds.length||moves.some((m,i)=>m.id!==w.movementIds[i]||m.world_version!==w.worldVersion-i||m.person_version>j.person_version||i>0&&moves[i-1].from_world_id!==m.to_world_id)||moves.length&&moves[0].to_world_id!==w.worldId)fail()
  const refs=index(j.world_event_context_refs,r=>r.id),messageRefs=index(j.world_action_message_refs,r=>r.id),memoryRefs=new Set(j.memory_context_refs.map(r=>memoryReference(r,j)))
  if(memoryRefs.size!==j.memory_context_refs.length||messageRefs.get(s.id)?.version!==1)fail()
  for(const mr of messageRefs.values()){
   const m=byMessage.get(mr.id),parent=m&&byJob.get(m.generation_job_id)
   if(!exact(mr,['id','version'])||!m||mr.version!==1||m.version<mr.version||m.account_id!==j.account_id||m.conversation_id!==j.conversation_id||m.kind!=='text'||m.photo_reply_job_id!=null||seq(m.sequence)>seq(s.sequence)||m.removed_at!=null&&stamp(m.removed_at)<stamp(r.created_at))fail()
   if(m.id!==s.id&&parent&&actionIds.has(parent.id))for(const er of [...parent.world_event_context_refs,...(eventByJob.has(parent.id)?[eventByJob.get(parent.id)]:[])])if(!refs.has(er.id))fail()
  }
  for(const er of refs.values()){
   const e=eventReference(er,j),life=e.source_kind==='offline_life'?byLife.get(e.life_run_id):null,parent=life?{...life,memory_context_refs:life.memory_refs,world_event_context_refs:life.event_refs.map(({kind,...ref})=>ref)}:byJob.get(e.job_id)
   if(e.removed_at!=null&&stamp(e.removed_at)<stamp(r.created_at))fail()
   for(const ancestor of parent.world_event_context_refs)if(!refs.has(ancestor.id)||hash(refs.get(ancestor.id))!==hash(ancestor))fail()
   for(const memory of parent.memory_context_refs)if(!memoryRefs.has(memoryReference(memory,parent)))fail()
  }
  const changed=occurrences('GenerationChanged.v1',j.id).filter(e=>e.payload?.state==='succeeded')
  if(changed.length!==1||changed[0].account_id!==j.account_id||changed[0].aggregate_type!=='generation_job'||changed[0].aggregate_version!==j.version||changed[0].payload?.jobId!==j.id||changed[0].payload?.kind!=='chat_reply'||changed[0].payload?.targetId!==j.conversation_id||(j.world_action_decision==='execute')!==eventByJob.has(j.id))fail()
 }
 for(const e of episodes){
  if(e.source_kind==='offline_life'){
   const run=byLife.get(e.life_run_id),room=byRoom.get(e.conversation_id),w=run?.world_context_ref,p=byPerson.get(e.person_id)
   if(!run||!room||!p||e.account_id!==run.account_id||e.person_id!==run.person_id||e.conversation_id!==run.conversation_id||room.account_id!==e.account_id||room.person_id!==e.person_id||p.account_id!==e.account_id||run.state!=='succeeded'||run.decision!=='event'||run.event_id!==e.id||e.job_id!=null||e.source_message_id!=null||e.reply_id!=null||e.source_author!=null||e.source_version!==1||e.version!==1||e.reality!=='virtual'||e.branch!=='main'||!w||e.world_id!==w.worldId||e.world_version!==w.worldVersion||historicalWorld(p,e.world_version)!==e.world_id||seq(e.sequence)>seq(room.world_event_revision)||e.summary_length<1||e.summary_length>600||e.memory_length<1||e.memory_length>600||stamp(e.created_at)<stamp(run.created_at)||e.removed_at!=null&&stamp(e.removed_at)<stamp(e.created_at))fail()
   for(const ref of run.event_refs){const ancestor=byEvent.get(ref.id);if(!ancestor||ancestor.account_id!==e.account_id||ancestor.person_id!==e.person_id||seq(ancestor.sequence)>=seq(e.sequence)||ancestor.removed_at!=null&&e.removed_at==null)fail()}
   continue
  }
  const j=byJob.get(e.job_id),s=byMessage.get(e.source_message_id),r=byMessage.get(e.reply_id),room=byRoom.get(e.conversation_id),w=j?.world_context_ref
  if(!j||!actionIds.has(j.id)||j.state!=='succeeded'||j.world_action_decision!=='execute'||!s||!r||!room||e.account_id!==j.account_id||e.person_id!==j.person_id||e.conversation_id!==j.conversation_id||e.source_message_id!==j.source_message_id||e.reply_id!==j.reply_id||e.source_version!==1||e.version!==1||e.reality!=='virtual'||e.branch!=='main'||e.source_author!=='self'||e.source_kind!=='text'||e.world_id!==w.worldId||e.world_version!==w.worldVersion||seq(e.sequence)!==seq(j.world_event_revision)+1n||seq(e.sequence)>seq(room.world_event_revision)||e.quote_length<1||e.quote_length>4000||e.summary_length<1||e.summary_length>600||e.memory_length<1||e.memory_length>600||e.request_quote_valid!==true||!Number.isFinite(stamp(e.created_at))||stamp(e.created_at)<stamp(r.created_at)||e.removed_at!=null&&stamp(e.removed_at)<stamp(e.created_at))fail()
  const invalid=s.removed_at!=null||r.removed_at!=null||j.world_action_message_refs.some(m=>byMessage.get(m.id)?.removed_at!=null)||j.world_event_context_refs.some(a=>byEvent.get(a.id)?.removed_at!=null)
  if(invalid!==(e.removed_at!=null))fail()
  const committed=occurrences('WorldActionCommitted.v1',e.id)
  if(committed.length!==1||committed[0].account_id!==e.account_id||committed[0].aggregate_type!=='person_world_event'||committed[0].aggregate_version!==1||committed[0].payload?.conversationId!==e.conversation_id||committed[0].payload?.personId!==e.person_id||committed[0].payload?.eventId!==e.id||committed[0].payload?.sourceMessageId!==s.id||committed[0].payload?.replyId!==r.id)fail()
 }
 // Current private-text eligibility is separate from historical retention.
 // No action/clarification/derived virtual text may seed the old memory tables.
 const forbidden=id=>{const m=byMessage.get(id),j=m&&byJob.get(m.generation_job_id);return m&&actionIds.has(j?.id)&&!(m.source_domain==='private_text'&&j.state==='succeeded'&&j.world_action_decision==='chat'&&j.world_event_context_refs.length===0)}
 for(const row of [...autoSources,...automatic,...autoJobs])if(row.source_kind==='message'&&forbidden(row.source_id)||(row.sources??row.context_refs??[]).some(r=>forbidden(r.id)))fail()
 for(const row of [...memories,...memoryJobs,...candidates])if(forbidden(row.source_message_id)||(row.context_refs??[]).some(r=>forbidden(r.id)))fail()
 if(events.some(e=>e.type==='WorldActionCommitted.v1'&&!byEvent.has(e.aggregate_id)))fail()
 return{applicable:true,jobCount:actionJobs.length,eventCount:episodes.length,removedEventCount:episodes.filter(e=>e.removed_at!=null).length,replyCount:actionJobs.filter(j=>j.state==='succeeded').length,verified:true}
}
