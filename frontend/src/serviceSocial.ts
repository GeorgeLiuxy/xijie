import { useEffect, useMemo, useRef, useState } from 'react'
import { WORLD_IDS, isZh, useI18n, type WorldId } from './i18n'
import { nid, type Person, type Post, type PostComment, type PostPhoto } from './model'
import { MediaClient, MediaError, preparePhotos, validatePostPhoto } from './serviceMedia'

type Self = { kind: 'self' }
type Persona = { kind: 'persona'; personId: string; displayName: string; aiGenerated: true }
type WorldCard = { id: string; code: WorldId; displayName: string; catalogVersion: number; enabled: boolean }
type Movement = { id: string; personId: string; personName: string; worldVersion: number; reality: 'virtual'; branch: 'main'; fromWorld: WorldCard; toWorld: WorldCard; occurredAt: string; recordedAt: string }
type RemoteComment = { id: string; postId: string; author: Self | Persona; body: string; replyToCommentId?: string; generationJobId?: string; createdAt: string; version: number }
type RemotePost = {
  id: string; kind: 'user' | 'world_notice' | 'memory_echo'; author: Self | Persona | { kind: 'system'; worldId: string }; body: string; mediaIds: string[]; media?: PostPhoto[]
  worldId?: string; personId?: string; sourceMovementId?: string; worldMovement?: Movement
  worldSnapshot?: WorldCard; sourceMemoryId?: string; sourceMemoryVersion?: number; sourceMemory?: { personId: string; memoryId: string; version: number; excerpt: string }
  reactionCount: number; commentCount: number; reactedByMe: boolean; reactionPreview: Self[]; commentPreview: RemoteComment[]; createdAt: string; version: number
}
type CompletePost = { post: RemotePost; comments: RemoteComment[] }
type Intent = { key: string; clientId: string; storageKey: string; mediaIds?: string[] }
type Context = { accountId: string; sessionId: string; onUnauthorized: () => void }
type GenerationStatus = { pending: number; failed: number; retryableJobIds: string[] }
type GenerationJob = { id: string; kind: 'memory_echo' | 'feed_reaction'; state: 'queued' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'canceled'; version: number; resultId?: string; failure?: { code: string; retryable: boolean }; updatedAt: string }
type Envelope<T> = { data: T; meta?: { nextCursor?: string | null; generationStatus?: GenerationStatus } }
export type SocialService = {
  refresh: (announceFailures?: boolean) => Promise<void>
  retryFailed: () => Promise<void>
  post: (text: string, images: string[]) => Promise<boolean>
  remove: (postId: number, expectedVersion?: number) => Promise<boolean>
  readPhoto: (postId: number, photo: PostPhoto, signal: AbortSignal) => Promise<Blob>
  like: (postId: number) => Promise<boolean>
  comment: (postId: number, text: string, replyToCommentId?: string) => Promise<boolean>
}
type Scope = {
  key: string; context: Context; stopped: boolean; requests: Set<AbortController>; ids: Map<string, number>
  cache: Map<string, CompletePost>; intents: Map<string, Promise<Intent>>; busy: Set<string>; revision: number; refreshId: number; lastReadFailure: string
  retryableJobs: Set<string>; notifiedFailures: string
  media: MediaClient; deleteTargets: Map<number, { id: string; version: number }>
}
export class SocialError extends Error { constructor(readonly status: number, readonly code: string) { super(code) } }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const text = (value: unknown, maximum: number): value is string => typeof value === 'string' && [...value].length <= maximum && !value.includes('\0') && !/\p{Surrogate}/u.test(value)
const instant = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value))
const self = (value: unknown): value is Self => !!value && typeof value === 'object' && (value as Self).kind === 'self'
const persona = (value: unknown): value is Persona => !!value && typeof value === 'object' && (value as Persona).kind === 'persona' && uuid.test((value as Persona).personId) && text((value as Persona).displayName, 500) && !!(value as Persona).displayName.trim() && (value as Persona).aiGenerated === true
const invalid = () => new SocialError(502, 'INVALID_RESPONSE')
const MAX_PAGES = 100, MAX_ITEMS = 10000
type ReadBudget = { requests: number; expiresAt: number; current?: () => boolean }
const readBudget = (): ReadBudget => ({ requests: 0, expiresAt: Date.now() + 45000 })
function world(value: WorldCard) {
  return !!value && uuid.test(value.id) && WORLD_IDS.includes(value.code) && text(value.displayName, 500) && !!value.displayName && positive(value.catalogVersion) && typeof value.enabled === 'boolean'
}
function comment(value: RemoteComment, parent: RemotePost) {
  if (!value || !uuid.test(value.id) || value.postId !== parent.id || !(self(value.author) || persona(value.author)) || !text(value.body, 1000) || !value.body.trim() || !positive(value.version) || !instant(value.createdAt)
    || value.replyToCommentId !== undefined && !uuid.test(value.replyToCommentId) || value.generationJobId !== undefined && !uuid.test(value.generationJobId)) throw invalid()
  if (persona(value.author) && (parent.kind !== 'memory_echo' || value.author.personId !== parent.personId)) throw invalid()
  return value
}
function post(value: RemotePost) {
  if (!value || !uuid.test(value.id) || !['user', 'world_notice', 'memory_echo'].includes(value.kind) || !text(value.body, 4000) || !positive(value.version) || !instant(value.createdAt)
    || !Array.isArray(value.mediaIds) || value.mediaIds.length > 9 || value.mediaIds.some(id => !uuid.test(id)) || new Set(value.mediaIds).size !== value.mediaIds.length
    || !count(value.reactionCount) || !count(value.commentCount) || typeof value.reactedByMe !== 'boolean'
    || !Array.isArray(value.reactionPreview) || value.reactionPreview.length > 8 || value.reactionPreview.some(author => !self(author))
    || !Array.isArray(value.commentPreview) || value.commentPreview.length > 3 || value.commentPreview.length > value.commentCount
    || value.reactionPreview.length > value.reactionCount || value.reactedByMe && value.reactionCount < 1) throw invalid()
  const photos = value.media ?? []
  if (!Array.isArray(photos) || photos.length !== value.mediaIds.length || photos.some((photo, index) => validatePostPhoto(photo).id !== value.mediaIds[index])
    || !value.body.trim() && (value.kind !== 'user' || !photos.length) || value.kind !== 'user' && photos.length) throw invalid()
  for (const item of value.commentPreview) comment(item, value)
  if (value.kind !== 'memory_echo' && (value.sourceMemory !== undefined || value.sourceMemoryId !== undefined || value.sourceMemoryVersion !== undefined)) throw invalid()
  if (value.kind === 'user') {
    if (!self(value.author) || value.worldMovement !== undefined || value.sourceMovementId !== undefined || value.personId !== undefined) throw invalid()
  } else if (value.kind === 'world_notice') {
    const event = value.worldMovement
    if (!value.author || value.author.kind !== 'system' || !uuid.test(value.worldId ?? '') || !uuid.test(value.personId ?? '') || !event || !uuid.test(event.id)
      || value.sourceMovementId !== event.id || value.personId !== event.personId || !text(event.personName, 500) || !event.personName || !positive(event.worldVersion) || event.worldVersion < 2
      || event.reality !== 'virtual' || event.branch !== 'main' || !world(event.fromWorld) || !world(event.toWorld) || event.fromWorld.id === event.toWorld.id
      || event.toWorld.id !== value.worldId || value.author.worldId !== value.worldId || !instant(event.occurredAt) || !instant(event.recordedAt) || Date.parse(event.recordedAt) < Date.parse(event.occurredAt)) throw invalid()
  } else {
    const source = value.sourceMemory
    if (!persona(value.author) || value.author.personId !== value.personId || !uuid.test(value.personId ?? '') || !uuid.test(value.sourceMemoryId ?? '') || !positive(value.sourceMemoryVersion)
      || !source || source.personId !== value.personId || source.memoryId !== value.sourceMemoryId || source.version !== value.sourceMemoryVersion || !text(source.excerpt, 320) || !source.excerpt
      || !value.worldSnapshot || !world(value.worldSnapshot) || value.worldSnapshot.id !== value.worldId || value.worldMovement !== undefined || value.sourceMovementId !== undefined) throw invalid()
  }
  return value
}

function generationStatus(value: GenerationStatus | undefined): GenerationStatus {
  if (value === undefined) return { pending: 0, failed: 0, retryableJobIds: [] }
  if (!value || !count(value.pending) || !count(value.failed) || !Array.isArray(value.retryableJobIds) || value.retryableJobIds.length > 50 || value.retryableJobIds.length > value.failed || value.retryableJobIds.some(id => !uuid.test(id)) || new Set(value.retryableJobIds).size !== value.retryableJobIds.length) throw invalid()
  return value
}
function generationJob(value: GenerationJob, id: string) {
  if (!value || value.id !== id || !['memory_echo', 'feed_reaction'].includes(value.kind) || !['queued', 'running', 'succeeded', 'failed', 'blocked', 'canceled'].includes(value.state)
    || !positive(value.version) || !instant(value.updatedAt) || value.resultId !== undefined && !uuid.test(value.resultId)
    || value.failure !== undefined && (!text(value.failure.code, 100) || typeof value.failure.retryable !== 'boolean')) throw invalid()
  return value
}

export function useServiceSocial(context: Context | undefined, people: Person[]) {
  const { lang } = useI18n(), zh = isZh(lang)
  const key = context ? JSON.stringify([context.accountId, context.sessionId]) : ''
  const rendered = useRef(key); rendered.current = key
  const callbacks = useRef({ context, people }); callbacks.current = { context, people }
  const [state, setState] = useState<{ key: string; posts: Post[] }>({ key: '', posts: [] })
  const noticeSequence = useRef(0)
  const [noticeState, setNotice] = useState<{ key: string; id: number; text: string; generation?: boolean } | null>(null)
  const [retryState, setRetryState] = useState<{ key: string; available: boolean; busy: boolean }>({ key: '', available: false, busy: false })
  const notice = noticeState?.key === key ? noticeState.text : null
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(null), noticeState?.generation ? 8000 : 3200); return () => clearTimeout(timer) }, [notice, noticeState])
  const scope = useMemo<Scope | undefined>(() => {
    if (!context) return
    const value = { key, context, stopped: false, requests: new Set<AbortController>(), ids: new Map<string, number>(), cache: new Map<string, CompletePost>(), intents: new Map<string, Promise<Intent>>(), busy: new Set<string>(), revision: 0, refreshId: 0, lastReadFailure: '', retryableJobs: new Set<string>(), notifiedFailures: '', deleteTargets: new Map<number, { id: string; version: number }>() } as Scope
    value.media = new MediaClient({ ...context, live: () => !value.stopped && rendered.current === value.key, onUnauthorized: () => callbacks.current.context?.onUnauthorized() })
    return value
  }, [key])
  useEffect(() => {
    if (!scope) return
    scope.stopped = false
    return () => { scope.stopped = true; for (const request of scope.requests) request.abort(); scope.requests.clear(); scope.media.dispose() }
  }, [scope])
  const implementation = useMemo(() => {
    if (!scope) return
    const live = () => !scope.stopped && rendered.current === scope.key
    function identifier(serverId: string) {
      let id = scope!.ids.get(serverId)
      if (id === undefined) { id = nid(); scope!.ids.set(serverId, id) }
      return id
    }
    function publish() {
      if (!live()) return
      const posts: Post[] = []
      for (const { post: item, comments } of scope!.cache.values()) {
        const movement = item.worldMovement, echo = item.kind === 'memory_echo'
        const person = item.personId ? callbacks.current.people.find(person => person.serverId === item.personId) : undefined
        // Current People visibility also governs the local view while a new read is pending.
        if ((movement || echo) && !person) continue
        if (echo) {
          const original = person!.memories.find(memory => memory.serverId === item.sourceMemoryId)
          if (!original || original.serverVersion !== item.sourceMemoryVersion || !original.body.startsWith(item.sourceMemory!.excerpt)) continue
        }
        const commentById = new Map(comments.map(comment => [comment.id, comment]))
        const convertedComments: PostComment[] = comments.map(comment => {
          const author = persona(comment.author) ? person!.id : 'me', target = comment.replyToCommentId ? commentById.get(comment.replyToCommentId)?.author : undefined
          return { id: identifier(comment.id), serverId: comment.id, serverVersion: comment.version, author, text: comment.body, at: Date.parse(comment.createdAt),
            ...(persona(comment.author) ? { ai: true, authorName: comment.author.displayName } : {}),
            ...(comment.replyToCommentId ? { replyToServerId: comment.replyToCommentId } : {}),
            ...(target ? { to: persona(target) ? person!.id : 'me', ...(persona(target) ? { toName: target.displayName } : {}) } : {}) }
        })
        posts.push({ id: identifier(item.id), serverId: item.id, serverVersion: item.version, author: movement ? `world:${movement.toWorld.code}` : echo ? person!.id : 'me', kind: movement ? 'movement' : echo ? 'echo' : 'mine', text: movement && !zh ? `${movement.personName} moved from ${movement.fromWorld.displayName} to ${movement.toWorld.displayName}.` : item.body,
          images: [], ...(item.media?.length ? { media: item.media } : {}), at: Date.parse(item.createdAt), likes: item.reactedByMe ? ['me'] : [], comments: convertedComments,
          ...(movement ? { world: movement.toWorld.code, authorName: movement.toWorld.displayName, relatedPersonId: person!.id, personServerId: movement.personId } : {}),
          ...(echo ? { world: item.worldSnapshot!.code, authorName: (item.author as Persona).displayName, relatedPersonId: person!.id, personServerId: item.personId,
            quote: item.sourceMemory!.excerpt, sourceMemoryId: item.sourceMemoryId, sourceMemoryVersion: item.sourceMemoryVersion } : {}) })
      }
      posts.sort((a, b) => b.at - a.at || (b.serverId ?? '').localeCompare(a.serverId ?? ''))
      setState({ key: scope!.key, posts })
    }
    const report = (message: string) => { if (live()) setNotice({ key: scope!.key, id: ++noticeSequence.current, text: message }) }
    function clearGeneration() {
      if (!live()) return
      scope!.retryableJobs.clear()
      setRetryState({ key: scope!.key, available: false, busy: scope!.busy.has('retry') })
      setNotice(previous => previous?.key === scope!.key && previous.generation ? null : previous)
    }
    function showGeneration(status: GenerationStatus, announce: boolean) {
      if (!live()) return
      scope!.retryableJobs = new Set(status.retryableJobIds)
      setRetryState({ key: scope!.key, available: status.retryableJobIds.length > 0, busy: scope!.busy.has('retry') })
      if (!status.failed) { scope!.notifiedFailures = ''; setNotice(previous => previous?.key === scope!.key && previous.generation ? null : previous); return }
      const fingerprint = JSON.stringify([status.failed, [...status.retryableJobIds].sort()])
      if (announce || scope!.notifiedFailures !== fingerprint) {
        scope!.notifiedFailures = fingerprint
        setNotice({ key: scope!.key, id: ++noticeSequence.current, generation: true, text: zh ? '回响或回应未完成，原文仍保留' : 'AI response failed. Saved text is kept.' })
      }
    }
    function fail(error: unknown, writing = false) {
      if (!live() || error instanceof DOMException && error.name === 'AbortError' && scope!.stopped) return
      const known = error instanceof SocialError || error instanceof MediaError
      const code = known ? error.code : 'REQUEST_FAILED'
      if (!writing && scope!.lastReadFailure === code) return
      if (!writing) scope!.lastReadFailure = code
      report(known && error.status === 403 && error.code === 'PHOTO_STORAGE_PERMISSION_REQUIRED'
        ? zh ? '请到「我」的「隐私与 AI 说明」同意说明，再回来发表。文字和照片已保留。' : 'Open Me → Privacy & AI, agree to the statement, then return to post. Your text and photos are kept.'
        : known && error.status === 403 && error.code === 'AI_PERMISSION_REQUIRED'
        ? zh ? '请到「我」的「隐私与 AI 说明」同意说明后重试。' : 'Open Me → Privacy & AI and agree to the statement, then try again.'
        : known && error.status === 403
        ? zh ? '请到「我」的「隐私与 AI 说明」同意说明，再回来发表。填写内容已保留。' : 'Open Me → Privacy & AI, agree to the statement, then return to post. Your draft is kept.'
        : error instanceof MediaError
          ? zh ? '照片暂未处理完成，文字与照片已保留，请重试。' : 'The photos could not be confirmed. Your text and photos are kept; retry.'
          : error instanceof SocialError && error.code === 'READ_LIMIT_EXCEEDED'
            ? zh ? '动态较多，暂时未能完整读取，请稍后重试。' : 'The full timeline could not be loaded. Please try again later.'
            : error instanceof SocialError && [404, 409, 412].includes(error.status)
              ? zh ? '这条动态已有变化或无法访问，请重新打开。填写的内容仍保留。' : 'This post changed or is unavailable. Reopen it; your draft is kept.'
              : writing ? zh ? '还没能确认是否发表成功，内容已保留，请重试。' : 'Saving is not confirmed. Your draft is kept; retry.'
                : zh ? '暂时无法读取动态，请稍后重试。' : 'The timeline could not be loaded. Try again shortly.')
    }
    async function request<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
      if (!live()) throw new DOMException('Canceled', 'AbortError')
      const controller = new AbortController(); scope!.requests.add(controller)
      const timer = window.setTimeout(() => controller.abort(), 15000)
      try {
        const headers = new Headers(init?.headers); headers.set('X-Xijie-Expected-Session', scope!.context.sessionId)
        const response = await fetch(path, { ...init, headers, signal: controller.signal, credentials: 'same-origin', cache: 'no-store' })
        if (!live()) throw new DOMException('Canceled', 'AbortError')
        if (!response.ok) {
          const body = await response.json().catch(() => null)
          if (response.status === 401 && live()) callbacks.current.context?.onUnauthorized()
          throw new SocialError(response.status, body?.error?.code ?? 'REQUEST_FAILED')
        }
        const value = await response.json() as Envelope<T>
        if (!live()) throw new DOMException('Canceled', 'AbortError')
        if (!value || value.data == null) throw invalid()
        return value
      } finally { window.clearTimeout(timer); scope!.requests.delete(controller) }
    }
    async function pages<T>(path: string, validate: (item: T) => T, budget = readBudget(), firstPage?: (value: Envelope<T[]>) => void) {
      const values: T[] = [], cursors = new Set<string>(), ids = new Set<string>(); let cursor: string | null = null
      for (let page = 0; page < MAX_PAGES; page++) {
        if (budget.current && !budget.current()) throw new DOMException('Canceled', 'AbortError')
        if (++budget.requests > 1000 || Date.now() >= budget.expiresAt) throw new SocialError(413, 'READ_LIMIT_EXCEEDED')
        const query = new URLSearchParams({ limit: '100' }); if (cursor) query.set('cursor', cursor)
        const result = await request<T[]>(path + '?' + query)
        if (!page) firstPage?.(result)
        if (!Array.isArray(result.data)) throw invalid()
        for (const item of result.data) {
          const value = validate(item), id = (value as { id: string }).id
          if (ids.has(id)) throw invalid()
          ids.add(id); values.push(value)
          if (values.length > MAX_ITEMS) throw new SocialError(413, 'READ_LIMIT_EXCEEDED')
        }
        cursor = result.meta?.nextCursor ?? null
        if (cursor === null) return values
        if (typeof cursor !== 'string' || !cursor || cursor.length > 4096 || cursors.has(cursor)) throw invalid()
        cursors.add(cursor)
      }
      throw new SocialError(413, 'READ_LIMIT_EXCEEDED')
    }
    const commentsFor = (item: RemotePost, budget?: ReadBudget) => pages<RemoteComment>('/v1/posts/' + item.id + '/comments', value => comment(value, item), budget)
    async function complete(item: RemotePost, budget?: ReadBudget): Promise<CompletePost> {
      return { post: item, comments: item.commentCount ? await commentsFor(item, budget) : [] }
    }
    async function refresh(announceFailures = false) {
      const turn = ++scope!.refreshId, revision = scope!.revision
      try {
        const budget = { ...readBudget(), current: () => live() && turn === scope!.refreshId && revision === scope!.revision }
        let generation: GenerationStatus = { pending: 0, failed: 0, retryableJobIds: [] }
        const items = await pages<RemotePost>('/v1/feed', post, budget, result => { generation = generationStatus(result.meta?.generationStatus) }), completeItems: CompletePost[] = []
        for (const item of items) {
          if (!budget.current()) return
          completeItems.push(await complete(item, budget))
        }
        if (!live() || turn !== scope!.refreshId || revision !== scope!.revision) return
        if (Date.now() >= budget.expiresAt) throw new SocialError(413, 'READ_LIMIT_EXCEEDED')
        scope!.cache = new Map(completeItems.map(item => [item.post.id, item])); scope!.lastReadFailure = ''; publish(); showGeneration(generation, announceFailures)
      } catch (error) {
        if (live() && turn === scope!.refreshId && revision === scope!.revision) { scope!.cache.clear(); publish(); clearGeneration(); fail(error) }
      }
    }
    async function intent(fingerprint: string): Promise<Intent> {
      let waiting = scope!.intents.get(fingerprint)
      if (!waiting) {
        waiting = (async () => {
          const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint)))].map(value => value.toString(16).padStart(2, '0')).join('')
          const storageKey = 'xijie.social.intent.' + scope!.context.accountId + '.' + hash
          let value: { key: string; clientId: string; mediaIds?: string[] } | undefined
          try { const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null'); if (saved && uuid.test(saved.key) && uuid.test(saved.clientId)
            && (saved.mediaIds === undefined || Array.isArray(saved.mediaIds) && saved.mediaIds.length <= 9 && saved.mediaIds.every((id: unknown) => typeof id === 'string' && uuid.test(id)) && new Set(saved.mediaIds).size === saved.mediaIds.length)) value = { key: saved.key, clientId: saved.clientId, ...(saved.mediaIds ? { mediaIds: saved.mediaIds } : {}) } } catch { /* A live retry retains its identity. */ }
          value ??= { key: crypto.randomUUID(), clientId: crypto.randomUUID() }
          try { sessionStorage.setItem(storageKey, JSON.stringify(value)) } catch { /* The live scope retains its intent. */ }
          return { ...value, storageKey }
        })()
        scope!.intents.set(fingerprint, waiting)
      }
      return waiting
    }
    function finish(fingerprint: string, value: Intent) {
      scope!.intents.delete(fingerprint)
      try { sessionStorage.removeItem(value.storageKey) } catch { /* The live intent is already complete. */ }
    }
    function apply(item: CompletePost) {
      if (!live()) return
      const previous = scope!.cache.get(item.post.id)
      if (previous && previous.post.version > item.post.version) return
      scope!.revision++; scope!.cache.set(item.post.id, item); publish()
    }
    function existing(id: number) {
      const item = [...scope!.cache.values()].find(item => identifier(item.post.id) === id)
      if (!item) throw new SocialError(404, 'NOT_FOUND')
      if (item.post.personId) {
        const person = callbacks.current.people.find(person => person.serverId === item.post.personId)
        if (!person) throw new SocialError(404, 'NOT_FOUND')
        if (item.post.kind === 'memory_echo') {
          const original = person.memories.find(memory => memory.serverId === item.post.sourceMemoryId)
          if (!original || original.serverVersion !== item.post.sourceMemoryVersion || !original.body.startsWith(item.post.sourceMemory!.excerpt)) throw new SocialError(404, 'NOT_FOUND')
        }
      }
      return item
    }
    async function mutate(lock: string, execute: () => Promise<void>) {
      if (!live() || scope!.busy.has(lock)) return false
      scope!.busy.add(lock)
      try { await execute(); return live() } catch (error) {
        if (live() && (error instanceof SocialError || error instanceof MediaError) && [401, 403, 404].includes(error.status) && error.code !== 'PHOTO_STORAGE_PERMISSION_REQUIRED') { scope!.cache.clear(); scope!.revision++; publish(); clearGeneration() }
        fail(error, true); return false
      } finally { scope!.busy.delete(lock) }
    }
    const service: SocialService = {
      refresh,
      async retryFailed() {
        if (!live() || scope!.busy.has('retry') || !scope!.retryableJobs.size) return
        scope!.busy.add('retry'); setRetryState({ key: scope!.key, available: true, busy: true })
        try {
          for (const id of [...scope!.retryableJobs]) {
            if (!live() || !scope!.retryableJobs.has(id)) break
            const job = generationJob((await request<GenerationJob>('/v1/social-generation-jobs/' + id)).data, id)
            if (!live() || !scope!.retryableJobs.has(id)) break
            if (job.state !== 'failed' || !job.failure?.retryable) { scope!.retryableJobs.delete(id); continue }
            const fingerprint = JSON.stringify(['generation-retry', id, job.version]), operation = await intent(fingerprint)
            if (!live() || !scope!.retryableJobs.has(id)) break
            generationJob((await request<GenerationJob>('/v1/social-generation-jobs/' + id + '/retry', {
              method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operation.key, 'If-Match': '"v' + job.version + '"' }, body: '{}',
            })).data, id)
            finish(fingerprint, operation); scope!.retryableJobs.delete(id)
          }
        } catch (error) {
          if (live()) {
            if (error instanceof SocialError && error.status === 403) fail(error, true)
            else report(zh ? '暂时无法重试，请稍后再试。' : 'Retry could not be confirmed. Please try again later.')
          }
        } finally {
          scope!.busy.delete('retry')
          if (live()) { setRetryState({ key: scope!.key, available: scope!.retryableJobs.size > 0, busy: false }); await refresh(true) }
        }
      },
      post: (body, images) => mutate('post', async () => {
        body = body.trim()
        if ((!body && !images.length) || !text(body, 500)) throw new SocialError(400, 'INVALID_REQUEST')
        const prepared = await preparePhotos(images)
        if (!live()) throw new DOMException('Canceled', 'AbortError')
        const fingerprint = prepared.length ? JSON.stringify(['post', body, prepared.map(photo => [photo.sha256, photo.mimeType, photo.byteSize])]) : JSON.stringify(['post', body]), operation = await intent(fingerprint)
        if (!live()) throw new DOMException('Canceled', 'AbortError')
        if (operation.mediaIds !== undefined && operation.mediaIds.length !== prepared.length) throw invalid()
        const mediaIds = operation.mediaIds ?? (prepared.length ? await scope!.media.upload(prepared, operation.clientId) : [])
        if (!live()) throw new DOMException('Canceled', 'AbortError')
        // Once submission can have reached Social, its exact attachment list is
        // part of that immutable intent. Retry Social directly even if Media
        // reads have since been revoked; never replace an unknown committed post.
        if (prepared.length && operation.mediaIds === undefined) {
          operation.mediaIds = mediaIds
          try { sessionStorage.setItem(operation.storageKey, JSON.stringify({ key: operation.key, clientId: operation.clientId, mediaIds })) } catch { /* The live intent retains the binding. */ }
        }
        const item = post((await request<RemotePost>('/v1/posts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operation.key }, body: JSON.stringify({ clientPostId: operation.clientId, body, mediaIds }) })).data)
        if (item.kind !== 'user' || item.body !== body || JSON.stringify(item.mediaIds) !== JSON.stringify(mediaIds)) throw invalid()
        apply(await complete(item)); finish(fingerprint, operation)
        scope!.media.finish(operation.clientId)
      }),
      remove: (id, expected) => mutate('remove:' + id, async () => {
        const cached = scope!.cache.values(), current = [...cached].find(item => identifier(item.post.id) === id)
        const previous = scope!.deleteTargets.get(id)
        if (current && current.post.kind !== 'user') throw new SocialError(403, 'FORBIDDEN')
        const target = current ? { id: current.post.id, version: expected ?? current.post.version } : previous
        if (!target || !positive(target.version)) throw new SocialError(404, 'NOT_FOUND')
        scope!.deleteTargets.set(id, target)
        const fingerprint = JSON.stringify(['remove', target.id, target.version]), operation = await intent(fingerprint)
        try {
          const receipt = (await request<{ id: string; removedAt: string; version: number }>('/v1/posts/' + target.id, { method: 'DELETE', headers: { 'Idempotency-Key': operation.key, 'If-Match': '"v' + target.version + '"' } })).data
          if (!receipt || receipt.id !== target.id || !positive(receipt.version) || receipt.version <= target.version || !instant(receipt.removedAt)) throw invalid()
          scope!.revision++; scope!.cache.delete(target.id); publish(); finish(fingerprint, operation); scope!.deleteTargets.delete(id)
        } catch (error) { if (error instanceof SocialError && error.status === 412) void refresh(); throw error }
      }),
      readPhoto: async (id, photo, signal) => {
        const current = existing(id)
        const actual = current.post.media?.find(item => item.id === photo.id)
        if (!actual || ['id', 'version', 'mimeType', 'byteSize', 'width', 'height'].some(key => actual[key as keyof PostPhoto] !== photo[key as keyof PostPhoto])) throw new SocialError(404, 'NOT_FOUND')
        try { return await scope!.media.read(actual, current.post.id, signal) }
        catch (error) { if (error instanceof MediaError && error.status === 403) fail(error); throw error }
      },
      like: id => mutate('like:' + id, async () => {
        const current = existing(id), active = !current.post.reactedByMe, fingerprint = JSON.stringify(['like', current.post.id, active]), operation = await intent(fingerprint)
        const result = (await request<{ active: boolean; reactionCount: number; postVersion: number }>('/v1/posts/' + current.post.id + '/reactions/me', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operation.key }, body: JSON.stringify({ active }) })).data
        if (!result || typeof result.active !== 'boolean' || !count(result.reactionCount) || !positive(result.postVersion) || result.active && result.reactionCount < 1) throw invalid()
        const latest = scope!.cache.get(current.post.id)
        // A response must not resurrect private text removed by a newer denied/source read.
        if (latest) apply({ ...latest, post: { ...latest.post, reactedByMe: result.active, reactionCount: result.reactionCount, version: result.postVersion } })
        finish(fingerprint, operation)
        if (result.active !== active) throw new SocialError(409, 'REACTION_CHANGED')
      }),
      comment: (id, body, replyToCommentId) => mutate('comment:' + id, async () => {
        const current = existing(id); body = body.trim()
        if (!body || !text(body, 1000)) throw new SocialError(400, 'INVALID_REQUEST')
        if (replyToCommentId !== undefined && (!uuid.test(replyToCommentId) || !current.comments.some(comment => comment.id === replyToCommentId))) throw new SocialError(404, 'NOT_FOUND')
        const fingerprint = JSON.stringify(['comment', current.post.id, replyToCommentId ?? null, body]), operation = await intent(fingerprint)
        const saved = comment((await request<RemoteComment>('/v1/posts/' + current.post.id + '/comments', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operation.key }, body: JSON.stringify({ clientCommentId: operation.clientId, body, ...(replyToCommentId ? { replyToCommentId } : {}) }) })).data, current.post)
        if (!self(saved.author) || saved.body !== body || saved.replyToCommentId !== replyToCommentId) throw invalid()
        const latest = scope!.cache.get(current.post.id)
        if (latest) apply({ post: latest.post, comments: [...latest.comments.filter(item => item.id !== saved.id), saved].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id)) })
        finish(fingerprint, operation)
        // The acknowledged comment is usable immediately; a later full read reconciles concurrent activity.
        void refresh()
      }),
    }
    return { service, publish, clearGeneration }
  }, [scope, zh])
  useEffect(() => { implementation?.clearGeneration(); implementation?.publish() }, [implementation, people])
  const noticeAction = noticeState?.key === key && noticeState.generation && retryState.key === key && retryState.available
    ? { label: zh ? '重试' : 'Retry', onClick: () => { void implementation?.service.retryFailed() }, disabled: retryState.busy } : undefined
  return { service: implementation?.service, posts: state.key === key ? state.posts : [], notice, noticeId: noticeState?.key === key ? noticeState.id : undefined, noticeAction }
}
