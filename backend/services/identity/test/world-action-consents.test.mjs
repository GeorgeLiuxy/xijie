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

const migration=()=>readFile(new URL('../db/018_person_world_actions.sql',import.meta.url),'utf8')
async function fixture(t){
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL;assert(connectionString)
 const schema='world_action_consents_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString})
 await admin.query('CREATE SCHEMA '+schema)
 const pool=new pg.Pool({connectionString,options:'-c search_path='+schema})
 t.after(async()=>{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()})
 for(const name of(await readdir(new URL('../db/',import.meta.url))).filter(name=>/^\d+_.+\.sql$/.test(name)&&Number(name.slice(0,3))<18).sort())await pool.query(await readFile(new URL('../db/'+name,import.meta.url),'utf8'))
 const identity=new IdentityStore(pool),consents=new ConsentStore(pool,identity)
 async function login(){
  const browserHash=randomUUID(),id=randomUUID(),stateHash=randomUUID(),claimId=randomUUID(),proof=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(proof).digest('hex')
  await identity.begin({id,browserHash,key:randomUUID(),purpose:'sign_in',sessionHash:null,stateHash,nonce:randomUUID(),verifier:randomUUID(),authorizationUrl:'https://id.example.test/oidc/auth',expiresAt:new Date(Date.now()+60000)})
  await identity.claim({browserHash,stateHash,claimId})
  assert(await identity.finish({browserHash,attemptId:id,claimId,sessionHash:hash,principal:{issuer:'https://id.example.test/oidc',subject:randomUUID(),authenticatedAt:new Date()}}))
  return {...await identity.current(hash),hash,proof}
 }
 const input=async(purpose,decision,expectedAuthorizationVersion)=>{const p=(await consents.policies('en')).find(p=>p.kind===purpose);return {policyId:p.id,version:p.version,purpose,decision,expectedAuthorizationVersion}}
 const decide=async(actor,purpose,decision,expectedAuthorizationVersion)=>consents.record(actor.hash,actor.id,randomUUID(),randomUUID(),await input(purpose,decision,expectedAuthorizationVersion))
 return {pool,identity,consents,login,input,decide}
}

test('world-action migration preserves every earlier policy and decision and adds no implied AI or storage grant',async t=>{
 const f=await fixture(t),actor=await f.login()
 await f.decide(actor,'privacy_notice','acknowledge',0)
 for(const policy of(await f.consents.policies('en')).filter(row=>row.kind!=='privacy_notice'))await f.decide(actor,policy.kind,'grant',0)
 const prior=await f.consents.authorizations(actor.accountId),policies=(await f.pool.query('SELECT * FROM policy_versions ORDER BY kind,version')).rows,events=(await f.pool.query('SELECT * FROM consent_events ORDER BY id')).rows,pointers=(await f.pool.query('SELECT * FROM current_consents ORDER BY purpose')).rows
 assert(!('worldActionProcessing' in prior))
 await f.pool.query(await migration())
 assert.deepEqual((await f.pool.query("SELECT * FROM policy_versions WHERE kind<>'person_world_actions' ORDER BY kind,version")).rows,policies)
 assert.deepEqual((await f.pool.query('SELECT * FROM consent_events ORDER BY id')).rows,events)
 assert.deepEqual((await f.pool.query('SELECT * FROM current_consents ORDER BY purpose')).rows,pointers)
 assert.deepEqual(await f.consents.authorizations(actor.accountId),{...prior,worldActionProcessing:{allowed:false,authorizationVersion:0}})
 const p=(await f.consents.policies('en')).find(row=>row.kind==='person_world_actions');assert.equal(p.version,1)
 const write=(decision,noticeVersion)=>f.pool.query("INSERT INTO consent_events(account_id,purpose,policy_id,policy_version,decision,authorization_version,idempotency_key,request_fingerprint,notice_authorization_version) VALUES($1,'person_world_actions',$2,1,$3,1,$4,'fixture',$5)",[actor.accountId,p.id,decision,randomUUID(),noticeVersion])
 for(const binding of [null,0])await assert.rejects(write('grant',binding),error=>error.code==='23514')
 await assert.rejects(write('revoke',1),error=>error.code==='23514')
 await assert.rejects(write('acknowledge',null),error=>error.code==='23514')
 const other=await f.login();await f.decide(other,'privacy_notice','acknowledge',0);await f.decide(other,'privacy_notice','acknowledge',1)
 await assert.rejects(write('grant',2),error=>error.code==='23503')
})

test('world-action HTTP exposes independent combinations, exact notice binding and replay-safe withdrawal without enabling old AI',async t=>{
 const f=await fixture(t);await f.pool.query(await migration())
 const actor=await f.login(),other=await f.login(),token=randomBytes(32).toString('hex')
 const config={secure:false,origin:'http://localhost:5184',clientSecret:randomUUID(),conversationsServiceToken:token}
 const app=await NestFactory.create(IdentityModule.register(config,f.identity,{},f.consents),{logger:false,abortOnError:false})
 app.use(identityHeaders);app.useGlobalFilters(new IdentityErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close());const origin=await app.getUrl()
 const auth=a=>({Cookie:'xijie_dev_session='+a.proof,'X-Xijie-Expected-Session':a.id})
 const policies=(await(await fetch(origin+'/v1/policies/current?locale=en')).json()).data
 const input=(purpose,decision,expectedAuthorizationVersion)=>{const p=policies.find(row=>row.kind===purpose);return {policyId:p.id,version:p.version,purpose,decision,expectedAuthorizationVersion}}
 const submit=(body,key=randomUUID(),a=actor)=>fetch(origin+'/v1/accounts/me/consents',{method:'POST',headers:{...auth(a),Origin:config.origin,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)})
 const accept=async(body,key)=>{const response=await submit(body,key);assert.equal(response.status,201);return(await response.json()).data}
 const grant=input('person_world_actions','grant',0),key=randomUUID()
 assert.equal((await submit(grant,key)).status,403)
 await accept(input('privacy_notice','acknowledge',0))
 const receipts=await Promise.all([accept(grant,key),accept(grant,key)]);assert.deepEqual(receipts[0],receipts[1]);assert.equal(receipts[0].authorizationVersion,1)
 let current=await f.consents.authorizations(actor.accountId)
 assert.deepEqual(current.worldActionProcessing,{allowed:true,authorizationVersion:1});assert.equal(current.storyStorage.allowed,false);assert.equal(current.aiTextProcessing.allowed,false)
 for(const purpose of ['letterReplies','giftReturns','photoStorage','personPhotoStorage','giftPhotoStorage'])assert.equal(current[purpose].allowed,false)
 await accept(input('private_story_storage','grant',0));current=await f.consents.authorizations(actor.accountId)
 assert.equal(current.worldActionProcessing.allowed,true);assert.equal(current.storyStorage.allowed,true);assert.equal(current.aiTextProcessing.allowed,false)
 for(const path of ['/internal/v1/session-context','/internal/v1/accounts/'+actor.accountId+'/context']){
  const response=await fetch(origin+path,{headers:{...auth(actor),Authorization:'Bearer '+token}});assert.equal(response.status,200)
  const data=(await response.json()).data;assert.deepEqual(data.worldActionProcessing,current.worldActionProcessing);assert.deepEqual(data.storyStorage,current.storyStorage);assert.equal(data.aiTextProcessing.allowed,false)
 }
 assert.equal((await submit({...grant,decision:'revoke'},key)).status,409)
 assert.equal((await submit(grant)).status,412)
 assert.equal((await submit(input('person_world_actions','acknowledge',1))).status,400)
 assert.equal((await submit(input('person_world_actions','revoke',1),randomUUID(),{...actor,id:other.id})).status,401)
 assert.deepEqual((await f.consents.authorizations(other.accountId)).worldActionProcessing,{allowed:false,authorizationVersion:0})
 await accept(input('ai_text_processing','grant',0));await accept(input('ai_text_processing','revoke',1))
 current=await f.consents.authorizations(actor.accountId);assert.equal(current.worldActionProcessing.allowed,true);assert.equal(current.aiTextProcessing.allowed,false)
 await accept(input('ai_text_processing','grant',2));await accept(input('person_world_actions','revoke',1))
 current=await f.consents.authorizations(actor.accountId);assert.equal(current.aiTextProcessing.allowed,true);assert.equal(current.storyStorage.allowed,true);assert.deepEqual(current.worldActionProcessing,{allowed:false,authorizationVersion:2})
 assert.equal((await accept(grant,key)).id,receipts[0].id);assert.equal((await f.consents.authorizations(actor.accountId)).worldActionProcessing.allowed,false)
 await accept(input('person_world_actions','grant',2));await accept(input('private_story_storage','revoke',1))
 current=await f.consents.authorizations(actor.accountId);assert.equal(current.worldActionProcessing.allowed,true);assert.equal(current.storyStorage.allowed,false)
 const history=await(await fetch(origin+'/v1/accounts/me/consents?limit=1',{headers:auth(actor)})).json()
 assert.deepEqual(history.meta.worldActionProcessing,current.worldActionProcessing);assert.equal(history.meta.currentAuthorizationVersions.person_world_actions,3);assert.equal(history.meta.currentDecisions.person_world_actions,'grant')
 assert.deepEqual((await f.pool.query("SELECT type,aggregate_type,aggregate_version,payload->>'purpose' AS purpose FROM outbox_events WHERE account_id=$1 AND type='WorldActionProcessingRevoked.v1'",[actor.accountId])).rows,[{type:'WorldActionProcessingRevoked.v1',aggregate_type:'world_action_processing_authorization',aggregate_version:2,purpose:'person_world_actions'}])
 await accept(input('private_story_storage','grant',2));await accept(input('privacy_notice','acknowledge',1))
 current=await f.consents.authorizations(actor.accountId);assert.equal(current.worldActionProcessing.allowed,false);assert.equal(current.storyStorage.allowed,false);assert.equal(current.aiTextProcessing.allowed,false)
 await accept(input('person_world_actions','grant',3));current=await f.consents.authorizations(actor.accountId)
 assert.deepEqual(current.worldActionProcessing,{allowed:true,authorizationVersion:4});assert.equal(current.storyStorage.allowed,false);assert.equal(current.aiTextProcessing.allowed,false)
 assert.equal((await f.pool.query("SELECT notice_authorization_version FROM consent_events WHERE account_id=$1 AND purpose='person_world_actions' AND authorization_version=4",[actor.accountId])).rows[0].notice_authorization_version,2)
})

test('independent world-action decisions serialize competing keys and reject a later policy without rewriting history',async t=>{
 const f=await fixture(t);await f.pool.query(await migration());const actor=await f.login()
 await f.decide(actor,'privacy_notice','acknowledge',0)
 const input=await f.input('person_world_actions','grant',0)
 const results=await Promise.allSettled([1,2].map(()=>f.consents.record(actor.hash,actor.id,randomUUID(),randomUUID(),input)))
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1)
 assert.equal(results.find(result=>result.status==='rejected').reason.code,'VERSION_CONFLICT')
 assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM consent_events WHERE account_id=$1 AND purpose='person_world_actions'",[actor.accountId])).rows[0].n,1)
 const original=(await f.pool.query("SELECT * FROM consent_events WHERE account_id=$1 AND purpose='person_world_actions'",[actor.accountId])).rows
 await f.pool.query("INSERT INTO policy_versions(id,kind,version,document_zh_cn,document_en) SELECT id,kind,2,'Synthetic later scope','Synthetic later scope' FROM policy_versions WHERE kind='person_world_actions' AND version=1")
 assert.deepEqual((await f.consents.authorizations(actor.accountId)).worldActionProcessing,{allowed:false,authorizationVersion:1})
 await assert.rejects(()=>f.consents.record(actor.hash,actor.id,randomUUID(),randomUUID(),{...input,expectedAuthorizationVersion:1}),{code:'VERSION_CONFLICT'})
 assert.deepEqual((await f.pool.query("SELECT * FROM consent_events WHERE account_id=$1 AND purpose='person_world_actions'",[actor.accountId])).rows,original)
})
