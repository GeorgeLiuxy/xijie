import { createHash } from "node:crypto"
export class SocialError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}
export const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
export const invalid = () =>
  new SocialError(422, "VALIDATION_FAILED", "The request is not valid.")
export const unavailable = () =>
  new SocialError(
    503,
    "DEPENDENCY_UNAVAILABLE",
    "A required service is unavailable.",
  )
export const notFound = () =>
  new SocialError(404, "NOT_FOUND", "The requested record was not found.")
export const unauthorized = () =>
  new SocialError(401, "UNAUTHENTICATED", "Sign in to continue.")
export const forbidden = () =>
  new SocialError(
    403,
    "STORAGE_PERMISSION_REQUIRED",
    "Permission for private text feed is required.",
  )
export const conflict = () =>
  new SocialError(
    409,
    "IDEMPOTENCY_CONFLICT",
    "The operation identity has different parameters.",
  )
export const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")
export const identifier = (v: unknown) => {
  if (typeof v !== "string" || !uuid.test(v)) throw invalid()
  return v.toLowerCase()
}
export const positive = (v: unknown): v is number =>
  Number.isSafeInteger(v) && Number(v) > 0 && Number(v) <= 2147483647
export const instant = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v))
export function object(v: unknown, keys: string[]) {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    throw invalid()
  return v as Record<string, unknown>
}
export function text(v: unknown, max: number) {
  if (typeof v !== "string") throw invalid()
  const s = v.trim()
  if (!s || [...s].length > max || s.includes("\0") || /\p{Surrogate}/u.test(s))
    throw invalid()
  return s
}
export function createInput(v: unknown) {
  const x = object(v, ["clientPostId", "body", "mediaIds"])
  if (x.mediaIds !== undefined && (!Array.isArray(x.mediaIds) || x.mediaIds.length > 9)) throw invalid()
  const mediaIds = ((x.mediaIds ?? []) as unknown[]).map(identifier)
  if (new Set(mediaIds).size !== mediaIds.length || typeof x.body !== 'string') throw invalid()
  const body=x.body.trim()
  if ([...body].length>500 || body.includes('\0') || /\p{Surrogate}/u.test(body) || !body && !mediaIds.length) throw invalid()
  // Preserve the pre-photo request hash for old text intents, including clients that send [].
  return { clientPostId: identifier(x.clientPostId), body, ...(mediaIds.length?{mediaIds}:{}) }
}
export function commentInput(v: unknown) {
  const x = object(v, ["clientCommentId", "body", "replyToCommentId"])
  return {
    clientCommentId: identifier(x.clientCommentId),
    body: text(x.body, 1000),
    ...(x.replyToCommentId !== undefined
      ? { replyToCommentId: identifier(x.replyToCommentId) }
      : {}),
  }
}
export type PostInput = ReturnType<typeof createInput>
export type CommentInput = ReturnType<typeof commentInput>
export type WorldCard = {
  id: string
  code: string
  displayName: string
  catalogVersion: number
  enabled: boolean
}
export type PersonMeta = {
  id: string
  displayName: string
  worldId: string
  version: number
  accessVersion: number
  worldVersion: number
}
export type Movement = {
  id: string
  worldVersion: number
  personVersion: number
  fromWorld: WorldCard
  toWorld: WorldCard
  occurredAt: string
  recordedAt: string
}
export type MovementPage = {
  accountId: string
  person: PersonMeta
  items: Movement[]
  nextAfterVersion: number
  hasMore: boolean
}
export type PersonaAuthor={kind:'persona';personId:string;displayName:string;aiGenerated:true}
export type PostMedia={id:string;version:number;mimeType:'image/webp';byteSize:number;width:number;height:number}
export type PostMediaRef={postId:string;mediaId:string;version:number}
export type Author = { kind: "self" } | { kind: "system", worldId: string } | PersonaAuthor
export type Comment = {
  id: string
  postId: string
  author: { kind: "self" } | PersonaAuthor
  body: string
  replyToCommentId?: string
  createdAt: string
  version: number
  generationJobId?:string
}
export type Post = {
  id: string
  kind: "user" | "world_notice" | 'memory_echo'
  author: Author
  body: string
  mediaIds: string[]
  media: PostMedia[]
  worldId?: string
  personId?: string
  sourceMovementId?: string
  sourceMemoryId?:string
  sourceMemoryVersion?:number
  sourceMemory?:{personId:string;memoryId:string;version:number;excerpt:string}
  worldSnapshot?:WorldCard
  worldMovement?: Movement & {
    personId: string
    personName: string
    reality: "virtual"
    branch: "main"
  }
  reactionCount: number
  commentCount: number
  reactedByMe: boolean
  reactionPreview: Author[]
  commentPreview: Comment[]
  createdAt: string
  version: number
}
export type PagePosition = { at: string, id: string }
export type FeedFilter = {
  author?: "self" | "person" | "world"
  personId?: string
  worldId?: string
  kind?: "user" | "world_notice" | 'memory_echo'
}
export type ExportScope = "interaction_data" | "account_data"
export type DataRequest = {
  requestId: string
  accountId: string
  kind: "export" | "delete_account"
  scope: ExportScope
  status: string
  accountStatus: string
  accountAccessVersion: number
}
