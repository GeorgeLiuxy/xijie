import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Gift } from '@phosphor-icons/react'
import {
  useI18n, STORY_IMG, lg, fmtTime, fmtDate, fmtDuration, speechLang, quickReplies, buildReply, photoReply, callLines,
  letterReply, extract, worldWeather, FACE_ALBUM, WORLD_IDS, isZh, type Lang, type WorldId,
} from './i18n'
import { nid, clarity, fileToDataUrl, nextMorning, isTomorrow, type Letter, type Memory, type Msg, type Person } from './model'
import { useConversationDraft, useConversationHistory } from './conversationHistory'
import { WORLDS, WorldScene, HorizonSignal, Arrival, LetterGlyph } from './worlds'
import { DeepField, Lens, ArcRing } from './fx'
import { I, Sheet, Toast, Switch, AiBadge, haptic, chime, fxPrefs, useStatusTone, NightCtx } from './ui'
import type { Rect } from './home'
import { GiftMessageCard } from './gifts/GiftMessageCard'
import type { GiftOpenOptions } from './gifts/types'
import { useNativeBack } from './mobile/back'
import { MemoryReader } from './MemoryReader'
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

export function PersonSpace({ person, people, chat, draftOwner, origin, landed, startLetter, startCall, focusMessageId, memoryContext, onDismissMemoryContext, readAloud, onBack, onUpdate, onPersistChat, onGather, onGift, onReceivedGift, onProfile, onEcho }: {
  person: Person; people: Person[]; chat?: Msg[]; draftOwner: string; origin?: Rect; landed?: boolean; startLetter?: boolean; startCall?: 'voice' | 'video'; focusMessageId?: number; readAloud: boolean
  memoryContext?: Memory; onDismissMemoryContext?: () => void
  onBack: () => void; onUpdate: (p: Partial<Person>) => void; onPersistChat: (m: Msg[]) => void
  onGather: () => void; onGift: (options?: GiftOpenOptions) => void; onReceivedGift: (id: string) => void; onProfile: () => void; onEcho: (m: Memory) => void
}) {
  const { t } = useI18n()
  const night = useContext(NightCtx)
  useStatusTone(night ? 'light' : 'dark')
  const w = WORLDS[person.world]
  const [letter, setLetter] = useState(!!startLetter)
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

      <header className={`chat-header relative z-30 pt-[var(--app-status-height)] px-3 ${enter}`} style={{ animationDelay: '0.22s' }}>
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

      <div className="absolute inset-x-0 bottom-0 top-[calc(var(--app-status-height)+66px)]">
        <TalkTab person={person} neighbors={neighbors} initial={chat} draftOwner={draftOwner} focusMessageId={focusMessageId} readAloud={readAloud} onUpdate={onUpdate} onPersist={onPersistChat} overlayRoot={self}
          memoryContext={memoryContext} onDismissMemoryContext={onDismissMemoryContext}
          onLetter={() => setLetter(true)} onGather={onGather} onGift={onGift} onReceivedGift={onReceivedGift} onProfile={onProfile} onEcho={onEcho} startCall={startCall} enter={enter} />
      </div>
      {letter && <LetterComposer person={person} draftOwner={draftOwner} onClose={() => setLetter(false)} onSent={(l) => onUpdate({ letters: [l, ...(person.letters ?? [])] })} />}
    </div>
  )
}

/* ================================ 说话 ================================ */
type Fx = { id: number; x: number; h: number }

function useThreadScroll(thread: Msg[], typing: boolean, focusMessageId?: number) {
  const scroller = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const previous = useRef<{ id?: number; thread: Msg[]; typing: boolean } | null>(null)
  const [highlighted, setHighlighted] = useState(focusMessageId)

  useLayoutEffect(() => {
    const list = scroller.current
    if (!list) return
    const last = previous.current
    previous.current = { id: focusMessageId, thread, typing }
    const opening = !last || last.id !== focusMessageId
    if (opening && focusMessageId !== undefined) {
      const row = list.querySelector<HTMLElement>(`[data-message-id="${focusMessageId}"]`)
      if (row) {
        const inset = Math.max(56, (list.clientHeight - row.offsetHeight) / 2)
        list.scrollTop = row.offsetTop - inset
        return
      }
    }
    const lastMessage = thread[thread.length - 1]
    const justSent = lastMessage?.kind === 'me' && lastMessage.id !== last?.thread[last.thread.length - 1]?.id
    if (opening || ((following.current || justSent) && (last.thread !== thread || last.typing !== typing)))
      list.scrollTo({ top: list.scrollHeight, behavior: opening || fxPrefs.calm ? 'auto' : 'smooth' })
  }, [focusMessageId, thread, typing])

  useEffect(() => {
    const list = scroller.current
    if (!list) return
    const track = () => { following.current = list.scrollHeight - list.scrollTop - list.clientHeight < 90 }
    list.addEventListener('scroll', track, { passive: true })
    return () => list.removeEventListener('scroll', track)
  }, [])

  useEffect(() => {
    setHighlighted(focusMessageId)
    if (focusMessageId === undefined) return
    const timer = window.setTimeout(() => setHighlighted(undefined), 2200)
    return () => window.clearTimeout(timer)
  }, [focusMessageId])
  return { scroller, highlighted }
}

function MessageRow({ id, highlighted, children }: { id: number; highlighted: boolean; children: React.ReactNode }) {
  return <div data-message-id={id} className={highlighted ? 'rounded-2xl bg-sun/20 outline-2 outline-sun/70' : undefined}>{children}</div>
}

function TalkTab({ person, neighbors, initial, draftOwner, focusMessageId, memoryContext, onDismissMemoryContext, readAloud, onUpdate, onPersist, onLetter, onGather, onGift, onReceivedGift, onProfile, onEcho, startCall, enter, overlayRoot }: {
  person: Person; neighbors: Person[]; initial?: Msg[]; draftOwner: string; focusMessageId?: number; readAloud: boolean; onUpdate: (p: Partial<Person>) => void; onPersist: (m: Msg[]) => void
  onLetter: () => void; onGather: () => void; onGift: (options?: GiftOpenOptions) => void; onReceivedGift: (id: string) => void; onProfile: () => void; onEcho: (m: Memory) => void; startCall?: 'voice' | 'video'; enter: string
  overlayRoot: React.RefObject<HTMLDivElement | null>
  memoryContext?: Memory; onDismissMemoryContext?: () => void
}) {
  const { t, lang } = useI18n()
  const nowT = () => fmtTime(lang)
  const [thread, setThread] = useConversationHistory(initial, onPersist, () => [
    { id: nid(), kind: 'note', text: t('talk.note') },
    { id: nid(), kind: 'him', time: nowT(), text: person.greeting },
  ])
  const [draft, setDraft] = useConversationDraft(draftOwner, person.id)
  const [typing, setTyping] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [panel, setPanel] = useState(false)
  const [voiceMode, setVoiceMode] = useState(false)
  const [hold, setHold] = useState<null | { y: number; cancel: boolean; text: string }>(null)
  const holdSession = useRef<object | null>(null)
  const [call, setCall] = useState<null | 'voice' | 'video'>(startCall ?? null)
  const [overlayTarget, setOverlayTarget] = useState<HTMLDivElement | null>(null)
  useEffect(() => { setOverlayTarget(overlayRoot.current) }, [overlayRoot])
  const [memDraft, setMemDraft] = useState<Memory | null>(null)
  const [keep, setKeep] = useState(false)
  const [savedMemoryId, setSavedMemoryId] = useState<number | null>(null)
  const [readingSaved, setReadingSaved] = useState(false)
  const savedMemory = person.memories.find(memory => memory.id === savedMemoryId)
  const savedMemoryOpener = useRef<HTMLButtonElement>(null)
  const [readingContext, setReadingContext] = useState(false)
  useEffect(() => setReadingContext(false), [memoryContext?.id])
  const [toast, setToast] = useState<string | null>(null)
  const [streaks, setStreaks] = useState<Fx[]>([])
  const [arrivals, setArrivals] = useState<Fx[]>([])
  const timers = useRef<number[]>([])
  const after = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)) }
  const recog = useRef<{ stop?: () => void } | null>(null)
  const area = useRef<HTMLDivElement>(null)
  const { scroller, highlighted } = useThreadScroll(thread, typing, focusMessageId)
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
  useEffect(() => () => { holdSession.current = null; timers.current.forEach(clearTimeout); window.speechSynthesis?.cancel(); try { recog.current?.stop?.() } catch { /* noop */ } }, [])

  const flash = (m: string) => { setToast(m); after(2200, () => setToast(null)) }
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
    const res = buildReply(lang, person, text)
    setTyping(false)
    push({ kind: 'him', time: nowT(), text: res.text, canRemember: res.remember ? { id: 0, ...res.remember } : undefined } as Msg)
    haptic(6)
    if (readAloud) speak(res.text, lang)
  }
  const send = (text: string, voice?: boolean) => {
    const tx = text.trim(); if (!tx) return
    setDraft(''); setPanel(false)
    push({ kind: 'me', time: nowT(), text: tx, voice } as Msg)
    beam(); haptic(6)
    after(750, () => setTyping(true)); after(1900, () => reply(tx))
  }
  const sendPhoto = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setPanel(false)
    let src: string
    try { src = await fileToDataUrl(file, 720) }
    catch { flash(isZh(lang) ? '这张照片没能打开，请重新选择' : "Couldn't open photo. Try again."); return }
    push({ kind: 'photo', time: nowT(), src } as Msg); beam()
    after(700, () => setTyping(true))
    after(1800, () => { setTyping(false); push({ kind: 'him', time: nowT(), text: photoReply(lang) } as Msg) })
  }
  const confirmMemory = (m: Memory) => {
    const kept = { ...m, id: nid() }
    onUpdate({ memories: [kept, ...person.memories] }); onEcho(kept)
    setMemDraft(null); setKeep(false); setSavedMemoryId(kept.id); haptic([8, 30, 8])
    requestAnimationFrame(() => savedMemoryOpener.current?.focus({ preventScroll: true }))
  }

  /* 按住说话：同心信号环 + 实时转文字，上滑取消 */
  const startHold = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    const session = {}; holdSession.current = session
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
  const moveHold = (e: React.PointerEvent) => setHold((h) => (h ? { ...h, cancel: h.y - e.clientY > 70 } : h))
  const cancelHold = () => {
    holdSession.current = null
    try { recog.current?.stop?.() } catch { /* noop */ } recog.current = null
    setHold(null)
  }
  const endHold = () => {
    if (!holdSession.current) return
    const h = hold; cancelHold()
    if (!h || h.cancel) return
    send(h.text || quickReplies(lang)[1], true)
  }

  const giftLabel = isZh(lang) ? '送礼物' : 'Send a gift'
  const actions = [
    { key: 'photo', icon: I.Photo, run: () => photoInput.current?.click() },
    { key: 'camera', icon: I.Camera, run: () => camInput.current?.click() },
    { key: 'voice', icon: I.Phone, run: () => { setPanel(false); setCall('voice') } },
    { key: 'video', icon: I.Video, run: () => { setPanel(false); setCall('video') } },
    { key: 'letter', icon: I.Mail, run: () => { setPanel(false); onLetter() } },
    { key: 'gift', icon: Gift, run: () => { setPanel(false); onGift() } },
    { key: 'keep', icon: I.Keep, run: () => { setPanel(false); setKeep(true) } },
    ...(neighbors.length ? [{ key: 'gather', icon: I.Gather, run: () => { setPanel(false); onGather() } }] : []),
  ]
  const shortThread = thread.filter((m) => m.kind === 'me').length < 2
  const callOverlay = call && <CallOverlay person={person} mode={call} onSwitchVoice={() => setCall('voice')} onClose={() => setCall(null)}
    onEnd={(secs) => { const mode = call; setCall(null); push({ kind: 'call', time: nowT(), mode, secs } as Msg); after(500, () => push({ kind: 'him', time: nowT(), text: callLines(lang).end } as Msg)) }} />
  const memoryContextOverlay = readingContext && memoryContext && <Sheet title={memoryContext.title} onClose={() => setReadingContext(false)}>
    <p className="chat-memory-original">{memoryContext.body}</p>
  </Sheet>
  const savedMemoryOverlay = readingSaved && savedMemory && <MemoryReader memory={savedMemory} personName={person.name} onClose={() => setReadingSaved(false)} />

  return (
    <div ref={nativeBackRoot} inert={!!savedMemoryOverlay && !!overlayTarget} className="absolute inset-0 flex flex-col">
      {memoryContext && <aside className="chat-memory-reference">
        <button className="chat-memory-open" onClick={() => setReadingContext(true)} aria-label={isZh(lang) ? `查看这次聊起的回忆：${memoryContext.title}` : `Read the memory: ${memoryContext.title}`}>
          <I.Keep className="h-4 w-4" /><span><small>{isZh(lang) ? '这次聊起的一页' : 'A memory with you'}</small><strong>{memoryContext.title}</strong></span><I.Chevron className="h-4 w-4" />
        </button>
        {onDismissMemoryContext && <button className="chat-memory-dismiss" onClick={onDismissMemoryContext} aria-label={isZh(lang) ? '收起回忆提示' : 'Dismiss memory context'}><I.X className="h-4 w-4" /></button>}
      </aside>}
      <div ref={area} className="chat-thread-area relative flex-1 min-h-0">
        <div className="absolute inset-x-0 top-0 h-12 z-10 flex items-center justify-center pointer-events-none">
          {typing && <HorizonSignal world={person.world} label={t('talk.generating')} />}
          {arrivals.map((a) => <span key={a.id} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: a.x }}><Arrival world={person.world} /></span>)}
        </div>
        <div ref={scroller} onClick={() => { setSelected(null); setSavedMemoryId(null) }} className="chat-history absolute inset-0 overflow-y-auto scroll-quiet px-4 pt-14 pb-4 space-y-3"
          style={{ maskImage: 'linear-gradient(to bottom, transparent 0, #000 36px)', WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, #000 36px)' }}>
          {thread.map((m) => (
            <MessageRow key={m.id} id={m.id} highlighted={highlighted === m.id}>
              {m.kind === 'gift' ? <GiftMessageCard owner={draftOwner} person={person} direction={m.direction} giftId={m.giftId}
                onOpen={() => m.direction === 'received' ? onReceivedGift(m.giftId) : onGift({ tab: 'receipts', receiptId: m.giftId })} /> : <Bubble m={m} who={person} selected={selected === m.id} onAvatar={onProfile}
                onSelect={() => setSelected((s) => (s === m.id ? null : m.id))}
                onSpeak={(tx) => { setSelected(null); speak(tx, lang) }}
                onCopy={copy}
                onRemember={(mem) => { setSelected(null); setMemDraft(mem) }}
                onDelete={(id) => { setSelected(null); setThread((tt) => tt.filter((x) => x.id !== id)) }} />}
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
        <div className="chat-entry-row flex items-end gap-2">
          <button onClick={() => { setVoiceMode((v) => !v); setPanel(false) }} aria-label={voiceMode ? t('talk.keyboardMode') : t('talk.voiceMode')} className="h-11 w-11 shrink-0 flex items-center justify-center rounded-full ring-1 ring-line bg-paper/70 text-ink-soft active:scale-90 transition-transform">
            {voiceMode ? <I.Keyboard className="h-[22px] w-[22px]" /> : <I.Mic className="h-[21px] w-[21px]" />}
          </button>
          <div className="chat-entry flex min-w-0 flex-1 items-end rounded-[22px] bg-paper/80 ring-1 ring-line focus-within:ring-sky/60">
          {voiceMode ? (
            <button onPointerDown={startHold} onPointerMove={moveHold} onPointerUp={endHold} onPointerCancel={cancelHold}
              className={`min-w-0 flex-1 h-11 rounded-[22px] text-[15.5px] font-medium select-none touch-none transition-colors ${hold ? 'bg-sky/15 text-sky-deep' : 'text-ink'}`}>{hold ? t('talk.release') : t('talk.hold')}</button>
          ) : (
            <textarea ref={entryInput} value={draft} onChange={(e) => setDraft(e.target.value)} rows={1} aria-label={t('talk.ph')} onFocus={() => { setPanel(false); setSavedMemoryId(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); send(draft) } }}
              placeholder={t('talk.ph')} className="chat-entry-input min-w-0 flex-1 min-h-11 max-h-28 resize-none rounded-[22px] bg-transparent pl-3.5 pr-2 py-2.5 text-[16px] leading-6 text-ink outline-none placeholder:text-muted" />
          )}
          <button onClick={() => { setPanel(false); onGift() }} aria-label={giftLabel} title={giftLabel}
            className="chat-gift h-11 w-11 shrink-0 flex items-center justify-center rounded-full text-sky-deep active:bg-sky/10 focus-visible:outline-2 focus-visible:outline-sky-deep focus-visible:-outline-offset-4 transition-colors">
            <Gift className="h-[22px] w-[22px]" weight="duotone" aria-hidden />
          </button>
          </div>
          {draft.trim() && !voiceMode
            ? <button onClick={() => send(draft)} aria-label={t('talk.send')} className="chat-send h-11 w-11 shrink-0 flex items-center justify-center rounded-full btn-dark active:scale-90 transition-transform pop-in"><I.Send className="h-5 w-5" /></button>
            : <button onClick={() => { setPanel((v) => !v); haptic(6) }} aria-label={t('talk.more')} aria-expanded={panel} aria-controls={panel ? 'chat-actions' : undefined} className={`h-11 w-11 shrink-0 flex items-center justify-center rounded-full ring-1 transition-all duration-300 active:scale-90 ${panel ? 'btn-dark ring-ink rotate-45' : 'bg-paper/70 ring-line text-ink-soft'}`}><I.Plus className="h-6 w-6" /></button>}
        </div>
        {panel && (
          <div id="chat-actions" className="chat-action-grid relative mt-4 mb-1 grid grid-cols-4 gap-x-1 gap-y-3 animate-rise">
            {actions.map((a, i) => (
              <button key={a.key} onClick={a.run} className="flex min-w-0 flex-col items-center gap-1.5 rounded-[20px] active:scale-95 transition-transform rise-in" style={{ animationDelay: `${i * 0.024}s` }}>
                <span className="w-full max-w-[60px] aspect-square flex items-center justify-center rounded-[20px] bg-paper/80 ring-1 ring-paper text-ink shadow-[0_10px_24px_-16px_rgba(41,69,66,0.6)]"><a.icon className="h-[25px] w-[25px]" /></span>
                <span className="max-w-full [overflow-wrap:anywhere] text-[11.5px] text-ink-soft">{a.key === 'gift' ? giftLabel : t(`act.${a.key}`)}</span>
              </button>
            ))}
          </div>
        )}
        <input ref={photoInput} type="file" accept="image/*" className="hidden" onChange={(e) => { sendPhoto(e.target.files); e.target.value = '' }} />
        <input ref={camInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { sendPhoto(e.target.files); e.target.value = '' }} />
      </div>

      {callOverlay && (overlayTarget ? createPortal(callOverlay, overlayTarget) : callOverlay)}
      {memoryContextOverlay && (overlayTarget ? createPortal(memoryContextOverlay, overlayTarget) : memoryContextOverlay)}
      {savedMemoryOverlay && (overlayTarget ? createPortal(savedMemoryOverlay, overlayTarget) : savedMemoryOverlay)}
      {memDraft && <MemorySheet title={t('mem.title')} note={t('mem.note', { name: person.name })} draft={memDraft} onConfirm={confirmMemory} onClose={() => setMemDraft(null)} />}
      {keep && <MemorySheet title={t('keep.title')} draft={{ id: 0, title: '', body: '' }} editing onConfirm={confirmMemory} onClose={() => setKeep(false)} />}
      {toast && <Toast text={toast} />}
    </div>
  )
}
type RecEvt = { results: ArrayLike<ArrayLike<{ transcript: string }>> }
type Rec = { lang: string; interimResults: boolean; start: () => void; stop: () => void; onresult: (e: RecEvt) => void }

/* ------------------------------- 气泡 ------------------------------- */
export function Bubble({ m, who, selected, onSelect, onSpeak, onCopy, onRemember, onDelete, speaker, onAvatar }: {
  m: Msg; who?: Person; selected: boolean; onSelect: () => void; onSpeak: (t: string) => void; onCopy: (t: string) => void
  onRemember?: (mem: Memory) => void; onDelete: (id: number) => void; speaker?: Person; onAvatar?: () => void
}) {
  const { t } = useI18n()
  if (m.kind === 'note') return <p className="chat-system-note mx-auto max-w-[17rem] py-1 text-center text-[12px] leading-relaxed text-ink-soft/80 animate-fade">{m.text}</p>
  if (m.kind === 'call') return (
    <div className="flex justify-center animate-fade"><span className="inline-flex items-center gap-1.5 rounded-full glass-light px-3 py-1.5 text-[12px] text-ink-soft">{m.mode === 'voice' ? <I.Phone className="h-3.5 w-3.5" /> : <I.Video className="h-3.5 w-3.5" />}{t(m.mode === 'voice' ? 'talk.call.voice' : 'talk.call.video', { d: fmtDuration(m.secs) })}</span></div>
  )
  if (m.kind === 'photo') return (
    <div className="flex flex-col items-end animate-rise">
      <button onClick={(e) => { e.stopPropagation(); onSelect() }} className="rounded-[20px] rounded-br-md overflow-hidden ring-1 ring-white shadow-[0_12px_30px_-18px_rgba(41,69,66,0.6)] h-44 w-48 bg-cloud"><img src={m.src ?? STORY_IMG} alt={t('talk.photo')} className="h-full w-full object-cover" /></button>
      <span className="mt-1 pr-1 text-[10.5px] text-muted">{m.time}</span>
      {selected && <div className="mt-1.5 animate-rise"><Act icon={I.Trash} label={t('talk.delete')} onClick={() => onDelete(m.id)} danger /></div>}
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
            {!mine && m.kind === 'him' && onRemember && <Act icon={I.Keep} label={t('talk.remember')} onClick={() => onRemember(m.canRemember ?? { id: 0, title: t('talk.mentioned'), body: m.text })} />}
            <Act icon={I.Trash} label={t('talk.delete')} onClick={() => onDelete(m.id)} danger />
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

export function LetterCard({ l, person }: { l: Letter; person: Person }) {
  const { t } = useI18n()
  return (
    <div className="space-y-2.5">
      <div className="letter-paper rounded-2xl paper-fringe px-4 py-3.5 shadow-[0_12px_30px_-24px_rgba(41,69,66,0.6)]">
        <p className="font-mono text-[10px] tracking-[0.16em] text-ink-soft">{t('letter.mine', { date: l.date })}</p>
        <p className="mt-2 font-serif text-[16.5px] leading-[1.9] text-ink whitespace-pre-wrap [overflow-wrap:anywhere]">{l.text}</p>
      </div>
      {l.reply ? (
        <div className={`ml-6 rounded-2xl bg-sun-tint/70 ring-1 ring-sun/40 px-4 py-3.5 ${l.replyNew ? 'rise-in' : ''}`}>
          <div className="flex items-center gap-2 mb-1.5"><Lens world={person.world} avatar={person.avatar} name={person.name} size={24} /><span className="font-mono text-[10px] tracking-[0.14em] text-sun-deep">{t('letter.replyFrom', { name: person.name })}</span></div>
          <p className="font-serif text-[16px] leading-[1.9] text-ink whitespace-pre-wrap [overflow-wrap:anywhere]">{l.reply}</p>
        </div>
      ) : l.wantReply && l.replyAt ? (
        <p className="ml-6 font-mono text-[10.5px] tracking-[0.12em] text-ink-soft">{t('letter.pending', { when: l.replyAt - Date.now() < 60000 ? t('letter.when.now') : t(isTomorrow(l.replyAt) ? 'letter.when.tomorrow' : 'letter.when.today') })}</p>
      ) : null}
    </div>
  )
}
export function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex items-baseline justify-between gap-4 px-4 py-3.5"><span className="max-w-1/2 text-[14px] text-ink-soft [overflow-wrap:anywhere]">{k}</span><span className="min-w-0 text-[14.5px] text-ink text-right [overflow-wrap:anywhere]">{v}</span></div>
}

/* ============================== 珍藏记忆 ============================== */
export function MemorySheet({ title, note, draft, editing: startEditing, onConfirm, onClose }: { title: string; note?: string; draft: Memory; editing?: boolean; onConfirm: (m: Memory) => void; onClose: () => void }) {
  const { t } = useI18n()
  const [m, setM] = useState(draft)
  const [editing, setEditing] = useState(!!startEditing)
  const canSave = Boolean(m.title.trim() || m.body.trim())
  return (
    <Sheet onClose={onClose} title={title}
      footer={<div className="flex flex-wrap items-center gap-2">
        <button onClick={onClose} className="min-h-11 rounded-full px-3.5 py-2.5 text-[15px] text-ink-soft">{t('mem.discard')}</button>
        {!startEditing && <button onClick={() => setEditing((v) => !v)} className="min-h-11 rounded-full ring-1 ring-line px-3.5 py-2.5 text-[15px] text-ink-soft">{editing ? t('mem.editDone') : t('mem.edit')}</button>}
        <button disabled={!canSave} onClick={() => onConfirm({ ...m, title: m.title.trim() || m.body.trim().slice(0, 10) })} className="min-h-11 grow rounded-full btn-dark px-3.5 py-2.5 text-[16px] font-semibold active:scale-[0.98] transition-transform disabled:opacity-50">{t('mem.confirm')}</button>
      </div>}>
      <div className="rounded-2xl glass-light p-4">
        {editing ? (
          <>
            <input autoFocus value={m.title} onChange={(e) => setM({ ...m, title: e.target.value })} aria-label={t('keep.t.ph')} placeholder={t('keep.t.ph')} className="w-full bg-transparent font-serif text-[20px] text-ink border-b border-line pb-2 placeholder:text-muted focus-visible:outline-2 focus-visible:outline-sky-deep" />
            <textarea value={m.body} onChange={(e) => setM({ ...m, body: e.target.value })} rows={4} aria-label={t('keep.b.ph')} placeholder={t('keep.b.ph')} className="mt-3 w-full resize-none bg-transparent text-[15.5px] leading-relaxed text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-sky-deep" />
          </>
        ) : (<><h3 className="font-serif text-[21px] text-ink">{m.title}</h3><p className="mt-2 text-[15.5px] leading-relaxed text-ink-soft">{m.body}</p></>)}
      </div>
      {note && <p className="mt-3 text-[12.5px] text-muted">{note}</p>}
    </Sheet>
  )
}

/* ================================ 写信 ================================ */
type LetterDraft = { text: string; wantReply: boolean; when: 'morning' | 'now' }
type LetterDraftRecord = { value: LetterDraft; version: object }
type LetterComposerProps = { person: Person; draftOwner: string; onClose: () => void; onSent: (l: Letter) => void }
const letterDrafts = new Map<string, LetterDraftRecord>()

export function LetterComposer(props: LetterComposerProps) {
  const { person, draftOwner } = props
  const draftKey = JSON.stringify([draftOwner, person.localId ? ['identity', person.localId] : ['legacy', person.id]])
  return <LetterComposerView key={draftKey} {...props} draftKey={draftKey} />
}

function LetterComposerView({ person, onClose, onSent, draftKey }: LetterComposerProps & { draftKey: string }) {
  const { t, lang } = useI18n()
  const night = useContext(NightCtx)
  useStatusTone(night ? 'light' : 'dark')
  const [draft, setDraft] = useState<LetterDraftRecord>(() => letterDrafts.get(draftKey) ?? { value: { text: '', wantReply: true, when: 'morning' }, version: {} })
  const currentDraft = useRef(draft)
  currentDraft.current = draft
  const { text, wantReply, when } = draft.value
  const sealing = useRef(false)
  const timers = useRef<number[]>([])
  const after = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)) }
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const updateDraft = (patch: Partial<LetterDraft>) => {
    if (sealing.current) return
    const next = { value: { ...currentDraft.current.value, ...patch }, version: {} }
    currentDraft.current = next
    if (next.value.text.trim()) letterDrafts.set(draftKey, next)
    else letterDrafts.delete(draftKey)
    setDraft(next)
  }
  const [stage, setStage] = useState<'write' | 'fold' | 'fly' | 'done'>('write')
  const close = () => { if (!sealing.current) onClose() }
  const nativeBackRoot = useRef<HTMLDivElement>(null)
  useNativeBack(() => {
    // Sealing already schedules delivery and dismissal; do not unmount it halfway.
    if (stage === 'write') close()
    return true
  }, true, 55, nativeBackRoot)
  const seal = () => {
    if (sealing.current) return
    const sentDraft = currentDraft.current
    const tx = sentDraft.value.text.trim(); if (!tx) return
    sealing.current = true
    const letter: Letter = { id: Date.now(), date: fmtDate(lang), text: tx, wantReply: sentDraft.value.wantReply, replyAt: sentDraft.value.wantReply ? (sentDraft.value.when === 'now' ? Date.now() + 2600 : nextMorning()) : undefined }
    const deliver = () => {
      onSent(letter)
      if (letterDrafts.get(draftKey)?.version === sentDraft.version) letterDrafts.delete(draftKey)
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
              <textarea autoFocus value={text} onChange={(e) => updateDraft({ text: e.target.value })} aria-label={t('letter.ph')} placeholder={t('letter.ph')} className="mt-3 min-h-0 flex-1 resize-none bg-transparent outline-none font-serif text-[18px] leading-[34px] text-ink placeholder:text-ink-soft caret-sky-deep focus-visible:outline-2 focus-visible:outline-sky-deep" />
            </div>
            {stage === 'fold' && <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-10 w-10 rounded-full pop-in" style={{ background: 'radial-gradient(circle, #f6dcae, #c99b56)', boxShadow: '0 0 24px rgba(235,201,149,0.9)' }} />}
          </div>
          {stage === 'fly' && <span className="absolute left-1/2 top-1/2 h-3 w-3 -ml-1.5 rounded-full dot-fly" style={{ background: '#fff7e6', boxShadow: '0 0 18px 6px rgba(235,201,149,0.85)', ['--dx' as string]: '0px', ['--dy' as string]: '-360px' } as React.CSSProperties} />}
        </div>
        <div className={`px-5 pb-9 transition-opacity duration-300 ${stage === 'write' ? '' : 'opacity-0 pointer-events-none'}`}>
          <div className="rounded-2xl glass-light overflow-hidden"><Switch on={wantReply} onToggle={() => updateDraft({ wantReply: !currentDraft.current.value.wantReply })} label={t('letter.reply')} desc={t('letter.reply.ai')} /></div>
          {wantReply && (
            <div className="mt-2.5 flex gap-1 rounded-full bg-black/[0.04] p-1">
              {(['morning', 'now'] as const).map((k) => <button key={k} onClick={() => updateDraft({ when: k })} aria-pressed={when === k} className={`flex-1 min-h-11 rounded-full px-1.5 py-1 text-[14px] transition-colors ${when === k ? 'bg-paper text-ink shadow-sm' : 'text-ink-soft'}`}>{t(k === 'morning' ? 'letter.when.morning' : 'letter.when.now')}</button>)}
            </div>
          )}
          <button onClick={seal} disabled={!text.trim() || stage !== 'write'} className="letter-seal mt-3 w-full h-14 rounded-full btn-dark text-[16.5px] font-semibold tracking-[0.12em] active:scale-[0.98] transition-all">{t('letter.seal')}</button>
        </div>
      </div>
      {stage === 'done' && <Toast text={t('letter.kept')} />}
    </div>
  )
}

/* ================================ 通话 ================================ */
type CallState = 'primer' | 'connecting' | 'listening' | 'thinking' | 'replying' | 'interrupted'
export function CallOverlay({ person, mode, onSwitchVoice, onClose, onEnd }: { person: Person; mode: 'voice' | 'video'; onSwitchVoice: () => void; onClose: () => void; onEnd: (secs: number) => void }) {
  const { t, lang } = useI18n()
  const night = useContext(NightCtx)
  useStatusTone(night ? 'light' : 'dark')
  const lines = callLines(lang)
  const video = mode === 'video'
  const [st, setSt] = useState<CallState>('primer')
  const [cap, setCap] = useState('')
  const [secs, setSecs] = useState(0)
  const [muted, setMuted] = useState(false)
  const [captions, setCaptions] = useState(true)
  const [loud, setLoud] = useState(true)
  const live = st !== 'primer' && st !== 'connecting'
  const closeCall = () => {
    window.speechSynthesis?.cancel()
    if (live) onEnd(secs)
    else onClose()
  }
  const nativeBackRoot = useRef<HTMLDivElement>(null)
  useNativeBack(() => { closeCall(); return true }, true, 40, nativeBackRoot)
  const timers = useRef<number[]>([])
  const after = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)) }
  const clear = () => { timers.current.forEach(clearTimeout); timers.current = [] }
  useEffect(() => () => { clear(); window.speechSynthesis?.cancel() }, [])
  useEffect(() => { if (!live) return; const id = window.setInterval(() => setSecs((s) => s + 1), 1000); return () => clearInterval(id) }, [live])

  const type = (full: string, done?: () => void) => {
    setCap(''); let i = 0
    const tick = () => { i++; setCap(full.slice(0, i)); if (i < full.length) timers.current.push(window.setTimeout(tick, 42)); else done?.() }
    timers.current.push(window.setTimeout(tick, 120))
  }
  const say = (line: string) => { setSt('replying'); if ((person.hasVoice || video) && loud) speak(line, lang); type(line, () => after(500, () => setSt('listening'))) }
  const start = () => {
    setSt('connecting'); haptic(8)
    after(fxPrefs.calm ? 200 : 1050, () => { haptic([10, 30, 10]); chime('connect'); say(video ? lines.openVideo : person.hasVoice ? lines.openVoice : lines.openNoVoice) })
  }
  const talk = () => { clear(); setSt('thinking'); after(900, () => say(lines.ack)) }
  const interrupt = () => { clear(); window.speechSynthesis?.cancel(); setSt('interrupted'); setCap(''); after(700, () => setSt('listening')) }
  const label: Record<CallState, string> = { primer: '', connecting: t('call.connecting'), listening: t('call.listening'), thinking: t('call.thinking'), replying: t('call.replying', { name: person.name }), interrupted: t('call.interrupted') }
  const speaking = st === 'replying'

  return (
    <div ref={nativeBackRoot} role="dialog" aria-modal="true" aria-label={t(video ? 'call.video.label' : 'call.label')} className="call-shell absolute inset-0 z-[80] flex flex-col overflow-hidden" data-tone={night ? 'night' : 'day'}>
      {night && <DeepField />}
      <div className="call-scene absolute inset-x-0 top-[var(--app-status-height)] bottom-0" aria-hidden><WorldScene world={person.world} /></div>
      <div className="call-scrim absolute inset-0" aria-hidden />

      <div className="relative z-10 shrink-0 pt-[calc(var(--app-status-height)+6px)] px-5 flex items-center gap-3">
        <button autoFocus onClick={closeCall} aria-label={t('common.back')} className="call-surface h-11 w-11 shrink-0 flex items-center justify-center rounded-full glass-dim"><I.Back className="h-5 w-5" /></button>
        <div className="min-w-0 flex-1 text-center">
          <div title={person.name} className="truncate font-serif text-[22px] leading-tight tracking-[0.1em]">{person.name}</div>
          <div className="call-secondary mt-1 truncate font-mono text-[9.5px] tracking-[0.18em]">{video ? t('call.video.label') : t('call.label')}</div>
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
            <p className="call-secondary mt-2 text-[13.5px]">{t('call.primer.note')}</p>
            <button onClick={start} className="call-primary mt-5 min-h-14 px-9 py-2 rounded-full btn-light text-[16.5px] font-semibold tracking-[0.12em] active:scale-[0.98] transition-transform">{t('call.connect')}</button>
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
              : <button onClick={talk} disabled={muted} className="call-primary relative h-16 w-16 flex items-center justify-center rounded-full btn-light active:scale-95 transition-transform"><I.Mic className="h-7 w-7" /><span className="sr-only">{t('call.talk')}</span></button>}
          </div>
          <div className="grid grid-cols-4 gap-2">
            <CallBtn icon={muted ? I.MicOff : I.Mic} label={t('call.mute')} on={muted} onClick={() => setMuted((v) => !v)} />
            <CallBtn icon={I.Captions} label={t('call.captions')} on={captions} onClick={() => setCaptions((v) => !v)} />
            <CallBtn icon={I.Speaker} label={t('call.speaker')} on={loud} onClick={() => { setLoud((v) => !v); window.speechSynthesis?.cancel() }} />
            <button onClick={closeCall} className="flex min-w-0 flex-col items-center gap-1.5"><span className="w-full max-w-14 aspect-square rounded-full bg-coral text-pearl flex items-center justify-center active:scale-95 transition-transform"><I.Hangup className="h-6 w-6" /></span><span className="call-secondary max-w-full text-[11.5px] [overflow-wrap:anywhere]">{t('call.hangup')}</span></button>
          </div>
          {video && <button onClick={onSwitchVoice} className="call-secondary mt-1 min-h-11 mx-auto block text-[12.5px] underline underline-offset-2">{t('call.toVoice')}</button>}
        </div>
      )}
    </div>
  )
}
function CallBtn({ icon: Icon, label, on, onClick }: { icon: (p: { className?: string }) => React.ReactElement; label: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-pressed={on} className="flex min-w-0 flex-col items-center gap-1.5">
      <span className={`w-full max-w-14 aspect-square rounded-full flex items-center justify-center transition-colors active:scale-95 ${on ? 'call-primary btn-light' : 'call-surface glass-dim'}`}><Icon className="h-6 w-6" /></span>
      <span className="call-secondary max-w-full text-[11.5px] [overflow-wrap:anywhere]">{label}</span>
    </button>
  )
}

/* ============================== 关于 TA =============================== */
export function GearSheet({ person, people, large, readAloud, onClose, onUpdate, onDelete, onToggleLarge, onToggleRead }: {
  person: Person; people: Person[]; large: boolean; readAloud: boolean; onClose: () => void; onUpdate: (p: Partial<Person>) => void
  onDelete: () => void; onToggleLarge: () => void; onToggleRead: () => void
}) {
  const { t, lang } = useI18n()
  const [edit, setEdit] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [adding, setAdding] = useState<null | 'personality' | 'life' | 'unknowns'>(null)
  const [val, setVal] = useState('')
  const [sample, setSample] = useState<{ kind: 'photos' | 'voice' | 'video' | 'chat'; data: ReturnType<typeof extract> } | null>(null)
  const pendingSample = useRef<typeof sample>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const lit = clarity(person)
  const say = (m: string) => { setMsg(m); window.setTimeout(() => setMsg(null), 2200) }
  const closeSample = () => { pendingSample.current = null; setSample(null) }
  const feed = (k: 'photos' | 'voice' | 'video' | 'chat') => {
    const next = { kind: k, data: extract(lang, k) }
    pendingSample.current = next; setSample(next)
  }
  const confirmSample = () => {
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
  const addTo = (key: 'personality' | 'life' | 'unknowns') => {
    const v = val.trim(); setAdding(null); setVal('')
    if (v) { onUpdate({ [key]: [...person[key], v] } as Partial<Person>); say(t('gear.saved')) }
  }
  const move = (w: WorldId) => { onUpdate({ world: w, weather: worldWeather(lang, w) }); haptic([10, 40, 10]); say(t('gear.world.moved', { world: t(`world.${w}`) })) }
  const addPhotos = async (files: FileList | null) => {
    if (!files) return
    const urls: string[] = []
    for (const f of Array.from(files).slice(0, 4)) { try { urls.push(await fileToDataUrl(f)) } catch { /* 跳过 */ } }
    if (urls.length) onUpdate({ photos: [...(person.photos ?? []), ...urls], avatar: person.avatar || urls[0] })
  }
  const photos = [...new Set([...(person.photos ?? []), person.avatar].filter(Boolean))]

  return (
    <Sheet tall onClose={onClose} title={<div className="flex items-center gap-3"><Lens world={person.world} avatar={person.avatar} name={person.name} size={46} arcs={lit} /><div className="ml-1"><div>{t('gear.title', { name: person.name })}</div><div className="font-sans text-[12.5px] text-ink-soft">{person.relation} · {t(`world.${person.world}`)}</div></div></div>}>
      <GearGroup title={t('gear.profile')} action={<button onClick={() => setEdit(true)} className="text-[13px] text-sky-deep">{t('common.edit')}</button>}>
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
      </GearGroup>

      <GearGroup title={t('gear.face')}>
        <div className="px-4 py-3.5">
          <div className="flex gap-3 overflow-x-auto scroll-quiet pb-1">
            {photos.map((src, index) => <button key={src.slice(-30)} onClick={() => onUpdate({ avatar: src })} aria-label={isZh(lang) ? `选择第${index + 1}张照片` : `Choose photo ${index + 1}`} aria-pressed={person.avatar === src} className={`h-14 w-14 shrink-0 rounded-full overflow-hidden ring-2 transition-all ${person.avatar === src ? 'ring-sun scale-105' : 'ring-line'}`}><img src={src} alt="" className="h-full w-full object-cover" /></button>)}
            {FACE_ALBUM.filter((a) => !photos.includes(a.src)).slice(0, 3).map((a, index) => <button key={a.src} onClick={() => onUpdate({ avatar: a.src, photos: [...(person.photos ?? []), a.src] })} aria-label={isZh(lang) ? `选择第${photos.length + index + 1}张照片` : `Choose photo ${photos.length + index + 1}`} aria-pressed={person.avatar === a.src} className="h-14 w-14 shrink-0 rounded-full overflow-hidden ring-2 ring-line opacity-60"><img src={a.src} alt="" className="h-full w-full object-cover" /></button>)}
            <label className="h-14 w-14 shrink-0 rounded-full border border-dashed border-line flex items-center justify-center text-muted cursor-pointer"><I.Plus className="h-5 w-5" /><input type="file" accept="image/*" multiple className="hidden" onChange={(e) => addPhotos(e.target.files)} /></label>
          </div>
          <p className="mt-2 text-[12px] text-muted">{t('gear.face.note')}</p>
        </div>
        <Row k={t('gear.voice')} v={person.hasVoice ? t('gear.voice.on') : t('gear.voice.off')} />
      </GearGroup>

      <GearGroup title={t('gear.tone')} action={<button onClick={() => { setAdding('personality'); setVal('') }} className="text-[13px] text-sky-deep">{t('gear.add')}</button>}>
        <div className="px-4 py-3.5">
          <div className="flex flex-wrap gap-2">{person.personality.map((x, i) => <span key={i} className="rounded-full bg-black/[0.04] px-3 py-1.5 text-[13.5px] text-ink-soft">{x}</span>)}</div>
          {person.catchphrase && <p className="mt-2.5 text-[14px] text-ink-soft">“{person.catchphrase}”</p>}
          {adding === 'personality' && <AddInline value={val} setValue={setVal} onDone={() => addTo('personality')} placeholder={t('gear.tone.ph')} />}
        </div>
      </GearGroup>

      <GearGroup title={t('gear.life')} action={<button onClick={() => { setAdding('life'); setVal('') }} className="text-[13px] text-sky-deep">{t('gear.add')}</button>}>
        <div className="px-4 py-3.5">
          <ul className="space-y-1.5">{person.life.map((l, i) => <li key={i} className="flex gap-2 text-[14.5px] text-ink-soft"><span className="text-sun-deep">·</span>{l}</li>)}</ul>
          {adding === 'life' && <AddInline value={val} setValue={setVal} onDone={() => addTo('life')} placeholder={t('gear.life.ph')} />}
        </div>
      </GearGroup>

      <GearGroup title={t('gear.unknown')} action={<button onClick={() => { setAdding('unknowns'); setVal('') }} className="text-[13px] text-sky-deep">{t('gear.add')}</button>}>
        <div className="px-4 py-3.5">
          <p className="text-[12.5px] text-muted">{t('gear.unknown.note')}</p>
          <ul className="mt-1.5 space-y-1">{person.unknowns.map((l, i) => <li key={i} className="flex gap-2 text-[14px] text-muted"><span>·</span>{l}</li>)}</ul>
          {adding === 'unknowns' && <AddInline value={val} setValue={setVal} onDone={() => addTo('unknowns')} placeholder={t('gear.unknown.ph')} />}
        </div>
      </GearGroup>

      <GearGroup title={t('gear.world')}>
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
              {here ? <span className="font-mono text-[10px] tracking-[0.16em] text-sun-deep">{t('gear.world.here')}</span> : <button onClick={() => move(w)} className="rounded-full ring-1 ring-line px-3.5 py-1.5 text-[13px] text-ink-soft active:bg-black/[0.04]">{t('gear.world.move')}</button>}
            </div>
          )
        })}
      </GearGroup>

      <GearGroup title={t('gear.a11y')}>
        <Switch on={large} onToggle={onToggleLarge} label={t('me.large')} desc={t('me.large.desc')} />
        <Switch on={readAloud} onToggle={onToggleRead} label={t('me.read')} desc={t('me.read.desc')} />
      </GearGroup>

      <GearGroup title={t('gear.privacy')}>
        <Row k={t('gear.privacy.chat')} v={t('gear.privacy.chat.v')} />
        <Row k={t('gear.privacy.material')} v={t('gear.privacy.material.v')} />
        <p className="px-4 py-3.5 text-[13px] leading-relaxed text-ink-soft">{t('ai.body')}</p>
      </GearGroup>

      <button onClick={() => setConfirmDel(true)} className="mt-2 w-full rounded-2xl ring-1 ring-line py-3.5 text-[14px] text-muted active:bg-black/[0.03]">{t('gear.delete')}</button>

      {edit && <EditProfile person={person} onClose={() => setEdit(false)} onSave={(p) => { onUpdate(p); setEdit(false); say(t('gear.saved')) }} />}
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
        <Sheet onClose={() => setConfirmDel(false)} title={t('del.title', { name: person.name })}
          footer={<div className="flex gap-2.5"><button onClick={() => setConfirmDel(false)} className="flex-1 rounded-full ring-1 ring-line py-3 text-[16px] text-ink">{t('del.cancel')}</button><button onClick={onDelete} className="rounded-full bg-coral text-white px-7 py-3 text-[15px] font-semibold">{t('del.confirm')}</button></div>}>
          <p className="text-[14.5px] leading-relaxed text-ink-soft">{t('del.body')}</p>
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
function AddInline({ value, setValue, onDone, placeholder }: { value: string; setValue: (v: string) => void; onDone: () => void; placeholder: string }) {
  return (
    <div className="mt-3 flex items-center gap-2 animate-rise">
      <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); onDone() } }} placeholder={placeholder} className="flex-1 rounded-xl bg-paper ring-1 ring-sky/40 px-3.5 py-2.5 text-[15px] text-ink outline-none" />
      <button onClick={onDone} className="h-10 w-10 rounded-xl btn-dark flex items-center justify-center"><I.Check className="h-4 w-4" /></button>
    </div>
  )
}
function EditProfile({ person, onSave, onClose }: { person: Person; onSave: (p: Partial<Person>) => void; onClose: () => void }) {
  const { t } = useI18n()
  const [f, setF] = useState({ name: person.name, realName: person.realName ?? '', relation: person.relation, calledMe: person.calledMe ?? '', birthday: person.birthday ?? '', years: person.years ?? '', place: person.place ?? '' })
  const field = (k: keyof typeof f, label: string, ph?: string) => (
    <label className="block"><span className="text-[12px] text-muted">{label}</span>
      <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={ph} className="mt-1.5 w-full rounded-2xl bg-paper ring-1 ring-line px-4 py-3 text-[15.5px] text-ink outline-none focus:ring-sky/50 placeholder:text-muted" /></label>
  )
  return (
    <Sheet tall onClose={onClose} title={t('edit.title')}
      footer={<div className="flex gap-2.5"><button onClick={onClose} className="rounded-full px-6 py-3 text-[15px] text-ink-soft">{t('common.cancel')}</button><button onClick={() => onSave({ name: f.name.trim() || person.name, realName: f.realName.trim() || undefined, relation: f.relation.trim() || person.relation, calledMe: f.calledMe.trim() || undefined, birthday: f.birthday.trim() || undefined, years: f.years.trim() || undefined, place: f.place.trim() || undefined })} className="flex-1 rounded-full btn-dark py-3 text-[16px] font-semibold">{t('common.save')}</button></div>}>
      <div className="space-y-4">
        {field('name', t('gear.called'))}
        {field('realName', t('gear.realName'))}
        {field('relation', t('gear.relation'))}
        {field('calledMe', t('gear.calledMe'))}
        {field('birthday', t('gear.birthday'), t('seek.time.birthday.ph'))}
        {field('years', t('gear.years'), t('seek.time.years.ph'))}
        {field('place', t('gear.place'), t('seek.place.ph'))}
      </div>
    </Sheet>
  )
}

/* ================================ 围坐 ================================ */
export function Gathering({ world, people, chat, draftOwner, focusMessageId, onPersist, onBack, onOpen }: { world: WorldId; people: Person[]; chat?: Msg[]; draftOwner: string; focusMessageId?: number; onPersist: (m: Msg[]) => void; onBack: () => void; onOpen: (id: number) => void }) {
  const { t, lang } = useI18n()
  const night = useContext(NightCtx)
  useStatusTone(night ? 'light' : 'dark')
  const nowT = () => fmtTime(lang)
  const [thread, setThread] = useConversationHistory(chat, onPersist, () => [{ id: nid(), kind: 'note', text: t('gather.note') }])
  const [draft, setDraft] = useConversationDraft(draftOwner, `g:${world}`)
  const [typing, setTyping] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const timers = useRef<number[]>([])
  const { scroller, highlighted } = useThreadScroll(thread, typing, focusMessageId)
  const nativeBackRoot = useRef<HTMLDivElement>(null)
  useNativeBack(() => {
    if (selected === null) return false
    setSelected(null)
    return true
  }, selected !== null, 10, nativeBackRoot)
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const send = () => {
    const tx = draft.trim(); if (!tx) return
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
        <div className="absolute inset-x-0 top-0 h-12 z-10 flex items-center justify-center pointer-events-none">{typing && <HorizonSignal world={world} label={t('talk.generating')} />}</div>
        <div ref={scroller} onClick={() => setSelected(null)} className="absolute inset-0 overflow-y-auto scroll-quiet px-4 pt-14 pb-4 space-y-3" style={{ maskImage: 'linear-gradient(to bottom, transparent 0, #000 60px)', WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, #000 60px)' }}>
          {thread.map((m) => {
            const speaker = m.kind === 'him' ? people.find((p) => p.id === m.who) : undefined
            return <MessageRow key={m.id} id={m.id} highlighted={highlighted === m.id}>
              <Bubble m={m} speaker={speaker} onAvatar={speaker ? () => onOpen(speaker.id) : undefined}
                selected={selected === m.id} onSelect={() => setSelected((s) => (s === m.id ? null : m.id))}
                onSpeak={(tx) => speak(tx, lang)} onCopy={(tx) => { void navigator.clipboard?.writeText(tx).catch(() => {}) }}
                onDelete={(id) => { setThread((tt) => tt.filter((x) => x.id !== id)); setSelected(null) }} />
            </MessageRow>
          })}
        </div>
      </div>
      <div className="app-composer relative z-10 shrink-0 border-t border-line bg-canvas rounded-t-[26px] px-3 pt-2.5 pb-[30px]">
        <div className="flex items-end gap-2">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={1} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); send() } }} aria-label={t('talk.ph')} placeholder={t('talk.ph')} className="min-w-0 flex-1 min-h-11 max-h-28 resize-none rounded-[22px] bg-paper ring-1 ring-line px-4 py-2.5 text-[16px] leading-6 text-ink outline-none placeholder:text-muted focus:ring-sky/40" />
          <button onClick={send} disabled={!draft.trim()} aria-label={t('talk.send')} className="h-11 w-11 shrink-0 flex items-center justify-center rounded-full btn-dark active:scale-90 transition-transform"><I.Send className="h-5 w-5" /></button>
        </div>
      </div>
    </div>
  )
}
