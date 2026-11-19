// Validate separate authority databases without changing their contents. Reports
// expose counts only; letter bodies and model inputs never leave this verifier.
import{createHash}from'node:crypto'
export async function validateLetterReferences(runtime,targets){
 const conversations=targets.find(t=>t.domain==='conversations')
 if(!conversations)return{applicable:false,reason:'legacy_without_conversations'}
 const tables=['letters','letter_reply_jobs','letter_replies','letter_read_cursors']
 const schema=await runtime.query(conversations,"SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('letters','letter_reply_jobs','letter_replies','letter_read_cursors')")
 if(!schema.length)return{applicable:false,reason:'legacy_without_letters'}
 if(schema.length!==tables.length||tables.some(name=>!schema.some(row=>row.table_name===name)))throw new Error('Letter schema is incomplete')
 const people=targets.find(t=>t.domain==='people'),identity=targets.find(t=>t.domain==='identity')
 if(!people||!identity)throw new Error('Letters require People and Identity authority databases')
 const [letters,jobs,replies,cursors,persons,accounts,movements,worlds,consents,events,commands]=await Promise.all([
  // Recompute with the source service's PostgreSQL timezone rules, not the
  // verifier host's clock or ICU database. Invalid/unknown zones yield no time.
  runtime.query(conversations,`SELECT l.*,CASE
   WHEN l.reply_mode='now' THEN l.created_at
   WHEN l.reply_mode='next_morning' AND EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=l.time_zone) THEN (
    WITH dates AS(SELECT ((l.created_at AT TIME ZONE l.time_zone)::date+n)::timestamp+interval '8 hours' AS local FROM generate_series(0,370)n),
    instants AS(SELECT local,local AT TIME ZONE l.time_zone AS at FROM dates)
    SELECT at FROM instants WHERE at>l.created_at AND at AT TIME ZONE l.time_zone=local ORDER BY at LIMIT 1
   ) ELSE NULL END AS expected_reply_at FROM public.letters l`),
  runtime.query(conversations,'SELECT * FROM public.letter_reply_jobs'),
  runtime.query(conversations,'SELECT id,account_id,person_id,letter_id,job_id,sequence::text AS sequence,body,created_at FROM public.letter_replies'),
  runtime.query(conversations,'SELECT account_id,person_id,last_sequence::text AS last_sequence,last_read_sequence::text AS last_read_sequence,last_read_reply_id,read_at FROM public.letter_read_cursors'),
  runtime.query(people,'SELECT id,account_id,world_id,world_version,version FROM public.persons'),runtime.query(identity,'SELECT id FROM public.accounts'),
  runtime.query(people,'SELECT id,account_id,person_id,world_version,person_version,from_world_id,to_world_id FROM public.person_world_movements'),
  runtime.query(people,'SELECT id,catalog_version FROM public.worlds'),
  runtime.query(identity,"SELECT account_id,purpose,decision,authorization_version,notice_authorization_version,recorded_at FROM public.consent_events WHERE purpose IN ('private_letter_storage','person_letter_replies','private_story_storage','privacy_notice')"),
  runtime.query(conversations,"SELECT account_id,aggregate_id,aggregate_version,type,payload FROM public.outbox_events WHERE type IN ('LetterAccepted.v1','LetterReplyCommitted.v1')"),
  runtime.query(conversations,"SELECT account_id,target,idempotency_key,request_hash,response FROM public.conversation_commands WHERE operation='letter.create'")])
 const fail=()=>{throw new Error('Letter source, reply, provenance or read position differs')}
 const positive=value=>Number.isSafeInteger(value)&&value>0
 const stamp=value=>typeof value==='string'||value instanceof Date?Date.parse(value):NaN
 const sameTime=(a,b)=>Number.isFinite(stamp(a))&&stamp(a)===stamp(b)
 const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&[...value].length<=max&&!value.includes('\0')&&!/\p{Surrogate}/u.test(value)
 const sequence=value=>{if(typeof value!=='string'||!/^\d+$/.test(value))fail();return BigInt(value)}
 const map=(rows,key)=>{const values=new Map();for(const row of rows){const id=key(row);if(values.has(id))fail();values.set(id,row)}return values}
 const byLetter=map(letters,r=>r.id),byJob=map(jobs,r=>r.id),byReply=map(replies,r=>r.id),byPerson=map(persons,r=>r.id),byAccount=map(accounts,r=>r.id)
 const byWorld=map(worlds,r=>r.id),byConsent=map(consents,r=>r.account_id+':'+r.purpose+':'+r.authorization_version)
 const commanded=new Set()
 for(const command of commands){const letter=byLetter.get(command.response);if(!letter||command.account_id!==letter.account_id||command.target!==letter.person_id||command.request_hash!==letter.request_hash)fail();commanded.add(letter.id)}
 const grant=(letter,purpose,version)=>{
  const value=byConsent.get(letter.account_id+':'+purpose+':'+version)
  if(!value||value.decision!=='grant'||!Number.isFinite(stamp(value.recorded_at))||stamp(value.recorded_at)>stamp(letter.created_at))fail()
  if(purpose!=='private_story_storage'||value.notice_authorization_version!=null){
   const notice=byConsent.get(letter.account_id+':privacy_notice:'+value.notice_authorization_version)
   if(!positive(value.notice_authorization_version)||!notice||notice.decision!=='acknowledge'||stamp(notice.recorded_at)>stamp(value.recorded_at))fail()
  }
 }
 const byCursor=map(cursors,r=>r.account_id+':'+r.person_id),byClient=new Set(),jobSources=new Set(),replySources=new Set(),replyJobs=new Set(),replySequences=new Set(),highest=new Map()
 for(const letter of letters){
  const key=letter.account_id+':'+letter.person_id+':'+letter.client_letter_id
  if(!byAccount.has(letter.account_id)||byPerson.get(letter.person_id)?.account_id!==letter.account_id||!commanded.has(letter.id)||byClient.has(key)||!text(letter.body,10000)||!positive(letter.version)||!positive(letter.account_access_version)||!positive(letter.storage_authorization_version)||!Number.isFinite(stamp(letter.created_at))||stamp(letter.updated_at)<stamp(letter.created_at)||letter.removed_at!=null&&stamp(letter.removed_at)<stamp(letter.created_at)||!/^[a-f0-9]{64}$/.test(letter.request_hash))fail()
  byClient.add(key)
  grant(letter,'private_letter_storage',letter.storage_authorization_version)
  const memoryId=letter.source_memory_id,memoryVersion=letter.source_memory_version
  const linked=memoryId!=null||memoryVersion!=null
  if(linked&&(typeof memoryId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(memoryId)||!positive(memoryVersion)||memoryVersion>2147483647))fail()
  const input={clientLetterId:letter.client_letter_id,body:letter.body,replyMode:letter.reply_mode,...(letter.time_zone?{timeZone:letter.time_zone}:{}),...(linked?{sourceMemory:{id:memoryId,version:memoryVersion}}:{})}
  if(createHash('sha256').update(JSON.stringify(input)).digest('hex')!==letter.request_hash)fail()
  const accepted=events.filter(e=>e.type==='LetterAccepted.v1'&&e.aggregate_id===letter.id)
  if(accepted.length!==1||accepted[0].account_id!==letter.account_id||accepted[0].aggregate_version!==1||accepted[0].payload?.letterId!==letter.id||accepted[0].payload?.personId!==letter.person_id)fail()
  if(letter.reply_mode==='none'){
   if([letter.reply_at,letter.reply_job_id,letter.time_zone,letter.story_authorization_version,letter.reply_authorization_version].some(v=>v!=null))fail()
  }else{
   if(!['now','next_morning'].includes(letter.reply_mode)||!positive(letter.story_authorization_version)||!positive(letter.reply_authorization_version)||!Number.isFinite(stamp(letter.reply_at)))fail()
   if(letter.reply_mode==='now'&&letter.time_zone!=null||letter.reply_mode==='next_morning'&&(typeof letter.time_zone!=='string'||!letter.time_zone))fail()
   if(letter.reply_mode==='now'&&!sameTime(letter.reply_at,letter.created_at)||letter.reply_mode==='next_morning'&&stamp(letter.reply_at)<=stamp(letter.created_at)||!sameTime(letter.reply_at,letter.expected_reply_at))fail()
   if(byJob.get(letter.reply_job_id)?.letter_id!==letter.id)fail()
   grant(letter,'private_story_storage',letter.story_authorization_version);grant(letter,'person_letter_replies',letter.reply_authorization_version)
  }
 }
 for(const job of jobs){
  const letter=byLetter.get(job.letter_id)
  if(!letter||jobSources.has(job.letter_id)||letter.reply_mode==='none'||letter.reply_job_id!==job.id||job.account_id!==letter.account_id||job.person_id!==letter.person_id||job.source_version!==1||!sameTime(job.scheduled_at,letter.reply_at)||stamp(job.next_attempt_at)<stamp(job.scheduled_at)||!['queued','running','succeeded','failed','blocked','canceled'].includes(job.state)||!Number.isInteger(job.attempt_count)||job.attempt_count<0||job.attempt_count>3||!positive(job.version))fail()
  jobSources.add(job.letter_id)
  if((job.state==='running')!==(job.lease_until!=null)||job.state==='running'&&job.attempt_id==null||job.state!=='running'&&job.attempt_id!=null||(job.state==='succeeded')!==(job.reply_id!=null))fail()
  if(letter.removed_at!=null&&['queued','running'].includes(job.state))fail()
  if(job.state==='succeeded'||job.person_context_ref!=null||job.world_context_ref!=null){
   const p=job.person_context_ref,w=job.world_context_ref,provenance=job.provider_provenance
   const currentPerson=byPerson.get(letter.person_id)
   if(!p||p.id!==letter.person_id||!positive(p.version)||!positive(p.accessVersion)||p.version>currentPerson.version||!w||w.accountId!==letter.account_id||w.personId!==letter.person_id||w.personVersion!==p.version||w.worldId!==p.worldId||w.worldVersion!==p.worldVersion||!positive(w.worldVersion)||w.worldVersion>p.version||w.worldVersion>currentPerson.world_version||!positive(w.catalogVersion)||!byWorld.has(w.worldId)||w.reality!=='virtual'||w.branch!=='main'||!Array.isArray(w.movementIds)||w.movementIds.length!==Math.min(8,w.worldVersion-1)||!/^[a-f0-9]{64}$/.test(w.revision))fail()
   const history=movements.filter(m=>m.account_id===letter.account_id&&m.person_id===letter.person_id&&m.world_version<=w.worldVersion).sort((a,b)=>b.world_version-a.world_version).slice(0,8)
   if(history.length!==w.movementIds.length||history.some((move,i)=>move.id!==w.movementIds[i]||move.world_version!==w.worldVersion-i||move.person_version>p.version||move.from_world_id===move.to_world_id||!byWorld.has(move.from_world_id)||!byWorld.has(move.to_world_id)||i>0&&history[i-1].from_world_id!==move.to_world_id)||history.length>0&&history[0].to_world_id!==w.worldId)fail()
   if(w.worldVersion===1){const first=movements.find(m=>m.account_id===letter.account_id&&m.person_id===letter.person_id&&m.world_version===2);if(first?first.from_world_id!==w.worldId:currentPerson.world_id!==w.worldId)fail()}
   if(job.state==='succeeded'&&(!provenance||provenance.provider!=='openai'||typeof provenance.model!=='string'||!provenance.model||provenance.promptVersion!=='person-letter-replies-v1'||provenance.responseId!==null&&typeof provenance.responseId!=='string'||byReply.get(job.reply_id)?.job_id!==job.id))fail()
  }
 }
 for(const reply of replies){
  const letter=byLetter.get(reply.letter_id),job=byJob.get(reply.job_id),seq=sequence(reply.sequence),owner=reply.account_id+':'+reply.person_id,key=owner+':'+reply.sequence
  if(!letter||!job||replySources.has(reply.letter_id)||replyJobs.has(reply.job_id)||replySequences.has(key)||job.state!=='succeeded'||job.reply_id!==reply.id||job.letter_id!==letter.id||letter.reply_job_id!==job.id||reply.account_id!==letter.account_id||reply.person_id!==letter.person_id||seq<=0n||!text(reply.body,4000)||!Number.isFinite(stamp(reply.created_at))||stamp(reply.created_at)<stamp(letter.reply_at))fail()
  replySources.add(reply.letter_id);replyJobs.add(reply.job_id);replySequences.add(key)
  highest.set(owner,(highest.get(owner)??0n)>seq?highest.get(owner):seq)
  const committed=events.filter(e=>e.type==='LetterReplyCommitted.v1'&&e.aggregate_id===letter.id)
  if(committed.length!==1||committed[0].account_id!==letter.account_id||committed[0].aggregate_version!==2||committed[0].payload?.letterId!==letter.id||committed[0].payload?.personId!==letter.person_id||committed[0].payload?.replyId!==reply.id||committed[0].payload?.jobId!==job.id||committed[0].payload?.sequence!==reply.sequence)fail()
 }
 for(const letter of letters)if(letter.version!==1+Number(replySources.has(letter.id))+Number(letter.removed_at!=null))fail()
 for(const event of events)if(!byLetter.has(event.aggregate_id)||event.type==='LetterReplyCommitted.v1'&&!replySources.has(event.aggregate_id))fail()
 for(const [owner,seq]of highest){const cursor=byCursor.get(owner);if(!cursor||sequence(cursor.last_sequence)!==seq)fail()}
 for(const [owner,cursor]of byCursor){
  const high=sequence(cursor.last_sequence),read=sequence(cursor.last_read_sequence)
  if(!byAccount.has(cursor.account_id)||byPerson.get(cursor.person_id)?.account_id!==cursor.account_id||high!==(highest.get(owner)??0n)||read>high)fail()
  if(read===0n){if(cursor.last_read_reply_id!=null||cursor.read_at!=null)fail()}
  else{const reply=byReply.get(cursor.last_read_reply_id);if(!reply||reply.account_id!==cursor.account_id||reply.person_id!==cursor.person_id||sequence(reply.sequence)!==read||!Number.isFinite(stamp(cursor.read_at))||stamp(cursor.read_at)<stamp(reply.created_at))fail()}
 }
 return{applicable:true,letterCount:letters.length,replyCount:replies.length,jobCount:jobs.length,readCursorCount:cursors.length,verified:true}
}
