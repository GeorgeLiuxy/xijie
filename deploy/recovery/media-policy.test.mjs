import {test} from 'node:test'
import assert from 'node:assert/strict'
import {capture,compareSnapshots} from './policy.mjs'

const marker='PRIVATE_PHOTO_CANONICAL_KEY_NOT_FOR_REPORTS'
const runtime=records=>({query:async(_target,sql)=>{
 if(sql.includes('SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind'))return Object.keys(records).map(name=>({schema:'public',name,kind:'r'}))
 if(sql.includes('AS records'))return Object.entries(records).map(([name,records])=>({name:'public.'+name,records:records.map(row=>JSON.stringify(row))}))
 return []
}})
const fixture=(blocked=false)=>({
 media_objects:[{id:'media-a',account_id:'actor',status:'ready',version:2,authorization_version:1,object_key:marker,sha256:'a'.repeat(64),byte_size:13,photo_authorization_version:1}],
 media_upload_slots:[{id:'slot',account_id:'actor',media_id:'media-a',state:blocked?'revoked':'uploading',version:blocked?2:1,staging_key:marker,upload_key:'upload',attempt_id:blocked?null:'lease',lease_until:blocked?null:'future',created_at:'before',expires_at:'future',ended_at:blocked?'now':null,uploaded_at:null,input_deleted_at:null,cleanup_checked_at:'before'}],
 media_jobs:[{id:'pending',account_id:'actor',media_id:'media-a',kind:'verify',media_version:1,state:blocked?'blocked':'running',version:blocked?2:1,attempt_id:blocked?null:'attempt',lease_until:blocked?null:'future',failure_code:blocked?'RESTORE_REVIEW_REQUIRED':null,updated_at:blocked?'now':'before',finished_at:blocked?'now':null,output_key:marker,output_keys:[marker,'original-attempt-key'],created_at:'before'},
 {id:'success',account_id:'actor',media_id:'media-b',kind:'verify',media_version:1,state:'succeeded',version:2,attempt_id:null,lease_until:null,output_key:marker,output_keys:[marker],finished_at:'before'}],
 media_use_grants:[{account_id:'actor',media_id:'media-a',post_id:'same-post',position:1,media_version:2,state:'active'},{account_id:'actor',media_id:'media-b',post_id:'same-post',position:2,media_version:2,state:'active'}],
})
const provenance=(snapshot,table)=>snapshot.core.find(row=>row.name==='public.'+table+':provenance').digest

test('Media quarantine normalizes only admission controls; canonical hashes, successful jobs and output/staging cleanup lineage stay exact',async()=>{
 const before=await capture(runtime(fixture()),{domain:'media'}),blocked=await capture(runtime(fixture(true)),{domain:'media'})
 assert.deepEqual(before.core,blocked.core)
 for(const [table,field,value]of [['media_upload_slots','input_deleted_at','now'],['media_upload_slots','cleanup_checked_at','later'],['media_jobs','output_keys',['different-key']],['media_jobs','media_version',2]]){
  const rows=fixture();rows[table][0][field]=value;const changed=await capture(runtime(rows),{domain:'media'});assert.notEqual(provenance(before,table),provenance(changed,table))
 }
 const changed=fixture();changed.media_objects[0].sha256='b'.repeat(64);assert(compareSnapshots(before,await capture(runtime(changed),{domain:'media'})).differences.some(row=>row.resourceKind==='media'&&row.change==='changed'))
 assert.equal(JSON.stringify({before,blocked}).includes(marker),false)
})

test('Media grants and Social photo references keep one resource identity per composite relation rather than collapsing a post',async()=>{
 const records=fixture(),media=await capture(runtime(records),{domain:'media'})
 assert.deepEqual(media.security.resources.filter(row=>row.kind==='media_use_grant').map(row=>row.id).sort(),['media-a','media-b'])
 const one=fixture();one.media_use_grants.pop();const changes=compareSnapshots(media,await capture(runtime(one),{domain:'media'})).differences
 assert(changes.some(row=>row.resourceKind==='media_use_grant'&&row.id==='media-b'&&row.change==='removed'));assert(!changes.some(row=>row.resourceKind==='media_use_grant'&&row.id==='media-a'))
 const refs={post_media:[{account_id:'actor',post_id:'same-post',media_id:'media-a',position:1,media_version:2},{account_id:'actor',post_id:'same-post',media_id:'media-b',position:2,media_version:2}]}
 const social=await capture(runtime(refs),{domain:'social'});assert.deepEqual(social.security.resources.map(row=>row.id).sort(),['same-post:media-a','same-post:media-b'])
 refs.post_media[1].media_version=3;assert(compareSnapshots(social,await capture(runtime(refs),{domain:'social'})).differences.some(row=>row.resourceKind==='post_media'&&row.id==='same-post:media-b'))
})

test('gift media grants retain independent candidate photo versions in checkpoints',async()=>{
 const records=fixture();records.media_gift_grants=[2,3].map(photo_version=>({account_id:'actor',media_id:'media-a',delivery_id:'delivery-a',photo_version,media_version:2,state:'active'}))
 const before=await capture(runtime(records),{domain:'media'})
 assert.deepEqual(before.security.resources.filter(r=>r.kind==='media_gift_grant').map(r=>r.id).sort(),['media-a:2','media-a:3'])
 records.media_gift_grants.pop()
 const changes=compareSnapshots(before,await capture(runtime(records),{domain:'media'})).differences
 assert(changes.some(r=>r.resourceKind==='media_gift_grant'&&r.id==='media-a:3'&&r.change==='removed'))
 assert(!changes.some(r=>r.resourceKind==='media_gift_grant'&&r.id==='media-a:2'))
})
