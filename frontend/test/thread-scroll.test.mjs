import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'
const source=ts.transpileModule(await readFile(new URL('../src/useThreadScroll.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
async function harness(){
 let si=0,ri=0,ei=0,li=0,tid=0;const states=[],refs=[],effects=[],layouts=[],pending=[],layoutPending=[],timers=new Map(),listeners=new Map(),rows=[]
 const list={clientHeight:400,scrollTop:0,scrollHeight:3000,querySelector(selector){return rows.find(row=>selector.includes('data-server-message-id')?selector.includes(row.serverId):selector.includes('"'+row.dataset.messageId+'"'))},querySelectorAll(){return rows},scrollTo({top}){this.scrollTop=top},addEventListener(n,f){listeners.set(n,f)},removeEventListener(n){listeners.delete(n)}}
 const context=vm.createContext({window:{setTimeout(fn,ms){timers.set(++tid,{fn,ms});return tid},clearTimeout(id){timers.delete(id)}}})
 const synthetic=values=>new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v)},{context})
 const effect=(storage,queue,index,fn,deps)=>{const old=storage[index];if(!old||deps.some((v,j)=>v!==old.deps[j]))queue.push(()=>{old?.cleanup?.();storage[index]={deps,cleanup:fn()}})}
 const imports={react:synthetic({useState(v){const i=si++;if(!(i in states))states[i]=v;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useRef(v){const i=ri++;return refs[i]??(refs[i]={current:v})},useEffect(fn,deps){effect(effects,pending,ei++,fn,deps)},useLayoutEffect(fn,deps){effect(layouts,layoutPending,li++,fn,deps)}}),'./ui':synthetic({fxPrefs:{calm:true}})}
 const module=new vm.SourceTextModule(source,{context});await module.link(n=>imports[n]);await module.evaluate()
 return {list,rows,timers,render(thread,focus){si=ri=ei=li=0;const result=module.namespace.useThreadScroll(thread,false,focus);result.scroller.current=list;while(layoutPending.length)layoutPending.shift()();while(pending.length)pending.shift()();return result},scroll(){listeners.get('scroll')?.()},expire(){for(const [id,t]of [...timers]){timers.delete(id);t.fn()}},unmount(){effects.forEach(e=>e.cleanup?.())}}
}
test('a slow UUID target centers only on DOM arrival and receives the full 2.2 second highlight once',async()=>{
 const h=await harness(),anchor='synthetic-uuid',empty=[];h.render(empty,anchor);h.render(empty,anchor);assert.equal(h.timers.size,0);assert.equal(h.list.scrollTop,0)
 const thread=[{id:1,kind:'him',serverId:anchor,text:'合成旧消息'}];h.rows.push({serverId:anchor,dataset:{messageId:'1'},offsetTop:1200,offsetHeight:60})
 h.render(thread,anchor);let state=h.render(thread,anchor);assert.equal(h.list.scrollTop,1030);assert.equal(state.highlighted,1);assert.equal([...h.timers.values()][0].ms,2200)
 h.expire();state=h.render(thread,anchor);assert.equal(state.highlighted,undefined);h.render([...thread],anchor);assert.equal(h.timers.size,0);h.unmount()
})
test('older/newer expansions and poll changes preserve the visible row; leaving anchor returns to recent',async()=>{
 const h=await harness(),anchor='synthetic-uuid',thread=[{id:1,kind:'him',serverId:anchor,text:'合成旧消息'}]
 h.rows.push({serverId:anchor,dataset:{messageId:'1'},offsetTop:1200,offsetHeight:60});h.render(thread,anchor);h.render(thread,anchor)
 h.list.scrollTop=1150;h.scroll();h.rows[0].offsetTop+=2000;h.list.scrollHeight+=2000;h.render([{id:2,kind:'me',text:'更早'},...thread],anchor);assert.equal(h.list.scrollTop,3150)
 h.render([...thread,{id:3,kind:'me',text:'更晚'}],anchor);assert.equal(h.list.scrollTop,3150)
 h.render([...thread,{id:4,kind:'me',text:'刚发送'}],undefined);assert.equal(h.list.scrollTop,h.list.scrollHeight);h.unmount()
})
