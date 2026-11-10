import { isZh, useI18n } from '../i18n'
import type { Person } from '../model'
import { I } from '../ui'
import { GiftIcon } from './GiftIcon'
import { useArrivalClock, useGiftState } from './GiftLedger'
import { hasArrived, receiptMatchesPerson, targetMatchesPerson } from './store'
import './gift-messages.css'

export function ParcelArt({ id, sealed = false }: { id: string; sealed?: boolean }) {
  return <span className="gm-parcel-art" data-sealed={sealed} aria-hidden="true">
    <span className="gm-parcel-paper"/><span className="gm-parcel-object"><GiftIcon id={id}/></span>
    {sealed && <span className="gm-parcel-twine"/>}
  </span>
}

export function GiftMessageCard({ owner, person, direction, giftId, onOpen }: {
  owner: string
  person: Person
  direction: 'sent' | 'received'
  giftId: string
  onOpen: () => void
}) {
  const { lang } = useI18n()
  const zh = isZh(lang)
  const ledger = useGiftState(owner)
  const sent = direction === 'sent'
    ? ledger.receipts.find(receipt => receipt.id === giftId && receiptMatchesPerson(receipt, person))
    : undefined
  const received = direction === 'received'
    ? ledger.received?.find(item => item.id === giftId && targetMatchesPerson(item.from, person))
    : undefined
  const now = useArrivalClock(sent ? [sent] : [])
  const item = sent ?? received
  const line = item?.lines[0]
  if (!item || !line) return <p className="gm-unavailable" role="status">{zh ? '这份礼物的记录暂时无法读取。' : 'This gift record is unavailable.'}</p>
  const name = zh ? line.snapshot.name : line.snapshot.en
  const label = sent
    ? (zh ? `寄给${person.name}` : `To ${person.name}`)
    : (zh ? `${person.name}的剧情回礼` : `A story gift from ${person.name}`)
  const unopened = !!received && received.openedAt == null
  const state = sent
    ? hasArrived(sent, now) ? (zh ? '已抵达' : 'Delivered') : (zh ? '投递中' : 'In transit')
    : unopened ? (zh ? '待拆' : 'Unopened') : received?.placement === 'space' ? (zh ? '已陈列' : 'On display') : (zh ? '已拆开' : 'Opened')
  const action = sent ? (zh ? '查看回执' : 'View receipt') : unopened ? (zh ? '拆开礼物' : 'Unwrap') : (zh ? '查看礼物' : 'View gift')
  return <div className="gm-message" data-direction={direction}>
    <button type="button" className="gm-card" aria-label={`${label} · ${name} · ${state} · ${action}`} onClick={onOpen}>
      <div className="gm-card-body">
        <ParcelArt id={line.giftId} sealed={unopened}/>
        <div className="gm-card-copy"><small>{label}</small><strong>{name}{line.quantity > 1 && ` ×${line.quantity}`}</strong>
          {item.note && <span>{item.note}</span>}
        </div>
      </div>
      <div className="gm-card-foot"><span>{state}</span><span>{action}<I.Chevron/></span></div>
    </button>
    <time dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', hour12: false })}</time>
  </div>
}
