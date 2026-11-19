import assert from 'node:assert/strict'
import {createHash,randomBytes,randomUUID} from 'node:crypto'
import {readFile,readdir} from 'node:fs/promises'
import {test} from 'node:test'
import pg from 'pg'
import {IdentityStore} from '../dist/store.js'
import {ConsentStore} from '../dist/consent-store.js'

test('AI feed processing is a fresh explicit capability without republishing notice or storage policies',async t=>{
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL;assert(connectionString)
 const schema='ai_feed_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString});await admin.query('CREATE SCHEMA '+schema)
 const pool=new pg.Pool({connectionString,options:'-c search_path='+schema});t.after(async()=>{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()})
 for(const file of (await readdir(new URL('../db/',import.meta.url))).filter(file=>/^00[1-7]_.+\.sql$/.test(file)).sort())await pool.query(await readFile(new URL('../db/'+file,import.meta.url),'utf8'))
 const identity=new IdentityStore(pool),consents=new ConsentStore(pool,identity),browserHash=randomUUID(),id=randomUUID(),stateHash=randomUUID(),claimId=randomUUID(),proof=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(proof).digest('hex')
 await identity.begin({id,browserHash,key:randomUUID(),purpose:'sign_in',sessionHash:null,stateHash,nonce:randomUUID(),verifier:randomUUID(),authorizationUrl:'https://id.example.test/oidc/auth',expiresAt:new Date(Date.now()+60000)})
 await identity.claim({browserHash,stateHash,claimId});assert(await identity.finish({browserHash,attemptId:id,claimId,sessionHash:hash,principal:{issuer:'https://id.example.test/oidc',subject:'ai-feed-synthetic',authenticatedAt:new Date()}}));const actor=await identity.current(hash)
 const record=async(purpose,decision,expectedAuthorizationVersion)=>{const p=(await consents.policies('en')).find(p=>p.kind===purpose);return consents.record(hash,actor.id,randomUUID(),randomUUID(),{policyId:p.id,version:p.version,purpose,decision,expectedAuthorizationVersion})}
 await record('privacy_notice','acknowledge',0);await record('private_story_storage','grant',0);await record('ai_text_processing','grant',0)
 const before=await consents.authorizations(actor.accountId),policies=(await pool.query('SELECT id,kind,version,document_zh_cn,document_en,published_at,effective_at FROM policy_versions ORDER BY kind,version')).rows
 assert(before.storyStorage.privateFeedAllowed);assert(before.aiTextProcessing.automaticMemoryAllowed);assert.notEqual(before.aiTextProcessing.privateFeedProcessingAllowed,true)
 await pool.query(await readFile(new URL('../db/008_private_feed_processing.sql',import.meta.url),'utf8'))
 const afterPolicies=(await pool.query('SELECT id,kind,version,document_zh_cn,document_en,published_at,effective_at FROM policy_versions ORDER BY kind,version')).rows
 assert.deepEqual(afterPolicies.filter(row=>policies.some(old=>old.id===row.id&&old.version===row.version)),policies)
 const current=await consents.policies('en'),notice=current.find(p=>p.kind==='privacy_notice'),storage=current.find(p=>p.kind==='private_story_storage'),ai=current.find(p=>p.kind==='ai_text_processing')
 assert.equal(notice.version,4);assert.equal(storage.version,2);assert.equal(ai.version,3);assert.equal(ai.privateFeedProcessingEnabled,true);assert.equal(notice.privateFeedProcessingEnabled,undefined)
 let permissions=await consents.authorizations(actor.accountId);assert.deepEqual(permissions.storyStorage,before.storyStorage);assert.equal(permissions.aiTextProcessing.allowed,false);assert.notEqual(permissions.aiTextProcessing.privateFeedProcessingAllowed,true)
 await record('ai_text_processing','grant',1);permissions=await consents.authorizations(actor.accountId)
 assert.deepEqual(permissions.aiTextProcessing,{allowed:true,authorizationVersion:2,automaticMemoryAllowed:true,privateFeedProcessingAllowed:true});assert.deepEqual(permissions.storyStorage,before.storyStorage)
 assert.deepEqual((await consents.history(actor.accountId,1,null)).aiTextProcessing,permissions.aiTextProcessing)
 const doc=await consents.document(ai.id,ai.version,'en');assert.match(doc,/does not scan old originals/);assert.match(doc,/Ordinary private user posts/);assert.match(doc,/OpenAI/)
 await record('ai_text_processing','revoke',2);assert.deepEqual((await consents.authorizations(actor.accountId)).aiTextProcessing,{allowed:false,authorizationVersion:3})
 await record('ai_text_processing','grant',3);assert.equal((await consents.authorizations(actor.accountId)).aiTextProcessing.privateFeedProcessingAllowed,true)
 await pool.query('UPDATE policy_versions SET private_feed_processing_enabled=false WHERE id=$1 AND version=3',[ai.id]);assert.notEqual((await consents.authorizations(actor.accountId)).aiTextProcessing.privateFeedProcessingAllowed,true)
 for(const kind of ['privacy_notice','private_story_storage'])await assert.rejects(pool.query('UPDATE policy_versions SET private_feed_processing_enabled=true WHERE kind=$1',[kind]),{code:'23514'})
})
