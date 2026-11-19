import type {Pool} from 'pg'
import {invalid,notFound,uuid} from './contracts.js'

export type SourceEvent={eventId:string;accountId:string;personId:string;sourceKind:'profile';sourceId:string;sourceVersion:number;change:'upsert'|'remove';occurredAt:string}
export function automaticEventQuery(query:Record<string,unknown>){
 if(Object.keys(query).some(key=>!['accountIds','limit'].includes(key))||typeof query.accountIds!=='string')throw invalid()
 const accounts=query.accountIds.split(',')
 if(!accounts.length||accounts.length>100||accounts.some(id=>!uuid.test(id))||new Set(accounts.map(id=>id.toLowerCase())).size!==accounts.length)throw invalid()
 if(query.limit!==undefined&&(typeof query.limit!=='string'||!/^[1-9][0-9]{0,2}$/.test(query.limit)))throw invalid()
 const limit=query.limit===undefined?50:Number(query.limit)
 if(limit>100)throw invalid()
 return {accountIds:accounts.map(id=>id.toLowerCase()),limit}
}
export function emptyAutomaticBody(body:unknown){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)throw invalid()}
export class AutomaticSourceStore{
 constructor(readonly pool:Pool){}
 async events(accountIds:string[],limit=50):Promise<SourceEvent[]>{
  const result=await this.pool.query<{event_id:string;account_id:string;aggregate_id:string;aggregate_version:number;type:string;occurred_at:Date}>(`SELECT e.event_id,e.account_id,e.aggregate_id,e.aggregate_version,e.type,e.occurred_at
   FROM outbox_events e WHERE e.account_id=ANY($1::uuid[]) AND e.type IN ('PersonConfirmed.v1','PersonUpdated.v1','PersonAccessRevoked.v1')
   AND NOT EXISTS(SELECT 1 FROM automatic_memory_event_acks a WHERE a.event_id=e.event_id) ORDER BY e.occurred_at,e.event_id LIMIT $2`,[accountIds,limit])
  return result.rows.map(row=>({eventId:row.event_id,accountId:row.account_id,personId:row.aggregate_id,sourceKind:'profile',sourceId:row.aggregate_id,sourceVersion:row.aggregate_version,change:row.type==='PersonAccessRevoked.v1'?'remove':'upsert',occurredAt:row.occurred_at.toISOString()}))
 }
 async ack(eventId:string){
  const db=await this.pool.connect()
  try{
   await db.query('BEGIN')
   const event=(await db.query<{account_id:string}>("SELECT account_id FROM outbox_events WHERE event_id=$1 AND type IN ('PersonConfirmed.v1','PersonUpdated.v1','PersonAccessRevoked.v1')",[eventId])).rows[0]
   if(!event)throw notFound()
   await db.query("SELECT pg_advisory_xact_lock(hashtextextended('xijie:people:erasure:' || $1,0))",[event.account_id])
   if((await db.query('SELECT 1 FROM account_erasure_fences WHERE account_id=$1 AND erased_at IS NOT NULL',[event.account_id])).rowCount)throw notFound()
   const present=await db.query('SELECT event_id FROM outbox_events WHERE event_id=$1 AND account_id=$2 FOR SHARE',[eventId,event.account_id])
   if(!present.rowCount)throw notFound()
   await db.query('INSERT INTO automatic_memory_event_acks(event_id,account_id) VALUES($1,$2) ON CONFLICT(event_id) DO NOTHING',[eventId,event.account_id])
   await db.query('COMMIT');return {eventId}
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
 }
}
