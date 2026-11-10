import { isZh, useI18n } from '../i18n'
import { useGiftState } from './GiftLedger'
import { GiftIcon } from './GiftIcon'
import { canDisplayReceivedGift } from './placement'
import './gift-messages.css'

export function ReceivedGiftsShelf({ owner, onOpen }: { owner: string; onOpen: (id: string) => void }) {
  const { lang } = useI18n()
  const zh = isZh(lang)
  const gifts = (useGiftState(owner).received ?? []).filter(item => item.openedAt != null && item.placement === 'space' && canDisplayReceivedGift(item)).slice().reverse()
  if (!gifts.length) return null
  return <section className="gm-shelf" aria-label={zh ? '我陈列的来礼' : 'My displayed gifts'}>
    <h2>{zh ? '我陈列的来礼' : 'My displayed gifts'}</h2>
    <div className="gm-shelf-strip scroll-quiet">{gifts.map(gift => {
      const line = gift.lines[0]
      const name = zh ? line.snapshot.name : line.snapshot.en
      return <button key={gift.id} className="gm-shelf-item" onClick={() => onOpen(gift.id)} aria-label={zh ? `查看${gift.from.name}的${name}` : `View ${name} from ${gift.from.name}`}>
        <span className="gm-shelf-art"><GiftIcon id={line.giftId}/></span>
        <strong>{name}</strong><small>{gift.from.name}</small>
      </button>
    })}</div>
  </section>
}
