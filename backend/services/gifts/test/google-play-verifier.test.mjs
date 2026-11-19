import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { inspectGooglePlayPurchase, readGooglePlayVerificationConfig } from '../dist/google-play-verifier.js'

const packageName='app.xijie.fixture',productId='postage_30',mode='test'
const config={packageName,productId,mode,accessTokenFile:fileURLToPath(new URL('oauth-token.fixture',import.meta.url))}
const purchaseToken='test.receipt:single+/=',accountBinding='u'.repeat(43),orderId='GPA.7777-5555-3333-11111',accessToken='synthetic-oauth-token'
const input={purchaseToken,accountBinding}
const total={currencyCode:'USD',units:'1',nanos:990000000}
const purchase=()=>({
 purchaseStateContext:{purchaseState:'PURCHASED'},testPurchaseContext:{fopType:'TEST'},obfuscatedExternalAccountId:accountBinding,orderId,
 productLineItem:[{productId,productOfferDetails:{quantity:1,refundableQuantity:1,consumptionState:'CONSUMPTION_STATE_YET_TO_BE_CONSUMED'}}],
 purchaseCompletionTime:'2026-11-10T12:00:45.123456789Z',
})
const order=()=>({
 orderId,purchaseToken,state:'PROCESSED',buyerAddress:{buyerPostcode:'PRIVATE POSTCODE'},total,
 lineItems:[{productId,total,oneTimePurchaseDetails:{}}],
})
function intercepted({purchaseValue=purchase(),orderValue=order()}={}){
 const seen=[]
 const transport=async(url,request)=>{
  const parsed=new URL(url)
  seen.push(parsed.pathname)
  assert.equal(parsed.origin,'https://androidpublisher.googleapis.com')
  assert.equal(parsed.search,'')
  assert.equal(request.method,'GET')
  assert.equal(request.body,undefined)
  assert.equal(request.redirect,'error')
  assert.equal(request.headers.Authorization,'Bearer '+accessToken)
  assert.ok(request.signal instanceof AbortSignal)
  return Response.json(parsed.pathname.includes('/orders/')?orderValue:purchaseValue)
 }
 return {seen,transport}
}

test('Play verification is disabled by default and the operator command refuses to read request files while disabled',async()=>{
 assert.equal(readGooglePlayVerificationConfig({}),undefined)
 assert.equal(readGooglePlayVerificationConfig({GIFTS_GOOGLE_PLAY_VERIFICATION_ENABLED:'false',GIFTS_GOOGLE_PLAY_VERIFICATION_MODE:'live'}),undefined)
 assert.throws(()=>readGooglePlayVerificationConfig({GIFTS_GOOGLE_PLAY_VERIFICATION_ENABLED:'true'}),{code:'GOOGLE_PLAY_VERIFICATION_UNAVAILABLE'})
 assert.deepEqual(readGooglePlayVerificationConfig({
  GIFTS_GOOGLE_PLAY_VERIFICATION_ENABLED:'true',GIFTS_GOOGLE_PLAY_PACKAGE:packageName,GIFTS_GOOGLE_PLAY_PRODUCT_ID:productId,
  GIFTS_GOOGLE_PLAY_VERIFICATION_MODE:mode,GIFTS_GOOGLE_PLAY_ACCESS_TOKEN_FILE:config.accessTokenFile,
 }),config)
 await assert.rejects(inspectGooglePlayPurchase(undefined,accessToken,input,{transport:()=>assert.fail('network called while disabled')}),{code:'GOOGLE_PLAY_VERIFICATION_UNAVAILABLE'})
 const disabled=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/google-play-verify.mjs',import.meta.url)),'does-not-exist'],{
  env:{...process.env,GIFTS_GOOGLE_PLAY_VERIFICATION_ENABLED:'false'},encoding:'utf8',
 })
 assert.equal(disabled.status,1)
 assert.equal(disabled.stdout,'')
 assert.deepEqual(JSON.parse(disabled.stderr),{code:'GOOGLE_PLAY_VERIFICATION_UNAVAILABLE'})
})

test('verified purchase uses exclusively publisher GET evidence, exact app/account/SKU, and final buyer money',async()=>{
 const f=intercepted(),actual=await inspectGooglePlayPurchase(config,accessToken,input,f)
 assert.deepEqual(f.seen,[
  '/androidpublisher/v3/applications/'+packageName+'/purchases/productsv2/tokens/'+encodeURIComponent(purchaseToken),
  '/androidpublisher/v3/applications/'+packageName+'/orders/'+orderId,
 ])
 assert.match(actual.purchaseFingerprint,/^[a-f0-9]{64}$/)
 assert.deepEqual(actual,{
  purchaseFingerprint:actual.purchaseFingerprint,storeOrderId:orderId,mode,productId,state:'purchased',
  completedAt:'2026-11-10T12:00:45.123Z',consumption:'available',totalPaid:total,
 })
 const consumed=purchase()
 consumed.productLineItem[0].productOfferDetails.consumptionState='CONSUMPTION_STATE_CONSUMED'
 assert.deepEqual(await inspectGooglePlayPurchase(config,accessToken,input,intercepted({purchaseValue:consumed})),{...actual,consumption:'consumed'})
 assert.doesNotMatch(JSON.stringify(actual),/PRIVATE|synthetic-oauth-token|receipt|obfuscated/)
})

test('pending transactions and confirmed cancellations and refunds never return usable purchase totals',async()=>{
 const pending={
  purchaseStateContext:{purchaseState:'PENDING'},testPurchaseContext:{fopType:'TEST'},obfuscatedExternalAccountId:accountBinding,productLineItem:[{productId}],
 }
 const f=intercepted({purchaseValue:pending}),value=await inspectGooglePlayPurchase(config,accessToken,input,f)
 assert.deepEqual(value,{purchaseFingerprint:value.purchaseFingerprint,storeOrderId:null,mode,productId,state:'pending'})
 assert.equal(f.seen.length,1)
 for(const [playState,state] of [['CANCELED','canceled'],['PENDING_REFUND','refund_pending'],['PARTIALLY_REFUNDED','partially_refunded'],['REFUNDED','refunded']]){
  const f=intercepted({orderValue:{...order(),state:playState}})
  assert.deepEqual(await inspectGooglePlayPurchase(config,accessToken,input,f),{...value,storeOrderId:orderId,state})
 }
})

test('wrong account, test/live mismatches, multi-quantity, unrelated and invalid money evidence fail closed',async()=>{
 const many=purchase()
 many.productLineItem[0].productOfferDetails.quantity=2
 const wrongAccount={...input,accountBinding:'r'.repeat(43)},live={...config,mode:'live'}
 const cases=[
  [config,wrongAccount,intercepted(),'GOOGLE_PLAY_ACCOUNT_MISMATCH'],
  [live,input,intercepted(),'GOOGLE_PLAY_ENVIRONMENT_MISMATCH'],
  [config,input,intercepted({purchaseValue:{...purchase(),testPurchaseContext:{}}}),'GOOGLE_PLAY_ENVIRONMENT_MISMATCH'],
  [config,input,intercepted({purchaseValue:{...purchase(),productLineItem:[{productId:'different_sku'}]}}),'GOOGLE_PLAY_EVIDENCE_INVALID'],
  [config,input,intercepted({purchaseValue:many}),'GOOGLE_PLAY_EVIDENCE_INVALID'],
  [config,input,intercepted({orderValue:{...order(),purchaseToken:'substituted-receipt'}}),'GOOGLE_PLAY_EVIDENCE_INVALID'],
  [config,input,intercepted({orderValue:{...order(),total:{...total,units:'2'}}}),'GOOGLE_PLAY_EVIDENCE_INVALID'],
  [config,input,intercepted({orderValue:{...order(),total:{...total,nanos:1000000000}}}),'GOOGLE_PLAY_EVIDENCE_INVALID'],
 ]
 for(const [c,i,f,code] of cases)await assert.rejects(inspectGooglePlayPurchase(c,accessToken,i,f),{code})
 const real=purchase()
 delete real.testPurchaseContext
 await assert.rejects(inspectGooglePlayPurchase(config,accessToken,input,intercepted({purchaseValue:real})),{code:'GOOGLE_PLAY_ENVIRONMENT_MISMATCH'})
 assert.equal((await inspectGooglePlayPurchase(live,accessToken,input,intercepted({purchaseValue:real}))).mode,'live')
})

test('transport failures, unknown orders, path tricks and oversize responses never leak response details',async()=>{
 for(const token of ['.','..','?access_token=secret','\r\nAuthorization: secret']){
  await assert.rejects(inspectGooglePlayPurchase(config,accessToken,{...input,purchaseToken:token},{transport:()=>assert.fail('invalid path was dispatched')}),{code:'VALIDATION_FAILED'})
 }
 for(const [transport,code] of [
  [async()=>{throw new Error('PRIVATE NETWORK FAILURE')},'GOOGLE_PLAY_VERIFICATION_UNAVAILABLE'],
  [async()=>new Response('PRIVATE PROVIDER ERROR',{status:403}),'GOOGLE_PLAY_VERIFICATION_UNAVAILABLE'],
  [async()=>new Response('PRIVATE ORDER NOT FOUND',{status:404}),'GOOGLE_PLAY_EVIDENCE_NOT_FOUND'],
  [async()=>new Response('P'.repeat(65537)),'GOOGLE_PLAY_EVIDENCE_INVALID'],
 ])await assert.rejects(inspectGooglePlayPurchase(config,accessToken,input,{transport}),e=>e.code===code&&!e.message.includes('PRIVATE'))
})
