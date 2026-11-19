import type {AlbumDependencies,AlbumMemoryReceipt,AlbumReward} from './albums-contracts.js'
import { parse, serialize } from "cookie"

import type { SocialConfig } from "./config.js"
import type {AiPermission,EchoEvent,EchoMemory,EchoPerson,MemoryRef} from './echo-contracts.js'
import {decodeVirtualWorldContext,type VirtualWorldContext} from './virtual-world.js'
import {postMediaMetadata} from './post-media.js'

import {
  SocialError,
  identifier,
  uuid,
  positive,
  instant,
  unavailable,
  notFound,
  unauthorized,
  type PersonMeta,
  type MovementPage,
  type WorldCard,
  type DataRequest,
  type PostMedia,
} from "./contracts.js"

export type Storage = {
  allowed: boolean
  authorizationVersion: number
  privateFeedAllowed?: boolean
}

export type Session = {
  accountId: string
  sessionId: string
  expiresAt: string
  storyStorage: Storage
}

export type Account = {
  accountId: string
  status: "active"
  accessVersion: number
  storyStorage: Storage
  photoStorage?: Storage
  aiTextProcessing?:AiPermission
}

export interface ContextProvider {
  bindPostMedia?(accountId:string,postId:string,clientPostId:string,mediaIds:string[]):Promise<PostMedia[]>
  releasePostMedia?(accountId:string,postId:string):Promise<void>
  memoryEvents?(accountIds:string[]):Promise<EchoEvent[]>
  ackMemoryEvent?(id:string):Promise<void>
  echoMemory?(accountId:string,personId:string,id:string,version:number,aiVersion:number):Promise<EchoMemory>
  validMemories?(accountId:string,personId:string,refs:MemoryRef[]):Promise<MemoryRef[]>
  echoPerson?(accountId:string,personId:string,aiVersion:number):Promise<EchoPerson>
  echoWorld?(accountId:string,personId:string,aiVersion:number):Promise<VirtualWorldContext>
  session(cookie: string, expected?: string): Promise<Session>
  account(accountId: string): Promise<Account>
  persons(accountId: string): Promise<PersonMeta[]>
  movements(
    accountId: string,
    personId: string,
    afterVersion: number,
    throughVersion: number,
    limit: number,
  ): Promise<MovementPage>
  dataRequest(id: string): Promise<DataRequest>
}

const storage = (v: Storage) =>
  v &&
  typeof v.allowed === "boolean" &&
  Number.isSafeInteger(v.authorizationVersion) &&
  v.authorizationVersion >= 0 &&
  (!v.allowed || v.authorizationVersion > 0)

export const validPerson = (v: PersonMeta) =>
  v &&
  uuid.test(v.id) &&
  typeof v.displayName === "string" &&
  [...v.displayName].length <= 200 &&
  v.displayName.length > 0 &&
  uuid.test(v.worldId) &&
  positive(v.version) &&
  positive(v.accessVersion) &&
  positive(v.worldVersion) &&
  v.worldVersion <= v.version

const card = (v: WorldCard) =>
  v &&
  uuid.test(v.id) &&
  typeof v.code === "string" &&
  /^[a-z0-9][a-z0-9_-]{0,63}$/.test(v.code) &&
  typeof v.displayName === "string" &&
  v.displayName.length > 0 &&
  [...v.displayName].length <= 200 &&
  positive(v.catalogVersion) &&
  typeof v.enabled === "boolean"

export class Dependencies implements ContextProvider,AlbumDependencies {
  constructor(readonly config: SocialConfig) {}

  private async albumPost(origin:string|undefined,path:string,accountId:string,body:unknown){
    if(!origin)throw unavailable()
    let response:Response;try{response=await fetch(new URL(path,origin),{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{Authorization:'Bearer '+this.config.serviceToken,'X-Xijie-Account-Id':accountId,'Content-Type':'application/json'},body:JSON.stringify(body)})}catch{throw unavailable()}
    const result=await response.json().catch(()=>null)
    if(response.status===404)throw notFound();if(!response.ok){if([403,409].includes(response.status)&&typeof result?.error?.code==='string')throw new SocialError(response.status,result.error.code,'The album source is not available.');throw unavailable()}if(!result?.data)throw unavailable();return result.data
  }
  async adoptAlbum(accountId:string,albumId:string,contributionId:string,sourceVersion:number):Promise<AlbumMemoryReceipt>{
    const r=await this.albumPost(this.config.memoriesOrigin,'/internal/v1/shared-albums/'+albumId+'/contributions/'+contributionId+'/adopt',accountId,{sourceVersion})
    if(r.albumId!==albumId||r.contributionId!==contributionId||!uuid.test(r.memoryId)||!positive(r.version)||!['fulfilled','revoked'].includes(r.status))throw unavailable();return r
  }
  async revokeAlbumSource(accountId:string,albumId:string,contributionId:string){const r=await this.albumPost(this.config.memoriesOrigin,'/internal/v1/shared-albums/'+albumId+'/contributions/'+contributionId+'/revoke',accountId,{});if(r.contributionId!==contributionId||r.status!=='revoked')throw unavailable()}
  async albumReward(accountId:string,albumId:string):Promise<AlbumReward|null>{
    if(!this.config.albums?.giftsOrigin)throw unavailable()
    let r:AlbumReward;try{r=await this.get(this.config.albums.giftsOrigin,'/internal/v1/promotions/shared-albums/'+albumId+'/reward',{'X-Xijie-Account-Id':accountId}) as AlbumReward}catch(e){if(e instanceof SocialError&&e.status===404)return null;throw e}
    if(r.albumId!==albumId||r.accountId!==accountId||!uuid.test(r.receiptId)||r.assetType!=='voucher'||r.assetId!=='return-stamp'||r.units!==1||!instant(r.grantedAt))throw unavailable();return r
  }
  async rewardAlbum(accountId:string,albumId:string):Promise<AlbumReward>{
    const r=await this.albumPost(this.config.albums?.giftsOrigin??undefined,'/internal/v1/promotions/shared-albums/'+albumId+'/reward',accountId,{})
    if(r.albumId!==albumId||r.accountId!==accountId||!uuid.test(r.receiptId)||r.assetType!=='voucher'||r.assetId!=='return-stamp'||r.units!==1||!instant(r.grantedAt))throw unavailable();return r
  }

  private async mediaRequest(accountId:string,postId:string,action:string,body:unknown){
    if(!this.config.mediaOrigin)throw new SocialError(409,'MEDIA_NOT_AVAILABLE','Photo posting is not connected yet.')
    let response:Response
    try{response=await fetch(new URL('/internal/v1/social/posts/'+identifier(postId)+'/'+action,this.config.mediaOrigin),{method:'POST',redirect:'error',signal:AbortSignal.timeout(action==='media-release'?2000:10000),headers:{Authorization:'Bearer '+this.config.serviceToken,'X-Xijie-Account-Id':identifier(accountId),'Content-Type':'application/json'},body:JSON.stringify(body)})}catch{throw unavailable()}
    const result=await response.json().catch(()=>null)
    if(!response.ok){
      const code=result?.error?.code
      if(response.status===404)throw notFound()
      if(response.status===403&&['PHOTO_PERMISSION_REQUIRED','STORAGE_PERMISSION_REQUIRED'].includes(code)||response.status===409&&['MEDIA_NOT_READY','MEDIA_BINDING_CONFLICT','MEDIA_REVOKED','IDEMPOTENCY_CONFLICT','AUTHORIZATION_CHANGED'].includes(code))throw new SocialError(response.status,code,'The photo is unavailable for this post.')
      throw unavailable()
    }
    if(result?.data===undefined)throw unavailable();return result.data
  }
  async bindPostMedia(accountId:string,postId:string,clientPostId:string,mediaIds:string[]):Promise<PostMedia[]>{
    const value=await this.mediaRequest(accountId,postId,'media-bindings',{clientPostId,mediaIds})
    if(value?.postId!==postId)throw unavailable();return postMediaMetadata(value.media,mediaIds)
  }
  async releasePostMedia(accountId:string,postId:string){await this.mediaRequest(accountId,postId,'media-release',{})}

  private async post(origin:string,path:string,accountId:string|undefined,body:unknown){
    let response:Response
    try{response=await fetch(new URL(path,origin),{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{Authorization:'Bearer '+this.config.serviceToken,'Content-Type':'application/json',...(accountId?{'X-Xijie-Account-Id':accountId}:{})},body:JSON.stringify(body)})}catch{throw unavailable()}
    if(response.status===404)throw notFound();if(!response.ok)throw unavailable();const result=await response.json().catch(()=>null);if(result?.data===undefined)throw unavailable();return result.data
  }
  async memoryEvents(accountIds:string[]):Promise<EchoEvent[]>{
    if(!accountIds.length||accountIds.length>100||accountIds.some(id=>!uuid.test(id)))throw unavailable()
    const value=await this.get(this.config.memoriesOrigin!,'/internal/v1/social/memory-events?'+new URLSearchParams({accountIds:accountIds.join(','),limit:'50'})) as EchoEvent[]
    if(!Array.isArray(value)||value.length>50||new Set(value.map(v=>v?.eventId)).size!==value.length||value.some(v=>!v||!uuid.test(v.eventId)||!accountIds.includes(v.accountId)||!uuid.test(v.personId)||!uuid.test(v.memoryId)||!positive(v.sourceVersion)||!['upsert','remove'].includes(v.change)||!Number.isSafeInteger(v.echoAiAuthorizationVersion)||v.echoAiAuthorizationVersion<0||!instant(v.occurredAt)))throw unavailable();return value
  }
  async ackMemoryEvent(id:string){const value=await this.post(this.config.memoriesOrigin!,'/internal/v1/social/memory-events/'+identifier(id)+'/ack',undefined,{});if(value?.eventId!==id)throw unavailable()}
  async validMemories(accountId:string,personId:string,refs:MemoryRef[]):Promise<MemoryRef[]>{
    if(!refs.length)return [];if(refs.length>64||refs.some(v=>!uuid.test(v.id)||!positive(v.version)))throw unavailable()
    const value=await this.post(this.config.memoriesOrigin!,'/internal/v1/social/persons/'+personId+'/memories/validate',accountId,{refs})
    if(value?.personId!==personId||!Array.isArray(value.valid)||new Set(value.valid.map((v:MemoryRef)=>v?.id)).size!==value.valid.length||value.valid.some((v:MemoryRef)=>!v||!refs.some(r=>r.id===v.id&&r.version===v.version)))throw unavailable();return value.valid
  }
  async echoMemory(accountId:string,personId:string,id:string,version:number,aiVersion:number):Promise<EchoMemory>{
    const value=await this.get(this.config.memoriesOrigin!,'/internal/v1/social/persons/'+personId+'/memories/'+id+'/context?'+new URLSearchParams({expectedVersion:String(version),expectedAiVersion:String(aiVersion)}),{'X-Xijie-Account-Id':accountId},true) as EchoMemory
    const bounded=(s:unknown,max:number)=>typeof s==='string'&&[...s].length<=max&&!s.includes('\0')&&!/\p{Surrogate}/u.test(s)
    if(!value||value.accountId!==accountId||value.personId!==personId||value.id!==id||value.version!==version||!['manual','ai_candidate','shared_contribution'].includes(value.origin)||!bounded(value.title,120)||!value.title.trim()||!bounded(value.body,10000)||!value.body.trim()||!instant(value.confirmedAt)||!instant(value.updatedAt))throw unavailable();return value
  }
  async echoPerson(accountId:string,personId:string,aiVersion:number):Promise<EchoPerson>{
    const value=await this.get(this.config.peopleOrigin,'/internal/v1/social/persons/'+personId+'/ai-context?expectedAiVersion='+aiVersion,{'X-Xijie-Account-Id':accountId},true) as EchoPerson
    if(!validPerson(value)||value.id!==personId||value.accountId!==accountId||typeof value.story!=='string'||[...value.story].length>20000||typeof value.relationship!=='string')throw unavailable();return value
  }
  async echoWorld(accountId:string,personId:string,aiVersion:number){return decodeVirtualWorldContext(await this.get(this.config.peopleOrigin,'/internal/v1/social/persons/'+personId+'/world-context?expectedAiVersion='+aiVersion,{'X-Xijie-Account-Id':accountId},true),accountId,personId)}

  private async sourceFailure(response:Response){
    const value=await response.json().catch(()=>null),code=value?.error?.code
    const known=response.status===409&&["SOURCE_CHANGED","WORLD_CONTEXT_CHANGED","AUTHORIZATION_CHANGED"].includes(code)||response.status===403&&["AI_PERMISSION_REQUIRED","STORAGE_PERMISSION_REQUIRED","AUTHORIZATION_CHANGED"].includes(code)
    if(known)throw new SocialError(response.status,code,"The source authority changed.")
    throw unavailable()
  }

  private async get(
    origin: string,
    path: string,
    headers: Record<string, string> = {},
    source = false,
  ) {
    let response: Response
    try {
      response = await fetch(new URL(path, origin), {
        redirect: "error",
        signal: AbortSignal.timeout(5000),
        headers: {
          Authorization: "Bearer " + this.config.serviceToken,
          ...headers,
        },
      })
    } catch {
      throw unavailable()
    }
    if (response.status === 404) throw notFound()
    if (response.status === 401) throw unauthorized()
    if (!response.ok) {if(source)await this.sourceFailure(response);throw unavailable()}
    const value = await response.json().catch(() => null)
    if (value?.data === undefined) throw unavailable()
    return value.data
  }

  async session(cookie: string, expected?: string): Promise<Session> {
    const token = parse(cookie)[this.config.sessionCookie]
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw unauthorized()
    const v = (await this.get(
      this.config.identityOrigin,
      "/internal/v1/session-context",
      { Cookie: serialize(this.config.sessionCookie, token) },
    )) as Session
    if (
      !v ||
      !uuid.test(v.accountId) ||
      !uuid.test(v.sessionId) ||
      !instant(v.expiresAt) ||
      !storage(v.storyStorage)
    )
      throw unavailable()
    if (
      Date.parse(v.expiresAt) <= Date.now() ||
      (expected !== undefined && expected !== v.sessionId)
    )
      throw unauthorized()
    return v
  }

  async account(accountId: string): Promise<Account> {
    const v = (await this.get(
      this.config.identityOrigin,
      "/internal/v1/accounts/" + identifier(accountId) + "/context",
    )) as Account
    if (
      !v ||
      v.accountId !== accountId ||
      v.status !== "active" ||
      !positive(v.accessVersion) ||
      !storage(v.storyStorage) || (v.photoStorage!==undefined&&!storage(v.photoStorage))
    )
      throw unavailable()
    return v
  }

  async persons(accountId: string): Promise<PersonMeta[]> {
    const v = (await this.get(
      this.config.peopleOrigin,
      "/internal/v1/social/persons",
      { "X-Xijie-Account-Id": accountId },
    )) as { accountId: string, persons: PersonMeta[] }
    if (
      !v ||
      v.accountId !== accountId ||
      !Array.isArray(v.persons) ||
      v.persons.length > 1000 ||
      v.persons.some((p) => !validPerson(p)) ||
      new Set(v.persons.map((p) => p.id)).size !== v.persons.length
    )
      throw unavailable()
    return v.persons
  }

  async movements(
    accountId: string,
    personId: string,
    afterVersion: number,
    throughVersion: number,
    limit: number,
  ): Promise<MovementPage> {
    const q = new URLSearchParams({
        afterVersion: String(afterVersion),
        throughVersion: String(throughVersion),
        limit: String(limit),
      }),
      v = (await this.get(
        this.config.peopleOrigin,
        "/internal/v1/social/persons/" +
          identifier(personId) +
          "/world-movements?" +
          q,
        { "X-Xijie-Account-Id": accountId },
      )) as MovementPage
    if (
      !v ||
      v.accountId !== accountId ||
      !validPerson(v.person) ||
      v.person.id !== personId ||
      v.person.worldVersion < throughVersion ||
      !Array.isArray(v.items) ||
      v.items.length > limit ||
      typeof v.hasMore !== "boolean" ||
      !positive(v.nextAfterVersion) ||
      v.nextAfterVersion !== afterVersion + v.items.length ||
      v.hasMore !== v.nextAfterVersion < throughVersion ||
      v.items.some(
        (m, i) =>
          !m ||
          !uuid.test(m.id) ||
          m.worldVersion !== afterVersion + i + 1 ||
          m.worldVersion > throughVersion ||
          !positive(m.personVersion) ||
          m.personVersion < m.worldVersion ||
          m.personVersion > v.person.version ||
          !card(m.fromWorld) ||
          !card(m.toWorld) ||
          m.fromWorld.id === m.toWorld.id ||
          !instant(m.occurredAt) ||
          !instant(m.recordedAt) ||
          Date.parse(m.occurredAt) > Date.parse(m.recordedAt) ||
          (i > 0 && v.items[i - 1].toWorld.id !== m.fromWorld.id),
      ) ||
      new Set(v.items.map((m) => m.id)).size !== v.items.length ||
      (!v.items.length && v.hasMore)
    )
      throw unavailable()
    return v
  }

  async dataRequest(id: string): Promise<DataRequest> {
    const v = (await this.get(
      this.config.identityOrigin,
      "/internal/v1/data-requests/" + identifier(id) + "/context",
    )) as DataRequest
    if (
      !v ||
      v.requestId !== id ||
      !uuid.test(v.accountId) ||
      !["export", "delete_account"].includes(v.kind) ||
      !["interaction_data", "account_data"].includes(v.scope) ||
      !["accepted", "processing", "completed", "failed"].includes(v.status) ||
      !["active", "restricted", "deletion_pending", "deleted"].includes(
        v.accountStatus,
      ) ||
      !positive(v.accountAccessVersion)
    )
      throw unavailable()
    return v
  }
}
