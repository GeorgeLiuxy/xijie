import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'
const source=await readFile(new URL('../src/person.tsx',import.meta.url),'utf8')
const ast=ts.createSourceFile('person.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
const declaration=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='Gathering')
assert(declaration)
const compile=value=>ts.transpileModule(value,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React}}).outputText
const code=compile(declaration.getText(ast).replace(/^export /,''))
const element=(type,props,...children)=>({type,props:{...props,children:children.flat()}})
const all=node=>node&&typeof node==='object'?[node,...(node.props?.children??[]).flatMap(all)]:[]
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r))}
function harness(remote){
 let si=0,ri=0,ei=0,draft='尚未接受的输入',writes=0,haptics=0,templateCalls=0;const states=[],refs=[],effects=[],pending=[],timers=[]
 const hooks={useState(v){const i=si++;if(!(i in states))states[i]=typeof v==='function'?v():v;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useRef(v){const i=ri++;return refs[i]??(refs[i]={current:v})},useEffect(fn,deps){const i=ei++,old=effects[i];if(!old||deps.some((v,j)=>v!==old.deps[j]))pending.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:fn()}})},useContext:()=>false,useMemo:fn=>fn()}
 const context=vm.createContext({...hooks,React:{createElement:element},useI18n:()=>({lang:'zh-CN',t:k=>k}),useStatusTone(){},NightCtx:{},useNativeBack(){},isZh:()=>true,nid:()=>1,fmtTime:()=>'',haptic(){haptics++},buildReply(){templateCalls++;throw Error('real accounts cannot use preview replies')},useServiceConversation:()=>remote,useConversationHistory:(_initial,_persist,intro)=>[intro(),()=>writes++],useConversationDraft:()=>[draft,v=>{draft=v}],useThreadScroll:()=>({scroller:{current:null},highlighted:null}),I:{Back:'Back',Send:'Send'},WorldScene:'WorldScene',Toast:'Toast',Lens:'Lens',Bubble:'Bubble',MessageRow:'MessageRow',HorizonSignal:'HorizonSignal',window:{setTimeout(fn,ms){timers.push({fn,ms});return timers.length}},clearTimeout(){},speak(){},navigator:{clipboard:{writeText:async()=>{}}}})
 const component=vm.runInContext(code+'\nGathering',context)
 return {render(props){si=ri=ei=0;const result=component(props);while(pending.length)pending.shift()();return result},get draft(){return draft},get writes(){return writes},get haptics(){return haptics},get templateCalls(){return templateCalls},timers,unmount(){effects.forEach(e=>e.cleanup?.())}}
}
const remoteState=()=>({messages:[],loading:false,sending:false,typing:false,hasOlder:false,hasNewer:false,feedback:null,clearFeedback(){},send:async()=>false,remove:async()=>true})
const props=()=>({world:'courtyard',people:[],allPeople:[],draftOwner:'account.synthetic',serviceAccount:true,serviceConversation:{accountId:randomUUID(),sessionId:randomUUID(),target:{kind:'gather',worldId:randomUUID()}},chat:[{id:99,kind:'him',text:'不得使用的旧预览模板'}],onPersist(){throw Error('local transcript write forbidden')},onBack(){},onOpen(){}})

test('original gathering keeps failed input and never executes preview replies or persists a local service transcript',async()=>{
 const remote=remoteState(),p=props(),h=harness(remote);let tree=h.render(p)
 assert(!all(tree).some(node=>node.type==='Bubble'&&node.props.m.id===99))
 all(tree).find(node=>node.type==='button'&&node.props['aria-label']==='talk.send').props.onClick();await settle();tree=h.render(p)
 assert.equal(h.draft,'尚未接受的输入');assert.equal(h.haptics,0);assert.equal(h.templateCalls,0);assert.equal(h.writes,0);assert.equal(h.timers.length,0)
 remote.send=async()=>true;all(tree).find(node=>node.type==='button'&&node.props['aria-label']==='talk.send').props.onClick();await settle();assert.equal(h.draft,'');assert.equal(h.haptics,1);assert.equal(h.writes,0);assert.equal(h.templateCalls,0);h.unmount()
})

test('original gathering replays locked pending text with canSend false and separates server names from current profile navigation',async()=>{
 const personId=randomUUID(),remote={...remoteState(),canSend:false,pendingText:'锁定的完整原始发言',messages:[{id:3,kind:'him',serverId:randomUUID(),text:'保存的回复',speakerDisplayName:'服务允许的历史署名',speakerPersonId:personId}]},p=props(),sent=[],opened=[]
 remote.send=async value=>{sent.push(value);return false};p.allPeople=[{id:7,serverId:personId,name:'不能覆盖历史的当前姓名',world:'tide',avatar:''}];p.onOpen=id=>opened.push(id)
 const h=harness(remote);let tree=h.render(p),field=all(tree).find(node=>node.type==='textarea'),send=all(tree).find(node=>node.type==='button'&&node.props['aria-label']==='talk.send'),bubble=all(tree).find(node=>node.type==='Bubble'&&node.props.m.id===3)
 assert.equal(field.props.readOnly,true);assert.equal(field.props.value,remote.pendingText);assert.equal(send.props.disabled,false);send.props.onClick();await settle();assert.deepEqual(sent,[remote.pendingText])
 assert.equal(bubble.props.speaker.name,'服务允许的历史署名');assert.equal(bubble.props.speaker.world,'tide');bubble.props.onAvatar();assert.deepEqual(opened,[7]);assert.equal(bubble.props.onRemember,undefined);assert.equal(bubble.props.onRetry,undefined)
 remote.messages=[{...remote.messages[0],speakerDisplayName:'曾在这里的人物',speakerPersonId:undefined}];tree=h.render(p);bubble=all(tree).find(node=>node.type==='Bubble'&&node.props.m.id===3)
 assert.equal(bubble.props.speaker.name,'曾在这里的人物');assert.equal(bubble.props.onAvatar,undefined);assert.equal(bubble.props.speaker.avatar,'');h.unmount()
})

test('unsubmitted gathering drafts survive remount and remain separated by account and world',async()=>{
 const historyCode=compile(await readFile(new URL('../src/conversationHistory.ts',import.meta.url),'utf8')),storage=new Map()
 async function mounted(owner,thread){
  let si=0;const states=[]
  const context=vm.createContext({sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}})
  const react=new vm.SyntheticModule(['useCallback','useRef','useState'],function(){this.setExport('useCallback',fn=>fn);this.setExport('useRef',value=>({current:value}));this.setExport('useState',v=>{const i=si++;if(!(i in states))states[i]=typeof v==='function'?v():v;return [states[i],v=>states[i]=v]})},{context})
  const module=new vm.SourceTextModule(historyCode,{context});await module.link(()=>react);await module.evaluate()
  return ()=>{si=0;return module.namespace.useConversationDraft(owner,thread,true)}
 }
 let render=await mounted('account.first','g:courtyard');render()[1]('未发出的文字');assert.equal(render()[0],'未发出的文字')
 render=await mounted('account.first','g:courtyard');assert.equal(render()[0],'未发出的文字')
 assert.equal((await mounted('account.second','g:courtyard'))()[0],'');assert.equal((await mounted('account.first','g:tide'))()[0],'')
 render()[1]('');assert.equal(storage.size,0)
})
