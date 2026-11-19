export type AccountProfileContext={accountId:string;sessionId:string;onUnauthorized:()=>void}
export class AccountProfileError extends Error{constructor(readonly status:number,readonly code:string,readonly pendingDisplayName?:string){super(code)}}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
type Profile={id:string;displayName:string;version:number}
type Intent={key:string;version:number;displayName:string}
export function createAccountProfileClient(context:AccountProfileContext){
 let active=true,epoch=0,busy=false;const controllers=new Set<AbortController>(),storageKey='xijie.account-profile.'+context.accountId
 const name=(value:string)=>{const n=value.trim();if(!n||[...n].length>12||/\p{C}/u.test(n)||/\p{Surrogate}/u.test(n))throw new AccountProfileError(400,'INVALID_ARGUMENT');return n}
 const load=():Intent|undefined=>{try{const raw=sessionStorage.getItem(storageKey);if(raw===null)return;const v=JSON.parse(raw);if(!v||!uuid.test(v.key)||!Number.isSafeInteger(v.version)||v.version<1||name(v.displayName)!==v.displayName)throw Error();return v}catch{throw new AccountProfileError(503,'RECOVERY_STORAGE_UNAVAILABLE')}}
 const save=(v?:Intent)=>{try{if(v)sessionStorage.setItem(storageKey,JSON.stringify(v));else sessionStorage.removeItem(storageKey)}catch{throw new AccountProfileError(503,'RECOVERY_STORAGE_UNAVAILABLE')}}
 async function request(intent?:Intent){
  const captured=epoch,c=new AbortController();controllers.add(c);const check=()=>{if(!active||captured!==epoch||c.signal.aborted)throw new DOMException('Canceled','AbortError')}
  try{check();const r=await fetch('/v1/accounts/me',{method:intent?'PATCH':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:c.signal,headers:{'X-Xijie-Expected-Session':context.sessionId,...(intent?{'Content-Type':'application/json','Idempotency-Key':intent.key,'If-Match':'"v'+intent.version+'"'}:{})},...(intent?{body:JSON.stringify({displayName:intent.displayName})}:{})});check();const v=await r.json();check();if(!r.ok){if(r.status===401)context.onUnauthorized();throw new AccountProfileError(r.status,v?.error?.code??'UNAVAILABLE')};const data=v?.data as Profile;if(!data||data.id!==context.accountId||typeof data.displayName!=='string'||!Number.isSafeInteger(data.version)||data.version<1)throw new AccountProfileError(502,'INVALID_RESPONSE');return data}finally{controllers.delete(c)}
 }
 return{activate(){active=true},dispose(){active=false;epoch++;controllers.forEach(c=>c.abort());controllers.clear()},
  async update(value:string){if(busy)throw new AccountProfileError(409,'IN_PROGRESS');busy=true;try{const normalized=name(value);let intent=load();if(intent&&intent.displayName!==normalized)throw new AccountProfileError(409,'PROFILE_CHANGE_PENDING',intent.displayName);if(!intent){const profile=await request();intent={key:crypto.randomUUID(),version:profile.version,displayName:normalized};save(intent)}const result=await request(intent);save();return result}catch(error){if(error instanceof AccountProfileError&&error.status===412&&error.code==='VERSION_CONFLICT')save();throw error}finally{busy=false}},
 }
}
