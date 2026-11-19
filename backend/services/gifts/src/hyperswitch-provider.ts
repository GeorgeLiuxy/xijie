import {createHash,createHmac,timingSafeEqual} from 'node:crypto'
import {GiftsError,uuid} from './contracts.js'
import {privatePaymentUrl,type HyperswitchConfig} from './commerce-config.js'
import type {CommerceEvidence,CommerceNotification,CommerceProvider,CommerceRequest,CommerceResult} from './commerce-provider.js'

const invalid=()=>new GiftsError(503,'PAYMENT_EVIDENCE_INVALID')
export function hyperswitchReference(kind:'payment'|'refund',id:string){if(!uuid.test(id))throw invalid();return(kind==='payment'?'pay_xij_':'ref_xij_')+Buffer.from(id.replaceAll('-',''),'hex').toString('base64url')}
function operation(kind:'payment'|'refund',reference:unknown){
 if(typeof reference!=='string')throw invalid();const prefix=kind==='payment'?'pay_xij_':'ref_xij_'
 if(!reference.startsWith(prefix)||reference.length!==30)throw invalid()
 const hex=Buffer.from(reference.slice(prefix.length),'base64url').toString('hex');if(hex.length!==32)throw invalid()
 const id=[hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-')
 if(!uuid.test(id)||hyperswitchReference(kind,id)!==reference)throw invalid();return id
}
function time(value:unknown){if(typeof value!=='string')throw invalid();const normalized=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?$/.test(value)?value+'Z':value;const n=Date.parse(normalized);if(!Number.isFinite(n)||n>Date.now()+60000)throw invalid();return new Date(n).toISOString()}
export class HyperswitchProvider implements CommerceProvider{
 readonly name='hyperswitch'
 readonly binding:string
 constructor(private readonly config:HyperswitchConfig){for(const url of [config.apiOrigin,config.returnUrl,...config.cashierOrigins])privatePaymentUrl(url);this.binding=createHash('sha256').update(JSON.stringify([config.apiOrigin,config.merchantId,config.profileId,config.liveMode])).digest('hex')}
 private async call(path:string,method:'GET'|'POST',body:unknown,signal?:AbortSignal):Promise<any>{
  let response:Response
  try{response=await fetch(new URL(path,this.config.apiOrigin),{method,headers:{'api-key':this.config.apiKey,'Content-Type':'application/json','Accept':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{}),redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)})}catch{throw new GiftsError(503,'PAYMENT_OUTCOME_UNKNOWN')}
  if(!response.ok){await response.body?.cancel();throw new GiftsError(503,'PAYMENT_OUTCOME_UNKNOWN')}
  const reader=response.body?.getReader();if(!reader)throw invalid();const chunks:Uint8Array[]=[];let size=0
  try{for(;;){const value=await reader.read();if(value.done)break;size+=value.value.byteLength;if(size>262144){await reader.cancel();throw invalid()}chunks.push(value.value)}}finally{reader.releaseLock()}
  let value:any;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw invalid()}
  if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();return value
 }
 private input(r:CommerceRequest,kind:'payment'|'refund'){
  if(!uuid.test(r.orderId)||!uuid.test(r.operationId)||r.channel!=='hyperswitch'||!Number.isSafeInteger(r.amount)||r.amount<1||!/^[A-Z]{3}$/.test(r.currency)||kind==='refund'&&(!r.paymentOperationId||!uuid.test(r.paymentOperationId)))throw invalid()
 }
 private payment(data:any,r:CommerceRequest):CommerceResult{
  if(data.payment_id!==hyperswitchReference('payment',r.operationId)||data.merchant_id!==this.config.merchantId||data.profile_id!==this.config.profileId||data.amount!==r.amount||data.currency!==r.currency||data.metadata?.xijie_order_id!==r.orderId||data.metadata?.xijie_operation_id!==r.operationId)throw invalid()
  if(['requires_payment_method','requires_confirmation','requires_customer_action','processing','requires_merchant_action'].includes(data.status)){
   // secure_link is restricted to an allowlisted iframe by upstream. This
   // integration intentionally opens the standard self-hosted link top-level.
   const link=data.payment_link?.link
   if(link===undefined||link===null)return{status:'pending'}
   if(typeof link!=='string'||!r.expiresAt||Date.parse(r.expiresAt)<=Date.now())throw invalid()
   const url=privatePaymentUrl(link);if(!this.config.cashierOrigins.includes(url.origin)||url.href.length>4096)throw invalid()
   return{status:'pending',launch:{type:'redirect',url:url.href,expiresAt:r.expiresAt}}
  }
  if(!['succeeded','failed','cancelled'].includes(data.status))throw new GiftsError(409,'PAYMENT_REQUIRES_REVIEW')
  if(data.status==='succeeded'&&(data.amount_received!==r.amount||data.amount_capturable!==0||data.capture_method!=='automatic'||data.refunds?.some((v:any)=>v.status==='succeeded'||v.status==='pending')))throw new GiftsError(409,'PAYMENT_REQUIRES_REVIEW')
  return this.evidence(r,data.status==='succeeded'?'paid':'unpaid',data.payment_id,data.modified_at??data.created)
 }
 private evidence(r:CommerceRequest,outcome:CommerceEvidence['outcome'],transactionId:string,occurredAt:unknown):CommerceResult{
  return{status:'verified',evidence:{outcome,orderId:r.orderId,operationId:r.operationId,eventId:transactionId+':'+outcome,transactionId,amount:r.amount,currency:r.currency,occurredAt:time(occurredAt)}}
 }
 async startPayment(r:CommerceRequest):Promise<CommerceResult>{
  this.input(r,'payment');if(!r.expiresAt||!Number.isFinite(Date.parse(r.expiresAt))||Date.parse(r.expiresAt)<=Date.now())throw invalid()
  const data=await this.call('/payments','POST',{payment_id:hyperswitchReference('payment',r.operationId),amount:r.amount,currency:r.currency,profile_id:this.config.profileId,payment_link:true,confirm:false,capture_method:'automatic',return_url:this.config.returnUrl,description:'Postage for virtual gifts',session_expiry:Math.max(1,Math.min(1800,Math.floor((Date.parse(r.expiresAt)-Date.now())/1000))),metadata:{xijie_order_id:r.orderId,xijie_operation_id:r.operationId}},r.signal)
  return this.payment(data,r)
 }
 async inspectPayment(r:CommerceRequest):Promise<CommerceResult>{this.input(r,'payment');return this.payment(await this.call('/payments/'+hyperswitchReference('payment',r.operationId)+'?force_sync=true','GET',undefined,r.signal),r)}
 async startRefund(r:CommerceRequest):Promise<CommerceResult>{
  this.input(r,'refund')
  await this.originalPayment(r)
  await this.call('/refunds','POST',{payment_id:hyperswitchReference('payment',r.paymentOperationId!),refund_id:hyperswitchReference('refund',r.operationId),amount:r.amount,reason:'requested_by_customer',refund_type:'instant',metadata:{xijie_order_id:r.orderId,xijie_operation_id:r.operationId}},r.signal)
  return this.inspectRefund(r)
 }
 private async originalPayment(r:CommerceRequest){
  const p=await this.call('/payments/'+hyperswitchReference('payment',r.paymentOperationId!)+'?force_sync=true','GET',undefined,r.signal)
  if(p.payment_id!==hyperswitchReference('payment',r.paymentOperationId!)||p.merchant_id!==this.config.merchantId||p.profile_id!==this.config.profileId||p.amount!==r.amount||p.amount_received!==r.amount||p.amount_capturable!==0||p.currency!==r.currency||p.status!=='succeeded'||p.metadata?.xijie_order_id!==r.orderId||p.metadata?.xijie_operation_id!==r.paymentOperationId)throw invalid()
  return p
 }
 async inspectRefund(r:CommerceRequest):Promise<CommerceResult>{
  this.input(r,'refund')
  const data=await this.call('/refunds/'+hyperswitchReference('refund',r.operationId),'GET',undefined,r.signal);await this.originalPayment(r)
  if(data.refund_id!==hyperswitchReference('refund',r.operationId)||data.payment_id!==hyperswitchReference('payment',r.paymentOperationId!)||data.profile_id!==this.config.profileId||data.amount!==r.amount||data.currency!==r.currency)throw invalid()
  if(['pending','review'].includes(data.status))return{status:'pending'}
  if(!['succeeded','failed'].includes(data.status))throw invalid()
  return this.evidence(r,data.status==='succeeded'?'refunded':'refund_failed',data.refund_id,data.updated_at??data.created_at)
 }
 verifyNotification(_body:unknown,raw?:Buffer,headers?:Record<string,string|undefined>):CommerceNotification|null{
  try{
   const signature=headers?.['x-webhook-signature-512'];if(!raw||raw.byteLength>65536||typeof signature!=='string'||!/^[a-f0-9]{128}$/i.test(signature))return null
   const actual=createHmac('sha512',this.config.webhookSecret).update(raw).digest(),provided=Buffer.from(signature,'hex');if(!timingSafeEqual(actual,provided))return null
   const data=JSON.parse(raw.toString('utf8'));if(data.merchant_id!==this.config.merchantId||!data.event_id||typeof data.event_id!=='string')return null
   time(data.timestamp)
   const kind=data.content?.type==='payment_details'?'payment':data.content?.type==='refund_details'?'refund':null;if(!kind)return null
   const resource=data.content.object;if(resource.profile_id!==this.config.profileId)return null
   return{kind,operationId:operation(kind,kind==='payment'?resource.payment_id:resource.refund_id)}
  }catch{return null}
 }
}
