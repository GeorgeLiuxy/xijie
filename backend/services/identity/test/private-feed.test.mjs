import 'reflect-metadata'
import assert from 'node:assert/strict'
import {createHash,randomBytes,randomUUID} from 'node:crypto'
import {readFile,readdir} from 'node:fs/promises'
import {test} from 'node:test'
import pg from 'pg'
import {NestFactory} from '@nestjs/core'
import {IdentityStore} from '../dist/store.js'
import {ConsentStore} from '../dist/consent-store.js'
import {IdentityModule,IdentityErrors,identityHeaders} from '../dist/http.js'
import {readRightsConfig,rightsDomains} from '../dist/rights-config.js'

async function fixture(t){
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL;assert(connectionString,'Integration database required')
 const schema='private_feed_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString});await admin.query('CREATE SCHEMA '+schema)
 const pool=new pg.Pool({connectionString,options:'-c search_path='+schema})
 for(const file of (await readdir(new URL('../db/',import.meta.url))).filter(file=>/^00[1-6]_.+\.sql$/.test(file)).sort())await pool.query(await readFile(new URL('../db/'+file,import.meta.url),'utf8'))
 t.after(async()=>{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()})
 const identity=new IdentityStore(pool),consents=new ConsentStore(pool,identity)
 const browserHash=randomUUID(),id=randomUUID(),stateHash=randomUUID(),claimId=randomUUID(),proof=randomBytes(32).toString('base64url'),sessionHash=createHash('sha256').update(proof).digest('hex')
 await identity.begin({id,browserHash,key:randomUUID(),purpose:'sign_in',sessionHash:null,stateHash,nonce:randomUUID(),verifier:randomUUID(),authorizationUrl:'https://id.example.test/oidc/auth',expiresAt:new Date(Date.now()+60000)})
 await identity.claim({browserHash,stateHash,claimId});assert(await identity.finish({browserHash,attemptId:id,claimId,sessionHash,principal:{issuer:'https://id.example.test/oidc',subject:'private-feed-fixture',authenticatedAt:new Date()}}))
 const actor=await identity.current(sessionHash)
 const grant=async(purpose,decision,expectedAuthorizationVersion)=>{
  const policy=(await consents.policies('en')).find(row=>row.kind===purpose)
  return consents.record(sessionHash,actor.id,randomUUID(),randomUUID(),{policyId:policy.id,version:policy.version,purpose,decision,expectedAuthorizationVersion})
 }
 return {pool,identity,consents,actor,sessionHash,proof,grant}
}

test('fresh private-feed permission is explicit, bound to the exact notice, revocable and independent of AI',async t=>{
 const f=await fixture(t)
 await f.grant('privacy_notice','acknowledge',0);await f.grant('private_story_storage','grant',0);await f.grant('ai_text_processing','grant',0)
 const before=await f.consents.authorizations(f.actor.accountId)
 assert.equal(before.storyStorage.allowed,true);assert.notEqual(before.storyStorage.privateFeedAllowed,true);assert.equal(before.aiTextProcessing.automaticMemoryAllowed,true)
 const preserved=(await f.pool.query('SELECT id,kind,version,document_zh_cn,document_en,published_at,effective_at FROM policy_versions ORDER BY kind,version')).rows
 await f.pool.query(await readFile(new URL('../db/007_private_feed_permission.sql',import.meta.url),'utf8'))
 const all=(await f.pool.query('SELECT id,kind,version,document_zh_cn,document_en,published_at,effective_at FROM policy_versions ORDER BY kind,version')).rows
 assert.deepEqual(all.filter(row=>preserved.some(old=>old.id===row.id&&old.version===row.version)),preserved)
 const current=await f.consents.policies('en');assert.equal(current.find(p=>p.kind==='privacy_notice').version,4);assert.equal(current.find(p=>p.kind==='private_story_storage').version,2);assert.equal(current.find(p=>p.kind==='ai_text_processing').version,2)
 let context=await f.consents.authorizations(f.actor.accountId);assert.equal(context.storyStorage.allowed,false);assert.notEqual(context.storyStorage.privateFeedAllowed,true);assert.equal(context.aiTextProcessing.allowed,false)
 assert.equal((await f.pool.query("SELECT policy_version FROM consent_events WHERE account_id=$1 AND purpose='private_story_storage'",[f.actor.accountId])).rows[0].policy_version,1)
 await assert.rejects(f.grant('private_story_storage','grant',1),e=>e.code==='FORBIDDEN')
 await f.grant('privacy_notice','acknowledge',1);assert.notEqual((await f.consents.authorizations(f.actor.accountId)).storyStorage.privateFeedAllowed,true)
 const accepted=await f.grant('private_story_storage','grant',1)
 assert.equal((await f.pool.query('SELECT notice_authorization_version FROM consent_events WHERE id=$1',[accepted.id])).rows[0].notice_authorization_version,2)
 context=await f.consents.authorizations(f.actor.accountId);assert.deepEqual(context.storyStorage,{allowed:true,authorizationVersion:2,privateFeedAllowed:true});assert.equal(context.aiTextProcessing.allowed,false)
 // The same policy is read and granted through the original Nest endpoints, not a scope toggle in config.
 const socialToken=randomBytes(32).toString('hex'),config={secure:false,origin:'http://localhost:5184',clientSecret:randomUUID(),socialServiceToken:socialToken}
 const app=await NestFactory.create(IdentityModule.register(config,f.identity,{},f.consents),{logger:false,abortOnError:false});app.use(identityHeaders);app.useGlobalFilters(new IdentityErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close());const origin=await app.getUrl()
 const sessionHeaders={Cookie:'xijie_dev_session='+f.proof,'X-Xijie-Expected-Session':f.actor.id}
 const result=await fetch(origin+'/v1/accounts/me/consents?limit=1',{headers:sessionHeaders});assert.equal(result.status,200);assert.deepEqual((await result.json()).meta.storyStorage,context.storyStorage)
 const internal=await fetch(origin+'/internal/v1/session-context',{headers:{...sessionHeaders,Authorization:'Bearer '+socialToken}});assert.equal(internal.status,200);assert.equal((await internal.json()).data.storyStorage.privateFeedAllowed,true)
 assert.equal((await fetch(origin+'/internal/v1/session-context',{headers:{...sessionHeaders,Authorization:'Bearer '+'0'.repeat(64)}})).status,403)
 assert.equal((await fetch(origin+'/internal/v1/session-context',{headers:{Authorization:'Bearer '+socialToken}})).status,401)
 await f.grant('private_story_storage','revoke',2);context=await f.consents.authorizations(f.actor.accountId);assert.equal(context.storyStorage.allowed,false);assert.notEqual(context.storyStorage.privateFeedAllowed,true)
 await f.grant('private_story_storage','grant',3);assert.equal((await f.consents.authorizations(f.actor.accountId)).storyStorage.privateFeedAllowed,true)
 await f.grant('privacy_notice','acknowledge',2);context=await f.consents.authorizations(f.actor.accountId);assert.equal(context.storyStorage.allowed,false);assert.notEqual(context.storyStorage.privateFeedAllowed,true)
 await f.grant('private_story_storage','grant',4);assert.equal((await f.consents.authorizations(f.actor.accountId)).storyStorage.privateFeedAllowed,true)
 for(const kind of ['privacy_notice','ai_text_processing'])await assert.rejects(f.pool.query('UPDATE policy_versions SET private_feed_enabled=true WHERE kind=$1',[kind]),{code:'23514'})
 for(const status of ['restricted','deletion_pending','deleted']){
  await f.pool.query("UPDATE accounts SET status=$2,access_version=access_version+1,deletion_requested_at=CASE WHEN $2 IN ('deletion_pending','deleted') THEN COALESCE(deletion_requested_at,clock_timestamp()) ELSE deletion_requested_at END,deleted_at=CASE WHEN $2='deleted' THEN clock_timestamp() ELSE NULL END WHERE id=$1",[f.actor.accountId,status])
  assert.equal((await fetch(origin+'/internal/v1/accounts/'+f.actor.accountId+'/context',{headers:{Authorization:'Bearer '+socialToken}})).status,404)
 }
})

test('Social rights configuration is explicitly optional and rejects configured invalid origins',()=>{
 const previous=process.env.XIJIE_SOCIAL_URL
 try{
  delete process.env.XIJIE_SOCIAL_URL;const legacy=readRightsConfig({issuer:new URL('https://id.example.test/oidc')});assert.deepEqual(rightsDomains(legacy),['people','conversations','memories']);assert.equal(legacy.socialUrl,null)
  process.env.XIJIE_SOCIAL_URL='http://127.0.0.1:3105';const extended=readRightsConfig({issuer:new URL('https://id.example.test/oidc')});assert.deepEqual(rightsDomains(extended),['people','conversations','memories','social']);assert.equal(extended.socialUrl.port,'3105')
  for(const bad of ['http://external.invalid','https://good.example.test/wrong-path','https://user:secret@example.test','not a url']){process.env.XIJIE_SOCIAL_URL=bad;assert.throws(()=>readRightsConfig({issuer:new URL('https://id.example.test/oidc')}))}
 }finally{if(previous===undefined)delete process.env.XIJIE_SOCIAL_URL;else process.env.XIJIE_SOCIAL_URL=previous}
})
