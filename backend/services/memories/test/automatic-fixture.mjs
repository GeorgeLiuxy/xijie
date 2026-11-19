import {fixture as baseFixture} from './fixture.mjs'
export {input} from './fixture.mjs'
// Only automatic-memory tests opt in to the newer, explicitly disclosed AI purpose.
// The shared fixture keeps the older grant and must never acquire this capability implicitly.
export async function fixture(t){
 const f=await baseFixture(t),createAccount=f.account
 f.account=()=>{
  const account=createAccount()
  f.accounts.get(account.id).aiTextProcessing.automaticMemoryAllowed=true
  return account
 }
 return f
}
