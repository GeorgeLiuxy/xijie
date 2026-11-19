import {ConversationError} from './contracts.js'
import {GenerationError} from './provider.js'
import type {LetterGenerationProvider} from './letter-provider.js'
import type {LetterStore} from './letters.js'
import {sameVirtualWorldUse,virtualWorldUse} from './virtual-world.js'

export class LetterEngine{
 private stopping=false
 private active=new Set<AbortController>()
 constructor(readonly store:LetterStore,readonly provider:LetterGenerationProvider){}
 async run(id:string){
  if(this.stopping)throw new Error('Letter worker is stopping')
  const job=await this.store.claim(id);if(!job)return
  if(this.stopping){await this.store.fail(job,'WORKER_INTERRUPTED',true);return}
  const controller=new AbortController();this.active.add(controller)
  let checking=false
  const monitor=setInterval(()=>{if(checking)return;checking=true;void this.store.find(id).then(current=>{if(!current||current.state!=='running'||current.attempt_id!==job.attempt_id)controller.abort()}).catch(()=>controller.abort()).finally(()=>{checking=false})},250).unref()
  const timeout=setTimeout(()=>controller.abort(),35000).unref()
  try{
   const before=await this.store.authority(job),world=await this.store.world(job,before.person)
   const ready=await this.store.authority(job)
   if(JSON.stringify(ready.person)!==JSON.stringify(before.person))throw new ConversationError(409,'SOURCE_CHANGED','The person context changed.')
   if(!await this.store.capture(job,before.person,world))return
   const beforeModel=await this.store.authority(job,true)
   if(JSON.stringify(beforeModel.person)!==JSON.stringify(before.person))throw new ConversationError(409,'SOURCE_CHANGED','The person context changed before dispatch.')
   if(controller.signal.aborted)throw new GenerationError('MODEL_TIMEOUT',true)
   const result=await this.provider.generate({accountId:job.account_id,jobId:id,attemptId:job.attempt_id!,letterReplies:beforeModel.account.letterReplies!,authorizationVersion:before.source.reply_authorization_version!,letter:{id:before.source.id,body:before.source.body,version:job.source_version},person:before.person,virtualWorld:world,signal:controller.signal})
   if(controller.signal.aborted)throw new GenerationError('MODEL_TIMEOUT',true)
   const after=await this.store.authority(job),afterWorld=await this.store.world(job,after.person)
   if(JSON.stringify(after.person)!==JSON.stringify(before.person)||!sameVirtualWorldUse(virtualWorldUse(world),afterWorld))throw new ConversationError(409,'SOURCE_CHANGED','The generation context changed.')
   if(!await this.store.complete(job,result.text,result.provenance,before.person,world))await this.store.fail(job,'MODEL_TIMEOUT',true)
  }catch(error){
   const current=await this.store.find(id);if(!current||current.state!=='running'||current.attempt_id!==job.attempt_id)return
   const blocked=error instanceof ConversationError&&[401,403,404,409].includes(error.status)||error instanceof GenerationError&&error.blocked
   const code=this.stopping?'WORKER_INTERRUPTED':error instanceof ConversationError||error instanceof GenerationError?error.code:controller.signal.aborted?'MODEL_TIMEOUT':'DEPENDENCY_UNAVAILABLE'
   try{await this.store.fail(job,code,!blocked&&(this.stopping||!(error instanceof GenerationError)||error.retryable),blocked)}catch(e){if(e instanceof ConversationError&&e.status===404)return;throw e}
  }finally{clearInterval(monitor);clearTimeout(timeout);this.active.delete(controller)}
 }
 stop(){this.stopping=true;for(const item of this.active)item.abort()}
}
