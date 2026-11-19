import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Msg } from './model'
import { fxPrefs } from './ui'

export function useThreadScroll(thread: Msg[], typing: boolean, focusMessageId?: number | string) {
  const scroller = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const previous = useRef<{ id?: number | string; thread: Msg[]; typing: boolean } | null>(null)
  const focused = useRef<number | string | undefined>(undefined)
  const position = useRef<{ id: string; offset: number } | null>(null)
  const [highlighted, setHighlighted] = useState<number | undefined>(undefined)
  const remember = (list: HTMLDivElement) => {
    const row = [...list.querySelectorAll<HTMLElement>('[data-message-id]')].find(item => item.offsetTop + item.offsetHeight > list.scrollTop + 56)
    position.current = row ? { id: row.dataset.messageId!, offset: row.offsetTop - list.scrollTop } : null
  }
  useLayoutEffect(() => {
    const list = scroller.current
    if (!list) return
    const last = previous.current, opening = !last || last.id !== focusMessageId
    previous.current = { id: focusMessageId, thread, typing }
    if (opening) { focused.current = undefined; setHighlighted(undefined) }
    if (focusMessageId !== undefined && focused.current !== focusMessageId) {
      const attr = typeof focusMessageId === 'string' ? 'data-server-message-id' : 'data-message-id'
      const row = list.querySelector<HTMLElement>(`[${attr}="${focusMessageId}"]`)
      // Slow context reads must not consume the focus or its highlight timer before DOM arrival.
      if (!row) return
      list.scrollTop = row.offsetTop - Math.max(56, (list.clientHeight - row.offsetHeight) / 2)
      focused.current = focusMessageId; following.current = false
      setHighlighted(Number(row.dataset.messageId)); remember(list)
      return
    }
    const lastMessage = thread.at(-1), justSent = lastMessage?.kind === 'me' && lastMessage.id !== last?.thread.at(-1)?.id
    if (opening || (focusMessageId === undefined && (following.current || justSent) && (last.thread !== thread || last.typing !== typing))) {
      list.scrollTo({ top: list.scrollHeight, behavior: opening || fxPrefs.calm ? 'auto' : 'smooth' })
    } else if (position.current && last?.thread !== thread) {
      const row = list.querySelector<HTMLElement>(`[data-message-id="${position.current.id}"]`)
      if (row) list.scrollTop = row.offsetTop - position.current.offset
    }
    remember(list)
  }, [focusMessageId, thread, typing])
  useEffect(() => {
    const list = scroller.current
    if (!list) return
    const track = () => { following.current = list.scrollHeight - list.scrollTop - list.clientHeight < 90; remember(list) }
    list.addEventListener('scroll', track, { passive: true })
    return () => list.removeEventListener('scroll', track)
  }, [])
  useEffect(() => {
    if (highlighted === undefined) return
    const timer = window.setTimeout(() => setHighlighted(undefined), 2200)
    return () => window.clearTimeout(timer)
  }, [highlighted])
  return { scroller, highlighted }
}
