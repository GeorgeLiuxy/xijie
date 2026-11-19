import { useEffect, useRef } from 'react'
import { WORLD_IDS, type WorldId } from './i18n'
import type { Person } from './model'
import type { ServicePerson } from './auth/PeopleDraftExperience'
import type { PersonManagement } from './person'
import type { MediaClient, PreparedPhoto } from './serviceMedia'
import type { PhotoChoice } from './servicePersonPhotos'

export class PeopleReadError extends Error {
  constructor(readonly status: number) { super('Unable to read confirmed people') }
}

export type WorldCard = { id: string; code: WorldId; enabled: boolean }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function validWorld(value: WorldCard | undefined): value is WorldCard {
  return !!value && uuid.test(value.id) && WORLD_IDS.includes(value.code) && typeof value.enabled === 'boolean'
}
async function readWorld(id: string, sessionId: string, signal: AbortSignal): Promise<WorldCard> {
  const response = await fetch('/v1/worlds/' + encodeURIComponent(id), {
    signal, cache: 'no-store', credentials: 'same-origin', headers: { 'X-Xijie-Expected-Session': sessionId },
  })
  if (!response.ok) throw new PeopleReadError(response.status)
  const result = await response.json() as { data: WorldCard }
  if (!validWorld(result.data) || result.data.id !== id) throw new PeopleReadError(502)
  return result.data
}

async function readList<T>(route: string, sessionId: string, signal: AbortSignal) {
  const all: T[] = []
  const cursors = new Set<string>()
  let cursor: string | null = null
  do {
    const query = new URLSearchParams({ limit: '100' })
    if (cursor) query.set('cursor', cursor)
    const response = await fetch(route + '?' + query, {
      signal, cache: 'no-store', credentials: 'same-origin',
      headers: { 'X-Xijie-Expected-Session': sessionId },
    })
    if (!response.ok) throw new PeopleReadError(response.status)
    const page = await response.json() as { data: T[]; meta?: { nextCursor: string | null } }
    if (!Array.isArray(page.data)) throw new Error('Invalid people service list')
    all.push(...page.data)
    cursor = page.meta?.nextCursor ?? null
    if (cursor && cursors.has(cursor)) throw new Error('Repeated people service cursor')
    if (cursor) cursors.add(cursor)
  } while (cursor)
  return all
}

/** Resolve historical worlds independently of their current residents. */
export async function readConversationWorlds(sessionId: string, signal: AbortSignal, historicalIds: string[] = []): Promise<WorldCard[]> {
  const worlds = await readList<WorldCard>('/v1/worlds', sessionId, signal)
  if (worlds.some(world => !validWorld(world)) || new Set(worlds.map(world => world.id)).size !== worlds.length) throw new PeopleReadError(502)
  const known = new Set(worlds.map(world => world.id))
  const missing = [...new Set(historicalIds)].filter(id => !known.has(id))
  if (missing.some(id => !uuid.test(id))) throw new PeopleReadError(502)
  return [...worlds, ...await Promise.all(missing.map(id => readWorld(id, sessionId, signal)))]
}

export async function readConfirmedPeople(sessionId: string, signal: AbortSignal) {
  const [people, worlds] = await Promise.all([
    readList<ServicePerson>('/v1/persons', sessionId, signal),
    readList<WorldCard>('/v1/worlds', sessionId, signal),
  ])
  const worldById = new Map(worlds.filter(validWorld).map(world => [world.id, Promise.resolve(world.code)]))
  return Promise.all(people.map(async person => {
    // A retired destination can still be the current home of an existing person.
    let world = worldById.get(person.worldId)
    if (!world) { world = readWorld(person.worldId, sessionId, signal).then(value => value.code); worldById.set(person.worldId, world) }
    return { person, world: await world }
  }))
}

export function displayConfirmedPerson(person: ServicePerson, world: WorldId, id: number): Person {
  validateStructuredProfile(person)
  return {
    id, serverId: person.id, serverVersion: person.version, name: person.displayName, relation: person.relationship, world,
    realName: person.realName, calledMe: person.calledMe, birthday: person.birthMonthDay, years: person.yearsText, place: person.place,
    life: person.life??[],sourceStory:person.story,
    voiceId:person.readyVoice?.id??null,readyVoice:person.readyVoice??null,voiceTarget:person.voiceTarget,conversationTone:person.conversationTone??null,voiceTimbre:person.voiceTimbre??null,
    foundAt: Date.parse(person.createdAt),
    photoTarget: person.photoTarget, photoMedia: person.media ?? [],
    age: 'adult', avatar: '', accent: 'sun', hasVoice: !!person.readyVoice, greeting: '',
    personality: person.personality??[], catchphrase: person.catchphrase??'', memories: [], unknowns: person.unknowns??[], stories: [], lastLine: '', weather: '',
  }
}

export class PersonWriteError extends Error {
  constructor(readonly status: number, readonly code: string) { super('The person request failed.') }
}

const editable = {
  name: 'displayName', relation: 'relationship', realName: 'realName', calledMe: 'calledMe',
  birthday: 'birthMonthDay', years: 'yearsText', place: 'place',catchphrase:'catchphrase',personality:'personality',life:'life',unknowns:'unknowns',voiceId:'voiceId',conversationTone:'conversationTone',voiceTimbre:'voiceTimbre',
} as const
const listLimits={personality:[30,200],life:[100,1000],unknowns:[30,500]} as const
function validateStructuredProfile(person:ServicePerson){
  const voice=person.readyVoice;if(voice!=null&&(!uuid.test(voice.id)||person.voiceId!==undefined&&person.voiceId!==voice.id||!Number.isSafeInteger(voice.version)||voice.version<1||!Number.isSafeInteger(voice.durationMs)||voice.durationMs<1||voice.durationMs>30000||voice.mimeType!=='audio/wav'||!Number.isSafeInteger(voice.byteSize)||voice.byteSize<46||(voice.byteSize-44)%2!==0||voice.byteSize>1440044||!/^[a-f0-9]{64}$/.test(voice.sha256)))throw new PersonWriteError(502,'INVALID_RESPONSE')
  if(person.voiceId&&!voice||person.voiceTarget&&(!uuid.test(person.voiceTarget.id)||person.voiceTarget.kind!=='person_draft'))throw new PersonWriteError(502,'INVALID_RESPONSE')
  if(person.conversationTone!=null&&!['gentle','witty','quiet','stern'].includes(person.conversationTone)||person.voiceTimbre!=null&&!['warm','bright','deep'].includes(person.voiceTimbre))throw new PersonWriteError(502,'INVALID_RESPONSE')
  for(const key of Object.keys(listLimits) as (keyof typeof listLimits)[]){const values=person[key],[max,length]=listLimits[key];if(values!==undefined&&(!Array.isArray(values)||values.length>max||values.some(v=>typeof v!=='string'||!v.trim()||[...v].length>length)))throw new PersonWriteError(502,'INVALID_RESPONSE')}
  if(person.catchphrase!==undefined&&person.catchphrase!==null&&(typeof person.catchphrase!=='string'||!person.catchphrase.trim()||[...person.catchphrase].length>500))throw new PersonWriteError(502,'INVALID_RESPONSE')
}

export function personProfileInput(patch: Partial<Person>): Record<string, string | null | string[]> {
  if (!Object.keys(patch).length || Object.keys(patch).some(key => !Object.prototype.hasOwnProperty.call(editable, key))) {
    throw new PersonWriteError(400, 'INVALID_ARGUMENT')
  }
  return Object.fromEntries(Object.entries(patch).map(([key, value]) => {
    if(['voiceId','conversationTone','voiceTimbre'].includes(key)){if(value===null)return [editable[key as keyof typeof editable],null];if(typeof value!=='string'||key==='voiceId'&&!uuid.test(value)||key==='conversationTone'&&!['gentle','witty','quiet','stern'].includes(value)||key==='voiceTimbre'&&!['warm','bright','deep'].includes(value))throw new PersonWriteError(400,'INVALID_ARGUMENT');return [editable[key as keyof typeof editable],value]}
    if(Object.prototype.hasOwnProperty.call(listLimits,key)){const [max,length]=listLimits[key as keyof typeof listLimits];if(!Array.isArray(value)||value.length>max||value.some(v=>typeof v!=='string'||!v.trim()||[...v.trim()].length>length||v.includes('\0')||/\p{Surrogate}/u.test(v)))throw new PersonWriteError(400,'INVALID_ARGUMENT');return [editable[key as keyof typeof editable],value.map(v=>(v as string).trim())]}
    if (value !== undefined && typeof value !== 'string') throw new PersonWriteError(400, 'INVALID_ARGUMENT')
    return [editable[key as keyof typeof editable], typeof value === 'string' ? value.trim() || null : null]
  }))
}

type ManagementCallbacks = {
  accountId?:string
  onSaved: (person: ServicePerson, world: WorldId) => void
  onRemoved: (id: number) => void
  onUnauthorized: () => void
  beforeWrite: () => void
}

/** Connects the existing profile sheets to one verified session and one server resource. */
export function usePersonManagement(sessionId: string | undefined, person: Person | undefined, callbacks: ManagementCallbacks, photos?: { client?: MediaClient; prepare: (sources: string[]) => Promise<PreparedPhoto[]> }): PersonManagement | undefined {
  type Scope = { key: string; retryKeys: Map<string, string>; alive: boolean }
  const active = useRef<{ controller: AbortController; scope: Scope } | null>(null)
  const latest = useRef(callbacks)
  latest.current = callbacks
  const personId = person?.serverId
  const scopeKey = JSON.stringify([sessionId, personId,callbacks.accountId])
  const binding = useRef<Scope>({ key: scopeKey, retryKeys: new Map(), alive: true })
  if (binding.current.key !== scopeKey) binding.current = { key: scopeKey, retryKeys: new Map(), alive: true }
  const scope = binding.current
  useEffect(() => {
    scope.alive = true
    return () => {
    scope.alive = false
    if (active.current?.scope === scope) { active.current.controller.abort(); active.current = null }
    scope.retryKeys.clear()
    }
  }, [sessionId, personId,callbacks.accountId])
  if (!sessionId || !personId || !person?.serverVersion) return undefined
  const current = person
  const path = '/v1/persons/' + encodeURIComponent(personId)

  const owns = (signal: AbortSignal) => !signal.aborted && scope.alive && binding.current === scope
  async function request(signal: AbortSignal, method: 'GET' | 'PATCH' | 'DELETE' | 'POST', body?: Record<string, string | null | string[]>, suffix = '') {
    const signature = JSON.stringify([method, personId, current.serverVersion, suffix, body])
    let key = scope.retryKeys.get(signature)
    if (method !== 'GET' && !key) { key = crypto.randomUUID(); scope.retryKeys.set(signature, key) }
    const response = await fetch(path + suffix, {
      signal, method, cache: 'no-store', credentials: 'same-origin',
      headers: {
        'X-Xijie-Expected-Session': sessionId!,
        ...(method !== 'GET' && { 'Idempotency-Key': key!, 'If-Match': '"v' + current.serverVersion + '"' }),
        ...(body && { 'Content-Type': 'application/json' }),
      }, ...(body && { body: JSON.stringify(body) }),
    })
    if (!response.ok) {
      const value = await response.json().catch(() => null) as { error?: { code?: string } } | null
      if (response.status === 401 && owns(signal)) latest.current.onUnauthorized()
      throw new PersonWriteError(response.status, value?.error?.code ?? 'REQUEST_FAILED')
    }
    if (method === 'DELETE') return null
    const result = await response.json() as { data: ServicePerson }
    if (result.data?.id !== personId || result.data.status !== 'active' || !uuid.test(result.data.worldId) || !Number.isSafeInteger(result.data.version) || result.data.version < 1) {
      throw new PersonWriteError(502, 'INVALID_RESPONSE')
    }
    validateStructuredProfile(result.data)
    return result.data
  }

  async function applySaved(signal: AbortSignal, saved: ServicePerson | null) {
    if (!saved || !owns(signal)) throw new DOMException('The profile view changed', 'AbortError')
    let world: WorldCard
    try { world = await readWorld(saved.worldId, sessionId!, signal) }
    catch (error) {
      if (error instanceof PeopleReadError) {
        if (error.status === 401 && owns(signal)) latest.current.onUnauthorized()
        // A missing directory entry does not mean the person itself was removed.
        throw new PersonWriteError(error.status === 401 ? 401 : 502, error.status === 401 ? 'UNAUTHENTICATED' : 'INVALID_RESPONSE')
      }
      throw error
    }
    if (!owns(signal)) throw new DOMException('The profile view changed', 'AbortError')
    latest.current.onSaved(saved, world.code)
    return world.code
  }

  async function perform(work: (signal: AbortSignal) => Promise<void>) {
    if (!scope.alive || binding.current !== scope) throw new DOMException('The profile view changed', 'AbortError')
    if (active.current?.scope === scope) throw new PersonWriteError(409, 'REQUEST_IN_PROGRESS')
    active.current?.controller.abort()
    const controller = new AbortController()
    const operation = { controller, scope }
    active.current = operation
    const timeout = window.setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), 180_000)
    latest.current.beforeWrite()
    try { await work(controller.signal) }
    finally { window.clearTimeout(timeout); if (active.current === operation) active.current = null }
  }

  return {
    voiceContext:callbacks.accountId&&uuid.test(callbacks.accountId)&&person.voiceTarget?.kind==='person_draft'&&uuid.test(person.voiceTarget.id)?{accountId:callbacks.accountId,sessionId,draftId:person.voiceTarget.id,onUnauthorized:()=>{if(binding.current===scope&&scope.alive)latest.current.onUnauthorized()}}:undefined,
    save: patch => perform(async signal => {
      const saved = await request(signal, 'PATCH', personProfileInput(patch))
      await applySaved(signal, saved)
      if(patch.voiceId!==undefined&&(!saved||(saved.voiceId??null)!==patch.voiceId))throw new PersonWriteError(409,'VOICE_CHANGED')
    }),
    replacePhotos: selection => perform(async signal => {
      if (!photos?.client || !current.photoTarget || selection.length > 6) throw new PersonWriteError(400, 'INVALID_ARGUMENT')
      const mediaIds: string[] = []
      for (const choice of selection) {
        if (!owns(signal)) throw new DOMException('The profile view changed', 'AbortError')
        if (typeof choice !== 'string') { if (!mediaIds.includes(choice.id)) mediaIds.push(choice.id) }
        else { for (const id of await photos.client.upload(await photos.prepare([choice]), current.photoTarget.id)) if (!mediaIds.includes(id)) mediaIds.push(id) }
      }
      if (!owns(signal)) throw new DOMException('The profile view changed', 'AbortError')
      const saved = await request(signal, 'PATCH', { mediaIds })
      await applySaved(signal, saved)
    }),
    move: world => perform(async signal => {
      if (!WORLD_IDS.includes(world)) throw new PersonWriteError(400, 'INVALID_ARGUMENT')
      let worlds: WorldCard[]
      try { worlds = await readList<WorldCard>('/v1/worlds', sessionId!, signal) }
      catch (error) {
        if (error instanceof PeopleReadError) {
          if (error.status === 401 && owns(signal)) latest.current.onUnauthorized()
          throw new PersonWriteError(error.status, error.status === 401 ? 'UNAUTHENTICATED' : 'REQUEST_FAILED')
        }
        throw error
      }
      const destination = worlds.find(value => validWorld(value) && value.code === world && value.enabled)
      if (!destination) throw new PersonWriteError(409, 'WORLD_UNAVAILABLE')
      if (!owns(signal)) throw new DOMException('The profile view changed', 'AbortError')
      const saved = await request(signal, 'POST', { worldId: destination.id }, '/world')
      const actualWorld = await applySaved(signal, saved)
      // A replay reads current authority; it must not promise an old destination.
      if (actualWorld !== world) throw new PersonWriteError(409, 'WORLD_CHANGED')
    }),
    remove: () => perform(async signal => {
      await request(signal, 'DELETE')
      if (!owns(signal)) throw new DOMException('The profile view changed', 'AbortError')
      latest.current.onRemoved(current.id)
    }),
    reload: () => perform(async signal => {
      let saved: ServicePerson | null
      try {
        saved = await request(signal, 'GET')
      } catch (error) {
        if (owns(signal) && error instanceof PersonWriteError && error.status === 404) { latest.current.onRemoved(current.id); return }
        else throw error
      }
      await applySaved(signal, saved)
    }),
  }
}
