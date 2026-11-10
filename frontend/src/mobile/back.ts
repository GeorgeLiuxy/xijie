import { useEffect, useRef, type RefObject } from 'react'

type BackHandler = () => boolean
type NativeWindow = Window & {
  Capacitor?: { isNativePlatform?: () => boolean }
  __xijieNativeBack?: BackHandler
}
type Entry = {
  order: number
  priority: number
  current: { handler: BackHandler; elementRef?: RefObject<HTMLElement | null> }
}

const entries = new Set<Entry>()
let order = 0

export function isNativeRuntime(): boolean {
  if (typeof window === 'undefined') return false
  try { return (window as NativeWindow).Capacitor?.isNativePlatform?.() === true } catch { return false }
}

function dispatch(): boolean {
  if (!isNativeRuntime()) return false
  const stack = [...entries].sort((a, b) => b.priority - a.priority || b.order - a.order)
  for (const entry of stack) {
    if (!entries.has(entry)) continue
    const { handler, elementRef } = entry.current
    if (elementRef) {
      const element = elementRef.current
      if (!element?.isConnected || element.closest('[hidden], [inert]')) continue
    }
    try {
      if (handler()) return true
    } catch (error) {
      // Do not exit the app or close another layer after a handler failed.
      console.error('Native back handler failed', error)
      return true
    }
  }
  return false
}

/** Native host back only; browser keyboard and history navigation are untouched. */
export function useNativeBack(handler: BackHandler, enabled = true, priority = 0, elementRef?: RefObject<HTMLElement | null>) {
  const latest = useRef({ handler, elementRef })
  latest.current = { handler, elementRef }
  useEffect(() => {
    if (!enabled || !isNativeRuntime()) return
    const entry: Entry = {
      order: ++order,
      priority,
      get current() { return latest.current },
    }
    entries.add(entry)
    const host = window as NativeWindow
    host.__xijieNativeBack = dispatch
    return () => {
      entries.delete(entry)
      if (!entries.size && host.__xijieNativeBack === dispatch) delete host.__xijieNativeBack
    }
  }, [enabled, priority])
}
