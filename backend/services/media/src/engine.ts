import { randomUUID } from "node:crypto"

import { MediaStore, capturedAuthority } from "./store.js"

import { normalize } from "./normalize.js"

import {
  MediaError,
  missing,
  unavailable,
  hash,
  type MediaRow,
  type SlotRow,
} from "./contracts.js"

type Job = {
  id: string

  account_id: string

  media_id: string

  kind: "verify" | "purge"

  media_version: number

  attempt_id: string

  attempt_count: number

  lease_until: Date

  output_key: string | null

  state: string
}

export class MediaEngine {
  stopped = false

  constructor(readonly store: MediaStore) {}

  stop() {
    this.stopped = true
  }

  async claim(): Promise<Job | undefined> {
    if (this.stopped) return

    const attempt = randomUUID(),
      suffix = randomUUID()

    return (
      await this.store.pool.query(
        "WITH picked AS(SELECT j.id FROM media_jobs j JOIN media_account_write_gates g ON g.account_id=j.account_id WHERE g.erased_at IS NULL AND ((j.state IN('queued','failed') AND j.retry_at<=clock_timestamp()) OR(j.state='running' AND j.lease_until<=clock_timestamp())) AND(j.kind='purge' OR j.attempt_count<5) ORDER BY j.created_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1) UPDATE media_jobs j SET state='running',version=j.version+1,attempt_id=$1,attempt_count=j.attempt_count+1,lease_until=clock_timestamp()+interval '60 seconds',started_at=COALESCE(j.started_at,clock_timestamp()),updated_at=clock_timestamp(),failure_code=NULL,output_key=CASE WHEN j.kind='verify' THEN 'ready/'||j.account_id||'/'||j.media_id||'/'||$2 ELSE NULL END,output_keys=CASE WHEN j.kind='verify' THEN j.output_keys||('ready/'||j.account_id||'/'||j.media_id||'/'||$2) ELSE j.output_keys END FROM picked p WHERE j.id=p.id RETURNING j.*",

        [attempt, suffix],
      )
    ).rows[0]
  }

  async current(job: Job) {
    if (this.stopped) throw new MediaError(409, "PROCESSING_STOPPED")

    const found = (
      await this.store.pool.query(
        "SELECT 1 FROM media_jobs j JOIN media_objects m ON m.account_id=j.account_id AND m.id=j.media_id JOIN media_account_write_gates g ON g.account_id=j.account_id WHERE j.id=$1 AND j.attempt_id=$2 AND j.state='running' AND j.lease_until>clock_timestamp()+interval '20 seconds' AND g.erased_at IS NULL AND (j.kind='purge' OR(m.status='verifying' AND m.version=j.media_version))",

        [job.id, job.attempt_id],
      )
    ).rowCount

    if (!found) throw missing()
  }

  async authority(r: MediaRow) {
    capturedAuthority(await this.store.dependencies.account(r.account_id), r)

    if (r.purpose === "person_photo")
      await this.store.dependencies.personTarget(
        r.account_id,
        r.person_draft_id!,
      )
    if(r.purpose==='gift_delivery_photo')await this.store.dependencies.giftTarget(r.account_id,r.gift_delivery_id!)
    if(r.purpose==='conversation_attachment')await this.store.dependencies.conversationTarget(r.account_id,r.chat_conversation_id!)
  }

  private async finish(job: Job) {
    await this.store.pool.query(
      "UPDATE media_jobs SET state='succeeded',attempt_id=NULL,lease_until=NULL,version=version+1,finished_at=clock_timestamp(),updated_at=clock_timestamp(),failure_code=NULL WHERE id=$1 AND attempt_id=$2 AND state='running'",

      [job.id, job.attempt_id],
    )
  }

  private async reject(db: any, job: Job, code: string) {
    const row = (
      await db.query(
        "UPDATE media_objects SET status='rejected',failure_code=$3,version=version+1,updated_at=clock_timestamp() WHERE account_id=$1 AND id=$2 AND status='verifying' RETURNING version",

        [job.account_id, job.media_id, code],
      )
    ).rows[0]

    if (row)
      await db.query(
        "INSERT INTO media_jobs(id,account_id,media_id,kind,media_version) VALUES($1,$2,$3,'purge',$4) ON CONFLICT(account_id,media_id,kind) DO NOTHING",

        [randomUUID(), job.account_id, job.media_id, row.version],
      )
  }

  async run(job: Job) {
    let outputWritten = false

    try {
      await this.current(job)

      if (job.kind === "purge") {
        const busy = (
          await this.store.pool.query(
            "SELECT 1 FROM media_jobs WHERE account_id=$1 AND media_id=$2 AND kind='verify' AND state='running' AND lease_until>clock_timestamp() UNION ALL SELECT 1 FROM media_upload_slots WHERE account_id=$1 AND media_id=$2 AND state='uploading' AND lease_until>clock_timestamp()",

            [job.account_id, job.media_id],
          )
        ).rowCount

        if (busy) throw unavailable()

        await this.store.row(job.account_id, job.media_id)

        const slots = (
          await this.store.pool.query(
            "SELECT id,staging_key FROM media_upload_slots WHERE account_id=$1 AND media_id=$2 AND input_deleted_at IS NULL ORDER BY created_at,id",

            [job.account_id, job.media_id],
          )
        ).rows

        // Persist each removed input before advancing. A later lease resumes

        // with remaining slots, rather than spending every lease on old keys.

        for (const slot of slots) {
          await this.current(job)

          await this.store.storage.delete(slot.staging_key)

          await this.store.pool.query(
            "UPDATE media_upload_slots SET input_deleted_at=clock_timestamp(),cleanup_checked_at=clock_timestamp() WHERE account_id=$1 AND id=$2",

            [job.account_id, slot.id],
          )
        }

        const keys = await this.store.storage.list(
          "ready/" + job.account_id + "/" + job.media_id + "/",
        )

        for (const key of keys) {
          await this.current(job)

          await this.store.storage.delete(key)
        }

        await this.store.tx(job.account_id, async (db) => {
          const row = (
            await db.query(
              "SELECT 1 FROM media_jobs WHERE id=$1 AND attempt_id=$2 AND state='running' FOR UPDATE",

              [job.id, job.attempt_id],
            )
          ).rows[0]

          if (!row) return

          await db.query(
            "UPDATE media_upload_slots SET state='revoked',ended_at=COALESCE(ended_at,clock_timestamp()),attempt_id=NULL,lease_until=NULL,version=version+1 WHERE account_id=$1 AND media_id=$2 AND state NOT IN('replaced','expired','revoked')",

            [job.account_id, job.media_id],
          )

          await db.query(
            "UPDATE media_objects SET status=CASE WHEN status='revoked' THEN 'deleted' ELSE status END,object_key=NULL,mime_type=NULL,byte_size=NULL,sha256=NULL,width=NULL,height=NULL,deleted_at=CASE WHEN status='revoked' THEN clock_timestamp() ELSE deleted_at END,updated_at=clock_timestamp() WHERE account_id=$1 AND id=$2 AND status IN('revoked','rejected')",

            [job.account_id, job.media_id],
          )

          await db.query(
            "UPDATE media_jobs SET state='succeeded',attempt_id=NULL,lease_until=NULL,version=version+1,finished_at=clock_timestamp(),updated_at=clock_timestamp(),failure_code=NULL WHERE id=$1 AND attempt_id=$2 AND state='running'",

            [job.id, job.attempt_id],
          )
        })

        return
      }

      const m = await this.store.row(job.account_id, job.media_id)

      await this.authority(m)

      const slot = (
        await this.store.pool.query(
          "SELECT * FROM media_upload_slots WHERE account_id=$1 AND media_id=$2 AND state='completed' ORDER BY created_at DESC,id DESC LIMIT 1",

          [job.account_id, job.media_id],
        )
      ).rows[0] as SlotRow | undefined

      if (!slot) throw new MediaError(422, "MEDIA_UPLOAD_NOT_COMPLETE")

      const input = await this.store.storage.get(slot.staging_key)

      if (input.length !== m.declared_bytes || hash(input) !== m.input_sha256)
        throw new MediaError(422, "MEDIA_UPLOAD_MISMATCH")

      const out = await normalize(input, m.declared_mime)

      await this.authority(m)

      await this.current(job)

      await this.store.storage.put(job.output_key!, out.data, out.mime)

      outputWritten = true

      await this.authority(m)

      await this.current(job)

      await this.store.tx(job.account_id, async (db) => {
        const current = (
          await db.query(
            "SELECT * FROM media_jobs WHERE id=$1 AND attempt_id=$2 AND state='running' AND lease_until>clock_timestamp() FOR UPDATE",

            [job.id, job.attempt_id],
          )
        ).rows[0]

        if (!current) throw missing()

        const result = await db.query(
          "UPDATE media_objects SET status='ready',mime_type=$4,byte_size=$5,sha256=$6,width=$7,height=$8,object_key=$9,version=version+1,verified_at=clock_timestamp(),updated_at=clock_timestamp() WHERE account_id=$1 AND id=$2 AND version=$3 AND status='verifying' RETURNING id",

          [
            job.account_id,

            job.media_id,

            job.media_version,

            out.mime,

            out.data.length,

            hash(out.data),

            out.width,

            out.height,

            job.output_key,
          ],
        )

        if (!result.rowCount) throw missing()

        await db.query(
          "UPDATE media_jobs SET state='succeeded',attempt_id=NULL,lease_until=NULL,version=version+1,finished_at=clock_timestamp(),updated_at=clock_timestamp(),failure_code=NULL WHERE id=$1 AND attempt_id=$2",

          [job.id, job.attempt_id],
        )
      })

      outputWritten = false

      try {
        await this.store.storage.delete(slot.staging_key)

        await this.store.pool.query(
          "UPDATE media_upload_slots SET input_deleted_at=clock_timestamp(),cleanup_checked_at=clock_timestamp() WHERE account_id=$1 AND id=$2",

          [job.account_id, slot.id],
        )
      } catch {
        /* Durable slot cleanup below retries this deletion. */
      }
    } catch (e) {
      if (outputWritten && job.output_key)
        await this.store.storage.delete(job.output_key).catch(() => {})

      const problem =
          e instanceof MediaError
            ? e
            : new MediaError(503, "MEDIA_PROCESSING_FAILED"),
        terminal =
          job.kind === "verify" &&
          problem.code !== "PROCESSING_STOPPED" &&
          (problem.status < 500 || job.attempt_count >= 5)

      try {
        await this.store.tx(job.account_id, async (db) => {
          const owned = (
            await db.query(
              "SELECT 1 FROM media_jobs WHERE id=$1 AND attempt_id=$2 AND state='running' FOR UPDATE",

              [job.id, job.attempt_id],
            )
          ).rowCount

          if (!owned) return

          if (terminal) await this.reject(db, job, problem.code)

          await db.query(
            "UPDATE media_jobs SET state=$3,attempt_id=NULL,lease_until=NULL,version=version+1,failure_code=$4,retry_at=clock_timestamp()+interval '10 seconds',finished_at=CASE WHEN $3='blocked' THEN clock_timestamp() ELSE NULL END,updated_at=clock_timestamp() WHERE id=$1 AND attempt_id=$2",

            [
              job.id,

              job.attempt_id,

              terminal ? "blocked" : "failed",

              problem.code,
            ],
          )
        })
      } catch {
        await this.store.pool

          .query(
            "UPDATE media_jobs SET state='blocked',attempt_id=NULL,lease_until=NULL,version=version+1,failure_code='ACCOUNT_UNAVAILABLE',finished_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND attempt_id=$2 AND state='running'",

            [job.id, job.attempt_id],
          )

          .catch(() => {})
      }
    }
  }

  async cleanupInputs() {
    const rows = (
      await this.store.pool.query(
        "SELECT s.id,s.account_id,s.staging_key FROM media_upload_slots s JOIN media_objects m ON m.account_id=s.account_id AND m.id=s.media_id JOIN media_account_write_gates g ON g.account_id=s.account_id WHERE g.erased_at IS NULL AND s.input_deleted_at IS NULL AND s.state IN('completed','replaced','expired','revoked') AND(s.state<>'completed' OR m.status<>'verifying') AND(s.state='completed' OR s.ended_at<clock_timestamp()-interval '20 seconds') ORDER BY s.cleanup_checked_at NULLS FIRST,s.id LIMIT 20",
      )
    ).rows

    for (const r of rows) {
      try {
        await this.store.storage.delete(r.staging_key)

        await this.store.pool.query(
          "UPDATE media_upload_slots SET input_deleted_at=clock_timestamp(),cleanup_checked_at=clock_timestamp() WHERE account_id=$1 AND id=$2",

          [r.account_id, r.id],
        )
      } catch {
        await this.store.pool

          .query(
            "UPDATE media_upload_slots SET cleanup_checked_at=clock_timestamp() WHERE account_id=$1 AND id=$2",

            [r.account_id, r.id],
          )

          .catch(() => {})
      }
    }
  }

  async reconcile() {
    await this.cleanupInputs()

    const slots = (
      await this.store.pool.query(
        "SELECT s.id,s.account_id,s.media_id,s.staging_key FROM media_upload_slots s JOIN media_account_write_gates g ON g.account_id=s.account_id WHERE g.erased_at IS NULL AND s.state='uploading' AND s.lease_until<clock_timestamp()-interval '20 seconds' LIMIT 20",
      )
    ).rows

    for (const s of slots) {
      await this.store.storage.delete(s.staging_key)

      await this.store

        .tx(s.account_id, async (db) => {
          await db.query(
            "UPDATE media_upload_slots SET state='active',attempt_id=NULL,lease_until=NULL,version=version+1 WHERE account_id=$1 AND id=$2 AND state='uploading' AND lease_until<clock_timestamp()-interval '20 seconds'",

            [s.account_id, s.id],
          )
        })

        .catch(() => {})
    }

    const exhausted = (
      await this.store.pool.query(
        "SELECT j.* FROM media_jobs j JOIN media_account_write_gates g ON g.account_id=j.account_id WHERE g.erased_at IS NULL AND j.kind='verify' AND j.state='running' AND j.lease_until<clock_timestamp() AND j.attempt_count>=5 LIMIT 20",
      )
    ).rows

    for (const j of exhausted)
      await this.store

        .tx(j.account_id, async (db) => {
          await this.reject(db, j, "MEDIA_PROCESSING_FAILED")

          await db.query(
            "UPDATE media_jobs SET state='blocked',attempt_id=NULL,lease_until=NULL,failure_code='MEDIA_PROCESSING_FAILED',finished_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE id=$1 AND state='running' AND lease_until<clock_timestamp()",

            [j.id],
          )
        })

        .catch(() => {})

    const rows = (
      await this.store.pool.query(
        "SELECT m.*,u.post_id,u.media_version,u.confirmed_at,u.created_at AS binding_created_at,pg.last_bound_at FROM media_objects m JOIN media_account_write_gates g ON g.account_id=m.account_id LEFT JOIN media_use_grants u ON u.account_id=m.account_id AND u.media_id=m.id AND u.state='active' LEFT JOIN media_person_grants pg ON pg.account_id=m.account_id AND pg.media_id=m.id AND pg.state='active' WHERE g.erased_at IS NULL AND(m.status='ready' OR(m.status='awaiting_upload' AND m.updated_at<clock_timestamp()-interval '30 minutes')) ORDER BY m.last_source_checked_at NULLS FIRST,m.id LIMIT 50",
      )
    ).rows

    for (const r of rows) {
      if (this.stopped) break

      try {
        if (r.status === "awaiting_upload") {
          await this.store.tx(r.account_id, (db) =>
            this.store.revoke(db, r, "UPLOAD_EXPIRED"),
          )

          continue
        }

        if (r.purpose === "person_photo") {
          await this.store.reconcilePerson(r)

          continue
        }
        if(r.purpose==='gift_delivery_photo'){await this.store.reconcileGift(r);continue}
        if(r.purpose==='conversation_attachment'){await this.store.reconcileConversation(r);continue}

        if (r.post_id) {
          const valid = await this.store.dependencies.validPosts(r.account_id, [
            { postId: r.post_id, mediaId: r.id, version: r.media_version },
          ])

          if (valid.length) {
            if (!r.confirmed_at)
              await this.store.tx(r.account_id, async (db) => {
                await db.query(
                  "UPDATE media_use_grants SET confirmed_at=clock_timestamp() WHERE account_id=$1 AND media_id=$2 AND state='active' AND confirmed_at IS NULL",

                  [r.account_id, r.id],
                )
              })

            continue
          }

          if (
            r.confirmed_at ||
            r.binding_created_at.getTime() < Date.now() - 900000
          )
            await this.store.release(r.account_id, r.post_id)
        } else if (
          r.verified_at &&
          r.verified_at.getTime() < Date.now() - 900000
        )
          await this.store.tx(r.account_id, (db) =>
            this.store.revoke(db, r, "UNPUBLISHED_EXPIRED"),
          )
      } catch {
        /* Remote failure never proves a source was deleted. */
      } finally {
        await this.store.pool

          .query(
            "UPDATE media_objects SET last_source_checked_at=clock_timestamp() WHERE account_id=$1 AND id=$2",

            [r.account_id, r.id],
          )

          .catch(() => {})
      }
    }
  }
}
