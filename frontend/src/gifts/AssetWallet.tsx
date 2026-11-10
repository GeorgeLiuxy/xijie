import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { isZh, useI18n } from '../i18n'
import { I, NightCtx, useStatusTone } from '../ui'
import { getGift } from './catalog'
import { GiftIcon } from './GiftIcon'
import { useGiftState } from './GiftLedger'
import './assets.css'

export function AccountPage({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n()
  const night = useContext(NightCtx)
  useStatusTone(night ? 'light' : 'dark')
  const back = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const before = document.activeElement
    back.current?.focus({ preventScroll: true })
    return () => { if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true }) }
  }, [])
  return <section className="asset-page" role="dialog" aria-modal="true" aria-label={title} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose() }
    if (event.key !== 'Tab') return
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    const first = buttons[0], last = buttons[buttons.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }}>
    <header className="asset-header"><button ref={back} onClick={onClose} aria-label={t('common.back')}><I.Back /></button><h1>{title}</h1></header>
    <div className="asset-scroll scroll-quiet">{children}</div>
  </section>
}

export function AssetWallet({ owner, onClose, onPurchase, onOrders }: {
  owner: string
  onClose: () => void
  onPurchase?: () => void
  onOrders?: () => void
}) {
  const { lang } = useI18n()
  const zh = isZh(lang)
  const state = useGiftState(owner)
  const [tab, setTab] = useState<'items' | 'usage'>('items')
  const inventory = Object.entries(state.inventory).filter(([, count]) => count > 0)
  const usage = state.receipts.filter(receipt => receipt.source !== 'trial' || receipt.cost > 0).slice().reverse()
  const inventoryTitle = zh ? '赠礼库存' : 'Sending inventory'
  const usageTitle = zh ? '使用记录' : 'Usage history'

  return <AccountPage title={zh ? '资产与记录' : 'Assets and records'} onClose={onClose}>
    <dl className="asset-balances">
      <div><dt>{zh ? '试用邮资' : 'Trial postage'}</dt><dd>{state.credits}</dd></div>
      <div><dt>{zh ? '基础赠礼券' : 'Gift vouchers'}</dt><dd>{state.entitlements['return-stamp'] ?? 0}<small>{zh ? '张' : ''}</small></dd></div>
    </dl>
    <p className="asset-help">{zh ? '本机虚拟试用。邮资和赠礼券用于寄送虚拟礼物，无需真实付款。' : 'Postage and vouchers are saved on this device for virtual gifts. No real payment is involved.'}</p>
    {(onPurchase || onOrders) && <div className="asset-order-actions">
      {onPurchase && <button type="button" onClick={onPurchase}>{zh ? '购买演示邮资' : 'Buy demo postage'}</button>}
      {onOrders && <button type="button" onClick={onOrders}>{zh ? '订单记录' : 'Order history'}</button>}
    </div>}
    <div className="asset-tabs" role="group" aria-label={zh ? '查看资产' : 'Account views'}>
      <button aria-pressed={tab === 'items'} onClick={() => setTab('items')}>{inventoryTitle}</button>
      <button aria-pressed={tab === 'usage'} onClick={() => setTab('usage')}>{usageTitle}</button>
    </div>
    {tab === 'items' ? <section aria-label={inventoryTitle}>
      {inventory.map(([id, count]) => {
        const gift = getGift(id)
        const name = gift ? (zh ? gift.name : gift.en) : (zh ? '历史物品' : 'Archived item')
        return <div key={id} className="asset-row">
          <span className="asset-glyph"><GiftIcon id={id} /></span>
          <span className="asset-row-copy"><b>{name}</b>{gift?.effect === 'fuel' && <small>{zh ? '航行库存' : 'Voyage supplies'}</small>}</span>
          <span className="asset-quantity">×{count}</span>
        </div>
      })}
      {!inventory.length && <p className="asset-empty">{zh ? '目前没有库存物品。' : 'No items in your inventory.'}</p>}
    </section> : <section aria-label={usageTitle}>
      {usage.map(receipt => {
        const names = receipt.lines.map(line => zh ? line.snapshot.name : line.snapshot.en).join(zh ? '、' : ', ')
        const quantity = receipt.lines.reduce((sum, line) => sum + line.quantity, 0)
        const amount = receipt.source === 'reward' ? (zh ? '赠礼券 −1' : 'Voucher −1')
          : receipt.source === 'inventory' ? (zh ? `库存 −${quantity}` : `Items −${quantity}`) : (zh ? `邮资 −${receipt.cost}` : `Postage −${receipt.cost}`)
        return <div key={receipt.id} className="asset-row">
          <span className="asset-row-copy"><b>{names}</b><small>{receipt.target.name} · {new Date(receipt.createdAt).toLocaleDateString(lang)}</small></span>
          <span className="asset-quantity">{amount}</span>
        </div>
      })}
      {!usage.length && <p className="asset-empty">{zh ? '还没有使用邮资、券或库存的记录。' : 'No postage, vouchers or items have been used yet.'}</p>}
    </section>}
  </AccountPage>
}
