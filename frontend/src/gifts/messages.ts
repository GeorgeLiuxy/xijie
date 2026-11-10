import type { Chats, Msg, Person } from '../model'
import { isZh, type Lang } from '../i18n'
import { receiptMatchesPerson, targetMatchesPerson } from './store'
import type { GiftReceipt, GiftState } from './types'

type GiftMessage = Extract<Msg, { kind: 'gift' }>

export function appendGiftMessages(chats: Chats, people: Person[], ledger: GiftState, owner: string, lang: Lang, notice: string): Chats {
  let next = chats
  for (const [key, messages] of Object.entries(chats)) {
    if (!messages.some(message => message.kind === 'gift')) continue
    if (next === chats) next = { ...chats }
    next[key] = messages.filter(message => message.kind !== 'gift')
  }
  const zh = isZh(lang)
  for (const person of people) {
    const events: GiftMessage[] = []
    for (const [index, receipt] of ledger.receipts.entries()) {
      if (!receipt.personaReply || !receiptMatchesPerson(receipt, person)) continue
      const first = receipt.lines[0]
      events.push({ id: -(index * 2 + 1), kind: 'gift', owner, direction: 'sent', giftId: receipt.id, at: receipt.createdAt,
        time: clock(receipt.createdAt, lang),
        text: `${zh ? '[礼物] 送出' : '[Gift] Sent'} ${zh ? first.snapshot.name : first.snapshot.en} ×${first.quantity}${receipt.note ? ' · ' + receipt.note : ''}` })
    }
    for (const [index, gift] of (ledger.received ?? []).entries()) {
      if (!targetMatchesPerson(gift.from, person)) continue
      const first = gift.lines[0]
      events.push({ id: -(index * 2 + 2), kind: 'gift', owner, direction: 'received', giftId: gift.id, at: gift.createdAt,
        time: clock(gift.createdAt, lang),
        text: `${zh ? '[礼物] 收到' : '[Gift] Received'} ${zh ? first.snapshot.name : first.snapshot.en} ×${first.quantity}${gift.note ? ' · ' + gift.note : ''}` })
    }
    const key = String(person.id)
    const existing = (chats[key] ?? []).filter(message => message.kind !== 'gift')
    if (!events.length) continue
    const intro: Msg[] = existing.length ? existing : [
      { id: 0, kind: 'note', text: notice },
      { id: 1, kind: 'him', text: person.greeting, time: clock(person.foundAt ?? events[0].at ?? Date.now(), lang) },
    ]
    if (next === chats) next = { ...chats }
    // Receipt arrays are append-only. Negative IDs keep message search anchors
    // stable without writing a second copy of gifts into the shared chat store.
    next[key] = [...intro, ...events].sort((a, b) => (a.at ?? -Infinity) - (b.at ?? -Infinity))
  }
  return next
}

function clock(at: number, lang: Lang) {
  return new Date(at).toLocaleTimeString(isZh(lang) ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' })
}

export function personaReturn(receipt: GiftReceipt, lang: Lang): { giftId: string; note: string } {
  const zh = isZh(lang)
  if (receipt.target.audience === 'pet') return { giftId: 'ball', note: zh ? '把常玩的小球轻轻推到了你面前。这次，换我陪你玩。' : 'A favorite ball is nudged towards you. This time, let me keep you company.' }
  if (['paper-crane', 'postcard'].includes(receipt.lines[0].giftId)) return { giftId: 'flowers', note: zh ? '收到你的心意了。把今天的一束花留给你，愿你那边也有好天气。' : 'Your thought arrived. A small bouquet for you, and a wish for good weather on your side.' }
  return { giftId: 'paper-crane', note: zh ? '你的心意，我收好了。这只纸鹤捎回一句话：照顾好自己，有空再来坐坐。' : 'Your gift is here with me. This paper crane carries a note back: take care, and visit whenever you like.' }
}
