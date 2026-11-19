import {sharedAvailable} from './shared-contributions.js'
import {createHash} from 'node:crypto'
import type {Pool} from 'pg'
import {MemoryError,notFound,unavailable} from './contracts.js'
import {validDataRequestContext,type ContextProvider,type DataRequestContext} from './dependencies.js'
import type {MemoryRow} from './store.js'
import type {AutoDependencies,AutomaticRef} from './automatic-contracts.js'
import type {PersonContext} from './dependencies.js'

type AutomaticExportRow={id:string;person_id:string;state:string;version:number;source_kind:'profile'|'message';source_id:string;source_version:number;source_created_at:Date;source_sequence:string|null;source_author:string;reality:string;sources:AutomaticRef[];topic:string;body:string;evidence:string;time_description:string;created_at:Date;updated_at:Date;state_changed_at:Date;corrected_topic:string|null;corrected_body:string|null;corrected_at:Date|null}

export type ExportScope='interaction_data'|'account_data'
export class MemoryDataRights{
 constructor(private readonly pool:Pool,private readonly dependencies:ContextProvider,private readonly queueSchema='memory_queue'){
  if(!/^[a-z_][a-z0-9_]{0,62}$/.test(queueSchema))throw new Error('Invalid memory queue schema')
 }
 private async authorize(accountId:string,requestId:string,kind:'export'|'delete_account',scope:ExportScope){
  if(!this.dependencies.dataRequest)throw unavailable()
  const context=await this.dependencies.dataRequest(requestId)
  if(!validDataRequestContext(context))throw unavailable()
  if(context.requestId!==requestId||context.accountId!==accountId||context.kind!==kind||context.scope!==scope)throw notFound()
  if(kind==='export'?context.accountStatus!=='active':!['deletion_pending','deleted'].includes(context.accountStatus))throw notFound()
  return context
 }
 private sameAuthority(first:DataRequestContext,next:DataRequestContext){
  return first.accountId===next.accountId&&first.accountAccessVersion===next.accountAccessVersion&&first.accountStatus===next.accountStatus
 }
 private async automaticExport(rows:AutomaticExportRow[],people:PersonContext[]){
  const sources=new Map<string,Set<string>>(),dependencies=this.dependencies as Partial<AutoDependencies>
  for(const person of people){
   const refs=[...new Map(rows.filter(row=>row.person_id===person.id&&row.state==='active'&&row.source_kind==='message').flatMap(row=>row.sources).map(ref=>[ref.id,ref])).values()]
   const valid=new Set<string>()
   if(refs.length&&!dependencies.validAutomaticRefs)throw unavailable()
   for(let offset=0;offset<refs.length;offset+=64){
    const checked=await dependencies.validAutomaticRefs!.call(this.dependencies,person.accountId,person.id,refs.slice(offset,offset+64))
    for(const ref of checked)valid.add(ref.id+':'+ref.version)
   }
   sources.set(person.id,valid)
  }
  return rows.map(row=>{
   const person=people.find(person=>person.id===row.person_id)
   const sourceAvailable=row.state==='active'&&!!person&&(row.source_kind==='profile'?person.version===row.source_version:row.sources.length>0&&row.sources.every(ref=>sources.get(row.person_id)?.has(ref.id+':'+ref.version)))
   return {id:row.id,personId:row.person_id,origin:'automatic' as const,state:row.state,version:row.version,sourceAvailable,
    source:{kind:row.source_kind,id:row.source_id,version:row.source_version,author:row.source_author,reality:row.reality,createdAt:row.source_created_at.toISOString(),...(row.source_sequence?{sequence:row.source_sequence}:{}),refs:row.sources},
    ...(sourceAvailable?{topic:row.topic,body:row.body,evidence:row.evidence,timeDescription:row.time_description}:{}),
    ...(row.corrected_at?{correction:{topic:row.corrected_topic,body:row.corrected_body,correctedAt:row.corrected_at.toISOString()}}:{}),
    createdAt:row.created_at.toISOString(),updatedAt:row.updated_at.toISOString(),stateChangedAt:row.state_changed_at.toISOString()}
  })
 }
 async export(accountId:string,requestId:string,scope:ExportScope){
  const before=await this.authorize(accountId,requestId,'export',scope)
  const people=await this.dependencies.persons(accountId),personIds=people.map(person=>person.id).sort()
  const sharedRows=(await this.pool.query<MemoryRow>("SELECT * FROM memories WHERE account_id=$1 AND person_id=ANY($2::uuid[]) AND removed_at IS NULL AND origin='shared_contribution'",[accountId,personIds])).rows
  const availableShared=await sharedAvailable(this.dependencies,sharedRows),sharedKeys=new Set(availableShared.map(row=>row.id+':'+row.version))
  const db=await this.pool.connect()
  let result
  try{
   await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
   if((await db.query('SELECT account_id FROM memory_account_write_gates WHERE account_id=$1 AND erased_at IS NOT NULL',[accountId])).rowCount)throw notFound()
   const capturedAt=(await db.query<{at:Date}>('SELECT transaction_timestamp() AS at')).rows[0].at.toISOString()
   const rows=(await db.query<MemoryRow>('SELECT * FROM memories WHERE account_id=$1 AND person_id=ANY($2::uuid[]) AND removed_at IS NULL ORDER BY confirmed_seq,id',[accountId,personIds])).rows
   const memories=rows.filter(row=>row.origin!=='shared_contribution'||sharedKeys.has(row.id+':'+row.version)).map(row=>({id:row.id,personId:row.person_id,title:row.title,body:row.body,origin:row.origin,confirmedSequence:row.confirmed_seq,
    ...(row.source_message_id?{sourceMessageId:row.source_message_id,sourceMessageVersion:row.source_message_version}:{}),
    createdAt:row.created_at.toISOString(),confirmedAt:row.confirmed_at.toISOString(),updatedAt:row.updated_at.toISOString(),version:row.version}))
   const automaticRows=(await db.query<AutomaticExportRow>('SELECT * FROM automatic_memory_entries WHERE account_id=$1 AND person_id=ANY($2::uuid[]) ORDER BY created_at,id',[accountId,personIds])).rows
   const automaticMemories=await this.automaticExport(automaticRows,people)
   const socialSourceAcknowledgements=(await db.query(`SELECT a.event_id AS "eventId",e.aggregate_id AS "memoryId",e.aggregate_version AS "sourceVersion",a.acknowledged_at AS "acknowledgedAt"
    FROM social_memory_event_acks a JOIN outbox_events e ON e.account_id=a.account_id AND e.event_id=a.event_id
    WHERE a.account_id=$1 AND e.payload->>'personId'=ANY($2::text[]) ORDER BY a.event_id`,[accountId,personIds])).rows
   const sharedContributionReceipts=(await db.query("SELECT to_regclass('shared_memory_receipts') AS present")).rows[0].present?(await db.query('SELECT album_id AS "albumId",contribution_id AS "contributionId",source_version AS "sourceVersion",person_id AS "personId",memory_id AS "memoryId",state,created_at AS "createdAt" FROM shared_memory_receipts WHERE account_id=$1 ORDER BY contribution_id',[accountId])).rows:[]
   const importReceipts=(await db.query(`SELECT b.id AS "batchId",b.person_id AS "personId",b.source_sha256 AS "sourceSha256",b.item_count AS "itemCount",b.created_at AS "createdAt",jsonb_agg(jsonb_build_object('itemId',i.item_id,'memoryId',i.memory_id) ORDER BY i.item_id) AS items FROM memory_import_batches b JOIN memory_import_items i ON i.account_id=b.account_id AND i.batch_id=b.id WHERE b.account_id=$1 AND b.person_id=ANY($2::uuid[]) GROUP BY b.account_id,b.id ORDER BY b.created_at,b.id`,[accountId,personIds])).rows
   const data={memories,automaticMemories,socialSourceAcknowledgements,sharedContributionReceipts,importReceipts},encoded=JSON.stringify(data)
   if(Buffer.byteLength(encoded,'utf8')>20*1024*1024)throw new MemoryError(413,'EXPORT_TOO_LARGE','The memory export exceeds the supported size.')
   result={schemaVersion:1 as const,domain:'memories' as const,accountId,capturedAt,revision:createHash('sha256').update(encoded).digest('hex'),data}
   await db.query('COMMIT')
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
  if((await sharedAvailable(this.dependencies,availableShared)).length!==availableShared.length)throw new MemoryError(409,'EXPORT_STALE','Shared contribution visibility changed during export.')
  const after=await this.authorize(accountId,requestId,'export',scope)
  if(!this.sameAuthority(before,after))throw notFound()
  const signature=(values:PersonContext[])=>JSON.stringify(values.map(person=>[person.id,person.version,person.accessVersion]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))))
  if(signature(people)!==signature(await this.dependencies.persons(accountId)))throw new MemoryError(409,'EXPORT_STALE','Person visibility changed during export.')
  return result
 }
 async erase(accountId:string,requestId:string){
  await this.authorize(accountId,requestId,'delete_account','account_data')
  const db=await this.pool.connect()
  try{
   await db.query('BEGIN')
   const gate=(await db.query<{erased_at:Date;request_id:string}>(`INSERT INTO memory_account_write_gates(account_id,erased_at,request_id) VALUES($1,clock_timestamp(),$2)
    ON CONFLICT(account_id) DO UPDATE SET erased_at=COALESCE(memory_account_write_gates.erased_at,EXCLUDED.erased_at),request_id=COALESCE(memory_account_write_gates.request_id,EXCLUDED.request_id)
    RETURNING erased_at,request_id`,[accountId,requestId])).rows[0]
   if(gate.request_id!==requestId)throw new MemoryError(409,'IDEMPOTENCY_CONFLICT','This account has another erasure request.')
   const prior=(await db.query<{erased_at:Date}>('SELECT erased_at FROM memory_erasure_receipts WHERE account_id=$1 AND request_id=$2',[accountId,requestId])).rows[0]
   if(prior){await db.query('COMMIT');return {accountId,requestId,erasedAt:prior.erased_at.toISOString(),alreadyErased:true}}
   const jobs=(await db.query<{id:string}>('SELECT id FROM memory_generation_jobs WHERE account_id=$1 UNION ALL SELECT id FROM automatic_memory_jobs WHERE account_id=$1',[accountId])).rows.map(row=>row.id)
   if(jobs.length){
    const table=(await db.query<{table:string|null}>('SELECT to_regclass($1)::text AS "table"',[this.queueSchema+'.job'])).rows[0].table
    if(!table)throw unavailable()
    // pg-boss 12's parent job relation covers its queue partitions and all states.
    // Only business references are inspected; no unrelated queue rows are touched.
    await db.query(`DELETE FROM "${this.queueSchema}".job WHERE data->>'jobId'=ANY($1::text[])`,[jobs])
   }
   await db.query('DELETE FROM memory_import_items WHERE account_id=$1',[accountId])
   await db.query('DELETE FROM memory_import_batches WHERE account_id=$1',[accountId])
   await db.query('DELETE FROM automatic_memory_entries WHERE account_id=$1',[accountId])
   await db.query('DELETE FROM automatic_memory_jobs WHERE account_id=$1',[accountId])
   await db.query('DELETE FROM automatic_memory_sources WHERE account_id=$1',[accountId])
   await db.query('DELETE FROM automatic_memory_receipts WHERE account_id=$1',[accountId])
   if((await db.query("SELECT to_regclass('shared_memory_receipts') AS present")).rows[0].present)await db.query('DELETE FROM shared_memory_receipts WHERE account_id=$1',[accountId])
   await db.query('DELETE FROM memories WHERE account_id=$1',[accountId])
   await db.query('SET CONSTRAINTS memory_jobs_candidate_fk DEFERRED')
   await db.query('DELETE FROM memory_candidates WHERE account_id=$1',[accountId])
   await db.query('DELETE FROM memory_generation_jobs WHERE account_id=$1',[accountId])
   await db.query('DELETE FROM candidate_commands WHERE account_id=$1',[accountId])
   await db.query('DELETE FROM memory_commands WHERE account_id=$1',[accountId])
   await db.query('DELETE FROM outbox_events WHERE account_id=$1',[accountId])
   await db.query('DELETE FROM memory_account_cursors WHERE account_id=$1',[accountId])
   await db.query('INSERT INTO memory_erasure_receipts(account_id,request_id,erased_at) VALUES($1,$2,$3)',[accountId,requestId,gate.erased_at])
   await db.query('COMMIT')
   return {accountId,requestId,erasedAt:gate.erased_at.toISOString(),alreadyErased:false}
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
 }
}
