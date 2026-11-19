import {createHash,randomUUID} from 'node:crypto'
import type {Pool} from 'pg'
import {ConversationError,invalid,notFound,uuid,dependencyUnavailable,type Message} from './contracts.js'
import type {ContextProvider} from './dependencies.js'
import type {ConversationStore} from './store.js'

export type GiftDelivery={id:string;accountId:string;personId:string;conversationId:string;version:number;giftSnapshot:Record<string,unknown>;personSnapshot:Record<string,unknown>;quantity:number;note:string;source:'trial'|'inventory'|'voucher';cost:number;status:'in_transit'|'arrived'|'delivery_failed';createdAt:string;scheduledArrivalAt:string;arrivedAt:string|null;failedAt:string|null;debitTransactionId:string|null;reversalTransactionId:string|null;failureCode?:null|'TARGET_UNAVAILABLE'|'AUTHORIZATION_CHANGED'}
export type ReceivedGift={id:string;accountId:string;personId:string;conversationId:string;sourceDeliveryId:string;version:number;giftSnapshot:Record<string,unknown>;personSnapshot:Record<string,unknown>;quantity:1;note:string;createdAt:string;openedAt:string|null;placement:null|'record'|'space';displayable:boolean;origin:{kind:'persona_return';contentOrigin:'ai_generated';policyVersion:'person-gift-returns-v1';generationJobId:string}}
const instant=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))
const positive=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>0&&Number(v)<=2147483647
const canonical=(v:any):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v)
export function deliveryInput(body:unknown):GiftDelivery{
 if(!body||typeof body!=='object'||Array.isArray(body))throw invalid()
 const x=body as GiftDelivery
 const allowed=['id','accountId','personId','conversationId','version','giftSnapshot','personSnapshot','quantity','note','source','cost','status','createdAt','scheduledArrivalAt','arrivedAt','failedAt','debitTransactionId','reversalTransactionId','failureCode']
 if(Object.keys(x).some(k=>!allowed.includes(k))||(x.failureCode!==undefined&&x.failureCode!==null&&!['TARGET_UNAVAILABLE','AUTHORIZATION_CHANGED'].includes(x.failureCode))||[x.id,x.accountId,x.personId,x.conversationId].some(v=>typeof v!=='string'||!uuid.test(v))||!positive(x.version)||!positive(x.quantity)||x.quantity>99||typeof x.note!=='string'||[...x.note].length>120||x.note.includes('\0')||/\p{Surrogate}/u.test(x.note)||!['trial','inventory','voucher'].includes(x.source)||!Number.isSafeInteger(x.cost)||x.cost<0||!['in_transit','arrived','delivery_failed'].includes(x.status)||!instant(x.createdAt)||!instant(x.scheduledArrivalAt)||[x.arrivedAt,x.failedAt].some(v=>v!==null&&!instant(v))||[x.debitTransactionId,x.reversalTransactionId].some(v=>v!==null&&(typeof v!=='string'||!uuid.test(v)))||!x.giftSnapshot||typeof x.giftSnapshot!=='object'||Array.isArray(x.giftSnapshot)||!x.personSnapshot||typeof x.personSnapshot!=='object'||Array.isArray(x.personSnapshot)||x.personSnapshot.id!==x.personId||typeof x.personSnapshot.displayName!=='string'||!positive(x.personSnapshot.version)||!positive(x.personSnapshot.accessVersion)||!positive(x.personSnapshot.worldVersion)||x.personSnapshot.audience!=='person'||JSON.stringify(x).length>16000||(x.status==='arrived')!==(x.arrivedAt!==null)||(x.status==='delivery_failed')!==(x.failedAt!==null))throw invalid()
 return x
}
export function receivedInput(body:unknown):ReceivedGift{
 if(!body||typeof body!=='object'||Array.isArray(body))throw invalid()
 const x=body as ReceivedGift,allowed=['id','accountId','personId','conversationId','sourceDeliveryId','version','giftSnapshot','personSnapshot','quantity','note','createdAt','openedAt','placement','displayable','origin']
 if(Object.keys(x).some(k=>!allowed.includes(k))||[x.id,x.accountId,x.personId,x.conversationId,x.sourceDeliveryId].some(v=>typeof v!=='string'||!uuid.test(v))||!positive(x.version)||x.quantity!==1||typeof x.note!=='string'||[...x.note].length>120||x.note.includes('\0')||/\p{Surrogate}/u.test(x.note)||!instant(x.createdAt)||x.openedAt!==null&&!instant(x.openedAt)||!['record','space',null].includes(x.placement)||(x.openedAt===null)!==(x.placement===null)||typeof x.displayable!=='boolean'||x.placement==='space'&&!x.displayable||!x.giftSnapshot||typeof x.giftSnapshot!=='object'||Array.isArray(x.giftSnapshot)||!x.personSnapshot||typeof x.personSnapshot!=='object'||Array.isArray(x.personSnapshot)||x.personSnapshot.id!==x.personId||typeof x.personSnapshot.displayName!=='string'||typeof x.personSnapshot.worldId!=='string'||!uuid.test(x.personSnapshot.worldId)||!positive(x.personSnapshot.version)||!positive(x.personSnapshot.worldVersion)||!positive(x.personSnapshot.accessVersion)||x.personSnapshot.audience!=='person'||!x.origin||typeof x.origin!=='object'||Array.isArray(x.origin)||Object.keys(x.origin).length!==4||x.origin.kind!=='persona_return'||x.origin.contentOrigin!=='ai_generated'||x.origin.policyVersion!=='person-gift-returns-v1'||typeof x.origin.generationJobId!=='string'||!uuid.test(x.origin.generationJobId)||JSON.stringify(x).length>16000)throw invalid()
 return x
}
export async function receivedAuthority(dependencies:ContextProvider,accountId:string,id:string){
 const before=await dependencies.account(accountId)
 const allowed=(a:typeof before)=>a.giftStorage?.allowed&&positive(a.giftStorage.authorizationVersion)&&a.giftReturns?.allowed&&positive(a.giftReturns.authorizationVersion)&&a.storyStorage.allowed&&positive(a.storyStorage.authorizationVersion)
 if(!allowed(before))throw new ConversationError(403,'GIFT_RETURN_PERMISSION_REQUIRED','Permission for person gift returns is required.')
 if(!dependencies.receivedGift)throw dependencyUnavailable()
 const data=await dependencies.receivedGift(accountId,id),person=await dependencies.person(accountId,data.personId),after=await dependencies.account(accountId)
 if(data.accountId!==accountId||data.id!==id||person.id!==data.personId)throw notFound()
 if(!allowed(after)||after.accessVersion!==before.accessVersion||after.giftStorage!.authorizationVersion!==before.giftStorage!.authorizationVersion||after.giftReturns!.authorizationVersion!==before.giftReturns!.authorizationVersion||after.storyStorage.authorizationVersion!==before.storyStorage.authorizationVersion)throw new ConversationError(403,'GIFT_RETURN_PERMISSION_REQUIRED','The gift return permission changed.')
 return data
}
export async function giftAuthority(dependencies:ContextProvider,accountId:string,deliveryId:string){
 const before=await dependencies.account(accountId)
 if(!before.giftStorage?.allowed||!positive(before.giftStorage.authorizationVersion))throw new ConversationError(403,'GIFT_PERMISSION_REQUIRED','Permission for virtual gifts is required.')
 if(!dependencies.gift)throw dependencyUnavailable()
 const data=await dependencies.gift(accountId,deliveryId),person=await dependencies.person(accountId,data.personId),after=await dependencies.account(accountId)
 if(data.accountId!==accountId||data.id!==deliveryId||person.id!==data.personId)throw notFound()
 if(!after.giftStorage?.allowed||after.accessVersion!==before.accessVersion||after.giftStorage.authorizationVersion!==before.giftStorage.authorizationVersion)throw new ConversationError(403,'GIFT_PERMISSION_REQUIRED','The gift permission changed.')
 return data
}
export async function giftMessage(dependencies:ContextProvider,row:any):Promise<Message>{
 if(row.gift_received_id){
  const data=await receivedAuthority(dependencies,row.account_id,row.gift_received_id)
  if(data.conversationId!==row.conversation_id||data.personId!==row.speaker_person_id||data.version<row.gift_projection.version)throw dependencyUnavailable()
  return {id:row.id,conversationId:row.conversation_id,sequence:row.sequence,kind:'gift',text:'',author:{kind:'persona',personId:data.personId,displayName:String(data.personSnapshot.displayName),aiGenerated:true},gift:{...data,direction:'received',receivedGiftId:data.id},createdAt:row.created_at.toISOString(),version:row.version,canSuggestMemory:false}
 }
 const data=await giftAuthority(dependencies,row.account_id,row.gift_delivery_id)
 if(data.conversationId!==row.conversation_id||data.version<row.gift_projection.version)throw dependencyUnavailable()
 return {id:row.id,conversationId:row.conversation_id,sequence:row.sequence,kind:'gift',text:'',author:{kind:'self'},gift:{...data,deliveryId:data.id},createdAt:row.created_at.toISOString(),version:row.version,canSuggestMemory:false}
}

export class GiftProjectionStore{
 constructor(readonly pool:Pool,readonly dependencies:ContextProvider,readonly conversations:ConversationStore){}
 async ensure(accountId:string,personId:string){
  const before=await this.dependencies.account(accountId)
  if(!before.giftStorage?.allowed||!positive(before.giftStorage.authorizationVersion))throw new ConversationError(403,'GIFT_PERMISSION_REQUIRED','Permission for virtual gifts is required.')
  const raw=createHash('sha256').update('gift-direct:'+accountId+':'+personId).digest('hex'),key=raw.slice(0,8)+'-'+raw.slice(8,12)+'-4'+raw.slice(13,16)+'-8'+raw.slice(17,20)+'-'+raw.slice(20,32)
  const value=await this.conversations.ensure(accountId,personId,key)
  const after=await this.dependencies.account(accountId)
  if(!after.giftStorage?.allowed||after.accessVersion!==before.accessVersion||after.giftStorage.authorizationVersion!==before.giftStorage.authorizationVersion)throw new ConversationError(403,'GIFT_PERMISSION_REQUIRED','The gift permission changed.')
  return {id:value.conversation.id,personId:value.conversation.personId}
 }
 async project(id:string,input:unknown){
  const submitted=deliveryInput(input)
  if(id!==submitted.id)throw invalid()
  const source=await giftAuthority(this.dependencies,submitted.accountId,id)
  return this.projectSource(id,submitted,source,false)
 }
 async projectReceived(id:string,input:unknown){
  const submitted=receivedInput(input)
  if(id!==submitted.id)throw invalid()
  const source=await receivedAuthority(this.dependencies,submitted.accountId,id)
  return this.projectSource(id,submitted,source,true)
 }
 private async projectSource(id:string,submitted:GiftDelivery|ReceivedGift,source:GiftDelivery|ReceivedGift,received:boolean){
  // A delayed event must not overwrite a newer authoritative source.
  if(canonical(source)!==canonical(submitted))throw new ConversationError(409,'SOURCE_CHANGED','The gift delivery changed; retry its current version.')
  const current=await this.conversations.visible(source.accountId,source.conversationId)
  if(current.person.id!==source.personId)throw notFound()
  const db=await this.pool.connect()
  try{
   await db.query('BEGIN')
   await db.query("SELECT pg_advisory_xact_lock(hashtextextended('xijie:conversations:erasure:' || $1,0))",[source.accountId])
   await db.query('INSERT INTO account_erasure_fences(account_id) VALUES($1) ON CONFLICT DO NOTHING',[source.accountId])
   if((await db.query('SELECT 1 FROM account_erasure_fences WHERE account_id=$1 AND erased_at IS NOT NULL',[source.accountId])).rowCount)throw notFound()
   const conversation=(await db.query('SELECT id FROM conversations WHERE account_id=$1 AND id=$2 AND person_id=$3 FOR UPDATE',[source.accountId,source.conversationId,source.personId])).rows[0]
   if(!conversation)throw notFound()
   let row=(await db.query(`SELECT * FROM messages WHERE account_id=$1 AND ${received?'gift_received_id':'gift_delivery_id'}=$2 AND kind='gift' FOR UPDATE`,[source.accountId,id])).rows[0]
   if(row){
    if(row.conversation_id!==source.conversationId)throw notFound()
    if(row.removed_at){await db.query('COMMIT');return {id:row.id,version:row.version,removed:true}}
    if(row.gift_projection.version>source.version)throw new ConversationError(409,'SOURCE_CHANGED','A newer gift is already projected.')
    if(row.gift_projection.version===source.version){if(canonical(row.gift_projection)!==canonical(source))throw new ConversationError(409,'SOURCE_CHANGED','The gift source version is inconsistent.')}
    else row=(await db.query('UPDATE messages SET gift_projection=$3,version=version+1 WHERE account_id=$1 AND id=$2 RETURNING *',[source.accountId,row.id,source])).rows[0]
   }else{
    const sequence=(await db.query('UPDATE conversations SET last_sequence=last_sequence+1,version=version+1,updated_at=GREATEST(updated_at,clock_timestamp()::timestamptz(3)) WHERE account_id=$1 AND id=$2 RETURNING last_sequence',[source.accountId,source.conversationId])).rows[0].last_sequence
    row=received?(await db.query("INSERT INTO messages(account_id,conversation_id,sequence,kind,author_kind,text,gift_received_id,gift_projection,created_at,speaker_person_id,display_name) VALUES($1,$2,$3,'gift','persona','',$4,$5,$6,$7,$8) RETURNING *",[source.accountId,source.conversationId,sequence,id,source,source.createdAt,source.personId,source.personSnapshot.displayName])).rows[0]:(await db.query("INSERT INTO messages(account_id,conversation_id,sequence,kind,author_kind,text,gift_delivery_id,gift_projection,created_at) VALUES($1,$2,$3,'gift','self','',$4,$5,$6) RETURNING *",[source.accountId,source.conversationId,sequence,id,source,source.createdAt])).rows[0]
   }
   await db.query("INSERT INTO outbox_events(type,account_id,aggregate_type,aggregate_id,aggregate_version,request_id,payload) VALUES('GiftMessageChanged.v1',$1,'message',$2,$3,$4,$5) ON CONFLICT(type,aggregate_id,aggregate_version) DO NOTHING",[source.accountId,row.id,row.version,randomUUID(),{conversationId:source.conversationId,messageId:row.id,...(received?{receivedGiftId:id,receivedGiftVersion:source.version}:{deliveryId:id,deliveryVersion:source.version})}])
   await db.query('COMMIT');return {id:row.id,version:row.version}
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
 }
}
