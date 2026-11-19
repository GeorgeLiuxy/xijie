import type {Pool} from 'pg'
import type {ContextProvider} from './dependencies.js'
import {ConversationError,invalid,notFound,uuid} from './contracts.js'
import {SELF_HARM_SUPPORT_REQUIRED} from './conversation-safety.js'

export type SourceEvent={eventId:string;accountId:string;personId:string;sourceKind:'message';sourceId:string;sourceVersion:number;change:'upsert'|'remove';occurredAt:string}
export type SourceReference={id:string;version:number}
type Row={id:string;account_id:string;person_id:string;conversation_id:string;text:string;version:number;created_at:Date;sequence:string;ai_authorization_version:number}
type ContextRow={id:string;version:number;author_kind:'self'|'persona';text:string;created_at:Date}
// Classification is part of source eligibility, not an eventual cleanup step.
// New pipeline text remains private to that pipeline until a successful plain
// chat decision with no event lineage. Failed/unknown decisions are not chat.
const automaticSourceEligible=`m.source_domain='private_text' AND j.failure_code IS DISTINCT FROM '${SELF_HARM_SUPPORT_REQUIRED}' AND j.world_event_context_refs='[]'::jsonb AND
 ((j.world_action_authorization_version IS NULL AND j.world_action_decision IS NULL)
  OR(j.world_action_authorization_version>0 AND j.world_action_decision='chat' AND j.state='succeeded'))`
export function automaticEventQuery(query:Record<string,unknown>){
 if(Object.keys(query).some(key=>!['accountIds','limit'].includes(key))||typeof query.accountIds!=='string')throw invalid()
 const accounts=query.accountIds.split(',')
 if(!accounts.length||accounts.length>100||accounts.some(id=>!uuid.test(id))||new Set(accounts.map(id=>id.toLowerCase())).size!==accounts.length)throw invalid()
 if(query.limit!==undefined&&(typeof query.limit!=='string'||!/^[1-9][0-9]{0,2}$/.test(query.limit)))throw invalid()
 const limit=query.limit===undefined?50:Number(query.limit)
 if(limit>100)throw invalid()
 return {accountIds:accounts.map(id=>id.toLowerCase()),limit}
}
export function automaticReferences(body:unknown){
 if(!body||typeof body!=='object'||Array.isArray(body))throw invalid()
 const value=body as {personId:unknown;refs:unknown}
 if(Object.keys(value).some(key=>!['personId','refs'].includes(key))||typeof value.personId!=='string'||!uuid.test(value.personId)||!Array.isArray(value.refs)||value.refs.length>64)throw invalid()
 const refs=value.refs.map(reference=>{
  if(!reference||typeof reference!=='object'||Array.isArray(reference))throw invalid()
  const ref=reference as SourceReference
  if(Object.keys(ref).some(key=>!['id','version'].includes(key))||typeof ref.id!=='string'||!uuid.test(ref.id)||!Number.isSafeInteger(ref.version)||ref.version<1||ref.version>2147483647)throw invalid()
  return {id:ref.id.toLowerCase(),version:ref.version}
 })
 if(new Set(refs.map(ref=>ref.id)).size!==refs.length)throw invalid()
 return {personId:value.personId.toLowerCase(),refs}
}
export function emptyAutomaticBody(body:unknown){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)throw invalid()}

export class AutomaticSourceStore{
 constructor(readonly pool:Pool,readonly dependencies:ContextProvider){}
 async events(accountIds:string[],limit=50):Promise<SourceEvent[]>{
  const result=await this.pool.query<{event_id:string;account_id:string;person_id:string;aggregate_id:string;aggregate_version:number;type:string;occurred_at:Date}>(
   `SELECT e.event_id,e.account_id,c.person_id,e.aggregate_id,e.aggregate_version,e.type,e.occurred_at
    FROM outbox_events e JOIN messages m ON m.account_id=e.account_id AND m.id=e.aggregate_id
    JOIN conversations c ON c.account_id=m.account_id AND c.id=m.conversation_id
    JOIN generation_jobs j ON j.account_id=m.account_id AND j.conversation_id=m.conversation_id AND j.id=m.generation_job_id
    WHERE m.conversation_kind='direct' AND m.kind='text' AND m.photo_reply_job_id IS NULL AND e.account_id=ANY($1::uuid[]) AND e.type IN ('MessageAccepted.v1','MessageRemoved.v1')
      AND ${automaticSourceEligible}
      AND (e.type='MessageRemoved.v1' OR m.author_kind='self')
      AND NOT EXISTS(SELECT 1 FROM automatic_memory_event_acks a WHERE a.event_id=e.event_id)
    ORDER BY e.occurred_at,e.event_id LIMIT $2`,[accountIds,limit])
  return result.rows.map(row=>({eventId:row.event_id,accountId:row.account_id,personId:row.person_id,sourceKind:'message',sourceId:row.aggregate_id,sourceVersion:row.aggregate_version,change:row.type==='MessageRemoved.v1'?'remove':'upsert',occurredAt:row.occurred_at.toISOString()}))
 }
 async ack(eventId:string){
  const db=await this.pool.connect()
  try{
   await db.query('BEGIN')
   const event=(await db.query<{account_id:string}>("SELECT account_id FROM outbox_events WHERE event_id=$1 AND type IN ('MessageAccepted.v1','MessageRemoved.v1')",[eventId])).rows[0]
   if(!event)throw notFound()
   await db.query("SELECT pg_advisory_xact_lock(hashtextextended('xijie:conversations:erasure:' || $1,0))",[event.account_id])
   if((await db.query('SELECT 1 FROM account_erasure_fences WHERE account_id=$1 AND erased_at IS NOT NULL',[event.account_id])).rowCount)throw notFound()
   const present=await db.query('SELECT event_id FROM outbox_events WHERE event_id=$1 AND account_id=$2 FOR SHARE',[eventId,event.account_id])
   if(!present.rowCount)throw notFound()
   await db.query('INSERT INTO automatic_memory_event_acks(event_id,account_id) VALUES($1,$2) ON CONFLICT(event_id) DO NOTHING',[eventId,event.account_id])
   await db.query('COMMIT');return {eventId}
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
 }
 private async access(accountId:string,personId:string,requiresStorage=true){
  const [account,person]=await Promise.all([this.dependencies.account(accountId),this.dependencies.person(accountId,personId)])
  if(account.accountId!==accountId||account.status!=='active'||person.accountId!==accountId||person.id!==personId||person.status!=='active')throw notFound()
  if((await this.pool.query('SELECT 1 FROM account_erasure_fences WHERE account_id=$1 AND erased_at IS NOT NULL',[accountId])).rowCount)throw notFound()
  if(requiresStorage&&!account.storyStorage.allowed)throw new ConversationError(403,'FORBIDDEN','Reading this information is not permitted.')
  return {account,person}
 }
 async source(accountId:string,id:string){
  const row=(await this.pool.query<Row>(`SELECT m.id,m.account_id,c.person_id,m.conversation_id,m.text,m.version,m.created_at,m.sequence,j.ai_authorization_version
   FROM messages m JOIN conversations c ON c.account_id=m.account_id AND c.id=m.conversation_id
   JOIN generation_jobs j ON j.account_id=m.account_id AND j.conversation_id=m.conversation_id AND j.id=m.generation_job_id AND j.source_message_id=m.id
   WHERE m.conversation_kind='direct' AND m.kind='text' AND m.photo_reply_job_id IS NULL AND m.account_id=$1 AND m.id=$2 AND m.author_kind='self' AND m.removed_at IS NULL
    AND ${automaticSourceEligible}`,[accountId,id])).rows[0]
  if(!row)throw notFound()
  await this.access(accountId,row.person_id)
  const context=(await this.pool.query<ContextRow>(`SELECT m.id,m.version,m.author_kind,m.text,m.created_at FROM messages m
   JOIN generation_jobs j ON j.account_id=m.account_id AND j.conversation_id=m.conversation_id AND j.id=m.generation_job_id AND
    ((m.author_kind='self' AND j.source_message_id=m.id) OR (m.author_kind='persona' AND j.id=m.generation_job_id))
   WHERE m.conversation_kind='direct' AND m.kind='text' AND m.photo_reply_job_id IS NULL AND m.account_id=$1 AND m.conversation_id=$2 AND m.sequence<$3 AND m.removed_at IS NULL
    AND j.ai_authorization_version=$4 AND ${automaticSourceEligible}
    AND (m.author_kind='self' OR EXISTS(SELECT 1 FROM messages parent WHERE parent.account_id=m.account_id
      AND parent.conversation_id=m.conversation_id AND parent.id=m.reply_to_message_id AND parent.removed_at IS NULL))
   ORDER BY m.sequence DESC LIMIT 6`,[accountId,row.conversation_id,row.sequence,row.ai_authorization_version])).rows.reverse()
  const refs=[{id:row.id,version:row.version},...context.map(item=>({id:item.id,version:item.version}))]
  const checked=await this.validate(accountId,row.person_id,refs,true)
  if(checked.valid.length!==refs.length)throw notFound()
  return {id:row.id,accountId,personId:row.person_id,conversationId:row.conversation_id,sequence:row.sequence,text:row.text,version:row.version,createdAt:row.created_at.toISOString(),aiAuthorizationVersion:row.ai_authorization_version,
   context:context.map(item=>({id:item.id,version:item.version,authorKind:item.author_kind,text:item.text,createdAt:item.created_at.toISOString()}))}
 }
 // ID/version visibility checks disclose no source text and remain available for
 // withdrawal propagation and data-rights work after the storage purpose is revoked.
 async validate(accountId:string,personId:string,refs:SourceReference[],requiresStorage=false){
  await this.access(accountId,personId,requiresStorage)
  if(!refs.length)return {personId,valid:[]}
  const rows=(await this.pool.query<{id:string;version:number}>(`SELECT m.id,m.version FROM messages m JOIN conversations c ON c.account_id=m.account_id AND c.id=m.conversation_id
   JOIN generation_jobs j ON j.account_id=m.account_id AND j.conversation_id=m.conversation_id AND j.id=m.generation_job_id
   WHERE m.conversation_kind='direct' AND m.kind='text' AND m.photo_reply_job_id IS NULL AND m.account_id=$1 AND c.person_id=$2 AND m.id=ANY($3::uuid[]) AND m.removed_at IS NULL
    AND ${automaticSourceEligible}
    AND (m.author_kind='self' OR EXISTS(SELECT 1 FROM messages parent WHERE parent.account_id=m.account_id
      AND parent.conversation_id=m.conversation_id AND parent.id=m.reply_to_message_id AND parent.removed_at IS NULL))`,[accountId,personId,refs.map(ref=>ref.id)])).rows
  const found=new Map(rows.map(row=>[row.id,row.version]))
  return {personId,valid:refs.filter(ref=>found.get(ref.id)===ref.version)}
 }
}
