import {timingSafeEqual} from 'node:crypto'
import {Body,Controller,HttpCode,Inject,Param,Post,Req} from '@nestjs/common'
import type {Request} from 'express'
import type {MemoryConfig} from './config.js'
import {MemoryStore} from './store.js'
import {MemoryError,uuid,invalid} from './contracts.js'
import {SharedContributions} from './shared-contributions.js'
const identifier=(v:unknown)=>{if(typeof v!=='string'||!uuid.test(v))throw invalid();return v.toLowerCase()}
export const SHARED_CONFIG=Symbol('SharedMemoryConfig')
@Controller('internal/v1/shared-albums')
export class SharedMemoriesController{
 constructor(@Inject(SHARED_CONFIG)readonly config:MemoryConfig,@Inject(MemoryStore)readonly store:MemoryStore){}
 private account(r:Request){const token=/^Bearer ([a-f0-9]{64})$/i.exec(r.get('Authorization')||'')?.[1],expected=this.config.socialToken;if(!token||!expected||!timingSafeEqual(Buffer.from(token,'hex'),Buffer.from(expected,'hex')))throw new MemoryError(403,'FORBIDDEN','The calling service is not authorized.');if(Object.keys(r.query).length)throw invalid();return identifier(r.get('X-Xijie-Account-Id'))}
 @Post(':albumId/contributions/:id/adopt') @HttpCode(200) async adopt(@Req()r:Request,@Param('albumId')albumId:string,@Param('id')id:string,@Body()body:unknown){const accountId=this.account(r);if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||!('sourceVersion'in body)||!Number.isSafeInteger(body.sourceVersion)||Number(body.sourceVersion)<1||Number(body.sourceVersion)>2147483647)throw invalid();return{data:await new SharedContributions(this.store).adopt(accountId,identifier(albumId),identifier(id),Number(body.sourceVersion))}}
 @Post(':albumId/contributions/:id/revoke') @HttpCode(200) async revoke(@Req()r:Request,@Param('albumId')albumId:string,@Param('id')id:string,@Body()body:unknown){const accountId=this.account(r);if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)throw invalid();return{data:await new SharedContributions(this.store).revoke(accountId,identifier(albumId),identifier(id))}}
}
