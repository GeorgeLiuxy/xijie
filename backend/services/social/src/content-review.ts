import {createHash,timingSafeEqual} from 'node:crypto'
import {Body,Controller,Get,HttpCode,Inject,Param,Post,Req} from '@nestjs/common'
import type {Request} from 'express'
import {SocialStore} from './store.js'
import {SocialError,invalid,notFound,identifier} from './contracts.js'
@Controller('internal/v1/content-review')
export class SocialReviewController{
 constructor(@Inject(SocialStore)readonly store:SocialStore){}
 private account(r:Request){const expected=process.env.XIJIE_CONTENT_REVIEW_SERVICE_TOKEN;if(!expected||!/^[a-f0-9]{64}$/i.test(expected))throw notFound();const token=/^Bearer ([a-f0-9]{64})$/i.exec(r.get('Authorization')??'')?.[1];if(!token||!timingSafeEqual(Buffer.from(token,'hex'),Buffer.from(expected,'hex')))throw new SocialError(403,'FORBIDDEN','Unauthorized review service.');if(Object.keys(r.query).length)throw invalid();return identifier(r.get('X-Xijie-Account-Id'))}
 private async subject(account:string,type:string,id:string){let row:any,containerId:string,owner:string,kind:string
  if(type==='comment'){
   const comment=await this.store.commentReviewSource(account,id)
   return {metadata:{subjectType:type,subjectId:id,containerId:comment.containerId,ownerAccountId:account,sourceDomain:'social',sourceKind:comment.kind,version:comment.version,hash:comment.hash},text:comment.body}
  }
  if(type==='post'){await this.store.detail(account,id);row=await this.store.row(account,id);containerId=id;owner=account;kind=row.kind}
  else if(type==='contribution'){row=(await this.store.pool.query("SELECT c.*,a.account_id,a.person_id FROM shared_album_contributions c JOIN shared_albums a ON a.id=c.album_id WHERE c.id=$1 AND c.status<>'withdrawn'",[id])).rows[0];if(!row||![row.account_id,row.author_account_id].includes(account)||!this.store.albums)throw notFound();this.store.albums.enabled();await this.store.access(account,false);await this.store.dependencies.account(row.account_id);if(!(await this.store.dependencies.persons(row.account_id)).some(p=>p.id===row.person_id))throw notFound();await this.store.gate(this.store.pool,row.account_id);containerId=row.album_id;owner=row.account_id;kind='contribution'}
  else throw invalid()
  return{metadata:{subjectType:type,subjectId:id,containerId,ownerAccountId:owner,sourceDomain:'social',sourceKind:kind,version:row.version,hash:createHash('sha256').update(JSON.stringify([kind,row.body,row.source_hash??null,row.source_memory_id??null])).digest('hex')},text:row.body as string}
 }
 @Get(':type/:id')async read(@Req()r:Request,@Param('type')type:string,@Param('id')value:string){return{data:(await this.subject(this.account(r),type,identifier(value))).metadata}}
 @Get(':type/:id/evidence')async evidence(@Req()r:Request,@Param('type')type:string,@Param('id')value:string){const a=this.account(r),id=identifier(value),first=await this.subject(a,type,id),latest=await this.subject(a,type,id);if(JSON.stringify(first.metadata)!==JSON.stringify(latest.metadata))throw new SocialError(412,'SOURCE_CHANGED','The review source changed.');return{data:{source:first.metadata,text:first.text}}}
 @Post(':type/:id/restrict')@HttpCode(200)async restrict(@Req()r:Request,@Param('type')type:string,@Param('id')value:string,@Body()input:any){const account=this.account(r),id=identifier(value);if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['reportId','operationId','containerId','sourceKind','version','sourceHash'].includes(k))||!Number.isSafeInteger(input.version)||input.version<1)throw invalid();const reportId=identifier(input.reportId),key=identifier(input.operationId),containerId=identifier(input.containerId)
  if(type==='post'&&containerId===id&&['user','world_notice','memory_echo'].includes(input.sourceKind))return{data:await this.store.moderate(account,id,key,input.version,reportId)}
  if(type==='comment'&&['self','persona'].includes(input.sourceKind)&&typeof input.sourceHash==='string'&&/^[a-f0-9]{64}$/.test(input.sourceHash))
   return{data:await this.store.moderateComment(account,containerId,id,key,input.version,reportId,input.sourceKind,input.sourceHash)}
  if(type==='contribution'&&input.sourceKind==='contribution'&&this.store.albums)return{data:await this.store.albums.moderate(account,containerId,id,key,input.version,reportId)}
  throw invalid()
 }
}
