const loopback = new Set(['127.0.0.1', 'localhost', '[::1]'])

export function requiredEnv(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error('Missing configuration: ' + name)
  return value
}

function origin(value: string, name: string) {
  const url = new URL(value)
  const localHttp = process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && loopback.has(url.hostname)
  if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Invalid origin configuration: ' + name)
  }
  return url
}

export function readConfig() {
  const identityUrl = origin(requiredEnv('XIJIE_IDENTITY_URL'), 'XIJIE_IDENTITY_URL')
  const webOrigin = origin(process.env.PEOPLE_WEB_ORIGIN || 'http://127.0.0.1:5184', 'PEOPLE_WEB_ORIGIN')
  const serviceToken = requiredEnv('XIJIE_PEOPLE_SERVICE_TOKEN')
  if (!/^[a-f0-9]{64}$/i.test(serviceToken)) throw new Error('Invalid XIJIE_PEOPLE_SERVICE_TOKEN')
  const conversationsServiceToken = process.env.XIJIE_CONVERSATIONS_SERVICE_TOKEN?.trim() || null
  if (conversationsServiceToken && !/^[a-f0-9]{64}$/i.test(conversationsServiceToken)) throw new Error('Invalid XIJIE_CONVERSATIONS_SERVICE_TOKEN')
  const memoriesServiceToken = process.env.XIJIE_MEMORIES_SERVICE_TOKEN?.trim() || null
  if (memoriesServiceToken && !/^[a-f0-9]{64}$/i.test(memoriesServiceToken)) throw new Error('Invalid XIJIE_MEMORIES_SERVICE_TOKEN')
  const socialServiceToken = process.env.XIJIE_SOCIAL_SERVICE_TOKEN?.trim() || null
  if (socialServiceToken && !/^[a-f0-9]{64}$/i.test(socialServiceToken)) throw new Error('Invalid XIJIE_SOCIAL_SERVICE_TOKEN')
  const dataRightsServiceToken = process.env.XIJIE_DATA_RIGHTS_SERVICE_TOKEN?.trim() || null
  if (dataRightsServiceToken && !/^[a-f0-9]{64}$/i.test(dataRightsServiceToken)) throw new Error('Invalid XIJIE_DATA_RIGHTS_SERVICE_TOKEN')
  const port = Number(process.env.PEOPLE_PORT || 3102)
  const mediaServiceToken=process.env.XIJIE_MEDIA_SERVICE_TOKEN?.trim()||null
  if(mediaServiceToken&&!/^[a-f0-9]{64}$/i.test(mediaServiceToken))throw new Error('Invalid XIJIE_MEDIA_SERVICE_TOKEN')
  const mediaOrigin=process.env.XIJIE_MEDIA_URL?.trim()?origin(process.env.XIJIE_MEDIA_URL.trim(),'XIJIE_MEDIA_URL').origin:null
  const giftsServiceToken=process.env.XIJIE_GIFTS_SERVICE_TOKEN?.trim()||null
  if(giftsServiceToken&&!/^[a-f0-9]{64}$/i.test(giftsServiceToken))throw new Error('Invalid XIJIE_GIFTS_SERVICE_TOKEN')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PEOPLE_PORT')
  return {
    databaseUrl: requiredEnv('DATABASE_URL'),
    host: '127.0.0.1',
    port,
    webOrigin: webOrigin.origin,
    identityContextUrl: new URL('/internal/v1/session-context', identityUrl),
    serviceToken, conversationsServiceToken, memoriesServiceToken, socialServiceToken, dataRightsServiceToken, mediaServiceToken,mediaOrigin,giftsServiceToken,
    sessionCookie: webOrigin.protocol === 'https:' ? '__Host-xijie_session' : 'xijie_dev_session',
  }
}

export type PeopleConfig = ReturnType<typeof readConfig>
