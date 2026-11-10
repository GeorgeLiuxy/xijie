import { useCallback, useRef, useState, type SetStateAction } from 'react'
import type { Msg } from './model'

type Exchange = Exclude<Msg, { kind: 'note' }>

export function exchanges(history: Msg[] = [], greeting?: string): Exchange[] {
  // Past transcripts start with a notice and an automatically displayed greeting.
  const initial = history[0]?.kind === 'note' && history[1]?.kind === 'him' &&
    history[1].who == null && history[1].text === greeting ? history[1] : undefined
  return history.filter((msg): msg is Exchange => msg.kind !== 'note' && msg !== initial)
}

export function useConversationHistory(initial: Msg[] | undefined, persist: (messages: Msg[]) => void, intro: () => Msg[]) {
  const [fallback, setFallback] = useState<Msg[]>(() => initial?.length ? initial : intro())
  const messages = initial ?? fallback
  const current = useRef(messages)
  const save = useRef(persist)
  current.current = messages
  save.current = persist
  const setMessages = useCallback((update: SetStateAction<Msg[]>) => {
    const next = typeof update === 'function' ? update(current.current) : update
    if (next === current.current) return
    current.current = next
    setFallback(next)
    save.current(next)
  }, [])
  return [messages, setMessages] as const
}

const sessionDrafts = new Map<string, string>()
const draftKey = (owner: string, threadId: string | number) => JSON.stringify([owner, threadId])

export function clearConversationDraft(owner: string, threadId: string | number) {
  sessionDrafts.delete(draftKey(owner, threadId))
}

export function useConversationDraft(owner: string, threadId: string | number) {
  const key = draftKey(owner, threadId)
  const [draft, setDraft] = useState(() => sessionDrafts.get(key) ?? '')
  function update(value: string) {
    if (value) sessionDrafts.set(key, value)
    else clearConversationDraft(owner, threadId)
    setDraft(value)
  }
  return [draft, update] as const
}
