import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {DockerRuntime} from './runtime.mjs'
import {capture,quarantine} from './policy.mjs'
const account='11111111-1111-4111-8111-111111111111',client='22222222-2222-4222-8222-222222222222',post='44444444-4444-4444-8444-444444444444'
const id=n=>`33333333-3333-4333-8333-${String(n).padStart(12,'0')}`
const marker='PRIVATE_SYNTHETIC_MEDIA_KEY_SHOULD_NOT_APPEAR'

test('real isolated Media recovery revokes every pending upload and blocks work without altering accepted photo bytes metadata or provenance',{timeout:120000},async()=>{
 const runtime=new DockerRuntime(fileURLToPath(new URL('../../',import.meta.url))),source=await runtime.inspectSource('media'),run='media-policy-'+randomUUID(),target=await runtime.createTarget(source,run)
 try{
  await runtime.sql(target,await readFile(new URL('../../backend/services/media/db/001_media.sql',import.meta.url),'utf8'))
  await runtime.sql(target,`BEGIN;
   INSERT INTO media_account_write_gates(account_id) VALUES('${account}');
   INSERT INTO media_objects(id,account_id,client_post_id,purpose,status,declared_mime,declared_bytes,input_sha256,account_access_version,storage_authorization_version,photo_authorization_version)
   VALUES ${[1,2,3,4].map(n=>`('${id(n)}','${account}','${client}','post_attachment','${n>=3?'verifying':'awaiting_upload'}','image/png',64,'${'a'.repeat(64)}',1,1,1)`).join(',')};
   INSERT INTO media_objects(id,account_id,client_post_id,purpose,status,declared_mime,declared_bytes,input_sha256,account_access_version,storage_authorization_version,photo_authorization_version,revoked_at)
   VALUES('${id(5)}','${account}','${client}','post_attachment','revoked','image/png',64,'${'a'.repeat(64)}',1,1,1,clock_timestamp());
   INSERT INTO media_objects(id,account_id,client_post_id,purpose,status,declared_mime,declared_bytes,input_sha256,mime_type,byte_size,sha256,width,height,object_key,version,account_access_version,storage_authorization_version,photo_authorization_version,verified_at,last_source_checked_at)
   VALUES ${[6,7].map(n=>`('${id(n)}','${account}','${client}','post_attachment','ready','image/png',64,'${'a'.repeat(64)}','image/webp',32,'${'b'.repeat(64)}',32,32,'${marker}/${n}.webp',2,1,1,1,clock_timestamp(),clock_timestamp())`).join(',')};
   INSERT INTO media_upload_slots(id,account_id,media_id,staging_key,state,attempt_id,lease_until,expires_at,uploaded_at,ended_at,input_deleted_at,cleanup_checked_at) VALUES
   ('${id(11)}','${account}','${id(1)}','staging/${id(11)}','active',NULL,NULL,clock_timestamp()+interval '1 hour',NULL,NULL,NULL,clock_timestamp()),
   ('${id(12)}','${account}','${id(2)}','staging/${id(12)}','uploading','${id(22)}',clock_timestamp()+interval '1 minute',clock_timestamp()+interval '1 hour',NULL,NULL,NULL,clock_timestamp()),
   ('${id(13)}','${account}','${id(3)}','staging/${id(13)}','uploaded',NULL,NULL,clock_timestamp()+interval '1 hour',clock_timestamp(),NULL,NULL,clock_timestamp()),
   ('${id(16)}','${account}','${id(6)}','staging/${id(16)}','completed',NULL,NULL,clock_timestamp()+interval '1 hour',clock_timestamp(),clock_timestamp(),clock_timestamp(),clock_timestamp());
   INSERT INTO media_jobs(id,account_id,media_id,kind,media_version,state,attempt_id,lease_until,attempt_count,started_at,finished_at,output_key,output_keys) VALUES
   ('${id(33)}','${account}','${id(3)}','verify',1,'queued',NULL,NULL,0,NULL,NULL,NULL,'{}'),
   ('${id(34)}','${account}','${id(4)}','verify',1,'running','${id(44)}',clock_timestamp()+interval '1 minute',1,clock_timestamp(),NULL,'pending/${id(34)}',ARRAY['pending/${id(34)}','pending/${id(35)}']),
   ('${id(35)}','${account}','${id(5)}','purge',1,'failed',NULL,NULL,7,clock_timestamp(),clock_timestamp(),NULL,'{}'),
   ('${id(36)}','${account}','${id(6)}','verify',1,'succeeded',NULL,NULL,1,clock_timestamp(),clock_timestamp(),'${marker}/6.webp',ARRAY['${marker}/6.webp']);
   INSERT INTO media_use_grants(account_id,media_id,client_post_id,post_id,position,media_version,confirmed_at) VALUES
   ('${account}','${id(6)}','${client}','${post}',1,2,clock_timestamp()),('${account}','${id(7)}','${client}','${post}',2,2,clock_timestamp());
   COMMIT;`)
  const before=await capture(runtime,target),acceptedBefore=await runtime.query(target,"SELECT id,object_key,sha256,byte_size,mime_type,width,height,version,authorization_version,last_source_checked_at FROM media_objects WHERE status='ready' ORDER BY id"),successBefore=await runtime.query(target,"SELECT * FROM media_jobs WHERE state='succeeded' ORDER BY id"),result=await quarantine(runtime,target),after=await capture(runtime,target)
  assert.equal(result.assertions.mediaUploadsAndJobsBlocked,true);assert.equal(result.assertions.coreContentUnchanged,true)
  const slots=await runtime.query(target,'SELECT id,state,attempt_id,lease_until,ended_at,input_deleted_at,cleanup_checked_at FROM media_upload_slots ORDER BY id')
  assert.equal(slots.length,4);assert(slots.filter(row=>row.id!==id(16)).every(row=>row.state==='revoked'&&row.attempt_id===null&&row.lease_until===null&&row.ended_at));assert.equal(slots.find(row=>row.id===id(16)).state,'completed')
  const jobs=await runtime.query(target,'SELECT id,state,attempt_id,lease_until,failure_code,finished_at FROM media_jobs ORDER BY id');assert(jobs.filter(row=>row.id!==id(36)).every(row=>row.state==='blocked'&&row.attempt_id===null&&row.lease_until===null&&row.failure_code==='RESTORE_REVIEW_REQUIRED'&&row.finished_at))
  assert.deepEqual(await runtime.query(target,"SELECT id,object_key,sha256,byte_size,mime_type,width,height,version,authorization_version,last_source_checked_at FROM media_objects WHERE status='ready' ORDER BY id"),acceptedBefore)
  assert.deepEqual(await runtime.query(target,"SELECT * FROM media_jobs WHERE state='succeeded' ORDER BY id"),successBefore)
  for(const name of ['media_jobs','media_upload_slots'])assert.equal(before.core.find(row=>row.name==='public.'+name+':provenance').digest,after.core.find(row=>row.name==='public.'+name+':provenance').digest)
  assert.equal(after.security.resources.filter(row=>row.kind==='media_use_grant').length,2)
  assert.equal(JSON.stringify({before,after,result}).includes(marker),false)
 }finally{await runtime.remove(target,run)}
})
