import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React}}).outputText
const code=compile(await readFile(new URL('../src/serviceLetters.ts',import.meta.url),'utf8'))
const response=(data,nextCursor=null)=>new Response(JSON.stringify({data,meta:{nextCursor}}))
const error=(status,code)=>new Response(JSON.stringify({error:{code}}),{status})
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
const settle=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r))}
const actor=()=>({accountId:randomUUID(),sessionId:randomUUID(),personId:randomUUID(),onUnauthorized(){}})
const letter=(personId,extra={})=>({id:randomUUID(),personId,clientLetterId:randomUUID(),body:'专用合成原信',replyMode:'none',createdAt:'2026-11-13T00:00:00.000Z',version:1,unread:false,...extra})
const reply=(sequence)=>({id:randomUUID(),body:'专用真实来源回信',sequence:String(sequence),createdAt:'2026-11-13T01:00:00.000Z',aiGenerated:true})
async function load(fetcher,storage=new Map()){
 let uid=0,si=0,ri=0,ei=0,mi=0;const states=[],refs=[],effects=[],memos=[],pending=[],listeners=new Map()
 const add=(n,f)=>{const items=listeners.get(n)??new Set();items.add(f);listeners.set(n,items)},remove=(n,f)=>listeners.get(n)?.delete(f)
 const context=vm.createContext({fetch:fetcher,Headers,Response,AbortController,DOMException,URLSearchParams,TextEncoder,Intl,Date,crypto:globalThis.crypto,setTimeout,clearTimeout,sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},window:{setInterval:()=>1,clearInterval(){},addEventListener:add,removeEventListener:remove},document:{visibilityState:'visible',addEventListener:add,removeEventListener:remove}})
 const synthetic=values=>new vm.SyntheticModule(Object.keys(values),function(){for(const [key,value]of Object.entries(values))this.setExport(key,value)},{context})
 const imports={react:synthetic({useState(v){const i=si++;if(!(i in states))states[i]=typeof v==='function'?v():v;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useRef(v){return refs[ri]??(refs[ri++]={current:v})},useMemo(fn,deps){const i=mi++,old=memos[i];if(!old||deps.some((v,j)=>v!==old.deps[j]))memos[i]={deps,value:fn()};return memos[i].value},useEffect(fn,deps){const i=ei++,old=effects[i];if(!old||deps.some((v,j)=>v!==old.deps[j]))pending.push(()=>{old?.cleanup?.();effects[i]={deps,fn,cleanup:fn()}})}}),'./i18n':synthetic({fmtDate:()=> '2026年11月13日'}),'./model':synthetic({nid:()=>++uid})}
 const module=new vm.SourceTextModule(code,{context});await module.link(n=>imports[n]);await module.evaluate()
 return {api:module.namespace,storage,render(value){si=ri=ei=mi=0;const result=module.namespace.useServiceLetters(value);while(pending.length)pending.shift()();return result},dispatch(n){for(const f of listeners.get(n)??[])f()},strictReplay(){effects.forEach(e=>e.cleanup?.());effects.forEach(e=>e.cleanup=e.fn())},unmount(){effects.forEach(e=>e.cleanup?.())}}
}

test('none saves only the original letter; now and morning preserve the selected mode and IANA zone',async()=>{
 const a=actor(),requests=[]
 const h=await load(async(path,init)=>{requests.push({path,init});if(!init.method)return response([]);const input=JSON.parse(init.body);return response(letter(a.personId,{...input,...(input.replyMode!=='none'?{replyJobId:randomUUID(),replyJobState:'queued',replyAt:'2026-11-14T00:00:00Z'}:{})}))})
 const service=h.api.createLetterService(a,()=>{})
 for(const draft of [{text:'不回信',wantReply:false,when:'morning'},{text:'即刻回信',wantReply:true,when:'now'},{text:'预约回信',wantReply:true,when:'morning'}]){service.saveDraft(draft);const saved=await service.send(draft);assert.equal(saved.body,draft.text);assert.equal(service.pending(),undefined)}
 const posts=requests.filter(x=>x.init.method==='POST');assert.equal(posts.length,3);assert.deepEqual(posts.map(x=>JSON.parse(x.init.body).replyMode),['none','now','next_morning']);assert.equal(JSON.parse(posts[0].init.body).timeZone,undefined);assert.equal(typeof JSON.parse(posts[2].init.body).timeZone,'string');assert(posts.every(x=>x.init.headers.get('X-Xijie-Expected-Session')===a.sessionId));assert(requests.every(x=>x.path.startsWith('/v1/persons/'+a.personId+'/letters')));service.dispose()
})

test('lost acceptance persists the full immutable intent across refresh and retries the same key rather than a second letter',async()=>{
 const a=actor(),storage=new Map(),posts=[];let saved,lose=true
 const fetcher=async(path,init)=>{if(!init.method)return response(saved?[saved]:[]);const body=JSON.parse(init.body);posts.push({key:init.headers.get('Idempotency-Key'),body});saved??=letter(a.personId,{...body,replyJobId:randomUUID(),replyJobState:'queued',replyAt:'2026-11-14T00:00:00Z'});if(lose){lose=false;throw new TypeError('response lost')}return response(saved)}
 const h=await load(fetcher,storage),first=h.api.createLetterService(a,()=>{}),draft={text:'不应重复的合成原信',wantReply:true,when:'morning'};first.saveDraft(draft);await assert.rejects(first.send(draft));const intent=first.pending();assert(intent);first.dispose()
 const second=h.api.createLetterService(a,()=>{});assert.equal(second.draft().text,draft.text);second.saveDraft({text:'不能替换未知请求',wantReply:false,when:'now'});assert.equal(second.draft().text,draft.text)
 const result=await second.send({text:'新输入不能覆盖未知操作',wantReply:false,when:'now'});assert.equal(result.id,saved.id);assert.equal(posts.length,2);assert.deepEqual(posts[0],posts[1]);assert.equal(second.pending(),undefined);assert.equal(second.draft().text,'');assert(![...storage.keys()].some(k=>k.endsWith('.intent')));second.dispose()
})

test('authorization and conflict errors retain unknown identity; only INVALID_ARGUMENT releases it while preserving the draft',async()=>{
 for(const [status,value,retained]of [[403,'LETTER_REPLY_PERMISSION_REQUIRED',true],[401,'UNAUTHORIZED',true],[409,'AUTHORIZATION_CHANGED',true],[409,'IDEMPOTENCY_CONFLICT',true],[400,'INVALID_ARGUMENT',false]]){
  const a=actor(),h=await load(async()=>error(status,value)),s=h.api.createLetterService(a,()=>{}),draft={text:'合成草稿',wantReply:true,when:'now'};s.saveDraft(draft);await assert.rejects(s.send(draft));assert.equal(!!s.pending(),retained);assert.equal(s.draft().text,draft.text);s.dispose()
 }
})

test('a linked intent survives ambiguous failures and a definite stale source leaves an editable original',async()=>{
 const a=actor(),storage=new Map(),sourceMemory={id:randomUUID(),version:2},posts=[]
 let outcome='lost'
 const h=await load(async(path,init)=>{
  if(!init.method)return response([])
  const body=JSON.parse(init.body);posts.push({key:init.headers.get('Idempotency-Key'),body})
  if(outcome==='lost')throw new TypeError('response lost')
  if(outcome==='stale')return error(409,'LETTER_MEMORY_SOURCE_CHANGED')
  return response(letter(a.personId,{...body,...(outcome==='wrong' ? {sourceMemory:{...sourceMemory,version:3}} : {})}))
 },storage)
 const draft={text:'合成原信留作独立书信',wantReply:false,when:'now',sourceMemory}
 const first=h.api.createLetterService(a,()=>{});first.saveDraft(draft);await assert.rejects(first.send(draft));first.dispose()
 const second=h.api.createLetterService(a,()=>{});assert.equal(second.draft().sourceMemory.version,2)
 outcome='wrong';await assert.rejects(second.send(second.draft()),{code:'INVALID_LETTER_RESPONSE'});assert(second.pending())
 outcome='stale';await assert.rejects(second.send(second.draft()),{code:'LETTER_MEMORY_SOURCE_CHANGED'});assert.equal(second.pending(),undefined);second.dispose()
 assert.deepEqual(posts[0].body.sourceMemory,sourceMemory);assert.deepEqual(posts[0],posts[1]);assert.deepEqual(posts[1],posts[2])
 const third=h.api.createLetterService(a,()=>{});assert.equal(third.draft().text,draft.text)
 outcome='ok';const independent={...third.draft(),sourceMemory:undefined};third.saveDraft(independent)
 const saved=await third.send(independent);assert.equal(saved.sourceMemory,undefined);assert.notEqual(posts[2].key,posts[3].key);assert.equal(third.draft().text,'');third.dispose()
})

test('an accepted server time-zone alias is equivalent to the captured original zone and does not strand the intent',async()=>{
 const a=actor(),storage=new Map(),clientLetterId=randomUUID(),input={clientLetterId,body:'合成时区原信',replyMode:'next_morning',timeZone:'Asia/Kolkata'}
 storage.set('xijie.letter.'+a.accountId+'.'+a.personId+'.intent',JSON.stringify({key:clientLetterId,body:input}))
 const h=await load(async(path,init)=>init.method?response(letter(a.personId,{...input,timeZone:'Asia/Calcutta',replyJobId:randomUUID(),replyJobState:'queued',replyAt:'2026-11-14T02:30:00Z'})):response([]),storage)
 const s=h.api.createLetterService(a,()=>{});const saved=await s.send(s.draft());assert.equal(saved.timeZone,'Asia/Calcutta');assert.equal(s.pending(),undefined);s.dispose()
})

test('no partial page group is displayed or acknowledged; highest reply sequence can belong to an older original letter',async()=>{
 const a=actor(),gate=defer(),posts=[],first=letter(a.personId,{replyMode:'now',replyJobState:'succeeded',reply:reply('9'),unread:true}),older=letter(a.personId,{createdAt:'2026-11-01T00:00:00Z',replyMode:'now',replyJobState:'succeeded',reply:reply('100000000000000001'),unread:true})
 const h=await load(async(path,init)=>{if(init.method){posts.push(JSON.parse(init.body));return response({lastReadReplyId:older.reply.id,readAt:'2026-11-13T02:00:00Z'})}return path.includes('cursor=')?gate.promise:response([first],'older')})
 const s=h.api.createLetterService(a,()=>{}),loading=s.refresh();await settle();assert.equal(s.snapshot.status,'loading');assert.equal(s.snapshot.records.length,0);await s.markRead(s.snapshot);assert.equal(posts.length,0)
 gate.resolve(response([older]));await loading;assert.equal(s.snapshot.status,'ready');assert.equal(s.snapshot.records.length,2);await s.markRead(s.snapshot);assert.equal(posts.length,1);assert.equal(posts[0].throughReplyId,older.reply.id);assert(s.snapshot.records.every(l=>!l.unread));s.dispose()
})

test('a reply arriving during ACK is not cleared by an older displayed range, even if server returns a higher read cursor',async()=>{
 const a=actor(),ack=defer(),old=letter(a.personId,{replyMode:'now',replyJobState:'succeeded',reply:reply(1),unread:true}),fresh=letter(a.personId,{replyMode:'now',replyJobState:'succeeded',reply:reply(2),unread:true});let later=false
 const h=await load(async(path,init)=>init.method?ack.promise:response(later?[fresh,old]:[old])),s=h.api.createLetterService(a,()=>{})
 await s.refresh();const shown=s.snapshot,mark=s.markRead(shown);later=true;await s.refresh();ack.resolve(response({lastReadReplyId:fresh.reply.id,readAt:'2026-11-13T02:00:00Z'}));await mark
 assert.equal(s.snapshot.records.find(l=>l.id===fresh.id).unread,true);assert.equal(s.snapshot.records.find(l=>l.id===old.id).unread,false);s.dispose()
})

test('unknown read acknowledgements retain their original key across remount and do not loop before another complete read',async()=>{
 const a=actor(),storage=new Map(),posts=[],row=letter(a.personId,{replyMode:'now',replyJobState:'succeeded',reply:reply(1),unread:true});let lost=true
 const h=await load(async(path,init)=>{if(!init.method)return response([row]);posts.push({key:init.headers.get('Idempotency-Key'),body:JSON.parse(init.body)});if(lost){lost=false;throw Error('unknown ACK')}return response({lastReadReplyId:row.reply.id,readAt:'2026-11-13T02:00:00Z'})},storage)
 const first=h.api.createLetterService(a,()=>{});await first.refresh();await first.markRead(first.snapshot);assert(first.snapshot.readError);assert.equal(first.snapshot.records[0].unread,true);await first.markRead(first.snapshot);assert.equal(posts.length,1);first.dispose()
 const second=h.api.createLetterService(a,()=>{});await second.refresh();await second.markRead(second.snapshot);assert.deepEqual(posts[0],posts[1]);assert.equal(second.snapshot.records[0].unread,false);second.dispose()
})

test('a late read ACK after letter storage withdrawal cannot resurrect content or clear another scope',async()=>{
 const a=actor(),gate=defer(),row=letter(a.personId,{replyMode:'now',replyJobState:'succeeded',reply:reply(1),unread:true});let denied=false
 const h=await load(async(path,init)=>init.method?gate.promise:denied?error(403,'LETTER_STORAGE_PERMISSION_REQUIRED'):response([row])),s=h.api.createLetterService(a,()=>{})
 await s.refresh();const marking=s.markRead(s.snapshot);denied=true;s.invalidate();gate.resolve(response({lastReadReplyId:row.reply.id,readAt:'2026-11-13T02:00:00Z'}));await marking;await settle();assert.equal(s.snapshot.records.length,0);assert.equal(s.snapshot.status,'error');s.dispose()
})

test('server permission denial without a browser consent event clears cached letters and fences an older successful read',async()=>{
 const a=actor(),gate=defer(),row=letter(a.personId,{replyMode:'now',replyJobState:'succeeded',reply:reply(1),unread:true});let delayed=false
 const h=await load(async(path,init)=>init.method?error(403,'LETTER_STORAGE_PERMISSION_REQUIRED'):delayed?gate.promise:response([row])),s=h.api.createLetterService(a,()=>{})
 await s.refresh();delayed=true;const reading=s.refresh();await s.markRead(s.snapshot); // A loading page is never acknowledged.
 await assert.rejects(s.send({text:'被拒绝但保留的原信',wantReply:false,when:'now'}));assert.equal(s.snapshot.records.length,0);assert.equal(s.snapshot.status,'error')
 gate.resolve(response([row]));await reading;assert.equal(s.snapshot.records.length,0);assert(s.pending());s.dispose()
})

test('SOURCE_CHANGED discards the whole group; cyclic, duplicate and over-budget histories never publish a partial success',async()=>{
 const a=actor(),old=letter(a.personId),fresh=letter(a.personId);let calls=0
 const h=await load(async()=>{calls++;return calls===1?response([old],'page2'):calls===2?error(409,'SOURCE_CHANGED'):response([fresh])}),s=h.api.createLetterService(a,()=>{})
 await s.refresh();assert.equal(calls,3);assert.equal(s.snapshot.records.length,1);assert.equal(s.snapshot.records[0].id,fresh.id);s.dispose()
 for(const mode of ['cycle','duplicate','budget','bytes']){
  let page=0;const duplicate=letter(a.personId)
  const x=await load(async()=>{page++;return mode==='cycle'?response([],'same'):mode==='duplicate'?response([duplicate,duplicate]):mode==='bytes'?response(Array.from({length:100},()=>letter(a.personId,{body:'字'.repeat(10000)})),'p'+page):response(Array.from({length:100},()=>letter(a.personId)),'p'+page)})
  const service=x.api.createLetterService(a,()=>{});await service.refresh();assert.equal(service.snapshot.status,'error');assert.equal(service.snapshot.records.length,0);assert(page<=10);service.dispose()
 }
})

test('permission invalidation clears existing letters and fences delayed reads, accepted writes and unread acknowledgement',async()=>{
 const a=actor(),write=defer(),late=defer();let denied=false,delayed=false
 const row=letter(a.personId,{replyMode:'now',replyJobState:'succeeded',reply:reply(1),unread:true})
 const h=await load(async(path,init)=>init.method?write.promise:denied?error(403,'LETTER_STORAGE_PERMISSION_REQUIRED'):delayed?late.promise:response([row])),s=h.api.createLetterService(a,()=>{})
 await s.refresh();assert.equal(s.snapshot.records.length,1);delayed=true;const reading=s.refresh();const sending=s.send({text:'合成迟到原信',wantReply:false,when:'now'});const pending=s.pending();denied=true;s.invalidate();assert.equal(s.snapshot.records.length,0)
 late.resolve(response([row]));write.resolve(response(letter(a.personId,{...pending.body})));await reading;await assert.rejects(sending,e=>e.name==='AbortError');await settle();assert.equal(s.snapshot.records.length,0);assert(s.pending());s.dispose()
})

test('session/person changes and StrictMode effect replay cannot revive old content or disable the live service',async()=>{
 const a=actor(),gate=defer();let delayed=true
 const h=await load(async path=>delayed?gate.promise:response([]));h.render(a);delayed=false;h.strictReplay();h.dispatch('focus');await settle();let view=h.render(a);assert.equal(view.snapshot.status,'ready')
 const b={...a,sessionId:randomUUID(),personId:randomUUID()};view=h.render(b);assert.equal(view.snapshot.records.length,0);await settle();gate.resolve(response([letter(a.personId)]));await settle();view=h.render(b);assert.equal(view.snapshot.status,'ready');assert.equal(view.snapshot.records.length,0);h.unmount()
})

test('malformed or template-like reply provenance, foreign letters and false success states are rejected',async()=>{
 const a=actor(),h=await load(async()=>response([])),valid=letter(a.personId)
 for(const value of [{...valid,personId:randomUUID()},{...valid,replyMode:'now',reply:{...reply(1),aiGenerated:false}},{...valid,replyJobState:'succeeded'},{...valid,unread:true}])assert.throws(()=>h.api.validateLetter(value,a.personId))
})

test('the actual App template timer exits before reading or scheduling any service-account letter',async()=>{
 const source=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let effect
 function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'&&node.arguments[0]?.getText(ast).includes('reply: letterReply('))effect=node.arguments[0].getText(ast);ts.forEachChild(node,visit)}visit(ast);assert(effect)
 let writes=0,timers=0;const context=vm.createContext({serviceMode:true,setPeople(){writes++},window:{setInterval(){timers++}},clearInterval(){}})
 vm.runInContext(compile('const effect='+effect)+'\neffect()',context);assert.equal(writes,0);assert.equal(timers,0)
})
