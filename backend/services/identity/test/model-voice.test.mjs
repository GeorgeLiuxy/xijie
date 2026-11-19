import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile,readdir} from 'node:fs/promises'
import {test} from 'node:test'
import pg from 'pg'
import {ConsentStore} from '../dist/consent-store.js'
import {IdentityStore} from '../dist/store.js'
import {ModelExecutionStore} from '../dist/model-execution.js'

test('live voice has its own current consent and production approval, bounded durable lease and revoke fence',async()=>{
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL;if(!connectionString)throw Error('Isolated test database required')
 const admin=new pg.Pool({connectionString}),schema='voice_gate_'+randomUUID().replaceAll('-',''),pool=new pg.Pool({connectionString,options:'-c search_path='+schema}),names=['NODE_ENV','MODEL_EXECUTION_ENABLED','MODEL_PRODUCTION_APPROVED','MODEL_ALLOWED_ACCOUNT_IDS','MODEL_DAILY_ACCOUNT_LIMIT','MODEL_MAX_CONCURRENT'],old=Object.fromEntries(names.map(k=>[k,process.env[k]]))
 try{
  await admin.query('CREATE SCHEMA '+schema);for(const name of(await readdir(new URL('../db/',import.meta.url))).filter(n=>/^\d+_.+\.sql$/.test(n)&&Number(n.slice(0,3))<=28).sort())await pool.query(await readFile(new URL('../db/'+name,import.meta.url),'utf8'))
  const accountId=randomUUID();await pool.query('INSERT INTO accounts(id,registered_at,updated_at) VALUES($1,clock_timestamp(),clock_timestamp())',[accountId]);const consents=new ConsentStore(pool,new IdentityStore(pool)),store=new ModelExecutionStore(pool,consents)
  const decide=async(purpose,decision='grant',requestedVersion)=>{const policy=(await pool.query('SELECT id,version FROM policy_versions WHERE kind=$1 '+(requestedVersion?'AND version=$2 ':'')+'ORDER BY version DESC LIMIT 1',requestedVersion?[purpose,requestedVersion]:[purpose])).rows[0],version=Number((await pool.query('SELECT authorization_version FROM current_consents WHERE account_id=$1 AND purpose=$2',[accountId,purpose])).rows[0]?.authorization_version??0)+1;await pool.query(`INSERT INTO consent_events(account_id,purpose,policy_id,policy_version,decision,authorization_version,idempotency_key,request_fingerprint,notice_authorization_version) VALUES($1,$2,$3,$4,$5,$6,$7,'synthetic-voice',$8)`,[accountId,purpose,policy.id,policy.version,decision,version,randomUUID(),decision==='grant'?1:null]);await pool.query('INSERT INTO current_consents(account_id,purpose,authorization_version,updated_at) VALUES($1,$2,$3,clock_timestamp()) ON CONFLICT(account_id,purpose) DO UPDATE SET authorization_version=$3,updated_at=clock_timestamp()',[accountId,purpose,version])}
  await decide('privacy_notice','acknowledge');await decide('private_story_storage');Object.assign(process.env,{NODE_ENV:'production',MODEL_EXECUTION_ENABLED:'true',MODEL_PRODUCTION_APPROVED:'true',MODEL_ALLOWED_ACCOUNT_IDS:accountId,MODEL_DAILY_ACCOUNT_LIMIT:'5',MODEL_MAX_CONCURRENT:'4'});const input=()=>({accountId,jobId:randomUUID(),attemptId:randomUUID(),purpose:'voice_call'})
  await assert.rejects(store.claim('conversations',input()),{code:'AI_PERMISSION_REQUIRED'});await decide('person_voice_calls');await assert.rejects(store.claim('conversations',input()),{code:'AI_PERMISSION_REQUIRED'})
  await decide('production_model_execution','grant',1);await assert.rejects(store.claim('conversations',input()),{code:'AI_PERMISSION_REQUIRED'},'old text-only production consent must not enable voice');await decide('production_model_execution')
  const one=input();await store.claim('conversations',one);const lease=(await pool.query('SELECT extract(epoch FROM lease_until-claimed_at)::float AS seconds FROM model_executions WHERE id=$1',[one.attemptId])).rows[0].seconds;assert.ok(lease>=149&&lease<=151);assert.equal((await consents.authorizations(accountId)).aiTextProcessing.allowed,false,'voice never silently grants text processing')
  await assert.rejects(store.claim('memories',input()),{code:'AI_PERMISSION_REQUIRED'});await assert.rejects(store.claim('conversations',{...input(),purpose:'text_reply'}),{code:'AI_PERMISSION_REQUIRED'})
  await decide('private_person_voice_storage');assert.deepEqual(await store.finish('conversations',one.attemptId,true),{allowed:true},'pure local sample storage must not cancel unrelated live voice')
  const revoked=input();await store.claim('conversations',revoked);await decide('person_voice_calls','revoke');assert.deepEqual(await store.finish('conversations',revoked.attemptId,true),{allowed:false});await assert.rejects(store.claim('conversations',input()),{code:'AI_PERMISSION_REQUIRED'});assert.equal((await pool.query('SELECT attempts FROM model_execution_days WHERE account_id=$1',[accountId])).rows[0].attempts,2)
 }finally{for(const[k,v]of Object.entries(old))v===undefined?delete process.env[k]:process.env[k]=v;await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()}
})
