import {albumExport,eraseAlbums} from './albums-rights.js'
import { timingSafeEqual } from "node:crypto"

import type { Request } from "express"

import type { SocialConfig } from "./config.js"

import type { SocialStore } from "./store.js"

import {
  SocialError,
  notFound,
  unavailable,
  identifier,
  object,
  digest,
  type ExportScope,
} from "./contracts.js"

export function rightsToken(config: SocialConfig, request: Request) {
  if (!config.dataRightsToken) throw notFound()
  const candidate = /^Bearer ([a-f0-9]{64})$/i.exec(
    request.get("Authorization") || "",
  )?.[1]
  if (
    !candidate ||
    !timingSafeEqual(
      Buffer.from(candidate, "hex"),
      Buffer.from(config.dataRightsToken, "hex"),
    )
  )
    throw new SocialError(
      403,
      "FORBIDDEN",
      "This data request is not authorized.",
    )
}

export class SocialDataRights {
  constructor(readonly store: SocialStore) {}

  async authorize(
    accountId: string,
    requestId: string,
    kind: "export" | "delete_account",
    scope?: ExportScope,
  ) {
    const ctx = await this.store.dependencies.dataRequest(requestId)
    if (
      ctx.accountId !== accountId ||
      ctx.requestId !== requestId ||
      ctx.kind !== kind ||
      (scope && ctx.scope !== scope) ||
      (kind === "export" && ctx.accountStatus !== "active") ||
      (kind === "delete_account" &&
        (ctx.scope !== "account_data" ||
          !["deletion_pending", "deleted"].includes(ctx.accountStatus)))
    )
      throw new SocialError(
        403,
        "FORBIDDEN",
        "The request does not authorize this operation.",
      )
    return ctx
  }

  async export(accountId: string, requestId: string, scope: ExportScope) {
    const before = await this.authorize(accountId, requestId, "export", scope),
      people = await this.store.dependencies.persons(accountId),
      ids = people.map((p) => p.id)
    const validAlbumAuthors:string[]=[]
    if((await this.store.pool.query("SELECT to_regclass('shared_albums') AS present")).rows[0].present)for(const row of(await this.store.pool.query('SELECT DISTINCT c.author_account_id AS id FROM shared_album_contributions c JOIN shared_albums a ON a.id=c.album_id WHERE a.account_id=$1 AND c.author_account_id IS NOT NULL',[accountId])).rows){try{await this.store.dependencies.account(row.id);validAlbumAuthors.push(row.id)}catch(e){if(!(e instanceof SocialError&&[401,403,404].includes(e.status)))throw e}}
    const validEchoIds:string[]=[]
    for(const r of (await this.store.pool.query("SELECT id,person_id,source_memory_id,source_memory_version FROM posts WHERE account_id=$1 AND kind='memory_echo' AND status='active'",[accountId])).rows){if(ids.includes(r.person_id)&&await this.store.validEchoMemory(accountId,r.person_id,r.source_memory_id,r.source_memory_version))validEchoIds.push(r.id)}
    const db = await this.store.pool.connect()
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ")
      await this.store.gate(db, accountId)
      const estimate = (
        await db.query(
          "SELECT COALESCE((SELECT sum(octet_length(to_jsonb(p)::text)) FROM posts p WHERE account_id=$1 AND status='active' AND (kind='user' OR person_id=ANY($2::uuid[]))),0)+COALESCE((SELECT sum(octet_length(to_jsonb(c)::text)) FROM post_comments c JOIN posts p ON p.account_id=c.account_id AND p.id=c.post_id WHERE c.account_id=$1 AND c.status='active' AND p.status='active' AND (p.kind='user' OR p.person_id=ANY($2::uuid[]))),0) bytes",
          [accountId, ids],
        )
      ).rows[0].bytes
      if (Number(estimate) > 20 * 1024 * 1024)
        throw new SocialError(
          413,
          "EXPORT_TOO_LARGE",
          "The export exceeds the supported size.",
        )
      const posts = (
          await db.query(
            'SELECT id,kind,body,person_id AS "personId",world_id AS "worldId",source_movement_id AS "sourceMovementId",source_world_version AS "sourceWorldVersion",source_hash AS "sourceHash",source_movement AS "worldMovement",source_memory_id AS "sourceMemoryId",source_memory_version AS "sourceMemoryVersion",source_excerpt AS "sourceExcerpt",world_context_ref AS "worldContext",generation_job_id AS "generationJobId",reaction_count AS "reactionCount",comment_count AS "commentCount",version,created_at AS "createdAt",updated_at AS "updatedAt" FROM posts WHERE account_id=$1 AND status=\'active\' AND (kind=\'user\' OR person_id=ANY($2::uuid[])) AND (kind<>\'memory_echo\' OR id=ANY($3::uuid[])) ORDER BY id',
            [accountId, ids,validEchoIds],
          )
        ).rows,
        postIds = posts.map((p) => p.id),
        comments = (
          await db.query(
            'SELECT id,post_id AS "postId",body,author_kind AS "authorKind",person_id AS "personId",display_name AS "displayName",generation_job_id AS "generationJobId",reply_to_comment_id AS "replyToCommentId",version,created_at AS "createdAt",updated_at AS "updatedAt" FROM post_comments WHERE account_id=$1 AND post_id=ANY($2::uuid[]) AND status=\'active\' ORDER BY id',
            [accountId, postIds],
          )
        ).rows,
        reactions = (
          await db.query(
            'SELECT post_id AS "postId",active,version,created_at AS "createdAt",updated_at AS "updatedAt" FROM post_reactions WHERE account_id=$1 AND post_id=ANY($2::uuid[]) ORDER BY post_id',
            [accountId, postIds],
          )
        ).rows,
        sync = (
          await db.query(
            'SELECT person_id AS "personId",last_projected_world_version AS "lastProjectedWorldVersion",person_access_version AS "personAccessVersion",version,created_at AS "createdAt",updated_at AS "updatedAt" FROM social_person_sync WHERE account_id=$1 AND person_id=ANY($2::uuid[]) ORDER BY person_id',
            [accountId, ids],
          )
        ).rows
      const generationJobs=(await db.query('SELECT id,kind,person_id AS "personId",memory_id AS "memoryId",memory_version AS "memoryVersion",state,version,post_id AS "postId",source_comment_id AS "sourceCommentId",result_id AS "resultId",world_context_ref AS "worldContext",context_comment_refs AS "commentRefs",created_at AS "createdAt",updated_at AS "updatedAt" FROM social_generation_jobs WHERE account_id=$1 AND person_id=ANY($2::uuid[]) ORDER BY id',[accountId,ids])).rows
      const postMedia=(await db.query('SELECT post_id AS "postId",media_id AS "mediaId",media_version AS version,position,mime_type AS "mimeType",byte_size AS "byteSize",width,height,created_at AS "createdAt" FROM post_media WHERE account_id=$1 AND post_id=ANY($2::uuid[]) ORDER BY post_id,position',[accountId,postIds])).rows
      const data = { posts, comments, reactions, worldSync: sync,generationJobs,postMedia,...await albumExport(db,accountId,validAlbumAuthors) }
      if (Buffer.byteLength(JSON.stringify(data)) > 20 * 1024 * 1024)
        throw new SocialError(
          413,
          "EXPORT_TOO_LARGE",
          "The export exceeds the supported size.",
        )
      await db.query("COMMIT")
      for(const id of validAlbumAuthors)await this.store.dependencies.account(id)
      if('sharedAlbums' in data&&JSON.stringify((await albumExport(this.store.pool,accountId,validAlbumAuthors)).sharedAlbums)!==JSON.stringify(data.sharedAlbums))throw new SocialError(409,'EXPORT_STALE','Shared album visibility changed during export.')
      const current = await this.store.dependencies.persons(accountId)
      for(const row of posts)if(row.kind==='memory_echo'&&!await this.store.validEchoMemory(accountId,row.personId,row.sourceMemoryId,row.sourceMemoryVersion))throw new SocialError(409,'EXPORT_STALE','The memory source changed.')
      for (const row of posts)
        if (row.kind === "world_notice") {
          const person = current.find((p) => p.id === row.personId)
          if (!person) throw unavailable()
          await this.store.validateSource(
            {
              kind: row.kind,
              account_id: accountId,
              person_id: row.personId,
              source_world_version: row.sourceWorldVersion,
              source_movement_id: row.sourceMovementId,
              source_hash: row.sourceHash,
            },
            person,
          )
        }
      const after = await this.authorize(accountId, requestId, "export", scope)
      if (
        before.accountAccessVersion !== after.accountAccessVersion ||
        digest(people) !== digest(current)
      )
        throw new SocialError(
          409,
          "EXPORT_STALE",
          "Source visibility changed while exporting.",
        )
      return {
        schemaVersion: 1,
        domain: "social" as const,
        accountId,
        capturedAt: new Date().toISOString(),
        revision: digest(data),
        data,
      }
    } catch (e) {
      await db.query("ROLLBACK")
      throw e
    } finally {
      db.release()
    }
  }

  private async albumCleanup(accountId:string){
    if(!(await this.store.pool.query("SELECT to_regclass('shared_album_source_cleanup') AS present")).rows[0].present)return
    if((await this.store.pool.query('SELECT 1 FROM shared_album_source_cleanup WHERE $1=ANY(erasing_account_ids) LIMIT 1',[accountId])).rowCount){if(!this.store.albums)throw unavailable();await this.store.albums.cleanupErasure(accountId)}
  }
  async erase(accountId: string, requestId: string) {
    await this.authorize(accountId, requestId, "delete_account")
    const db = await this.store.pool.connect()
    try {
      await db.query("BEGIN")
      await db.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('xijie:social:erasure:'||$1,0))",
        [accountId],
      )
      await db.query(
        "INSERT INTO social_account_write_gates(account_id) VALUES($1) ON CONFLICT DO NOTHING",
        [accountId],
      )
      const gate = (
        await db.query(
          "SELECT erased_at,request_id FROM social_account_write_gates WHERE account_id=$1 FOR UPDATE",
          [accountId],
        )
      ).rows[0]
      if (gate.erased_at) {
        if (gate.request_id !== requestId)
          throw new SocialError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "This account was erased by another request.",
          )
        await db.query("COMMIT")
        await this.albumCleanup(accountId)
        return {
          accountId,
          requestId,
          erasedAt: gate.erased_at.toISOString(),
          alreadyErased: true,
        }
      }
      const erasedAt = (
        await db.query(
          "UPDATE social_account_write_gates SET request_id=$2,erased_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE account_id=$1 RETURNING erased_at",
          [accountId, requestId],
        )
      ).rows[0].erased_at.toISOString()
      const jobs=(await db.query('SELECT id,dispatch_id FROM social_generation_jobs WHERE account_id=$1',[accountId])).rows,dispatchIds=jobs.map(r=>r.dispatch_id),jobIds=jobs.map(r=>r.id)
      await this.store.generations?.queue.erase?.(db,dispatchIds,jobIds)
      const queueSchema=this.store.queueSchema
      if(!/^[a-z_][a-z0-9_]{0,62}$/.test(queueSchema))throw unavailable()
      if((await db.query("SELECT to_regclass($1) AS present",[queueSchema+'.job'])).rows[0].present&&(dispatchIds.length||jobIds.length))await db.query('DELETE FROM "'+queueSchema+'".job WHERE name=$1 AND (id=ANY($2::uuid[]) OR data->>\'jobId\'=ANY($3::text[]))',['social.generate.v1',dispatchIds,jobIds])
      await eraseAlbums(db,accountId)
      for (const table of [
        "social_generation_jobs","social_memory_receipts","social_memory_sources",
        "outbox_events",
        "social_commands",
        "post_reactions",
        "post_comments",
        "post_media",
        "posts",
        "social_person_sync",
      ])
        await db.query("DELETE FROM " + table + " WHERE account_id=$1", [
          accountId,
        ])
      await db.query("COMMIT")
      await this.albumCleanup(accountId)
      return { accountId, requestId, erasedAt, alreadyErased: false }
    } catch (e) {
      await db.query("ROLLBACK")
      throw e
    } finally {
      db.release()
    }
  }
}
