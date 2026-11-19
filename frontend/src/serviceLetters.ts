import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtDate, type Lang } from './i18n'
import { nid, type Letter } from './model'

export type LetterMemoryRef = NonNullable<Letter['sourceMemory']>
export type LetterDraft = { text: string; wantReply: boolean; when: 'morning' | 'now'; sourceMemory?: LetterMemoryRef }
export type LetterDTO = {
  id: string; personId: string; clientLetterId: string; body: string; replyMode: 'none' | 'now' | 'next_morning'
  timeZone?: string; sourceMemory?: LetterMemoryRef; replyAt?: string; replyJobId?: string; replyJobState?: 'queued' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'canceled'
  failure?: { code: string; retryable: boolean }
  reply?: { id: string; body: string; sequence: string; createdAt: string; aiGenerated: true }
  createdAt: string; version: number; unread: boolean
}
export type LetterInput = { clientLetterId: string; body: string; replyMode: LetterDTO['replyMode']; timeZone?: string; sourceMemory?: LetterMemoryRef }
export type LetterIntent = { key: string; body: LetterInput }
export type LetterContext = { accountId: string; sessionId: string; personId: string; onUnauthorized: () => void }
export type LetterSnapshot = { status: 'loading' | 'ready' | 'error'; records: LetterDTO[]; error?: string; readError?: string }
export type LetterService = {
  snapshot: LetterSnapshot
  draft: () => LetterDraft
  saveDraft: (draft: LetterDraft) => void
  pending: () => LetterIntent | undefined
  send: (draft: LetterDraft) => Promise<LetterDTO>
  refresh: () => Promise<void>
  markRead: (snapshot: LetterSnapshot) => Promise<void>
  invalidate: () => void
  activate: () => void
  dispose: () => void
}
export class LetterError extends Error { constructor(readonly status: number, readonly code: string) { super(code) } }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const instant = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))
const text = (value: unknown, limit: number): value is string => typeof value === 'string' && !!value.trim() && [...value].length <= limit && !/\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
const invalid = () => new LetterError(502, 'INVALID_LETTER_RESPONSE')
const canonicalZone = (value: string | undefined) => value === undefined ? undefined : new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone
const validRef = (value: LetterMemoryRef | undefined) => value === undefined || !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 2 && typeof value.id === 'string' && uuid.test(value.id) && value.id === value.id.toLowerCase() && Number.isInteger(value.version) && value.version >= 1 && value.version <= 2147483647
const sameRef = (a?: LetterMemoryRef, b?: LetterMemoryRef) => a?.id === b?.id && a?.version === b?.version
export const compareReplySequence = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)
export function validateLetter(value: LetterDTO, personId: string): LetterDTO {
  try { if (value?.timeZone !== undefined) canonicalZone(value.timeZone) } catch { throw invalid() }
  if (!value || !uuid.test(value.id) || value.personId !== personId || !uuid.test(value.clientLetterId) || !text(value.body, 10000)
    || !['none', 'now', 'next_morning'].includes(value.replyMode) || !instant(value.createdAt) || !Number.isSafeInteger(value.version) || value.version < 1 || typeof value.unread !== 'boolean'
    || !validRef(value.sourceMemory) || value.replyAt !== undefined && !instant(value.replyAt) || value.timeZone !== undefined && (typeof value.timeZone !== 'string' || !value.timeZone)
    || value.replyMode === 'next_morning' && (!value.timeZone || !value.replyAt)
    || value.replyJobId !== undefined && !uuid.test(value.replyJobId)
    || value.replyJobState !== undefined && !['queued','running','succeeded','failed','blocked','canceled'].includes(value.replyJobState)
    || value.failure !== undefined && (typeof value.failure.code !== 'string' || typeof value.failure.retryable !== 'boolean')
    || value.reply !== undefined && (!uuid.test(value.reply.id) || !text(value.reply.body, 4000) || !/^[1-9]\d*$/.test(value.reply.sequence) || !instant(value.reply.createdAt) || value.reply.aiGenerated !== true)
    || value.replyMode === 'none' && (!!value.reply || !!value.replyJobId || !!value.replyJobState || value.unread)
    || value.unread && !value.reply || value.replyJobState === 'succeeded' && !value.reply) throw invalid()
  return value
}
const defaultDraft = (): LetterDraft => ({ text: '', wantReply: true, when: 'morning' })
const validDraft = (value: LetterDraft) => value && typeof value.text === 'string' && typeof value.wantReply === 'boolean' && ['morning','now'].includes(value.when) && validRef(value.sourceMemory)
const fromIntent = (value: LetterIntent): LetterDraft => ({ text: value.body.body, wantReply: value.body.replyMode !== 'none', when: value.body.replyMode === 'now' ? 'now' : 'morning', ...(value.body.sourceMemory ? { sourceMemory: { ...value.body.sourceMemory } } : {}) })
const code = (error: unknown) => error instanceof LetterError ? error.code : 'LETTER_REQUEST_FAILED'

/** One verified account/session/person owns all requests; browser records only retain retry identity and drafts. */
export function createLetterService(context: LetterContext, onSnapshot: (value: LetterSnapshot) => void, isCurrent: () => boolean = () => true): LetterService {
  let active = true, authority = 0, reading = 0, readRunning: Promise<void> | undefined, sending = false, acknowledging = false
  let snapshot: LetterSnapshot = { status: 'loading', records: [] }, intent: LetterIntent | undefined, draft = defaultDraft()
  let readIntent: { key: string; throughReplyId: string } | undefined
  const requests = new Set<AbortController>(), root = '/v1/persons/' + context.personId + '/letters'
  const prefix = 'xijie.letter.' + context.accountId + '.' + context.personId
  const live = () => active && isCurrent()
  const check = (revision = authority) => { if (!live() || revision !== authority) throw new DOMException('Letter scope changed', 'AbortError') }
  const remember = (suffix: string, value?: unknown) => { try { if (value === undefined) sessionStorage.removeItem(prefix + suffix); else sessionStorage.setItem(prefix + suffix, JSON.stringify(value)) } catch { /* This live scope still retains its original operation. */ } }
  try {
    const stored = JSON.parse(sessionStorage.getItem(prefix + '.draft') ?? 'null') as LetterDraft
    if (validDraft(stored)) draft = stored
    const pending = JSON.parse(sessionStorage.getItem(prefix + '.intent') ?? 'null') as LetterIntent
    if (pending && uuid.test(pending.key) && pending.key === pending.body?.clientLetterId && text(pending.body.body, 10000) && validRef(pending.body.sourceMemory)
      && ['none','now','next_morning'].includes(pending.body.replyMode) && (pending.body.replyMode !== 'next_morning' || typeof pending.body.timeZone === 'string' && !!pending.body.timeZone)) intent = pending
    const read = JSON.parse(sessionStorage.getItem(prefix + '.read') ?? 'null') as typeof readIntent
    if (read && uuid.test(read.key) && uuid.test(read.throughReplyId)) readIntent = read
  } catch { /* A malformed browser record cannot establish a server resource. */ }
  function emit(value: LetterSnapshot) { if (live()) { snapshot = value; onSnapshot(value) } }
  async function request<T>(path: string, revision: number, init?: RequestInit, external?: AbortController): Promise<{ data: T; meta?: { nextCursor?: string | null } }> {
    check(revision)
    const controller = external ?? new AbortController(); requests.add(controller)
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const headers = new Headers(init?.headers); headers.set('X-Xijie-Expected-Session', context.sessionId)
      const response = await fetch(path, { ...init, headers, signal: controller.signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error' }); check(revision)
      const body = await response.json().catch(() => null); check(revision)
      if (!response.ok) {
        const failure = new LetterError(response.status, body?.error?.code ?? 'LETTER_REQUEST_FAILED')
        if (response.status === 401 || response.status === 404 || response.status === 403 && failure.code !== 'LETTER_REPLY_PERMISSION_REQUIRED') {
          authority++; reading++; readRunning = undefined; requests.forEach(request => request.abort())
          emit({ status: 'error', records: [], error: failure.code })
        }
        if (response.status === 401) context.onUnauthorized()
        throw failure
      }
      if (body?.data == null) throw invalid()
      return body
    } finally { clearTimeout(timer); requests.delete(controller) }
  }
  async function completeList(revision: number, controller: AbortController) {
    for (let attempt = 0; ; attempt++) {
      const records: LetterDTO[] = [], ids = new Set<string>(), replyIds = new Set<string>(), sequences = new Set<string>(), cursors = new Set<string>()
      let cursor: string | null = null, bytes = 1
      try {
        for (let page = 0; page < 10; page++) {
          const query = new URLSearchParams({ limit: '100' }); if (cursor) query.set('cursor', cursor)
          const result = await request<LetterDTO[]>(root + '?' + query, revision, undefined, controller)
          if (!Array.isArray(result.data) || result.data.length > 100 || !(result.meta?.nextCursor === null || typeof result.meta?.nextCursor === 'string' && !!result.meta.nextCursor)) throw invalid()
          for (const value of result.data) {
            validateLetter(value, context.personId)
            if (ids.has(value.id) || value.reply && (replyIds.has(value.reply.id) || sequences.has(value.reply.sequence))) throw invalid()
            ids.add(value.id); if (value.reply) { replyIds.add(value.reply.id); sequences.add(value.reply.sequence) }
            bytes += new TextEncoder().encode(JSON.stringify(value)).byteLength + 1
            if (bytes > 8 * 1024 * 1024) throw new LetterError(413, 'LETTER_HISTORY_TOO_LARGE')
            records.push(value)
          }
          cursor = result.meta.nextCursor
          if (!cursor) return records
          if (cursors.has(cursor)) throw invalid(); cursors.add(cursor)
        }
        throw new LetterError(413, 'LETTER_HISTORY_TOO_LARGE')
      } catch (error) {
        if (!controller.signal.aborted && attempt === 0 && error instanceof LetterError && error.code === 'SOURCE_CHANGED') continue
        throw error
      }
    }
  }
  async function refresh(force = false): Promise<void> {
    if (!live()) return
    if (readRunning && !force) return readRunning
    const revision = authority, version = ++reading, controller = new AbortController()
    const run = async () => {
      emit({ ...snapshot, status: 'loading', error: undefined })
      try {
        const records = await completeList(revision, controller); check(revision)
        if (version === reading) emit({ status: 'ready', records })
      } catch (error) {
        if (live() && revision === authority && version === reading) emit({ status: 'error', records: [], error: code(error) })
      } finally { if (version === reading) readRunning = undefined }
    }
    readRunning = run(); return readRunning
  }
  const service: LetterService = {
    get snapshot() { return snapshot },
    draft: () => intent ? fromIntent(intent) : draft,
    saveDraft(value) { check(); if (intent || sending || !validDraft(value)) return; draft = { ...value, ...(value.sourceMemory ? { sourceMemory: { ...value.sourceMemory } } : {}) }; remember('.draft', value.text ? draft : undefined) },
    pending: () => intent,
    async send(value) {
      check(); if (sending) throw new LetterError(409, 'REQUEST_IN_PROGRESS')
      const revision = authority
      if (!intent) {
        if (!validDraft(value) || !text(value.text.trim(), 10000)) throw new LetterError(400, 'INVALID_ARGUMENT')
        const replyMode = !value.wantReply ? 'none' : value.when === 'now' ? 'now' : 'next_morning'
        const clientLetterId = crypto.randomUUID()
        intent = { key: clientLetterId, body: { clientLetterId, body: value.text.trim(), replyMode,
          ...(replyMode === 'next_morning' ? { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } : {}), ...(value.sourceMemory ? { sourceMemory: { ...value.sourceMemory } } : {}) } }
        remember('.intent', intent)
      }
      const submitted = intent; sending = true
      try {
        const saved = validateLetter((await request<LetterDTO>(root, revision, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': submitted.key }, body: JSON.stringify(submitted.body) })).data, context.personId)
        check(revision)
        if (saved.clientLetterId !== submitted.body.clientLetterId || saved.body !== submitted.body.body || saved.replyMode !== submitted.body.replyMode || !sameRef(saved.sourceMemory, submitted.body.sourceMemory) || canonicalZone(saved.timeZone) !== canonicalZone(submitted.body.timeZone)) throw invalid()
        intent = undefined; remember('.intent')
        if (draft.text.trim() === submitted.body.body && sameRef(draft.sourceMemory, submitted.body.sourceMemory) && draft.wantReply === (submitted.body.replyMode !== 'none') && (!draft.wantReply || draft.when === (submitted.body.replyMode === 'now' ? 'now' : 'morning'))) { draft = defaultDraft(); remember('.draft') }
        void refresh(true)
        return saved
      } catch (error) {
        if (live() && revision === authority && error instanceof LetterError) {
          if (error.status === 409 && error.code === 'LETTER_MEMORY_SOURCE_CHANGED') { draft = fromIntent(submitted); remember('.draft', draft); intent = undefined; remember('.intent') }
          if (error.code === 'INVALID_ARGUMENT') { intent = undefined; remember('.intent') }
        }
        throw error
      } finally { sending = false }
    },
    refresh: () => refresh(),
    async markRead(shown) {
      if (!live() || acknowledging || shown !== snapshot || shown.status !== 'ready' || shown.readError) return
      const replies = shown.records.flatMap(letter => letter.reply ? [letter.reply] : [])
      const highest = replies.reduce<LetterDTO['reply']>((best, item) => !best || compareReplySequence(item.sequence, best.sequence) > 0 ? item : best, undefined)
      if (!highest || !shown.records.some(letter => letter.unread)) return
      const pending = readIntent ?? { key: crypto.randomUUID(), throughReplyId: highest.id }
      const through = replies.find(reply => reply.id === pending.throughReplyId)
      if (!through) { readIntent = undefined; remember('.read'); return }
      readIntent = pending; remember('.read', pending)
      const revision = authority; acknowledging = true
      try {
        const result = (await request<{ lastReadReplyId: string; readAt: string }>(root + '/read', revision, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.key }, body: JSON.stringify({ throughReplyId: pending.throughReplyId }) })).data
        check(revision)
        if (!uuid.test(result.lastReadReplyId) || !instant(result.readAt)) throw invalid()
        readIntent = undefined; remember('.read')
        reading++; readRunning = undefined
        // Only the acknowledged, actually displayed range is cleared. A newer reply stays unread.
        emit({ ...snapshot, status: 'ready', readError: undefined, records: snapshot.records.map(letter => letter.reply && compareReplySequence(letter.reply.sequence, through.sequence) <= 0 ? { ...letter, unread: false } : letter) })
      } catch (error) { if (live() && revision === authority) emit({ ...snapshot, readError: code(error) }) }
      finally { acknowledging = false }
    },
    invalidate() { if (!live()) return; authority++; reading++; readRunning = undefined; requests.forEach(request => request.abort()); emit({ status: 'loading', records: [] }); void refresh(true) },
    activate() { active = true },
    dispose() { active = false; authority++; reading++; readRunning = undefined; requests.forEach(request => request.abort()) },
  }
  return service
}

export function letterMessage(error: unknown, zh: boolean, mode: 'send' | 'read' = 'send') {
  const value = error instanceof LetterError ? error.code : typeof error === 'string' ? error : ''
  if (mode === 'read') {
    if (value === 'LETTER_STORAGE_PERMISSION_REQUIRED') return zh ? '请到「我」里的「隐私与 AI 说明」同意相关说明，再回来打开信匣。' : 'Agree to the statement in Me → Privacy & AI, then return to open the letterbox.'
    if (value === 'NOT_FOUND') return zh ? '这位人物或信匣已无法打开，请返回后重新选择。' : 'This person or letterbox is unavailable. Go back and choose again.'
    return zh ? '信匣暂时没能打开，请稍后再试。' : 'The letterbox could not be opened. Try again shortly.'
  }
  if (value === 'LETTER_STORAGE_PERMISSION_REQUIRED' || value === 'LETTER_REPLY_PERMISSION_REQUIRED') return zh ? '信的内容已保留。请到「我」里的「隐私与 AI 说明」同意相关说明，再回来封存。' : 'Your letter is kept. Agree to the statement in Me → Privacy & AI, then return to seal it.'
  if (value === 'LETTER_MEMORY_SOURCE_CHANGED') return zh ? '这段珍藏已变更或无法打开。信的内容已保留，可以重新选择原文或移除关联后再封存。' : 'This memory has changed or is unavailable. Your letter is kept. Choose the original again or remove the link before sealing.'
  if (value === 'INVALID_ARGUMENT') return zh ? '请检查信的内容（最多一万字）和送达时间，再试一次。' : 'Check the letter text (up to 10,000 characters) and delivery time, then try again.'
  if (value === 'LETTER_HISTORY_TOO_LARGE') return zh ? '信件较多，这次没能全部打开，请稍后重新打开信匣。' : 'There are many letters, and not all could be opened. Reopen the letterbox later.'
  if (value === 'NOT_FOUND') return zh ? '这位人物或信件已无法打开，请返回后重新选择。' : 'This person or letter is unavailable. Go back and choose again.'
  if (value === 'IDEMPOTENCY_CONFLICT') return zh ? '这封信暂时没能封存，内容已保留。请关闭后重新打开，再试一次。' : 'The letter could not be sealed. Your text is kept. Close and reopen it, then try again.'
  return zh ? '还没收到封存结果，信的内容已保留。请再试一次，不会重复保存。' : 'Sealing has not been confirmed. Your text is kept. Try again; the letter will not be saved twice.'
}
export function letterView(value: LetterDTO, id: number, lang: Lang): Letter {
  return { id, serverId: value.id, serverVersion: value.version, date: fmtDate(lang, new Date(value.createdAt)), text: value.body,
    wantReply: value.replyMode !== 'none', replyAt: value.replyAt ? Date.parse(value.replyAt) : undefined, reply: value.reply?.body, replyNew: value.unread,
    replyState: value.replyJobState, replyFailure: value.failure, timeZone: value.timeZone, ...(value.sourceMemory ? { sourceMemory: value.sourceMemory } : {}) }
}
export function useServiceLetters(context?: LetterContext) {
  const key = context ? JSON.stringify([context.accountId, context.sessionId, context.personId]) : ''
  const latest = useRef({ key, context }); latest.current = { key, context }
  const [view, setView] = useState<{ key: string; snapshot: LetterSnapshot }>({ key: '', snapshot: { status: 'loading', records: [] } })
  const ids = useMemo(() => new Map<string, number>(), [key])
  const service = useMemo(() => context ? createLetterService({ ...context, onUnauthorized: () => latest.current.context?.onUnauthorized() }, snapshot => setView({ key, snapshot }), () => latest.current.key === key) : undefined, [key])
  useEffect(() => {
    if (!service) return
    service.activate()
    const refresh = () => { if (document.visibilityState !== 'hidden') void service.refresh() }
    const changed = () => service.invalidate()
    refresh(); const timer = window.setInterval(refresh, 5000)
    window.addEventListener('focus', refresh); window.addEventListener('xijie:consents-changed', changed); document.addEventListener('visibilitychange', refresh)
    return () => { service.dispose(); window.clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('xijie:consents-changed', changed); document.removeEventListener('visibilitychange', refresh) }
  }, [service])
  const snapshot = view.key === key ? view.snapshot : { status: 'loading' as const, records: [] }
  return { service, snapshot, letters: (lang: Lang) => snapshot.records.map(value => {
    let id = ids.get(value.id); if (id === undefined) { id = nid(); ids.set(value.id, id) }
    return letterView(value, id, lang)
  }) }
}
