import { useEffect, useRef } from "react"
import { createPassage } from "../post/passage"
import lens from "../post/assets/lens.webp"

// Use the same optics as the flight. The aperture stays at its earned size
// between contributions. It does not drift forward on a looping timer.
export function RelayLens({ sky, level }: { sky: string; level: number }) {
  const canvas = useRef<HTMLCanvasElement>(null),
    desired = useRef(level)
  const wake = useRef<() => void>(() => {})
  useEffect(() => {
    desired.current = level
    wake.current()
  }, [level])
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const calm = matchMedia("(prefers-reduced-motion: reduce)")
    const engine = createPassage(el, lens, sky, true)
    if (!engine) return
    let raf = 0,
      previous = 0,
      position = desired.current
    const waitUntil = performance.now() + 5000
    function draw(now: number) {
      raf = 0
      const dt = previous ? Math.min((now - previous) / 1000, 0.12) : 0.016
      previous = now
      const delta = desired.current - position
      position =
        calm.matches || Math.abs(delta) < 0.0008
          ? desired.current
          : position + delta * (1 - Math.exp(-dt * 3.9))
      engine!.draw(position, 0)
      if (
        position !== desired.current ||
        (el!.style.opacity !== "1" && now < waitUntil)
      )
        raf = requestAnimationFrame(draw)
    }
    function schedule() {
      if (!raf) {
        previous = 0
        raf = requestAnimationFrame(draw)
      }
    }
    wake.current = schedule
    const size = () => {
      engine.resize(el.clientWidth, el.clientHeight)
      schedule()
    }
    const ro = new ResizeObserver(size)
    ro.observe(el)
    size()
    return () => {
      ro.disconnect()
      cancelAnimationFrame(raf)
      wake.current = () => {}
      engine.dispose()
    }
  }, [sky])
  return <canvas className="rw-optics" ref={canvas} aria-hidden="true" />
}
