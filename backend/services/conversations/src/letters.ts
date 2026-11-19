import {createHash,randomUUID} from 'node:crypto'
import type {Pool,PoolClient} from 'pg'
import {ConversationError,invalid,notFound,uuid,type JobState} from './contracts.js'
import type {AccountContext,ContextProvider,PersonContext} from './dependencies.js'
import type {QueueSender} from './store.js'
import {decodeVirtualWorldContext,sameVirtualWorldUse,virtualWorldUse,type VirtualWorldContext} from './virtual-world.js'
import {letterOutput,type LetterProvenance} from './letter-provider.js'

type LetterMemoryRef={id:string;version:number}
export type LetterInput={clientLetterId:string;body:string;replyMode:'none'|'now'|'next_morning';timeZone?:string;sourceMemory?:LetterMemoryRef}
export type Letter={id:string;personId:string;clientLetterId:string;body:string;replyMode:LetterInput['replyMode'];timeZone?:string;sourceMemory?:LetterMemoryRef;replyAt?:string;replyJobId?:string;replyJobState?:JobState;failure?:{code:string;retryable:boolean};reply?:{id:string;body:string;sequence:string;createdAt:string;aiGenerated:true};createdAt:string;version:number;unread:boolean}
type UnreadLetterReply={personId:string;letterId:string;createdAt:string}
export function letterInput(body:unknown):LetterInput{
 if(!body||typeof body!=='object'||Array.isArray(body))throw invalid()
 const v=body as Record<string,unknown>
 if(Object.keys(v).some(k=>!['clientLetterId','body','replyMode','timeZone','sourceMemory'].includes(k))||typeof v.clientLetterId!=='string'||!uuid.test(v.clientLetterId)||typeof v.body!=='string'||v.body.includes('\0')||/\p{Surrogate}/u.test(v.body)||typeof v.replyMode!=='string'||!['none','now','next_morning'].includes(v.replyMode))throw invalid()
 const text=v.body.trim();if(!text||[...text].length>10000)throw invalid()
 let timeZone:string|undefined
 if(v.replyMode==='next_morning'){
  if(typeof v.timeZone!=='string'||v.timeZone.length>100||!/^[A-Za-z][A-Za-z0-9_+./-]*$/.test(v.timeZone))throw invalid()
  try{timeZone=new Intl.DateTimeFormat('en',{timeZone:v.timeZone}).resolvedOptions().timeZone}catch{throw invalid()}
 }else if(v.timeZone!==undefined)throw invalid()
 let sourceMemory:LetterMemoryRef|undefined
 if(v.sourceMemory!==undefined){
  const ref=v.sourceMemory as Partial<LetterMemoryRef>|null
  if(!ref||typeof ref!=='object'||Array.isArray(ref)||Object.keys(ref).length!==2||typeof ref.id!=='string'||!uuid.test(ref.id)||typeof ref.version!=='number'||!Number.isInteger(ref.version)||ref.version<1||ref.version>2147483647)throw invalid()
  sourceMemory={id:ref.id.toLowerCase(),version:ref.version}
 }
 return{clientLetterId:v.clientLetterId.toLowerCase(),body:text,replyMode:v.replyMode as LetterInput['replyMode'],...(timeZone?{timeZone}:{}),...(sourceMemory?{sourceMemory}:{})}
}
export function throughReply(body:unknown){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||typeof(body as {throughReplyId?:unknown}).throughReplyId!=='string'||!uuid.test((body as {throughReplyId:string}).throughReplyId))throw invalid()
 return(body as {throughReplyId:string}).throughReplyId.toLowerCase()
}
export type LetterRow={id:string;account_id:string;person_id:string;client_letter_id:string;request_hash:string;body:string;reply_mode:LetterInput['replyMode'];time_zone:string|null;source_memory_id:string|null;source_memory_version:number|null;reply_at:Date|null;reply_job_id:string|null;account_access_version:number;storage_authorization_version:number;story_authorization_version:number|null;reply_authorization_version:number|null;version:number;created_at:Date;updated_at:Date;removed_at:Date|null}
export type LetterJob={id:string;account_id:string;person_id:string;letter_id:string;source_version:number;state:JobState;version:number;attempt_id:string|null;attempt_count:number;lease_until:Date|null;scheduled_at:Date;next_attempt_at:Date;failure_code:string|null;retryable:boolean;reply_id:string|null;person_context_ref:unknown;world_context_ref:unknown;provider_provenance:LetterProvenance|null;created_at:Date;updated_at:Date}
type ReadRow=LetterRow&{job_state:JobState|null;job_version:number|null;failure_code:string|null;retryable:boolean|null;reply:Letter['reply']|null;last_read_sequence:string}
type Access={account:AccountContext;person:PersonContext}
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
const changed=()=>new ConversationError(409,'SOURCE_CHANGED','The letter source changed. Read the current letters again.')
const memoryChanged=()=>new ConversationError(409,'LETTER_MEMORY_SOURCE_CHANGED','The chosen memory is no longer available at that version.')
const storageDenied=()=>new ConversationError(403,'LETTER_STORAGE_PERMISSION_REQUIRED','Permission to save and read letters is required.')
const replyDenied=()=>new ConversationError(403,'LETTER_REPLY_PERMISSION_REQUIRED','Permission for this letter reply is required.')
const large=()=>new ConversationError(413,'LETTER_HISTORY_TOO_LARGE','The complete letter history exceeds the supported size.')
const personRef=(p:PersonContext)=>({id:p.id,version:p.version,accessVersion:p.accessVersion,worldId:p.worldId,worldVersion:p.worldVersion})
const memoryRef=(r:LetterRow)=>r.source_memory_id&&r.source_memory_version?{id:r.source_memory_id,version:r.source_memory_version}:undefined
function dto(r:ReadRow):Letter{const sourceMemory=memoryRef(r);return{id:r.id,personId:r.person_id,clientLetterId:r.client_letter_id,body:r.body,replyMode:r.reply_mode,...(r.time_zone?{timeZone:r.time_zone}:{}),...(sourceMemory?{sourceMemory}:{}),...(r.reply_at?{replyAt:r.reply_at.toISOString()}:{}),...(r.reply_job_id?{replyJobId:r.reply_job_id,replyJobState:r.job_state!}:{}),...(r.failure_code?{failure:{code:r.failure_code,retryable:r.retryable===true}}:{}),...(r.reply?{reply:r.reply}:{}),createdAt:r.created_at.toISOString(),version:r.version,unread:!!r.reply&&BigInt(r.reply.sequence)>BigInt(r.last_read_sequence)}}
const readSql=`SELECT l.*,j.state AS job_state,j.version AS job_version,j.failure_code,j.retryable,
 CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('id',r.id,'body',r.body,'sequence',r.sequence::text,'createdAt',to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'aiGenerated',true) END AS reply,
 COALESCE(c.last_read_sequence,0)::text AS last_read_sequence FROM letters l LEFT JOIN letter_reply_jobs j ON j.account_id=l.account_id AND j.id=l.reply_job_id
 LEFT JOIN letter_replies r ON r.account_id=l.account_id AND r.letter_id=l.id LEFT JOIN letter_read_cursors c ON c.account_id=l.account_id AND c.person_id=l.person_id
 WHERE l.account_id=$1 AND l.person_id=$2 AND l.removed_at IS NULL`

export class LetterStore{
 private auditCursor='00000000-0000-0000-0000-000000000000'
 constructor(readonly pool:Pool,readonly dependencies:ContextProvider,readonly queue:QueueSender){}
 private async tx<T>(accountId:string,work:(db:PoolClient)=>Promise<T>){const db=await this.pool.connect();try{await db.query('BEGIN');await db.query("SELECT pg_advisory_xact_lock(hashtextextended('xijie:conversations:erasure:'||$1,0))",[accountId]);if((await db.query('SELECT 1 FROM account_erasure_fences WHERE account_id=$1 AND erased_at IS NOT NULL',[accountId])).rowCount)throw notFound();const result=await work(db);await db.query('COMMIT');return result}catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}}
 async access(accountId:string,personId:string,storage=true,db:Pool|PoolClient=this.pool):Promise<Access>{
  // Identity follows the last People read, so withdrawal during that RPC cannot
  // leave an earlier allowed account snapshot as the final read authority.
  const person=await this.dependencies.person(accountId,personId),account=await this.dependencies.account(accountId)
  if(account.accountId!==accountId||account.status!=='active'||person.accountId!==accountId||person.id!==personId||person.status!=='active')throw notFound()
  if(storage&&account.letterStorage?.allowed!==true)throw storageDenied()
  if((await db.query('SELECT 1 FROM account_erasure_fences WHERE account_id=$1 AND erased_at IS NOT NULL',[accountId])).rowCount)throw notFound()
  return{account,person}
 }
 private async same(before:Access,storage=true,db:Pool|PoolClient=this.pool){
  const after=await this.access(before.account.accountId,before.person.id,storage,db)
  if(after.account.accessVersion!==before.account.accessVersion||after.person.version!==before.person.version||after.person.accessVersion!==before.person.accessVersion||storage&&after.account.letterStorage?.authorizationVersion!==before.account.letterStorage?.authorizationVersion)throw changed()
  return after
 }
 private replyPermission(account:AccountContext){if(account.letterReplies?.allowed!==true||!account.storyStorage.allowed)throw replyDenied()}
 private async validateSourceMemory(accountId:string,personId:string,ref:LetterMemoryRef){
  if(!this.dependencies.validateLetterMemory)throw new ConversationError(503,'DEPENDENCY_UNAVAILABLE','The chosen memory cannot be verified right now.')
  if(await this.dependencies.validateLetterMemory(accountId,personId,ref)!==true)throw memoryChanged()
 }
 private async event(db:PoolClient,type:string,accountId:string,id:string,version:number,payload:object,requestId:string){await db.query("INSERT INTO outbox_events(type,account_id,aggregate_type,aggregate_id,aggregate_version,request_id,payload) VALUES($1,$2,$3,$4,$5,$6,$7)",[type,accountId,type==='LetterGenerationChanged.v1'?'letter_reply_job':'letter',id,version,requestId,payload])}
 private async command<T>(db:PoolClient,a:string,operation:string,target:string,key:string,input:unknown,run:()=>Promise<T>):Promise<T>{
  const args=[a,operation,target,key],fingerprint=hash(input),prior=(await db.query('SELECT request_hash,response FROM conversation_commands WHERE account_id=$1 AND operation=$2 AND target=$3 AND idempotency_key=$4',args)).rows[0]
  if(prior){if(prior.request_hash!==fingerprint)throw new ConversationError(409,'IDEMPOTENCY_CONFLICT','The operation key has different input.');return prior.response}
  const result=await run();await db.query('INSERT INTO conversation_commands(account_id,operation,target,idempotency_key,request_hash,response) VALUES($1,$2,$3,$4,$5,$6)',[...args,fingerprint,JSON.stringify(result)]);return result
 }
 async schedule(db:PoolClient,mode:LetterInput['replyMode'],zone?:string,at?:Date){
  const accepted=at??(await db.query<{at:Date}>('SELECT clock_timestamp()::timestamptz(3) AS at')).rows[0].at
  if(mode!=='next_morning')return{accepted,replyAt:mode==='none'?null:accepted}
  if(!(await db.query('SELECT 1 FROM pg_timezone_names WHERE name=$1',[zone])).rowCount)throw invalid()
  const row=(await db.query<{at:Date}>(`WITH dates AS(SELECT (($1::timestamptz AT TIME ZONE $2)::date+n)::timestamp+interval '8 hours' AS local FROM generate_series(0,370)n), instants AS(SELECT local,local AT TIME ZONE $2 AS at FROM dates) SELECT at FROM instants WHERE at>$1 AND at AT TIME ZONE $2=local ORDER BY at LIMIT 1`,[accepted,zone])).rows[0]
  if(!row)throw invalid();return{accepted,replyAt:row.at}
 }
 async create(accountId:string,personId:string,key:string,input:LetterInput,requestId:string){
  const before=await this.access(accountId,personId)
  const id=await this.tx(accountId,async db=>this.command(db,accountId,'letter.create',personId,key,input,async()=>{
   const prior=(await db.query<LetterRow>('SELECT * FROM letters WHERE account_id=$1 AND person_id=$2 AND client_letter_id=$3',[accountId,personId,input.clientLetterId])).rows[0]
   if(prior){if(prior.request_hash!==hash(input))throw new ConversationError(409,'IDEMPOTENCY_CONFLICT','The letter ID has different input.');return prior.id}
   if(input.replyMode!=='none')this.replyPermission(before.account)
   const linked=input.sourceMemory
   if(linked){
    if(before.account.storyStorage.allowed!==true)throw memoryChanged()
    await this.validateSourceMemory(accountId,personId,linked)
    const current=(await this.same(before,true,db)).account
    if(current.storyStorage.allowed!==true||current.storyStorage.authorizationVersion!==before.account.storyStorage.authorizationVersion)throw memoryChanged()
    if(input.replyMode!=='none'){
     this.replyPermission(current)
     if(current.letterReplies!.authorizationVersion!==before.account.letterReplies!.authorizationVersion)throw replyDenied()
    }
   }
   const{id:aid}= {id:randomUUID()},jobId=input.replyMode==='none'?null:randomUUID(),{accepted,replyAt}=await this.schedule(db,input.replyMode,input.timeZone)
   await db.query(`INSERT INTO letters(id,account_id,person_id,client_letter_id,request_hash,body,reply_mode,time_zone,reply_at,reply_job_id,account_access_version,storage_authorization_version,story_authorization_version,reply_authorization_version,created_at,updated_at,source_memory_id,source_memory_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15,$16,$17)`,[aid,accountId,personId,input.clientLetterId,hash(input),input.body,input.replyMode,input.timeZone??null,replyAt,jobId,before.account.accessVersion,before.account.letterStorage!.authorizationVersion,jobId?before.account.storyStorage.authorizationVersion:null,jobId?before.account.letterReplies!.authorizationVersion:null,accepted,linked?.id??null,linked?.version??null])
   if(jobId){await db.query('INSERT INTO letter_reply_jobs(id,account_id,person_id,letter_id,source_version,scheduled_at,next_attempt_at) VALUES($1,$2,$3,$4,1,$5,$5)',[jobId,accountId,personId,aid,replyAt]);await this.enqueue(db,jobId,replyAt!)}
   await this.event(db,'LetterAccepted.v1',accountId,aid,1,{letterId:aid,personId},requestId);return aid
  }))
  await this.same(before);return this.get(accountId,personId,id)
 }
 private async enqueue(db:PoolClient,id:string,at:Date){if(!this.queue.sendLetter)throw new Error('Letter queue is unavailable');await this.queue.sendLetter(db,id,randomUUID(),at)}
 async latestUnread(accountId:string):Promise<UnreadLetterReply|null>{
  const account=await this.dependencies.account(accountId)
  if(account.accountId!==accountId||account.status!=='active')throw notFound()
  if(account.letterStorage?.allowed!==true)throw storageDenied()
  const people=(await this.dependencies.persons(accountId)).filter(person=>person.accountId===accountId&&person.status==='active')
  const personIds=people.map(person=>person.id)
  if(!personIds.length)return null
  const read=async()=>{
   const result=await this.pool.query<{person_id:string;letter_id:string;created_at:Date}>(`SELECT r.person_id,r.letter_id,r.created_at
    FROM letter_replies r JOIN letters l ON l.account_id=r.account_id AND l.person_id=r.person_id AND l.id=r.letter_id
    LEFT JOIN letter_read_cursors c ON c.account_id=r.account_id AND c.person_id=r.person_id
    WHERE r.account_id=$1 AND r.person_id=ANY($2::uuid[]) AND l.removed_at IS NULL AND r.sequence>COALESCE(c.last_read_sequence,0)
     AND NOT EXISTS(SELECT 1 FROM account_erasure_fences f WHERE f.account_id=$1 AND f.erased_at IS NOT NULL)
    ORDER BY r.created_at DESC,r.id DESC LIMIT 1`,[accountId,personIds])
   const row=result.rows[0]
   return row?{personId:row.person_id,letterId:row.letter_id,createdAt:row.created_at.toISOString()}:null
  }
  const item=await read()
  if(!item)return null
  const person=people.find(value=>value.id===item.personId)!
  const latest=await this.access(accountId,person.id)
  if(latest.account.accessVersion!==account.accessVersion||latest.account.letterStorage?.authorizationVersion!==account.letterStorage.authorizationVersion||latest.person.accessVersion!==person.accessVersion||latest.person.version!==person.version)throw changed()
  const current=await read()
  if(!current||current.letterId!==item.letterId)throw changed()
  return current
 }
 async snapshot(accountId:string,personId:string){
  const before=await this.access(accountId,personId),db=await this.pool.connect();let rows:ReadRow[]
  try{await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const budget=(await db.query<{count:string;bytes:string}>(`SELECT count(*)::text AS count,COALESCE(sum(octet_length(l.body)+COALESCE(octet_length(r.body),0)),0)::text AS bytes FROM letters l LEFT JOIN letter_replies r ON r.account_id=l.account_id AND r.letter_id=l.id WHERE l.account_id=$1 AND l.person_id=$2 AND l.removed_at IS NULL`,[accountId,personId])).rows[0];if(Number(budget.count)>1000||Number(budget.bytes)>8*1024*1024)throw large();rows=(await db.query<ReadRow>(readSql+' ORDER BY l.created_at DESC,l.id DESC',[accountId,personId])).rows;await db.query('COMMIT')}catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
  const items=rows.map(dto);if(Buffer.byteLength(JSON.stringify(items))>8*1024*1024)throw large();await this.same(before)
  const versions=(await this.pool.query(`SELECT l.id,l.version,j.version AS job_version,c.last_read_sequence::text FROM letters l LEFT JOIN letter_reply_jobs j ON j.account_id=l.account_id AND j.id=l.reply_job_id LEFT JOIN letter_read_cursors c ON c.account_id=l.account_id AND c.person_id=l.person_id WHERE l.account_id=$1 AND l.person_id=$2 AND l.removed_at IS NULL ORDER BY l.created_at DESC,l.id DESC`,[accountId,personId])).rows
  if(hash(versions.map(r=>[r.id,r.version,r.job_version,r.last_read_sequence??'0']))!==hash(rows.map(r=>[r.id,r.version,r.job_version,r.last_read_sequence])))throw changed()
  return{items,revision:hash({items,jobs:rows.map(r=>[r.reply_job_id,r.job_version]),access:before.account.accessVersion,storage:before.account.letterStorage,person:[before.person.id,before.person.version,before.person.accessVersion]})}
 }
 async get(accountId:string,personId:string,id:string){const before=await this.access(accountId,personId),r=(await this.pool.query<ReadRow>(readSql+' AND l.id=$3',[accountId,personId,id])).rows[0];if(!r)throw notFound();await this.same(before);const fresh=(await this.pool.query<ReadRow>(readSql+' AND l.id=$3',[accountId,personId,id])).rows[0];if(!fresh)throw notFound();if(hash(r)!==hash(fresh))throw changed();return dto(r)}
 async read(accountId:string,personId:string,key:string,replyId:string){
  const before=await this.access(accountId,personId)
  await this.tx(accountId,async db=>this.command(db,accountId,'letter.read',personId,key,{throughReplyId:replyId},async()=>{
   const r=(await db.query<{id:string;sequence:string}>('SELECT r.id,r.sequence::text FROM letter_replies r JOIN letters l ON l.account_id=r.account_id AND l.id=r.letter_id WHERE r.account_id=$1 AND r.person_id=$2 AND r.id=$3 AND l.removed_at IS NULL',[accountId,personId,replyId])).rows[0];if(!r)throw notFound()
   await db.query('UPDATE letter_read_cursors SET last_read_sequence=$3,last_read_reply_id=$4,read_at=clock_timestamp() WHERE account_id=$1 AND person_id=$2 AND last_read_sequence<$3',[accountId,personId,r.sequence,r.id]);return{accepted:true}
  }))
  await this.same(before);const current=(await this.pool.query('SELECT last_read_reply_id,read_at FROM letter_read_cursors WHERE account_id=$1 AND person_id=$2',[accountId,personId])).rows[0];return{lastReadReplyId:current.last_read_reply_id,readAt:current.read_at.toISOString()}
 }
 async remove(accountId:string,personId:string,id:string,key:string,expected:number,requestId:string){
  const before=await this.access(accountId,personId,false)
  const result=await this.tx(accountId,db=>this.command(db,accountId,'letter.remove',id,key,{personId,expectedVersion:expected},async()=>{
   const row=(await db.query<LetterRow>('SELECT * FROM letters WHERE account_id=$1 AND person_id=$2 AND id=$3 FOR UPDATE',[accountId,personId,id])).rows[0];if(!row)throw notFound()
   if(row.version!==expected)throw new ConversationError(412,'VERSION_CONFLICT','The letter changed.',{currentVersion:row.version})
   if(row.removed_at)return{id:row.id,removedAt:row.removed_at.toISOString(),version:row.version}
   const next=(await db.query<LetterRow>('UPDATE letters SET removed_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *',[id])).rows[0]
   await db.query("UPDATE letter_reply_jobs SET state='canceled',attempt_id=NULL,version=version+1,lease_until=NULL,retryable=false,failure_code=NULL,updated_at=clock_timestamp() WHERE account_id=$1 AND letter_id=$2 AND state IN ('queued','running','failed','blocked')",[accountId,id])
   await this.event(db,'LetterRemoved.v1',accountId,id,next.version,{letterId:id,personId},requestId);return{id,removedAt:next.removed_at!.toISOString(),version:next.version}
  }));await this.same(before,false);return result
 }
 async find(id:string){return(await this.pool.query<LetterJob>('SELECT * FROM letter_reply_jobs WHERE id=$1',[id])).rows[0]??null}
 async claim(id:string){const found=await this.find(id);if(!found)return null;return this.tx(found.account_id,async db=>{
  const j=(await db.query<LetterJob&{due:boolean;live:boolean}>('SELECT *,next_attempt_at<=clock_timestamp() AS due,lease_until>clock_timestamp() AS live FROM letter_reply_jobs WHERE id=$1 FOR UPDATE',[id])).rows[0]
  if(!j||!['queued','running'].includes(j.state)||!j.due)return null;if(j.state==='running'&&j.live)throw new Error('Letter lease is active')
  if(j.attempt_count>=3){await db.query("UPDATE letter_reply_jobs SET state='failed',attempt_id=NULL,failure_code='ATTEMPTS_EXHAUSTED',retryable=false,lease_until=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=$1",[id]);return null}
  return(await db.query<LetterJob>("UPDATE letter_reply_jobs SET state='running',attempt_id=$2,attempt_count=attempt_count+1,lease_until=clock_timestamp()+interval '45 seconds',version=version+1,failure_code=NULL,retryable=false,updated_at=clock_timestamp() WHERE id=$1 RETURNING *",[id,randomUUID()])).rows[0]
 })}
 private async replyAccess(j:LetterJob,source:LetterRow,db:Pool|PoolClient=this.pool){
  const access=await this.access(j.account_id,j.person_id,true,db);this.replyPermission(access.account)
  if(access.account.accessVersion!==source.account_access_version||access.account.letterStorage!.authorizationVersion!==source.storage_authorization_version||access.account.storyStorage.authorizationVersion!==source.story_authorization_version||access.account.letterReplies!.authorizationVersion!==source.reply_authorization_version)throw new ConversationError(403,'AUTHORIZATION_CHANGED','The accepted letter authorization changed.')
  return access
 }
 async authority(j:LetterJob,checkMemory=false){
  const source=(await this.pool.query<LetterRow>('SELECT * FROM letters WHERE account_id=$1 AND person_id=$2 AND id=$3 AND removed_at IS NULL',[j.account_id,j.person_id,j.letter_id])).rows[0];if(!source||source.version!==j.source_version)throw notFound()
  let access=await this.replyAccess(j,source)
  const linked=checkMemory?memoryRef(source):undefined
  if(linked){await this.validateSourceMemory(j.account_id,j.person_id,linked);access=await this.replyAccess(j,source)}
  return{...access,source}
 }
 async world(j:LetterJob,person:PersonContext){if(!this.dependencies.virtualWorld)throw new ConversationError(503,'DEPENDENCY_UNAVAILABLE','The virtual world is unavailable.');const w=decodeVirtualWorldContext(await this.dependencies.virtualWorld(j.account_id,j.person_id),j.account_id,j.person_id);if(w.personVersion!==person.version||w.currentWorld.id!==person.worldId||w.worldVersion!==person.worldVersion)throw changed();return w}
 async capture(j:LetterJob,p:PersonContext,w:VirtualWorldContext){return this.tx(j.account_id,async db=>(await db.query("UPDATE letter_reply_jobs SET person_context_ref=$3,world_context_ref=$4 WHERE id=$1 AND state='running' AND attempt_id=$2 AND lease_until>clock_timestamp()",[j.id,j.attempt_id,personRef(p),virtualWorldUse(w)])).rowCount===1)}
 async complete(j:LetterJob,body:string,provenance:LetterProvenance,p:PersonContext,w:VirtualWorldContext){
  const text=letterOutput(body),current=await this.authority(j),latestWorld=await this.world(j,current.person)
  if(hash(personRef(current.person))!==hash(personRef(p))||!sameVirtualWorldUse(virtualWorldUse(w),latestWorld))throw changed()
  const final=await this.authority(j);if(hash(personRef(final.person))!==hash(personRef(p)))throw changed()
  if(provenance.provider!=='openai'||provenance.promptVersion!=='person-letter-replies-v1'||!provenance.model||provenance.model.length>200||provenance.responseId!==null&&(typeof provenance.responseId!=='string'||provenance.responseId.length>300))throw new Error('Invalid letter provenance')
  return this.tx(j.account_id,async db=>{
   const active=(await db.query<LetterJob>("SELECT * FROM letter_reply_jobs WHERE id=$1 AND state='running' AND attempt_id=$2 AND lease_until>clock_timestamp() FOR UPDATE",[j.id,j.attempt_id])).rows[0];if(!active)return false
   if(!(await db.query('SELECT id FROM letters WHERE account_id=$1 AND id=$2 AND version=$3 AND removed_at IS NULL FOR SHARE',[j.account_id,j.letter_id,j.source_version])).rowCount)return false
   const linked=memoryRef(final.source)
   if(linked){
    await this.validateSourceMemory(j.account_id,j.person_id,linked)
    const latest=await this.replyAccess(j,final.source,db)
    if(hash(personRef(latest.person))!==hash(personRef(p)))throw changed()
    if(!(await db.query('SELECT 1 FROM letter_reply_jobs WHERE id=$1 AND lease_until>clock_timestamp()',[j.id])).rowCount)return false
   }
   await db.query('INSERT INTO letter_read_cursors(account_id,person_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[j.account_id,j.person_id])
   const seq=(await db.query<{last_sequence:string}>('UPDATE letter_read_cursors SET last_sequence=last_sequence+1 WHERE account_id=$1 AND person_id=$2 RETURNING last_sequence::text',[j.account_id,j.person_id])).rows[0].last_sequence,id=randomUUID()
   await db.query('INSERT INTO letter_replies(id,account_id,person_id,letter_id,job_id,sequence,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,j.account_id,j.person_id,j.letter_id,j.id,seq,text])
   await db.query("UPDATE letter_reply_jobs SET state='succeeded',attempt_id=NULL,reply_id=$3,lease_until=NULL,version=version+1,failure_code=NULL,retryable=false,provider_provenance=$4,person_context_ref=$5,world_context_ref=$6,updated_at=clock_timestamp() WHERE id=$1 AND attempt_id=$2",[j.id,j.attempt_id,id,provenance,personRef(p),virtualWorldUse(w)])
   const l=(await db.query<LetterRow>('UPDATE letters SET version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *',[j.letter_id])).rows[0]
   await this.event(db,'LetterReplyCommitted.v1',j.account_id,j.letter_id,l.version,{letterId:j.letter_id,personId:j.person_id,replyId:id,jobId:j.id,sequence:seq},j.id);return true
  })
 }
 async fail(j:LetterJob,code:string,retryable:boolean,blocked=false){return this.tx(j.account_id,async db=>{
  const retry=retryable&&j.attempt_count<3&&!blocked
  const row=(await db.query<LetterJob>(`UPDATE letter_reply_jobs SET state=$3,attempt_id=NULL,lease_until=NULL,failure_code=$4,retryable=$5,next_attempt_at=GREATEST(scheduled_at,clock_timestamp()+interval '5 seconds'*attempt_count),version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='running' AND attempt_id=$2 RETURNING *`,[j.id,j.attempt_id,retry?'queued':blocked?'blocked':'failed',!retry&&retryable?'ATTEMPTS_EXHAUSTED':code,retry])).rows[0]
  if(row){if(retry)await this.enqueue(db,row.id,row.next_attempt_at);await this.event(db,'LetterGenerationChanged.v1',j.account_id,j.id,row.version,{jobId:j.id,letterId:j.letter_id,state:row.state},j.id)}
 })}
 async reconcile(){
  // Round-robin through future schedules as well. Revocation must stop a queued
  // letter promptly; it must not wait until tomorrow merely to avoid a model call.
  let audit=(await this.pool.query<LetterJob>("SELECT * FROM letter_reply_jobs WHERE state IN ('queued','running') AND id>$1 ORDER BY id LIMIT 50",[this.auditCursor])).rows
  if(!audit.length){this.auditCursor='00000000-0000-0000-0000-000000000000';audit=(await this.pool.query<LetterJob>("SELECT * FROM letter_reply_jobs WHERE state IN ('queued','running') ORDER BY id LIMIT 50")).rows}
  for(const j of audit){this.auditCursor=j.id;try{await this.authority(j,true)}catch(error){
   if(!(error instanceof ConversationError)||(![401,403,404].includes(error.status)&&error.code!=='LETTER_MEMORY_SOURCE_CHANGED'))continue
   try{await this.tx(j.account_id,async db=>{const row=(await db.query<LetterJob>("UPDATE letter_reply_jobs SET state='blocked',attempt_id=NULL,lease_until=NULL,failure_code=$4,retryable=false,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$2 AND attempt_id IS NOT DISTINCT FROM $3::uuid AND state IN ('queued','running') RETURNING *",[j.id,j.version,j.attempt_id,error.code])).rows[0];if(row)await this.event(db,'LetterGenerationChanged.v1',j.account_id,j.id,row.version,{jobId:j.id,letterId:j.letter_id,state:'blocked'},j.id)})}catch(e){if(!(e instanceof ConversationError&&e.status===404))throw e}
  }}
  const candidates=(await this.pool.query<LetterJob>("SELECT * FROM letter_reply_jobs WHERE (state='running' AND lease_until<=clock_timestamp()) OR(state='queued' AND next_attempt_at<=clock_timestamp() AND updated_at<clock_timestamp()-interval '2 minutes') ORDER BY updated_at LIMIT 50")).rows
  for(const j of candidates){if(j.state==='running'){await this.fail(j,'WORKER_INTERRUPTED',true);continue}
   await this.tx(j.account_id,async db=>{const current=(await db.query<LetterJob>("SELECT * FROM letter_reply_jobs WHERE id=$1 AND state='queued' FOR UPDATE",[j.id])).rows[0];if(!current)return;if(!this.queue.isLetterPending)throw new Error('Letter queue inspection unavailable');if(!await this.queue.isLetterPending(db,j.id)){await this.enqueue(db,j.id,current.next_attempt_at);await db.query('UPDATE letter_reply_jobs SET updated_at=clock_timestamp() WHERE id=$1',[j.id])}})
  }
 }
}
