import {randomUUID} from 'node:crypto'
import type {PoolClient} from 'pg'
import {SocialError,digest,notFound,unavailable,positive} from './contracts.js'
import type {Account} from './dependencies.js'
import type {SocialStore} from './store.js'
import type {EchoEvent,EchoQueueSender,JobRow,MemoryRef,EchoInput} from './echo-contracts.js'
import {worldContextRevision} from './virtual-world.js'

export const permitsEcho=(a:Account)=>a.storyStorage.allowed&&a.storyStorage.privateFeedAllowed===true&&a.aiTextProcessing?.allowed===true&&a.aiTextProcessing.privateFeedProcessingAllowed===true&&positive(a.aiTextProcessing.authorizationVersion)
export class EchoStore{
 constructor(readonly social:SocialStore,readonly queue:EchoQueueSender){}
 get pool(){return this.social.pool}get deps(){return this.social.dependencies}
 async tx<T>(accountId:string,run:(db:PoolClient)=>Promise<T>){const db=await this.pool.connect();try{await db.query('BEGIN');await this.social.gate(db,accountId,true);const value=await run(db);await db.query('COMMIT');return value}catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}}
 async ingest(event:EchoEvent){
  const account=await this.deps.account(event.accountId),person=(await this.deps.persons(event.accountId)).find(p=>p.id===event.personId)
  const eligible=event.change==='upsert'&&person&&permitsEcho(account)&&event.echoAiAuthorizationVersion===account.aiTextProcessing!.authorizationVersion
  return this.tx(event.accountId,async db=>{
   const hash=digest(event),prior=(await db.query('SELECT * FROM social_memory_receipts WHERE account_id=$1 AND event_id=$2',[event.accountId,event.eventId])).rows[0]
   if(prior){if(prior.request_hash!==hash)throw unavailable();return}
   const previous=(await db.query('SELECT * FROM social_memory_sources WHERE account_id=$1 AND memory_id=$2 FOR UPDATE',[event.accountId,event.memoryId])).rows[0]
   if(previous&&previous.person_id!==event.personId)throw unavailable()
   let outcome='stale'
   if(!previous||event.sourceVersion>previous.source_version){
    await db.query("INSERT INTO social_memory_sources(account_id,person_id,memory_id,source_version,state) VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_id,memory_id) DO UPDATE SET source_version=EXCLUDED.source_version,state=EXCLUDED.state,version=social_memory_sources.version+1,updated_at=clock_timestamp()",[event.accountId,event.personId,event.memoryId,event.sourceVersion,event.change==='remove'?'removed':'active'])
    await this.retire(db,event.accountId,event.memoryId,event.sourceVersion,event.change==='remove')
    if(event.change==='remove')outcome='removed'
    else if(eligible){
     const row=(await db.query<JobRow>("INSERT INTO social_generation_jobs(account_id,person_id,memory_id,memory_version,kind,person_version,person_access_version,account_access_version,authorization_version,ai_authorization_version,dispatch_id) VALUES($1,$2,$3,$4,'memory_echo',$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING *",[event.accountId,event.personId,event.memoryId,event.sourceVersion,person.version,person.accessVersion,account.accessVersion,account.storyStorage.authorizationVersion,event.echoAiAuthorizationVersion,randomUUID()])).rows[0]
     if(row)await this.queue.send(db,{jobId:row.id,dispatchId:row.dispatch_id,dispatchGeneration:row.dispatch_generation});outcome='accepted'
    }else outcome='ineligible'
   }
   await db.query('INSERT INTO social_memory_receipts(account_id,event_id,request_hash,outcome) VALUES($1,$2,$3,$4)',[event.accountId,event.eventId,hash,outcome])
  })
 }
 private async retire(db:PoolClient,accountId:string,memoryId:string,version:number,removed:boolean){
  const ids=(await db.query("SELECT id FROM posts WHERE account_id=$1 AND kind='memory_echo' AND source_memory_id=$2 AND status='active' AND ($4 OR source_memory_version<$3) FOR UPDATE",[accountId,memoryId,version,removed])).rows.map(r=>r.id)
  if(ids.length){await db.query("UPDATE post_comments SET status='removed',removed_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE account_id=$1 AND post_id=ANY($2::uuid[]) AND status='active'",[accountId,ids]);await db.query('DELETE FROM post_reactions WHERE account_id=$1 AND post_id=ANY($2::uuid[])',[accountId,ids]);await db.query("UPDATE posts SET status='removed',removed_at=clock_timestamp(),updated_at=clock_timestamp(),reaction_count=0,comment_count=0,version=version+1 WHERE account_id=$1 AND id=ANY($2::uuid[])",[accountId,ids])}
  await db.query("UPDATE social_generation_jobs SET state='blocked',lease_until=NULL,retryable=false,failure_code='CONTEXT_REVOKED',finished_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE account_id=$1 AND memory_id=$2 AND ($4 OR memory_version<$3) AND state IN ('queued','running','failed')",[accountId,memoryId,version,removed])
 }
 async admitComment(db:PoolClient,post:any,comment:any,account:Account,person:any){
  if(post.kind!=='memory_echo'||!permitsEcho(account)||!person)return
  const row=(await db.query<JobRow>("INSERT INTO social_generation_jobs(account_id,person_id,memory_id,memory_version,kind,post_id,source_comment_id,source_comment_version,person_version,person_access_version,account_access_version,authorization_version,ai_authorization_version,dispatch_id) VALUES($1,$2,$3,$4,'feed_reaction',$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING RETURNING *",[account.accountId,post.person_id,post.source_memory_id,post.source_memory_version,post.id,comment.id,comment.version,person.version,person.accessVersion,account.accessVersion,account.storyStorage.authorizationVersion,account.aiTextProcessing!.authorizationVersion,randomUUID()])).rows[0]
  if(row)await this.queue.send(db,{jobId:row.id,dispatchId:row.dispatch_id,dispatchGeneration:row.dispatch_generation})
 }
 async claim(dispatch:{jobId:string;dispatchId:string;dispatchGeneration:number}){
  const known=(await this.pool.query<JobRow>('SELECT * FROM social_generation_jobs WHERE id=$1',[dispatch.jobId])).rows[0];if(!known)return
  return this.tx(known.account_id,async db=>{
   const row=(await db.query<JobRow>('SELECT * FROM social_generation_jobs WHERE id=$1 FOR UPDATE',[known.id])).rows[0]
   if(!row||row.dispatch_id!==dispatch.dispatchId||row.dispatch_generation!==dispatch.dispatchGeneration||!['queued','running'].includes(row.state)||row.state==='running'&&row.lease_until!.getTime()>Date.now()||row.attempt_count>=3)return
   if((await db.query("SELECT 1 FROM social_generation_jobs WHERE account_id=$1 AND person_id=$2 AND state='running' AND id<>$3",[row.account_id,row.person_id,row.id])).rowCount)throw new Error('Person already generating')
   return (await db.query<JobRow>("UPDATE social_generation_jobs SET state='running',attempt_id=$2,attempt_count=attempt_count+1,lease_until=clock_timestamp()+interval '45 seconds',started_at=clock_timestamp(),finished_at=NULL,updated_at=clock_timestamp(),version=version+1 WHERE id=$1 RETURNING *",[row.id,randomUUID()])).rows[0]
  })
 }
 async authority(row:JobRow){
  const a=await this.deps.account(row.account_id)
  if(!permitsEcho(a)||a.aiTextProcessing!.authorizationVersion!==row.ai_authorization_version)throw new SocialError(403,'AI_PERMISSION_REQUIRED','Fresh permission is required.')
  if(a.accessVersion!==row.account_access_version||a.storyStorage.authorizationVersion!==row.authorization_version)throw new SocialError(403,'AUTHORIZATION_CHANGED','Permission changed.')
  if(!this.deps.echoMemory||!this.deps.echoPerson||!this.deps.echoWorld)throw unavailable()
  const memory=await this.deps.echoMemory(row.account_id,row.person_id,row.memory_id,row.memory_version,row.ai_authorization_version),person=await this.deps.echoPerson(row.account_id,row.person_id,row.ai_authorization_version),world=await this.deps.echoWorld(row.account_id,row.person_id,row.ai_authorization_version)
  if(person.version!==row.person_version||person.accessVersion!==row.person_access_version||world.personVersion!==person.version||world.worldVersion!==person.worldVersion||world.currentWorld.id!==person.worldId)throw new SocialError(409,'WORLD_CONTEXT_CHANGED','The character context changed.')
  return {a,memory,person,world}
 }
 async active(row:JobRow){const current=(await this.pool.query<JobRow>('SELECT state,attempt_id,lease_until FROM social_generation_jobs WHERE id=$1',[row.id])).rows[0];return !!current&&current.state==='running'&&current.attempt_id===row.attempt_id&&current.lease_until!.getTime()>Date.now()}
 async input(row:JobRow,signal:AbortSignal):Promise<{input:EchoInput;refs:MemoryRef[]}>{
  const context=await this.authority(row),refs:MemoryRef[]=[],input:EchoInput={jobId:row.id,attemptId:row.attempt_id!,accountId:row.account_id,kind:row.kind,aiAuthorizationVersion:row.ai_authorization_version,account:context.a,memory:context.memory,person:context.person,world:context.world,signal}
  if(row.kind==='feed_reaction'){
   const post=(await this.pool.query("SELECT * FROM posts WHERE account_id=$1 AND id=$2 AND kind='memory_echo' AND status='active' AND source_memory_id=$3 AND source_memory_version=$4",[row.account_id,row.post_id,row.memory_id,row.memory_version])).rows[0],comment=(await this.pool.query("SELECT * FROM post_comments WHERE account_id=$1 AND post_id=$2 AND id=$3 AND author_kind='self' AND status='active' AND version=$4",[row.account_id,row.post_id,row.source_comment_id,row.source_comment_version])).rows[0]
   if(!post||!comment)throw notFound();input.post={id:post.id,text:post.body};input.comment={id:comment.id,text:comment.body};refs.push({id:comment.id,version:comment.version})
   if(comment.reply_to_comment_id){
    const target=(await this.pool.query("SELECT c.*,j.context_comment_refs FROM post_comments c LEFT JOIN social_generation_jobs j ON j.account_id=c.account_id AND j.id=c.generation_job_id WHERE c.account_id=$1 AND c.post_id=$2 AND c.id=$3 AND c.status='active'",[row.account_id,row.post_id,comment.reply_to_comment_id])).rows[0]
    if(!target)throw notFound();input.target={id:target.id,authorKind:target.author_kind,text:target.body};refs.push({id:target.id,version:target.version},...(target.context_comment_refs??[]))
   }
  }
  const unique=new Map<string,number>();for(const ref of refs){if(unique.has(ref.id)&&unique.get(ref.id)!==ref.version)throw notFound();unique.set(ref.id,ref.version)}
  if(unique.size>16)throw new SocialError(409,'CONTEXT_LIMIT_EXCEEDED','The reply chain is too long.')
  const selected=[...unique].map(([id,version])=>({id,version}));if(!await this.validComments(row,selected))throw notFound()
  return {input,refs:selected}
 }
 async validComments(row:JobRow,refs:MemoryRef[],db:any=this.pool){if(!refs.length)return true;const records=(await db.query("SELECT id,version FROM post_comments WHERE account_id=$1 AND post_id=$2 AND id=ANY($3::uuid[]) AND status='active'",[row.account_id,row.post_id,refs.map(v=>v.id)])).rows;return refs.every(ref=>records.some((v:any)=>v.id===ref.id&&v.version===ref.version))}
 async complete(row:JobRow,text:string,original:EchoInput,refs:MemoryRef[]){
  const context=await this.authority(row)
  if(context.world.revision!==original.world.revision)throw new SocialError(409,'WORLD_CONTEXT_CHANGED','The scene changed.')
  return this.tx(row.account_id,async db=>{
   const current=(await db.query<JobRow>('SELECT * FROM social_generation_jobs WHERE id=$1 FOR UPDATE',[row.id])).rows[0]
   if(!current||current.state!=='running'||current.attempt_id!==row.attempt_id||current.lease_until!.getTime()<=Date.now())return false
   const source=(await db.query('SELECT * FROM social_memory_sources WHERE account_id=$1 AND memory_id=$2 FOR SHARE',[row.account_id,row.memory_id])).rows[0]
   if(!source||source.state!=='active'||source.source_version!==row.memory_version||!await this.validComments(row,refs,db))throw notFound()
   let resultId:string
   if(row.kind==='memory_echo'){
    if((await db.query("SELECT 1 FROM posts WHERE account_id=$1 AND source_memory_id=$2 AND source_memory_version=$3",[row.account_id,row.memory_id,row.memory_version])).rowCount)throw notFound()
    resultId=(await db.query("INSERT INTO posts(account_id,kind,body,person_id,world_id,source_memory_id,source_memory_version,source_excerpt,world_context_ref,generation_job_id) VALUES($1,'memory_echo',$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",[row.account_id,text,row.person_id,context.person.worldId,row.memory_id,row.memory_version,[...context.memory.body].slice(0,320).join(''),context.world,row.id])).rows[0].id
   }else{
    const post=(await db.query("SELECT * FROM posts WHERE account_id=$1 AND id=$2 AND status='active' AND kind='memory_echo' AND source_memory_version=$3 FOR UPDATE",[row.account_id,row.post_id,row.memory_version])).rows[0];if(!post)throw notFound()
    resultId=(await db.query("INSERT INTO post_comments(account_id,post_id,body,reply_to_comment_id,author_kind,person_id,display_name,generation_job_id) VALUES($1,$2,$3,$4,'persona',$5,$6,$7) RETURNING id",[row.account_id,row.post_id,text,row.source_comment_id,row.person_id,context.person.displayName,row.id])).rows[0].id
    await db.query("UPDATE posts SET comment_count=(SELECT count(*) FROM post_comments WHERE account_id=$1 AND post_id=$2 AND status='active'),version=version+1,updated_at=clock_timestamp() WHERE account_id=$1 AND id=$2",[row.account_id,row.post_id])
   }
   await db.query("UPDATE social_generation_jobs SET state='succeeded',lease_until=NULL,result_id=$2,world_context_ref=$3,context_comment_refs=$4::jsonb,retryable=false,finished_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE id=$1",[row.id,resultId,context.world,JSON.stringify(refs)]);return true
  })
 }
 async fail(row:JobRow,code:string,retryable:boolean,blocked=false){await this.tx(row.account_id,async db=>{await db.query("UPDATE social_generation_jobs SET state=$3,lease_until=NULL,failure_code=$4,retryable=$5,finished_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE id=$1 AND state='running' AND attempt_id=$2",[row.id,row.attempt_id,blocked?'blocked':'failed',code,!blocked&&retryable&&row.attempt_count<3])})}
 async release(row:JobRow){await this.tx(row.account_id,async db=>{await db.query("UPDATE social_generation_jobs SET state='queued',lease_until=NULL,attempt_id=NULL,updated_at=clock_timestamp(),version=version+1 WHERE id=$1 AND state='running' AND attempt_id=$2",[row.id,row.attempt_id])})}
 private dto(row:JobRow){return {id:row.id,kind:row.kind,state:row.state,version:row.version,...(row.result_id?{resultId:row.result_id}:{}),...(row.failure_code?{failure:{code:row.failure_code,retryable:row.retryable}}:{}),updatedAt:row.updated_at.toISOString()}}
 async job(accountId:string,id:string,storage=true){await this.social.access(accountId,storage);const row=(await this.pool.query<JobRow>('SELECT * FROM social_generation_jobs WHERE account_id=$1 AND id=$2',[accountId,id])).rows[0];if(!row)throw notFound();if(!(await this.deps.persons(accountId)).some(p=>p.id===row.person_id))throw notFound();await this.social.gate(this.pool,accountId);return row}
 async get(accountId:string,id:string){return this.dto(await this.job(accountId,id))}
 async command(accountId:string,id:string,key:string,expected:number,kind:'retry'|'cancel'){
  const row=await this.job(accountId,id,kind!=='cancel');const replay=(await this.pool.query('SELECT request_hash FROM social_commands WHERE account_id=$1 AND operation=$2 AND target=$3 AND idempotency_key=$4',[accountId,'generation_'+kind,id,key])).rows[0];if(replay){if(replay.request_hash!==digest({expected}))throw new SocialError(409,'IDEMPOTENCY_CONFLICT','The request identity changed.');return this.dto(row)}if(kind==='retry')await this.authority(row)
  await this.tx(accountId,async db=>{
   const operation='generation_'+kind,old=(await db.query('SELECT * FROM social_commands WHERE account_id=$1 AND operation=$2 AND target=$3 AND idempotency_key=$4',[accountId,operation,id,key])).rows[0],hash=digest({expected})
   if(old){if(old.request_hash!==hash)throw new SocialError(409,'IDEMPOTENCY_CONFLICT','The request identity changed.');return}
   const current=(await db.query<JobRow>('SELECT * FROM social_generation_jobs WHERE account_id=$1 AND id=$2 FOR UPDATE',[accountId,id])).rows[0];if(current.version!==expected)throw new SocialError(412,'VERSION_CONFLICT','The job changed.')
   if(kind==='retry'){
    if(current.state!=='failed'||!current.retryable||current.attempt_count>=3)throw new SocialError(409,'RETRY_NOT_ALLOWED','This job cannot be retried.')
    const next=(await db.query<JobRow>("UPDATE social_generation_jobs SET state='queued',dispatch_id=$2,dispatch_generation=dispatch_generation+1,attempt_id=NULL,lease_until=NULL,failure_code=NULL,retryable=false,finished_at=NULL,queued_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE id=$1 RETURNING *",[id,randomUUID()])).rows[0];await this.queue.send(db,{jobId:next.id,dispatchId:next.dispatch_id,dispatchGeneration:next.dispatch_generation})
   }else if(['queued','running','failed'].includes(current.state))await db.query("UPDATE social_generation_jobs SET state='canceled',lease_until=NULL,retryable=false,finished_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE id=$1",[id])
   await db.query('INSERT INTO social_commands(account_id,operation,target,idempotency_key,request_hash,resource_id) VALUES($1,$2,$3,$4,$5,$6)',[accountId,operation,id,key,hash,id])
  });return this.dto(await this.job(accountId,id,kind!=='cancel'))
 }
 async status(accountId:string){const a=await this.social.access(accountId);if(!permitsEcho(a))return {pending:0,failed:0,retryableJobIds:[] as string[]};const rows=(await this.pool.query<JobRow>("SELECT * FROM social_generation_jobs WHERE account_id=$1 AND ai_authorization_version=$2 AND state IN ('queued','running','failed') ORDER BY created_at DESC LIMIT 100",[accountId,a.aiTextProcessing!.authorizationVersion])).rows;const people=await this.deps.persons(accountId);let pending=0,failed=0;const ids:string[]=[];for(const r of rows){if(!people.some(p=>p.id===r.person_id)||!await this.social.validEchoMemory(r.account_id,r.person_id,r.memory_id,r.memory_version))continue;if(r.state==='failed'){failed++;if(r.retryable&&ids.length<50)ids.push(r.id)}else pending++}return {pending,failed,retryableJobIds:ids}}
 async reconcile(){const rows=(await this.pool.query<JobRow>("SELECT * FROM social_generation_jobs WHERE state='queued' OR (state='running' AND lease_until<clock_timestamp()) ORDER BY created_at LIMIT 50")).rows;for(const row of rows)await this.tx(row.account_id,async db=>{const current=(await db.query<JobRow>('SELECT * FROM social_generation_jobs WHERE id=$1 FOR UPDATE',[row.id])).rows[0];if(!current||!['queued','running'].includes(current.state)||current.state==='running'&&current.lease_until!.getTime()>Date.now())return;if(this.queue.isPending&&await this.queue.isPending(db,{jobId:row.id,dispatchId:row.dispatch_id,dispatchGeneration:row.dispatch_generation}))return;await db.query("UPDATE social_generation_jobs SET state='failed',lease_until=NULL,failure_code='DELIVERY_EXHAUSTED',retryable=(attempt_count<3),finished_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE id=$1",[row.id])})}
}
