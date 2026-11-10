import { useContext, useEffect, useRef, useState } from 'react'
import { useI18n, fmtFullDate } from './i18n'
import { clarity, nid, type Memory, type Person, type Post } from './model'
import { WORLDS, WorldScene } from './worlds'
import { Lens } from './fx'
import { I, Sheet, Switch, AiBadge, NightCtx, useStatusTone, type IP } from './ui'
import { GearSheet, LetterComposer, LetterCard, MemorySheet, Row } from './person'
import { GiftProfile } from './gifts/GiftProfile'
import type { GiftOpenOptions } from './gifts/types'

/* ------------------------------------------------------------------ *
 * 资料卡：像微信的联系人页。会话之外的一切——TA 的空间、记忆、信匣、
 * 时光、所在世界与设置——都从这里进入。
 * ------------------------------------------------------------------ */

export function Profile({ person, people, posts, large, readAloud, giftOwner, onGift, onBack, onChat, onCall, onSpace, onWorld, onUpdate, onDelete, onEcho, onToggleLarge, onToggleRead }: {
  person: Person; people: Person[]; posts: Post[]; large: boolean; readAloud: boolean
  giftOwner: string; onGift: (options?: GiftOpenOptions) => void
  onBack: () => void; onChat: () => void; onCall: (mode: 'voice' | 'video') => void; onSpace: () => void; onWorld: () => void
  onUpdate: (p: Partial<Person>) => void; onDelete: () => void; onEcho: (m: Memory) => void; onToggleLarge: () => void; onToggleRead: () => void
}) {
  const { t, lang } = useI18n()
  const night = useContext(NightCtx)
  useStatusTone(night ? 'light' : 'dark')
  const w = WORLDS[person.world]
  const [sheet, setSheet] = useState<null | 'mem' | 'letters' | 'time' | 'gear'>(null)
  const [keep, setKeep] = useState(false)
  const [letter, setLetter] = useState(false)
  const writeLetter = useRef<HTMLButtonElement>(null)
  const mine = posts.filter((p) => p.author === person.id).sort((a, b) => b.at - a.at)
  const thumbs = [...new Set(mine.flatMap((p) => p.images))].slice(0, 4)
  const letters = person.letters ?? []
  const reply = letters.some((l) => l.replyNew)
  const closeLetter = () => {
    setLetter(false)
    requestAnimationFrame(() => writeLetter.current?.focus({ preventScroll: true }))
  }

  useEffect(() => {
    if (sheet === 'letters' && reply) onUpdate({ letters: letters.map((l) => ({ ...l, replyNew: false })) })
  }, [sheet, reply]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`absolute inset-0 overflow-hidden wb-${person.world}`} style={{ background: 'var(--wb)' }}>
      <div className="contents" inert={letter}>
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
            <PRow icon={I.Mail} label={t('profile.letters')} value={reply ? t('profile.reply') : String(letters.length)} accent={reply} onClick={() => setSheet('letters')} />
            <GiftProfile owner={giftOwner} person={person} onOpen={onGift} />
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
        <button onClick={() => onCall('video')} aria-label={t('profile.video')} className="h-14 w-14 rounded-full glass-light text-ink flex items-center justify-center active:scale-95 transition-transform"><I.Video className="h-6 w-6" /></button>
      </div>

      {sheet === 'mem' && (
        <Sheet tall onClose={() => setSheet(null)} title={t('profile.memories')}>
          <button onClick={() => setKeep(true)} className="w-full h-12 rounded-2xl border border-dashed border-line text-[14.5px] text-ink-soft inline-flex items-center justify-center gap-2 active:bg-black/[0.03]"><I.Keep className="h-[18px] w-[18px] text-sun-deep" />{t('space.keep')}</button>
          <div className="mt-3 space-y-3">
            {person.memories.length === 0 && <p className="py-3 text-center text-[13px] text-muted">{t('space.mem.empty')}</p>}
            {person.memories.map((m) => (
              <div key={m.id} className="rounded-2xl glass-light px-4 py-3.5">
                <h4 className="font-serif text-[18px] text-ink">{m.title}</h4>
                <p className="mt-1 text-[14.5px] leading-relaxed text-ink-soft">{m.body}</p>
              </div>
            ))}
          </div>
          {keep && <MemorySheet title={t('keep.title')} draft={{ id: 0, title: '', body: '' }} editing onClose={() => setKeep(false)}
            onConfirm={(m) => { const kept = { ...m, id: nid() }; onUpdate({ memories: [kept, ...person.memories] }); onEcho(kept); setKeep(false) }} />}
        </Sheet>
      )}
      {sheet === 'letters' && (
        <Sheet tall onClose={() => setSheet(null)} title={t('profile.letters')}>
          <button ref={writeLetter} onClick={() => setLetter(true)} className="w-full h-12 rounded-full btn-dark text-[15.5px] font-medium inline-flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"><I.Mail className="h-[19px] w-[19px]" weight="fill" />{t('space.write')}</button>
          <div className="mt-4 space-y-4">
            {letters.length === 0 && <p className="py-3 text-center text-[13px] text-muted">{t('space.letters.empty')}</p>}
            {letters.map((l) => <LetterCard key={l.id} l={l} person={person} />)}
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
          <div className="mt-3 rounded-2xl glass-light overflow-hidden"><Switch on={!!person.remind} onToggle={() => onUpdate({ remind: !person.remind })} label={t('space.time.remind')} desc={t('space.time.remind.desc')} /></div>
        </Sheet>
      )}
      {sheet === 'gear' && <GearSheet person={person} people={people} large={large} readAloud={readAloud} onClose={() => setSheet(null)} onUpdate={onUpdate} onDelete={onDelete} onToggleLarge={onToggleLarge} onToggleRead={onToggleRead} />}
      </div>
      {letter && <LetterComposer person={person} draftOwner={giftOwner} onClose={closeLetter} onSent={(l) => onUpdate({ letters: [l, ...letters] })} />}
    </div>
  )
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
