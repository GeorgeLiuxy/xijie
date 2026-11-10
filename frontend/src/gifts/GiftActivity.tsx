import { useEffect, useState, useSyncExternalStore } from 'react'
import { useI18n, isZh } from '../i18n'
import type { Person } from '../model'
import { getGiftState, subscribeGifts, hasArrived, receiptMatchesPerson, targetMatchesPerson } from './store'
import { getGiftGoal } from './client'
import type { GiftGoal } from './types'
import './integration.css'

export function useHomeGiftActivity(owner: string, people: Person[]) {
  const { lang } = useI18n()
  const zh = isZh(lang)
  const state = useSyncExternalStore(callback => subscribeGifts(owner, callback), () => getGiftState(owner))
  const [now, setNow] = useState(Date.now)
  const [goal, setGoal] = useState<GiftGoal | null>(null)
  const goalLink = state.goals?.filter(link => people.some(person => targetMatchesPerson(link.target, person))).slice(-1)[0]
  const receipt = state.receipts.filter(item => people.some(person => receiptMatchesPerson(item, person))).slice(-1)[0]
  const showGoal = goalLink && (!receipt || goalLink.createdAt > receipt.createdAt)
  const goalId = showGoal ? goalLink.id : undefined
  useEffect(() => {
    if (!receipt) return
    const start = Date.now()
    setNow(start)
    if (hasArrived(receipt, start)) return
    const timer = setTimeout(() => setNow(Date.now()), receipt.arriveAt - start + 1)
    return () => clearTimeout(timer)
  }, [receipt])
  useEffect(() => {
    let live = true
    setGoal(null)
    if (!goalId) return
    const refresh = () => {
      if (!document.hidden) void getGiftGoal(goalId).then(g => { if (live) setGoal(g) }).catch(() => {})
    }
    refresh()
    const timer = setInterval(refresh, 3000)
    return () => { live = false; clearInterval(timer) }
  }, [goalId])
  if (showGoal) return {
    personId: people.find(person => targetMatchesPerson(goalLink.target, person))!.id, goalId: goalLink.id, receiptId: undefined,
    label: zh ? '共同心愿' : 'Shared wish',
    detail: [goalLink.target.name, zh ? '查看共同心愿' : 'View shared wish', goal?.id === goalLink.id && `${goal.current} / ${goal.target}`].filter(Boolean).join(' · '),
  }
  if (!receipt) return null
  const arrived = hasArrived(receipt, now)
  const label = arrived ? (zh ? '礼物回执' : 'Gift receipt') : (zh ? '投递中' : 'In transit')
  const gift = receipt.lines[0]?.snapshot
  return {
    personId: people.find(person => receiptMatchesPerson(receipt, person))!.id, goalId: undefined, receiptId: receipt.id, label,
    detail: [receipt.target.name, gift && (zh ? gift.name : gift.en), label].filter(Boolean).join(' · '),
  }
}
