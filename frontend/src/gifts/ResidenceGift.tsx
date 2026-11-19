import { isZh, useI18n } from '../i18n'
import type { Person } from '../model'
import { I } from '../ui'
import { GiftIcon } from './GiftIcon'
import { useArrivalClock, useGiftState } from './GiftLedger'
import { hasArrived, receiptMatchesPerson } from './store'
import type { GiftReceipt } from './types'

export function latestResidenceGift(receipts: GiftReceipt[], person: Person, now: number) {
  return receipts.reduce<GiftReceipt | undefined>((latest, receipt) => {
    if (receipt.target.world !== person.world || !receiptMatchesPerson(receipt, person)
      || !hasArrived(receipt, now) || !receipt.lines.some(line => line.quantity > 0)) return latest
    if (!latest || receipt.createdAt > latest.createdAt || receipt.createdAt === latest.createdAt && receipt.id > latest.id) return receipt
    return latest
  }, undefined)
}

export function ResidenceGift({ owner, person, onOpen }: { owner: string; person: Person; onOpen: (receiptId: string) => void }) {
  const { lang } = useI18n()
  const zh = isZh(lang)
  const { receipts } = useGiftState(owner)
  const now = useArrivalClock(receipts)
  const gift = latestResidenceGift(receipts, person, now)
  const item = gift?.lines.find(line => line.quantity > 0)
  if (!gift || !item) return null
  const name = zh ? item.snapshot.name : item.snapshot.en
  return <button type="button" className="visit-residence-gift" onClick={() => onOpen(gift.id)}
    aria-label={zh ? `查看留在这里的${name}` : `View the ${name} left here`}>
    <GiftIcon id={item.giftId} />
    <span>{name}</span>
    <I.Chevron aria-hidden />
  </button>
}
