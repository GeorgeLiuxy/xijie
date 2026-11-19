import assert from 'node:assert/strict'
import {test} from 'node:test'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'
const json=(data,status=200)=>new Response(JSON.stringify(status===200?{data}:{error:{code:data}}),{status,headers:{'Content-Type':'application/json'}})
const storage=()=>{const values=new Map();return {get length(){return values.size},key:i=>[...values.keys()][i]??null,getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k),values}}
async function load(file,fetcher,store=storage()){
 const code=ts.transpileModule(await readFile(new URL('../src/'+file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
 const events=[],revoked=[],listeners=new Map(),browserWindow={localStorage:store,sessionStorage:store,addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn)},dispatchEvent(event){events.push(event);for(const fn of listeners.get(event.type)??[])fn(event);return true}}
 const context=vm.createContext({fetch:fetcher,localStorage:store,sessionStorage:store,window:browserWindow,CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail}},URL:{revokeObjectURL:value=>revoked.push(value)},AbortController,DOMException,crypto:globalThis.crypto,Intl,URLSearchParams,console})
 const m=new vm.SourceTextModule(code,{context});await m.link(spec=>{assert.equal(spec,'react');return new vm.SyntheticModule(['useEffect','useMemo','useRef','useSyncExternalStore'],function(){this.setExport('useEffect',()=>{});this.setExport('useMemo',fn=>fn());this.setExport('useRef',v=>({current:v}));this.setExport('useSyncExternalStore',(_,get)=>get())},{context})});await m.evaluate();return {api:m.namespace,store,events,revoked,browserWindow}
}
test('nickname uses a current version, frozen command and authoritative identity through lost replies and remounts',async()=>{
 const account=randomUUID(),session=randomUUID(),calls=[],store=storage();let lost=true,version=1,name='原昵称'
 const fetcher=async(path,init)=>{calls.push({path,...init});if(init.method==='PATCH'){name=JSON.parse(init.body).displayName;version=2;if(lost){lost=false;throw Error('Lost acknowledgement')}}return json({id:account,displayName:name,version})}
 const h=await load('auth/serviceAccountProfile.ts',fetcher,store),client=h.api.createAccountProfileClient({accountId:account,sessionId:session,onUnauthorized:()=>assert.fail('not unauthorized')})
 await assert.rejects(client.update(' 新昵称 '));client.dispose()
 const second=(await load('auth/serviceAccountProfile.ts',fetcher,store)).api.createAccountProfileClient({accountId:account,sessionId:randomUUID(),onUnauthorized(){}})
 await assert.rejects(second.update('别的昵称'),e=>e.code==='PROFILE_CHANGE_PENDING'&&e.pendingDisplayName==='新昵称')
 const result=await second.update('新昵称');assert.equal(result.displayName,'新昵称')
 const patches=calls.filter(v=>v.method==='PATCH');assert.equal(patches.length,2);assert.equal(patches[0].headers['Idempotency-Key'],patches[1].headers['Idempotency-Key']);assert.equal(patches[0].headers['If-Match'],'"v1"');assert.equal(patches[0].headers['X-Xijie-Expected-Session'],session);assert.notEqual(patches[1].headers['X-Xijie-Expected-Session'],session);assert.equal(store.values.size,0)
})
test('nickname storage failure prevents a write; malformed/foreign/401 responses retain the command',async()=>{
 const account=randomUUID(),scope={accountId:account,sessionId:randomUUID(),onUnauthorized(){}},store=storage();let posts=0,mode='foreign'
 const fetcher=async(_,init)=>{if(init.method==='GET')return json({id:account,displayName:'原昵称',version:1});posts++;return mode==='401'?json('UNAUTHENTICATED',401):json({id:randomUUID(),displayName:'新昵称',version:2})}
 const bad={...store,setItem(){throw Error('Storage blocked')}},first=(await load('auth/serviceAccountProfile.ts',fetcher,bad)).api.createAccountProfileClient(scope)
 await assert.rejects(first.update('新昵称'),e=>e.code==='RECOVERY_STORAGE_UNAVAILABLE');assert.equal(posts,0)
 const second=(await load('auth/serviceAccountProfile.ts',fetcher,store)).api.createAccountProfileClient(scope);await assert.rejects(second.update('新昵称'),e=>e.code==='INVALID_RESPONSE');const pending=[...store.values.values()][0];mode='401';await assert.rejects(second.update('新昵称'));assert.equal([...store.values.values()][0],pending)
})
test('late nickname response after disposal never emits an unauthorized callback',async()=>{
 let resolve,entered;const ready=new Promise(r=>entered=r),wait=new Promise(r=>resolve=r),account=randomUUID();let unauthorized=0
 const h=await load('auth/serviceAccountProfile.ts',async(_,init)=>{if(init.method==='GET')return json({id:account,displayName:'原名',version:1});entered();return wait})
 const client=h.api.createAccountProfileClient({accountId:account,sessionId:randomUUID(),onUnauthorized:()=>unauthorized++}),pending=client.update('新名');await ready;client.dispose();resolve(json('UNAUTHENTICATED',401));await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(unauthorized,0);assert.equal(h.store.values.size,1)
})
test('reminders recover the exact opt-in command, frozen timezone and version after a lost response',async()=>{
 const account=randomUUID(),person=randomUUID(),store=storage(),calls=[];let lost=true
 const fetcher=async(path,init)=>{calls.push({path,...init});if(init.method==='PUT'&&lost){lost=false;throw Error('Lost reply')}return json({personId:person,enabled:true,timeZone:'Asia/Shanghai',version:2})}
 const h=await load('serviceReminders.ts',fetcher,store),context={accountId:account,sessionId:randomUUID(),onUnauthorized(){}},client=h.api.createReminderClient(context),current={personId:person,enabled:false,timeZone:null,version:1}
 await assert.rejects(client.set(current,true));client.dispose();const again=(await load('serviceReminders.ts',fetcher,store)).api.createReminderClient({...context,sessionId:randomUUID()})
 await assert.rejects(again.set({...current,enabled:true,version:2},false),e=>e.code==='REMINDER_CHANGE_PENDING'&&e.pendingEnabled===true)
 const result=await again.set(current,true);assert.equal(result.enabled,true);assert.equal(calls.length,2);assert.equal(calls[0].body,calls[1].body);assert.equal(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key']);assert.equal(calls[0].headers['If-Match'],'"v1"');assert.equal(store.values.size,0)
})
test('reminder notices page through real records; marking read preserves unknown commands and validates source identity',async()=>{
 const person=randomUUID(),id=randomUUID(),item={id,personId:person,personName:'合成',kind:'birthday',localDate:'2028-11-16',createdAt:'2028-11-16T00:00:00Z',readAt:null,version:1},store=storage(),calls=[];let mode='wrong'
 const h=await load('serviceReminders.ts',async(path,init)=>{calls.push({path,...init});if(init.method==='GET')return new Response(JSON.stringify({data:[item],meta:{nextCursor:null}}));return json({...item,personId:mode==='wrong'?randomUUID():person,readAt:'2028-11-16T00:01:00Z',version:2})},store)
 const c=h.api.createReminderClient({accountId:randomUUID(),sessionId:randomUUID(),onUnauthorized(){}});await c.refresh();assert.equal(c.getSnapshot().notices[0].id,id)
 await assert.rejects(c.read(item),e=>e.code==='INVALID_RESPONSE');assert.equal(store.values.size,1);mode='right';await c.read(item);assert(c.getSnapshot().notices[0].readAt);assert.equal(calls[1].headers['Idempotency-Key'],calls[2].headers['Idempotency-Key']);assert.equal(store.values.size,0)
})
test('reminder storage rejection stops mutation and a specific CAS conflict permits a reviewed new intent',async()=>{
 let posts=0;const person=randomUUID(),scope={accountId:randomUUID(),sessionId:randomUUID(),onUnauthorized(){}},current={personId:person,enabled:false,timeZone:'UTC',version:3},store=storage()
 const h=await load('serviceReminders.ts',async()=>{posts++;return json('VERSION_CONFLICT',412)},store),client=h.api.createReminderClient(scope)
 await assert.rejects(client.set(current,true),e=>e.code==='VERSION_CONFLICT');assert.equal(store.values.size,0)
 const bad=(await load('serviceReminders.ts',()=>{posts++;assert.fail('must not write')},{...store,setItem(){throw Error()}})).api.createReminderClient(scope)
 await assert.rejects(bad.set(current,true),e=>e.code==='RECOVERY_STORAGE_UNAVAILABLE');assert.equal(posts,1)
})

test('deletion progress distinguishes private erasure from retained transactions and preflight failures',async()=>{
 const {api}=await load('auth/dataRightsClient.ts',()=>assert.fail('pure validation and copy'))
 const base={id:randomUUID(),kind:'delete_account',status:'completed',requestedAt:'2026-11-15T00:00:00Z',updatedAt:'2026-11-15T00:01:00Z'},retained={...base,financialRetention:{status:'retained',archiveId:randomUUID(),policyVersion:'policy-1',retainUntil:'2036-11-15T00:00:00Z'}}
 assert.equal(api.validRequest(retained),true);assert.equal(api.validRequest({...base,financialRetention:{...retained.financialRetention,retainUntil:'bad'}}),false)
 assert.match(api.deletionProgressText(retained,true),/私人资料/);assert.match(api.deletionProgressText(retained,true),/最小交易记录.*2036/);assert.match(api.deletionProgressText(retained,false),/Minimal transaction records/)
 assert(!api.deletionProgressText({...base,financialRetention:{status:'none'}},true).includes('最小交易记录'))
 for(const failureCode of ['FINANCIAL_RETENTION_POLICY_REQUIRED','FINANCIAL_RECONCILIATION_REQUIRED'])assert.match(api.deletionProgressText({...base,status:'failed',failureCode},true),/私人资料还未开始清理/)
})

test('StrictMode activation can read immediately while the retired reminder read is still settling',async()=>{
 let release,started;const entered=new Promise(r=>started=r),wait=new Promise(r=>release=r);let calls=0,unauthorized=0
 const h=await load('serviceReminders.ts',async()=>{if(++calls===1){started();return wait}return new Response(JSON.stringify({data:[],meta:{nextCursor:null}}))})
 const client=h.api.createReminderClient({accountId:randomUUID(),sessionId:randomUUID(),onUnauthorized:()=>unauthorized++}),old=client.refresh();await entered;client.dispose();client.activate();await client.refresh();assert.equal(client.getSnapshot().status,'ready');release(json('UNAUTHENTICATED',401));await old;assert.equal(unauthorized,0);assert.equal(calls,2)
})

test('confirmed deletion clears only that account private operation drafts while retaining financial recovery journals',async()=>{
 const account=randomUUID(),other=randomUUID(),store=storage(),{api}=await load('auth/dataRightsClient.ts',()=>assert.fail('no request'),store)
 for(const key of ['xijie.account-profile.'+account,'xijie.content-report.'+account+'.message.x','xijie.person-reminders.'+account+'.setting.x','xijie.memory-import.'+account+'.x','xijie.content-report.'+other+'.message.x','xijie.checkout.'+account])store.setItem(key,'private')
 api.clearPrivateOperationDrafts(account);assert.deepEqual([...store.values.keys()],['xijie.content-report.'+other+'.message.x','xijie.checkout.'+account,'xijie.private-drafts-erased.'+account])
})

test('account erasure removes actual text/photo/voice draft shapes and attributed legacy JSON while preserving other owners and visitor-only originals',async()=>{
 const account=randomUUID(),other=randomUUID(),store=storage(),h=await load('auth/dataRightsClient.ts',()=>assert.fail('local cleanup only'),store),owner='account.'+account
 for(const prefix of ['xijie.person-voice.intent.','xijie.person-voice.delete.','xijie.voice-call.intent.v1.','xijie.album.review.','xijie.chat.intent.','xijie.chat-photo.intent.','xijie.letter.','xijie.story.controls.','xijie.memory.intent.','xijie.memory.candidate.job.','xijie.gift.intent.','xijie.gift-photo.intent.','xijie.media.intent.','xijie.social.intent.','xijie.album.create.']){
  store.setItem(prefix+account+'.'+JSON.stringify({title:'PRIVATE_MEMORY_TITLE',body:'PRIVATE_MEMORY_BODY'}),JSON.stringify({body:{text:'PRIVATE_DRAFT',image:'blob:private-photo',audio:'blob:private-voice'}}));store.setItem(prefix+other+'.target',JSON.stringify({body:'OTHER_ACCOUNT'}))
 }
 store.setItem('xijie.referral.create.'+account,JSON.stringify({publicName:'PRIVATE_NAME'}));store.setItem('xijie.conversation.draft.'+JSON.stringify([owner,'person']), 'PRIVATE_CHAT');store.setItem('xijie.conversation.draft.'+JSON.stringify(['account.'+other,'person']),'OTHER_CHAT')
 store.setItem('elysium.legacy-owner.v1',owner);store.setItem('elysium.v1',JSON.stringify({people:[{avatar:'blob:legacy-photo',name:'PRIVATE_NAME'}],chats:{x:'PRIVATE_CHAT'},posts:[{body:'PRIVATE_POST'}],nickname:'PRIVATE_NAME',large:true,theme:'night'}));store.setItem('elysium.account.v1.'+owner,JSON.stringify({people:[{name:'PRIVATE_NAME'}]}))
 store.setItem('elysium.giftResume.v1',JSON.stringify({owner,options:{note:'PRIVATE_NOTE'}}));store.setItem('xijie.album.submit.old-visitor',JSON.stringify({key:randomUUID(),body:{text:'UNATTRIBUTED_VISITOR'}}));store.setItem('xijie.album.submit.claimed-account',JSON.stringify({viewer:{accountId:account},body:{text:'PRIVATE_CLAIMED_NOTE'}}));store.setItem('xijie.checkout.v1.'+account,JSON.stringify({pending:{orderId:randomUUID()}}));store.setItem('xijie.data-rights.deletion.v1','PRESERVE_RECEIPT')
 h.api.clearPrivateOperationDrafts(account)
 assert.equal([...store.values.entries()].some(([k,v])=>k.includes('PRIVATE_MEMORY')||v.includes('PRIVATE_')),false)
 assert.equal(JSON.parse(store.getItem('elysium.v1')).large,true);assert.equal(JSON.parse(store.getItem('elysium.v1')).theme,'night');assert.equal(JSON.parse(store.getItem('elysium.v1')).people,undefined)
 assert(store.getItem('xijie.conversation.draft.'+JSON.stringify(['account.'+other,'person'])));assert(store.getItem('xijie.album.submit.old-visitor'));assert(store.getItem('xijie.checkout.v1.'+account));assert.equal(store.getItem('xijie.data-rights.deletion.v1'),'PRESERVE_RECEIPT');assert(h.revoked.includes('blob:private-photo'));assert(h.revoked.includes('blob:private-voice'));assert(h.revoked.includes('blob:legacy-photo'));assert.equal(h.events.at(-1).detail.accountId,account)
 // Another tab observes the tombstone and clears its own late local/session copy.
 store.setItem('xijie.letter.'+account+'.new-person.draft','PRIVATE_LATE_DRAFT');h.browserWindow.dispatchEvent({type:'storage',key:'xijie.private-drafts-erased.'+account,newValue:'1'});assert.equal(store.getItem('xijie.letter.'+account+'.new-person.draft'),null)
})
