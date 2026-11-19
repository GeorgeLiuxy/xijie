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

test('person photos require a fresh scoped decision while existing photo, text and AI grants remain unchanged',async t=>{
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL;assert(connectionString)
 const schema='photo_permission_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString});await admin.query('CREATE SCHEMA '+schema)
 const pool=new pg.Pool({connectionString,options:'-c search_path='+schema});t.after(async()=>{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()})
 for(const file of (await readdir(new URL('../db/',import.meta.url))).filter(f=>/^00[1-9]_/.test(f)).sort())await pool.query(await readFile(new URL('../db/'+file,import.meta.url),'utf8'))
 const identity=new IdentityStore(pool),consents=new ConsentStore(pool,identity),browserHash=randomUUID(),id=randomUUID(),stateHash=randomUUID(),claimId=randomUUID(),proof=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(proof).digest('hex')
 await identity.begin({id,browserHash,key:randomUUID(),purpose:'sign_in',sessionHash:null,stateHash,nonce:randomUUID(),verifier:randomUUID(),authorizationUrl:'https://id.example.test/oidc/auth',expiresAt:new Date(Date.now()+60000)})
 await identity.claim({browserHash,stateHash,claimId});assert(await identity.finish({browserHash,attemptId:id,claimId,sessionHash:hash,principal:{issuer:'https://id.example.test/oidc',subject:'photo-synthetic',authenticatedAt:new Date()}}));const actor=await identity.current(hash)
 const record=async(purpose,decision,expectedAuthorizationVersion)=>{const p=(await consents.policies('en')).find(p=>p.kind===purpose);return consents.record(hash,actor.id,randomUUID(),randomUUID(),{policyId:p.id,version:p.version,purpose,decision,expectedAuthorizationVersion})}
 await record('privacy_notice','acknowledge',0);await record('private_story_storage','grant',0);await record('ai_text_processing','grant',0);await record('private_photo_storage','grant',0)
 const before=await consents.authorizations(actor.accountId),policies=(await pool.query('SELECT * FROM policy_versions ORDER BY kind,version')).rows
 await pool.query(await readFile(new URL('../db/010_private_person_photo_storage.sql',import.meta.url),'utf8'))
 assert.deepEqual((await pool.query("SELECT * FROM policy_versions WHERE kind<>'private_person_photo_storage' ORDER BY kind,version")).rows,policies)
 const available=await consents.policies('en');for(const [kind,version]of [['privacy_notice',4],['private_story_storage',2],['ai_text_processing',3],['private_photo_storage',1],['private_person_photo_storage',1]])assert.equal(available.find(p=>p.kind===kind).version,version)
 let auth=await consents.authorizations(actor.accountId);assert.deepEqual(auth.photoStorage,before.photoStorage);assert.deepEqual(auth.storyStorage,before.storyStorage);assert.deepEqual(auth.aiTextProcessing,before.aiTextProcessing);assert.deepEqual(auth.personPhotoStorage,{allowed:false,authorizationVersion:0})
 const mediaToken=randomBytes(32).toString('hex'),config={secure:false,origin:'http://localhost:5184',clientSecret:randomUUID(),mediaServiceToken:mediaToken}
 const app=await NestFactory.create(IdentityModule.register(config,identity,{},consents),{logger:false,abortOnError:false});app.use(identityHeaders);app.useGlobalFilters(new IdentityErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close());const origin=await app.getUrl()
 const sessionHeaders={Cookie:'xijie_dev_session='+proof,'X-Xijie-Expected-Session':actor.id},photo=available.find(p=>p.kind==='private_person_photo_storage'),key=randomUUID(),body={policyId:photo.id,version:photo.version,purpose:photo.kind,decision:'grant',expectedAuthorizationVersion:0}
 const submit=()=>fetch(origin+'/v1/accounts/me/consents',{method:'POST',headers:{...sessionHeaders,Origin:config.origin,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)})
 const first=await submit();assert.equal(first.status,201);const receipt=(await first.json()).data;assert.equal((await(await submit()).json()).data.id,receipt.id)
 auth=await consents.authorizations(actor.accountId);assert.deepEqual(auth.personPhotoStorage,{allowed:true,authorizationVersion:1});assert.deepEqual(auth.photoStorage,before.photoStorage);assert.deepEqual(auth.storyStorage,before.storyStorage);assert.deepEqual(auth.aiTextProcessing,before.aiTextProcessing)
 const context=await fetch(origin+'/internal/v1/session-context',{headers:{...sessionHeaders,Authorization:'Bearer '+mediaToken}});assert.equal(context.status,200);assert.deepEqual((await context.json()).data.personPhotoStorage,auth.personPhotoStorage)
 assert.equal((await fetch(origin+'/internal/v1/session-context',{headers:{...sessionHeaders,Authorization:'Bearer '+'0'.repeat(64)}})).status,403)
 await record('private_person_photo_storage','revoke',1);auth=await consents.authorizations(actor.accountId);assert.deepEqual(auth.personPhotoStorage,{allowed:false,authorizationVersion:2});assert.deepEqual(auth.aiTextProcessing,before.aiTextProcessing);assert.deepEqual(auth.photoStorage,before.photoStorage);assert.deepEqual(auth.storyStorage,before.storyStorage)
 assert.equal((await pool.query("SELECT count(*)::int n FROM outbox_events WHERE account_id=$1 AND type='PersonPhotoStorageRevoked.v1'",[actor.accountId])).rows[0].n,1)
 const h=await consents.history(actor.accountId,1,null);assert.deepEqual(h.personPhotoStorage,auth.personPhotoStorage);assert.equal(h.currentAuthorizationVersions.private_person_photo_storage,2)
 await record('private_person_photo_storage','grant',2);await record('privacy_notice','acknowledge',1);assert.equal((await consents.authorizations(actor.accountId)).personPhotoStorage.allowed,false)
})
