import { useEffect, useRef, useState } from "react"
import type { WorldId } from "../i18n"
import { destination } from "../study/journeys"
import { haptic } from "../ui"
import type { createCinematic } from "./cinematic/engine"
import "./cinematic/cinematic.css"

type Engine = ReturnType<typeof createCinematic>

export function PostalFlight({ zh, active, consignment, world, parcelId, calm, onLand, items = [] }: {
  zh: boolean
  active: boolean
  consignment: string
  world: WorldId
  parcelId: string
  calm: boolean
  items?: {giftId:string;quantity:number}[]
  // Existing callers may still provide their former flight-plate options.
  lensArt?: string
  convoy?: boolean
  opening?: number
  onLand: (stamps: number, skipped?: boolean, photo?: string) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const engine = useRef<Engine | null>(null)
  const finish = useRef(onLand), underway = useRef(active), ended = useRef(false)
  finish.current = onLand
  underway.current = active
  const [phase, setPhase] = useState(0), [progress, setProgress] = useState(0)
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0), [paused, setPaused] = useState(false), [holding, setHolding] = useState(false)
  const [names,setNames] = useState<{cn:string;en:string}[]>([])
  const drag = useRef<{x:number;y:number;offsetX:number;offsetY:number}|null>(null)
  const orbit = useRef({x:0,y:0})
  const site = destination(world,zh?"zh-CN":"en")
  const code = parcelId.slice(0,6).toUpperCase()
  const manifest = JSON.stringify(items)
  function complete(skipped=false,photo="") {
    if(ended.current)return
    ended.current=true
    engine.current?.setActive(false)
    finish.current(0,skipped,photo||undefined)
  }
  useEffect(()=>{
    let live=true
    let own:Engine|null=null
    setReady(false);setFailed(false);setPaused(false)
    import("./cinematic/engine").then(({createCinematic,stages})=>{
      if(!live||!canvas.current)return
      setNames(stages.map(s=>({cn:s.cn,en:s.en})))
      try {
        own=createCinematic(canvas.current,world,parcelId,calm,
          f=>{if(live){setPhase(f.phase);setProgress(f.progress)}},
          photo=>{if(live)complete(false,photo)},
          ()=>{if(live)setFailed(true)},JSON.parse(manifest))
        engine.current=own
        own.setActive(underway.current)
        setReady(true)
      }catch{setFailed(true)}
    }).catch(()=>{if(live)setFailed(true)})
    return()=>{live=false;own?.dispose();engine.current=null}
  },[world,parcelId,calm,attempt,manifest])
  useEffect(()=>{engine.current?.setActive(active)},[active])
  useEffect(()=>{engine.current?.setPaused(paused)},[paused])
  useEffect(()=>{if(phase!==5){engine.current?.setHold(false);setHolding(false)}},[phase])
  function release(){engine.current?.setHold(false);setHolding(false)}
  const notes = zh ? [
    "舰体从出口进入目标空域，编队依次通行。",
    "反推减速，调整姿态，对准着陆坪。",
    "起落架接地，减震支柱吸收载荷。",
    "后舱门向两侧开启，接通舱内工作灯。",
    "升降台抬到货舱地板高度，搭好接驳桥。",
    "同一托寄件沿滚床移出，落在升降台上。",
    "带货升降车退出舱口，对接片区货车。",
    "整托寄件随货车运到片区站，战舰留在基地。",
    "无人机锁住这一件寄件，旋翼升速。",
    `携带寄件抵近${site.door}，减速下降。`,
    '包裹已交付投递点，无人机解除锁扣。',
  ] : [
    "The ship emerges into the receiving world.",
    "Braking and aligning with the landing apron.",
    "Landing struts settle under the ship’s weight.",
    "The hold opens. Interior work lights come on.",
    "The lift rises to the cargo floor and bridges the gap.",
    "The same pallet rolls onto the lift platform.",
    "The loaded lift backs away and meets the district hauler.",
    "The hauler takes the batch. The ship stays at base.",
    "The drone locks onto one parcel and spins up.",
    `Approaching ${site.door} with the parcel.`,
    'Parcel delivered to the drop-off point. Cargo lock released.',
  ]
  return <div className="pp-flight cinema" inert={!active} aria-hidden={!active}>
    <div className="cinema-view">
      <canvas ref={canvas} className="cinema-canvas" aria-label={zh?"可环视的三维运送场景":"Interactive 3D delivery scene"}
        onPointerDown={e=>{if(!ready||failed)return;e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,offsetX:orbit.current.x,offsetY:orbit.current.y}}}
        onPointerMove={e=>{const d=drag.current;if(!d)return;orbit.current={x:Math.max(-.6,Math.min(.6,d.offsetX+(e.clientX-d.x)*.003)),y:Math.max(-.5,Math.min(.5,d.offsetY+(e.clientY-d.y)*.003))};engine.current?.setOrbit(orbit.current.x,orbit.current.y)}}
        onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}} />
      <div className="cinema-hud" aria-hidden="true"><span>ELY / FREIGHT　{code}</span><b>{zh?"舱外观察":"EXTERNAL CAMERA"}</b></div>
      {ready&&!failed&&<span className="cinema-hint">{zh?"拖动画面 · 环视":"Drag to look around"}</span>}
      {(!ready||failed)&&<div className="cinema-load" role="status"><small>ELY / FREIGHT</small><p>{failed?(zh?"场景未能载入":"Scene unavailable"):(zh?"正在准备舰体和地勤设备…":"Preparing the ship and ground crew…")}</p>{failed&&<button onClick={()=>setAttempt(n=>n+1)}>{zh?"重新载入":"Retry"}</button>}</div>}
    </div>
    <div className="pp-flightpanel cinema-panel">
      <div className="pp-code">{site.planet}　/　{String(phase+1).padStart(2,"0")}</div>
      <h2 aria-live="polite">{names[phase]?.[zh?"cn":"en"]??(zh?"准备启航":"Preparing departure")}</h2>
      <p>{phase===0?consignment:notes[phase]}</p>
      <div className="cinema-progress" role="progressbar" aria-label={zh?"运送进程":"Delivery progress"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress*100)}><i style={{transform:`scaleX(${progress})`}}/></div>
      <div className="pp-row">
        {phase===5&&ready&&!failed&&<button className="cinema-hold" aria-pressed={holding}
          disabled={paused}
          onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);engine.current?.setHold(true);setHolding(true);haptic(10)}}
          onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release} onBlur={release}
          onKeyDown={e=>{if(e.key===" "||e.key==="Enter"){e.preventDefault();engine.current?.setHold(true);setHolding(true)}}}
          onKeyUp={e=>{if(e.key===" "||e.key==="Enter"){e.preventDefault();release()}}}>
          {holding?(zh?"正在协助卸载":"Assisting transfer"):(zh?"按住协助卸载":"Hold to assist")}
        </button>}
        {ready&&!failed&&<button className="cinema-pause" onClick={()=>{release();setPaused(n=>!n)}}>{paused?(zh?"继续":"Continue"):(zh?"暂停":"Pause")}</button>}
        <button onClick={()=>complete(true)}>{items.length?(zh?"结束观看":"Finish watching"):(zh?"直接抵达":"Land now")}</button>
      </div>
    </div>
  </div>
}
