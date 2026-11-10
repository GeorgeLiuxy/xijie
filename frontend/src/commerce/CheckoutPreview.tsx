import { AppleLogo, CaretRight, Check, Clock, CreditCard, GooglePlayLogo, Receipt, Stamp, Wallet, WarningCircle, WechatLogo, X } from '@phosphor-icons/react'
import { useLayoutEffect, useRef, useState } from 'react'
import { isZh, useI18n } from '../i18n'
import { ContextSheet } from '../mobile/ContextSheet'
import { isOpenOrder, type CheckoutAction } from './checkout'
import {
  createPreviewOrder, PREVIEW_POSTAGE, previewQuote, updatePreviewOrder, usePreviewOrders,
  type CheckoutStatus, type PaymentMethod, type PreviewChannel, type PreviewOrder,
} from './preview'
import './checkout-preview.css'

const channels = {
  mainland: ['中国大陆 Android / 网页', 'Mainland China Android / Web'],
  'app-store': ['App Store', 'App Store'],
  'google-play': ['Google Play', 'Google Play'],
  'international-web': ['海外网页', 'International web'],
} satisfies Record<PreviewChannel, readonly [string, string]>

const methods = {
  'wechat-pay': { name: ['微信支付', 'WeChat Pay'], icon: WechatLogo },
  alipay: { name: ['支付宝', 'Alipay'], icon: Wallet },
  'apple-iap': { name: ['Apple 内购', 'Apple In-App Purchase'], icon: AppleLogo },
  'play-billing': { name: ['Google Play 结算', 'Google Play Billing'], icon: GooglePlayLogo },
  card: { name: ['银行卡', 'Bank card'], icon: CreditCard },
} satisfies Record<PaymentMethod, { name: readonly [string, string]; icon: typeof CreditCard }>

const statusLabels = {
  unpaid: ['待付款', 'Awaiting payment'],
  confirming: ['待支付确认', 'Payment pending'],
  paid: ['付款已确认', 'Payment confirmed'],
  fulfilled: ['演示邮资已到账', 'Demo postage added'],
  cancelled: ['订单已取消', 'Order cancelled'],
  failed: ['付款失败', 'Payment failed'],
} satisfies Record<CheckoutStatus, readonly [string, string]>

type View = { kind: 'purchase' | 'orders' } | { kind: 'detail'; id: string }

export function CheckoutPreview({ owner, initialView, onClose }: {
  owner: string
  initialView: 'purchase' | 'orders'
  onClose: () => void
}) {
  const { lang } = useI18n()
  const language = isZh(lang) ? 0 : 1
  const copy = (zh: string, en: string) => language === 0 ? zh : en
  const [view, setView] = useState<View>({ kind: initialView })
  const [channel, setChannel] = useState<PreviewChannel>(language === 0 ? 'mainland' : 'international-web')
  const [method, setMethod] = useState<PaymentMethod>(previewQuote(channel).methods[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const locked = useRef(false)
  const scroll = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const orders = usePreviewOrders(owner)
  const openOrder = orders.find(isOpenOrder)
  const order = view.kind === 'detail' ? orders.find(item => item.id === view.id) : undefined
  const quote = previewQuote(channel)
  const title = view.kind === 'purchase' ? copy('购买演示', 'Purchase preview')
    : view.kind === 'orders' ? copy('订单记录', 'Order history')
    : copy('订单详情', 'Order details')
  const amount = (value: number, currency: PreviewOrder['currency']) =>
    new Intl.NumberFormat(lang, { style: 'currency', currency }).format(value / 100)
  const chooseView = (next: View) => {
    setError('')
    setView(next)
  }
  const viewKey = view.kind === 'detail' ? view.id : view.kind
  const previousView = useRef(viewKey)
  useLayoutEffect(() => {
    if (viewKey === previousView.current) return
    previousView.current = viewKey
    scroll.current?.scrollTo({ top: 0 })
    heading.current?.focus({ preventScroll: true })
  }, [viewKey])

  async function run(operation: () => Promise<PreviewOrder>, after?: (result: PreviewOrder) => void) {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setError('')
    try {
      const result = await operation()
      after?.(result)
    } catch {
      setError(copy('暂时无法更新订单，请稍后重试。', 'We couldn’t update the order. Please try again.'))
    } finally {
      locked.current = false
      setBusy(false)
    }
  }

  const showOrder = (item: PreviewOrder) => chooseView({ kind: 'detail', id: item.id })
  const update = (id: string, action: CheckoutAction) =>
    void run(() => updatePreviewOrder(owner, id, action))
  const orderedPostage = (value: number) => copy(`${value} 演示邮资`, `${value} demo postage`)

  return <ContextSheet label={title} className="checkout-preview" onClose={onClose} closeDisabled={busy} backPriority={50}>
    <header className="checkout-header">
      <div>
        <p className="checkout-kicker">{copy('本机演示 · 不扣款', 'ON-DEVICE DEMO · NO CHARGE')}</p>
        <h2 ref={heading} tabIndex={-1}>{title}</h2>
      </div>
      <div className="checkout-header-actions">
        {view.kind === 'orders'
          ? <button className="checkout-text-action" disabled={busy} onClick={() => chooseView({ kind: 'purchase' })}>{copy('购买演示', 'Purchase preview')}</button>
          : <button className="checkout-text-action" disabled={busy} onClick={() => chooseView({ kind: 'orders' })}>{copy('订单记录', 'Order history')}</button>}
        <button type="button" data-context-close className="checkout-close" aria-label={copy('关闭', 'Close')} disabled={busy} onClick={onClose}><X size={21} aria-hidden /></button>
      </div>
    </header>

    <div ref={scroll} className="checkout-scroll scroll-quiet" aria-busy={busy}>
      {view.kind === 'purchase' && (openOrder
        ? <div className="checkout-empty">
          <span className="checkout-symbol"><Clock weight="duotone" size={28} aria-hidden /></span>
          <h3>{copy('有一笔订单尚未完成', 'You have an unfinished order')}</h3>
          <p>{copy('打开原订单继续付款或查看到账情况。', 'Open the existing order to pay or check its progress.')}</p>
        </div>
        : <>
          <div className="checkout-product">
            <span className="checkout-symbol"><Stamp weight="duotone" size={30} aria-hidden /></span>
            <div><h3>{orderedPostage(PREVIEW_POSTAGE)}</h3><p>{copy('到账后可用于寄送虚拟礼物', 'Use it to send virtual gifts')}</p></div>
            <strong>{amount(quote.amount, quote.currency)}</strong>
          </div>

          <label className="checkout-channel">
            <span>{copy('发行渠道（演示）', 'Distribution channel (demo)')}</span>
            <select value={channel} disabled={busy} onChange={event => {
              const next = event.target.value as PreviewChannel
              setChannel(next)
              setMethod(previewQuote(next).methods[0])
            }}>
              {(Object.keys(channels) as PreviewChannel[]).map(key => <option key={key} value={key}>{channels[key][language]}</option>)}
            </select>
          </label>

          <fieldset className="checkout-methods">
            <legend>{copy('付款方式', 'Payment method')}</legend>
            {quote.methods.map(value => {
              const Icon = methods[value].icon
              return <button key={value} className="checkout-method" type="button" aria-pressed={value === method}
                onClick={() => setMethod(value)} disabled={busy}>
                <Icon size={23} aria-hidden /><span>{methods[value].name[language]}</span>
                <span className="checkout-method-marker" aria-hidden>{value === method && <Check size={12} weight="bold" />}</span>
              </button>
            })}
          </fieldset>
        </>)}

      {view.kind === 'orders' && (orders.length
        ? <ul className="checkout-order-list">
          {orders.map(item => <li key={item.id}>
            <button type="button" onClick={() => showOrder(item)}>
              <div><strong>{orderedPostage(item.postage)}</strong>
                <small>{new Date(item.createdAt).toLocaleDateString(lang)} · {methods[item.method].name[language]}</small></div>
              <div className="checkout-order-end"><strong>{amount(item.amount, item.currency)}</strong>
                <small>{statusLabels[item.status][language]}</small></div>
              <CaretRight size={16} aria-hidden />
            </button>
          </li>)}
        </ul>
        : <div className="checkout-empty">
          <span className="checkout-symbol"><Receipt weight="duotone" size={28} aria-hidden /></span>
          <h3>{copy('还没有演示订单', 'No demo orders yet')}</h3>
          <p>{copy('创建订单后可在这里继续付款和查看进度。', 'After creating an order, return here to pay or check its status.')}</p>
        </div>)}

      {view.kind === 'detail' && (order
        ? <>
          <section className="checkout-status" data-status={order.status} role="status">
            <span className="checkout-symbol">
              {order.status === 'fulfilled' ? <Check size={28} weight="bold" aria-hidden />
                : order.status === 'failed' || order.status === 'cancelled' ? <WarningCircle weight="duotone" size={28} aria-hidden />
                : <Clock weight="duotone" size={28} aria-hidden />}
            </span>
            <div>
              {order.status === 'unpaid' && <p className="checkout-stage">{copy('模拟收银台', 'Simulated checkout')}</p>}
              <h3>{statusLabels[order.status][language]}</h3>
              <p>{order.status === 'unpaid' ? copy('可体验付款、取消或付款失败。', 'Try paying, cancelling, or simulating a failed payment.')
                : order.status === 'confirming' ? copy('付款结果待确认。离开后可在订单记录继续查询。', 'The payment result is pending. You can return from order history.')
                : order.status === 'paid' ? copy('正在发放演示邮资，可继续查看到账结果。', 'Demo postage is being issued. Check again for the result.')
                : order.status === 'fulfilled' ? copy(`${order.postage} 邮资已存入本机余额。`, `${order.postage} postage was added to your on-device balance.`)
                : copy('可以返回选购并重新下单。', 'Return to purchase preview to start a new order.')}</p>
            </div>
          </section>
          <dl className="checkout-receipt">
            <div><dt>{copy('商品', 'Item')}</dt><dd>{orderedPostage(order.postage)}</dd></div>
            <div><dt>{copy('发行渠道', 'Distribution channel')}</dt><dd>{channels[order.channel][language]}</dd></div>
            <div><dt>{copy('付款方式', 'Payment method')}</dt><dd>{methods[order.method].name[language]}</dd></div>
            <div><dt>{copy('演示金额', 'Demo total')}</dt><dd>{amount(order.amount, order.currency)}</dd></div>
            <div><dt>{copy('订单编号', 'Order number')}</dt><dd className="checkout-reference">{order.id}</dd></div>
          </dl>
        </>
        : <p className="checkout-empty">{copy('这笔订单暂时无法查看。', 'This order is unavailable.')}</p>)}
      {error && <p className="checkout-error" role="alert">{error}</p>}
    </div>

    {view.kind === 'purchase' && <footer className="checkout-footer">
      <button className="checkout-primary btn-dark" disabled={busy} onClick={() => {
        if (openOrder) { showOrder(openOrder); return }
        void run(() => createPreviewOrder(owner, channel, method), showOrder)
      }}>{busy ? copy('正在创建…', 'Creating…') : openOrder ? copy('查看原订单', 'Open existing order') : copy('创建演示订单', 'Create demo order')}</button>
    </footer>}

    {view.kind === 'detail' && order && <footer className="checkout-footer">
      {order.status === 'unpaid' && <>
        <button className="checkout-primary btn-dark" disabled={busy} onClick={() => update(order.id, 'submit')}>{copy('模拟付款', 'Simulate payment')}</button>
        <div className="checkout-secondary-actions">
          <button disabled={busy} onClick={() => update(order.id, 'cancel')}>{copy('取消订单', 'Cancel order')}</button>
          <button disabled={busy} onClick={() => update(order.id, 'fail')}>{copy('模拟付款失败', 'Simulate payment failure')}</button>
        </div>
      </>}
      {(order.status === 'confirming' || order.status === 'paid') && <button className="checkout-primary btn-dark" disabled={busy}
        onClick={() => update(order.id, 'refresh')}>
        {busy ? copy('正在查询…', 'Checking…') : order.status === 'confirming' ? copy('查询支付结果', 'Check payment') : copy('查询到账结果', 'Check postage')}
      </button>}
      {order.status === 'fulfilled' && <button className="checkout-primary btn-dark" disabled={busy} onClick={onClose}>{copy('完成', 'Done')}</button>}
      {(order.status === 'failed' || order.status === 'cancelled') && <button className="checkout-primary btn-dark" disabled={busy} onClick={() => chooseView({ kind: 'purchase' })}>{copy('返回选购', 'Back to purchase preview')}</button>}
    </footer>}
  </ContextSheet>
}
