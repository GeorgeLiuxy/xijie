import {createHash,timingSafeEqual} from 'node:crypto'
import {Body,Controller,Get,HttpCode,Inject,Param,Post,Req} from '@nestjs/common'
import type {Request} from 'express'
import {ConversationStore} from './store.js'
import {ConversationError,invalid,notFound,uuid} from './contracts.js'
const id=(x:unknown)=>{if(typeof x!=='string'||!uuid.test(x))throw invalid();return x.toLowerCase()}
@Controller('internal/v1/content-review')
export class ConversationReviewController{
 constructor(@Inject(ConversationStore)readonly store:ConversationStore){}
 private account(r:Request){const expected=process.env.XIJIE_CONTENT_REVIEW_SERVICE_TOKEN;if(!expected||!/^[a-f0-9]{64}$/i.test(expected))throw notFound();const token=/^Bearer ([a-f0-9]{64})$/i.exec(r.get('Authorization')??'')?.[1];if(!token||!timingSafeEqual(Buffer.from(token,'hex'),Buffer.from(expected,'hex')))throw new ConversationError(403,'FORBIDDEN','Unauthorized review service.');if(Object.keys(r.query).length)throw invalid();return id(r.get('X-Xijie-Account-Id'))}
 private async source(a:string,messageId:string){
  const ordinary=(await this.store.pool.query('SELECT * FROM messages WHERE account_id=$1 AND id=$2 AND removed_at IS NULL',[a,messageId])).rows[0]
  if(ordinary){await this.store.historyContext(a,ordinary.conversation_id,messageId,1);return{row:ordinary,containerId:ordinary.conversation_id,sourceKind:'message'}}
  const story=(await this.store.pool.query('SELECT * FROM story_messages WHERE account_id=$1 AND id=$2 AND removed_at IS NULL',[a,messageId])).rows[0];if(!story)throw notFound();await this.store.stories.branch(a,story.branch_id);return{row:story,containerId:story.branch_id,sourceKind:'story_message'}
 }
 private describe(a:string,messageId:string,s:{row:any;containerId:string;sourceKind:string}){return{subjectType:'message',subjectId:messageId,containerId:s.containerId,ownerAccountId:a,sourceDomain:'conversations',sourceKind:s.sourceKind,version:s.row.version,hash:createHash('sha256').update(JSON.stringify([s.sourceKind,s.row.text??'',s.row.kind??'text',s.row.media_id??null])).digest('hex')}}
 @Get('message/:id')async read(@Req()r:Request,@Param('id')value:string){const a=this.account(r),messageId=id(value);return{data:this.describe(a,messageId,await this.source(a,messageId))}}
 @Get('message/:id/evidence')async evidence(@Req()r:Request,@Param('id')value:string){const a=this.account(r),messageId=id(value),s=await this.source(a,messageId),metadata=this.describe(a,messageId,s),latest=this.describe(a,messageId,await this.source(a,messageId));if(JSON.stringify(metadata)!==JSON.stringify(latest))throw new ConversationError(412,'SOURCE_CHANGED','The review source changed.');return{data:{source:metadata,text:s.row.text??''}}}
 @Post('message/:id/restrict')@HttpCode(200)async restrict(@Req()r:Request,@Param('id')value:string,@Body()input:any){
  const a=this.account(r),messageId=id(value);if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['reportId','operationId','containerId','sourceKind','version','sourceHash'].includes(k))||!Number.isSafeInteger(input.version)||input.version<1)throw invalid()
  const operation=id(input.operationId),container=id(input.containerId);id(input.reportId)
  if(input.sourceKind==='story_message')await this.store.stories.remove(a,container,messageId,operation,input.version)
  else if(input.sourceKind==='message')await this.store.removeMessage(a,container,messageId,operation,input.version,operation)
  else throw invalid()
  return{data:{subjectId:messageId,restricted:true}}
 }
}
