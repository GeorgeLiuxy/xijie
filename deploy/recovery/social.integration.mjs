import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {DockerRuntime} from './runtime.mjs'
import {capture,compareSnapshots,quarantine} from './policy.mjs'
const account='11111111-1111-4111-8111-111111111111',person='22222222-2222-4222-8222-222222222222'
const id=n=>`33333333-3333-4333-8333-${String(n).padStart(12,'0')}`
test('real Social restore preserves private posts, manual interactions, exact movement sources and erasure fences',{timeout:120000},async()=>{
 const runtime=new DockerRuntime(fileURLToPath(new URL('../../',import.meta.url))),source=await runtime.inspectSource('social'),run='social-policy-'+randomUUID(),target=await runtime.createTarget(source,run)
 try{
  await runtime.sql(target,await readFile(new URL('../../backend/services/social/db/001_social.sql',import.meta.url),'utf8'))
  const marker='SYNTHETIC_PRIVATE_SOCIAL_NEVER_REPORT',worldA=id(10),worldB=id(11)
  const card=(world,code)=>({id:world,code,displayName:marker,catalogVersion:1,enabled:true})
  const movement={id:id(3),worldVersion:2,personVersion:2,fromWorld:card(worldA,'courtyard'),toWorld:card(worldB,'tide'),occurredAt:'2026-11-12T00:00:00.000Z',recordedAt:'2026-11-12T00:00:00.000Z'}
  await runtime.sql(target,`BEGIN;
   INSERT INTO social_account_write_gates(account_id) VALUES('${account}');
   INSERT INTO social_person_sync(account_id,person_id,last_projected_world_version,person_access_version) VALUES('${account}','${person}',2,1);
   INSERT INTO posts(id,account_id,kind,client_post_id,request_hash,body) VALUES('${id(1)}','${account}','user','${id(20)}','${'a'.repeat(64)}','${marker}');
   INSERT INTO posts(id,account_id,kind,body,person_id,world_id,source_movement_id,source_world_version,source_movement,source_hash) VALUES('${id(2)}','${account}','world_notice','','${person}','${worldB}','${id(3)}',2,'${JSON.stringify(movement)}','${'b'.repeat(64)}');
   INSERT INTO post_comments(id,account_id,post_id,client_comment_id,request_hash,body) VALUES('${id(4)}','${account}','${id(2)}','${id(21)}','${'c'.repeat(64)}','${marker}');
   INSERT INTO post_reactions(account_id,post_id) VALUES('${account}','${id(2)}');
   UPDATE posts SET comment_count=1,reaction_count=1,version=2 WHERE id='${id(2)}';COMMIT;`)
  const before=await capture(runtime,target),result=await quarantine(runtime,target),after=await capture(runtime,target)
  assert.equal(compareSnapshots(before,after).equal,true);assert.equal(result.assertions.coreContentUnchanged,true)
  const kinds=new Set(before.security.resources.map(row=>row.kind));for(const kind of ['post','post_comment','post_reaction','social_person_sync','erasure'])assert(kinds.has(kind))
  assert.equal(JSON.stringify({before,after,result}).includes(marker),false)
  await assert.rejects(runtime.sql(target,`UPDATE posts SET source_world_version=3 WHERE id='${id(2)}'`))
  await runtime.sql(target,`BEGIN;UPDATE post_comments SET status='removed',removed_at=clock_timestamp(),updated_at=clock_timestamp(),version=2 WHERE id='${id(4)}';UPDATE posts SET comment_count=0,version=3 WHERE id='${id(2)}';COMMIT;`)
  const changed=compareSnapshots(before,await capture(runtime,target));assert(changed.differences.some(row=>row.resourceKind==='post_comment'&&row.change==='changed'))
  await runtime.sql(target,`UPDATE social_account_write_gates SET request_id='${id(30)}',erased_at=clock_timestamp(),updated_at=clock_timestamp(),version=2 WHERE account_id='${account}'`)
  await assert.rejects(runtime.sql(target,`INSERT INTO posts(account_id,kind,client_post_id,request_hash,body) VALUES('${account}','user','${id(31)}','${'d'.repeat(64)}','late restore')`))
 }finally{await runtime.remove(target,run)}
})
