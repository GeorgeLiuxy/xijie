import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DockerRuntime } from './runtime.mjs'
import { capture, compareSnapshots, quarantine } from './policy.mjs'

// Explicitly invoked integration tests. They inspect source container identity only;
// every schema, fixture and destructive operation goes to a new owned network-none target.
const root = fileURLToPath(new URL('../../', import.meta.url))
const account = '11111111-1111-4111-8111-111111111111'
const person = '22222222-2222-4222-8222-222222222222'
const id = suffix => `33333333-3333-4333-8333-${String(suffix).padStart(12, '0')}`
const literal = value => "'" + String(value).replaceAll("'", "''") + "'"
const privateMarker = 'SYNTHETIC_PRIVATE_RECOVERY_FIXTURE'

async function isolated(domain, exercise, {through=Infinity}={}) {
  const runtime = new DockerRuntime(root)
  const source = await runtime.inspectSource(domain)
  const runId = 'policy-test-' + randomUUID()
  const target = await runtime.createTarget(source, runId)
  try {
    const directory = path.join(root, 'backend', 'services', domain, 'db')
    for (const file of (await readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name)&&Number(name.split('_')[0])<=through).sort()) {
      await runtime.sql(target, await readFile(path.join(directory, file), 'utf8'))
    }
    await exercise(runtime, target)
  } finally {
    await runtime.remove(target, runId)
  }
}

test('real People world history survives quarantine and resource checkpoints expose only movement identities', { timeout: 180000 }, async () => {
  await isolated('people', async (runtime, target) => {
    const courtyard='0d700000-0000-4000-8000-000000000001',tide='0d700000-0000-4000-8000-000000000002'
    const card=world=>`(SELECT jsonb_build_object('id',id,'code',code,'displayName',${literal(privateMarker)},'catalogVersion',catalog_version,'enabled',enabled) FROM worlds WHERE id='${world}')`
    await runtime.sql(target,`BEGIN;
      INSERT INTO person_drafts(id,account_id,display_name,relationship,story,authorization_version,created_at,updated_at,expires_at)
        VALUES('${id(201)}','${account}','synthetic person','friend','${privateMarker}',1,statement_timestamp()-interval '3 minutes',statement_timestamp()-interval '3 minutes',statement_timestamp()+interval '1 day');
      INSERT INTO person_previews(id,account_id,draft_id,draft_version,authorization_version,suggested_world_id,created_at,expires_at)
        VALUES('${id(202)}','${account}','${id(201)}',1,1,'${courtyard}',statement_timestamp()-interval '2 minutes',statement_timestamp()+interval '1 hour');
      INSERT INTO persons(id,account_id,source_draft_id,source_preview_id,display_name,relationship,story,world_id,version,world_version,created_at,updated_at)
        VALUES('${person}','${account}','${id(201)}','${id(202)}','synthetic person','friend','${privateMarker}','${courtyard}',3,3,statement_timestamp()-interval '2 minutes',statement_timestamp());
      INSERT INTO person_world_movements(id,account_id,person_id,world_version,person_version,from_world_id,to_world_id,from_world,to_world,actor_account_id,request_id,occurred_at,recorded_at)
        VALUES('${id(203)}','${account}','${person}',2,2,'${courtyard}','${tide}',${card(courtyard)},${card(tide)},'${account}','${id(205)}',statement_timestamp()-interval '1 minute',statement_timestamp()-interval '1 minute'),
        ('${id(204)}','${account}','${person}',3,3,'${tide}','${courtyard}',${card(tide)},${card(courtyard)},'${account}','${id(206)}',statement_timestamp(),statement_timestamp());
      COMMIT;`)
    const before=await capture(runtime,target)
    const movements=before.security.resources.filter(row=>row.kind==='person_world_movement')
    assert.deepEqual(movements.map(row=>[row.id,row.version,row.state]),[[id(203),2,'committed'],[id(204),3,'committed']])
    await assert.rejects(runtime.sql(target,`UPDATE person_world_movements SET reality='virtual' WHERE id='${id(203)}'`))
    await assert.rejects(runtime.sql(target,`INSERT INTO person_world_movements(account_id,person_id,world_version,person_version,from_world_id,to_world_id,from_world,to_world,actor_account_id,request_id,occurred_at,recorded_at)
      VALUES('${account}','${person}',4,4,'${courtyard}','${tide}','{}',${card(tide)},'${account}','${id(207)}',statement_timestamp(),statement_timestamp())`))
    const result=await quarantine(runtime,target)
    assert.equal(result.releaseReady,false);assert.equal(result.beforeCoreDigest,result.afterCoreDigest)
    const after=await capture(runtime,target)
    assert.equal(compareSnapshots(before,after).equal,true)
    assert.deepEqual(after.security.resources.filter(row=>row.kind==='person_world_movement'),movements)
    const [proof]=await runtime.query(target,`SELECT (SELECT world_version FROM persons WHERE id='${person}') AS version,
      (SELECT world_id::text FROM persons WHERE id='${person}') AS current,
      (SELECT count(*)::text FROM person_world_movements WHERE reality='virtual' AND branch='main' AND actor_kind='user') AS movements`)
    assert.deepEqual(proof,{version:3,current:courtyard,movements:'2'})
    await runtime.sql(target,`DELETE FROM person_world_movements WHERE id='${id(203)}'`)
    const removed=await capture(runtime,target),differences=compareSnapshots(after,removed).differences
    assert.ok(differences.some(diff=>diff.resourceKind==='person_world_movement'&&diff.id===id(203)&&diff.change==='removed'))
    assert.equal(JSON.stringify({before,after,result,differences}).includes(privateMarker),false)
  })
})

test('real Conversations quarantine retains successful virtual-world evidence and never rewrites stored world references', { timeout: 180000 }, async () => {
  await isolated('conversations', async(runtime,target)=>{
    const worldRef={accountId:account,personId:person,personVersion:3,worldVersion:3,worldId:'0d700000-0000-4000-8000-000000000001',catalogVersion:1,reality:'virtual',branch:'main',movementIds:[id(204),id(203)],revision:'a'.repeat(64)}
    const encoded=literal(JSON.stringify(worldRef))
    await runtime.sql(target,`BEGIN;
      INSERT INTO conversations(id,account_id,person_id,last_sequence) VALUES('${id(211)}','${account}','${person}',4);
      INSERT INTO messages(id,account_id,conversation_id,sequence,author_kind,text,client_message_id)
        VALUES('${id(212)}','${account}','${id(211)}',1,'self','${privateMarker}','${id(215)}'),
        ('${id(213)}','${account}','${id(211)}',2,'self','${privateMarker}','${id(216)}'),
        ('${id(214)}','${account}','${id(211)}',3,'self','${privateMarker}','${id(217)}');
      INSERT INTO generation_jobs(id,account_id,conversation_id,person_id,source_message_id,state,attempt_id,attempt_count,lease_until,person_version,person_access_version,account_access_version,authorization_version,ai_authorization_version,world_context_ref)
        VALUES('${id(218)}','${account}','${id(211)}','${person}','${id(212)}','queued',NULL,0,NULL,3,1,1,1,1,${encoded}),
        ('${id(219)}','${account}','${id(211)}','${person}','${id(213)}','running','${id(221)}',1,statement_timestamp()+interval '1 hour',3,1,1,1,1,${encoded});
      INSERT INTO generation_jobs(id,account_id,conversation_id,person_id,source_message_id,state,reply_id,person_version,person_access_version,account_access_version,authorization_version,ai_authorization_version,world_context_ref)
        VALUES('${id(220)}','${account}','${id(211)}','${person}','${id(214)}','succeeded','${id(222)}',3,1,1,1,1,${encoded});
      INSERT INTO messages(id,account_id,conversation_id,sequence,author_kind,text,reply_to_message_id,generation_job_id,speaker_person_id,display_name)
        VALUES('${id(222)}','${account}','${id(211)}',4,'persona','${privateMarker}','${id(214)}','${id(220)}','${person}','synthetic persona');
      COMMIT;`)
    const before=await capture(runtime,target)
    const result=await quarantine(runtime,target)
    assert.equal(result.assertions.noExecutableGeneration,true);assert.equal(result.beforeCoreDigest,result.afterCoreDigest)
    const references=await runtime.query(target,'SELECT id,state,world_context_ref FROM generation_jobs ORDER BY id')
    assert.deepEqual(references.map(row=>row.state),['blocked','blocked','succeeded'])
    for(const row of references)assert.deepEqual(row.world_context_ref,worldRef)
    const after=await capture(runtime,target)
    assert.deepEqual(after.core.find(row=>row.name==='public.generation_jobs:succeeded'),before.core.find(row=>row.name==='public.generation_jobs:succeeded'))
    await runtime.sql(target,`UPDATE generation_jobs SET world_context_ref=jsonb_set(world_context_ref,'{revision}',to_jsonb(repeat('b',64))) WHERE id='${id(220)}'`)
    const changed=await capture(runtime,target)
    assert.ok(compareSnapshots(after,changed).differences.some(diff=>diff.resourceKind==='generation_job'&&diff.id===id(220)&&diff.change==='changed'))
    assert.equal(JSON.stringify({before,after,result,differences:compareSnapshots(after,changed).differences}).includes(privateMarker),false)
  })
})

test('real Identity constraints: quarantine kills restored credentials and rights without forging consent', { timeout: 180000 }, async () => {
  await isolated('identity', async (runtime, target) => {
    await runtime.sql(target, `BEGIN;
      INSERT INTO accounts(id,display_name,registered_at,updated_at) VALUES('${account}','${privateMarker}',clock_timestamp(),clock_timestamp());
      INSERT INTO auth_identities(id,account_id,issuer,subject,created_at,verified_at)
        VALUES('${id(1)}','${account}','https://synthetic.invalid','fixture',clock_timestamp(),clock_timestamp());
      INSERT INTO app_session_slots(id,binding_hash,generation) VALUES('${id(2)}','fixture-slot',1);
      INSERT INTO auth_attempts(id,slot_id,client_registration_key,purpose,idempotency_key,expected_generation,state,state_hash,created_at,expires_at,finished_at)
        VALUES('${id(3)}','${id(2)}','fixture-client','sign_in','completed',1,'completed','fixture-completed',clock_timestamp(),clock_timestamp()+interval '1 day',clock_timestamp());
      INSERT INTO auth_attempts(id,slot_id,client_registration_key,purpose,idempotency_key,expected_generation,state,state_hash,nonce,pkce_verifier,authorization_url,exchange_claim_id,exchange_lease_until,created_at,expires_at)
        VALUES('${id(4)}','${id(2)}','fixture-client','sign_in','pending',2,'pending','fixture-pending','synthetic-nonce','synthetic-verifier','https://synthetic.invalid/authorize','${id(5)}',clock_timestamp()+interval '1 hour',clock_timestamp(),clock_timestamp()+interval '1 day');
      INSERT INTO app_sessions(id,slot_id,client_registration_key,account_id,auth_identity_id,auth_attempt_id,credential_hash,account_access_version,authenticated_at,created_at,expires_at,reauthenticated_at)
        VALUES('${id(6)}','${id(2)}','fixture-client','${account}','${id(1)}','${id(3)}','synthetic-credential',1,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '1 day',clock_timestamp());
      INSERT INTO auth_sms_challenges(id,browser_hash,idempotency_key,phone_hash,purpose,attempt_id,phase,context_cipher,result_cipher)
        VALUES('${id(7)}','synthetic-browser','${id(8)}','synthetic-phone','sign_in','${id(4)}','completed','synthetic-context','synthetic-result');
      INSERT INTO auth_sms_challenges(id,browser_hash,idempotency_key,phone_hash,purpose,phase,context_cipher,lease_until)
        VALUES('${id(9)}','synthetic-browser','${id(10)}','synthetic-phone','sign_in','verifying','synthetic-context',clock_timestamp()+interval '1 hour');
      INSERT INTO data_requests(id,account_id,kind,scope,idempotency_key,request_hash,dispatch_id)
        VALUES('${id(11)}','${account}','export','interaction_data','${id(12)}','fixture','${id(13)}');
      INSERT INTO data_requests(id,account_id,kind,scope,idempotency_key,request_hash,dispatch_id,status,started_at,attempt_id,lease_until)
        VALUES('${id(14)}','${account}','export','account_data','${id(15)}','fixture','${id(16)}','processing',clock_timestamp(),'${id(17)}',clock_timestamp()+interval '1 hour');
      INSERT INTO data_requests(id,account_id,kind,scope,idempotency_key,request_hash,dispatch_id,status,finished_at)
        VALUES('${id(18)}','${account}','export','interaction_data','${id(19)}','fixture','${id(20)}','completed',clock_timestamp());
      INSERT INTO data_request_receipts(receipt_id,request_id,proof_hash) VALUES('${id(21)}','${id(18)}','synthetic-proof');
      INSERT INTO data_exports(request_id,ciphertext,iv,tag,digest,revisions,expires_at)
        VALUES('${id(18)}',decode('01','hex'),decode(repeat('00',12),'hex'),decode(repeat('00',16),'hex'),'fixture','{}',clock_timestamp()+interval '1 day');
      INSERT INTO data_export_grants(id,request_id,session_id,idempotency_key,expires_at)
        VALUES('${id(22)}','${id(18)}','${id(6)}','${id(23)}',clock_timestamp()+interval '1 day');
      INSERT INTO consent_events(account_id,purpose,policy_id,policy_version,decision,authorization_version,idempotency_key,request_fingerprint)
        VALUES('${account}','private_story_storage','0133ea0a-4d27-465c-8544-42bce81c68e9',1,'grant',1,'${id(24)}','fixture-grant');
      INSERT INTO current_consents(account_id,purpose,authorization_version,updated_at)
        VALUES('${account}','private_story_storage',1,clock_timestamp());
      COMMIT;`)
    const granted = await capture(runtime, target)
    await runtime.sql(target, `BEGIN;
      INSERT INTO consent_events(account_id,purpose,policy_id,policy_version,decision,authorization_version,idempotency_key,request_fingerprint)
        VALUES('${account}','private_story_storage','0133ea0a-4d27-465c-8544-42bce81c68e9',1,'revoke',2,'${id(25)}','fixture-revoke');
      UPDATE current_consents SET authorization_version=2,updated_at=clock_timestamp() WHERE account_id='${account}' AND purpose='private_story_storage';
      COMMIT;`)
    const revoked = await capture(runtime, target)
    assert.ok(compareSnapshots(granted, revoked).differences.some(diff => diff.kind === 'resource' && diff.resourceKind === 'consent' && diff.id === 'private_story_storage'))
    const result = await quarantine(runtime, target)
    assert.equal(result.releaseReady, false)
    assert.equal(result.assertions.credentialsAndAdmissionBlocked, true)
    assert.equal(result.beforeCoreDigest, result.afterCoreDigest)
    const after = await capture(runtime, target)
    assert.deepEqual(after.security.resources.filter(row => row.kind === 'consent'), revoked.security.resources.filter(row => row.kind === 'consent'))
    const [proof] = await runtime.query(target, `SELECT
      (SELECT count(*) FROM app_sessions WHERE credential_hash='synthetic-credential' OR status<>'revoked' OR reauthenticated_at IS NOT NULL)::text AS credentials,
      (SELECT count(*) FROM auth_attempts WHERE state='pending' OR exchange_lease_until IS NOT NULL)::text AS attempts,
      (SELECT count(*) FROM data_requests WHERE status<>'failed')::text AS requests,
      (SELECT count(*) FROM accounts WHERE status<>'restricted')::text AS unrestricted`)
    assert.deepEqual(proof, { credentials: '0', attempts: '0', requests: '0', unrestricted: '0' })
    assert.equal(JSON.stringify({ granted, revoked, after, result }).includes(privateMarker), false)
  })
})

test('real Memories constraints: queued/running jobs stop, corrections and removals are detected, text survives', { timeout: 180000 }, async () => {
  await isolated('memories', async (runtime, target) => {
    await runtime.sql(target, `BEGIN;
      INSERT INTO memory_account_cursors(account_id,last_confirmed_seq) VALUES('${account}',4);
      INSERT INTO memories(id,account_id,person_id,client_memory_id,request_hash,confirmed_seq,title,body)
        SELECT value,'${account}','${person}',value,'fixture',seq,'synthetic title','${privateMarker}'
        FROM (VALUES('${id(31)}'::uuid,1),('${id(32)}'::uuid,2),('${id(33)}'::uuid,3),('${id(34)}'::uuid,4)) AS fixture(value,seq);
      INSERT INTO memory_generation_jobs(id,account_id,person_id,source_message_id,source_version,context_refs,person_version,person_access_version,account_access_version,authorization_version,dispatch_id)
        VALUES('${id(35)}','${account}','${person}','${id(36)}',1,'[]',1,1,1,1,'${id(37)}');
      INSERT INTO memory_generation_jobs(id,account_id,person_id,source_message_id,source_version,context_refs,person_version,person_access_version,account_access_version,authorization_version,dispatch_id,state,attempt_id,lease_until,started_at)
        VALUES('${id(38)}','${account}','${person}','${id(39)}',1,'[]',1,1,1,1,'${id(40)}','running','${id(41)}',clock_timestamp()+interval '1 hour',clock_timestamp());
      INSERT INTO memory_generation_jobs(id,account_id,person_id,source_message_id,source_version,context_refs,person_version,person_access_version,account_access_version,authorization_version,dispatch_id,state,candidate_id,finished_at)
        VALUES('${id(42)}','${account}','${person}','${id(43)}',1,'[]',1,1,1,1,'${id(44)}','succeeded','${id(45)}',clock_timestamp());
      INSERT INTO memory_candidates(id,account_id,person_id,generation_job_id,source_message_id,source_version,context_refs,title,body,expires_at)
        VALUES('${id(45)}','${account}','${person}','${id(42)}','${id(43)}',1,'[]','synthetic candidate','${privateMarker}',clock_timestamp()+interval '1 day');
      INSERT INTO automatic_memory_sources(id,account_id,person_id,source_kind,source_id,source_version,state,source_created_at,source_sequence,last_event_at)
        SELECT value,'${account}','${person}','message',source_id,1,'active',statement_timestamp()-interval '2 minutes',seq,statement_timestamp()-interval '2 minutes'
        FROM (VALUES('${id(61)}'::uuid,'${id(71)}'::uuid,1),('${id(62)}'::uuid,'${id(72)}'::uuid,2),('${id(63)}'::uuid,'${id(73)}'::uuid,3),
          ('${id(64)}'::uuid,'${id(74)}'::uuid,4),('${id(65)}'::uuid,'${id(75)}'::uuid,5),('${id(66)}'::uuid,'${id(76)}'::uuid,6)) AS fixture(value,source_id,seq);
      INSERT INTO automatic_memory_jobs(id,account_id,person_id,source_record_id,source_kind,source_id,source_version,source_created_at,source_sequence,
        context_refs,snapshot_hash,person_version,person_access_version,account_access_version,authorization_version,ai_authorization_version,
        dispatch_id,state,attempt_id,attempt_count,lease_until,started_at,finished_at,retryable,entry_count,created_at,updated_at,queued_at,run_after)
        SELECT value,'${account}','${person}',source_record,'message',source_id,1,statement_timestamp()-interval '2 minutes',seq,
          '[]',repeat('a',64),1,1,1,1,1,dispatch,state,
          CASE WHEN state='running' THEN '${id(111)}'::uuid END,CASE WHEN state='running' THEN 1 ELSE 0 END,
          CASE WHEN state='running' THEN statement_timestamp()+interval '1 hour' END,
          CASE WHEN state='running' THEN statement_timestamp()-interval '30 seconds' END,
          CASE WHEN state IN ('succeeded','failed') THEN statement_timestamp() END,state='failed',CASE WHEN state='succeeded' THEN 2 ELSE 0 END,
          statement_timestamp()-interval '1 minute',statement_timestamp(),statement_timestamp()-interval '1 minute',statement_timestamp()-interval '1 minute'
        FROM (VALUES('${id(81)}'::uuid,'${id(61)}'::uuid,'${id(71)}'::uuid,1,'${id(101)}'::uuid,'queued'),
          ('${id(82)}'::uuid,'${id(62)}'::uuid,'${id(72)}'::uuid,2,'${id(102)}'::uuid,'running'),
          ('${id(83)}'::uuid,'${id(63)}'::uuid,'${id(73)}'::uuid,3,'${id(103)}'::uuid,'succeeded'),
          ('${id(84)}'::uuid,'${id(64)}'::uuid,'${id(74)}'::uuid,4,'${id(104)}'::uuid,'failed'),
          ('${id(85)}'::uuid,'${id(65)}'::uuid,'${id(75)}'::uuid,5,'${id(105)}'::uuid,'succeeded')) AS fixture(value,source_record,source_id,seq,dispatch,state);
      INSERT INTO automatic_memory_entries(id,account_id,person_id,source_record_id,generation_job_id,fact_index,source_kind,source_id,source_version,
        reality,source_created_at,source_sequence,sources,topic,body,evidence,person_access_version,account_access_version,authorization_version,ai_authorization_version)
        SELECT value,'${account}','${person}',source_record,job,fact_index,'message',source_id,1,'user_reported',statement_timestamp()-interval '2 minutes',seq,
          '[]','synthetic topic','${privateMarker}','${privateMarker}',1,1,1,1
        FROM (VALUES('${id(91)}'::uuid,'${id(63)}'::uuid,'${id(83)}'::uuid,0,'${id(73)}'::uuid,3),
          ('${id(92)}'::uuid,'${id(65)}'::uuid,'${id(85)}'::uuid,0,'${id(75)}'::uuid,5),
          ('${id(93)}'::uuid,'${id(63)}'::uuid,'${id(83)}'::uuid,1,'${id(73)}'::uuid,3),
          ('${id(94)}'::uuid,'${id(65)}'::uuid,'${id(85)}'::uuid,1,'${id(75)}'::uuid,5)) AS fixture(value,source_record,job,fact_index,source_id,seq);
      INSERT INTO automatic_memory_receipts(origin,event_id,account_id,person_id,request_hash,outcome)
        VALUES('conversations','${id(121)}','${account}','${person}',repeat('f',64),'accepted'),
          ('conversations','${id(122)}','${account}','${person}',repeat('f',64),'accepted');
      COMMIT;`)
    const before = await capture(runtime, target)
    await runtime.sql(target, `BEGIN;
      UPDATE memories SET body='synthetic corrected story',version=version+1,updated_at=clock_timestamp() WHERE id='${id(32)}';
      UPDATE memories SET removed_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE id='${id(31)}';
      DELETE FROM memories WHERE id='${id(34)}';
      UPDATE automatic_memory_entries SET body='synthetic corrected automatic story',version=version+1,updated_at=clock_timestamp() WHERE id='${id(91)}';
      UPDATE automatic_memory_entries SET state='withdrawn',version=version+1,updated_at=clock_timestamp(),state_changed_at=clock_timestamp() WHERE id='${id(92)}';
      DELETE FROM automatic_memory_entries WHERE id='${id(94)}';
      UPDATE automatic_memory_sources SET state='blocked',version=version+1,updated_at=clock_timestamp() WHERE id='${id(64)}';
      DELETE FROM automatic_memory_sources WHERE id='${id(66)}';
      DELETE FROM automatic_memory_receipts WHERE event_id='${id(122)}';
      COMMIT;`)
    const changed = await capture(runtime, target)
    const differences = compareSnapshots(before, changed).differences
    for (const [resourceId, change] of [[id(31), 'changed'], [id(32), 'changed'], [id(34), 'removed']]) {
      assert.ok(differences.some(diff => diff.kind === 'resource' && diff.id === resourceId && diff.change === change))
    }
    for(const [kind,resourceId,change] of [['automatic_memory_entry',id(91),'changed'],['automatic_memory_entry',id(92),'changed'],['automatic_memory_entry',id(94),'removed'],
      ['automatic_memory_source',id(64),'changed'],['automatic_memory_source',id(66),'removed'],['automatic_memory_receipt','conversations:'+id(122),'removed']]){
      assert.ok(differences.some(diff=>diff.kind==='resource'&&diff.resourceKind===kind&&diff.id===resourceId&&diff.change===change))
    }
    const result = await quarantine(runtime, target)
    assert.equal(result.releaseReady, false)
    assert.equal(result.assertions.noExecutableGeneration, true)
    assert.equal(result.beforeCoreDigest, result.afterCoreDigest)
    const [proof] = await runtime.query(target, `SELECT
      (SELECT count(*) FROM memory_generation_jobs WHERE state IN('queued','running') OR retryable)::text AS runnable,
      (SELECT count(*) FROM memory_generation_jobs WHERE id IN('${id(35)}','${id(38)}') AND state='blocked' AND attempt_id IS NULL AND lease_until IS NULL AND finished_at IS NOT NULL)::text AS blocked,
      (SELECT count(*) FROM memory_candidates WHERE id='${id(45)}' AND state='withdrawn' AND body=${literal(privateMarker)})::text AS preserved_candidate,
      (SELECT count(*) FROM memories WHERE id='${id(33)}' AND body=${literal(privateMarker)})::text AS preserved_original,
      (SELECT count(*) FROM memories WHERE id='${id(31)}' AND removed_at IS NOT NULL)::text AS removed_original,
      (SELECT count(*) FROM automatic_memory_jobs WHERE state IN('queued','running') OR retryable)::text AS auto_runnable,
      (SELECT count(*) FROM automatic_memory_jobs WHERE id IN('${id(81)}','${id(82)}','${id(84)}') AND state='blocked' AND attempt_id IS NULL AND lease_until IS NULL AND finished_at IS NOT NULL)::text AS auto_blocked,
      (SELECT count(*) FROM automatic_memory_jobs WHERE state='succeeded' AND version=1 AND dispatch_generation=1)::text AS auto_success_unchanged,
      (SELECT count(*) FROM automatic_memory_entries WHERE id='${id(93)}' AND body=${literal(privateMarker)} AND state='active' AND version=1)::text AS auto_body_unchanged,
      (SELECT count(*) FROM automatic_memory_entries WHERE id='${id(92)}' AND body=${literal(privateMarker)} AND state='withdrawn' AND version=2)::text AS auto_withdrawn_unchanged,
      (SELECT count(*) FROM automatic_memory_entries WHERE id='${id(91)}' AND body='synthetic corrected automatic story' AND version=2)::text AS auto_correction_unchanged`)
    assert.deepEqual(proof, { runnable: '0', blocked: '2', preserved_candidate: '1', preserved_original: '1', removed_original: '1',
      auto_runnable:'0',auto_blocked:'3',auto_success_unchanged:'2',auto_body_unchanged:'1',auto_withdrawn_unchanged:'1',auto_correction_unchanged:'1' })
    assert.equal(JSON.stringify({ before, changed, result, differences }).includes(privateMarker), false)
  })
})

test('pre-005 Memories restore remains supported while an incomplete automatic schema is rejected',{timeout:120000},async()=>{
  await isolated('memories',async(runtime,target)=>{
    const result=await quarantine(runtime,target)
    assert.equal(result.assertions.noExecutableGeneration,true)
    assert.equal(result.beforeCoreDigest,result.afterCoreDigest)
    await runtime.sql(target,'CREATE TABLE automatic_memory_jobs(id uuid PRIMARY KEY)')
    await assert.rejects(quarantine(runtime,target),/Expected recovery table is missing: automatic_memory_sources/)
  },{through:4})
})

test('native predicate normalization preserves casts, literals, Boolean operators and precedence', { timeout: 180000 }, async () => {
  await isolated('memories', async (runtime, target) => {
    let exists = false
    const snapshot = async predicate => {
      if (exists) await runtime.sql(target, 'DROP INDEX public.recovery_predicate_fixture')
      await runtime.sql(target, 'CREATE INDEX recovery_predicate_fixture ON public.memories(id) WHERE ' + predicate)
      exists = true
      return capture(runtime, target)
    }
    const arrayCast = await snapshot("body = ANY (ARRAY['alpha'::varchar,'beta'::varchar]::text[])")
    const elementCasts = await snapshot("body = ANY (ARRAY[('alpha'::varchar)::text,('beta'::varchar)::text])")
    assert.equal(compareSnapshots(arrayCast, elementCasts).equal, true)
    const differentLiteral = await snapshot("body = ANY (ARRAY['alpha'::varchar,'gamma'::varchar]::text[])")
    assert.ok(compareSnapshots(elementCasts, differentLiteral).differences.some(diff => diff.kind === 'schema'))
    const grouped = await snapshot('(version=1 OR version=2) AND removed_at IS NULL')
    const differentPrecedence = await snapshot('version=1 OR (version=2 AND removed_at IS NULL)')
    assert.ok(compareSnapshots(grouped, differentPrecedence).differences.some(diff => diff.kind === 'schema'))
    const differentOperator = await snapshot('(version=1 AND version=2) AND removed_at IS NULL')
    assert.ok(compareSnapshots(grouped, differentOperator).differences.some(diff => diff.kind === 'schema'))
    const differentNot = await snapshot('NOT ((version=1 OR version=2) AND removed_at IS NULL)')
    assert.ok(compareSnapshots(grouped, differentNot).differences.some(diff => diff.kind === 'schema'))
    const literalOperators = await snapshot("body='alpha AND (OR)'")
    const changedLiteralOperators = await snapshot("body='alpha OR (AND)'")
    assert.ok(compareSnapshots(literalOperators, changedLiteralOperators).differences.some(diff => diff.kind === 'schema'))
  })
})
