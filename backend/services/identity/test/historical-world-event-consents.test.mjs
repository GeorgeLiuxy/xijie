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

const policyId='76165f61-1809-493b-9d3c-414a65641569'
const migration=()=>readFile(new URL('../db/019_historical_world_events.sql',import.meta.url),'utf8')
async function fixture(t){
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL;assert(connectionString)
 const schema='historical_world_events_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString})
 await admin.query('CREATE SCHEMA '+schema)
 const pool=new pg.Pool({connectionString,options:'-c search_path='+schema})
 t.after(async()=>{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()})
 for(const file of(await readdir(new URL('../db/',import.meta.url))).filter(file=>/^\d+_.+\.sql$/.test(file)&&Number(file.slice(0,3))<19).sort())await pool.query(await readFile(new URL('../db/'+file,import.meta.url),'utf8'))
 const identity=new IdentityStore(pool),consents=new ConsentStore(pool,identity)
 async function login(){
  const browserHash=randomUUID(),id=randomUUID(),stateHash=randomUUID(),claimId=randomUUID(),proof=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(proof).digest('hex')
  await identity.begin({id,browserHash,key:randomUUID(),purpose:'sign_in',sessionHash:null,stateHash,nonce:randomUUID(),verifier:randomUUID(),authorizationUrl:'https://id.example.test/oidc/auth',expiresAt:new Date(Date.now()+60000)})
  await identity.claim({browserHash,stateHash,claimId})
  assert(await identity.finish({browserHash,attemptId:id,claimId,sessionHash:hash,principal:{issuer:'https://id.example.test/oidc',subject:randomUUID(),authenticatedAt:new Date()}}))
  return {...await identity.current(hash),hash,proof}
 }
 const input=async(purpose,decision,expectedAuthorizationVersion)=>{const p=(await consents.policies('en')).find(p=>p.kind===purpose);return {policyId:p.id,version:p.version,purpose,decision,expectedAuthorizationVersion}}
 const record=(actor,body,key=randomUUID())=>consents.record(actor.hash,actor.id,key,randomUUID(),body)
 const decide=async(actor,purpose,decision,expectedAuthorizationVersion)=>record(actor,await input(purpose,decision,expectedAuthorizationVersion))
 return {pool,identity,consents,login,input,record,decide}
}

test('019 appends the historical scope without editing published v1 or expanding its live or replayed grant',async t=>{
 const f=await fixture(t),actor=await f.login()
 await f.decide(actor,'privacy_notice','acknowledge',0)
 await f.decide(actor,'private_story_storage','grant',0)
 await f.decide(actor,'ai_text_processing','grant',0)
 const oldInput=await f.input('person_world_actions','grant',0),oldKey=randomUUID(),receipt=await f.record(actor,oldInput,oldKey)
 const prior=await f.consents.authorizations(actor.accountId),policies=(await f.pool.query('SELECT * FROM policy_versions ORDER BY kind,version')).rows,events=(await f.pool.query('SELECT * FROM consent_events ORDER BY id')).rows,pointers=(await f.pool.query('SELECT * FROM current_consents ORDER BY purpose')).rows
 assert.deepEqual(prior.worldActionProcessing,{allowed:true,authorizationVersion:1})
 await f.pool.query(await migration())
 const after=(await f.pool.query('SELECT * FROM policy_versions ORDER BY kind,version')).rows
 assert.equal(after.length,policies.length+1)
 assert.deepEqual(after.filter(row=>row.id!==policyId).map(({world_event_history_enabled,...row})=>{assert.equal(world_event_history_enabled,false);return row}),policies)
 assert.deepEqual((await f.pool.query('SELECT * FROM consent_events ORDER BY id')).rows,events)
 assert.deepEqual((await f.pool.query('SELECT * FROM current_consents ORDER BY purpose')).rows,pointers)
 const next=after.find(row=>row.id===policyId);assert.equal(next.version,2);assert.equal(next.world_event_history_enabled,true)
 assert.deepEqual(await f.consents.authorizations(actor.accountId),{...prior,worldActionProcessing:{allowed:false,authorizationVersion:1}})
 assert.deepEqual(await f.record(actor,oldInput,oldKey),receipt)
 await assert.rejects(()=>f.record(actor,{...oldInput,expectedAuthorizationVersion:1}),{code:'VERSION_CONFLICT'})
 assert.deepEqual((await f.consents.authorizations(actor.accountId)).worldActionProcessing,{allowed:false,authorizationVersion:1})
 const history=await f.consents.history(actor.accountId,1,null)
 assert.equal(history.currentAuthorizationVersions.person_world_actions,1);assert.equal(history.currentDecisions.person_world_actions,undefined)
 const newInput=await f.input('person_world_actions','grant',1)
 await assert.rejects(()=>f.record(actor,{...newInput,policyId:oldInput.policyId}),{code:'VERSION_CONFLICT'})
 await f.record(actor,newInput)
 assert.deepEqual((await f.consents.authorizations(actor.accountId)).worldActionProcessing,{allowed:true,authorizationVersion:2,historicalWorldEventsAllowed:true})
 assert.deepEqual((await f.pool.query('SELECT * FROM consent_events WHERE id=ANY($1::uuid[]) ORDER BY id',[events.map(row=>row.id)])).rows,events)
 for(const locale of ['zh-CN','en'])assert.equal(await f.consents.document(oldInput.policyId,1,locale),policies.find(row=>row.id===oldInput.policyId)['document_'+(locale==='en'?'en':'zh_cn')])
})

test('historical capability follows exact v2 policy and notice on public and internal HTTP, including withdrawal and replay',async t=>{
 const f=await fixture(t);await f.pool.query(await migration());const actor=await f.login(),other=await f.login(),token=randomBytes(32).toString('hex')
 const config={secure:false,origin:'http://localhost:5184',clientSecret:randomUUID(),conversationsServiceToken:token}
 const app=await NestFactory.create(IdentityModule.register(config,f.identity,{},f.consents),{logger:false,abortOnError:false})
 app.use(identityHeaders);app.useGlobalFilters(new IdentityErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close());const origin=await app.getUrl()
 const auth=a=>({Cookie:'xijie_dev_session='+a.proof,'X-Xijie-Expected-Session':a.id})
 const submit=(body,key=randomUUID())=>fetch(origin+'/v1/accounts/me/consents',{method:'POST',headers:{...auth(actor),Origin:config.origin,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)})
 const accept=async(body,key)=>{const response=await submit(body,key);assert.equal(response.status,201);return(await response.json()).data}
 const read=async()=>{
  const response=await fetch(origin+'/v1/accounts/me/consents?limit=1',{headers:auth(actor)});assert.equal(response.status,200)
  const history=await response.json(),expected=(await f.consents.authorizations(actor.accountId)).worldActionProcessing
  assert.deepEqual(history.meta.worldActionProcessing,expected)
  for(const path of ['/internal/v1/session-context','/internal/v1/accounts/'+actor.accountId+'/context']){
   const response=await fetch(origin+path,{headers:{...auth(actor),Authorization:'Bearer '+token}});assert.equal(response.status,200)
   assert.deepEqual((await response.json()).data.worldActionProcessing,expected)
  }
  return expected
 }
 const grant=await f.input('person_world_actions','grant',0),key=randomUUID()
 assert.equal(grant.policyId,policyId);assert.equal(grant.version,2)
 assert.equal((await submit(grant,key)).status,403)
 await accept(await f.input('privacy_notice','acknowledge',0))
 const receipt=await accept(grant,key)
 assert.deepEqual(await accept(grant,key),receipt)
 assert.deepEqual(await read(),{allowed:true,authorizationVersion:1,historicalWorldEventsAllowed:true})
 let permissions=await f.consents.authorizations(actor.accountId)
 assert.equal(permissions.storyStorage.allowed,false);assert.equal(permissions.aiTextProcessing.allowed,false)
 assert.deepEqual((await f.consents.authorizations(other.accountId)).worldActionProcessing,{allowed:false,authorizationVersion:0})
 await accept(await f.input('private_story_storage','grant',0));await accept(await f.input('ai_text_processing','grant',0))
 await accept(await f.input('person_world_actions','revoke',1))
 assert.deepEqual(await read(),{allowed:false,authorizationVersion:2})
 assert.deepEqual(await accept(grant,key),receipt)
 assert.deepEqual(await read(),{allowed:false,authorizationVersion:2})
 permissions=await f.consents.authorizations(actor.accountId);assert.equal(permissions.storyStorage.allowed,true);assert.equal(permissions.aiTextProcessing.allowed,true)
 await accept(await f.input('person_world_actions','grant',2))
 assert.deepEqual(await read(),{allowed:true,authorizationVersion:3,historicalWorldEventsAllowed:true})
 await accept(await f.input('privacy_notice','acknowledge',1))
 assert.deepEqual(await read(),{allowed:false,authorizationVersion:3})
 assert.deepEqual(await accept(grant,key),receipt);assert.deepEqual(await read(),{allowed:false,authorizationVersion:3})
 await accept(await f.input('person_world_actions','grant',3))
 assert.deepEqual(await read(),{allowed:true,authorizationVersion:4,historicalWorldEventsAllowed:true})
 permissions=await f.consents.authorizations(actor.accountId);assert.equal(permissions.storyStorage.allowed,false);assert.equal(permissions.aiTextProcessing.allowed,false)
 const bindings=(await f.pool.query("SELECT authorization_version,notice_authorization_version FROM consent_events WHERE account_id=$1 AND purpose='person_world_actions' ORDER BY authorization_version",[actor.accountId])).rows
 assert.deepEqual(bindings,[{authorization_version:1,notice_authorization_version:1},{authorization_version:2,notice_authorization_version:null},{authorization_version:3,notice_authorization_version:1},{authorization_version:4,notice_authorization_version:2}])
 assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM outbox_events WHERE account_id=$1 AND type='WorldActionProcessingRevoked.v1'",[actor.accountId])).rows[0].n,1)
 const policies=(await(await fetch(origin+'/v1/policies/current?locale=en')).json()).data,p=policies.find(row=>row.kind==='person_world_actions')
 assert.equal(p.id,policyId);assert.equal(p.version,2)
 for(const locale of ['zh-CN','en']){
  const response=await fetch(origin+'/v1/policies/'+policyId+'/2?locale='+locale);assert.equal(response.status,200)
  const doc=await response.text();assert.match(doc,/OpenAI/);assert.match(doc,/store:false/)
  if(locale==='en'){
   assert.match(doc,/same account, same character and main branch/);assert.match(doc,/across worlds and migration stages/)
   assert.match(doc,/current world remains the only execution scene/);assert.match(doc,/never revives old tasks/)
   assert.match(doc,/no photos, visual replies, letters or gathering history/)
  }else{
   assert.match(doc,/同一账号、同一人物、main 主线/);assert.match(doc,/来源仍有效/)
   assert.match(doc,/当前世界仍是唯一执行场景/);assert.match(doc,/离线自动生活/)
  }
 }
})

test('historical capability is default false and purpose scoped, never inferred from a later version number',async t=>{
 const f=await fixture(t);await f.pool.query(await migration());const actor=await f.login()
 await f.decide(actor,'privacy_notice','acknowledge',0);await f.decide(actor,'person_world_actions','grant',0)
 const policy=(await f.pool.query('SELECT * FROM policy_versions WHERE id=$1',[policyId])).rows[0]
 await f.pool.query("INSERT INTO policy_versions(id,kind,version,document_zh_cn,document_en) VALUES($1,'person_world_actions',3,'Synthetic later scope without historical capability','Synthetic later scope without historical capability')",[randomUUID()])
 assert.deepEqual((await f.consents.authorizations(actor.accountId)).worldActionProcessing,{allowed:false,authorizationVersion:1})
 await f.decide(actor,'person_world_actions','grant',1)
 assert.deepEqual((await f.consents.authorizations(actor.accountId)).worldActionProcessing,{allowed:true,authorizationVersion:2})
 assert.equal((await f.pool.query("SELECT world_event_history_enabled FROM policy_versions WHERE kind='person_world_actions' AND version=3")).rows[0].world_event_history_enabled,false)
 assert.deepEqual((await f.pool.query('SELECT * FROM policy_versions WHERE id=$1',[policyId])).rows[0],policy)
 for(const purpose of ['privacy_notice','private_story_storage','ai_text_processing','person_gather_replies'])await assert.rejects(f.pool.query("INSERT INTO policy_versions(id,kind,version,document_zh_cn,document_en,world_event_history_enabled) VALUES($1,$2,100,'Synthetic invalid capability','Synthetic invalid capability',true)",[randomUUID(),purpose]),{code:'23514'})
 await assert.rejects(f.pool.query("INSERT INTO policy_versions(id,kind,version,document_zh_cn,document_en,world_event_history_enabled) VALUES($1,'person_world_actions',4,'Synthetic null flag','Synthetic null flag',null)",[randomUUID()]),{code:'23502'})
})
