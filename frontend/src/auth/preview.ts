export const DEMO_SMS_CODE = '123456'
const RESEND_SECONDS = 60
const VALID_SECONDS = 300

export type PreviewProvider = 'apple' | 'wechat'
export type SmsChallenge = {
  id: string
  dial: string
  phone: string
  expiresAt: number
  resendAt: number
}

function waitForPreview(signal: AbortSignal, delay: number) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Canceled', 'AbortError'))
      return
    }
    const cancel = () => {
      window.clearTimeout(timer)
      reject(new DOMException('Canceled', 'AbortError'))
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', cancel)
      if (navigator.onLine === false) reject(new Error('offline'))
      else resolve()
    }, delay)
    signal.addEventListener('abort', cancel, { once: true })
  })
}

// This adapter serves the interactive preview. Real identity checks and session issuance belong to the backend.
export async function requestDemoSms(dial: string, phone: string, signal: AbortSignal): Promise<SmsChallenge> {
  await waitForPreview(signal, 420)
  const now = Date.now()
  return { id: crypto.randomUUID(), dial, phone, expiresAt: now + VALID_SECONDS * 1000, resendAt: now + RESEND_SECONDS * 1000 }
}

export async function verifyDemoSms(challenge: SmsChallenge, code: string, signal: AbortSignal) {
  await waitForPreview(signal, 360)
  if (Date.now() >= challenge.expiresAt) return { status: 'expired' } as const
  if (code !== DEMO_SMS_CODE) return { status: 'incorrect' } as const
  return { status: 'verified', identity: { dial: challenge.dial, phone: challenge.phone } } as const
}

const providerProfiles = new Map<PreviewProvider, string>()

function demoProfile(provider: PreviewProvider) {
  const current = providerProfiles.get(provider)
  if (current) return current
  const key = `elysium.auth.preview.${provider}`
  let profile: string = crypto.randomUUID()
  try {
    const saved = localStorage.getItem(key)
    if (saved && /^[a-z0-9-]{36}$/i.test(saved)) profile = saved
    else localStorage.setItem(key, profile)
  } catch {
    // The current browser session still has a stable preview profile.
  }
  providerProfiles.set(provider, profile)
  return profile
}

export async function authorizeDemoProvider(provider: PreviewProvider, signal: AbortSignal) {
  await waitForPreview(signal, 550)
  return { localLoginId: `preview-${provider}-${demoProfile(provider)}` }
}
