import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LangProvider, useI18n, isZh, letterReply, buildReply, type WorldId } from './i18n'
import { accountOwner, accountStateKey, loadState, loadUser, withLocalIdentity, withPersonIdentity, isNight, nid, seedPosts, echoesFor, echoForMemory, STORE, USER_STORE, type Author, type Chats, type Msg, type Person, type Post, type Theme, type User } from './model'
import { I, ToneCtx, NightCtx, fxPrefs, type BarTone } from './ui'
import { StatusBar, ReturnSplash, AuthFlow, BottomNav, MePage, type NavKey } from './shell'
import { Atlas, WorldView, type AtlasView, type WorldPlaceView, type Rect } from './home'
import { contentZoomStyle, hasLegacyZoomBounds } from './mobile/layout'
import { Home, ProductUpdates, type HomeRecommendation } from './Conversations'
import { PersonSpace, Gathering } from './person'
import { Profile } from './profile'
import { Moments } from './moments'
import { Seek } from './seek'
import { clearConversationDraft } from './conversationHistory'
import { inferAudience } from './gifts/catalog'
import { applyGiftReward, getGiftState, receiveGift, openReceivedGift, hasArrived, targetMatchesPerson, receiptMatchesPerson } from './gifts/store'
import { useGiftState, useArrivalClock } from './gifts/GiftLedger'
import { appendGiftMessages, personaReturn } from './gifts/messages'
import { recordPreviewLogin, recordPreviewMemory, syncInviteRewards } from './gifts/client'
import type { GiftOpenOptions, GiftReceipt } from './gifts/types'
import { isNativeRuntime, useNativeBack } from './mobile/back'
import { ContextSheet } from './mobile/ContextSheet'

const GiftExperience = lazy(() => import('./gifts/GiftExperience').then(module => ({ default: module.GiftExperience })))
const AssetWallet = lazy(() => import('./gifts/AssetWallet').then(module => ({ default: module.AssetWallet })))
const CheckoutPreview = lazy(() => import('./commerce/CheckoutPreview').then(module => ({ default: module.CheckoutPreview })))
const SystemInbox = lazy(() => import('./gifts/SystemInbox').then(module => ({ default: module.SystemInbox })))
const ReceivedGiftDetail = lazy(() => import('./gifts/ReceivedGiftDetail').then(module => ({ default: module.ReceivedGiftDetail })))
const InviteFriends = lazy(() => import('./gifts/InviteFriends').then(module => ({ default: module.InviteFriends })))
const GIFT_RESUME = 'elysium.giftResume.v1'
const discoveryPreview = import.meta.env.DEV ? new URLSearchParams(location.search) : null
const initialRecommendation: HomeRecommendation | null = discoveryPreview?.get('preview') === 'discovery'
  ? discoveryPreview.get('notice') === 'invite' ? 'invite' : 'atlas'
  : null

/* ------------------------------------------------------------------ *
 * 西界 / ELYSIUM — A world for the stories we share.
 *
 * 以记忆为坐标，在诸世界中找到 TA，确认关系后加入联系人，
 * 再像微信一样说话、通话、写信。一个账号 = 一个私人多元宇宙：
 *   此岸（相见 · 我）—— 界隙（启动 · 登录 · 寻找 · 星图 · 通话）—— 彼岸（各个世界）
 * 人物由 AI 依据用户提供的记忆呈现（明确标注），不表示本人复活或意识延续。
 * ------------------------------------------------------------------ */

type Route =
  | { s: 'home'; query?: string } | { s: 'space' } | { s: 'atlas'; view?: AtlasView } | { s: 'me' }
  | { s: 'seek'; clue?: string; from?: Route }
  | { s: 'person'; id: number; origin?: Rect; landed?: boolean; focusMessageId?: number; memoryId?: number; letter?: boolean; call?: 'voice' | 'video'; from?: Route }
  | { s: 'profile'; id: number; from?: Route }
  | { s: 'moments'; author: number; focusGiftId?: string; returnToGift?: { personId: number; options: GiftOpenOptions }; from?: Route }
  | { s: 'world'; world: WorldId; view?: WorldPlaceView; from?: Route }
  | { s: 'gather'; world: WorldId; focusMessageId?: number; from?: Route }

function hasGiftReturn(route: Route): boolean {
  if (route.s === 'moments' && route.returnToGift) return true
  return 'from' in route && route.from ? hasGiftReturn(route.from) : false
}

const ZOOM = 1.14

function withoutGiftMessages(chats: Chats = {}): Chats {
  return Object.fromEntries(Object.entries(chats).map(([key, messages]) => [key, messages.filter(message => message.kind !== 'gift')]))
}

export default function App() {
  return <LangProvider><AppInner /></LangProvider>
}

function ContextLoading({ label, onClose }: { label: string; onClose: () => void }) {
  const { t, lang } = useI18n()
  return <ContextSheet label={label} onClose={onClose}>
    <header className="flex min-h-12 shrink-0 items-center justify-between gap-3 px-5">
      <span className="font-serif text-[21px]">{label}</span>
      <button data-context-close onClick={onClose} aria-label={t('common.close')} className="flex h-11 w-11 items-center justify-center rounded-full text-ink-soft"><I.X className="h-5 w-5" /></button>
    </header>
    <div className="flex flex-1 items-center justify-center text-ink-soft" role="status">{isZh(lang) ? '正在打开…' : 'Opening…'}</div>
  </ContextSheet>
}

function AppInner() {
  const native = isNativeRuntime()
  const { lang, t } = useI18n()
  const [user, setUser] = useState<User | null>(() => {
    const saved = loadUser()
    return saved ? withLocalIdentity(saved) : null
  })
  const [boot] = useState(() => loadState(lang, user ? accountOwner(user) : undefined, !!user))
  const [people, setPeople] = useState<Person[]>(boot?.people ?? [])
  const [chats, setChats] = useState<Chats>(() => withoutGiftMessages(boot?.chats))
  const [posts, setPosts] = useState<Post[]>(boot?.posts ?? [])
  const [large, setLarge] = useState(boot?.large ?? false)
  const [legacyZoomBounds] = useState(hasLegacyZoomBounds)
  const [readAloud, setReadAloud] = useState(boot?.readAloud ?? false)
  const [theme, setTheme] = useState<Theme>(boot?.theme ?? 'auto')
  const [calm, setCalm] = useState(boot?.calm ?? false)
  const [haptics, setHaptics] = useState(boot?.haptics ?? true)
  const [sound, setSound] = useState(boot?.sound ?? false)
  const [route, setRoute] = useState<Route>({ s: 'home' })
  const [switchingAccount, setSwitchingAccount] = useState(false)
  const accountSwitchTrigger = useRef<HTMLButtonElement | null>(null)
  const [recommendation, setRecommendation] = useState(initialRecommendation)
  const dismissRecommendation = useCallback(() => setRecommendation(null), [])
  const [updatesOpen, setUpdatesOpen] = useState(false)
  const [gift, setGift] = useState<{ personId: number; options: GiftOpenOptions; session?: number } | null>(null)
  const [giftHub, setGiftHub] = useState(false)
  const [checkout, setCheckout] = useState<'purchase' | 'orders' | null>(null)
  const [systemInbox, setSystemInbox] = useState(false)
  const [walletReturnSystem, setWalletReturnSystem] = useState(false)
  const [incomingGiftId, setIncomingGiftId] = useState<string | null>(null)
  const [mySpaceOpen, setMySpaceOpen] = useState(false)
  const [mySpaceReturnGiftId, setMySpaceReturnGiftId] = useState<string | null>(null)
  const [deliveryError, setDeliveryError] = useState(false)
  const [deliveryRetry, setDeliveryRetry] = useState(0)
  const [invites, setInvites] = useState(false)
  const [giftResume, setGiftResume] = useState<GiftOpenOptions | null>(() => {
    try { return JSON.parse(sessionStorage.getItem(GIFT_RESUME) || 'null') } catch { return null }
  })
  const [rewardNotice, setRewardNotice] = useState('')
  const [rewardRetry, setRewardRetry] = useState(0)
  const restoredSession = useRef(!!user)
  const giftTrigger = useRef<HTMLElement | null>(null)
  const giftSession = useRef(0)
  const inviteTrigger = useRef<HTMLElement | null>(null)
  const walletTrigger = useRef<HTMLElement | null>(null)
  const checkoutTrigger = useRef<HTMLElement | null>(null)
  const mySpaceTrigger = useRef<HTMLButtonElement | null>(null)
  const inviteFromUpdates = useRef(false)
  const giftReturnReceived = useRef<string | null>(null)
  const memoryRegistered = useRef(new Set<string>())
  const [iris, setIris] = useState<null | 'return' | 'login'>(() => (loadUser() ? 'return' : null))
  const [intro, setIntro] = useState(() => !user)
  const frame = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const night = isNight(theme)
  const draftOwner = user ? accountOwner(user) : 'login.undefined'
  const giftLedger = useGiftState(draftOwner)
  const visibleChats = useMemo(() => appendGiftMessages(chats, people, giftLedger, draftOwner, lang, t('talk.note')),
    [chats, people, giftLedger, draftOwner, lang, t])
  const arrivalNow = useArrivalClock(giftLedger.receipts)
  const pendingReplies = useRef(new Set<string>())
  const rewardOwner = useRef(draftOwner)
  rewardOwner.current = draftOwner
  const giftPerson = people.find(person => person.id === gift?.personId)
  const incoming = giftLedger.received?.find(item => item.id === incomingGiftId)
  const incomingPerson = incoming && people.find(person => targetMatchesPerson(incoming.from, person))

  useEffect(() => {
    if (!user) return
    for (const receipt of giftLedger.receipts) {
      const pendingKey = draftOwner + ':' + receipt.id
      if (!receipt.personaReply || !hasArrived(receipt, Date.now()) || pendingReplies.current.has(pendingKey)) continue
      if (!people.some(person => receiptMatchesPerson(receipt, person))) continue
      if ((giftLedger.received ?? []).some(item => item.replyTo === receipt.id)) continue
      const story = personaReturn(receipt, lang)
      pendingReplies.current.add(pendingKey)
      void receiveGift(draftOwner, { id: 'persona-reply:' + receipt.id, from: receipt.target, giftId: story.giftId,
        quantity: 1, note: story.note, createdAt: receipt.arriveAt, origin: 'persona', replyTo: receipt.id,
      }).catch(() => {
        if (rewardOwner.current === draftOwner && !(getGiftState(draftOwner).received ?? []).some(item => item.replyTo === receipt.id)) setDeliveryError(true)
      }).finally(() => pendingReplies.current.delete(pendingKey))
    }
  }, [giftLedger, arrivalNow, draftOwner, people, lang, user?.localLoginId, deliveryRetry])

  function showReceivedGift(id: string) {
    if (!(giftLedger.received ?? []).some(item => item.id === id)) return
    setIncomingGiftId(id)
    void openReceivedGift(draftOwner, id).catch(() => { /* The detail keeps an explicit retry action. */ })
  }
  function openMySpace(trigger: HTMLButtonElement) {
    mySpaceTrigger.current = trigger
    setMySpaceReturnGiftId(null)
    setMySpaceOpen(true)
  }
  function visitMyGiftSpace() {
    if (!mySpaceOpen) {
      mySpaceTrigger.current = null
      setMySpaceReturnGiftId(incomingGiftId)
    }
    setIncomingGiftId(null)
    setMySpaceOpen(true)
  }
  function closeMySpace() {
    const trigger = mySpaceTrigger.current
    mySpaceTrigger.current = null
    setMySpaceOpen(false)
    setIncomingGiftId(mySpaceReturnGiftId)
    setMySpaceReturnGiftId(null)
    if (!mySpaceReturnGiftId && trigger) requestAnimationFrame(() => {
      if (trigger.isConnected && !trigger.closest('[hidden], [inert]')) trigger.focus({ preventScroll: true })
    })
  }
  async function refreshInviteRewards() {
    const before = getGiftState(draftOwner).usedRewards.length
    await syncInviteRewards(draftOwner)
    if (rewardOwner.current === draftOwner && getGiftState(draftOwner).usedRewards.length > before) {
      setRewardNotice('系统通知：邀请回礼已到账，点这里查看赠礼券。')
    }
  }
  function openGift(personId: number, options: GiftOpenOptions = {}, returnReceived?: string) {
    if (!people.some(person => person.id === personId)) return
    giftTrigger.current = document.activeElement as HTMLElement | null
    giftReturnReceived.current = returnReceived ?? null
    const presentation = options.presentation ?? (options.goalId || options.receiptId || options.tab && options.tab !== 'catalog' ? 'full' : 'compact')
    setGift({ personId, options: { ...options, presentation }, session: ++giftSession.current })
  }
  function closeGift() {
    setGift(null)
    const returnId = giftReturnReceived.current
    giftReturnReceived.current = null
    if (returnId && (getGiftState(draftOwner).received ?? []).some(item => item.id === returnId)) setIncomingGiftId(returnId)
    requestAnimationFrame(() => {
      const trigger = giftTrigger.current
      if (trigger?.isConnected && !trigger.closest('[hidden], [inert]')) trigger.focus({ preventScroll: true })
    })
  }
  function finishQuickGift() {
    giftReturnReceived.current = null
    closeGift()
  }
  function seekForGift(options: GiftOpenOptions = {}) {
    setGiftResume(options)
    setGiftHub(false)
    setRoute({ s: 'seek', from: route })
  }
  function openGiftHub(trigger?: HTMLElement) {
    walletTrigger.current = trigger instanceof HTMLElement ? trigger : null
    giftReturnReceived.current = null
    setGift(null)
    setInvites(false)
    setSystemInbox(false)
    setWalletReturnSystem(false)
    setGiftHub(true)
  }
  function openCheckout(view: 'purchase' | 'orders') {
    checkoutTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setCheckout(view)
  }
  function closeCheckout() {
    const trigger = checkoutTrigger.current
    checkoutTrigger.current = null
    setCheckout(null)
    requestAnimationFrame(() => {
      if (trigger?.isConnected && !trigger.closest('[hidden], [inert]') && !trigger.matches(':disabled')) {
        trigger.focus({ preventScroll: true })
      } else if (gift && document.activeElement === document.body) {
        frame.current?.querySelector<HTMLButtonElement>('.gift-experience .gs-primary:not(:disabled)')?.focus({ preventScroll: true })
      }
    })
  }
  function closeWallet() {
    setGiftHub(false)
    const trigger = walletTrigger.current
    walletTrigger.current = null
    if (walletReturnSystem) setSystemInbox(true)
    else if (trigger) requestAnimationFrame(() => {
      if (trigger.isConnected && !trigger.closest('[hidden], [inert]')) trigger.focus({ preventScroll: true })
    })
    setWalletReturnSystem(false)
  }
  function backToGiftChat() {
    if (!giftPerson) return
    giftReturnReceived.current = null
    setGift(null)
    if (route.s !== 'person' || route.id !== giftPerson.id) setRoute({ s: 'person', id: giftPerson.id, landed: true, from: route })
  }
  function openSystemInbox() { setSystemInbox(true); setGiftHub(false); setInvites(false); setGift(null); setRewardNotice('') }
  function openInvites() {
    inviteTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    inviteFromUpdates.current = false
    if (recommendation === 'invite') dismissRecommendation()
    setGiftHub(false); setInvites(true)
  }
  function closeInvites() {
    setInvites(false)
    if (inviteFromUpdates.current) {
      inviteFromUpdates.current = false
      setUpdatesOpen(true)
      return
    }
    requestAnimationFrame(() => {
      const trigger = inviteTrigger.current
      if (trigger?.isConnected && !trigger.closest('[hidden], [inert]')) trigger.focus({ preventScroll: true })
    })
  }
  function openRecommendedFeature(kind: HomeRecommendation) {
    dismissRecommendation()
    setUpdatesOpen(false)
    if (kind === 'invite') {
      openInvites()
      inviteFromUpdates.current = updatesOpen
    } else setRoute({ s: 'atlas', view: { searchOpen: true } })
  }
  function visitGiftSpace(receipt?: GiftReceipt) {
    if (!gift || !giftPerson) return
    const receiptId = receipt?.id ?? gift.options.receiptId
    const returnToGift = { personId: gift.personId, options: { ...gift.options, tab: 'receipts' as const, receiptId } }
    setGift(null)
    setRoute({ s: 'moments', author: giftPerson.id, focusGiftId: receiptId, returnToGift, from: route })
  }
  function backFromPersonalSpace() {
    if (route.s !== 'moments') return
    setRoute(route.from ?? { s: 'home' })
    if (route.returnToGift) setGift(route.returnToGift)
  }

  useEffect(() => {
    try {
      if (giftResume) sessionStorage.setItem(GIFT_RESUME, JSON.stringify(giftResume))
      else sessionStorage.removeItem(GIFT_RESUME)
    } catch { /* The current in-memory selection remains available. */ }
  }, [giftResume])

  useEffect(() => {
    if (!user) return
    let live = true
    let inviteId = ''
    try {
      inviteId = new URLSearchParams(location.search).get('invite') || sessionStorage.getItem('elysium.pendingInvite') || ''
      if (inviteId) sessionStorage.setItem('elysium.pendingInvite', inviteId)
    } catch { /* A URL can still carry the invitation. */ }
    void recordPreviewLogin(draftOwner, inviteId || undefined, restoredSession.current).then(async () => {
      if (inviteId) sessionStorage.removeItem('elysium.pendingInvite')
      await refreshInviteRewards()
    }).catch(() => { if (live && inviteId) setRewardNotice('邀请已为你保留，稍后可从「邀请朋友与回礼」继续。') })
    return () => { live = false }
  }, [draftOwner, user?.localLoginId])

  useEffect(() => {
    if (!user) return
    let token = ''
    try { token = new URLSearchParams(location.search).get('giftReward') || sessionStorage.getItem('elysium.giftReward') || '' } catch { return }
    if (!token) return
    let live = true
    void fetch(`/api/gifts/reward/${encodeURIComponent(token)}`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner: draftOwner }),
    }).then(async response => {
      if (!response.ok) throw new Error('reward-unavailable')
      await applyGiftReward(draftOwner, token)
      if (!live) return
      sessionStorage.removeItem('elysium.giftReward')
      const url = new URL(location.href)
      url.searchParams.delete('giftReward')
      history.replaceState(history.state, '', url)
      setRewardNotice('回程邮资已存入你的礼物包。')
      setGiftHub(true)
    }).catch(() => { if (live) setRewardNotice('回礼尚未领取成功，点击这里重新领取。') })
    return () => { live = false }
  }, [draftOwner, user?.localLoginId, rewardRetry])

  function finishSeeking(found: Person) {
    const person = withPersonIdentity(found)
    setPeople(current => [...current, person])
    setPosts(current => [...echoesFor(person, lang, true), ...current])
    setRoute({ s: 'person', id: person.id, landed: true, from: { s: 'home' } })
    if (giftResume) {
      setGift({ personId: person.id, options: giftResume })
      setGiftResume(null)
    }
  }
  function adoptSharedMemory(goalId: string, seat: number, text: string) {
    if (!giftPerson || giftPerson.memories.some(memory => memory.source?.goalId === goalId && memory.source.seat === seat)) return
    const memory = { id: nid(), title: lang.startsWith('zh') ? '一起留下的回忆' : 'A shared memory', body: text, source: { kind: 'shared' as const, goalId, seat } }
    setPeople(current => current.map(person => person.id === giftPerson.id ? { ...person, memories: [...person.memories, memory] } : person))
    setPosts(current => [echoForMemory(giftPerson, memory, lang), ...current])
  }

  // 动效偏好同步给命令式动效（触感、音效、仪式时间线）
  fxPrefs.haptics = haptics; fxPrefs.sound = sound
  fxPrefs.calm = calm || (typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

  /* ------------------------------ 持久化 ------------------------------ */
  useEffect(() => {
    try {
      // Keep the original payload available for legacy ownership recovery.
      const legacy = JSON.parse(localStorage.getItem(STORE) || '{}')
      localStorage.setItem(STORE, JSON.stringify({ ...legacy, large, readAloud, theme, calm, haptics, sound }))
    } catch { /* Device preferences remain usable for this session. */ }
  }, [large, readAloud, theme, calm, haptics, sound])
  useEffect(() => {
    if (!user) return
    const data = { people, chats, posts, nickname: user.nick }
    const key = accountStateKey(draftOwner)
    let saved = false
    try { localStorage.setItem(key, JSON.stringify(data)); saved = true } catch {
      // 空间不足时逐级退让：先去掉动态里本机上传的大图，仍不够再去掉相册大图
      const slimPosts = posts.map((p) => ({ ...p, images: p.images.filter((s) => !s.startsWith('data:')) }))
      try { localStorage.setItem(key, JSON.stringify({ ...data, posts: slimPosts })); saved = true } catch {
        try {
          const slim = people.map((p) => ({ ...p, photos: (p.photos ?? []).filter((s) => !s.startsWith('data:')) }))
          localStorage.setItem(key, JSON.stringify({ ...data, people: slim, posts: slimPosts }))
          saved = true
        } catch { /* 存储不可用时忽略 */ }
      }
    }
    if (saved && !memoryRegistered.current.has(draftOwner) && people.some(person => person.memories.some(memory => memory.body.trim()))) {
      memoryRegistered.current.add(draftOwner)
      void recordPreviewMemory(draftOwner).then(refreshInviteRewards).catch(() => {
        memoryRegistered.current.delete(draftOwner)
        if (rewardOwner.current === draftOwner) setRewardNotice('记忆已保存，邀请进度稍后可重新核对。')
      })
    }
  }, [people, chats, posts, draftOwner, user?.nick])
  useEffect(() => {
    try { if (user) localStorage.setItem(USER_STORE, JSON.stringify(user)); else localStorage.removeItem(USER_STORE) } catch { /* 忽略 */ }
  }, [user])

  /* -------------------- 状态栏明暗：最近挂载的界面决定 -------------------- */
  const [tones, setTones] = useState<{ id: number; tone: BarTone }[]>([])
  const toneSeq = useRef(0)
  const pushTone = useCallback((tone: BarTone) => {
    const id = ++toneSeq.current
    setTones((s) => [...s, { id, tone }])
    return () => setTones((s) => s.filter((x) => x.id !== id))
  }, [])
  const barTone: BarTone = iris ? 'light' : tones.length ? tones[tones.length - 1].tone : 'dark'
  useEffect(() => {
    if (!native) return
    const bridge = (window as Window & { Capacitor?: { nativePromise?: (plugin: string, method: string, options: object) => Promise<unknown> } }).Capacitor
    if (!bridge?.nativePromise) return
    let active = true
    const syncBars = () => {
      const canvas = getComputedStyle(frame.current ?? document.documentElement).getPropertyValue('--color-canvas').trim()
      const color = barTone === 'light' && !night ? '#0a1719' : canvas
      // The OS owns the clock and navigation buttons; its inset surface needs
      // a matching background when an older WebView uses native safe-area padding.
      void bridge.nativePromise!('SystemBars', 'setStyle', { style: barTone === 'light' ? 'DARK' : 'LIGHT' })
        .then(() => active ? bridge.nativePromise!('WindowSurface', 'setBackground', { color }) : undefined)
        .catch(() => {})
    }
    syncBars()
    window.addEventListener('resize', syncBars)
    return () => { active = false; window.removeEventListener('resize', syncBars) }
  }, [native, barTone, night])

  /* ----------------------- 开场：虹膜打开，进入此岸 ----------------------- */
  useLayoutEffect(() => {
    if (!iris || !content.current) return
    if (fxPrefs.calm) { const id = window.setTimeout(() => setIris(null), 350); return () => clearTimeout(id) }
    const a = content.current.animate(
      [{ clipPath: 'circle(0px at 50% 44%)' }, { clipPath: 'circle(150% at 50% 44%)' }],
      { duration: 680, delay: iris === 'return' ? 720 : 60, easing: 'cubic-bezier(0.16,1,0.3,1)', fill: 'backwards' },
    )
    a.onfinish = () => setIris(null)
    return () => a.cancel()
  }, [iris])

  /* --------------------- 信件慢递：到点后送达 AI 回信 --------------------- */
  useEffect(() => {
    const tick = () => setPeople((ps) => {
      const now = Date.now(); let changed = false
      const next = ps.map((p) => {
        if (!p.letters?.some((l) => l.wantReply && !l.reply && (l.replyAt ?? 0) <= now)) return p
        changed = true
        return { ...p, letters: p.letters.map((l) => (l.wantReply && !l.reply && (l.replyAt ?? 0) <= now ? { ...l, reply: letterReply(lang, p.age), replyNew: true } : l)) }
      })
      return changed ? next : ps
    })
    tick()
    const id = window.setInterval(tick, 2000)
    return () => clearInterval(id)
  }, [lang])

  /* 倾斜视差：透镜高光随手机（或指针）移动 */
  useEffect(() => {
    const onOrient = (e: DeviceOrientationEvent) => {
      const el = frame.current; if (!el || fxPrefs.calm || e.gamma == null || e.beta == null) return
      el.style.setProperty('--tx', Math.max(-1, Math.min(1, e.gamma / 35)).toFixed(3))
      el.style.setProperty('--ty', Math.max(-1, Math.min(1, (e.beta - 45) / 35)).toFixed(3))
    }
    window.addEventListener('deviceorientation', onOrient)
    return () => window.removeEventListener('deviceorientation', onOrient)
  }, [])
  const onTilt = (e: React.PointerEvent) => {
    const el = frame.current; if (!el || fxPrefs.calm || e.pointerType !== 'mouse') return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--tx', (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3))
    el.style.setProperty('--ty', (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3))
  }

  /* ----------------- 空间：补齐回响 · 联系人的点赞与评论 ----------------- */
  useEffect(() => { setPosts((ps) => seedPosts(ps, people, lang)) }, [people, lang])
  const reactTimers = useRef<number[]>([])
  useEffect(() => () => { reactTimers.current.forEach(clearTimeout); reactTimers.current = [] }, [draftOwner])
  const later = (ms: number, fn: () => void) => { reactTimers.current.push(window.setTimeout(fn, ms)) }
  const patchPost = (id: number, fn: (p: Post) => Post) => setPosts((ps) => ps.map((p) => (p.id === id ? fn(p) : p)))
  const addPost = (text: string, images: string[]) => {
    const post: Post = { id: nid(), author: 'me', kind: 'mine', text, images, at: Date.now(), likes: [], comments: [] }
    setPosts((ps) => [post, ...ps])
    // 联系人陆续来点赞、评论（AI 生成，评论带标注）
    ;[...people].sort(() => Math.random() - 0.5).slice(0, 2).forEach((p, i) => {
      later(1800 + i * 2400, () => patchPost(post.id, (x) => (x.likes.includes(p.id) ? x : { ...x, likes: [...x.likes, p.id] })))
      later(3200 + i * 2600, () => patchPost(post.id, (x) => ({ ...x, comments: [...x.comments, { id: nid(), author: p.id, text: buildReply(lang, p, text || '…').text, ai: true, at: Date.now() }] })))
    })
  }
  const toggleLike = (id: number) => patchPost(id, (x) => ({ ...x, likes: x.likes.includes('me') ? x.likes.filter((a) => a !== 'me') : [...x.likes, 'me'] }))
  const addComment = (id: number, text: string, to?: Author) => {
    const post = posts.find((p) => p.id === id); if (!post) return
    patchPost(id, (x) => ({ ...x, comments: [...x.comments, { id: nid(), author: 'me', text, to, at: Date.now() }] }))
    const replier = typeof to === 'number' ? people.find((p) => p.id === to) : typeof post.author === 'number' ? people.find((p) => p.id === post.author) : undefined
    if (replier) later(2200, () => patchPost(id, (x) => ({ ...x, comments: [...x.comments, { id: nid(), author: replier.id, text: buildReply(lang, replier, text).text, to: 'me', ai: true, at: Date.now() }] })))
  }

  /* ------------------------------ 导航 ------------------------------ */
  const zoomed = !switchingAccount && large && ['home', 'space', 'atlas', 'me', 'person', 'profile', 'moments', 'world', 'gather'].includes(route.s)
  const openPerson = (id: number, focusMessageId?: number) => setRoute({ s: 'person', id, focusMessageId, from: route })
  const openWorld = (world: WorldId, personId?: number) => setRoute({ s: 'world', world, view: personId === undefined ? undefined : { personId }, from: route })
  const openGather = (world: WorldId, focusMessageId?: number) => setRoute({ s: 'gather', world, focusMessageId, from: route })
  const openProfile = (id: number) => setRoute({ s: 'profile', id, from: route })
  const backFrom = (r: Route) => setRoute(('from' in r && r.from) ? r.from : { s: 'home' })
  const updatePerson = (id: number, patch: Partial<Person>) => setPeople((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  const deletePerson = (id: number) => {
    if (gift?.personId === id) setGift(null)
    clearConversationDraft(draftOwner, id)
    setPeople((ps) => ps.filter((p) => p.id !== id))
    setChats((c) => { const { [String(id)]: _drop, ...rest } = c; return rest })
    setPosts((ps) => ps.filter((x) => x.author !== id).map((x) => ({ ...x, likes: x.likes.filter((a) => a !== id), comments: x.comments.filter((c) => c.author !== id) })))
    setRoute({ s: 'home' })
  }
  const persistChat = (key: string, msgs: Msg[]) => setChats((c) => ({ ...c, [key]: msgs.filter(message => message.kind !== 'gift') }))
  function openAccountSwitch(trigger: HTMLButtonElement | null) {
    accountSwitchTrigger.current = trigger
    setSwitchingAccount(true)
  }
  function cancelAccountSwitch() {
    const trigger = accountSwitchTrigger.current
    accountSwitchTrigger.current = null
    setSwitchingAccount(false)
    requestAnimationFrame(() => {
      if (trigger?.isConnected && !trigger.closest('[hidden], [inert]')) trigger.focus({ preventScroll: true })
    })
  }
  const finishLogin = (signedIn: User) => {
    const account = withLocalIdentity(signedIn)
    const owner = accountOwner(account)
    if (switchingAccount && user && owner === accountOwner(user)) {
      cancelAccountSwitch()
      return
    }
    const saved = loadState(lang, owner)
    accountSwitchTrigger.current = null
    setSwitchingAccount(false)
    setRewardNotice(''); setDeliveryError(false)
    restoredSession.current = false
    setPeople(saved?.people ?? [])
    setChats(withoutGiftMessages(saved?.chats))
    setPosts(saved?.posts ?? [])
    setUser({ ...account, nick: saved?.nickname ?? account.nick }); setIntro(false); setRoute({ s: 'home' }); setIris('login')
  }
  const logout = () => {
    giftReturnReceived.current = null
    setGift(null); setGiftHub(false); setInvites(false); setGiftResume(null); setRewardNotice('')
    setIncomingGiftId(null); setMySpaceOpen(false); setMySpaceReturnGiftId(null); setSystemInbox(false); setDeliveryError(false)
    setPeople([]); setChats({}); setPosts([]); setCheckout(null); setUpdatesOpen(false)
    setUser(null); setRoute({ s: 'home' })
  }

  const current = route.s === 'person' || route.s === 'profile' ? people.find((p) => p.id === route.id) : undefined
  useEffect(() => { if ((route.s === 'person' || route.s === 'profile') && !current) setRoute({ s: 'home' }) }, [route, current])
  const navKey: NavKey | null = route.s === 'home' || route.s === 'space' || route.s === 'atlas' || route.s === 'me' ? route.s : null
  const overlayOpen = !!checkout || giftHub || systemInbox || invites || !!gift || !!incomingGiftId || mySpaceOpen || updatesOpen
  const canShowRecommendation = !iris && !overlayOpen && !rewardNotice && !deliveryError

  useNativeBack(() => {
    if (checkout) { closeCheckout(); return true }
    if (invites) { closeInvites(); return true }
    if (incomingGiftId) { setIncomingGiftId(null); return true }
    if (mySpaceOpen) { closeMySpace(); return true }
    if (gift) { closeGift(); return true }
    if (giftHub) { closeWallet(); return true }
    if (systemInbox) { setSystemInbox(false); return true }
    if (!user || route.s === 'home') return false
    if (route.s === 'moments') backFromPersonalSpace()
    else backFrom(route)
    return true
  })

  return (
    <ToneCtx.Provider value={pushTone}>
      <NightCtx.Provider value={night}>
      <div className="app-shell min-h-screen w-full flex items-center justify-center py-0 sm:py-8">
        <div ref={frame} onPointerMove={onTilt}
          className={`app-device-frame ${night ? 'night' : ''} ${calm ? 'calm' : ''} relative w-full max-w-[393px] h-[852px] max-h-screen sm:max-h-[calc(100dvh-64px)] bg-abyss overflow-hidden shadow-[0_40px_100px_-30px_rgba(20,40,40,0.55)] ring-1 ring-black/10 sm:rounded-[46px] isolate`}>
          {iris && <ReturnSplash worlds={iris === 'return' ? [...new Set(people.map((p) => p.world))] : []} />}
          <StatusBar tone={barTone} />

          <div ref={content} className="absolute inset-0 z-10" style={contentZoomStyle(zoomed ? ZOOM : 1, legacyZoomBounds)}>
            <div className="absolute inset-0" hidden={switchingAccount} inert={overlayOpen || switchingAccount}>
            {!user && <AuthFlow intro={intro} onDone={finishLogin} />}
            {user && route.s === 'home' && (
              <Home people={people} chats={visibleChats} query={route.query ?? ''}
                giftOwner={draftOwner} onGifts={openGiftHub} onInvite={openInvites}
                onSystem={openSystemInbox} systemCount={giftLedger.usedRewards.length}
                invitePromotion={initialRecommendation === 'invite' ? { unread: canShowRecommendation && recommendation === 'invite', onRead: dismissRecommendation } : undefined}
                onUpdates={initialRecommendation ? () => setUpdatesOpen(true) : undefined}
                onGiftActivity={(id, goalId, receiptId) => openGift(id, goalId ? { goalId } : receiptId ? { tab: 'receipts', receiptId } : {})}
                onQuery={(query) => setRoute({ s: 'home', query })}
                onOpen={openPerson} onGather={openGather} onSeek={() => setRoute({ s: 'seek', from: route })}
                onLetter={(id) => setRoute({ s: 'person', id, letter: true, from: route })} />
            )}
            {user && route.s === 'atlas' && (
              <Atlas people={people} onWorld={openWorld} onOpen={openProfile}
                view={route.view ?? {}} onView={(view) => setRoute({ s: 'atlas', view })}
                onDiscoverSearch={canShowRecommendation && recommendation === 'atlas' ? dismissRecommendation : undefined}
                onSeek={(clue) => setRoute({ s: 'seek', clue, from: route })} />
            )}
            {user && route.s === 'space' && (
              <Moments user={user} people={people} posts={posts} onMySpace={openMySpace} onPost={addPost} onLike={toggleLike} onComment={addComment} onProfile={openProfile} onWorld={(w) => openWorld(w)} />
            )}
            {user && route.s === 'moments' && (
              <Moments user={user} people={people} posts={posts} filter={route.author} giftOwner={draftOwner} focusGiftId={route.focusGiftId}
                onGift={openGift} onBack={backFromPersonalSpace} onPost={addPost} onLike={toggleLike} onComment={addComment} onProfile={openProfile} onWorld={(w) => openWorld(w)} />
            )}
            {user && route.s === 'me' && (
              <MePage user={user} postage={giftLedger.credits} vouchers={giftLedger.entitlements['return-stamp'] ?? 0}
                onNick={(nick) => setUser({ ...user, nick })} onLogout={logout} onSwitchAccount={openAccountSwitch}
                onGifts={openGiftHub} onInvite={openInvites}
                large={large} onToggleLarge={() => setLarge((v) => !v)} readAloud={readAloud} onToggleRead={() => setReadAloud((v) => !v)}
                calm={calm} onToggleCalm={() => setCalm((v) => !v)} haptics={haptics} onToggleHaptics={() => setHaptics((v) => !v)}
                sound={sound} onToggleSound={() => setSound((v) => !v)} theme={theme} onTheme={setTheme} />
            )}
            {user && route.s === 'seek' && (
              <Seek people={people} nick={user.nick} draftOwner={draftOwner} large={large} initialStory={route.clue} onClose={() => backFrom(route)}
                onDone={finishSeeking} />
            )}
            {user && route.s === 'person' && current && (
              <PersonSpace key={JSON.stringify([draftOwner, current.id])} draftOwner={draftOwner} person={current} people={people} chat={visibleChats[String(current.id)]}
                onGift={(options) => openGift(current.id, options)} onReceivedGift={showReceivedGift}
                focusMessageId={route.focusMessageId} origin={route.origin} landed={route.landed} startLetter={route.letter} startCall={route.call} readAloud={readAloud}
                memoryContext={current.memories.find(memory => memory.id === route.memoryId)}
                onDismissMemoryContext={() => setRoute({ ...route, memoryId: undefined })}
                onBack={() => backFrom(route)} onUpdate={(patch) => updatePerson(current.id, patch)}
                onPersistChat={(m) => persistChat(String(current.id), m)} onGather={() => openGather(current.world)}
                onProfile={() => (route.from?.s === 'profile' && route.from.id === current.id ? setRoute(route.from) : openProfile(current.id))}
                onEcho={(m) => setPosts((ps) => [echoForMemory(current, m, lang), ...ps])} />
            )}
            {user && route.s === 'profile' && current && (
              <Profile key={current.id} person={current} people={people} posts={posts} large={large} readAloud={readAloud}
                giftOwner={draftOwner} onGift={(options) => openGift(current.id, options)}
                onBack={() => backFrom(route)}
                onChat={() => (route.from?.s === 'person' && route.from.id === current.id ? setRoute({ ...route.from, origin: undefined, landed: true }) : setRoute({ s: 'person', id: current.id, landed: true, from: route }))}
                onCall={(mode) => setRoute({ s: 'person', id: current.id, landed: true, call: mode, from: route })}
                onSpace={() => setRoute({ s: 'moments', author: current.id, from: route })} onWorld={() => openWorld(current.world, current.id)}
                onUpdate={(patch) => updatePerson(current.id, patch)} onDelete={() => deletePerson(current.id)}
                onEcho={(m) => setPosts((ps) => [echoForMemory(current, m, lang), ...ps])}
                onToggleLarge={() => setLarge((v) => !v)} onToggleRead={() => setReadAloud((v) => !v)} />
            )}
            {user && route.s === 'world' && (
              <WorldView key={route.world} world={route.world} people={people} calm={calm}
                view={route.view} onView={view => setRoute({ ...route, view })}
                onBack={() => backFrom(route)} onOpen={openProfile}
                onTalk={(id, memoryId) => setRoute({ s: 'person', id, memoryId, from: {
                  ...route, view: { ...route.view, personId: id, ...(memoryId === undefined ? {} : { near: true, memoryId }) },
                } })} onGather={() => openGather(route.world)}
                onSeek={() => setRoute({ s: 'seek', from: route })} />
            )}
            {user && route.s === 'gather' && (
              <Gathering key={JSON.stringify([draftOwner, route.world])} draftOwner={draftOwner} focusMessageId={route.focusMessageId} world={route.world} people={people.filter((p) => p.world === route.world)} chat={visibleChats[`g:${route.world}`]}
                onPersist={(m) => persistChat(`g:${route.world}`, m)} onBack={() => backFrom(route)} onOpen={openProfile} />
            )}
            {user && navKey && !iris && <BottomNav active={navKey} dark={navKey === 'atlas' && night} onGo={(s) => setRoute({ s })} />}
            </div>
            {user && switchingAccount && <AuthFlow intro={false} onDone={finishLogin} onCancel={cancelAccountSwitch} />}
            {user && !switchingAccount && updatesOpen && <ProductUpdates onClose={() => setUpdatesOpen(false)} onRecommendation={openRecommendedFeature} />}
            {user && !switchingAccount && rewardNotice && !checkout && !gift && !giftHub && !invites && !systemInbox && <button className="absolute bottom-[96px] left-5 right-5 z-[91] rounded-2xl bg-paper px-4 py-3 text-sm text-ink shadow-lg" onClick={() => { setRewardRetry(value => value + 1); openSystemInbox() }}>{rewardNotice}</button>}
            {user && !switchingAccount && deliveryError && !checkout && <button className="absolute bottom-[96px] left-5 right-5 z-[115] rounded-2xl bg-paper px-4 py-3 text-sm text-ink shadow-lg" onClick={() => { setDeliveryError(false); setDeliveryRetry(value => value + 1) }}>{isZh(lang) ? '回礼暂未保存，点这里重试' : 'The return gift was not saved. Tap to retry.'}</button>}
            <Suspense fallback={<div className="absolute inset-0 z-[100] flex items-center justify-center bg-canvas text-ink-soft">正在打开…</div>}>
              <div hidden={hasGiftReturn(route)} inert={!!checkout}>
                {user && giftHub && <AssetWallet owner={draftOwner} onClose={closeWallet} onPurchase={() => openCheckout('purchase')} onOrders={() => openCheckout('orders')} />}
              </div>
              {user && systemInbox && <SystemInbox owner={draftOwner} onClose={() => setSystemInbox(false)} onAssets={() => { openGiftHub(); setWalletReturnSystem(true) }}/>} 
              {user && invites && <Suspense fallback={<ContextLoading label={isZh(lang) ? '邀请朋友' : 'Invite friends'} onClose={closeInvites} />}><InviteFriends owner={draftOwner} nickname={user.nick} onClose={closeInvites} presentation="sheet"
                onUseReward={gift ? closeInvites : openGiftHub}
                rewardActionLabel={gift ? (isZh(lang) ? '返回继续赠礼' : 'Continue choosing a gift') : undefined} /></Suspense>}
              <div hidden={mySpaceOpen || invites || !!incomingGiftId} inert={!!incomingGiftId || invites || !!checkout}>
              {user && gift && giftPerson && <Suspense fallback={<ContextLoading label={isZh(lang) ? '送礼物' : 'Send a gift'} onClose={closeGift} />}>
              <GiftExperience key={`${gift.session ?? 'resumed'}:${giftPerson.localId}:${gift.options.goalId || ''}:${gift.options.receiptId || ''}`} owner={draftOwner}
                target={{ id: giftPerson.id, identity: giftPerson.localId, name: giftPerson.name, world: giftPerson.world, audience: inferAudience(giftPerson) }}
                initialTab={gift.options.tab} initialGoal={gift.options.goalId} initialReceipt={gift.options.receiptId} initialGift={gift.options.giftId} initialSource={gift.options.source}
                initialPresentation={gift.options.presentation} onQuickSent={finishQuickGift}
                onReceipt={() => { giftReturnReceived.current = null }}
                large={large} onClose={closeGift} onInvite={openInvites} onPurchase={() => openCheckout('purchase')} onVisitSpace={visitGiftSpace} onBackToChat={backToGiftChat} onReceived={showReceivedGift}
                onAdopt={adoptSharedMemory} adopted={giftPerson.memories.flatMap(memory => memory.source ? [`${memory.source.goalId}:${memory.source.seat}`] : [])} /></Suspense>}
              </div>
              {user && mySpaceOpen && <div className="absolute inset-0 z-[106] bg-canvas" role="dialog" aria-modal="true" inert={!!incomingGiftId} aria-label={isZh(lang) ? '我的空间' : 'My space'}>
                <Moments user={user} people={people} posts={posts} filter="me" giftOwner={draftOwner} onReceivedGift={showReceivedGift}
                  onBack={closeMySpace} onPost={addPost} onLike={toggleLike} onComment={addComment} onProfile={openProfile} onWorld={openWorld}/>
              </div>}
              {user && incomingGiftId && <Suspense fallback={<ContextLoading label={isZh(lang) ? '收到的礼物' : 'Received gift'} onClose={() => setIncomingGiftId(null)} />}><ReceivedGiftDetail key={incomingGiftId} owner={draftOwner} id={incomingGiftId}
                onClose={() => setIncomingGiftId(null)} onVisitSpace={visitMyGiftSpace}
                onReturnGift={incomingPerson ? () => { const returnId = incomingGiftId; setIncomingGiftId(null); setMySpaceOpen(false); setMySpaceReturnGiftId(null); openGift(incomingPerson.id, { presentation: 'compact' }, returnId) } : undefined}/></Suspense>} 
              {user && checkout && <Suspense fallback={<ContextLoading label={isZh(lang) ? '购买演示' : 'Purchase preview'} onClose={closeCheckout} />}>
                <CheckoutPreview owner={draftOwner} initialView={checkout} onClose={closeCheckout} />
              </Suspense>}
            </Suspense>
          </div>

          {!native && <div data-preview-home-indicator className="absolute bottom-1.5 inset-x-0 z-[120] flex justify-center pointer-events-none">
            <div className={`h-1 w-32 rounded-full transition-colors duration-500 ${barTone === 'light' ? 'bg-pearl/45' : 'bg-ink/25'}`} />
          </div>}
        </div>
      </div>
      </NightCtx.Provider>
    </ToneCtx.Provider>
  )
}
