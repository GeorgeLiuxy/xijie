import {readFileSync} from 'node:fs'
import {isAbsolute} from 'node:path'
import type {CommerceProduct} from './commerce-provider.js'

export type JeepayConfig={gatewayOrigin:string;cashierOrigins:string[];mchNo:string;appId:string;appSecret:string;notifyOrigin:string;returnUrl:string;products:CommerceProduct[]}
export type HyperswitchConfig={apiOrigin:string;cashierOrigins:string[];apiKey:string;merchantId:string;profileId:string;webhookSecret:string;returnUrl:string;liveMode:boolean;products:CommerceProduct[]}
export type CommerceConfig={products:CommerceProduct[];jeepay?:JeepayConfig;hyperswitch?:HyperswitchConfig}
const local=new Set(['localhost','127.0.0.1','[::1]'])
export function privatePaymentUrl(value:string,production=process.env.NODE_ENV==='production',allowFragment=false){
 const u=new URL(value)
 if(u.username||u.password||!allowFragment&&u.hash||!(u.protocol==='https:'||!production&&u.protocol==='http:'&&local.has(u.hostname)))throw Error('Invalid private payment URL')
 return u
}
const required=(env:NodeJS.ProcessEnv,key:string)=>{const v=env[key]?.trim();if(!v)throw Error('Missing payment configuration: '+key);return v}
function origin(value:string,production?:boolean){const u=privatePaymentUrl(value,production);if(u.pathname!=='/'||u.search)throw Error('Payment origin must not contain a path');return u.origin}
export function readCommerceConfig(env:NodeJS.ProcessEnv=process.env):CommerceConfig|undefined{
 const flag=env.GIFTS_COMMERCE_ENABLED
 if(flag!==undefined&&!['true','false'].includes(flag))throw Error('Invalid GIFTS_COMMERCE_ENABLED')
 if(flag!=='true')return
 const providerList=(env.GIFTS_COMMERCE_PROVIDERS??required(env,'GIFTS_COMMERCE_PROVIDER')).split(',').map(v=>v.trim())
 if(!providerList.length||providerList.length>2||new Set(providerList).size!==providerList.length||providerList.some(v=>!['jeepay','hyperswitch'].includes(v)))throw Error('Unsupported commerce provider')
 const production=env.NODE_ENV==='production',returnUrl=new URL('/',origin(required(env,'GIFTS_WEB_ORIGIN'),production)).href
 const origins=(key:string)=>{const values=[...new Set(required(env,key).split(',').map(v=>origin(v.trim(),production)))];if(!values.length||values.length>5)throw Error('Invalid cashier origins');return values}
 const file=required(env,'GIFTS_COMMERCE_PRODUCTS_FILE');if(!isAbsolute(file))throw Error('Payment product file must be an absolute private path')
 let raw:unknown;try{raw=JSON.parse(readFileSync(file,'utf8'))}catch{throw Error('Cannot read payment product configuration')}
 if(!Array.isArray(raw)||raw.length<1||raw.length>20)throw Error('Configure one to twenty explicit payment products')
 const products=raw as CommerceProduct[]
 for(const p of products){if(!p||typeof p!=='object'||Object.keys(p).some(k=>!['id','version','name','units','assetType','assetId','price','channel'].includes(k))||!/^[a-z0-9-]{1,80}$/.test(p.id)||!Number.isSafeInteger(p.version)||p.version<1||typeof p.name!=='string'||!p.name.trim()||p.name.length>64||/\p{C}/u.test(p.name)||!Number.isSafeInteger(p.units)||p.units<1||p.units>1000000||p.assetType!=='postage'||p.assetId!=='postage'||!providerList.includes(p.channel)||!p.price||Object.keys(p.price).sort().join(',')!=='amount,currency'||!Number.isSafeInteger(p.price.amount)||p.price.amount<1||p.price.amount>2147483647||!/^[A-Z]{3}$/.test(p.price.currency)||p.channel==='jeepay'&&p.price.currency!=='CNY')throw Error('Invalid payment product configuration')}
 if(new Set(products.map(p=>p.id)).size!==products.length)throw Error('Duplicate payment product ID')
 const result:CommerceConfig={products:structuredClone(products)}
 if(providerList.includes('jeepay')){
  const mchNo=required(env,'JEEPAY_MCH_NO'),appId=required(env,'JEEPAY_APP_ID'),appSecret=required(env,'JEEPAY_APP_SECRET')
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(mchNo)||!/^[A-Za-z0-9_-]{1,64}$/.test(appId)||appSecret.length<16||appSecret.length>256||/[\p{C}\s]/u.test(appSecret))throw Error('Invalid JeePay merchant credentials')
  result.jeepay={gatewayOrigin:origin(required(env,'JEEPAY_GATEWAY_ORIGIN'),production),notifyOrigin:origin(required(env,'GIFTS_PUBLIC_ORIGIN'),production),cashierOrigins:origins('JEEPAY_CASHIER_ORIGINS'),mchNo,appId,appSecret,returnUrl,products:products.filter(p=>p.channel==='jeepay')}
 }
 if(providerList.includes('hyperswitch')){
  const apiKey=required(env,'HYPERSWITCH_API_KEY'),merchantId=required(env,'HYPERSWITCH_MERCHANT_ID'),profileId=required(env,'HYPERSWITCH_PROFILE_ID'),webhookSecret=required(env,'HYPERSWITCH_WEBHOOK_SECRET'),mode=required(env,'HYPERSWITCH_ENVIRONMENT')
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(merchantId)||!/^[A-Za-z0-9_-]{1,128}$/.test(profileId)||apiKey.length<16||apiKey.length>512||/[\p{C}\s]/u.test(apiKey)||webhookSecret.length<32||webhookSecret.length>512||/\p{C}/u.test(webhookSecret)||!['sandbox','live'].includes(mode))throw Error('Invalid Hyperswitch credentials')
  result.hyperswitch={apiOrigin:origin(required(env,'HYPERSWITCH_API_ORIGIN'),production),cashierOrigins:origins('HYPERSWITCH_CASHIER_ORIGINS'),apiKey,merchantId,profileId,webhookSecret,returnUrl,liveMode:mode==='live',products:products.filter(p=>p.channel==='hyperswitch')}
 }
 return result
}
