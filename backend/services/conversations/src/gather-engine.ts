import {ConversationError,dependencyUnavailable} from './contracts.js'
import {GenerationError} from './provider.js'
import {GatherStore,type GatherMemoryUse} from './gather.js'
import type {GatherGenerationProvider} from './gather-provider.js'
export class GatherEngine{
 private stopping=false
 private readonly active=new Set<AbortController>()
 constructor(readonly store:GatherStore,readonly provider:GatherGenerationProvider){}
 async run(jobId:string,personId:string){
  if(this.stopping)return
  const c=await this.store.claim(jobId,personId);if(!c)return
  const controller=new AbortController();this.active.add(controller);if(this.stopping)controller.abort()
  let checking=false
  const timer=setInterval(()=>{if(checking)return;checking=true;void this.store.find(jobId,personId).then(s=>{if(!s||s.state!=='running'||s.attempt_id!==c.attempt_id)controller.abort()}).catch(()=>controller.abort()).finally(()=>{checking=false})},250).unref(),timeout=setTimeout(()=>controller.abort(),35000).unref()
  try{
   if(controller.signal.aborted)throw new GenerationError('WORKER_INTERRUPTED',true)
   const before=await this.store.authority(c),history=await this.store.context(c),query=history.messages.at(-1)!.text
   if(c.job.memory_ai_authorization_version!==null&&(!this.store.dependencies.memories||!this.store.dependencies.automaticMemories||this.store.dependencies.memoryContextAvailable?.()===false))throw dependencyUnavailable()
   const memories=c.job.memory_ai_authorization_version===null?[]:await this.store.dependencies.memories!(c.account_id,c.person_id,query),automatic=c.job.memory_ai_authorization_version===null?[]:await this.store.dependencies.automaticMemories!(c.account_id,c.person_id,query)
   if(!Array.isArray(memories)||!Array.isArray(automatic))throw dependencyUnavailable()
   const uses:GatherMemoryUse[]=[...history.memoryRefs,...memories.map(m=>({personId:c.person_id,kind:'cherished' as const,id:m.id,version:m.version})),...automatic.map(m=>({personId:c.person_id,kind:'automatic' as const,id:m.id,version:m.version,sourceKind:m.sourceKind,sourceId:m.sourceId,sourceVersion:m.sourceVersion,sources:m.sources}))],unique=new Map<string,GatherMemoryUse>()
   for(const ref of uses){const k=ref.personId+':'+ref.kind+':'+ref.id,prior=unique.get(k);if(prior&&prior.version!==ref.version)throw new ConversationError(403,'CONTEXT_REVOKED','A memory source changed.');unique.set(k,ref)}
   const refs=[...unique.values()]
   if(!await this.store.validateMemories(c.account_id,refs)||!await this.store.validateMessages(c,history.messageRefs))throw new ConversationError(403,'CONTEXT_REVOKED','A gather source changed.')
   const ready=await this.store.authority(c);this.store.sameAuthority(before,ready)
   if(!await this.store.capture(c,ready,history.messageRefs,refs))return
   const dispatch=await this.store.authority(c);this.store.sameAuthority(ready,dispatch)
   if(controller.signal.aborted)throw new GenerationError('MODEL_TIMEOUT',true)
   const output=await this.provider.generate({accountId:c.account_id,jobId,attemptId:c.attempt_id!,authorizationVersion:c.job.gather_authorization_version,gatherReplies:dispatch.account.gatherReplies!,person:dispatch.person,virtualWorld:dispatch.world,messages:history.messages,aiTextProcessing:dispatch.account.aiTextProcessing,...(c.job.memory_ai_authorization_version===null?{}:{memoryAiAuthorizationVersion:c.job.memory_ai_authorization_version}),memories:memories.map(m=>({...m,personId:c.person_id})),automaticMemories:automatic.map(m=>({...m,personId:c.person_id})),signal:controller.signal})
   if(controller.signal.aborted)throw new GenerationError('MODEL_TIMEOUT',true)
   const after=await this.store.authority(c);this.store.sameAuthority(dispatch,after)
   if(!await this.store.complete(c,output.text,output.provenance,dispatch,history.messageRefs,refs))await this.store.fail(c,'MODEL_TIMEOUT',true)
  }catch(error){
   const current=await this.store.find(jobId,personId)
   if(!current||current.state!=='running'||current.attempt_id!==c.attempt_id)return
   if(this.stopping)await this.store.fail(c,'WORKER_INTERRUPTED',true)
   else if(error instanceof ConversationError&&[401,403,404].includes(error.status))await this.store.fail(c,error.code,false,'blocked')
   else if(error instanceof ConversationError&&error.code==='SOURCE_CHANGED')await this.store.fail(c,'CONTEXT_REVOKED',false,'blocked')
   else if(error instanceof GenerationError)await this.store.fail(c,error.code,error.retryable,error.blocked?'blocked':'failed')
   else await this.store.fail(c,controller.signal.aborted?'MODEL_TIMEOUT':'DEPENDENCY_UNAVAILABLE',true)
  }finally{clearInterval(timer);clearTimeout(timeout);this.active.delete(controller)}
 }
 stop(){this.stopping=true;for(const controller of this.active)controller.abort()}
}
