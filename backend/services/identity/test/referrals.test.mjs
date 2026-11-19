import 'reflect-metadata'
import assert from 'node:assert/strict'
import {createHash,randomBytes,randomUUID} from 'node:crypto'
import {readFile,readdir} from 'node:fs/promises'
import {test} from 'node:test'
import pg from 'pg'
import {NestFactory} from '@nestjs/core'
import {IdentityStore} from '../dist/store.js'
import {ConsentStore} from '../dist/consent-store.js'
import {ReferralsStore,referralExport,eraseReferrals} from '../dist/referrals.js'
import {readReferralsConfig} from '../dist/referrals-config.js'
import {IdentityModule,IdentityErrors,identityHeaders} from '../dist/http.js'

const hash=value=>createHash('sha256').update(value).digest('hex'),proof=()=>randomBytes(32).toString('base64url')
async function fixture(t){
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL;assert(connectionString)
 const schema='referrals_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString});await admin.query('CREATE SCHEMA '+schema)
 const pool=new pg.Pool({connectionString,options:'-c search_path='+schema})
 t.after(async()=>{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()})
 for(const file of(await readdir(new URL('../db/',import.meta.url))).filter(file=>/^\d+_.+\.sql$/.test(file)&&Number(file.slice(0,3))<=20).sort())await pool.query(await readFile(new URL('../db/'+file,import.meta.url),'utf8'))
 const identity=new IdentityStore(pool),config={enabled:true,publicOrigin:'http://localhost:5184',tokenKey:randomBytes(32)},referrals=new ReferralsStore(pool,identity,config)
 async function begin(options={}){
  const browser=options.browser??proof(),browserHash=hash(browser),session=proof(),claimId=randomUUID(),principal={issuer:'https://id.example.test/oidc',subject:options.subject??randomUUID(),authenticatedAt:new Date()}
  const draft={id:randomUUID(),browserHash,sessionHash:options.sessionHash??null,key:randomUUID(),purpose:options.purpose??'sign_in',stateHash:hash(proof()),nonce:proof(),verifier:proof(),authorizationUrl:'https://id.example.test/oidc/auth',expiresAt:new Date(Date.now()+60000)}
  await identity.begin(draft);assert(await identity.claim({browserHash,stateHash:draft.stateHash,claimId}))
  const complete=async(callback)=>{assert(await identity.finish({browserHash,attemptId:draft.id,claimId,sessionHash:hash(session),principal},callback));const actor=await identity.current(options.purpose==='reauthenticate'?options.sessionHash:hash(session));return{...actor,browser,hash:hash(session),proof:session,subject:principal.subject}}
  return{...draft,browser,complete}
 }
 const login=async options=>(await begin(options)).complete()
 const create=async(actor,name='Synthetic friend',key=randomUUID())=>referrals.create(actor.hash,actor.id,key,name)
 const invite=async(actor,browser=proof())=>{const link=await create(actor),token=link.url.split('/').at(-1),intent=await referrals.join(token,hash(browser),randomUUID());return{link,token,intent,browser}}
 const pending=async()=>{const {data}=await referrals.pending(100,null);return data}
 return{pool,identity,config,referrals,begin,login,create,invite,pending}
}

test('referrals default closed, require independent key and reject production activation',()=>{
 const names=['REFERRALS_ENABLED','REFERRALS_TOKEN_KEY','REFERRALS_PUBLIC_ORIGIN','NODE_ENV'],saved=Object.fromEntries(names.map(n=>[n,process.env[n]]))
 try{
  for(const n of names)delete process.env[n]
  assert.equal(readReferralsConfig('http://localhost:5184').enabled,false)
  process.env.REFERRALS_ENABLED='true';assert.throws(()=>readReferralsConfig('http://localhost:5184'))
  process.env.REFERRALS_TOKEN_KEY=randomBytes(32).toString('hex');assert.equal(readReferralsConfig('http://localhost:5184').tokenKey.length,32)
  process.env.REFERRALS_PUBLIC_ORIGIN='https://example.test/private';assert.throws(()=>readReferralsConfig('http://localhost:5184'))
  delete process.env.REFERRALS_PUBLIC_ORIGIN;process.env.NODE_ENV='production';assert.throws(()=>readReferralsConfig('http://localhost:5184'))
 }finally{for(const n of names)if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n]}
})

test('owner links are encrypted, permanent-keyed and concurrent-safe without granting private purposes',async t=>{
 const f=await fixture(t),host=await f.login(),key=randomUUID(),link=await f.create(host,'公开称呼',key)
 assert.deepEqual(await f.create(host,'公开称呼',key),link)
 await assert.rejects(f.create(host,'Different',key),{code:'IDEMPOTENCY_CONFLICT'})
 const pair=await Promise.all([f.create(host,'公开称呼'),f.create(host,'公开称呼')]);assert(pair.every(item=>item.id===link.id))
 const stored=(await f.pool.query('SELECT * FROM referral_links')).rows;assert.equal(stored.length,1)
 const token=link.url.split('/').at(-1);assert.equal(token.length,43);assert.equal(stored[0].token_hash,hash(token));assert(!stored[0].token_cipher.includes(token))
 assert.deepEqual(await f.referrals.publicInfo(token),{publicName:'公开称呼',campaign:'first-memory-v1'})
 const other=await f.login();await assert.rejects(f.referrals.revoke(other.hash,other.id,randomUUID(),link.id,1),{code:'NOT_FOUND'})
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM consent_events')).rows[0].n,0)
 const revokeKey=randomUUID(),revoked=await f.referrals.revoke(host.hash,host.id,revokeKey,link.id,1)
 assert.equal(revoked.status,'revoked');assert.equal(revoked.url,null)
 assert.deepEqual(await f.referrals.revoke(host.hash,host.id,revokeKey,link.id,1),revoked)
 assert.deepEqual(await f.create(host,'公开称呼',key),revoked)
 await assert.rejects(f.referrals.publicInfo(token),{code:'NOT_FOUND'})
 assert.equal((await f.referrals.status(host.hash,host.id)).link,null)
 assert.notEqual((await f.create(host,'Next invitation')).id,link.id)
})

test('click intent is browser-bound and frozen at auth start; first registration and attribution commit together',async t=>{
 const f=await fixture(t),host=await f.login(),secondHost=await f.login(),first=await f.invite(host)
 const attempt=await f.begin({browser:first.browser})
 await f.invite(secondHost,first.browser)
 const guest=await attempt.complete(),rows=await f.pending();assert.equal(rows.length,1)
 assert.equal(rows[0].inviterAccountId,host.accountId);assert.equal(rows[0].inviteeAccountId,guest.accountId)
 const event=(await f.pool.query("SELECT payload FROM outbox_events WHERE account_id=$1 AND type='AccountRegistered.v1'",[guest.accountId])).rows[0].payload
 assert.equal(event.referralAttributionId,rows[0].id)
 const status=await f.referrals.status(host.hash,host.id)
 assert.equal(status.records.length,1);assert.equal(status.records[0].firstMemoryAt,null);assert.equal(status.receivedRewardCount,0)
 assert(!JSON.stringify(status).includes(guest.accountId))
 const otherBrowser=await f.login();assert.equal((await f.pending()).length,1)
 assert.equal((await f.referrals.status(otherBrowser.hash,otherBrowser.id)).records.length,0)
})

test('existing, self, switch and reauthentication cannot acquire or transfer an invitation',async t=>{
 const f=await fixture(t),host=await f.login(),old=await f.login(),joined=await f.invite(host)
 const existing=await f.login({browser:joined.browser,subject:old.subject})
 assert.equal(existing.accountId,old.accountId);assert.equal((await f.pending()).length,0)
 await f.identity.logout(existing.hash)
 await f.login({browser:joined.browser});assert.equal((await f.pending()).length,0)
 const self=await f.invite(host);await f.login({browser:self.browser,subject:host.subject});assert.equal((await f.pending()).length,0)
 const link=await f.create(host)
 assert.deepEqual(await f.referrals.join(link.url.split('/').at(-1),hash(host.browser),randomUUID(),true),{invitationIntentId:null,expiresAt:null})
 await f.login({browser:host.browser,sessionHash:host.hash,purpose:'switch'})
 assert.equal((await f.pending()).length,0)
 const reauth=await f.login();await f.login({browser:reauth.browser,sessionHash:reauth.hash,subject:reauth.subject,purpose:'reauthenticate'})
 assert.equal((await f.pending()).length,0)
})

test('expired or revoked unconsumed intent never blocks normal registration or creates an attribution',async t=>{
 const f=await fixture(t),host=await f.login(),expired=await f.invite(host),attempt=await f.begin({browser:expired.browser})
 await f.pool.query("UPDATE referral_join_intents SET created_at=clock_timestamp()-interval '25 hours',expires_at=clock_timestamp()-interval '1 hour' WHERE id=$1",[expired.intent.invitationIntentId])
 await attempt.complete();assert.equal((await f.pending()).length,0)
 const revoked=await f.invite(host),next=await f.begin({browser:revoked.browser})
 await f.referrals.revoke(host.hash,host.id,randomUUID(),revoked.link.id,1)
 await next.complete();assert.equal((await f.pending()).length,0)
})

test('registration failure rolls back invitation, outbox and session, while retrying the same claim consumes exactly once',async t=>{
 const f=await fixture(t),host=await f.login(),join=await f.invite(host),attempt=await f.begin({browser:join.browser})
 await assert.rejects(attempt.complete(async()=>{throw new Error('synthetic rollback')}))
 assert.equal((await f.pending()).length,0);assert.equal((await f.pool.query('SELECT count(*)::int n FROM accounts')).rows[0].n,1)
 assert.equal((await f.pool.query('SELECT consumed_at FROM referral_join_intents WHERE id=$1',[join.intent.invitationIntentId])).rows[0].consumed_at,null)
 await attempt.complete();assert.equal((await f.pending()).length,1)
})

test('parallel registration of one verified subject has one attribution and pending paging does not starve later candidates',async t=>{
 const f=await fixture(t),host=await f.login(),one=await f.invite(host),two=await f.invite(host),subject=randomUUID()
 const a=await f.begin({browser:one.browser,subject}),b=await f.begin({browser:two.browser,subject})
 const pair=await Promise.all([a.complete(),b.complete()]);assert.equal(pair[0].accountId,pair[1].accountId);assert.equal((await f.pending()).length,1)
 for(let i=0;i<2;i++){const joined=await f.invite(host);await f.login({browser:joined.browser})}
 const seen=[];let after=null
 do{const page=await f.referrals.pending(1,after);seen.push(...page.data.map(row=>row.id));after=page.meta.nextCursor}while(after)
 assert.equal(seen.length,3);assert.equal(new Set(seen).size,3)
})

test('link revocation preserves registered attribution; only idempotent award acknowledgement changes reward counts',async t=>{
 const f=await fixture(t),host=await f.login(),join=await f.invite(host),guest=await f.login({browser:join.browser}),ref=(await f.pending())[0]
 await f.referrals.revoke(host.hash,host.id,randomUUID(),join.link.id,1);assert.equal((await f.pending()).length,1)
 const receipt=randomUUID(),qualifiedAt=new Date().toISOString()
 await assert.rejects(f.referrals.rewarded(ref.id,receipt,new Date(Date.parse(ref.registeredAt)-1).toISOString()),{code:'INVALID_ARGUMENT'})
 await assert.rejects(f.referrals.rewarded(ref.id,receipt,new Date(Date.now()+60000).toISOString()),{code:'INVALID_ARGUMENT'})
 const first=await f.referrals.rewarded(ref.id,receipt,qualifiedAt),replayed=await f.referrals.rewarded(ref.id,receipt,qualifiedAt)
 assert.deepEqual(replayed,first);assert.equal((await f.pending()).length,0)
 await assert.rejects(f.referrals.rewarded(ref.id,randomUUID(),qualifiedAt),{code:'IDEMPOTENCY_CONFLICT'})
 for(const actor of[host,guest])assert.equal((await f.referrals.status(actor.hash,actor.id)).receivedRewardCount,1)
 assert.equal((await f.referrals.status(host.hash,host.id)).records[0].firstMemoryAt,qualifiedAt)
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM referral_reward_receipts')).rows[0].n,2)
})

test('export is scoped and token-free; deleting either participant removes shared linkage but retains the surviving own reward fact',async t=>{
 const f=await fixture(t),host=await f.login(),join=await f.invite(host),guest=await f.login({browser:join.browser}),ref=(await f.pending())[0]
 const receipt=randomUUID(),qualifiedAt=new Date().toISOString();await f.referrals.rewarded(ref.id,receipt,qualifiedAt)
 const db=await f.pool.connect()
 try{
  const exported=await referralExport(db,guest.accountId),serialized=JSON.stringify(exported)
  assert.equal(exported.referrals.records[0].role,'invitee');assert.equal(exported.referrals.rewards.length,1)
  for(const secret of[join.token,host.accountId,guest.accountId,hash(join.browser)])assert(!serialized.includes(secret))
  await db.query('BEGIN');await db.query("UPDATE accounts SET status='deletion_pending',access_version=access_version+1,deletion_requested_at=clock_timestamp() WHERE id=$1",[guest.accountId]);await eraseReferrals(db,guest.accountId);await db.query('COMMIT')
 }finally{db.release()}
 await assert.rejects(f.referrals.rewarded(ref.id,receipt,qualifiedAt),{code:'NOT_FOUND'})
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM referral_attributions')).rows[0].n,0)
 assert.equal((await f.referrals.status(host.hash,host.id)).receivedRewardCount,1)
 assert.deepEqual((await f.pool.query('SELECT account_id FROM referral_reward_receipts')).rows,[{account_id:host.accountId}])
 const next=await f.invite(host),nextGuest=await f.login({browser:next.browser}),pending=(await f.pending())[0]
 await f.pool.query("UPDATE accounts SET status='deletion_pending',access_version=access_version+1,deletion_requested_at=clock_timestamp() WHERE id=$1",[host.accountId])
 assert.equal((await f.pending()).length,0);await assert.rejects(f.referrals.publicInfo(next.token),{code:'NOT_FOUND'})
 await assert.rejects(f.referrals.rewarded(pending.id,randomUUID(),new Date().toISOString()),{code:'NOT_FOUND'})
 assert(nextGuest.accountId)
})

test('real HTTP protects private endpoints, binds anonymous join cookie and restricts acknowledgement to Gifts',async t=>{
 const f=await fixture(t),host=await f.login(),other=await f.login(),giftsToken=randomBytes(32).toString('hex'),peopleToken=randomBytes(32).toString('hex')
 const config={secure:false,origin:'http://localhost:5184',clientSecret:randomUUID(),giftsServiceToken:giftsToken,peopleServiceToken:peopleToken}
 const app=await NestFactory.create(IdentityModule.register(config,f.identity,{},new ConsentStore(f.pool,f.identity),undefined,undefined,f.referrals),{logger:false,abortOnError:false})
 app.use(identityHeaders);app.useGlobalFilters(new IdentityErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close());const origin=await app.getUrl()
 const auth=actor=>({Cookie:'xijie_dev_session='+actor.proof,'X-Xijie-Expected-Session':actor.id})
 const post=(path,body,headers={})=>fetch(origin+path,{method:'POST',headers:{Origin:config.origin,'Content-Type':'application/json','Idempotency-Key':randomUUID(),...headers},body:JSON.stringify(body)})
 assert.equal((await post('/v1/referrals/links',{publicName:'Friend'})).status,401)
 assert.equal((await post('/v1/referrals/links',{publicName:'Friend'},{...auth(host),Origin:'https://other.invalid'})).status,403)
 assert.equal((await post('/v1/referrals/links',{publicName:'Friend'},{...auth(host),'X-Xijie-Expected-Session':other.id})).status,401)
 const created=await post('/v1/referrals/links',{publicName:'Friend'},auth(host));assert.equal(created.status,201);const link=(await created.json()).data,token=link.url.split('/').at(-1)
 assert.deepEqual((await(await fetch(origin+'/v1/public/referrals/'+token)).json()).data,{publicName:'Friend',campaign:'first-memory-v1'})
 const key=randomUUID(),joined=await post('/v1/public/referrals/'+token+'/join',{}, {'Idempotency-Key':key});assert.equal(joined.status,201)
 const browserCookie=joined.headers.get('set-cookie').split(';')[0],intent=(await joined.json()).data
 const replay=await post('/v1/public/referrals/'+token+'/join',{}, {'Idempotency-Key':key,Cookie:browserCookie});assert.deepEqual((await replay.json()).data,intent)
 assert.equal((await post('/v1/public/referrals/'+token+'/join',{owner:host.accountId},{Cookie:browserCookie})).status,400)
 assert.equal((await post('/v1/public/referrals/'+token+'/join',{}, {Cookie:'xijie_dev_session='+host.proof})).status,401)
 assert.deepEqual((await(await post('/v1/public/referrals/'+token+'/join',{},auth(host))).json()).data,{invitationIntentId:null,expiresAt:null})
 const guest=await f.login({browser:browserCookie.split('=')[1]}),ref=(await f.pending())[0];assert.equal(ref.inviteeAccountId,guest.accountId)
 const pendingPath=origin+'/internal/v1/referrals/pending?limit=1'
 assert.equal((await fetch(pendingPath,{headers:{Authorization:'Bearer '+peopleToken}})).status,403)
 const pending=await fetch(pendingPath,{headers:{Authorization:'Bearer '+giftsToken}});assert.equal(pending.status,200);assert.equal((await pending.json()).data.length,1)
 const body={receiptId:randomUUID(),qualifiedAt:new Date().toISOString()}
 assert.equal((await post('/internal/v1/referrals/'+ref.id+'/rewarded',body,auth(host))).status,403)
 const acknowledged=await post('/internal/v1/referrals/'+ref.id+'/rewarded',body,{Authorization:'Bearer '+giftsToken});assert.equal(acknowledged.status,200)
 assert.equal((await post('/v1/referrals/links/'+link.id+'/revoke',{},auth(host))).status,428)
 assert.equal((await post('/v1/referrals/links/'+link.id+'/revoke',{}, {...auth(host),'If-Match':'"v1"'})).status,200)
 const status=await fetch(origin+'/v1/referrals',{headers:auth(guest)});assert.equal(status.status,200);assert.equal((await status.json()).data.receivedRewardCount,1)
})
