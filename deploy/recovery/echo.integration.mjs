import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {DockerRuntime} from './runtime.mjs'
import {capture,quarantine} from './policy.mjs'
const account='11111111-1111-4111-8111-111111111111',person='22222222-2222-4222-8222-222222222222'
const id=n=>`33333333-3333-4333-8333-${String(n).padStart(12,'0')}`
test('real echo recovery blocks queued and running model work while preserving exact accepted sources and manual records',{timeout:120000},async()=>{
 const runtime=new DockerRuntime(fileURLToPath(new URL('../../',import.meta.url))),source=await runtime.inspectSource('social'),run='echo-policy-'+randomUUID(),target=await runtime.createTarget(source,run)
 try{
  for(const file of ['001_social.sql','002_memory_echo.sql'])await runtime.sql(target,await readFile(new URL('../../backend/services/social/db/'+file,import.meta.url),'utf8'))
  await runtime.sql(target,`BEGIN;
   INSERT INTO social_account_write_gates(account_id) VALUES('${account}');
   INSERT INTO posts(id,account_id,kind,client_post_id,request_hash,body) VALUES('${id(10)}','${account}','user','${id(11)}','${'a'.repeat(64)}','SYNTHETIC_PRIVATE_ECHO_RECOVERY');
   INSERT INTO social_memory_sources(account_id,person_id,memory_id,source_version,state) VALUES('${account}','${person}','${id(1)}',1,'active'),('${account}','${person}','${id(2)}',1,'active');
   INSERT INTO social_generation_jobs(id,account_id,person_id,memory_id,memory_version,kind,person_version,person_access_version,account_access_version,authorization_version,ai_authorization_version,dispatch_id)
     VALUES('${id(3)}','${account}','${person}','${id(1)}',1,'memory_echo',1,1,1,1,1,'${id(5)}');
   INSERT INTO social_generation_jobs(id,account_id,person_id,memory_id,memory_version,kind,person_version,person_access_version,account_access_version,authorization_version,ai_authorization_version,dispatch_id,state,attempt_id,started_at,lease_until,attempt_count)
     VALUES('${id(4)}','${account}','${person}','${id(2)}',1,'memory_echo',1,1,1,1,1,'${id(6)}','running','${id(7)}',clock_timestamp(),clock_timestamp()+interval '1 minute',1);
   COMMIT;`)
  const before=await capture(runtime,target),result=await quarantine(runtime,target),after=await capture(runtime,target)
  assert.equal(result.assertions.noExecutableGeneration,true);assert.equal(result.assertions.coreContentUnchanged,true)
  const jobs=await runtime.query(target,'SELECT state,retryable,attempt_id,lease_until,failure_code FROM social_generation_jobs ORDER BY id')
  assert.equal(jobs.length,2);assert(jobs.every(row=>row.state==='blocked'&&row.retryable===false&&row.attempt_id===null&&row.lease_until===null&&row.failure_code==='RESTORE_REVIEW_REQUIRED'))
  const provenance=value=>value.core.find(row=>row.name==='public.social_generation_jobs:provenance').digest
  assert.equal(provenance(before),provenance(after));assert.equal(JSON.stringify({before,after,result}).includes('SYNTHETIC_PRIVATE_ECHO_RECOVERY'),false)
 }finally{await runtime.remove(target,run)}
})
