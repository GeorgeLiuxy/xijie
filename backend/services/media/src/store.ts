import { randomUUID, createHmac, timingSafeEqual } from "node:crypto"

import { type Pool, type PoolClient } from "pg"

import { type MediaConfig } from "./config.js"

import { type ContextProvider } from "./dependencies.js"

import { type ObjectStorage } from "./storage.js"
import {PersonVoiceStore} from './voice-store.js'

import {
  MediaError,
  missing,
  unavailable,
  hash,
  dto,
  metadata,
  positive,
  uuid,
  MAX_OUTPUT,
  type MediaRow,
  type SlotRow,
  type Account,
  type Session,
  type Metadata,
  type ConversationRef,type PhotoReplySource,
} from "./contracts.js"

export const photoPermission = (a: Account, purpose = "post_attachment") =>
  purpose === "person_photo" ? a.personPhotoStorage : purpose === "gift_delivery_photo" ? a.giftPhotoStorage : purpose==='conversation_attachment'?a.chatPhotoStorage:purpose === "post_attachment" ? a.photoStorage : undefined

const storageVersion=(a:Account,purpose:string)=>purpose==='gift_delivery_photo'?a.giftStorage?.authorizationVersion:a.storyStorage.authorizationVersion

export function permitted(a: Account, purpose = "post_attachment") {
  if(purpose==='gift_delivery_photo'){
    if(a.giftStorage?.allowed!==true||a.giftPhotoStorage?.allowed!==true)throw new MediaError(403,'GIFT_PHOTO_PERMISSION_REQUIRED')
    return a
  }
  if (
    !a.storyStorage.allowed ||
    (purpose === "post_attachment" &&
      a.storyStorage.privateFeedAllowed !== true)
  )
    throw new MediaError(403, "STORAGE_PERMISSION_REQUIRED")

  if (photoPermission(a, purpose)?.allowed !== true)
    throw new MediaError(
      403,
      purpose === "person_photo"
        ? "PERSON_PHOTO_STORAGE_PERMISSION_REQUIRED"
        : purpose==='conversation_attachment'?'CHAT_PHOTO_STORAGE_PERMISSION_REQUIRED':"PHOTO_STORAGE_PERMISSION_REQUIRED",
    )

  return a
}

export function sameAuthority(
  a: Account,
  b: Account,
  purpose = "post_attachment",
) {
  if (
    a.accountId !== b.accountId ||
    a.accessVersion !== b.accessVersion ||
    storageVersion(a,purpose) !== storageVersion(b,purpose) ||
    photoPermission(a, purpose)?.authorizationVersion !==
      photoPermission(b, purpose)?.authorizationVersion
  )
    throw new MediaError(409, "AUTHORIZATION_CHANGED")

  permitted(b, purpose)
}

export function capturedAuthority(a: Account, r: MediaRow) {
  permitted(a, r.purpose)

  if (
    a.accessVersion !== r.account_access_version ||
    storageVersion(a,r.purpose) !== (r.purpose==='gift_delivery_photo'?r.gift_storage_authorization_version:r.storage_authorization_version) ||
    photoPermission(a, r.purpose)?.authorizationVersion !==
      r.photo_authorization_version
  )
    throw new MediaError(409, "AUTHORIZATION_CHANGED")
}

export class MediaStore {
  readonly voices:PersonVoiceStore
  constructor(
    readonly pool: Pool,

    readonly dependencies: ContextProvider,

    readonly storage: ObjectStorage,

    readonly config: Pick<MediaConfig, "proofKey"> & {ffmpegPath?:string},
  ) {this.voices=new PersonVoiceStore(this)}

  async gate(db: PoolClient, id: string, exclusive = false) {
    await db.query(
      "INSERT INTO media_account_write_gates(account_id) VALUES($1) ON CONFLICT DO NOTHING",

      [id],
    )

    const r = (
      await db.query(
        "SELECT erased_at FROM media_account_write_gates WHERE account_id=$1 FOR " +
          (exclusive ? "UPDATE" : "SHARE"),

        [id],
      )
    ).rows[0]

    if (r.erased_at) throw missing()
  }

  async tx<T,>(
    id: string,

    fn: (db: PoolClient) => Promise<T>,

    exclusive = false,
  ): Promise<T> {
    const db = await this.pool.connect()

    try {
      await db.query("BEGIN")

      await this.gate(db, id, exclusive)

      const value = await fn(db)

      await db.query("COMMIT")

      return value
    } catch (e) {
      await db.query("ROLLBACK")

      throw e
    } finally {
      db.release()
    }
  }

  async row(
    accountId: string,

    id: string,

    db: Pool | PoolClient = this.pool,
  ): Promise<MediaRow> {
    const r = (
      await db.query(
        "SELECT m.* FROM media_objects m JOIN media_account_write_gates g ON g.account_id=m.account_id WHERE m.account_id=$1 AND m.id=$2 AND g.erased_at IS NULL",

        [accountId, id],
      )
    ).rows[0]

    if (!r) throw missing()

    return r
  }

  async command(
    db: PoolClient,

    id: string,

    operation: string,

    key: string,

    target: string,

    fingerprint: string,
  ) {
    const r = (
      await db.query(
        "SELECT target_id,request_hash FROM media_commands WHERE account_id=$1 AND operation=$2 AND idempotency_key=$3",

        [id, operation, key],
      )
    ).rows[0]

    if (r) {
      if (r.request_hash !== fingerprint || r.target_id !== target)
        throw new MediaError(409, "IDEMPOTENCY_CONFLICT")

      return true
    }

    return false
  }

  async record(
    db: PoolClient,

    id: string,

    operation: string,

    key: string,

    target: string,

    fingerprint: string,
  ) {
    await db.query(
      "INSERT INTO media_commands(account_id,operation,idempotency_key,target_id,request_hash) VALUES($1,$2,$3,$4,$5)",

      [id, operation, key, target, fingerprint],
    )
  }

  private uploadResponse(r: MediaRow, s: SlotRow) {
    return {
      media: dto(r),

      upload: {
        id: s.id,

        method: "PUT",

        url: "/v1/media/" + r.id + "/uploads/" + s.id,

        requiredHeaders: { "Content-Type": r.declared_mime },

        expiresAt: s.expires_at.toISOString(),
      },
    }
  }

  private async addSlot(db: PoolClient, r: MediaRow) {
    return (
      await db.query(
        "INSERT INTO media_upload_slots(id,account_id,media_id,staging_key,expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+interval '15 minutes') RETURNING *",

        [
          randomUUID(),

          r.account_id,

          r.id,

          "staging/" + r.account_id + "/" + randomUUID(),
        ],
      )
    ).rows[0] as SlotRow
  }

  async create(
    accountId: string,

    key: string,

    input: {
      mimeType: string

      byteSize: number

      sha256: string

      clientPostId?: string

      purpose?: "person_photo" | "gift_delivery_photo" | 'conversation_attachment'

      draftId?: string
      deliveryId?: string
      conversationId?:string
      clientMessageId?:string
    },
  ) {
    const purpose = input.purpose ?? "post_attachment"

    const a = permitted(await this.dependencies.account(accountId), purpose),
      fingerprint = hash(JSON.stringify(input)),
      prior = (
        await this.pool.query(
          "SELECT target_id,request_hash FROM media_commands WHERE account_id=$1 AND operation='create' AND idempotency_key=$2",

          [accountId, key],
        )
      ).rows[0]

    if (purpose === "person_photo")
      await this.dependencies.personTarget(accountId, input.draftId!)
    if(purpose==='gift_delivery_photo')await this.dependencies.giftTarget(accountId,input.deliveryId!)
    if(purpose==='conversation_attachment')await this.dependencies.conversationTarget(accountId,input.conversationId!)

    if (prior && prior.request_hash !== fingerprint)
      throw new MediaError(409, "IDEMPOTENCY_CONFLICT")

    let id = prior?.target_id ?? randomUUID()

    const value = await this.tx(
      accountId,

      async (db) => {
        const currentCommand = (
          await db.query(
            "SELECT target_id FROM media_commands WHERE account_id=$1 AND operation='create' AND idempotency_key=$2",

            [accountId, key],
          )
        ).rows[0]

        if (currentCommand) id = currentCommand.target_id

        if (await this.command(db, accountId, "create", key, id, fingerprint)) {
          const r = await this.row(accountId, id, db),
            s = (
              await db.query(
                "SELECT * FROM media_upload_slots WHERE account_id=$1 AND media_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1",

                [accountId, id],
              )
            ).rows[0]

          if (!s) throw missing()

          return this.uploadResponse(r, s)
        }

        const quota = (
          await db.query(
            "SELECT count(*)::int n,COALESCE(sum(declared_bytes),0)::bigint bytes FROM media_objects WHERE account_id=$1 AND status NOT IN('deleted','revoked','rejected')",

            [accountId],
          )
        ).rows[0]

        if (
          quota.n >= 256 ||
          Number(quota.bytes) + input.byteSize > 128 * 1024 * 1024
        )
          throw new MediaError(413, "MEDIA_QUOTA_EXCEEDED")

        const r = (
          await db.query(
            "INSERT INTO media_objects(id,account_id,client_post_id,purpose,declared_mime,declared_bytes,input_sha256,account_access_version,storage_authorization_version,photo_authorization_version,person_draft_id,gift_delivery_id,gift_storage_authorization_version,chat_conversation_id,chat_client_message_id) VALUES($1,$2,$3,$10,$4,$5,$6,$7,$8,$9,$11,$12,$13,$14,$15) RETURNING *",

            [
              id,

              accountId,

              input.clientPostId ?? null,

              input.mimeType,

              input.byteSize,

              input.sha256,

              a.accessVersion,

              purpose==='gift_delivery_photo'?null:a.storyStorage.authorizationVersion,

              photoPermission(a, purpose)!.authorizationVersion,

              purpose,

              input.draftId ?? null,
              input.deliveryId ?? null,
              purpose==='gift_delivery_photo'?a.giftStorage!.authorizationVersion:null,
              input.conversationId??null,input.clientMessageId??null,
            ],
          )
        ).rows[0]

        const s = await this.addSlot(db, r)

        await this.record(db, accountId, "create", key, id, fingerprint)

        return this.uploadResponse(r, s)
      },

      true,
    )

    sameAuthority(a, await this.dependencies.account(accountId), purpose)

    return value
  }

  async get(accountId: string, id: string) {
    await this.dependencies.account(accountId)

    return dto(await this.row(accountId, id))
  }

  async newSlot(accountId: string, id: string, key: string, expected: number) {
    const initial = await this.row(accountId, id),
      purpose = initial.purpose,
      a = permitted(await this.dependencies.account(accountId), purpose),
      fingerprint = hash(JSON.stringify({ id, expected }))

    if (purpose === "person_photo")
      await this.dependencies.personTarget(accountId, initial.person_draft_id!)
    if(purpose==='gift_delivery_photo'){capturedAuthority(a,initial);await this.dependencies.giftTarget(accountId,initial.gift_delivery_id!)}
    if(purpose==='conversation_attachment'){capturedAuthority(a,initial);await this.dependencies.conversationTarget(accountId,initial.chat_conversation_id!)}

    const result = await this.tx(
      accountId,

      async (db) => {
        const r = await this.row(accountId, id, db)

        if (await this.command(db, accountId, "slot", key, id, fingerprint)) {
          const s = (
            await db.query(
              "SELECT * FROM media_upload_slots WHERE account_id=$1 AND media_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1",

              [accountId, id],
            )
          ).rows[0]

          return this.uploadResponse(r, s)
        }

        if (r.version !== expected)
          throw new MediaError(412, "VERSION_CONFLICT")

        if (r.status !== "awaiting_upload")
          throw new MediaError(409, "MEDIA_STATE_CHANGED")
        if(purpose==='gift_delivery_photo'||purpose==='conversation_attachment')capturedAuthority(a,r)

        if (
          (
            await db.query(
              "SELECT 1 FROM media_upload_slots WHERE account_id=$1 AND media_id=$2 AND state='uploading' AND lease_until>clock_timestamp()",

              [accountId, id],
            )
          ).rowCount
        )
          throw new MediaError(409, "MEDIA_UPLOAD_BUSY")

        await db.query(
          "UPDATE media_upload_slots SET state='replaced',ended_at=clock_timestamp(),attempt_id=NULL,lease_until=NULL,version=version+1 WHERE account_id=$1 AND media_id=$2 AND state IN('active','uploading','uploaded')",

          [accountId, id],
        )

        const changed = (
            await db.query(
              "UPDATE media_objects SET version=version+1,account_access_version=$3,storage_authorization_version=$4,photo_authorization_version=$5,gift_storage_authorization_version=$6,updated_at=clock_timestamp() WHERE account_id=$1 AND id=$2 RETURNING *",

              [
                accountId,

                id,

                a.accessVersion,

                purpose==='gift_delivery_photo'?null:a.storyStorage.authorizationVersion,

                photoPermission(a, purpose)!.authorizationVersion,
                purpose==='gift_delivery_photo'?a.giftStorage!.authorizationVersion:null,
              ],
            )
          ).rows[0],
          slot = await this.addSlot(db, changed)

        await this.record(db, accountId, "slot", key, id, fingerprint)

        return this.uploadResponse(changed, slot)
      },

      true,
    )

    sameAuthority(a, await this.dependencies.account(accountId), purpose)

    return result
  }

  async upload(
    accountId: string,

    id: string,

    slotId: string,

    key: string,

    contentType: string,

    bytes: Buffer,
  ) {
    const r = await this.row(accountId, id),
      purpose = r.purpose,
      a = permitted(await this.dependencies.account(accountId), purpose)

    capturedAuthority(a, r)

    if (purpose === "person_photo")
      await this.dependencies.personTarget(accountId, r.person_draft_id!)
    if(purpose==='gift_delivery_photo')await this.dependencies.giftTarget(accountId,r.gift_delivery_id!)
    if(purpose==='conversation_attachment')await this.dependencies.conversationTarget(accountId,r.chat_conversation_id!)

    if (
      bytes.length !== r.declared_bytes ||
      hash(bytes) !== r.input_sha256 ||
      contentType !== r.declared_mime
    )
      throw new MediaError(422, "MEDIA_UPLOAD_MISMATCH")

    const attempt = randomUUID(),
      s = await this.tx(accountId, async (db) => {
        const row = await this.row(accountId, id, db)

        capturedAuthority(a, row)

        const slot = (
          await db.query(
            "SELECT * FROM media_upload_slots WHERE account_id=$1 AND media_id=$2 AND id=$3 FOR UPDATE",

            [accountId, id, slotId],
          )
        ).rows[0] as SlotRow | undefined

        if (!slot) throw missing()

        if (slot.upload_key && slot.upload_key !== key)
          throw new MediaError(409, "IDEMPOTENCY_CONFLICT")

        if (slot.state === "uploaded" && row.status === "awaiting_upload")
          return slot

        if (
          row.status !== "awaiting_upload" ||
          !["active", "uploading"].includes(slot.state)
        )
          throw new MediaError(409, "UPLOAD_SLOT_CHANGED")

        if (slot.expires_at.getTime() <= Date.now())
          throw new MediaError(409, "UPLOAD_SLOT_EXPIRED")

        if (
          slot.state === "uploading" &&
          slot.lease_until &&
          slot.lease_until.getTime() > Date.now()
        )
          throw new MediaError(409, "MEDIA_UPLOAD_BUSY")

        return (
          await db.query(
            "UPDATE media_upload_slots SET state='uploading',upload_key=$4,attempt_id=$5,lease_until=clock_timestamp()+interval '60 seconds',version=version+1 WHERE account_id=$1 AND media_id=$2 AND id=$3 RETURNING *",

            [accountId, id, slotId, key, attempt],
          )
        ).rows[0] as SlotRow
      })

    if (s.state === "uploaded") return dto(await this.row(accountId, id))

    try {
      if (await this.storage.head(s.staging_key)) {
        const prior = await this.storage.get(s.staging_key)

        if (hash(prior) !== r.input_sha256 || prior.length !== r.declared_bytes)
          throw new MediaError(409, "MEDIA_UPLOAD_MISMATCH")
      } else {
        const live = (
          await this.pool.query(
            "SELECT 1 FROM media_upload_slots s JOIN media_account_write_gates g ON g.account_id=s.account_id WHERE s.account_id=$1 AND s.id=$2 AND s.state='uploading' AND s.attempt_id=$3 AND s.lease_until>clock_timestamp()+interval '20 seconds' AND g.erased_at IS NULL",

            [accountId, slotId, attempt],
          )
        ).rowCount

        if (!live) throw new MediaError(409, "UPLOAD_SLOT_CHANGED")

        sameAuthority(a, await this.dependencies.account(accountId), purpose)

        await this.storage.put(s.staging_key, bytes, contentType)
      }

      sameAuthority(a, await this.dependencies.account(accountId), purpose)

      return await this.tx(accountId, async (db) => {
        const current = await this.row(accountId, id, db)

        if (current.status !== "awaiting_upload") throw missing()

        const result = await db.query(
          "UPDATE media_upload_slots SET state='uploaded',attempt_id=NULL,lease_until=NULL,uploaded_at=clock_timestamp(),version=version+1 WHERE account_id=$1 AND media_id=$2 AND id=$3 AND state='uploading' AND attempt_id=$4 AND lease_until>clock_timestamp() AND expires_at>clock_timestamp() RETURNING id",

          [accountId, id, slotId, attempt],
        )

        if (!result.rowCount) throw new MediaError(409, "UPLOAD_SLOT_CHANGED")

        return dto(current)
      })
    } catch (e) {
      // A slot owns this key across attempts. A timed-out attempt must never

      // delete bytes already accepted by its successor. Terminal-slot cleanup

      // and account erasure own physical deletion; unknown uploads can be

      // recovered by the declared exact digest without overwriting the key.

      await this.pool

        .query(
          "UPDATE media_upload_slots s SET state=CASE WHEN g.erased_at IS NULL THEN 'active' ELSE 'revoked' END,ended_at=CASE WHEN g.erased_at IS NULL THEN NULL ELSE clock_timestamp() END,attempt_id=NULL,lease_until=NULL,version=s.version+1 FROM media_account_write_gates g WHERE g.account_id=s.account_id AND s.account_id=$1 AND s.id=$2 AND s.attempt_id=$3",

          [accountId, slotId, attempt],
        )

        .catch(() => {})

      throw e
    }
  }

  async complete(accountId: string, id: string, slotId: string, key: string) {
    const initial = await this.row(accountId, id),
      purpose = initial.purpose,
      a = permitted(await this.dependencies.account(accountId), purpose),
      fingerprint = hash(JSON.stringify({ id, slotId }))

    if (purpose === "person_photo")
      await this.dependencies.personTarget(accountId, initial.person_draft_id!)
    if(purpose==='gift_delivery_photo'){capturedAuthority(a,initial);await this.dependencies.giftTarget(accountId,initial.gift_delivery_id!)}
    if(purpose==='conversation_attachment'){capturedAuthority(a,initial);await this.dependencies.conversationTarget(accountId,initial.chat_conversation_id!)}

    const value = await this.tx(
      accountId,
      async (db) => {
        const r = await this.row(accountId, id, db)

        if (await this.command(db, accountId, "complete", key, id, fingerprint))
          return dto(r)

        if (r.status !== "awaiting_upload")
          throw new MediaError(409, "MEDIA_STATE_CHANGED")
        if(purpose==='gift_delivery_photo'||purpose==='conversation_attachment')capturedAuthority(a,r)

        capturedAuthority(a, r)

        const slot = (
          await db.query(
            "SELECT * FROM media_upload_slots WHERE account_id=$1 AND media_id=$2 AND id=$3 FOR UPDATE",

            [accountId, id, slotId],
          )
        ).rows[0] as SlotRow | undefined

        if (!slot) throw missing()

        if (
          slot.state !== "uploaded" ||
          slot.expires_at.getTime() <= Date.now()
        )
          throw new MediaError(
            409,

            slot.expires_at.getTime() <= Date.now()
              ? "UPLOAD_SLOT_EXPIRED"
              : "MEDIA_UPLOAD_NOT_COMPLETE",
          )

        const changed = (
          await db.query(
            "UPDATE media_objects SET status='verifying',version=version+1,account_access_version=$3,storage_authorization_version=$4,photo_authorization_version=$5,gift_storage_authorization_version=$6,updated_at=clock_timestamp() WHERE account_id=$1 AND id=$2 RETURNING *",

            [
              accountId,

              id,

              a.accessVersion,

              purpose==='gift_delivery_photo'?null:a.storyStorage.authorizationVersion,

              photoPermission(a, purpose)!.authorizationVersion,
              purpose==='gift_delivery_photo'?a.giftStorage!.authorizationVersion:null,
            ],
          )
        ).rows[0]

        await db.query(
          "UPDATE media_upload_slots SET state='completed',ended_at=clock_timestamp(),version=version+1 WHERE account_id=$1 AND id=$2",

          [accountId, slotId],
        )

        await db.query(
          "INSERT INTO media_jobs(id,account_id,media_id,kind,media_version) VALUES($1,$2,$3,'verify',$4)",

          [randomUUID(), accountId, id, changed.version],
        )

        await this.record(db, accountId, "complete", key, id, fingerprint)

        return dto(changed)
      },
      true,
    )

    sameAuthority(a, await this.dependencies.account(accountId), purpose)

    return value
  }

  async bind(
    accountId: string,

    postId: string,

    clientPostId: string,

    mediaIds: string[],
  ) {
    const a = permitted(await this.dependencies.account(accountId))

    const value = await this.tx(
      accountId,

      async (db) => {
        const existing = (
          await db.query(
            "SELECT media_id,state,position FROM media_use_grants WHERE account_id=$1 AND post_id=$2 ORDER BY position",

            [accountId, postId],
          )
        ).rows

        if (existing.length) {
          if (
            existing.length !== mediaIds.length ||
            existing.some(
              (r, i) => r.media_id !== mediaIds[i] || r.state !== "active",
            )
          )
            throw new MediaError(409, "MEDIA_BINDING_CONFLICT")

          const media: Metadata[] = []

          for (const id of mediaIds)
            media.push(metadata(await this.row(accountId, id, db)))

          return { postId, media }
        }

        const rows: MediaRow[] = []

        for (const id of [...mediaIds].sort()) {
          const r = await this.row(accountId, id, db)

          if (
            r.purpose !== "post_attachment" ||
            r.status !== "ready" ||
            r.client_post_id !== clientPostId
          )
            throw new MediaError(409, "MEDIA_NOT_READY")

          if (
            (
              await db.query(
                "SELECT 1 FROM media_use_grants WHERE account_id=$1 AND media_id=$2",

                [accountId, id],
              )
            ).rowCount
          )
            throw new MediaError(409, "MEDIA_BINDING_CONFLICT")

          rows.push(r)
        }

        for (let i = 0; i < mediaIds.length; i++) {
          const r = rows.find((r) => r.id === mediaIds[i])!

          await db.query(
            "INSERT INTO media_use_grants(account_id,media_id,client_post_id,post_id,position,media_version) VALUES($1,$2,$3,$4,$5,$6)",

            [accountId, r.id, clientPostId, postId, i + 1, r.version],
          )
        }

        return {
          postId,

          media: mediaIds.map((id) => metadata(rows.find((r) => r.id === id)!)),
        }
      },

      true,
    )

    sameAuthority(a, await this.dependencies.account(accountId))

    return value
  }

  async bindPerson(accountId: string, draftId: string, mediaIds: string[]) {
    const a = permitted(
      await this.dependencies.account(accountId),
      "person_photo",
    )

    await this.dependencies.personTarget(accountId, draftId)

    const value = await this.tx(
      accountId,
      async (db) => {
        const rows: MediaRow[] = []

        for (const id of [...mediaIds].sort()) {
          const r = await this.row(accountId, id, db)

          if (
            r.purpose !== "person_photo" ||
            r.person_draft_id !== draftId ||
            r.status !== "ready"
          )
            throw new MediaError(409, "MEDIA_NOT_READY")

          const grant = (
            await db.query(
              "SELECT state FROM media_person_grants WHERE account_id=$1 AND media_id=$2",
              [accountId, id],
            )
          ).rows[0]

          if (grant?.state === "revoked")
            throw new MediaError(409, "MEDIA_BINDING_CONFLICT")

          rows.push(r)
        }

        // Prebinding is additive. Only People knows which list actually committed.

        for (const r of rows)
          await db.query(
            "INSERT INTO media_person_grants(account_id,media_id,draft_id,media_version) VALUES($1,$2,$3,$4) ON CONFLICT(account_id,media_id) DO UPDATE SET last_bound_at=clock_timestamp()",
            [accountId, r.id, draftId, r.version],
          )

        const expiresAt = (
          await db.query(
            "SELECT clock_timestamp()+interval '60 seconds' AS expires_at",
          )
        ).rows[0].expires_at.toISOString()

        return {
          draftId,
          expiresAt,
          media: mediaIds.map((id) => metadata(rows.find((r) => r.id === id)!)),
        }
      },
      true,
    )

    sameAuthority(a, await this.dependencies.account(accountId), "person_photo")

    return value
  }

  async personRefValid(
    accountId: string,
    id: string,
    draftId: string,
    version: number,
  ) {
    return (
      (
        await this.dependencies.validPersonPhotos(accountId, [
          { draftId, mediaId: id, version },
        ])
      ).length === 1
    )
  }

  async bindConversation(accountId:string,conversationId:string,clientMessageId:string,mediaId:string,version:number){
    const a=permitted(await this.dependencies.account(accountId),'conversation_attachment')
    await this.dependencies.conversationTarget(accountId,conversationId)
    const initial=await this.row(accountId,mediaId)
    if(initial.purpose!=='conversation_attachment'||initial.chat_conversation_id!==conversationId||initial.chat_client_message_id!==clientMessageId||initial.status!=='ready'||initial.version!==version)throw new MediaError(409,'PHOTO_SELECTION_INVALID')
    try{capturedAuthority(a,initial)}catch(error){if(error instanceof MediaError&&error.code==='AUTHORIZATION_CHANGED')throw new MediaError(409,'PHOTO_SELECTION_INVALID');throw error}
    const value=await this.tx(accountId,async db=>{
      const r=await this.row(accountId,mediaId,db)
      if(r.status!=='ready'||r.version!==initial.version||r.authorization_version!==initial.authorization_version)throw new MediaError(409,'PHOTO_SELECTION_INVALID')
      const prior=(await db.query('SELECT media_id,state FROM media_conversation_grants WHERE account_id=$1 AND conversation_id=$2 AND client_message_id=$3',[accountId,conversationId,clientMessageId])).rows[0]
      if(prior&&(prior.media_id!==mediaId||prior.state!=='active'))throw new MediaError(409,'MEDIA_BINDING_CONFLICT')
      await db.query('INSERT INTO media_conversation_grants(account_id,media_id,conversation_id,client_message_id,media_version) VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_id,media_id) DO UPDATE SET last_bound_at=clock_timestamp()',[accountId,mediaId,conversationId,clientMessageId,r.version])
      return{conversationId,clientMessageId,media:metadata(r),expiresAt:(await db.query("SELECT clock_timestamp()+interval '60 seconds' AS expires_at")).rows[0].expires_at.toISOString()}
    },true)
    await this.dependencies.conversationTarget(accountId,conversationId)
    sameAuthority(a,await this.dependencies.account(accountId),'conversation_attachment')
    return value
  }

  async conversationReadable(accountId:string,id:string,conversationId:string,clientMessageId:string){
    const a=permitted(await this.dependencies.account(accountId),'conversation_attachment'),r=await this.row(accountId,id)
    if(r.status!=='ready'||r.purpose!=='conversation_attachment'||r.chat_conversation_id!==conversationId||r.chat_client_message_id!==clientMessageId)throw missing()
    const binding=(await this.pool.query("SELECT message_version,media_version FROM media_conversation_grants WHERE account_id=$1 AND media_id=$2 AND conversation_id=$3 AND client_message_id=$4 AND state='active'",[accountId,id,conversationId,clientMessageId])).rows[0]
    if(!binding||binding.media_version!==r.version)throw missing()
    const refs=[{conversationId,clientMessageId,messageVersion:binding.message_version,mediaId:id,version:r.version}]
    if((await this.dependencies.validConversationPhotos(accountId,refs)).length!==1)throw missing()
    sameAuthority(a,await this.dependencies.account(accountId),'conversation_attachment')
    const current=await this.row(accountId,id)
    if(current.status!=='ready'||current.version!==r.version||current.authorization_version!==r.authorization_version)throw missing()
    return{a,r,sourceMessageVersion:binding.message_version as number,sourcePhotoVersion:undefined}
  }

  async reconcileConversation(r:MediaRow){
    const grant=(await this.pool.query("SELECT message_version,media_version,last_bound_at FROM media_conversation_grants WHERE account_id=$1 AND media_id=$2 AND state='active'",[r.account_id,r.id])).rows[0]
    const refs:ConversationRef[]=grant?[{conversationId:r.chat_conversation_id!,clientMessageId:r.chat_client_message_id!,messageVersion:grant.message_version,mediaId:r.id,version:grant.media_version}]:[]
    if(refs.length&&(await this.dependencies.validConversationPhotos(r.account_id,refs)).length){await this.pool.query("UPDATE media_conversation_grants SET confirmed_at=COALESCE(confirmed_at,clock_timestamp()) WHERE account_id=$1 AND media_id=$2 AND state='active'",[r.account_id,r.id]);return}
    const last=grant?.last_bound_at?.getTime()??0,cutoff=last||r.verified_at?.getTime()
    if(!cutoff||cutoff>=Date.now()-900000)return
    await this.tx(r.account_id,async db=>{
      const fresh=await this.row(r.account_id,r.id,db),current=(await db.query("SELECT last_bound_at FROM media_conversation_grants WHERE account_id=$1 AND media_id=$2 AND state='active'",[r.account_id,r.id])).rows[0]
      if(fresh.status!=='ready'||fresh.version!==r.version||(current?.last_bound_at?.getTime()??0)!==last)return
      await this.revoke(db,fresh,'SOURCE_REMOVED')
    },true)
  }

  async photoReplyContent(accountId:string,jobId:string,attemptId:string){
    const source=await this.dependencies.photoReplySource(accountId,jobId,attemptId)
    const check=(a:Account,s:PhotoReplySource)=>{
      permitted(a,'conversation_attachment')
      if(a.chatImageReplies?.allowed!==true)throw new MediaError(403,'CHAT_IMAGE_REPLY_PERMISSION_REQUIRED')
      if(a.accessVersion!==s.accountAccessVersion||a.storyStorage.authorizationVersion!==s.storyAuthorizationVersion||a.chatPhotoStorage!.authorizationVersion!==s.photoAuthorizationVersion||a.chatImageReplies.authorizationVersion!==s.imageAuthorizationVersion)throw new MediaError(409,'AUTHORIZATION_CHANGED')
    }
    const before=await this.conversationReadable(accountId,source.mediaId,source.conversationId,source.clientMessageId);check(before.a,source);capturedAuthority(before.a,before.r)
    if(before.r.version!==source.version||before.sourceMessageVersion!==source.messageVersion)throw missing()
    const bytes=await this.storage.get(before.r.object_key!,MAX_OUTPUT)
    if(bytes.length!==before.r.byte_size||hash(bytes)!==before.r.sha256)throw unavailable()
    const afterSource=await this.dependencies.photoReplySource(accountId,jobId,attemptId)
    if(hash(JSON.stringify(afterSource))!==hash(JSON.stringify(source)))throw new MediaError(409,'AUTHORIZATION_CHANGED')
    const after=await this.conversationReadable(accountId,source.mediaId,source.conversationId,source.clientMessageId);check(after.a,source);sameAuthority(before.a,after.a,'conversation_attachment')
    if(after.r.version!==before.r.version||after.r.authorization_version!==before.r.authorization_version)throw missing()
    return bytes
  }

  async bindGift(accountId:string,deliveryId:string,mediaId:string,photoVersion:number){
    const a=permitted(await this.dependencies.account(accountId),'gift_delivery_photo')
    await this.dependencies.giftTarget(accountId,deliveryId)
    const initial=await this.row(accountId,mediaId)
    if(initial.purpose!=='gift_delivery_photo'||initial.gift_delivery_id!==deliveryId||initial.status!=='ready')throw new MediaError(409,'PHOTO_SELECTION_INVALID')
    try{capturedAuthority(a,initial)}catch(error){
      if(!(error instanceof MediaError)||error.code!=='AUTHORIZATION_CHANGED')throw error
      // Regrant may reopen a current saved photo; it cannot accept an old,
      // unfinished capture intent that never became an authoritative source.
      const candidates=(await this.pool.query("SELECT photo_version,media_version FROM media_gift_grants WHERE account_id=$1 AND media_id=$2 AND state='active'",[accountId,mediaId])).rows
      let current=false
      for(let i=0;i<candidates.length;i+=100){
        const refs=candidates.slice(i,i+100).map(g=>({deliveryId,photoVersion:g.photo_version,mediaId,version:g.media_version}))
        if((await this.dependencies.validGiftPhotos(accountId,refs)).length){current=true;break}
      }
      if(!current)throw new MediaError(409,'PHOTO_SELECTION_INVALID')
    }
    const value=await this.tx(accountId,async db=>{
      const r=await this.row(accountId,mediaId,db)
      if(r.purpose!=='gift_delivery_photo'||r.gift_delivery_id!==deliveryId||r.status!=='ready'||r.version!==initial.version||r.authorization_version!==initial.authorization_version)throw new MediaError(409,'PHOTO_SELECTION_INVALID')
      const prior=(await db.query('SELECT state FROM media_gift_grants WHERE account_id=$1 AND media_id=$2 AND photo_version=$3',[accountId,mediaId,photoVersion])).rows[0]
      if(prior?.state==='revoked')throw new MediaError(409,'MEDIA_BINDING_CONFLICT')
      await db.query('INSERT INTO media_gift_grants(account_id,media_id,delivery_id,photo_version,media_version) VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_id,media_id,photo_version) DO UPDATE SET last_bound_at=clock_timestamp()',[accountId,mediaId,deliveryId,photoVersion,r.version])
      const expiresAt=(await db.query("SELECT clock_timestamp()+interval '60 seconds' AS expires_at")).rows[0].expires_at.toISOString()
      return{deliveryId,photoVersion,media:metadata(r),expiresAt}
    },true)
    sameAuthority(a,await this.dependencies.account(accountId),'gift_delivery_photo')
    await this.dependencies.giftTarget(accountId,deliveryId)
    return value
  }

  async reconcileGift(r:MediaRow){
    if(!r.gift_delivery_id)throw missing()
    const grants=(await this.pool.query("SELECT photo_version,media_version,last_bound_at FROM media_gift_grants WHERE account_id=$1 AND media_id=$2 AND state='active' ORDER BY photo_version",[r.account_id,r.id])).rows
    const valid=[]
    for(let i=0;i<grants.length;i+=100)valid.push(...await this.dependencies.validGiftPhotos(r.account_id,grants.slice(i,i+100).map(g=>({deliveryId:r.gift_delivery_id!,photoVersion:g.photo_version,mediaId:r.id,version:g.media_version}))))
    if(valid.length){for(const ref of valid)await this.pool.query("UPDATE media_gift_grants SET confirmed_at=COALESCE(confirmed_at,clock_timestamp()) WHERE account_id=$1 AND media_id=$2 AND photo_version=$3 AND state='active'",[r.account_id,r.id,ref.photoVersion]);return}
    const latest=grants.reduce((n,g)=>Math.max(n,g.last_bound_at.getTime()),0),cutoff=latest||r.verified_at?.getTime()
    if(!cutoff||cutoff>=Date.now()-900000)return
    await this.tx(r.account_id,async db=>{
      const fresh=await this.row(r.account_id,r.id,db),current=(await db.query("SELECT max(last_bound_at) AS latest FROM media_gift_grants WHERE account_id=$1 AND media_id=$2 AND state='active'",[r.account_id,r.id])).rows[0].latest
      if(fresh.status!=='ready'||fresh.version!==r.version||(current?.getTime()??0)!==latest)return
      await this.revoke(db,fresh,'SOURCE_REMOVED')
    },true)
  }

  async reconcilePerson(
    r: MediaRow & {
      last_bound_at?: Date
      confirmed_at?: Date
    },
  ) {
    if (!r.person_draft_id) throw missing()

    const valid = await this.personRefValid(
      r.account_id,
      r.id,
      r.person_draft_id,
      r.version,
    )

    if (valid) {
      await this.pool.query(
        "UPDATE media_person_grants SET confirmed_at=COALESCE(confirmed_at,clock_timestamp()) WHERE account_id=$1 AND media_id=$2 AND state='active'",
        [r.account_id, r.id],
      )

      return
    }

    // A bounded precommit grace protects failed/retried list writes. Checking the

    // bind timestamp again under the gate protects a newer concurrent prebind.

    const cutoff = r.last_bound_at ?? r.verified_at

    if (!cutoff || cutoff.getTime() >= Date.now() - 900000) return

    await this.tx(
      r.account_id,
      async (db) => {
        const fresh = await this.row(r.account_id, r.id, db)

        const grant = (
          await db.query(
            "SELECT last_bound_at FROM media_person_grants WHERE account_id=$1 AND media_id=$2 AND state='active'",
            [r.account_id, r.id],
          )
        ).rows[0]

        if (
          fresh.status !== "ready" ||
          fresh.version !== r.version ||
          (grant?.last_bound_at?.getTime() ?? null) !==
            (r.last_bound_at?.getTime() ?? null)
        )
          return

        await this.revoke(db, fresh, "SOURCE_REMOVED")
      },
      true,
    )
  }

  async revoke(db: PoolClient, r: MediaRow, reason?: string) {
    if (["revoked", "deleted"].includes(r.status)) return

    const next = (
      await db.query(
        "UPDATE media_objects SET status='revoked',version=version+1,authorization_version=authorization_version+1,revoked_at=clock_timestamp(),updated_at=clock_timestamp(),failure_code=COALESCE($3,failure_code) WHERE account_id=$1 AND id=$2 RETURNING version",

        [r.account_id, r.id, reason ?? null],
      )
    ).rows[0]

    await db.query("UPDATE media_conversation_grants SET state='revoked',revoked_at=clock_timestamp() WHERE account_id=$1 AND media_id=$2 AND state='active'",[r.account_id,r.id])
    await db.query(
      "UPDATE media_gift_grants SET state='revoked',revoked_at=clock_timestamp() WHERE account_id=$1 AND media_id=$2 AND state='active'",
      [r.account_id,r.id],
    )

    await db.query(
      "UPDATE media_person_grants SET state='revoked',revoked_at=clock_timestamp() WHERE account_id=$1 AND media_id=$2 AND state='active'",
      [r.account_id, r.id],
    )

    await db.query(
      "UPDATE media_use_grants SET state='revoked',revoked_at=clock_timestamp() WHERE account_id=$1 AND media_id=$2 AND state='active'",

      [r.account_id, r.id],
    )

    await db.query(
      "INSERT INTO media_jobs(id,account_id,media_id,kind,media_version) VALUES($1,$2,$3,'purge',$4) ON CONFLICT(account_id,media_id,kind) DO NOTHING",

      [randomUUID(), r.account_id, r.id, next.version],
    )
  }

  async remove(accountId: string, id: string, key: string, expected: number) {
    await this.dependencies.account(accountId)

    const fp = hash(JSON.stringify({ id, expected }))

    await this.tx(
      accountId,

      async (db) => {
        const r = await this.row(accountId, id, db)

        if (await this.command(db, accountId, "delete", key, id, fp)) return

        if (r.version !== expected)
          throw new MediaError(412, "VERSION_CONFLICT")

        if (
          (r.purpose === "person_photo" || r.purpose==='gift_delivery_photo'||r.purpose==='conversation_attachment') &&
          (
            await db.query(
              r.purpose==='conversation_attachment'?"SELECT 1 FROM media_conversation_grants WHERE account_id=$1 AND media_id=$2 AND state='active'":r.purpose==='gift_delivery_photo'?"SELECT 1 FROM media_gift_grants WHERE account_id=$1 AND media_id=$2 AND state='active'":"SELECT 1 FROM media_person_grants WHERE account_id=$1 AND media_id=$2 AND state='active'",
              [accountId, id],
            )
          ).rowCount
        )
          throw new MediaError(409, "MEDIA_IN_USE")

        await this.revoke(db, r)

        await this.record(db, accountId, "delete", key, id, fp)
      },

      true,
    )
  }

  async release(accountId: string, postId: string) {
    const fenced = (
      await this.pool.query(
        "SELECT erased_at FROM media_account_write_gates WHERE account_id=$1",

        [accountId],
      )
    ).rows[0]

    if (fenced?.erased_at) return { postId }

    await this.tx(
      accountId,

      async (db) => {
        const rows = (
          await db.query(
            "SELECT m.* FROM media_objects m JOIN media_use_grants u ON u.account_id=m.account_id AND u.media_id=m.id WHERE u.account_id=$1 AND u.post_id=$2 ORDER BY m.id",

            [accountId, postId],
          )
        ).rows

        for (const r of rows) await this.revoke(db, r, "SOURCE_REMOVED")
      },

      true,
    )

    return { postId }
  }

  async readable(
    session: Session,
    id: string,
    postId: string,
    purpose = "post_attachment",
    conversationId?:string,
  ) {
    if(purpose==='conversation_attachment')return this.conversationReadable(session.accountId,id,conversationId!,postId)
    const a = permitted(
        await this.dependencies.account(session.accountId),
        purpose,
      ),
      r = await this.row(session.accountId, id)

    if (r.status !== "ready" || r.purpose !== purpose) throw missing()

    if(purpose==='gift_delivery_photo'){
      if(r.gift_delivery_id!==postId)throw missing()
      const target=await this.dependencies.giftTarget(session.accountId,postId),sourcePhotoVersion=target.photoVersion
      const binding=(await this.pool.query("SELECT media_version FROM media_gift_grants WHERE account_id=$1 AND media_id=$2 AND delivery_id=$3 AND photo_version=$4 AND state='active'",[session.accountId,id,postId,sourcePhotoVersion])).rows[0]
      if(!binding||binding.media_version!==r.version)throw missing()
      const refs=[{deliveryId:postId,photoVersion:sourcePhotoVersion,mediaId:id,version:r.version}]
      if((await this.dependencies.validGiftPhotos(session.accountId,refs)).length!==1)throw missing()
      sameAuthority(a,await this.dependencies.account(session.accountId),purpose)
      const current=await this.row(session.accountId,id)
      if(current.version!==r.version||current.status!=='ready'||current.authorization_version!==r.authorization_version)throw missing()
      return{a,r,sourcePhotoVersion,sourceMessageVersion:undefined}
    }

    const binding = (
      await this.pool.query(
        purpose === "person_photo"
          ? "SELECT media_version FROM media_person_grants WHERE account_id=$1 AND media_id=$2 AND draft_id=$3 AND state='active'"
          : "SELECT media_version FROM media_use_grants WHERE account_id=$1 AND media_id=$2 AND post_id=$3 AND state='active'",

        [session.accountId, id, postId],
      )
    ).rows[0]

    if (!binding || binding.media_version !== r.version) throw missing()

    const refs = [{ postId, mediaId: id, version: r.version }],
      valid =
        purpose === "person_photo"
          ? await this.dependencies.validPersonPhotos(session.accountId, [
              { draftId: postId, mediaId: id, version: r.version },
            ])
          : await this.dependencies.validPosts(session.accountId, refs)

    if (valid.length !== 1) throw missing()

    sameAuthority(
      a,
      await this.dependencies.account(session.accountId),
      purpose,
    )

    const current = await this.row(session.accountId, id)

    if (
      current.version !== r.version ||
      current.status !== "ready" ||
      current.authorization_version !== r.authorization_version
    )
      throw missing()

    return { a, r,sourcePhotoVersion:undefined,sourceMessageVersion:undefined }
  }

  async readUrl(
    session: Session,
    id: string,
    postId: string,
    purpose = "post_attachment",
    conversationId?:string,
  ) {
    const { a, r,sourcePhotoVersion,sourceMessageVersion } = await this.readable(session, id, postId, purpose,conversationId),
      expiresAt = Date.now() + 60000,
      value = {
        v: 1,

        accountId: session.accountId,

        sessionId: session.sessionId,

        id,

        ...(purpose === "person_photo" ? { draftId: postId } : purpose==='gift_delivery_photo'?{deliveryId:postId,sourcePhotoVersion,giftStorageVersion:a.giftStorage!.authorizationVersion}:purpose==='conversation_attachment'?{conversationId,clientMessageId:postId,sourceMessageVersion}:{ postId }),

        purpose,

        mediaVersion: r.version,

        authorizationVersion: r.authorization_version,

        photoVersion: photoPermission(a, purpose)!.authorizationVersion,

        storageVersion: purpose==='gift_delivery_photo'?null:a.storyStorage.authorizationVersion,

        expiresAt,
      },
      encoded = Buffer.from(JSON.stringify(value)).toString("base64url"),
      signature = createHmac("sha256", this.config.proofKey)

        .update(encoded)

        .digest("base64url")

    return {
      mode: "authorized_stream",

      url: "/v1/media/" + id + "/content",

      expiresAt: new Date(expiresAt).toISOString(),

      authorizationVersion: r.authorization_version,

      readProof: encoded + "." + signature,
    }
  }

  async content(session: Session, id: string, proof: string) {
    if (proof.length > 2048) throw missing()

    const [encoded, sig, ...extra] = proof.split(".")

    if (extra.length || !encoded || !/^[A-Za-z0-9_-]{43}$/.test(sig ?? ""))
      throw missing()

    const expected = createHmac("sha256", this.config.proofKey)

        .update(encoded)

        .digest(),
      actual = Buffer.from(sig, "base64url")

    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw missing()

    let p: any

    try {
      p = JSON.parse(Buffer.from(encoded, "base64url").toString())
    } catch {
      throw missing()
    }

    if (
      p.v !== 1 ||
      p.accountId !== session.accountId ||
      p.sessionId !== session.sessionId ||
      p.id !== id ||
      !uuid.test(p.purpose === "person_photo" ? p.draftId : p.purpose==='gift_delivery_photo'?p.deliveryId:p.purpose==='conversation_attachment'?p.clientMessageId:p.postId) ||
      (p.purpose !== undefined &&
        !["post_attachment", "person_photo",'gift_delivery_photo','conversation_attachment'].includes(p.purpose)) ||
      (p.purpose==='conversation_attachment'&&(!uuid.test(p.conversationId)||p.sourceMessageVersion!==1)) ||
      (p.purpose==='gift_delivery_photo'&&(!positive(p.sourcePhotoVersion)||!positive(p.giftStorageVersion))) ||
      !positive(p.expiresAt) ||
      p.expiresAt <= Date.now() ||
      p.expiresAt > Date.now() + 61000
    )
      throw missing()

    const purpose = p.purpose ?? "post_attachment",
      targetId = purpose === "person_photo" ? p.draftId : purpose==='gift_delivery_photo'?p.deliveryId:purpose==='conversation_attachment'?p.clientMessageId:p.postId

    const { a, r,sourcePhotoVersion,sourceMessageVersion } = await this.readable(session, id, targetId, purpose,p.conversationId)

    if (
      p.mediaVersion !== r.version ||
      p.authorizationVersion !== r.authorization_version ||
      p.photoVersion !== photoPermission(a, purpose)!.authorizationVersion ||
      (purpose==='conversation_attachment'&&p.sourceMessageVersion!==sourceMessageVersion) ||
      (purpose==='gift_delivery_photo'?(p.giftStorageVersion!==a.giftStorage!.authorizationVersion||p.sourcePhotoVersion!==sourcePhotoVersion):p.storageVersion !== a.storyStorage.authorizationVersion)
    )
      throw missing()

    const bytes = await this.storage.get(r.object_key!, MAX_OUTPUT)

    if (bytes.length !== r.byte_size || hash(bytes) !== r.sha256)
      throw unavailable()

    const after = await this.readable(session, id, targetId, purpose,p.conversationId)

    sameAuthority(a, after.a, purpose)

    if (after.r.version !== r.version||after.sourcePhotoVersion!==sourcePhotoVersion||after.sourceMessageVersion!==sourceMessageVersion) throw missing()

    return bytes
  }
}
