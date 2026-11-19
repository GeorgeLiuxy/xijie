import{test}from'node:test'
import assert from'node:assert/strict'
import{createHash}from'node:crypto'
import{validateGiftPhotoReferences}from'./gift-photos.mjs'
const targets=[{domain:'gifts'},{domain:'media'},{domain:'people'}]
function command(expectedVersion,mediaId){return{account_id:'a',acceptance_key:'accepted-'+expectedVersion,delivery_id:'d',requested_media_id:mediaId,request_hash:createHash('sha256').update(JSON.stringify({deliveryId:'d',expectedVersion,mediaId})).digest('hex'),expected_version:expectedVersion,result_version:expectedVersion+1}}
function fixture(){
 const bytes=Buffer.from('verified object archive bytes'),sha256=createHash('sha256').update(bytes).digest('hex'),objectKey='ready/a/m/11111111-1111-4111-8111-111111111111'
 const metadata={mime_type:'image/webp',byte_size:bytes.length,width:8,height:8}
 return{schema:[{table_name:'gift_delivery_photos'},{table_name:'gift_photo_commands'}],refs:[{account_id:'a',delivery_id:'d',version:3,media_id:'m',media_version:4,origin:'journey_capture',account_access_version:1,gift_authorization_version:2,photo_authorization_version:2,...metadata}],deliveries:[{id:'d',account_id:'a',person_id:'p',status:'arrived',note:'PRIVATE GIFT NOTE'}],persons:[{id:'p',account_id:'a',status:'active'}],media:[{id:'m',account_id:'a',purpose:'gift_delivery_photo',gift_delivery_id:'d',client_post_id:null,person_draft_id:null,storage_authorization_version:null,gift_storage_authorization_version:1,version:4,status:'ready',sha256,object_key:objectKey,...metadata}],grants:[{account_id:'a',media_id:'m',delivery_id:'d',photo_version:3,media_version:4,state:'active'}],objects:[{key:objectKey,sha256,byteSize:bytes.length,contentType:'image/webp'}],commands:[command(1,'collected-old-media'),command(2,'m')]}
}
const runtime=f=>({query:async(target,sql)=>{
 if(sql.includes('information_schema.tables'))return f.schema
 if(sql.includes('gift_delivery_photos'))return f.refs
 if(sql.includes('gift_photo_commands'))return f.commands
 if(sql.includes('gift_deliveries'))return f.deliveries
 if(sql.includes('public.persons'))return f.persons
 if(sql.includes('media_objects'))return f.media
 if(sql.includes('media_gift_grants'))return f.grants
 throw Error('Unexpected recovery query')
}})
test('gift photo restore connects exact source owner/version to canonical metadata and verified object bytes',async()=>{
 const f=fixture(),report=await validateGiftPhotoReferences(runtime(f),targets,f.objects)
 assert.deepEqual(report,{applicable:true,referenceCount:1,activeReferenceCount:1,sourceCount:1,verified:true})
 assert(!JSON.stringify(report).includes('PRIVATE GIFT NOTE'));assert(!JSON.stringify(report).includes('ready/'))
 for(const change of [x=>x.refs[0].account_id='b',x=>x.refs[0].delivery_id='missing',x=>x.refs[0].version=2,x=>x.refs[0].media_version=5,x=>x.refs[0].width=9,x=>x.refs[0].origin='upload',x=>x.refs[0].photo_authorization_version=0,x=>x.deliveries[0].status='in_transit',x=>x.persons[0].account_id='b',x=>x.persons=[],x=>x.media[0].purpose='person_photo',x=>x.media[0].gift_delivery_id='other',x=>x.media[0].person_draft_id='draft',x=>x.media[0].storage_authorization_version=1,x=>x.media[0].status='revoked',x=>x.grants[0].state='revoked',x=>x.grants[0].photo_version=2,x=>x.grants[0].delivery_id='other',x=>x.grants[0].media_version=5,x=>x.objects[0].sha256='wrong',x=>x.objects[0].byteSize++,x=>x.objects[0].contentType='image/png',x=>{x.media[0].object_key=x.objects[0].key='ready/b/m/11111111-1111-4111-8111-111111111111'},x=>x.objects=[],x=>x.commands[0].result_version=4,x=>x.commands[0].account_id='b']){
  const altered=fixture();change(altered);await assert.rejects(validateGiftPhotoReferences(runtime(altered),targets,altered.objects),/differs/)
 }
})
test('candidate grants, superseded command media and withdrawn captures do not masquerade as current source references',async()=>{
 const f=fixture();f.grants.push({...f.grants[0],photo_version:4,media_id:'pending'})
 // Captured permission versions may differ after regrant; this is a valid ready photo.
 f.refs[0].photo_authorization_version=9;f.refs[0].gift_authorization_version=9
 assert.equal((await validateGiftPhotoReferences(runtime(f),targets,f.objects)).activeReferenceCount,1)
 f.persons[0].status='removed';f.media=[];f.grants=[];f.objects=[]
 assert.deepEqual(await validateGiftPhotoReferences(runtime(f),targets,f.objects),{applicable:true,referenceCount:1,activeReferenceCount:0,sourceCount:1,verified:true})
})
test('each saved photo requires its complete permanent command chain and exact latest media intent',async()=>{
 const mutations=[
  x=>{x.refs[0].version=2;x.grants[0].photo_version=2;x.commands=[]},
  x=>x.commands.shift(),
  x=>x.commands.pop(),
  x=>{x.refs[0].version=4;x.grants[0].photo_version=4;x.commands=[command(1,'old'),command(3,'m')]},
  x=>{x.commands[1]={...command(1,'m'),acceptance_key:'different-key'}},
  x=>{x.commands[1]=command(2,'wrong-latest-media')},
  x=>{x.commands[0].request_hash='0'.repeat(64)},
  x=>{x.commands[0].requested_media_id='changed-without-new-fingerprint'},
  x=>{x.commands[1].acceptance_key=x.commands[0].acceptance_key},
  x=>{delete x.commands[0].acceptance_key},
  x=>{x.commands[0].request_hash=createHash('sha256').update(JSON.stringify({mediaId:x.commands[0].requested_media_id,expectedVersion:1,deliveryId:'d'})).digest('hex')},
  x=>{x.persons[0].status='removed';x.media=[];x.grants=[];x.objects=[];x.commands=[]},
 ]
 for(const change of mutations){const f=fixture();change(f);await assert.rejects(validateGiftPhotoReferences(runtime(f),targets,f.objects),/differs/)}
 // Query row order is irrelevant, and prior accepted media need not still exist.
 const f=fixture();f.commands.reverse();assert.equal((await validateGiftPhotoReferences(runtime(f),targets,f.objects)).verified,true)
 // The first saved version has exactly one successful command from virtual v1.
 f.refs[0].version=2;f.grants[0].photo_version=2;f.commands=[command(1,'m')]
 assert.equal((await validateGiftPhotoReferences(runtime(f),targets,f.objects)).verified,true)
})
test('legacy packages are explicit while partial new schema and missing service databases fail closed',async()=>{
 const f=fixture()
 assert.deepEqual(await validateGiftPhotoReferences(runtime(f),[],[]),{applicable:false,reason:'legacy_without_gifts'})
 f.schema=[];assert.deepEqual(await validateGiftPhotoReferences(runtime(f),targets,[]),{applicable:false,reason:'legacy_without_gift_photos'})
 f.schema=[{table_name:'gift_delivery_photos'}];await assert.rejects(validateGiftPhotoReferences(runtime(f),targets,[]),/incomplete/)
 f.schema=fixture().schema
 for(const domain of ['media','people'])await assert.rejects(validateGiftPhotoReferences(runtime(f),targets.filter(t=>t.domain!==domain),[]),/require/)
})
