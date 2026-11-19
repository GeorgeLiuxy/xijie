import { parse, serialize } from "cookie"

import { type MediaConfig } from "./config.js"
import type {VoiceRef,VoiceBindingState} from './voice-store.js'

import {
  uuid,
  identifier,
  positive,
  unavailable,
  missing,
  unauthorized,
  MediaError,
  type Account,
  type Session,
  type Ref,
  type PersonRef,
  type GiftRef,
  type GiftTarget,
  type ConversationRef,type ConversationTarget,type PhotoReplySource,
  type DataRequest,
} from "./contracts.js"

export interface ContextProvider {
  session(cookie: string, expected?: string): Promise<Session>

  account(id: string): Promise<Account>

  validPosts(accountId: string, refs: Ref[]): Promise<Ref[]>

  personTarget(accountId: string, draftId: string): Promise<void>

  validPersonPhotos(accountId: string, refs: PersonRef[]): Promise<PersonRef[]>
  validPersonVoices(accountId:string,refs:VoiceRef[]):Promise<VoiceRef[]>
  personVoiceBinding(accountId:string,draftId:string):Promise<VoiceBindingState>
  giftTarget(accountId:string,deliveryId:string):Promise<GiftTarget>
  validGiftPhotos(accountId:string,refs:GiftRef[]):Promise<GiftRef[]>
  conversationTarget(accountId:string,conversationId:string):Promise<ConversationTarget>
  validConversationPhotos(accountId:string,refs:ConversationRef[]):Promise<ConversationRef[]>
  photoReplySource(accountId:string,jobId:string,attemptId:string):Promise<PhotoReplySource>

  dataRequest(id: string): Promise<DataRequest>
}

const permission = (v: any) =>
  v &&
  typeof v.allowed === "boolean" &&
  Number.isSafeInteger(v.authorizationVersion) &&
  v.authorizationVersion >= 0 &&
  (!v.allowed || v.authorizationVersion > 0)

export class Dependencies implements ContextProvider {
  constructor(
    readonly config: MediaConfig,

    readonly fetcher: typeof fetch = fetch,
  ) {}

  private async request(
    origin: string,

    path: string,

    headers: Record<string, string> = {},

    body?: unknown,
    deliveryTarget = false,
    photoSource=false,
  ) {
    let response: Response

    try {
      response = await this.fetcher(new URL(path, origin), {
        method: body === undefined ? "GET" : "POST",

        redirect: "error",

        signal: AbortSignal.timeout(5000),

        headers: {
          Authorization: "Bearer " + this.config.serviceToken,

          ...headers,

          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },

        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch {
      throw unavailable()
    }

    if (response.status === 404) throw missing()

    if (response.status === 401) throw unauthorized()
    if(photoSource&&[403,409].includes(response.status))throw new MediaError(response.status,response.status===403?'CHAT_IMAGE_REPLY_PERMISSION_REQUIRED':'AUTHORIZATION_CHANGED')

    if(deliveryTarget&&response.status===409){
      const error=await response.json().catch(()=>null)
      if(error?.error?.code==='DELIVERY_NOT_ARRIVED')throw new MediaError(409,'DELIVERY_NOT_ARRIVED')
      throw unavailable()
    }

    if (!response.ok) throw unavailable()

    const v = await response.json().catch(() => null)

    if (v?.data === undefined) throw unavailable()

    return v.data
  }

  async session(cookie: string, expected?: string): Promise<Session> {
    const token = parse(cookie)[this.config.sessionCookie]

    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw unauthorized()

    const v = await this.request(
      this.config.identityOrigin,

      "/internal/v1/session-context",

      { Cookie: serialize(this.config.sessionCookie, token) },
    )

    if (
      !v ||
      !uuid.test(v.accountId) ||
      !uuid.test(v.sessionId) ||
      !permission(v.storyStorage) ||
      (v.photoStorage !== undefined && !permission(v.photoStorage)) ||
      (v.personPhotoStorage !== undefined &&
        !permission(v.personPhotoStorage)) ||
      (v.personVoiceStorage!==undefined&&!permission(v.personVoiceStorage)) ||
      (v.giftStorage!==undefined&&!permission(v.giftStorage)) ||
      (v.giftPhotoStorage!==undefined&&!permission(v.giftPhotoStorage)) ||
      (v.chatPhotoStorage!==undefined&&!permission(v.chatPhotoStorage)) ||
      (v.chatImageReplies!==undefined&&!permission(v.chatImageReplies)) ||
      !Number.isFinite(Date.parse(v.expiresAt))
    )
      throw unavailable()

    if (
      Date.parse(v.expiresAt) <= Date.now() ||
      (expected !== undefined && v.sessionId !== expected)
    )
      throw unauthorized()

    return v
  }

  async account(id: string): Promise<Account> {
    const v = await this.request(
      this.config.identityOrigin,

      "/internal/v1/accounts/" + identifier(id) + "/context",
    )

    if (
      !v ||
      v.accountId !== id ||
      v.status !== "active" ||
      !positive(v.accessVersion) ||
      !permission(v.storyStorage) ||
      (v.photoStorage !== undefined && !permission(v.photoStorage)) ||
      (v.personPhotoStorage !== undefined && !permission(v.personPhotoStorage)) ||
      (v.personVoiceStorage !== undefined && !permission(v.personVoiceStorage)) ||
      (v.giftStorage!==undefined&&!permission(v.giftStorage)) ||
      (v.giftPhotoStorage!==undefined&&!permission(v.giftPhotoStorage)) ||
      (v.chatPhotoStorage!==undefined&&!permission(v.chatPhotoStorage)) ||
      (v.chatImageReplies!==undefined&&!permission(v.chatImageReplies))
    )
      throw unavailable()

    return v
  }

  async validPosts(accountId: string, refs: Ref[]): Promise<Ref[]> {
    if (!refs.length) return []

    if (
      refs.length > 100 ||
      refs.some(
        (r) =>
          !uuid.test(r.postId) || !uuid.test(r.mediaId) || !positive(r.version),
      )
    )
      throw unavailable()

    const v = await this.request(
      this.config.socialOrigin,

      "/internal/v1/media/posts/validate",

      { "X-Xijie-Account-Id": identifier(accountId) },

      { refs },
    )

    if (
      !v ||
      !Array.isArray(v.valid) ||
      v.valid.length > refs.length ||
      v.valid.some(
        (r: Ref) =>
          !refs.some(
            (x) =>
              x.postId === r.postId &&
              x.mediaId === r.mediaId &&
              x.version === r.version,
          ),
      ) ||
      new Set(v.valid.map((r: Ref) => r.postId + ":" + r.mediaId)).size !==
        v.valid.length
    )
      throw unavailable()

    return v.valid
  }

  async personTarget(accountId: string, draftId: string) {
    if (!this.config.peopleOrigin) throw unavailable()

    const v = await this.request(
      this.config.peopleOrigin,

      "/internal/v1/media/people/drafts/" + identifier(draftId),

      { "X-Xijie-Account-Id": identifier(accountId) },
    )

    if (v?.id !== draftId) throw unavailable()
  }

  async validPersonPhotos(
    accountId: string,
    refs: PersonRef[],
  ): Promise<PersonRef[]> {
    if (!refs.length) return []

    if (
      !this.config.peopleOrigin ||
      refs.length > 100 ||
      refs.some(
        (r) =>
          !uuid.test(r.draftId) ||
          !uuid.test(r.mediaId) ||
          !positive(r.version),
      )
    )
      throw unavailable()

    const v = await this.request(
      this.config.peopleOrigin,
      "/internal/v1/media/people/validate",

      { "X-Xijie-Account-Id": identifier(accountId) },
      { refs },
    )

    if (
      !v ||
      !Array.isArray(v.valid) ||
      v.valid.length > refs.length ||
      v.valid.some(
        (r: PersonRef) =>
          !refs.some(
            (x) =>
              x.draftId === r.draftId &&
              x.mediaId === r.mediaId &&
              x.version === r.version,
          ),
      ) ||
      new Set(v.valid.map((r: PersonRef) => r.draftId + ":" + r.mediaId))
        .size !== v.valid.length
    )
      throw unavailable()

    return v.valid
  }

  async validPersonVoices(accountId:string,refs:VoiceRef[]):Promise<VoiceRef[]>{
    if(!refs.length)return[]
    if(!this.config.peopleOrigin||refs.length>100||refs.some(r=>!r||!uuid.test(r.draftId)||!uuid.test(r.voiceId)||!positive(r.version)))throw unavailable()
    const v=await this.request(this.config.peopleOrigin,'/internal/v1/media/people/voices/validate',{'X-Xijie-Account-Id':identifier(accountId)},{refs})
    if(!v||!Array.isArray(v.valid)||v.valid.length>refs.length||v.valid.some((r:VoiceRef)=>!r||!refs.some(x=>x.draftId===r.draftId&&x.voiceId===r.voiceId&&x.version===r.version))||new Set(v.valid.map((r:VoiceRef)=>r.draftId+':'+r.voiceId)).size!==v.valid.length)throw unavailable()
    return v.valid
  }
  async personVoiceBinding(accountId:string,draftId:string):Promise<VoiceBindingState>{
    if(!this.config.peopleOrigin)throw unavailable()
    const v=await this.request(this.config.peopleOrigin,'/internal/v1/media/people/drafts/'+identifier(draftId)+'/voice-binding-state',{'X-Xijie-Account-Id':identifier(accountId)})
    if(!v||v.accountId!==accountId||v.draftId!==draftId||!Number.isSafeInteger(v.bindingVersion)||v.bindingVersion<0||v.bindingVersion>2147483647||(v.voiceId===null)!==(v.version===null)||v.voiceId!==null&&(!uuid.test(v.voiceId)||!positive(v.version)||v.bindingVersion<1))throw unavailable()
    return v
  }
  async dataRequest(id: string): Promise<DataRequest> {
    const v = await this.request(
      this.config.identityOrigin,

      "/internal/v1/data-requests/" + identifier(id) + "/context",
    )

    if (
      !v ||
      v.requestId !== id ||
      !uuid.test(v.accountId) ||
      !["export", "delete_account"].includes(v.kind) ||
      !["interaction_data", "account_data"].includes(v.scope) ||
      !positive(v.accountAccessVersion) ||
      typeof v.accountStatus !== "string"
    )
      throw unavailable()

    return v
  }

  async giftTarget(accountId:string,deliveryId:string):Promise<GiftTarget>{
    if(!this.config.giftsOrigin)throw unavailable()
    const v=await this.request(this.config.giftsOrigin,'/internal/v1/media/gifts/deliveries/'+identifier(deliveryId),{'X-Xijie-Account-Id':identifier(accountId)},undefined,true)
    if(v?.deliveryId!==deliveryId||v.accountId!==accountId||v.status!=='arrived'||!positive(v.photoVersion))throw unavailable()
    return v
  }
  async validGiftPhotos(accountId:string,refs:GiftRef[]):Promise<GiftRef[]>{
    if(!refs.length)return[]
    if(!this.config.giftsOrigin||refs.length>100||refs.some(r=>!r||!uuid.test(r.deliveryId)||!uuid.test(r.mediaId)||!positive(r.version)||!positive(r.photoVersion)||r.photoVersion<2))throw unavailable()
    const v=await this.request(this.config.giftsOrigin,'/internal/v1/media/gifts/validate',{'X-Xijie-Account-Id':identifier(accountId)},{refs})
    if(!v||!Array.isArray(v.valid)||v.valid.length>refs.length||v.valid.some((r:GiftRef)=>!r||!refs.some(x=>x.deliveryId===r.deliveryId&&x.photoVersion===r.photoVersion&&x.mediaId===r.mediaId&&x.version===r.version))||new Set(v.valid.map((r:GiftRef)=>r.deliveryId+':'+r.photoVersion+':'+r.mediaId)).size!==v.valid.length)throw unavailable()
    return v.valid
  }
  async conversationTarget(accountId:string,conversationId:string):Promise<ConversationTarget>{
    if(!this.config.conversationsOrigin)throw unavailable()
    const v=await this.request(this.config.conversationsOrigin,'/internal/v1/conversations/'+identifier(conversationId)+'/photo-target',{'X-Xijie-Account-Id':identifier(accountId)})
    if(v?.accountId!==accountId||v.conversationId!==conversationId||!uuid.test(v.personId))throw unavailable()
    return v
  }
  async validConversationPhotos(accountId:string,refs:ConversationRef[]):Promise<ConversationRef[]>{
    if(!refs.length)return[]
    if(!this.config.conversationsOrigin||refs.length>100||refs.some(r=>!r||!uuid.test(r.conversationId)||!uuid.test(r.clientMessageId)||!uuid.test(r.mediaId)||r.messageVersion!==1||!positive(r.version)))throw unavailable()
    const v=await this.request(this.config.conversationsOrigin,'/internal/v1/conversation-media/validate',{'X-Xijie-Account-Id':identifier(accountId)},{refs})
    if(!v||!Array.isArray(v.valid)||v.valid.length!==refs.length||v.valid.some((b:unknown)=>typeof b!=='boolean'))throw unavailable()
    return refs.filter((_,i)=>v.valid[i])
  }
  async photoReplySource(accountId:string,jobId:string,attemptId:string):Promise<PhotoReplySource>{
    if(!this.config.conversationsOrigin)throw unavailable()
    const v=await this.request(this.config.conversationsOrigin,'/internal/v1/photo-reply-jobs/'+identifier(jobId)+'/attempts/'+identifier(attemptId)+'/media-source',{'X-Xijie-Account-Id':identifier(accountId)},undefined,false,true)
    if(!v||!['conversationId','clientMessageId','messageId','mediaId'].every(k=>uuid.test(v[k]))||v.messageVersion!==1||!['version','accountAccessVersion','storyAuthorizationVersion','photoAuthorizationVersion','imageAuthorizationVersion'].every(k=>positive(v[k])))throw unavailable()
    return {conversationId:v.conversationId,clientMessageId:v.clientMessageId,messageId:v.messageId,messageVersion:v.messageVersion,mediaId:v.mediaId,version:v.version,accountAccessVersion:v.accountAccessVersion,storyAuthorizationVersion:v.storyAuthorizationVersion,photoAuthorizationVersion:v.photoAuthorizationVersion,imageAuthorizationVersion:v.imageAuthorizationVersion}
  }
}
