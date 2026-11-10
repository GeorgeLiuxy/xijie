import { useEffect, useRef, useState, type CSSProperties } from "react"
import { GiftArt } from "../post/PostalArt"
import lens from "../post/assets/lens.webp"
import carrier from "../post/assets/carrier.webp"
import { wishes, type Wish, type Flight } from "./types"
import { RelayLens } from "./RelayLens"

const anchors = [
  [26, 137],
  [89, 250],
  [316, 241],
  [382, 113],
]
export function FuelPort({
  flight,
  sky,
  zh,
  busy,
  onFuel,
}: {
  flight: Flight
  sky: string
  zh: boolean
  busy: boolean
  onFuel: (wish: Wish) => void
}) {
  const start = useRef<{ y: number; distance: number } | null>(null)
  const [pull, setPull] = useState(0),
    [cancelled, setCancelled] = useState(false)
  const previous = useRef({ id: flight.id, count: flight.count }),
    [surge, setSurge] = useState(false)
  useEffect(() => {
    const last = previous.current
    previous.current = { id: flight.id, count: flight.count }
    if (last.id !== flight.id || last.count >= flight.count) return
    setSurge(true)
    const timer = window.setTimeout(() => setSurge(false), 1000)
    return () => clearTimeout(timer)
  }, [flight.id, flight.count])
  const [wish, setWish] = useState<Wish>("light")
  const [selected, setSelected] = useState<number | null>(null)
  const displaySeat = selected ?? flight.count - 1
  const chosen = flight.wishes[displaySeat]
  const [travel, setTravel] = useState(100)
  const eligible = flight.count < flight.capacity && flight.seat === null
  const aperture =
    8 + flight.count * 6 + (flight.count === 4 ? 11 : 0) + pull * 10
  function release() {
    const d = start.current
    if (!d) return
    start.current = null
    if (Math.abs(d.distance) < 7 || d.distance >= 55) {
      setCancelled(false)
      onFuel(wish)
    } else {
      setPull(0)
      setCancelled(true)
    }
  }
  useEffect(() => {
    if (!busy) setPull(0)
  }, [busy])
  return (
    <div
      className={
        "rw-port " +
        (busy ? "energizing" : "") +
        (surge ? " received" : "") +
        (flight.count === 4 ? " open" : "")
      }
      style={{ "--pull": pull, "--travel": travel + "px" } as CSSProperties}
    >
      <div className="rw-plate" aria-hidden="true">
        <img
          src={lens}
          alt=""
          style={{
            transform: `scale(${0.95 + flight.count * 0.1 + pull * 0.06})`,
          }}
        />
        <i
          style={{
            backgroundImage: `url(${sky})`,
            width: aperture * 2 + "px",
            height: aperture * 2 + "px",
          }}
        />
      </div>
      <RelayLens
        sky={sky}
        level={Math.min(
          0.79,
          [0, 0.12, 0.42, 0.62, 0.79][flight.count] + pull * 0.075,
        )}
      />
      <svg
        viewBox="0 0 400 300"
        preserveAspectRatio="none"
        role="img"
        aria-label={
          zh
            ? `航线已连接 ${flight.count} 处信标`
            : `${flight.count} beacons connected`
        }
      >
        {anchors.map(([x, y], i) => {
          const on = i < flight.count
          return (
            <g key={i} className={on ? "lit" : ""}>
              <circle
                cx={x}
                cy={y}
                r="7"
                fill="#0a151d"
                stroke={on ? "#edc48b" : "#607278"}
              />
              <circle
                cx={x}
                cy={y}
                r={on ? 4 : 1}
                fill={on ? "#ffe4b1" : "#72878c"}
              />
              <text
                x={x}
                y={y - 13}
                textAnchor="middle"
                fill={on ? "#f1d6a5" : "#a6b4b5"}
              >
                {i === flight.seat ? (zh ? "我 · " : "ME · ") : ""}0{i + 1}
              </text>
            </g>
          )
        })}
        {flight.count === 4 && (
          <image
            className="rw-undock"
            href={carrier}
            x="155"
            y="166"
            width="65"
            height="40"
          />
        )}
      </svg>
      {!eligible && anchors.slice(0, flight.count).map(([x,y],i) =>
        <button key={i} className="rw-signal-hit"
          style={{left: x/4+"%", top: y/3+"%"}}
          aria-label={(zh ? "查看信标 " : "Read beacon ") + (i+1)}
          aria-pressed={displaySeat===i} onClick={()=>setSelected(i)} />)}
      {!eligible && <output className="rw-radio">0{displaySeat+1}　/　{
        chosen ? wishes[chosen][zh?0:1] : displaySeat===0 ? (zh?"寄件已封舱":"Outbound cargo sealed") : (zh?"补给已接入":"Fuel received")}</output>}
      {eligible && <label className="rw-wish">
        <span>{zh ? "捎一句祝愿" : "Enclose a wish"}</span>
        <select value={wish} disabled={busy} onChange={e=>setWish(e.target.value as Wish)}>
          {(Object.keys(wishes) as Wish[]).map(k=><option key={k} value={k}>{wishes[k][zh?0:1]}</option>)}
        </select>
      </label>}
      <div className="rw-manifest">
        <GiftArt gift={flight.gift} />
        <span>
          CGO / 01
          <b>
            {flight.gift === "ball"
              ? zh
                ? "旧红球"
                : "Red ball"
              : zh
                ? "条纹方巾"
                : "Woven scarf"}
          </b>
        </span>
      </div>
      {eligible && (
        <div className="rw-transfer">
          <button
            className="rw-core"
            disabled={busy}
            aria-label={zh ? "送入补给芯" : "Send fuel cell"}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              start.current = { y: e.clientY, distance: 0 }
              setCancelled(false)
              const port = e.currentTarget
                .closest(".rw-port")!
                .getBoundingClientRect()
              const cell = e.currentTarget.getBoundingClientRect()
              setTravel(
                Math.max(
                  55,
                  cell.top + cell.height / 2 - port.top - port.height * 0.44,
                ),
              )
            }}
            onPointerMove={(e) => {
              if (!start.current) return
              start.current.distance = start.current.y - e.clientY
              setPull(Math.min(1, Math.max(0, start.current.distance / travel)))
            }}
            onPointerUp={release}
            onPointerCancel={() => {
              start.current = null
              setPull(0)
            }}
            onClick={(e) => {
              if (e.detail === 0 && !busy) onFuel(wish)
            }}
          >
            <i className="rw-canister">
              <b />
              <em />
              <b />
            </i>
          </button>
          <span>
            {busy
              ? zh
                ? "正在接驳…"
                : "Connecting…"
              : cancelled
                ? zh
                  ? "再向上推一点，或轻点补给芯"
                  : "Push a little further or tap"
                : zh
                  ? "向上推送补给芯 · 也可轻点"
                  : "Push upward or tap to send"}
          </span>
        </div>
      )}
    </div>
  )
}
