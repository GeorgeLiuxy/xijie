import {SharedMemoriesController,SHARED_CONFIG} from './shared-http.js'
import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto'
import {ArgumentsHost,Body,Catch,Controller,Delete,ExceptionFilter,Get,HttpCode,HttpException,Inject,Module,Param,Patch,Post,Query,Req,Res,type DynamicModule} from '@nestjs/common'
import type {Request,Response} from 'express'
import type {MemoryConfig} from './config.js'
import {MemoryError,createInput,invalid,notFound,patchInput,queryText,suggestionInput,emptyInput,unavailable,uuid} from './contracts.js'
import {MemoryStore} from './store.js'
import {ReferralQualification} from './referrals.js'
import {CandidateStore} from './candidates.js'
import {MemoryDataRights,type ExportScope} from './data-rights.js'
import {AutomaticMemoryStore} from './automatic-store.js'
import {SocialMemorySources,socialEventQuery,socialSourceVersions,socialRefs,emptySocialBody} from './social-sources.js'
import {MemoryImports,memoryImportInput} from './imports.js'
const CONFIG=Symbol('MemoryConfig')
const AUTOMATIC=Symbol('AutomaticMemoryStore')
const AUTOMATIC_CONTROL=Symbol('AutomaticMemoryControls')
const identifier=(value:string)=>{if(!uuid.test(value))throw invalid();return value.toLowerCase()}
export function memoryHeaders(_request:Request,response:Response,next:()=>void){response.setHeader('X-Request-Id',randomUUID());response.setHeader('Cache-Control','no-store');response.setHeader('Referrer-Policy','no-referrer');next()}
@Catch()
export class MemoryErrors implements ExceptionFilter{
 catch(error:unknown,host:ArgumentsHost){const response=host.switchToHttp().getResponse<Response>();if(response.headersSent)return;let problem=new MemoryError(500,'INTERNAL_ERROR','The memory request could not be completed.');if(error instanceof MemoryError)problem=error;else if(error&&typeof error==='object'&&'code' in error&&error.code==='42501'&&'message' in error&&error.message==='Account data has been erased.')problem=notFound();else if(error instanceof HttpException&&error.getStatus()<500)problem=error.getStatus()===404?notFound():invalid();else console.error('Memory request failed',{requestId:response.getHeader('X-Request-Id'),type:error instanceof Error?error.name:typeof error});response.status(problem.status).json({error:{code:problem.code,message:problem.message,requestId:response.getHeader('X-Request-Id')}})}
}
function version(request:Request){const header=request.get('If-Match');if(!header)throw new MemoryError(428,'PRECONDITION_REQUIRED','Supply the current memory version.');const match=/^"v([1-9][0-9]*)"$/.exec(header);if(!match||!Number.isSafeInteger(Number(match[1])))throw invalid();return Number(match[1])}
function page(query:Record<string,unknown>,extra:string[]=[]){if(Object.keys(query).some(key=>!['cursor','limit',...extra].includes(key)))throw invalid();if(query.limit!==undefined&&(typeof query.limit!=='string'||!/^([1-9][0-9]{0,2})$/.test(query.limit)))throw invalid();const limit=query.limit===undefined?20:Number(query.limit);if(limit>100||query.cursor!==undefined&&(typeof query.cursor!=='string'||query.cursor.length>1800))throw invalid();return {limit,cursor:query.cursor as string|undefined}}
function tagged<T extends {version:number}>(response:Response,data:T){response.setHeader('ETag','"v'+data.version+'"');return {data}}
@Controller('v1')
class MemoriesController{
 constructor(@Inject(CONFIG)private readonly config:MemoryConfig,@Inject(MemoryStore)private readonly store:MemoryStore,@Inject(CandidateStore)private readonly candidates:CandidateStore|null,@Inject(AUTOMATIC_CONTROL)private readonly automaticControl:AutomaticMemoryStore|null){}
 private candidateService(){if(!this.candidates)throw unavailable();return this.candidates}
 private controlledMemories(){if(!this.automaticControl)throw unavailable();return this.automaticControl}
 private jobQuery(query:Record<string,unknown>){if(Object.keys(query).some(key=>key!=='kind')||query.kind!=='memory_suggestion')throw invalid()}
 private session(request:Request){return this.store.dependencies.session(request.get('cookie')||'',request.get('X-Xijie-Expected-Session'))}
 private async writer(request:Request){if(request.get('origin')!==this.config.webOrigin)throw new MemoryError(403,'FORBIDDEN','The request did not come from the registered application.');const session=await this.session(request),key=request.get('Idempotency-Key');if(!key||!uuid.test(key))throw invalid();return {session,key:key.toLowerCase(),requestId:String(request.res?.getHeader('X-Request-Id')??randomUUID())}}
 private sign(scope:unknown,value:unknown){const encoded=Buffer.from(JSON.stringify(value)).toString('base64url'),signature=createHmac('sha256',this.config.serviceToken).update(JSON.stringify(['xijie-memories-v1',scope,encoded])).digest('base64url');return encoded+'.'+signature}
 private read(scope:unknown,value:string):unknown{const parts=value.split('.');if(parts.length!==2||!/^[A-Za-z0-9_-]{1,1700}$/.test(parts[0])||!/^[A-Za-z0-9_-]{43}$/.test(parts[1]))throw invalid();let result:unknown;try{result=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'))}catch{throw invalid()}const expected=this.sign(scope,result);if(value.length!==expected.length||!timingSafeEqual(Buffer.from(value),Buffer.from(expected)))throw invalid();return result}
 @Post('persons/:personId/memories')
 async create(@Req()request:Request,@Res({passthrough:true})response:Response,@Param('personId')personId:string,@Body()body:unknown){const {session,key,requestId}=await this.writer(request);return tagged(response,await this.store.create(session.accountId,identifier(personId),key,createInput(body),requestId))}
 @Post('persons/:personId/memory-imports')
 @HttpCode(200)
 async importMemories(@Req()request:Request,@Param('personId')personId:string,@Body()body:unknown){if(!request.get('X-Xijie-Expected-Session')||Object.keys(request.query).length)throw invalid();const {session,key,requestId}=await this.writer(request);return {data:await new MemoryImports(this.store).create(session.accountId,identifier(personId),key,version(request),memoryImportInput(body),requestId)}}
 @Post('persons/:personId/memory-candidates')
 @HttpCode(202)
 async suggest(@Req()request:Request,@Param('personId')personId:string,@Body()body:unknown){const {session,key,requestId}=await this.writer(request);return {data:await this.candidateService().request(session.accountId,identifier(personId),suggestionInput(body).sourceMessageId,key,requestId)}}
 @Get('persons/:personId/memory-candidates/:id')
 async candidate(@Req()request:Request,@Res({passthrough:true})response:Response,@Param('personId')personId:string,@Param('id')id:string){const session=await this.session(request);return tagged(response,await this.candidateService().candidate(session.accountId,identifier(personId),identifier(id)))}
 @Get('generation-jobs/:id')
 async job(@Req()request:Request,@Res({passthrough:true})response:Response,@Param('id')id:string,@Query()query:Record<string,unknown>){this.jobQuery(query);const session=await this.session(request);return tagged(response,await this.candidateService().job(session.accountId,identifier(id)))}
 @Post('generation-jobs/:id/cancel')
 @HttpCode(200)
 async cancel(@Req()request:Request,@Res({passthrough:true})response:Response,@Param('id')id:string,@Query()query:Record<string,unknown>,@Body()body:unknown){this.jobQuery(query);emptyInput(body);const {session,key,requestId}=await this.writer(request);return tagged(response,await this.candidateService().cancel(session.accountId,identifier(id),key,requestId))}
 @Post('generation-jobs/:id/retry')
 @HttpCode(202)
 async retry(@Req()request:Request,@Res({passthrough:true})response:Response,@Param('id')id:string,@Query()query:Record<string,unknown>,@Body()body:unknown){this.jobQuery(query);emptyInput(body);const {session,key,requestId}=await this.writer(request);return tagged(response,await this.candidateService().retry(session.accountId,identifier(id),key,requestId))}
 @Get('persons/:personId/memories')
 async list(@Req()request:Request,@Param('personId')personId:string,@Query()query:Record<string,unknown>){
  const session=await this.session(request),pid=identifier(personId),{limit,cursor}=page(query,['include']);if(query.include!==undefined&&query.include!=='body')throw invalid();const include=query.include==='body',scope=['list',session.accountId,pid,limit,include];let after:{at:string;id:string}|undefined
  if(cursor){const value=this.read(scope,cursor) as {at?:unknown;id?:unknown}|null;if(!value||typeof value.at!=='string'||!Number.isFinite(Date.parse(value.at))||typeof value.id!=='string'||!uuid.test(value.id))throw invalid();after={at:value.at,id:value.id}}
  const items=await this.store.list(session.accountId,pid,after,limit+1,include),data=items.slice(0,limit),last=data.at(-1);return {data,meta:{nextCursor:items.length>limit&&last?this.sign(scope,{at:last.confirmedAt,id:last.id}):null}}
 }
 @Get('persons/:personId/memories/automatic')
 async managedAutomatic(@Req()request:Request,@Param('personId')personId:string,@Query()query:Record<string,unknown>){
  if(!request.get('X-Xijie-Expected-Session'))throw invalid()
  const session=await this.session(request),pid=identifier(personId),{limit,cursor}=page(query),scope=['automatic',session.accountId,pid,limit]
  let after:{at:string;id:string}|undefined
  if(cursor){const value=this.read(scope,cursor) as {at?:unknown;id?:unknown}|null;if(!value||typeof value.at!=='string'||!Number.isFinite(Date.parse(value.at))||typeof value.id!=='string'||!uuid.test(value.id))throw invalid();after={at:value.at,id:value.id}}
  const result=await this.controlledMemories().managedList(session.accountId,pid,after,limit)
  return {data:result.items,meta:{nextCursor:result.next?this.sign(scope,result.next):null}}
 }
 @Patch('persons/:personId/memories/automatic/:id')
 async correctAutomatic(@Req()request:Request,@Res({passthrough:true})response:Response,@Param('personId')personId:string,@Param('id')id:string,@Body()body:unknown){
  if(!request.get('X-Xijie-Expected-Session')||Object.keys(request.query).length)throw invalid()
  const {session,key}=await this.writer(request),{title,body:corrected}=patchInput(body)
  if(title===undefined||corrected===undefined||[...corrected].length>600)throw invalid()
  return tagged(response,await this.controlledMemories().control(session.accountId,identifier(personId),identifier(id),key,version(request),{topic:title,body:corrected}))
 }
 @Delete('persons/:personId/memories/automatic/:id')
 @HttpCode(200)
 async stopAutomatic(@Req()request:Request,@Res({passthrough:true})response:Response,@Param('personId')personId:string,@Param('id')id:string,@Body()body:unknown){
  if(!request.get('X-Xijie-Expected-Session')||Object.keys(request.query).length)throw invalid()
  emptyInput(body)
  const {session,key}=await this.writer(request)
  return tagged(response,await this.controlledMemories().control(session.accountId,identifier(personId),identifier(id),key,version(request)))
 }
 @Get('persons/:personId/memories/:id')
 async detail(@Req()request:Request,@Res({passthrough:true})response:Response,@Param('personId')personId:string,@Param('id')id:string){const session=await this.session(request);return tagged(response,await this.store.detail(session.accountId,identifier(personId),identifier(id)))}
 @Patch('persons/:personId/memories/:id')
 async patch(@Req()request:Request,@Res({passthrough:true})response:Response,@Param('personId')personId:string,@Param('id')id:string,@Body()body:unknown){const {session,key,requestId}=await this.writer(request);return tagged(response,await this.store.patch(session.accountId,identifier(personId),identifier(id),key,version(request),patchInput(body),requestId))}
 @Delete('persons/:personId/memories/:id')
 @HttpCode(200)
 async remove(@Req()request:Request,@Res({passthrough:true})response:Response,@Param('personId')personId:string,@Param('id')id:string){const {session,key,requestId}=await this.writer(request);return tagged(response,await this.store.remove(session.accountId,identifier(personId),identifier(id),key,version(request),requestId))}
 @Get('search')
 async search(@Req()request:Request,@Query()query:Record<string,unknown>){
  const session=await this.session(request),{limit,cursor}=page(query,['scope','q','locale']);if(query.scope!=='atlas'||query.locale!==undefined&&!['zh-CN','en'].includes(String(query.locale)))throw invalid();const q=queryText(query.q),locale=query.locale==='en'?'en':'zh-CN',scope=['search',session.accountId,q.normalize('NFKC').toLowerCase(),locale,limit];let offset=0
  if(cursor){const value=this.read(scope,cursor) as {offset?:unknown}|null;if(!value||!Number.isSafeInteger(value.offset)||Number(value.offset)<0)throw invalid();offset=Number(value.offset)}
  const items=await this.store.search(session.accountId,q,locale),data=items.slice(offset,offset+limit);return {data,meta:{nextCursor:offset+limit<items.length?this.sign(scope,{offset:offset+limit}):null}}
 }
}
@Controller('internal/v1')
class InternalMemoriesController{
 constructor(@Inject(CONFIG)private readonly config:MemoryConfig,@Inject(MemoryStore)private readonly store:MemoryStore){}
 private references(request:Request,personId:string,body:unknown,query:Record<string,unknown>){
  const token=/^Bearer ([a-f0-9]{64})$/i.exec(request.get('Authorization')||'')?.[1]
  if(!token||!timingSafeEqual(Buffer.from(token,'hex'),Buffer.from(this.config.conversationsToken,'hex')))throw new MemoryError(403,'FORBIDDEN','The calling service is not authorized.')
  const accountId=request.get('X-Xijie-Account-Id')
  if(!accountId||!uuid.test(accountId)||Object.keys(query).length||!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>key!=='refs'))throw invalid()
  const pid=identifier(personId),refs=(body as {refs:{id:string;version:number}[]}).refs
  return {accountId:accountId.toLowerCase(),personId:pid,refs}
 }
 @Post('persons/:personId/memories/validate')
 @HttpCode(200)
 async validate(@Req()request:Request,@Param('personId')personId:string,@Body()body:unknown,@Query()query:Record<string,unknown>){
  const scope=this.references(request,personId,body,query)
  return {data:{personId:scope.personId,valid:await this.store.validateContextReferences(scope.accountId,scope.personId,scope.refs)}}
 }
 @Post('persons/:personId/letter-memory/validate')
 @HttpCode(200)
 async validateLetter(@Req()request:Request,@Param('personId')personId:string,@Body()body:unknown,@Query()query:Record<string,unknown>){
  const scope=this.references(request,personId,body,query)
  return {data:{personId:scope.personId,valid:await this.store.validateLetterReference(scope.accountId,scope.personId,scope.refs)}}
 }
 @Get('persons/:personId/memories/context')
 async context(@Req()request:Request,@Param('personId')personId:string,@Query()query:Record<string,unknown>){
  const token=/^Bearer ([a-f0-9]{64})$/i.exec(request.get('Authorization')||'')?.[1];if(!token||!timingSafeEqual(Buffer.from(token,'hex'),Buffer.from(this.config.conversationsToken,'hex')))throw new MemoryError(403,'FORBIDDEN','The calling service is not authorized.')
  const accountId=request.get('X-Xijie-Account-Id');if(!accountId||!uuid.test(accountId)||Object.keys(query).some(key=>key!=='q')||query.q!==undefined&&(typeof query.q!=='string'||[...query.q].length>4000||query.q.includes('\0')||/\p{Surrogate}/u.test(query.q)))throw invalid()
  return {data:await this.store.context(accountId.toLowerCase(),identifier(personId),query.q as string|undefined)}
 }
}
@Controller('internal/v1/persons/:personId/automatic-memories')
class InternalAutomaticMemoriesController{
 constructor(@Inject(CONFIG)private readonly config:MemoryConfig,@Inject(MemoryStore)private readonly store:MemoryStore,@Inject(AUTOMATIC)private readonly automatic:AutomaticMemoryStore|null){}
 private authorize(request:Request){
  const token=/^Bearer ([a-f0-9]{64})$/i.exec(request.get('Authorization')||'')?.[1]
  if(!token||!timingSafeEqual(Buffer.from(token,'hex'),Buffer.from(this.config.conversationsToken,'hex')))throw new MemoryError(403,'FORBIDDEN','The calling service is not authorized.')
  const accountId=request.get('X-Xijie-Account-Id');if(!accountId||!uuid.test(accountId))throw invalid()
  return accountId.toLowerCase()
 }
 @Get('context')
 async context(@Req()request:Request,@Param('personId')personId:string,@Query()query:Record<string,unknown>){
  const accountId=this.authorize(request),pid=identifier(personId)
  if(Object.keys(query).some(key=>key!=='q')||query.q!==undefined&&(typeof query.q!=='string'||[...query.q].length>4000||query.q.includes('\0')||/\p{Surrogate}/u.test(query.q)))throw invalid()
  await this.store.access(accountId,pid)
  return {data:{personId:pid,entries:this.automatic?await this.automatic.context(accountId,pid,query.q as string|undefined):[]}}
 }
 @Post('validate')
 @HttpCode(200)
 async validate(@Req()request:Request,@Param('personId')personId:string,@Body()body:unknown){
  const accountId=this.authorize(request),pid=identifier(personId)
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>key!=='refs'))throw invalid()
  const refs=(body as {refs?:{id:string;version:number}[]}).refs
  if(!Array.isArray(refs)||refs.length>8||refs.some(ref=>!ref||typeof ref!=='object'||Object.keys(ref).some(key=>!['id','version'].includes(key))||typeof ref.id!=='string'||!uuid.test(ref.id)||!Number.isSafeInteger(ref.version)||ref.version<1)||new Set(refs.map(ref=>ref.id.toLowerCase())).size!==refs.length)throw invalid()
  await this.store.access(accountId,pid)
  return {data:{personId:pid,valid:refs.length===0||!!this.automatic&&await this.automatic.validate(accountId,pid,refs.map(ref=>({id:ref.id.toLowerCase(),version:ref.version})))}}
 }
}
@Controller('internal/v1/social')
class InternalSocialMemoriesController{
 constructor(@Inject(CONFIG)private readonly config:MemoryConfig,@Inject(MemoryStore)private readonly store:MemoryStore){}
 private authorize(request:Request){
  const expected=this.config.socialToken
  if(!expected)throw notFound()
  const token=/^Bearer ([a-f0-9]{64})$/i.exec(request.get('Authorization')||'')?.[1]
  if(!token||!timingSafeEqual(Buffer.from(token,'hex'),Buffer.from(expected,'hex')))throw new MemoryError(403,'FORBIDDEN','The calling service is not authorized.')
 }
 private account(request:Request){this.authorize(request);const id=request.get('X-Xijie-Account-Id');if(!id||!uuid.test(id))throw invalid();return id.toLowerCase()}
 private sources(){return new SocialMemorySources(this.store)}
 @Get('memory-events')
 async events(@Req()request:Request,@Query()query:Record<string,unknown>){this.authorize(request);const {accountIds,limit}=socialEventQuery(query);return {data:await this.sources().events(accountIds,limit)}}
 @Post('memory-events/:id/ack')
 @HttpCode(200)
 async ack(@Req()request:Request,@Param('id')id:string,@Body()body:unknown){this.authorize(request);if(Object.keys(request.query).length)throw invalid();emptySocialBody(body);return {data:await this.sources().ack(identifier(id))}}
 @Get('persons/:personId/memories/:id/context')
 async context(@Req()request:Request,@Param('personId')personId:string,@Param('id')id:string,@Query()query:Record<string,unknown>){const accountId=this.account(request),versions=socialSourceVersions(query);return {data:await this.sources().context(accountId,identifier(personId),identifier(id),versions.expectedVersion,versions.expectedAiVersion)}}
 @Post('persons/:personId/memories/validate')
 @HttpCode(200)
 async validate(@Req()request:Request,@Param('personId')personId:string,@Body()body:unknown){const accountId=this.account(request);if(Object.keys(request.query).length)throw invalid();return {data:await this.sources().validate(accountId,identifier(personId),socialRefs(body))}}
}
@Controller('internal/v1/referrals')
class InternalReferralMemoriesController{
 constructor(@Inject(CONFIG)private readonly config:MemoryConfig,@Inject(MemoryStore)private readonly store:MemoryStore){}
 @Get('accounts/:id/qualification')
 async qualification(@Req()request:Request,@Param('id')id:string,@Query()query:Record<string,unknown>){
  if(!this.config.giftsToken)throw notFound()
  const token=/^Bearer ([a-f0-9]{64})$/i.exec(request.get('Authorization')||'')?.[1]
  if(!token||!timingSafeEqual(Buffer.from(token,'hex'),Buffer.from(this.config.giftsToken,'hex')))throw new MemoryError(403,'FORBIDDEN','The calling service is not authorized.')
  if(Object.keys(query).length)throw invalid()
  return {data:await new ReferralQualification(this.store).get(identifier(id))}
 }
}
@Module({})
export class MemoriesModule{
 static register(config:MemoryConfig,store:MemoryStore,candidates:CandidateStore|null=store.candidates??null,rights=new MemoryDataRights(store.pool,store.dependencies,config.queueSchema),automatic:AutomaticMemoryStore|null=null,automaticControl=automatic):DynamicModule{return {module:MemoriesModule,controllers:[SharedMemoriesController,MemoriesController,InternalMemoriesController,InternalAutomaticMemoriesController,InternalMemoryRightsController,InternalSocialMemoriesController,InternalReferralMemoriesController],providers:[{provide:SHARED_CONFIG,useValue:config},{provide:CONFIG,useValue:config},{provide:MemoryStore,useValue:store},{provide:CandidateStore,useValue:candidates},{provide:MemoryDataRights,useValue:rights},{provide:AUTOMATIC,useValue:automatic},{provide:AUTOMATIC_CONTROL,useValue:automaticControl}]}}
}

@Controller('internal/v1/accounts')
class InternalMemoryRightsController{
 constructor(@Inject(CONFIG)private readonly config:MemoryConfig,@Inject(MemoryDataRights)private readonly rights:MemoryDataRights){}
 private authorize(request:Request){
  const expected=this.config.dataRightsToken
  if(!expected)throw notFound()
  const token=/^Bearer ([a-f0-9]{64})$/i.exec(request.get('Authorization')||'')?.[1]
  if(!token||!timingSafeEqual(Buffer.from(token,'hex'),Buffer.from(expected,'hex')))throw new MemoryError(403,'FORBIDDEN','The calling service is not authorized.')
 }
 @Get(':accountId/data-export')
 async dataExport(@Req()request:Request,@Param('accountId')accountId:string,@Query()query:Record<string,unknown>){
  this.authorize(request)
  if(Object.keys(query).some(key=>!['requestId','scope'].includes(key))||typeof query.requestId!=='string'||!uuid.test(query.requestId)||typeof query.scope!=='string'||!['interaction_data','account_data'].includes(query.scope))throw invalid()
  return {data:await this.rights.export(identifier(accountId),identifier(query.requestId),query.scope as ExportScope)}
 }
 @Post(':accountId/erase')
 @HttpCode(200)
 async erase(@Req()request:Request,@Param('accountId')accountId:string,@Body()body:unknown){
  this.authorize(request)
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||!('requestId' in body)||typeof body.requestId!=='string'||!uuid.test(body.requestId))throw invalid()
  const requestId=identifier(body.requestId)
  if(request.get('Idempotency-Key')?.toLowerCase()!==requestId)throw invalid()
  return {data:await this.rights.erase(identifier(accountId),requestId)}
 }
}
