import { parse, serialize } from "cookie"
import type { ConversationConfig } from "./config.js"
import {deliveryInput,receivedInput,type GiftDelivery,type ReceivedGift} from './gifts.js'
import {decodeVirtualWorldContext,decodeWorldStages,type VirtualWorldContext,type WorldStage,type WorldStageRef} from './virtual-world.js'
import {decodeGatherContext,type GatherContext} from './gather-context.js'
import {
  ConversationError,
  dependencyUnavailable,
  notFound,
  unauthorized,
  uuid,
} from "./contracts.js"
export type StorageContext = {
  allowed: boolean
  authorizationVersion: number
}
export type WorldActionPermission=StorageContext&{historicalWorldEventsAllowed?:boolean}
export type PhotoBinding={conversationId:string;clientMessageId:string;media:{id:string;version:number;mimeType:'image/webp';width:number;height:number;byteSize:number};expiresAt:string}
export type SessionContext = {
  chatReplySpeech?:StorageContext
  voiceCalls?:StorageContext
  storyBranches?:StorageContext
  offlineLife?:StorageContext
  worldActionProcessing?:WorldActionPermission
  accountId: string
  sessionId: string
  expiresAt: string
  storyStorage: StorageContext
  aiTextProcessing: StorageContext
  letterStorage?: StorageContext
  letterReplies?: StorageContext
  gatherReplies?: StorageContext
  chatPhotoStorage?: StorageContext
  chatImageReplies?: StorageContext
}
export type AccountContext = {
  chatReplySpeech?:StorageContext
  productionModelExecution?:StorageContext
  voiceCalls?:StorageContext
  storyBranches?:StorageContext
  offlineLife?:StorageContext
  worldActionProcessing?:WorldActionPermission
  accountId: string
  status: "active"
  accessVersion: number
  storyStorage: StorageContext
  aiTextProcessing: StorageContext
  giftStorage?: StorageContext
  giftReturns?: StorageContext
  letterStorage?: StorageContext
  letterReplies?: StorageContext
  gatherReplies?: StorageContext
  chatPhotoStorage?: StorageContext
  chatImageReplies?: StorageContext
}
export type PersonContext = {
  conversationTone?:'gentle'|'witty'|'quiet'|'stern'|null;voiceTimbre?:'warm'|'bright'|'deep'|null;personality?:string[];life?:string[];unknowns?:string[];catchphrase?:string|null
  id: string
  accountId: string
  displayName: string
  relationship: string
  story: string
  calledMe?:string
  realName?:string
  place?:string
  birthMonthDay?:string
  yearsText?:string
  worldVersion?:number
  worldId: string
  version: number
  accessVersion: number
  status: "active"
}
export type MemoryContext = { id: string; version: number; title: string; body: string }
export type AutomaticMemoryContext = {
  id:string;version:number;body:string;topic:string;timeDescription:string;evidence:string
  sourceKind:'profile'|'message';sourceId:string;sourceVersion:number;sourceAuthor:'self'
  reality:'user_reported'|'user_provided_profile';sourceCreatedAt:string;sourceSequence?:string
  sources:{id:string;version:number}[]
}
export type MemoryUse = {kind:'cherished'|'automatic';id:string;version:number;sourceKind?:'profile'|'message';sourceId?:string;sourceVersion?:number;sources?:{id:string;version:number}[]}
export interface ContextProvider {
  photoBind?(accountId:string,conversationId:string,clientMessageId:string,mediaId:string,version:number):Promise<PhotoBinding>
  photoBytes?(accountId:string,jobId:string,attemptId:string):Promise<Buffer>
  memoryContextAvailable?():boolean
  gatherContext?(accountId:string,worldId:string):Promise<GatherContext>
  validateMemories?(accountId:string,personId:string,refs:{id:string;version:number}[]):Promise<boolean>
  validateLetterMemory?(accountId:string,personId:string,ref:{id:string;version:number}):Promise<boolean>
  gift?(accountId:string,deliveryId:string):Promise<GiftDelivery>
  receivedGift?(accountId:string,receivedId:string):Promise<ReceivedGift>
  session(cookie: string, expected?: string): Promise<SessionContext>
  account(accountId: string): Promise<AccountContext>
  person(accountId: string, personId: string): Promise<PersonContext>
  persons(accountId: string): Promise<PersonContext[]>
  memories?(accountId: string, personId: string, query: string): Promise<MemoryContext[]>
  automaticMemories?(accountId:string,personId:string,query:string):Promise<AutomaticMemoryContext[]>
  validateAutomaticMemories?(accountId:string,personId:string,refs:{id:string;version:number}[]):Promise<boolean>
  virtualWorld?(accountId:string,personId:string):Promise<VirtualWorldContext>
  resolveWorldStages?(world:VirtualWorldContext,refs:WorldStageRef[]):Promise<WorldStage[]>
}
const storage = (value: unknown): value is StorageContext =>
  !!value &&
  typeof value === "object" &&
  typeof (value as StorageContext).allowed === "boolean" &&
  Number.isSafeInteger((value as StorageContext).authorizationVersion) &&
  (value as StorageContext).authorizationVersion >= 0 &&
  (!(value as StorageContext).allowed || (value as StorageContext).authorizationVersion > 0)
const worldPermission=(value:unknown):value is WorldActionPermission=>storage(value)&&((value as WorldActionPermission).historicalWorldEventsAllowed===undefined||typeof (value as WorldActionPermission).historicalWorldEventsAllowed==='boolean')&&(!(value as WorldActionPermission).historicalWorldEventsAllowed||value.allowed)
export class Dependencies implements ContextProvider {
  constructor(private readonly config: ConversationConfig) {}
  async resolveWorldStages(world:VirtualWorldContext,refs:WorldStageRef[]):Promise<WorldStage[]>{
    let response:Response
    try{response=await fetch(new URL('/internal/v1/persons/'+world.personId+'/world-stages/resolve',this.config.peopleOrigin),{method:'POST',redirect:'error',signal:AbortSignal.timeout(3000),headers:{Authorization:'Bearer '+this.config.serviceToken,'X-Xijie-Account-Id':world.accountId,'Content-Type':'application/json'},body:JSON.stringify({expectedPersonVersion:world.personVersion,expectedWorldVersion:world.worldVersion,stages:refs})})}catch{throw dependencyUnavailable()}
    if(response.status===404)throw notFound()
    if(response.status===409)throw new ConversationError(409,'WORLD_CONTEXT_CHANGED','The character world changed while resolving past experiences.')
    if(!response.ok)throw dependencyUnavailable()
    const result=await response.json().catch(()=>null) as {data?:unknown}|null
    return decodeWorldStages(result?.data,world,refs)
  }
  memoryContextAvailable(){return Boolean(this.config.memoriesOrigin)}
  private async get(
    origin: string,
    path: string,
    headers: Record<string, string> = {},
  ) {
    let response: Response
    try {
      response = await fetch(new URL(path, origin), {
        redirect: "error",
        signal: AbortSignal.timeout(3000),
        headers: {
          Authorization: "Bearer " + this.config.serviceToken,
          ...headers,
        },
      })
    } catch {
      throw dependencyUnavailable()
    }
    if (response.status === 401) throw unauthorized()
    if (response.status === 404) throw notFound()
    if(response.status===403&&path.startsWith('/internal/v1/gifts/'))throw new ConversationError(403,'GIFT_PERMISSION_REQUIRED','Reading this gift is not permitted.')
    if (!response.ok) throw dependencyUnavailable()
    const result = (await response.json().catch(() => null)) as {
      data?: unknown
    } | null
    if (!result || result.data === undefined) throw dependencyUnavailable()
    return result.data
  }
  async session(
    cookieHeader: string,
    expected?: string,
  ): Promise<SessionContext> {
    const credential = parse(cookieHeader)[this.config.sessionCookie]
    if (!credential || !/^[A-Za-z0-9_-]{43}$/.test(credential))
      throw unauthorized()
    const value = (await this.get(
      this.config.identityOrigin,
      "/internal/v1/session-context",
      { Cookie: serialize(this.config.sessionCookie, credential) },
    )) as SessionContext
    if (
      !value ||
      !uuid.test(value.accountId) ||
      !uuid.test(value.sessionId) ||
      !storage(value.storyStorage) ||
      !storage(value.aiTextProcessing) ||
      (value.chatReplySpeech!==undefined&&!storage(value.chatReplySpeech)) ||
      (value.voiceCalls!==undefined&&!storage(value.voiceCalls)) || (value.storyBranches!==undefined&&!storage(value.storyBranches)) || (value.offlineLife!==undefined&&!storage(value.offlineLife)) || (value.worldActionProcessing!==undefined&&!worldPermission(value.worldActionProcessing)) ||
      (value.letterStorage!==undefined&&!storage(value.letterStorage)) ||
      (value.letterReplies!==undefined&&!storage(value.letterReplies)) ||
      (value.gatherReplies!==undefined&&!storage(value.gatherReplies)) ||
      (value.chatPhotoStorage!==undefined&&!storage(value.chatPhotoStorage)) ||
      (value.chatImageReplies!==undefined&&!storage(value.chatImageReplies)) ||
      !Number.isFinite(Date.parse(value.expiresAt))
    )
      throw dependencyUnavailable()
    if (
      Date.parse(value.expiresAt) <= Date.now() ||
      (expected !== undefined && expected !== value.sessionId)
    )
      throw unauthorized()
    return value
  }
  async account(accountId: string): Promise<AccountContext> {
    const value = (await this.get(
      this.config.identityOrigin,
      "/internal/v1/accounts/" + accountId + "/context",
    )) as AccountContext
    if (
      !value ||
      value.accountId !== accountId ||
      value.status !== "active" ||
      !Number.isSafeInteger(value.accessVersion) ||
      value.accessVersion < 1 ||
      !storage(value.storyStorage) ||
      !storage(value.aiTextProcessing) ||
      (value.chatReplySpeech!==undefined&&!storage(value.chatReplySpeech)) ||
      (value.productionModelExecution!==undefined&&!storage(value.productionModelExecution)) ||
      (value.voiceCalls!==undefined&&!storage(value.voiceCalls)) || (value.storyBranches!==undefined&&!storage(value.storyBranches)) || (value.offlineLife!==undefined&&!storage(value.offlineLife)) || (value.worldActionProcessing!==undefined&&!worldPermission(value.worldActionProcessing)) ||
      (value.giftStorage!==undefined&&!storage(value.giftStorage)) ||
      (value.giftReturns!==undefined&&!storage(value.giftReturns))
      || (value.letterStorage!==undefined&&!storage(value.letterStorage))
      || (value.letterReplies!==undefined&&!storage(value.letterReplies))
      || (value.gatherReplies!==undefined&&!storage(value.gatherReplies))
      || (value.chatPhotoStorage!==undefined&&!storage(value.chatPhotoStorage))
      || (value.chatImageReplies!==undefined&&!storage(value.chatImageReplies))
    )
      throw dependencyUnavailable()
    return value
  }
  async gift(accountId:string,deliveryId:string):Promise<GiftDelivery>{
    if(!this.config.giftsOrigin)throw dependencyUnavailable()
    const value=deliveryInput(await this.get(this.config.giftsOrigin,'/internal/v1/gifts/deliveries/'+deliveryId+'?accountId='+accountId))
    if(value.accountId!==accountId||value.id!==deliveryId)throw dependencyUnavailable()
    return value
  }
  private async mediaRequest(accountId:string,path:string,body:object){
    if(!this.config.mediaOrigin)throw dependencyUnavailable()
    let response:Response
    try{response=await fetch(new URL(path,this.config.mediaOrigin),{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+this.config.serviceToken,'X-Xijie-Account-Id':accountId,'Content-Type':'application/json'},body:JSON.stringify(body)})}catch{throw dependencyUnavailable()}
    if(!response.ok){
      if(response.status===404)throw notFound()
      const value=await response.json().catch(()=>null) as {error?:{code?:unknown}}|null
      const code=value?.error?.code
      if(response.status===403&&typeof code==='string'&&['STORAGE_PERMISSION_REQUIRED','CHAT_PHOTO_STORAGE_PERMISSION_REQUIRED','CHAT_IMAGE_REPLY_PERMISSION_REQUIRED','AUTHORIZATION_CHANGED','PHOTO_PERMISSION_REQUIRED'].includes(code))throw new ConversationError(403,code,'The chat photo permission changed.')
      if(response.status===409){
        // A rejected prebinding proves this unaccepted selection cannot be used.
        // Preserve that distinction from a changed/unknown request outcome.
        const mapped=code==='PHOTO_SELECTION_INVALID'||code==='MEDIA_BINDING_CONFLICT'?'PHOTO_SELECTION_INVALID':code==='AUTHORIZATION_CHANGED'?'AUTHORIZATION_CHANGED':'SOURCE_CHANGED'
        throw new ConversationError(409,mapped,'The chat photo source changed.')
      }
      throw dependencyUnavailable()
    }
    return response
  }
  async photoBind(accountId:string,conversationId:string,clientMessageId:string,mediaId:string,version:number):Promise<PhotoBinding>{
    const response=await this.mediaRequest(accountId,`/internal/v1/conversations/${conversationId}/messages/${clientMessageId}/media-bindings`,{mediaId,version})
    const result=await response.json().catch(()=>null) as {data?:PhotoBinding}|null,value=result?.data,media=value?.media
    if(!value||value.conversationId!==conversationId||value.clientMessageId!==clientMessageId||!media||media.id!==mediaId||media.version!==version||media.mimeType!=='image/webp'||![media.width,media.height,media.byteSize].every(n=>Number.isSafeInteger(n)&&n>0)||media.byteSize>1024*1024||!Number.isFinite(Date.parse(value.expiresAt))||Date.parse(value.expiresAt)>Date.now()+65000)throw dependencyUnavailable()
    return value
  }
  async photoBytes(accountId:string,jobId:string,attemptId:string):Promise<Buffer>{
    const response=await this.mediaRequest(accountId,`/internal/v1/photo-reply-jobs/${jobId}/attempts/${attemptId}/media-content`,{})
    if(response.headers.get('content-type')?.split(';')[0]!=='image/webp'||!response.body)throw dependencyUnavailable()
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0
    try{while(true){const next=await reader.read();if(next.done)break;length+=next.value.byteLength;if(length>1024*1024){await reader.cancel();throw dependencyUnavailable()}chunks.push(next.value)}}catch{throw dependencyUnavailable()}
    const bytes=Buffer.concat(chunks)
    if(bytes.length<12||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP')throw dependencyUnavailable()
    return bytes
  }
  async receivedGift(accountId:string,receivedId:string):Promise<ReceivedGift>{
    if(!this.config.giftsOrigin)throw dependencyUnavailable()
    const value=receivedInput(await this.get(this.config.giftsOrigin,'/internal/v1/gifts/received/'+receivedId+'?accountId='+accountId))
    if(value.accountId!==accountId||value.id!==receivedId)throw dependencyUnavailable()
    return value
  }
  private validPerson(value: PersonContext, accountId: string, id?: string) {
    return (
      !!value &&
      uuid.test(value.id) &&
      value.accountId === accountId &&
      (id === undefined || value.id === id) &&
      value.status === "active" &&
      typeof value.displayName === "string" &&
      typeof value.relationship === "string" &&
      typeof value.story === "string" &&
      uuid.test(value.worldId) &&
      Number.isSafeInteger(value.version) &&
      value.version > 0 &&
      Number.isSafeInteger(value.accessVersion) &&
      value.accessVersion > 0
    )
  }
  async person(accountId: string, personId: string): Promise<PersonContext> {
    const value = (await this.get(
      this.config.peopleOrigin,
      "/internal/v1/persons/" + personId + "/context",
      { "X-Xijie-Account-Id": accountId },
    )) as PersonContext
    if (!this.validPerson(value, accountId, personId))
      throw dependencyUnavailable()
    return value
  }
  async persons(accountId: string): Promise<PersonContext[]> {
    const value = (await this.get(
      this.config.peopleOrigin,
      "/internal/v1/persons",
      { "X-Xijie-Account-Id": accountId },
    )) as PersonContext[]
    if (
      !Array.isArray(value) ||
      value.some((item) => !this.validPerson(item, accountId))
    )
      throw dependencyUnavailable()
    return value
  }

  async memories(accountId: string, personId: string, query: string): Promise<MemoryContext[]> {
    if (!this.config.memoriesOrigin) return []
    const search = new URLSearchParams({q: [...query].slice(0,160).join('')})
    const result = await this.get(this.config.memoriesOrigin, '/internal/v1/persons/'+personId+'/memories/context?'+search,
      {'X-Xijie-Account-Id':accountId}) as {personId:string;memories:MemoryContext[]}
    if (!result || result.personId!==personId || !Array.isArray(result.memories) || result.memories.length>8 || result.memories.some(value =>
      !value || !uuid.test(value.id) || !Number.isSafeInteger(value.version) || value.version<1 || typeof value.title!=='string' || typeof value.body!=='string' || [...value.body].length>1200) || new Set(result.memories.map(value=>value.id)).size!==result.memories.length) throw dependencyUnavailable()
    return result.memories
  }
  async virtualWorld(accountId:string,personId:string):Promise<VirtualWorldContext>{
    return decodeVirtualWorldContext(await this.get(this.config.peopleOrigin,'/internal/v1/persons/'+personId+'/world-context',{'X-Xijie-Account-Id':accountId}),accountId,personId)
  }
  async gatherContext(accountId:string,worldId:string):Promise<GatherContext>{
    return decodeGatherContext(await this.get(this.config.peopleOrigin,'/internal/v1/worlds/'+worldId+'/gather-context',{'X-Xijie-Account-Id':accountId}),accountId,worldId)
  }
  async validateMemories(accountId:string,personId:string,refs:{id:string;version:number}[]):Promise<boolean>{
    if(!refs.length)return true
    if(!this.config.memoriesOrigin||refs.some(ref=>!uuid.test(ref.id)||!Number.isSafeInteger(ref.version)||ref.version<1)||new Set(refs.map(ref=>ref.id)).size!==refs.length)throw dependencyUnavailable()
    for(let at=0;at<refs.length;at+=8){
      if(!await this.validateCherished(accountId,personId,refs.slice(at,at+8),'memories'))return false
    }
    return true
  }
  validateLetterMemory(accountId:string,personId:string,ref:{id:string;version:number}):Promise<boolean>{
    return this.validateCherished(accountId,personId,[ref],'letter-memory')
  }
  private async validateCherished(accountId:string,personId:string,refs:{id:string;version:number}[],purpose:'memories'|'letter-memory'){
    if(!this.config.memoriesOrigin)throw dependencyUnavailable()
    let response:Response
    try{response=await fetch(new URL('/internal/v1/persons/'+personId+'/'+purpose+'/validate',this.config.memoriesOrigin),{method:'POST',redirect:'error',signal:AbortSignal.timeout(3000),headers:{Authorization:'Bearer '+this.config.serviceToken,'Content-Type':'application/json','X-Xijie-Account-Id':accountId},body:JSON.stringify({refs})})}catch{throw dependencyUnavailable()}
    if([401,403,404].includes(response.status)||purpose==='letter-memory'&&response.status===409)return false
    if(!response.ok)throw dependencyUnavailable()
    const data=(await response.json().catch(()=>null))?.data
    if(data?.personId!==personId||typeof data.valid!=='boolean')throw dependencyUnavailable()
    return data.valid
  }
  async automaticMemories(accountId:string,personId:string,query:string):Promise<AutomaticMemoryContext[]>{
    if(!this.config.memoriesOrigin)return []
    const params=new URLSearchParams({q:[...query].slice(0,160).join('')})
    const result=await this.get(this.config.memoriesOrigin,'/internal/v1/persons/'+personId+'/automatic-memories/context?'+params,{'X-Xijie-Account-Id':accountId}) as {personId:string;entries:AutomaticMemoryContext[]}
    const ref=(value:{id:string;version:number})=>!!value&&uuid.test(value.id)&&Number.isSafeInteger(value.version)&&value.version>0
    const bounded=(value:unknown,max:number)=>typeof value==='string'&&[...value].length<=max&&!value.includes('\0')&&!/\p{Surrogate}/u.test(value)
    if(!result||result.personId!==personId||!Array.isArray(result.entries)||result.entries.length>8||new Set(result.entries.map(value=>value?.id)).size!==result.entries.length||result.entries.some(value=>!ref(value)||!bounded(value.body,600)||!bounded(value.topic,120)||!bounded(value.timeDescription,120)||!bounded(value.evidence,400)||!['profile','message'].includes(value.sourceKind)||!uuid.test(value.sourceId)||!Number.isSafeInteger(value.sourceVersion)||value.sourceVersion<1||value.sourceAuthor!=='self'||value.reality!==(value.sourceKind==='message'?'user_reported':'user_provided_profile')||!Number.isFinite(Date.parse(value.sourceCreatedAt))||value.sourceSequence!==undefined&&!/^[1-9][0-9]{0,18}$/.test(value.sourceSequence)||!Array.isArray(value.sources)||value.sources.length>7||value.sources.some(source=>!ref(source))||new Set(value.sources.map(source=>source.id)).size!==value.sources.length))throw dependencyUnavailable()
    return result.entries
  }
  async validateAutomaticMemories(accountId:string,personId:string,refs:{id:string;version:number}[]):Promise<boolean>{
    if(!refs.length)return true
    if(!this.config.memoriesOrigin||refs.length>32||refs.some(ref=>!uuid.test(ref.id)||!Number.isSafeInteger(ref.version)||ref.version<1)||new Set(refs.map(ref=>ref.id)).size!==refs.length)throw dependencyUnavailable()
    for(let offset=0;offset<refs.length;offset+=8){
    let response:Response
    try{response=await fetch(new URL('/internal/v1/persons/'+personId+'/automatic-memories/validate',this.config.memoriesOrigin),{method:'POST',redirect:'error',signal:AbortSignal.timeout(3000),headers:{Authorization:'Bearer '+this.config.serviceToken,'Content-Type':'application/json','X-Xijie-Account-Id':accountId},body:JSON.stringify({refs:refs.slice(offset,offset+8)})})}catch{throw dependencyUnavailable()}
    if(response.status===404||response.status===403||response.status===401)return false
    if(!response.ok)throw dependencyUnavailable()
    const result=await response.json().catch(()=>null) as {data?:{personId?:string;valid?:boolean}}|null
    if(result?.data?.personId!==personId||typeof result.data.valid!=='boolean')throw dependencyUnavailable()
    if(!result.data.valid)return false
    }
    return true
  }
}
