import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText
async function functionSource(path,name){const source=await readFile(new URL(path,import.meta.url),'utf8'),ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert(node);return node.getText(ast)}
const nodes=n=>n&&typeof n==='object'?[n,...(n.props?.children??[]).flat(Infinity).flatMap(nodes)]:[]
const text=n=>typeof n==='string'?n:n&&typeof n==='object'?(n.props?.children??[]).flat(Infinity).map(text).join(''):''
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r))}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
async function reminderHarness(initial){
 let si=0,ri=0,ei=0,props=initial;const states=[],refs=[],effects=[],queued=[]
 const context=vm.createContext({React:{createElement:(type,props,...children)=>({type,props:{...props,children}})},Switch:'Switch',useI18n:()=>({lang:'zh-CN',t:k=>k}),useState(v){const i=si++;if(!(i in states))states[i]=typeof v==='function'?v():v;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useRef(v){const i=ri++;return refs[i]??(refs[i]={current:v})},useEffect(fn,deps){const i=ei++,old=effects[i];if(!old||deps.some((v,j)=>v!==old.deps[j]))queued.push(()=>{old?.cleanup?.();effects[i]={deps:[...deps],cleanup:fn()}})}})
 vm.runInContext(compile(await functionSource('../src/profile.tsx','PersonReminder')+'\nglobalThis.component=PersonReminder'),context)
 const render=(next={})=>{props={...props,...next};si=ri=ei=0;const tree=context.component(props);while(queued.length)queued.shift()();return tree}
 const find=label=>{const node=nodes(render()).find(n=>n.type==='button'&&text(n)===label);assert(node,'Missing button '+label);return node}
 return{render,find,switch:()=>nodes(render()).find(n=>n.type==='Switch'),unmount:()=>effects.forEach(e=>e?.cleanup?.())}
}
test('an unread reminder setting is shown as loading or unavailable rather than a false Off switch',async()=>{
 const read=deferred();const h=await reminderHarness({personId:'one',service:{setting:()=>read.promise}})
 h.render();assert.equal(h.switch(),undefined);assert(text(h.render()).includes('正在加载提醒设置'))
 read.reject(Error('offline'));await settle();assert.equal(h.switch(),undefined);assert(text(h.render()).includes('提醒设置暂时不可用'));assert(h.find('刷新设置'));h.unmount()
})
test('switching person or service cannot display a late reminder setting from the previous scope',async()=>{
 const a=deferred(),b=deferred(),serviceA={setting:()=>a.promise},serviceB={setting:()=>b.promise}
 const h=await reminderHarness({personId:'one',service:serviceA});h.render();h.render({service:serviceB});b.resolve({personId:'one',enabled:true,version:2});await settle();assert.equal(h.switch().props.on,true)
 a.resolve({personId:'one',enabled:false,version:1});await settle();assert.equal(h.switch().props.on,true)
 const c=deferred();h.render({personId:'two',service:{setting:()=>c.promise}});assert.equal(h.switch(),undefined);h.unmount();c.resolve({personId:'two',enabled:false});await settle()
})
test('Retry saving keeps the original intended reminder value after an unknown response',async()=>{
 const desired=[],service={setting:async()=>({personId:'one',enabled:false,version:1}),set:async(setting,enabled)=>{desired.push(enabled);if(desired.length===1)throw{pendingEnabled:enabled};return{...setting,enabled,version:2}}}
 const h=await reminderHarness({personId:'one',service});h.render();await settle();h.switch().props.onToggle();await settle();assert.equal(h.switch().props.on,false);h.find('重试保存').props.onClick();await settle();assert.deepEqual(desired,[true,true]);assert.equal(h.switch().props.on,true);h.unmount()
})
test('refreshing after a reminder conflict reads the latest choice without toggling it again',async()=>{
 let reads=0,writes=0;const service={setting:async()=>({personId:'one',enabled:++reads>1,version:reads}),set:async()=>{writes++;throw{code:'VERSION_CONFLICT'}}}
 const h=await reminderHarness({personId:'one',service});h.render();await settle();h.switch().props.onToggle();await settle();assert.equal(h.switch().props.on,true);h.find('刷新设置').props.onClick();await settle();assert.equal(writes,1);assert.equal(reads,3);assert.equal(h.switch().props.on,true);h.unmount()
})
test('language choices clearly disable unavailable translations and do not silently select English for them',async()=>{
 const source=await readFile(new URL('../src/i18n.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('i18n.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),definition=ast.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(v=>v.name.getText(ast)==='LANGS'));assert(definition)
 const selected=[];let closed=0;const context=vm.createContext({React:{createElement:(type,props,...children)=>({type,props:{...props,children}})},useI18n:()=>({lang:'zh-CN',setLang:v=>selected.push(v)}),isZh:l=>l.startsWith('zh'),I:{Check:'check'}})
 vm.runInContext(compile(definition.getText(ast).replace(/^export\s+/,'')+'\n'+await functionSource('../src/shell.tsx','LanguageOptions')+'\nglobalThis.component=LanguageOptions'),context)
 const buttons=nodes(context.component({onSelect:()=>closed++})).filter(n=>n.type==='button');assert.equal(buttons.length,5)
 for(const button of buttons){const available=['zh-CN','en'].includes(button.props.key);assert.equal(button.props.disabled,!available);if(!available){assert(text(button).includes('暂未提供'));button.props.onClick()}}
 assert.equal(selected.length,0);buttons.find(b=>b.props.key==='en').props.onClick();assert.deepEqual(selected,['en']);assert.equal(closed,1)
})
