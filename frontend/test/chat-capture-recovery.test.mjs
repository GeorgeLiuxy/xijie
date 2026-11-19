import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'
const code=ts.transpileModule(await readFile(new URL('../src/mobile/ChatCaptureRecovery.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React}}).outputText
const element=(type,props,...children)=>({type,props:{...props,children:children.flat(Infinity)}})
const all=value=>value&&typeof value==='object'?[value,...(value.props?.children??[]).flatMap(all)]:[]
const text=value=>typeof value==='string'||typeof value==='number'?String(value):value&&typeof value==='object'?(value.props?.children??[]).map(text).join(''):''
const settle=async()=>{for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r))}
async function harness({pending=true,active=false,missing=false}={}){
 const record={operationId:'operation',owner:{personId:'person'},state:'ready',expiresAtMs:Date.now()+3600000}
 let value=pending?record:undefined,reading=0,discards=0,reads=0,si=0,ei=0;const states=[],effects=[],queue=[]
 const client={pending:()=>value,active:()=>active,subscribe:()=>()=>{},reconcile:async()=>{},refresh:async()=>{reading++;if(missing)throw {code:'CAPTURE_FILE_MISSING'};return value},discard:async()=>{discards++;value=undefined},read:async()=>{reads++;throw Error('No photo read without explicit original Talk action')}}
 const hooks={useState(initial){const i=si++;if(!(i in states))states[i]=initial;return[states[i],next=>states[i]=typeof next==='function'?next(states[i]):next]},useEffect(fn,deps){const i=ei++,old=effects[i];if(!old||deps.some((v,j)=>v!==old.deps[j]))queue.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:fn()}})}}
 const context=vm.createContext({React:{createElement:element},DOMException,Date,window:{addEventListener(){},removeEventListener(){}},document:{visibilityState:'visible',addEventListener(){},removeEventListener(){}}})
 const synthetic=exports=>new vm.SyntheticModule(Object.keys(exports),function(){for(const[k,v]of Object.entries(exports))this.setExport(k,v)},{context})
 const imports={react:synthetic(hooks),'../i18n':synthetic({useI18n:()=>({lang:'zh-CN'}),isZh:()=>true}),'./chatCapture':synthetic({captureFailure:failure=>failure.code})}
 const module=new vm.SourceTextModule(code,{context});await module.link(name=>imports[name]);await module.evaluate()
 return {client,record,get reading(){return reading},get discards(){return discards},get reads(){return reads},render(props={}){si=ei=0;const tree=module.namespace.ChatCaptureRecovery({client,people:[],ready:false,onContinue(){},...props});while(queue.length)queue.shift()();return tree}}
}
test('cold recovery displays the verified local lifetime and waits for the original person before continuing without automatic reads or discard',async()=>{
 const h=await harness(),continued=[];h.render();await settle();let tree=h.render()
 assert.match(text(tree),/最多保留一小时/);assert.equal(h.reads,0);assert.equal(h.discards,0)
 let next=all(tree).find(n=>n.type==='button'&&text(n)==='继续发给原 TA');assert.equal(next.props.disabled,true)
 tree=h.render({people:[{serverId:'person',name:'原人物'}],ready:true,onContinue:record=>continued.push(record.operationId)});next=all(tree).find(n=>n.type==='button'&&text(n)==='继续发给原 TA')
 next.props.onClick();assert.deepEqual(continued,['operation']);assert.equal(h.reads,0);assert(!all(tree).some(n=>n.type==='img'))
})
test('an active live camera does not gain a competing recovery action from foreground metadata polling',async()=>{
 const h=await harness({active:true});assert.equal(h.render(),null);await settle();assert.equal(h.render(),null);assert.equal(h.discards,0);assert.equal(h.reads,0)
})
test('missing pending metadata still displays actionable feedback instead of hiding the error',async()=>{
 const h=await harness({pending:false,missing:true});h.render();await settle();let tree=h.render()
 assert.match(text(tree),/CAPTURE_FILE_MISSING/);const retry=all(tree).find(n=>n.type==='button'&&text(n)==='重试查看');assert(retry)
 const before=h.reading;retry.props.onClick();h.render();await settle();assert.equal(h.reading,before+1)
 tree=h.render();all(tree).find(n=>n.type==='button'&&text(n)==='收起').props.onClick();assert.equal(h.render(),null);assert.equal(h.reads,0)
})
