import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"
import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  Delete,
  ExceptionFilter,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Module,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  type DynamicModule,
} from "@nestjs/common"
import type { Request, Response } from "express"
import type { ConversationConfig } from "./config.js"
import {
  ConversationError,
  directInput,
  invalid,
  notFound,
  textInput,
  photoInput,
  historyQuery,
  uuid,
  type Summary,
} from "./contracts.js"
import { ConversationStore } from "./store.js"
import { eraseInput, eraseConversations, exportConversations, rightsContext, rightsQuery, rightsToken } from './data-rights.js'
import {AutomaticSourceStore,automaticEventQuery,automaticReferences,emptyAutomaticBody} from './automatic-sources.js'
import {GiftProjectionStore} from './gifts.js'
import {branchInput,lifeInput} from './story-store.js'
import {letterInput,throughReply} from './letters.js'
import {ConversationReviewController} from './content-review.js'
import {VoiceCallsModule} from './voice-http.js'
import type {VoiceHub} from './voice-hub.js'
import { ReplySpeechStore } from './reply-speech.js'
import { replySpeechConfig } from './reply-speech-provider.js'
import { modelAccountAllowed } from '../../../runtime/model-execution.mjs'
const CONFIG = Symbol("ConversationConfig")
const identifier = (value: string) => {
  if (!uuid.test(value)) throw invalid()
  return value.toLowerCase()
}
function chatJobKind(request:Request) {
  if (Object.keys(request.query).some(key=>key!=='kind') || (request.query.kind!==undefined && !['chat_reply','gather_reply','photo_reply'].includes(String(request.query.kind)))) throw invalid()
  return request.query.kind==='gather_reply'?'gather_reply':request.query.kind==='photo_reply'?'photo_reply':'chat_reply'
}
export function conversationHeaders(
  _request: Request,
  response: Response,
  next: () => void,
) {
  response.setHeader("X-Request-Id", randomUUID())
  response.setHeader("Cache-Control", "no-store")
  response.setHeader("Referrer-Policy", "no-referrer")
  next()
}
@Catch()
export class ConversationErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>()
    if (response.headersSent) return
    let problem = new ConversationError(
      500,
      "INTERNAL_ERROR",
      "The conversation request could not be completed.",
    )
    if (error instanceof ConversationError) problem = error
    else if (error && typeof error === 'object' && 'code' in error && error.code === '42501'
      && error instanceof Error && error.message === 'Account data has been erased') problem = notFound()
    else if (error instanceof HttpException && error.getStatus() < 500)
      problem = error.getStatus() === 404 ? notFound() : invalid()
    else
      console.error("Conversation request failed", {
        requestId: response.getHeader("X-Request-Id"),
        type: error instanceof Error ? error.name : typeof error,
      })
    response
      .status(problem.status)
      .json({
        error: {
          code: problem.code,
          message: problem.message,
          requestId: response.getHeader("X-Request-Id"),
          ...(problem.details ? { details: problem.details } : {}),
        },
      })
  }
}
function version(request: Request) {
  const header = request.get("If-Match")
  if (!header)
    throw new ConversationError(
      428,
      "PRECONDITION_REQUIRED",
      "An If-Match version is required.",
    )
  const match = /^"v([1-9][0-9]*)"$/.exec(header),
    value = Number(match?.[1])
  if (!match || !Number.isSafeInteger(value) || value > 2147483647)
    throw invalid()
  return value
}
function page(query: Record<string, unknown>, extra: string[] = []) {
  if (
    Object.keys(query).some(
      (key) => !["cursor", "limit", ...extra].includes(key),
    )
  )
    throw invalid()
  if (
    query.limit !== undefined &&
    (typeof query.limit !== "string" ||
      !/^([1-9][0-9]{0,2})$/.test(query.limit))
  )
    throw invalid()
  const limit = query.limit === undefined ? 20 : Number(query.limit)
  if (
    limit > 100 ||
    (query.cursor !== undefined &&
      (typeof query.cursor !== "string" || query.cursor.length > 1200))
  )
    throw invalid()
  return { limit, cursor: query.cursor as string | undefined }
}
function emptyBody(value: unknown) {
  if (
    value !== undefined &&
    (value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length)
  )
    throw invalid()
}
function tagged<T extends { version: number }>(response: Response, data: T) {
  response.setHeader("ETag", '"v' + data.version + '"')
  return { data }
}
@Controller("v1")
class ConversationsController {
  constructor(
    @Inject(CONFIG) private readonly config: ConversationConfig,
    @Inject(ConversationStore) private readonly store: ConversationStore,
  ) {}
  private session(request: Request) {
    return this.store.dependencies.session(
      request.get("cookie") || "",
      request.get("X-Xijie-Expected-Session"),
    )
  }
  private async writer(request: Request) {
    if (request.get("origin") !== this.config.webOrigin)
      throw new ConversationError(
        403,
        "FORBIDDEN",
        "The request did not come from the registered application.",
      )
    const session = await this.session(request),
      key = request.get("Idempotency-Key")
    if (!key || !uuid.test(key)) throw invalid()
    return {
      session,
      key: key.toLowerCase(),
      requestId: String(request.res?.getHeader("X-Request-Id") ?? randomUUID()),
    }
  }
  private speech(request: Request) {
    if (Object.keys(request.query).length || !uuid.test(request.get('X-Xijie-Expected-Session') ?? '')) throw invalid()
    if (!replySpeechConfig().enabled) throw new ConversationError(503, 'REPLY_SPEECH_DISABLED', 'Reply speech is not available.')
    return new ReplySpeechStore(this.store)
  }
  @Post('conversations/:id/messages/:messageId/speech')
  @HttpCode(202)
  async requestSpeech(@Req() request: Request, @Param('id') id: string, @Param('messageId') messageId: string, @Body() body: unknown) {
    const speech = this.speech(request)
    emptyBody(body)
    const { session } = await this.writer(request)
    if (!modelAccountAllowed(session.accountId)) throw new ConversationError(503, 'REPLY_SPEECH_DISABLED', 'Reply speech is not available.')
    return { data: await speech.request(session.accountId, identifier(id), identifier(messageId), version(request)) }
  }
  @Get('conversations/:id/messages/:messageId/speech')
  async readSpeech(@Req() request: Request, @Param('id') id: string, @Param('messageId') messageId: string) {
    const speech = this.speech(request)
    const session = await this.session(request)
    const job = await speech.read(session.accountId, identifier(id), identifier(messageId), version(request))
    return { data: job ? { state: job.state } : null }
  }
  @Get('conversations/:id/messages/:messageId/speech/audio')
  async replySpeechAudio(@Req() request: Request, @Param('id') id: string, @Param('messageId') messageId: string, @Res() response: Response) {
    const speech = this.speech(request)
    const session = await this.session(request)
    const job = await speech.read(session.accountId, identifier(id), identifier(messageId), version(request), true)
    if (job?.state !== 'ready' || !job.wav) throw notFound()
    response.set({
      'Content-Type': 'audio/wav', 'Content-Length': String(job.wav.length),
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    }).send(job.wav)
  }
  private sign(scope: unknown, value: unknown) {
    const encoded = Buffer.from(JSON.stringify(value)).toString("base64url")
    const signature = createHmac("sha256", this.config.serviceToken)
      .update(JSON.stringify(["xijie-conversations-v1", scope, encoded]))
      .digest("base64url")
    return encoded + "." + signature
  }
  private read(scope: unknown, value: string): unknown {
    const parts = value.split(".")
    if (
      parts.length !== 2 ||
      !/^[A-Za-z0-9_-]{1,1100}$/.test(parts[0]) ||
      !/^[A-Za-z0-9_-]{43}$/.test(parts[1])
    )
      throw invalid()
    let decoded: unknown
    try {
      decoded = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"))
    } catch {
      throw invalid()
    }
    const expected = this.sign(scope, decoded)
    if (
      value.length !== expected.length ||
      !timingSafeEqual(Buffer.from(value), Buffer.from(expected))
    )
      throw invalid()
    return decoded
  }
  private storyPage(request:Request,query:Record<string,unknown>,scope:unknown,items:unknown[]){
    const {limit,cursor}=page(query),revision=createHmac('sha256',this.config.serviceToken).update(JSON.stringify(items)).digest('hex')
    let offset=0
    if(cursor){const v=this.read([scope,limit],cursor) as {offset?:unknown;revision?:unknown};if(!v||!Number.isSafeInteger(v.offset)||Number(v.offset)<0||v.revision!==revision)throw new ConversationError(409,'SOURCE_CHANGED','The history changed. Read it again.');offset=Number(v.offset)}
    return{data:items.slice(offset,offset+limit),meta:{nextCursor:offset+limit<items.length?this.sign([scope,limit],{offset:offset+limit,revision}):null}}
  }
  @Get('persons/:personId/story-branches')
  async branches(@Req()r:Request,@Param('personId')p:string,@Query()q:Record<string,unknown>){const a=(await this.session(r)).accountId;return this.storyPage(r,q,['branches',a,p],await this.store.stories.branches(a,identifier(p)))}
  @Post('persons/:personId/story-branches')
  async createBranch(@Req()r:Request,@Res({passthrough:true})response:Response,@Param('personId')p:string,@Body()b:unknown){if(Object.keys(r.query).length)throw invalid();const{session,key}=await this.writer(r);return tagged(response,await this.store.stories.createBranch(session.accountId,identifier(p),key,branchInput(b)))}
  @Get('story-branches/:id')
  async branch(@Req()r:Request,@Res({passthrough:true})response:Response,@Param('id')id:string){if(Object.keys(r.query).length)throw invalid();return tagged(response,(await this.store.stories.branch((await this.session(r)).accountId,identifier(id))).dto)}
  @Get('story-branches/:id/messages')
  async storyMessages(@Req()r:Request,@Param('id')id:string,@Query()q:Record<string,unknown>){
    const a=(await this.session(r)).accountId,{limit,cursor}=page(q,['direction']),direction=q.direction??'older';if(direction!=='older'&&direction!=='newer')throw invalid()
    const scope=['story-messages',a,id,direction,limit];let boundary:string|undefined
    if(cursor){const value=this.read(scope,cursor);if(typeof value!=='string'||!/^\d+$/.test(value))throw invalid();boundary=value}
    const all=await this.store.stories.messages(a,identifier(id)),rows=all.filter(m=>boundary===undefined||direction==='older'?boundary===undefined||BigInt(m.sequence)<BigInt(boundary):BigInt(m.sequence)>BigInt(boundary))
    if(direction==='older')rows.reverse()
    const data=rows.slice(0,limit),latest=data.reduce((n,m)=>BigInt(m.sequence)>BigInt(n)?m.sequence:n,direction==='newer'&&boundary?boundary:'0')
    return{data,meta:{nextCursor:rows.length>limit&&data.length?this.sign(scope,data.at(-1)!.sequence):null,afterCursor:this.sign(['story-messages',a,id,'newer',limit],latest)}}
  }
  @Post('story-branches/:id/messages')
  @HttpCode(202)
  async sendStory(@Req()r:Request,@Param('id')id:string,@Body()b:unknown){if(Object.keys(r.query).length)throw invalid();const{session,key}=await this.writer(r);return{data:await this.store.stories.send(session.accountId,identifier(id),key,textInput(b))}}
  @Delete('story-branches/:id/messages/:messageId')
  async removeStory(@Req()r:Request,@Param('id')id:string,@Param('messageId')mid:string,@Body()b:unknown){if(Object.keys(r.query).length)throw invalid();emptyBody(b);const{session,key}=await this.writer(r);return{data:await this.store.stories.remove(session.accountId,identifier(id),identifier(mid),key,version(r))}}
  @Get('story-branches/:id/events')
  async branchEvents(@Req()r:Request,@Param('id')id:string,@Query()q:Record<string,unknown>){const a=(await this.session(r)).accountId;return this.storyPage(r,q,['branch-events',a,id],await this.store.stories.events(a,identifier(id)))}
  @Get('story-generation-jobs/:id')
  async storyJob(@Req()r:Request,@Param('id')id:string){if(Object.keys(r.query).length)throw invalid();return{data:await this.store.stories.job((await this.session(r)).accountId,identifier(id))}}
  @Post('story-generation-jobs/:id/:action')
  @HttpCode(200)
  async storyTaskAction(@Req()r:Request,@Param('id')id:string,@Param('action')action:string,@Body()b:unknown){if(Object.keys(r.query).length||!['retry','cancel'].includes(action))throw invalid();emptyBody(b);const{session,key}=await this.writer(r);return{data:await this.store.stories.taskAction(session.accountId,identifier(id),key,action as 'retry'|'cancel')}}
  @Get('persons/:personId/offline-life')
  async life(@Req()r:Request,@Res({passthrough:true})response:Response,@Param('personId')p:string){if(Object.keys(r.query).length)throw invalid();return tagged(response,await this.store.stories.life((await this.session(r)).accountId,identifier(p)))}
  @Put('persons/:personId/offline-life')
  async setLife(@Req()r:Request,@Res({passthrough:true})response:Response,@Param('personId')p:string,@Body()b:unknown){if(Object.keys(r.query).length)throw invalid();const{session,key}=await this.writer(r);return tagged(response,await this.store.stories.setLife(session.accountId,identifier(p),key,version(r),lifeInput(b)))}
  @Get('persons/:personId/offline-life/events')
  async lifeEvents(@Req()r:Request,@Param('personId')p:string,@Query()q:Record<string,unknown>){const a=(await this.session(r)).accountId;return this.storyPage(r,q,['life-events',a,p],await this.store.stories.lifeEvents(a,identifier(p)))}
  @Get("conversations")
  async summaries(
    @Req() request: Request,
    @Query() query: Record<string, unknown>,
  ) {
    const session = await this.session(request),
      { limit, cursor } = page(query, ["kind"])
    if (query.kind !== undefined && !['direct','gather'].includes(String(query.kind))) throw invalid()
    const scope = ["summaries", session.accountId, query.kind ?? null, limit]
    let items = await this.store.summaries(session.accountId)
    if(query.kind)items=items.filter(item=>item.kind===query.kind)
    if (cursor) {
      const position = this.read(scope, cursor) as {
        at?: unknown
        id?: unknown
      } | null
      if (
        !position ||
        typeof position.id !== "string" ||
        !uuid.test(position.id) ||
        (position.at !== null &&
          (typeof position.at !== "string" ||
            !Number.isFinite(Date.parse(position.at))))
      )
        throw invalid()
      const at = position.at as string | null,
        id = position.id
      items = items.filter(
        (item) =>
          (item.lastActivityAt ?? "") < (at ?? "") ||
          (item.lastActivityAt === at && (item.kind==='gather'?item.conversationId!:item.personId!) > id),
      )
    }
    const data = items.slice(0, limit),
      last = data.at(-1)
    return {
      data,
      meta: {
        nextCursor:
          items.length > limit && last
            ? this.sign(scope, { at: last.lastActivityAt, id: last.kind==='gather'?last.conversationId:last.personId })
            : null,
      },
    }
  }
  @Get('conversations/letters/unread')
  async unreadLetter(@Req()request:Request){
    if(Object.keys(request.query).length)throw invalid()
    const item=await this.store.letters.latestUnread((await this.session(request)).accountId)
    return{data:item?[item]:[]}
  }
  @Post('persons/:personId/letters')
  @HttpCode(201)
  async createLetter(@Req()request:Request,@Res({passthrough:true})response:Response,@Param('personId')personId:string,@Body()body:unknown){
    if(Object.keys(request.query).length)throw invalid()
    const {session,key,requestId}=await this.writer(request)
    return tagged(response,await this.store.letters.create(session.accountId,identifier(personId),key,letterInput(body),requestId))
  }
  @Get('persons/:personId/letters')
  async letters(@Req()request:Request,@Param('personId')personId:string,@Query()query:Record<string,unknown>){
    const session=await this.session(request),id=identifier(personId),{limit,cursor}=page(query),scope=['letters',session.accountId,id,limit]
    let position:{revision:string;offset:number}|undefined
    if(cursor!==undefined){const value=this.read(scope,cursor) as {revision?:unknown;offset?:unknown}|null;if(!value||typeof value.revision!=='string'||!/^[a-f0-9]{64}$/.test(value.revision)||!Number.isSafeInteger(value.offset)||Number(value.offset)<0)throw invalid();position={revision:value.revision,offset:Number(value.offset)}}
    const result=await this.store.letters.snapshot(session.accountId,id)
    if(position&&position.revision!==result.revision)throw new ConversationError(409,'SOURCE_CHANGED','The letters changed. Read the complete history again.')
    const offset=position?.offset??0,data=result.items.slice(offset,offset+limit)
    return{data,meta:{nextCursor:offset+limit<result.items.length?this.sign(scope,{revision:result.revision,offset:offset+limit}):null}}
  }
  @Get('persons/:personId/letters/:letterId')
  async letter(@Req()request:Request,@Res({passthrough:true})response:Response,@Param('personId')personId:string,@Param('letterId')letterId:string){if(Object.keys(request.query).length)throw invalid();return tagged(response,await this.store.letters.get((await this.session(request)).accountId,identifier(personId),identifier(letterId)))}
  @Post('persons/:personId/letters/read')
  @HttpCode(200)
  async readLetters(@Req()request:Request,@Param('personId')personId:string,@Body()body:unknown){if(Object.keys(request.query).length)throw invalid();const{session,key}=await this.writer(request);return{data:await this.store.letters.read(session.accountId,identifier(personId),key,throughReply(body))}}
  @Delete('persons/:personId/letters/:letterId')
  async removeLetter(@Req()request:Request,@Res({passthrough:true})response:Response,@Param('personId')personId:string,@Param('letterId')letterId:string,@Body()body:unknown){if(Object.keys(request.query).length)throw invalid();emptyBody(body);const{session,key,requestId}=await this.writer(request);return tagged(response,await this.store.letters.remove(session.accountId,identifier(personId),identifier(letterId),key,version(request),requestId))}
  @Get('search')
  async search(@Req()request:Request,@Query()query:Record<string,unknown>){
    const session=await this.session(request),{limit,cursor}=page(query,['scope','q','locale'])
    if(query.scope!=='conversations'||query.locale!==undefined&&!['zh-CN','en'].includes(String(query.locale)))throw invalid()
    const needle=historyQuery(query.q),locale=query.locale==='en'?'en':'zh-CN',scope=['search',session.accountId,needle,locale,limit]
    let position:{revision:string;offset:number}|undefined
    if(cursor){
      const value=this.read(scope,cursor) as {revision?:unknown;offset?:unknown}|null
      if(!value||typeof value.revision!=='string'||! /^[a-f0-9]{64}$/.test(value.revision)||!Number.isSafeInteger(value.offset)||Number(value.offset)<0)throw invalid()
      position={revision:value.revision,offset:Number(value.offset)}
    }
    const result=await this.store.searchHistory(session.accountId,needle,locale)
    if(position&&position.revision!==result.revision)throw new ConversationError(409,'SOURCE_CHANGED','The search results changed. Search again before continuing.')
    const offset=position?.offset??0,data=result.items.slice(offset,offset+limit)
    return{data,meta:{nextCursor:offset+limit<result.items.length?this.sign(scope,{revision:result.revision,offset:offset+limit}):null}}
  }
  @Post("conversations")
  async ensure(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown,
  ) {
    const { session, key } = await this.writer(request),
      input = directInput(body)
    const result = input.kind==='gather'?await this.store.gather.ensure(session.accountId,input.worldId,key):await this.store.ensure(
      session.accountId,
      input.personId,
      key,
    )
    response.status(result.created ? 201 : 200)
    return tagged(response, {
      ...result.conversation,
      canSend: result.conversation.kind==='gather'?result.conversation.canSend:session.storyStorage.allowed,
    })
  }
  @Get("conversations/:id")
  async detail(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param("id") id: string,
  ) {
    const session = await this.session(request),
      result = await this.store.visible(session.accountId, identifier(id))
    return tagged(response, {
      ...result.conversation,
      canSend: result.conversation.kind==='gather'?result.conversation.canSend:session.storyStorage.allowed,
    })
  }
  @Get("conversations/:id/messages")
  async messages(
    @Req() request: Request,
    @Param("id") id: string,
    @Query() query: Record<string, unknown>,
  ) {
    const session = await this.session(request),
      conversationId = identifier(id),
      { limit, cursor } = page(query, ["direction"])
    const direction = query.direction ?? "older"
    if (direction !== "older" && direction !== "newer") throw invalid()
    const scope = [
      "messages",
      session.accountId,
      conversationId,
      direction,
      limit,
    ]
    let boundary: string | undefined
    if (cursor) {
      const value = this.read(scope, cursor)
      if (
        typeof value !== "string" ||
        !/^(0|[1-9][0-9]{0,18})$/.test(value) ||
        BigInt(value) > 9223372036854775807n
      )
        throw invalid()
      boundary = value
    }
    const rows = await this.store.messages(
        session.accountId,
        conversationId,
        direction,
        boundary,
        limit + 1,
      ),
      data = rows.slice(0, limit)
    const latest = data.reduce(
      (highest, item) =>
        BigInt(item.sequence) > BigInt(highest) ? item.sequence : highest,
      boundary && direction === "newer" ? boundary : "0",
    )
    return {
      data,
      meta: {
        nextCursor:
          rows.length > limit && data.length
            ? this.sign(scope, data.at(-1)!.sequence)
            : null,
        afterCursor: this.sign(
          ["messages", session.accountId, conversationId, "newer", limit],
          latest,
        ),
      },
    }
  }
  @Get('conversations/:id/messages/:messageId/context')
  async context(@Req()request:Request,@Param('id')id:string,@Param('messageId')messageId:string,@Query()query:Record<string,unknown>){
    if(Object.keys(query).some(key=>key!=='limit'))throw invalid()
    const session=await this.session(request),conversationId=identifier(id),{limit}=page(query),result=await this.store.historyContext(session.accountId,conversationId,identifier(messageId),limit)
    return{data:{anchorMessageId:result.anchorMessageId,items:result.items,beforeCursor:result.before===null?null:this.sign(['messages',session.accountId,conversationId,'older',limit],result.before),afterCursor:result.after===null?null:this.sign(['messages',session.accountId,conversationId,'newer',limit],result.after)}}
  }
  @Post("conversations/:id/messages")
  @HttpCode(202)
  async send(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const { session, key, requestId } = await this.writer(request)
    if(body&&typeof body==='object'&&!Array.isArray(body)&&(body as {kind?:unknown}).kind==='photo')return{data:await this.store.photos.send(session.accountId,identifier(id),key,photoInput(body),requestId)}
    return {
      data: await this.store.send(
        session.accountId,
        identifier(id),
        key,
        textInput(body),
        requestId,
      ),
    }
  }
  @Delete("conversations/:id/messages/:messageId")
  async remove(
    @Req() request: Request,
    @Param("id") id: string,
    @Param("messageId") messageId: string,
  ) {
    const { session, key, requestId } = await this.writer(request)
    return {
      data: await this.store.removeMessage(
        session.accountId,
        identifier(id),
        identifier(messageId),
        key,
        version(request),
        requestId,
      ),
    }
  }
  @Get("generation-jobs/:id")
  async generation(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param("id") id: string,
  ) {
    const kind=chatJobKind(request)
    return tagged(
      response,
      await (kind==='gather_reply'?this.store.gather:kind==='photo_reply'?this.store.photos:this.store).getJob(
        (await this.session(request)).accountId,
        identifier(id),
      ),
    )
  }
  @Post("generation-jobs/:id/cancel")
  @HttpCode(200)
  async cancel(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const kind=chatJobKind(request)
    const { session, key, requestId } = await this.writer(request)
    emptyBody(body)
    return tagged(
      response,
      await (kind==='gather_reply'?this.store.gather:kind==='photo_reply'?this.store.photos:this.store).cancel(
        session.accountId,
        identifier(id),
        key,
        requestId,
      ),
    )
  }
  @Post("generation-jobs/:id/retry")
  @HttpCode(202)
  async retry(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const kind=chatJobKind(request)
    const { session, key, requestId } = await this.writer(request)
    emptyBody(body)
    return tagged(
      response,
      await (kind==='gather_reply'?this.store.gather:kind==='photo_reply'?this.store.photos:this.store).retry(session.accountId, identifier(id), key, requestId),
    )
  }
}
@Controller('internal/v1')
class InternalConversationsController {
  constructor(@Inject(CONFIG) private readonly config:ConversationConfig,@Inject(ConversationStore) private readonly store:ConversationStore) {}
  private media(request:Request){
    const expected=this.config.mediaServiceToken
    if(!expected)throw notFound()
    const token=/^Bearer ([a-f0-9]{64})$/i.exec(request.get('Authorization')??'')?.[1]
    if(!token||!timingSafeEqual(Buffer.from(token,'hex'),Buffer.from(expected,'hex')))throw new ConversationError(403,'FORBIDDEN','The calling service is not authorized.')
    if(Object.keys(request.query).length)throw invalid()
    return identifier(request.get('X-Xijie-Account-Id')??'')
  }
  @Get('conversations/:id/photo-target')
  async photoTarget(@Req()request:Request,@Param('id')id:string){return{data:await this.store.photos.target(this.media(request),identifier(id))}}
  @Post('conversation-media/validate')
  @HttpCode(200)
  async photoValidate(@Req()request:Request,@Body()body:unknown){
    const accountId=this.media(request)
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>k!=='refs'))throw invalid()
    const refs=(body as {refs:unknown}).refs
    if(!Array.isArray(refs)||refs.length>100)throw invalid()
    const values=refs.map(raw=>{if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['conversationId','clientMessageId','messageVersion','mediaId','version'].includes(k)))throw invalid();const r=raw as Record<string,unknown>;if(!Number.isSafeInteger(r.messageVersion)||Number(r.messageVersion)<1||!Number.isSafeInteger(r.version)||Number(r.version)<1)throw invalid();return{conversationId:identifier(String(r.conversationId)),clientMessageId:identifier(String(r.clientMessageId)),messageVersion:Number(r.messageVersion),mediaId:identifier(String(r.mediaId)),version:Number(r.version)}})
    return{data:await this.store.photos.validate(accountId,values)}
  }
  @Get('photo-reply-jobs/:jobId/attempts/:attemptId/media-source')
  async photoSource(@Req()request:Request,@Param('jobId')jobId:string,@Param('attemptId')attemptId:string){return{data:await this.store.photos.mediaSource(this.media(request),identifier(jobId),identifier(attemptId))}}
  private gifts(request:Request){
    const expected=this.config.giftsServiceToken
    if(!expected)throw notFound()
    const token=/^Bearer ([a-f0-9]{64})$/i.exec(request.get('Authorization')??'')?.[1]
    if(!token||!timingSafeEqual(Buffer.from(token,'hex'),Buffer.from(expected,'hex')))throw new ConversationError(403,'FORBIDDEN','The calling service is not authorized.')
    if(Object.keys(request.query).length)throw invalid()
    return new GiftProjectionStore(this.store.pool,this.store.dependencies,this.store)
  }
  @Post('gifts/conversations/ensure')
  @HttpCode(200)
  async giftEnsure(@Req()request:Request,@Body()body:unknown){
    const gifts=this.gifts(request)
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['accountId','personId'].includes(k)))throw invalid()
    const value=body as {accountId:string;personId:string}
    return {data:await gifts.ensure(identifier(value.accountId),identifier(value.personId))}
  }
  @Put('gifts/deliveries/:id')
  @HttpCode(200)
  async giftProject(@Req()request:Request,@Param('id')id:string,@Body()body:unknown){return {data:await this.gifts(request).project(identifier(id),body)}}
  @Put('gifts/received/:id')
  @HttpCode(200)
  async receivedGiftProject(@Req()request:Request,@Param('id')id:string,@Body()body:unknown){return {data:await this.gifts(request).projectReceived(identifier(id),body)}}
  @Get('accounts/:accountId/data-export')
  async dataExport(@Req() request:Request,@Param('accountId') account:string,@Query() query:Record<string,unknown>) {
    rightsToken(this.config, request)
    const accountId=identifier(account),{requestId,scope}=rightsQuery(query)
    const before=await rightsContext(this.config,accountId,requestId,'export',scope)
    const data=await exportConversations(this.store.pool,this.store.dependencies,accountId,scope)
    const after=await rightsContext(this.config,accountId,requestId,'export',scope)
    if(before.accountAccessVersion!==after.accountAccessVersion)throw new ConversationError(409,'EXPORT_STALE','Account access changed while exporting.')
    return {data}
  }
  @Post('accounts/:accountId/erase')
  @HttpCode(200)
  async erase(@Req() request:Request,@Param('accountId') account:string,@Body() body:unknown) {
    rightsToken(this.config,request)
    const accountId=identifier(account),requestId=eraseInput(request,body)
    await rightsContext(this.config,accountId,requestId,'delete_account')
    return {data:await eraseConversations(this.store.pool,this.config.queueSchema,accountId,requestId)}
  }
  private authorizeMemories(request:Request) {
    const expected=this.config.memoriesServiceToken
    if (!expected) throw notFound()
    const supplied=/^Bearer ([a-f0-9]{64})$/i.exec(request.get('Authorization')||'')?.[1]
    if (!supplied || !timingSafeEqual(Buffer.from(supplied,'hex'),Buffer.from(expected,'hex'))) throw new ConversationError(403,'FORBIDDEN','The calling service is not authorized.')
  }
  private account(request:Request) {
    this.authorizeMemories(request)
    const accountId=request.get('X-Xijie-Account-Id')
    if (!accountId || !uuid.test(accountId)) throw invalid()
    return accountId.toLowerCase()
  }
  @Get('automatic-memory/events')
  async automaticEvents(@Req() request:Request,@Query() query:Record<string,unknown>) {
    this.authorizeMemories(request)
    const {accountIds,limit}=automaticEventQuery(query)
    return {data:await new AutomaticSourceStore(this.store.pool,this.store.dependencies).events(accountIds,limit)}
  }
  @Post('automatic-memory/events/:id/ack')
  @HttpCode(200)
  async automaticAck(@Req() request:Request,@Param('id') id:string,@Body() body:unknown) {
    this.authorizeMemories(request)
    if(Object.keys(request.query).length)throw invalid()
    emptyAutomaticBody(body)
    return {data:await new AutomaticSourceStore(this.store.pool,this.store.dependencies).ack(identifier(id))}
  }
  @Get('automatic-memory/messages/:id')
  async automaticMessage(@Req() request:Request,@Param('id') id:string) {
    const accountId=this.account(request)
    if(Object.keys(request.query).length)throw invalid()
    return {data:await new AutomaticSourceStore(this.store.pool,this.store.dependencies).source(accountId,identifier(id))}
  }
  @Post('automatic-memory/validate')
  @HttpCode(200)
  async automaticValidate(@Req() request:Request,@Body() body:unknown) {
    const accountId=this.account(request)
    if(Object.keys(request.query).length)throw invalid()
    const {personId,refs}=automaticReferences(body)
    return {data:await new AutomaticSourceStore(this.store.pool,this.store.dependencies).validate(accountId,personId,refs)}
  }
  @Get('messages/:id/context')
  async context(@Req() request:Request,@Param('id') id:string) {
    return {data:await this.store.sourceContext(this.account(request),identifier(id))}
  }
  @Get('messages/:id/memory-context')
  async memoryContext(@Req() request:Request,@Param('id') id:string) {
    return {data:await this.store.memorySourceContext(this.account(request),identifier(id))}
  }
}
@Module({})
export class ConversationsModule {
  static register(
    config: ConversationConfig,
    store: ConversationStore,
    voice?:VoiceHub,
  ): DynamicModule {
    return {
      module: ConversationsModule,
      imports:voice?[VoiceCallsModule.register(voice)]:[],
      controllers: [ConversationsController, InternalConversationsController,ConversationReviewController],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: ConversationStore, useValue: store },
      ],
    }
  }
}
