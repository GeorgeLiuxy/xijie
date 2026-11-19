import {sharedAvailable} from './shared-contributions.js'
import type {PoolClient} from 'pg'
import {MemoryError,invalid,notFound,unavailable,uuid} from './contracts.js'
import {validPurposeContext,type AccountContext,type PersonContext} from './dependencies.js'
import type {MemoryRow,MemoryStore} from './store.js'

type Ref={id:string;version:number}
export type SocialMemoryEvent={eventId:string;accountId:string;personId:string;memoryId:string;sourceVersion:number;change:'upsert'|'remove';echoAiAuthorizationVersion:number;occurredAt:string}
const integer=(value:unknown,min=1):value is number=>Number.isSafeInteger(value)&&Number(value)>=min&&Number(value)<=2147483647
const changed=()=>new MemoryError(409,'SOURCE_CHANGED','The confirmed original changed.')
export function socialEventQuery(query:Record<string,unknown>){
 if(Object.keys(query).some(key=>!['accountIds','limit'].includes(key))||typeof query.accountIds!=='string')throw invalid()
 const accountIds=query.accountIds.split(',').map(value=>value.toLowerCase())
 if(!accountIds.length||accountIds.length>100||accountIds.some(value=>!uuid.test(value))||new Set(accountIds).size!==accountIds.length)throw invalid()
 if(query.limit!==undefined&&(typeof query.limit!=='string'||!/^[1-9][0-9]{0,2}$/.test(query.limit)))throw invalid()
 const limit=query.limit===undefined?50:Number(query.limit);if(limit>100)throw invalid()
 return {accountIds,limit}
}
export function socialSourceVersions(query:Record<string,unknown>){
 if(Object.keys(query).length!==2||typeof query.expectedVersion!=='string'||typeof query.expectedAiVersion!=='string')throw invalid()
 const parse=(value:string)=>/^[1-9][0-9]{0,9}$/.test(value)&&Number(value)<=2147483647?Number(value):undefined
 const expectedVersion=parse(query.expectedVersion),expectedAiVersion=parse(query.expectedAiVersion)
 if(expectedVersion===undefined||expectedAiVersion===undefined)throw invalid()
 return {expectedVersion,expectedAiVersion}
}
export function socialRefs(body:unknown):Ref[]{
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||!('refs' in body)||!Array.isArray(body.refs)||body.refs.length>64)throw invalid()
 const refs=body.refs as unknown[]
 if(refs.some(ref=>!ref||typeof ref!=='object'||Array.isArray(ref)||Object.keys(ref).length!==2||!('id' in ref)||typeof ref.id!=='string'||!uuid.test(ref.id)||!('version' in ref)||!integer(ref.version)))throw invalid()
 const normalized=(refs as Ref[]).map(ref=>({id:ref.id.toLowerCase(),version:ref.version}));if(new Set(normalized.map(ref=>ref.id)).size!==normalized.length)throw invalid()
 return normalized
}
export function emptySocialBody(body:unknown){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)throw invalid()}

export class SocialMemorySources{
 constructor(readonly store:MemoryStore){}
 private async read<T>(accountId:string,run:(db:PoolClient)=>Promise<T>){
  const db=await this.store.pool.connect()
  try{
   await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
   if((await db.query('SELECT 1 FROM memory_account_write_gates WHERE account_id=$1 AND erased_at IS NOT NULL',[accountId])).rowCount)throw notFound()
   const result=await run(db);await db.query('COMMIT');return result
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
 }
 private async authority(accountId:string,personId:string,expectedAiVersion?:number){
  const [account,person]=await Promise.all([this.store.dependencies.account(accountId),this.store.dependencies.person(accountId,personId)])
  if(account.accountId!==accountId||account.status!=='active'||person.accountId!==accountId||person.id!==personId||person.status!=='active'||!integer(account.accessVersion)||!integer(person.accessVersion)||!integer(person.version))throw notFound()
  if(expectedAiVersion!==undefined){
   if(!validPurposeContext(account.storyStorage)||!validPurposeContext(account.aiTextProcessing))throw unavailable()
   if(!account.storyStorage.allowed||account.storyStorage.privateFeedAllowed!==true)throw new MemoryError(403,'STORAGE_PERMISSION_REQUIRED','Permission for private text feed is required.')
   if(!account.aiTextProcessing.allowed||account.aiTextProcessing.privateFeedProcessingAllowed!==true||account.aiTextProcessing.authorizationVersion!==expectedAiVersion)throw new MemoryError(403,'AI_PERMISSION_REQUIRED','Permission for this AI feed purpose is required.')
  }
  return {account,person}
 }
 private same(before:{account:AccountContext;person:PersonContext},after:{account:AccountContext;person:PersonContext},full=false){
  if(before.account.accessVersion!==after.account.accessVersion||before.person.accessVersion!==after.person.accessVersion)throw notFound()
  if(full&&(before.person.version!==after.person.version||before.account.storyStorage.authorizationVersion!==after.account.storyStorage.authorizationVersion||before.account.aiTextProcessing.authorizationVersion!==after.account.aiTextProcessing.authorizationVersion))throw changed()
 }
 async events(accountIds:string[],limit=50):Promise<SocialMemoryEvent[]>{
  if(!accountIds.length||accountIds.length>100||accountIds.some(id=>!uuid.test(id))||new Set(accountIds).size!==accountIds.length||!integer(limit)||limit>100)throw invalid()
  const rows=(await this.store.pool.query<{event_id:string;account_id:string;aggregate_id:string;aggregate_version:number;type:string;occurred_at:Date;payload:{personId?:string;echoAiAuthorizationVersion?:number}}>(`SELECT e.event_id,e.account_id,e.aggregate_id,e.aggregate_version,e.type,e.occurred_at,e.payload
   FROM outbox_events e WHERE e.account_id=ANY($1::uuid[]) AND e.type IN ('MemoryConfirmed.v1','MemoryUpdated.v1','MemoryRemoved.v1')
   AND NOT EXISTS(SELECT 1 FROM social_memory_event_acks a WHERE a.event_id=e.event_id)
   AND NOT EXISTS(SELECT 1 FROM memory_account_write_gates g WHERE g.account_id=e.account_id AND g.erased_at IS NOT NULL)
   ORDER BY e.occurred_at,e.event_id LIMIT $2`,[accountIds,limit])).rows
  return rows.map(row=>{
   const version=row.type==='MemoryRemoved.v1'?0:row.payload.echoAiAuthorizationVersion??0
   if(!row.payload.personId||!uuid.test(row.payload.personId)||!integer(row.aggregate_version)||!integer(version,0))throw unavailable()
   return {eventId:row.event_id,accountId:row.account_id,personId:row.payload.personId,memoryId:row.aggregate_id,sourceVersion:row.aggregate_version,change:row.type==='MemoryRemoved.v1'?'remove':'upsert',echoAiAuthorizationVersion:version,occurredAt:row.occurred_at.toISOString()}
  })
 }
 async ack(eventId:string){
  const db=await this.store.pool.connect()
  try{
   await db.query('BEGIN')
   const event=(await db.query<{account_id:string}>("SELECT account_id FROM outbox_events WHERE event_id=$1 AND type IN ('MemoryConfirmed.v1','MemoryUpdated.v1','MemoryRemoved.v1')",[eventId])).rows[0]
   if(!event)throw notFound()
   const gate=(await db.query<{erased_at:Date|null}>(`INSERT INTO memory_account_write_gates(account_id) VALUES($1) ON CONFLICT(account_id) DO UPDATE SET account_id=EXCLUDED.account_id RETURNING erased_at`,[event.account_id])).rows[0]
   if(gate.erased_at)throw notFound()
   if(!(await db.query('SELECT event_id FROM outbox_events WHERE account_id=$1 AND event_id=$2 FOR SHARE',[event.account_id,eventId])).rowCount)throw notFound()
   await db.query('INSERT INTO social_memory_event_acks(event_id,account_id) VALUES($1,$2) ON CONFLICT(event_id) DO NOTHING',[eventId,event.account_id])
   await db.query('COMMIT');return {eventId}
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
 }
 async context(accountId:string,personId:string,id:string,expectedVersion:number,expectedAiVersion:number){
  if(!integer(expectedVersion)||!integer(expectedAiVersion))throw invalid()
  const before=await this.authority(accountId,personId,expectedAiVersion)
  const get=()=>this.read(accountId,async db=>{
   const row=(await db.query<MemoryRow>('SELECT * FROM memories WHERE account_id=$1 AND person_id=$2 AND id=$3 AND removed_at IS NULL',[accountId,personId,id])).rows[0]
   if(!row)throw notFound();if(row.version!==expectedVersion)throw changed()
   const event=(await db.query<{version:unknown}>(`SELECT payload->'echoAiAuthorizationVersion' AS version FROM outbox_events
    WHERE account_id=$1 AND aggregate_id=$2 AND aggregate_version=$3 AND type IN ('MemoryConfirmed.v1','MemoryUpdated.v1')`,[accountId,id,expectedVersion])).rows[0]
   // Regrant can authorize a new comment on a legitimate old echo, but cannot
   // turn a version originally saved without this purpose into a model source.
   if(!event||!integer(event.version))throw new MemoryError(403,'AI_PERMISSION_REQUIRED','This original version was not confirmed for AI feed processing.')
   return {accountId,personId,id:row.id,title:row.title,body:row.body,origin:row.origin,version:row.version,confirmedAt:row.confirmed_at.toISOString(),updatedAt:row.updated_at.toISOString()}
  })
  const sharedCheck=async()=>{const rows=(await this.store.pool.query<MemoryRow>('SELECT * FROM memories WHERE account_id=$1 AND person_id=$2 AND id=$3 AND removed_at IS NULL',[accountId,personId,id])).rows;if(!(await sharedAvailable(this.store.dependencies,rows)).length)throw notFound()}
  await sharedCheck()
  const source=await get(),after=await this.authority(accountId,personId,expectedAiVersion)
  this.same(before,after,true)
  await get();await sharedCheck()
  return source
 }
 async validate(accountId:string,personId:string,refs:Ref[]){
  const before=await this.authority(accountId,personId)
  const select=async()=>{const rows=await this.read(accountId,async db=>(await db.query<MemoryRow>('SELECT * FROM memories WHERE account_id=$1 AND person_id=$2 AND id=ANY($3::uuid[]) AND removed_at IS NULL ORDER BY id',[accountId,personId,refs.map(ref=>ref.id)])).rows.filter(row=>refs.some(ref=>ref.id===row.id&&ref.version===row.version)));return(await sharedAvailable(this.store.dependencies,rows)).map(row=>({id:row.id,version:row.version}))}
  const valid=await select(),after=await this.authority(accountId,personId)
  this.same(before,after)
  const latest=await select(),keys=new Set(latest.map(ref=>ref.id+':'+ref.version))
  return {personId,valid:valid.filter(ref=>keys.has(ref.id+':'+ref.version))}
 }
}
