import type { PostPhoto } from './model'

export type MediaContext = { accountId: string; sessionId: string; live: () => boolean; onUnauthorized: () => void }
export type PreparedPhoto = { blob: Blob; mimeType: string; byteSize: number; sha256: string }
export type PhotoUploadMetadata = Omit<PreparedPhoto, 'blob'>
export type MediaPurpose = 'post_attachment' | 'person_photo' | 'gift_delivery_photo' | 'conversation_attachment'
export type MediaDTO = { id: string; purpose: MediaPurpose; status: 'awaiting_upload' | 'verifying' | 'ready' | 'rejected' | 'revoked' | 'deleted'; mimeType: string; byteSize: number; version: number; authorizationVersion: number; width?: number; height?: number; createdAt: string; updatedAt: string; failureCode?: string }
type Upload = { id: string; method: 'PUT'; url: string; requiredHeaders: Record<string, string>; expiresAt: string }
export type UploadIntent = { allocateKey: string; uploadKey: string; completeKey: string; mediaId?: string; uploadSlotId?: string; renewal?: { key: string; version: number; uploadKey: string; completeKey: string } }
export type CaptureUploadJournal = { operationId: string; read: () => UploadIntent | undefined; write: (value: UploadIntent) => Promise<void>; key: (label: string) => Promise<string> }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0
const instant = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v))
const inputTypes = ['image/jpeg', 'image/png', 'image/webp']
const MAX_INPUT = 10 * 1024 * 1024, MAX_OUTPUT = 1024 * 1024
export class MediaError extends Error { constructor(readonly status: number, readonly code: string) { super(code) } }
const invalid = () => new MediaError(502, 'INVALID_MEDIA_RESPONSE')
const canceled = () => new DOMException('Canceled', 'AbortError')
async function sha256(bytes: BufferSource) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('') }
export function validatePostPhoto(value: PostPhoto): PostPhoto {
  if (!value || !uuid.test(value.id) || !positive(value.version) || value.mimeType !== 'image/webp' || !positive(value.byteSize) || value.byteSize > MAX_OUTPUT
    || !positive(value.width) || !positive(value.height) || Math.max(value.width, value.height) > 2048) throw invalid()
  return value
}
function media(value: MediaDTO, id?: string, purpose: MediaPurpose = 'post_attachment') {
  if (!value || !uuid.test(value.id) || id !== undefined && value.id !== id || value.purpose !== purpose
    || !['awaiting_upload', 'verifying', 'ready', 'rejected', 'revoked', 'deleted'].includes(value.status)
    || !inputTypes.includes(value.mimeType) || !positive(value.byteSize) || value.byteSize > MAX_INPUT || !positive(value.version) || !positive(value.authorizationVersion)
    || !instant(value.createdAt) || !instant(value.updatedAt)) throw invalid()
  if (value.status === 'ready') validatePostPhoto(value as PostPhoto)
  return value
}

// Service photo preflight. Prototype-only albums and chat retain their own helper.
export function socialPhotoDataUrl(file: File): Promise<string> {
  if (!inputTypes.includes(file.type) || !file.size || file.size > MAX_INPUT) return Promise.reject(new MediaError(400, 'INVALID_PHOTO_INPUT'))
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new MediaError(400, 'INVALID_PHOTO_INPUT'))
    reader.onload = () => {
      const image = new Image()
      image.onerror = () => reject(new MediaError(400, 'INVALID_PHOTO_INPUT'))
      image.onload = () => {
        try {
          if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 32000000) throw new MediaError(400, 'INVALID_PHOTO_INPUT')
          const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight)), canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
          const drawing = canvas.getContext('2d'); if (!drawing) throw new MediaError(400, 'INVALID_PHOTO_INPUT')
          drawing.fillStyle = '#ffffff'; drawing.fillRect(0, 0, canvas.width, canvas.height); drawing.drawImage(image, 0, 0, canvas.width, canvas.height)
          resolve(canvas.toDataURL('image/jpeg', .86))
        } catch (error) { reject(error) }
      }
      image.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

export async function preparePhotos(sources: string[]): Promise<PreparedPhoto[]> {
  if (sources.length > 9) throw new MediaError(400, 'INVALID_PHOTO_INPUT')
  const result: PreparedPhoto[] = []
  for (const source of sources) {
    if (typeof source !== 'string' || source.length > MAX_INPUT * 1.4 + 64) throw new MediaError(400, 'INVALID_PHOTO_INPUT')
    const parts = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(source)
    if (!parts) throw new MediaError(400, 'INVALID_PHOTO_INPUT')
    let bytes: Uint8Array<ArrayBuffer>
    try { bytes = Uint8Array.from(atob(parts[2]), c => c.charCodeAt(0)) } catch { throw new MediaError(400, 'INVALID_PHOTO_INPUT') }
    if (!bytes.length || bytes.length > MAX_INPUT) throw new MediaError(400, 'INVALID_PHOTO_INPUT')
    result.push({ blob: new Blob([bytes], { type: parts[1] }), mimeType: parts[1], byteSize: bytes.length, sha256: await sha256(bytes) })
  }
  return result
}

export class MediaClient {
  private requests = new Set<AbortController>()
  private intents = new Map<string, UploadIntent>()
  private keys = new Map<string, Set<string>>()
  constructor(readonly context: MediaContext, readonly purpose: MediaPurpose = 'post_attachment', readonly conversationId?: string, private capture?: CaptureUploadJournal) {
    if (capture && (purpose !== 'conversation_attachment' || !uuid.test(capture.operationId))) throw new MediaError(400, 'INVALID_PHOTO_INPUT')
  }
  private target(id: string, reading = false) {
    if (this.purpose === 'conversation_attachment') {
      if (!this.conversationId || !uuid.test(this.conversationId)) throw new MediaError(400, 'INVALID_PHOTO_INPUT')
      return { kind: 'conversation_message', id, conversationId: this.conversationId }
    }
    return { kind: this.purpose === 'gift_delivery_photo' ? 'gift_delivery' : this.purpose === 'person_photo' ? 'person_draft' : reading ? 'post' : 'post_intent', id }
  }
  dispose() { for (const request of this.requests) request.abort(); this.requests.clear() }
  private current() { if (!this.context.live()) throw canceled() }
  private async call<T>(path: string, init: RequestInit, consume: (response: Response) => Promise<T>, signal?: AbortSignal, timeout = 15000) {
    this.current()
    const controller = new AbortController(); this.requests.add(controller)
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      const headers = new Headers(init.headers); headers.set('X-Xijie-Expected-Session', this.context.sessionId)
      const response = await fetch(path, { ...init, headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal })
      this.current()
      if (!response.ok) {
        const value = await response.json().catch(() => null); this.current()
        if (response.status === 401) this.context.onUnauthorized()
        throw new MediaError(response.status, value?.error?.code ?? 'MEDIA_REQUEST_FAILED')
      }
      const result = await consume(response); this.current(); return result
    } finally { clearTimeout(timer); this.requests.delete(controller) }
  }
  private json<T>(path: string, init: RequestInit = {}, signal?: AbortSignal) {
    return this.call(path, init, async response => { const value = await response.json(); if (!value || value.data == null) throw invalid(); return value.data as T }, signal)
  }
  private async save(storageKey: string, value: UploadIntent) {
    this.current(); if (this.capture) { await this.capture.write(value); this.current() }; this.intents.set(storageKey, value)
    try { sessionStorage.setItem(storageKey, JSON.stringify(value)) } catch { /* The current scope retains operation identities. */ }
  }
  private async journalKey(clientPostId: string, index: number, photo: PhotoUploadMetadata, operationKey?: string) {
    const parts = [clientPostId, index, photo.sha256, photo.mimeType, photo.byteSize, ...(operationKey ? [operationKey] : [])]
    // Preserve existing space-post operation identities across this extension.
    const hash = await sha256(new TextEncoder().encode(JSON.stringify(this.purpose === 'post_attachment' ? parts : [this.purpose, ...parts])))
    this.current()
    return 'xijie.media.intent.' + this.context.accountId + '.' + hash
  }
  private async identity(clientPostId: string, index: number, photo: PhotoUploadMetadata, operationKey?: string) {
    if (this.capture && (clientPostId !== this.capture.operationId || operationKey !== this.capture.operationId || index !== 0)) throw new MediaError(409, 'PHOTO_INTENT_PENDING')
    const storageKey = await this.journalKey(clientPostId, index, photo, operationKey)
    let value = this.intents.get(storageKey)
    if (!value) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as UploadIntent | null
        if (saved && [saved.allocateKey, saved.uploadKey, saved.completeKey].every(k => uuid.test(k))
          && (saved.mediaId === undefined || uuid.test(saved.mediaId)) && (saved.uploadSlotId === undefined || uuid.test(saved.uploadSlotId))
          && (!saved.renewal || !!saved.mediaId && positive(saved.renewal.version) && [saved.renewal.key, saved.renewal.uploadKey, saved.renewal.completeKey].every(k => uuid.test(k)))) value = saved
      } catch { /* Corrupt metadata never grants access. */ }
      if (this.capture?.read()) value = this.capture.read()
      if (!value) value = this.capture ? { allocateKey: await this.capture.key('allocate'), uploadKey: await this.capture.key('upload'), completeKey: await this.capture.key('complete') }
        : { allocateKey: crypto.randomUUID(), uploadKey: crypto.randomUUID(), completeKey: crypto.randomUUID() }
      await this.save(storageKey, value)
    }
    const keys = this.keys.get(clientPostId) ?? new Set<string>(); keys.add(storageKey); this.keys.set(clientPostId, keys)
    return { storageKey, value }
  }
  // Local retirement of one stalled chat photo. Derivation never allocates an
  // upload identity or calls a service; the returned edits are synchronous so
  // the parent photo marker can be cleared or restored in the same turn.
  async conversationUploadJournal(photo: PhotoUploadMetadata, targetId: string, operationKey: string) {
    this.current()
    if (this.purpose !== 'conversation_attachment' || !uuid.test(this.context.accountId) || !uuid.test(targetId) || !uuid.test(operationKey)
      || !inputTypes.includes(photo.mimeType) || !positive(photo.byteSize) || photo.byteSize > MAX_INPUT || !/^[a-f0-9]{64}$/.test(photo.sha256)) throw new MediaError(400, 'INVALID_PHOTO_INPUT')
    this.target(targetId)
    const key = await this.journalKey(targetId, 0, photo, operationKey)
    const unavailable = () => new MediaError(503, 'PHOTO_RETRY_STORAGE_UNAVAILABLE')
    let previous: string | null
    try { previous = sessionStorage.getItem(key) } catch { throw unavailable() }
    const cached = this.intents.get(key)
    return {
      remove: () => {
        this.current()
        try {
          if (sessionStorage.getItem(key) !== previous) throw new MediaError(409, 'PHOTO_RETRY_CHANGED')
          sessionStorage.removeItem(key)
          if (sessionStorage.getItem(key) !== null) throw unavailable()
          this.intents.delete(key); this.keys.get(targetId)?.delete(key)
        } catch (error) { throw error instanceof MediaError ? error : unavailable() }
      },
      restore: () => {
        this.current()
        try {
          const current = sessionStorage.getItem(key)
          if (current !== null && current !== previous) throw new MediaError(409, 'PHOTO_RETRY_CHANGED')
          if (previous !== null) sessionStorage.setItem(key, previous)
          if (sessionStorage.getItem(key) !== previous) throw unavailable()
          if (cached) this.intents.set(key, cached)
          if (previous !== null || cached) { const keys = this.keys.get(targetId) ?? new Set<string>(); keys.add(key); this.keys.set(targetId, keys) }
        } catch (error) { throw error instanceof MediaError ? error : unavailable() }
      },
    }
  }
  finish(clientPostId: string) {
    for (const key of this.keys.get(clientPostId) ?? []) { this.intents.delete(key); try { sessionStorage.removeItem(key) } catch { /* No raw photo content is stored. */ } }
    this.keys.delete(clientPostId)
  }
  async forgetUpload(photos: PhotoUploadMetadata[], targetId: string, operationKey: string) {
    for (const [index, photo] of photos.entries()) await this.identity(targetId, index, photo, operationKey)
    this.finish(targetId)
  }
  private async ready(id: string, initial?: MediaDTO) {
    const deadline = Date.now() + 90000
    let value = initial ?? media(await this.json<MediaDTO>('/v1/media/' + id), id, this.purpose)
    while (value.status === 'verifying') {
      if (Date.now() >= deadline) throw new MediaError(408, 'MEDIA_PROCESSING_TIMEOUT')
      await new Promise(resolve => setTimeout(resolve, 750)); this.current()
      value = media(await this.json<MediaDTO>('/v1/media/' + id), id, this.purpose)
    }
    if (value.status !== 'ready') throw new MediaError(409, this.purpose === 'gift_delivery_photo' && ['rejected','revoked','deleted'].includes(value.status) ? 'PHOTO_NOT_READY' : value.failureCode ?? 'PHOTO_NOT_READY')
    return value.id
  }
  async upload(photos: PreparedPhoto[], clientPostId: string, operationKey?: string) { return this.uploadOrResume(photos, clientPostId, operationKey) }
  // A refreshed gift journey can finish an upload/complete whose response was
  // lost without persisting the captured bytes or allocating another object.
  async resumeUpload(photos: PhotoUploadMetadata[], targetId: string, operationKey: string) {
    if (!['gift_delivery_photo', 'conversation_attachment'].includes(this.purpose)) throw new MediaError(400, 'INVALID_PHOTO_INPUT')
    return this.uploadOrResume(photos, targetId, operationKey)
  }
  private async uploadOrResume(photos: (PhotoUploadMetadata & { blob?: Blob })[], clientPostId: string, operationKey?: string) {
    if (!uuid.test(clientPostId) || photos.length < 1 || photos.length > (['gift_delivery_photo', 'conversation_attachment'].includes(this.purpose) ? 1 : this.purpose === 'person_photo' ? 6 : 9)
      || operationKey !== undefined && !uuid.test(operationKey)
      || photos.some(photo => !inputTypes.includes(photo.mimeType) || !positive(photo.byteSize) || photo.byteSize > MAX_INPUT || !/^[a-f0-9]{64}$/.test(photo.sha256))) throw new MediaError(400, 'INVALID_PHOTO_INPUT')
    const ids: string[] = []
    for (const [index, photo] of photos.entries()) {
      this.current()
      const identity = await this.identity(clientPostId, index, photo, operationKey)
      try {
      let intent = identity.value
      if (intent.mediaId) {
        let current: MediaDTO | undefined
        try { current = media(await this.json<MediaDTO>('/v1/media/' + intent.mediaId), intent.mediaId, this.purpose) }
        catch (error) { if (!(this.purpose === 'person_photo' && error instanceof MediaError && error.status === 404)) throw error }
        if (current && (current.status === 'ready' || current.status === 'verifying')) { ids.push(await this.ready(current.id, current)); continue }
        if (['gift_delivery_photo', 'conversation_attachment'].includes(this.purpose) && current && ['rejected', 'revoked', 'deleted'].includes(current.status)) throw new MediaError(409, 'PHOTO_NOT_READY')
        if (!current || ['rejected', 'revoked', 'deleted'].includes(current.status)) {
          if (this.capture) throw new MediaError(409, 'PHOTO_NOT_READY')
          intent = { allocateKey: crypto.randomUUID(), uploadKey: crypto.randomUUID(), completeKey: crypto.randomUUID() }; await this.save(identity.storageKey, intent)
        }
      }
      const renewal = this.purpose === 'conversation_attachment' ? intent.renewal : undefined
      const created = renewal ? await this.json<{ media: MediaDTO; upload: Upload }>('/v1/media/' + intent.mediaId + '/upload-slots', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': renewal.key, 'If-Match': '"v' + renewal.version + '"' }, body: '{}',
      }) : await this.json<{ media: MediaDTO; upload: Upload }>('/v1/media', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': intent.allocateKey }, body: JSON.stringify({ mimeType: photo.mimeType, byteSize: photo.byteSize, sha256: photo.sha256, purpose: this.purpose, target: this.target(clientPostId) }) })
      const resource = media(created?.media, undefined, this.purpose), slot = created?.upload
      if (renewal) {
        if (resource.id !== intent.mediaId) throw invalid()
        if (this.capture && (!slot || !uuid.test(slot.id))) throw invalid()
        intent = { ...intent, uploadKey: renewal.uploadKey, completeKey: renewal.completeKey, renewal: undefined, ...(this.capture ? { uploadSlotId: slot.id } : {}) }; await this.save(identity.storageKey, intent)
      }
      if (resource.status === 'ready' || resource.status === 'verifying') { intent = { ...intent, mediaId: resource.id }; await this.save(identity.storageKey, intent); ids.push(await this.ready(resource.id, resource)); continue }
      if (resource.status !== 'awaiting_upload' || resource.mimeType !== photo.mimeType || resource.byteSize !== photo.byteSize || !slot || !uuid.test(slot.id)
        || slot.method !== 'PUT' || slot.url !== '/v1/media/' + resource.id + '/uploads/' + slot.id || !instant(slot.expiresAt)
        || !slot.requiredHeaders || Object.keys(slot.requiredHeaders).length !== 1 || slot.requiredHeaders['Content-Type'] !== photo.mimeType) throw invalid()
      intent = { ...intent, mediaId: resource.id, uploadSlotId: slot.id }; await this.save(identity.storageKey, intent)
      try {
        if (Date.parse(slot.expiresAt) <= Date.now()) throw new MediaError(409, 'UPLOAD_SLOT_EXPIRED')
        if (photo.blob) await this.call(slot.url, { method: 'PUT', headers: { ...slot.requiredHeaders, 'Idempotency-Key': intent.uploadKey }, body: photo.blob }, async () => undefined, undefined, 30000)
        const accepted = media(await this.json<MediaDTO>('/v1/media/' + resource.id + '/complete', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': intent.completeKey }, body: JSON.stringify({ uploadSlotId: slot.id }) }), resource.id, this.purpose)
        ids.push(await this.ready(resource.id, accepted))
      } catch (error) {
        // A confirmed expired slot cannot accept this operation. Its next manual
        // attempt uses a fresh allocation, unlike an unknown transport result.
        if (this.purpose !== 'conversation_attachment' && photo.blob && error instanceof MediaError && error.code === 'UPLOAD_SLOT_EXPIRED') await this.save(identity.storageKey, { allocateKey: crypto.randomUUID(), uploadKey: crypto.randomUUID(), completeKey: crypto.randomUUID() })
        if (this.purpose === 'conversation_attachment' && error instanceof MediaError && error.code === 'UPLOAD_SLOT_EXPIRED') await this.save(identity.storageKey, {
          ...intent, renewal: { key: this.capture ? await this.capture.key('renewal:' + resource.version) : crypto.randomUUID(), version: resource.version,
            uploadKey: this.capture ? await this.capture.key('renewal-upload:' + resource.version) : crypto.randomUUID(), completeKey: this.capture ? await this.capture.key('renewal-complete:' + resource.version) : crypto.randomUUID() },
        })
        throw error
      }
      } catch (error) {
        // This method is used only before Social submission. A confirmed
        // changed upload authorization retires this allocation, while keeping
        // its parent post identity. Submitted posts replay their fixed IDs.
        if (!['gift_delivery_photo', 'conversation_attachment'].includes(this.purpose) && error instanceof MediaError && error.code === 'AUTHORIZATION_CHANGED') await this.save(identity.storageKey, { allocateKey: crypto.randomUUID(), uploadKey: crypto.randomUUID(), completeKey: crypto.randomUUID() })
        throw error
      }
    }
    this.current(); return ids
  }
  async describe(id: string) { return validatePostPhoto(media(await this.json<MediaDTO>('/v1/media/' + id), id, this.purpose) as PostPhoto) }
  async read(photo: PostPhoto, postId: string, signal: AbortSignal) {
    validatePostPhoto(photo); if (!uuid.test(postId)) throw invalid()
    const proof = await this.json<{ mode: string; url: string; expiresAt: string; authorizationVersion: number; readProof: string }>('/v1/media/' + photo.id + '/read-url', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ purpose: this.purpose, target: this.target(postId, true) }),
    }, signal)
    if (!proof || proof.mode !== 'authorized_stream' || proof.url !== '/v1/media/' + photo.id + '/content' || !instant(proof.expiresAt) || Date.parse(proof.expiresAt) <= Date.now()
      || !positive(proof.authorizationVersion) || typeof proof.readProof !== 'string' || proof.readProof.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(proof.readProof)) throw invalid()
    return this.call(proof.url, { headers: { 'X-Media-Read-Proof': proof.readProof } }, async response => {
      const blob = await response.blob()
      if (blob.type !== photo.mimeType || blob.size !== photo.byteSize || blob.size > MAX_OUTPUT) throw invalid()
      return blob
    }, signal)
  }
}
