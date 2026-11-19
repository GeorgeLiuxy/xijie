import type {IdentityConfig} from './config.js'
import {Pool} from 'pg'

export class PasswordError extends Error {
  constructor(readonly status:number,readonly code:string,readonly retryAfter?:number){super(code)}
}
export type PasswordPolicy={minimumLength:number;maximumLength:number;minimumCharacterTypes:number;asciiOnly:boolean;rejectsPwned:boolean;rejectsRepetition:boolean;rejectsUserInfo:boolean}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const unavailable=()=>new PasswordError(503,'AUTH_PROVIDER_UNAVAILABLE')

/** Read-only metadata from the pinned Logto provider. Never grants password-write privileges. */
export class PasswordMetadata {
  private readonly readerPool?:Pool
  constructor(private readonly config:IdentityConfig){
    const reader=config.accountReader
    if(reader&&'databaseUrl'in reader&&reader.databaseUrl){
      this.readerPool=new Pool({connectionString:reader.databaseUrl,max:2,connectionTimeoutMillis:3000,statement_timeout:3000,query_timeout:4000,idleTimeoutMillis:30000,allowExitOnIdle:true,options:'-c default_transaction_read_only=on -c search_path=pg_catalog',application_name:'xijie_identity_phone_reader'})
      this.readerPool.on('error',()=>console.error('The bound phone reader connection was interrupted.'))
    }
  }
  async close(){await this.readerPool?.end()}
  private async request(url:URL,init?:RequestInit){
    try{const response=await fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(8000)});if(!response.ok)throw unavailable();const value:unknown=await response.json();if(!record(value))throw unavailable();return value}catch{throw unavailable()}
  }
  async policy(){
    const value=await this.request(new URL('/api/.well-known/sign-in-exp',this.config.issuer))
    if(!record(value.passwordPolicy)||!record(value.signIn)||!Array.isArray(value.signIn.methods)||!record(value.forgotPassword))throw unavailable()
    const raw=value.passwordPolicy
    const section=(name:string)=>{const v=raw[name];if(v===undefined)return{};if(!record(v))throw unavailable();return v}
    const length=section('length'),types=section('characterTypes'),rejects=section('rejects')
    const integer=(v:unknown,fallback:number,max=4096)=>{if(v===undefined)return fallback;if(!Number.isInteger(v)||Number(v)<1||Number(v)>max)throw unavailable();return Number(v)}
    const bool=(v:unknown)=>{if(v===undefined)return true;if(typeof v!=='boolean')throw unavailable();return v}
    // Defaults are Logto 1.46's passwordPolicyGuard, and used only after a real successful config read.
    const policy:PasswordPolicy={minimumLength:integer(length.min,8),maximumLength:integer(length.max,256),minimumCharacterTypes:integer(types.min,1,4),asciiOnly:true,rejectsPwned:bool(rejects.pwned),rejectsRepetition:bool(rejects.repetitionAndSequence),rejectsUserInfo:bool(rejects.userInfo)}
    if(policy.minimumLength>policy.maximumLength)throw unavailable()
    if(typeof value.forgotPassword.phone!=='boolean')throw unavailable()
    return{enabled:value.signIn.methods.some(v=>record(v)&&v.identifier==='phone'&&v.password===true),resetEnabled:value.forgotPassword.phone,policy}
  }
  async boundPhone(subject:string){
    const reader=this.config.accountReader
    if(!reader||!subject||subject.length>128)throw unavailable()
    if(this.readerPool){
      try{
        const result=await this.readerPool.query<{subject:unknown;phone:unknown}>('SELECT subject,phone FROM xijie_auth_reader.bound_phones WHERE subject=$1 LIMIT 2',[subject])
        if(result.rowCount!==1||result.rows[0].subject!==subject)throw unavailable()
        const value=result.rows[0].phone
        if(value!==null&&typeof value!=='string')throw unavailable()
        const phone=typeof value==='string'?value.replace(/^\+/,''):null
        if(phone!==null&&!/^[1-9]\d{6,14}$/.test(phone))throw unavailable()
        return phone
      }catch{throw unavailable()}
    }
    if(!('clientId'in reader)||!reader.clientId||!reader.clientSecret||!reader.resource)throw unavailable()
    const token=await this.request(new URL('/oidc/token',this.config.issuer),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:reader.clientId,client_secret:reader.clientSecret,resource:reader.resource,scope:'read:users'})})
    if(typeof token.access_token!=='string'||!token.access_token||token.token_type!=='Bearer')throw unavailable()
    const user=await this.request(new URL('/api/users/'+encodeURIComponent(subject),this.config.issuer),{headers:{Authorization:'Bearer '+token.access_token}})
    if(user.id!==subject||user.primaryPhone!==undefined&&user.primaryPhone!==null&&typeof user.primaryPhone!=='string')throw unavailable()
    const phone=typeof user.primaryPhone==='string'?user.primaryPhone.replace(/^\+/,''):null
    if(phone&&!/^[1-9]\d{6,14}$/.test(phone))throw unavailable()
    return phone
  }
}
