import { socialPhotoDataUrl } from './serviceMedia'
import {useContentReports} from './ContentReports'
import {browserRecognition,startVoiceInput,VoiceInputError} from './voiceInput'
import {MemoryImport} from './MemoryImport'
import {PersonVoiceInput} from './PersonVoiceInput'
import type {MemoryImportService} from './serviceMemoryImports'
import { PrivatePhoto, type ReadPrivatePhoto } from './PrivatePhoto'
import type { PhotoChoice } from './servicePersonPhotos'
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Gift } from '@phosphor-icons/react'
import {
  useI18n, STORY_IMG, lg, fmtTime, fmtDate, fmtDuration, speechLang, quickReplies, buildReply, photoReply, callLines,
  letterReply, extract, worldWeather, FACE_ALBUM, WORLD_IDS, isZh, type Lang, type WorldId,
} from './i18n'
import { nid, clarity, fileToDataUrl, nextMorning, isTomorrow, type Letter, type Memory, type Msg, type Person } from './model'
import { useConversationDraft, useConversationHistory } from './conversationHistory'
import { useServiceConversation, type ServiceConversation } from './serviceConversations'
import {useVoiceCall,useVoiceCallRecords,type VoiceCallContext} from './voiceCalls'
import {VoiceCallsPermission} from './auth/AiTextPermission'
import {StoryReview} from './world/StoryControls'
import { useThreadScroll } from './useThreadScroll'
import { letterMessage, letterView, type LetterDraft, type LetterService } from './serviceLetters'
import { WORLDS, WorldScene, HorizonSignal, Arrival, LetterGlyph } from './worlds'
import { DeepField, Lens, ArcRing } from './fx'
import { I, Sheet, Toast, Switch, AiBadge, haptic, chime, fxPrefs, useStatusTone, NightCtx } from './ui'
import type { Rect } from './home'
import { GiftMessageCard } from './gifts/GiftMessageCard'
import type { GiftOpenOptions } from './gifts/types'
import { useNativeBack } from './mobile/back'
import { MemoryReader } from './MemoryReader'
import { CallInterestSheet } from './CallInterestSheet'
import { ChatReplySpeech } from './ChatReplySpeech'
import { MemoryCandidateError, type MemoryCandidateBinding, type MemoryService, type MemorySource } from './serviceMemories'
import './chat-theme.css'
import './gather-theme.css'

/* ------------------------------------------------------------------ *
 * 人物页：说话 / 空间 是同一个世界的两种镜头距离
 * ------------------------------------------------------------------ */

export function speak(text: string, lang: Lang, pitch = 1) {
  try {
    const synth = window.speechSynthesis; if (!synth) return
    synth.cancel()
    const u = new SpeechSynthesisUtterance(text); u.lang = speechLang(lang); u.rate = 0.95; u.pitch = pitch
    synth.speak(u)
  } catch { /* 原型环境可能不支持 */ }
}

export function PersonSpace({ person, people, chat, draftOwner, origin, landed, startLetter, startCall, captureOperationId, captureRequestId, onCaptureConsumed, focusMessageId, memoryContext, onDismissMemoryContext, readAloud, onBack, onUpdate, onPersistChat, onGather, onGift, onReceivedGift, onProfile, onEcho, serviceAccount = false, serviceConversation, memoryService, letterService }: {
  person: Person; people: Person[]; chat?: Msg[]; draftOwner: string; origin?: Rect; landed?: boolean; startLetter?: boolean; startCall?: 'voice' | 'video'; focusMessageId?: number; readAloud: boolean
  memoryContext?: Memory; onDismissMemoryContext?: () => void; serviceAccount?: boolean; serviceConversation?: ServiceConversation; memoryService?: MemoryService; letterService?: LetterService
  captureOperationId?: string; captureRequestId?: string; onCaptureConsumed?: (requestId: string) => void
  onBack: () => void; onUpdate: (p: Partial<Person>) => void; onPersistChat: (m: Msg[]) => void
  onGather: () => void; onGift: (options?: GiftOpenOptions) => void; onReceivedGift: (id: string) => void; onProfile: () => void; onEcho: (m: Memory) => void
}) {
  const { t } = useI18n()
  const night = useContext(NightCtx)
  useStatusTone(night ? 'light' : 'dark')
  const w = WORLDS[person.world]
  const [letter, setLetter] = useState<boolean | Memory>(!!startLetter)
  const self = useRef<HTMLDivElement>(null)
  const neighbors = people.filter((p) => p.world === person.world && p.id !== person.id)

  /* 透镜原地展开 */
  useLayoutEffect(() => {
    if (!origin || landed || !self.current || fxPrefs.calm) return
    self.current.animate([{ clipPath: `circle(${origin.r}px at ${origin.x}px ${origin.y}px)` }, { clipPath: `circle(150% at ${origin.x}px ${origin.y}px)` }], { duration: 480, easing: 'cubic-bezier(0.16,1,0.3,1)' })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const back = () => {
    window.speechSynthesis?.cancel()
    if (!origin || !self.current || fxPrefs.calm) { onBack(); return }
    const a = self.current.animate([{ clipPath: `circle(150% at ${origin.x}px ${origin.y}px)` }, { clipPath: `circle(${origin.r}px at ${origin.x}px ${origin.y}px)` }], { duration: 340, easing: 'cubic-bezier(0.7,0,0.84,0)', fill: 'forwards' })
    a.onfinish = onBack
  }
  const enter = origin && !landed ? 'rise-in' : landed ? 'animate-fade' : ''

  return (
    <div ref={self} className={`person-space absolute inset-0 overflow-hidden wb-${person.world} ${landed ? 'animate-fade' : ''}`} style={{ '--chat-accent': w.accent, background: 'var(--chat-surface)' } as React.CSSProperties}>
      {/* 世界远景：只作为会话的氛围 */}
      <div className="chat-scene absolute inset-x-0 overflow-hidden" aria-hidden>
        <div className="chat-scene-view absolute inset-0"><WorldScene world={person.world} /></div>
        <div className="chat-scene-shade absolute inset-x-0 bottom-0" />
      </div>

      <header inert={!!letter} className={`chat-header relative z-30 pt-[var(--app-status-height)] px-3 ${enter}`} style={{ animationDelay: '0.22s' }}>
        <div className="chat-topbar flex items-center gap-1 rounded-[22px] px-1.5 py-1.5">
          <button onClick={back} aria-label={t('common.back')} className="chat-header-action h-11 w-11 shrink-0 flex items-center justify-center rounded-full text-ink-soft"><I.Back className="h-[22px] w-[22px]" /></button>
          <button onClick={onProfile} aria-label={t('profile.view')} className="chat-profile-link flex min-w-0 min-h-11 flex-1 items-center gap-1.5 rounded-2xl pr-2 text-left">
            <Lens world={person.world} avatar={person.avatar} name={person.name} size={34} />
            <span className="ml-1 min-w-0 flex-1">
              <span className="flex items-center gap-1.5"><span className="font-serif text-[19px] leading-tight text-ink truncate">{person.name}</span><AiBadge label={t('common.aiBadge')} /></span>
              <span className="chat-world-label block text-ink-soft truncate">{t(`world.${person.world}`)} · {w.code}</span>
            </span>
          </button>
          <button onClick={onProfile} aria-label={t('profile.view')} className="chat-header-action h-11 w-11 shrink-0 flex items-center justify-center rounded-full text-ink-soft"><I.More className="h-[22px] w-[22px]" /></button>
        </div>
      </header>

      <div inert={!!letter} className="absolute inset-x-0 bottom-0 top-[calc(var(--app-status-height)+66px)]">
        <TalkTab serviceAccount={serviceAccount} serviceConversation={serviceConversation} memoryService={memoryService} person={person} neighbors={neighbors} initial={chat} draftOwner={draftOwner} focusMessageId={focusMessageId} readAloud={readAloud} onUpdate={onUpdate} onPersist={onPersistChat} overlayRoot={self}
          memoryContext={memoryContext} onDismissMemoryContext={onDismissMemoryContext} captureOperationId={captureOperationId} captureRequestId={captureRequestId} onCaptureConsumed={onCaptureConsumed}
          onLetter={memory => setLetter(memory ?? true)} onGather={onGather} onGift={onGift} onReceivedGift={onReceivedGift} onProfile={onProfile} onEcho={onEcho} startCall={startCall} enter={enter} />
      </div>
      {letter && <LetterComposer serviceAccount={serviceAccount} service={letterService} person={person} draftOwner={draftOwner} memory={typeof letter === 'object' ? letter : undefined} onClose={() => setLetter(false)} onSent={(l) => onUpdate({ letters: [l, ...(person.letters ?? [])] })} />}
    </div>
  )
}

/* ================================ 说话 ================================ */
type Fx = { id: number; x: number; h: number }

function MessageRow({ id, serverId, highlighted, children }: { id: number; serverId?: string; highlighted: boolean; children: React.ReactNode }) {
  return <div data-message-id={id} data-server-message-id={serverId} className={highlighted ? 'rounded-2xl bg-sun/20 outline-2 outline-sun/70' : undefined}>{children}</div>
}

function TalkTab({ person, neighbors, initial, draftOwner, focusMessageId, memoryContext, onDismissMemoryContext, readAloud, onUpdate, onPersist, onLetter, onGather, onGift, onReceivedGift, onProfile, onEcho, startCall, captureOperationId, captureRequestId, onCaptureConsumed, enter, overlayRoot, serviceAccount = false, serviceConversation, memoryService }: {
  person: Person; neighbors: Person[]; initial?: Msg[]; draftOwner: string; focusMessageId?: number; readAloud: boolean; onUpdate: (p: Partial<Person>) => void; onPersist: (m: Msg[]) => void
  onLetter: (memory?: Memory) => void; onGather: () => void; onGift: (options?: GiftOpenOptions) => void; onReceivedGift: (id: string) => void; onProfile: () => void; onEcho: (m: Memory) => void; startCall?: 'voice' | 'video'; enter: string
  overlayRoot: React.RefObject<HTMLDivElement | null>
  memoryContext?: Memory; onDismissMemoryContext?: () => void; serviceAccount?: boolean; serviceConversation?: ServiceConversation; memoryService?: MemoryService
  captureOperationId?: string; captureRequestId?: string; onCaptureConsumed?: (requestId: string) => void
}) {
  const { t, lang } = useI18n()
  const nowT = () => fmtTime(lang)
  const [demoThread, setThread] = useConversationHistory(serviceAccount ? undefined : initial, serviceAccount ? () => {} : onPersist, () => [
    { id: nid(), kind: 'note', text: t('talk.note') },
    ...(!serviceAccount ? [{ id: nid(), kind: 'him', time: nowT(), text: person.greeting } as Msg] : []),
  ])
  const remote = useServiceConversation(serviceConversation, message => {
    if (readAloud && message.kind === 'him') speak(message.text, lang)
  })
  const consumedCaptures = useRef(new Set<string>())
  useEffect(() => {
    if (!captureOperationId || !captureRequestId || !serviceConversation?.chatCapture || serviceConversation.storyBranchId || !remote.conversationId || remote.loading || remote.sending || consumedCaptures.current.has(captureRequestId)) return
    consumedCaptures.current.add(captureRequestId); onCaptureConsumed?.(captureRequestId)
    void remote.resumeCapture(captureOperationId)
  }, [captureOperationId, captureRequestId, serviceConversation?.accountId, serviceConversation?.sessionId, serviceConversation?.personId, remote.conversationId, remote.loading, remote.sending])
  const voiceService=useMemo<VoiceCallContext|undefined>(()=>serviceConversation&&!serviceConversation.storyBranchId&&person.serverId?{accountId:serviceConversation.accountId,sessionId:serviceConversation.sessionId,personId:person.serverId,conversationId:remote.conversationId,onUnauthorized:serviceConversation.onUnauthorized}:undefined,[serviceConversation?.accountId,serviceConversation?.sessionId,serviceConversation?.storyBranchId,person.serverId,remote.conversationId])
  const callHistory=useVoiceCallRecords(voiceService,remote.conversationId),callRecords=callHistory.messages
  const [note] = useState<Msg>(() => ({ id: nid(), kind: 'note', text: t('talk.note') }))
  const remoteEnabled = !!serviceConversation
  const thread = useMemo(() => remoteEnabled ? [note, ...[...remote.messages,...callRecords].sort((a,b)=>(a.at??0)-(b.at??0))] : demoThread, [remoteEnabled, note, remote.messages,callRecords, demoThread])
  const [draft, storeDraft] = useConversationDraft(draftOwner, serviceConversation?.storyBranchId?'story:'+serviceConversation.storyBranchId:serviceAccount ? person.serverId ?? person.id : person.id, serviceAccount)
  const displayedDraft = serviceConversation ? remote.pendingText ?? draft : draft
  useEffect(() => { if (serviceConversation && remote.pendingText !== undefined && remote.pendingInputMode!=='transcribed' && remote.pendingText !== draft) storeDraft(remote.pendingText) }, [remote.pendingText,remote.pendingInputMode, draftOwner, person.serverId])
  const draftRevision = useRef(0)
  const setDraft = (value: string) => { draftRevision.current++; storeDraft(value) }
  const [demoTyping, setTyping] = useState(false)
  const typing = serviceConversation ? remote.typing : demoTyping
  const [selected, setSelected] = useState<number | null>(null)
  const [panel, setPanel] = useState(false)
  const [voiceMode, setVoiceMode] = useState(false)
  const [speechNotice,setSpeechNotice]=useState(false),[speechAllowed,setSpeechAllowed]=useState(false),[voiceFinishing,setVoiceFinishing]=useState(false)
  const serviceVoice=useRef<ReturnType<typeof startVoiceInput>|null>(null),holdCanceled=useRef(false),holdStartY=useRef(0)
  const [hold, setHold] = useState<null | { y: number; cancel: boolean; text: string }>(null)
  const holdSession = useRef<object | null>(null)
  const canOpenCall = !serviceAccount || !!serviceConversation && !serviceConversation.storyBranchId
  const [call, setCall] = useState<null | 'voice' | 'video'>(canOpenCall ? startCall ?? null : null)
  const [previewCallPhoto, setPreviewCallPhoto] = useState(false)
  const [overlayTarget, setOverlayTarget] = useState<HTMLDivElement | null>(null)
  useEffect(() => { setOverlayTarget(overlayRoot.current) }, [overlayRoot])
  const [memDraft, setMemDraft] = useState<Memory | null>(null)
  const memorySource = useRef<MemorySource | undefined>(undefined)
  const memoryOpening = useRef(0)
  const [keep, setKeep] = useState(false)
  const [savedMemoryId, setSavedMemoryId] = useState<number | null>(null)
  const [readingSaved, setReadingSaved] = useState(false)
  const savedMemory = person.memories.find(memory => memory.id === savedMemoryId)
  const savedMemoryOpener = useRef<HTMLButtonElement>(null)
  const [readingContext, setReadingContext] = useState(false)
  useEffect(() => setReadingContext(false), [memoryContext?.id])
  const [toast, setToast] = useState<string | null>(null)
  const [composerStatus, setComposerStatus] = useState<string | null>(null)
  useEffect(()=>{if(callHistory.error)setToast(callHistory.error)},[callHistory.error])
  const [streaks, setStreaks] = useState<Fx[]>([])
  const [arrivals, setArrivals] = useState<Fx[]>([])
  const timers = useRef<number[]>([])
  const after = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)) }
  const recog = useRef<{ stop?: () => void } | null>(null)
  const area = useRef<HTMLDivElement>(null)
  const { scroller, highlighted } = useThreadScroll(thread, typing, serviceConversation ? remote.focusServerId : focusMessageId)
  const paging = useRef(false)
  useEffect(() => {
    const list = scroller.current
    if (!list || !serviceConversation) return
    const scroll = () => {
      if (remote.loading || callHistory.loading || paging.current) return
      const load = list.scrollTop <= 24 && (remote.hasOlder||callHistory.hasOlder) ? ()=>Promise.all([remote.hasOlder?remote.loadOlder():Promise.resolve(),callHistory.hasOlder?callHistory.loadOlder():Promise.resolve()]).then(()=>{})
        : list.scrollHeight - list.scrollTop - list.clientHeight < 90 && remote.hasNewer ? remote.loadNewer : undefined
      if (!load) return
      paging.current = true
      void load().finally(() => { paging.current = false })
    }
    list.addEventListener('scroll', scroll, { passive: true })
    return () => list.removeEventListener('scroll', scroll)
  }, [serviceConversation, remote.hasOlder,callHistory.hasOlder,callHistory.loading,callHistory.loadOlder,remote.hasNewer, remote.loading, remote.loadOlder, remote.loadNewer, scroller])
  const photoInput = useRef<HTMLInputElement>(null)
  const camInput = useRef<HTMLInputElement>(null)
  const entryInput = useRef<HTMLTextAreaElement>(null)
  const resizeEntry = () => {
    const input = entryInput.current
    if (!input) return
    const list = scroller.current
    const follow = !!list && list.scrollHeight - list.scrollTop - list.clientHeight < 90
    input.style.height = 'auto'
    const height = Math.min(112, Math.max(44, input.scrollHeight))
    input.style.height = `${height}px`
    input.style.overflowY = input.scrollHeight > height ? 'auto' : 'hidden'
    if (follow) list.scrollTop = list.scrollHeight
  }
  useLayoutEffect(resizeEntry, [draft])
  useLayoutEffect(() => {
    const input = entryInput.current
    if (!input) return
    resizeEntry()
    let width = input.clientWidth
    const observer = new ResizeObserver(() => {
      if (input.clientWidth === width) return
      width = input.clientWidth; resizeEntry()
    })
    observer.observe(input)
    return () => observer.disconnect()
  }, [voiceMode])
  const nativeBackRoot = useRef<HTMLDivElement>(null)
  useNativeBack(() => {
    if (selected !== null) setSelected(null)
    else if (panel) setPanel(false)
    else return false
    return true
  }, selected !== null || panel, 10, nativeBackRoot)
  useEffect(() => () => { holdSession.current = null; serviceVoice.current?.cancel(); timers.current.forEach(clearTimeout); window.speechSynthesis?.cancel(); try { recog.current?.stop?.() } catch { /* noop */ } }, [])

  const flash = (m: string) => { setToast(m); after(2200, () => setToast(null)) }
  const unavailable = () => flash(isZh(lang) ? '这项功能暂时无法使用，输入内容已保留，请稍后再试。' : 'This feature is unavailable right now. Your input is kept; please try again later.')
  useEffect(() => {
    if (!remote.feedback) return
    if (remote.feedback.placement === 'composer') setComposerStatus(remote.feedback.text)
    else flash(remote.feedback.text)
    remote.clearFeedback()
  }, [remote.feedback, remote.clearFeedback])
  useEffect(() => { if (startCall && !canOpenCall) unavailable() }, [startCall, canOpenCall]) // eslint-disable-line react-hooks/exhaustive-deps
  const push = (m: Omit<Msg, 'id'>) => setThread((tt) => [...tt, { ...m, id: nid(), at: Date.now() } as Msg])
  const copy = async (text: string) => {
    setSelected(null)
    try {
      await navigator.clipboard.writeText(text)
      flash(t('talk.copied'))
    } catch {
      flash(isZh(lang) ? '复制失败，请重试' : 'Could not copy. Try again.')
    }
  }

  /* 发送：一道光掠向地平线，抵达时出现世界专属的效果 */
  const beam = () => {
    if (fxPrefs.calm) return
    const h = (area.current?.clientHeight ?? 400) - 30
    const x = (area.current?.clientWidth ?? 360) * 0.78
    const id = nid()
    setStreaks((s) => [...s, { id, x, h }])
    after(600, () => { setStreaks((s) => s.filter((f) => f.id !== id)); setArrivals((a) => [...a, { id, x, h }]) })
    after(1500, () => setArrivals((a) => a.filter((f) => f.id !== id)))
  }
  const reply = (text: string) => {
    if (serviceAccount) { unavailable(); return }
    const res = buildReply(lang, person, text)
    setTyping(false)
    push({ kind: 'him', time: nowT(), text: res.text, canRemember: res.remember ? { id: 0, ...res.remember } : undefined } as Msg)
    haptic(6)
    if (readAloud) speak(res.text, lang)
  }
  const send = (text: string, voice?: boolean) => {
    const tx = text.trim(); if (!tx) return
    if (serviceConversation) {
      if (remote.sending) return
      setComposerStatus(null)
      const transcribed=voice||remote.pendingInputMode==='transcribed'
      const submittedRevision = draftRevision.current
      setPanel(false)
      if(voice)setVoiceMode(false)
      void remote.send(text,transcribed?'transcribed':'typed').then(accepted => {
        if (!accepted) return
        if (!transcribed&&draftRevision.current === submittedRevision) setDraft('')
        beam(); haptic(6)
      })
      return
    }
    if (serviceAccount) { unavailable(); return }
    setDraft(''); setPanel(false)
    push({ kind: 'me', time: nowT(), text: tx, voice } as Msg)
    beam(); haptic(6)
    after(750, () => setTyping(true)); after(1900, () => reply(tx))
  }
  const sendPhoto = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setPanel(false)
    if (serviceConversation) { if (await remote.sendPhoto(file)) beam(); return }
    if (serviceAccount) { unavailable(); return }
    let src: string
    try { src = await fileToDataUrl(file, 720) }
    catch { flash(isZh(lang) ? '这张照片没能打开，请重新选择' : "Couldn't open photo. Try again."); return }
    push({ kind: 'photo', time: nowT(), src } as Msg); beam()
    after(700, () => setTyping(true))
    after(1800, () => { setTyping(false); push({ kind: 'him', time: nowT(), text: photoReply(lang) } as Msg) })
  }
  const confirmMemory = async (m: Memory, selection?: MemoryConfirmation) => {
    if (serviceAccount) {
      if (!memoryService || !person.serverId) { unavailable(); return false }
      const handwritten = selection && 'kind' in selection ? selection : undefined
      const source = handwritten ? undefined : (selection as MemoryCandidateBinding | undefined) ?? memorySource.current
      const kept = await memoryService.save(person.serverId, m, source, handwritten?.intentId)
      if (!kept) return false
      setSavedMemoryId(kept.id); haptic([8, 30, 8])
      requestAnimationFrame(() => savedMemoryOpener.current?.focus({ preventScroll: true }))
      return true
    }
    const kept = { ...m, id: nid() }
    onUpdate({ memories: [kept, ...person.memories] }); onEcho(kept)
    setMemDraft(null); setKeep(false); setSavedMemoryId(kept.id); haptic([8, 30, 8])
    requestAnimationFrame(() => savedMemoryOpener.current?.focus({ preventScroll: true }))
  }

  /* 按住说话：同心信号环 + 实时转文字，上滑取消 */
  const speechFailure=(error:unknown)=>{const code=error instanceof VoiceInputError?error.code:String(error);flash(code==='MICROPHONE_DENIED'?(isZh(lang)?'还没有麦克风使用权限。请在手机或浏览器设置中允许后重试，也可以直接打字。':'Allow microphone and voice input access, then try again. Nothing has been sent.'):code==='RECOGNITION_UNAVAILABLE'?(isZh(lang)?'这台设备暂时不能把语音转成文字，请先打字发送。':'Voice typing is unavailable right now. You can type instead.'):code==='RECOGNITION_NETWORK_ERROR'?(isZh(lang)?'语音识别服务暂时连不上，这次没有发送。可以稍后再试，或直接打字。':'The speech recognition service could not be reached. Nothing was sent. Try again later, or type your message.'):code==='NO_SPEECH'?(isZh(lang)?'没听清你刚才说的话，请再说一次，或直接打字。':'We could not make out your words. Please try again. Nothing has been sent.'):(isZh(lang)?'刚才的话没能转成文字，还没有发送，请重试或直接打字。':'Voice typing did not finish. Please try again. Nothing has been sent.'))}
  const toggleVoice=()=>{if(voiceFinishing)cancelHold();if(serviceAccount&&!voiceMode&&!speechAllowed){if(!browserRecognition()){speechFailure(new VoiceInputError('RECOGNITION_UNAVAILABLE'));return};setSpeechNotice(true);return};setVoiceMode(v=>!v);setPanel(false)}
  const startHold = (e: React.PointerEvent) => {
    if(serviceAccount){
      if(!serviceConversation){unavailable();return};if(!speechAllowed){setSpeechNotice(true);return};if(holdSession.current||remote.sending||remote.pendingText){flash(isZh(lang)?'请先完成上一次发送。':'Finish the previous send first.');return}
      e.currentTarget.setPointerCapture?.(e.pointerId);const session={};holdSession.current=session;holdCanceled.current=false;holdStartY.current=e.clientY;setHold({y:e.clientY,cancel:false,text:''});haptic(10)
      try{serviceVoice.current=startVoiceInput({Recognition:browserRecognition(),language:speechLang(lang),onInterim:text=>{if(holdSession.current===session)setHold(h=>h?{...h,text}:h)},onError:code=>{if(holdSession.current!==session)return;holdSession.current=null;serviceVoice.current=null;setHold(null);setVoiceFinishing(false);speechFailure(new VoiceInputError(code))}})}catch(error){holdSession.current=null;serviceVoice.current=null;setHold(null);speechFailure(error)}
      return
    }
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    const session = {}; holdSession.current = session
    holdStartY.current=e.clientY
    setHold({ y: e.clientY, cancel: false, text: '' }); haptic(10)
    const W = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }
    const SR = W.SpeechRecognition || W.webkitSpeechRecognition
    if (SR) {
      try {
        const r = new SR(); r.lang = speechLang(lang); r.interimResults = true; recog.current = r
        r.onresult = (ev: RecEvt) => { if (holdSession.current !== session) return; let s = ''; for (let j = 0; j < ev.results.length; j++) s += ev.results[j][0].transcript; setHold((h) => (h ? { ...h, text: s } : h)) }
        r.start(); return
      } catch { /* 回退到模拟 */ }
    }
    const sample = quickReplies(lang)[1]; let i = 0
    const tick = () => { if (holdSession.current !== session) return; i++; setHold((h) => (h ? { ...h, text: sample.slice(0, i) } : h)); if (i < sample.length) after(70, tick) }
    after(450, tick)
  }
  const moveHold = (e: React.PointerEvent) => {if(!holdSession.current)return;holdCanceled.current=holdStartY.current-e.clientY>70;setHold(h=>h?{...h,cancel:holdCanceled.current}:h)}
  const cancelHold = () => {
    holdSession.current = null
    serviceVoice.current?.cancel();serviceVoice.current=null;setVoiceFinishing(false)
    try { recog.current?.stop?.() } catch { /* noop */ } recog.current = null
    setHold(null)
  }
  const endHold = () => {
    if(serviceAccount){const session=holdSession.current,recognition=serviceVoice.current;if(!session||!recognition)return;if(holdCanceled.current){cancelHold();return};setHold(null);setVoiceFinishing(true);void recognition.finish().then(text=>{if(holdSession.current!==session)return;holdSession.current=null;serviceVoice.current=null;setVoiceFinishing(false);send(text,true)}).catch(error=>{if(holdSession.current!==session)return;holdSession.current=null;serviceVoice.current=null;setVoiceFinishing(false);speechFailure(error)});return}
    if (!holdSession.current) return
    const h = hold; cancelHold()
    if (!h || h.cancel) return
    send(h.text || quickReplies(lang)[1], true)
  }

  const giftLabel = isZh(lang) ? '送礼物' : 'Send a gift'
  const openCall = (mode: 'voice' | 'video') => {
    if (!canOpenCall) { unavailable(); return }
    cancelHold()
    setPanel(false)
    setCall(mode)
  }
  const actions = [
    { key: 'photo', icon: I.Photo, run: () => serviceConversation?.storyBranchId?unavailable():serviceConversation && remote.pendingPhoto && !remote.photoNeedsSelection ? void remote.sendPhoto().then(ok => { if (ok) { setPanel(false); beam() } }) : serviceAccount && !serviceConversation ? unavailable() : photoInput.current?.click() },
    { key: 'camera', icon: I.Camera, run: () => serviceConversation?.storyBranchId?unavailable():serviceConversation && remote.pendingPhoto && !remote.photoNeedsSelection ? void remote.sendPhoto().then(ok => { if (ok) { setPanel(false); beam() } }) : serviceConversation?.chatCapture ? void remote.takePhoto().then(ok => { if (ok) { setPanel(false); beam() } }) : serviceAccount && !serviceConversation ? unavailable() : camInput.current?.click() },
    { key: 'voice', icon: I.Phone, run: () => openCall('voice') },
    { key: 'video', icon: I.Video, run: () => openCall('video') },
    { key: 'letter', icon: I.Mail, run: () => { if(serviceConversation?.storyBranchId){unavailable();return};setPanel(false); onLetter() } },
    { key: 'gift', icon: Gift, run: () => { if(serviceConversation?.storyBranchId){unavailable();return};setPanel(false); onGift() } },
    { key: 'keep', icon: I.Keep, run: () => { setPanel(false); memorySource.current = undefined; setKeep(true) } },
    ...(neighbors.length ? [{ key: 'gather', icon: I.Gather, run: () => { setPanel(false); onGather() } }] : []),
  ]
  const shortThread = thread.filter((m) => m.kind === 'me').length < 2
  const callOverlay = call && canOpenCall && (serviceAccount && serviceConversation
    ? previewCallPhoto
      ? <CallOverlay person={person} mode="video" serviceAccount onSwitchVoice={() => { setPreviewCallPhoto(false); setCall('voice') }} onClose={() => setPreviewCallPhoto(false)} onEnd={() => {}} />
      : <CallInterestSheet kind={call} context={serviceConversation} onClose={() => setCall(null)}
          onPhotoPreview={call === 'video' ? () => setPreviewCallPhoto(true) : undefined} />
    : <CallOverlay person={person} mode={call} onSwitchVoice={() => setCall('voice')} onClose={() => setCall(null)}
        onEnd={(secs) => { const mode = call; setCall(null); push({ kind: 'call', time: nowT(), mode, secs } as Msg); after(500, () => push({ kind: 'him', time: nowT(), text: callLines(lang).end } as Msg)) }} />)
  const writeFromMemory = serviceConversation && !serviceConversation.storyBranchId ? onLetter : undefined
  const memoryContextOverlay = readingContext && memoryContext && (memoryService && person.serverId
    ? <MemoryReader memory={memoryContext} personName={person.name} personId={person.serverId} service={memoryService} onClose={() => setReadingContext(false)} onWriteLetter={writeFromMemory} />
    : <Sheet title={memoryContext.title} onClose={() => setReadingContext(false)}>
    <p className="chat-memory-original">{memoryContext.body}</p>
  </Sheet>)
  const savedMemoryOverlay = readingSaved && savedMemory && <MemoryReader memory={savedMemory} personName={person.name} personId={person.serverId} service={memoryService} onClose={() => setReadingSaved(false)} onWriteLetter={writeFromMemory} />

  return (
    <div ref={nativeBackRoot} inert={!!savedMemoryOverlay && !!overlayTarget} className="absolute inset-0 flex flex-col">
      {serviceConversation&&person.serverId&&<StoryReview context={{accountId:serviceConversation.accountId,sessionId:serviceConversation.sessionId,personId:person.serverId,onUnauthorized:serviceConversation.onUnauthorized}} branchId={serviceConversation.storyBranchId} branchName={serviceConversation.storyBranchName}/>}
      {memoryContext && <aside className="chat-memory-reference">
        <button className="chat-memory-open" onClick={() => setReadingContext(true)} aria-label={isZh(lang) ? `查看这次聊起的回忆：${memoryContext.title}` : `Read the memory: ${memoryContext.title}`}>
          <I.Keep className="h-4 w-4" /><span><small>{isZh(lang) ? '这次聊起的一页' : 'A memory with you'}</small><strong>{memoryContext.title}</strong></span><I.Chevron className="h-4 w-4" />
        </button>
        {onDismissMemoryContext && <button className="chat-memory-dismiss" onClick={onDismissMemoryContext} aria-label={isZh(lang) ? '收起回忆提示' : 'Dismiss memory context'}><I.X className="h-4 w-4" /></button>}
      </aside>}
      <div ref={area} className="chat-thread-area relative flex-1 min-h-0">
        <div className="absolute inset-x-0 top-0 h-12 z-10 flex items-center justify-center pointer-events-none">
          {typing && <HorizonSignal world={person.world} label={t('talk.typing')} />}
          {arrivals.map((a) => <span key={a.id} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: a.x }}><Arrival world={person.world} /></span>)}
        </div>
        <div ref={scroller} aria-busy={!!serviceConversation && remote.loading} onClick={() => { setSelected(null); setSavedMemoryId(null) }} className="chat-history absolute inset-0 overflow-y-auto scroll-quiet px-4 pt-14 pb-4 space-y-3"
          style={{ maskImage: 'linear-gradient(to bottom, transparent 0, #000 36px)', WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, #000 36px)' }}>
          {thread.map((m) => (
            <MessageRow key={m.id} id={m.id} serverId={'serverId' in m ? m.serverId : undefined} highlighted={highlighted === m.id}>
              {m.kind === 'gift' ? <GiftMessageCard owner={draftOwner} person={person} direction={m.direction} giftId={m.giftId}
                onOpen={() => m.direction === 'received' ? onReceivedGift(m.giftId) : onGift({ tab: 'receipts', receiptId: m.giftId })} /> : <Bubble m={m} who={person} selected={selected === m.id} onAvatar={onProfile} readPhoto={serviceConversation ? remote.readPhoto : undefined}
                onSelect={() => setSelected((s) => (s === m.id ? null : m.id))}
                onSpeak={(tx) => { setSelected(null); speak(tx, lang) }}
                onCopy={copy}
                onRemember={(mem) => {
                  memorySource.current = m.serverId && m.serverVersion ? { sourceMessageId: m.serverId, sourceMessageVersion: m.serverVersion } : undefined
                  memoryOpening.current++
                  setSelected(null); setMemDraft(mem)
                }}
                onDelete={(id) => {
                  if (serviceConversation) {
                    const message = remote.messages.find(item => item.id === id)
                    if (message) void remote.remove(message).then(removed => { if (removed) setSelected(null) })
                    return
                  }
                  if (serviceAccount) { unavailable(); return }; setSelected(null); setThread((tt) => tt.filter((x) => x.id !== id))
                }} />}
              {serviceConversation && !serviceConversation.storyBranchId && remote.conversationId
                && m.kind === 'him' && m.serverId && m.serverVersion && m.generationJobId
                && !m.generationKind && !m.sourceDomain && [...m.text].length <= 240
                && <ChatReplySpeech conversationId={remote.conversationId} messageId={m.serverId} messageVersion={m.serverVersion}
                  sessionId={serviceConversation.sessionId} onUnauthorized={serviceConversation.onUnauthorized} />}
            </MessageRow>
          ))}
        </div>
        {savedMemory && <div className="chat-save-feedback">
          <span role="status">{isZh(lang) ? '已珍藏' : 'Memory kept'}</span>
          <button ref={savedMemoryOpener} className="chat-save-view" aria-haspopup="dialog" onClick={event => {
            event.currentTarget.focus({ preventScroll: true })
            setReadingSaved(true)
          }}>{isZh(lang) ? '查看这篇' : 'View memory'}</button>
          <button className="chat-save-dismiss" aria-label={t('common.close')} onClick={() => setSavedMemoryId(null)}><I.X /></button>
        </div>}
        {streaks.map((s) => (
          <span key={s.id} className="absolute bottom-0 w-[2px] h-20 rounded-full streak-up pointer-events-none" style={{ left: s.x, ['--dy' as string]: `-${s.h}px`, background: 'linear-gradient(to top, rgba(235,201,149,0), #ebc995 60%, #fff3dc)', boxShadow: '0 0 12px rgba(235,201,149,0.9)' } as React.CSSProperties} />
        ))}
        {hold && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-end pb-6 animate-fade" style={{ background: 'linear-gradient(to bottom, transparent, var(--wb) 40%)' }}>
            <p className="mb-6 px-8 min-h-[3rem] text-center font-serif text-[20px] leading-relaxed text-ink">{hold.text}<span className="caret ml-0.5 inline-block h-[1em] w-px bg-ink/50 align-middle" /></p>
            <div className="relative h-24 w-24 flex items-center justify-center">
              {[0, 1, 2].map((i) => <span key={i} className={`absolute inset-0 rounded-full border fx ring-out ${hold.cancel ? 'border-coral/70' : 'border-sky/60'}`} style={{ animationDelay: `${i * 0.6}s`, animationDuration: '1.8s' }} />)}
              <span className={`relative h-16 w-16 rounded-full flex items-center justify-center text-pearl ${hold.cancel ? 'bg-coral' : 'bg-sky'}`}><I.Mic className="h-7 w-7" /></span>
            </div>
            <p className={`mt-4 text-[12.5px] ${hold.cancel ? 'text-coral' : 'text-ink-soft'}`}>{hold.cancel ? t('talk.releaseCancel') : t('talk.slideCancel')}</p>
          </div>
        )}
      </div>

      {!panel && !voiceMode && shortThread && !draft && (
        <div className="px-3 pb-2 flex gap-2 overflow-x-auto scroll-quiet">
          {quickReplies(lang).map((q) => <button key={q} onClick={() => send(q)} className="shrink-0 rounded-full glass-light text-ink-soft text-[13.5px] px-3.5 py-2 active:scale-95 transition-transform">{q}</button>)}
        </div>
      )}

      <div className={`app-composer chat-composer relative z-10 px-3 pt-2.5 pb-[30px] rounded-t-[26px] ${enter}`} style={{ animationDelay: '0.3s' }}>
        {composerStatus && <p id="chat-composer-status" role="status" className="px-2 pb-2 text-[12px] leading-relaxed text-ink-soft [overflow-wrap:anywhere]">{composerStatus}</p>}
        <div className="chat-entry-row flex items-end gap-2">
          <button onClick={toggleVoice} aria-label={voiceMode ? t('talk.keyboardMode') : t('talk.voiceMode')} className="h-11 w-11 shrink-0 flex items-center justify-center rounded-full ring-1 ring-line bg-paper/70 text-ink-soft active:scale-90 transition-transform">
            {voiceMode ? <I.Keyboard className="h-[22px] w-[22px]" /> : <I.Mic className="h-[21px] w-[21px]" />}
          </button>
          <div className="chat-entry flex min-w-0 flex-1 items-end rounded-[22px] bg-paper/80 ring-1 ring-line focus-within:ring-sky/60">
          {voiceMode ? (
            <button disabled={voiceFinishing||remote.sending} aria-busy={voiceFinishing} onPointerDown={startHold} onPointerMove={moveHold} onPointerUp={endHold} onPointerCancel={cancelHold}
              className={`min-w-0 flex-1 h-11 rounded-[22px] text-[15.5px] font-medium select-none touch-none transition-colors ${hold ? 'bg-sky/15 text-sky-deep' : 'text-ink'}`}>{voiceFinishing ? isZh(lang)?'正在识别…':'Recognizing…' : hold ? t('talk.release') : t('talk.hold')}</button>
          ) : (
            <textarea ref={entryInput} value={displayedDraft} readOnly={!!serviceConversation && remote.pendingText !== undefined} onChange={(e) => { setComposerStatus(null); setDraft(e.target.value) }} rows={1} aria-label={t('talk.ph')} aria-describedby={composerStatus ? 'chat-composer-status' : undefined} onFocus={() => { setPanel(false); setSavedMemoryId(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); send(displayedDraft) } }}
              placeholder={t('talk.ph')} className="chat-entry-input min-w-0 flex-1 min-h-11 max-h-28 resize-none rounded-[22px] bg-transparent pl-3.5 pr-2 py-2.5 text-[16px] leading-6 text-ink outline-none placeholder:text-muted" />
          )}
          <button onClick={() => { if(serviceConversation?.storyBranchId){unavailable();return};setPanel(false); onGift() }} aria-label={giftLabel} title={giftLabel}
            className="chat-gift h-11 w-11 shrink-0 flex items-center justify-center rounded-full text-sky-deep active:bg-sky/10 focus-visible:outline-2 focus-visible:outline-sky-deep focus-visible:-outline-offset-4 transition-colors">
            <Gift className="h-[22px] w-[22px]" weight="duotone" aria-hidden />
          </button>
          </div>
          {displayedDraft.trim() && !voiceMode
            ? <button onClick={() => send(displayedDraft)} disabled={!!serviceConversation && remote.sending} aria-busy={!!serviceConversation && remote.sending} aria-label={t('talk.send')} className="chat-send h-11 w-11 shrink-0 flex items-center justify-center rounded-full btn-dark active:scale-90 transition-transform pop-in"><I.Send className="h-5 w-5" /></button>
            : <button onClick={() => { setPanel((v) => !v); haptic(6) }} aria-label={t('talk.more')} aria-expanded={panel} aria-controls={panel ? 'chat-actions' : undefined} className={`h-11 w-11 shrink-0 flex items-center justify-center rounded-full ring-1 transition-all duration-300 active:scale-90 ${panel ? 'btn-dark ring-ink rotate-45' : 'bg-paper/70 ring-line text-ink-soft'}`}><I.Plus className="h-6 w-6" /></button>}
        </div>
        {panel && (
          <div id="chat-actions" className="chat-action-grid relative mt-4 mb-1 grid grid-cols-4 gap-x-1 gap-y-3 animate-rise">
            {actions.map((a, i) => (
              <button key={a.key} onClick={a.run} className="flex min-w-0 flex-col items-center gap-1.5 rounded-[20px] active:scale-95 transition-transform rise-in" style={{ animationDelay: `${i * 0.024}s` }}>
                <span className="w-full max-w-[60px] aspect-square flex items-center justify-center rounded-[20px] bg-paper/80 ring-1 ring-paper text-ink shadow-[0_10px_24px_-16px_rgba(41,69,66,0.6)]"><a.icon className="h-[25px] w-[25px]" /></span>
                <span className="max-w-full [overflow-wrap:anywhere] text-[11.5px] text-ink-soft">{a.key === 'gift' ? giftLabel
                  : a.key === 'video' && serviceAccount ? (isZh(lang) ? '视频通话' : 'Video call')
                  : t(`act.${a.key}`)}</span>
              </button>
            ))}
          </div>
        )}
        {serviceConversation && remote.pendingPhoto && (remote.photoNeedsSelection || remote.photoCaptureMissing) && <div className="chat-photo-recovery" role="status">
          <p className="mt-3 text-[12px] leading-relaxed text-muted">{remote.photoCaptureMissing ? isZh(lang) ? '这张照片的本机原图已无法恢复。可以停止这次本机重试，再选择新照片；已发送的照片仍会留在聊天里。' : 'This original can no longer be restored on this device. Stop this retry before choosing another photo. Any photo already sent stays in the chat.' : isZh(lang) ? '这张照片需要重新选择原图才能继续。找不到原图时，可以停止本机重试；停止不会撤回可能已发送的照片，请先查看聊天记录。' : 'Choose the original photo to continue. If you cannot find it, you can stop retrying on this device. Stopping will not recall a photo that may already have been sent; check your chat first.'}</p>
          <div className="mt-2 flex flex-wrap gap-3 text-[13px] text-sky-deep">
            {!remote.photoCaptureMissing && <button disabled={remote.sending} onClick={() => { if (!remote.sending) photoInput.current?.click() }} className="min-h-11 disabled:opacity-50">{isZh(lang) ? '重选原照片' : 'Choose original photo again'}</button>}
            <button disabled={remote.sending} onClick={() => { if (!remote.sending) return remote.stopPhotoRetry() }} className="min-h-11 disabled:opacity-50">{isZh(lang) ? '停止重试这张照片' : 'Stop retrying this photo'}</button>
          </div>
        </div>}
        <input ref={photoInput} type="file" accept="image/*" className="hidden" onChange={(e) => { sendPhoto(e.target.files); e.target.value = '' }} />
        <input ref={camInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { sendPhoto(e.target.files); e.target.value = '' }} />
      </div>

      {speechNotice&&<Sheet title={isZh(lang)?'语音转文字':'Voice to text'} onClose={()=>setSpeechNotice(false)} footer={<button onClick={()=>{setSpeechAllowed(true);setSpeechNotice(false);setVoiceMode(true);setPanel(false)}} className="w-full rounded-full btn-dark py-3 text-paper">{isZh(lang)?'允许语音识别':'Allow speech recognition'}</button>}><p className="text-sm leading-relaxed text-ink-soft">{isZh(lang)?'浏览器可能把麦克风音频发送给其语音识别服务。西界只接收松手确认后的最终文字，不保存这次录音。允许后请再次按住说话；上滑取消不会发送文字。':'Your browser may send microphone audio to its speech recognition service. Xijie receives only the final text confirmed when you release and does not save this recording. Hold to speak after allowing; slide up to cancel without sending.'}</p></Sheet>}
      {remote.safetySupport && <Sheet title={isZh(lang) ? '先照顾好你自己' : 'Put your safety first'} onClose={remote.dismissSafetySupport}
        footer={<button type="button" onClick={remote.dismissSafetySupport} className="min-h-12 w-full rounded-full btn-dark px-4 text-[15px]">
          {isZh(lang) ? '返回聊天' : 'Return to chat'}
        </button>}>
        <p className="text-[15px] leading-relaxed text-ink">{isZh(lang)
          ? '如果你可能马上伤害自己，请立即联系当地紧急服务，或请身边信任的人过来陪你。你不必独自面对。'
          : 'If you might hurt yourself soon, contact your local emergency services now or ask someone you trust to come and stay with you. You do not have to face this alone.'}</p>
      </Sheet>}
      {callOverlay && (overlayTarget ? createPortal(callOverlay, overlayTarget) : callOverlay)}
      {memoryContextOverlay && (overlayTarget ? createPortal(memoryContextOverlay, overlayTarget) : memoryContextOverlay)}
      {savedMemoryOverlay && (overlayTarget ? createPortal(savedMemoryOverlay, overlayTarget) : savedMemoryOverlay)}
      {memDraft && <MemorySheet key={memoryOpening.current} title={t('mem.title')} note={t('mem.note', { name: person.name })} draft={memDraft}
        preparation={memoryService && person.serverId && memorySource.current ? { service: memoryService, personId: person.serverId, source: memorySource.current } : undefined}
        onConfirm={confirmMemory} onClose={() => setMemDraft(null)} />}
      {keep && <MemorySheet title={t('keep.title')} draft={{ id: 0, title: '', body: '' }} editing onConfirm={confirmMemory} onClose={() => setKeep(false)} />}
      {toast && <Toast text={toast} />}
    </div>
  )
}
type RecEvt = { results: ArrayLike<ArrayLike<{ transcript: string }>> }
type Rec = { lang: string; interimResults: boolean; start: () => void; stop: () => void; onresult: (e: RecEvt) => void }

/* ------------------------------- 气泡 ------------------------------- */
export function Bubble({ m, who, selected, onSelect, onSpeak, onCopy, onRemember, onDelete, speaker, onAvatar, readPhoto }: {
  m: Msg; who?: Person; selected: boolean; onSelect: () => void; onSpeak: (t: string) => void; onCopy: (t: string) => void
  onRemember?: (mem: Memory) => void; onDelete: (id: number) => void; speaker?: Pick<Person, 'name' | 'world' | 'avatar'>; onAvatar?: () => void; readPhoto?: ReadPrivatePhoto
}) {
  const { t, lang } = useI18n()
  const reports=useContentReports()
  if (m.kind === 'note') return <p className="chat-system-note mx-auto max-w-[17rem] py-1 text-center text-[12px] leading-relaxed text-ink-soft/80 animate-fade">{m.text}</p>
  if (m.kind === 'call') return (
    <div className="flex justify-center animate-fade"><span className="inline-flex items-center gap-1.5 rounded-full glass-light px-3 py-1.5 text-[12px] text-ink-soft">{m.mode === 'voice' ? <I.Phone className="h-3.5 w-3.5" /> : <I.Video className="h-3.5 w-3.5" />}{t(m.mode === 'voice' ? 'talk.call.voice' : 'talk.call.video', { d: fmtDuration(m.secs) })}</span></div>
  )
  if (m.kind === 'photo') return (
    <div className="flex flex-col items-end animate-rise" onClick={event => event.stopPropagation()}>
      {m.photo && readPhoto ? <PrivatePhoto postId={m.id} photo={m.photo} read={readPhoto} label={t('talk.photo')} onOpen={onSelect}
        permissionLabel={isZh(lang) ? '允许聊天照片保存后查看' : 'Allow chat photo storage to view'}
        className="rounded-[20px] rounded-br-md overflow-hidden ring-1 ring-white shadow-[0_12px_30px_-18px_rgba(41,69,66,0.6)] h-44 w-48" />
        : <button onClick={(e) => { e.stopPropagation(); onSelect() }} className="rounded-[20px] rounded-br-md overflow-hidden ring-1 ring-white shadow-[0_12px_30px_-18px_rgba(41,69,66,0.6)] h-44 w-48 bg-cloud"><img src={m.src ?? STORY_IMG} alt={t('talk.photo')} className="h-full w-full object-cover" /></button>}
      <span className="mt-1 pr-1 text-[10.5px] text-muted">{m.time}</span>
      {selected && <div className="mt-1.5 flex gap-1.5 animate-rise"><Act icon={I.Trash} label={t('talk.delete')} onClick={() => onDelete(m.id)} danger />{reports&&m.serverId&&<Act icon={I.Comment} label={isZh(lang)?'举报':'Report'} onClick={()=>reports.open({subjectType:'message',subjectId:m.serverId!})}/>}</div>}
    </div>
  )
  const mine = m.kind === 'me'
  const p = speaker ?? who
  const avatar = p && <Lens world={p.world} avatar={p.avatar} name={p.name} size={32} />
  return (
    <div className={`flex gap-2 items-end ${mine ? 'justify-end animate-rise' : 'msg-in'}`}>
      {!mine && p && (onAvatar
        ? <button onClick={(e) => { e.stopPropagation(); onAvatar() }} aria-label={p.name} className="chat-avatar mb-5 shrink-0 rounded-full active:scale-95 transition-transform">{avatar}</button>
        : <span className="chat-avatar mb-5 shrink-0">{avatar}</span>)}
      <div className={`min-w-0 max-w-[76%] flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
        {!mine && speaker && <span className="mb-1 pl-1 text-[11.5px] text-ink-soft">{speaker.name}</span>}
        <button onClick={(e) => { e.stopPropagation(); onSelect() }} aria-expanded={selected} data-direction={mine ? 'outgoing' : 'incoming'} data-selected={selected}
          className={`chat-message-bubble max-w-full whitespace-pre-wrap [overflow-wrap:anywhere] text-left text-[16px] leading-relaxed px-4 py-2.5 transition-shadow ${mine ? 'btn-dark rounded-[20px] rounded-br-md shadow-[0_12px_28px_-18px_rgba(41,69,66,0.8)]' : 'glass-light text-ink rounded-[20px] rounded-bl-md'} ${selected ? 'ring-2 ring-sun/70' : ''}`}>
          {mine && m.voice && <span className="mr-1.5 inline-flex align-[-2px] opacity-60"><I.Mic className="h-3.5 w-3.5" /></span>}
          {m.text}
        </button>
        {selected && (
          <div className={`chat-message-actions mt-1.5 flex flex-wrap gap-1.5 animate-rise ${mine ? 'justify-end' : ''}`}>
            {!mine && <Act icon={I.Speaker} label={t('talk.speak')} onClick={() => onSpeak(m.text)} />}
            <Act icon={I.Copy} label={t('talk.copy')} onClick={() => onCopy(m.text)} />
            {!mine && m.kind === 'him' && m.generationKind !== 'photo_reply' && m.sourceDomain === undefined && onRemember && <Act icon={I.Keep} label={t('talk.remember')} onClick={() => onRemember(m.canRemember ?? { id: 0, title: t('talk.mentioned'), body: m.text })} />}
            <Act icon={I.Trash} label={t('talk.delete')} onClick={() => onDelete(m.id)} danger />
            {reports&&m.serverId&&<Act icon={I.Comment} label={isZh(lang)?'举报':'Report'} onClick={()=>reports.open({subjectType:'message',subjectId:m.serverId!})}/>}
          </div>
        )}
        <span className={`chat-message-time mt-1 text-[10.5px] text-muted ${mine ? 'pr-1' : 'pl-1'}`}>{m.time}{mine && m.voice ? ` · ${t('talk.voiceMsg')}` : ''}</span>
      </div>
    </div>
  )
}
function Act({ icon: Icon, label, onClick, danger }: { icon: (p: { className?: string }) => React.ReactElement; label: string; onClick: () => void; danger?: boolean }) {
  return <button onClick={(e) => { e.stopPropagation(); onClick() }} className="inline-flex items-center gap-1.5 rounded-full glass-light px-3 py-1.5 text-[13px] text-ink"><Icon className={`h-3.5 w-3.5 ${danger ? 'text-coral' : 'text-sky-deep'}`} />{label}</button>
}

export function LetterCard({ l, person, onReadSource }: { l: Letter; person: Person; onReadSource?: () => void }) {
  const { t, lang } = useI18n()
  const zh = isZh(lang)
  const servicePending = l.serverId && l.wantReply && !l.reply ? l.replyState === 'failed'
    ? (zh ? '回信暂未完成 · AI 撰写' : 'The reply could not be completed · Written by AI')
    : l.replyState === 'blocked' || l.replyState === 'canceled'
      ? (zh ? '本次回信已停止 · AI 撰写' : 'This reply has stopped · Written by AI')
      : l.replyAt && l.replyAt > Date.now()
        ? t('letter.pending', { when: new Date(l.replyAt).toLocaleString(lang, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', ...(l.timeZone ? { timeZone: l.timeZone } : {}) }) })
        : (zh ? '正在等待回信 · AI 撰写' : 'Waiting for a reply · Written by AI')
    : undefined
  return (
    <div className="space-y-2.5">
      <div className="letter-paper rounded-2xl paper-fringe px-4 py-3.5 shadow-[0_12px_30px_-24px_rgba(41,69,66,0.6)]">
        <p className="font-mono text-[10px] tracking-[0.16em] text-ink-soft">{t('letter.mine', { date: l.date })}</p>
        <p className="mt-2 font-serif text-[16.5px] leading-[1.9] text-ink whitespace-pre-wrap [overflow-wrap:anywhere]">{l.text}</p>
        {onReadSource && <button type="button" onClick={onReadSource} className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-[13px] text-sky-deep">
          <I.Keep className="h-4 w-4" />{zh ? '查看关联的回忆原文' : 'Read the linked original memory'}
        </button>}
      </div>
      {l.reply ? (
        <div className={`ml-6 rounded-2xl bg-sun-tint/70 ring-1 ring-sun/40 px-4 py-3.5 ${l.replyNew ? 'rise-in' : ''}`}>
          <div className="flex items-center gap-2 mb-1.5"><Lens world={person.world} avatar={person.avatar} name={person.name} size={24} /><span className="font-mono text-[10px] tracking-[0.14em] text-sun-deep">{t('letter.replyFrom', { name: person.name })}</span></div>
          <p className="font-serif text-[16px] leading-[1.9] text-ink whitespace-pre-wrap [overflow-wrap:anywhere]">{l.reply}</p>
        </div>
      ) : servicePending ? <p className="ml-6 font-mono text-[10.5px] tracking-[0.12em] text-ink-soft" role="status">{servicePending}</p> : l.wantReply && l.replyAt ? (
        <p className="ml-6 font-mono text-[10.5px] tracking-[0.12em] text-ink-soft">{t('letter.pending', { when: l.replyAt - Date.now() < 60000 ? t('letter.when.now') : t(isTomorrow(l.replyAt) ? 'letter.when.tomorrow' : 'letter.when.today') })}</p>
      ) : null}
    </div>
  )
}
export function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex items-baseline justify-between gap-4 px-4 py-3.5"><span className="max-w-1/2 text-[14px] text-ink-soft [overflow-wrap:anywhere]">{k}</span><span className="min-w-0 text-[14.5px] text-ink text-right [overflow-wrap:anywhere]">{v}</span></div>
}

/* ============================== 珍藏记忆 ============================== */
type MemoryConfirmation = MemoryCandidateBinding | { kind: 'manual'; intentId: string }
type MemoryPreparation = { service: MemoryService; personId: string; source: MemorySource }
export function MemorySheet({ title, note, draft, editing: startEditing, preparation, onConfirm, onClose }: {
  title: string; note?: string; draft: Memory; editing?: boolean; preparation?: MemoryPreparation
  onConfirm: (m: Memory, selection?: MemoryConfirmation) => void | boolean | Promise<void | boolean>; onClose: () => void
}) {
  const { t, lang } = useI18n(), zh = isZh(lang)
  const [m, setM] = useState(draft)
  const [editing, setEditing] = useState(!!startEditing)
  const [saving, setSaving] = useState(false)
  const [preparing, setPreparing] = useState(!!preparation)
  const [candidateInvalid, setCandidateInvalid] = useState(false)
  const revision = useRef(0), mounted = useRef(true)
  const interacted = useRef(!!startEditing), savingNow = useRef(false)
  const selectedCandidate = useRef<MemoryConfirmation | undefined>(undefined)
  const preparationNow = useRef(preparation); preparationNow.current = preparation
  const preparingRequest = useRef<AbortController | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!preparation) { setPreparing(false); return }
    const controller = new AbortController()
    preparingRequest.current = controller
    setPreparing(true)
    const live = () => mounted.current && !controller.signal.aborted
      && preparationNow.current?.service === preparation.service && preparationNow.current?.personId === preparation.personId
      && preparationNow.current?.source.sourceMessageId === preparation.source.sourceMessageId
      && preparationNow.current?.source.sourceMessageVersion === preparation.source.sourceMessageVersion
    void preparation.service.prepareCandidate(preparation.personId, preparation.source, controller.signal).then(candidate => {
      if (!live() || !candidate || interacted.current || savingNow.current || revision.current !== 0) return
      selectedCandidate.current = { candidateId: candidate.id, candidateVersion: candidate.version }
      setM({ ...draft, title: candidate.title!, body: candidate.body! })
    }).catch(() => {
      if (live()) preparation.service.report(zh ? '暂时没能整理，仍可修改并珍藏原文。' : 'The suggestion is unavailable. You can still edit and keep the original text.')
    }).finally(() => { if (live()) setPreparing(false) })
    return () => { controller.abort(); if (preparingRequest.current === controller) preparingRequest.current = null }
  }, [preparation?.service, preparation?.personId, preparation?.source.sourceMessageId, preparation?.source.sourceMessageVersion])
  const freezeSuggestion = () => {
    interacted.current = true
    preparingRequest.current?.abort()
    setPreparing(false)
  }
  const change = (next: Memory) => { freezeSuggestion(); revision.current++; setM(next) }
  const confirm = async (manual = false) => {
    if (savingNow.current) return
    freezeSuggestion()
    preparingRequest.current?.abort(); setPreparing(false)
    if (manual) {
      selectedCandidate.current = { kind: 'manual', intentId: crypto.randomUUID() }
      setCandidateInvalid(false)
      preparation?.service.report(zh ? '按当前文字手动珍藏。' : 'Keeping your current text as a handwritten memory.')
    }
    const sentRevision = revision.current
    const selection = selectedCandidate.current
    savingNow.current = true
    setSaving(true)
    try {
      const result = await onConfirm({ ...m, title: m.title.trim() || Array.from(m.body.trim()).slice(0, 10).join('') }, selection)
      if (mounted.current && result === true && revision.current === sentRevision) onClose()
    } catch (error) {
      if (mounted.current && error instanceof MemoryCandidateError) setCandidateInvalid(true)
      else if (mounted.current) preparation?.service.report(zh ? '还没能确认是否保存成功，内容已保留，请重试。' : 'We could not confirm whether it was saved. Your input is kept; please retry.')
    } finally { savingNow.current = false; if (mounted.current) setSaving(false) }
  }
  const canSave = Boolean(m.title.trim() || m.body.trim())
  return (
    <Sheet onClose={onClose} title={title}
      footer={<div className="flex flex-wrap items-center gap-2">
        <button onClick={onClose} className="min-h-11 rounded-full px-3.5 py-2.5 text-[15px] text-ink-soft">{t('mem.discard')}</button>
        {!startEditing && <button onClick={() => { freezeSuggestion(); setEditing((v) => !v) }} className="min-h-11 rounded-full ring-1 ring-line px-3.5 py-2.5 text-[15px] text-ink-soft">{editing ? t('mem.editDone') : t('mem.edit')}</button>}
        {candidateInvalid && <button disabled={!canSave || saving} onClick={() => { void confirm(true) }} className="min-h-11 rounded-full ring-1 ring-line px-3.5 py-2.5 text-[15px] text-ink-soft disabled:opacity-50">{zh ? '按手写保存' : 'Keep as handwritten'}</button>}
        <button disabled={!canSave || saving || candidateInvalid} aria-busy={saving} onClick={() => { void confirm() }} className="min-h-11 grow rounded-full btn-dark px-3.5 py-2.5 text-[16px] font-semibold active:scale-[0.98] transition-transform disabled:opacity-50">{t('mem.confirm')}</button>
      </div>}>
      <div className="rounded-2xl glass-light p-4">
        {editing ? (
          <>
            <input autoFocus value={m.title} onFocus={freezeSuggestion} onChange={(e) => change({ ...m, title: e.target.value })} aria-label={t('keep.t.ph')} placeholder={t('keep.t.ph')} className="w-full bg-transparent font-serif text-[20px] text-ink border-b border-line pb-2 placeholder:text-muted focus-visible:outline-2 focus-visible:outline-sky-deep" />
            <textarea value={m.body} onFocus={freezeSuggestion} onChange={(e) => change({ ...m, body: e.target.value })} rows={4} aria-label={t('keep.b.ph')} placeholder={t('keep.b.ph')} className="mt-3 w-full resize-none bg-transparent text-[15.5px] leading-relaxed text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-sky-deep" />
          </>
        ) : (<><h3 className="font-serif text-[21px] text-ink">{m.title}</h3><p className="mt-2 text-[15.5px] leading-relaxed text-ink-soft">{m.body}</p></>)}
      </div>
      {note && <p className="mt-3 text-[12.5px] text-muted">{note}</p>}
      {preparing && <p role="status" className="mt-3 text-[12.5px] text-muted">{zh ? '正在整理…' : 'Preparing…'}</p>}
    </Sheet>
  )
}

/* ================================ 写信 ================================ */
type LetterDraftRecord = { value: LetterDraft; version: object }
type LetterComposerProps = { person: Person; draftOwner: string; onClose: () => void; onSent: (l: Letter) => void; serviceAccount?: boolean; service?: LetterService; memory?: Memory }
const letterDrafts = new Map<string, LetterDraftRecord>()
if(typeof window!=='undefined'&&typeof window.addEventListener==='function')window.addEventListener('xijie:private-drafts-erased',event=>{const id=(event as CustomEvent<{accountId?:string}>).detail?.accountId;if(typeof id!=='string')return;for(const key of letterDrafts.keys()){try{if(JSON.parse(key)[0]==='account.'+id)letterDrafts.delete(key)}catch{/* Do not clear another identity based on a draft body. */}}})

export function LetterComposer(props: LetterComposerProps) {
  const { person, draftOwner, serviceAccount } = props
  const draftKey = JSON.stringify([draftOwner, serviceAccount && person.serverId ? ['server', person.serverId] : person.localId ? ['identity', person.localId] : ['legacy', person.id]])
  return <LetterComposerView key={draftKey} {...props} draftKey={draftKey} />
}

function LetterComposerView({ person, onClose, onSent, draftKey, serviceAccount = false, service, memory }: LetterComposerProps & { draftKey: string }) {
  const { t, lang } = useI18n()
  const night = useContext(NightCtx)
  useStatusTone(night ? 'light' : 'dark')
  const [draft, setDraft] = useState<LetterDraftRecord>(() => service ? { value: service.draft(), version: {} } : letterDrafts.get(draftKey) ?? { value: { text: '', wantReply: true, when: 'morning' }, version: {} })
  const currentDraft = useRef(draft)
  currentDraft.current = draft
  const { text, wantReply, when } = draft.value
  const memoryCharacters = memory ? [...memory.body.trim()] : []
  const excerpt = memoryCharacters.slice(0, 600).join('')
  const includesExcerpt = !!excerpt && text.includes(excerpt)
  const source = memory?.serverId && memory.serverVersion ? { id: memory.serverId, version: memory.serverVersion } : undefined
  const alreadyLinked = source && source.id === draft.value.sourceMemory?.id && source.version === draft.value.sourceMemory?.version
  const canInclude = !!excerpt && (!includesExcerpt || !!source && !alreadyLinked)
  const sealing = useRef(false)
  const active = useRef(true)
  const submitting = useRef(false)
  const [busy, setBusy] = useState(false)
  const locked = busy || !!service?.pending()
  const timers = useRef<number[]>([])
  const after = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)) }
  useEffect(() => { active.current = true; return () => { active.current = false; timers.current.forEach(clearTimeout) } }, [])
  const updateDraft = (patch: Partial<LetterDraft>) => {
    if (sealing.current || submitting.current || service?.pending()) return
    const next = { value: { ...currentDraft.current.value, ...patch }, version: {} }
    currentDraft.current = next
    if (service) service.saveDraft(next.value)
    else if (next.value.text.trim()) letterDrafts.set(draftKey, next)
    else letterDrafts.delete(draftKey)
    setDraft(next)
  }
  const [stage, setStage] = useState<'write' | 'fold' | 'fly' | 'done'>('write')
  const [notice, setNotice] = useState<string | null>(null)
  const letterBody = useRef<HTMLTextAreaElement>(null)
  const includeExcerpt = () => {
    if (!canInclude || locked) return
    const merged = includesExcerpt ? text : [currentDraft.current.value.text.trimEnd(), excerpt].filter(Boolean).join('\n\n')
    if ([...merged].length > 10000) {
      setNotice(isZh(lang) ? '这封信已接近一万字。请先腾出一些空间，再带入回忆。' : 'This letter is nearly 10,000 characters. Make some room before adding the memory.')
      return
    }
    setNotice(null)
    updateDraft({ text: merged, ...(source ? { sourceMemory: source } : {}) })
    letterBody.current?.focus({ preventScroll: true })
  }
  const close = () => { if (!sealing.current) onClose() }
  const nativeBackRoot = useRef<HTMLDivElement>(null)
  useNativeBack(() => {
    // Sealing already schedules delivery and dismissal; do not unmount it halfway.
    if (stage === 'write') close()
    return true
  }, true, 55, nativeBackRoot)
  const seal = async () => {
    if (sealing.current || submitting.current) return
    const sentDraft = currentDraft.current
    const tx = sentDraft.value.text.trim(); if (!tx) return
    if (serviceAccount && !service) { setNotice(isZh(lang) ? '信件暂时无法寄出，内容已保留，请稍后重试。' : 'Your letter could not be sent right now. Its text is kept; please try again later.'); after(2400, () => setNotice(null)); return }
    let letter: Letter
    if (service) {
      submitting.current = true; setBusy(true); setNotice(null)
      try { letter = letterView(await service.send(sentDraft.value), nid(), lang) }
      catch (error) {
        if (active.current) { setNotice(letterMessage(error, isZh(lang))); after(4000, () => setNotice(null)) }
        return
      } finally { submitting.current = false; if (active.current) setBusy(false) }
      if (!active.current) return
    } else letter = { id: Date.now(), date: fmtDate(lang), text: tx, wantReply: sentDraft.value.wantReply, replyAt: sentDraft.value.wantReply ? (sentDraft.value.when === 'now' ? Date.now() + 2600 : nextMorning()) : undefined }
    sealing.current = true
    const deliver = () => {
      if (!service) { onSent(letter); if (letterDrafts.get(draftKey)?.version === sentDraft.version) letterDrafts.delete(draftKey) }
    }
    haptic([8, 40, 12])
    if (fxPrefs.calm) { deliver(); setStage('done'); after(1400, onClose); return }
    setStage('fold')
    after(650, () => setStage('fly'))
    after(1500, () => { setStage('done'); deliver(); chime('tick') })
    after(2900, onClose)
  }
  return (
    <div ref={nativeBackRoot} role="dialog" aria-modal="true" aria-label={t('letter.to', { name: person.name })} className="absolute inset-0 z-[90] overflow-hidden" style={{ background: 'var(--wb)' }}>
      {stage !== 'write' && <div className="absolute inset-x-0 top-[var(--app-status-height)] h-[42%] animate-fade-slow"><WorldScene world={person.world} /><div className="absolute inset-x-0 bottom-0 h-2/3" style={{ background: `linear-gradient(to bottom, transparent, var(--wb))` }} /></div>}
      {stage !== 'write' && (
        <div className="absolute left-1/2 top-[19%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
          {(stage === 'fly' || stage === 'done') && <span className="absolute"><Arrival world={person.world} /></span>}
          <span className={`h-14 w-14 rounded-full glass-light flex items-center justify-center text-ink transition-all duration-500 ${stage === 'done' ? 'ring-2 ring-sun scale-110' : 'opacity-80'}`}><LetterGlyph world={person.world} className="h-7 w-7" /></span>
        </div>
      )}

      <div inert={stage !== 'write'} className="absolute inset-0 flex flex-col" style={{ perspective: 1200 }}>
        <div className={`pt-[calc(var(--app-status-height)+6px)] px-5 flex items-center justify-between transition-opacity duration-300 ${stage === 'write' ? '' : 'opacity-0'}`}>
          <button onClick={close} disabled={stage !== 'write'} aria-label={t('common.close')} className="h-11 w-11 flex items-center justify-center rounded-full glass-light text-ink-soft"><I.X className="h-5 w-5" /></button>
          <span className="font-mono text-[10px] tracking-[0.2em] text-muted">{fmtDate(lang)}</span>
        </div>
        <div className="relative flex-1 min-h-0 mx-5 mt-4 mb-4">
          <div className="letter-paper absolute inset-0 rounded-[24px] paper-fringe shadow-[0_30px_60px_-36px_rgba(41,69,66,0.6)] origin-center"
            style={{
              transition: 'transform .65s cubic-bezier(0.65,0,0.35,1), opacity .4s, border-radius .4s',
              transform: stage === 'write' ? 'none' : stage === 'fold' ? 'rotateX(58deg) scaleY(0.34) scaleX(0.82)' : 'translateY(-420px) scale(0.06)',
              opacity: stage === 'fly' || stage === 'done' ? 0 : 1,
              transitionDuration: stage === 'fly' ? '.8s, .8s, .4s' : undefined,
            }}>
            <div className={`h-full flex flex-col px-6 pt-6 pb-4 transition-opacity duration-200 ${stage === 'write' ? '' : 'opacity-0'}`}>
              <h2 className="font-serif text-[24px] text-ink [overflow-wrap:anywhere]">{t('letter.to', { name: person.name })}</h2>
              {memory && excerpt && <div className="mt-3 flex shrink-0 flex-wrap items-center gap-x-3 rounded-xl border border-line px-3 py-1">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-ink-soft">{isZh(lang) ? '这段回忆' : 'Memory'}</p>
                  <p className="truncate text-[13px] text-ink">{memory.title}</p>
                </div>
                <button type="button" onClick={includeExcerpt} disabled={locked || !canInclude} className="shrink-0 min-h-11 text-[13px] font-medium text-sky-deep disabled:text-ink-soft">
                  {includesExcerpt ? (canInclude ? (isZh(lang) ? '关联这段回忆' : 'Link this memory') : (isZh(lang) ? '已带入正文' : 'Added to the letter')) : memoryCharacters.length > 600
                    ? (isZh(lang) ? '带入开头 600 字' : 'Add first 600 characters')
                    : (isZh(lang) ? '带入正文' : 'Add to letter')}
                </button>
              </div>}
              {draft.value.sourceMemory && <div className="flex shrink-0 items-center justify-between gap-2">
                <p className="text-[12px] text-ink-soft">{isZh(lang) ? '信件与这段回忆关联' : 'Letter linked to this memory'}</p>
                <button type="button" disabled={locked} className="min-h-10 text-[12px] text-sky-deep" onClick={() => updateDraft({ sourceMemory: undefined })}>
                  {isZh(lang) ? '取消关联' : 'Unlink'}
                </button>
              </div>}
              <textarea ref={letterBody} autoFocus value={text} readOnly={locked} onChange={(e) => updateDraft({ text: e.target.value })} aria-label={t('letter.ph')} placeholder={t('letter.ph')} className="mt-3 min-h-0 flex-1 resize-none bg-transparent outline-none font-serif text-[18px] leading-[34px] text-ink placeholder:text-ink-soft caret-sky-deep focus-visible:outline-2 focus-visible:outline-sky-deep" />
            </div>
            {stage === 'fold' && <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-10 w-10 rounded-full pop-in" style={{ background: 'radial-gradient(circle, #f6dcae, #c99b56)', boxShadow: '0 0 24px rgba(235,201,149,0.9)' }} />}
          </div>
          {stage === 'fly' && <span className="absolute left-1/2 top-1/2 h-3 w-3 -ml-1.5 rounded-full dot-fly" style={{ background: '#fff7e6', boxShadow: '0 0 18px 6px rgba(235,201,149,0.85)', ['--dx' as string]: '0px', ['--dy' as string]: '-360px' } as React.CSSProperties} />}
        </div>
        <div className={`px-5 pb-9 transition-opacity duration-300 ${stage === 'write' ? '' : 'opacity-0 pointer-events-none'}`}>
          <div inert={locked} className="rounded-2xl glass-light overflow-hidden"><Switch on={wantReply} onToggle={() => updateDraft({ wantReply: !currentDraft.current.value.wantReply })} label={t('letter.reply')} desc={t('letter.reply.ai')} /></div>
          {wantReply && (
            <div className="mt-2.5 flex gap-1 rounded-full bg-black/[0.04] p-1">
              {(['morning', 'now'] as const).map((k) => <button key={k} disabled={locked} onClick={() => updateDraft({ when: k })} aria-pressed={when === k} className={`flex-1 min-h-11 rounded-full px-1.5 py-1 text-[14px] transition-colors ${when === k ? 'bg-paper text-ink shadow-sm' : 'text-ink-soft'}`}>{t(k === 'morning' ? 'letter.when.morning' : 'letter.when.now')}</button>)}
            </div>
          )}
          <button onClick={() => void seal()} disabled={!text.trim() || busy || stage !== 'write'} aria-busy={busy} className="letter-seal mt-3 w-full h-14 rounded-full btn-dark text-[16.5px] font-semibold tracking-[0.12em] active:scale-[0.98] transition-all">{t('letter.seal')}</button>
        </div>
      </div>
      {stage === 'done' && <Toast text={t('letter.kept')} />}
      {notice && <Toast text={notice} />}
    </div>
  )
}

/* ================================ 通话 ================================ */
type CallState = 'primer' | 'connecting' | 'listening' | 'thinking' | 'replying' | 'interrupted'
export function CallOverlay({ person, mode, onSwitchVoice, onClose, onEnd,serviceAccount=false,voiceService,onServiceFeedback }: { serviceAccount?:boolean;voiceService?:VoiceCallContext;onServiceFeedback?:(message:string)=>void;person: Person; mode: 'voice' | 'video'; onSwitchVoice: () => void; onClose: () => void; onEnd: (secs: number) => void }) {
  const { t, lang } = useI18n()
  const night = useContext(NightCtx)
  useStatusTone(night ? 'light' : 'dark')
  const lines = callLines(lang)
  const video = mode === 'video'
  const preview=serviceAccount&&video,realVoice=serviceAccount&&!video&&!!voiceService,voice=useVoiceCall(realVoice?voiceService:undefined),zh=isZh(lang)
  const [prototypeState, setSt] = useState<CallState>('primer')
  const st:CallState=realVoice?voice.phase:prototypeState
  const [prototypeCaption,setCap]=useState('')
  const cap=realVoice?voice.caption:preview&&st!=='primer'?(zh?'资料照片的动态预览，不是实时视频。':'An animated profile photo preview, not live video.'):prototypeCaption
  const [prototypeSeconds,setSecs]=useState(0)
  const secs=realVoice?voice.seconds:prototypeSeconds
  const [prototypeMuted,setMuted]=useState(false)
  const muted=realVoice?voice.muted:prototypeMuted
  const [captions, setCaptions] = useState(true)
  const [prototypeLoud,setLoud]=useState(true)
  const loud=realVoice?voice.loud:prototypeLoud
  const live = !preview&&st !== 'primer' && st !== 'connecting'
  const closeCall = () => {
    window.speechSynthesis?.cancel()
    if(serviceAccount){if(realVoice)void voice.end().finally(onClose);else onClose();return}
    if (live) onEnd(secs)
    else onClose()
  }
  const lastVoiceFeedback=useRef('')
  useEffect(()=>{if(voice.error&&voice.error!==lastVoiceFeedback.current)onServiceFeedback?.(voice.error);lastVoiceFeedback.current=voice.error},[voice.error,onServiceFeedback])
  useEffect(()=>{if(realVoice&&voice.call&&['ended','failed','expired'].includes(voice.call.state))onClose()},[realVoice,voice.call?.state,onClose])
  const nativeBackRoot = useRef<HTMLDivElement>(null)
  useNativeBack(() => { closeCall(); return true }, true, 40, nativeBackRoot)
  const timers = useRef<number[]>([])
  const after = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)) }
  const clear = () => { timers.current.forEach(clearTimeout); timers.current = [] }
  useEffect(() => () => { clear(); window.speechSynthesis?.cancel() }, [])
  useEffect(() => { if (!live||realVoice||preview) return; const id = window.setInterval(() => setSecs((s) => s + 1), 1000); return () => clearInterval(id) }, [live,realVoice,preview])

  const type = (full: string, done?: () => void) => {
    setCap(''); let i = 0
    const tick = () => { i++; setCap(full.slice(0, i)); if (i < full.length) timers.current.push(window.setTimeout(tick, 42)); else done?.() }
    timers.current.push(window.setTimeout(tick, 120))
  }
  const say = (line: string) => { setSt('replying'); if ((person.hasVoice || video) && loud) speak(line, lang); type(line, () => after(500, () => setSt('listening'))) }
  const start = () => {
    if(preview){setSt('listening');return}
    if(serviceAccount){if(realVoice)void voice.start();else onServiceFeedback?.(zh?'语音通话暂时不可用。':'Voice calling is currently unavailable.');return}
    setSt('connecting'); haptic(8)
    after(fxPrefs.calm ? 200 : 1050, () => { haptic([10, 30, 10]); chime('connect'); say(video ? lines.openVideo : person.hasVoice ? lines.openVoice : lines.openNoVoice) })
  }
  const talk = () => { if(serviceAccount){if(realVoice)voice.listen();return};clear(); setSt('thinking'); after(900, () => say(lines.ack)) }
  const interrupt = () => { if(serviceAccount){if(realVoice)voice.interrupt();return};clear(); window.speechSynthesis?.cancel(); setSt('interrupted'); setCap(''); after(700, () => setSt('listening')) }
  const label: Record<CallState, string> = { primer: '', connecting: t('call.connecting'), listening: preview?(zh?'预览中':'Preview'):t('call.listening'), thinking: t('call.thinking'), replying: t('call.replying', { name: person.name }), interrupted: t('call.interrupted') }
  const speaking = st === 'replying'

  return (
    <div ref={nativeBackRoot} role="dialog" aria-modal="true" aria-label={preview?(zh?'动态照片预览':'Moving photo preview'):t(video ? 'call.video.label' : 'call.label')} className="call-shell absolute inset-0 z-[80] flex flex-col overflow-hidden" data-tone={night ? 'night' : 'day'}>
      {night && <DeepField />}
      <div className="call-scene absolute inset-x-0 top-[var(--app-status-height)] bottom-0" aria-hidden><WorldScene world={person.world} /></div>
      <div className="call-scrim absolute inset-0" aria-hidden />

      <div className="relative z-10 shrink-0 pt-[calc(var(--app-status-height)+6px)] px-5 flex items-center gap-3">
        <button autoFocus onClick={closeCall} aria-label={t('common.back')} className="call-surface h-11 w-11 shrink-0 flex items-center justify-center rounded-full glass-dim"><I.Back className="h-5 w-5" /></button>
        <div className="min-w-0 flex-1 text-center">
          <div title={person.name} className="truncate font-serif text-[22px] leading-tight tracking-[0.1em]">{person.name}</div>
          <div className="call-secondary mt-1 truncate font-mono text-[9.5px] tracking-[0.18em]">{preview?(zh?'动态照片预览':'Moving photo preview'):video ? t('call.video.label') : t('call.label')}</div>
        </div>
        <div className="call-secondary h-11 w-11 shrink-0 flex items-center justify-center font-mono text-[11px]">{live ? fmtDuration(secs) : ''}</div>
      </div>

      <div className="relative z-10 flex-1 min-h-0 overflow-y-auto scroll-quiet">
      <div className="min-h-full flex flex-col items-center justify-center px-6 py-4">
        <div className={`call-portrait relative shrink-0 flex items-center justify-center ${video ? 'call-portrait-video' : ''}`}>
          {speaking && [0, 1, 2].map((i) => <span key={i} className={`absolute ${video ? 'rounded-[110px]' : 'rounded-full'} border border-sun/60 fx ring-out`} style={{ inset: 26, animationDelay: `${i * 0.6}s`, animationDuration: '2.2s' }} />)}
          {st === 'listening' && !muted && [0, 1].map((i) => <span key={i} className={`absolute ${video ? 'rounded-[110px]' : 'rounded-full'} border border-lake/60 fx ring-out`} style={{ inset: 30, animationDelay: `${i * 0.9}s`, animationDuration: '2.6s' }} />)}
          {video && person.avatar ? (
            <span className="relative block h-[86%] w-[190px] max-w-[90%] rounded-[100px] overflow-hidden" style={{ boxShadow: '0 0 0 1px rgba(235,201,149,0.7), 0 30px 60px -30px rgba(0,0,0,0.9)' }}>
              <img src={lg(person.avatar)} alt="" className={`absolute inset-0 h-full w-full object-cover ${live ? 'fx livecam' : ''}`} />
              <span className="absolute inset-0" style={{ background: 'radial-gradient(circle at 30% 18%, rgba(255,255,255,0.35), transparent 40%)' }} />
            </span>
          ) : <Lens world={person.world} avatar={person.avatar} name={person.name} size={168} dark={night} glow={speaking} />}
          {!video && (st === 'connecting' || live) && <ArcRing size={196} lit={6} seq={st === 'connecting'} step={150} className="absolute" />}
        </div>

        {st === 'primer' ? (
          <div className="mt-4 text-center rise-in">
            <h2 className="font-serif text-[24px] tracking-[0.08em]">{video ? t('call.primer.video') : t('call.primer')}</h2>
            <p className="call-secondary mt-2 text-[13.5px]">{preview?(zh?'仅预览资料照片，不使用麦克风或摄像头。':'Profile photo preview only. Microphone and camera are not used.'):t('call.primer.note')}</p>
            <button onClick={start} disabled={realVoice&&voice.busy} className="call-primary mt-5 min-h-14 px-9 py-2 rounded-full btn-light text-[16.5px] font-semibold tracking-[0.12em] active:scale-[0.98] transition-transform">{preview?(zh?'开始预览':'Start preview'):realVoice&&voice.busy?(zh?'正在准备…':'Preparing…'):t('call.connect')}</button>
            {realVoice&&voiceService&&<details className="mt-3 text-left text-[12px]"><summary>{zh?'查看语音处理授权':'Voice processing permission'}</summary><VoiceCallsPermission sessionId={voiceService.sessionId} onUnauthorized={voiceService.onUnauthorized}/></details>}
            {realVoice&&voice.error&&<p role="alert" className="call-secondary mt-3 text-[13px]">{voice.error}</p>}
          </div>
        ) : (
          <div className="mt-4 w-full text-center">
            <div role="status" className="call-secondary font-mono text-[10.5px] tracking-[0.24em] uppercase">{label[st]}</div>
            {captions && <p className="call-caption mt-3 min-h-[4rem] font-serif text-[21px] leading-relaxed">{cap || (st === 'listening' ? t('call.idle') : '')}{speaking && <span className="caret ml-0.5 inline-block h-[1em] w-px bg-current opacity-70 align-middle" />}</p>}
          </div>
        )}
      </div>
      </div>

      {live && (
        <div className="relative z-10 shrink-0 px-4 pb-6 rise-in">
          <div className="flex justify-center mb-4">
            {st === 'replying' || st === 'thinking'
              ? <button onClick={interrupt} className="call-surface h-16 w-16 flex flex-col items-center justify-center rounded-full glass-dim active:scale-95 transition-transform"><I.Stop className="h-6 w-6" /><span className="mt-0.5 text-[10px]">{t('call.interrupt')}</span></button>
              : <button onClick={talk} disabled={muted||preview} className="call-primary relative h-16 w-16 flex items-center justify-center rounded-full btn-light active:scale-95 transition-transform"><I.Mic className="h-7 w-7" /><span className="sr-only">{t('call.talk')}</span></button>}
          </div>
          <div className="grid grid-cols-4 gap-2">
            <CallBtn icon={muted ? I.MicOff : I.Mic} label={t('call.mute')} on={muted} onClick={() => realVoice?voice.mute():setMuted((v) => !v)} disabled={preview} />
            <CallBtn icon={I.Captions} label={t('call.captions')} on={captions} onClick={() => setCaptions((v) => !v)} />
            <CallBtn icon={I.Speaker} label={t('call.speaker')} on={loud} onClick={() => {if(realVoice)voice.speaker();else{setLoud((v) => !v);window.speechSynthesis?.cancel()}}} disabled={preview} />
            <button onClick={closeCall} className="flex min-w-0 flex-col items-center gap-1.5"><span className="w-full max-w-14 aspect-square rounded-full bg-coral text-pearl flex items-center justify-center active:scale-95 transition-transform"><I.Hangup className="h-6 w-6" /></span><span className="call-secondary max-w-full text-[11.5px] [overflow-wrap:anywhere]">{t('call.hangup')}</span></button>
          </div>
          {video && <button onClick={onSwitchVoice} className="call-secondary mt-1 min-h-11 mx-auto block text-[12.5px] underline underline-offset-2">{t('call.toVoice')}</button>}
        </div>
      )}
    </div>
  )
}
function CallBtn({ icon: Icon, label, on, onClick,disabled=false }: { disabled?:boolean;icon: (p: { className?: string }) => React.ReactElement; label: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-pressed={on} className="flex min-w-0 flex-col items-center gap-1.5">
      <span className={`w-full max-w-14 aspect-square rounded-full flex items-center justify-center transition-colors active:scale-95 ${on ? 'call-primary btn-light' : 'call-surface glass-dim'}`}><Icon className="h-6 w-6" /></span>
      <span className="call-secondary max-w-full text-[11.5px] [overflow-wrap:anywhere]">{label}</span>
    </button>
  )
}

/* ============================== 关于 TA =============================== */
export type PersonManagement = {
  voiceContext?:import('./model').PersonVoiceContext
  save: (patch: Partial<Person>) => Promise<void>
  replacePhotos: (selection: PhotoChoice[]) => Promise<void>
  move: (world: WorldId) => Promise<void>
  remove: () => Promise<void>
  reload: () => Promise<void>
}

type ManagementFailure = { kind: 'conflict' | 'missing' | 'other'; text: string }
function managementFailure(error: unknown, zh: boolean, editing = true): ManagementFailure {
  const problem = error && typeof error === 'object' ? error as { code?: unknown; status?: unknown } : {}
  if (problem.code === 'VERSION_CONFLICT' || problem.status === 412) return {
    kind: 'conflict', text: editing
      ? zh ? '资料已在另一处修改。你刚填写的内容还在；点击「查看最新资料」会用最新资料替换当前未保存的内容。' : 'This profile changed elsewhere. Your edits are kept. View latest profile will replace these unsaved edits with the latest saved information.'
      : zh ? '资料已在另一处修改，请先查看最新资料，再决定是否移除。' : 'This profile changed elsewhere. View the latest profile before deciding whether to remove it.',
  }
  if (problem.code === 'NOT_FOUND' || problem.status === 404) return {
    kind: 'missing', text: zh ? '这位人物已被移除，或暂时无法访问。' : 'This person was removed or is no longer available.',
  }
  if (problem.code === 'UNAUTHENTICATED' || problem.status === 401) return {
    kind: 'other', text: zh ? '登录已失效，请重新登录后再试。' : 'Your session has expired. Sign in again to continue.',
  }
  if (problem.code === 'FORBIDDEN' || problem.status === 403) return {
    kind: 'other', text: editing
      ? zh ? '请先到「我」的「隐私与 AI 说明」同意资料使用说明，再回来保存。' : 'Open Me → Privacy & AI, agree to the statement, then return to save.'
      : zh ? '当前没有权限移除这位人物，请重新登录后再试。' : 'You cannot remove this person right now. Sign in again and retry.',
  }
  if (problem.code === 'INVALID_ARGUMENT' || problem.status === 400) return {
    kind: 'other', text: zh ? '请检查填写的内容，生日请使用有效的月-日格式。' : 'Check the profile fields and use a valid MM-DD birthday.',
  }
  if (problem.code === 'REQUEST_IN_PROGRESS') return {
    kind: 'other', text: zh ? '上次操作仍在处理，请稍后重试。' : 'The previous request is still processing. Try again shortly.',
  }
  return { kind: 'other', text: editing
    ? zh ? '还没能确认是否保存成功，填写内容已保留。请检查网络后重试。' : 'We could not confirm whether it was saved. Your input is kept. Check your connection and retry.'
    : zh ? '还没能确认是否移除成功，请检查网络后重试。' : 'We could not confirm whether it was removed. Check your connection and retry.' }
}

export function GearSheet({ person, people, large, readAloud, managed, serviceAccount = false, onClose, onUpdate, onDelete, onToggleLarge, onToggleRead,memoryImports }: {
  person: Person; people: Person[]; large: boolean; readAloud: boolean; onClose: () => void; onUpdate: (p: Partial<Person>) => void
  managed?: PersonManagement; serviceAccount?: boolean
  memoryImports?:MemoryImportService
  onDelete: () => void; onToggleLarge: () => void; onToggleRead: () => void
}) {
  const { t, lang } = useI18n()
  const [edit, setEdit] = useState(false)
  const [importOpen,setImportOpen]=useState(false),importLayer=useRef<HTMLDivElement>(null)
  const [selectedPhoto, setSelectedPhoto] = useState<number | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoFailure, setPhotoFailure] = useState<ManagementFailure | null>(null)
  const photoPending = useRef<PhotoChoice[] | null>(null)
  const photoActive = useRef(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [adding, setAdding] = useState<null | 'personality' | 'life' | 'unknowns'>(null)
  const [val, setVal] = useState('')
  const [sample, setSample] = useState<{ kind: 'photos' | 'voice' | 'video' | 'chat'; data: ReturnType<typeof extract> } | null>(null)
  const pendingSample = useRef<typeof sample>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [removing, setRemoving] = useState<'remove' | 'reload' | null>(null)
  const [removeError, setRemoveError] = useState<ManagementFailure | null>(null)
  const removalActive = useRef(false)
  const editorBusy = useRef(false)
  const voiceBusy=useRef(false)
  const [moving, setMoving] = useState<WorldId | 'reload' | null>(null)
  const [moveError, setMoveError] = useState<ManagementFailure | null>(null)
  const movementActive = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const zh = isZh(lang)
  const lit = clarity(person)
  const say = (m: string) => { setMsg(m); window.setTimeout(() => setMsg(null), 2200) }
  const serviceMode = serviceAccount || !!managed
  const unavailable = () => say(zh ? '这项功能暂时无法使用，资料未作修改。' : 'This feature is not connected yet. Your information has not changed.')
  const closeSample = () => { pendingSample.current = null; setSample(null) }
  const feed = (k: 'photos' | 'voice' | 'video' | 'chat') => {
    const next = { kind: k, data: extract(lang, k) }
    pendingSample.current = next; setSample(next)
  }
  const confirmSample = () => {
    if (serviceMode) { unavailable(); return }
    const current = pendingSample.current
    if (!current) return
    closeSample()
    const e = current.data; const patch: Partial<Person> = {}; let added = 0
    if (e.personality) { const f = e.personality.filter((x) => !person.personality.includes(x)); if (f.length) { patch.personality = [...person.personality, ...f]; added += f.length } }
    if (e.life) { const f = e.life.filter((x) => !person.life.includes(x)); if (f.length) { patch.life = [...person.life, ...f]; added += f.length } }
    if (e.memory && !person.memories.some((m) => m.title === e.memory!.title)) { patch.memories = [{ ...e.memory, id: nid() }, ...person.memories]; added++ }
    if (e.voice && !person.hasVoice) { patch.hasVoice = true; added++ }
    if (!added) { say(isZh(lang) ? '这份示例已在资料中' : 'This sample is already in their profile.'); return }
    onUpdate(patch); say(isZh(lang) ? '已添加这份示例' : 'Sample added'); haptic([8, 30, 8])
  }
  const [profileBusy,setProfileBusy]=useState(false)
  const addTo = async (key: 'personality' | 'life' | 'unknowns') => {
    if(profileBusy)return
    const v = val.trim(); if(!v)return
    if(person[key].includes(v)){setAdding(null);setVal('');return}
    const patch={ [key]: [...person[key], v] } as Partial<Person>
    if(serviceMode){if(!managed){unavailable();return};setProfileBusy(true);try{await managed.save(patch);if(mounted.current){setAdding(null);setVal('');say(t('gear.saved'))}}catch(error){if(mounted.current)say(managementFailure(error,zh).text)}finally{if(mounted.current)setProfileBusy(false)};return}
    onUpdate(patch);setAdding(null);setVal('');say(t('gear.saved'))
  }
  async function move(w: WorldId) {
    if (movementActive.current) return
    if (!managed) {
      if (serviceMode) { unavailable(); return }
      onUpdate({ world: w, weather: worldWeather(lang, w) }); haptic([10, 40, 10]); say(t('gear.world.moved', { world: t(`world.${w}`) })); return
    }
    movementActive.current = true; setMoving(w); setMoveError(null)
    try {
      await managed.move(w)
      if (mounted.current) { haptic([10, 40, 10]); say(t('gear.world.moved', { world: t(`world.${w}`) })) }
    } catch (error) {
      if (!mounted.current || error instanceof DOMException && error.name === 'AbortError') return
      const problem = error && typeof error === 'object' ? error as { code?: unknown; status?: unknown } : {}
      const failure = problem.code === 'WORLD_CHANGED' ? { kind: 'conflict' as const, text: managementFailure({ status: 412 }, zh).text }
        : problem.code === 'WORLD_UNAVAILABLE' || problem.code === 'INVALID_ARGUMENT' || problem.status === 400 ? { kind: 'other' as const, text: zh ? '这个世界暂时无法迁入，请重新选择。' : 'This world is not available to move into. Choose another.' }
          : managementFailure(error, zh)
      setMoveError(failure); say(failure.text)
    } finally { movementActive.current = false; if (mounted.current) setMoving(null) }
  }
  async function reloadForMove() {
    if (!managed || movementActive.current) return
    movementActive.current = true; setMoving('reload')
    try { await managed.reload(); if (mounted.current) setMoveError(null) }
    catch (error) { if (mounted.current && !(error instanceof DOMException && error.name === 'AbortError')) { const failure = managementFailure(error, zh); setMoveError(failure); say(failure.text) } }
    finally { movementActive.current = false; if (mounted.current) setMoving(null) }
  }
  async function savePhotos(selection: PhotoChoice[]) {
    if (!managed || photoActive.current) return
    photoActive.current = true; setPhotoBusy(true); setPhotoFailure(null); photoPending.current = selection
    try {
      await managed.replacePhotos(selection)
      if (mounted.current) { photoPending.current = null; setSelectedPhoto(null); say(t('gear.saved')) }
    } catch (error) {
      if (mounted.current && !(error instanceof DOMException && error.name === 'AbortError')) setPhotoFailure(managementFailure(error, zh))
    } finally { photoActive.current = false; if (mounted.current) setPhotoBusy(false) }
  }
  const addPhotos = async (files: FileList | null) => {
    if (serviceMode) {
      if (!managed || !files || photoActive.current) return
      const selected = Array.from(files)
      if ((person.photoMedia?.length ?? 0) + selected.length > 6) { say(zh ? '最多保存六张人物照片。' : 'Save up to six character photos.'); return }
      photoActive.current = true; setPhotoBusy(true)
      try {
        const urls = await Promise.all(selected.map(socialPhotoDataUrl))
        photoActive.current = false
        if (mounted.current) await savePhotos([...(person.photoMedia ?? []), ...urls])
      } catch { if (mounted.current) say(zh ? '请选择 JPEG、PNG 或 WebP 照片，每张不超过 10 MiB。' : 'Choose JPEG, PNG or WebP photos, each up to 10 MiB.') }
      finally { photoActive.current = false; if (mounted.current) setPhotoBusy(false) }
      return
    }
    if (!files) return
    const urls: string[] = []
    for (const f of Array.from(files).slice(0, 4)) { try { urls.push(await fileToDataUrl(f)) } catch { /* 跳过 */ } }
    if (urls.length) onUpdate({ photos: [...(person.photos ?? []), ...urls], avatar: person.avatar || urls[0] })
  }
  const photos = [...new Set([...(person.photos ?? []), person.avatar].filter(Boolean))]
  const closeGear = () => { if (!removalActive.current && !editorBusy.current && !voiceBusy.current && !movementActive.current && !photoActive.current && !photoPending.current && !profileBusy) onClose() }
  const closeDelete = () => { if (!removalActive.current) { setConfirmDel(false); setRemoveError(null) } }
  async function remove() {
    if (removalActive.current) return
    if (!managed) { if (serviceMode) unavailable(); else onDelete(); return }
    removalActive.current = true
    setRemoving('remove')
    setRemoveError(null)
    try { await managed.remove(); setConfirmDel(false); onClose() }
    catch (error) { setRemoveError(managementFailure(error, zh, false)) }
    finally { removalActive.current = false; setRemoving(null) }
  }
  async function reloadForDelete() {
    if (!managed || removalActive.current) return
    removalActive.current = true
    setRemoving('reload')
    try { await managed.reload(); setConfirmDel(false); setRemoveError(null) }
    catch (error) { setRemoveError(managementFailure(error, zh, false)) }
    finally { removalActive.current = false; setRemoving(null) }
  }

  return (
    <Sheet tall onClose={closeGear} title={<div className="flex items-center gap-3"><Lens world={person.world} avatar={person.avatar} name={person.name} size={46} arcs={lit} /><div className="ml-1"><div>{t('gear.title', { name: person.name })}</div><div className="font-sans text-[12.5px] text-ink-soft">{person.relation} · {t(`world.${person.world}`)}</div></div></div>}>
      <div inert={edit || confirmDel || !!sample || selectedPhoto !== null||importOpen}>
      <GearGroup title={t('gear.profile')} action={<button disabled={!!moving || photoBusy || !!photoPending.current} onClick={() => serviceMode && !managed ? unavailable() : setEdit(true)} className="text-[13px] text-sky-deep disabled:opacity-50">{t('common.edit')}</button>}>
        <Row k={t('gear.called')} v={person.name} />
        <Row k={t('gear.realName')} v={person.realName ?? t('gear.unset')} />
        <Row k={t('gear.relation')} v={person.relation} />
        <Row k={t('gear.calledMe')} v={person.calledMe ?? t('gear.unset')} />
        <Row k={t('gear.birthday')} v={person.birthday ?? t('gear.unset')} />
        <Row k={t('gear.years')} v={person.years ?? t('gear.unset')} />
      </GearGroup>

      <GearGroup title={t('gear.material')} action={<span className="text-[12px] text-muted">{isZh(lang) ? '预览示例' : 'Preview samples'}</span>}>
        <div className="px-4 py-3.5 flex items-center gap-4">
          <div className="relative h-14 w-14 shrink-0"><ArcRing size={56} lit={lit} track="rgba(41,69,66,0.14)" stroke={2} /><span className="absolute inset-0 flex items-center justify-center font-mono text-[12px] text-ink">{lit.filter(Boolean).length}/6</span></div>
          <div><div className="text-[15px] text-ink">{t('gear.clarity')}</div><div className="text-[12.5px] text-muted mt-0.5">{t('gear.clarity.note')}</div></div>
        </div>
        <div className="px-3 pb-3 grid grid-cols-4 gap-2">
          {(['photos', 'voice', 'video', 'chat'] as const).map((k) => {
            const Icon = { photos: I.Photo, voice: I.Voice, video: I.Video, chat: I.Story }[k]
            return (
              <button key={k} onClick={() => feed(k)} className="flex flex-col items-center gap-1.5 rounded-2xl bg-black/[0.03] py-3 active:scale-95 transition-transform">
                <span className="h-10 w-10 flex items-center justify-center rounded-full bg-paper text-sky-deep"><Icon className="h-5 w-5" /></span>
                <span className="text-[11.5px] text-ink-soft">{t(`media.${k}`)}</span>
              </button>
            )
          })}
        </div>
        {serviceMode&&memoryImports&&person.serverId&&person.serverVersion&&<MemoryImport personId={person.serverId} personVersion={person.serverVersion} personName={person.name} service={memoryImports} layer={importLayer} onOpen={setImportOpen} onBusy={busy=>{editorBusy.current=busy}} onChanged={say} reload={managed?.reload}/>}
      </GearGroup>

      <GearGroup title={t('gear.face')}>
        <div className="px-4 py-3.5">
          <div className="flex gap-3 overflow-x-auto scroll-quiet pb-1">
            {(serviceMode ? (person.photoMedia ?? []).map((_, index) => person.photos?.[index] ?? '') : photos).map((src, index) => <button disabled={photoBusy || !!photoPending.current} key={serviceMode ? person.photoMedia?.[index].id : src.slice(-30)} onClick={() => serviceMode ? setSelectedPhoto(index) : onUpdate({ avatar: src })} aria-label={isZh(lang) ? `选择第${index + 1}张照片` : `Choose photo ${index + 1}`} aria-pressed={serviceMode ? index === 0 : person.avatar === src} className={`h-14 w-14 shrink-0 rounded-full overflow-hidden ring-2 transition-all ${(serviceMode ? index === 0 : person.avatar === src) ? 'ring-sun scale-105' : 'ring-line'}`}>{src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <I.Photo className="mx-auto h-5 w-5" />}</button>)}
            {FACE_ALBUM.filter((a) => !photos.includes(a.src)).slice(0, 3).map((a, index) => <button key={a.src} onClick={() => serviceMode ? unavailable() : onUpdate({ avatar: a.src, photos: [...(person.photos ?? []), a.src] })} aria-label={isZh(lang) ? `选择第${photos.length + index + 1}张照片` : `Choose photo ${photos.length + index + 1}`} aria-pressed={person.avatar === a.src} className="h-14 w-14 shrink-0 rounded-full overflow-hidden ring-2 ring-line opacity-60"><img src={a.src} alt="" className="h-full w-full object-cover" /></button>)}
            <label className="h-14 w-14 shrink-0 rounded-full border border-dashed border-line flex items-center justify-center text-muted cursor-pointer"><I.Plus className="h-5 w-5" /><input type="file" aria-label={zh ? '添加人物照片' : 'Add character photos'} accept={serviceMode ? 'image/jpeg,image/png,image/webp' : 'image/*'} multiple disabled={photoBusy || !!photoPending.current} className="hidden" onChange={(e) => { void addPhotos(e.target.files); e.target.value = '' }} /></label>
          </div>
          <p className="mt-2 text-[12px] text-muted">{t('gear.face.note')}</p>
          {photoBusy && <p role="status" className="mt-2 text-[13px] text-ink-soft">{zh ? '正在保存照片…' : 'Saving photos…'}</p>}
          {photoFailure && <div role="alert" className="mt-2 text-[13px] text-ink-soft"><p>{photoFailure.text}</p>
            <button disabled={photoBusy} className="min-h-11 text-sky-deep" onClick={() => { if (photoPending.current) void savePhotos(photoPending.current) }}>{zh ? '重试保存照片' : 'Retry photo save'}</button>
            <button disabled={photoBusy} className="ml-4 min-h-11 text-sky-deep" onClick={() => { void managed?.reload().then(() => { photoPending.current = null; setPhotoFailure(null) }).catch(error => setPhotoFailure(managementFailure(error, zh))) }}>{zh ? '查看最新资料' : 'View latest profile'}</button>
          </div>}
        </div>
        <Row k={t('gear.voice')} v={serviceMode ? person.hasVoice ? (zh ? '原声已保存 · 可在此聆听' : 'Original sample saved · listen here') : (zh ? '暂无保存的原声' : 'No original sample saved') : person.hasVoice ? t('gear.voice.on') : t('gear.voice.off')} />
        {serviceMode&&managed?.voiceContext&&<details className="px-4 pb-4"><summary onClick={event=>{if(voiceBusy.current)event.preventDefault()}} className="cursor-pointer min-h-11 py-3 text-[13px] text-sky-deep">{zh?'保存或管理原声':'Save or manage original voice'}</summary><PersonVoiceInput context={managed.voiceContext} targetId={managed.voiceContext.draftId} readyVoice={person.readyVoice} ensureTarget={async()=>managed.voiceContext!} onBind={async id=>{await managed.save({voiceId:id})}} onBusy={busy=>{voiceBusy.current=busy}}/></details>}
      </GearGroup>

      <GearGroup title={t('gear.tone')} action={<button disabled={profileBusy} onClick={() => { setAdding('personality'); setVal('') }} className="text-[13px] text-sky-deep">{t('gear.add')}</button>}>
        <div className="px-4 py-3.5">
          <div className="flex flex-wrap gap-2">{person.personality.map((x, i) => <span key={i} className="rounded-full bg-black/[0.04] px-3 py-1.5 text-[13.5px] text-ink-soft">{x}</span>)}</div>
          {person.catchphrase && <p className="mt-2.5 text-[14px] text-ink-soft">“{person.catchphrase}”</p>}
          {adding === 'personality' && <AddInline busy={profileBusy} value={val} setValue={setVal} onDone={() => void addTo('personality')} placeholder={t('gear.tone.ph')} />}
        </div>
      </GearGroup>

      <GearGroup title={t('gear.life')} action={<button disabled={profileBusy} onClick={() => { setAdding('life'); setVal('') }} className="text-[13px] text-sky-deep">{t('gear.add')}</button>}>
        <div className="px-4 py-3.5">
          {person.sourceStory&&<p className="mb-3 whitespace-pre-wrap text-[14.5px] text-ink-soft">{person.sourceStory}</p>}
          <ul className="space-y-1.5">{person.life.map((l, i) => <li key={i} className="flex gap-2 text-[14.5px] text-ink-soft"><span className="text-sun-deep">·</span>{l}</li>)}</ul>
          {adding === 'life' && <AddInline busy={profileBusy} value={val} setValue={setVal} onDone={() => void addTo('life')} placeholder={t('gear.life.ph')} />}
        </div>
      </GearGroup>

      <GearGroup title={t('gear.unknown')} action={<button disabled={profileBusy} onClick={() => { setAdding('unknowns'); setVal('') }} className="text-[13px] text-sky-deep">{t('gear.add')}</button>}>
        <div className="px-4 py-3.5">
          <p className="text-[12.5px] text-muted">{t('gear.unknown.note')}</p>
          <ul className="mt-1.5 space-y-1">{person.unknowns.map((l, i) => <li key={i} className="flex gap-2 text-[14px] text-muted"><span>·</span>{l}</li>)}</ul>
          {adding === 'unknowns' && <AddInline busy={profileBusy} value={val} setValue={setVal} onDone={() => void addTo('unknowns')} placeholder={t('gear.unknown.ph')} />}
        </div>
      </GearGroup>

      <GearGroup title={t('gear.world')} action={managed && (moveError?.kind === 'conflict' || moveError?.kind === 'missing') ? <button disabled={!!moving || photoBusy || !!photoPending.current} onClick={() => { void reloadForMove() }} className="min-h-11 text-[13px] text-sky-deep disabled:opacity-50">{moving === 'reload' ? zh ? '正在读取…' : 'Loading…' : zh ? '查看最新资料' : 'View latest profile'}</button> : undefined}>
        {WORLD_IDS.map((w) => {
          const here = person.world === w
          const others = people.filter((p) => p.world === w && p.id !== person.id)
          return (
            <div key={w} className="flex items-center gap-3 px-4 py-3">
              <Lens world={w} size={42} name=" " />
              <div className="flex-1 min-w-0">
                <div className="font-serif text-[17px] text-ink">{t(`world.${w}`)}</div>
                <div className="text-[12px] text-muted truncate">{others.length ? t('gear.world.with', { names: others.map((p) => p.name).join('、') }) : t(`world.${w}.law`)}</div>
              </div>
              {here ? <span className="font-mono text-[10px] tracking-[0.16em] text-sun-deep">{t('gear.world.here')}</span> : <button disabled={!!moving || photoBusy || !!photoPending.current || moveError?.kind === 'conflict' || moveError?.kind === 'missing'} aria-busy={moving === w} onClick={() => { void move(w) }} className="rounded-full ring-1 ring-line px-3.5 py-1.5 text-[13px] text-ink-soft active:bg-black/[0.04] disabled:opacity-50">{t('gear.world.move')}</button>}
            </div>
          )
        })}
      </GearGroup>


      <GearGroup title={t('gear.a11y')}>
        <Switch on={large} onToggle={onToggleLarge} label={t('me.large')} desc={t('me.large.desc')} />
        <Switch on={readAloud} onToggle={onToggleRead} label={t('me.read')} desc={t('me.read.desc')} />
      </GearGroup>

      <GearGroup title={t('gear.privacy')}>
        <Row k={t('gear.privacy.chat')} v={serviceMode ? zh ? '保存在当前账号，仅自己可见' : 'Saved in your current account, visible only to you' : t('gear.privacy.chat.v')} />
        <Row k={t('gear.privacy.material')} v={t('gear.privacy.material.v')} />
        <p className="px-4 py-3.5 text-[13px] leading-relaxed text-ink-soft">{t('ai.body')}</p>
      </GearGroup>

      <button disabled={!!moving || photoBusy || !!photoPending.current} onClick={() => { setRemoveError(null); setConfirmDel(true) }} className="mt-2 w-full rounded-2xl ring-1 ring-line py-3.5 text-[14px] text-muted active:bg-black/[0.03] disabled:opacity-50">{t('gear.delete')}</button>
      </div>

      <div ref={importLayer}/>

      {selectedPhoto !== null && managed && <Sheet onClose={() => { if (!photoBusy) setSelectedPhoto(null) }} title={zh ? '人物照片' : 'Character photo'}>
        <div className="space-y-3">
          {person.photos?.[selectedPhoto] && <img src={person.photos[selectedPhoto]} alt="" className="mx-auto max-h-64 max-w-full rounded-2xl object-contain" />}
          <button disabled={photoBusy || !!photoPending.current} className="w-full rounded-full btn-dark py-3.5 text-[15px]" onClick={() => { const items = person.photoMedia ?? []; void savePhotos([items[selectedPhoto], ...items.filter((_, index) => index !== selectedPhoto)]) }}>{zh ? '用作头像' : 'Use as portrait'}</button>
          <button disabled={photoBusy || !!photoPending.current} className="w-full rounded-full ring-1 ring-line py-3.5 text-[15px]" onClick={() => { void savePhotos((person.photoMedia ?? []).filter((_, index) => index !== selectedPhoto)) }}>{zh ? '移除照片' : 'Remove photo'}</button>
          {photoFailure && <p role="alert" className="text-[13px] text-ink-soft">{photoFailure.text}</p>}
          {photoFailure && <button disabled={photoBusy} className="w-full py-3 text-sky-deep" onClick={() => { if (photoPending.current) void savePhotos(photoPending.current) }}>{zh ? '重试保存照片' : 'Retry photo save'}</button>}
        </div>
      </Sheet>}
      {edit && <EditProfile person={person} managed={managed} onBusyChange={busy => { editorBusy.current = busy }} onClose={() => setEdit(false)} onSave={(p) => { onUpdate(p); setEdit(false); say(t('gear.saved')) }} onSaved={() => { setEdit(false); say(t('gear.saved')) }} />}
      {sample && (
        <Sheet onClose={closeSample} title={`${t(`media.${sample.kind}`)} · ${isZh(lang) ? '本地示例' : 'Local sample'}`}
          footer={<div className="flex gap-2.5"><button onClick={closeSample} className="rounded-full px-6 py-3 text-[15px] text-ink-soft">{t('common.cancel')}</button><button onClick={confirmSample} className="flex-1 rounded-full btn-dark py-3 text-[16px] font-semibold">{isZh(lang) ? '添加这份示例' : 'Add this sample'}</button></div>}>
          <p className="text-[13px] leading-relaxed text-muted">{isZh(lang) ? '仅用于体验，不来自你上传的资料。' : 'For trying the app, not taken from your uploaded material.'}</p>
          <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-ink-soft">
            {sample.data.personality && <section><h3 className="mb-1 text-[12px] text-muted">{t('gear.tone')}</h3><p>{sample.data.personality.join(isZh(lang) ? '、' : ', ')}</p></section>}
            {sample.data.life && <section><h3 className="mb-1 text-[12px] text-muted">{t('gear.life')}</h3>{sample.data.life.map((item) => <p key={item}>{item}</p>)}</section>}
            {sample.data.memory && <section><h3 className="mb-1 font-serif text-[18px] text-ink">{sample.data.memory.title}</h3><p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{sample.data.memory.body}</p></section>}
            {sample.data.voice && <section><h3 className="mb-1 text-[12px] text-muted">{t('gear.voice')}</h3><p>{isZh(lang) ? '启用示例声音' : 'Enable the sample voice'}</p></section>}
          </div>
        </Sheet>
      )}
      {confirmDel && (
        <Sheet onClose={closeDelete} title={t('del.title', { name: person.name })}
          footer={<div className="flex gap-2.5"><button disabled={!!removing} onClick={closeDelete} className="flex-1 rounded-full ring-1 ring-line py-3 text-[16px] text-ink disabled:opacity-50">{t('del.cancel')}</button><button disabled={!!removing || removeError?.kind === 'conflict' || removeError?.kind === 'missing'} aria-busy={removing === 'remove'} onClick={() => { void remove() }} className="rounded-full bg-coral text-white px-7 py-3 text-[15px] font-semibold disabled:opacity-50">{removing === 'remove' ? zh ? '正在删除…' : 'Deleting…' : t('del.confirm')}</button></div>}>
          <div aria-busy={!!removing}>
            <p className="text-[14.5px] leading-relaxed text-ink-soft">{t('del.body')}</p>
            {removeError && <p role="alert" className="mt-3 text-[13px] leading-relaxed text-coral">{removeError.text}</p>}
            {managed && (removeError?.kind === 'conflict' || removeError?.kind === 'missing') && <button disabled={!!removing} onClick={() => { void reloadForDelete() }} className="mt-2 min-h-11 text-[14px] text-sky-deep disabled:opacity-50">{removing === 'reload' ? zh ? '正在读取…' : 'Loading…' : zh ? '查看最新资料' : 'View latest profile'}</button>}
          </div>
        </Sheet>
      )}
      {msg && <Toast text={msg} />}
    </Sheet>
  )
}
function GearGroup({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <div className="mb-2 px-1 flex items-center justify-between"><h3 className="text-[12.5px] tracking-[0.14em] text-muted">{title}</h3>{action}</div>
      <div className="rounded-2xl glass-light divide-y divide-line overflow-hidden">{children}</div>
    </section>
  )
}
function AddInline({ value, setValue, onDone, placeholder,busy=false }: { value: string; setValue: (v: string) => void; onDone: () => void; placeholder: string;busy?:boolean }) {
  const {t}=useI18n()
  return (
    <div className="mt-3 flex items-center gap-2 animate-rise">
      <input autoFocus disabled={busy} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); onDone() } }} placeholder={placeholder} className="flex-1 rounded-xl bg-paper ring-1 ring-sky/40 px-3.5 py-2.5 text-[15px] text-ink outline-none" />
      <button disabled={busy} onClick={onDone} aria-label={t('common.save')} className="h-10 w-10 rounded-xl btn-dark flex items-center justify-center"><I.Check className="h-4 w-4" /></button>
    </div>
  )
}
function EditProfile({ person, managed, onSave, onSaved, onBusyChange, onClose }: {
  person: Person; managed?: PersonManagement; onSave: (p: Partial<Person>) => void; onSaved: () => void
  onBusyChange: (busy: boolean) => void; onClose: () => void
}) {
  const { t, lang } = useI18n()
  const zh = isZh(lang)
  const [f, setF] = useState({ name: person.name, realName: person.realName ?? '', relation: person.relation, calledMe: person.calledMe ?? '', birthday: person.birthday ?? '', years: person.years ?? '', place: person.place ?? '',catchphrase:person.catchphrase })
  const [pending, setPending] = useState<'save' | 'reload' | null>(null)
  const [failure, setFailure] = useState<ManagementFailure | null>(null)
  const active = useRef(false)
  const close = () => { if (!active.current) onClose() }
  async function save() {
    if (active.current || failure?.kind === 'conflict' || failure?.kind === 'missing') return
    const values = Object.fromEntries(Object.entries(f).map(([key, value]) => [key, value.trim()])) as typeof f
    if (managed) {
      const limits = { name: 80, relation: 40, realName: 80, calledMe: 80, birthday: 5, years: 120, place: 200,catchphrase:500 }
      if (!values.name || !values.relation || (Object.keys(limits) as (keyof typeof f)[]).some(key => [...values[key]].length > limits[key])) {
        setFailure({ kind: 'other', text: zh ? '请填写称呼与关系，并检查各项内容是否过长。' : 'Enter a name and relationship, and check that the fields are not too long.' })
        return
      }
      if (values.birthday) {
        const match = /^(\d{2})-(\d{2})$/.exec(values.birthday)
        const month = Number(match?.[1]), day = Number(match?.[2])
        const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        if (!match || month < 1 || month > 12 || day < 1 || day > days[month - 1]) {
          setFailure({ kind: 'other', text: zh ? '生日请填写有效的月-日，例如 03-15。' : 'Enter a valid MM-DD birthday, for example 03-15.' })
          return
        }
      }
    }
    const patch: Partial<Person> = {
      name: values.name || person.name, relation: values.relation || person.relation,
      realName: values.realName || undefined, calledMe: values.calledMe || undefined,
      birthday: values.birthday || undefined, years: values.years || undefined, place: values.place || undefined,
      catchphrase:values.catchphrase,
    }
    if (!managed) { onSave(patch); return }
    active.current = true
    onBusyChange(true)
    setPending('save')
    setFailure(null)
    try { await managed.save(patch); onSaved() }
    catch (error) { setFailure(managementFailure(error, zh)) }
    finally { active.current = false; onBusyChange(false); setPending(null) }
  }
  async function reload() {
    if (!managed || active.current) return
    active.current = true
    onBusyChange(true)
    setPending('reload')
    try { await managed.reload(); onClose() }
    catch (error) { setFailure(managementFailure(error, zh)) }
    finally { active.current = false; onBusyChange(false); setPending(null) }
  }
  const field = (k: keyof typeof f, label: string, ph?: string) => (
    <label className="block"><span className="text-[12px] text-muted">{label}</span>
      <input disabled={!!pending} value={f[k]} onChange={(e) => { setF({ ...f, [k]: e.target.value }); if (failure?.kind === 'other') setFailure(null) }} placeholder={ph} className="mt-1.5 w-full rounded-2xl bg-paper ring-1 ring-line px-4 py-3 text-[15.5px] text-ink outline-none focus:ring-sky/50 placeholder:text-muted disabled:opacity-60" /></label>
  )
  return (
    <Sheet tall onClose={close} title={t('edit.title')}
      footer={<div className="flex gap-2.5"><button disabled={!!pending} onClick={close} className="rounded-full px-6 py-3 text-[15px] text-ink-soft disabled:opacity-50">{t('common.cancel')}</button><button disabled={!!pending || failure?.kind === 'conflict' || failure?.kind === 'missing'} aria-busy={pending === 'save'} onClick={() => { void save() }} className="flex-1 rounded-full btn-dark py-3 text-[16px] font-semibold disabled:opacity-50">{pending === 'save' ? zh ? '正在保存…' : 'Saving…' : t('common.save')}</button></div>}>
      <div className="space-y-4" aria-busy={!!pending}>
        {field('name', t('gear.called'))}
        {field('realName', t('gear.realName'))}
        {field('relation', t('gear.relation'))}
        {field('calledMe', t('gear.calledMe'))}
        {field('birthday', t('gear.birthday'), t('seek.time.birthday.ph'))}
        {field('catchphrase', zh?'口头禅':'Catchphrase')}
        {field('years', t('gear.years'), t('seek.time.years.ph'))}
        {field('place', t('gear.place'), t('seek.place.ph'))}
        {failure && <p role="alert" className="text-[13px] leading-relaxed text-coral">{failure.text}</p>}
        {managed && (failure?.kind === 'conflict' || failure?.kind === 'missing') && <button disabled={!!pending} onClick={() => { void reload() }} className="min-h-11 text-[14px] text-sky-deep disabled:opacity-50">{pending === 'reload' ? zh ? '正在读取…' : 'Loading…' : zh ? '查看最新资料' : 'View latest profile'}</button>}
      </div>
    </Sheet>
  )
}

/* ================================ 围坐 ================================ */
export function Gathering({ world, people, allPeople = people, chat, draftOwner, focusMessageId, onPersist, onBack, onOpen, serviceAccount = false, serviceConversation }: { world: WorldId; people: Person[]; allPeople?: Person[]; chat?: Msg[]; draftOwner: string; focusMessageId?: number; onPersist: (m: Msg[]) => void; onBack: () => void; onOpen: (id: number) => void; serviceAccount?: boolean; serviceConversation?: ServiceConversation }) {
  const { t, lang } = useI18n()
  const night = useContext(NightCtx)
  useStatusTone(night ? 'light' : 'dark')
  const nowT = () => fmtTime(lang)
  const [demoThread, setThread] = useConversationHistory(serviceAccount ? undefined : chat, serviceAccount ? () => {} : onPersist, () => [{ id: nid(), kind: 'note', text: t('gather.note') }])
  const remote = useServiceConversation(serviceConversation)
  const [note] = useState<Msg>(() => ({ id: nid(), kind: 'note', text: t('gather.note') }))
  const thread = useMemo(() => serviceConversation ? [note, ...remote.messages] : demoThread, [serviceConversation, note, remote.messages, demoThread])
  const [draft, storeDraft] = useConversationDraft(draftOwner, `g:${world}`, serviceAccount)
  const draftRevision = useRef(0)
  const setDraft = (value: string) => { draftRevision.current++; storeDraft(value) }
  const displayedDraft = serviceConversation ? remote.pendingText ?? draft : draft
  const [demoTyping, setTyping] = useState(false)
  const typing = serviceConversation ? remote.typing : demoTyping
  const [notice, setNotice] = useState<string | null>(null)
  const [composerStatus, setComposerStatus] = useState<string | null>(null)
  const unavailable = () => setNotice(isZh(lang) ? '暂时无法发送这段话，内容已保留，请稍后再试。' : 'Gathering messages cannot be sent right now. Your input is kept; please try again later.')
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(null), 2400); return () => clearTimeout(timer) }, [notice])
  useEffect(() => {
    if (!remote.feedback) return
    if (remote.feedback.placement === 'composer') setComposerStatus(remote.feedback.text)
    else setNotice(remote.feedback.text)
    remote.clearFeedback()
  }, [remote.feedback, remote.clearFeedback])
  const [selected, setSelected] = useState<number | null>(null)
  const timers = useRef<number[]>([])
  const { scroller, highlighted } = useThreadScroll(thread, typing, serviceConversation ? remote.focusServerId : focusMessageId)
  const paging = useRef(false)
  useEffect(() => {
    const list = scroller.current
    if (!list || !serviceConversation) return
    const scroll = () => {
      if (remote.loading || paging.current) return
      const load = list.scrollTop <= 24 && remote.hasOlder ? remote.loadOlder
        : list.scrollHeight - list.scrollTop - list.clientHeight < 90 && remote.hasNewer ? remote.loadNewer : undefined
      if (!load) return
      paging.current = true; void load().finally(() => { paging.current = false })
    }
    list.addEventListener('scroll', scroll, { passive: true })
    return () => list.removeEventListener('scroll', scroll)
  }, [serviceConversation, remote.hasOlder, remote.hasNewer, remote.loading, remote.loadOlder, remote.loadNewer, scroller])
  const nativeBackRoot = useRef<HTMLDivElement>(null)
  useNativeBack(() => {
    if (selected === null) return false
    setSelected(null)
    return true
  }, selected !== null, 10, nativeBackRoot)
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const send = () => {
    const tx = displayedDraft.trim(); if (!tx) return
    if (serviceConversation) {
      if (remote.sending) return
      setComposerStatus(null)
      const revision = draftRevision.current
      void remote.send(tx).then(accepted => { if (accepted) { if (revision === draftRevision.current) setDraft(''); haptic(6) } })
      return
    }
    if (serviceAccount) { unavailable(); return }
    setDraft(''); haptic(6)
    setThread((tt) => [...tt, { id: nid(), kind: 'me', time: nowT(), text: tx, at: Date.now() }])
    const order = [...people].sort(() => Math.random() - 0.5).slice(0, 3)
    order.forEach((p, i) => {
      timers.current.push(window.setTimeout(() => setTyping(true), 600 + i * 1500))
      timers.current.push(window.setTimeout(() => {
        const r = buildReply(lang, p, tx)
        setThread((tt) => [...tt, { id: nid(), kind: 'him', time: nowT(), text: r.text, who: p.id, at: Date.now() }])
        setTyping(i < order.length - 1)
      }, 1500 + i * 1500))
    })
  }
  return (
    <div ref={nativeBackRoot} className={`gathering absolute inset-0 flex flex-col overflow-hidden wb-${world}`} style={{ background: 'var(--wb)' }}>
      <div className="absolute inset-x-0 top-[var(--app-status-height)] h-[34%] overflow-hidden" aria-hidden>
        <div className="absolute inset-0" style={{ filter: night ? 'blur(1.5px) brightness(.68)' : 'blur(1.5px)', transform: 'scale(1.06)' }}><WorldScene world={world} /></div>
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, var(--color-canvas), transparent 42%, var(--wb) 100%)' }} />
      </div>
      <header className="relative z-20 shrink-0 pt-[var(--app-status-height)] px-3">
        <div className="absolute inset-x-0 top-0 h-[var(--app-status-height)] bg-canvas" aria-hidden />
        <div className="flex items-center gap-2 rounded-[22px] bg-paper px-1.5 py-1.5">
          <button onClick={onBack} aria-label={t('common.back')} className="h-11 w-11 shrink-0 flex items-center justify-center rounded-full text-ink-soft active:bg-cloud"><I.Back className="h-6 w-6" /></button>
          <span className="flex shrink-0 gap-1">{people.slice(0, 3).map((p) => <button key={p.id} onClick={() => onOpen(p.id)} aria-label={p.name} className="h-9 w-9 grid place-items-center rounded-full active:bg-cloud"><Lens world={world} avatar={p.avatar} name={p.name} size={32} dark={night} /></button>)}</span>
          <div className="ml-1 min-w-0 flex-1">
            <h1 className="font-serif text-[18px] leading-tight text-ink truncate">{t('gather.title', { world: t(`world.${world}`) })}</h1>
            <div className="truncate font-mono text-[9.5px] tracking-[0.12em] text-ink-soft">{t('gather.sub')}</div>
          </div>
        </div>
      </header>
      <div className="relative flex-1 min-h-0">
        <div className="absolute inset-x-0 top-0 h-12 z-10 flex items-center justify-center pointer-events-none">{typing && <HorizonSignal world={world} label={t('talk.typing')} />}</div>
        <div ref={scroller} aria-busy={!!serviceConversation && remote.loading} onClick={() => setSelected(null)} className="absolute inset-0 overflow-y-auto scroll-quiet px-4 pt-14 pb-4 space-y-3" style={{ maskImage: 'linear-gradient(to bottom, transparent 0, #000 60px)', WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, #000 60px)' }}>
          {thread.map((m) => {
            const linked = m.kind === 'him' ? serviceConversation ? allPeople.find(p => !!m.speakerPersonId && p.serverId === m.speakerPersonId) : people.find(p => p.id === m.who) : undefined
            const speaker = m.kind === 'him' && serviceConversation ? { name: m.speakerDisplayName ?? (isZh(lang) ? '成员' : 'Member'), world: linked?.world ?? world, avatar: linked?.avatar ?? '' } : linked
            return <MessageRow key={m.id} id={m.id} serverId={m.serverId} highlighted={highlighted === m.id}>
              <Bubble m={m} speaker={speaker} onAvatar={linked ? () => onOpen(linked.id) : undefined}
                selected={selected === m.id} onSelect={() => setSelected((s) => (s === m.id ? null : m.id))}
                onSpeak={(tx) => speak(tx, lang)} onCopy={(tx) => { void navigator.clipboard?.writeText(tx).catch(() => {}) }}
                onDelete={(id) => { if (serviceConversation) { const message = remote.messages.find(item => item.id === id); if (message) void remote.remove(message).then(removed => { if (removed) setSelected(null) }); return }; if (serviceAccount) { unavailable(); return }; setThread((tt) => tt.filter((x) => x.id !== id)); setSelected(null) }} />
            </MessageRow>
          })}
        </div>
      </div>
      {notice && <Toast text={notice} />}
      <div className="app-composer relative z-10 shrink-0 border-t border-line bg-canvas rounded-t-[26px] px-3 pt-2.5 pb-[30px]">
        {composerStatus && <p id="gather-composer-status" role="status" className="px-2 pb-2 text-[12px] leading-relaxed text-ink-soft [overflow-wrap:anywhere]">{composerStatus}</p>}
        <div className="flex items-end gap-2">
          <textarea value={displayedDraft} readOnly={!!serviceConversation && (remote.sending || remote.pendingText !== undefined)} onChange={(e) => { setComposerStatus(null); setDraft(e.target.value) }} rows={1} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); send() } }} aria-label={t('talk.ph')} aria-describedby={composerStatus ? 'gather-composer-status' : undefined} placeholder={t('talk.ph')} className="min-w-0 flex-1 min-h-11 max-h-28 resize-none rounded-[22px] bg-paper ring-1 ring-line px-4 py-2.5 text-[16px] leading-6 text-ink outline-none placeholder:text-muted focus:ring-sky/40" />
          <button onClick={send} disabled={!displayedDraft.trim() || !!serviceConversation && remote.sending} aria-busy={!!serviceConversation && remote.sending} aria-label={t('talk.send')} className="h-11 w-11 shrink-0 flex items-center justify-center rounded-full btn-dark active:scale-90 transition-transform"><I.Send className="h-5 w-5" /></button>
        </div>
      </div>
    </div>
  )
}
