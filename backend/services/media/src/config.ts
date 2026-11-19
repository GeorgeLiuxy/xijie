import {lstatSync} from 'node:fs'
import {isAbsolute} from 'node:path'

const local = new Set(["127.0.0.1", "localhost", "[::1]"])

export function requiredEnv(k: string) {
  const v = process.env[k]?.trim()

  if (!v) throw new Error("Missing configuration: " + k)

  return v
}

function origin(k: string, optional = false) {
  const value = process.env[k]?.trim()

  if (!value && optional) return undefined

  const u = new URL(value ?? requiredEnv(k))

  if (
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.hash ||
    u.search ||
    (u.protocol !== "https:" &&
      !(
        process.env.NODE_ENV !== "production" &&
        u.protocol === "http:" &&
        local.has(u.hostname)
      ))
  )
    throw new Error("Invalid service origin: " + k)

  return u.origin
}

export function readConfig() {
  const ffmpegPath=process.env.MEDIA_FFMPEG_PATH?.trim()||undefined
  if(ffmpegPath){try{const stat=lstatSync(ffmpegPath);if(!isAbsolute(ffmpegPath)||!stat.isFile()||stat.isSymbolicLink())throw Error()}catch{throw new Error('Invalid configuration: MEDIA_FFMPEG_PATH')}}
  const serviceToken = requiredEnv("XIJIE_MEDIA_SERVICE_TOKEN"),
    socialToken = requiredEnv("XIJIE_SOCIAL_SERVICE_TOKEN"),
    peopleToken = process.env.XIJIE_PEOPLE_SERVICE_TOKEN?.trim(),
    giftsToken = process.env.XIJIE_GIFTS_SERVICE_TOKEN?.trim(),
    conversationsToken = process.env.XIJIE_CONVERSATIONS_SERVICE_TOKEN?.trim(),
    proofKey = requiredEnv("MEDIA_READ_PROOF_KEY"),
    rightsToken = process.env.XIJIE_DATA_RIGHTS_SERVICE_TOKEN?.trim(),
    webOrigin = origin("MEDIA_WEB_ORIGIN")!,
    host = process.env.MEDIA_HOST || "127.0.0.1",
    port = Number(process.env.MEDIA_PORT || 3106)

  if (
    [
      serviceToken,

      socialToken,

      ...(peopleToken ? [peopleToken] : []),
      ...(giftsToken ? [giftsToken] : []),
      ...(conversationsToken ? [conversationsToken] : []),

      proofKey,

      ...(rightsToken ? [rightsToken] : []),
    ].some((v) => !/^[a-f0-9]{64}$/i.test(v)) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    (webOrigin.startsWith("http:") && !local.has(host))
  )
    throw new Error("Invalid media listener or credentials")

  const bucket = requiredEnv("MEDIA_S3_BUCKET")

  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket))
    throw new Error("Invalid private bucket")

  return {
    databaseUrl: requiredEnv("DATABASE_URL"),

    host,

    port,

    webOrigin,

    serviceToken,

    socialToken,

    peopleToken,
    giftsToken,
    conversationsToken,

    rightsToken,

    proofKey,
    ffmpegPath,

    identityOrigin: origin("XIJIE_IDENTITY_URL")!,

    socialOrigin: origin("XIJIE_SOCIAL_URL")!,

    peopleOrigin: origin("XIJIE_PEOPLE_URL", true),
    giftsOrigin: origin("XIJIE_GIFTS_URL", true),
    conversationsOrigin:origin('XIJIE_CONVERSATIONS_URL',true),

    s3Endpoint: origin("MEDIA_S3_ENDPOINT")!,

    s3Bucket: bucket,

    s3Region: process.env.MEDIA_S3_REGION || "us-east-1",

    s3AccessKey: requiredEnv("MEDIA_S3_ACCESS_KEY"),

    s3SecretKey: requiredEnv("MEDIA_S3_SECRET_KEY"),

    sessionCookie: webOrigin.startsWith("https:")
      ? "__Host-xijie_session"
      : "xijie_dev_session",
  }
}

export type MediaConfig = ReturnType<typeof readConfig>
