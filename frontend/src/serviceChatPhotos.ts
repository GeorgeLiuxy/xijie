import { fileToDataUrl, type PostPhoto } from './model'
import { MediaClient, MediaError, preparePhotos, validatePostPhoto, type MediaContext, type PhotoUploadMetadata, type PreparedPhoto } from './serviceMedia'
import type { CaptureRecord, CaptureTransaction } from './mobile/chatCapture'

export type ChatPhotoIntent = {
  personId: string; conversationId: string; clientMessageId: string; key: string
  metadata: PhotoUploadMetadata; media?: PostPhoto
}

/** Exact local cleanup for a positively identified native operation; no services. */
export async function clearCapturePhotoJournals(record: CaptureRecord) {
  const metadata = record.plan?.photoIntent.metadata ?? (record.prepared && { mimeType: record.prepared.mimeType, byteSize: record.prepared.byteSize, sha256: record.prepared.sha256 })
  if (!metadata) return
  const client = new MediaClient({ accountId: record.owner.accountId, sessionId: record.owner.sessionId, live: () => true, onUnauthorized() {} }, 'conversation_attachment', record.owner.conversationId)
  const parent = storageKey(record.owner.accountId, record.owner.personId)
  try {
    const journal = await client.conversationUploadJournal(metadata, record.operationId, record.operationId)
    const previous = sessionStorage.getItem(parent)
    let value: ChatPhotoIntent | undefined
    try { value = previous ? JSON.parse(previous) : undefined } catch { /* An unproven corrupt record cannot be removed as this operation. */ }
    const owned = value?.key === record.operationId && value?.clientMessageId === record.operationId && value?.personId === record.owner.personId && value?.conversationId === record.owner.conversationId
    let removed = false
    try {
      if (owned) { sessionStorage.removeItem(parent); removed = true; if (sessionStorage.getItem(parent) !== null) throw new MediaError(503, 'PHOTO_RETRY_STORAGE_UNAVAILABLE') }
      journal.remove()
    } catch (error) {
      try { journal.restore() } catch { /* Native durable plan remains available. */ }
      if (removed) try { if (sessionStorage.getItem(parent) === null) sessionStorage.setItem(parent, previous!) } catch { /* Native durable plan remains available. */ }
      throw error
    }
  } finally { client.dispose() }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const storageKey = (accountId: string, personId: string) => 'xijie.chat-photo.intent.' + accountId + '.' + personId

export function readChatPhotoIntent(accountId: string, personId: string): ChatPhotoIntent | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey(accountId, personId)) ?? 'null') as ChatPhotoIntent
    if (!value || value.personId !== personId || ![personId, value.conversationId, value.clientMessageId, value.key].every(id => uuid.test(id))
      || !value.metadata || !['image/jpeg', 'image/png', 'image/webp'].includes(value.metadata.mimeType)
      || !Number.isSafeInteger(value.metadata.byteSize) || value.metadata.byteSize < 1 || value.metadata.byteSize > 10 * 1024 * 1024
      || !/^[a-f0-9]{64}$/.test(value.metadata.sha256)) return
    if (value.media) validatePostPhoto(value.media)
    return value
  } catch { /* Corrupt metadata is never submitted. */ }
}

// Only operation identities and hashes survive refresh. Bytes stay in the live
// scope; already uploaded bytes can finish under the original Media receipt.
export class ChatPhotoUpload {
  readonly media: MediaClient
  intent?: ChatPhotoIntent
  private prepared?: PreparedPhoto
  private lifetime = new AbortController()
  get needsSelection() { return !!this.intent && !this.intent.media && !this.prepared }
  constructor(readonly context: MediaContext, readonly personId: string, readonly conversationId: string, readonly capture?: CaptureTransaction) {
    if (capture && (capture.owner.accountId !== context.accountId || capture.owner.sessionId !== context.sessionId || capture.owner.personId !== personId || capture.owner.conversationId !== conversationId)) throw new MediaError(409, 'PHOTO_TARGET_CHANGED')
    this.media = new MediaClient(context, 'conversation_attachment', conversationId, capture?.journal)
    this.intent = readChatPhotoIntent(context.accountId, personId)
    if (this.intent && this.intent.conversationId !== conversationId) throw new MediaError(409, 'PHOTO_TARGET_CHANGED')
    if (capture) {
      if (this.intent && (this.intent.key !== capture.operationId || this.intent.clientMessageId !== capture.operationId)) throw new MediaError(409, 'PHOTO_INTENT_PENDING')
      const restored = capture.plan?.photoIntent
      if (this.intent && restored && ['mimeType', 'byteSize', 'sha256'].some(key => this.intent!.metadata[key as keyof PhotoUploadMetadata] !== restored.metadata[key as keyof PhotoUploadMetadata])) throw new MediaError(409, 'PHOTO_INTENT_PENDING')
      if (restored) this.intent = JSON.parse(JSON.stringify(restored))
    }
  }
  private current() { if (this.lifetime.signal.aborted || !this.context.live()) throw new DOMException('Canceled', 'AbortError') }
  private async save(intent: ChatPhotoIntent) {
    this.current(); if (this.capture) { await this.capture.photo(intent); this.current() }; this.intent = intent
    try { sessionStorage.setItem(storageKey(this.context.accountId, this.personId), JSON.stringify(intent)) } catch { /* The live operation remains stable. */ }
  }
  async select(file: File) {
    this.current()
    if (this.capture) throw new MediaError(409, 'PHOTO_INTENT_PENDING')
    if (!file.type.startsWith('image/') || !file.size || file.size > 10 * 1024 * 1024) throw new MediaError(400, 'INVALID_PHOTO_INPUT')
    let photo: PreparedPhoto
    try { [photo] = await preparePhotos([await fileToDataUrl(file, 720, this.lifetime.signal)]) }
    catch (error) { this.current(); if (error instanceof DOMException && error.name === 'AbortError') throw error; throw new MediaError(400, 'INVALID_PHOTO_INPUT') }
    this.current()
    if (this.intent && (this.intent.metadata.sha256 !== photo.sha256 || this.intent.metadata.byteSize !== photo.byteSize || this.intent.metadata.mimeType !== photo.mimeType)) throw new MediaError(409, 'PHOTO_INTENT_PENDING')
    const { blob: _blob, ...metadata } = photo
    if (!this.intent) await this.save({ personId: this.personId, conversationId: this.conversationId, clientMessageId: crypto.randomUUID(), key: crypto.randomUUID(), metadata })
    this.prepared = photo
  }
  async selectPrepared(photo: PreparedPhoto) {
    this.current(); this.capture?.current()
    if (!this.capture || photo.mimeType !== 'image/jpeg' || photo.blob.type !== photo.mimeType || photo.blob.size !== photo.byteSize || photo.byteSize < 1 || photo.byteSize > 1024 * 1024 || !/^[a-f0-9]{64}$/.test(photo.sha256)) throw new MediaError(400, 'INVALID_PHOTO_INPUT')
    const { blob: _blob, ...metadata } = photo
    if (this.intent && (this.intent.metadata.sha256 !== metadata.sha256 || this.intent.metadata.byteSize !== metadata.byteSize || this.intent.metadata.mimeType !== metadata.mimeType)) throw new MediaError(409, 'PHOTO_INTENT_PENDING')
    await this.save(this.intent ?? { personId: this.personId, conversationId: this.conversationId, clientMessageId: this.capture.operationId, key: this.capture.operationId, metadata })
    this.prepared = photo
  }
  async ready(): Promise<ChatPhotoIntent & { media: PostPhoto }> {
    this.current()
    const intent = this.intent
    if (!intent) throw new MediaError(400, 'PHOTO_SELECTION_REQUIRED')
    if (intent.media) return intent as ChatPhotoIntent & { media: PostPhoto }
    const [id] = this.prepared ? await this.media.upload([this.prepared], intent.clientMessageId, intent.key)
      : await this.media.resumeUpload([intent.metadata], intent.clientMessageId, intent.key)
    const described = await this.media.describe(id)
    const photo = this.capture ? { id: described.id, version: described.version, mimeType: described.mimeType, byteSize: described.byteSize, width: described.width, height: described.height } : described
    this.current(); await this.save({ ...intent, media: photo }); this.prepared = undefined
    return this.intent as ChatPhotoIntent & { media: PostPhoto }
  }
  async finish() {
    this.current()
    if (this.capture && this.intent) { await this.retireLocal(this.intent.key, false); return }
    if (this.intent) await this.media.forgetUpload([this.intent.metadata], this.intent.clientMessageId, this.intent.key)
    this.current()
    this.intent = undefined; this.prepared = undefined
    try { sessionStorage.removeItem(storageKey(this.context.accountId, this.personId)) } catch { /* No private bytes were persisted. */ }
  }
  private async retireLocal(expectedKey: string, requireSelection: boolean) {
    this.current()
    const intent = this.intent
    if (!intent || intent.key !== expectedKey || requireSelection && !this.needsSelection) throw new MediaError(409, 'PHOTO_RETRY_CHANGED')
    const journal = await this.media.conversationUploadJournal(intent.metadata, intent.clientMessageId, intent.key)
    this.current()
    if (this.intent !== intent || requireSelection && !this.needsSelection) throw new MediaError(409, 'PHOTO_RETRY_CHANGED')
    const key = storageKey(this.context.accountId, this.personId), marker = JSON.stringify(intent)
    let parentRemoved = false
    try {
      const previous = sessionStorage.getItem(key)
      if (previous !== null && JSON.stringify(JSON.parse(previous)) !== marker) throw new MediaError(409, 'PHOTO_RETRY_CHANGED')
      // Establish a recoverable marker even when its earlier write was blocked.
      sessionStorage.setItem(key, marker)
      if (sessionStorage.getItem(key) !== marker) throw new MediaError(503, 'PHOTO_RETRY_STORAGE_UNAVAILABLE')
      sessionStorage.removeItem(key); parentRemoved = true
      if (sessionStorage.getItem(key) !== null) throw new MediaError(503, 'PHOTO_RETRY_STORAGE_UNAVAILABLE')
      journal.remove()
    } catch (error) {
      if (parentRemoved) {
        try { journal.restore() } catch { /* Keep the original live operation below. */ }
        try { const current = sessionStorage.getItem(key); if (current === null || current === marker) sessionStorage.setItem(key, marker) } catch { /* The live intent remains recoverable on this page. */ }
      }
      throw error instanceof MediaError ? error : new MediaError(503, 'PHOTO_RETRY_STORAGE_UNAVAILABLE')
    }
    this.intent = undefined; this.prepared = undefined; this.dispose()
  }
  async stopRetry(expectedKey: string) { await this.capture?.discard(); await this.retireLocal(expectedKey, true) }
  async stopMissingCapture(expectedKey: string) {
    if (this.intent?.key !== this.intent?.clientMessageId) throw new MediaError(409, 'PHOTO_RETRY_CHANGED')
    await this.capture?.discard(); await this.retireLocal(expectedKey, false)
  }
  dispose() { this.lifetime.abort(); this.prepared = undefined; this.media.dispose() }
}
