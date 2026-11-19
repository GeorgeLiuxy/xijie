import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LangProvider, useI18n, isZh, fmtTime, letterReply, buildReply, type WorldId } from './i18n'
import { accountOwner, accountStateKey, loadState, loadUser, withLocalIdentity, withPersonIdentity, isNight, nid, seedPosts, echoesFor, echoForMemory, STORE, USER_STORE, type Author, type Chats, type Msg, type Person, type Post, type Theme, type User } from './model'
import { I, Toast, ToneCtx, NightCtx, fxPrefs, type BarTone } from './ui'
import { StatusBar, ReturnSplash, AuthFlow, BottomNav, MePage, type EmbeddedAuthControls, type NavKey } from './shell'
import { useIdentitySession, type IdentitySession } from './auth/useIdentitySession'
import { DeletionProgress } from './auth/DataRights'
import { observeDeletionReceipt, readDeletionReceipt } from './auth/dataRightsClient'
import { Atlas, WorldView, type AtlasView, type WorldPlaceView, type Rect } from './home'
import { contentZoomStyle, hasLegacyZoomBounds } from './mobile/layout'
import { Home, ProductUpdates, type HomeRecommendation } from './Conversations'
import { PersonSpace, Gathering } from './person'
import { Profile } from './profile'
import { usePersonPhotoMedia } from './servicePersonPhotos'
import { useServiceGifts, type GiftNotification } from './serviceGifts'
import { useServiceGiftPhotos } from './serviceGiftPhotos'
import { GiftServiceContext, giftNoticeText } from './gifts/giftServiceContext'
import { preparePhotos } from './serviceMedia'
import { Moments } from './moments'
import { Seek } from './seek'
import type { ServicePerson } from './auth/PeopleDraftExperience'
import { displayConfirmedPerson, PeopleReadError, readConfirmedPeople, readConversationWorlds, usePersonManagement, type WorldCard } from './servicePeople'
import { ConversationError, readConversationSummaries, type ConversationSummary } from './serviceConversations'
import type { ConversationAnchor } from './serviceConversationSearch'
import type {StoryBranch} from './serviceStoryControls'
import { useServiceLetters } from './serviceLetters'
import { useServiceMemories } from './serviceMemories'
import { useServiceSocial } from './serviceSocial'
import { clearConversationDraft } from './conversationHistory'
import { inferAudience } from './gifts/catalog'
import { applyGiftReward, getGiftState, receiveGift, openReceivedGift, hasArrived, targetMatchesPerson, receiptMatchesPerson } from './gifts/store'
import { useGiftState, useArrivalClock } from './gifts/GiftLedger'
import { appendGiftMessages, personaReturn } from './gifts/messages'
import { recordPreviewLogin, recordPreviewMemory, syncInviteRewards } from './gifts/client'
import type { GiftOpenOptions, GiftReceipt } from './gifts/types'
import { GiftWishGlow } from './gifts/GiftWishGlow'
import { isNativeRuntime, useNativeBack } from './mobile/back'
import { ContextSheet } from './mobile/ContextSheet'
import { clearCheckoutReturnParameters } from './commerce/checkoutReturn'
import {createAccountProfileClient} from './auth/serviceAccountProfile'
import {useServiceReminders,reminderText} from './serviceReminders'
import {useMemoryImports} from './serviceMemoryImports'
import {ContentReports} from './ContentReports'
import { ChatCaptureClient, chatCaptureAvailable, setChatCaptureIdentity, clearKnownChatCapture } from './mobile/chatCapture'
import { ChatCaptureRecovery } from './mobile/ChatCaptureRecovery'
import { GuestJourney, GuestTransfer, useGuestTransferAvailable } from './GuestJourney'
import { completeGuestPerson } from './guestJournal'

clearCheckoutReturnParameters()

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
  | { s: 'seek'; clue?: string; name?: string; guestId?: string; from?: Route }
  | { s: 'person'; id: number; captureOperationId?: string; captureRequestId?: string; branch?:StoryBranch; origin?: Rect; landed?: boolean; focusMessageId?: number; anchor?: ConversationAnchor; memoryId?: number; letter?: boolean; call?: 'voice' | 'video'; from?: Route }
  | { s: 'profile'; id: number; letterId?: string; from?: Route }
  | { s: 'moments'; author: number; focusGiftId?: string; returnToGift?: { personId: number; options: GiftOpenOptions }; from?: Route }
  | { s: 'world'; world: WorldId; view?: WorldPlaceView; from?: Route }
  | { s: 'gather'; world: WorldId; worldId?: string; focusMessageId?: number; anchor?: ConversationAnchor; from?: Route }

function hasGiftReturn(route: Route): boolean {
  if (route.s === 'moments' && route.returnToGift) return true
  return 'from' in route && route.from ? hasGiftReturn(route.from) : false
}

const ZOOM = 1.14

function withoutGiftMessages(chats: Chats = {}): Chats {
  return Object.fromEntries(Object.entries(chats).map(([key, messages]) => [key, messages.filter(message => message.kind !== 'gift')]))
}

function ServiceApplication() {
  const identity = useIdentitySession()
  const [authMethod,setAuthMethod]=useState<'sms'|'password'>('sms'),[authMessage,setAuthMessage]=useState('')
  const sessionId = identity.view.kind === 'signed-in' ? identity.view.session.id : 'signed-out'
  useEffect(()=>{if(identity.view.kind==='signed-in'){setAuthMethod('sms');setAuthMessage('')}},[sessionId])
  useEffect(()=>{const token=new URLSearchParams(location.search).get('sharedAlbum');if(identity.view.kind==='signed-in'&&token&&/^[A-Za-z0-9_-]{43}$/.test(token))location.assign(import.meta.env.BASE_URL+'gifts/'+token+'?claim=1')},[sessionId])
  const [receipt, setReceipt] = useState(readDeletionReceipt)
  const [dismissedReceipt, setDismissedReceipt] = useState<string>()
  useEffect(() => observeDeletionReceipt(() => setReceipt(readDeletionReceipt())), [])
  const showReceipt = receipt && receipt.receiptId !== dismissedReceipt && ['signed-out', 'unavailable'].includes(identity.view.kind)
  return <AppInner key={sessionId} identity={identity} authEntry={{method:authMethod,message:authMessage,setMethod:setAuthMethod,setMessage:setAuthMessage}} deletionOverlay={showReceipt ? <DeletionProgress key={receipt.receiptId} receipt={receipt} onClose={() => setDismissedReceipt(receipt.receiptId)} /> : undefined} />
}

export default function App() {
  return <LangProvider>{import.meta.env.VITE_XIJIE_AUTH_MODE === 'service' ? <ServiceApplication /> : <AppInner />}</LangProvider>
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

function AppInner({ identity, deletionOverlay, authEntry }: { identity?: IdentitySession; deletionOverlay?: React.ReactNode; authEntry?: {method:'sms'|'password';message:string;setMethod:(method:'sms'|'password')=>void;setMessage:(message:string)=>void} }) {
  const native = isNativeRuntime()
  const { lang, t } = useI18n()
  const serviceMode = identity !== undefined
  const verified = identity?.view.kind === 'signed-in' ? identity.view : null
  const captureIdentity = verified ? { accountId: verified.account.id, sessionId: verified.session.id } : undefined
  setChatCaptureIdentity(captureIdentity)
  const captureKey = captureIdentity ? JSON.stringify([captureIdentity.accountId, captureIdentity.sessionId]) : ''
  const captureScope = useRef(captureKey); captureScope.current = captureKey
  const captureClient = useMemo(() => captureIdentity && chatCaptureAvailable() ? new ChatCaptureClient(captureIdentity, () => captureScope.current === captureKey) : undefined, [captureKey])
  useEffect(() => { if (identity?.view.kind === 'signed-out') void clearKnownChatCapture().catch(() => {}) }, [identity?.view.kind])
  const canSeek = !serviceMode || verified?.account.capabilities?.privateStoryDrafts === true
  const [previewUser, setUser] = useState<User | null>(() => {
    const saved = serviceMode ? null : loadUser()
    return saved ? withLocalIdentity(saved) : null
  })
  const user: User | null = verified ? { phone: '', dial: '', nick: verified.account.displayName } : previewUser
  const [boot] = useState(() => loadState(lang, previewUser ? accountOwner(previewUser) : undefined, !!previewUser))
  const [peopleRecords, setPeople] = useState<Person[]>(boot?.people ?? [])
  const memoryStore = useServiceMemories(verified && identity ? {
    sessionId: verified.session.id, accountId: verified.account.id, onUnauthorized: identity.refresh,
  } : undefined)
  const personPhotoState = usePersonPhotoMedia(verified && identity ? { accountId: verified.account.id, sessionId: verified.session.id, onUnauthorized: identity.refresh } : undefined, peopleRecords.flatMap(person => person.photoTarget ? [{ target: person.photoTarget.id, media: person.photoMedia ?? [] }] : []))
  const people = useMemo(() => serviceMode ? peopleRecords.map(person => ({ ...person,
    avatar: person.photoMedia?.[0] ? personPhotoState.urls[person.photoMedia[0].id] ?? '' : '',
    photos: (person.photoMedia ?? []).map(photo => personPhotoState.urls[photo.id] ?? ''),
    memories: person.serverId ? memoryStore.records[person.serverId] ?? [] : [],
  })) : peopleRecords, [serviceMode, peopleRecords, memoryStore.records, personPhotoState.urls])
  const memoryService = memoryStore.service
  useEffect(() => {
    if (!memoryService) return
    const ids = peopleRecords.flatMap(person => person.serverId ? [person.serverId] : [])
    let reading = false
    const refresh = () => {
      if (reading || document.visibilityState === 'hidden') return
      reading = true; void memoryService.refresh(ids).finally(() => { reading = false })
    }
    refresh()
    const timer = window.setInterval(refresh, 5000)
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh)
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [memoryService, peopleRecords])
  const [peopleLoad, setPeopleLoad] = useState<'loading' | 'ready' | 'error'>(serviceMode && canSeek ? 'loading' : 'ready')
  const peopleRead = useRef<AbortController | null>(null)
  const peopleIds = useRef(new Map<string, number>())
  const [conversationWorlds, setConversationWorlds] = useState<WorldCard[]>([])
  const serviceSessionId = canSeek ? verified?.session.id : undefined
  const refreshIdentity = identity?.refresh
  const personView = useCallback((person: ServicePerson, world: WorldId) => {
    let id = peopleIds.current.get(person.id)
    if (id === undefined) {
      id = nid()
      peopleIds.current.set(person.id, id)
    }
    return displayConfirmedPerson(person, world, id)
  }, [])
  const loadPeople = useCallback(async () => {
    if (!serviceSessionId) return
    peopleRead.current?.abort()
    const controller = new AbortController()
    peopleRead.current = controller
    setPeopleLoad('loading')
    try {
      const [records, worlds] = await Promise.all([readConfirmedPeople(serviceSessionId, controller.signal), readConversationWorlds(serviceSessionId, controller.signal)])
      if (!controller.signal.aborted) {
        setPeople(records.map(({ person, world }) => personView(person, world)))
        setConversationWorlds(worlds)
        setPeopleLoad('ready')
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setPeopleLoad('error')
        if (error instanceof PeopleReadError && error.status === 401) void refreshIdentity?.()
      }
    }
  }, [serviceSessionId, personView, refreshIdentity])
  useEffect(() => {
    void loadPeople()
    return () => peopleRead.current?.abort()
  }, [loadPeople])
  const [chats, setChats] = useState<Chats>(() => withoutGiftMessages(boot?.chats))
  const [conversationSummaries, setConversationSummaries] = useState<ConversationSummary[]>([])
  const summariesRead = useRef<AbortController | null>(null)
  const [posts, setPosts] = useState<Post[]>(boot?.posts ?? [])
  const socialStore = useServiceSocial(verified && identity ? {
    sessionId: verified.session.id, accountId: verified.account.id, onUnauthorized: identity.refresh,
  } : undefined, people)
  const visiblePosts = serviceMode ? socialStore.posts : posts
  const socialService = socialStore.service
  const [large, setLarge] = useState(boot?.large ?? false)
  const [legacyZoomBounds] = useState(hasLegacyZoomBounds)
  const [readAloud, setReadAloud] = useState(boot?.readAloud ?? false)
  const [theme, setTheme] = useState<Theme>(boot?.theme ?? 'auto')
  const [calm, setCalm] = useState(boot?.calm ?? false)
  const [haptics, setHaptics] = useState(boot?.haptics ?? true)
  const [sound, setSound] = useState(boot?.sound ?? false)
  const [route, setRoute] = useState<Route>(() => identity?.arrival === 'same-account' ? { s: 'me' } : { s: 'home' })
  const [guestJourney, setGuestJourney] = useState(false)
  const [guestTransfer, setGuestTransfer] = useState(false)
  const guestTransferAvailable = useGuestTransferAvailable(verified?.account.id)
  const [switchingAccount, setSwitchingAccount] = useState(false)
  const [rightsReturn,setRightsReturn]=useState<{mode:'export'|'delete';requestId:string}>()
  useEffect(()=>{
    if(!verified||!identity?.reauthenticated)return
    try{const key='xijie.identity.rights-return',value=JSON.parse(sessionStorage.getItem(key)??'null');sessionStorage.removeItem(key);if(value&&value.accountId===verified.account.id&&value.sessionId===verified.session.id&&['export','delete'].includes(value.mode)){setRoute({s:'me'});setRightsReturn({mode:value.mode,requestId:crypto.randomUUID()})}}catch{/* No private input or credential is needed to reopen the settings panel. */}
  },[identity?.reauthenticated,verified?.session.id])
  const accountSwitchTrigger = useRef<HTMLButtonElement | null>(null)
  const returnedFromSwitch = identity?.returnedFromSwitch
  const clearReturnedFromSwitch = identity?.clearReturnedFromSwitch
  useEffect(() => {
    if (!returnedFromSwitch || !verified) return
    setRoute({ s: 'me' })
    setSwitchingAccount(true)
    clearReturnedFromSwitch?.()
  }, [returnedFromSwitch, verified, clearReturnedFromSwitch])
  const [recommendation, setRecommendation] = useState(serviceMode ? null : initialRecommendation)
  const dismissRecommendation = useCallback(() => setRecommendation(null), [])
  const [updatesOpen, setUpdatesOpen] = useState(false)
  const [gift, setGift] = useState<{ personId: number; options: GiftOpenOptions; session?: number } | null>(null)
  const [giftHub, setGiftHub] = useState(false)
  const [checkout, setCheckout] = useState<'purchase' | 'orders' | null>(null)
  const [systemInbox, setSystemInbox] = useState(false)
  const giftReturnSystem = useRef(false)
  const incomingReturnSystem = useRef(false)
  const [serviceNotice, setServiceNotice] = useState<string | null>(null)
  const serviceNoticeTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(serviceNoticeTimer.current), [])
  useEffect(() => {
    if (!serviceSessionId || peopleLoad !== 'ready' || route.s !== 'home') return
    let controller = new AbortController()
    summariesRead.current?.abort()
    summariesRead.current = controller
    let reading = false
    let warned = false
    const refresh = () => {
      if (reading || controller.signal.aborted || document.visibilityState === 'hidden') return
      reading = true
      const request = controller
      void readConversationSummaries(serviceSessionId, request.signal).then(async records => {
        const worlds = await readConversationWorlds(serviceSessionId, request.signal, records.flatMap(record => record.kind === 'gather' && record.worldId ? [record.worldId] : []))
        if (request.signal.aborted || request !== controller) return
        warned = false
        setConversationSummaries(records); setConversationWorlds(worlds)
        const next: Chats = {}
        for (const record of records) {
          const id = record.personId ? peopleIds.current.get(record.personId) : undefined
          const message = record.lastMessage
          const call=record.lastCall
          if(id!==undefined&&call&&(!message||call.endedAt>message.createdAt)){next[String(id)]=[{id:nid(),serverId:call.id,kind:'call',mode:'voice',secs:call.durationSeconds,at:Date.parse(call.endedAt),time:fmtTime(lang,new Date(call.endedAt)),canSuggestMemory:false}];continue}
          if (id === undefined || !message) continue
          next[String(id)] = [message.kind === 'photo'
            ? { id: nid(), serverId: message.id, kind: 'photo', at: Date.parse(message.createdAt), time: fmtTime(lang, new Date(message.createdAt)) }
            : { id: nid(), serverId: message.id, kind: message.author?.kind === 'self' ? 'me' : 'him', text: message.preview, at: Date.parse(message.createdAt), time: fmtTime(lang, new Date(message.createdAt)) }]
        }
        setChats(next)
      }).catch(error => {
        if (request.signal.aborted || request !== controller) return
        if ((error instanceof ConversationError || error instanceof PeopleReadError) && error.status === 401) void refreshIdentity?.()
        else if (!warned) {
          warned = true
          window.clearTimeout(serviceNoticeTimer.current)
          setServiceNotice(isZh(lang) ? '暂时无法读取对话，请稍后重试。' : 'Conversations could not be loaded. Try again shortly.')
          serviceNoticeTimer.current = window.setTimeout(() => setServiceNotice(null), 2600)
        }
        if ((error instanceof ConversationError || error instanceof PeopleReadError) && [401, 403].includes(error.status)) { setChats({}); setConversationSummaries([]) }
      }).finally(() => { if (request === controller) reading = false })
    }
    refresh()
    const timer = window.setInterval(refresh, 5000)
    window.addEventListener('focus', refresh)
    const changed = () => {
      controller.abort(); controller = new AbortController(); summariesRead.current = controller
      reading = false; setChats({}); setConversationSummaries([]); refresh()
    }
    window.addEventListener('xijie:consents-changed', changed)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('xijie:consents-changed', changed)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [serviceSessionId, peopleLoad, route.s, lang, refreshIdentity])
  function unavailable(feature?: string): false {
    window.clearTimeout(serviceNoticeTimer.current)
    setServiceNotice(isZh(lang) ? `${feature ?? '这项功能'}暂时无法使用，请稍后再试。` : 'This feature is unavailable right now. Please try again later.')
    serviceNoticeTimer.current = window.setTimeout(() => setServiceNotice(null), 2600)
    return false
  }
  const [walletReturnSystem, setWalletReturnSystem] = useState(false)
  const [incomingGiftId, setIncomingGiftId] = useState<string | null>(null)
  const [mySpaceOpen, setMySpaceOpen] = useState(false)
  useEffect(() => {
    if (!socialService || peopleLoad !== 'ready' || !(mySpaceOpen || ['space', 'moments', 'profile'].includes(route.s))) return
    let reading = false, stopped = false
    const refresh = (announceFailures = false) => {
      if (stopped || reading || document.visibilityState === 'hidden') return
      reading = true; void socialService.refresh(announceFailures).finally(() => { reading = false })
    }
    const wake = () => refresh(true)
    refresh(true)
    const timer = window.setInterval(() => refresh(), 10000)
    window.addEventListener('focus', wake); document.addEventListener('visibilitychange', wake)
    return () => { stopped = true; clearInterval(timer); window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', wake) }
  }, [socialService, peopleLoad, people, route.s, mySpaceOpen])
  const [mySpaceReturnGiftId, setMySpaceReturnGiftId] = useState<string | null>(null)
  const [deliveryError, setDeliveryError] = useState(false)
  const [deliveryRetry, setDeliveryRetry] = useState(0)
  const [invites, setInvites] = useState(false)
  const [giftResume, setGiftResume] = useState<GiftOpenOptions | null>(() => {
    if (serviceMode) return null
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
  const [giftWish, setGiftWish] = useState<{ owner: string; receipt: GiftReceipt } | null>(null)
  const memoryRegistered = useRef(new Set<string>())
  const [iris, setIris] = useState<null | 'return' | 'login'>(() => {
    if (previewUser) return 'return'
    if (verified && (identity?.arrival === 'return' || identity?.arrival === 'login')) return identity.arrival
    return null
  })
  const [intro, setIntro] = useState(() => !user && (identity?.playIntro ?? true))
  const frame = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const night = isNight(theme)
  const draftOwner = verified ? `account.${verified.account.id}` : user ? accountOwner(user) : 'login.undefined'
  const giftContext = verified && identity ? { accountId: verified.account.id, sessionId: verified.session.id, onUnauthorized: identity.refresh } : undefined
  const personReminders=useServiceReminders(giftContext)
  const memoryImports=useMemoryImports(giftContext?{...giftContext,onChanged:id=>memoryService?.refresh([id])}:undefined)
  const accountProfile=useMemo(()=>verified&&identity?createAccountProfileClient({accountId:verified.account.id,sessionId:verified.session.id,onUnauthorized:identity.refresh}):undefined,[verified?.account.id,verified?.session.id])
  const profileScope=useRef(accountProfile);if(profileScope.current!==accountProfile){profileScope.current?.dispose();profileScope.current=accountProfile}
  useEffect(()=>{accountProfile?.activate();return()=>accountProfile?.dispose()},[accountProfile])
  const baseGiftService = useServiceGifts(giftContext, people, gift ? people.find(person => person.id === gift.personId)?.serverId : undefined)
  const giftPhotos = useServiceGiftPhotos(giftContext)
  const giftService = baseGiftService ? { ...baseGiftService, photos: giftPhotos,
    state: { ...baseGiftService.state, receipts: baseGiftService.state.receipts.map(receipt => ({ ...receipt, deliveryPhoto: giftPhotos?.urls[receipt.id] })) } } : undefined
  const previewGiftLedger = useGiftState(draftOwner, !serviceMode)
  const giftLedger = giftService?.state ?? previewGiftLedger
  const visibleChats = useMemo(() => serviceMode ? chats : appendGiftMessages(chats, people, giftLedger, draftOwner, lang, t('talk.note')),
    [serviceMode, chats, people, giftLedger, draftOwner, lang, t])
  const arrivalNow = useArrivalClock(giftLedger.receipts)
  const pendingReplies = useRef(new Set<string>())
  const rewardOwner = useRef(draftOwner)
  rewardOwner.current = draftOwner
  const giftPerson = people.find(person => person.id === gift?.personId)
  const incoming = giftLedger.received?.find(item => item.id === incomingGiftId)
  const incomingPerson = incoming && people.find(person => targetMatchesPerson(incoming.from, person))

  useEffect(() => {
    if (serviceMode || !user) return
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
  }, [serviceMode, giftLedger, arrivalNow, draftOwner, people, lang, user?.localLoginId, deliveryRetry])

  function showReceivedGift(id: string) {
    if (!(giftLedger.received ?? []).some(item => item.id === id)) return
    setIncomingGiftId(id)
    void (giftService ? giftService.openReceived(id) : openReceivedGift(draftOwner, id)).catch(() => { /* The detail keeps the original retry action. */ })
  }
  function closeReceivedGift() {
    setIncomingGiftId(null)
    if (incomingReturnSystem.current) { incomingReturnSystem.current = false; setSystemInbox(true) }
  }
  async function navigateGiftNotification(notification: GiftNotification) {
    if (!giftService) return
    if (notification.target.kind === 'received_gift') {
      await giftService.readReceived(notification.target.id)
      await giftService.readNotification(notification.id)
      setSystemInbox(false); incomingReturnSystem.current = true; setIncomingGiftId(notification.target.id)
      void giftService.openReceived(notification.target.id).catch(() => {})
    } else {
      const receipt = await giftService.readDelivery(notification.target.id)
      const person = people.find(value => value.serverId === receipt.target.identity)
      if (!person) throw new Error('Gift target unavailable')
      await giftService.readNotification(notification.id)
      setSystemInbox(false); openGift(person.id, { tab: 'receipts', receiptId: receipt.id }); giftReturnSystem.current = true
    }
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
    giftReturnSystem.current = false
    const presentation = options.presentation ?? (options.goalId || options.receiptId || options.tab && options.tab !== 'catalog' ? 'full' : 'compact')
    setGift({ personId, options: { ...options, presentation }, session: ++giftSession.current })
  }
  function closeGift() {
    setGift(null)
    const returnId = giftReturnReceived.current
    giftReturnReceived.current = null
    if (returnId && (giftLedger.received ?? []).some(item => item.id === returnId)) setIncomingGiftId(returnId)
    else if (giftReturnSystem.current) setSystemInbox(true)
    giftReturnSystem.current = false
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
    giftReturnSystem.current = false; incomingReturnSystem.current = false
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
    if (serviceMode) return
    try {
      if (giftResume) sessionStorage.setItem(GIFT_RESUME, JSON.stringify(giftResume))
      else sessionStorage.removeItem(GIFT_RESUME)
    } catch { /* The current in-memory selection remains available. */ }
  }, [serviceMode, giftResume])

  useEffect(() => {
    if (serviceMode || !user) return
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
  }, [serviceMode, draftOwner, user?.localLoginId])

  useEffect(() => {
    if (serviceMode || !user) return
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
  }, [serviceMode, draftOwner, user?.localLoginId, rewardRetry])

  function finishSeeking(found: Person) {
    if (serviceMode) return
    const person = withPersonIdentity(found)
    setPeople(current => [...current, person])
    setPosts(current => [...echoesFor(person, lang, true), ...current])
    setRoute({ s: 'person', id: person.id, landed: true, from: { s: 'home' } })
    if (giftResume) {
      setGift({ personId: person.id, options: giftResume })
      setGiftResume(null)
    }
  }
  function finishServiceSeeking(confirmed: ServicePerson, world: WorldId) {
    const person = personView(confirmed, world)
    setPeople(current => [person, ...current.filter(item => item.id !== person.id)])
    if (route.s === 'seek' && route.guestId && verified) {
      void completeGuestPerson(route.guestId, verified.account.id, confirmed.photoTarget?.id ?? confirmed.voiceTarget?.id).catch(() => {
        setServiceNotice(isZh(lang) ? 'TA 已经找到。访客草稿暂未标记完成，可选择已找到的人物继续。'
          : 'You found them. The guest draft could not be marked complete. You can choose the person you just found.')
      })
    }
    setRoute({ s: 'person', id: person.id, landed: true, from: { s: 'home' } })
    void loadPeople()
  }
  function adoptSharedMemory(goalId: string, seat: number, text: string) {
    if (!giftPerson || giftPerson.memories.some(memory => memory.source?.kind === 'shared' && memory.source.goalId === goalId && memory.source.seat === seat)) return
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
    if (serviceMode || !user) return
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
        if (rewardOwner.current === draftOwner) setRewardNotice('记忆已保存，邀请奖励的进度稍后会更新。')
      })
    }
  }, [serviceMode, people, chats, posts, draftOwner, user?.nick])
  useEffect(() => {
    if (serviceMode) return
    try { if (previewUser) localStorage.setItem(USER_STORE, JSON.stringify(previewUser)); else localStorage.removeItem(USER_STORE) } catch { /* 忽略 */ }
  }, [serviceMode, previewUser])

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
    if (serviceMode) return
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
  }, [serviceMode, lang])

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
  useEffect(() => { if (!serviceMode) setPosts((ps) => seedPosts(ps, people, lang)) }, [serviceMode, people, lang])
  const reactTimers = useRef<number[]>([])
  useEffect(() => () => { reactTimers.current.forEach(clearTimeout); reactTimers.current = [] }, [draftOwner])
  const later = (ms: number, fn: () => void) => { reactTimers.current.push(window.setTimeout(fn, ms)) }
  const patchPost = (id: number, fn: (p: Post) => Post) => setPosts((ps) => ps.map((p) => (p.id === id ? fn(p) : p)))
  const addPost = (text: string, images: string[]) => {
    if (serviceMode) return socialService?.post(text, images) ?? unavailable('发布动态')
    const post: Post = { id: nid(), author: 'me', kind: 'mine', text, images, at: Date.now(), likes: [], comments: [] }
    setPosts((ps) => [post, ...ps])
    // 联系人陆续来点赞、评论（AI 生成，评论带标注）
    ;[...people].sort(() => Math.random() - 0.5).slice(0, 2).forEach((p, i) => {
      later(1800 + i * 2400, () => patchPost(post.id, (x) => (x.likes.includes(p.id) ? x : { ...x, likes: [...x.likes, p.id] })))
      later(3200 + i * 2600, () => patchPost(post.id, (x) => ({ ...x, comments: [...x.comments, { id: nid(), author: p.id, text: buildReply(lang, p, text || '…').text, ai: true, at: Date.now() }] })))
    })
  }
  const toggleLike = (id: number) => {
    if (serviceMode) return socialService?.like(id) ?? unavailable('动态互动')
    patchPost(id, (x) => ({ ...x, likes: x.likes.includes('me') ? x.likes.filter((a) => a !== 'me') : [...x.likes, 'me'] }))
  }
  const addComment = (id: number, text: string, to?: Author, replyToCommentId?: string) => {
    if (serviceMode) return socialService?.comment(id, text, replyToCommentId) ?? unavailable('动态评论')
    const post = posts.find((p) => p.id === id); if (!post) return
    patchPost(id, (x) => ({ ...x, comments: [...x.comments, { id: nid(), author: 'me', text, to, at: Date.now() }] }))
    const replier = typeof to === 'number' ? people.find((p) => p.id === to) : typeof post.author === 'number' ? people.find((p) => p.id === post.author) : undefined
    if (replier) later(2200, () => patchPost(id, (x) => ({ ...x, comments: [...x.comments, { id: nid(), author: replier.id, text: buildReply(lang, replier, text).text, to: 'me', ai: true, at: Date.now() }] })))
  }

  /* ------------------------------ 导航 ------------------------------ */
  const zoomed = !switchingAccount && large && ['home', 'space', 'atlas', 'me', 'person', 'profile', 'moments', 'world', 'gather'].includes(route.s)
  const openPerson = (id: number, focusMessageId?: number, anchor?: ConversationAnchor) => {
    setRoute({ s: 'person', id, focusMessageId, anchor, from: route })
  }
  const openWorld = (world: WorldId, personId?: number) => setRoute({ s: 'world', world, view: personId === undefined ? undefined : { personId }, from: route })
  const openGather = (world: WorldId, focusMessageId?: number, anchor?: ConversationAnchor, worldId?: string) => {
    setRoute({ s: 'gather', world, worldId, focusMessageId, anchor, from: route })
  }
  const openProfile = (id: number) => setRoute({ s: 'profile', id, from: route })
  const backFrom = (r: Route) => setRoute(('from' in r && r.from) ? r.from : { s: 'home' })
  const updatePerson = (id: number, patch: Partial<Person>) => {
    if (serviceMode) return unavailable('此项资料保存')
    setPeople((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }
  const deletePerson = (id: number) => {
    if (gift?.personId === id) setGift(null)
    clearConversationDraft(draftOwner, serviceMode ? people.find(person => person.id === id)?.serverId ?? id : id)
    setPeople((ps) => ps.filter((p) => p.id !== id))
    setChats((c) => { const { [String(id)]: _drop, ...rest } = c; return rest })
    setPosts((ps) => ps.filter((x) => x.author !== id).map((x) => ({ ...x, likes: x.likes.filter((a) => a !== id), comments: x.comments.filter((c) => c.author !== id) })))
    setRoute({ s: 'home' })
  }
  const persistChat = (key: string, msgs: Msg[]) => {
    if (serviceMode) return
    setChats((c) => ({ ...c, [key]: msgs.filter(message => message.kind !== 'gift') }))
  }
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
  async function cancelHostedSwitch() {
    if (!identity || identity.action) return
    if (identity.pending && !await identity.perform('cancel')) return
    cancelAccountSwitch()
  }
  function openSeek(clue?: string) {
    if (canSeek) setRoute({ s: 'seek', clue, from: route })
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
    if (identity) { void identity.perform('logout'); return }
    giftReturnReceived.current = null
    setGift(null); setGiftHub(false); setInvites(false); setGiftResume(null); setRewardNotice('')
    setIncomingGiftId(null); setMySpaceOpen(false); setMySpaceReturnGiftId(null); setSystemInbox(false); setDeliveryError(false)
    setPeople([]); setChats({}); setConversationSummaries([]); setConversationWorlds([]); setPosts([]); setCheckout(null); setUpdatesOpen(false)
    setUser(null); setRoute({ s: 'home' })
  }

  const current = route.s === 'person' || route.s === 'profile' ? people.find((p) => p.id === route.id) : undefined
  const letterStore = useServiceLetters(verified && identity && current?.serverId ? {
    accountId: verified.account.id, sessionId: verified.session.id, personId: current.serverId, onUnauthorized: identity.refresh,
  } : undefined)
  const currentWithLetters = current && serviceMode ? { ...current, letters: letterStore.letters(lang) } : current
  const managedPerson = usePersonManagement(serviceSessionId, current, {
    accountId:verified?.account.id,
    beforeWrite: () => { peopleRead.current?.abort(); setPeopleLoad('ready') },
    onUnauthorized: () => { void refreshIdentity?.() },
    onSaved: (saved, world) => {
      const updated = personView(saved, world)
      setPeople(previous => previous.map(person => person.id === updated.id &&
        (person.serverVersion ?? 0) <= saved.version ? updated : person))
    },
    onRemoved: deletePerson,
  }, { client: personPhotoState.client, prepare: preparePhotos })
  useEffect(() => { if ((route.s === 'person' || route.s === 'profile') && !current) setRoute({ s: 'home' }) }, [route, current])
  const navKey: NavKey | null = route.s === 'home' || route.s === 'space' || route.s === 'atlas' || route.s === 'me' ? route.s : null
  const overlayOpen = !!checkout || giftHub || systemInbox || invites || !!gift || !!incomingGiftId || mySpaceOpen || updatesOpen || guestJourney || guestTransfer
  const canShowRecommendation = !serviceMode && !iris && !overlayOpen && !rewardNotice && !deliveryError
  const checkingSession = identity?.view.kind === 'checking'
  const embedded: EmbeddedAuthControls | undefined = identity && {
    state: identity.view.kind === 'unavailable' ? 'unavailable' : 'ready',
    providers:identity.providers,
    startProvider:(provider,signal)=>identity.startProvider(provider,switchingAccount?'switch':'sign_in',signal),
    cancelProvider:identity.cancelProvider,
    requestCode: (dial, phone, signal) => identity.requestCode(switchingAccount ? 'switch' : 'sign_in', dial, phone, signal),
    verifyCode: identity.verifyCode,
    onComplete: identity.completeEmbedded,
    onRetry: () => { void identity.refresh() },
    password: identity.password,
    purpose: switchingAccount ? 'switch' : 'sign_in',
    onPasswordComplete: identity.completePassword,
    providerPending: !!identity.pending?.native,
    providerProgress: identity.providerProgress,
  }

  useNativeBack(() => {
    if (checkout) { closeCheckout(); return true }
    if (invites) { closeInvites(); return true }
    if (incomingGiftId) { closeReceivedGift(); return true }
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
    <GiftServiceContext.Provider value={giftService}>
    <ToneCtx.Provider value={pushTone}>
      <NightCtx.Provider value={night}>
      <div className="app-shell min-h-screen w-full flex items-center justify-center py-0 sm:py-8">
        <div ref={frame} onPointerMove={onTilt}
          className={`app-device-frame ${night ? 'night' : ''} ${calm ? 'calm' : ''} relative w-full max-w-[393px] h-[852px] max-h-screen sm:max-h-[calc(100dvh-64px)] bg-abyss overflow-hidden shadow-[0_40px_100px_-30px_rgba(20,40,40,0.55)] ring-1 ring-black/10 sm:rounded-[46px] isolate`}>
          <ContentReports context={giftContext}>
          {(iris || checkingSession) && <ReturnSplash worlds={iris === 'return' ? [...new Set(people.map((p) => p.world))] : []} />}
          <StatusBar tone={checkingSession ? 'light' : barTone} />

          <div ref={content} className="absolute inset-0 z-10" style={contentZoomStyle(zoomed ? ZOOM : 1, legacyZoomBounds)}>
            <div className="absolute inset-0" hidden={switchingAccount} inert={overlayOpen || switchingAccount}>
            {checkingSession && <p role="status" className="sr-only">{isZh(lang) ? '正在确认会话…' : 'Checking your session…'}</p>}
            {!user && !checkingSession && (embedded ? <AuthFlow intro={intro} embedded={embedded} method={authEntry?.method} onMethodChange={method=>{authEntry?.setMethod(method);authEntry?.setMessage('')}} message={authEntry?.message} onGuest={() => setGuestJourney(true)} /> : <AuthFlow intro={intro} onDone={finishLogin} />)}
            {user && route.s === 'home' && (
              <Home people={people} chats={visibleChats} query={route.query ?? ''} serviceAccount={serviceMode} canSeek={canSeek}
                searchSession={verified && identity ? { accountId: verified.account.id, sessionId: verified.session.id, onUnauthorized: identity.refresh } : undefined}
                peopleLoad={peopleLoad} onRetryPeople={() => { void loadPeople() }}
                giftOwner={draftOwner} onGifts={openGiftHub} onInvite={openInvites}
                onSystem={openSystemInbox} systemCount={giftService ? giftService.totalCount+personReminders.snapshot.notices.length : giftLedger.usedRewards.length}
                systemPreview={giftService ? personReminders.snapshot.notices[0]&&(!giftService.notifications[0]||Date.parse(personReminders.snapshot.notices[0].createdAt)>Date.parse(giftService.notifications[0].createdAt))?reminderText(personReminders.snapshot.notices[0],isZh(lang)):giftService.notifications[0] ? giftNoticeText(giftService.notifications[0].type, isZh(lang)) : isZh(lang) ? '查看通知' : 'View notices' : undefined}
                invitePromotion={initialRecommendation === 'invite' ? { unread: canShowRecommendation && recommendation === 'invite', onRead: dismissRecommendation } : undefined}
                onUpdates={initialRecommendation ? () => setUpdatesOpen(true) : undefined}
                onGiftActivity={(id, goalId, receiptId) => openGift(id, goalId ? { goalId } : receiptId ? { tab: 'receipts', receiptId } : {})}
                onQuery={(query) => setRoute({ s: 'home', query })}
                onOpen={openPerson} onGather={openGather} onSeek={() => openSeek()} conversationSummaries={conversationSummaries} conversationWorlds={conversationWorlds}
                onGuestTransfer={guestTransferAvailable && memoryService ? () => setGuestTransfer(true) : undefined}
                onLetter={(id) => setRoute({ s: 'person', id, letter: true, from: route })}
                onReadLetterReply={(id, letterId) => setRoute({ s: 'profile', id, letterId, from: route })} />
            )}
            {user && route.s === 'atlas' && (
              <Atlas people={people} memoryService={memoryService} onWorld={openWorld} onOpen={openProfile}
                view={route.view ?? {}} onView={(view) => setRoute({ s: 'atlas', view })}
                onDiscoverSearch={canShowRecommendation && recommendation === 'atlas' ? dismissRecommendation : undefined}
                onSeek={openSeek} />
            )}
            {user && route.s === 'space' && (
              <Moments user={user} people={people} posts={visiblePosts} onMySpace={openMySpace} onPost={addPost} onRemove={serviceMode ? socialService?.remove : undefined} readPhoto={serviceMode ? socialService?.readPhoto : undefined}
                onLike={toggleLike} onComment={addComment} onProfile={openProfile} onWorld={(w) => openWorld(w)} />
            )}
            {user && route.s === 'moments' && (
              <Moments user={user} people={people} posts={visiblePosts} filter={route.author} giftOwner={draftOwner} focusGiftId={route.focusGiftId}
                onGift={openGift} onBack={backFromPersonalSpace} onPost={addPost} onRemove={serviceMode ? socialService?.remove : undefined} readPhoto={serviceMode ? socialService?.readPhoto : undefined} onLike={toggleLike} onComment={addComment} onProfile={openProfile} onWorld={(w) => openWorld(w)} />
            )}
            {user && route.s === 'me' && (
              <MePage user={user} postage={serviceMode && giftService?.status !== 'ready' ? undefined : giftLedger.credits} vouchers={serviceMode && giftService?.status !== 'ready' ? undefined : giftLedger.entitlements['return-stamp'] ?? 0}
                serviceAccount={serviceMode} accountBusy={!!identity?.action} accountNotice={identity?.notice}
                aiPermission={verified && identity ? { sessionId: verified.session.id, onUnauthorized: identity.refresh, onChanged: loadPeople } : undefined}
                dataRights={verified && identity ? { sessionId: verified.session.id, accountId: verified.account.id, onUnauthorized: identity.refresh } : undefined}
                authentication={verified&&identity?{service:{...identity.password,changed:async()=>{authEntry?.setMethod('password');authEntry?.setMessage(isZh(lang)?'密码已更新，请重新登录。':'Password updated. Please sign in again.');await identity.password.changed()}},providers:identity.providers,reauthenticate:(provider,signal)=>identity.startProvider(provider,'reauthenticate',signal),completed:identity.reauthenticated}:undefined}
                rightsReturn={rightsReturn} onRightsReturnConsumed={id=>setRightsReturn(value=>value?.requestId===id?undefined:value)}
                onNick={serviceMode ? async nick=>{if(!accountProfile)return false;await accountProfile.update(nick);await identity?.refresh();return true} : (nick) => setUser({ ...user, nick })} onLogout={logout} onSwitchAccount={openAccountSwitch}
                onUnavailable={() => { unavailable('账号资料修改') }} onGifts={openGiftHub} onInvite={openInvites}
                large={large} onToggleLarge={() => setLarge((v) => !v)} readAloud={readAloud} onToggleRead={() => setReadAloud((v) => !v)}
                calm={calm} onToggleCalm={() => setCalm((v) => !v)} haptics={haptics} onToggleHaptics={() => setHaptics((v) => !v)}
                sound={sound} onToggleSound={() => setSound((v) => !v)} theme={theme} onTheme={setTheme} />
            )}
            {user && route.s === 'seek' && canSeek && (
              <Seek people={people} nick={user.nick} draftOwner={draftOwner} large={large} initialName={route.name} initialStory={route.clue} onClose={() => backFrom(route)}
                serviceDraft={verified && identity ? { accountId: verified.account.id, sessionId: verified.session.id, guestId: route.guestId, onUnauthorized: identity.refresh, onConfirmed: finishServiceSeeking } : undefined}
                onDone={finishSeeking} />
            )}
            {user && route.s === 'person' && current && (
              <PersonSpace key={JSON.stringify([draftOwner, current.id,route.branch?.id])} serviceAccount={serviceMode} draftOwner={draftOwner} person={route.branch?{...currentWithLetters!,world:route.branch.scene.world.code}:currentWithLetters!} people={people} chat={route.branch?undefined:visibleChats[String(current.id)]}
                letterService={letterStore.service}
                memoryService={memoryService}
                serviceConversation={verified && identity && current.serverId ? {
                  sessionId: verified.session.id, accountId: verified.account.id, personId: current.serverId,
                  chatCapture: captureClient,
                  storyBranchId:route.branch?.id,storyBranchName:route.branch?.name,
                  anchor: route.anchor,
                  onUnauthorized: identity.refresh, onMissing: () => { void loadPeople() },
                  onMessages: messages => {
                    if(route.branch)return
                    summariesRead.current?.abort()
                    setChats(previous => ({ ...previous, [String(current.id)]: messages }))
                  },
                } : undefined}
                onGift={(options) => openGift(current.id, options)} onReceivedGift={showReceivedGift}
                captureOperationId={route.captureOperationId} captureRequestId={route.captureRequestId} onCaptureConsumed={requestId => setRoute(previous => previous.s === 'person' && previous.captureRequestId === requestId ? { ...previous, captureOperationId: undefined, captureRequestId: undefined } : previous)}
                focusMessageId={route.focusMessageId} origin={route.origin} landed={route.landed} startLetter={route.letter} startCall={route.call} readAloud={readAloud}
                memoryContext={current.memories.find(memory => memory.id === route.memoryId)}
                onDismissMemoryContext={() => setRoute({ ...route, memoryId: undefined })}
                onBack={() => backFrom(route)} onUpdate={(patch) => updatePerson(current.id, patch)}
                onPersistChat={(m) => persistChat(String(current.id), m)} onGather={() => openGather(current.world)}
                onProfile={() => (route.from?.s === 'profile' && route.from.id === current.id ? setRoute(route.from) : openProfile(current.id))}
                onEcho={(m) => { if (serviceMode) { unavailable('珍藏记忆'); return }; setPosts((ps) => [echoForMemory(current, m, lang), ...ps]) }} />
            )}
            {user && route.s === 'profile' && current && (
              <Profile key={current.id} person={currentWithLetters!} people={people} posts={visiblePosts} large={large} readAloud={readAloud} serviceAccount={serviceMode}
                reminderService={personReminders.client}
                memoryImports={memoryImports}
                letterService={letterStore.service} letterSnapshot={letterStore.snapshot} initialLetterId={route.letterId}
                memoryService={memoryService}
                giftOwner={draftOwner} onGift={(options) => openGift(current.id, options)}
                onBack={() => backFrom(route)}
                onChat={() => (route.from?.s === 'person' && route.from.id === current.id ? setRoute({ ...route.from, origin: undefined, landed: true }) : setRoute({ s: 'person', id: current.id, landed: true, from: route }))}
                onCall={(mode) => setRoute({ s: 'person', id: current.id, landed: true, call: mode, from: route })}
                onSpace={() => setRoute({ s: 'moments', author: current.id, from: route })} onWorld={() => openWorld(current.world, current.id)}
                onUpdate={(patch) => updatePerson(current.id, patch)} onDelete={() => deletePerson(current.id)} managed={managedPerson}
                onEcho={(m) => { if (serviceMode) { unavailable('珍藏记忆'); return }; setPosts((ps) => [echoForMemory(current, m, lang), ...ps]) }}
                onToggleLarge={() => setLarge((v) => !v)} onToggleRead={() => setReadAloud((v) => !v)} />
            )}
            {user && route.s === 'world' && (
              <WorldView key={route.world} world={route.world} people={people} memoryService={memoryService} calm={calm} serviceContext={giftContext}
                giftOwner={draftOwner} onGiftReceipt={(personId, receiptId) => openGift(personId, { tab: 'receipts', receiptId })}
                onStory={(id,branch)=>setRoute({s:'person',id,branch,landed:true,from:route})}
                view={route.view} onView={view => setRoute({ ...route, view })}
                onBack={() => backFrom(route)} onOpen={openProfile}
                onTalk={(id, memoryId) => setRoute({ s: 'person', id, memoryId, from: {
                  ...route, view: { ...route.view, personId: id, ...(memoryId === undefined ? {} : { near: true, memoryId }) },
                } })} onGather={() => openGather(route.world)}
                onSeek={() => openSeek()} />
            )}
            {user && route.s === 'gather' && (
              <Gathering key={JSON.stringify([draftOwner, route.world])} serviceAccount={serviceMode} draftOwner={draftOwner} focusMessageId={route.focusMessageId} world={route.world} people={people.filter((p) => p.world === route.world)} allPeople={people} chat={visibleChats[`g:${route.world}`]}
                serviceConversation={verified && identity && (route.worldId || conversationWorlds.some(world => world.code === route.world)) ? {
                  accountId: verified.account.id, sessionId: verified.session.id, target: { kind: 'gather', worldId: route.worldId ?? conversationWorlds.find(world => world.code === route.world)!.id },
                  anchor: route.anchor, onUnauthorized: identity.refresh,
                } : undefined}
                onPersist={(m) => persistChat(`g:${route.world}`, m)} onBack={() => backFrom(route)} onOpen={openProfile} />
            )}
            {captureClient && <ChatCaptureRecovery key={captureKey} client={captureClient} people={people} ready={peopleLoad === 'ready'} onContinue={capture => { const original = people.find(person => person.serverId === capture.owner.personId); if (original) setRoute({ s: 'person', id: original.id, captureOperationId: capture.operationId, captureRequestId: captureClient.operationId(), landed: true, from: { s: 'home' } }) }} />}
            {user && navKey && !iris && <BottomNav active={navKey} dark={navKey === 'atlas' && night} onGo={(s) => setRoute({ s })} />}
            </div>
            {user && switchingAccount && (embedded
              ? <AuthFlow intro={false} embedded={embedded!} method={authEntry?.method} onMethodChange={method=>{authEntry?.setMethod(method);authEntry?.setMessage('')}} message={authEntry?.message} onCancel={() => { void cancelHostedSwitch() }} />
              : <AuthFlow intro={false} onDone={finishLogin} onCancel={cancelAccountSwitch} />)}
            {user && !switchingAccount && updatesOpen && <ProductUpdates onClose={() => setUpdatesOpen(false)} onRecommendation={openRecommendedFeature} />}
            {user && !switchingAccount && rewardNotice && !checkout && !gift && !giftHub && !invites && !systemInbox && <button className="absolute bottom-[96px] left-5 right-5 z-[91] rounded-2xl bg-paper px-4 py-3 text-sm text-ink shadow-lg" onClick={() => { setRewardRetry(value => value + 1); openSystemInbox() }}>{rewardNotice}</button>}
            {user && !switchingAccount && deliveryError && !checkout && <button className="absolute bottom-[96px] left-5 right-5 z-[115] rounded-2xl bg-paper px-4 py-3 text-sm text-ink shadow-lg" onClick={() => { setDeliveryError(false); setDeliveryRetry(value => value + 1) }}>{isZh(lang) ? '回礼暂未保存，点这里重试' : 'The return gift was not saved. Tap to retry.'}</button>}
            <Suspense fallback={<div className="absolute inset-0 z-[100] flex items-center justify-center bg-canvas text-ink-soft">正在打开…</div>}>
              <div hidden={hasGiftReturn(route)} inert={!!checkout}>
                {user && giftHub && <AssetWallet owner={draftOwner} onClose={closeWallet} onPurchase={() => openCheckout('purchase')} onOrders={() => openCheckout('orders')} />}
              </div>
              {user && systemInbox && <SystemInbox owner={draftOwner} onClose={() => setSystemInbox(false)} onAssets={() => { openGiftHub(); setWalletReturnSystem(true) }} onNavigate={giftService ? navigateGiftNotification : undefined} reminders={personReminders} onReminder={notice=>{const person=people.find(p=>p.serverId===notice.personId);if(person){setSystemInbox(false);openProfile(person.id)}}}/>}
              {user && invites && <Suspense fallback={<ContextLoading label={isZh(lang) ? '邀请朋友' : 'Invite friends'} onClose={closeInvites} />}><InviteFriends owner={draftOwner} nickname={user.nick} onClose={closeInvites} presentation="sheet" serviceContext={giftContext}
                onUseReward={gift ? closeInvites : openGiftHub}
                rewardActionLabel={gift ? (isZh(lang) ? '返回继续赠礼' : 'Continue choosing a gift') : undefined} /></Suspense>}
              <div hidden={mySpaceOpen || invites || !!incomingGiftId} inert={!!incomingGiftId || invites || !!checkout}>
              {user && gift && giftPerson && <Suspense fallback={<ContextLoading label={isZh(lang) ? '送礼物' : 'Send a gift'} onClose={closeGift} />}>
              <GiftExperience key={`${gift.session ?? 'resumed'}:${giftPerson.localId}:${gift.options.goalId || ''}:${gift.options.receiptId || ''}`} owner={draftOwner} serviceContext={giftContext} onServiceAdopted={()=>{if(giftPerson.serverId)void memoryService?.refresh([giftPerson.serverId])}}
                target={{ id: giftPerson.id, identity: serviceMode ? giftPerson.serverId : giftPerson.localId, name: giftPerson.name, world: giftPerson.world, audience: serviceMode ? 'person' : inferAudience(giftPerson) }}
                initialTab={gift.options.tab} initialGoal={gift.options.goalId} initialReceipt={gift.options.receiptId} initialGift={gift.options.giftId} initialSource={gift.options.source}
                initialPresentation={gift.options.presentation} onQuickSent={finishQuickGift}
                onReceipt={receipt => {
                  giftReturnReceived.current = null
                  if (giftService) setGiftWish({ owner: draftOwner, receipt })
                }}
                large={large} onClose={closeGift} onInvite={openInvites} onPurchase={() => openCheckout('purchase')} onVisitSpace={visitGiftSpace} onBackToChat={backToGiftChat} onReceived={showReceivedGift}
                onAdopt={adoptSharedMemory} adopted={giftPerson.memories.flatMap(memory => memory.source?.kind === 'shared' ? [`${memory.source.goalId}:${memory.source.seat}`] : [])} /></Suspense>}
              </div>
              {user && mySpaceOpen && <div className="absolute inset-0 z-[106] bg-canvas" role="dialog" aria-modal="true" inert={!!incomingGiftId} aria-label={isZh(lang) ? '我的空间' : 'My space'}>
                <Moments user={user} people={people} posts={visiblePosts} filter="me" giftOwner={draftOwner} onReceivedGift={showReceivedGift}
                  onBack={closeMySpace} onPost={addPost} onRemove={serviceMode ? socialService?.remove : undefined} readPhoto={serviceMode ? socialService?.readPhoto : undefined} onLike={toggleLike} onComment={addComment} onProfile={openProfile} onWorld={openWorld}/>
              </div>}
              {user && incomingGiftId && <Suspense fallback={<ContextLoading label={isZh(lang) ? '收到的礼物' : 'Received gift'} onClose={closeReceivedGift} />}><ReceivedGiftDetail key={incomingGiftId} owner={draftOwner} id={incomingGiftId}
                onClose={closeReceivedGift} onVisitSpace={visitMyGiftSpace}
                onReturnGift={incomingPerson ? () => { const returnId = incomingGiftId; setIncomingGiftId(null); setMySpaceOpen(false); setMySpaceReturnGiftId(null); openGift(incomingPerson.id, { presentation: 'compact' }, returnId) } : undefined}/></Suspense>}
              {user && checkout && <Suspense fallback={<ContextLoading label={isZh(lang) ? serviceMode ? '购买邮资' : '购买演示' : serviceMode ? 'Buy postage' : 'Purchase preview'} onClose={closeCheckout} />}>
                {serviceMode && !giftContext ? <ContextLoading label={isZh(lang) ? '订单记录' : 'Order history'} onClose={closeCheckout} /> : <CheckoutPreview owner={draftOwner} initialView={checkout} onClose={closeCheckout} serviceContext={giftContext} onChanged={() => void giftService?.refresh()} onUnavailable={() => unavailable('购买')} />}
              </Suspense>}
            </Suspense>
            {!user && guestJourney && <GuestJourney onClose={() => setGuestJourney(false)} onSignIn={() => { setIntro(false); setGuestJourney(false) }} />}
            {verified && guestTransfer && memoryService && <GuestTransfer accountId={verified.account.id} accountLabel={user?.nick ?? verified.account.displayName}
              people={people} service={memoryService} onClose={() => setGuestTransfer(false)} onSeek={seed => {
                if (!canSeek) { unavailable('寻找 TA'); return }
                setGuestTransfer(false)
                setRoute({ s: 'seek', name: seed.name, clue: seed.story, guestId: seed.guestId, from: route })
              }} />}
            {deletionOverlay}
          </div>

          <GiftWishGlow owner={draftOwner} receipt={giftWish?.owner === draftOwner ? giftWish.receipt : undefined} calm={calm} />
          {!native && <div data-preview-home-indicator className="absolute bottom-1.5 inset-x-0 z-[120] flex justify-center pointer-events-none">
            <div className={`h-1 w-32 rounded-full transition-colors duration-500 ${barTone === 'light' ? 'bg-pearl/45' : 'bg-ink/25'}`} />
          </div>}
          {(serviceNotice || memoryStore.notice || socialStore.notice) && <div className="pointer-events-none absolute inset-0 z-[150]"><Toast key={!serviceNotice && !memoryStore.notice ? socialStore.noticeId : undefined} text={serviceNotice ?? memoryStore.notice ?? socialStore.notice!} dark={night} action={!serviceNotice && !memoryStore.notice ? socialStore.noticeAction : undefined} /></div>}
          </ContentReports>
        </div>
      </div>
      </NightCtx.Provider>
    </ToneCtx.Provider>
    </GiftServiceContext.Provider>
  )
}
