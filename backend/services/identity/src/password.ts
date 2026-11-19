import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes,randomUUID} from 'node:crypto'
import type {Pool,PoolClient} from 'pg'
import type {IdentityConfig} from './config.js'
import {ExperienceProvider,ExperienceError,type ExperienceState} from './experience.js'
import type {OidcProvider} from './oidc.js'
import {IdentityStore,StoreError} from './store.js'
import {PasswordError,PasswordMetadata} from './password-provider.js'

const hash=(v:string)=>createHash('sha256').update(v).digest('hex')
const token=()=>randomBytes(32).toString('base64url')
type Scope={browserHash:string;sessionHash:string|null;expectedSessionId?:string}
type Purpose='manage'|'reset'
type Row={id:string;browser_hash:string;scope_generation:number;purpose:Purpose;phone_hash:string;phase:string;initiating_session_id:string|null;initiating_account_id:string|null;account_id:string|null;auth_identity_id:string|null;context_cipher:string|null;operation_key:string|null;password_hash:string|null;verify_key:string|null;code_hash:string|null;last_result:'incorrect'|'expired'|null;mutation_claim:string|null;lease_until:Date|null;created_at:Date;expires_at:Date;resend_at:Date}
type Context={provider:ExperienceState;subject?:string}
const expired=()=>new PasswordError(410,'AUTH_CHALLENGE_EXPIRED')
const conflict=()=>new PasswordError(409,'CONFLICT')
const scopeChanged=()=>new PasswordError(409,'IDENTITY_SCOPE_CHANGED')

/** Logto owns the password hash. This service stores only encrypted interactions and per-operation receipts. */
export class PasswordAuth {
  private readonly key:Buffer
  private readonly provider:ExperienceProvider
  private readonly metadata:PasswordMetadata
  constructor(private readonly pool:Pool,private readonly config:IdentityConfig,private readonly store:IdentityStore,private readonly oidc:OidcProvider){
    this.key=createHash('sha256').update('xijie/password-operation/v1:').update(config.clientSecret).digest()
    this.provider=new ExperienceProvider({...config,firstPartyClientId:config.firstPartyExperience?config.clientId:undefined})
    this.metadata=new PasswordMetadata(config);store.useCredentialFences()
  }
  private proof(value:string){return createHmac('sha256',this.key).update(value).digest('hex')}
  private seal(id:string,value:unknown){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(Buffer.from(id));const body=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64url')}
  private open<T>(id:string,value:string):T{const data=Buffer.from(value,'base64url'),cipher=createDecipheriv('aes-256-gcm',this.key,data.subarray(0,12));cipher.setAAD(Buffer.from(id));cipher.setAuthTag(data.subarray(12,28));return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString('utf8')) as T}
  private async tx<T>(run:(db:PoolClient)=>Promise<T>){const db=await this.pool.connect();try{await db.query('BEGIN');const result=await run(db);await db.query('COMMIT');return result}catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}}
  private map(error:unknown):Error{
    if(error instanceof PasswordError||error instanceof StoreError)return error
    if(error instanceof ExperienceError){
      if(error.status===429||/rate.limit|rate_limit|send.*limit/.test(error.code))return new PasswordError(429,'AUTH_RATE_LIMITED',60)
      if(error.code.startsWith('password_rejected.'))return new PasswordError(422,'AUTH_PASSWORD_POLICY_REJECTED')
      if(/invalid_credentials|user_not_exist|user\.not_exist|password\.expired/.test(error.code))return new PasswordError(401,'AUTH_INVALID_CREDENTIALS')
    }
    return new PasswordError(503,'AUTH_PROVIDER_UNAVAILABLE')
  }
  policy(){return this.metadata.policy()}
  close(){return this.metadata.close()}
  private async identityForSession(sessionHash:string,expected?:string){
    const current=await this.store.current(sessionHash)
    if(!current||!expected||current.id!==expected)throw new PasswordError(401,'UNAUTHENTICATED')
    const identity=(await this.pool.query<{id:string;issuer:string;subject:string}>(`SELECT i.id,i.issuer,i.subject FROM app_sessions s JOIN auth_identities i ON i.id=s.auth_identity_id WHERE s.id=$1 AND i.status='active'`,[current.id])).rows[0]
    if(!identity||identity.issuer!==this.config.issuer.href.replace(/\/$/,''))throw new PasswordError(503,'AUTH_PROVIDER_UNAVAILABLE')
    return{current,identity}
  }
  async authentication(sessionHash:string,expected?:string){
    const{identity}=await this.identityForSession(sessionHash,expected),[phone,policy]=await Promise.all([this.metadata.boundPhone(identity.subject),this.policy()])
    const providers=(await this.pool.query<{social_provider:string}>(`SELECT DISTINCT a.social_provider FROM app_sessions s JOIN auth_attempts a ON a.id=s.auth_attempt_id WHERE s.account_id=(SELECT account_id FROM auth_identities WHERE id=$1) AND a.social_provider IS NOT NULL`,[identity.id])).rows.map(r=>r.social_provider)
    const legacySocial=!phone&&providers.length===0
    return{password:{canManage:!!phone&&policy.enabled&&policy.resetEnabled,phoneBound:!!phone,maskedPhone:phone?'+'+'*'.repeat(phone.length-4)+phone.slice(-4):null},reauthenticationMethods:{sms:!!phone,social:(['apple','google','wechat'] as const).filter(p=>this.config.socialProviders?.[p]===true&&(legacySocial||providers.includes(p)))}}
  }
  async login(input:Scope&{key:string;phone:string;password:string;purpose:'sign_in'|'switch';requestId:string}){
    const policy=await this.policy();if(!policy.enabled)throw new PasswordError(503,'AUTH_PROVIDER_UNAVAILABLE')
    const fingerprint=this.proof(JSON.stringify(['login',input.browserHash,input.key,input.phone,input.password,input.purpose,input.expectedSessionId??null])),phoneHash=this.proof('phone:'+input.phone)
    const reserved=await this.tx(async db=>{
      for(const key of ['browser:'+input.browserHash,'phone:'+phoneHash].sort())await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['xijie/password-login/'+key])
      const prior=(await db.query('SELECT * FROM auth_password_logins WHERE browser_hash=$1 AND idempotency_key=$2',[input.browserHash,input.key])).rows[0]
      if(prior){if(prior.request_hash!==fingerprint)throw new PasswordError(409,'IDEMPOTENCY_CONFLICT');if(prior.phase==='completed'&&prior.result_cipher&&prior.expires_at>new Date())return{row:prior,replay:true};throw conflict()}
      const count=(await db.query('SELECT count(*)::int n FROM auth_password_logins WHERE (browser_hash=$1 OR phone_hash=$2) AND created_at>clock_timestamp()-interval \'10 minutes\'',[input.browserHash,phoneHash])).rows[0].n
      if(count>=10)throw new PasswordError(429,'AUTH_RATE_LIMITED',600)
      const row=(await db.query("INSERT INTO auth_password_logins(id,browser_hash,idempotency_key,request_hash,phone_hash,phase)VALUES($1,$2,$3,$4,$5,'running')RETURNING *",[randomUUID(),input.browserHash,input.key,fingerprint,phoneHash])).rows[0];return{row,replay:false}
    })
    const row=reserved.row
    if(reserved.replay){const session=this.open<string>(row.id,row.result_cipher);if(!await this.store.current(hash(session)))throw conflict();return session}
    let claimId:string|undefined,attemptId:string|undefined
    try{
      const state=token(),nonce=token(),verifier=token(),authorizationUrl=await this.oidc.authorize({state,nonce,verifier,fresh:true})
      const attempt=await this.store.begin({id:row.id,password:true,browserHash:input.browserHash,sessionHash:input.sessionHash,key:'password:'+input.key,purpose:input.purpose,clientRegistrationKey:this.config.clientRegistrationKey,stateHash:hash(state),nonce,verifier,authorizationUrl,expiresAt:new Date(Date.now()+300000)})
      attemptId=attempt.id;await this.pool.query('UPDATE auth_password_logins SET attempt_id=$2 WHERE id=$1',[row.id,attempt.id])
      const result=await this.provider.passwordSignIn(attempt.authorizationUrl,input.phone,input.password)
      if(result.callback.searchParams.get('state')!==state)throw conflict()
      claimId=randomUUID();const claimed=await this.store.claim({browserHash:input.browserHash,stateHash:hash(state),claimId})
      if(!claimed||claimed==='completed')throw conflict()
      const principal=await this.oidc.exchange(result.callback,{state,nonce:claimed.nonce,verifier:claimed.verifier,freshSince:claimed.createdAt}),session=token()
      const accepted=await this.store.finish({browserHash:input.browserHash,attemptId:attempt.id,claimId,sessionHash:hash(session),requestId:input.requestId,principal:{issuer:principal.issuer,subject:principal.subject,authenticatedAt:new Date((principal.authTime??Math.floor(Date.now()/1000))*1000)}},async db=>{await db.query("UPDATE auth_password_logins SET phase='completed',result_cipher=$2 WHERE id=$1",[row.id,this.seal(row.id,session)])})
      if(!accepted)throw scopeChanged();return session
    }catch(error){await this.pool.query("UPDATE auth_password_logins SET phase='failed',result_cipher=NULL WHERE id=$1 AND phase='running'",[row.id]);if(attemptId&&claimId)await this.store.fail({browserHash:input.browserHash,attemptId,claimId});throw this.map(error)}
  }
  private dto(row:Row){return{id:row.id,purpose:row.purpose,expiresAt:row.expires_at.toISOString(),resendAt:row.resend_at.toISOString()}}
  private async assertScope(db:PoolClient,row:Row,input:Scope){
    if(row.browser_hash!==input.browserHash)throw new PasswordError(404,'NOT_FOUND')
    const generation=(await db.query<{generation:number}>('SELECT generation FROM app_session_slots WHERE binding_hash=$1',[row.browser_hash])).rows[0]?.generation??0
    if(generation!==row.scope_generation)throw scopeChanged()
    const current=input.sessionHash?await this.store.current(input.sessionHash):null
    if(row.initiating_session_id){
      if(input.expectedSessionId!==row.initiating_session_id||!input.sessionHash)throw scopeChanged()
      const bound=(await db.query('SELECT id FROM app_sessions WHERE id=$1 AND credential_hash=$2',[row.initiating_session_id,input.sessionHash])).rowCount===1
      if(!bound||current&&current.id!==row.initiating_session_id)throw scopeChanged()
      if(!current&&!['saving','unknown','completed'].includes(row.phase))throw scopeChanged()
    }else if(current||input.expectedSessionId!==undefined)throw scopeChanged()
  }
  private async row(db:PoolClient,id:string,input:Scope,lock=true){const row=(await db.query<Row>('SELECT * FROM auth_password_challenges WHERE id=$1 AND browser_hash=$2'+(lock?' FOR UPDATE':''),[id,input.browserHash])).rows[0];if(!row)throw new PasswordError(404,'NOT_FOUND');await this.assertScope(db,row,input);return row}
  async start(input:Scope&{key:string;purpose:Purpose;phone?:string}){
    const policy=await this.policy();if(!policy.resetEnabled||input.purpose==='manage'&&!policy.enabled)throw new PasswordError(503,'AUTH_PROVIDER_UNAVAILABLE')
    let phone:string|null|undefined=input.phone,initiator:{id:string;accountId:string}|null=null,expectedIdentityId:string|null=null
    if(input.purpose==='manage'){
      if(!input.sessionHash)throw new PasswordError(401,'UNAUTHENTICATED')
      const own=await this.identityForSession(input.sessionHash,input.expectedSessionId);phone=await this.metadata.boundPhone(own.identity.subject);initiator=own.current;expectedIdentityId=own.identity.id
      if(!phone)throw new PasswordError(409,'AUTH_PHONE_NOT_BOUND')
    }else if(input.expectedSessionId!==undefined){if(!input.sessionHash)throw scopeChanged();const active=await this.store.current(input.sessionHash);if(!active||active.id!==input.expectedSessionId)throw scopeChanged();initiator=active}
    else if(input.sessionHash&&await this.store.current(input.sessionHash))throw scopeChanged()
    if(!phone)throw new PasswordError(400,'INVALID_ARGUMENT')
    const normalized=phone.replace(/^\+/,''),phoneHash=this.proof('phone:'+normalized)
    const reserved=await this.tx(async db=>{
      for(const key of ['browser:'+input.browserHash,'phone:'+phoneHash].sort())await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['xijie/password-challenge/'+key])
      const prior=(await db.query<Row>('SELECT * FROM auth_password_challenges WHERE browser_hash=$1 AND idempotency_key=$2',[input.browserHash,input.key])).rows[0]
      if(prior){await this.assertScope(db,prior,input);if(prior.purpose!==input.purpose||prior.phone_hash!==phoneHash)throw new PasswordError(409,'IDEMPOTENCY_CONFLICT');if(prior.expires_at<=new Date()||prior.phase==='expired')throw expired();if(prior.phase==='preparing')throw conflict();return{row:prior,fresh:false}}
      const rate=(await db.query('SELECT ceil(extract(epoch FROM max(resend_at)-clock_timestamp()))::int seconds FROM auth_password_challenges WHERE(browser_hash=$1 OR phone_hash=$2)AND resend_at>clock_timestamp()',[input.browserHash,phoneHash])).rows[0].seconds
      if(rate>0)throw new PasswordError(429,'AUTH_RATE_LIMITED',rate)
      const generation=(await db.query<{generation:number}>('SELECT generation FROM app_session_slots WHERE binding_hash=$1',[input.browserHash])).rows[0]?.generation??0
      const row=(await db.query<Row>("INSERT INTO auth_password_challenges(id,browser_hash,idempotency_key,phone_hash,purpose,initiating_session_id,initiating_account_id,scope_generation,auth_identity_id,account_id,phase)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'preparing')RETURNING *",[randomUUID(),input.browserHash,input.key,phoneHash,input.purpose,initiator?.id??null,initiator?.accountId??null,generation,expectedIdentityId,expectedIdentityId?initiator?.accountId??null:null])).rows[0];return{row,fresh:true}
    })
    if(!reserved.fresh)return this.dto(reserved.row)
    const row=reserved.row
    try{
      await this.tx(async db=>{await this.row(db,row.id,input)})
      const authorizationUrl=await this.oidc.authorize({state:token(),nonce:token(),verifier:token(),fresh:true}),provider=await this.provider.startPasswordReset(authorizationUrl,normalized)
      await this.tx(async db=>{const live=await this.row(db,row.id,input);if(live.phase!=='preparing'||live.expires_at<=new Date())throw expired();await db.query("UPDATE auth_password_challenges SET phase='awaiting_code',context_cipher=$2,updated_at=clock_timestamp()WHERE id=$1",[row.id,this.seal(row.id,{provider} satisfies Context)])})
      return this.dto(row)
    }catch(error){await this.pool.query("UPDATE auth_password_challenges SET phase='expired',context_cipher=NULL WHERE id=$1",[row.id]);throw this.map(error)}
  }
  async verify(input:Scope&{id:string;key:string;code:string}){
    const codeHash=this.proof(input.id+':'+input.code)
    const row=await this.tx(async db=>{const row=await this.row(db,input.id,input);if(row.expires_at<=new Date()||row.phase==='expired')throw expired();if(row.verify_key===input.key&&row.code_hash!==codeHash)throw new PasswordError(409,'IDEMPOTENCY_CONFLICT');if(row.phase==='verified')return row;if(row.verify_key===input.key&&row.last_result)return row;if(row.phase!=='awaiting_code')throw conflict();await db.query("UPDATE auth_password_challenges SET phase='verifying',verify_key=$2,code_hash=$3,last_result=NULL,lease_until=clock_timestamp()+interval '30 seconds' WHERE id=$1",[row.id,input.key,codeHash]);return row})
    if(row.phase==='verified')return{status:'verified' as const};if(row.verify_key===input.key&&row.last_result)return{status:row.last_result}
    const context=this.open<Context>(row.id,row.context_cipher!)
    try{
      const subject=await this.provider.verifyPasswordReset(context.provider,input.code);context.subject=subject
      await this.tx(async db=>{
        const live=await this.row(db,row.id,input);if(live.phase!=='verifying'||live.expires_at<=new Date())throw expired()
        const identity=(await db.query<{id:string;account_id:string}>("SELECT i.id,i.account_id FROM auth_identities i JOIN accounts a ON a.id=i.account_id WHERE i.issuer=$1 AND i.subject=$2 AND i.status='active' AND a.status='active'",[this.config.issuer.href.replace(/\/$/,''),subject])).rows[0]
        if(row.purpose==='manage'&&(!identity||identity.account_id!==row.initiating_account_id||identity.id!==row.auth_identity_id))throw scopeChanged()
        await db.query("UPDATE auth_password_challenges SET phase='verified',context_cipher=$2,auth_identity_id=$3,account_id=$4,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1",[row.id,this.seal(row.id,context),identity?.id??null,identity?.account_id??null])
      });return{status:'verified' as const}
    }catch(error){
      if(error instanceof ExperienceError&&/verification_code.*(mismatch|incorrect|invalid|expired|not_found|exceed_max_try|verify_failed)/.test(error.code)){
        const status=/expired|not_found|exceed_max_try/.test(error.code)?'expired':'incorrect';await this.pool.query("UPDATE auth_password_challenges SET phase=$2,context_cipher=$3,last_result=$4,lease_until=NULL WHERE id=$1 AND phase='verifying'",[row.id,status==='expired'?'expired':'awaiting_code',status==='expired'?null:this.seal(row.id,context),status]);return{status}
      }
      await this.pool.query("UPDATE auth_password_challenges SET phase='expired',context_cipher=NULL,lease_until=NULL WHERE id=$1 AND phase='verifying'",[row.id]);throw this.map(error)
    }
  }
  async status(input:Scope&{id:string}){
    return this.tx(async db=>{const row=await this.row(db,input.id,input,false);let status=row.phase;if(['preparing','verifying'].includes(status))status='awaiting_code';if(status==='staging')status='saving';if((status==='saving'||status==='staging')&&row.lease_until&&row.lease_until<=new Date())status='unknown';if(row.expires_at<=new Date()&&!['completed','unknown','saving'].includes(status))status='expired';return{id:row.id,purpose:row.purpose,status,expiresAt:row.expires_at.toISOString()}})
  }
  async cancel(input:Scope&{id:string}){
    await this.tx(async db=>{const row=await this.row(db,input.id,input);if(['saving','unknown','completed','staging'].includes(row.phase))throw conflict();await db.query("UPDATE auth_password_challenges SET phase='expired',context_cipher=NULL,code_hash=NULL WHERE id=$1",[row.id])})
  }
  async save(input:Scope&{id:string;key:string;password:string}){
    const fingerprint=this.proof(JSON.stringify(['save',input.id,input.password]))
    const mutationClaim=randomUUID()
    const row=await this.tx(async db=>{
      const row=await this.row(db,input.id,input);if(row.operation_key&&(row.operation_key!==input.key||row.password_hash!==fingerprint))throw new PasswordError(409,'IDEMPOTENCY_CONFLICT')
      if(row.phase==='completed')return row
      if(row.expires_at<=new Date())throw expired()
      if(!['verified','unknown','saving','staging'].includes(row.phase))throw conflict()
      if(['saving','staging'].includes(row.phase)&&row.lease_until&&row.lease_until>new Date())throw conflict()
      if(row.phase==='staging'){row.phase='verified'}
      await db.query("UPDATE auth_password_challenges SET phase=$2,operation_key=$3,password_hash=$4,mutation_claim=$5,lease_until=clock_timestamp()+interval '30 seconds',updated_at=clock_timestamp() WHERE id=$1",[row.id,row.phase==='verified'?'staging':'saving',input.key,fingerprint,mutationClaim]);row.mutation_claim=mutationClaim;return row
    })
    if(row.phase==='completed')return{status:'completed' as const,requiresSignIn:true as const}
    const context=this.open<Context>(row.id,row.context_cipher!)
    if(!context.subject)throw expired()
    let submitted=row.phase==='unknown'||row.phase==='saving'
    try{
      if(submitted){
        const authorization=await this.oidc.authorize({state:token(),nonce:token(),verifier:token(),fresh:true})
        let matches=false
        try{matches=await this.provider.passwordSubject(authorization,context.provider.phone,input.password)===context.subject}catch(error){if(!(error instanceof ExperienceError)||!(/invalid_credentials|password\.expired/.test(error.code)))throw error}
        if(matches){await this.complete(row,context.subject,input);return{status:'completed' as const,requiresSignIn:true as const}}
        if(context.provider.stage!=='staged'||await this.provider.interactionSubject(context.provider)!==context.subject)throw new PasswordError(503,'AUTH_PROVIDER_UNAVAILABLE')
      }else{
        const policy=await this.policy();if(!policy.resetEnabled)throw new PasswordError(503,'AUTH_PROVIDER_UNAVAILABLE')
        if(context.provider.stage!=='staged')await this.provider.stagePassword(context.provider,input.password)
        // The provider has validated and staged its own hash. Persist that context before changing credentials.
        const saved=await this.pool.query("UPDATE auth_password_challenges SET context_cipher=$2 WHERE id=$1 AND phase='staging' AND mutation_claim=$3",[row.id,this.seal(row.id,context),mutationClaim]);if(saved.rowCount!==1)throw conflict()
      }
      await this.fence(row,context,input)
      submitted=true
      // The access-version fence already revoked authority atomically. Scrub physical session state
      // outside the subject/account transaction to preserve the existing slot→attempt→subject lock order.
      if(row.account_id)await this.pool.query("UPDATE app_sessions s SET status='revoked',revoked_at=clock_timestamp(),reauthenticated_at=NULL FROM accounts a WHERE s.account_id=$1 AND a.id=s.account_id AND s.account_access_version<a.access_version AND s.status='active'",[row.account_id])
      await this.provider.submitPassword(context.provider)
      await this.complete(row,context.subject,input)
      return{status:'completed' as const,requiresSignIn:true as const}
    }catch(error){
      await this.pool.query("UPDATE auth_password_challenges SET phase=$2,context_cipher=$3,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1 AND phase IN('staging','saving') AND mutation_claim=$4",[row.id,submitted?'unknown':'verified',this.seal(row.id,context),mutationClaim])
      if(!submitted&&error instanceof ExperienceError&&error.code.startsWith('password_rejected.'))await this.pool.query('UPDATE auth_password_challenges SET operation_key=NULL,password_hash=NULL WHERE id=$1 AND phase=\'verified\' AND mutation_claim=$2',[row.id,mutationClaim])
      throw this.map(error)
    }
  }
  private async fence(row:Row,context:Context,input:Scope){
    const issuer=this.config.issuer.href.replace(/\/$/,'')
    await this.tx(async db=>{
      // Same subject lock/order as IdentityStore.finish. No slot/attempt locks are taken while holding it.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['xijie-auth',issuer,context.subject])])
      const live=await this.row(db,row.id,input)
      if(live.mutation_claim!==row.mutation_claim||!live.lease_until||live.lease_until<=new Date())throw conflict()
      const prior=(await db.query<{fenced_at:Date;password_pending:string|null}>('SELECT * FROM auth_credential_fences WHERE issuer=$1 AND subject=$2',[issuer,context.subject])).rows[0]
      if(prior&&prior.password_pending!==row.id&&prior.fenced_at>=row.created_at)throw scopeChanged()
      if(row.account_id){const account=(await db.query<{status:string}>('SELECT status FROM accounts WHERE id=$1 FOR UPDATE',[row.account_id])).rows[0];if(!account||account.status!=='active')throw scopeChanged()}
      if(live.phase==='staging'){
        if(row.account_id){
          await db.query('UPDATE accounts SET access_version=access_version+1,credential_fenced_at=clock_timestamp(),credential_password_pending=$2 WHERE id=$1',[row.account_id,row.id])
        }
        await db.query('INSERT INTO auth_credential_fences(issuer,subject,fenced_at,password_pending)VALUES($1,$2,clock_timestamp(),$3)ON CONFLICT(issuer,subject)DO UPDATE SET fenced_at=EXCLUDED.fenced_at,password_pending=EXCLUDED.password_pending',[issuer,context.subject,row.id])
      }else if(live.phase!=='saving')throw conflict()
      await db.query("UPDATE auth_password_challenges SET phase='saving',context_cipher=$2,lease_until=clock_timestamp()+interval '30 seconds',updated_at=clock_timestamp()WHERE id=$1",[row.id,this.seal(row.id,context)])
    })
  }
  private async complete(row:Row,subject:string,input:Scope){
    await this.tx(async db=>{
      await this.row(db,row.id,input)
      const result=await db.query("UPDATE auth_password_challenges SET phase='completed',context_cipher=NULL,code_hash=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1 AND mutation_claim=$2 AND phase='saving'",[row.id,row.mutation_claim]);if(result.rowCount!==1)throw conflict()
      await db.query('UPDATE auth_credential_fences SET password_pending=NULL WHERE issuer=$1 AND subject=$2 AND password_pending=$3',[this.config.issuer.href.replace(/\/$/,''),subject,row.id])
      if(row.account_id)await db.query('UPDATE accounts SET credential_password_pending=NULL WHERE id=$1 AND credential_password_pending=$2',[row.account_id,row.id])
    })
  }
  async sweep(){
    await this.pool.query("UPDATE auth_password_challenges SET phase='unknown',lease_until=NULL WHERE phase='saving' AND lease_until<=clock_timestamp()")
    await this.pool.query("UPDATE auth_password_challenges SET phase='verified',lease_until=NULL WHERE phase='staging' AND lease_until<=clock_timestamp()")
    await this.pool.query("UPDATE auth_password_challenges SET phase='expired',context_cipher=NULL,code_hash=NULL,lease_until=NULL WHERE phase NOT IN('completed','unknown','saving')AND expires_at<=clock_timestamp()")
    await this.pool.query("UPDATE auth_password_challenges SET context_cipher=NULL,code_hash=NULL WHERE expires_at<clock_timestamp()-interval '1 day'")
    await this.pool.query("DELETE FROM auth_password_challenges WHERE expires_at<clock_timestamp()-interval '1 day'")
    await this.pool.query("DELETE FROM auth_password_logins WHERE expires_at<=clock_timestamp()")
  }
}
