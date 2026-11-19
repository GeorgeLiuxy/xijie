import { useContext, useEffect, useRef, useState } from 'react'
import { useI18n, fmtFullDate } from './i18n'
import { clarity, nid, type Memory, type Person, type Post } from './model'
import { WORLDS, WorldScene } from './worlds'
import { Lens } from './fx'
import { I, Sheet, Switch, AiBadge, NightCtx, useStatusTone, Toast, type IP } from './ui'
import { GearSheet, LetterComposer, LetterCard, MemorySheet, Row, type PersonManagement } from './person'
import { GiftProfile } from './gifts/GiftProfile'
import type { GiftOpenOptions } from './gifts/types'
import type { MemoryService } from './serviceMemories'
import { MemoryReader } from './MemoryReader'
import { AutomaticMemoryControls } from './AutomaticMemoryControls'
import { letterMessage, type LetterService, type LetterSnapshot } from './serviceLetters'
import type {ReminderService,ReminderSetting} from './serviceReminders'
import type {MemoryImportService} from './serviceMemoryImports'

/* ------------------------------------------------------------------ *
 * 资料卡：像微信的联系人页。会话之外的一切——TA 的空间、记忆、信匣、
 * 时光、所在世界与设置——都从这里进入。
 * ------------------------------------------------------------------ */

export function Profile({ person, people, posts, large, readAloud, giftOwner, onGift, onBack, onChat, onCall, onSpace, onWorld, onUpdate, onDelete, onEcho, onToggleLarge, onToggleRead, serviceAccount = false, managed, memoryService, letterService, letterSnapshot, initialLetterId, reminderService,memoryImports }: {
  person: Person; people: Person[]; posts: Post[]; large: boolean; readAloud: boolean; serviceAccount?: boolean; managed?: PersonManagement; memoryService?: MemoryService
  giftOwner: string; onGift: (options?: GiftOpenOptions) => void
  letterService?: LetterService; letterSnapshot?: LetterSnapshot; initialLetterId?: string
  reminderService?:ReminderService
  memoryImports?:MemoryImportService
  onBack: () => void; onChat: () => void; onCall: (mode: 'voice' | 'video') => void; onSpace: () => void; onWorld: () => void
  onUpdate: (p: Partial<Person>) => void; onDelete: () => void; onEcho: (m: Memory) => void; onToggleLarge: () => void; onToggleRead: () => void
}) {
  const { t, lang } = useI18n()
  const night = useContext(NightCtx)
  useStatusTone(night ? 'light' : 'dark')
  const w = WORLDS[person.world]
  const [toast, setToast] = useState<string | null>(null)
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(null), 2400); return () => clearTimeout(timer) }, [toast])
  const unavailable = () => setToast(lang.startsWith('zh') ? '这项功能暂时无法使用，资料未作修改。' : 'This feature is not connected yet. Your information has not changed.')
  const [sheet, setSheet] = useState<null | 'mem' | 'letters' | 'time' | 'gear'>(initialLetterId ? 'letters' : null)
  const [keep, setKeep] = useState(false)
  const [readingMemoryId, setReadingMemoryId] = useState<number | null>(null)
  const readingMemory = person.memories.find(memory => memory.id === readingMemoryId)
  const [letter, setLetter] = useState<boolean | Memory>(false)
  const writeLetter = useRef<HTMLButtonElement>(null)
  const selectedLetter = useRef<HTMLDivElement>(null)
  const focusedLetter = useRef<string | undefined>(undefined)
  const mine = posts.filter((p) => p.author === person.id).sort((a, b) => b.at - a.at)
  const thumbs = [...new Set(mine.flatMap((p) => p.images))].slice(0, 4)
  const letters = person.letters ?? []
  const containsInitialLetter = !!initialLetterId && letters.some(value => value.serverId === initialLetterId)
  const reply = letters.some((l) => l.replyNew)
  const closeLetter = () => {
    setLetter(false)
    requestAnimationFrame(() => writeLetter.current?.focus({ preventScroll: true }))
  }

  useEffect(() => {
    if (!serviceAccount && sheet === 'letters' && reply) onUpdate({ letters: letters.map((l) => ({ ...l, replyNew: false })) })
  }, [serviceAccount, sheet, reply]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (sheet === 'letters' && !letter && letterService && letterSnapshot?.status === 'ready') void letterService.markRead(letterSnapshot)
  }, [sheet, letter, letterService, letterSnapshot])
  useEffect(() => {
    if (sheet !== 'letters' || letter || !containsInitialLetter || focusedLetter.current === initialLetterId) return
    const frame = requestAnimationFrame(() => {
      const target = selectedLetter.current
      if (!target) return
      focusedLetter.current = initialLetterId
      target.scrollIntoView({ block: 'nearest' })
      target.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [sheet, letter, initialLetterId, containsInitialLetter])

  return (
    <div className={`absolute inset-0 overflow-hidden wb-${person.world}`} style={{ background: 'var(--wb)' }}>
      <div className="contents" inert={!!letter}>
      <div className="absolute inset-0 overflow-y-auto scroll-quiet">
        {/* 封面：TA 所在的世界 */}
        <div className="relative h-[330px] overflow-hidden">
          <div className="absolute inset-x-0 top-[var(--app-status-height)] bottom-0">
            <WorldScene world={person.world} />
          </div>
          <div className="absolute inset-x-0 bottom-0 h-44" style={{ background: 'linear-gradient(to bottom, transparent, var(--wb))' }} />
        </div>

        <div className="relative -mt-[104px] px-6">
          <div className="flex items-end gap-4">
            <Lens world={person.world} avatar={person.avatar} name={person.name} size={96} arcs={clarity(person)} glow />
            <div className="min-w-0 pb-2">
              <div className="flex items-center gap-2"><h1 className="font-serif text-[34px] leading-none text-ink truncate">{person.name}</h1><AiBadge label={t('common.ai')} /></div>
              <div className="mt-2 text-[13.5px] text-ink-soft truncate">{[person.relation, person.realName, person.years].filter(Boolean).join(' · ')}</div>
            </div>
          </div>
          {person.foundAt && <div className="mt-3 font-mono text-[10px] tracking-[0.16em] text-muted">{t('profile.found', { date: fmtFullDate(lang, person.foundAt) })}</div>}
        </div>

        <div className="px-5 mt-6 space-y-3 pb-[132px]">
          <button onClick={onSpace} className="w-full flex items-center gap-3 rounded-2xl glass-light px-4 py-3.5 text-left active:scale-[0.99] transition-transform">
            <span className="h-10 w-10 shrink-0 rounded-xl bg-sun/20 text-sun-deep flex items-center justify-center"><I.Space className="h-[22px] w-[22px]" /></span>
            <span className="flex-1 min-w-0 text-[15.5px] text-ink">{t('profile.space')}</span>
            <span className="flex min-w-0 max-w-[40%] shrink gap-1">{(thumbs.length ? thumbs : [w.thumb]).map((src, i) => <img key={i} src={src} alt="" className="w-12 min-w-0 aspect-square rounded-lg object-cover ring-1 ring-black/5" />)}</span>
            <I.Chevron className="h-4 w-4 shrink-0 text-muted" />
          </button>
          <div className="rounded-2xl glass-light divide-y divide-line overflow-hidden">
            <PRow icon={I.Keep} label={t('profile.memories')} value={String(person.memories.length)} onClick={() => setSheet('mem')} />
            <PRow icon={I.Mail} label={t('profile.letters')} value={reply ? t('profile.reply') : serviceAccount && letterSnapshot?.status !== 'ready' ? '—' : String(letters.length)} accent={reply} onClick={() => setSheet('letters')} />
            <GiftProfile owner={giftOwner} person={person} onOpen={onGift} enabled={!serviceAccount} />
            <PRow icon={I.Calendar} label={t('profile.time')} value={person.birthday ?? person.years ?? ''} onClick={() => setSheet('time')} />
            <PRow icon={I.Atlas} label={t('profile.world')} value={t(`world.${person.world}`)} onClick={onWorld} />
          </div>
          <div className="rounded-2xl glass-light overflow-hidden">
            <PRow icon={I.Gear} label={t('profile.more')} value="" onClick={() => setSheet('gear')} />
          </div>
        </div>
      </div>

      {/* 顶部操作 */}
      <div className="absolute inset-x-0 top-0 h-[var(--app-status-height)] pointer-events-none" style={{ background: 'var(--wb)' }} />
      <div className="absolute inset-x-0 top-0 pt-[calc(var(--app-status-height)+6px)] px-4 flex items-center justify-between text-ink pointer-events-none">
        <button onClick={onBack} aria-label={t('common.back')} className="pointer-events-auto h-11 w-11 flex items-center justify-center rounded-full bg-paper ring-1 ring-line active:scale-95 transition-transform"><I.Back className="h-5 w-5" /></button>
        <button onClick={() => setSheet('gear')} aria-label={t('profile.more')} className="pointer-events-auto h-11 w-11 flex items-center justify-center rounded-full bg-paper ring-1 ring-line active:scale-95 transition-transform"><I.More className="h-6 w-6" /></button>
      </div>

      {/* 底部：发消息 · 通话 */}
      <div className="absolute inset-x-0 bottom-0 px-5 pt-6 pb-[30px] flex gap-2.5" style={{ background: 'linear-gradient(to bottom, transparent, var(--wb) 45%)' }}>
        <button onClick={onChat} className="flex-1 h-14 rounded-full btn-dark text-[16.5px] font-semibold tracking-[0.08em] inline-flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-[0_16px_36px_-18px_rgba(41,69,66,0.7)]"><I.Meet className="h-[22px] w-[22px]" weight="fill" />{t('profile.message')}</button>
        <button onClick={() => onCall('voice')} aria-label={t('profile.call')} className="h-14 w-14 rounded-full glass-light text-ink flex items-center justify-center active:scale-95 transition-transform"><I.Phone className="h-6 w-6" /></button>
        <button onClick={() => onCall('video')} aria-label={serviceAccount ? (lang.startsWith('zh') ? '视频通话' : 'Video call') : t('profile.video')} className="h-14 w-14 rounded-full glass-light text-ink flex items-center justify-center active:scale-95 transition-transform"><I.Video className="h-6 w-6" /></button>
      </div>

      {sheet === 'mem' && (
        <Sheet tall onClose={() => setSheet(null)} title={t('profile.memories')}>
          <button onClick={() => setKeep(true)} className="w-full h-12 rounded-2xl border border-dashed border-line text-[14.5px] text-ink-soft inline-flex items-center justify-center gap-2 active:bg-black/[0.03]"><I.Keep className="h-[18px] w-[18px] text-sun-deep" />{t('space.keep')}</button>
          {memoryService && person.serverId && <div className="mt-3">
            <AutomaticMemoryControls personId={person.serverId} service={memoryService} />
          </div>}
          <div className="mt-3 space-y-3">
            {person.memories.length === 0 && <p className="py-3 text-center text-[13px] text-muted">{t('space.mem.empty')}</p>}
            {person.memories.map((m) => (
              <div key={m.id} role={memoryService ? 'button' : undefined} tabIndex={memoryService ? 0 : undefined}
                onClick={memoryService ? () => setReadingMemoryId(m.id) : undefined}
                onKeyDown={memoryService ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setReadingMemoryId(m.id) } } : undefined}
                className="rounded-2xl glass-light px-4 py-3.5">
                <h4 className="font-serif text-[18px] text-ink">{m.title}</h4>
                <p className="mt-1 text-[14.5px] leading-relaxed text-ink-soft">{m.body}</p>
              </div>
            ))}
          </div>
          {keep && <MemorySheet title={t('keep.title')} draft={{ id: 0, title: '', body: '' }} editing onClose={() => setKeep(false)}
            onConfirm={async (m) => {
              if (serviceAccount) {
                if (!memoryService || !person.serverId) { unavailable(); return false }
                const saved = await memoryService.save(person.serverId, m)
                if (saved) setReadingMemoryId(saved.id)
                return !!saved
              }
              const kept = { ...m, id: nid() }; onUpdate({ memories: [kept, ...person.memories] }); onEcho(kept); setKeep(false)
            }} />}
        </Sheet>
      )}
      {sheet === 'letters' && (
        <Sheet tall onClose={() => setSheet(null)} title={t('profile.letters')}>
          <button ref={writeLetter} onClick={() => setLetter(true)} className="w-full h-12 rounded-full btn-dark text-[15.5px] font-medium inline-flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"><I.Mail className="h-[19px] w-[19px]" weight="fill" />{t('space.write')}</button>
          <div className="mt-4 space-y-4">
            {serviceAccount && letterSnapshot?.status !== 'ready' && <p role="status" className="py-3 text-center text-[13px] text-muted">{letterSnapshot?.status === 'error' ? letterMessage(letterSnapshot.error, lang.startsWith('zh'), 'read') : lang.startsWith('zh') ? '正在读取信匣…' : 'Loading the letterbox…'}</p>}
            {(!serviceAccount || letterSnapshot?.status === 'ready') && letters.length === 0 && <p className="py-3 text-center text-[13px] text-muted">{t('space.letters.empty')}</p>}
            {letterSnapshot?.readError && <p role="status" className="py-3 text-center text-[13px] text-muted">{lang.startsWith('zh') ? '暂时无法确认已读状态，稍后会自动重试。' : 'The read status is not confirmed yet. It will retry automatically.'}</p>}
            {initialLetterId && letterSnapshot?.status === 'ready' && !containsInitialLetter && <p role="status" className="py-2 text-center text-[13px] text-muted">{lang.startsWith('zh') ? '这封回信已无法打开。' : 'This reply is no longer available.'}</p>}
            {letters.map(l => {
              const binding = l.sourceMemory
              const source = memoryService && binding
                ? person.memories.find(memory => memory.serverId === binding.id && memory.serverVersion === binding.version)
                : undefined
              const onReadSource = source ? () => setReadingMemoryId(source.id) : undefined
              return initialLetterId && l.serverId === initialLetterId
                ? <div key={l.id} ref={selectedLetter} tabIndex={-1} className="space-y-3 rounded-2xl focus-visible:outline-2 focus-visible:outline-sky-deep">
                  <LetterCard l={l} person={person} onReadSource={onReadSource} />
                  <button type="button" onClick={onChat} className="w-full min-h-11 rounded-full glass-light text-[14px] text-ink">{lang.startsWith('zh') ? '继续聊聊' : 'Continue chatting'}</button>
                </div>
                : <LetterCard key={l.id} l={l} person={person} onReadSource={onReadSource} />
            })}
          </div>
        </Sheet>
      )}
      {sheet === 'time' && (
        <Sheet onClose={() => setSheet(null)} title={t('profile.time')}>
          <div className="rounded-2xl glass-light divide-y divide-line overflow-hidden">
            {person.foundAt && <Row k={t('profile.found', { date: '' }).trim()} v={fmtFullDate(lang, person.foundAt)} />}
            <Row k={t('space.time.birthday')} v={person.birthday ?? t('gear.unset')} />
            <Row k={t('space.time.years')} v={person.years ?? t('gear.unset')} />
            <Row k={t('space.time.place')} v={person.place ?? t('gear.unset')} />
          </div>
          {serviceAccount?<PersonReminder personId={person.serverId} service={reminderService}/>:<div className="mt-3 rounded-2xl glass-light overflow-hidden"><Switch on={!!person.remind} onToggle={() => onUpdate({ remind: !person.remind })} label={t('space.time.remind')} desc={t('space.time.remind.desc')} /></div>}
        </Sheet>
      )}
      {sheet === 'gear' && <GearSheet managed={serviceAccount ? managed : undefined} serviceAccount={serviceAccount} memoryImports={memoryImports} person={person} people={people} large={large} readAloud={readAloud} onClose={() => setSheet(null)} onUpdate={onUpdate} onDelete={onDelete} onToggleLarge={onToggleLarge} onToggleRead={onToggleRead} />}
      </div>
      {toast && <Toast text={toast} />}
      {readingMemory && <MemoryReader memory={readingMemory} personName={person.name} personId={person.serverId} service={memoryService} onClose={() => setReadingMemoryId(null)} onWriteLetter={letterService ? setLetter : undefined} />}
      {letter && <LetterComposer serviceAccount={serviceAccount} service={letterService} person={person} draftOwner={giftOwner} memory={typeof letter === 'object' ? letter : undefined} onClose={closeLetter} onSent={(l) => onUpdate({ letters: [l, ...letters] })} />}
    </div>
  )
}

function PersonReminder({personId,service}:{personId?:string;service?:ReminderService}){
 const {t,lang}=useI18n(),zh=lang.startsWith('zh')
 const [loaded,setLoaded]=useState<{service:ReminderService;value:ReminderSetting}>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState<boolean>()
 const binding=useRef({service,personId});binding.current={service,personId}
 const revision=useRef(0),active=useRef(true)
 const value=loaded&&loaded.service===service&&loaded.value.personId===personId?loaded.value:undefined
 const live=(generation:number)=>active.current&&revision.current===generation&&binding.current.service===service&&binding.current.personId===personId
 async function load(generation=revision.current){
  if(!service||!personId)return
  setBusy(true);setError('')
  try{const result=await service.setting(personId);if(live(generation))setLoaded({service,value:result})}
  catch{if(live(generation))setError(zh?'暂时无法加载提醒设置，请重试。':'Reminder settings could not be loaded. Please retry.')}
  finally{if(live(generation))setBusy(false)}
 }
 useEffect(()=>{active.current=true;const generation=++revision.current;setLoaded(undefined);setPending(undefined);void load(generation);return()=>{active.current=false;revision.current++}},[service,personId])
 async function toggle(enabled:boolean){
  if(!service||!value||busy)return
  const generation=revision.current;setBusy(true);setError('')
  try{const result=await service.set(value,enabled);if(live(generation)){setLoaded({service,value:result});setPending(undefined)}}
  catch(failure){
   if(!live(generation))return
   const problem=failure as {code?:string;pendingEnabled?:boolean}
   setPending(typeof problem.pendingEnabled==='boolean'?problem.pendingEnabled:undefined)
   if(problem.code==='VERSION_CONFLICT'){
    try{const result=await service.setting(value.personId);if(live(generation))setLoaded({service,value:result})}catch{/* Keep the last confirmed setting until it can be refreshed. */}
   }
   if(live(generation))setError(problem.code==='VERSION_CONFLICT'
    ?zh?'提醒设置已在另一处修改，请先刷新设置，再重新选择。':'Reminder settings changed elsewhere. Refresh them, then choose again.'
    :typeof problem.pendingEnabled==='boolean'
     ?zh?'还没能确认是否修改成功，请点击「重试保存」。':'We could not confirm whether the change was saved. Select Retry saving.'
     :zh?'这次修改未能完成，请刷新设置后再试。':'This change could not be completed. Refresh the settings and try again.')
  }finally{if(live(generation))setBusy(false)}
 }
 return <div className="mt-3 rounded-2xl glass-light overflow-hidden">
  {value?<div inert={busy||pending!==undefined}><Switch on={value.enabled} onToggle={()=>void toggle(!value.enabled)} label={t('space.time.remind')} desc={busy?(zh?'正在保存…':'Saving…'):t('space.time.remind.desc')}/></div>
   :<p role="status" className="px-4 py-3 text-[13px] text-ink-soft">{busy?zh?'正在加载提醒设置…':'Loading reminder settings…':zh?'提醒设置暂时不可用。':'Reminder settings are unavailable right now.'}</p>}
  {error&&<p role="status" className="px-4 pb-3 text-[13px] text-ink-soft">{error} <button disabled={busy} className="underline" onClick={()=>pending!==undefined?void toggle(pending):void load()}>{pending!==undefined?zh?'重试保存':'Retry saving':zh?'刷新设置':'Refresh settings'}</button></p>}
 </div>
}

function PRow({ icon: Icon, label, value, onClick, accent }: { icon: (p: IP) => React.ReactElement; label: string; value: string; onClick: () => void; accent?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-black/[0.03]">
      <span className="h-9 w-9 shrink-0 rounded-xl bg-sky/12 text-sky-deep flex items-center justify-center"><Icon className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere] text-[15.5px] text-ink">{label}</span>
      {value && <span className={`min-w-0 max-w-[46%] text-right [overflow-wrap:anywhere] text-[13.5px] ${accent ? 'text-sun-deep font-medium' : 'text-muted'}`}>{value}</span>}
      <I.Chevron className="h-4 w-4 shrink-0 text-muted" />
    </button>
  )
}
