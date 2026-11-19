import { useEffect, useRef, useState } from 'react'
import { ConversationError } from './serviceConversations'

export type ConversationAnchor = { conversationId: string; messageId: string }
export type ConversationHit = ConversationAnchor & {
  kind: 'message'; id: string; conversationKind?: 'direct' | 'gather'; personId: string | null; worldId?: string | null; sequence: string; version: number; messageKind: 'text' | 'gift' | 'photo'
  title: string; excerpt: string; author: { kind: 'self' } | { kind: 'persona'; displayName: string; aiGenerated: true }
  createdAt: string; lastActivityAt: string
}
export type SearchSession = { accountId: string; sessionId: string; onUnauthorized: () => void }
type SearchView = { key: string; status: 'idle' | 'loading' | 'ready' | 'error'; hits: ConversationHit[]; error?: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const validCursor = (value: unknown) => value === null || typeof value === 'string' && value.length > 0

export async function readConversationSearch(sessionId: string, q: string, locale: 'zh-CN' | 'en', signal: AbortSignal): Promise<ConversationHit[]> {
  q = q.trim()
  if (!q || [...q].length > 160 || /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(q)) throw new ConversationError(400, 'INVALID_QUERY')
  // A changed result set invalidates the whole page group; never merge revisions.
  for (let attempt = 0; ; attempt++) {
    const hits: ConversationHit[] = [], cursors = new Set<string>(), conversations = new Set<string>()
    let cursor: string | null = null
    try {
      do {
        const query = new URLSearchParams({ scope: 'conversations', q, locale, limit: '100' })
        if (cursor) query.set('cursor', cursor)
        const response = await fetch('/v1/search?' + query, { signal, credentials: 'same-origin', cache: 'no-store', headers: { 'X-Xijie-Expected-Session': sessionId } })
        const body = await response.json()
        if (!response.ok) throw new ConversationError(response.status, body?.error?.code ?? 'REQUEST_FAILED')
        if (!Array.isArray(body.data) || !validCursor(body.meta?.nextCursor)) throw new ConversationError(502, 'INVALID_RESPONSE')
        for (const hit of body.data as ConversationHit[]) {
          if (!hit || hit.kind !== 'message' || !uuid.test(hit.id) || hit.id !== hit.messageId || !uuid.test(hit.conversationId)
            || !(hit.conversationKind === 'gather' ? hit.personId === null && typeof hit.worldId === 'string' && uuid.test(hit.worldId)
              : (hit.conversationKind === undefined || hit.conversationKind === 'direct') && typeof hit.personId === 'string' && uuid.test(hit.personId))
            || !/^[1-9]\d*$/.test(hit.sequence) || !Number.isSafeInteger(hit.version) || hit.version < 1 || !['text', 'gift', 'photo'].includes(hit.messageKind)
            || hit.conversationKind === 'gather' && hit.messageKind !== 'text' || hit.messageKind === 'photo' && hit.author?.kind !== 'self'
            || typeof hit.title !== 'string' || typeof hit.excerpt !== 'string' || !Number.isFinite(Date.parse(hit.createdAt)) || !Number.isFinite(Date.parse(hit.lastActivityAt))
            || !(hit.author?.kind === 'self' || hit.author?.kind === 'persona' && hit.author.aiGenerated === true && typeof hit.author.displayName === 'string')
            || conversations.has(hit.conversationId)) throw new ConversationError(502, 'INVALID_RESPONSE')
          conversations.add(hit.conversationId); hits.push(hit)
        }
        cursor = body.meta.nextCursor
        if (cursor && cursors.has(cursor)) throw new ConversationError(502, 'INVALID_RESPONSE')
        if (cursor) cursors.add(cursor)
      } while (cursor)
      return hits
    } catch (error) {
      if (attempt === 0 && !signal.aborted && error instanceof ConversationError && error.code === 'SOURCE_CHANGED') continue
      throw error
    }
  }
}

export function useConversationSearch(session: SearchSession | undefined, query: string, locale: 'zh-CN' | 'en') {
  const q = query.trim(), key = session && q ? JSON.stringify([session.accountId, session.sessionId, q, locale]) : ''
  const latest = useRef({ key, session }); latest.current = { key, session }
  const [view, setView] = useState<SearchView>({ key: '', status: 'idle', hits: [] })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!key || !session) { setView({ key, status: 'idle', hits: [] }); return }
    let controller: AbortController | undefined, revision = 0, stopped = false, reading = false
    const refresh = () => {
      if (stopped || reading || document.visibilityState === 'hidden') return
      reading = true
      const version = ++revision, request = new AbortController(); controller = request
      const live = () => !stopped && !request.signal.aborted && version === revision && latest.current.key === key
      setView({ key, status: 'loading', hits: [] })
      const timeout = window.setTimeout(() => request.abort(), 15000)
      void readConversationSearch(session.sessionId, q, locale, request.signal).then(hits => {
        if (live()) setView({ key, status: 'ready', hits })
      }).catch(error => {
        if (stopped || version !== revision || latest.current.key !== key) return
        if (error instanceof ConversationError && error.status === 401) latest.current.session?.onUnauthorized()
        setView({ key, status: 'error', hits: [], error: error instanceof ConversationError ? error.code : 'REQUEST_FAILED' })
      }).finally(() => { window.clearTimeout(timeout); if (version === revision) reading = false })
    }
    const changed = () => { revision++; controller?.abort(); reading = false; setView({ key, status: 'loading', hits: [] }); refresh() }
    const timer = window.setTimeout(refresh, 180)
    window.addEventListener('focus', refresh)
    window.addEventListener('xijie:consents-changed', changed)
    document.addEventListener('visibilitychange', refresh)
    return () => { stopped = true; revision++; controller?.abort(); window.clearTimeout(timer); window.removeEventListener('focus', refresh); window.removeEventListener('xijie:consents-changed', changed); document.removeEventListener('visibilitychange', refresh) }
  }, [key, retry])
  return { ...(view.key === key ? view : { key, status: key ? 'loading' as const : 'idle' as const, hits: [] }), retry: () => setRetry(value => value + 1) }
}
