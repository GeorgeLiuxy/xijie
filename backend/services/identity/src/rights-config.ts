import type { IdentityConfig } from "./config.js"
export type RightsConfig = {
  enabled: boolean
  serviceToken: string
  peopleUrl: URL
  conversationsUrl: URL
  memoriesUrl: URL
  socialUrl?: URL | null
  mediaUrl?: URL | null
  giftsUrl?: URL | null
  encryptionKey: Buffer
  queueSchema: string
  deleteProviderUsers: boolean
  managementClientId: string
  managementClientSecret: string
  managementResource: string
  issuer: URL
}
export type RightsDomain = 'people' | 'conversations' | 'memories' | 'social' | 'media' | 'gifts'
export function rightsDomains(config: Pick<RightsConfig, 'socialUrl' | 'mediaUrl' | 'giftsUrl'>): RightsDomain[] {
  return ['people', 'conversations', 'memories', ...(config.socialUrl ? ['social' as const] : []), ...(config.mediaUrl ? ['media' as const] : []), ...(config.giftsUrl ? ['gifts' as const] : [])]
}
const url = (name: string) => {
  const value = new URL(process.env[name] ?? "https://disabled.invalid")
  if (
    value.username ||
    value.password ||
    value.search ||
    value.hash ||
    value.pathname !== "/" ||
    (value.protocol !== "https:" &&
      !(
        process.env.NODE_ENV !== "production" &&
        value.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(value.hostname)
      ))
  )
    throw new Error("Invalid " + name)
  return value
}
export function readRightsConfig(identity: IdentityConfig): RightsConfig {
  const enabled = process.env.DATA_RIGHTS_ENABLED === "true",
    serviceToken = process.env.XIJIE_DATA_RIGHTS_SERVICE_TOKEN ?? "",
    key = process.env.DATA_EXPORT_ENCRYPTION_KEY ?? "",
    queueSchema =
      process.env.DATA_RIGHTS_QUEUE_SCHEMA ?? "identity_rights_queue"
  if (
    enabled &&
    (!/^[a-f0-9]{64}$/i.test(serviceToken) || !/^[a-f0-9]{64}$/i.test(key))
  )
    throw new Error("Data rights needs independent service and encryption keys")
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(queueSchema))
    throw new Error("Invalid rights queue schema")
  return {
    enabled,
    serviceToken,
    encryptionKey: Buffer.from(key, "hex"),
    queueSchema,
    peopleUrl: url("XIJIE_PEOPLE_URL"),
    conversationsUrl: url("XIJIE_CONVERSATIONS_URL"),
    memoriesUrl: url("XIJIE_MEMORIES_URL"),
    socialUrl: process.env.XIJIE_SOCIAL_URL?.trim() ? url('XIJIE_SOCIAL_URL') : null,
    giftsUrl: process.env.XIJIE_GIFTS_URL?.trim() ? url('XIJIE_GIFTS_URL') : null,
    mediaUrl: process.env.XIJIE_MEDIA_URL?.trim() ? url('XIJIE_MEDIA_URL') : null,
    deleteProviderUsers: process.env.LOGTO_MANAGEMENT_DELETE_USERS === "true",
    managementClientId: process.env.LOGTO_MANAGEMENT_CLIENT_ID ?? "",
    managementClientSecret: process.env.LOGTO_MANAGEMENT_CLIENT_SECRET ?? "",
    managementResource:
      process.env.LOGTO_MANAGEMENT_RESOURCE ?? "https://default.logto.app/api",
    issuer: identity.issuer,
  }
}
