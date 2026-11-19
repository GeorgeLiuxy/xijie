import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {createHash,randomUUID} from 'node:crypto'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {JeepayProvider,jeepaySign,createCommerceIntegration} from '../dist/jeepay-provider.js'
import {readCommerceConfig} from '../dist/commerce-config.js'
import {resolveIntegration} from '../dist/commerce-provider.js'

// Independent scalar implementation of the official Java getSign contract.
const sign=(v,key)=>createHash('md5').update(Object.keys(v).filter(k=>k!=='sign'&&v[k]!==null&&v[k]!=='').sort((a,b)=>a.toUpperCase()<b.toUpperCase()?-1:a.toUpperCase()>b.toUpperCase()?1:0).map(k=>`${k}=${v[k]}&`).join('')+'key='+key).digest('hex').toUpperCase()
const product={id:'configured-postage',version:1,name:'Configured postage',units:10,assetType:'postage',assetId:'postage',price:{amount:100,currency:'CNY'},channel:'jeepay'}
async function gateway(t){
 const key='isolated-fixture-secret-only',requests=[],operation=randomUUID(),refund=randomUUID(),order=randomUUID(),now=Date.now(),state={pay:1,refund:1,mutate:null,oversized:false}
 const payment=()=>({mchNo:'Mtest',appId:'Atest',mchOrderNo:operation,payOrderId:'Ptest',amount:100,currency:'cny',state:state.pay,createdAt:now-1000,...(state.pay===2||state.pay===5?{successTime:now}:{})})
 const refunded=()=>({mchNo:'Mtest',appId:'Atest',mchRefundNo:refund,refundOrderId:'Rtest',payOrderId:'Ptest',payAmount:100,refundAmount:100,currency:'cny',state:state.refund,createdAt:now-1000,...(state.refund===2?{successTime:now}:{})})
 let origin
 const server=createServer(async(req,res)=>{
  let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);requests.push({path:req.url,body});assert.equal(body.sign,sign(body,key));assert.equal(body.mchNo,'Mtest');assert.equal(body.appId,'Atest');assert.equal(body.version,'1.0')
  if(state.oversized){res.end('x'.repeat(70000));return}
  let data=req.url==='/api/pay/unifiedOrder'?{mchOrderNo:operation,payOrderId:'Ptest',orderState:0,payDataType:'payurl',payData:origin+'/cashier/index.html#/hub/synthetic-private-link'}:req.url==='/api/pay/query'?payment():req.url==='/api/refund/refundOrder'?{mchRefundNo:refund,refundOrderId:'Rtest',state:state.refund}:refunded()
  state.mutate?.(data,req.url);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:0,data,sign:state.badSign?'0'.repeat(32):sign(data,key)}))
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;t.after(()=>new Promise(r=>server.close(r)))
 const config={gatewayOrigin:origin,cashierOrigins:[origin],mchNo:'Mtest',appId:'Atest',appSecret:key,notifyOrigin:origin,returnUrl:origin+'/',products:[product]},provider=new JeepayProvider(config)
 const request={orderId:order,operationId:operation,expiresAt:new Date(now+1800000).toISOString(),amount:100,currency:'CNY',channel:'jeepay'},refundRequest={...request,operationId:refund,paymentOperationId:operation}
 return{provider,config,request,refundRequest,requests,state,payment,refunded,key,origin}
}
test('JeePay signing follows sorted nonempty UTF-8 scalars, retaining zero, false and raw delimiters',()=>{
 const value={z:'中文&x=1',Amount:0,boolean:false,empty:'',nil:null,sign:'ignored'}
 assert.equal(jeepaySign(value,'test-secret'),sign(value,'test-secret'))
 assert.notEqual(jeepaySign({...value,Amount:null},'test-secret'),jeepaySign(value,'test-secret'))
})
test('signature matches independent unmodified official Java SDK oracle vectors',()=>{
 // SDK commit 75d1f1a0090e53fa33fefc2ff27e47ab35bb9425,
 // JeepayKit.java SHA256 0f4dc652047623c0f4d894d97983f3576fbc1e358f0c5c6d253e210be9f73164.
 const vectors=[
  [{mchNo:'M2000001',appId:'A1000001',amount:10000,currency:'CNY',version:'1.0',signType:'MD5',reqTime:'1794729600000',mchOrderNo:'50dd036a-e3b9-4212-8124-e77a586fd0d7',wayCode:'QR_CASHIER',subject:'西界邮资',body:'邮资购买'},'2FAD1D20DA04D751DA73B937AC09EEA1'],
  [{mchNo:'M2000001',appId:'A1000001',amount:0,state:0,channelOrderNo:'',successTime:null,subject:'纸鹤 & 日光',extParam:'a=b&c=中文 + ☀'},'66694F09F705571E62FF85E22CE658B5'],
  [{zebra:'last',Alpha:'first',beta:'middle',amount:1},'627A26FF03D4973218C6F049CAC701D6'],
 ]
 for(const[data,expected]of vectors)assert.equal(jeepaySign(data,'testKey'),expected)
})
test('configured factory is usable outside tests; arbitrary synthetic injection remains prohibited',()=>{
 assert.equal(readCommerceConfig({}),undefined);assert.equal(createCommerceIntegration(),undefined)
 assert.throws(()=>readCommerceConfig({GIFTS_COMMERCE_ENABLED:'yes'}));assert.throws(()=>readCommerceConfig({GIFTS_COMMERCE_ENABLED:'true'}))
 const old=process.env.NODE_ENV;process.env.NODE_ENV='production';try{assert.throws(()=>resolveIntegration({testOnly:true,products:[product],provider:{name:'synthetic'}}),/isolated tests/)}finally{if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old}
})
test('private product configuration has explicit activation, no default price, and strict CNY minor units',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'xijie-jeepay-config-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=path.join(dir,'product.json');await writeFile(file,JSON.stringify([product]))
 const env={GIFTS_COMMERCE_ENABLED:'true',GIFTS_COMMERCE_PROVIDER:'jeepay',JEEPAY_GATEWAY_ORIGIN:'https://pay.example.test',JEEPAY_CASHIER_ORIGINS:'https://pay.example.test',GIFTS_PUBLIC_ORIGIN:'https://api.example.test',GIFTS_WEB_ORIGIN:'https://app.example.test',JEEPAY_MCH_NO:'Mtest',JEEPAY_APP_ID:'Atest',JEEPAY_APP_SECRET:'isolated-fixture-secret',GIFTS_COMMERCE_PRODUCTS_FILE:file}
 assert.equal(readCommerceConfig(env).products[0].price.amount,100)
 assert.throws(()=>readCommerceConfig({...env,JEEPAY_GATEWAY_ORIGIN:'https://user:pass@pay.example.test'}))
 assert.throws(()=>readCommerceConfig({...env,JEEPAY_CASHIER_ORIGINS:'https://pay.example.test/unexpected'}))
 assert.throws(()=>readCommerceConfig({...env,GIFTS_COMMERCE_PRODUCTS_FILE:'relative.json'}))
 await writeFile(file,JSON.stringify([{...product,price:{amount:0,currency:'CNY'}}]));assert.throws(()=>readCommerceConfig(env))
})
test('real HTTP adapter signs requests and releases only an allowlisted cashier link after signed authoritative query',async t=>{
 const f=await gateway(t),r=await f.provider.startPayment(f.request);assert.equal(r.status,'pending');assert.equal(r.launch.url,f.origin+'/cashier/index.html#/hub/synthetic-private-link');assert.equal(r.launch.expiresAt,f.request.expiresAt)
 assert.deepEqual(f.requests.map(r=>r.path),['/api/pay/unifiedOrder','/api/pay/query']);assert.equal(f.requests[0].body.mchOrderNo,f.request.operationId);assert.equal(f.requests[0].body.wayCode,'QR_CASHIER');assert(f.requests[0].body.expiredTime<=1800)
 assert.equal(new URL(f.requests[0].body.notifyUrl).pathname,'/v1/callbacks/payments/jeepay')
 f.state.pay=2;const paid=await f.provider.inspectPayment(f.request);assert.equal(paid.evidence.outcome,'paid');assert.equal(paid.evidence.orderId,f.request.orderId);assert.equal(paid.evidence.operationId,f.request.operationId)
})
test('forged signatures, merchant mismatch, amount, currency, redirect origins and refunded payment never issue evidence',async t=>{
 const f=await gateway(t)
 f.state.badSign=true;await assert.rejects(f.provider.inspectPayment(f.request),{code:'PAYMENT_EVIDENCE_INVALID'});f.state.badSign=false
 for(const[k,value]of [['mchNo','another'],['appId','another'],['amount',101],['currency','usd'],['mchOrderNo',randomUUID()]]){f.state.mutate=d=>{d[k]=value};await assert.rejects(f.provider.inspectPayment(f.request),{code:'PAYMENT_EVIDENCE_INVALID'})}
 f.state.mutate=(d,p)=>{if(p==='/api/pay/unifiedOrder')d.payData='https://other.example.test/pay'};await assert.rejects(f.provider.startPayment(f.request))
 f.state.mutate=null;f.state.pay=5;await assert.rejects(f.provider.inspectPayment(f.request),{code:'EXTERNAL_REFUND_REQUIRES_REVIEW'})
 f.state.oversized=true;await assert.rejects(f.provider.inspectPayment(f.request),{code:'PAYMENT_EVIDENCE_INVALID'})
})
test('unknown transport performs no implicit second request or payment; terminal failure requires signed query',async t=>{
 const f=await gateway(t);f.state.pay=6;const r=await f.provider.inspectPayment(f.request);assert.equal(r.evidence.outcome,'unpaid');assert.equal(f.requests.length,1)
 const c=new AbortController();c.abort();await assert.rejects(f.provider.startPayment({...f.request,signal:c.signal}),{code:'PAYMENT_OUTCOME_UNKNOWN'});assert.equal(f.requests.length,1)
})
test('refund joins original signed payment and refund identities before producing capture or release evidence',async t=>{
 const f=await gateway(t);f.state.pay=2;f.state.refund=2;const r=await f.provider.startRefund(f.refundRequest);assert.equal(r.evidence.outcome,'refunded');assert.equal(r.evidence.operationId,f.refundRequest.operationId)
 const sent=f.requests.find(r=>r.path==='/api/refund/refundOrder').body;assert.equal(sent.mchOrderNo,f.request.operationId);assert.equal(sent.mchRefundNo,f.refundRequest.operationId)
 f.state.mutate=(d,p)=>{if(p==='/api/refund/query')d.payOrderId='wrong-payment'};await assert.rejects(f.provider.inspectRefund(f.refundRequest),{code:'PAYMENT_EVIDENCE_INVALID'})
 f.state.mutate=null;f.state.refund=3;assert.equal((await f.provider.inspectRefund(f.refundRequest)).evidence.outcome,'refund_failed')
})
test('signed form notifications validate merchant, time and operation; they return only a wake-up reference',async t=>{
 const f=await gateway(t),data={...f.payment(),state:'2',reqTime:String(Date.now()),amount:'100'}
 const body={...data,sign:sign(data,f.key)};assert.deepEqual(f.provider.verifyNotification(body),{kind:'payment',operationId:f.request.operationId})
 assert.equal(f.provider.verifyNotification({...body,amount:'101'}),null)
 const retry={...data,reqTime:String(Date.now()-450000)};assert.deepEqual(f.provider.verifyNotification({...retry,sign:sign(retry,f.key)}),{kind:'payment',operationId:f.request.operationId})
 const old={...data,reqTime:String(Date.now()-86460000)};assert.equal(f.provider.verifyNotification({...old,sign:sign(old,f.key)}),null)
 const wrong={...data,mchNo:'someone-else'};assert.equal(f.provider.verifyNotification({...wrong,sign:sign(wrong,f.key)}),null)
 const array={...body,amount:['100','100']};assert.equal(f.provider.verifyNotification(array),null)
})
