import type { PostPhoto } from '../model'
import type { PreparedPhoto, PhotoUploadMetadata, UploadIntent, CaptureUploadJournal } from '../serviceMedia'
import { clearCapturePhotoJournals } from '../serviceChatPhotos'

export type CaptureIdentity = { accountId: string; sessionId: string }
export type CaptureOwner = CaptureIdentity & { personId: string; conversationId: string }
export type CapturePrepared = PhotoUploadMetadata & { mimeType: 'image/jpeg'; width: number; height: number }
export type CapturePhotoIntent = { personId: string; conversationId: string; clientMessageId: string; key: string; metadata: PhotoUploadMetadata; media?: PostPhoto }
export type CapturePlan = { photoIntent: CapturePhotoIntent; mediaIntent?: UploadIntent; messageAttempted: boolean }
export type CaptureRecord = { operationId: string; owner: CaptureOwner; pageId: string; state: 'capturing' | 'ready'; revision: number; createdAtMs: number; expiresAtMs: number; restored: boolean; prepared?: CapturePrepared; plan?: CapturePlan }
export type CaptureReceipt = { messageId: string; conversationId: string; clientMessageId: string; mediaId: string; mediaVersion: number }
type Bridge = { isNativePlatform?: () => boolean; getPlatform?: () => string; isPluginAvailable?: (name: string) => boolean; nativePromise?: (plugin: string, method: string, data: Record<string, unknown>) => Promise<unknown> }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const hash = /^[a-f0-9]{64}$/
const maximum = 1024 * 1024
function operationUuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128
  const value = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return [value.slice(0, 8), value.slice(8, 12), value.slice(12, 16), value.slice(16, 20), value.slice(20)].join('-')
}
const pageId = operationUuid()
const flights = new Map<string, Promise<unknown>>()
const flightListeners = new Set<() => void>()
let currentIdentity: CaptureIdentity | undefined
let identityEpoch = 0
let known: CaptureRecord | undefined
const cleanupHandles = new Map<string, { owner: CaptureOwner; operationId: string; record?: CaptureRecord }>()
const retired = new Set<string>()
const handleKey = (owner: CaptureOwner, operationId: string) => JSON.stringify([owner.accountId, owner.sessionId, owner.personId, owner.conversationId, operationId])
function remember(owner: CaptureOwner, operationId: string, record?: CaptureRecord) { const key = handleKey(owner, operationId), previous = cleanupHandles.get(key); if (!previous?.record || !record || previous.record.revision <= record.revision) cleanupHandles.set(key, { owner, operationId, record: record ?? previous?.record }) }
const bridge = () => typeof window === 'undefined' ? undefined : (window as Window & { Capacitor?: Bridge }).Capacitor
const aborted = () => new DOMException('Capture scope changed', 'AbortError')
export class ChatCaptureError extends Error { constructor(readonly code: string, readonly status = 503) { super('The private camera operation could not be completed.') } }
const invalid = () => new ChatCaptureError('CAPTURE_INVALID_RESPONSE', 502)
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
const exact = (value: unknown, required: string[], optional: string[] = []): value is Record<string, any> => object(value) && required.every(key => key in value) && Object.keys(value).every(key => required.includes(key) || optional.includes(key))
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0
const sameIdentity = (a: CaptureIdentity | undefined, b: CaptureIdentity | undefined) => !!a && !!b && a.accountId === b.accountId && a.sessionId === b.sessionId
const sameOwner = (a: CaptureOwner, b: CaptureOwner) => sameIdentity(a, b) && a.personId === b.personId && a.conversationId === b.conversationId
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
function owner(value: unknown): asserts value is CaptureOwner { if (!exact(value, ['accountId', 'sessionId', 'personId', 'conversationId']) || !Object.values(value).every(id => typeof id === 'string' && uuid.test(id))) throw invalid() }
function prepared(value: unknown): asserts value is CapturePrepared { if (!exact(value, ['mimeType', 'byteSize', 'sha256', 'width', 'height']) || value.mimeType !== 'image/jpeg' || !positive(value.byteSize) || value.byteSize > maximum || !hash.test(value.sha256) || !positive(value.width) || value.width > 720 || !positive(value.height) || value.height > 720) throw invalid() }
function upload(value: unknown): asserts value is UploadIntent {
  if (!exact(value, ['allocateKey', 'uploadKey', 'completeKey'], ['mediaId', 'uploadSlotId', 'renewal']) || !['allocateKey', 'uploadKey', 'completeKey'].every(key => uuid.test(value[key]))
    || value.mediaId !== undefined && !uuid.test(value.mediaId) || value.uploadSlotId !== undefined && !uuid.test(value.uploadSlotId)) throw invalid()
  if (value.renewal !== undefined && (!exact(value.renewal, ['key', 'version', 'uploadKey', 'completeKey']) || !value.mediaId || !positive(value.renewal.version) || !['key', 'uploadKey', 'completeKey'].every(key => uuid.test(value.renewal[key])))) throw invalid()
}
function photoMedia(value: unknown): value is PostPhoto { return exact(value, ['id', 'version', 'mimeType', 'byteSize', 'width', 'height']) && uuid.test(value.id) && positive(value.version) && value.mimeType === 'image/webp' && positive(value.byteSize) && value.byteSize <= maximum && positive(value.width) && value.width <= 2048 && positive(value.height) && value.height <= 2048 }
function plan(value: unknown, capture: CaptureRecord): asserts value is CapturePlan {
  if (!capture.prepared || !exact(value, ['photoIntent', 'messageAttempted'], ['mediaIntent']) || typeof value.messageAttempted !== 'boolean') throw invalid()
  const p = value.photoIntent
  if (!exact(p, ['personId', 'conversationId', 'clientMessageId', 'key', 'metadata'], ['media']) || p.personId !== capture.owner.personId || p.conversationId !== capture.owner.conversationId || p.key !== capture.operationId || p.clientMessageId !== capture.operationId
    || !exact(p.metadata, ['mimeType', 'byteSize', 'sha256']) || p.metadata.mimeType !== capture.prepared.mimeType || p.metadata.byteSize !== capture.prepared.byteSize || p.metadata.sha256 !== capture.prepared.sha256 || p.media !== undefined && !photoMedia(p.media)) throw invalid()
  if (value.mediaIntent !== undefined) upload(value.mediaIntent)
  if (p.media && value.mediaIntent?.mediaId !== p.media.id || value.messageAttempted && (!p.media || !value.mediaIntent)) throw invalid()
}
function capture(value: unknown, identity: CaptureIdentity, allowExpired = false): CaptureRecord {
  if (!exact(value, ['operationId', 'owner', 'pageId', 'state', 'revision', 'createdAtMs', 'expiresAtMs', 'restored'], ['prepared', 'plan'])) throw invalid()
  owner(value.owner)
  if (!sameIdentity(value.owner, identity) || !uuid.test(value.operationId) || !uuid.test(value.pageId) || !['capturing', 'ready'].includes(value.state) || !positive(value.revision) || !positive(value.createdAtMs) || value.expiresAtMs !== value.createdAtMs + 3600000 || !allowExpired && value.expiresAtMs <= Date.now() || typeof value.restored !== 'boolean') throw invalid()
  if (value.state === 'ready') prepared(value.prepared)
  else if (value.prepared !== undefined || value.plan !== undefined) throw invalid()
  if (value.plan !== undefined) plan(value.plan, value as CaptureRecord)
  return clone(value as CaptureRecord)
}
export function chatCaptureAvailable() {
  try { const b = bridge(); return b?.isNativePlatform?.() === true && b.getPlatform?.() === 'android' && typeof b.nativePromise === 'function' && (typeof b.isPluginAvailable !== 'function' || b.isPluginAvailable('ChatCapture')) } catch { return false }
}
export function setChatCaptureIdentity(identity?: CaptureIdentity) { if (identity || currentIdentity) { if (!sameIdentity(identity, currentIdentity)) identityEpoch++ }; currentIdentity = identity ? { accountId: identity.accountId, sessionId: identity.sessionId } : undefined }
async function call(method: string, data: Record<string, unknown>) {
  const b = bridge()
  if (!chatCaptureAvailable() || !b?.nativePromise) throw new ChatCaptureError('CAPTURE_UNAVAILABLE')
  try { return await b.nativePromise('ChatCapture', method, data) }
  catch (error) { if (error instanceof ChatCaptureError) throw error; const e = error as { code?: unknown; data?: { status?: unknown } }; throw new ChatCaptureError(typeof e?.code === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(e.code) ? e.code : 'CAPTURE_UNAVAILABLE', Number.isInteger(e?.data?.status) ? Number(e.data!.status) : 503) }
}
/** Cleanup is bound to the last positively observed operation, never a bare null. */
export async function clearKnownChatCapture(identity?: CaptureIdentity) {
  if (!identity && currentIdentity) return
  const handles = [...cleanupHandles.entries()].filter(([, value]) => !identity || sameIdentity(value.owner, identity))
  for (const [key] of handles) retired.add(key)
  for (let pass = 0; pass < 2; pass++) for (const [key, previous] of handles) {
    if (!cleanupHandles.has(key)) continue
    const result = await call('release', { owner: previous.owner, operationId: previous.operationId, reason: 'owner_changed' })
    if (!exact(result, ['operationId', 'cleared']) || result.operationId !== previous.operationId || typeof result.cleared !== 'boolean') throw invalid()
    if (!result.cleared) continue
    if (previous.record) await clearCapturePhotoJournals(previous.record)
    cleanupHandles.delete(key)
    if (known?.operationId === previous.operationId && sameOwner(known.owner, previous.owner)) known = undefined
  }
  if (handles.some(([key]) => cleanupHandles.has(key))) throw new ChatCaptureError('CAPTURE_STORAGE_UNAVAILABLE')
}
export async function captureKey(operationId: string, label: string) {
  if (!uuid.test(operationId) || !/^(?:allocate|upload|complete|renewal(?:-upload|-complete)?:[1-9]\d*)$/.test(label)) throw invalid()
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('xijie.chat-capture.v1|' + operationId.toLowerCase() + '|' + label))).slice(0, 16)
  bytes[6] = (bytes[6] & 15) | 128; bytes[8] = (bytes[8] & 63) | 128
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
}
export class ChatCaptureClient {
  private record?: CaptureRecord
  private readEpoch = 0
  private listeners = new Set<() => void>()
  private epoch = identityEpoch
  readonly identity: CaptureIdentity
  constructor(identity: CaptureIdentity, private live: () => boolean) { if (!uuid.test(identity.accountId) || !uuid.test(identity.sessionId)) throw invalid(); this.identity = { accountId: identity.accountId, sessionId: identity.sessionId } }
  private current() { if (this.epoch !== identityEpoch || !this.live() || !sameIdentity(currentIdentity, this.identity)) throw aborted() }
  private accept(value?: CaptureRecord) { this.current(); if (value && this.record?.operationId === value.operationId && this.record.revision > value.revision) return; this.readEpoch++; this.record = value; if (value) { known = value; remember(value.owner, value.operationId, value) }; for (const fn of this.listeners) fn() }
  subscribe = (fn: () => void) => { this.listeners.add(fn); flightListeners.add(fn); return () => { this.listeners.delete(fn); flightListeners.delete(fn) } }
  pending = () => this.record
  operationId = () => operationUuid()
  failure = (error: unknown, zh: boolean) => captureFailure(error, zh)
  active = (operationId: string) => flights.has(JSON.stringify([this.identity.accountId, this.identity.sessionId, operationId]))
  async reconcile() { this.current(); const result = await call('reconcileOwner', { identity: this.identity }); this.current(); if (!exact(result, ['cleared']) || typeof result.cleared !== 'boolean') throw invalid(); if (result.cleared && known && !sameIdentity(known.owner, this.identity)) { const old = known; retired.add(handleKey(old.owner, old.operationId)); await clearCapturePhotoJournals(old); cleanupHandles.delete(handleKey(old.owner, old.operationId)); if (known === old) known = undefined } }
  async refresh() {
    this.current(); const reading = ++this.readEpoch
    let result: unknown
    try { result = await call('getPending', { identity: this.identity, pageId }) }
    catch (error) { this.current(); if (reading === this.readEpoch && error instanceof ChatCaptureError && ['UNAUTHENTICATED', 'CAPTURE_OWNER_CHANGED', 'CAPTURE_TARGET_UNAVAILABLE', 'CAPTURE_PERMISSION_REQUIRED', 'CAPTURE_AUTHORIZATION_CHANGED', 'CAPTURE_FILE_MISSING', 'CAPTURE_EXPIRED'].includes(error.code)) this.accept(undefined); throw error }
    this.current(); if (reading !== this.readEpoch) return this.record
    if (!exact(result, ['pending'], result && (result as any).pending === true ? ['capture'] : []) || typeof result.pending !== 'boolean') throw invalid()
    const value = result.pending ? capture(result.capture, this.identity) : undefined
    this.accept(value); return this.record
  }
  async launch(target: CaptureOwner, operationId: string) {
    this.current(); owner(target); if (!sameIdentity(target, this.identity) || !uuid.test(operationId)) throw invalid()
    this.readEpoch++
    const key = handleKey(target, operationId); remember({ ...target }, operationId)
    let raw: unknown
    try { raw = await call('capture', { owner: target, operationId, pageId }) }
    catch (error) { if (error instanceof ChatCaptureError && ['CAPTURE_PENDING', 'CAPTURE_CANCELLED', 'INVALID_ARGUMENT'].includes(error.code)) { cleanupHandles.delete(key); if (error.code === 'CAPTURE_PENDING') await this.refresh().catch(() => {}) }; throw error }
    const result = capture(raw, this.identity); this.current(); if (retired.has(key)) throw aborted()
    if (!sameOwner(result.owner, target) || result.operationId !== operationId || result.pageId !== pageId || result.state !== 'ready' || result.restored) throw new ChatCaptureError('CAPTURE_CHANGED', 409)
    this.accept(result); return result
  }
  async discard(value: CaptureRecord) {
    this.current(); const record = capture(value, this.identity, true)
    if (this.active(record.operationId)) throw new ChatCaptureError('CAPTURE_PENDING', 409)
    return this.run(record.operationId, async () => {
      const result = await call('release', { owner: record.owner, operationId: record.operationId, reason: 'discard' }); this.current()
      if (!exact(result, ['operationId', 'cleared']) || result.operationId !== record.operationId || result.cleared !== true) throw new ChatCaptureError('CAPTURE_STORAGE_UNAVAILABLE')
      await clearCapturePhotoJournals(record); this.current()
      if (this.record?.operationId === record.operationId) this.accept(undefined)
      if (known?.operationId === record.operationId && sameOwner(known.owner, record.owner)) known = undefined
      cleanupHandles.delete(handleKey(record.owner, record.operationId)); retired.add(handleKey(record.owner, record.operationId))
    })
  }
  run<T>(operationId: string, job: () => Promise<T>): Promise<T> {
    this.current(); if (!uuid.test(operationId)) return Promise.reject(invalid())
    const key = JSON.stringify([this.identity.accountId, this.identity.sessionId, operationId]), prior = flights.get(key)
    if (prior) return prior as Promise<T>
    const work = Promise.resolve().then(() => { this.current(); return job() }); flights.set(key, work)
    for (const fn of flightListeners) fn()
    void work.finally(() => { if (flights.get(key) === work) flights.delete(key); for (const fn of flightListeners) fn() }).catch(() => {})
    return work
  }
  transaction(value: CaptureRecord, live: () => boolean): CaptureTransaction {
    this.current(); const initial = capture(value, this.identity); if (initial.state !== 'ready') throw new ChatCaptureError('CAPTURE_NOT_READY', 409)
    const check = () => { this.current(); if (!live() || retired.has(handleKey(initial.owner, initial.operationId))) throw aborted() }
    let state = initial
    const checkpoint = async (next: CapturePlan) => {
      check(); plan(next, state)
      const result = await call('checkpoint', { owner: state.owner, operationId: state.operationId, expectedRevision: state.revision, plan: next }); check()
      if (!exact(result, ['operationId', 'revision']) || result.operationId !== state.operationId || !positive(result.revision) || result.revision !== state.revision + 1) throw invalid()
      state = { ...state, plan: clone(next), revision: result.revision }; this.accept(state)
    }
    const release = async (reason: 'sent' | 'discard', receipt?: CaptureReceipt) => {
      check()
      if (reason === 'sent') {
        const media = state.plan?.photoIntent.media
        if (!state.plan?.messageAttempted || !media || !exact(receipt, ['messageId', 'conversationId', 'clientMessageId', 'mediaId', 'mediaVersion']) || !uuid.test(receipt.messageId) || receipt.conversationId !== state.owner.conversationId || receipt.clientMessageId !== state.operationId || receipt.mediaId !== media.id || receipt.mediaVersion !== media.version) throw invalid()
      }
      const result = await call('release', { owner: state.owner, operationId: state.operationId, reason, ...(receipt ? { receipt } : {}) }); check()
      if (!exact(result, ['operationId', 'cleared']) || result.operationId !== state.operationId || result.cleared !== true) throw new ChatCaptureError('CAPTURE_STORAGE_UNAVAILABLE')
      if (this.record?.operationId === state.operationId) this.accept(undefined)
      if (known?.operationId === state.operationId && sameOwner(known.owner, state.owner)) known = undefined
      cleanupHandles.delete(handleKey(state.owner, state.operationId)); retired.add(handleKey(state.owner, state.operationId))
    }
    return {
      operationId: state.operationId, owner: state.owner, current: check,
      get plan() { return state.plan },
      journal: { operationId: state.operationId, read: () => state.plan?.mediaIntent, write: async mediaIntent => { if (!state.plan) throw invalid(); await checkpoint({ ...state.plan, mediaIntent }) }, key: label => captureKey(state.operationId, label) },
      photo: async photoIntent => checkpoint({ ...(state.plan ? { mediaIntent: state.plan.mediaIntent } : {}), photoIntent, messageAttempted: state.plan?.messageAttempted ?? false }),
      beforeMessage: async () => { if (!state.plan) throw invalid(); await checkpoint({ ...state.plan, messageAttempted: true }) },
      read: async () => {
        check(); const value = await call('read', { owner: state.owner, operationId: state.operationId }); check()
        if (!exact(value, ['operationId', 'revision', 'mimeType', 'byteSize', 'sha256', 'width', 'height', 'base64']) || value.operationId !== state.operationId || value.revision !== state.revision || typeof value.base64 !== 'string' || value.base64.length > maximum * 1.4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.base64)) throw invalid()
        const descriptor = { mimeType: value.mimeType, byteSize: value.byteSize, sha256: value.sha256, width: value.width, height: value.height }; prepared(descriptor)
        if (!state.prepared || Object.entries(descriptor).some(([key, item]) => state.prepared![key as keyof CapturePrepared] !== item)) throw invalid()
        let bytes: Uint8Array<ArrayBuffer>; try { bytes = Uint8Array.from(atob(value.base64), c => c.charCodeAt(0)) } catch { throw invalid() }
        if (bytes.length !== descriptor.byteSize || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) throw invalid()
        const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join(''); check()
        if (actual !== descriptor.sha256) throw invalid()
        return { blob: new Blob([bytes], { type: 'image/jpeg' }), mimeType: 'image/jpeg', byteSize: bytes.length, sha256: actual }
      },
      sent: receipt => release('sent', receipt), discard: () => release('discard'),
    }
  }
}
export type CaptureTransaction = { operationId: string; owner: CaptureOwner; current: () => void; readonly plan?: CapturePlan; journal: CaptureUploadJournal; photo: (intent: CapturePhotoIntent) => Promise<void>; beforeMessage: () => Promise<void>; read: () => Promise<PreparedPhoto>; sent: (receipt: CaptureReceipt) => Promise<void>; discard: () => Promise<void> }
export function captureFailure(error: unknown, zh: boolean) {
  const code = error instanceof ChatCaptureError ? error.code : ''
  return code === 'CAPTURE_WEBVIEW_OUTDATED' ? zh ? '手机的 Android System WebView 或 Chrome 版本较旧，请更新系统网页组件后重试。待发照片会保留。' : 'Update Android System WebView or Chrome, then try again. Your pending photo is kept.'
    : code === 'CAPTURE_PERMISSION_REQUIRED' || code === 'CAPTURE_AUTHORIZATION_CHANGED' ? zh ? '请到「我」里的「隐私与 AI 说明」查看同意状态，再回来继续。' : 'Review your agreement in Me → Privacy & AI, then return to continue.'
    : code === 'CAPTURE_FILE_MISSING' || code === 'CAPTURE_EXPIRED' ? zh ? '这张待发照片已无法恢复。请回到原聊天，点「照片」后停止这次本机重试，再重新拍摄。' : 'This pending photo cannot be restored. Return to the original chat, choose Photos and stop this local retry before taking another.'
    : zh ? '暂时无法继续处理这张照片，请稍后重试；未确认的发送结果会保留。' : 'This photo cannot be continued right now. Try again later; unconfirmed sending progress is kept.'
}
