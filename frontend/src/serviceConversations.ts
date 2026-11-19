import { useCallback, useEffect, useRef, useState } from 'react'
import { fmtTime, isZh, useI18n } from './i18n'
import { validateGiftDelivery, validateReceivedGift, type GiftDeliveryDTO, type ReceivedGiftDTO } from './serviceGifts'
import { nid, type Msg, type PostPhoto } from './model'
import { MediaClient, MediaError, validatePostPhoto } from './serviceMedia'
import { ChatPhotoUpload, readChatPhotoIntent, type ChatPhotoIntent } from './serviceChatPhotos'
import type { ReadPrivatePhoto } from './PrivatePhoto'
import { giftMessageText } from './gifts/messageText'
import type { ConversationAnchor } from './serviceConversationSearch'
import type { ChatCaptureClient, CaptureRecord } from './mobile/chatCapture'

export type ConversationTarget = { kind: 'direct'; personId: string } | { kind: 'gather'; worldId: string }
export type ServiceConversation = {
  chatCapture?: ChatCaptureClient
  storyBranchId?: string
  storyBranchName?: string
  sessionId: string
  accountId: string
  anchor?: ConversationAnchor
  onUnauthorized: () => void
  onMissing?: () => void
  onMessages?: (messages: Msg[]) => void
} & ({ personId: string; target?: never } | { target: ConversationTarget; personId?: never })
const targetOf = (service: ServiceConversation): ConversationTarget => service.target ?? { kind: 'direct', personId: service.personId! }
const targetKey = (service: ServiceConversation) => { const target = targetOf(service); return service.storyBranchId?'story:'+service.storyBranchId:target.kind + ':' + (target.kind === 'direct' ? target.personId : target.worldId) }
const conversationPath=(scope:Scope,id:string)=>scope.service.storyBranchId?'/v1/story-branches/'+scope.service.storyBranchId:'/v1/conversations/'+id
const gathering = (service: ServiceConversation) => targetOf(service).kind === 'gather'
export type ConversationSummary = {
  kind: 'direct' | 'gather'
  conversationId: string | null
  personId: string | null
  worldId: string | null
  title: string
  lastCall?: {id:string;mode:'voice';endedAt:string;durationSeconds:number}
  lastMessage: {
    id: string; kind: string; preview: string; createdAt: string
    author?: { kind: 'self' } | { kind: 'persona'; personId?: string; displayName: string; aiGenerated: true }
  } | null
  lastActivityAt: string | null
}
type UnreadLetterReply = { personId: string; letterId: string; createdAt: string }
type Message = {
  inputMode?:'typed'|'transcribed'
  id: string; conversationId: string; sequence: string; kind: 'text' | 'gift' | 'photo'; text: string; photo?: Omit<PostPhoto, 'id'> & { mediaId: string }; gift?: (GiftDeliveryDTO & { deliveryId: string; direction?: 'sent' }) | (ReceivedGiftDTO & { direction: 'received'; receivedGiftId: string }); canSuggestMemory?: boolean
  author: { kind: 'self' } | { kind: 'persona'; personId?: string; displayName: string; aiGenerated: true }
  createdAt: string; version: number; clientMessageId?: string; generationJobId?: string; generationKind?: 'gather_reply' | 'photo_reply' | 'story_reply'; sourceDomain?: 'virtual_action' | 'virtual_context'
}
type Job = {
  id: string; state: 'queued' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'canceled'
  version: number; failure?: { code: string; retryable: boolean }
  kind?: 'gather_reply' | 'photo_reply' | 'story_reply'; replyIds?: string[]
}
type Envelope<T> = { data: T; meta?: { nextCursor?: string | null; afterCursor?: string | null } }
type Intent = { accountId: string; storyBranchId?:string; conversationId?: string; text: string; clientMessageId: string; key: string; target: ConversationTarget; body: { clientMessageId: string; kind: 'text'; text: string; inputMode: 'typed'|'transcribed' } }
type Scope = {
  key: string; service: ServiceConversation; lifetime: AbortController; requests: Set<AbortController>
  conversation?: string; opening?: Promise<string>; openKey: string
  messages: Map<string, Message>; ids: Map<string, number>; removed: Set<string>
  pages: number; older: string | null; after: string | null; readVersion: number; reading?: AbortController
  anchor?: string; olderPages: number; newerPages: number; authorityRevision: number; expanding: boolean
  jobs: Map<string, { terminal: boolean; notify: boolean; kind?: 'gather_reply' | 'photo_reply' | 'story_reply' }>; sending: boolean
  deleteKeys: Map<string, string>; deleting: Set<string>; polling: boolean; intent?: Intent; uiMessages?: Msg[]; inaccessible?: boolean
  replyBaseline?: string; noticedReplies: Set<string>
  canSend?: boolean
  photoUpload?: ChatPhotoUpload; photoNeedsSelection?: boolean; photoCaptureMissing?: boolean
}
type View = { key: string; messages: Msg[]; loading: boolean; sending: boolean; typing: boolean; hasOlder: boolean; hasNewer: boolean; focusServerId?: string; canSend?: boolean; pendingText?: string; pendingInputMode?:'typed'|'transcribed'; pendingPhoto?: boolean; photoNeedsSelection?: boolean; photoCaptureMissing?: boolean }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const emptyView = (key = ''): View => ({ key, messages: [], loading: false, sending: false, typing: false, hasOlder: false, hasNewer: false })

export class ConversationError extends Error {
  constructor(readonly status: number, readonly code: string) { super('The conversation request could not be completed.') }
}
function compareSequence(a: string, b: string) { return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0) }
function validMessage(value: Message, conversation: string, isGather = false) {
  let giftValid = false, photoValid = false
  if (value?.kind === 'photo') { try {
    photoValid = !!value.photo && !!validatePostPhoto({ ...value.photo, id: value.photo.mediaId }) && value.author?.kind === 'self'
      && !!value.clientMessageId && uuid.test(value.clientMessageId) && value.generationKind === 'photo_reply' && value.canSuggestMemory === false
  } catch { return false } }
  if (value?.kind === 'gift') { try {
    const gift = value.gift
    giftValid = !!gift && gift.conversationId === conversation && !value.generationJobId && !value.clientMessageId && value.canSuggestMemory === false
      && (gift.direction === 'received'
        ? validateReceivedGift(gift).id === gift.receivedGiftId && value.author?.kind === 'persona' && value.author.personId === gift.personId && value.author.aiGenerated === true
        : validateGiftDelivery(gift).id === gift.deliveryId && value.author?.kind === 'self')
  } catch { return false } }
  return value && uuid.test(value.id) && value.conversationId === conversation && /^[1-9]\d*$/.test(value.sequence)
    && (!isGather || value.kind === 'text' && (!value.generationJobId || value.generationKind === 'gather_reply'))
    && (value.kind === 'text' && typeof value.text === 'string' && value.text.length > 0 || value.kind === 'gift' && giftValid && value.text === '' || value.kind === 'photo' && photoValid && value.text === '')
    && (value.author?.kind === 'self' || value.author?.kind === 'persona' && value.author.aiGenerated === true && typeof value.author.displayName === 'string'
      && (value.author.personId === undefined || uuid.test(value.author.personId)))
    && Number.isSafeInteger(value.version) && value.version > 0 && Number.isFinite(Date.parse(value.createdAt))
    && (value.generationJobId === undefined || uuid.test(value.generationJobId))
    && (value.sourceDomain === undefined || !isGather && value.kind === 'text' && value.canSuggestMemory === false
      && (value.sourceDomain === 'virtual_action' || value.sourceDomain === 'virtual_context'))
    && (value.generationKind === undefined || !!value.generationJobId && (value.generationKind === 'gather_reply' && value.kind === 'text'
      || value.generationKind === 'photo_reply' && (value.kind === 'photo' || value.kind === 'text' && value.author.kind === 'persona' && value.canSuggestMemory === false)
      || value.generationKind === 'story_reply' && value.kind==='text'&&value.canSuggestMemory===false))
}
async function read<T>(path: string, sessionId: string, signal: AbortSignal, init?: RequestInit): Promise<Envelope<T>> {
  const headers = new Headers(init?.headers)
  headers.set('X-Xijie-Expected-Session', sessionId)
  const response = await fetch(path, { ...init, headers, signal, credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { code?: string } } | null
    throw new ConversationError(response.status, body?.error?.code ?? 'REQUEST_FAILED')
  }
  const body = await response.json() as Envelope<T>
  if (body.data == null) throw new ConversationError(502, 'INVALID_RESPONSE')
  return body
}
export async function readConversationSummaries(sessionId: string, signal: AbortSignal): Promise<ConversationSummary[]> {
  const all: ConversationSummary[] = [], seen = new Set<string>()
  let cursor: string | null = null
  do {
    const query = new URLSearchParams({ limit: '100' })
    if (cursor) query.set('cursor', cursor)
    const page = await read<ConversationSummary[]>('/v1/conversations?' + query, sessionId, signal)
    if (!Array.isArray(page.data)) throw new ConversationError(502, 'INVALID_RESPONSE')
    for (const item of page.data) {
      if (!(item.kind === 'direct' && typeof item.personId === 'string' && uuid.test(item.personId)
        || item.kind === 'gather' && item.personId === null && typeof item.worldId === 'string' && uuid.test(item.worldId) && typeof item.conversationId === 'string') || typeof item.title !== 'string'
        || item.conversationId !== null && !uuid.test(item.conversationId)
        || item.lastActivityAt !== null && !Number.isFinite(Date.parse(item.lastActivityAt))
        || item.lastCall!==undefined&&(item.kind!=='direct'||!uuid.test(item.lastCall.id)||item.lastCall.mode!=='voice'||!Number.isFinite(Date.parse(item.lastCall.endedAt))||!Number.isSafeInteger(item.lastCall.durationSeconds)||item.lastCall.durationSeconds<0)
        || item.lastMessage !== null && (typeof item.lastMessage?.preview !== 'string' || !uuid.test(item.lastMessage.id)
          || !Number.isFinite(Date.parse(item.lastMessage.createdAt)))) {
        throw new ConversationError(502, 'INVALID_RESPONSE')
      }
      all.push(item)
    }
    cursor = page.meta?.nextCursor ?? null
    if (cursor && seen.has(cursor)) throw new ConversationError(502, 'INVALID_RESPONSE')
    if (cursor) seen.add(cursor)
  } while (cursor)
  return all
}

export async function readUnreadLetterReply(sessionId: string, signal: AbortSignal): Promise<UnreadLetterReply | undefined> {
  const { data } = await read<UnreadLetterReply[]>('/v1/conversations/letters/unread', sessionId, signal)
  if (!Array.isArray(data) || data.length > 1) throw new ConversationError(502, 'INVALID_RESPONSE')
  if (!data.length) return undefined
  const item = data[0]
  if (!item || typeof item.personId !== 'string' || !uuid.test(item.personId) || typeof item.letterId !== 'string' || !uuid.test(item.letterId)
    || typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt))) throw new ConversationError(502, 'INVALID_RESPONSE')
  return { personId: item.personId, letterId: item.letterId, createdAt: item.createdAt }
}

export function useUnreadLetterReply(sessionId?: string, onUnauthorized?: () => void) {
  const latest = useRef({ sessionId, scope: {}, onUnauthorized })
  const scope = latest.current.sessionId === sessionId ? latest.current.scope : {}
  latest.current = { sessionId, scope, onUnauthorized }
  const [view, setView] = useState<{ scope: object; item?: UnreadLetterReply }>()
  useEffect(() => {
    if (!sessionId) return
    let active = true
    let pending: AbortController | undefined
    const refresh = () => {
      if (!active || pending || latest.current.scope !== scope || document.visibilityState === 'hidden') return
      const request = new AbortController()
      pending = request
      const current = () => active && !request.signal.aborted && pending === request && latest.current.scope === scope
      const timeout = window.setTimeout(() => {
        if (current()) setView({ scope })
        request.abort()
      }, 8000)
      void readUnreadLetterReply(sessionId, request.signal).then(item => {
        if (current()) setView({ scope, item })
      }).catch(error => {
        if (!current()) return
        setView({ scope })
        if (error instanceof ConversationError && error.status === 401) latest.current.onUnauthorized?.()
      }).finally(() => {
        window.clearTimeout(timeout)
        if (pending === request) pending = undefined
      })
    }
    const invalidate = () => {
      pending?.abort(); pending = undefined
      setView({ scope }); refresh()
    }
    refresh()
    const timer = window.setInterval(refresh, 10000)
    window.addEventListener('focus', refresh)
    window.addEventListener('xijie:consents-changed', invalidate)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      active = false; pending?.abort(); window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('xijie:consents-changed', invalidate)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [sessionId, scope])
  return view?.scope === scope ? view?.item : undefined
}

const intentKey = (service: ServiceConversation) => 'xijie.chat.intent.' + service.accountId + '.' + (service.storyBranchId||gathering(service) ? targetKey(service) : (targetOf(service) as { personId: string }).personId)
function readIntent(service: ServiceConversation): Intent | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(intentKey(service)) ?? 'null') as Intent | null
    if (!value || typeof value.text !== 'string' || !value.text.trim() || [...value.text].length > 4000 || !uuid.test(value.clientMessageId)
      || value.accountId !== undefined && value.accountId !== service.accountId
      || value.storyBranchId !== service.storyBranchId
      || value.conversationId !== undefined && !uuid.test(value.conversationId)) return
    // Older direct sends stored only text and clientMessageId. Keep that exact operation when upgrading.
    const legacyDirect = !service.storyBranchId && !gathering(service) && value.key === undefined && value.target === undefined && value.body === undefined
      && value.accountId === undefined && value.conversationId === undefined
    if (!legacyDirect && (value.key !== value.clientMessageId || JSON.stringify(value.target) !== JSON.stringify(targetOf(service))
      || value.body?.clientMessageId !== value.clientMessageId || value.body.kind !== 'text' || !['typed','transcribed'].includes(value.body.inputMode)
      || value.body.text !== value.text)) return
    return { ...value, accountId: service.accountId, key: value.clientMessageId, target: targetOf(service),
      body: value.body ?? { clientMessageId: value.clientMessageId, kind: 'text', text: value.text, inputMode: 'typed' } }
  } catch { /* An unavailable browser store does not establish an identity. */ }
}
function saveIntent(scope: Scope, intent?: Intent) {
  scope.intent = intent
  try {
    if (intent) sessionStorage.setItem(intentKey(scope.service), JSON.stringify(intent))
    else sessionStorage.removeItem(intentKey(scope.service))
  } catch { /* The live scope retains retry identity when browser storage is unavailable. */ }
}

export function useServiceConversation(service?: ServiceConversation, onNewReply?: (message: Msg) => void) {
  const { lang } = useI18n()
  const zh = isZh(lang)
  const key = service ? JSON.stringify([service.accountId, targetKey(service), service.sessionId, lang, service.anchor]) : ''
  const current = useRef<Scope | null>(null)
  const callbacks = useRef(service)
  callbacks.current = service
  const replyCallback = useRef(onNewReply)
  replyCallback.current = onNewReply
  const [view, setView] = useState<View>(() => emptyView(key))
  const [feedback, setFeedback] = useState<{ id: number; text: string; placement: 'toast' | 'composer' } | null>(null)
  const [support, setSupport] = useState<{ scopeKey: string; jobId: string } | null>(null)
  const feedbackId = useRef(0)
  const live = (scope: Scope) => current.current === scope && !scope.lifetime.signal.aborted
    && callbacks.current?.accountId === scope.service.accountId && targetKey(callbacks.current) === targetKey(scope.service)
    && callbacks.current?.sessionId === scope.service.sessionId
    && callbacks.current?.anchor?.messageId === scope.service.anchor?.messageId
    && callbacks.current?.anchor?.conversationId === scope.service.anchor?.conversationId
  const notify = (scope: Scope, text: string, placement: 'toast' | 'composer' = 'toast') => {
    if (live(scope)) setFeedback({ id: ++feedbackId.current, text, placement })
  }
  const clearFeedback = useCallback(() => setFeedback(null), [])

  function fail(scope: Scope, error: unknown, sending = false) {
    if (!live(scope)) return
    const report = (text: string) => notify(scope, text, sending ? 'composer' : 'toast')
    if (error instanceof MediaError) error = new ConversationError(error.status, error.code)
    if (error instanceof ConversationError && error.status === 401) {
      callbacks.current?.onUnauthorized()
      report(zh ? '登录已失效，输入仍保留，请重新登录。' : 'Your session expired. Your input is kept; sign in again.')
    } else if (error instanceof ConversationError && error.status === 404) {
      report(zh ? '这位人物或消息已无法访问，请返回后重新打开。' : 'This person or message is no longer available. Reopen the conversation.')
    } else if (error instanceof ConversationError && ['CHAT_PHOTO_STORAGE_PERMISSION_REQUIRED', 'CHAT_IMAGE_REPLY_PERMISSION_REQUIRED'].includes(error.code)) {
      notify(scope, zh ? '照片发送暂未完成，文字已保留。请到「我」里的「隐私与 AI 说明」同意相关说明，再回来继续。' : 'Photo sending is not complete, and your text is kept. Agree to the statement in Me → Privacy & AI, then return to continue.')
    } else if (error instanceof ConversationError && error.code === 'PHOTO_INTENT_PENDING') {
      notify(scope, zh ? '上一张照片还没收到发送结果，请先重新选择那张照片，再试一次。' : 'Sending the previous photo has not been confirmed. Select that photo again to retry.')
    } else if (error instanceof ConversationError && error.code === 'GATHER_PERMISSION_REQUIRED') {
      report(zh ? '输入已保留。请到「我」里的「隐私与 AI 说明」同意相关说明，再回来发送。' : 'Your text is kept. Agree to the statement in Me → Privacy & AI, then return to send it.')
    } else if (error instanceof ConversationError && error.code === 'GATHER_UNAVAILABLE') {
      report(zh ? '现在还不能围坐，输入已保留。请等这里至少有两位人物后再试。' : 'This gathering is not available. Your input is kept; try when at least two characters are here.')
    } else if (error instanceof ConversationError && error.code === 'AI_PERMISSION_REQUIRED') {
      report(zh ? '输入已保留。请到「我」里的「隐私与 AI 说明」同意相关说明，再回来发送。' : 'Your text is kept. Agree to the statement in Me → Privacy & AI, then return to send it.')
    } else if (error instanceof ConversationError && error.code === 'WORLD_ACTION_PERMISSION_REQUIRED') {
      notify(scope, zh ? '消息已保存。请在「隐私与 AI 说明」确认故事行动授权，再重新发起行动。' : 'Message saved. Review story action permissions in Privacy & AI before requesting the action again.', 'composer')
    } else if (error instanceof ConversationError && error.code === 'WORLD_EVENT_CONTEXT_CHANGED') {
      notify(scope, zh ? '故事经历已更新，这次未生成回复，消息已保存。' : 'The story has changed. Your message is saved and no reply was generated.', 'composer')
    } else if (error instanceof ConversationError && error.code === 'STORAGE_PERMISSION_REQUIRED') {
      report(zh ? '输入已保留。请到「我」里的「隐私与 AI 说明」同意相关说明，再回来发送。' : 'Your text is kept. Agree to the statement in Me → Privacy & AI, then return to send it.')
    } else if (error instanceof ConversationError && error.status === 403) {
      report(zh ? '这次操作暂时无法完成，请返回后重新打开对话。' : 'This action is unavailable. Go back and reopen the conversation.')
    } else if (sending && error instanceof ConversationError && error.status === 400) {
      report(zh ? '文字最多 4000 个字，请检查内容后重试。' : 'Messages can contain up to 4,000 characters. Check your text and retry.')
    } else {
      report(sending
        ? zh ? '发送结果尚未确认，输入已保留，请重试。' : 'Sending is not confirmed. Your input is kept; retry.'
        : zh ? '暂时无法读取对话，请稍后重试。' : 'The conversation could not be loaded. Try again shortly.')
    }
  }

  async function api<T>(scope: Scope, path: string, init?: RequestInit, external?: AbortController) {
    if (!live(scope)) throw new DOMException('Canceled', 'AbortError')
    const controller = external ?? new AbortController()
    scope.requests.add(controller)
    const timeout = window.setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), 10_000)
    try { return await read<T>(path, scope.service.sessionId, controller.signal, init) }
    finally { window.clearTimeout(timeout); scope.requests.delete(controller) }
  }

  function publish(scope: Scope, loading = false) {
    if (!live(scope)) return
    const messages = [...scope.messages.values()].filter(message => !scope.removed.has(message.id))
      .sort((a, b) => compareSequence(a.sequence, b.sequence)).map<Msg>(message => {
        let id = scope.ids.get(message.id)
        if (id === undefined) { id = nid(); scope.ids.set(message.id, id) }
        if (message.kind === 'gift' && message.gift) return { id, kind: 'gift', owner: 'account.' + scope.service.accountId, direction: message.gift.direction === 'received' ? 'received' : 'sent', giftId: message.gift.direction === 'received' ? message.gift.receivedGiftId : message.gift.deliveryId,
          text: giftMessageText(message.gift.direction === 'received' ? 'received' : 'sent', message.gift.giftSnapshot, message.gift.quantity, message.gift.note, zh), time: fmtTime(lang, new Date(message.createdAt)), at: Date.parse(message.createdAt),
          serverId: message.id, serverVersion: message.version, sequence: message.sequence }
        if (message.kind === 'photo' && message.photo) return {
          id, kind: 'photo', photo: { ...message.photo, id: message.photo.mediaId }, time: fmtTime(lang, new Date(message.createdAt)), at: Date.parse(message.createdAt),
          serverId: message.id, serverVersion: message.version, sequence: message.sequence, generationJobId: message.generationJobId, generationKind: 'photo_reply', canSuggestMemory: false,
        }
        return {
          id, kind: message.author.kind === 'self' ? 'me' : 'him', text: message.text,
          ...(message.author.kind==='self'&&message.inputMode==='transcribed'?{voice:true}:{}),
          time: fmtTime(lang, new Date(message.createdAt)), at: Date.parse(message.createdAt),
          serverId: message.id, serverVersion: message.version, sequence: message.sequence, generationJobId: message.generationJobId,
          generationKind: message.generationKind, canSuggestMemory: message.canSuggestMemory, sourceDomain: message.sourceDomain,
          ...(gathering(scope.service) && message.author.kind === 'persona' ? { speakerDisplayName: message.author.displayName, speakerPersonId: message.author.personId } : {}),
        }
      })
    const previous = scope.uiMessages
    const same = previous && previous.length === messages.length && previous.every((message, index) =>
      message.serverId === messages[index].serverId && message.serverVersion === messages[index].serverVersion
      && message.kind === messages[index].kind && message.generationKind === messages[index].generationKind && message.canSuggestMemory === messages[index].canSuggestMemory && message.sourceDomain === messages[index].sourceDomain
      && ('text' in message && 'text' in messages[index] && message.text === messages[index].text
        || message.kind === 'photo' && messages[index].kind === 'photo' && JSON.stringify(message.photo) === JSON.stringify(messages[index].photo)) && message.at === messages[index].at
      && (message.kind !== 'him' || messages[index].kind !== 'him' || message.speakerDisplayName === messages[index].speakerDisplayName && message.speakerPersonId === messages[index].speakerPersonId))
    const visible = same ? previous : messages
    scope.uiMessages = visible
    const typing = [...scope.jobs.values()].some(job => !job.terminal), hasOlder = !!scope.older, hasNewer = !!scope.anchor && !!scope.after
    const target = targetOf(scope.service)
    const pendingPhoto = target.kind === 'direct' && !!(scope.photoUpload?.intent ?? readChatPhotoIntent(scope.service.accountId, target.personId))
    setView(previous => previous.key === scope.key && previous.messages === visible && previous.loading === loading
      && previous.sending === scope.sending && previous.typing === typing && previous.hasOlder === hasOlder && previous.hasNewer === hasNewer && previous.focusServerId === scope.anchor
      && previous.canSend === scope.canSend && previous.pendingText === scope.intent?.text && previous.pendingInputMode===scope.intent?.body.inputMode
      && previous.pendingPhoto === pendingPhoto && previous.photoNeedsSelection === scope.photoNeedsSelection && previous.photoCaptureMissing === scope.photoCaptureMissing
      ? previous : { key: scope.key, messages: visible, loading, sending: scope.sending, typing, hasOlder, hasNewer, focusServerId: scope.anchor, canSend: scope.canSend, pendingText: scope.intent?.text, pendingInputMode:scope.intent?.body.inputMode, pendingPhoto, photoNeedsSelection: scope.photoNeedsSelection, photoCaptureMissing: scope.photoCaptureMissing })
    if (!same) callbacks.current?.onMessages?.(visible)
    if (!scope.anchor && scope.replyBaseline !== undefined) for (const message of visible) {
      if (message.kind !== 'him' || !message.serverId || !message.sequence || !message.generationJobId
        || compareSequence(message.sequence, scope.replyBaseline) <= 0 || scope.noticedReplies.has(message.serverId)) continue
      scope.noticedReplies.add(message.serverId)
      replyCallback.current?.(message)
    }
  }

  function hide(scope: Scope) {
    scope.messages.clear(); scope.jobs.clear(); scope.older = null; scope.inaccessible = true
    publish(scope)
    callbacks.current?.onMissing?.()
  }

  function recent(scope: Scope) {
    scope.anchor = undefined; scope.olderPages = 0; scope.newerPages = 0; scope.pages = 1
    scope.older = null; scope.after = null
  }

  type Detail = { id: string; kind?: 'direct' | 'gather'; worldId?: string; personId?: string | null; canSend?: boolean; version?: number }
  function acceptDetail(scope: Scope, detail: Detail) {
    const target = targetOf(scope.service)
    if (!uuid.test(detail.id) || target.kind === 'direct' && (detail.kind !== 'direct' || detail.personId !== target.personId)
      || target.kind === 'gather' && (detail.kind !== 'gather' || detail.worldId !== target.worldId
      || detail.personId !== null || typeof detail.canSend !== 'boolean' || !Number.isSafeInteger(detail.version) || detail.version! < 1)) throw new ConversationError(502, 'INVALID_RESPONSE')
    scope.canSend = detail.canSend
  }
  async function conversation(scope: Scope): Promise<string> {
    if (scope.conversation) return scope.conversation
    if(scope.service.storyBranchId){
      if(!uuid.test(scope.service.storyBranchId))throw new ConversationError(400,'INVALID_ARGUMENT')
      if(!scope.opening)scope.opening=api<{id:string;personId:string;conversationId:string;canSend:boolean}>(scope,conversationPath(scope,''))
        .then(({data})=>{const target=targetOf(scope.service);if(data.id!==scope.service.storyBranchId||target.kind!=='direct'||data.personId!==target.personId||!uuid.test(data.conversationId)||typeof data.canSend!=='boolean')throw new ConversationError(502,'INVALID_RESPONSE');scope.conversation=data.conversationId;scope.canSend=data.canSend;return data.conversationId}).finally(()=>{scope.opening=undefined})
      return scope.opening
    }
    if (!scope.opening) scope.opening = api<Detail>(scope, '/v1/conversations', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': scope.openKey },
      body: JSON.stringify(targetOf(scope.service)),
    }).then(result => {
      acceptDetail(scope, result.data)
      scope.conversation = result.data.id
      if (scope.anchor && scope.service.anchor?.conversationId !== result.data.id) {
        recent(scope)
        notify(scope, zh ? '这条消息已无法访问，已返回当前会话。' : 'This message is no longer available. Showing the current conversation.')
      }
      return result.data.id
    }).finally(() => { scope.opening = undefined })
    return scope.opening
  }

  async function history(scope: Scope, loading = false) {
    const authority = scope.authorityRevision
    const id = await conversation(scope)
    if (gathering(scope.service)) {
      const detail = (await api<Detail>(scope, '/v1/conversations/' + id)).data
      if (detail.id !== id) throw new ConversationError(502, 'INVALID_RESPONSE')
      acceptDetail(scope, detail)
    }
    if (!live(scope) || authority !== scope.authorityRevision) return
    scope.reading?.abort()
    const controller = new AbortController()
    scope.reading = controller
    const version = ++scope.readVersion
    if (loading) setView(previous => previous.key === scope.key ? { ...previous, loading: true } : { ...emptyView(scope.key), loading: true })
    const rows = new Map<string, Message>(), seen = new Set<string>()
    let cursor: string | null = null, after: string | null = null
    if (scope.anchor) {
      const anchor = scope.anchor
      let context: { anchorMessageId: string; items: Message[]; beforeCursor: string | null; afterCursor: string | null }
      try {
        context = (await api<typeof context>(scope, '/v1/conversations/' + id + '/messages/' + anchor + '/context?limit=50', undefined, controller)).data
      } catch (error) {
        if (!live(scope) || version !== scope.readVersion || controller.signal.aborted) return
        if (!(error instanceof ConversationError) || ![403, 404].includes(error.status)) throw error
        recent(scope)
        notify(scope, zh ? '这条消息已无法访问，已返回当前会话。' : 'This message is no longer available. Showing the current conversation.')
        await history(scope, loading)
        return
      }
      const validCursor = (value: unknown) => value === null || typeof value === 'string' && value.length > 0
      if (context.anchorMessageId !== anchor || !Array.isArray(context.items) || !context.items.some(message => message.id === anchor)
        || context.items.some(message => !validMessage(message, id, gathering(scope.service))) || !validCursor(context.beforeCursor) || !validCursor(context.afterCursor)) throw new ConversationError(502, 'INVALID_RESPONSE')
      context.items.forEach(message => { if (!scope.removed.has(message.id)) rows.set(message.id, message) })
      cursor = context.beforeCursor; after = context.afterCursor
      // Rebuild the same bounded window on poll. Expansions always continue the context's cursors.
      for (const direction of ['older', 'newer'] as const) {
        let edge = direction === 'older' ? cursor : after
        const count = direction === 'older' ? scope.olderPages : scope.newerPages
        for (let index = 0; edge && index < count; index++) {
          if (seen.has(edge)) throw new ConversationError(502, 'INVALID_RESPONSE')
          seen.add(edge)
          const query = new URLSearchParams({ direction, limit: '50', cursor: edge })
          const result = await api<Message[]>(scope, conversationPath(scope,id) + '/messages?' + query, undefined, controller)
          if (!Array.isArray(result.data) || result.data.some(message => !validMessage(message, id, gathering(scope.service)))) throw new ConversationError(502, 'INVALID_RESPONSE')
          result.data.forEach(message => { if (!scope.removed.has(message.id)) rows.set(message.id, message) })
          edge = result.meta?.nextCursor ?? null
        }
        if (direction === 'older') cursor = edge
        else after = edge
      }
    } else for (let index = 0; index < scope.pages; index++) {
      const query = new URLSearchParams({ direction: 'older', limit: '50' })
      if (cursor) query.set('cursor', cursor)
      const result = await api<Message[]>(scope, conversationPath(scope,id) + '/messages?' + query, undefined, controller)
      if (!Array.isArray(result.data) || result.data.some(message => !validMessage(message, id, gathering(scope.service)))) throw new ConversationError(502, 'INVALID_RESPONSE')
      result.data.forEach(message => { if (!scope.removed.has(message.id)) rows.set(message.id, message) })
      if (index === 0) after = result.meta?.afterCursor ?? null
      cursor = result.meta?.nextCursor ?? null
      if (!cursor) break
      if (seen.has(cursor)) throw new ConversationError(502, 'INVALID_RESPONSE')
      seen.add(cursor)
    }
    if (!live(scope) || version !== scope.readVersion || controller.signal.aborted) return
    scope.messages = rows
    scope.older = cursor
    scope.after = after
    const ordered = [...rows.values()].sort((a, b) => compareSequence(a.sequence, b.sequence))
    if (scope.replyBaseline === undefined) scope.replyBaseline = ordered[ordered.length - 1]?.sequence ?? '0'
    const latestSelf = [...ordered].reverse().find(message => message.author.kind === 'self')
    for (const message of ordered) if (message.generationJobId && !scope.jobs.has(message.generationJobId)) {
      scope.jobs.set(message.generationJobId, { terminal: false, notify: message.id === latestSelf?.id, kind: message.generationKind })
    }
    publish(scope)
  }

  async function newer(scope: Scope) {
    if (scope.anchor) { await history(scope); return }
    if (!scope.after) { await history(scope); return }
    const id = await conversation(scope)
    scope.reading?.abort()
    const controller = new AbortController()
    scope.reading = controller
    const version = ++scope.readVersion
    let cursor: string | null = scope.after, after = scope.after
    const rows: Message[] = [], seen = new Set<string>()
    while (cursor) {
      if (seen.has(cursor)) throw new ConversationError(502, 'INVALID_RESPONSE')
      seen.add(cursor)
      const query: URLSearchParams = new URLSearchParams({ direction: 'newer', limit: '50', cursor })
      const result: Envelope<Message[]> = await api<Message[]>(scope, conversationPath(scope,id) + '/messages?' + query, undefined, controller)
      if (!Array.isArray(result.data) || result.data.some(message => !validMessage(message, id, gathering(scope.service)))) throw new ConversationError(502, 'INVALID_RESPONSE')
      rows.push(...result.data)
      after = result.meta?.afterCursor ?? after
      cursor = result.meta?.nextCursor ?? null
    }
    if (!live(scope) || version !== scope.readVersion || controller.signal.aborted) return
    for (const message of rows) if (!scope.removed.has(message.id)) scope.messages.set(message.id, message)
    scope.after = after
    publish(scope)
  }

  async function jobs(scope: Scope) {
    const authority = scope.authorityRevision
    let committed = false
    // Keep provider status requests bounded even when loading a long transcript for the first time.
    const pending = [...scope.jobs].filter(([, state]) => !state.terminal)
    for (let offset = 0; offset < pending.length; offset += 4) {
      await Promise.all(pending.slice(offset, offset + 4).map(async ([id, status]) => {
        try {
          const kind = status.kind ?? (gathering(scope.service) ? 'gather_reply' : undefined)
          const result = await api<Job>(scope, scope.service.storyBranchId?'/v1/story-generation-jobs/'+id:'/v1/generation-jobs/' + id + (kind ? '?kind=' + kind : ''))
          if (!live(scope) || authority !== scope.authorityRevision) return
          const job = result.data
          if (job.id !== id || !['queued', 'running', 'succeeded', 'failed', 'blocked', 'canceled'].includes(job.state)
            || kind === 'gather_reply' && (job.kind !== 'gather_reply' || !Array.isArray(job.replyIds) || job.replyIds.some(value => !uuid.test(value)))
            || kind === 'photo_reply' && job.kind !== 'photo_reply' || scope.service.storyBranchId&&job.kind!=='story_reply') throw new ConversationError(502, 'INVALID_RESPONSE')
          if (job.state !== 'queued' && job.state !== 'running') {
            status.terminal = true
            if (job.state === 'succeeded') committed = true
            if (job.state === 'blocked' && job.failure?.code === 'SELF_HARM_SUPPORT_REQUIRED') {
              if (status.notify && !scope.service.storyBranchId && !gathering(scope.service)) setSupport({ scopeKey: scope.key, jobId: id })
              return
            }
            const worldFailure = job.failure?.code === 'WORLD_ACTION_PERMISSION_REQUIRED' || job.failure?.code === 'WORLD_EVENT_CONTEXT_CHANGED'
            if (status.notify && worldFailure && (job.state === 'failed' || job.state === 'blocked')) {
              fail(scope, new ConversationError(409, job.failure!.code))
              return
            }
            if (status.notify && (job.state === 'failed' || job.state === 'blocked')) {
              const code = job.failure?.code
              notify(scope, ['AI_PERMISSION_REQUIRED','AUTHORIZATION_CHANGED','PRODUCTION_MODEL_PERMISSION_REQUIRED'].includes(code ?? '')
                ? zh ? '消息已保存，这次回复已停止。请到「我」里的「隐私与 AI 说明」确认同意状态，之后可重新开始对话。' : 'Your message is saved, but this reply stopped. Review your agreement in Me → Privacy & AI before starting a new exchange.'
                : ['MODEL_NOT_CONFIGURED','MODEL_EXECUTION_UNAVAILABLE'].includes(code ?? '')
                  ? zh ? '消息已保存，TA 暂时无法回复。' : 'Message saved. AI replies are currently unavailable.'
                  : code === 'MODEL_BUDGET_EXCEEDED'
                    ? zh ? '消息已保存，目前暂时无法继续 AI 对话，请稍后再试。' : 'Your message is saved. More AI exchanges cannot start right now; please try again later.'
                    : zh ? '消息已保存，但这次未能生成回复。稍后可以继续聊天。' : 'Your message is saved, but this reply could not be generated. You can continue chatting later.', 'composer')
            }
          }
        } catch (error) {
          if (!live(scope) || authority !== scope.authorityRevision) return
          if (error instanceof ConversationError && error.status === 404) status.terminal = true
          else if (error instanceof ConversationError && error.status === 401) fail(scope, error)
        }
      }))
    }
    if (live(scope) && authority === scope.authorityRevision) {
      if (committed) await newer(scope)
      else publish(scope)
    }
  }

  useEffect(() => {
    if (!service) { current.current = null; setView(emptyView()); return }
    const scope: Scope = {
      key, service, lifetime: new AbortController(), requests: new Set(), openKey: crypto.randomUUID(),
      messages: new Map(), ids: new Map(), removed: new Set(), pages: 1, older: null, after: null,
      anchor: service.anchor?.messageId, olderPages: 0, newerPages: 0, authorityRevision: 0, expanding: false,
      readVersion: 0, jobs: new Map(), sending: false, deleteKeys: new Map(), deleting: new Set(), polling: false,
      intent: readIntent(service),
      noticedReplies: new Set(),
    }
    current.current = scope
    setFeedback(null)
    setView({ ...emptyView(key), loading: true, pendingText: scope.intent?.text,pendingInputMode:scope.intent?.body.inputMode })
    let timer = 0
    async function tick(initial = false) {
      if (!live(scope) || scope.polling || scope.inaccessible) return
      if (scope.expanding) { timer = window.setTimeout(() => { void tick() }, 2000); return }
      if (!initial && document.visibilityState === 'hidden') { timer = window.setTimeout(() => { void tick() }, 2000); return }
      scope.polling = true
      const authority = scope.authorityRevision
      try { await history(scope, initial); if (live(scope)) await jobs(scope) }
      catch (error) { if (live(scope) && authority === scope.authorityRevision && !(error instanceof DOMException && error.name === 'AbortError')) {
        if (error instanceof ConversationError && (error.status === 404 || error.status === 401)) hide(scope)
        else if (error instanceof ConversationError && error.status === 403) { scope.messages.clear(); scope.jobs.clear(); scope.older = null; scope.after = null }
        fail(scope, error); publish(scope)
      } }
      finally {
        scope.polling = false
        if (live(scope) && !scope.inaccessible) timer = window.setTimeout(() => { void tick() }, 2000)
      }
    }
    const focus = () => { if (document.visibilityState !== 'hidden') { window.clearTimeout(timer); void tick() } }
    void tick(true)
    window.addEventListener('focus', focus)
    const changed = () => {
      scope.authorityRevision++; scope.readVersion++; scope.reading?.abort()
      scope.photoUpload?.dispose(); scope.photoUpload = undefined; scope.photoNeedsSelection = false; scope.photoCaptureMissing = false
      scope.messages.clear(); scope.jobs.clear(); scope.older = null; scope.after = null
      publish(scope); focus()
    }
    window.addEventListener('xijie:consents-changed', changed)
    document.addEventListener('visibilitychange', focus)
    return () => {
      scope.lifetime.abort()
      scope.photoUpload?.dispose()
      scope.requests.forEach(request => request.abort())
      window.clearTimeout(timer)
      window.removeEventListener('focus', focus)
      window.removeEventListener('xijie:consents-changed', changed)
      document.removeEventListener('visibilitychange', focus)
      if (current.current === scope) current.current = null
    }
  }, [key]) // The scope is owned by the verified account, person and session, never by callback identity.

  const readPhoto: ReadPrivatePhoto = useCallback(async (localId, photo, signal) => {
    const scope = current.current
    if (!scope || !live(scope) || gathering(scope.service)) throw new DOMException('Canceled', 'AbortError')
    const authority = scope.authorityRevision
    const message = [...scope.messages.values()].find(item => scope.ids.get(item.id) === localId)
    if (!message || message.kind !== 'photo' || message.photo?.mediaId !== photo.id || message.photo.version !== photo.version || !message.clientMessageId
      || scope.removed.has(message.id)) throw new MediaError(404, 'NOT_FOUND')
    const sourceLive = () => live(scope) && scope.authorityRevision === authority && !scope.removed.has(message.id) && scope.messages.get(message.id)?.version === message.version
    const reader = new MediaClient({ accountId: scope.service.accountId, sessionId: scope.service.sessionId, live: sourceLive, onUnauthorized: scope.service.onUnauthorized }, 'conversation_attachment', message.conversationId)
    try { return await reader.read(photo, message.clientMessageId, signal) } finally { reader.dispose() }
  }, [key])

  async function stopPhotoRetry(expected?: ChatPhotoIntent): Promise<boolean> {
    const scope = current.current, upload = scope?.photoUpload
    if (!expected || !scope || scope.key !== key || !live(scope) || scope.inaccessible || scope.sending || gathering(scope.service) || scope.service.storyBranchId
      || !upload || !(scope.photoCaptureMissing || scope.photoNeedsSelection && upload.needsSelection) || upload.intent !== expected) return false
    const authority = scope.authorityRevision
    scope.sending = true; publish(scope)
    try {
      if (scope.photoCaptureMissing) await upload.stopMissingCapture(expected.key)
      else await upload.stopRetry(expected.key)
      if (!live(scope) || authority !== scope.authorityRevision || scope.photoUpload !== upload) return false
      scope.photoUpload = undefined; scope.photoNeedsSelection = false; scope.photoCaptureMissing = false
      notify(scope, zh ? '已停止在本机重试。若上次照片已发出，它仍会留在聊天里；现在可以选择新照片。' : 'Retrying has stopped on this device. If the photo was already sent, it stays in the chat. You can now choose a new photo.')
      return true
    } catch {
      if (live(scope) && authority === scope.authorityRevision) notify(scope, zh ? '暂时无法停止重试，请保留当前页面再试一次。' : 'Retrying could not be stopped. Keep this page open and try again.')
      return false
    } finally { if (live(scope)) { scope.sending = false; publish(scope) } }
  }

  async function resumeCapture(operationId: string): Promise<boolean> {
    const scope = current.current, client = scope?.service.chatCapture
    if (!scope || scope.key !== key || !live(scope) || scope.sending || !client || gathering(scope.service) || scope.service.storyBranchId) return false
    const originalTarget = targetOf(scope.service)
    const original = originalTarget.kind === 'direct' ? scope.photoUpload?.intent ?? readChatPhotoIntent(scope.service.accountId, originalTarget.personId) : undefined
    const missing = () => {
      if (!live(scope) || scope.sending || !original || original.key !== operationId || original.clientMessageId !== operationId || originalTarget.kind !== 'direct') return false
      const latest = scope.photoUpload?.intent ?? readChatPhotoIntent(scope.service.accountId, originalTarget.personId)
      if (!latest || latest.key !== original.key || latest.clientMessageId !== original.clientMessageId || latest.conversationId !== original.conversationId) return false
      if (!scope.photoUpload || scope.photoUpload.capture) {
        const holder = new ChatPhotoUpload({ accountId: scope.service.accountId, sessionId: scope.service.sessionId, live: () => live(scope), onUnauthorized: scope.service.onUnauthorized }, originalTarget.personId, original.conversationId)
        if (holder.intent && holder.intent.key !== original.key) return false
        holder.intent ??= latest
        scope.photoUpload?.dispose(); scope.photoUpload = holder
      }
      scope.photoCaptureMissing = true; scope.photoNeedsSelection = false; publish(scope)
      notify(scope, zh ? '这张照片的本机原图已无法恢复。可以停止这次本机重试，再选择新照片；已发送的照片仍会留在聊天里。' : 'This local original can no longer be restored. Stop this retry before choosing a new photo. Any photo already sent stays in the chat.')
      return true
    }
    try {
      return await client.run(operationId, async () => {
        const authority = scope.authorityRevision, pending = await client.refresh()
        if (!live(scope) || authority !== scope.authorityRevision) return false
        const target = targetOf(scope.service)
        if (!pending) { if (!missing() && live(scope)) notify(scope, zh ? '这张待发照片已无法恢复，可以重新拍摄；已发送的照片仍会留在聊天里。' : 'This pending photo cannot be restored. You can take another; any photo already sent stays in the chat.'); return false }
        if (pending.operationId !== operationId || target.kind !== 'direct' || pending.owner.personId !== target.personId) return false
        return sendPhoto(undefined, pending)
      })
    } catch (error) { const handled = ['CAPTURE_FILE_MISSING', 'CAPTURE_EXPIRED'].includes((error as { code?: string }).code ?? '') && missing(); if (!handled && live(scope)) notify(scope, client.failure(error, zh)); return false }
  }

  async function takePhoto(): Promise<boolean> {
    const scope = current.current, client = scope?.service.chatCapture
    if (!scope || scope.key !== key || !live(scope) || scope.sending || !client || gathering(scope.service) || scope.service.storyBranchId) return false
    const target = targetOf(scope.service)
    if (target.kind !== 'direct') return false
    const previous = scope.photoUpload?.intent ?? readChatPhotoIntent(scope.service.accountId, target.personId)
    if (previous) return sendPhoto()
    const authority = scope.authorityRevision, operationId = client.operationId()
    scope.sending = true; publish(scope)
    try {
      scope.photoCaptureMissing = false
      return await client.run(operationId, async () => {
        const conversationId = await conversation(scope)
        if (!live(scope) || authority !== scope.authorityRevision) return false
        const pending = await client.launch({ accountId: scope.service.accountId, sessionId: scope.service.sessionId, personId: target.personId, conversationId }, operationId)
        if (!live(scope) || authority !== scope.authorityRevision) return false
        scope.sending = false
        return sendPhoto(undefined, pending)
      })
    } catch (error) {
      if (live(scope) && (error as { code?: string }).code !== 'CAPTURE_CANCELLED') notify(scope, client.failure(error, zh))
      return false
    } finally { if (live(scope)) { scope.sending = false; publish(scope) } }
  }

  async function sendPhoto(file?: File, captureRecord?: CaptureRecord): Promise<boolean> {
    const scope = current.current
    if (!scope || !live(scope) || scope.inaccessible || scope.sending || gathering(scope.service)||scope.service.storyBranchId) return false
    const authority = scope.authorityRevision, target = targetOf(scope.service)
    if (target.kind !== 'direct') return false
    const previous = scope.photoUpload?.intent ?? readChatPhotoIntent(scope.service.accountId, target.personId)
    if (!captureRecord && !file && scope.service.chatCapture && previous?.key === previous?.clientMessageId && previous) return resumeCapture(previous.key)
    scope.sending = true; publish(scope)
    try {
      const id = await conversation(scope)
      scope.photoCaptureMissing = false
      if (!live(scope) || authority !== scope.authorityRevision) return false
      if (captureRecord) {
        const client = scope.service.chatCapture
        if (!client || captureRecord.owner.accountId !== scope.service.accountId || captureRecord.owner.sessionId !== scope.service.sessionId || captureRecord.owner.personId !== target.personId || captureRecord.owner.conversationId !== id) throw new MediaError(409, 'PHOTO_TARGET_CHANGED')
        const native = client.transaction(captureRecord, () => live(scope) && authority === scope.authorityRevision)
        const restored = new ChatPhotoUpload({ accountId: scope.service.accountId, sessionId: scope.service.sessionId, live: () => live(scope) && authority === scope.authorityRevision, onUnauthorized: scope.service.onUnauthorized }, target.personId, id, native)
        scope.photoUpload?.dispose(); scope.photoUpload = restored
        await restored.selectPrepared(await native.read())
      }
      scope.photoUpload ??= new ChatPhotoUpload({ accountId: scope.service.accountId, sessionId: scope.service.sessionId,
        live: () => live(scope) && authority === scope.authorityRevision, onUnauthorized: scope.service.onUnauthorized }, target.personId, id)
      const upload = scope.photoUpload
      if (file) await upload.select(file)
      publish(scope)
      const intent = await upload.ready()
      if (!live(scope) || authority !== scope.authorityRevision) return false
      scope.photoNeedsSelection = false
      await upload.capture?.beforeMessage()
      if (!live(scope) || authority !== scope.authorityRevision) return false
      scope.readVersion++; scope.reading?.abort()
      const result = await api<{ message: Message; generationJobId: string }>(scope, '/v1/conversations/' + id + '/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': intent.key },
        body: JSON.stringify({ clientMessageId: intent.clientMessageId, kind: 'photo', media: { id: intent.media.id, version: intent.media.version } }),
      })
      if (!live(scope) || authority !== scope.authorityRevision) return false
      const message = result.data.message
      if (!validMessage(message, id) || message.kind !== 'photo' || message.clientMessageId !== intent.clientMessageId
        || message.photo?.mediaId !== intent.media.id || message.photo.version !== intent.media.version || !uuid.test(result.data.generationJobId)
        || message.generationJobId !== result.data.generationJobId) throw new ConversationError(502, 'INVALID_RESPONSE')
      scope.readVersion++; scope.reading?.abort(); recent(scope)
      scope.replyBaseline = message.sequence
      scope.messages.clear(); scope.messages.set(message.id, message)
      scope.jobs.set(result.data.generationJobId, { terminal: false, notify: true, kind: 'photo_reply' })
      await upload.capture?.sent({ messageId: message.id, conversationId: id, clientMessageId: intent.clientMessageId, mediaId: intent.media.id, mediaVersion: intent.media.version })
      await upload.finish()
      if (upload.capture && scope.photoUpload === upload) scope.photoUpload = undefined
      publish(scope)
      void history(scope).catch(error => fail(scope, error)); void jobs(scope).catch(error => fail(scope, error))
      return true
    } catch (error) {
      if (!live(scope) || authority !== scope.authorityRevision) return false
      if (captureRecord && ! (error instanceof MediaError) && ! (error instanceof ConversationError)) {
        scope.photoNeedsSelection = false; notify(scope, scope.service.chatCapture!.failure(error, zh)); return false
      }
      const code = error instanceof MediaError || error instanceof ConversationError ? error.code : ''
      if (error instanceof MediaError && code === 'AUTHORIZATION_CHANGED' && !scope.photoUpload?.intent?.media) {
        try { await scope.photoUpload?.finish() } catch { return false }
        if (!scope.photoUpload?.intent) { scope.photoUpload?.dispose(); scope.photoUpload = undefined }
        notify(scope, zh ? '照片授权已变更，请重新选择照片，文字已保留。' : 'Photo permission changed. Choose the photo again; your text is kept.')
        return false
      }
      if (['PHOTO_SELECTION_INVALID', 'PHOTO_NOT_READY', 'INVALID_ARGUMENT'].includes(code)) { try { await scope.photoUpload?.finish() } catch { return false }; if (!scope.photoUpload?.intent) { scope.photoUpload?.dispose(); scope.photoUpload = undefined } }
      if (code === 'PHOTO_SELECTION_INVALID' || code === 'PHOTO_NOT_READY') {
        notify(scope, zh ? '这张照片未能发出，请重新选择。' : 'This photo could not be sent. Please choose it again.')
        return false
      }
      if (code === 'INVALID_PHOTO_INPUT') notify(scope, zh ? '这张照片没能打开，请重新选择。' : "Couldn't open photo. Try again.")
      else if (code === 'PHOTO_INTENT_PENDING' || code.includes('PERMISSION_REQUIRED') || error instanceof MediaError && error.status === 401) fail(scope, error)
      else {
        scope.photoNeedsSelection = scope.photoUpload?.needsSelection ?? false
        notify(scope, scope.photoNeedsSelection
          ? zh ? '继续发送需要重新选择原照片。若已找不到原图，可以停止本机重试；文字已保留。' : 'Choose the original photo again to continue. If you cannot find it, you can stop retrying on this device. Your text is kept.'
          : zh ? '照片发送结果尚未确认，请再次点「照片」重试，文字已保留。' : 'Photo sending is not confirmed. Tap Photos again to retry. Your text is kept.')
      }
      return false
    } finally { if (live(scope)) { scope.sending = false; publish(scope) } }
  }

  async function send(text: string,inputMode:'typed'|'transcribed'='typed'): Promise<boolean> {
    const scope = current.current
    const value = scope?.intent ? scope.intent.text : text.trim()
    if (!scope || !live(scope) || scope.inaccessible || scope.sending || !value) return false
    if (gathering(scope.service) && !scope.intent && scope.canSend === false) {
      notify(scope, zh ? '输入已保留。围坐至少需要两位人物；如果人数已够，请到「我」里的「隐私与 AI 说明」确认同意状态后再试。' : 'Your text is kept. A gathering needs at least two characters. If they are already here, review your agreement in Me → Privacy & AI and retry.', 'composer')
      return false
    }
    if ([...value].length > 4000) { fail(scope, new ConversationError(400, 'INVALID_ARGUMENT'), true); return false }
    scope.sending = true
    const authority = scope.authorityRevision
    publish(scope)
    const clientMessageId = crypto.randomUUID()
    const intent: Intent = scope.intent ?? { text: value, clientMessageId, accountId: scope.service.accountId,storyBranchId:scope.service.storyBranchId,
      key: clientMessageId, target: targetOf(scope.service), body: { clientMessageId, kind: 'text', text: value, inputMode } }
    saveIntent(scope, intent)
    publish(scope)
    scope.readVersion++
    scope.reading?.abort()
    try {
      const id = await conversation(scope)
      if (!live(scope) || authority !== scope.authorityRevision) return false
      if (intent.conversationId !== undefined && intent.conversationId !== id) throw new ConversationError(409, 'INTENT_TARGET_CHANGED')
      intent.conversationId = id
      saveIntent(scope, intent)
      const result = await api<{ message: Message; generationJobId: string; generationKind?: 'gather_reply'|'story_reply' }>(scope, conversationPath(scope,id) + '/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': intent.key },
        body: JSON.stringify(intent.body),
      })
      if (!live(scope) || authority !== scope.authorityRevision) return false
      if (!validMessage(result.data.message, id) || result.data.message.clientMessageId !== intent.clientMessageId || !uuid.test(result.data.generationJobId)
        || result.data.message.generationJobId !== result.data.generationJobId
        || result.data.message.kind !== 'text' || result.data.message.author.kind !== 'self' || result.data.message.text !== intent.body.text
        || intent.body.inputMode==='transcribed'&&result.data.message.inputMode!=='transcribed'
        || scope.service.storyBranchId&&(result.data.generationKind!=='story_reply'||result.data.message.generationKind!=='story_reply'||result.data.message.canSuggestMemory!==false)
        || gathering(scope.service) && (result.data.generationKind !== 'gather_reply' || result.data.message.generationKind !== 'gather_reply'
          || result.data.message.text !== value)) {
        throw new ConversationError(502, 'INVALID_RESPONSE')
      }
      scope.readVersion++
      scope.reading?.abort()
      recent(scope)
      scope.replyBaseline = result.data.message.sequence
      scope.messages.clear()
      scope.messages.set(result.data.message.id, result.data.message)
      scope.jobs.set(result.data.generationJobId, { terminal: false, notify: true })
      saveIntent(scope)
      publish(scope)
      void history(scope).catch(error => fail(scope, error))
      void jobs(scope).catch(error => fail(scope, error))
      return true
    } catch (error) {
      if (!live(scope) || authority !== scope.authorityRevision) return false
      if (!(error instanceof ConversationError) || error.status >= 500) {
        try {
          await history(scope)
          if (!live(scope) || authority !== scope.authorityRevision) return false
          if ([...scope.messages.values()].some(message => message.clientMessageId === intent.clientMessageId && message.conversationId === intent.conversationId
            && message.kind === 'text' && message.author.kind === 'self' && message.text === intent.body.text
            && (intent.body.inputMode!=='transcribed'||message.inputMode==='transcribed'))) {
            saveIntent(scope)
            recent(scope)
            await history(scope)
            void jobs(scope).catch(problem => fail(scope, problem))
            return true
          }
        } catch { /* An unknown result retains the same durable operation identity for retry. */ }
      }
      if (error instanceof ConversationError && error.code === 'INVALID_ARGUMENT') saveIntent(scope)
      if (error instanceof ConversationError && (error.status === 404 || error.status === 401)) hide(scope)
      fail(scope, error, true)
      return false
    } finally { if (live(scope)) { scope.sending = false; publish(scope) } }
  }

  async function remove(message: Msg): Promise<boolean> {
    const scope = current.current
    if (!scope || !live(scope) || !message.serverId || !message.serverVersion || scope.deleting.has(message.serverId)) return false
    const id = message.serverId
    scope.deleting.add(id)
    const authority = scope.authorityRevision
    const signature = id + ':' + message.serverVersion
    const key = scope.deleteKeys.get(signature) ?? crypto.randomUUID()
    scope.deleteKeys.set(signature, key)
    scope.readVersion++
    scope.reading?.abort()
    try {
      const conversationId = await conversation(scope)
      const result = await api<{ id: string; removedAt: string; version: number }>(scope, conversationPath(scope,conversationId) + '/messages/' + id, {
        method: 'DELETE', headers: { 'Idempotency-Key': key, 'If-Match': '"v' + message.serverVersion + '"' },
      })
      if (!live(scope) || authority !== scope.authorityRevision) return false
      if (result.data.id !== id || !result.data.removedAt) throw new ConversationError(502, 'INVALID_RESPONSE')
      scope.readVersion++
      scope.reading?.abort()
      scope.removed.add(id)
      scope.messages.delete(id)
      if (message.generationJobId) scope.jobs.delete(message.generationJobId)
      if (scope.anchor === id) { recent(scope); void history(scope).catch(error => fail(scope, error)) }
      publish(scope)
      return true
    } catch (error) { if (authority === scope.authorityRevision) fail(scope, error); return false }
    finally { scope.deleting.delete(id) }
  }

  async function loadOlder() {
    const scope = current.current
    if (!scope || !live(scope) || !scope.older || scope.expanding || scope.sending) return
    scope.expanding = true
    const anchored = !!scope.anchor
    if (anchored) scope.olderPages++
    else scope.pages++
    try { await history(scope) }
    catch (error) { if (anchored && scope.anchor) scope.olderPages--; else if (!anchored) scope.pages--; fail(scope, error) }
    finally { scope.expanding = false }
  }
  async function loadNewer() {
    const scope = current.current
    if (!scope || !live(scope) || !scope.anchor || !scope.after || scope.expanding || scope.sending) return
    scope.expanding = true
    scope.newerPages++
    try { await history(scope) }
    catch (error) { if (scope.anchor) scope.newerPages--; fail(scope, error) }
    finally { scope.expanding = false }
  }
  const displayed = view.key === key ? view : emptyView(key)
  const retryPhoto = displayed.pendingPhoto && (displayed.photoNeedsSelection || displayed.photoCaptureMissing) && current.current?.key === key ? current.current.photoUpload?.intent : undefined
  return { ...displayed, conversationId:current.current?.key===key?current.current.conversation:undefined,feedback, clearFeedback,
    safetySupport: support?.scopeKey === key ? support.jobId : undefined,
    dismissSafetySupport: () => setSupport(null),
    send, sendPhoto, takePhoto, resumeCapture, stopPhotoRetry: () => stopPhotoRetry(retryPhoto), readPhoto, remove, loadOlder, loadNewer }
}
