import 'reflect-metadata'
import assert from 'node:assert/strict'
import {createHash,createSign,generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'
import {Pool} from 'pg'
import {NestFactory} from '@nestjs/core'
import {IdentityStore} from '../dist/store.js'
import {ConsentStore} from '../dist/consent-store.js'
import {createOidcProvider} from '../dist/oidc.js'
import {NativeAuthStore,NativeAuthError} from '../dist/native-auth.js'
import {NativeWechatAuth} from '../dist/native-wechat.js'
import {IdentityModule,IdentityErrors,identityHeaders} from '../dist/http.js'

const hash=v=>createHash('sha256').update(v).digest('hex'),proof=()=>randomBytes(32).toString('base64url')

async function providerFixture(){
 let origin,subject='wechat-subject-original',loseVerify=false,loseAuthorization=false,verifyGate,fixtureError
 const interactions=new Map(),codes=new Map(),sdkCodes=new Map(),users=new Set(),counts={authorization:0,verify:0,submit:0,token:0}
 const keys=generateKeyPairSync('rsa',{modulusLength:2048}),jwk={...keys.publicKey.export({format:'jwk'}),kid:'wechat-fixture',alg:'RS256',use:'sig'},clientId='sdk-fixture',clientSecret='synthetic-sdk-secret-'+randomUUID(),appId='wx0000000000000000',connector='synthetic-wechat-native',callbackUrl='http://127.0.0.1:5184/v1/auth/callback'
 const server=createServer((req,res)=>void(async()=>{
  const url=new URL(req.url,origin),json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json',...(url.pathname.startsWith('/api/experience')?{'Set-Cookie':'provider_only_cookie=synthetic-provider-only-cookie; Path=/; HttpOnly'}:{})});res.end(value===undefined?'':JSON.stringify(value))}
  if(url.pathname.includes('.well-known'))return json(200,{issuer:origin+'/oidc',authorization_endpoint:origin+'/oidc/auth',token_endpoint:origin+'/oidc/token',jwks_uri:origin+'/oidc/jwks',response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],token_endpoint_auth_methods_supported:['client_secret_basic']})
  if(url.pathname==='/oidc/jwks')return json(200,{keys:[jwk]})
  if(url.pathname==='/oidc/auth'){
   assert.equal(url.searchParams.get('scope'),'openid');assert.equal(url.searchParams.get('client_id'),clientId);assert.equal(url.searchParams.get('redirect_uri'),callbackUrl);assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('direct_sign_in'),null,'SDK uses the official Experience transaction rather than starting browser social twice')
   const id=randomUUID();interactions.set(id,{id,state:url.searchParams.get('state'),nonce:url.searchParams.get('nonce'),challenge:url.searchParams.get('code_challenge')});res.writeHead(303,{Location:'/sign-in','Set-Cookie':'_interaction='+id+'; Path=/; HttpOnly'});return res.end()
  }
  if(url.pathname.startsWith('/oidc/auth/')){
   const item=interactions.get(url.pathname.split('/').at(-1));assert(item?.identified);const code=randomUUID();codes.set(code,{...item});const cb=new URL(callbackUrl);cb.searchParams.set('state',item.state);cb.searchParams.set('code',code);res.writeHead(303,{Location:cb.href});return res.end()
  }
  let text='';for await(const chunk of req)text+=chunk
  if(url.pathname==='/oidc/token'){
   counts.token++;assert.deepEqual(Buffer.from(req.headers.authorization.slice(6),'base64').toString().split(':').map(decodeURIComponent),[clientId,clientSecret]);const fields=new URLSearchParams(text),code=codes.get(fields.get('code'));assert(code);codes.delete(fields.get('code'));assert.equal(createHash('sha256').update(fields.get('code_verifier')).digest('base64url'),code.challenge)
   const now=Math.floor(Date.now()/1000),head=Buffer.from(JSON.stringify({alg:'RS256',kid:'wechat-fixture'})).toString('base64url'),body=Buffer.from(JSON.stringify({iss:origin+'/oidc',aud:clientId,sub:code.subject,nonce:code.nonce,iat:now,exp:now+300,auth_time:now})).toString('base64url'),input=head+'.'+body,id_token=input+'.'+createSign('RSA-SHA256').update(input).sign(keys.privateKey).toString('base64url');return json(200,{access_token:'synthetic-access-token',token_type:'Bearer',expires_in:300,scope:'openid',id_token})
  }
  const item=interactions.get(/(?:^|;\s*)_interaction=([^;]+)/.exec(req.headers.cookie??'')?.[1]);if(!item)return json(404,{code:'session.not_found'})
  const b=text?JSON.parse(text):{}
  if(url.pathname==='/api/experience'&&req.method==='PUT'){assert.equal(b.interactionEvent,'SignIn');item.event=b.interactionEvent;return json(204)}
  if(url.pathname==='/api/experience/interaction-event'){item.event=b.interactionEvent;return json(204)}
  if(url.pathname==='/api/experience/verification/social/'+connector+'/authorization-uri'){
   counts.authorization++;assert.match(b.state,/^[A-Za-z0-9_-]{43}$/);assert.equal(b.redirectUri,'http://127.0.0.1:5184/native-auth/complete');item.sdkState=b.state;item.verificationId=randomUUID();const code='synthetic-wechat-'+randomUUID();sdkCodes.set(b.state,code);if(loseAuthorization){loseAuthorization=false;req.socket.destroy();return}return json(200,{verificationId:item.verificationId,authorizationUri:'wechat://authorize?app_id='+appId+'&state='+b.state})
  }
  if(url.pathname==='/api/experience/verification/social/'+connector+'/verify'){
   counts.verify++;assert.equal(b.verificationId,item.verificationId);assert.equal(b.connectorData.state,item.sdkState);assert.equal(b.connectorData.code,sdkCodes.get(item.sdkState));sdkCodes.delete(item.sdkState);item.verified=true;item.subject=subject
   if(verifyGate){const gate=verifyGate;verifyGate=undefined;gate.enter();await gate.wait}
   if(loseVerify){loseVerify=false;req.socket.destroy();return}return json(200,{verificationId:item.verificationId})
  }
  if(url.pathname==='/api/experience/identification'){
   assert(item.verified);assert.equal(b.verificationId,item.verificationId);if(item.event==='SignIn'&&!users.has(item.subject))return json(404,{code:'user.identity_not_exist'});item.identified=true;return json(204)
  }
  if(url.pathname==='/api/experience/submit'){
   counts.submit++;assert(item.identified);if(item.event==='Register')users.add(item.subject);return json(200,{redirectTo:origin+'/oidc/auth/'+item.id})
  }
  json(404,{code:'not_found'})
 })().catch(error=>{fixtureError={name:error.name,message:error.message};res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({code:'fixture.failed'}))}))
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port
 return{issuer:new URL(origin+'/oidc'),clientId,clientSecret,callbackUrl,appId,connector,counts,users,sdkCodes,error:()=>fixtureError,subject:v=>{subject=v},loseVerify:()=>{loseVerify=true},loseAuthorization:()=>{loseAuthorization=true},pauseVerify(){let enter,release;const entered=new Promise(r=>{enter=r}),wait=new Promise(r=>{release=r});verifyGate={enter,wait};return{entered,release}},close:()=>new Promise(r=>{server.close(r);server.closeIdleConnections()})}
}

test('WeChat SDK BFF keeps one-time provider codes private and only the original WebView can redeem a verified OIDC subject',async t=>{
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL;if(!connectionString)throw Error('Isolated database required')
 const admin=new Pool({connectionString}),schema='wechat_sdk_'+randomUUID().replaceAll('-',''),p=await providerFixture(),saved=Object.fromEntries(['NODE_ENV','OIDC_WECHAT_NATIVE_ENABLED','LOGTO_WECHAT_NATIVE_CONNECTOR_ID','WECHAT_NATIVE_APP_ID'].map(k=>[k,process.env[k]]));let pool,app,origin,publishFailure=false,publishLost=false
 t.after(async()=>{await app?.close();await p.close();await pool?.end();await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await admin.end();for(const[k,v]of Object.entries(saved))v===undefined?delete process.env[k]:process.env[k]=v})
 process.env.NODE_ENV='test';process.env.OIDC_WECHAT_NATIVE_ENABLED='true';process.env.LOGTO_WECHAT_NATIVE_CONNECTOR_ID=p.connector;process.env.WECHAT_NATIVE_APP_ID=p.appId
 await admin.query('CREATE SCHEMA '+schema);pool=new Pool({connectionString,options:'-c search_path='+schema})
 for(const file of ['001_identity.sql','002_consents.sql','003_embedded_auth.sql','004_ai_text_processing.sql','005_data_rights.sql','025_social_auth_attempts.sql','026_native_auth_handoff.sql','029_google_social_auth.sql','030_password_auth.sql','031_native_wechat.sql'])await pool.query(await readFile(new URL('../db/'+file,import.meta.url),'utf8'))
 const config={issuer:p.issuer,clientId:p.clientId,clientSecret:p.clientSecret,callbackUrl:p.callbackUrl,origin:'http://127.0.0.1:5184',secure:false,clientRegistrationKey:'wechat-sdk-test',socialProviders:{apple:false,google:false,wechat:true},nativeHandoffEnabled:true},store=new IdentityStore(pool),oidc=await createOidcProvider(config),native=new NativeAuthStore(pool,store,oidc,config),wechat=new NativeWechatAuth(pool,store,native,oidc,config),publish=native.publishSdkVerified.bind(native)
 native.publishSdkVerified=async input=>{if(publishFailure){publishFailure=false;throw new NativeAuthError(503,'AUTH_RESULT_UNKNOWN')}const result=await publish(input);if(publishLost){publishLost=false;throw new NativeAuthError(503,'AUTH_RESULT_UNKNOWN')}return result}
 app=await NestFactory.create(IdentityModule.register(config,store,oidc,new ConsentStore(pool,store),undefined,undefined,undefined,undefined,native,undefined,wechat),{logger:false,abortOnError:false});app.use(identityHeaders);app.useGlobalFilters(new IdentityErrors());await app.listen(0,'127.0.0.1');origin=await app.getUrl()
 const headers={Origin:config.origin,'Content-Type':'application/json'},cookie=res=>res.headers.getSetCookie().find(v=>v.startsWith('xijie_dev_browser='))?.split(';')[0],cookieBoundaries=[]
 async function send(path,body,cookies,key=randomUUID(),expected,method='POST'){
  const response=await fetch(origin+'/v1/'+path,{method,headers:{...headers,'Idempotency-Key':key,...(cookies?{Cookie:cookies}:{}),...(expected?{'X-Xijie-Expected-Session':expected}:{})},...(body!==undefined&&{body:JSON.stringify(body)})})
  if(/^auth\/native-wechat\/[^/]+\/(launch|complete)$/.test(path)){
   const action=path.split('/').at(-1);cookieBoundaries.push({action,status:response.status})
   assert.deepEqual(response.headers.getSetCookie(),[],action+' '+response.status+' must never set cookies, including unknown and replay responses')
   assert.equal(response.headers.get('Set-Cookie'),null)
   const text=await response.clone().text();for(const marker of ['provider_only_cookie','synthetic-provider-only-cookie','_interaction='])assert(!text.includes(marker),'provider cookies must never enter the native response body')
  }
  return response
 }
 async function begin({cookies,purpose='sign_in',expected,key=randomUUID()}={}){
  const verifier=proof(),launchProof=proof(),body={provider:'wechat',purpose,transport:'wechat_sdk',verifierChallenge:hash(verifier),launchProof},res=await send('auth/native-attempts',body,cookies,key,expected);assert.equal(res.status,201,JSON.stringify(await res.clone().json()));assert(res.headers.getSetCookie().every(v=>v.startsWith('xijie_dev_browser=')),'start may bind only the browser, never an App or provider session');return{value:(await res.json()).data,cookies:cookie(res)+(cookies?.includes('xijie_dev_session=')?'; '+cookies.split('; ').find(c=>c.startsWith('xijie_dev_session=')):''),verifier,launchProof,startKey:key,startBody:body,expected,launchKey:randomUUID(),completeKey:randomUUID(),redeemKey:randomUUID()}
 }
 async function launch(a,overrides={}){return send('auth/native-wechat/'+a.value.attemptId+'/launch',{launchProof:a.launchProof,...overrides},a.cookies,a.launchKey,a.expected)}
 async function ready(a){const res=await launch(a);assert.equal(res.status,200,JSON.stringify(await res.clone().json()));a.launch=(await res.json()).data;a.code=p.sdkCodes.get(a.launch.state);assert(a.code);return a}
 async function complete(a,overrides={},options={}){return send('auth/native-wechat/'+a.value.attemptId+'/complete',{code:a.code,state:a.launch.state,verifier:a.verifier,...overrides},options.cookies??a.cookies,options.key??a.completeKey,options.expected??a.expected)}
 async function verified(a){const res=await complete(a);assert.equal(res.status,200,JSON.stringify(await res.clone().json()));a.ticket=(await res.json()).data.ticket;return a}
 async function redeem(a,key=a.redeemKey){const res=await send('auth/native-attempts/'+a.value.attemptId+'/redeem',{ticket:a.ticket,verifier:a.verifier},a.cookies,key,a.expected),value=await res.clone().json();if(res.ok&&value.data?.status==='verified'){assert.equal(res.headers.getSetCookie().length,1);assert(res.headers.getSetCookie()[0].startsWith('xijie_dev_session='),'only original-WebView redemption sets an App session')}else assert.deepEqual(res.headers.getSetCookie(),[],'reauthentication and failed redemption never set cookies');return res}
 let original,originalCookies,originalCurrent
 await t.test('SDK launch is bound and replayable; code/state/verifier and ticket never set a session before original redeem',async()=>{
  const caps=(await(await fetch(origin+'/v1/auth/providers')).json()).data;assert.equal(caps.find(p=>p.id==='wechat').nativeSdkEnabled,true)
  original=await begin();assert.equal(original.value.transport,'wechat_sdk');assert.equal(new URL(original.value.launchUrl).pathname,'/v1/auth/native-wechat/'+original.value.attemptId+'/launch')
  const replay=await send('auth/native-attempts',original.startBody,original.cookies,original.startKey);assert.equal(replay.status,201);assert.equal((await replay.json()).data.attemptId,original.value.attemptId)
  assert.equal((await launch(original,{launchProof:proof()})).status,403);await ready(original);const before=p.counts.authorization;const repeatedLaunch=await launch(original);assert.equal(repeatedLaunch.status,200);assert.deepEqual((await repeatedLaunch.json()).data,original.launch);assert.equal(p.counts.authorization,before)
  const checks=p.counts.verify;assert.equal((await complete(original,{state:proof()})).status,403);assert.equal((await complete(original,{verifier:proof()})).status,403);assert.equal((await complete(original,{}, {cookies:'xijie_dev_browser='+proof()})).status,403);assert.equal(p.counts.verify,checks)
  const completed=await complete(original);assert.equal(completed.status,200,JSON.stringify(await completed.clone().json()));assert.equal(completed.headers.getSetCookie().length,0);const receipt=(await completed.json()).data;original.ticket=receipt.ticket;assert.match(receipt.ticket,/^[A-Za-z0-9_-]{43}$/);assert(Number.isFinite(Date.parse(receipt.expiresAt)))
  assert.equal((await pool.query('SELECT count(*)::int n FROM app_sessions')).rows[0].n,0)
  const replayComplete=await complete(original);assert.equal(replayComplete.status,200);assert.deepEqual((await replayComplete.json()).data,receipt);assert.equal((await complete(original,{}, {key:randomUUID()})).status,409)
  const result=await redeem(original);assert.equal(result.status,200);assert.deepEqual(await result.json(),{data:{status:'verified'}});const sessionCookie=result.headers.getSetCookie().find(v=>v.startsWith('xijie_dev_session=')).split(';')[0];originalCookies=original.cookies+'; '+sessionCookie;originalCurrent=(await(await fetch(origin+'/v1/sessions/current',{headers:{Cookie:originalCookies}})).json()).data
  const again=await redeem(original);assert.equal(again.status,200);assert.equal(again.headers.getSetCookie().find(v=>v.startsWith('xijie_dev_session=')).split(';')[0],sessionCookie);assert.equal((await redeem(original,randomUUID())).status,409)
  assert.equal((await pool.query('SELECT count(*)::int n FROM accounts')).rows[0].n,1)
 })
 await t.test('simultaneous complete requests consume the external code only once and replays return the same ticket',async()=>{
  const a=await ready(await begin()),gate=p.pauseVerify(),before=p.counts.verify,first=complete(a);await gate.entered;const concurrent=await complete(a);assert.equal(concurrent.status,503);assert.equal((await concurrent.json()).error.code,'AUTH_RESULT_UNKNOWN');assert.equal(p.counts.verify,before+1);gate.release();const result=await first;assert.equal(result.status,200);const value=(await result.json()).data;assert.deepEqual((await(await complete(a)).json()).data,value);assert.equal(p.counts.verify,before+1)
 })
 await t.test('unknown external-code verification never retries the one-time code and a new intent fences its late result',async()=>{
  const unknownLaunch=await begin(),authorizations=p.counts.authorization;p.loseAuthorization();assert.equal((await launch(unknownLaunch)).status,503);assert.equal((await launch(unknownLaunch)).status,409);assert.equal(p.counts.authorization,authorizations+1,'unknown launch does not silently allocate another provider transaction')
  const a=await ready(await begin()),before=p.counts.verify;p.loseVerify();const failed=await complete(a);assert.equal(failed.status,503);assert.equal((await failed.json()).error.code,'AUTH_RESULT_UNKNOWN');assert.equal((await complete(a)).status,409);assert.equal(p.counts.verify,before+1)
  const next=await begin({cookies:a.cookies});assert.notEqual(next.value.attemptId,a.value.attemptId);assert.equal((await complete(a)).status,409);assert.equal(p.counts.verify,before+1)
 })
 await t.test('a durable verified principal survives publish failure without consuming code or OIDC grant again',async()=>{
  const a=await ready(await begin()),before={...p.counts};publishFailure=true;const failed=await complete(a);assert.equal(failed.status,503);assert.equal((await pool.query('SELECT phase FROM native_wechat_transactions WHERE attempt_id=$1',[a.value.attemptId])).rows[0].phase,'principal_verified');const result=await complete(a);assert.equal(result.status,200);assert.equal(p.counts.verify,before.verify+1);assert.equal(p.counts.token,before.token+1);assert.equal((await pool.query('SELECT count(*)::int n FROM accounts')).rows[0].n,1)
 })
 await t.test('a lost publish acknowledgement replays the already persisted original ticket and creates no session',async()=>{
  const a=await ready(await begin()),before={...p.counts};publishLost=true;assert.equal((await complete(a)).status,503);const firstTicket=(await pool.query('SELECT ticket_hash FROM native_auth_handoffs WHERE attempt_id=$1',[a.value.attemptId])).rows[0].ticket_hash;const result=await complete(a);assert.equal(result.status,200);assert.equal(hash((await result.json()).data.ticket),firstTicket);assert.equal(p.counts.verify,before.verify+1);assert.equal(p.counts.token,before.token+1)
 })
 await t.test('reauthentication preserves the current original subject and rejects switching to a different provider subject',async()=>{
  const without=await send('auth/native-attempts',{...original.startBody,purpose:'reauthenticate'},originalCookies);assert.equal(without.status,401)
  const before=(await pool.query('SELECT count(*)::int n FROM app_sessions')).rows[0].n,a=await verified(await ready(await begin({cookies:originalCookies,purpose:'reauthenticate',expected:originalCurrent.id}))),result=await redeem(a);assert.equal(result.status,200);const value=(await result.json()).data;assert.equal(value.status,'reauthenticated');assert.equal(value.sessionId,originalCurrent.id);assert.ok(value.reauthenticatedAt);assert.equal(result.headers.getSetCookie().length,0)
  p.users.add('wechat-subject-other');p.subject('wechat-subject-other');const wrong=await verified(await ready(await begin({cookies:originalCookies,purpose:'reauthenticate',expected:originalCurrent.id})));assert.equal((await redeem(wrong)).status,409);p.subject('wechat-subject-original');assert.equal((await pool.query('SELECT count(*)::int n FROM app_sessions')).rows[0].n,before);assert.equal((await pool.query('SELECT count(*)::int n FROM accounts')).rows[0].n,1)
 })
 await t.test('generation changes and explicit cancellation reject old SDK state before provider consumption, and private rows contain no raw code',async()=>{
  const a=await ready(await begin()),before=p.counts.verify;await begin({cookies:a.cookies});assert.equal((await complete(a)).status,409);assert.equal(p.counts.verify,before)
  const b=await ready(await begin()),cancel=await send('auth/attempts/'+b.value.attemptId,undefined,b.cookies,randomUUID(),undefined,'DELETE');assert.equal(cancel.status,204);assert.equal((await complete(b)).status,409);assert.equal(p.counts.verify,before)
  const privateRows=(await pool.query('SELECT row_to_json(w)::text value FROM native_wechat_transactions w')).rows.map(r=>r.value).join('');assert(!privateRows.includes(a.code));assert(!privateRows.includes(a.verifier));assert(!privateRows.includes(a.launch.state));assert(!privateRows.includes('synthetic-provider-only-cookie'));assert.equal(p.error(),undefined,JSON.stringify(p.error()))
  for(const[action,status]of [['launch',200],['launch',403],['launch',409],['launch',503],['complete',200],['complete',403],['complete',409],['complete',503]])assert(cookieBoundaries.some(v=>v.action===action&&v.status===status),'cookie isolation must be observed for '+action+' '+status)
 })
})
