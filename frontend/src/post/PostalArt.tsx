import type { Gift } from "../model"
import { GiftIcon } from '../gifts/GiftIcon'

import carrier from "./assets/carrier.webp"

import ball from "./assets/ball.webp"

import cloth from "./assets/cloth.webp"

export function GiftArt({ gift }: { gift: Gift }) {
  if(gift!=='ball'&&gift!=='cloth')return <GiftIcon id={gift} className="pp-giftart"/>
  return (
    <img
      className="pp-giftart"
      src={gift === "ball" ? ball : cloth}
      alt=""
      draggable={false}
    />
  )
}

export function Courier({ engines = false }: { engines?: boolean }) {
  return (
    <span className="pp-courier" aria-hidden="true">
      <img src={carrier} alt="" draggable={false} />
      {engines && (
        <span className="pp-engines">
          <i />
          <i />
          <i />
          <i />
        </span>
      )}
    </span>
  )
}
