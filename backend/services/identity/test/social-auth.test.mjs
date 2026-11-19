import 'reflect-metadata'
import assert from 'node:assert/strict'
import {createHash,createSign,generateKeyPairSync,randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'
import {NestFactory} from '@nestjs/core'
import pg from 'pg'
import {ConsentStore} from '../dist/consent-store.js'
import {IdentityStore} from '../dist/store.js'
import {IdentityErrors,IdentityModule,identityHeaders} from '../dist/http.js'
import {createOidcProvider} from '../dist/oidc.js'
import {NativeAuthStore} from '../dist/native-auth.js'

test('real OIDC and native handoff code/PKCE/JWKS routing preserves the original session boundary and never links by equal email',async()=>{
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated database required')
 const admin=new pg.Pool({connectionString}),schema='social_auth_'+randomUUID().replaceAll('-',''),pool=new pg.Pool({connectionString,options:'-c search_path='+schema}),old=process.env.NODE_ENV
 let app,origin,providerOrigin,invalidSignature=false,fixtureFailure,exchangeFailure
 const clientId='synthetic-social-client',clientSecret='synthetic-only-'+randomUUID(),codes=new Map(),keys=generateKeyPairSync('rsa',{modulusLength:2048}),wrong=generateKeyPairSync('rsa',{modulusLength:2048})
 const publicJwk={...keys.publicKey.export({format:'jwk'}),kid:'synthetic-rsa',alg:'RS256',use:'sig'}
 const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data))}
 const provider=createServer((req,res)=>{void(async()=>{
  const url=new URL(req.url,providerOrigin),issuer=providerOrigin+'/oidc'
  if(url.pathname.includes('.well-known'))return json(res,200,{issuer,authorization_endpoint:issuer+'/auth',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],token_endpoint_auth_methods_supported:['client_secret_basic']})
  if(url.pathname==='/oidc/jwks')return json(res,200,{keys:[publicJwk]})
  if(url.pathname==='/oidc/auth'){
   const route=url.searchParams.get('direct_sign_in');assert.ok(['social:apple','social:google','social:wechat'].includes(route));assert.equal(url.searchParams.get('scope'),'openid');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('prompt'),'login')
   const code=randomUUID();codes.set(code,{route,nonce:url.searchParams.get('nonce'),challenge:url.searchParams.get('code_challenge')});const callback=new URL('http://127.0.0.1:5184/v1/auth/callback');callback.searchParams.set('state',url.searchParams.get('state'));callback.searchParams.set('code',code);res.writeHead(302,{location:callback.href});return res.end()
  }
  if(url.pathname==='/oidc/token'){
   let body='';for await(const chunk of req)body+=chunk;const fields=new URLSearchParams(body),code=codes.get(fields.get('code'));assert.ok(code);codes.delete(fields.get('code'));assert.deepEqual(Buffer.from(req.headers.authorization.slice(6),'base64').toString().split(':').map(decodeURIComponent),[clientId,clientSecret]);assert.equal(createHash('sha256').update(fields.get('code_verifier')).digest('base64url'),code.challenge)
   const now=Math.floor(Date.now()/1000),head=Buffer.from(JSON.stringify({alg:'RS256',kid:'synthetic-rsa'})).toString('base64url'),payload=Buffer.from(JSON.stringify({iss:issuer,aud:clientId,sub:code.route+'-synthetic-subject',email:'same-synthetic@example.test',nonce:code.nonce,iat:now,exp:now+300,auth_time:now})).toString('base64url'),data=head+'.'+payload,signature=createSign('RSA-SHA256').update(data).sign(invalidSignature?wrong.privateKey:keys.privateKey).toString('base64url')
   return json(res,200,{access_token:'synthetic-access-token',token_type:'Bearer',expires_in:300,scope:'openid',id_token:data+'.'+signature})
  }
  json(res,404,{error:'not_found'})
 })().catch(error=>{fixtureFailure={name:error.name,message:error.message};json(res,500,{error:'synthetic_fixture_failed'})})})
 try{
  process.env.NODE_ENV='test';await new Promise(r=>provider.listen(0,'127.0.0.1',r));providerOrigin='http://127.0.0.1:'+provider.address().port
  await admin.query('CREATE SCHEMA '+schema);for(const file of ['001_identity.sql','002_consents.sql','003_embedded_auth.sql','004_ai_text_processing.sql','005_data_rights.sql','025_social_auth_attempts.sql','026_native_auth_handoff.sql','029_google_social_auth.sql'])await pool.query(await readFile(new URL('../db/'+file,import.meta.url),'utf8'))
  const config={issuer:new URL(providerOrigin+'/oidc'),clientId,clientSecret,callbackUrl:'http://127.0.0.1:5184/v1/auth/callback',origin:'http://127.0.0.1:5184',clientRegistrationKey:'web-social-test',secure:false,socialProviders:{apple:true,google:true,wechat:true},nativeHandoffEnabled:false}
  const store=new IdentityStore(pool),oidc=await createOidcProvider(config),exchange=oidc.exchange.bind(oidc);oidc.exchange=async(...args)=>{try{return await exchange(...args)}catch(error){exchangeFailure={name:error.name,code:error.code,message:error.message,cause:error.cause?.code};throw error}};app=await NestFactory.create(IdentityModule.register(config,store,oidc,new ConsentStore(pool,store),undefined,undefined,undefined,undefined,new NativeAuthStore(pool,store,oidc,config)),{logger:false,abortOnError:false});app.use(identityHeaders);app.useGlobalFilters(new IdentityErrors());await app.listen(0,'127.0.0.1');origin=await app.getUrl()
  const caps=await(await fetch(origin+'/v1/auth/providers')).json();assert.deepEqual(caps.data,[{id:'apple',enabled:true,nativeHandoffEnabled:false},{id:'google',enabled:true,nativeHandoffEnabled:false},{id:'wechat',enabled:true,nativeHandoffEnabled:false}])
  const headers={Origin:config.origin,'Content-Type':'application/json'}
  async function begin(method,key=randomUUID(),cookie,purpose='sign_in',expected){const res=await fetch(origin+'/v1/auth/attempts',{method:'POST',headers:{...headers,'Idempotency-Key':key,...(cookie?{Cookie:cookie}:{}),...(expected?{'X-Xijie-Expected-Session':expected}:{})},body:JSON.stringify({client:'web',purpose,provider:method})});return{res,body:await res.json(),cookie:res.headers.getSetCookie().find(v=>v.startsWith('xijie_dev_browser='))?.split(';')[0]??cookie}}
  const apple=await begin('apple');assert.equal(apple.res.status,201);assert.equal(new URL(apple.body.data.authorizationUrl).searchParams.get('direct_sign_in'),'social:apple')
  const replayKey=randomUUID(),first=await begin('apple',replayKey),replay=await begin('apple',replayKey,first.cookie);assert.equal(replay.body.data.attemptId,first.body.data.attemptId);assert.equal((await begin('wechat',replayKey,first.cookie)).res.status,409)
  const disabled=config.socialProviders.wechat;config.socialProviders.wechat=false;assert.equal((await begin('wechat')).res.status,503);config.socialProviders.wechat=disabled
  config.socialProviders.google=false;assert.equal((await begin('google')).res.status,503);config.socialProviders.google=true
  assert.equal((await begin('arbitrary-provider')).res.status,400)
  async function complete(attempt){const upstream=await fetch(attempt.body.data.authorizationUrl,{redirect:'manual'});assert.equal(upstream.status,302);const target=new URL(upstream.headers.get('location'));return fetch(origin+target.pathname+target.search,{headers:{Cookie:attempt.cookie},redirect:'manual'})}
  const signed=await complete(apple);assert.equal(signed.headers.get('location'),'/?auth=success',JSON.stringify({fixtureFailure,exchangeFailure}));assert.ok(signed.headers.getSetCookie().some(v=>v.startsWith('xijie_dev_session=')))
  assert.equal((await complete(await begin('wechat'))).headers.get('location'),'/?auth=success');assert.equal((await complete(await begin('google'))).headers.get('location'),'/?auth=success');assert.equal((await pool.query('SELECT count(*)::integer AS n FROM accounts')).rows[0].n,3,'same email never merges verified subjects')
  const originalSession=signed.headers.getSetCookie().find(v=>v.startsWith('xijie_dev_session=')).split(';')[0],originalCookies=apple.cookie+'; '+originalSession,originalCurrent=(await(await fetch(origin+'/v1/sessions/current',{headers:{Cookie:originalCookies}})).json()).data
  const sessionCountBefore=(await pool.query('SELECT count(*)::integer n FROM app_sessions')).rows[0].n
  assert.equal((await begin('apple',randomUUID(),originalCookies,'reauthenticate')).res.status,401,'reauth requires an explicit expected session')
  assert.equal((await begin('apple',randomUUID(),originalCookies,'switch')).res.status,401,'a social account switch also requires the explicit original session')
  const refreshOwn=await begin('apple',randomUUID(),originalCookies,'reauthenticate',originalCurrent.id);assert.equal(refreshOwn.res.status,201)
  const refreshed=await complete(refreshOwn);assert.equal(refreshed.headers.get('location'),'/?auth=success');assert.ok(!refreshed.headers.getSetCookie().some(v=>v.startsWith('xijie_dev_session=')))
  const afterReauth=(await(await fetch(origin+'/v1/sessions/current',{headers:{Cookie:originalCookies}})).json()).data;assert.equal(afterReauth.id,originalCurrent.id);assert.equal(afterReauth.accountId,originalCurrent.accountId);assert(afterReauth.reauthenticatedAt)
  const wrongOwn=await begin('wechat',randomUUID(),originalCookies,'reauthenticate',originalCurrent.id);assert.equal((await complete(wrongOwn)).headers.get('location'),'/?auth=failed');assert.equal((await pool.query('SELECT count(*)::integer n FROM app_sessions')).rows[0].n,sessionCountBefore,'social reauth never creates a session or switches the account')
  invalidSignature=true;assert.equal((await complete(await begin('apple'))).headers.get('location'),'/?auth=failed');assert.equal((await pool.query('SELECT count(*)::integer AS n FROM accounts')).rows[0].n,3)
  const cancelled=await begin('wechat'),state=new URL(cancelled.body.data.authorizationUrl).searchParams.get('state');const cancel=await fetch(origin+'/v1/auth/callback?state='+state+'&error=access_denied',{headers:{Cookie:cancelled.cookie},redirect:'manual'});assert.equal(cancel.headers.get('location'),'/?auth=cancelled')
  config.nativeHandoffEnabled=true;invalidSignature=false
  const verifier=randomUUID().replaceAll('-','')+'abcdefghijk',launchProof=randomUUID().replaceAll('-','')+'ABCDEFGHIJK',nativeKey=randomUUID(),nativeBody={provider:'google',purpose:'sign_in',verifierChallenge:createHash('sha256').update(verifier).digest('hex'),launchProof}
  assert.equal((await fetch(origin+'/v1/auth/native-attempts',{method:'POST',headers:{...headers,Cookie:originalCookies,'Idempotency-Key':randomUUID()},body:JSON.stringify({...nativeBody,purpose:'switch'})})).status,401)
  const nativeStart=await fetch(origin+'/v1/auth/native-attempts',{method:'POST',headers:{...headers,'Idempotency-Key':nativeKey},body:JSON.stringify(nativeBody)});assert.equal(nativeStart.status,201)
  const native=(await nativeStart.json()).data,viewCookie=nativeStart.headers.getSetCookie().find(v=>v.startsWith('xijie_dev_browser=')).split(';')[0],launchUrl=new URL(native.launchUrl)
  const browserLaunch=await fetch(origin+launchUrl.pathname+launchUrl.search,{redirect:'manual'});assert.equal(browserLaunch.status,303)
  const externalCookie=browserLaunch.headers.getSetCookie().find(v=>v.startsWith('xijie_dev_native_browser=')).split(';')[0]
  assert.equal((await fetch(origin+launchUrl.pathname+launchUrl.search,{redirect:'manual'})).status,410,'launch proof cannot rebind a different browser')
  const authorized=await fetch(browserLaunch.headers.get('location'),{redirect:'manual'}),nativeCallback=new URL(authorized.headers.get('location')),callbackPath=nativeCallback.pathname+nativeCallback.search
  const missingBinding=await fetch(origin+callbackPath,{headers:{Cookie:viewCookie},redirect:'manual'});assert.match(missingBinding.headers.get('location'),/native-auth\/complete.*status=failed/);assert.ok(!missingBinding.headers.getSetCookie().some(v=>v.startsWith('xijie_dev_session=')),'native callback never falls back to ordinary session creation')
  const beforeSessions=(await pool.query('SELECT count(*)::integer AS n FROM app_sessions')).rows[0].n
  const nativeReturn=await fetch(origin+callbackPath,{headers:{Cookie:externalCookie},redirect:'manual'});assert.ok(!nativeReturn.headers.getSetCookie().some(v=>v.startsWith('xijie_dev_session=')));assert.equal((await pool.query('SELECT count(*)::integer AS n FROM app_sessions')).rows[0].n,beforeSessions)
  const returnUrl=new URL(nativeReturn.headers.get('location'));assert.equal(returnUrl.pathname,'/native-auth/complete');assert.equal(returnUrl.searchParams.get('attemptId'),native.attemptId);assert.equal(returnUrl.searchParams.has('session'),false)
  const ticket=returnUrl.searchParams.get('ticket'),redeemKey=randomUUID()
  async function redeem(overrides={},cookie=viewCookie,key=redeemKey,expected){return fetch(origin+'/v1/auth/native-attempts/'+native.attemptId+'/redeem',{method:'POST',headers:{...headers,Cookie:cookie,'Idempotency-Key':key,...(expected?{'X-Xijie-Expected-Session':expected}:{})},body:JSON.stringify({verifier,ticket,...overrides})})}
  assert.equal((await redeem({verifier:launchProof})).status,403);assert.equal((await redeem({},externalCookie)).status,400);assert.equal((await redeem({},viewCookie,redeemKey,randomUUID())).status,403)
  const redeemed=await redeem();assert.equal(redeemed.status,200);const sessionCookie=redeemed.headers.getSetCookie().find(v=>v.startsWith('xijie_dev_session=')).split(';')[0]
  const repeated=await redeem();assert.equal(repeated.status,200);assert.equal(repeated.headers.getSetCookie().find(v=>v.startsWith('xijie_dev_session=')).split(';')[0],sessionCookie)
  assert.equal((await redeem({},viewCookie,randomUUID())).status,409)
  await pool.query("UPDATE app_sessions SET status='revoked',revoked_at=clock_timestamp() WHERE auth_attempt_id=$1",[native.attemptId]);assert.equal((await redeem()).status,409,'unknown-result replay never revives a revoked session')
  assert.equal((await pool.query('SELECT count(*)::integer AS n FROM accounts')).rows[0].n,3)
  const secondStart=await fetch(origin+'/v1/auth/native-attempts',{method:'POST',headers:{...headers,Cookie:viewCookie,'Idempotency-Key':randomUUID()},body:JSON.stringify(nativeBody)}),secondNative=(await secondStart.json()).data,secondLaunchUrl=new URL(secondNative.launchUrl)
  const secondLaunch=await fetch(origin+secondLaunchUrl.pathname+secondLaunchUrl.search,{redirect:'manual'}),secondExternal=secondLaunch.headers.getSetCookie().find(v=>v.startsWith('xijie_dev_native_browser=')).split(';')[0],secondAuth=await fetch(secondLaunch.headers.get('location'),{redirect:'manual'}),secondCallback=new URL(secondAuth.headers.get('location'))
  const secondReturn=await fetch(origin+secondCallback.pathname+secondCallback.search,{headers:{Cookie:secondExternal},redirect:'manual'}),secondTicket=new URL(secondReturn.headers.get('location')).searchParams.get('ticket')
  assert.equal((await begin('wechat',randomUUID(),viewCookie)).res.status,201,'new same-slot intent replaces the old native pending attempt')
  const stale=await fetch(origin+'/v1/auth/native-attempts/'+secondNative.attemptId+'/redeem',{method:'POST',headers:{...headers,Cookie:viewCookie,'Idempotency-Key':randomUUID()},body:JSON.stringify({verifier,ticket:secondTicket})});assert.equal(stale.status,409)
  await pool.query("UPDATE native_auth_handoffs SET created_at=clock_timestamp()-interval '10 minutes',expires_at=clock_timestamp()-interval '1 second' WHERE attempt_id=$1",[secondNative.attemptId]);await pool.query('DELETE FROM native_auth_handoffs WHERE attempt_id=$1',[secondNative.attemptId])
  const tombstone=await fetch(origin+secondCallback.pathname+secondCallback.search,{headers:{Cookie:viewCookie+'; '+secondExternal},redirect:'manual'});assert.match(tombstone.headers.get('location'),/native-auth\/complete.*status=failed/);assert.ok(!tombstone.headers.getSetCookie().some(v=>v.startsWith('xijie_dev_session=')))
  async function nativeReauth(providerName,expected=originalCurrent.id){
   const start=await fetch(origin+'/v1/auth/native-attempts',{method:'POST',headers:{...headers,Cookie:originalCookies,'Idempotency-Key':randomUUID(),...(expected?{'X-Xijie-Expected-Session':expected}:{})},body:JSON.stringify({...nativeBody,provider:providerName,purpose:'reauthenticate'})})
   if(start.status!==201)return{start}
   const value=(await start.json()).data,url=new URL(value.launchUrl),launched=await fetch(origin+url.pathname+url.search,{redirect:'manual'}),browserCookie=launched.headers.getSetCookie().find(v=>v.startsWith('xijie_dev_native_browser=')).split(';')[0],authorized=await fetch(launched.headers.get('location'),{redirect:'manual'}),cb=new URL(authorized.headers.get('location')),returned=await fetch(origin+cb.pathname+cb.search,{headers:{Cookie:browserCookie},redirect:'manual'}),ticket=new URL(returned.headers.get('location')).searchParams.get('ticket'),key=randomUUID()
   const redeem=()=>fetch(origin+'/v1/auth/native-attempts/'+value.attemptId+'/redeem',{method:'POST',headers:{...headers,Cookie:originalCookies,'Idempotency-Key':key,'X-Xijie-Expected-Session':expected},body:JSON.stringify({verifier,ticket})})
   return{start,redeem}
  }
  assert.equal((await nativeReauth('apple',null)).start.status,401)
  const ownNative=await nativeReauth('apple'),countBeforeNativeReauth=(await pool.query('SELECT count(*)::integer n FROM app_sessions')).rows[0].n,ownNativeResult=await ownNative.redeem();assert.equal(ownNativeResult.status,200)
  const nativeReauthenticated=(await ownNativeResult.json()).data;assert.equal(nativeReauthenticated.status,'reauthenticated');assert.equal(nativeReauthenticated.sessionId,originalCurrent.id);assert.ok(nativeReauthenticated.reauthenticatedAt);assert.ok(!ownNativeResult.headers.getSetCookie().some(v=>v.startsWith('xijie_dev_session=')))
  const replayReauth=await ownNative.redeem();assert.equal(replayReauth.status,200);assert.deepEqual((await replayReauth.json()).data,nativeReauthenticated)
  const wrongNative=await nativeReauth('google');assert.equal((await wrongNative.redeem()).status,409);assert.equal((await pool.query('SELECT count(*)::integer n FROM app_sessions')).rows[0].n,countBeforeNativeReauth)
  assert.equal((await(await fetch(origin+'/v1/sessions/current',{headers:{Cookie:originalCookies}})).json()).data.accountId,originalCurrent.accountId)
  const limited=await begin('apple');for(let i=0;i<9;i++)assert.equal((await begin('apple',randomUUID(),limited.cookie)).res.status,201);const throttled=await begin('apple',randomUUID(),limited.cookie);assert.equal(throttled.res.status,429);assert.equal(throttled.res.headers.get('retry-after'),'600')
  assert.ok((await pool.query('SELECT DISTINCT social_provider FROM auth_attempts WHERE social_provider IS NOT NULL')).rowCount===3)
 }finally{old===undefined?delete process.env.NODE_ENV:process.env.NODE_ENV=old;await app?.close();await new Promise(r=>provider.close(r));await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()}
})
