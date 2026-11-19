export type OrderServiceContext = { accountId: string; sessionId: string; onUnauthorized: () => void }
export type CheckoutLaunch = { type: 'redirect'; url: string; expiresAt: string }
type Price = { amount: number; currency: string }
export type OrderView = {
  orderId: string
  productSnapshot: { id: string; version: number; name: string; units: number; assetType: 'postage'; assetId: 'postage'; price: Price; channel: string }
  pricingSource: 'server_quote'; price: Price; paidAmount: Price | null; channel: string
  status: 'awaiting_payment' | 'confirming' | 'fulfilled' | 'closed' | 'refunded'
  paymentState: 'awaiting_payment' | 'confirming' | 'paid' | 'closed'
  fulfillmentStatus: 'not_eligible' | 'fulfilled'; refundStatus: 'none' | 'requested' | 'pending' | 'refunded' | 'failed'
  attemptSummary: { attemptId: string; status: 'preparing' | 'pending' | 'succeeded' | 'failed' | 'closed'; launch?: CheckoutLaunch } | null
  refund: { refundId: string; status: 'reserved' | 'pending' | 'refunded' | 'failed' | 'review'; failureCode: string | null } | null
  createdAt: string; updatedAt: string; version: number
}
export type OrderPage = { data: OrderView[]; meta: { nextCursor: string | null } }
export class OrderServiceError extends Error { constructor(readonly status: number, readonly code: string) { super(code) } }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= 500 && !/\p{C}/u.test(v)
const time = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))
const price = (v: Price | null | undefined): v is Price => !!v && positive(v.amount) && /^[A-Z]{3}$/.test(v.currency)
const invalid = () => new OrderServiceError(502, 'INVALID_RESPONSE')
export function validateCheckoutLaunch(value: CheckoutLaunch) {
  let url: URL
  try { url = new URL(value?.url) } catch { throw invalid() }
  if (value.type !== 'redirect' || !time(value.expiresAt) || url.username || url.password || value.url.length > 4096
    || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname) && (import.meta as ImportMeta & { env?: { PROD?: boolean } }).env?.PROD !== true)) throw invalid()
  return value
}
export function validateOrder(v: OrderView): OrderView {
  const p = v?.productSnapshot, paid = v?.paidAmount, a = v?.attemptSummary, r = v?.refund
  if (!v || !uuid.test(v.orderId) || !positive(v.version) || !time(v.createdAt) || !time(v.updatedAt) || v.pricingSource !== 'server_quote'
    || !p || !text(p.id) || !positive(p.version) || !text(p.name) || !positive(p.units) || p.assetType !== 'postage' || p.assetId !== 'postage'
    || !price(p.price) || !price(v.price) || p.price.amount !== v.price.amount || p.price.currency !== v.price.currency || !text(v.channel) || p.channel !== v.channel
    || !['awaiting_payment','confirming','paid','closed'].includes(v.paymentState) || !['not_eligible','fulfilled'].includes(v.fulfillmentStatus)
    || v.status !== (r?.status === 'refunded' ? 'refunded' : v.paymentState === 'paid' ? 'fulfilled' : v.paymentState)
    || (v.paymentState === 'paid' ? !price(paid) || paid.amount !== v.price.amount || paid.currency !== v.price.currency : paid !== null)
    || v.fulfillmentStatus === 'fulfilled' && v.paymentState !== 'paid'
    || a !== null && (!a || !uuid.test(a.attemptId) || !['preparing','pending','succeeded','failed','closed'].includes(a.status)
      || a.launch !== undefined && (v.paymentState !== 'confirming' || !['preparing','pending'].includes(a.status)))
    || r !== null && (!r || !uuid.test(r.refundId) || !['reserved','pending','refunded','failed','review'].includes(r.status) || r.failureCode !== null && !text(r.failureCode))
    || v.refundStatus !== (r ? r.status === 'reserved' || r.status === 'review' ? 'requested' : r.status : 'none')) throw invalid()
  if (a?.launch !== undefined) validateCheckoutLaunch(a.launch)
  return v
}

// Read-only and session-owned: no storage, quotation, order creation, payment,
// reconciliation or asset operation is exposed by this client.
export function createOrdersClient(context: OrderServiceContext) {
  const sessionId = context.sessionId
  if (!uuid.test(context.accountId) || !uuid.test(sessionId)) throw new OrderServiceError(400, 'INVALID_ARGUMENT')
  let active = true, epoch = 0
  const controllers = new Set<AbortController>()
  async function get(path: string, signal?: AbortSignal) {
    const captured = epoch, controller = new AbortController()
    const check = () => { if (!active || captured !== epoch || controller.signal.aborted || signal?.aborted) throw new DOMException('Canceled', 'AbortError') }
    const cancel = () => controller.abort()
    signal?.addEventListener('abort', cancel, { once: true }); controllers.add(controller)
    try {
      check()
      const response = await fetch(path, { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal, headers: { 'X-Xijie-Expected-Session': sessionId } })
      check()
      let body
      try { body = await response.json() } catch { check(); throw invalid() }
      check()
      if (!response.ok) { if (response.status === 401) context.onUnauthorized(); throw new OrderServiceError(response.status, body?.error?.code ?? 'UNAVAILABLE') }
      if (body?.data === undefined) throw invalid()
      return body
    } finally { controllers.delete(controller); signal?.removeEventListener('abort', cancel) }
  }
  return {
    activate() { active = true },
    dispose() { active = false; epoch++; controllers.forEach(c => c.abort()); controllers.clear() },
    async list(cursor?: string, signal?: AbortSignal): Promise<OrderPage> {
      if (cursor !== undefined && !uuid.test(cursor)) throw new OrderServiceError(400, 'INVALID_ARGUMENT')
      const result = await get('/v1/orders?' + new URLSearchParams({ limit: '20', ...(cursor ? { cursor } : {}) }), signal)
      if (!Array.isArray(result.data) || result.data.length > 20 || !result.meta || !(result.meta.nextCursor === null || typeof result.meta.nextCursor === 'string' && uuid.test(result.meta.nextCursor))) throw invalid()
      const data = result.data.map(validateOrder) as OrderView[], nextCursor = result.meta.nextCursor as string | null
      if (new Set(data.map(v => v.orderId)).size !== data.length || nextCursor !== null && (nextCursor === cursor || nextCursor !== data.at(-1)?.orderId)) throw invalid()
      return { data, meta: { nextCursor } }
    },
    async read(id: string, signal?: AbortSignal) {
      if (!uuid.test(id)) throw new OrderServiceError(400, 'INVALID_ARGUMENT')
      const result = validateOrder((await get('/v1/orders/' + id, signal)).data)
      if (result.orderId !== id) throw invalid()
      return result
    },
  }
}
