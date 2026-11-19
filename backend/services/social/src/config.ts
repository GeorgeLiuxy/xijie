import {albumConfig} from './albums-config.js'
const loopback = new Set(["127.0.0.1", "localhost", "[::1]"])
export function requiredEnv(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error("Missing configuration: " + name)
  return value
}
function origin(value: string) {
  const url = new URL(value)
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        process.env.NODE_ENV !== "production" &&
        url.protocol === "http:" &&
        loopback.has(url.hostname)
      ))
  )
    throw new Error("Invalid service origin")
  return url.origin
}
export function readConfig() {
  if(!['false','true'].includes(process.env.SOCIAL_AI_ENABLED||'false'))throw new Error('Invalid SOCIAL_AI_ENABLED')
  if(!/^[a-z_][a-z0-9_]{0,62}$/.test(process.env.SOCIAL_QUEUE_SCHEMA||'social_queue'))throw new Error('Invalid SOCIAL_QUEUE_SCHEMA')
  const serviceToken = requiredEnv("XIJIE_SOCIAL_SERVICE_TOKEN"),
    dataRightsToken =
      process.env.XIJIE_DATA_RIGHTS_SERVICE_TOKEN?.trim() || null
  const mediaToken=process.env.XIJIE_MEDIA_SERVICE_TOKEN?.trim()||null
  const mediaOrigin=process.env.XIJIE_MEDIA_URL?.trim()?origin(process.env.XIJIE_MEDIA_URL):undefined
  if(Boolean(mediaToken)!==Boolean(mediaOrigin)||mediaToken&&(!/^[a-f0-9]{64}$/i.test(mediaToken)||mediaToken.toLowerCase()===serviceToken.toLowerCase()||mediaToken.toLowerCase()===dataRightsToken?.toLowerCase()))throw new Error('Invalid Media integration configuration')
  if (
    !/^[a-f0-9]{64}$/i.test(serviceToken) ||
    (dataRightsToken && !/^[a-f0-9]{64}$/i.test(dataRightsToken))
  )
    throw new Error("Invalid service credential")
  const port = Number(process.env.SOCIAL_PORT || 3105),
    host = process.env.SOCIAL_HOST || "127.0.0.1",
    webOrigin = origin(process.env.SOCIAL_WEB_ORIGIN || "http://127.0.0.1:5184")
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    (webOrigin.startsWith("http:") && !loopback.has(host))
  )
    throw new Error("Invalid social listener")
  const albums=albumConfig(webOrigin)
  if(albums.memoriesToken&&[serviceToken,dataRightsToken,mediaToken].some(token=>token?.toLowerCase()===albums.memoriesToken!.toLowerCase()))throw new Error('Album source credential must be independent')
  return {
    albums,
    databaseUrl: requiredEnv("DATABASE_URL"),
    host,
    port,
    webOrigin,
    serviceToken,
    dataRightsToken,
    mediaToken,mediaOrigin,
    identityOrigin: origin(requiredEnv("XIJIE_IDENTITY_URL")),
    peopleOrigin: origin(requiredEnv("XIJIE_PEOPLE_URL")),
    memoriesOrigin:process.env.XIJIE_MEMORIES_URL?origin(process.env.XIJIE_MEMORIES_URL):undefined,
    echoEnabled:process.env.SOCIAL_AI_ENABLED==='true',
    queueSchema:process.env.SOCIAL_QUEUE_SCHEMA||'social_queue',
    sessionCookie: webOrigin.startsWith("https:")
      ? "__Host-xijie_session"
      : "xijie_dev_session",
  }
}
export type SocialConfig = ReturnType<typeof readConfig>
