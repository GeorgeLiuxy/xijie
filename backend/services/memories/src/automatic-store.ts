import {createHash,randomUUID} from 'node:crypto'
import type {Pool,PoolClient} from 'pg'
import {MemoryError,conflict,forbidden,notFound,unavailable,uuid} from './contracts.js'
import {validPurposeContext} from './dependencies.js'
import {evidenceScore,evidenceTerms,normalize} from './search.js'
import {AutomaticError,type AutoDependencies,type AutoEntry,type AutomaticCorrection,type AutomaticDispatch,type AutomaticFact,type AutomaticJob,type AutomaticOrigin,type AutomaticQueueSender,type AutomaticRef,type AutomaticSnapshot,type AutomaticSourceEvent,type AutomaticSourceKind} from './automatic-contracts.js'

type SourceRow={id:string;account_id:string;person_id:string;source_kind:AutomaticSourceKind;source_id:string;source_version:number;state:'active'|'removed'|'blocked';source_created_at:Date;source_sequence:string|null;version:number}
type EntryRow={id:string;account_id:string;person_id:string;source_record_id:string;generation_job_id:string;source_kind:AutomaticSourceKind;source_id:string;source_version:number;source_author:'self';reality:AutoEntry['reality'];source_created_at:Date;source_sequence:string|null;sources:AutomaticRef[];topic:string;body:string;evidence:string;time_description:string;person_access_version:number;account_access_version:number;authorization_version:number;ai_authorization_version:number;state:'active'|'superseded'|'withdrawn';version:number;corrected_topic:string|null;corrected_body:string|null;corrected_at:Date|null;last_control_key:string|null;last_control_hash:string|null}
type EntryCursor={at:string;id:string}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const changed=()=>new MemoryError(409,'SOURCE_CHANGED','The automatic memory source is no longer current.')
const denied=()=>new MemoryError(403,'AI_PERMISSION_REQUIRED','AI text processing is not permitted.')
const clean=(value:string,max:number,empty=false)=>typeof value==='string'&&[...value].length<=max&&(empty||value.trim().length>0)&&!value.includes('\0')&&!/\p{Surrogate}/u.test(value)
const uniqueRefs=(refs:AutomaticRef[])=>[...new Map(refs.map(ref=>[ref.id,ref])).values()]
const dto=(row:EntryRow):AutoEntry=>({
 id:row.id,version:row.version,body:row.corrected_body??row.body,topic:row.corrected_topic??row.topic,
 timeDescription:row.corrected_at?'':row.time_description,evidence:row.corrected_at?'':row.evidence,
 sourceKind:row.source_kind,sourceId:row.source_id,sourceVersion:row.source_version,sourceAuthor:row.source_author,reality:row.reality,
 sourceCreatedAt:row.source_created_at.toISOString(),...(row.source_sequence?{sourceSequence:row.source_sequence}:{}),sources:row.sources,
 ...(row.corrected_at?{userCorrectedAt:row.corrected_at.toISOString()}:{})
})
const managedDto=(row:EntryRow)=>({
 id:row.id,personId:row.person_id,version:row.version,body:row.corrected_body??row.body,topic:row.corrected_topic??row.topic,
 source:{kind:row.source_kind,excerpt:row.evidence,createdAt:row.source_created_at.toISOString()},userCorrected:!!row.corrected_at
})
const versionConflict=()=>new MemoryError(412,'VERSION_CONFLICT','This automatic memory changed. Reload and review it first.')
const profileBody=(person:AutomaticSnapshot['person'])=>[
 ['name',person.displayName],['relationship',person.relationship],['calledMe',person.calledMe],['realName',person.realName],['place',person.place],['birthMonthDay',person.birthMonthDay],['yearsText',person.yearsText],['story',person.story],
].filter(([,value])=>value).map(([name,value])=>name+': '+value).join('\n')
const snapshotHash=(value:AutomaticSnapshot)=>hash({source:{...value.source,body:hash(value.source.body)},personVersion:value.person.version,personAccessVersion:value.person.accessVersion,accountAccessVersion:value.account.accessVersion,storage:value.account.storyStorage,ai:value.account.aiTextProcessing})
const laterThan=(source:AutomaticSnapshot['source'],entry:AutoEntry)=>entry.userCorrectedAt
 ?Date.parse(source.createdAt)>Date.parse(entry.userCorrectedAt)
 :source.kind==='message'&&entry.sourceKind==='message'&&source.sequence&&entry.sourceSequence
 ?BigInt(source.sequence)>BigInt(entry.sourceSequence)
 :source.kind==='profile'&&entry.sourceKind==='profile'&&source.id===entry.sourceId?source.version>entry.sourceVersion:Date.parse(source.createdAt)>Date.parse(entry.sourceCreatedAt)

export class AutomaticMemoryStore{
 constructor(readonly pool:Pool,readonly dependencies:AutoDependencies,private readonly queue?:AutomaticQueueSender){}
 private async transaction<T>(accountId:string,run:(db:PoolClient)=>Promise<T>):Promise<T>{
  const db=await this.pool.connect()
  try{
   await db.query('BEGIN')
   const gate=(await db.query<{erased_at:Date|null}>('INSERT INTO memory_account_write_gates(account_id) VALUES($1) ON CONFLICT(account_id) DO UPDATE SET account_id=EXCLUDED.account_id RETURNING erased_at',[accountId])).rows[0]
   if(gate.erased_at)throw notFound()
   const result=await run(db);await db.query('COMMIT');return result
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
 }
 private async access(accountId:string,personId:string){
  const [account,person]=await Promise.all([this.dependencies.account(accountId),this.dependencies.person(accountId,personId)])
  if(account.accountId!==accountId||account.status!=='active'||person.accountId!==accountId||person.id!==personId||person.status!=='active')throw notFound()
  if(!account.storyStorage.allowed)throw forbidden()
  if(!validPurposeContext(account.aiTextProcessing))throw unavailable()
  return {account,person}
 }
 private event(origin:AutomaticOrigin,event:AutomaticSourceEvent){
  if(!['people','conversations'].includes(origin)||!event||!uuid.test(event.eventId)||!uuid.test(event.accountId)||!uuid.test(event.personId)||!uuid.test(event.sourceId)||!['profile','message'].includes(event.sourceKind)||!['upsert','remove'].includes(event.change)||!Number.isSafeInteger(event.sourceVersion)||event.sourceVersion<1||!Number.isFinite(Date.parse(event.occurredAt))||event.sourceKind==='profile'&&(origin!=='people'||event.sourceId!==event.personId)||event.sourceKind==='message'&&origin!=='conversations')throw new MemoryError(400,'INVALID_ARGUMENT','Invalid automatic source event.')
 }
 async snapshot(accountId:string,personId:string,kind:AutomaticSourceKind,sourceId:string,sourceCreatedAt?:string):Promise<AutomaticSnapshot>{
  const first=await this.access(accountId,personId)
  if(!first.account.aiTextProcessing.allowed||first.account.aiTextProcessing.automaticMemoryAllowed!==true)throw denied()
  let source:AutomaticSnapshot['source'],context:AutomaticSnapshot['context']=[]
  if(kind==='profile'){
   if(sourceId!==personId)throw notFound()
   source={kind,id:sourceId,version:first.person.version,createdAt:sourceCreatedAt??new Date().toISOString(),body:profileBody(first.person),aiAuthorizationVersion:first.account.aiTextProcessing.authorizationVersion,contextRefs:[]}
  }else{
   const message=await this.dependencies.automaticMessage(accountId,sourceId)
   if(message.id!==sourceId||message.accountId!==accountId||message.personId!==personId||!clean(message.text,4000)||!Number.isSafeInteger(message.version)||message.version<1||!Number.isFinite(Date.parse(message.createdAt))||!/^[1-9][0-9]*$/.test(message.sequence)||!Array.isArray(message.context)||message.context.length>20)throw changed()
   if(message.aiAuthorizationVersion!==first.account.aiTextProcessing.authorizationVersion)throw new AutomaticError('SOURCE_AI_VERSION_INELIGIBLE',false)
   context=message.context
   source={kind,id:sourceId,version:message.version,createdAt:message.createdAt,sequence:message.sequence,body:message.text,aiAuthorizationVersion:message.aiAuthorizationVersion,contextRefs:uniqueRefs([...context.map(value=>({id:value.id,version:value.version})),{id:message.id,version:message.version}])}
   const valid=await this.dependencies.validAutomaticRefs(accountId,personId,source.contextRefs),validKeys=new Set(valid.map(ref=>ref.id+':'+ref.version))
   if(!source.contextRefs.every(ref=>validKeys.has(ref.id+':'+ref.version)))throw changed()
  }
  const previousEntries=await this.context(accountId,personId,source.body,24)
  if(source.contextRefs.length){const valid=await this.dependencies.validAutomaticRefs(accountId,personId,source.contextRefs),keys=new Set(valid.map(ref=>ref.id+':'+ref.version));if(!source.contextRefs.every(ref=>keys.has(ref.id+':'+ref.version)))throw changed()}
  const latest=await this.access(accountId,personId)
  if(!latest.account.aiTextProcessing.allowed||latest.account.aiTextProcessing.automaticMemoryAllowed!==true||latest.account.aiTextProcessing.authorizationVersion!==first.account.aiTextProcessing.authorizationVersion)throw denied()
  if(latest.person.version!==first.person.version||latest.person.accessVersion!==first.person.accessVersion||latest.account.accessVersion!==first.account.accessVersion||latest.account.storyStorage.authorizationVersion!==first.account.storyStorage.authorizationVersion)throw changed()
  return {...latest,source,context,previousEntries}
 }
 validSnapshot(job:AutomaticJob,value:AutomaticSnapshot){return value.account.aiTextProcessing.allowed&&value.account.aiTextProcessing.automaticMemoryAllowed===true&&value.account.aiTextProcessing.authorizationVersion===job.ai_authorization_version&&value.account.storyStorage.allowed&&value.account.storyStorage.authorizationVersion===job.authorization_version&&value.account.accessVersion===job.account_access_version&&value.person.version===job.person_version&&value.person.accessVersion===job.person_access_version&&snapshotHash(value)===job.snapshot_hash}
 private async invalidate(db:PoolClient,accountId:string,personId:string,sourceId:string,kind:AutomaticSourceKind,reason:string){
  const ref=JSON.stringify([{id:sourceId}])
  await db.query("UPDATE automatic_memory_jobs SET state='blocked',failure_code=$5,retryable=false,lease_until=NULL,attempt_id=NULL,finished_at=GREATEST(created_at,clock_timestamp()),updated_at=GREATEST(updated_at,clock_timestamp()),version=version+1 WHERE account_id=$1 AND person_id=$2 AND state IN ('queued','running','failed') AND ((source_kind=$4 AND source_id=$3) OR ($4='message' AND context_refs @> $6::jsonb))",[accountId,personId,sourceId,kind,reason,ref])
  await db.query("UPDATE automatic_memory_entries SET state='withdrawn',superseded_by=NULL,state_changed_at=GREATEST(created_at,clock_timestamp()),updated_at=GREATEST(updated_at,clock_timestamp()),version=version+1 WHERE account_id=$1 AND person_id=$2 AND state='active' AND ((source_kind=$4 AND source_id=$3) OR ($4='message' AND sources @> $5::jsonb))",[accountId,personId,sourceId,kind,ref])
 }
 async ingest(origin:AutomaticOrigin,event:AutomaticSourceEvent):Promise<{accepted:true;jobId?:string}>{
  this.event(origin,event)
  const accepted=(await this.pool.query<{request_hash:string}>('SELECT request_hash FROM automatic_memory_receipts WHERE origin=$1 AND event_id=$2',[origin,event.eventId])).rows[0]
  if(accepted){if(accepted.request_hash!==hash(event))throw conflict();return {accepted:true}}
  let snapshot:AutomaticSnapshot|undefined,ineligible=false,missing=false
  if(event.change==='upsert'){
   try{
    const {account}=await this.access(event.accountId,event.personId)
    if(!account.aiTextProcessing.allowed||account.aiTextProcessing.automaticMemoryAllowed!==true){if(event.sourceKind==='profile'&&(account.aiTextProcessing.authorizationVersion===0||account.aiTextProcessing.automaticMemoryAllowed!==true))throw denied();ineligible=true}
    if(!ineligible)snapshot=await this.snapshot(event.accountId,event.personId,event.sourceKind,event.sourceId,event.occurredAt)
   }catch(error){if(error instanceof AutomaticError&&error.code==='SOURCE_AI_VERSION_INELIGIBLE')ineligible=true;else if(error instanceof MemoryError&&error.status===404)missing=true;else throw error}
  }
  return this.transaction(event.accountId,async db=>{
   const fingerprint=hash(event),prior=(await db.query<{request_hash:string}>('SELECT request_hash FROM automatic_memory_receipts WHERE origin=$1 AND event_id=$2',[origin,event.eventId])).rows[0]
   if(prior){if(prior.request_hash!==fingerprint)throw conflict();return {accepted:true}}
   const old=(await db.query<SourceRow>('SELECT * FROM automatic_memory_sources WHERE account_id=$1 AND person_id=$2 AND source_kind=$3 AND source_id=$4 FOR UPDATE',[event.accountId,event.personId,event.sourceKind,event.sourceId])).rows[0]
   let outcome:'accepted'|'stale'|'ineligible'|'removed'='accepted',jobId:string|undefined
   const stale=old&&(old.source_version>event.sourceVersion||old.state==='removed'&&old.source_version>=event.sourceVersion)
   if(stale||snapshot&&snapshot.source.version>event.sourceVersion)outcome='stale'
   else{
    if(snapshot&&snapshot.source.version<event.sourceVersion)throw changed()
    const state=event.change==='remove'||missing?'removed':ineligible?'blocked':'active'
    if(event.change==='remove'||missing||ineligible||old&&old.source_version!==event.sourceVersion)await this.invalidate(db,event.accountId,event.personId,event.sourceId,event.sourceKind,event.change==='remove'||missing?'SOURCE_REMOVED':ineligible?'AI_PERMISSION_REQUIRED':'SOURCE_CHANGED')
    const source=(await db.query<SourceRow>(`INSERT INTO automatic_memory_sources(account_id,person_id,source_kind,source_id,source_version,state,source_created_at,source_sequence,last_event_at,removed_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $6='removed' THEN clock_timestamp() END)
     ON CONFLICT(account_id,person_id,source_kind,source_id) DO UPDATE SET source_version=EXCLUDED.source_version,state=EXCLUDED.state,source_created_at=EXCLUDED.source_created_at,source_sequence=EXCLUDED.source_sequence,last_event_at=EXCLUDED.last_event_at,removed_at=EXCLUDED.removed_at,version=automatic_memory_sources.version+1,updated_at=GREATEST(automatic_memory_sources.updated_at,clock_timestamp()) RETURNING *`,[event.accountId,event.personId,event.sourceKind,event.sourceId,event.sourceVersion,state,snapshot?.source.createdAt??old?.source_created_at??event.occurredAt,snapshot?.source.sequence??old?.source_sequence??null,event.occurredAt])).rows[0]
    if(event.change==='remove'||missing)outcome='removed'
    else if(ineligible)outcome='ineligible'
    else{
     if(!this.queue)throw unavailable()
     const value=snapshot!,snapshotDigest=snapshotHash(value)
     // A source version already successfully processed is never learned again.
     // This also preserves supersession tombstones across replay and consent changes.
     const existing=(await db.query<AutomaticJob>("SELECT * FROM automatic_memory_jobs WHERE source_record_id=$1 AND source_version=$2 AND (state='succeeded' OR (snapshot_hash=$3 AND ai_authorization_version=$4)) ORDER BY created_at DESC LIMIT 1",[source.id,event.sourceVersion,snapshotDigest,value.account.aiTextProcessing.authorizationVersion])).rows[0]
     if(existing)jobId=existing.id
     else{
      const dispatchId=randomUUID(),job=(await db.query<AutomaticJob>(`INSERT INTO automatic_memory_jobs(account_id,person_id,source_record_id,source_kind,source_id,source_version,source_created_at,source_sequence,context_refs,snapshot_hash,person_version,person_access_version,account_access_version,authorization_version,ai_authorization_version,dispatch_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,[event.accountId,event.personId,source.id,event.sourceKind,event.sourceId,event.sourceVersion,value.source.createdAt,value.source.sequence??null,JSON.stringify(value.source.contextRefs),snapshotDigest,value.person.version,value.person.accessVersion,value.account.accessVersion,value.account.storyStorage.authorizationVersion,value.account.aiTextProcessing.authorizationVersion,dispatchId])).rows[0]
      await this.queue.send(db,{jobId:job.id,dispatchId,dispatchGeneration:job.dispatch_generation});jobId=job.id
     }
    }
   }
   await db.query('INSERT INTO automatic_memory_receipts(origin,event_id,account_id,person_id,request_hash,outcome) VALUES($1,$2,$3,$4,$5,$6)',[origin,event.eventId,event.accountId,event.personId,fingerprint,outcome])
   return {accepted:true,...(jobId?{jobId}:{})}
  })
 }
 async findJob(id:string){return (await this.pool.query<AutomaticJob>('SELECT * FROM automatic_memory_jobs WHERE id=$1',[id])).rows[0]}
 async claim(dispatch:AutomaticDispatch){
  const previous=await this.findJob(dispatch.jobId);if(!previous)return
  return this.transaction(previous.account_id,async db=>{
   const row=(await db.query<AutomaticJob>('SELECT * FROM automatic_memory_jobs WHERE id=$1 FOR UPDATE',[dispatch.jobId])).rows[0]
   if(!row||row.state!=='queued'||row.dispatch_id!==dispatch.dispatchId||row.dispatch_generation!==dispatch.dispatchGeneration||row.run_after>new Date())return
   if((await db.query("SELECT id FROM automatic_memory_jobs WHERE account_id=$1 AND person_id=$2 AND state='running'",[row.account_id,row.person_id])).rowCount)return
   if((await db.query(`SELECT id FROM automatic_memory_jobs WHERE account_id=$1 AND person_id=$2 AND id<>$3 AND (state='queued' OR (state='failed' AND retryable))
    AND CASE WHEN source_kind='message' AND $4='message' THEN source_sequence<$5::bigint ELSE source_created_at<$6::timestamptz END LIMIT 1`,[row.account_id,row.person_id,row.id,row.source_kind,row.source_sequence,row.source_created_at])).rowCount)return
   const source=(await db.query<SourceRow>('SELECT * FROM automatic_memory_sources WHERE id=$1',[row.source_record_id])).rows[0]
   if(!source||source.state!=='active'||source.source_version!==row.source_version){await db.query("UPDATE automatic_memory_jobs SET state='blocked',failure_code='SOURCE_CHANGED',retryable=false,finished_at=GREATEST(created_at,clock_timestamp()),updated_at=GREATEST(updated_at,clock_timestamp()),version=version+1 WHERE id=$1",[row.id]);return}
   return (await db.query<AutomaticJob>("UPDATE automatic_memory_jobs SET state='running',attempt_id=$2,attempt_count=attempt_count+1,started_at=clock_timestamp(),lease_until=clock_timestamp()+interval '45 seconds',updated_at=GREATEST(updated_at,clock_timestamp()),version=version+1 WHERE id=$1 AND attempt_count<3 RETURNING *",[row.id,randomUUID()])).rows[0]
  })
 }
 async fail(job:AutomaticJob,code:string,retryable=false,state:'failed'|'blocked'='failed'){
  return this.transaction(job.account_id,async db=>(await db.query("UPDATE automatic_memory_jobs SET state=$4,failure_code=$5,retryable=$6,lease_until=NULL,attempt_id=NULL,finished_at=GREATEST(created_at,clock_timestamp()),updated_at=GREATEST(updated_at,clock_timestamp()),version=version+1 WHERE id=$1 AND state='running' AND attempt_id=$2 AND dispatch_generation=$3",[job.id,job.attempt_id,job.dispatch_generation,state,code,state==='failed'&&retryable&&job.attempt_count<3])).rowCount===1)
 }
 async complete(job:AutomaticJob,facts:AutomaticFact[],usedSnapshot:AutomaticSnapshot){
  if(!this.validSnapshot(job,usedSnapshot))throw changed()
  const current=await this.snapshot(job.account_id,job.person_id,job.source_kind,job.source_id,job.source_created_at.toISOString())
  if(!this.validSnapshot(job,current))throw changed()
  if(!Array.isArray(facts)||facts.length>6)throw new AutomaticError('MODEL_INVALID_OUTPUT',false)
  const allowed=new Map(usedSnapshot.previousEntries.map(entry=>[entry.id,entry])),superseded=new Set<string>()
  for(const fact of facts){
   if(!clean(fact.body,600)||!clean(fact.topic,120)||!clean(fact.evidence,400)||!clean(fact.timeDescription,120,true)||!current.source.body.includes(fact.evidence)||!Array.isArray(fact.supersedes))throw new AutomaticError('MODEL_INVALID_OUTPUT',false)
   for(const id of fact.supersedes){const entry=allowed.get(id);if(!entry||superseded.has(id)||!laterThan(current.source,entry))throw new AutomaticError('MODEL_INVALID_OUTPUT',false);superseded.add(id)}
  }
  return this.transaction(job.account_id,async db=>{
   const active=(await db.query<AutomaticJob>('SELECT * FROM automatic_memory_jobs WHERE id=$1 FOR UPDATE',[job.id])).rows[0]
   if(!active||active.state!=='running'||active.attempt_id!==job.attempt_id||active.dispatch_generation!==job.dispatch_generation||!active.lease_until||active.lease_until<=new Date())return false
   const source=(await db.query<SourceRow>('SELECT * FROM automatic_memory_sources WHERE id=$1 FOR UPDATE',[job.source_record_id])).rows[0]
   if(!source||source.state!=='active'||source.source_version!==job.source_version)return false
   const usedIds=[...allowed.keys()]
   if(usedIds.length){
    const rows=(await db.query<{id:string;version:number}>(
     "SELECT id,version FROM automatic_memory_entries WHERE account_id=$1 AND person_id=$2 AND id=ANY($3::uuid[]) AND state='active'",
     [job.account_id,job.person_id,usedIds])).rows
    if(rows.length!==usedIds.length||rows.some(row=>row.version!==allowed.get(row.id)?.version))throw changed()
   }
   // Supersession tombstones are never reactivated when a later source is removed.
   for(const [index,fact]of facts.entries()){
    const entry=(await db.query<{id:string}>(`INSERT INTO automatic_memory_entries(account_id,person_id,source_record_id,generation_job_id,fact_index,source_kind,source_id,source_version,reality,source_created_at,source_sequence,sources,topic,body,evidence,time_description,person_access_version,account_access_version,authorization_version,ai_authorization_version)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id`,[job.account_id,job.person_id,job.source_record_id,job.id,index,job.source_kind,job.source_id,job.source_version,job.source_kind==='profile'?'user_provided_profile':'user_reported',job.source_created_at,job.source_sequence,JSON.stringify(job.context_refs),fact.topic.trim(),fact.body.trim(),fact.evidence,fact.timeDescription.trim(),job.person_access_version,job.account_access_version,job.authorization_version,job.ai_authorization_version])).rows[0]
    for(const id of fact.supersedes)await db.query("UPDATE automatic_memory_entries SET state='superseded',superseded_by=$2,version=version+1,state_changed_at=GREATEST(created_at,clock_timestamp()),updated_at=GREATEST(updated_at,clock_timestamp()) WHERE id=$1 AND state='active'",[id,entry.id])
   }
   await db.query("UPDATE automatic_memory_jobs SET state='succeeded',entry_count=$2,lease_until=NULL,attempt_id=NULL,retryable=false,failure_code=NULL,finished_at=GREATEST(created_at,clock_timestamp()),updated_at=GREATEST(updated_at,clock_timestamp()),version=version+1 WHERE id=$1",[job.id,facts.length]);return true
  })
 }
 async release(job:AutomaticJob){return this.transaction(job.account_id,async db=>{await db.query("UPDATE automatic_memory_jobs SET state='queued',lease_until=NULL,attempt_id=NULL,started_at=NULL,queued_at=clock_timestamp(),run_after=clock_timestamp(),updated_at=GREATEST(updated_at,clock_timestamp()),version=version+1 WHERE id=$1 AND state='running' AND attempt_id=$2 AND dispatch_generation=$3",[job.id,job.attempt_id,job.dispatch_generation])})}
 private async validRows(accountId:string,personId:string,rows:EntryRow[]){
  const {account,person}=await this.access(accountId,personId)
  if(!account.aiTextProcessing.allowed||account.aiTextProcessing.automaticMemoryAllowed!==true)return []
  const eligible=rows.filter(row=>row.state==='active'&&row.account_id===accountId&&row.person_id===personId&&row.account_access_version===account.accessVersion&&row.person_access_version===person.accessVersion&&row.authorization_version===account.storyStorage.authorizationVersion&&row.ai_authorization_version===account.aiTextProcessing.authorizationVersion&&(row.source_kind!=='profile'||row.source_id===personId&&row.source_version===person.version))
  const refs=uniqueRefs(eligible.flatMap(row=>row.sources)),valid:AutomaticRef[]=[]
  for(let offset=0;offset<refs.length;offset+=64)valid.push(...await this.dependencies.validAutomaticRefs(accountId,personId,refs.slice(offset,offset+64)))
  const keys=new Set(valid.map(ref=>ref.id+':'+ref.version))
  const result=eligible.filter(row=>row.sources.every(ref=>keys.has(ref.id+':'+ref.version)))
  const latest=await this.access(accountId,personId)
  if(!latest.account.aiTextProcessing.allowed||latest.account.aiTextProcessing.automaticMemoryAllowed!==true||latest.account.aiTextProcessing.authorizationVersion!==account.aiTextProcessing.authorizationVersion||latest.account.storyStorage.authorizationVersion!==account.storyStorage.authorizationVersion||latest.account.accessVersion!==account.accessVersion||latest.person.accessVersion!==person.accessVersion||latest.person.version!==person.version)return []
  // An event or another extraction may invalidate local entries while source RPCs run.
  const final=(await this.pool.query<{id:string;version:number}>("SELECT e.id,e.version FROM automatic_memory_entries e JOIN automatic_memory_sources s ON s.id=e.source_record_id WHERE e.account_id=$1 AND e.person_id=$2 AND e.id=ANY($3::uuid[]) AND e.state='active' AND s.state='active' AND s.source_version=e.source_version",[accountId,personId,result.map(row=>row.id)])).rows
  const current=new Map(final.map(row=>[row.id,row.version]));return result.filter(row=>current.get(row.id)===row.version)
 }
 async context(accountId:string,personId:string,query='',limit=8):Promise<AutoEntry[]>{
  // Rank the entire visible history before applying the RPC/processing bound.
  // Parameters are literal substrings; SQL wildcard characters never become patterns.
  const normalized="regexp_replace(lower(normalize(COALESCE(e.corrected_body,e.body)||' '||COALESCE(e.corrected_topic,e.topic),NFKC)),'[^[:alnum:]]+',' ','g')"
  const rows=(await this.pool.query<EntryRow>(`SELECT e.* FROM automatic_memory_entries e JOIN automatic_memory_sources s ON s.id=e.source_record_id
   WHERE e.account_id=$1 AND e.person_id=$2 AND e.state='active' AND s.state='active' AND s.source_version=e.source_version
   ORDER BY CASE WHEN $4::text<>'' AND strpos(${normalized},$4)>0 THEN 1 ELSE 0 END DESC,
   (SELECT count(*) FROM unnest($3::text[]) AS tokens(value) WHERE strpos(${normalized},tokens.value)>0) DESC,
   e.source_created_at DESC,e.source_sequence DESC NULLS LAST,e.id DESC LIMIT 200`,[accountId,personId,evidenceTerms(query),normalize(query)])).rows
  const valid=await this.validRows(accountId,personId,rows)
  const scored=query.trim()?valid.map(row=>({row,score:Math.max(evidenceScore(row.corrected_body??row.body,query),evidenceScore(row.corrected_topic??row.topic,query))})).sort((a,b)=>b.score-a.score):valid.map(row=>({row,score:0}))
  return scored.slice(0,Math.min(24,limit)).map(value=>dto(value.row))
 }
 async managedList(accountId:string,personId:string,after:EntryCursor|undefined,limit:number){
  const {account,person}=await this.access(accountId,personId)
  if(!account.aiTextProcessing.allowed||account.aiTextProcessing.automaticMemoryAllowed!==true)throw denied()
  const rows=(await this.pool.query<EntryRow>(`SELECT e.* FROM automatic_memory_entries e JOIN automatic_memory_sources s ON s.id=e.source_record_id
   WHERE e.account_id=$1 AND e.person_id=$2 AND e.state='active' AND s.state='active' AND s.source_version=e.source_version
    AND e.account_access_version=$3 AND e.person_access_version=$4 AND e.authorization_version=$5 AND e.ai_authorization_version=$6
    AND (e.source_kind='message' OR e.source_id=$2 AND e.source_version=$7)
    AND ($8::timestamptz IS NULL OR (e.source_created_at,e.id)<($8::timestamptz,$9::uuid))
   ORDER BY e.source_created_at DESC,e.id DESC LIMIT $10`,[accountId,personId,account.accessVersion,person.accessVersion,
    account.storyStorage.authorizationVersion,account.aiTextProcessing.authorizationVersion,person.version,after?.at??null,after?.id??null,limit+1])).rows
  const page=rows.slice(0,limit),last=page.at(-1)
  return {items:(await this.validRows(accountId,personId,page)).map(managedDto),
   next:rows.length>limit&&last?{at:last.source_created_at.toISOString(),id:last.id}:null}
 }
 async control(accountId:string,personId:string,id:string,key:string,expected:number,correction?:AutomaticCorrection){
  const before=await this.access(accountId,personId)
  if(!before.account.aiTextProcessing.allowed||before.account.aiTextProcessing.automaticMemoryAllowed!==true)throw denied()
  const fingerprint=hash([expected,correction??null])
  const select="SELECT e.*,s.state AS source_state,s.source_version AS current_source_version FROM automatic_memory_entries e JOIN automatic_memory_sources s ON s.id=e.source_record_id WHERE e.account_id=$1 AND e.person_id=$2 AND e.id=$3"
  type ManagedRow=EntryRow&{source_state:SourceRow['state'];current_source_version:number}
  const preview=(await this.pool.query<ManagedRow>(select,[accountId,personId,id])).rows[0]
  if(!preview)throw notFound()
  const sameAuthority=(row:EntryRow)=>row.account_access_version===before.account.accessVersion&&row.person_access_version===before.person.accessVersion
   &&row.authorization_version===before.account.storyStorage.authorizationVersion&&row.ai_authorization_version===before.account.aiTextProcessing.authorizationVersion
  if(!sameAuthority(preview))throw notFound()
  const retry=preview.last_control_key===key
  if(retry&&preview.last_control_hash!==fingerprint)throw conflict()
  if(!retry){
   if(preview.version!==expected)throw versionConflict()
   if(!(await this.validRows(accountId,personId,[preview])).length)throw notFound()
  }
  const result=await this.transaction(accountId,async db=>{
   const row=(await db.query<ManagedRow>(select+' FOR UPDATE OF e',[accountId,personId,id])).rows[0]
   if(!row||!sameAuthority(row))throw notFound()
   if(row.last_control_key===key){
    if(row.last_control_hash!==fingerprint)throw conflict()
    if(row.version!==expected+1)throw versionConflict()
    return {id,personId,version:row.version,state:row.state}
   }
   if(row.version!==expected)throw versionConflict()
   if(row.state!=='active'||row.source_state!=='active'||row.source_version!==row.current_source_version)throw notFound()
   const changed=(await db.query<{state:EntryRow['state'];version:number}>(`UPDATE automatic_memory_entries SET
    corrected_topic=COALESCE($4,corrected_topic),corrected_body=COALESCE($5,corrected_body),
    corrected_at=CASE WHEN $5::text IS NULL THEN corrected_at ELSE clock_timestamp() END,
    state=CASE WHEN $5::text IS NULL THEN 'withdrawn' ELSE state END,
    state_changed_at=CASE WHEN $5::text IS NULL THEN GREATEST(created_at,clock_timestamp()) ELSE state_changed_at END,
    last_control_key=$6,last_control_hash=$7,version=version+1,updated_at=GREATEST(updated_at,clock_timestamp())
    WHERE account_id=$1 AND person_id=$2 AND id=$3 RETURNING state,version`,
    [accountId,personId,id,correction?.topic??null,correction?.body??null,key,fingerprint])).rows[0]
   return {id,personId,...changed}
  })
  const after=await this.access(accountId,personId)
  if(!after.account.aiTextProcessing.allowed||after.account.aiTextProcessing.automaticMemoryAllowed!==true)throw denied()
  if(before.account.aiTextProcessing.authorizationVersion!==after.account.aiTextProcessing.authorizationVersion
   ||before.account.storyStorage.authorizationVersion!==after.account.storyStorage.authorizationVersion
   ||before.account.accessVersion!==after.account.accessVersion||before.person.accessVersion!==after.person.accessVersion||before.person.version!==after.person.version)throw changed()
  return result
 }
 async validate(accountId:string,personId:string,refs:AutomaticRef[]):Promise<boolean>{
  if(!Array.isArray(refs)||refs.length>24||refs.some(ref=>!uuid.test(ref.id)||!Number.isSafeInteger(ref.version)||ref.version<1))return false
  if(!refs.length){await this.access(accountId,personId);return true}
  const rows=(await this.pool.query<EntryRow>("SELECT e.* FROM automatic_memory_entries e JOIN automatic_memory_sources s ON s.id=e.source_record_id WHERE e.account_id=$1 AND e.person_id=$2 AND e.id=ANY($3::uuid[]) AND e.state='active' AND s.state='active' AND s.source_version=e.source_version",[accountId,personId,refs.map(ref=>ref.id)])).rows
  const valid=await this.validRows(accountId,personId,rows),byId=new Map(valid.map(row=>[row.id,row.version]))
  return refs.every(ref=>byId.get(ref.id)===ref.version)
 }
 async reconcileDeliveries(){
  if(!this.queue?.isPending)return
  const rows=(await this.pool.query<AutomaticJob>("SELECT * FROM automatic_memory_jobs WHERE (state='queued' AND updated_at<clock_timestamp()-interval '5 seconds') OR (state='running' AND lease_until<=clock_timestamp()) OR (state='failed' AND retryable AND updated_at<clock_timestamp()-interval '10 seconds') ORDER BY updated_at LIMIT 50")).rows
  for(const previous of rows)try{await this.transaction(previous.account_id,async db=>{
   const row=(await db.query<AutomaticJob>('SELECT * FROM automatic_memory_jobs WHERE id=$1 FOR UPDATE',[previous.id])).rows[0]
   if(!row||row.version!==previous.version||!['queued','running','failed'].includes(row.state))return
   if(await this.queue!.isPending!(db,{jobId:row.id,dispatchId:row.dispatch_id,dispatchGeneration:row.dispatch_generation}))return
   if(row.attempt_count>=3){await db.query("UPDATE automatic_memory_jobs SET state='failed',retryable=false,failure_code='ATTEMPTS_EXHAUSTED',lease_until=NULL,attempt_id=NULL,finished_at=GREATEST(created_at,clock_timestamp()),updated_at=GREATEST(updated_at,clock_timestamp()),version=version+1 WHERE id=$1",[row.id]);return}
   const dispatchId=randomUUID(),next=(await db.query<AutomaticJob>("UPDATE automatic_memory_jobs SET state='queued',failure_code=NULL,retryable=false,lease_until=NULL,attempt_id=NULL,started_at=NULL,finished_at=NULL,dispatch_id=$2,dispatch_generation=dispatch_generation+1,queued_at=clock_timestamp(),run_after=clock_timestamp(),updated_at=GREATEST(updated_at,clock_timestamp()),version=version+1 WHERE id=$1 RETURNING *",[row.id,dispatchId])).rows[0]
   await this.queue!.send(db,{jobId:row.id,dispatchId,dispatchGeneration:next.dispatch_generation})
  })}catch(error){if(!(error instanceof MemoryError&&error.status===404))throw error}
 }
}
