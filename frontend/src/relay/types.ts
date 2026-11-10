import type { Gift } from "../model"
import type { WorldId } from "../i18n"

export const wishes = {
  light: ["愿你沿路有光", "May light follow you"],
  stars: ["替我看看那里的星星", "See the stars for me"],
  warmth: ["天凉了，记得添衣", "Keep warm out there"],
} as const
export type Wish = keyof typeof wishes

export type ReturnParcel = { world: WorldId; gift: Gift }
export type Flight = {
  id: string
  world: WorldId
  gift: Gift
  message: string
  wishes: (Wish | null)[]
  count: number
  capacity: number
  seat: number | null
  returnParcel: ReturnParcel | null
}
