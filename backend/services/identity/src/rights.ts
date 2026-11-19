import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto"

import type { Pool, PoolClient } from "pg"

import { IdentityStore } from "./store.js"
import {referralExport,eraseReferrals} from './referrals.js'
import {exportReports,eraseReports} from './content-reports.js'

import { rightsDomains, type RightsConfig } from "./rights-config.js"

export class RightsError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
  }
}

export const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex")

export type Dispatch = {
  requestId: string
  dispatchId: string
  dispatchGeneration: number
}

export interface RightsQueueSender {
  send(db: PoolClient, value: Dispatch): Promise<void>
  isPending?(db: PoolClient, value: Dispatch): Promise<boolean>
}

export type RightsRow = {
  id: string
  account_id: string
  kind: "export" | "delete_account"
  scope: "interaction_data" | "account_data"
  status: "accepted" | "processing" | "completed" | "failed"
  version: number
  requested_at: Date
  updated_at: Date
  started_at: Date | null
  finished_at: Date | null
  result_expires_at: Date | null
  dispatch_id: string
  dispatch_generation: number
  attempt_id: string | null
  attempt_count: number
  lease_until: Date | null
  failure_code: string | null
  progress: Record<string, unknown>
  idempotency_key: string
  request_hash: string
}

export type Snapshot = {
  schemaVersion: 1
  domain: string
  accountId: string
  capturedAt: string
  revision: string
  data: unknown
}

export type CreateRequest = {
  kind: "export" | "delete_account"
  scope: "interaction_data" | "account_data"
  deletionReceiptId?: string
  statusProof?: string
}

type Active = Awaited<ReturnType<IdentityStore["current"]>> & {}

export const publicRequest = (row: RightsRow) => ({
  id: row.id,
  kind: row.kind,
  scope: row.scope,
  status: row.status,
  requestedAt: row.requested_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  ...(row.result_expires_at
    ? { resultExpiresAt: row.result_expires_at.toISOString() }
    : {}),
  ...(row.failure_code ? { failureCode: row.failure_code } : {}),
  ...(row.kind==='delete_account'&&row.progress.gifts&&typeof row.progress.gifts==='object'&&'financialRetention' in row.progress.gifts?{financialRetention:row.progress.gifts.financialRetention}:{}),
})

const notFound = () => new RightsError(404, "NOT_FOUND")

/** Static SQL fragments shared by normal erasure and rolling-upgrade reconciliation. */
function authenticationErasureScope(owner:string,cutoff:string){
  const attempts=`SELECT auth_attempt_id FROM app_sessions WHERE account_id=${owner} UNION SELECT id FROM auth_attempts WHERE initiating_session_id IN(SELECT id FROM app_sessions WHERE account_id=${owner})`
  // A historic browser binding can be reused. Its new owner's credentials are never an old account's data.
  const browsers=`SELECT sl.binding_hash FROM app_session_slots sl JOIN app_sessions s ON s.slot_id=sl.id WHERE s.account_id=${owner} AND NOT EXISTS(SELECT 1 FROM app_sessions other JOIN accounts oa ON oa.id=other.account_id WHERE other.slot_id=sl.id AND other.account_id<>${owner} AND oa.status='active')`
  return{
    challenges:`p.account_id=${owner} OR p.initiating_account_id=${owner} OR (p.account_id IS NULL AND p.initiating_account_id IS NULL AND p.browser_hash IN(${browsers}) AND p.created_at<=${cutoff})`,
    logins:`p.attempt_id IN(${attempts}) OR (p.browser_hash IN(${browsers}) AND p.created_at<=${cutoff} AND NOT EXISTS(SELECT 1 FROM auth_attempts at LEFT JOIN app_sessions initiator ON initiator.id=at.initiating_session_id LEFT JOIN app_sessions result ON result.auth_attempt_id=at.id WHERE at.id=p.attempt_id AND (initiator.account_id<>${owner} OR result.account_id<>${owner})))`,
    fences:`(p.issuer,p.subject) IN(SELECT issuer,subject FROM auth_identities WHERE account_id=${owner})`,
    native:`p.attempt_id IN(${attempts}) OR p.expected_session_id IN(SELECT id FROM app_sessions WHERE account_id=${owner})`,
  }
}

export class RightsStore {
  constructor(
    readonly pool: Pool,
    readonly identity: IdentityStore,
    readonly config: RightsConfig,
    readonly queue: RightsQueueSender,
  ) {}

  private enabled() {
    if (!this.config.enabled)
      throw new RightsError(503, "DATA_RIGHTS_UNAVAILABLE")
  }

  private async authenticationTables(db:PoolClient){
    const row=(await db.query<{password:string|null;native:string|null}>("SELECT to_regclass('auth_password_challenges')::text AS password,to_regclass('native_auth_handoffs')::text AS native")).rows[0]
    return{password:!!row.password,native:!!row.native}
  }

  private async eraseAuthenticationAdditions(db:PoolClient,accountId:string,tables?:{password:boolean;native:boolean}){
    const account=(await db.query<{status:string}>('SELECT status FROM accounts WHERE id=$1',[accountId])).rows[0]
    if(!account||!['deletion_pending','deleted'].includes(account.status))return
    const available=tables??await this.authenticationTables(db),scope=authenticationErasureScope('$1','COALESCE((SELECT deleted_at FROM accounts WHERE id=$1),clock_timestamp())')
    if(available.password){
      await db.query('DELETE FROM auth_password_challenges p WHERE '+scope.challenges,[accountId])
      await db.query('DELETE FROM auth_password_logins p WHERE '+scope.logins,[accountId])
      await db.query('DELETE FROM auth_credential_fences p WHERE '+scope.fences,[accountId])
      await db.query("UPDATE accounts SET credential_fenced_at=NULL,credential_password_pending=NULL WHERE id=$1 AND status IN('deletion_pending','deleted') AND (credential_fenced_at IS NOT NULL OR credential_password_pending IS NOT NULL)",[accountId])
    }
    // The SDK transaction has ON DELETE CASCADE from its original handoff.
    if(available.native)await db.query('DELETE FROM native_auth_handoffs p WHERE '+scope.native,[accountId])
  }

  private async reconcileDeletedAuthentication(){
    await this.tx(async db=>{
      const available=await this.authenticationTables(db)
      if(!available.password&&!available.native)return
      const scope=authenticationErasureScope('a.id','COALESCE(a.deleted_at,clock_timestamp())'),residual:string[]=[]
      if(available.password)residual.push("to_jsonb(a)->>'credential_fenced_at' IS NOT NULL","to_jsonb(a)->>'credential_password_pending' IS NOT NULL",'EXISTS(SELECT 1 FROM auth_password_challenges p WHERE '+scope.challenges+')','EXISTS(SELECT 1 FROM auth_password_logins p WHERE '+scope.logins+')','EXISTS(SELECT 1 FROM auth_credential_fences p WHERE '+scope.fences+')')
      if(available.native)residual.push('EXISTS(SELECT 1 FROM native_auth_handoffs p WHERE '+scope.native+')')
      const rows=(await db.query<{id:string}>("SELECT a.id FROM accounts a WHERE a.status='deleted' AND ("+residual.join(' OR ')+') ORDER BY a.id FOR UPDATE OF a SKIP LOCKED LIMIT 50')).rows
      for(const row of rows)await this.eraseAuthenticationAdditions(db,row.id,available)
    })
  }

  private async tx<T,>(work: (db: PoolClient) => Promise<T>) {
    const db = await this.pool.connect()
    try {
      await db.query("BEGIN")
      const result = await work(db)
      await db.query("COMMIT")
      return result
    } catch (error) {
      await db.query("ROLLBACK")
      throw error
    } finally {
      db.release()
    }
  }

  private async recent(db: PoolClient, session: Active) {
    const row = (
      await db.query(
        "SELECT reauthenticated_at>=clock_timestamp()-interval '10 minutes' AND reauthenticated_at<=clock_timestamp()+interval '30 seconds' AS recent FROM app_sessions WHERE id=$1",
        [session.id],
      )
    ).rows[0]
    if (!row?.recent) throw new RightsError(403, "REAUTHENTICATION_REQUIRED")
  }

  async requireRecent(hash: string, expected: string | undefined) {
    return this.identity.withLockedSession(hash, expected, async (db, s) => {
      await this.recent(db, s)
      return s
    })
  }

  async create(
    hash: string,
    expected: string | undefined,
    key: string,
    input: CreateRequest,
    requestId: string,
  ) {
    this.enabled()
    const fingerprint = digest(
      JSON.stringify([
        input.kind,
        input.scope,
        input.deletionReceiptId ?? null,
        input.statusProof ? digest(input.statusProof) : null,
      ]),
    )

    return this.identity.withLockedSession(
      hash,
      expected,
      async (db, session) => {
        await this.recent(db, session)

        const prior = (
          await db.query<RightsRow>(
            "SELECT * FROM data_requests WHERE account_id=$1 AND idempotency_key=$2",
            [session.accountId, key],
          )
        ).rows[0]

        if (prior) {
          if (prior.request_hash !== fingerprint)
            throw new RightsError(409, "IDEMPOTENCY_CONFLICT")
          return publicRequest(prior)
        }

        if (
          input.kind === "delete_account" &&
          (
            await db.query(
              "SELECT id FROM data_requests WHERE account_id=$1 AND kind='delete_account'",
              [session.accountId],
            )
          ).rowCount
        )
          throw new RightsError(409, "DELETION_ALREADY_REQUESTED")

        const row = (
          await db.query<RightsRow>(
            "INSERT INTO data_requests(account_id,kind,scope,idempotency_key,request_hash,dispatch_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
            [
              session.accountId,
              input.kind,
              input.scope,
              key,
              fingerprint,
              randomUUID(),
            ],
          )
        ).rows[0]

        if (input.kind === "delete_account") {
          const receipt = await db.query(
            "SELECT request_id FROM data_request_receipts WHERE receipt_id=$1",
            [input.deletionReceiptId],
          )
          if (receipt.rowCount)
            throw new RightsError(409, "IDEMPOTENCY_CONFLICT")

          await db.query(
            "INSERT INTO data_request_receipts(receipt_id,request_id,proof_hash) VALUES($1,$2,$3)",
            [input.deletionReceiptId, row.id, digest(input.statusProof!)],
          )

          const account = (
            await db.query(
              "UPDATE accounts SET status='deletion_pending',access_version=access_version+1,version=version+1,deletion_requested_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 RETURNING access_version,deletion_requested_at",
              [session.accountId],
            )
          ).rows[0]

          await db.query(
            "DELETE FROM data_export_grants WHERE request_id IN(SELECT id FROM data_requests WHERE account_id=$1)",
            [session.accountId],
          )
          await db.query(
            "DELETE FROM data_exports WHERE request_id IN(SELECT id FROM data_requests WHERE account_id=$1)",
            [session.accountId],
          )

          await db.query(
            "INSERT INTO outbox_events(type,schema_version,account_id,aggregate_type,aggregate_id,aggregate_version,occurred_at,request_id,payload) VALUES('AccountAccessRevoked.v1',1,$1,'account',$1,$2,$3,$4,$5)",
            [
              session.accountId,
              account.access_version,
              account.deletion_requested_at,
              requestId,
              {
                accountId: session.accountId,
                accessVersion: account.access_version,
                reason: "account_deletion",
              },
            ],
          )
        }

        await this.queue.send(db, {
          requestId: row.id,
          dispatchId: row.dispatch_id,
          dispatchGeneration: row.dispatch_generation,
        })
        return publicRequest(row)
      },
    )
  }

  async get(accountId: string, id: string) {
    this.enabled()
    const row = (
      await this.pool.query<RightsRow>(
        "SELECT * FROM data_requests WHERE account_id=$1 AND id=$2",
        [accountId, id],
      )
    ).rows[0]
    if (!row) throw notFound()
    return publicRequest(row)
  }

  async list(accountId: string, limit: number) {
    this.enabled()
    return (
      await this.pool.query<RightsRow>(
        "SELECT * FROM data_requests WHERE account_id=$1 ORDER BY requested_at DESC,id DESC LIMIT $2",
        [accountId, limit],
      )
    ).rows.map(publicRequest)
  }

  async context(id: string) {
    this.enabled()
    const row = (
      await this.pool.query(
        'SELECT r.id AS "requestId",r.account_id AS "accountId",r.kind,r.scope,r.status,a.status AS "accountStatus",a.access_version AS "accountAccessVersion" FROM data_requests r JOIN accounts a ON a.id=r.account_id WHERE r.id=$1',
        [id],
      )
    ).rows[0]
    if (!row) throw notFound()
    return row
  }

  private async receipt(
    receiptId: string,
    proof: string,
    db: Pool | PoolClient = this.pool,
  ) {
    this.enabled()
    const row = (
      await db.query<RightsRow & { proof_hash: string }>(
        "SELECT r.*,p.proof_hash FROM data_request_receipts p JOIN data_requests r ON r.id=p.request_id WHERE p.receipt_id=$1 AND p.expires_at>clock_timestamp()",
        [receiptId],
      )
    ).rows[0]
    if (
      !row ||
      !timingSafeEqual(
        Buffer.from(row.proof_hash, "hex"),
        Buffer.from(digest(proof), "hex"),
      )
    )
      throw notFound()
    return row
  }

  async readReceipt(id: string, proof: string) {
    return publicRequest(await this.receipt(id, proof))
  }

  private async retry(db: PoolClient, row: RightsRow, key: string) {
    const previous = (
      await db.query(
        "SELECT result_id FROM data_rights_commands WHERE account_id=$1 AND operation='retry' AND target=$2 AND idempotency_key=$3",
        [row.account_id, row.id, key],
      )
    ).rows[0]
    if (previous) return publicRequest(row)

    if (row.status === "failed")
      row = (
        await db.query<RightsRow>(
          "UPDATE data_requests SET status='accepted',version=version+1,updated_at=clock_timestamp(),finished_at=NULL,attempt_id=NULL,lease_until=NULL,failure_code=NULL,dispatch_id=$2,dispatch_generation=dispatch_generation+1,attempt_count=0 WHERE id=$1 RETURNING *",
          [row.id, randomUUID()],
        )
      ).rows[0]
    else {
      await db.query(
        "INSERT INTO data_rights_commands(account_id,operation,target,idempotency_key,request_hash,result_id) VALUES($1,'retry',$2,$3,'empty',$2)",
        [row.account_id, row.id, key],
      )
      return publicRequest(row)
    }

    await this.queue.send(db, {
      requestId: row.id,
      dispatchId: row.dispatch_id,
      dispatchGeneration: row.dispatch_generation,
    })

    await db.query(
      "INSERT INTO data_rights_commands(account_id,operation,target,idempotency_key,request_hash,result_id) VALUES($1,'retry',$2,$3,'empty',$2)",
      [row.account_id, row.id, key],
    )
    return publicRequest(row)
  }

  async retryAccount(
    hash: string,
    expected: string | undefined,
    id: string,
    key: string,
  ) {
    return this.identity.withLockedSession(hash, expected, async (db, s) => {
      await this.recent(db, s)
      const row = (
        await db.query<RightsRow>(
          "SELECT * FROM data_requests WHERE id=$1 AND account_id=$2 FOR UPDATE",
          [id, s.accountId],
        )
      ).rows[0]
      if (!row) throw notFound()
      return this.retry(db, row, key)
    })
  }

  async retryReceipt(id: string, proof: string, key: string) {
    const initial = await this.receipt(id, proof)
    return this.tx(async (db) => {
      await db.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [
        initial.account_id,
      ])
      const row = await this.receipt(id, proof, db)
      await db.query("SELECT id FROM data_requests WHERE id=$1 FOR UPDATE", [
        row.id,
      ])
      return this.retry(
        db,
        (
          await db.query<RightsRow>("SELECT * FROM data_requests WHERE id=$1", [
            row.id,
          ])
        ).rows[0],
        key,
      )
    })
  }

  async claim(value: Dispatch) {
    return this.tx(async (db) => {
      const row = (
        await db.query<RightsRow>(
          "UPDATE data_requests SET status='processing',attempt_id=$4,attempt_count=attempt_count+1,lease_until=clock_timestamp()+interval '90 seconds',started_at=coalesce(started_at,clock_timestamp()),updated_at=clock_timestamp(),version=version+1 WHERE id=$1 AND dispatch_id=$2 AND dispatch_generation=$3 AND status='accepted' AND attempt_count<4 RETURNING *",
          [
            value.requestId,
            value.dispatchId,
            value.dispatchGeneration,
            randomUUID(),
          ],
        )
      ).rows[0]
      return row
    })
  }

  private async running(db: PoolClient, row: RightsRow) {
    const account = (
      await db.query("SELECT status FROM accounts WHERE id=$1 FOR UPDATE", [
        row.account_id,
      ])
    ).rows[0]
    const result = (
      await db.query<RightsRow>(
        "SELECT * FROM data_requests WHERE id=$1 AND status='processing' AND attempt_id=$2 AND dispatch_id=$3 AND dispatch_generation=$4 AND lease_until>clock_timestamp() FOR UPDATE",
        [row.id, row.attempt_id, row.dispatch_id, row.dispatch_generation],
      )
    ).rows[0]
    if (
      !result ||
      !account ||
      account.status !== (row.kind === "export" ? "active" : "deletion_pending")
    )
      throw new RightsError(409, "ATTEMPT_EXPIRED")
    return result
  }

  async progress(row: RightsRow, key: string, value: unknown) {
    return this.tx(async (db) => {
      const live = await this.running(db, row)
      await db.query(
        "UPDATE data_requests SET progress=$2,updated_at=clock_timestamp(),version=version+1 WHERE id=$1",
        [row.id, { ...live.progress, [key]: value }],
      )
    })
  }

  async fail(row: RightsRow, code: string) {
    await this.pool.query(
      "UPDATE data_requests SET status='failed',failure_code=$3,finished_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1,attempt_id=NULL,lease_until=NULL WHERE id=$1 AND status='processing' AND attempt_id=$2",
      [row.id, row.attempt_id, code],
    )
  }

  async ownSnapshot(accountId: string, scope: string): Promise<Snapshot> {
    return this.tx(async (db) => {
      await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
      const account = (
        await db.query(
          "SELECT id,registration_id,display_name,locale,version,registered_at,updated_at,voice_call_interest_at,video_call_interest_at FROM accounts WHERE id=$1 AND status='active'",
          [accountId],
        )
      ).rows[0]
      if (!account) throw notFound()
      const data =
        scope === "account_data"
          ? {
              account,
              identities: (
                await db.query(
                  "SELECT issuer,subject,status,created_at,verified_at FROM auth_identities WHERE account_id=$1 ORDER BY issuer,subject",
                  [accountId],
                )
              ).rows,
              consents: (
                await db.query(
                  'SELECT policy_id,policy_version,purpose,decision,recorded_at,authorization_version,notice_authorization_version AS "noticeAuthorizationVersion" FROM consent_events WHERE account_id=$1 ORDER BY recorded_at,id',
                  [accountId],
                )
              ).rows,
              modelUsage: (
                await db.query(
                  'SELECT service,purpose,claimed_at,finished_at,result_allowed,usage FROM model_executions WHERE account_id=$1 AND usage IS NOT NULL ORDER BY claimed_at,id',
                  [accountId],
                )
              ).rows,
              ...await referralExport(db,accountId),
              ...await exportReports(db,accountId),
            }
          : { accountId }
      return {
        schemaVersion: 1,
        domain: "identity",
        accountId,
        capturedAt: new Date().toISOString(),
        revision: digest(JSON.stringify(data)),
        data,
      }
    })
  }

  async exportComplete(row: RightsRow, snapshots: Snapshot[]) {
    const body = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        requestId: row.id,
        accountId: row.account_id,
        scope: row.scope,
        capturedAt: new Date().toISOString(),
        domains: snapshots,
      }),
    )
    if (body.length > 64 * 1024 * 1024)
      throw new RightsError(413, "EXPORT_TOO_LARGE")
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.config.encryptionKey, iv)
    cipher.setAAD(Buffer.from(row.id))
    const encrypted = Buffer.concat([cipher.update(body), cipher.final()])
    return this.tx(async (db) => {
      await this.running(db, row)
      const required=['identity',...rightsDomains(this.config)]
      if(snapshots.length!==required.length||new Set(snapshots.map(snapshot=>snapshot.domain)).size!==required.length||required.some(domain=>!snapshots.some(snapshot=>snapshot.domain===domain&&snapshot.accountId===row.account_id&&snapshot.schemaVersion===1)))
        throw new RightsError(409,'EXPORT_INCOMPLETE')
      const expires = new Date(row.requested_at.getTime() + 86400000)
      if (expires <= new Date()) throw new RightsError(410, "EXPORT_EXPIRED")
      await db.query(
        "INSERT INTO data_exports(request_id,ciphertext,iv,tag,digest,revisions,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(request_id) DO NOTHING",
        [
          row.id,
          encrypted,
          iv,
          cipher.getAuthTag(),
          digest(body),
          Object.fromEntries(snapshots.map((s) => [s.domain, s.revision])),
          expires,
        ],
      )
      await db.query(
        "UPDATE data_requests SET status='completed',result_expires_at=$2,finished_at=clock_timestamp(),updated_at=clock_timestamp(),attempt_id=NULL,lease_until=NULL,version=version+1 WHERE id=$1",
        [row.id, expires],
      )
    })
  }

  async identities(accountId: string) {
    return (
      await this.pool.query<{ issuer: string; subject: string }>(
        "SELECT issuer,subject FROM auth_identities WHERE account_id=$1 ORDER BY issuer,subject",
        [accountId],
      )
    ).rows
  }

  async deletionComplete(row: RightsRow) {
    return this.tx(async (db) => {
      const live = await this.running(db, row)
      if(this.config.giftsUrl&&!live.progress.financialPreflight)throw new RightsError(409,'FINANCIAL_PREFLIGHT_REQUIRED')
      if (
        [...rightsDomains(this.config), "provider"].some(
          (domain) => !live.progress[domain],
        )
      )
        throw new RightsError(409, "DELETION_INCOMPLETE")
      await eraseReferrals(db,row.account_id)
      await db.query('DELETE FROM account_profile_commands WHERE account_id=$1',[row.account_id])
      await db.query('DELETE FROM model_executions WHERE account_id=$1',[row.account_id])
      await db.query('DELETE FROM model_execution_days WHERE account_id=$1',[row.account_id])
      await eraseReports(db,row.account_id)
      await db.query("DELETE FROM current_consents WHERE account_id=$1", [
        row.account_id,
      ])
      await db.query("DELETE FROM consent_events WHERE account_id=$1", [
        row.account_id,
      ])
      await db.query(
        "DELETE FROM data_export_grants WHERE request_id IN(SELECT id FROM data_requests WHERE account_id=$1)",
        [row.account_id],
      )
      await db.query(
        "DELETE FROM data_exports WHERE request_id IN(SELECT id FROM data_requests WHERE account_id=$1)",
        [row.account_id],
      )
      await db.query(
        "DELETE FROM auth_sms_challenges WHERE attempt_id IN(SELECT auth_attempt_id FROM app_sessions WHERE account_id=$1 UNION SELECT id FROM auth_attempts WHERE initiating_session_id IN(SELECT id FROM app_sessions WHERE account_id=$1))",
        [row.account_id],
      )
      await this.eraseAuthenticationAdditions(db,row.account_id)
      await db.query(
        "UPDATE auth_attempts SET state='cancelled',finished_at=clock_timestamp(),nonce=NULL,pkce_verifier=NULL,authorization_url=NULL,exchange_claim_id=NULL,exchange_lease_until=NULL,social_provider=NULL WHERE state='pending' AND initiating_session_id IN(SELECT id FROM app_sessions WHERE account_id=$1)",
        [row.account_id],
      )
      await db.query(
        "UPDATE auth_attempts SET social_provider=NULL WHERE id IN(SELECT auth_attempt_id FROM app_sessions WHERE account_id=$1) OR initiating_session_id IN(SELECT id FROM app_sessions WHERE account_id=$1)",
        [row.account_id],
      )
      await db.query(
        "UPDATE app_sessions SET status='revoked',revoked_at=clock_timestamp(),credential_hash=md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text),reauthenticated_at=NULL WHERE account_id=$1",
        [row.account_id],
      )
      await db.query(
        "UPDATE auth_identities SET status='disabled' WHERE account_id=$1",
        [row.account_id],
      )
      await db.query(
        "UPDATE accounts SET status='deleted',display_name='',locale='und',deleted_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE id=$1",
        [row.account_id],
      )
      await db.query(
        "UPDATE data_requests SET status='completed',finished_at=clock_timestamp(),updated_at=clock_timestamp(),attempt_id=NULL,lease_until=NULL,version=version+1 WHERE id=$1",
        [row.id],
      )
    })
  }

  async recover() {
    await this.tx(async (db) => {
      const rows = (
        await db.query<RightsRow>(
          "SELECT * FROM data_requests WHERE status='processing' AND lease_until<=clock_timestamp() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 50",
        )
      ).rows
      for (const row of rows) {
        if (row.attempt_count >= 4) {
          await db.query(
            "UPDATE data_requests SET status='failed',failure_code='WORKER_RECOVERY_EXHAUSTED',finished_at=clock_timestamp(),updated_at=clock_timestamp(),attempt_id=NULL,lease_until=NULL,version=version+1 WHERE id=$1",
            [row.id],
          )
          continue
        }
        const next = (
          await db.query<RightsRow>(
            "UPDATE data_requests SET status='accepted',updated_at=clock_timestamp(),attempt_id=NULL,lease_until=NULL,dispatch_id=$2,dispatch_generation=dispatch_generation+1,version=version+1 WHERE id=$1 RETURNING *",
            [row.id, randomUUID()],
          )
        ).rows[0]
        await this.queue.send(db, {
          requestId: next.id,
          dispatchId: next.dispatch_id,
          dispatchGeneration: next.dispatch_generation,
        })
      }
      if (this.queue.isPending) {
        const accepted = (
          await db.query<RightsRow>(
            "SELECT * FROM data_requests WHERE status='accepted' AND updated_at<clock_timestamp()-interval '2 minutes' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 50",
          )
        ).rows
        for (const pending of accepted) {
          if (
            !(await this.queue.isPending(db, {
              requestId: pending.id,
              dispatchId: pending.dispatch_id,
              dispatchGeneration: pending.dispatch_generation,
            }))
          )
            await db.query(
              "UPDATE data_requests SET status='failed',failure_code='QUEUE_DISPATCH_LOST',finished_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE id=$1 AND status='accepted'",
              [pending.id],
            )
        }
      }
    })
    await this.reconcileDeletedAuthentication()
    await this.sweep()
  }

  async release(row: RightsRow) {
    await this.pool.query(
      "UPDATE data_requests SET lease_until=clock_timestamp() WHERE id=$1 AND status='processing' AND attempt_id=$2",
      [row.id, row.attempt_id],
    )
    await this.recover()
  }

  async sweep() {
    await this.pool.query(
      "DELETE FROM data_export_grants WHERE expires_at<=clock_timestamp() OR request_id IN(SELECT request_id FROM data_exports WHERE expires_at<=clock_timestamp())",
    )
    await this.pool.query(
      "DELETE FROM data_exports WHERE expires_at<=clock_timestamp()",
    )
  }

  async artifact(accountId: string, id: string, db:Pool|PoolClient=this.pool) {
    const request = (
      await db.query(
        "SELECT result_expires_at<=clock_timestamp() AS expired FROM data_requests WHERE id=$1 AND account_id=$2 AND kind='export' AND status='completed'",
        [id, accountId],
      )
    ).rows[0]
    if (!request) throw notFound()
    if (request.expired) throw new RightsError(410, "EXPORT_EXPIRED")
    const row = (
      await db.query(
        "SELECT * FROM data_exports WHERE request_id=$1 AND expires_at>clock_timestamp()",
        [id],
      )
    ).rows[0]
    if (!row) throw notFound()
    return row
  }

  async download(
    hash: string,
    expected: string | undefined,
    id: string,
    snapshots: () => Promise<Snapshot[]>,
    key: string,
  ) {
    const s = await this.requireRecent(hash, expected)
    const artifact = await this.artifact(s.accountId, id)
    const current = await snapshots()
    if (
      JSON.stringify(artifact.revisions) !==
      JSON.stringify(
        Object.fromEntries(
          current.map((value) => [value.domain, value.revision]),
        ),
      )
    ) {
      const a = artifact.revisions as Record<string, string>
      if (
        current.some((value) => a[value.domain] !== value.revision) ||
        Object.keys(a).length !== current.length
      )
        throw new RightsError(409, "EXPORT_STALE")
    }

    return this.identity.withLockedSession(hash, expected, async (db, live) => {
      await this.recent(db, live)
      const prior = (
        await db.query(
          "SELECT id,expires_at FROM data_export_grants WHERE session_id=$1 AND request_id=$2 AND idempotency_key=$3",
          [live.id, id, key],
        )
      ).rows[0]
      if (prior) {
        if (prior.expires_at <= new Date())
          throw new RightsError(410, "DOWNLOAD_GRANT_EXPIRED")
        return {
          downloadUrl:
            "/v1/accounts/me/data-requests/" +
            id +
            "/content?grant=" +
            prior.id,
          expiresAt: prior.expires_at.toISOString(),
        }
      }
      const grant = randomUUID()
      await this.artifact(live.accountId, id, db)
      const expiresAt = new Date(
        Math.min(Date.now() + 60000, new Date(artifact.expires_at).getTime()),
      )
      await db.query(
        "INSERT INTO data_export_grants(id,request_id,session_id,expires_at,idempotency_key) VALUES($1,$2,$3,$4,$5)",
        [grant, id, live.id, expiresAt, key],
      )
      return {
        downloadUrl:
          "/v1/accounts/me/data-requests/" + id + "/content?grant=" + grant,
        expiresAt: expiresAt.toISOString(),
      }
    })
  }

  async content(
    hash: string,
    expected: string | undefined,
    id: string,
    grant: string,
    snapshots: () => Promise<Snapshot[]>,
  ) {
    const session = await this.requireRecent(hash, expected)
    const g = await this.pool.query(
      "SELECT id,expires_at<=clock_timestamp() AS expired FROM data_export_grants WHERE id=$1 AND request_id=$2 AND session_id=$3",
      [grant, id, session.id],
    )
    if (!g.rowCount) throw notFound()
    if (g.rows[0].expired) throw new RightsError(410, "DOWNLOAD_GRANT_EXPIRED")
    const artifact = await this.artifact(session.accountId, id)
    const snapshotsNow = await snapshots()
    const revisions = artifact.revisions as Record<string, string>
    if (
      snapshotsNow.some(
        (value) => revisions[value.domain] !== value.revision,
      ) ||
      Object.keys(revisions).length !== snapshotsNow.length
    )
      throw new RightsError(409, "EXPORT_STALE")
    await this.requireRecent(hash, expected)
    const cipher = createDecipheriv(
      "aes-256-gcm",
      this.config.encryptionKey,
      artifact.iv,
    )
    cipher.setAAD(Buffer.from(id))
    cipher.setAuthTag(artifact.tag)
    const body = Buffer.concat([
      cipher.update(artifact.ciphertext),
      cipher.final(),
    ])
    if (digest(body) !== artifact.digest)
      throw new RightsError(500, "EXPORT_INTEGRITY_FAILED")
    return body
  }

  async row(id: string) {
    const row = (
      await this.pool.query<RightsRow>(
        "SELECT * FROM data_requests WHERE id=$1",
        [id],
      )
    ).rows[0]
    if (!row) throw notFound()
    return row
  }
}
