import {AlbumsController,AlbumSourcesController,ALBUM_CONFIG} from './albums-http.js'
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
import type { SocialConfig } from "./config.js"
import {
  SocialError,
  invalid,
  notFound,
  identifier,
  object,
  createInput,
  commentInput,
  instant,
  type PagePosition,
  type FeedFilter,
  type ExportScope,
} from "./contracts.js"
import { SocialStore } from "./store.js"
import { SocialDataRights, rightsToken } from "./data-rights.js"
import {mediaRefsInput} from './post-media.js'
import {SocialReviewController} from './content-review.js'
const CONFIG = Symbol("SocialConfig")
export function socialHeaders(
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
export class SocialErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>()
    if (response.headersSent) return
    let problem = new SocialError(
      500,
      "INTERNAL_ERROR",
      "The private feed request could not be completed.",
    )
    if (error instanceof SocialError) problem = error
    else if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "42501" || error.code === "40001")
    )
      problem = notFound()
    else if (error instanceof HttpException && error.getStatus() < 500)
      problem = error.getStatus() === 404 ? notFound() : invalid()
    else
      console.error("Social request failed", {
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
        },
      })
  }
}
function version(request: Request) {
  const s = request.get("If-Match")
  if (!s)
    throw new SocialError(
      428,
      "PRECONDITION_REQUIRED",
      "Supply the current version.",
    )
  const m = /^"v([1-9][0-9]*)"$/.exec(s)
  if (!m || !Number.isSafeInteger(Number(m[1])) || Number(m[1]) > 2147483647)
    throw invalid()
  return Number(m[1])
}
function page(query: Record<string, unknown>, extra: string[] = []) {
  if (
    Object.keys(query).some((k) => !["cursor", "limit", ...extra].includes(k))
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
      (typeof query.cursor !== "string" || query.cursor.length > 1800))
  )
    throw invalid()
  return { limit, cursor: query.cursor as string | undefined }
}
const tagged = <T extends { version: number }>(response: Response, data: T) => {
  response.setHeader("ETag", '"v' + data.version + '"')
  return { data }
}
@Controller("v1")
class SocialController {
  constructor(
    @Inject(CONFIG) readonly config: SocialConfig,
    @Inject(SocialStore) readonly store: SocialStore,
  ) {}
  private session(request: Request) {
    return this.store.dependencies.session(
      request.get("cookie") || "",
      request.get("X-Xijie-Expected-Session"),
    )
  }
  private async writer(request: Request) {
    if (request.get("origin") !== this.config.webOrigin)
      throw new SocialError(
        403,
        "FORBIDDEN",
        "The request did not come from the registered application.",
      )
    const expected = request.get("X-Xijie-Expected-Session")
    if (!expected) throw invalid()
    const session = await this.session(request),
      key = identifier(request.get("Idempotency-Key"))
    return {
      session,
      key,
      requestId: String(request.res?.getHeader("X-Request-Id") ?? randomUUID()),
    }
  }
  private sign(scope: unknown, v: unknown) {
    const encoded = Buffer.from(JSON.stringify(v)).toString("base64url")
    return (
      encoded +
      "." +
      createHmac("sha256", this.config.serviceToken)
        .update(JSON.stringify(["xijie-social-v1", scope, encoded]))
        .digest("base64url")
    )
  }
  private cursor(scope: unknown, value?: string): PagePosition | undefined {
    if (value === undefined) return
    const [encoded, signature, ...rest] = value.split(".")
    if (
      rest.length ||
      !/^[A-Za-z0-9_-]{1,1700}$/.test(encoded) ||
      !/^[A-Za-z0-9_-]{43}$/.test(signature || "")
    )
      throw invalid()
    let result: unknown
    try {
      result = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))
    } catch {
      throw invalid()
    }
    const x = object(result, ["at", "id"]),
      position = { at: x.at as string, id: identifier(x.id) }
    if (!instant(position.at)) throw invalid()
    const signed = this.sign(scope, position)
    if (
      signed.length !== value.length ||
      !timingSafeEqual(Buffer.from(signed), Buffer.from(value))
    )
      throw invalid()
    return position
  }
  private paged<T extends { id: string, createdAt: string }>(
    rows: T[],
    scope: unknown,
    limit: number,
  ) {
    const more = rows.length > limit,
      data = rows.slice(0, limit),
      last = data.at(-1)
    return {
      data,
      meta: {
        ...(more && last
          ? {
              nextCursor: this.sign(scope, { at: last.createdAt, id: last.id }),
            }
          : {}),
        hasMore: more,
      },
    }
  }
  @Get("feed")
  async feed(@Req() request: Request, @Query() query: Record<string, unknown>) {
    const session = await this.session(request),
      { limit, cursor } = page(query, ["author", "personId", "worldId", "kind"])
    const f: FeedFilter = {}
    if (query.author !== undefined) {
      if (typeof query.author !== "string" || !["self", "person", "world"].includes(query.author))
        throw invalid()
      f.author = (query.author as FeedFilter["author"])
    }
    if (query.kind !== undefined) {
      if (typeof query.kind !== "string" || !["user", "world_notice", "memory_echo"].includes(query.kind))
        throw invalid()
      f.kind = (query.kind as FeedFilter["kind"])
    }
    if (query.personId !== undefined) f.personId = identifier(query.personId)
    if (query.worldId !== undefined) f.worldId = identifier(query.worldId)
    if (
      (f.author === "self" && (f.personId || f.worldId)) ||
      (f.author === "person" && !f.personId) ||
      (f.author === "world" && !f.worldId)
    )
      throw invalid()
    const scope = [session.accountId, "feed", limit, f]
    const result=this.paged(
      await this.store.feed(
        session.accountId,
        f,
        this.cursor(scope, cursor),
        limit + 1,
      ),
      scope,
      limit,
    )
    return {...result,meta:{...result.meta,...(this.store.generations?{generationStatus:await this.store.generations.status(session.accountId)}:{})}}
  }
  @Get("posts/:id")
  async detail(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param("id") id: string,
  ) {
    if (Object.keys(request.query).length) throw invalid()
    const session = await this.session(request)
    return tagged(
      response,
      await this.store.detail(session.accountId, identifier(id)),
    )
  }
  @Post("posts")
  async create(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown,
  ) {
    if (Object.keys(request.query).length) throw invalid()
    const { session, key, requestId } = await this.writer(request)
    return tagged(
      response,
      await this.store.create(
        session.accountId,
        key,
        createInput(body),
        requestId,
      ),
    )
  }
  @Delete("posts/:id")
  @HttpCode(200)
  async remove(@Req() request: Request, @Param("id") id: string) {
    if (Object.keys(request.query).length) throw invalid()
    const { session, key, requestId } = await this.writer(request)
    return {
      data: await this.store.remove(
        session.accountId,
        identifier(id),
        key,
        version(request),
        requestId,
      ),
    }
  }
  @Put("posts/:id/reactions/me")
  async react(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    if (Object.keys(request.query).length) throw invalid()
    const x = object(body, ["active"])
    if (typeof x.active !== "boolean") throw invalid()
    const { session, key, requestId } = await this.writer(request)
    return {
      data: await this.store.react(
        session.accountId,
        identifier(id),
        key,
        x.active,
        requestId,
      ),
    }
  }
  @Get("posts/:id/comments")
  async comments(
    @Req() request: Request,
    @Param("id") id: string,
    @Query() query: Record<string, unknown>,
  ) {
    const session = await this.session(request),
      postId = identifier(id),
      { limit, cursor } = page(query),
      scope = [session.accountId, "comments", postId, limit]
    return this.paged(
      await this.store.comments(
        session.accountId,
        postId,
        this.cursor(scope, cursor),
        limit + 1,
      ),
      scope,
      limit,
    )
  }
  @Post("posts/:id/comments")
  async comment(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    if (Object.keys(request.query).length) throw invalid()
    const { session, key, requestId } = await this.writer(request)
    return tagged(
      response,
      await this.store.comment(
        session.accountId,
        identifier(id),
        key,
        commentInput(body),
        requestId,
      ),
    )
  }
  @Get('social-generation-jobs/:id')
  async generation(@Req()request:Request,@Param('id')id:string){if(Object.keys(request.query).length)throw invalid();const s=await this.session(request);if(!this.store.generations)throw new SocialError(503,'GENERATION_UNAVAILABLE','Generation is unavailable.');return {data:await this.store.generations.get(s.accountId,identifier(id))}}
  @Post('social-generation-jobs/:id/:action')
  @HttpCode(200)
  async generationCommand(@Req()request:Request,@Param('id')id:string,@Param('action')action:string,@Body()body:unknown){object(body,[]);if(Object.keys(request.query).length||!['retry','cancel'].includes(action))throw invalid();const {session,key}=await this.writer(request);if(!this.store.generations)throw new SocialError(503,'GENERATION_UNAVAILABLE','Generation is unavailable.');return {data:await this.store.generations.command(session.accountId,identifier(id),key,version(request),action as 'retry'|'cancel')}}
  @Delete("posts/:postId/comments/:id")
  @HttpCode(200)
  async removeComment(
    @Req() request: Request,
    @Param("postId") postId: string,
    @Param("id") id: string,
  ) {
    if (Object.keys(request.query).length) throw invalid()
    const { session, key, requestId } = await this.writer(request)
    return {
      data: await this.store.removeComment(
        session.accountId,
        identifier(postId),
        identifier(id),
        key,
        version(request),
        requestId,
      ),
    }
  }
}
@Controller("internal/v1")
class SocialRightsController {
  constructor(
    @Inject(CONFIG) readonly config: SocialConfig,
    @Inject(SocialStore) readonly store: SocialStore,
  ) {}
  @Post('media/posts/validate')
  @HttpCode(200)
  async validateMedia(@Req()request:Request,@Body()body:unknown){
    if(Object.keys(request.query).length)throw invalid()
    if(!this.config.mediaToken)throw notFound()
    const token=/^Bearer ([a-f0-9]{64})$/i.exec(request.get('Authorization')||'')?.[1]
    if(!token||!timingSafeEqual(Buffer.from(token,'hex'),Buffer.from(this.config.mediaToken,'hex')))throw new SocialError(403,'FORBIDDEN','The calling service is not authorized.')
    const accountId=identifier(request.get('X-Xijie-Account-Id'))
    return {data:{valid:await this.store.validatePostMedia(accountId,mediaRefsInput(body))}}
  }
  @Get("accounts/:accountId/data-export")
  async export(
    @Req() request: Request,
    @Param("accountId") accountId: string,
    @Query() query: Record<string, unknown>,
  ) {
    rightsToken(this.config, request)
    const x = object(query, ["requestId", "scope"])
    if (!["interaction_data", "account_data"].includes(String(x.scope)))
      throw invalid()
    return {
      data: await new SocialDataRights(this.store).export(
        identifier(accountId),
        identifier(x.requestId),
        x.scope as ExportScope,
      ),
    }
  }
  @Post("accounts/:accountId/erase")
  @HttpCode(200)
  async erase(
    @Req() request: Request,
    @Param("accountId") accountId: string,
    @Body() body: unknown,
  ) {
    rightsToken(this.config, request)
    if (Object.keys(request.query).length) throw invalid()
    const x = object(body, ["requestId"]),
      requestId = identifier(x.requestId)
    if (identifier(request.get("Idempotency-Key")) !== requestId)
      throw invalid()
    return {
      data: await new SocialDataRights(this.store).erase(
        identifier(accountId),
        requestId,
      ),
    }
  }
}
@Module({})
export class SocialModule {
  static register(config: SocialConfig, store: SocialStore): DynamicModule {
    return {
      module: SocialModule,
      controllers: [SocialController, SocialRightsController,AlbumsController,AlbumSourcesController,SocialReviewController],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: ALBUM_CONFIG, useValue: config },
        { provide: SocialStore, useValue: store },
      ],
    }
  }
}
