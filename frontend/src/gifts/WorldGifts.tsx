import { isZh, useI18n } from '../i18n'
import type { Person } from '../model'
import { GiftIcon } from './GiftIcon'
import { useArrivalClock, useGiftState } from './GiftLedger'
import { hasArrived, receiptMatchesPerson } from './store'
import type { GiftOpenOptions } from './types'
import './gift-ledger.css'

export function WorldGiftLandmarks({ owner, people, onOpen }: { owner: string; people: Person[]; onOpen: (personId: number, options?: GiftOpenOptions) => void }) {
  const { lang } = useI18n()
  const zh = isZh(lang)
  const { receipts } = useGiftState(owner)
  const now = useArrivalClock(receipts)
  const deliveries = receipts.filter(receipt => hasArrived(receipt, now)).flatMap(receipt => {
    const person = people.find(candidate => candidate.world === receipt.target.world && receiptMatchesPerson(receipt, candidate))
    return person ? [{ receipt, person }] : []
  }).slice(-3)
  if (!deliveries.length) return null
  return <div className="world-gift-landmarks" aria-label={zh ? '抵达这里的礼物' : 'Gifts delivered here'}>
    {deliveries.map(({ receipt, person }) => {
      const line = receipt.lines[0]
      const giftName = zh ? line.snapshot.name : line.snapshot.en
      return <button key={receipt.id} title={giftName} aria-label={zh ? `${person.name}的${giftName}，查看回执` : `View ${giftName} for ${person.name}`} onClick={() => onOpen(person.id, { tab: 'receipts', receiptId: receipt.id })}><span><GiftIcon id={line.giftId}/></span><small>{giftName}</small></button>
    })}
  </div>
}
