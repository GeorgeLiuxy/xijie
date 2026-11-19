import {readReferralsConfig} from './referrals-config.js'
import {readReportConfig} from './report-dependencies.js'
export const SESSION_SECONDS = 8 * 60 * 60
export const ATTEMPT_SECONDS = 5 * 60
const loopback = new Set(['127.0.0.1', 'localhost', '[::1]'])

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error('Missing configuration: ' + name)
  return value
}

function externalUrl(name: string) {
  const url = new URL(requiredEnv(name))
  const isLocal = process.env.NODE_ENV !== 'production' && loopback.has(url.hostname)
  if ((url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) || url.username || url.password || url.hash) {
    throw new Error('Invalid URL configuration: ' + name)
  }
  return url
}

export function readConfig() {
  const callback = externalUrl('OIDC_CALLBACK_URL')
  if (callback.pathname !== '/v1/auth/callback' || callback.search) {
    throw new Error('OIDC_CALLBACK_URL must point to /v1/auth/callback')
  }
  const issuer = externalUrl('OIDC_ISSUER')
  if (issuer.search) throw new Error('OIDC_ISSUER cannot contain a query')
  const secure = callback.protocol === 'https:'
  readReportConfig(callback.origin)
  const port = Number(process.env.IDENTITY_PORT || 3101)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid IDENTITY_PORT')
  const host = process.env.IDENTITY_HOST || '127.0.0.1'
  if (!secure && !loopback.has(host)) throw new Error('HTTP development service must bind to loopback')
  const socialFlag=(name:string)=>{const value=process.env[name]??'false';if(!['true','false'].includes(value))throw new Error('Invalid '+name);return value==='true'}
  const socialProviders={apple:socialFlag('OIDC_APPLE_ENABLED'),google:socialFlag('OIDC_GOOGLE_ENABLED'),wechat:socialFlag('OIDC_WECHAT_ENABLED')}
  const nativeHandoffEnabled=socialFlag('OIDC_NATIVE_HANDOFF_ENABLED')
  const readerId=process.env.LOGTO_ACCOUNT_READ_CLIENT_ID?.trim(),readerSecret=process.env.LOGTO_ACCOUNT_READ_CLIENT_SECRET?.trim(),readerResource=process.env.LOGTO_ACCOUNT_READ_RESOURCE?.trim()
  const readerDatabaseUrl=process.env.LOGTO_ACCOUNT_READ_DATABASE_URL?.trim()
  if(readerDatabaseUrl&&[readerId,readerSecret,readerResource].some(Boolean))throw new Error('Choose one Logto account reader mode')
  if(readerDatabaseUrl){const url=new URL(readerDatabaseUrl);if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||url.pathname.length<2||url.hash)throw new Error('Invalid LOGTO_ACCOUNT_READ_DATABASE_URL')}
  if([readerId,readerSecret,readerResource].some(Boolean)&&![readerId,readerSecret,readerResource].every(Boolean))throw new Error('Incomplete Logto account reader configuration')
  const readerUrl=readerResource?new URL(readerResource):undefined
  if(readerUrl&&(readerUrl.protocol!=='https:'||readerUrl.username||readerUrl.password||readerUrl.hash||readerUrl.search))throw new Error('Invalid LOGTO_ACCOUNT_READ_RESOURCE')
  const accountReader=readerDatabaseUrl?{databaseUrl:readerDatabaseUrl}:readerId&&readerSecret&&readerResource?{clientId:readerId,clientSecret:readerSecret,resource:readerResource}:undefined
  if(nativeHandoffEnabled&&!secure&&process.env.NODE_ENV!=='test')throw new Error('Native handoff requires a first-party HTTPS origin')
  if(Object.values(socialProviders).some(Boolean)&&issuer.pathname.replace(/\/$/,'')!=='/oidc')throw new Error('Social sign-in requires the configured Logto issuer')

  const peopleServiceToken = process.env.XIJIE_PEOPLE_SERVICE_TOKEN?.trim() || null
  if (peopleServiceToken && !/^[0-9a-f]{64}$/i.test(peopleServiceToken)) throw new Error('Invalid XIJIE_PEOPLE_SERVICE_TOKEN')
  const conversationsServiceToken = process.env.XIJIE_CONVERSATIONS_SERVICE_TOKEN?.trim() || null
  if (conversationsServiceToken && !/^[0-9a-f]{64}$/i.test(conversationsServiceToken)) throw new Error('Invalid XIJIE_CONVERSATIONS_SERVICE_TOKEN')
  const memoriesServiceToken = process.env.XIJIE_MEMORIES_SERVICE_TOKEN?.trim() || null
  if (memoriesServiceToken && !/^[0-9a-f]{64}$/i.test(memoriesServiceToken)) throw new Error('Invalid XIJIE_MEMORIES_SERVICE_TOKEN')
  const socialServiceToken = process.env.XIJIE_SOCIAL_SERVICE_TOKEN?.trim() || null
  if (socialServiceToken && !/^[0-9a-f]{64}$/i.test(socialServiceToken)) throw new Error('Invalid XIJIE_SOCIAL_SERVICE_TOKEN')
  const mediaServiceToken = process.env.XIJIE_MEDIA_SERVICE_TOKEN?.trim() || null
  if (mediaServiceToken && !/^[0-9a-f]{64}$/i.test(mediaServiceToken)) throw new Error('Invalid XIJIE_MEDIA_SERVICE_TOKEN')

  const giftsServiceToken = process.env.XIJIE_GIFTS_SERVICE_TOKEN?.trim() || null
  if (giftsServiceToken && !/^[0-9a-f]{64}$/i.test(giftsServiceToken)) throw new Error('Invalid XIJIE_GIFTS_SERVICE_TOKEN')

  return {
    socialProviders,nativeHandoffEnabled,accountReader,
    referrals: readReferralsConfig(callback.origin),
    firstPartyExperience: process.env.OIDC_FIRST_PARTY_EXPERIENCE === 'true' ||
      (process.env.NODE_ENV !== 'production' && process.env.OIDC_FIRST_PARTY_EXPERIENCE !== 'false'),
    peopleServiceToken, conversationsServiceToken, memoriesServiceToken, socialServiceToken, mediaServiceToken, giftsServiceToken, databaseUrl: requiredEnv('DATABASE_URL'), host, port, secure,
    origin: callback.origin, callbackUrl: callback.href,
    issuer, clientId: requiredEnv('OIDC_CLIENT_ID'), clientSecret: requiredEnv('OIDC_CLIENT_SECRET'),
    clientRegistrationKey: process.env.OIDC_CLIENT_REGISTRATION_KEY?.trim() || 'web-local',
  }
}

export type IdentityConfig = ReturnType<typeof readConfig>
