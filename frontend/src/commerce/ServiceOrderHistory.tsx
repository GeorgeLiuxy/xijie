import { CaretRight, Check, Clock, Receipt, WarningCircle, X } from '@phosphor-icons/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { isZh, useI18n } from '../i18n'
import { ContextSheet } from '../mobile/ContextSheet'
import { createOrdersClient, OrderServiceError, type OrderServiceContext, type OrderView } from './serviceOrders'

export function ServiceOrderHistory({ context, onClose, onUnavailable, onSelect }: { context: OrderServiceContext; onClose: () => void; onUnavailable: () => void; onSelect?: (order: OrderView) => void }) {
  const { lang } = useI18n(), zh = isZh(lang), copy = (cn: string, en: string) => zh ? cn : en
  const latest = useRef(context); latest.current = context
  const client = useMemo(() => createOrdersClient({ ...context, onUnauthorized: () => latest.current.onUnauthorized() }), [context.accountId, context.sessionId])
  const [orders, setOrders] = useState<OrderView[]>([]), [next, setNext] = useState<string | null>(null), [ready, setReady] = useState(false)
  const [id, setId] = useState<string | null>(null), [order, setOrder] = useState<OrderView | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState(false)
  const scroll = useRef<HTMLDivElement>(null), heading = useRef<HTMLHeadingElement>(null), reading = useRef(false), seen = useRef(new Set<string>())
  const active = useRef(false), revision = useRef(0), request = useRef<AbortController | null>(null)
  const read = useCallback(async (detailId: string | null, cursor?: string) => {
    if (reading.current || !active.current) return
    reading.current = true; const captured = revision.current, controller = new AbortController(); request.current = controller
    const live = () => active.current && captured === revision.current && !controller.signal.aborted
    setBusy(true); setError(false)
    try {
      if (detailId) { const value = await client.read(detailId, controller.signal); if (live()) setOrder(value) }
      else {
        const page = await client.list(cursor, controller.signal)
        if (!live()) return
        if (cursor && (page.data.some(row => seen.current.has(row.orderId)) || page.meta.nextCursor && seen.current.has(page.meta.nextCursor))) throw new OrderServiceError(502, 'INVALID_RESPONSE')
        if (!cursor) seen.current.clear()
        page.data.forEach(row => seen.current.add(row.orderId)); setOrders(old => cursor ? [...old, ...page.data] : page.data); setNext(page.meta.nextCursor); setReady(true)
      }
    } catch (cause) {
      if (live()) { setError(true); if (cause instanceof OrderServiceError && [401,403,404].includes(cause.status)) { setOrders([]); setOrder(null); setReady(false); setNext(null); seen.current.clear() } }
    } finally { if (live()) { reading.current = false; setBusy(false) } }
  }, [client])
  useEffect(() => { active.current = true; client.activate(); return () => { active.current = false; revision.current++; request.current?.abort(); client.dispose() } }, [client])
  useEffect(() => {
    revision.current++; request.current?.abort(); reading.current = false; setOrder(null); setError(false)
    void read(id)
    return () => { revision.current++; request.current?.abort(); reading.current = false }
  }, [id, read])
  useLayoutEffect(() => { scroll.current?.scrollTo({ top: 0 }); heading.current?.focus({ preventScroll: true }) }, [id])
  const loadMore = useCallback(() => {
    const el = scroll.current
    if (!id && next && !busy && !error && el && el.scrollHeight - el.scrollTop - el.clientHeight < 100) void read(null, next)
  }, [id, next, busy, error, read])
  useEffect(loadMore, [loadMore, orders.length])
  const amount = (value: OrderView['price']) => {
    const format = new Intl.NumberFormat(lang, { style: 'currency', currency: value.currency })
    return format.format(value.amount / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2))
  }
  const label = (value: OrderView) => {
    if (value.refund) return ({ reserved: copy('已申请退款', 'Refund requested'), pending: copy('退款处理中', 'Refund pending'), refunded: copy('退款已确认', 'Refund confirmed'), failed: copy('退款未完成', 'Refund not completed'), review: copy('退款审核中', 'Refund under review') })[value.refund.status]
    return ({ awaiting_payment: copy('待付款', 'Awaiting payment'), confirming: copy('待支付确认', 'Payment pending'), fulfilled: value.fulfillmentStatus === 'fulfilled' ? copy('邮资已到账', 'Postage added') : copy('付款已确认', 'Payment confirmed'), closed: copy('订单已关闭', 'Order closed'), refunded: copy('退款已确认', 'Refund confirmed') })[value.status]
  }
  const title = id ? copy('订单详情', 'Order details') : copy('订单记录', 'Order history')
  return <ContextSheet label={title} className="checkout-preview" onClose={onClose} backPriority={50}>
    <header className="checkout-header">
      <div><p className="checkout-kicker">{copy('当前账号', 'CURRENT ACCOUNT')}</p><h2 ref={heading} tabIndex={-1}>{title}</h2></div>
      <div className="checkout-header-actions">
        <button className="checkout-text-action" onClick={() => id ? setId(null) : onUnavailable()}>{id ? copy('订单记录', 'Order history') : copy('购买', 'Purchase')}</button>
        <button type="button" data-context-close className="checkout-close" aria-label={copy('关闭', 'Close')} onClick={onClose}><X size={21} aria-hidden /></button>
      </div>
    </header>
    <div ref={scroll} className="checkout-scroll scroll-quiet" aria-busy={busy} onScroll={loadMore}>
      {!id && !!orders.length && <ul className="checkout-order-list">{orders.map(item => <li key={item.orderId}><button type="button" onClick={() => onSelect ? onSelect(item) : setId(item.orderId)}>
        <div><strong>{item.productSnapshot.name}</strong><small>{new Date(item.createdAt).toLocaleDateString(lang)}</small></div>
        <div className="checkout-order-end"><strong>{amount(item.price)}</strong><small>{label(item)}</small></div><CaretRight size={16} aria-hidden />
      </button></li>)}</ul>}
      {!id && ready && !busy && !error && !orders.length && <div className="checkout-empty"><span className="checkout-symbol"><Receipt weight="duotone" size={28} aria-hidden /></span>
        <h3>{copy('还没有订单', 'No orders yet')}</h3><p>{copy('创建订单后可在这里查看进度。', 'After creating an order, return here to check its status.')}</p></div>}
      {id && order && <>
        <section className="checkout-status" data-status={order.status === 'closed' ? 'cancelled' : order.refund?.status === 'failed' ? 'failed' : order.status} role="status">
          <span className="checkout-symbol">{order.status === 'fulfilled' || order.status === 'refunded' ? <Check size={28} weight="bold" aria-hidden /> : order.status === 'closed' ? <WarningCircle weight="duotone" size={28} aria-hidden /> : <Clock weight="duotone" size={28} aria-hidden />}</span>
          <div><h3>{label(order)}</h3><p>{order.refund ? copy('这里显示订单当前的退款进度。', 'The current refund status is shown here.')
            : order.status === 'confirming' ? copy('付款结果待确认。离开后可在订单记录继续查询。', 'The payment result is pending. You can return from order history.')
            : order.status === 'fulfilled' ? order.fulfillmentStatus === 'fulfilled' ? copy(`${order.productSnapshot.units} 邮资已发放至当前账号。`, `${order.productSnapshot.units} postage was issued to your account.`) : copy('付款已确认，可继续查看到账结果。', 'Payment is confirmed. Check again for the postage result.')
            : order.status === 'closed' ? copy('这笔订单已关闭。', 'This order is closed.') : copy('这笔订单尚未付款。', 'This order has not been paid.')}</p></div>
        </section>
        <dl className="checkout-receipt">
          <div><dt>{copy('商品', 'Item')}</dt><dd>{order.productSnapshot.name}</dd></div>
          <div><dt>{copy('付款方式', 'Payment method')}</dt><dd>{copy('收银台支付', 'Online checkout')}</dd></div>
          <div><dt>{copy('订单金额', 'Order total')}</dt><dd>{amount(order.price)}</dd></div>
          {order.paidAmount && <div><dt>{copy('实付金额', 'Amount paid')}</dt><dd>{amount(order.paidAmount)}</dd></div>}
          <div><dt>{copy('订单编号', 'Order number')}</dt><dd className="checkout-reference">{order.orderId}</dd></div>
        </dl>
      </>}
      {busy && <p className="checkout-empty" role="status">{copy('正在查询…', 'Checking…')}</p>}
      {error && <p className="checkout-error" role="alert">{copy('暂时无法查看订单，请稍后重试。', 'We couldn’t load your orders. Please try again.')} <button className="checkout-text-action" onClick={() => void read(id, !id && ready && next ? next : undefined)}>{copy('重试', 'Try again')}</button></p>}
    </div>
    {id && order && <footer className="checkout-footer"><button className="checkout-primary btn-dark" disabled={busy} onClick={() => void read(id)}>{busy ? copy('正在查询…', 'Checking…') : copy('查询订单进度', 'Check order status')}</button></footer>}
  </ContextSheet>
}
