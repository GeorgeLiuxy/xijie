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
if(typeof window!=='undefined'&&typeof window.addEventListener==='function')window.addEventListener('xijie:private-drafts-erased',event=>{const id=(event as CustomEvent<{accountId?:string}>).detail?.accountId;if(typeof id!=='string')return;for(const key of sessionDrafts.keys()){try{if(JSON.parse(key)[0]==='account.'+id)sessionDrafts.delete(key)}catch{/* Unknown ownership is never inferred from text. */}}})

export function clearConversationDraft(owner: string, threadId: string | number) {
  sessionDrafts.delete(draftKey(owner, threadId))
}

export function useConversationDraft(owner: string, threadId: string | number, durable = false) {
  const key = draftKey(owner, threadId)
  const stored = () => { try { return durable ? sessionStorage.getItem('xijie.conversation.draft.' + key) ?? '' : '' } catch { return '' } }
  const [draft, setDraft] = useState(() => durable ? stored() : sessionDrafts.get(key) ?? '')
  function update(value: string) {
    if (value) sessionDrafts.set(key, value)
    else clearConversationDraft(owner, threadId)
    if (durable) { try { if (value) sessionStorage.setItem('xijie.conversation.draft.' + key, value); else sessionStorage.removeItem('xijie.conversation.draft.' + key) } catch { /* Keep the live draft when storage is unavailable. */ } }
    setDraft(value)
  }
  return [draft, update] as const
}
