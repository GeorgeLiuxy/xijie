import { WORLD_IDS, fmtDuration, fmtTime, isZh, type Lang, type WorldId, type useI18n } from './i18n'
import type { ConversationAnchor, ConversationHit } from './serviceConversationSearch'
import type { ConversationSummary } from './serviceConversations'
import type { WorldCard } from './servicePeople'
import type { Chats, Msg, Person } from './model'
import { exchanges } from './conversationHistory'

type Translate = ReturnType<typeof useI18n>['t']
type Exchange = Exclude<Msg, { kind: 'note' }>

export type ConversationRow = {
  key: string
  world: WorldId
  person?: Person
  title: string
  preview: string
  time?: string
  messageId?: number
  anchor?: ConversationAnchor
  conversationId?: string
  worldId?: string
}

/** Service search only trusts API message hits. Summaries remain display text, never search evidence. */
export function serviceConversationRows(people: Person[], chats: Chats, query: string, hits: ConversationHit[], t: Translate, lang: Lang, summaries: ConversationSummary[] = [], worlds: WorldCard[] = []): ConversationRow[] {
  const needle = query.trim().toLocaleLowerCase(lang), zh = isZh(lang)
  const byPerson = new Map(hits.filter(hit => hit.conversationKind !== 'gather').map(hit => [hit.personId, hit]))
  const direct = conversationRows(people, chats, '', t, lang).filter(row => !!row.person).flatMap(row => {
    const person = row.person!, hit = person.serverId ? byPerson.get(person.serverId) : undefined
    if (!hit && ![person.name, person.realName, person.relation, t(`world.${person.world}`)].some(value => value?.toLocaleLowerCase(lang).includes(needle))) return []
    const latest = exchanges(chats[row.key], person.greeting).at(-1)
    return [{ row: hit ? { ...row, preview: (hit.author.kind === 'self' && hit.messageKind !== 'photo' ? (zh ? t('nav.me') + '：' : 'You: ') : '') + hit.excerpt,
      time: fmtTime(lang, new Date(hit.createdAt)), anchor: { conversationId: hit.conversationId, messageId: hit.messageId } } : row,
      activity: hit ? Date.parse(hit.lastActivityAt) : latest?.at ?? -1, id: person.serverId ?? String(person.id) }]
  })
  const byWorld = new Map(worlds.map(world => [world.id, world.code]))
  const byConversation = new Map(hits.filter(hit => hit.conversationKind === 'gather').map(hit => [hit.conversationId, hit]))
  const gather = summaries.filter(summary => summary.kind === 'gather').flatMap(summary => {
    const world = summary.worldId ? byWorld.get(summary.worldId) : undefined
    if (!world || !summary.conversationId) return []
    const title = t('gather.title', { world: t(`world.${world}`) }), hit = byConversation.get(summary.conversationId)
    if (needle && !hit && ![title, summary.title, t(`world.${world}`)].some(value => value.toLocaleLowerCase(lang).includes(needle))) return []
    const author = hit?.author ?? summary.lastMessage?.author
    const prefix = author?.kind === 'self' ? (zh ? t('nav.me') + '：' : 'You: ') : author?.kind === 'persona' ? author.displayName + (zh ? '：' : ': ') : ''
    const at = hit?.createdAt ?? summary.lastMessage?.createdAt
    return [{ row: { key: `g:${world}`, world, title, preview: prefix + (hit?.excerpt ?? summary.lastMessage?.preview ?? ''),
      conversationId: summary.conversationId, worldId: summary.worldId!, ...(at ? { time: fmtTime(lang, new Date(at)) } : {}),
      ...(hit ? { anchor: { conversationId: hit.conversationId, messageId: hit.messageId } } : {}) },
      activity: Date.parse(hit?.lastActivityAt ?? summary.lastActivityAt ?? '') || -1, id: summary.conversationId }]
  })
  // A search may observe a newly created world conversation before the summary poll.
  for (const hit of byConversation.values()) if (!summaries.some(summary => summary.conversationId === hit.conversationId)) {
    const world = hit.worldId ? byWorld.get(hit.worldId) : undefined
    if (!world) continue
    const prefix = hit.author.kind === 'self' ? (zh ? t('nav.me') + '：' : 'You: ') : hit.author.displayName + (zh ? '：' : ': ')
    gather.push({ row: { key: `g:${world}`, world, title: t('gather.title', { world: t(`world.${world}`) }), preview: prefix + hit.excerpt,
      time: fmtTime(lang, new Date(hit.createdAt)), conversationId: hit.conversationId, worldId: hit.worldId!, anchor: { conversationId: hit.conversationId, messageId: hit.messageId } }, activity: Date.parse(hit.lastActivityAt), id: hit.conversationId })
  }
  return [...direct, ...gather].sort((a, b) => b.activity - a.activity || a.id.localeCompare(b.id)).map(item => item.row)
}

function visibleText(msg: Exchange, t: Translate) {
  if (msg.kind === 'photo') return t('talk.photo')
  if (msg.kind === 'call') return t(msg.mode === 'voice' ? 'talk.call.voice' : 'talk.call.video', { d: fmtDuration(msg.secs) })
  return msg.text
}

function excerpt(text: string, matchAt: number, matchLength: number) {
  const start = matchAt > 12 ? matchAt - 6 : 0
  const end = Math.min(text.length, Math.max(start + 60, matchAt + matchLength))
  return (start ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}

export function conversationRows(people: Person[], chats: Chats, query: string, t: Translate, lang: Lang): ConversationRow[] {
  const needle = query.trim().toLocaleLowerCase(lang)
  const rows: { row: ConversationRow; activity: number }[] = []
  const names = new Map(people.map(person => [person.id, person.name]))
  const zh = isZh(lang)
  function collect(world: WorldId, person?: Person) {
    if (!person && !people.some(contact => contact.world === world)) return
    const key = person ? String(person.id) : `g:${world}`
    const worldName = t(`world.${world}`)
    const title = person?.name ?? t('gather.title', { world: worldName })
    const thread = exchanges(chats[key], person?.greeting)
    const latest = thread[thread.length - 1]
    if (!latest && !person && (!needle || people.filter(p => p.world === world).length < 2)) return
    const metadata = person ? [person.name, person.realName, person.relation, worldName] : [title]
    let shown = latest
    let preview = ''
    let messageId: number | undefined
    if (needle) {
      for (let i = thread.length - 1; i >= 0; i--) {
        const text = visibleText(thread[i], t)
        const at = text.toLocaleLowerCase(lang).indexOf(needle)
        if (at < 0) continue
        shown = thread[i]
        messageId = shown.id
        preview = excerpt(text, at, needle.length)
        break
      }
      if (messageId == null && !metadata.some(v => v?.toLocaleLowerCase(lang).includes(needle))) return
    }
    if (shown) {
      const speaker = shown.kind === 'him' || (shown.kind === 'gift' && shown.direction === 'received')
        ? (person ? '' : names.get(shown.kind === 'him' ? shown.who ?? -1 : -1) ?? (zh ? '成员' : 'Member'))
        : (zh ? t('nav.me') : 'You')
      const prefix = speaker ? speaker + (zh ? '：' : ': ') : ''
      preview = prefix + (preview || visibleText(shown, t))
    } else if (person) {
      preview = needle
        ? [person.realName, person.relation, worldName]
          .filter((value, i, arr) => value && value !== title && arr.indexOf(value) === i).join(' · ')
        : `${worldName} · ${zh ? '说第一句话' : 'Say hello'}`
    }
    rows.push({
      row: { key, world, person, title, preview, time: shown?.time, ...(messageId == null ? {} : { messageId }) },
      activity: latest?.at ?? latest?.id ?? -1,
    })
  }
  for (const person of people) collect(person.world, person)
  for (const world of WORLD_IDS) collect(world)
  return rows.sort((a, b) => b.activity - a.activity).map(item => item.row)
}
