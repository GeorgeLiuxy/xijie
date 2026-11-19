import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'
const code=ts.transpileModule(await readFile(new URL('../src/serviceGifts.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const json=(data,nextCursor=null)=>new Response(JSON.stringify({data,meta:{nextCursor}}),{headers:{'Content-Type':'application/json'}})
const deny=(status,code)=>new Response(JSON.stringify({error:{code}}),{status})
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
const settle=()=>new Promise(r=>setImmediate(r))
const definition={id:'flowers',version:1,name:'一束鲜花',en:'Flowers',category:'care',icon:'flower-2',cost:3,unitPostage:3,effect:'prop',outcome:'窗边鲜花',outcomeEn:'Flowers by the window',audience:['person'],stackable:true,available:true,render:'flower',acceptsVoucher:true}
const context=()=>({accountId:randomUUID(),sessionId:randomUUID(),onUnauthorized(){}})
const fixture=()=>{const personId=randomUUID(),worldId=randomUUID();return {personId,worldId,person:{id:71,serverId:personId,name:'合成TA'},delivery:{id:randomUUID(),personId,conversationId:randomUUID(),version:1,giftSnapshot:definition,personSnapshot:{id:personId,displayName:'合成TA',worldId,version:1,worldVersion:1,accessVersion:1,audience:'person'},quantity:1,note:'合成赠言',source:'voucher',cost:0,status:'in_transit',createdAt:'2026-11-13T00:00:00.000Z',scheduledArrivalAt:'2026-11-13T00:00:08.000Z',arrivedAt:null,failedAt:null,debitTransactionId:randomUUID(),reversalTransactionId:null}}}
const wallet=(units=1)=>({version:1,asOf:new Date().toISOString(),balances:[{assetType:'voucher',assetId:'return-stamp',source:'trial',availableUnits:units,nearestExpiryAt:null}]})
const receivedFixture=f=>({id:randomUUID(),personId:f.personId,conversationId:f.delivery.conversationId,sourceDeliveryId:f.delivery.id,personSnapshot:f.delivery.personSnapshot,giftSnapshot:definition,quantity:1,note:'真实来源合成附言',version:1,createdAt:'2026-11-13T00:00:09.000Z',openedAt:null,placement:null,displayable:true,origin:{kind:'persona_return',contentOrigin:'ai_generated',policyVersion:'person-gift-returns-v1',generationJobId:randomUUID()}})
const notificationFixture=(f,r)=>({id:randomUUID(),version:1,type:'gift_received',createdAt:r.createdAt,readAt:null,sourceEventId:randomUUID(),objectId:r.id,personId:f.personId,target:{kind:'received_gift',id:r.id}})
async function harness(fetcher,storage=new Map()){
 let si=0,ri=0,mi=0,ei=0,unmounted=false,afterUnmount=0,uid=200
 const states=[],refs=[],memos=[],effects=[],pending=[],listeners=new Map()
 const add=(name,fn)=>{const set=listeners.get(name)??new Set();set.add(fn);listeners.set(name,set)},remove=(name,fn)=>listeners.get(name)?.delete(fn)
 const runtime=vm.createContext({fetch:fetcher,crypto:globalThis.crypto,Headers,Response,AbortController,DOMException,URLSearchParams,setTimeout,clearTimeout,
  document:{visibilityState:'visible',addEventListener:add,removeEventListener:remove},window:{setInterval:()=>1,clearInterval(){},addEventListener:add,removeEventListener:remove},sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}})
 const synthetic=(names,values)=>new vm.SyntheticModule(names,function(){for(const name of names)this.setExport(name,values[name])},{context:runtime})
 const react=synthetic(['useState','useRef','useMemo','useEffect'],{
  useState(initial){const i=si++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],v=>{if(unmounted)afterUnmount++;states[i]=typeof v==='function'?v(states[i]):v}]},
  useRef(initial){const i=ri++;return refs[i]??(refs[i]={current:initial})},
  useMemo(fn,deps){const i=mi++,old=memos[i];if(!old||deps.some((v,j)=>v!==old.deps[j]))memos[i]={deps:[...deps],value:fn()};return memos[i].value},
  useEffect(fn,deps){const i=ei++,old=effects[i];if(!old||deps.some((v,j)=>v!==old.deps[j]))pending.push(()=>{old?.cleanup?.();effects[i]={deps:[...deps],cleanup:fn()}})},
 })
 const modules={react,'./i18n':synthetic(['WORLD_IDS'],{WORLD_IDS:['courtyard','tide','isles']}),'./model':synthetic(['nid'],{nid:()=>++uid})}
 const module=new vm.SourceTextModule(code,{context:runtime});await module.link(name=>modules[name]??Promise.reject(Error('Unexpected import '+name)));await module.evaluate()
 const flush=()=>{while(pending.length)pending.shift()()}
 return {api:module.namespace,storage,render(ctx,people=[],target,run=true){si=ri=mi=ei=0;const v=module.namespace.useServiceGifts(ctx,people,target);if(run)flush();return v},flush,dispatch(name){for(const fn of [...(listeners.get(name)??[])])fn()},get afterUnmount(){return afterUnmount},unmount(){unmounted=true;effects.forEach(e=>e?.cleanup?.())}}
}
function transport(f,options={}){
 return async(path,init)=>{
  if(path.startsWith('/v1/gift-catalog?'))return options.catalog?options.catalog(path,init):json([definition])
  if(path==='/v1/wallet')return json(wallet(options.balance?.()??1))
  if(path.startsWith('/v1/wallet/ledger?'))return json(options.ledger?.()??[])
  if(path.startsWith('/v1/received-gifts?'))return options.receivedResponse?options.receivedResponse():json(options.received?.()??[])
  if(path.startsWith('/v1/notifications?'))return new Response(JSON.stringify({data:options.notifications?.()??[],meta:{nextCursor:null,totalCount:options.notifications?.().length??0,unreadCount:options.notifications?.().filter(n=>n.readAt===null).length??0}}))
  if(path.startsWith('/v1/received-gifts/'))return options.receivedAction(path,init)
  if(path.startsWith('/v1/notifications/'))return options.notificationAction(path,init)
  if(path.startsWith('/v1/gift-deliveries?'))return json(options.deliveries?.()??[])
  if(path==='/v1/worlds/'+f.worldId)return json({id:f.worldId,code:'courtyard'})
  if(path==='/v1/gift-deliveries')return options.send(path,init)
  throw Error('Unexpected request '+path)
 }
}
const input=(f,source='reward')=>({requestId:randomUUID(),target:{id:71,identity:f.personId,name:'合成TA',world:'courtyard',audience:'person'},giftId:'flowers',quantity:1,note:'合成赠言',source})

test('new real gift account has authoritative zero balances and never adopts the preview initial 120',async()=>{
 const f=fixture(),ctx=context(),h=await harness(transport(f,{balance:()=>0}));let service=h.render(ctx,[f.person],f.personId);await service.refresh();service=h.render(ctx,[f.person],f.personId)
 assert.equal(service.status,'ready');assert.equal(service.state.credits,0);assert.equal(service.state.entitlements['return-stamp'],0);assert.equal(service.state.receipts.length,0);assert.equal(service.catalog[0].cost,3);h.unmount()
})

test('spendable postage includes verified paid lots while the ledger preserves their actual source',async()=>{
 const f=fixture(),ctx=context(),paidLot=randomUUID(),tx=randomUUID(),value={version:2,asOf:new Date().toISOString(),balances:[{assetType:'postage',assetId:'postage',source:'trial',availableUnits:3,nearestExpiryAt:null},{assetType:'postage',assetId:'postage',source:'paid',availableUnits:19,nearestExpiryAt:null}]}
 const ledger=[{transactionId:tx,reason:'purchase_credit',sourceId:randomUUID(),createdAt:new Date().toISOString(),policyVersion:'commerce-core-v1',originalTransactionId:null,entries:[{assetType:'postage',assetId:'postage',source:'paid',lotId:paidLot,direction:'credit',units:20}]}]
 const original=transport(f,{ledger:()=>ledger}),h=await harness((path,init)=>path==='/v1/wallet'?json(value):original(path,init));let service=h.render(ctx,[f.person]);await service.refresh();service=h.render(ctx,[f.person])
 assert.equal(service.status,'ready');assert.equal(service.state.credits,22);assert.equal(service.ledger[0].entries[0].source,'paid');assert.equal(service.ledger[0].entries[0].units,20);h.unmount()
})

test('lost voucher receipt freezes full send and key through balance refresh and component remount',async()=>{
 const f=fixture(),ctx=context(),storage=new Map(),calls=[];let balance=1,attempts=0
 const fetcher=transport(f,{balance:()=>balance,send:async(path,init)=>{calls.push({body:JSON.parse(init.body),key:init.headers.get('Idempotency-Key')});balance=0;if(++attempts===1)throw new TypeError('Lost accepted response');return json(f.delivery)}})
 let h=await harness(fetcher,storage),service=h.render(ctx,[f.person],f.personId);await service.refresh();service=h.render(ctx,[f.person],f.personId)
 await assert.rejects(()=>service.send(input(f)));await service.refresh();service=h.render(ctx,[f.person],f.personId)
 assert.equal(service.state.entitlements['return-stamp'],0);assert.equal(service.pending(f.personId).body.source,'voucher');h.unmount()
 h=await harness(fetcher,storage);service=h.render(ctx,[f.person],f.personId);await service.refresh();service=h.render(ctx,[f.person],f.personId)
 const changed={...input(f,'trial'),quantity:5,note:'不能替换未知结果'};const receipt=await service.send(changed)
 assert.deepEqual(calls[0],calls[1]);assert.equal(calls[1].body.source,'voucher');assert.equal(calls[1].body.note,'合成赠言');assert.equal(calls[1].body.quantity,1);assert.equal(calls[1].body.catalogVersion,1)
 assert.equal(receipt.id,f.delivery.id);assert.equal(receipt.target.identity,f.personId);assert.equal(receipt.status,'in_transit','A past scheduled time is not delivery authority');assert.equal(service.pending(f.personId),undefined);assert.equal(storage.size,0);h.unmount()
})

test('insufficient asset is a confirmed rejection, retains no fake receipt and permits a deliberate new source',async()=>{
 const f=fixture(),ctx=context();let calls=0
 const h=await harness(transport(f,{send:async()=>{calls++;return deny(409,'INSUFFICIENT_ASSET')}}));let service=h.render(ctx,[f.person]);await service.refresh();service=h.render(ctx,[f.person])
 await assert.rejects(()=>service.send(input(f)),e=>e.code==='INSUFFICIENT_ASSET');assert.equal(service.pending(f.personId),undefined);assert.equal(h.storage.size,0);assert.equal(h.render(ctx,[f.person]).state.receipts.length,0);assert.equal(calls,1);h.unmount()
})

test('switching verified session fences a late accepted gift and cannot call unauthorized on the new account',async()=>{
 const f=fixture(),a=context(),b=context(),gate=defer();let entered;const started=new Promise(r=>entered=r),unauthorized=[];a.onUnauthorized=()=>unauthorized.push('old');b.onUnauthorized=()=>unauthorized.push('new')
 const h=await harness(transport(f,{send:()=>{entered();return gate.promise}}));let service=h.render(a,[f.person]);await service.refresh();service=h.render(a,[f.person]);const sending=service.send(input(f));await started
 h.render(b,[],undefined,false);gate.resolve(deny(401,'UNAUTHENTICATED'));await assert.rejects(()=>sending,e=>e.name==='AbortError');assert.deepEqual(unauthorized,[]);assert.equal(h.render(b,[],undefined,false).state.receipts.length,0);h.flush();h.unmount()
})

test('permission withdrawal immediately removes gift views and fences a late send while keeping its unknown intent',async()=>{
 const f=fixture(),ctx=context(),gate=defer();let denyReads=false,entered;const started=new Promise(r=>entered=r)
 const underlying=transport(f,{deliveries:()=>[f.delivery],send:()=>{entered();return gate.promise}})
 const h=await harness((path,init)=>denyReads&&init?.method!=='POST'?Promise.resolve(deny(403,'GIFT_STORAGE_PERMISSION_REQUIRED')):underlying(path,init));let service=h.render(ctx,[f.person]);await service.refresh();service=h.render(ctx,[f.person]);assert.equal(service.state.receipts.length,1)
 const sending=service.send(input(f));await started;denyReads=true;h.dispatch('xijie:consents-changed');assert.equal(h.render(ctx,[f.person]).state.receipts.length,0)
 gate.resolve(json(f.delivery));await assert.rejects(()=>sending);await settle();assert.equal(h.render(ctx,[f.person]).state.receipts.length,0);assert(service.pending(f.personId));h.unmount()
})

test('unavailable reads and cyclic pages produce an explicit error without local catalogue or fake balances',async()=>{
 const f=fixture(),ctx=context(),h=await harness(transport(f,{catalog:()=>json([definition],'repeated')}));let service=h.render(ctx,[f.person]);await service.refresh();service=h.render(ctx,[f.person]);assert.equal(service.status,'error');assert.equal(service.state.credits,0);assert.equal(service.catalog.length,0);h.unmount()
})

test('real wallet usage follows debit and reversal entries even when the original person receipt is unavailable',async()=>{
 const f=fixture(),ctx=context(),lotA=randomUUID(),lotB=randomUUID(),debitId=randomUUID()
 const entry=(lotId,direction,units)=>({assetType:'postage',assetId:'postage',source:'trial',lotId,direction,units})
 const base={createdAt:'2026-11-13T00:00:00.000Z',policyVersion:'gift-trial-v1',originalTransactionId:null}
 const grant={...base,transactionId:randomUUID(),reason:'trial_grant',sourceId:'synthetic',entries:[entry(lotA,'credit',12)]}
 const debit={...base,transactionId:debitId,reason:'gift_debit',sourceId:f.delivery.id,entries:[entry(lotA,'debit',1),entry(lotB,'debit',2)]}
 const reversal={...base,transactionId:randomUUID(),reason:'gift_reversal',sourceId:'gift_reversal:'+f.delivery.id,originalTransactionId:debitId,entries:[entry(lotA,'credit',1),entry(lotB,'credit',2)]}
 let ledger=[grant];const h=await harness(transport(f,{ledger:()=>ledger}));let service=h.render(ctx,[f.person]);await service.refresh();service=h.render(ctx,[f.person]);assert.equal(h.api.giftLedgerUsage(service.ledger,service.state.receipts).length,0)
 ledger=[reversal,debit,grant];await service.refresh();service=h.render(ctx,[]);const usage=h.api.giftLedgerUsage(service.ledger,service.state.receipts)
 assert.equal(service.ledger.length,3);assert.equal(service.state.receipts.length,0);assert.equal(usage.length,2);assert.equal(usage[0].units,3);assert.equal(usage[0].returned,true);assert.equal(usage[1].units,-3);assert.equal(usage[1].returned,false);assert.equal(usage[1].receipt,undefined)
 const malformed={...debit,entries:[entry(lotA,'debit',-3)]};ledger=[malformed];await service.refresh();assert.equal(h.render(ctx,[]).status,'error');h.unmount()
})

test('authorization and missing-session responses after possible commit retain the original key and full intent',async()=>{
 for(const [status,code] of [[409,'AUTHORIZATION_CHANGED'],[403,'GIFT_STORAGE_PERMISSION_REQUIRED'],[403,'FORBIDDEN'],[401,'UNAUTHORIZED'],[404,'NOT_FOUND']]){
  const f=fixture(),ctx=context(),calls=[];let first=true
  const h=await harness(transport(f,{send:async(path,init)=>{calls.push({key:init.headers.get('Idempotency-Key'),body:init.body});if(first){first=false;return deny(status,code)}return json(f.delivery)}}));let service=h.render(ctx,[f.person]);await service.refresh();service=h.render(ctx,[f.person])
  await assert.rejects(()=>service.send(input(f)),error=>error.code===code);assert(service.pending(f.personId),code+' cannot establish that no transaction committed')
  await service.send({...input(f,'trial'),note:'不得改变原附言',quantity:5});assert.deepEqual(calls[0],calls[1]);assert.equal(service.pending(f.personId),undefined);h.unmount()
 }
})

test('accepted send with a failed receipt dependency retains its key until the same receipt can be read',async()=>{
 const f=fixture(),ctx=context(),calls=[];let blocked=true
 const underlying=transport(f,{send:async(path,init)=>{calls.push({key:init.headers.get('Idempotency-Key'),body:init.body});return json(f.delivery)}})
 const h=await harness((path,init)=>path==='/v1/worlds/'+f.worldId&&blocked?Promise.resolve(deny(404,'NOT_FOUND')):underlying(path,init));let service=h.render(ctx,[f.person]);await service.refresh();service=h.render(ctx,[f.person])
 await assert.rejects(()=>service.send(input(f)));assert(service.pending(f.personId));blocked=false;await service.send({...input(f,'trial'),note:'cannot change'});assert.deepEqual(calls[0],calls[1]);h.unmount()
})

test('missing return permission isolates the received area without blocking outgoing gifts or assets',async()=>{
 const f=fixture(),ctx=context(),h=await harness(transport(f,{receivedResponse:()=>deny(403,'GIFT_RETURN_PERMISSION_REQUIRED')}));let service=h.render(ctx,[f.person]);await service.refresh();service=h.render(ctx,[f.person])
 assert.equal(service.status,'ready');assert.equal(service.receivedStatus,'error');assert.equal(service.receivedError,'GIFT_RETURN_PERMISSION_REQUIRED');assert.equal(service.state.received.length,0);assert.equal(service.state.entitlements['return-stamp'],1);h.unmount()
})

test('lost open response retains one identity across refresh and does not undo later display or mint assets',async()=>{
 const f=fixture(),ctx=context(),storage=new Map(),calls=[];let value=receivedFixture(f),first=true
 const fetcher=transport(f,{received:()=>[value],receivedAction:async(path,init)=>{calls.push({path,key:init.headers.get('Idempotency-Key'),match:init.headers.get('If-Match'),body:init.body});if(first){first=false;value={...value,version:2,openedAt:'2026-11-13T00:00:10.000Z',placement:'record'};throw TypeError('lost commit')}return json(value)}})
 let h=await harness(fetcher,storage),service=h.render(ctx,[f.person]);await service.refresh();service=h.render(ctx,[f.person]);await assert.rejects(()=>service.openReceived(value.id));assert(service.pendingReceived(value.id));h.unmount()
 value={...value,version:3,placement:'space'};h=await harness(fetcher,storage);service=h.render(ctx,[f.person]);await service.refresh();service=h.render(ctx,[f.person]);const opened=await service.openReceived(value.id)
 assert.equal(opened.placement,'space');assert.equal(opened.serverVersion,3);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].match,null);assert.equal(service.pendingReceived(value.id),undefined)
 service=h.render(ctx,[f.person]);assert.equal(service.state.credits,0);assert.equal(Object.keys(service.state.inventory).length,0);assert.equal(service.state.entitlements['return-stamp'],1);h.unmount()
})

test('unknown placement freezes the original desired state and If-Match through remount',async()=>{
 const f=fixture(),ctx=context(),storage=new Map(),calls=[];let value={...receivedFixture(f),version:2,openedAt:'2026-11-13T00:00:10.000Z',placement:'record'},first=true
 const fetcher=transport(f,{received:()=>[value],receivedAction:async(path,init)=>{calls.push({key:init.headers.get('Idempotency-Key'),match:init.headers.get('If-Match'),body:init.body});if(first){first=false;value={...value,version:3,placement:'space'};throw TypeError('lost commit')}return json(value)}})
 let h=await harness(fetcher,storage),service=h.render(ctx,[f.person]);await service.refresh();service=h.render(ctx,[f.person]);await assert.rejects(()=>service.placeReceived(value.id,'space'));await service.refresh()
 await assert.rejects(()=>service.placeReceived(value.id,'record'),error=>error.code==='PENDING_GIFT_OPERATION');assert.equal(calls.length,1);h.unmount()
 h=await harness(fetcher,storage);service=h.render(ctx,[f.person]);await service.refresh();service=h.render(ctx,[f.person]);await service.retryReceived(value.id);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].match,'"v2"');assert.equal(JSON.parse(calls[0].body).placement,'space');assert.equal(h.render(ctx,[f.person]).state.received[0].placement,'space');h.unmount()
})

test('placement conflict refreshes authority without silently overwriting another placement',async()=>{
 const f=fixture(),ctx=context(),calls=[];let value={...receivedFixture(f),version:2,openedAt:'2026-11-13T00:00:10.000Z',placement:'record'}
 const h=await harness(transport(f,{received:()=>[value],receivedAction:async(path,init)=>{if(!init?.method)return json(value);calls.push(init);value={...value,version:4,placement:'space'};return deny(412,'VERSION_CONFLICT')}}));let service=h.render(ctx,[f.person]);await service.refresh();service=h.render(ctx,[f.person])
 await assert.rejects(()=>service.placeReceived(value.id,'space'),error=>error.code==='VERSION_CONFLICT');await settle();assert.equal(calls.length,1);assert.equal(service.pendingReceived(value.id),undefined);assert.equal(h.render(ctx,[f.person]).state.received[0].serverVersion,4);h.unmount()
})

test('notification read is independent of opening gifts and preserves total count and replay identity',async()=>{
 const f=fixture(),r=receivedFixture(f),ctx=context(),calls=[],storage=new Map();let notice=notificationFixture(f,r),first=true
 const fetcher=transport(f,{received:()=>[r],notifications:()=>[notice],receivedAction:()=>{throw Error('Read must not open a gift')},notificationAction:async(path,init)=>{calls.push({key:init.headers.get('Idempotency-Key'),match:init.headers.get('If-Match'),body:init.body});notice={...notice,version:2,readAt:'2026-11-13T00:00:10.000Z'};if(first){first=false;throw TypeError('lost commit')}return json(notice)}})
 let h=await harness(fetcher,storage),service=h.render(ctx,[f.person]);await service.refresh();service=h.render(ctx,[f.person]);await assert.rejects(()=>service.readNotification(notice.id));h.unmount()
 h=await harness(fetcher,storage);service=h.render(ctx,[f.person]);await service.refresh();service=h.render(ctx,[f.person]);assert.equal(service.totalCount,1);assert.equal(service.unreadCount,0);assert.equal(service.state.received[0].openedAt,undefined)
 await service.readNotification(notice.id);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].match,'"v1"');assert.equal(calls[0].body,'{"read":true}');h.unmount()
})

test('late received mutations after withdrawal or session switch cannot repopulate private gifts',async()=>{
 for(const change of ['withdraw','switch']){
  const f=fixture(),r=receivedFixture(f),ctx=context(),gate=defer();let denied=false
  const underlying=transport(f,{received:()=>[r],receivedAction:()=>gate.promise})
  const h=await harness((path,init)=>denied&&init?.method!=='POST'?Promise.resolve(deny(403,'GIFT_RETURN_PERMISSION_REQUIRED')):underlying(path,init));let service=h.render(ctx,[f.person]);await service.refresh();service=h.render(ctx,[f.person]);const operation=service.openReceived(r.id)
  const next=change==='switch'?context():ctx
  if(change==='withdraw'){denied=true;h.dispatch('xijie:consents-changed')}else h.render(next,[],undefined,false)
  gate.resolve(json({...r,version:2,openedAt:'2026-11-13T00:00:10.000Z',placement:'record'}));await assert.rejects(()=>operation);await settle();assert.equal(h.render(next,[],undefined,false).state.received.length,0);assert(service.pendingReceived(r.id));h.flush();h.unmount()
 }
})

test('received gift provenance and notification target types are validated before rendering',async()=>{
 const f=fixture(),r=receivedFixture(f),ctx=context(),h=await harness(transport(f,{received:()=>[{...r,origin:{...r.origin,contentOrigin:'template'}}]}));let service=h.render(ctx,[f.person]);await service.refresh();service=h.render(ctx,[f.person]);assert.equal(service.receivedStatus,'error');assert.equal(service.state.received.length,0)
 assert.throws(()=>h.api.validateGiftNotification({...notificationFixture(f,r),target:{kind:'delivery',id:r.id}}));h.unmount()
})
