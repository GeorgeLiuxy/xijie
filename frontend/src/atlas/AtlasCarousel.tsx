import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { isZh, useI18n, type WorldId } from '../i18n'
import type { Person } from '../model'
import { WORLDS } from '../worlds'
import { COSMOS, Lens } from '../fx'
import { I, fxPrefs } from '../ui'
import { useAtlasDrag } from './useAtlasDrag'
import './atlas-carousel.css'

export type AtlasSlot = WorldId | 'unknown'
const STEP = 196
const TICK = 112
const settle = 'transform .32s cubic-bezier(.2,.8,.2,1), opacity .24s ease-out'
const neighbours = (index: number, count: number, radius: number) => Array.from(
  { length: Math.min(count - 1, index + radius) - Math.max(0, index - radius) + 1 },
  (_, offset) => Math.max(0, index - radius) + offset,
)

function pose(offset: number) {
  const distance = Math.min(Math.abs(offset), 1.6)
  return {
    transform: `translate(-50%, -50%) translateX(${offset * STEP}px) translateZ(${-distance * 260}px) rotateY(${-offset * 22}deg) scale(${1 - distance * .3})`,
    opacity: Math.max(0, 1 - Math.abs(offset) * .5),
    zIndex: 10 - Math.round(Math.abs(offset) * 3),
  }
}

export function AtlasCarousel({ slots, index, residents, disabled, onSelect, onEnter, onResident }: {
  slots: AtlasSlot[]; index: number; residents: Partial<Record<WorldId, Person[]>>; disabled: boolean
  onSelect: (index: number) => void; onEnter: () => void; onResident: (id: number) => void
}) {
  const { t, lang } = useI18n()
  const stage = useRef<HTMLDivElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const planets = useRef(new Map<number, HTMLDivElement>())
  const ruler = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState(1)
  const [surfaceScale, setSurfaceScale] = useState(1)
  const paint = useCallback((position: number, dragging: boolean) => {
    surface.current?.setAttribute('data-dragging', String(dragging))
    for (const [i, element] of planets.current) {
      const next = pose(i - position)
      element.style.transition = dragging || fxPrefs.calm ? 'none' : settle
      element.style.transform = next.transform
      element.style.opacity = String(next.opacity)
      element.style.zIndex = String(next.zIndex)
    }
    if (ruler.current) {
      ruler.current.style.transition = dragging || fxPrefs.calm ? 'none' : 'transform .32s cubic-bezier(.2,.8,.2,1)'
      ruler.current.style.transform = `translateX(${-position * TICK}px)`
    }
  }, [])
  const drag = useAtlasDrag({ index, count: slots.length, step: STEP, onSelect, paint, disabled,
    readPosition: () => {
      const element = planets.current.get(index)
      if (!element) return index
      const transform = getComputedStyle(element).transform
      if (transform === 'none') return index
      return index - (new DOMMatrixReadOnly(transform).m41 + 102) / STEP
    },
  })
  useLayoutEffect(() => {
    const element = stage.current
    if (!element) return
    const measure = () => {
      setFit(Math.max(.55, Math.min(1, (element.clientHeight - 28) / 320)))
      setSurfaceScale(element.getBoundingClientRect().width / Math.max(1, element.clientWidth))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return <div ref={surface} className="atlas-carousel" inert={disabled} onPointerDownCapture={drag.onPointerDownCapture} onClickCapture={drag.onClickCapture}>
    <div ref={stage} className="atlas-stage" {...drag.bind(1 / (fit * surfaceScale))}>
      <div className="atlas-orbits" style={{ transform: `scale(${fit})` }}>
        {neighbours(index, slots.length, 2).map(i => {
          const slot = slots[i]
          const title = slot === 'unknown' ? t('atlas.unknown.title') : t(`world.${slot}`)
          return <div key={slot} ref={element => {
            if (element) planets.current.set(i, element); else planets.current.delete(i)
          }} className="atlas-planet" style={{ ...pose(i - index), transition: fxPrefs.calm ? 'none' : settle }}>
            <Planet slot={slot} size={204} residents={slot === 'unknown' ? [] : residents[slot] ?? []} active={i === index} onResident={onResident} />
            <button className="atlas-planet-target" tabIndex={i === index ? 0 : -1}
              aria-label={`${i === index ? (isZh(lang) ? '进入' : 'Enter ') : (isZh(lang) ? '切换到' : 'Switch to ')}${title}`}
              onClick={() => i === index ? onEnter() : onSelect(i)} />
          </div>
        })}
      </div>
      <p className="atlas-swipe-hint">{t('atlas.swipe')}</p>
    </div>
    <div className="atlas-tuner">
      <AtlasStep disabled={index === 0} onStep={() => onSelect(index - 1)} label={isZh(lang) ? '上一个世界' : 'Previous world'}><I.Back /></AtlasStep>
      <div className="atlas-tuner-window" {...drag.bind(STEP / (TICK * surfaceScale))} aria-hidden="true">
        <div ref={ruler} className="atlas-tuner-track" style={{ transform: `translateX(${-index * TICK}px)` }}>
          {neighbours(index, slots.length, 3).flatMap(i => Array.from({ length: 8 }, (_, tick) => (
            <span key={`${i}-${tick}`} className={`atlas-tick ${tick === 0 ? 'atlas-tick--major' : ''}`} style={{ left: i * TICK + tick * TICK / 8 }} />
          )))}
          {neighbours(index, slots.length, 3).map(i => <span className={`atlas-tick-label ${i === index ? 'atlas-tick-label--active' : ''}`} key={slots[i]} style={{ left: i * TICK }}>{slots[i] === 'unknown' ? 'ELY·??' : WORLDS[slots[i] as WorldId].code}</span>)}
        </div>
        <span className="atlas-tuner-needle" />
      </div>
      <AtlasStep disabled={index === slots.length - 1} onStep={() => onSelect(index + 1)} label={isZh(lang) ? '下一个世界' : 'Next world'}><I.Chevron /></AtlasStep>
    </div>
  </div>
}

function AtlasStep({ disabled, onStep, label, children }: { disabled: boolean; onStep: () => void; label: string; children: ReactNode }) {
  const touch = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null)
  const consumedUntil = useRef(0)
  return <button className="atlas-step glass-dim" disabled={disabled} aria-label={label}
    onPointerDown={event => {
      if (!event.isPrimary || disabled) return
      consumedUntil.current = 0
      touch.current = null
      if (event.pointerType !== 'touch') return
      touch.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
    }}
    onPointerMove={event => {
      const start = touch.current
      if (start?.id === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) start.moved = true
    }}
    onPointerCancel={() => { touch.current = null }}
    onPointerUp={event => {
      const start = touch.current
      touch.current = null
      if (!start || start.id !== event.pointerId || disabled) return
      // This WebView can omit click on the first tap following a swipe. Act on
      // a clean touch release and consume its later compatibility click once.
      consumedUntil.current = performance.now() + 500
      const bounds = event.currentTarget.getBoundingClientRect()
      if (!start.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 8
        && event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom) onStep()
    }}
    onClick={event => { if (!disabled && (event.detail === 0 || performance.now() > consumedUntil.current)) onStep() }}>
    {children}
  </button>
}

/* 一颗平行世界：场景摄影作为星球表面，明暗交界 + 大气光晕 + 前后两半的轨道环 */
function Planet({ slot, size, residents, active, onResident }: { slot: AtlasSlot; size: number; residents: Person[]; active: boolean; onResident: (id: number) => void }) {
  const img = slot === 'unknown' ? COSMOS.swirl : WORLDS[slot].img
  const glow = slot === 'unknown' ? 'rgba(169,202,199,0.9)' : WORLDS[slot].glow
  const soft = glow.replace(/[\d.]+\)$/, '0.18)')
  const orbit = slot === 'unknown' ? '#a9cac7' : WORLDS[slot].accent
  const rw = size * 1.72; const rh = size * 0.42; const tilt = -13
  const ring = (front: boolean) => (
    <svg className="absolute pointer-events-none" style={{ left: (size - rw) / 2, top: (size - rh) / 2, width: rw, height: rh, transform: `rotate(${tilt}deg)` }} viewBox={`0 0 ${rw} ${rh}`} aria-hidden>
      <defs><linearGradient id={`ring-${slot}-${front}`} x1="0" x2="1"><stop offset="0" stopColor={orbit} stopOpacity="0.05" /><stop offset="0.5" stopColor={orbit} stopOpacity={front ? 0.8 : 0.35} /><stop offset="1" stopColor={orbit} stopOpacity="0.05" /></linearGradient></defs>
      <path d={front ? `M2 ${rh / 2} A ${rw / 2 - 2} ${rh / 2 - 2} 0 0 0 ${rw - 2} ${rh / 2}` : `M2 ${rh / 2} A ${rw / 2 - 2} ${rh / 2 - 2} 0 0 1 ${rw - 2} ${rh / 2}`} fill="none" stroke={`url(#ring-${slot}-${front})`} strokeWidth={front ? 1.4 : 1} />
    </svg>
  )
  const spot = (deg: number) => {
    const th = (deg * Math.PI) / 180; const x = (rw / 2 - 2) * Math.cos(th); const y = (rh / 2 - 2) * Math.sin(th)
    const r = (tilt * Math.PI) / 180
    return { left: size / 2 + x * Math.cos(r) - y * Math.sin(r), top: size / 2 + x * Math.sin(r) + y * Math.cos(r) }
  }
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <div className="absolute -inset-16 rounded-full pointer-events-none" style={{ background: `radial-gradient(circle, ${soft} 0%, rgba(0,0,0,0) 60%)` }} />
      {ring(false)}
      <div className="absolute inset-0 overflow-hidden rounded-full" style={{ boxShadow: `0 0 0 1px ${soft}, 0 22px 48px -22px rgba(0,0,0,0.55)` }}>
        <img src={img} alt="" className="absolute left-0 top-0 h-full max-w-none object-cover fx planet-pan" style={{ width: '145%' }} />
        <div className="absolute inset-0 rounded-full" style={{ background: 'radial-gradient(circle at 30% 26%, rgba(255,250,236,0.3) 0%, rgba(255,250,236,0) 34%), radial-gradient(circle at 74% 80%, rgba(3,9,11,0.5) 0%, rgba(3,9,11,0) 60%)' }} />
        <div className="absolute inset-0 rounded-full" style={{ boxShadow: 'inset -24px -28px 58px rgba(3,9,11,0.55), inset 10px 12px 28px rgba(255,243,220,0.2)' }} />
        {slot === 'unknown' && <div className="absolute inset-0 flex items-center justify-center"><I.Beacon className="h-12 w-12 text-core drop-shadow-[0_0_14px_rgba(235,201,149,0.9)]" weight="duotone" /></div>}
      </div>
      <div className="absolute -inset-[5px] rounded-full pointer-events-none" style={{ boxShadow: `0 0 0 1px ${soft}` }} />
      {ring(true)}
      {active && residents.slice(0, 3).map((p, i) => {
        const s = spot([150, 90, 30][i])
        return (
          <button key={p.id} onClick={(e) => { e.stopPropagation(); onResident(p.id) }} className="atlas-planet-resident absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center" style={{ ...s, animationDelay: `${0.2 + i * 0.1}s` }}>
            <Lens world={p.world} avatar={p.avatar} name={p.name} size={36} dark glow />
            <span className="mt-1 rounded-full bg-black/45 px-2 py-[1px] text-[11px] text-pearl/90 backdrop-blur-sm">{p.name}</span>
          </button>
        )
      })}
    </div>
  )
}

