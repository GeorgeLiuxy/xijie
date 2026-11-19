import { useEffect, useMemo, useRef, useState } from 'react'
import { isZh, useI18n } from './i18n'
import { nid, type Memory } from './model'

type RemoteMemory = {
  id: string; personId: string; title: string; body: string; origin: string; version: number
  confirmedAt: string; createdAt?: string; updatedAt?: string
  source?: { kind: 'message'; messageId: string } | {kind:'shared_contribution';albumId:string;contributionId:string}
}
export type MemorySearchHit = {
  kind: 'person' | 'memory' | 'world'; id: string; title: string; excerpt?: string
  personId?: string; memoryId?: string; worldId?: string; worldCode?: string; version?: number
}
export type MemorySource = { sourceMessageId: string; sourceMessageVersion: number }
export type MemoryCandidateBinding = { candidateId: string; candidateVersion: number }
export type MemoryCandidate = {
  id: string; personId: string; state: 'ready' | 'consumed' | 'expired' | 'withdrawn'; version: number
  sourceMessageId?: string; title?: string; body?: string; expiresAt: string; consumedByMemoryId?: string
}
export type MemoryGenerationJob = {
  id: string; kind: 'memory_suggestion'; targetId: string
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'canceled'; version: number
  resultRef?: { kind: 'memory_candidate'; id: string }; failure?: { code: string; retryable: boolean }; updatedAt: string
}
export class MemoryCandidateError extends Error {
  constructor(readonly code: string) { super(code) }
}
export type AutomaticMemory = {
  id: string; personId: string; version: number; topic: string; body: string; userCorrected: boolean
  source: { kind: 'profile' | 'message'; excerpt: string; createdAt: string }
}
export type AutomaticMemoryPage = { items: AutomaticMemory[]; nextCursor: string | null }
export type AutomaticMemoryCorrection = { title: string; body: string }
export type MemoryService = {
  read: (personId: string, memory: Memory) => Promise<Memory | undefined>
  save: (personId: string, memory: Memory, source?: MemorySource | MemoryCandidateBinding, intentId?: string) => Promise<Memory | undefined>
  saveGuestOriginal: (personId: string, memory: Memory, clientMemoryId: string) => Promise<Memory | undefined>
  prepareCandidate: (personId: string, source: MemorySource, signal: AbortSignal) => Promise<MemoryCandidate | undefined>
  retryCandidateJob: (personId: string, job: MemoryGenerationJob, signal: AbortSignal) => Promise<MemoryGenerationJob | undefined>
  cancelCandidateJob: (personId: string, job: MemoryGenerationJob, signal: AbortSignal) => Promise<MemoryGenerationJob | undefined>
  update: (personId: string, memory: Memory, draft: Memory) => Promise<Memory | undefined>
  remove: (personId: string, memory: Memory) => Promise<boolean>
  search: (query: string, locale: string, signal: AbortSignal) => Promise<MemorySearchHit[]>
  refresh: (personIds: string[]) => Promise<void>
  report: (message: string) => void
  listAutomatic: (personId: string, cursor: string | null, signal: AbortSignal) => Promise<AutomaticMemoryPage>
  controlAutomatic: (memory: AutomaticMemory, key: string, correction: AutomaticMemoryCorrection | undefined, signal: AbortSignal) => Promise<void>
}
type Context = { sessionId: string; accountId: string; onUnauthorized: () => void }
type Scope = {
  key: string; context: Context; stopped: boolean; requests: Set<AbortController>
  cache: Map<string, Memory[]>; ids: Map<string, number>; reading: Map<string, number>; keys: Map<string, string>
  removed: Set<string>
  candidateJobs: Map<string, string>
  refreshFailures: Map<string, string>
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const emptyRecords: Record<string, Memory[]> = {}
export class MemoryError extends Error { constructor(readonly status: number, readonly code: string) { super(code) } }
type Envelope<T> = { data: T; meta?: { nextCursor?: string | null } }
const same = (a: Memory[], b: Memory[]) => a.length === b.length && a.every((item, index) =>
  item.serverId === b[index].serverId && item.serverVersion === b[index].serverVersion && item.title === b[index].title && item.body === b[index].body
  && JSON.stringify(item.source) === JSON.stringify(b[index].source))

export function useServiceMemories(context?: Context) {
  const { lang } = useI18n(), zh = isZh(lang)
  const key = context ? JSON.stringify([context.accountId, context.sessionId]) : ''
  const rendered = useRef(key); rendered.current = key
  const callbacks = useRef(context); callbacks.current = context
  const [state, setState] = useState<{ key: string; records: Record<string, Memory[]> }>({ key: '', records: {} })
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(null), 3000); return () => clearTimeout(timer) }, [notice])
  const scope = useMemo<Scope | undefined>(() => context ? {
    key, context, stopped: false, requests: new Set(), cache: new Map(), ids: new Map(), reading: new Map(), keys: new Map(), removed: new Set(), candidateJobs: new Map(), refreshFailures: new Map(),
  } : undefined, [key]) // The callbacks are deliberately read through the current render.
  useEffect(() => {
    if (!scope) return
    scope.stopped = false
    return () => { scope.stopped = true; for (const request of scope.requests) request.abort(); scope.requests.clear() }
  }, [scope])
  const service = useMemo<MemoryService | undefined>(() => {
    if (!scope) return
    const live = () => !scope.stopped && rendered.current === scope.key
    const publish = () => {
      if (live()) setState({ key: scope.key, records: Object.fromEntries(scope.cache) })
    }
    const report = (message: string) => { if (live()) setNotice(message) }
    const fail = (error: unknown, writing = false) => {
      if (!live()) return
      report(error instanceof MemoryError && error.code === 'AI_PERMISSION_REQUIRED'
        ? zh ? '如需让 AI 帮你整理，请到「我」的「隐私与 AI 说明」同意说明。你也可以自己填写并保存。' : 'To use AI suggestions, agree to the statement in Me → Privacy & AI. You can also write and save the memory yourself.'
        : error instanceof MemoryError && error.status === 409
        ? zh ? '这段记忆已有变化，请重新打开。填写的内容仍保留。' : 'This memory changed. Reopen it; your input is kept.'
        : error instanceof MemoryError && error.status === 404
          ? zh ? '这段记忆或人物已无法访问，请重新打开。' : 'This memory or person is no longer available.'
          : error instanceof MemoryError && error.status === 403
            ? zh ? '暂时无法查看或保存记忆，请到「我」的「隐私与 AI 说明」查看同意状态。' : 'Memories cannot be viewed or saved right now. Review your agreement in Me → Privacy & AI.'
            : writing ? zh ? '还没能确认记忆是否保存，内容已保留，请重试。' : 'We could not confirm whether the memory was saved. Your input is kept; please retry.'
              : zh ? '暂时无法读取记忆，请稍后重试。' : 'Memories could not be loaded. Try again shortly.')
    }
    async function request<T>(path: string, init?: RequestInit, signal?: AbortSignal): Promise<Envelope<T>> {
      if (!live()) throw new DOMException('Canceled', 'AbortError')
      const controller = new AbortController(), cancel = () => controller.abort()
      scope!.requests.add(controller)
      signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel()
      const timer = window.setTimeout(cancel, 10000)
      try {
        const headers = new Headers(init?.headers); headers.set('X-Xijie-Expected-Session', scope!.context.sessionId)
        const response = await fetch(path, { ...init, headers, signal: controller.signal, credentials: 'same-origin', cache: 'no-store' })
        if (!response.ok) {
          const body = await response.json().catch(() => null)
          if (response.status === 401 && live()) callbacks.current?.onUnauthorized()
          throw new MemoryError(response.status, body?.error?.code ?? 'REQUEST_FAILED')
        }
        const result = await response.json() as Envelope<T>
        if (!live()) throw new DOMException('Canceled', 'AbortError')
        if (result.data == null) throw new MemoryError(502, 'INVALID_RESPONSE')
        return result
      } finally { clearTimeout(timer); scope!.requests.delete(controller); signal?.removeEventListener('abort', cancel) }
    }
    function convert(item: RemoteMemory, personId: string): Memory {
      if (!item || !uuid.test(item.id) || item.personId !== personId || typeof item.title !== 'string' || typeof item.body !== 'string'
        || !Number.isSafeInteger(item.version) || item.version < 1 || !Number.isFinite(Date.parse(item.confirmedAt))) throw new MemoryError(502, 'INVALID_RESPONSE')
      if(item.source&&(item.source.kind==='message'?!uuid.test(item.source.messageId):item.source.kind==='shared_contribution'?(item.origin!=='shared_contribution'||!uuid.test(item.source.albumId)||!uuid.test(item.source.contributionId)):true))throw new MemoryError(502,'INVALID_RESPONSE')
      let id = scope!.ids.get(item.id)
      if (id === undefined) { id = nid(); scope!.ids.set(item.id, id) }
      return { id, serverId: item.id, serverVersion: item.version, personServerId: personId, title: item.title, body: item.body,
        confirmedAt: item.confirmedAt, origin: item.origin, ...(item.source ? { source: item.source } : {}) }
    }
    function apply(personId: string, memory: Memory) {
      if (!live() || memory.serverId && scope!.removed.has(memory.serverId)) return
      const previous = scope!.cache.get(personId) ?? []
      const found = previous.find(item => item.serverId === memory.serverId)
      if (found && (found.serverVersion ?? 0) > (memory.serverVersion ?? 0)) return
      const next = [memory, ...previous.filter(item => item.serverId !== memory.serverId)]
        .sort((a, b) => Date.parse(b.confirmedAt ?? '') - Date.parse(a.confirmedAt ?? '') || (b.serverId ?? '').localeCompare(a.serverId ?? ''))
      scope!.reading.set(personId, (scope!.reading.get(personId) ?? 0) + 1)
      if (!same(previous, next)) { scope!.cache.set(personId, next); publish() }
    }
    function forget(personId: string, memory: Memory, removed = true) {
      if (removed && memory.serverId) scope!.removed.add(memory.serverId)
      scope!.reading.set(personId, (scope!.reading.get(personId) ?? 0) + 1)
      const previous = scope!.cache.get(personId) ?? [], next = previous.filter(item => item.serverId !== memory.serverId)
      if (previous.length !== next.length) { scope!.cache.set(personId, next); publish() }
    }
    const pathFor = (personId: string, memory?: Memory) => '/v1/persons/' + personId + '/memories' + (memory?.serverId ? '/' + memory.serverId : '')
    function operationKey(fingerprint: string) {
      let value = scope!.keys.get(fingerprint)
      if (!value) {
        const storageKey = 'xijie.memory.intent.' + scope!.context.accountId + '.' + fingerprint
        try { const saved = sessionStorage.getItem(storageKey); if (saved && uuid.test(saved)) value = saved } catch { /* A live retry still retains its identity. */ }
        value ??= crypto.randomUUID(); scope!.keys.set(fingerprint, value)
        try { sessionStorage.setItem(storageKey, value) } catch { /* The live scope retains its operation identity. */ }
      }
      return value
    }
    function completeOperation(fingerprint: string) {
      scope!.keys.delete(fingerprint)
      try { sessionStorage.removeItem('xijie.memory.intent.' + scope!.context.accountId + '.' + fingerprint) } catch { /* A confirmed operation no longer needs a retry record. */ }
    }
    const candidateFailure = (code: string) => ['CANDIDATE_EXPIRED', 'CANDIDATE_WITHDRAWN', 'CANDIDATE_CONSUMED', 'CANDIDATE_NOT_READY', 'SOURCE_CHANGED'].includes(code)
    function generation(value: MemoryGenerationJob, personId: string, id?: string) {
      if (!value || !uuid.test(value.id) || id && value.id !== id || value.kind !== 'memory_suggestion' || value.targetId !== personId
        || !['queued', 'running', 'succeeded', 'failed', 'blocked', 'canceled'].includes(value.state)
        || !Number.isSafeInteger(value.version) || value.version < 1 || !Number.isFinite(Date.parse(value.updatedAt))
        || value.resultRef && (value.resultRef.kind !== 'memory_candidate' || !uuid.test(value.resultRef.id))) throw new MemoryError(502, 'INVALID_RESPONSE')
      return value
    }
    const jobPath = (id: string, action = '') => '/v1/generation-jobs/' + id + action + '?kind=memory_suggestion'
    async function jobAction(personId: string, job: MemoryGenerationJob, action: 'retry' | 'cancel', signal: AbortSignal) {
      generation(job, personId)
      const fingerprint = JSON.stringify(['candidate-job', action, job.id, job.version]), id = operationKey(fingerprint)
      const result = generation((await request<MemoryGenerationJob>(jobPath(job.id, '/' + action), {
        method: 'POST', headers: { 'Idempotency-Key': id },
      }, signal)).data, personId, job.id)
      completeOperation(fingerprint)
      return result
    }
    function candidateJobKey(personId: string, source: MemorySource) {
      return JSON.stringify([personId, source.sourceMessageId, source.sourceMessageVersion])
    }
    function rememberJob(key: string, value?: string) {
      if (value) scope!.candidateJobs.set(key, value)
      else scope!.candidateJobs.delete(key)
      try {
        const storage = 'xijie.memory.candidate.job.' + scope!.context.accountId + '.' + key
        if (value) sessionStorage.setItem(storage, value)
        else sessionStorage.removeItem(storage)
      } catch { /* The live scope retains the accepted operation. */ }
    }
    function knownJob(key: string) {
      const liveValue = scope!.candidateJobs.get(key)
      if (liveValue) return liveValue
      try {
        const stored = sessionStorage.getItem('xijie.memory.candidate.job.' + scope!.context.accountId + '.' + key)
        if (stored && uuid.test(stored)) { scope!.candidateJobs.set(key, stored); return stored }
      } catch { /* Storage is optional for an in-flight preparation. */ }
    }
    function pause(signal: AbortSignal) {
      return new Promise<void>((resolve, reject) => {
        if (signal.aborted || !live()) { reject(new DOMException('Canceled', 'AbortError')); return }
        const cancel = () => { clearTimeout(timer); reject(new DOMException('Canceled', 'AbortError')) }
        const timer = window.setTimeout(() => { signal.removeEventListener('abort', cancel); resolve() }, 550)
        signal.addEventListener('abort', cancel, { once: true })
      })
    }
    async function prepareCandidate(personId: string, source: MemorySource, signal: AbortSignal) {
      const cacheKey = candidateJobKey(personId, source)
      try {
        let id = knownJob(cacheKey), existing = !!id
        const fingerprint = JSON.stringify(['candidate', personId, source.sourceMessageId, source.sourceMessageVersion])
        if (!id) {
          const result = (await request<{ generationJobId: string }>('/v1/persons/' + personId + '/memory-candidates', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operationKey(fingerprint) },
            body: JSON.stringify({ sourceMessageId: source.sourceMessageId }),
          }, signal)).data
          if (!result || !uuid.test(result.generationJobId)) throw new MemoryError(502, 'INVALID_RESPONSE')
          id = result.generationJobId
          rememberJob(cacheKey, id)
          completeOperation(fingerprint)
        }
        const deadline = Date.now() + 45000
        let job = generation((await request<MemoryGenerationJob>(jobPath(id), undefined, signal)).data, personId, id)
        // A later explicit opening can retry its original failed task. One opening never loops model retries.
        if (existing && job.state === 'failed' && job.failure?.retryable) job = await jobAction(personId, job, 'retry', signal)
        while (job.state === 'queued' || job.state === 'running') {
          if (Date.now() > deadline) throw new MemoryError(504, 'CANDIDATE_PREPARATION_TIMEOUT')
          await pause(signal)
          job = generation((await request<MemoryGenerationJob>(jobPath(id), undefined, signal)).data, personId, id)
        }
        if (job.state !== 'succeeded' || !job.resultRef) throw new MemoryError(409, job.failure?.code ?? 'CANDIDATE_NOT_READY')
        const result = (await request<MemoryCandidate>('/v1/persons/' + personId + '/memory-candidates/' + job.resultRef.id, undefined, signal)).data
        if (!result || result.id !== job.resultRef.id || result.personId !== personId || !Number.isSafeInteger(result.version) || result.version < 1
          || !['ready', 'consumed', 'expired', 'withdrawn'].includes(result.state) || !Number.isFinite(Date.parse(result.expiresAt))) throw new MemoryError(502, 'INVALID_RESPONSE')
        if (result.state !== 'ready') {
          rememberJob(cacheKey)
          throw new MemoryError(409, 'CANDIDATE_' + result.state.toUpperCase())
        }
        if (result.sourceMessageId !== source.sourceMessageId || typeof result.title !== 'string' || !result.title.trim()
          || typeof result.body !== 'string' || !result.body.trim() || [...result.title].length > 120 || [...result.body].length > 10000) throw new MemoryError(502, 'INVALID_RESPONSE')
        return result
      } catch (error) {
        if (!signal.aborted && live()) {
          if (error instanceof MemoryError && error.status === 404) rememberJob(cacheKey)
          report(error instanceof MemoryError && error.code === 'AI_PERMISSION_REQUIRED'
            ? zh ? '如需让 AI 帮你整理，请到「我」的「隐私与 AI 说明」同意说明。你也可以直接修改并保存这段文字。' : 'AI suggestions are not permitted. Manage this in Me → Settings → Privacy & AI; you can still edit and keep the original text.'
            : zh ? '暂时没能整理，仍可修改并珍藏原文。' : 'The suggestion is unavailable. You can still edit and keep the original text.')
        }
      }
    }
    const validate = (memory: Memory) => {
      const title = memory.title.trim() || Array.from(memory.body.trim()).slice(0, 10).join(''), body = memory.body.trim()
      if (!body || Array.from(title).length > 120 || Array.from(body).length > 10000) {
        report(!body ? zh ? '请写下一段记忆，内容已保留。' : 'Write a memory first. Your input is kept.'
          : zh ? '标题最多120字，正文最多10000字，请调整后重试。' : 'Use up to 120 characters for the title and 10,000 for the memory.')
        return
      }
      return { title, body }
    }
    async function createOriginal(personId: string, values: { title: string; body: string }, id: string, source?: MemorySource | MemoryCandidateBinding) {
      const body = { clientMemoryId: id, ...values, ...source }
      return convert((await request<RemoteMemory>(pathFor(personId), { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': id }, body: JSON.stringify(body) })).data, personId)
    }
    async function refresh(personIds: string[]) {
      await Promise.all(personIds.map(async personId => {
        const version = (scope!.reading.get(personId) ?? 0) + 1; scope!.reading.set(personId, version)
        try {
          const all: Memory[] = [], seen = new Set<string>(); let cursor: string | null = null
          do {
            const query = new URLSearchParams({ include: 'body', limit: '100' }); if (cursor) query.set('cursor', cursor)
            const page = await request<RemoteMemory[]>(pathFor(personId) + '?' + query)
            if (!Array.isArray(page.data)) throw new MemoryError(502, 'INVALID_RESPONSE')
            all.push(...page.data.filter(item => !scope!.removed.has(item.id)).map(item => convert(item, personId))); cursor = page.meta?.nextCursor ?? null
            if (cursor && seen.has(cursor)) throw new MemoryError(502, 'INVALID_RESPONSE'); if (cursor) seen.add(cursor)
          } while (cursor)
          if (!live() || scope!.reading.get(personId) !== version) return
          scope!.refreshFailures.delete(personId)
          if (!same(scope!.cache.get(personId) ?? [], all)) {
            const remaining = new Set(all.map(memory => memory.serverId))
            for (const previous of scope!.cache.get(personId) ?? []) if (previous.serverId && !remaining.has(previous.serverId)) scope!.removed.add(previous.serverId)
            scope!.cache.set(personId, all); publish()
          }
        } catch (error) {
          if (!live() || scope!.reading.get(personId) !== version) return
          if (error instanceof MemoryError && [401, 403, 404].includes(error.status)) {
            scope!.cache.set(personId, []); publish()
            if (error.status !== 404) fail(error)
            return
          }
          // One notice per continuing background failure; keep retrying and retain cached memories.
          const failure = error instanceof MemoryError ? JSON.stringify([error.status, error.code]) : 'REQUEST_FAILED'
          if (scope!.refreshFailures.get(personId) !== failure) {
            scope!.refreshFailures.set(personId, failure); fail(error)
          }
        }
      }))
    }
    return {
      async listAutomatic(personId, cursor, signal) {
        if (!uuid.test(personId)) throw new MemoryError(400, 'INVALID_ARGUMENT')
        const query = new URLSearchParams({ limit: '12', ...(cursor ? { cursor } : {}) })
        const { data, meta } = await request<AutomaticMemory[]>(pathFor(personId) + '/automatic?' + query, undefined, signal)
        if (!Array.isArray(data) || data.length > 12 || new Set(data.map(item => item?.id)).size !== data.length
          || data.some(item => !item || !uuid.test(item.id) || item.personId !== personId
            || !Number.isSafeInteger(item.version) || item.version < 1
            || typeof item.topic !== 'string' || typeof item.body !== 'string' || typeof item.userCorrected !== 'boolean'
            || !item.source || !['profile', 'message'].includes(item.source.kind)
            || typeof item.source.excerpt !== 'string' || !Number.isFinite(Date.parse(item.source.createdAt)))
          || meta?.nextCursor !== null && (typeof meta?.nextCursor !== 'string' || !meta.nextCursor || meta.nextCursor === cursor))
          throw new MemoryError(502, 'INVALID_RESPONSE')
        return { items: data, nextCursor: meta.nextCursor }
      },
      async controlAutomatic(memory, key, correction, signal) {
        if (!uuid.test(memory.personId) || !uuid.test(memory.id) || !uuid.test(key)) throw new MemoryError(400, 'INVALID_ARGUMENT')
        const headers = new Headers({ 'Idempotency-Key': key, 'If-Match': '"v' + memory.version + '"' })
        if (correction) headers.set('Content-Type', 'application/json')
        const { data } = await request<{ id: string; personId: string; version: number; state: 'active' | 'withdrawn' }>(
          pathFor(memory.personId) + '/automatic/' + memory.id,
          { method: correction ? 'PATCH' : 'DELETE', headers, ...(correction ? { body: JSON.stringify(correction) } : {}) }, signal)
        if (data.id !== memory.id || data.personId !== memory.personId || data.version !== memory.version + 1
          || data.state !== (correction ? 'active' : 'withdrawn')) throw new MemoryError(502, 'INVALID_RESPONSE')
      },
      refresh, report, prepareCandidate,
      async retryCandidateJob(personId, job, signal) {
        try { return await jobAction(personId, job, 'retry', signal) } catch (error) { if (!signal.aborted) fail(error) }
      },
      async cancelCandidateJob(personId, job, signal) {
        try { return await jobAction(personId, job, 'cancel', signal) } catch (error) { if (!signal.aborted) fail(error) }
      },
      async read(personId, memory) {
        try {
          const result = convert((await request<RemoteMemory>(pathFor(personId, memory))).data, personId)
          if (scope!.removed.has(result.serverId!)) return
          const current = scope!.cache.get(personId)?.find(item => item.serverId === result.serverId)
          if (current && (current.serverVersion ?? 0) > (result.serverVersion ?? 0)) return current
          apply(personId, result); return result
        }
        catch (error) { if (error instanceof MemoryError && [401, 403, 404].includes(error.status)) forget(personId, memory, error.status === 404); fail(error) }
      },
      async save(personId, memory, source, intentId) {
        const values = validate(memory); if (!values) return
        const fingerprint = JSON.stringify(intentId ? ['create', personId, values, source ?? null, intentId] : ['create', personId, values, source ?? null]), id = operationKey(fingerprint)
        try {
          const result = await createOriginal(personId, values, id, source)
          apply(personId, result); completeOperation(fingerprint); return result
        } catch (error) {
          if (error instanceof MemoryError && source && ('candidateId' in source && candidateFailure(error.code) || error.code === 'SOURCE_CHANGED')) {
            report(zh ? '来源或整理建议已失效，填写的内容已保留。' : 'The source or suggestion is no longer valid. Your input is kept.')
            throw new MemoryCandidateError(error.code)
          }
          fail(error, true)
        }
      },
      async saveGuestOriginal(personId, memory, clientMemoryId) {
        if (!uuid.test(personId) || !uuid.test(clientMemoryId)) return
        const values = validate(memory); if (!values) return
        try {
          const result = await createOriginal(personId, values, clientMemoryId)
          if (result.origin !== 'manual' || result.title !== values.title || result.body !== values.body)
            throw new MemoryError(502, 'INVALID_RESPONSE')
          apply(personId, result)
          return result
        } catch (error) { fail(error, true) }
      },
      async update(personId, memory, draft) {
        const values = validate(draft); if (!values || !memory.serverId || !memory.serverVersion) return
        const id = operationKey(JSON.stringify(['update', personId, memory.serverId, memory.serverVersion, values]))
        try {
          const result = convert((await request<RemoteMemory>(pathFor(personId, memory), { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': id, 'If-Match': '"v' + memory.serverVersion + '"' }, body: JSON.stringify(values) })).data, personId)
          apply(personId, result); return result
        } catch (error) { fail(error, true) }
      },
      async remove(personId, memory) {
        if (!memory.serverId || !memory.serverVersion) return false
        const id = operationKey(JSON.stringify(['remove', personId, memory.serverId, memory.serverVersion]))
        try {
          await request(pathFor(personId, memory), { method: 'DELETE', headers: { 'Idempotency-Key': id, 'If-Match': '"v' + memory.serverVersion + '"' } })
          forget(personId, memory); return true
        } catch (error) { fail(error, true); return false }
      },
      async search(query, locale, signal) {
        const all: MemorySearchHit[] = [], seen = new Set<string>(); let cursor: string | null = null
        do {
          const params = new URLSearchParams({ scope: 'atlas', q: query, limit: '100', locale: locale.startsWith('zh') ? 'zh-CN' : 'en' })
          if (cursor) params.set('cursor', cursor)
          const page = await request<MemorySearchHit[]>('/v1/search?' + params, undefined, signal)
          if (!Array.isArray(page.data) || page.data.some(item => !['person', 'memory', 'world'].includes(item.kind) || !uuid.test(item.id))) throw new MemoryError(502, 'INVALID_RESPONSE')
          all.push(...page.data); cursor = page.meta?.nextCursor ?? null
          if (cursor && seen.has(cursor)) throw new MemoryError(502, 'INVALID_RESPONSE'); if (cursor) seen.add(cursor)
        } while (cursor)
        const missingPeople = [...new Set(all.flatMap(hit => {
          if (hit.kind !== 'memory' || !hit.personId || !hit.memoryId) return []
          const cached = scope!.cache.get(hit.personId)?.find(memory => memory.serverId === hit.memoryId)
          return !cached || hit.version !== undefined && (cached.serverVersion ?? 0) < hit.version ? [hit.personId] : []
        }))]
        if (missingPeople.length) await refresh(missingPeople)
        return all
      },
    }
  }, [scope, zh])
  return { service, records: state.key === key ? state.records : emptyRecords, notice }
}
