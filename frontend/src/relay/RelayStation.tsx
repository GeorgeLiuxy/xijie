import { useEffect, useRef, useState } from "react"

import { LangProvider, isZh, useI18n, WORLD_IDS, type WorldId } from "../i18n"

import { destination, routes } from "../study/journeys"

import { GiftArt } from "../post/PostalArt"

import { PostalFlight } from "../post/PostalFlight"

import { fxPrefs, haptic, chime } from "../ui"

import type { Gift } from "../model"

import { wishes, type Wish, type Flight } from "./types"

import { homeFlight, relayUrl, request } from "./client"

import { FuelPort } from "./FuelPort"

import lens from "../post/assets/lens.webp"

import hangar from "../post/assets/hangar.webp"

import "./relay.css"

export function RelayEntry() {
  return (
    <LangProvider>
      <Station />
    </LangProvider>
  )
}

function Station() {
  const { lang } = useI18n(),
    zh = isZh(lang)

  const msg = (cn: string, en: string) => (zh ? cn : en)

  const initialId = location.pathname.match(/\/relay\/([^/]+)\/?$/)?.[1] ?? ""

  const [id, setId] = useState(initialId),
    [flight, setFlight] = useState<Flight | null>(null)

  const [loaded, setLoaded] = useState(false),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0)

  const [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [manualShare, setManualShare] = useState(false)

  const [screen, setScreen] =
    useState<"station" | "redeem" | "flight" | "receipt">("station")

  const [deliveryPhoto, setDeliveryPhoto] = useState("")
  const [ownReceipt, setOwnReceipt] = useState(false)
  const tear = useRef<number | null>(null)

  const requested = new URLSearchParams(location.search).get("world") as WorldId

  const [world, setWorld] = useState<WorldId>(
      WORLD_IDS.includes(requested) ? requested : "isles",
    ),
    [gift, setGift] = useState<Gift>("ball")

  const [message, setMessage] = useState("")

  const lock = useRef(false),
    createId = useRef("")

  const mounted = useRef(true)

  const calm =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    fxPrefs.calm

  function accept(next: Flight) {
    setFlight((old) =>
      old &&
      old.id === next.id &&
      (old.count > next.count || (old.returnParcel && !next.returnParcel))
        ? old
        : next,
    )

    setFailed(false)
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    let live = true,
      reading = false

    async function refresh() {
      if (reading) return
      reading = true

      try {
        if (id) {
          const f = await request<Flight>(id)
          if (live) accept(f)
        } else {
          const { flight: own, ticket } = await homeFlight()
          const creating = new URLSearchParams(location.search).has("new")
          const current = own && !(creating && own.count === own.capacity) ? own : creating ? null : ticket
          if (live) {
            if (current) {
              accept(current)
              setId(current.id)
              history.replaceState(null, "", relayUrl(current.id))
            } else {
              setFailed(false)
              setFlight(null)
            }
          }
        }
      } catch {
        if (live) setFailed(true)
      } finally {
        reading = false
        if (live) setLoaded(true)
      }
    }

    void refresh()

    const timer = window.setInterval(() => {
      if (!document.hidden && id) void refresh()
    }, 1500)

    document.addEventListener("visibilitychange", refresh)

    return () => {
      live = false
      clearInterval(timer)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [id, retry])

  async function commit(
    path: string,
    body: object,
    success?: (next: Flight) => void,
  ) {
    if (lock.current) return

    lock.current = true
    setBusy(true)
    setNotice("")

    try {
      const next = await request<Flight>(path, body)

      if (!mounted.current) return

      accept(next)
      success?.(next)
    } catch {
      if (mounted.current)
        setNotice(
          msg(
            "未能确认结果，请重试。重复操作只记一次。",
            "Could not confirm. Retry safely.",
          ),
        )
    } finally {
      lock.current = false
      if (mounted.current) setBusy(false)
    }
  }

  const create = () => {
    if (!createId.current) {
      const bytes = crypto.getRandomValues(new Uint8Array(16))

      bytes[6] = (bytes[6] & 15) | 64
      bytes[8] = (bytes[8] & 63) | 128

      const hex = Array.from(bytes, (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("")

      createId.current = [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20),
      ].join("-")
    }

    void commit("new", { id: createId.current, world, gift, message }, (f) => {
      setId(f.id)
      history.replaceState(null, "", relayUrl(f.id))
      haptic(12)
    })
  }

  function assist(wish: Wish) {
    if (!flight || flight.seat !== null) return
    void commit(id + "/fuel", { wish }, (f) => {
      if (f.seat === null) {
        setNotice(
          msg(
            "这班刚刚满员，可观看航程。",
            "This flight just filled. You can watch the passage.",
          ),
        )
        return
      }

      haptic([12, 30, 22])
      chime("connect")
    })
  }

  function redeem() {
    void commit(id + "/redeem", { world, gift }, () => {
      chime("tick")
      haptic(10)
      setScreen("station")
    })
  }

  function unseal() {
    tear.current = null
    chime("tick")
    haptic(8)
    setScreen("redeem")
  }

  async function share() {
    setNotice("")

    try {
      if (navigator.share)
        await navigator.share({
          title: msg("一起开一班虫洞邮船", "Join a wormhole flight"),
          text: inviteText,
          url: relayUrl(id),
        })
      else {
        await navigator.clipboard.writeText(inviteText + "\n" + relayUrl(id))
        setNotice(msg("航票和寄件说明已复制。", "Invitation link copied."))
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setManualShare(true)
    }
  }

  const scene = flight ? routes[flight.world] : routes[world]

  const worldName = destination(flight?.world ?? world, lang)

  const me = flight?.seat,
    helper = me != null && me > 0,
    full = !!flight && flight.count === flight.capacity

  const cargoName = flight?.gift === "cloth" ? msg("条纹方巾","woven scarf") : msg("旧红球","red ball")
  const left = flight ? flight.capacity - flight.count : 0
  const inviteText = [
    flight?.message,
    full ? msg(`「${cargoName}」已启航，一起看它抵达${worldName.place}。`, `Follow the ${cargoName} to ${worldName.place}.`) :
      msg(`「${cargoName}」要寄到${worldName.place}，发出时还差 ${left} 份补给。捎一句祝愿，你也能寄一件回程礼物。`,
          `Help send the ${cargoName} to ${worldName.place}. ${left} charges left at sharing. Enclose a wish and get postage for your own parcel.`),
  ].filter(Boolean).join("\n")

  const controls = (label: string) => (
    <fieldset className="rw-choices">
      <legend>{label}</legend>
      <select
        value={world}
        aria-label={msg("收件坐标", "Destination")}
        onChange={(e) => setWorld(e.target.value as WorldId)}
      >
        {WORLD_IDS.map((w) => (
          <option key={w} value={w}>
            {destination(w, lang).place}
          </option>
        ))}
      </select>
      <div>
        {(["ball", "cloth"] as Gift[]).map((g) => (
          <button
            type="button"
            key={g}
            aria-pressed={gift === g}
            onClick={() => setGift(g)}
          >
            <GiftArt gift={g} />
            {g === "ball"
              ? msg("旧红球", "Red ball")
              : msg("条纹方巾", "Woven scarf")}
          </button>
        ))}
      </div>
    </fieldset>
  )

  const header = (
    <header className="rw-header">
      <a
        href={import.meta.env.BASE_URL}
        aria-label={msg("回到西界", "Back to Elysium")}
      >
        ‹
      </a>
      <span>ELYSIUM　/　{msg("联运港", "SHARED PORT")}</span>
      <strong>{id ? id.slice(0, 6).toUpperCase() : "PORT 07"}</strong>
    </header>
  )

  const info = (
    <p className="rw-notice" role="status">
      {notice ||
        (failed
          ? msg("连接中断，正在重新核对航班。", "Reconnecting to flight.")
          : null)}
    </p>
  )

  let content

  if (!loaded || (!flight && failed))
    content = (
      <div className="rw-sheet">
        <h2>
          {failed
            ? msg("未读到这张航票", "Flight unavailable")
            : msg("读取航票…", "Opening ticket…")}
        </h2>
        {failed && (
          <button onClick={() => setRetry((x) => x + 1)}>
            {msg("重新读取", "Retry")}
          </button>
        )}
      </div>
    )
  else if (!flight)
    content = (
      <>
        <div
          className="rw-portintro"
          style={{
            backgroundImage: `linear-gradient(0deg,#10181bef,transparent 75%),url(${hangar})`,
          }}
        >
          <small>01　/　OUTBOUND</small>
          <h1>{msg("给这件礼物开一班船", "A flight for your gift")}</h1>
          <p>
            {msg(
              "你投下第一份补给，邀三位同行者接通航道。",
              "Start the route and invite three fellow travellers.",
            )}
          </p>
        </div>
        <div className="rw-sheet">
          {controls(msg("装入第一件寄件", "Load your parcel"))}
          <label className="rw-note-input">
            {msg(
              "给同行者的话（公开，可留空）",
              "Note to travellers (public, optional)",
            )}
            <input
              value={message}
              maxLength={60}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={msg(
                "它以前最喜欢追这颗球。",
                "This was her favourite ball.",
              )}
            />
          </label>
          <button className="rw-primary" disabled={busy} onClick={create}>
            {msg("封件 · 发起联运", "Seal & open flight")}
          </button>
          <p className="rw-fine">
            {msg(
              "航票公开航线、物件、补给数和你写下的这句话。试航中寄送的都是虚拟物件。",
              "Invites show the route, cargo, fuel and your note. All parcels are virtual.",
            )}
          </p>
          {info}
        </div>
      </>
    )
  else if (screen === "flight") {

    const target = (ownReceipt && flight.returnParcel) || flight
    content = (
      <div className="pp-game pp-flight rw-fly">
        <PostalFlight
          active
          zh={zh}
          calm={calm}
          world={target.world}
          parcelId={flight.id}
          lensArt={lens}
          convoy
          opening={0.79}
          consignment={msg("四处信标已合频，编队获准离港。","All four beacons are linked. Follow the outbound parcel into port.")}
          onLand={(_stamps, _skipped, photo) => {setDeliveryPhoto(photo ?? "");setScreen("receipt")}}
        />
      </div>
    )
  } else if (screen === "receipt") {
    const cargo = (ownReceipt && flight.returnParcel) || flight,
      site = destination(cargo.world, lang)

    content = (
      <>
        <div className="rw-receipt">
          <img src={deliveryPhoto || routes[cargo.world].plates.close} alt={site.place} />
          {!deliveryPhoto && <i><GiftArt gift={cargo.gift} /></i>}
          <span>{site.door}</span>
        </div>
        <div className="rw-sheet">
          <small>POSTMARK　/　{flight.id.slice(0, 6).toUpperCase()}</small>
          <h2>{msg("停靠处投递留影", "Delivery print")}</h2>
          <p>
            {site.place}　·　
            {ownReceipt
              ? msg("你的回程捎件", "Your return parcel")
              : msg("本班寄件", "Outbound parcel")}
          </p>
          {!ownReceipt && flight.wishes.some(Boolean) && <ul className="rw-letters" aria-label={msg("随船抵达的祝愿","Wishes aboard")}>
            {flight.wishes.map((wish,i)=>wish && <li key={i}><small>0{i+1}</small>{wishes[wish][zh?0:1]}</li>)}
          </ul>}
          <button className="rw-primary" onClick={() => setScreen("station")}>
            {msg("回到航票", "Back to ticket")}
          </button>
        </div>
      </>
    )
  } else if (screen === "redeem")
    content = (
      <div className="rw-sheet rw-booking">
        <small>RETURN POSTAGE　/　{String((me ?? 0) + 1).padStart(2, "0")}</small>
        <h1>{msg("让回程带上一件", "Send something back")}</h1>
        <p>
          {msg(
            "邮票含一次虚拟回程捎件。选好后占一个舱位，不再消耗燃料。航班开窗后，可查看寄件留影。",
            "One virtual return parcel is included. The delivery print opens with the flight.",
          )}
        </p>
        {controls(msg("回程收件地与物件", "Return destination & cargo"))}
        <button className="rw-primary" disabled={busy} onClick={redeem}>
          {msg("盖销邮票，装入回程舱", "Redeem & load parcel")}
        </button>
        <button className="rw-minor" onClick={() => setScreen("station")}>
          {msg("稍后再用", "Keep for later")}
        </button>
        {info}
      </div>
    )
  else
    content = (
      <>
        <div className="rw-mission">
          <small>TRANSIT WINDOW　/　{worldName.planet}</small>
          <h1>
            {full
              ? msg("虫洞已开窗", "Passage open")
              : me === 0
                ? msg("等这班船出发", "Awaiting departure")
                : helper
                  ? msg("信号已接通", "Signal received")
                  : msg("帮这件礼物穿过虫洞", "Send this gift through")}
          </h1>
          <p>
            {worldName.place}　·　{msg("还差", "Remaining")}{" "}
            {flight.capacity - flight.count} {msg("份补给", "charges")}
          </p>
          {flight.message && (
            <blockquote className="rw-publicnote">{flight.message}</blockquote>
          )}
        </div>
        <FuelPort
          flight={flight}
          sky={scene.plates.planet}
          zh={zh}
          busy={busy}
          onFuel={assist}
        />
        <div className="rw-sheet">
          <div className="rw-line">
            <b>
              {full
                ? msg("四处信标已合频", "All beacons aligned")
                : msg("航道接通", "Beacons online")}
            </b>
            <span>{String(flight.count).padStart(2, "0")} / 04</span>
          </div>
          {helper ? (
            <div
              className={"rw-postage " + (flight.returnParcel ? "used" : "")}
            >
              <small>
                ELY　/　RETURN POSTAGE　　№ {String(me + 1).padStart(2, "0")}
              </small>
              <p className="rw-signed">
                {msg("你接通了信标", "You lit beacon")} 0{me + 1}
              </p>
              <h2>
                {flight.returnParcel
                  ? msg("回程舱已留给你", "Your cargo is booked")
                  : msg("给你的一张回程邮票", "Your return postage")}
              </h2>
              <p>
                {flight.returnParcel
                  ? destination(flight.returnParcel.world, lang).place
                  : msg(
                      "可随本班回程捎一件礼物，满班后仍可使用。",
                      "One virtual return parcel. Valid even after departure.",
                    )}
              </p>
              {flight.returnParcel && full && <button onClick={() => {setDeliveryPhoto("");setOwnReceipt(true); setScreen("flight")}}>
                {msg("查看我的回程投递","See my return delivery")}
              </button>}
              {!flight.returnParcel && (
                <button
                  className="rw-tear"
                  onClick={unseal}
                  onPointerDown={(e) => {
                    tear.current = e.clientX
                    e.currentTarget.setPointerCapture(e.pointerId)
                  }}
                  onPointerMove={(e) => {
                    if (tear.current !== null) {
                      const dx = e.clientX - tear.current
                      e.currentTarget.style.setProperty(
                        "--peel",
                        Math.max(0, Math.min(1, dx / 95)).toString(),
                      )
                      if (dx > 95) unseal()
                    }
                  }}
                  onPointerCancel={(e) => {
                    tear.current = null
                    e.currentTarget.style.removeProperty("--peel")
                  }}
                  onPointerUp={(e) => {
                    tear.current = null
                    e.currentTarget.style.removeProperty("--peel")
                  }}
                >
                  {msg("撕开邮票 · 捎一件　→", "Peel to send　→")}
                </button>
              )}
            </div>
          ) : (
            <p className="rw-desc">
              {me === 0
                ? msg(
                    "你的寄件已装船。每位同行者接通一处信标，四处就位后启航。",
                    "Your cargo is aboard. Four signals open the passage.",
                  )
                : full
                  ? msg(
                      "你来时这班已满，仍可看它抵达。",
                      "This flight is full. Watch the arrival.",
                    )
                  : msg(
                      "送出一份燃料，航线多一处信标；你会收到一次回程捎件的邮资。",
                      "Send fuel to light one beacon and receive one return postage.",
                    )}
            </p>
          )}
          {full && (
            <button className="rw-primary" onClick={() => {setDeliveryPhoto("");setOwnReceipt(false);setScreen("flight")}}>
              {msg("随船穿越虫洞", "Follow the flight")}
            </button>
          )}
          {!full && me !== null && (
            <button
              className={"rw-" + (helper ? "minor" : "primary")}
              onClick={share}
            >
              {helper
                ? msg("把航票递给下一位", "Pass the ticket on")
                : msg("邀请同行 · 分享航票", "Invite a traveller")}
            </button>
          )}
          {full && (
            <button className="rw-minor" onClick={share}>
              {msg("分享这班航程", "Share this flight")}
            </button>
          )}
          {full && me !== 0 && (
            <a className="rw-minor" href={relayUrl() + "?new=1"}>
              {msg("发起我自己的下一班", "Open my own flight")}
            </a>
          )}
          {full && me === 0 && (
            <button
              className="rw-minor"
              onClick={() => {
                createId.current = ""
                setFlight(null)
                setId("")
                history.replaceState(null, "", relayUrl() + "?new=1")
                setScreen("station")
              }}
            >
              {msg("准备下一班", "Prepare another flight")}
            </button>
          )}
          {manualShare && (
            <label className="rw-link">
              {msg("复制这张航票", "Copy this ticket")}
              <input
                readOnly
                value={inviteText + " " + relayUrl(id)}
                onFocus={(e) => e.target.select()}
              />
            </label>
          )}
          {info}
          <p className="rw-fine">
            {msg(
              "试航规则 · 每个浏览器每班一次。邮票仅用于虚拟寄件。",
              "Pilot: one contribution per browser per flight. Virtual postage only.",
            )}
          </p>
        </div>
      </>
    )

  return (
    <main className="rw-stage">
      <article
        className="rw-phone"
        aria-label={msg("虫洞联运", "Shared flight")}
      >
        {header}
        {content}
      </article>
    </main>
  )
}
