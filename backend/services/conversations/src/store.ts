import { createHash, randomUUID } from "node:crypto"
import type { Pool, PoolClient } from "pg"
import {
  ConversationError,
  notFound,
  uuid,
  type Conversation,
  type GenerationJob,
  type Message,
  type Summary,
  type TextInput,
  type JobState,
} from "./contracts.js"
import type {
  AccountContext,
  ContextProvider,
  PersonContext,
  MemoryUse,
} from "./dependencies.js"
import {giftMessage} from './gifts.js'
import {ConversationHistory} from './history.js'
import {LetterStore} from './letters.js'
import {GatherStore} from './gather.js'
import {PhotoStore} from './photo-store.js'
import {StoryStore} from './story-store.js'
import {WorldActions,type WorldActionContext} from './world-actions.js'
import {worldActionOutput} from './world-action-provider.js'
import type {WorldEventRef,WorldActionResult} from './world-action-contracts.js'
import {sameVirtualWorldUse,type VirtualWorldContext,type VirtualWorldUse} from './virtual-world.js'
import {needsCurrentSelfHarmSupport,SELF_HARM_SUPPORT_REQUIRED} from './conversation-safety.js'

export interface QueueSender {
  sendStory?(db:PoolClient,mode:'branch'|'offline',jobId:string,dispatchId:string,at:Date):Promise<void>
  isStoryPending?(db:PoolClient,mode:'branch'|'offline',jobId:string):Promise<boolean>
  sendPhoto?(db:PoolClient,jobId:string,dispatchId:string,at:Date):Promise<void>
  isPhotoPending?(db:PoolClient,jobId:string):Promise<boolean>
  sendGather?(db:PoolClient,jobId:string,personId:string,dispatchId:string,at:Date):Promise<void>
  isGatherPending?(db:PoolClient,jobId:string,personId:string):Promise<boolean>
  send(db: PoolClient, jobId: string, dispatchId: string): Promise<void>
  isPending?(db: PoolClient, jobId: string): Promise<boolean>
  sendLetter?(db: PoolClient, jobId:string, dispatchId:string, at:Date):Promise<void>
  isLetterPending?(db:PoolClient,jobId:string):Promise<boolean>
}
type ConversationRow = {
  id: string
  account_id: string
  person_id: string
  created_at: Date
  version: number
  kind:'direct'|'gather'
  world_id:string|null
}
export type MessageRow = {
  input_mode?:'typed'|'transcribed'|null
  source_domain?:'private_text'|'world_action_pending'|'virtual_action'|'virtual_context'
  conversation_kind:'direct'|'gather'
  gather_reply_job_id:string|null
  photo_reply_job_id?:string|null
  id: string
  account_id: string
  conversation_id: string
  sequence: string
  kind: "text" | "gift" | "photo"
  gift_delivery_id: string | null
  gift_received_id: string | null
  gift_projection: import("./gifts.js").GiftDelivery | import("./gifts.js").ReceivedGift | null
  author_kind: "self" | "persona"
  text: string
  client_message_id: string | null
  reply_to_message_id: string | null
  generation_job_id: string | null
  speaker_person_id: string | null
  display_name: string | null
  request_hash: string | null
  version: number
  created_at: Date
  removed_at: Date | null
}
export type JobRow = {
  world_action_authorization_version?:number|null
  world_action_decision?:'pending'|'chat'|'clarify'|'execute'|null
  world_event_context_refs?:WorldEventRef[]
  id: string
  account_id: string
  conversation_id: string
  person_id: string
  source_message_id: string
  state: JobState
  version: number
  attempt_id: string | null
  attempt_count: number
  lease_until: Date | null
  failure_code: string | null
  retryable: boolean
  reply_id: string | null
  person_version: number
  person_access_version: number
  account_access_version: number
  authorization_version: number
  ai_authorization_version: number
  created_at: Date
  updated_at: Date
}
export type Snapshot = {
  person: PersonContext
  account: AccountContext
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")
const date = (value: Date) => value.toISOString()
const conflict = (version: number) =>
  new ConversationError(412, "VERSION_CONFLICT", "The resource has changed.", {
    currentVersion: version,
  })
export function message(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sequence: row.sequence,
    kind: "text",
    text: row.text,
    author:
      row.author_kind === "self"
        ? { kind: "self" }
        : {
            kind: "persona",
            personId: row.speaker_person_id!,
            displayName: row.display_name!,
            aiGenerated: true,
          },
    createdAt: date(row.created_at),
    version: row.version,
    ...(row.source_domain&&row.source_domain!=='private_text'?{sourceDomain:row.source_domain==='virtual_action'?'virtual_action' as const:'virtual_context' as const,canSuggestMemory:false}:{}),
    ...(row.client_message_id
      ? { clientMessageId: row.client_message_id, inputMode: row.input_mode??"typed" }
      : {}),
    ...(row.reply_to_message_id
      ? { replyToMessageId: row.reply_to_message_id }
      : {}),
    ...(row.generation_job_id
      ? { generationJobId: row.generation_job_id }
      : {}),
    ...(row.photo_reply_job_id?{generationJobId:row.photo_reply_job_id,generationKind:'photo_reply' as const,canSuggestMemory:false}:{}),
    ...(row.gather_reply_job_id?{generationJobId:row.gather_reply_job_id,generationKind:'gather_reply' as const}:{}),
    ...(row.author_kind === "persona" ? { canSuggestMemory: false } : {}),
  }
}
export function job(row: JobRow): GenerationJob {
  return {
    id: row.id,
    kind: "chat_reply",
    targetId: row.conversation_id,
    state: row.state,
    version: row.version,
    ...(row.attempt_id ? { attemptId: row.attempt_id } : {}),
    replyIds: row.reply_id ? [row.reply_id] : [],
    ...(row.failure_code
      ? { failure: { code: row.failure_code, retryable: row.retryable } }
      : {}),
    updatedAt: date(row.updated_at),
  }
}
const conversation = (row: ConversationRow): Conversation => ({
  id: row.id,
  kind: "direct",
  personId: row.person_id,
  createdAt: date(row.created_at),
  version: row.version,
  canSend: true,
})
export class ConversationStore {
  readonly stories:StoryStore
  readonly worldActions:WorldActions
  readonly gather:GatherStore
  readonly photos:PhotoStore
  readonly letters:LetterStore
  constructor(
    readonly pool: Pool,
    readonly dependencies: ContextProvider,
    private readonly queue: QueueSender,
  ) {this.letters=new LetterStore(pool,dependencies,queue);this.gather=new GatherStore(pool,dependencies,queue);this.photos=new PhotoStore(pool,dependencies,queue);this.worldActions=new WorldActions(pool,dependencies);this.stories=new StoryStore(pool,dependencies,queue,this.worldActions)}
  private async tx<T,>(work: (db: PoolClient) => Promise<T>) {
    const db = await this.pool.connect()
    try {
      await db.query("BEGIN")
      const result = await work(db)
      await db.query("COMMIT")
      return result
    } catch (error) {
      await db.query("ROLLBACK")
      throw error
    } finally {
      db.release()
    }
  }
  private async event(
    db: PoolClient,
    type: string,
    accountId: string,
    id: string,
    version: number,
    payload: object,
    requestId: string,
  ) {
    await db.query(
      "INSERT INTO outbox_events(type,account_id,aggregate_type,aggregate_id,aggregate_version,request_id,payload) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        type,
        accountId,
        type === "GenerationChanged.v1" ? "generation_job" : type==='WorldActionCommitted.v1'?'person_world_event':"message",
        id,
        version,
        requestId,
        payload,
      ],
    )
  }
  private async command<T extends object,>(
    db: PoolClient,
    accountId: string,
    operation: string,
    target: string,
    key: string,
    input: unknown,
    run: () => Promise<T>,
  ): Promise<T> {
    const scope = [accountId, operation, target, key],
      requestHash = hash(input)
    const lock = await db.query<{ ok: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtextextended($1,6427303)) AS ok",
      [JSON.stringify(scope)],
    )
    if (!lock.rows[0].ok)
      throw new ConversationError(
        409,
        "REQUEST_IN_PROGRESS",
        "The same request is being processed.",
      )
    const prior = (
      await db.query<{
        request_hash: string
        response: T
      }>(
        "SELECT request_hash,response FROM conversation_commands WHERE account_id=$1 AND operation=$2 AND target=$3 AND idempotency_key=$4",
        scope,
      )
    ).rows[0]
    if (prior && prior.request_hash !== requestHash)
      throw new ConversationError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "The operation key was used for different input.",
      )
    const response = prior?.response ?? (await run())
    if (!prior)
      await db.query(
        "INSERT INTO conversation_commands(account_id,operation,target,idempotency_key,request_hash,response) VALUES($1,$2,$3,$4,$5,$6)",
        [...scope, requestHash, response],
      )
    return response
  }
  async visible(accountId: string, id: string): Promise<{
    conversation: Conversation
    person: PersonContext
  }> {
    const current = (
      await this.pool.query<ConversationRow>(
        "SELECT * FROM conversations WHERE account_id=$1 AND id=$2",
        [accountId, id],
      )
    ).rows[0]
    if (!current) throw notFound()
    if(current.kind==='gather')return {...await this.gather.visible(accountId,id),person:undefined as unknown as PersonContext}
    const person = await this.dependencies.person(accountId, current.person_id)
    return { conversation: conversation(current), person }
  }
  async snapshot(accountId: string, personId: string): Promise<Snapshot> {
    const [account, person] = await Promise.all([
      this.dependencies.account(accountId),
      this.dependencies.person(accountId, personId),
    ])
    return { account, person }
  }
  async sourceContext(accountId: string, id: string) {
    const row = (await this.pool.query<MessageRow & {person_id:string}>(
      'SELECT m.*,c.person_id FROM messages m JOIN conversations c ON c.account_id=m.account_id AND c.id=m.conversation_id WHERE m.account_id=$1 AND m.id=$2 AND m.removed_at IS NULL',
      [accountId,id],
    )).rows[0]
    if (!row || row.kind!=='text'||row.photo_reply_job_id||row.conversation_kind==='gather'||row.source_domain&&row.source_domain!=='private_text') throw notFound()
    const current = await this.snapshot(accountId,row.person_id)
    if (!current.account.storyStorage.allowed) throw new ConversationError(403,'FORBIDDEN','Reading this information is not permitted.')
    const stillVisible = await this.pool.query("SELECT id FROM messages WHERE account_id=$1 AND id=$2 AND version=$3 AND removed_at IS NULL AND source_domain='private_text'",[accountId,id,row.version])
    if (!stillVisible.rowCount) throw notFound()
    return {...message(row),accountId,personId:row.person_id}
  }
  async memorySourceContext(accountId: string, id: string) {
    const source = await this.sourceContext(accountId,id)
    if (source.author.kind !== 'persona' || !source.replyToMessageId) throw notFound()
    const rows = (await this.pool.query<MessageRow>(
      'SELECT * FROM messages WHERE account_id=$1 AND conversation_id=$2 AND id=ANY($3::uuid[]) AND removed_at IS NULL ORDER BY sequence',
      [accountId,source.conversationId,[source.replyToMessageId,source.id]],
    )).rows
    const parent = rows.find(row=>row.id===source.replyToMessageId)
    const reply = rows.find(row=>row.id===source.id)
    if (!parent || !reply || parent.kind!=='text' || reply.kind!=='text' || parent.photo_reply_job_id || reply.photo_reply_job_id || parent.source_domain!=='private_text'||reply.source_domain!=='private_text'|| parent.author_kind!=='self' || reply.author_kind!=='persona' || reply.version!==source.version || reply.reply_to_message_id!==parent.id || BigInt(parent.sequence)>=BigInt(reply.sequence)) throw notFound()
    return {source:{...message(reply),accountId,personId:source.personId},messages:rows.map(message)}
  }
  async ensure(accountId: string, personId: string, key: string) {
    await this.dependencies.person(accountId, personId)
    return this.tx((db) =>
      this.command(
        db,
        accountId,
        "create",
        personId,
        key,
        { personId },
        async () => {
          const result = await db.query<ConversationRow>(
            "INSERT INTO conversations(account_id,person_id) VALUES($1,$2) ON CONFLICT(account_id,person_id) DO NOTHING RETURNING *",
            [accountId, personId],
          )
          const created = !!result.rowCount
          const current =
            result.rows[0] ??
            (
              await db.query<ConversationRow>(
                "SELECT * FROM conversations WHERE account_id=$1 AND person_id=$2",
                [accountId, personId],
              )
            ).rows[0]
          return { conversation: conversation(current), created }
        },
      ),
    )
  }
  async summaries(accountId: string): Promise<Summary[]> {
    return new ConversationHistory(this.pool,this.dependencies,message,(a,id)=>this.photos.readMessage(a,id)).summaries(accountId)
  }
  async messages(accountId:string,id:string,direction:'older'|'newer',boundary:string|undefined,limit:number){
    return new ConversationHistory(this.pool,this.dependencies,message,(a,id)=>this.photos.readMessage(a,id)).messages(accountId,id,direction,boundary,limit)
  }
  async historyContext(accountId:string,id:string,anchorId:string,limit:number){
    return new ConversationHistory(this.pool,this.dependencies,message,(a,id)=>this.photos.readMessage(a,id)).context(accountId,id,anchorId,limit)
  }
  async searchHistory(accountId:string,needle:string,locale:string){
    return new ConversationHistory(this.pool,this.dependencies,message,(a,id)=>this.photos.readMessage(a,id)).search(accountId,needle,locale)
  }
  async latestSequence(accountId: string, id: string) {
    const result = await this.pool.query<{ sequence: string }>(
      "SELECT max(sequence)::text AS sequence FROM messages WHERE account_id=$1 AND conversation_id=$2 AND removed_at IS NULL",
      [accountId, id],
    )
    return result.rows[0]?.sequence ?? "0"
  }
  async send(
    accountId: string,
    id: string,
    key: string,
    input: TextInput,
    requestId: string,
  ) {
    const visible = await this.visible(accountId, id)
    if(visible.conversation.kind==='gather')return this.gather.send(accountId,id,key,input,requestId)
    const snapshot = await this.snapshot(accountId, visible.person.id)
    if (!snapshot.account.storyStorage.allowed)
      throw new ConversationError(
        403,
        "FORBIDDEN",
        "Permission to save private text is required.",
      )
    return this.tx(async (db) => {
      await db.query(
        "SELECT id FROM conversations WHERE account_id=$1 AND id=$2 FOR UPDATE",
        [accountId, id],
      )
      const accepted = await this.command(
        db,
        accountId,
        "send",
        id,
        key,
        input,
        async () => {
          const prior = (
            await db.query<MessageRow>(
              "SELECT * FROM messages WHERE account_id=$1 AND conversation_id=$2 AND client_message_id=$3",
              [accountId, id, input.clientMessageId],
            )
          ).rows[0]
          if (prior) {
            if (prior.request_hash !== hash(input))
              throw new ConversationError(
                409,
                "IDEMPOTENCY_CONFLICT",
                "The message ID was used for different input.",
              )
            if (prior.removed_at) throw notFound()
            return {
              message: message(prior),
              generationJobId: prior.generation_job_id!,
            }
          }
          this.requireAi(snapshot.account)
          const supportRequired=needsCurrentSelfHarmSupport(input.text)
          const actionPermission=snapshot.account.worldActionProcessing
          const actionVersion=!supportRequired&&actionPermission?.allowed===true?actionPermission.authorizationVersion:null
          const sequence = (
            await db.query<{ last_sequence: string }>(
              "UPDATE conversations SET last_sequence=last_sequence+1,version=version+1,updated_at=GREATEST(updated_at,clock_timestamp()::timestamptz(3)) WHERE account_id=$1 AND id=$2 RETURNING last_sequence",
              [accountId, id],
            )
          ).rows[0].last_sequence
          const jobId = randomUUID()
          const row = (
            await db.query<MessageRow>(
              `INSERT INTO messages(account_id,conversation_id,sequence,author_kind,text,client_message_id,generation_job_id,request_hash,source_domain,input_mode) VALUES($1,$2,$3,'self',$4,$5,$6,$7,$8,$9) RETURNING *`,
              [
                accountId,
                id,
                sequence,
                input.text,
                input.clientMessageId,
                jobId,
                hash(input),
                actionVersion?'world_action_pending':'private_text',
                input.inputMode,
              ],
            )
          ).rows[0]
          await db.query(
            `INSERT INTO generation_jobs(id,account_id,conversation_id,person_id,source_message_id,person_version,person_access_version,account_access_version,authorization_version,ai_authorization_version,world_action_authorization_version,world_action_decision,state,failure_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [
              jobId,
              accountId,
              id,
              visible.person.id,
              row.id,
              snapshot.person.version,
              snapshot.person.accessVersion,
              snapshot.account.accessVersion,
              snapshot.account.storyStorage.authorizationVersion,
              snapshot.account.aiTextProcessing.authorizationVersion,
              actionVersion,actionVersion?'pending':null,
              supportRequired?'blocked':'queued',supportRequired?SELF_HARM_SUPPORT_REQUIRED:null,
            ],
          )
          if(supportRequired)await this.event(db,'GenerationChanged.v1',accountId,jobId,1,{jobId,kind:'chat_reply',targetId:id,state:'blocked'},requestId)
          else await this.queue.send(db, jobId, randomUUID())
          await this.event(
            db,
            "MessageAccepted.v1",
            accountId,
            row.id,
            row.version,
            {
              conversationId: id,
              messageId: row.id,
              acceptedAt: date(row.created_at),
            },
            requestId,
          )
          return { message: message(row), generationJobId: jobId }
        },
      )
      const valid = await db.query(
        "SELECT id FROM messages WHERE account_id=$1 AND conversation_id=$2 AND id=$3 AND removed_at IS NULL",
        [accountId, id, accepted.message.id],
      )
      if (!valid.rowCount) throw notFound()
      return accepted
    })
  }
  private async jobRow(accountId: string, id: string) {
    const current = (
      await this.pool.query<JobRow>(
        "SELECT * FROM generation_jobs WHERE account_id=$1 AND id=$2",
        [accountId, id],
      )
    ).rows[0]
    if (!current) throw notFound()
    await this.visible(accountId, current.conversation_id)
    return current
  }
  async getJob(accountId: string, id: string) {
    return job(await this.jobRow(accountId, id))
  }
  async cancel(accountId: string, id: string, key: string, requestId: string) {
    await this.jobRow(accountId, id)
    return this.tx(async (db) => {
      const result = await this.command(
        db,
        accountId,
        "cancel",
        id,
        key,
        {},
        async () => {
          const current = (
            await db.query<JobRow>(
              "SELECT * FROM generation_jobs WHERE account_id=$1 AND id=$2 FOR UPDATE",
              [accountId, id],
            )
          ).rows[0]
          if (!current) throw notFound()
          if (current.state === "queued" || current.state === "running") {
            const canceled = (
              await db.query<JobRow>(
                `UPDATE generation_jobs SET state='canceled',version=version+1,lease_until=NULL,failure_code=NULL,retryable=false,updated_at=GREATEST(updated_at,clock_timestamp()::timestamptz(3)) WHERE id=$1 RETURNING *`,
                [id],
              )
            ).rows[0]
            await this.event(
              db,
              "GenerationChanged.v1",
              accountId,
              id,
              canceled.version,
              {
                jobId: id,
                kind: "chat_reply",
                targetId: current.conversation_id,
                state: "canceled",
              },
              requestId,
            )
            return job(canceled)
          }
          return job(current)
        },
      )
      // A cached cancellation response must not hide later authoritative state.
      const current = (
        await db.query<JobRow>(
          "SELECT * FROM generation_jobs WHERE account_id=$1 AND id=$2",
          [accountId, id],
        )
      ).rows[0]
      return { ...result, ...job(current) }
    })
  }
  async retry(accountId: string, id: string, key: string, requestId: string) {
    const prior = await this.jobRow(accountId, id),
      snapshot = await this.snapshot(accountId, prior.person_id)
    if (!snapshot.account.storyStorage.allowed)
      throw new ConversationError(
        403,
        "FORBIDDEN",
        "Permission to process private text is required.",
      )
    return this.tx(async (db) => {
      await this.command(db, accountId, "retry", id, key, {}, async () => {
        const current = (
          await db.query<JobRow>(
            "SELECT * FROM generation_jobs WHERE account_id=$1 AND id=$2 FOR UPDATE",
            [accountId, id],
          )
        ).rows[0]
        if (!current) throw notFound()
        if (current.state === "queued" || current.state === "running")
          return job(current)
        if (
          current.state !== "failed" ||
          !current.retryable ||
          current.attempt_count >= 3
        )
          throw new ConversationError(
            409,
            "GENERATION_NOT_RETRYABLE",
            "This task cannot be retried.",
          )
        const source = await db.query(
          "SELECT id FROM messages WHERE account_id=$1 AND conversation_id=$2 AND id=$3 AND removed_at IS NULL",
          [accountId, current.conversation_id, current.source_message_id],
        )
        if (!source.rowCount) throw notFound()
        this.requireAi(snapshot.account)
        if(current.world_action_authorization_version&&!this.validSnapshot(current,snapshot))throw new ConversationError(403,'WORLD_ACTION_PERMISSION_REQUIRED','This previously accepted virtual action can no longer be processed.')
        const queued = (
          await db.query<JobRow>(
            `UPDATE generation_jobs SET state='queued',version=version+1,attempt_id=NULL,lease_until=NULL,failure_code=NULL,retryable=false,person_version=$2,person_access_version=$3,account_access_version=$4,authorization_version=$5,ai_authorization_version=$6,updated_at=GREATEST(updated_at,clock_timestamp()::timestamptz(3)) WHERE id=$1 RETURNING *`,
            [
              id,
              snapshot.person.version,
              snapshot.person.accessVersion,
              snapshot.account.accessVersion,
              snapshot.account.storyStorage.authorizationVersion,
              snapshot.account.aiTextProcessing.authorizationVersion,
            ],
          )
        ).rows[0]
        await this.queue.send(db, id, randomUUID())
        await this.event(
          db,
          "GenerationChanged.v1",
          accountId,
          id,
          queued.version,
          {
            jobId: id,
            kind: "chat_reply",
            targetId: current.conversation_id,
            state: "queued",
          },
          requestId,
        )
        return job(queued)
      })
      // Idempotent replay keeps one dispatch but returns the task's current state.
      return job(
        (
          await db.query<JobRow>(
            "SELECT * FROM generation_jobs WHERE account_id=$1 AND id=$2",
            [accountId, id],
          )
        ).rows[0],
      )
    })
  }
  async removeMessage(
    accountId: string,
    conversationId: string,
    messageId: string,
    key: string,
    version: number,
    requestId: string,
  ) {
    if((await this.pool.query('SELECT kind FROM conversations WHERE account_id=$1 AND id=$2',[accountId,conversationId])).rows[0]?.kind==='gather')return this.gather.remove(accountId,conversationId,messageId,key,version,requestId)
    if((await this.pool.query('SELECT photo_reply_job_id FROM messages WHERE account_id=$1 AND conversation_id=$2 AND id=$3',[accountId,conversationId,messageId])).rows[0]?.photo_reply_job_id)return this.photos.remove(accountId,conversationId,messageId,key,version,requestId)
    await this.visible(accountId, conversationId)
    return this.tx(async (db) => {
      await db.query(
        "SELECT id FROM conversations WHERE account_id=$1 AND id=$2 FOR UPDATE",
        [accountId, conversationId],
      )
      return this.command(
        db,
        accountId,
        "remove",
        messageId,
        key,
        { conversationId, version },
        async () => {
          const current = (
            await db.query<MessageRow>(
              "SELECT * FROM messages WHERE account_id=$1 AND conversation_id=$2 AND id=$3 AND removed_at IS NULL FOR UPDATE",
              [accountId, conversationId, messageId],
            )
          ).rows[0]
          if (!current) throw notFound()
          if (current.version !== version) throw conflict(current.version)
          const removed = (
            await db.query<MessageRow>(
              "UPDATE messages SET removed_at=GREATEST(created_at,clock_timestamp()::timestamptz(3)),version=version+1 WHERE id=$1 RETURNING *",
              [messageId],
            )
          ).rows[0]
          await this.worldActions.invalidate(db,accountId,conversationId,messageId)
          const canceled = await db.query<JobRow>(
            `UPDATE generation_jobs SET state='canceled',lease_until=NULL,version=version+1,failure_code=NULL,retryable=false,updated_at=GREATEST(updated_at,clock_timestamp()::timestamptz(3)) WHERE account_id=$1 AND source_message_id=$2 AND state IN ('queued','running','failed') RETURNING *`,
            [accountId, messageId],
          )
          for (const task of canceled.rows)
            await this.event(
              db,
              "GenerationChanged.v1",
              accountId,
              task.id,
              task.version,
              {
                jobId: task.id,
                kind: "chat_reply",
                targetId: conversationId,
                state: "canceled",
              },
              requestId,
            )
          await this.event(
            db,
            current.kind==='gift'?"GiftMessageRemoved.v1":"MessageRemoved.v1",
            accountId,
            messageId,
            removed.version,
            { conversationId, messageId, removedAt: date(removed.removed_at!) },
            requestId,
          )
          return {
            id: messageId,
            removedAt: date(removed.removed_at!),
            version: removed.version,
          }
        },
      )
    })
  }
  async findJob(id: string) {
    return (
      (
        await this.pool.query<JobRow>(
          "SELECT * FROM generation_jobs WHERE id=$1",
          [id],
        )
      ).rows[0] ?? null
    )
  }
  async release(current: JobRow) {
    return this.tx(async (db) => {
      const released = (await db.query<JobRow>(
        `UPDATE generation_jobs SET state='queued',attempt_id=NULL,lease_until=NULL,version=version+1,failure_code=NULL,retryable=false,updated_at=GREATEST(updated_at,clock_timestamp()::timestamptz(3)) WHERE id=$1 AND state='running' AND attempt_id=$2 RETURNING *`,
        [current.id,current.attempt_id],
      )).rows[0]
      if(released)await this.event(db,'GenerationChanged.v1',released.account_id,released.id,released.version,{jobId:released.id,kind:'chat_reply',targetId:released.conversation_id,state:'queued'},released.id)
    })
  }
  async reconcileDeliveries() {
    if(!this.queue.isPending)throw new Error('Queue inspection is unavailable')
    return this.tx(async (db) => {
      const candidates=await db.query<JobRow>(`SELECT * FROM generation_jobs WHERE (state='running' AND lease_until<clock_timestamp()) OR (state='queued' AND updated_at<clock_timestamp()-interval '2 minutes') ORDER BY updated_at LIMIT 50 FOR UPDATE SKIP LOCKED`)
      for(const current of candidates.rows){
        if(await this.queue.isPending!(db,current.id))continue
        const terminal=(await db.query<JobRow>(`UPDATE generation_jobs SET state='failed',failure_code='DELIVERY_EXHAUSTED',retryable=$2,lease_until=NULL,version=version+1,updated_at=GREATEST(updated_at,clock_timestamp()::timestamptz(3)) WHERE id=$1 RETURNING *`,[current.id,current.attempt_count<3])).rows[0]
        await this.event(db,'GenerationChanged.v1',current.account_id,current.id,terminal.version,{jobId:current.id,kind:'chat_reply',targetId:current.conversation_id,state:'failed'},current.id)
      }
    })
  }
  async claim(id: string): Promise<JobRow | null> {
    return this.tx(async (db) => {
      const current = (
        await db.query<JobRow>(
          "SELECT * FROM generation_jobs WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0]
      if (!current || !["queued", "running"].includes(current.state))
        return null
      if (current.state === "running" && current.lease_until! > new Date())
        throw new Error("Generation lease is still active")
      if (current.attempt_count >= 3) {
        const exhausted = (
          await db.query<JobRow>(
            `UPDATE generation_jobs SET state='failed',failure_code='ATTEMPTS_EXHAUSTED',retryable=false,lease_until=NULL,version=version+1,updated_at=GREATEST(updated_at,clock_timestamp()::timestamptz(3)) WHERE id=$1 RETURNING *`,
            [id],
          )
        ).rows[0]
        await this.event(
          db,
          "GenerationChanged.v1",
          current.account_id,
          id,
          exhausted.version,
          {
            jobId: id,
            kind: "chat_reply",
            targetId: current.conversation_id,
            state: "failed",
          },
          id,
        )
        return null
      }
      const running = (
        await db.query<JobRow>(
          `UPDATE generation_jobs SET state='running',attempt_id=$2,attempt_count=attempt_count+1,lease_until=clock_timestamp()+interval '45 seconds',version=version+1,updated_at=GREATEST(updated_at,clock_timestamp()::timestamptz(3)) WHERE id=$1 RETURNING *`,
          [id, randomUUID()],
        )
      ).rows[0]
      await this.event(
        db,
        "GenerationChanged.v1",
        current.account_id,
        id,
        running.version,
        {
          jobId: id,
          kind: "chat_reply",
          targetId: current.conversation_id,
          state: "running",
        },
        id,
      )
      return running
    })
  }
  requireAi(account: AccountContext) {
    const permission = account.aiTextProcessing
    if (permission?.allowed !== true || !Number.isSafeInteger(permission.authorizationVersion) || permission.authorizationVersion < 1)
      throw new ConversationError(403, 'AI_PERMISSION_REQUIRED', 'Permission for AI text processing is required.')
  }
  validAiSnapshot(current: JobRow, snapshot: Snapshot) {
    const permission = snapshot.account.aiTextProcessing
    return permission?.allowed === true && Number.isSafeInteger(permission.authorizationVersion) && permission.authorizationVersion > 0 &&
      permission.authorizationVersion === current.ai_authorization_version
  }
  validSnapshot(current: JobRow, snapshot: Snapshot) {
    return (
      this.validAiSnapshot(current, snapshot) &&
      (!current.world_action_authorization_version||snapshot.account.worldActionProcessing?.allowed===true&&snapshot.account.worldActionProcessing.authorizationVersion===current.world_action_authorization_version)&&
      snapshot.account.storyStorage.allowed &&
      snapshot.account.storyStorage.authorizationVersion ===
        current.authorization_version &&
      snapshot.account.accessVersion === current.account_access_version &&
      snapshot.person.version === current.person_version &&
      snapshot.person.accessVersion === current.person_access_version
    )
  }
  snapshotFailure(current:JobRow,snapshot:Snapshot){
    if(!this.validAiSnapshot(current,snapshot))return 'AI_PERMISSION_REQUIRED'
    const grant=snapshot.account.worldActionProcessing
    if(current.world_action_authorization_version&&(!grant?.allowed||grant.authorizationVersion!==current.world_action_authorization_version))return 'WORLD_ACTION_PERMISSION_REQUIRED'
    return 'AUTHORIZATION_CHANGED'
  }
  async context(current: JobRow,world?:VirtualWorldContext,historyAllowed=false) {
    const result = await this.pool.query<MessageRow & {memory_context_refs:unknown;world_context_ref:unknown;world_event_context_refs:WorldEventRef[];context_job_state:string;event_id:string|null;event_world_id:string|null;event_world_version:number|null}>(
      `SELECT m.*,j.memory_context_refs,j.world_context_ref,j.world_event_context_refs,j.state AS context_job_state,e.id AS event_id,e.world_id AS event_world_id,e.world_version AS event_world_version FROM messages m
       LEFT JOIN generation_jobs j ON j.account_id=m.account_id AND j.conversation_id=m.conversation_id AND j.id=m.generation_job_id
       LEFT JOIN person_world_events e ON e.account_id=m.account_id AND e.job_id=j.id
       WHERE m.account_id=$1 AND m.conversation_id=$2 AND m.removed_at IS NULL AND m.kind='text' AND m.photo_reply_job_id IS NULL
        AND j.failure_code IS DISTINCT FROM $4
        AND m.sequence<=(SELECT anchor.sequence FROM messages anchor WHERE anchor.account_id=$1 AND anchor.conversation_id=$2 AND anchor.id=$3 AND anchor.removed_at IS NULL)
        AND (m.author_kind='self' OR EXISTS(SELECT 1 FROM messages parent WHERE parent.account_id=m.account_id AND parent.conversation_id=m.conversation_id AND parent.id=m.reply_to_message_id AND parent.author_kind='self' AND parent.removed_at IS NULL))
       ORDER BY m.sequence DESC LIMIT 20`,
      [current.account_id, current.conversation_id, current.source_message_id, SELF_HARM_SUPPORT_REQUIRED],
    )
    if (!result.rows.some((row) => row.id === current.source_message_id))
      throw notFound()
    const retained:MessageRow[]=[],verified=new Map<string,boolean>(),inherited=new Map<string,number>(),lineage=new Map<string,MemoryUse[]>()
    const worldLineage=new Map<string,WorldEventRef[]>(),inheritedEvents=new Set<string>(),verifiedEvents=new Map<string,boolean>()
    const validate=this.dependencies.validateAutomaticMemories?.bind(this.dependencies)
    for(const row of result.rows){
      if(historyAllowed&&row.author_kind==='persona'&&Array.isArray(row.memory_context_refs)&&row.memory_context_refs.some(value=>value?.kind==='automatic'&&value.sourceKind!=='message'))continue
      if(row.id!==current.source_message_id&&(row.source_domain!=='private_text'||row.world_event_context_refs?.length)){
        if(!current.world_action_authorization_version||!world||row.context_job_state!=='succeeded')continue
        // Past event summaries have a separate, attributed input channel. Neither
        // side of the old action/recall transcript becomes the new current scene.
        if(!sameVirtualWorldUse(row.world_context_ref,world))continue
        const refs=[...(row.world_event_context_refs??[]),...(row.event_id?[{id:row.event_id,version:1 as const,personId:current.person_id,worldId:row.event_world_id!,worldVersion:row.event_world_version!,reality:'virtual' as const,branch:'main' as const}]:[])].filter((r,i,rs)=>rs.findIndex(other=>other.id===r.id)===i)
        if(inheritedEvents.size+refs.filter(r=>!inheritedEvents.has(r.id)).length>24)continue
        const key=JSON.stringify(refs)
        if(!verifiedEvents.has(key))verifiedEvents.set(key,await this.worldActions.valid(current,world,refs,historyAllowed))
        if(!verifiedEvents.get(key))continue
        worldLineage.set(row.id,refs)
        for(const r of refs)inheritedEvents.add(r.id)
      }
      if(row.author_kind==='self'){retained.push(row);continue}
      // Keep displayed history intact; scene-bound assistant text must not
      // become the current scene after a move, including an A -> B -> A cycle.
      if(world&&(row.world_context_ref==null?world.worldVersion>1:!sameVirtualWorldUse(row.world_context_ref,world)))continue
      if(!Array.isArray(row.memory_context_refs))continue
      if(row.memory_context_refs.some(value=>!value||typeof value!=='object'||!['cherished','automatic'].includes(value.kind)))continue
      const automatic=row.memory_context_refs.filter(value=>value?.kind==='automatic')
      if(!automatic.length){retained.push(row);continue}
      const reference=(value:{id:string;version:number})=>!!value&&typeof value.id==='string'&&uuid.test(value.id)&&Number.isSafeInteger(value.version)&&value.version>0
      if(!validate||automatic.length>24||automatic.some(value=>!reference(value)||value.sourceKind!==undefined&&!['profile','message'].includes(value.sourceKind)||value.sourceId!==undefined&&(typeof value.sourceId!=='string'||!uuid.test(value.sourceId))||value.sourceVersion!==undefined&&(!Number.isSafeInteger(value.sourceVersion)||value.sourceVersion<1)||value.sources!==undefined&&(!Array.isArray(value.sources)||value.sources.length>7||value.sources.some((source:{id:string;version:number})=>!reference(source))))||new Set(automatic.map(value=>value.id)).size!==automatic.length)continue
      const refs=automatic.map(value=>({id:value.id as string,version:value.version as number})).sort((a,b)=>a.id.localeCompare(b.id)||a.version-b.version)
      // Prefer newer replies. A reply's lineage is indivisible: never partially
      // retain it after exhausting the inherited budget or mixing two versions.
      if(refs.some(ref=>inherited.has(ref.id)&&inherited.get(ref.id)!==ref.version)||inherited.size+refs.filter(ref=>!inherited.has(ref.id)).length>24)continue
      const key=JSON.stringify(refs)
      // Only exact references used by this historical reply matter; unrelated new
      // memories do not invalidate it. Reuse both positive and negative checks.
      if(!verified.has(key))verified.set(key,await validate(current.account_id,current.person_id,refs))
      if(verified.get(key)){
        retained.push(row)
        for(const ref of refs)inherited.set(ref.id,ref.version)
        lineage.set(row.id,automatic.map(value=>({kind:'automatic',id:value.id,version:value.version,
          ...(value.sourceKind!==undefined?{sourceKind:value.sourceKind}:{}),...(value.sourceId!==undefined?{sourceId:value.sourceId}:{}),
          ...(value.sourceVersion!==undefined?{sourceVersion:value.sourceVersion}:{}),
          ...(value.sources!==undefined?{sources:value.sources.map((source:{id:string;version:number})=>({id:source.id,version:source.version}))}:{}),
        })))
      }
    }
    return retained.reverse().map(row=>({...message(row),...(lineage.has(row.id)?{memoryContextRefs:lineage.get(row.id)!}:{}),...(worldLineage.has(row.id)?{worldEventContextRefs:worldLineage.get(row.id)!}:{})}))
  }
  async fail(
    current: JobRow,
    code: string,
    retryable: boolean,
    state: "failed" | "blocked" = "failed",
  ) {
    return this.tx(async (db) => {
      const result = await db.query<JobRow>(
        `UPDATE generation_jobs SET state=$3,failure_code=$4,retryable=$5,lease_until=NULL,version=version+1,updated_at=GREATEST(updated_at,clock_timestamp()::timestamptz(3)) WHERE id=$1 AND state='running' AND attempt_id=$2 RETURNING *`,
        [
          current.id,
          current.attempt_id,
          state,
          code,
          retryable && current.attempt_count < 3,
        ],
      )
      if (result.rows[0])
        await this.event(
          db,
          "GenerationChanged.v1",
          current.account_id,
          current.id,
          result.rows[0].version,
          {
            jobId: current.id,
            kind: "chat_reply",
            targetId: current.conversation_id,
            state,
          },
          current.id,
        )
      return !!result.rowCount
    })
  }
  async complete(
    current: JobRow,
    text: string,
    displayName: string,
    context: Pick<Message, "id" | "version">[],
    memoryUses:MemoryUse[]=[],
    worldUse?:VirtualWorldUse,
    worldAction?:{output:WorldActionResult;context:WorldActionContext},
  ) {
    const body = text.trim()
    if (
      !body ||
      [...body].length > 4000 ||
      body.includes("\0") ||
      /\p{Surrogate}/u.test(body)
    )
      throw new Error("Invalid generation output")
    // Recheck after the engine's other remote reads and immediately before local commit.
    // This remains an RPC boundary, not a cross-database atomic revocation claim.
    const latest = await this.snapshot(current.account_id, current.person_id)
    if (!this.validAiSnapshot(current, latest))
      throw new ConversationError(403, 'AI_PERMISSION_REQUIRED', 'AI text processing permission changed.')
    if (!this.validSnapshot(current, latest))
      throw new ConversationError(403, this.snapshotFailure(current,latest), 'The authorized generation context changed.')
    if(Boolean(current.world_action_authorization_version)!==Boolean(worldAction))throw new ConversationError(409,'CONTEXT_REVOKED','The virtual action generation mode changed.')
    if(worldAction&&memoryUses.length>64)throw new ConversationError(409,'CONTEXT_REVOKED','The virtual experience dependency budget was exceeded.')
    const historyAllowed=worldAction?.context.historyAllowed===true
    if(historyAllowed&&(latest.account.worldActionProcessing?.historicalWorldEventsAllowed!==true||memoryUses.some(use=>use.kind==='automatic'&&use.sourceKind!=='message')))throw new ConversationError(409,'CONTEXT_REVOKED','The historical event processing scope changed.')
    if(worldAction&&(!worldUse||!await this.worldActions.valid(current,worldUse,worldAction.context.refs,historyAllowed)))throw new ConversationError(409,'WORLD_EVENT_CONTEXT_CHANGED','The virtual experience changed.')
    if(this.dependencies.virtualWorld&&!worldUse)throw new ConversationError(409,'CONTEXT_REVOKED','The virtual scene reference is missing.')
    const automaticRefs=memoryUses.filter(value=>value.kind==='automatic').map(value=>({id:value.id,version:value.version}))
    if(automaticRefs.length&&(!this.dependencies.validateAutomaticMemories||!await this.dependencies.validateAutomaticMemories(current.account_id,current.person_id,automaticRefs)))
      throw new ConversationError(409,'CONTEXT_REVOKED','A memory used for this response was removed or changed.')
    if(worldUse){
      const world=await this.dependencies.virtualWorld?.(current.account_id,current.person_id)
      if(!world||world.personVersion!==current.person_version||!sameVirtualWorldUse(worldUse,world))throw new ConversationError(409,'CONTEXT_REVOKED','The virtual scene used for this response changed.')
    }
    return this.tx(async (db) => {
      await db.query(
        "SELECT id FROM conversations WHERE account_id=$1 AND id=$2 FOR UPDATE",
        [current.account_id, current.conversation_id],
      )
      const active = (
        await db.query<JobRow>(
          "SELECT * FROM generation_jobs WHERE id=$1 FOR UPDATE",
          [current.id],
        )
      ).rows[0]
      if (
        !active || active.state !== "running" ||
        active.attempt_id !== current.attempt_id ||
        active.lease_until! <= (await db.query<{now:Date}>('SELECT clock_timestamp() AS now')).rows[0].now
      )
        return false
      const source = await db.query<{id:string;text:string}>(
        "SELECT id,text FROM messages WHERE account_id=$1 AND conversation_id=$2 AND id=$3 AND removed_at IS NULL FOR SHARE",
        [
          current.account_id,
          current.conversation_id,
          current.source_message_id,
        ],
      )
      if (!source.rowCount) return false
      let actionDecision:ReturnType<typeof worldActionOutput>|undefined
      if(worldAction){
        const {provenance,...decision}=worldAction.output
        actionDecision=worldActionOutput(decision,source.rows[0].text)
        if(actionDecision.text!==body||!provenance||provenance.promptVersion!=='person-world-actions-v1'||typeof provenance.model!=='string'||!provenance.model||provenance.model.length>200||typeof provenance.responseId!=='string'||!provenance.responseId||provenance.responseId.length>300)throw new ConversationError(409,'CONTEXT_REVOKED','The model result provenance is invalid.')
        if(worldAction.context.revision!==await this.worldActions.revision(current,db)||!await this.worldActions.rows(current,worldUse!,worldAction.context.refs,db,historyAllowed))throw new ConversationError(409,'WORLD_EVENT_CONTEXT_CHANGED','The virtual experience changed before commit.')
      }
      const inputs = await db.query<{
        id: string
        version: number
      }>(
        "SELECT id,version FROM messages WHERE account_id=$1 AND conversation_id=$2 AND id=ANY($3::uuid[]) AND removed_at IS NULL FOR SHARE",
        [
          current.account_id,
          current.conversation_id,
          context.map((item) => item.id),
        ],
      )
      const versions = new Map(
        inputs.rows.map((item) => [item.id, item.version]),
      )
      if (
        context.length !== inputs.rowCount ||
        context.some((item) => versions.get(item.id) !== item.version)
      )
        throw new ConversationError(
          409,
          "CONTEXT_REVOKED",
          "A message used for this response was removed or changed.",
        )
      // Reference locks can wait beyond the initial lease check. The database
      // clock is checked after all locks and immediately before any side effect.
      if(active.lease_until! <= (await db.query<{now:Date}>('SELECT clock_timestamp() AS now')).rows[0].now)return false
      const sequence = (
        await db.query<{ last_sequence: string }>(
          "UPDATE conversations SET last_sequence=last_sequence+1,version=version+1,updated_at=GREATEST(updated_at,clock_timestamp()::timestamptz(3)) WHERE id=$1 RETURNING last_sequence",
          [current.conversation_id],
        )
      ).rows[0].last_sequence
      const reply = (
        await db.query<MessageRow>(
          `INSERT INTO messages(account_id,conversation_id,sequence,author_kind,text,reply_to_message_id,generation_job_id,speaker_person_id,display_name,source_domain) VALUES($1,$2,$3,'persona',$4,$5,$6,$7,$8,$9) RETURNING *`,
          [
            current.account_id,
            current.conversation_id,
            sequence,
            body,
            current.source_message_id,
            current.id,
            current.person_id,
            displayName,
            actionDecision?.decision==='execute'?'virtual_action':actionDecision&&(actionDecision.decision==='clarify'||worldAction!.context.refs.length>0)?'virtual_context':'private_text',
          ],
        )
      ).rows[0]
      const updated = (
        await db.query<JobRow>(
          `UPDATE generation_jobs SET state='succeeded',reply_id=$2,lease_until=NULL,version=version+1,failure_code=NULL,retryable=false,memory_context_refs=$3,world_context_ref=$4,world_action_decision=$5,world_event_context_refs=$6,world_action_message_refs=$7,world_event_revision=$8,world_action_provenance=$9,updated_at=GREATEST(updated_at,clock_timestamp()::timestamptz(3)) WHERE id=$1 RETURNING *`,
          [current.id,reply.id,JSON.stringify(memoryUses),worldUse?JSON.stringify(worldUse):null,actionDecision?.decision??null,JSON.stringify(worldAction?.context.refs??[]),JSON.stringify(worldAction?context.map(m=>({id:m.id,version:m.version})):[]),worldAction?.context.revision??null,worldAction?JSON.stringify(worldAction.output.provenance):null],
        )
      ).rows[0]
      if(worldAction){
        await db.query('UPDATE messages SET source_domain=$3 WHERE account_id=$1 AND id=$2',[current.account_id,current.source_message_id,reply.source_domain])
        if(actionDecision?.decision==='execute'){
          const event=await this.worldActions.commit(db,current,reply.id,worldUse!,worldAction.context,actionDecision.action)
          await this.event(db,'WorldActionCommitted.v1',current.account_id,event.id,event.version,{conversationId:current.conversation_id,personId:current.person_id,eventId:event.id,sourceMessageId:current.source_message_id,replyId:reply.id},current.id)
        }
      }
      await this.event(
        db,
        "ReplyCommitted.v1",
        current.account_id,
        reply.id,
        reply.version,
        {
          conversationId: current.conversation_id,
          messageId: reply.id,
          replyToMessageId: current.source_message_id,
          jobId: current.id,
          committedAt: date(reply.created_at),
        },
        current.id,
      )
      await this.event(
        db,
        "GenerationChanged.v1",
        current.account_id,
        current.id,
        updated.version,
        {
          jobId: current.id,
          kind: "chat_reply",
          targetId: current.conversation_id,
          state: "succeeded",
        },
        current.id,
      )
      return true
    })
  }
}
