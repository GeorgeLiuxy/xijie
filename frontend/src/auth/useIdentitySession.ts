import { useCallback, useEffect, useRef, useState } from 'react'
import type { SmsChallenge } from './preview'
import {isNativeRuntime} from '../mobile/back'
import {nativeAuth,type NativePending,type NativeCapabilities,type SocialProvider} from './nativeAuth'
import { validPasswordPolicy, validAuthentication, validChallenge, validProgress, authUuid, type AuthPurpose, type PasswordService } from './password'
import {clearKnownChatCapture} from '../mobile/chatCapture'

type Account = { id: string; displayName: string; capabilities?: { privateStoryDrafts?: boolean } }
type Session = { id: string; accountId: string; expiresAt: string }
type PendingAttempt = { attemptId: string; expiresAt: string; purpose?: AuthPurpose; previousAccountId?: string;expectedSessionId?:string;native?:boolean }
type Arrival = 'login' | 'return' | 'same-account'
type Entry = { callback: 'success' | 'failed' | 'cancelled' | null; attempt: PendingAttempt | null }

type View =
  | { kind: 'checking' }
  | { kind: 'signed-out' }
  | { kind: 'signed-in'; account: Account; session: Session }
  | { kind: 'unavailable' }

export type IdentityAction = 'cancel' | 'logout'
export type IdentityNotice = 'cancelled' | 'failed' | 'request-error'

const ATTEMPT_STORAGE = 'xijie.identity.web.attempt'
const EXPECTED_SESSION_HEADER = 'X-Xijie-Expected-Session'
const identityScope = (view: View) => view.kind === 'signed-in' ? JSON.stringify([view.account.id, view.session.id]) : view.kind
const cancelled = () => new DOMException('Authentication scope changed', 'AbortError')

export class IdentityRequestError extends Error {
  constructor(readonly status: number, readonly code?: string, readonly retryAfter?: number) {
    super('Identity service request failed')
  }
}

async function request(path: string, signal: AbortSignal, options: RequestInit = {}) {
  if(signal.aborted)throw cancelled()
  const combined=AbortSignal.any([signal,AbortSignal.timeout(20000)])
  const response = await fetch(path, { ...options, signal:combined, credentials: 'same-origin', cache: 'no-store', redirect: 'error' })
  if (combined.aborted) throw combined.reason
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { error?: { code?: string; details?: { retryAfter?: number } } } | null
    throw new IdentityRequestError(response.status, error?.error?.code, error?.error?.details?.retryAfter)
  }
  return response
}

async function readData<T>(path: string, signal: AbortSignal, options?: RequestInit): Promise<T> {
  const response = await request(path, signal, options)
  const result = await response.json() as { data?: T }
  if (signal.aborted) throw cancelled()
  if (result.data == null) throw new Error('Missing identity service data')
  return result.data
}

function readAttempt(): PendingAttempt | null {
  try {
    const stored = sessionStorage.getItem(ATTEMPT_STORAGE)
    if (!stored) return null
    const value = JSON.parse(stored) as PendingAttempt
    if (typeof value.attemptId === 'string' && Date.parse(value.expiresAt) > Date.now()) return value
  } catch { /* Session storage is optional. */ }
  return null
}

function readEntry(): Entry {
  const value = new URLSearchParams(location.search).get('auth')
  const callback = value === 'success' || value === 'failed' || value === 'cancelled' ? value : null
  return { callback, attempt: readAttempt() }
}

function storeAttempt(attempt: PendingAttempt | null) {
  try {
    if (attempt) sessionStorage.setItem(ATTEMPT_STORAGE, JSON.stringify(attempt))
    else sessionStorage.removeItem(ATTEMPT_STORAGE)
  } catch { /* Server state is still authoritative. */ }
}

export function useIdentitySession() {
  const [initialEntry] = useState(readEntry)
  const [view, setView] = useState<View>({ kind: 'checking' })
  const verifiedView=useRef<View>(view);verifiedView.current=view
  const authScope = useRef({ key: identityScope(view) })
  if (authScope.current.key !== identityScope(view)) authScope.current = { key: identityScope(view) }
  const renderedScope = authScope.current
  const requestScope = (signal: AbortSignal) => {
    const check = () => { if (signal.aborted || authScope.current !== renderedScope || identityScope(verifiedView.current) !== renderedScope.key) throw cancelled() }
    check(); return check
  }
  const [pending, setPending] = useState(initialEntry.attempt)
  const [arrival, setArrival] = useState<Arrival | null>(null)
  const [hasSignedIn, setHasSignedIn] = useState(false)
  const entry = useRef<Entry | null>(null)
  const [action, setAction] = useState<IdentityAction | null>(null)
  const [notice, setNotice] = useState<IdentityNotice | null>(null)
  const [returnedFromSwitch, setReturnedFromSwitch] = useState(false)
  const [reauthenticated, setReauthenticated] = useState(0)
  const activeRead = useRef<AbortController | null>(null)
  const activeAction = useRef<AbortController | null>(null)
  const smsRequest = useRef<{ phone: string; purpose: string; key: string; scope: object } | null>(null)
  const providerRequest = useRef<{provider:SocialProvider;purpose:AuthPurpose;key:string;scope:object}|null>(null)
  const [providers,setProviders]=useState<Record<SocialProvider,boolean>>({apple:false,wechat:false,google:false})
  const nativeTransports=useRef<Partial<Record<SocialProvider,'browser'|'wechat_sdk'>>>({})
  const nativeOperation=useRef<{startKey:string;attemptId?:string}|null>(null)
  const [nativeEnabled,setNativeEnabled]=useState(false)
  const [providerProgress,setProviderProgress]=useState<'waiting'|'processing'|'unconfirmed'|undefined>(undefined)
  const nativeReading=useRef(false),pendingRef=useRef(pending);pendingRef.current=pending
  const verifyKeys = useRef(new Map<string, string>())
  const passwordArrival=useRef<PendingAttempt|null>(null)
  const clearReturnedFromSwitch = useCallback(() => setReturnedFromSwitch(false), [])
  useEffect(()=>{
    const erased=(event:Event)=>{
      const accountId=(event as CustomEvent<{accountId?:unknown}>).detail?.accountId,current=verifiedView.current
      if(typeof accountId!=='string'||current.kind!=='signed-in'||current.account.id!==accountId)return
      void clearKnownChatCapture({ accountId: current.account.id, sessionId: current.session.id }).catch(() => {})
      activeRead.current?.abort();activeRead.current=null;verifiedView.current={kind:'signed-out'};setView({kind:'signed-out'})
    }
    window.addEventListener('xijie:private-drafts-erased',erased)
    return()=>window.removeEventListener('xijie:private-drafts-erased',erased)
  },[])
  useEffect(()=>{
    const controller=new AbortController()
    void readData<{id:string;enabled:boolean;nativeHandoffEnabled?:boolean;nativeSdkEnabled?:boolean}[]>('/v1/auth/providers',controller.signal).then(async items=>{
      if(!Array.isArray(items)||items.some(item=>!item||!['apple','wechat','google'].includes(item.id)||typeof item.enabled!=='boolean'||['nativeHandoffEnabled','nativeSdkEnabled'].some(key=>item[key as keyof typeof item]!==undefined&&typeof item[key as keyof typeof item]!=='boolean'))||new Set(items.map(item=>item.id)).size!==items.length)throw new Error('Invalid provider capabilities')
      if(!controller.signal.aborted){
        const native=isNativeRuntime(), enabled:Record<SocialProvider,boolean>={apple:false,wechat:false,google:false}
        let browser:SocialProvider[]=[]
        let wechatSdk=false
        if(native){
          try{
            const caps=await nativeAuth<NativeCapabilities>('getCapabilities')
            if(caps?.version!==1||!Array.isArray(caps.browserProviders)||caps.browserProviders.some(id=>!['apple','google','wechat'].includes(id))||new Set(caps.browserProviders).size!==caps.browserProviders.length||!caps.wechatNative||typeof caps.wechatNative.configured!=='boolean'||typeof caps.wechatNative.installed!=='boolean')throw new Error('Invalid native capabilities')
            browser=caps.browserProviders
            wechatSdk=caps.wechatNative.configured&&caps.wechatNative.installed
          }catch(error){if(['UNIMPLEMENTED','UNAVAILABLE'].includes((error as {code?:string})?.code??''))browser=['apple','wechat']}
        }
        if(controller.signal.aborted)return
        const transports:Partial<Record<SocialProvider,'browser'|'wechat_sdk'>>={}
        for(const item of items){const id=item.id as SocialProvider;if(native&&id==='wechat'&&item.nativeSdkEnabled===true&&item.nativeHandoffEnabled===true&&wechatSdk){enabled[id]=true;transports[id]='wechat_sdk'}else{enabled[id]=item.enabled&&(!native||browser.includes(id)&&item.nativeHandoffEnabled===true);if(native&&enabled[id])transports[id]='browser'}}
        nativeTransports.current=transports;setNativeEnabled(native&&Object.keys(transports).length>0);setProviders(enabled)
      }
    }).catch(()=>{if(!controller.signal.aborted)setProviders({apple:false,wechat:false,google:false})})
    return()=>controller.abort()
  },[])

  const refresh = useCallback(async () => {
    activeRead.current?.abort()
    const controller = new AbortController()
    const { signal } = controller
    activeRead.current = controller
    // Keep the original successful OTP animation on screen until the verified account can replace it.
    setView(previous => previous.kind === 'signed-in' || entry.current?.callback === 'success' ? previous : { kind: 'checking' })
    try {
      const session = await readData<Session>('/v1/sessions/current', signal)
      const account = await readData<Account>('/v1/accounts/me', signal, { headers: { [EXPECTED_SESSION_HEADER]: session.id } })
      if (typeof account.id !== 'string' || session.accountId !== account.id || typeof account.displayName !== 'string') {
        throw new Error('Account and session do not match')
      }
      if (!signal.aborted) {
        const previous = entry.current
        entry.current = null
        let nextArrival: Arrival | null = null
        if (previous?.callback === 'success' && previous.attempt?.purpose === 'reauthenticate') {
          if(previous.attempt.expectedSessionId===session.id&&previous.attempt.previousAccountId===account.id)setReauthenticated(value=>value+1)
          else setNotice('failed')
        } else if (previous?.callback === 'success') {
          nextArrival = previous.attempt?.previousAccountId === account.id ? 'same-account' : 'login'
        } else if (previous && previous.attempt?.purpose !== 'switch') {
          nextArrival = 'return'
        }
        setArrival(nextArrival)
        setHasSignedIn(true)
        const next:View={ kind: 'signed-in', session, account };verifiedView.current=next;setView(next)
      }
    } catch (error) {
      if (!signal.aborted) {
        const next:View={ kind: error instanceof IdentityRequestError && error.status === 401 ? 'signed-out' : 'unavailable' };verifiedView.current=next;setView(next)
      }
    } finally {
      if (activeRead.current === controller) activeRead.current = null
    }
  }, [])

  useEffect(()=>{
    if(!isNativeRuntime()||!nativeEnabled)return
    const controller=new AbortController()
    const poll=async()=>{
      if(nativeReading.current||controller.signal.aborted)return;nativeReading.current=true
      let reading:NativePending|undefined
      try{
        const saved=await nativeAuth('getPending')
        reading=saved
        if(controller.signal.aborted)return
        if(!saved.pending){setProviderProgress(undefined);if(pendingRef.current?.native){storeAttempt(null);setPending(null);setNotice('failed')}return}
        if(!saved.attemptId)return
        setProviderProgress(saved.stage==='completing'?'processing':'waiting')
        const details:PendingAttempt={attemptId:saved.attemptId,expiresAt:new Date(saved.expiresAt).toISOString(),purpose:saved.purpose,previousAccountId:saved.previousAccountId,expectedSessionId:saved.expectedSessionId,native:true}
        storeAttempt(details);setPending(prior=>prior?.attemptId===details.attemptId?prior:details)
        if(saved.failed&&!saved.ticket){await nativeAuth('clear',{attemptId:saved.attemptId,startKey:saved.startKey});if(pendingRef.current?.attemptId===saved.attemptId){storeAttempt(null);setPending(null);setNotice('failed')};return}
        if(!saved.ticket||!saved.verifier)return
        const result=await readData<{status:string;sessionId?:string;reauthenticatedAt?:string}>('/v1/auth/native-attempts/'+encodeURIComponent(saved.attemptId)+'/redeem',controller.signal,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':saved.redeemKey,...(saved.expectedSessionId?{[EXPECTED_SESSION_HEADER]:saved.expectedSessionId}:{})},body:JSON.stringify({verifier:saved.verifier,ticket:saved.ticket})})
        if(saved.purpose==='reauthenticate'?(result.status!=='reauthenticated'||result.sessionId!==saved.expectedSessionId||!result.reauthenticatedAt||!Number.isFinite(Date.parse(result.reauthenticatedAt))):result.status!=='verified')throw new Error('Invalid native authorization result')
        if(saved.purpose==='reauthenticate'){const actual=await readData<Session>('/v1/sessions/current',controller.signal,{headers:{[EXPECTED_SESSION_HEADER]:saved.expectedSessionId!}});if(actual.id!==saved.expectedSessionId||actual.accountId!==saved.previousAccountId)throw new IdentityRequestError(409,'IDENTITY_SCOPE_CHANGED')}
        await nativeAuth('clear',{attemptId:saved.attemptId,startKey:saved.startKey});if(controller.signal.aborted||pendingRef.current?.native&&pendingRef.current.attemptId!==saved.attemptId)return;setProviderProgress(undefined);storeAttempt(null);setPending(null);entry.current={callback:'success',attempt:details};await refresh()
      }catch(error){if(!controller.signal.aborted&&(error as {code?:string}).code==='AUTH_RESULT_UNKNOWN')setProviderProgress('unconfirmed');if(!controller.signal.aborted&&reading?.attemptId&&error instanceof IdentityRequestError&&[400,403,409,410].includes(error.status)){await nativeAuth('clear',{attemptId:reading.attemptId,startKey:reading.startKey}).catch(()=>{});if(pendingRef.current?.attemptId===reading.attemptId){setProviderProgress(undefined);storeAttempt(null);setPending(null);setNotice('failed')}}}finally{nativeReading.current=false}
    }
    void poll();const timer=window.setInterval(()=>{void poll()},1000),focus=()=>{void poll()};window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus)
    return()=>{controller.abort();window.clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus)}
  },[nativeEnabled,refresh])

  useEffect(() => {
    function restore(opening: Entry) {
      entry.current = opening
      const { callback, attempt } = opening
      setReturnedFromSwitch(callback !== 'success' && attempt?.purpose === 'switch')
      if (callback) {
        const url = new URL(location.href)
        url.searchParams.delete('auth')
        history.replaceState(history.state, '', url)
        storeAttempt(null)
        setPending(null)
        setNotice(callback === 'success' ? null : callback)
      } else {
        setPending(attempt)
      }
      void refresh()
    }

    function returnFromProvider(event: PageTransitionEvent) {
      if (!event.persisted) return
      activeAction.current?.abort()
      activeAction.current = null
      setAction(null)
      restore(readEntry())
    }

    restore(initialEntry)
    window.addEventListener('pageshow', returnFromProvider)
    return () => {
      activeRead.current?.abort()
      activeAction.current?.abort()
      window.removeEventListener('pageshow', returnFromProvider)
    }
  }, [initialEntry, refresh])

  const expiresAt = view.kind === 'signed-in' ? view.session.expiresAt : null
  useEffect(() => {
    if (!expiresAt) return
    const remaining = Date.parse(expiresAt) - Date.now()
    if (!Number.isFinite(remaining)) return
    const timer = window.setTimeout(() => { void refresh() }, Math.min(2_147_483_647, Math.max(0, remaining) + 1000))
    return () => window.clearTimeout(timer)
  }, [expiresAt, refresh])

  async function startProvider(provider:SocialProvider,purpose:AuthPurpose,signal:AbortSignal){
    const currentScope=requestScope(signal)
    if(purpose!=='sign_in'&&view.kind!=='signed-in')throw new IdentityRequestError(401,'UNAUTHENTICATED')
    if(providers[provider]!==true)throw new IdentityRequestError(503,'AUTH_PROVIDER_UNAVAILABLE')
    if(purpose==='switch'&&view.kind==='signed-in')await clearKnownChatCapture({accountId:view.account.id,sessionId:view.session.id}).catch(()=>{})
    currentScope()
    if(isNativeRuntime()){
      if(!nativeEnabled)throw new IdentityRequestError(503,'AUTH_PROVIDER_UNAVAILABLE')
      const transport=nativeTransports.current[provider]??'browser'
      const intent={provider,purpose,...(transport==='wechat_sdk'?{transport}:{}),...(view.kind==='signed-in'?{expectedSessionId:view.session.id,previousAccountId:view.account.id}:{})}
      let saved=await nativeAuth('prepare',intent)
      currentScope()
      nativeOperation.current={startKey:saved.startKey,attemptId:saved.attemptId}
      if(saved.attemptId){
        if(!saved.failed&&saved.stage!=='failed'){
          const details:PendingAttempt={attemptId:saved.attemptId,expiresAt:new Date(saved.expiresAt).toISOString(),purpose,previousAccountId:saved.previousAccountId,expectedSessionId:saved.expectedSessionId,native:true}
          storeAttempt(details);setPending(details);setProviderProgress(saved.stage==='completing'?'processing':'waiting');await nativeAuth('getPending',{attemptId:saved.attemptId,startKey:saved.startKey});currentScope();return
        }
        await request('/v1/auth/attempts/'+encodeURIComponent(saved.attemptId),signal,{method:'DELETE',headers:saved.expectedSessionId?{[EXPECTED_SESSION_HEADER]:saved.expectedSessionId}:{}})
        currentScope();await nativeAuth('clear',{attemptId:saved.attemptId,startKey:saved.startKey});currentScope();saved=await nativeAuth('prepare',intent);currentScope()
      }
      const result=await readData<{attemptId:string;expiresAt:string;launchUrl?:string}>('/v1/auth/native-attempts',signal,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':saved.startKey,...(saved.expectedSessionId?{[EXPECTED_SESSION_HEADER]:saved.expectedSessionId}:{})},body:JSON.stringify({provider,purpose,...(transport==='wechat_sdk'?{transport}:{}),verifierChallenge:saved.verifierChallenge,launchProof:saved.launchProof})})
      currentScope()
      if(!authUuid.test(result.attemptId)||!Number.isFinite(Date.parse(result.expiresAt))||Date.parse(result.expiresAt)<=Date.now()||transport==='browser'&&typeof result.launchUrl!=='string')throw new IdentityRequestError(502,'INVALID_RESPONSE')
      const details:PendingAttempt={attemptId:result.attemptId,expiresAt:result.expiresAt,purpose,previousAccountId:saved.previousAccountId,expectedSessionId:saved.expectedSessionId,native:true};storeAttempt(details);setPending(details)
      nativeOperation.current={startKey:saved.startKey,attemptId:result.attemptId}
      setProviderProgress('waiting')
      await nativeAuth('launch',{...result,...(transport==='wechat_sdk'?{transport}:{}),startKey:saved.startKey,expiresAt:Date.parse(result.expiresAt)});currentScope();return
    }
    if(!providerRequest.current||providerRequest.current.provider!==provider||providerRequest.current.purpose!==purpose||providerRequest.current.scope!==renderedScope)providerRequest.current={provider,purpose,key:crypto.randomUUID(),scope:renderedScope}
    const result=await readData<{attemptId:string;expiresAt:string;authorizationUrl:string}>('/v1/auth/attempts',signal,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':providerRequest.current.key,...(view.kind==='signed-in'?{[EXPECTED_SESSION_HEADER]:view.session.id}:{})},body:JSON.stringify({client:'web',purpose,provider,returnRouteKey:'home'})})
    currentScope()
    const target=new URL(result.authorizationUrl)
    if(!/^[0-9a-f-]{36}$/i.test(result.attemptId)||!Number.isFinite(Date.parse(result.expiresAt))||Date.parse(result.expiresAt)<=Date.now()||target.username||target.password||target.hash||target.protocol!=='https:'&&!(target.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(target.hostname)))throw new Error('Invalid provider attempt')
    currentScope()
    const details:PendingAttempt={attemptId:result.attemptId,expiresAt:result.expiresAt,purpose,...(view.kind==='signed-in'?{previousAccountId:view.account.id,expectedSessionId:view.session.id}:{})}
    storeAttempt(details);setPending(details)
    location.assign(target.href)
  }

  async function requestCode(purpose: 'sign_in' | 'switch', dial: string, phone: string, signal: AbortSignal): Promise<SmsChallenge> {
    const currentScope=requestScope(signal)
    if(purpose==='switch'&&view.kind==='signed-in')await clearKnownChatCapture({accountId:view.account.id,sessionId:view.session.id}).catch(()=>{})
    currentScope()
    const signature = dial + phone
    if (!smsRequest.current || smsRequest.current.phone !== signature || smsRequest.current.purpose !== purpose || smsRequest.current.scope !== renderedScope) {
      smsRequest.current = { phone: signature, purpose, key: crypto.randomUUID(), scope: renderedScope }
    }
    const current = smsRequest.current
    try {
      const challenge = await readData<{ id: string; expiresAt: string; resendAt: string }>('/v1/auth/sms-challenges', signal, {
        method: 'POST', headers: {
          'Content-Type': 'application/json', 'Idempotency-Key': current.key,
          ...(view.kind === 'signed-in' ? { [EXPECTED_SESSION_HEADER]: view.session.id } : {}),
        }, body: JSON.stringify({ dial, phone, purpose }),
      })
      currentScope()
      const details: PendingAttempt = {
        attemptId: challenge.id, expiresAt: challenge.expiresAt, purpose,
        previousAccountId: purpose === 'switch' && view.kind === 'signed-in' ? view.account.id : undefined,
      }
      storeAttempt(details)
      setPending(details)
      if (smsRequest.current === current) smsRequest.current = null
      return { ...challenge, dial, phone, expiresAt: Date.parse(challenge.expiresAt), resendAt: Date.parse(challenge.resendAt) }
    } catch (error) {
      currentScope()
      if (error instanceof IdentityRequestError && smsRequest.current === current) smsRequest.current = null
      throw error
    }
  }

  async function verifyCode(challenge: SmsChallenge, code: string, signal: AbortSignal) {
    const currentScope=requestScope(signal)
    const signature = challenge.id + ':' + code
    let key = verifyKeys.current.get(signature)
    if (!key) { key = crypto.randomUUID(); verifyKeys.current.set(signature, key) }
    try {
      const result=await readData<{ status: 'verified' | 'incorrect' | 'expired' }>('/v1/auth/sms-challenges/' + encodeURIComponent(challenge.id) + '/verify', signal, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify({ code }),
      })
      currentScope();return result
    } catch (error) {
      currentScope()
      if (error instanceof IdentityRequestError && error.status === 410) return { status: 'expired' } as const
      throw error
    }
  }

  function finishEmbedded(attempt:PendingAttempt|null) {
    // The backend cookie already represents a verified session. Read it before showing any account data.
    entry.current = { callback: 'success', attempt }
    setPending(null)
    storeAttempt(null)
    verifyKeys.current.clear()
    void refresh()
  }
  function completeEmbedded(){finishEmbedded(pending)}
  function completePassword(){if(!passwordArrival.current)return;const attempt=passwordArrival.current;passwordArrival.current=null;finishEmbedded(attempt)}

  const passwordHeaders = (key?:string) => ({ ...(key?{'Content-Type':'application/json','Idempotency-Key':key}:{}), ...(view.kind==='signed-in'?{[EXPECTED_SESSION_HEADER]:view.session.id}:{}) })
  async function passwordData<T>(path:string,signal:AbortSignal,method?:string,body?:unknown,key?:string):Promise<T>{
    const check=requestScope(signal)
    if(key!==undefined&&!authUuid.test(key))throw new IdentityRequestError(400,'INVALID_ARGUMENT')
    try{const value=await readData<T>(path,signal,{...(method?{method}:{}),headers:passwordHeaders(key),...(body!==undefined?{body:JSON.stringify(body)}:{})});check();return value}catch(error){check();throw error}
  }
  const password:PasswordService={
    scopeKey:renderedScope.key,
    policy:async signal=>{const value=await passwordData<unknown>('/v1/auth/password-policy',signal);if(!validPasswordPolicy(value))throw new IdentityRequestError(502,'INVALID_RESPONSE');return value},
    authentication:async signal=>{if(view.kind!=='signed-in')throw new IdentityRequestError(401,'UNAUTHENTICATED');const value=await passwordData<unknown>('/v1/accounts/me/authentication',signal);if(!validAuthentication(value))throw new IdentityRequestError(502,'INVALID_RESPONSE');return value},
    signIn:async(input,key,signal)=>{const check=requestScope(signal);if(input.purpose==='switch'&&view.kind==='signed-in')await clearKnownChatCapture({accountId:view.account.id,sessionId:view.session.id}).catch(()=>{});check();const value=await passwordData<{status:string}>('/v1/auth/password-attempts',signal,'POST',input,key);if(value.status!=='verified')throw new IdentityRequestError(502,'INVALID_RESPONSE');passwordArrival.current={attemptId:key,expiresAt:new Date(Date.now()+300000).toISOString(),purpose:input.purpose,...(view.kind==='signed-in'?{previousAccountId:view.account.id}:{})};return{status:'verified'}},
    challenge:async(input,key,signal)=>{const value=await passwordData<unknown>('/v1/auth/password-challenges',signal,'POST',input,key);if(!validChallenge(value)||value.purpose!==input.purpose)throw new IdentityRequestError(502,'INVALID_RESPONSE');return value},
    verify:async(id,code,key,signal)=>{if(!authUuid.test(id))throw new IdentityRequestError(400,'INVALID_ARGUMENT');const value=await passwordData<{status:string}>('/v1/auth/password-challenges/'+id+'/verify',signal,'POST',{code},key);if(!['verified','incorrect','expired'].includes(value.status))throw new IdentityRequestError(502,'INVALID_RESPONSE');return value as {status:'verified'|'incorrect'|'expired'}},
    save:async(id,value,key,signal)=>{if(!authUuid.test(id))throw new IdentityRequestError(400,'INVALID_ARGUMENT');const result=await passwordData<{status:string;requiresSignIn:boolean}>('/v1/auth/password-challenges/'+id+'/password',signal,'PUT',{password:value},key);if(result.status!=='completed'||result.requiresSignIn!==true)throw new IdentityRequestError(502,'INVALID_RESPONSE');return{status:'completed',requiresSignIn:true}},
    status:async(id,signal)=>{if(!authUuid.test(id))throw new IdentityRequestError(400,'INVALID_ARGUMENT');const value=await passwordData<unknown>('/v1/auth/password-challenges/'+id,signal);if(!validProgress(value)||value.id!==id)throw new IdentityRequestError(502,'INVALID_RESPONSE');return value},
    cancel:async(id,signal)=>{const check=requestScope(signal);if(!authUuid.test(id))return;await request('/v1/auth/password-challenges/'+id,signal,{method:'DELETE',headers:passwordHeaders(crypto.randomUUID())});check()},
    changed:async()=>{const check=requestScope(new AbortController().signal);if(view.kind==='signed-in')await clearKnownChatCapture({accountId:view.account.id,sessionId:view.session.id}).catch(()=>{});check();if(isNativeRuntime())await nativeAuth('clear').catch(()=>{});check();entry.current=null;storeAttempt(null);setPending(null);await refresh()},
    refresh,
  }

  async function perform(next: IdentityAction): Promise<boolean> {
    if (activeAction.current || (next === 'cancel' && !pending)) return false
    const controller = new AbortController()
    const { signal } = controller
    activeAction.current = controller
    setAction(next)
    setNotice(null)
    const sessionHeader: Record<string, string> = view.kind === 'signed-in'
      ? { [EXPECTED_SESSION_HEADER]: view.session.id }
      : {}
    try {
      if (next === 'cancel' && pending) {
        let completed = false
        try {
          await request('/v1/auth/attempts/' + encodeURIComponent(pending.attemptId), signal, { method: 'DELETE', headers: sessionHeader })
        } catch (error) {
          if (!(error instanceof IdentityRequestError) || (error.status !== 409 && error.status !== 404)) throw error
          completed = error.status === 409
        }
        if (signal.aborted) return false
        if(pending.native)await nativeAuth('clear',{attemptId:pending.attemptId,...(nativeOperation.current?.attemptId===pending.attemptId?{startKey:nativeOperation.current.startKey}:{})})
        if(pendingRef.current?.attemptId===pending.attemptId){storeAttempt(null);setPending(null);setProviderProgress(undefined);if (!completed) setNotice('cancelled')}
        await refresh()
      } else if (next === 'logout') {
        if(view.kind==='signed-in')await clearKnownChatCapture({accountId:view.account.id,sessionId:view.session.id}).catch(()=>{})
        await request('/v1/sessions/current', signal, { method: 'DELETE', headers: sessionHeader })
        if (signal.aborted) return false
        if(isNativeRuntime())await nativeAuth('clear').catch(()=>{})
        storeAttempt(null)
        setPending(null)
        await refresh()
      }
      return !signal.aborted
    } catch (error) {
      if (!signal.aborted && error instanceof IdentityRequestError && error.status === 401) await refresh()
      else if (!signal.aborted) setNotice('request-error')
      return false
    } finally {
      if (activeAction.current === controller) {
        activeAction.current = null
        setAction(null)
      }
    }
  }

  const playIntro = !hasSignedIn && !initialEntry.callback && !initialEntry.attempt
  const cancelProvider=async()=>{if(pending?.native)await perform('cancel');else if(isNativeRuntime()&&nativeOperation.current){const old=nativeOperation.current;await nativeAuth('clear',{...(old.attemptId?{attemptId:old.attemptId}:{}),startKey:old.startKey});if(nativeOperation.current===old)nativeOperation.current=null}}
  return { view, pending, action, notice, refresh, perform, requestCode, verifyCode, completeEmbedded, completePassword, providers,startProvider,cancelProvider,providerProgress,password,reauthenticated,arrival, playIntro, returnedFromSwitch, clearReturnedFromSwitch }
}

export type IdentitySession = ReturnType<typeof useIdentitySession>
