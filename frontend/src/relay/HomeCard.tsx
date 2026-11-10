import { useEffect, useState } from "react"

import { isZh, useI18n, type WorldId } from "../i18n"

import { destination } from "../study/journeys"

import type { Flight } from "./types"

import { homeFlight, relayUrl } from "./client"

import "./home-card.css"

export function RelayHomeCard({ world }: { world?: WorldId }) {
  const { lang } = useI18n(),
    zh = isZh(lang)

  const [ticket, setTicket] = useState<Flight | null>(null)
  const [own, setFlight] = useState<Flight | null>(null)

  useEffect(() => {
    let alive = true

    function refresh() {
      if (!document.hidden)
        homeFlight()
          .then((r) => {
            if (alive) {setFlight(r.flight);setTicket(r.ticket)}
          })
          .catch(() => {})
    }

    refresh()
    const id = window.setInterval(refresh, 4000)

    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  const flight = own ?? ticket
  if (!flight) return null
  const full = flight?.count === flight?.capacity && !!flight

  return (
    <>
    <a
      className="rw-home"
      href={flight ? relayUrl(flight.id) : relayUrl() + "?world=" + world}
    >
      <span>
        <small>ELY / SHARED DEPARTURE</small>
        <b>
          {flight && flight.seat !== 0 ? (zh ? "我的回程邮票" : "My return postage")
            : flight ? (full ? (zh ? "航班已开窗" : "Passage open") : (zh ? "继续这班联运" : "Your shared flight"))
            : (zh ? "发起虫洞联运" : "Open a shared flight")}
        </b>
        <em>
          {flight
            ? `${destination(flight.world, lang).place}　·　${flight.count}/${flight.capacity}`
            : zh
              ? "寄一件礼物，邀人一起打开虫洞"
              : "Send a gift and open a passage together"}
        </em>
      </span>
      <i aria-hidden="true">↗</i>
    </a>
    {own && ticket && <a className="rw-home-ticket" href={relayUrl(ticket.id)}>{zh ? "查看我领到的回程邮票" : "View my return postage"}　↗</a>}
    </>
  )
}
