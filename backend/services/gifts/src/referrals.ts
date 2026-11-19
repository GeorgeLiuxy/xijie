import {randomUUID} from 'node:crypto'
import {GiftsError,hash,missing,unavailable} from './contracts.js'
import type {GiftsStore} from './store.js'
import {referralPending,referralQualification,type ReferralPending,type ReferralQualification,type ReferralReceipt} from './referral-contracts.js'

type AwardRow={id:string;referral_id:string;campaign:string;inviter_account_id:string;invitee_account_id:string;registered_at:Date;qualified_at:Date;request_hash:string}
const receipt=(row:AwardRow):ReferralReceipt=>({receiptId:row.id,referralId:row.referral_id,qualifiedAt:row.qualified_at.toISOString()})
function sameSource(row:AwardRow,p:ReferralPending){
 if(row.referral_id!==p.id||row.campaign!==p.campaign||row.inviter_account_id!==p.inviterAccountId||row.invitee_account_id!==p.inviteeAccountId||row.registered_at.toISOString()!==p.registeredAt)throw new GiftsError(409,'REFERRAL_SOURCE_CHANGED')
}
export class ReferralRewardsStore{
 constructor(readonly gifts:GiftsStore){}
 async active(p:ReferralPending){
  // No storage/AI grant is created or required to record already earned rights.
  const ids=[p.inviterAccountId,p.inviteeAccountId].sort(),values=await Promise.all(ids.map(id=>this.gifts.dependencies.account(id)))
  if(values.some((a,i)=>a.accountId!==ids[i]||a.status!=='active'||!Number.isSafeInteger(a.accessVersion)||a.accessVersion<1))throw missing()
  return new Map(values.map(a=>[a.accountId,a.accessVersion]))
 }
 async existing(input:ReferralPending):Promise<ReferralReceipt|undefined>{
  const p=referralPending(input),r=(await this.gifts.pool.query<AwardRow>(`SELECT a.* FROM referral_reward_awards a
   JOIN gifts_account_write_gates h ON h.account_id=a.inviter_account_id AND h.erased_at IS NULL
   JOIN gifts_account_write_gates g ON g.account_id=a.invitee_account_id AND g.erased_at IS NULL WHERE a.referral_id=$1`,[p.id])).rows[0]
  if(!r)return
  sameSource(r,p);return receipt(r)
 }
 async award(input:ReferralPending,qualification:ReferralQualification):Promise<ReferralReceipt>{
  const p=referralPending(input),q=referralQualification({accountId:p.inviteeAccountId,qualification},p.inviteeAccountId)!
  if(!q||Date.parse(q.confirmedAt)<Date.parse(p.registeredAt))throw new GiftsError(409,'REFERRAL_NOT_QUALIFIED')
  const fingerprint=hash(JSON.stringify({referral:p,qualification:q})),versions=await this.active(p),db=await this.gifts.pool.connect()
  try{
   await db.query('BEGIN')
   // Same lock order for every pair, including opposing referral deliveries.
   for(const id of [p.inviterAccountId,p.inviteeAccountId].sort())await this.gifts.gate(db,id)
   const previous=(await db.query<AwardRow>('SELECT * FROM referral_reward_awards WHERE referral_id=$1',[p.id])).rows[0]
   if(previous){sameSource(previous,p);if(previous.request_hash!==fingerprint)throw new GiftsError(409,'IDEMPOTENCY_CONFLICT');await db.query('COMMIT');return receipt(previous)}
   const awardId=randomUUID(),stamp=(await db.query<{now:Date}>('SELECT clock_timestamp()::timestamptz(3) AS now')).rows[0].now
   if(stamp.getTime()<Date.parse(q.confirmedAt))throw new GiftsError(409,'REFERRAL_NOT_QUALIFIED')
   for(const [role,accountId]of [['host',p.inviterAccountId],['guest',p.inviteeAccountId]] as const){
    const transactionId=randomUUID(),lotId=randomUUID(),sourceId='referral:'+p.id+':'+role
    await db.query("INSERT INTO ledger_transactions(id,account_id,reason,source_id,request_hash,policy_version,created_at) VALUES($1,$2,'referral_reward',$3,$4,$5,$6)",[transactionId,accountId,sourceId,fingerprint,p.campaign,stamp])
    await db.query("INSERT INTO asset_lots(id,account_id,asset_type,asset_id,source,balance_units,policy_version,issuance_transaction_id,issued_at,updated_at) VALUES($1,$2,'voucher','return-stamp','promotion',1,$3,$4,$5,$5)",[lotId,accountId,p.campaign,transactionId,stamp])
    await db.query("INSERT INTO ledger_entries(account_id,transaction_id,line_no,lot_id,direction,units) VALUES($1,$2,1,$3,'credit',1)",[accountId,transactionId,lotId])
    await db.query('INSERT INTO referral_reward_receipts(account_id,referral_id,receipt_id,role,campaign,transaction_id,lot_id,qualified_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[accountId,p.id,awardId,role,p.campaign,transactionId,lotId,q.confirmedAt,stamp])
    await this.gifts.audit(db,accountId)
    const walletVersion=await this.gifts.bump(db,accountId)
    await this.gifts.event(db,accountId,'AssetLedgerCommitted.v1',transactionId,1,{transactionId,walletVersion,reason:'referral_reward',sourceId})
    await this.gifts.event(db,accountId,'ReferralRewardGranted.v1',awardId,1,{referralId:p.id,receiptId:awardId,transactionId,role,campaign:p.campaign,assetType:'voucher',assetId:'return-stamp',units:1,grantedAt:stamp.toISOString()})
   }
   const inserted=(await db.query<AwardRow>('INSERT INTO referral_reward_awards(id,referral_id,campaign,inviter_account_id,invitee_account_id,inviter_access_version,invitee_access_version,registered_at,qualification_event_id,qualified_at,confirmed_seq,qualification_origin,request_hash,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *',[awardId,p.id,p.campaign,p.inviterAccountId,p.inviteeAccountId,versions.get(p.inviterAccountId),versions.get(p.inviteeAccountId),p.registeredAt,q.eventId,q.confirmedAt,q.confirmedSeq,q.origin,fingerprint,stamp])).rows[0]
   await db.query('COMMIT');return receipt(inserted)
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
 }
}

export class ReferralRewardsWorker{
 private cursor:string|null=null
 private stopped=false
 constructor(readonly rewards:ReferralRewardsStore){}
 stop(){this.stopped=true}
 async poll(){
  const result={scanned:0,awarded:0,acknowledged:0,failed:0},deps=this.rewards.gifts.dependencies
  if(this.stopped)return result
  if(!deps.pendingReferrals||!deps.referralQualification||!deps.acknowledgeReferral)throw unavailable()
  const page=await deps.pendingReferrals(this.cursor??undefined)
  if(this.stopped)return result
  for(const p of page.items){
   if(this.stopped)break
   result.scanned++
   try{
    let accepted=await this.rewards.existing(p)
    if(accepted){await this.rewards.active(p);accepted=await this.rewards.existing(p);if(!accepted)throw missing()}
    else{
     const q=await deps.referralQualification(p.inviteeAccountId)
     if(this.stopped)break
     if(!q||Date.parse(q.confirmedAt)<Date.parse(p.registeredAt))continue
     accepted=await this.rewards.award(p,q);result.awarded++
    }
    if(this.stopped)break
    await deps.acknowledgeReferral(accepted);result.acknowledged++
   }catch{result.failed++}
  }
  this.cursor=page.nextCursor
  return result
 }
}
