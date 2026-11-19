/** Server-side adapter for the official Logto 1.46 Experience API. */
export type ExperienceCookie = {
  name: string
  value: string
  path: string
  secure: boolean
  expiresAt?: number
}

/** Contains authentication material. Persist privately; never return it to a client. */
export type ExperienceState = {
  version: 1
  phone: string
  clientId: string
  verificationId: string
  cookies: ExperienceCookie[]
  interactionEvent: 'SignIn' | 'Register' | 'ForgotPassword'
  stage: 'verification' | 'verified' | 'identified' | 'staged' | 'submitted'
  resumeUrl?: string
  allowRegister?: boolean
}

export class ExperienceError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code)
    this.name = 'ExperienceError'
  }
}

type Json = Record<string, unknown>
const apiPaths = new Set([
  '/api/experience',
  '/api/experience/interaction-event',
  '/api/experience/verification/verification-code',
  '/api/experience/verification/verification-code/verify',
  '/api/experience/verification/password',
  '/api/experience/interaction',
  '/api/experience/profile/password',
  '/api/experience/identification',
  '/api/experience/submit',
  '/api/interaction/consent',
])
const signInPaths = new Set(['/sign-in', '/register', '/sign-up'])
const resumePath = /^\/oidc\/auth(?:\/[A-Za-z0-9_-]{1,256})?$/
const redirectStatuses = new Set([301, 302, 303, 307, 308])
const allowedApiPath=(path:string)=>apiPaths.has(path)||/^\/api\/experience\/verification\/social\/[A-Za-z0-9_-]{1,128}\/(?:authorization-uri|verify)$/.test(path)

export class ExperienceProvider {
  private readonly origin: string
  private readonly callback: URL
  private readonly firstPartyClientId?: string

  constructor(config: { issuer: URL; callbackUrl: string; firstPartyClientId?: string }) {
    this.origin = config.issuer.origin
    this.callback = new URL(config.callbackUrl)
    // The deployment must verify this registered application is first-party.
    // No consent is completed automatically unless it is explicitly allowlisted.
    this.firstPartyClientId = config.firstPartyClientId
    if (config.issuer.pathname.replace(/\/$/, '') !== '/oidc') {
      throw new ExperienceError('experience.unsupported_issuer', 500)
    }
  }

  protected async initialize(authorizationUrl: string, phone: string|null, interactionEvent: 'SignIn'|'ForgotPassword', allowRegister=false): Promise<ExperienceState> {
    // Logto's phoneRegEx requires digits, including the international calling code.
    const normalizedPhone = phone?.replace(/^\+/, '')??''
    if (phone!==null&&!/^[1-9]\d{6,14}$/.test(normalizedPhone)) {
      throw new ExperienceError('experience.invalid_phone', 400)
    }
    const authorization = this.providerUrl(authorizationUrl)
    const clientId = authorization.searchParams.get('client_id')
    if (authorization.pathname !== '/oidc/auth' ||
        authorization.searchParams.get('redirect_uri') !== this.callback.href ||
        !clientId || authorization.searchParams.getAll('client_id').length !== 1 ||
        authorization.searchParams.get('scope') !== 'openid' ||
        authorization.searchParams.getAll('scope').length !== 1 ||
        authorization.searchParams.get('response_type') !== 'code' ||
        ['resource', 'organization_id', 'authorization_details', 'request', 'request_uri', 'claims']
          .some((key) => authorization.searchParams.has(key))) {
      throw new ExperienceError('experience.invalid_authorization_url', 502)
    }
    const state: ExperienceState = {
      version: 1, phone: normalizedPhone, clientId, verificationId: '', cookies: [],
      interactionEvent, stage: 'verification', allowRegister,
    }
    await this.follow(state, authorization, true)
    await this.api(state, '/api/experience', 'PUT', { interactionEvent })
    return state
  }

  async start(authorizationUrl: string, phone: string, allowRegister=true): Promise<ExperienceState> {
    const state=await this.initialize(authorizationUrl,phone,'SignIn',allowRegister)
    const sent = await this.api(state, '/api/experience/verification/verification-code', 'POST', {
      identifier: { type: 'phone', value: state.phone }, interactionEvent: 'SignIn',
    })
    state.verificationId = this.requiredString(sent, 'verificationId')
    return state
  }

  async passwordSignIn(authorizationUrl:string,phone:string,password:string){
    const state=await this.initialize(authorizationUrl,phone,'SignIn')
    const value=await this.api(state,'/api/experience/verification/password','POST',{identifier:{type:'phone',value:state.phone},password})
    state.verificationId=this.requiredString(value,'verificationId');state.stage='verified'
    return this.completeSignIn(state)
  }

  /** Verifies a candidate password at Logto without submitting an OIDC sign-in or issuing an App session. */
  async passwordSubject(authorizationUrl:string,phone:string,password:string){
    const state=await this.initialize(authorizationUrl,phone,'SignIn')
    const value=await this.api(state,'/api/experience/verification/password','POST',{identifier:{type:'phone',value:state.phone},password})
    state.verificationId=this.requiredString(value,'verificationId')
    await this.identify(state);state.stage='identified'
    return this.interactionSubject(state)
  }

  async startPasswordReset(authorizationUrl:string,phone:string){
    const state=await this.initialize(authorizationUrl,phone,'ForgotPassword')
    const sent=await this.api(state,'/api/experience/verification/verification-code','POST',{identifier:{type:'phone',value:state.phone},interactionEvent:'ForgotPassword'})
    state.verificationId=this.requiredString(sent,'verificationId');return state
  }

  async verifyPasswordReset(state:ExperienceState,code:string){
    if(state.interactionEvent!=='ForgotPassword'||!/^\d{6}$/.test(code))throw new ExperienceError('experience.invalid_state',409)
    if(state.stage==='verification'){
      const value=await this.api(state,'/api/experience/verification/verification-code/verify','POST',{identifier:{type:'phone',value:state.phone},verificationId:state.verificationId,code})
      state.verificationId=this.requiredString(value,'verificationId');state.stage='verified'
    }
    if(state.stage==='verified'){await this.identify(state);state.stage='identified'}
    return this.interactionSubject(state)
  }

  async interactionSubject(state:ExperienceState){
    const value=await this.api(state,'/api/experience/interaction','GET')
    if(value.interactionEvent!==state.interactionEvent)throw new ExperienceError('experience.invalid_state',409)
    return this.requiredString(value,'userId')
  }

  async stagePassword(state:ExperienceState,password:string){
    if(state.interactionEvent!=='ForgotPassword'||state.stage!=='identified')throw new ExperienceError('experience.invalid_state',409)
    await this.api(state,'/api/experience/profile/password','PUT',{password});state.stage='staged'
  }
  async submitPassword(state:ExperienceState){
    if(state.interactionEvent!=='ForgotPassword'||state.stage!=='staged')throw new ExperienceError('experience.invalid_state',409)
    await this.api(state,'/api/experience/submit','POST');state.stage='submitted'
  }

  async verify(state: ExperienceState, code: string): Promise<{ callback: URL; state: ExperienceState }> {
    if (state.version !== 1 || !state.verificationId || !/^\d{6}$/.test(code)) {
      throw new ExperienceError('experience.invalid_verification', 400)
    }
    if (state.stage === 'verification') {
      const verified = await this.api(state, '/api/experience/verification/verification-code/verify', 'POST', {
        identifier: { type: 'phone', value: state.phone },
        verificationId: state.verificationId, code,
      })
      state.verificationId = this.requiredString(verified, 'verificationId')
      state.stage = 'verified'
    }
    return this.completeSignIn(state)
  }

  protected async completeSignIn(state:ExperienceState):Promise<{callback:URL;state:ExperienceState}>{
    if(state.interactionEvent==='ForgotPassword')throw new ExperienceError('experience.invalid_state',409)
    if (state.stage === 'verified') {
      await this.identify(state)
      state.stage = 'identified'
    }
    if (state.stage === 'identified') {
      const submitted = await this.api(state, '/api/experience/submit', 'POST')
      const resume = this.providerUrl(this.requiredString(submitted, 'redirectTo'))
      if (!resumePath.test(resume.pathname)) {
        throw new ExperienceError('experience.invalid_redirect', 502)
      }
      state.resumeUrl = resume.href
      state.stage = 'submitted'
    }
    if (!state.resumeUrl) throw new ExperienceError('experience.invalid_state', 409)
    const callback = await this.follow(state, this.providerUrl(state.resumeUrl), false)
    if (!callback) throw new ExperienceError('experience.callback_missing', 502)
    return { callback, state }
  }

  protected async identify(state: ExperienceState) {
    try {
      await this.api(state, '/api/experience/identification', 'POST', {
        verificationId: state.verificationId,
      })
    } catch (error) {
      if (!(error instanceof ExperienceError)) throw error
      if (state.allowRegister !== false && state.interactionEvent === 'SignIn' && error.code === 'user.user_not_exist') {
        // Same sequence as Logto experience's registerWithVerifiedIdentifier().
        await this.switchEvent(state, 'Register')
        try {
          await this.api(state, '/api/experience/identification', 'POST', {
            verificationId: state.verificationId,
          })
          return
        } catch (registrationError) {
          if (!(registrationError instanceof ExperienceError) ||
              registrationError.code !== 'user.phone_already_in_use') throw registrationError
          // A parallel verified registration may have created the same phone account.
          await this.switchEvent(state, 'SignIn')
          await this.api(state, '/api/experience/identification', 'POST', {
            verificationId: state.verificationId,
          })
          return
        }
      }
      if (state.interactionEvent === 'Register' && error.code === 'user.phone_already_in_use') {
        await this.switchEvent(state, 'SignIn')
        await this.api(state, '/api/experience/identification', 'POST', {
          verificationId: state.verificationId,
        })
        return
      }
      throw error
    }
  }

  protected async switchEvent(state: ExperienceState, interactionEvent: 'SignIn' | 'Register') {
    await this.api(state, '/api/experience/interaction-event', 'PUT', { interactionEvent })
    state.interactionEvent = interactionEvent
  }

  protected providerUrl(value: string): URL {
    let url: URL
    try { url = new URL(value, this.origin) } catch {
      throw new ExperienceError('experience.invalid_redirect', 502)
    }
    if (url.origin !== this.origin || url.username || url.password || url.hash) {
      throw new ExperienceError('experience.invalid_redirect', 502)
    }
    return url
  }

  private isCallback(url: URL) {
    return url.origin === this.callback.origin && url.pathname === this.callback.pathname &&
      !url.username && !url.password && !url.hash
  }

  /** Stops at the callback URL so existing OIDC state/nonce/PKCE exchange can verify it. */
  protected async follow(state: ExperienceState, initial: URL, starting: boolean): Promise<URL | undefined> {
    let url = initial
    for (let count = 0; count < 10; count++) {
      if (this.isCallback(url)) {
        if (starting) throw new ExperienceError('experience.unexpected_callback', 502)
        return url
      }
      url = this.providerUrl(url.href)
      if (signInPaths.has(url.pathname)) {
        if (starting) return
        throw new ExperienceError('experience.interaction_required', 409)
      }
      if (url.pathname === '/consent') {
        if (starting) throw new ExperienceError('experience.consent_required', 409)
        url = await this.completeFirstPartyOpenidConsent(state)
        state.resumeUrl = url.href
        continue
      }
      if (!resumePath.test(url.pathname)) throw new ExperienceError('experience.invalid_redirect', 502)
      const response = await this.request(state, url, 'GET')
      if (!redirectStatuses.has(response.status)) {
        if (!response.ok) throw await this.providerError(response)
        throw new ExperienceError('experience.redirect_missing', 502)
      }
      const location = response.headers.get('location')
      if (!location) throw new ExperienceError('experience.redirect_missing', 502)
      try { url = new URL(location, url) } catch {
        throw new ExperienceError('experience.invalid_redirect', 502)
      }
    }
    throw new ExperienceError('experience.redirect_limit', 502)
  }

  private async completeFirstPartyOpenidConsent(state: ExperienceState) {
    if (!this.firstPartyClientId || state.clientId !== this.firstPartyClientId) {
      throw new ExperienceError('experience.consent_required', 409)
    }
    const info = await this.api(state, '/api/interaction/consent', 'GET')
    const application = info.application
    const empty = (value: unknown) => value === undefined || Array.isArray(value) && value.length === 0
    if (!application || typeof application !== 'object' || Array.isArray(application) ||
        (application as Json).id !== this.firstPartyClientId || info.redirectUri !== this.callback.href ||
        !empty(info.missingOIDCScope) || !empty(info.missingResourceScopes) || !empty(info.organizations)) {
      throw new ExperienceError('experience.consent_required', 409)
    }
    // Only our preconfigured app's openid identity grant; business agreements remain in the app.
    const consent = await this.api(state, '/api/interaction/consent', 'POST', {})
    const resume = this.providerUrl(this.requiredString(consent, 'redirectTo'))
    if (!resumePath.test(resume.pathname)) throw new ExperienceError('experience.invalid_redirect', 502)
    return resume
  }

  protected async api(state: ExperienceState, path: string, method: 'GET' | 'POST' | 'PUT', body?: Json): Promise<Json> {
    if (!allowedApiPath(path)) throw new ExperienceError('experience.invalid_endpoint', 500)
    const response = await this.request(state, new URL(path, this.origin), method, body)
    if (!response.ok) throw await this.providerError(response)
    if (response.status === 204) return {}
    // Identification returns 201 with no JSON for a newly created user.
    // Endpoints that require data validate their response fields at the caller.
    return await this.json(response) ?? {}
  }

  private async request(state: ExperienceState, url: URL, method: string, body?: Json) {
    this.providerUrl(url.href)
    if (!(allowedApiPath(url.pathname) || resumePath.test(url.pathname))) {
      throw new ExperienceError('experience.invalid_endpoint', 500)
    }
    const now = Date.now()
    state.cookies = state.cookies.filter((cookie) => cookie.expiresAt === undefined || cookie.expiresAt > now)
    const cookies = state.cookies.filter((cookie) =>
      (!cookie.secure || url.protocol === 'https:') &&
      (url.pathname === cookie.path || url.pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : cookie.path + '/'))
    ).sort((a, b) => b.path.length - a.path.length)
    try {
      const response = await fetch(url, {
        method, redirect: 'manual', signal: AbortSignal.timeout(8000),
        headers: {
          Accept: 'application/json', Origin: this.origin,
          ...(body && { 'Content-Type': 'application/json' }),
          ...(cookies.length > 0 && { Cookie: cookies.map(({ name, value }) => `${name}=${value}`).join('; ') }),
        },
        ...(body && { body: JSON.stringify(body) }),
      })
      // Update even on failed OTP verification; callers persist this same state object.
      this.acceptCookies(state, response.headers.getSetCookie(), url)
      return response
    } catch (error) {
      if (error instanceof ExperienceError) throw error
      throw new ExperienceError('experience.provider_unavailable', 502)
    }
  }

  private acceptCookies(state: ExperienceState, headers: string[], requestUrl: URL) {
    for (const header of headers) {
      const [pair, ...attributes] = header.split(';')
      const equal = pair.indexOf('=')
      if (equal < 1) throw new ExperienceError('experience.invalid_provider_cookie', 502)
      const name = pair.slice(0, equal).trim()
      const value = pair.slice(equal + 1).trim()
      // Logto's signed _logto cookie contains raw JSON, including commas.
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\s;\x00-\x1f\x7f]/.test(value)) {
        throw new ExperienceError('experience.invalid_provider_cookie', 502)
      }
      const cookie: ExperienceCookie = {
        name, value, secure: false,
        path: requestUrl.pathname.slice(0, requestUrl.pathname.lastIndexOf('/')) || '/',
      }
      let maxAge: number | undefined
      let foreignDomain = false
      for (const attribute of attributes) {
        const boundary = attribute.indexOf('=')
        const key = (boundary < 0 ? attribute : attribute.slice(0, boundary)).trim().toLowerCase()
        const content = boundary < 0 ? '' : attribute.slice(boundary + 1).trim()
        if (key === 'path' && content.startsWith('/')) cookie.path = content
        if (key === 'secure') cookie.secure = true
        if (key === 'domain' && content.replace(/^\./, '').toLowerCase() !== requestUrl.hostname.toLowerCase()) {
          foreignDomain = true
        }
        if (key === 'max-age' && /^-?\d+$/.test(content)) maxAge = Number(content)
        if (key === 'expires' && Number.isFinite(Date.parse(content))) cookie.expiresAt = Date.parse(content)
      }
      if (foreignDomain) continue
      if (maxAge !== undefined) cookie.expiresAt = Date.now() + maxAge * 1000
      state.cookies = state.cookies.filter((old) => old.name !== cookie.name || old.path !== cookie.path)
      if (cookie.expiresAt === undefined || cookie.expiresAt > Date.now()) state.cookies.push(cookie)
      if (state.cookies.length > 64) throw new ExperienceError('experience.invalid_provider_cookie', 502)
    }
  }

  private async json(response: Response): Promise<Json | undefined> {
    try {
      const value: unknown = await response.json()
      return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : undefined
    } catch { return undefined }
  }

  private async providerError(response: Response) {
    const value = await this.json(response)
    const code = typeof value?.code === 'string' && /^[\w.-]{1,120}$/.test(value.code)
      ? value.code : 'experience.provider_error'
    return new ExperienceError(code, response.status >= 400 && response.status <= 599 ? response.status : 502)
  }

  protected requiredString(value: Json, key: string) {
    if (typeof value[key] !== 'string' || !value[key]) {
      throw new ExperienceError('experience.invalid_provider_response', 502)
    }
    return value[key] as string
  }
}
