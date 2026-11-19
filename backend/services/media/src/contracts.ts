import { createHash } from "node:crypto"

export const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i

export const MAX_INPUT = 10 * 1024 * 1024,
  MAX_OUTPUT = 1024 * 1024

export class MediaError extends Error {
  constructor(
    readonly status: number,

    readonly code: string,

    message = "The private photo request could not be completed.",
    readonly details?:Record<string,unknown>,
  ) {
    super(message)
  }
}

export const invalid = () => new MediaError(422, "VALIDATION_FAILED"),
  missing = () => new MediaError(404, "NOT_FOUND"),
  unavailable = () => new MediaError(503, "DEPENDENCY_UNAVAILABLE"),
  unauthorized = () => new MediaError(401, "UNAUTHORIZED")

export function identifier(value: unknown) {
  if (typeof value !== "string" || !uuid.test(value)) throw invalid()

  return value
}

export function object(value: unknown, fields: string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !fields.includes(k))
  )
    throw invalid()

  return value as Record<string, unknown>
}

export const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex")

export const positive = (v: unknown): v is number =>
  Number.isSafeInteger(v) && Number(v) > 0

export function createInput(body: unknown) {
  const x = object(body, [
      "mimeType",

      "byteSize",

      "sha256",

      "purpose",

      "target",
    ]),
    target = object(x.target, x.purpose==='conversation_attachment'?["kind","id","conversationId"]:["kind", "id"])

  if (
    !["image/jpeg", "image/png", "image/webp"].includes(String(x.mimeType)) ||
    !positive(x.byteSize) ||
    x.byteSize > MAX_INPUT ||
    typeof x.sha256 !== "string" ||
    !/^([a-f0-9]{64})$/.test(x.sha256) ||
    !(
      (x.purpose === "post_attachment" && target.kind === "post_intent") ||
      (x.purpose === "person_photo" && target.kind === "person_draft") ||
      (x.purpose === "gift_delivery_photo" && target.kind === "gift_delivery") ||
      (x.purpose === 'conversation_attachment' && target.kind==='conversation_message')
    )
  )
    throw invalid()

  return {
    mimeType: x.mimeType as string,

    byteSize: x.byteSize,

    sha256: x.sha256,

    ...(x.purpose === "person_photo"
      ? { purpose: "person_photo" as const, draftId: identifier(target.id) }
      : x.purpose === "gift_delivery_photo" ? {purpose:"gift_delivery_photo" as const,deliveryId:identifier(target.id)} : x.purpose==='conversation_attachment'?{purpose:'conversation_attachment' as const,conversationId:identifier(target.conversationId),clientMessageId:identifier(target.id)}:{ clientPostId: identifier(target.id) }),
  }
}

export type Permission = {
  allowed: boolean

  authorizationVersion: number

  privateFeedAllowed?: boolean
}

export type Account = {
  accountId: string

  status: "active"

  accessVersion: number

  storyStorage: Permission

  photoStorage?: Permission

  personPhotoStorage?: Permission
  personVoiceStorage?: Permission
  giftStorage?: Permission
  giftPhotoStorage?: Permission
  chatPhotoStorage?: Permission
  chatImageReplies?: Permission
}

export type Session = {
  accountId: string

  sessionId: string

  expiresAt: string

  storyStorage: Permission

  photoStorage?: Permission

  personPhotoStorage?: Permission
  personVoiceStorage?: Permission
  giftStorage?: Permission
  giftPhotoStorage?: Permission
  chatPhotoStorage?: Permission
  chatImageReplies?: Permission
}

export type DataRequest = {
  accountId: string

  requestId: string

  kind: "export" | "delete_account"

  scope: "interaction_data" | "account_data"

  accountStatus: string

  accountAccessVersion: number
}

export type PersonRef = {
  draftId: string
  mediaId: string
  version: number
}
export type GiftRef={deliveryId:string;photoVersion:number;mediaId:string;version:number}
export type GiftTarget={deliveryId:string;accountId:string;status:'arrived';photoVersion:number}
export type ConversationRef={conversationId:string;clientMessageId:string;messageVersion:number;mediaId:string;version:number}
export type ConversationTarget={conversationId:string;accountId:string;personId:string}
export type PhotoReplySource=ConversationRef&{messageId:string;accountAccessVersion:number;storyAuthorizationVersion:number;photoAuthorizationVersion:number;imageAuthorizationVersion:number}

export type Ref = {
  postId: string

  mediaId: string

  version: number
}

export type Metadata = {
  id: string

  version: number

  mimeType: "image/webp"

  byteSize: number

  width: number

  height: number
}

export type MediaRow = {
  id: string

  account_id: string

  client_post_id: string | null

  person_draft_id: string | null
  gift_delivery_id: string | null
  chat_conversation_id:string|null
  chat_client_message_id:string|null

  purpose: string

  status: string

  declared_mime: string

  declared_bytes: number

  input_sha256: string

  mime_type: string | null

  byte_size: number | null

  sha256: string | null

  width: number | null

  height: number | null

  object_key: string | null

  version: number

  authorization_version: number

  account_access_version: number

  storage_authorization_version: number | null
  gift_storage_authorization_version: number | null

  photo_authorization_version: number

  failure_code: string | null

  created_at: Date

  updated_at: Date

  verified_at: Date | null

  revoked_at: Date | null

  deleted_at: Date | null
}

export type SlotRow = {
  id: string

  account_id: string

  media_id: string

  staging_key: string

  state: string

  upload_key: string | null

  attempt_id: string | null

  lease_until: Date | null

  expires_at: Date

  created_at: Date

  ended_at: Date | null

  uploaded_at: Date | null
}

export function dto(r: MediaRow) {
  return {
    id: r.id,

    purpose: r.purpose,

    status: r.status,

    mimeType: r.mime_type ?? r.declared_mime,

    byteSize: r.byte_size ?? r.declared_bytes,

    version: r.version,

    authorizationVersion: r.authorization_version,

    createdAt: r.created_at.toISOString(),

    updatedAt: r.updated_at.toISOString(),

    ...(r.width ? { width: r.width, height: r.height } : {}),

    ...(r.failure_code ? { failureCode: r.failure_code } : {}),
  }
}

export function metadata(r: MediaRow): Metadata {
  if (
    r.status !== "ready" ||
    r.mime_type !== "image/webp" ||
    !r.byte_size ||
    !r.width ||
    !r.height
  )
    throw missing()

  return {
    id: r.id,

    version: r.version,

    mimeType: "image/webp",

    byteSize: r.byte_size,

    width: r.width,

    height: r.height,
  }
}
