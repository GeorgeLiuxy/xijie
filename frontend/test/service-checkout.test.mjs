import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'
const sources=Object.fromEntries(await Promise.all(['serviceOrders','serviceCheckout'].map(async name=>[name,ts.transpileModule(await readFile(new URL('../src/commerce/'+name+'.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText])))
const envelope=(data,meta)=>new Response(JSON.stringify({data,...(meta?{meta}:{})}),{headers:{'Content-Type':'application/json'}})
const deny=(status,code)=>new Response(JSON.stringify({error:{code}}),{status})
const context=()=>({accountId:randomUUID(),sessionId:randomUUID(),onUnauthorized(){}})
const product=(channel='jeepay')=>({id:'configured-item',version:3,name:'服务端配置邮资',units:60,assetType:'postage',assetId:'postage',price:{amount:600,currency:'CNY'},channel})
const quote=p=>({quoteId:randomUUID(),productSnapshot:p,quantity:1,channel:p.channel,pricingSource:'server_quote',price:p.price,createdAt:'2026-11-15T00:00:00.000Z',expiresAt:'2026-11-15T00:10:00.000Z'})
const order=(p=product())=>({orderId:randomUUID(),productSnapshot:p,pricingSource:'server_quote',price:p.price,paidAmount:null,channel:p.channel,status:'awaiting_payment',paymentState:'awaiting_payment',fulfillmentStatus:'not_eligible',refundStatus:'none',attemptSummary:null,refund:null,createdAt:'2026-11-15T00:00:00.000Z',updatedAt:'2026-11-15T00:00:00.000Z',version:1})
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)}}
function storage(map=new Map()){return{map,getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)}}
async function harness(fetch,store=storage(),production=false,navigator){
 const sandbox=vm.createContext({fetch,crypto:globalThis.crypto,structuredClone,URL,URLSearchParams,AbortController,DOMException,localStorage:store,navigator}),modules={}
 for(const [name,code]of Object.entries(sources))modules[name]=new vm.SourceTextModule(code,{context:sandbox,initializeImportMeta(meta){meta.env={PROD:production}}})
 await modules.serviceCheckout.link(name=>{assert.equal(name,'./serviceOrders');return modules.serviceOrders});await modules.serviceCheckout.evaluate()
 return{api:modules.serviceCheckout.namespace,orders:modules.serviceOrders.namespace,store}
}
test('catalogue uses only configured server items and handles disabled purchasing without demo values',async()=>{
 const ctx=context(),calls=[],p=product('paypal'),h=await harness(async(path,init)=>{calls.push({path,init});return envelope([p],{purchasingEnabled:true})}),client=h.api.createCheckoutClient(ctx)
 assert.equal((await client.products()).data[0].channel,'paypal');assert.equal(calls[0].path,'/v1/products');assert.equal(calls[0].init.method,'GET');assert.equal(calls[0].init.headers['X-Xijie-Expected-Session'],ctx.sessionId)
 const empty=await harness(async()=>envelope([],{purchasingEnabled:false}));assert.equal((await empty.api.createCheckoutClient(ctx).products()).data.length,0)
 const bad=await harness(async()=>envelope([p],{purchasingEnabled:false}));await assert.rejects(bad.api.createCheckoutClient(ctx).products(),e=>e.code==='INVALID_RESPONSE')
})
test('lost order response resumes exact quote and key after remount and reauthentication',async()=>{
 const p=product(),q=quote(p),o=order(p),ctx=context(),store=storage(),calls=[];let orders=0
 const fetcher=async(path,init)=>{calls.push({path,init});if(path==='/v1/purchase-quotes')return envelope(q);if(path==='/v1/orders'){if(++orders===1)throw Error('lost accepted response');return envelope(o)}if(path==='/v1/orders/'+o.orderId)return envelope(o);throw Error('Unexpected '+path)}
 let h=await harness(fetcher,store),client=h.api.createCheckoutClient(ctx);await assert.rejects(client.buy(p));assert.equal(client.pending,'order');client.dispose()
 const next={...ctx,sessionId:randomUUID()};h=await harness(fetcher,store);client=h.api.createCheckoutClient(next);assert.equal((await client.buy(p)).orderId,o.orderId);assert.equal(client.pending,undefined)
 assert.equal(calls.filter(c=>c.path==='/v1/purchase-quotes').length,1);const posts=calls.filter(c=>c.path==='/v1/orders');assert.equal(posts.length,2);assert.equal(posts[0].init.body,posts[1].init.body);assert.equal(posts[0].init.headers['Idempotency-Key'],posts[1].init.headers['Idempotency-Key']);assert.equal(posts[1].init.headers['X-Xijie-Expected-Session'],next.sessionId)
 assert.equal((await client.buy(p)).orderId,o.orderId);assert.equal(calls.filter(c=>c.path==='/v1/orders').length,2)
 await assert.rejects(client.buy({...p,units:100}),e=>e.code==='CHECKOUT_PENDING')
})
test('wrong snapshot or malformed successful response retains its original operation and never confirms an order',async()=>{
 const p=product(),q=quote(p),o=order(p),ctx=context(),store=storage(),calls=[];let badQuote=true,badOrder=true
 const h=await harness(async(path,init)=>{calls.push({path,init});if(path==='/v1/purchase-quotes')return envelope(badQuote?{...q,productSnapshot:{...p,units:999}}:q);return envelope(badOrder?{}:o)},store),client=h.api.createCheckoutClient(ctx)
 await assert.rejects(client.buy(p),e=>e.code==='INVALID_RESPONSE');assert.equal(client.pending,'quote');assert.equal(calls.length,1);badQuote=false
 await assert.rejects(client.buy(p),e=>e.code==='INVALID_RESPONSE');assert.equal(client.pending,'order');badOrder=false;assert.equal((await client.buy(p)).orderId,o.orderId)
 const qs=calls.filter(c=>c.path==='/v1/purchase-quotes'),os=calls.filter(c=>c.path==='/v1/orders');assert.equal(qs[0].init.headers['Idempotency-Key'],qs[1].init.headers['Idempotency-Key']);assert.equal(os[0].init.headers['Idempotency-Key'],os[1].init.headers['Idempotency-Key'])
})
test('lost payment response replays one attempt and an already pending order never starts a fresh charge',async()=>{
 const ctx=context(),o=order(),store=storage(),calls=[],attemptId=randomUUID();let post=0
 const fetcher=async(path,init)=>{calls.push({path,init});if(init.method==='GET')return envelope(o);if(++post===1){Object.assign(o,{status:'confirming',paymentState:'confirming',attemptSummary:{attemptId,status:'pending'}});throw Error('lost payment acceptance')}return envelope(o)}
 let h=await harness(fetcher,store),c=h.api.createCheckoutClient(ctx);await assert.rejects(c.startPayment(o.orderId));assert.equal(c.pending,'attempt');c.dispose()
 h=await harness(fetcher,store);c=h.api.createCheckoutClient(ctx);assert.equal(c.pendingOrderId,o.orderId);assert.equal((await c.startPayment(o.orderId)).paymentState,'confirming');assert.equal(c.pending,undefined)
 const ps=calls.filter(c=>c.init.method==='POST');assert.equal(ps.length,2);assert.equal(ps[0].init.headers['Idempotency-Key'],ps[1].init.headers['Idempotency-Key']);assert.equal((await c.startPayment(o.orderId)).paymentState,'confirming');assert.equal(calls.filter(c=>c.init.method==='POST').length,2)
})
test('storage failures and corrupt recovery data stop writes before transport',async()=>{
 for(const store of [{getItem(){return null},setItem(){throw Error('blocked')}},{getItem(){return '{broken'},setItem(){throw Error('must not overwrite')}}]){
  let calls=0;const h=await harness(async()=>{calls++;throw Error('must not send')},store),c=h.api.createCheckoutClient(context());await assert.rejects(c.buy(product()),e=>e.code==='RECOVERY_STORAGE_UNAVAILABLE');assert.equal(calls,0)
 }
})

test('two browser tabs serialize the durable purchase identity when browser locks are available',async()=>{
 const p=product(),q=quote(p),o=order(p),store=storage(),ctx=context(),calls=[];let queue=Promise.resolve()
 const navigator={locks:{request(name,fn){assert.equal(name,'xijie.checkout.'+ctx.accountId);const result=queue.then(fn);queue=result.catch(()=>{});return result}}}
 const h=await harness(async(path,init)=>{calls.push({path,init});return envelope(path==='/v1/purchase-quotes'?q:o)},store,false,navigator),first=h.api.createCheckoutClient(ctx),second=h.api.createCheckoutClient(ctx)
 const results=await Promise.all([first.buy(p),second.buy(p)]);assert.equal(results[0].orderId,results[1].orderId);assert.equal(calls.filter(c=>c.init.method==='POST').length,2);assert.equal(calls.filter(c=>c.path==='/v1/purchase-quotes').length,1)
})
test('late authorization failure after disposal is fenced and retains payment identity for the original account',async()=>{
 const ctx=context(),p=product(),wait=deferred(),store=storage();let unauthorized=0;ctx.onUnauthorized=()=>unauthorized++
 const h=await harness(()=>wait.promise,store),c=h.api.createCheckoutClient(ctx),pending=c.buy(p);await new Promise(r=>setImmediate(r));c.dispose();c.activate();wait.resolve(deny(401,'UNAUTHORIZED'));await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(unauthorized,0);assert.equal(c.pending,'quote')
 const other=h.api.createCheckoutClient(context());assert.equal(other.purchase,undefined);assert.equal(other.pending,undefined)
})
test('a live 401, malformed success and foreign target all preserve unknown mutation keys',async()=>{
 const ctx=context(),o=order(),calls=[];let mode='unauthorized',unauthorized=0;ctx.onUnauthorized=()=>unauthorized++
 const h=await harness(async(path,init)=>{if(init.method==='GET')return envelope(o);calls.push(init);return mode==='unauthorized'?deny(401,'UNAUTHORIZED'):envelope(mode==='malformed'?{}:{...o,orderId:randomUUID()})}),c=h.api.createCheckoutClient(ctx)
 for(const value of ['unauthorized','malformed','foreign']){mode=value;await assert.rejects(c.startPayment(o.orderId));assert.equal(c.pending,'attempt')}
 assert.equal(unauthorized,1);assert.equal(new Set(calls.map(v=>v.headers['Idempotency-Key'])).size,1)
 await assert.rejects(c.close(o.orderId),e=>e.code==='CHECKOUT_PENDING')
})
test('refund review is read from the original order and unknown refunds reuse their own command',async()=>{
 const o=order(),ctx=context(),calls=[],store=storage();Object.assign(o,{status:'fulfilled',paymentState:'paid',paidAmount:o.price,fulfillmentStatus:'fulfilled'});let mode='lost'
 const h=await harness(async(path,init)=>{if(init.method==='GET')return envelope(o);calls.push(init);if(mode==='lost')throw Error('lost refund');if(mode==='review'){o.refund={refundId:randomUUID(),status:'review',failureCode:'REFUND_REQUIRES_REVIEW'};o.refundStatus='requested';return deny(409,'REFUND_REQUIRES_REVIEW')}return envelope(o)},store),c=h.api.createCheckoutClient(ctx)
 await assert.rejects(c.refund(o.orderId));assert.equal(c.pending,'refund');mode='review';assert.equal((await c.refund(o.orderId)).refund.status,'review');assert.equal(c.pending,undefined);assert.equal(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key'])
})

test('confirmed concurrent state changes release rejected commands only after reading the exact original order',async()=>{
 const o=order(),ctx=context();let posts=0
 const h=await harness(async(path,init)=>{if(init.method==='GET')return envelope(o);posts++;Object.assign(o,{paymentState:'confirming',status:'confirming',attemptSummary:{attemptId:randomUUID(),status:'pending'}});return deny(409,'PAYMENT_ATTEMPT_PENDING')}),c=h.api.createCheckoutClient(ctx)
 assert.equal((await c.startPayment(o.orderId)).paymentState,'confirming');assert.equal(c.pending,undefined);assert.equal(posts,1)
 Object.assign(o,{paymentState:'paid',status:'fulfilled',paidAmount:o.price,fulfillmentStatus:'fulfilled',attemptSummary:{...o.attemptSummary,status:'succeeded'}})
 assert.equal((await c.close(o.orderId)).paymentState,'paid');assert.equal(c.pending,undefined);assert.equal(posts,1)
 o.refund={refundId:randomUUID(),status:'pending',failureCode:null};o.refundStatus='pending';assert.equal((await c.refund(o.orderId)).refund.status,'pending');assert.equal(posts,1)
})
test('an authoritative expired quote releases only the unaccepted purchase and a new quote requires another action',async()=>{
 const p=product(),ctx=context(),calls=[];let phase=0
 const h=await harness(async(path,init)=>{calls.push({path,init});if(path==='/v1/purchase-quotes')return envelope(quote(p));if(phase++===0)return deny(409,'QUOTE_EXPIRED');return envelope(order(p))}),c=h.api.createCheckoutClient(ctx)
 await assert.rejects(c.buy(p),e=>e.code==='QUOTE_EXPIRED');assert.equal(c.purchase,undefined);assert.equal(c.pending,undefined);assert.equal(calls.length,2);await c.buy(p);assert.equal(calls.length,4);assert.notEqual(calls[1].init.headers['Idempotency-Key'],calls[3].init.headers['Idempotency-Key'])
})

test('a new server price is displayed for deliberate confirmation before any order is created',async()=>{
 const p=product(),updated={...p,version:p.version+1,price:{amount:800,currency:'CNY'}},q=quote(updated),o=order(updated),calls=[]
 const h=await harness(async(path,init)=>{calls.push({path,init});return envelope(path==='/v1/purchase-quotes'?q:o)}),client=h.api.createCheckoutClient(context())
 await assert.rejects(client.buy(p),e=>e.code==='PRICE_CHANGED');assert.equal(calls.length,1);assert.equal(client.purchase.product.price.amount,800);assert.equal(client.pending,undefined)
 assert.equal((await client.buy(client.purchase.product)).orderId,o.orderId);assert.equal(calls.length,2);assert.equal(calls[1].path,'/v1/orders');assert.equal(JSON.parse(calls[1].init.body).quoteId,q.quoteId)
})
test('redirects reject executable content, credentials and insecure production URLs; reads never mark a return paid',async()=>{
 const h=await harness(async()=>envelope(order()),storage(),true),valid={type:'redirect',url:'https://cashier.example/pay?token=one-use',expiresAt:'2026-11-15T09:00:00.000Z'}
 assert.equal(h.orders.validateCheckoutLaunch(valid).url,valid.url)
 for(const url of ['javascript:alert(1)','data:text/html,paid','https://user:secret@cashier.example/pay','http://cashier.example/pay','http://127.0.0.1:8080/pay'])assert.throws(()=>h.orders.validateCheckoutLaunch({...valid,url}),e=>e.code==='INVALID_RESPONSE')
 assert.equal(h.orders.validateCheckoutLaunch({...valid,url:'https://cashier.example/cashier/index.html#/hub/opaque-token'}).type,'redirect')
 const o=order();o.attemptSummary={attemptId:randomUUID(),status:'pending',launch:valid};assert.throws(()=>h.orders.validateOrder(o),e=>e.code==='INVALID_RESPONSE');o.status='confirming';o.paymentState='confirming';assert.equal(h.orders.validateOrder(o).paymentState,'confirming')
 const local=await harness(async()=>envelope(o));assert.equal(local.orders.validateCheckoutLaunch({...valid,url:'http://127.0.0.1:9999/pay'}).type,'redirect')
})

const element=(type,props,...children)=>({type,props:{...props,children:children.flat()}})
const nodes=node=>node&&typeof node==='object'?[node,...(node.props?.children??[]).flatMap(nodes)]:[]
const plain=node=>typeof node==='string'||typeof node==='number'?String(node):node&&typeof node==='object'?(node.props?.children??[]).map(plain).join(' '):''
test('the original purchase layout distinguishes unavailable/loading and opens only an explicitly clicked payment URL',async()=>{
 const src=await readFile(new URL('../src/commerce/ServiceCheckoutSheet.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('checkout.tsx',src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ServiceCheckout').getText(ast).replace('export ','')
 const compiled=ts.transpileModule(fn,{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText
 let state=[],index=0;const opened=[],h=await harness(async()=>envelope(order())),scope={React:{createElement:element},useI18n:()=>({lang:'zh-CN'}),isZh:()=>true,useRef:v=>({current:v}),useMemo:fn=>fn(),useCallback:fn=>fn,useEffect(){},useLayoutEffect(){},useState:v=>[index<state.length?state[index++]:((index++),v),()=>{}],createCheckoutClient:()=>({}),OrderServiceError:h.orders.OrderServiceError,validateCheckoutLaunch:h.orders.validateCheckoutLaunch,ContextSheet:'ContextSheet',ServiceOrderHistory:'ServiceOrderHistory',Check:'Check',Clock:'Clock',Stamp:'Stamp',Wallet:'Wallet',WarningCircle:'WarningCircle',X:'X',window:{open:(...args)=>opened.push(args)}}
 const render=vm.runInNewContext(compiled+'\nServiceCheckout',scope),props={context:context(),initialView:'purchase',onClose(){}}
 const tree=values=>{index=0;state=values;return render(props)}
 const loading=tree([{kind:'purchase'},[],'',false,false,null,true,'']);assert.match(plain(loading),/正在查询/);assert.doesNotMatch(plain(loading),/购买暂未开放|120|模拟付款/)
 const unavailable=tree([{kind:'purchase'},[],'',false,true,null,false,'']);assert.match(plain(unavailable),/购买暂未开放/);assert.equal(nodes(unavailable).filter(n=>n.type==='button'&&plain(n)==='创建订单').length,0)
 const p=product('paypal'),purchase=tree([{kind:'purchase'},[p],p.id,true,true,null,false,'']);assert.match(plain(purchase),/服务端配置邮资/);assert.match(plain(purchase),/创建订单/);assert.doesNotMatch(plain(purchase),/演示|模拟|Apple 内购/)
 const o=order(p);Object.assign(o,{paymentState:'confirming',status:'confirming',attemptSummary:{attemptId:randomUUID(),status:'pending',launch:{type:'redirect',url:'https://cashier.example/pay?token=private',expiresAt:'2099-11-15T09:00:00.000Z'}}})
 const detail=tree([{kind:'detail',id:o.orderId},[],'',true,true,o,false,'']);assert.equal(opened.length,0);const button=nodes(detail).find(n=>n.type==='button'&&plain(n)==='继续付款');assert(button);button.props.onClick();assert.deepEqual(opened,[['https://cashier.example/pay?token=private','_blank','noopener,noreferrer']]);assert.doesNotMatch(plain(detail),/邮资已到账|付款已确认/)
 o.attemptSummary.launch.url='javascript:alert(1)';button.props.onClick();assert.equal(opened.length,1)
 o.attemptSummary.launch=undefined;const unknown=tree([{kind:'detail',id:o.orderId},[],'',true,true,o,false,'',undefined,'attempt']);assert.equal(nodes(unknown).filter(n=>n.type==='button'&&plain(n)==='查询支付结果').length,1);assert.equal(nodes(unknown).filter(n=>n.type==='button'&&plain(n)==='继续上次付款').length,1)
})

test('documented payment return parameters are removed while unrelated query and hash remain',async()=>{
 const code=ts.transpileModule(await readFile(new URL('../src/commerce/checkoutReturn.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
 const state={kept:true},calls=[],sandbox=vm.createContext({URL,location:{href:'https://xijie.example/?preview=discovery&payment_id=payment_1&status=succeeded&payment_intent_client_secret=private&amount=600&manual_retry_allowed=false&signature=private&signature_algorithm=HMAC-SHA512&notice=invite#/keep'},history:{state,replaceState:(...args)=>calls.push(args)}})
 const mod=new vm.SourceTextModule(code,{context:sandbox});await mod.link(()=>{throw Error('No imports')});await mod.evaluate();mod.namespace.clearCheckoutReturnParameters();assert.equal(calls.length,1);assert.equal(calls[0][0],state)
 const url=new URL(calls[0][2]);assert.equal(url.searchParams.get('preview'),'discovery');assert.equal(url.searchParams.get('notice'),'invite');assert.equal(url.hash,'#/keep');assert.equal(url.searchParams.size,2)
 assert.equal(mod.namespace.sanitizeCheckoutReturnUrl('https://xijie.example/?status=ordinary&signature=unrelated&client_secret=other-flow'),null)
 assert.equal(mod.namespace.sanitizeCheckoutReturnUrl('https://xijie.example/?payment_client_secret=private&x=keep#story'),'https://xijie.example/?x=keep#story')
})
