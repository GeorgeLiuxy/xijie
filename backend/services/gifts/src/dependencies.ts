import { parse, serialize } from 'cookie';
import type { GiftsConfig } from './config.js';
import {referralPending,referralQualification,referralAcknowledgement,type ReferralPending,type ReferralQualification,type ReferralReceipt,type ReferralAcknowledgement} from './referral-contracts.js';
import { GiftsError, missing, unavailable, identifier, uuid, type Account, type Session, type PersonSnapshot, type Delivery, type DataRequest, type ReturnContext, type ReceivedGift, type PhotoBinding } from './contracts.js';
export interface ContextProvider {
    account(id: string): Promise<Account>;
    session(cookie: string, expected?: string): Promise<Session>;
    person(accountId: string, id: string): Promise<PersonSnapshot>;
    ensure(accountId: string, personId: string): Promise<{
        id: string;
        personId: string;
    }>;
    project(accountId: string, d: Delivery): Promise<void>;
    returnContext(accountId:string,personId:string,returnVersion:number,storyVersion:number):Promise<ReturnContext>;
    projectReceived(accountId:string,gift:ReceivedGift):Promise<void>;
    bindPhoto?(accountId:string,deliveryId:string,mediaId:string,photoVersion:number):Promise<PhotoBinding>;
    dataRequest(id: string): Promise<DataRequest>;
    pendingReferrals?(after?:string):Promise<{items:ReferralPending[];nextCursor:string|null}>;
    referralQualification?(accountId:string):Promise<ReferralQualification|null>;
    acknowledgeReferral?(receipt:ReferralReceipt):Promise<ReferralAcknowledgement>;
}
export class Dependencies implements ContextProvider {
    constructor(readonly config: GiftsConfig, readonly fetcher: typeof fetch = fetch) { }
    private async request(origin: string, path: string, body?: unknown, method?: string, headers: Record<string, string> = {}, envelope=false) { let response: Response; try {
        response = await this.fetcher(new URL(path, origin), { method: method ?? (body === undefined ? 'GET' : 'POST'), signal: AbortSignal.timeout(5000), redirect: 'error', headers: { Authorization: 'Bearer ' + this.config.serviceToken, ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    }
    catch {
        throw unavailable();
    } if (response.status === 404)
        throw missing(); if (response.status === 401)
        throw new GiftsError(401, 'UNAUTHORIZED'); if (response.status === 403)
        throw new GiftsError(403, 'FORBIDDEN'); if (!response.ok)
        throw unavailable(); const value = await response.json().catch(() => null); if (!value || value.data === undefined)
        throw unavailable(); return envelope?value:value.data; }
    async pendingReferrals(after?:string):Promise<{items:ReferralPending[];nextCursor:string|null}>{
        const v=await this.request(this.config.identityOrigin,'/internal/v1/referrals/pending?limit=20'+(after?'&after='+identifier(after):''),undefined,undefined,{},true);
        if(!Array.isArray(v?.data)||v.data.length>20||!v.meta||!(v.meta.nextCursor===null||typeof v.meta.nextCursor==='string'&&uuid.test(v.meta.nextCursor)))throw unavailable();
        const items:ReferralPending[]=v.data.map(referralPending),nextCursor=v.meta.nextCursor?.toLowerCase()??null;
        if(items.some((p,i)=>i?p.id<=items[i-1].id:after!==undefined&&p.id<=after)||nextCursor!==null&&nextCursor!==items.at(-1)?.id)throw unavailable();
        return{items,nextCursor};
    }
    async referralQualification(accountId:string):Promise<ReferralQualification|null>{
        if(!this.config.memoriesOrigin)throw unavailable();
        return referralQualification(await this.request(this.config.memoriesOrigin,'/internal/v1/referrals/accounts/'+identifier(accountId)+'/qualification'),accountId);
    }
    async acknowledgeReferral(receipt:ReferralReceipt):Promise<ReferralAcknowledgement>{
        return referralAcknowledgement(await this.request(this.config.identityOrigin,'/internal/v1/referrals/'+identifier(receipt.referralId)+'/rewarded',{receiptId:identifier(receipt.receiptId),qualifiedAt:receipt.qualifiedAt}),receipt);
    }
    async session(cookie: string, expected?: string): Promise<Session> { const token = parse(cookie)[this.config.sessionCookie]; if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
        throw new GiftsError(401, 'UNAUTHORIZED'); const v = await this.request(this.config.identityOrigin, '/internal/v1/session-context', undefined, undefined, { Cookie: serialize(this.config.sessionCookie, token) }); if (!uuid.test(v?.accountId) || !uuid.test(v?.sessionId) || !Number.isFinite(Date.parse(v.expiresAt)))
        throw unavailable(); if (expected !== undefined && expected !== v.sessionId || Date.parse(v.expiresAt) <= Date.now())
        throw new GiftsError(401, 'UNAUTHORIZED'); return v; }
    async account(id: string): Promise<Account> { const v = await this.request(this.config.identityOrigin, '/internal/v1/accounts/' + identifier(id) + '/context'); if (v?.accountId !== id || v.status !== 'active' || !Number.isSafeInteger(v.accessVersion) || v.accessVersion < 1)
        throw missing(); return v; }
    async person(accountId: string, id: string): Promise<PersonSnapshot> { const v = await this.request(this.config.peopleOrigin, '/internal/v1/gifts/persons/' + identifier(id) + '?accountId=' + identifier(accountId)); if (v?.id !== id || v.accountId !== accountId || v.status !== 'active' || v.audience !== 'person' || typeof v.displayName !== 'string' || !uuid.test(v.worldId) || ['version', 'worldVersion', 'accessVersion'].some(k => !Number.isSafeInteger(v[k]) || v[k] < 1))
        throw unavailable(); return v; }
    async ensure(accountId: string, personId: string) { const v = await this.request(this.config.conversationsOrigin, '/internal/v1/gifts/conversations/ensure', { accountId, personId }); if (!uuid.test(v?.id) || v.personId !== personId)
        throw unavailable(); return { id: v.id, personId: v.personId }; }
    async project(accountId: string, d: Delivery) { await this.request(this.config.conversationsOrigin, '/internal/v1/gifts/deliveries/' + d.id, { accountId, ...d }, 'PUT'); }
    async projectReceived(accountId:string,gift:ReceivedGift){await this.request(this.config.conversationsOrigin,'/internal/v1/gifts/received/'+gift.id,{accountId,...gift},'PUT');}
    async bindPhoto(accountId:string,deliveryId:string,mediaId:string,photoVersion:number):Promise<PhotoBinding>{
        if(!this.config.mediaOrigin||!this.config.mediaToken)throw unavailable();
        let response:Response;
        try{response=await this.fetcher(new URL('/internal/v1/gifts/deliveries/'+identifier(deliveryId)+'/media-bindings',this.config.mediaOrigin),{
            method:'POST',signal:AbortSignal.timeout(5000),redirect:'error',headers:{Authorization:'Bearer '+this.config.serviceToken,'Content-Type':'application/json','X-Xijie-Account-Id':identifier(accountId)},body:JSON.stringify({mediaId:identifier(mediaId),photoVersion})});}
        catch{throw unavailable();}
        const body=await response.json().catch(()=>null);
        if(!response.ok){
            const code=body?.error?.code;
            if(response.status===404)throw new GiftsError(422,'PHOTO_SELECTION_INVALID');
            if([403,409,412,422].includes(response.status)&&['GIFT_STORAGE_PERMISSION_REQUIRED','GIFT_PHOTO_PERMISSION_REQUIRED','AUTHORIZATION_CHANGED','PHOTO_SELECTION_INVALID','VERSION_CONFLICT','DELIVERY_NOT_ARRIVED','MEDIA_BINDING_EXPIRED'].includes(code))throw new GiftsError(response.status,code);
            throw unavailable();
        }
        const v=body?.data,m=v?.media;
        if(v?.deliveryId!==deliveryId||v?.photoVersion!==photoVersion||m?.id!==mediaId||m?.mimeType!=='image/webp'||['version','byteSize','width','height'].some(k=>!Number.isSafeInteger(m?.[k])||m[k]<1||m[k]>2147483647)||typeof v?.expiresAt!=='string'||!Number.isFinite(Date.parse(v.expiresAt))||Date.parse(v.expiresAt)>Date.now()+90000)throw unavailable();
        return {deliveryId,photoVersion,media:{id:mediaId,version:m.version,mimeType:'image/webp',byteSize:m.byteSize,width:m.width,height:m.height},expiresAt:v.expiresAt};
    }
    async returnContext(accountId:string,personId:string,returnVersion:number,storyVersion:number):Promise<ReturnContext>{
        const v=await this.request(this.config.peopleOrigin,'/internal/v1/gifts/persons/'+identifier(personId)+'/return-context?accountId='+identifier(accountId)+'&expectedReturnAuthorizationVersion='+returnVersion+'&expectedStoryAuthorizationVersion='+storyVersion),p=v?.person;
        if(!p||p.id!==personId||p.accountId!==accountId||p.status!=='active'||p.audience!=='person'||!uuid.test(p.worldId)||['version','worldVersion','accessVersion'].some(k=>!Number.isSafeInteger(p[k])||p[k]<1)||['displayName','relationship','story'].some(k=>typeof p[k]!=='string')||p.calledMe!==undefined&&typeof p.calledMe!=='string'||!Number.isSafeInteger(v.accountAccessVersion)||v.accountAccessVersion<1||v.returnAuthorizationVersion!==returnVersion||v.storyAuthorizationVersion!==storyVersion)throw unavailable();
        return v;
    }
    async dataRequest(id: string): Promise<DataRequest> { const v = await this.request(this.config.identityOrigin, '/internal/v1/data-requests/' + identifier(id) + '/context'); if (v?.requestId !== id || !uuid.test(v.accountId) || !Number.isSafeInteger(v.accountAccessVersion) || v.accountAccessVersion < 1||!['accepted','processing','failed','completed'].includes(v.status))
        throw unavailable(); return v; }
}
