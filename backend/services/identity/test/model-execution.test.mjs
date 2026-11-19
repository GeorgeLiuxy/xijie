import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile,readdir} from 'node:fs/promises'
import {test} from 'node:test'
import pg from 'pg'
import {ConsentStore} from '../dist/consent-store.js'
import {IdentityStore} from '../dist/store.js'
import {ModelExecutionStore} from '../dist/model-execution.js'

test('durable model gate requires independent current production consent and fences attempts, quotas and late results',async t=>{
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated test database required')
 const admin=new pg.Pool({connectionString}),schema='model_gate_'+randomUUID().replaceAll('-',''),pool=new pg.Pool({connectionString,options:'-c search_path='+schema})
 const names=['NODE_ENV','MODEL_EXECUTION_ENABLED','MODEL_PRODUCTION_APPROVED','MODEL_ALLOWED_ACCOUNT_IDS','MODEL_ALLOWED_PURPOSES','MODEL_DAILY_ACCOUNT_LIMIT','MODEL_MAX_CONCURRENT'],old=Object.fromEntries(names.map(k=>[k,process.env[k]]))
 try{
  await admin.query('CREATE SCHEMA '+schema)
  for(const name of (await readdir(new URL('../db/',import.meta.url))).filter(n=>/^\d+_.+\.sql$/.test(n)&&(Number(n.slice(0,3))<=23||n==='032_model_attempt_usage.sql')).sort())await pool.query(await readFile(new URL('../db/'+name,import.meta.url),'utf8'))
  const accountId=randomUUID();await pool.query('INSERT INTO accounts(id,registered_at,updated_at) VALUES($1,clock_timestamp(),clock_timestamp())',[accountId])
  const consents=new ConsentStore(pool,new IdentityStore(pool)),store=new ModelExecutionStore(pool,consents)
  const current=await pool.query('SELECT DISTINCT ON(kind) id,kind,version FROM policy_versions ORDER BY kind,version DESC')
  async function grant(purpose){const p=current.rows.find(v=>v.kind===purpose);await pool.query(`INSERT INTO consent_events(account_id,purpose,policy_id,policy_version,decision,authorization_version,idempotency_key,request_fingerprint,notice_authorization_version) VALUES($1,$2,$3,$4,$5,1,$6,'synthetic',$7)`,[accountId,purpose,p.id,p.version,purpose==='privacy_notice'?'acknowledge':'grant',randomUUID(),purpose==='privacy_notice'?null:1]);await pool.query('INSERT INTO current_consents(account_id,purpose,authorization_version,updated_at) VALUES($1,$2,1,clock_timestamp())',[accountId,purpose])}
  for(const purpose of ['privacy_notice','private_story_storage','ai_text_processing'])await grant(purpose)
  const input=()=>({accountId,jobId:randomUUID(),attemptId:randomUUID(),purpose:'text_reply'})
  delete process.env.MODEL_ALLOWED_PURPOSES
  Object.assign(process.env,{NODE_ENV:'production',MODEL_EXECUTION_ENABLED:'true',MODEL_PRODUCTION_APPROVED:'true',MODEL_ALLOWED_ACCOUNT_IDS:accountId,MODEL_MAX_CONCURRENT:'1',MODEL_DAILY_ACCOUNT_LIMIT:'5'})
  await assert.rejects(store.claim('conversations',input()),{code:'AI_PERMISSION_REQUIRED'})
  await grant('production_model_execution')
  const unavailable={status:503,code:'MODEL_EXECUTION_UNAVAILABLE'}
  delete process.env.MODEL_EXECUTION_ENABLED;await assert.rejects(store.claim('conversations',input()),unavailable);process.env.MODEL_EXECUTION_ENABLED='true'
  process.env.MODEL_ALLOWED_ACCOUNT_IDS='*'
  const extras=Array.from({length:105},()=>randomUUID());await pool.query('INSERT INTO accounts(id,registered_at,updated_at) SELECT id,clock_timestamp(),clock_timestamp() FROM unnest($1::uuid[]) AS id',[extras])
  const pages=[],eligible=[];let cursor
  do{const page=await store.eligible('memories','automatic_memory',cursor);pages.push(page);eligible.push(...page.items);cursor=page.nextCursor??undefined}while(cursor)
  assert.equal(pages.length,2);assert.deepEqual(eligible,[accountId]);assert.ok(pages[0].nextCursor)
  for(const purposes of ['', 'text_reply,unknown_purpose']){
   process.env.MODEL_ALLOWED_PURPOSES=purposes
   await assert.rejects(store.claim('conversations',input()),unavailable)
  }
  process.env.MODEL_ALLOWED_PURPOSES='text_reply, world_action'
  assert.deepEqual(await store.eligible('memories','automatic_memory'),{items:[],nextCursor:null})
  await assert.rejects(store.claim('memories',{...input(),purpose:'automatic_memory'}),unavailable)
  await assert.rejects(store.claim('conversations',{...input(),purpose:'world_action'}),{code:'AI_PERMISSION_REQUIRED'})
  process.env.MODEL_ALLOWED_ACCOUNT_IDS=accountId
  await assert.rejects(store.claim('conversations',{...input(),accountId:extras[0]}),unavailable)
  process.env.MODEL_ALLOWED_ACCOUNT_IDS='*'
  await assert.rejects(store.eligible('gifts','automatic_memory'),{code:'FORBIDDEN'})
  await assert.rejects(store.claim('conversations',{...input(),accountId:extras[0]}),{code:'AI_PERMISSION_REQUIRED'})
  const one=input(),two=input(),claims=await Promise.allSettled([store.claim('conversations',one),store.claim('conversations',two)])
  assert.equal(claims.filter(x=>x.status==='fulfilled').length,1);assert.equal(claims.find(x=>x.status==='rejected').reason.code,'MODEL_BUDGET_EXCEEDED')
  const first=claims[0].status==='fulfilled'?one:two
  const meter={provider:'openai',model:'gpt-5-mini',resolvedModel:'gpt-5-mini-2025-08-07',state:'returned',elapsedMs:23,inputTokens:100,outputTokens:16,cachedInputTokens:0}
  await assert.rejects(store.claim('conversations',first),{code:'MODEL_ATTEMPT_ALREADY_CLAIMED'})
  await assert.rejects(store.finish('gifts',first.attemptId,true),{code:'NOT_FOUND'})
  const failed={...meter,state:'failed',resolvedModel:null,inputTokens:null,outputTokens:null,cachedInputTokens:null}
  assert.deepEqual(await store.finish('conversations',first.attemptId,false,failed),{allowed:false})
  assert.deepEqual((await pool.query('SELECT result_allowed,usage FROM model_executions WHERE id=$1',[first.attemptId])).rows[0],{result_allowed:false,usage:failed})
  assert.equal((await pool.query('SELECT attempts FROM model_execution_days')).rows[0].attempts,1)
  const second=input();await store.claim('conversations',second);assert.deepEqual(await store.finish('conversations',second.attemptId,true,meter),{allowed:true});assert.deepEqual(await store.finish('conversations',second.attemptId,true,{...meter,inputTokens:999}),{allowed:false})
  assert.deepEqual((await pool.query('SELECT result_allowed,usage FROM model_executions WHERE id=$1',[second.attemptId])).rows[0],{result_allowed:true,usage:meter})
  const excluded=input();await store.claim('conversations',excluded)
  process.env.MODEL_ALLOWED_PURPOSES='world_action'
  assert.deepEqual(await store.finish('conversations',excluded.attemptId,true,meter),{allowed:false})
  assert.deepEqual((await pool.query('SELECT result_allowed,usage FROM model_executions WHERE id=$1',[excluded.attemptId])).rows[0],{result_allowed:false,usage:meter})
  process.env.MODEL_ALLOWED_PURPOSES='text_reply,world_action'
  const late=input();await store.claim('conversations',late);await pool.query("UPDATE model_executions SET claimed_at=clock_timestamp()-interval '50 seconds',lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[late.attemptId]);assert.deepEqual(await store.finish('conversations',late.attemptId,true),{allowed:false})
  const revoked=input();await store.claim('conversations',revoked)
  await pool.query(`INSERT INTO consent_events(account_id,purpose,policy_id,policy_version,decision,authorization_version,idempotency_key,request_fingerprint) SELECT account_id,purpose,policy_id,policy_version,'revoke',2,$2,'synthetic-revoke' FROM consent_events WHERE account_id=$1 AND purpose='production_model_execution'`,[accountId,randomUUID()]);await pool.query("UPDATE current_consents SET authorization_version=2 WHERE account_id=$1 AND purpose='production_model_execution'",[accountId])
  assert.deepEqual(await store.finish('conversations',revoked.attemptId,true,meter),{allowed:false})
  assert.deepEqual((await pool.query('SELECT result_allowed,usage FROM model_executions WHERE id=$1',[revoked.attemptId])).rows[0],{result_allowed:false,usage:meter})
  process.env.MODEL_ALLOWED_ACCOUNT_IDS=accountId;process.env.NODE_ENV='test';await assert.rejects(store.claim('conversations',input()),{code:'MODEL_BUDGET_EXCEEDED'})
  assert.equal((await pool.query('SELECT attempts FROM model_execution_days')).rows[0].attempts,5)
 }finally{for(const[k,v]of Object.entries(old))v===undefined?delete process.env[k]:process.env[k]=v;await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()}
})
