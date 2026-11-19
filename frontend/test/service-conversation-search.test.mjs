import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'
const compile=async name=>ts.transpileModule(await readFile(new URL('../src/'+name,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const [code,rowsCode]=await Promise.all([compile('serviceConversationSearch.ts'),compile('conversationList.ts')])
const response=(data,cursor=null,status=200)=>new Response(JSON.stringify(status===200?{data,meta:{nextCursor:cursor}}:{error:{code:data}}),{status})
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r))}
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
const hit=(extra={})=>{const id=randomUUID();return {kind:'message',id,messageId:id,personId:randomUUID(),conversationId:randomUUID(),sequence:'81',version:1,messageKind:'text',title:'合成人物',excerpt:'旧历史 literal % _ [x]',author:{kind:'self'},createdAt:'2026-11-01T00:00:00Z',lastActivityAt:'2026-11-13T00:00:00Z',...extra}}
async function harness(fetcher){
 let si=0,ri=0,ei=0,tid=0;const states=[],refs=[],effects=[],pending=[],timers=new Map(),listeners=new Map()
 class ConversationError extends Error {constructor(status,code){super(code);this.status=status;this.code=code}}
 const add=(n,f)=>{const a=listeners.get(n)??new Set();a.add(f);listeners.set(n,a)},remove=(n,f)=>listeners.get(n)?.delete(f)
 const context=vm.createContext({fetch:fetcher,Response,Headers,AbortController,URLSearchParams,window:{setTimeout(fn,ms){timers.set(++tid,{fn,ms});return tid},clearTimeout(id){timers.delete(id)},addEventListener:add,removeEventListener:remove},document:{visibilityState:'visible',addEventListener:add,removeEventListener:remove}})
 const synthetic=values=>new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v)},{context})
 const imports={react:synthetic({useState(v){const i=si++;if(!(i in states))states[i]=typeof v==='function'?v():v;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useRef(v){const i=ri++;return refs[i]??(refs[i]={current:v})},useEffect(fn,deps){const i=ei++,old=effects[i];if(!old||deps.some((v,j)=>v!==old.deps[j]))pending.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:fn()}})}}),'./serviceConversations':synthetic({ConversationError})}
 const module=new vm.SourceTextModule(code,{context});await module.link(n=>imports[n]);await module.evaluate()
 return {api:module.namespace,render(session,q,locale='zh-CN'){si=ri=ei=0;const result=module.namespace.useConversationSearch(session,q,locale);while(pending.length)pending.shift()();return result},start(){for(const [id,t]of [...timers])if(t.ms===180){timers.delete(id);t.fn()}},dispatch(n){for(const f of listeners.get(n)??[])f()},unmount(){effects.forEach(e=>e.cleanup?.())}}
}

test('history search reads every server page with literal query, locale and expected session; it never creates a conversation',async()=>{
 const a=hit(),b=hit(),paths=[],session=randomUUID()
 const h=await harness(async(path,init)=>{paths.push(path);assert.equal(init.headers['X-Xijie-Expected-Session'],session);assert.equal(init.method,undefined);const u=new URL(path,'http://synthetic');assert.equal(u.searchParams.get('q'),'literal % _ [x]');assert.equal(u.searchParams.get('locale'),'en');return response(u.searchParams.has('cursor')?[b]:[a],u.searchParams.has('cursor')?null:'page2')})
 const result=await h.api.readConversationSearch(session,' literal % _ [x] ','en',new AbortController().signal);assert.equal(result.length,2);assert.equal(paths.length,2);assert(paths.every(p=>p.startsWith('/v1/search?')))
})

test('photo placeholder search retains the server UUID and rejects photos attributed to a gathering or persona',async()=>{
 const photo=hit({messageKind:'photo',conversationKind:'direct',excerpt:'A photo'}),h=await harness(async()=>response([photo]))
 const result=await h.api.readConversationSearch(randomUUID(),'A photo','en',new AbortController().signal);assert.equal(result[0].messageId,photo.id);assert.equal(result[0].messageKind,'photo')
 for(const malformed of [{...photo,conversationKind:'gather',personId:null,worldId:randomUUID()},{...photo,author:{kind:'persona',displayName:'invalid',aiGenerated:true}}]){
  const bad=await harness(async()=>response([malformed]));await assert.rejects(bad.api.readConversationSearch(randomUUID(),'A photo','en',new AbortController().signal),e=>e.code==='INVALID_RESPONSE')
 }
})

test('SOURCE_CHANGED restarts the whole result group once, never mixing old and new hits',async()=>{
 const old=hit(),fresh=hit();let count=0
 const h=await harness(async()=>{count++;return count===1?response([old],'cursor'):count===2?response('SOURCE_CHANGED',null,409):response([fresh])})
 const result=await h.api.readConversationSearch(randomUUID(),'历史','zh-CN',new AbortController().signal);assert.equal(count,3);assert.equal(result.length,1);assert.equal(result[0].id,fresh.id)
})

test('changing query, account or permission fences late search responses and failures are not empty success',async()=>{
 const gates=[defer(),defer(),defer(),defer()];let index=0
 const h=await harness(()=>gates[index++].promise),a={accountId:randomUUID(),sessionId:randomUUID(),onUnauthorized(){}},b={...a,accountId:randomUUID(),sessionId:randomUUID()}
 h.render(a,'旧');h.start();await settle();h.render(a,'新');h.start();await settle();gates[0].resolve(response([hit()]));await settle();assert.equal(h.render(a,'新').status,'loading');assert.equal(h.render(a,'新').hits.length,0)
 h.render(b,'新');h.start();await settle();gates[1].resolve(response([hit()]));await settle();assert.equal(h.render(b,'新').hits.length,0)
 h.dispatch('xijie:consents-changed');await settle();gates[2].resolve(response([hit()]));await settle();assert.equal(h.render(b,'新').hits.length,0)
 gates[3].resolve(response('PERMISSION_REQUIRED',null,403));await settle();const view=h.render(b,'新');assert.equal(view.status,'error');assert.equal(view.hits.length,0);assert.equal(view.error,'PERMISSION_REQUIRED');h.unmount()
})

test('invalid Unicode and overlong queries never fetch; large history, repeat cursor and duplicate conversation hits fail explicitly',async()=>{
 let requests=0;const h=await harness(async()=>{requests++;return response([])})
 for(const q of ['','\u0000','\uD800','\uDC00','字'.repeat(161)])await assert.rejects(h.api.readConversationSearch('synthetic',q,'zh-CN',new AbortController().signal),e=>e.code==='INVALID_QUERY')
 assert.equal(requests,0)
 for(const mode of ['large','cycle','duplicate']){
  const one=hit();const x=await harness(async()=>mode==='large'?response('HISTORY_TOO_LARGE',null,413):mode==='cycle'?response([],'same'):response([one,hit({conversationId:one.conversationId})]))
  await assert.rejects(x.api.readConversationSearch('synthetic','历史','zh-CN',new AbortController().signal),e=>e.code===(mode==='large'?'HISTORY_TOO_LARGE':'INVALID_RESPONSE'))
 }
})

test('gather search keeps distinct world conversations despite null person IDs and requires real world UUIDs',async()=>{
 const a=hit({conversationKind:'gather',personId:null,worldId:randomUUID()}),b=hit({conversationKind:'gather',personId:null,worldId:randomUUID()})
 const h=await harness(async()=>response([a,b]));const rows=await h.api.readConversationSearch(randomUUID(),'历史','zh-CN',new AbortController().signal)
 assert.equal(rows.length,2);assert.equal(rows[0].conversationKind,'gather')
 for(const malformed of [{...a,worldId:null},{...a,personId:randomUUID()},{...a,conversationKind:'unknown'}]){
  const bad=await harness(async()=>response([malformed]));await assert.rejects(bad.api.readConversationSearch(randomUUID(),'历史','zh-CN',new AbortController().signal),e=>e.code==='INVALID_RESPONSE')
 }
})

test('empty-resident world rows preserve original titles and exact UUID anchors without searching cached summary text',async()=>{
 const context=vm.createContext({Date}),synthetic=values=>new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v)},{context})
 const imports={'./i18n':synthetic({WORLD_IDS:['courtyard'],fmtDuration:()=>'',fmtTime:()=> '12:00',isZh:()=>true}),'./conversationHistory':synthetic({exchanges:(items=[])=>items.filter(m=>m.kind!=='note')})}
 const module=new vm.SourceTextModule(rowsCode,{context});await module.link(n=>imports[n]);await module.evaluate()
 const world={id:randomUUID(),code:'courtyard',enabled:false},match=hit({conversationKind:'gather',personId:null,worldId:world.id,excerpt:'检索到的旧围坐',author:{kind:'persona',displayName:'曾在这里的人物',aiGenerated:true}})
 const summary={kind:'gather',conversationId:match.conversationId,personId:null,worldId:world.id,title:'庭院',lastActivityAt:match.lastActivityAt,lastMessage:{id:randomUUID(),preview:'只有摘要含针叶',createdAt:match.createdAt,author:match.author}}
 const t=(k,args)=>k==='world.courtyard'?'庭院':k==='gather.title'?'围坐 · '+args.world:k==='nav.me'?'我':k
 const rows=(q,hits=[],summaries=[summary])=>module.namespace.serviceConversationRows([],{},q,hits,t,'zh-CN',summaries,[world])
 assert.equal(rows('').length,1);assert.equal(rows('庭院').length,1);assert.equal(rows('针叶').length,0)
 for(const summaries of [[summary],[]]){const result=rows('旧围坐',[match],summaries);assert.equal(result.length,1);assert.equal(result[0].worldId,world.id);assert.equal(result[0].title,'围坐 · 庭院');assert.equal(result[0].anchor.messageId,match.messageId);assert.equal(result[0].anchor.conversationId,match.conversationId);assert.equal(result[0].preview,'曾在这里的人物：检索到的旧围坐')}
})

test('service rows merge metadata with message hits once per person and never search cached summary text',async()=>{
 const context=vm.createContext({Date}),synthetic=values=>new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v)},{context})
 const imports={'./i18n':synthetic({WORLD_IDS:['courtyard'],fmtDuration:()=>'',fmtTime:()=> '12:00',isZh:()=>true}),'./conversationHistory':synthetic({exchanges:(items=[])=>items.filter(m=>m.kind!=='note')})}
 const module=new vm.SourceTextModule(rowsCode,{context});await module.link(n=>imports[n]);await module.evaluate()
 const people=[{id:1,serverId:randomUUID(),name:'合成人物',realName:'旧称',relation:'朋友',world:'courtyard',greeting:''},{id:2,serverId:randomUUID(),name:'另一人',world:'courtyard',greeting:''}],chats={'1':[{id:2,kind:'me',text:'只有摘要含针叶',at:2,time:'00:00'}]},t=k=>k==='world.courtyard'?'庭院':k==='nav.me'?'我':k
 assert.equal(module.namespace.serviceConversationRows(people,chats,'针叶',[],t,'zh-CN').length,0)
 for(const q of ['旧称','朋友','庭院'])assert(module.namespace.serviceConversationRows(people,chats,q,[],t,'zh-CN').length>0)
 const match=hit({personId:people[0].serverId,excerpt:'合成人物提过的往事'})
 const rows=module.namespace.serviceConversationRows(people,chats,'合成人物',[match],t,'zh-CN');assert.equal(rows.length,1);assert.equal(rows[0].anchor.messageId,match.messageId);assert.equal(rows[0].preview,'我：合成人物提过的往事');assert.equal(rows[0].messageId,undefined)
})

test('the actual Home summary effect clears cached previews on server denial and fences a prior permission read',async()=>{
 const app=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('App.tsx',app,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let effect
 function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'&&node.arguments[0]?.getText(ast).includes('void readConversationSummaries('))effect=node.arguments[0].getText(ast);ts.forEachChild(node,visit)}visit(ast);assert(effect)
 const compiled=ts.transpileModule('const effect = '+effect,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText
 let chats={synthetic:[{kind:'me',text:'旧私有摘要'}]},denied=true,gate=defer(),calls=0
 class ConversationError extends Error{constructor(status){super('denied');this.status=status}}
 const listeners=new Map(),add=(n,f)=>listeners.set(n,f),remove=n=>listeners.delete(n)
 const context=vm.createContext({AbortController,Date,serviceSessionId:'synthetic',peopleLoad:'ready',route:{s:'home'},lang:'zh-CN',summariesRead:{current:null},peopleIds:{current:new Map()},readConversationSummaries:()=>{calls++;return denied?Promise.reject(new ConversationError(403)):gate.promise},readConversationWorlds:async()=>[],setConversationWorlds(){},setConversationSummaries(){},ConversationError,PeopleReadError:class extends Error{},setChats:value=>{chats=value},fmtTime:()=>'',nid:()=>1,refreshIdentity(){},isZh:()=>true,serviceNoticeTimer:{current:0},setServiceNotice(){},window:{setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},addEventListener:add,removeEventListener:remove},document:{visibilityState:'visible',addEventListener:add,removeEventListener:remove}})
 const cleanup=vm.runInContext(compiled+'\neffect()',context);await settle();assert.equal(Object.keys(chats).length,0)
 denied=false;listeners.get('focus')();await settle();chats={synthetic:[{kind:'me',text:'旧摘要'}]};denied=true;listeners.get('xijie:consents-changed')();await settle();assert.equal(Object.keys(chats).length,0)
 gate.resolve([{personId:'synthetic',lastMessage:{id:randomUUID(),preview:'迟到旧摘要',createdAt:'2026-11-13T00:00:00Z'}}]);await settle();assert.equal(Object.keys(chats).length,0);assert.equal(calls,3);cleanup()
})
