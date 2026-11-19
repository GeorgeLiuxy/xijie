import {
  allowInsecureRequests,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  ClientSecretBasic,
  discovery,
  enableNonRepudiationChecks,
} from 'openid-client'

export type VerifiedPrincipal = {
  issuer: string
  subject: string
  authTime?: number
}

export interface OidcProvider {
  authorize(input: { state: string; nonce: string; verifier: string; fresh: boolean; provider?:'apple'|'google'|'wechat' }): Promise<string>
  exchange(
    callback: URL,
    input: { state: string; nonce: string; verifier: string; freshSince?: Date },
  ): Promise<VerifiedPrincipal>
}

type ProviderConfig = {
  issuer: URL
  clientId: string
  clientSecret: string
  callbackUrl: string
  socialProviders?:{apple:boolean;google?:boolean;wechat:boolean}
}

const freshAuthenticationSeconds = 600

function isLoopbackHttp(url: URL) {
  return process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
}

function requireTransport(url: URL) {
  if (url.username || url.password || (url.protocol !== 'https:' && !isLoopbackHttp(url))) {
    throw new Error('OIDC requires HTTPS or a loopback HTTP address')
  }
}

export async function createOidcProvider(config: ProviderConfig): Promise<OidcProvider> {
  const { issuer, clientId, clientSecret } = config
  const redirect = new URL(config.callbackUrl)
  requireTransport(issuer)
  requireTransport(redirect)
  if (issuer.search || issuer.hash || redirect.search || redirect.hash) {
    throw new Error('OIDC issuer and redirect URI must be fixed URLs')
  }

  const localIssuer = isLoopbackHttp(issuer)
  const client = await discovery(issuer, clientId, clientSecret, ClientSecretBasic(clientSecret), {
    execute: localIssuer
      ? [allowInsecureRequests, enableNonRepudiationChecks]
      : [enableNonRepudiationChecks],
    timeout: 5,
  })

  const metadata = client.serverMetadata()
  if (metadata.issuer !== issuer.href) throw new Error('OIDC issuer mismatch')
  for (const endpoint of [metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri]) {
    if (!endpoint) throw new Error('Incomplete OIDC discovery metadata')
    const url = new URL(endpoint)
    requireTransport(url)
    if (url.protocol !== 'https:' && (!localIssuer || url.origin !== issuer.origin)) {
      throw new Error('Insecure OIDC endpoint outside the configured loopback origin')
    }
  }

  return {
    async authorize({ state, nonce, verifier, fresh, provider }) {
      const params: Record<string, string> = {
        redirect_uri: redirect.href,
        scope: 'openid',
        state,
        nonce,
        code_challenge: await calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
      }
      if (fresh) {
        params.prompt = 'login'
        params.max_age = String(freshAuthenticationSeconds)
      }
      if(provider){
        if(config.socialProviders?.[provider]!==true)throw new Error('Social sign-in is disabled')
        params.direct_sign_in='social:'+provider
      }
      return buildAuthorizationUrl(client, params).href
    },

    async exchange(callback, { state, nonce, verifier, freshSince }) {
      if (callback.origin !== redirect.origin || callback.pathname !== redirect.pathname
        || callback.username || callback.password || callback.hash) {
        throw new Error('Unexpected OIDC callback URI')
      }
      const tokens = await authorizationCodeGrant(client, callback, {
        expectedState: state,
        expectedNonce: nonce,
        pkceCodeVerifier: verifier,
        idTokenExpected: true,
        maxAge: freshSince ? freshAuthenticationSeconds : undefined,
      })
      const claims = tokens.claims()
      if (!claims || claims.iss !== issuer.href || !claims.sub) throw new Error('Invalid OIDC subject')

      const authTime = claims.auth_time
      if (freshSince && (
        typeof authTime !== 'number' || !Number.isSafeInteger(authTime)
        || authTime < Math.floor(freshSince.getTime() / 1000)
        || authTime > Math.floor(Date.now() / 1000) + 30
      )) throw new Error('OIDC authentication is not recent enough')
      return { issuer: claims.iss, subject: claims.sub, authTime }
    },
  }
}
