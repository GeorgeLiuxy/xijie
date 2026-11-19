// Payment redirects are navigation hints only. Remove the documented gateway
// parameters before other application requests can reuse them as a referrer.
export function sanitizeCheckoutReturnUrl(value: string): string | null {
  let url: URL
  try { url = new URL(value) } catch { return null }
  if (!['payment_id','payment_intent_client_secret','payment_client_secret'].some(key => url.searchParams.has(key))) return null
  for (const key of ['payment_id','payment_intent_client_secret','payment_client_secret','status','redirect_status','amount','manual_retry_allowed','signature','signature_algorithm']) url.searchParams.delete(key)
  return url.href
}
export function clearCheckoutReturnParameters() {
  const cleaned = sanitizeCheckoutReturnUrl(location.href)
  if (cleaned !== null) history.replaceState(history.state, '', cleaned)
}
