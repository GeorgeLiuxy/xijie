import { useEffect, useMemo, useRef, useState } from 'react'
import { getGift } from './gifts/catalog'
import type { GiftReceipt } from './gifts/types'
import type { PostPhoto } from './model'
import { MediaClient, MediaError, preparePhotos, validatePostPhoto, type PhotoUploadMetadata, type PreparedPhoto } from './serviceMedia'

type Context = { accountId: string; sessionId: string; onUnauthorized: () => void }
export type GiftPhotoView = { deliveryId: string; version: number; photo: PostPhoto | null; updatedAt: string | null; origin: 'journey_capture' }
export type GiftPhotoIntent = { key: string; deliveryId: string; version: number; upload: PhotoUploadMetadata; mediaId?: string }
type Snapshot = { urls: Record<string, string>; revision: number; error?: string }
export type GiftPhotoService = Snapshot & {
  prepare: (receipt: GiftReceipt) => Promise<GiftPhotoView>
  save: (id: string, version: number, source: string, revision: number) => Promise<void>
  retry: (id: string) => Promise<void>
  pending: (id: string) => GiftPhotoIntent | undefined
  refresh: () => Promise<void>
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0
const canceled = () => new DOMException('Canceled', 'AbortError')
const invalid = () => new MediaError(502, 'INVALID_GIFT_PHOTO_RESPONSE')
export function validateGiftPhoto(value: GiftPhotoView, id?: string) {
  if (!value || !uuid.test(value.deliveryId) || id !== undefined && value.deliveryId !== id || !positive(value.version) || value.origin !== 'journey_capture'
    || value.updatedAt !== null && (typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt)))
    || value.photo === null && value.version !== 1 || value.photo !== null && (value.version < 2 || value.updatedAt === null)) throw invalid()
  if (value.photo !== null) validatePostPhoto(value.photo)
  return value
}
export function compatibleJourney(receipt: GiftReceipt) {
  return receipt.status === 'arrived' && receipt.lines.length > 0 && receipt.lines.every(line => {
    const template = getGift(line.giftId), snapshot = line.snapshot
    return !!template && positive(line.quantity) && line.quantity <= 99 && snapshot.id === line.giftId
      && snapshot.version === template.version && snapshot.render === template.render && snapshot.effect === template.effect
  })
}

// The independent resource owns only the single journey capture. Its version,
// command and private blob URLs never enter delivery, chat, ledger or AI DTOs.
export class GiftPhotoClient {
  private revision = 0
  private reading = 0
  private requests = new Set<AbortController>()
  private mediaClients = new Set<MediaClient>()
  private photos = new Map<string, GiftPhotoView>()
  private urls = new Map<string, { signature: string; url: string }>()
  private intents = new Map<string, GiftPhotoIntent>()
  private captures = new Map<string, PreparedPhoto>()
  private writing = new Set<string>()
  private preparing = new Set<string>()
  private visible = true
  constructor(private context: Context & { live: () => boolean }, private changed: (value: Snapshot) => void) {}
  private check(revision = this.revision) { if (!this.context.live() || revision !== this.revision) throw canceled() }
  private emit(error?: string) { if (this.context.live()) this.changed({ urls: Object.fromEntries([...this.urls].map(([id, item]) => [id, item.url])), revision: this.revision, error }) }
  private key(id: string) { return 'xijie.gift-photo.intent.' + this.context.accountId + '.' + id }
  pending = (id: string): GiftPhotoIntent | undefined => {
    if (!uuid.test(id)) return undefined
    let value = this.intents.get(id)
    if (!value) try {
      const stored = JSON.parse(sessionStorage.getItem(this.key(id)) ?? 'null') as GiftPhotoIntent | null
      if (stored && stored.deliveryId === id && uuid.test(stored.key) && positive(stored.version) && (stored.mediaId === undefined || uuid.test(stored.mediaId))
        && stored.upload && ['image/jpeg','image/png','image/webp'].includes(stored.upload.mimeType) && positive(stored.upload.byteSize) && stored.upload.byteSize <= 10 * 1024 * 1024
        && /^[a-f0-9]{64}$/.test(stored.upload.sha256)) value = { key: stored.key, deliveryId: id, version: stored.version,
          upload: { mimeType: stored.upload.mimeType, byteSize: stored.upload.byteSize, sha256: stored.upload.sha256 }, ...(stored.mediaId ? { mediaId: stored.mediaId } : {}) }
    } catch { /* Stored metadata never grants permission or supplies picture bytes. */ }
    if (value) this.intents.set(id, value)
    return value
  }
  private remember(id: string, intent?: GiftPhotoIntent) {
    this.check()
    if (intent) this.intents.set(id, intent); else { this.intents.delete(id); this.captures.delete(id) }
    try { if (intent) sessionStorage.setItem(this.key(id), JSON.stringify(intent)); else sessionStorage.removeItem(this.key(id)) } catch { /* The mounted session retains the same operation. */ }
    this.emit()
  }
  private media(revision: number) {
    const client = new MediaClient({ ...this.context, live: () => this.context.live() && revision === this.revision }, 'gift_delivery_photo')
    this.mediaClients.add(client); return client
  }
  private async request<T>(path: string, init?: RequestInit) {
    const revision = this.revision; this.check(revision)
    const controller = new AbortController(); this.requests.add(controller)
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const headers = new Headers(init?.headers); headers.set('X-Xijie-Expected-Session', this.context.sessionId)
      const response = await fetch(path, { ...init, headers, signal: controller.signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error' })
      this.check(revision); const result = await response.json().catch(() => null); this.check(revision)
      if (!response.ok) { if (response.status === 401) this.context.onUnauthorized(); throw new MediaError(response.status, result?.error?.code ?? 'GIFT_PHOTO_REQUEST_FAILED') }
      if (result?.data == null) throw invalid()
      return result as { data: T; meta?: { nextCursor?: string | null } }
    } finally { clearTimeout(timer); this.requests.delete(controller) }
  }
  private removeUrl(id: string) { const old = this.urls.get(id); if (old) URL.revokeObjectURL(old.url); this.urls.delete(id) }
  invalidate = () => {
    this.revision++; this.reading++
    this.requests.forEach(value => value.abort()); this.mediaClients.forEach(value => value.dispose())
    this.captures.clear(); this.photos.clear(); [...this.urls.keys()].forEach(id => this.removeUrl(id)); this.emit()
  }
  dispose = () => { this.invalidate(); this.mediaClients.clear() }
  setVisible = (visible: boolean) => {
    this.visible = visible
    if (!visible) { [...this.urls.keys()].forEach(id => this.removeUrl(id)); this.emit() }
  }
  private async hydrate(value: GiftPhotoView, revision: number) {
    this.check(revision)
    const current = this.photos.get(value.deliveryId)
    if (current && current.version > value.version) return current
    this.photos.set(value.deliveryId, value)
    const signature = JSON.stringify(value), existing = this.urls.get(value.deliveryId)
    if (existing?.signature === signature) return value
    this.removeUrl(value.deliveryId); this.emit()
    if (!value.photo || !this.visible) return value
    const client = this.media(revision), controller = new AbortController(); this.requests.add(controller)
    try {
      const blob = await client.read(value.photo, value.deliveryId, controller.signal); this.check(revision)
      if (!this.visible || JSON.stringify(this.photos.get(value.deliveryId)) !== signature) return value
      this.removeUrl(value.deliveryId); this.urls.set(value.deliveryId, { signature, url: URL.createObjectURL(blob) }); this.emit()
    } finally { client.dispose(); this.mediaClients.delete(client); this.requests.delete(controller) }
    return value
  }
  private denied(error: unknown) { return error instanceof MediaError && ([401,403,404].includes(error.status) || error.code === 'AUTHORIZATION_CHANGED') }
  refresh = async () => {
    const revision = this.revision, reading = ++this.reading
    try {
      const values: GiftPhotoView[] = [], cursors = new Set<string>(); let cursor: string | null = null
      do {
        const result: { data: GiftPhotoView[]; meta?: { nextCursor?: string | null } } = await this.request<GiftPhotoView[]>('/v1/gift-delivery-photos?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''))
        if (!Array.isArray(result.data)) throw invalid(); result.data.forEach(value => validateGiftPhoto(value)); values.push(...result.data)
        cursor = result.meta?.nextCursor ?? null
        if (cursor && (typeof cursor !== 'string' || cursors.has(cursor) || cursors.size >= 100)) throw invalid()
        if (cursor) cursors.add(cursor)
      } while (cursor)
      this.check(revision); if (reading !== this.reading) return
      if (new Set(values.map(value => value.deliveryId)).size !== values.length || values.some(value => value.photo === null)) throw invalid()
      for (const id of this.photos.keys()) if (!values.some(value => value.deliveryId === id)) { this.photos.delete(id); this.removeUrl(id) }
      this.emit()
      await Promise.all(values.map(value => this.hydrate(value, revision).catch(error => { this.check(revision); if (JSON.stringify(this.photos.get(value.deliveryId)) === JSON.stringify(value)) this.removeUrl(value.deliveryId); this.emit(error instanceof MediaError ? error.code : 'GIFT_PHOTO_REQUEST_FAILED') })))
    } catch (error) {
      if (!this.context.live() || revision !== this.revision || reading !== this.reading) return
      if (this.denied(error)) { this.photos.clear(); [...this.urls.keys()].forEach(id => this.removeUrl(id)) }
      this.emit(error instanceof MediaError ? error.code : 'GIFT_PHOTO_REQUEST_FAILED')
    }
  }
  prepare = async (receipt: GiftReceipt) => {
    this.check()
    if (!uuid.test(receipt.id)) throw invalid()
    if (receipt.status !== 'arrived') throw new MediaError(409, 'DELIVERY_NOT_ARRIVED')
    if (!compatibleJourney(receipt)) throw new MediaError(409, 'JOURNEY_UNAVAILABLE')
    const revision = this.revision
    let value: GiftPhotoView
    try { value = validateGiftPhoto((await this.request<GiftPhotoView>('/v1/gift-deliveries/' + receipt.id + '/photo')).data, receipt.id) }
    catch (error) { if (this.context.live() && revision === this.revision && this.denied(error)) { this.removeUrl(receipt.id); this.emit(error instanceof MediaError ? error.code : undefined) } throw error }
    this.check(revision); this.reading++
    // A photo read failure must not prevent viewing an otherwise authorized
    // journey; the receipt keeps its original icon until private bytes arrive.
    void this.hydrate(value, revision).catch(() => {})
    return value
  }
  save = async (id: string, version: number, source: string, expectedRevision: number) => {
    this.check(expectedRevision); if (!uuid.test(id) || !positive(version)) throw invalid()
    if (this.pending(id) || this.preparing.has(id)) throw new MediaError(409, 'PENDING_GIFT_PHOTO')
    this.preparing.add(id)
    try {
      const revision = this.revision, [capture] = await preparePhotos([source]); this.check(revision)
      const { blob: _blob, ...upload } = capture
      const intent: GiftPhotoIntent = { key: crypto.randomUUID(), deliveryId: id, version, upload }
      this.captures.set(id, capture); this.remember(id, intent)
      return await this.retry(id)
    } finally { this.preparing.delete(id) }
  }
  retry = async (id: string) => {
    this.check(); let intent = this.pending(id)
    if (!intent) throw new MediaError(409, 'NO_PENDING_OPERATION')
    if (this.writing.has(id)) throw new MediaError(409, 'REQUEST_IN_PROGRESS')
    this.writing.add(id); const revision = this.revision, client = this.media(revision)
    let binding = false, accepted = false
    try {
      if (!intent.mediaId) {
        const capture = this.captures.get(id)
        const [mediaId] = capture ? await client.upload([capture], id, intent.key) : await client.resumeUpload([intent.upload], id, intent.key)
        this.check(revision); intent = { ...intent, mediaId }; this.remember(id, intent)
      }
      binding = true
      const value = (await this.request<GiftPhotoView>('/v1/gift-deliveries/' + id + '/photo', { method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': intent.key, 'If-Match': '"v' + intent.version + '"' }, body: JSON.stringify({ mediaId: intent.mediaId }) })).data
      accepted = true; validateGiftPhoto(value, id); this.check(revision); this.reading++
      // A replay returns the current resource, which can already be a newer
      // replacement. Never reconstruct the visible photo from the submitted ID.
      this.remember(id); client.finish(id)
      await this.hydrate(value, revision).catch(error => {
        this.check(revision)
        // The write is confirmed. A failed image read retries independently and
        // must not turn the next watch into another submission of this capture.
        this.emit(error instanceof MediaError ? error.code : 'GIFT_PHOTO_REQUEST_FAILED')
      })
    } catch (error) {
      if (this.context.live() && revision === this.revision && error instanceof MediaError) {
        if (!accepted && (binding ? ['VERSION_CONFLICT','PHOTO_SELECTION_INVALID','DELIVERY_NOT_ARRIVED','VALIDATION_FAILED'].includes(error.code)
          : ['AUTHORIZATION_CHANGED','PHOTO_NOT_READY','MEDIA_UPLOAD_NOT_COMPLETE'].includes(error.code) || error.code === 'UPLOAD_SLOT_EXPIRED' && !this.captures.has(id))) {
          this.remember(id); void this.refresh()
        }
        if (this.denied(error)) { this.removeUrl(id); this.emit(error.code) }
      }
      throw error
    } finally { this.writing.delete(id); client.dispose(); this.mediaClients.delete(client) }
  }
}

export function useServiceGiftPhotos(context: Context | undefined): GiftPhotoService | undefined {
  const latest = useRef(context); latest.current = context
  const key = context ? JSON.stringify([context.accountId, context.sessionId]) : ''
  const [view, setView] = useState<{ key: string; snapshot: Snapshot }>({ key: '', snapshot: { urls: {}, revision: 0 } })
  const owner = useMemo(() => {
    if (!context) return undefined
    const scope = { alive: true, client: null as unknown as GiftPhotoClient }
    scope.client = new GiftPhotoClient({ ...context, onUnauthorized: () => latest.current?.onUnauthorized(),
      live: () => scope.alive && latest.current?.accountId === context.accountId && latest.current?.sessionId === context.sessionId }, snapshot => setView({ key, snapshot }))
    return scope
  }, [key])
  useEffect(() => {
    if (!owner) return
    owner.alive = true
    const refresh = () => { if (document.visibilityState !== 'hidden') void owner.client.refresh() }
    const changed = () => { owner.client.invalidate(); refresh() }
    const visible = () => { owner.client.setVisible(document.visibilityState !== 'hidden'); refresh() }
    window.addEventListener('focus', refresh); window.addEventListener('xijie:consents-changed', changed); document.addEventListener('visibilitychange', visible)
    const timer = window.setInterval(refresh, 5000); refresh()
    return () => { owner.alive = false; owner.client.dispose(); window.clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('xijie:consents-changed', changed); document.removeEventListener('visibilitychange', visible) }
  }, [owner])
  if (!owner) return undefined
  return { ...(view.key === key ? view.snapshot : { urls: {}, revision: 0 }), prepare: owner.client.prepare, save: owner.client.save,
    retry: owner.client.retry, pending: owner.client.pending, refresh: owner.client.refresh }
}
