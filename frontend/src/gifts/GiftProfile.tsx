import { Gift } from '@phosphor-icons/react'
import { isZh, useI18n } from '../i18n'
import type { Person } from '../model'
import { I } from '../ui'
import { useArrivalClock, useGiftState } from './GiftLedger'
import { hasArrived, receiptMatchesPerson, targetMatchesPerson } from './store'
import type { GiftOpenOptions } from './types'
import './gift-messages.css'

export function GiftProfile({ owner, person, onOpen }: {
  owner: string
  person: Person
  onOpen: (options?: GiftOpenOptions) => void
}) {
  const { lang } = useI18n()
  const zh = isZh(lang)
  const state = useGiftState(owner)
  const receipts = state.receipts.filter(receipt => receiptMatchesPerson(receipt, person))
  const received = (state.received ?? []).filter(gift => targetMatchesPerson(gift.from, person))
  const unopened = received.filter(gift => gift.openedAt == null).length
  const now = useArrivalClock(receipts)
  const latest = receipts[receipts.length - 1]
  const pending = latest && !hasArrived(latest, now)
  const value = receipts.length || received.length
    ? (zh ? `送 ${receipts.length} · 收 ${received.length}` : `${receipts.length} sent · ${received.length} received`)
    : (zh ? '寄一份' : 'Send a gift')
  const tab = unopened || (received.length && !receipts.length) ? 'received' : latest ? 'receipts' : 'catalog'

  return <button onClick={() => onOpen({ tab })}
    className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-black/[0.03]">
    <span className="h-9 w-9 shrink-0 rounded-xl bg-sky/12 text-sky-deep flex items-center justify-center"><Gift weight="duotone" className="h-5 w-5" aria-hidden /></span>
    <span className="min-w-0 flex-1 text-[15.5px] text-ink">{zh ? '礼物' : 'Gifts'}</span>
    <span className="text-[13.5px] text-muted">{value}{unopened > 0 ? <em className="gm-profile-unopened">{zh ? `${unopened} 待拆` : `${unopened} unopened`}</em> : pending && (zh ? ' · 投递中' : ' · In transit')}</span>
    <I.Chevron className="h-4 w-4 text-muted" />
  </button>
}
