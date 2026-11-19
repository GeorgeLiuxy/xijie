import {ConversationError} from './contracts.js'
import {GenerationError} from './provider.js'
import type {StoryProvider} from './story-provider.js'
import type {StoryStore} from './story-store.js'
export class StoryEngine{
 private stopping=false
 private active=new Set<AbortController>()
 constructor(readonly store:StoryStore,readonly provider:StoryProvider){}
 async run(mode:'branch'|'offline',id:string){
  if(this.stopping)return
  const j=await this.store.claim(mode,id);if(!j)return
  if(this.stopping){await this.store.fail(mode,j,'WORKER_INTERRUPTED',true);return}
  const controller=new AbortController();this.active.add(controller);let checking=false
  const monitor=setInterval(()=>{if(checking)return;checking=true;void this.store.find(mode,id).then(row=>{if(!row||row.state!=='running'||row.attempt_id!==j.attempt_id)controller.abort()}).catch(()=>controller.abort()).finally(()=>{checking=false})},250).unref()
  const timeout=setTimeout(()=>controller.abort(),35000).unref()
  try{
   const context=await this.store.input(mode,j)
   if(this.stopping||controller.signal.aborted)throw new GenerationError('WORKER_INTERRUPTED',true)
   const result=await this.provider.generate({...context.input,signal:controller.signal})
   if(controller.signal.aborted)throw new GenerationError('MODEL_TIMEOUT',true)
   if(!await this.store.complete(mode,j,context,result))await this.store.fail(mode,j,'MODEL_TIMEOUT',true)
  }catch(e){const blocked=e instanceof ConversationError&&[401,403,404,409].includes(e.status)||e instanceof GenerationError&&e.blocked;await this.store.fail(mode,j,e instanceof ConversationError||e instanceof GenerationError?e.code:'DEPENDENCY_UNAVAILABLE',!blocked&&(this.stopping||!(e instanceof GenerationError)||e.retryable),blocked).catch(error=>{if(!(error instanceof ConversationError&&error.status===404))throw error})}
  finally{clearInterval(monitor);clearTimeout(timeout);this.active.delete(controller)}
 }
 stop(){this.stopping=true;for(const c of this.active)c.abort()}
}
