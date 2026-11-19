import {Body,Controller,Get,HttpCode,Inject,Module,Param,Post,Req,type DynamicModule} from '@nestjs/common'
import type {Request} from 'express'
import {VoiceHub} from './voice-hub.js'
import {VoiceError} from './voice-provider.js'
import {uuid} from './contracts.js'
@Controller('v1')
class VoiceController{
 constructor(@Inject(VoiceHub)private readonly hub:VoiceHub){}
 private id(value:string){if(!uuid.test(value))throw new VoiceError(400,'INVALID_ARGUMENT');return value.toLowerCase()}
 private key(request:Request){if(request.get('Origin')!==this.hub.config.webOrigin)throw new VoiceError(403,'FORBIDDEN');const key=request.get('Idempotency-Key');if(!key||!uuid.test(key))throw new VoiceError(400,'INVALID_ARGUMENT');return key.toLowerCase()}
 private empty(body:unknown){if(body!==undefined&&(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length))throw new VoiceError(400,'INVALID_ARGUMENT')}
 @Post('conversations/:id/call-sessions')
 async create(@Req()r:Request,@Param('id')id:string,@Body()body:unknown){const key=this.key(r);if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||!('mode'in body)||body.mode!=='voice')throw new VoiceError(400,'VOICE_MODE_UNSUPPORTED');return{data:await this.hub.prepare(r.get('Cookie')??'',r.get('X-Xijie-Expected-Session'),this.id(id),key)}}
 @Get('conversations/:id/call-sessions')
 async list(@Req()r:Request,@Param('id')id:string){if(Object.keys(r.query).some(k=>k!=='after')||r.query.after!==undefined&&typeof r.query.after!=='string')throw new VoiceError(400,'INVALID_ARGUMENT');const page=await this.hub.calls.list(r.get('Cookie')??'',r.get('X-Xijie-Expected-Session'),this.id(id),r.query.after as string|undefined);return{data:page.items,meta:{nextCursor:page.nextCursor}}}
 @Post('call-sessions/:id/grants')
 @HttpCode(200)
 async grants(@Req()r:Request,@Param('id')id:string,@Body()body:unknown){const key=this.key(r);this.empty(body);const grant=await this.hub.calls.grant(r.get('Cookie')??'',r.get('X-Xijie-Expected-Session'),this.id(id),key),url=new URL('/v1/call-sessions/'+this.id(id)+'/stream',this.hub.config.webOrigin);url.protocol=url.protocol==='https:'?'wss:':'ws:';return{data:{url:url.href,...grant}}}
 @Get('call-sessions/:id')
 async read(@Req()r:Request,@Param('id')id:string){if(Object.keys(r.query).length)throw new VoiceError(400,'INVALID_ARGUMENT');return{data:await this.hub.calls.read(r.get('Cookie')??'',r.get('X-Xijie-Expected-Session'),this.id(id))}}
 @Post('call-sessions/:id/end')
 @HttpCode(200)
 async end(@Req()r:Request,@Param('id')id:string,@Body()body:unknown){this.key(r);this.empty(body);return{data:await this.hub.calls.end(r.get('Cookie')??'',r.get('X-Xijie-Expected-Session'),this.id(id))}}
}
@Module({})export class VoiceCallsModule{static register(hub:VoiceHub):DynamicModule{return{module:VoiceCallsModule,controllers:[VoiceController],providers:[{provide:VoiceHub,useValue:hub}]}}}
