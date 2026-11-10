import { lazy, Suspense, useContext, useEffect, useRef, useState } from 'react'
import { BackpackIcon, GiftIcon as PresentIcon, TicketIcon } from '@phosphor-icons/react'
import { isZh, useI18n } from '../i18n'
import type { Person } from '../model'
import { Lens } from '../fx'
import { I, NightCtx, useStatusTone } from '../ui'
import { giftCatalog } from './catalog'
import { GiftIcon } from './GiftIcon'
import { GoalLedgerRow, useArrivalClock, useGiftState } from './GiftLedger'
import { GiftPreview } from './GiftPreview'
import { hasArrived, receiptMatchesPerson, targetMatchesPerson } from './store'
import type { GiftOpenOptions, GiftReceipt } from './types'
import './gift-ledger.css'
import './integration.css'

const GoalView = lazy(() => import('./GiftGoals').then(module => ({ default: module.GiftGoalView })))
type HubProps = {
  owner: string
  people: Person[]
  onClose: () => void
  onGift: (personId: number, options?: GiftOpenOptions) => void
  onSeek: (options?: GiftOpenOptions) => void
  onInvite: () => void
}

export function GiftHub({ owner, people, onClose, onGift, onSeek, onInvite }: HubProps) {
  const { t, lang } = useI18n()
  const zh = isZh(lang)
  const state = useGiftState(owner)
  const now = useArrivalClock(state.receipts)
  const [tab, setTab] = useState<'bag' | 'receipts' | 'goals'>('bag')
  const [picking, setPicking] = useState<GiftOpenOptions | null>(null)
  const [archive, setArchive] = useState<GiftReceipt | null>(null)
  const [goal, setGoal] = useState('')
  const backButton = useRef<HTMLButtonElement>(null)
  useStatusTone(useContext(NightCtx) ? 'light' : 'dark')
  useEffect(() => { backButton.current?.focus({ preventScroll: true }) }, [])
  const coupons = state.entitlements['return-stamp'] ?? 0
  const receipts = state.receipts.slice().reverse()
  const links = (state.goals ?? []).slice().reverse()
  const inventory = giftCatalog.filter(gift => gift.effect !== 'fuel' && state.inventory[gift.id] > 0)
  function start(options: GiftOpenOptions) {
    if (people.length === 1) { onGift(people[0].id, options); return }
    setPicking(options)
  }
  function back() {
    if (goal) setGoal('')
    else if (archive) setArchive(null)
    else if (picking) setPicking(null)
    else onClose()
  }
  function openReceipt(receipt: GiftReceipt) {
    const person = people.find(candidate => receiptMatchesPerson(receipt, candidate))
    if (person) onGift(person.id, { tab: 'receipts', receiptId: receipt.id })
    else setArchive(receipt)
  }
  const title = picking ? (zh ? '选择收件人' : 'Choose a recipient') : archive ? (zh ? '寄件回执' : 'Parcel receipt') : (zh ? '礼物与奖励' : 'Gifts & rewards')
  return <section className="gift-ledger-page" aria-label={title} role="dialog" aria-modal="true" onKeyDown={e => {
    if (e.key === 'Escape' && !e.nativeEvent.isComposing && !goal) { e.stopPropagation(); back() }
  }}>
    <header className="gift-ledger-head"><button ref={backButton} onClick={back} aria-label={t('common.back')}><I.Back/></button><h1>{title}</h1></header>
    {picking ? <div className="gift-ledger-scroll scroll-quiet">
      {people.length ? people.map(person => <button key={person.id} className="gift-ledger-row" onClick={() => onGift(person.id, picking)}>
        <Lens size={42} world={person.world} avatar={person.avatar} name={person.name}/><span><b>{person.name}</b><small>{t('world.' + person.world)}</small></span><I.Chevron/>
      </button>) : <div className="gift-ledger-empty"><PresentIcon/><h2>{zh ? '先找到想送的人' : 'Find someone to send a gift to'}</h2><p>{picking.source === 'reward' ? (zh ? '赠礼券已收好，找到 TA 之后可以接着用。' : 'Your coupon is saved. Use it once you have found them.') : (zh ? '找到 TA 后，就能接着准备这份礼物。' : 'You can finish preparing this gift after finding them.')}</p><button className="btn-dark" onClick={() => onSeek(picking)}>{t('home.menu.seek')}</button></div>}
    </div> : archive ? <div className="gift-ledger-scroll gift-archive scroll-quiet">
      <div className="gift-shelf-stage">{archive.deliveryPhoto ? <img src={archive.deliveryPhoto} alt=""/> : <GiftPreview giftId={archive.lines[0].giftId} quantity={archive.lines[0].quantity} world={archive.target.world} arrived={hasArrived(archive, now)}/>}</div>
      <h2>{zh ? archive.lines[0].snapshot.name : archive.lines[0].snapshot.en} ×{archive.lines[0].quantity}</h2>
      <p>{archive.target.name} · {t('world.' + archive.target.world)} · {new Date(archive.createdAt).toLocaleDateString(lang)}</p>
      <p>{hasArrived(archive, now) ? (zh ? '已抵达' : 'Delivered') : (zh ? '投递中' : 'In transit')}</p>
      {archive.note && <blockquote>{archive.note}</blockquote>}
    </div> : <>
      <nav className="gift-ledger-tabs" aria-label={zh ? '礼物分类' : 'Gift sections'}>
        {([['bag', '背包', 'My bag'], ['receipts', '寄件回执', 'Receipts'], ['goals', '共同心愿', 'Shared wishes']] as const).map(([id, cn, en]) => <button key={id} aria-current={id === tab ? 'page' : undefined} onClick={() => setTab(id)}>{zh ? cn : en}</button>)}
      </nav>
      <div className="gift-ledger-scroll scroll-quiet" key={tab}>
        {tab === 'bag' && <>
          <section className="gift-wallet-coupon"><TicketIcon weight="thin"/><div><h2>{zh ? '基础赠礼券' : 'Gift coupons'}</h2><strong>{coupons}<small>{zh ? ' 张' : ' available'}</small></strong><p>{zh ? '每张可寄一件不超过 8 邮资的基础礼物。' : 'Each coupon sends one basic gift worth up to 8 postage.'}</p></div>
            {coupons > 0 && <button onClick={() => start({ source: 'reward', tab: 'catalog' })}>{zh ? '用券寄礼物' : 'Use a coupon'} ›</button>}
          </section>
          <button className="gift-ledger-row" onClick={onInvite}><span className="gift-ledger-glyph"><I.PaperBird/></span><span><b>{zh ? '邀请朋友' : 'Invite a friend'}</b><small>{zh ? '查看邀请和奖励进度' : 'View invitations and reward progress'}</small></span><I.Chevron/></button>
          <div className="gift-ledger-subhead"><h2>{zh ? '我的背包' : 'My collection'}</h2><span>{zh ? '试用邮资' : 'Trial postage'} {state.credits}</span></div>
          {inventory.map(gift => <button key={gift.id} className="gift-ledger-row" onClick={() => start({ giftId: gift.id, source: 'inventory', tab: 'catalog' })}>
            <span className="gift-ledger-glyph"><GiftIcon id={gift.id}/></span><span><b>{zh ? gift.name : gift.en}</b></span><em>×{state.inventory[gift.id]}</em><I.Chevron/>
          </button>)}
          {inventory.length === 0 && <p className="gift-ledger-muted">{zh ? '背包暂时是空的。' : 'Your bag is empty.'}</p>}
          <button className="gift-ledger-primary btn-dark" onClick={() => start({ tab: 'catalog' })}><PresentIcon/>{zh ? '挑一份礼物' : 'Choose a gift'}</button>
        </>}
        {tab === 'receipts' && (receipts.length ? receipts.map(receipt => {
          const first = receipt.lines[0]
          return <button className="gift-ledger-row" key={receipt.id} onClick={() => openReceipt(receipt)}>
            <span className="gift-ledger-glyph">{receipt.deliveryPhoto ? <img src={receipt.deliveryPhoto} alt=""/> : <GiftIcon id={first.giftId}/>}</span><span><b>{zh ? first.snapshot.name : first.snapshot.en} · {receipt.target.name}</b><small>{new Date(receipt.createdAt).toLocaleDateString(lang)} · {hasArrived(receipt, now) ? (zh ? '已抵达' : 'Arrived') : (zh ? '投递中' : 'In transit')}</small></span><I.Chevron/>
          </button>
        }) : <div className="gift-ledger-empty"><BackpackIcon/><h2>{zh ? '还没有寄件回执' : 'No parcels yet'}</h2><button className="btn-dark" onClick={() => start({ tab: 'catalog' })}>{zh ? '挑一份礼物' : 'Choose a gift'}</button></div>)}
        {tab === 'goals' && <>
          {links.map(link => <GoalLedgerRow key={link.id} link={link} onOpen={() => {
            const person = people.find(candidate => targetMatchesPerson(link.target, candidate))
            if (person) onGift(person.id, { goalId: link.id, tab: 'goals' })
            else setGoal(link.id)
          }}/>)}
          {!links.length && <p className="gift-ledger-muted">{zh ? '已发起的心愿和朋友们的进度，会保存在这里。' : 'Shared wishes you start and their progress will appear here.'}</p>}
          <button className="gift-ledger-primary btn-dark" onClick={() => start({ tab: 'goals' })}><I.Gather/>{zh ? '发起共同心愿' : 'Start a shared wish'}</button>
        </>}
      </div>
    </>}
    {goal && <Suspense fallback={null}><GoalView id={goal} owner={owner} onClose={() => setGoal('')}/></Suspense>}
  </section>
}
