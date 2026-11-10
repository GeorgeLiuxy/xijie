import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowUp, BatteryFull, CaretDown, CaretRight, Check, Gift, MagnifyingGlass, PaperPlaneTilt, WifiHigh, X } from '@phosphor-icons/react'
import { Lens } from '../fx'
import { AV } from '../i18n'
import { WorldScene } from '../worlds'
import { giftCatalog } from '../gifts/catalog'
import { GiftIcon } from '../gifts/GiftIcon'
import { Florals, Lamp } from '../gifts/PersonalGiftScene'
import { acceptsPostage } from '../gifts/store'
import { canPlaceGift } from '../gifts/placement'
import type { GiftDefinition } from '../gifts/types'
import cloth from '../post/assets/cloth.webp'
import './interaction-preview.css'

// A separate, disposable design sample. It never reads or writes the account ledger or chats.
const catalog = giftCatalog.filter(g => g.available && g.audience.includes('person') && !['build', 'fuel'].includes(g.effect))
const suggested = ['postcard', 'cloth', 'flowers'].map(id => catalog.find(g => g.id === id)!)
const incoming = catalog.find(g => g.id === 'flowers')!
type Message = { id: number; kind: 'text'; text: string } | { id: number; kind: 'gift'; gift: GiftDefinition; note: string; funding: string }
type Section = 'chat' | 'space' | 'history' | 'list'
type Tray = 'closed' | 'pick' | 'catalog'

function GiftObject({ gift }: { gift: GiftDefinition }) {
  if (gift.id === 'postcard') return <span className="ip-art ip-art-card" aria-hidden="true"><span className="ip-card-stamp">西</span><span className="ip-card-script">见字如面</span><i/><i/><i/></span>
  if (gift.id === 'cloth') return <span className="ip-art ip-art-cloth"><img src={cloth} alt="" draggable={false}/></span>
  if (gift.render === 'flower' || gift.render === 'plant') return <span className="ip-art ip-art-flower"><Florals green={gift.render === 'plant'} crowded={false}/></span>
  if (gift.render === 'lamp') return <span className="ip-art ip-art-lamp"><Lamp path={false} beacon={false} onWall={false}/></span>
  return <span className="ip-art ip-art-glyph"><GiftIcon id={gift.id}/></span>
}

export default function InteractionPreview() {
  const [generation, setGeneration] = useState(0)
  return <Preview key={generation} onReset={() => setGeneration(n => n + 1)}/>
}

function Preview({ onReset }: { onReset: () => void }) {
  const [section, setSection] = useState<Section>('chat')
  const [spaceOwner, setSpaceOwner] = useState<'her' | 'me'>('her')
  const [tray, setTray] = useState<Tray>('closed')
  const [selection, setSelection] = useState<GiftDefinition | null>(null)
  const [note, setNote] = useState('')
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [conversationQuery, setConversationQuery] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [opened, setOpened] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [placed, setPlaced] = useState(false)
  const [credits, setCredits] = useState(120)
  const [stock, setStock] = useState(1)
  const [coupon, setCoupon] = useState(1)
  const [funding, setFunding] = useState<'postage' | 'coupon'>('postage')
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [historyFilter, setHistoryFilter] = useState<'all' | 'sent' | 'received'>('all')
  const [highlight, setHighlight] = useState<number | 'incoming' | null>(null)
  const [sentDetails, setSentDetails] = useState<number | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const incomingRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLElement>(null)
  const giftToggle = useRef<HTMLButtonElement>(null)
  const sendLock = useRef(false)
  const following = useRef(true)
  const savedScroll = useRef(0)
  const previousExpanded = useRef(false)
  const composerHeight = useRef<number | null>(null)
  const phone = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const nextId = useRef(1)
  const matching = catalog.filter(g => g.name.includes(query.trim()) || g.en.toLowerCase().includes(query.toLowerCase().trim()))
  const usesStock = selection?.id === 'cloth' && stock > 0
  const couponEligible = !!selection && acceptsPostage(selection) && !usesStock && coupon > 0
  const usesCoupon = couponEligible && funding === 'coupon'
  const price = usesStock || usesCoupon ? 0 : selection?.cost ?? 0
  const payment = !selection ? '' : usesStock ? '使用库存方巾 × 1' : selection.cost === 0 ? '无需邮资' : usesCoupon ? '使用礼券 × 1' : `${selection.cost} 邮资 · 余 ${credits}`

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  useLayoutEffect(() => {
    const panel = composerRef.current
    if (!panel) { composerHeight.current = null; return }
    const height = panel.getBoundingClientRect().height
    const previous = composerHeight.current
    composerHeight.current = height
    if (previous === null || Math.abs(previous - height) < 1 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const animation = panel.animate([{ height: `${previous}px` }, { height: `${height}px` }], { duration: 250, easing: 'cubic-bezier(.2,.7,.2,1)' })
    return () => animation.cancel()
  }, [tray, !!selection, section])
  useLayoutEffect(() => {
    if (section !== 'chat' || !scroller.current) return
    const justExpanded = expanded && !previousExpanded.current
    previousExpanded.current = expanded
    if (highlight !== null) {
      const target = highlight === 'incoming' ? incomingRef.current : scroller.current.querySelector(`[data-message="${highlight}"]`)
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    } else if (justExpanded) incomingRef.current?.scrollIntoView({ block: 'nearest' })
    else if (following.current) scroller.current.scrollTop = scroller.current.scrollHeight
    else scroller.current.scrollTop = savedScroll.current
  }, [messages.length, section, highlight, tray, expanded, selection?.id])
  useEffect(() => {
    if (highlight === null) return
    const timeout = setTimeout(() => setHighlight(null), 1600)
    return () => clearTimeout(timeout)
  }, [highlight])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || sending) return
      if (tray === 'catalog') { setTray('pick'); setQuery('') }
      else if (tray !== 'closed') closeTray()
      else if (section !== 'chat') setSection('chat')
      else if (expanded) setExpanded(false)
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [tray, sending, section, expanded])

  function choose(gift: GiftDefinition) {
    if (sending) return
    setSelection(gift); setFunding('postage'); setPaymentOpen(false)
    setTray('pick'); setQuery('')
  }
  function closeTray() {
    if (sending) return
    setTray('closed'); setPaymentOpen(false)
    requestAnimationFrame(() => giftToggle.current?.focus({ preventScroll: true }))
  }
  function discardGift() {
    if (sending) return
    setSelection(null); setNote(''); setFunding('postage'); setPaymentOpen(false)
  }
  function enterChat(event: React.MouseEvent<HTMLButtonElement>) {
    const origin = event.currentTarget.firstElementChild?.getBoundingClientRect()
    const frame = phone.current?.getBoundingClientRect()
    setSection('chat')
    if (!origin || !frame || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const x = origin.x + origin.width / 2 - frame.x
    const y = origin.y + origin.height / 2 - frame.y
    phone.current?.animate([{ clipPath: `circle(${origin.width / 2}px at ${x}px ${y}px)` }, { clipPath: `circle(150% at ${x}px ${y}px)` }], { duration: 480, easing: 'cubic-bezier(.16,1,.3,1)' })
  }
  function sendGift() {
    if (!selection || sending || sendLock.current || price > credits) return
    sendLock.current = true
    setSending(true)
    const message: Message = { id: nextId.current++, kind: 'gift', gift: selection, note: note.trim(), funding: payment }
    // The local animation is the only wait in this sample; no external delivery is implied.
    timer.current = setTimeout(() => {
      following.current = true
      setMessages(current => [...current, message])
      if (usesStock) setStock(n => n - 1)
      else if (usesCoupon) setCoupon(n => n - 1)
      else setCredits(n => n - price)
      setTray('closed'); setSelection(null); setNote(''); setPaymentOpen(false)
      setSending(false); sendLock.current = false
      requestAnimationFrame(() => giftToggle.current?.focus({ preventScroll: true }))
    }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 380)
  }
  function sendText() {
    if (!draft.trim()) return
    following.current = true
    setMessages(current => [...current, { id: nextId.current++, kind: 'text', text: draft.trim() }]); setDraft('')
  }
  function jumpToGift(id: number | 'incoming') {
    setSection('chat'); setTray('closed'); setHighlight(id)
    if (id === 'incoming') { setOpened(true); setExpanded(true) }
    else setSentDetails(id)
  }
  const sentGifts = messages.filter((m): m is Extract<Message, { kind: 'gift' }> => m.kind === 'gift')
  const placedGifts = sentGifts.filter(message => canPlaceGift(message.gift))
  const viewingOwnSpace = section === 'space' && spaceOwner === 'me'
  const latest = messages[messages.length - 1]
  const latestPreview = latest ? latest.kind === 'text' ? latest.text : `我送出：${latest.gift.name}` : opened ? '院里的花开了，给你也留一束。' : '外婆送来一份心意'
  const conversationMatch = ['外婆', '日光庭院', '今天院子里出了太阳，花也开得正好。', latestPreview, ...messages.map(message => message.kind === 'text' ? message.text : `${message.gift.name} ${message.note}`)].some(text => text.includes(conversationQuery.trim()))

  return <main className="ip-page">
    <div className="ip-reviewbar">
      <div className="ip-brand"><strong>西界</strong><span>交互设计稿</span></div>
      <div className="ip-review-actions"><span>示例人物与礼物，仅预演交互</span><a href="/">返回当前版</a><button onClick={onReset}>重新体验</button></div>
    </div>
    <div ref={phone} className={`ip-phone ${section === 'space' ? 'is-space' : ''} ${section === 'list' ? 'is-list' : ''}`}>
      <div className="ip-world"><WorldScene world="courtyard"/><div className="ip-world-fade"/></div>
      <div className="ip-status"><span>9:41</span><span><WifiHigh weight="bold"/><BatteryFull weight="fill"/></span></div>
      {section !== 'list' && <><header className="ip-header glass-light">
        <button className="ip-icon" onClick={() => setSection(section === 'chat' ? 'list' : 'chat')} aria-label={section === 'chat' ? '返回沟通列表' : '返回聊天'}><ArrowLeft/></button>
        {viewingOwnSpace ? <div className="ip-person"><Lens world="courtyard" name="我" size={38}/><span><strong>我的空间</strong><small>收到的心意</small></span></div> : <button className="ip-person" onClick={() => { setSpaceOwner('her'); setSection('space') }} aria-label="查看外婆的空间">
          <Lens world="courtyard" avatar={AV.grandma} name="外婆" size={38}/>
          <span><strong>外婆 <em>虚拟人物</em></strong><small>日光庭院 · ELY·01</small></span>
        </button>}
      </header>
      <nav className="ip-tabs" aria-label="人物页面">
        <button className={section === 'chat' ? 'active' : ''} onClick={() => setSection('chat')}>{viewingOwnSpace ? '和外婆说话' : '说话'}</button>
        <button className={section === 'space' ? 'active' : ''} onClick={() => { setSpaceOwner('her'); setSection('space') }}>空间</button>
      </nav></>}
      <div className="ip-body">
        {section === 'list' && <section className="ip-conversations">
          <header><small>ELYSIUM</small><h1>相见</h1></header>
          <label className="ip-conversation-search"><MagnifyingGlass/><input aria-label="搜索人物或聊天内容" placeholder="搜索人物或聊天内容" value={conversationQuery} onChange={event => setConversationQuery(event.target.value)}/>{conversationQuery && <button className="ip-icon" aria-label="清空搜索" onClick={() => setConversationQuery('')}><X/></button>}</label>
          {conversationMatch ? <button className="ip-conversation-item" onClick={enterChat}><Lens world="courtyard" avatar={AV.grandma} name="外婆" size={52}/><span><strong>外婆<small>日光庭院</small></strong><span>{latestPreview}</span></span><CaretRight/></button> : <p className="ip-empty">没有找到相关人物或对话</p>}
        </section>}
        {section === 'chat' && <div className="ip-thread scroll-quiet" ref={scroller} aria-label="与外婆的聊天" onScroll={event => { const list = event.currentTarget; savedScroll.current = list.scrollTop; following.current = list.scrollHeight - list.clientHeight - list.scrollTop < 64 }}>
          <div className="ip-time">今天 · 09:41</div>
          <div className="ip-message them"><Lens world="courtyard" avatar={AV.grandma} name="外婆" size={28}/><div className="ip-bubble">今天院子里出了太阳，花也开得正好。</div></div>
          <div className="ip-message me"><div className="ip-bubble">那就替我多晒一会儿太阳。</div></div>
          <div ref={incomingRef} className={`ip-incoming ${expanded ? 'open' : 'closed'} ${highlight === 'incoming' ? 'is-highlighted' : ''}`}>
            <Lens world="courtyard" avatar={AV.grandma} name="外婆" size={28}/>
            {!expanded ? <button className="ip-envelope" onClick={() => { setOpened(true); setExpanded(true) }} aria-label={opened ? '查看外婆送来的礼物' : '拆开外婆送来的礼物'}>
              <span className="ip-envelope-seal"><Gift weight="duotone"/></span>
              <span className="ip-envelope-label"><strong>给你的一份心意</strong><small>{opened ? placed ? '已放在我的空间' : '已拆开 · 外婆送来' : '外婆送来 · 拆开看看'}</small></span><CaretRight/>
            </button> : <div className="ip-unwrapped">
              <div className="ip-open-top"><span>外婆送来的花</span><button onClick={() => setExpanded(false)}>收起 <CaretDown/></button></div>
              <div className="ip-open-art"><GiftObject gift={incoming}/></div>
              <p className="ip-gift-note">院里的花开了，给你也留一束。<br/>记得好好吃饭。</p>
              <div className="ip-gift-actions">{placed ? <span><Check/> 已放在我的空间</span> : <button onClick={() => setPlaced(true)}>放到我的空间 <CaretRight/></button>}{placed && <button onClick={() => { setSpaceOwner('me'); setSection('space') }}>去看看</button>}</div>
            </div>}
          </div>
          {messages.map(message => message.kind === 'text'
            ? <div className="ip-message me" key={message.id}><div className="ip-bubble">{message.text}</div></div>
            : <div className={`ip-message me ${highlight === message.id ? 'is-highlighted' : ''}`} data-message={message.id} key={message.id}>
                <button className={`ip-sent-gift ${sentDetails === message.id ? 'detailed' : ''}`} onClick={() => setSentDetails(sentDetails === message.id ? null : message.id)} aria-expanded={sentDetails === message.id}>
                  <GiftObject gift={message.gift}/><span><strong>{message.gift.name}</strong>{message.note && <span className="ip-sent-note">{message.note}</span>}<small><Check/> 已送给外婆</small>{sentDetails === message.id && <span className="ip-sent-funding">{message.funding}</span>}</span>
                </button>
              </div>)}
        </div>}
        {section === 'space' && <section className="ip-space" aria-label={spaceOwner === 'her' ? '外婆的空间' : '我的空间'}>
          <div className="ip-space-switch"><button className={spaceOwner === 'her' ? 'active' : ''} onClick={() => setSpaceOwner('her')}>外婆的空间</button><button className={spaceOwner === 'me' ? 'active' : ''} onClick={() => setSpaceOwner('me')}>我的空间</button></div>
          <div className="ip-space-title"><small>{spaceOwner === 'her' ? '日光庭院' : '此岸的一角'}</small><h1>{spaceOwner === 'her' ? '阳光慢慢，日子长长。' : '把心意，留在身边。'}</h1></div>
          <div className="ip-space-props">{spaceOwner === 'me' ? placed ? <button onClick={() => jumpToGift('incoming')}><GiftObject gift={incoming}/><span>外婆送来的花</span></button> : <p>还没有陈列的礼物</p> : placedGifts.length ? placedGifts.map(message => <button key={message.id} onClick={() => jumpToGift(message.id)}><GiftObject gift={message.gift}/><span>{message.gift.name}</span></button>) : <p>院子里，等一份你的心意。</p>}</div>
          <button className="ip-space-talk" onClick={() => setSection('chat')}>回到聊天 <CaretRight/></button>
        </section>}
        {section === 'history' && <section className="ip-history">
          <div className="ip-history-head"><button className="ip-icon" aria-label="返回聊天" onClick={() => setSection('chat')}><ArrowLeft/></button><h2>和外婆的礼物</h2></div>
          <div className="ip-history-filters">{(['all', 'sent', 'received'] as const).map((filter, index) => <button key={filter} className={historyFilter === filter ? 'active' : ''} onClick={() => setHistoryFilter(filter)}>{['全部', '我送出的', '外婆送来的'][index]}</button>)}</div>
          <div className="ip-history-list">{historyFilter !== 'received' && [...sentGifts].reverse().map(message => <button key={message.id} onClick={() => jumpToGift(message.id)}><GiftObject gift={message.gift}/><span><strong>{message.gift.name}</strong><small>我送给外婆 · 今天</small></span><CaretRight/></button>)}
            {historyFilter !== 'sent' && <button onClick={() => jumpToGift('incoming')}><GiftObject gift={incoming}/><span><strong>{opened ? '一束鲜花' : '待拆的心意'}</strong><small>外婆送来 · {opened ? '已拆开' : '待拆开'}</small></span><CaretRight/></button>}
            {historyFilter === 'sent' && !sentGifts.length && <p className="ip-empty">还没送过礼物</p>}
          </div>
        </section>}
      </div>
      {section === 'chat' && <footer ref={composerRef} className={`ip-composer glass-light ${tray !== 'closed' ? 'tray-open' : ''} ${selection ? 'has-selection' : ''} ${sending ? 'is-sending' : ''}`}>
        {tray === 'closed' ? <>
          <form className="ip-compose-row" onSubmit={event => { event.preventDefault(); sendText() }}><input aria-label="发给外婆的话" placeholder="想说什么，慢慢说…" value={draft} onChange={event => setDraft(event.target.value)} maxLength={500}/><button className="ip-icon ip-text-send" aria-label="发送消息" disabled={!draft.trim()}><ArrowUp weight="bold"/></button></form>
          <div className="ip-tools"><button className="ip-gift-toggle" ref={giftToggle} onClick={() => setTray('pick')}><Gift weight="duotone"/> 送礼物</button><button onClick={() => setSection('history')}>查看收送 <CaretRight/></button></div>
        </> : <div className="ip-tray">
          <div className="ip-tray-head"><h2>给外婆</h2><button onClick={closeTray} disabled={sending}>收起 <CaretDown/></button></div>
          {tray === 'catalog' ? <>
            <div className="ip-catalog-head"><label><MagnifyingGlass/><input autoFocus aria-label="搜索礼物" placeholder="找一件礼物" value={query} onChange={event => { setQuery(event.target.value); setSelection(null) }}/></label><button className="ip-icon" aria-label="返回挑选" onClick={() => { setQuery(''); setTray('pick') }}><X/></button></div>
            <div className="ip-catalog-grid scroll-quiet">{matching.map(gift => <button className="ip-object" key={gift.id} onClick={() => choose(gift)}><GiftObject gift={gift}/><strong>{gift.name}</strong><small>{gift.cost === 0 ? '免费' : gift.id === 'cloth' && stock > 0 ? `库存 ${stock} 件` : `${gift.cost} 邮资`}</small></button>)}{!matching.length && <p className="ip-empty">没有找到这件礼物</p>}</div>
          </> : <>
            <div className="ip-object-row">{(selection && !suggested.some(g => g.id === selection.id) ? [selection, ...suggested.slice(1)] : suggested).map(gift => <button className={`ip-object ${selection?.id === gift.id ? 'selected' : ''}`} key={gift.id} onClick={() => choose(gift)} disabled={sending} aria-pressed={selection?.id === gift.id}><GiftObject gift={gift}/><strong>{gift.name}</strong><small>{gift.cost === 0 ? '免费' : gift.id === 'cloth' && stock > 0 ? `库存 ${stock} 件` : `${gift.cost} 邮资`}</small>{selection?.id === gift.id && <span className="ip-object-check"><Check weight="bold"/></span>}</button>)}</div>
            <button className="ip-all-gifts" onClick={() => setTray('catalog')} disabled={sending}>更多礼物 <span>{catalog.length}</span><CaretRight/></button>
            {selection && <div className="ip-selection-note"><input aria-label="随礼附言" placeholder="捎句话给外婆（选填）" value={note} onChange={event => setNote(event.target.value)} maxLength={100} disabled={sending}/><button onClick={discardGift} disabled={sending}>取消礼物</button></div>}
            <div className="ip-send-row"><div className="ip-payment">{selection ? <>
              {couponEligible ? <button onClick={() => setPaymentOpen(!paymentOpen)} disabled={sending} aria-expanded={paymentOpen}>{payment}<CaretDown/></button> : <span>{payment}</span>}
              {paymentOpen && <div className="ip-payment-options"><button onClick={() => { setFunding('postage'); setPaymentOpen(false) }}>邮资 · 余 {credits} {funding === 'postage' && <Check/>}</button><button onClick={() => { setFunding('coupon'); setPaymentOpen(false) }}>礼券 · 余 {coupon} {funding === 'coupon' && <Check/>}</button></div>}
            </> : <span>挑一件，寄给她</span>}</div><button className="ip-primary" disabled={!selection || sending || price > credits} onClick={sendGift}>{sending ? '正在寄出…' : !selection ? '寄出' : usesStock ? '寄出方巾' : usesCoupon ? '用礼券寄出' : selection.cost === 0 ? '免费寄出' : `寄出 · ${price} 邮资`}<PaperPlaneTilt weight="fill"/></button></div>
          </>}
        </div>}
      </footer>}
      <div className="ip-home-indicator"/>
    </div>
  </main>
}
