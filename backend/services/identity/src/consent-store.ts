import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { IdentityStore } from './store.js'

export type Purpose = 'privacy_notice' | 'private_story_storage' | 'ai_text_processing' | 'private_photo_storage' | 'private_person_photo_storage' | 'virtual_gift_storage' | 'person_gift_returns' | 'gift_delivery_photo_storage' | 'private_letter_storage' | 'person_letter_replies' | 'person_gather_replies' | 'private_chat_photo_storage' | 'person_chat_image_replies' | 'person_world_actions' | 'person_story_branches' | 'person_offline_life' | 'production_model_execution' | 'person_voice_calls' | 'private_person_voice_storage' | 'private_chat_reply_speech'
export type Decision = 'acknowledge' | 'grant' | 'revoke'
export type PolicyLocale = 'zh-CN' | 'en'
export type ConsentInput = {
  policyId: string
  version: number
  purpose: Purpose
  decision: Decision
  expectedAuthorizationVersion: number
}

export class ConsentError extends Error {
  constructor(
    readonly status: 403 | 409 | 412,
    readonly code: 'FORBIDDEN' | 'IDEMPOTENCY_CONFLICT' | 'VERSION_CONFLICT',
    message: string,
    readonly details?: Record<string, number>,
  ) { super(message) }
}

type EventRow = {
  id: string; policy_id: string; policy_version: number; purpose: Purpose
  decision: Decision; recorded_at: Date; authorization_version: number
}
type PolicyRow = { id: string; kind: Purpose; version: number }
type PolicyStateRow = PolicyRow & {
  authorization_version: number | null; decision: Decision | null
  notice_authorization_version: number | null
  ai_automatic_memory_enabled: boolean
  private_feed_enabled: boolean
  private_feed_processing_enabled: boolean
  world_event_history_enabled: boolean
}

function authorizations(rows: PolicyStateRow[]) {
  const notice = rows.find(row => row.kind === 'privacy_notice')
  const storage = rows.find(row => row.kind === 'private_story_storage')
  const ai = rows.find(row => row.kind === 'ai_text_processing')
  const photo = rows.find(row => row.kind === 'private_photo_storage')
  const gift = rows.find(row => row.kind === 'virtual_gift_storage')
  const returns = rows.find(row => row.kind === 'person_gift_returns')
  const personPhoto = rows.find(row => row.kind === 'private_person_photo_storage')
  const giftPhoto = rows.find(row => row.kind === 'gift_delivery_photo_storage')
  const letters = rows.find(row => row.kind === 'private_letter_storage')
  const replies = rows.find(row => row.kind === 'person_letter_replies')
  const gather = rows.find(row => row.kind === 'person_gather_replies')
  const chatPhoto = rows.find(row => row.kind === 'private_chat_photo_storage')
  const chatImage = rows.find(row => row.kind === 'person_chat_image_replies')
  const worldActions = rows.find(row => row.kind === 'person_world_actions')
  const branches = rows.find(row => row.kind === 'person_story_branches')
  const offline = rows.find(row => row.kind === 'person_offline_life')
  const voice=rows.find(row=>row.kind==='person_voice_calls')
  const sourceVoice=rows.find(row=>row.kind==='private_person_voice_storage')
  const chatSpeech=rows.find(row=>row.kind==='private_chat_reply_speech')
  const production = rows.find(row => row.kind === 'production_model_execution')
  const acknowledged = notice?.decision === 'acknowledge'
  const aiAllowed=acknowledged&&ai?.decision==='grant'&&ai.notice_authorization_version===notice?.authorization_version
  const storageAllowed=acknowledged&&storage?.decision==='grant'&&(!storage.private_feed_enabled||storage.notice_authorization_version===notice?.authorization_version)
  const worldActionsAllowed=acknowledged&&worldActions?.decision==='grant'&&worldActions.notice_authorization_version===notice?.authorization_version
  return {
    ...(chatSpeech?{chatReplySpeech:{allowed:acknowledged&&chatSpeech.decision==='grant'&&chatSpeech.notice_authorization_version===notice?.authorization_version,authorizationVersion:chatSpeech.authorization_version??0}}:{}),
    ...(sourceVoice?{personVoiceStorage:{allowed:acknowledged&&sourceVoice.decision==='grant'&&sourceVoice.notice_authorization_version===notice?.authorization_version,authorizationVersion:sourceVoice.authorization_version??0}}:{}),
    ...(voice?{voiceCalls:{allowed:acknowledged&&voice.decision==='grant'&&voice.notice_authorization_version===notice?.authorization_version,authorizationVersion:voice.authorization_version??0}}:{}),
    ...(production ? {productionModelExecution:{allowed:acknowledged&&production.decision==='grant'&&production.notice_authorization_version===notice?.authorization_version,authorizationVersion:production.authorization_version??0}} : {}),
    storyStorage: {
      allowed: storageAllowed,
      authorizationVersion: storage?.authorization_version ?? 0,
      ...(storageAllowed&&storage?.private_feed_enabled===true?{privateFeedAllowed:true}:{}),
    },
    aiTextProcessing: {
      allowed: aiAllowed,
      authorizationVersion: ai?.authorization_version ?? 0,
      ...(aiAllowed&&ai?.ai_automatic_memory_enabled===true?{automaticMemoryAllowed:true}:{}),
      ...(aiAllowed&&ai?.private_feed_processing_enabled===true?{privateFeedProcessingAllowed:true}:{}),
    },
    ...(photo ? {photoStorage:{allowed:acknowledged&&photo.decision==='grant'&&photo.notice_authorization_version===notice?.authorization_version,authorizationVersion:photo.authorization_version??0}} : {}),
    ...(gift ? {giftStorage:{allowed:acknowledged&&gift.decision==='grant'&&gift.notice_authorization_version===notice?.authorization_version,authorizationVersion:gift.authorization_version??0}} : {}),
    ...(returns ? {giftReturns:{allowed:acknowledged&&returns.decision==='grant'&&returns.notice_authorization_version===notice?.authorization_version,authorizationVersion:returns.authorization_version??0}} : {}),
    ...(personPhoto ? {personPhotoStorage:{allowed:acknowledged&&personPhoto.decision==='grant'&&personPhoto.notice_authorization_version===notice?.authorization_version,authorizationVersion:personPhoto.authorization_version??0}} : {}),
    ...(giftPhoto ? {giftPhotoStorage:{allowed:acknowledged&&giftPhoto.decision==='grant'&&giftPhoto.notice_authorization_version===notice?.authorization_version,authorizationVersion:giftPhoto.authorization_version??0}} : {}),
    ...(letters ? {letterStorage:{allowed:acknowledged&&letters.decision==='grant'&&letters.notice_authorization_version===notice?.authorization_version,authorizationVersion:letters.authorization_version??0}} : {}),
    ...(replies ? {letterReplies:{allowed:acknowledged&&replies.decision==='grant'&&replies.notice_authorization_version===notice?.authorization_version,authorizationVersion:replies.authorization_version??0}} : {}),
    ...(gather ? {gatherReplies:{allowed:acknowledged&&gather.decision==='grant'&&gather.notice_authorization_version===notice?.authorization_version,authorizationVersion:gather.authorization_version??0}} : {}),
    ...(chatPhoto ? {chatPhotoStorage:{allowed:acknowledged&&chatPhoto.decision==='grant'&&chatPhoto.notice_authorization_version===notice?.authorization_version,authorizationVersion:chatPhoto.authorization_version??0}} : {}),
    ...(worldActions ? {worldActionProcessing:{allowed:worldActionsAllowed,authorizationVersion:worldActions.authorization_version??0,
      ...(worldActionsAllowed&&worldActions.world_event_history_enabled===true?{historicalWorldEventsAllowed:true}:{}),
    }} : {}),
    ...(branches ? {storyBranches:{allowed:acknowledged&&branches.decision==='grant'&&branches.notice_authorization_version===notice?.authorization_version,authorizationVersion:branches.authorization_version??0}} : {}),
    ...(offline ? {offlineLife:{allowed:acknowledged&&offline.decision==='grant'&&offline.notice_authorization_version===notice?.authorization_version,authorizationVersion:offline.authorization_version??0}} : {}),
    ...(chatImage ? {chatImageReplies:{allowed:acknowledged&&chatImage.decision==='grant'&&chatImage.notice_authorization_version===notice?.authorization_version,authorizationVersion:chatImage.authorization_version??0}} : {}),
  }
}

const events = 'id, policy_id, policy_version, purpose, decision, recorded_at, authorization_version'
const currentPolicies = `SELECT DISTINCT ON (kind) id, kind, version,
  COALESCE((to_jsonb(policy_versions)->>'ai_automatic_memory_enabled')::boolean,false) AS ai_automatic_memory_enabled,
  COALESCE((to_jsonb(policy_versions)->>'private_feed_enabled')::boolean,false) AS private_feed_enabled,
  COALESCE((to_jsonb(policy_versions)->>'private_feed_processing_enabled')::boolean,false) AS private_feed_processing_enabled,
  COALESCE((to_jsonb(policy_versions)->>'world_event_history_enabled')::boolean,false) AS world_event_history_enabled FROM policy_versions
  WHERE effective_at <= statement_timestamp() AND (retired_at IS NULL OR retired_at > statement_timestamp())
  ORDER BY kind, version DESC`

function dto(row: EventRow) {
  return {
    id: row.id, policyId: row.policy_id, version: row.policy_version, purpose: row.purpose,
    decision: row.decision, recordedAt: row.recorded_at.toISOString(), authorizationVersion: row.authorization_version,
  }
}

export class ConsentStore {
  constructor(private readonly pool: Pool, private readonly identity: IdentityStore) {}

  async policies(locale: PolicyLocale) {
    const result = await this.pool.query<PolicyRow&{private_feed_processing_enabled:boolean}>(currentPolicies)
    return result.rows.map(row => ({
      id: row.id, kind: row.kind, version: row.version, locale, decisionRequired: true,
      documentUrl: '/v1/policies/' + row.id + '/' + row.version + '?locale=' + locale,
      ...(row.private_feed_processing_enabled===true?{privateFeedProcessingEnabled:true}:{}),
    }))
  }

  async document(id: string, version: number, locale: PolicyLocale) {
    const result = await this.pool.query<{ body: string }>(
      `SELECT CASE WHEN $3 = 'en' THEN document_en ELSE document_zh_cn END AS body
       FROM policy_versions WHERE id = $1 AND version = $2 AND published_at <= statement_timestamp()`,
      [id, version, locale],
    )
    return result.rows[0]?.body ?? null
  }

  private async current(accountId: string, db: Pool | PoolClient = this.pool) {
    const result = await db.query<PolicyStateRow>(
      `WITH policies AS (${currentPolicies})
       SELECT p.id, p.kind, p.version, p.ai_automatic_memory_enabled, p.private_feed_enabled, p.private_feed_processing_enabled, p.world_event_history_enabled, c.authorization_version, e.notice_authorization_version,
          CASE WHEN (e.policy_id, e.policy_version) = (p.id, p.version) THEN e.decision END AS decision
       FROM policies p
       LEFT JOIN current_consents c ON c.account_id = $1 AND c.purpose = p.kind
       LEFT JOIN consent_events e ON (e.account_id, e.purpose, e.authorization_version) =
         (c.account_id, c.purpose, c.authorization_version)`,
      [accountId],
    )
    return result.rows
  }

  async storyStorage(accountId: string) {
    return (await this.authorizations(accountId)).storyStorage
  }

  async authorizations(accountId: string, db: Pool | PoolClient = this.pool) {
    return authorizations(await this.current(accountId, db))
  }

  async history(accountId: string, limit: number, afterId: string | null) {
    const result = await this.pool.query<EventRow>(
      `SELECT ${events} FROM consent_events
       WHERE account_id = $1 AND ($2::uuid IS NULL OR (recorded_at, id) <
         (SELECT recorded_at, id FROM consent_events WHERE account_id = $1 AND id = $2))
       ORDER BY recorded_at DESC, id DESC LIMIT $3`,
      [accountId, afterId, limit + 1],
    )
    const currentAuthorizationVersions: Partial<Record<Purpose, number>> = { privacy_notice: 0, private_story_storage: 0, ai_text_processing: 0 }
    const currentDecisions: Partial<Record<Purpose, Decision>> = {}
    const current = await this.current(accountId)
    for (const row of current) {
      currentAuthorizationVersions[row.kind] = row.authorization_version ?? 0
      if (row.decision) currentDecisions[row.kind] = row.decision
    }
    const data = result.rows.slice(0, limit).map(dto)
    return {
      data, nextId: result.rows.length > limit ? data[data.length - 1].id : null,
      currentAuthorizationVersions, currentDecisions,
      aiTextProcessing: authorizations(current).aiTextProcessing,
      storyStorage: authorizations(current).storyStorage,
      ...(authorizations(current).photoStorage ? {photoStorage:authorizations(current).photoStorage} : {}),
      ...(authorizations(current).giftStorage ? {giftStorage:authorizations(current).giftStorage} : {}),
      ...(authorizations(current).giftReturns ? {giftReturns:authorizations(current).giftReturns} : {}),
      ...(authorizations(current).personPhotoStorage ? {personPhotoStorage:authorizations(current).personPhotoStorage} : {}),
      ...(authorizations(current).giftPhotoStorage ? {giftPhotoStorage:authorizations(current).giftPhotoStorage} : {}),
      ...(authorizations(current).letterStorage ? {letterStorage:authorizations(current).letterStorage} : {}),
      ...(authorizations(current).letterReplies ? {letterReplies:authorizations(current).letterReplies} : {}),
      ...(authorizations(current).gatherReplies ? {gatherReplies:authorizations(current).gatherReplies} : {}),
      ...(authorizations(current).chatPhotoStorage ? {chatPhotoStorage:authorizations(current).chatPhotoStorage} : {}),
      ...(authorizations(current).storyBranches ? {storyBranches:authorizations(current).storyBranches} : {}),
      ...(authorizations(current).voiceCalls?{voiceCalls:authorizations(current).voiceCalls}:{}),
      ...(authorizations(current).personVoiceStorage?{personVoiceStorage:authorizations(current).personVoiceStorage}:{}),
      ...(authorizations(current).productionModelExecution ? {productionModelExecution:authorizations(current).productionModelExecution} : {}),
      ...(authorizations(current).offlineLife ? {offlineLife:authorizations(current).offlineLife} : {}),
      ...(authorizations(current).worldActionProcessing ? {worldActionProcessing:authorizations(current).worldActionProcessing} : {}),
      ...(authorizations(current).chatImageReplies ? {chatImageReplies:authorizations(current).chatImageReplies} : {}),
    }
  }

  async record(sessionHash: string, expectedSessionId: string | undefined, key: string, requestId: string, input: ConsentInput) {
    const fingerprint = createHash('sha256').update(JSON.stringify([
      input.policyId, input.version, input.purpose, input.decision, input.expectedAuthorizationVersion,
    ])).digest('hex')
    return this.identity.withLockedSession(sessionHash, expectedSessionId, async (db, session) => {
      const accountId = session.accountId
      const prior = await db.query<EventRow & { request_fingerprint: string }>(
        `SELECT ${events}, request_fingerprint FROM consent_events WHERE account_id = $1 AND idempotency_key = $2`,
        [accountId, key],
      )
      const replay = prior.rows[0]
      if (replay) {
        if (replay.request_fingerprint !== fingerprint) {
          throw new ConsentError(409, 'IDEMPOTENCY_CONFLICT', 'The key was already used for a different authorization decision.')
        }
        return dto(replay)
      }

      const rows = await this.current(accountId, db)
      const policy = rows.find(row => row.kind === input.purpose)
      const currentVersion = policy?.authorization_version ?? 0
      if (!policy || policy.id !== input.policyId || policy.version !== input.version ||
          currentVersion !== input.expectedAuthorizationVersion) {
        throw new ConsentError(412, 'VERSION_CONFLICT', 'Read the current policy and authorization before deciding.',
          { currentAuthorizationVersion: currentVersion, ...(policy ? { currentPolicyVersion: policy.version } : {}) })
      }
      if (input.decision === 'grant' && !rows.some(row => row.kind === 'privacy_notice' && row.decision === 'acknowledge')) {
        throw new ConsentError(403, 'FORBIDDEN', 'Acknowledge the current privacy notice before granting this permission.')
      }

      const result = await db.query<EventRow>(
        `INSERT INTO consent_events
           (account_id, purpose, policy_id, policy_version, decision, authorization_version, idempotency_key, request_fingerprint, notice_authorization_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${events}`,
        [accountId, input.purpose, policy.id, policy.version, input.decision, currentVersion + 1, key, fingerprint,
          (input.purpose === 'private_chat_reply_speech' || input.purpose === 'private_person_voice_storage' || input.purpose === 'person_voice_calls' || input.purpose === 'production_model_execution' || input.purpose === 'ai_text_processing' || input.purpose === 'private_photo_storage' || input.purpose === 'private_person_photo_storage' || input.purpose === 'virtual_gift_storage' || input.purpose === 'person_gift_returns' || input.purpose === 'gift_delivery_photo_storage' || input.purpose === 'private_letter_storage' || input.purpose === 'person_letter_replies' || input.purpose === 'person_gather_replies' || input.purpose === 'private_chat_photo_storage' || input.purpose === 'person_chat_image_replies' || input.purpose === 'person_world_actions' || input.purpose === 'person_story_branches' || input.purpose === 'person_offline_life' || input.purpose==='private_story_storage' && policy.private_feed_enabled===true) && input.decision === 'grant'
            ? rows.find(row => row.kind === 'privacy_notice')!.authorization_version : null],
      )
      const event = result.rows[0]
      await db.query(
        `INSERT INTO current_consents (account_id, purpose, authorization_version, updated_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (account_id, purpose) DO UPDATE
         SET authorization_version = EXCLUDED.authorization_version, updated_at = EXCLUDED.updated_at`,
        [accountId, event.purpose, event.authorization_version, event.recorded_at],
      )
      if (event.decision === 'revoke') {
        await db.query(
          `INSERT INTO outbox_events
           (type, schema_version, account_id, aggregate_type, aggregate_id, aggregate_version, occurred_at, request_id, payload)
           VALUES ($6, 1, $1, $7, $1, $2, $3, $4, $5::jsonb)`,
          [accountId, event.authorization_version, event.recorded_at, requestId, JSON.stringify({
            accountId, purpose: event.purpose, authorizationVersion: event.authorization_version, revokedAt: event.recorded_at.toISOString(),
          }), event.purpose === 'private_chat_reply_speech' ? 'ChatReplySpeechRevoked.v1' : event.purpose === 'private_person_voice_storage' ? 'PersonVoiceStorageRevoked.v1' : event.purpose === 'person_voice_calls' ? 'VoiceCallsRevoked.v1' : event.purpose === 'production_model_execution' ? 'ProductionModelExecutionRevoked.v1' : event.purpose === 'person_story_branches' ? 'StoryBranchesRevoked.v1' : event.purpose === 'person_offline_life' ? 'OfflineLifeRevoked.v1' : event.purpose === 'person_world_actions' ? 'WorldActionProcessingRevoked.v1' : event.purpose === 'private_chat_photo_storage' ? 'ChatPhotoStorageRevoked.v1' : event.purpose === 'person_chat_image_replies' ? 'ChatImageRepliesRevoked.v1' : event.purpose === 'person_gather_replies' ? 'GatherRepliesRevoked.v1' : event.purpose === 'private_letter_storage' ? 'LetterStorageRevoked.v1' : event.purpose === 'person_letter_replies' ? 'LetterRepliesRevoked.v1' : event.purpose === 'gift_delivery_photo_storage' ? 'GiftPhotoStorageRevoked.v1' : event.purpose === 'person_gift_returns' ? 'GiftReturnsRevoked.v1' : event.purpose === 'ai_text_processing' ? 'AiTextProcessingRevoked.v1' : event.purpose === 'private_photo_storage' ? 'PhotoStorageRevoked.v1' : event.purpose === 'virtual_gift_storage' ? 'GiftStorageRevoked.v1' : event.purpose === 'private_person_photo_storage' ? 'PersonPhotoStorageRevoked.v1' : 'StoryStorageRevoked.v1',
          event.purpose === 'private_chat_reply_speech' ? 'chat_reply_speech_authorization' : event.purpose === 'private_person_voice_storage' ? 'person_voice_storage_authorization' : event.purpose === 'person_voice_calls' ? 'voice_calls_authorization' : event.purpose === 'production_model_execution' ? 'production_model_execution_authorization' : event.purpose === 'person_story_branches' ? 'story_branches_authorization' : event.purpose === 'person_offline_life' ? 'offline_life_authorization' : event.purpose === 'person_world_actions' ? 'world_action_processing_authorization' : event.purpose === 'private_chat_photo_storage' ? 'chat_photo_storage_authorization' : event.purpose === 'person_chat_image_replies' ? 'chat_image_replies_authorization' : event.purpose === 'person_gather_replies' ? 'gather_replies_authorization' : event.purpose === 'private_letter_storage' ? 'letter_storage_authorization' : event.purpose === 'person_letter_replies' ? 'letter_replies_authorization' : event.purpose === 'gift_delivery_photo_storage' ? 'gift_photo_storage_authorization' : event.purpose === 'person_gift_returns' ? 'gift_returns_authorization' : event.purpose === 'ai_text_processing' ? 'ai_text_processing_authorization' : event.purpose === 'private_photo_storage' ? 'photo_storage_authorization' : event.purpose === 'virtual_gift_storage' ? 'gift_storage_authorization' : event.purpose === 'private_person_photo_storage' ? 'person_photo_storage_authorization' : 'story_storage_authorization'],
        )
      }
      return dto(event)
    })
  }
}
