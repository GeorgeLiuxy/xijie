import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { ConversationError, notFound } from './contracts.js'
import type { AccountContext } from './dependencies.js'
import type { ConversationStore } from './store.js'

export const REPLY_SPEECH_MAX_CHARS = 240
export const REPLY_SPEECH_MAX_BYTES = 2_160_044
const ACCOUNT_CLIP_LIMIT = 4
const ACCOUNT_ATTEMPT_LIMIT = 24

type State = 'queued' | 'running' | 'ready' | 'failed' | 'blocked'
type Job = {
  id: string
  account_id: string
  conversation_id: string
  message_id: string
  source_version: number
  account_access_version: number
  storage_version: number
  speech_version: number
  production_version: number
  state: State
  attempt_id: string | null
  recovery_blocked: boolean
  wav?: Buffer
}
const grantRequired = () => new ConversationError(403, 'REPLY_SPEECH_PERMISSION_REQUIRED', 'Speech permission is required.')
const changed = () => new ConversationError(409, 'REPLY_SPEECH_SOURCE_CHANGED', 'The source reply or permissions have changed.')
function permitted(account: AccountContext) {
  if (!account.storyStorage.allowed || !account.chatReplySpeech?.allowed
    || (process.env.NODE_ENV === 'production' && !account.productionModelExecution?.allowed)) throw grantRequired()
  return account.chatReplySpeech.authorizationVersion
}
const productionVersion = (account: AccountContext) => process.env.NODE_ENV === 'production'
  ? account.productionModelExecution?.authorizationVersion ?? 0 : 0

export class ReplySpeechStore {
  constructor(private readonly conversations: ConversationStore) {}

  private async readAuthority(accountId: string, conversationId: string, messageId: string) {
    const { dependencies } = this.conversations
    const account = await dependencies.account(accountId)
    const speechVersion = permitted(account)
    const { source } = await this.conversations.memorySourceContext(accountId, messageId)
    if (source.conversationId !== conversationId || source.author.kind !== 'persona'
      || [...source.text].length > REPLY_SPEECH_MAX_CHARS || !/[\p{L}\p{N}]/u.test(source.text)) throw notFound()
    return { account, speechVersion, productionVersion: productionVersion(account), source }
  }

  private sameAuthority(job: Job, authority: Awaited<ReturnType<ReplySpeechStore['readAuthority']>>) {
    if (job.recovery_blocked || job.source_version !== authority.source.version || job.speech_version !== authority.speechVersion
      || job.production_version !== authority.productionVersion || job.account_access_version !== authority.account.accessVersion
      || job.storage_version !== authority.account.storyStorage.authorizationVersion) throw changed()
  }

  private async serialized<T>(accountId: string, run: (db: PoolClient) => Promise<T>) {
    const db = await this.conversations.pool.connect()
    try {
      await db.query('BEGIN')
      // Same lock ordering as the rights worker and message mutations.
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended('xijie:conversations:erasure:' || $1, 0))", [accountId])
      const value = await run(db)
      await db.query('COMMIT')
      return value
    } catch (error) {
      await db.query('ROLLBACK')
      throw error
    } finally { db.release() }
  }

  async request(accountId: string, conversationId: string, messageId: string, expectedVersion: number) {
    const authority = await this.readAuthority(accountId, conversationId, messageId)
    if (authority.source.version !== expectedVersion) throw changed()
    const { source, speechVersion, account, productionVersion } = authority
    const row = await this.serialized(accountId, async db => {
      const records = await db.query<Job>(`SELECT id,account_id,conversation_id,message_id,source_version,account_access_version,
       storage_version,speech_version,production_version,state,attempt_id,recovery_blocked FROM chat_reply_speech
       WHERE account_id=$1 AND message_id=$2 AND source_version=$3 AND speech_version=$4
        AND account_access_version=$5 AND storage_version=$6 AND production_version=$7`,
       [accountId, messageId, source.version, speechVersion, account.accessVersion, account.storyStorage.authorizationVersion, productionVersion])
      if (records.rows[0]) {
        this.sameAuthority(records.rows[0], authority)
        return records.rows[0]
      }
      const sourceStillValid = await db.query('SELECT id FROM messages WHERE account_id=$1 AND conversation_id=$2 AND id=$3 AND version=$4 AND removed_at IS NULL FOR SHARE',
        [accountId, conversationId, messageId, source.version])
      if (!sourceStillValid.rowCount) throw changed()
      const counts = await db.query<{ attempts: number; clips: number }>(`SELECT COUNT(*)::int AS attempts,
        COUNT(*) FILTER (WHERE state NOT IN ('failed','blocked'))::int AS clips FROM chat_reply_speech WHERE account_id=$1`, [accountId])
      if (counts.rows[0].attempts >= ACCOUNT_ATTEMPT_LIMIT || counts.rows[0].clips >= ACCOUNT_CLIP_LIMIT)
        throw new ConversationError(409, 'REPLY_SPEECH_LIMIT', 'The account speech pilot limit was reached.')
      return (await db.query<Job>(`INSERT INTO chat_reply_speech(account_id,conversation_id,message_id,source_version,account_access_version,storage_version,speech_version,production_version)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [accountId, conversationId, messageId, source.version,
        account.accessVersion, account.storyStorage.authorizationVersion, speechVersion, productionVersion])).rows[0]
    })
    this.sameAuthority(row, await this.readAuthority(accountId, conversationId, messageId))
    return { state: row.state }
  }

  async read(accountId: string, conversationId: string, messageId: string, expectedVersion: number, audio = false) {
    const authority = await this.readAuthority(accountId, conversationId, messageId)
    if (authority.source.version !== expectedVersion) throw changed()
    const result = await this.conversations.pool.query<Job>(`SELECT s.id,s.account_id,s.conversation_id,s.message_id,s.source_version,
      s.account_access_version,s.storage_version,s.speech_version,s.production_version,s.state,s.attempt_id,s.recovery_blocked${audio ? ',s.wav' : ''}
      FROM chat_reply_speech s JOIN messages m ON m.account_id=s.account_id AND m.conversation_id=s.conversation_id AND m.id=s.message_id
      WHERE s.account_id=$1 AND s.conversation_id=$2 AND s.message_id=$3 AND s.source_version=$4 AND s.speech_version=$5
        AND s.account_access_version=$6 AND s.storage_version=$7 AND s.production_version=$8
        AND m.version=s.source_version AND m.removed_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM account_erasure_fences f WHERE f.account_id=s.account_id AND f.erased_at IS NOT NULL)`,
      [accountId, conversationId, messageId, authority.source.version, authority.speechVersion,
        authority.account.accessVersion, authority.account.storyStorage.authorizationVersion, authority.productionVersion])
    const job = result.rows[0]
    if (job) this.sameAuthority(job, await this.readAuthority(accountId, conversationId, messageId))
    return job
  }

  async candidate() {
    const records = await this.conversations.pool.query<Job>(`SELECT * FROM chat_reply_speech
      WHERE NOT recovery_blocked AND (state='queued' OR state='running' AND lease_until <= clock_timestamp()) ORDER BY created_at,id LIMIT 1`)
    const job = records.rows[0]
    if (!job) return
    return this.serialized(job.account_id, async db => {
      // A dead worker may already have contacted the provider. Retire the attempt rather than charging twice.
      if (job.state === 'running') {
        await db.query(`UPDATE chat_reply_speech SET state='failed',lease_until=NULL,updated_at=clock_timestamp()
          WHERE id=$1 AND state='running' AND attempt_id=$2 AND lease_until <= clock_timestamp()`, [job.id, job.attempt_id])
        return
      }
      return (await db.query<Job>(`UPDATE chat_reply_speech SET state='running',attempt_id=$2,
        lease_until=clock_timestamp()+interval '42 seconds',updated_at=clock_timestamp()
        WHERE id=$1 AND state='queued' AND NOT recovery_blocked RETURNING *`, [job.id, randomUUID()])).rows[0]
    })
  }

  async sourceText(job: Job) {
    const authority = await this.readAuthority(job.account_id, job.conversation_id, job.message_id)
    this.sameAuthority(job, authority)
    const row = await this.conversations.pool.query(`SELECT id FROM chat_reply_speech
      WHERE id=$1 AND attempt_id=$2 AND state='running' AND NOT recovery_blocked AND lease_until>clock_timestamp()`, [job.id, job.attempt_id])
    if (!row.rowCount) throw changed()
    return authority.source.text
  }

  async complete(job: Job, model: string, wav: Buffer) {
    this.sameAuthority(job, await this.readAuthority(job.account_id, job.conversation_id, job.message_id))
    return this.serialized(job.account_id, async db => {
      const result = await db.query(`UPDATE chat_reply_speech s
        SET state='ready',lease_until=NULL,wav=$3,model=$4,updated_at=clock_timestamp()
        WHERE s.id=$1 AND s.attempt_id=$2 AND s.state='running' AND NOT s.recovery_blocked AND s.lease_until>clock_timestamp()
          AND EXISTS(SELECT 1 FROM messages m WHERE m.account_id=s.account_id AND m.conversation_id=s.conversation_id
            AND m.id=s.message_id AND m.version=s.source_version AND m.removed_at IS NULL)`, [job.id, job.attempt_id, wav, model])
      return result.rowCount === 1
    })
  }

  async fail(job: Job, state: 'failed' | 'blocked') {
    await this.serialized(job.account_id, db => db.query(`UPDATE chat_reply_speech SET state=$3,lease_until=NULL,updated_at=clock_timestamp()
      WHERE id=$1 AND attempt_id=$2 AND state='running'`, [job.id, job.attempt_id, state]))
  }
}
