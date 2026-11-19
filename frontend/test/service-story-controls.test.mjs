import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'
const code=ts.transpileModule(await readFile(new URL('../src/serviceStoryControls.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
async function client(fetch,storage,actor){
 const context=vm.createContext({fetch,crypto:globalThis.crypto,URL,Headers,URLSearchParams,DOMException,AbortSignal,sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}})
 const m=new vm.SourceTextModule(code,{context});await m.link(()=>{throw Error('Unexpected import')});await m.evaluate();return m.namespace.storyClient(actor,new AbortController().signal)
}
const response=data=>new Response(JSON.stringify({data}))
test('story fork retries preserve the exact accepted command after authority change or an invalid acknowledgement',async()=>{
 for(const failure of [()=>new Response(JSON.stringify({error:{code:'AUTHORIZATION_CHANGED'}}),{status:403}),()=>response({})]){
  const actor={accountId:randomUUID(),sessionId:randomUUID(),personId:randomUUID(),onUnauthorized(){}},storage=new Map(),calls=[];let n=0
  const branch={id:randomUUID(),personId:actor.personId,conversationId:randomUUID(),name:'最初分支',version:1,createdAt:new Date().toISOString(),scene:{world:{id:randomUUID(),code:'tide',displayName:'潮汐'},worldVersion:1},fork:{conversationId:randomUUID(),messageSequence:'2',eventRevision:'1'},canSend:true}
  const fetch=async(path,init)=>{calls.push({path,body:init.body,key:init.headers.get('Idempotency-Key')});return ++n===1?failure():response(branch)}
  let api=await client(fetch,storage,actor);await assert.rejects(api.create('最初分支'));assert.equal(storage.size,1)
  api=await client(fetch,storage,actor);assert.equal((await api.create('不能替换')).id,branch.id);assert.deepEqual(calls[0],calls[1]);assert.equal(storage.size,0)
 }
})

test('offline stale-version rejection retires only the unaccepted command and permits a fresh version',async()=>{
 const actor={accountId:randomUUID(),sessionId:randomUUID(),personId:randomUUID(),onUnauthorized(){}},storage=new Map(),calls=[];let n=0
 const api=await client(async(path,init)=>{calls.push(init.headers.get('Idempotency-Key'));return ++n===1?new Response(JSON.stringify({error:{code:'VERSION_CONFLICT'}}),{status:412}):response({personId:actor.personId,enabled:false,timeZone:'UTC',version:4,nextRunAt:null,lastRunAt:null})},storage,actor)
 await assert.rejects(api.setOffline(false,2));assert.equal(storage.size,0);assert.equal(api.pending,undefined)
 await api.setOffline(false,3);assert.notEqual(calls[0],calls[1])
})
