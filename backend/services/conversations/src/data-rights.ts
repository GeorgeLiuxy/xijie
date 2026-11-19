import { createHash, timingSafeEqual } from 'node:crypto'
import type { Pool } from 'pg'
import type { Request } from 'express'
import type { ConversationConfig } from './config.js'
import { invalid, notFound, ConversationError, uuid } from './contracts.js'
import type { ContextProvider } from './dependencies.js'

export type ExportScope = 'interaction_data' | 'account_data'
type RightsContext = { requestId: string; accountId: string; kind: 'export' | 'delete_account'; scope: ExportScope; status: string; accountStatus: string; accountAccessVersion: number }
const unavailable = () => new ConversationError(503, 'DEPENDENCY_UNAVAILABLE', 'The account request could not be verified.')
const denied = () => new ConversationError(403, 'FORBIDDEN', 'This data request is not authorized.')
export function rightsToken(config: ConversationConfig, request: Request) {
  const expected = config.dataRightsServiceToken
  if (!expected) throw notFound()
  const token = /^Bearer ([0-9a-f]{64})$/i.exec(request.get('Authorization') ?? '')?.[1]
  if (!token || !timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'))) throw denied()
}
export function rightsQuery(query: Record<string, unknown>) {
  if (Object.keys(query).some(key => !['requestId', 'scope'].includes(key)) || typeof query.requestId !== 'string'
    || !uuid.test(query.requestId) || !['interaction_data', 'account_data'].includes(String(query.scope))) throw invalid()
  return { requestId: query.requestId.toLowerCase(), scope: query.scope as ExportScope }
}
export function eraseInput(request: Request, body: unknown) {
  if (Object.keys(request.query).length || !body || typeof body !== 'object' || Array.isArray(body)) throw invalid()
  const value = body as Record<string, unknown>, key = request.get('Idempotency-Key')
  if (Object.keys(value).length !== 1 || typeof value.requestId !== 'string' || !uuid.test(value.requestId)
    || !key || !uuid.test(key) || key.toLowerCase() !== value.requestId.toLowerCase()) throw invalid()
  return value.requestId.toLowerCase()
}
export async function rightsContext(config: ConversationConfig, accountId: string, requestId: string, kind: RightsContext['kind'], scope?: ExportScope) {
  let response: Response
  try {
    response = await fetch(new URL('/internal/v1/data-requests/' + requestId + '/context', config.identityOrigin), {
      redirect: 'error', signal: AbortSignal.timeout(5000), headers: { Authorization: 'Bearer ' + config.serviceToken },
    })
  } catch { throw unavailable() }
  if (response.status === 404) throw notFound()
  if (!response.ok) throw unavailable()
  const value = (await response.json().catch(() => null))?.data as RightsContext | undefined
  if (!value || !uuid.test(value.requestId) || !uuid.test(value.accountId) || !Number.isSafeInteger(value.accountAccessVersion)
    || value.accountAccessVersion < 1 || !['export', 'delete_account'].includes(value.kind)
    || !['account_data', 'interaction_data'].includes(value.scope) || !['accepted', 'processing', 'failed', 'completed'].includes(value.status)
    || !['active', 'restricted', 'deletion_pending', 'deleted'].includes(value.accountStatus)) throw unavailable()
  if (value.requestId !== requestId || value.accountId !== accountId || value.kind !== kind || scope && value.scope !== scope
    || kind === 'export' && value.accountStatus !== 'active'
    || kind === 'delete_account' && (value.scope !== 'account_data' || !['deletion_pending', 'deleted'].includes(value.accountStatus))) throw denied()
  return value
}

const LIMIT = 20 * 1024 * 1024
export async function exportConversations(pool: Pool, dependencies: ContextProvider, accountId: string, scope: ExportScope) {
  // A removed person is not readable through conversation routes either.
  const visible = (await dependencies.persons(accountId)).map(person => person.id).sort()
  const db = await pool.connect()
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    if ((await db.query('SELECT 1 FROM account_erasure_fences WHERE account_id=$1 AND erased_at IS NOT NULL', [accountId])).rowCount) throw notFound()
    const capturedAt = (await db.query<{ at: Date }>('SELECT transaction_timestamp() AS at')).rows[0].at.toISOString()
    const estimated = (await db.query<{ bytes: string }>(`SELECT COALESCE(sum(octet_length(to_jsonb(m)::text)+octet_length(COALESCE(j.world_context_ref::text,''))),0) AS bytes FROM messages m JOIN conversations c ON c.account_id=m.account_id AND c.id=m.conversation_id LEFT JOIN generation_jobs j ON m.author_kind='persona' AND j.account_id=m.account_id AND j.id=m.generation_job_id WHERE m.account_id=$1 AND c.person_id=ANY($2::uuid[]) AND m.removed_at IS NULL`, [accountId, visible])).rows[0].bytes
    if (Number(estimated) > LIMIT) throw new ConversationError(413, 'EXPORT_TOO_LARGE', 'The export exceeds the supported size.')
    const letterEstimate=(await db.query<{bytes:string}>(`SELECT COALESCE(sum(octet_length(to_jsonb(l)::text)+COALESCE(octet_length(to_jsonb(j)::text),0)+COALESCE(octet_length(to_jsonb(r)::text),0)),0)::text AS bytes FROM letters l LEFT JOIN letter_reply_jobs j ON j.account_id=l.account_id AND j.letter_id=l.id LEFT JOIN letter_replies r ON r.account_id=l.account_id AND r.letter_id=l.id WHERE l.account_id=$1 AND l.person_id=ANY($2::uuid[]) AND l.removed_at IS NULL`,[accountId,visible])).rows[0].bytes
    if(Number(estimated)+Number(letterEstimate)>LIMIT)throw new ConversationError(413,'EXPORT_TOO_LARGE','The export exceeds the supported size.')
    const gatherEstimate=(await db.query<{bytes:string}>(`SELECT COALESCE(sum(octet_length(to_jsonb(t)::text)),0)::text AS bytes FROM(SELECT to_jsonb(j) AS value FROM gather_reply_jobs j WHERE account_id=$1 UNION ALL SELECT to_jsonb(p) FROM gather_reply_participants p WHERE account_id=$1 UNION ALL SELECT to_jsonb(s) FROM gather_reply_slots s WHERE account_id=$1 UNION ALL SELECT to_jsonb(m) FROM messages m WHERE account_id=$1 AND conversation_kind='gather' AND removed_at IS NULL)t`,[accountId])).rows[0].bytes
    if(Number(estimated)+Number(letterEstimate)+Number(gatherEstimate)>LIMIT)throw new ConversationError(413,'EXPORT_TOO_LARGE','The export exceeds the supported size.')
    const photoEstimate=(await db.query<{bytes:string}>(`SELECT COALESCE(sum(octet_length(value::text)),0)::text AS bytes FROM(SELECT to_jsonb(p) AS value FROM photo_reply_jobs p WHERE account_id=$1 UNION ALL SELECT to_jsonb(m) FROM message_media m WHERE account_id=$1)t`,[accountId])).rows[0].bytes
    if(Number(estimated)+Number(letterEstimate)+Number(gatherEstimate)+Number(photoEstimate)>LIMIT)throw new ConversationError(413,'EXPORT_TOO_LARGE','The export exceeds the supported size.')
    const worldEstimate=(await db.query<{bytes:string}>(`SELECT COALESCE(sum(octet_length(value::text)),0)::text AS bytes FROM(
     SELECT to_jsonb(e) AS value FROM person_world_events e JOIN conversations c ON c.account_id=e.account_id AND c.id=e.conversation_id WHERE e.account_id=$1 AND c.person_id=ANY($2::uuid[]) AND e.removed_at IS NULL
     UNION ALL SELECT to_jsonb(j) FROM generation_jobs j JOIN conversations c ON c.account_id=j.account_id AND c.id=j.conversation_id WHERE j.account_id=$1 AND c.person_id=ANY($2::uuid[]) AND j.world_action_authorization_version IS NOT NULL
    )t`,[accountId,visible])).rows[0].bytes
    if(Number(estimated)+Number(letterEstimate)+Number(gatherEstimate)+Number(photoEstimate)+Number(worldEstimate)>LIMIT)throw new ConversationError(413,'EXPORT_TOO_LARGE','The export exceeds the supported size.')
    const conversations = (await db.query(`SELECT id,person_id AS "personId",world_id AS "worldId",kind,version,created_at AS "createdAt",updated_at AS "updatedAt" FROM conversations WHERE account_id=$1 AND(person_id=ANY($2::uuid[]) OR kind='gather') ORDER BY id`, [accountId, visible])).rows
    const messageRows = (await db.query(`SELECT m.id,m.kind,m.gift_delivery_id AS "giftDeliveryId",m.gift_received_id AS "receivedGiftId",m.gather_reply_job_id AS "gatherReplyJobId",m.photo_reply_job_id AS "photoReplyJobId",m.conversation_id AS "conversationId",m.sequence::text,m.author_kind AS "authorKind",m.text,m.client_message_id AS "clientMessageId",m.reply_to_message_id AS "replyToMessageId",m.speaker_person_id AS "speakerPersonId",m.display_name AS "displayName",m.version,m.created_at AS "createdAt",j.world_context_ref AS "virtualWorld" FROM messages m LEFT JOIN generation_jobs j ON m.author_kind='persona' AND j.account_id=m.account_id AND j.id=m.generation_job_id WHERE m.account_id=$1 AND m.conversation_id=ANY($2::uuid[]) AND m.removed_at IS NULL ORDER BY m.conversation_id,m.sequence,m.id`, [accountId, conversations.map(conversation => conversation.id)])).rows
    const messages=messageRows.map(({virtualWorld,...message})=>virtualWorld?{...message,virtualWorld}:message)
    const letters=(await db.query('SELECT * FROM letters WHERE account_id=$1 AND person_id=ANY($2::uuid[]) AND removed_at IS NULL ORDER BY id',[accountId,visible])).rows
    const letterIds=letters.map(row=>row.id)
    const letterReplies=(await db.query('SELECT *,sequence::text FROM letter_replies WHERE account_id=$1 AND letter_id=ANY($2::uuid[]) ORDER BY id',[accountId,letterIds])).rows
    const letterReplyJobs=(await db.query('SELECT * FROM letter_reply_jobs WHERE account_id=$1 AND letter_id=ANY($2::uuid[]) ORDER BY id',[accountId,letterIds])).rows
    const letterReadCursors=(await db.query('SELECT *,last_sequence::text,last_read_sequence::text FROM letter_read_cursors WHERE account_id=$1 AND person_id=ANY($2::uuid[]) ORDER BY person_id',[accountId,visible])).rows
    const gatherReplyJobs=(await db.query('SELECT * FROM gather_reply_jobs WHERE account_id=$1 ORDER BY id',[accountId])).rows
    const gatherReplyParticipants=(await db.query('SELECT * FROM gather_reply_participants WHERE account_id=$1 ORDER BY job_id,position',[accountId])).rows
    const gatherReplySlots=(await db.query('SELECT * FROM gather_reply_slots WHERE account_id=$1 ORDER BY job_id,person_id',[accountId])).rows
    const messageMedia=(await db.query('SELECT mm.* FROM message_media mm JOIN messages m ON m.account_id=mm.account_id AND m.id=mm.message_id WHERE mm.account_id=$1 AND m.conversation_id=ANY($2::uuid[]) AND m.removed_at IS NULL ORDER BY mm.message_id',[accountId,conversations.map(conversation=>conversation.id)])).rows
    const photoReplyJobs=(await db.query('SELECT * FROM photo_reply_jobs WHERE account_id=$1 AND conversation_id=ANY($2::uuid[]) ORDER BY id',[accountId,conversations.map(conversation=>conversation.id)])).rows
    const worldEvents=(await db.query('SELECT e.*,e.sequence::text FROM person_world_events e WHERE e.account_id=$1 AND e.conversation_id=ANY($2::uuid[]) AND e.removed_at IS NULL ORDER BY e.conversation_id,e.sequence',[accountId,conversations.map(conversation=>conversation.id)])).rows
    const worldActionJobs=(await db.query('SELECT * FROM generation_jobs WHERE account_id=$1 AND conversation_id=ANY($2::uuid[]) AND world_action_authorization_version IS NOT NULL ORDER BY id',[accountId,conversations.map(conversation=>conversation.id)])).rows
    const storyBytes=(await db.query<{bytes:string}>(`SELECT COALESCE(sum(octet_length(value::text)),0)::text AS bytes FROM(SELECT to_jsonb(t) AS value FROM story_branches t WHERE account_id=$1 UNION ALL SELECT to_jsonb(t) FROM story_messages t WHERE account_id=$1 AND removed_at IS NULL UNION ALL SELECT to_jsonb(t) FROM story_jobs t WHERE account_id=$1 UNION ALL SELECT to_jsonb(t) FROM story_events t WHERE account_id=$1 AND removed_at IS NULL UNION ALL SELECT to_jsonb(t) FROM offline_life_plans t WHERE account_id=$1 UNION ALL SELECT to_jsonb(t) FROM offline_life_runs t WHERE account_id=$1)x`,[accountId])).rows[0].bytes
    if(Number(estimated)+Number(letterEstimate)+Number(gatherEstimate)+Number(photoEstimate)+Number(worldEstimate)+Number(storyBytes)>LIMIT)throw new ConversationError(413,'EXPORT_TOO_LARGE','The export exceeds the supported size.')
    const storyBranches=(await db.query('SELECT * FROM story_branches WHERE account_id=$1 AND person_id=ANY($2::uuid[]) ORDER BY id',[accountId,visible])).rows
    const branchIds=storyBranches.map(b=>b.id)
    const storyMessages=(await db.query('SELECT * FROM story_messages WHERE account_id=$1 AND branch_id=ANY($2::uuid[]) AND removed_at IS NULL ORDER BY branch_id,sequence',[accountId,branchIds])).rows
    const storyJobs=(await db.query('SELECT * FROM story_jobs WHERE account_id=$1 AND branch_id=ANY($2::uuid[]) ORDER BY id',[accountId,branchIds])).rows
    const storyEvents=(await db.query('SELECT * FROM story_events WHERE account_id=$1 AND branch_id=ANY($2::uuid[]) AND removed_at IS NULL ORDER BY id',[accountId,branchIds])).rows
    const offlineLifePlans=(await db.query('SELECT * FROM offline_life_plans WHERE account_id=$1 AND person_id=ANY($2::uuid[]) ORDER BY person_id',[accountId,visible])).rows
    const offlineLifeRuns=(await db.query('SELECT * FROM offline_life_runs WHERE account_id=$1 AND person_id=ANY($2::uuid[]) ORDER BY id',[accountId,visible])).rows
    const calls=await db.query('SELECT id,conversation_id,person_id,mode,state,model,voice,person_version,storage_version,voice_version,production_version,created_at,started_at,ended_at,failure_code,stop_reason FROM call_sessions WHERE account_id=$1 AND person_id=ANY($2::uuid[]) ORDER BY id',[accountId,visible])
    const callSessions=calls.rows
    const speechAvailable = (await db.query("SELECT to_regclass('chat_reply_speech') IS NOT NULL AS present")).rows[0].present
    const replySpeech = speechAvailable ? (await db.query(`SELECT s.id,s.conversation_id AS "conversationId",s.message_id AS "messageId",
      s.source_version AS "sourceVersion",s.created_at AS "createdAt",s.model,'audio/wav' AS "contentType",encode(s.wav,'base64') AS audio
      FROM chat_reply_speech s JOIN messages m ON m.account_id=s.account_id AND m.conversation_id=s.conversation_id AND m.id=s.message_id
      WHERE s.account_id=$1 AND s.message_id=ANY($2::uuid[]) AND s.source_version=m.version AND s.state='ready' ORDER BY s.id`,
      [accountId,messages.map(message => message.id)])).rows : undefined
    const data = { callSessions, ...(replySpeech === undefined ? {} : { replySpeech }), storyBranches,storyMessages,storyJobs,storyEvents,offlineLifePlans,offlineLifeRuns,conversations, messages, messageMedia, photoReplyJobs, worldEvents, worldActionJobs, letters, letterReplies, letterReplyJobs, letterReadCursors,gatherReplyJobs,gatherReplyParticipants,gatherReplySlots }, serialized = JSON.stringify(data)
    if (Buffer.byteLength(serialized) > LIMIT) throw new ConversationError(413, 'EXPORT_TOO_LARGE', 'The export exceeds the supported size.')
    await db.query('COMMIT')
    const stillVisible = (await dependencies.persons(accountId)).map(person => person.id).sort()
    if (JSON.stringify(stillVisible) !== JSON.stringify(visible)) throw new ConversationError(409, 'EXPORT_STALE', 'Person access changed while exporting.')
    return { schemaVersion: 1, domain: 'conversations' as const, accountId, capturedAt, revision: createHash('sha256').update(serialized).digest('hex'), data }
  } catch (error) { await db.query('ROLLBACK'); throw error } finally { db.release() }
}

export async function eraseConversations(pool: Pool, queueSchema: string, accountId: string, requestId: string) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(queueSchema)) throw unavailable()
  const db = await pool.connect()
  try {
    await db.query('BEGIN')
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('xijie:conversations:erasure:' || $1,0))", [accountId])
    await db.query('INSERT INTO account_erasure_fences(account_id) VALUES($1) ON CONFLICT DO NOTHING', [accountId])
    const gate = (await db.query<{ request_id: string | null; erased_at: Date | null }>('SELECT request_id,erased_at FROM account_erasure_fences WHERE account_id=$1 FOR UPDATE', [accountId])).rows[0]
    if (gate.erased_at) {
      if (gate.request_id !== requestId) throw new ConversationError(409, 'IDEMPOTENCY_CONFLICT', 'This account was erased by a different request.')
      await db.query('COMMIT'); return { accountId, requestId, erasedAt: gate.erased_at.toISOString(), alreadyErased: true }
    }
    const erasedAt = (await db.query<{ erased_at: Date }>('UPDATE account_erasure_fences SET request_id=$2,erased_at=clock_timestamp() WHERE account_id=$1 RETURNING erased_at', [accountId, requestId])).rows[0].erased_at.toISOString()
    const queue = (await db.query<{ exists: string | null }>('SELECT to_regclass($1)::text AS exists', [queueSchema + '.job'])).rows[0].exists
    if (queue) await db.query(`DELETE FROM "${queueSchema}".job WHERE name='conversation.reply.v1' AND data->>'jobId' IN(SELECT id::text FROM generation_jobs WHERE account_id=$1)`, [accountId])
    if(queue)await db.query(`DELETE FROM "${queueSchema}".job WHERE name='letter.reply.v1' AND data->>'jobId' IN(SELECT id::text FROM letter_reply_jobs WHERE account_id=$1)`,[accountId])
    if(queue)await db.query(`DELETE FROM "${queueSchema}".job WHERE name='gather.reply.v1' AND data->>'jobId' IN(SELECT id::text FROM gather_reply_jobs WHERE account_id=$1)`,[accountId])
    if(queue)await db.query(`DELETE FROM "${queueSchema}".job WHERE name='photo.reply.v1' AND data->>'jobId' IN(SELECT id::text FROM photo_reply_jobs WHERE account_id=$1)`,[accountId])
    if(queue)await db.query(`DELETE FROM "${queueSchema}".job WHERE (name='story.reply.v1' AND data->>'jobId' IN(SELECT id::text FROM story_jobs WHERE account_id=$1)) OR(name='world.life.v1' AND data->>'jobId' IN(SELECT id::text FROM offline_life_runs WHERE account_id=$1))`,[accountId])
    await db.query('SET CONSTRAINTS ALL DEFERRED')
    for (const table of ['call_grants','call_sessions','story_events','story_messages','story_jobs','story_branches','person_world_events','offline_life_runs','offline_life_plans','message_media','photo_reply_jobs','conversation_commands', 'outbox_events', 'letter_read_cursors','letter_replies','letter_reply_jobs','letters','gather_reply_slots','gather_reply_participants','gather_reply_jobs','generation_jobs', 'messages', 'conversations']) await db.query('DELETE FROM ' + table + ' WHERE account_id=$1', [accountId])
    await db.query('COMMIT'); return { accountId, requestId, erasedAt, alreadyErased: false }
  } catch (error) { await db.query('ROLLBACK'); throw error } finally { db.release() }
}
