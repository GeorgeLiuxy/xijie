import {MemoryError,notFound,uuid} from './contracts.js'
import type {MemoryStore} from './store.js'

/** Referral consumers receive a confirmation milestone, never a memory or person. */
export class ReferralQualification {
 constructor(readonly store:MemoryStore){}
 async get(accountId:string){
  if(!uuid.test(accountId))throw notFound()
  const scope=async()=>{
   const account=await this.store.dependencies.account(accountId)
   if(account.accountId!==accountId||account.status!=='active')throw notFound()
   if((await this.store.pool.query('SELECT 1 FROM memory_account_write_gates WHERE account_id=$1 AND erased_at IS NOT NULL',[accountId])).rowCount)throw notFound()
   return account.accessVersion
  }
  const before=await scope()
  const read=async()=>{
   const result=await this.store.pool.query<{event_id:string;payload:{confirmedAt:string;confirmedSeq:string;origin:'manual'|'ai_candidate'}}>(
    `SELECT event_id,payload FROM outbox_events WHERE account_id=$1 AND type='MemoryConfirmed.v1'
      AND aggregate_type='memory' AND aggregate_version=1 AND payload->>'qualifiesForReferral'='true'
      AND payload->>'origin' IN ('manual','ai_candidate')
      ORDER BY (payload->>'confirmedSeq')::bigint,event_id LIMIT 1`,[accountId])
   const row=result.rows[0]
   return row?{eventId:row.event_id,confirmedAt:row.payload.confirmedAt,confirmedSeq:String(row.payload.confirmedSeq),origin:row.payload.origin}:null
  }
  const first=await read(),after=await scope(),latest=await read()
  if(before!==after||JSON.stringify(first)!==JSON.stringify(latest))throw new MemoryError(409,'SOURCE_CHANGED','The account changed. Retry the qualification check.')
  return {accountId,qualification:latest}
 }
}
