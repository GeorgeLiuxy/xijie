import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {createHmac,randomUUID} from 'node:crypto'
import {HyperswitchProvider,hyperswitchReference} from '../dist/hyperswitch-provider.js'
import {createCommerceIntegration} from '../dist/jeepay-provider.js'
import {resolveIntegration} from '../dist/commerce-provider.js'

async function fixture(t){
 const operation=randomUUID(),refund=randomUUID(),order=randomUUID(),requests=[],now=new Date().toISOString(),key='merchant-api-key-isolated-test',secret='only-an-isolated-webhook-test-secret',state={payment:'requires_payment_method',refund:'pending',mutate:null,fail:false}
 let origin
 const payment=()=>({payment_id:hyperswitchReference('payment',operation),merchant_id:'merchant_test',profile_id:'pro_test',amount:100,amount_received:state.payment==='succeeded'?100:0,amount_capturable:0,currency:'USD',status:state.payment,capture_method:'automatic',created:now,modified_at:now,metadata:{xijie_order_id:order,xijie_operation_id:operation},payment_link:{link:origin+'/payment_link/test',secure_link:null},refunds:[]})
 const refunded=()=>({refund_id:hyperswitchReference('refund',refund),payment_id:hyperswitchReference('payment',operation),profile_id:'pro_test',amount:100,currency:'USD',status:state.refund,created_at:now,updated_at:now})
 const server=createServer(async(req,res)=>{
  assert.equal(req.headers['api-key'],key);let raw='';for await(const b of req)raw+=b;const body=raw?JSON.parse(raw):null;requests.push({path:req.url,method:req.method,body})
  if(state.fail){res.statusCode=500;res.end('{}');return}
  const data=req.url.startsWith('/refunds')?refunded():payment();state.mutate?.(data,req.url);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data))
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;t.after(()=>new Promise(r=>server.close(r)))
 const config={apiOrigin:origin,cashierOrigins:[origin],apiKey:key,merchantId:'merchant_test',profileId:'pro_test',webhookSecret:secret,returnUrl:origin+'/',liveMode:false,products:[]}
 const provider=new HyperswitchProvider(config),request={orderId:order,operationId:operation,amount:100,currency:'USD',channel:'hyperswitch',expiresAt:new Date(Date.now()+1800000).toISOString()},refundRequest={...request,operationId:refund,paymentOperationId:operation}
 return{provider,config,request,refundRequest,requests,payment,refunded,state,secret}
}
test('v1 payment/refund IDs are reversible, exactly thirty characters and stable for operation identity',()=>{
 const id='50dd036a-e3b9-4212-8124-e77a586fd0d7';assert.equal(hyperswitchReference('payment',id),'pay_xij_UN0DauO5QhKBJOd6WG_Q1w');assert.equal(hyperswitchReference('refund',id).length,30)
 assert.throws(()=>hyperswitchReference('payment','not-a-uuid'))
})
test('self-hosted payment link creates one explicitly priced automatic-capture payment and can recover its URL by GET',async t=>{
 const f=await fixture(t);f.state.mutate=d=>{d.payment_link.secure_link='https://iframe-only.example.test/link'};const started=await f.provider.startPayment(f.request);assert.equal(started.status,'pending');assert(started.launch.url.includes('/payment_link/test'))
 const body=f.requests[0].body;assert.equal(body.payment_id,hyperswitchReference('payment',f.request.operationId));assert.equal(body.payment_link,true);assert.equal(body.confirm,false);assert.equal(body.capture_method,'automatic');assert.equal(body.profile_id,'pro_test');assert.equal(body.metadata.xijie_order_id,f.request.orderId)
 const recovered=await f.provider.inspectPayment(f.request);assert.deepEqual(recovered,started);assert.equal(f.requests[1].method,'GET');assert(f.requests[1].path.endsWith('?force_sync=true'));assert.equal(f.requests.filter(r=>r.method==='POST').length,1)
})
test('success requires exact merchant profile order operation amount currency and full captured amount',async t=>{
 const f=await fixture(t);f.state.payment='succeeded';assert.equal((await f.provider.inspectPayment(f.request)).evidence.outcome,'paid')
 for(const[k,v]of [['merchant_id','another'],['profile_id','another'],['payment_id',hyperswitchReference('payment',randomUUID())],['amount',101],['currency','EUR']]){f.state.mutate=d=>{d[k]=v};await assert.rejects(f.provider.inspectPayment(f.request),{code:'PAYMENT_EVIDENCE_INVALID'})}
 for(const[k,v]of [['amount_received',50],['amount_capturable',50],['capture_method','manual'],['refunds',[{status:'succeeded'}]]]){f.state.mutate=d=>{d[k]=v};await assert.rejects(f.provider.inspectPayment(f.request),{code:'PAYMENT_REQUIRES_REVIEW'})}
 f.state.mutate=d=>{d.metadata.xijie_order_id=randomUUID()};await assert.rejects(f.provider.inspectPayment(f.request),{code:'PAYMENT_EVIDENCE_INVALID'})
})
test('untrusted checkout URLs, partial authorization and transport failure cannot produce a second payment',async t=>{
 const f=await fixture(t);f.state.mutate=d=>{d.payment_link.link='https://unexpected.example.test/pay'};await assert.rejects(f.provider.startPayment(f.request))
 f.state.mutate=null;f.state.payment='requires_capture';await assert.rejects(f.provider.inspectPayment(f.request),{code:'PAYMENT_REQUIRES_REVIEW'})
 f.state.fail=true;const before=f.requests.length;await assert.rejects(f.provider.inspectPayment(f.request),{code:'PAYMENT_OUTCOME_UNKNOWN'});assert.equal(f.requests.length,before+1)
})
test('refund uses fixed original payment and refund IDs; signed-in credentials alone cannot cross their bindings',async t=>{
 const f=await fixture(t);f.state.payment='succeeded';f.state.refund='succeeded';const r=await f.provider.startRefund(f.refundRequest);assert.equal(r.evidence.outcome,'refunded')
 const body=f.requests.find(r=>r.method==='POST').body;assert.equal(body.refund_type,'instant');assert.equal(body.payment_id,hyperswitchReference('payment',f.request.operationId));assert.equal(body.refund_id,hyperswitchReference('refund',f.refundRequest.operationId))
 f.state.mutate=(d,p)=>{if(p.startsWith('/refunds'))d.payment_id=hyperswitchReference('payment',randomUUID())};await assert.rejects(f.provider.inspectRefund(f.refundRequest),{code:'PAYMENT_EVIDENCE_INVALID'})
 f.state.mutate=null;f.state.refund='failed';assert.equal((await f.provider.inspectRefund(f.refundRequest)).evidence.outcome,'refund_failed')
})
test('raw-byte HMAC-SHA512 notification returns a wake reference; parsed JSON and tampered identities are rejected',async t=>{
 const f=await fixture(t),event={merchant_id:'merchant_test',event_id:'evt_test',event_type:'payment_succeeded',content:{type:'payment_details',object:f.payment()},timestamp:new Date().toISOString()}
 const raw=Buffer.from(JSON.stringify(event,null,2)),headers={'x-webhook-signature-512':createHmac('sha512',f.secret).update(raw).digest('hex')}
 assert.deepEqual(f.provider.verifyNotification(event,raw,headers),{kind:'payment',operationId:f.request.operationId})
 assert.equal(f.provider.verifyNotification(event,Buffer.from(JSON.stringify(event)),headers),null)
 assert.equal(f.provider.verifyNotification(event,raw,{'x-webhook-signature-512':'0'.repeat(128)}),null)
 const wrong=Buffer.from(JSON.stringify({...event,merchant_id:'another'}));assert.equal(f.provider.verifyNotification({},wrong,{'x-webhook-signature-512':createHmac('sha512',f.secret).update(wrong).digest('hex')}),null)
})
test('configured runtime supports both gateways while gateway bindings change with merchant identities',async t=>{
 const f=await fixture(t),old=process.env.NODE_ENV;process.env.NODE_ENV='production'
 try{
  // HTTPS origins for production; no network call occurs in factory creation.
  const hs={...f.config,apiOrigin:'https://hs.example.test',cashierOrigins:['https://hs.example.test'],returnUrl:'https://app.example.test/'},jp={gatewayOrigin:'https://jp.example.test',cashierOrigins:['https://jp.example.test'],notifyOrigin:'https://app.example.test',returnUrl:'https://app.example.test/',mchNo:'Mtest',appId:'Atest',appSecret:'isolated-secret',products:[]}
  const integrated=resolveIntegration(createCommerceIntegration({products:[],jeepay:jp,hyperswitch:hs}));assert.deepEqual(Object.keys(integrated.providers).sort(),['hyperswitch','jeepay'])
  assert.notEqual(integrated.providers.hyperswitch.binding,new HyperswitchProvider({...hs,merchantId:'another'}).binding)
 }finally{if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old}
})
