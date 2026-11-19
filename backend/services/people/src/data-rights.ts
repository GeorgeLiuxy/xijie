import { createHash, timingSafeEqual } from 'node:crypto'
import type { Pool } from 'pg'
import type { Request } from 'express'
import type { PeopleConfig } from './config.js'
import { invalid, notFound, PeopleError, uuid } from './contracts.js'

export type ExportScope = 'interaction_data' | 'account_data'
type RightsContext = { requestId: string; accountId: string; kind: 'export' | 'delete_account'; scope: ExportScope; status: string; accountStatus: string; accountAccessVersion: number }
const unavailable = () => new PeopleError(503, 'DEPENDENCY_UNAVAILABLE', 'The account request could not be verified.')
const denied = () => new PeopleError(403, 'FORBIDDEN', 'This data request is not authorized.')
export function rightsToken(config: PeopleConfig, request: Request) {
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
export async function rightsContext(config: PeopleConfig, accountId: string, requestId: string, kind: RightsContext['kind'], scope?: ExportScope) {
  let response: Response
  try {
    response = await fetch(new URL('/internal/v1/data-requests/' + requestId + '/context', config.identityContextUrl), {
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
export async function exportPeople(pool: Pool, accountId: string, scope: ExportScope) {
  const db = await pool.connect()
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    if ((await db.query('SELECT 1 FROM account_erasure_fences WHERE account_id=$1 AND erased_at IS NOT NULL', [accountId])).rowCount) throw notFound()
    const capturedAt = (await db.query<{ at: Date }>('SELECT transaction_timestamp() AS at')).rows[0].at.toISOString()
    const estimated = (await db.query<{ bytes: string }>(`SELECT COALESCE((SELECT sum(octet_length(to_jsonb(p)::text)) FROM persons p WHERE account_id=$1 AND status='active'),0)+COALESCE((SELECT sum(octet_length(to_jsonb(d)::text)) FROM person_drafts d WHERE account_id=$1 AND (confirmed_at IS NOT NULL OR expires_at>transaction_timestamp()) AND NOT EXISTS(SELECT 1 FROM persons p WHERE p.account_id=d.account_id AND p.source_draft_id=d.id AND p.status='removed')),0)+COALESCE((SELECT sum(octet_length(to_jsonb(m)::text)) FROM person_world_movements m WHERE account_id=$1 AND EXISTS(SELECT 1 FROM persons p WHERE p.account_id=m.account_id AND p.id=m.person_id AND p.status='active')),0)+COALESCE((SELECT sum(octet_length(to_jsonb(m)::text)) FROM person_draft_media m JOIN person_drafts d ON d.account_id=m.account_id AND d.id=m.draft_id WHERE m.account_id=$1 AND ((d.confirmed_at IS NULL AND d.expires_at>transaction_timestamp()) OR EXISTS(SELECT 1 FROM persons p WHERE p.account_id=d.account_id AND p.source_draft_id=d.id AND p.status='active'))),0) AS bytes`, [accountId])).rows[0].bytes
    if (Number(estimated) > LIMIT) throw new PeopleError(413, 'EXPORT_TOO_LARGE', 'The export exceeds the supported size.')
    const persons = (await db.query(`SELECT id,source_draft_id AS "sourceDraftId",display_name AS "displayName",relationship,story,personality,life,unknowns,catchphrase,conversation_tone AS "conversationTone",voice_timbre AS "voiceTimbre",real_name AS "realName",called_me AS "calledMe",birth_month_day AS "birthMonthDay",years_text AS "yearsText",place,world_id AS "worldId",world_version AS "worldVersion",version,created_at AS "createdAt",updated_at AS "updatedAt" FROM persons WHERE account_id=$1 AND status='active' ORDER BY id`, [accountId])).rows
    const drafts = (await db.query(`SELECT id,display_name AS "displayName",relationship,story,conversation_tone AS "conversationTone",voice_timbre AS "voiceTimbre",real_name AS "realName",called_me AS "calledMe",birth_month_day AS "birthMonthDay",years_text AS "yearsText",place,version,created_at AS "createdAt",updated_at AS "updatedAt",confirmed_at AS "confirmedAt",expires_at AS "expiresAt" FROM person_drafts d WHERE account_id=$1 AND (confirmed_at IS NOT NULL OR expires_at>transaction_timestamp()) AND NOT EXISTS(SELECT 1 FROM persons p WHERE p.account_id=d.account_id AND p.source_draft_id=d.id AND p.status='removed') ORDER BY id`, [accountId])).rows
    const worlds = (await db.query(`SELECT id,code,display_name AS "displayName",enabled,catalog_version AS "catalogVersion" FROM worlds WHERE id=ANY($1::uuid[]) ORDER BY id`, [persons.map(person => person.worldId)])).rows
    const worldMovements=(await db.query(`SELECT id,person_id AS "personId",world_version AS "worldVersion",person_version AS "personVersion",reality,branch,from_world AS "fromWorld",to_world AS "toWorld",occurred_at AS "occurredAt",recorded_at AS "recordedAt" FROM person_world_movements WHERE account_id=$1 AND person_id=ANY($2::uuid[]) ORDER BY person_id,world_version`,[accountId,persons.map(person=>person.id)])).rows
    const photoRefs=(await db.query(`SELECT m.draft_id AS "draftId",p.id AS "personId",m.media_id AS "mediaId",m.position,m.media_version AS "version",m.mime_type AS "mimeType",m.byte_size AS "byteSize",m.width,m.height,m.created_at AS "createdAt" FROM person_draft_media m JOIN person_drafts d ON d.account_id=m.account_id AND d.id=m.draft_id LEFT JOIN persons p ON p.account_id=d.account_id AND p.source_draft_id=d.id WHERE m.account_id=$1 AND ((d.confirmed_at IS NULL AND d.expires_at>transaction_timestamp()) OR p.status='active') ORDER BY m.draft_id,m.position`,[accountId])).rows
    const reminderSettings=(await db.query('SELECT person_id AS "personId",enabled,time_zone AS "timeZone",version,next_check_at AS "nextCheckAt",updated_at AS "updatedAt" FROM person_reminder_settings WHERE account_id=$1 AND person_id=ANY($2::uuid[]) ORDER BY person_id',[accountId,persons.map(person=>person.id)])).rows
    const reminderNotifications=(await db.query('SELECT id,person_id AS "personId",kind,local_date::text AS "localDate",created_at AS "createdAt",read_at AS "readAt",version FROM person_reminder_notifications WHERE account_id=$1 AND person_id=ANY($2::uuid[]) ORDER BY created_at,id',[accountId,persons.map(person=>person.id)])).rows
    const voiceRefs=(await db.query(`SELECT v.draft_id AS "draftId",p.id AS "personId",v.voice_id AS "voiceId",v.media_version AS version,v.binding_version AS "bindingVersion",v.duration_ms AS "durationMs",v.mime_type AS "mimeType",v.byte_size AS "byteSize",v.sha256 FROM person_draft_voice v JOIN person_drafts d ON d.account_id=v.account_id AND d.id=v.draft_id LEFT JOIN persons p ON p.account_id=d.account_id AND p.source_draft_id=d.id WHERE v.account_id=$1 AND ((d.confirmed_at IS NULL AND d.expires_at>transaction_timestamp()) OR p.status='active') ORDER BY v.draft_id`,[accountId])).rows
    const data = { persons, drafts, worlds, worldMovements,photoRefs,reminderSettings,reminderNotifications,voiceRefs }, serialized = JSON.stringify(data)
    if (Buffer.byteLength(serialized) > LIMIT) throw new PeopleError(413, 'EXPORT_TOO_LARGE', 'The export exceeds the supported size.')
    await db.query('COMMIT')
    return { schemaVersion: 1, domain: 'people' as const, accountId, capturedAt, revision: createHash('sha256').update(serialized).digest('hex'), data }
  } catch (error) { await db.query('ROLLBACK'); throw error } finally { db.release() }
}

export async function erasePeople(pool: Pool, accountId: string, requestId: string) {
  const db = await pool.connect()
  try {
    await db.query('BEGIN')
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('xijie:people:erasure:' || $1,0))", [accountId])
    await db.query('INSERT INTO account_erasure_fences(account_id) VALUES($1) ON CONFLICT DO NOTHING', [accountId])
    const gate = (await db.query<{ request_id: string | null; erased_at: Date | null }>('SELECT request_id,erased_at FROM account_erasure_fences WHERE account_id=$1 FOR UPDATE', [accountId])).rows[0]
    if (gate.erased_at) {
      if (gate.request_id !== requestId) throw new PeopleError(409, 'IDEMPOTENCY_CONFLICT', 'This account was erased by a different request.')
      await db.query('COMMIT'); return { accountId, requestId, erasedAt: gate.erased_at.toISOString(), alreadyErased: true }
    }
    const erasedAt = (await db.query<{ erased_at: Date }>('UPDATE account_erasure_fences SET request_id=$2,erased_at=clock_timestamp() WHERE account_id=$1 RETURNING erased_at', [accountId, requestId])).rows[0].erased_at.toISOString()
    for (const table of ['person_draft_voice','person_draft_voice_epochs','person_reminder_commands','person_reminder_notifications','person_reminder_settings','person_draft_commands', 'outbox_events', 'person_draft_media', 'person_world_movements', 'persons', 'person_previews', 'person_drafts']) await db.query('DELETE FROM ' + table + ' WHERE account_id=$1', [accountId])
    await db.query('COMMIT'); return { accountId, requestId, erasedAt, alreadyErased: false }
  } catch (error) { await db.query('ROLLBACK'); throw error } finally { db.release() }
}
