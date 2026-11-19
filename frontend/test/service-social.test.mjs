import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'

const json=(data,nextCursor=null)=>new Response(JSON.stringify({data,meta:{nextCursor}}),{headers:{'Content-Type':'application/json'}})
const denied=(status,code)=>new Response(JSON.stringify({error:{code}}),{status})
const defer=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
const settle=()=>new Promise(resolve=>setImmediate(resolve))
const now='2026-11-12T06:00:00.000Z'
const makePost=(extra={})=>({id:randomUUID(),kind:'user',author:{kind:'self'},body:'合成用户动态',mediaIds:[],reactionCount:0,commentCount:0,reactedByMe:false,reactionPreview:[],commentPreview:[],createdAt:now,version:1,...extra})
const makeComment=(postId,extra={})=>({id:randomUUID(),postId,author:{kind:'self'},body:'合成手动评论',createdAt:now,version:1,...extra})
const makeContext=()=>({accountId:randomUUID(),sessionId:randomUUID(),onUnauthorized(){}})
const echoFixture=()=>{
 const personId=randomUUID(),memoryId=randomUUID(),card={id:randomUUID(),code:'tide',displayName:'生成当时的回廊',enabled:false,catalogVersion:3}
 const author={kind:'persona',personId,displayName:'生成时的称呼',aiGenerated:true},excerpt='合成原文：我们曾在河边一起照顾盆栽。'
 const item=makePost({kind:'memory_echo',author,personId,worldId:card.id,worldSnapshot:card,sourceMemoryId:memoryId,sourceMemoryVersion:4,sourceMemory:{personId,memoryId,version:4,excerpt},body:'合成模型回响正文'})
 const person={id:520,serverId:personId,name:'如今的称呼',world:'courtyard',memories:[{id:90,serverId:memoryId,serverVersion:4,body:excerpt+'其余内容。'}]}
 return {item,person,author,excerpt}
}
const sources={}
for(const file of ['serviceSocial.ts','serviceMedia.ts','moments.tsx','PrivatePhoto.tsx'])sources[file]=ts.transpileModule(await readFile(new URL('../src/'+file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText
const uiSource=ts.createSourceFile('ui.tsx',await readFile(new URL('../src/ui.tsx',import.meta.url),'utf8'),ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX)
const toastSource=uiSource.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='Toast').getText(uiSource)
sources['toast.tsx']=ts.transpileModule(toastSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText

// The real adapter/components run against isolated hook lifetimes and controlled
// transport acknowledgements. These checks do not claim real browser acceptance.
async function harness(file,fetcher=()=>{throw Error('Unexpected request')},storage=new Map(),options={}){
 let current;const fibers=new Map(),effects=[],haptics=[],timers=new Map();let uid=100,afterUnmount=0,timerId=0
 const later=options.fakeTimers?(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id}:setTimeout
 const cancel=options.fakeTimers?id=>timers.delete(id):clearTimeout
 const listeners=new Map(),objectURLs=[],revokedURLs=[]
 class BrowserURL extends URL {static createObjectURL(blob){const value='blob:synthetic-'+objectURLs.length;objectURLs.push({value,blob});return value}static revokeObjectURL(value){revokedURLs.push(value)}}
 const runtime=vm.createContext({fetch:(...args)=>fetcher(...args),crypto:globalThis.crypto,Headers,Response,Blob,atob,btoa,URL:BrowserURL,AbortController,AbortSignal,DOMException,URLSearchParams,TextEncoder,console,setTimeout:later,clearTimeout:cancel,
  ...(options.observer?{IntersectionObserver:options.observer}:{}),
  window:{setTimeout:later,clearTimeout:cancel,addEventListener:(name,fn)=>{const set=listeners.get(name)??new Set();set.add(fn);listeners.set(name,set)},removeEventListener:(name,fn)=>listeners.get(name)?.delete(fn)},sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}})
 const synthetic=(names,values)=>new vm.SyntheticModule(names,function(){for(const name of names)this.setExport(name,values[name])},{context:runtime})
 const react=synthetic(['useState','useRef','useMemo','useEffect','useContext'],{
  useState(initial){const fiber=current,index=fiber.stateIndex++;if(!(index in fiber.states))fiber.states[index]=typeof initial==='function'?initial():initial;return [fiber.states[index],value=>{if(fiber.unmounted)afterUnmount++;fiber.states[index]=typeof value==='function'?value(fiber.states[index]):value}]},
  useRef(initial){const index=current.refIndex++;return current.refs[index]??(current.refs[index]={current:initial})},
  useMemo(fn,deps){const index=current.memoIndex++,old=current.memos[index];if(!old||deps.some((value,i)=>value!==old.deps[i]))current.memos[index]={deps:[...deps],value:fn()};return current.memos[index].value},
  useEffect(fn,deps){const fiber=current,index=fiber.effectIndex++,old=fiber.effects[index];if(!old||!deps||deps.some((value,i)=>value!==old.deps[i]))effects.push(()=>{old?.cleanup?.();fiber.effects[index]={deps:deps?[...deps]:null,cleanup:fn()}})},
  useContext:()=>false,
 })
 const jsx=(type,props,key)=>({type,props:props??{},key})
 const i18n=synthetic(['WORLD_IDS','isZh','useI18n'],{WORLD_IDS:['courtyard','tide','isles'],isZh:()=>true,useI18n:()=>({lang:'zh-CN',t:key=>key})})
 const modules={react,'./i18n':i18n,'react/jsx-runtime':synthetic(['jsx','jsxs','Fragment'],{jsx,jsxs:jsx,Fragment:'Fragment'}),
  './model':synthetic(['nid','fileToDataUrl'],{nid:()=>++uid,fileToDataUrl:async()=> 'data:synthetic'}),
  './worlds':synthetic(['WORLDS','WorldScene'],{WORLDS:Object.fromEntries(['courtyard','tide','isles'].map((code,index)=>[code,{code:'ELY-'+index,glow:'',thumb:''}])) ,WorldScene:'WorldScene'}),
  './fx':synthetic(['DeepField','Lens'],{DeepField:'DeepField',Lens:'Lens'}),
  './ui':synthetic(['I','NightCtx','Sheet','Toast','haptic','useStatusTone'],{I:new Proxy({},{get:(_,key)=>'Icon'+String(key)}),NightCtx:{},Sheet:'Sheet',Toast:'Toast',haptic:value=>haptics.push(value),useStatusTone:()=>{}}),
  './gifts/PersonalGiftScene':synthetic(['PersonalGiftScene'],{PersonalGiftScene:'PersonalGiftScene'}),
  './gifts/ReceivedGiftsShelf':synthetic(['ReceivedGiftsShelf'],{ReceivedGiftsShelf:'ReceivedGiftsShelf'}),
  './mobile/back':synthetic(['useNativeBack'],{useNativeBack:()=>{}}),
  './moments-theme.css':synthetic([],{}),
  './PrivatePhoto':synthetic(['PrivatePhoto'],{PrivatePhoto:'PrivatePhoto'}),
  './ContentReports':synthetic(['useContentReports'],{useContentReports:()=>options.reports}),
 }
 const mediaModule=new vm.SourceTextModule(sources['serviceMedia.ts'],{context:runtime});await mediaModule.link(spec=>Promise.reject(new Error('Unexpected media runtime import '+spec)));await mediaModule.evaluate()
 modules['./serviceMedia']=file==='moments.tsx'?synthetic(['socialPhotoDataUrl'],{socialPhotoDataUrl:options.photoReader??(async()=> 'data:synthetic')}):mediaModule
 const module=new vm.SourceTextModule(sources[file],{context:runtime})
 await module.link(spec=>modules[spec]??Promise.reject(new Error('Unexpected runtime import '+spec)));await module.evaluate()
 function render(fn,args,flush=true){
  let fiber=fibers.get(fn);if(!fiber){fiber={states:[],refs:[],memos:[],effects:[],unmounted:false};fibers.set(fn,fiber)}
  current=fiber;Object.assign(fiber,{stateIndex:0,refIndex:0,memoIndex:0,effectIndex:0});const value=fn(...args);if(flush)while(effects.length)effects.shift()();return value
 }
 const exported=file==='serviceSocial.ts'?'useServiceSocial':file==='toast.tsx'?'Toast':file==='PrivatePhoto.tsx'?'PrivatePhoto':'Moments'
 return {storage,haptics,objectURLs,revokedURLs,get afterUnmount(){return afterUnmount},render(...args){return render(module.namespace[exported],args)},renderType(fn,props){return render(fn,[props])},renderWithoutEffects(...args){return render(module.namespace[exported],args,false)},flushEffects(){while(effects.length)effects.shift()()},dispatch(name){for(const fn of [...(listeners.get(name)??[])])fn()},
  fireTimers(delay){for(const [id,timer] of [...timers])if(timer.delay===delay){timers.delete(id);timer.fn()}},
  unmount(){for(const fiber of fibers.values()){fiber.unmounted=true;fiber.effects.forEach(effect=>effect?.cleanup?.())}},api:module.namespace,mediaApi:mediaModule.namespace}
}
function nodes(value){if(!value||typeof value!=='object')return [];if(Array.isArray(value))return value.flatMap(nodes);const result=value.type?[value]:[];if(value.props)for(const child of Object.values(value.props))if(typeof child!=='function')result.push(...nodes(child));return result}
const find=(tree,predicate)=>{const result=nodes(tree).find(predicate);assert(result,'Expected original component/control');return result}
const composer=tree=>find(tree,node=>typeof node.type==='function'&&node.type.name==='Composer')

test('full feed and full comment pagination retain stable UUID mappings instead of displaying previews as complete',async()=>{
 const a=makePost({commentCount:5}),b=makePost(),comments=Array.from({length:5},(_,i)=>makeComment(a.id,{body:'评论'+i}));a.commentPreview=comments.slice(2)
 const requests=[],h=await harness('serviceSocial.ts',async(route,init)=>{
  requests.push({route,init});const query=new URL(route,'http://local').searchParams
  if(route.startsWith('/v1/feed?'))return query.has('cursor')?json([b]):json([a],'feed-next')
  if(route.startsWith('/v1/posts/'+a.id+'/comments?'))return query.has('cursor')?json(comments.slice(2)):json(comments.slice(0,2),'comments-next')
  throw Error('Unexpected route')
 }),ctx=makeContext()
 let state=h.render(ctx,[]);await state.service.refresh();state=h.render(ctx,[])
 assert.equal(state.posts.length,2);assert.equal(state.posts.find(p=>p.serverId===a.id).comments.length,5)
 const ids=Object.fromEntries(state.posts.map(p=>[p.serverId,p.id]));await state.service.refresh();state=h.render(ctx,[])
 assert.deepEqual(Object.fromEntries(state.posts.map(p=>[p.serverId,p.id])),ids)
 assert(requests.every(({init})=>init.credentials==='same-origin'&&init.cache==='no-store'&&init.headers.get('X-Xijie-Expected-Session')===ctx.sessionId))
 h.unmount()
})

test('a committed relocation uses its historical target and associated person, never a generated-memory label',async()=>{
 const personId=randomUUID(),from={id:randomUUID(),code:'courtyard',displayName:'旧院',enabled:false,catalogVersion:1},to={id:randomUUID(),code:'tide',displayName:'当时的回廊',enabled:false,catalogVersion:2},movement={id:randomUUID(),personId,personName:'合成人物',worldVersion:2,reality:'virtual',branch:'main',fromWorld:from,toWorld:to,occurredAt:now,recordedAt:now}
 const item=makePost({kind:'world_notice',author:{kind:'system',worldId:to.id},worldId:to.id,personId,sourceMovementId:movement.id,worldMovement:movement})
 const h=await harness('serviceSocial.ts',async()=>json([item])),ctx=makeContext(),people=[{id:510,serverId:personId,name:'现在的称呼',world:'courtyard'}]
 let state=h.render(ctx,people);await state.service.refresh();state=h.render(ctx,people)
 assert.equal(state.posts[0].kind,'movement');assert.equal(state.posts[0].world,'tide');assert.equal(state.posts[0].author,'world:tide');assert.equal(state.posts[0].authorName,'当时的回廊');assert.equal(state.posts[0].relatedPersonId,510)
 state=h.render(ctx,[]);state=h.render(ctx,[]);assert.equal(state.posts.length,0,'Local removed-person view must not retain the projection')
 h.unmount()
})

test('lost publish acknowledgement reuses both identities across remount, rejects malformed photos locally, and never stores draft text',async()=>{
 const item=makePost({body:'独立合成私密文字'}),ctx=makeContext(),calls=[],storage=new Map();let posts=0
 const transport=async(route,init)=>{assert.equal(route,'/v1/posts');calls.push({key:init.headers.get('Idempotency-Key'),body:JSON.parse(init.body)});if(++posts===1)throw new TypeError('Lost acknowledgement');return json(item)}
 let h=await harness('serviceSocial.ts',transport,storage),state=h.render(ctx,[])
 assert.equal(await state.service.post('独立合成私密文字',[]),false);assert.equal(h.render(ctx,[]).posts.length,0)
 assert(![...storage].some(([key,value])=>key.includes('独立合成私密文字')||value.includes('独立合成私密文字')))
 h.unmount();h=await harness('serviceSocial.ts',transport,storage);state=h.render(ctx,[])
 assert.equal(await state.service.post('独立合成私密文字',[]),true)
 assert.equal(calls[0].key,calls[1].key);assert.equal(calls[0].body.clientPostId,calls[1].body.clientPostId)
 assert.equal(h.render(ctx,[]).posts.length,1)
 assert.equal(await state.service.post('图片草稿',['data:synthetic']),false);assert.equal(calls.length,2);assert.match(h.render(ctx,[]).notice,/文字与照片已保留/)
 assert.equal(await state.service.post('独立合成私密文字',[]),true);assert.notEqual(calls[1].key,calls[2].key,'A deliberate new confirmed post gets a new intent')
 h.unmount()
})

test('likes are confirmed desired states, block duplicate taps, and preserve the retry key after an unknown result',async()=>{
 const item=makePost(),ctx=makeContext(),wait=defer(),entered=defer(),calls=[];let puts=0
 const h=await harness('serviceSocial.ts',async(route,init)=>{
  if(route.startsWith('/v1/feed?'))return json([item])
  const body=JSON.parse(init.body);calls.push({body,key:init.headers.get('Idempotency-Key')});puts++
  if(puts===1){entered.resolve();await wait.promise;throw Error('Lost like acknowledgement')}
  return json({active:body.active,reactionCount:body.active?1:0,postVersion:puts})
 })
 let state=h.render(ctx,[]);await state.service.refresh();state=h.render(ctx,[]);const id=state.posts[0].id
 const pending=state.service.like(id);await entered.promise
 assert.equal(h.render(ctx,[]).posts[0].likes.length,0);assert.equal(await state.service.like(id),false);assert.equal(puts,1)
 wait.resolve();assert.equal(await pending,false);assert.equal(await state.service.like(id),true)
 assert.deepEqual(calls.map(call=>call.body),[{active:true},{active:true}]);assert.equal(calls[0].key,calls[1].key)
 assert.equal(h.render(ctx,[]).posts[0].likes[0],'me');assert.equal(await state.service.like(id),true);assert.equal(calls[2].body.active,false)
 h.unmount()
})

test('manual comment retry preserves the client identity and displays the saved comment without simulated AI',async()=>{
 let item=makePost();const saved=makeComment(item.id,{body:'人工合成评论'}),ctx=makeContext(),calls=[];let comments=0
 const h=await harness('serviceSocial.ts',async(route,init)=>{
  if(route.startsWith('/v1/feed?'))return json([item])
  if(init.method!=='POST')return json([saved])
  calls.push({key:init.headers.get('Idempotency-Key'),body:JSON.parse(init.body)})
  if(++comments===1)throw Error('Lost comment acknowledgement')
  item={...item,version:2,commentCount:1,commentPreview:[saved]};return json(saved)
 })
 let state=h.render(ctx,[]);await state.service.refresh();state=h.render(ctx,[]);const id=state.posts[0].id
 assert.equal(await state.service.comment(id,'人工合成评论'),false);assert.equal(await state.service.comment(id,'人工合成评论'),true)
 await settle();state=h.render(ctx,[])
 assert.equal(calls[0].key,calls[1].key);assert.equal(calls[0].body.clientCommentId,calls[1].body.clientCommentId)
 assert.equal(state.posts[0].comments.length,1);assert.equal(state.posts[0].comments[0].author,'me');assert.equal(state.posts[0].comments[0].ai,undefined)
 h.unmount()
})

test('account changes and unmount fence late acknowledgements and late unauthorized callbacks before effects clean up',async()=>{
 const wait=defer(),entered=defer();let unauthorized=0
 const h=await harness('serviceSocial.ts',async()=>{entered.resolve();return wait.promise}),a={...makeContext(),onUnauthorized:()=>unauthorized++},b=makeContext()
 const old=h.render(a,[]).service,running=old.post('旧账号合成草稿',[]);await entered.promise
 assert.equal(h.renderWithoutEffects(b,[]).posts.length,0)
 wait.resolve(denied(401,'UNAUTHENTICATED'));assert.equal(await running,false);assert.equal(unauthorized,0)
 h.render(b,[]);h.unmount();assert.equal(await old.post('不可提交',[]),false);assert.equal(h.afterUnmount,0)
})

test('denied storage and unavailable source reads remove the old private view instead of treating stale cache as current',async()=>{
 let status=200;const item=makePost(),h=await harness('serviceSocial.ts',async()=>status===200?json([item]):denied(status,status===403?'STORAGE_PERMISSION_REQUIRED':'DEPENDENCY_UNAVAILABLE')),ctx=makeContext()
 let state=h.render(ctx,[]);await state.service.refresh();assert.equal(h.render(ctx,[]).posts.length,1)
 status=403;await state.service.refresh();state=h.render(ctx,[]);assert.equal(state.posts.length,0);assert.match(state.notice,/隐私与 AI 说明/)
 status=200;await state.service.refresh();assert.equal(h.render(ctx,[]).posts.length,1)
 status=503;await state.service.refresh();assert.equal(h.render(ctx,[]).posts.length,0);h.unmount()
})

test('a late interaction acknowledgement cannot resurrect post text removed by a newer denied read',async()=>{
 for(const action of ['like','comment']){
  const item=makePost(),saved=makeComment(item.id,{body:'在途评论'}),ctx=makeContext(),wait=defer(),entered=defer();let unavailable=false
  const h=await harness('serviceSocial.ts',async(route,init)=>{
   if(route.startsWith('/v1/feed?'))return unavailable?denied(503,'DEPENDENCY_UNAVAILABLE'):json([item])
   entered.resolve();return wait.promise
  })
  let state=h.render(ctx,[]);await state.service.refresh();state=h.render(ctx,[]);const id=state.posts[0].id
  const writing=action==='like'?state.service.like(id):state.service.comment(id,'在途评论');await entered.promise
  unavailable=true;await state.service.refresh();assert.equal(h.render(ctx,[]).posts.length,0)
  wait.resolve(action==='like'?json({active:true,reactionCount:1,postVersion:2}):json(saved));assert.equal(await writing,true)
  await settle();assert.equal(h.render(ctx,[]).posts.length,0);h.unmount()
 }
})

test('an old like replay applies current authority without pretending the old desired state was achieved',async()=>{
 const item=makePost(),ctx=makeContext(),keys=[]
 const h=await harness('serviceSocial.ts',async(route,init)=>{
  if(route.startsWith('/v1/feed?'))return json([item])
  keys.push(init.headers.get('Idempotency-Key'));return json({active:keys.length>1,reactionCount:keys.length>1?1:0,postVersion:keys.length+1})
 })
 let state=h.render(ctx,[]);await state.service.refresh();state=h.render(ctx,[]);const id=state.posts[0].id
 assert.equal(await state.service.like(id),false);assert.equal(h.render(ctx,[]).posts[0].likes.length,0)
 assert.equal(await state.service.like(id),true);assert.notEqual(keys[0],keys[1]);h.unmount()
})

test('repeated cursors and the page budget fail without publishing a truncated feed',async()=>{
 for(const endless of [false,true]){
  let calls=0;const h=await harness('serviceSocial.ts',async()=>{calls++;return json([makePost()],endless?'page-'+calls:'repeated')}),ctx=makeContext(),state=h.render(ctx,[])
  await state.service.refresh();assert.equal(h.render(ctx,[]).posts.length,0);assert.equal(calls,endless?100:2)
  if(endless)assert.match(h.render(ctx,[]).notice,/完整读取/)
  h.unmount()
 }
})

const props={user:{nick:'合成用户'},people:[],posts:[],onLike(){},onComment(){},onProfile(){},onWorld(){}}
test('the original composer keeps its draft while pending or rejected, then clears only an acknowledged success',async()=>{
 const waits=[defer(),defer()];let calls=0
 const h=await harness('moments.tsx'),input={...props,onPost:()=>waits[calls++].promise}
 let tree=h.render(input);find(tree,n=>n.type==='button'&&n.props['aria-label']==='moments.post').props.onClick()
 tree=h.render(input);composer(tree).props.onText('合成发布草稿');tree=h.render(input)
 composer(tree).props.onPost();tree=h.render(input);assert.equal(composer(tree).props.pending,true);assert.equal(composer(tree).props.text,'合成发布草稿')
 composer(tree).props.onPost();composer(tree).props.onClose();assert.equal(calls,1);assert(composer(h.render(input)))
 waits[0].resolve(false);await settle();tree=h.render(input);assert.equal(composer(tree).props.text,'合成发布草稿');assert.equal(h.haptics.length,0)
 composer(tree).props.onPost();waits[1].resolve(true);await settle();tree=h.render(input)
 assert(!nodes(tree).some(n=>typeof n.type==='function'&&n.type.name==='Composer'));assert.equal(h.haptics.length,1);h.unmount()
})

test('the original comment draft and closing state follow the actual asynchronous result',async()=>{
 const waits=[defer(),defer()];let calls=0
 const h=await harness('moments.tsx'),input={...props,posts:[{id:9,kind:'mine',author:'me',text:'帖子',images:[],at:Date.now(),likes:[],comments:[]}],onComment:()=>waits[calls++].promise}
 let tree=h.render(input);find(tree,n=>typeof n.type==='function'&&n.type.name==='PostItem').props.onComment()
 tree=h.render(input);find(tree,n=>n.type==='input'&&n.props['aria-label']==='moments.comment.ph').props.onChange({target:{value:'合成评论草稿'}})
 tree=h.render(input);find(tree,n=>n.type==='button'&&n.props.children==='talk.send').props.onClick()
 tree=h.render(input);assert.equal(find(tree,n=>n.type==='input'&&n.props['aria-label']==='moments.comment.ph').props.value,'合成评论草稿')
 assert.equal(find(tree,n=>n.type==='button'&&n.props.children==='talk.send').props.disabled,true)
 waits[0].resolve(false);await settle();tree=h.render(input);assert.equal(find(tree,n=>n.type==='input'&&n.props['aria-label']==='moments.comment.ph').props.value,'合成评论草稿')
 find(tree,n=>n.type==='button'&&n.props.children==='talk.send').props.onClick();waits[1].resolve(true);await settle();tree=h.render(input)
 assert(!nodes(tree).some(n=>n.type==='input'&&n.props['aria-label']==='moments.comment.ph'));assert.equal(h.haptics.length,1);h.unmount()
})

test('a late composer success after unmount cannot clear state or emit a success haptic',async()=>{
 const wait=defer(),h=await harness('moments.tsx'),input={...props,onPost:()=>wait.promise}
 let tree=h.render(input);find(tree,n=>n.type==='button'&&n.props['aria-label']==='moments.post').props.onClick();tree=h.render(input);composer(tree).props.onText('尚未确认');tree=h.render(input)
 composer(tree).props.onPost();h.unmount();wait.resolve(true);await settle();assert.equal(h.afterUnmount,0);assert.equal(h.haptics.length,0)
})

test('source-backed echoes and AI comments retain the owning persona, exact quote and historical world',async()=>{
 const f=echoFixture(),first=makeComment(f.item.id,{author:f.author,body:'合成人物回应一'}),second=makeComment(f.item.id,{author:f.author,body:'合成人物回应二'}),own=makeComment(f.item.id,{body:'手动回复第二条',replyToCommentId:second.id})
 f.item.commentCount=3;f.item.commentPreview=[first,second,own]
 const h=await harness('serviceSocial.ts',async route=>route.startsWith('/v1/feed?')?json([f.item]):json([first,second,own])),ctx=makeContext(),people=[f.person]
 let state=h.render(ctx,people);await state.service.refresh();state=h.render(ctx,people)
 const p=state.posts[0];assert.equal(p.kind,'echo');assert.equal(p.author,f.person.id);assert.equal(p.authorName,f.author.displayName);assert.equal(p.world,'tide')
 assert.equal(p.quote,f.excerpt);assert.equal(p.sourceMemoryId,f.item.sourceMemoryId);assert.equal(p.sourceMemoryVersion,4)
 assert.deepEqual(Array.from(p.comments,c=>c.author),[f.person.id,f.person.id,'me']);assert.equal(p.comments[1].ai,true);assert.equal(p.comments[2].to,f.person.id);assert.equal(p.comments[2].toName,f.author.displayName)
 const moved=[{...f.person,world:'isles'}];h.render(ctx,moved);state=h.render(ctx,moved);assert.equal(state.posts[0].world,'tide')
 h.unmount()
})

test('a quote waits for its confirmed original, and removed or revised originals hide old AI immediately',async()=>{
 const f=echoFixture(),h=await harness('serviceSocial.ts',async()=>json([f.item])),ctx=makeContext()
 let people=[{...f.person,memories:[]}],state=h.render(ctx,people);await state.service.refresh();state=h.render(ctx,people);assert.equal(state.posts.length,0)
 people=[f.person];h.render(ctx,people);state=h.render(ctx,people);assert.equal(state.posts[0].quote,f.excerpt)
 people=[{...f.person,memories:[{...f.person.memories[0],serverVersion:5}]}];h.render(ctx,people);state=h.render(ctx,people);assert.equal(state.posts.length,0)
 people=[{...f.person,memories:[{...f.person.memories[0],body:'与返回引用不一致的原文'}]}];h.render(ctx,people);state=h.render(ctx,people);assert.equal(state.posts.length,0)
 people=[];h.render(ctx,people);state=h.render(ctx,people);assert.equal(state.posts.length,0);h.unmount()
})

test('foreign persona comments and malformed echo provenance never fall back to the current user',async()=>{
 for(const mode of ['foreign-comment','foreign-post','mismatched-source','missing-world']){
  const f=echoFixture(),other=randomUUID()
  if(mode==='foreign-comment'){const c=makeComment(f.item.id,{author:{...f.author,personId:other}});f.item.commentCount=1;f.item.commentPreview=[c]}
  if(mode==='foreign-post')f.item.author={...f.author,personId:other}
  if(mode==='mismatched-source')f.item.sourceMemory.version=3
  if(mode==='missing-world')delete f.item.worldSnapshot
  const h=await harness('serviceSocial.ts',async()=>json([f.item])),ctx=makeContext(),people=[f.person]
  const state=h.render(ctx,people);await state.service.refresh();assert.equal(h.render(ctx,people).posts.length,0);h.unmount()
 }
})

test('reply intents bind the exact comment UUID, even when the same persona and text are repeated',async()=>{
 const f=echoFixture(),a=makeComment(f.item.id,{author:f.author,body:'人物甲评论'}),b=makeComment(f.item.id,{author:f.author,body:'人物乙评论'}),comments=[a,b],saved=new Map(),requests=[]
 f.item.commentCount=2;f.item.commentPreview=[a,b]
 const h=await harness('serviceSocial.ts',async(route,init)=>{
  if(route.startsWith('/v1/feed?'))return json([{...f.item,commentCount:comments.length,commentPreview:comments.slice(-3)}])
  if(init.method!=='POST')return json(comments)
  const body=JSON.parse(init.body);requests.push({body,key:init.headers.get('Idempotency-Key')})
  let result=saved.get(body.replyToCommentId)
  if(!result){result=makeComment(f.item.id,{body:body.body,replyToCommentId:body.replyToCommentId});saved.set(body.replyToCommentId,result);comments.push(result)}
  if(requests.length===1)throw Error('Lost exact-target acknowledgement')
  return json(result)
 }),ctx=makeContext(),people=[f.person]
 let state=h.render(ctx,people);await state.service.refresh();state=h.render(ctx,people);const id=state.posts[0].id
 assert.equal(await state.service.comment(id,'同一段手动文字',a.id),false)
 assert.equal(await state.service.comment(id,'同一段手动文字',b.id),true);await settle()
 assert.equal(await state.service.comment(id,'同一段手动文字',a.id),true);await settle()
 assert.equal(requests[0].body.replyToCommentId,a.id);assert.equal(requests[1].body.replyToCommentId,b.id)
 assert.notEqual(requests[0].key,requests[1].key);assert.notEqual(requests[0].body.clientCommentId,requests[1].body.clientCommentId)
 assert.equal(requests[0].key,requests[2].key);assert.equal(requests[0].body.clientCommentId,requests[2].body.clientCommentId)
 assert.equal(await state.service.comment(id,'不可猜测目标',randomUUID()),false);assert.equal(requests.length,3);h.unmount()
})

test('an older in-flight AI comment read cannot revive an echo after a newer source withdrawal read',async()=>{
 const f=echoFixture(),wait=defer(),entered=defer(),c=makeComment(f.item.id,{author:f.author});f.item.commentCount=1;f.item.commentPreview=[c]
 let visible=true
 const h=await harness('serviceSocial.ts',async route=>{
  if(route.startsWith('/v1/feed?'))return json(visible?[f.item]:[])
  entered.resolve();return wait.promise
 }),ctx=makeContext(),people=[f.person],state=h.render(ctx,people)
 const older=state.service.refresh();await entered.promise;visible=false;await state.service.refresh();assert.equal(h.render(ctx,people).posts.length,0)
 wait.resolve(json([c]));await older;assert.equal(h.render(ctx,people).posts.length,0);h.unmount()
})

test('render-time original withdrawal prevents a stale echo control from submitting even before effect cleanup',async()=>{
 const f=echoFixture(),ctx=makeContext();let posts=0
 const h=await harness('serviceSocial.ts',async(route,init)=>{
  if(init.method==='POST'){posts++;throw Error('A known withdrawn original must not submit')}
  return json([f.item])
 }),state=h.render(ctx,[f.person]);await state.service.refresh();const id=h.render(ctx,[f.person]).posts[0].id
 h.renderWithoutEffects(ctx,[{...f.person,memories:[]}]);assert.equal(await state.service.comment(id,'迟到点击'),false);assert.equal(posts,0);h.unmount()
})

test('clicking two comments by the same AI persona preserves separate original drafts and sends the exact target',async()=>{
 const f=echoFixture(),a=randomUUID(),b=randomUUID(),seen=[]
 const post={id:42,kind:'echo',author:f.person.id,text:'回响',quote:f.excerpt,images:[],at:Date.now(),world:'tide',likes:[],comments:[{id:71,serverId:a,author:f.person.id,authorName:'原称呼',text:'第一条回应',ai:true,at:Date.now()},{id:72,serverId:b,author:f.person.id,authorName:'原称呼',text:'第二条回应',ai:true,at:Date.now()}]}
 const h=await harness('moments.tsx'),input={...props,people:[f.person],posts:[post],onComment:(...args)=>{seen.push(args);return false}}
 const click=(body)=>{
  const tree=h.render(input),element=find(tree,n=>typeof n.type==='function'&&n.type.name==='PostItem'),row=h.renderType(element.type,element.props)
  find(row,n=>n.type==='button'&&nodes(n).some(child=>child.props.children?.includes?.(body))).props.onClick()
 }
 click('第一条回应');let tree=h.render(input)
 find(tree,n=>n.type==='input'&&n.props['aria-label']==='moments.reply.ph').props.onChange({target:{value:'给第一条的草稿'}})
 tree=h.render(input);find(tree,n=>n.type==='button'&&n.props['aria-label']==='common.close').props.onClick()
 click('第二条回应');tree=h.render(input);assert.equal(find(tree,n=>n.type==='input'&&n.props['aria-label']==='moments.reply.ph').props.value,'')
 find(tree,n=>n.type==='input'&&n.props['aria-label']==='moments.reply.ph').props.onChange({target:{value:'给第二条的草稿'}})
 tree=h.render(input);find(tree,n=>n.type==='button'&&n.props.children==='talk.send').props.onClick();await settle();assert.equal(seen[0][3],b)
 tree=h.render(input);find(tree,n=>n.type==='button'&&n.props['aria-label']==='common.close').props.onClick();click('第一条回应');tree=h.render(input)
 assert.equal(find(tree,n=>n.type==='input'&&n.props['aria-label']==='moments.reply.ph').props.value,'给第一条的草稿')
 find(tree,n=>n.type==='button'&&n.props.children==='talk.send').props.onClick();await settle();assert.equal(seen[1][3],a)
 const element=find(h.render(input),n=>typeof n.type==='function'&&n.type.name==='PostItem'),row=h.renderType(element.type,element.props)
 assert.equal(find(row,n=>n.type==='Lens').props.world,'tide','Historical echo lens must not follow the person current world')
 h.unmount()
})

test('generation failures prompt once, can reappear on entry, and stop offering retries after permission/source loss',async()=>{
 const id=randomUUID(),ctx=makeContext(),people=[];let allowed=true,gets=0
 const h=await harness('serviceSocial.ts',async route=>{
  assert(route.startsWith('/v1/feed?'));gets++
  return new Response(JSON.stringify({data:[],meta:{nextCursor:null,generationStatus:{pending:0,failed:allowed?1:0,retryableJobIds:allowed?[id]:[]}}}))
 },new Map(),{fakeTimers:true})
 let state=h.render(ctx,people);await state.service.refresh();state=h.render(ctx,people);assert(state.noticeAction);assert.equal(!!state.notice,true);const initialNoticeId=state.noticeId
 h.fireTimers(8000);state=h.render(ctx,people);assert.equal(state.notice,null)
 await state.service.refresh();state=h.render(ctx,people);assert.equal(state.notice,null,'Polling must not continually reopen the same notice')
 await state.service.refresh(true);state=h.render(ctx,people);assert(state.noticeAction);assert.notEqual(state.noticeId,initialNoticeId);const oldAction=state.noticeAction
 allowed=false;await state.service.refresh();state=h.render(ctx,people);assert.equal(state.noticeAction,undefined);assert.equal(state.notice,null)
 const before=gets;oldAction.onClick();await settle();assert.equal(gets,before);h.unmount()
})

test('the original failure action retries only current job versions, deduplicates taps and retains an unknown request key',async()=>{
 const id=randomUUID(),ctx=makeContext(),people=[],requests=[],wait=defer(),entered=defer();let accepted=false,jobGets=0
 const job={id,kind:'memory_echo',state:'failed',version:3,failure:{code:'MODEL_TIMEOUT',retryable:true},updatedAt:now}
 const h=await harness('serviceSocial.ts',async(route,init)=>{
  if(route.startsWith('/v1/feed?'))return new Response(JSON.stringify({data:[],meta:{generationStatus:{pending:accepted?1:0,failed:accepted?0:1,retryableJobIds:accepted?[]:[id]}}}))
  if(!init.method){jobGets++;if(jobGets===1){entered.resolve();await wait.promise}return json(job)}
  requests.push({key:init.headers.get('Idempotency-Key'),match:init.headers.get('If-Match'),body:JSON.parse(init.body)})
  if(requests.length===1)throw Error('Unknown retry result')
  accepted=true;return json({...job,state:'queued',version:4,failure:undefined})
 }),state=h.render(ctx,people)
 await state.service.refresh();const retry=state.service.retryFailed();await entered.promise
 assert.equal(h.render(ctx,people).noticeAction.disabled,true);await state.service.retryFailed();assert.equal(jobGets,1)
 wait.resolve();await retry;assert(h.render(ctx,people).noticeAction)
 await state.service.retryFailed();assert.equal(requests.length,2);assert.equal(requests[0].key,requests[1].key);assert.equal(requests[0].match,'"v3"');assert.deepEqual(requests[0].body,{})
 assert.equal(h.render(ctx,people).noticeAction,undefined);h.unmount()
})

test('a source invalidation while the failure action reads its job prevents even the retry POST',async()=>{
 const f=echoFixture(),id=randomUUID(),ctx=makeContext(),wait=defer(),entered=defer();let allowed=true,posts=0
 const people=[f.person],h=await harness('serviceSocial.ts',async(route,init)=>{
  if(route.startsWith('/v1/feed?'))return new Response(JSON.stringify({data:[],meta:{generationStatus:{pending:0,failed:allowed?1:0,retryableJobIds:allowed?[id]:[]}}}))
  if(init.method==='POST'){posts++;throw Error('Invalidated source must not retry')}
  entered.resolve();return wait.promise
 })
 const state=h.render(ctx,people);await state.service.refresh();const retry=state.service.retryFailed();await entered.promise
 allowed=false;h.render(ctx,[{...f.person,memories:[]}]);wait.resolve(json({id,kind:'memory_echo',state:'failed',version:2,failure:{code:'MODEL_TIMEOUT',retryable:true},updatedAt:now}));await retry
 assert.equal(posts,0);h.unmount()
})

test('the existing Toast keeps its default rendering while an optional retry action remains visible and clickable',async()=>{
 const h=await harness('toast.tsx');let calls=0
 let tree=h.render({text:'普通消息',dark:false})
 assert.equal(tree.props.style,undefined);assert.equal(nodes(tree).filter(node=>node.type==='button').length,0);assert.equal(tree.props.children.props.children,'普通消息')
 tree=h.render({text:'回响未完成',action:{label:'重试',onClick:()=>calls++}})
 assert.equal(tree.props.style.animationDuration,'8s')
 const button=find(tree,node=>node.type==='button');assert.match(button.props.className,/pointer-events-auto/);assert.equal(button.props.children,'重试');button.props.onClick();assert.equal(calls,1)
 tree=h.render({text:'回响未完成',action:{label:'重试',onClick:()=>calls++,disabled:true}});assert.equal(find(tree,node=>node.type==='button').props.disabled,true);h.unmount()
})

test('a retry denied by the AI purpose directs the user to AI permission instead of text storage',async()=>{
 const id=randomUUID(),ctx=makeContext(),people=[];let allowed=true
 const h=await harness('serviceSocial.ts',async(route,init)=>{
  if(route.startsWith('/v1/feed?'))return new Response(JSON.stringify({data:[],meta:{generationStatus:{pending:0,failed:allowed?1:0,retryableJobIds:allowed?[id]:[]}}}))
  if(!init.method)return json({id,kind:'memory_echo',state:'failed',version:2,failure:{code:'MODEL_TIMEOUT',retryable:true},updatedAt:now})
  allowed=false;return denied(403,'AI_PERMISSION_REQUIRED')
 }),state=h.render(ctx,people)
 await state.service.refresh();await state.service.retryFailed();const current=h.render(ctx,people)
 assert.match(current.notice,/隐私与 AI 说明/);assert.match(current.notice,/同意说明/);assert(!current.notice.includes('文字保存'));assert.equal(current.noticeAction,undefined);h.unmount()
})

const photoSource=label=>'data:image/jpeg;base64,'+Buffer.from('synthetic-jpeg-'+label).toString('base64')
const photoDescriptor=(id=randomUUID(),version=2)=>({id,version,mimeType:'image/webp',byteSize:4,width:640,height:480})
function photoWire(options={}){
 const calls=[],allocations=new Map(),resources=new Map(),savedPosts=new Map();let uploadFailure=!!options.failSecondUpload,postFailure=!!options.losePost
 const fetcher=async(route,init={})=>{
  const headers=new Headers(init.headers),body=typeof init.body==='string'?JSON.parse(init.body):init.body
  calls.push({route,method:init.method??'GET',key:headers.get('Idempotency-Key'),headers,body})
  if(route==='/v1/media'&&init.method==='POST'){
   let resource=allocations.get(headers.get('Idempotency-Key'))
   if(!resource){const id=randomUUID(),slot=randomUUID();resource={input:body,slot,id,status:'awaiting_upload',position:resources.size};resources.set(id,resource);allocations.set(headers.get('Idempotency-Key'),resource)}
   assert.equal(JSON.stringify(resource.input),JSON.stringify(body));return json({media:dto(resource),upload:{id:resource.slot,method:'PUT',url:'/v1/media/'+resource.id+'/uploads/'+resource.slot,requiredHeaders:{'Content-Type':body.mimeType},expiresAt:new Date(Date.now()+(options.expiredFirst&&resource.position===0?-60000:60000)).toISOString()}})
  }
  const match=/^\/v1\/media\/([a-f0-9-]+)(?:\/(.*))?$/.exec(route)
  if(match){const resource=resources.get(match[1]);assert(resource,'An upload must be allocated before it is used')
   if(match[2]?.startsWith('uploads/')){
    assert.equal(init.method,'PUT');assert(init.body instanceof Blob);assert.equal(headers.get('Content-Type'),resource.input.mimeType)
    if(options.authorizationChangedFirst&&resource.position===0)return denied(409,'AUTHORIZATION_CHANGED')
    const bytes=await init.body.arrayBuffer(),hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');assert.equal(hash,resource.input.sha256);assert.equal(bytes.byteLength,resource.input.byteSize)
    if(resource.position===1&&uploadFailure){uploadFailure=false;throw new TypeError('Synthetic interrupted upload')}
    resource.uploaded=true;return new Response(null,{status:204})
   }
   if(match[2]==='complete'){assert(resource.uploaded);assert.equal(body.uploadSlotId,resource.slot);resource.status='ready';return json(dto(resource))}
   if(!match[2])return options.denyMediaAfterPost&&savedPosts.size?denied(403,'PHOTO_STORAGE_PERMISSION_REQUIRED'):json(dto(resource))
  }
  if(route==='/v1/posts'&&init.method==='POST'){
   assert(body.mediaIds.every(id=>resources.get(id)?.status==='ready'));let value=savedPosts.get(body.clientPostId)
   if(!value){value=makePost({body:body.body,mediaIds:body.mediaIds,media:body.mediaIds.map(id=>photoDescriptor(id))});savedPosts.set(body.clientPostId,value)}
   if(postFailure){postFailure=false;throw new TypeError('Synthetic lost publish acknowledgement')}
   return json(value)
  }
  if(route.startsWith('/v1/feed?'))return json([...savedPosts.values()])
  throw Error('Unexpected synthetic media route')
 }
 const dto=resource=>({id:resource.id,purpose:'post_attachment',status:resource.status,mimeType:resource.status==='ready'?'image/webp':resource.input.mimeType,byteSize:resource.status==='ready'?4:resource.input.byteSize,version:resource.status==='ready'?2:1,authorizationVersion:1,...(resource.status==='ready'?{width:640,height:480}:{}),createdAt:now,updatedAt:now})
 return {fetcher,calls,allocations,resources,savedPosts}
}

test('ordered photo upload uses actual bytes, pure-image posts and only owned metadata, without an AI request',async()=>{
 const wire=photoWire(),ctx=makeContext(),storage=new Map(),h=await harness('serviceSocial.ts',wire.fetcher,storage),state=h.render(ctx,[])
 assert.equal(await state.service.post('',[photoSource('one'),photoSource('two')]),true)
 const p=h.render(ctx,[]).posts[0],sent=wire.calls.find(call=>call.route==='/v1/posts').body
 assert.equal(p.text,'');assert.equal(p.media.length,2);assert.equal(JSON.stringify(p.media.map(photo=>photo.id)),JSON.stringify(sent.mediaIds));assert.equal(p.images.length,0)
 assert(wire.calls.every(call=>call.headers.get('X-Xijie-Expected-Session')===ctx.sessionId))
 assert.equal(wire.calls.filter(call=>call.method==='PUT').length,2);assert.equal(wire.calls.filter(call=>call.route==='/v1/posts').length,1)
 assert(!wire.calls.some(call=>/generation|conversations/.test(call.route)));assert.equal(storage.size,0);h.unmount()
})

test('a partial photo failure preserves completed uploads and the original keys, then posts exactly once',async()=>{
 const wire=photoWire({failSecondUpload:true}),ctx=makeContext(),h=await harness('serviceSocial.ts',wire.fetcher),state=h.render(ctx,[]),sources=[photoSource('one'),photoSource('two')]
 assert.equal(await state.service.post('保留图稿',sources),false);assert.equal(wire.savedPosts.size,0);assert.equal(wire.resources.size,2)
 assert.equal(await state.service.post('保留图稿',sources),true);assert.equal(wire.resources.size,2);assert.equal(wire.savedPosts.size,1)
 const puts=wire.calls.filter(call=>call.method==='PUT');assert.equal(puts.filter(call=>call.route.includes([...wire.resources.keys()][0])).length,1)
 assert.equal(puts[1].key,puts[2].key);assert.equal(puts[1].route,puts[2].route);h.unmount()
})

test('nine photos preserve all ordered identities and a tenth photo is rejected before any upload',async()=>{
 const wire=photoWire(),ctx=makeContext(),h=await harness('serviceSocial.ts',wire.fetcher),state=h.render(ctx,[]),sources=Array.from({length:9},(_,index)=>photoSource('photo-'+index))
 assert.equal(await state.service.post('',sources),true);assert.equal(wire.resources.size,9);assert.equal(h.render(ctx,[]).posts[0].media.length,9)
 const before=wire.calls.length;assert.equal(await state.service.post('',[...sources,photoSource('ten')]),false);assert.equal(wire.calls.length,before);h.unmount()
})

test('a confirmed expired upload allocates a fresh sub-intent on manual retry without changing its post target',async()=>{
 const wire=photoWire({expiredFirst:true}),ctx=makeContext(),h=await harness('serviceSocial.ts',wire.fetcher),state=h.render(ctx,[]),sources=[photoSource('slot-expiry')]
 assert.equal(await state.service.post('到期草稿',sources),false);assert.equal(wire.calls.filter(call=>call.method==='PUT').length,0)
 assert.equal(await state.service.post('到期草稿',sources),true)
 const allocations=wire.calls.filter(call=>call.route==='/v1/media');assert.equal(allocations.length,2);assert.notEqual(allocations[0].key,allocations[1].key)
 assert.equal(allocations[0].body.target.id,allocations[1].body.target.id);assert.equal(wire.savedPosts.size,1);h.unmount()
})

test('pre-submit authorization changes retire only the upload allocation and keep the parent post key and target',async()=>{
 const wire=photoWire({authorizationChangedFirst:true}),ctx=makeContext(),storage=new Map(),h=await harness('serviceSocial.ts',wire.fetcher,storage),state=h.render(ctx,[]),sources=[photoSource('reauthorized')]
 assert.equal(await state.service.post('照片再次允许后手动重试',sources),false);assert.equal(wire.savedPosts.size,0)
 const originalIntent=JSON.parse([...storage].find(([key])=>key.startsWith('xijie.social.intent.'))[1])
 assert.equal(await state.service.post('照片再次允许后手动重试',sources),true)
 const allocations=wire.calls.filter(call=>call.route==='/v1/media'),posted=wire.calls.find(call=>call.route==='/v1/posts')
 assert.equal(allocations.length,2);assert.notEqual(allocations[0].key,allocations[1].key);assert.equal(allocations[0].body.target.id,allocations[1].body.target.id)
 assert.equal(posted.body.clientPostId,originalIntent.clientId);assert.equal(posted.key,originalIntent.key);h.unmount()
})

test('lost photo publish acknowledgements reuse uploads across remount while changed captions create a new target',async()=>{
 const wire=photoWire({losePost:true,denyMediaAfterPost:true}),ctx=makeContext(),storage=new Map(),sources=[photoSource('one')]
 let h=await harness('serviceSocial.ts',wire.fetcher,storage),state=h.render(ctx,[])
 assert.equal(await state.service.post('原图文',sources),false);const original=wire.calls.find(call=>call.route==='/v1/posts')
 assert(![...storage].some(([key,value])=>key.includes('原图文')||value.includes('原图文')||value.includes(sources[0])||value.includes('readProof')))
 h.unmount();h=await harness('serviceSocial.ts',wire.fetcher,storage);state=h.render(ctx,[])
 assert.equal(await state.service.post('原图文',sources),true);assert.equal(wire.resources.size,1);assert.equal(wire.calls.filter(call=>call.method==='PUT').length,1)
 assert(!wire.calls.some(call=>call.method==='GET'&&call.route.startsWith('/v1/media/')),'Unknown post submission replays Social before any newly denied Media read')
 const same=wire.calls.filter(call=>call.route==='/v1/posts')[1];assert.equal(original.key,same.key);assert.equal(original.body.clientPostId,same.body.clientPostId)
 assert.equal(await state.service.post('新的文案',sources),true);assert.equal(wire.resources.size,2)
 const changed=wire.calls.filter(call=>call.route==='/v1/posts')[2];assert.notEqual(changed.body.clientPostId,original.body.clientPostId);assert.notEqual(changed.body.mediaIds[0],original.body.mediaIds[0]);h.unmount()
})

test('different image contents with the same caption have separate post identities',async()=>{
 const wire=photoWire(),ctx=makeContext(),h=await harness('serviceSocial.ts',wire.fetcher),state=h.render(ctx,[])
 assert.equal(await state.service.post('同一文案',[photoSource('first')]),true);assert.equal(await state.service.post('同一文案',[photoSource('second')]),true)
 const posts=wire.calls.filter(call=>call.route==='/v1/posts');assert.notEqual(posts[0].body.clientPostId,posts[1].body.clientPostId);assert.notEqual(posts[0].key,posts[1].key);h.unmount()
})

test('photo permission is independent: rejected upload keeps text posts and directs to private photo permission',async()=>{
 const item=makePost(),ctx=makeContext(),h=await harness('serviceSocial.ts',async(route)=>route.startsWith('/v1/feed?')?json([item]):denied(403,'PHOTO_STORAGE_PERMISSION_REQUIRED')),state=h.render(ctx,[])
 await state.service.refresh();assert.equal(await state.service.post('照片草稿',[photoSource('one')]),false)
 const after=h.render(ctx,[]);assert.equal(after.posts.length,1);assert.match(after.notice,/隐私与 AI 说明/);assert.match(after.notice,/同意说明/);assert(!after.notice.includes('AI 文字'));h.unmount()
})

test('media descriptor order, bounds and post ownership are validated before showing photos',async()=>{
 for(const mode of ['mismatched-order','too-many','invalid-size','non-user']){
  const a=photoDescriptor(),b=photoDescriptor(),item=makePost({mediaIds:[a.id,b.id],media:[a,b]})
  if(mode==='mismatched-order')item.media.reverse()
  if(mode==='too-many'){item.media=Array.from({length:10},()=>photoDescriptor());item.mediaIds=item.media.map(v=>v.id)}
  if(mode==='invalid-size')item.media[0].byteSize=1024*1024+1
  if(mode==='non-user')item.kind='world_notice'
  const ctx=makeContext(),h=await harness('serviceSocial.ts',async()=>json([item])),state=h.render(ctx,[]);await state.service.refresh();assert.equal(h.render(ctx,[]).posts.length,0);h.unmount()
 }
})

test('private reads exchange a fresh proof for exact owned bytes and reject off-origin content paths',async()=>{
 const descriptor=photoDescriptor(),ctx=makeContext(),post=makePost({body:'照片',mediaIds:[descriptor.id],media:[descriptor]}),proof='c3ludGhldGlj.'+'A'.repeat(43),calls=[];let external=false
 const h=await harness('serviceSocial.ts',async(route,init)=>{
  calls.push({route,init});if(route.startsWith('/v1/feed?'))return json([post])
  if(route.endsWith('/read-url')){assert.equal(JSON.parse(init.body).target.id,post.id);return json({mode:'authorized_stream',url:external?'https://untrusted.example/photo':'/v1/media/'+descriptor.id+'/content',expiresAt:new Date(Date.now()+60000).toISOString(),authorizationVersion:1,readProof:proof})}
  assert.equal(init.headers.get('X-Media-Read-Proof'),proof);return new Response(new Blob(['webp'],{type:'image/webp'}))
 }),state=h.render(ctx,[]);await state.service.refresh();const p=h.render(ctx,[]).posts[0]
 const blob=await state.service.readPhoto(p.id,p.media[0],new AbortController().signal);assert.equal(blob.size,4);assert.equal(blob.type,'image/webp')
 assert(calls.every(({init})=>init.credentials==='same-origin'&&init.cache==='no-store'&&init.headers.get('X-Xijie-Expected-Session')===ctx.sessionId))
 external=true;const before=calls.length;await assert.rejects(state.service.readPhoto(p.id,p.media[0],new AbortController().signal));assert.equal(calls.length,before+1);h.unmount()
})

test('an account change during media allocation cannot upload bytes, persist a receipt, or post for the new account',async()=>{
 const wait=defer(),entered=defer(),a=makeContext(),b=makeContext(),storage=new Map();let calls=0
 const h=await harness('serviceSocial.ts',async()=>{calls++;entered.resolve();return wait.promise},storage),state=h.render(a,[]),writing=state.service.post('旧账号图稿',[photoSource('one')])
 await entered.promise;h.renderWithoutEffects(b,[]);wait.resolve(denied(401,'UNAUTHENTICATED'));assert.equal(await writing,false);assert.equal(calls,1)
 assert.equal(h.render(b,[]).posts.length,0);assert(![...storage.values()].some(value=>value.includes('mediaId')));h.unmount()
})

test('delete acknowledgement loss retries the same post version and intent before removing the local photo',async()=>{
 const descriptor=photoDescriptor(),item=makePost({mediaIds:[descriptor.id],media:[descriptor]}),ctx=makeContext(),deletes=[]
 const h=await harness('serviceSocial.ts',async(route,init)=>{
  if(route.startsWith('/v1/feed?'))return json([item])
  assert.equal(init.method,'DELETE');deletes.push({key:init.headers.get('Idempotency-Key'),version:init.headers.get('If-Match')});if(deletes.length===1)throw Error('Lost deletion acknowledgement')
  return json({id:item.id,version:2,removedAt:now})
 }),state=h.render(ctx,[]);await state.service.refresh();const id=h.render(ctx,[]).posts[0].id
 assert.equal(await state.service.remove(id,1),false);assert.equal(h.render(ctx,[]).posts.length,1)
 assert.equal(await state.service.remove(id,1),true);assert.equal(h.render(ctx,[]).posts.length,0);assert.deepEqual(deletes[0],deletes[1]);h.unmount()
})

test('photo selection preserves order and a closed sheet draft, and cannot update after unmount',async()=>{
 const first=defer(),second=defer(),entered=defer();let calls=0
 const h=await harness('moments.tsx',undefined,new Map(),{photoReader:()=>{entered.resolve();return calls++===0?first.promise:second.promise}}),input={...props,onPost:async()=>false}
 let tree=h.render(input);find(tree,n=>n.type==='button'&&n.props['aria-label']==='moments.post').props.onClick();tree=h.render(input)
 const reading=composer(tree).props.onAddPhotos([{name:'first'},{name:'second'}]);await entered.promise
 composer(h.render(input)).props.onClose();first.resolve('data:first');second.resolve('data:second');await reading
 find(h.render(input),n=>n.type==='button'&&n.props['aria-label']==='moments.post').props.onClick();tree=h.render(input)
 assert.equal(JSON.stringify(composer(tree).props.imgs),JSON.stringify(['data:first','data:second']))
 const late=defer(),h2=await harness('moments.tsx',undefined,new Map(),{photoReader:()=>late.promise});let next=h2.render(input);find(next,n=>n.type==='button'&&n.props['aria-label']==='moments.post').props.onClick();next=h2.render(input)
 const work=composer(next).props.onAddPhotos([{name:'late'}]);h2.unmount();late.resolve('data:late');await work;assert.equal(h2.afterUnmount,0);h.unmount()
})

test('the photo gallery uses the original Sheet and owned delete requires confirmation with the captured version',async()=>{
 const photos=[photoDescriptor(),photoDescriptor()],post={id:40,serverVersion:7,kind:'mine',author:'me',text:'图片',images:[],media:photos,likes:[],comments:[],at:Date.now()},seen=[]
 const h=await harness('moments.tsx'),input={...props,posts:[post],readPhoto:async()=>new Blob(),onRemove:async(...args)=>{seen.push(args);return false}}
 let tree=h.render(input),item=find(tree,node=>typeof node.type==='function'&&node.type.name==='PostItem');item.props.onPhoto(1);tree=h.render(input)
 const gallery=find(tree,node=>node.type==='Sheet'&&String(node.props.title).startsWith('照片 '));assert.equal(gallery.props.title,'照片 2 / 2');assert.equal(find(gallery,node=>node.type==='PrivatePhoto').props.photo.id,photos[1].id)
 gallery.props.onClose();tree=h.render(input);item=find(tree,node=>typeof node.type==='function'&&node.type.name==='PostItem');item.props.onRemove();tree=h.render(input);assert.equal(seen.length,0)
 const confirm=find(tree,node=>node.type==='Sheet'&&node.props.title==='删除这条动态？');find(confirm.props.footer,node=>node.type==='button'&&node.props.children==='del.confirm').props.onClick();await settle();assert.equal(JSON.stringify(seen),JSON.stringify([[40,7]]));h.unmount()
})

test('private photo bytes are lazy, revoked on leaving view or consent change, and late downloads stay fenced',async()=>{
 const observers=[],reads=[],waits=[defer(),defer(),defer()]
 class Observer{constructor(callback){this.callback=callback;observers.push(this)}observe(){}disconnect(){}}
 const h=await harness('PrivatePhoto.tsx',undefined,new Map(),{observer:Observer}),input={postId:2,photo:photoDescriptor(),read:async(...args)=>{reads.push(args);return waits[reads.length-1].promise},className:'photo',label:'查看照片'}
 const tree=h.renderWithoutEffects(input);tree.props.ref.current={};h.flushEffects();assert.equal(reads.length,0)
 observers[0].callback([{isIntersecting:true}]);h.render(input);assert.equal(reads.length,1);waits[0].resolve(new Blob(['first']));await settle();h.render(input);assert.equal(h.objectURLs.length,1)
 observers[0].callback([{isIntersecting:false}]);h.render(input);assert(h.revokedURLs.includes(h.objectURLs[0].value));assert(reads[0][2].aborted)
 observers[0].callback([{isIntersecting:true}]);h.render(input);assert.equal(reads.length,2);h.dispatch('xijie:consents-changed');h.render(input);assert(reads[1][2].aborted);assert.equal(reads.length,3)
 waits[1].resolve(new Blob(['late permission result']));await settle();assert.equal(h.objectURLs.length,1)
 h.unmount();waits[2].resolve(new Blob(['late after unmount']));await settle();assert.equal(h.objectURLs.length,1);assert.equal(h.afterUnmount,0)
})
