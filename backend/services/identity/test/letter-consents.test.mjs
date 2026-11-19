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

const migration=()=>readFile(new URL('../db/014_private_letters.sql',import.meta.url),'utf8')
async function fixture(t){
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL;assert(connectionString)
 const schema='letter_consents_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString})
 await admin.query('CREATE SCHEMA '+schema)
 const pool=new pg.Pool({connectionString,options:'-c search_path='+schema})
 t.after(async()=>{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()})
 for(const name of(await readdir(new URL('../db/',import.meta.url))).filter(name=>/^\d+_.+\.sql$/.test(name)&&Number(name.slice(0,3))<14).sort())await pool.query(await readFile(new URL('../db/'+name,import.meta.url),'utf8'))
 const identity=new IdentityStore(pool),consents=new ConsentStore(pool,identity)
 async function login(){
  const browserHash=randomUUID(),id=randomUUID(),stateHash=randomUUID(),claimId=randomUUID(),proof=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(proof).digest('hex')
  await identity.begin({id,browserHash,key:randomUUID(),purpose:'sign_in',sessionHash:null,stateHash,nonce:randomUUID(),verifier:randomUUID(),authorizationUrl:'https://id.example.test/oidc/auth',expiresAt:new Date(Date.now()+60000)})
  await identity.claim({browserHash,stateHash,claimId})
  assert(await identity.finish({browserHash,attemptId:id,claimId,sessionHash:hash,principal:{issuer:'https://id.example.test/oidc',subject:randomUUID(),authenticatedAt:new Date()}}))
  return {...await identity.current(hash),hash,proof}
 }
 const decide=async(actor,purpose,decision,expectedAuthorizationVersion)=>{const p=(await consents.policies('en')).find(p=>p.kind===purpose);return consents.record(actor.hash,actor.id,randomUUID(),randomUUID(),{policyId:p.id,version:p.version,purpose,decision,expectedAuthorizationVersion})}
 return {pool,identity,consents,login,decide}
}

test('letter migration adds two explicit purposes without changing prior policies, grants or capabilities',async t=>{
 const f=await fixture(t),actor=await f.login()
 await f.decide(actor,'privacy_notice','acknowledge',0)
 for(const purpose of ['private_story_storage','ai_text_processing','virtual_gift_storage','person_gift_returns','gift_delivery_photo_storage'])await f.decide(actor,purpose,'grant',0)
 const prior=await f.consents.authorizations(actor.accountId),policies=(await f.pool.query('SELECT * FROM policy_versions ORDER BY kind,version')).rows,events=(await f.pool.query('SELECT * FROM consent_events ORDER BY id')).rows
 await f.pool.query(await migration())
 assert.deepEqual((await f.pool.query("SELECT * FROM policy_versions WHERE kind NOT IN ('private_letter_storage','person_letter_replies') ORDER BY kind,version")).rows,policies)
 assert.deepEqual((await f.pool.query('SELECT * FROM consent_events ORDER BY id')).rows,events)
 assert.deepEqual(await f.consents.authorizations(actor.accountId),{...prior,letterStorage:{allowed:false,authorizationVersion:0},letterReplies:{allowed:false,authorizationVersion:0}})
 for(const purpose of ['private_letter_storage','person_letter_replies']){
  const p=(await f.consents.policies('en')).find(p=>p.kind===purpose);assert.equal(p.version,1)
  await assert.rejects(f.pool.query("INSERT INTO consent_events(account_id,purpose,policy_id,policy_version,decision,authorization_version,idempotency_key,request_fingerprint,notice_authorization_version) VALUES($1,$2,$3,1,'grant',1,$4,'invalid',NULL)",[actor.accountId,purpose,p.id,randomUUID()]),e=>e.code==='23514')
 }
})

test('letter HTTP grants are independent, notice-bound, account-scoped and replay-safe; reply withdrawal preserves storage',async t=>{
 const f=await fixture(t);await f.pool.query(await migration());const actor=await f.login(),other=await f.login(),token=randomBytes(32).toString('hex')
 const config={secure:false,origin:'http://localhost:5184',clientSecret:randomUUID(),conversationsServiceToken:token}
 const app=await NestFactory.create(IdentityModule.register(config,f.identity,{},f.consents),{logger:false,abortOnError:false});app.use(identityHeaders);app.useGlobalFilters(new IdentityErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close());const origin=await app.getUrl()
 const auth=a=>({Cookie:'xijie_dev_session='+a.proof,'X-Xijie-Expected-Session':a.id})
 const policies=(await(await fetch(origin+'/v1/policies/current?locale=en')).json()).data
 const input=(purpose,decision,expectedAuthorizationVersion)=>{const p=policies.find(p=>p.kind===purpose);return {policyId:p.id,version:p.version,purpose,decision,expectedAuthorizationVersion}}
 const submit=(body,key=randomUUID(),a=actor)=>fetch(origin+'/v1/accounts/me/consents',{method:'POST',headers:{...auth(a),Origin:config.origin,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)})
 const accepted=async(body,key)=>{const response=await submit(body,key);assert.equal(response.status,201);return (await response.json()).data}
 for(const purpose of ['private_letter_storage','person_letter_replies'])assert.equal((await submit(input(purpose,'grant',0))).status,403)
 await accepted(input('privacy_notice','acknowledge',0))
 const storageInput=input('private_letter_storage','grant',0),storageKey=randomUUID(),storage=await accepted(storageInput,storageKey)
 assert.equal((await f.consents.authorizations(actor.accountId)).letterReplies.allowed,false)
 const replyInput=input('person_letter_replies','grant',0),replyKey=randomUUID(),receipts=await Promise.all([accepted(replyInput,replyKey),accepted(replyInput,replyKey)])
 assert.deepEqual(receipts[0],receipts[1]);assert.equal(receipts[0].authorizationVersion,1)
 assert.equal((await submit({...replyInput,decision:'revoke'},replyKey)).status,409)
 assert.equal((await submit(replyInput)).status,412)
 assert.equal((await submit(input('person_letter_replies','acknowledge',1))).status,400)
 assert.equal((await submit(input('person_letter_replies','revoke',1),randomUUID(),{...actor,id:other.id})).status,401)
 let current=await f.consents.authorizations(actor.accountId)
 assert.deepEqual(current.letterStorage,{allowed:true,authorizationVersion:1});assert.deepEqual(current.letterReplies,{allowed:true,authorizationVersion:1})
 assert.equal(current.aiTextProcessing.allowed,false);assert.equal(current.storyStorage.allowed,false)
 for(const path of ['/internal/v1/session-context','/internal/v1/accounts/'+actor.accountId+'/context']){
  const response=await fetch(origin+path,{headers:{...auth(actor),Authorization:'Bearer '+token}});assert.equal(response.status,200);const data=(await response.json()).data
  assert.deepEqual(data.letterStorage,current.letterStorage);assert.deepEqual(data.letterReplies,current.letterReplies);assert.equal(data.aiTextProcessing.allowed,false)
 }
 assert.deepEqual((await f.consents.authorizations(other.accountId)).letterReplies,{allowed:false,authorizationVersion:0})
 await accepted(input('person_letter_replies','revoke',1));current=await f.consents.authorizations(actor.accountId)
 assert.deepEqual(current.letterReplies,{allowed:false,authorizationVersion:2});assert.deepEqual(current.letterStorage,{allowed:true,authorizationVersion:1})
 assert.equal((await accepted(replyInput,replyKey)).id,receipts[0].id);assert.equal((await f.consents.authorizations(actor.accountId)).letterReplies.allowed,false)
 await accepted(input('person_letter_replies','grant',2));assert.deepEqual((await f.consents.authorizations(actor.accountId)).letterReplies,{allowed:true,authorizationVersion:3})
 await accepted(input('private_letter_storage','revoke',1));assert.equal((await accepted(storageInput,storageKey)).id,storage.id)
 current=await f.consents.authorizations(actor.accountId);assert.deepEqual(current.letterStorage,{allowed:false,authorizationVersion:2});assert.equal(current.letterReplies.allowed,true)
 const history=await(await fetch(origin+'/v1/accounts/me/consents?limit=1',{headers:auth(actor)})).json()
 assert.deepEqual(history.meta.letterStorage,current.letterStorage);assert.deepEqual(history.meta.letterReplies,current.letterReplies);assert.equal(history.meta.currentAuthorizationVersions.private_letter_storage,2);assert.equal(history.meta.currentAuthorizationVersions.person_letter_replies,3)
 assert.deepEqual((await f.pool.query("SELECT type,aggregate_type,payload->>'purpose' AS purpose FROM outbox_events WHERE account_id=$1 AND type IN ('LetterStorageRevoked.v1','LetterRepliesRevoked.v1') ORDER BY type",[actor.accountId])).rows,[{type:'LetterRepliesRevoked.v1',aggregate_type:'letter_replies_authorization',purpose:'person_letter_replies'},{type:'LetterStorageRevoked.v1',aggregate_type:'letter_storage_authorization',purpose:'private_letter_storage'}])
 await accepted(input('private_letter_storage','grant',2));await accepted(input('privacy_notice','acknowledge',1))
 current=await f.consents.authorizations(actor.accountId);assert.equal(current.letterStorage.allowed,false);assert.equal(current.letterReplies.allowed,false)
 await accepted(input('private_letter_storage','grant',3));assert.equal((await f.consents.authorizations(actor.accountId)).letterReplies.allowed,false)
 await accepted(input('person_letter_replies','grant',3));current=await f.consents.authorizations(actor.accountId)
 assert.deepEqual(current.letterStorage,{allowed:true,authorizationVersion:4});assert.deepEqual(current.letterReplies,{allowed:true,authorizationVersion:4});assert.equal(current.aiTextProcessing.allowed,false)
 const bindings=(await f.pool.query("SELECT purpose,notice_authorization_version FROM consent_events WHERE account_id=$1 AND purpose IN ('private_letter_storage','person_letter_replies') AND authorization_version=4 ORDER BY purpose",[actor.accountId])).rows
 assert.equal(bindings.length,2);assert(bindings.every(row=>row.notice_authorization_version===2))
})
