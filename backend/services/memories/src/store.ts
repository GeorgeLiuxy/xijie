import {sharedAvailable} from './shared-contributions.js'
import {createHash,randomUUID} from 'node:crypto'
import type {Pool,PoolClient} from 'pg'
import {MemoryError,conflict,forbidden,invalid,notFound,uuid,type CreateInput,type Memory,type PatchInput} from './contracts.js'
import type {ContextProvider,AccountContext} from './dependencies.js'
import {evidenceScore,normalize,searchHits} from './search.js'
import type {CandidateStore} from './candidates.js'
export type MemoryRow={id:string;account_id:string;person_id:string;client_memory_id:string;request_hash:string;confirmed_seq:string;origin:'manual'|'ai_candidate'|'shared_contribution'|'import';source_album_id:string|null;source_contribution_id:string|null;source_contribution_version:number|null;candidate_id:string|null;title:string;body:string;source_message_id:string|null;source_message_version:number|null;version:number;created_at:Date;confirmed_at:Date;updated_at:Date;removed_at:Date|null}
type Reference={id:string;version:number}
const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const echoAiVersion=(account:AccountContext)=>account.aiTextProcessing?.allowed===true&&account.aiTextProcessing.privateFeedProcessingAllowed===true&&Number.isSafeInteger(account.aiTextProcessing.authorizationVersion)&&account.aiTextProcessing.authorizationVersion>0?account.aiTextProcessing.authorizationVersion:0
export class MemoryStore{
 constructor(readonly pool:Pool,readonly dependencies:ContextProvider,readonly candidates?:CandidateStore){}
 async access(accountId:string,personId:string,requiresStorage=true){
  const [account,person]=await Promise.all([this.dependencies.account(accountId),this.dependencies.person(accountId,personId)])
  if(requiresStorage&&!account.storyStorage.allowed)throw forbidden();return {account,person}
 }
 private async row(accountId:string,personId:string,id:string,db:Pool|PoolClient=this.pool,includeRemoved=false){
  const result=await db.query<MemoryRow>('SELECT * FROM memories WHERE account_id=$1 AND person_id=$2 AND id=$3'+(includeRemoved?'':' AND removed_at IS NULL'),[accountId,personId,id]);if(!result.rows[0])throw notFound();return result.rows[0]
 }
 private async dto(row:MemoryRow):Promise<Memory>{
  if(!(await sharedAvailable(this.dependencies,[row])).length)throw notFound()
  let source:Memory['source']=row.origin==='shared_contribution'?{kind:'shared_contribution',albumId:row.source_album_id!,contributionId:row.source_contribution_id!}:undefined
  if(row.source_message_id){
   try{const current=await this.dependencies.source(row.account_id,row.source_message_id);if(current.personId===row.person_id&&current.author.kind==='persona'&&current.version===row.source_message_version)source={kind:'message',messageId:current.id}}
   catch(error){
    if(!(error instanceof MemoryError&&[404,503].includes(error.status)))throw error
    // The confirmed original has independent rights. A missing optional source or
    // a temporary source-service outage cannot make it unreadable; recheck its own authority.
    await this.access(row.account_id,row.person_id)
   }
  }
  return {id:row.id,personId:row.person_id,title:row.title,body:row.body,origin:row.origin,...(source?{source}:{}),confirmedAt:row.confirmed_at.toISOString(),createdAt:row.created_at.toISOString(),updatedAt:row.updated_at.toISOString(),version:row.version}
 }
 async detail(accountId:string,personId:string,id:string){await this.access(accountId,personId);return this.dto(await this.row(accountId,personId,id))}
 async list(accountId:string,personId:string,after:{at:string;id:string}|undefined,limit:number,includeBody=false){
  await this.access(accountId,personId)
  const visible:MemoryRow[]=[];let cursor=after
  while(visible.length<limit){
   const size=Math.max(limit,50),rows=(await this.pool.query<MemoryRow>('SELECT * FROM memories WHERE account_id=$1 AND person_id=$2 AND removed_at IS NULL AND ($3::timestamptz IS NULL OR (confirmed_at,id)<($3::timestamptz,$4::uuid)) ORDER BY confirmed_at DESC,id DESC LIMIT $5',[accountId,personId,cursor?.at??null,cursor?.id??null,size])).rows
   visible.push(...await sharedAvailable(this.dependencies,rows));if(rows.length<size)break
   const last=rows.at(-1)!;cursor={at:last.confirmed_at.toISOString(),id:last.id}
  }
  return Promise.all(visible.slice(0,limit).map(async row=>includeBody?this.dto(row):({id:row.id,personId:row.person_id,title:row.title,excerpt:[...row.body].slice(0,160).join(''),origin:row.origin,confirmedAt:row.confirmed_at.toISOString(),version:row.version})))
 }
 private async write(accountId:string,operation:string,target:string,key:string,hash:string,run:(db:PoolClient)=>Promise<Reference>):Promise<Reference>{
  const db=await this.pool.connect()
  try{
   await db.query('BEGIN')
   await db.query('INSERT INTO memory_account_cursors(account_id) VALUES($1) ON CONFLICT DO NOTHING',[accountId])
   await db.query('SELECT account_id FROM memory_account_cursors WHERE account_id=$1 FOR UPDATE',[accountId])
   const command=(await db.query<{request_hash:string;response:Reference}>('SELECT request_hash,response FROM memory_commands WHERE account_id=$1 AND operation=$2 AND target=$3 AND idempotency_key=$4 AND expires_at>clock_timestamp()',[accountId,operation,target,key])).rows[0]
   if(command){if(command.request_hash!==hash)throw conflict();await db.query('COMMIT');return command.response}
   const reference=await run(db)
   await db.query('DELETE FROM memory_commands WHERE account_id=$1 AND operation=$2 AND target=$3 AND idempotency_key=$4',[accountId,operation,target,key])
   await db.query('INSERT INTO memory_commands(account_id,operation,target,idempotency_key,request_hash,response) VALUES($1,$2,$3,$4,$5,$6)',[accountId,operation,target,key,hash,reference])
   await db.query('COMMIT');return reference
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
 }
 private async event(db:PoolClient,row:MemoryRow,type:string,requestId:string,echoAiAuthorizationVersion=0){
  const payload={memoryId:row.id,personId:row.person_id,version:row.version,...(type==='MemoryRemoved.v1'?{}:{echoAiAuthorizationVersion}),...(type==='MemoryConfirmed.v1'?{confirmedAt:row.confirmed_at.toISOString(),confirmedSeq:row.confirmed_seq,origin:row.origin,qualifiesForReferral:row.origin==='manual'||row.origin==='ai_candidate'}:type==='MemoryUpdated.v1'?{updatedAt:row.updated_at.toISOString()}:{removedAt:row.removed_at!.toISOString()})}
  await db.query("INSERT INTO outbox_events(type,account_id,aggregate_type,aggregate_id,aggregate_version,request_id,payload) VALUES($1,$2,'memory',$3,$4,$5,$6)",[type,row.account_id,row.id,row.version,requestId,payload])
 }
 async create(accountId:string,personId:string,key:string,input:CreateInput,requestId:string=randomUUID()){
  const {account}=await this.access(accountId,personId)
  const hash=fingerprint(input)
  let sourceError:unknown
  if(input.candidateId){
   try{if(!this.candidates)throw new MemoryError(503,'DEPENDENCY_UNAVAILABLE','The candidate service is unavailable.');await this.candidates.prepareConfirmation(accountId,personId,input.candidateId,input.candidateVersion!)}catch(error){sourceError=error}
  }
  if(input.sourceMessageId){
   try{const source=await this.dependencies.source(accountId,input.sourceMessageId);if(source.personId!==personId||source.author.kind!=='persona'||source.version!==input.sourceMessageVersion)throw new MemoryError(409,'SOURCE_CHANGED','The source is no longer valid. Your edited text can be retained.')}
   catch(error){sourceError=error instanceof MemoryError&&error.status===404?new MemoryError(409,'SOURCE_CHANGED','The source is no longer available.'):error}
  }
  const reference=await this.write(accountId,'create',personId,key,hash,async db=>{
   const prior=(await db.query<MemoryRow>('SELECT * FROM memories WHERE account_id=$1 AND person_id=$2 AND client_memory_id=$3',[accountId,personId,input.clientMemoryId])).rows[0]
   if(prior){if(prior.request_hash!==hash)throw conflict();if(prior.removed_at)throw notFound();return {id:prior.id,version:prior.version}}
   if(sourceError)throw sourceError
   const candidate=input.candidateId?await this.candidates!.consume(db,accountId,personId,input.candidateId,input.candidateVersion!):undefined
   const seq=(await db.query<{last_confirmed_seq:string}>('UPDATE memory_account_cursors SET last_confirmed_seq=last_confirmed_seq+1,updated_at=clock_timestamp() WHERE account_id=$1 RETURNING last_confirmed_seq',[accountId])).rows[0].last_confirmed_seq
   const row=(await db.query<MemoryRow>('INSERT INTO memories(account_id,person_id,client_memory_id,request_hash,confirmed_seq,title,body,source_message_id,source_message_version,origin,candidate_id,created_at,confirmed_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,statement_timestamp(),statement_timestamp(),statement_timestamp()) RETURNING *',[accountId,personId,input.clientMemoryId,hash,seq,input.title,input.body,candidate?.source_message_id??input.sourceMessageId??null,candidate?.source_version??input.sourceMessageVersion??null,candidate?'ai_candidate':'manual',candidate?.id??null])).rows[0]
   await this.event(db,row,'MemoryConfirmed.v1',requestId,echoAiVersion(account));return {id:row.id,version:row.version}
  })
  await this.access(accountId,personId);return this.dto(await this.row(accountId,personId,reference.id))
 }
 async patch(accountId:string,personId:string,id:string,key:string,expected:number,input:PatchInput,requestId:string=randomUUID()){
  const {account}=await this.access(accountId,personId)
  if(!(await sharedAvailable(this.dependencies,[await this.row(accountId,personId,id)])).length)throw notFound()
  const reference=await this.write(accountId,'patch',personId+':'+id,key,fingerprint({expected,input}),async db=>{
   const previous=await this.row(accountId,personId,id,db);if(previous.version!==expected)throw new MemoryError(412,'VERSION_CONFLICT','This memory changed. Reload and review it before saving.')
   const row=(await db.query<MemoryRow>('UPDATE memories SET title=$4,body=$5,version=version+1,updated_at=clock_timestamp() WHERE account_id=$1 AND person_id=$2 AND id=$3 RETURNING *',[accountId,personId,id,input.title??previous.title,input.body??previous.body])).rows[0]
   await this.event(db,row,'MemoryUpdated.v1',requestId,echoAiVersion(account));return {id:row.id,version:row.version}
  })
  await this.access(accountId,personId);return this.dto(await this.row(accountId,personId,reference.id))
 }
 async remove(accountId:string,personId:string,id:string,key:string,expected:number,requestId:string=randomUUID()){
  await this.access(accountId,personId,false)
  const reference=await this.write(accountId,'remove',personId+':'+id,key,fingerprint({expected}),async db=>{
   const previous=await this.row(accountId,personId,id,db);if(previous.version!==expected)throw new MemoryError(412,'VERSION_CONFLICT','This memory changed. Reload it before removing.')
   const row=(await db.query<MemoryRow>('UPDATE memories SET removed_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE account_id=$1 AND person_id=$2 AND id=$3 RETURNING *',[accountId,personId,id])).rows[0]
   await this.event(db,row,'MemoryRemoved.v1',requestId);return {id:row.id,version:row.version}
  })
  await this.access(accountId,personId,false);const row=await this.row(accountId,personId,reference.id,this.pool,true);if(!row.removed_at)throw notFound();return {id:row.id,removedAt:row.removed_at.toISOString(),version:row.version}
 }
 async search(accountId:string,query:string,locale='zh-CN'){
  const account=await this.dependencies.account(accountId);if(!account.storyStorage.allowed)throw forbidden()
  const [people,worlds]=await Promise.all([this.dependencies.persons(accountId),this.dependencies.worlds()]);if(!normalize(query))return []
  const rows=(await this.pool.query<MemoryRow>('SELECT * FROM memories WHERE account_id=$1 AND person_id=ANY($2::uuid[]) AND removed_at IS NULL ORDER BY confirmed_seq DESC',[accountId,people.map(person=>person.id)])).rows
  return searchHits(people,worlds,await sharedAvailable(this.dependencies,rows),query,locale)
 }
 async context(accountId:string,personId:string,query=''){
  await this.access(accountId,personId)
  const rows=(await this.pool.query<MemoryRow>('SELECT * FROM memories WHERE account_id=$1 AND person_id=$2 AND removed_at IS NULL ORDER BY confirmed_seq DESC',[accountId,personId])).rows
  const available=await sharedAvailable(this.dependencies,rows)
  const ranked=query.trim()?available.map(row=>({row,score:Math.max(evidenceScore(row.body,query),evidenceScore(row.title,query))})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score):[]
  const selected=ranked.length?ranked.slice(0,8).map(item=>item.row):available.slice(0,4)
  return {personId,memories:selected.map(row=>({id:row.id,version:row.version,title:row.title,body:[...row.body].slice(0,1200).join('')}))}
 }
 validateContextReferences(accountId:string,personId:string,refs:Reference[]){return this.validateReferences(accountId,personId,refs,true)}
 validateLetterReference(accountId:string,personId:string,refs:Reference[]){return this.validateReferences(accountId,personId,refs,false)}
 private async validateReferences(accountId:string,personId:string,refs:Reference[],aiContext:boolean){
  if(!uuid.test(accountId)||!uuid.test(personId)||!Array.isArray(refs)||(aiContext?refs.length>8:refs.length!==1)||refs.some(ref=>!ref||typeof ref!=='object'||Array.isArray(ref)||Object.keys(ref).some(key=>!['id','version'].includes(key))||typeof ref.id!=='string'||!uuid.test(ref.id)||!Number.isSafeInteger(ref.version)||ref.version<1||ref.version>2147483647)||new Set(refs.map(ref=>ref.id.toLowerCase())).size!==refs.length)throw invalid()
  const scope=async()=>{
   // The final remote read is Identity: a withdrawal during People cannot leave
   // the earlier allowed account as the last authority. No HTTP holds a DB lock.
   const person=await this.dependencies.person(accountId,personId),account=await this.dependencies.account(accountId)
   if(person.id!==personId||person.accountId!==accountId||person.status!=='active'||account.accountId!==accountId||account.status!=='active')throw notFound()
   if(account.storyStorage.allowed!==true)throw forbidden()
   if(aiContext&&account.aiTextProcessing.allowed!==true)throw new MemoryError(403,'AI_PERMISSION_REQUIRED','Allow AI text processing before using private memories.')
   const versions=[account.accessVersion,account.storyStorage.authorizationVersion,person.version,person.accessVersion,...(aiContext?[account.aiTextProcessing.authorizationVersion]:[])]
   if(versions.some(value=>!Number.isSafeInteger(value)||value<1))throw new MemoryError(503,'DEPENDENCY_UNAVAILABLE','The private memory authority is unavailable.')
   if((await this.pool.query('SELECT 1 FROM memory_account_write_gates WHERE account_id=$1 AND erased_at IS NOT NULL',[accountId])).rowCount)throw notFound()
   return versions
  }
  const normalized=refs.map(ref=>({id:ref.id.toLowerCase(),version:ref.version})).sort((a,b)=>a.id.localeCompare(b.id))
  const metadata=async()=>{
   const rows=(await this.pool.query<MemoryRow>('SELECT id,version,account_id,person_id,origin,source_album_id,source_contribution_id,source_contribution_version FROM memories WHERE account_id=$1 AND person_id=$2 AND removed_at IS NULL AND id=ANY($3::uuid[]) ORDER BY id',[accountId,personId,normalized.map(ref=>ref.id)])).rows
   return (await sharedAvailable(this.dependencies,rows)).map(row=>({id:row.id,version:row.version})).sort((a,b)=>a.id.localeCompare(b.id))
  }
  const before=await scope(),first=await metadata(),after=await scope()
  if(JSON.stringify(before)!==JSON.stringify(after))throw new MemoryError(409,'SOURCE_CHANGED','The private memory authority changed.')
  const latest=await metadata()
  return JSON.stringify(first)===JSON.stringify(latest)&&JSON.stringify(latest)===JSON.stringify(normalized)
 }
 async sweepCommands(){await this.pool.query('DELETE FROM memory_commands WHERE expires_at<=clock_timestamp()')}
}
