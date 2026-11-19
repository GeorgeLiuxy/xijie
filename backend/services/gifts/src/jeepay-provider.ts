import {createHash,timingSafeEqual} from 'node:crypto'
import {GiftsError,uuid} from './contracts.js'
import {privatePaymentUrl,type JeepayConfig,type CommerceConfig} from './commerce-config.js'
import {HyperswitchProvider} from './hyperswitch-provider.js'
import {configuredIntegration,type CommerceEvidence,type CommerceIntegration,type CommerceNotification,type CommerceProvider,type CommerceRequest,type CommerceResult} from './commerce-provider.js'

// JeePay v3.2.9_20260527 / API 1.0. The gateway stays an independent
// self-hosted service; this module implements its signed HTTP protocol.
type Scalar=string|number|boolean|null
type Fields=Record<string,Scalar>
const invalid=()=>new GiftsError(503,'PAYMENT_EVIDENCE_INVALID')
function fields(value:unknown):Fields{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>80)throw invalid()
 const output:Fields={}
 for(const[k,v]of Object.entries(value)){
  if(!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(k)||!['string','number','boolean'].includes(typeof v)&&v!==null||typeof v==='string'&&(v.length>8192||/\p{C}/u.test(v))||typeof v==='number'&&!Number.isSafeInteger(v))throw invalid()
  output[k]=v as Scalar
 }
 return output
}
export function jeepaySign(value:Fields,key:string){
 const items=Object.entries(value).filter(([k,v])=>k!=='sign'&&v!==null&&v!=='').map(([k,v])=>k+'='+String(v)+'&')
 items.sort((a,b)=>a.toLowerCase()<b.toLowerCase()?-1:a.toLowerCase()>b.toLowerCase()?1:0)
 return createHash('md5').update(items.join('')+'key='+key,'utf8').digest('hex').toUpperCase()
}
function signed(value:Fields,signature:unknown,key:string){
 if(typeof signature!=='string'||!/^[a-f0-9]{32}$/i.test(signature)||!timingSafeEqual(Buffer.from(signature.toUpperCase(),'ascii'),Buffer.from(jeepaySign(value,key),'ascii')))throw invalid()
}
function integer(value:Scalar|undefined){if(typeof value==='number'&&Number.isSafeInteger(value))return value;if(typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value)&&Number.isSafeInteger(Number(value)))return Number(value);throw invalid()}
function id(value:Scalar|undefined){if(typeof value!=='string'||!value||value.length>100||/\p{C}/u.test(value))throw invalid();return value}
function timestamp(value:Scalar|undefined){const n=integer(value);if(n<=0||n>Date.now()+60000)throw invalid();return new Date(n).toISOString()}

export class JeepayProvider implements CommerceProvider{
 readonly name='jeepay'
 readonly binding:string
 constructor(private readonly config:JeepayConfig){
  for(const url of [config.gatewayOrigin,config.notifyOrigin,config.returnUrl,...config.cashierOrigins])privatePaymentUrl(url)
  this.binding=createHash('sha256').update(JSON.stringify([config.gatewayOrigin,config.mchNo,config.appId])).digest('hex')
 }
 private base(){return{mchNo:this.config.mchNo,appId:this.config.appId,reqTime:String(Date.now()),version:'1.0',signType:'MD5'}}
 private async call(path:string,input:Fields,signal?:AbortSignal){
  const data={...this.base(),...input};const request={...data,sign:jeepaySign(data,this.config.appSecret)}
  let response:Response
  try{response=await fetch(new URL(path,this.config.gatewayOrigin),{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(request),redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)})}catch{throw new GiftsError(503,'PAYMENT_OUTCOME_UNKNOWN')}
  if(!response.ok){await response.body?.cancel();throw new GiftsError(503,'PAYMENT_OUTCOME_UNKNOWN')}
  const reader=response.body?.getReader();if(!reader)throw invalid();const chunks:Uint8Array[]=[];let length=0
  try{for(;;){const r=await reader.read();if(r.done)break;length+=r.value.byteLength;if(length>65536){await reader.cancel();throw invalid()}chunks.push(r.value)}}finally{reader.releaseLock()}
  let envelope:any;try{envelope=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw invalid()}
  // Error codes and unsigned error messages never prove failure of a charge.
  if(envelope?.code!==0)throw new GiftsError(503,'PAYMENT_OUTCOME_UNKNOWN')
  const result=fields(envelope.data);if(Object.hasOwn(result,'sign'))throw invalid();signed(result,envelope.sign,this.config.appSecret);return result
 }
 private request(input:CommerceRequest,kind:'payment'|'refund'){
  if(!uuid.test(input.orderId)||!uuid.test(input.operationId)||input.channel!=='jeepay'||input.currency!=='CNY'||!Number.isSafeInteger(input.amount)||input.amount<1)throw invalid()
  if(kind==='refund'&&(!input.paymentOperationId||!uuid.test(input.paymentOperationId)))throw invalid()
 }
 private owner(data:Fields){if(data.mchNo!==this.config.mchNo||data.appId!==this.config.appId)throw invalid()}
 private payment(data:Fields,input:CommerceRequest):CommerceResult{
  this.owner(data)
  if(data.mchOrderNo!==input.operationId||integer(data.amount)!==input.amount||data.currency!=='cny')throw invalid()
  const transactionId=id(data.payOrderId),state=integer(data.state)
  if(state===0||state===1)return{status:'pending'}
  // A gateway-side refund is a distinct financial fact requiring review;
  // it cannot be reclassified as unpaid or credited as a fresh purchase.
  if(state===5)throw new GiftsError(409,'EXTERNAL_REFUND_REQUIRES_REVIEW')
  if(![2,3,4,6].includes(state))throw invalid()
  return this.evidence(input,state===2?'paid':'unpaid',transactionId,state===2?data.successTime:data.createdAt)
 }
 private refund(data:Fields,input:CommerceRequest):CommerceResult{
  this.owner(data)
  if(data.mchRefundNo!==input.operationId||integer(data.payAmount)!==input.amount||integer(data.refundAmount)!==input.amount||data.currency!=='cny')throw invalid()
  const transactionId=id(data.refundOrderId),state=integer(data.state)
  if(state===0||state===1)return{status:'pending'}
  if(![2,3,4].includes(state))throw invalid()
  return this.evidence(input,state===2?'refunded':'refund_failed',transactionId,state===2?data.successTime:data.createdAt)
 }
 private evidence(input:CommerceRequest,outcome:CommerceEvidence['outcome'],transactionId:string,time:Scalar|undefined):CommerceResult{
  return{status:'verified',evidence:{outcome,orderId:input.orderId,operationId:input.operationId,eventId:transactionId+':'+outcome,transactionId,amount:input.amount,currency:input.currency,occurredAt:timestamp(time)}}
 }
 async startPayment(input:CommerceRequest):Promise<CommerceResult>{
  this.request(input,'payment')
  if(!input.expiresAt||!Number.isFinite(Date.parse(input.expiresAt))||Date.parse(input.expiresAt)<=Date.now())throw invalid()
  const created=await this.call('/api/pay/unifiedOrder',{mchOrderNo:input.operationId,wayCode:'QR_CASHIER',amount:input.amount,currency:'cny',subject:'西界邮资',body:'虚拟赠礼邮资',notifyUrl:new URL('/v1/callbacks/payments/jeepay',this.config.notifyOrigin).href,returnUrl:this.config.returnUrl,expiredTime:Math.max(1,Math.min(1800,Math.floor((Date.parse(input.expiresAt)-Date.now())/1000)))},input.signal)
  if(created.mchOrderNo!==input.operationId||!uuid.test(input.operationId))throw invalid()
  const query=await this.call('/api/pay/query',{mchOrderNo:input.operationId},input.signal)
  if(id(created.payOrderId)!==query.payOrderId)throw invalid()
  const result=this.payment(query,input)
  if(result.status!=='pending')return result
  if(created.payDataType!=='payurl'||typeof created.payData!=='string')throw invalid()
  const url=privatePaymentUrl(created.payData,process.env.NODE_ENV==='production',true)
  if(!this.config.cashierOrigins.includes(url.origin)||url.href.length>4096)throw invalid()
  return{status:'pending',launch:{type:'redirect',url:url.href,expiresAt:input.expiresAt}}
 }
 async inspectPayment(input:CommerceRequest):Promise<CommerceResult>{this.request(input,'payment');return this.payment(await this.call('/api/pay/query',{mchOrderNo:input.operationId},input.signal),input)}
 async startRefund(input:CommerceRequest):Promise<CommerceResult>{
  this.request(input,'refund')
  const payment=await this.call('/api/pay/query',{mchOrderNo:input.paymentOperationId!},input.signal)
  this.owner(payment);if(payment.mchOrderNo!==input.paymentOperationId||integer(payment.amount)!==input.amount||payment.currency!=='cny'||![2,5].includes(integer(payment.state)))throw invalid()
  const created=await this.call('/api/refund/refundOrder',{mchOrderNo:input.paymentOperationId!,mchRefundNo:input.operationId,refundAmount:input.amount,currency:'cny',refundReason:'用户申请整单退款',notifyUrl:new URL('/v1/callbacks/refunds/jeepay',this.config.notifyOrigin).href},input.signal)
  if(created.mchRefundNo!==input.operationId)throw invalid()
  return this.inspectRefund(input)
 }
 async inspectRefund(input:CommerceRequest):Promise<CommerceResult>{
  this.request(input,'refund')
  const data=await this.call('/api/refund/query',{mchRefundNo:input.operationId},input.signal)
  // Query both signed resources: the refund response has no original merchant
  // order reference, so its payOrderId must be joined to the original payment.
  const payment=await this.call('/api/pay/query',{mchOrderNo:input.paymentOperationId!},input.signal)
  this.owner(payment);if(payment.mchOrderNo!==input.paymentOperationId||integer(payment.amount)!==input.amount||payment.currency!=='cny'||data.payOrderId!==payment.payOrderId||![2,5].includes(integer(payment.state)))throw invalid()
  return this.refund(data,input)
 }
 verifyNotification(body:unknown):CommerceNotification|null{
  try{
   const data=fields(body),signature=data.sign;delete data.sign;signed(data,signature,this.config.appSecret);this.owner(data)
   // Notification time bounds replay; accepted duplicates remain idempotent.
   const instant=integer(data.reqTime);if(instant>Date.now()+60000||instant<Date.now()-86400000)return null
   const kind=Object.hasOwn(data,'mchRefundNo')?'refund':'payment',operationId=kind==='refund'?data.mchRefundNo:data.mchOrderNo
   if(typeof operationId!=='string'||!uuid.test(operationId)||data.currency!=='cny')return null
   const amount=integer(kind==='refund'?data.refundAmount:data.amount),state=integer(data.state)
   if(amount<1||!(kind==='refund'?[2,3,4]:[2,3,4,5,6]).includes(state))return null
   return{kind,operationId:operationId.toLowerCase()}
  }catch{return null}
 }
}
export function createCommerceIntegration(config?:CommerceConfig):CommerceIntegration|undefined{
 if(!config)return
 const providers:Record<string,CommerceProvider>={}
 if(config.jeepay)providers.jeepay=new JeepayProvider(config.jeepay)
 if(config.hyperswitch)providers.hyperswitch=new HyperswitchProvider(config.hyperswitch)
 const provider=Object.values(providers)[0];if(!provider)throw Error('No payment provider configured')
 return configuredIntegration({products:structuredClone(config.products),providers,provider})
}
