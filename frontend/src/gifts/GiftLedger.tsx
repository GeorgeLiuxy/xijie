import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { isZh, useI18n } from '../i18n'
import { I } from '../ui'
import { getGiftGoal } from './client'
import { getGiftState, subscribeGifts } from './store'
import type { GiftGoal, GiftGoalLink, GiftReceipt } from './types'

export function useGiftState(owner: string) {
  const subscribe = useCallback((fn: () => void) => subscribeGifts(owner, fn), [owner])
  return useSyncExternalStore(subscribe, () => getGiftState(owner))
}

export function useArrivalClock(receipts: GiftReceipt[]) {
  const [now, setNow] = useState(Date.now)
  const next = receipts.reduce((soonest, receipt) => receipt.arriveAt > now ? Math.min(soonest, receipt.arriveAt) : soonest, Infinity)
  useEffect(() => {
    if (!Number.isFinite(next)) return
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()) + 10)
    return () => clearTimeout(timer)
  }, [next])
  return now
}

const goalTitles = {
  flight: ['共同航班', 'Shared departure'],
  home: ['共同住所', 'Shared home'],
  album: ['共同记忆册', 'Shared memory book'],
}

export function GoalLedgerRow({ link, onOpen }: { link: GiftGoalLink; onOpen: () => void }) {
  const { lang } = useI18n()
  const zh = isZh(lang)
  const [goal, setGoal] = useState<GiftGoal | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true, loading = false
    const read = async () => {
      if (document.hidden || loading) return
      loading = true
      try {
        const value = await getGiftGoal(link.id)
        if (active) { setGoal(value); setFailed(false) }
      } catch { if (active) setFailed(true) }
      finally { loading = false }
    }
    void read()
    const timer = window.setInterval(read, 5000)
    document.addEventListener('visibilitychange', read)
    return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', read) }
  }, [link.id])
  const detail = goal ? `${goal.current} / ${goal.target} · ${goal.completed ? (zh ? '已完成' : 'Complete') : (zh ? '进行中' : 'In progress')}` : ''
  return <button className="gift-ledger-row" onClick={onOpen}>
    <span className="gift-ledger-glyph">{link.kind === 'album' ? <I.Story/> : link.kind === 'home' ? <I.Place/> : <I.PaperBird/>}</span>
    <span><b>{goalTitles[link.kind][zh ? 0 : 1]}</b><small>{link.target.name}{detail && ' · ' + detail}{failed && (zh ? ' · 暂未更新' : ' · Update pending')}</small></span><I.Chevron/>
  </button>
}
