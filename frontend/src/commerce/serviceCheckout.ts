import { createOrdersClient, OrderServiceError, validateOrder, type OrderServiceContext, type OrderView } from './serviceOrders'

export type CheckoutProduct = OrderView['productSnapshot']
export type CheckoutQuote = { quoteId: string; productSnapshot: CheckoutProduct; quantity: 1; channel: string; pricingSource: 'server_quote'; price: CheckoutProduct['price']; createdAt: string; expiresAt: string }
type Command = { kind: 'quote' | 'order' | 'attempt' | 'close' | 'refund'; key: string; orderId?: string; body: Record<string, unknown> }
type Journal = { version: 1; accountId: string; purchase?: { product: CheckoutProduct; quote?: CheckoutQuote; orderId?: string }; command?: Command }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const positive = (v: unknown) => Number.isSafeInteger(v) && Number(v) > 0
const instant = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))
const invalid = () => new OrderServiceError(502, 'INVALID_RESPONSE')
export function validateProduct(p: CheckoutProduct): CheckoutProduct {
  if (!p || typeof p.id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(p.id) || !positive(p.version) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 500 || /\p{C}/u.test(p.name)
    || !positive(p.units) || p.assetType !== 'postage' || p.assetId !== 'postage' || !positive(p.price?.amount) || !/^[A-Z]{3}$/.test(p.price.currency) || typeof p.channel !== 'string' || !/^[a-z][a-z0-9_-]{0,39}$/.test(p.channel)) throw invalid()
  return p
}
const sameProduct = (a: CheckoutProduct, b: CheckoutProduct) => a.id === b.id && a.version === b.version && a.name === b.name && a.units === b.units && a.assetType === b.assetType && a.assetId === b.assetId && a.channel === b.channel && a.price.amount === b.price.amount && a.price.currency === b.price.currency
function validQuote(v: CheckoutQuote) {
  if (!v || !uuid.test(v.quoteId) || v.quantity !== 1 || v.pricingSource !== 'server_quote' || !instant(v.createdAt) || !instant(v.expiresAt) || Date.parse(v.expiresAt) <= Date.parse(v.createdAt)) throw invalid()
  const p = validateProduct(v.productSnapshot)
  if (v.channel !== p.channel || v.price?.amount !== p.price.amount || v.price.currency !== p.price.currency) throw invalid()
  return v
}
function quote(v: CheckoutQuote, product: CheckoutProduct) { validQuote(v); if (!sameProduct(v.productSnapshot, product)) throw invalid(); return v }
export function createCheckoutClient(context: OrderServiceContext, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage) {
  if (!uuid.test(context.accountId) || !uuid.test(context.sessionId)) throw new OrderServiceError(400, 'INVALID_ARGUMENT')
  const key = 'xijie.checkout.v1.' + context.accountId, orders = createOrdersClient(context), controllers = new Set<AbortController>()
  let active = true, epoch = 0, busy = false
  function load(): Journal {
    try {
      const raw = storage.getItem(key)
      if (raw === null) return { version: 1, accountId: context.accountId }
      const j: Journal = JSON.parse(raw)
      if (j.version !== 1 || j.accountId !== context.accountId) throw Error()
      if (j.purchase) { validateProduct(j.purchase.product); if (j.purchase.quote) quote(j.purchase.quote, j.purchase.product); if (j.purchase.orderId && !uuid.test(j.purchase.orderId)) throw Error() }
      const c = j.command
      if (c && (!uuid.test(c.key) || !['quote','order','attempt','close','refund'].includes(c.kind) || !c.body || typeof c.body !== 'object' || c.orderId !== undefined && !uuid.test(c.orderId))) throw Error()
      if (c?.kind === 'quote' && (!j.purchase || JSON.stringify(c.body) !== JSON.stringify({ productId: j.purchase.product.id, quantity: 1, channel: j.purchase.product.channel }))) throw Error()
      if (c?.kind === 'order' && (!j.purchase?.quote || JSON.stringify(c.body) !== JSON.stringify({ quoteId: j.purchase.quote.quoteId }))) throw Error()
      if (c && ['attempt','close','refund'].includes(c.kind) && (!c.orderId || JSON.stringify(c.body) !== '{}')) throw Error()
      return j
    } catch { throw new OrderServiceError(503, 'RECOVERY_STORAGE_UNAVAILABLE') }
  }
  function save(j: Journal) {
    try { const value = JSON.stringify(j); storage.setItem(key, value); if (storage.getItem(key) !== value) throw Error() }
    catch { throw new OrderServiceError(503, 'RECOVERY_STORAGE_UNAVAILABLE') }
  }
  async function request(path: string, command?: Command) {
    const captured = epoch, controller = new AbortController(); controllers.add(controller)
    const check = () => { if (!active || captured !== epoch || controller.signal.aborted) throw new DOMException('Canceled', 'AbortError') }
    try {
      check()
      const response = await fetch(path, { method: command ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: { 'X-Xijie-Expected-Session': context.sessionId, ...(command ? { 'Content-Type': 'application/json', 'Idempotency-Key': command.key } : {}) }, ...(command ? { body: JSON.stringify(command.body) } : {}) })
      check(); let value; try { value = await response.json() } catch { check(); throw invalid() }; check()
      if (!response.ok) { if (response.status === 401) context.onUnauthorized(); throw new OrderServiceError(response.status, value?.error?.code ?? 'UNAVAILABLE') }
      if (value?.data === undefined) throw invalid()
      return value
    } finally { controllers.delete(controller) }
  }
  function command(j: Journal, kind: Command['kind'], body: Command['body'], orderId?: string) {
    if (j.command) { if (j.command.kind !== kind || j.command.orderId !== orderId || JSON.stringify(j.command.body) !== JSON.stringify(body)) throw new OrderServiceError(409, 'CHECKOUT_PENDING'); return j }
    const next = { ...j, command: { kind, key: crypto.randomUUID(), body, ...(orderId ? { orderId } : {}) } }; save(next); return next
  }
  async function locked<T>(fn: () => Promise<T>) {
    if (busy) throw new OrderServiceError(409, 'IN_PROGRESS')
    busy = true; const captured = epoch
    const run = () => { if (!active || captured !== epoch) throw new DOMException('Canceled', 'AbortError'); return fn() }
    try {
      // Where supported, two tabs share the same durable command rather than
      // racing to replace it. Server uniqueness remains authoritative.
      const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
      return locks ? await locks.request('xijie.checkout.' + context.accountId, run) : await run()
    } finally { busy = false }
  }
  const assertOrder = (v: OrderView, id?: string, product?: CheckoutProduct) => { validateOrder(v); if (id && v.orderId !== id || product && !sameProduct(v.productSnapshot, product)) throw invalid(); return v }
  const action = (kind: 'attempt' | 'close' | 'refund', id: string) => locked(async () => {
    if (!uuid.test(id)) throw new OrderServiceError(400, 'INVALID_ARGUMENT')
    let j = load()
    if (!j.command) {
      const current = await orders.read(id)
      if (kind === 'attempt' && (current.paymentState === 'confirming' || current.paymentState === 'paid' || current.paymentState === 'closed')) return current
      if (kind === 'close' && ['paid','closed'].includes(current.paymentState)) return current
      if (kind === 'refund' && (current.paymentState !== 'paid' || current.refund && current.refund.status !== 'failed')) return current
    }
    j = command(j, kind, {}, id)
    const endpoint = kind === 'attempt' ? 'payment-attempts' : kind === 'refund' ? 'refunds' : 'close'
    try {
      const value = assertOrder((await request('/v1/orders/' + id + '/' + endpoint, j.command)).data, id)
      save({ ...j, command: undefined }); return value
    } catch (error) {
      // Review is a durable, explicitly rejected automatic refund. Read its own
      // fact; an unknown response or malformed success keeps the original key.
      if (kind === 'refund' && error instanceof OrderServiceError && error.code === 'REFUND_REQUIRES_REVIEW') {
        const value = await orders.read(id)
        if (value.refund?.status === 'review') { save({ ...j, command: undefined }); return value }
      }
      // These explicit business rejections follow permanent receipt lookup on
      // the server. Confirm the changed fact before releasing an unaccepted key.
      if (error instanceof OrderServiceError && (
        kind === 'attempt' && ['ORDER_NOT_PAYABLE','PAYMENT_ATTEMPT_PENDING'].includes(error.code)
        || kind === 'close' && ['ORDER_ALREADY_PAID','PAYMENT_OUTCOME_UNKNOWN'].includes(error.code)
        || kind === 'refund' && ['ORDER_NOT_REFUNDABLE','REFUND_ALREADY_PENDING'].includes(error.code))) {
        const value = await orders.read(id)
        if (kind === 'attempt' && value.paymentState !== 'awaiting_payment'
          || kind === 'close' && value.paymentState !== 'awaiting_payment'
          || kind === 'refund' && (value.paymentState !== 'paid' || value.refund && value.refund.status !== 'failed')) {
          save({ ...j, command: undefined }); return value
        }
      }
      throw error
    }
  })
  return {
    activate() { active = true; orders.activate() },
    dispose() { active = false; epoch++; controllers.forEach(c => c.abort()); controllers.clear(); orders.dispose() },
    get pending() { return load().command?.kind },
    get pendingOrderId() { return load().command?.orderId },
    get purchase() { return load().purchase },
    async products() {
      const v = await request('/v1/products')
      if (!Array.isArray(v.data) || v.data.length > 100 || typeof v.meta?.purchasingEnabled !== 'boolean' || !v.meta.purchasingEnabled && v.data.length) throw invalid()
      const data = v.data.map(validateProduct) as CheckoutProduct[]
      if (new Set(data.map(p => p.id)).size !== data.length || v.meta.purchasingEnabled && !data.length) throw invalid()
      return { data, purchasingEnabled: v.meta.purchasingEnabled as boolean }
    },
    buy(product: CheckoutProduct) { return locked(async () => {
      validateProduct(product); let j = load()
      if (j.purchase && !sameProduct(j.purchase.product, product)) throw new OrderServiceError(409, 'CHECKOUT_PENDING')
      if (!j.purchase) { j = { ...j, purchase: { product: structuredClone(product) } }; save(j) }
      if (j.purchase!.orderId) return assertOrder(await orders.read(j.purchase!.orderId!), j.purchase!.orderId, j.purchase!.product)
      if (!j.purchase!.quote) {
        j = command(j, 'quote', { productId: product.id, quantity: 1, channel: product.channel })
        const value = validQuote((await request('/v1/purchase-quotes', j.command)).data), original = j.purchase!.product
        if (!sameProduct(value.productSnapshot, original)) {
          const changed = value.productSnapshot
          if (changed.id !== original.id || changed.channel !== original.channel || changed.version <= original.version) throw invalid()
          // A newly published price/version needs a second deliberate click.
          // Store this accepted quote rather than requesting another one.
          save({ ...j, command: undefined, purchase: { product: changed, quote: value } })
          throw new OrderServiceError(409, 'PRICE_CHANGED')
        }
        j = { ...j, command: undefined, purchase: { ...j.purchase!, quote: value } }; save(j)
      }
      j = command(j, 'order', { quoteId: j.purchase!.quote!.quoteId })
      try {
        const value = assertOrder((await request('/v1/orders', j.command)).data, undefined, j.purchase!.product)
        save({ ...j, command: undefined, purchase: { ...j.purchase!, orderId: value.orderId } }); return value
      } catch (error) {
        // The server checks permanent receipts before expiry. QUOTE_EXPIRED
        // proves this order command was not accepted and can be replaced.
        if (error instanceof OrderServiceError && error.code === 'QUOTE_EXPIRED') save({ version: 1, accountId: context.accountId })
        throw error
      }
    }) },
    startPayment: (id: string) => action('attempt', id),
    close: (id: string) => action('close', id),
    refund: (id: string) => action('refund', id),
    read: orders.read,
    list: orders.list,
    async finishPurchase(id: string) {
      const j = load(); if (j.command) throw new OrderServiceError(409, 'CHECKOUT_PENDING')
      const current = await orders.read(id)
      if (!['paid','closed'].includes(current.paymentState)) throw new OrderServiceError(409, 'CHECKOUT_PENDING')
      if (j.purchase?.orderId === id) save({ version: 1, accountId: context.accountId })
      return current
    },
  }
}
