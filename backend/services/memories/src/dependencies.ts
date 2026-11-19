import type {SharedSource} from './shared-contributions.js'
import {parse,serialize} from 'cookie'
import type {MemoryConfig} from './config.js'
import {notFound,unauthorized,unavailable,uuid} from './contracts.js'
import type {AutoDependencies,AutomaticMessage,AutomaticOrigin,AutomaticRef,AutomaticSourceEvent} from './automatic-contracts.js'
export type StorageContext={allowed:boolean;authorizationVersion:number;automaticMemoryAllowed?:boolean;privateFeedAllowed?:boolean;privateFeedProcessingAllowed?:boolean}
export type SessionContext={accountId:string;sessionId:string;expiresAt:string;storyStorage:StorageContext;aiTextProcessing:StorageContext}
export type AccountContext={accountId:string;status:'active';accessVersion:number;storyStorage:StorageContext;aiTextProcessing:StorageContext}
export type PersonContext={id:string;accountId:string;displayName:string;relationship:string;story:string;worldId:string;status:'active';version:number;accessVersion:number;calledMe?:string;realName?:string;place?:string;birthMonthDay?:string;yearsText?:string;conversationTone?:'gentle'|'witty'|'quiet'|'stern'|null;voiceTimbre?:'warm'|'bright'|'deep'|null;personality?:string[];life?:string[];unknowns?:string[];catchphrase?:string|null}
export type WorldContext={id:string;code:string;displayName:string;enabled:boolean;catalogVersion:number}
export type SourceContext={id:string;accountId:string;personId:string;conversationId:string;kind:'text';author:{kind:'self'}|{kind:'persona';personId?:string;displayName?:string;aiGenerated?:boolean};text:string;version:number;createdAt:string;replyToMessageId?:string}
export type MemoryContextMessage=Pick<SourceContext,'id'|'conversationId'|'kind'|'author'|'text'|'version'|'createdAt'|'replyToMessageId'>
export type MemorySourceContext={source:SourceContext;messages:MemoryContextMessage[]}
export type DataRequestContext={requestId:string;accountId:string;kind:'export'|'delete_account';scope:'interaction_data'|'account_data';status:'accepted'|'processing'|'failed'|'completed';accountStatus:'active'|'restricted'|'deletion_pending'|'deleted';accountAccessVersion:number}
export interface ContextProvider{
 sharedSource?(accountId:string,albumId:string,id:string,version:number):Promise<SharedSource>
 session(cookie:string,expected?:string):Promise<SessionContext>
 account(accountId:string):Promise<AccountContext>
 person(accountId:string,id:string):Promise<PersonContext>
 persons(accountId:string):Promise<PersonContext[]>
 worlds():Promise<WorldContext[]>
 source(accountId:string,id:string):Promise<SourceContext>
 memoryContext?(accountId:string,id:string):Promise<MemorySourceContext>
 dataRequest?(requestId:string):Promise<DataRequestContext>
}
export const validPurposeContext=(value:unknown):value is StorageContext=>!!value&&typeof value==='object'&&typeof (value as StorageContext).allowed==='boolean'&&Number.isSafeInteger((value as StorageContext).authorizationVersion)&&(value as StorageContext).authorizationVersion>=0&&(!(value as StorageContext).allowed||(value as StorageContext).authorizationVersion>0)&&['automaticMemoryAllowed','privateFeedAllowed','privateFeedProcessingAllowed'].every(key=>(value as Record<string,unknown>)[key]===undefined||typeof (value as Record<string,unknown>)[key]==='boolean')
export class Dependencies implements AutoDependencies{
 constructor(private readonly config:MemoryConfig){}
 async sharedSource(accountId:string,albumId:string,id:string,version:number):Promise<SharedSource>{
  if(!this.config.socialOrigin)throw unavailable()
  const r=await this.get(this.config.socialOrigin,'/internal/v1/shared-albums/'+albumId+'/contributions/'+id+'/source?version='+version,{'X-Xijie-Account-Id':accountId}) as SharedSource
  if(!r||r.accountId!==accountId||r.albumId!==albumId||r.contributionId!==id||r.version!==version||!uuid.test(r.personId)||r.allowAdoption!==true||typeof r.title!=='string'||!r.title.trim()||[...r.title].length>40||typeof r.body!=='string'||!r.body.trim()||[...r.body].length>500)throw unavailable();return r
 }
 private async get(origin:string,path:string,headers:Record<string,string>={}){
  let response:Response
  try{response=await fetch(new URL(path,origin),{redirect:'error',signal:AbortSignal.timeout(3000),headers:{Authorization:'Bearer '+this.config.serviceToken,...headers}})}catch{throw unavailable()}
  if(response.status===401)throw unauthorized();if(response.status===404)throw notFound();if(!response.ok)throw unavailable()
  const result=await response.json().catch(()=>null) as {data?:unknown}|null;if(result?.data===undefined)throw unavailable();return result.data
 }
 private async post(origin:string,path:string,body:unknown,headers:Record<string,string>={}){
  let response:Response
  try{response=await fetch(new URL(path,origin),{method:'POST',redirect:'error',signal:AbortSignal.timeout(3000),headers:{Authorization:'Bearer '+this.config.serviceToken,'Content-Type':'application/json',...headers},body:JSON.stringify(body)})}catch{throw unavailable()}
  if(response.status===401)throw unauthorized();if(response.status===404)throw notFound();if(!response.ok)throw unavailable()
  const result=await response.json().catch(()=>null) as {data?:unknown}|null;if(result?.data===undefined)throw unavailable();return result.data
 }
 async sourceEvents(origin:AutomaticOrigin,accountIds:string[]):Promise<AutomaticSourceEvent[]>{
  if(!['people','conversations'].includes(origin)||!accountIds.length||accountIds.length>100||accountIds.some(id=>!uuid.test(id)))throw unavailable()
  const query=new URLSearchParams({limit:'50',accountIds:[...new Set(accountIds)].join(',')})
  const rows=await this.get(origin==='people'?this.config.peopleOrigin:this.config.conversationsOrigin,'/internal/v1/automatic-memory/events?'+query) as AutomaticSourceEvent[]
  if(!Array.isArray(rows)||rows.length>50||new Set(rows.map(row=>row?.eventId)).size!==rows.length||rows.some(row=>!row||!uuid.test(row.eventId)||!accountIds.includes(row.accountId)||!uuid.test(row.personId)||!uuid.test(row.sourceId)||!Number.isSafeInteger(row.sourceVersion)||row.sourceVersion<1||row.sourceKind!==(origin==='people'?'profile':'message')||!['upsert','remove'].includes(row.change)||!Number.isFinite(Date.parse(row.occurredAt))))throw unavailable()
  return rows
 }
 async ackSourceEvent(origin:AutomaticOrigin,eventId:string){
  if(!['people','conversations'].includes(origin)||!uuid.test(eventId))throw unavailable()
  const result=await this.post(origin==='people'?this.config.peopleOrigin:this.config.conversationsOrigin,'/internal/v1/automatic-memory/events/'+eventId+'/ack',{}) as {eventId?:string}
  if(result?.eventId!==eventId)throw unavailable()
  return result
 }
 async automaticMessage(accountId:string,id:string):Promise<AutomaticMessage>{
  const value=await this.get(this.config.conversationsOrigin,'/internal/v1/automatic-memory/messages/'+id,{'X-Xijie-Account-Id':accountId}) as AutomaticMessage
  const text=(value:unknown)=>typeof value==='string'&&[...value].length<=4000&&!value.includes('\0')&&!/\p{Surrogate}/u.test(value)
  const ref=(value:AutomaticRef)=>!!value&&uuid.test(value.id)&&Number.isSafeInteger(value.version)&&value.version>0
  if(!value||value.id!==id||value.accountId!==accountId||!uuid.test(value.personId)||!uuid.test(value.conversationId)||!ref(value)||!text(value.text)||!Number.isFinite(Date.parse(value.createdAt))||!Number.isSafeInteger(value.aiAuthorizationVersion)||value.aiAuthorizationVersion<0||typeof value.sequence!=='string'||!/^\d{1,19}$/.test(value.sequence)||BigInt(value.sequence)<1n||BigInt(value.sequence)>9223372036854775807n||!Array.isArray(value.context)||value.context.length>6||new Set(value.context.map(row=>row?.id)).size!==value.context.length||value.context.some(row=>!ref(row)||row.id===id||!['self','persona'].includes(row.authorKind)||!text(row.text)||!Number.isFinite(Date.parse(row.createdAt))))throw unavailable()
  return value
 }
 async validAutomaticRefs(accountId:string,personId:string,refs:AutomaticRef[]):Promise<AutomaticRef[]>{
  if(!uuid.test(accountId)||!uuid.test(personId)||refs.length>64||refs.some(ref=>!uuid.test(ref.id)||!Number.isSafeInteger(ref.version)||ref.version<1)||new Set(refs.map(ref=>ref.id)).size!==refs.length)throw unavailable()
  if(!refs.length)return []
  const value=await this.post(this.config.conversationsOrigin,'/internal/v1/automatic-memory/validate',{personId,refs},{'X-Xijie-Account-Id':accountId}) as {personId?:string;valid?:AutomaticRef[]}
  if(!value||value.personId!==personId||!Array.isArray(value.valid)||value.valid.length>refs.length||new Set(value.valid.map(ref=>ref?.id)).size!==value.valid.length||value.valid.some(ref=>!ref||!refs.some(expected=>expected.id===ref.id&&expected.version===ref.version)))throw unavailable()
  return value.valid
 }
 async session(cookie:string,expected?:string){
  const credential=parse(cookie)[this.config.sessionCookie];if(!credential||!/^[A-Za-z0-9_-]{43}$/.test(credential))throw unauthorized()
  const value=await this.get(this.config.identityOrigin,'/internal/v1/session-context',{Cookie:serialize(this.config.sessionCookie,credential)}) as SessionContext
  if(!value||!uuid.test(value.accountId)||!uuid.test(value.sessionId)||!validPurposeContext(value.storyStorage)||!validPurposeContext(value.aiTextProcessing)||!Number.isFinite(Date.parse(value.expiresAt)))throw unavailable()
  if(Date.parse(value.expiresAt)<=Date.now()||expected!==undefined&&value.sessionId!==expected)throw unauthorized();return value
 }
 async account(id:string){
  const value=await this.get(this.config.identityOrigin,'/internal/v1/accounts/'+id+'/context') as AccountContext
  if(!value||value.accountId!==id||value.status!=='active'||!Number.isSafeInteger(value.accessVersion)||value.accessVersion<1||!validPurposeContext(value.storyStorage)||!validPurposeContext(value.aiTextProcessing))throw unavailable();return value
 }
 async dataRequest(requestId:string):Promise<DataRequestContext>{
  const value=await this.get(this.config.identityOrigin,'/internal/v1/data-requests/'+requestId+'/context') as DataRequestContext
  if(!validDataRequestContext(value)||value.requestId!==requestId)throw unavailable()
  return value
 }
 private validPerson(value:PersonContext,accountId:string,id?:string){return !!value&&uuid.test(value.id)&&value.accountId===accountId&&(id===undefined||value.id===id)&&value.status==='active'&&typeof value.displayName==='string'&&typeof value.relationship==='string'&&typeof value.story==='string'&&uuid.test(value.worldId)&&Number.isSafeInteger(value.version)&&value.version>0&&Number.isSafeInteger(value.accessVersion)&&value.accessVersion>0}
 async person(accountId:string,id:string){const value=await this.get(this.config.peopleOrigin,'/internal/v1/persons/'+id+'/context',{'X-Xijie-Account-Id':accountId}) as PersonContext;if(!this.validPerson(value,accountId,id))throw unavailable();return value}
 async persons(accountId:string){const value=await this.get(this.config.peopleOrigin,'/internal/v1/persons',{'X-Xijie-Account-Id':accountId}) as PersonContext[];if(!Array.isArray(value)||value.some(item=>!this.validPerson(item,accountId)))throw unavailable();return value}
 async worlds(){const value=await this.get(this.config.peopleOrigin,'/internal/v1/worlds') as WorldContext[];if(!Array.isArray(value)||value.some(item=>!item||!uuid.test(item.id)||typeof item.code!=='string'||typeof item.displayName!=='string'||typeof item.enabled!=='boolean'||!Number.isSafeInteger(item.catalogVersion)))throw unavailable();return value}
 async source(accountId:string,id:string){
  const value=await this.get(this.config.conversationsOrigin,'/internal/v1/messages/'+id+'/context',{'X-Xijie-Account-Id':accountId}) as SourceContext
  if(!value||value.id!==id||value.accountId!==accountId||!uuid.test(value.personId)||!uuid.test(value.conversationId)||value.kind!=='text'||!['self','persona'].includes(value.author?.kind)||typeof value.text!=='string'||!Number.isSafeInteger(value.version)||value.version<1||!Number.isFinite(Date.parse(value.createdAt)))throw unavailable();return value
 }
 async memoryContext(accountId:string,id:string):Promise<MemorySourceContext>{
  const value=await this.get(this.config.conversationsOrigin,'/internal/v1/messages/'+id+'/memory-context',{'X-Xijie-Account-Id':accountId}) as MemorySourceContext
  const valid=(item:MemoryContextMessage)=>!!item&&uuid.test(item.id)&&uuid.test(item.conversationId)&&item.kind==='text'&&typeof item.text==='string'&&[...item.text].length<=4000&&Number.isSafeInteger(item.version)&&item.version>0&&['self','persona'].includes(item.author?.kind)
  if(!value||!valid(value.source)||value.source.accountId!==accountId||!uuid.test(value.source.personId)||value.source.id!==id||value.source.author.kind!=='persona'||!Array.isArray(value.messages)||value.messages.length!==2||value.messages.some(item=>!valid(item)||item.conversationId!==value.source.conversationId)||value.messages[0].author.kind!=='self'||value.messages[1].id!==id||value.messages[1].author.kind!=='persona'||value.messages[1].version!==value.source.version||value.source.replyToMessageId!==value.messages[0].id)throw unavailable()
  return value
 }
}
export function validDataRequestContext(value:unknown):value is DataRequestContext{
 if(!value||typeof value!=='object')return false
 const context=value as DataRequestContext
 return uuid.test(context.requestId)&&uuid.test(context.accountId)&&['export','delete_account'].includes(context.kind)&&['interaction_data','account_data'].includes(context.scope)&&['accepted','processing','failed','completed'].includes(context.status)&&['active','restricted','deletion_pending','deleted'].includes(context.accountStatus)&&Number.isSafeInteger(context.accountAccessVersion)&&context.accountAccessVersion>0
}
