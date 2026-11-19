import type { WorldId } from '../i18n'
import type { PreviewOrder } from '../commerce/checkout'

export type Audience = 'person' | 'pet' | 'object'
export type GiftEffect = 'keepsake' | 'prop' | 'scene' | 'build' | 'service' | 'fuel'
export type GiftCategory = 'emotion' | 'care' | 'pet' | 'home' | 'collection' | 'scenery' | 'experience' | 'journey'
export type GiftDefinition = {
  id: string
  version: number
  name: string
  en: string
  category: GiftCategory
  icon: string
  cost: number
  effect: GiftEffect
  outcome: string
  outcomeEn: string
  audience: Audience[]
  stackable: boolean
  available: boolean
  render: 'flower' | 'lamp' | 'plant' | 'cloth' | 'ball' | 'frame' | 'furniture' | 'keepsake' | 'scene' | 'package'
}
export type GiftTarget = { id: number; identity?: string; name: string; world: WorldId; audience: Audience }
export type GiftOpenOptions = {
  presentation?: 'compact' | 'full'
  tab?: 'catalog' | 'bag' | 'goals' | 'receipts' | 'received'
  goalId?: string
  receiptId?: string
  giftId?: string
  source?: 'reward' | 'inventory' | 'trial'
}
export type GiftLine = { giftId: string; quantity: number; snapshot: GiftDefinition }
export type GiftReceipt = {
  status?: 'in_transit' | 'arrived' | 'delivery_failed'
  serverVersion?: number
  debitTransactionId?: string | null
  id: string
  target: GiftTarget
  lines: GiftLine[]
  note: string
  createdAt: number
  arriveAt: number
  source: 'trial' | 'inventory' | 'reward'
  cost: number
  deliveryPhoto?: string
  personaReply?: boolean
}
export type ReceivedGift = {
  serverVersion?: number
  displayable?: boolean
  id: string
  from: GiftTarget
  lines: GiftLine[]
  note: string
  createdAt: number
  origin: 'persona'
  replyTo?: string
  openedAt?: number
  placement?: 'record' | 'space'
}
export type ReceiveGiftInput = {
  id: string
  from: GiftTarget
  giftId: string
  quantity: number
  note: string
  createdAt?: number
  origin: 'persona'
  replyTo?: string
}
export type GiftState = {
  version: 1
  credits: number
  inventory: Record<string, number>
  entitlements: Record<string, number>
  receipts: GiftReceipt[]
  received?: ReceivedGift[]
  usedRewards: string[]
  previewOrders?: PreviewOrder[]
  goals?: GiftGoalLink[]
}
export type GiftGoalLink = { id: string; target: GiftTarget; kind: GoalKind; createdAt: number }
export type GiftSendInput = {
  requestId: string
  target: GiftTarget
  giftId: string
  quantity: number
  note: string
  source: 'trial' | 'inventory' | 'reward'
}
export type GoalKind = 'flight' | 'home' | 'album'
export type GoalContribution = { seat: number; text: string; value: number; part?: string;contributionId?:string;version?:number;status?:'pending'|'approved'|'rejected'|'withdrawn';adoption?:{status:'pending'|'fulfilled'|'revoked';memoryId?:string}|null }
export type GiftGoal = {
  album?:{url:string|null;version?:number;personId?:string;createdAt?:string;status:string;ownContribution?:import('../serviceAlbums').AlbumContribution|null;viewerScope?:import('../serviceAlbums').AlbumViewerScope}
  id: string
  kind: GoalKind
  name: string
  world: WorldId
  message: string
  current: number
  target: number
  parts: string[]
  contributions: GoalContribution[]
  isOwner: boolean
  canHelp: boolean
  helped: boolean
  rewardToken: string | null
  completed: boolean
}
