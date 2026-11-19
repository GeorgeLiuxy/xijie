import {useEffect,useMemo,useRef} from 'react'
type Context={accountId:string;sessionId:string;onUnauthorized:()=>void;onChanged?:(personId:string)=>void|Promise<void>}
export type MemoryImportIntent={key:string;personId:string;personVersion:number;batch:{batchId:string;sourceSha256:string;items:{itemId:string;title:string;body:string}[]}}
type Receipt={batchId:string;personId:string;itemCount:number;items:{itemId:string;memoryId:string;version:number;status:'active'|'removed'}[]}
export class MemoryImportError extends Error{constructor(readonly status:number,readonly code:string){super(code)}}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
function text(v:unknown,max:number){if(typeof v!=='string'||!v.trim()||v.includes('\0')||/\p{Surrogate}/u.test(v))throw new MemoryImportError(400,'IMPORT_FILE_INVALID');if([...v.trim()].length>max)throw new MemoryImportError(400,'IMPORT_CONTENT_TOO_LONG');return v.trim()}
function originals(items:unknown){if(!Array.isArray(items)||!items.length)throw new MemoryImportError(400,'IMPORT_FILE_INVALID');if(items.length>50)throw new MemoryImportError(400,'IMPORT_TOO_MANY_MEMORIES');const result=items.map(item=>{if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(k=>!['title','body'].includes(k)))throw new MemoryImportError(400,'IMPORT_FILE_INVALID');return {title:text(item.title,120),body:text(item.body,10000)}});if(result.reduce((n,v)=>n+[...v.title].length+[...v.body].length,0)>100000)throw new MemoryImportError(400,'IMPORT_TOTAL_TOO_LONG');return result}
function validateIntent(v:MemoryImportIntent,personId:string){if(!v||v.personId!==personId||!uuid.test(v.key)||!Number.isSafeInteger(v.personVersion)||v.personVersion<1||!v.batch||!uuid.test(v.batch.batchId)||!/^[a-f0-9]{64}$/.test(v.batch.sourceSha256)||!Array.isArray(v.batch.items))throw new MemoryImportError(503,'RECOVERY_STORAGE_UNAVAILABLE');try{originals(v.batch.items.map(({title,body})=>({title,body})));if(v.batch.items.some(i=>!uuid.test(i.itemId))||new Set(v.batch.items.map(i=>i.itemId)).size!==v.batch.items.length)throw Error()}catch{throw new MemoryImportError(503,'RECOVERY_STORAGE_UNAVAILABLE')}return v}
export function createMemoryImportClient(context:Context){
 let active=true,epoch=0;const requests=new Set<AbortController>(),busy=new Set<string>(),location=(id:string)=>'xijie.memory-import.'+context.accountId+'.'+id
 const check=(generation=epoch)=>{if(!active||generation!==epoch)throw new DOMException('Canceled','AbortError')}
 const pending=(id:string)=>{try{const raw=localStorage.getItem(location(id));return raw===null?undefined:validateIntent(JSON.parse(raw),id)}catch{throw new MemoryImportError(503,'RECOVERY_STORAGE_UNAVAILABLE')}}
 const remember=(id:string,value?:MemoryImportIntent)=>{try{if(value)localStorage.setItem(location(id),JSON.stringify(value));else localStorage.removeItem(location(id))}catch{throw new MemoryImportError(503,'RECOVERY_STORAGE_UNAVAILABLE')}}
 return{activate(){active=true},dispose(){active=false;epoch++;requests.forEach(c=>c.abort());requests.clear()},pending,
  async prepare(file:File,personId:string,personVersion:number):Promise<MemoryImportIntent>{
   const captured=epoch;check(captured)
   if(!uuid.test(personId)||!Number.isSafeInteger(personVersion)||personVersion<1)throw new MemoryImportError(400,'INVALID_ARGUMENT')
   if(!/\.(txt|json)$/i.test(file.name))throw new MemoryImportError(400,'IMPORT_FILE_UNSUPPORTED')
   if(file.size<1)throw new MemoryImportError(400,'IMPORT_FILE_EMPTY')
   if(file.size>512*1024)throw new MemoryImportError(400,'IMPORT_FILE_TOO_LARGE')
   let bytes:ArrayBuffer
   try{bytes=await file.arrayBuffer()}catch{check(captured);throw new MemoryImportError(400,'IMPORT_FILE_UNREADABLE')}
   check(captured)
   let raw:string
   try{raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{throw new MemoryImportError(400,'IMPORT_FILE_UNREADABLE')}
   let items:{title:string;body:string}[]
   try{
    if(/\.json$/i.test(file.name)){
     const v=JSON.parse(raw)
     if(!v||typeof v!=='object'||Array.isArray(v)||v.schemaVersion!==1||Object.keys(v).some(k=>!['schemaVersion','memories'].includes(k)))throw Error()
     items=originals(v.memories)
    }else{
     if(!raw.trim())throw new MemoryImportError(400,'IMPORT_FILE_EMPTY')
     items=originals([{title:[...file.name.replace(/\.txt$/i,'')].slice(0,120).join('')||'文字资料',body:raw}])
    }
   }catch(error){if(error instanceof MemoryImportError)throw error;throw new MemoryImportError(400,'IMPORT_FILE_INVALID')}
   const digest=await crypto.subtle.digest('SHA-256',bytes);check(captured)
   return {key:crypto.randomUUID(),personId,personVersion,batch:{batchId:crypto.randomUUID(),sourceSha256:[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join(''),items:items.map(item=>({...item,itemId:crypto.randomUUID()}))}}
  },
  async submit(intent:MemoryImportIntent):Promise<Receipt>{const captured=epoch;check(captured);validateIntent(intent,intent.personId);if(busy.has(intent.personId))throw new MemoryImportError(409,'IN_PROGRESS');busy.add(intent.personId);const c=new AbortController();requests.add(c);const timeout=setTimeout(()=>c.abort(),20_000);try{const old=pending(intent.personId);if(old&&JSON.stringify(old)!==JSON.stringify(intent))throw new MemoryImportError(409,'IMPORT_PENDING');check(captured);remember(intent.personId,intent);const r=await fetch('/v1/persons/'+intent.personId+'/memory-imports',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:c.signal,headers:{'Content-Type':'application/json','X-Xijie-Expected-Session':context.sessionId,'Idempotency-Key':intent.key,'If-Match':'"v'+intent.personVersion+'"'},body:JSON.stringify(intent.batch)});check(captured);const v=await r.json();check(captured);if(!r.ok){if(r.status===401)context.onUnauthorized();if(r.status===412&&v?.error?.code==='VERSION_CONFLICT')remember(intent.personId);throw new MemoryImportError(r.status,v?.error?.code??'UNAVAILABLE')};const result=v.data as Receipt;if(!result||result.batchId!==intent.batch.batchId||result.personId!==intent.personId||result.itemCount!==intent.batch.items.length||!Array.isArray(result.items)||result.items.length!==intent.batch.items.length||new Set(result.items.map(i=>i.itemId)).size!==result.items.length||new Set(result.items.map(i=>i.memoryId)).size!==result.items.length||result.items.some(i=>!intent.batch.items.some(j=>j.itemId===i.itemId)||!uuid.test(i.memoryId)||!Number.isSafeInteger(i.version)||i.version<1||!['active','removed'].includes(i.status)))throw new MemoryImportError(502,'INVALID_RESPONSE');remember(intent.personId);void Promise.resolve(context.onChanged?.(intent.personId)).catch(()=>{});return result}finally{clearTimeout(timeout);requests.delete(c);busy.delete(intent.personId)}},
 }
}
export type MemoryImportService=ReturnType<typeof createMemoryImportClient>
export function useMemoryImports(context:Context|undefined){const latest=useRef(context);latest.current=context;const client=useMemo(()=>context?createMemoryImportClient({...context,onChanged:id=>latest.current?.onChanged?.(id)}):undefined,[context?.accountId,context?.sessionId]),scoped=useRef(client);if(scoped.current!==client){scoped.current?.dispose();scoped.current=client}useEffect(()=>{client?.activate();return()=>client?.dispose()},[client]);return client}
