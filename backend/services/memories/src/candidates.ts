import {createHash,randomUUID} from 'node:crypto'
import type {Pool,PoolClient} from 'pg'
import {MemoryError,conflict,forbidden,notFound,unavailable,type MemoryCandidate,type SuggestionJob,type SuggestionState} from './contracts.js'
import type {AccountContext,ContextProvider,MemorySourceContext,PersonContext} from './dependencies.js'
import {validPurposeContext} from './dependencies.js'

export type SourceRef={id:string;version:number}
export type CandidateSnapshot={account:AccountContext;person:PersonContext;context:MemorySourceContext}
export type CandidateJobRow={id:string;account_id:string;person_id:string;source_message_id:string;source_version:number;context_refs:SourceRef[];person_version:number;person_access_version:number;account_access_version:number;authorization_version:number;ai_authorization_version:number;state:SuggestionState;version:number;dispatch_id:string;dispatch_generation:number;attempt_id:string|null;attempt_count:number;lease_until:Date|null;failure_code:string|null;retryable:boolean;candidate_id:string|null;created_at:Date;updated_at:Date;queued_at:Date;run_after:Date;started_at:Date|null;finished_at:Date|null}
export type CandidateRow={id:string;account_id:string;person_id:string;generation_job_id:string;source_message_id:string;source_version:number;context_refs:SourceRef[];title:string;body:string;state:MemoryCandidate['state'];version:number;created_at:Date;expires_at:Date;state_changed_at:Date;consumed_at:Date|null}
export type Dispatch={jobId:string;dispatchId:string;dispatchGeneration:number}
export interface CandidateQueueSender{send(db:PoolClient,dispatch:Dispatch):Promise<void>;isPending?(db:PoolClient,dispatch:Dispatch):Promise<boolean>}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const refs=(value:MemorySourceContext)=>value.messages.map(item=>({id:item.id,version:item.version}))
const sourceChanged=()=>new MemoryError(409,'SOURCE_CHANGED','The source conversation is no longer available in the accepted version.')
const aiPermissionRequired=()=>new MemoryError(403,'AI_PERMISSION_REQUIRED','Allow AI text processing before requesting generation.')
type CommandResult={id:string;aiDenied?:true}
const candidateProblem=(row:CandidateRow)=>new MemoryError(409,row.state==='consumed'?'CANDIDATE_CONSUMED':row.state==='expired'?'CANDIDATE_EXPIRED':'CANDIDATE_WITHDRAWN','This candidate is no longer available for confirmation.')
export const publicCandidateJob=(row:CandidateJobRow):SuggestionJob=>({id:row.id,kind:'memory_suggestion',targetId:row.person_id,state:row.state,version:row.version,...(row.candidate_id?{resultRef:{kind:'memory_candidate' as const,id:row.candidate_id}}:{}),...(row.failure_code?{failure:{code:row.failure_code,retryable:row.retryable}}:{}),updatedAt:row.updated_at.toISOString()})

export class CandidateStore{
 constructor(readonly pool:Pool,readonly dependencies:ContextProvider,private readonly queue:CandidateQueueSender){}
 async access(accountId:string,personId:string,storage=true){const [account,person]=await Promise.all([this.dependencies.account(accountId),this.dependencies.person(accountId,personId)]);if(storage&&!account.storyStorage.allowed)throw forbidden();return {account,person}}
 async snapshot(accountId:string,personId:string,sourceId:string):Promise<CandidateSnapshot>{
  await this.access(accountId,personId)
  if(!this.dependencies.memoryContext)throw unavailable()
  let context:MemorySourceContext
  try{context=await this.dependencies.memoryContext(accountId,sourceId)}catch(error){if(error instanceof MemoryError&&error.status===404)throw sourceChanged();throw error}
  if(context.source.accountId!==accountId||context.source.personId!==personId||context.source.author.kind!=='persona'||context.source.id!==sourceId||context.messages.length!==2||context.messages[0].author.kind!=='self'||context.messages[1].id!==sourceId||context.source.replyToMessageId!==context.messages[0].id)throw sourceChanged()
  // Loading source text can be slow; do not send it with an authorization read before that RPC.
  const latest=await this.access(accountId,personId)
  return {...latest,context}
 }
 validSourceSnapshot(job:CandidateJobRow,snapshot:CandidateSnapshot){return snapshot.account.storyStorage.allowed&&snapshot.account.accessVersion===job.account_access_version&&snapshot.account.storyStorage.authorizationVersion===job.authorization_version&&snapshot.person.version===job.person_version&&snapshot.person.accessVersion===job.person_access_version&&snapshot.context.source.version===job.source_version&&JSON.stringify(refs(snapshot.context))===JSON.stringify(job.context_refs)}
 validAiAuthorization(job:CandidateJobRow,snapshot:CandidateSnapshot){const grant=snapshot.account.aiTextProcessing;return validPurposeContext(grant)&&grant.allowed&&job.ai_authorization_version>0&&grant.authorizationVersion===job.ai_authorization_version}
 private requireAi(snapshot:CandidateSnapshot){const grant=snapshot.account.aiTextProcessing;if(!validPurposeContext(grant))throw unavailable();if(!grant.allowed)throw aiPermissionRequired()}
 private async tx<T>(accountId:string,run:(db:PoolClient)=>Promise<T>):Promise<T>{const db=await this.pool.connect();try{await db.query('BEGIN');await db.query('INSERT INTO memory_account_cursors(account_id) VALUES($1) ON CONFLICT DO NOTHING',[accountId]);await db.query('SELECT account_id FROM memory_account_cursors WHERE account_id=$1 FOR UPDATE',[accountId]);const result=await run(db);await db.query('COMMIT');return result}catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}}
 private async command(db:PoolClient,accountId:string,operation:string,target:string,key:string,input:unknown,run:()=>Promise<CommandResult>){
  const digest=hash(input),scope=[accountId,operation,target,key],prior=(await db.query<{request_hash:string;response:CommandResult}>('SELECT request_hash,response FROM candidate_commands WHERE account_id=$1 AND operation=$2 AND target=$3 AND idempotency_key=$4',scope)).rows[0]
  if(prior){if(prior.request_hash!==digest)throw conflict();return prior.response}
  const response=await run();if(response.aiDenied)return response;await db.query('INSERT INTO candidate_commands(account_id,operation,target,idempotency_key,request_hash,response) VALUES($1,$2,$3,$4,$5,$6)',[...scope,digest,response]);return response
 }
 private async event(db:PoolClient,row:CandidateJobRow,requestId:string){await db.query("INSERT INTO outbox_events(type,account_id,aggregate_type,aggregate_id,aggregate_version,request_id,payload) VALUES('GenerationChanged.v1',$1,'memory_generation_job',$2,$3,$4,$5)",[row.account_id,row.id,row.version,requestId,{jobId:row.id,kind:'memory_suggestion',targetId:row.person_id,state:row.state}])}
 private async blockAi(db:PoolClient,row:CandidateJobRow,requestId:string){
  if(['queued','running'].includes(row.state)){
   const blocked=(await db.query<CandidateJobRow>("UPDATE memory_generation_jobs SET state='blocked',failure_code='AI_PERMISSION_REQUIRED',retryable=false,lease_until=NULL,finished_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE id=$1 RETURNING *",[row.id])).rows[0]
   await this.event(db,blocked,requestId)
  }
  return {id:row.id,aiDenied:true as const}
 }
 async findJob(id:string){return (await this.pool.query<CandidateJobRow>('SELECT * FROM memory_generation_jobs WHERE id=$1',[id])).rows[0]}
 private async ownedJob(accountId:string,id:string){const job=await this.findJob(id);if(!job||job.account_id!==accountId)throw notFound();return job}
 async job(accountId:string,id:string){const row=await this.ownedJob(accountId,id);await this.access(accountId,row.person_id);return publicCandidateJob(row)}
 async request(accountId:string,personId:string,sourceId:string,key:string,requestId:string=randomUUID()){
  await this.access(accountId,personId)
  let snapshot:CandidateSnapshot|undefined,error:unknown
  try{snapshot=await this.snapshot(accountId,personId,sourceId)}catch(problem){error=problem}
  const result=await this.tx(accountId,db=>this.command(db,accountId,'suggest',personId,key,{sourceId},async()=>{
   if(error)throw error
   const current=snapshot!
   this.requireAi(current)
   await db.query("UPDATE memory_candidates SET state='expired',version=version+1,state_changed_at=clock_timestamp() WHERE account_id=$1 AND person_id=$2 AND source_message_id=$3 AND state='ready' AND expires_at<=clock_timestamp()",[accountId,personId,sourceId])
   const previous=(await db.query<CandidateJobRow>('SELECT * FROM memory_generation_jobs WHERE account_id=$1 AND person_id=$2 AND source_message_id=$3 ORDER BY created_at DESC,id DESC LIMIT 1',[accountId,personId,sourceId])).rows[0]
   if(previous){
    const sourceChangedNow=!this.validSourceSnapshot(previous,current),aiChanged=!this.validAiAuthorization(previous,current),changed=sourceChangedNow||aiChanged
    if(['queued','running'].includes(previous.state)){
     if(!changed)return {id:previous.id}
     const invalidated=(await db.query<CandidateJobRow>("UPDATE memory_generation_jobs SET state='blocked',failure_code=$2,retryable=false,lease_until=NULL,finished_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE id=$1 RETURNING *",[previous.id,aiChanged?'AI_PERMISSION_REQUIRED':'SOURCE_CHANGED'])).rows[0]
     await this.event(db,invalidated,requestId)
    }
    if(['failed','blocked'].includes(previous.state)&&!changed)return {id:previous.id}
    if(previous.state==='succeeded'){
     const candidate=(await db.query<CandidateRow>('SELECT * FROM memory_candidates WHERE id=$1',[previous.candidate_id])).rows[0]
     if(candidate?.state==='consumed')return {id:previous.id}
     if(candidate?.state==='ready'){
      if(this.validSourceSnapshot(previous,current))return {id:previous.id}
      await db.query("UPDATE memory_candidates SET state='withdrawn',state_changed_at=clock_timestamp(),version=version+1 WHERE id=$1 AND state='ready'",[candidate.id])
     }
    }
   }
   const dispatchId=randomUUID(),job=(await db.query<CandidateJobRow>(`INSERT INTO memory_generation_jobs(account_id,person_id,source_message_id,source_version,context_refs,person_version,person_access_version,account_access_version,authorization_version,ai_authorization_version,dispatch_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[accountId,personId,sourceId,current.context.source.version,JSON.stringify(refs(current.context)),current.person.version,current.person.accessVersion,current.account.accessVersion,current.account.storyStorage.authorizationVersion,current.account.aiTextProcessing.authorizationVersion,dispatchId])).rows[0]
   await this.queue.send(db,{jobId:job.id,dispatchId,dispatchGeneration:job.dispatch_generation});await this.event(db,job,requestId);return {id:job.id}
  }))
  await this.access(accountId,personId);return {generationJobId:result.id}
 }
 private async candidateRow(accountId:string,personId:string,id:string,db:Pool|PoolClient=this.pool){const row=(await db.query<CandidateRow>('SELECT * FROM memory_candidates WHERE account_id=$1 AND person_id=$2 AND id=$3'+(db===this.pool?'':' FOR UPDATE'),[accountId,personId,id])).rows[0];if(!row)throw notFound();return row}
 private async transition(row:CandidateRow,state:'expired'|'withdrawn'){
  return this.tx(row.account_id,async db=>{const current=await this.candidateRow(row.account_id,row.person_id,row.id,db);if(current.state==='ready')return (await db.query<CandidateRow>('UPDATE memory_candidates SET state=$2,version=version+1,state_changed_at=clock_timestamp() WHERE id=$1 RETURNING *',[current.id,state])).rows[0];return current})
 }
 async readableCandidate(accountId:string,personId:string,id:string){
  await this.access(accountId,personId);let row=await this.candidateRow(accountId,personId,id)
  if(row.state==='ready'&&row.expires_at<=new Date())row=await this.transition(row,'expired')
  if(row.state==='ready'){
   const job=await this.ownedJob(accountId,row.generation_job_id)
   try{const snapshot=await this.snapshot(accountId,personId,row.source_message_id);if(!this.validSourceSnapshot(job,snapshot))row=await this.transition(row,'withdrawn')}
   catch(error){if(error instanceof MemoryError&&['SOURCE_CHANGED','FORBIDDEN'].includes(error.code))row=await this.transition(row,'withdrawn');else throw error}
  }
  return row
 }
 async candidate(accountId:string,personId:string,id:string):Promise<MemoryCandidate>{
  const row=await this.readableCandidate(accountId,personId,id)
  const consumed=row.state==='consumed'?(await this.pool.query<{id:string}>('SELECT id FROM memories WHERE account_id=$1 AND person_id=$2 AND candidate_id=$3',[accountId,personId,id])).rows[0]?.id:undefined
  return {id:row.id,personId,state:row.state,version:row.version,expiresAt:row.expires_at.toISOString(),...(row.state==='ready'?{sourceMessageId:row.source_message_id,title:row.title,body:row.body}:{}),...(consumed?{consumedByMemoryId:consumed}:{})}
 }
 async prepareConfirmation(accountId:string,personId:string,id:string,expected:number){const row=await this.readableCandidate(accountId,personId,id);if(row.state!=='ready')throw candidateProblem(row);if(row.version!==expected)throw new MemoryError(409,'SOURCE_CHANGED','The candidate version changed.');return row}
 async consume(db:PoolClient,accountId:string,personId:string,id:string,expected:number){
  const row=await this.candidateRow(accountId,personId,id,db);if(row.state!=='ready')throw candidateProblem(row)
  if(row.version!==expected)throw new MemoryError(409,'SOURCE_CHANGED','The candidate version changed.')
  const now=(await db.query<{now:Date}>('SELECT clock_timestamp() AS now')).rows[0].now
  if(row.expires_at<=now)throw new MemoryError(409,'CANDIDATE_EXPIRED','This candidate has expired.')
  await db.query("UPDATE memory_candidates SET state='consumed',consumed_at=clock_timestamp(),state_changed_at=clock_timestamp(),version=version+1 WHERE id=$1",[id]);return row
 }
 async cancel(accountId:string,id:string,key:string,requestId:string=randomUUID()){
  const before=await this.ownedJob(accountId,id);await this.access(accountId,before.person_id,false)
  const result=await this.tx(accountId,db=>this.command(db,accountId,'cancel',id,key,{},async()=>{
   const row=(await db.query<CandidateJobRow>('SELECT * FROM memory_generation_jobs WHERE account_id=$1 AND id=$2 FOR UPDATE',[accountId,id])).rows[0]
   if(['queued','running'].includes(row.state)){const next=(await db.query<CandidateJobRow>("UPDATE memory_generation_jobs SET state='canceled',lease_until=NULL,retryable=false,finished_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE id=$1 RETURNING *",[id])).rows[0];await this.event(db,next,requestId)}
   return {id}
  }));const current=await this.ownedJob(accountId,result.id);await this.access(accountId,current.person_id,false);return publicCandidateJob(current)
 }
 async retry(accountId:string,id:string,key:string,requestId:string=randomUUID()){
  const previous=await this.ownedJob(accountId,id);await this.access(accountId,previous.person_id)
  let snapshot:CandidateSnapshot|undefined,error:unknown
  try{snapshot=await this.snapshot(accountId,previous.person_id,previous.source_message_id)}catch(problem){error=problem}
  const result=await this.tx(accountId,db=>this.command(db,accountId,'retry',id,key,{},async()=>{
   const row=(await db.query<CandidateJobRow>('SELECT * FROM memory_generation_jobs WHERE account_id=$1 AND id=$2 FOR UPDATE',[accountId,id])).rows[0]
   // These states only return their accepted task; they cannot enqueue or upgrade permission.
   if(['queued','running','succeeded'].includes(row.state))return {id}
   if(row.state!=='failed'||!row.retryable||row.attempt_count>=3)throw new MemoryError(409,'TASK_NOT_RETRYABLE','This task cannot be retried.')
   if(error)throw error
   const current=snapshot!
   if(!validPurposeContext(current.account.aiTextProcessing))throw unavailable()
   if(!current.account.aiTextProcessing.allowed)return this.blockAi(db,row,requestId)
   if(!this.validSourceSnapshot(row,current))throw sourceChanged()
   const active=await db.query("SELECT id FROM memory_generation_jobs WHERE account_id=$1 AND person_id=$2 AND source_message_id=$3 AND state IN ('queued','running')",[accountId,row.person_id,row.source_message_id]);if(active.rowCount)throw new MemoryError(409,'TASK_ALREADY_ACTIVE','Another task is already active for this source.')
   const dispatchId=randomUUID(),next=(await db.query<CandidateJobRow>("UPDATE memory_generation_jobs SET state='queued',failure_code=NULL,retryable=false,lease_until=NULL,finished_at=NULL,started_at=NULL,attempt_id=NULL,dispatch_id=$2,ai_authorization_version=$3,dispatch_generation=dispatch_generation+1,queued_at=clock_timestamp(),run_after=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE id=$1 RETURNING *",[id,dispatchId,current.account.aiTextProcessing.authorizationVersion])).rows[0]
   await this.queue.send(db,{jobId:id,dispatchId,dispatchGeneration:next.dispatch_generation});await this.event(db,next,requestId);return {id}
  }));if(result.aiDenied)throw aiPermissionRequired();return this.job(accountId,result.id)
 }
 async claim(dispatch:Dispatch){
  const previous=await this.findJob(dispatch.jobId);if(!previous)return
  return this.tx(previous.account_id,async db=>{
   const row=(await db.query<CandidateJobRow>('SELECT * FROM memory_generation_jobs WHERE id=$1 FOR UPDATE',[dispatch.jobId])).rows[0],now=(await db.query<{now:Date}>('SELECT clock_timestamp() AS now')).rows[0].now
   if(!row||row.dispatch_id!==dispatch.dispatchId||row.dispatch_generation!==dispatch.dispatchGeneration||!['queued','running'].includes(row.state)||row.state==='running'&&row.lease_until!>now||row.run_after>now)return
   if(row.attempt_count>=3){const exhausted=(await db.query<CandidateJobRow>("UPDATE memory_generation_jobs SET state='failed',retryable=false,failure_code='ATTEMPTS_EXHAUSTED',lease_until=NULL,finished_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE id=$1 RETURNING *",[row.id])).rows[0];await this.event(db,exhausted,row.id);return}
   const running=(await db.query<CandidateJobRow>("UPDATE memory_generation_jobs SET state='running',attempt_id=$2,attempt_count=attempt_count+1,started_at=clock_timestamp(),lease_until=clock_timestamp()+interval '45 seconds',updated_at=clock_timestamp(),version=version+1 WHERE id=$1 RETURNING *",[row.id,randomUUID()])).rows[0];await this.event(db,running,row.id);return running
  })
 }
 async fail(current:CandidateJobRow,code:string,retryable:boolean,state:'failed'|'blocked'='failed'){
  return this.tx(current.account_id,async db=>{const row=(await db.query<CandidateJobRow>("UPDATE memory_generation_jobs SET state=$4,failure_code=$5,retryable=$6,lease_until=NULL,finished_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE id=$1 AND state='running' AND attempt_id=$2 AND dispatch_generation=$3 RETURNING *",[current.id,current.attempt_id,current.dispatch_generation,state,code,state==='failed'&&retryable&&current.attempt_count<3])).rows[0];if(row)await this.event(db,row,current.id);return !!row})
 }
 async complete(current:CandidateJobRow,title:string,body:string){
  const latest=await this.snapshot(current.account_id,current.person_id,current.source_message_id)
  if(!this.validAiAuthorization(current,latest)){await this.fail(current,'AI_PERMISSION_REQUIRED',false,'blocked');return false}
  if(!this.validSourceSnapshot(current,latest)){await this.fail(current,'SOURCE_CHANGED',false,'blocked');return false}
  return this.tx(current.account_id,async db=>{
   const active=(await db.query<CandidateJobRow>('SELECT * FROM memory_generation_jobs WHERE id=$1 FOR UPDATE',[current.id])).rows[0],now=(await db.query<{now:Date}>('SELECT clock_timestamp() AS now')).rows[0].now
   if(active.state!=='running'||active.attempt_id!==current.attempt_id||active.dispatch_generation!==current.dispatch_generation||active.lease_until!<=now)return false
   if(active.ai_authorization_version!==current.ai_authorization_version||!this.validAiAuthorization(active,latest)){await this.blockAi(db,active,current.id);return false}
   const candidate=(await db.query<CandidateRow>("INSERT INTO memory_candidates(account_id,person_id,generation_job_id,source_message_id,source_version,context_refs,title,body,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp()+interval '24 hours') RETURNING *",[current.account_id,current.person_id,current.id,current.source_message_id,current.source_version,JSON.stringify(current.context_refs),title,body])).rows[0]
   const done=(await db.query<CandidateJobRow>("UPDATE memory_generation_jobs SET state='succeeded',candidate_id=$2,lease_until=NULL,retryable=false,finished_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE id=$1 RETURNING *",[current.id,candidate.id])).rows[0];await this.event(db,done,current.id);return true
  })
 }
 async release(current:CandidateJobRow){
  return this.tx(current.account_id,async db=>{const row=(await db.query<CandidateJobRow>("UPDATE memory_generation_jobs SET state='queued',lease_until=NULL,started_at=NULL,attempt_id=NULL,queued_at=clock_timestamp(),run_after=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE id=$1 AND state='running' AND attempt_id=$2 AND dispatch_generation=$3 RETURNING *",[current.id,current.attempt_id,current.dispatch_generation])).rows[0];if(row)await this.event(db,row,current.id)})
 }
 async reconcileDeliveries(){
  const rows=(await this.pool.query<CandidateJobRow>("SELECT * FROM memory_generation_jobs WHERE (state='queued' AND updated_at<clock_timestamp()-interval '70 seconds') OR (state='running' AND lease_until<=clock_timestamp()) ORDER BY updated_at LIMIT 50")).rows
  for(const previous of rows)await this.tx(previous.account_id,async db=>{
   const row=(await db.query<CandidateJobRow>('SELECT * FROM memory_generation_jobs WHERE id=$1 FOR UPDATE',[previous.id])).rows[0];if(!row||!['queued','running'].includes(row.state)||row.version!==previous.version||!this.queue.isPending)return
   if(await this.queue.isPending(db,{jobId:row.id,dispatchId:row.dispatch_id,dispatchGeneration:row.dispatch_generation}))return
   const failed=(await db.query<CandidateJobRow>("UPDATE memory_generation_jobs SET state='failed',failure_code='DELIVERY_EXHAUSTED',retryable=$2,lease_until=NULL,finished_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE id=$1 RETURNING *",[row.id,row.attempt_count<3])).rows[0];await this.event(db,failed,row.id)
  })
 }
}
