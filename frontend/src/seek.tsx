import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  useI18n, FACE_ALBUM, resonate, parseStory, firstLine, relKeys, relKeyOf, AGE_OF_REL, REL_PAIRS, calledDefault,
  seekSamples, worldWeather, archetype, speechLang, TONES, WORLD_IDS,
  type Age, type RelKey, type Tone, type WorldId,
} from './i18n'
import { nid, fileToDataUrl, HEADER_AVATAR, type Person } from './model'
import { WORLDS, WorldScene } from './worlds'
import { DeepField, Veil, Lens, ArcRing, Dust, Beacon } from './fx'
import { I, Sheet, haptic, chime, fxPrefs, useStatusTone, NightCtx, AiBadge, type IP } from './ui'
import './seek-theme.css'
import './seek-journey-theme.css'

/* ------------------------------------------------------------------ *
 * 寻找 TA —— 以记忆为坐标
 *   第一幕 坐标台：六个坐标环绕信标，每填一项，信标更清晰
 *   第二幕 穿越：汇聚 → 关键词锁定 → 穿过诸世界 → 抵达 → 显现
 *   第三幕 相认：很像 TA / 再调整（对焦）
 *   第四幕 确认关系，加入联系人：透镜沿光丝落进聊天页头像
 * 寻找发生在用户自己的记忆里；被找到的是 AI 依据这些记忆呈现的 TA。
 * ------------------------------------------------------------------ */

type NodeKey = 'name' | 'face' | 'voice' | 'story' | 'time' | 'place'
const ORDER: NodeKey[] = ['name', 'face', 'voice', 'story', 'time', 'place']   // 与六段光弧同序
const NODES: { key: NodeKey; a: number; icon: (p: IP) => React.ReactElement }[] = [
  { key: 'name', a: -90, icon: I.Name }, { key: 'face', a: -30, icon: I.Face }, { key: 'voice', a: 30, icon: I.Voice },
  { key: 'place', a: 90, icon: I.Place }, { key: 'story', a: 150, icon: I.Story }, { key: 'time', a: 210, icon: I.Time },
]
const BOX = 340; const C = BOX / 2; const R = 122
const nodePos = (a: number) => ({ x: C + R * Math.cos((a * Math.PI) / 180), y: C + R * Math.sin((a * Math.PI) / 180) })

type Draft = { called: string; realName: string; faces: string[]; faceAge?: Age; voice: number; story: string; birthday: string; years: string; place: string }
const EMPTY: Draft = { called: '', realName: '', faces: [], voice: 0, story: '', birthday: '', years: '', place: '' }
type Phase = 'console' | 'search' | 'reveal' | 'bond' | 'connect'
type SeekDraft = {
  d: Draft; tone: Tone; timbre: 'warm' | 'bright' | 'deep'; mainFace: number
  relKey: RelKey | null; custom: string; calledMe: string; world: WorldId; exclude: WorldId[]; sampleIdx: number
}
type SeekSample = ReturnType<typeof seekSamples>[number]
// Session-only, matching conversation drafts. Account identities never share a key with the nickname fallback.
const seekDrafts = new Map<string, { session: object; value: SeekDraft }>()
const hasSeekInput = ({ d, tone, timbre, relKey, custom, calledMe }: SeekDraft) =>
  [d.called, d.realName, d.story, d.birthday, d.years, d.place, custom, calledMe].some(value => !!value.trim())
  || d.faces.length > 0 || d.voice > 0 || tone !== 'gentle' || timbre !== 'warm' || relKey !== null
type SeekProps = {
  people: Person[]; nick: string; draftOwner?: string; large: boolean; initialStory?: string; onClose: () => void; onDone: (p: Person) => void
}

export function Seek(props: SeekProps) {
  const draftKey = JSON.stringify(props.draftOwner ? ['owner', props.draftOwner] : ['nick', props.nick])
  return <SeekFlow key={draftKey} {...props} draftKey={draftKey} />
}

function SeekFlow({ people, nick, large, initialStory = '', onClose, onDone, draftKey }: SeekProps & { draftKey: string }) {
  const { t, lang } = useI18n()
  const night = useContext(NightCtx)
  const [restored] = useState(() => {
    const saved = seekDrafts.get(draftKey)?.value
    return saved && hasSeekInput(saved) ? saved : undefined
  })
  const draftSession = useRef<object>({})
  const completed = useRef(false)
  const [d, setD] = useState<Draft>(() => restored?.d ?? { ...EMPTY, faces: [], story: initialStory })
  const [sheet, setSheet] = useState<NodeKey | 'ai' | 'refine' | null>(null)
  const [phase, setPhase] = useState<Phase>('console')
  const [sub, setSub] = useState(0)
  const showScene = phase !== 'console' && !(phase === 'search' && sub <= 2)
  useStatusTone(night ? 'light' : 'dark')
  const [world, setWorld] = useState<WorldId>(restored?.world ?? 'courtyard')
  const [keywords, setKeywords] = useState<string[]>([])
  const [exclude, setExclude] = useState<WorldId[]>(restored?.exclude ?? [])
  const [tone, setTone] = useState<Tone>(restored?.tone ?? 'gentle')
  const [timbre, setTimbre] = useState<'warm' | 'bright' | 'deep'>(restored?.timbre ?? 'warm')
  const [mainFace, setMainFace] = useState(restored?.mainFace ?? 0)
  const [line, setLine] = useState('')
  const [typed, setTyped] = useState(0)
  const [focusKey, setFocusKey] = useState(0)
  const [relKey, setRelKey] = useState<RelKey | null>(restored?.relKey ?? null)
  const [custom, setCustom] = useState(restored?.custom ?? '')
  const [calledMe, setCalledMe] = useState(restored?.calledMe ?? '')
  const [pulse, setPulse] = useState<NodeKey[]>([])
  const [launch, setLaunch] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null)
  const [thread, setThread] = useState<{ x: number; y: number } | null>(null)
  const [sampleIdx, setSampleIdx] = useState(restored?.sampleIdx ?? 0)
  const [needHint, setNeedHint] = useState(false)
  const [pendingSample, setPendingSample] = useState<SeekSample | null>(null)
  const [pendingClue, setPendingClue] = useState(() => {
    const clue = initialStory.trim()
    return restored && clue && restored.d.story.trim() !== clue ? clue : null
  })
  const sampleButton = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    if (completed.current) return
    const value: SeekDraft = { d, tone, timbre, mainFace, relKey, custom, calledMe, world, exclude, sampleIdx }
    if (hasSeekInput(value)) seekDrafts.set(draftKey, { session: draftSession.current, value })
    else seekDrafts.delete(draftKey)
  }, [draftKey, d, tone, timbre, mainFace, relKey, custom, calledMe, world, exclude, sampleIdx])

  const timers = useRef<number[]>([])
  const after = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)) }
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = [] }
  useEffect(() => () => { clearTimers(); window.speechSynthesis?.cancel() }, [])

  const rootRef = useRef<HTMLDivElement>(null)
  const orbitRef = useRef<HTMLDivElement>(null)
  const beginRef = useRef<HTMLButtonElement>(null)
  const lensRef = useRef<HTMLSpanElement>(null)
  const sheetBefore = useRef<Record<NodeKey, boolean> | null>(null)

  const continueDraft = () => {
    setPendingClue(null)
    requestAnimationFrame(() => beginRef.current?.focus({ preventScroll: true }))
  }
  const restartFromClue = () => {
    if (!pendingClue) return
    clearTimers()
    setD({ ...EMPTY, faces: [], story: pendingClue })
    setTone('gentle'); setTimbre('warm'); setMainFace(0)
    setRelKey(null); setCustom(''); setCalledMe('')
    setWorld('courtyard'); setExclude([]); setSampleIdx(0)
    setPhase('console'); setSub(0); setKeywords([]); setLine(''); setTyped(0); setFocusKey(0)
    setPulse([]); setLaunch(null); setThread(null); setNeedHint(false)
    setSheet(null); sheetBefore.current = null; setPendingSample(null); setPendingClue(null)
    requestAnimationFrame(() => beginRef.current?.focus({ preventScroll: true }))
  }

  const filled: Record<NodeKey, boolean> = {
    name: !!d.called.trim(), face: d.faces.length > 0, voice: d.voice > 0, story: !!d.story.trim(),
    time: !!(d.birthday.trim() || d.years.trim()), place: !!d.place.trim(),
  }
  const lit = ORDER.map((k) => filled[k])
  const filledCount = lit.filter(Boolean).length
  const canBegin = filled.name && (filled.face || filled.story)
  const withPeople = useMemo(() => people.filter((p) => p.world === world), [people, world])
  const liveKeys = useMemo(() => resonate(`${d.story}\n${d.place}`).keywords.slice(0, 3), [d.story, d.place])
  const face = d.faces[mainFace] ?? d.faces[0]
  const worldName = t(`world.${world}`)

  /* ------------------------------ 坐标填写 ------------------------------ */
  const openSheet = (k: NodeKey) => { sheetBefore.current = { ...filled }; setSheet(k) }
  const closeSheet = () => {
    const before = sheetBefore.current; sheetBefore.current = null
    setSheet(null)
    if (!before) return
    const fresh = ORDER.filter((k) => !before[k] && filled[k])
    if (fresh.length) { setPulse(fresh); haptic(10); chime('tick'); after(1300, () => setPulse([])) }
  }
  const fillSample = (s: SeekSample) => {
    setPendingSample(null)
    setSampleIdx((i) => i + 1)
    setD({ called: s.called, realName: s.realName, faces: s.faces, faceAge: s.faceAge, voice: s.voice, story: s.story, birthday: s.birthday, years: s.years, place: s.place })
    setTone(s.tone); setRelKey(s.rel); setMainFace(0); setExclude([]); setCalledMe(''); setCustom(''); setTimbre('warm')
    setWorld('courtyard'); setKeywords([]); setLine('')
    setPulse(ORDER.filter((k) => k !== 'voice' || s.voice > 0)); haptic([8, 40, 8]); after(1500, () => setPulse([]))
    requestAnimationFrame(() => sampleButton.current?.focus({ preventScroll: true }))
  }
  const requestSample = () => {
    // 跳过已经找到的人：外婆 → 阿远 → 外公（与外婆同在）→ 爸爸
    const all = seekSamples(lang); const known = new Set(people.map((p) => p.name))
    const list = all.filter((x) => !known.has(x.called)).length ? all.filter((x) => !known.has(x.called)) : all
    const s = list[sampleIdx % list.length]
    if (hasSeekInput({ d, tone, timbre, mainFace, relKey, custom, calledMe, world, exclude, sampleIdx })) setPendingSample(s)
    else fillSample(s)
  }
  const cancelSample = () => {
    setPendingSample(null)
    requestAnimationFrame(() => sampleButton.current?.focus({ preventScroll: true }))
  }

  /* ------------------------------ 共鸣计算 ------------------------------ */
  const computeResonance = (ex: WorldId[]) => {
    const text = `${d.story}\n${d.place}`
    const bias: Partial<Record<WorldId, number>> = {}
    const mine = relKeyOf(d.called)
    for (const p of people) {
      let b = 0
      if ((p.name && text.includes(p.name)) || (p.realName && text.includes(p.realName))) b += 3
      const theirs = relKeyOf(p.relation) ?? relKeyOf(p.name)
      if (mine && theirs && REL_PAIRS.some(([a, c]) => (a === mine && c === theirs) || (c === mine && a === theirs))) b += 2
      if (b) bias[p.world] = (bias[p.world] ?? 0) + b
    }
    return resonate(text, bias, ex)
  }
  const applyResonance = (r: { world: WorldId; keywords: string[] }, keepWorld?: boolean) => {
    if (!keepWorld) setWorld(r.world)
    const kws = r.keywords.length ? r.keywords : ORDER.filter((k) => k !== 'name' && filled[k]).map((k) => t(`seek.node.${k}`))
    setKeywords(kws)
    setLine(firstLine(lang, { keywords: r.keywords, catchphrase: parseStory(d.story).catchphrase, tone }))
  }

  /* ------------------------------ 穿越时间线 ------------------------------ */
  const runSearch = (from: 0 | 2) => {
    clearTimers()
    setPhase('search'); setTyped(0)
    if (fxPrefs.calm) { setSub(3); after(450, () => setSub(4)); after(1000, () => setPhase('reveal')); return }
    if (from === 0) {
      setSub(0)
      after(1200, () => setSub(1))
      after(2600, () => { setSub(2); chime('rise') })
      after(5200, () => { setSub(3); haptic([12, 90, 12]); chime('arrive') })
      after(6600, () => setSub(4))
      after(7400, () => setPhase('reveal'))
    } else {
      setSub(2); chime('rise')
      after(2600, () => { setSub(3); haptic([12, 90, 12]); chime('arrive') })
      after(4000, () => setSub(4))
      after(4800, () => setPhase('reveal'))
    }
  }
  const begin = () => {
    if (!canBegin) { setNeedHint(true); haptic(24); after(1200, () => setNeedHint(false)); return }
    applyResonance(computeResonance(exclude))
    if (!relKey) { const rk = relKeyOf(d.called); if (rk) setRelKey(rk) }
    haptic(10)
    const root = rootRef.current?.getBoundingClientRect(); const b = beginRef.current?.getBoundingClientRect(); const o = orbitRef.current?.getBoundingClientRect()
    if (root && b && o && !fxPrefs.calm) {
      const x = b.left - root.left + b.width / 2; const y = b.top - root.top + b.height / 2
      setLaunch({ x, y, dx: o.left - root.left + o.width / 2 - x, dy: o.top - root.top + o.height / 2 - y })
      after(860, () => { setLaunch(null); runSearch(0) })
    } else runSearch(0)
  }
  const skip = () => { clearTimers(); setSub(4); setPhase('reveal') }

  /* 相认后逐字浮现第一句话 */
  useEffect(() => {
    if (phase !== 'reveal') return
    setTyped(0)
    let i = 0; let id = 0
    const start = window.setTimeout(() => {
      id = window.setInterval(() => { i++; setTyped(i); if (i >= line.length) clearInterval(id) }, 60)
    }, fxPrefs.calm ? 0 : 420)
    return () => { clearTimeout(start); clearInterval(id) }
  }, [phase, line, focusKey])

  const refocus = () => {
    setSheet(null)
    applyResonance(computeResonance(exclude), true)
    setFocusKey((k) => k + 1); haptic(8)
  }
  const searchElsewhere = () => {
    setSheet(null)
    const ex = [...new Set([...exclude, world])]
    const next = ex.length >= WORLD_IDS.length ? [world] : ex
    setExclude(next)
    applyResonance(computeResonance(next))
    runSearch(2)
  }
  const speakLine = () => {
    try {
      const u = new SpeechSynthesisUtterance(line); u.lang = speechLang(lang)
      u.rate = 0.92; u.pitch = timbre === 'bright' ? 1.15 : timbre === 'deep' ? 0.8 : 1
      window.speechSynthesis?.cancel(); window.speechSynthesis?.speak(u)
    } catch { /* 原型环境可能不支持 */ }
  }
  const like = () => {
    setPhase('bond'); haptic(8)
    if (!calledMe) setCalledMe(calledDefault(lang, relKey ?? relKeyOf(d.called), nick))
  }

  /* ------------------------------ 建立连接 ------------------------------ */
  const finish = (): Person => {
    const parsed = parseStory(d.story)
    const rk = relKey ?? 'custom'
    const relation = rk === 'custom' ? (custom.trim() || d.called.trim()) : t(`rel.${rk}`)
    const age: Age = rk === 'custom' ? (d.faceAge ?? 'adult') : AGE_OF_REL[rk]
    return {
      id: nid(), name: d.called.trim(), realName: d.realName.trim() || undefined, relation, calledMe: calledMe.trim() || undefined,
      age, avatar: face ?? '', photos: d.faces, accent: 'sun', hasVoice: d.voice > 0,
      greeting: line, personality: [t(`tone.${tone}`), ...archetype(lang, age).personality], catchphrase: parsed.catchphrase,
      life: parsed.life, memories: parsed.memories.map((m) => ({ ...m, id: nid() })), unknowns: [], stories: [], lastLine: line,
      weather: worldWeather(lang, world), birthday: d.birthday.trim() || undefined, years: d.years.trim() || undefined,
      place: d.place.trim() || undefined, letters: [], world, keywords, foundAt: Date.now(),
    }
  }
  const connect = () => {
    const person = finish()
    const done = () => {
      completed.current = true
      if (seekDrafts.get(draftKey)?.session === draftSession.current) seekDrafts.delete(draftKey)
      onDone(person)
    }
    setPhase('connect'); haptic([10, 40, 20]); chime('connect')
    const el = lensRef.current; const root = rootRef.current
    if (el && root && !fxPrefs.calm) {
      const r = el.getBoundingClientRect(); const R0 = root.getBoundingClientRect()
      const fx = r.left - R0.left + r.width / 2; const fy = r.top - R0.top + r.height / 2
      const z = large ? 1.14 : 1
      const ps = r.width / 148                       // 父层缩放（确认关系时透镜被缩小）
      const dx = (HEADER_AVATAR.x * z - fx) / ps; const dy = (HEADER_AVATAR.y * z - fy) / ps
      const s = (HEADER_AVATAR.size * z) / r.width
      setThread({ x: fx, y: fy })
      el.animate([
        { transform: 'translate(0px, 0px) scale(1)' },
        { transform: `translate(0px, ${24 / ps}px) scale(0.92)`, offset: 0.28 },
        { transform: `translate(${dx}px, ${dy}px) scale(${s})` },
      ], { duration: 1000, delay: 380, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'forwards' })
      after(1500, done)
    } else after(450, done)
  }

  /* =============================== 渲染 =============================== */
  const showOrbit = phase === 'console' || (phase === 'search' && sub <= 1)

  return (
    <div ref={rootRef} className="seek-root absolute inset-0 overflow-hidden text-ink select-none" data-tone={night ? 'night' : 'day'} data-phase={phase} data-step={phase === 'search' ? sub : undefined}>
      {showOrbit && night && <DeepField />}
      {showOrbit && <Veil tone={night ? 'deep' : 'light'} className="inset-x-0 top-[18%] h-[60%]" style={{ maskImage: 'linear-gradient(to bottom, transparent, #000 25%, #000 75%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, transparent, #000 25%, #000 75%, transparent)', opacity: night ? (phase === 'console' ? 0.75 : 0.4) : 0.28, transition: 'opacity 1s' }} />}

      {/* ------------------------- 第一幕：坐标台 ------------------------- */}
      {showOrbit && (
        <div className={`seek-console absolute inset-0 flex flex-col transition-opacity duration-500 ${phase === 'search' ? 'pointer-events-none' : ''}`}>
          <div className={`pt-[calc(var(--app-status-height)+8px)] px-5 flex items-center justify-between transition-opacity duration-500 ${phase === 'search' ? 'opacity-0' : ''}`}>
            <button onClick={onClose} aria-label={t('common.close')} className="seek-console-control h-10 w-10 flex items-center justify-center rounded-full active:scale-95 transition-transform"><I.X className="h-5 w-5" /></button>
            <button ref={sampleButton} onClick={requestSample} className="seek-console-control h-9 rounded-full px-4 text-[13px] active:scale-95 transition-transform">{t('seek.sample')}</button>
          </div>
          <div className={`mt-3 text-center transition-all duration-500 ${phase === 'search' ? 'opacity-0 -translate-y-3' : 'rise-in'}`}>
            <h1 className="font-serif text-[30px] tracking-[0.22em] pl-[0.22em]">{t('seek.title')}</h1>
            <p className="seek-console-muted mt-1 text-[12.5px] tracking-[0.34em] pl-[0.34em]">{t('seek.sub')}</p>
          </div>

          <div className="seek-console-center flex-1 min-h-0 flex items-center justify-center">
            {large && phase === 'console' ? (
              <div className="w-full px-6 space-y-2.5 overflow-y-auto scroll-quiet max-h-full py-2">
                {ORDER.map((k) => {
                  const n = NODES.find((x) => x.key === k)!
                  return (
                    <button key={k} onClick={() => openSheet(k)} data-filled={filled[k]} className="seek-console-control w-full flex items-center gap-3.5 rounded-2xl px-4 py-4 text-left">
                      <n.icon className="h-6 w-6" />
                      <span className="flex-1 text-[18px]">{t(`seek.node.${k}`)}</span>
                      {filled[k] ? <I.Check className="h-5 w-5" /> : <I.Chevron className="seek-console-muted h-5 w-5" />}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div ref={orbitRef} className="seek-orbit relative shrink-0" style={{ width: BOX, height: BOX }}>
                {/* 光丝：坐标 → 信标 */}
                <svg className="absolute inset-0" width={BOX} height={BOX} viewBox={`0 0 ${BOX} ${BOX}`} aria-hidden>
                  <defs>
                    <linearGradient id="seek-thread" x1="0" x2="1"><stop offset="0" stopColor="var(--seek-orbit-accent)" stopOpacity="0.9" /><stop offset="1" stopColor="var(--seek-signal-gold)" stopOpacity="0.5" /></linearGradient>
                  </defs>
                  {NODES.map((n) => {
                    const p = nodePos(n.a)
                    return filled[n.key]
                      ? <line key={`${n.key}-${pulse.includes(n.key)}`} x1={p.x} y1={p.y} x2={C} y2={C} stroke="url(#seek-thread)" strokeWidth="1" pathLength={1} strokeDasharray="1" style={{ strokeDashoffset: pulse.includes(n.key) ? 1 : 0, animation: pulse.includes(n.key) ? 'draw 0.6s cubic-bezier(0.16,1,0.3,1) 0.25s forwards' : undefined, opacity: phase === 'search' && sub === 1 ? 0.25 : 1, transition: 'opacity .5s' }} />
                      : <line key={n.key} x1={p.x} y1={p.y} x2={C} y2={C} stroke="var(--seek-orbit-track)" strokeWidth="1" strokeDasharray="2 5" />
                  })}
                </svg>

                {/* 中心信标 */}
                <div className="seek-console-beacon absolute" style={{ left: C - 66, top: C - 66 }}>
                  <Beacon size={132} clarity={filledCount / 6} contract={phase === 'search'}>
                    {face && <img src={face} alt="" className="seek-beacon-face h-full w-full object-cover" style={{ filter: 'grayscale(1) sepia(0.35) hue-rotate(130deg) saturate(1.5) brightness(1.15) contrast(0.9)', opacity: 0.16 + (filledCount / 6) * 0.5, transition: 'opacity .8s' }} />}
                    {face && <span className="absolute inset-0" style={{ background: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.09) 0 1px, transparent 1px 3px)' }} />}
                  </Beacon>
                </div>
                {filled.voice && phase === 'console' && [0, 1].map((i) => (
                  <span key={i} className="seek-voice-ring absolute rounded-full border fx ring-out pointer-events-none" style={{ left: C - 46, top: C - 46, width: 92, height: 92, animationDelay: `${i * 1.2}s` }} />
                ))}
                {phase === 'console' && liveKeys.length > 0 && (
                  <div className="absolute inset-0 fx spin-slow pointer-events-none" style={{ animationDuration: '60s' }}>
                    {liveKeys.map((k, i) => {
                      const a = (-60 + i * 120) * (Math.PI / 180)
                      return <span key={k} className="seek-console-muted absolute -translate-x-1/2 -translate-y-1/2 font-serif text-[12.5px] whitespace-nowrap animate-fade-slow" style={{ left: C + Math.cos(a) * 86, top: C + Math.sin(a) * 86 }}>{k}</span>
                    })}
                  </div>
                )}

                {/* 汇聚：坐标里的内容沿光丝流入信标 */}
                {phase === 'search' && sub === 0 && NODES.filter((n) => filled[n.key]).map((n, ni) => {
                  const p = nodePos(n.a)
                  return [0, 1, 2, 3, 4].map((j) => (
                    <span key={`${n.key}${j}`} className="seek-journey-spark absolute h-1.5 w-1.5 rounded-full flow-in" style={{ left: p.x - 3, top: p.y - 3, ['--dx' as string]: `${C - p.x}px`, ['--dy' as string]: `${C - p.y}px`, animationDelay: `${ni * 0.08 + j * 0.11}s` } as React.CSSProperties} />
                  ))
                })}

                {/* 定位：关键词浮现并锁定 */}
                {phase === 'search' && sub === 1 && (
                  <>
                    <ArcRing size={170} lit={6} seq step={190} track="var(--seek-orbit-track)" className="seek-journey-ring absolute" style={{ left: C - 85, top: C - 85 }} />
                    {keywords.map((k, i) => {
                      const a = (-90 + (i * 360) / keywords.length + 20) * (Math.PI / 180)
                      return (
                        <span key={k} className="seek-coordinate-key absolute key-lock px-2.5 py-1 font-serif text-[16px] whitespace-nowrap" style={{ left: C + Math.cos(a) * 128, top: C + Math.sin(a) * 118, animationDelay: `${0.15 + i * 0.26}s` }}>
                          <span className="absolute left-0 top-0 h-2 w-2 border-l border-t" />
                          <span className="absolute right-0 bottom-0 h-2 w-2 border-r border-b" />
                          {k}
                        </span>
                      )
                    })}
                    <span className="seek-console-muted absolute left-1/2 -translate-x-1/2 font-mono text-[10.5px] tracking-[0.22em] whitespace-nowrap animate-fade" style={{ top: C + 104 }}>{t('seek.coords', { n: filledCount })}</span>
                  </>
                )}

                {/* 六个坐标 */}
                {NODES.map((n) => {
                  const p = nodePos(n.a); const on = filled[n.key]; const fresh = pulse.includes(n.key)
                  return (
                    <button key={n.key} onClick={() => phase === 'console' && openSheet(n.key)} aria-label={t(`seek.node.${n.key}`)}
                      data-filled={on} className={`seek-orbit-node absolute flex flex-col items-center transition-opacity duration-500 ${phase === 'search' ? (sub === 0 ? 'opacity-70' : 'opacity-0') : ''}`}
                      style={{ left: p.x - 29, top: p.y - 29, width: 58 }}>
                      <span data-filled={on} className={`seek-console-control relative h-[58px] w-[58px] rounded-full flex items-center justify-center transition-all duration-500 ${fresh ? 'pop-in' : ''}`}>
                        <n.icon className="h-[22px] w-[22px]" />
                        {fresh && (
                          <svg className="absolute -inset-1.5" viewBox="0 0 70 70" aria-hidden><circle cx="35" cy="35" r="33" fill="none" stroke="var(--seek-orbit-accent)" strokeWidth="1.2" pathLength={1} strokeDasharray="1" style={{ strokeDashoffset: 1, animation: 'draw 0.5s cubic-bezier(0.16,1,0.3,1) forwards', transform: 'rotate(-90deg)', transformOrigin: 'center' }} /></svg>
                        )}
                        {on && <span className="seek-orbit-dot absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full" />}
                      </span>
                      <span className="mt-1.5 text-[12px] tracking-[0.1em]">{t(`seek.node.${n.key}`)}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className={`px-7 pb-9 transition-opacity duration-500 ${phase === 'search' ? 'opacity-0' : ''}`}>
            <p className="seek-console-muted text-center text-[12.5px]">
              {t('seek.ai')} · <button onClick={() => setSheet('ai')} className="seek-console-link underline underline-offset-2">{t('common.learn')}</button>
            </p>
            <button ref={beginRef} onClick={begin} data-ready={canBegin} className="seek-console-start mt-4 w-full h-14 rounded-full text-[17px] font-semibold tracking-[0.08em] transition-[background-color,color,box-shadow,transform] active:scale-[0.98]">{t('seek.begin')}</button>
            <p className={`seek-console-muted mt-2.5 h-4 text-center text-[12.5px] ${needHint ? 'glow-hint' : ''}`}>{canBegin ? '' : t('seek.need')}</p>
          </div>
        </div>
      )}

      {/* 开始寻找：按钮收缩成光点，飞入信标 */}
      {launch && (
        <span className="seek-journey-spark absolute h-3 w-3 rounded-full dot-fly z-20" style={{ left: launch.x - 6, top: launch.y - 6, ['--dx' as string]: `${launch.dx}px`, ['--dy' as string]: `${launch.dy}px` } as React.CSSProperties} />
      )}

      {/* ------------------------- 第二幕：穿越 ------------------------- */}
      {phase === 'search' && sub === 2 && <Tunnel world={world} t={t} night={night} />}

      {/* ---------------------- 抵达 · 相认 · 连接 ---------------------- */}
      {showScene && (
        <div className={`seek-scene absolute inset-0 wb-${world}`}>
          <div className="seek-scene-picture absolute inset-x-0 focus-in" style={{ animationDuration: '1.1s' }}>
            <WorldScene world={world} key={world} className="seek-scene-world" />
            <div className="seek-scene-scrim absolute inset-0" />
          </div>
          {phase === 'search' && sub >= 3 && !fxPrefs.calm && <Dust cx={196} cy={252} r={78} className="seek-arrival-dust" />}
          {phase === 'connect' && <div className="seek-scene-cover absolute inset-0 z-[5]" aria-hidden />}

          {/* 同在此世界的人 */}
          {withPeople.slice(0, 2).map((p, i) => (
            <div key={p.id} className={`absolute flex flex-col items-center transition-opacity duration-500 ${phase === 'connect' ? 'opacity-0' : 'animate-fade-slow'}`} style={{ top: 168 + i * 26, [i === 0 ? 'left' : 'right']: 22, animationDelay: '0.4s' }}>
              <Lens world={p.world} avatar={p.avatar} name={p.name} size={40} dark={night} glow />
              <span className="seek-scene-tag mt-1.5 rounded-full px-2 py-0.5 text-[11.5px]">{p.name}</span>
            </div>
          ))}

          <div className={`absolute inset-0 z-10 flex flex-col items-center ${phase === 'reveal' ? 'overflow-y-auto scroll-quiet' : ''}`}>
            <div className={`pt-[62px] text-center transition-opacity duration-500 ${phase === 'search' && sub < 4 ? 'opacity-0' : phase === 'connect' ? 'opacity-0' : 'opacity-100'}`}>
              <div className="font-mono text-[10.5px] tracking-[0.24em]">{t('seek.resonance', { world: worldName })} · {WORLDS[world].code}</div>
              {withPeople.length > 0 && <div className="mt-1.5 font-serif text-[15px]">{t('seek.with', { names: withPeople.map((p) => p.name).join('、') })}</div>}
            </div>

            <div className="relative mt-5 h-[176px] w-[176px] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]" style={{ transform: phase === 'bond' || phase === 'connect' ? 'translateY(-20px) scale(0.74)' : undefined }}>
              {(phase !== 'search' || sub >= 4) && (
                <div key={focusKey} className="absolute inset-0">
                  <ArcRing size={176} lit={lit} seq={phase === 'search' || focusKey > 0} step={110} track="var(--seek-orbit-track)" className={`seek-journey-ring absolute inset-0 transition-opacity duration-300 ${phase === 'connect' ? 'opacity-0' : ''}`} />
                  {face && <img src={face} alt="" aria-hidden className="absolute left-[14px] top-[14px] h-[148px] w-[148px] rounded-full object-cover split-l mix-blend-screen" style={{ filter: 'sepia(1) hue-rotate(140deg) saturate(3)' }} />}
                  {face && <img src={face} alt="" aria-hidden className="absolute left-[14px] top-[14px] h-[148px] w-[148px] rounded-full object-cover split-r mix-blend-screen" style={{ filter: 'sepia(1) hue-rotate(-20deg) saturate(3)' }} />}
                  <span ref={lensRef} className="absolute left-[14px] top-[14px] focus-in" style={{ width: 148, height: 148 }}>
                    <Lens world={world} avatar={face} name={d.called} size={148} dark={night} glow={phase === 'reveal'} />
                  </span>
                </div>
              )}
            </div>

            <div className={`seek-result-identity w-full min-w-0 max-w-full px-6 flex flex-col items-center transition-all duration-500 ${(phase === 'search' && sub < 4) || phase === 'connect' ? 'opacity-0' : 'opacity-100'} ${phase === 'bond' ? '-translate-y-10' : ''}`}>
              <div className="mt-3 min-w-0 max-w-full flex flex-wrap items-center justify-center gap-x-2.5 gap-y-2">
                <h2 className={`min-w-0 max-w-full text-center text-balance [overflow-wrap:anywhere] font-serif ${Array.from(d.called).length > 6 ? `${large ? 'text-[32px]' : 'text-[clamp(26px,7vw,32px)]'} leading-[1.2] tracking-[0.04em] pl-[0.04em]` : 'text-[36px] leading-none tracking-[0.12em] pl-[0.12em]'}`}>{d.called}</h2>
                <span className="shrink-0 whitespace-nowrap"><AiBadge dark={night} label={t('common.ai')} /></span>
              </div>
              {(d.realName || d.years) && <div className="mt-2 min-w-0 max-w-full text-center [overflow-wrap:anywhere] text-[12.5px] tracking-[0.12em] text-ink-soft">{[d.realName, d.years].filter(Boolean).join(' · ')}</div>}
            </div>

            <div className={`w-full flex flex-col items-center transition-opacity duration-300 ${phase === 'reveal' ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
              <div className="mt-3 text-[13.5px] tracking-[0.18em] text-ink-soft">{keywords.join(' · ')}</div>
              <p className="mt-5 px-10 min-h-[58px] text-center font-serif italic text-[19px] leading-relaxed">
                “{line.slice(0, phase === 'reveal' ? typed : line.length)}{phase === 'reveal' && typed < line.length && <span className="caret ml-0.5 inline-block h-[1em] w-px bg-ink align-middle" />}”
              </p>
              {d.voice > 0 && (
                <button onClick={speakLine} className="seek-chip mt-2 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12.5px] active:scale-95 transition-transform">
                  <I.Play className="h-3 w-3 text-sky-deep" />{t('seek.listen')}<span className="text-ink-soft">· {t('seek.synth')}</span>
                </button>
              )}
            </div>

            <div className="flex-1" />

            {phase === 'reveal' && (
              <div className="seek-reveal-actions w-full shrink-0 px-7 pb-9 rise-in" style={{ animationDelay: '0.5s' }}>
                <button onClick={like} className="seek-journey-action w-full h-14 rounded-full text-[17px] font-semibold tracking-[0.1em] active:scale-[0.98] transition-transform">{t('seek.like')}</button>
                <button onClick={() => setSheet('refine')} className="mt-2 w-full py-2.5 text-[15px] text-ink">{t('seek.refine')}</button>
              </div>
            )}
          </div>

          {/* 第四幕：确认关系 */}
          {phase === 'bond' && (
            <div className="seek-bond absolute inset-x-0 bottom-0 z-20 rounded-t-[30px] bg-canvas px-6 pt-6 pb-9 animate-sheet">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="seek-bond-name min-w-0 [overflow-wrap:anywhere] font-serif text-[19px] leading-tight">{d.called}</span>
                <span className="text-[12.5px] tracking-[0.16em] text-ink-soft">{t('bond.relation')}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {relKeys(lang).map((k) => (
                  <button key={k} onClick={() => { setRelKey(k); setCalledMe(calledDefault(lang, k, nick)); haptic(6) }} aria-pressed={relKey === k}
                    className="seek-chip rounded-full px-3.5 py-2 text-[14.5px] transition-colors">{t(`rel.${k}`)}</button>
                ))}
              </div>
              {relKey === 'custom' && <input value={custom} onChange={(e) => setCustom(e.target.value.slice(0, 10))} placeholder={t('bond.custom.ph')} className={`mt-3 ${field}`} />}
              <label className="mt-5 block">
                <span className="text-[12.5px] tracking-[0.16em] text-ink-soft">{t('bond.called')}</span>
                <input value={calledMe} onChange={(e) => setCalledMe(e.target.value.slice(0, 12))} className={`mt-2.5 ${field}`} />
              </label>
              <button onClick={connect} disabled={!relKey} className="seek-journey-action mt-6 w-full h-14 rounded-full text-[17px] font-semibold tracking-[0.1em] active:scale-[0.98] transition-all">{t('bond.add')}</button>
            </div>
          )}

          {/* 连接：光丝自此岸（屏幕底部）牵引至透镜 */}
          {phase === 'connect' && thread && (
            <svg className="absolute inset-0 z-[6] h-full w-full pointer-events-none" aria-hidden>
              <defs><linearGradient id="connect-g" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="var(--seek-signal-gold)" stopOpacity="0" /><stop offset="0.4" stopColor="var(--seek-signal-gold)" /><stop offset="1" stopColor="var(--seek-action-fill)" /></linearGradient></defs>
              <line className="seek-connect-thread" x1={thread.x} y1="100%" x2={thread.x} y2={thread.y} stroke="url(#connect-g)" strokeWidth="1.5" pathLength={1} strokeDasharray="1" style={{ strokeDashoffset: 1, animation: 'draw 0.42s cubic-bezier(0.16,1,0.3,1) forwards, fade 0.5s ease 0.9s reverse forwards' }} />
            </svg>
          )}
          {phase === 'connect' && <div className="absolute inset-x-0 top-[120px] z-[7] text-center font-mono text-[11px] tracking-[0.3em] rise-in" style={{ animationDelay: '0.7s' }}><span className="seek-scene-tag inline-block rounded-full px-3 py-1.5">{t('seek.connected')}</span></div>}
        </div>
      )}

      {phase === 'search' && (
        <button onClick={skip} className="seek-scene-tag absolute right-5 top-[calc(var(--app-status-height)+10px)] z-30 rounded-full px-3.5 py-1.5 text-[12px]">{t('seek.skip')}</button>
      )}

      {/* ------------------------------ 面板 ------------------------------ */}
      {pendingClue && (
        <Sheet dark={night} onClose={continueDraft} title={lang.startsWith('zh') ? '继续哪一次寻找？' : 'Which search would you like to continue?'}
          footer={<div className="flex flex-col gap-2">
            <button onClick={continueDraft} className="min-h-11 w-full rounded-full px-4 py-3 text-[16px] text-ink">{lang.startsWith('zh') ? '继续上次填写' : 'Continue previous entries'}</button>
            <button onClick={restartFromClue} className="min-h-11 w-full rounded-full btn-dark px-4 py-3 text-[16px] font-semibold">{lang.startsWith('zh') ? '用这条线索重新寻找' : 'Start again with this clue'}</button>
          </div>}>
          <dl className="space-y-4 text-[15px] leading-relaxed text-ink">
            <div><dt className="text-ink-soft">{lang.startsWith('zh') ? '上次填写' : 'Previous entries'}</dt><dd className="mt-1 break-words">{restored?.d.called.trim() || (lang.startsWith('zh') ? '还未填写称呼' : 'No name entered yet')}</dd></div>
            <div><dt className="text-ink-soft">{lang.startsWith('zh') ? '这次的线索' : 'New clue'}</dt><dd className="mt-1 [overflow-wrap:anywhere]">{Array.from(pendingClue).slice(0, 120).join('')}{Array.from(pendingClue).length > 120 ? '…' : ''}</dd></div>
          </dl>
        </Sheet>
      )}
      {pendingSample && (
        <Sheet dark={night} onClose={cancelSample} title={lang.startsWith('zh') ? '用示例替换已填内容？' : 'Replace your entries with a sample?'}
          footer={<div className="flex gap-3">
            <button onClick={cancelSample} className="min-h-11 flex-1 rounded-full px-4 py-3 text-[16px] text-ink">{t('common.cancel')}</button>
            <button onClick={() => fillSample(pendingSample)} className="min-h-11 flex-1 rounded-full btn-dark px-4 py-3 text-[16px] font-semibold">{lang.startsWith('zh') ? '替换为示例' : 'Use sample'}</button>
          </div>}>
          <p className="text-[15px] leading-relaxed text-ink">{lang.startsWith('zh') ? `这会用「${pendingSample.called}」的示例替换本次填写的记忆和关系。` : `This replaces the memories and relationship you entered with the sample for ${pendingSample.called}.`}</p>
        </Sheet>
      )}
      {sheet === 'ai' && (
        <Sheet dark={night} onClose={() => setSheet(null)} title={t('ai.title')}>
          <p className="text-[15px] leading-relaxed text-ink">{t('ai.body')}</p>
        </Sheet>
      )}
      {sheet && sheet !== 'ai' && sheet !== 'refine' && (
        <Sheet dark={night} onClose={closeSheet} title={t(`seek.node.${sheet}`)}
          footer={<button onClick={closeSheet} className="w-full h-13 py-3.5 rounded-full btn-dark text-[16px] font-semibold active:scale-[0.98] transition-transform">{t('common.done')}</button>}>
          <NodeEditor k={sheet} d={d} setD={setD} mainFace={mainFace} setMainFace={setMainFace} />
        </Sheet>
      )}
      {sheet === 'refine' && (
        <Sheet dark={night} onClose={() => setSheet(null)} title={t('seek.refine')}
          footer={<button onClick={refocus} className="seek-journey-action w-full py-3.5 rounded-full text-[16px] font-semibold active:scale-[0.98] transition-transform">{t('refine.apply')}</button>}>
          <RefineBlock title={t('refine.face')}>
            <div className="flex gap-3 overflow-x-auto scroll-quiet pb-1">
              {d.faces.map((f, i) => (
                <button key={f + i} onClick={() => setMainFace(i)} data-selected={i === mainFace} className="seek-face-option h-16 w-16 shrink-0 rounded-full overflow-hidden transition-all"><img src={f} alt="" className="h-full w-full object-cover" /></button>
              ))}
              <button onClick={() => openSheet('face')} className="seek-panel-control h-16 w-16 shrink-0 rounded-full flex items-center justify-center"><I.Plus className="h-6 w-6" /></button>
            </div>
          </RefineBlock>
          <RefineBlock title={t('refine.voice')}>
            <div className="flex flex-wrap gap-2">
              {(['warm', 'bright', 'deep'] as const).map((k) => <Chip key={k} on={timbre === k} onClick={() => setTimbre(k)}>{t(`refine.timbre.${k}`)}</Chip>)}
              <Chip onClick={() => openSheet('voice')}>{t('refine.voice.more')}</Chip>
            </div>
          </RefineBlock>
          <RefineBlock title={t('refine.tone')}>
            <div className="flex flex-wrap gap-2">{TONES.map((k) => <Chip key={k} on={tone === k} onClick={() => setTone(k)}>{t(`tone.${k}`)}</Chip>)}</div>
          </RefineBlock>
          <RefineBlock title={t('refine.memory')}>
            <Chip onClick={() => openSheet('story')}>{t('refine.memory.more')}</Chip>
          </RefineBlock>
          <RefineBlock title={t('refine.world')}>
            <div className="flex items-center gap-3">
              <Lens world={world} size={40} dark={night} />
              <span className="flex-1 font-serif text-[18px] text-ink">{worldName}</span>
              <button onClick={searchElsewhere} className="seek-chip rounded-full px-4 py-2 text-[13.5px]">{t('refine.world.other')}</button>
            </div>
          </RefineBlock>
        </Sheet>
      )}
    </div>
  )
}

/* ------------------------- 穿越：诸世界迎面掠过 ------------------------- */
function Tunnel({ world, t, night }: { world: WorldId; t: (k: string, p?: Record<string, string | number>) => string; night: boolean }) {
  const decoys = WORLD_IDS.filter((w) => w !== world)
  const streaks = useMemo(() => Array.from({ length: 30 }, (_, i) => ({ a: i * 12 + ((i * 7) % 5), d: ((i * 37) % 10) / 10 * 0.85, h: 50 + ((i * 13) % 50) })), [])
  return (
    <div className="seek-tunnel absolute inset-0 overflow-hidden">
      <DeepField variant="warp" dim={0.35} className="seek-tunnel-space" />
      {[0, 1, 2].map((i) => <span key={i} className="seek-tunnel-wave absolute left-1/2 top-1/2 -ml-24 -mt-24 h-48 w-48 rounded-full border fx ring-out" style={{ animationDelay: `${i * 0.45}s`, animationDuration: '1.6s' }} />)}
      {streaks.map((s, i) => (
        <span key={i} className="seek-tunnel-trail absolute left-1/2 top-1/2 w-px fx warp" style={{ height: s.h, marginTop: -s.h / 2, ['--a' as string]: `${s.a}deg`, animationDelay: `${s.d}s` } as React.CSSProperties} />
      ))}
      <div className="absolute inset-0" style={{ transformStyle: 'preserve-3d' }}>
        <div className="seek-tunnel-frame absolute left-1/2 top-1/2 h-[290px] w-[210px] rounded-[28px] overflow-hidden plane-fly" style={{ animationDelay: '0s' }}>
          <Veil tone={night ? 'deep' : 'light'} className="inset-0" />
          <span className="seek-tunnel-caption absolute inset-x-0 bottom-0 px-3 py-2 text-center font-mono text-[10px] tracking-[0.3em]">{t('atlas.unknown')}</span>
        </div>
        {decoys.map((w, i) => (
          <div key={w} className="seek-tunnel-frame absolute left-1/2 top-1/2 h-[290px] w-[210px] rounded-[28px] overflow-hidden plane-fly" style={{ animationDelay: `${0.42 + i * 0.42}s` }}>
            <img src={WORLDS[w].img} alt="" className="seek-tunnel-image absolute inset-0 h-full w-full object-cover" />
            <span className="seek-tunnel-caption absolute inset-x-0 bottom-0 px-3 py-2 text-center font-mono text-[10px] tracking-[0.3em]">{WORLDS[w].code} · {t(`world.${w}`)}</span>
          </div>
        ))}
        <div className="seek-tunnel-frame absolute left-1/2 top-1/2 h-[290px] w-[210px] rounded-[28px] overflow-hidden plane-arrive" style={{ animationDelay: '1.2s' }}>
          <img src={WORLDS[world].img} alt="" className="seek-tunnel-image absolute inset-0 h-full w-full object-cover" />
        </div>
      </div>
      <div className="absolute inset-x-10 bottom-[110px]">
        <div className="flex items-center justify-between font-mono text-[10px] tracking-[0.28em]"><span>{t('seek.crossing')}</span><span>ELY·01 — ELY·03</span></div>
        <div className="seek-tunnel-progress mt-2 h-px overflow-hidden"><span className="block h-full origin-left" style={{ animation: 'bootLine 2.6s linear both' }} /></div>
      </div>
    </div>
  )
}

/* ----------------------------- 坐标编辑器 ----------------------------- */
const field = 'seek-field w-full rounded-2xl px-4 py-3.5 text-[16.5px] outline-none transition-shadow'
function NodeEditor({ k, d, setD, mainFace, setMainFace }: { k: NodeKey; d: Draft; setD: React.Dispatch<React.SetStateAction<Draft>>; mainFace: number; setMainFace: (i: number) => void }) {
  const { t, lang } = useI18n()
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }))
  const [rec, setRec] = useState(0)
  const [recording, setRecording] = useState(false)
  const [listening, setListening] = useState(false)
  const recT = useRef<number>(0)
  const recog = useRef<{ stop?: () => void } | null>(null)
  useEffect(() => () => { clearInterval(recT.current); try { recog.current?.stop?.() } catch { /* noop */ } }, [])

  if (k === 'name') return (
    <div className="space-y-4">
      <label className="block"><span className="text-[12.5px] tracking-[0.12em] text-ink-soft">{t('seek.name.called')}</span>
        <input autoFocus value={d.called} onChange={(e) => set({ called: e.target.value.slice(0, 10) })} placeholder={t('seek.name.called.ph')} className={`mt-2 ${field}`} /></label>
      <label className="block"><span className="text-[12.5px] tracking-[0.12em] text-ink-soft">{t('seek.name.real')}</span>
        <input value={d.realName} onChange={(e) => set({ realName: e.target.value.slice(0, 20) })} placeholder={t('seek.name.real.ph')} className={`mt-2 ${field}`} /></label>
    </div>
  )

  if (k === 'face') {
    const toggle = (src: string, age?: Age) => setD((x) => {
      const has = x.faces.includes(src)
      const faces = has ? x.faces.filter((f) => f !== src) : [...x.faces, src].slice(0, 6)
      return { ...x, faces, faceAge: !has && x.faces.length === 0 ? age : x.faceAge }
    })
    const upload = async (files: FileList | null) => {
      if (!files) return
      const urls: string[] = []
      for (const f of Array.from(files).slice(0, 6)) { try { urls.push(await fileToDataUrl(f)) } catch { /* 跳过无法读取的文件 */ } }
      setD((x) => ({ ...x, faces: [...x.faces, ...urls].slice(0, 6) }))
    }
    return (
      <div>
        <p className="text-[13px] text-ink-soft">{t('seek.face.sub')}</p>
        <div className="mt-4 grid grid-cols-4 gap-3">
          <label className="seek-panel-control aspect-square rounded-2xl flex flex-col items-center justify-center gap-1 cursor-pointer active:scale-95 transition-transform">
            <I.Photo className="h-6 w-6" /><span className="text-[10.5px]">{t('seek.face.album')}</span>
            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
          </label>
          {d.faces.filter((f) => !FACE_ALBUM.some((a) => a.src === f)).map((f) => (
            <button key={f.slice(-24)} onClick={() => toggle(f)} data-selected="true" className="seek-face-option relative aspect-square rounded-2xl overflow-hidden"><img src={f} alt="" className="h-full w-full object-cover" /></button>
          ))}
          {FACE_ALBUM.map((a) => {
            const idx = d.faces.indexOf(a.src)
            return (
              <button key={a.src} onClick={() => toggle(a.src, a.age)} data-selected={idx >= 0} className={`seek-face-option relative aspect-square rounded-2xl overflow-hidden transition-opacity ${idx < 0 ? 'opacity-80' : ''}`}>
                <img src={a.src} alt="" className="h-full w-full object-cover" />
                {idx >= 0 && <span className="seek-face-number absolute right-1 top-1 h-5 min-w-5 px-1 rounded-full text-[11px] font-semibold flex items-center justify-center">{idx + 1}</span>}
              </button>
            )
          })}
        </div>
        {d.faces.length > 1 && (
          <div className="mt-5">
            <div className="text-[12.5px] tracking-[0.12em] text-ink-soft">{t('seek.face.main')}</div>
            <div className="mt-2 flex gap-2.5">{d.faces.map((f, i) => <button key={f.slice(-24) + i} onClick={() => setMainFace(i)} data-selected={i === mainFace} className="seek-face-option h-12 w-12 rounded-full overflow-hidden"><img src={f} alt="" className="h-full w-full object-cover" /></button>)}</div>
          </div>
        )}
        <p className="mt-4 text-[11.5px] text-ink-soft">{t('seek.face.samples')}</p>
      </div>
    )
  }

  if (k === 'voice') {
    const start = () => { setRec(0); setRecording(true); clearInterval(recT.current); recT.current = window.setInterval(() => setRec((s) => s + 1), 1000); haptic(8) }
    const stop = () => {
      if (!recording) return
      clearInterval(recT.current); setRecording(false)
      set({ voice: Math.max(2, rec) }); setRec(0); haptic(8)
    }
    return (
      <div>
        <p className="text-[13px] text-ink-soft">{t('seek.voice.sub')}</p>
        {d.voice > 0 ? (
          <div data-filled="true" className="seek-panel-control mt-5 flex items-center gap-3 rounded-2xl px-4 py-3.5">
            <span className="flex items-center gap-[3px] h-6">{[0, 1, 2, 3, 4, 5].map((b) => <span key={b} className="w-[3px] h-full rounded-full bg-current fx" style={{ transformOrigin: 'center', animation: `bar ${0.8 + b * 0.1}s ease-in-out infinite ${b * 0.07}s` }} />)}</span>
            <span className="flex-1 text-[15px]">{t('seek.voice.saved', { s: d.voice })}</span>
            <button onClick={() => set({ voice: 0 })} className="text-[13px] text-ink">{t('seek.voice.remove')}</button>
          </div>
        ) : (
          <div className="mt-6 flex flex-col items-center">
            <button onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} data-filled={recording} className={`seek-panel-control relative h-24 w-24 rounded-full flex items-center justify-center transition-all touch-none ${recording ? 'scale-105' : ''}`}>
              {recording && [0, 1].map((i) => <span key={i} className="absolute inset-0 rounded-full border border-sun/60 fx ring-out" style={{ animationDelay: `${i * 0.8}s` }} />)}
              <I.Mic className="h-8 w-8" />
            </button>
            <span className="mt-3 text-[13.5px] text-ink-soft">{recording ? `${t('seek.voice.recording')} · ${rec}″` : t('seek.voice.rec')}</span>
            <button onClick={() => set({ voice: 6 })} className="seek-chip mt-4 rounded-full px-4 py-2 text-[13.5px]">{t('seek.voice.import')}</button>
          </div>
        )}
        <p className="mt-5 text-[12px] text-ink-soft">{t('seek.voice.note')}</p>
      </div>
    )
  }

  if (k === 'story') {
    const prompts = ['p1', 'p2', 'p3', 'p4'].map((p) => t(`seek.story.${p}`))
    const insert = (label: string) => setD((x) => ({ ...x, story: `${x.story}${x.story && !x.story.endsWith('\n') ? '\n' : ''}${label}：` }))
    const dictate = () => {
      const W = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec }
      const SR = W.SpeechRecognition || W.webkitSpeechRecognition
      if (listening) { try { recog.current?.stop?.() } catch { /* noop */ } setListening(false); return }
      if (!SR) {
        setListening(true)
        const sample = lang.startsWith('zh') ? '她总在傍晚给院子里的花浇水。' : 'She watered the garden every evening.'
        let i = 0; const base = d.story ? `${d.story}\n` : ''
        const tick = () => { i++; set({ story: base + sample.slice(0, i) }); if (i < sample.length) window.setTimeout(tick, 45); else setListening(false) }
        window.setTimeout(tick, 300); return
      }
      const r = new SR(); r.lang = speechLang(lang); r.interimResults = true
      const base = d.story ? `${d.story}\n` : ''
      recog.current = r; setListening(true)
      r.onresult = (e: SpeechEvt) => { let s = ''; for (let j = 0; j < e.results.length; j++) s += e.results[j][0].transcript; set({ story: base + s }) }
      r.onend = () => setListening(false); r.onerror = () => setListening(false)
      try { r.start() } catch { setListening(false) }
    }
    return (
      <div>
        <div className="flex flex-wrap gap-2">{prompts.map((p) => <Chip key={p} onClick={() => insert(p)}>{p}</Chip>)}</div>
        <textarea autoFocus value={d.story} onChange={(e) => set({ story: e.target.value.slice(0, 600) })} rows={7} placeholder={t('seek.story.ph')} className={`mt-4 resize-none leading-relaxed ${field}`} />
        <button onClick={dictate} aria-pressed={listening} className="seek-chip mt-3 inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13.5px] transition-colors">
          <I.Mic className="h-4 w-4" />{listening ? t('seek.story.listening') : t('seek.story.dictate')}
        </button>
      </div>
    )
  }

  if (k === 'time') return (
    <div className="space-y-4">
      <label className="block"><span className="text-[12.5px] tracking-[0.12em] text-ink-soft">{t('seek.time.birthday')}</span>
        <input value={d.birthday} onChange={(e) => set({ birthday: e.target.value.replace(/[^\d-]/g, '').slice(0, 5) })} placeholder={t('seek.time.birthday.ph')} inputMode="numeric" className={`mt-2 ${field}`} /></label>
      <label className="block"><span className="text-[12.5px] tracking-[0.12em] text-ink-soft">{t('seek.time.years')}</span>
        <input value={d.years} onChange={(e) => set({ years: e.target.value.slice(0, 20) })} placeholder={t('seek.time.years.ph')} className={`mt-2 ${field}`} /></label>
    </div>
  )

  return (
    <input autoFocus value={d.place} onChange={(e) => set({ place: e.target.value.slice(0, 40) })} placeholder={t('seek.place.ph')} className={field} />
  )
}

type SpeechEvt = { results: ArrayLike<ArrayLike<{ transcript: string }>> }
type SpeechRec = { lang: string; interimResults: boolean; start: () => void; stop: () => void; onresult: (e: SpeechEvt) => void; onend: () => void; onerror: () => void }

function RefineBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mb-6"><div className="mb-2.5 text-[12.5px] tracking-[0.16em] text-ink-soft">{title}</div>{children}</section>
}
function Chip({ on, onClick, children }: { on?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} aria-pressed={on} className="seek-chip rounded-full px-3.5 py-2 text-[14px] transition-colors">{children}</button>
}
