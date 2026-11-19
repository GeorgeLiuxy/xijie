import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'

const json=(data,nextCursor=null)=>new Response(JSON.stringify({data,meta:{nextCursor}}),{headers:{'Content-Type':'application/json'}})
const denied=(status,code='REQUEST_FAILED')=>new Response(JSON.stringify({error:{code}}),{status})
const defer=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
const makeContext=()=>({accountId:randomUUID(),sessionId:randomUUID(),onUnauthorized(){}})
const memory=(personId,extra={})=>({id:randomUUID(),personId,title:'合成记忆标题',body:'合成手写原文',origin:'manual',version:1,confirmedAt:'2026-11-16T01:00:00Z',...extra})
const readNotice='暂时无法读取记忆，请稍后重试。'
const writeNotice='还没能确认记忆是否保存，内容已保留，请重试。'
const code=ts.transpileModule(await readFile(new URL('../src/serviceMemories.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText

// Run the actual hook against controlled acknowledgements and notice timers.
// The transport and hook scheduler are isolated; real-device acceptance is separate.
async function harness(fetcher){
 let stateIndex=0,refIndex=0,memoIndex=0,effectIndex=0,uid=0,timerId=0
 const states=[],refs=[],memos=[],effects=[],pending=[],timers=new Map(),storage=new Map(),notices=[]
 const later=(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id}
 const cancel=id=>timers.delete(id)
 const runtime=vm.createContext({fetch:(...args)=>fetcher(...args),crypto:globalThis.crypto,Headers,AbortController,DOMException,URLSearchParams,console,clearTimeout:cancel,
  window:{setTimeout:later,clearTimeout:cancel},sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}})
 const synthetic=values=>new vm.SyntheticModule(Object.keys(values),function(){for(const [name,value] of Object.entries(values))this.setExport(name,value)},{context:runtime})
 const imports={react:synthetic({
  useState(initial){const index=stateIndex++;if(!(index in states))states[index]=typeof initial==='function'?initial():initial;return [states[index],value=>{const next=typeof value==='function'?value(states[index]):value;if(!Object.is(next,states[index])&&typeof next==='string')notices.push(next);states[index]=next}]},
  useRef(initial){const index=refIndex++;return refs[index]??(refs[index]={current:initial})},
  useMemo(fn,deps){const index=memoIndex++,old=memos[index];if(!old||deps.some((value,i)=>value!==old.deps[i]))memos[index]={deps:[...deps],value:fn()};return memos[index].value},
  useEffect(fn,deps){const index=effectIndex++,old=effects[index];if(!old||deps.some((value,i)=>value!==old.deps[i]))pending.push(()=>{old?.cleanup?.();effects[index]={deps:[...deps],cleanup:fn()}})},
 }), './i18n':synthetic({isZh:()=>true,useI18n:()=>({lang:'zh-CN'})}),'./model':synthetic({nid:()=>++uid})}
 const module=new vm.SourceTextModule(code,{context:runtime})
 await module.link(spec=>imports[spec]??Promise.reject(new Error('Unexpected import '+spec)));await module.evaluate()
 const h={notices,flush(){while(pending.length)pending.shift()()},render(context,flush=true){stateIndex=refIndex=memoIndex=effectIndex=0;const result=module.namespace.useServiceMemories(context);if(flush)h.flush();return result},
  dismiss(context){h.render(context);for(const [id,timer] of [...timers])if(timer.delay===3000){timers.delete(id);timer.fn()}assert.equal(h.render(context).notice,null)},
  unmount(){effects.forEach(effect=>effect?.cleanup?.())}}
 return h
}

test('continuing network and 503 polling failures notify once, keep retrying, and retain confirmed originals',async t=>{
 for(const failure of ['network',503])await t.test(String(failure),async()=>{
  const personId=randomUUID(),original=memory(personId),ctx=makeContext();let offline=false,calls=0
  const h=await harness(async()=>{calls++;if(!offline)return json([original]);if(failure==='network')throw new TypeError('Synthetic disconnected transport');return denied(503,'SERVICE_UNAVAILABLE')})
  const service=h.render(ctx).service;await service.refresh([personId]);const before=h.render(ctx).records[personId][0]
  offline=true
  for(let i=0;i<4;i++){
   await service.refresh([personId]);const shown=h.render(ctx)
   assert.equal(shown.notice,i===0?readNotice:null)
   assert.equal(shown.records[personId][0].body,original.body);assert.equal(shown.records[personId][0].id,before.id)
   h.dismiss(ctx)
  }
  assert.equal(calls,5);assert.deepEqual(h.notices,[readNotice]);h.unmount()
 })
})

test('a complete current success resets notification even when the list is unchanged; a partial page does not',async()=>{
 const personId=randomUUID(),original=memory(personId),ctx=makeContext();let mode='seed',calls=0
 const h=await harness(async route=>{calls++;if(mode==='outage')return denied(503,'SERVICE_UNAVAILABLE');if(mode==='partial')return new URL(route,'http://local').searchParams.has('cursor')?denied(503,'SERVICE_UNAVAILABLE'):json([original],'next');return json([original])})
 const service=h.render(ctx).service;await service.refresh([personId])
 mode='outage';await service.refresh([personId]);h.dismiss(ctx)
 mode='partial';await service.refresh([personId]);assert.equal(h.render(ctx).notice,null);assert.equal(h.render(ctx).records[personId].length,1)
 mode='recovered';await service.refresh([personId]);assert.equal(h.render(ctx).notice,null)
 mode='outage';await service.refresh([personId]);assert.equal(h.render(ctx).notice,readNotice)
 assert.equal(calls,6);assert.deepEqual(h.notices,[readNotice,readNotice]);h.unmount()
})

test('changed failures and another person or session still receive their first truthful error',async()=>{
 const a=randomUUID(),b=randomUUID(),ctx=makeContext();let mode='network'
 const h=await harness(async()=>{if(mode==='network')throw new TypeError('Synthetic offline');return denied(503,'SERVICE_UNAVAILABLE')})
 const service=h.render(ctx).service
 await service.refresh([a]);h.dismiss(ctx)
 mode='service';await service.refresh([a]);assert.equal(h.render(ctx).notice,readNotice);h.dismiss(ctx)
 await service.refresh([b]);assert.equal(h.render(ctx).notice,readNotice);h.dismiss(ctx)
 const next={...ctx,sessionId:randomUUID()};await h.render(next).service.refresh([a]);assert.equal(h.render(next).notice,readNotice)
 assert.equal(h.notices.length,4);h.unmount()
})

test('invalid responses never replace confirmed originals or count as successful recovery',async()=>{
 const personId=randomUUID(),original=memory(personId),ctx=makeContext();let invalid=false
 const h=await harness(async()=>json(invalid?[{...original,version:0}]:[original]))
 const service=h.render(ctx).service;await service.refresh([personId]);invalid=true
 for(let i=0;i<3;i++){await service.refresh([personId]);assert.equal(h.render(ctx).records[personId][0].serverVersion,1);h.dismiss(ctx)}
 assert.deepEqual(h.notices,[readNotice]);h.unmount()
})

test('late failed refreshes cannot toast or erase a newer confirmed save',async t=>{
 for(const status of [503,401,403,404])await t.test(String(status),async()=>{
  const personId=randomUUID(),original=memory(personId),updated={...original,body:'合成已确认的新正文',version:2},ctx=makeContext(),gate=defer();let delayed=false
  const h=await harness(async(_route,init)=>init.method==='PATCH'?json(updated):delayed?gate.promise:json([original]))
  const service=h.render(ctx).service;await service.refresh([personId]);const shown=h.render(ctx).records[personId][0]
  delayed=true;const reading=service.refresh([personId]);const saved=await service.update(personId,shown,{...shown,body:updated.body});assert.equal(saved.serverVersion,2)
  gate.resolve(denied(status));await reading
  const result=h.render(ctx);assert.equal(result.notice,null);assert.equal(result.records[personId][0].serverVersion,2);assert.equal(result.records[personId][0].body,updated.body)
  assert.deepEqual(h.notices,[]);h.unmount()
 })
})

test('a superseded successful refresh does not reset a newer failure or replace newer cache',async()=>{
 const personId=randomUUID(),original=memory(personId),ctx=makeContext(),gate=defer();let mode='seed'
 const h=await harness(async()=>mode==='seed'?json([original]):mode==='old'?gate.promise:denied(503,'SERVICE_UNAVAILABLE'))
 const service=h.render(ctx).service;await service.refresh([personId]);mode='old';const old=service.refresh([personId])
 mode='new';await service.refresh([personId]);h.dismiss(ctx)
 gate.resolve(json([]));await old
 await service.refresh([personId]);assert.equal(h.render(ctx).notice,null);assert.equal(h.render(ctx).records[personId][0].serverId,original.id)
 assert.deepEqual(h.notices,[readNotice]);h.unmount()
})

test('manual read, save, update and remove still report real failures during a continuing background outage',async()=>{
 const personId=randomUUID(),original=memory(personId),ctx=makeContext();let offline=false
 const h=await harness(async()=>offline?denied(503,'SERVICE_UNAVAILABLE'):json([original]))
 const service=h.render(ctx).service;await service.refresh([personId]);const shown=h.render(ctx).records[personId][0];offline=true
 await service.refresh([personId]);h.dismiss(ctx)
 await service.refresh([personId]);assert.equal(h.render(ctx).notice,null)
 assert.equal(await service.read(personId,shown),undefined);assert.equal(h.render(ctx).notice,readNotice);h.dismiss(ctx)
 assert.equal(await service.save(personId,{id:500,title:'合成新标题',body:'合成新正文'}),undefined);assert.equal(h.render(ctx).notice,writeNotice);h.dismiss(ctx)
 assert.equal(await service.update(personId,shown,{...shown,body:'合成修改正文'}),undefined);assert.equal(h.render(ctx).notice,writeNotice);h.dismiss(ctx)
 assert.equal(await service.remove(personId,shown),false);assert.equal(h.render(ctx).notice,writeNotice)
 assert.equal(h.render(ctx).records[personId][0].body,original.body);assert.deepEqual(h.notices,[readNotice,readNotice,writeNotice,writeNotice,writeNotice]);h.unmount()
})

test('current 401, 403 and 404 responses preserve their authority and cache invalidation behavior',async t=>{
 for(const status of [401,403,404])await t.test(String(status),async()=>{
  const personId=randomUUID(),original=memory(personId);let unauthorized=0,mode='seed'
  const ctx={...makeContext(),onUnauthorized:()=>unauthorized++}
  const h=await harness(async()=>mode==='seed'?json([original]):mode==='network'?Promise.reject(new TypeError('Synthetic offline')):denied(status))
  const service=h.render(ctx).service;await service.refresh([personId]);mode='network';await service.refresh([personId]);h.dismiss(ctx)
  mode='authority';await service.refresh([personId]);const shown=h.render(ctx)
  assert.equal(shown.records[personId].length,0);assert.equal(unauthorized,status===401?1:0)
  assert.equal(shown.notice,status===404?null:status===403?'暂时无法查看或保存记忆，请到「我」的「隐私与 AI 说明」查看同意状态。':readNotice);h.unmount()
 })
})

test('old-session refresh failures cannot notify or invalidate the newly rendered session',async()=>{
 const personId=randomUUID(),ctx=makeContext(),gate=defer();let unauthorized=0
 ctx.onUnauthorized=()=>unauthorized++
 const h=await harness(()=>gate.promise),old=h.render(ctx).service.refresh([personId])
 const next={...ctx,accountId:randomUUID(),sessionId:randomUUID()};h.render(next,false)
 gate.resolve(denied(401));await old
 assert.equal(unauthorized,0);assert.equal(h.render(next).notice,null);assert.deepEqual(h.notices,[]);h.unmount()
})
