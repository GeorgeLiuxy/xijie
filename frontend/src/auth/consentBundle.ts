import { consentPurposes, permissionIntentKey, type Purpose } from './consentPurposes'

type Policy = { id: string; kind: Purpose; version: number; documentUrl: string; privateFeedProcessingEnabled?: boolean }
type Decision = { policyId: string; version: number; purpose: Purpose; decision: 'acknowledge' | 'grant'; expectedAuthorizationVersion: number }
type Step = { key: string; body: Decision }
type Intent = { signature: string; steps: Step[] }
export type ConsentSnapshot = {
  documents: Array<{ purpose: string; text: string }>; allowed: Record<string, boolean>; noticeAcknowledged: boolean; complete: boolean; signature: string
  policies: Record<Purpose, Policy>; versions: Record<Purpose, number>
}
export class ConsentError extends Error { constructor(readonly status: number, readonly code: string) { super(code) } }
type Context = { sessionId: string; onUnauthorized: () => void; onChanged?: () => void }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const natural = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const purposes: Purpose[] = ['privacy_notice', ...consentPurposes.map(item => item.purpose)]
const validStep = (step: Step) => !!step && uuid.test(step.key) && uuid.test(step.body?.policyId) && natural(step.body.version) && step.body.version > 0
  && natural(step.body.expectedAuthorizationVersion) && purposes.includes(step.body.purpose)
  && step.body.decision === (step.body.purpose === 'privacy_notice' ? 'acknowledge' : 'grant')

/** One explicit agreement, with real per-purpose receipts and resumable operation identities. */
export function consentBundle(context: Context, signal: AbortSignal, locale: 'zh-CN' | 'en') {
  if (!uuid.test(context.sessionId)) throw new ConsentError(400, 'INVALID_SESSION')
  const storageKey = 'xijie.consent-bundle.intent.' + context.sessionId
  let intent: Intent | undefined, writing = false, unauthorizedNotified = false
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as Intent | null
    if (value && typeof value.signature === 'string' && value.signature.length < 12000 && Array.isArray(value.steps) && value.steps.length <= purposes.length
      && value.steps.every(validStep) && new Set(value.steps.map(step => step.body.purpose)).size === value.steps.length) intent = value
  } catch { /* Local data never establishes a grant. */ }
  const remember = (value?: Intent) => {
    if (value) sessionStorage.setItem(storageKey, JSON.stringify(value))
    else sessionStorage.removeItem(storageKey)
    intent = value
  }
  async function request(path: string, init?: RequestInit) {
    signal.throwIfAborted()
    const headers = new Headers(init?.headers); headers.set('X-Xijie-Expected-Session', context.sessionId)
    const response = await fetch(path, { ...init, headers, signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), credentials: 'same-origin', cache: 'no-store' })
    signal.throwIfAborted()
    if (!response.ok) {
      let code = 'CONSENT_REQUEST_FAILED'
      try { const value = (await response.json()).error?.code; if (typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(value)) code = value } catch { /* Keep only a bounded error code. */ }
      signal.throwIfAborted()
      if (response.status === 401 && !unauthorizedNotified) { unauthorizedNotified = true; context.onUnauthorized() }
      throw new ConsentError(response.status, code)
    }
    return response
  }
  async function load(): Promise<ConsentSnapshot> {
    const [policyResponse, consentResponse] = await Promise.all([request('/v1/policies/current?locale=' + locale), request('/v1/accounts/me/consents?limit=1')])
    const policies = (await policyResponse.json()).data as Policy[]
    const meta = (await consentResponse.json()).meta as Record<string, any>
    if (!Array.isArray(policies) || !meta?.currentAuthorizationVersions || !meta.currentDecisions) throw new ConsentError(502, 'INVALID_RESPONSE')
    const selected = {} as Record<Purpose, Policy>, versions = {} as Record<Purpose, number>, allowed: Record<string, boolean> = {}
    for (const purpose of purposes) {
      const matches = policies.filter(item => item.kind === purpose), policy = matches[0], counter = meta.currentAuthorizationVersions[purpose]
      if (matches.length !== 1 || !uuid.test(policy?.id) || !natural(policy.version) || policy.version === 0 || !natural(counter)
        || policy.privateFeedProcessingEnabled !== undefined && typeof policy.privateFeedProcessingEnabled !== 'boolean'
        || policy.documentUrl !== '/v1/policies/' + policy.id + '/' + policy.version + '?locale=' + locale) throw new ConsentError(502, 'INVALID_RESPONSE')
      selected[purpose] = policy; versions[purpose] = counter
      if (purpose !== 'privacy_notice') {
        const definition = consentPurposes.find(item => item.purpose === purpose)!, authority = meta[definition.authority]
        if (typeof authority?.allowed !== 'boolean' || !natural(authority.authorizationVersion) || authority.authorizationVersion !== counter
          || authority.allowed && (counter === 0 || meta.currentDecisions[purpose] !== 'grant')) throw new ConsentError(502, 'INVALID_RESPONSE')
        allowed[purpose] = authority.allowed
          && (purpose !== 'private_story_storage' || authority.privateFeedAllowed === true)
          && (purpose !== 'ai_text_processing' || policy.privateFeedProcessingEnabled !== true || authority.privateFeedProcessingAllowed === true)
      }
    }
    const documents = await Promise.all(purposes.map(async purpose => {
      const text = await (await request(selected[purpose].documentUrl)).text()
      if (!text.trim() || text.length > 500000) throw new ConsentError(502, 'INVALID_RESPONSE')
      return { purpose, text }
    }))
    signal.throwIfAborted()
    const noticeAcknowledged = meta.currentDecisions.privacy_notice === 'acknowledge' && versions.privacy_notice > 0
    const signature = JSON.stringify(purposes.map(purpose => [purpose, selected[purpose].id, selected[purpose].version]))
    const snapshot: ConsentSnapshot = { documents, allowed, noticeAcknowledged, complete: noticeAcknowledged && consentPurposes.every(item => allowed[item.purpose]), signature, policies: selected, versions }
    // An unresolved earlier withdrawal can still change a currently allowed purpose.
    if (legacyIntents(snapshot).some(item => item.steps.some(step => step.body.expectedAuthorizationVersion === versions[step.body.purpose]
      && step.body.policyId === selected[step.body.purpose].id && step.body.version === selected[step.body.purpose].version))) snapshot.complete = false
    return snapshot
  }
  function legacyIntents(snapshot: ConsentSnapshot) {
    const pending: Array<{ purpose: (typeof consentPurposes)[number]['purpose']; key: string; steps: Array<{ body: { purpose: Purpose; expectedAuthorizationVersion: number; policyId: string; version: number } }> }> = []
    for (const { purpose } of consentPurposes) {
      try {
        const key = permissionIntentKey(context.sessionId, purpose), value = JSON.parse(sessionStorage.getItem(key) ?? 'null')
        if (value && ['grant', 'revoke'].includes(value.decision) && Array.isArray(value.steps) && value.steps.length > 0 && value.steps.length <= 2
          && value.steps.every((step: Step) => uuid.test(step.key) && uuid.test(step.body?.policyId) && natural(step.body.version) && step.body.version > 0
            && natural(step.body.expectedAuthorizationVersion) && (step.body.purpose === purpose && step.body.decision === value.decision || step.body.purpose === 'privacy_notice' && step.body.decision === 'acknowledge')))
          pending.push({ purpose, key, steps: value.steps })
      } catch { /* Malformed untrusted data cannot create a write. */ }
    }
    return pending
  }
  function clearSuperseded(snapshot: ConsentSnapshot) {
    for (const old of legacyIntents(snapshot)) if (old.steps.every(step => snapshot.versions[step.body.purpose] > step.body.expectedAuthorizationVersion)) sessionStorage.removeItem(old.key)
  }
  async function execute(): Promise<ConsentSnapshot> {
    if (!intent) throw new ConsentError(409, 'CONSENT_INTENT_MISSING')
    try {
      while (intent.steps.length) {
        const step = intent.steps[0]
        const result = (await (await request('/v1/accounts/me/consents', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': step.key }, body: JSON.stringify(step.body) })).json()).data
        signal.throwIfAborted()
        if (!result || !uuid.test(result.id) || result.purpose !== step.body.purpose || result.decision !== step.body.decision
          || result.authorizationVersion !== step.body.expectedAuthorizationVersion + 1) throw new ConsentError(502, 'INVALID_RESPONSE')
        remember({ ...intent, steps: intent.steps.slice(1) })
      }
      const snapshot = await load()
      if (snapshot.signature !== intent.signature || !snapshot.complete) {
        remember(); throw new ConsentError(412, 'CONSENT_CHANGED')
      }
      clearSuperseded(snapshot); remember()
      context.onChanged?.(); window.dispatchEvent(new Event('xijie:consents-changed'))
      return snapshot
    } catch (error) {
      if (error instanceof ConsentError && error.status >= 400 && error.status < 500) remember()
      throw error
    }
  }
  const exclusive = async (run: () => Promise<ConsentSnapshot>) => {
    if (writing) throw new ConsentError(409, 'CONSENT_BUSY')
    writing = true
    try { return await run() } finally { writing = false }
  }
  return {
    load,
    get hasPending() { return !!intent },
    grant: (shown: ConsentSnapshot) => exclusive(async () => {
      if (intent) throw new ConsentError(409, 'CONSENT_PENDING')
      const current = await load()
      if (!shown || current.signature !== shown.signature) throw new ConsentError(412, 'CONSENT_CHANGED')
      const old = legacyIntents(current)
      // A still-pending old notice write must not invalidate a newly completed agreement later.
      const pendingNotice = old.some(item => item.steps.some(step => step.body.purpose === 'privacy_notice' && step.body.expectedAuthorizationVersion === current.versions.privacy_notice
        && step.body.policyId === current.policies.privacy_notice.id && step.body.version === current.policies.privacy_notice.version))
      const acknowledge = !current.noticeAcknowledged || pendingNotice
      const step = (purpose: Purpose): Step => ({ key: crypto.randomUUID(), body: { purpose, policyId: current.policies[purpose].id, version: current.policies[purpose].version,
        decision: purpose === 'privacy_notice' ? 'acknowledge' : 'grant', expectedAuthorizationVersion: current.versions[purpose] } })
      const steps = [...(acknowledge ? [step('privacy_notice')] : []), ...consentPurposes.filter(item => acknowledge || !current.allowed[item.purpose]
        || old.some(value => value.purpose === item.purpose && value.steps.some(v => v.body.purpose === item.purpose && v.body.expectedAuthorizationVersion === current.versions[item.purpose]
          && v.body.policyId === current.policies[item.purpose].id && v.body.version === current.policies[item.purpose].version))).map(item => step(item.purpose))]
      if (!steps.length) { clearSuperseded(current); return current }
      remember({ signature: current.signature, steps })
      return execute()
    }),
    retry: () => exclusive(async () => {
      if (!intent) throw new ConsentError(409, 'CONSENT_INTENT_MISSING')
      const current = await load()
      if (current.signature !== intent.signature) { remember(); throw new ConsentError(412, 'CONSENT_CHANGED') }
      return execute()
    }),
  }
}
