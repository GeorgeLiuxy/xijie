import {useEffect,useMemo,useRef,useSyncExternalStore} from 'react'
export type ReminderSetting={personId:string;enabled:boolean;timeZone:string|null;version:number}
export type ReminderNotice={id:string;personId:string;personName:string;kind:'birthday'|'meeting_anniversary';localDate:string;createdAt:string;readAt:string|null;version:number}
type Context={accountId:string;sessionId:string;onUnauthorized:()=>void}
type Snapshot={status:'loading'|'ready'|'error';notices:ReminderNotice[];error?:string}
type Intent={key:string;version:number;body:Record<string,unknown>}
export class ReminderError extends Error{constructor(readonly status:number,readonly code:string,readonly pendingEnabled?:boolean){super(code)}}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const validVersion=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0
function setting(v:ReminderSetting,id:string){if(!v||v.personId!==id||typeof v.enabled!=='boolean'||!validVersion(v.version)||v.timeZone!==null&&typeof v.timeZone!=='string')throw new ReminderError(502,'INVALID_RESPONSE');return v}
function notice(v:ReminderNotice,id?:string){if(!v||!uuid.test(v.id)||id&&v.id!==id||!uuid.test(v.personId)||typeof v.personName!=='string'||!['birthday','meeting_anniversary'].includes(v.kind)||!/^\d{4}-\d{2}-\d{2}$/.test(v.localDate)||!Number.isFinite(Date.parse(v.createdAt))||v.readAt!==null&&!Number.isFinite(Date.parse(v.readAt))||!validVersion(v.version))throw new ReminderError(502,'INVALID_RESPONSE');return v}
export function createReminderClient(context:Context){
 let active=true,epoch=0,snapshot:Snapshot={status:'loading',notices:[]},readingEpoch:number|undefined
 const listeners=new Set<()=>void>(),controllers=new Set<AbortController>(),busy=new Set<string>()
 const emit=(v:Snapshot)=>{if(active){snapshot=v;listeners.forEach(fn=>fn())}}
 const storageKey=(target:string)=>'xijie.person-reminders.'+context.accountId+'.'+target
 const load=(target:string):Intent|undefined=>{try{const raw=localStorage.getItem(storageKey(target));if(raw===null)return;const v=JSON.parse(raw);if(!v||!uuid.test(v.key)||!validVersion(v.version)||!v.body||typeof v.body!=='object'||Array.isArray(v.body))throw Error();return v}catch{throw new ReminderError(503,'RECOVERY_STORAGE_UNAVAILABLE')}}
 const save=(target:string,v?:Intent)=>{try{if(v)localStorage.setItem(storageKey(target),JSON.stringify(v));else localStorage.removeItem(storageKey(target))}catch{throw new ReminderError(503,'RECOVERY_STORAGE_UNAVAILABLE')}}
 async function request(path:string,method='GET',intent?:Intent){const generation=epoch,controller=new AbortController();controllers.add(controller);const check=()=>{if(!active||generation!==epoch||controller.signal.aborted)throw new DOMException('Canceled','AbortError')};try{check();const r=await fetch(path,{method,credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal,headers:{'X-Xijie-Expected-Session':context.sessionId,...(intent?{'Content-Type':'application/json','Idempotency-Key':intent.key,'If-Match':'"v'+intent.version+'"'}:{})},...(intent?{body:JSON.stringify(intent.body)}:{})});check();const v=await r.json();check();if(!r.ok){if(r.status===401)context.onUnauthorized();throw new ReminderError(r.status,v?.error?.code??'UNAVAILABLE')}return v}finally{controllers.delete(controller)}}
 async function mutate<T>(target:string,path:string,method:string,version:number,body:Record<string,unknown>,validate:(v:T)=>T){if(busy.has(target))throw new ReminderError(409,'IN_PROGRESS');busy.add(target);try{let command=load(target);if(command&&typeof body.enabled==='boolean'&&command.body.enabled!==body.enabled)throw new ReminderError(409,'REMINDER_CHANGE_PENDING',command.body.enabled as boolean);if(!command){command={key:crypto.randomUUID(),version,body};save(target,command)}const v=await request(path,method,command),result=validate(v.data);save(target);return result}catch(error){if(error instanceof ReminderError&&error.status===412&&error.code==='VERSION_CONFLICT')save(target);throw error}finally{busy.delete(target)}}
 async function refresh(){if(readingEpoch===epoch||!active)return;const captured=epoch;readingEpoch=captured;try{const all:ReminderNotice[]=[],seen=new Set<string>();let cursor:string|null=null;do{const q=new URLSearchParams({limit:'100',...(cursor?{cursor}:{})}),v=await request('/v1/person-reminders?'+q);if(!Array.isArray(v.data)||!v.meta||v.meta.nextCursor!==null&&typeof v.meta.nextCursor!=='string')throw new ReminderError(502,'INVALID_RESPONSE');v.data.forEach((v:ReminderNotice)=>{const item=notice(v);if(all.some(n=>n.id===item.id))throw new ReminderError(502,'INVALID_RESPONSE');all.push(item)});cursor=v.meta.nextCursor;if(cursor){if(seen.has(cursor))throw new ReminderError(502,'INVALID_RESPONSE');seen.add(cursor)}}while(cursor);if(captured===epoch)emit({status:'ready',notices:all})}catch(error){if(active&&captured===epoch&&!(error instanceof DOMException&&error.name==='AbortError'))emit({...snapshot,status:'error',error:error instanceof ReminderError?error.code:'UNAVAILABLE'})}finally{if(readingEpoch===captured)readingEpoch=undefined}}
 return {subscribe(fn:()=>void){listeners.add(fn);return()=>listeners.delete(fn)},getSnapshot:()=>snapshot,
  activate(){active=true},dispose(){active=false;epoch++;controllers.forEach(c=>c.abort());controllers.clear()},refresh,
  async setting(id:string){if(!uuid.test(id))throw new ReminderError(400,'INVALID_ARGUMENT');return setting((await request('/v1/persons/'+id+'/reminder')).data,id)},
  async set(current:ReminderSetting,enabled:boolean){const body={enabled,...(!current.timeZone&&enabled?{timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}:{})};return mutate<ReminderSetting>('setting.'+current.personId,'/v1/persons/'+current.personId+'/reminder','PUT',current.version,body,v=>setting(v,current.personId))},
  async read(item:ReminderNotice){const result=await mutate<ReminderNotice>('read.'+item.id,'/v1/person-reminders/'+item.id+'/read','POST',item.version,{},v=>{const n=notice(v,item.id);if(n.personId!==item.personId||!n.readAt)throw new ReminderError(502,'INVALID_RESPONSE');return n});emit({...snapshot,notices:snapshot.notices.map(v=>v.id===result.id?result:v)});return result},
 }
}
export type ReminderService=ReturnType<typeof createReminderClient>
const empty:Snapshot={status:'loading',notices:[]}
const emptySubscribe=()=>()=>{}
export function useServiceReminders(context:Context|undefined){
 const client=useMemo(()=>context?createReminderClient(context):undefined,[context?.accountId,context?.sessionId])
 const scoped=useRef(client);if(scoped.current!==client){scoped.current?.dispose();scoped.current=client}
 const snapshot=useSyncExternalStore(client?.subscribe??emptySubscribe,client?.getSnapshot??(()=>empty))
 useEffect(()=>{if(!client)return;client.activate();void client.refresh();const focus=()=>void client.refresh(),timer=window.setInterval(focus,60_000);window.addEventListener('focus',focus);return()=>{window.clearInterval(timer);window.removeEventListener('focus',focus);client.dispose()}},[client])
 return {client,snapshot}
}
export function reminderText(item:ReminderNotice,zh:boolean){return item.kind==='birthday'?(zh?`今天是${item.personName}的生日`:`Today is ${item.personName}'s birthday`):(zh?`今天是与${item.personName}相见的纪念日`:`Today marks meeting ${item.personName}`)}
