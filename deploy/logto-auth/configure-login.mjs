import {readFile, writeFile} from 'node:fs/promises'
import {parseEnv} from 'node:util'
import {resolve} from 'node:path'
import {createRequire} from 'node:module'
import {readerViolationSql} from './reader-policy.mjs'

// Operator tool only. Credentials are read from a private file, never argv or output.
const args=process.argv.slice(2),at=args.indexOf('--env'),file=at>=0?resolve(args[at+1]??''):null
if(!file||args.some((x,i)=>!['--env','--enable-phone-password','--create-reader'].includes(x)&&i!==at+1))throw Error('Usage: node configure-login.mjs --env PRIVATE_FILE [--enable-phone-password] [--create-reader]')
const original=await readFile(file,'utf8'),env=parseEnv(original),issuer=new URL(env.OIDC_ISSUER)
if(issuer.pathname.replace(/\/$/,'')!=='/oidc'||issuer.username||issuer.password||issuer.search||issuer.hash||!(issuer.protocol==='https:'||issuer.protocol==='http:'&&['localhost','127.0.0.1'].includes(issuer.hostname)))throw Error('Invalid fixed Logto issuer')
const resource=env.LOGTO_MANAGEMENT_RESOURCE
if(!resource||!env.LOGTO_MANAGEMENT_CLIENT_ID||!env.LOGTO_MANAGEMENT_CLIENT_SECRET)throw Error('Private operator Management API credentials and explicit resource are required')
async function token(id,secret,scope){
 const res=await fetch(new URL('/oidc/token',issuer),{method:'POST',redirect:'error',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:id,client_secret:secret,resource,scope}),signal:AbortSignal.timeout(15000)})
 if(!res.ok)throw Error('Logto operator token HTTP '+res.status)
 const value=await res.json();if(typeof value.access_token!=='string')throw Error('Invalid provider token response');return value
}
const operator=await token(env.LOGTO_MANAGEMENT_CLIENT_ID,env.LOGTO_MANAGEMENT_CLIENT_SECRET,'all')
async function api(method,path,body,bearer=operator.access_token){
 const res=await fetch(new URL('/api'+path,issuer),{method,redirect:'error',headers:{Authorization:'Bearer '+bearer,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)})
 if(!res.ok){let code;try{code=(await res.json()).code}catch{}throw Error('Logto '+method+' '+path.split('?')[0]+' HTTP '+res.status+' '+(typeof code==='string'?code:'provider_error'))}
 return res.status===204?null:res.json()
}
let experience=await api('GET','/sign-in-exp')
const connectors=await api('GET','/connectors')
if(args.includes('--enable-phone-password')){
 const phone=experience.signIn.methods.find(x=>x.identifier==='phone')
 if(!phone?.verificationCode)throw Error('Enable and verify the existing phone SMS sign-in method first')
 // Preserve SMS primary, existing sign-up rules, presentation and all other methods.
 const sms=connectors.find(x=>x.type==='Sms')
 if(!sms)throw Error('A configured SMS connector is required')
 if(sms.connectorId==='mock-short-message-service'){
  const config=structuredClone(sms.config),templates=config.templates
  if(!Array.isArray(templates))throw Error('Unexpected pinned mock SMS template schema')
  if(!templates.some(x=>x.usageType==='ForgotPassword')){
   const signIn=templates.find(x=>x.usageType==='SignIn');if(!signIn)throw Error('Mock SMS SignIn template is missing')
   templates.push({...signIn,usageType:'ForgotPassword'});await api('PATCH','/connectors/'+encodeURIComponent(sms.id),{config})
  }
 }
 await api('PATCH','/sign-in-exp',{signIn:{...experience.signIn,methods:experience.signIn.methods.map(x=>x.identifier==='phone'?{...x,password:true,isPasswordPrimary:false}:x)},forgotPasswordMethods:[...new Set([...(experience.forgotPasswordMethods??[]),'PhoneVerificationCode'])]})
 experience=await api('GET','/sign-in-exp')
}
let readerReady=false
if(args.includes('--create-reader')){
 const resources=await api('GET','/resources?page_size=100'),target=resources.find(x=>x.indicator===resource)
 if(!target)throw Error('Management resource is not registered')
 const scopes=await api('GET','/resources/'+encodeURIComponent(target.id)+'/scopes?page_size=100'),read=scopes.find(x=>x.name==='read:users')
 if(!read)throw Error('Pinned Logto read:users scope is missing')
 const roleName='Xijie account profile reader',appName='Xijie account profile reader'
 const roles=await api('GET','/roles?type=MachineToMachine&page_size=100')
 let role=roles.find(x=>x.name===roleName)
 if(!role)role=await api('POST','/roles',{name:roleName,description:'Read original bound phone only; no user writes or deletion',type:'MachineToMachine',scopeIds:[read.id]})
 const grants=await api('GET','/roles/'+encodeURIComponent(role.id)+'/scopes?page_size=100')
 if(grants.length!==1||grants[0].id!==read.id)throw Error('Reader role must contain exactly read:users')
 const apps=await api('GET','/applications?types=MachineToMachine&page_size=100')
 let app=apps.find(x=>x.name===appName)
 if(!app)app=await api('POST','/applications',{name:appName,type:'MachineToMachine'})
 const existingRoles=await api('GET','/applications/'+encodeURIComponent(app.id)+'/roles?page_size=100')
 if(existingRoles.some(x=>x.id!==role.id))throw Error('Reader application already has unrelated roles')
 if(!existingRoles.some(x=>x.id===role.id))await api('POST','/applications/'+encodeURIComponent(app.id)+'/roles',{roleIds:[role.id]})
 const secrets=await api('GET','/applications/'+encodeURIComponent(app.id)+'/secrets'),secret=secrets.find(x=>!x.expiresAt||x.expiresAt>Date.now())?.value
 if(!secret)throw Error('Reader application has no active secret')
 const proof=await token(app.id,secret,'read:users')
 if(proof.scope!=='read:users')throw Error('Reader token has unexpected permissions')
 const updates={LOGTO_ACCOUNT_READ_CLIENT_ID:app.id,LOGTO_ACCOUNT_READ_CLIENT_SECRET:secret,LOGTO_ACCOUNT_READ_RESOURCE:resource}
 let changed=original
 for(const [key,value]of Object.entries(updates)){if(/[\r\n"#]/.test(value))throw Error('Unsafe env value');const line=key+'='+value,pattern=new RegExp('^'+key+'=.*$','m');changed=pattern.test(changed)?changed.replace(pattern,line):changed.trimEnd()+'\n'+line+'\n'}
 await writeFile(file,changed,{mode:0o600});readerReady=true
}
if(env.LOGTO_ACCOUNT_READ_DATABASE_URL){
 const {Client}=createRequire(new URL('../../backend/services/identity/package.json',import.meta.url))('pg')
 const reader=new Client({connectionString:env.LOGTO_ACCOUNT_READ_DATABASE_URL,connectionTimeoutMillis:4000,statement_timeout:4000})
 try{
  await reader.connect()
  const value=(await reader.query(readerViolationSql('current_user'))).rows[0]
  if(!value||value.violation||(await reader.query("SHOW default_transaction_read_only")).rows[0].default_transaction_read_only!=='on')throw Error('Reader is not limited to the fixed view')
  await reader.query('SELECT subject,phone FROM xijie_auth_reader.bound_phones LIMIT 0');readerReady=true
 }finally{await reader.end()}
}
const phone=experience.signIn.methods.find(x=>x.identifier==='phone')
console.log(JSON.stringify({provider:'Logto',phone:{sms:phone?.verificationCode===true,password:phone?.password===true,passwordPrimary:phone?.isPasswordPrimary===true,reset:experience.forgotPasswordMethods?.includes('PhoneVerificationCode')===true},readerReady,readerDatabaseConfigured:Boolean(env.LOGTO_ACCOUNT_READ_DATABASE_URL),connectors:connectors.map(x=>({id:x.id,connectorId:x.connectorId,target:x.target,type:x.type})),realChannelsVerified:false},null,2))
