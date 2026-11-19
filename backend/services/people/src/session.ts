import { parse, serialize } from 'cookie'
import type { PeopleConfig } from './config.js'
import { PeopleError, unauthenticated, uuid } from './contracts.js'

type SessionContext = {
  accountId: string
  sessionId: string
  expiresAt: string
  storyStorage: { allowed: boolean; authorizationVersion: number }
  personPhotoStorage?: { allowed:boolean;authorizationVersion:number }
  personVoiceStorage?:{allowed:boolean;authorizationVersion:number}
}

const unavailable = () => new PeopleError(503, 'SERVICE_UNAVAILABLE', 'The account service is temporarily unavailable.')

function isSession(data: unknown): data is SessionContext {
  if (!data || typeof data !== 'object') return false
  const value = data as Partial<SessionContext>
  const storage = value.storyStorage
  return typeof value.accountId === 'string' && uuid.test(value.accountId)
    && typeof value.sessionId === 'string' && uuid.test(value.sessionId)
    && typeof value.expiresAt === 'string' && Number.isFinite(Date.parse(value.expiresAt))
    && !!storage && typeof storage.allowed === 'boolean'
    && Number.isSafeInteger(storage.authorizationVersion) && storage.authorizationVersion >= (storage.allowed ? 1 : 0)
    && (value.personPhotoStorage===undefined || typeof value.personPhotoStorage.allowed==='boolean' && Number.isSafeInteger(value.personPhotoStorage.authorizationVersion) && value.personPhotoStorage.authorizationVersion >= (value.personPhotoStorage.allowed?1:0))
    && (value.personVoiceStorage===undefined || typeof value.personVoiceStorage.allowed==='boolean' && Number.isSafeInteger(value.personVoiceStorage.authorizationVersion) && value.personVoiceStorage.authorizationVersion >= (value.personVoiceStorage.allowed?1:0))
}

export async function resolveSession(
  config: PeopleConfig, cookieHeader: string, requestId: string, expectedSession?: string,
): Promise<SessionContext> {
  const credential = parse(cookieHeader)[config.sessionCookie]
  if (!credential || !/^[A-Za-z0-9_-]{43}$/.test(credential)) throw unauthenticated()

  let response: Response
  try {
    response = await fetch(config.identityContextUrl, {
      redirect: 'error',
      signal: AbortSignal.timeout(3000),
      headers: {
        authorization: 'Bearer ' + config.serviceToken,
        cookie: serialize(config.sessionCookie, credential),
        'x-request-id': requestId,
      },
    })
  } catch {
    throw unavailable()
  }
  if (response.status === 401) throw unauthenticated()
  if (!response.ok) throw unavailable()

  const result = await response.json().catch(() => null) as { data?: unknown } | null
  if (!isSession(result?.data)) throw unavailable()
  const session = result.data
  if (Date.parse(session.expiresAt) <= Date.now() || (expectedSession !== undefined && expectedSession !== session.sessionId)) {
    throw unauthenticated()
  }
  return session
}

// Service-to-service metadata still checks the current account; it does not need
// a browser cookie, AI permission, or permission to start a new story write.
export async function resolveActiveAccount(config:PeopleConfig,accountId:string,requestId:string){
 let response:Response
 try{response=await fetch(new URL('/internal/v1/accounts/'+accountId+'/context',config.identityContextUrl),{redirect:'error',signal:AbortSignal.timeout(3000),headers:{Authorization:'Bearer '+config.serviceToken,'X-Request-Id':requestId}})}catch{throw unavailable()}
 if(response.status===404||response.status===403||response.status===401)throw new PeopleError(404,'NOT_FOUND','The requested record was not found.')
 if(!response.ok)throw unavailable()
 const value=(await response.json().catch(()=>null))?.data
 if(!value||value.accountId!==accountId||value.status!=='active'||!Number.isSafeInteger(value.accessVersion)||value.accessVersion<1)throw unavailable()
 return value as {accountId:string;status:'active';accessVersion:number}
}

export type SocialAiAccount={accountId:string;status:'active';accessVersion:number;storyStorage:{allowed:boolean;authorizationVersion:number;privateFeedAllowed?:boolean};aiTextProcessing:{allowed:boolean;authorizationVersion:number;privateFeedProcessingAllowed?:boolean}}
export async function resolveSocialAiAccount(config:PeopleConfig,accountId:string,requestId:string,expectedAiVersion:number):Promise<SocialAiAccount>{
 const value=await resolveActiveAccount(config,accountId,requestId) as SocialAiAccount
 const valid=(purpose:unknown,flag:string)=>!!purpose&&typeof purpose==='object'&&typeof (purpose as Record<string,unknown>).allowed==='boolean'
  &&Number.isSafeInteger((purpose as Record<string,unknown>).authorizationVersion)&&Number((purpose as Record<string,unknown>).authorizationVersion)>=0
  &&(!(purpose as Record<string,unknown>).allowed||Number((purpose as Record<string,unknown>).authorizationVersion)>0)
  &&((purpose as Record<string,unknown>)[flag]===undefined||typeof (purpose as Record<string,unknown>)[flag]==='boolean')
 if(!valid(value.storyStorage,'privateFeedAllowed')||!valid(value.aiTextProcessing,'privateFeedProcessingAllowed'))throw unavailable()
 if(!value.storyStorage.allowed||value.storyStorage.privateFeedAllowed!==true)throw new PeopleError(403,'STORAGE_PERMISSION_REQUIRED','Permission for private text feed is required.')
 if(!value.aiTextProcessing.allowed||value.aiTextProcessing.privateFeedProcessingAllowed!==true||value.aiTextProcessing.authorizationVersion!==expectedAiVersion)throw new PeopleError(403,'AI_PERMISSION_REQUIRED','Permission for this AI feed purpose is required.')
 return value
}

type GiftReturnPermission={allowed:boolean;authorizationVersion:number}
export type GiftReturnAccount={accountId:string;status:'active';accessVersion:number;storyStorage:GiftReturnPermission;giftStorage:GiftReturnPermission;giftReturns:GiftReturnPermission}
export async function resolveGiftReturnAccount(config:PeopleConfig,accountId:string,requestId:string,expectedReturnVersion:number,expectedStoryVersion:number):Promise<GiftReturnAccount>{
 const value=await resolveActiveAccount(config,accountId,requestId) as GiftReturnAccount
 for(const purpose of [value.storyStorage,value.giftStorage,value.giftReturns]){
  if(purpose===undefined)throw new PeopleError(403,'GIFT_RETURN_PERMISSION_REQUIRED','Permission for AI gift returns is required.')
  if(!purpose||typeof purpose.allowed!=='boolean'||!Number.isSafeInteger(purpose.authorizationVersion)||purpose.authorizationVersion<(purpose.allowed?1:0))throw unavailable()
  if(!purpose.allowed)throw new PeopleError(403,'GIFT_RETURN_PERMISSION_REQUIRED','Permission for AI gift returns is required.')
 }
 if(value.giftReturns.authorizationVersion!==expectedReturnVersion||value.storyStorage.authorizationVersion!==expectedStoryVersion)throw new PeopleError(403,'AUTHORIZATION_CHANGED','The gift return authorization changed.')
 return value
}
