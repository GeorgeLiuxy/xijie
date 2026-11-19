import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto'
import type {Pool} from 'pg'
import {IdentityStore,StoreError,type AttemptDraft,type StorePrincipal} from './store.js'
import type {OidcProvider,VerifiedPrincipal} from './oidc.js'

const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
const equal=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b))
export class NativeAuthError extends Error{constructor(readonly status:number,readonly code:string){super(code)}}
type Row={attempt_id:string;transport?:'browser'|'wechat_sdk';purpose?:'sign_in'|'switch'|'reauthenticate';browser_hash:string;expected_session_id:string|null;request_fingerprint:string;verifier_hash:string;launch_hash:string;external_browser_hash:string|null;state:string;claim_id:string|null;ticket_hash:string|null;private_cipher:Buffer|null;redeem_key:string|null;expires_at:Date;verified_until:Date|null}
type Reauthenticated={status:'reauthenticated';sessionId:string;reauthenticatedAt:string}
export class NativeAuthStore{
 private readonly key:Buffer
 constructor(private readonly pool:Pool,private readonly identity:IdentityStore,private readonly oidc:OidcProvider,private readonly config:{clientSecret:string;origin:string;clientRegistrationKey:string;nativeHandoffEnabled?:boolean}){this.key=createHash('sha256').update('xijie/native-auth/v1:').update(config.clientSecret).digest()}
 private enabled(){if(this.config.nativeHandoffEnabled!==true)throw new NativeAuthError(503,'AUTH_PROVIDER_UNAVAILABLE')}
 private encrypt(id:string,value:unknown){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(Buffer.from(id));const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data])}
 private decrypt(id:string,value:Buffer){try{const cipher=createDecipheriv('aes-256-gcm',this.key,value.subarray(0,12));cipher.setAAD(Buffer.from(id));cipher.setAuthTag(value.subarray(12,28));return JSON.parse(Buffer.concat([cipher.update(value.subarray(28)),cipher.final()]).toString('utf8'))}catch{throw new NativeAuthError(409,'AUTH_RESTART_REQUIRED')}}
 private returnUrl(id:string,ticket:string){const url=new URL('/native-auth/complete',this.config.origin);url.searchParams.set('attemptId',id);url.searchParams.set('ticket',ticket);return url.href}
 async start(draft:AttemptDraft,extra:{expectedSessionId?:string;verifierChallenge:string;launchProof:string;transport?:'browser'|'wechat_sdk'}){
  this.enabled();if(extra.transport==='wechat_sdk'&&draft.provider!=='wechat')throw new NativeAuthError(400,'INVALID_ARGUMENT');const fingerprint=hash(JSON.stringify([draft.provider,draft.purpose,extra.expectedSessionId??null,extra.verifierChallenge,hash(extra.launchProof),extra.transport??'browser']))
  const result=await this.identity.begin({...draft,nativeHandoff:true},async(db,id)=>{
   const prior=(await db.query<Row>('SELECT * FROM native_auth_handoffs WHERE attempt_id=$1 FOR UPDATE',[id])).rows[0]
   if(prior){if(prior.request_fingerprint!==fingerprint||prior.browser_hash!==draft.browserHash)throw new StoreError('IDEMPOTENCY_CONFLICT');return}
   await db.query(`INSERT INTO native_auth_handoffs(attempt_id,browser_hash,expected_session_id,request_fingerprint,verifier_hash,launch_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,draft.browserHash,extra.expectedSessionId??null,fingerprint,extra.verifierChallenge,hash(extra.launchProof),draft.expiresAt])
   if(extra.transport==='wechat_sdk')await db.query("UPDATE native_auth_handoffs SET transport='wechat_sdk' WHERE attempt_id=$1",[id])
  })
  const launch=new URL('/v1/auth/native-launch/'+result.id,this.config.origin);launch.searchParams.set('proof',extra.launchProof)
  return{attemptId:result.id,expiresAt:result.expiresAt.toISOString(),launchUrl:launch.href}
 }
 async launch(id:string,proof:string,externalBrowserHash:string){
  this.enabled();const result=await this.pool.query(`UPDATE native_auth_handoffs n SET state='launched',external_browser_hash=$3,launch_used_at=clock_timestamp() FROM auth_attempts a WHERE n.attempt_id=$1 AND COALESCE(to_jsonb(n)->>'transport','browser')='browser' AND a.id=n.attempt_id AND n.state='pending' AND n.expires_at>clock_timestamp() AND n.created_at>clock_timestamp()-interval '2 minutes' AND n.launch_hash=$2 AND a.state='pending' AND a.expires_at>clock_timestamp() RETURNING a.authorization_url`,[id,hash(proof),externalBrowserHash])
  if(!result.rows[0]?.authorization_url)throw new NativeAuthError(410,'AUTH_RESTART_REQUIRED')
  return result.rows[0].authorization_url as string
 }
 /** Internal bridge: only an already verified OIDC principal may be published, never a raw WeChat identity. */
 async publishSdkVerified(input:{attemptId:string;browserHash:string;expectedSessionId?:string;verifier:string;claimId:string;principal:VerifiedPrincipal}){
  this.enabled();const db=await this.pool.connect()
  try{
   await db.query('BEGIN')
   const row=(await db.query<Row>(`SELECT n.* FROM native_auth_handoffs n JOIN auth_attempts a ON a.id=n.attempt_id JOIN app_session_slots s ON s.id=a.slot_id WHERE n.attempt_id=$1 AND n.transport='wechat_sdk' AND a.social_provider='wechat' AND a.native_handoff=true AND a.state='pending' AND a.expires_at>clock_timestamp() AND a.exchange_claim_id=$2 AND a.exchange_lease_until>clock_timestamp() AND a.expected_generation=s.generation FOR UPDATE OF n`,[input.attemptId,input.claimId])).rows[0]
   if(!row||row.browser_hash!==input.browserHash||row.expected_session_id!==(input.expectedSessionId??null)||!equal(row.verifier_hash,hash(input.verifier))||row.expires_at.getTime()<=Date.now())throw new NativeAuthError(403,'AUTH_RESTART_REQUIRED')
   if(row.state==='verified'&&row.private_cipher&&row.claim_id===input.claimId&&row.verified_until&&row.verified_until>new Date()){
    const prior=this.decrypt(row.attempt_id,row.private_cipher);if(JSON.stringify(prior.principal)!==JSON.stringify(input.principal))throw new NativeAuthError(409,'AUTH_RESTART_REQUIRED');await db.query('COMMIT');return{ticket:prior.ticket as string,expiresAt:row.verified_until.toISOString()}
   }
   if(!['pending','launched'].includes(row.state))throw new NativeAuthError(409,'AUTH_RESTART_REQUIRED')
   const ticket=randomBytes(32).toString('base64url'),updated=(await db.query(`UPDATE native_auth_handoffs SET state='verified',claim_id=$2,ticket_hash=$3,private_cipher=$4,verified_until=LEAST(expires_at,clock_timestamp()+interval '90 seconds')WHERE attempt_id=$1 RETURNING verified_until`,[row.attempt_id,input.claimId,hash(ticket),this.encrypt(row.attempt_id,{principal:input.principal,ticket})])).rows[0]
   const lease=await db.query("UPDATE auth_attempts SET exchange_lease_until=$3 WHERE id=$1 AND exchange_claim_id=$2 AND state='pending'",[row.attempt_id,input.claimId,updated.verified_until]);if(lease.rowCount!==1)throw new NativeAuthError(409,'AUTH_RESTART_REQUIRED')
   await db.query('COMMIT');return{ticket,expiresAt:(updated.verified_until as Date).toISOString()}
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
 }
 async forState(stateHash:string){
  const row=(await this.pool.query<Row>(`SELECT n.*,a.id AS attempt_id FROM auth_attempts a LEFT JOIN native_auth_handoffs n ON a.id=n.attempt_id WHERE a.state_hash=$1 AND a.native_handoff=true`,[stateHash])).rows[0]
  return row??null
 }
 async callback(callback:URL,stateHash:string,externalBrowserHash:string):Promise<string>{
  this.enabled();const row=await this.forState(stateHash)
  if(!row||!row.external_browser_hash||!equal(row.external_browser_hash,externalBrowserHash)||row.expires_at.getTime()<=Date.now())throw new NativeAuthError(410,'AUTH_RESTART_REQUIRED')
  if(row.state==='verified'&&row.private_cipher&&row.verified_until&&row.verified_until.getTime()>Date.now()){const data=this.decrypt(row.attempt_id,row.private_cipher);return this.returnUrl(row.attempt_id,data.ticket)}
  if(row.state!=='launched')throw new NativeAuthError(409,'AUTH_RESTART_REQUIRED')
  const claimId=randomUUID(),attempt=await this.identity.claim({browserHash:row.browser_hash,stateHash,claimId})
  if(!attempt||attempt==='completed'||attempt.clientRegistrationKey!==this.config.clientRegistrationKey)throw new NativeAuthError(409,'AUTH_RESTART_REQUIRED')
  try{
   if(callback.searchParams.has('error'))throw new NativeAuthError(401,'AUTH_CANCELLED')
   const principal=await this.oidc.exchange(callback,{state:callback.searchParams.get('state')!,nonce:attempt.nonce,verifier:attempt.verifier,freshSince:attempt.purpose!=='sign_in'?attempt.createdAt:undefined})
   const ticket=randomBytes(32).toString('base64url'),db=await this.pool.connect();try{
    await db.query('BEGIN')
    const updated=await db.query(`UPDATE native_auth_handoffs SET state='verified',claim_id=$2,ticket_hash=$3,private_cipher=$4,verified_until=LEAST(expires_at,clock_timestamp()+interval '90 seconds') WHERE attempt_id=$1 AND state='launched' AND expires_at>clock_timestamp() RETURNING verified_until`,[row.attempt_id,claimId,hash(ticket),this.encrypt(row.attempt_id,{principal,ticket})])
    if(!updated.rowCount)throw new NativeAuthError(409,'AUTH_RESTART_REQUIRED')
    const leased=await db.query(`UPDATE auth_attempts SET exchange_lease_until=$3 WHERE id=$1 AND exchange_claim_id=$2 AND state='pending' AND exchange_lease_until>clock_timestamp()`,[row.attempt_id,claimId,updated.rows[0].verified_until]);if(!leased.rowCount)throw new NativeAuthError(409,'AUTH_RESTART_REQUIRED')
    await db.query('COMMIT')
   }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
   return this.returnUrl(row.attempt_id,ticket)
  }catch(error){await this.identity.fail({browserHash:row.browser_hash,attemptId:row.attempt_id,claimId});await this.pool.query("UPDATE native_auth_handoffs SET state='cancelled',private_cipher=NULL,ticket_hash=NULL WHERE attempt_id=$1 AND state IN('launched','verified')",[row.attempt_id]);throw error}
 }
 private async replay(row:Row|undefined,key:string,sessionHash?:string):Promise<string|Reauthenticated>{
  if(!row||row.state!=='redeemed'||row.redeem_key!==key||!row.private_cipher)throw new NativeAuthError(409,'AUTH_RESTART_REQUIRED')
  const data=this.decrypt(row.attempt_id,row.private_cipher)
  if(data.reauthentication){
   const current=sessionHash?await this.identity.current(sessionHash):null,result=data.reauthentication as Reauthenticated
   if(!current||current.id!==row.expected_session_id||result.status!=='reauthenticated'||result.sessionId!==current.id||!current.reauthenticatedAt||result.reauthenticatedAt!==current.reauthenticatedAt.toISOString())throw new NativeAuthError(409,'AUTH_RESTART_REQUIRED')
   return result
  }
  const current=typeof data.session==='string'?await this.identity.current(hash(data.session)):null
  if(!current)throw new NativeAuthError(409,'AUTH_RESTART_REQUIRED')
  return data.session as string
 }
 async redeem(id:string,input:{browserHash:string;sessionHash?:string;expectedSessionId?:string;key:string;verifier:string;ticket:string;requestId:string}):Promise<string|Reauthenticated>{
  this.enabled();const row=(await this.pool.query<Row>('SELECT n.*,a.purpose FROM native_auth_handoffs n JOIN auth_attempts a ON a.id=n.attempt_id WHERE n.attempt_id=$1',[id])).rows[0]
  if(!row||!equal(row.browser_hash,input.browserHash)||!equal(row.verifier_hash,hash(input.verifier))||!row.ticket_hash||!equal(row.ticket_hash,hash(input.ticket))||row.expected_session_id!==(input.expectedSessionId??null)||row.expires_at.getTime()<=Date.now()||!row.verified_until||row.verified_until.getTime()<=Date.now())throw new NativeAuthError(403,'AUTH_RESTART_REQUIRED')
  if(row.state==='redeemed')return this.replay(row,input.key,input.sessionHash)
  if(row.state!=='verified'||!row.private_cipher||!row.claim_id)throw new NativeAuthError(409,'AUTH_RESTART_REQUIRED')
  const data=this.decrypt(id,row.private_cipher),session=randomBytes(32).toString('base64url'),principal:StorePrincipal={issuer:data.principal.issuer,subject:data.principal.subject,authenticatedAt:data.principal.authTime===undefined?new Date():new Date(data.principal.authTime*1000),authenticationTimeVerified:Number.isSafeInteger(data.principal.authTime)}
  let reauthentication:Reauthenticated|undefined
  if(row.purpose==='reauthenticate'){
   const current=input.sessionHash?await this.identity.current(input.sessionHash):null
   if(!current||!input.expectedSessionId||current.id!==input.expectedSessionId||current.id!==row.expected_session_id||!Number.isSafeInteger(data.principal.authTime))throw new NativeAuthError(401,'UNAUTHENTICATED')
   reauthentication={status:'reauthenticated',sessionId:current.id,reauthenticatedAt:principal.authenticatedAt.toISOString()}
  }
  const accepted=await this.identity.finish({browserHash:input.browserHash,attemptId:id,claimId:row.claim_id,principal,sessionHash:hash(session),requestId:input.requestId},async db=>{
   const updated=await db.query(`UPDATE native_auth_handoffs SET state='redeemed',redeem_key=$2,redeemed_at=clock_timestamp(),private_cipher=$3 WHERE attempt_id=$1 AND state='verified' AND verified_until>clock_timestamp()`,[id,input.key,this.encrypt(id,reauthentication?{reauthentication}:{session})]);if(!updated.rowCount)throw new NativeAuthError(409,'AUTH_RESTART_REQUIRED')
  })
  if(accepted)return reauthentication??session
  const current=(await this.pool.query<Row>('SELECT * FROM native_auth_handoffs WHERE attempt_id=$1',[id])).rows[0];return this.replay(current,input.key,input.sessionHash)
 }
 async sweep(){await this.pool.query("DELETE FROM native_auth_handoffs WHERE expires_at<clock_timestamp()")}
 async cancel(browserHash:string,id:string){await this.pool.query("UPDATE native_auth_handoffs SET state='cancelled',private_cipher=NULL,ticket_hash=NULL WHERE attempt_id=$1 AND browser_hash=$2 AND state IN('pending','launched','verified')",[id,browserHash])}
}
