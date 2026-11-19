import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'
const code=ts.transpileModule(await readFile(new URL('../src/serviceMemoryImports.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k),values:m}}
async function client(fetcher,store=storage(),scope={accountId:randomUUID(),sessionId:randomUUID(),onUnauthorized(){}}){const ctx=vm.createContext({fetch:fetcher,crypto:globalThis.crypto,localStorage:store,TextDecoder,Uint8Array,AbortController,DOMException,setTimeout,clearTimeout});const mod=new vm.SourceTextModule(code,{context:ctx});await mod.link(()=>new vm.SyntheticModule(['useMemo','useRef','useEffect'],function(){this.setExport('useMemo',fn=>fn());this.setExport('useRef',v=>({current:v}));this.setExport('useEffect',()=>{})},{context:ctx}));await mod.evaluate();return {api:mod.namespace.createMemoryImportClient(scope),store,scope}}
const file=(name,raw)=>{const bytes=new TextEncoder().encode(raw);return {name,size:bytes.length,arrayBuffer:async()=>bytes.buffer}}
const receipt=intent=>({batchId:intent.batch.batchId,personId:intent.personId,itemCount:intent.batch.items.length,items:intent.batch.items.map(item=>({itemId:item.itemId,memoryId:randomUUID(),version:1,status:'active'}))})
const response=(value,status=200)=>new Response(JSON.stringify(status===200?{data:value}:{error:{code:value}}),{status})
test('UTF-8 TXT and explicit JSON preserve actual originals and never infer traits or voices',async()=>{
 const h=await client(()=>assert.fail('preview is local and does not write')),person=randomUUID(),intent=await h.api.prepare(file('原文札记.txt','第一行\n第二行'),person,3)
 assert.equal(intent.batch.items[0].title,'原文札记');assert.equal(intent.batch.items[0].body,'第一行\n第二行');assert.match(intent.batch.sourceSha256,/^[a-f0-9]{64}$/);assert.equal(intent.personVersion,3);assert.equal(h.store.values.size,0)
 const structured=await h.api.prepare(file('memories.json',JSON.stringify({schemaVersion:1,memories:[{title:'标题A',body:'原文A'},{title:'标题B',body:'原文B'}]})),person,3);assert.equal(structured.batch.items.length,2);assert.notEqual(structured.batch.items[0].itemId,structured.batch.items[1].itemId)
 for(const [f,code] of [[file('bad.txt','x'.repeat(10001)),'IMPORT_CONTENT_TOO_LONG'],[file('bad.json','{}'),'IMPORT_FILE_INVALID'],[file('bad.json',JSON.stringify({schemaVersion:1,memories:[{title:'t',body:'b',personality:['不可推造']}]})),'IMPORT_FILE_INVALID'],[file('bad.exe','x'),'IMPORT_FILE_UNSUPPORTED'],[{name:'bad.txt',size:2,arrayBuffer:async()=>new Uint8Array([255,254]).buffer},'IMPORT_FILE_UNREADABLE']])await assert.rejects(h.api.prepare(f,person,1),e=>e.code===code)
})
test('file selection distinguishes actionable input problems before any save or recovery record',async()=>{
 const h=await client(()=>assert.fail('invalid files must not write')),person=randomUUID();let reads=0
 for(const [input,code] of [
  [{name:'old.docx',size:10,arrayBuffer:async()=>{reads++;throw Error('must not read')}},'IMPORT_FILE_UNSUPPORTED'],
  [{name:'empty.txt',size:0,arrayBuffer:async()=>{reads++;throw Error('must not read')}},'IMPORT_FILE_EMPTY'],
  [{name:'large.txt',size:512*1024+1,arrayBuffer:async()=>{reads++;throw Error('must not read')}},'IMPORT_FILE_TOO_LARGE'],
  [file('blank.txt',' \n\t '),'IMPORT_FILE_EMPTY'],
  [{name:'unavailable.txt',size:10,arrayBuffer:async()=>{throw Error('provider unavailable')}},'IMPORT_FILE_UNREADABLE'],
  [file('many.json',JSON.stringify({schemaVersion:1,memories:Array.from({length:51},(_,i)=>({title:'记忆'+i,body:'内容'}))})),'IMPORT_TOO_MANY_MEMORIES'],
  [file('long-total.json',JSON.stringify({schemaVersion:1,memories:Array.from({length:11},(_,i)=>({title:'memory'+i,body:'x'.repeat(10000)}))})),'IMPORT_TOTAL_TOO_LONG'],
 ])await assert.rejects(h.api.prepare(input,person,1),error=>error.code===code)
 assert.equal(reads,0);assert.equal(h.store.values.size,0)
 const valid=await h.api.prepare(file('后来选的.txt','这次选的是有效内容。'),person,1);assert.equal(valid.batch.items[0].body,'这次选的是有效内容。');assert.equal(h.store.values.size,0)
})
test('unknown import uses the exact persisted batch, items, person version and UUID after remount/new session',async()=>{
 const store=storage(),calls=[];let intent,lost=true
 const fetcher=async(path,init)=>{calls.push({path,...init});if(lost){lost=false;throw Error('Lost acceptance')};return response(receipt(intent))}
 const first=await client(fetcher,store);intent=await first.api.prepare(file('记忆.txt','原文'),randomUUID(),4);await assert.rejects(first.api.submit(intent));first.api.dispose();const second=await client(fetcher,store,{...first.scope,sessionId:randomUUID()});const pending=second.api.pending(intent.personId);assert.equal(pending.key,intent.key)
 await second.api.submit(pending);assert.equal(calls.length,2);assert.equal(calls[0].body,calls[1].body);assert.equal(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key']);assert.equal(calls[0].headers['If-Match'],'"v4"');assert.notEqual(calls[0].headers['X-Xijie-Expected-Session'],calls[1].headers['X-Xijie-Expected-Session']);assert.equal(store.values.size,0)
})
test('storage failures cannot write and foreign/error receipts cannot clear a pending original',async()=>{
 let calls=0,intent;const blocked=await client(()=>{calls++;assert.fail('must not write')},{getItem:()=>null,setItem(){throw Error()},removeItem(){}});intent=await blocked.api.prepare(file('记忆.txt','原文'),randomUUID(),1);await assert.rejects(blocked.api.submit(intent),e=>e.code==='RECOVERY_STORAGE_UNAVAILABLE');assert.equal(calls,0)
 let mode='foreign';const h=await client(async()=>{calls++;return mode==='401'?response('UNAUTHENTICATED',401):response({...receipt(intent),personId:randomUUID()})});await assert.rejects(h.api.submit(intent),e=>e.code==='INVALID_RESPONSE');const pending=[...h.store.values.values()][0];mode='401';await assert.rejects(h.api.submit(intent));assert.equal([...h.store.values.values()][0],pending)
})
test('a definitive CAS rejection retires only that intent; successful replay may acknowledge removed originals without recreating them',async()=>{
 let intent,stale=true;const h=await client(async()=>stale?response('VERSION_CONFLICT',412):response({...receipt(intent),items:receipt(intent).items.map(i=>({...i,status:'removed',version:2}))}));intent=await h.api.prepare(file('记忆.txt','原文'),randomUUID(),1);await assert.rejects(h.api.submit(intent),e=>e.code==='VERSION_CONFLICT');assert.equal(h.store.values.size,0);stale=false;intent={...intent,key:randomUUID(),personVersion:2};const result=await h.api.submit(intent);assert.equal(result.items[0].status,'removed');assert.equal(h.store.values.size,0)
})
test('late file parsing and mutation responses after disposal never persist or publish for another session',async()=>{
 let finish,entered;const ready=new Promise(r=>entered=r),wait=new Promise(r=>finish=r);const h=await client(()=>assert.fail('no mutation'));const raw=new TextEncoder().encode('合成原文');const preparing=h.api.prepare({name:'记忆.txt',size:raw.length,arrayBuffer(){entered();return wait}},randomUUID(),1);await ready;h.api.dispose();finish(raw.buffer);await assert.rejects(preparing,e=>e.name==='AbortError');assert.equal(h.store.values.size,0)
 let release,started;const began=new Promise(r=>started=r),reply=new Promise(r=>release=r);let changed=0,unauthorized=0;const c=await client(()=>{started();return reply},storage(),{accountId:randomUUID(),sessionId:randomUUID(),onChanged:()=>changed++,onUnauthorized:()=>unauthorized++}),intent=await c.api.prepare(file('记忆.txt','原文'),randomUUID(),1),sending=c.api.submit(intent);await began;c.api.dispose();release(response('UNAUTHENTICATED',401));await assert.rejects(sending,e=>e.name==='AbortError');assert.equal(changed,0);assert.equal(unauthorized,0);assert.equal(c.store.values.size,1)
})
