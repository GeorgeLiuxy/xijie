import { createHash, timingSafeEqual } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { GiftsError, invalid, object } from './contracts.js'

type VerificationMode = 'test' | 'live'
type PlayMoney = { currencyCode: string; units: string; nanos: number }
type NonSettledState = 'pending' | 'canceled' | 'refund_pending' | 'partially_refunded' | 'refunded'
export type GooglePlayVerificationConfig = {
  packageName: string
  productId: string
  mode: VerificationMode
  accessTokenFile: string
}
type Evidence = { purchaseFingerprint: string; storeOrderId: string | null; mode: VerificationMode; productId: string }
export type GooglePlayInspection = Evidence & (
  | { state: NonSettledState }
  | { state: 'purchased'; storeOrderId: string; completedAt: string; consumption: 'available' | 'consumed'; totalPaid: PlayMoney }
)

const packagePattern = /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*){1,10}$/
const productPattern = /^[a-z0-9][a-z0-9._]{0,149}$/
const orderPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
const accountPattern = /^[A-Za-z0-9_-]{22,64}$/
const purchaseTokenPattern = /^[A-Za-z0-9._~:+/=-]{1,4096}$/
const accessTokenPattern = /^[A-Za-z0-9._~+/-]{1,8192}={0,2}$/
const publisher = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'
const unavailable = () => new GiftsError(503, 'GOOGLE_PLAY_VERIFICATION_UNAVAILABLE')
const evidenceInvalid = () => new GiftsError(503, 'GOOGLE_PLAY_EVIDENCE_INVALID')
const responseLimit = 64 * 1024

export function readGooglePlayVerificationConfig(env: NodeJS.ProcessEnv = process.env): GooglePlayVerificationConfig | undefined {
  const enabled = env.GIFTS_GOOGLE_PLAY_VERIFICATION_ENABLED
  if (enabled === undefined || enabled === 'false') return
  if (enabled !== 'true') throw unavailable()
  const packageName = env.GIFTS_GOOGLE_PLAY_PACKAGE
  const productId = env.GIFTS_GOOGLE_PLAY_PRODUCT_ID
  const mode = env.GIFTS_GOOGLE_PLAY_VERIFICATION_MODE
  const accessTokenFile = env.GIFTS_GOOGLE_PLAY_ACCESS_TOKEN_FILE
  if (!packageName || packageName.length > 255 || !packagePattern.test(packageName)
    || !productId || !productPattern.test(productId)
    || mode !== 'test' && mode !== 'live'
    || !accessTokenFile || !isAbsolute(accessTokenFile)) throw unavailable()
  return { packageName, productId, mode, accessTokenFile }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw evidenceInvalid()
  return value as Record<string, unknown>
}

function matches(expected: string, observed: unknown): boolean {
  return typeof observed === 'string' && observed.length === expected.length
    && Buffer.byteLength(observed) === expected.length
    && timingSafeEqual(Buffer.from(expected), Buffer.from(observed))
}

function line(value: unknown, productId: string): Record<string, unknown> {
  if (!Array.isArray(value) || value.length !== 1) throw evidenceInvalid()
  const item = record(value[0])
  if (item.productId !== productId) throw evidenceInvalid()
  return item
}

function money(value: unknown): PlayMoney {
  const { currencyCode, units = '0', nanos = 0 } = record(value)
  if (typeof currencyCode !== 'string' || !/^[A-Z]{3}$/.test(currencyCode)
    || typeof units !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(units) || BigInt(units) > 9223372036854775807n
    || typeof nanos !== 'number' || !Number.isInteger(nanos) || nanos < 0 || nanos > 999999999) throw evidenceInvalid()
  return { currencyCode, units, nanos }
}

async function publisherRead(url: string, accessToken: string, transport: typeof fetch, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(8000)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  let response: Response
  try {
    response = await transport(url, {
      method: 'GET', headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' },
      redirect: 'error', cache: 'no-store', signal: requestSignal,
    })
  } catch { throw unavailable() }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {})
    if (response.status === 404) throw new GiftsError(404, 'GOOGLE_PLAY_EVIDENCE_NOT_FOUND')
    throw unavailable()
  }
  const reader = response.body?.getReader()
  if (!reader) throw evidenceInvalid()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > responseLimit) throw evidenceInvalid()
      chunks.push(part.value)
    }
    return record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))))
  } catch {
    void reader.cancel().catch(() => {})
    throw evidenceInvalid()
  } finally { reader.releaseLock() }
}

/** Read-only evidence for an operator-verified purchase. The expected binding comes from the app account. */
export async function inspectGooglePlayPurchase(
  config: GooglePlayVerificationConfig | undefined,
  accessToken: string,
  request: unknown,
  { transport = fetch, signal }: { transport?: typeof fetch; signal?: AbortSignal } = {},
): Promise<GooglePlayInspection> {
  if (!config || !accessTokenPattern.test(accessToken)) throw unavailable()
  const { purchaseToken, accountBinding } = object(request, ['purchaseToken', 'accountBinding'])
  if (typeof purchaseToken !== 'string' || !purchaseTokenPattern.test(purchaseToken) || purchaseToken === '.' || purchaseToken === '..'
    || typeof accountBinding !== 'string' || !accountPattern.test(accountBinding)) throw invalid()

  const root = publisher + encodeURIComponent(config.packageName)
  const purchase = await publisherRead(root + '/purchases/productsv2/tokens/' + encodeURIComponent(purchaseToken), accessToken, transport, signal)
  if (!matches(accountBinding, purchase.obfuscatedExternalAccountId)) throw new GiftsError(409, 'GOOGLE_PLAY_ACCOUNT_MISMATCH')
  const isTest = Object.hasOwn(purchase, 'testPurchaseContext')
  if ((config.mode === 'test') !== isTest || isTest && record(purchase.testPurchaseContext).fopType !== 'TEST')
    throw new GiftsError(409, 'GOOGLE_PLAY_ENVIRONMENT_MISMATCH')

  const purchaseState = record(purchase.purchaseStateContext).purchaseState
  if (purchaseState !== 'PENDING' && purchaseState !== 'CANCELLED' && purchaseState !== 'PURCHASED') throw evidenceInvalid()
  const item = line(purchase.productLineItem, config.productId)
  const orderId = purchase.orderId
  if (orderId !== undefined && (typeof orderId !== 'string' || !orderPattern.test(orderId))) throw evidenceInvalid()
  const evidence = {
    purchaseFingerprint: createHash('sha256').update(config.packageName).update('\0').update(purchaseToken).digest('hex'),
    storeOrderId: orderId ?? null, mode: config.mode, productId: config.productId,
  }
  if (purchaseState === 'PENDING') return { ...evidence, state: 'pending' }
  if (!orderId) {
    if (purchaseState === 'CANCELLED') return { ...evidence, state: 'canceled' }
    throw evidenceInvalid()
  }

  const order = await publisherRead(root + '/orders/' + encodeURIComponent(orderId), accessToken, transport, signal)
  if (order.orderId !== orderId || !matches(purchaseToken, order.purchaseToken)) throw evidenceInvalid()
  const orderItem = line(order.lineItems, config.productId)
  const details = record(orderItem.oneTimePurchaseDetails)
  const offer = item.productOfferDetails === undefined ? {} : record(item.productOfferDetails)
  if (details.quantity !== undefined && details.quantity !== 1 || offer.quantity !== undefined && offer.quantity !== 1
    || details.quantity !== 1 && offer.quantity !== 1
    || Object.hasOwn(details, 'rentalDetails') || Object.hasOwn(details, 'preorderDetails')
    || Object.hasOwn(offer, 'rentOfferDetails') || Object.hasOwn(offer, 'preorderOfferDetails')
    || Object.hasOwn(orderItem, 'subscriptionDetails') || Object.hasOwn(orderItem, 'paidAppDetails')) throw evidenceInvalid()

  if (order.state === 'REFUNDED') return { ...evidence, state: 'refunded' }
  if (order.state === 'PARTIALLY_REFUNDED') return { ...evidence, state: 'partially_refunded' }
  if (order.state === 'PENDING_REFUND') return { ...evidence, state: 'refund_pending' }
  if (order.state === 'CANCELED') return { ...evidence, state: 'canceled' }
  if (order.state === 'PENDING') return { ...evidence, state: 'pending' }
  if (order.state !== 'PROCESSED' || purchaseState !== 'PURCHASED') throw evidenceInvalid()

  if (offer.quantity !== 1 || offer.refundableQuantity !== 1) throw evidenceInvalid()
  if (offer.consumptionState !== 'CONSUMPTION_STATE_YET_TO_BE_CONSUMED' && offer.consumptionState !== 'CONSUMPTION_STATE_CONSUMED') throw evidenceInvalid()
  const completed = purchase.purchaseCompletionTime
  if (typeof completed !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(completed)
    || !Number.isFinite(Date.parse(completed)) || Date.parse(completed) > Date.now() + 60000) throw evidenceInvalid()
  const totalPaid = money(order.total), linePaid = money(orderItem.total)
  if (totalPaid.currencyCode !== linePaid.currencyCode || totalPaid.units !== linePaid.units || totalPaid.nanos !== linePaid.nanos) throw evidenceInvalid()
  return {
    ...evidence, storeOrderId: orderId, state: 'purchased', completedAt: new Date(completed).toISOString(),
    consumption: offer.consumptionState === 'CONSUMPTION_STATE_CONSUMED' ? 'consumed' : 'available', totalPaid,
  }
}
