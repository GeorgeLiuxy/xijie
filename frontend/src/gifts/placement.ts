import type { GiftDefinition, ReceivedGift } from './types'

export type Zone = 'flowers' | 'seat' | 'door'
export type Shape = 'bouquet' | 'plant' | 'ball' | 'cloth' | 'cushion' | 'mat' | 'lantern'

export function decoration(gift: GiftDefinition): [Zone, Shape] | null {
  if (gift.available === false) return null
  switch (gift.id) {
    case 'flowers': return ['flowers', 'bouquet']
    case 'ball': return ['seat', 'ball']
    case 'cloth': return ['seat', 'cloth']
    case 'cushion': return ['seat', 'cushion']
    case 'sun-mat': return ['seat', 'mat']
    case 'star-lamp':
    case 'path-lamp':
    case 'beacon': return ['door', 'lantern']
    default: return gift.effect === 'prop' && gift.render === 'plant' && gift.id !== 'feather'
      ? ['flowers', 'plant'] : null
  }
}

export function canPlaceGift(gift: GiftDefinition): boolean {
  return decoration(gift) !== null
}

export function canDisplayReceivedGift(gift: ReceivedGift): boolean {
  return gift.lines.length > 0 && gift.lines.every(line => line.quantity > 0 && canPlaceGift(line.snapshot))
}
