import { useMemo, useRef, useState } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { Lens } from '../fx'
import { isZh, useI18n, WORLD_IDS, type WorldId } from '../i18n'
import type { Person } from '../model'
import { I } from '../ui'
import { WORLDS } from '../worlds'
import { MemoryReader } from '../MemoryReader'
import { ContextSheet } from '../mobile/ContextSheet'
import { searchContacts, suggestClues } from './memorySearch'
import { resultPage, searchWorlds } from './worldSearch'
import './atlas-search.css'

type Props = {
  people: Person[]
  query: string
  focusInput?: boolean
  currentWorld?: WorldId | 'unknown'
  onQuery: (query: string) => void
  onClose: () => void
  onOpen: (id: number) => void
  onSeek: (clue?: string) => void
  onWorld: (world: WorldId | 'unknown') => void
}

export function AtlasSearch({ people, query, currentWorld, onQuery, onClose, onOpen, onSeek, onWorld }: Props) {
  const { t, lang } = useI18n()
  const zh = isZh(lang)
  const field = useRef<HTMLInputElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const worldHeading = useRef<HTMLHeadingElement>(null)
  const contactHeading = useRef<HTMLHeadingElement>(null)
  const [connectedOnly, setConnectedOnly] = useState(false)
  const [pages, setPages] = useState({ key: '', worlds: 0, contacts: 0 })
  const [reading, setReading] = useState<{ personId: number; memoryId: number; scrollTop: number } | null>(null)
  const readingPerson = reading ? people.find(person => person.id === reading.personId) : undefined
  const readingMemory = readingPerson?.memories?.find(memory => memory.id === reading?.memoryId)
  const clue = query.trim()
  const pageKey = JSON.stringify([clue, connectedOnly, lang])
  const worlds = useMemo(() => WORLD_IDS.map(id => ({ id, name: t(`world.${id}`), law: t(`world.${id}.law`), code: WORLDS[id].code, thumb: WORLDS[id].thumb })), [t])
  const connectedCount = useMemo(() => {
    const inhabited = new Set(people.map(person => person.world))
    return worlds.filter(world => inhabited.has(world.id)).length
  }, [worlds, people])
  const worldMatches = useMemo(() => searchWorlds(worlds, people, clue, { connectedOnly, currentWorld }), [worlds, people, clue, connectedOnly, currentWorld])
  const suggestions = useMemo(() => suggestClues(people), [people])
  const matches = useMemo(() => searchContacts(people, clue, world => t(`world.${world}`)), [people, clue, t])
  const worldPage = resultPage(worldMatches, pages.key === pageKey ? pages.worlds : 0, 24)
  const contactPage = resultPage(matches, pages.key === pageKey ? pages.contacts : 0, 12)
  const empty = !!clue && !worldMatches.length && !matches.length
  const title = zh ? '全部世界' : 'All worlds'
  const changePage = (group: 'worlds' | 'contacts', page: number) => {
    setPages(previous => ({ key: pageKey, worlds: previous.key === pageKey ? previous.worlds : 0,
      contacts: previous.key === pageKey ? previous.contacts : 0, [group]: page }))
    requestAnimationFrame(() => {
      const heading = (group === 'worlds' ? worldHeading : contactHeading).current
      heading?.focus({ preventScroll: true })
      heading?.scrollIntoView({ block: 'start' })
    })
  }
  const showAll = () => { setConnectedOnly(false); onQuery(''); field.current?.blur() }
  const selectWorld = (id: WorldId | 'unknown') => { field.current?.blur(); onWorld(id) }
  const closeMemory = () => {
    const scrollTop = reading?.scrollTop
    setReading(null)
    requestAnimationFrame(() => {
      if (scroller.current && scrollTop !== undefined) scroller.current.scrollTop = scrollTop
    })
  }

  const directory = <ContextSheet label={title} onClose={onClose} className="atlas-directory-sheet">
    <section id="atlas-clues" className="atlas-directory" aria-labelledby="atlas-directory-title">
      <header className="atlas-directory-head">
        <h2 id="atlas-directory-title">{title}</h2>
        <button className="atlas-clue-close" data-context-close onClick={onClose} aria-label={t('common.close')}><I.X /></button>
      </header>
      <form className="atlas-directory-search" role="search" onSubmit={event => { event.preventDefault(); field.current?.blur() }}>
        <div className="atlas-clue-field">
          <MagnifyingGlass size={18} weight="regular" aria-hidden />
          <input ref={field} type="search" enterKeyHint="search" value={query} onChange={event => onQuery(event.currentTarget.value)}
            aria-label={zh ? '搜索世界、编号、人物或记忆' : 'Search worlds, codes, people or memories'}
            placeholder={zh ? '世界、编号、人物或记忆' : 'World, code, person or memory'} />
          {query && <button type="button" onClick={() => { onQuery(''); field.current?.focus() }} aria-label={zh ? '清除搜索' : 'Clear search'}><I.X /></button>}
        </div>
      </form>
      <div ref={scroller} className="atlas-directory-scroll scroll-quiet">
        <div className="atlas-directory-filters" role="group" aria-label={zh ? '筛选世界' : 'Filter worlds'}>
          <button aria-pressed={!connectedOnly} onClick={() => setConnectedOnly(false)}>{title}<span>{worlds.length}</span></button>
          <button aria-pressed={connectedOnly} onClick={() => setConnectedOnly(true)}>{zh ? '有联系人' : 'With contacts'}<span>{connectedCount}</span></button>
        </div>
        {clue && <p className="atlas-directory-count" role="status">{zh ? `${worldMatches.length} 个世界 · ${matches.length} 位联系人` : `${worldMatches.length} worlds · ${matches.length} contacts`}</p>}
        <section className="atlas-directory-group" aria-labelledby="atlas-world-results">
          <h3 ref={worldHeading} tabIndex={-1} id="atlas-world-results">{zh ? '世界' : 'Worlds'}</h3>
          {worldPage.items.map(({ world, residentCount }) => <button className="atlas-world-row" key={world.id} onClick={() => selectWorld(world.id)} aria-current={world.id === currentWorld ? 'location' : undefined}>
            <img className="atlas-world-thumb" src={world.thumb} alt="" loading="lazy" decoding="async" />
            <span className="atlas-world-copy">
              <span className="atlas-world-name"><strong>{world.name}</strong><small>{world.code}</small></span>
              <span className="atlas-world-law">{world.law}</span>
              <span className="atlas-world-meta">{zh ? `${residentCount} 位联系人` : `${residentCount} ${residentCount === 1 ? 'contact' : 'contacts'}`}{world.id === currentWorld && <b>{zh ? '当前世界' : 'Current world'}</b>}</span>
            </span>
            <span className="atlas-directory-chevron" aria-hidden><I.Chevron /></span>
          </button>)}
          {!worldMatches.length && !empty && <p className="atlas-clue-label">{connectedOnly ? (zh ? '这里还没有符合条件的世界。' : 'No worlds with contacts match yet.') : (zh ? '没有匹配的世界，试试下方的联系人线索。' : 'No matching worlds. Try the contact clues below.')}</p>}
          {!clue && connectedOnly && !worldMatches.length && <button className="atlas-directory-action" onClick={showAll}>{zh ? '看看全部世界' : 'Show all worlds'}</button>}
          {worldPage.pages > 1 && <PageControls group={zh ? '世界' : 'Worlds'} result={worldPage} zh={zh} onPage={page => changePage('worlds', page)} />}
          {!clue && !connectedOnly && <button className="atlas-world-row atlas-world-unknown" onClick={() => selectWorld('unknown')} aria-current={currentWorld === 'unknown' ? 'location' : undefined}>
            <span className="atlas-world-symbol" aria-hidden><I.Beacon /></span>
            <span className="atlas-world-copy"><span className="atlas-world-name"><strong>{t('atlas.unknown.title')}</strong></span><span className="atlas-world-law">{t('atlas.unknown.desc')}</span>{currentWorld === 'unknown' && <span className="atlas-world-meta"><b>{zh ? '当前坐标' : 'Current coordinates'}</b></span>}</span>
            <span className="atlas-directory-chevron" aria-hidden><I.Chevron /></span>
          </button>}
        </section>
        {clue && matches.length > 0 && <section className="atlas-directory-group" aria-labelledby="atlas-contact-results">
          <h3 ref={contactHeading} tabIndex={-1} id="atlas-contact-results">{zh ? '联系人和记忆' : 'People and memories'}</h3>
          {contactPage.items.map(({ person, evidence, memoryId }) => <button className="atlas-clue-hit" key={person.id} aria-haspopup={memoryId === undefined ? undefined : 'dialog'} onClick={event => {
            field.current?.blur()
            if (memoryId === undefined) { onOpen(person.id); return }
            event.currentTarget.focus({ preventScroll: true })
            setReading({ personId: person.id, memoryId, scrollTop: scroller.current?.scrollTop ?? 0 })
          }}>
            <Lens world={person.world} name={person.name} avatar={person.avatar} size={44} dark />
            <span className="atlas-clue-copy"><strong>{person.name}</strong><small>{t(`world.${person.world}`)}</small><span>{evidence}</span></span>
            {memoryId === undefined
              ? <span className="atlas-directory-chevron" aria-hidden><I.Chevron /></span>
              : <span className="atlas-clue-read-label">{zh ? '读原文' : 'Read original'}</span>}
          </button>)}
          {contactPage.pages > 1 && <PageControls group={zh ? '联系人' : 'Contacts'} result={contactPage} zh={zh} onPage={page => changePage('contacts', page)} />}
        </section>}
        {empty && <div className="atlas-directory-empty">
          <p>{zh ? '还没有找到这条线索。' : 'No matches for this clue yet.'}</p>
          <button className="atlas-directory-action" onClick={showAll}>{zh ? '清除搜索，看看全部世界' : 'Clear search and show all worlds'}</button>
          <button className="atlas-clue-seek btn-light" onClick={() => onSeek(clue)}><I.Beacon />{zh ? '用这条线索寻找 TA' : 'Find someone with this clue'}</button>
        </div>}
        {!clue && <section className="atlas-directory-group" aria-labelledby="atlas-memory-suggestions">
          <h3 id="atlas-memory-suggestions">{zh ? '记忆线索' : 'Memory clues'}</h3>
          <p className="atlas-clue-label">{people.length ? (suggestions.length ? (zh ? '从一段已保存的记忆开始' : 'Start with a saved memory') : (zh ? '试试 TA 的称呼、关系或熟悉的地点。' : 'Try their name, relationship or a familiar place.')) : (zh ? '星图里还没有联系人。' : 'Your atlas has no contacts yet.')}</p>
          {suggestions.length > 0 && <div className="atlas-clue-suggestions">{suggestions.map(suggestion => <button key={suggestion} onClick={() => { onQuery(suggestion); field.current?.blur() }}>{suggestion}</button>)}</div>}
          {!people.length && <button className="atlas-clue-seek btn-light" onClick={() => onSeek()}><I.Beacon />{t('home.menu.seek')}</button>}
        </section>}
      </div>
    </section>
  </ContextSheet>

  return <>
    <div hidden={!!readingMemory}>{directory}</div>
    {readingPerson && readingMemory && <MemoryReader memory={readingMemory} personName={readingPerson.name} onClose={closeMemory} />}
  </>
}

function PageControls({ group, result, zh, onPage }: { group: string; result: { page: number; pages: number; start: number; end: number; total: number }; zh: boolean; onPage: (page: number) => void }) {
  return <nav className="atlas-directory-pages" aria-label={zh ? `${group}分页` : `${group} pages`}>
    <button disabled={result.page === 0} onClick={() => onPage(result.page - 1)}>{zh ? '上一页' : 'Previous'}</button>
    <span role="status">{result.start}–{result.end} / {result.total}</span>
    <button disabled={result.page + 1 >= result.pages} onClick={() => onPage(result.page + 1)}>{zh ? '下一页' : 'Next'}</button>
  </nav>
}
