import{test}from'node:test'
import assert from'node:assert/strict'
import{validatePersonPhotoReferences}from'./person-photos.mjs'
const targets=[{domain:'people'},{domain:'media'}]
function fixture(){
 const common={account_id:'a',media_version:2,mime_type:'image/webp',byte_size:42,width:8,height:8}
 return {refs:[{...common,draft_id:'d',media_id:'m',position:1}],media:[{...common,id:'m',person_draft_id:'d',version:2,status:'ready',sha256:'abc',object_key:'ready/a/m/11111111-1111-4111-8111-111111111111'}],grants:[{account_id:'a',media_id:'m',draft_id:'d',media_version:2,state:'active'}],objects:[{key:'ready/a/m/11111111-1111-4111-8111-111111111111',sha256:'abc',byteSize:42,contentType:'image/webp'}]}
}
const runtime=f=>({query:async(_target,sql)=>sql.includes('to_regclass')?[{present:true}]:sql.includes('person_draft_media')?f.refs:sql.includes('media_objects')?f.media:f.grants})
test('restored person-photo refs require same owner target order version metadata binding and actual bytes',async()=>{
 const f=fixture();assert.deepEqual(await validatePersonPhotoReferences(runtime(f),targets,f.objects),{applicable:true,referenceCount:1,sourceCount:1,verified:true})
 for(const change of [x=>x.refs[0].account_id='b',x=>x.refs[0].draft_id='e',x=>x.refs[0].position=2,x=>x.refs[0].media_version=3,x=>x.refs[0].width=9,x=>x.grants[0].state='revoked',x=>x.objects[0].sha256='bad',x=>x.objects[0].contentType='image/png',x=>{x.media[0].object_key=x.objects[0].key='ready/b/m/11111111-1111-4111-8111-111111111111'},x=>x.objects=[],x=>x.media[0].status='deleted']){
  const altered=fixture();change(altered);await assert.rejects(validatePersonPhotoReferences(runtime(altered),targets,altered.objects),/differs/)
 }
 await assert.rejects(validatePersonPhotoReferences(runtime(f),[{domain:'people'}],f.objects),/require/)
})
test('old backups retain explicit no-person-photo boundary',async()=>{
 assert.deepEqual(await validatePersonPhotoReferences({query:async()=>[{present:false}]},targets,[]),{applicable:false,reason:'legacy_without_person_photos'})
})
