export const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export class ConversationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
  }
}
export const invalid = () =>
  new ConversationError(
    400,
    "INVALID_ARGUMENT",
    "The conversation request is invalid.",
  )
export const notFound = () =>
  new ConversationError(404, "NOT_FOUND", "The requested record was not found.")
export const unauthorized = () =>
  new ConversationError(401, "UNAUTHENTICATED", "Sign in to continue.")
export const dependencyUnavailable = () =>
  new ConversationError(
    503,
    "DEPENDENCY_UNAVAILABLE",
    "A required service is unavailable.",
  )
export type Conversation = {
  id: string
  kind: "direct" | "gather"
  personId: string | null
  worldId?: string
  createdAt: string
  version: number
  canSend: boolean
}
export type PhotoMetadata = {mediaId:string;version:number;mimeType:'image/webp';width:number;height:number;byteSize:number}
export type PhotoInput = {clientMessageId:string;kind:'photo';media:{id:string;version:number}}
export function photoInput(value:unknown):PhotoInput{
  if(!value||typeof value!=='object'||Array.isArray(value))throw invalid()
  const v=value as Record<string,unknown>,m=v.media as Record<string,unknown>|undefined
  if(Object.keys(v).some(k=>!['clientMessageId','kind','media'].includes(k))||v.kind!=='photo'||typeof v.clientMessageId!=='string'||!uuid.test(v.clientMessageId)||!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).some(k=>!['id','version'].includes(k))||typeof m.id!=='string'||!uuid.test(m.id)||!Number.isSafeInteger(m.version)||Number(m.version)<1||Number(m.version)>2147483647)throw invalid()
  return{clientMessageId:v.clientMessageId.toLowerCase(),kind:'photo',media:{id:m.id.toLowerCase(),version:Number(m.version)}}
}
export type Message = {
  id: string
  conversationId: string
  sequence: string
  kind: "text" | "gift" | "photo"
  photo?: PhotoMetadata
  gift?: (import('./gifts.js').GiftDelivery & {deliveryId:string}) | (import('./gifts.js').ReceivedGift & {direction:'received';receivedGiftId:string})
  text: string
  author: { kind: "self" } | {
    kind: "persona"
    personId?: string
    displayName: string
    aiGenerated: true
  }
  createdAt: string
  version: number
  clientMessageId?: string
  replyToMessageId?: string
  generationJobId?: string
  generationKind?: 'gather_reply' | 'photo_reply' | 'story_reply'
  inputMode?: "typed"|"transcribed"
  canSuggestMemory?: boolean
  sourceDomain?: 'virtual_action'|'virtual_context'
}
export type JobState = "queued" | "running" | "succeeded" | "failed" | "blocked" | "canceled"
export type GenerationJob = {
  id: string
  kind: "chat_reply" | "gather_reply" | "photo_reply" | "story_reply"
  participants?: {personId?:string;displayName:string;state:JobState;replyId?:string;failure?:{code:string;retryable:boolean}}[]
  targetId: string
  state: JobState
  version: number
  attemptId?: string
  replyIds: string[]
  failure?: {
    code: string
    retryable: boolean
  }
  updatedAt: string
}
export type Summary = {
  kind: "direct" | "gather"
  conversationId: string | null
  personId: string | null
  worldId: string
  title: string
  lastCall?: {id:string;mode:'voice';endedAt:string;durationSeconds:number}
  lastMessage: {
    id: string
    kind: "text" | "gift" | "photo"
    preview: string
    createdAt: string
    author?: Message["author"]
  } | null
  lastActivityAt: string | null
}
export type HistorySearchHit = {
  kind:'message';id:string;personId:string|null;conversationKind?:'direct'|'gather';worldId?:string;conversationId:string;messageId:string
  sequence:string;version:number;messageKind:'text'|'gift'|'photo';title:string;excerpt:string
  author:Message['author'];createdAt:string;lastActivityAt:string
}
export function historyQuery(value:unknown){
  if(typeof value!=='string'||value.includes('\0')||/\p{Surrogate}/u.test(value))throw invalid()
  const query=value.trim()
  if(!query||[...query].length>160)throw invalid()
  return query.toLowerCase()
}
export type TextInput = {
  clientMessageId: string
  kind: "text"
  text: string
  inputMode: "typed"|"transcribed"
}
export function textInput(body: unknown): TextInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw invalid()
  const input = body as Record<string, unknown>
  if (
    Object.keys(input).some(
      (key) => !["clientMessageId", "kind", "text", "inputMode"].includes(key),
    ) ||
    typeof input.clientMessageId !== "string" ||
    !uuid.test(input.clientMessageId) ||
    input.kind !== "text" ||
    typeof input.text !== "string" ||
    input.text.includes("\0") ||
    /\p{Surrogate}/u.test(input.text) ||
    (input.inputMode !== undefined && !["typed","transcribed"].includes(String(input.inputMode)))
  )
    throw invalid()
  const text = input.text.trim()
  if (!text || [...text].length > 4000) throw invalid()
  return {
    clientMessageId: input.clientMessageId.toLowerCase(),
    kind: "text",
    text,
    inputMode: input.inputMode==='transcribed'?'transcribed':'typed',
  }
}
export function directInput(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw invalid()
  const value = body as Record<string, unknown>
  if(value.kind==='gather'){
    if(Object.keys(value).some(key=>!['kind','worldId'].includes(key))||typeof value.worldId!=='string'||!uuid.test(value.worldId))throw invalid()
    return{kind:'gather' as const,worldId:value.worldId.toLowerCase()}
  }
  if (
    Object.keys(value).some((key) => !["kind", "personId"].includes(key)) ||
    value.kind !== "direct" ||
    typeof value.personId !== "string" ||
    !uuid.test(value.personId)
  )
    throw invalid()
  return { kind: "direct" as const, personId: value.personId.toLowerCase() }
}
