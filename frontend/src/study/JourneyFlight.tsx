import { useEffect, useState } from 'react'
import { isZh, useI18n, type WorldId } from '../i18n'
import * as I from '../icons'
import { caption, interiorCrop, routes, type Images, type Route } from './journeys'
import './worldlines.css'

type Flight = { Player: typeof import('./FlightPlayer').FlightPlayer; images: Images }

async function decode(url: string) {
  const image = new Image()
  image.src = url
  await image.decode()
  return image
}

async function loadFlight(route: Route, sample: boolean): Promise<Images> {
  const { arrival, ...scenery } = route.plates
  const shots = await Promise.all(Object.entries(scenery).map(async ([name, url]) => [name, await decode(url)] as const))
  const plates = Object.fromEntries(shots) as Omit<Images, 'arrival'>
  if (sample) return { ...plates, arrival: await decode(arrival) }

  // Look past the photographed threshold. A personal search never decodes the sample actor.
  const crop = interiorCrop(route)
  const source = plates.close
  const inside = document.createElement('canvas')
  inside.width = Math.round(source.naturalWidth * crop.w)
  inside.height = Math.round(source.naturalHeight * crop.h)
  const ctx = inside.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.drawImage(source, source.naturalWidth * crop.x, source.naturalHeight * crop.y,
    source.naturalWidth * crop.w, source.naturalHeight * crop.h, 0, 0, inside.width, inside.height)
  return { ...plates, arrival: inside }
}

export function DestinationStill({ world, sample }: { world: WorldId; sample: boolean }) {
  const route = routes[world]
  const source = sample ? route.plates.arrival : route.plates.close
  const [failed, setFailed] = useState('')
  if (failed === source) return <img className="journey-still" src={route.plates.land} alt="" />
  if (sample) return <img className="journey-still" src={source} onError={() => setFailed(source)} alt="" />
  const { x, y, w, h } = interiorCrop(route)
  // The close plates share a 588 × 883 film gate. Match the canvas's final crop.
  return <svg className="journey-still" viewBox={[x*588,y*883,w*588,h*883].join(' ')} preserveAspectRatio="xMidYMid slice" aria-hidden>
    <image href={source} width="588" height="883" onError={() => setFailed(source)} />
  </svg>
}

export function JourneyFlight({ world, name, clue, sample, visible, quiet, onBack, onFinish }: {
  world: WorldId; name: string; clue: string; sample: boolean; visible: boolean; quiet: boolean
  onBack: () => void; onFinish: () => void
}) {
  const { lang } = useI18n()
  const zh = isZh(lang)
  const [flight, setFlight] = useState<Flight | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [paused, setPaused] = useState(false)
  const [captions, setCaptions] = useState(true)
  const [beat, setBeat] = useState(0)
  const [bearing] = useState(() => Math.random() * 2 - 1)
  useEffect(() => {
    let active = true
    Promise.all([loadFlight(routes[world], sample), import('./FlightPlayer')]).then(
      ([images, { FlightPlayer }]) => { if (active) setFlight({ images, Player: FlightPlayer }) },
      () => { if (active) setError(true) },
    )
    return () => { active = false }
  }, [world, sample, attempt])

  if (!visible) return null
  const [title, line] = caption(beat, world, lang, name, clue)
  const stage = beat < 2 ? 0 : beat < 7 ? 1 : beat < 10 ? 2 : 3
  const stages = zh ? ['此岸', '星域', '地表', '相遇'] : ['Shore', 'Stars', 'Surface', 'Encounter']
  return <section className="journey-flight" aria-label={zh ? '记忆穿梭' : 'Memory flight'}>
    {flight
      ? <flight.Player images={flight.images} world={world} bearing={bearing} paused={paused} quiet={quiet} onBeat={setBeat} onFinish={onFinish} />
      : <img className="journey-still" src={routes[world].plates.room} alt="" />}
    <div className="journey-top">
      <button className="journey-pill" onClick={onBack} aria-label={zh ? '返回记忆坐标' : 'Back to coordinates'}><I.Back /></button>
      {flight && <button className="journey-pill" onClick={() => setCaptions(!captions)} aria-pressed={captions}>
        {captions ? (zh ? '隐藏字幕' : 'Hide captions') : (zh ? '显示字幕' : 'Show captions')}
      </button>}
    </div>
    <div className="journey-panel">
      <div className="journey-eyebrow"><span />{zh ? '正在寻找' : 'Seeking'}<b>{name}</b></div>
      {flight ? <>
        <ol className="journey-range" aria-label={zh ? '定位进度' : 'Search progress'}>
          {stages.map((label, i) => <li key={label} data-on={i <= stage} aria-current={i === stage ? 'step' : undefined}>{label}</li>)}
        </ol>
        <div className={captions ? 'journey-reading' : 'sr-only'} aria-live="polite" aria-atomic="true">
          <h2>{title}</h2><p>{line}</p>
        </div>
      </> : <div className="journey-reading" role="status">
        <h2>{error ? (zh ? '航线暂时中断' : 'Flight interrupted') : (zh ? '正在校准航线' : 'Aligning the flight path')}</h2>
        <p>{error ? (zh ? '可以重新载入镜头，或直接前往相遇的位置。' : 'Reload the scenes or continue to the meeting place.') : clue}</p>
      </div>}
      <div className="journey-controls">
        {flight && <button onClick={() => setPaused(!paused)} aria-pressed={paused}>
          {paused ? (zh ? '继续穿梭' : 'Resume') : (zh ? '暂停' : 'Pause')}
        </button>}
        {error && <button onClick={() => { setError(false); setAttempt(n => n + 1) }}>{zh ? '重试' : 'Retry'}</button>}
        <button onClick={onFinish}>{zh ? '直接抵达' : 'Go to arrival'} <I.Chevron /></button>
      </div>
    </div>
  </section>
}
