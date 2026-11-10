import { WORLD_IDS, fmtDuration, isZh, type Lang, type WorldId, type useI18n } from './i18n'
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
