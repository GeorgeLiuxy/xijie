import { useEffect, useMemo, useRef, useState } from 'react'
import { WORLD_IDS, type WorldId } from './i18n'
import { nid, type Person } from './model'
import type { GiftDefinition, GiftReceipt, GiftSendInput, GiftState, ReceivedGift } from './gifts/types'
import type { GiftPhotoService } from './serviceGiftPhotos'

export type GiftDeliveryDTO = {
  id: string; personId: string; conversationId: string; version: number; giftSnapshot: GiftDefinition
  personSnapshot: { id: string; displayName: string; worldId: string; version: number; worldVersion: number; accessVersion: number; audience: 'person' }
  quantity: number; note: string; source: 'trial' | 'inventory' | 'voucher'; cost: number
  status: 'in_transit' | 'arrived' | 'delivery_failed'; createdAt: string; scheduledArrivalAt: string; arrivedAt: string | null; failedAt: string | null
  debitTransactionId: string | null; reversalTransactionId: string | null
}
export type ReceivedGiftDTO = {
  id: string; personId: string; conversationId: string; sourceDeliveryId: string; personSnapshot: GiftDeliveryDTO['personSnapshot']; giftSnapshot: GiftDefinition
  quantity: 1; note: string; version: number; createdAt: string; openedAt: string | null; placement: null | 'record' | 'space'; displayable: boolean
  origin: { kind: 'persona_return'; contentOrigin: 'ai_generated'; policyVersion: 'person-gift-returns-v1'; generationJobId: string }
}
export type GiftNotification = {
  id: string; version: number; type: 'gift_arrived' | 'gift_failed' | 'gift_received'; createdAt: string; readAt: string | null
  sourceEventId: string; objectId: string; personId: string; target: { kind: 'delivery' | 'received_gift'; id: string }
}
export type GiftMutationIntent = { key: string; kind: 'open' | 'placement' | 'read'; version: number | null; body: Record<string, unknown> }
type CatalogItem = GiftDefinition & { unitPostage: number; acceptsVoucher: boolean; availableSources?: ('trial' | 'inventory' | 'voucher')[] }
type Wallet = { version: number; asOf: string; balances: { assetType: 'postage' | 'inventory' | 'voucher'; assetId: string; source: string; availableUnits: number; nearestExpiryAt: string | null }[] }
export type GiftLedgerTransaction = {
  transactionId: string; reason: string; sourceId: string; createdAt: string; policyVersion: string; originalTransactionId: string | null
  entries: { assetType: 'postage' | 'inventory' | 'voucher'; assetId: string; source: string; direction: 'debit' | 'credit'; units: number; lotId: string }[]
}
export function giftLedgerUsage(ledger: GiftLedgerTransaction[], receipts: GiftReceipt[]) {
  return ledger.filter(transaction => ['gift_debit', 'gift_reversal'].includes(transaction.reason)).flatMap(transaction => {
    const receiptId = transaction.reason === 'gift_reversal' ? transaction.sourceId.replace(/^gift_reversal:/, '') : transaction.sourceId
    const receipt = receipts.find(value => value.id === receiptId || value.debitTransactionId === transaction.transactionId)
    const amounts = new Map<string, { assetType: 'postage' | 'inventory' | 'voucher'; units: number }>()
    for (const entry of transaction.entries) {
      const key = JSON.stringify([entry.assetType, entry.assetId, entry.source])
      const amount = amounts.get(key) ?? { assetType: entry.assetType, units: 0 }
      amount.units += entry.direction === 'credit' ? entry.units : -entry.units
      amounts.set(key, amount)
    }
    return [...amounts].map(([key, amount]) => ({ id: transaction.transactionId + ':' + key, createdAt: transaction.createdAt,
      returned: transaction.reason === 'gift_reversal', receipt, ...amount }))
  })
}
type Body = { personId: string; giftId: string; catalogVersion: number; quantity: number; source: 'trial' | 'inventory' | 'voucher'; note: string }
export type GiftIntent = { key: string; body: Body; definition: GiftDefinition }
type Context = { accountId: string; sessionId: string; onUnauthorized: () => void }
type Envelope<T> = { data: T; meta?: { nextCursor?: string | null; totalCount?: number; unreadCount?: number } }
export type GiftService = {
  photos?: GiftPhotoService
  state: GiftState; catalog: CatalogItem[]; ledger: GiftLedgerTransaction[]; status: 'loading' | 'ready' | 'error'; error?: string
  refresh: () => Promise<void>; send: (input: GiftSendInput) => Promise<GiftReceipt>; pending: (personId?: string) => GiftIntent | undefined
  receivedStatus: 'loading' | 'ready' | 'error'; receivedError?: string
  notifications: GiftNotification[]; notificationsStatus: 'loading' | 'ready' | 'error'; notificationsError?: string; totalCount: number; unreadCount: number
  readReceived: (id: string) => Promise<ReceivedGift>; readDelivery: (id: string) => Promise<GiftReceipt>
  openReceived: (id: string) => Promise<ReceivedGift>; placeReceived: (id: string, placement: 'record' | 'space') => Promise<ReceivedGift>
  retryReceived: (id: string) => Promise<ReceivedGift>; pendingReceived: (id: string) => GiftMutationIntent | undefined
  readNotification: (id: string) => Promise<void>
}
export class GiftServiceError extends Error { constructor(readonly status: number, readonly code: string) { super(code) } }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const instant = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))
const invalid = () => new GiftServiceError(502, 'INVALID_GIFT_RESPONSE')
export const emptyGiftState = (): GiftState => ({ version: 1, credits: 0, inventory: {}, entitlements: {}, receipts: [], received: [], usedRewards: [], goals: [] })
export function validGiftDefinition(item: GiftDefinition) {
  return !!item && typeof item.id === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(item.id) && count(item.version) && item.version > 0
    && typeof item.name === 'string' && !!item.name && typeof item.en === 'string' && !!item.en && count(item.cost)
    && ['emotion','care','pet','home','collection','scenery','experience','journey'].includes(item.category)
    && ['keepsake','prop','scene','build','service','fuel'].includes(item.effect) && typeof item.stackable === 'boolean' && typeof item.available === 'boolean'
    && Array.isArray(item.audience) && item.audience.every(value => ['person','pet','object'].includes(value))
    && typeof item.icon === 'string' && typeof item.render === 'string' && typeof item.outcome === 'string' && typeof item.outcomeEn === 'string'
}
export function validateGiftDelivery(value: GiftDeliveryDTO, personId?: string): GiftDeliveryDTO {
  if (!value || !uuid.test(value.id) || !uuid.test(value.personId) || personId !== undefined && value.personId !== personId
    || !uuid.test(value.conversationId) || !count(value.version) || value.version < 1 || !validGiftDefinition(value.giftSnapshot)
    || value.personSnapshot?.id !== value.personId || !uuid.test(value.personSnapshot.worldId) || !value.personSnapshot.displayName || value.personSnapshot.audience !== 'person'
    || !count(value.personSnapshot.version) || value.personSnapshot.version < 1 || !count(value.personSnapshot.worldVersion) || value.personSnapshot.worldVersion < 1
    || !count(value.personSnapshot.accessVersion) || value.personSnapshot.accessVersion < 1 || !count(value.quantity) || value.quantity < 1 || value.quantity > 99
    || typeof value.note !== 'string' || [...value.note].length > 120 || !count(value.cost) || !['trial','inventory','voucher'].includes(value.source)
    || !['in_transit','arrived','delivery_failed'].includes(value.status) || !instant(value.createdAt) || !instant(value.scheduledArrivalAt)
    || Date.parse(value.scheduledArrivalAt) < Date.parse(value.createdAt)
    || value.arrivedAt !== null && !instant(value.arrivedAt) || value.failedAt !== null && !instant(value.failedAt)
    || value.status === 'arrived' && value.arrivedAt === null || value.status === 'delivery_failed' && value.failedAt === null
    || value.debitTransactionId !== null && !uuid.test(value.debitTransactionId) || value.reversalTransactionId !== null && !uuid.test(value.reversalTransactionId)) throw invalid()
  return value
}
export function validateReceivedGift(value: ReceivedGiftDTO): ReceivedGiftDTO {
  if (!value || !uuid.test(value.id) || !uuid.test(value.personId) || !uuid.test(value.conversationId) || !uuid.test(value.sourceDeliveryId)
    || !validGiftDefinition(value.giftSnapshot) || value.quantity !== 1 || typeof value.note !== 'string' || [...value.note].length > 120
    || !count(value.version) || value.version < 1 || !instant(value.createdAt) || typeof value.displayable !== 'boolean'
    || value.openedAt === null && value.placement !== null || value.openedAt !== null && (!instant(value.openedAt) || Date.parse(value.openedAt) < Date.parse(value.createdAt) || !['record','space'].includes(value.placement ?? ''))
    || value.placement === 'space' && !value.displayable || value.personSnapshot?.id !== value.personId || !uuid.test(value.personSnapshot.worldId)
    || !value.personSnapshot.displayName || value.personSnapshot.audience !== 'person' || !count(value.personSnapshot.version) || value.personSnapshot.version < 1
    || !count(value.personSnapshot.worldVersion) || value.personSnapshot.worldVersion < 1 || !count(value.personSnapshot.accessVersion) || value.personSnapshot.accessVersion < 1
    || value.origin?.kind !== 'persona_return' || value.origin.contentOrigin !== 'ai_generated' || value.origin.policyVersion !== 'person-gift-returns-v1' || !uuid.test(value.origin.generationJobId)) throw invalid()
  return value
}
export function validateGiftNotification(value: GiftNotification): GiftNotification {
  if (!value || !uuid.test(value.id) || !count(value.version) || value.version < 1 || !['gift_arrived','gift_failed','gift_received'].includes(value.type)
    || !instant(value.createdAt) || value.readAt !== null && !instant(value.readAt) || !uuid.test(value.sourceEventId) || !uuid.test(value.objectId) || !uuid.test(value.personId)
    || value.target?.id !== value.objectId || value.target.kind !== (value.type === 'gift_received' ? 'received_gift' : 'delivery')) throw invalid()
  return value
}
const intentStorage = (accountId: string, personId: string) => 'xijie.gift.intent.' + accountId + '.' + personId
function storedIntent(accountId: string, personId: string): GiftIntent | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(intentStorage(accountId, personId)) ?? 'null') as GiftIntent | null
    if (value && uuid.test(value.key) && value.body.personId === personId && validGiftDefinition(value.definition) && value.definition.id === value.body.giftId
      && value.definition.version === value.body.catalogVersion && count(value.body.quantity) && value.body.quantity > 0 && value.body.quantity <= 99
      && ['trial','inventory','voucher'].includes(value.body.source) && typeof value.body.note === 'string' && [...value.body.note].length <= 120) return value
  } catch { /* Browser data is never authority for assets or receipts. */ }
}
type Snapshot = Pick<GiftService, 'state' | 'catalog' | 'ledger' | 'status' | 'error' | 'receivedStatus' | 'receivedError' | 'notifications' | 'notificationsStatus' | 'notificationsError' | 'totalCount' | 'unreadCount'>
const emptySnapshot = (): Snapshot => ({ state: emptyGiftState(), catalog: [], ledger: [], status: 'loading', receivedStatus: 'loading', notifications: [], notificationsStatus: 'loading', totalCount: 0, unreadCount: 0 })

export function useServiceGifts(context: Context | undefined, people: Person[], activePersonId?: string): GiftService | undefined {
  const target = useRef(activePersonId); target.current = activePersonId
  const latest = useRef(context); latest.current = context
  const peopleRef = useRef(people); peopleRef.current = people
  const key = context ? JSON.stringify([context.accountId, context.sessionId]) : ''
  const [view, setView] = useState<{ key: string; snapshot: Snapshot }>({ key: '', snapshot: emptySnapshot() })
  const owner = useMemo(() => {
    if (!context) return undefined
    const scope = { context, alive: true, requests: new Set<AbortController>(), pending: new Map<string, GiftIntent>(), sending: new Set<string>(), reading: 0, permissionRevision: 0,
      catalog: [] as CatalogItem[], wallet: null as Wallet | null, deliveries: [] as GiftDeliveryDTO[], received: [] as ReceivedGiftDTO[], mutations: new Map<string, GiftMutationIntent>(), mutating: new Set<string>(), worlds: new Map<string, WorldId>(), ids: new Map<string, number>(), snapshot: emptySnapshot() }
    const live = () => scope.alive && latest.current?.accountId === context.accountId && latest.current?.sessionId === context.sessionId
    const check = () => { if (!live()) throw new DOMException('Canceled', 'AbortError') }
    const emit = (snapshot: Snapshot) => { if (live()) { scope.snapshot = snapshot; setView({ key, snapshot }) } }
    async function request<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
      check(); const controller = new AbortController(); scope.requests.add(controller)
      const timer = setTimeout(() => controller.abort(), 15000)
      try {
        const headers = new Headers(init?.headers); headers.set('X-Xijie-Expected-Session', scope.context.sessionId)
        const response = await fetch(path, { ...init, headers, signal: controller.signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error' }); check()
        const value = await response.json().catch(() => null); check()
        if (!response.ok) { if (response.status === 401) latest.current?.onUnauthorized(); throw new GiftServiceError(response.status, value?.error?.code ?? 'GIFT_REQUEST_FAILED') }
        if (value?.data == null) throw invalid()
        return value
      } finally { clearTimeout(timer); scope.requests.delete(controller) }
    }
    async function list<T>(route: string) {
      const values: T[] = [], cursors = new Set<string>(); let cursor: string | null = null
      for (let page = 0; page < 100; page++) {
        const query = new URLSearchParams({ limit: '100' }); if (cursor) query.set('cursor', cursor)
        const result: Envelope<T[]> = await request(route + (route.includes('?') ? '&' : '?') + query)
        if (!Array.isArray(result.data)) throw invalid(); values.push(...result.data)
        cursor = result.meta?.nextCursor ?? null
        if (!cursor) return values
        if (cursors.has(cursor)) throw invalid(); cursors.add(cursor)
      }
      throw invalid()
    }
    async function world(id: string) {
      const known = scope.worlds.get(id); if (known) return known
      const value = (await request<{ id: string; code: WorldId }>('/v1/worlds/' + id)).data
      if (value.id !== id || !WORLD_IDS.includes(value.code)) throw invalid()
      scope.worlds.set(id, value.code); return value.code
    }
    async function receipt(value: GiftDeliveryDTO): Promise<GiftReceipt> {
      validateGiftDelivery(value); const code = await world(value.personSnapshot.worldId); check()
      let id = peopleRef.current.find(person => person.serverId === value.personId)?.id ?? scope.ids.get(value.personId)
      if (id === undefined) { id = nid(); scope.ids.set(value.personId, id) }
      return { id: value.id, target: { id, identity: value.personId, name: value.personSnapshot.displayName, world: code, audience: 'person' },
        lines: [{ giftId: value.giftSnapshot.id, quantity: value.quantity, snapshot: value.giftSnapshot }], note: value.note,
        createdAt: Date.parse(value.createdAt), arriveAt: Date.parse(value.scheduledArrivalAt), source: value.source === 'voucher' ? 'reward' : value.source,
        cost: value.cost, status: value.status, serverVersion: value.version, debitTransactionId: value.debitTransactionId, personaReply: false }
    }
    async function receivedGift(value: ReceivedGiftDTO): Promise<ReceivedGift> {
      validateReceivedGift(value); const code = await world(value.personSnapshot.worldId); check()
      let id = peopleRef.current.find(person => person.serverId === value.personId)?.id ?? scope.ids.get(value.personId)
      if (id === undefined) { id = nid(); scope.ids.set(value.personId, id) }
      return { id: value.id, from: { id, identity: value.personId, name: value.personSnapshot.displayName, world: code, audience: 'person' },
        lines: [{ giftId: value.giftSnapshot.id, quantity: value.quantity, snapshot: value.giftSnapshot }], note: value.note, createdAt: Date.parse(value.createdAt),
        origin: 'persona', replyTo: value.sourceDeliveryId, openedAt: value.openedAt === null ? undefined : Date.parse(value.openedAt), placement: value.placement ?? undefined,
        serverVersion: value.version, displayable: value.displayable }
    }
    async function notificationList() {
      const values: GiftNotification[] = [], seen = new Set<string>(); let cursor: string | null = null, totalCount = 0, unreadCount = 0
      for (let page = 0; page < 100; page++) {
        const query = new URLSearchParams({ limit: '100' }); if (cursor) query.set('cursor', cursor)
        const result = await request<GiftNotification[]>('/v1/notifications?' + query)
        if (!Array.isArray(result.data) || !count(result.meta?.totalCount) || !count(result.meta?.unreadCount) || result.meta.unreadCount > result.meta.totalCount) throw invalid()
        result.data.forEach(validateGiftNotification); values.push(...result.data)
        if (!page) { totalCount = result.meta.totalCount; unreadCount = result.meta.unreadCount }
        cursor = result.meta.nextCursor ?? null
        if (!cursor) { if (new Set(values.map(value => value.id)).size !== values.length) throw invalid(); return { notifications: values, totalCount, unreadCount } }
        if (seen.has(cursor)) throw invalid(); seen.add(cursor)
      }
      throw invalid()
    }
    async function state() {
      const result = emptyGiftState()
      if (scope.wallet) for (const balance of scope.wallet.balances) {
        if (balance.assetType === 'postage' && balance.assetId === 'postage' && ['trial','paid'].includes(balance.source)) result.credits += balance.availableUnits
        else if (balance.assetType === 'inventory') result.inventory[balance.assetId] = (result.inventory[balance.assetId] ?? 0) + balance.availableUnits
        else if (balance.assetType === 'voucher') result.entitlements['return-stamp'] = (result.entitlements['return-stamp'] ?? 0) + balance.availableUnits
      }
      result.receipts = (await Promise.all(scope.deliveries.map(receipt))).sort((a,b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)); return result
    }
    async function refresh() {
      const revision = ++scope.reading
      const additional = Promise.allSettled([list<ReceivedGiftDTO>('/v1/received-gifts').then(async rows => {
        rows.forEach(validateReceivedGift)
        if (new Set(rows.map(row => row.id)).size !== rows.length) throw invalid()
        return { rows, received: (await Promise.all(rows.map(receivedGift))).sort((a,b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)) }
      }), notificationList()] as const)
      try {
        const [catalog, wallet, deliveries, ledger] = await Promise.all([list<CatalogItem>('/v1/gift-catalog' + (target.current ? '?personId=' + encodeURIComponent(target.current) : '')), request<Wallet>('/v1/wallet').then(value => value.data), list<GiftDeliveryDTO>('/v1/gift-deliveries'), list<GiftLedgerTransaction>('/v1/wallet/ledger')])
        check(); if (revision !== scope.reading) return
        if (catalog.some(item => !validGiftDefinition(item) || !count(item.unitPostage) || item.unitPostage !== item.cost || typeof item.acceptsVoucher !== 'boolean')
          || new Set(catalog.map(item => item.id)).size !== catalog.length || !count(wallet.version) || !instant(wallet.asOf) || !Array.isArray(wallet.balances)
          || wallet.balances.some(balance => !['postage','inventory','voucher'].includes(balance.assetType) || !count(balance.availableUnits) || typeof balance.assetId !== 'string' || typeof balance.source !== 'string')) throw invalid()
        deliveries.forEach(value => validateGiftDelivery(value))
        if (ledger.some(value => !uuid.test(value.transactionId) || typeof value.reason !== 'string' || typeof value.sourceId !== 'string' || !instant(value.createdAt)
          || typeof value.policyVersion !== 'string' || value.originalTransactionId !== null && !uuid.test(value.originalTransactionId) || !Array.isArray(value.entries)
          || value.entries.some(entry => !['postage','inventory','voucher'].includes(entry.assetType) || typeof entry.assetId !== 'string' || typeof entry.source !== 'string'
            || !['debit','credit'].includes(entry.direction) || !count(entry.units) || entry.units < 1 || !uuid.test(entry.lotId)))
          || new Set(ledger.map(value => value.transactionId)).size !== ledger.length) throw invalid()
        scope.catalog = catalog; scope.wallet = wallet; scope.deliveries = deliveries
        const snapshot = await state(); check(); if (revision !== scope.reading) return
        const [received, notifications] = await additional; check(); if (revision !== scope.reading) return
        scope.received = received.status === 'fulfilled' ? received.value.rows : []
        emit({ state: { ...snapshot, received: received.status === 'fulfilled' ? received.value.received : [] }, catalog, ledger, status: 'ready',
          receivedStatus: received.status === 'fulfilled' ? 'ready' : 'error', receivedError: received.status === 'rejected' ? errorCode(received.reason) : undefined,
          ...(notifications.status === 'fulfilled' ? notifications.value : { notifications: [], totalCount: 0, unreadCount: 0 }),
          notificationsStatus: notifications.status === 'fulfilled' ? 'ready' : 'error', notificationsError: notifications.status === 'rejected' ? errorCode(notifications.reason) : undefined })
      } catch (error) {
        if (!live() || revision !== scope.reading) return
        const denied = error instanceof GiftServiceError && [401,403,404].includes(error.status)
        if (denied) scope.received = []
        emit({ ...(denied ? emptySnapshot() : scope.snapshot), status: 'error', error: errorCode(error) })
      }
    }
    function errorCode(error: unknown) { return error instanceof GiftServiceError ? error.code : 'GIFT_REQUEST_FAILED' }
    function mutationStorage(resource: string) { return 'xijie.gift.mutation.' + context!.accountId + '.' + resource }
    function mutation(resource: string): GiftMutationIntent | undefined {
      let value = scope.mutations.get(resource)
      if (!value) try {
        const item = JSON.parse(sessionStorage.getItem(mutationStorage(resource)) ?? 'null') as GiftMutationIntent | null
        if (item && uuid.test(item.key) && ['open','placement','read'].includes(item.kind) && (item.version === null || count(item.version) && item.version > 0)
          && (item.kind === 'open' && item.version === null && Object.keys(item.body).length === 0
            || item.kind === 'placement' && item.version !== null && ['record','space'].includes(String(item.body.placement)) && Object.keys(item.body).length === 1
            || item.kind === 'read' && item.version !== null && item.body.read === true && Object.keys(item.body).length === 1)) { value = item; scope.mutations.set(resource, item) }
      } catch { /* Persisted intents never grant access to a resource. */ }
      return value
    }
    function rememberMutation(resource: string, value?: GiftMutationIntent) {
      check(); if (value) scope.mutations.set(resource, value); else scope.mutations.delete(resource)
      try { if (value) sessionStorage.setItem(mutationStorage(resource), JSON.stringify(value)); else sessionStorage.removeItem(mutationStorage(resource)) } catch { /* In-memory intent retains the same key. */ }
      emit({ ...scope.snapshot })
    }
    async function acceptReceived(value: ReceivedGiftDTO, permissionRevision: number) {
      validateReceivedGift(value); const mapped = await receivedGift(value); check()
      if (permissionRevision !== scope.permissionRevision) throw new DOMException('Permission changed', 'AbortError')
      const current = scope.received.find(item => item.id === value.id)
      if (current && current.version > value.version) return receivedGift(current)
      scope.reading++; scope.received = [...scope.received.filter(item => item.id !== value.id), value]
      emit({ ...scope.snapshot, receivedStatus: 'ready', receivedError: undefined,
        state: { ...scope.snapshot.state, received: [...(scope.snapshot.state.received ?? []).filter(item => item.id !== value.id), mapped].sort((a,b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)) } })
      return mapped
    }
    async function readReceived(id: string) {
      if (!uuid.test(id)) throw invalid(); const revision = scope.permissionRevision
      try { const value = (await request<ReceivedGiftDTO>('/v1/received-gifts/' + id)).data; if (value.id !== id) throw invalid(); return await acceptReceived(value, revision) }
      catch (error) {
        if (live() && revision === scope.permissionRevision && error instanceof GiftServiceError && [401,403,404].includes(error.status)) {
          scope.reading++; scope.received = scope.received.filter(item => item.id !== id); emit({ ...scope.snapshot, receivedStatus: 'error', receivedError: error.code, state: { ...scope.snapshot.state, received: scope.snapshot.state.received?.filter(item => item.id !== id) } })
        }
        throw error
      }
    }
    async function readDelivery(id: string) {
      if (!uuid.test(id)) throw invalid(); const revision = scope.permissionRevision
      const value = (await request<GiftDeliveryDTO>('/v1/gift-deliveries/' + id)).data
      if (value.id !== id) throw invalid(); const saved = await receipt(value); check()
      if (revision !== scope.permissionRevision) throw new DOMException('Permission changed', 'AbortError')
      scope.reading++; scope.deliveries = [...scope.deliveries.filter(item => item.id !== id), value]
      emit({ ...scope.snapshot, state: { ...scope.snapshot.state, receipts: [...scope.snapshot.state.receipts.filter(item => item.id !== id), saved].sort((a,b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)) } })
      return saved
    }
    async function mutateReceived(id: string, action?: 'open' | 'record' | 'space') {
      check(); if (!uuid.test(id)) throw invalid(); const resource = 'received.' + id
      if (scope.mutating.has(resource)) throw new GiftServiceError(409, 'REQUEST_IN_PROGRESS')
      let intent = mutation(resource)
      if (intent && action !== undefined && (action === 'open' ? intent.kind !== 'open' : intent.kind !== 'placement' || intent.body.placement !== action)) throw new GiftServiceError(409, 'PENDING_GIFT_OPERATION')
      if (!intent) {
        if (action === undefined) throw new GiftServiceError(409, 'NO_PENDING_OPERATION')
        const value = scope.received.find(item => item.id === id)
        if (action !== 'open' && !value) throw new GiftServiceError(404, 'NOT_FOUND')
        intent = { key: crypto.randomUUID(), kind: action === 'open' ? 'open' : 'placement', version: action === 'open' ? null : value!.version, body: action === 'open' ? {} : { placement: action } }
        rememberMutation(resource, intent)
      }
      scope.mutating.add(resource); const revision = scope.permissionRevision; let accepted = false
      try {
        const headers: Record<string,string> = { 'Content-Type': 'application/json', 'Idempotency-Key': intent.key }; if (intent.version !== null) headers['If-Match'] = '"v' + intent.version + '"'
        const value = (await request<ReceivedGiftDTO>('/v1/received-gifts/' + id + (intent.kind === 'open' ? '/open' : ''), { method: intent.kind === 'open' ? 'POST' : 'PATCH', headers, body: JSON.stringify(intent.body) })).data
        accepted = true
        if (value.id !== id) throw invalid(); const result = await acceptReceived(value, revision)
        rememberMutation(resource); return result
      } catch (error) {
        if (live() && revision === scope.permissionRevision && error instanceof GiftServiceError) {
          if (!accepted && ['VERSION_CONFLICT','VALIDATION_FAILED','GIFT_NOT_OPENED','GIFT_NOT_DISPLAYABLE'].includes(error.code)) { rememberMutation(resource); void readReceived(id).catch(() => {}) }
          else if ([401,403,404].includes(error.status) || error.code === 'AUTHORIZATION_CHANGED') {
            scope.reading++; scope.received = scope.received.filter(item => item.id !== id)
            emit({ ...scope.snapshot, receivedStatus: 'error', receivedError: error.code, state: { ...scope.snapshot.state, received: scope.snapshot.state.received?.filter(item => item.id !== id) } })
          }
        }
        throw error
      } finally { scope.mutating.delete(resource) }
    }
    async function readNotification(id: string) {
      check(); if (!uuid.test(id)) throw invalid(); const resource = 'notification.' + id
      if (scope.mutating.has(resource)) throw new GiftServiceError(409, 'REQUEST_IN_PROGRESS')
      let intent = mutation(resource)
      if (!intent) {
        const value = scope.snapshot.notifications.find(item => item.id === id); if (!value) throw new GiftServiceError(404, 'NOT_FOUND')
        if (value.readAt !== null) return
        intent = { key: crypto.randomUUID(), kind: 'read', version: value.version, body: { read: true } }; rememberMutation(resource, intent)
      }
      scope.mutating.add(resource); const revision = scope.permissionRevision
      try {
        const value = (await request<GiftNotification>('/v1/notifications/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': intent.key, 'If-Match': '"v' + intent.version + '"' }, body: JSON.stringify(intent.body) })).data
        validateGiftNotification(value); check(); if (value.id !== id || value.readAt === null) throw invalid()
        if (revision !== scope.permissionRevision) throw new DOMException('Permission changed', 'AbortError')
        scope.reading++; rememberMutation(resource)
        emit({ ...scope.snapshot, notifications: scope.snapshot.notifications.map(item => item.id === id && item.version <= value.version ? value : item) }); void refresh()
      } catch (error) {
        if (live() && revision === scope.permissionRevision && error instanceof GiftServiceError && ['VERSION_CONFLICT','VALIDATION_FAILED'].includes(error.code)) { rememberMutation(resource); void refresh() }
        throw error
      } finally { scope.mutating.delete(resource) }
    }
    function pending(personId?: string) {
      if (!personId || !uuid.test(personId)) return undefined
      let value = scope.pending.get(personId)
      if (!value) { value = storedIntent(scope.context.accountId, personId); if (value) scope.pending.set(personId, value) }
      return value
    }
    function remember(personId: string, intent?: GiftIntent) {
      check()
      if (intent) scope.pending.set(personId, intent); else scope.pending.delete(personId)
      try { if (intent) sessionStorage.setItem(intentStorage(scope.context.accountId, personId), JSON.stringify(intent)); else sessionStorage.removeItem(intentStorage(scope.context.accountId, personId)) } catch { /* The current scope keeps the original request. */ }
      emit({ ...scope.snapshot })
    }
    async function send(input: GiftSendInput) {
      check(); const personId = input.target.identity
      if (!personId || !uuid.test(personId)) throw new GiftServiceError(400, 'INVALID_TARGET')
      if (scope.sending.has(personId)) throw new GiftServiceError(409, 'REQUEST_IN_PROGRESS')
      let intent = pending(personId)
      if (!intent) {
        const definition = scope.catalog.find(item => item.id === input.giftId)
        if (!definition || scope.snapshot.status !== 'ready') throw new GiftServiceError(409, 'CATALOG_VERSION_CHANGED')
        intent = { key: uuid.test(input.requestId) ? input.requestId : crypto.randomUUID(), definition, body: { personId, giftId: input.giftId, catalogVersion: definition.version,
          quantity: input.quantity, note: input.note.trim(), source: input.source === 'reward' ? 'voucher' : input.source } }
        remember(personId, intent)
      }
      scope.sending.add(personId)
      const permissionRevision = scope.permissionRevision
      let accepted = false
      try {
        const result = await request<GiftDeliveryDTO>('/v1/gift-deliveries', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': intent.key }, body: JSON.stringify(intent.body) })
        accepted = true
        validateGiftDelivery(result.data, personId); const saved = await receipt(result.data); check()
        if (permissionRevision !== scope.permissionRevision) throw new DOMException('Permission changed', 'AbortError')
        // A confirmed receipt remains valid even if the subsequent balance read is temporarily unavailable.
        scope.reading++; scope.deliveries = [result.data, ...scope.deliveries.filter(value => value.id !== result.data.id)]
        remember(personId)
        emit({ ...scope.snapshot, state: { ...scope.snapshot.state, receipts: [...scope.snapshot.state.receipts.filter(value => value.id !== saved.id), saved].sort((a,b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)) } })
        void refresh(); return saved
      } catch (error) {
        // Authorization and session checks can fail after the transaction committed. Only
        // errors guaranteed to precede acceptance release the original retry identity.
        if (live() && !accepted && error instanceof GiftServiceError && error.status >= 400 && error.status < 500
          && ['VALIDATION_FAILED','INSUFFICIENT_ASSET','CATALOG_VERSION_CHANGED','GIFT_UNAVAILABLE','VOUCHER_NOT_APPLICABLE'].includes(error.code)) { remember(personId); void refresh() }
        throw error
      } finally { scope.sending.delete(personId) }
    }
    return { scope, live, refresh, send, pending, readReceived, readDelivery, openReceived: (id: string) => mutateReceived(id, 'open'), placeReceived: (id: string, placement: 'record' | 'space') => mutateReceived(id, placement), retryReceived: (id: string) => mutateReceived(id), pendingReceived: (id: string) => mutation('received.' + id), readNotification }
  }, [key])
  useEffect(() => {
    if (!owner) return
    owner.scope.alive = true
    const refresh = () => { if (document.visibilityState !== 'hidden') void owner.refresh() }
    const timer = window.setInterval(refresh, 5000)
    const permissionChanged = () => { owner.scope.reading++; owner.scope.permissionRevision++; owner.scope.received = []; owner.scope.snapshot = emptySnapshot(); setView({ key, snapshot: owner.scope.snapshot }); refresh() }
    window.addEventListener('focus', refresh); window.addEventListener('xijie:consents-changed', permissionChanged); document.addEventListener('visibilitychange', refresh)
    return () => { owner.scope.alive = false; owner.scope.requests.forEach(controller => controller.abort()); window.clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('xijie:consents-changed', permissionChanged); document.removeEventListener('visibilitychange', refresh) }
  }, [owner])
  useEffect(() => { if (owner) void owner.refresh() }, [owner, activePersonId])
  if (!owner || !context) return undefined
  const snapshot = view.key === key ? view.snapshot : emptySnapshot()
  return { ...snapshot, refresh: owner.refresh, send: owner.send, pending: owner.pending, readReceived: owner.readReceived, readDelivery: owner.readDelivery,
    openReceived: owner.openReceived, placeReceived: owner.placeReceived, retryReceived: owner.retryReceived, pendingReceived: owner.pendingReceived, readNotification: owner.readNotification }
}
