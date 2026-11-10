import { useEffect, useRef } from 'react'
import { drawFrame } from './flight'
import { beats, duration, type Images } from './journeys'
import type { WorldId } from '../i18n'

export function FlightPlayer({ images, world, bearing, paused, quiet, onBeat, onFinish }: {
  images: Images; world: WorldId; bearing: number; paused: boolean; quiet: boolean
  onBeat: (beat: number) => void; onFinish: () => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const progress = useRef(0)
  const lastBeat = useRef(-1)
  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext('2d', { alpha: false })
    if (!ctx || !el) { onFinish(); return }
    let raf=0, previous=0, lastStill=-1
    let width=0,height=0
    const length = quiet ? 4.5 : duration
    const stills = [0,2.58,5.35,7.5,8.8,11.18,13.75,16.0,17.85,19.68,22.35]
    const paint = (force = false) => {
      const still = Math.min(stills.length-1,Math.floor(progress.current*stills.length))
      if (quiet && !force && still===lastStill) return
      lastStill=still
      const t = quiet ? stills[still] : progress.current*duration
      drawFrame(ctx,images,width,height,t,world,bearing)
      const beat = beats.reduce((result, start, i) => t>=start ? i : result, 0)
      if (beat !== lastBeat.current) { lastBeat.current=beat; onBeat(beat) }
    }
    function tick(now: number) {
      if (previous) progress.current = Math.min(1, progress.current + (now-previous)/(1000*length))
      previous=now
      paint()
      if (progress.current>=1) { onFinish(); return }
      raf=requestAnimationFrame(tick)
    }
    function sync() {
      cancelAnimationFrame(raf);previous=0
      if (!paused && !document.hidden) raf=requestAnimationFrame(tick)
    }
    function resize() {
      if (!el || !ctx) return
      const rect=el.getBoundingClientRect()
      if (width===rect.width && height===rect.height) return
      width=rect.width;height=rect.height
      if(!width || !height) return
      const ratio=Math.min(devicePixelRatio || 1,1.6)
      el.width=Math.round(width*ratio);el.height=Math.round(height*ratio)
      ctx.setTransform(ratio,0,0,ratio,0,0);paint(true)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(el);resize();sync()
    document.addEventListener('visibilitychange',sync)
    return () => { cancelAnimationFrame(raf);observer.disconnect();document.removeEventListener('visibilitychange',sync) }
  },[images,world,bearing,paused,quiet,onBeat,onFinish])
  return <canvas className="wl-cinema" ref={canvas} aria-hidden />
}
