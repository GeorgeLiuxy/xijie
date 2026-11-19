import type {Pool,PoolClient} from 'pg'
import {ConversationError,uuid} from './contracts.js'
import type {ContextProvider,MemoryUse} from './dependencies.js'
import type {JobRow} from './store.js'
import {decodeWorldStages,type VirtualWorldContext,type VirtualWorldUse,type WorldStage} from './virtual-world.js'
import type {WorldEventRef,WorldEventMemory} from './world-action-contracts.js'

type Scope=Pick<JobRow,'account_id'|'conversation_id'|'person_id'>&{source_message_id:string|null}
type EventRow={id:string;person_id:string;world_id:string;world_version:number;version:1;summary:string;memory:string;created_at:Date;sequence:string;memory_context_refs:MemoryUse[];world_event_context_refs:WorldEventRef[]}
export type WorldActionContext={revision:string;events:WorldEventMemory[];refs:WorldEventRef[];memoryUses:MemoryUse[];historyAllowed?:boolean}
const changed=()=>new ConversationError(409,'WORLD_EVENT_CONTEXT_CHANGED','The virtual experience used for this response changed.')
const ref=(row:EventRow):WorldEventRef=>({id:row.id,version:1,personId:row.person_id,worldId:row.world_id,worldVersion:row.world_version,reality:'virtual',branch:'main'})
const memory=(row:EventRow):WorldEventMemory=>({...ref(row),summary:row.summary,memory:row.memory,occurredAt:row.created_at.toISOString()})
const validRef=(r:WorldEventRef)=>r&&typeof r==='object'&&typeof r.id==='string'&&uuid.test(r.id)&&r.version===1&&r.reality==='virtual'&&r.branch==='main'
const available=`e.removed_at IS NULL AND ((e.source_kind='text' AND s.removed_at IS NULL AND s.version=e.source_version AND r.removed_at IS NULL AND j.state='succeeded' AND j.world_action_decision='execute') OR(e.source_kind='offline_life' AND l.state='succeeded' AND l.event_id=e.id))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(j.world_action_message_refs,'[]')) mr
  WHERE NOT EXISTS(SELECT 1 FROM messages mi WHERE mi.account_id=e.account_id AND mi.conversation_id=e.conversation_id AND mi.id::text=mr->>'id' AND mi.version::text=mr->>'version' AND mi.removed_at IS NULL))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(j.world_event_context_refs,l.event_refs,'[]')) er
  WHERE NOT EXISTS(SELECT 1 FROM person_world_events ancestor WHERE ancestor.account_id=e.account_id AND ancestor.conversation_id=e.conversation_id AND ancestor.id::text=er->>'id' AND ancestor.version::text=er->>'version' AND ancestor.removed_at IS NULL))`
const select=`SELECT e.*,COALESCE(j.memory_context_refs,l.memory_refs,'[]') AS memory_context_refs,COALESCE(j.world_event_context_refs,l.event_refs,'[]') AS world_event_context_refs FROM person_world_events e
 LEFT JOIN messages s ON s.account_id=e.account_id AND s.id=e.source_message_id
 LEFT JOIN messages r ON r.account_id=e.account_id AND r.id=e.reply_id
 LEFT JOIN generation_jobs j ON j.account_id=e.account_id AND j.id=e.job_id
 LEFT JOIN offline_life_runs l ON l.account_id=e.account_id AND l.id=e.life_run_id`

// This module is the authority for finite narrative events, not relocation,
// inventory or user-reported memories. It never makes HTTP calls in a SQL tx.
export class WorldActions{
 constructor(readonly pool:Pool,readonly dependencies:ContextProvider){}
 async revision(current:Scope,db:Pool|PoolClient=this.pool){
  const row=(await db.query<{revision:string}>('SELECT world_event_revision::text AS revision FROM conversations WHERE account_id=$1 AND id=$2',[current.account_id,current.conversation_id])).rows[0]
  if(!row)throw changed();return row.revision
 }
 private scope(refs:WorldEventRef[],current:Scope,world:VirtualWorldContext|VirtualWorldUse,historyAllowed=false){
  const worldId='currentWorld'in world?world.currentWorld.id:world.worldId
  return Array.isArray(refs)&&refs.length<=32&&new Set(refs.map(r=>r?.id)).size===refs.length&&refs.every(r=>validRef(r)&&r.personId===current.person_id&&uuid.test(r.worldId)&&Number.isSafeInteger(r.worldVersion)&&r.worldVersion>=1&&(r.worldVersion===world.worldVersion?r.worldId===worldId:historyAllowed&&r.worldVersion<world.worldVersion))
 }
 private async dependencyValid(uses:MemoryUse[]){
  if(!Array.isArray(uses)||uses.length>64||uses.some(u=>!u||!['cherished','automatic'].includes(u.kind)||!uuid.test(u.id)||!Number.isSafeInteger(u.version)||u.version<1))return false
  const cherished=uses.filter(u=>u.kind==='cherished'),automatic=uses.filter(u=>u.kind==='automatic')
  // The caller supplies account/person in validRows; no model sees memory text
  // merely because an event retains a reference to it.
  return {cherished,automatic}
 }
 private async validRows(current:Scope,rows:EventRow[],historyAllowed=false){
  for(const row of rows){
   const uses=await this.dependencyValid(row.memory_context_refs);if(!uses)return false
   // Current People fields are supplied directly. Do not carry an obsolete
   // profile projection (including via an older event) into the continuous path.
   if(historyAllowed&&uses.automatic.some(u=>u.sourceKind!=='message'))return false
   if(uses.cherished.length&&(!this.dependencies.validateMemories||!await this.dependencies.validateMemories(current.account_id,current.person_id,uses.cherished)))return false
   if(uses.automatic.length&&(!this.dependencies.validateAutomaticMemories||!await this.dependencies.validateAutomaticMemories(current.account_id,current.person_id,uses.automatic)))return false
  }
  return true
 }
 async rows(current:Scope,world:VirtualWorldContext|VirtualWorldUse,refs:WorldEventRef[],db:Pool|PoolClient=this.pool,historyAllowed=false):Promise<EventRow[]|null>{
  if(!this.scope(refs,current,world,historyAllowed))return null
  if(!refs.length)return []
  const rows=(await db.query<EventRow>(`${select} WHERE e.account_id=$1 AND e.conversation_id=$2 AND e.id=ANY($3::uuid[]) AND ${available} ${db===this.pool?'':'FOR SHARE OF e'}`,[current.account_id,current.conversation_id,refs.map(r=>r.id)])).rows
  return rows.length===refs.length&&rows.every(row=>refs.some(r=>r.id===row.id&&r.version===row.version&&r.personId===row.person_id&&r.worldId===row.world_id&&r.worldVersion===row.world_version))?rows:null
 }
 async valid(current:Scope,world:VirtualWorldContext|VirtualWorldUse,refs:WorldEventRef[],historyAllowed=false){const rows=await this.rows(current,world,refs,this.pool,historyAllowed);return rows!==null&&await this.validRows(current,rows,historyAllowed)}
 async context(current:Scope,world:VirtualWorldContext,query:string,inherited:WorldEventRef[]=[],historyAllowed=false):Promise<WorldActionContext>{
  const revision=await this.revision(current)
  if(!this.scope(inherited,current,world,historyAllowed))throw changed()
  const inheritedRows=await this.rows(current,world,inherited,this.pool,historyAllowed)
  if(!inheritedRows||!await this.validRows(current,inheritedRows,historyAllowed))throw changed()
  // Keep recent episodes and literal matches. Bigrams allow bounded Chinese
  // matching without pretending a database full-text dictionary understands it.
  const words=query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)??[],terms=[...new Set(words.flatMap(word=>/\p{Script=Han}/u.test(word)?[word,...Array.from({length:Math.min(word.length-1,24)},(_,i)=>word.slice(i,i+2))]:[word]))].slice(0,32)
  const candidates=(await this.pool.query<EventRow>(`${select} WHERE e.account_id=$1 AND e.conversation_id=$2 AND ((e.world_id=$3 AND e.world_version=$4) OR ($7::boolean AND e.world_version<$4)) AND ${available}
   AND ($5::uuid IS NULL OR s.sequence<(SELECT sequence FROM messages WHERE account_id=$1 AND id=$5) OR(e.source_kind='offline_life' AND e.created_at<(SELECT created_at FROM messages WHERE account_id=$1 AND id=$5)))
   ORDER BY CASE WHEN EXISTS(SELECT 1 FROM unnest($6::text[]) term WHERE strpos(lower(e.summary||' '||e.memory),term)>0) THEN 0 ELSE 1 END,e.sequence DESC LIMIT 24`,[current.account_id,current.conversation_id,world.currentWorld.id,world.worldVersion,current.source_message_id,terms,historyAllowed])).rows
  const chosen=new Map(inheritedRows.map(row=>[row.id,row]))
  let direct=0
  for(const row of candidates){
   if(chosen.has(row.id))continue
   if(direct>=8)break
   if(!await this.validRows(current,[row],historyAllowed))continue
   const closure=[ref(row),...row.world_event_context_refs].filter((r,i,rs)=>rs.findIndex(other=>other.id===r.id)===i)
   if(closure.some(r=>!validRef(r))||chosen.size+closure.filter(r=>!chosen.has(r.id)).length>32)continue
   const rows=await this.rows(current,world,closure,this.pool,historyAllowed);if(!rows||!await this.validRows(current,rows,historyAllowed))continue
   for(const parent of rows)chosen.set(parent.id,parent)
   direct++
  }
  const rows=[...chosen.values()].sort((a,b)=>BigInt(a.sequence)<BigInt(b.sequence)?-1:1)
  const stages=new Map<number,WorldStage>([[world.worldVersion,{worldVersion:world.worldVersion,world:world.currentWorld,basis:'current_catalog'}]])
  const past=[...new Map(rows.filter(r=>r.world_version<world.worldVersion).map(r=>[r.world_version,{worldId:r.world_id,worldVersion:r.world_version}])).values()]
  if(past.length){
   if(!historyAllowed||!this.dependencies.resolveWorldStages)throw changed()
   const resolved=await this.dependencies.resolveWorldStages(world,past)
   // Validate injected providers as well as HTTP adapters before any model call.
   for(const value of decodeWorldStages({accountId:world.accountId,personId:world.personId,personVersion:world.personVersion,currentWorldVersion:world.worldVersion,stages:resolved},world,past))stages.set(value.worldVersion,value)
  }
  if(revision!==await this.revision(current))throw changed()
  return{revision,events:rows.map(row=>({...memory(row),origin:stages.get(row.world_version)!})),refs:rows.map(ref),memoryUses:rows.flatMap(row=>row.memory_context_refs),...(historyAllowed?{historyAllowed:true}:{})}
 }
 async commit(db:PoolClient,current:JobRow,replyId:string,world:VirtualWorldUse,context:WorldActionContext,action:{requestQuote:string;summary:string;memory:string}){
  const revision=(await db.query<{revision:string}>('UPDATE conversations SET world_event_revision=world_event_revision+1 WHERE account_id=$1 AND id=$2 AND world_event_revision=$3 RETURNING world_event_revision::text AS revision',[current.account_id,current.conversation_id,context.revision])).rows[0]?.revision
  if(!revision)throw changed()
  return(await db.query<{id:string;version:1}>(`INSERT INTO person_world_events(account_id,conversation_id,person_id,job_id,source_message_id,reply_id,world_id,world_version,sequence,request_quote,summary,memory) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id,version`,[current.account_id,current.conversation_id,current.person_id,current.id,current.source_message_id,replyId,world.worldId,world.worldVersion,revision,action.requestQuote,action.summary,action.memory])).rows[0]
 }
 async invalidate(db:PoolClient,accountId:string,conversationId:string,messageId:string){
  // All descendants include the transitive event refs used in their prompt.
  const result=await db.query(`WITH RECURSIVE affected(id) AS(
   SELECT e.id FROM person_world_events e LEFT JOIN generation_jobs j ON j.account_id=e.account_id AND j.id=e.job_id WHERE e.account_id=$1 AND e.conversation_id=$2 AND e.removed_at IS NULL AND(e.source_message_id=$3 OR e.reply_id=$3 OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(j.world_action_message_refs,'[]')) mr WHERE mr->>'id'=$3::text))
   UNION SELECT e.id FROM person_world_events e LEFT JOIN generation_jobs j ON j.account_id=e.account_id AND j.id=e.job_id LEFT JOIN offline_life_runs l ON l.account_id=e.account_id AND l.id=e.life_run_id JOIN affected a ON EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(j.world_event_context_refs,l.event_refs,'[]')) er WHERE er->>'id'=a.id::text) WHERE e.account_id=$1 AND e.conversation_id=$2 AND e.removed_at IS NULL
  ) UPDATE person_world_events SET removed_at=GREATEST(created_at,clock_timestamp()::timestamptz(3)) WHERE id IN(SELECT id FROM affected) AND removed_at IS NULL`,[accountId,conversationId,messageId])
  await db.query(`UPDATE story_events e SET removed_at=clock_timestamp() FROM story_jobs j WHERE j.id=e.job_id AND e.account_id=$1 AND e.removed_at IS NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(j.event_refs) er WHERE er->>'kind'='main' AND NOT EXISTS(SELECT 1 FROM person_world_events p WHERE p.account_id=e.account_id AND p.id::text=er->>'id' AND p.removed_at IS NULL))`,[accountId])
  if(result.rowCount)await db.query('UPDATE conversations SET world_event_revision=world_event_revision+1 WHERE account_id=$1 AND id=$2',[accountId,conversationId])
 }
}
