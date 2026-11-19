import {MemoryError} from './contracts.js'
import {AutomaticError,type AutomaticDispatch,type AutomaticProvider} from './automatic-contracts.js'
import type {AutomaticMemoryStore} from './automatic-store.js'
export class AutomaticMemoryEngine{
 private readonly active=new Set<AbortController>();private stopping=false
 constructor(private readonly store:AutomaticMemoryStore,private readonly provider:AutomaticProvider){}
 async run(dispatch:AutomaticDispatch){
  if(this.stopping)throw new Error('Automatic memory worker is stopping')
  const current=await this.store.claim(dispatch);if(!current)return
  if(this.stopping){await this.store.release(current);throw new Error('Automatic memory worker stopped during claim')}
  const controller=new AbortController();this.active.add(controller);let checking=false
  const monitor=setInterval(()=>{if(checking)return;checking=true;void this.store.findJob(current.id).then(job=>{if(!job||job.state!=='running'||job.attempt_id!==current.attempt_id||job.dispatch_generation!==current.dispatch_generation)controller.abort()}).catch(()=>controller.abort()).finally(()=>{checking=false})},250).unref()
  const timeout=setTimeout(()=>controller.abort(),35000).unref()
  try{
   const before=await this.store.snapshot(current.account_id,current.person_id,current.source_kind,current.source_id,current.source_created_at.toISOString())
   if(!this.store.validSnapshot(current,before)){await this.store.fail(current,'SOURCE_CHANGED',false,'blocked');return}
   const result=await this.provider.generate({accountId:current.account_id,jobId:current.id,attemptId:current.attempt_id!,aiAuthorizationVersion:current.ai_authorization_version,snapshot:before,signal:controller.signal})
   if(controller.signal.aborted)throw new AutomaticError('MODEL_TIMEOUT',true)
   const after=await this.store.snapshot(current.account_id,current.person_id,current.source_kind,current.source_id,current.source_created_at.toISOString())
   if(!this.store.validSnapshot(current,after)){await this.store.fail(current,'SOURCE_CHANGED',false,'blocked');return}
   if(!(await this.store.complete(current,result.facts,before)))await this.store.fail(current,'SOURCE_CHANGED',false,'blocked')
  }catch(error){
   const latest=await this.store.findJob(current.id)
   if(!latest||latest.state!=='running'||latest.attempt_id!==current.attempt_id||latest.dispatch_generation!==current.dispatch_generation)return
   if(this.stopping){await this.store.release(current);throw new Error('Automatic memory worker stopped during generation')}
   if(error instanceof MemoryError&&[401,403,404,409].includes(error.status))await this.store.fail(current,error.code==='SOURCE_CHANGED'?'SOURCE_CHANGED':'AI_PERMISSION_REQUIRED',false,'blocked')
   else if(error instanceof AutomaticError)await this.store.fail(current,error.code,error.retryable,error.retryable?'failed':'blocked')
   else if(controller.signal.aborted)await this.store.fail(current,'MODEL_TIMEOUT',true)
   else await this.store.fail(current,'DEPENDENCY_UNAVAILABLE',true)
  }finally{clearInterval(monitor);clearTimeout(timeout);this.active.delete(controller)}
 }
 stop(){this.stopping=true;for(const controller of this.active)controller.abort()}
}
