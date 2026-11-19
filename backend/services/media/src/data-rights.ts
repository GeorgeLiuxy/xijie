import { MediaStore } from "./store.js"
import {exportVoices,voiceSnapshot} from './voice-rights.js'

import {
  MediaError,
  hash,
  MAX_OUTPUT,
  type MediaRow,
  type DataRequest,
} from "./contracts.js"

type ExportRow = MediaRow & {
  post_id: string | null

  position: number | null

  media_version: number | null

  draft_id: string | null
  gift_photo_version: number | null
  chat_message_version:number|null
}

export class MediaDataRights {
  constructor(readonly store: MediaStore) {}

  private async authorize(
    accountId: string,

    requestId: string,

    kind: "export" | "delete_account",

    scope?: string,
  ): Promise<DataRequest> {
    const r = await this.store.dependencies.dataRequest(requestId)

    if (
      r.accountId !== accountId ||
      r.requestId !== requestId ||
      r.kind !== kind ||
      (scope && r.scope !== scope) ||
      (kind === "export" && r.accountStatus !== "active") ||
      (kind === "delete_account" &&
        (r.scope !== "account_data" ||
          !["deletion_pending", "deleted"].includes(r.accountStatus)))
    )
      throw new MediaError(403, "FORBIDDEN")

    return r
  }

  private async snapshot(accountId: string) {
    return this.store.tx(accountId, async (db) => {
      const rows = (
        await db.query(
          "SELECT m.*,u.post_id,u.position,COALESCE(u.media_version,pg.media_version,gg.media_version,cg.media_version) AS media_version,u.state AS binding_state,pg.draft_id,pg.state AS person_binding_state,gg.photo_version AS gift_photo_version,gg.state AS gift_binding_state,cg.message_version AS chat_message_version,cg.state AS chat_binding_state FROM media_objects m LEFT JOIN media_use_grants u ON u.account_id=m.account_id AND u.media_id=m.id LEFT JOIN media_person_grants pg ON pg.account_id=m.account_id AND pg.media_id=m.id LEFT JOIN media_gift_grants gg ON gg.account_id=m.account_id AND gg.media_id=m.id LEFT JOIN media_conversation_grants cg ON cg.account_id=m.account_id AND cg.media_id=m.id WHERE m.account_id=$1 AND m.status='ready' AND(u.media_id IS NULL OR u.state='active') AND(pg.media_id IS NULL OR pg.state='active') AND(gg.media_id IS NULL OR gg.state='active') AND(cg.media_id IS NULL OR cg.state='active') ORDER BY m.id,gg.photo_version",

          [accountId],
        )
      ).rows.map(({ last_source_checked_at, ...row }) => row) as ExportRow[]

      const jobs = (
        await db.query(
          'SELECT id,media_id AS "mediaId",kind,state,version,attempt_count AS "attemptCount",failure_code AS "failureCode",created_at AS "createdAt",updated_at AS "updatedAt" FROM media_jobs WHERE account_id=$1 ORDER BY id',

          [accountId],
        )
      ).rows

      return { rows, jobs }
    })
  }

  async export(accountId: string, requestId: string, scope: string) {
    const before = await this.authorize(accountId, requestId, "export", scope),
      snapshot = await this.snapshot(accountId),
      refs = snapshot.rows

        .filter((r) => r.post_id)

        .map((r) => ({
          postId: r.post_id!,

          mediaId: r.id,

          version: r.version,
        })),
      valid = [] as typeof refs

    for (let i = 0; i < refs.length; i += 100)
      valid.push(
        ...(await this.store.dependencies.validPosts(
          accountId,

          refs.slice(i, i + 100),
        )),
      )

    const personRefs = snapshot.rows
      .filter((r) => r.purpose === "person_photo")
      .map((r) => ({
        draftId: r.person_draft_id!,
        mediaId: r.id,
        version: r.version,
      }))

    const personValid = [] as typeof personRefs

    for (let i = 0; i < personRefs.length; i += 100)
      personValid.push(
        ...(await this.store.dependencies.validPersonPhotos(
          accountId,
          personRefs.slice(i, i + 100),
        )),
      )

    const giftRefs=snapshot.rows.filter(r=>r.purpose==='gift_delivery_photo'&&r.gift_photo_version!==null).map(r=>({deliveryId:r.gift_delivery_id!,photoVersion:r.gift_photo_version!,mediaId:r.id,version:r.version})),giftValid=[] as typeof giftRefs
    for(let i=0;i<giftRefs.length;i+=100)giftValid.push(...await this.store.dependencies.validGiftPhotos(accountId,giftRefs.slice(i,i+100)))
    const chatRefs=snapshot.rows.filter(r=>r.purpose==='conversation_attachment'&&r.chat_message_version!==null).map(r=>({conversationId:r.chat_conversation_id!,clientMessageId:r.chat_client_message_id!,messageVersion:r.chat_message_version!,mediaId:r.id,version:r.version})),chatValid=[] as typeof chatRefs
    for(let i=0;i<chatRefs.length;i+=100)chatValid.push(...await this.store.dependencies.validConversationPhotos(accountId,chatRefs.slice(i,i+100)))

    const rows = snapshot.rows.filter(
      (r) =>
        r.purpose==='conversation_attachment'?chatValid.some(x=>x.conversationId===r.chat_conversation_id&&x.clientMessageId===r.chat_client_message_id&&x.messageVersion===r.chat_message_version&&x.mediaId===r.id&&x.version===r.version):r.purpose==='gift_delivery_photo'?giftValid.some(x=>x.deliveryId===r.gift_delivery_id&&x.photoVersion===r.gift_photo_version&&x.mediaId===r.id&&x.version===r.version):r.purpose === "person_photo"
          ? personValid.some(
              (x) =>
                x.draftId === r.person_draft_id &&
                x.mediaId === r.id &&
                x.version === r.version,
            )
          : !r.post_id ||
            valid.some(
              (x) =>
                x.postId === r.post_id &&
                x.mediaId === r.id &&
                x.version === r.version,
            ),
    )

    if (
      rows.reduce((n, r) => n + Math.ceil(r.byte_size! / 3) * 4 + 2048, 0) >
      20 * 1024 * 1024
    )
      throw new MediaError(413, "EXPORT_TOO_LARGE")

    const media = []

    for (const r of rows) {
      const bytes = await this.store.storage.get(r.object_key!, MAX_OUTPUT)

      if (bytes.length !== r.byte_size || hash(bytes) !== r.sha256)
        throw new MediaError(503, "DEPENDENCY_UNAVAILABLE")

      media.push({
        id: r.id,

        purpose: r.purpose,

        status: "ready",

        ...(r.purpose === "person_photo"
          ? { draftId: r.person_draft_id }
          : r.purpose==='gift_delivery_photo'?{deliveryId:r.gift_delivery_id,photoVersion:r.gift_photo_version}:r.purpose==='conversation_attachment'?{conversationId:r.chat_conversation_id,clientMessageId:r.chat_client_message_id,messageVersion:r.chat_message_version}:{ clientPostId: r.client_post_id }),

        mimeType: r.mime_type,

        byteSize: r.byte_size,

        width: r.width,

        height: r.height,

        version: r.version,

        authorizationVersion: r.authorization_version,

        sha256: r.sha256,

        bytesBase64: bytes.toString("base64"),

        createdAt: r.created_at.toISOString(),

        verifiedAt: r.verified_at!.toISOString(),
      })
    }

    const bindings = rows

        .filter((r) => r.post_id)

        .map((r) => ({
          mediaId: r.id,

          postId: r.post_id,

          position: r.position,

          mediaVersion: r.media_version,
        })),
      personBindings = rows
        .filter((r) => r.purpose === "person_photo")
        .map((r) => ({
          mediaId: r.id,
          draftId: r.person_draft_id!,
          mediaVersion: r.version,
        })),
      giftBindings=rows.filter(r=>r.purpose==='gift_delivery_photo').map(r=>({mediaId:r.id,deliveryId:r.gift_delivery_id!,photoVersion:r.gift_photo_version!,mediaVersion:r.version})),
      conversationBindings=rows.filter(r=>r.purpose==='conversation_attachment').map(r=>({mediaId:r.id,conversationId:r.chat_conversation_id!,clientMessageId:r.chat_client_message_id!,messageVersion:r.chat_message_version!,mediaVersion:r.version})),
      voiceExport=await exportVoices(this.store,accountId),
      data = { media, bindings, personBindings,giftBindings,conversationBindings, jobs: snapshot.jobs,...voiceExport.data }

    if (Buffer.byteLength(JSON.stringify(data)) > 20 * 1024 * 1024)
      throw new MediaError(413, "EXPORT_TOO_LARGE")

    const after = await this.authorize(accountId, requestId, "export", scope)

    if (
      after.accountAccessVersion !== before.accountAccessVersion ||
      hash(JSON.stringify(snapshot)) !==
        hash(JSON.stringify(await this.snapshot(accountId)))
      ||voiceExport.revision!==hash(JSON.stringify(await voiceSnapshot(this.store,accountId)))
    )
      throw new MediaError(409, "EXPORT_STALE")

    for (let i = 0; i < bindings.length; i += 100) {
      const page = bindings

          .slice(i, i + 100)

          .map((r) => ({
            postId: r.postId!,

            mediaId: r.mediaId,

            version: r.mediaVersion!,
          })),
        current = await this.store.dependencies.validPosts(accountId, page)

      if (current.length !== page.length)
        throw new MediaError(409, "EXPORT_STALE")
    }

    for (let i = 0; i < personBindings.length; i += 100) {
      const page = personBindings
        .slice(i, i + 100)
        .map((r) => ({
          draftId: r.draftId,
          mediaId: r.mediaId,
          version: r.mediaVersion,
        }))

      if (
        (await this.store.dependencies.validPersonPhotos(accountId, page))
          .length !== page.length
      )
        throw new MediaError(409, "EXPORT_STALE")
    }

    for(let i=0;i<giftBindings.length;i+=100){const page=giftBindings.slice(i,i+100).map(r=>({deliveryId:r.deliveryId,photoVersion:r.photoVersion,mediaId:r.mediaId,version:r.mediaVersion}));if((await this.store.dependencies.validGiftPhotos(accountId,page)).length!==page.length)throw new MediaError(409,'EXPORT_STALE')}
    for(let i=0;i<conversationBindings.length;i+=100){const page=conversationBindings.slice(i,i+100).map(r=>({conversationId:r.conversationId,clientMessageId:r.clientMessageId,messageVersion:r.messageVersion,mediaId:r.mediaId,version:r.mediaVersion}));if((await this.store.dependencies.validConversationPhotos(accountId,page)).length!==page.length)throw new MediaError(409,'EXPORT_STALE')}

    return {
      schemaVersion: 1,

      domain: "media",

      accountId,

      capturedAt: new Date().toISOString(),

      revision: hash(JSON.stringify(data)),

      data,
    }
  }

  async erase(accountId: string, requestId: string) {
    await this.authorize(accountId, requestId, "delete_account")

    const db = await this.store.pool.connect()

    let already = false,
      erasedAt: string

    try {
      await db.query("BEGIN")

      await db.query(
        "INSERT INTO media_account_write_gates(account_id) VALUES($1) ON CONFLICT DO NOTHING",

        [accountId],
      )

      const gate = (
        await db.query(
          "SELECT erased_at,request_id FROM media_account_write_gates WHERE account_id=$1 FOR UPDATE",

          [accountId],
        )
      ).rows[0]

      if (gate.erased_at && gate.request_id !== requestId)
        throw new MediaError(409, "IDEMPOTENCY_CONFLICT")

      const receipt = (
        await db.query(
          "SELECT state FROM media_erase_receipts WHERE account_id=$1",

          [accountId],
        )
      ).rows[0]

      already = receipt?.state === "completed"

      if (!gate.erased_at)
        gate.erased_at = (
          await db.query(
            "UPDATE media_account_write_gates SET erased_at=clock_timestamp(),request_id=$2,updated_at=clock_timestamp(),version=version+1 WHERE account_id=$1 RETURNING erased_at",

            [accountId, requestId],
          )
        ).rows[0].erased_at

      erasedAt = gate.erased_at.toISOString()

      await db.query(
        "INSERT INTO media_erase_receipts(account_id,request_id,state) VALUES($1,$2,'preparing') ON CONFLICT DO NOTHING",

        [accountId, requestId],
      )

      await db.query("COMMIT")
    } catch (e) {
      await db.query("ROLLBACK")

      throw e
    } finally {
      db.release()
    }

    if (already) return { accountId, requestId, erasedAt, alreadyErased: true }

    const busy = async () =>
      (
        await this.store.pool.query(
          "SELECT 1 FROM media_jobs WHERE account_id=$1 AND state='running' AND lease_until>clock_timestamp()-interval '20 seconds' UNION ALL SELECT 1 FROM media_upload_slots WHERE account_id=$1 AND state='uploading' AND lease_until>clock_timestamp()-interval '20 seconds' UNION ALL SELECT 1 FROM person_voice_jobs WHERE account_id=$1 AND state='running' AND lease_until>clock_timestamp()-interval '20 seconds' UNION ALL SELECT 1 FROM person_voice_upload_slots WHERE account_id=$1 AND state='uploading' AND lease_until>clock_timestamp()-interval '20 seconds'",

          [accountId],
        )
      ).rowCount

    if (await busy()) throw new MediaError(503, "MEDIA_CLEANUP_PENDING")

    const keys = [
      ...(await this.store.storage.list("staging/" + accountId + "/")),

      ...(await this.store.storage.list("ready/" + accountId + "/")),
      ...(await this.store.storage.list('staging-voices/'+accountId+'/')),
      ...(await this.store.storage.list('ready-voices/'+accountId+'/')),
    ]

    for (let i = 0; i < keys.length; i += 4)
      await Promise.all(
        keys.slice(i, i + 4).map((key) => this.store.storage.delete(key)),
      )

    if (
      (await this.store.storage.list("staging/" + accountId + "/")).length ||
      (await this.store.storage.list("ready/" + accountId + "/")).length
      ||(await this.store.storage.list('staging-voices/'+accountId+'/')).length
      ||(await this.store.storage.list('ready-voices/'+accountId+'/')).length
    )
      throw new MediaError(503, "MEDIA_CLEANUP_PENDING")

    await this.authorize(accountId, requestId, "delete_account")

    const final = await this.store.pool.connect()

    try {
      await final.query("BEGIN")

      const gate = (
        await final.query(
          "SELECT request_id FROM media_account_write_gates WHERE account_id=$1 FOR UPDATE",

          [accountId],
        )
      ).rows[0]

      if (gate?.request_id !== requestId || (await busy()))
        throw new MediaError(503, "MEDIA_CLEANUP_PENDING")

      for (const table of [
        'person_voice_commands','person_voice_jobs','person_voice_grants','person_voice_upload_slots','person_voice_assets',
        "media_commands",

        "media_jobs",

        "media_use_grants",

        "media_person_grants",
        "media_conversation_grants",
        "media_gift_grants",

        "media_upload_slots",

        "media_objects",
      ])
        await final.query("DELETE FROM " + table + " WHERE account_id=$1", [
          accountId,
        ])

      await final.query(
        "UPDATE media_erase_receipts SET state='completed',completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE account_id=$1 AND request_id=$2",

        [accountId, requestId],
      )

      await final.query("COMMIT")
    } catch (e) {
      await final.query("ROLLBACK")

      throw e
    } finally {
      final.release()
    }

    return { accountId, requestId, erasedAt, alreadyErased: false }
  }
}
