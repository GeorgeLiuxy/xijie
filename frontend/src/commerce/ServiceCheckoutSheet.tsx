import { Check, Clock, Stamp, Wallet, WarningCircle, X } from '@phosphor-icons/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { isZh, useI18n } from '../i18n'
import { ContextSheet } from '../mobile/ContextSheet'
import { ServiceOrderHistory } from './ServiceOrderHistory'
import { createCheckoutClient, type CheckoutProduct } from './serviceCheckout'
import { OrderServiceError, validateCheckoutLaunch, type OrderServiceContext, type OrderView } from './serviceOrders'

type View = { kind: 'purchase' | 'orders' } | { kind: 'detail'; id: string }
export function ServiceCheckout({ context, initialView, onClose, onChanged }: { context: OrderServiceContext; initialView: 'purchase' | 'orders'; onClose: () => void; onChanged?: () => void }) {
  const { lang } = useI18n(), zh = isZh(lang), copy = (cn: string, en: string) => zh ? cn : en
  const latest = useRef({ context, onChanged }); latest.current = { context, onChanged }
  const client = useMemo(() => createCheckoutClient({ ...context, onUnauthorized: () => latest.current.context.onUnauthorized() }), [context.accountId, context.sessionId])
  const [view, setView] = useState<View>({ kind: initialView }), [products, setProducts] = useState<CheckoutProduct[]>([]), [productId, setProductId] = useState('')
  const [enabled, setEnabled] = useState(false), [ready, setReady] = useState(false), [order, setOrder] = useState<OrderView | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [recoveryProduct, setRecoveryProduct] = useState<CheckoutProduct | undefined>(), [pending, setPending] = useState<string | undefined>()
  const active = useRef(false), revision = useRef(0), lock = useRef<number | null>(null), scroll = useRef<HTMLDivElement>(null), heading = useRef<HTMLHeadingElement>(null)
  const detailId = view.kind === 'detail' ? view.id : null
  const product = recoveryProduct ?? products.find(p => p.id === productId) ?? products[0]
  const message = (cause: unknown) => {
    const code = cause instanceof OrderServiceError ? cause.code : ''
    return code === 'PURCHASE_UNAVAILABLE' ? copy('购买暂未开放，请稍后再来。', 'Purchasing is not available yet. Please come back later.')
      : code === 'QUOTE_EXPIRED' ? copy('这份价格信息已过期，请重新下单查看最新价格。', 'This price has expired. Start the order again to see the current price.')
      : code === 'PRICE_CHANGED' ? copy('商品或价格刚刚更新，请查看新价格后再确认下单。', 'The item or price has changed. Review the updated price before placing your order.')
      : code === 'REFUND_REQUIRES_REVIEW' ? copy('退款申请正在审核，可在这笔订单里查看进度。', 'Your refund request is under review. Check its progress on this order.')
      : code === 'RECOVERY_STORAGE_UNAVAILABLE' ? copy('当前设备暂时无法保存付款进度，请稍后重试。已有订单仍可在「订单记录」查看。', 'This device cannot save payment progress right now. Retry later; existing orders remain in Order history.')
      : code === 'CHECKOUT_PENDING' ? copy('上次付款还没有完成，请到「订单记录」打开那笔订单继续。', 'Your previous payment is not finished. Open that order in Order history to continue.')
      : copy('暂时无法查看最新结果，请重试。订单和付款进度会保留。', 'The latest result could not be loaded. Retry to continue the same order and payment.')
  }
  const rememberState = () => { setRecoveryProduct(client.purchase?.product); setPending(client.pending) }
  const perform = useCallback(async (operation: () => Promise<void>, quiet = false) => {
    if (!active.current || lock.current === revision.current) return
    const captured = revision.current; lock.current = captured
    setBusy(true); if (!quiet) setError('')
    const live = () => active.current && captured === revision.current
    try { await operation() }
    catch (cause) { if (live() && !(cause instanceof DOMException && cause.name === 'AbortError')) { setError(message(cause)); if (cause instanceof OrderServiceError && [401,403,404].includes(cause.status)) { setOrder(null); setProducts([]); setRecoveryProduct(undefined); setReady(false) } } }
    finally { if (live()) { setBusy(false); try { rememberState() } catch { /* The original storage error remains visible. */ } }; if (lock.current === captured) lock.current = null }
  }, [client, zh])
  const refreshOrder = useCallback(async (id: string) => {
    const captured = revision.current, value = await client.read(id)
    if (!active.current || captured !== revision.current) return
    setOrder(value)
    if (value.paymentState === 'paid') latest.current.onChanged?.()
  }, [client])
  useEffect(() => { active.current = true; client.activate(); return () => { active.current = false; revision.current++; client.dispose() } }, [client])
  useEffect(() => {
    revision.current++; setError(''); setOrder(null); setReady(false)
    if (view.kind === 'orders') return
    const captured = revision.current
    void perform(async () => {
      if (view.kind === 'detail') { await refreshOrder(view.id); return }
      const result = await client.products()
      if (!active.current || captured !== revision.current) return
      setProducts(result.data); setEnabled(result.purchasingEnabled); setProductId(result.data[0]?.id ?? ''); setReady(true); rememberState()
      const original = client.pendingOrderId ?? client.purchase?.orderId
      if (original) setView({ kind: 'detail', id: original })
    })
  }, [view.kind, detailId, client, perform, refreshOrder])
  useEffect(() => {
    if (!detailId || !order || order.paymentState !== 'confirming' && order.refund?.status !== 'reserved' && order.refund?.status !== 'pending') return
    const read = () => { if (document.visibilityState !== 'hidden') void perform(() => refreshOrder(detailId), true) }
    const timer = window.setInterval(read, 10000)
    window.addEventListener('focus', read); document.addEventListener('visibilitychange', read)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', read); document.removeEventListener('visibilitychange', read) }
  }, [detailId, order?.paymentState, order?.refund?.status, perform, refreshOrder])
  useLayoutEffect(() => { scroll.current?.scrollTo({ top: 0 }); heading.current?.focus({ preventScroll: true }) }, [view.kind, detailId])
  const amount = (price: CheckoutProduct['price']) => { const format = new Intl.NumberFormat(lang, { style: 'currency', currency: price.currency }); return format.format(price.amount / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2)) }
  const label = (v: OrderView) => v.refund ? ({ reserved: copy('已申请退款','Refund requested'), pending: copy('退款处理中','Refund pending'), refunded: copy('退款已确认','Refund confirmed'), failed: copy('退款未完成','Refund not completed'), review: copy('退款审核中','Refund under review') })[v.refund.status]
    : ({ awaiting_payment: copy('待付款','Awaiting payment'), confirming: copy('待支付确认','Payment pending'), fulfilled: v.fulfillmentStatus === 'fulfilled' ? copy('邮资已到账','Postage added') : copy('付款已确认','Payment confirmed'), closed: copy('订单已关闭','Order closed'), refunded: copy('退款已确认','Refund confirmed') })[v.status]
  const accept = (value: OrderView) => { if (!active.current) return; setOrder(value); setView({ kind: 'detail', id: value.orderId }); if (value.paymentState === 'paid') latest.current.onChanged?.() }
  const update = (kind: 'attempt' | 'close' | 'refund') => { if (detailId) void perform(async () => { accept(await (kind === 'attempt' ? client.startPayment(detailId) : kind === 'close' ? client.close(detailId) : client.refund(detailId))) }) }
  const launch = order?.attemptSummary?.launch
  const openPayment = () => {
    if (!launch || !order || order.paymentState !== 'confirming') return
    try {
      validateCheckoutLaunch(launch)
      if (Date.parse(launch.expiresAt) <= Date.now()) { setError(copy('付款入口已过期，请查询原订单的最新状态。','This payment link expired. Check the original order status.')); return }
      // Navigation occurs only on this explicit click. Returning from the
      // cashier never marks the order paid; the server remains authoritative.
      window.open(launch.url, '_blank', 'noopener,noreferrer')
    } catch { setError(copy('付款入口暂时无法打开，请查询原订单。','The payment page is unavailable. Check the original order.')) }
  }
  const title = view.kind === 'purchase' ? copy('购买邮资','Buy postage') : copy('订单详情','Order details')
  if (view.kind === 'orders') return <ServiceOrderHistory context={context} onClose={onClose} onUnavailable={() => setView({ kind: 'purchase' })} onSelect={v => setView({ kind: 'detail', id: v.orderId })} />
  return <ContextSheet label={title} className="checkout-preview" onClose={onClose} closeDisabled={busy} backPriority={50}>
    <header className="checkout-header"><div><p className="checkout-kicker">{copy('当前账号','CURRENT ACCOUNT')}</p><h2 ref={heading} tabIndex={-1}>{title}</h2></div>
      <div className="checkout-header-actions"><button className="checkout-text-action" disabled={busy} onClick={() => setView({ kind: 'orders' })}>{copy('订单记录','Order history')}</button><button type="button" data-context-close className="checkout-close" aria-label={copy('关闭','Close')} disabled={busy} onClick={onClose}><X size={21} aria-hidden /></button></div></header>
    <div ref={scroll} className="checkout-scroll scroll-quiet" aria-busy={busy}>
      {view.kind === 'purchase' && product && <>
        <div className="checkout-product"><span className="checkout-symbol"><Stamp weight="duotone" size={30} aria-hidden /></span><div><h3>{product.name}</h3><p>{copy('到账后可用于寄送虚拟礼物','Use it to send virtual gifts')}</p></div><strong>{amount(product.price)}</strong></div>
        <label className="checkout-channel"><span>{copy('商品','Item')}</span><select value={product.id} disabled={busy || !!recoveryProduct} onChange={event => setProductId(event.target.value)}>{(recoveryProduct ? [recoveryProduct] : products).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <fieldset className="checkout-methods"><legend>{copy('付款方式','Payment method')}</legend><button className="checkout-method" type="button" aria-pressed disabled><Wallet size={23} aria-hidden /><span>{copy('收银台支付','Checkout')}<small> · {copy('在收银台选择可用方式','Choose an available method at checkout')}</small></span><span className="checkout-method-marker" aria-hidden><Check size={12} weight="bold" /></span></button></fieldset>
        {pending && <p className="checkout-empty" role="status">{copy('上次订单还没有完成，可继续打开查看进度。','Your previous order is not finished. Continue to view its progress.')}</p>}
      </>}
      {view.kind === 'purchase' && ready && !product && <div className="checkout-empty"><span className="checkout-symbol"><Stamp weight="duotone" size={28} aria-hidden /></span><h3>{copy('购买暂未开放','Purchasing is not available yet')}</h3><p>{copy('已有订单仍可在订单记录中查看。','Your existing orders remain available in order history.')}</p></div>}
      {view.kind === 'detail' && order && <>
        <section className="checkout-status" data-status={order.status === 'closed' ? 'cancelled' : order.refund?.status === 'failed' ? 'failed' : order.status} role="status"><span className="checkout-symbol">{order.paymentState === 'paid' ? <Check size={28} weight="bold" aria-hidden /> : order.paymentState === 'closed' ? <WarningCircle weight="duotone" size={28} aria-hidden /> : <Clock weight="duotone" size={28} aria-hidden />}</span><div><h3>{label(order)}</h3><p>{order.refund ? copy('这里显示订单当前的退款进度。','The current refund status is shown here.') : order.paymentState === 'confirming' ? copy('付款结果待确认。离开后可在订单记录继续查询。','The payment result is pending. You can return from order history.') : order.paymentState === 'paid' ? copy('可在资产与记录中查看实际到账。','Check assets and records for issued postage.') : order.paymentState === 'closed' ? copy('这笔订单已关闭。','This order is closed.') : copy('请查看订单金额，再前往收银台选择付款方式。','Review the total, then choose a payment method at checkout.')}</p></div></section>
        <dl className="checkout-receipt"><div><dt>{copy('商品','Item')}</dt><dd>{order.productSnapshot.name}</dd></div><div><dt>{copy('付款方式','Payment method')}</dt><dd>{copy('收银台支付','Checkout')}</dd></div><div><dt>{copy('订单金额','Order total')}</dt><dd>{amount(order.price)}</dd></div>{order.paidAmount && <div><dt>{copy('实付金额','Amount paid')}</dt><dd>{amount(order.paidAmount)}</dd></div>}<div><dt>{copy('订单编号','Order number')}</dt><dd className="checkout-reference">{order.orderId}</dd></div></dl>
      </>}
      {busy && <p className="checkout-empty" role="status">{copy('正在查询…','Checking…')}</p>}
      {error && <p className="checkout-error" role="alert">{error} <button className="checkout-text-action" disabled={busy} onClick={() => detailId ? void perform(() => refreshOrder(detailId)) : setView({ kind: 'orders' })}>{detailId ? copy('查询原订单','Check original order') : copy('订单记录','Order history')}</button></p>}
    </div>
    {view.kind === 'purchase' && product && <footer className="checkout-footer"><button className="checkout-primary btn-dark" disabled={busy || !enabled && !recoveryProduct} onClick={() => void perform(async () => accept(await client.buy(product)))}>{busy ? copy('正在创建…','Creating…') : recoveryProduct ? copy('继续创建订单','Continue creating order') : copy('创建订单','Create order')}</button></footer>}
    {view.kind === 'detail' && order && <footer className="checkout-footer">
      {order.paymentState === 'awaiting_payment' && <button className="checkout-primary btn-dark" disabled={busy} onClick={() => update('attempt')}>{copy('前往收银台付款','Continue to checkout')}</button>}
      {order.paymentState === 'confirming' && launch && Date.parse(launch.expiresAt) > Date.now() && <button className="checkout-primary btn-dark" disabled={busy} onClick={openPayment}>{copy('继续付款','Continue payment')}</button>}
      {order.paymentState === 'confirming' && !launch && <button className="checkout-primary btn-dark" disabled={busy} onClick={() => void perform(() => refreshOrder(order.orderId))}>{copy('查询支付结果','Check payment')}</button>}
      {['paid','closed'].includes(order.paymentState) && <button className="checkout-primary btn-dark" disabled={busy} onClick={() => void perform(async () => { await client.finishPurchase(order.orderId); if (active.current) onClose() })}>{copy('完成','Done')}</button>}
      <div className="checkout-secondary-actions">
        {order.paymentState === 'confirming' && launch && <button disabled={busy} onClick={() => void perform(() => refreshOrder(order.orderId))}>{copy('查询支付结果','Check payment')}</button>}
        {order.paymentState === 'awaiting_payment' && <button disabled={busy} onClick={() => update('close')}>{copy('取消订单','Cancel order')}</button>}
        {order.paymentState === 'paid' && (!order.refund || order.refund.status === 'failed') && <button disabled={busy} onClick={() => update('refund')}>{copy('申请退款','Request refund')}</button>}
        {order.refund && <button disabled={busy} onClick={() => void perform(() => refreshOrder(order.orderId))}>{copy('查询退款进度','Check refund status')}</button>}
        {pending === 'attempt' && <button disabled={busy} onClick={() => update('attempt')}>{copy('继续上次付款','Continue previous payment')}</button>}
        {pending === 'close' && <button disabled={busy} onClick={() => update('close')}>{copy('继续取消订单','Continue cancellation')}</button>}
        {pending === 'refund' && <button disabled={busy} onClick={() => update('refund')}>{copy('继续申请退款','Continue refund request')}</button>}
      </div>
    </footer>}
  </ContextSheet>
}
