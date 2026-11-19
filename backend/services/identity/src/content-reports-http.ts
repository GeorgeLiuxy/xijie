import {createHash} from 'node:crypto'
import {Body,Controller,Get,HttpCode,Inject,Optional,Param,Post,Query,Req,Module,type DynamicModule} from '@nestjs/common'
import type {Request} from 'express'
import {parse} from 'cookie'
import {IdentityStore} from './store.js'
import {ReportStore,ReportError,reportId,reportInput,resolutionInput} from './content-reports.js'
import {reportOperator,readReportConfig,ReportGateway,type ReportConfig} from './report-dependencies.js'
export const REPORT_CONFIG=Symbol('ReportConfig')
function page(q:Record<string,unknown>,ops=false){if(Object.keys(q).some(k=>!['limit','cursor',...(ops?['status']:[])].includes(k)))throw new ReportError(400,'INVALID_ARGUMENT');const limit=q.limit===undefined?20:Number(q.limit);if(!Number.isSafeInteger(limit)||limit<1||limit>100||q.status!==undefined&&!['open','reviewing','resolved'].includes(String(q.status)))throw new ReportError(400,'INVALID_ARGUMENT');return{limit,cursor:q.cursor===undefined?undefined:reportId(q.cursor),status:q.status as string|undefined}}
@Controller('v1')
export class ContentReportsController{
 constructor(@Inject(IdentityStore)readonly identity:IdentityStore,@Inject(REPORT_CONFIG)readonly config:ReportConfig,@Optional()@Inject(ReportStore)readonly store?:ReportStore){}
 private reports(){if(!this.config.enabled||!this.store)throw new ReportError(503,'CONTENT_REPORTS_UNAVAILABLE');return this.store}
 private async session(r:Request,write=false){if(write&&(r.get('Origin')!==this.config.origin||!r.get('X-Xijie-Expected-Session')))throw new ReportError(403,'FORBIDDEN');const name=this.config.origin.startsWith('https:')?'__Host-xijie_session':'xijie_dev_session',token=parse(r.get('cookie')??'')[name];if(!token)throw new ReportError(401,'UNAUTHENTICATED');const session=await this.identity.current(createHash('sha256').update(token).digest('hex'));if(!session||r.get('X-Xijie-Expected-Session')!==undefined&&r.get('X-Xijie-Expected-Session')!==session.id)throw new ReportError(401,'UNAUTHENTICATED');return session}
 @Post('content-reports')async create(@Req()r:Request,@Body()body:unknown){const s=await this.session(r,true);return{data:await this.reports().create(s.accountId,reportId(r.get('Idempotency-Key')),reportInput(body))}}
 @Get('content-reports')async list(@Req()r:Request,@Query()q:Record<string,unknown>){const s=await this.session(r),p=page(q);return this.reports().list(s.accountId,p.limit,p.cursor)}
 @Get('content-reports/:id')async read(@Req()r:Request,@Param('id')id:string){const s=await this.session(r);return{data:await this.reports().read(s.accountId,reportId(id))}}
 @Get('ops/content-reports')async operations(@Req()r:Request,@Query()q:Record<string,unknown>){reportOperator(this.config,r.get('Authorization'),'reports:read');const p=page(q,true);return this.reports().operations(p.status,p.limit,p.cursor)}
 @Get('ops/content-reports/:id/evidence')async evidence(@Req()r:Request,@Param('id')id:string){const operator=reportOperator(this.config,r.get('Authorization'),'reports:evidence');if(Object.keys(r.query).length)throw new ReportError(400,'INVALID_ARGUMENT');return{data:await this.reports().evidence(reportId(id),operator)}}
 @Post('ops/content-reports/:id/resolve')@HttpCode(200)async resolve(@Req()r:Request,@Param('id')id:string,@Body()body:unknown){const operator=reportOperator(this.config,r.get('Authorization'),'reports:resolve'),m=/^"v([1-9][0-9]*)"$/.exec(r.get('If-Match')??'');if(!m||!Number.isSafeInteger(Number(m[1])))throw new ReportError(428,'PRECONDITION_REQUIRED');return{data:await this.reports().resolve(reportId(id),reportId(r.get('Idempotency-Key')),Number(m[1]),resolutionInput(body),operator)}}
}
@Module({})
export class ContentReportsModule{
 static register(identity:IdentityStore,origin:string):DynamicModule{const config=readReportConfig(origin);return{module:ContentReportsModule,controllers:[ContentReportsController],providers:[{provide:IdentityStore,useValue:identity},{provide:REPORT_CONFIG,useValue:config},...(config.enabled?[{provide:ReportStore,useValue:new ReportStore(identity.pool,new ReportGateway(config))}]:[])]}}
}
