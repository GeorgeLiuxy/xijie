import { useGiftState } from '../gifts/GiftLedger'
import { createPreviewOrder, updatePreviewOrder } from '../gifts/store'
import type { PreviewOrder } from './checkout'

export { PREVIEW_POSTAGE, previewQuote } from './checkout'
export type { CheckoutStatus, PaymentMethod, PreviewChannel, PreviewOrder } from './checkout'
export { createPreviewOrder, updatePreviewOrder }

const noOrders: PreviewOrder[] = []

export function usePreviewOrders(owner: string): PreviewOrder[] {
  return useGiftState(owner).previewOrders ?? noOrders
}
