import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'

const code = ts.transpileModule(await readFile(new URL('../src/mobile/chatCapture.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const copy = value => JSON.parse(JSON.stringify(value))
const failure = code => Object.assign(new Error('Controlled native failure'),{code,data:{status:503}})
const deferred = () => { let resolve; const promise=new Promise(r=>resolve=r);return {promise,resolve} }
const bytes=Buffer.from([255,216,255,0,1,2,255,217]),sha256=createHash('sha256').update(bytes).digest('hex')
function fixture(){const owner={accountId:randomUUID(),sessionId:randomUUID(),personId:randomUUID(),conversationId:randomUUID()},createdAtMs=Date.now();return {operationId:randomUUID(),owner,pageId:randomUUID(),state:'ready',revision:1,createdAtMs,expiresAtMs:createdAtMs+3600000,restored:true,prepared:{width:1,height:1,sha256,byteSize:bytes.length,mimeType:'image/jpeg'}}}
async function harness(initial=fixture(),options={}){
 let current=copy(initial),readGate,loseCheckpoint=false;const calls=[],cleared=[]
 const native=async(plugin,method,data)=>{
  assert.equal(plugin,'ChatCapture');calls.push({method,data:copy(data)})
  if(options.override){const result=await options.override(method,data);if(result!==undefined)return result}
  if(method==='reconcileOwner'){
   if(data.identity===null){const match=current&&data.expectedOperationId===current.operationId&&JSON.stringify(data.expectedOwner)===JSON.stringify(current.owner);if(match)current=undefined;return {cleared:!!match}}
   return {cleared:false}
  }
  if(method==='getPending')return current?{pending:true,capture:{...copy(current),restored:data.pageId!==current.pageId}}:{pending:false}
  if(method==='capture'){current={...fixture(),operationId:data.operationId,owner:data.owner,pageId:data.pageId,restored:false};return copy(current)}
  if(method==='read'){if(readGate)await readGate.promise;return {...copy(current.prepared),operationId:current.operationId,revision:current.revision,base64:bytes.toString('base64')}}
  if(method==='checkpoint'){
   if(data.expectedRevision!==current.revision)throw failure('CAPTURE_VERSION_CONFLICT')
   current={...current,plan:copy(data.plan),revision:current.revision+1};if(loseCheckpoint){loseCheckpoint=false;throw failure('CAPTURE_STORAGE_UNAVAILABLE')}
   return {operationId:current.operationId,revision:current.revision}
  }
  if(method==='release'){const match=current&&data.operationId===current.operationId&&JSON.stringify(data.owner)===JSON.stringify(current.owner);if(match)current=undefined;return {operationId:data.operationId,cleared:!current}}
  throw Error('Unexpected native method')
 }
 const context=vm.createContext({crypto:globalThis.crypto,TextEncoder,Uint8Array,Blob,atob,DOMException,Date,window:{Capacitor:{isNativePlatform:()=>true,getPlatform:()=> 'android',isPluginAvailable:()=>true,nativePromise:native}}})
 const module=new vm.SourceTextModule(code,{context});await module.link(name=>{assert.equal(name,'../serviceChatPhotos');return new vm.SyntheticModule(['clearCapturePhotoJournals'],function(){this.setExport('clearCapturePhotoJournals',async record=>cleared.push(copy(record)))},{context})});await module.evaluate()
 const api=module.namespace;api.setChatCaptureIdentity(initial.owner);const client=new api.ChatCaptureClient(initial.owner,()=>true)
 return {api,client,calls,cleared,get current(){return current},set current(value){current=value},pauseRead(){readGate=deferred();return readGate},loseCheckpoint(){loseCheckpoint=true}}
}
const photoIntent = record => ({personId:record.owner.personId,conversationId:record.owner.conversationId,clientMessageId:record.operationId,key:record.operationId,metadata:{mimeType:'image/jpeg',byteSize:bytes.length,sha256}})

test('capture UUIDv8 identities match the approved vectors and each document keeps one page identity',async()=>{
 const h=await harness(),op='018f0e0a-9c2b-7a34-8c55-710d6d0ec305'
 for(const [label,expected]of Object.entries({allocate:'06f69c46-844f-890e-90a2-09860135deaa',upload:'897b5983-53a0-8f4f-a14d-ac26a57e5384',complete:'1989e00b-d632-8f76-b750-e4f368429b65','renewal:3':'a4a7d84a-8d2f-800a-b280-fecc079ea7dc','renewal-upload:3':'833ac227-934a-805a-b079-e8d93847a651','renewal-complete:3':'6b9e427b-70e6-8646-a4f3-4b1033e4846a'}))assert.equal(await h.api.captureKey(op,label),expected)
 await h.client.refresh();const next=new h.api.ChatCaptureClient(h.current.owner,()=>true);await next.refresh()
 assert.equal(h.calls[0].data.pageId,h.calls[1].data.pageId)
})

test('cold pending reads expose metadata only and prepared bytes require the explicit original transaction',async()=>{
 const h=await harness(),record=await h.client.refresh();assert.equal(record.restored,true);assert.deepEqual(h.calls.map(c=>c.method),['getPending'])
 const transaction=h.client.transaction(record,()=>true),prepared=await transaction.read()
 assert.equal(prepared.mimeType,'image/jpeg');assert.equal(prepared.sha256,sha256);assert.deepEqual(Buffer.from(await prepared.blob.arrayBuffer()),bytes)
 assert.equal(h.calls.at(-1).method,'read');assert.equal('kind'in h.calls.at(-1).data,false)
 assert.deepEqual(Object.keys(h.calls[0].data.identity).sort(),['accountId','sessionId'])
})

test('changed image bytes, unexpected native fields and late identity changes are rejected before checkpoint or upload',async()=>{
 const h=await harness(undefined,{override:(method)=>method==='read'?{...fixture().prepared,operationId:h.current.operationId,revision:h.current.revision,base64:Buffer.from('different').toString('base64')}:undefined})
 const record=await h.client.refresh();await assert.rejects(h.client.transaction(record,()=>true).read(),e=>e.code==='CAPTURE_INVALID_RESPONSE')
 assert(!h.calls.some(c=>c.method==='checkpoint'))
 const late=await harness(),pending=await late.client.refresh(),gate=late.pauseRead(),read=late.client.transaction(pending,()=>true).read()
 late.api.setChatCaptureIdentity(undefined);late.api.setChatCaptureIdentity(pending.owner);gate.resolve()
 await assert.rejects(read,e=>e.name==='AbortError');assert(!late.calls.some(c=>c.method==='reconcileOwner'))
})

test('global single flight is registered before native launch and duplicate callers reuse the same send',async()=>{
 const h=await harness(),operation=h.client.operationId(),gate=deferred();let starts=0
 const first=h.client.run(operation,async()=>{starts++;await gate.promise;return h.client.launch(h.current.owner,operation)})
 assert.equal(h.client.active(operation),true);const second=h.client.run(operation,async()=>{throw Error('duplicate launch')})
 gate.resolve();const [a,b]=await Promise.all([first,second]);assert.equal(starts,1);assert.equal(a.operationId,b.operationId);assert.equal(h.calls.filter(c=>c.method==='capture').length,1)
})

test('checkpoint failures stop the plan transition and refresh restores its actual durable revision and identities',async()=>{
 const h=await harness(),record=await h.client.refresh(),transaction=h.client.transaction(record,()=>true);h.loseCheckpoint()
 await assert.rejects(transaction.photo(photoIntent(record)),e=>e.code==='CAPTURE_STORAGE_UNAVAILABLE')
 assert.equal(h.current.revision,2);assert.equal(h.current.plan.photoIntent.key,record.operationId)
 const restored=await h.client.refresh(),retry=h.client.transaction(restored,()=>true)
 await retry.photo(photoIntent(restored));assert.equal(h.current.plan.photoIntent.clientMessageId,record.operationId)
 assert(!h.calls.some(c=>c.method==='release'))
})

test('discard and sign-out cleanup bind the original owner and operation and cannot clear a later capture',async()=>{
 const h=await harness(),old=await h.client.refresh(),next={...fixture(),owner:old.owner};h.current=next;await h.client.refresh()
 await assert.rejects(h.client.discard(old),e=>e.code==='CAPTURE_STORAGE_UNAVAILABLE');assert.equal(h.current.operationId,next.operationId)
 await h.api.clearKnownChatCapture(old.owner);assert.equal(h.current,undefined)
 const cleanup=h.calls.find(c=>c.method==='release'&&c.data.reason==='owner_changed'&&c.data.operationId===next.operationId).data;assert.deepEqual(cleanup.owner,copy(next.owner))
 assert(h.cleared.some(record=>record.operationId===next.operationId));assert(h.calls.filter(c=>c.method==='release').every(c=>c.data.owner&&c.data.operationId))
})

test('a rejected new capture cannot replace the positively observed operation used by logout cleanup',async()=>{
 const h=await harness(undefined,{override:method=>{if(method==='capture')throw failure('CAPTURE_PENDING')}}),original=await h.client.refresh()
 await assert.rejects(h.client.launch(original.owner,randomUUID()),e=>e.code==='CAPTURE_PENDING')
 assert.equal(h.client.pending().operationId,original.operationId)
 await h.api.clearKnownChatCapture(original.owner);assert.equal(h.current,undefined)
 assert.equal(h.calls.filter(c=>c.method==='release'&&c.data.reason==='owner_changed').at(-1).data.operationId,original.operationId)
})

test('an older pending read cannot replace a newer checkpoint or erase the newer cleanup plan',async()=>{
 let old,returnOld=false
 const h=await harness(undefined,{override:method=>method==='getPending'&&returnOld?{pending:true,capture:old}:undefined})
 const initial=await h.client.refresh();old=copy(initial)
 await h.client.transaction(initial,()=>true).photo(photoIntent(initial));assert.equal(h.client.pending().revision,2)
 returnOld=true;const read=await h.client.refresh();assert.equal(read.revision,2)
 await h.api.clearKnownChatCapture(initial.owner);assert.equal(h.cleared.at(-1).revision,2);assert(h.cleared.at(-1).plan.photoIntent)
})

test('an expired held capture can still be explicitly discarded without reading or transmitting its photo',async()=>{
 const h=await harness(),record=await h.client.refresh();record.createdAtMs=Date.now()-3601000;record.expiresAtMs=record.createdAtMs+3600000
 const before=h.calls.length;await h.client.discard(record);assert.equal(h.current,undefined)
 assert.deepEqual(h.calls.slice(before).map(c=>c.method),['release']);assert.equal(h.cleared.at(-1).operationId,record.operationId)
})

test('a late unscoped signed-out cleanup cannot clear a newly verified capture',async()=>{
 const h=await harness(),record=await h.client.refresh(),before=h.calls.length
 await h.api.clearKnownChatCapture();assert.equal(h.calls.length,before);assert.equal(h.current.operationId,record.operationId)
 h.api.setChatCaptureIdentity(undefined);await h.api.clearKnownChatCapture();assert.equal(h.current,undefined)
})

test('sent cleanup refuses a fabricated receipt before crossing the native bridge',async()=>{
 const h=await harness(),record=await h.client.refresh(),transaction=h.client.transaction(record,()=>true),before=h.calls.length
 await assert.rejects(transaction.sent({messageId:randomUUID(),conversationId:record.owner.conversationId,clientMessageId:record.operationId,mediaId:randomUUID(),mediaVersion:1}),e=>e.code==='CAPTURE_INVALID_RESPONSE')
 assert.equal(h.calls.length,before);assert(h.current)
})

test('an outdated native cookie reader keeps pending state and asks for the WebView update without signing out',async()=>{
 const h=await harness(undefined,{override:method=>{if(method==='getPending')throw failure('CAPTURE_WEBVIEW_OUTDATED')}})
 let observed;try{await h.client.refresh()}catch(error){observed=error};assert.equal(observed.code,'CAPTURE_WEBVIEW_OUTDATED')
 assert(h.current);assert(!h.calls.some(c=>c.method==='release'||c.method==='reconcileOwner'))
 assert.match(h.api.captureFailure(observed,true),/Android System WebView/)
})
