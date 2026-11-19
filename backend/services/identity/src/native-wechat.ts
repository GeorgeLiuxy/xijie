import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto'
import type {Pool,PoolClient} from 'pg'
import type {IdentityConfig} from './config.js'
import {ExperienceProvider,type ExperienceState} from './experience.js'
import {NativeAuthError,NativeAuthStore} from './native-auth.js'
import {IdentityStore,type AttemptDraft} from './store.js'
import type {OidcProvider,VerifiedPrincipal} from './oidc.js'

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const proof=/^[A-Za-z0-9_-]{43,128}$/
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
const same=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b))
export class NativeWechatError extends NativeAuthError {}
type Owner={browserHash:string;expectedSessionId?:string;sessionHash?:string}
type PrivateState={sdkState:string;context?:ExperienceState;verificationId?:string;claimId?:string;principal?:VerifiedPrincipal;ticket?:string;verifiedUntil?:string}
type Row={attempt_id:string;connector_id:string;app_id:string;sdk_state_hash:string;phase:string;launch_key:string|null;complete_key:string|null;complete_fingerprint:string|null;lease_id:string|null;lease_until:Date|null;private_cipher:Buffer|null;expires_at:Date;
 browser_hash:string;expected_session_id:string|null;verifier_hash:string;launch_hash:string;transport:string;native_state:string;attempt_state:string;authorization_url:string|null;state_hash:string;purpose:'sign_in'|'switch'|'reauthenticate';expected_generation:string;current_generation:string}
type Database=Pick<PoolClient,'query'>

export function readNativeWechatConfig(identity:IdentityConfig){
 const flag=process.env.OIDC_WECHAT_NATIVE_ENABLED??'false'
 if(!['true','false'].includes(flag))throw Error('Invalid OIDC_WECHAT_NATIVE_ENABLED')
 const enabled=flag==='true',appId=process.env.WECHAT_NATIVE_APP_ID?.trim()??'',connectorId=process.env.LOGTO_WECHAT_NATIVE_CONNECTOR_ID?.trim()??''
 if(enabled&&(!identity.nativeHandoffEnabled||!/^wx[0-9A-Za-z]{16}$/.test(appId)||!/^[A-Za-z0-9_-]{1,128}$/.test(connectorId)))throw Error('Native WeChat requires a native handoff, public AppID and fixed connector')
 return{enabled,appId,connectorId,redirectUri:new URL('/native-auth/complete',identity.origin).href}
}

/** The only provider-specific work is the official connector transaction; OIDC remains authoritative. */
export class WechatExperience extends ExperienceProvider{
 async begin(authorizationUrl:string,connectorId:string,sdkState:string,redirectUri:string,allowRegister:boolean){
  const context=await this.initialize(authorizationUrl,null,'SignIn',allowRegister)
  const value=await this.api(context,'/api/experience/verification/social/'+connectorId+'/authorization-uri','POST',{state:sdkState,redirectUri})
  return{context,authorizationUri:this.requiredString(value,'authorizationUri'),verificationId:this.requiredString(value,'verificationId')}
 }
 async verifySocial(context:ExperienceState,connectorId:string,verificationId:string,code:string,state:string){
  const value=await this.api(context,'/api/experience/verification/social/'+connectorId+'/verify','POST',{verificationId,connectorData:{code,state}})
  context.verificationId=this.requiredString(value,'verificationId');context.stage='verified'
 }
 protected override async identify(context:ExperienceState){
  try{await this.api(context,'/api/experience/identification','POST',{verificationId:context.verificationId})}
  catch(error){
   if(context.allowRegister===true&&context.interactionEvent==='SignIn'&&(error as {code?:string}).code==='user.identity_not_exist'){
    await this.switchEvent(context,'Register');await this.api(context,'/api/experience/identification','POST',{verificationId:context.verificationId})
   }else throw error
  }
 }
 finish(context:ExperienceState){return this.completeSignIn(context)}
}

export class NativeWechatAuth{
 readonly enabled:boolean
 private readonly settings:ReturnType<typeof readNativeWechatConfig>
 private readonly key:Buffer
 private readonly provider:WechatExperience
 constructor(private readonly pool:Pool,private readonly identity:IdentityStore,private readonly native:NativeAuthStore,private readonly oidc:OidcProvider,private readonly config:IdentityConfig){
  this.settings=readNativeWechatConfig(config);this.enabled=this.settings.enabled
  this.key=createHash('sha256').update('xijie/wechat-sdk/v1:').update(config.clientSecret).digest()
  this.provider=new WechatExperience({...config,firstPartyClientId:config.firstPartyExperience?config.clientId:undefined})
 }
 private available(){if(!this.enabled)throw new NativeWechatError(503,'AUTH_PROVIDER_UNAVAILABLE')}
 private encrypt(id:string,value:PrivateState){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(Buffer.from(id));const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data])}
 private decrypt(row:Row):PrivateState{
  try{const value=row.private_cipher;if(!value||value.length<29)throw Error();const decipher=createDecipheriv('aes-256-gcm',this.key,value.subarray(0,12));decipher.setAAD(Buffer.from(row.attempt_id));decipher.setAuthTag(value.subarray(12,28));const parsed=JSON.parse(Buffer.concat([decipher.update(value.subarray(28)),decipher.final()]).toString('utf8')) as PrivateState;if(!/^[A-Za-z0-9_-]{43}$/.test(parsed.sdkState))throw Error();return parsed}
  catch{throw new NativeWechatError(409,'AUTH_RESTART_REQUIRED')}
 }
 private async tx<T>(work:(db:PoolClient)=>Promise<T>){const db=await this.pool.connect();try{await db.query('BEGIN');const result=await work(db);await db.query('COMMIT');return result}catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}}
 private async owned(id:string,owner:Owner,db:Database=this.pool,lock=false):Promise<Row>{
  this.available();if(!uuid.test(id)||!/^[a-f0-9]{64}$/.test(owner.browserHash)||owner.expectedSessionId!==undefined&&!uuid.test(owner.expectedSessionId))throw new NativeWechatError(400,'INVALID_ARGUMENT')
  const row=(await db.query<Row>(`SELECT w.*,n.browser_hash,n.expected_session_id,n.verifier_hash,n.launch_hash,n.transport,n.state native_state,a.state attempt_state,a.authorization_url,a.state_hash,a.purpose,a.expected_generation::text,s.generation::text current_generation
   FROM native_wechat_transactions w JOIN native_auth_handoffs n ON n.attempt_id=w.attempt_id JOIN auth_attempts a ON a.id=w.attempt_id JOIN app_session_slots s ON s.id=a.slot_id
   WHERE w.attempt_id=$1 AND a.social_provider='wechat' AND a.native_handoff=true ${lock?'FOR UPDATE OF w':''}`,[id])).rows[0]
  if(!row||row.transport!=='wechat_sdk'||!same(row.browser_hash,owner.browserHash)||row.expected_session_id!==(owner.expectedSessionId??null))throw new NativeWechatError(403,'AUTH_RESTART_REQUIRED')
  if(row.expires_at<=new Date())throw new NativeWechatError(410,'AUTH_RESTART_REQUIRED')
  if(row.phase==='cancelled'||row.native_state==='cancelled'||!['pending','completed'].includes(row.attempt_state)||row.expected_generation!==row.current_generation||row.connector_id!==this.settings.connectorId||row.app_id!==this.settings.appId)throw new NativeWechatError(409,'AUTH_RESTART_REQUIRED')
  if(owner.expectedSessionId){const session=owner.sessionHash?await this.identity.current(owner.sessionHash):null;if(!session||session.id!==owner.expectedSessionId)throw new NativeWechatError(409,'AUTH_RESTART_REQUIRED')}
  return row
 }
 async start(draft:AttemptDraft,extra:{expectedSessionId?:string;verifierChallenge:string;launchProof:string;transport?:'browser'|'wechat_sdk'}){
  this.available();if(draft.provider!=='wechat'||extra.transport!=='wechat_sdk')throw new NativeWechatError(400,'INVALID_ARGUMENT')
  const result=await this.native.start(draft,extra),state=randomBytes(32).toString('base64url')
  await this.pool.query(`INSERT INTO native_wechat_transactions(attempt_id,connector_id,app_id,sdk_state_hash,private_cipher,expires_at)
   SELECT $1,$2,$3,$4,$5,n.expires_at FROM native_auth_handoffs n WHERE n.attempt_id=$1 AND n.transport='wechat_sdk' ON CONFLICT(attempt_id)DO NOTHING`,[result.attemptId,this.settings.connectorId,this.settings.appId,hash(state),this.encrypt(result.attemptId,{sdkState:state})])
  return{attemptId:result.attemptId,expiresAt:result.expiresAt,transport:'wechat_sdk' as const,launchUrl:new URL('/v1/auth/native-wechat/'+result.attemptId+'/launch',this.config.origin).href}
 }
 async launch(id:string,input:Owner&{key:string;launchProof:string}){
  if(!uuid.test(input.key)||!proof.test(input.launchProof))throw new NativeWechatError(400,'INVALID_ARGUMENT')
  const leaseId=randomUUID(),reservation=await this.tx(async db=>{
   const row=await this.owned(id,input,db,true);if(!same(row.launch_hash,hash(input.launchProof)))throw new NativeWechatError(403,'AUTH_RESTART_REQUIRED')
   if(row.launch_key&&row.launch_key!==input.key)throw new NativeWechatError(409,'IDEMPOTENCY_CONFLICT')
   if(['waiting_provider','verifying','principal_verified','verified'].includes(row.phase))return{row,fresh:false}
   if(row.phase!=='pending')throw new NativeWechatError(row.phase==='launching'?503:409,row.phase==='launching'?'AUTH_RESULT_UNKNOWN':'AUTH_RESTART_REQUIRED')
   await db.query("UPDATE native_wechat_transactions SET phase='launching',launch_key=$2,lease_id=$3,lease_until=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp() WHERE attempt_id=$1",[id,input.key,leaseId])
   await db.query("UPDATE native_auth_handoffs SET state='launched',launch_used_at=clock_timestamp() WHERE attempt_id=$1 AND state='pending'",[id])
   return{row,fresh:true}
  })
  let state=this.decrypt(reservation.row)
  if(reservation.fresh){
   try{
    if(!reservation.row.authorization_url)throw new NativeWechatError(409,'AUTH_RESTART_REQUIRED')
    const value=await this.provider.begin(reservation.row.authorization_url,reservation.row.connector_id,state.sdkState,this.settings.redirectUri,reservation.row.purpose!=='reauthenticate')
    const uri=new URL(value.authorizationUri)
    if(uri.protocol!=='wechat:'||uri.username||uri.password||uri.hash||uri.searchParams.getAll('app_id').length!==1||uri.searchParams.get('app_id')!==reservation.row.app_id||uri.searchParams.getAll('state').length!==1||!same(uri.searchParams.get('state')??'',state.sdkState))throw new NativeWechatError(502,'AUTH_PROVIDER_UNAVAILABLE')
    state={...state,context:value.context,verificationId:value.verificationId}
    await this.tx(async db=>{await this.owned(id,input,db,true);const saved=await db.query("UPDATE native_wechat_transactions SET phase='waiting_provider',private_cipher=$3,lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE attempt_id=$1 AND lease_id=$2 AND phase='launching' AND lease_until>clock_timestamp()",[id,leaseId,this.encrypt(id,state)]);if(saved.rowCount!==1)throw new NativeWechatError(409,'AUTH_RESTART_REQUIRED')})
   }catch(error){await this.pool.query("UPDATE native_wechat_transactions SET phase='unknown',lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE attempt_id=$1 AND lease_id=$2",[id,leaseId]);if(error instanceof NativeAuthError)throw error;throw new NativeWechatError(503,'AUTH_PROVIDER_UNAVAILABLE')}
  }
  return{appId:reservation.row.app_id,state:state.sdkState,expiresAt:reservation.row.expires_at.toISOString()}
 }
 async complete(id:string,input:Owner&{key:string;code:string;state:string;verifier:string;requestId?:string}){
  if(!uuid.test(input.key)||!proof.test(input.verifier)||!/^[A-Za-z0-9_-]{43}$/.test(input.state)||typeof input.code!=='string'||input.code.length<1||input.code.length>1024||/[\x00-\x20\x7f]/.test(input.code))throw new NativeWechatError(400,'INVALID_ARGUMENT')
  const fingerprint=createHmac('sha256',this.key).update(id+'|'+JSON.stringify([input.code,input.state,hash(input.verifier)])).digest('hex'),leaseId=randomUUID()
  const reservation=await this.tx(async db=>{
   const row=await this.owned(id,input,db,true)
   if(!same(row.verifier_hash,hash(input.verifier))||!same(row.sdk_state_hash,hash(input.state)))throw new NativeWechatError(403,'AUTH_RESTART_REQUIRED')
   if(row.complete_key&&(row.complete_key!==input.key||row.complete_fingerprint!==fingerprint))throw new NativeWechatError(409,'IDEMPOTENCY_CONFLICT')
   const state=this.decrypt(row)
   if(row.phase==='verified')return{row,state,replay:true,resume:false}
   if(row.phase==='principal_verified')return{row,state,replay:false,resume:true}
   if(row.phase==='verifying')throw new NativeWechatError(row.lease_until&&row.lease_until>new Date()?503:409,row.lease_until&&row.lease_until>new Date()?'AUTH_RESULT_UNKNOWN':'AUTH_RESTART_REQUIRED')
   if(row.phase!=='waiting_provider'||!state.context||!state.verificationId)throw new NativeWechatError(409,'AUTH_RESTART_REQUIRED')
   await db.query("UPDATE native_wechat_transactions SET phase='verifying',complete_key=$2,complete_fingerprint=$3,lease_id=$4,lease_until=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp() WHERE attempt_id=$1",[id,input.key,fingerprint,leaseId])
   return{row,state,replay:false,resume:false}
  })
  const state=reservation.state
  if(reservation.replay){if(!state.ticket||!state.verifiedUntil||Date.parse(state.verifiedUntil)<=Date.now())throw new NativeWechatError(410,'AUTH_RESTART_REQUIRED');return{ticket:state.ticket,expiresAt:state.verifiedUntil}}
  let principalSaved=reservation.resume
  try{
   if(!reservation.resume){
    await this.provider.verifySocial(state.context!,reservation.row.connector_id,state.verificationId!,input.code,input.state)
    await this.owned(id,input)
    const finished=await this.provider.finish(state.context!)
    const callback=finished.callback,oauthState=callback.searchParams.get('state')
    if(!oauthState||callback.searchParams.getAll('state').length!==1||!same(hash(oauthState),reservation.row.state_hash))throw new NativeWechatError(403,'AUTH_RESTART_REQUIRED')
    state.claimId=randomUUID()
    const claim=await this.identity.claim({browserHash:input.browserHash,stateHash:reservation.row.state_hash,claimId:state.claimId})
    if(!claim||claim==='completed'||claim.clientRegistrationKey!==this.config.clientRegistrationKey)throw new NativeWechatError(409,'AUTH_RESTART_REQUIRED')
    state.principal=await this.oidc.exchange(callback,{state:oauthState,nonce:claim.nonce,verifier:claim.verifier,freshSince:claim.purpose!=='sign_in'?claim.createdAt:undefined})
    await this.tx(async db=>{await this.owned(id,input,db,true);const saved=await db.query("UPDATE native_wechat_transactions SET phase='principal_verified',private_cipher=$3,updated_at=clock_timestamp() WHERE attempt_id=$1 AND lease_id=$2 AND phase='verifying' AND lease_until>clock_timestamp()",[id,leaseId,this.encrypt(id,state)]);if(saved.rowCount!==1)throw new NativeWechatError(409,'AUTH_RESTART_REQUIRED')})
    principalSaved=true
   }
   await this.owned(id,input)
   if(!state.claimId||!state.principal)throw new NativeWechatError(409,'AUTH_RESTART_REQUIRED')
   const result=await this.native.publishSdkVerified({attemptId:id,browserHash:input.browserHash,expectedSessionId:input.expectedSessionId,verifier:input.verifier,claimId:state.claimId,principal:state.principal})
   state.ticket=result.ticket;state.verifiedUntil=result.expiresAt;delete state.context;delete state.verificationId
   await this.tx(async db=>{await this.owned(id,input,db,true);const saved=await db.query("UPDATE native_wechat_transactions SET phase='verified',private_cipher=$3,lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE attempt_id=$1 AND complete_key=$2 AND phase IN('principal_verified','verified')",[id,input.key,this.encrypt(id,state)]);if(saved.rowCount!==1)throw new NativeWechatError(409,'AUTH_RESTART_REQUIRED')})
   return result
  }catch(error){
   if(!principalSaved)await this.pool.query("UPDATE native_wechat_transactions SET phase='unknown',lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE attempt_id=$1 AND lease_id=$2 AND phase='verifying'",[id,leaseId])
   if(error instanceof NativeAuthError)throw error
   throw new NativeWechatError(503,'AUTH_RESULT_UNKNOWN')
  }
 }
 async sweep(){await this.pool.query('DELETE FROM native_wechat_transactions WHERE expires_at<clock_timestamp()')}
}
