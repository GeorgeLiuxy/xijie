import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { IdentityConfig } from './config.js'
import { ATTEMPT_SECONDS } from './config.js'
import { ExperienceError, ExperienceProvider, type ExperienceState } from './experience.js'
import type { OidcProvider } from './oidc.js'
import { IdentityStore, type ClientPurpose } from './store.js'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const token = () => randomBytes(32).toString('base64url')
type Challenge = {
  id: string; browser_hash: string; phone_hash: string; purpose: ClientPurpose; phase: string;
  attempt_id: string | null; context_cipher: string | null; result_cipher: string | null;
  operation_key: string | null; code_hash: string | null; last_result: 'incorrect' | 'expired' | null;
  lease_until: Date | null; expires_at: Date; resend_at: Date;
}
type Context = { provider: ExperienceState; state: string }
export class EmbeddedError extends Error {
  constructor(readonly status: number, readonly code: string, readonly retryAfter?: number) { super(code) }
}
const gone = () => new EmbeddedError(410, 'AUTH_CHALLENGE_EXPIRED')
const conflict = () => new EmbeddedError(409, 'CONFLICT')

/** Only the identity service sees provider cookies. They are encrypted at rest and never returned to the app. */
export class EmbeddedAuth {
  private readonly key: Buffer
  private readonly provider: ExperienceProvider
  constructor(
    private readonly pool: Pool, private readonly config: IdentityConfig,
    private readonly store: IdentityStore, private readonly oidc: OidcProvider,
  ) {
    this.key = createHash('sha256').update('xijie/experience/v1:').update(config.clientSecret).digest()
    this.provider = new ExperienceProvider({ ...config, firstPartyClientId: config.firstPartyExperience ? config.clientId : undefined })
  }

  private proof(value: string) { return createHmac('sha256', this.key).update(value).digest('hex') }
  private seal(id: string, value: unknown) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    cipher.setAAD(Buffer.from(id))
    const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')
  }
  private open<T>(id: string, value: string): T {
    const bytes = Buffer.from(value, 'base64url')
    const cipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12))
    cipher.setAAD(Buffer.from(id))
    cipher.setAuthTag(bytes.subarray(12, 28))
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8')) as T
  }

  private async transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try { await client.query('BEGIN'); const value = await run(client); await client.query('COMMIT'); return value }
    catch (error) { await client.query('ROLLBACK'); throw error }
    finally { client.release() }
  }

  private dto(row: Challenge) {
    return { id: row.id, expiresAt: row.expires_at.toISOString(), resendAt: row.resend_at.toISOString() }
  }

  async start(input: { browserHash: string; sessionHash: string | null; key: string; phone: string; purpose: ClientPurpose }) {
    const phoneHash = this.proof('phone:' + input.phone)
    const reserved = await this.transaction(async client => {
      // Lock in deterministic order. Rate limits apply across attempts, browser sessions and provider errors.
      for (const name of ['browser:' + input.browserHash, 'phone:' + phoneHash].sort()) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['xijie/sms/' + name])
      }
      const prior = (await client.query<Challenge>(
        'SELECT * FROM auth_sms_challenges WHERE browser_hash=$1 AND idempotency_key=$2', [input.browserHash, input.key],
      )).rows[0]
      if (prior) {
        if (prior.phone_hash !== phoneHash || prior.purpose !== input.purpose) throw new EmbeddedError(409, 'IDEMPOTENCY_CONFLICT')
        if (prior.expires_at <= new Date() || prior.phase === 'failed' || prior.phase === 'expired') throw gone()
        if (prior.phase === 'preparing') throw conflict()
        return { row: prior, fresh: false }
      }
      const throttle = await client.query<{ seconds: number }>(
        `SELECT ceil(extract(epoch FROM max(resend_at) - clock_timestamp()))::int AS seconds
         FROM auth_sms_challenges WHERE (browser_hash=$1 OR phone_hash=$2) AND resend_at > clock_timestamp()`,
        [input.browserHash, phoneHash],
      )
      if (throttle.rows[0].seconds > 0) throw new EmbeddedError(429, 'AUTH_RATE_LIMITED', throttle.rows[0].seconds)
      const row = (await client.query<Challenge>(
        `INSERT INTO auth_sms_challenges(id,browser_hash,idempotency_key,phone_hash,purpose)
         VALUES($1,$2,$3,$4,$5) RETURNING *`, [randomUUID(), input.browserHash, input.key, phoneHash, input.purpose],
      )).rows[0]
      return { row, fresh: true }
    })
    if (!reserved.fresh) return this.dto(reserved.row)
    const { row } = reserved
    try {
      const state = token(), nonce = token(), verifier = token()
      const authorizationUrl = await this.oidc.authorize({ state, nonce, verifier, fresh: true })
      const attempt = await this.store.begin({
        id: row.id, browserHash: input.browserHash, sessionHash: input.sessionHash, key: 'sms:' + input.key,
        purpose: input.purpose, clientRegistrationKey: this.config.clientRegistrationKey,
        stateHash: hash(state), nonce, verifier, authorizationUrl,
        expiresAt: new Date(Date.now() + ATTEMPT_SECONDS * 1000),
      })
      await this.pool.query('UPDATE auth_sms_challenges SET attempt_id=$2, updated_at=clock_timestamp() WHERE id=$1', [row.id, attempt.id])
      const provider = await this.provider.start(attempt.authorizationUrl, input.phone, input.purpose !== 'reauthenticate')
      await this.pool.query(
        `UPDATE auth_sms_challenges SET phase='ready',context_cipher=$2,updated_at=clock_timestamp() WHERE id=$1`,
        [row.id, this.seal(row.id, { provider, state } satisfies Context)],
      )
      return this.dto(row)
    } catch (error) {
      await this.pool.query("UPDATE auth_sms_challenges SET phase='failed', context_cipher=NULL,updated_at=clock_timestamp() WHERE id=$1", [row.id])
      if (error instanceof ExperienceError) throw this.providerError(error)
      throw error
    }
  }

  private providerError(error: ExperienceError): EmbeddedError {
    if (/rate.limit|rate_limit|too_many|send.*limit|retry.*limit/i.test(error.code) || error.status === 429) return new EmbeddedError(429, 'AUTH_RATE_LIMITED', 60)
    if (/expired|not_found|not.found|session.*not|interaction.*not|exceed_max_try/i.test(error.code)) return gone()
    return new EmbeddedError(503, 'AUTH_PROVIDER_UNAVAILABLE')
  }

  async challengePurpose(id:string,browserHash:string){return (await this.pool.query<{purpose:ClientPurpose}>('SELECT purpose FROM auth_sms_challenges WHERE id=$1 AND browser_hash=$2',[id,browserHash])).rows[0]?.purpose}
  async verify(input: { id: string; browserHash: string; code: string; key: string; requestId: string; sessionHash?:string;expectedSessionId?:string }): Promise<{ status: 'verified'; session: string } | {status:'reauthenticated';sessionId:string;reauthenticatedAt:string}| { status: 'incorrect' | 'expired' }> {
    const purpose=await this.challengePurpose(input.id,input.browserHash)
    const initiator=purpose==='reauthenticate'&&input.sessionHash?await this.store.current(input.sessionHash):null
    if(purpose==='reauthenticate'&&(!initiator||!input.expectedSessionId||initiator.id!==input.expectedSessionId))throw new EmbeddedError(401,'UNAUTHENTICATED')
    const codeHash = this.proof(input.id + ':' + input.code)
    const claimed = await this.transaction(async client => {
      const row = (await client.query<Challenge>('SELECT * FROM auth_sms_challenges WHERE id=$1 AND browser_hash=$2 FOR UPDATE', [input.id, input.browserHash])).rows[0]
      if (!row) throw new EmbeddedError(404, 'NOT_FOUND')
      if(row.purpose==='reauthenticate'){
        const attempt=(await client.query('SELECT initiating_session_id FROM auth_attempts WHERE id=$1',[row.attempt_id])).rows[0]
        if(!initiator||attempt?.initiating_session_id!==initiator.id)throw new EmbeddedError(401,'UNAUTHENTICATED')
      }
      if (row.expires_at <= new Date() || row.phase === 'failed' || row.phase === 'expired') throw gone()
      if (row.operation_key === input.key && row.code_hash !== codeHash) throw new EmbeddedError(409, 'IDEMPOTENCY_CONFLICT')
      if (row.phase === 'completed') {
        if (row.operation_key !== input.key || row.code_hash !== codeHash || !row.result_cipher) throw conflict()
        return { row, replay: true }
      }
      if (row.phase !== 'ready') throw conflict()
      if (row.operation_key === input.key && row.last_result) return { row, replay: true }
      const attempt = await client.query(
        `SELECT a.id FROM auth_attempts a JOIN app_session_slots s ON a.slot_id=s.id
         WHERE a.id=$1 AND a.state='pending' AND a.expected_generation=s.generation AND a.expires_at>clock_timestamp()`, [row.attempt_id],
      )
      if (!attempt.rowCount || !row.context_cipher) throw gone()
      await client.query(
        `UPDATE auth_sms_challenges SET phase='verifying',operation_key=$2,code_hash=$3,last_result=NULL,
         lease_until=clock_timestamp()+interval '30 seconds',updated_at=clock_timestamp() WHERE id=$1`, [row.id, input.key, codeHash],
      )
      return { row, replay: false }
    })
    const { row } = claimed
    if (claimed.replay) {
      if (row.last_result) return { status: row.last_result }
      if(row.purpose==='reauthenticate'){
        const result=this.open<{status:'reauthenticated';sessionId:string;reauthenticatedAt:string}>(row.id,row.result_cipher!)
        const current=input.sessionHash?await this.store.current(input.sessionHash):null
        if(!current||current.id!==result.sessionId||current.id!==input.expectedSessionId)throw gone()
        return result
      }
      const session = this.open<string>(row.id, row.result_cipher!)
      if (!await this.store.current(hash(session))) throw gone()
      return { status: 'verified', session }
    }
    let context: Context | undefined
    let providerFinished = false
    try {
      context = this.open<Context>(row.id, row.context_cipher!)
      const result = await this.provider.verify(context.provider, input.code)
      providerFinished = true
      const state = result.callback.searchParams.get('state')
      if (state !== context.state) throw new Error('Unexpected provider state')
      const claimId = randomUUID()
      const attempt = await this.store.claim({ browserHash: input.browserHash, stateHash: hash(state), claimId })
      if (!attempt || attempt === 'completed') throw gone()
      const principal = await this.oidc.exchange(result.callback, {
        state, nonce: attempt.nonce, verifier: attempt.verifier,
        freshSince: attempt.purpose !== 'sign_in' ? attempt.createdAt : undefined,
      })
      const session = token()
      if(row.purpose==='reauthenticate'&&(!Number.isSafeInteger(principal.authTime)||!principal.authTime))throw gone()
      const reauthResult={status:'reauthenticated' as const,sessionId:initiator?.id??'',reauthenticatedAt:new Date((principal.authTime??0)*1000).toISOString()}
      const accepted = await this.store.finish({
        browserHash: input.browserHash, attemptId: attempt.id, claimId, sessionHash: hash(session), requestId: input.requestId,
        principal: { issuer: principal.issuer, subject: principal.subject, authenticatedAt: principal.authTime === undefined ? new Date() : new Date(principal.authTime * 1000),authenticationTimeVerified:true },
      }, async client => {
        const updated = await client.query(
          `UPDATE auth_sms_challenges SET phase='completed',context_cipher=NULL,result_cipher=$4,lease_until=NULL,updated_at=clock_timestamp()
           WHERE id=$1 AND browser_hash=$2 AND operation_key=$3 AND phase='verifying'`,
          [row.id, input.browserHash, input.key, this.seal(row.id, row.purpose==='reauthenticate'?reauthResult:session)],
        )
        if (updated.rowCount !== 1) throw conflict()
      })
      if (!accepted) throw gone()
      if(row.purpose==='reauthenticate')return reauthResult
      return { status: 'verified', session }
    } catch (error) {
      if (context && error instanceof ExperienceError && /verification_code\.(code_mismatch|expired|not_found|exceed_max_try|verify_failed)|verification_code.*(invalid|incorrect)/.test(error.code)) {
        const status = /expired|not_found|exceed_max_try/.test(error.code) ? 'expired' : 'incorrect'
        await this.pool.query(
          `UPDATE auth_sms_challenges SET phase=$3,context_cipher=$4,last_result=$5,lease_until=NULL,updated_at=clock_timestamp()
           WHERE id=$1 AND operation_key=$2 AND phase='verifying'`,
          [row.id, input.key, status === 'expired' ? 'failed' : 'ready', status === 'expired' ? null : this.seal(row.id, context), status],
        )
        return { status }
      }
      await this.pool.query(
        `UPDATE auth_sms_challenges SET phase='failed',context_cipher=NULL,lease_until=NULL,updated_at=clock_timestamp()
         WHERE id=$1 AND operation_key=$2 AND phase='verifying'`, [row.id, input.key],
      )
      // A timeout after provider consumption has an unknown outcome. Never automatically issue a second session.
      if (error instanceof ExperienceError) {
        const mapped = this.providerError(error)
        throw mapped.code === 'AUTH_PROVIDER_UNAVAILABLE' ? new EmbeddedError(503, 'AUTH_RESTART_REQUIRED') : mapped
      }
      if (error instanceof EmbeddedError) throw error
      throw new EmbeddedError(503, !context || providerFinished ? 'AUTH_RESTART_REQUIRED' : 'AUTH_PROVIDER_UNAVAILABLE')
    }
  }

  async sweep() {
    await this.pool.query(
      `UPDATE auth_sms_challenges SET phase='expired',context_cipher=NULL,result_cipher=NULL,lease_until=NULL,updated_at=clock_timestamp()
       WHERE phase<>'expired' AND (expires_at<=clock_timestamp() OR (phase='verifying' AND lease_until<clock_timestamp()))`,
    )
    await this.pool.query("DELETE FROM auth_sms_challenges WHERE expires_at<clock_timestamp()-interval '1 day'")
  }
}
