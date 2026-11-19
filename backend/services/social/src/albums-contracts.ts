import {object,text,identifier,invalid} from './contracts.js'
export type AlbumSource={albumId:string;contributionId:string;accountId:string;personId:string;version:number;title:string;body:string;allowAdoption:true}
export type AlbumMemoryReceipt={albumId:string;contributionId:string;memoryId:string;version:number;status:'fulfilled'|'revoked'}
export type AlbumReward={receiptId:string;albumId:string;accountId:string;assetType:'voucher';assetId:'return-stamp';units:1;grantedAt:string}
export interface AlbumDependencies{
 adoptAlbum(accountId:string,albumId:string,contributionId:string,sourceVersion:number):Promise<AlbumMemoryReceipt>
 revokeAlbumSource(accountId:string,albumId:string,contributionId:string):Promise<void>
 albumReward(accountId:string,albumId:string):Promise<AlbumReward|null>
 rewardAlbum(accountId:string,albumId:string):Promise<AlbumReward>
}
export type GoalKind='album'|'home'|'flight'
export function albumInput(value:unknown){const x=object(value,['personId','title','message','kind']);if(x.kind!==undefined&&!['album','home','flight'].includes(String(x.kind)))throw invalid();return {personId:identifier(x.personId),title:text(x.title,40),message:text(x.message,500),...(x.kind===undefined?{}:{kind:x.kind as GoalKind})}}
export function ownerReviewInput(value:unknown){const x=object(value,['decision']);if(!['approve','reject'].includes(String(x.decision)))throw invalid();return{decision:x.decision as 'approve'|'reject'}}
export function contributionInput(value:unknown){const x=object(value,['text','allowAdoption']);if(x.allowAdoption!==true)throw invalid();return {text:text(x.text,500),allowAdoption:true as const}}
export function emptyAlbumBody(value:unknown){object(value,[])}
