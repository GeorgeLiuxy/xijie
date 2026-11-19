import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'
const code=ts.transpileModule((await readFile(new URL('../src/PersonVoiceInput.tsx',import.meta.url),'utf8')).replace('function VoiceEditor(', 'export function VoiceEditor('),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React}}).outputText
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)}},settle=async()=>{for(let n=0;n<8;n++)await Promise.resolve()},metadata=()=>({id:randomUUID(),version:1,durationMs:1000,mimeType:'audio/wav',byteSize:48044,sha256:'a'.repeat(64)})
function nodes(tree){return !tree||typeof tree!=='object'?[]:[tree,...(tree.props.children??[]).flat(Infinity).flatMap(nodes)]}
function label(tree){return !tree?'':typeof tree==='string'?tree:typeof tree==='object'?(tree.props.children??[]).flat(Infinity).map(label).join(''):''}
async function harness(override={}){
 let si=0,ri=0,ei=0,current=true,tree,props;const states=[],refs=[],effects=[],pending=[],listeners=new Map(),events=[],urls=[],revoked=[]
 const voice={...metadata(),status:'ready'},accountId=randomUUID(),sessionId=randomUUID(),targetId=randomUUID(),api={pending:undefined,pendingDeletions:[],dispose(){events.push('dispose')},async save(){return voice},async playback(){return new Blob(['canonical'])},markBinding(){events.push('mark')},acknowledgeBound(){events.push('ack')},async remove(){events.push('remove')},async discard(){events.push('discard')},...override}
 const context=vm.createContext({Blob,DOMException,AbortController,console,React:{createElement:(type,props,...children)=>({type,props:{...props,children}})},URL:{createObjectURL(){const value='blob:test-'+urls.length;urls.push(value);return value},revokeObjectURL:u=>revoked.push(u)},navigator:{mediaDevices:undefined},document:{visibilityState:'visible',addEventListener(){},removeEventListener(){}},window:{setTimeout,clearTimeout,setInterval,clearInterval,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name)}},clearTimeout,clearInterval})
 const synth=exports=>new vm.SyntheticModule(Object.keys(exports),function(){for(const[k,v]of Object.entries(exports))this.setExport(k,v)},{context})
 const react=synth({useState(v){const n=si++;if(!(n in states))states[n]=v;return [states[n],value=>{states[n]=typeof value==='function'?value(states[n]):value}]},useRef(v){const n=ri++;return refs[n]??(refs[n]={current:v})},useEffect(fn,deps){const n=ei++,old=effects[n];if(!old||deps.some((d,i)=>d!==old.deps[i]))pending.push(()=>{old?.cleanup?.();effects[n]={deps,cleanup:fn()}})}})
 class PersonVoiceError extends Error{constructor(status,code){super(code);this.status=status;this.code=code}}
 const module=new vm.SourceTextModule(code,{context});await module.link(name=>name==='react'?react:name==='./i18n'?synth({useI18n:()=>({lang:'zh-CN'}),isZh:()=>true}):name==='./ui'?synth({I:{Mic(){}}}):name==='./auth/AiTextPermission'?synth({PersonVoiceStoragePermission(){}}):name==='./personVoiceRecorder'?synth({createPersonVoiceRecorder:()=>({dispose(){events.push('stop recording')},cancel(){events.push('cancel recording')}})}):name==='./servicePersonVoices'?synth({createPersonVoiceClient:()=>api,PersonVoiceError}):Promise.reject(Error('Unexpected import '+name)));await module.evaluate()
 props={context:{accountId,sessionId,onUnauthorized(){}},targetId,readyVoice:voice,current:()=>current,ensureTarget:async()=>({accountId,sessionId,draftId:targetId,onUnauthorized(){}}),onBind:async id=>events.push(['bind',id]),onBusy:value=>events.push(['busy',value])}
 const render=(next={})=>{props={...props,...next};si=ri=ei=0;tree=module.namespace.VoiceEditor(props);while(pending.length)pending.shift()();return tree}
 const find=(name,type='button')=>{const node=nodes(render()).find(v=>v.type===type&&(v.props['aria-label']===name||label(v)===name));assert(node,'Missing '+name);return node}
 render()
 return {api,events,voice,urls,revoked,render,find,current(value){current=value},emit:name=>listeners.get(name)?.({}),choose(){find('人物声音文件','input').props.onChange({target:{files:[new Blob(['actual user audio'],{type:'audio/wav'})],value:'audio.wav'}});render()},unmount(){for(const effect of effects)effect.cleanup?.()}}
}
test('a render-time owner fence stops a late upload before People binding and retains recovery metadata',async()=>{
 const wait=deferred(),h=await harness({save:()=>wait.promise});h.choose();h.find('保存这段声音').props.onClick();await settle();h.current(false);wait.resolve(h.voice);await settle();assert(!h.events.some(e=>Array.isArray(e)&&e[0]==='bind'));assert(!h.events.includes('ack'));h.unmount();assert(h.events.includes('dispose'));assert(h.urls.every(u=>h.revoked.includes(u)))
})
test('canceling an old playback releases its busy token, and its late finally cannot unlock a newer save',async()=>{
 const playing=deferred(),saving=deferred(),h=await harness({playback:()=>playing.promise,save:()=>saving.promise});h.find('聆听原声').props.onClick();await settle();h.emit('xijie:consents-changed');h.choose();h.find('保存这段声音').props.onClick();await settle();playing.resolve(new Blob(['late audio']));await settle();assert.deepEqual(h.events.filter(e=>Array.isArray(e)&&e[0]==='busy').at(-1),['busy',true]);assert(!h.urls.some(u=>u==='blob:test-1'));saving.resolve(h.voice);await settle();assert(h.events.includes('ack'));assert.deepEqual(h.events.filter(e=>Array.isArray(e)&&e[0]==='busy').at(-1),['busy',false]);h.unmount()
})

