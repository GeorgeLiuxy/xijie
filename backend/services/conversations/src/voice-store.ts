import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID} from 'node:crypto'
import type {PoolClient} from 'pg'
import {ConversationStore} from './store.js'
import {VoiceError,standardVoice,type VoiceConfig,type StandardVoice} from './voice-provider.js'
import type {SessionContext,PersonContext} from './dependencies.js'
const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
export type CallRow={id:string;account_id:string;conversation_id:string;person_id:string;session_id:string;state:string;version:number;person_version:number;person_access_version:number;account_access_version:number;storage_version:number;voice_version:number;production_version:number|null;max_seconds:number;model:string;voice:StandardVoice;provider_session_id:string|null;attempt_id:string|null;server_owner:string|null;lease_until:Date|null;created_at:Date;expires_at:Date;started_at:Date|null;ended_at:Date|null;failure_code:string|null;stop_reason:string|null}
export function callDto(row:CallRow){return{id:row.id,conversationId:row.conversation_id,personId:row.person_id,mode:'voice' as const,state:row.state,version:row.version,createdAt:row.created_at.toISOString(),expiresAt:row.expires_at.toISOString(),startedAt:row.started_at?.toISOString()??null,endedAt:row.ended_at?.toISOString()??null,durationSeconds:row.started_at&&row.ended_at?Math.max(0,Math.floor((row.ended_at.getTime()-row.started_at.getTime())/1000)):null,maxSeconds:row.max_seconds,model:row.model,voice:row.voice,...(row.failure_code?{failure:{code:row.failure_code}}:{}),...(row.started_at?{endsBy:new Date(row.started_at.getTime()+row.max_seconds*1000).toISOString()}:{})}}
export class VoiceCallStore{
 private readonly key:Buffer
 constructor(readonly store:ConversationStore,readonly config:VoiceConfig,secret:string){this.key=createHash('sha256').update('xijie/voice-grant/v1:').update(secret).digest()}
 private encrypt(value:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv),data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data])}
 private decrypt(value:Buffer){const cipher=createDecipheriv('aes-256-gcm',this.key,value.subarray(0,12));cipher.setAuthTag(value.subarray(12,28));return Buffer.concat([cipher.update(value.subarray(28)),cipher.final()]).toString('utf8')}
 private async tx<T>(run:(db:PoolClient)=>Promise<T>){const db=await this.store.pool.connect();try{await db.query('BEGIN');const result=await run(db);await db.query('COMMIT');return result}catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}}
 private async fence(db:PoolClient,accountId:string){await db.query('INSERT INTO account_erasure_fences(account_id) VALUES($1) ON CONFLICT DO NOTHING',[accountId]);const row=(await db.query('SELECT erased_at FROM account_erasure_fences WHERE account_id=$1 FOR UPDATE',[accountId])).rows[0];if(row.erased_at)throw new VoiceError(403,'CONTEXT_REVOKED')}
 private permission(session:SessionContext){if(!session.storyStorage.allowed)throw new VoiceError(403,'STORAGE_PERMISSION_REQUIRED');if(!session.voiceCalls?.allowed||session.voiceCalls.authorizationVersion<1)throw new VoiceError(403,'VOICE_CALL_PERMISSION_REQUIRED')}
 async create(cookie:string,expected:string|undefined,conversationId:string,key:string){
  const session=await this.store.dependencies.session(cookie,expected);this.permission(session)
  const [{conversation,person},account]=await Promise.all([this.store.visible(session.accountId,conversationId),this.store.dependencies.account(session.accountId)])
  if(conversation.kind!=='direct'||!person||person.status!=='active')throw new VoiceError(400,'VOICE_DIRECT_ONLY')
  const production=(account as any).productionModelExecution
  if(process.env.NODE_ENV==='production'&&production?.allowed!==true)throw new VoiceError(403,'AI_PERMISSION_REQUIRED')
  if(!account.storyStorage.allowed||account.storyStorage.authorizationVersion!==session.storyStorage.authorizationVersion||!account.voiceCalls?.allowed||account.voiceCalls.authorizationVersion!==session.voiceCalls!.authorizationVersion)throw new VoiceError(403,'VOICE_CALL_PERMISSION_REQUIRED')
  return this.tx(async db=>{
   await this.fence(db,session.accountId);await db.query("SELECT pg_advisory_xact_lock(hashtextextended('voice-call:'||$1,0))",[session.accountId])
   const prior=(await db.query<CallRow>('SELECT * FROM call_sessions WHERE account_id=$1 AND idempotency_key=$2',[session.accountId,key])).rows[0]
   if(prior){if(prior.conversation_id!==conversationId||prior.session_id!==session.sessionId)throw new VoiceError(409,'IDEMPOTENCY_CONFLICT');return callDto(prior)}
   const recent=(await db.query("SELECT count(*)::integer AS n FROM call_sessions WHERE account_id=$1 AND created_at>clock_timestamp()-interval '1 minute'",[session.accountId])).rows[0];if(recent.n>=12)throw new VoiceError(429,'VOICE_RATE_LIMITED')
   const active=(await db.query('SELECT id FROM call_sessions WHERE account_id=$1 AND state IN(\'created\',\'connecting\',\'connected\',\'ending\')',[session.accountId])).rows[0];if(active)throw new VoiceError(409,'CALL_ALREADY_ACTIVE')
   const row=(await db.query<CallRow>(`INSERT INTO call_sessions(id,account_id,conversation_id,person_id,session_id,person_version,person_access_version,account_access_version,storage_version,voice_version,production_version,idempotency_key,max_seconds,model,voice,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,clock_timestamp()+interval '60 seconds') RETURNING *`,[randomUUID(),session.accountId,conversationId,person.id,session.sessionId,person.version,person.accessVersion,account.accessVersion,session.storyStorage.authorizationVersion,session.voiceCalls!.authorizationVersion,process.env.NODE_ENV==='production'?production.authorizationVersion:null,key,this.config.maxSeconds,this.config.model,standardVoice(person)])).rows[0]
   return callDto(row)
  })
 }
 async row(accountId:string,id:string){const row=(await this.store.pool.query<CallRow>('SELECT * FROM call_sessions WHERE account_id=$1 AND id=$2',[accountId,id])).rows[0];if(!row)throw new VoiceError(404,'NOT_FOUND');return row}
 async source(cookie:string,row:CallRow):Promise<PersonContext>{
  const session=await this.store.dependencies.session(cookie,row.session_id);this.permission(session)
  if(session.accountId!==row.account_id||session.storyStorage.authorizationVersion!==row.storage_version||session.voiceCalls!.authorizationVersion!==row.voice_version)throw new VoiceError(403,'VOICE_CALL_PERMISSION_REQUIRED')
  const [account,person]=await Promise.all([this.store.dependencies.account(row.account_id),this.store.dependencies.person(row.account_id,row.person_id)])
  const production=(account as any).productionModelExecution
  if(account.accessVersion!==row.account_access_version||!account.storyStorage.allowed||account.storyStorage.authorizationVersion!==row.storage_version||!account.voiceCalls?.allowed||account.voiceCalls.authorizationVersion!==row.voice_version||row.production_version!==null&&(production?.allowed!==true||production.authorizationVersion!==row.production_version)||person.status!=='active'||person.version!==row.person_version||person.accessVersion!==row.person_access_version)throw new VoiceError(403,'VOICE_CONTEXT_CHANGED')
  return person
 }
 async read(cookie:string,expected:string|undefined,id:string){const session=await this.store.dependencies.session(cookie,expected);if(!session.storyStorage.allowed)throw new VoiceError(403,'STORAGE_PERMISSION_REQUIRED');const row=await this.row(session.accountId,id);await this.store.dependencies.person(session.accountId,row.person_id);return callDto(row)}
 async list(cookie:string,expected:string|undefined,conversationId:string,after?:string){
  const session=await this.store.dependencies.session(cookie,expected);if(!session.storyStorage.allowed)throw new VoiceError(403,'STORAGE_PERMISSION_REQUIRED');await this.store.visible(session.accountId,conversationId)
  let cursor:{at:string;id:string}|undefined
  if(after)try{if(!/^[A-Za-z0-9_-]{1,200}$/.test(after))throw new Error();const parsed=JSON.parse(Buffer.from(after,'base64url').toString('utf8'));if(Object.keys(parsed).length!==2||typeof parsed.id!=='string'||! /^[a-f0-9-]{36}$/i.test(parsed.id)||typeof parsed.at!=='string'||new Date(parsed.at).toISOString()!==parsed.at||Buffer.from(JSON.stringify(parsed)).toString('base64url')!==after)throw new Error();cursor=parsed}catch{throw new VoiceError(400,'INVALID_ARGUMENT')}
  const rows=(await this.store.pool.query<CallRow>('SELECT * FROM call_sessions WHERE account_id=$1 AND conversation_id=$2 AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid)) ORDER BY created_at DESC,id DESC LIMIT 101',[session.accountId,conversationId,cursor?.at??null,cursor?.id??null])).rows,items=rows.slice(0,100),last=items.at(-1)
  return{items:items.map(callDto),nextCursor:rows.length>100&&last?Buffer.from(JSON.stringify({at:last.created_at.toISOString(),id:last.id})).toString('base64url'):null}
 }
 async grant(cookie:string,expected:string|undefined,id:string,key:string){
  const session=await this.store.dependencies.session(cookie,expected),row=await this.row(session.accountId,id);await this.source(cookie,row)
  return this.tx(async db=>{
   await this.fence(db,row.account_id);const current=(await db.query<CallRow>('SELECT * FROM call_sessions WHERE id=$1 FOR UPDATE',[id])).rows[0]
   if(!current||current.state!=='created'||current.expires_at.getTime()<=Date.now())throw new VoiceError(409,'CALL_NOT_JOINABLE')
   const prior=(await db.query<{token_cipher:Buffer;expires_at:Date}>('SELECT * FROM call_grants WHERE account_id=$1 AND call_id=$2 AND idempotency_key=$3',[row.account_id,id,key])).rows[0]
   if(prior)return{token:this.decrypt(prior.token_cipher),expiresAt:prior.expires_at.toISOString()}
   if(Number((await db.query('SELECT count(*) AS n FROM call_grants WHERE call_id=$1',[id])).rows[0].n)>=5)throw new VoiceError(429,'VOICE_RATE_LIMITED')
   const token=randomBytes(32).toString('base64url'),expires=new Date(Math.min(current.expires_at.getTime(),Date.now()+10000))
   await db.query('INSERT INTO call_grants(account_id,call_id,idempotency_key,token_hash,token_cipher,expires_at) VALUES($1,$2,$3,$4,$5,$6)',[row.account_id,id,key,hash(token),this.encrypt(token),expires]);return{token,expiresAt:expires.toISOString()}
  })
 }
 async claim(cookie:string,id:string,token:string,owner:string){
  const session=await this.store.dependencies.session(cookie),row=await this.row(session.accountId,id);await this.source(cookie,row)
  return this.tx(async db=>{
   await this.fence(db,row.account_id);const current=(await db.query<CallRow>('SELECT * FROM call_sessions WHERE id=$1 FOR UPDATE',[id])).rows[0]
   if(!current||current.state!=='created'||current.session_id!==session.sessionId||current.expires_at.getTime()<=Date.now())throw new VoiceError(409,'CALL_NOT_JOINABLE')
   const used=await db.query('UPDATE call_grants SET used_at=clock_timestamp() WHERE account_id=$1 AND call_id=$2 AND token_hash=$3 AND used_at IS NULL AND expires_at>clock_timestamp() RETURNING id',[row.account_id,id,hash(token)]);if(!used.rowCount)throw new VoiceError(403,'CALL_GRANT_INVALID')
   return(await db.query<CallRow>("UPDATE call_sessions SET state='connecting',attempt_id=$2,server_owner=$3,lease_until=clock_timestamp()+interval '15 seconds',version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *",[id,randomUUID(),owner])).rows[0]
  })
 }
 async connected(cookie:string,row:CallRow,sessionId:string){await this.source(cookie,row);return this.tx(async db=>{await this.fence(db,row.account_id);const result=await db.query<CallRow>("UPDATE call_sessions SET state='connected',provider_session_id=$4,started_at=clock_timestamp(),lease_until=clock_timestamp()+interval '10 seconds',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='connecting' AND attempt_id=$2 AND server_owner=$3 AND lease_until>clock_timestamp() AND expires_at>clock_timestamp() RETURNING *",[row.id,row.attempt_id,row.server_owner,sessionId]);if(!result.rowCount)throw new VoiceError(409,'CALL_NOT_JOINABLE');return result.rows[0]})}
 async beat(cookie:string,row:CallRow){await this.source(cookie,row);return(await this.store.pool.query<CallRow>("UPDATE call_sessions SET lease_until=clock_timestamp()+interval '10 seconds',updated_at=clock_timestamp() WHERE id=$1 AND attempt_id=$2 AND server_owner=$3 AND state IN('connecting','connected') AND lease_until>clock_timestamp() RETURNING *",[row.id,row.attempt_id,row.server_owner])).rows[0]??await this.row(row.account_id,row.id)}
 async end(cookie:string,expected:string|undefined,id:string){const session=await this.store.dependencies.session(cookie,expected);return this.tx(async db=>{const result=await db.query<CallRow>("UPDATE call_sessions SET state=CASE WHEN state='created' THEN 'ended' ELSE 'ending' END,stop_reason=COALESCE(stop_reason,'user_hangup'),version=version+1,updated_at=clock_timestamp() WHERE account_id=$1 AND id=$2 AND state IN('created','connecting','connected') RETURNING *",[session.accountId,id]);return callDto(result.rows[0]??await this.row(session.accountId,id))})}
 async finish(row:CallRow,confirmed:boolean,reason:string){const result=await this.store.pool.query<CallRow>(`UPDATE call_sessions SET state=CASE WHEN started_at IS NOT NULL AND $4 OR started_at IS NULL AND $5='user_hangup' THEN 'ended' ELSE 'failed' END,ended_at=CASE WHEN started_at IS NOT NULL AND $4 THEN clock_timestamp() ELSE NULL END,failure_code=CASE WHEN NOT $4 AND started_at IS NOT NULL THEN 'VOICE_TERMINATION_UNCONFIRMED' WHEN started_at IS NULL AND $5<>'user_hangup' THEN $5 ELSE NULL END,stop_reason=$5,lease_until=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND attempt_id=$2 AND server_owner=$3 AND state IN('connecting','connected','ending') RETURNING *`,[row.id,row.attempt_id,row.server_owner,confirmed,reason]);return result.rows[0]}
 async recover(){await this.store.pool.query("UPDATE call_sessions SET state=CASE WHEN state='created' THEN 'expired' ELSE 'failed' END,failure_code=CASE WHEN state='created' THEN 'CALL_EXPIRED' ELSE 'VOICE_CONNECTION_INTERRUPTED' END,lease_until=NULL,version=version+1,updated_at=clock_timestamp() WHERE (state='created' AND expires_at<=clock_timestamp()) OR(state IN('connecting','connected','ending') AND lease_until<clock_timestamp())");await this.store.pool.query("UPDATE call_sessions SET state='expired',failure_code='CALL_EXPIRED',version=version+1 WHERE state='ending' AND attempt_id IS NULL AND expires_at<=clock_timestamp()");await this.store.pool.query("DELETE FROM call_grants g USING call_sessions c WHERE g.call_id=c.id AND c.state IN('ended','failed','expired') AND g.expires_at<clock_timestamp()")}
}
