import type {InviteStatus} from './gifts/client'

export type ReferralContext={accountId:string;sessionId:string;onUnauthorized:()=>void}
type Link={id:string;publicName:string;url:string|null;status:'active'|'revoked';version:number;createdAt:string}
type Status={link:Link|null;records:{id:string;joinedAt:string;firstMemoryAt:string|null;rewardedAt:string|null}[];receivedRewardCount:number}
type Intent={key:string;publicName:string}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const time=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))
export class ReferralError extends Error{constructor(readonly status:number,readonly code:string){super(code)}}
function validLink(link:Link,allowRevoked=false){
 if(!link||!uuid.test(link.id)||typeof link.publicName!=='string'||[...link.publicName].length>32||!link.publicName.trim()||link.status!=='active'&&!(allowRevoked&&link.status==='revoked')||!Number.isSafeInteger(link.version)||link.version<1||!time(link.createdAt))throw new ReferralError(502,'INVALID_RESPONSE')
 if(link.status==='revoked'){if(link.url!==null||link.version<2)throw new ReferralError(502,'INVALID_RESPONSE');return link}
 let url:URL;try{if(typeof link.url!=='string')throw Error();url=new URL(link.url)}catch{throw new ReferralError(502,'INVALID_RESPONSE')}
 if(url.origin!==location.origin||url.username||url.password||url.hash||url.search||!/^\/invite\/[A-Za-z0-9_-]{43}$/.test(url.pathname))throw new ReferralError(502,'INVALID_RESPONSE')
 return link
}
export function referralStatus(value:Status):InviteStatus{
 if(!value||!Array.isArray(value.records)||!Number.isSafeInteger(value.receivedRewardCount)||value.receivedRewardCount<0||value.records.some(r=>!r||!uuid.test(r.id)||!time(r.joinedAt)||r.firstMemoryAt!==null&&!time(r.firstMemoryAt)||r.rewardedAt!==null&&!time(r.rewardedAt)))throw new ReferralError(502,'INVALID_RESPONSE')
 const link=value.link===null?null:validLink(value.link)
 return {inviteId:link?.id??null,publicName:link?.publicName??'',shareUrl:link?.url??undefined,linkVersion:link?.version,rewards:[],rewardedCount:value.receivedRewardCount,
  friends:value.records.map(r=>({joinedAt:Date.parse(r.joinedAt),memoryAt:r.firstMemoryAt===null?null:Date.parse(r.firstMemoryAt)}))}
}
export function createReferralClient(context:ReferralContext){
 let active=true,epoch=0,pending:Intent|undefined,busy=false
 const requests=new Set<AbortController>(),storageKey='xijie.referral.create.'+context.accountId
 try{const saved=JSON.parse(sessionStorage.getItem(storageKey)??'null');if(saved&&uuid.test(saved.key)&&typeof saved.publicName==='string'&&saved.publicName.trim()&&[...saved.publicName].length<=32)pending=saved}catch{/* Private browser recovery is optional. */}
 const remember=()=>{try{if(pending)sessionStorage.setItem(storageKey,JSON.stringify(pending));else sessionStorage.removeItem(storageKey)}catch{if(pending)throw new ReferralError(503,'RECOVERY_STORAGE_UNAVAILABLE')}}
 async function request(path:string,body?:unknown,key?:string,version?:number){
  const captured=epoch,controller=new AbortController();requests.add(controller)
  const check=()=>{if(!active||captured!==epoch)throw new DOMException('Canceled','AbortError')}
  check()
  try{
   const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,
    headers:{'X-Xijie-Expected-Session':context.sessionId,...(body===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':key!}),...(version?{'If-Match':'"v'+version+'"'}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})})
   check();const value=await response.json();check()
   if(!response.ok){if(response.status===401)context.onUnauthorized();throw new ReferralError(response.status,value?.error?.code??'UNAVAILABLE')}
   if(value?.data===undefined)throw new ReferralError(502,'INVALID_RESPONSE')
   return value.data
  }finally{requests.delete(controller)}
 }
 return {
  activate(){active=true},dispose(){active=false;epoch++;requests.forEach(c=>c.abort());requests.clear()},
  get pendingName(){return pending?.publicName},
  async status(){return referralStatus(await request('/v1/referrals'))},
  async create(publicName:string){
   if(busy)throw new ReferralError(409,'IN_PROGRESS');busy=true
   pending??={key:crypto.randomUUID(),publicName:publicName.trim()}
   try{remember();const link=validLink(await request('/v1/referrals/links',{publicName:pending.publicName},pending.key),true);if(link.publicName!==pending.publicName)throw new ReferralError(502,'INVALID_RESPONSE');pending=undefined;remember();return referralStatus(await request('/v1/referrals'))}
   catch(error){if(error instanceof ReferralError&&error.status===400&&['INVALID_ARGUMENT','VALIDATION_FAILED'].includes(error.code)){pending=undefined;remember()}throw error}
   finally{busy=false}
  },
  async revoke(id:string,version:number){if(!uuid.test(id)||!Number.isSafeInteger(version)||version<1)throw new ReferralError(400,'INVALID_ARGUMENT');await request('/v1/referrals/links/'+id+'/revoke',{},id,version);return referralStatus(await request('/v1/referrals'))},
 }
}

export async function publicReferral(token:string,signal?:AbortSignal){
 if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new ReferralError(404,'NOT_FOUND')
 const response=await fetch('/v1/public/referrals/'+encodeURIComponent(token),{credentials:'same-origin',cache:'no-store',redirect:'error',signal})
 const value=await response.json();if(!response.ok)throw new ReferralError(response.status,value?.error?.code??'UNAVAILABLE')
 if(value?.data?.campaign!=='first-memory-v1'||typeof value.data.publicName!=='string'||[...value.data.publicName].length>32)throw new ReferralError(502,'INVALID_RESPONSE')
 return {publicName:value.data.publicName as string}
}
export async function joinReferral(token:string,signal?:AbortSignal){
 if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new ReferralError(404,'NOT_FOUND')
 const session=await fetch('/v1/sessions/current',{credentials:'same-origin',cache:'no-store',redirect:'error',signal})
 let sessionId:string|undefined
 if(session.ok){const value=await session.json();if(!uuid.test(value?.data?.id))throw new ReferralError(502,'INVALID_RESPONSE');sessionId=value.data.id}
 else if(session.status!==401)throw new ReferralError(session.status,'UNAVAILABLE')
 const storageKey='xijie.referral.join.'+token;let key:string|undefined
 try{const previous=sessionStorage.getItem(storageKey);if(previous&&uuid.test(previous))key=previous}catch{/* Joining does not create assets. */}
 key??=crypto.randomUUID();try{sessionStorage.setItem(storageKey,key)}catch{/* Server browser binding remains unique. */}
 const response=await fetch('/v1/public/referrals/'+encodeURIComponent(token)+'/join',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal,
  headers:{'Content-Type':'application/json','Idempotency-Key':key,...(sessionId?{'X-Xijie-Expected-Session':sessionId}:{})},body:'{}'})
 const value=await response.json();if(!response.ok)throw new ReferralError(response.status,value?.error?.code??'UNAVAILABLE')
 if(!value?.data||(value.data.invitationIntentId!==null&&!uuid.test(value.data.invitationIntentId)))throw new ReferralError(502,'INVALID_RESPONSE')
 try{sessionStorage.removeItem(storageKey)}catch{/* A future replay keeps the same server intent. */}
}
