import {ConversationError} from './contracts.js'
import {GenerationError} from './provider.js'
import type {PhotoGenerationProvider} from './photo-provider.js'
import type {PhotoStore} from './photo-store.js'
import {sameVirtualWorldUse,virtualWorldUse} from './virtual-world.js'
export class PhotoEngine{
 private stopping=false
 private active=new Set<AbortController>()
 constructor(readonly store:PhotoStore,readonly provider:PhotoGenerationProvider){}
 async run(id:string){
  if(this.stopping)throw new Error('Photo worker is stopping')
  const j=await this.store.claim(id);if(!j)return;if(this.stopping){await this.store.fail(j,'WORKER_INTERRUPTED',true);return}
  const control=new AbortController();this.active.add(control);let checking=false
  const monitor=setInterval(()=>{if(checking)return;checking=true;void this.store.find(id).then(current=>{if(!current||current.state!=='running'||current.attempt_id!==j.attempt_id)control.abort()}).catch(()=>control.abort()).finally(()=>{checking=false})},250).unref(),timeout=setTimeout(()=>control.abort(),35000).unref()
  try{
   const before=await this.store.authority(j,true),world=await this.store.world(j,before.person)
   if(!await this.store.capture(j,before.person,world))return
   if(!this.store.dependencies.photoBytes)throw new ConversationError(503,'DEPENDENCY_UNAVAILABLE','Photo media is unavailable.')
   const image=await this.store.dependencies.photoBytes(j.account_id,j.id,j.attempt_id!),ready=await this.store.authority(j,true)
   if(JSON.stringify(ready.person)!==JSON.stringify(before.person))throw new ConversationError(409,'SOURCE_CHANGED','The photo context changed.')
   if(control.signal.aborted)throw new GenerationError('MODEL_TIMEOUT',true)
   const result=await this.provider.generate({accountId:j.account_id,jobId:j.id,attemptId:j.attempt_id!,authorizationVersion:j.image_authorization_version,chatImageReplies:ready.account.chatImageReplies!,photoAuthorizationVersion:j.photo_authorization_version,chatPhotoStorage:ready.account.chatPhotoStorage!,storyAuthorizationVersion:j.story_authorization_version,storyStorage:ready.account.storyStorage,image,person:ready.person,virtualWorld:world,signal:control.signal})
   if(control.signal.aborted)throw new GenerationError('MODEL_TIMEOUT',true)
   const after=await this.store.authority(j,true),afterWorld=await this.store.world(j,after.person)
   if(JSON.stringify(after.person)!==JSON.stringify(before.person)||!sameVirtualWorldUse(virtualWorldUse(world),afterWorld))throw new ConversationError(409,'SOURCE_CHANGED','The photo context changed.')
   if(!await this.store.complete(j,result.text,result.provenance,before.person,world))await this.store.fail(j,'MODEL_TIMEOUT',true)
  }catch(error){
   const current=await this.store.find(id);if(!current||current.state!=='running'||current.attempt_id!==j.attempt_id)return
   const expired=error instanceof ConversationError&&error.code==='PHOTO_LEASE_EXPIRED'
   const blocked=error instanceof ConversationError&&[401,403,404,409].includes(error.status)&&!expired||error instanceof GenerationError&&error.blocked
   const code=this.stopping?'WORKER_INTERRUPTED':error instanceof ConversationError||error instanceof GenerationError?error.code:control.signal.aborted?'MODEL_TIMEOUT':'DEPENDENCY_UNAVAILABLE'
   try{await this.store.fail(j,code,!blocked&&(this.stopping||!(error instanceof GenerationError)||error.retryable),blocked)}catch(e){if(!(e instanceof ConversationError&&e.status===404))throw e}
  }finally{clearInterval(monitor);clearTimeout(timeout);this.active.delete(control)}
 }
 stop(){this.stopping=true;for(const controller of this.active)controller.abort()}
}
