import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'
const code=ts.transpileModule(await readFile(new URL('../src/serviceReferrals.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const response=data=>new Response(JSON.stringify({data}),{headers:{'Content-Type':'application/json'}})
const deny=(status,code)=>new Response(JSON.stringify({error:{code}}),{status})
const link=()=>({id:randomUUID(),publicName:'分享用称呼',url:'http://localhost/invite/'+'a'.repeat(43),status:'active',version:1,createdAt:new Date().toISOString()})
const status=link=>({link,records:[],receivedRewardCount:0})
async function harness(fetch,storage=new Map()){
 const context=vm.createContext({fetch,crypto:globalThis.crypto,URL,DOMException,AbortController,location:{origin:'http://localhost'},sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}})
 const module=new vm.SourceTextModule(code,{context});await module.link(()=>{throw Error('Unexpected runtime import')});await module.evaluate();return {api:module.namespace,storage}
}
test('unknown create result freezes its name and key across reopening without preview rewards',async()=>{
 const value=link(),calls=[],storage=new Map(),ctx={accountId:randomUUID(),sessionId:randomUUID(),onUnauthorized(){}}
 let posted=0
 const transport=async(path,init)=>{if(init.method==='POST'){calls.push({key:init.headers['Idempotency-Key'],body:init.body,session:init.headers['X-Xijie-Expected-Session']});if(++posted===1)throw TypeError('lost response');return response(value)}return response({...status(value),receivedRewardCount:2})}
 let h=await harness(transport,storage),client=h.api.createReferralClient(ctx)
 await assert.rejects(client.create('分享用称呼'));client.dispose()
 h=await harness(transport,storage);client=h.api.createReferralClient(ctx)
 assert.equal(client.pendingName,'分享用称呼');const saved=await client.create('不能替换的修改')
 assert.deepEqual(calls[0],calls[1]);assert.equal(saved.shareUrl,value.url);assert.equal(saved.rewardedCount,2);assert.equal(saved.rewards.length,0);assert.equal(storage.size,0)
})
test('disposal fences late server success and cannot sign out a replacement account',async()=>{
 let resolve,notify=0;const wait=new Promise(r=>resolve=r),h=await harness(()=>wait),client=h.api.createReferralClient({accountId:randomUUID(),sessionId:randomUUID(),onUnauthorized(){notify++}})
 const reading=client.status();client.dispose();resolve(deny(401,'UNAUTHENTICATED'))
 await assert.rejects(reading,{name:'AbortError'});assert.equal(notify,0)
})
test('a stored share link must point to this application and cannot become a script or remote redirect',async()=>{
 const h=await harness(()=>response({})),value=link()
 for(const url of ['javascript:alert(1)','https://elsewhere.test/invite/'+'a'.repeat(43),'http://localhost/invite/'+'a'.repeat(43)+'?leak=yes'])assert.throws(()=>h.api.referralStatus(status({...value,url})),{code:'INVALID_RESPONSE'})
 assert.equal(h.api.referralStatus(status(value)).inviteId,value.id)
})
test('public join records the browser intent only after explicit action and binds existing session',async()=>{
 const session=randomUUID(),calls=[],h=await harness(async(path,init)=>{calls.push({path,init});if(path==='/v1/sessions/current')return response({id:session});if(init.method==='POST')return response({invitationIntentId:null,expiresAt:null});return response({publicName:'朋友',campaign:'first-memory-v1'})})
 await h.api.publicReferral('a'.repeat(43));assert.equal(calls.length,1);assert.equal(calls[0].init.method,undefined)
 await h.api.joinReferral('a'.repeat(43));assert.equal(calls.length,3);assert.equal(calls[2].init.headers['X-Xijie-Expected-Session'],session);assert.equal(calls[2].init.body,'{}')
})

test('a revoked accepted link settles its old creation receipt without exposing the revoked URL',async()=>{
 const v=link(),storage=new Map(),ctx={accountId:randomUUID(),sessionId:randomUUID(),onUnauthorized(){}};let n=0
 const fetch=async(path,init)=>{if(init.method==='POST'){if(++n===1)throw TypeError('lost response');return response({...v,status:'revoked',version:2,url:null})}return response(status(null))}
 let h=await harness(fetch,storage);await assert.rejects(h.api.createReferralClient(ctx).create(v.publicName))
 h=await harness(fetch,storage);const c=h.api.createReferralClient(ctx),result=await c.create('cannot replace');assert.equal(result.inviteId,null);assert.equal(storage.size,0);assert.equal(c.pendingName,undefined)
})
