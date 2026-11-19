import {unavailable,uuid} from './contracts.js'

export type ReferralPending={id:string;campaign:'first-memory-v1';inviterAccountId:string;inviteeAccountId:string;registeredAt:string}
export type ReferralQualification={eventId:string;confirmedAt:string;confirmedSeq:string;origin:'manual'|'ai_candidate'}
export type ReferralReceipt={receiptId:string;referralId:string;qualifiedAt:string}
export type ReferralAcknowledgement={id:string;state:'rewarded';qualifiedAt:string;rewardedAt:string;receiptId:string}
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k))
const id=(v:unknown):v is string=>typeof v==='string'&&uuid.test(v)
const instant=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v)&&Number.isFinite(Date.parse(v))
export function referralPending(value:unknown):ReferralPending{
 if(!exact(value,['id','campaign','inviterAccountId','inviteeAccountId','registeredAt'])||!id(value.id)||value.campaign!=='first-memory-v1'||!id(value.inviterAccountId)||!id(value.inviteeAccountId)||value.inviterAccountId.toLowerCase()===value.inviteeAccountId.toLowerCase()||!instant(value.registeredAt))throw unavailable()
 return{id:value.id.toLowerCase(),campaign:'first-memory-v1',inviterAccountId:value.inviterAccountId.toLowerCase(),inviteeAccountId:value.inviteeAccountId.toLowerCase(),registeredAt:new Date(value.registeredAt).toISOString()}
}
export function referralQualification(value:unknown,accountId:string):ReferralQualification|null{
 if(!exact(value,['accountId','qualification'])||value.accountId!==accountId)throw unavailable()
 if(value.qualification===null)return null
 const q=value.qualification
 if(!exact(q,['eventId','confirmedAt','confirmedSeq','origin'])||!id(q.eventId)||!instant(q.confirmedAt)||typeof q.confirmedSeq!=='string'||!(/^[1-9][0-9]{0,18}$/).test(q.confirmedSeq)||BigInt(q.confirmedSeq)>9223372036854775807n||!['manual','ai_candidate'].includes(String(q.origin)))throw unavailable()
 return{eventId:q.eventId.toLowerCase(),confirmedAt:new Date(q.confirmedAt).toISOString(),confirmedSeq:q.confirmedSeq,origin:q.origin as ReferralQualification['origin']}
}
export function referralAcknowledgement(value:unknown,receipt:ReferralReceipt):ReferralAcknowledgement{
 if(!exact(value,['id','state','qualifiedAt','rewardedAt','receiptId'])||value.id!==receipt.referralId||value.state!=='rewarded'||value.receiptId!==receipt.receiptId||!instant(value.qualifiedAt)||Date.parse(value.qualifiedAt)!==Date.parse(receipt.qualifiedAt)||!instant(value.rewardedAt)||Date.parse(value.rewardedAt)<Date.parse(receipt.qualifiedAt))throw unavailable()
 return value as ReferralAcknowledgement
}
