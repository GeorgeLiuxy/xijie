import { useEffect, useState, type CSSProperties } from 'react'
import type { GiftReceipt } from './types'
import './gift-wish-glow.css'

const wishGiftIds = new Set(['spark-wish-slip', 'blessing-river-lantern'])
const celebrated = new Set<string>()
const sparks = [
  [-92, -44, 1.4, 30], [-75, -85, 2.1, 0], [-57, -22, 1, 90], [-46, -117, 1.7, 20],
  [-26, -63, 2.6, 110], [-18, -91, 1.3, 55], [8, -126, 2.2, 45], [19, -51, 1.6, 0],
  [34, -98, 2.5, 65], [55, -37, 1.2, 90], [67, -72, 1.7, 15], [86, -29, 2.1, 75],
]

export function claimWishGiftGlow(owner: string, receipt?: GiftReceipt) {
  if (!receipt || receipt.status === 'delivery_failed'
    || !receipt.lines.some(line => line.quantity > 0 && wishGiftIds.has(line.giftId))) return false
  const key = JSON.stringify([owner, receipt.id])
  if (celebrated.has(key)) return false
  celebrated.add(key)
  if (celebrated.size > 128) celebrated.delete(celebrated.values().next().value!)
  return true
}

/** The parent supplies a receipt from a completed send action, never from a list or poll. */
export function GiftWishGlow({ owner, receipt, calm }: { owner: string; receipt?: GiftReceipt; calm?: boolean }) {
  const [active, setActive] = useState<{ owner: string; receiptId: string }>()
  useEffect(() => {
    if (!receipt || !claimWishGiftGlow(owner, receipt) || calm) return
    setActive({ owner, receiptId: receipt.id })
  }, [owner, receipt, calm])
  useEffect(() => {
    if (!active) return
    const timer = window.setTimeout(() => setActive(undefined), 1100)
    return () => window.clearTimeout(timer)
  }, [active])
  if (calm || !active || active.owner !== owner || active.receiptId !== receipt?.id) return null
  return <div key={active.receiptId} className="gift-wish-glow" aria-hidden="true">
    {sparks.map(([x, y, radius, delay], index) => <i key={index} style={{
      '--spark-x': `${x}px`, '--spark-y': `${y}px`, '--spark-size': `${radius * 2}px`, '--spark-delay': `${delay}ms`,
    } as CSSProperties}/>)}
  </div>
}
