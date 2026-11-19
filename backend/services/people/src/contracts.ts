export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class PeopleError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) { super(message) }
}

export const invalid = () => new PeopleError(400, 'INVALID_ARGUMENT', 'The draft request is invalid.')
export const unauthenticated = () => new PeopleError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
export const notFound = () => new PeopleError(404, 'NOT_FOUND', 'The requested record was not found.')

const limits = { displayName: 80, relationship: 40, story: 20_000 } as const
const draftLimits = { ...limits, realName: 80, calledMe: 80, birthMonthDay: 5, yearsText: 120, place: 200,conversationTone:6,voiceTimbre:6 } as const
type Field = keyof typeof draftLimits

export type PhotoMetadata = { id:string; version:number; mimeType:'image/webp'; byteSize:number; width:number; height:number }
export type PhotoBinding = {media:PhotoMetadata[];expiresAt?:string}
export type PhotoRef = {draftId:string;mediaId:string;version:number}
export type ReadyVoice={id:string;version:number;durationMs:number;mimeType:'audio/wav';byteSize:number;sha256:string}
export type VoiceBinding={voice:ReadyVoice;expiresAt:string;bindingVersion:number}
export type VoiceRef={draftId:string;voiceId:string;version:number;bindingVersion?:number}
export type DraftFields = Partial<Record<Field, string | null>> & {mediaIds?:string[];voiceId?:string|null}
export type DraftStatus = 'draft' | 'expired' | 'confirmed'

export type PersonDraft = {
  id: string
  status: DraftStatus
  version: number
  displayName?: string
  relationship?: string
  story?: string
  realName?: string
  calledMe?: string
  birthMonthDay?: string
  yearsText?: string
  place?: string
  mediaIds: string[]
  media: PhotoMetadata[]
  photoTarget: {kind:'person_draft';id:string}
  voiceId:string|null
  readyVoice:ReadyVoice|null
  hasVoice:boolean
  voiceTarget:{kind:'person_draft';id:string}
  conversationTone:string|null
  voiceTimbre:string|null
  confirmedPersonId?: string
  updatedAt: string
  expiresAt: string
}

export type DraftPosition = { updatedAt: string; id: string }

export function draftFields(body: unknown, update: boolean): DraftFields {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid()
  const input = body as Record<string, unknown>
  const keys = Object.keys(input)
  if (keys.some(key => !Object.hasOwn(draftLimits, key) && !(update && ['mediaIds','voiceId'].includes(key))) || (update && keys.length === 0)) throw invalid()

  const fields: DraftFields = {}
  if (Object.hasOwn(input,'mediaIds')) fields.mediaIds=photoIds(input.mediaIds)
  if(Object.hasOwn(input,'voiceId'))fields.voiceId=voiceIdentifier(input.voiceId)
  for (const field of Object.keys(draftLimits) as Field[]) {
    if (!Object.hasOwn(input, field)) continue
    const raw = input[field]
    if (raw === null && (update || !Object.hasOwn(limits, field))) {
      fields[field] = null
      continue
    }
    if (typeof raw !== 'string' || raw.includes('\0') || /\p{Surrogate}/u.test(raw)) throw invalid()
    const value = raw.trim()
    if ((!value && field !== 'story') || [...value].length > draftLimits[field]) throw invalid()
    if (field === 'birthMonthDay') validBirthday(value)
    validPreference(field,value)
    fields[field] = value || null
  }
  return fields
}

export type PersonPreview = {
  id: string
  draftId: string
  draftVersion: number
  status: 'succeeded' | 'stale'
  renderMode: 'user_input'
  summary?: string
  suggestedWorldId?: string
  suggestedPersonality?: string[]
  suggestedCatchphrase?: string
  unknownFields: string[]
  sourceRefs: { kind: 'draft_story'; id: string; version: number }[]
  expiresAt: string
}

export type PreviewResult = Pick<PersonPreview, 'id' | 'draftId' | 'draftVersion' | 'status' | 'renderMode'>

export type Person = {
  id: string
  displayName: string
  relationship: string
  story: string
  personality: string[]
  life: string[]
  unknowns: string[]
  catchphrase: string | null
  realName?: string
  calledMe?: string
  birthMonthDay?: string
  yearsText?: string
  place?: string
  worldId: string
  worldVersion: number
  mediaLinks: {id:string;personId:string;mediaId:string;purpose:'profile_photo'|'person_source';createdAt:string}[]
  mediaIds: string[]
  media: PhotoMetadata[]
  photoTarget: {kind:'person_draft';id:string}
  voiceId:string|null
  readyVoice:ReadyVoice|null
  hasVoice:boolean
  voiceTarget:{kind:'person_draft';id:string}
  conversationTone:string|null
  voiceTimbre:string|null
  avatarMediaLinkId?: string
  status: 'active'
  version: number
  createdAt: string
  updatedAt: string
}

const personLimits = {...draftLimits,catchphrase:500}
type PersonField = keyof typeof personLimits
export type PersonFields = Partial<Record<PersonField, string | null>> & {mediaIds?:string[];voiceId?:string|null;personality?:string[];life?:string[];unknowns?:string[]}
const profileLists={personality:[30,200],life:[100,1000],unknowns:[30,500]} as const

export function personFields(body: unknown): PersonFields {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid()
  const input = body as Record<string, unknown>
  const keys = Object.keys(input)
  if (!keys.length || keys.some(key => !Object.hasOwn(personLimits, key) && !Object.hasOwn(profileLists,key) && !['mediaIds','voiceId'].includes(key))) throw invalid()
  const result: PersonFields = {}
  if(Object.hasOwn(input,'mediaIds'))result.mediaIds=photoIds(input.mediaIds)
  if(Object.hasOwn(input,'voiceId'))result.voiceId=voiceIdentifier(input.voiceId)
  for(const key of Object.keys(profileLists) as (keyof typeof profileLists)[]){
    if(!Object.hasOwn(input,key))continue
    const raw=input[key],[max,length]=profileLists[key]
    if(!Array.isArray(raw)||raw.length>max||raw.some(value=>typeof value!=='string'||value.includes('\0')||/\p{Surrogate}/u.test(value)||!value.trim()||[...value.trim()].length>length))throw invalid()
    result[key]=raw.map(value=>value.trim())
  }
  for (const key of Object.keys(personLimits) as PersonField[]) {
    if (!Object.hasOwn(input, key)) continue
    const raw = input[key]
    if (raw === null && !Object.hasOwn(limits, key)) { result[key] = null; continue }
    if (typeof raw !== 'string' || raw.includes('\0') || /\p{Surrogate}/u.test(raw)) throw invalid()
    const value = raw.trim()
    if (!value || [...value].length > personLimits[key]) throw invalid()
    if (key === 'birthMonthDay') validBirthday(value)
    validPreference(key,value)
    result[key] = value
  }
  return result
}

function voiceIdentifier(value:unknown){if(value===null)return null;if(typeof value!=='string'||!uuid.test(value))throw invalid();return value.toLowerCase()}
function validPreference(field:string,value:string){if(field==='conversationTone'&&!['gentle','witty','quiet','stern'].includes(value)||field==='voiceTimbre'&&!['warm','bright','deep'].includes(value))throw invalid()}

export function photoIds(value:unknown):string[]{
  if(!Array.isArray(value)||value.length>6||value.some(v=>typeof v!=='string'||!uuid.test(v)))throw invalid()
  const ids=value.map(v=>v.toLowerCase())
  if(new Set(ids).size!==ids.length)throw invalid()
  return ids
}

function validBirthday(value: string) {
  const matched = /^(\d{2})-(\d{2})$/.exec(value)
  const month = Number(matched?.[1]), day = Number(matched?.[2])
  const max = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  if (!matched || !max || day < 1 || day > max) throw invalid()
}

export type World = {
  id: string
  code: string
  displayName: string
  enabled: boolean
  catalogVersion: number
}

export type WorldMovement = {id:string;worldVersion:number;personVersion:number;fromWorld:World;toWorld:World;occurredAt:string;recordedAt:string}
export type WorldContext = {accountId:string;personId:string;personVersion:number;worldVersion:number;reality:'virtual';branch:'main';currentWorld:World;recentMovements:WorldMovement[];revision:string}
export type WorldStageRequest = {expectedPersonVersion:number;expectedWorldVersion:number;stages:{worldId:string;worldVersion:number}[]}
export type ResolvedWorldStages = {accountId:string;personId:string;personVersion:number;currentWorldVersion:number;stages:{worldVersion:number;world:World;basis:'current_catalog'|'arrival_snapshot'|'departure_snapshot'}[]}
export function worldStagesInput(body:unknown):WorldStageRequest {
  if(!body||typeof body!=='object'||Array.isArray(body))throw invalid()
  const value=body as Record<string,unknown>,positive=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>0&&Number(v)<=2147483647
  if(Object.keys(value).length!==3||Object.keys(value).some(key=>!['expectedPersonVersion','expectedWorldVersion','stages'].includes(key))
    ||!positive(value.expectedPersonVersion)||!positive(value.expectedWorldVersion)||!Array.isArray(value.stages)||value.stages.length<1||value.stages.length>32)throw invalid()
  const stages=value.stages.map((stage:unknown)=>{
    if(!stage||typeof stage!=='object'||Array.isArray(stage))throw invalid()
    const entry=stage as Record<string,unknown>
    if(Object.keys(entry).length!==2||Object.keys(entry).some(key=>!['worldId','worldVersion'].includes(key))
      ||typeof entry.worldId!=='string'||!uuid.test(entry.worldId)||!positive(entry.worldVersion))throw invalid()
    return {worldId:entry.worldId.toLowerCase(),worldVersion:entry.worldVersion}
  })
  if(new Set(stages.map(stage=>stage.worldVersion)).size!==stages.length)throw invalid()
  return {expectedPersonVersion:value.expectedPersonVersion,expectedWorldVersion:value.expectedWorldVersion,stages}
}
export type GatherResident = {id:string;displayName:string;version:number;accessVersion:number;worldVersion:number;createdAt:string}
export type GatherContext = {accountId:string;world:World;residents:GatherResident[];revision:string}
export type SocialPerson = {id:string;displayName:string;worldId:string;version:number;accessVersion:number;worldVersion:number}
export type SocialAiPerson = SocialPerson & {accountId:string;relationship:string;story:string;calledMe?:string;personality:string[];life:string[];unknowns:string[];catchphrase:string|null;conversationTone:string|null;voiceTimbre:string|null}
export type SocialMovementPage = {accountId:string;person:SocialPerson;items:WorldMovement[];nextAfterVersion:number;hasMore:boolean}
export function worldInput(body:unknown){
 if(!body||typeof body!=='object'||Array.isArray(body))throw invalid()
 const value=body as Record<string,unknown>
 if(Object.keys(value).length!==1||typeof value.worldId!=='string'||!uuid.test(value.worldId))throw invalid()
 return {worldId:value.worldId.toLowerCase()}
}

export function previewInput(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid()
  const input = body as Record<string, unknown>
  if (Object.keys(input).some(key => !['worldPreferenceId', 'previousPreviewId', 'renderMode'].includes(key))
    || (input.renderMode !== undefined && input.renderMode !== 'user_input')) throw invalid()
  function optionalId(value: unknown) {
    if (value === undefined) return null
    if (typeof value !== 'string' || !uuid.test(value)) throw invalid()
    return value.toLowerCase()
  }
  return { worldPreferenceId: optionalId(input.worldPreferenceId), previousPreviewId: optionalId(input.previousPreviewId) }
}

export function confirmInput(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid()
  const input = body as Record<string, unknown>
  if (Object.keys(input).some(key => !['previewId', 'worldId', 'relationship', 'calledMe'].includes(key))
    || typeof input.previewId !== 'string' || !uuid.test(input.previewId)
    || typeof input.worldId !== 'string' || !uuid.test(input.worldId)) throw invalid()
  const relation = input.relationship === undefined ? {} : personFields({ relationship: input.relationship })
  const called = input.calledMe === undefined ? {} : personFields({ calledMe: input.calledMe })
  return { previewId: input.previewId.toLowerCase(), worldId: input.worldId.toLowerCase(), ...relation, ...called } as {
    previewId: string; worldId: string; relationship?: string; calledMe?: string | null
  }
}
