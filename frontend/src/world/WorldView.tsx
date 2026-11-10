import { useContext, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, BookOpenText, Eye, Pause, Play, SpeakerHigh, SpeakerSlash, UsersThree } from '@phosphor-icons/react'
import { isZh, useI18n, type WorldId } from '../i18n'
import type { Memory, Person } from '../model'
import { Lens } from '../fx'
import { I, NightCtx, Sheet, haptic, useStatusTone } from '../ui'
import { useNativeBack } from '../mobile/back'
import { useWorldMedia } from './useWorldMedia'
import tideFar from '../study/assets/tide/landfall.webp'
import tideNear from '../study/assets/tide/threshold-close.webp'
import islesFar from '../study/assets/isles/landfall.webp'
import islesNear from '../study/assets/isles/threshold-close.webp'
import './world-view.css'

const places = {
  courtyard: {
    far: `${import.meta.env.BASE_URL}experience/courtyard-v2.jpg`, near: `${import.meta.env.BASE_URL}experience/courtyard-v2.jpg`,
    place: ['雨后的旧院', 'The courtyard after rain'], seat: ['檐下 · 茶桌', 'Under the eaves'],
    invitation: ['坐到桌边', 'Sit by the table'],
    line: ['雨停了。\n在这儿坐一会儿。', 'The rain has stopped.\nStay for a while.'],
  },
  tide: {
    far: tideFar, near: tideNear,
    place: ['幽水渡口', 'Stillwater crossing'], seat: ['灯下 · 船舱', 'By the cabin lantern'],
    invitation: ['走进船舱', 'Step aboard'],
    line: ['渡口的灯亮着。\n这里不必赶路。', 'A lantern by the water.\nThere is no hurry.'],
  },
  isles: {
    far: islesFar, near: islesNear,
    place: ['虹桥云站', 'Cloudbridge station'], seat: ['云间 · 长椅', 'The platform bench'],
    invitation: ['到长椅旁坐坐', 'Sit by the bench'],
    line: ['云从桥下经过。\n在这里，停一停。', 'Clouds pass beneath the bridge.\nRest here a moment.'],
  },
} as const

export type WorldPlaceView = { near?: boolean; personId?: number; memoryId?: number; quiet?: boolean }
export type WorldViewProps = {
  world: WorldId; people: Person[]; calm?: boolean
  view?: WorldPlaceView; onView: (view: WorldPlaceView) => void
  onBack: () => void; onOpen: (id: number) => void
  onTalk: (id: number, memoryId?: number) => void; onGather: () => void; onSeek: () => void
}

/** The route owns the selected person, viewpoint and memory so a conversation can return here. */
export function WorldView({ world, people, calm = false, view, onView, onBack, onOpen, onTalk, onGather, onSeek }: WorldViewProps) {
  const { t, lang } = useI18n()
  const zh = isZh(lang)
  const night = useContext(NightCtx)
  const place = places[world]
  const word = (pair: readonly [string, string]) => pair[zh ? 0 : 1]
  const residents = people.filter(person => person.world === world)
  const active = residents.find(person => person.id === view?.personId) ?? residents[0]
  const memories = residents.flatMap(person => person.memories.map(memory => ({ person, memory })))
  const memory = active?.memories.find(item => item.id === view?.memoryId)
  const near = (view?.near ?? false) || !!memory
  const quiet = view?.quiet ?? false
  const [sheet, setSheet] = useState<'people' | 'memories' | 'about' | null>(null)
  const [failed, setFailed] = useState<Record<string, boolean>>({})
  const [cupPoint, setCupPoint] = useState({ x: '49%', y: '66%' })
  const root = useRef<HTMLDivElement>(null)
  const backButton = useRef<HTMLButtonElement>(null)
  const sheetOpener = useRef<HTMLElement | null>(null)
  const source = world === 'courtyard' ? `${import.meta.env.BASE_URL}experience/courtyard-v2.mp4` : undefined
  const media = useWorldMedia({ src: source, calm, suspended: !!sheet, ducked: !!memory })
  useStatusTone('light')

  useEffect(() => {
    const element = root.current
    if (!element || world !== 'courtyard') return
    const measure = () => {
      const width = element.clientWidth, height = element.clientHeight
      const scale = Math.max(width / 768, height / 1344)
      setCupPoint({ x: `${(width - 768 * scale) / 2 + 768 * scale * .495}px`, y: `${(height - 1344 * scale) / 2 + 1344 * scale * .665}px` })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element); measure()
    return () => observer.disconnect()
  }, [world])

  function stepBack() {
    if (quiet) { onView({ ...view, quiet: false }); return }
    if (memory) { onView({ ...view, memoryId: undefined }); return }
    if (near) { onView({ ...view, near: false, memoryId: undefined }); return }
    onBack()
  }
  useNativeBack(() => { stepBack(); return true }, quiet || near || !!memory, 10, root)
  function enter() { haptic(8); onView({ ...view, near: true, quiet: false }); backButton.current?.focus({ preventScroll: true }) }
  function openSheet(value: NonNullable<typeof sheet>) {
    sheetOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSheet(value)
  }
  function closeSheet() {
    setSheet(null)
    requestAnimationFrame(() => { if (sheetOpener.current?.isConnected) sheetOpener.current.focus({ preventScroll: true }) })
  }
  function selectPerson(id: number) { onView({ ...view, personId: id, memoryId: undefined, near: true, quiet: false }); closeSheet() }
  function openMemory(person: Person, item: Memory) {
    onView({ ...view, near: true, quiet: false, personId: person.id, memoryId: item.id })
    if (sheet) closeSheet()
    else backButton.current?.focus({ preventScroll: true })
  }
  const backLabel = quiet ? (zh ? '继续漫游' : 'Show controls') : memory ? (zh ? '回到身旁' : 'Back to the place') : near ? (zh ? '回到远处' : 'Step back') : t('common.back')
  const firstMemory = active?.memories[0]
  const memoryIndex = memory && active ? active.memories.findIndex(item => item.id === memory.id) : -1
  const sceneFailed = !!failed[near ? place.near : place.far]

  return <div ref={root} className="world-place" data-world={world} data-near={near} data-reading={!!memory} data-quiet={quiet} data-night={night}
    onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented && !sheet) { event.preventDefault(); stepBack() } }}>
    <div className="visit-art" aria-hidden="true">
      {world === 'courtyard' ? <div className="visit-camera">
        {!failed[place.far] && <img className="visit-photo" src={place.far} alt="" onError={() => setFailed(current => ({ ...current, [place.far]: true }))} />}
        <video ref={media.videoRef} className={`visit-film ${media.videoReady && !media.videoFailed ? 'is-ready' : ''}`} src={source} poster={place.far} muted playsInline loop preload="metadata" />
      </div> : [place.far, place.near].map((src, index) => <div key={src} className={`visit-shot ${near === Boolean(index) ? 'is-visible' : ''}`}>
        {!failed[src] && <img className="visit-photo" src={src} alt="" onError={() => setFailed(current => ({ ...current, [src]: true }))} />}
      </div>)}
      <div className="visit-shade" /><div className="visit-reading-shade" />
    </div>
    {source && <audio ref={media.audioRef} src={source} loop preload="none" />}

    <div className="visit-interface" inert={!!sheet}>
      <header className="visit-header">
        <button ref={backButton} className="visit-icon" onClick={stepBack} aria-label={backLabel}><I.Back className="h-5 w-5" /></button>
        <button className="visit-heading" onClick={() => openSheet('about')} inert={quiet} aria-label={zh ? '了解这个世界' : 'About this world'}>
          <h1>{t(`world.${world}`)}</h1><span>{word(near ? place.seat : place.place)}</span>
        </button>
        {source && <button className="visit-icon" onClick={media.toggleVideo} aria-pressed={media.videoPaused} aria-label={media.videoFailed ? (zh ? '重试播放画面' : 'Retry scenery') : media.videoPaused ? (zh ? '播放画面' : 'Play scenery') : (zh ? '暂停画面' : 'Pause scenery')}>{media.videoPaused ? <Play size={17} /> : <Pause size={17} />}</button>}
        <button className="visit-icon" aria-pressed={quiet} aria-label={quiet ? (zh ? '继续漫游' : 'Show controls') : (zh ? '安静看看' : 'Just linger')} onClick={() => onView({ ...view, quiet: !quiet })}><Eye size={19} /></button>
      </header>

      <div className="visit-main" inert={quiet}>
        <div className={`visit-object-plane ${world === 'courtyard' ? 'is-courtyard' : ''}`}>
          <button className="visit-object" style={{ left: world === 'courtyard' ? cupPoint.x : '50%', top: world === 'courtyard' ? cupPoint.y : '46%' }}
            inert={!near || !!memory || !firstMemory} aria-hidden={!near || !!memory || !firstMemory}
            onClick={() => active && firstMemory && openMemory(active, firstMemory)} aria-label={zh ? '翻开一页珍藏的回忆' : 'Open a saved memory'}>
            <span className="visit-object-line" aria-hidden="true" /><span>{zh ? '翻一页往事' : 'A memory here'}</span>
          </button>
        </div>

        <section className={`visit-content visit-arrival ${!near ? 'is-current' : ''}`} inert={near} aria-hidden={near}>
          <p className="visit-arrival-line">{word(place.line)}</p>
          <button className="visit-text-action" onClick={enter}>{word(place.invitation)}<ArrowUpRight size={18} /></button>
        </section>

        <section className={`visit-content visit-near ${near && !memory ? 'is-current' : ''}`} inert={!near || !!memory} aria-hidden={!near || !!memory}>
          {active ? <>
            <p className="visit-person-line"><span>{active.name}</span><small>{zh ? '同在这个世界' : 'In this world'}</small></p>
            <button className="visit-text-action" onClick={() => onTalk(active.id)}>{zh ? '和你说说话' : 'Talk for a while'}<ArrowUpRight size={18} /></button>
            {firstMemory && <button className="visit-small-memory" onClick={() => openMemory(active, firstMemory)}><BookOpenText size={15} />{zh ? '翻一页往事' : 'Open a memory'}</button>}
          </> : <>
            <p className="visit-empty-line">{zh ? '可以先在这里坐坐。' : 'You can stay here for a while.'}</p>
            <button className="visit-text-action" onClick={onSeek}>{t('atlas.seek')}<ArrowUpRight size={18} /></button>
          </>}
        </section>

        <article className={`visit-content visit-recollection ${memory ? 'is-current' : ''}`} inert={!memory} aria-hidden={!memory}>
          {memory && active && <>
            <p className="visit-memory-source">{active.name} · {zh ? '珍藏的回忆' : 'A saved memory'}</p>
            <h2>{memory.title}</h2>
            <div className="visit-memory-body scroll-quiet" key={`${active.id}-${memory.id}`} role="region" aria-label={zh ? '回忆原文' : 'Memory text'} tabIndex={0}><p>{memory.body}</p></div>
            <div className="visit-memory-actions">
              <button className="visit-text-action" onClick={() => onTalk(active.id, memory.id)}>{zh ? '聊聊这一页' : 'Talk about this page'}<ArrowUpRight size={18} /></button>
              {active.memories.length > 1 && <div className="visit-memory-pages" aria-label={zh ? '翻阅回忆' : 'Browse memories'}>
                <button aria-label={zh ? '上一页回忆' : 'Previous memory'} disabled={memoryIndex <= 0} onClick={() => openMemory(active, active.memories[memoryIndex - 1])}><I.Back className="h-4 w-4" /></button>
                <span>{memoryIndex + 1}/{active.memories.length}</span>
                <button aria-label={zh ? '下一页回忆' : 'Next memory'} disabled={memoryIndex >= active.memories.length - 1} onClick={() => openMemory(active, active.memories[memoryIndex + 1])}><I.Chevron className="h-4 w-4" /></button>
              </div>}
            </div>
          </>}
        </article>
      </div>

      <footer className="visit-footer">
        <div className="visit-company" inert={quiet}>
          <button className="visit-person-picker" onClick={() => openSheet('people')} aria-label={zh ? '选择同在这里的人' : 'Choose someone here'}>
            {active ? <Lens world={world} avatar={active.avatar} name={active.name} size={26} dark /> : <UsersThree size={19} />}
            <span>{active?.name || t('world.together')}</span>{residents.length > 1 && <small>+{residents.length - 1}</small>}
          </button>
          <button className="visit-icon" onClick={() => openSheet('memories')} aria-label={zh ? '查看这里的全部回忆' : 'All memories here'}><BookOpenText size={19} /></button>
        </div>
        {source && <button className="visit-sound" aria-pressed={media.audioOn} onClick={media.toggleAudio}>
          {media.audioOn ? <SpeakerHigh size={17} /> : <SpeakerSlash size={17} />}<span>{media.audioFailed ? (zh ? '重试声音' : 'Retry sound') : media.audioOn ? (zh ? '声音已开' : 'Sound on') : (zh ? '听听这里' : 'Listen here')}</span>
        </button>}
      </footer>
      {(sceneFailed || media.videoFailed || media.audioFailed) && <p className="visit-media-note" role="status">{media.audioFailed ? (zh ? '声音暂未加载，仍可继续漫游。' : 'Sound is unavailable. You can keep exploring.') : sceneFailed ? (zh ? '风景暂未加载，仍可相见和翻看回忆。' : 'Scenery is unavailable. People and memories are still here.') : (zh ? '动态暂未加载，已保留静态风景。' : 'Showing the still scenery for now.')}</p>}
    </div>

    {sheet && <Sheet dark onClose={closeSheet} title={sheet === 'people' ? t('world.together') : sheet === 'memories' ? (zh ? '留在这里的回忆' : 'Memories kept here') : t(`world.${world}`)}>
      {sheet === 'about' && <div className="visit-about"><p>{t(`world.${world}.law`)}</p><p>{t(`world.${world}.lore`)}</p><button className="visit-text-action" onClick={() => { closeSheet(); enter() }}>{word(place.invitation)}<ArrowUpRight size={18} /></button></div>}
      {sheet === 'people' && <div className="visit-people">
        {!residents.length && <div className="visit-sheet-empty"><p>{zh ? '这里还没有你认识的人。带着一段记忆，去寻找 TA。' : 'No one you know is here yet. Start with a memory.'}</p><button className="visit-text-action" onClick={onSeek}>{t('atlas.seek')}<ArrowUpRight size={18} /></button></div>}
        {residents.map(person => <div key={person.id} className="visit-resident">
          <button className="visit-resident-select" aria-pressed={active?.id === person.id} onClick={() => selectPerson(person.id)}><Lens world={world} avatar={person.avatar} name={person.name} size={40} dark /><span><strong>{person.name}</strong><small>{person.relation}</small></span>{active?.id === person.id && <I.Check className="h-4 w-4" />}</button>
          <button className="visit-icon" onClick={() => onOpen(person.id)} aria-label={zh ? `查看${person.name}的资料` : `View ${person.name}'s profile`}><I.More className="h-5 w-5" /></button>
        </div>)}
        {residents.length > 1 && <button className="visit-gather" onClick={onGather}><I.Gather className="h-5 w-5" />{t('world.gather')}<ArrowUpRight size={18} /></button>}
      </div>}
      {sheet === 'memories' && <div className="visit-memory-index">
        {!memories.length && <div className="visit-sheet-empty"><p>{zh ? '这里还没有珍藏的回忆。可以先去说说话。' : 'No memories saved here yet. Start with a conversation.'}</p><button className="visit-text-action" onClick={() => active ? onTalk(active.id) : onSeek()}>{active ? (zh ? '去说说话' : 'Start a conversation') : t('atlas.seek')}<ArrowUpRight size={18} /></button></div>}
        {memories.map(({ person, memory: item }) => <button className="visit-memory-row" key={`${person.id}-${item.id}`} onClick={() => openMemory(person, item)}><span><small>{person.name}</small><strong>{item.title}</strong><p>{item.body}</p></span><I.Chevron className="h-4 w-4" /></button>)}
      </div>}
    </Sheet>}
  </div>
}
