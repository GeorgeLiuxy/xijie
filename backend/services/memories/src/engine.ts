import {MemoryError} from './contracts.js'
import type {CandidateStore,Dispatch} from './candidates.js'
import {SuggestionError,type SuggestionProvider} from './provider.js'
export class SuggestionEngine{
 private readonly active=new Set<AbortController>();private stopping=false
 constructor(private readonly store:CandidateStore,private readonly provider:SuggestionProvider){}
 async run(dispatch:Dispatch){
  if(this.stopping)throw new Error('Memory worker is stopping')
  const current=await this.store.claim(dispatch);if(!current)return
  if(this.stopping){await this.store.release(current);throw new Error('Memory worker stopped while claiming generation')}
  const controller=new AbortController();this.active.add(controller);let checking=false
  const monitor=setInterval(()=>{if(checking)return;checking=true;void this.store.findJob(current.id).then(job=>{if(!job||job.state!=='running'||job.attempt_id!==current.attempt_id||job.dispatch_generation!==current.dispatch_generation)controller.abort()}).catch(()=>controller.abort()).finally(()=>{checking=false})},250).unref()
  const timeout=setTimeout(()=>controller.abort(),35000).unref()
  try{
   const before=await this.store.snapshot(current.account_id,current.person_id,current.source_message_id)
   if(!this.store.validAiAuthorization(current,before)){await this.store.fail(current,'AI_PERMISSION_REQUIRED',false,'blocked');return}
   if(!this.store.validSourceSnapshot(current,before)){await this.store.fail(current,'SOURCE_CHANGED',false,'blocked');return}
   const result=await this.provider.generate({accountId:current.account_id,jobId:current.id,attemptId:current.attempt_id!,aiAuthorizationVersion:current.ai_authorization_version,snapshot:before,signal:controller.signal})
   if(controller.signal.aborted)throw new SuggestionError('MODEL_TIMEOUT',true)
   const after=await this.store.snapshot(current.account_id,current.person_id,current.source_message_id)
   if(!this.store.validAiAuthorization(current,after)){await this.store.fail(current,'AI_PERMISSION_REQUIRED',false,'blocked');return}
   if(!this.store.validSourceSnapshot(current,after)){await this.store.fail(current,'SOURCE_CHANGED',false,'blocked');return}
   if(controller.signal.aborted)throw new SuggestionError('MODEL_TIMEOUT',true)
   if(result.kind==='insufficient_evidence'){await this.store.fail(current,'NO_MEMORY_FACTS',false,'blocked');return}
   if(!(await this.store.complete(current,result.title,result.body)))await this.store.fail(current,'MODEL_TIMEOUT',true)
  }catch(error){
   if(this.stopping){await this.store.release(current);throw new Error('Memory worker stopped during generation')}
   const active=await this.store.findJob(current.id);if(!active||active.state!=='running'||active.attempt_id!==current.attempt_id||active.dispatch_generation!==current.dispatch_generation)return
   if(error instanceof MemoryError&&[401,403,404,409].includes(error.status))await this.store.fail(current,error.code==='SOURCE_CHANGED'?'SOURCE_CHANGED':'AUTHORIZATION_CHANGED',false,'blocked')
   else if(controller.signal.aborted)await this.store.fail(current,'MODEL_TIMEOUT',true)
   else if(error instanceof SuggestionError)await this.store.fail(current,error.code,error.retryable,error.blocked?'blocked':'failed')
   else await this.store.fail(current,'DEPENDENCY_UNAVAILABLE',true)
  }finally{clearInterval(monitor);clearTimeout(timeout);this.active.delete(controller)}
 }
 stop(){this.stopping=true;for(const controller of this.active)controller.abort()}
}
