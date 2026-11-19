import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto'
import {Body,Controller,Get,HttpCode,Inject,Param,Post,Query,Req,Res} from '@nestjs/common'
import type {Request,Response} from 'express'
import {parse,serialize} from 'cookie'
import {SocialStore} from './store.js'
import {SocialError,identifier,object,invalid,notFound} from './contracts.js'
import {albumInput,contributionInput,emptyAlbumBody,ownerReviewInput} from './albums-contracts.js'
import {visitorHash} from './albums.js'
import type {SocialConfig} from './config.js'
export const ALBUM_CONFIG=Symbol('AlbumConfig')
function contributionVersion(r:Request){const value=r.get('If-Match');if(!value)throw new SocialError(428,'PRECONDITION_REQUIRED','Supply the current contribution version.');const match=/^"v([1-9][0-9]*)"$/.exec(value);if(!match||!Number.isSafeInteger(Number(match[1]))||Number(match[1])>2147483647)throw invalid();return Number(match[1])}
@Controller('v1')
export class AlbumsController{
 constructor(@Inject(ALBUM_CONFIG)readonly config:SocialConfig,@Inject(SocialStore)readonly store:SocialStore){}
 private albums(){if(!this.store.albums)throw new SocialError(403,'FEATURE_DISABLED','Shared albums are not available.');return this.store.albums}
 private checkOrigin(r:Request){if(r.get('Origin')!==this.config.webOrigin)throw new SocialError(403,'FORBIDDEN','Use the registered application.')}
 private session(r:Request){return this.store.dependencies.session(r.get('cookie')||'',identifier(r.get('X-Xijie-Expected-Session')))}
 private visitor(r:Request,s:Response){const secure=this.config.webOrigin.startsWith('https:'),name=secure?'__Host-xijie_album_visitor':'xijie_dev_album_visitor';let token=parse(r.get('cookie')||'')[name];if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token)){token=randomBytes(32).toString('base64url');s.appendHeader('Set-Cookie',serialize(name,token,{httpOnly:true,secure,sameSite:'lax',path:'/',maxAge:365*86400}))}return visitorHash(token)}
 private async viewer(r:Request,s:Response,token:string,write=false){
  this.albums().enabled();if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw notFound();const key=this.config.albums?.tokenKey;if(!key)throw notFound()
  const expected=r.get('X-Xijie-Expected-Session'),account=expected===undefined?undefined:await this.session(r),base=this.visitor(r,s),sign=(v:string)=>createHmac('sha256',key).update(v).digest('hex'),visitor=account?sign('account-visitor-v1\0'+base+'\0'+account.accountId):base,id=sign('album-viewer-v1\0'+token+'\0'+base+'\0'+(account?.accountId??'anonymous'))
  const provided=r.get('X-Xijie-Album-Viewer');if(write&&(expected!==undefined||provided!==undefined)&&provided!==id)throw new SocialError(409,'VIEWER_SCOPE_CHANGED','Reload this invitation before retrying the same operation.')
  return{base,visitor,accountId:account?.accountId,scope:{kind:account?'account' as const:'anonymous' as const,id}}
 }
 private rates=new Map<string,{at:number;n:number}>()
 private publicRate(r:Request){const now=Date.now(),id=createHash('sha256').update(r.ip||'unknown').digest('hex'),old=this.rates.get(id);if(old&&old.at>now-60000){if(++old.n>120)throw new SocialError(429,'RATE_LIMITED','Please try again shortly.')}else this.rates.set(id,{at:now,n:1});if(this.rates.size>10000)for(const[k,v]of this.rates)if(v.at<=now-60000)this.rates.delete(k)}
 @Post('shared-albums') async create(@Req()r:Request,@Body()b:unknown){this.checkOrigin(r);const s=await this.session(r);return{data:await this.albums().create(s.accountId,identifier(r.get('Idempotency-Key')),albumInput(b))}}
 @Get('shared-albums') async list(@Req()r:Request,@Query()q:Record<string,unknown>){object(q,['cursor','limit']);const limit=q.limit===undefined?20:Number(q.limit);if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw invalid();const s=await this.session(r);return this.albums().list(s.accountId,q.cursor===undefined?undefined:identifier(q.cursor),limit)}
 @Get('shared-albums/:id') async detail(@Req()r:Request,@Param('id')id:string){const s=await this.session(r);return{data:await this.albums().detail(s.accountId,identifier(id))}}
 @Post('shared-albums/:id/close') @HttpCode(200) async close(@Req()r:Request,@Param('id')id:string,@Body()b:unknown){this.checkOrigin(r);emptyAlbumBody(b);const s=await this.session(r);return{data:await this.albums().close(s.accountId,identifier(id),identifier(r.get('Idempotency-Key')))}}
 @Post('shared-albums/:id/contributions/:cid/adopt') @HttpCode(200) async adopt(@Req()r:Request,@Param('id')id:string,@Param('cid')cid:string,@Body()b:unknown){this.checkOrigin(r);emptyAlbumBody(b);const s=await this.session(r);return{data:await this.albums().adopt(s.accountId,identifier(id),identifier(cid),identifier(r.get('Idempotency-Key')))}}
 @Post('shared-albums/:id/contributions/:cid/review') @HttpCode(200) async review(@Req()r:Request,@Param('id')id:string,@Param('cid')cid:string,@Body()b:unknown){this.checkOrigin(r);const input=ownerReviewInput(b),s=await this.session(r);return{data:await this.albums().ownerReview(s.accountId,identifier(id),identifier(cid),identifier(r.get('Idempotency-Key')),contributionVersion(r),input.decision)}}
 @Get('public/shared-albums/:token') async public(@Req()r:Request,@Res({passthrough:true})s:Response,@Param('token')token:string){this.publicRate(r);const v=await this.viewer(r,s,token);return{data:{...await this.albums().publicView(token,v.visitor,v.accountId,v.base),viewerScope:v.scope}}}
 @Get('public/shared-albums/:token/submission-commands/:key') async submission(@Req()r:Request,@Res({passthrough:true})s:Response,@Param('token')token:string,@Param('key')key:string){this.publicRate(r);const v=await this.viewer(r,s,token);return{data:{state:'accepted',contribution:await this.albums().submissionCommand(token,v.visitor,identifier(key),v.accountId,v.base)}}}
 @Post('public/shared-albums/:token/contributions') async submit(@Req()r:Request,@Res({passthrough:true})s:Response,@Param('token')token:string,@Body()b:unknown){this.checkOrigin(r);this.publicRate(r);const v=await this.viewer(r,s,token,true);return{data:await this.albums().submit(token,v.visitor,identifier(r.get('Idempotency-Key')),contributionInput(b),v.accountId,v.base)}}
 @Post('public/shared-albums/:token/contributions/:id/withdraw') @HttpCode(200) async withdraw(@Req()r:Request,@Res({passthrough:true})s:Response,@Param('token')token:string,@Param('id')id:string,@Body()b:unknown){this.checkOrigin(r);this.publicRate(r);emptyAlbumBody(b);const v=await this.viewer(r,s,token,true);return{data:await this.albums().withdraw(token,v.visitor,identifier(id),identifier(r.get('Idempotency-Key')),v.accountId,v.base)}}
 @Post('public/shared-albums/:token/reward') @HttpCode(200) async claim(@Req()r:Request,@Res({passthrough:true})s:Response,@Param('token')token:string,@Body()b:unknown){this.checkOrigin(r);emptyAlbumBody(b);const actor=await this.session(r),v=await this.viewer(r,s,token);return{data:await this.albums().claim(token,v.visitor,actor.accountId,identifier(r.get('Idempotency-Key')),v.base)}}
}
@Controller('internal/v1/shared-albums')
export class AlbumSourcesController{
 constructor(@Inject(ALBUM_CONFIG)readonly config:SocialConfig,@Inject(SocialStore)readonly store:SocialStore){}
 @Get(':id/contributions/:cid/source') async source(@Req()r:Request,@Param('id')id:string,@Param('cid')cid:string,@Query()q:Record<string,unknown>){
  const token=/^Bearer ([a-f0-9]{64})$/i.exec(r.get('Authorization')||'')?.[1],expected=this.config.albums?.memoriesToken
  if(!expected||!token||!timingSafeEqual(Buffer.from(token,'hex'),Buffer.from(expected,'hex')))throw new SocialError(403,'FORBIDDEN','The calling service is not authorized.')
  object(q,['version']);if(typeof q.version!=='string'||!/^[1-9][0-9]*$/.test(q.version)||!Number.isSafeInteger(Number(q.version))||Number(q.version)>2147483647)throw invalid();if(!this.store.albums)throw notFound()
  return{data:await this.store.albums.source(identifier(r.get('X-Xijie-Account-Id')),identifier(id),identifier(cid),Number(q.version))}
 }
}
