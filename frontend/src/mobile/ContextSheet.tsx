import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { useNativeBack } from './back'
import './context-sheet.css'

type ContextSheetProps = {
  label: string
  onClose: () => void
  children: ReactNode
  className?: string
  expanded?: boolean
  closeDisabled?: boolean
  backPriority?: number
}

const focusableSelector = 'button, input:not([type="hidden"]), select, textarea, summary, a[href], [tabindex], [contenteditable="true"]'
const closeSelector = '[data-context-close], button[aria-label="关闭"], button[aria-label="返回"], button[aria-label="Close"], button[aria-label="Back"], button[aria-label="close"], button[aria-label="back"]'

function available(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"], [aria-disabled="true"]') || element.matches(':disabled') || !element.getClientRects().length) return false
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return false
  }
  return true
}

function controls(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(focusableSelector)].filter(element => element.tabIndex >= 0 && available(element))
}

function frontmost(root: HTMLElement): boolean {
  if (!available(root)) return false
  const layers = [...document.querySelectorAll<HTMLElement>('[data-context-sheet]')].filter(available)
  return layers[layers.length - 1] === root
}

function focusStart(root: HTMLElement, panel: HTMLElement) {
  const all = controls(root)
  const target = all.find(element => element.matches(closeSelector)) ?? all.find(element => element.tagName === 'BUTTON') ?? panel
  target.focus({ preventScroll: true })
}

/** A contextual surface inside the app frame; callers supply their own header and scrollable content. */
export function ContextSheet({ label, onClose, children, className = '', expanded = false, closeDisabled = false, backPriority = 25 }: ContextSheetProps) {
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const trigger = useRef(typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const close = () => { if (!closeDisabled) onClose() }
  useNativeBack(() => {
    if (!root.current || !frontmost(root.current)) return false
    close(); return true
  }, true, backPriority, root)

  useLayoutEffect(() => {
    const layer = root.current, surface = panel.current
    if (!layer || !surface) return
    const scope = layer.closest('.app-device-frame') ?? layer.parentElement
    if (frontmost(layer)) focusStart(layer, surface)
    const containFocus = (event: FocusEvent) => {
      if (frontmost(layer) && event.target instanceof Node && !layer.contains(event.target)) focusStart(layer, surface)
    }
    document.addEventListener('focusin', containFocus)
    return () => {
      document.removeEventListener('focusin', containFocus)
      requestAnimationFrame(() => {
        // React StrictMode can run cleanup while the same dialog remains mounted.
        if (layer.isConnected && available(layer)) return
        const original = trigger.current
        const remaining = [...document.querySelectorAll<HTMLElement>('[data-context-sheet]')].filter(available)
        const foreground = remaining[remaining.length - 1]
        if (foreground && (!original || !foreground.contains(original))) return
        if (original && available(original)) { original.focus({ preventScroll: true }); return }
        const canRestore = (element: HTMLElement) => available(element) && (!foreground || foreground.contains(element))
        const focused = document.activeElement
        // A loading sheet's trigger can disappear while the caller restores its real opener.
        if (focused instanceof HTMLElement && focused !== document.body && focused !== document.documentElement
          && !layer.contains(focused) && canRestore(focused)) return
        const giftButton = [...(scope?.querySelectorAll<HTMLElement>('.chat-gift') ?? [])]
          .find(element => element.tagName === 'BUTTON' && canRestore(element))
        const fallback = giftButton ?? [...(scope?.querySelectorAll<HTMLElement>('.chat-entry-input, .meet-add') ?? [])].find(canRestore)
        fallback?.focus({ preventScroll: true })
      })
    }
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const layer = root.current, surface = panel.current
    if (event.defaultPrevented || !layer || !surface || !frontmost(layer)) return
    if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      event.preventDefault(); event.stopPropagation(); close()
      return
    }
    if (event.key !== 'Tab' || event.nativeEvent.isComposing) return
    const all = controls(layer)
    const index = all.indexOf(document.activeElement as HTMLElement)
    if (!all.length) { event.preventDefault(); surface.focus({ preventScroll: true }); return }
    event.preventDefault()
    const next = index === -1 ? (event.shiftKey ? all.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + all.length) % all.length
    all[next].focus()
  }

  return <div ref={root} data-context-sheet className={`context-sheet${expanded ? ' context-sheet--expanded' : ''}${className ? ' ' + className : ''}`}
    onKeyDown={onKeyDown} onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
    <div className="context-sheet__scrim" aria-hidden="true"
      onPointerDown={event => { event.preventDefault(); event.stopPropagation() }}
      onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) close() }} />
    <div ref={panel} className="context-sheet__panel" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
      <div className="context-sheet__grip" aria-hidden="true"><span /></div>
      <div className="context-sheet__body">{children}</div>
    </div>
  </div>
}
