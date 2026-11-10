import { useContext, useMemo, useRef, useState } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { isZh, useI18n, WORLD_IDS, type WorldId } from './i18n'
import type { Person } from './model'
import { WORLDS } from './worlds'
import { DeepField, Lens, COSMOS } from './fx'
import { I, NightCtx, haptic, useStatusTone } from './ui'
import { AtlasSearch } from './atlas/AtlasSearch'
import { AtlasCarousel, type AtlasSlot } from './atlas/AtlasCarousel'
import './atlas/atlas-theme.css'

export type Rect = { x: number; y: number; r: number }

export type AtlasView = { world?: AtlasSlot; searchOpen?: boolean; query?: string; list?: boolean }
export function Atlas({ people, view, onView, onWorld, onSeek, onOpen, onDiscoverSearch }: {
  people: Person[]; view: AtlasView; onView: (next: AtlasView) => void
  onWorld: (w: WorldId) => void; onSeek: (clue?: string) => void; onOpen: (id: number) => void
  onDiscoverSearch?: () => void
}) {
  const { t, lang } = useI18n()
  const zh = isZh(lang)
  const night = useContext(NightCtx)
  useStatusTone(night ? 'light' : 'dark')
  const slots: AtlasSlot[] = [...WORLD_IDS, 'unknown']
  const [initialWorld] = useState(() => WORLD_IDS.find(world => people.some(person => person.world === world)) ?? WORLD_IDS[0])
  const found = slots.indexOf(view.world ?? initialWorld)
  const idx = found >= 0 ? found : 0
  const cur = slots[idx]
  const atmosphere = cur === 'unknown' ? { sky: '#153039', horizon: '#294e5c' } : WORLDS[cur].atlas
  const directoryOpen = Boolean(view.searchOpen || view.list)
  const searchMarkedNew = Boolean(onDiscoverSearch && !directoryOpen)
  const searchButton = useRef<HTMLButtonElement>(null)
  const grouped = useMemo(() => {
    const result: Partial<Record<WorldId, Person[]>> = {}
    for (const person of people) (result[person.world] ??= []).push(person)
    return result
  }, [people])
  const residents = cur === 'unknown' ? [] : grouped[cur] ?? []
  const go = (index: number, closeDirectory = false) => {
    const next = Math.max(0, Math.min(slots.length - 1, index))
    if (next !== idx) haptic(10)
    if (next !== idx || closeDirectory) onView({ ...view, world: slots[next], ...(closeDirectory ? { searchOpen: false, list: false } : {}) })
    if (closeDirectory) requestAnimationFrame(() => searchButton.current?.focus({ preventScroll: true }))
  }
  const enter = () => {
    if (cur === 'unknown') { onSeek(); return }
    haptic(12)
    onWorld(cur)
  }
  const closeDirectory = () => {
    onView({ ...view, searchOpen: false, list: false })
    requestAnimationFrame(() => searchButton.current?.focus({ preventScroll: true }))
  }
  return <div className="atlas-root absolute inset-0 overflow-hidden" data-world={cur} data-tone={night ? 'night' : 'day'}
    style={{ '--atlas-sky': atmosphere.sky, '--atlas-horizon': atmosphere.horizon, '--atlas-night-accent': cur === 'unknown' ? '#a9cac7' : WORLDS[cur].accent } as React.CSSProperties} onKeyDown={event => {
    if (directoryOpen || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'ArrowRight') { event.preventDefault(); go(idx + 1) }
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(idx - 1) }
  }}>
    {night && cur === 'unknown' && <DeepField variant="deep" dim={.75} className="atlas-field" />}
    <img className="atlas-ambient" src={cur === 'unknown' ? COSMOS.swirl : WORLDS[cur].thumb} alt="" aria-hidden />
    <div className="atlas-sky-shade" aria-hidden />
    <div className="atlas-layout absolute inset-0 flex flex-col overflow-y-auto overflow-x-hidden scroll-quiet" inert={directoryOpen}>
      <header className="atlas-head relative z-20 shrink-0 pt-[calc(var(--app-status-height)+8px)] px-5 flex items-start justify-between">
        <div>
          <h1 className="font-serif text-[28px] leading-none tracking-[0.24em]">{t('atlas.title')}</h1>
          <p className="atlas-world-count">{zh ? `${WORLD_IDS.length} 个世界 · ${people.length} 位联系人` : `${WORLD_IDS.length} worlds · ${people.length} ${people.length === 1 ? 'contact' : 'contacts'}`}</p>
        </div>
        <button ref={searchButton} className="atlas-directory-trigger glass-dim" aria-expanded={directoryOpen} aria-haspopup="dialog"
          data-search-new={searchMarkedNew || undefined}
          aria-label={searchMarkedNew ? (zh ? '全部世界，可搜索世界、人物和记忆' : 'All worlds, now with people and memory search') : undefined}
          onClick={() => {
            onDiscoverSearch?.()
            onView({ ...view, world: cur, searchOpen: true, list: false })
          }}><MagnifyingGlass aria-hidden />{zh ? '全部世界' : 'All worlds'}</button>
      </header>
      <AtlasCarousel slots={slots} index={idx} residents={grouped} disabled={directoryOpen} onSelect={go} onEnter={enter} onResident={onOpen} />
        {/* 世界信息 */}
        <div inert={directoryOpen} className="atlas-world-info relative z-20">
          <div className="atlas-world-card rounded-[26px] px-5 pt-4 pb-4">
            {cur === 'unknown' ? (
              <>
                <div className="atlas-card-meta font-mono text-[10px] tracking-[0.26em]">ELY·?? · {t('atlas.tune')}</div>
                <h2 aria-live="polite" className="mt-1.5 font-serif text-[26px] leading-tight tracking-[0.08em]">{t('atlas.unknown.title')}</h2>
                <p className="mt-1 text-[13.5px] leading-relaxed">{t('atlas.unknown.desc')}</p>
                <div className="atlas-residents" aria-hidden="true" />
                <div className="atlas-world-actions">
                  <button onClick={() => onSeek()} className="w-full h-12 rounded-full btn-light text-[15.5px] font-semibold tracking-[0.1em] inline-flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"><I.Beacon className="h-5 w-5" weight="fill" />{t('atlas.seek')}</button>
                </div>
              </>
            ) : (
              <>
                <div className="atlas-card-meta flex items-center justify-between font-mono text-[10px] tracking-[0.26em]"><span>{WORLDS[cur].code} · {t('atlas.tune')}</span><span>{residents.length ? t('atlas.residents') : ''}</span></div>
                <h2 aria-live="polite" className="mt-1.5 font-serif text-[26px] leading-tight tracking-[0.08em]">{t(`world.${cur}`)}</h2>
                <p className="mt-1 text-[13.5px] leading-relaxed truncate">{t(`world.${cur}.law`)}</p>
                <div className="atlas-residents mt-3 flex items-center gap-2 min-h-[30px]">
                  {residents.length ? (
                    <>
                      <span className="flex -space-x-2.5">{residents.slice(0, 4).map((p) => <button key={p.id} onClick={() => onOpen(p.id)} className="atlas-resident-link rounded-full" aria-label={p.name}><Lens world={p.world} avatar={p.avatar} name={p.name} size={30} dark={night} /></button>)}</span>
                      <span className="atlas-resident-names text-[13.5px] truncate">{residents.map((p) => p.name).join(' · ')}</span>
                    </>
                  ) : <span className="atlas-card-meta text-[13px]">{t('atlas.none')}</span>}
                </div>
                <div className="atlas-world-actions flex gap-2.5">
                  {residents.length > 0 && <button onClick={enter} className="flex-1 h-12 rounded-full btn-light text-[15.5px] font-semibold tracking-[0.1em] active:scale-[0.98] transition-transform shadow-[0_0_34px_-8px_rgba(235,201,149,0.7)]">{t('atlas.enter')}</button>}
                  <button onClick={residents.length ? () => onSeek() : enter} className={`${residents.length ? 'w-auto px-5 glass-dim' : 'flex-1 btn-light font-semibold'} h-12 rounded-full text-[15px] tracking-[0.08em] inline-flex items-center justify-center gap-2 active:scale-[0.98] transition-transform`}>
                    <I.Beacon className="h-[18px] w-[18px]" />{residents.length ? t('atlas.seek') : t('atlas.enter')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

    </div>
    {directoryOpen && <AtlasSearch people={people} currentWorld={cur} query={view.query ?? ''}
      onQuery={query => onView({ ...view, world: cur, query })} onClose={closeDirectory}
      onWorld={world => go(slots.indexOf(world), true)} onOpen={onOpen} onSeek={onSeek} />}
  </div>
}

export { WorldView, type WorldPlaceView } from './world/WorldView'
