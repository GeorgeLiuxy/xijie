import assert from 'node:assert/strict'
import {randomUUID,randomBytes,createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'
import pg from 'pg'
import {IdentityStore} from '../dist/store.js'
import {ConsentStore} from '../dist/consent-store.js'

test('automatic memory is an explicit new policy capability, never an upgrade of an old AI grant',async()=>{
 const url=process.env.XIJIE_TEST_DATABASE_URL;if(!url)throw new Error('An integration database is required')
 const schema='auto_consent_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:url}),pool=new pg.Pool({connectionString:url,options:'-c search_path='+schema})
 try{
  await admin.query('CREATE SCHEMA '+schema)
  for(const name of ['001_identity.sql','002_consents.sql','004_ai_text_processing.sql'])await pool.query(await readFile(new URL('../db/'+name,import.meta.url),'utf8'))
  const identity=new IdentityStore(pool),consents=new ConsentStore(pool,identity),browserHash=randomUUID(),attemptId=randomUUID(),stateHash=randomUUID(),claimId=randomUUID()
  await identity.begin({id:attemptId,browserHash,key:randomUUID(),purpose:'sign_in',sessionHash:null,stateHash,nonce:randomUUID(),verifier:randomUUID(),authorizationUrl:'https://id.example.test/oidc/auth',expiresAt:new Date(Date.now()+60000)})
  await identity.claim({browserHash,stateHash,claimId})
  const sessionHash=createHash('sha256').update(randomBytes(32)).digest('hex')
  assert.equal(await identity.finish({browserHash,attemptId,claimId,sessionHash,principal:{issuer:'https://id.example.test/oidc',subject:'automatic-policy-fixture',authenticatedAt:new Date()}}),true)
  const session=await identity.current(sessionHash)
  const policies=()=>consents.policies('en'),decide=async(policy,decision,expected)=>consents.record(sessionHash,session.id,randomUUID(),randomUUID(),{policyId:policy.id,version:policy.version,purpose:policy.kind,decision,expectedAuthorizationVersion:expected})
  let list=await policies(),notice=list.find(p=>p.kind==='privacy_notice'),ai=list.find(p=>p.kind==='ai_text_processing')
  await decide(notice,'acknowledge',0);await decide(list.find(p=>p.kind==='private_story_storage'),'grant',0);await decide(ai,'grant',0)
  assert.deepEqual((await consents.authorizations(session.accountId)).aiTextProcessing,{allowed:true,authorizationVersion:1})
  const eventsBefore=(await pool.query('SELECT count(*)::int AS n FROM consent_events')).rows[0].n
  await pool.query(await readFile(new URL('../db/006_automatic_memory_permission.sql',import.meta.url),'utf8'))
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM consent_events')).rows[0].n,eventsBefore)
  assert.equal((await consents.authorizations(session.accountId)).aiTextProcessing.allowed,false)
  assert.match(await consents.document(ai.id,ai.version,'en'),/does not cover[\s\S]*automatic long-term memory/)
  list=await policies();notice=list.find(p=>p.kind==='privacy_notice');const next=list.find(p=>p.kind==='ai_text_processing')
  assert.equal(next.version,2);await decide(notice,'acknowledge',1)
  assert.equal((await consents.authorizations(session.accountId)).aiTextProcessing.allowed,false)
  await assert.rejects(()=>decide(ai,'grant',1),{status:412,code:'VERSION_CONFLICT'})
  await decide(next,'grant',1)
  assert.deepEqual((await consents.authorizations(session.accountId)).aiTextProcessing,{allowed:true,authorizationVersion:2,automaticMemoryAllowed:true})
  await decide(next,'revoke',2)
  assert.deepEqual((await consents.authorizations(session.accountId)).aiTextProcessing,{allowed:false,authorizationVersion:3})
  await decide(next,'grant',3)
  assert.equal((await consents.authorizations(session.accountId)).aiTextProcessing.automaticMemoryAllowed,true)
  // A later version with no declared capability must not gain it from its number.
  await pool.query("INSERT INTO policy_versions(id,kind,version,document_zh_cn,document_en) VALUES($1,'ai_text_processing',3,'合成回退政策','Synthetic narrowed policy')",[next.id])
  const future=(await policies()).find(p=>p.kind==='ai_text_processing');await decide(future,'grant',4)
  assert.deepEqual((await consents.authorizations(session.accountId)).aiTextProcessing,{allowed:true,authorizationVersion:5})
  await assert.rejects(pool.query("INSERT INTO policy_versions(id,kind,version,document_zh_cn,document_en,ai_automatic_memory_enabled) VALUES($1,'privacy_notice',99,'x','x',true)",[randomUUID()]),{code:'23514'})
 }finally{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()}
})
