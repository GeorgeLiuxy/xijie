import { useCallback, useSyncExternalStore } from 'react'
import type { GiftSendInput, GiftTarget } from './types'

export type GiftDraft = {
  giftId: string | null
  quantity: number
  note: string
  source: GiftSendInput['source'] | null
  request: { fingerprint: string; id: string } | null
}

// Like conversation drafts, these survive navigation within the current session.
// They never write to the gift ledger or change its account/receipt identities.
const emptyDraft: GiftDraft = Object.freeze({ giftId: null, quantity: 1, note: '', source: null, request: null })
const drafts = new Map<string, GiftDraft>()
const listeners = new Map<string, Set<() => void>>()
const keyFor = (owner: string, target: Pick<GiftTarget, 'id' | 'identity'>) =>
  JSON.stringify([owner, target.identity ? ['identity', target.identity] : ['legacy', target.id]])

export function getGiftDraft(owner: string, target: Pick<GiftTarget, 'id' | 'identity'>): GiftDraft {
  return drafts.get(keyFor(owner, target)) ?? emptyDraft
}

export function updateGiftDraft(owner: string, target: Pick<GiftTarget, 'id' | 'identity'>, patch: Partial<GiftDraft>) {
  const key = keyFor(owner, target)
  const current = getGiftDraft(owner, target)
  const next = { ...current, ...patch }
  if (patch.request === undefined && (next.giftId !== current.giftId || next.quantity !== current.quantity || next.note !== current.note || next.source !== current.source)) next.request = null
  if (!next.giftId && !next.note && !next.source && !next.request) drafts.delete(key)
  else drafts.set(key, next)
  listeners.get(key)?.forEach(listener => listener())
}

export function clearGiftDraft(owner: string, target: Pick<GiftTarget, 'id' | 'identity'>, requestId?: string) {
  // A late send completion may only clear the draft that submitted that request.
  if (requestId && getGiftDraft(owner, target).request?.id !== requestId) return
  const key = keyFor(owner, target)
  drafts.delete(key)
  listeners.get(key)?.forEach(listener => listener())
}

export function useGiftDraft(owner: string, target: Pick<GiftTarget, 'id' | 'identity'>) {
  const { id, identity } = target
  const key = keyFor(owner, target)
  const subscribe = useCallback((listener: () => void) => {
    const subscribers = listeners.get(key) ?? new Set<() => void>()
    subscribers.add(listener)
    listeners.set(key, subscribers)
    return () => {
      subscribers.delete(listener)
      if (!subscribers.size) listeners.delete(key)
    }
  }, [key])
  const snapshot = useCallback(() => getGiftDraft(owner, { id, identity }), [owner, id, identity])
  const draft = useSyncExternalStore(subscribe, snapshot, snapshot)
  const update = useCallback((patch: Partial<GiftDraft>) => updateGiftDraft(owner, { id, identity }, patch), [owner, id, identity])
  const clear = useCallback((requestId?: string) => clearGiftDraft(owner, { id, identity }, requestId), [owner, id, identity])
  return [draft, update, clear] as const
}
