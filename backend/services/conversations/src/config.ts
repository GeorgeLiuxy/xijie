import {validateVoiceRuntime} from './voice-provider.js'
const loopback = new Set(["127.0.0.1", "localhost", "[::1]"])
export function requiredEnv(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error("Missing configuration: " + name)
  return value
}
function origin(value: string, name: string) {
  const url = new URL(value)
  const local =
    process.env.NODE_ENV !== "production" &&
    url.protocol === "http:" &&
    loopback.has(url.hostname)
  if (
    (!local && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid origin: " + name)
  return url.origin
}
export function readConfig() {
  validateVoiceRuntime()
  const dataRightsServiceToken = process.env.XIJIE_DATA_RIGHTS_SERVICE_TOKEN?.trim() || null
  if (dataRightsServiceToken && !/^[a-f0-9]{64}$/i.test(dataRightsServiceToken)) throw new Error('Invalid XIJIE_DATA_RIGHTS_SERVICE_TOKEN')
  const memoriesServiceToken = process.env.XIJIE_MEMORIES_SERVICE_TOKEN?.trim() || null
  if (memoriesServiceToken && !/^[a-f0-9]{64}$/i.test(memoriesServiceToken)) throw new Error('Invalid XIJIE_MEMORIES_SERVICE_TOKEN')
  const memoriesOrigin = process.env.XIJIE_MEMORIES_URL?.trim()
  const giftsServiceToken=process.env.XIJIE_GIFTS_SERVICE_TOKEN?.trim()||null
  if(giftsServiceToken&&!/^[a-f0-9]{64}$/i.test(giftsServiceToken))throw new Error('Invalid XIJIE_GIFTS_SERVICE_TOKEN')
  const giftsOrigin=process.env.XIJIE_GIFTS_URL?.trim()
  const mediaServiceToken=process.env.XIJIE_MEDIA_SERVICE_TOKEN?.trim()||null
  if(mediaServiceToken&&!/^[a-f0-9]{64}$/i.test(mediaServiceToken))throw new Error('Invalid XIJIE_MEDIA_SERVICE_TOKEN')
  const mediaOrigin=process.env.XIJIE_MEDIA_URL?.trim()
  const serviceToken = requiredEnv("XIJIE_CONVERSATIONS_SERVICE_TOKEN")
  if (!/^[a-f0-9]{64}$/i.test(serviceToken))
    throw new Error("Invalid XIJIE_CONVERSATIONS_SERVICE_TOKEN")
  const webOrigin = origin(
    process.env.CONVERSATIONS_WEB_ORIGIN || "http://127.0.0.1:5184",
    "CONVERSATIONS_WEB_ORIGIN",
  )
  const port = Number(process.env.CONVERSATIONS_PORT || 3103)
  const host = process.env.CONVERSATIONS_HOST || "127.0.0.1"
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    (webOrigin.startsWith("http:") && !loopback.has(host))
  )
    throw new Error("Invalid conversations listener")
  return {
    databaseUrl: requiredEnv("DATABASE_URL"),
    host,
    port,
    webOrigin,
    serviceToken,
    dataRightsServiceToken,
    memoriesServiceToken,
    giftsServiceToken,giftsOrigin:giftsOrigin?origin(giftsOrigin,'XIJIE_GIFTS_URL'):undefined,
    mediaServiceToken,mediaOrigin:mediaOrigin?origin(mediaOrigin,'XIJIE_MEDIA_URL'):undefined,
    memoriesOrigin: memoriesOrigin ? origin(memoriesOrigin, 'XIJIE_MEMORIES_URL') : undefined,
    identityOrigin: origin(
      requiredEnv("XIJIE_IDENTITY_URL"),
      "XIJIE_IDENTITY_URL",
    ),
    peopleOrigin: origin(requiredEnv("XIJIE_PEOPLE_URL"), "XIJIE_PEOPLE_URL"),
    sessionCookie: webOrigin.startsWith("https:")
      ? "__Host-xijie_session"
      : "xijie_dev_session",
    queueSchema: process.env.CONVERSATIONS_QUEUE_SCHEMA || "conversation_queue",
  }
}
export type ConversationConfig = ReturnType<typeof readConfig>
