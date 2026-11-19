import type {ReferralContext} from './serviceReferrals'
import type {WorldId} from './i18n'
export type StoryContext=ReferralContext&{personId:string}
export type StoryBranch={id:string;personId:string;conversationId:string;name:string;version:number;createdAt:string;scene:{world:{id:string;code:WorldId;displayName:string};worldVersion:number};fork:{conversationId:string;messageSequence:string;eventRevision:string};canSend:boolean}
export type OfflineLife={personId:string;enabled:boolean;timeZone:string|null;version:number;nextRunAt:string|null;lastRunAt:string|null}
export type StoryEvent={id:string;version:number;summary:string;memory:string;occurredAt:string;origin?:'inherited_main'|'branch';worldVersion:number;source?:{kind:'offline_life';runId:string}}
export class StoryError extends Error{constructor(readonly status:number,readonly code:string){super(code)}}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const natural=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>0
const date=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))
export function validateBranch(v:StoryBranch,personId:string){if(!v||!uuid.test(v.id)||v.personId!==personId||!uuid.test(v.conversationId)||typeof v.name!=='string'||!v.name.trim()||!natural(v.version)||!date(v.createdAt)||!uuid.test(v.scene?.world?.id)||!['courtyard','tide','isles'].includes(v.scene.world.code)||!natural(v.scene.worldVersion)||!uuid.test(v.fork?.conversationId)||!/^\d+$/.test(v.fork.messageSequence)||!/^\d+$/.test(v.fork.eventRevision)||typeof v.canSend!=='boolean')throw new StoryError(502,'INVALID_RESPONSE');return v}
export function validateOffline(v:OfflineLife,personId:string){if(!v||v.personId!==personId||typeof v.enabled!=='boolean'||!natural(v.version)||v.timeZone!==null&&typeof v.timeZone!=='string'||v.nextRunAt!==null&&!date(v.nextRunAt)||v.lastRunAt!==null&&!date(v.lastRunAt)||v.enabled&&(!v.timeZone||!v.nextRunAt))throw new StoryError(502,'INVALID_RESPONSE');return v}
type Intent={key:string;path:string;body:Record<string,unknown>;version?:number;method:'POST'|'PUT'}
export function storyClient(context:StoryContext,signal:AbortSignal){
 const storageKey='xijie.story.controls.'+context.accountId+'.'+context.personId
 let pending:Intent|undefined
 try{const v=JSON.parse(sessionStorage.getItem(storageKey)??'null');if(v&&uuid.test(v.key)&&['POST','PUT'].includes(v.method)&&v.body&&typeof v.body==='object'&&['/v1/persons/'+context.personId+'/story-branches','/v1/persons/'+context.personId+'/offline-life'].includes(v.path))pending=v}catch{/* No persisted authority. */}
 const remember=()=>{try{if(pending)sessionStorage.setItem(storageKey,JSON.stringify(pending));else sessionStorage.removeItem(storageKey)}catch{if(pending)throw new StoryError(503,'RECOVERY_STORAGE_UNAVAILABLE')}}
 async function request<T>(path:string,init:RequestInit={}){
  if(signal.aborted)throw new DOMException('Canceled','AbortError')
  const headers=new Headers(init.headers);headers.set('X-Xijie-Expected-Session',context.sessionId)
  const response=await fetch(path,{...init,headers,signal:AbortSignal.any([signal,AbortSignal.timeout(15000)]),credentials:'same-origin',cache:'no-store',redirect:'error'})
  const value=await response.json();if(signal.aborted)throw new DOMException('Canceled','AbortError')
  if(!response.ok){if(response.status===401)context.onUnauthorized();throw new StoryError(response.status,value?.error?.code??'UNAVAILABLE')}
  if(value?.data===undefined)throw new StoryError(502,'INVALID_RESPONSE')
  return value as {data:T;meta?:{nextCursor?:string|null}}
 }
 async function mutate<T>(path:string,method:'POST'|'PUT',body:Record<string,unknown>,version:number|undefined,validate:(value:T)=>T){
  pending??={path,method,body,version,key:crypto.randomUUID()};remember()
  try{const result=await request<T>(pending.path,{method:pending.method,headers:{'Content-Type':'application/json','Idempotency-Key':pending.key,...(pending.version?{'If-Match':'"v'+pending.version+'"'}:{})},body:JSON.stringify(pending.body)});const accepted=validate(result.data);pending=undefined;remember();return accepted}
  catch(error){if(error instanceof StoryError&&(error.status===400&&['INVALID_ARGUMENT','VALIDATION_FAILED'].includes(error.code)||pending?.method==='PUT'&&error.status===412&&error.code==='VERSION_CONFLICT')){pending=undefined;remember()}throw error}
 }
 return {get pending(){return pending},
  async branches(){const result=await request<StoryBranch[]>('/v1/persons/'+context.personId+'/story-branches');if(!Array.isArray(result.data))throw new StoryError(502,'INVALID_RESPONSE');return result.data.map(v=>validateBranch(v,context.personId))},
  async create(name:string){const v=await mutate<StoryBranch>('/v1/persons/'+context.personId+'/story-branches','POST',{name},undefined,v=>validateBranch(v,context.personId));return validateBranch(v,context.personId)},
  async offline(){return validateOffline((await request<OfflineLife>('/v1/persons/'+context.personId+'/offline-life')).data,context.personId)},
  async setOffline(enabled:boolean,version:number,timeZone?:string){return validateOffline(await mutate<OfflineLife>('/v1/persons/'+context.personId+'/offline-life','PUT',{enabled,...(enabled&&timeZone?{timeZone}:{})},version,v=>validateOffline(v,context.personId)),context.personId)},
  async events(branchId?:string,cursor?:string){if(branchId&&!uuid.test(branchId))throw new StoryError(400,'INVALID_ARGUMENT');const path=branchId?'/v1/story-branches/'+branchId+'/events':'/v1/persons/'+context.personId+'/offline-life/events';const page=await request<StoryEvent[]>(path+'?'+new URLSearchParams({limit:'30',...(cursor?{cursor}:{})}));if(!Array.isArray(page.data)||page.data.some(v=>!v||!uuid.test(v.id)||!natural(v.version)||typeof v.summary!=='string'||typeof v.memory!=='string'||!date(v.occurredAt)||!natural(v.worldVersion)))throw new StoryError(502,'INVALID_RESPONSE');return {items:page.data,next:page.meta?.nextCursor??null}},
 }
}
