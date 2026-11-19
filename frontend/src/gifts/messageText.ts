/** The same visible text is used by preview rows, service messages and history search. */
export function giftMessageText(direction: 'sent' | 'received', snapshot: { name: string; en: string }, quantity: number, note: string, zh: boolean) {
  const prefix = direction === 'received' ? (zh ? '[礼物] 收到' : '[Gift] Received') : (zh ? '[礼物] 送出' : '[Gift] Sent')
  return `${prefix} ${zh ? snapshot.name : snapshot.en} ×${quantity}${note ? ' · ' + note : ''}`
}
