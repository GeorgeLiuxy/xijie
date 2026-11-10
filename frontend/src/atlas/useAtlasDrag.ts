import { useLayoutEffect, useRef, type MouseEventHandler, type PointerEvent as ReactPointerEvent, type PointerEventHandler } from 'react'
import { ATLAS_INTENT_PX, atlasDragPosition, atlasReleaseIndex, clampAtlasIndex } from './atlasMotion'

type AtlasDragOptions = {
  index: number
  count: number
  step: number
  onSelect: (index: number) => void
  paint: (position: number, dragging: boolean) => void
  /** Read once on down to pick up an interrupted CSS transition without a jump. */
  readPosition?: () => number
  disabled?: boolean
}

type Gesture = {
  pointerId: number
  element: HTMLElement
  x: number
  y: number
  delta: number
  scale: number
  step: number
  count: number
  index: number
  visualStart: number
  horizontal: boolean
  captured: boolean
  samples: { delta: number; time: number }[]
}

type AtlasBindings = {
  onPointerDown: PointerEventHandler<HTMLElement>
  onPointerMove: PointerEventHandler<HTMLElement>
  onPointerUp: PointerEventHandler<HTMLElement>
  onPointerCancel: PointerEventHandler<HTMLElement>
  onLostPointerCapture: PointerEventHandler<HTMLElement>
  onPointerLeave: PointerEventHandler<HTMLElement>
}

/** Bind to each surface with touch-action: pan-y; capture clicks at their common parent. */
export function useAtlasDrag(options: AtlasDragOptions): {
  bind: (scale?: number) => AtlasBindings
  onPointerDownCapture: PointerEventHandler<HTMLElement>
  onClickCapture: MouseEventHandler<HTMLElement>
  stop: () => void
} {
  const latest = useRef(options)
  latest.current = options
  const gesture = useRef<Gesture | null>(null)
  const settled = useRef(clampAtlasIndex(options.index, options.count))
  const initialized = useRef(false)
  const geometry = useRef({ count: options.count, step: options.step })
  const frame = useRef<number | null>(null)
  const suppressClick = useRef(false)
  const suppressUntil = useRef(0)
  const suppressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function cancelFrame() {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
  }

  function clearSuppression() {
    suppressClick.current = false
    suppressUntil.current = 0
    if (suppressTimer.current !== null) clearTimeout(suppressTimer.current)
    suppressTimer.current = null
  }

  function suppressDragClick() {
    clearSuppression()
    suppressClick.current = true
    suppressUntil.current = performance.now() + 350
    suppressTimer.current = setTimeout(clearSuppression, 350)
  }

  function release(g: Gesture) {
    // Clear the gesture before releasing: lostpointercapture is a cancellation
    // only while a gesture is active, not after a successful pointerup.
    if (g.captured) {
      try {
        if (g.element.hasPointerCapture(g.pointerId)) g.element.releasePointerCapture(g.pointerId)
      } catch { /* The element or pointer may already have left the document. */ }
    }
  }

  function stop() {
    const g = gesture.current
    gesture.current = null
    cancelFrame()
    if (g) {
      if (g.horizontal) suppressDragClick()
      release(g)
    }
    latest.current.paint(settled.current, false)
  }

  function schedulePaint() {
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const g = gesture.current
      if (g?.horizontal) latest.current.paint(atlasDragPosition(g.index, g.count, g.delta, g.step, g.scale, g.visualStart), true)
    })
  }

  function readPoint(g: Gesture, event: ReactPointerEvent<HTMLElement>) {
    g.delta = event.clientX - g.x
    const time = Math.max(g.samples[g.samples.length - 1].time, event.timeStamp)
    g.samples.push({ delta: g.delta, time })
    // Keep one sample bracketing the recent window, including a stationary up.
    while (g.samples.length > 2 && g.samples[1].time < time - 100) g.samples.shift()
  }

  function determineAxis(g: Gesture, event: ReactPointerEvent<HTMLElement>): 'pending' | 'horizontal' | 'vertical' {
    if (g.horizontal) return 'horizontal'
    const dx = Math.abs(event.clientX - g.x)
    const dy = Math.abs(event.clientY - g.y)
    if (Math.max(dx, dy) < ATLAS_INTENT_PX) return 'pending'
    return dx > dy ? 'horizontal' : 'vertical'
  }

  const bind = (scale = 1): AtlasBindings => ({
    onPointerDown(event) {
      const active = gesture.current
      if (active) {
        if (active.pointerId !== event.pointerId) stop()
        return
      }
      if (!event.isPrimary || event.button !== 0) return
      // A deliberate new touch must not inherit the previous drag's click guard.
      clearSuppression()
      const config = latest.current
      if (config.disabled || config.count < 2) return
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return
      let visualStart = settled.current
      try {
        const visible = config.readPosition?.()
        if (visible !== undefined && Number.isFinite(visible)) visualStart = visible
      } catch { /* Fall back to the selected world if a transitioning node disappeared. */ }
      gesture.current = {
        pointerId: event.pointerId, element: event.currentTarget,
        x: event.clientX, y: event.clientY, delta: 0,
        scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
        step: Math.max(1, config.step), count: config.count,
        index: settled.current, visualStart, horizontal: false, captured: false,
        samples: [{ delta: 0, time: event.timeStamp }],
      }
      // Freeze an interrupted transition while the finger waits for direction.
      // Otherwise a hold followed by a drag jumps back to the pose read on down.
      config.paint(visualStart, true)
    },
    onPointerMove(event) {
      const g = gesture.current
      if (!g || g.pointerId !== event.pointerId) return
      if (latest.current.disabled) { stop(); return }
      readPoint(g, event)
      const axis = determineAxis(g, event)
      if (axis === 'vertical') { stop(); return }
      if (axis === 'pending') return
      if (!g.horizontal) {
        g.horizontal = true
        try {
          g.element.setPointerCapture(g.pointerId)
          g.captured = g.element.hasPointerCapture(g.pointerId)
        } catch { /* Pointer leave/up will settle safely if capture is unavailable. */ }
      }
      schedulePaint()
    },
    onPointerUp(event) {
      const g = gesture.current
      if (!g || g.pointerId !== event.pointerId) return
      readPoint(g, event)
      const axis = determineAxis(g, event)
      if (latest.current.disabled || axis !== 'horizontal') { stop(); return }
      g.horizontal = true
      const first = g.samples[0]
      const last = g.samples[g.samples.length - 1]
      const velocity = (last.delta - first.delta) / Math.max(1, last.time - first.time)
      const next = atlasReleaseIndex({ index: g.index, count: g.count, delta: g.delta, velocity, step: g.step, scale: g.scale })
      gesture.current = null
      cancelFrame()
      suppressDragClick()
      release(g)
      settled.current = next
      latest.current.paint(next, false)
      if (next !== g.index) latest.current.onSelect(next)
    },
    onPointerCancel(event) {
      if (gesture.current?.pointerId === event.pointerId) stop()
    },
    onLostPointerCapture(event) {
      const g = gesture.current
      // Touch can start with implicit capture on an avatar. Moving capture to
      // the stage emits a bubbling loss from that avatar, not from our stage.
      if (g?.pointerId === event.pointerId && event.target === g.element) stop()
    },
    onPointerLeave(event) {
      const g = gesture.current
      if (g?.pointerId === event.pointerId && !g.captured) stop()
    },
  })

  const onClickCapture: MouseEventHandler<HTMLElement> = event => {
    // Keyboard and assistive activation have no pointer click count.
    if (event.detail === 0) return
    if (!suppressClick.current || performance.now() > suppressUntil.current) return
    event.preventDefault()
    event.stopPropagation()
  }

  useLayoutEffect(() => {
    const next = clampAtlasIndex(options.index, options.count)
    const resized = geometry.current.count !== options.count || geometry.current.step !== options.step
    geometry.current = { count: options.count, step: options.step }
    // Acknowledging our own selection must not interrupt a new, rapid gesture.
    // Fresh callback identities alone never reset the stage or an active drag.
    if (!initialized.current || settled.current !== next || resized) {
      const g = gesture.current
      gesture.current = null
      cancelFrame()
      if (g) { if (g.horizontal) suppressDragClick(); release(g) }
      settled.current = next
      latest.current.paint(next, false)
      initialized.current = true
    }
  }, [options.index, options.count, options.step])

  useLayoutEffect(() => {
    if (options.disabled && gesture.current) stop()
  }, [options.disabled])

  useLayoutEffect(() => () => {
    const g = gesture.current
    gesture.current = null
    cancelFrame()
    clearSuppression()
    if (g) release(g)
  }, [])

  return {
    bind, onClickCapture, stop,
    // Include sibling controls such as the arrows: a fresh tap must not inherit
    // the click guard belonging to the preceding drag.
    onPointerDownCapture: event => { if (event.isPrimary && event.button === 0) clearSuppression() },
  }
}
