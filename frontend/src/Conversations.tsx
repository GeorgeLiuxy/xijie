import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Bell, Gift, MagnifyingGlass, Planet, Sparkle, Ticket, UserPlus } from '@phosphor-icons/react'
import { conversationRows, serviceConversationRows } from './conversationList'
import { useConversationSearch, type ConversationAnchor, type SearchSession } from './serviceConversationSearch'
import { useUnreadLetterReply, type ConversationSummary } from './serviceConversations'
import { readConversationWorlds, type WorldCard } from './servicePeople'
import { useHomeGiftActivity } from './gifts/GiftActivity'
import { Lens } from './fx'
import { WORLD_IDS, fmtTime, isZh, useI18n, type WorldId } from './i18n'
import type { Chats, Person } from './model'
import { I, NightCtx, haptic, useStatusTone } from './ui'
import { useNativeBack } from './mobile/back'
import { ContextSheet } from './mobile/ContextSheet'
import './conversations.css'

export type HomeRecommendation = 'atlas' | 'invite'

const recommendations = {
  atlas: {
    Icon: Planet,
    zh: { category: '新功能', title: '星图可以搜记忆了', action: '去体验' },
    en: { category: 'New feature', title: 'Search memories in the Atlas', action: 'Try it' },
  },
  invite: {
    Icon: Ticket,
    zh: { category: '邀请有礼', title: '邀请朋友，双方得赠礼券', action: '去邀请' },
    en: { category: 'Invite & earn', title: 'A voucher for you both', action: 'Invite' },
  },
}

type HomeProps = {
  people: Person[]
  chats: Chats
  serviceAccount?: boolean
  conversationSummaries?: ConversationSummary[]
  conversationWorlds?: WorldCard[]
  searchSession?: SearchSession
  peopleLoad?: 'loading' | 'ready' | 'error'
  onRetryPeople?: () => void
  canSeek?: boolean
  giftOwner: string
  query: string
  onQuery: (value: string) => void
  onOpen: (id: number, messageId?: number, anchor?: ConversationAnchor) => void
  onGather: (world: WorldId, messageId?: number, anchor?: ConversationAnchor, worldId?: string) => void
  onSeek: () => void
  onLetter: (id: number) => void
  onReadLetterReply?: (personId: number, letterId: string) => void
  onGuestTransfer?: () => void
  onGiftActivity: (personId: number, goalId?: string, receiptId?: string) => void
  onGifts?: () => void
  onInvite?: () => void
  onSystem?: () => void
  systemCount?: number
  systemPreview?: string
  invitePromotion?: { unread: boolean; onRead: () => void }
  onUpdates?: () => void
}

function SearchField({ value, onChange, label, placeholder, clear, autoFocus = false }: {
  value: string; onChange: (value: string) => void; label: string; placeholder?: string; clear: string; autoFocus?: boolean
}) {
  const field = useRef<HTMLInputElement>(null)
  return <div className="meet-search">
    <MagnifyingGlass size={19} weight="regular" aria-hidden />
    <input type="search" ref={field} autoFocus={autoFocus} value={value} aria-label={label} enterKeyHint="search"
      placeholder={placeholder ?? label} onChange={e => onChange(e.currentTarget.value)} onKeyDown={event => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) event.currentTarget.blur()
      }} />
    {value && <button className="meet-clear" aria-label={clear} onClick={() => { onChange(''); field.current?.focus() }}>
      <I.X />
    </button>}
  </div>
}

type Choice = 'message' | 'letter' | 'gather' | 'gift'

function matchText(text: string, query: string) {
  const needle = query.trim()
  if (!needle) return text
  const start = text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase())
  if (start < 0) return text
  const end = start + needle.length
  return <>{text.slice(0, start)}<mark>{text.slice(start, end)}</mark>{text.slice(end)}</>
}

function HomeGiftActivity({ giftOwner, people, chats, searching, onGiftActivity }: Pick<HomeProps, 'giftOwner' | 'people' | 'chats' | 'onGiftActivity'> & { searching: boolean }) {
  const activity = useHomeGiftActivity(giftOwner, people)
  if (searching || !activity) return null
  if (activity.receiptId && chats[String(activity.personId)]?.some(
    message => message.kind === 'gift' && message.direction === 'sent' && message.giftId === activity.receiptId,
  )) return null
  return <button className="meet-activity" onClick={() => onGiftActivity(activity.personId, activity.goalId, activity.receiptId)}>
    <Gift className="meet-activity-icon" aria-hidden /><span>{activity.detail}</span><I.Chevron className="meet-chevron" />
  </button>
}

export function Home({ people, chats, serviceAccount = false, conversationSummaries = [], conversationWorlds = [], searchSession, peopleLoad = 'ready', onRetryPeople, canSeek, giftOwner, query, onQuery, onOpen, onGather, onLetter, onReadLetterReply, onGuestTransfer, onSeek, onGiftActivity, onInvite, onSystem, systemCount = 0, systemPreview: serviceSystemPreview, invitePromotion, onUpdates }: HomeProps) {
  const { t, lang } = useI18n()
  const zh = isZh(lang)
  const night = useContext(NightCtx)
  const invitation = invitePromotion
  useStatusTone(night ? 'light' : 'dark')
  const [searchMode, setSearchMode] = useState<'closed' | 'open' | 'restored'>(() => query.trim() ? 'restored' : 'closed')
  const [actions, setActions] = useState(false)
  const [choice, setChoice] = useState<Choice | null>(null)
  const [recipientQuery, setRecipientQuery] = useState('')
  const actionGroup = useRef<HTMLDivElement>(null)
  const nativeBackRoot = useRef<HTMLElement>(null)
  const homeList = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const searchOpener = useRef<HTMLButtonElement>(null)
  const choiceFrame = useRef(0)
  const choosing = useRef(false)
  const search = useConversationSearch(searchSession, query, zh ? 'zh-CN' : 'en')
  const [searchWorlds, setSearchWorlds] = useState<{ key: string; worlds: WorldCard[]; failed?: boolean }>({ key: '', worlds: [] })
  const [worldRetry, setWorldRetry] = useState(0)
  const worldKey = JSON.stringify([searchSession?.accountId, searchSession?.sessionId, query, search.hits.filter(hit => hit.conversationKind === 'gather').map(hit => hit.worldId)])
  const missingWorlds = search.hits.flatMap(hit => hit.conversationKind === 'gather' && hit.worldId && !conversationWorlds.some(world => world.id === hit.worldId) ? [hit.worldId] : [])
  useEffect(() => {
    if (!searchSession || !missingWorlds.length) return
    const controller = new AbortController()
    void readConversationWorlds(searchSession.sessionId, controller.signal, missingWorlds).then(worlds => {
      if (!controller.signal.aborted) setSearchWorlds({ key: worldKey, worlds })
    }).catch(() => { if (!controller.signal.aborted) setSearchWorlds({ key: worldKey, worlds: [], failed: true }) })
    return () => controller.abort()
  }, [worldKey, missingWorlds.join(','), worldRetry])
  const worldError = !!missingWorlds.length && searchWorlds.key === worldKey && searchWorlds.failed
  const worldsReady = !missingWorlds.length || searchWorlds.key === worldKey && !searchWorlds.failed
  const worlds = searchWorlds.key === worldKey ? [...conversationWorlds, ...searchWorlds.worlds.filter(world => !conversationWorlds.some(value => value.id === world.id))] : conversationWorlds
  const rows = useMemo(() => serviceAccount
    ? serviceConversationRows(people, chats, query, search.hits, t, lang, conversationSummaries, worlds)
    : conversationRows(people, chats, query, t, lang), [serviceAccount, people, chats, query, search.hits, t, lang, conversationSummaries, worlds])
  const circles = WORLD_IDS.filter(world => people.filter(p => p.world === world).length > 1)
  const searchOpen = searchMode !== 'closed'
  const searching = Boolean(query.trim())
  const unreadLetter = useUnreadLetterReply(serviceAccount && onReadLetterReply && peopleLoad === 'ready' && people.length ? searchSession?.sessionId : undefined, searchSession?.onUnauthorized)
  const letterWriter = unreadLetter ? people.find(person => person.serverId === unreadLetter.personId) : undefined
  const searchReady = !serviceAccount || !searching || search.status === 'ready' && worldsReady
  const systemTitle = zh ? '系统通知' : 'System notices'
  const systemPreview = serviceSystemPreview ?? (zh ? '基础赠礼券已到账' : 'A standard gift voucher was added')
  const showSystem = Boolean(onSystem && systemCount > 0 && [systemTitle, systemPreview].some(value => value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
  const rowCount = rows.length + Number(showSystem)
  const write = zh ? '写消息' : 'Write a message'
  const clear = zh ? '清除搜索' : 'Clear search'
  const searchLabel = zh ? '搜索人物或消息' : 'Search people or messages'
  const searchFieldLabel = zh ? '搜索名字、关系、世界或消息' : 'Search names, relationships, worlds or messages'
  const moreLabel = zh ? '新建与更多操作' : 'New and more actions'
  const moreWithInvite = zh ? '新建与更多操作，有邀请奖励' : 'New and more actions, invitation rewards available'

  useEffect(() => {
    if (!actions) return
    function dismiss(event: PointerEvent) {
      if (!actionGroup.current?.contains(event.target as Node)) setActions(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [actions])
  useEffect(() => () => cancelAnimationFrame(choiceFrame.current), [])
  useEffect(() => { homeList.current?.scrollTo({ top: 0 }) }, [query])

  function closeSearch() {
    setSearchMode('closed')
    if (query) onQuery('')
    requestAnimationFrame(() => searchOpener.current?.focus({ preventScroll: true }))
  }
  function choose(mode: Choice) {
    setRecipientQuery('')
    setActions(false)
    setChoice(mode)
  }
  function finishChoice(next?: () => void) {
    if (choosing.current) return
    choosing.current = true
    setChoice(null)
    choiceFrame.current = requestAnimationFrame(() => {
      choosing.current = false
      if (!nativeBackRoot.current?.isConnected || nativeBackRoot.current.closest('[hidden], [inert]')) return
      opener.current?.focus({ preventScroll: true })
      next?.()
    })
  }

  useNativeBack(() => {
    if (actions) {
      setActions(false)
      requestAnimationFrame(() => opener.current?.focus({ preventScroll: true }))
    } else if (searchOpen) closeSearch()
    else return false
    return true
  }, actions || searchOpen, 10, nativeBackRoot)

  let picker: React.ReactNode = null
  if (choice) {
    const needle = recipientQuery.trim().toLocaleLowerCase()
    const matches = (...terms: (string | undefined)[]) => terms.some(term => term?.toLocaleLowerCase().includes(needle))
    const recipients = choice === 'gather' ? [] : people.filter(p => matches(p.name, p.realName, p.relation, t(`world.${p.world}`)))
    const gatherings = choice === 'message' || choice === 'gather' ? circles.filter(w => matches(t('gather.title', { world: t(`world.${w}`) }))) : []
    const selectPerson = choice === 'gift' ? onGiftActivity : choice === 'letter' ? onLetter : onOpen
    const title = { message: write, letter: t('home.pick'), gather: t('home.pickWorld'), gift: zh ? '选择收件人' : 'Choose a recipient' }[choice]
    picker = <ContextSheet label={title} onClose={() => finishChoice()} className="meet-picker-sheet">
    <section className="meet-page meet-picker">
      <div className="meet-picker-head">
        <button className="meet-back glass-light" data-context-close onClick={() => finishChoice()} aria-label={t('common.back')}><I.Back /></button>
        <h1>{title}</h1>
      </div>
      <SearchField value={recipientQuery} onChange={setRecipientQuery} clear={clear}
        label={choice === 'gather' ? (zh ? '搜索世界' : 'Search worlds') : (zh ? '搜索名字、关系或世界' : 'Search names, relationships or worlds')} />
      <div className="meet-list scroll-quiet">
        {recipients.length > 0 && <h2 className="meet-label">{zh ? '联系人' : 'Contacts'}</h2>}
        {recipients.map(p => <button key={p.id} className="meet-row" onClick={() => finishChoice(() => selectPerson(p.id))}>
          <Lens world={p.world} name={p.name} avatar={p.avatar} size={46} />
          <span className="meet-copy"><b>{p.name}</b><small>{[p.relation, t(`world.${p.world}`)].filter(Boolean).join(' · ')}</small></span>
          <I.Chevron className="meet-chevron" />
        </button>)}
        {gatherings.length > 0 && <h2 className="meet-label">{t('home.menu.gather')}</h2>}
        {gatherings.map(world => <button key={world} className="meet-row" onClick={() => finishChoice(() => onGather(world))}>
          <span className="meet-circle"><I.Gather /></span>
          <span className="meet-copy"><b>{t(`world.${world}`)}</b></span><I.Chevron className="meet-chevron" />
        </button>)}
        {choice === 'gift' && !people.length ? <div className="meet-empty">
          <h2>{zh ? '还没有收件人' : 'No recipients yet'}</h2>
          <p>{zh ? '先找到想送礼的人，再回来挑选。' : 'Find someone first, then choose their gift.'}</p>
          <button className="meet-cta btn-dark" onClick={() => finishChoice(onSeek)}>{t('home.menu.seek')}<I.Chevron /></button>
        </div> : !recipients.length && !gatherings.length && <p className="meet-hint" role="status">{zh ? '没有找到匹配的结果。' : 'No matching results.'}</p>}
      </div>
    </section>
    </ContextSheet>
  }

  return <><section ref={nativeBackRoot} className="meet-page" inert={!!choice} onKeyDown={event => {
    if (searchOpen && event.key === 'Escape' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      event.preventDefault()
      closeSearch()
    }
  }}>
    <header className="meet-hero">
      <div className="meet-wash" aria-hidden="true" />
      {searchOpen ? <div className="meet-search-bar" role="search" aria-label={searchLabel}>
        <SearchField value={query} onChange={onQuery} clear={clear} autoFocus={searchMode === 'open'}
          placeholder={searchLabel}
          label={searchFieldLabel} />
        <button className="meet-search-cancel" autoFocus={searchMode === 'restored'} onClick={closeSearch}>{t('common.cancel')}</button>
      </div> : <div className="meet-heading">
        <div className="meet-title"><h1>{t('nav.meet')}</h1></div>
        <div className="meet-tools">
        <button ref={searchOpener} className="meet-search-toggle" aria-label={searchLabel} onClick={() => {
          setActions(false)
          setSearchMode('open')
        }}><MagnifyingGlass size={22} weight="regular" aria-hidden /></button>
        <div className="meet-actions" ref={actionGroup}
          onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setActions(false) }}
          onKeyDown={e => { if (actions && e.key === 'Escape') { setActions(false); opener.current?.focus() } }}>
          <button ref={opener} className="meet-add" aria-expanded={actions} aria-controls={actions ? 'meet-actions' : undefined}
            aria-label={invitation?.unread ? moreWithInvite : moreLabel} onClick={() => {
              if (!actions && invitation?.unread) invitation.onRead()
              haptic(6); setActions(!actions)
            }}><I.Plus />{invitation?.unread && <span className="meet-invite-dot" aria-hidden />}</button>
          {actions && <div id="meet-actions" className="meet-menu pop-in">
            {!!people.length && <button onClick={() => choose('message')}><I.Meet />{write}</button>}
            {!!people.length && <button onClick={() => choose('letter')}><I.Mail />{t('home.menu.letter')}</button>}
            {!!circles.length && <button onClick={() => choose('gather')}><I.Gather />{t('home.menu.gather')}</button>}
            <button onClick={onSeek}><I.Beacon />{t('home.menu.seek')}</button>
            <button onClick={() => choose('gift')}><Gift aria-hidden />{zh ? '送礼物' : 'Send a gift'}</button>
            {onInvite && <button onClick={() => {
              setActions(false)
              opener.current?.focus({ preventScroll: true })
              haptic(6); onInvite()
            }}><UserPlus aria-hidden />{invitation ? (zh ? '邀请朋友' : 'Invite friends') : (zh ? '邀友领券' : 'Invite & earn')}
              {invitation && <span className="meet-invite-tag">{zh ? '有礼' : 'Rewards'}</span>}</button>}
            {onUpdates && <button aria-haspopup="dialog" onClick={() => {
              setActions(false)
              opener.current?.focus({ preventScroll: true })
              onUpdates()
            }}><Sparkle aria-hidden />{zh ? '产品动态' : 'What’s new'}</button>}
          </div>}
        </div>
        </div>
      </div>}
    </header>
    <div ref={homeList} className="meet-list meet-home-list scroll-quiet">
      {searching && searchReady && (!serviceAccount || peopleLoad === 'ready' || people.length > 0) && <div className="meet-count" aria-live="polite" aria-atomic="true">
        <h2>{zh ? '搜索结果' : 'Search results'}</h2>
        <span aria-hidden="true" className="meet-rule" /><span>{String(rowCount).padStart(2, '0')}</span>
      </div>}
      {!searching && unreadLetter && letterWriter && onReadLetterReply && <button className="meet-row" onClick={() => onReadLetterReply(letterWriter.id, unreadLetter.letterId)}>
        <span className="meet-circle"><I.Mail aria-hidden /></span>
        <span className="meet-copy"><b>{t('home.row.reply')}</b><small>{zh ? `${letterWriter.name} 的来信 · 打开信匣` : `From ${letterWriter.name} · Open letterbox`}</small></span>
        <span className="meet-time">{fmtTime(lang, new Date(unreadLetter.createdAt))}</span>
      </button>}
      {!searching && onGuestTransfer && <button type="button" className="meet-row" onClick={onGuestTransfer}>
        <span className="meet-circle"><I.Keep aria-hidden /></span>
        <span className="meet-copy"><b>{zh ? '找回访客时写的回忆' : 'Bring back your guest memory'}</b>
          <small>{zh ? '先查看，再决定是否保存到这里' : 'Review it before keeping it here'}</small></span>
      </button>}
      {rows.map(row => <button key={row.key} className="meet-row" onClick={() => row.person ? onOpen(row.person.id, row.messageId, row.anchor) : onGather(row.world, row.messageId, row.anchor, row.worldId)}>
        {row.person ? <Lens world={row.world} avatar={row.person.avatar} name={row.person.name} size={48} />
          : <span className="meet-circle"><I.Gather /></span>}
        <span className="meet-copy"><b>{matchText(row.title, query)}</b><small>{matchText(row.preview, query)}</small></span>
        {row.time && <span className="meet-time">{row.time}</span>}
      </button>)}
      {showSystem && <button className="meet-row" onClick={() => onSystem?.()}>
        <span className="meet-circle"><Bell weight="duotone" aria-hidden /></span>
        <span className="meet-copy"><b>{matchText(systemTitle, query)}</b><small>{matchText(systemPreview, query)}</small></span>
        <I.Chevron className="meet-chevron" />
      </button>}
      {!serviceAccount && <HomeGiftActivity giftOwner={giftOwner} people={people} chats={chats} searching={searching} onGiftActivity={onGiftActivity} />}
      {serviceAccount && searching && !searchReady && peopleLoad === 'ready' && <div className="meet-empty">
        <p role="status">{search.status === 'error' || worldError
          ? search.error === 'INVALID_QUERY' ? (zh ? '搜索词最多 160 个字，请检查后重试。' : 'Use a search phrase of up to 160 characters.')
            : search.error === 'HISTORY_TOO_LARGE' ? (zh ? '历史记录较多，暂时无法完成搜索。' : 'This history is too large to search right now.')
              : (zh ? '暂时无法搜索对话，请稍后重试。' : 'Conversations could not be searched. Try again shortly.')
          : (zh ? '正在搜索对话…' : 'Searching conversations…')}</p>
        {(search.status === 'error' || worldError) && <button className="meet-empty-link" onClick={() => { if (worldError) { setSearchWorlds({ key: '', worlds: [] }); setWorldRetry(value => value + 1) }; search.retry() }}>{zh ? '重试' : 'Try again'}</button>}
      </div>}
      {serviceAccount && peopleLoad === 'loading' && !people.length && <div className="meet-empty">
        <p role="status">{zh ? '正在加载联系人…' : 'Loading contacts…'}</p>
      </div>}
      {serviceAccount && peopleLoad === 'error' && <div className="meet-empty">
        <p role="status">{zh ? '暂时无法加载联系人。' : 'Contacts could not be loaded.'}</p>
        {onRetryPeople && <button className="meet-empty-link" onClick={onRetryPeople}>{zh ? '重试' : 'Try again'}</button>}
      </div>}
      {searchReady && (!serviceAccount || peopleLoad === 'ready') && (searching ? rowCount === 0 : !people.length) && <div className="meet-empty">
        <h2>{searching
          ? (zh ? '没有找到匹配的会话' : 'No matching conversations')
          : (zh ? '还没有联系人' : 'No contacts yet')}</h2>
        {searching && <p>{zh ? '试试另一个名字或消息关键词。' : 'Try a different name or word from a message.'}</p>}
        {!searching && <p>{zh ? '找到 TA 后，就可以在这里聊天。' : 'Find someone to start a conversation here.'}</p>}
        {searching ? <button className="meet-empty-link" onClick={() => onQuery('')}>{clear}</button>
          : <button className="meet-cta btn-dark" onClick={onSeek}>{t('home.menu.seek')}<I.Chevron /></button>}
      </div>}
    </div>
  </section>
  {picker}</>
}

export function ProductUpdates({ onClose, onRecommendation }: { onClose: () => void; onRecommendation: (kind: HomeRecommendation) => void }) {
  const { t, lang } = useI18n()
  const zh = isZh(lang)
  const title = zh ? '产品动态' : 'What’s new'
  return <ContextSheet label={title} onClose={onClose} className="meet-updates-sheet">
    <header className="flex min-h-12 shrink-0 items-center justify-between gap-3 px-5">
      <h2 className="font-serif text-[21px]">{title}</h2>
      <button data-context-close onClick={onClose} aria-label={t('common.close')} className="flex h-11 w-11 items-center justify-center rounded-full text-ink-soft"><I.X className="h-5 w-5" /></button>
    </header>
    <div className="px-5 pb-4">
      {(['atlas', 'invite'] as const).map(kind => {
        const { Icon } = recommendations[kind]
        const item = recommendations[kind][zh ? 'zh' : 'en']
        return <button key={kind} className="meet-row w-full" onClick={() => onRecommendation(kind)}>
          <span className="meet-circle"><Icon weight="duotone" aria-hidden /></span>
          <span className="meet-copy"><b>{item.title}</b><small>{item.category} · {item.action}</small></span>
          <I.Chevron className="meet-chevron" />
        </button>
      })}
    </div>
  </ContextSheet>
}
