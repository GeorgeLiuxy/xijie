import {voiceColumns,replaceVoice} from './voices.js'
import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { PeopleError, notFound, type DraftFields, type DraftPosition, type DraftStatus, type PersonDraft, type Person, type PersonFields, type PersonPreview, type PreviewResult, type PhotoMetadata, type PhotoBinding, type PhotoRef, type ReadyVoice, type VoiceBinding, type VoiceRef, type World, type WorldMovement, type WorldContext, type WorldStageRequest, type ResolvedWorldStages, type GatherContext, type SocialPerson, type SocialAiPerson, type SocialMovementPage, type previewInput, type confirmInput } from './contracts.js'
import { profileClues } from './profile-clues.js'

type PreviewInput = ReturnType<typeof previewInput>
type ConfirmInput = ReturnType<typeof confirmInput>

type Row = {
  id: string
  display_name: string | null
  relationship: string | null
  story: string | null
  real_name: string | null
  called_me: string | null
  birth_month_day: string | null
  years_text: string | null
  place: string | null
  conversation_tone:string|null
  voice_timbre:string|null
  voice:ReadyVoice|null
  status: DraftStatus
  confirmed_person_id?: string | null
  version: number
  updated_at: Date
  expires_at: Date
  photos: PhotoMetadata[]
}

const photoColumns=(table:string,draftId:string)=>`COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.media_id,'version',m.media_version,'mimeType',m.mime_type,'byteSize',m.byte_size,'width',m.width,'height',m.height) ORDER BY m.position) FROM person_draft_media m WHERE m.account_id=${table}.account_id AND m.draft_id=${table}.${draftId}),'[]'::jsonb) AS photos`
const fields = 'id, display_name, relationship, story, real_name, called_me, birth_month_day, years_text, place, conversation_tone,voice_timbre,version, updated_at, expires_at, ' + photoColumns('person_drafts','id')+', '+voiceColumns('person_drafts','id')
const draftStatusSql = "CASE WHEN confirmed_at IS NOT NULL THEN 'confirmed' WHEN expires_at <= clock_timestamp() THEN 'expired' ELSE 'draft' END"
const row = fields + ', ' + draftStatusSql + ' AS status, '
  + '(SELECT persons.id FROM persons WHERE persons.account_id = person_drafts.account_id AND persons.source_draft_id = person_drafts.id) AS confirmed_person_id'
const visibleDraft = "NOT EXISTS (SELECT 1 FROM persons removed_person WHERE removed_person.account_id = person_drafts.account_id AND removed_person.source_draft_id = person_drafts.id AND removed_person.status = 'removed')"

function draft(result: Row): PersonDraft {
  return {
    id: result.id,
    voiceId:result.status==='expired'?null:result.voice?.id??null,readyVoice:result.status==='expired'?null:result.voice??null,hasVoice:result.status!=='expired'&&!!result.voice,voiceTarget:{kind:'person_draft',id:result.id},conversationTone:result.conversation_tone??null,voiceTimbre:result.voice_timbre??null,
    status: result.status,
    version: result.version,
    ...(result.display_name === null ? {} : { displayName: result.display_name }),
    ...(result.relationship === null ? {} : { relationship: result.relationship }),
    ...(result.story === null ? {} : { story: result.story }),
    ...(result.real_name == null ? {} : { realName: result.real_name }),
    ...(result.called_me == null ? {} : { calledMe: result.called_me }),
    ...(result.birth_month_day == null ? {} : { birthMonthDay: result.birth_month_day }),
    ...(result.years_text == null ? {} : { yearsText: result.years_text }),
    ...(result.place == null ? {} : { place: result.place }),
    mediaIds: result.status==='expired'?[]:(result.photos??[]).map(m=>m.id),
    media: result.status==='expired'?[]:result.photos??[],
    photoTarget:{kind:'person_draft',id:result.id},
    ...(result.confirmed_person_id ? { confirmedPersonId: result.confirmed_person_id } : {}),
    updatedAt: result.updated_at.toISOString(),
    expiresAt: result.expires_at.toISOString(),
  }
}

function conflict(version: number) {
  return new PeopleError(412, 'VERSION_CONFLICT', 'The record has been updated.', { currentVersion: version })
}


type PreviewRow = {
  id: string
  draft_id: string
  draft_version: number
  suggested_world_id: string
  expires_at: Date
  story?: string | null
  current?: boolean
}

type PersonRow = {
  id: string
  display_name: string
  relationship: string
  story: string
  personality:string[]
  life:string[]
  unknowns:string[]
  catchphrase:string|null
  world_id: string
  world_version: number
  version: number
  created_at: Date
  updated_at: Date
  real_name: string | null
  called_me: string | null
  birth_month_day: string | null
  years_text: string | null
  place: string | null
  conversation_tone:string|null
  voice_timbre:string|null
  voice:ReadyVoice|null
  source_draft_id: string
  access_version: number
  status: 'active' | 'removed'
  photos: PhotoMetadata[]
}

type WorldRow = { id: string; code: string; display_name: string; enabled: boolean; catalog_version: number }
const personColumns = 'id, display_name, relationship, story, personality,life,unknowns,catchphrase, world_id, world_version, version, created_at, updated_at, real_name, called_me, birth_month_day, years_text, place, source_draft_id, access_version, status, conversation_tone,voice_timbre,' + photoColumns('persons','source_draft_id')+', '+voiceColumns('persons','source_draft_id')
const previewColumns = 'id, draft_id, draft_version, suggested_world_id, expires_at'

function person(result: PersonRow): Person {
  return {
    id: result.id, displayName: result.display_name, relationship: result.relationship, story: result.story,
    voiceId:result.voice?.id??null,readyVoice:result.voice??null,hasVoice:!!result.voice,voiceTarget:{kind:'person_draft',id:result.source_draft_id},conversationTone:result.conversation_tone??null,voiceTimbre:result.voice_timbre??null,
    personality:result.personality,life:result.life,unknowns:result.unknowns,catchphrase:result.catchphrase,
    worldId: result.world_id, worldVersion: result.world_version, status: 'active', version: result.version,
    mediaIds:(result.photos??[]).map(m=>m.id),media:result.photos??[],photoTarget:{kind:'person_draft',id:result.source_draft_id},
    mediaLinks:(result.photos??[]).map((m,i)=>({id:m.id,personId:result.id,mediaId:m.id,purpose:i===0?'profile_photo':'person_source',createdAt:result.updated_at.toISOString()})),
    ...((result.photos??[])[0]?{avatarMediaLinkId:result.photos[0].id}:{}),
    createdAt: result.created_at.toISOString(), updatedAt: result.updated_at.toISOString(),
    ...(result.real_name === null ? {} : { realName: result.real_name }),
    ...(result.called_me === null ? {} : { calledMe: result.called_me }),
    ...(result.birth_month_day === null ? {} : { birthMonthDay: result.birth_month_day }),
    ...(result.years_text === null ? {} : { yearsText: result.years_text }),
    ...(result.place === null ? {} : { place: result.place }),
  }
}

type MovementRow={id:string;world_version:number;person_version:number;from_world:World;to_world:World;occurred_at:Date;recorded_at:Date}
const movement=(row:MovementRow):WorldMovement=>({id:row.id,worldVersion:row.world_version,personVersion:row.person_version,fromWorld:row.from_world,toWorld:row.to_world,occurredAt:row.occurred_at.toISOString(),recordedAt:row.recorded_at.toISOString()})
const worldDto=(row:WorldRow):World=>({id:row.id,code:row.code,displayName:row.display_name,enabled:row.enabled,catalogVersion:row.catalog_version})
function canonical(value:unknown):string{
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']'
  if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}'
  const encoded=JSON.stringify(value);if(encoded===undefined)throw new Error('Unsupported world snapshot value');return encoded
}

function previewResult(result: PreviewRow, status: PersonPreview['status']): PreviewResult {
  return { id: result.id, draftId: result.draft_id, draftVersion: result.draft_version, status, renderMode: 'user_input' }
}

const draftUnavailable = () => new PeopleError(409, 'CONFLICT', 'The draft is no longer editable.')
const previewUnavailable = () => new PeopleError(409, 'CONFLICT', 'The preview is no longer current.')

export class PeopleStore {
  constructor(readonly pool: Pool) {}

  async giftPerson(accountId:string,id:string){
    const found=(await this.pool.query(`SELECT id,account_id AS "accountId",display_name AS "displayName",world_id AS "worldId",version,world_version AS "worldVersion",access_version AS "accessVersion",status FROM persons WHERE account_id=$1 AND id=$2 AND status='active' AND NOT EXISTS(SELECT 1 FROM account_erasure_fences g WHERE g.account_id=$1 AND g.erased_at IS NOT NULL)`,[accountId,id])).rows[0]
    if(!found)throw notFound()
    return {...found,audience:'person' as const}
  }

  async photoWriteSource(accountId:string,id:string,kind:'draft'|'person',key:string,version:number,input:DraftFields|PersonFields){
    const current=kind==='draft'?await this.get(accountId,id):await this.getPerson(accountId,id)
    if(await this.isCommandReplay(accountId,kind==='draft'?'update':'person_update',id,key,{version,input}))return undefined
    if(current.version!==version)throw conflict(current.version)
    return current.photoTarget.id
  }

  async isCommandReplay(accountId:string,operation:'update'|'person_update'|'confirm',target:string,key:string,input:object){
    const previous=(await this.pool.query<{request_hash:string}>('SELECT request_hash FROM person_draft_commands WHERE account_id=$1 AND operation=$2 AND target=$3 AND idempotency_key=$4',[accountId,operation,target,key])).rows[0]
    if(!previous)return false
    if(previous.request_hash!==createHash('sha256').update(JSON.stringify(input)).digest('hex'))throw new PeopleError(409,'IDEMPOTENCY_CONFLICT','The key was already used for a different request.')
    return true
  }

  private async replacePhotos(db:PoolClient,accountId:string,draftId:string,ids:string[],binding?:PhotoBinding){
    const photos=binding?.media
    if(!photos||photos.length!==ids.length||photos.some((p,i)=>p.id!==ids[i]))throw new PeopleError(503,'MEDIA_UNAVAILABLE','The selected photos could not be verified.')
    if(photos.length&&(!binding?.expiresAt||!(await db.query<{valid:boolean}>('SELECT clock_timestamp()<$1::timestamptz AS valid',[binding.expiresAt])).rows[0].valid))throw new PeopleError(409,'MEDIA_BINDING_EXPIRED','The photo selection needs to be verified again.')
    await db.query('DELETE FROM person_draft_media WHERE account_id=$1 AND draft_id=$2',[accountId,draftId])
    for(const [i,p] of photos.entries())await db.query('INSERT INTO person_draft_media(account_id,draft_id,media_id,position,media_version,mime_type,byte_size,width,height) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[accountId,draftId,p.id,i+1,p.version,p.mimeType,p.byteSize,p.width,p.height])
  }

  async photoTarget(accountId:string,draftId:string){
    const found=await this.pool.query(`SELECT d.id FROM person_drafts d WHERE d.account_id=$1 AND d.id=$2
      AND NOT EXISTS(SELECT 1 FROM account_erasure_fences g WHERE g.account_id=d.account_id AND g.erased_at IS NOT NULL)
      AND ((d.confirmed_at IS NULL AND d.expires_at>clock_timestamp()) OR EXISTS(SELECT 1 FROM persons p WHERE p.account_id=d.account_id AND p.source_draft_id=d.id AND p.status='active'))`,[accountId,draftId])
    if(!found.rows[0])throw notFound()
    return {id:draftId}
  }

  async validPhotos(accountId:string,refs:PhotoRef[]):Promise<PhotoRef[]>{
    if(!refs.length)return []
    const found=await this.pool.query<{draft_id:string;media_id:string;media_version:number}>(`SELECT m.draft_id,m.media_id,m.media_version FROM person_draft_media m JOIN person_drafts d ON d.account_id=m.account_id AND d.id=m.draft_id
      JOIN jsonb_to_recordset($2::jsonb) AS r("draftId" uuid,"mediaId" uuid,version integer) ON r."draftId"=m.draft_id AND r."mediaId"=m.media_id AND r.version=m.media_version
      WHERE m.account_id=$1 AND NOT EXISTS(SELECT 1 FROM account_erasure_fences g WHERE g.account_id=d.account_id AND g.erased_at IS NOT NULL)
      AND ((d.confirmed_at IS NULL AND d.expires_at>clock_timestamp()) OR EXISTS(SELECT 1 FROM persons p WHERE p.account_id=d.account_id AND p.source_draft_id=d.id AND p.status='active'))`,[accountId,JSON.stringify(refs)])
    return refs.filter(r=>found.rows.some(m=>m.draft_id===r.draftId&&m.media_id===r.mediaId&&m.media_version===r.version))
  }

  async validVoices(accountId:string,refs:VoiceRef[]):Promise<VoiceRef[]>{
    if(!refs.length)return []
    const found=(await this.pool.query<{draft_id:string;voice_id:string;media_version:number;binding_version:number}>(`SELECT v.draft_id,v.voice_id,v.media_version,v.binding_version FROM person_draft_voice v JOIN person_drafts d ON d.account_id=v.account_id AND d.id=v.draft_id
      JOIN jsonb_to_recordset($2::jsonb) r("draftId" uuid,"voiceId" uuid,version integer,"bindingVersion" integer) ON r."draftId"=v.draft_id AND r."voiceId"=v.voice_id AND r.version=v.media_version AND (r."bindingVersion" IS NULL OR r."bindingVersion"=v.binding_version)
      WHERE v.account_id=$1 AND NOT EXISTS(SELECT 1 FROM account_erasure_fences g WHERE g.account_id=d.account_id AND g.erased_at IS NOT NULL)
      AND ((d.confirmed_at IS NULL AND d.expires_at>clock_timestamp()) OR EXISTS(SELECT 1 FROM persons p WHERE p.account_id=d.account_id AND p.source_draft_id=d.id AND p.status='active'))`,[accountId,JSON.stringify(refs)])).rows
    return refs.flatMap(r=>{const v=found.find(v=>v.draft_id===r.draftId&&v.voice_id===r.voiceId&&v.media_version===r.version);return v?[{...r,bindingVersion:v.binding_version}]:[]})
  }

  async voiceBindingState(accountId:string,draftId:string){
    const db=await this.pool.connect()
    try{
      await db.query('BEGIN')
      if(!(await db.query('SELECT id FROM person_drafts WHERE account_id=$1 AND id=$2 FOR SHARE',[accountId,draftId])).rowCount)throw notFound()
      const result=(await db.query<{binding_version:number;voice_id:string|null;media_version:number|null}>(`SELECT COALESCE(e.version,0) AS binding_version,v.voice_id,v.media_version FROM person_drafts d LEFT JOIN person_draft_voice_epochs e ON e.account_id=d.account_id AND e.draft_id=d.id LEFT JOIN person_draft_voice v ON v.account_id=d.account_id AND v.draft_id=d.id WHERE d.account_id=$1 AND d.id=$2 AND NOT EXISTS(SELECT 1 FROM account_erasure_fences g WHERE g.account_id=d.account_id AND g.erased_at IS NOT NULL) AND ((d.confirmed_at IS NULL AND d.expires_at>clock_timestamp()) OR EXISTS(SELECT 1 FROM persons p WHERE p.account_id=d.account_id AND p.source_draft_id=d.id AND p.status='active'))`,[accountId,draftId])).rows[0]
      if(!result)throw notFound()
      await db.query('COMMIT')
      return {draftId,accountId,bindingVersion:result.binding_version,voiceId:result.voice_id,version:result.media_version}
    }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
  }

  async list(accountId: string, status: DraftStatus | undefined, after: DraftPosition | undefined, limit: number) {
    const result = await this.pool.query<Row>(
      "SELECT " + row + " FROM person_drafts WHERE account_id = $1 "
      + 'AND ' + visibleDraft + ' '
      + 'AND ($2::text IS NULL OR ' + draftStatusSql + ' = $2) '
      + 'AND ($3::timestamptz IS NULL OR (updated_at, id) < ($3::timestamptz, $4::uuid)) '
      + 'ORDER BY updated_at DESC, id DESC LIMIT $5',
      [accountId, status ?? null, after?.updatedAt ?? null, after?.id ?? null, limit],
    )
    return result.rows.map(draft)
  }

  async get(accountId: string, id: string) {
    const result = await this.pool.query<Row>('SELECT ' + row + ' FROM person_drafts WHERE account_id = $1 AND id = $2 AND ' + visibleDraft, [accountId, id])
    if (!result.rows[0]) throw notFound()
    return draft(result.rows[0])
  }

  async create(accountId: string, authorizationVersion: number, key: string, input: DraftFields) {
    return this.write(accountId, 'create', '', key, input, async (db) => {
      const result = await db.query<Row>(
        'WITH stamp AS (SELECT clock_timestamp()::timestamptz(3) AS now) '
        + 'INSERT INTO person_drafts (account_id, display_name, relationship, story, real_name, called_me, birth_month_day, years_text, place, authorization_version,conversation_tone,voice_timbre, created_at, updated_at, expires_at) '
        + "SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,$11,$12, now, now, now + interval '30 days' FROM stamp RETURNING "
        + fields + ", 'draft' AS status",
        [accountId, input.displayName ?? null, input.relationship ?? null, input.story ?? null,
          input.realName ?? null, input.calledMe ?? null, input.birthMonthDay ?? null, input.yearsText ?? null, input.place ?? null, authorizationVersion,input.conversationTone??null,input.voiceTimbre??null],
      )
      return draft(result.rows[0])
    })
  }

  async update(accountId: string, id: string, authorizationVersion: number, key: string, version: number, input: DraftFields, binding?:PhotoBinding,voiceBinding?:VoiceBinding) {
    return this.write(accountId, 'update', id, key, { version, input }, async (db) => {
      const current = await this.lockDraft(db, accountId, id)
      if (version !== current.version) throw conflict(current.version)
      if (current.status !== 'draft') throw draftUnavailable()
      if(input.mediaIds!==undefined)await this.replacePhotos(db,accountId,id,input.mediaIds,binding)
      if(input.voiceId!==undefined)await replaceVoice(db,accountId,id,input.voiceId,voiceBinding)
      const result = await db.query<Row>(
        'WITH stamp AS (SELECT clock_timestamp()::timestamptz(3) AS now) '
        + 'UPDATE person_drafts SET display_name = $3, relationship = $4, story = $5, authorization_version = CASE WHEN $6::integer>0 THEN $6 ELSE authorization_version END, '
        + 'real_name=$7, called_me=$8, birth_month_day=$9, years_text=$10, place=$11,conversation_tone=$12,voice_timbre=$13, '
        + "version = version + 1, updated_at = GREATEST(now, updated_at), expires_at = GREATEST(now, updated_at) + interval '30 days' "
        + 'FROM stamp WHERE account_id = $1 AND id = $2 AND expires_at > now RETURNING '
        + fields + ", 'draft' AS status",
        [
          accountId, id,
          input.displayName === undefined ? current.display_name : input.displayName,
          input.relationship === undefined ? current.relationship : input.relationship,
          input.story === undefined ? current.story : input.story,
          authorizationVersion,
          input.realName === undefined ? current.real_name : input.realName,
          input.calledMe === undefined ? current.called_me : input.calledMe,
          input.birthMonthDay === undefined ? current.birth_month_day : input.birthMonthDay,
          input.yearsText === undefined ? current.years_text : input.yearsText,
          input.place === undefined ? current.place : input.place,
          input.conversationTone===undefined?current.conversation_tone:input.conversationTone,input.voiceTimbre===undefined?current.voice_timbre:input.voiceTimbre,
        ],
      )
      if (!result.rows[0]) throw draftUnavailable()
      await this.invalidatePreviews(db, accountId, id)
      return draft(result.rows[0])
    })
  }


  private async lockDraft(db: PoolClient, accountId: string, id: string): Promise<Row> {
    const result = await db.query<Row>(
      'SELECT ' + row + ' FROM person_drafts WHERE account_id = $1 AND id = $2 FOR UPDATE',
      [accountId, id],
    )
    if (!result.rows[0]) throw notFound()
    await this.assertSourceVisible(db, accountId, id)
    return result.rows[0]
  }

  private async invalidatePreviews(db: PoolClient, accountId: string, draftId: string) {
    await db.query(
      'UPDATE person_previews SET invalidated_at = clock_timestamp() WHERE account_id = $1 AND draft_id = $2 AND invalidated_at IS NULL',
      [accountId, draftId],
    )
  }

  async createPreview(accountId: string, draftId: string, authorizationVersion: number, key: string, version: number, input: PreviewInput) {
    return this.write(accountId, 'preview', draftId, key, { version, input }, async (db) => {
      const current = await this.lockDraft(db, accountId, draftId)
      if (current.version !== version) throw conflict(current.version)
      if (current.status !== 'draft') throw draftUnavailable()
      if (!current.display_name || !current.story) {
        throw new PeopleError(400, 'INVALID_ARGUMENT', 'A name and story are required for a preview.')
      }
      if (input.previousPreviewId) {
        const previous = await db.query<{ current: boolean }>(
          'SELECT (draft_version = $4 AND authorization_version = $5 AND invalidated_at IS NULL AND expires_at > clock_timestamp()) AS current '
          + 'FROM person_previews WHERE account_id = $1 AND draft_id = $2 AND id = $3',
          [accountId, draftId, input.previousPreviewId, version, authorizationVersion],
        )
        if (!previous.rows[0]) throw notFound()
        if (!previous.rows[0].current) throw previewUnavailable()
      }
      const world = await this.enabledWorld(db, input.worldPreferenceId)
      await this.invalidatePreviews(db, accountId, draftId)
      const result = await db.query<PreviewRow>(
        'WITH stamp AS (SELECT clock_timestamp()::timestamptz(3) AS now) '
        + 'INSERT INTO person_previews (account_id, draft_id, draft_version, authorization_version, suggested_world_id, created_at, expires_at) '
        + "SELECT $1, $2, $3, $4, $5, now, LEAST($6::timestamptz, now + interval '30 minutes') FROM stamp WHERE $6 > now "
        + 'RETURNING ' + previewColumns,
        [accountId, draftId, version, authorizationVersion, world, current.expires_at],
      )
      if (!result.rows[0]) throw draftUnavailable()
      return previewResult(result.rows[0], 'succeeded')
    })
  }

  async getPreview(accountId: string, draftId: string, previewId: string, authorizationVersion: number | null): Promise<PersonPreview> {
    const result = await this.pool.query<PreviewRow>(
      'SELECT p.id, p.draft_id, p.draft_version, p.suggested_world_id, p.expires_at, d.story, '
      + '(p.invalidated_at IS NULL AND d.confirmed_at IS NULL AND p.expires_at > clock_timestamp() '
      + 'AND d.expires_at > clock_timestamp() AND p.draft_version = d.version AND p.authorization_version = $4) AS current '
      + 'FROM person_previews p JOIN person_drafts d ON d.account_id = p.account_id AND d.id = p.draft_id '
      + 'WHERE p.account_id = $1 AND p.draft_id = $2 AND p.id = $3 '
      + "AND NOT EXISTS (SELECT 1 FROM persons removed_person WHERE removed_person.account_id=d.account_id AND removed_person.source_draft_id=d.id AND removed_person.status='removed')",
      [accountId, draftId, previewId, authorizationVersion],
    )
    const candidate = result.rows[0]
    if (!candidate) throw notFound()
    const clues = candidate.current && candidate.story ? profileClues(candidate.story) : undefined
    return {
      ...previewResult(candidate, candidate.current ? 'succeeded' : 'stale'),
      ...(candidate.current && candidate.story ? { summary: candidate.story, suggestedWorldId: candidate.suggested_world_id } : {}),
      ...(clues?.personality.length ? { suggestedPersonality: clues.personality } : {}),
      ...(clues?.catchphrase ? { suggestedCatchphrase: clues.catchphrase } : {}),
      unknownFields: [],
      sourceRefs: candidate.current ? [{ kind: 'draft_story', id: draftId, version: candidate.draft_version }] : [],
      expiresAt: candidate.expires_at.toISOString(),
    }
  }

  async confirm(accountId: string, draftId: string, authorizationVersion: number, key: string, version: number, input: ConfirmInput, requestId: string) {
    return this.write(accountId, 'confirm', draftId, key, { version, input }, async (db) => {
      const current = await this.lockDraft(db, accountId, draftId)
      const relationship = input.relationship ?? current.relationship
      const calledMe = input.calledMe === undefined ? current.called_me : input.calledMe
      if (current.status === 'confirmed') {
        if (version === current.version - 1) {
          const existing = await db.query<PersonRow>(
            'SELECT ' + personColumns + " FROM persons WHERE account_id = $1 AND source_draft_id = $2 AND source_preview_id = $3 AND world_id = $4 AND relationship=$5 AND called_me IS NOT DISTINCT FROM $6 AND status = 'active'",
            [accountId, draftId, input.previewId, input.worldId, relationship, calledMe],
          )
          if (existing.rows[0]) return person(existing.rows[0])
        }
        throw draftUnavailable()
      }
      if (current.version !== version) throw conflict(current.version)
      if (current.status !== 'draft' || !current.display_name || !relationship || !current.story) throw draftUnavailable()
      const candidate = await db.query(
        'SELECT id FROM person_previews WHERE account_id = $1 AND draft_id = $2 AND id = $3',
        [accountId, draftId, input.previewId],
      )
      if (!candidate.rows[0]) throw notFound()
      const world = await this.enabledWorld(db, input.worldId)
      const clues = profileClues(current.story)
      const result = await db.query<PersonRow>(
        'WITH stamp AS (SELECT clock_timestamp()::timestamptz(3) AS now) '
        + 'INSERT INTO persons (account_id, source_draft_id, source_preview_id, display_name, relationship, story, world_id, real_name, called_me, birth_month_day, years_text, place,conversation_tone,voice_timbre,personality,catchphrase, created_at, updated_at) '
        + 'SELECT $1, $2, p.id, $7, $8, $9, $6, $11, $12, $13, $14, $15,$16,$17,$18::text[],$19, now, now FROM person_previews p CROSS JOIN stamp '
        + 'WHERE p.account_id = $1 AND p.draft_id = $2 AND p.id = $3 AND p.draft_version = $4 AND p.authorization_version = $5 '
        + 'AND p.invalidated_at IS NULL AND p.expires_at > now AND $10::timestamptz > now '
        + 'RETURNING ' + personColumns,
        [accountId, draftId, input.previewId, version, authorizationVersion, world,
          current.display_name, relationship, current.story, current.expires_at,
          current.real_name, calledMe, current.birth_month_day, current.years_text, current.place,current.conversation_tone,current.voice_timbre,
          clues.personality, clues.catchphrase],
      )
      if (!result.rows[0]) throw previewUnavailable()
      const confirmed = person(result.rows[0])
      await db.query(
        'UPDATE person_drafts SET confirmed_at = $3, updated_at = GREATEST(updated_at, $3), version = version + 1 '
        + 'WHERE account_id = $1 AND id = $2',
        [accountId, draftId, confirmed.createdAt],
      )
      await this.invalidatePreviews(db, accountId, draftId)
      await db.query(
        "INSERT INTO outbox_events (type, schema_version, account_id, aggregate_type, aggregate_id, aggregate_version, occurred_at, request_id, payload) "
        + "VALUES ('PersonConfirmed.v1', 1, $1, 'person', $2, $3, $4, $5, $6)",
        [accountId, confirmed.id, confirmed.version, confirmed.createdAt, requestId, {
          accountId, personId: confirmed.id, worldId: confirmed.worldId, personVersion: confirmed.version,
        }],
      )
      return confirmed
    })
  }

  private async enabledWorld(db: PoolClient, worldId: string | null) {
    const world = await db.query<{ id: string }>(
      "SELECT id FROM worlds WHERE enabled AND (id = $1 OR ($1::uuid IS NULL AND code = 'courtyard')) FOR SHARE",
      [worldId],
    )
    if (!world.rows[0]) throw new PeopleError(400, 'INVALID_ARGUMENT', 'The selected world is unavailable.')
    return world.rows[0].id
  }

  async listPersons(accountId: string, worldId: string | undefined, after: DraftPosition | undefined, limit: number) {
    const result = await this.pool.query<PersonRow>(
      'SELECT ' + personColumns + " FROM persons WHERE account_id = $1 AND status = 'active' "
      + 'AND ($2::uuid IS NULL OR world_id = $2) '
      + 'AND ($3::timestamptz IS NULL OR (updated_at, id) < ($3::timestamptz, $4::uuid)) '
      + 'ORDER BY updated_at DESC, id DESC LIMIT $5',
      [accountId, worldId ?? null, after?.updatedAt ?? null, after?.id ?? null, limit],
    )
    return result.rows.map(person)
  }

  async getPerson(accountId: string, id: string) {
    const result = await this.pool.query<PersonRow>(
      'SELECT ' + personColumns + " FROM persons WHERE account_id = $1 AND id = $2 AND status = 'active'",
      [accountId, id],
    )
    if (!result.rows[0]) throw notFound()
    return person(result.rows[0])
  }

  async personContext(accountId: string, id: string) {
    const result = await this.pool.query<PersonRow>(
      'SELECT ' + personColumns + " FROM persons WHERE account_id=$1 AND id=$2 AND status='active'", [accountId, id],
    )
    const record = result.rows[0]
    if (!record) throw notFound()
    const {media,mediaIds,photoTarget,avatarMediaLinkId,mediaLinks,voiceId,readyVoice,hasVoice,voiceTarget,...text}=person(record)
    return { ...text,mediaLinks:[], accountId, accessVersion: record.access_version }
  }

  async personContexts(accountId: string) {
    const result = await this.pool.query<PersonRow>(
      'SELECT ' + personColumns + " FROM persons WHERE account_id=$1 AND status='active' ORDER BY updated_at DESC,id DESC", [accountId],
    )
    return result.rows.map(record => {const {media,mediaIds,photoTarget,avatarMediaLinkId,mediaLinks,voiceId,readyVoice,hasVoice,voiceTarget,...text}=person(record);return {...text,mediaLinks:[],accountId,accessVersion:record.access_version}})
  }

  private async lockPerson(db: PoolClient, accountId: string, id: string) {
    const found = await db.query<PersonRow>(
      'SELECT ' + personColumns + " FROM persons WHERE account_id=$1 AND id=$2 AND status='active' FOR UPDATE", [accountId, id],
    )
    if (!found.rows[0]) throw notFound()
    return found.rows[0]
  }

  async updatePerson(accountId: string, id: string, key: string, version: number, input: PersonFields, requestId: string, binding?:PhotoBinding,voiceBinding?:VoiceBinding) {
    return this.write(accountId, 'person_update', id, key, { version, input }, async db => {
      // Match confirmation/removal lock order: draft before person.
      const source=(await db.query<{source_draft_id:string}>("SELECT source_draft_id FROM persons WHERE account_id=$1 AND id=$2 AND status='active'",[accountId,id])).rows[0]
      if(!source)throw notFound()
      await db.query('SELECT id FROM person_drafts WHERE account_id=$1 AND id=$2 FOR UPDATE',[accountId,source.source_draft_id])
      const current = await this.lockPerson(db, accountId, id)
      if (current.version !== version) throw conflict(current.version)
      if(input.mediaIds!==undefined)await this.replacePhotos(db,accountId,current.source_draft_id,input.mediaIds,binding)
      if(input.voiceId!==undefined)await replaceVoice(db,accountId,current.source_draft_id,input.voiceId,voiceBinding)
      const value = (field: Exclude<keyof PersonFields,'mediaIds'|'personality'|'life'|'unknowns'|'voiceId'>, fallback: string | null) => input[field] === undefined ? fallback : input[field]
      const result = await db.query<PersonRow>(
        'UPDATE persons SET display_name=$3, relationship=$4, story=$5, real_name=$6, called_me=$7, birth_month_day=$8, '
        + 'years_text=$9, place=$10,personality=$11,life=$12,unknowns=$13,catchphrase=$14,conversation_tone=$15,voice_timbre=$16, version=version+1, updated_at=GREATEST(updated_at,clock_timestamp()::timestamptz(3)) '
        + 'WHERE account_id=$1 AND id=$2 RETURNING ' + personColumns,
        [accountId, id, value('displayName', current.display_name), value('relationship', current.relationship), value('story', current.story),
          value('realName', current.real_name), value('calledMe', current.called_me), value('birthMonthDay', current.birth_month_day),
          value('yearsText', current.years_text), value('place', current.place),input.personality??current.personality,input.life??current.life,input.unknowns??current.unknowns,value('catchphrase',current.catchphrase),value('conversationTone',current.conversation_tone),value('voiceTimbre',current.voice_timbre)],
      )
      const updated = result.rows[0]
      await this.personEvent(db, 'PersonUpdated.v1', accountId, updated, requestId)
      return person(updated)
    })
  }

  async removePerson(accountId: string, id: string, key: string, version: number, requestId: string) {
    return this.write(accountId, 'person_remove', id, key, { version }, async db => {
      const source = await db.query<{ source_draft_id: string }>(
        "SELECT source_draft_id FROM persons WHERE account_id=$1 AND id=$2 AND status='active'", [accountId, id],
      )
      if (!source.rows[0]) throw notFound()
      // Use the same draft → person lock order as confirmation and cached-source reads.
      await db.query('SELECT id FROM person_drafts WHERE account_id=$1 AND id=$2 FOR UPDATE', [accountId, source.rows[0].source_draft_id])
      const current = await this.lockPerson(db, accountId, id)
      if (current.version !== version) throw conflict(current.version)
      const result = await db.query<PersonRow>(
        'WITH stamp AS (SELECT GREATEST(updated_at,clock_timestamp()::timestamptz(3)) AS now FROM persons WHERE account_id=$1 AND id=$2) '
        + "UPDATE persons SET status='removed', version=version+1, access_version=access_version+1, removed_at=stamp.now, updated_at=stamp.now "
        + 'FROM stamp WHERE account_id=$1 AND id=$2 RETURNING ' + personColumns,
        [accountId, id],
      )
      await db.query('DELETE FROM person_draft_media WHERE account_id=$1 AND draft_id=$2',[accountId,current.source_draft_id])
      await this.invalidatePreviews(db, accountId, current.source_draft_id)
      await this.personEvent(db, 'PersonAccessRevoked.v1', accountId, result.rows[0], requestId)
      return {}
    })
  }

  async movePerson(accountId:string,id:string,key:string,version:number,worldId:string,requestId:string){
    return this.write<Person>(accountId,'person_world',id,key,{version,worldId},async db=>{
      const current=await this.lockPerson(db,accountId,id)
      if(current.version!==version)throw conflict(current.version)
      if(current.world_id===worldId)return person(current)
      const catalog=(await db.query<WorldRow>('SELECT id,code,display_name,enabled,catalog_version FROM worlds WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[[current.world_id,worldId]])).rows
      const to=catalog.find(world=>world.id===worldId),from=catalog.find(world=>world.id===current.world_id)
      if(!to?.enabled)throw new PeopleError(400,'INVALID_ARGUMENT','The selected world is unavailable.')
      if(!from)throw notFound()
      const updated=(await db.query<PersonRow>('UPDATE persons SET world_id=$3,world_version=world_version+1,version=version+1,updated_at=GREATEST(updated_at,clock_timestamp()::timestamptz(3)) WHERE account_id=$1 AND id=$2 RETURNING '+personColumns,[accountId,id,worldId])).rows[0]
      const recorded=(await db.query<{id:string}>(`INSERT INTO person_world_movements(account_id,person_id,world_version,person_version,from_world_id,to_world_id,from_world,to_world,actor_account_id,request_id,occurred_at,recorded_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$1,$9,$10,$10) RETURNING id`,[accountId,id,updated.world_version,updated.version,from.id,to.id,JSON.stringify(worldDto(from)),JSON.stringify(worldDto(to)),requestId,updated.updated_at])).rows[0]
      await db.query(`INSERT INTO outbox_events(type,schema_version,account_id,aggregate_type,aggregate_id,aggregate_version,occurred_at,request_id,payload)
       VALUES('PersonWorldChanged.v1',1,$1,'person',$2,$3,$4,$5,$6)`,[accountId,id,updated.version,updated.updated_at,requestId,{accountId,personId:id,movementId:recorded.id,fromWorldId:from.id,toWorldId:to.id,personVersion:updated.version,worldVersion:updated.world_version,reality:'virtual',branch:'main'}])
      // A Person version also changed. Existing profile consumers must not remain stuck
      // on an earlier version, even though the virtual scene is not a biography fact.
      await this.personEvent(db,'PersonUpdated.v1',accountId,updated,requestId)
      return person(updated)
    })
  }

  async getWorld(id:string):Promise<World>{
    const row=(await this.pool.query<WorldRow>('SELECT id,code,display_name,enabled,catalog_version FROM worlds WHERE id=$1',[id])).rows[0]
    if(!row)throw notFound()
    return worldDto(row)
  }

  private async readWorld<T>(accountId:string,id:string,work:(db:PoolClient,current:PersonRow)=>Promise<T>){
    const db=await this.pool.connect()
    try{
      await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      if((await db.query('SELECT 1 FROM account_erasure_fences WHERE account_id=$1 AND erased_at IS NOT NULL',[accountId])).rowCount)throw notFound()
      const current=(await db.query<PersonRow>('SELECT '+personColumns+" FROM persons WHERE account_id=$1 AND id=$2 AND status='active'",[accountId,id])).rows[0]
      if(!current)throw notFound()
      const result=await work(db,current);await db.query('COMMIT');return result
    }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
  }

  async worldMovements(accountId:string,id:string,before:number|undefined,limit:number){
    return this.readWorld(accountId,id,async db=>{
      const rows=(await db.query<MovementRow>('SELECT id,world_version,person_version,from_world,to_world,occurred_at,recorded_at FROM person_world_movements WHERE account_id=$1 AND person_id=$2 AND ($3::integer IS NULL OR world_version<$3) ORDER BY world_version DESC LIMIT $4',[accountId,id,before??null,limit])).rows
      return rows.map(movement)
    })
  }

  async worldContext(accountId:string,id:string):Promise<WorldContext>{
    return this.readWorld(accountId,id,async(db,current)=>{
      const world=(await db.query<WorldRow>('SELECT id,code,display_name,enabled,catalog_version FROM worlds WHERE id=$1',[current.world_id])).rows[0]
      if(!world)throw new PeopleError(503,'DEPENDENCY_UNAVAILABLE','The world state is unavailable.')
      const recentMovements=(await db.query<MovementRow>('SELECT id,world_version,person_version,from_world,to_world,occurred_at,recorded_at FROM person_world_movements WHERE account_id=$1 AND person_id=$2 ORDER BY world_version DESC LIMIT 8',[accountId,id])).rows.map(movement)
      if(recentMovements.length!==Math.min(8,current.world_version-1)||recentMovements.some((move,index)=>move.worldVersion!==current.world_version-index||move.personVersion>current.version||(index===0?move.toWorld.id!==current.world_id:recentMovements[index-1].fromWorld.id!==move.toWorld.id)))throw new PeopleError(503,'DEPENDENCY_UNAVAILABLE','The world state is inconsistent.')
      const snapshot={accountId,personId:id,worldVersion:current.world_version,reality:'virtual' as const,branch:'main' as const,currentWorld:worldDto(world),recentMovements}
      return {...snapshot,personVersion:current.version,revision:createHash('sha256').update(canonical(snapshot)).digest('hex')}
    })
  }

  async resolveWorldStages(accountId:string,id:string,input:WorldStageRequest):Promise<ResolvedWorldStages>{
    return this.readWorld(accountId,id,async(db,current)=>{
      const changed=()=>new PeopleError(409,'SOURCE_CHANGED','The person world context changed.')
      const inconsistent=()=>new PeopleError(503,'DEPENDENCY_UNAVAILABLE','The world history is inconsistent.')
      if(current.version!==input.expectedPersonVersion||current.world_version!==input.expectedWorldVersion)throw changed()
      if(input.stages.some(stage=>stage.worldVersion>current.world_version))throw changed()
      // Resolve the requested phases and adjacent boundaries, not recentMovements.
      // The initial placement has no fabricated arrival event.
      const needed=new Set<number>()
      const boundary=(version:number)=>{if(version>=2&&version<=current.world_version)needed.add(version)}
      for(const stage of input.stages){boundary(stage.worldVersion-1);boundary(stage.worldVersion);boundary(stage.worldVersion+1)}
      boundary(current.world_version-1);boundary(current.world_version)
      type StageMovement=Pick<MovementRow,'world_version'|'person_version'|'from_world'|'to_world'>&{from_world_id:string;to_world_id:string}
      const rows=(await db.query<StageMovement>('SELECT world_version,person_version,from_world_id,to_world_id,from_world,to_world FROM person_world_movements WHERE account_id=$1 AND person_id=$2 AND world_version=ANY($3::integer[]) ORDER BY world_version',[accountId,id,[...needed]])).rows
      const movements=new Map(rows.map(row=>[row.world_version,row]))
      if(movements.size!==needed.size||rows.length!==needed.size)throw inconsistent()
      const card=(world:World,expectedId:string)=>!!world&&world.id===expectedId&&typeof world.code==='string'&&world.code.length>0&&world.code.length<=64
        &&typeof world.displayName==='string'&&world.displayName.length>0&&world.displayName.length<=200
        &&Number.isSafeInteger(world.catalogVersion)&&world.catalogVersion>0&&typeof world.enabled==='boolean'
      for(const row of rows){
        if(row.person_version>current.version||row.person_version<row.world_version||row.from_world_id===row.to_world_id
          ||!card(row.from_world,row.from_world_id)||!card(row.to_world,row.to_world_id))throw inconsistent()
        const previous=movements.get(row.world_version-1)
        if(previous&&(previous.to_world_id!==row.from_world_id||previous.person_version>=row.person_version))throw inconsistent()
        if(row.world_version===current.world_version&&row.to_world_id!==current.world_id)throw inconsistent()
      }
      let currentWorld:World|undefined
      if(input.stages.some(stage=>stage.worldVersion===current.world_version)){
        const row=(await db.query<WorldRow>('SELECT id,code,display_name,enabled,catalog_version FROM worlds WHERE id=$1',[current.world_id])).rows[0]
        if(!row)throw inconsistent()
        currentWorld=worldDto(row)
      }
      const stages=input.stages.map((stage):ResolvedWorldStages['stages'][number]=>{
        const basis=stage.worldVersion===current.world_version?'current_catalog':stage.worldVersion===1?'departure_snapshot':'arrival_snapshot'
        const world=basis==='current_catalog'?currentWorld!:basis==='departure_snapshot'?movements.get(2)!.from_world:movements.get(stage.worldVersion)!.to_world
        if(world.id!==stage.worldId)throw changed()
        return {worldVersion:stage.worldVersion,world:{id:world.id,code:world.code,displayName:world.displayName,enabled:world.enabled,catalogVersion:world.catalogVersion},basis}
      })
      return {accountId,personId:id,personVersion:current.version,currentWorldVersion:current.world_version,stages}
    })
  }

  async gatherContext(accountId:string,worldId:string):Promise<GatherContext>{
    return this.readSocial(accountId,async db=>{
      const world=(await db.query<WorldRow>('SELECT id,code,display_name,enabled,catalog_version FROM worlds WHERE id=$1',[worldId])).rows[0]
      if(!world)throw notFound()
      const rows=(await db.query<Pick<PersonRow,'id'|'display_name'|'version'|'access_version'|'world_version'|'created_at'>>(
        `SELECT id,display_name,version,access_version,world_version,created_at FROM persons
         WHERE account_id=$1 AND world_id=$2 AND status='active' ORDER BY created_at,id LIMIT 1001`,[accountId,worldId])).rows
      if(rows.length>1000)throw new PeopleError(413,'HISTORY_TOO_LARGE','The world resident directory exceeds the supported size.')
      const residents=rows.map(row=>({id:row.id,displayName:row.display_name,version:row.version,accessVersion:row.access_version,worldVersion:row.world_version,createdAt:row.created_at.toISOString()}))
      const snapshot={accountId,world:worldDto(world),residents}
      return {...snapshot,revision:createHash('sha256').update(canonical(snapshot)).digest('hex')}
    })
  }

  private async readSocial<T>(accountId:string,work:(db:PoolClient)=>Promise<T>){
    const db=await this.pool.connect()
    try{
      await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      if((await db.query('SELECT 1 FROM account_erasure_fences WHERE account_id=$1 AND erased_at IS NOT NULL',[accountId])).rowCount)throw notFound()
      const result=await work(db);await db.query('COMMIT');return result
    }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
  }

  async socialPersons(accountId:string):Promise<{accountId:string;persons:SocialPerson[]}>{
    return this.readSocial(accountId,async db=>{
      const rows=(await db.query<SocialPerson>(`SELECT id,display_name AS "displayName",world_id AS "worldId",version,access_version AS "accessVersion",world_version AS "worldVersion"
        FROM persons WHERE account_id=$1 AND status='active' ORDER BY id LIMIT 1001`,[accountId])).rows
      if(rows.length>1000)throw new PeopleError(413,'SOURCE_TOO_LARGE','The person directory exceeds the supported sync size.')
      return {accountId,persons:rows}
    })
  }

  async socialAiPerson(accountId:string,id:string):Promise<SocialAiPerson>{
    return this.readSocial(accountId,async db=>{
      const row=(await db.query<SocialAiPerson&{calledMe:string|null}>(`SELECT id,account_id AS "accountId",display_name AS "displayName",relationship,story,personality,life,unknowns,catchphrase,conversation_tone AS "conversationTone",voice_timbre AS "voiceTimbre",called_me AS "calledMe",world_id AS "worldId",version,access_version AS "accessVersion",world_version AS "worldVersion"
        FROM persons WHERE account_id=$1 AND id=$2 AND status='active'`,[accountId,id])).rows[0]
      if(!row)throw notFound()
      const {calledMe,...value}=row
      return {...value,...(calledMe===null?{}:{calledMe})}
    })
  }

  async socialWorldMovements(accountId:string,id:string,afterVersion:number,throughVersion:number,limit:number):Promise<SocialMovementPage>{
    if(![afterVersion,throughVersion,limit].every(Number.isSafeInteger)||afterVersion<1||throughVersion<afterVersion||throughVersion>2147483647||limit<1||limit>100)throw new PeopleError(400,'INVALID_ARGUMENT','The movement range is invalid.')
    return this.readSocial(accountId,async db=>{
      const current=(await db.query<SocialPerson>(`SELECT id,display_name AS "displayName",world_id AS "worldId",version,access_version AS "accessVersion",world_version AS "worldVersion"
        FROM persons WHERE account_id=$1 AND id=$2 AND status='active'`,[accountId,id])).rows[0]
      if(!current)throw notFound()
      if(throughVersion>current.worldVersion)throw new PeopleError(400,'INVALID_ARGUMENT','The movement horizon is unavailable.')
      const lastVersion=Math.min(throughVersion,afterVersion+limit)
      // Include the prior boundary in the same snapshot so page joins cannot conceal a gap.
      const rows=(await db.query<MovementRow>(`SELECT id,world_version,person_version,from_world,to_world,occurred_at,recorded_at FROM person_world_movements
        WHERE account_id=$1 AND person_id=$2 AND world_version>=$3 AND world_version<=$4 ORDER BY world_version`,[accountId,id,Math.max(2,afterVersion),lastVersion])).rows
      const items=rows.filter(row=>row.world_version>afterVersion).map(movement),previous=rows.find(row=>row.world_version===afterVersion)
      if(items.length!==lastVersion-afterVersion||(afterVersion>1&&!previous)||items.some((move,index)=>move.worldVersion!==afterVersion+index+1||move.personVersion>current.version||(index>0?items[index-1].toWorld.id!==move.fromWorld.id:!!previous&&previous.to_world.id!==move.fromWorld.id))
        ||lastVersion===current.worldVersion&&current.worldVersion>1&&(items.at(-1)?.toWorld.id??previous?.to_world.id)!==current.worldId)
        throw new PeopleError(503,'DEPENDENCY_UNAVAILABLE','The world history is inconsistent.')
      return {accountId,person:current,items,nextAfterVersion:lastVersion,hasMore:lastVersion<throughVersion}
    })
  }

  private async personEvent(db: PoolClient, type: 'PersonUpdated.v1' | 'PersonAccessRevoked.v1', accountId: string, current: PersonRow, requestId: string) {
    await db.query(
      'INSERT INTO outbox_events(type,schema_version,account_id,aggregate_type,aggregate_id,aggregate_version,occurred_at,request_id,payload) '
      + "VALUES($1,1,$2,'person',$3,$4,$5,$6,$7)",
      [type, accountId, current.id, current.version, current.updated_at, requestId, {
        accountId, personId: current.id, worldId: current.world_id, personVersion: current.version, accessVersion: current.access_version,
        ...(type === 'PersonAccessRevoked.v1' ? { reason: 'person_removed' } : {}),
      }],
    )
  }

  private async assertSourceVisible(db: PoolClient, accountId: string, draftId: string) {
    const found = await db.query<{ status: string }>(
      'SELECT status FROM persons WHERE account_id=$1 AND source_draft_id=$2 FOR SHARE', [accountId, draftId],
    )
    if (found.rows[0]?.status === 'removed') throw notFound()
  }

  private async assertReplayVisible(db: PoolClient, accountId: string, operation: string, target: string, response: object) {
    if (operation === 'person_remove') return
    if (operation === 'person_update' || operation === 'confirm' || operation==='person_world') {
      const found = await db.query(
        "SELECT id FROM persons WHERE account_id=$1 AND id=$2 AND status='active' FOR SHARE", [accountId, (response as Person).id],
      )
      if (!found.rowCount) throw notFound()
    } else {
      await this.assertSourceVisible(db, accountId, target || (response as PersonDraft).id)
    }
  }

  async worlds(after: string | undefined, limit: number): Promise<World[]> {
    const result = await this.pool.query<WorldRow>(
      'SELECT id, code, display_name, enabled, catalog_version FROM worlds '
      + 'WHERE ($1::uuid IS NULL OR id > $1) ORDER BY id LIMIT $2',
      [after ?? null, limit],
    )
    return result.rows.map(result => ({
      id: result.id, code: result.code, displayName: result.display_name,
      enabled: result.enabled, catalogVersion: result.catalog_version,
    }))
  }

  async sweepCommands() {
    await this.pool.query("DELETE FROM person_draft_commands WHERE operation IN('create','update','preview') AND created_at < now() - interval '7 days'")
  }

  private async write<T extends object>(
    accountId: string, operation: 'create' | 'update' | 'preview' | 'confirm' | 'person_update' | 'person_remove' | 'person_world', target: string, key: string, input: object,
    command: (db: PoolClient) => Promise<T>,
  ) {
    const scope = [accountId, operation, target, key]
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex')
    const db = await this.pool.connect()
    try {
      await db.query('BEGIN')
      const lock = await db.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 6427302)) AS acquired',
        [JSON.stringify(scope)],
      )
      if (!lock.rows[0].acquired) throw new PeopleError(409, 'REQUEST_IN_PROGRESS', 'The same request is still being processed.')
      // Match erasure's account → resource lock order before locking any person/draft.
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended('xijie:people:erasure:' || $1,0))",[accountId])
      await db.query('INSERT INTO account_erasure_fences(account_id) VALUES($1) ON CONFLICT DO NOTHING',[accountId])
      if((await db.query('SELECT 1 FROM account_erasure_fences WHERE account_id=$1 AND erased_at IS NOT NULL',[accountId])).rowCount)throw notFound()
      const found = await db.query<{ request_hash: string; response: T }>(
        'SELECT request_hash, response FROM person_draft_commands WHERE account_id = $1 AND operation = $2 AND target = $3 AND idempotency_key = $4',
        scope,
      )
      const previous = found.rows[0]
      if (previous && previous.request_hash !== requestHash) {
        throw new PeopleError(409, 'IDEMPOTENCY_CONFLICT', 'The key was already used for a different request.')
      }
      let response = previous?.response ?? await command(db)
      // Cached success must never turn a removed person or their private source into a visible record again.
      await this.assertReplayVisible(db, accountId, operation, target, response)
      if(operation==='create'||operation==='update'){
        const current=(await db.query<Row>('SELECT '+row+' FROM person_drafts WHERE account_id=$1 AND id=$2',[accountId,(response as PersonDraft).id])).rows[0]
        if(!current)throw notFound()
        const live=draft(current)
        const photoWrite=operation==='update'&&Object.hasOwn((input as {input?:object}).input??{},'mediaIds')
        // Photo edits replay one coherent current resource, including its version and status.
        // Preserve legacy pure-text receipts, while never replaying their stale photo selection.
        response=(previous&&!photoWrite?{...response,mediaIds:live.mediaIds,media:live.media,photoTarget:live.photoTarget}:live) as T
      }
      if(operation==='confirm'||operation==='person_update'||operation==='person_world'){
        const current=(await db.query<PersonRow>('SELECT '+personColumns+" FROM persons WHERE account_id=$1 AND id=$2 AND status='active'",[accountId,(response as Person).id])).rows[0]
        if(!current)throw notFound()
        response=person(current) as T
      }
      if (!previous) {
        await db.query(
          'INSERT INTO person_draft_commands (account_id, operation, target, idempotency_key, request_hash, response) VALUES ($1, $2, $3, $4, $5, $6)',
          [...scope, requestHash, response],
        )
      }
      await db.query('COMMIT')
      return response
    } catch (error) {
      await db.query('ROLLBACK')
      throw error
    } finally {
      db.release()
    }
  }
}
