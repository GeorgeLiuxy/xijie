import 'reflect-metadata'
import assert from 'node:assert/strict'
import {createHash,randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'
import {Pool} from 'pg'
import {NestFactory} from '@nestjs/core'
import {PasswordAuth} from '../dist/password.js'
import {PasswordMetadata,PasswordError} from '../dist/password-provider.js'
import {EmbeddedAuth} from '../dist/embedded.js'
import {IdentityStore} from '../dist/store.js'
import {ConsentStore} from '../dist/consent-store.js'
import {IdentityErrors,IdentityModule,identityHeaders} from '../dist/http.js'

const digest=v=>createHash('sha256').update(v).digest('hex'),goodCode='672941'
const rejects=(p,code)=>assert.rejects(p,e=>e.code===code)

async function fixture(){
 let origin,failPolicy=false,loseSubmit=false,loseStage=false,fixtureError,stageGate
 const interactions=new Map(),codes=new Map(),users=new Map(),counts={submit:0,stages:0,passwordChecks:0,sms:0,reads:0},requests=[]
 const clientId='password-fixture',callbackUrl='http://127.0.0.1:5184/v1/auth/callback'
 const server=createServer((req,res)=>void(async()=>{
  const url=new URL(req.url,origin),json=(status,v)=>{res.writeHead(status,{'content-type':'application/json'});res.end(v===undefined?'':JSON.stringify(v))}
  requests.push({path:url.pathname,method:req.method})
  if(url.pathname==='/api/.well-known/sign-in-exp')return json(failPolicy?503:200,{passwordPolicy:{},signIn:{methods:[{identifier:'phone',password:true,verificationCode:true}]},forgotPassword:{phone:true}})
  let text='';for await(const chunk of req)text+=chunk
  if(url.pathname==='/oidc/token'){
   const b=new URLSearchParams(text);assert.equal(b.get('scope'),'read:users');assert.equal(b.get('resource'),'https://default.logto.app/api');assert.equal(b.get('client_id'),'readonly-client');assert.equal(b.get('grant_type'),'client_credentials');return json(200,{access_token:'synthetic-reader',token_type:'Bearer'})
  }
  if(url.pathname.startsWith('/api/users/')){assert.equal(req.headers.authorization,'Bearer synthetic-reader');counts.reads++;const subject=decodeURIComponent(url.pathname.split('/').at(-1)),phone=subject.startsWith('phone:')?subject.slice(6):null;return json(200,{id:subject,...(phone&&{primaryPhone:phone})})}
  if(url.pathname==='/oidc/auth'){
   const id=randomUUID();interactions.set(id,{id,state:url.searchParams.get('state'),event:'SignIn'});res.writeHead(303,{Location:'/sign-in','Set-Cookie':'_interaction='+id+';Path=/;HttpOnly'});return res.end()
  }
  if(url.pathname.startsWith('/oidc/auth/')){
   const item=interactions.get(url.pathname.split('/').at(-1));assert(item?.identified);const code=randomUUID();codes.set(code,{state:item.state,subject:'phone:'+item.phone});const cb=new URL(callbackUrl);cb.searchParams.set('state',item.state);cb.searchParams.set('code',code);res.writeHead(303,{Location:cb.href});return res.end()
  }
  const item=interactions.get(/(?:^|;\s*)_interaction=([^;]+)/.exec(req.headers.cookie??'')?.[1])
  if(!item)return json(404,{code:'session.not_found'})
  const b=text?JSON.parse(text):{}
  if(url.pathname==='/api/experience'&&req.method==='PUT'){item.event=b.interactionEvent;return json(204)}
  if(url.pathname==='/api/experience/interaction-event'){item.event=b.interactionEvent;return json(204)}
  if(url.pathname==='/api/experience/verification/verification-code'){
   counts.sms++;assert(['SignIn','ForgotPassword'].includes(b.interactionEvent));item.phone=b.identifier.value;item.verificationId=randomUUID();return json(200,{verificationId:item.verificationId})
  }
  if(url.pathname==='/api/experience/verification/verification-code/verify'){
   if(b.code!==goodCode)return json(400,{code:'verification_code.code_mismatch'});assert.equal(b.verificationId,item.verificationId);item.verified=true;return json(200,{verificationId:item.verificationId})
  }
  if(url.pathname==='/api/experience/verification/password'){
   counts.passwordChecks++;item.phone=b.identifier.value;if(!users.has(item.phone)||users.get(item.phone)!==b.password)return json(422,{code:'session.invalid_credentials'});item.verified=true;item.verificationId=randomUUID();return json(200,{verificationId:item.verificationId})
  }
  if(url.pathname==='/api/experience/identification'){
   assert(item.verified);if(item.event!=='Register'&&!users.has(item.phone))return json(404,{code:'user.user_not_exist'});item.identified=true;return json(204)
  }
  if(url.pathname==='/api/experience/interaction')return json(200,{interactionEvent:item.event,userId:item.identified?'phone:'+item.phone:undefined})
  if(url.pathname==='/api/experience/profile/password'){
   counts.stages++;assert.equal(item.event,'ForgotPassword');assert(item.identified);if(b.password==='weak')return json(422,{code:'password_rejected.too_short'});item.staged=b.password
   if(stageGate){const gate=stageGate;stageGate=undefined;gate.enter();await gate.wait}
   if(loseStage){loseStage=false;req.socket.destroy();return}return json(204)
  }
  if(url.pathname==='/api/experience/submit'){
   assert(item.identified);if(item.event==='ForgotPassword'){
    counts.submit++;assert(item.staged);users.set(item.phone,item.staged);interactions.delete(item.id);if(loseSubmit){loseSubmit=false;req.socket.destroy();return}return json(200)
   }
   if(item.event==='Register')users.set(item.phone,undefined);return json(200,{redirectTo:origin+'/oidc/auth/'+item.id})
  }
  json(404,{code:'not_found'})
 })().catch(error=>{fixtureError={name:error.name,message:error.message};res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({code:'fixture.failed'}))}))
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port
 return{users,counts,requests,clientId,callbackUrl,issuer:new URL(origin+'/oidc'),failPolicy:v=>{failPolicy=v},loseSubmit:()=>{loseSubmit=true},loseStage:()=>{loseStage=true},error:()=>fixtureError,pauseStage(){let enter,release;const entered=new Promise(r=>{enter=r}),wait=new Promise(r=>{release=r});stageGate={enter,wait};return{entered,release}},
 oidc:{async authorize({state,nonce,verifier}){const u=new URL('/oidc/auth',origin);for(const[k,v]of Object.entries({state,nonce,client_id:clientId,scope:'openid',response_type:'code',redirect_uri:callbackUrl,code_challenge:digest(verifier),code_challenge_method:'S256'}))u.searchParams.set(k,v);return u.href},async exchange(cb,{state}){const c=codes.get(cb.searchParams.get('code'));assert(c);assert.equal(c.state,state);codes.delete(cb.searchParams.get('code'));return{issuer:origin+'/oidc',subject:c.subject,authTime:Math.floor(Date.now()/1000)}}},
 close:()=>new Promise(r=>{server.close(r);server.closeIdleConnections()})}
}

test('password operations use Logto policy, original subjects, durable unknown recovery and session credential fences',async t=>{
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL;if(!connectionString)throw Error('Isolated database required')
 const admin=new Pool({connectionString}),schema='password_'+randomUUID().replaceAll('-',''),p=await fixture();let pool,app
 t.after(async()=>{await app?.close();await p.close();await pool?.end();await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await admin.end()})
 await admin.query('CREATE SCHEMA '+schema);pool=new Pool({connectionString,options:'-c search_path='+schema})
 for(const file of ['001_identity.sql','002_consents.sql','003_embedded_auth.sql','004_ai_text_processing.sql','005_data_rights.sql','025_social_auth_attempts.sql','026_native_auth_handoff.sql','029_google_social_auth.sql','030_password_auth.sql'])await pool.query(await readFile(new URL('../db/'+file,import.meta.url),'utf8'))
 const config={issuer:p.issuer,callbackUrl:p.callbackUrl,origin:'http://127.0.0.1:5184',secure:false,clientId:p.clientId,clientSecret:'synthetic-password-secret-'+randomUUID(),clientRegistrationKey:'password-test',accountReader:{clientId:'readonly-client',clientSecret:'synthetic-reader-secret',resource:'https://default.logto.app/api'},socialProviders:{apple:true,google:true,wechat:true}},store=new IdentityStore(pool),sms=new EmbeddedAuth(pool,config,store,p.oidc),passwords=new PasswordAuth(pool,config,store,p.oidc)
 const clearRate=()=>pool.query("UPDATE auth_password_challenges SET resend_at=clock_timestamp()-interval '1 second'")
 const scope=(browser,session=null,expectedSessionId)=>({browserHash:browser,sessionHash:session?digest(session):null,expectedSessionId})
 async function register(browser,phone){const c=await sms.start({...scope(browser),key:randomUUID(),phone,purpose:'sign_in'}),r=await sms.verify({id:c.id,browserHash:browser,code:goodCode,key:randomUUID(),requestId:randomUUID()});return{session:r.session,current:await store.current(digest(r.session)),phone,browser}}
 async function challenge(actor,purpose='manage',otherPhone){await clearRate();const s=purpose==='manage'?scope(actor.browser,actor.session,actor.current.id):scope(actor.browser),c=await passwords.start({...s,key:randomUUID(),purpose,...(otherPhone&&{phone:otherPhone})});return{c,s}}
 async function verified(actor,purpose='manage',phone){const result=await challenge(actor,purpose,phone);assert.deepEqual(await passwords.verify({...result.s,id:result.c.id,key:randomUUID(),code:goodCode}),{status:'verified'});return result}
 async function login(browser,phone,password){return passwords.login({...scope(browser),key:randomUUID(),phone,password,purpose:'sign_in',requestId:randomUUID()})}
 let a,b
 await t.test('policy comes from actual provider config; failed config is unavailable, reader only requests read:users',async()=>{
  assert.deepEqual(await passwords.policy(),{enabled:true,resetEnabled:true,policy:{minimumLength:8,maximumLength:256,minimumCharacterTypes:1,asciiOnly:true,rejectsPwned:true,rejectsRepetition:true,rejectsUserInfo:true}})
  p.failPolicy(true);await rejects(passwords.policy(),'AUTH_PROVIDER_UNAVAILABLE');p.failPolicy(false)
  a=await register('original-a','+16505550111');b=await register('original-b','+16505550112')
  const auth=await passwords.authentication(digest(a.session),a.current.id);assert.equal(auth.password.canManage,true);assert.equal(auth.password.phoneBound,true);assert(!auth.password.maskedPhone.includes(a.phone.slice(1)));assert.deepEqual(auth.reauthenticationMethods,{sms:true,social:[]})
  await rejects(passwords.authentication(digest(a.session),randomUUID()),'UNAUTHENTICATED')
 })
 await t.test('manage derives the original bound phone, wrong OTP is replayable, and provider policy rejection preserves the session',async()=>{
  const{c,s}=await challenge(a),wrongKey=randomUUID();assert.deepEqual(await passwords.verify({...s,id:c.id,key:wrongKey,code:'000000'}),{status:'incorrect'});assert.deepEqual(await passwords.verify({...s,id:c.id,key:wrongKey,code:'000000'}),{status:'incorrect'})
  await rejects(passwords.verify({...s,id:c.id,key:wrongKey,code:goodCode}),'IDEMPOTENCY_CONFLICT');assert.deepEqual(await passwords.verify({...s,id:c.id,key:randomUUID(),code:goodCode}),{status:'verified'})
  await rejects(passwords.save({...s,id:c.id,key:randomUUID(),password:'weak'}),'AUTH_PASSWORD_POLICY_REJECTED');assert(await store.current(digest(a.session)))
  const key=randomUUID();assert.deepEqual(await passwords.save({...s,id:c.id,key,password:'Nv$1cafe-Strong'}),{status:'completed',requiresSignIn:true});assert.equal(await store.current(digest(a.session)),null)
  assert.equal((await passwords.status({...s,id:c.id})).status,'completed');assert.deepEqual(await passwords.save({...s,id:c.id,key,password:'Nv$1cafe-Strong'}),{status:'completed',requiresSignIn:true})
  const logged=await login('password-a',a.phone,'Nv$1cafe-Strong');assert.equal((await store.current(digest(logged))).accountId,a.current.accountId)
  await rejects(login('wrong-password',a.phone,'wrong'),'AUTH_INVALID_CREDENTIALS');await rejects(login('absent-password','+16505550999','wrong'),'AUTH_INVALID_CREDENTIALS')
 })
 await t.test('reset in a switch context changes its verified target, never the initiating account, and never auto signs in',async()=>{
  await clearRate();const s=scope(b.browser,b.session,b.current.id),c=await passwords.start({...s,purpose:'reset',phone:a.phone,key:randomUUID()});await passwords.verify({...s,id:c.id,key:randomUUID(),code:goodCode})
  const before=(await pool.query('SELECT count(*)::int n FROM app_sessions')).rows[0].n
  await passwords.save({...s,id:c.id,key:randomUUID(),password:'Qg#7next-Strong'});assert(await store.current(digest(b.session)));assert.equal((await pool.query('SELECT count(*)::int n FROM app_sessions')).rows[0].n,before)
  await rejects(login('old-password-a',a.phone,'Nv$1cafe-Strong'),'AUTH_INVALID_CREDENTIALS');const fresh=await login('new-password-a',a.phone,'Qg#7next-Strong');assert.equal((await store.current(digest(fresh))).accountId,a.current.accountId)
 })
 await t.test('accepted submit with a lost response stays unknown; original password verifies it without a second submit or new account',async()=>{
  const{c,s}=await verified(b),key=randomUUID();p.loseSubmit();await rejects(passwords.save({...s,id:c.id,key,password:'Wp&4lost-Strong'}),'AUTH_PROVIDER_UNAVAILABLE')
  assert.equal((await passwords.status({...s,id:c.id})).status,'unknown');assert.equal(await store.current(digest(b.session)),null)
  await rejects(passwords.cancel({...s,id:c.id}),'CONFLICT');await rejects(passwords.save({...s,id:c.id,key,password:'other-value'}),'IDEMPOTENCY_CONFLICT')
  await rejects(login('gate-password',b.phone,'Wp&4lost-Strong'),'IDENTITY_SCOPE_CHANGED')
  const before=p.counts.submit;assert.deepEqual(await passwords.save({...s,id:c.id,key,password:'Wp&4lost-Strong'}),{status:'completed',requiresSignIn:true});assert.equal(p.counts.submit,before)
  const fresh=await login('resolved-b',b.phone,'Wp&4lost-Strong');assert.equal((await store.current(digest(fresh))).accountId,b.current.accountId)
  assert.equal((await pool.query('SELECT count(*)::int n FROM accounts')).rows[0].n,2)
 })
 await t.test('a lost staging response does not change credentials or revoke sessions; the exact save can be retried',async()=>{
  const cactor=await register('staging-user','+16505550113'),{c,s}=await verified(cactor),key=randomUUID();p.loseStage();await rejects(passwords.save({...s,id:c.id,key,password:'Tr!9staged-Strong'}),'AUTH_PROVIDER_UNAVAILABLE');assert(await store.current(digest(cactor.session)));assert.equal((await passwords.status({...s,id:c.id})).status,'verified')
  await passwords.save({...s,id:c.id,key,password:'Tr!9staged-Strong'});assert.equal(await store.current(digest(cactor.session)),null)
 })
 await t.test('credential fence rejects older in-flight proofs while a fresh SMS proof can recover access from an unknown password result',async()=>{
  const actor=await register('unknown-sms-user','+16505550114'),{c,s}=await verified(actor),oldId=randomUUID(),oldBrowser='old-proof',stateHash=randomUUID()
  await store.begin({id:oldId,browserHash:oldBrowser,sessionHash:null,key:randomUUID(),purpose:'sign_in',stateHash,nonce:'synthetic',verifier:'synthetic',authorizationUrl:p.issuer.origin+'/oidc/auth',expiresAt:new Date(Date.now()+60000)})
  const oldClaim=randomUUID();await store.claim({browserHash:oldBrowser,stateHash,claimId:oldClaim})
  p.loseSubmit();await rejects(passwords.save({...s,id:c.id,key:randomUUID(),password:'Aw@5recover-Strong'}),'AUTH_PROVIDER_UNAVAILABLE')
  assert.equal(await store.finish({browserHash:oldBrowser,attemptId:oldId,claimId:oldClaim,sessionHash:digest('old'),principal:{issuer:p.issuer.href,subject:'phone:'+actor.phone.slice(1),authenticatedAt:new Date()}}),false)
  async function proof(browser,fresh){const id=randomUUID(),stateHash=randomUUID(),claimId=randomUUID();await store.begin({id,browserHash:browser,sessionHash:null,key:randomUUID(),purpose:'sign_in',stateHash,nonce:'synthetic',verifier:'synthetic',authorizationUrl:p.issuer.origin+'/oidc/auth',expiresAt:new Date(Date.now()+60000)});await store.claim({browserHash:browser,stateHash,claimId});return store.finish({browserHash:browser,attemptId:id,claimId,sessionHash:digest(browser),principal:{issuer:p.issuer.href,subject:'phone:'+actor.phone.slice(1),authenticatedAt:new Date(),authenticationTimeVerified:fresh}})}
  assert.equal(await proof('unverified-auth-time',false),false,'a newly created attempt without fresh verification cannot release the gate')
  await pool.query("UPDATE auth_password_challenges SET phase='saving',lease_until=clock_timestamp()+interval '30 seconds' WHERE id=$1",[c.id]);assert.equal(await proof('write-still-live',true),false,'a live credential submission must settle before another proof can reopen access')
  await pool.query("UPDATE auth_password_challenges SET phase='unknown',lease_until=NULL WHERE id=$1",[c.id])
  await pool.query("UPDATE auth_sms_challenges SET created_at=clock_timestamp()-interval '70 seconds',resend_at=clock_timestamp()-interval '1 second'")
  const again=await register('fresh-sms-recovery',actor.phone);assert.equal(again.current.accountId,actor.current.accountId)
  assert.equal((await passwords.status({...s,id:c.id})).status,'unknown','SMS does not claim that the older password write completed')
  assert(await login('after-sms-password',actor.phone,'Aw@5recover-Strong'))
 })
 await t.test('challenge scope follows its original session and rejects another account or browser, including late saves',async()=>{
  const actor=await register('late-scope','+16505550115'),{c,s}=await verified(actor)
  await rejects(passwords.status({...s,browserHash:'different',id:c.id}),'NOT_FOUND')
  await rejects(passwords.save({...s,sessionHash:digest(b.session),expectedSessionId:b.current.id,id:c.id,key:randomUUID(),password:'Fr%7blocked-Strong'}),'IDENTITY_SCOPE_CHANGED')
  await store.logout(digest(actor.session));await rejects(passwords.save({...s,id:c.id,key:randomUUID(),password:'Fr%7blocked-Strong'}),'IDENTITY_SCOPE_CHANGED')
 })
 await t.test('same-browser new authentication intent fences a delayed password stage before credential submission',async()=>{
  const actor=await register('scope-stage','+16505550116'),{c,s}=await verified(actor),gate=p.pauseStage(),before=p.counts.submit,pending=passwords.save({...s,id:c.id,key:randomUUID(),password:'Lo^8delayed-Strong'})
  await gate.entered
  await store.begin({id:randomUUID(),browserHash:actor.browser,sessionHash:digest(actor.session),key:randomUUID(),purpose:'switch',stateHash:randomUUID(),nonce:'synthetic',verifier:'synthetic',authorizationUrl:p.issuer.origin+'/oidc/auth',expiresAt:new Date(Date.now()+60000)})
  gate.release();await rejects(pending,'IDENTITY_SCOPE_CHANGED');assert.equal(p.counts.submit,before);assert(await store.current(digest(actor.session)))
 })
 await t.test('expired staging worker cannot overwrite a newer durable claim or submit the password twice',async()=>{
  const actor=await register('lease-stage','+16505550117'),{c,s}=await verified(actor),gate=p.pauseStage(),key=randomUUID(),before=p.counts.submit,first=passwords.save({...s,id:c.id,key,password:'Eb(6lease-Strong'})
  await gate.entered;await pool.query("UPDATE auth_password_challenges SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[c.id])
  const second=await passwords.save({...s,id:c.id,key,password:'Eb(6lease-Strong'});assert.equal(second.status,'completed');gate.release();await rejects(first,'CONFLICT');assert.equal(p.counts.submit,before+1);assert.equal((await passwords.status({...s,id:c.id})).status,'completed')
 })
 await t.test('a social-only subject has no password-management capability and is never linked or assigned an invented phone',async()=>{
  const browser='social-only',id=randomUUID(),stateHash=randomUUID(),claimId=randomUUID(),session='synthetic-social-session'
  await store.begin({id,browserHash:browser,sessionHash:null,key:randomUUID(),purpose:'sign_in',provider:'google',stateHash,nonce:'synthetic',verifier:'synthetic',authorizationUrl:p.issuer.origin+'/oidc/auth',expiresAt:new Date(Date.now()+60000)})
  await store.claim({browserHash:browser,stateHash,claimId});assert.equal(await store.finish({browserHash:browser,attemptId:id,claimId,sessionHash:digest(session),principal:{issuer:p.issuer.href,subject:'social-only-google',authenticatedAt:new Date()}}),true)
  const current=await store.current(digest(session));assert.deepEqual(await passwords.authentication(digest(session),current.id),{password:{canManage:false,phoneBound:false,maskedPhone:null},reauthenticationMethods:{sms:false,social:['google']}})
  await rejects(passwords.start({...scope(browser,session,current.id),purpose:'manage',key:randomUUID()}),'AUTH_PHONE_NOT_BOUND')
 })
 await t.test('legacy hosted social login without provider metadata can try configured methods while foreign subjects cannot change or register an account',async()=>{
  const browser='legacy-hosted',session='synthetic-legacy-social-session',subject='legacy-social-subject'
  async function accept(purpose,chosenSubject,provider){const id=randomUUID(),stateHash=randomUUID(),claimId=randomUUID();await store.begin({id,browserHash:browser,sessionHash:purpose==='reauthenticate'?digest(session):null,key:randomUUID(),purpose,...(provider&&{provider}),stateHash,nonce:'synthetic',verifier:'synthetic',authorizationUrl:p.issuer.origin+'/oidc/auth',expiresAt:new Date(Date.now()+60000)});await store.claim({browserHash:browser,stateHash,claimId});return store.finish({browserHash:browser,attemptId:id,claimId,sessionHash:digest(session),principal:{issuer:p.issuer.href,subject:chosenSubject,authenticatedAt:new Date(),authenticationTimeVerified:true}})}
  assert.equal(await accept('sign_in',subject),true);const current=await store.current(digest(session)),before=(await pool.query('SELECT count(*)::int n FROM accounts')).rows[0].n,sessions=(await pool.query('SELECT count(*)::int n FROM app_sessions')).rows[0].n
  assert.deepEqual((await passwords.authentication(digest(session),current.id)).reauthenticationMethods,{sms:false,social:['apple','google','wechat']})
  config.socialProviders.google=false;assert.deepEqual((await passwords.authentication(digest(session),current.id)).reauthenticationMethods.social,['apple','wechat']);config.socialProviders.google=true
  assert.equal(await accept('reauthenticate','unregistered-other-social-subject','google'),false);assert.equal((await store.current(digest(session))).id,current.id);assert.equal((await pool.query('SELECT count(*)::int n FROM accounts')).rows[0].n,before)
  assert.equal(await accept('reauthenticate',subject,'wechat'),true);assert.equal((await store.current(digest(session))).id,current.id);assert.equal((await pool.query('SELECT count(*)::int n FROM app_sessions')).rows[0].n,sessions)
 })
 await t.test('reset of an existing provider subject never registers an App account, and an unverified proof cannot create one behind its unknown gate',async()=>{
  const phone='+16505550118',browser='provider-only-reset';p.users.set(phone.slice(1),'Previous$Provider8')
  await clearRate();const s=scope(browser),c=await passwords.start({...s,purpose:'reset',phone,key:randomUUID()});await passwords.verify({...s,id:c.id,key:randomUUID(),code:goodCode})
  const before=(await pool.query('SELECT count(*)::int n FROM accounts')).rows[0].n;p.loseSubmit();await rejects(passwords.save({...s,id:c.id,key:randomUUID(),password:'Lr*8provider-Strong'}),'AUTH_PROVIDER_UNAVAILABLE');assert.equal((await pool.query('SELECT count(*)::int n FROM accounts')).rows[0].n,before)
  const id=randomUUID(),stateHash=randomUUID(),claimId=randomUUID(),proofBrowser='provider-only-unverified';await store.begin({id,browserHash:proofBrowser,sessionHash:null,key:randomUUID(),purpose:'sign_in',stateHash,nonce:'synthetic',verifier:'synthetic',authorizationUrl:p.issuer.origin+'/oidc/auth',expiresAt:new Date(Date.now()+60000)});await store.claim({browserHash:proofBrowser,stateHash,claimId});assert.equal(await store.finish({browserHash:proofBrowser,attemptId:id,claimId,sessionHash:digest('blocked-provider-only'),principal:{issuer:p.issuer.href,subject:'phone:'+phone.slice(1),authenticatedAt:new Date(),authenticationTimeVerified:false}}),false)
  assert.equal((await pool.query('SELECT count(*)::int n FROM accounts')).rows[0].n,before)
  const registered=await register('provider-only-fresh-sms',phone),session=await login('provider-only-password',phone,'Lr*8provider-Strong');assert.equal((await store.current(digest(session))).accountId,registered.current.accountId)
 })
 await t.test('public HTTP rejects body extensions and forged manage phones, and returns real session cookies only for password login',async()=>{
  app=await NestFactory.create(IdentityModule.register(config,store,p.oidc,new ConsentStore(pool,store),sms,undefined,undefined,undefined,undefined,passwords),{logger:false,abortOnError:false});app.use(identityHeaders);app.useGlobalFilters(new IdentityErrors());await app.listen(0,'127.0.0.1');const origin=await app.getUrl(),headers={Origin:config.origin,'Content-Type':'application/json','Idempotency-Key':randomUUID()}
  const malformed=await fetch(origin+'/v1/auth/password-challenges',{method:'POST',headers,body:JSON.stringify({purpose:'manage',phone:'6505550111',dial:'+1'})});assert.equal(malformed.status,400)
  const res=await fetch(origin+'/v1/auth/password-attempts',{method:'POST',headers:{...headers,'Idempotency-Key':randomUUID()},body:JSON.stringify({dial:'+1',phone:'6505550111',password:'Qg#7next-Strong',purpose:'sign_in'})});assert.equal(res.status,200,JSON.stringify(await res.clone().json()));assert.deepEqual(await res.json(),{data:{status:'verified'}});assert(res.headers.getSetCookie().some(v=>v.startsWith('xijie_dev_session=')))
  assert.equal((await fetch(origin+'/v1/auth/password-policy?unrecognized=1')).status,400)
  await clearRate();const reset=await fetch(origin+'/v1/auth/password-challenges',{method:'POST',headers:{...headers,'Idempotency-Key':randomUUID()},body:JSON.stringify({purpose:'reset',dial:'+1',phone:'6505550111'})});assert.equal(reset.status,201)
  const resetId=(await reset.json()).data.id,resetCookie=reset.headers.getSetCookie().find(v=>v.startsWith('xijie_dev_browser=')).split(';')[0],path=origin+'/v1/auth/password-challenges/'+resetId
  assert.equal((await fetch(path,{method:'DELETE',headers:{Origin:config.origin,Cookie:resetCookie}})).status,400,'cancel requires a UUID operation key')
  assert.equal((await fetch(path,{method:'DELETE',headers:{Origin:config.origin,Cookie:resetCookie,'Idempotency-Key':randomUUID()}})).status,204)
  assert.equal((await(await fetch(path,{headers:{Cookie:resetCookie}})).json()).data.status,'expired')
 })
 await t.test('stored application rows and public state never contain submitted plaintext credentials; cleanup expires private material',async()=>{
  const values=(await pool.query('SELECT row_to_json(t)::text value FROM auth_password_challenges t UNION ALL SELECT row_to_json(l)::text FROM auth_password_logins l')).rows.map(r=>r.value).join('')
  for(const secret of ['Nv$1cafe-Strong','Qg#7next-Strong','Wp&4lost-Strong',goodCode])assert(!values.includes(secret))
  await pool.query("UPDATE auth_password_challenges SET expires_at=clock_timestamp()-interval '2 days'");await passwords.sweep();assert.equal((await pool.query('SELECT count(*)::int n FROM auth_password_challenges')).rows[0].n,0)
  assert.equal(p.error(),undefined,JSON.stringify(p.error()));assert(p.requests.every(r=>!r.path.includes('password=')))
 })
})
