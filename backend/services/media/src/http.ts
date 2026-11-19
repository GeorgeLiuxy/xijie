import { randomUUID, timingSafeEqual } from "node:crypto"

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

import { json, raw } from "express"

import { NestFactory } from "@nestjs/core"

import type { MediaConfig } from "./config.js"

import { MediaStore } from "./store.js"

import { MediaDataRights } from "./data-rights.js"
import {voiceInput} from './voice-store.js'

import {
  MediaError,
  invalid,
  missing,
  identifier,
  object,
  createInput,
  positive,
  uuid,
} from "./contracts.js"

const CONFIG = Symbol("MediaConfig")

export function mediaHeaders(
  _req: Request,

  response: Response,

  next: () => void,
) {
  response.setHeader("X-Request-Id", randomUUID())

  response.setHeader("Cache-Control", "no-store")

  response.setHeader("Referrer-Policy", "no-referrer")

  response.setHeader("X-Content-Type-Options", "nosniff")

  next()
}

@Catch()
export class MediaErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>()

    if (response.headersSent) return

    let e =
      error instanceof MediaError
        ? error
        : new MediaError(500, "INTERNAL_ERROR")

    if (error instanceof HttpException && error.getStatus() < 500)
      e = error.getStatus() === 404 ? missing() : invalid()
    else if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      ["42501", "40001"].includes(String(error.code))
    )
      e = missing()
    else if (
      error &&
      typeof error === "object" &&
      "type" in error &&
      error.type === "entity.too.large"
    )
      e = new MediaError(413, "MEDIA_TOO_LARGE")
    else if (!(error instanceof MediaError))
      console.error("Media request failed.", {
        requestId: response.getHeader("X-Request-Id"),

        type: error instanceof Error ? error.name : "UnknownError",
      })

    response

      .status(e.status)

      .json({
        error: {
          code: e.code,

          message: e.message,

          requestId: response.getHeader("X-Request-Id"),
          ...(e.details?{details:e.details}:{}),
        },
      })
  }
}

const tagged = (response: Response, data: { version: number }) => {
  response.setHeader("ETag", '"v' + data.version + '"')

  return { data }
}

function version(request: Request) {
  const raw = request.get("If-Match")

  if (!raw) throw new MediaError(428, "PRECONDITION_REQUIRED")

  const match = /^"v([1-9][0-9]*)"$/.exec(raw)

  if (!match || !positive(Number(match[1]))) throw invalid()

  return Number(match[1])
}

function secret(request: Request, key: string | undefined) {
  if (!key) throw missing()

  const value = /^Bearer ([a-f0-9]{64})$/i.exec(
    request.get("Authorization") ?? "",
  )?.[1]

  if (
    !value ||
    !timingSafeEqual(Buffer.from(key, "hex"), Buffer.from(value, "hex"))
  )
    throw new MediaError(403, "FORBIDDEN")
}

@Controller("v1/media")
class MediaController {
  constructor(
    @Inject(CONFIG) readonly config: MediaConfig,

    @Inject(MediaStore) readonly store: MediaStore,
  ) {}

  private session(r: Request) {
    return this.store.dependencies.session(
      r.get("cookie") ?? "",

      r.get("X-Xijie-Expected-Session"),
    )
  }

  private async writer(r: Request, key = true) {
    if (r.get("origin") !== this.config.webOrigin)
      throw new MediaError(403, "FORBIDDEN")

    if (!r.get("X-Xijie-Expected-Session")) throw invalid()

    return {
      session: await this.session(r),

      key: key ? identifier(r.get("Idempotency-Key")) : "",
    }
  }

  @Post() async create(@Req() r: Request, @Body() body: unknown) {
    const a = await this.writer(r)

    return {
      data: await this.store.create(
        a.session.accountId,

        a.key,

        createInput(body),
      ),
    }
  }

  @Get(":id") async get(
    @Req() r: Request,

    @Param("id") id: string,

    @Res({ passthrough: true }) response: Response,
  ) {
    const a = await this.session(r)

    return tagged(response, await this.store.get(a.accountId, identifier(id)))
  }

  @Put(":id/uploads/:slotId") @HttpCode(200) async upload(
    @Req() r: Request,

    @Param("id") id: string,

    @Param("slotId") slotId: string,

    @Body() body: unknown,

    @Res({ passthrough: true }) response: Response,
  ) {
    const a = await this.writer(r)

    if (!Buffer.isBuffer(body)) throw invalid()

    return tagged(
      response,

      await this.store.upload(
        a.session.accountId,

        identifier(id),

        identifier(slotId),

        a.key,

        r.get("Content-Type") ?? "",

        body,
      ),
    )
  }

  @Post(":id/complete") @HttpCode(202) async complete(
    @Req() r: Request,

    @Param("id") id: string,

    @Body() body: unknown,

    @Res({ passthrough: true }) response: Response,
  ) {
    const a = await this.writer(r),
      x = object(body, ["uploadSlotId"])

    return tagged(
      response,

      await this.store.complete(
        a.session.accountId,

        identifier(id),

        identifier(x.uploadSlotId),

        a.key,
      ),
    )
  }

  @Post(":id/upload-slots") async slot(
    @Req() r: Request,

    @Param("id") id: string,

    @Body() body: unknown,
  ) {
    const a = await this.writer(r)

    if (body !== undefined) object(body, [])

    return {
      data: await this.store.newSlot(
        a.session.accountId,

        identifier(id),

        a.key,

        version(r),
      ),
    }
  }

  @Delete(":id") @HttpCode(204) async remove(
    @Req() r: Request,

    @Param("id") id: string,
  ) {
    const a = await this.writer(r)

    await this.store.remove(
      a.session.accountId,

      identifier(id),

      a.key,

      version(r),
    )
  }

  @Post(":id/read-url") @HttpCode(200) async read(
    @Req() r: Request,

    @Param("id") id: string,

    @Body() body: unknown,
  ) {
    const a = await this.writer(r, false),
      x = object(body, ["purpose", "target"]),
      target = object(x.target, x.purpose==='conversation_attachment'?["kind","id","conversationId"]:["kind", "id"])

    if (
      !(
        (x.purpose === "post_attachment" && target.kind === "post") ||
        (x.purpose === "person_photo" && target.kind === "person_draft") ||
        (x.purpose === 'gift_delivery_photo' && target.kind==='gift_delivery') ||
        (x.purpose==='conversation_attachment'&&target.kind==='conversation_message')
      )
    )
      throw invalid()

    return {
      data: await this.store.readUrl(
        a.session,

        identifier(id),

        identifier(target.id),

        String(x.purpose),
        x.purpose==='conversation_attachment'?identifier(target.conversationId):undefined,
      ),
    }
  }

  @Get(":id/content") async content(
    @Req() r: Request,

    @Param("id") id: string,

    @Res() response: Response,
  ) {
    if (!r.get("X-Xijie-Expected-Session") || r.get("Range")) throw invalid()

    const a = await this.session(r),
      bytes = await this.store.content(
        a,

        identifier(id),

        r.get("X-Media-Read-Proof") ?? "",
      )

    response.setHeader("Content-Type", "image/webp")

    response.setHeader("Content-Length", bytes.length)

    response.setHeader("Content-Disposition", "inline")

    response.send(bytes)
  }
}

@Controller('v1/person-voices')
class PersonVoicesController{
 constructor(@Inject(CONFIG)readonly config:MediaConfig,@Inject(MediaStore)readonly store:MediaStore){}
 private async session(r:Request){if(Object.keys(r.query).length)throw invalid();const expected=r.get('X-Xijie-Expected-Session');if(!expected)throw invalid();return this.store.dependencies.session(r.get('cookie')??'',identifier(expected))}
 private async writer(r:Request,key=true){if(r.get('Origin')!==this.config.webOrigin)throw new MediaError(403,'FORBIDDEN');return{session:await this.session(r),key:key?identifier(r.get('Idempotency-Key')):''}}
 @Post()async create(@Req()r:Request,@Body()body:unknown){const a=await this.writer(r);return{data:await this.store.voices.create(a.session.accountId,a.key,voiceInput(body))}}
 @Get('create-commands/:key')async accepted(@Req()r:Request,@Param('key')key:string){const a=await this.session(r);return{data:await this.store.voices.created(a.accountId,identifier(key))}}
 @Get(':id')async get(@Req()r:Request,@Param('id')id:string,@Res({passthrough:true})response:Response){const a=await this.session(r);return tagged(response,await this.store.voices.get(a.accountId,identifier(id)))}
 @Put(':id/uploads/:slotId')@HttpCode(200)async upload(@Req()r:Request,@Param('id')id:string,@Param('slotId')sid:string,@Body()body:unknown,@Res({passthrough:true})response:Response){const a=await this.writer(r);if(!Buffer.isBuffer(body))throw invalid();return tagged(response,await this.store.voices.upload(a.session.accountId,identifier(id),identifier(sid),a.key,version(r),r.get('Content-Type')??'',body))}
 @Post(':id/upload-slots')async renew(@Req()r:Request,@Param('id')id:string,@Body()body:unknown){const a=await this.writer(r);object(body,[]);return{data:await this.store.voices.renew(a.session.accountId,identifier(id),a.key,version(r))}}
 @Post(':id/complete')@HttpCode(202)async complete(@Req()r:Request,@Param('id')id:string,@Body()body:unknown,@Res({passthrough:true})response:Response){const a=await this.writer(r),v=object(body,['uploadSlotId']);return tagged(response,await this.store.voices.complete(a.session.accountId,identifier(id),identifier(v.uploadSlotId),a.key,version(r)))}
 @Delete(':id')@HttpCode(200)async revoke(@Req()r:Request,@Param('id')id:string,@Body()body:unknown,@Res({passthrough:true})response:Response){const a=await this.writer(r);if(body!==undefined)object(body,[]);return tagged(response,await this.store.voices.revoke(a.session.accountId,identifier(id),a.key,version(r)))}
 @Post(':id/read-proof')@HttpCode(200)async proof(@Req()r:Request,@Param('id')id:string,@Body()body:unknown){const a=await this.writer(r,false);object(body,[]);return{data:await this.store.voices.proof(a.session,identifier(id))}}
 @Get(':id/content')async content(@Req()r:Request,@Param('id')id:string,@Res()response:Response){if(r.get('Range'))throw invalid();const a=await this.session(r),bytes=await this.store.voices.content(a,identifier(id),r.get('X-Media-Read-Proof')??'');response.setHeader('Content-Type','audio/wav');response.setHeader('Content-Length',bytes.length);response.setHeader('Content-Disposition','inline');response.send(bytes)}
}
@Controller("internal/v1")
class InternalMediaController {
  constructor(
    @Inject(CONFIG) readonly config: MediaConfig,

    @Inject(MediaStore) readonly store: MediaStore,
  ) {}
  @Post('people/drafts/:id/voice-bindings') @HttpCode(200) async bindVoice(@Req()r:Request,@Param('id')id:string,@Body()body:unknown){secret(r,this.config.peopleToken);if(Object.keys(r.query).length)throw invalid();const v=object(body,['voiceId']);return{data:await this.store.voices.bind(identifier(r.get('X-Xijie-Account-Id')),identifier(id),identifier(v.voiceId))}}

  @Post('conversations/:conversationId/messages/:clientMessageId/media-bindings') @HttpCode(200) async bindConversation(@Req() r:Request,@Param('conversationId') conversationId:string,@Param('clientMessageId') clientMessageId:string,@Body() body:unknown){
    secret(r,this.config.conversationsToken)
    const x=object(body,['mediaId','version'])
    if(Object.keys(r.query).length||!positive(x.version))throw invalid()
    return{data:await this.store.bindConversation(identifier(r.get('X-Xijie-Account-Id')),identifier(conversationId),identifier(clientMessageId),identifier(x.mediaId),x.version)}
  }

  @Post('photo-reply-jobs/:jobId/attempts/:attemptId/media-content') @HttpCode(200) async photoReplyContent(@Req() r:Request,@Res() response:Response,@Param('jobId') jobId:string,@Param('attemptId') attemptId:string,@Body() body:unknown){
    secret(r,this.config.conversationsToken)
    if(Object.keys(r.query).length||r.get('Range'))throw invalid()
    if(body!==undefined)object(body,[])
    const bytes=await this.store.photoReplyContent(identifier(r.get('X-Xijie-Account-Id')),identifier(jobId),identifier(attemptId))
    response.setHeader('Content-Type','image/webp');response.setHeader('Content-Length',bytes.length);response.send(bytes)
  }

  @Post('gifts/deliveries/:id/media-bindings') @HttpCode(200) async bindGift(@Req() r:Request,@Param('id') id:string,@Body() body:unknown){
    secret(r,this.config.giftsToken)
    const x=object(body,['mediaId','photoVersion'])
    if(!Number.isSafeInteger(x.photoVersion)||Number(x.photoVersion)<2||Number(x.photoVersion)>2147483647)throw invalid()
    return{data:await this.store.bindGift(identifier(r.get('X-Xijie-Account-Id')),identifier(id),identifier(x.mediaId),Number(x.photoVersion))}
  }

  @Post("people/drafts/:id/media-bindings") @HttpCode(200) async bindPerson(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    secret(r, this.config.peopleToken)

    const x = object(body, ["mediaIds"])

    if (
      !Array.isArray(x.mediaIds) ||
      x.mediaIds.length > 6 ||
      new Set(x.mediaIds).size !== x.mediaIds.length
    )
      throw invalid()

    return {
      data: await this.store.bindPerson(
        identifier(r.get("X-Xijie-Account-Id")),
        identifier(id),
        x.mediaIds.map(identifier),
      ),
    }
  }

  @Post("social/posts/:id/media-bindings") @HttpCode(200) async bind(
    @Req() r: Request,

    @Param("id") id: string,

    @Body() body: unknown,
  ) {
    secret(r, this.config.socialToken)

    const x = object(body, ["clientPostId", "mediaIds"])

    if (
      !Array.isArray(x.mediaIds) ||
      !x.mediaIds.length ||
      x.mediaIds.length > 9 ||
      new Set(x.mediaIds).size !== x.mediaIds.length
    )
      throw invalid()

    return {
      data: await this.store.bind(
        identifier(r.get("X-Xijie-Account-Id")),

        identifier(id),

        identifier(x.clientPostId),

        x.mediaIds.map(identifier),
      ),
    }
  }

  @Post("social/posts/:id/media-release") @HttpCode(200) async release(
    @Req() r: Request,

    @Param("id") id: string,

    @Body() body: unknown,
  ) {
    secret(r, this.config.socialToken)

    object(body, [])

    return {
      data: await this.store.release(
        identifier(r.get("X-Xijie-Account-Id")),

        identifier(id),
      ),
    }
  }

  @Get("accounts/:id/data-export") async export(
    @Req() r: Request,

    @Param("id") id: string,

    @Query() q: Record<string, unknown>,
  ) {
    secret(r, this.config.rightsToken)

    if (
      Object.keys(q).some((k) => !["requestId", "scope"].includes(k)) ||
      !["account_data", "interaction_data"].includes(String(q.scope))
    )
      throw invalid()

    return {
      data: await new MediaDataRights(this.store).export(
        identifier(id),

        identifier(q.requestId),

        String(q.scope),
      ),
    }
  }

  @Post("accounts/:id/erase") @HttpCode(200) async erase(
    @Req() r: Request,

    @Param("id") id: string,

    @Body() body: unknown,
  ) {
    secret(r, this.config.rightsToken)

    const x = object(body, ["requestId"]),
      requestId = identifier(x.requestId)

    if (r.get("Idempotency-Key") !== requestId) throw invalid()

    return {
      data: await new MediaDataRights(this.store).erase(
        identifier(id),

        requestId,
      ),
    }
  }
}

export
@Module({})
class MediaModule {
  static register(config: MediaConfig, store: MediaStore): DynamicModule {
    return {
      module: MediaModule,

      controllers: [MediaController, PersonVoicesController, InternalMediaController],

      providers: [
        { provide: CONFIG, useValue: config },

        { provide: MediaStore, useValue: store },
      ],
    }
  }
}

export async function createMediaApp(config: MediaConfig, store: MediaStore) {
  const app = await NestFactory.create(MediaModule.register(config, store), {
      abortOnError: false,

      logger: ["error", "warn"],

      bodyParser: false,
    }),
    http = app.getHttpAdapter().getInstance()

  http.disable("x-powered-by")

  http.disable("etag")

  app.use(mediaHeaders)

  app.use(
    "/v1/media/:id/uploads/:slotId",

    raw({ type: () => true, limit: 10 * 1024 * 1024 }),
  )

  app.use('/v1/person-voices/:id/uploads/:slotId',raw({type:()=>true,limit:8*1024*1024}))
  app.use(json({ limit: 65536 }))

  app.useGlobalFilters(new MediaErrors())

  return app
}
