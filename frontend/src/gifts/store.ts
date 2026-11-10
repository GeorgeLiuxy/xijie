import { getGift } from './catalog'
import { isOpenOrder, PREVIEW_POSTAGE, previewQuote, type CheckoutAction, type CheckoutStatus, type PaymentMethod, type PreviewChannel, type PreviewOrder } from '../commerce/checkout'
import { canDisplayReceivedGift } from './placement'
import type { Person } from '../model'
import type { GiftDefinition, GiftGoal, GiftGoalLink, GiftLine, GiftReceipt, GiftSendInput, GiftState, GiftTarget, ReceiveGiftInput, ReceivedGift } from './types'

const prefix = 'elysium.gifts.v1.'
const deliveryDelay = 8_000

export type GiftStoreErrorCode =
  | 'invalid-owner' | 'invalid-request' | 'invalid-target' | 'invalid-quantity'
  | 'invalid-note' | 'invalid-gift' | 'unavailable-gift' | 'goal-required'
  | 'insufficient-credits' | 'insufficient-inventory' | 'invalid-reward'
  | 'request-conflict' | 'invalid-goal' | 'goal-conflict'
  | 'unopened-gift' | 'invalid-placement'
  | 'storage-unavailable' | 'storage-invalid'
  | 'invalid-checkout'

export class GiftStoreError extends Error {
  readonly code: GiftStoreErrorCode

  constructor(code: GiftStoreErrorCode) {
    super(code)
    this.name = 'GiftStoreError'
    this.code = code
  }
}

type Entry = { raw: string | null; state: GiftState }
type Mutation<T> = { next?: GiftState; value: T }
const cache = new Map<string, Entry>()
const listeners = new Map<string, Set<() => void>>()
let listeningForStorage = false

function initialState(): GiftState {
  return {
    version: 1,
    credits: 120,
    inventory: { 'paper-crane': 3, ball: 2, cloth: 1, fuel: 3 },
    entitlements: {},
    receipts: [],
    received: [],
    usedRewards: [],
    goals: [],
  }
}

function key(owner: string): string {
  if (typeof owner !== 'string' || !owner.trim() || owner.length > 512) throw new GiftStoreError('invalid-owner')
  return prefix + owner
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isCounts(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every(isCount)
}

function isTarget(value: unknown): value is GiftTarget {
  if (!isRecord(value)) return false
  return isCount(value.id)
    && (value.identity === undefined || typeof value.identity === 'string' && !!value.identity)
    && typeof value.name === 'string' && !!value.name.trim() && value.name.length <= 80
    && (value.world === 'isles' || value.world === 'tide' || value.world === 'courtyard')
    && (value.audience === 'person' || value.audience === 'pet' || value.audience === 'object')
}

function isLines(lines: unknown): lines is GiftLine[] {
  return Array.isArray(lines) && lines.length > 0 && lines.every(line =>
    isRecord(line)
    && typeof line.giftId === 'string'
    && isCount(line.quantity) && line.quantity > 0
    && isRecord(line.snapshot)
    && typeof line.snapshot.id === 'string'
    && typeof line.snapshot.name === 'string'
    && typeof line.snapshot.en === 'string'
    && isCount(line.snapshot.version),
  )
}

function isReceipt(value: unknown): value is GiftReceipt {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || !isTarget(value.target)) return false
  if (!isCount(value.createdAt) || !isCount(value.arriveAt) || value.arriveAt < value.createdAt || !isCount(value.cost)) return false
  if (typeof value.note !== 'string' || !['trial', 'inventory', 'reward'].includes(String(value.source))) return false
  return isLines(value.lines) && (value.personaReply === undefined || typeof value.personaReply === 'boolean')
}

function isReceived(value: unknown): value is ReceivedGift {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || !isTarget(value.from) || !value.from.identity) return false
  if (value.origin !== 'persona' || !isCount(value.createdAt) || typeof value.note !== 'string' || !isLines(value.lines)) return false
  if (value.replyTo !== undefined && (typeof value.replyTo !== 'string' || !value.replyTo)) return false
  if (value.openedAt === undefined) return value.placement === undefined
  return isCount(value.openedAt) && value.openedAt >= value.createdAt &&
    (value.placement === undefined || value.placement === 'record' || value.placement === 'space')
}

function isGoalLink(value: unknown): value is GiftGoalLink {
  return isRecord(value) && typeof value.id === 'string' && !!value.id
    && isTarget(value.target) && isCount(value.createdAt)
    && (value.kind === 'flight' || value.kind === 'home' || value.kind === 'album')
}

function isPreviewOrder(value: unknown): value is PreviewOrder {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return false
  const quote = previewQuote(value.channel as PreviewChannel)
  return !!quote && Array.isArray(quote.methods) && quote.methods.includes(value.method as PaymentMethod)
    && ['unpaid', 'confirming', 'paid', 'fulfilled', 'cancelled', 'failed'].includes(String(value.status))
    && isCount(value.createdAt) && isCount(value.amount) && value.amount > 0
    && (value.currency === 'CNY' || value.currency === 'USD') && isCount(value.postage) && value.postage > 0
}

function decode(raw: string): GiftState {
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || value.version !== 1 || !isCount(value.credits)) throw Error()
    if (!isCounts(value.inventory) || !isCounts(value.entitlements)) throw Error()
    if (!Array.isArray(value.receipts) || !value.receipts.every(isReceipt)) throw Error()
    if (value.received !== undefined && (!Array.isArray(value.received) || !value.received.every(isReceived))) throw Error()
    value.received ??= []
    if (!Array.isArray(value.usedRewards) || !value.usedRewards.every(token => typeof token === 'string')) throw Error()
    if (value.goals !== undefined && (!Array.isArray(value.goals) || !value.goals.every(isGoalLink))) throw Error()
    if (value.previewOrders !== undefined && (!Array.isArray(value.previewOrders) || !value.previewOrders.every(isPreviewOrder))) throw Error()
    return value as unknown as GiftState
  } catch {
    throw new GiftStoreError('storage-invalid')
  }
}

function read(owner: string): Entry {
  const storageKey = key(owner)
  let raw: string | null
  try {
    raw = globalThis.localStorage.getItem(storageKey)
  } catch {
    throw new GiftStoreError('storage-unavailable')
  }
  const previous = cache.get(owner)
  if (previous && previous.raw === raw) return previous
  const entry: Entry = { raw, state: raw === null ? initialState() : decode(raw) }
  cache.set(owner, entry)
  return entry
}

function notify(owner: string) {
  for (const listener of listeners.get(owner) ?? []) {
    try { listener() } catch { /* A subscriber cannot roll back a stored transaction. */ }
  }
}

function commit(owner: string, next: GiftState) {
  const storageKey = key(owner)
  let raw: string
  try {
    raw = JSON.stringify(next)
    globalThis.localStorage.setItem(storageKey, raw)
  } catch {
    throw new GiftStoreError('storage-unavailable')
  }
  // Cache and listeners only change after the complete ledger is persisted.
  cache.set(owner, { raw, state: next })
  notify(owner)
}

function copy(state: GiftState): GiftState {
  return {
    ...state,
    inventory: { ...state.inventory },
    entitlements: { ...state.entitlements },
    receipts: [...state.receipts],
    received: [...(state.received ?? [])],
    usedRewards: [...state.usedRewards],
    goals: [...(state.goals ?? [])],
  }
}

async function mutate<T>(owner: string, change: (state: GiftState) => Mutation<T>): Promise<T> {
  const storageKey = key(owner)
  const run = () => {
    const state = read(owner).state
    const result = change(state)
    if (result.next) commit(owner, result.next)
    return result.value
  }

  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    let entered = false
    try {
      return await navigator.locks.request(storageKey, () => {
        entered = true
        return run()
      })
    } catch (error) {
      // Some embedded previews expose LockManager but deny lock acquisition.
      // A mutation that ran is never retried through this fallback.
      if (!entered && error instanceof DOMException && error.name === 'SecurityError') return run()
      throw error
    }
  }
  // The fallback is one synchronous read/validate/write operation per JS turn.
  return run()
}

function targetCopy(target: GiftTarget): GiftTarget {
  if (!isTarget(target)) throw new GiftStoreError('invalid-target')
  return { ...target, name: target.name.trim() }
}

function definitionCopy(gift: GiftDefinition): GiftDefinition {
  return { ...gift, audience: [...gift.audience] }
}

function parcelGift(giftId: string, quantity: number): GiftDefinition {
  const gift = getGift(giftId)
  if (!gift) throw new GiftStoreError('invalid-gift')
  if (!gift.available || gift.effect === 'service') throw new GiftStoreError('unavailable-gift')
  if (gift.effect === 'build' || gift.effect === 'fuel') throw new GiftStoreError('goal-required')
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99 || (!gift.stackable && quantity !== 1)) {
    throw new GiftStoreError('invalid-quantity')
  }
  return gift
}

function sameRequest(receipt: GiftReceipt, input: GiftSendInput, target: GiftTarget, note: string) {
  return receipt.lines.length === 1
    && receipt.lines[0].giftId === input.giftId
    && receipt.lines[0].quantity === input.quantity
    && receipt.note === note
    && receipt.source === input.source
    && receipt.target.id === target.id
    && receipt.target.identity === target.identity
    && receipt.target.name === target.name
    && receipt.target.world === target.world
    && receipt.target.audience === target.audience
}

export function getGiftState(owner: string): GiftState {
  key(owner)
  try {
    return read(owner).state
  } catch {
    // A readable shell remains available when storage is blocked or damaged.
    // Mutations still use the strict read and fail instead of overwriting it.
    const previous = cache.get(owner)
    if (previous) return previous.state
    const entry: Entry = { raw: null, state: initialState() }
    cache.set(owner, entry)
    return entry.state
  }
}

export function subscribeGifts(owner: string, listener: () => void): () => void {
  key(owner)
  const group = listeners.get(owner) ?? new Set<() => void>()
  group.add(listener)
  listeners.set(owner, group)
  if (!listeningForStorage && typeof window !== 'undefined') {
    window.addEventListener('storage', event => {
      const refresh = (current: string) => {
        const previous = cache.get(current)
        try {
          const latest = read(current)
          if (!previous || latest.raw !== previous.raw) notify(current)
        } catch {
          // Keep the last usable snapshot; mutations report storage failures.
        }
      }
      if (event.key === null) {
        for (const current of listeners.keys()) refresh(current)
      } else if (event.key.startsWith(prefix)) {
        refresh(event.key.slice(prefix.length))
      }
    })
    listeningForStorage = true
  }
  return () => {
    group.delete(listener)
    if (!group.size) listeners.delete(owner)
  }
}

export function hasArrived(receipt: GiftReceipt, now = Date.now()): boolean {
  return now >= receipt.arriveAt
}

export function targetMatchesPerson(target: GiftTarget, person: Pick<Person, 'id' | 'localId'>): boolean {
  return target.identity ? target.identity === person.localId : target.id === person.id
}

export function receiptMatchesPerson(receipt: GiftReceipt, person: Pick<Person, 'id' | 'localId'>): boolean {
  return targetMatchesPerson(receipt.target, person)
}

export function acceptsPostage(gift: GiftDefinition): boolean {
  return gift.available && gift.cost > 0 && gift.cost <= 8 && (gift.effect === 'prop' || gift.effect === 'keepsake')
}

export async function saveGiftPhoto(owner: string, id: string, photo: string): Promise<void> {
  if (!/^data:image\/(jpeg|webp|png);base64,[\w+/]+=*$/.test(photo)) throw new GiftStoreError('invalid-request')
  return mutate(owner, state => {
    const index = state.receipts.findIndex(receipt => receipt.id === id)
    if (index < 0) throw new GiftStoreError('invalid-request')
    if (state.receipts[index].deliveryPhoto === photo) return { value: undefined }
    const next = copy(state)
    next.receipts[index] = { ...state.receipts[index], deliveryPhoto: photo }
    return { next, value: undefined }
  })
}

export async function sendGift(owner: string, input: GiftSendInput): Promise<GiftReceipt> {
  if (!input || typeof input.requestId !== 'string' || !input.requestId.trim() || input.requestId.length > 160) {
    throw new GiftStoreError('invalid-request')
  }
  if (typeof input.note !== 'string' || input.note.length > 120) throw new GiftStoreError('invalid-note')
  if (!['trial', 'inventory', 'reward'].includes(input.source)) throw new GiftStoreError('invalid-request')
  const target = targetCopy(input.target)
  const requestId = input.requestId.trim()
  const note = input.note.trim()

  return mutate(owner, state => {
    const previous = state.receipts.find(receipt => receipt.id === requestId)
    if (previous) {
      if (!sameRequest(previous, input, target, note)) throw new GiftStoreError('request-conflict')
      return { value: previous }
    }
    const gift = parcelGift(input.giftId, input.quantity)

    const next = copy(state)
    const quantity = input.quantity
    let cost = 0
    if (input.source === 'inventory') {
      if ((next.inventory[gift.id] ?? 0) < quantity) throw new GiftStoreError('insufficient-inventory')
      next.inventory[gift.id] -= quantity
    } else if (input.source === 'reward') {
      if (quantity !== 1 || !acceptsPostage(gift)) {
        throw new GiftStoreError('invalid-reward')
      }
      if ((next.entitlements['return-stamp'] ?? 0) < 1) throw new GiftStoreError('invalid-reward')
      next.entitlements['return-stamp'] -= 1
    } else {
      cost = gift.cost * quantity
      if (next.credits < cost) throw new GiftStoreError('insufficient-credits')
      next.credits -= cost
    }
    const createdAt = Date.now()
    const receipt: GiftReceipt = {
      id: requestId,
      target,
      lines: [{ giftId: gift.id, quantity, snapshot: definitionCopy(gift) }],
      note,
      createdAt,
      arriveAt: createdAt + deliveryDelay,
      source: input.source,
      cost,
      personaReply: true,
    }
    next.receipts.push(receipt)
    return { next, value: receipt }
  })
}

export async function receiveGift(owner: string, input: ReceiveGiftInput): Promise<ReceivedGift> {
  if (!input || typeof input.id !== 'string' || !input.id.trim() || input.id.length > 512 || input.origin !== 'persona') {
    throw new GiftStoreError('invalid-request')
  }
  if (input.replyTo !== undefined && (typeof input.replyTo !== 'string' || !input.replyTo.trim() || input.replyTo.length > 160)) {
    throw new GiftStoreError('invalid-request')
  }
  if (input.createdAt !== undefined && !isCount(input.createdAt)) throw new GiftStoreError('invalid-request')
  if (typeof input.note !== 'string' || input.note.length > 120) throw new GiftStoreError('invalid-note')
  const from = targetCopy(input.from)
  if (!from.identity?.trim()) throw new GiftStoreError('invalid-target')
  const id = input.id.trim(), note = input.note.trim(), replyTo = input.replyTo?.trim()
  return mutate(owner, state => {
    const records = state.received ?? []
    const previous = records.find(item => item.id === id)
    if (previous) {
      // Renaming or moving the sender later must not replace the original snapshot.
      if (previous.from.identity !== from.identity || previous.lines.length !== 1 ||
          previous.lines[0].giftId !== input.giftId || previous.lines[0].quantity !== input.quantity ||
          previous.replyTo !== replyTo || previous.note !== note) throw new GiftStoreError('request-conflict')
      return { value: previous }
    }
    if (replyTo) {
      const sent = state.receipts.find(receipt => receipt.id === replyTo)
      if (!sent?.personaReply || sent.target.identity !== from.identity) throw new GiftStoreError('invalid-request')
      if (records.some(item => item.replyTo === replyTo)) throw new GiftStoreError('request-conflict')
    }
    const gift = parcelGift(input.giftId, input.quantity)
    const received: ReceivedGift = {
      id, from, lines: [{ giftId: gift.id, quantity: input.quantity, snapshot: definitionCopy(gift) }],
      note, origin: 'persona', createdAt: input.createdAt ?? Date.now(), ...(replyTo ? { replyTo } : {}),
    }
    return { next: { ...state, received: [...records, received] }, value: received }
  })
}

function updateReceivedGift(owner: string, id: string, update: (gift: ReceivedGift) => ReceivedGift): Promise<ReceivedGift> {
  return mutate(owner, state => {
    const records = state.received ?? []
    const index = records.findIndex(item => item.id === id)
    if (index < 0) throw new GiftStoreError('invalid-request')
    const gift = update(records[index])
    if (gift === records[index]) return { value: gift }
    const received = [...records]
    received[index] = gift
    return { next: { ...state, received }, value: gift }
  })
}

export function openReceivedGift(owner: string, id: string): Promise<ReceivedGift> {
  return updateReceivedGift(owner, id, gift => gift.openedAt !== undefined ? gift : {
    ...gift, openedAt: Math.max(Date.now(), gift.createdAt), placement: 'record',
  })
}

export function placeReceivedGift(owner: string, id: string, placement: 'record' | 'space'): Promise<ReceivedGift> {
  return updateReceivedGift(owner, id, gift => {
    if (gift.openedAt === undefined) throw new GiftStoreError('unopened-gift')
    if ((placement !== 'record' && placement !== 'space') || (placement === 'space' && !canDisplayReceivedGift(gift))) {
      throw new GiftStoreError('invalid-placement')
    }
    return placement === gift.placement ? gift : { ...gift, placement }
  })
}

export async function applyGiftReward(owner: string, token: string): Promise<void> {
  if (typeof token !== 'string' || !token.trim() || token.length > 300) throw new GiftStoreError('invalid-reward')
  return mutate(owner, state => {
    if (state.usedRewards.includes(token)) return { value: undefined }
    const count = state.entitlements['return-stamp'] ?? 0
    if (!Number.isSafeInteger(count + 1)) throw new GiftStoreError('invalid-reward')
    const next = copy(state)
    next.usedRewards.push(token)
    next.entitlements['return-stamp'] = count + 1
    return { next, value: undefined }
  })
}

export function createPreviewOrder(owner: string, channel: PreviewChannel, method: PaymentMethod): Promise<PreviewOrder> {
  const quote = previewQuote(channel)
  if (!quote || !Array.isArray(quote.methods) || !quote.methods.includes(method)) {
    return Promise.reject(new GiftStoreError('invalid-checkout'))
  }
  return mutate(owner, state => {
    const orders = state.previewOrders ?? []
    const open = orders.find(isOpenOrder)
    if (open) return { value: open }
    const order: PreviewOrder = {
      id: crypto.randomUUID(), channel, method, status: 'unpaid', createdAt: Date.now(),
      amount: quote.amount, currency: quote.currency, postage: PREVIEW_POSTAGE,
    }
    return { next: { ...state, previewOrders: [order, ...orders] }, value: order }
  })
}

export function updatePreviewOrder(owner: string, id: string, action: CheckoutAction): Promise<PreviewOrder> {
  return mutate(owner, state => {
    const orders = state.previewOrders ?? []
    const order = orders.find(item => item.id === id)
    if (!order) throw new GiftStoreError('invalid-checkout')

    let status: CheckoutStatus = order.status
    if (order.status === 'unpaid') {
      if (action === 'submit') status = 'confirming'
      if (action === 'cancel') status = 'cancelled'
      if (action === 'fail') status = 'failed'
    } else if (action === 'refresh') {
      if (order.status === 'confirming') status = 'paid'
      if (order.status === 'paid') status = 'fulfilled'
    }
    if (status === order.status) return { value: order }

    const credits = state.credits + (status === 'fulfilled' ? order.postage : 0)
    if (!Number.isSafeInteger(credits)) throw new GiftStoreError('invalid-checkout')
    const updated = { ...order, status }
    return {
      next: { ...state, credits, previewOrders: orders.map(item => item === order ? updated : item) },
      value: updated,
    }
  })
}

export async function rememberGiftGoal(owner: string, target: GiftTarget, goal: GiftGoal): Promise<void> {
  const recipient = targetCopy(target)
  if (!goal || typeof goal.id !== 'string' || !goal.id || goal.id.length > 160
    || !['flight', 'home', 'album'].includes(goal.kind) || goal.world !== recipient.world) {
    throw new GiftStoreError('invalid-goal')
  }
  return mutate(owner, state => {
    const previous = state.goals?.find(link => link.id === goal.id)
    if (previous && (!targetMatchesPerson(previous.target, { id: recipient.id, localId: recipient.identity }) || previous.target.world !== recipient.world || previous.kind !== goal.kind)) {
      throw new GiftStoreError('goal-conflict')
    }
    const link: GiftGoalLink = { id: goal.id, target: recipient, kind: goal.kind, createdAt: previous?.createdAt ?? Date.now() }
    const next = copy(state)
    next.goals = previous
      ? next.goals!.map(existing => existing.id === goal.id ? link : existing)
      : [...next.goals!, link]
    return { next, value: undefined }
  })
}
