import {createHash,randomUUID} from 'node:crypto'
import type {MemoryStore,MemoryRow} from './store.js'
import type {ContextProvider} from './dependencies.js'
import {MemoryError,notFound,unavailable} from './contracts.js'
export type SharedSource={albumId:string;contributionId:string;accountId:string;personId:string;version:number;title:string;body:string;allowAdoption:true}
export async function sharedAvailable<T extends Pick<MemoryRow,'origin'|'account_id'|'person_id'|'source_album_id'|'source_contribution_id'|'source_contribution_version'>>(deps:ContextProvider,rows:T[]):Promise<T[]>{
 const valid:T[]=[]
 for(const row of rows){if(row.origin!=='shared_contribution'){valid.push(row);continue}if(!deps.sharedSource)throw unavailable();try{const source=await deps.sharedSource(row.account_id,row.source_album_id!,row.source_contribution_id!,row.source_contribution_version!);if(source.accountId!==row.account_id||source.personId!==row.person_id||source.albumId!==row.source_album_id||source.contributionId!==row.source_contribution_id||source.version!==row.source_contribution_version||source.allowAdoption!==true)throw unavailable();valid.push(row)}catch(e){if(!(e instanceof MemoryError&&[403,404].includes(e.status)))throw e}}
 return valid
}
export class SharedContributions{
 constructor(readonly store:MemoryStore){}
 private async receipt(accountId:string,albumId:string,id:string){const row=(await this.store.pool.query('SELECT * FROM shared_memory_receipts WHERE account_id=$1 AND contribution_id=$2',[accountId,id])).rows[0];if(row&&row.album_id!==albumId)throw notFound();return row}
 private async result(row:Record<string,any>){const m=row.memory_id?(await this.store.pool.query('SELECT version,removed_at FROM memories WHERE account_id=$1 AND id=$2',[row.account_id,row.memory_id])).rows[0]:null;return {albumId:row.album_id,contributionId:row.contribution_id,memoryId:row.memory_id,version:m?.version??1,status:row.state==='revoked'||!m||m.removed_at?'revoked':'fulfilled'}}
 async adopt(accountId:string,albumId:string,id:string,sourceVersion:number){
  if(!this.store.dependencies.sharedSource)throw unavailable()
  const prior=await this.receipt(accountId,albumId,id);if(prior){await this.store.dependencies.account(accountId);if(prior.source_version&&prior.source_version!==sourceVersion)throw new MemoryError(409,'IDEMPOTENCY_CONFLICT','The adoption has a different source version.');return this.result(prior)}
  const source=await this.store.dependencies.sharedSource(accountId,albumId,id,sourceVersion),before=await this.store.access(accountId,source.personId)
  const db=await this.store.pool.connect();let row
  try{await db.query('BEGIN');await db.query('INSERT INTO memory_account_cursors(account_id) VALUES($1) ON CONFLICT DO NOTHING',[accountId]);await db.query('SELECT account_id FROM memory_account_cursors WHERE account_id=$1 FOR UPDATE',[accountId]);row=(await db.query('SELECT * FROM shared_memory_receipts WHERE account_id=$1 AND contribution_id=$2',[accountId,id])).rows[0]
   if(row){if(row.album_id!==albumId||row.source_version&&row.source_version!==sourceVersion)throw new MemoryError(409,'IDEMPOTENCY_CONFLICT','The adoption source changed.')}
   else{const seq=(await db.query('UPDATE memory_account_cursors SET last_confirmed_seq=last_confirmed_seq+1,updated_at=clock_timestamp() WHERE account_id=$1 RETURNING last_confirmed_seq',[accountId])).rows[0].last_confirmed_seq
    const mid=randomUUID(),fingerprint=createHash('sha256').update(JSON.stringify([albumId,id,sourceVersion,source.title,source.body])).digest('hex')
    const m=(await db.query("INSERT INTO memories(id,account_id,person_id,client_memory_id,request_hash,confirmed_seq,origin,title,body,source_album_id,source_contribution_id,source_contribution_version) VALUES($1,$2,$3,$4,$5,$6,'shared_contribution',$7,$8,$9,$10,$11) RETURNING *",[mid,accountId,source.personId,id,fingerprint,seq,source.title,source.body,albumId,id,sourceVersion])).rows[0]
    await db.query("INSERT INTO outbox_events(type,account_id,aggregate_type,aggregate_id,aggregate_version,request_id,payload) VALUES('MemoryConfirmed.v1',$1,'memory',$2,1,$3,$4)",[accountId,mid,randomUUID(),{memoryId:mid,personId:source.personId,version:1,confirmedAt:m.confirmed_at.toISOString(),confirmedSeq:seq,origin:'shared_contribution',qualifiesForReferral:false,echoAiAuthorizationVersion:0}])
    row=(await db.query("INSERT INTO shared_memory_receipts(account_id,album_id,contribution_id,source_version,person_id,memory_id,state) VALUES($1,$2,$3,$4,$5,$6,'fulfilled') RETURNING *",[accountId,albumId,id,sourceVersion,source.personId,mid])).rows[0]
   }await db.query('COMMIT')
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
  const after=await this.store.access(accountId,source.personId);if(before.account.accessVersion!==after.account.accessVersion||before.account.storyStorage.authorizationVersion!==after.account.storyStorage.authorizationVersion||before.person.accessVersion!==after.person.accessVersion)throw new MemoryError(409,'SOURCE_CHANGED','The adoption authority changed.')
  await this.store.dependencies.sharedSource(accountId,albumId,id,sourceVersion);return this.result(row)
 }
 async revoke(accountId:string,albumId:string,id:string){
  // A durable tombstone also fences a source request that began before withdrawal
  // but would otherwise create its memory after this cleanup finished.
  const db=await this.store.pool.connect();try{await db.query('BEGIN');const gate=(await db.query('SELECT erased_at FROM memory_account_write_gates WHERE account_id=$1 FOR UPDATE',[accountId])).rows[0];if(gate?.erased_at){await db.query('COMMIT');return{contributionId:id,status:'revoked'}}
   await db.query('INSERT INTO memory_account_cursors(account_id) VALUES($1) ON CONFLICT DO NOTHING',[accountId]);await db.query('SELECT account_id FROM memory_account_cursors WHERE account_id=$1 FOR UPDATE',[accountId]);const r=(await db.query('SELECT * FROM shared_memory_receipts WHERE account_id=$1 AND contribution_id=$2',[accountId,id])).rows[0];if(r&&r.album_id!==albumId)throw notFound()
   const rows=(await db.query('DELETE FROM memories WHERE account_id=$1 AND source_album_id=$2 AND source_contribution_id=$3 RETURNING id,person_id,version',[accountId,albumId,id])).rows
   for(const m of rows){await db.query('DELETE FROM memory_commands WHERE account_id=$1 AND (response->>\'id\'=$2 OR target LIKE $3)',[accountId,m.id,'%:'+m.id]);await db.query('DELETE FROM outbox_events WHERE account_id=$1 AND aggregate_id=$2',[accountId,m.id]);await db.query("INSERT INTO outbox_events(type,account_id,aggregate_type,aggregate_id,aggregate_version,request_id,payload) VALUES('MemoryRemoved.v1',$1,'memory',$2,$3,$4,$5)",[accountId,m.id,m.version+1,randomUUID(),{memoryId:m.id,personId:m.person_id,version:m.version+1,removedAt:new Date().toISOString()}])}
   await db.query("INSERT INTO shared_memory_receipts(account_id,album_id,contribution_id,state) VALUES($1,$2,$3,'revoked') ON CONFLICT(account_id,contribution_id) DO UPDATE SET state='revoked',updated_at=clock_timestamp()",[accountId,albumId,id]);await db.query('COMMIT');return{contributionId:id,status:'revoked'}
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 }
}
