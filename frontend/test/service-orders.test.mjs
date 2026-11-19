import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'
const source=await readFile(new URL('../src/commerce/serviceOrders.ts',import.meta.url),'utf8')
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const envelope=(data,meta)=>new Response(JSON.stringify({data,...(meta?{meta}:{})}),{headers:{'Content-Type':'application/json'}})
const context=()=>({accountId:randomUUID(),sessionId:randomUUID(),onUnauthorized(){}})
const order=()=>({orderId:randomUUID(),productSnapshot:{id:'historical-item',version:1,name:'当时的商品名称',units:40,assetType:'postage',assetId:'postage',price:{amount:600,currency:'CNY'},channel:'server-channel'},pricingSource:'server_quote',price:{amount:600,currency:'CNY'},paidAmount:null,channel:'server-channel',status:'awaiting_payment',paymentState:'awaiting_payment',fulfillmentStatus:'not_eligible',refundStatus:'none',attemptSummary:null,refund:null,createdAt:'2026-11-15T00:00:00.000Z',updatedAt:'2026-11-15T00:00:00.000Z',version:1})
async function harness(fetch){const sandbox=vm.createContext({fetch,URLSearchParams,AbortController,DOMException,localStorage:{getItem(){throw Error('Preview storage forbidden')}},sessionStorage:{getItem(){throw Error('Preview storage forbidden')}}});const module=new vm.SourceTextModule(code,{context:sandbox});await module.link(()=>{throw Error('Unexpected import')});await module.evaluate();return module.namespace}
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)}}
test('orders use only session-bound GETs, preserve server snapshots and page with the server cursor',async()=>{
 const first=order(),second=order(),calls=[],ctx=context(),api=await harness(async(path,init)=>{calls.push({path,init});return envelope([calls.length===1?first:second],{nextCursor:calls.length===1?first.orderId:null})}),client=api.createOrdersClient(ctx)
 const a=await client.list(),b=await client.list(a.meta.nextCursor)
 assert.equal(a.data[0].productSnapshot.name,first.productSnapshot.name);assert.equal(b.data[0].orderId,second.orderId);assert.equal(b.meta.nextCursor,null)
 assert.equal(calls[0].path,'/v1/orders?limit=20');assert.equal(calls[1].path,'/v1/orders?limit=20&cursor='+first.orderId)
 for(const {init}of calls){assert.equal(init.method,'GET');assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.equal(init.headers['X-Xijie-Expected-Session'],ctx.sessionId);assert.equal(init.body,undefined)}
 assert.deepEqual(Object.keys(client).sort(),['activate','dispose','list','read'])
})
test('server empty orders are valid while malformed, repeated and foreign detail identities fail without preview fallback',async()=>{
 let value={data:[],meta:{nextCursor:null}},api=await harness(async()=>new Response(JSON.stringify(value))),client=api.createOrdersClient(context())
 assert.equal((await client.list()).data.length,0)
 const a=order()
 for(const bad of [{data:[a],meta:{}},{data:[a,a],meta:{nextCursor:null}},{data:[a],meta:{nextCursor:randomUUID()}},{data:[{...a,paidAmount:{amount:1,currency:'CNY'}}],meta:{nextCursor:null}}]){value=bad;await assert.rejects(client.list(),e=>e.code==='INVALID_RESPONSE')}
 value={data:[a],meta:{nextCursor:a.orderId}};await assert.rejects(client.list(a.orderId),e=>e.code==='INVALID_RESPONSE')
 value={data:a};await assert.rejects(client.read(randomUUID()),e=>e.code==='INVALID_RESPONSE')
 await assert.rejects(client.read('../orders'),e=>e.code==='INVALID_ARGUMENT')
})
test('dispose and account switch fence late success and late unauthorized responses even if fetch ignores abort',async()=>{
 const waiting=deferred(),ctx=context();let unauthorized=0;ctx.onUnauthorized=()=>unauthorized++
 const api=await harness(()=>waiting.promise),old=api.createOrdersClient(ctx),pending=old.list();old.dispose();old.activate()
 waiting.resolve(new Response(JSON.stringify({error:{code:'UNAUTHORIZED'}}),{status:401}));await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(unauthorized,0)
 const success=deferred(),other=context(),calls=[],nextApi=await harness(async(path,init)=>{calls.push(init.headers['X-Xijie-Expected-Session']);return calls.length===1?success.promise:envelope([],{nextCursor:null})})
 const previous=nextApi.createOrdersClient(ctx),current=nextApi.createOrdersClient(other),late=previous.list();previous.dispose()
 assert.equal((await current.list()).data.length,0);success.resolve(envelope([order()],{nextCursor:null}));await assert.rejects(late,e=>e.name==='AbortError');assert.deepEqual(calls,[ctx.sessionId,other.sessionId])
})
test('cancel during response decoding and live authorization failures never return cached orders',async()=>{
 const body=deferred(),api=await harness(async()=>({ok:true,status:200,json:()=>body.promise})),client=api.createOrdersClient(context()),controller=new AbortController(),pending=client.list(undefined,controller.signal)
 await new Promise(r=>setImmediate(r));controller.abort();body.resolve({data:[order()],meta:{nextCursor:null}});await assert.rejects(pending,e=>e.name==='AbortError')
 let unauthorized=0;const errorApi=await harness(async()=>new Response(JSON.stringify({error:{code:'UNAUTHORIZED'}}),{status:401}))
 await assert.rejects(errorApi.createOrdersClient({...context(),onUnauthorized:()=>unauthorized++}).list(),e=>e.status===401);assert.equal(unauthorized,1)
})
test('paid and refund projections preserve actual server fields and reject fictional price or status combinations',async()=>{
 const value=order();Object.assign(value,{paidAmount:value.price,paymentState:'paid',status:'fulfilled',fulfillmentStatus:'fulfilled',refundStatus:'requested',refund:{refundId:randomUUID(),status:'review',failureCode:'REFUND_REQUIRES_REVIEW'}})
 const api=await harness(async()=>envelope(value)),result=await api.createOrdersClient(context()).read(value.orderId)
 assert.equal(result.refund.status,'review');assert.equal(result.productSnapshot.units,40);assert.equal(result.channel,'server-channel')
 value.status='refunded';assert.throws(()=>api.validateOrder(value),e=>e.code==='INVALID_RESPONSE');value.refund.status='refunded';value.refundStatus='refunded';assert.equal(api.validateOrder(value).status,'refunded')
 value.price={amount:999,currency:'CNY'};assert.throws(()=>api.validateOrder(value),e=>e.code==='INVALID_RESPONSE')
})
const element=(type,props,...children)=>({type,props:{...props,children:children.flat()}})
const nodes=node=>node&&typeof node==='object'?[node,...(node.props?.children??[]).flatMap(nodes)]:[]
const plain=node=>typeof node==='string'?node:node&&typeof node==='object'?(node.props?.children??[]).map(plain).join(' '):''
test('service entry never calls the preview component and remounts on account or session change',async()=>{
 const src=await readFile(new URL('../src/commerce/CheckoutPreview.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('checkout.tsx',src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
 const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='CheckoutPreview').getText(ast).replace('export ','')
 const compiled=ts.transpileModule(fn,{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText
 const render=vm.runInNewContext(compiled+'\nCheckoutPreview',{React:{createElement:element},ServiceCheckout:'ServiceCheckout',PreviewCheckoutContent:'PreviewCheckoutContent'})
 const ctx=context(),props={owner:'must-not-read-preview',initialView:'orders',onClose(){},onUnavailable(){},serviceContext:ctx},tree=render(props)
 assert.equal(tree.type,'ServiceCheckout');assert.equal(tree.props.initialView,'orders');assert.notEqual(render({...props,serviceContext:{...ctx,sessionId:randomUUID()}}).props.key,tree.props.key)
 assert.equal(render({...props,serviceContext:undefined}).type,'PreviewCheckoutContent')
})
test('original order list separates loading and failure from a real empty result, and offers no simulated payment actions',async()=>{
 const src=await readFile(new URL('../src/commerce/ServiceOrderHistory.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('orders.tsx',src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
 const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ServiceOrderHistory').getText(ast).replace('export ','')
 const compiled=ts.transpileModule(fn,{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText
 let state=[],index=0;const scope={React:{createElement:element},useI18n:()=>({lang:'zh-CN'}),isZh:()=>true,useRef:v=>({current:v}),useMemo:fn=>fn(),useCallback:fn=>fn,useEffect(){},useLayoutEffect(){},useState:v=>[state[index++]??v,()=>{}],createOrdersClient:()=>({}),OrderServiceError:class extends Error{},ContextSheet:'ContextSheet',CaretRight:'CaretRight',Check:'Check',Clock:'Clock',Receipt:'Receipt',WarningCircle:'WarningCircle',X:'X'}
 const render=vm.runInNewContext(compiled+'\nServiceOrderHistory',scope),props={context:context(),onClose(){},onUnavailable(){}}
 const tree=values=>{index=0;state=values;return render(props)}
 assert.match(plain(tree([[],null,false,null,null,true,false])),/正在查询/);assert.doesNotMatch(plain(tree([[],null,false,null,null,true,false])),/还没有订单/)
 assert.match(plain(tree([[],null,false,null,null,false,true])),/暂时无法查看/);assert.doesNotMatch(plain(tree([[],null,false,null,null,false,true])),/还没有订单/)
 const empty=tree([[],null,true,null,null,false,false]);assert.match(plain(empty),/还没有订单/);assert.equal(nodes(empty).find(n=>n.type==='button'&&plain(n)==='购买').props.onClick()??null,null)
 const a=order(),detail=tree([[a],null,true,a.orderId,a,false,false]);assert.match(plain(detail),/当时的商品名称/);assert.match(plain(detail),/收银台支付/);assert.doesNotMatch(plain(detail),/server-channel/);assert.doesNotMatch(plain(detail),/模拟付款|演示邮资|App Store|微信支付/)
 assert.equal(nodes(detail).filter(n=>n.type==='button'&&plain(n)==='查询订单进度').length,1)
 Object.assign(a,{status:'fulfilled',paymentState:'paid',paidAmount:a.price});const paid=plain(tree([[a],null,true,a.orderId,a,false,false]));assert.match(paid,/付款已确认/);assert.doesNotMatch(paid,/邮资已到账|邮资已发放/)
})
