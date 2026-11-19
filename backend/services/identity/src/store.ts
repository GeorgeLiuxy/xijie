import { type Pool, type PoolClient } from 'pg'

export type ClientPurpose = 'sign_in' | 'switch' | 'reauthenticate'
export type StorePrincipal = { issuer: string; subject: string; authenticatedAt: Date;authenticationTimeVerified?:boolean }
export type AttemptDraft = {
  password?:boolean
  provider?:'apple'|'google'|'wechat'
  nativeHandoff?:boolean
  id: string
  browserHash: string
  sessionHash: string | null
  key: string
  purpose: ClientPurpose
  clientRegistrationKey?: string
  stateHash: string
  nonce: string
  verifier: string
  authorizationUrl: string
  expiresAt: Date
}

type StoreCode = 'UNAUTHENTICATED' | 'CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'AUTH_RATE_LIMITED'
export class StoreError extends Error {
  constructor(readonly code: StoreCode) { super(code) }
}

type Slot = { id: string; generation: number }
type AttemptState = 'pending' | 'completed' | 'cancelled' | 'expired'
type Attempt = {
  credential_kind:'password'|null
  social_provider:'apple'|'google'|'wechat'|null
  native_handoff:boolean
  id: string
  purpose: ClientPurpose
  client_registration_key: string
  initiating_session_id: string | null
  expected_generation: number
  state: AttemptState
  nonce: string | null
  pkce_verifier: string | null
  authorization_url: string | null
  exchange_claim_id: string | null
  exchange_lease_until: Date | null
  created_at: Date
  expires_at: Date
}
type Claim = {
  id: string; purpose: ClientPurpose; clientRegistrationKey: string
  nonce: string; verifier: string; createdAt: Date
}
type CurrentSession = {
  id: string
  accountId: string
  client: 'web'
  authenticatedAt: Date
  reauthenticatedAt: Date | null
  expiresAt: Date
  displayName: string
  locale: string
  status: 'active'
  version: number
  registeredAt: Date
}
type Identity = { id: string; account_id: string }
export interface RegistrationReferrals {
  capture(db:PoolClient,browserHash:string,attemptId:string,purpose:string):Promise<void>
  registered(db:PoolClient,input:{browserHash:string;attemptId:string;accountId:string;purpose:string;isNew:boolean;now:Date}):Promise<string|null>
}

const attemptColumns = `id, purpose, client_registration_key, initiating_session_id, expected_generation, state, nonce,
  to_jsonb(auth_attempts)->>'credential_kind' AS credential_kind,
  to_jsonb(auth_attempts)->>'social_provider' AS social_provider,
  COALESCE((to_jsonb(auth_attempts)->>'native_handoff')::boolean,false) AS native_handoff,
  pkce_verifier, authorization_url, exchange_claim_id, exchange_lease_until, created_at, expires_at`
const sessionJoins = `JOIN accounts a ON a.id = s.account_id
  JOIN auth_identities i ON i.id = s.auth_identity_id AND i.account_id = s.account_id`
const validSession = `s.status = 'active' AND a.status = 'active' AND i.status = 'active'
  AND s.account_access_version = a.access_version`
const terminalValues = `nonce = NULL, pkce_verifier = NULL, authorization_url = NULL,
  exchange_claim_id = NULL, exchange_lease_until = NULL`

export class IdentityStore {
  private referrals?:RegistrationReferrals
  private credentialFences=false
  constructor(readonly pool: Pool, private readonly sessionSeconds = 8 * 60 * 60) {}
  useReferrals(referrals:RegistrationReferrals){this.referrals=referrals}
  useCredentialFences(){this.credentialFences=true}

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    let discard = false
    try {
      await client.query('BEGIN')
      const result = await work(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      try { await client.query('ROLLBACK') } catch { discard = true }
      throw error
    } finally {
      client.release(discard)
    }
  }

  private async now(client: PoolClient): Promise<Date> {
    const result = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now')
    return result.rows[0].now
  }

  private async lockSlot(client: PoolClient, browserHash: string): Promise<Slot | null> {
    const result = await client.query<Slot>(
      'SELECT id, generation FROM app_session_slots WHERE binding_hash = $1 FOR UPDATE', [browserHash],
    )
    return result.rows[0] ?? null
  }

  private async initiatingSessionIsCurrent(client: PoolClient, attempt: Attempt, now: Date): Promise<boolean> {
    if (!attempt.initiating_session_id) return true
    const result = await client.query(
      `SELECT s.id FROM app_sessions s ${sessionJoins}
       WHERE s.id = $1 AND ${validSession} AND s.expires_at > $2`,
      [attempt.initiating_session_id, now],
    )
    return result.rowCount === 1
  }

  private async closeAttempt(client: PoolClient, id: string, state: Exclude<AttemptState, 'pending'>, now: Date) {
    await client.query(
      `UPDATE auth_attempts SET state = $2, finished_at = $3, ${terminalValues}
       WHERE id = $1 AND state = 'pending'`, [id, state, now],
    )
  }

  private async closeSlotAttempts(client: PoolClient, slotId: string, now: Date) {
    await client.query(
      `UPDATE auth_attempts SET state = CASE WHEN expires_at <= $2 THEN 'expired' ELSE 'cancelled' END,
         finished_at = $2, ${terminalValues}
       WHERE slot_id = $1 AND state = 'pending'`, [slotId, now],
    )
  }

  async begin(draft: AttemptDraft,onAccepted?:(client:PoolClient,attemptId:string)=>Promise<void>): Promise<{ id: string; expiresAt: Date; authorizationUrl: string }> {
    return this.transaction(async client => {
      await client.query('INSERT INTO app_session_slots (binding_hash) VALUES ($1) ON CONFLICT DO NOTHING', [draft.browserHash])
      const slot = await this.lockSlot(client, draft.browserHash)
      if (!slot) throw new StoreError('CONFLICT')
      const now = await this.now(client)
      const sessions = await client.query<{ id: string }>(
        `SELECT s.id FROM app_sessions s ${sessionJoins}
         WHERE s.slot_id = $1 AND s.credential_hash = $2 AND ${validSession} AND s.expires_at > $3`,
        [slot.id, draft.sessionHash, now],
      )
      const initiatingSessionId = sessions.rows[0]?.id ?? null
      if (draft.purpose !== 'sign_in' && !initiatingSessionId) throw new StoreError('UNAUTHENTICATED')
      if (draft.purpose === 'sign_in' && initiatingSessionId) throw new StoreError('CONFLICT')

      const attempts = await client.query<Attempt>(
        `SELECT ${attemptColumns} FROM auth_attempts WHERE slot_id = $1 AND idempotency_key = $2`,
        [slot.id, draft.key],
      )
      const prior = attempts.rows[0]
      const registration = draft.clientRegistrationKey ?? 'web-local'
      if (prior) {
        if (prior.purpose !== draft.purpose || prior.credential_kind!==(draft.password?'password':null)||prior.client_registration_key !== registration || prior.social_provider!==(draft.provider??null)||prior.native_handoff!==(draft.nativeHandoff===true)||
            prior.initiating_session_id !== initiatingSessionId) {
          throw new StoreError('IDEMPOTENCY_CONFLICT')
        }
        if (prior.state !== 'pending' || prior.expected_generation !== slot.generation ||
            prior.expires_at <= now || !prior.authorization_url) {
          throw new StoreError('CONFLICT')
        }
        await onAccepted?.(client,prior.id)
        return { id: prior.id, expiresAt: prior.expires_at, authorizationUrl: prior.authorization_url }
      }

      if (draft.expiresAt <= now) throw new StoreError('CONFLICT')
      if(draft.provider){
        const count=await client.query("SELECT count(*)::integer AS n FROM auth_attempts WHERE slot_id=$1 AND social_provider IS NOT NULL AND created_at>clock_timestamp()-interval '10 minutes'",[slot.id])
        if(count.rows[0].n>=10)throw new StoreError('AUTH_RATE_LIMITED')
      }
      await this.closeSlotAttempts(client, slot.id, now)
      await client.query('UPDATE app_session_slots SET generation = generation + 1, updated_at = $2 WHERE id = $1', [slot.id, now])
      await client.query(
        `INSERT INTO auth_attempts (
           id, slot_id, client_registration_key, purpose, initiating_session_id, idempotency_key,
           expected_generation, state_hash, nonce, pkce_verifier, authorization_url, created_at, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [draft.id, slot.id, registration, draft.purpose, initiatingSessionId, draft.key, slot.generation + 1,
          draft.stateHash, draft.nonce, draft.verifier, draft.authorizationUrl, now, draft.expiresAt],
      )
      if(draft.provider)await client.query('UPDATE auth_attempts SET social_provider=$2 WHERE id=$1',[draft.id,draft.provider])
      if(draft.password)await client.query("UPDATE auth_attempts SET credential_kind='password' WHERE id=$1",[draft.id])
      if(draft.nativeHandoff)await client.query('UPDATE auth_attempts SET native_handoff=true WHERE id=$1',[draft.id])
      await onAccepted?.(client,draft.id)
      await this.referrals?.capture(client,draft.browserHash,draft.id,draft.purpose)
      return { id: draft.id, expiresAt: draft.expiresAt, authorizationUrl: draft.authorizationUrl }
    })
  }

  async claim(input: { browserHash: string; stateHash: string; claimId: string }): Promise<Claim | 'completed' | null> {
    return this.transaction(async client => {
      const slot = await this.lockSlot(client, input.browserHash)
      if (!slot) return null
      const result = await client.query<Attempt>(
        `SELECT ${attemptColumns} FROM auth_attempts WHERE slot_id = $1 AND state_hash = $2 FOR UPDATE`,
        [slot.id, input.stateHash],
      )
      const attempt = result.rows[0]
      if (attempt?.state === 'completed') return 'completed'
      if (!attempt || attempt.state !== 'pending' || !attempt.nonce || !attempt.pkce_verifier) return null

      const now = await this.now(client)
      if (attempt.expires_at <= now) {
        await this.closeAttempt(client, attempt.id, 'expired', now)
        return null
      }
      if (attempt.expected_generation !== slot.generation ||
          !await this.initiatingSessionIsCurrent(client, attempt, now)) {
        await this.closeAttempt(client, attempt.id, 'cancelled', now)
        return null
      }
      if (attempt.exchange_lease_until && attempt.exchange_lease_until > now) return null

      await client.query(
        `UPDATE auth_attempts SET exchange_claim_id = $2,
          exchange_lease_until = LEAST(expires_at, $3::timestamptz + interval '30 seconds')
         WHERE id = $1`, [attempt.id, input.claimId, now],
      )
      return {
        id: attempt.id, purpose: attempt.purpose, clientRegistrationKey: attempt.client_registration_key,
        nonce: attempt.nonce,
        verifier: attempt.pkce_verifier, createdAt: attempt.created_at,
      }
    })
  }

  async finish(input: {
    browserHash: string; attemptId: string; claimId: string; principal: StorePrincipal
    sessionHash: string; requestId?: string
  }, onAccepted?: (client: PoolClient) => Promise<void>): Promise<boolean> {
    return this.transaction(async client => {
      const slot = await this.lockSlot(client, input.browserHash)
      if (!slot) return false
      const result = await client.query<Attempt>(
        `SELECT ${attemptColumns} FROM auth_attempts WHERE slot_id = $1 AND id = $2 FOR UPDATE`, [slot.id, input.attemptId],
      )
      const attempt = result.rows[0]
      if (!attempt || attempt.state !== 'pending' || attempt.exchange_claim_id !== input.claimId ||
          attempt.expected_generation !== slot.generation) return false

      // Serialize first registration of one trusted provider subject across independent browser slots.
      const { issuer, subject, authenticatedAt } = input.principal
      const subjectLock = JSON.stringify(['xijie-auth', issuer, subject])
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [subjectLock])
      let pendingCredential=false
      if(this.credentialFences){
        const fence=(await client.query<{fenced_at:Date;password_pending:string|null}>('SELECT fenced_at,password_pending FROM auth_credential_fences WHERE issuer=$1 AND subject=$2',[issuer,subject])).rows[0]
        if(fence&&(attempt.created_at<=fence.fenced_at||attempt.credential_kind==='password'&&fence.password_pending)){await this.closeAttempt(client,attempt.id,'cancelled',await this.now(client));return false}
        pendingCredential=!!fence?.password_pending
        if(fence?.password_pending&&attempt.credential_kind!=='password'){
          const activeWrite=(await client.query("SELECT id FROM auth_password_challenges WHERE id=$1 AND phase='saving' AND lease_until>clock_timestamp()",[fence.password_pending])).rowCount===1
          if(activeWrite){await this.closeAttempt(client,attempt.id,'cancelled',await this.now(client));return false}
        }
      }
      const identities = await client.query<Identity>(
        'SELECT id, account_id FROM auth_identities WHERE issuer = $1 AND subject = $2', [issuer, subject],
      )
      let identity = identities.rows[0]
      const startingSessions = await client.query<{ account_id: string }>(
        'SELECT account_id FROM app_sessions WHERE id = $1', [attempt.initiating_session_id],
      )
      const accountIds = [identity?.account_id, startingSessions.rows[0]?.account_id].filter(id => id !== undefined)
      await client.query('SELECT id FROM accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [accountIds])
      const now = await this.now(client)
      if (attempt.expires_at <= now) {
        await this.closeAttempt(client, attempt.id, 'expired', now)
        return false
      }
      if (!attempt.exchange_lease_until || attempt.exchange_lease_until <= now ||
          !await this.initiatingSessionIsCurrent(client, attempt, now)) {
        await this.closeAttempt(client, attempt.id, 'cancelled', now)
        return false
      }

      if (attempt.purpose === 'reauthenticate' && (!identity || identity.account_id !== startingSessions.rows[0]?.account_id)) {
        await this.closeAttempt(client, attempt.id, 'cancelled', now)
        return false
      }
      if(pendingCredential&&attempt.credential_kind!=='password'&&(!input.principal.authenticationTimeVerified||!Number.isFinite(authenticatedAt.getTime())||authenticatedAt<new Date(Math.floor(attempt.created_at.getTime()/1000)*1000)||authenticatedAt.getTime()>now.getTime()+30000)){
        await this.closeAttempt(client,attempt.id,'cancelled',now);return false
      }
      const isNew=!identity
      if (!identity) identity = await this.registerIdentity(client, input.principal, input.requestId ?? attempt.id, now,
        {browserHash:input.browserHash,attemptId:attempt.id,purpose:attempt.purpose})
      const accounts = await client.query<{ access_version: number;credential_fenced_at:string|null;credential_password_pending:string|null }>(
        `SELECT a.access_version,to_jsonb(a)->>'credential_fenced_at' AS credential_fenced_at,to_jsonb(a)->>'credential_password_pending' AS credential_password_pending FROM accounts a
         JOIN auth_identities i ON i.account_id = a.id
         WHERE a.id = $1 AND i.id = $2 AND a.status = 'active' AND i.status = 'active'`,
        [identity.account_id, identity.id],
      )
      const account = accounts.rows[0]
      if (!account) {
        await this.closeAttempt(client, attempt.id, 'cancelled', now)
        return false
      }
      if(account.credential_fenced_at&&attempt.created_at<=new Date(account.credential_fenced_at)||attempt.credential_kind==='password'&&account.credential_password_pending){
        await this.closeAttempt(client,attempt.id,'cancelled',now);return false
      }
      if(account.credential_password_pending&&attempt.credential_kind!=='password'&&(!input.principal.authenticationTimeVerified||!Number.isFinite(authenticatedAt.getTime())||authenticatedAt<new Date(Math.floor(attempt.created_at.getTime()/1000)*1000)||authenticatedAt.getTime()>now.getTime()+30000)){
        await this.closeAttempt(client,attempt.id,'cancelled',now);return false
      }
      // A fresh independent SMS/social proof restores access, without declaring the older password write successful.
      if(!isNew)await this.referrals?.registered(client,{browserHash:input.browserHash,attemptId:attempt.id,accountId:identity.account_id,purpose:attempt.purpose,isNew:false,now})

      if (attempt.purpose === 'reauthenticate') {
        if (!Number.isFinite(authenticatedAt.getTime()) || authenticatedAt < new Date(Math.floor(attempt.created_at.getTime()/1000)*1000) || authenticatedAt.getTime()>now.getTime()+30000) return false
        await this.clearPasswordGate(client,issuer,subject,identity.account_id,attempt.credential_kind)
        await client.query('UPDATE app_sessions SET reauthenticated_at=$2 WHERE id=$1',[attempt.initiating_session_id,authenticatedAt])
        await this.closeAttempt(client,attempt.id,'completed',now)
        await onAccepted?.(client)
        return true
      }

      await this.clearPasswordGate(client,issuer,subject,identity.account_id,attempt.credential_kind)

      await client.query(
        `UPDATE app_sessions SET status = CASE WHEN expires_at <= $2 THEN 'expired' ELSE 'revoked' END,
           revoked_at = CASE WHEN expires_at <= $2 THEN NULL ELSE $2 END
         WHERE slot_id = $1 AND status = 'active'`, [slot.id, now],
      )
      await client.query(
        `INSERT INTO app_sessions (
           slot_id, client_registration_key, account_id, auth_identity_id, auth_attempt_id,
           credential_hash, account_access_version, authenticated_at, created_at, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9::timestamptz + $10::int * interval '1 second')`,
        [slot.id, attempt.client_registration_key, identity.account_id, identity.id, attempt.id, input.sessionHash,
          account.access_version, authenticatedAt, now, this.sessionSeconds],
      )
      await client.query('UPDATE auth_identities SET verified_at = $2 WHERE id = $1', [identity.id, now])
      await this.closeAttempt(client, attempt.id, 'completed', now)
      await onAccepted?.(client)
      return true
    })
  }

  private async clearPasswordGate(client:PoolClient,issuer:string,subject:string,accountId:string,kind:string|null){
    if(this.credentialFences&&kind!=='password'){
      await client.query('UPDATE auth_credential_fences SET password_pending=NULL WHERE issuer=$1 AND subject=$2',[issuer,subject])
      await client.query('UPDATE accounts SET credential_password_pending=NULL WHERE id=$1',[accountId])
    }
  }

  private async registerIdentity(
    client: PoolClient, principal: StorePrincipal, requestId: string, now: Date,
    referral:{browserHash:string;attemptId:string;purpose:string},
  ): Promise<Identity> {
    const accounts = await client.query<{ id: string }>(
      'INSERT INTO accounts (registered_at, updated_at) VALUES ($1, $1) RETURNING id', [now],
    )
    const accountId = accounts.rows[0].id
    const identities = await client.query<Identity>(
      `INSERT INTO auth_identities (account_id, issuer, subject, created_at, verified_at)
       VALUES ($1, $2, $3, $4, $4) RETURNING id, account_id`,
      [accountId, principal.issuer, principal.subject, now],
    )
    const referralAttributionId=await this.referrals?.registered(client,{...referral,accountId,isNew:true,now})
    await client.query(
      `INSERT INTO outbox_events (
         type, schema_version, account_id, aggregate_type, aggregate_id, aggregate_version, occurred_at, request_id, payload
       ) VALUES ('AccountRegistered.v1', 1, $1, 'account', $1, 1, $2, $3, $4::jsonb)`,
      [accountId, now, requestId, JSON.stringify({ accountId, registeredAt: now.toISOString(),...(referralAttributionId?{referralAttributionId}:{}) })],
    )
    return identities.rows[0]
  }

  async fail(input: { browserHash: string; attemptId: string; claimId: string }): Promise<void> {
    await this.transaction(async client => {
      const slot = await this.lockSlot(client, input.browserHash)
      if (!slot) return
      const result = await client.query<{ expires_at: Date }>(
        `SELECT expires_at FROM auth_attempts
         WHERE id = $1 AND slot_id = $2 AND state = 'pending' AND exchange_claim_id = $3 FOR UPDATE`,
        [input.attemptId, slot.id, input.claimId],
      )
      if (!result.rows[0]) return
      const now = await this.now(client)
      await this.closeAttempt(client, input.attemptId, result.rows[0].expires_at <= now ? 'expired' : 'cancelled', now)
    })
  }

  async cancel(input: { browserHash: string; attemptId: string }): Promise<'cancelled' | 'completed' | 'missing'> {
    return this.transaction(async client => {
      const slot = await this.lockSlot(client, input.browserHash)
      if (!slot) return 'missing'
      const result = await client.query<{ state: AttemptState; expires_at: Date }>(
        'SELECT state, expires_at FROM auth_attempts WHERE id = $1 AND slot_id = $2 FOR UPDATE', [input.attemptId, slot.id],
      )
      const attempt = result.rows[0]
      if (!attempt || attempt.state === 'expired') return 'missing'
      if (attempt.state !== 'pending') return attempt.state
      const now = await this.now(client)
      if (attempt.expires_at <= now) {
        await this.closeAttempt(client, input.attemptId, 'expired', now)
        return 'missing'
      }
      await this.closeAttempt(client, input.attemptId, 'cancelled', now)
      return 'cancelled'
    })
  }

  async sweepExpired(): Promise<void> {
    await this.pool.query(
      `WITH expired AS (
         SELECT id FROM auth_attempts
         WHERE state = 'pending' AND expires_at <= statement_timestamp()
         ORDER BY expires_at, id LIMIT 256 FOR UPDATE SKIP LOCKED
       ) UPDATE auth_attempts SET state = 'expired', finished_at = statement_timestamp(), ${terminalValues}
       WHERE id IN (SELECT id FROM expired)`,
    )
  }

  async current(sessionHash: string, db: Pool | PoolClient = this.pool): Promise<CurrentSession | null> {
    const result = await db.query<CurrentSession>(
      `SELECT s.id, s.account_id AS "accountId", 'web' AS client, s.authenticated_at AS "authenticatedAt", (to_jsonb(s)->>'reauthenticated_at')::timestamptz AS "reauthenticatedAt",
         s.expires_at AS "expiresAt", a.display_name AS "displayName", a.locale, a.status,
         a.version, a.registered_at AS "registeredAt"
       FROM app_sessions s ${sessionJoins}
       WHERE s.credential_hash = $1 AND ${validSession} AND s.expires_at > clock_timestamp()`, [sessionHash],
    )
    return result.rows[0] ?? null
  }

  async accountContext(accountId: string) {
    const result = await this.pool.query<{ accountId: string; status: 'active'; accessVersion: number }>(
      `SELECT id AS "accountId", status, access_version AS "accessVersion" FROM accounts WHERE id=$1 AND status='active'`, [accountId],
    )
    return result.rows[0] ?? null
  }

  async withLockedSession<T>(
    sessionHash: string, expectedSessionId: string | undefined,
    work: (db: PoolClient, session: CurrentSession) => Promise<T>,
  ): Promise<T> {
    return this.transaction(async db => {
      const found = await db.query<{ slot_id: string; account_id: string }>(
        'SELECT slot_id, account_id FROM app_sessions WHERE credential_hash = $1', [sessionHash],
      )
      const session = found.rows[0]
      if (!session) throw new StoreError('UNAUTHENTICATED')
      // Match switch and logout lock order before reading the latest session and policy state.
      await db.query('SELECT id FROM app_session_slots WHERE id = $1 FOR UPDATE', [session.slot_id])
      await db.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [session.account_id])
      const active = await this.current(sessionHash, db)
      if (!active || (expectedSessionId !== undefined && expectedSessionId !== active.id)) throw new StoreError('UNAUTHENTICATED')
      return work(db, active)
    })
  }

  async logout(sessionHash: string | null): Promise<void> {
    if (!sessionHash) return
    await this.transaction(async client => {
      const sessions = await client.query<{ slot_id: string }>(
        'SELECT slot_id FROM app_sessions WHERE credential_hash = $1', [sessionHash],
      )
      const slotId = sessions.rows[0]?.slot_id
      if (!slotId) return
      await client.query('SELECT id FROM app_session_slots WHERE id = $1 FOR UPDATE', [slotId])
      const now = await this.now(client)
      const revoked = await client.query(
        `UPDATE app_sessions SET status = 'revoked', revoked_at = $3
         WHERE slot_id = $1 AND credential_hash = $2 AND status = 'active' AND expires_at > $3`,
        [slotId, sessionHash, now],
      )
      if (revoked.rowCount === 0) return
      await client.query('UPDATE app_session_slots SET generation = generation + 1, updated_at = $2 WHERE id = $1', [slotId, now])
      await this.closeSlotAttempts(client, slotId, now)
    })
  }
}
