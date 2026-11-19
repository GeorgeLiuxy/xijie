import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  ArgumentsHost, Body, Catch, Controller, Delete, ExceptionFilter, Get, HttpCode, HttpException,
  Inject, Module, Param, Patch, Post, Put, Query, Req, Res, type DynamicModule,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import type { PeopleConfig } from './config.js'
import { confirmInput, draftFields, invalid, notFound, PeopleError, personFields, previewInput, worldInput, worldStagesInput, uuid, type DraftPosition } from './contracts.js'
import { resolveSession,resolveActiveAccount,resolveSocialAiAccount,resolveGiftReturnAccount } from './session.js'
import { PeopleStore } from './store.js'
import { eraseInput, erasePeople, exportPeople, rightsContext, rightsQuery, rightsToken } from './data-rights.js'
import {AutomaticSourceStore,automaticEventQuery,emptyAutomaticBody} from './automatic-sources.js'
import {bindPhotos,photoRefs} from './photos.js'
import {ReminderStore,reminderInput} from './reminders.js'
import {bindVoice,voiceRefs} from './voices.js'

const CONFIG = Symbol('PeopleConfig')

export function peopleHeaders(_request: Request, response: Response, next: () => void) {
  response.setHeader('X-Request-Id', randomUUID())
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Referrer-Policy', 'no-referrer')
  next()
}

@Catch()
export class PeopleErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>()
    if (response.headersSent) return
    const requestId = response.getHeader('X-Request-Id')
    let problem = new PeopleError(500, 'INTERNAL_ERROR', 'The people service could not complete the request.')
    if (error instanceof PeopleError) problem = error
    else if (error && typeof error === 'object' && 'code' in error && error.code === '42501'
      && error instanceof Error && error.message === 'Account data has been erased') problem = notFound()
    else if (error instanceof HttpException && error.getStatus() < 500) {
      const status = error.getStatus()
      problem = status === 404 ? notFound() : new PeopleError(status, 'INVALID_ARGUMENT', 'The draft request is invalid.')
    } else {
      console.error('People request failed', { requestId, type: error instanceof Error ? error.name : typeof error })
    }
    response.status(problem.status).json({
      error: { code: problem.code, message: problem.message, requestId, ...(problem.details ? { details: problem.details } : {}) },
    })
  }
}

function single<T extends { version: number }>(response: Response, data: T) {
  response.setHeader('ETag', '"v' + data.version + '"')
  return { data }
}

function identifier(id: string) {
  if (!uuid.test(id)) throw invalid()
  return id.toLowerCase()
}

function expectedVersion(request: Request) {
  const header = request.get('If-Match')
  if (!header) throw new PeopleError(428, 'PRECONDITION_REQUIRED', 'An If-Match resource version is required.')
  const match = /^"v([1-9][0-9]*)"$/.exec(header)
  const version = Number(match?.[1])
  if (!match || !Number.isInteger(version) || version > 2_147_483_647) throw invalid()
  return version
}


function pageParameters(query: Record<string, unknown>, filters: string[]) {
  if (Object.keys(query).some(key => !['limit', 'cursor', ...filters].includes(key))) throw invalid()
  if (query.limit !== undefined && (typeof query.limit !== 'string' || !/^[1-9][0-9]{0,2}$/.test(query.limit))) throw invalid()
  const limit = query.limit === undefined ? 20 : Number(query.limit)
  if (limit > 100 || (query.cursor !== undefined && typeof query.cursor !== 'string')) throw invalid()
  return { limit, cursor: query.cursor }
}

@Controller('v1')
class PeopleController {
  constructor(
    @Inject(CONFIG) private readonly config: PeopleConfig,
    @Inject(PeopleStore) private readonly store: PeopleStore,
  ) {}

  private session(request: Request, response: Response) {
    return resolveSession(
      this.config, request.get('cookie') || '', String(response.getHeader('X-Request-Id')),
      request.get('X-Xijie-Expected-Session'),
    )
  }

  private async writer(request: Request, response: Response, requiresStorage = true) {
    if (request.get('origin') !== this.config.webOrigin) {
      throw new PeopleError(403, 'FORBIDDEN', 'The request did not come from the registered web application.')
    }
    const session = await this.session(request, response)
    if (requiresStorage && !session.storyStorage.allowed) throw new PeopleError(403, 'FORBIDDEN', 'Permission to store a private story is required.')
    const key = request.get('Idempotency-Key')
    if (!key || !uuid.test(key)) throw invalid()
    return { session, key: key.toLowerCase() }
  }

  private async photos(request:Request,response:Response,session:Awaited<ReturnType<typeof resolveSession>>,draftId:string,ids:string[]){
    if(!ids.length)return {media:[]}
    if(!session.personPhotoStorage?.allowed)throw new PeopleError(403,'PHOTO_PERMISSION_REQUIRED','Permission to save person photos is required.')
    const binding=await bindPhotos(this.config,session.accountId,draftId,ids)
    const after=await this.session(request,response)
    if(!after.personPhotoStorage?.allowed||after.personPhotoStorage.authorizationVersion!==session.personPhotoStorage.authorizationVersion||!after.storyStorage.allowed||after.storyStorage.authorizationVersion!==session.storyStorage.authorizationVersion)throw new PeopleError(403,'PHOTO_PERMISSION_REQUIRED','The photo authorization changed. Read the current permission and retry.')
    return binding
  }

  private async voice(request:Request,response:Response,session:Awaited<ReturnType<typeof resolveSession>>,draftId:string,id:string){
    if(!session.personVoiceStorage?.allowed)throw new PeopleError(403,'VOICE_PERMISSION_REQUIRED','Permission to save voice samples is required.')
    const binding=await bindVoice(this.config,session.accountId,draftId,id),after=await this.session(request,response)
    if(!after.personVoiceStorage?.allowed||after.personVoiceStorage.authorizationVersion!==session.personVoiceStorage.authorizationVersion||!after.storyStorage.allowed||after.storyStorage.authorizationVersion!==session.storyStorage.authorizationVersion)throw new PeopleError(403,'VOICE_PERMISSION_REQUIRED','The voice sample authorization changed. Review it and retry.')
    return binding
  }

  private async selections(request:Request,response:Response,before:Awaited<ReturnType<typeof resolveSession>>,input:{mediaIds?:string[];voiceId?:string|null}){
    if(!input.mediaIds?.length&&!input.voiceId)return
    const after=await this.session(request,response)
    if(!after.storyStorage.allowed||after.storyStorage.authorizationVersion!==before.storyStorage.authorizationVersion)throw new PeopleError(403,'FORBIDDEN','The story authorization changed. Review it and retry.')
    if(input.mediaIds?.length&&(!after.personPhotoStorage?.allowed||after.personPhotoStorage.authorizationVersion!==before.personPhotoStorage?.authorizationVersion))throw new PeopleError(403,'PHOTO_PERMISSION_REQUIRED','The photo authorization changed.')
    if(input.voiceId&&(!after.personVoiceStorage?.allowed||after.personVoiceStorage.authorizationVersion!==before.personVoiceStorage?.authorizationVersion))throw new PeopleError(403,'VOICE_PERMISSION_REQUIRED','The voice sample authorization changed.')
  }

  private sign(accountId: string, status: string | undefined, limit: number, value: string) {
    return createHmac('sha256', Buffer.from(this.config.serviceToken, 'hex'))
      .update(JSON.stringify(['xijie-person-drafts-cursor-v1', accountId, status ?? null, limit, value]))
      .digest('base64url')
  }

  private decodeCursor(accountId: string, status: string | undefined, limit: number, value: string) {
    const parts = value.split('.')
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]{1,200}$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) throw invalid()
    const [encoded, signature] = parts
    if (!timingSafeEqual(Buffer.from(this.sign(accountId, status, limit, encoded)), Buffer.from(signature))) throw invalid()
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown
  }

  private position(accountId: string, filter: string | undefined, limit: number, cursor: string): DraftPosition {
    const position = this.decodeCursor(accountId, filter, limit, cursor) as Partial<DraftPosition> | null
    if (!position || typeof position.id !== 'string' || !uuid.test(position.id)
      || typeof position.updatedAt !== 'string' || !Number.isFinite(Date.parse(position.updatedAt))) throw invalid()
    return { id: position.id, updatedAt: position.updatedAt }
  }

  private page<T>(results: T[], accountId: string, filter: string | undefined, limit: number, position: (last: T) => unknown) {
    const data = results.slice(0, limit)
    const last = data.at(-1)
    let nextCursor = null
    if (last && results.length > limit) {
      const encoded = Buffer.from(JSON.stringify(position(last))).toString('base64url')
      nextCursor = encoded + '.' + this.sign(accountId, filter, limit, encoded)
    }
    return { data, meta: { nextCursor } }
  }

  @Get('person-drafts')
  async list(
    @Req() request: Request, @Res({ passthrough: true }) response: Response, @Query() query: Record<string, unknown>,
  ) {
    const { accountId } = await this.session(request, response)
    const { limit, cursor } = pageParameters(query, ['status'])
    const status = query.status
    if (status !== undefined && status !== 'draft' && status !== 'expired' && status !== 'confirmed') throw invalid()
    const after = cursor === undefined ? undefined : this.position(accountId, status, limit, cursor)
    const results = await this.store.list(accountId, status, after, limit + 1)
    return this.page(results, accountId, status, limit, last => ({ updatedAt: last.updatedAt, id: last.id }))
  }

  @Get('person-drafts/:id')
  async get(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Param('id') id: string) {
    const { accountId } = await this.session(request, response)
    return single(response, await this.store.get(accountId, identifier(id)))
  }

  @Post('person-drafts')
  async create(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: unknown) {
    const { session, key } = await this.writer(request, response)
    const data = await this.store.create(session.accountId, session.storyStorage.authorizationVersion, key, draftFields(body, false))
    return single(response, data)
  }

  @Patch('person-drafts/:id')
  async update(
    @Req() request: Request, @Res({ passthrough: true }) response: Response, @Param('id') id: string, @Body() body: unknown,
  ) {
    const input=draftFields(body,true),version=expectedVersion(request),draftId=identifier(id)
    if(input.voiceId!==undefined&&!request.get('X-Xijie-Expected-Session'))throw invalid()
    const { session, key } = await this.writer(request, response,!(Object.keys(input).length===1&&input.voiceId===null))
    const source=input.mediaIds===undefined&&!input.voiceId?undefined:await this.store.photoWriteSource(session.accountId,draftId,'draft',key,version,input)
    const binding=source===undefined||input.mediaIds===undefined?undefined:await this.photos(request,response,session,source,input.mediaIds)
    const voice=source&&input.voiceId?await this.voice(request,response,session,source,input.voiceId):undefined
    if(source)await this.selections(request,response,session,input)
    const data = await this.store.update(
      session.accountId, draftId, session.storyStorage.allowed?session.storyStorage.authorizationVersion:0, key, version, input,binding,voice,
    )
    return single(response, data)
  }
  @Post('person-drafts/:id/previews')
  @HttpCode(202)
  async createPreview(
    @Req() request: Request, @Res({ passthrough: true }) response: Response, @Param('id') id: string, @Body() body: unknown,
  ) {
    const { session, key } = await this.writer(request, response)
    const data = await this.store.createPreview(
      session.accountId, identifier(id), session.storyStorage.authorizationVersion, key, expectedVersion(request), previewInput(body),
    )
    return { data }
  }

  @Get('person-drafts/:id/previews/:previewId')
  async getPreview(
    @Req() request: Request, @Res({ passthrough: true }) response: Response,
    @Param('id') id: string, @Param('previewId') previewId: string,
  ) {
    const { accountId, storyStorage } = await this.session(request, response)
    const data = await this.store.getPreview(
      accountId, identifier(id), identifier(previewId), storyStorage.allowed ? storyStorage.authorizationVersion : null,
    )
    return { data }
  }

  @Post('person-drafts/:id/confirm')
  async confirm(
    @Req() request: Request, @Res({ passthrough: true }) response: Response, @Param('id') id: string, @Body() body: unknown,
  ) {
    const { session, key } = await this.writer(request, response)
    const current=await this.store.get(session.accountId,identifier(id))
    const version=expectedVersion(request),input=confirmInput(body)
    if(!await this.store.isCommandReplay(session.accountId,'confirm',current.id,key,{version,input})){
      if(current.mediaIds.length)await this.photos(request,response,session,current.id,current.mediaIds)
      if(current.voiceId)await this.voice(request,response,session,current.id,current.voiceId)
      await this.selections(request,response,session,{mediaIds:current.mediaIds,voiceId:current.voiceId})
    }
    const data = await this.store.confirm(
      session.accountId, identifier(id), session.storyStorage.authorizationVersion, key, version, input,
      String(response.getHeader('X-Request-Id')),
    )
    return single(response, data)
  }

  @Get('persons')
  async listPersons(
    @Req() request: Request, @Res({ passthrough: true }) response: Response, @Query() query: Record<string, unknown>,
  ) {
    const { accountId } = await this.session(request, response)
    const { limit, cursor } = pageParameters(query, ['worldId'])
    if (query.worldId !== undefined && typeof query.worldId !== 'string') throw invalid()
    const worldId = query.worldId === undefined ? undefined : identifier(query.worldId)
    const filter = 'persons:' + (worldId ?? '')
    const after = cursor === undefined ? undefined : this.position(accountId, filter, limit, cursor)
    const results = await this.store.listPersons(accountId, worldId, after, limit + 1)
    return this.page(results, accountId, filter, limit, last => ({ updatedAt: last.updatedAt, id: last.id }))
  }

  @Get('persons/:id')
  async getPerson(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Param('id') id: string) {
    const { accountId } = await this.session(request, response)
    return single(response, await this.store.getPerson(accountId, identifier(id)))
  }

  @Get('persons/:id/reminder')
  async reminder(@Req()request:Request,@Res({passthrough:true})response:Response,@Param('id')id:string){
    if(Object.keys(request.query).length)throw invalid()
    const s=await this.session(request,response)
    return single(response,await new ReminderStore(this.store.pool).get(s.accountId,identifier(id),s.storyStorage))
  }

  @Put('persons/:id/reminder')
  async setReminder(@Req()request:Request,@Res({passthrough:true})response:Response,@Param('id')id:string,@Body()body:unknown){
    if(!request.get('X-Xijie-Expected-Session')||Object.keys(request.query).length)throw invalid()
    const {session:s,key}=await this.writer(request,response,false)
    return single(response,await new ReminderStore(this.store.pool).update(s.accountId,identifier(id),s.storyStorage,key,expectedVersion(request),reminderInput(body)))
  }

  @Get('person-reminders')
  async reminderNotices(@Req()request:Request,@Res({passthrough:true})response:Response,@Query()query:Record<string,unknown>){
    const s=await this.session(request,response),{limit,cursor}=pageParameters(query,[]),filter='person-reminders'
    const after=cursor===undefined?undefined:this.position(s.accountId,filter,limit,cursor)
    const result=await new ReminderStore(this.store.pool).list(s.accountId,s.storyStorage,limit+1,after?{createdAt:after.updatedAt,id:after.id}:undefined)
    return this.page(result,s.accountId,filter,limit,last=>({updatedAt:last.createdAt,id:last.id}))
  }

  @Post('person-reminders/:id/read')
  @HttpCode(200)
  async readReminder(@Req()request:Request,@Res({passthrough:true})response:Response,@Param('id')id:string,@Body()body:unknown){
    if(!request.get('X-Xijie-Expected-Session')||!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length||Object.keys(request.query).length)throw invalid()
    const {session:s,key}=await this.writer(request,response,false)
    return single(response,await new ReminderStore(this.store.pool).read(s.accountId,identifier(id),s.storyStorage,key,expectedVersion(request)))
  }

  @Get('worlds')
  async listWorlds(
    @Req() request: Request, @Res({ passthrough: true }) response: Response, @Query() query: Record<string, unknown>,
  ) {
    const { accountId } = await this.session(request, response)
    const { limit, cursor } = pageParameters(query, [])
    let after: string | undefined
    if (cursor !== undefined) {
      const value = this.decodeCursor(accountId, 'worlds', limit, cursor)
      if (typeof value !== 'string') throw invalid()
      after = identifier(value)
    }
    const results = await this.store.worlds(after, limit + 1)
    return this.page(results, accountId, 'worlds', limit, last => last.id)
  }

  @Patch('persons/:id')
  async updatePerson(
    @Req() request: Request, @Res({ passthrough: true }) response: Response, @Param('id') id: string, @Body() body: unknown,
  ) {
    const input=personFields(body),version=expectedVersion(request),personId=identifier(id)
    if(input.voiceId!==undefined&&!request.get('X-Xijie-Expected-Session'))throw invalid()
    const { session, key } = await this.writer(request, response,!(Object.keys(input).length===1&&input.voiceId===null))
    const source=input.mediaIds===undefined&&!input.voiceId?undefined:await this.store.photoWriteSource(session.accountId,personId,'person',key,version,input)
    const binding=source===undefined||input.mediaIds===undefined?undefined:await this.photos(request,response,session,source,input.mediaIds)
    const voice=source&&input.voiceId?await this.voice(request,response,session,source,input.voiceId):undefined
    if(source)await this.selections(request,response,session,input)
    return single(response, await this.store.updatePerson(
      session.accountId, personId, key, version, input, String(response.getHeader('X-Request-Id')),binding,voice,
    ))
  }

  @Get('worlds/:id')
  async getWorld(@Req()request:Request,@Res({passthrough:true})response:Response,@Param('id')id:string){
    await this.session(request,response)
    if(Object.keys(request.query).length)throw invalid()
    return {data:await this.store.getWorld(identifier(id))}
  }

  @Post('persons/:id/world')
  @HttpCode(200)
  async movePerson(@Req()request:Request,@Res({passthrough:true})response:Response,@Param('id')id:string,@Body()body:unknown){
    const {session,key}=await this.writer(request,response)
    if(Object.keys(request.query).length)throw invalid()
    return single(response,await this.store.movePerson(session.accountId,identifier(id),key,expectedVersion(request),worldInput(body).worldId,String(response.getHeader('X-Request-Id'))))
  }

  @Get('persons/:id/world-movements')
  async movements(@Req()request:Request,@Res({passthrough:true})response:Response,@Param('id')id:string,@Query()query:Record<string,unknown>){
    const {accountId}=await this.session(request,response),personId=identifier(id),{limit,cursor}=pageParameters(query,[]),scope='world-movements:'+personId
    let before:number|undefined
    if(cursor!==undefined){const value=this.decodeCursor(accountId,scope,limit,cursor);if(!Number.isInteger(value)||Number(value)<2||Number(value)>2147483647)throw invalid();before=Number(value)}
    const results=await this.store.worldMovements(accountId,personId,before,limit+1)
    return this.page(results,accountId,scope,limit,last=>last.worldVersion)
  }

  @Delete('persons/:id')
  @HttpCode(204)
  async removePerson(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Param('id') id: string) {
    const { session, key } = await this.writer(request, response, false)
    await this.store.removePerson(session.accountId, identifier(id), key, expectedVersion(request), String(response.getHeader('X-Request-Id')))
  }
}

@Controller('internal/v1')
class InternalPeopleController {
  constructor(
    @Inject(CONFIG) private readonly config: PeopleConfig,
    @Inject(PeopleStore) private readonly store: PeopleStore,
  ) {}

  @Get('gifts/persons/:id')
  async giftPerson(@Req()request:Request,@Param('id')id:string,@Query()query:Record<string,unknown>){
    const expected=this.config.giftsServiceToken
    if(!expected)throw notFound()
    const token=/^Bearer ([a-f0-9]{64})$/i.exec(request.get('Authorization')??'')?.[1]
    if(!token||!timingSafeEqual(Buffer.from(token,'hex'),Buffer.from(expected,'hex')))throw new PeopleError(403,'FORBIDDEN','The calling service is not authorized.')
    if(Object.keys(query).length!==1||typeof query.accountId!=='string')throw invalid()
    const accountId=identifier(query.accountId),personId=identifier(id),trace=String(request.res?.getHeader('X-Request-Id')??randomUUID())
    const before=await resolveActiveAccount(this.config,accountId,trace)
    const data=await this.store.giftPerson(accountId,personId)
    const after=await resolveActiveAccount(this.config,accountId,trace),latest=await this.store.giftPerson(accountId,personId)
    if(before.accessVersion!==after.accessVersion||data.version!==latest.version||data.accessVersion!==latest.accessVersion)throw new PeopleError(409,'SOURCE_CHANGED','The gift recipient changed.')
    return {data}
  }

  @Get('gifts/persons/:id/return-context')
  async giftReturnContext(@Req()request:Request,@Param('id')id:string,@Query()query:Record<string,unknown>){
    const expected=this.config.giftsServiceToken
    if(!expected)throw notFound()
    const token=/^Bearer ([a-f0-9]{64})$/i.exec(request.get('Authorization')??'')?.[1]
    if(!token||!timingSafeEqual(Buffer.from(token,'hex'),Buffer.from(expected,'hex')))throw new PeopleError(403,'FORBIDDEN','The calling service is not authorized.')
    const keys=['accountId','expectedReturnAuthorizationVersion','expectedStoryAuthorizationVersion']
    if(Object.keys(query).length!==keys.length||Object.keys(query).some(key=>!keys.includes(key))||typeof query.accountId!=='string')throw invalid()
    const version=(value:unknown)=>{if(typeof value!=='string'||!/^[1-9][0-9]{0,9}$/.test(value)||Number(value)>2147483647)throw invalid();return Number(value)}
    const accountId=identifier(query.accountId),personId=identifier(id),returnVersion=version(query.expectedReturnAuthorizationVersion),storyVersion=version(query.expectedStoryAuthorizationVersion),trace=String(request.res?.getHeader('X-Request-Id')??randomUUID())
    const before=await resolveGiftReturnAccount(this.config,accountId,trace,returnVersion,storyVersion)
    // The current Social projection is a minimal person text projection, not Social events or photos.
    const person=await this.store.socialAiPerson(accountId,personId)
    const after=await resolveGiftReturnAccount(this.config,accountId,trace,returnVersion,storyVersion),latest=await this.store.socialAiPerson(accountId,personId)
    if(before.accessVersion!==after.accessVersion||before.giftStorage.authorizationVersion!==after.giftStorage.authorizationVersion)throw new PeopleError(403,'AUTHORIZATION_CHANGED','The gift return authorization changed.')
    if(person.version!==latest.version||person.accessVersion!==latest.accessVersion||person.worldId!==latest.worldId||person.worldVersion!==latest.worldVersion)throw new PeopleError(409,'SOURCE_CHANGED','The person context changed.')
    return {data:{person:{...person,calledMe:person.calledMe??'',status:'active',audience:'person'},accountAccessVersion:before.accessVersion,storyAuthorizationVersion:storyVersion,returnAuthorizationVersion:returnVersion}}
  }

  private mediaAccount(request:Request){
    const expected=this.config.mediaServiceToken
    if(!expected)throw notFound()
    const token=/^Bearer ([a-f0-9]{64})$/i.exec(request.get('Authorization')??'')?.[1]
    if(!token||!timingSafeEqual(Buffer.from(token,'hex'),Buffer.from(expected,'hex')))throw new PeopleError(403,'FORBIDDEN','The calling service is not authorized.')
    if(Object.keys(request.query).length)throw invalid()
    return identifier(request.get('X-Xijie-Account-Id')??'')
  }

  @Get('media/people/drafts/:id')
  async mediaTarget(@Req()request:Request,@Param('id')id:string){
    const accountId=this.mediaAccount(request)
    await resolveActiveAccount(this.config,accountId,String(request.res?.getHeader('X-Request-Id')??randomUUID()))
    return {data:await this.store.photoTarget(accountId,identifier(id))}
  }

  @Post('media/people/validate')
  @HttpCode(200)
  async validateMedia(@Req()request:Request,@Body()body:unknown){
    const accountId=this.mediaAccount(request),refs=photoRefs(body)
    await resolveActiveAccount(this.config,accountId,String(request.res?.getHeader('X-Request-Id')??randomUUID()))
    return {data:{valid:await this.store.validPhotos(accountId,refs)}}
  }

  @Get('media/people/drafts/:id/voice-binding-state')
  async voiceBindingState(@Req()request:Request,@Param('id')id:string){
    const accountId=this.mediaAccount(request),requestId=String(request.res?.getHeader('X-Request-Id')??randomUUID())
    const before=await resolveActiveAccount(this.config,accountId,requestId),data=await this.store.voiceBindingState(accountId,identifier(id)),after=await resolveActiveAccount(this.config,accountId,requestId)
    if(before.accessVersion!==after.accessVersion)throw notFound()
    return {data}
  }

  @Post('media/people/voices/validate')
  @HttpCode(200)
  async validateVoice(@Req()request:Request,@Body()body:unknown){const accountId=this.mediaAccount(request),refs=voiceRefs(body);await resolveActiveAccount(this.config,accountId,String(request.res?.getHeader('X-Request-Id')??randomUUID()));return {data:{valid:await this.store.validVoices(accountId,refs)}}}

  private socialSubject(request:Request){
    const expected=this.config.socialServiceToken
    if(!expected)throw notFound()
    const supplied=/^Bearer ([a-f0-9]{64})$/i.exec(request.get('Authorization')||'')?.[1]
    if(!supplied||!timingSafeEqual(Buffer.from(supplied,'hex'),Buffer.from(expected,'hex')))throw new PeopleError(403,'FORBIDDEN','The calling service is not authorized.')
    const accountId=request.get('X-Xijie-Account-Id')
    if(!accountId||!uuid.test(accountId))throw invalid()
    return accountId.toLowerCase()
  }

  private async socialAccount(request:Request){
    return resolveActiveAccount(this.config,this.socialSubject(request),String(request.res?.getHeader('X-Request-Id')??randomUUID()))
  }

  private async stableSocialAccount(request:Request,before:{accountId:string;accessVersion:number}){
    const after=await resolveActiveAccount(this.config,before.accountId,String(request.res?.getHeader('X-Request-Id')??randomUUID()))
    if(after.accessVersion!==before.accessVersion)throw notFound()
  }

  @Get('social/persons')
  async socialPersons(@Req()request:Request){
    const account=await this.socialAccount(request)
    if(Object.keys(request.query).length)throw invalid()
    const data=await this.store.socialPersons(account.accountId)
    await this.stableSocialAccount(request,account)
    return {data}
  }

  @Get('social/persons/:id/world-movements')
  async socialMovements(@Req()request:Request,@Param('id')id:string,@Query()query:Record<string,unknown>){
    const account=await this.socialAccount(request)
    if(Object.keys(query).some(key=>!['afterVersion','throughVersion','limit'].includes(key)))throw invalid()
    const integer=(value:unknown)=>typeof value==='string'&&/^[1-9][0-9]{0,9}$/.test(value)&&Number(value)<=2147483647?Number(value):undefined
    const afterVersion=integer(query.afterVersion),throughVersion=integer(query.throughVersion),limit=query.limit===undefined?100:integer(query.limit)
    if(afterVersion===undefined||throughVersion===undefined||limit===undefined||limit>100||afterVersion>throughVersion)throw invalid()
    const data=await this.store.socialWorldMovements(account.accountId,identifier(id),afterVersion,throughVersion,limit)
    await this.stableSocialAccount(request,account)
    return {data}
  }

  private aiVersion(query:Record<string,unknown>){
    if(Object.keys(query).length!==1||typeof query.expectedAiVersion!=='string'||!/^[1-9][0-9]{0,9}$/.test(query.expectedAiVersion)||Number(query.expectedAiVersion)>2147483647)throw invalid()
    return Number(query.expectedAiVersion)
  }

  private async socialAiContext(request:Request,id:string,query:Record<string,unknown>,world:boolean){
    const accountId=this.socialSubject(request),expected=this.aiVersion(query),personId=identifier(id),trace=String(request.res?.getHeader('X-Request-Id')??randomUUID())
    const before=await resolveSocialAiAccount(this.config,accountId,trace,expected),person=await this.store.socialAiPerson(accountId,personId)
    const data=world?await this.store.worldContext(accountId,personId):person
    const after=await resolveSocialAiAccount(this.config,accountId,trace,expected),latest=await this.store.socialAiPerson(accountId,personId)
    if(before.accessVersion!==after.accessVersion||before.storyStorage.authorizationVersion!==after.storyStorage.authorizationVersion)throw new PeopleError(403,'AI_PERMISSION_REQUIRED','The processing authorization changed.')
    if(person.version!==latest.version||person.accessVersion!==latest.accessVersion||person.worldId!==latest.worldId||person.worldVersion!==latest.worldVersion||world&&'personVersion' in data&&data.personVersion!==person.version)throw new PeopleError(409,'SOURCE_CHANGED','The person context changed.')
    return {data}
  }

  @Get('social/persons/:id/ai-context')
  async socialAiPerson(@Req()request:Request,@Param('id')id:string,@Query()query:Record<string,unknown>){return this.socialAiContext(request,id,query,false)}

  @Get('social/persons/:id/world-context')
  async socialAiWorld(@Req()request:Request,@Param('id')id:string,@Query()query:Record<string,unknown>){return this.socialAiContext(request,id,query,true)}

  private authorizeAutomaticMemory(request:Request) {
    const expected=this.config.memoriesServiceToken
    if(!expected)throw notFound()
    const supplied=/^Bearer ([a-f0-9]{64})$/i.exec(request.get('Authorization')||'')?.[1]
    if(!supplied||!timingSafeEqual(Buffer.from(supplied,'hex'),Buffer.from(expected,'hex')))throw new PeopleError(403,'FORBIDDEN','The calling service is not authorized.')
  }

  @Get('automatic-memory/events')
  async automaticEvents(@Req() request:Request,@Query() query:Record<string,unknown>) {
    this.authorizeAutomaticMemory(request)
    const {accountIds,limit}=automaticEventQuery(query)
    return {data:await new AutomaticSourceStore(this.store.pool).events(accountIds,limit)}
  }

  @Post('automatic-memory/events/:id/ack')
  @HttpCode(200)
  async automaticAck(@Req() request:Request,@Param('id') id:string,@Body() body:unknown) {
    this.authorizeAutomaticMemory(request)
    if(Object.keys(request.query).length)throw invalid()
    emptyAutomaticBody(body)
    return {data:await new AutomaticSourceStore(this.store.pool).ack(identifier(id))}
  }

  @Get('accounts/:accountId/data-export')
  async dataExport(@Req() request: Request, @Param('accountId') account: string, @Query() query: Record<string, unknown>) {
    rightsToken(this.config, request)
    const accountId = identifier(account), { requestId, scope } = rightsQuery(query)
    const before = await rightsContext(this.config, accountId, requestId, 'export', scope)
    const data = await exportPeople(this.store.pool, accountId, scope)
    const after = await rightsContext(this.config, accountId, requestId, 'export', scope)
    if (before.accountAccessVersion !== after.accountAccessVersion) throw new PeopleError(409, 'EXPORT_STALE', 'Account access changed while exporting.')
    return { data }
  }

  @Post('accounts/:accountId/erase')
  @HttpCode(200)
  async erase(@Req() request: Request, @Param('accountId') account: string, @Body() body: unknown) {
    rightsToken(this.config, request)
    const accountId = identifier(account), requestId = eraseInput(request, body)
    await rightsContext(this.config, accountId, requestId, 'delete_account')
    return { data: await erasePeople(this.store.pool, accountId, requestId) }
  }

  private authorize(request: Request, conversationsOnly=false) {
    const tokens = (conversationsOnly?[this.config.conversationsServiceToken]:[this.config.conversationsServiceToken, this.config.memoriesServiceToken]).filter((value): value is string => Boolean(value))
    if (!tokens.length) throw notFound()
    const supplied = /^Bearer ([a-f0-9]{64})$/i.exec(request.get('Authorization') || '')?.[1]
    if (!supplied || !tokens.some(expected => timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(expected, 'hex')))) {
      throw new PeopleError(403, 'FORBIDDEN', 'The calling service is not authorized.')
    }
  }

  private account(request: Request, conversationsOnly=false) {
    this.authorize(request,conversationsOnly)
    const accountId = request.get('X-Xijie-Account-Id')
    if (!accountId || !uuid.test(accountId)) throw invalid()
    return accountId.toLowerCase()
  }

  @Get('persons/:id/context')
  async context(@Req() request: Request, @Param('id') id: string) {
    return { data: await this.store.personContext(this.account(request), identifier(id)) }
  }

  @Get('persons/:id/world-context')
  async worldContext(@Req()request:Request,@Param('id')id:string){
    const accountId=this.account(request)
    if(Object.keys(request.query).length)throw invalid()
    await resolveActiveAccount(this.config,accountId,String(request.res?.getHeader('X-Request-Id')??randomUUID()))
    return {data:await this.store.worldContext(accountId,identifier(id))}
  }

  @Get('worlds/:id/gather-context')
  async gatherContext(@Req()request:Request,@Param('id')id:string){
    const accountId=this.account(request,true),worldId=identifier(id)
    if(Object.keys(request.query).length)throw invalid()
    const trace=String(request.res?.getHeader('X-Request-Id')??randomUUID())
    const before=await resolveActiveAccount(this.config,accountId,trace)
    const data=await this.store.gatherContext(accountId,worldId)
    // Each source snapshot has committed before the independent Identity call.
    const after=await resolveActiveAccount(this.config,accountId,trace)
    const latest=await this.store.gatherContext(accountId,worldId)
    if(before.accessVersion!==after.accessVersion)throw notFound()
    if(data.revision!==latest.revision)throw new PeopleError(409,'SOURCE_CHANGED','The world resident directory changed.')
    return {data}
  }

  @Post('persons/:id/world-stages/resolve')
  @HttpCode(200)
  async resolveWorldStages(@Req()request:Request,@Param('id')id:string,@Body()body:unknown){
    const accountId=this.account(request,true),personId=identifier(id),input=worldStagesInput(body)
    if(Object.keys(request.query).length)throw invalid()
    const trace=String(request.res?.getHeader('X-Request-Id')??randomUUID())
    const before=await resolveActiveAccount(this.config,accountId,trace)
    const data=await this.store.resolveWorldStages(accountId,personId,input)
    // Both SQL snapshots finish before/after the independent Identity request.
    const after=await resolveActiveAccount(this.config,accountId,trace)
    if(before.accessVersion!==after.accessVersion)throw notFound()
    const latest=await this.store.resolveWorldStages(accountId,personId,input)
    if(JSON.stringify(data)!==JSON.stringify(latest))throw new PeopleError(409,'SOURCE_CHANGED','The person world context changed.')
    return {data}
  }

  @Get('persons')
  async list(@Req() request: Request) {
    return { data: await this.store.personContexts(this.account(request)) }
  }

  @Get('worlds')
  async worlds(@Req() request: Request) {
    this.authorize(request)
    return { data: (await this.store.worlds(undefined, 1000)).filter(world => world.enabled) }
  }
}

@Module({})
export class PeopleModule {
  static register(config: PeopleConfig, store: PeopleStore): DynamicModule {
    return {
      module: PeopleModule,
      controllers: [PeopleController, InternalPeopleController],
      providers: [{ provide: CONFIG, useValue: config }, { provide: PeopleStore, useValue: store }],
    }
  }
}
