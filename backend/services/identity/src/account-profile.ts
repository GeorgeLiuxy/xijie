import {createHash} from 'node:crypto'
import type {IdentityStore} from './store.js'
export class AccountProfileError extends Error{constructor(readonly status:number,readonly code:string,readonly details?:Record<string,number>){super(code)}}
export function accountProfileInput(body:unknown){
 if(!body||typeof body!=='object'||Array.isArray(body))throw new AccountProfileError(400,'INVALID_ARGUMENT')
 const input=body as Record<string,unknown>
 if(Object.keys(input).length!==1||typeof input.displayName!=='string'||input.displayName.includes('\0')||/\p{Surrogate}/u.test(input.displayName))throw new AccountProfileError(400,'INVALID_ARGUMENT')
 const displayName=input.displayName.trim()
 if(!displayName||[...displayName].length>12||/\p{C}/u.test(displayName))throw new AccountProfileError(400,'INVALID_ARGUMENT')
 return{displayName}
}
export class AccountProfileStore{
 constructor(readonly identity:IdentityStore){}
 async update(sessionHash:string,expectedSession:string,key:string,version:number,input:{displayName:string}){
  const requestHash=createHash('sha256').update(JSON.stringify({version,input})).digest('hex')
  return this.identity.withLockedSession(sessionHash,expectedSession,async(db,session)=>{
   const previous=(await db.query('SELECT request_hash FROM account_profile_commands WHERE account_id=$1 AND idempotency_key=$2',[session.accountId,key])).rows[0]
   if(previous&&previous.request_hash!==requestHash)throw new AccountProfileError(409,'IDEMPOTENCY_CONFLICT')
   if(!previous){
    if(session.version!==version)throw new AccountProfileError(412,'VERSION_CONFLICT',{currentVersion:session.version})
    const updated=(await db.query("UPDATE accounts SET display_name=$2,version=version+CASE WHEN display_name=$2 THEN 0 ELSE 1 END,updated_at=GREATEST(updated_at,clock_timestamp()) WHERE id=$1 AND status='active' RETURNING version",[session.accountId,input.displayName])).rows[0]
    if(!updated)throw new AccountProfileError(401,'UNAUTHENTICATED')
    await db.query('INSERT INTO account_profile_commands(account_id,idempotency_key,request_hash,accepted_version) VALUES($1,$2,$3,$4)',[session.accountId,key,requestHash,updated.version])
   }
   // Old receipts read the current profile; they never restore an older name.
   const current=await this.identity.current(sessionHash,db)
   if(!current||current.id!==expectedSession)throw new AccountProfileError(401,'UNAUTHENTICATED')
   return{id:current.accountId,displayName:current.displayName,locale:current.locale,status:current.status,version:current.version,createdAt:current.registeredAt.toISOString(),onboardingState:'empty'}
  })
 }
}
