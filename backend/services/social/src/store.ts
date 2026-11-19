import type {AlbumStore} from './albums.js'
import { randomUUID } from "node:crypto"

import type { Pool, PoolClient } from "pg"

import {
  SocialError,
  conflict,
  forbidden,
  notFound,
  unavailable,
  digest,
  type PersonMeta,
  type Movement,
  type Post,
  type Comment,
  type PostInput,
  type CommentInput,
  type PagePosition,
  type FeedFilter,
  type PostMedia,
  type PostMediaRef,
  createInput,
} from "./contracts.js"

import type { ContextProvider, Account } from "./dependencies.js"
import type {EchoStore} from "./echo-store.js"
import type {VirtualWorldContext} from "./virtual-world.js"
import {photoPostId,postMediaMetadata} from './post-media.js'

type Db = Pool | PoolClient

type PostRow = {
  id: string
  account_id: string
  kind: "user" | "world_notice" | "memory_echo"
  status: "active" | "removed"
  body: string
  client_post_id: string | null
  request_hash: string | null
  person_id: string | null
  world_id: string | null
  source_movement_id: string | null
  source_world_version: number | null
  source_movement: Movement | null
  source_hash: string | null
  source_memory_id:string|null
  source_memory_version:number|null
  source_excerpt:string|null
  world_context_ref:VirtualWorldContext|null
  generation_job_id:string|null
  reaction_count: number
  comment_count: number
  version: number
  created_at: Date
  updated_at: Date
  removed_at: Date | null
}

type CommentRow = {
  id: string
  account_id: string
  post_id: string
  body: string
  author_kind?:"self"|"persona"
  person_id?:string
  display_name?:string
  generation_job_id?:string
  client_comment_id: string
  request_hash: string
  reply_to_comment_id: string | null
  status: "active" | "removed"
  version: number
  created_at: Date
  updated_at: Date
  removed_at: Date | null
}

const stable = (v: unknown): string =>
  v === null || typeof v !== "object"
    ? JSON.stringify(v)
    : Array.isArray(v)
      ? "[" + v.map(stable).join(",") + "]"
      : "{" +
        Object.keys(v)
          .sort()
          .map(
            (k) =>
              JSON.stringify(k) +
              ":" +
              stable((v as Record<string, unknown>)[k]),
          )
          .join(",") +
        "}"

const movementHash = (m: Movement) => digest(stable(m))

export class SocialStore {
  albums?:AlbumStore
  generations?:EchoStore
  queueSchema='social_queue'
  async validEchoMemory(accountId:string,personId:string,id:string,version:number){
    if(!this.dependencies.validMemories)throw unavailable();return (await this.dependencies.validMemories(accountId,personId,[{id,version}])).some(v=>v.id===id&&v.version===version)
  }
  constructor(
    readonly pool: Pool,
    readonly dependencies: ContextProvider,
  ) {}

  async access(accountId: string, storage = true) {
    const a = await this.dependencies.account(accountId)
    if (
      storage &&
      (!a.storyStorage.allowed || a.storyStorage.privateFeedAllowed !== true)
    )
      throw forbidden()
    return a
  }

  private sameAccount(a: Account, b: Account, storage = true) {
    if (
      a.accessVersion !== b.accessVersion ||
      (storage &&
        (a.storyStorage.authorizationVersion !==
          b.storyStorage.authorizationVersion ||
          !b.storyStorage.allowed ||
          b.storyStorage.privateFeedAllowed !== true))
    )
      throw forbidden()
  }

  private photoAccess(a:Account){if(!a.photoStorage?.allowed||!a.photoStorage.authorizationVersion)throw new SocialError(403,'PHOTO_PERMISSION_REQUIRED','Permission to save private photos is required.')}
  private samePhotoAccount(a:Account,b:Account){this.sameAccount(a,b);this.photoAccess(b);if(a.photoStorage?.authorizationVersion!==b.photoStorage?.authorizationVersion)throw new SocialError(403,'PHOTO_PERMISSION_REQUIRED','Photo permission changed.')}

  async validatePostMedia(accountId:string,refs:PostMediaRef[]){
    if(!refs.length)return []
    // Trusted source metadata only. User storage/AI permission and photo bytes are checked by Media.
    const rows=(await this.pool.query('SELECT pm.post_id,pm.media_id,pm.media_version FROM post_media pm JOIN posts p ON p.account_id=pm.account_id AND p.id=pm.post_id WHERE pm.account_id=$1 AND p.status=\'active\' AND p.kind=\'user\' AND EXISTS(SELECT 1 FROM jsonb_to_recordset($2::jsonb) AS r("postId" uuid,"mediaId" uuid,version integer) WHERE r."postId"=pm.post_id AND r."mediaId"=pm.media_id AND r.version=pm.media_version)',[accountId,JSON.stringify(refs)])).rows
    const valid=new Set(rows.map(r=>`${r.post_id}:${r.media_id}:${r.media_version}`));return refs.filter(r=>valid.has(`${r.postId}:${r.mediaId}:${r.version}`))
  }

  private async media(accountId:string,postId:string,db:Db=this.pool):Promise<PostMedia[]>{
    return (await db.query<PostMedia>('SELECT media_id AS id,media_version AS version,mime_type AS "mimeType",byte_size AS "byteSize",width,height FROM post_media WHERE account_id=$1 AND post_id=$2 ORDER BY position',[accountId,postId])).rows
  }

  async gate(db: Db, accountId: string, write = false) {
    if (write) {
      await db.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('xijie:social:erasure:'||$1,0))",
        [accountId],
      )
      await db.query(
        "INSERT INTO social_account_write_gates(account_id) VALUES($1) ON CONFLICT DO NOTHING",
        [accountId],
      )
    }

    const row = (
      await db.query(
        "SELECT erased_at FROM social_account_write_gates WHERE account_id=$1" +
          (write ? " FOR UPDATE" : " FOR SHARE"),
        [accountId],
      )
    ).rows[0]
    if (row?.erased_at) throw notFound()
  }

  private async transaction<T,>(
    accountId: string,
    run: (db: PoolClient) => Promise<T>,
  ) {
    const db = await this.pool.connect()
    try {
      await db.query("BEGIN")
      await this.gate(db, accountId, true)
      const result = await run(db)
      await db.query("COMMIT")
      return result
    } catch (e) {
      await db.query("ROLLBACK")
      throw e
    } finally {
      db.release()
    }
  }

  private async command(
    accountId: string,
    operation: string,
    target: string,
    key: string,
    hash: string,
    run: (db: PoolClient) => Promise<string>,
  ) {
    return this.transaction(accountId, async (db) => {
      const old = (
        await db.query(
          "SELECT request_hash,resource_id FROM social_commands WHERE account_id=$1 AND operation=$2 AND target=$3 AND idempotency_key=$4",
          [accountId, operation, target, key],
        )
      ).rows[0]
      if (old) {
        if (old.request_hash !== hash) throw conflict()
        return old.resource_id as string
      }
      const id = await run(db)
      await db.query(
        "INSERT INTO social_commands(account_id,operation,target,idempotency_key,request_hash,resource_id) VALUES($1,$2,$3,$4,$5,$6)",
        [accountId, operation, target, key, hash, id],
      )
      return id
    })
  }

  async row(
    accountId: string,
    id: string,
    db: Db = this.pool,
    removed = false,
  ) {
    const row = (
      await db.query<PostRow>(
        "SELECT * FROM posts WHERE account_id=$1 AND id=$2" +
          (removed ? "" : " AND status='active'"),
        [accountId, id],
      )
    ).rows[0]
    if (!row) throw notFound()
    return row
  }

  private async commentRow(
    accountId: string,
    postId: string,
    id: string,
    db: Db = this.pool,
    removed = false,
  ) {
    const row = (
      await db.query<CommentRow>(
        "SELECT * FROM post_comments WHERE account_id=$1 AND post_id=$2 AND id=$3" +
          (removed ? "" : " AND status='active'"),
        [accountId, postId, id],
      )
    ).rows[0]
    if (!row) throw notFound()
    return row
  }

  private commentDto(row: CommentRow): Comment {
    return {
      id: row.id,
      postId: row.post_id,
      author: row.author_kind==='persona'?{kind:'persona',personId:row.person_id!,displayName:row.display_name!,aiGenerated:true}:{ kind: "self" },
      ...(row.generation_job_id?{generationJobId:row.generation_job_id}:{}),
      body: row.body,
      ...(row.reply_to_comment_id
        ? { replyToCommentId: row.reply_to_comment_id }
        : {}),
      createdAt: row.created_at.toISOString(),
      version: row.version,
    }
  }

  private async visible(row: PostRow, known?: PersonMeta[]) {
    if (row.kind === "user") return undefined
    const people = known ?? (await this.dependencies.persons(row.account_id)),
      person = people.find((p) => p.id === row.person_id)
    if (!person) throw notFound()
    if(row.kind==='memory_echo'){if(!known&&!await this.validEchoMemory(row.account_id,person.id,row.source_memory_id!,row.source_memory_version!))throw notFound();return person}
    if (
      row.source_world_version! > person.worldVersion ||
      (row.source_world_version === person.worldVersion &&
        row.world_id !== person.worldId)
    )
      throw unavailable()
    if (!known) await this.validateSource(row, person)
    return person
  }

  async validateSource(
    row: {
      kind: string
      account_id: string
      person_id: string | null
      source_world_version: number | null
      source_movement_id: string | null
      source_hash: string | null

    },
    person: PersonMeta,
  ) {
    if (row.kind !== "world_notice") return
    const v = row.source_world_version!,
      page = await this.dependencies.movements(
        row.account_id,
        row.person_id!,
        v - 1,
        v,
        1,
      )
    if (
      page.person.accessVersion !== person.accessVersion ||
      page.items.length !== 1 ||
      page.items[0].id !== row.source_movement_id ||
      movementHash(page.items[0]) !== row.source_hash
    )
      throw unavailable()
  }

  private async dto(
    row: PostRow,
    people?: PersonMeta[],
    db: Db = this.pool,
  ): Promise<Post> {
    const person = await this.visible(row, people),
      comments = (
        await db.query<CommentRow>(
          "SELECT * FROM (SELECT * FROM post_comments WHERE account_id=$1 AND post_id=$2 AND status='active' ORDER BY created_at DESC,id DESC LIMIT 3) q ORDER BY created_at,id",
          [row.account_id, row.id],
        )
      ).rows
    const active =
      (
        await db.query(
          "SELECT active FROM post_reactions WHERE account_id=$1 AND post_id=$2",
          [row.account_id, row.id],
        )
      ).rows[0]?.active === true
    const movement = row.source_movement
    const media=await this.media(row.account_id,row.id,db)
    return {
      id: row.id,
      kind: row.kind,
      author:
        row.kind === "user"
          ? { kind: "self" }
          : row.kind==='memory_echo'?{kind:'persona',personId:person!.id,displayName:person!.displayName,aiGenerated:true}:{ kind: "system", worldId: row.world_id! },
      body:
        row.kind !== "world_notice"
          ? row.body
          : `${person!.displayName}从${movement!.fromWorld.displayName}迁往${movement!.toWorld.displayName}。`,
      mediaIds: media.map(item=>item.id),media,
      ...(row.kind==='memory_echo'?{personId:person!.id,worldId:row.world_id!,worldSnapshot:row.world_context_ref!.currentWorld,sourceMemoryId:row.source_memory_id!,sourceMemoryVersion:row.source_memory_version!,sourceMemory:{personId:person!.id,memoryId:row.source_memory_id!,version:row.source_memory_version!,excerpt:row.source_excerpt!}}:{}),
      ...(movement && person
        ? {
            personId: person.id,
            worldId: row.world_id!,
            sourceMovementId: movement.id,
            worldMovement: {
              ...movement,
              personId: person.id,
              personName: person.displayName,
              reality: "virtual" as const,
              branch: "main" as const,
            },
          }
        : {}),
      reactionCount: row.reaction_count,
      commentCount: row.comment_count,
      reactedByMe: active,
      reactionPreview: active ? [{ kind: "self" }] : [],
      commentPreview: comments.map((c) => this.commentDto(c)),
      createdAt: row.created_at.toISOString(),
      version: row.version,
    }
  }

  private async event(
    db: PoolClient,
    accountId: string,
    type: string,
    id: string,
    version: number,
    requestId: string,
  ) {
    await db.query(
      "INSERT INTO outbox_events(account_id,type,aggregate_id,aggregate_version,request_id,payload) VALUES($1,$2,$3,$4,$5,$6)",
      [
        accountId,
        type,
        id,
        version,
        requestId,
        { accountId, resourceId: id, version },
      ],
    )
  }

  private async updated(db: PoolClient, accountId: string, id: string) {
    return (
      await db.query<PostRow>(
        "UPDATE posts SET reaction_count=(SELECT count(*) FROM post_reactions WHERE account_id=$1 AND post_id=$2 AND active),comment_count=(SELECT count(*) FROM post_comments WHERE account_id=$1 AND post_id=$2 AND status='active'),version=version+1,updated_at=clock_timestamp() WHERE account_id=$1 AND id=$2 RETURNING *",
        [accountId, id],
      )
    ).rows[0]
  }

  async synchronize(accountId: string, people: PersonMeta[]) {
    let pages = 0
    for (const person of [...people].sort((a, b) => a.id.localeCompare(b.id))) {
      let cursor =
        (
          await this.pool.query(
            "SELECT last_projected_world_version FROM social_person_sync WHERE account_id=$1 AND person_id=$2",
            [accountId, person.id],
          )
        ).rows[0]?.last_projected_world_version ?? 1
      const horizon = person.worldVersion

      while (cursor < horizon) {
        if (++pages > 100)
          throw new SocialError(
            503,
            "SYNC_BUDGET_EXCEEDED",
            "The world feed is still synchronizing. Retry shortly.",
          )
        const page = await this.dependencies.movements(
          accountId,
          person.id,
          cursor,
          horizon,
          100,
        )

        if (
          page.person.accessVersion !== person.accessVersion ||
          page.items.length === 0 ||
          page.nextAfterVersion <= cursor ||
          page.nextAfterVersion > horizon
        )
          throw unavailable()

        await this.access(accountId)

        await this.transaction(accountId, async (db) => {
          await db.query(
            "INSERT INTO social_person_sync(account_id,person_id,person_access_version) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
            [accountId, person.id, person.accessVersion],
          )
          const sync = (
            await db.query(
              "SELECT * FROM social_person_sync WHERE account_id=$1 AND person_id=$2 FOR UPDATE",
              [accountId, person.id],
            )
          ).rows[0]
          if (sync.person_access_version !== person.accessVersion)
            throw unavailable()

          for (const item of page.items) {
            const hash = movementHash(item),
              existing = (
                await db.query<PostRow>(
                  "SELECT * FROM posts WHERE account_id=$1 AND (source_movement_id=$2 OR (person_id=$3 AND source_world_version=$4))",
                  [accountId, item.id, person.id, item.worldVersion],
                )
              ).rows[0]
            if (existing) {
              if (
                existing.source_hash !== hash ||
                existing.source_movement_id !== item.id ||
                existing.person_id !== person.id
              )
                throw unavailable()
              continue
            }
            if (item.worldVersion <= sync.last_projected_world_version)
              throw unavailable()
            const previous = (
              await db.query<PostRow>(
                "SELECT * FROM posts WHERE account_id=$1 AND person_id=$2 AND source_world_version=$3",
                [accountId, person.id, item.worldVersion - 1],
              )
            ).rows[0]
            if (
              item.worldVersion > 2 &&
              previous?.source_movement?.toWorld.id !== item.fromWorld.id
            )
              throw unavailable()
            await db.query(
              "INSERT INTO posts(account_id,kind,body,person_id,world_id,source_movement_id,source_world_version,source_movement,source_hash,created_at,updated_at) VALUES($1,'world_notice','',$2,$3,$4,$5,$6,$7,$8,GREATEST(clock_timestamp(),$8::timestamptz))",
              [
                accountId,
                person.id,
                item.toWorld.id,
                item.id,
                item.worldVersion,
                item,
                hash,
                item.occurredAt,
              ],
            )
          }

          if (sync.last_projected_world_version < page.nextAfterVersion)
            await db.query(
              "UPDATE social_person_sync SET last_projected_world_version=$3,version=version+1,updated_at=clock_timestamp() WHERE account_id=$1 AND person_id=$2",
              [accountId, person.id, page.nextAfterVersion],
            )
        })
        cursor = page.nextAfterVersion
      }
    }
  }

  async feed(
    accountId: string,
    filter: FeedFilter = {},
    before: PagePosition | undefined,
    limit: number,
    invalidPass=0,
  ):Promise<Post[]> {
    const account = await this.access(accountId),
      people = await this.dependencies.persons(accountId)
    if (filter.personId && !people.some((p) => p.id === filter.personId))
      throw notFound()
    await this.synchronize(accountId, people)
    const current = await this.dependencies.persons(accountId)
    this.sameAccount(account, await this.access(accountId))
    const db = await this.pool.connect()
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ")
      await this.gate(db, accountId)
      const rows = (
        await db.query<PostRow>(
          `SELECT * FROM posts WHERE account_id=$1 AND status='active' AND (kind='user' OR person_id=ANY($2::uuid[])) AND ($3::text IS NULL OR ($3='self' AND kind='user') OR ($3='person' AND person_id IS NOT NULL) OR ($3='world' AND kind='world_notice')) AND ($4::uuid IS NULL OR person_id=$4) AND ($5::uuid IS NULL OR world_id=$5) AND ($6::text IS NULL OR kind=$6) AND ($7::timestamptz IS NULL OR (created_at,id)<($7::timestamptz,$8::uuid)) ORDER BY created_at DESC,id DESC LIMIT $9`,
          [
            accountId,
            current.map((p) => p.id),
            filter.author ?? null,
            filter.personId ?? null,
            filter.worldId ?? null,
            filter.kind ?? null,
            before?.at ?? null,
            before?.id ?? null,
            limit,
          ],
        )
      ).rows
      const result: Post[] = []
      for (const row of rows){if(row.kind==='memory_echo')continue;result.push(await this.dto(row, current, db))}
      const echoRows=rows.filter(row=>row.kind==='memory_echo')
      await db.query("COMMIT")
      const invalidEchoIds:string[]=[]
      for(const row of echoRows){if(await this.validEchoMemory(row.account_id,row.person_id!,row.source_memory_id!,row.source_memory_version!))result.push(await this.dto(row,current));else invalidEchoIds.push(row.id)}
      if(invalidEchoIds.length){if(invalidPass>=10)throw unavailable();await this.transaction(accountId,async tx=>{await tx.query("UPDATE post_comments SET status='removed',removed_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE account_id=$1 AND post_id=ANY($2::uuid[]) AND status='active'",[accountId,invalidEchoIds]);await tx.query('DELETE FROM post_reactions WHERE account_id=$1 AND post_id=ANY($2::uuid[])',[accountId,invalidEchoIds]);await tx.query("UPDATE posts SET status='removed',removed_at=clock_timestamp(),updated_at=clock_timestamp(),reaction_count=0,comment_count=0,version=version+1 WHERE account_id=$1 AND id=ANY($2::uuid[]) AND status='active'",[accountId,invalidEchoIds])});return this.feed(accountId,filter,before,limit,invalidPass+1)}
      result.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||b.id.localeCompare(a.id))
      this.sameAccount(account, await this.access(accountId))
      const finalPeople = await this.dependencies.persons(accountId)
      if (
        digest(current.map((p) => [p.id, p.accessVersion])) !==
        digest(finalPeople.map((p) => [p.id, p.accessVersion]))
      )
        throw unavailable()
      for (const row of rows)
        if (row.kind === "world_notice")
          await this.validateSource(
            row,
            finalPeople.find((p) => p.id === row.person_id)!,
          )
      for(const row of echoRows)if(!await this.validEchoMemory(accountId,row.person_id!,row.source_memory_id!,row.source_memory_version!))throw unavailable()
      this.sameAccount(account, await this.access(accountId))
      return result
    } catch (e) {
      await db.query("ROLLBACK")
      throw e
    } finally {
      db.release()
    }
  }

  async detail(accountId: string, id: string, storage = true) {
    const a = await this.access(accountId, storage),
      source = await this.row(accountId, id),
      people =
        source.kind !== "user"
          ? await this.dependencies.persons(accountId)
          : undefined
    await this.visible(source, people)
    const db = await this.pool.connect()
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ")
      await this.gate(db, accountId)
      const row = await this.row(accountId, id, db),
        result = await this.dto(row, people, db)
      await db.query("COMMIT")
      this.sameAccount(a, await this.access(accountId, storage), storage)
      await this.visible(row)
      return result
    } catch (e) {
      await db.query("ROLLBACK")
      throw e
    } finally {
      db.release()
    }
  }

  async create(
    accountId: string,
    key: string,
    input: PostInput,
    requestId: string = randomUUID(),
  ) {
    input=createInput(input)
    const a = await this.access(accountId),
      hash = digest(input)
    // A successful old intent is read before any external binding or new write permission.
    const prior=(await this.pool.query<PostRow>('SELECT * FROM posts WHERE account_id=$1 AND client_post_id=$2',[accountId,input.clientPostId])).rows[0]
    if(prior){if(prior.request_hash!==hash)throw conflict();if(prior.status!=='active')throw notFound();return this.detail(accountId,prior.id)}
    const mediaIds=input.mediaIds??[]
    let media:PostMedia[]=[],stableId:string|undefined
    if(mediaIds.length){
      if(!this.dependencies.bindPostMedia)throw new SocialError(409,'MEDIA_NOT_AVAILABLE','Photo posting is not connected yet.')
      this.photoAccess(a);stableId=photoPostId(accountId,input.clientPostId)
      media=postMediaMetadata(await this.dependencies.bindPostMedia(accountId,stableId,input.clientPostId,mediaIds),mediaIds)
      this.samePhotoAccount(a,await this.access(accountId))
    }
    const id = await this.command(
      accountId,
      "create",
      input.clientPostId,
      key,
      hash,
      async (db) => {
        const old = (
          await db.query<PostRow>(
            "SELECT * FROM posts WHERE account_id=$1 AND client_post_id=$2",
            [accountId, input.clientPostId],
          )
        ).rows[0]
        if (old) {
          if (old.request_hash !== hash) throw conflict()
          if (old.status !== "active") throw notFound()
          return old.id
        }
        const row = (
          await db.query<PostRow>(
            "INSERT INTO posts(id,account_id,kind,body,client_post_id,request_hash) VALUES($1,$2,'user',$3,$4,$5) RETURNING *",
            [stableId??randomUUID(), accountId, input.body, input.clientPostId, hash],
          )
        ).rows[0]
        for(const [index,item] of media.entries())await db.query('INSERT INTO post_media(account_id,post_id,media_id,position,media_version,mime_type,byte_size,width,height) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[accountId,row.id,item.id,index+1,item.version,item.mimeType,item.byteSize,item.width,item.height])
        await this.event(
          db,
          accountId,
          "PostPublished.v1",
          row.id,
          row.version,
          requestId,
        )
        return row.id
      },
    )
    this.sameAccount(a, await this.access(accountId))
    if(mediaIds.length)this.samePhotoAccount(a,await this.access(accountId))
    return this.detail(accountId, id)
  }

  async remove(
    accountId: string,
    id: string,
    key: string,
    expected: number,
    requestId: string = randomUUID(),
  ) {
    await this.access(accountId, false)
    await this.command(
      accountId,
      "remove",
      id,
      key,
      digest({ expected }),
      async (db) => {
        const row = await this.row(accountId, id, db)
        if (row.kind !== "user")
          throw new SocialError(
            403,
            "FORBIDDEN",
            "World facts are controlled by their source.",
          )
        if (row.version !== expected)
          throw new SocialError(
            412,
            "VERSION_CONFLICT",
            "The post has changed.",
          )
        await db.query(
          "UPDATE post_comments SET status='removed',removed_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE account_id=$1 AND post_id=$2 AND status='active'",
          [accountId, id],
        )
        await db.query(
          "UPDATE post_reactions SET active=false,version=version+1,updated_at=clock_timestamp() WHERE account_id=$1 AND post_id=$2 AND active",
          [accountId, id],
        )
        const saved = (
          await db.query<PostRow>(
            "UPDATE posts SET status='removed',removed_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1,comment_count=0,reaction_count=0 WHERE account_id=$1 AND id=$2 RETURNING *",
            [accountId, id],
          )
        ).rows[0]
        await this.event(
          db,
          accountId,
          "PostRemoved.v1",
          id,
          saved.version,
          requestId,
        )
        return id
      },
    )
    const row = await this.row(accountId, id, this.pool, true)
    if((await this.media(accountId,id)).length&&this.dependencies.releasePostMedia){try{await this.dependencies.releasePostMedia(accountId,id)}catch{ /* Media independently reconciles removed or absent post targets. */ }}
    return {
      id,
      removedAt: row.removed_at!.toISOString(),
      version: row.version,
    }
  }

  async moderate(accountId:string,id:string,key:string,expected:number,reportId:string) {
    await this.access(accountId,false)
    await this.command(accountId,'moderate',id,key,digest({expected,reportId}),async db=>{
      const row=await this.row(accountId,id,db)
      if(row.version!==expected)throw new SocialError(412,'VERSION_CONFLICT','The post has changed.')
      await db.query("UPDATE post_comments SET status='removed',removed_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE account_id=$1 AND post_id=$2 AND status='active'",[accountId,id])
      await db.query("UPDATE post_reactions SET active=false,version=version+1,updated_at=clock_timestamp() WHERE account_id=$1 AND post_id=$2 AND active",[accountId,id])
      await db.query("UPDATE social_generation_jobs SET state='blocked',attempt_id=NULL,lease_until=NULL,retryable=false,failure_code='SOURCE_REMOVED',finished_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE account_id=$1 AND post_id=$2 AND state IN('queued','running','failed')",[accountId,id])
      const saved=(await db.query("UPDATE posts SET status='removed',removed_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1,comment_count=0,reaction_count=0 WHERE account_id=$1 AND id=$2 RETURNING version",[accountId,id])).rows[0]
      await this.event(db,accountId,'PostRemoved.v1',id,saved.version,key);return id
    })
    if(this.dependencies.releasePostMedia)try{await this.dependencies.releasePostMedia(accountId,id)}catch{/* Removed targets are independently invalidated by Media. */}
    return{subjectId:id,restricted:true as const}
  }

  async commentReviewSource(accountId: string, id: string) {
    const result = await this.pool.query<CommentRow>(
      "SELECT * FROM post_comments WHERE account_id=$1 AND id=$2 AND status='active'", [accountId, id],
    )
    const candidate = result.rows[0]
    if (!candidate) throw notFound()
    await this.detail(accountId, candidate.post_id)
    const row = await this.commentRow(accountId, candidate.post_id, id, this.pool)
    return {
      containerId: row.post_id, kind: row.author_kind, version: row.version,
      hash: digest([row.author_kind, row.body, row.reply_to_comment_id, row.generation_job_id]), body: row.body,
    }
  }

  async moderateComment(accountId: string, postId: string, id: string, key: string, expected: number, reportId: string, kind: string, hash: string) {
    await this.access(accountId, false)
    await this.command(accountId, 'moderate', id, key, digest({ postId, expected, reportId, kind, hash }), async db => {
      await this.row(accountId, postId, db)
      const source = await this.commentRow(accountId, postId, id, db)
      if (source.version !== expected || source.author_kind !== kind
        || digest([source.author_kind, source.body, source.reply_to_comment_id, source.generation_job_id]) !== hash)
        throw new SocialError(412, 'VERSION_CONFLICT', 'The comment has changed.')
      const hidden = await db.query<{ id: string }>(`
        WITH RECURSIVE descendants(id) AS (
          SELECT $3::uuid
          UNION
          SELECT c.id FROM post_comments c JOIN descendants d ON c.reply_to_comment_id=d.id
          WHERE c.account_id=$1 AND c.post_id=$2
        )
        UPDATE post_comments SET status='removed',removed_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
        WHERE account_id=$1 AND post_id=$2 AND status='active' AND id IN (SELECT id FROM descendants)
          AND (id=$3 OR author_kind='persona') RETURNING id
      `, [accountId, postId, id])
      await db.query(
        "UPDATE social_generation_jobs SET state='blocked',attempt_id=NULL,lease_until=NULL,retryable=false,failure_code='SOURCE_REMOVED',finished_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE account_id=$1 AND post_id=$2 AND source_comment_id=ANY($3::uuid[]) AND state IN('queued','running','failed')",
        [accountId, postId, hidden.rows.map(row => row.id)],
      )
      await this.updated(db, accountId, postId)
      await this.event(db, accountId, 'PostCommentRemoved.v1', id, source.version + 1, key)
      return id
    })
    return { subjectId: id, restricted: true as const }
  }

  async react(
    accountId: string,
    id: string,
    key: string,
    active: boolean,
    requestId: string = randomUUID(),
  ) {
    const a = await this.access(accountId)
    const source = await this.row(accountId, id)
    await this.visible(source)
    await this.command(
      accountId,
      "react",
      id,
      key,
      digest({ active }),
      async (db) => {
        await this.row(accountId, id, db)
        const old = (
          await db.query(
            "SELECT active FROM post_reactions WHERE account_id=$1 AND post_id=$2",
            [accountId, id],
          )
        ).rows[0]
        if ((old?.active === true) === active) return id
        await db.query(
          "INSERT INTO post_reactions(account_id,post_id,active) VALUES($1,$2,$3) ON CONFLICT(account_id,post_id) DO UPDATE SET active=EXCLUDED.active,version=post_reactions.version+1,updated_at=clock_timestamp()",
          [accountId, id, active],
        )
        const row = await this.updated(db, accountId, id)
        await this.event(
          db,
          accountId,
          "PostReactionChanged.v1",
          id,
          row.version,
          requestId,
        )
        return id
      },
    )
    this.sameAccount(a, await this.access(accountId))
    await this.visible(source)
    const post = await this.detail(accountId, id)
    return {
      active: post.reactedByMe,
      reactionCount: post.reactionCount,
      postVersion: post.version,
    }
  }

  async comments(
    accountId: string,
    id: string,
    after: PagePosition | undefined,
    limit: number,
  ) {
    const a = await this.access(accountId),
      source = await this.row(accountId, id)
    await this.visible(source)
    const db = await this.pool.connect()
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ")
      await this.gate(db, accountId)
      await this.row(accountId, id, db)
      const rows = (
        await db.query<CommentRow>(
          "SELECT * FROM post_comments WHERE account_id=$1 AND post_id=$2 AND status='active' AND ($3::timestamptz IS NULL OR (created_at,id)>($3::timestamptz,$4::uuid)) ORDER BY created_at,id LIMIT $5",
          [accountId, id, after?.at ?? null, after?.id ?? null, limit],
        )
      ).rows
      await db.query("COMMIT")
      this.sameAccount(a, await this.access(accountId))
      await this.visible(source)
      return rows.map((c) => this.commentDto(c))
    } catch (e) {
      await db.query("ROLLBACK")
      throw e
    } finally {
      db.release()
    }
  }

  async comment(
    accountId: string,
    id: string,
    key: string,
    input: CommentInput,
    requestId: string = randomUUID(),
  ) {
    const a = await this.access(accountId),
      source = await this.row(accountId, id)
    const speaker=await this.visible(source)
    const hash = digest({ postId: id, ...input }),
      commentId = await this.command(
        accountId,
        "comment",
        id,
        key,
        hash,
        async (db) => {
          await this.row(accountId, id, db)
          const old = (
            await db.query<CommentRow>(
              "SELECT * FROM post_comments WHERE account_id=$1 AND client_comment_id=$2",
              [accountId, input.clientCommentId],
            )
          ).rows[0]
          if (old) {
            if (old.request_hash !== hash) throw conflict()
            if (old.status !== "active") throw notFound()
            return old.id
          }
          if (input.replyToCommentId)
            await this.commentRow(accountId, id, input.replyToCommentId, db)
          const row = (
            await db.query<CommentRow>(
              "INSERT INTO post_comments(account_id,post_id,client_comment_id,request_hash,body,reply_to_comment_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
              [
                accountId,
                id,
                input.clientCommentId,
                hash,
                input.body,
                input.replyToCommentId ?? null,
              ],
            )
          ).rows[0]
          await this.updated(db, accountId, id)
          await this.generations?.admitComment(db,source,row,a,speaker)
          await this.event(
            db,
            accountId,
            "PostCommentCreated.v1",
            row.id,
            row.version,
            requestId,
          )
          return row.id
        },
      )
    this.sameAccount(a, await this.access(accountId))
    await this.visible(source)
    await this.row(accountId, id)
    return this.commentDto(await this.commentRow(accountId, id, commentId))
  }

  async removeComment(
    accountId: string,
    postId: string,
    id: string,
    key: string,
    expected: number,
    requestId: string = randomUUID(),
  ) {
    await this.access(accountId, false)
    const source = await this.row(accountId, postId)
    await this.visible(source)
    await this.command(
      accountId,
      "remove_comment",
      id,
      key,
      digest({ postId, expected }),
      async (db) => {
        await this.row(accountId, postId, db)
        const row = await this.commentRow(accountId, postId, id, db)
        if(row.author_kind==='persona')throw notFound()
        if (row.version !== expected)
          throw new SocialError(
            412,
            "VERSION_CONFLICT",
            "The comment has changed.",
          )
        await db.query(
          "UPDATE post_comments SET status='removed',removed_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE account_id=$1 AND id=$2",
          [accountId, id],
        )
        await this.updated(db, accountId, postId)
        await this.event(
          db,
          accountId,
          "PostCommentRemoved.v1",
          id,
          row.version + 1,
          requestId,
        )
        return id
      },
    )
    const row = await this.commentRow(accountId, postId, id, this.pool, true)
    return {
      id,
      removedAt: row.removed_at!.toISOString(),
      version: row.version,
    }
  }
}
