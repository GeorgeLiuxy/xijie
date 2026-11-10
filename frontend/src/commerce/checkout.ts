export type PreviewChannel = 'mainland' | 'app-store' | 'google-play' | 'international-web'
export type PaymentMethod = 'wechat-pay' | 'alipay' | 'apple-iap' | 'play-billing' | 'card'
export type CheckoutStatus = 'unpaid' | 'confirming' | 'paid' | 'fulfilled' | 'cancelled' | 'failed'
export type CheckoutAction = 'submit' | 'cancel' | 'fail' | 'refresh'

export type PreviewOrder = {
  id: string
  channel: PreviewChannel
  method: PaymentMethod
  status: CheckoutStatus
  createdAt: number
  amount: number
  currency: 'CNY' | 'USD'
  postage: number
}

export const PREVIEW_POSTAGE = 40
const quotes: Record<PreviewChannel, { amount: number; currency: PreviewOrder['currency']; methods: PaymentMethod[] }> = {
  mainland: { amount: 600, currency: 'CNY', methods: ['wechat-pay', 'alipay'] },
  'app-store': { amount: 600, currency: 'CNY', methods: ['apple-iap'] },
  'google-play': { amount: 99, currency: 'USD', methods: ['play-billing'] },
  'international-web': { amount: 99, currency: 'USD', methods: ['card'] },
}
export const previewQuote = (channel: PreviewChannel) => quotes[channel]

export function isOpenOrder(order: PreviewOrder) {
  return order.status === 'unpaid' || order.status === 'confirming' || order.status === 'paid'
}
