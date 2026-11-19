import {randomUUID} from 'node:crypto'
import {hash,identifier,missing} from './contracts.js'
import type {GiftsStore} from './store.js'
type AlbumReceipt={id:string;account_id:string;album_id:string;created_at:Date}
const dto=(r:AlbumReceipt)=>({receiptId:r.id,albumId:r.album_id,accountId:r.account_id,assetType:'voucher' as const,assetId:'return-stamp' as const,units:1 as const,grantedAt:r.created_at.toISOString()})
export class AlbumRewardsStore{
 constructor(readonly gifts:GiftsStore){}
 async get(account:string,album:string){
  account=identifier(account);album=identifier(album);const a=await this.gifts.dependencies.account(account);if(a.accountId!==account||a.status!=='active')throw missing();
  const r=(await this.gifts.pool.query<AlbumReceipt>('SELECT r.* FROM album_reward_receipts r JOIN gifts_account_write_gates g ON g.account_id=r.account_id AND g.erased_at IS NULL WHERE r.account_id=$1 AND r.album_id=$2',[account,album])).rows[0];if(!r)throw missing();return dto(r)
 }
 async reward(account:string,album:string){
  account=identifier(account);album=identifier(album)
  const a=await this.gifts.dependencies.account(account);if(a.accountId!==account||a.status!=='active')throw missing()
  return this.gifts.tx(account,async db=>{
   const old=(await db.query<AlbumReceipt>('SELECT * FROM album_reward_receipts WHERE account_id=$1 AND album_id=$2',[account,album])).rows[0];if(old)return dto(old)
   const id=randomUUID(),transactionId=randomUUID(),lotId=randomUUID(),policy='shared-album-v1',sourceId='album:'+album+':participant:'+account
   await db.query("INSERT INTO ledger_transactions(id,account_id,reason,source_id,request_hash,policy_version) VALUES($1,$2,'album_reward',$3,$4,$5)",[transactionId,account,sourceId,hash(JSON.stringify({accountId:account,albumId:album,campaign:policy})),policy])
   await db.query("INSERT INTO asset_lots(id,account_id,asset_type,asset_id,source,balance_units,policy_version,issuance_transaction_id) VALUES($1,$2,'voucher','return-stamp','promotion',1,$3,$4)",[lotId,account,policy,transactionId])
   await db.query("INSERT INTO ledger_entries(account_id,transaction_id,line_no,lot_id,direction,units) VALUES($1,$2,1,$3,'credit',1)",[account,transactionId,lotId])
   const r=(await db.query<AlbumReceipt>('INSERT INTO album_reward_receipts(account_id,album_id,id,transaction_id,lot_id,account_access_version) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[account,album,id,transactionId,lotId,a.accessVersion])).rows[0]
   await this.gifts.audit(db,account);const walletVersion=await this.gifts.bump(db,account)
   await this.gifts.event(db,account,'AssetLedgerCommitted.v1',transactionId,1,{transactionId,walletVersion,reason:'album_reward',sourceId})
   await this.gifts.event(db,account,'AlbumRewardGranted.v1',id,1,{receiptId:id,albumId:album,transactionId,campaign:policy,assetType:'voucher',assetId:'return-stamp',units:1,grantedAt:r.created_at.toISOString()})
   return dto(r)
  })
 }
}
