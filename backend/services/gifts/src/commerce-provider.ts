import {GiftsError,hash,invalid,object} from './contracts.js'
export type CommerceProduct={id:string;version:number;name:string;units:number;assetType:'postage';assetId:'postage';price:{amount:number;currency:string};channel:string}
export type CommerceLaunch={type:'redirect';url:string;expiresAt:string}
export type CommerceRequest={orderId:string;operationId:string;paymentOperationId?:string;expiresAt?:string;amount:number;currency:string;channel:string;signal?:AbortSignal}
export type CommerceEvidence={outcome:'paid'|'unpaid'|'refunded'|'refund_failed';orderId:string;operationId:string;eventId:string;transactionId:string;amount:number;currency:string;occurredAt:string}
export type CommerceResult={status:'pending';launch?:CommerceLaunch}|{status:'verified';evidence:CommerceEvidence}
export type CommerceNotification={kind:'payment'|'refund';operationId:string}
export interface CommerceProvider{readonly name:string;readonly binding?:string;startPayment(input:CommerceRequest):Promise<CommerceResult>;inspectPayment(input:CommerceRequest):Promise<CommerceResult>;startRefund(input:CommerceRequest):Promise<CommerceResult>;inspectRefund(input:CommerceRequest):Promise<CommerceResult>;verifyNotification?(body:unknown,raw?:Buffer,headers?:Record<string,string|undefined>):CommerceNotification|null}
export type CommerceIntegration={products:CommerceProduct[];provider:CommerceProvider;providers?:Record<string,CommerceProvider>}
export type CommerceTestIntegration={testOnly:true;products:CommerceProduct[];provider:CommerceProvider}
const configured=new WeakSet<object>()
// A runtime integration is constructed from validated private configuration;
// an arbitrary injected provider remains restricted to isolated tests.
export function configuredIntegration(value:CommerceIntegration){configured.add(value);return value}
export function resolveIntegration(value?:CommerceIntegration|CommerceTestIntegration):CommerceIntegration|undefined{
 if(!value)return
 return configured.has(value)?value:testIntegration(value as CommerceTestIntegration)
}
export const purchaseUnavailable=()=>new GiftsError(503,'PURCHASE_UNAVAILABLE')
export function testIntegration(value?:CommerceTestIntegration){
 if(!value)return
 if(process.env.NODE_ENV!=='test'||value.testOnly!==true||value.provider.name!=='synthetic')throw Error('Commerce adapter injection is restricted to isolated tests')
 for(const p of value.products){object(p,['id','version','name','units','assetType','assetId','price','channel']);object(p.price,['amount','currency']);if(!/^[a-z0-9-]{1,80}$/.test(p.id)||!Number.isSafeInteger(p.version)||p.version<1||typeof p.name!=='string'||!p.name||!Number.isSafeInteger(p.units)||p.units<1||p.units>1000000||p.assetType!=='postage'||p.assetId!=='postage'||!Number.isSafeInteger(p.price.amount)||p.price.amount<1||p.price.amount>2147483647||!/^[A-Z]{3}$/.test(p.price.currency)||p.channel!=='synthetic')throw invalid()}
 return{products:structuredClone(value.products),provider:value.provider}
}
export function verified(result:CommerceResult,request:CommerceRequest,kind:'payment'|'refund'){
 if(result?.status==='pending'&&Object.keys(result).every(k=>['status','launch'].includes(k))){
  if(result.launch){const l=result.launch;let u:URL;try{u=new URL(l.url)}catch{throw new GiftsError(503,'PAYMENT_EVIDENCE_INVALID')}
   if(Object.keys(l).length!==3||l.type!=='redirect'||u.username||u.password||!(u.protocol==='https:'||process.env.NODE_ENV!=='production'&&u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname))||!Number.isFinite(Date.parse(l.expiresAt))||Date.parse(l.expiresAt)<=Date.now())throw new GiftsError(503,'PAYMENT_EVIDENCE_INVALID')
  }
  return null
 }
 if(result?.status!=='verified'||Object.keys(result).length!==2)throw new GiftsError(503,'PAYMENT_EVIDENCE_INVALID')
 const e=object(result.evidence,['outcome','orderId','operationId','eventId','transactionId','amount','currency','occurredAt']) as CommerceEvidence
 if(Object.keys(e).length!==8||e.orderId!==request.orderId||e.operationId!==request.operationId||e.amount!==request.amount||e.currency!==request.currency||!(kind==='payment'?['paid','unpaid']:['refunded','refund_failed']).includes(e.outcome)||[e.eventId,e.transactionId].some(x=>typeof x!=='string'||x.length<1||x.length>200||/\p{C}/u.test(x))||typeof e.occurredAt!=='string'||!Number.isFinite(Date.parse(e.occurredAt))||Date.parse(e.occurredAt)>Date.now()+60000)throw new GiftsError(503,'PAYMENT_EVIDENCE_INVALID')
 const canonical={outcome:e.outcome,orderId:e.orderId,operationId:e.operationId,eventId:e.eventId,transactionId:e.transactionId,amount:e.amount,currency:e.currency,occurredAt:new Date(e.occurredAt).toISOString()}
 return{...canonical,fingerprint:hash(JSON.stringify(canonical))}
}
