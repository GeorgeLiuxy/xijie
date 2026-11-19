import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  ArgumentsHost, Body, Catch, Controller, Delete, ExceptionFilter, Get, HttpCode,
  HttpException, Inject, Module, Optional, Param, Patch, Post, Put, Query, Req, Res, type DynamicModule,
} from '@nestjs/common'
import { parse, serialize } from 'cookie'
import type { Request, Response } from 'express'
import { ATTEMPT_SECONDS, SESSION_SECONDS, type IdentityConfig } from './config.js'
import { ConsentError, ConsentStore, type ConsentInput, type PolicyLocale } from './consent-store.js'
import { EmbeddedAuth, EmbeddedError } from './embedded.js'
import type { OidcProvider } from './oidc.js'
import { IdentityStore, StoreError } from './store.js'
import { RightsError, RightsStore, type CreateRequest } from './rights.js'
import { RightsDependencies } from './rights-provider.js'
import { RightsEngine } from './rights-engine.js'
import { Readable } from 'node:stream'
import {ReferralError,ReferralsStore} from './referrals.js'
import {ContentReportsModule} from './content-reports-http.js'
import {ReportError} from './content-reports.js'
import {AccountProfileStore,AccountProfileError,accountProfileInput} from './account-profile.js'
import {ModelExecutionStore,ModelExecutionError,modelPurposes,type ModelService} from './model-execution.js'
import {isModelAttemptUsage} from '../../../runtime/model-execution.mjs'
import { CallInterestError, CallInterestStore, callInterestInput } from './call-interests.js'
import {NativeAuthStore,NativeAuthError} from './native-auth.js'
import {PasswordAuth} from './password.js'
import {PasswordError} from './password-provider.js'
import {NativeWechatAuth} from './native-wechat.js'

const CONFIG = Symbol('IdentityConfig')
const OIDC = Symbol('OidcProvider')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PROOF = /^[A-Za-z0-9_-]{43}$/
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const token = () => randomBytes(32).toString('base64url')

class ApiError extends Error {
  constructor(
    readonly status: number, readonly code: string, message: string,
    readonly details?: Record<string, number>,
  ) { super(message) }
}

const invalid = () => new ApiError(400, 'INVALID_ARGUMENT', 'The authentication request is invalid.')
const unauthorized = () => new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')

function cookieName(config: IdentityConfig, kind: 'session' | 'browser' | 'native_browser') {
  return config.secure ? '__Host-xijie_' + kind : 'xijie_dev_' + kind
}

function readCookie(config: IdentityConfig, request: Request, kind: 'session' | 'browser' | 'native_browser') {
  const value = parse(request.get('cookie') || '')[cookieName(config, kind)]
  return value && PROOF.test(value) ? value : null
}

async function activeSession(config: IdentityConfig, store: IdentityStore, request: Request) {
  const session = readCookie(config, request, 'session')
  const active = session ? await store.current(digest(session)) : null
  const expected = request.get('X-Xijie-Expected-Session')
  if (!active || (expected !== undefined && expected !== active.id)) throw unauthorized()
  return active
}

function consentCursor(secret: string, accountId: string, eventId: string) {
  const signature = createHmac('sha256', secret).update('xijie/consents/v1:').update(accountId).update(':').update(eventId).digest('base64url')
  return eventId + '.' + signature
}

function cursorEvent(secret: string, accountId: string, cursor: unknown) {
  if (cursor === undefined) return null
  if (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]{36}\.[A-Za-z0-9_-]{43}$/.test(cursor)) throw invalid()
  const eventId = cursor.slice(0, 36)
  if (!UUID.test(eventId) || !timingSafeEqual(Buffer.from(cursor), Buffer.from(consentCursor(secret, accountId, eventId)))) throw invalid()
  return eventId
}

function policyLocale(value: unknown): PolicyLocale {
  if (value === undefined) return 'zh-CN'
  if (typeof value !== 'string' || !/^[a-z0-9-]{1,35}$/i.test(value)) throw invalid()
  return /^en(?:-|$)/i.test(value) ? 'en' : 'zh-CN'
}

function consentInput(body: unknown): ConsentInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid()
  const input = body as Record<string, unknown>
  if (Object.keys(input).some(field => !['policyId', 'version', 'purpose', 'decision', 'expectedAuthorizationVersion'].includes(field))) throw invalid()
  const { policyId, version, purpose, decision, expectedAuthorizationVersion } = input
  if (typeof policyId !== 'string' || !UUID.test(policyId) ||
      typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > 2_147_483_647 ||
      typeof expectedAuthorizationVersion !== 'number' || !Number.isInteger(expectedAuthorizationVersion) ||
      expectedAuthorizationVersion < 0 || expectedAuthorizationVersion >= 2_147_483_647) throw invalid()
  if (purpose === 'privacy_notice' && decision === 'acknowledge' ||
      (purpose === 'private_story_storage' || purpose === 'ai_text_processing' || purpose === 'private_photo_storage' || purpose === 'private_person_photo_storage' || purpose === 'virtual_gift_storage' || purpose === 'person_gift_returns' || purpose === 'gift_delivery_photo_storage' || purpose === 'private_letter_storage' || purpose === 'person_letter_replies' || purpose === 'person_gather_replies' || purpose === 'private_chat_photo_storage' || purpose === 'person_chat_image_replies' || purpose === 'person_world_actions' || purpose === 'person_story_branches' || purpose === 'person_offline_life' || purpose === 'production_model_execution' || purpose === 'person_voice_calls' || purpose === 'private_person_voice_storage' || purpose === 'private_chat_reply_speech') && (decision === 'grant' || decision === 'revoke')) {
    return { policyId: policyId.toLowerCase(), version, purpose, decision, expectedAuthorizationVersion }
  }
  throw invalid()
}

export function identityHeaders(_request: Request, response: Response, next: () => void) {
  response.setHeader('X-Request-Id', randomUUID())
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Referrer-Policy', 'no-referrer')
  next()
}

@Catch()
export class IdentityErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>()
    if(error instanceof ModelExecutionError){response.status(error.status).json({error:{code:error.code,message:'Model execution is unavailable.'}});return}
    if (response.headersSent) return
    const requestId = response.getHeader('X-Request-Id')
    let problem = new ApiError(500, 'INTERNAL_ERROR', 'The identity service could not complete the request.')
    if (error instanceof ApiError) problem = error
    else if (error instanceof EmbeddedError) {
      problem = new ApiError(error.status, error.code, 'The sign-in request could not be completed.', error.retryAfter ? { retryAfter: error.retryAfter } : undefined)
      if (error.retryAfter) response.setHeader('Retry-After', error.retryAfter)
    }
    else if(error instanceof PasswordError){problem=new ApiError(error.status,error.code,'The account authentication request could not be completed.',error.retryAfter?{retryAfter:error.retryAfter}:undefined);if(error.retryAfter)response.setHeader('Retry-After',error.retryAfter)}
    else if (error instanceof ConsentError) problem = new ApiError(error.status, error.code, error.message, error.details)
    else if (error instanceof RightsError) problem = new ApiError(error.status,error.code,'The data request could not be completed.')
    else if (error instanceof ReferralError) problem = new ApiError(error.status,error.code,'The invitation request could not be completed.')
    else if(error instanceof NativeAuthError)problem=new ApiError(error.status,error.code,'The native sign-in could not be completed.')
    else if (error instanceof ReportError) problem = new ApiError(error.status,error.code,'The content report could not be completed.')
    else if(error instanceof AccountProfileError)problem=new ApiError(error.status,error.code,'The account profile could not be saved.',error.details)
    else if(error instanceof CallInterestError)problem=new ApiError(error.status,error.code,'The call reminder preference could not be saved.')
    else if (error instanceof StoreError) {
      if(error.code==='AUTH_RATE_LIMITED'){response.setHeader('Retry-After','600');response.status(429).json({error:{code:error.code,message:'Please wait before starting another sign-in.',details:{retryAfter:600}}});return}
      if (error.code === 'UNAUTHENTICATED') problem = unauthorized()
      else problem = new ApiError(409, error.code, 'The authentication request no longer matches the current session.')
    } else if (error instanceof HttpException && error.getStatus() < 500) {
      problem = error.getStatus() === 404 ? new ApiError(404, 'NOT_FOUND', 'This endpoint was not found.') : invalid()
    } else {
      console.error('Identity request failed', { requestId, type: error instanceof Error ? error.name : typeof error })
    }
    response.status(problem.status).json({ error: { code: problem.code, message: problem.message, requestId, details: problem.details } })
  }
}

@Controller('v1')
class IdentityController {
  private readonly receiptReads=new Map<string,{until:number;count:number}>()
  constructor(
    @Inject(CONFIG) private readonly config: IdentityConfig,
    @Inject(IdentityStore) private readonly store: IdentityStore,
    @Inject(OIDC) private readonly oidc: OidcProvider,
    @Inject(ConsentStore) private readonly consents: ConsentStore,
    @Optional() @Inject(EmbeddedAuth) private readonly embedded?: EmbeddedAuth,
    @Optional() @Inject(RightsStore) private readonly rights?: RightsStore,
    @Optional() @Inject(ReferralsStore) private readonly referrals?:ReferralsStore,
    @Optional() @Inject(NativeAuthStore) private readonly native?:NativeAuthStore,
    @Optional() @Inject(PasswordAuth) private readonly passwords?:PasswordAuth,
    @Optional() @Inject(NativeWechatAuth) private readonly wechat?:NativeWechatAuth,
  ) {}

  private writeCookie(response: Response, kind: 'session' | 'browser' | 'native_browser', value: string, maxAge: number) {
    response.append('Set-Cookie', serialize(cookieName(this.config, kind), value, {
      httpOnly: true, secure: this.config.secure, sameSite: 'lax',
      path: this.config.secure ? '/' : '/v1', maxAge,
    }))
  }

  private assertOrigin(request: Request) {
    if (request.get('origin') !== this.config.origin) {
      throw new ApiError(403, 'FORBIDDEN', 'The request did not come from the registered web application.')
    }
  }

  private referralStore(){if(!this.referrals)throw new ReferralError(403,'FEATURE_DISABLED');return this.referrals}
  private referralSession(request:Request){const proof=readCookie(this.config,request,'session'),expected=request.get('X-Xijie-Expected-Session');if(!proof||!expected||!UUID.test(expected))throw unauthorized();return{hash:digest(proof),expected}}
  private referralKey(request:Request){const key=request.get('Idempotency-Key');if(!key||!UUID.test(key))throw invalid();return key.toLowerCase()}
  private emptyReferralBody(body:unknown){if(body!==undefined&&(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length))throw invalid()}
  private referralRate(request:Request){const now=Date.now(),key='referral:'+digest(request.socket.remoteAddress??'unknown'),previous=this.receiptReads.get(key);if(previous&&previous.until>now){if(++previous.count>120)throw new ReferralError(429,'RATE_LIMITED')}else{if(this.receiptReads.size>=1024){for(const[k,v]of this.receiptReads)if(v.until<=now)this.receiptReads.delete(k);if(this.receiptReads.size>=1024)this.receiptReads.delete(this.receiptReads.keys().next().value!)}this.receiptReads.set(key,{until:now+60000,count:1})}}
  @Post('referrals/links')
  async createReferral(@Req()request:Request,@Body()body:unknown){
    this.assertOrigin(request);const s=this.referralSession(request),key=this.referralKey(request)
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||!('publicName'in body)||typeof body.publicName!=='string')throw invalid()
    const name=body.publicName.trim();if(!name||[...name].length>32||/[\x00-\x1f\x7f]|\p{Surrogate}/u.test(name))throw invalid()
    return{data:await this.referralStore().create(s.hash,s.expected,key,name)}
  }
  @Get('referrals')
  async referralStatus(@Req()request:Request){if(Object.keys(request.query).length)throw invalid();const s=this.referralSession(request);return{data:await this.referralStore().status(s.hash,s.expected)}}
  @Post('referrals/links/:id/revoke')
  @HttpCode(200)
  async revokeReferral(@Req()request:Request,@Param('id')id:string,@Body()body:unknown){
    this.assertOrigin(request);this.emptyReferralBody(body);const s=this.referralSession(request),key=this.referralKey(request),header=request.get('If-Match')
    if(!UUID.test(id))throw invalid();if(header===undefined)throw new ReferralError(428,'PRECONDITION_REQUIRED')
    const version=/^"v([1-9][0-9]{0,9})"$/.exec(header);if(!version||Number(version[1])>2147483647)throw invalid()
    return{data:await this.referralStore().revoke(s.hash,s.expected,key,id.toLowerCase(),Number(version[1]))}
  }
  @Get('public/referrals/:token')
  async publicReferral(@Req()request:Request,@Param('token')token:string){if(Object.keys(request.query).length)throw invalid();this.referralRate(request);return{data:await this.referralStore().publicInfo(token)}}
  @Post('public/referrals/:token/join')
  async joinReferral(@Req()request:Request,@Res({passthrough:true})response:Response,@Param('token')linkToken:string,@Body()body:unknown){
    this.assertOrigin(request);this.emptyReferralBody(body);this.referralRate(request);const key=this.referralKey(request)
    const proof=readCookie(this.config,request,'session'),current=proof?await this.store.current(digest(proof)):null,expected=request.get('X-Xijie-Expected-Session')
    if(current?expected!==current.id:expected!==undefined)throw unauthorized()
    const browser=readCookie(this.config,request,'browser')??token()
    this.writeCookie(response,'browser',browser,24*60*60)
    return{data:await this.referralStore().join(linkToken,digest(browser),key,!!current)}
  }

  @Post('auth/sms-challenges')
  async sms(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: unknown) {
    this.assertOrigin(request)
    if (!this.embedded) throw new ApiError(503, 'AUTH_PROVIDER_UNAVAILABLE', 'Phone sign-in is not configured.')
    const key = request.get('Idempotency-Key')
    if (!key || !UUID.test(key) || !body || typeof body !== 'object' || Array.isArray(body)) throw invalid()
    const input = body as Record<string, unknown>
    if (Object.keys(input).some(field => !['dial', 'phone', 'purpose'].includes(field)) ||
        typeof input.dial !== 'string' || !/^\+[1-9]\d{0,3}$/.test(input.dial) ||
        typeof input.phone !== 'string' || !/^\d{6,14}$/.test(input.phone) ||
        !/^\+[1-9]\d{6,14}$/.test(input.dial + input.phone) ||
        !['sign_in','switch','reauthenticate'].includes(String(input.purpose))) throw invalid()
    if (input.purpose==='reauthenticate'&&!request.get('X-Xijie-Expected-Session'))throw unauthorized()
    if (request.get('X-Xijie-Expected-Session') !== undefined || input.purpose !== 'sign_in') await activeSession(this.config, this.store, request)
    const browser = readCookie(this.config, request, 'browser') ?? token()
    // Persist browser binding even when provider delivery fails, so retries cannot bypass recipient/browser throttles.
    this.writeCookie(response, 'browser', browser, 24 * 60 * 60)
    const session = readCookie(this.config, request, 'session')
    return { data: await this.embedded.start({
      browserHash: digest(browser), sessionHash: session ? digest(session) : null,
      key, phone: input.dial + input.phone, purpose: input.purpose as 'sign_in'|'switch'|'reauthenticate',
    }) }
  }

  @Post('auth/sms-challenges/:id/verify')
  @HttpCode(200)
  async verifySms(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Param('id') id: string, @Body() body: unknown) {
    this.assertOrigin(request)
    if (!this.embedded) throw new ApiError(503, 'AUTH_PROVIDER_UNAVAILABLE', 'Phone sign-in is not configured.')
    const key = request.get('Idempotency-Key'), browser = readCookie(this.config, request, 'browser')
    if (!key || !UUID.test(key) || !UUID.test(id) || !body || typeof body !== 'object' || Array.isArray(body)) throw invalid()
    const input = body as Record<string, unknown>
    if (Object.keys(input).some(field => field !== 'code') || typeof input.code !== 'string' || !/^\d{6}$/.test(input.code)) throw invalid()
    if (!browser) throw new ApiError(404, 'NOT_FOUND', 'The sign-in request was not found.')
    const session=readCookie(this.config,request,'session')
    const result = await this.embedded.verify({ id, browserHash: digest(browser), key, code: input.code, requestId: String(response.getHeader('X-Request-Id')),sessionHash:session?digest(session):undefined,expectedSessionId:request.get('X-Xijie-Expected-Session') })
    if (result.status === 'verified') this.writeCookie(response, 'session', result.session, SESSION_SECONDS)
    if(result.status==='reauthenticated')return {data:result}
    return { data: { status: result.status } }
  }

  @Get('auth/providers')
  async authProviders(){return{data:(['apple','google','wechat'] as const).map(id=>({id,enabled:this.config.socialProviders?.[id]===true,nativeHandoffEnabled:this.config.nativeHandoffEnabled===true&&!!this.native,...(id==='wechat'&&this.wechat?{nativeSdkEnabled:this.wechat.enabled}:{})}))}}

  private passwordService(){if(!this.passwords)throw new PasswordError(503,'AUTH_PROVIDER_UNAVAILABLE');return this.passwords}
  private passwordScope(request:Request){const browser=readCookie(this.config,request,'browser'),session=readCookie(this.config,request,'session'),expected=request.get('X-Xijie-Expected-Session');if(!browser)throw new PasswordError(404,'NOT_FOUND');if(expected!==undefined&&!UUID.test(expected))throw invalid();return{browserHash:digest(browser),sessionHash:session?digest(session):null,expectedSessionId:expected}}
  private passwordInput(body:unknown,fields:string[]){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!fields.includes(k)))throw invalid();return body as Record<string,unknown>}
  private passwordPhone(input:Record<string,unknown>){if(typeof input.dial!=='string'||!/^\+[1-9]\d{0,3}$/.test(input.dial)||typeof input.phone!=='string'||!/^\d{6,14}$/.test(input.phone)||!/^\+[1-9]\d{6,14}$/.test(input.dial+input.phone))throw invalid();return input.dial+input.phone}
  private passwordValue(value:unknown){if(typeof value!=='string'||value.length<1||value.length>4096)throw invalid();return value}
  @Get('auth/password-policy')
  async passwordPolicy(@Req()request:Request){if(Object.keys(request.query).length)throw invalid();return{data:await this.passwordService().policy()}}
  @Get('accounts/me/authentication')
  async authenticationMethods(@Req()request:Request){if(Object.keys(request.query).length)throw invalid();const session=readCookie(this.config,request,'session'),expected=request.get('X-Xijie-Expected-Session');if(!session||!expected||!UUID.test(expected))throw unauthorized();return{data:await this.passwordService().authentication(digest(session),expected)}}
  @Post('auth/password-attempts') @HttpCode(200)
  async passwordAttempt(@Req()request:Request,@Res({passthrough:true})response:Response,@Body()body:unknown){
    this.assertOrigin(request);const input=this.passwordInput(body,['dial','phone','password','purpose']),phone=this.passwordPhone(input),password=this.passwordValue(input.password),key=this.referralKey(request)
    if(input.purpose!=='sign_in'&&input.purpose!=='switch')throw invalid()
    if(input.purpose==='switch'&&!request.get('X-Xijie-Expected-Session'))throw unauthorized()
    if(input.purpose==='switch'||request.get('X-Xijie-Expected-Session')!==undefined)await activeSession(this.config,this.store,request)
    const browser=readCookie(this.config,request,'browser')??token();this.writeCookie(response,'browser',browser,86400)
    const session=readCookie(this.config,request,'session'),result=await this.passwordService().login({browserHash:digest(browser),sessionHash:session?digest(session):null,expectedSessionId:request.get('X-Xijie-Expected-Session'),phone,password,key,purpose:input.purpose,requestId:String(response.getHeader('X-Request-Id'))})
    this.writeCookie(response,'session',result,SESSION_SECONDS);return{data:{status:'verified'}}
  }
  @Post('auth/password-challenges')
  async passwordChallenge(@Req()request:Request,@Res({passthrough:true})response:Response,@Body()body:unknown){
    this.assertOrigin(request);const input=this.passwordInput(body,['purpose','dial','phone']),key=this.referralKey(request)
    if(input.purpose!=='manage'&&input.purpose!=='reset')throw invalid();if(input.purpose==='manage'&&Object.keys(input).length!==1)throw invalid()
    const phone=input.purpose==='reset'?this.passwordPhone(input):undefined
    if(input.purpose==='manage'&&!request.get('X-Xijie-Expected-Session'))throw unauthorized()
    const browser=readCookie(this.config,request,'browser')??token();this.writeCookie(response,'browser',browser,86400)
    const session=readCookie(this.config,request,'session');return{data:await this.passwordService().start({browserHash:digest(browser),sessionHash:session?digest(session):null,expectedSessionId:request.get('X-Xijie-Expected-Session'),purpose:input.purpose,phone,key})}
  }
  @Post('auth/password-challenges/:id/verify') @HttpCode(200)
  async verifyPasswordChallenge(@Req()request:Request,@Param('id')id:string,@Body()body:unknown){this.assertOrigin(request);const input=this.passwordInput(body,['code']);if(!UUID.test(id)||typeof input.code!=='string'||!/^\d{6}$/.test(input.code))throw invalid();return{data:await this.passwordService().verify({...this.passwordScope(request),id,key:this.referralKey(request),code:input.code})}}
  @Put('auth/password-challenges/:id/password')
  async savePassword(@Req()request:Request,@Param('id')id:string,@Body()body:unknown){this.assertOrigin(request);const input=this.passwordInput(body,['password']);if(!UUID.test(id))throw invalid();return{data:await this.passwordService().save({...this.passwordScope(request),id,key:this.referralKey(request),password:this.passwordValue(input.password)})}}
  @Get('auth/password-challenges/:id')
  async passwordChallengeStatus(@Req()request:Request,@Param('id')id:string){if(!UUID.test(id)||Object.keys(request.query).length)throw invalid();return{data:await this.passwordService().status({...this.passwordScope(request),id})}}
  @Delete('auth/password-challenges/:id') @HttpCode(204)
  async cancelPasswordChallenge(@Req()request:Request,@Param('id')id:string,@Body()body:unknown){this.assertOrigin(request);this.emptyReferralBody(body);this.referralKey(request);if(!UUID.test(id))throw invalid();await this.passwordService().cancel({...this.passwordScope(request),id})}

  @Post('auth/native-attempts')
  async beginNative(@Req()request:Request,@Res({passthrough:true})response:Response,@Body()body:unknown){
    this.assertOrigin(request);if(!this.native||this.config.nativeHandoffEnabled!==true)throw new NativeAuthError(503,'AUTH_PROVIDER_UNAVAILABLE')
    if(!body||typeof body!=='object'||Array.isArray(body))throw invalid()
    const v=body as Record<string,unknown>,key=request.get('Idempotency-Key'),expected=request.get('X-Xijie-Expected-Session')
    if(Object.keys(v).some(k=>!['provider','purpose','verifierChallenge','launchProof','transport'].includes(k))||Object.keys(v).length<4||!key||!UUID.test(key)||!['apple','google','wechat'].includes(String(v.provider))||!['sign_in','switch','reauthenticate'].includes(String(v.purpose))||typeof v.verifierChallenge!=='string'||!/^[a-f0-9]{64}$/.test(v.verifierChallenge)||typeof v.launchProof!=='string'||!PROOF.test(v.launchProof)||v.transport!==undefined&&!['browser','wechat_sdk'].includes(String(v.transport)))throw invalid()
    const provider=v.provider as 'apple'|'google'|'wechat',purpose=v.purpose as 'sign_in'|'switch'|'reauthenticate'
    const transport=(v.transport??'browser') as 'browser'|'wechat_sdk'
    if(transport==='wechat_sdk'&&provider!=='wechat')throw invalid()
    if(transport==='wechat_sdk'&&!this.wechat?.enabled)throw new NativeAuthError(503,'AUTH_PROVIDER_UNAVAILABLE')
    if(this.config.socialProviders?.[provider]!==true)throw new NativeAuthError(503,'AUTH_PROVIDER_UNAVAILABLE')
    if(purpose!=='sign_in'&&!expected)throw unauthorized()
    if(expected!==undefined||purpose!=='sign_in')await activeSession(this.config,this.store,request)
    const browser=readCookie(this.config,request,'browser')??token(),session=readCookie(this.config,request,'session'),state=token(),nonce=token(),verifier=token()
    const draft={id:randomUUID(),browserHash:digest(browser),sessionHash:session?digest(session):null,clientRegistrationKey:this.config.clientRegistrationKey,key,purpose,provider,stateHash:digest(state),nonce,verifier,authorizationUrl:await this.oidc.authorize({state,nonce,verifier,fresh:true,...(transport==='browser'?{provider}:{})}),expiresAt:new Date(Date.now()+ATTEMPT_SECONDS*1000)},extra={expectedSessionId:expected,verifierChallenge:v.verifierChallenge,launchProof:v.launchProof,transport}
    const result=transport==='wechat_sdk'?await this.wechat!.start(draft,extra):await this.native.start(draft,extra)
    this.writeCookie(response,'browser',browser,24*60*60);return{data:result}
  }
  private nativeWechatScope(request:Request){const browser=readCookie(this.config,request,'browser'),session=readCookie(this.config,request,'session'),expectedSessionId=request.get('X-Xijie-Expected-Session');if(!browser)throw new NativeAuthError(403,'AUTH_RESTART_REQUIRED');if(expectedSessionId!==undefined&&!UUID.test(expectedSessionId))throw invalid();return{browserHash:digest(browser),sessionHash:session?digest(session):undefined,expectedSessionId,key:this.referralKey(request)}}
  @Post('auth/native-wechat/:id/launch') @HttpCode(200)
  async launchNativeWechat(@Req()request:Request,@Param('id')id:string,@Body()body:unknown){this.assertOrigin(request);if(!this.wechat?.enabled)throw new NativeAuthError(503,'AUTH_PROVIDER_UNAVAILABLE');const input=this.passwordInput(body,['launchProof']);if(!UUID.test(id)||typeof input.launchProof!=='string'||!PROOF.test(input.launchProof))throw invalid();return{data:await this.wechat.launch(id.toLowerCase(),{...this.nativeWechatScope(request),launchProof:input.launchProof})}}
  @Post('auth/native-wechat/:id/complete') @HttpCode(200)
  async completeNativeWechat(@Req()request:Request,@Res({passthrough:true})response:Response,@Param('id')id:string,@Body()body:unknown){this.assertOrigin(request);if(!this.wechat?.enabled)throw new NativeAuthError(503,'AUTH_PROVIDER_UNAVAILABLE');const input=this.passwordInput(body,['code','state','verifier']);if(!UUID.test(id)||typeof input.code!=='string'||!input.code||input.code.length>2048||/[^\x21-\x7e]/.test(input.code)||typeof input.state!=='string'||!PROOF.test(input.state)||typeof input.verifier!=='string'||!PROOF.test(input.verifier))throw invalid();return{data:await this.wechat.complete(id.toLowerCase(),{...this.nativeWechatScope(request),code:input.code,state:input.state,verifier:input.verifier,requestId:String(response.getHeader('X-Request-Id'))})}}
  @Get('auth/native-launch/:id')
  async launchNative(@Req()request:Request,@Res()response:Response,@Param('id')id:string,@Query('proof')proof:unknown){
    if(!this.native||!UUID.test(id)||typeof proof!=='string'||!PROOF.test(proof)||Object.keys(request.query).length!==1)throw invalid()
    const external=token(),url=await this.native.launch(id.toLowerCase(),proof,digest(external))
    this.writeCookie(response,'native_browser',external,ATTEMPT_SECONDS);response.setHeader('Referrer-Policy','no-referrer');response.redirect(303,url)
  }
  @Post('auth/native-attempts/:id/redeem') @HttpCode(200)
  async redeemNative(@Req()request:Request,@Res({passthrough:true})response:Response,@Param('id')id:string,@Body()body:unknown){
    this.assertOrigin(request);if(!this.native)throw new NativeAuthError(503,'AUTH_PROVIDER_UNAVAILABLE')
    const browser=readCookie(this.config,request,'browser'),key=request.get('Idempotency-Key')
    if(!UUID.test(id)||!browser||!key||!UUID.test(key)||!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==2||!('verifier'in body)||!('ticket'in body)||typeof body.verifier!=='string'||!PROOF.test(body.verifier)||typeof body.ticket!=='string'||!PROOF.test(body.ticket))throw invalid()
    const current=readCookie(this.config,request,'session')
    const result=await this.native.redeem(id.toLowerCase(),{browserHash:digest(browser),sessionHash:current?digest(current):undefined,expectedSessionId:request.get('X-Xijie-Expected-Session'),key,verifier:body.verifier,ticket:body.ticket,requestId:String(response.getHeader('X-Request-Id'))})
    if(typeof result!=='string')return{data:result}
    this.writeCookie(response,'session',result,SESSION_SECONDS);return{data:{status:'verified'}}
  }

  @Post('auth/attempts')
  async begin(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: unknown) {
    this.assertOrigin(request)
    const key = request.get('Idempotency-Key')
    if (!key || !UUID.test(key)) throw invalid()
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid()
    const input = body as Record<string, unknown>
    if (Object.keys(input).some(field => !['client', 'purpose', 'clientRegistrationKey', 'returnRouteKey','provider'].includes(field))) throw invalid()
    if (input.client !== 'web' || !['sign_in','switch','reauthenticate'].includes(String(input.purpose))) throw invalid()
    if (input.clientRegistrationKey !== undefined && input.clientRegistrationKey !== this.config.clientRegistrationKey) throw invalid()
    if (input.returnRouteKey !== undefined && input.returnRouteKey !== 'home') throw invalid()
    if(input.provider!==undefined&&!['apple','google','wechat'].includes(String(input.provider)))throw invalid()
    if(input.provider!==undefined&&this.config.socialProviders?.[input.provider as 'apple'|'google'|'wechat']!==true)throw new ApiError(503,'AUTH_PROVIDER_UNAVAILABLE','This sign-in method is unavailable.')

    if(input.purpose!=='sign_in'&&!request.get('X-Xijie-Expected-Session'))throw unauthorized()
    if (input.purpose === 'reauthenticate' && !input.provider) throw unauthorized()
    if (request.get('X-Xijie-Expected-Session') !== undefined || input.purpose !== 'sign_in') await activeSession(this.config, this.store, request)
    const browser = readCookie(this.config, request, 'browser') ?? token()
    const session = readCookie(this.config, request, 'session')
    const id = randomUUID()
    const state = token()
    const nonce = token()
    const verifier = token()
    const expiresAt = new Date(Date.now() + ATTEMPT_SECONDS * 1000)
    const authorizationUrl = await this.oidc.authorize({ state, nonce, verifier, fresh: true,...(input.provider?{provider:input.provider as 'apple'|'google'|'wechat'}:{}) })
    const attempt = await this.store.begin({
      id, browserHash: digest(browser), sessionHash: session ? digest(session) : null,
      clientRegistrationKey: this.config.clientRegistrationKey,
      key, purpose: input.purpose as 'sign_in'|'switch'|'reauthenticate', stateHash: digest(state), nonce, verifier, authorizationUrl, expiresAt,
      ...(input.provider?{provider:input.provider as 'apple'|'google'|'wechat'}:{}),
    })
    this.writeCookie(response, 'browser', browser, 24 * 60 * 60)
    return { data: { attemptId: attempt.id, expiresAt: attempt.expiresAt.toISOString(), authorizationUrl: attempt.authorizationUrl } }
  }

  @Get('auth/callback')
  async callback(@Req() request: Request, @Res() response: Response) {
    const redirect = (result: 'success' | 'cancelled' | 'failed') => response.redirect(303, '/?auth=' + result)
    const callback = new URL(this.config.callbackUrl)
    callback.search = new URL(request.originalUrl, this.config.origin).search
    const state = callback.searchParams.get('state')
    if(this.native&&state&&PROOF.test(state)&&callback.searchParams.getAll('state').length===1){
      const native=await this.native.forState(digest(state))
      if(native){
        const proof=readCookie(this.config,request,'native_browser')
        if(proof)try{return response.redirect(303,await this.native.callback(callback,digest(state),digest(proof)))}catch{/* Native requests never fall through to ordinary Web session creation. */}
        return response.redirect(303,'/native-auth/complete?attemptId='+native.attempt_id+'&status=failed')
      }
    }
    const browser = readCookie(this.config, request, 'browser')
    if (!browser || !state || !PROOF.test(state) || callback.searchParams.getAll('state').length !== 1) return redirect('failed')
    const browserHash = digest(browser)
    const claimId = randomUUID()
    const attempt = await this.store.claim({ browserHash, stateHash: digest(state), claimId })
    if (attempt === 'completed') return redirect('success')
    if (!attempt) return redirect('failed')

    const markFailed = () => this.store.fail({ browserHash, attemptId: attempt.id, claimId })
    if (attempt.clientRegistrationKey !== this.config.clientRegistrationKey) {
      await markFailed()
      return redirect('failed')
    }
    const providerError = callback.searchParams.get('error')
    if (providerError) {
      await markFailed()
      return redirect(providerError === 'access_denied' || providerError === 'login_required' ? 'cancelled' : 'failed')
    }

    let principal
    try {
      principal = await this.oidc.exchange(callback, {
        state, nonce: attempt.nonce, verifier: attempt.verifier,
        freshSince: attempt.purpose !== 'sign_in' ? attempt.createdAt : undefined,
      })
    } catch {
      await markFailed()
      return redirect('failed')
    }

    const session = token()
    const accepted = await this.store.finish({
      browserHash, attemptId: attempt.id, claimId, sessionHash: digest(session),
      requestId: String(response.getHeader('X-Request-Id')),
      principal: {
        issuer: principal.issuer, subject: principal.subject,
        authenticatedAt: principal.authTime === undefined ? new Date() : new Date(principal.authTime * 1000),
        authenticationTimeVerified:Number.isSafeInteger(principal.authTime),
      },
    })
    if (!accepted) return redirect('failed')
    if (attempt.purpose !== 'reauthenticate') this.writeCookie(response, 'session', session, SESSION_SECONDS)
    return redirect('success')
  }

  @Delete('auth/attempts/:id')
  @HttpCode(204)
  async cancel(@Req() request: Request, @Param('id') id: string) {
    this.assertOrigin(request)
    if (!UUID.test(id)) throw invalid()
    if (request.get('X-Xijie-Expected-Session') !== undefined) await activeSession(this.config, this.store, request)
    const browser = readCookie(this.config, request, 'browser')
    const state = browser ? await this.store.cancel({ browserHash: digest(browser), attemptId: id }) : 'missing'
    if (state === 'missing') throw new ApiError(404, 'NOT_FOUND', 'The authentication attempt was not found.')
    if (state === 'completed') throw new ApiError(409, 'CONFLICT', 'Authentication has already completed.')
    if(browser)await this.native?.cancel(digest(browser),id.toLowerCase())
  }

  @Get('sessions/current')
  async session(@Req() request: Request) {
    const active = await activeSession(this.config, this.store, request)
    return { data: {
      id: active.id, accountId: active.accountId, client: active.client,
      authenticatedAt: active.authenticatedAt.toISOString(), expiresAt: active.expiresAt.toISOString(),
      reauthenticatedAt:active.reauthenticatedAt?.toISOString()??null,
    } }
  }

  @Delete('sessions/current')
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.assertOrigin(request)
    const session = readCookie(this.config, request, 'session')
    if (request.get('X-Xijie-Expected-Session') !== undefined) await activeSession(this.config, this.store, request)
    await this.store.logout(session ? digest(session) : null)
    this.writeCookie(response, 'session', '', 0)
  }

  @Get('accounts/me')
  async account(@Req() request: Request,@Res({passthrough:true})response:Response) {
    const active = await activeSession(this.config, this.store, request)
    response.setHeader('ETag','"v'+active.version+'"')
    return { data: {
      id: active.accountId, displayName: active.displayName, locale: active.locale, status: active.status,
      version: active.version, createdAt: active.registeredAt.toISOString(), onboardingState: 'empty', capabilities: { privateStoryDrafts: Boolean(this.config.peopleServiceToken) },
    } }
  }

  @Patch('accounts/me')
  async updateAccount(@Req()request:Request,@Res({passthrough:true})response:Response,@Body()body:unknown){
    this.assertOrigin(request)
    const credential=readCookie(this.config,request,'session'),expected=request.get('X-Xijie-Expected-Session'),key=request.get('Idempotency-Key'),header=request.get('If-Match')
    if(!credential||!expected||!UUID.test(expected))throw unauthorized()
    if(!key||!UUID.test(key))throw invalid()
    if(!header)throw new ApiError(428,'PRECONDITION_REQUIRED','An account version is required.')
    const matched=/^"v([1-9][0-9]{0,9})"$/.exec(header),version=Number(matched?.[1]);if(!matched||version>2147483647)throw invalid()
    const data=await new AccountProfileStore(this.store).update(digest(credential),expected,key.toLowerCase(),version,accountProfileInput(body))
    response.setHeader('ETag','"v'+data.version+'"')
    return{data:{...data,capabilities:{privateStoryDrafts:Boolean(this.config.peopleServiceToken)}}}
  }

  @Get('accounts/me/call-interests')
  async callInterests(@Req() request: Request) {
    if (Object.keys(request.query).length) throw invalid()
    const session = this.rightsSession(request)
    if (!session.expected) throw unauthorized()
    return { data: await new CallInterestStore(this.store).read(session.hash, session.expected) }
  }

  @Patch('accounts/me/call-interests')
  async updateCallInterest(@Req() request: Request, @Body() body: unknown) {
    this.assertOrigin(request)
    const session = this.rightsSession(request)
    if (!session.expected) throw unauthorized()
    return { data: await new CallInterestStore(this.store).update(session.hash, session.expected, callInterestInput(body)) }
  }

  @Get('policies/current')
  async policies(@Query('locale') locale: unknown) {
    return { data: await this.consents.policies(policyLocale(locale)) }
  }

  @Get('policies/:id/:version')
  async policyDocument(@Param('id') id: string, @Param('version') version: string, @Query('locale') locale: unknown, @Res() response: Response) {
    if (!UUID.test(id) || !/^[1-9][0-9]{0,9}$/.test(version) || Number(version) > 2_147_483_647) throw invalid()
    const language = policyLocale(locale)
    const document = await this.consents.document(id, Number(version), language)
    if (!document) throw new ApiError(404, 'NOT_FOUND', 'The requested policy document was not found.')
    response.set('Content-Language', language).set('X-Content-Type-Options', 'nosniff').type('text/plain').send(document)
  }

  @Get('accounts/me/consents')
  async consentHistory(@Req() request: Request, @Query('limit') limit: unknown, @Query('cursor') cursor: unknown) {
    const active = await activeSession(this.config, this.store, request)
    if (limit !== undefined && (typeof limit !== 'string' || !/^[1-9][0-9]{0,2}$/.test(limit) || Number(limit) > 100)) throw invalid()
    const afterId = cursorEvent(this.config.clientSecret, active.accountId, cursor)
    const { data, nextId, ...meta } = await this.consents.history(active.accountId, limit === undefined ? 20 : Number(limit), afterId)
    return { data, meta: { ...meta, nextCursor: nextId ? consentCursor(this.config.clientSecret, active.accountId, nextId) : null } }
  }

  private dataRights(){if(!this.rights)throw new RightsError(503,'DATA_RIGHTS_UNAVAILABLE');return this.rights}
  private rightsKey(request:Request){const key=request.get('Idempotency-Key');if(!key||!UUID.test(key))throw invalid();return key}
  private rightsSession(request:Request){const session=readCookie(this.config,request,'session');if(!session)throw unauthorized();return {hash:digest(session),expected:request.get('X-Xijie-Expected-Session')}}
  @Get('accounts/me/data-requests')
  async dataRequests(@Req()request:Request,@Query('limit')limit:unknown){const session=await activeSession(this.config,this.store,request);if(limit!==undefined&&(typeof limit!=='string'||!/^\d+$/.test(limit)||Number(limit)<1||Number(limit)>100))throw invalid();return {data:await this.dataRights().list(session.accountId,limit===undefined?10:Number(limit))}}
  @Post('accounts/me/data-requests')
  @HttpCode(202)
  async requestData(@Req()request:Request,@Res({passthrough:true})response:Response,@Body()body:unknown){this.assertOrigin(request);const key=this.rightsKey(request),session=this.rightsSession(request);if(!session.expected)throw unauthorized();if(!body||typeof body!=='object'||Array.isArray(body))throw invalid();const value=body as Record<string,unknown>;if(Object.keys(value).some(k=>!['kind','scope','deletionReceiptId','statusProof'].includes(k))||!['export','delete_account'].includes(String(value.kind)))throw invalid();const scope=value.scope??(value.kind==='delete_account'?'account_data':undefined);if(!['interaction_data','account_data'].includes(String(scope)))throw invalid();if(value.kind==='delete_account'){if(scope!=='account_data'||typeof value.deletionReceiptId!=='string'||!UUID.test(value.deletionReceiptId)||typeof value.statusProof!=='string'||!PROOF.test(value.statusProof))throw invalid()}else if(value.deletionReceiptId!==undefined||value.statusProof!==undefined)throw invalid();return {data:await this.dataRights().create(session.hash,session.expected,key,{...value,scope} as CreateRequest,String(response.getHeader('X-Request-Id')))}}
  @Get('accounts/me/data-requests/:id')
  async readDataRequest(@Req()request:Request,@Param('id')id:string){if(!UUID.test(id))throw invalid();const session=await activeSession(this.config,this.store,request);return {data:await this.dataRights().get(session.accountId,id)}}
  @Post('accounts/me/data-requests/:id/retry')
  @HttpCode(202)
  async retryDataRequest(@Req()request:Request,@Param('id')id:string,@Body()body:unknown){this.assertOrigin(request);if(!UUID.test(id)||body!==undefined&&(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length))throw invalid();const key=this.rightsKey(request),s=this.rightsSession(request);if(!s.expected)throw unauthorized();return {data:await this.dataRights().retryAccount(s.hash,s.expected,id,key)}}
  @Get('data-request-receipts/:id')
  async receipt(@Req()request:Request,@Param('id')id:string){const proof=request.get('X-Data-Request-Proof');if(!UUID.test(id)||!proof||!PROOF.test(proof))throw invalid();this.receiptRate(request,id);return {data:await this.dataRights().readReceipt(id,proof)}}
  private receiptRate(request:Request,id:string){const now=Date.now(),key=id+':'+request.socket.remoteAddress,prior=this.receiptReads.get(key);if(prior&&prior.until>now){if(++prior.count>120)throw new RightsError(429,'RATE_LIMITED')}else{if(this.receiptReads.size>=1024){for(const [entry,value] of this.receiptReads)if(value.until<=now)this.receiptReads.delete(entry);if(this.receiptReads.size>=1024)this.receiptReads.delete(this.receiptReads.keys().next().value!)}this.receiptReads.set(key,{until:now+60000,count:1})}}
  @Post('data-request-receipts/:id/retry')
  @HttpCode(202)
  async retryReceipt(@Req()request:Request,@Param('id')id:string,@Body()body:unknown){this.assertOrigin(request);const proof=request.get('X-Data-Request-Proof');if(!UUID.test(id)||!proof||!PROOF.test(proof)||body!==undefined&&(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length))throw invalid();this.receiptRate(request,id);return {data:await this.dataRights().retryReceipt(id,proof,this.rightsKey(request))}}
  private async currentSnapshots(id:string){const rights=this.dataRights();return new RightsEngine(rights,new RightsDependencies(rights.config)).snapshots(await rights.row(id))}
  @Post('accounts/me/data-requests/:id/download')
  @HttpCode(200)
  async downloadData(@Req()request:Request,@Param('id')id:string,@Body()body:unknown){this.assertOrigin(request);if(!UUID.test(id)||body!==undefined&&(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length))throw invalid();const key=this.rightsKey(request),s=this.rightsSession(request);if(!s.expected)throw unauthorized();return {data:await this.dataRights().download(s.hash,s.expected,id,()=>this.currentSnapshots(id),key)}}
  @Get('accounts/me/data-requests/:id/content')
  async dataContent(@Req()request:Request,@Res()response:Response,@Param('id')id:string,@Query('grant')grant:unknown){if(!UUID.test(id)||typeof grant!=='string'||!UUID.test(grant))throw invalid();const s=this.rightsSession(request);const body=await this.dataRights().content(s.hash,s.expected,id,grant,()=>this.currentSnapshots(id));response.setHeader('Content-Type','application/json; charset=utf-8');response.setHeader('Content-Disposition','attachment; filename="xijie-data-'+id+'.json"');Readable.from(body).pipe(response)}

  @Post('accounts/me/consents')
  async recordConsent(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: unknown) {
    this.assertOrigin(request)
    const session = readCookie(this.config, request, 'session')
    if (!session) throw unauthorized()
    const key = request.get('Idempotency-Key')
    if (!key || !UUID.test(key)) throw invalid()
    const expected = request.get('X-Xijie-Expected-Session')
    const data = await this.consents.record(digest(session), expected, key, String(response.getHeader('X-Request-Id')), consentInput(body))
    return { data }
  }
}

@Controller('internal/v1')
class InternalIdentityController {
  constructor(
    @Inject(CONFIG) private readonly config: IdentityConfig,
    @Inject(IdentityStore) private readonly store: IdentityStore,
    @Inject(ConsentStore) private readonly consents: ConsentStore,
    @Optional() @Inject(RightsStore) private readonly rights?:RightsStore,
    @Optional() @Inject(ReferralsStore) private readonly referrals?:ReferralsStore,
    @Optional() @Inject(ModelExecutionStore) private readonly models?:ModelExecutionStore,
  ) {}

  private authorize(request: Request, accountContext = false) {
    const allowed = accountContext
      ? [this.config.peopleServiceToken, this.config.conversationsServiceToken, this.config.memoriesServiceToken, this.config.socialServiceToken, this.config.mediaServiceToken, this.config.giftsServiceToken]
      : [this.config.peopleServiceToken, this.config.conversationsServiceToken, this.config.memoriesServiceToken, this.config.socialServiceToken, this.config.mediaServiceToken, this.config.giftsServiceToken]
    const tokens = allowed.filter((value): value is string => Boolean(value))
    if (!tokens.length) throw new ApiError(404, 'NOT_FOUND', 'This endpoint was not found.')
    const candidate = /^Bearer ([0-9a-f]{64})$/i.exec(request.get('Authorization') || '')?.[1]
    if (!candidate || !tokens.some(expected => timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(expected, 'hex')))) {
      throw new ApiError(403, 'FORBIDDEN', 'The calling service is not authorized.')
    }
  }

  private giftsReferrals(request:Request){
    const expected=this.config.giftsServiceToken,candidate=/^Bearer ([0-9a-f]{64})$/i.exec(request.get('Authorization')||'')?.[1]
    if(!expected||!this.referrals)throw new ReferralError(403,'FEATURE_DISABLED')
    if(!candidate||!timingSafeEqual(Buffer.from(candidate,'hex'),Buffer.from(expected,'hex')))throw new ReferralError(403,'FORBIDDEN')
    return this.referrals
  }
  @Get('referrals/pending')
  async pendingReferrals(@Req()request:Request){
    const store=this.giftsReferrals(request),{limit,after}=request.query
    if(Object.keys(request.query).some(key=>!['limit','after'].includes(key))||limit!==undefined&&(typeof limit!=='string'||!/^([1-9][0-9]?|100)$/.test(limit))||after!==undefined&&(typeof after!=='string'||!UUID.test(after)))throw invalid()
    return store.pending(limit===undefined?20:Number(limit),typeof after==='string'?after.toLowerCase():null)
  }
  @Post('referrals/:id/rewarded')
  @HttpCode(200)
  async rewardedReferral(@Req()request:Request,@Param('id')id:string,@Body()body:unknown){
    const store=this.giftsReferrals(request)
    if(!UUID.test(id)||!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==2||!('receiptId'in body)||!('qualifiedAt'in body)||typeof body.receiptId!=='string'||!UUID.test(body.receiptId)||typeof body.qualifiedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(body.qualifiedAt)||!Number.isFinite(Date.parse(body.qualifiedAt)))throw invalid()
    return{data:await store.rewarded(id.toLowerCase(),body.receiptId.toLowerCase(),body.qualifiedAt)}
  }

  private modelService(request:Request):ModelService{
    const candidate=/^Bearer ([0-9a-f]{64})$/i.exec(request.get('Authorization')||'')?.[1]
    if(!candidate||!this.models)throw new ApiError(403,'FORBIDDEN','The calling service is not authorized.')
    const entries=[['conversations',this.config.conversationsServiceToken],['memories',this.config.memoriesServiceToken],['social',this.config.socialServiceToken],['gifts',this.config.giftsServiceToken]] as const
    const found=entries.find(([,expected])=>expected&&timingSafeEqual(Buffer.from(candidate,'hex'),Buffer.from(expected,'hex')))
    if(!found)throw new ApiError(403,'FORBIDDEN','The calling service is not authorized.')
    return found[0]
  }
  @Post('model-executions/claim') @HttpCode(200)
  async claimModel(@Req()request:Request,@Body()body:unknown){
    const service=this.modelService(request)
    if(!body||typeof body!=='object'||Array.isArray(body))throw invalid()
    const v=body as Record<string,unknown>
    if(Object.keys(v).length!==4||['accountId','jobId','attemptId'].some(k=>typeof v[k]!=='string'||!UUID.test(v[k] as string))||typeof v.purpose!=='string'||!(modelPurposes[service] as readonly string[]).includes(v.purpose))throw invalid()
    return{data:await this.models!.claim(service,{accountId:(v.accountId as string).toLowerCase(),jobId:(v.jobId as string).toLowerCase(),attemptId:(v.attemptId as string).toLowerCase(),purpose:v.purpose})}
  }
  @Get('model-executions/accounts')
  async modelAccounts(@Req()request:Request){
    const service=this.modelService(request),{purpose,after}=request.query
    if(Object.keys(request.query).some(k=>!['purpose','after'].includes(k))||typeof purpose!=='string'||!['automatic_memory','memory_echo'].includes(purpose)||after!==undefined&&(typeof after!=='string'||!UUID.test(after)))throw invalid()
    return{data:await this.models!.eligible(service,purpose,typeof after==='string'?after.toLowerCase():undefined)}
  }
  @Post('model-executions/:id/finish') @HttpCode(200)
  async finishModel(@Req()request:Request,@Param('id')id:string,@Body()body:unknown){
    const service=this.modelService(request)
    if(!UUID.test(id)||!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>k!=='succeeded'&&k!=='usage')||!('succeeded'in body)||typeof body.succeeded!=='boolean')throw invalid()
    const usage='usage'in body?body.usage:undefined
    if(usage!==undefined&&(!isModelAttemptUsage(usage)||body.succeeded&&usage.state!=='returned'))throw invalid()
    return{data:await this.models!.finish(service,id.toLowerCase(),body.succeeded,usage)}
  }

  @Get('session-context')
  async sessionContext(@Req() request: Request) {
    this.authorize(request)
    const active = await activeSession(this.config, this.store, request)
    const authorizations = await this.consents.authorizations(active.accountId)
    return { data: { accountId: active.accountId, sessionId: active.id, expiresAt: active.expiresAt.toISOString(), ...authorizations } }
  }

  @Get('data-requests/:id/context')
  async dataRequestContext(@Req()request:Request,@Param('id')id:string){this.authorize(request);if(!UUID.test(id))throw invalid();if(!this.rights)throw new RightsError(503,'DATA_RIGHTS_UNAVAILABLE');return {data:await this.rights.context(id)}}

  @Get('accounts/:id/context')
  async accountContext(@Req() request: Request, @Param('id') id: string) {
    this.authorize(request, true)
    if (!UUID.test(id)) throw invalid()
    const account = await this.store.accountContext(id.toLowerCase())
    if (!account) throw new ApiError(404, 'NOT_FOUND', 'The requested account was not found.')
    return { data: { ...account, ...await this.consents.authorizations(account.accountId) } }
  }
}

@Module({})
export class IdentityModule {
  static register(config: IdentityConfig, store: IdentityStore, oidc: OidcProvider, consents: ConsentStore, embedded?: EmbeddedAuth,rights?:RightsStore,referrals?:ReferralsStore,models?:ModelExecutionStore,native?:NativeAuthStore,passwords?:PasswordAuth,wechat?:NativeWechatAuth): DynamicModule {
    return {
      module: IdentityModule, imports:[ContentReportsModule.register(store,config.origin)],controllers: [IdentityController, InternalIdentityController],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: IdentityStore, useValue: store },
        { provide: OIDC, useValue: oidc },
        { provide: ConsentStore, useValue: consents },
        ...(embedded ? [{ provide: EmbeddedAuth, useValue: embedded }] : []),
        ...(rights ? [{provide:RightsStore,useValue:rights}]:[]),
        ...(referrals ? [{provide:ReferralsStore,useValue:referrals}]:[]),
        ...(models ? [{provide:ModelExecutionStore,useValue:models}]:[]),
        ...(native ? [{provide:NativeAuthStore,useValue:native}]:[]),
        ...(passwords ? [{provide:PasswordAuth,useValue:passwords}]:[]),
        ...(wechat ? [{provide:NativeWechatAuth,useValue:wechat}]:[]),
      ],
    }
  }
}
