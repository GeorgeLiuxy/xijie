import 'reflect-metadata'
import assert from 'node:assert/strict'
import {randomUUID,randomBytes,createHash} from 'node:crypto'
import {readFile,readdir} from 'node:fs/promises'
import {test} from 'node:test'
import pg from 'pg'
import {IdentityStore} from '../dist/store.js'
import {ConsentStore} from '../dist/consent-store.js'
import {RightsStore,RightsError,digest} from '../dist/rights.js'
import {RightsEngine} from '../dist/rights-engine.js'
import {RightsDependencies} from '../dist/rights-provider.js'
import {RightsQueue} from '../dist/rights-queue.js'
import {IdentityModule,IdentityErrors,identityHeaders} from '../dist/http.js'
import {ModelExecutionStore} from '../dist/model-execution.js'
import {NestFactory} from '@nestjs/core'
import {captureSecurityReplay,replaySecurity} from '../../../../deploy/recovery/security-replay.mjs'
import {capture as recoveryCapture,quarantine} from '../../../../deploy/recovery/policy.mjs'
const connectionString=process.env.XIJIE_TEST_DATABASE_URL
if(!connectionString)throw new Error('Set XIJIE_TEST_DATABASE_URL to an isolated integration fixture')
const sha=value=>createHash('sha256').update(value).digest('hex')
async function fixture(t){
 const schema='rights_test_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString});await admin.query('CREATE SCHEMA '+schema)
 const pool=new pg.Pool({connectionString,options:'-c search_path='+schema});for(const file of (await readdir(new URL('../db/',import.meta.url))).filter(f=>/^\d+_.+\.sql$/.test(f)).sort())await pool.query(await readFile(new URL('../db/'+file,import.meta.url),'utf8'))
 t.after(async()=>{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()})
 const identity=new IdentityStore(pool),dispatches=[],queue={async send(_db,value){dispatches.push(value)}}
 const config={enabled:true,serviceToken:'a'.repeat(64),encryptionKey:randomBytes(32),queueSchema:'identity_rights_queue',peopleUrl:new URL('http://127.0.0.1:3102'),conversationsUrl:new URL('http://127.0.0.1:3103'),memoriesUrl:new URL('http://127.0.0.1:3104'),deleteProviderUsers:true,managementClientId:'fixture',managementClientSecret:'fixture-secret',managementResource:'https://default.logto.app/api',issuer:new URL('https://id.example.test/oidc')}
 const store=new RightsStore(pool,identity,config,queue)
 async function login(subject='fixture-a',browser=randomUUID(),session=null,purpose='sign_in'){
  const id=randomUUID(),claimId=randomUUID(),stateHash=randomUUID(),proof=randomBytes(32).toString('base64url')
  await identity.begin({id,browserHash:browser,key:randomUUID(),purpose,sessionHash:session?sha(session):null,stateHash,nonce:randomUUID(),verifier:randomUUID(),authorizationUrl:'https://id.example.test/oidc/auth',expiresAt:new Date(Date.now()+60000)})
  await identity.claim({browserHash:browser,stateHash,claimId})
  assert.equal(await identity.finish({browserHash:browser,attemptId:id,claimId,principal:{issuer:config.issuer.href,subject,authenticatedAt:new Date()},sessionHash:sha(proof)}),true)
  const current=await identity.current(sha(session??proof));return {...current,proof:session??proof,browser,hash:sha(session??proof)}
 }
 const recent=actor=>pool.query('UPDATE app_sessions SET reauthenticated_at=clock_timestamp() WHERE id=$1',[actor.id])
 const snapshots=[];let counter=0,providerFail=false;const erasures=[]
 const dependencies={async snapshot(domain,row){return {schemaVersion:1,domain,accountId:row.account_id,capturedAt:new Date().toISOString(),revision:digest(domain+counter),data:{fixture:domain}}},async erase(domain,row){erasures.push([domain,row.id]);return {erasedAt:new Date().toISOString()}},async deleteProviderIdentity(){if(providerFail)throw new RightsError(503,'IDENTITY_PROVIDER_DELETE_FAILED')}}
 const engine=new RightsEngine(store,dependencies)
 return {pool,identity,store,queue,dispatches,login,recent,config,engine,erasures,dependencies,setRevision(){counter++},providerFailure(value){providerFail=value}}
}

test('chat-photo and image-reply provenance exports after both withdrawals and erases without renewed permission',async t=>{
 const f=await fixture(t),actor=await f.login(),consents=new ConsentStore(f.pool,f.identity)
 const decide=async(purpose,decision,expectedAuthorizationVersion)=>{const p=(await consents.policies('en')).find(p=>p.kind===purpose);return consents.record(actor.hash,actor.id,randomUUID(),randomUUID(),{policyId:p.id,version:p.version,purpose,decision,expectedAuthorizationVersion})}
 await decide('privacy_notice','acknowledge',0)
 for(const purpose of ['private_chat_photo_storage','person_chat_image_replies'])await decide(purpose,'grant',0)
 const before=await f.store.ownSnapshot(actor.accountId,'account_data')
 for(const purpose of ['private_chat_photo_storage','person_chat_image_replies'])await decide(purpose,'revoke',1)
 const after=await f.store.ownSnapshot(actor.accountId,'account_data');assert.notEqual(before.revision,after.revision)
 const letterConsents=after.data.consents.filter(row=>['private_chat_photo_storage','person_chat_image_replies'].includes(row.purpose))
 assert.equal(letterConsents.length,4)
 for(const purpose of ['private_chat_photo_storage','person_chat_image_replies']){
  assert.deepEqual(letterConsents.filter(row=>row.purpose===purpose).map(row=>[row.decision,row.authorization_version,row.noticeAuthorizationVersion]),[['grant',1,1],['revoke',2,null]])
 }
 await f.recent(actor)
 const request=await f.store.create(actor.hash,actor.id,randomUUID(),{kind:'export',scope:'account_data'},randomUUID());await f.engine.run(f.dispatches[0]);const row=await f.store.row(request.id);assert.equal(row.status,'completed')
 const snapshots=()=>f.engine.snapshots(row),grant=await f.store.download(actor.hash,actor.id,row.id,snapshots,randomUUID()),gid=new URL(grant.downloadUrl,'https://fixture').searchParams.get('grant')
 const archive=JSON.parse((await f.store.content(actor.hash,actor.id,row.id,gid,snapshots)).toString()),own=archive.domains.find(domain=>domain.domain==='identity')
 assert.deepEqual(own.data.consents.filter(value=>['private_chat_photo_storage','person_chat_image_replies'].includes(value.purpose)),JSON.parse(JSON.stringify(letterConsents)))
 assert.equal(own.revision,digest(JSON.stringify(own.data)))
 const deletion=await f.store.create(actor.hash,actor.id,randomUUID(),{kind:'delete_account',scope:'account_data',deletionReceiptId:randomUUID(),statusProof:randomBytes(32).toString('base64url')},randomUUID());await f.engine.run(f.dispatches[1]);assert.equal((await f.store.row(deletion.id)).status,'completed')
 for(const table of ['consent_events','current_consents'])assert.equal((await f.pool.query('SELECT count(*)::int n FROM '+table+' WHERE account_id=$1',[actor.accountId])).rows[0].n,0)
})

test('normalized model usage is service-scoped, exported without operational secrets, and erased with its account',async t=>{
 const f=await fixture(t),actor=await f.login(),other=await f.login('meter-other')
 const consents=new ConsentStore(f.pool,f.identity),models=new ModelExecutionStore(f.pool,consents)
 const token='a'.repeat(64),otherToken='b'.repeat(64),config={secure:false,origin:'http://localhost:5184',clientSecret:randomUUID(),conversationsServiceToken:token,giftsServiceToken:otherToken}
 const app=await NestFactory.create(IdentityModule.register(config,f.identity,{},consents,undefined,f.store,undefined,models),{logger:false,abortOnError:false})
 app.use(identityHeaders);app.useGlobalFilters(new IdentityErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close())
 const origin=await app.getUrl(),attempt=randomUUID(),job=randomUUID()
 await f.pool.query("INSERT INTO model_executions(id,account_id,job_id,service,purpose,authorizations,lease_until) VALUES($1,$2,$3,'conversations','text_reply',$4,clock_timestamp()+interval '45 seconds')",[attempt,actor.accountId,job,JSON.stringify({privateMarker:'never export internal authorization snapshots'})])
 const meter={provider:'openai',model:'gpt-5-mini',resolvedModel:'gpt-5-mini-2025-08-07',state:'returned',elapsedMs:77,inputTokens:91,outputTokens:14,cachedInputTokens:0}
 const finish=(credential,body)=>fetch(origin+'/internal/v1/model-executions/'+attempt+'/finish',{method:'POST',headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json'},body:JSON.stringify(body)})
 assert.equal((await finish(otherToken,{succeeded:true,usage:meter})).status,404)
 assert.equal((await finish(token,{succeeded:true,usage:{...meter,prompt:'secret'}})).status,400)
 assert.equal((await finish(token,{succeeded:true,usage:{...meter,cachedInputTokens:999}})).status,400)
 assert.equal((await finish(token,{succeeded:true,usage:{...meter,state:'failed'}})).status,400)
 const result=await finish(token,{succeeded:true,usage:meter});assert.equal(result.status,200);assert.deepEqual((await result.json()).data,{allowed:false})
 assert.deepEqual((await f.store.ownSnapshot(other.accountId,'account_data')).data.modelUsage,[])
 await f.recent(actor)
 const request=await f.store.create(actor.hash,actor.id,randomUUID(),{kind:'export',scope:'account_data'},randomUUID())
 await f.engine.run(f.dispatches[0]);const row=await f.store.row(request.id);assert.equal(row.status,'completed')
 const snapshots=()=>f.engine.snapshots(row),grant=await f.store.download(actor.hash,actor.id,row.id,snapshots,randomUUID()),gid=new URL(grant.downloadUrl,'https://fixture').searchParams.get('grant')
 const archived=JSON.parse((await f.store.content(actor.hash,actor.id,row.id,gid,snapshots)).toString()).domains.find(domain=>domain.domain==='identity').data.modelUsage
 assert.equal(archived.length,1)
 assert.deepEqual({service:archived[0].service,purpose:archived[0].purpose,result_allowed:archived[0].result_allowed,usage:archived[0].usage},{service:'conversations',purpose:'text_reply',result_allowed:false,usage:meter})
 assert.deepEqual(Object.keys(archived[0]).sort(),['claimed_at','finished_at','purpose','result_allowed','service','usage'])
 const deletion=await f.store.create(actor.hash,actor.id,randomUUID(),{kind:'delete_account',scope:'account_data',deletionReceiptId:randomUUID(),statusProof:randomBytes(32).toString('base64url')},randomUUID())
 await f.engine.run(f.dispatches[1]);assert.equal((await f.store.row(deletion.id)).status,'completed')
 assert.equal((await f.pool.query('SELECT 1 FROM model_executions WHERE id=$1',[attempt])).rowCount,0)
 assert.equal((await finish(token,{succeeded:true,usage:meter})).status,404)
})

test('letter consent provenance exports after both withdrawals and erases without renewed permission',async t=>{
 const f=await fixture(t),actor=await f.login(),consents=new ConsentStore(f.pool,f.identity)
 const decide=async(purpose,decision,expectedAuthorizationVersion)=>{const p=(await consents.policies('en')).find(p=>p.kind===purpose);return consents.record(actor.hash,actor.id,randomUUID(),randomUUID(),{policyId:p.id,version:p.version,purpose,decision,expectedAuthorizationVersion})}
 await decide('privacy_notice','acknowledge',0)
 for(const purpose of ['private_letter_storage','person_letter_replies'])await decide(purpose,'grant',0)
 const before=await f.store.ownSnapshot(actor.accountId,'account_data')
 for(const purpose of ['private_letter_storage','person_letter_replies'])await decide(purpose,'revoke',1)
 const after=await f.store.ownSnapshot(actor.accountId,'account_data');assert.notEqual(before.revision,after.revision)
 const letterConsents=after.data.consents.filter(row=>['private_letter_storage','person_letter_replies'].includes(row.purpose))
 assert.equal(letterConsents.length,4)
 for(const purpose of ['private_letter_storage','person_letter_replies']){
  assert.deepEqual(letterConsents.filter(row=>row.purpose===purpose).map(row=>[row.decision,row.authorization_version,row.noticeAuthorizationVersion]),[['grant',1,1],['revoke',2,null]])
 }
 await f.recent(actor)
 const request=await f.store.create(actor.hash,actor.id,randomUUID(),{kind:'export',scope:'account_data'},randomUUID());await f.engine.run(f.dispatches[0]);const row=await f.store.row(request.id);assert.equal(row.status,'completed')
 const snapshots=()=>f.engine.snapshots(row),grant=await f.store.download(actor.hash,actor.id,row.id,snapshots,randomUUID()),gid=new URL(grant.downloadUrl,'https://fixture').searchParams.get('grant')
 const archive=JSON.parse((await f.store.content(actor.hash,actor.id,row.id,gid,snapshots)).toString()),own=archive.domains.find(domain=>domain.domain==='identity')
 assert.deepEqual(own.data.consents.filter(value=>['private_letter_storage','person_letter_replies'].includes(value.purpose)),JSON.parse(JSON.stringify(letterConsents)))
 assert.equal(own.revision,digest(JSON.stringify(own.data)))
 const deletion=await f.store.create(actor.hash,actor.id,randomUUID(),{kind:'delete_account',scope:'account_data',deletionReceiptId:randomUUID(),statusProof:randomBytes(32).toString('base64url')},randomUUID());await f.engine.run(f.dispatches[1]);assert.equal((await f.store.row(deletion.id)).status,'completed')
 for(const table of ['consent_events','current_consents'])assert.equal((await f.pool.query('SELECT count(*)::int n FROM '+table+' WHERE account_id=$1',[actor.accountId])).rows[0].n,0)
})

test('gather grant provenance remains exportable and erasable after withdrawing gathering, text storage and old AI',async t=>{
 const f=await fixture(t),actor=await f.login(),other=await f.login('gather-other'),consents=new ConsentStore(f.pool,f.identity)
 const decide=async(a,purpose,decision,expectedAuthorizationVersion)=>{const p=(await consents.policies('en')).find(p=>p.kind===purpose);return consents.record(a.hash,a.id,randomUUID(),randomUUID(),{policyId:p.id,version:p.version,purpose,decision,expectedAuthorizationVersion})}
 await decide(actor,'privacy_notice','acknowledge',0);await decide(other,'privacy_notice','acknowledge',0);await decide(other,'person_gather_replies','grant',0)
 for(const purpose of ['private_story_storage','ai_text_processing','person_gather_replies'])await decide(actor,purpose,'grant',0)
 const before=await f.store.ownSnapshot(actor.accountId,'account_data')
 for(const purpose of ['person_gather_replies','ai_text_processing','private_story_storage'])await decide(actor,purpose,'revoke',1)
 const current=await consents.authorizations(actor.accountId);assert.equal(current.gatherReplies.allowed,false);assert.equal(current.storyStorage.allowed,false);assert.equal(current.aiTextProcessing.allowed,false)
 const after=await f.store.ownSnapshot(actor.accountId,'account_data');assert.notEqual(after.revision,before.revision)
 const events=after.data.consents.filter(row=>row.purpose==='person_gather_replies')
 assert.deepEqual(events.map(row=>[row.decision,row.authorization_version,row.noticeAuthorizationVersion]),[['grant',1,1],['revoke',2,null]])
 await f.recent(actor)
 const request=await f.store.create(actor.hash,actor.id,randomUUID(),{kind:'export',scope:'account_data'},randomUUID());await f.engine.run(f.dispatches[0])
 const row=await f.store.row(request.id);assert.equal(row.status,'completed')
 const snapshots=()=>f.engine.snapshots(row),grant=await f.store.download(actor.hash,actor.id,row.id,snapshots,randomUUID()),gid=new URL(grant.downloadUrl,'https://fixture').searchParams.get('grant')
 const archive=JSON.parse((await f.store.content(actor.hash,actor.id,row.id,gid,snapshots)).toString()),own=archive.domains.find(domain=>domain.domain==='identity')
 assert.deepEqual(own.data.consents.filter(value=>value.purpose==='person_gather_replies'),JSON.parse(JSON.stringify(events)))
 assert.equal(own.revision,digest(JSON.stringify(own.data)))
 const deletion=await f.store.create(actor.hash,actor.id,randomUUID(),{kind:'delete_account',scope:'account_data',deletionReceiptId:randomUUID(),statusProof:randomBytes(32).toString('base64url')},randomUUID());await f.engine.run(f.dispatches[1]);assert.equal((await f.store.row(deletion.id)).status,'completed')
 for(const table of ['consent_events','current_consents'])assert.equal((await f.pool.query('SELECT count(*)::int n FROM '+table+' WHERE account_id=$1',[actor.accountId])).rows[0].n,0)
 assert.deepEqual((await consents.authorizations(other.accountId)).gatherReplies,{allowed:true,authorizationVersion:1})
})

test('world-action grant provenance remains exportable and erasable after withdrawing world action processing, text storage and old AI',async t=>{
 const f=await fixture(t),actor=await f.login(),other=await f.login('world-action-other'),consents=new ConsentStore(f.pool,f.identity)
 const decide=async(a,purpose,decision,expectedAuthorizationVersion)=>{const p=(await consents.policies('en')).find(p=>p.kind===purpose);return consents.record(a.hash,a.id,randomUUID(),randomUUID(),{policyId:p.id,version:p.version,purpose,decision,expectedAuthorizationVersion})}
 await decide(actor,'privacy_notice','acknowledge',0);await decide(other,'privacy_notice','acknowledge',0);await decide(other,'person_world_actions','grant',0)
 for(const purpose of ['private_story_storage','ai_text_processing','person_world_actions'])await decide(actor,purpose,'grant',0)
 const before=await f.store.ownSnapshot(actor.accountId,'account_data')
 for(const purpose of ['person_world_actions','ai_text_processing','private_story_storage'])await decide(actor,purpose,'revoke',1)
 const current=await consents.authorizations(actor.accountId);assert.equal(current.worldActionProcessing.allowed,false);assert.equal(current.storyStorage.allowed,false);assert.equal(current.aiTextProcessing.allowed,false)
 const after=await f.store.ownSnapshot(actor.accountId,'account_data');assert.notEqual(after.revision,before.revision)
 const events=after.data.consents.filter(row=>row.purpose==='person_world_actions')
 assert.deepEqual(events.map(row=>[row.decision,row.authorization_version,row.noticeAuthorizationVersion]),[['grant',1,1],['revoke',2,null]])
 await f.recent(actor)
 const request=await f.store.create(actor.hash,actor.id,randomUUID(),{kind:'export',scope:'account_data'},randomUUID());await f.engine.run(f.dispatches[0])
 const row=await f.store.row(request.id);assert.equal(row.status,'completed')
 const snapshots=()=>f.engine.snapshots(row),grant=await f.store.download(actor.hash,actor.id,row.id,snapshots,randomUUID()),gid=new URL(grant.downloadUrl,'https://fixture').searchParams.get('grant')
 const archive=JSON.parse((await f.store.content(actor.hash,actor.id,row.id,gid,snapshots)).toString()),own=archive.domains.find(domain=>domain.domain==='identity')
 assert.deepEqual(own.data.consents.filter(value=>value.purpose==='person_world_actions'),JSON.parse(JSON.stringify(events)))
 assert.equal(own.revision,digest(JSON.stringify(own.data)))
 const deletion=await f.store.create(actor.hash,actor.id,randomUUID(),{kind:'delete_account',scope:'account_data',deletionReceiptId:randomUUID(),statusProof:randomBytes(32).toString('base64url')},randomUUID());await f.engine.run(f.dispatches[1]);assert.equal((await f.store.row(deletion.id)).status,'completed')
 for(const table of ['consent_events','current_consents'])assert.equal((await f.pool.query('SELECT count(*)::int n FROM '+table+' WHERE account_id=$1',[actor.accountId])).rows[0].n,0)
 assert.deepEqual((await consents.authorizations(other.accountId)).worldActionProcessing,{allowed:true,authorizationVersion:1,historicalWorldEventsAllowed:true})
})

test('same-account reauthentication preserves session and rejects other/unknown subjects without registration',async t=>{
 const f=await fixture(t),alice=await f.login(),before=(await f.pool.query('SELECT count(*)::int AS n FROM accounts')).rows[0].n
 const refreshed=await f.login('fixture-a',alice.browser,alice.proof,'reauthenticate');assert.equal(refreshed.id,alice.id);assert.ok(refreshed.reauthenticatedAt)
 for(const subject of ['fixture-b','unknown-subject']){
  const id=randomUUID(),stateHash=randomUUID(),claimId=randomUUID();await f.identity.begin({id,browserHash:alice.browser,key:randomUUID(),purpose:'reauthenticate',sessionHash:alice.hash,stateHash,nonce:randomUUID(),verifier:randomUUID(),authorizationUrl:'https://id.example.test/oidc/auth',expiresAt:new Date(Date.now()+60000)});await f.identity.claim({browserHash:alice.browser,stateHash,claimId})
  assert.equal(await f.identity.finish({browserHash:alice.browser,attemptId:id,claimId,principal:{issuer:f.config.issuer.href,subject,authenticatedAt:new Date()},sessionHash:sha(randomUUID())}),false)
 }
 assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM accounts')).rows[0].n,before);assert.equal((await f.identity.current(alice.hash)).id,alice.id)
})

test('account erasure removes bound password contexts, browser-only failed attempts and credential gates without touching another owner',async t=>{
 const f=await fixture(t),actor=await f.login('password-owned'),other=await f.login('password-unrelated'),ownedId=randomUUID(),otherId=randomUUID()
 for(const[a,id]of [[actor,ownedId],[other,otherId]]){
  await f.pool.query("INSERT INTO auth_password_challenges(id,browser_hash,idempotency_key,phone_hash,purpose,initiating_session_id,initiating_account_id,account_id,phase,context_cipher)VALUES($1,$2,$3,$4,'manage',$5,$6,$6,'verified','synthetic-encrypted-context')",[id,a.browser,randomUUID(),sha(a.browser),a.id,a.accountId])
  await f.pool.query("INSERT INTO auth_password_logins(id,browser_hash,idempotency_key,phone_hash,request_hash,phase)VALUES($1,$2,$3,$4,$5,'failed')",[randomUUID(),a.browser,randomUUID(),sha(a.browser),sha('request:'+a.browser)])
  await f.pool.query('INSERT INTO auth_credential_fences(issuer,subject,fenced_at,password_pending)VALUES($1,$2,clock_timestamp(),$3)',[f.config.issuer.href,a===actor?'password-owned':'password-unrelated',id])
  await f.pool.query('UPDATE accounts SET credential_fenced_at=clock_timestamp(),credential_password_pending=$2 WHERE id=$1',[a.accountId,id])
 }
 await f.pool.query("INSERT INTO auth_password_challenges(id,browser_hash,idempotency_key,phone_hash,purpose,phase,context_cipher)VALUES($1,$2,$3,$4,'reset','awaiting_code','synthetic-encrypted-anonymous')",[randomUUID(),actor.browser,randomUUID(),sha('anonymous')])
 const snapshot=JSON.stringify(await f.store.ownSnapshot(actor.accountId,'account_data'));assert(!snapshot.includes('context_cipher'));assert(!snapshot.includes('synthetic-encrypted'))
 await f.recent(actor);const request=await f.store.create(actor.hash,actor.id,randomUUID(),{kind:'delete_account',scope:'account_data',deletionReceiptId:randomUUID(),statusProof:randomBytes(32).toString('base64url')},randomUUID());await f.engine.run(f.dispatches[0]);assert.equal((await f.store.row(request.id)).status,'completed')
 for(const table of ['auth_password_challenges','auth_password_logins']){assert.equal((await f.pool.query('SELECT 1 FROM '+table+' WHERE browser_hash=$1',[actor.browser])).rowCount,0);assert.equal((await f.pool.query('SELECT 1 FROM '+table+' WHERE browser_hash=$1',[other.browser])).rowCount,1)}
 assert.equal((await f.pool.query("SELECT 1 FROM auth_credential_fences WHERE subject='password-owned'")).rowCount,0);assert.equal((await f.pool.query("SELECT 1 FROM auth_credential_fences WHERE subject='password-unrelated'")).rowCount,1)
 assert.deepEqual((await f.pool.query('SELECT credential_fenced_at,credential_password_pending FROM accounts WHERE id=$1',[actor.accountId])).rows[0],{credential_fenced_at:null,credential_password_pending:null});assert(await f.identity.current(other.hash))
})

test('rolling-upgrade recovery scrubs only completed deleted accounts and preserves active credentials even on a reused browser',async t=>{
 const f=await fixture(t),erased=await f.login('rolling-erased');await f.recent(erased)
 const request=await f.store.create(erased.hash,erased.id,randomUUID(),{kind:'delete_account',scope:'account_data',deletionReceiptId:randomUUID(),statusProof:randomBytes(32).toString('base64url')},randomUUID());await f.engine.run(f.dispatches[0]);assert.equal((await f.store.row(request.id)).status,'completed')
 const active=await f.login('rolling-active',erased.browser),erasedIdentity=(await f.pool.query('SELECT id FROM auth_identities WHERE account_id=$1',[erased.accountId])).rows[0].id,erasedAttempt=(await f.pool.query('SELECT auth_attempt_id FROM app_sessions WHERE id=$1',[erased.id])).rows[0].auth_attempt_id,activeAttempt=(await f.pool.query('SELECT auth_attempt_id FROM app_sessions WHERE id=$1',[active.id])).rows[0].auth_attempt_id
 // A prior worker can mark deletion complete while retaining fields/tables added by the new binary.
 for(const[a,subject,attempt,identity]of [[erased,'rolling-erased',erasedAttempt,erasedIdentity],[active,'rolling-active',activeAttempt,(await f.pool.query('SELECT id FROM auth_identities WHERE account_id=$1',[active.accountId])).rows[0].id]]){
  const op=randomUUID();await f.pool.query('UPDATE accounts SET credential_fenced_at=clock_timestamp(),credential_password_pending=$2 WHERE id=$1',[a.accountId,op])
  await f.pool.query('INSERT INTO auth_credential_fences(issuer,subject,fenced_at,password_pending)VALUES($1,$2,clock_timestamp(),$3)',[f.config.issuer.href,subject,op])
  await f.pool.query("INSERT INTO auth_password_challenges(id,browser_hash,idempotency_key,phone_hash,purpose,initiating_session_id,initiating_account_id,account_id,auth_identity_id,phase,context_cipher)VALUES($1,$2,$3,$4,'manage',$5,$6,$6,$7,'unknown','synthetic-legacy-private-context')",[op,a.browser,randomUUID(),sha(subject),a.id,a.accountId,identity])
  await f.pool.query("INSERT INTO auth_password_logins(id,browser_hash,idempotency_key,request_hash,phone_hash,phase,attempt_id,result_cipher)VALUES($1,$2,$3,$4,$4,'completed',$5,'synthetic-legacy-session-receipt')",[randomUUID(),a.browser,randomUUID(),sha(subject),attempt])
  await f.pool.query("INSERT INTO native_auth_handoffs(attempt_id,browser_hash,expected_session_id,request_fingerprint,verifier_hash,launch_hash,transport,expires_at)VALUES($1,$2,$3,$4,$4,$4,'wechat_sdk',clock_timestamp()+interval '1 minute')",[attempt,sha(a.browser),a.id,sha(subject)])
  await f.pool.query("INSERT INTO native_wechat_transactions(attempt_id,connector_id,app_id,sdk_state_hash,phase,private_cipher,expires_at)VALUES($1,'synthetic-native','wx0000000000000000',$2,'waiting_provider',$3,clock_timestamp()+interval '1 minute')",[attempt,sha(subject),Buffer.from('synthetic-legacy-provider-context')])
 }
 const anonymousId=randomUUID(),anonymousLoginId=randomUUID();await f.pool.query("INSERT INTO auth_password_challenges(id,browser_hash,idempotency_key,phone_hash,purpose,phase,context_cipher)VALUES($1,$2,$3,$4,'reset','awaiting_code','synthetic-current-anonymous-context')",[anonymousId,active.browser,randomUUID(),sha('active-anonymous')]);await f.pool.query("INSERT INTO auth_password_logins(id,browser_hash,idempotency_key,request_hash,phone_hash,phase)VALUES($1,$2,$3,$4,$4,'failed')",[anonymousLoginId,active.browser,randomUUID(),sha('active-anonymous-login')])
 const activeRows=async()=>({account:(await f.pool.query('SELECT * FROM accounts WHERE id=$1',[active.accountId])).rows,challenge:(await f.pool.query('SELECT * FROM auth_password_challenges WHERE account_id=$1 OR id=$2',[active.accountId,anonymousId])).rows,logins:(await f.pool.query('SELECT * FROM auth_password_logins WHERE attempt_id=$1 OR id=$2',[activeAttempt,anonymousLoginId])).rows,fence:(await f.pool.query("SELECT * FROM auth_credential_fences WHERE subject='rolling-active'")).rows,native:(await f.pool.query('SELECT * FROM native_auth_handoffs WHERE attempt_id=$1',[activeAttempt])).rows,sdk:(await f.pool.query('SELECT * FROM native_wechat_transactions WHERE attempt_id=$1',[activeAttempt])).rows})
 const beforeActive=await activeRows(),beforeAudit=(await f.pool.query('SELECT * FROM data_requests WHERE id=$1',[request.id])).rows,beforeReceipts=(await f.pool.query('SELECT * FROM data_request_receipts WHERE request_id=$1',[request.id])).rows,beforeDeleted=(await f.pool.query('SELECT status,version,deleted_at,display_name,locale FROM accounts WHERE id=$1',[erased.accountId])).rows
 await f.store.recover()
 assert.deepEqual((await f.pool.query('SELECT credential_fenced_at,credential_password_pending FROM accounts WHERE id=$1',[erased.accountId])).rows[0],{credential_fenced_at:null,credential_password_pending:null})
 for(const table of ['auth_password_challenges','auth_password_logins'])assert.equal((await f.pool.query('SELECT 1 FROM '+table+' WHERE '+(table==='auth_password_challenges'?'account_id':'attempt_id')+'=$1',[table==='auth_password_challenges'?erased.accountId:erasedAttempt])).rowCount,0)
 assert.equal((await f.pool.query("SELECT 1 FROM auth_credential_fences WHERE subject='rolling-erased'")).rowCount,0);for(const table of ['native_auth_handoffs','native_wechat_transactions'])assert.equal((await f.pool.query('SELECT 1 FROM '+table+' WHERE attempt_id=$1',[erasedAttempt])).rowCount,0)
 assert.deepEqual(await activeRows(),beforeActive);assert.deepEqual((await f.pool.query('SELECT * FROM data_requests WHERE id=$1',[request.id])).rows,beforeAudit);assert.deepEqual((await f.pool.query('SELECT * FROM data_request_receipts WHERE request_id=$1',[request.id])).rows,beforeReceipts);assert.deepEqual((await f.pool.query('SELECT status,version,deleted_at,display_name,locale FROM accounts WHERE id=$1',[erased.accountId])).rows,beforeDeleted);assert(await f.identity.current(active.hash))
 await f.store.recover();assert.deepEqual(await activeRows(),beforeActive)
 // The same periodic path also repairs a late old-worker write after an earlier recovery pass.
 await f.pool.query('UPDATE accounts SET credential_fenced_at=clock_timestamp() WHERE id=$1',[erased.accountId]);await f.store.recover();assert.equal((await f.pool.query('SELECT credential_fenced_at FROM accounts WHERE id=$1',[erased.accountId])).rows[0].credential_fenced_at,null)
})

test('requests require dedicated recent evidence, are scoped and idempotent, and exports are encrypted/session-bound/stale-aware',async t=>{
 const f=await fixture(t),a=await f.login(),b=await f.login('fixture-b'),key=randomUUID(),body={kind:'export',scope:'account_data'}
 await assert.rejects(f.store.create(a.hash,a.id,key,body,randomUUID()),e=>e.code==='REAUTHENTICATION_REQUIRED');await f.recent(a)
 const first=await f.store.create(a.hash,a.id,key,body,randomUUID()),again=await f.store.create(a.hash,a.id,key,body,randomUUID());assert.equal(first.id,again.id);assert.equal(f.dispatches.length,1)
 await assert.rejects(f.store.create(a.hash,a.id,key,{...body,scope:'interaction_data'},randomUUID()),e=>e.code==='IDEMPOTENCY_CONFLICT');await assert.rejects(f.store.get(b.accountId,first.id),e=>e.status===404)
 await f.engine.run(f.dispatches[0]);const row=await f.store.row(first.id);assert.equal(row.status,'completed')
 const artifact=await f.store.artifact(a.accountId,first.id);assert.ok(Buffer.isBuffer(artifact.ciphertext));assert.equal(artifact.ciphertext.includes(Buffer.from('fixture-a')),false)
 const snapshots=()=>f.engine.snapshots(row),downloadKey=randomUUID(),grant=await f.store.download(a.hash,a.id,first.id,snapshots,downloadKey),replay=await f.store.download(a.hash,a.id,first.id,snapshots,downloadKey);assert.deepEqual(replay,grant)
 const gid=new URL(grant.downloadUrl,'https://fixture').searchParams.get('grant'),data=JSON.parse((await f.store.content(a.hash,a.id,first.id,gid,snapshots)).toString());assert.equal(data.domains.length,4);assert.equal(data.scope,'account_data')
 await f.recent(b);await assert.rejects(f.store.content(b.hash,b.id,first.id,gid,snapshots),e=>e.status===404)
 await f.pool.query("UPDATE data_export_grants SET created_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[gid]);await assert.rejects(f.store.content(a.hash,a.id,first.id,gid,snapshots),e=>e.status===410&&e.code==='DOWNLOAD_GRANT_EXPIRED');await assert.rejects(f.store.content(b.hash,b.id,first.id,gid,snapshots),e=>e.status===404)
 const renewed=await f.store.download(a.hash,a.id,first.id,snapshots,randomUUID()),freshGid=new URL(renewed.downloadUrl,'https://fixture').searchParams.get('grant');assert.notEqual(freshGid,gid)
 f.setRevision();await assert.rejects(f.store.content(a.hash,a.id,first.id,freshGid,snapshots),e=>e.code==='EXPORT_STALE')
 await f.pool.query("UPDATE data_requests SET result_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[first.id]);await assert.rejects(f.store.download(a.hash,a.id,first.id,snapshots,randomUUID()),e=>e.status===410&&e.code==='EXPORT_EXPIRED')
 await f.pool.query("UPDATE app_sessions SET reauthenticated_at=clock_timestamp()-interval '11 minutes' WHERE id=$1",[a.id]);await assert.rejects(f.store.download(a.hash,a.id,first.id,snapshots,randomUUID()),e=>e.code==='REAUTHENTICATION_REQUIRED')
})

test('accepted deletion freezes both sessions immediately, records progress, retries provider failure and scrubs identity without resurrection',async t=>{
 const f=await fixture(t),a=await f.login(),other=await f.login('fixture-a');await f.recent(a)
 const receiptId=randomUUID(),proof=randomBytes(32).toString('base64url'),r=await f.store.create(a.hash,a.id,randomUUID(),{kind:'delete_account',scope:'account_data',deletionReceiptId:receiptId,statusProof:proof},randomUUID())
 assert.equal(await f.identity.current(a.hash),null);assert.equal(await f.identity.current(other.hash),null);assert.equal(await f.identity.accountContext(a.accountId),null)
 const internal=await f.store.context(r.id);assert.equal(internal.accountStatus,'deletion_pending');assert.equal((await f.store.readReceipt(receiptId,proof)).id,r.id);await assert.rejects(f.store.readReceipt(receiptId,randomBytes(32).toString('base64url')),e=>e.status===404)
 f.providerFailure(true);await f.engine.run(f.dispatches[0]);assert.equal((await f.store.row(r.id)).status,'failed');assert.equal(f.erasures.length,3);assert.equal((await f.pool.query('SELECT status FROM accounts WHERE id=$1',[a.accountId])).rows[0].status,'deletion_pending')
 f.providerFailure(false);const retry=await f.store.retryReceipt(receiptId,proof,randomUUID());assert.equal(retry.id,r.id);await f.engine.run(f.dispatches[1]);assert.equal(f.erasures.length,3);assert.equal((await f.store.readReceipt(receiptId,proof)).status,'completed')
 const account=(await f.pool.query('SELECT status,display_name,deleted_at FROM accounts WHERE id=$1',[a.accountId])).rows[0];assert.equal(account.status,'deleted');assert.equal(account.display_name,'');assert.ok(account.deleted_at)
 assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM consent_events WHERE account_id=$1',[a.accountId])).rows[0].n,0)
 const id=randomUUID(),browser=randomUUID(),claimId=randomUUID(),stateHash=randomUUID();await f.identity.begin({id,browserHash:browser,key:randomUUID(),purpose:'sign_in',sessionHash:null,stateHash,nonce:randomUUID(),verifier:randomUUID(),authorizationUrl:'https://id.example.test/oidc/auth',expiresAt:new Date(Date.now()+60000)});await f.identity.claim({browserHash:browser,stateHash,claimId});assert.equal(await f.identity.finish({browserHash:browser,attemptId:id,claimId,principal:{issuer:f.config.issuer.href,subject:'fixture-a',authenticatedAt:new Date()},sessionHash:sha(randomUUID())}),false)
})

test('lease recovery fences stale attempts and uses a fresh physical dispatch',async t=>{
 const f=await fixture(t),a=await f.login();await f.recent(a);await f.store.create(a.hash,a.id,randomUUID(),{kind:'export',scope:'interaction_data'},randomUUID());const old=await f.store.claim(f.dispatches[0]);assert.ok(old)
 await f.pool.query("UPDATE data_requests SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[old.id]);await f.store.recover();assert.equal(f.dispatches.length,2);assert.notEqual(f.dispatches[0].dispatchId,f.dispatches[1].dispatchId);await assert.rejects(f.store.exportComplete(old,[]),e=>e.code==='ATTEMPT_EXPIRED');await f.engine.run(f.dispatches[1]);assert.equal((await f.store.row(old.id)).status,'completed')
})

test('Nest public and internal data-rights endpoints enforce origin, exact session, receipt proof and server scope',async t=>{
 const f=await fixture(t),a=await f.login();await f.recent(a);const token='b'.repeat(64),socialToken='c'.repeat(64),config={secure:false,origin:'http://localhost:5184',clientSecret:randomUUID(),peopleServiceToken:token,socialServiceToken:socialToken}
 const app=await NestFactory.create(IdentityModule.register(config,f.identity,{},new ConsentStore(f.pool,f.identity),undefined,f.store),{logger:false,abortOnError:false});app.use(identityHeaders);app.useGlobalFilters(new IdentityErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close());const origin=await app.getUrl(),headers={Cookie:'xijie_dev_session='+a.proof,'X-Xijie-Expected-Session':a.id,Origin:config.origin,'Idempotency-Key':randomUUID(),'Content-Type':'application/json'}
 const create=await fetch(origin+'/v1/accounts/me/data-requests',{method:'POST',headers,body:JSON.stringify({kind:'export',scope:'account_data'})});assert.equal(create.status,202);const row=(await create.json()).data;assert.ok(row.updatedAt)
 assert.equal((await fetch(origin+'/v1/accounts/me/data-requests?limit=10',{headers})).status,200)
 assert.equal((await fetch(origin+'/v1/accounts/me/data-requests',{method:'POST',headers:{...headers,Origin:'https://evil.invalid'},body:JSON.stringify({kind:'delete_account'})})).status,403)
 assert.equal((await fetch(origin+'/v1/accounts/me/data-requests/'+row.id,{headers:{...headers,'X-Xijie-Expected-Session':randomUUID()}})).status,401)
 const internal=await fetch(origin+'/internal/v1/data-requests/'+row.id+'/context',{headers:{Authorization:'Bearer '+token}});assert.equal(internal.status,200);assert.equal((await internal.json()).data.accountId,a.accountId)
 const socialInternal=await fetch(origin+'/internal/v1/data-requests/'+row.id+'/context',{headers:{Authorization:'Bearer '+socialToken}});assert.equal(socialInternal.status,200);assert.equal((await socialInternal.json()).data.accountId,a.accountId)
 assert.equal((await fetch(origin+'/internal/v1/session-context',{headers:{Cookie:headers.Cookie,Authorization:'Bearer '+socialToken}})).status,200)
 assert.equal((await fetch(origin+'/internal/v1/accounts/'+a.accountId+'/context',{headers:{Authorization:'Bearer '+socialToken}})).status,200)
 assert.equal((await fetch(origin+'/v1/accounts/me/consents',{method:'POST',headers:{Origin:config.origin,Authorization:'Bearer '+socialToken,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:'{}'})).status,401)
 config.socialServiceToken=null;assert.equal((await fetch(origin+'/internal/v1/data-requests/'+row.id+'/context',{headers:{Authorization:'Bearer '+socialToken}})).status,403)
 assert.equal((await fetch(origin+'/internal/v1/data-requests/'+row.id+'/context',{headers:{Authorization:'Bearer '+'0'.repeat(64)}})).status,403)
})

test('a configured Social source participates in all five export domains and its failure never produces an incomplete archive',async t=>{
 const f=await fixture(t),a=await f.login();await f.recent(a);f.config.socialUrl=new URL('http://127.0.0.1:3105')
 let socialUnavailable=false;const domains=[]
 const dependencies=new RightsDependencies(f.config,async url=>{
  const domain=({3102:'people',3103:'conversations',3104:'memories',3105:'social'})[url.port];domains.push(domain)
  if(domain==='social'&&socialUnavailable)return new Response(null,{status:503})
  const data={posts:domain==='social'?[{id:randomUUID(),body:'Synthetic private post'}]:[]}
  // A source keeps the same value across validation passes.
  if(domain==='social')data.posts=[{id:'01410000-0000-4000-8000-000000000001',body:'Synthetic private post'}]
  return Response.json({data:{schemaVersion:1,domain,accountId:a.accountId,capturedAt:new Date().toISOString(),revision:digest(JSON.stringify(data)),data}})
 })
 const engine=new RightsEngine(f.store,dependencies)
 const request=await f.store.create(a.hash,a.id,randomUUID(),{kind:'export',scope:'account_data'},randomUUID());await engine.run(f.dispatches[0])
 const row=await f.store.row(request.id);assert.equal(row.status,'completed');assert(domains.includes('social'))
 const snapshots=()=>engine.snapshots(row),grant=await f.store.download(a.hash,a.id,row.id,snapshots,randomUUID()),id=new URL(grant.downloadUrl,'https://fixture').searchParams.get('grant')
 const archive=JSON.parse((await f.store.content(a.hash,a.id,row.id,id,snapshots)).toString())
 assert.deepEqual(archive.domains.map(row=>row.domain),['identity','people','conversations','memories','social']);assert.equal(archive.domains.at(-1).data.posts.length,1)
 const omitted=await f.store.create(a.hash,a.id,randomUUID(),{kind:'export',scope:'account_data'},randomUUID()),running=await f.store.claim(f.dispatches.at(-1))
 await assert.rejects(f.store.exportComplete(running,(await engine.snapshots(running)).filter(snapshot=>snapshot.domain!=='social')),e=>e.code==='EXPORT_INCOMPLETE')
 assert.equal((await f.pool.query('SELECT 1 FROM data_exports WHERE request_id=$1',[omitted.id])).rowCount,0);await f.store.fail(running,'EXPORT_INCOMPLETE')
 socialUnavailable=true
 await assert.rejects(f.store.download(a.hash,a.id,row.id,snapshots,randomUUID()),e=>e.code==='DEPENDENCY_UNAVAILABLE')
 const failed=await f.store.create(a.hash,a.id,randomUUID(),{kind:'export',scope:'interaction_data'},randomUUID());await engine.run(f.dispatches.at(-1))
 assert.equal((await f.store.row(failed.id)).status,'failed');assert.equal((await f.store.row(failed.id)).failure_code,'DEPENDENCY_UNAVAILABLE')
 assert.equal((await f.pool.query('SELECT 1 FROM data_exports WHERE request_id=$1',[failed.id])).rowCount,0)
})

test('Social erasure is mandatory when configured, resumes independently, and older three-domain progress cannot complete deletion',async t=>{
 const f=await fixture(t),a=await f.login();await f.recent(a);f.config.socialUrl=new URL('http://127.0.0.1:3105')
 let socialUnavailable=true,providerCalls=0;const erased=[]
 const dependencies={async erase(domain,row){erased.push(domain);if(domain==='social'&&socialUnavailable)throw new RightsError(503,'DEPENDENCY_UNAVAILABLE');return {erasedAt:new Date().toISOString()}},async deleteProviderIdentity(){providerCalls++}}
 const engine=new RightsEngine(f.store,dependencies),receipt=randomUUID(),proof=randomBytes(32).toString('base64url')
 const request=await f.store.create(a.hash,a.id,randomUUID(),{kind:'delete_account',scope:'account_data',deletionReceiptId:receipt,statusProof:proof},randomUUID())
 await engine.run(f.dispatches[0]);const failed=await f.store.row(request.id)
 assert.equal(failed.status,'failed');assert.equal(failed.failure_code,'DEPENDENCY_UNAVAILABLE');assert.equal(providerCalls,0);assert.equal((await f.store.context(request.id)).accountStatus,'deletion_pending')
 assert.deepEqual(erased,['people','conversations','memories','social']);assert(!failed.progress.social)
 // Even a worker that incorrectly claims only the legacy domains completed cannot finalize.
 await f.store.retryReceipt(receipt,proof,randomUUID());const running=await f.store.claim(f.dispatches[1]);await f.store.progress(running,'provider',{deletedAt:new Date().toISOString()})
 await assert.rejects(f.store.deletionComplete(running),e=>e.code==='DELETION_INCOMPLETE')
 await f.store.fail(running,'DEPENDENCY_UNAVAILABLE')
 socialUnavailable=false;await f.store.retryReceipt(receipt,proof,randomUUID());await engine.run(f.dispatches.at(-1))
 assert.deepEqual(erased,['people','conversations','memories','social','social']);assert.equal((await f.store.row(request.id)).status,'completed');assert.equal((await f.pool.query('SELECT status FROM accounts WHERE id=$1',[a.accountId])).rows[0].status,'deleted')
})

test('configured photo bytes participate in all six export domains and byte changes invalidate an old download',async t=>{
 const f=await fixture(t),a=await f.login();await f.recent(a);f.config.socialUrl=new URL('http://127.0.0.1:3105');f.config.mediaUrl=new URL('http://127.0.0.1:3106')
 let content=Buffer.from('synthetic-publication-copy'),unavailable=false
 const dependencies=new RightsDependencies(f.config,async url=>{
  const domain=({3102:'people',3103:'conversations',3104:'memories',3105:'social',3106:'media'})[url.port]
  if(domain==='media'&&unavailable)return new Response(null,{status:503})
  const data=domain==='media'?{media:[{id:'01410000-0000-4000-8000-000000000002',sha256:sha(content),contentBase64:content.toString('base64')}]}:{}
  return Response.json({data:{schemaVersion:1,domain,accountId:a.accountId,capturedAt:new Date().toISOString(),revision:digest(JSON.stringify(data)),data}})
 })
 const engine=new RightsEngine(f.store,dependencies),request=await f.store.create(a.hash,a.id,randomUUID(),{kind:'export',scope:'account_data'},randomUUID());await engine.run(f.dispatches[0]);const row=await f.store.row(request.id);assert.equal(row.status,'completed')
 const snapshots=()=>engine.snapshots(row),grant=await f.store.download(a.hash,a.id,row.id,snapshots,randomUUID()),id=new URL(grant.downloadUrl,'https://fixture').searchParams.get('grant'),archive=JSON.parse((await f.store.content(a.hash,a.id,row.id,id,snapshots)).toString())
 assert.deepEqual(archive.domains.map(r=>r.domain),['identity','people','conversations','memories','social','media']);assert.deepEqual(Buffer.from(archive.domains.at(-1).data.media[0].contentBase64,'base64'),content)
 const missing=await f.store.create(a.hash,a.id,randomUUID(),{kind:'export',scope:'account_data'},randomUUID()),running=await f.store.claim(f.dispatches.at(-1));await assert.rejects(f.store.exportComplete(running,(await engine.snapshots(running)).filter(s=>s.domain!=='media')),e=>e.code==='EXPORT_INCOMPLETE');assert.equal((await f.pool.query('SELECT 1 FROM data_exports WHERE request_id=$1',[missing.id])).rowCount,0);await f.store.fail(running,'EXPORT_INCOMPLETE')
 content=Buffer.from('different-synthetic-publication-copy');await assert.rejects(f.store.content(a.hash,a.id,row.id,id,snapshots),e=>e.code==='EXPORT_STALE')
 unavailable=true;await assert.rejects(f.store.download(a.hash,a.id,row.id,snapshots,randomUUID()),e=>e.code==='DEPENDENCY_UNAVAILABLE')
})

test('account erasure waits for Media object cleanup and resumes without repeating completed domains',async t=>{
 const f=await fixture(t),a=await f.login();await f.recent(a);f.config.socialUrl=new URL('http://127.0.0.1:3105');f.config.mediaUrl=new URL('http://127.0.0.1:3106')
 let mediaFailed=true;const calls=[],dependencies={async erase(domain){calls.push(domain);if(domain==='media'&&mediaFailed)throw new RightsError(503,'DEPENDENCY_UNAVAILABLE');return {erasedAt:new Date().toISOString()}},async deleteProviderIdentity(){calls.push('provider')}}
 const receipt=randomUUID(),proof=randomBytes(32).toString('base64url'),request=await f.store.create(a.hash,a.id,randomUUID(),{kind:'delete_account',scope:'account_data',deletionReceiptId:receipt,statusProof:proof},randomUUID()),engine=new RightsEngine(f.store,dependencies)
 await engine.run(f.dispatches[0]);assert.equal((await f.store.row(request.id)).status,'failed');assert.equal((await f.store.context(request.id)).accountStatus,'deletion_pending');assert.deepEqual(calls,['people','conversations','memories','social','media'])
 await f.store.retryReceipt(receipt,proof,randomUUID());const running=await f.store.claim(f.dispatches.at(-1));await assert.rejects(f.store.deletionComplete(running),e=>e.code==='DELETION_INCOMPLETE');await f.store.fail(running,'DEPENDENCY_UNAVAILABLE')
 mediaFailed=false;await f.store.retryReceipt(receipt,proof,randomUUID());await engine.run(f.dispatches.at(-1));assert.equal((await f.store.row(request.id)).status,'completed');assert.deepEqual(calls,['people','conversations','memories','social','media','media','provider'])
})

test('configured Gifts joins all seven export domains and an unavailable or omitted ledger never completes an archive',async t=>{
 const f=await fixture(t),a=await f.login();await f.recent(a);f.config.socialUrl=new URL('http://127.0.0.1:3105');f.config.mediaUrl=new URL('http://127.0.0.1:3106');f.config.giftsUrl=new URL('http://127.0.0.1:3107')
 let giftsUnavailable=false;const seen=[]
 const dependencies=new RightsDependencies(f.config,async url=>{
  const domain=({3102:'people',3103:'conversations',3104:'memories',3105:'social',3106:'media',3107:'gifts'})[url.port];seen.push(domain)
  if(domain==='gifts'&&giftsUnavailable)return new Response(null,{status:503})
  const data=domain==='gifts'?{deliveries:[{id:'01410000-0000-4000-8000-000000000003',note:'Synthetic gift receipt'}],ledgerTransactions:[{reason:'trial_grant'}]}:{}
  return Response.json({data:{schemaVersion:1,domain,accountId:a.accountId,capturedAt:new Date().toISOString(),revision:digest(JSON.stringify(data)),data}})
 })
 const engine=new RightsEngine(f.store,dependencies),request=await f.store.create(a.hash,a.id,randomUUID(),{kind:'export',scope:'account_data'},randomUUID());await engine.run(f.dispatches[0]);const row=await f.store.row(request.id)
 assert.equal(row.status,'completed');assert(seen.includes('gifts'))
 const snapshots=()=>engine.snapshots(row),grant=await f.store.download(a.hash,a.id,row.id,snapshots,randomUUID()),id=new URL(grant.downloadUrl,'https://fixture').searchParams.get('grant'),archive=JSON.parse((await f.store.content(a.hash,a.id,row.id,id,snapshots)).toString())
 assert.deepEqual(archive.domains.map(r=>r.domain),['identity','people','conversations','memories','social','media','gifts']);assert.equal(archive.domains.at(-1).data.deliveries[0].note,'Synthetic gift receipt')
 const omitted=await f.store.create(a.hash,a.id,randomUUID(),{kind:'export',scope:'account_data'},randomUUID()),running=await f.store.claim(f.dispatches.at(-1))
 await assert.rejects(f.store.exportComplete(running,(await engine.snapshots(running)).filter(s=>s.domain!=='gifts')),e=>e.code==='EXPORT_INCOMPLETE');assert.equal((await f.pool.query('SELECT 1 FROM data_exports WHERE request_id=$1',[omitted.id])).rowCount,0);await f.store.fail(running,'EXPORT_INCOMPLETE')
 giftsUnavailable=true;await assert.rejects(f.store.download(a.hash,a.id,row.id,snapshots,randomUUID()),e=>e.code==='DEPENDENCY_UNAVAILABLE')
 const failed=await f.store.create(a.hash,a.id,randomUUID(),{kind:'export',scope:'interaction_data'},randomUUID());await engine.run(f.dispatches.at(-1));const failedRow=await f.store.row(failed.id)
 assert.equal(failedRow.status,'failed');assert.equal(failedRow.failure_code,'DEPENDENCY_UNAVAILABLE');assert.equal((await f.pool.query('SELECT 1 FROM data_exports WHERE request_id=$1',[failed.id])).rowCount,0)
})

test('configured Gifts erasure failure fences account completion and retries only its unfinished domain',async t=>{
 const f=await fixture(t),a=await f.login();await f.recent(a);f.config.socialUrl=new URL('http://127.0.0.1:3105');f.config.mediaUrl=new URL('http://127.0.0.1:3106');f.config.giftsUrl=new URL('http://127.0.0.1:3107')
 let giftsUnavailable=true;const calls=[],dependencies={async financialPreflight(){return{checkedAt:new Date().toISOString(),financialRetention:{status:'none'}}},async erase(domain){calls.push(domain);if(domain==='gifts'&&giftsUnavailable)throw new RightsError(503,'DEPENDENCY_UNAVAILABLE');return {erasedAt:new Date().toISOString()}},async deleteProviderIdentity(){calls.push('provider')}}
 const receipt=randomUUID(),proof=randomBytes(32).toString('base64url'),request=await f.store.create(a.hash,a.id,randomUUID(),{kind:'delete_account',scope:'account_data',deletionReceiptId:receipt,statusProof:proof},randomUUID()),engine=new RightsEngine(f.store,dependencies)
 await engine.run(f.dispatches[0]);const failed=await f.store.row(request.id)
 assert.equal(failed.status,'failed');assert.equal(failed.failure_code,'DEPENDENCY_UNAVAILABLE');assert.equal((await f.store.context(request.id)).accountStatus,'deletion_pending');assert.deepEqual(calls,['people','conversations','memories','social','media','gifts']);assert(!failed.progress.gifts)
 await f.store.retryReceipt(receipt,proof,randomUUID());const running=await f.store.claim(f.dispatches.at(-1));await f.store.progress(running,'provider',{deletedAt:new Date().toISOString()})
 await assert.rejects(f.store.deletionComplete(running),e=>e.code==='DELETION_INCOMPLETE');await f.store.fail(running,'DEPENDENCY_UNAVAILABLE')
 giftsUnavailable=false;await f.store.retryReceipt(receipt,proof,randomUUID());await engine.run(f.dispatches.at(-1))
 assert.equal((await f.store.row(request.id)).status,'completed');assert.equal((await f.pool.query('SELECT status FROM accounts WHERE id=$1',[a.accountId])).rows[0].status,'deleted');assert.deepEqual(calls,['people','conversations','memories','social','media','gifts','gifts'])
})

test('actual pg-boss dispatch is transactional, metadata-only and consumed by an independent role',async t=>{
 const f=await fixture(t),schema='rights_queue_'+randomUUID().replaceAll('-',''),queue=await new RightsQueue(connectionString,schema).start();t.after(async()=>{await queue.stop();const admin=new pg.Pool({connectionString});await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()});const store=new RightsStore(f.pool,f.identity,f.config,queue),engine=new RightsEngine(store,{async snapshot(domain,row){return {schemaVersion:1,domain,accountId:row.account_id,capturedAt:new Date().toISOString(),revision:digest(domain),data:{}}}}),a=await f.login();await f.recent(a)
 const request=await store.create(a.hash,a.id,randomUUID(),{kind:'export',scope:'interaction_data'},randomUUID());const jobs=await queue.boss.findJobs('data-rights.process.v1',{limit:10});assert.deepEqual(Object.keys(jobs[0].data).sort(),['dispatchGeneration','dispatchId','requestId']);await queue.work(value=>engine.run(value))
 const end=Date.now()+10000;while(Date.now()<end&&(await store.row(request.id)).status!=='completed')await new Promise(r=>setTimeout(r,50));assert.equal((await store.row(request.id)).status,'completed')
})

test('Logto Management adapter requires explicit ownership config and uses only configured tenant/official endpoints',async t=>{
 const f=await fixture(t),calls=[],dependencies=new RightsDependencies(f.config,async(url,init)=>{calls.push({url:String(url),...init});return String(url).endsWith('/oidc/token')?Response.json({access_token:'fixture-access-token',token_type:'Bearer'}):new Response(null,{status:204})})
 await dependencies.deleteProviderIdentity({issuer:f.config.issuer.href,subject:'fixture-user'});assert.equal(calls.length,2);assert.equal(calls[0].url,'https://id.example.test/oidc/token');assert.equal(calls[1].url,'https://id.example.test/api/users/fixture-user');assert.equal(calls[1].method,'DELETE');assert.equal(calls[1].redirect,'error');assert.match(calls[0].body.toString(),/resource=https%3A%2F%2Fdefault.logto.app%2Fapi/)
 await assert.rejects(dependencies.deleteProviderIdentity({issuer:'https://external.invalid/oidc',subject:'fixture-user'}),e=>e.code==='UNSUPPORTED_IDENTITY_PROVIDER');f.config.deleteProviderUsers=false;await assert.rejects(dependencies.deleteProviderIdentity({issuer:f.config.issuer.href,subject:'fixture-user'}),e=>e.code==='IDENTITY_PROVIDER_DELETE_NOT_CONFIGURED');assert.equal(calls.length,2)
})

test('deletion enqueue rollback leaves the account active and completion refuses missing domain progress',async t=>{
 const f=await fixture(t),a=await f.login();await f.recent(a)
 const broken=new RightsStore(f.pool,f.identity,f.config,{async send(){throw new Error('queue unavailable')}}),body={kind:'delete_account',scope:'account_data',deletionReceiptId:randomUUID(),statusProof:randomBytes(32).toString('base64url')}
 await assert.rejects(broken.create(a.hash,a.id,randomUUID(),body,randomUUID()),/queue unavailable/);assert.ok(await f.identity.current(a.hash));assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM data_requests')).rows[0].n,0)
 const accepted=await f.store.create(a.hash,a.id,randomUUID(),body,randomUUID()),running=await f.store.claim(f.dispatches[0]);await assert.rejects(f.store.deletionComplete(running),e=>e.code==='DELETION_INCOMPLETE');assert.equal((await f.store.context(accepted.id)).accountStatus,'deletion_pending')
})

test('accepted jobs whose physical queue dispatch has terminated become a recoverable failure',async t=>{
 const f=await fixture(t),schema='rights_lost_'+randomUUID().replaceAll('-',''),queue=await new RightsQueue(connectionString,schema).start();t.after(async()=>{await queue.stop();const admin=new pg.Pool({connectionString});await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()})
 const store=new RightsStore(f.pool,f.identity,f.config,queue),a=await f.login();await f.recent(a);const request=await store.create(a.hash,a.id,randomUUID(),{kind:'export',scope:'interaction_data'},randomUUID()),row=await store.row(request.id)
 await queue.boss.cancel('data-rights.process.v1',row.dispatch_id)
 await f.pool.query("UPDATE data_requests SET requested_at=clock_timestamp()-interval '5 minutes',updated_at=clock_timestamp()-interval '3 minutes' WHERE id=$1",[row.id]);await store.recover();const failed=await store.row(row.id);assert.equal(failed.status,'failed');assert.equal(failed.failure_code,'QUEUE_DISPATCH_LOST')
})

test('source adapter independently verifies returned content digests and enforces bounded streaming',async t=>{
 const f=await fixture(t),a=await f.login();await f.recent(a);const request=await f.store.create(a.hash,a.id,randomUUID(),{kind:'export',scope:'interaction_data'},randomUUID()),row=await f.store.row(request.id)
 const bad=new RightsDependencies(f.config,async()=>Response.json({data:{schemaVersion:1,domain:'people',accountId:a.accountId,capturedAt:new Date().toISOString(),revision:'0'.repeat(64),data:{changed:true}}}))
 await assert.rejects(bad.snapshot('people',row),e=>e.code==='DEPENDENCY_UNAVAILABLE')
 const oversized=new RightsDependencies(f.config,async()=>new Response(new ReadableStream({start(controller){for(let i=0;i<22;i++)controller.enqueue(new Uint8Array(1024*1024));controller.close()}})))
 await assert.rejects(oversized.snapshot('people',row),e=>e.code==='EXPORT_TOO_LARGE')
})

test('financial preflight blocks every domain erasure before private data is touched and retries recheck before continuing',async t=>{
 const f=await fixture(t),a=await f.login();await f.recent(a);f.config.giftsUrl=new URL('http://127.0.0.1:3107');let allowed=false,checks=0;f.dependencies.financialPreflight=async()=>{checks++;if(!allowed)throw new RightsError(409,'FINANCIAL_RETENTION_POLICY_REQUIRED');return{checkedAt:new Date().toISOString(),financialRetention:{status:'none'}}}
 const receipt=randomUUID(),proof=randomBytes(32).toString('base64url'),request=await f.store.create(a.hash,a.id,randomUUID(),{kind:'delete_account',scope:'account_data',deletionReceiptId:receipt,statusProof:proof},randomUUID());await f.engine.run(f.dispatches[0]);assert.equal((await f.store.row(request.id)).failure_code,'FINANCIAL_RETENTION_POLICY_REQUIRED');assert.equal(f.erasures.length,0);assert.equal((await f.pool.query('SELECT display_name FROM accounts WHERE id=$1',[a.accountId])).rows[0].display_name,a.displayName)
 allowed=true;await f.store.retryReceipt(receipt,proof,randomUUID());await f.engine.run(f.dispatches.at(-1));assert.equal(checks,2);assert.equal((await f.store.row(request.id)).status,'completed');assert.deepEqual(f.erasures.map(v=>v[0]),['people','conversations','memories','gifts'])
})

test('Gifts preflight adapter uses accepted deletion context and preserves explicit financial retention on the proof receipt',async t=>{
 const f=await fixture(t),a=await f.login();await f.recent(a);f.config.giftsUrl=new URL('http://127.0.0.1:3107');const receipt=randomUUID(),proof=randomBytes(32).toString('base64url'),request=await f.store.create(a.hash,a.id,randomUUID(),{kind:'delete_account',scope:'account_data',deletionReceiptId:receipt,statusProof:proof},randomUUID()),row=await f.store.row(request.id),retention={status:'retained',archiveId:randomUUID(),policyVersion:'fixture-30-days',retainUntil:new Date(Date.now()+30*86400000).toISOString()},calls=[]
 const d=new RightsDependencies(f.config,async(url,init)=>{calls.push({url:String(url),init});return Response.json({data:{accountId:a.accountId,requestId:row.id,allowed:true,checkedAt:new Date().toISOString(),financialRetention:retention}})});assert.deepEqual((await d.financialPreflight(row)).financialRetention,retention);assert(calls[0].url.endsWith('/erase-preflight'));assert.equal(JSON.parse(calls[0].init.body).requestId,row.id);assert.equal(calls[0].init.headers['Idempotency-Key'],row.id)
 f.dependencies.financialPreflight=async()=>({checkedAt:new Date().toISOString(),financialRetention:retention});f.dependencies.erase=async()=>({erasedAt:new Date().toISOString(),financialRetention:retention});await f.engine.run(f.dispatches[0]);assert.equal((await f.store.readReceipt(receipt,proof)).status,'completed');assert.deepEqual((await f.store.readReceipt(receipt,proof)).financialRetention,retention)
 const denied=new RightsDependencies(f.config,async()=>Response.json({error:{code:'FINANCIAL_RECONCILIATION_REQUIRED'}},{status:409}));await assert.rejects(denied.financialPreflight(row),{code:'FINANCIAL_RECONCILIATION_REQUIRED'})
})

test('security replay applies the exact latest explicit revocation while retaining historical grants without treating them as current authority',async t=>{
 const f=await fixture(t),a=await f.login(),consents=new ConsentStore(f.pool,f.identity),decide=async(purpose,decision,expectedAuthorizationVersion)=>{const p=(await consents.policies('en')).find(p=>p.kind===purpose);return consents.record(a.hash,a.id,randomUUID(),randomUUID(),{policyId:p.id,version:p.version,purpose,decision,expectedAuthorizationVersion})};await decide('privacy_notice','acknowledge',0);await decide('private_story_storage','grant',0)
 const schema=(await f.pool.query('SELECT current_schema() n')).rows[0].n;assert(/^rights_test_[a-f0-9]+$/.test(schema));const target={domain:'identity',kind:'target',runId:randomUUID()},convert=sql=>sql.replaceAll("n.nspname='public'","n.nspname='"+schema+"'").replaceAll('"public".','"'+schema+'".').replaceAll('public.current_consents','"'+schema+'".current_consents').replaceAll('public.consent_events','"'+schema+'".consent_events'),runtime={async query(t,sql){assert.equal(t,target);const rows=(await f.pool.query(convert(sql))).rows;return sql.includes('c.relkind AS kind')?rows.map(r=>({...r,schema:'public',foreignKeys:r.foreignKeys.map(k=>({...k,parentSchema:'public'}))})):rows},async sql(t,sql){assert.equal(t,target);return f.pool.query(convert(sql))},async assertIsolatedTarget(t){assert.equal(t,target);assert.equal((await f.pool.query('SELECT current_schema() n')).rows[0].n,schema)}}
 const meter={provider:'openai',model:'gpt-5-mini',resolvedModel:null,state:'failed',elapsedMs:120,inputTokens:null,outputTokens:null,cachedInputTokens:null};
 const old=(await f.pool.query("SELECT * FROM current_consents WHERE account_id=$1 AND purpose='private_story_storage'",[a.accountId])).rows[0],attempt=randomUUID();await f.pool.query("INSERT INTO model_execution_days VALUES($1,CURRENT_DATE,3)",[a.accountId]);await f.pool.query("INSERT INTO model_executions(id,account_id,job_id,service,purpose,authorizations,lease_until) VALUES($1,$2,$3,'gifts','gift_return',$4,clock_timestamp()+interval '45 seconds')",[attempt,a.accountId,randomUUID(),JSON.stringify(Object.fromEntries(Object.entries(await consents.authorizations(a.accountId)).filter(([name])=>name!=='personVoiceStorage')))]);await decide('private_story_storage','revoke',1);await f.pool.query('UPDATE model_execution_days SET attempts=8');await f.pool.query('UPDATE model_executions SET finished_at=clock_timestamp(),result_allowed=false,usage=$1::jsonb',[JSON.stringify(meter)]);const latest=await captureSecurityReplay(runtime,target);assert.equal(latest.revocations.length,1)
 await f.pool.query("BEGIN;SET LOCAL session_replication_role='replica';DELETE FROM consent_events WHERE decision='revoke';COMMIT");await f.pool.query("UPDATE current_consents SET authorization_version=$2,updated_at=$3 WHERE account_id=$1 AND purpose='private_story_storage'",[a.accountId,old.authorization_version,old.updated_at]);await f.pool.query('UPDATE model_execution_days SET attempts=3');await f.pool.query('UPDATE model_executions SET finished_at=NULL,result_allowed=NULL,usage=NULL');assert.equal((await consents.authorizations(a.accountId)).storyStorage.allowed,true)
 const proof=await replaySecurity(runtime,target,latest);assert.equal(proof.revocationsCaptured,1);assert.equal((await consents.authorizations(a.accountId)).storyStorage.allowed,false);assert.equal((await f.pool.query("SELECT authorization_version FROM current_consents WHERE account_id=$1 AND purpose='private_story_storage'",[a.accountId])).rows[0].authorization_version,2);assert.equal((await f.pool.query("SELECT count(*)::integer n FROM consent_events WHERE account_id=$1 AND decision='grant'",[a.accountId])).rows[0].n,1)
 assert.equal((await f.pool.query('SELECT attempts FROM model_execution_days')).rows[0].attempts,8);assert.equal((await f.pool.query('SELECT result_allowed FROM model_executions WHERE id=$1',[attempt])).rows[0].result_allowed,false);assert.deepEqual((await f.pool.query('SELECT usage FROM model_executions WHERE id=$1',[attempt])).rows[0].usage,meter);const mutated=structuredClone(latest);mutated.tables.find(t=>t.name==='model_executions').safeRows[0].usage.elapsedMs=999;await assert.rejects(replaySecurity(runtime,target,mutated),/accepted attempt or audit was rewritten/);const backward=structuredClone(latest);backward.tables.find(t=>t.name==='model_execution_days').safeRows[0].attempts=2;await assert.rejects(replaySecurity(runtime,target,backward),/model budget moved backwards/)
})

test('credential recovery clears unchanged encrypted operations, retains monotonic subject fences and requires a new strong proof',async t=>{
 const f=await fixture(t),actor=await f.login('recover-password'),other=await f.login('recover-no-fence'),schema=(await f.pool.query('SELECT current_schema() n')).rows[0].n,target={domain:'identity',kind:'target',runId:randomUUID()},marker='PRIVATE_PASSWORD_AND_WECHAT_RECOVERY_CONTEXT'
 assert.match(schema,/^rights_test_[a-f0-9]+$/)
 const convert=sql=>sql.replaceAll("'public'","'"+schema+"'").replaceAll('"public".','"'+schema+'".').replaceAll('public.','"'+schema+'".')
 const runtime={async query(t,sql){assert.equal(t,target);if(sql.includes('SELECT DISTINCT n.nspname AS schema'))return[];const rows=(await f.pool.query(convert(sql))).rows;return sql.includes('c.relkind AS kind')?rows.map(r=>({...r,schema:'public',...(r.foreignKeys&&{foreignKeys:r.foreignKeys.map(k=>({...k,parentSchema:'public'}))})})):rows},async json(t,sql){assert.equal(t,target);return(await f.pool.query(convert(sql))).rows[0]['QUERY PLAN']},async sql(t,sql){assert.equal(t,target);await f.pool.query(convert(sql))},async assertIsolatedTarget(t){assert.equal(t,target);assert.equal((await f.pool.query('SELECT current_schema() n')).rows[0].n,schema)}}
 const pending=randomUUID();await f.identity.begin({id:pending,browserHash:actor.browser,sessionHash:actor.hash,key:randomUUID(),purpose:'switch',provider:'wechat',nativeHandoff:true,stateHash:sha(randomUUID()),nonce:'synthetic',verifier:'synthetic',authorizationUrl:'https://id.example.test/oidc/auth',expiresAt:new Date(Date.now()+60000)})
 await f.pool.query("INSERT INTO native_auth_handoffs(attempt_id,browser_hash,request_fingerprint,verifier_hash,launch_hash,expires_at,transport)VALUES($1,$2,$3,$3,$3,clock_timestamp()+interval '1 minute','wechat_sdk')",[pending,sha(actor.browser),sha(marker)])
 await f.pool.query("INSERT INTO native_wechat_transactions(attempt_id,connector_id,app_id,sdk_state_hash,phase,private_cipher,expires_at)VALUES($1,'synthetic-connector','wx0000000000000000',$2,'waiting_provider',$3,clock_timestamp()+interval '1 minute')",[pending,sha(marker),Buffer.from(marker)])
 await f.pool.query("INSERT INTO auth_password_logins(id,browser_hash,idempotency_key,request_hash,phone_hash,phase,result_cipher)VALUES($1,$2,$3,$4,$4,'completed',$5)",[randomUUID(),actor.browser,randomUUID(),sha(marker),marker])
 await f.pool.query("INSERT INTO auth_password_challenges(id,browser_hash,idempotency_key,phone_hash,purpose,account_id,phase,context_cipher)VALUES($1,$2,$3,$4,'reset',$5,'unknown',$6)",[randomUUID(),actor.browser,randomUUID(),sha(marker),actor.accountId,marker])
 await f.pool.query("INSERT INTO auth_credential_fences(issuer,subject,fenced_at,password_pending)VALUES($1,'recover-password','2026-11-17T00:00:00Z',NULL),($1,'provider-only-subject','2026-11-16T00:00:00Z',$2)",[f.config.issuer.href,randomUUID()])
 const latest=await captureSecurityReplay(runtime,target);assert.equal(JSON.stringify(latest).includes(marker),false)
 await f.pool.query("UPDATE auth_credential_fences SET fenced_at=fenced_at-interval '1 day'")
 const replay=await replaySecurity(runtime,target,latest);assert.equal(replay.releaseReady,false)
 assert.equal((await f.pool.query("SELECT fenced_at::text FROM auth_credential_fences WHERE subject='recover-password'")).rows[0].fenced_at.startsWith('2026-11-17'),true)
 for(const table of ['auth_sms_challenges','native_auth_handoffs','native_wechat_transactions','auth_password_logins','auth_password_challenges'])assert.equal((await f.pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n,0)
 const backward=structuredClone(latest);backward.tables.find(t=>t.name==='auth_credential_fences').safeRows[0].fenced_at='2000-01-01T00:00:00Z';await assert.rejects(replaySecurity(runtime,target,backward),/credential fence moved backwards/)
 const before=await recoveryCapture(runtime,target),proof=await quarantine(runtime,target),after=await recoveryCapture(runtime,target)
 assert.deepEqual(before.core,after.core);assert.equal(proof.assertions.passwordAndSocialContextsCleared,true);assert.equal(proof.assertions.credentialFencesRequireFreshProof,true);assert.equal(JSON.stringify({before,after,proof}).includes(marker),false)
 const gates=(await f.pool.query('SELECT subject,password_pending FROM auth_credential_fences ORDER BY subject')).rows;assert.equal(gates.length,3);assert(gates.every(r=>r.password_pending));assert.equal(await f.identity.current(actor.hash),null);assert.equal(await f.identity.current(other.hash),null)
 // Simulate the separate operator release of this owned isolated fixture; passwords stay gated.
 await f.pool.query("UPDATE accounts SET status='active' WHERE id=$1",[actor.accountId]);f.identity.useCredentialFences()
 async function candidate(password,fresh){const id=randomUUID(),browser=sha(randomUUID()),stateHash=sha(randomUUID()),claimId=randomUUID();await f.identity.begin({id,browserHash:browser,sessionHash:null,key:randomUUID(),purpose:'sign_in',password,stateHash,nonce:'synthetic',verifier:'synthetic',authorizationUrl:'https://id.example.test/oidc/auth',expiresAt:new Date(Date.now()+60000)});await f.identity.claim({browserHash:browser,stateHash,claimId});return f.identity.finish({browserHash:browser,attemptId:id,claimId,sessionHash:sha(randomUUID()),principal:{issuer:f.config.issuer.href,subject:'recover-password',authenticatedAt:new Date(),authenticationTimeVerified:fresh}})}
 assert.equal(await candidate(true,true),false);assert.equal(await candidate(false,false),false);assert.equal(await candidate(false,true),true)
 assert.equal((await f.pool.query("SELECT password_pending FROM auth_credential_fences WHERE subject='recover-password'")).rows[0].password_pending,null)
})
