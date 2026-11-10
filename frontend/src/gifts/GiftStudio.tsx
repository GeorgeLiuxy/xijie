import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  ArrowLeftIcon, ArrowUpRightIcon, BackpackIcon, CheckCircleIcon,
  CircleNotchIcon, GiftIcon as PresentIcon, HouseSimpleIcon,
  ImageIcon, MagnifyingGlassIcon, PackageIcon, PaperPlaneTiltIcon,
  SparkleIcon, TicketIcon,
} from '@phosphor-icons/react'
import { isZh, useI18n } from '../i18n'
import { WORLDS } from '../worlds'
import { NightCtx, chime, haptic, useStatusTone } from '../ui'
import { categoryLabels, getGift, giftCatalog } from './catalog'
import { acceptsPostage, getGiftState, hasArrived, receiptMatchesPerson, sendGift, subscribeGifts, targetMatchesPerson } from './store'
import type { GiftCategory, GiftDefinition, GiftReceipt, GiftSendInput, GiftTarget, GoalKind } from './types'
import { GiftIcon } from './GiftIcon'
import { giftPlacementLabel } from './PersonalGiftScene'
import { getGiftDraft, useGiftDraft } from './giftDraft'
import { useNativeBack } from '../mobile/back'
import './gifts.css'
import './gift-messages.css'

type StudioTab = 'catalog' | 'bag' | 'goals' | 'receipts' | 'received'
type Filter = 'all' | 'free' | 'owned'
type Category = 'recommended' | 'all' | GiftCategory

export type GiftStudioProps = {
  owner: string
  target: GiftTarget
  onClose: () => void
  onVisitSpace?: (receipt?: GiftReceipt) => void
  onBackToChat?: () => void
  onInvite?: () => void
  onPurchase?: () => void
  onGoal: (kind: GoalKind) => void
  onOpenGoal?: (id: string) => void
  onWatch: (receipt: GiftReceipt) => void
  onReceived?: (id: string) => void
  initialTab?: StudioTab
  initialGift?: string
  initialSource?: GiftSendInput['source']
  initialReceipt?: string
  onReceipt?: (receipt: GiftReceipt) => void
  compact?: boolean
  inContext?: boolean
  onExpand?: () => void
  onBusyChange?: (busy: boolean) => void
  large?: boolean
}

const makeId = () => crypto.randomUUID()
const categories: GiftCategory[] = ['emotion', 'care', 'pet', 'home', 'collection', 'scenery', 'experience', 'journey']
const browseCatalog = giftCatalog.filter(item => item.effect !== 'fuel')

export function GiftStudio({ owner, target, onClose, onVisitSpace, onBackToChat, onInvite, onPurchase, onGoal, onOpenGoal, onWatch, onReceived, initialTab = 'catalog', initialGift, initialSource, initialReceipt, onReceipt, compact = false, inContext = false, onExpand, onBusyChange, large = false }: GiftStudioProps) {
  const { lang, t } = useI18n()
  const zh = isZh(lang)
  const text = (cn: string, en: string) => zh ? cn : en
  useStatusTone(useContext(NightCtx) ? 'light' : 'dark')
  const subscribe = useCallback((listener: () => void) => subscribeGifts(owner, listener), [owner])
  const snapshot = useCallback(() => getGiftState(owner), [owner])
  const state = useSyncExternalStore(subscribe, snapshot, snapshot)
  const [draft, updateDraft, clearDraft] = useGiftDraft(owner, target)
  const { giftId: selectedId, quantity, note, source: preferred } = draft
  const [tab, setTab] = useState<StudioTab>(initialTab)
  const [category, setCategory] = useState<Category>(() => getGift((!initialReceipt && initialGift) || selectedId || '')?.category ?? 'recommended')
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [compactStep, setCompactStep] = useState<'choose' | 'confirm'>(() => initialGift || selectedId ? 'confirm' : 'choose')
  const [compactSource, setCompactSource] = useState<'for-them' | 'bag'>(() => (initialSource ?? preferred) === 'inventory' ? 'bag' : 'for-them')
  const [error, setError] = useState('')
  const [confirmedId, setConfirmedId] = useState<string | null>(initialReceipt ?? null)
  const [now, setNow] = useState(Date.now)
  const root = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const wasCompact = useRef(compact)
  const lock = useRef(false)

  useLayoutEffect(() => {
    if (initialReceipt) return
    if (initialGift && getGift(initialGift)) {
      updateDraft({ giftId: initialGift, quantity: 1, source: initialSource ?? null })
    } else if (initialSource) updateDraft({ source: initialSource })
  }, [initialGift, initialSource, initialReceipt, updateDraft])

  const items = useMemo(() => {
    const directGift = getGift((!initialReceipt && initialGift) || selectedId || '')
    // Legacy flight links can still open their explicit supply; normal browsing hides fuel.
    let result = directGift?.effect === 'fuel' ? [...browseCatalog, directGift] : browseCatalog
    // Compact browsing only limits the display below. Its selected draft still resolves
    // against the entire catalogue, including an explicitly restored legacy item.
    if (compact) return result
    const needle = query.trim().toLocaleLowerCase()
    if (needle) {
      result = result.filter(item => [item.name, item.en, item.outcome, item.outcomeEn].join(' ').toLocaleLowerCase().includes(needle))
    } else if (category === 'recommended') {
      const specific = result.filter(item => item.audience.includes(target.audience))
        .sort((a, b) => Number(b.available) - Number(a.available) || a.audience.length - b.audience.length)
      result = [...specific, ...result.filter(item => !specific.includes(item))].slice(0, 12)
    } else if (category !== 'all') {
      result = result.filter(item => item.category === category)
    }
    if (filter === 'free') result = result.filter(item => item.available && item.cost === 0)
    if (filter === 'owned') result = result.filter(item => (state.inventory[item.id] ?? 0) > 0)
    return result
  }, [query, category, filter, target.audience, state.inventory, initialGift, initialReceipt, selectedId, compact])
  // The submit action and its summary always refer to a visible, explicit choice.
  const gift = items.find(item => item.id === selectedId)
  const compactConfirm = compact && compactStep === 'confirm' && !!gift
  const displayItems = useMemo(() => {
    if (!compact) return items
    const suitable = items.filter(item => item.available && item.effect !== 'fuel' && item.effect !== 'build'
      && item.audience.includes(target.audience) && (compactSource !== 'bag' || (state.inventory[item.id] ?? 0) > 0))
      .sort((a, b) => a.audience.length - b.audience.length)
    const visible = suitable.slice(0, 6)
    // A saved choice remains discoverable even when it is outside the first six.
    if (gift && (compactSource !== 'bag' || (state.inventory[gift.id] ?? 0) > 0) && !visible.some(item => item.id === gift.id)) {
      if (visible.length === 6) visible.pop()
      visible.push(gift)
    }
    return visible
  }, [compact, items, compactSource, state.inventory, target.audience, gift])
  useEffect(() => {
    if (selectedId && !gift && !busy && getGiftDraft(owner, target).giftId === selectedId) updateDraft({ giftId: null, quantity: 1 })
  }, [selectedId, gift, busy, owner, target, updateDraft])
  const nameOf = (item: GiftDefinition) => zh ? item.name : item.en
  const outcomeOf = (item: GiftDefinition) => {
    if (!item.available || item.effect === 'build' || item.effect === 'fuel') return zh ? item.outcome : item.outcomeEn
    const place = giftPlacementLabel(target.world, item.id, zh)
    return place
      ? text(`抵达后，会放在${place}，在 TA 的空间留下这份心意。`, `On arrival, it will be placed ${place.toLowerCase()} in their space.`)
      : text('抵达后收进礼物记录，保存这份心意与附言。', 'Saved in your gift records on arrival, together with your note.')
  }
  const worldName = t(`world.${target.world}`)
  const stock = gift ? state.inventory[gift.id] ?? 0 : 0
  const returnPostage = state.entitlements['return-stamp'] ?? 0
  const canUseReturn = !!gift && acceptsPostage(gift) && quantity === 1 && returnPostage > 0
  const source: GiftSendInput['source'] = gift?.cost === 0 && preferred !== 'inventory' ? 'trial'
    : preferred === 'reward' && canUseReturn ? 'reward'
    : preferred === 'trial' ? 'trial'
    : preferred === 'inventory' && stock > 0 ? 'inventory'
    : !preferred && canUseReturn ? 'reward'
    : stock > 0 ? 'inventory' : 'trial'
  const goalGift = gift?.effect === 'fuel' || gift?.effect === 'build'
  const cost = source === 'trial' ? (gift?.cost ?? 0) * quantity : 0
  const affordable = source === 'inventory' ? stock >= quantity : source === 'reward' ? returnPostage > 0 && canUseReturn : state.credits >= cost
  const openInvite = () => {
    if (busy || lock.current || !onInvite) return
    // Preserve the shown payment choice and retry identity while visiting the invitation.
    if (gift && preferred !== source) updateDraft({ source, request: draft.request })
    onInvite()
  }
  const recipient = { id: target.id, localId: target.identity }
  const receipts = state.receipts.filter(receipt => receiptMatchesPerson(receipt, recipient))
  const received = (state.received ?? []).filter(item => targetMatchesPerson(item.from, recipient)).slice().reverse()
  const ownGoals = (state.goals ?? []).filter(link => targetMatchesPerson(link.target, recipient))
  const confirmed = confirmedId ? receipts.find(receipt => receipt.id === confirmedId) : undefined
  const pending = state.receipts.some(receipt => !hasArrived(receipt, now))

  useLayoutEffect(() => {
    if (compact && !wasCompact.current) {
      setConfirmedId(null)
      setTab('catalog')
      setCompactStep(gift ? 'confirm' : 'choose')
    }
    wasCompact.current = compact
  }, [compact, gift])

  useEffect(() => { onBusyChange?.(busy) }, [busy, onBusyChange])
  useNativeBack(() => {
    if (busy || lock.current) return true
    setCompactStep('choose')
    return true
  }, compactConfirm || compact && busy, 35, root)

  const closeCurrent = () => {
    if (busy || lock.current) return
    if (compactConfirm) setCompactStep('choose')
    else onClose()
  }

  useEffect(() => {
    if (inContext) return
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    root.current?.querySelector<HTMLButtonElement>('.gs-back')?.focus({ preventScroll: true })
    return () => previousFocus.current?.focus({ preventScroll: true })
  }, [inContext])
  useLayoutEffect(() => {
    if (!compact) return
    const focus = compactConfirm
      ? root.current?.querySelector<HTMLButtonElement>('.gs-back')
      : root.current?.querySelector<HTMLButtonElement>('.gs-item[aria-pressed="true"]') ?? root.current?.querySelector<HTMLButtonElement>('.gs-back')
    focus?.focus({ preventScroll: true })
  }, [compact, compactConfirm])
  useEffect(() => {
    if (!pending) return
    const id = window.setInterval(() => { if (!document.hidden) setNow(Date.now()) }, 800)
    const refresh = () => setNow(Date.now())
    document.addEventListener('visibilitychange', refresh)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', refresh) }
  }, [pending])

  function choose(item: GiftDefinition, fromBag = false) {
    if (lock.current) return
    updateDraft({ giftId: item.id, quantity: 1, ...(fromBag ? { source: 'inventory' as const } : {}) })
    setError('')
    if (compact) setCompactStep('confirm')
    if (fromBag) {
      setConfirmedId(null)
      setTab('catalog')
      setCategory(item.category)
      setFilter('all')
      setQuery('')
    }
    haptic(6)
  }

  async function submit() {
    if (lock.current || !gift?.available) return
    if (goalGift) { onGoal(gift.effect === 'fuel' ? 'flight' : 'home'); return }
    const input = { target, giftId: gift.id, quantity, note: note.trim(), source }
    const fingerprint = JSON.stringify(input)
    const request = draft.request?.fingerprint === fingerprint ? draft.request : { fingerprint, id: makeId() }
    updateDraft({ request })
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const receipt = await sendGift(owner, { ...input, requestId: request.id })
      setConfirmedId(receipt.id)
      setNow(Date.now())
      haptic([9, 35, 15])
      chime('connect')
      clearDraft(request.id)
      onReceipt?.(receipt)
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : ''
      const messages: Record<string, [string, string]> = {
        'insufficient-credits': ['试用邮资不足，已保留这次选择。', 'Not enough trial postage. Your choices are saved.'],
        'insufficient-inventory': ['背包数量不够，请减少数量或换用试用邮资。', 'Not enough in your bag. Reduce the quantity or use trial postage.'],
        'unavailable-gift': ['这份礼物暂未开放，可以先挑另一件。', 'This gift is not available yet. Choose another for now.'],
        'invalid-reward': ['基础赠礼券暂不可用，请换用背包或试用邮资。', 'Return postage is not available. Choose your bag or trial postage.'],
        'storage-unavailable': ['这次未能保存，请重试。原有邮资和背包会保留。', 'Could not save. Retry with your existing postage and bag.'],
        'storage-invalid': ['当前本机赠礼记录无法读取，暂时不能寄出。', 'Your local gift records could not be read. Sending is paused.'],
      }
      setError(messages[code]?.[zh ? 0 : 1] ?? text('未能确认这次寄件，请重试。重复点击只记一次。', 'Could not confirm this parcel. Retry safely.'))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  function openTab(next: StudioTab) {
    setTab(next)
    setConfirmedId(null)
    setError('')
    haptic(5)
  }

  function expand(next: StudioTab) {
    if (busy || lock.current) return
    // Keep the selected item in view when returning to the full catalogue.
    if (gift) { setCategory(gift.category); setQuery(''); setFilter('all') }
    openTab(next)
    onExpand?.()
  }

  function changeCategory(next: Category) {
    setCategory(next)
    setQuery('')
  }

  function discard() {
    if (lock.current) return
    clearDraft()
    onClose()
  }

  function effectLabel(item: GiftDefinition) {
    if (item.available && item.effect !== 'build' && item.effect !== 'fuel') {
      return giftPlacementLabel(target.world, item.id, zh)
        ? text('留在 TA 的空间', 'Stays in their space')
        : text('收进礼物记录', 'Saved in gift records')
    }
    const labels = {
      keepsake: ['留一段记忆', 'A keepsake'], prop: ['留在空间', 'Stays in the space'],
      scene: ['改变一处风景', 'A change of scenery'], build: ['共同建设', 'Build together'],
      service: ['创作服务', 'Creative service'], fuel: ['航班补给', 'Flight supplies'],
    }
    return labels[item.effect][zh ? 0 : 1]
  }

  function priceLabel(item: GiftDefinition) {
    if (!item.available) return text('筹备中', 'Coming later')
    if (item.effect === 'fuel' || item.effect === 'build') return text('一起完成', 'Create together')
    return item.cost === 0 ? text('免费心意', 'A free thought') : text(`${item.cost} 邮资`, `${item.cost} postage`)
  }

  function receiptRow(receipt: GiftReceipt) {
    const arrived = hasArrived(receipt, now)
    return <button className="gs-receipt-row" key={receipt.id} onClick={() => setConfirmedId(receipt.id)}>
      <span className={'gs-mini-art gs-tint-' + receipt.lines[0].snapshot.category}><GiftIcon id={receipt.lines[0].giftId} /></span>
      <span><b>{nameOf(receipt.lines[0].snapshot)}{receipt.lines[0].quantity > 1 ? ` ×${receipt.lines[0].quantity}` : ''}</b><small>{new Date(receipt.createdAt).toLocaleDateString(zh ? 'zh-CN' : 'en')} · {receipt.note || t(`world.${receipt.target.world}`)}</small></span>
      <em className={arrived ? 'arrived' : ''}>{arrived ? text('已抵达', 'Arrived') : text('运送中', 'In transit')}<ArrowUpRightIcon /></em>
    </button>
  }

  let content
  if (confirmed) {
    const arrived = hasArrived(confirmed, now)
    const first = confirmed.lines[0]
    const placement = giftPlacementLabel(confirmed.target.world, first.giftId, zh)
    const receiptPlace = placement ?? text('个人礼物记录', 'Personal gift records')
    const visitLabel = arrived ? text('去 TA 的空间看看', 'Visit their space') : text('查看 TA 的空间', 'View their space')
    content = <section className="gs-confirmation" aria-label={text('寄件回执', 'Parcel receipt')}>
      <div className="gs-confirm-details scroll-quiet">
      <div className="gs-confirm-art" style={{ backgroundImage: `linear-gradient(0deg,#132827b0,#13282726),url(${WORLDS[confirmed.target.world].img})` }}>
        {confirmed.deliveryPhoto
          ? <img className="gs-delivery-photo" src={confirmed.deliveryPhoto} alt={text('抵达时的投递留影', 'Photo of the arrival')} />
          : <div className={'gs-delivery-seal gs-tint-' + first.snapshot.category} aria-hidden="true">{arrived ? <GiftIcon id={first.giftId} /> : <PackageIcon className="gift-icon" weight="duotone" />}</div>}
        <span className="gs-confirm-place">{t(`world.${confirmed.target.world}`)}<small>{receiptPlace}</small></span>
        <b><CheckCircleIcon />{arrived ? text('已抵达', 'Delivered') : text('投递中', 'In transit')}</b>
      </div>
      <div className="gs-confirm-text">
        <div className="gs-eyebrow">ELY / {confirmed.id.slice(0, 6).toUpperCase()}</div>
        <h2>{arrived ? text('这份心意，已经留下', 'Your gift is here') : text('已为这份心意封件', 'Your gift is sealed')}</h2>
        <p>{nameOf(first.snapshot)} ×{first.quantity} · {confirmed.target.name}</p>
        <p className="gs-muted">{placement
          ? (arrived ? text(`已放在${placement}。`, `Placed ${placement.toLowerCase()}.`) : text(`抵达后，会放在${placement}。`, `On arrival, it will be placed ${placement.toLowerCase()}.`))
          : (arrived ? text('已收进礼物记录，随时可以回来重温。', 'Saved in your gift records, ready to revisit.') : text('抵达后，会收进礼物记录。', 'It will be saved in your gift records on arrival.'))}</p>
        {confirmed.note && <blockquote>{confirmed.note}</blockquote>}
        <div className="gs-delivery-steps"><span className="done">{text('已收件', 'Accepted')}</span><i /><span className="done">{text('运送中', 'In transit')}</span><i /><span className={arrived ? 'done' : ''}>{text('已抵达', 'Delivered')}</span></div>
        <p className="gs-small">{text('本机虚拟试送。寄件已保存，稍后可以回来查看。', 'Local virtual delivery. Your parcel is saved for your next visit.')}</p>
      </div>
      </div>
      <div className="gs-confirm-controls">
        <button className="gs-primary" onClick={onBackToChat ?? (() => onVisitSpace ? onVisitSpace(confirmed) : onClose())}>{onBackToChat ? text('回到聊天', 'Back to chat') : onVisitSpace ? visitLabel : text('返回', 'Back')}</button>
        <div className="gs-confirm-actions">
          {onBackToChat && onVisitSpace && <button onClick={() => onVisitSpace(confirmed)}>{text('去 TA 的空间看看', 'Visit their space')}</button>}
          <button onClick={() => { setConfirmedId(null); setTab('catalog') }}>{text('继续挑选', 'Choose another')}</button>
          <button onClick={() => onWatch(confirmed)}><PaperPlaneTiltIcon />{text('观看这次旅途', 'Watch the journey')}</button>
        </div>
        <small className="gs-bill">{confirmed.source === 'inventory' ? text('使用背包', 'From your bag') : confirmed.source === 'reward' ? text('使用基础赠礼券 ×1', '1 gift voucher used') : confirmed.cost === 0 ? text('免费心意', 'Free gift') : text(`使用 ${confirmed.cost} 试用邮资`, `${confirmed.cost} trial postage used`)} · {text('无真实扣费', 'No real charge')}</small>
      </div>
    </section>
  } else if (tab === 'catalog' || compact) {
    content = <>
      {compact && !compactConfirm && <div className="gs-compact-tools">
        <div className="gs-compact-sources" role="group" aria-label={text('挑选来源', 'Browse gifts')}>
          <button disabled={busy} aria-pressed={compactSource === 'for-them'} onClick={() => setCompactSource('for-them')}>{text('为 TA', 'For them')}</button>
          <button disabled={busy} aria-pressed={compactSource === 'bag'} onClick={() => setCompactSource('bag')}><BackpackIcon aria-hidden />{text('背包', 'My bag')}</button>
        </div>
        <button className="gs-compact-more" disabled={busy} onClick={() => expand('catalog')}>{text('全部礼物', 'All gifts')}<ArrowUpRightIcon aria-hidden /></button>
      </div>}
      {!compact && <div className="gs-catalog-tools">
        <div className="gs-search"><MagnifyingGlassIcon /><input value={query} disabled={busy} onChange={event => setQuery(event.target.value)} placeholder={text('找一件能表达心意的礼物', 'Find a gift that says something')} aria-label={text('搜索礼物', 'Search gifts')} /></div>
        <div className="gs-category-scroll" role="group" aria-label={text('礼物分类', 'Gift categories')}>
          <button disabled={busy} aria-pressed={category === 'recommended'} onClick={() => changeCategory('recommended')}>{text('为 TA 挑选', 'For them')}</button>
          <button disabled={busy} aria-pressed={category === 'all'} onClick={() => changeCategory('all')}>{text('全部', 'All')}<small>{browseCatalog.length}</small></button>
          {categories.map(key => <button disabled={busy} key={key} aria-pressed={category === key} onClick={() => changeCategory(key)}>{categoryLabels[key][zh ? 0 : 1]}</button>)}
        </div>
        <div className="gs-filter-row"><span>{text(`${items.length} 件礼物`, `${items.length} gifts`)}</span><select value={filter} disabled={busy} onChange={event => setFilter(event.target.value as Filter)} aria-label={text('获得方式', 'How to get it')}><option value="all">{text('全部方式', 'All sources')}</option><option value="free">{text('免费心意', 'Free thoughts')}</option><option value="owned">{text('背包已有', 'In my bag')}</option></select></div>
      </div>}
      {(!compact || !compactConfirm) && <div className="gs-grid-scroll scroll-quiet">
        <div className="gs-grid">
          {displayItems.map(item => <button className={'gs-item gs-tint-' + item.category + (item.available ? '' : ' unavailable')} key={item.id} disabled={busy} aria-pressed={item.id === gift?.id} aria-label={nameOf(item)} onClick={() => choose(item, compact && compactSource === 'bag')}>
            <span className="gs-item-art"><GiftIcon id={item.id} /></span>
            <b>{nameOf(item)}</b><small>{compact && compactSource === 'bag' ? text(`已有 ${state.inventory[item.id] ?? 0} 件`, `${state.inventory[item.id] ?? 0} in your bag`) : priceLabel(item)}</small>
            {(state.inventory[item.id] ?? 0) > 0 && <em>{text('有', 'Bag')} {state.inventory[item.id]}</em>}
          </button>)}
        </div>
        {displayItems.length === 0 && <div className="gs-empty"><MagnifyingGlassIcon /><h3>{compact && compactSource === 'bag' ? text('背包里暂时没有可寄的礼物', 'No ready-to-send gifts in your bag') : text('还没找到这份心意', 'No gift found yet')}</h3>{!compact && <p>{text('换一个词，或看看其他分类。', 'Try another word or category.')}</p>}<button onClick={() => { if (compact) setCompactSource('for-them'); else { setQuery(''); setCategory('all'); setFilter('all') } }}>{compact ? text('看看为 TA 挑选的', 'See gifts for them') : text('查看全部礼物', 'See all gifts')}</button></div>}
      </div>}
      {(!compact || compactConfirm) && <section className="gs-selection" aria-label={text('选中的礼物', 'Selected gift')}>
        {gift ? <>
        <div className="gs-selected-head"><span className={'gs-selected-art gs-tint-' + gift.category}><GiftIcon id={gift.id} /></span><div className="min-w-0 flex-1"><h3>{nameOf(gift)}</h3><small>{effectLabel(gift)}</small></div><button className="min-h-11 shrink-0 px-1 text-[13px] text-ink-soft" disabled={busy} onClick={discard}>{text('取消赠礼', 'Cancel gift')}</button></div>
        <p className="gs-outcome">{outcomeOf(gift)}</p>
        {gift.available && !goalGift && <>
          <label className="gs-note-field"><span>{text('捎句话', 'A note')}</span><input value={note} maxLength={120} disabled={busy} onChange={event => updateDraft({ note: event.target.value })} placeholder={text('想说的话，可以留空', 'Add a few words, if you like')} /></label>
          {gift.cost > 0 && (stock > 0 || canUseReturn) && <div className="gs-sources" role="group" aria-label={text('使用方式', 'Postage source')}>
            {stock > 0 && <button disabled={busy} aria-pressed={source === 'inventory'} onClick={() => { updateDraft({ source: 'inventory' }); setError('') }}><BackpackIcon />{text('背包', 'Bag')} {stock}</button>}
            <button disabled={busy} aria-pressed={source === 'trial'} onClick={() => { updateDraft({ source: 'trial' }); setError('') }}>{text('试用邮资', 'Trial postage')}</button>
            {returnPostage > 0 && canUseReturn && <button disabled={busy} aria-pressed={source === 'reward'} onClick={() => { updateDraft({ source: 'reward' }); setError('') }}><TicketIcon />{text('基础赠礼券', 'Return postage')} {returnPostage}</button>}
          </div>}
        </>}
        <div className="gs-send-row">
          {gift.stackable && gift.available && !goalGift ? <div className="gs-quantities" role="group" aria-label={text('赠送数量', 'Gift quantity')}>{[1, 3, 5].map(q => <button key={q} disabled={busy} aria-pressed={quantity === q} onClick={() => { updateDraft({ quantity: q }); setError('') }}>×{q}</button>)}</div> : <span className="gs-small">{goalGift ? text('用于共同目标', 'For a shared wish') : text('一次选择，一份心意', 'One gift, one thought')}</span>}
          <button className="gs-primary" disabled={busy || !gift.available || !goalGift && !affordable} onClick={submit}>
            {busy ? <><CircleNotchIcon className="gs-spin" />{text('封件中', 'Sealing')}</> : !gift.available ? text('服务筹备中', 'Coming later') : goalGift ? text('发起共同目标', 'Start a shared wish') : source === 'inventory' ? text('用背包寄出', 'Send from bag') : source === 'reward' ? text('用券寄出', 'Use return postage') : text(`寄出 · ${cost} 邮资`, `Send · ${cost} postage`)}
          </button>
        </div>
        <div className="gs-form-status" role="status">{error || (gift.available && !goalGift && !affordable ? source === 'inventory' ? text('背包数量不够，可减少数量或换用试用邮资。', 'Not enough in your bag. Reduce the quantity or change source.') : text('可用试用邮资不足，请减少数量。', 'Not enough trial postage. Reduce the quantity.') : goalGift ? text('免费放入第一份，好友每人可添一份；不扣邮资或背包。', 'Your first contribution is free; friends can add one each. No postage or bag items used.') : '')}</div>
        {onPurchase && gift.available && !goalGift && source === 'trial' && !affordable && !canUseReturn && stock < quantity && <button className="gs-invite-inline" disabled={busy} onClick={onPurchase}>{text('购买邮资（演示）', 'Buy postage (preview)')}<ArrowUpRightIcon aria-hidden /></button>}
        {onInvite && !affordable && acceptsPostage(gift) && quantity === 1 && returnPostage === 0 && <button className="gs-invite-inline" disabled={busy} onClick={openInvite}><TicketIcon aria-hidden />{text('邀友领券', 'Invite for a voucher')}<ArrowUpRightIcon aria-hidden /></button>}
        </> : <div className="flex items-center gap-3"><p className="gs-outcome flex-1" role="status">{note ? text('附言已保留，选一件礼物后可继续。', 'Your note is saved. Choose a gift to continue.') : text('先选一件礼物。', 'Choose a gift to begin.')}</p>{(note || preferred) && <button className="min-h-11 shrink-0 px-1 text-[13px] text-ink-soft" onClick={discard}>{text('取消赠礼', 'Cancel gift')}</button>}</div>}
      </section>}
      {compact && !compactConfirm && <div className="gs-compact-footer"><span>{text('本机虚拟赠礼 · 无真实扣费', 'Local virtual gifts · No real charge')}</span><button disabled={busy} onClick={() => expand('receipts')}>{text('礼物记录', 'Gift records')}<ArrowUpRightIcon aria-hidden /></button></div>}
    </>
  } else if (tab === 'bag') {
    const bagItems = browseCatalog.filter(item => (state.inventory[item.id] ?? 0) > 0)
    content = <section className="gs-content-scroll scroll-quiet">
      <div className="gs-section-heading"><span className="gs-eyebrow">MY COLLECTION</span><h2>{text('我的礼物背包', 'My gift collection')}</h2><p>{text('已有的物件，可以继续捎给牵挂的对象。', 'Send something you already have to someone you care about.')}</p></div>
      {returnPostage > 0 && <div className="gs-postage"><TicketIcon /><div><small>RETURN POSTAGE</small><h3>{text('基础赠礼券', 'Return postage')} ×{returnPostage}</h3><p>{text('可寄一件不超过 8 邮资的基础礼物。', 'Send one basic gift worth up to 8 postage.')}</p><button onClick={() => { setTab('catalog'); updateDraft({ source: 'reward', quantity: 1, giftId: null }); setCategory('care'); setFilter('all'); setQuery('') }}>{text('挑一件寄出', 'Choose a gift')}<ArrowUpRightIcon /></button></div></div>}
      <div className="gs-bag-list">{bagItems.map(item => <button className="gs-bag-item" key={item.id} onClick={() => choose(item, true)}><span className={'gs-mini-art gs-tint-' + item.category}><GiftIcon id={item.id} /></span><span><b>{nameOf(item)}</b><small>{effectLabel(item)}</small></span><em>×{state.inventory[item.id]}</em><ArrowUpRightIcon /></button>)}</div>
      {!bagItems.length && !returnPostage && <div className="gs-empty"><BackpackIcon /><h3>{text('背包还有很多位置', 'Room for more gifts')}</h3><p>{text('先挑一份免费心意，或与朋友一起完成一个目标。', 'Choose a free thought or create something with friends.')}</p><button onClick={() => openTab('catalog')}>{text('去挑礼物', 'Find a gift')}</button></div>}
      <p className="gs-local-note">{text('体验赠礼保存在当前账号的本机空间。', 'Your trial gifts stay in this account’s local space.')}</p>
    </section>
  } else if (tab === 'goals') {
    const goals: { kind: 'home' | 'album'; cn: string; en: string; desc: string; english: string; marker: string }[] = [
      { kind: 'home', cn: '一起搭一处住所', en: 'Build a place together', desc: '你添一扇窗，我留一盏灯，每个部件都保留一份贡献。', english: 'A window from you, a light from me. Each contribution stays.', marker: 'A PLACE TO STAY' },
      { kind: 'album', cn: '一起做一份记忆', en: 'A memory made together', desc: '每人捎一句话，把大家的贡献合成一份共同记忆。', english: 'Everyone adds a few words to a shared keepsake.', marker: 'SHARED MEMORY' },
    ]
    content = <section className="gs-content-scroll scroll-quiet">
      <div className="gs-section-heading"><span className="gs-eyebrow">SOMETHING WE MAKE</span><h2>{text('给心愿，找个同行人', 'Find someone to share a wish')}</h2><p>{text('从一个具体的愿望开始，看看大家能一起留下什么。', 'Start with a wish and see what you can make together.')}</p></div>
      {onOpenGoal && ownGoals.length > 0 && <div className="gs-existing-goals"><h3>{text('继续我们的心愿', 'Continue a shared wish')}</h3>{ownGoals.slice().reverse().map(goal => <button key={goal.id} onClick={() => onOpenGoal(goal.id)}><span className="gs-existing-symbol">{goal.kind === 'flight' ? <PaperPlaneTiltIcon /> : goal.kind === 'home' ? <HouseSimpleIcon /> : <ImageIcon />}</span><span><b>{goal.kind === 'flight' ? text('共同航班', 'Shared departure') : goals.find(item => item.kind === goal.kind)?.[zh ? 'cn' : 'en']}</b><small>{text('发起于', 'Started')} {new Date(goal.createdAt).toLocaleDateString(zh ? 'zh-CN' : 'en')}</small></span><ArrowUpRightIcon /></button>)}</div>}
      {goals.map(goal => <button className={'gs-goal-card gs-goal-' + goal.kind} key={goal.kind} onClick={() => onGoal(goal.kind)}><small>{goal.marker}</small><span className="gs-goal-symbol">{goal.kind === 'home' ? <HouseSimpleIcon /> : <ImageIcon />}</span><h3>{zh ? goal.cn : goal.en}</h3><p>{zh ? goal.desc : goal.english}</p><span className="gs-goal-open">{text('开始一个共同目标', 'Start a shared wish')}<ArrowUpRightIcon /></span></button>)}
      <p className="gs-local-note">{text('发起前预览公开内容。每份贡献计入同一个目标。', 'Preview what you share before starting. Every contribution joins the same goal.')}</p>
    </section>
  } else if (tab === 'received') {
    content = <section className="gs-content-scroll scroll-quiet">
      <div className="gs-section-heading"><h2>{text('收到的礼物', 'Received gifts')}</h2><p>{text(`来自${target.name}的剧情回礼`, `Story gifts from ${target.name}`)}</p></div>
      {received.length ? <div className="gs-receipt-list">{received.map(item => {
        const first = item.lines[0]
        return <button type="button" className="gs-receipt-row" key={item.id} onClick={() => onReceived?.(item.id)} disabled={!onReceived}>
          <span className={'gs-mini-art gs-tint-' + first.snapshot.category}><GiftIcon id={first.giftId}/></span>
          <span><b>{nameOf(first.snapshot)}{first.quantity > 1 && ` ×${first.quantity}`}</b><small>{item.note || new Date(item.createdAt).toLocaleDateString(lang)}</small></span>
          <em>{item.openedAt == null ? text('待拆', 'Unopened') : item.placement === 'space' ? text('已陈列', 'On display') : text('已拆开', 'Opened')}<ArrowUpRightIcon/></em>
        </button>
      })}</div> : <div className="gs-empty"><PresentIcon/><h3>{text('还没有收到来礼', 'No gifts received yet')}</h3><p>{text('收到的剧情回礼会保存在这里。', 'Gifts received in this story will appear here.')}</p></div>}
    </section>
  } else {
    content = <section className="gs-content-scroll scroll-quiet">
      <div className="gs-section-heading"><span className="gs-eyebrow">LETTERS THAT STAY</span><h2>{text('给 TA 留下的心意', 'What you have left for them')}</h2><p>{target.name} · {worldName}</p></div>
      {receipts.length ? <div className="gs-receipt-list">{receipts.slice().reverse().map(receiptRow)}</div> : <div className="gs-empty"><PackageIcon /><h3>{text('还没有这次寄件', 'A first parcel awaits')}</h3><p>{text('一句祝愿、一件小物，都可以从这里留下。', 'Begin with a small object and a few words.')}</p><button onClick={() => openTab('catalog')}>{text('挑第一份心意', 'Choose a first gift')}</button></div>}
    </section>
  }

  const tabs: { id: StudioTab; cn: string; en: string; icon: typeof PresentIcon }[] = [
    { id: 'catalog', cn: '挑礼物', en: 'Gifts', icon: PresentIcon },
    { id: 'bag', cn: '背包', en: 'My bag', icon: BackpackIcon },
    { id: 'goals', cn: '一起完成', en: 'Together', icon: SparkleIcon },
    { id: 'receipts', cn: '已寄出的', en: 'Sent', icon: PackageIcon },
    { id: 'received', cn: '收到的', en: 'Received', icon: PresentIcon },
  ]
  return <div ref={root} className={'gift-studio' + (large ? ' gs-large' : '') + (compact ? ' gs-compact' + (compactConfirm ? ' gs-compact-confirm' : ' gs-compact-choose') : '')} role={inContext ? undefined : 'dialog'} aria-modal={inContext ? undefined : true} aria-label={text(`给${target.name}挑礼物`, `Gifts for ${target.name}`)} onKeyDown={event => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      event.preventDefault(); event.stopPropagation()
      if (busy || lock.current) return
      if (confirmedId) setConfirmedId(null)
      else closeCurrent()
    }
    if (event.key === 'Tab' && !inContext) {
      const controls = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]') ?? [])
        .filter(control => control.getClientRects().length > 0)
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }}>
    <header className="gs-header"><button className="gs-back" disabled={busy} onClick={closeCurrent} aria-label={text('返回', 'Back')}><ArrowLeftIcon /></button><div><h1>{confirmed ? text('寄件回执', 'Parcel receipt') : compactConfirm ? text('确认这份心意', 'Ready to send') : compact ? text('送礼物', 'Send a gift') : text(`给${target.name}挑礼物`, `A gift for ${target.name}`)}</h1>{compact && <p className="gs-compact-recipient">{target.name} · {worldName}</p>}</div>
      {onInvite && !confirmed ? <button className="gs-credit gs-credit-action" disabled={busy} onClick={openInvite} aria-label={text(`试用邮资 ${state.credits}，基础赠礼券 ${returnPostage} 张，邀友领券`, `${state.credits} trial postage, ${returnPostage} gift vouchers. Invite for a voucher`)}>
        <b>{state.credits}</b><small>{text('试用邮资', 'Trial postage')}</small><span className="gs-credit-link"><span>{text(`券 ${returnPostage} · 邀友领券`, `${returnPostage} vouchers · Invite`)}</span><ArrowUpRightIcon aria-hidden /></span>
      </button> : <span className="gs-credit"><b>{state.credits}</b><small>{text('试用邮资', 'Trial postage')}</small></span>}
    </header>
    {!confirmed && !compact && <div className="gs-context"><img src={WORLDS[target.world].thumb} alt="" /><span>{target.name}<small>{worldName}</small></span><em>{text('虚拟寄送 · 无真实扣费', 'Virtual gifts · No real charge')}</em></div>}
    <main className={'gs-main gs-view-' + tab}>{content}</main>
    {!confirmed && !compact && <nav className="gs-bottom-nav" aria-label={text('礼物中心', 'Gift centre')}>{tabs.map(item => <button key={item.id} disabled={busy} aria-current={tab === item.id ? 'page' : undefined} onClick={() => openTab(item.id)}><item.icon weight={tab === item.id ? 'fill' : 'regular'} /><span>{zh ? item.cn : item.en}</span></button>)}</nav>}
  </div>
}
