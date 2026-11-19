import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID} from 'node:crypto'
import type {Pool,PoolClient} from 'pg'
import type {IdentityStore,RegistrationReferrals} from './store.js'
import type {ReferralsConfig} from './referrals-config.js'

const campaign='first-memory-v1' as const
const tokenPattern=/^[A-Za-z0-9_-]{43}$/
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
export class ReferralError extends Error{constructor(readonly status:number,readonly code:string){super(code)}}
const missing=()=>new ReferralError(404,'NOT_FOUND')
const conflict=()=>new ReferralError(409,'IDEMPOTENCY_CONFLICT')
type Link={id:string;account_id:string;campaign:typeof campaign;public_name:string;token_hash:string;token_cipher:string;version:number;created_at:Date;revoked_at:Date|null}
type Attribution={id:string;link_id:string;intent_id:string;inviter_account_id:string;invitee_account_id:string;registration_id:string;campaign:typeof campaign;registered_at:Date;state:'awaiting_memory'|'rewarded';receipt_id:string|null;qualified_at:Date|null;rewarded_at:Date|null}

export class ReferralsStore implements RegistrationReferrals{
 constructor(private readonly pool:Pool,private readonly identity:IdentityStore,readonly config:ReferralsConfig){if(config.enabled){if(config.tokenKey?.length!==32)throw new Error('Referrals key is required');identity.useReferrals(this)}}
 private enabled(){if(!this.config.enabled)throw new ReferralError(403,'FEATURE_DISABLED')}
 private async tx<T>(work:(db:PoolClient)=>Promise<T>){const db=await this.pool.connect();try{await db.query('BEGIN');const value=await work(db);await db.query('COMMIT');return value}catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}}
 private seal(id:string,value:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.config.tokenKey!,iv);cipher.setAAD(Buffer.from('referral:'+id));return Buffer.concat([iv,cipher.update(value,'utf8'),cipher.final(),cipher.getAuthTag()]).toString('base64url')}
 private url(row:Link){const bytes=Buffer.from(row.token_cipher,'base64url'),cipher=createDecipheriv('aes-256-gcm',this.config.tokenKey!,bytes.subarray(0,12));cipher.setAAD(Buffer.from('referral:'+row.id));cipher.setAuthTag(bytes.subarray(-16));const token=Buffer.concat([cipher.update(bytes.subarray(12,-16)),cipher.final()]).toString('utf8');if(!tokenPattern.test(token)||hash(token)!==row.token_hash)throw new ReferralError(503,'DEPENDENCY_UNAVAILABLE');return this.config.publicOrigin+'/invite/'+token}
 private dto(row:Link){return{id:row.id,publicName:row.public_name,url:row.revoked_at?null:this.url(row),status:row.revoked_at?'revoked' as const:'active' as const,version:row.version,createdAt:row.created_at.toISOString()}}
 private async link(db:Pool|PoolClient,id:string,accountId:string){const row=(await db.query<Link>('SELECT * FROM referral_links WHERE id=$1 AND account_id=$2',[id,accountId])).rows[0];if(!row)throw missing();return row}
 async create(sessionHash:string,expected:string,key:string,publicName:string){
  this.enabled();const fp=hash(JSON.stringify(['create',publicName]))
  return this.identity.withLockedSession(sessionHash,expected,async(db,actor)=>{
   const command=(await db.query('SELECT * FROM referral_commands WHERE account_id=$1 AND idempotency_key=$2',[actor.accountId,key])).rows[0]
   if(command){if(command.request_hash!==fp||command.operation!=='create')throw conflict();return this.dto(await this.link(db,command.link_id,actor.accountId))}
   let row=(await db.query<Link>('SELECT * FROM referral_links WHERE account_id=$1 AND campaign=$2 AND revoked_at IS NULL',[actor.accountId,campaign])).rows[0]
   if(row&&row.public_name!==publicName)throw new ReferralError(409,'REFERRAL_LINK_EXISTS')
   if(!row){const id=randomUUID(),token=randomBytes(32).toString('base64url');row=(await db.query<Link>('INSERT INTO referral_links(id,account_id,public_name,token_hash,token_cipher) VALUES($1,$2,$3,$4,$5) RETURNING *',[id,actor.accountId,publicName,hash(token),this.seal(id,token)])).rows[0]}
   await db.query("INSERT INTO referral_commands(account_id,operation,idempotency_key,request_hash,link_id) VALUES($1,'create',$2,$3,$4)",[actor.accountId,key,fp,row.id]);return this.dto(row)
  })
 }
 async status(sessionHash:string,expected:string){
  this.enabled();return this.identity.withLockedSession(sessionHash,expected,async(db,actor)=>{
   const link=(await db.query<Link>('SELECT * FROM referral_links WHERE account_id=$1 AND campaign=$2 AND revoked_at IS NULL',[actor.accountId,campaign])).rows[0]
   const rows=(await db.query<Attribution>('SELECT * FROM referral_attributions WHERE inviter_account_id=$1 ORDER BY registered_at DESC,id DESC LIMIT 1001',[actor.accountId])).rows
   if(rows.length>1000)throw new ReferralError(413,'REFERRAL_HISTORY_TOO_LARGE')
   const count=(await db.query<{n:number}>('SELECT count(*)::int AS n FROM referral_reward_receipts WHERE account_id=$1',[actor.accountId])).rows[0].n
   return{link:link?this.dto(link):null,records:rows.map(row=>({id:row.id,joinedAt:row.registered_at.toISOString(),firstMemoryAt:row.qualified_at?.toISOString()??null,rewardedAt:row.rewarded_at?.toISOString()??null})),receivedRewardCount:count}
  })
 }
 async revoke(sessionHash:string,expected:string,key:string,id:string,version:number){
  this.enabled();const fp=hash(JSON.stringify(['revoke',id,version]));return this.identity.withLockedSession(sessionHash,expected,async(db,actor)=>{
   const previous=(await db.query('SELECT * FROM referral_commands WHERE account_id=$1 AND idempotency_key=$2',[actor.accountId,key])).rows[0]
   if(previous){if(previous.request_hash!==fp||previous.operation!=='revoke')throw conflict();return this.dto(await this.link(db,previous.link_id,actor.accountId))}
   let row=await this.link(db,id,actor.accountId);if(row.version!==version)throw new ReferralError(412,'VERSION_CONFLICT')
   if(!row.revoked_at)row=(await db.query<Link>('UPDATE referral_links SET revoked_at=clock_timestamp(),version=version+1 WHERE id=$1 RETURNING *',[id])).rows[0]
   await db.query("INSERT INTO referral_commands(account_id,operation,idempotency_key,request_hash,link_id) VALUES($1,'revoke',$2,$3,$4)",[actor.accountId,key,fp,id]);return this.dto(row)
  })
 }
 async publicInfo(token:string){this.enabled();if(!tokenPattern.test(token))throw missing();const row=(await this.pool.query<Link>("SELECT l.* FROM referral_links l JOIN accounts a ON a.id=l.account_id WHERE l.token_hash=$1 AND l.revoked_at IS NULL AND a.status='active'",[hash(token)])).rows[0];if(!row)throw missing();return{publicName:row.public_name,campaign}}
 async join(token:string,browserHash:string,key:string,loggedIn=false){
  this.enabled();if(!tokenPattern.test(token))throw missing()
  return this.tx(async db=>{
   // Share the authentication slot lock: join cannot replace an intent while
   // the same browser freezes an authentication attempt or commits registration.
   await db.query('INSERT INTO app_session_slots(binding_hash) VALUES($1) ON CONFLICT DO NOTHING',[browserHash])
   await db.query('SELECT id FROM app_session_slots WHERE binding_hash=$1 FOR UPDATE',[browserHash])
   const prior=(await db.query('SELECT i.*,l.token_hash FROM referral_join_intents i JOIN referral_links l ON l.id=i.link_id WHERE i.browser_hash=$1 AND i.idempotency_key=$2',[browserHash,key])).rows[0]
   if(prior){if(prior.token_hash!==hash(token))throw conflict();return{invitationIntentId:prior.id,expiresAt:prior.expires_at.toISOString()}}
   const initial=(await db.query<Link>('SELECT * FROM referral_links WHERE token_hash=$1',[hash(token)])).rows[0];if(!initial)throw missing()
   const account=(await db.query("SELECT id FROM accounts WHERE id=$1 AND status='active' FOR SHARE",[initial.account_id])).rows[0];if(!account)throw missing()
   const link=(await db.query<Link>('SELECT * FROM referral_links WHERE id=$1 AND revoked_at IS NULL FOR SHARE',[initial.id])).rows[0];if(!link)throw missing()
   const active=(await db.query("SELECT 1 FROM app_sessions s JOIN app_session_slots b ON b.id=s.slot_id JOIN accounts a ON a.id=s.account_id WHERE b.binding_hash=$1 AND s.status='active' AND a.status='active' AND s.account_access_version=a.access_version AND s.expires_at>clock_timestamp()",[browserHash])).rowCount
   if(loggedIn||active)return{invitationIntentId:null,expiresAt:null}
   const recent=(await db.query<{n:number}>("SELECT count(*)::int n FROM referral_join_intents WHERE browser_hash=$1 AND created_at>clock_timestamp()-interval '1 minute'",[browserHash])).rows[0].n
   if(recent>=20)throw new ReferralError(429,'RATE_LIMITED')
   const row=(await db.query('INSERT INTO referral_join_intents(link_id,browser_hash,idempotency_key) VALUES($1,$2,$3) RETURNING id,expires_at',[link.id,browserHash,key])).rows[0]
   return{invitationIntentId:row.id,expiresAt:row.expires_at.toISOString()}
  })
 }
 async capture(db:PoolClient,browserHash:string,attemptId:string,purpose:string){
  if(!this.config.enabled||purpose!=='sign_in')return
  const intent=(await db.query("SELECT i.id FROM referral_join_intents i JOIN referral_links l ON l.id=i.link_id JOIN accounts a ON a.id=l.account_id WHERE i.browser_hash=$1 AND i.closed_at IS NULL AND i.expires_at>clock_timestamp() AND l.revoked_at IS NULL AND a.status='active' ORDER BY i.created_at DESC,i.id DESC LIMIT 1",[browserHash])).rows[0]
  if(intent)await db.query('INSERT INTO referral_auth_bindings(attempt_id,intent_id) VALUES($1,$2)',[attemptId,intent.id])
 }
 async registered(db:PoolClient,input:{browserHash:string;attemptId:string;accountId:string;purpose:string;isNew:boolean;now:Date}):Promise<string|null>{
  if(!this.config.enabled)return null
  const initial=(await db.query('SELECT i.*,l.account_id AS inviter FROM referral_auth_bindings b JOIN referral_join_intents i ON i.id=b.intent_id JOIN referral_links l ON l.id=i.link_id WHERE b.attempt_id=$1 AND i.browser_hash=$2',[input.attemptId,input.browserHash])).rows[0]
  if(!initial)return null
  // A completed login to an existing identity must not leave its invitation
  // available for a subsequent, unrelated registration in the same browser.
  if(!input.isNew||input.purpose!=='sign_in'){
   await db.query('UPDATE referral_join_intents SET closed_at=COALESCE(closed_at,$2) WHERE browser_hash=$1',[input.browserHash,input.now]);return null
  }
  const host=(await db.query("SELECT id FROM accounts WHERE id=$1 AND status='active' FOR SHARE",[initial.inviter])).rows[0]
  const row=(await db.query('SELECT i.*,l.revoked_at FROM referral_join_intents i JOIN referral_links l ON l.id=i.link_id WHERE i.id=$1 FOR UPDATE OF i FOR SHARE OF l',[initial.id])).rows[0]
  if(!host||!row||row.revoked_at||row.closed_at||row.expires_at<=input.now||initial.inviter===input.accountId)return null
  const registration=(await db.query('SELECT registration_id FROM accounts WHERE id=$1',[input.accountId])).rows[0]
  const attribution=(await db.query('INSERT INTO referral_attributions(link_id,intent_id,inviter_account_id,invitee_account_id,registration_id,registered_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[row.link_id,row.id,initial.inviter,input.accountId,registration.registration_id,input.now])).rows[0]
  await db.query('UPDATE referral_join_intents SET consumed_account_id=$2,consumed_at=$3,closed_at=$3 WHERE id=$1',[row.id,input.accountId,input.now])
  await db.query('UPDATE referral_join_intents SET closed_at=COALESCE(closed_at,$2) WHERE browser_hash=$1',[input.browserHash,input.now])
  return attribution.id
 }
 async pending(limit:number,after:string|null){
  this.enabled();const rows=(await this.pool.query<Attribution>("SELECT r.* FROM referral_attributions r JOIN accounts host ON host.id=r.inviter_account_id JOIN accounts guest ON guest.id=r.invitee_account_id WHERE r.state='awaiting_memory' AND host.status='active' AND guest.status='active' AND ($1::uuid IS NULL OR r.id>$1) ORDER BY r.id LIMIT $2",[after,limit+1])).rows
  return{data:rows.slice(0,limit).map(row=>({id:row.id,campaign,inviterAccountId:row.inviter_account_id,inviteeAccountId:row.invitee_account_id,registeredAt:row.registered_at.toISOString()})),meta:{nextCursor:rows.length>limit?rows[limit-1].id:null}}
 }
 async rewarded(id:string,receiptId:string,qualifiedAt:string){
  this.enabled();return this.tx(async db=>{
   await db.query("SELECT pg_advisory_xact_lock(hashtextextended('xijie:referral:receipt:'||$1,0))",[receiptId])
   const first=(await db.query<Attribution>('SELECT * FROM referral_attributions WHERE id=$1',[id])).rows[0];if(!first)throw missing()
   const accounts=(await db.query("SELECT id,status FROM accounts WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE",[[first.inviter_account_id,first.invitee_account_id]])).rows
   if(accounts.length!==2||accounts.some(row=>row.status!=='active'))throw missing()
   const row=(await db.query<Attribution>('SELECT * FROM referral_attributions WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!row)throw missing()
   const instant=new Date(qualifiedAt),now=(await db.query<{now:Date}>('SELECT clock_timestamp() AS now')).rows[0].now
   if(!Number.isFinite(instant.getTime())||instant<row.registered_at||instant>now)throw new ReferralError(400,'INVALID_ARGUMENT')
   const dto=(r:Attribution)=>({id:r.id,state:r.state,qualifiedAt:r.qualified_at!.toISOString(),rewardedAt:r.rewarded_at!.toISOString(),receiptId:r.receipt_id!})
   if(row.state==='rewarded'){if(row.receipt_id!==receiptId||row.qualified_at!.getTime()!==instant.getTime())throw conflict();return dto(row)}
   if((await db.query('SELECT id FROM referral_attributions WHERE receipt_id=$1',[receiptId])).rowCount)throw conflict()
   const updated=(await db.query<Attribution>("UPDATE referral_attributions SET state='rewarded',receipt_id=$2,qualified_at=$3,rewarded_at=$4 WHERE id=$1 RETURNING *",[id,receiptId,instant,now])).rows[0]
   await db.query("INSERT INTO referral_reward_receipts(account_id,attribution_id,receipt_id,role,qualified_at,rewarded_at) VALUES($1,$3,$4,'inviter',$5,$6),($2,$3,$4,'invitee',$5,$6)",[row.inviter_account_id,row.invitee_account_id,row.id,receiptId,instant,now])
   return dto(updated)
  })
 }
}

// Data rights use SQL-only helpers, including when the feature is disabled.
export async function referralExport(db:PoolClient,accountId:string){
 if(!(await db.query("SELECT to_regclass('referral_links') AS table_name")).rows[0].table_name)return{}
 const links=(await db.query('SELECT id,campaign,public_name AS "publicName",version,created_at AS "createdAt",rules_accepted_at AS "rulesAcceptedAt",revoked_at AS "revokedAt" FROM referral_links WHERE account_id=$1 ORDER BY created_at,id',[accountId])).rows
 const records=(await db.query(`SELECT id,campaign,CASE WHEN inviter_account_id=$1 THEN 'inviter' ELSE 'invitee' END AS role,registered_at AS "registeredAt",state,qualified_at AS "qualifiedAt",rewarded_at AS "rewardedAt",receipt_id AS "receiptId" FROM referral_attributions WHERE inviter_account_id=$1 OR invitee_account_id=$1 ORDER BY registered_at,id`,[accountId])).rows
 const rewards=(await db.query('SELECT attribution_id AS "attributionId",receipt_id AS "receiptId",role,qualified_at AS "qualifiedAt",rewarded_at AS "rewardedAt" FROM referral_reward_receipts WHERE account_id=$1 ORDER BY rewarded_at,attribution_id',[accountId])).rows
 const decisions=(await db.query('SELECT id,campaign,rules_accepted_at AS "rulesAcceptedAt",created_at AS "createdAt",expires_at AS "expiresAt",consumed_at AS "consumedAt" FROM referral_join_intents WHERE consumed_account_id=$1 ORDER BY created_at,id',[accountId])).rows
 const commands=(await db.query('SELECT operation,idempotency_key AS "idempotencyKey",link_id AS "linkId",created_at AS "createdAt" FROM referral_commands WHERE account_id=$1 ORDER BY created_at,idempotency_key',[accountId])).rows
 return{referrals:{links,records,rewards,decisions,commands}}
}
export async function eraseReferrals(db:PoolClient,accountId:string){
 if(!(await db.query("SELECT to_regclass('referral_links') AS table_name")).rows[0].table_name)return
 await db.query('DELETE FROM referral_attributions WHERE inviter_account_id=$1 OR invitee_account_id=$1',[accountId])
 await db.query('DELETE FROM referral_join_intents WHERE consumed_account_id=$1 OR link_id IN(SELECT id FROM referral_links WHERE account_id=$1) OR(consumed_account_id IS NULL AND browser_hash IN(SELECT s.binding_hash FROM app_session_slots s JOIN app_sessions a ON a.slot_id=s.id WHERE a.account_id=$1))',[accountId])
 await db.query('DELETE FROM referral_reward_receipts WHERE account_id=$1',[accountId])
 await db.query('DELETE FROM referral_commands WHERE account_id=$1',[accountId])
 await db.query('DELETE FROM referral_links WHERE account_id=$1',[accountId])
}
