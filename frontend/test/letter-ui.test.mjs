import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'
const personSource=await readFile(new URL('../src/person.tsx',import.meta.url),'utf8')
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React}}).outputText
const ast=ts.createSourceFile('person.tsx',personSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
const fn=name=>{let value;function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text===name)value=node.getText(ast).replace(/^export /,'');ts.forEachChild(node,visit)}visit(ast);assert(value);return value}
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r))}
const element=(type,props,...children)=>({type,props:{...props,children:children.flat()}})
const all=node=>node&&typeof node==='object'?[node,...(node.props?.children??[]).flatMap(all)]:[]
const text=node=>typeof node==='string'?node:node&&typeof node==='object'?(node.props?.children??[]).map(text).join(''):''
const labels={'letter.to':'致 合成人物','letter.ph':'写下想说的话…','letter.reply':'请 TA 回信','letter.reply.ai':'AI 撰写','letter.when.morning':'明早送达','letter.when.now':'即刻','letter.seal':'封存','letter.kept':'已收进你们的信匣','common.close':'关闭'}
function componentHarness(name,extra={}){
 let si=0,ri=0,ei=0,tid=0;const states=[],refs=[],effects=[],pending=[],timers=new Map();let haptics=0
 const hooks={useState(v){const i=si++;if(!(i in states))states[i]=typeof v==='function'?v():v;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useRef(v){const i=ri++;return refs[i]??(refs[i]={current:v})},useEffect(fn,deps){const i=ei++,old=effects[i];if(!old||deps.some((v,j)=>v!==old.deps[j]))pending.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:fn()}})},useContext:()=>false}
 const context=vm.createContext({...hooks,React:{createElement:element},useI18n:()=>({lang:'zh-CN',t:k=>labels[k]??k}),useStatusTone(){},NightCtx:{},letterDrafts:new Map(),useNativeBack(){},isZh:()=>true,letterMessage:()=> '封存结果尚未确认，信的内容已保留',letterView:value=>({id:1,text:value.body}),nid:()=>1,fmtDate:()=> '2026年11月13日',nextMorning:()=>1,isTomorrow:()=>false,fxPrefs:{calm:false},haptic(){haptics++},chime(){},I:{X:'X'},WorldScene:'WorldScene',Arrival:'Arrival',LetterGlyph:'LetterGlyph',Switch:'Switch',Toast:'Toast',Lens:'Lens',window:{setTimeout(fn,ms){timers.set(++tid,{fn,ms});return tid}},clearTimeout:id=>timers.delete(id),...extra})
 const component=vm.runInContext(compile(fn(name))+'\n'+name,context)
 return {render(props){si=ri=ei=0;const result=component(props);while(pending.length)pending.shift()();return result},timers,get haptics(){return haptics},unmount(){effects.forEach(e=>e.cleanup?.())}}
}

test('the original composer plays no success before server acceptance and never saves a local service letter',async()=>{
 const gate=defer();let pending=false,localWrites=0,closed=0
 const service={draft:()=>({text:'专用合成原信',wantReply:false,when:'morning'}),pending:()=>pending?{}:undefined,saveDraft(){},send(){pending=true;return gate.promise}}
 const props={person:{name:'合成人物',world:'courtyard'},draftKey:'synthetic',serviceAccount:true,service,onSent(){localWrites++},onClose(){closed++}},h=componentHarness('LetterComposerView')
 let tree=h.render(props);all(tree).find(n=>n.props?.className?.includes('letter-seal')).props.onClick();tree=h.render(props)
 assert.equal(h.haptics,0);assert.equal(h.timers.size,0);assert.equal(all(tree).find(n=>n.type==='textarea').props.readOnly,true);assert.equal(all(tree).find(n=>n.props?.className?.includes('letter-seal')).props['aria-busy'],true)
 gate.resolve({body:'专用合成原信'});await settle();tree=h.render(props);assert.equal(h.haptics,1);assert.deepEqual([...h.timers.values()].map(x=>x.ms),[650,1500,2900]);assert.equal(localWrites,0)
 ;[...h.timers.values()].find(x=>x.ms===1500).fn();tree=h.render(props);assert(all(tree).some(n=>n.type==='Toast'&&n.props.text==='已收进你们的信匣'));assert.equal(localWrites,0);assert.equal(closed,0);h.unmount()
})

test('an unknown sealing result keeps the original draft and close action; an unmounted composer ignores late success',async()=>{
 for(const unmount of [false,true]){
  const gate=defer();let closed=0
  const service={draft:()=>({text:'保留完整原信',wantReply:true,when:'now'}),pending:()=>({}),saveDraft(){},send:()=>gate.promise}
  const props={person:{name:'合成人物',world:'courtyard'},draftKey:'synthetic',serviceAccount:true,service,onSent(){throw Error('local success forbidden')},onClose(){closed++}},h=componentHarness('LetterComposerView')
  let tree=h.render(props);all(tree).find(n=>n.props?.className?.includes('letter-seal')).props.onClick()
  if(unmount){h.unmount();gate.resolve({body:'保留完整原信'});await settle();assert.equal(h.timers.size,0);assert.equal(h.haptics,0)}
  else {gate.reject(new Error('unknown'));await settle();tree=h.render(props);assert.equal(all(tree).find(n=>n.type==='textarea').props.value,'保留完整原信');assert.equal(all(tree).find(n=>n.props?.className?.includes('letter-seal')).props.disabled,false);const close=all(tree).find(n=>n.type==='button'&&n.props['aria-label']==='关闭');assert.equal(close.props.disabled,false);close.props.onClick();assert.equal(closed,1);assert.equal(h.haptics,0);h.unmount()}
 }
})

test('a memory enters the verified letter draft only after selection and keeps existing text',()=>{
 const drafts=[]
 const service={draft:()=>({text:'已经写下的开头',wantReply:true,when:'morning'}),pending:()=>undefined,saveDraft:value=>drafts.push(value)}
 const h=componentHarness('LetterComposerView')
 const body='🌙'.repeat(600)+'最后一句'
 const ref={id:'19cf2d67-e418-4f62-8af3-08aba4e038e9',version:2}
 const props={person:{name:'合成人物',world:'courtyard'},draftKey:'synthetic',serviceAccount:true,service,memory:{title:'那年夏天',body,serverId:ref.id,serverVersion:ref.version},onSent(){throw Error('unexpected send')},onClose(){}}
 const addButton=tree=>all(tree).find(node=>node.type==='button'&&text(node).includes('带入开头 600 字'))
 let tree=h.render(props)
 assert.equal(all(tree).find(node=>node.type==='textarea').props.value,'已经写下的开头')
 assert.equal(drafts.length,0)
 addButton(tree).props.onClick()
 tree=h.render(props)
 assert.equal(drafts.length,1)
 assert.deepEqual([drafts[0].text,drafts[0].wantReply,drafts[0].when],['已经写下的开头\n\n'+'🌙'.repeat(600),true,'morning'])
 assert.equal(drafts[0].sourceMemory.id,ref.id)
 assert.equal(drafts[0].sourceMemory.version,ref.version)
 assert.equal(all(tree).find(node=>node.type==='button'&&text(node)==='已带入正文').props.disabled,true)
 all(tree).find(node=>node.type==='button'&&text(node)==='取消关联').props.onClick()
 assert.equal(drafts[1].sourceMemory,undefined)
 assert.equal(drafts[1].text,drafts[0].text)
 service.pending=()=>({})
 const other={...props,memory:{title:'另一页',body:'不同的原文'}}
 tree=h.render(other)
 assert.equal(all(tree).find(node=>node.type==='button'&&text(node)==='带入正文').props.disabled,true)
 assert.equal(drafts.length,2)
})

test('the original letter card renders actual failed/stopped/pending states and never treats the browser clock as a reply',()=>{
 const h=componentHarness('LetterCard'),base={id:1,serverId:randomUUID(),text:'原信',date:'日期',wantReply:true,replyAt:1}
 const failed=h.render({l:{...base,replyState:'failed'},person:{}});assert(text(failed).includes('回信暂未完成'));assert(!text(failed).includes('letter.pending'))
 const stopped=h.render({l:{...base,replyState:'blocked'},person:{}});assert(text(stopped).includes('本次回信已停止'))
 const queued=h.render({l:{...base,replyState:'queued'},person:{}});assert(text(queued).includes('正在等待回信'));assert(!text(queued).includes('真实回信'))
 const completed=h.render({l:{...base,replyState:'succeeded',reply:'真实回信'},person:{}});assert(text(completed).includes('真实回信'));assert(!text(completed).includes('正在等待回信'));h.unmount()
})
