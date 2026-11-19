// Read-only cross-domain checks against the restored databases and the verified
// object archive. A candidate prebind is not an authoritative Gifts reference.
import{createHash}from'node:crypto'
export async function validateGiftPhotoReferences(runtime,targets,objects){
 const gifts=targets.find(t=>t.domain==='gifts'),media=targets.find(t=>t.domain==='media'),people=targets.find(t=>t.domain==='people')
 if(!gifts)return{applicable:false,reason:'legacy_without_gifts'}
 const schema=await runtime.query(gifts,"SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('gift_delivery_photos','gift_photo_commands')")
 if(!schema.length)return{applicable:false,reason:'legacy_without_gift_photos'}
 if(schema.length!==2||!['gift_delivery_photos','gift_photo_commands'].every(name=>schema.some(row=>row.table_name===name)))throw new Error('Gift photo schema is incomplete')
 if(!media||!people)throw new Error('Gift photos require the Media and People databases and object archive')
 const [refs,deliveries,persons,photos,grants,commands]=await Promise.all([
  runtime.query(gifts,'SELECT * FROM public.gift_delivery_photos'),
  runtime.query(gifts,'SELECT id,account_id,person_id,status FROM public.gift_deliveries'),
  runtime.query(people,'SELECT id,account_id,status FROM public.persons'),
  runtime.query(media,"SELECT * FROM public.media_objects WHERE purpose='gift_delivery_photo'"),
  runtime.query(media,'SELECT * FROM public.media_gift_grants'),
  runtime.query(gifts,'SELECT account_id,acceptance_key,delivery_id,requested_media_id,request_hash,expected_version,result_version FROM public.gift_photo_commands')])
 const byDelivery=new Map(deliveries.map(r=>[r.id,r])),byPerson=new Map(persons.map(r=>[r.id,r])),byMedia=new Map(photos.map(r=>[r.account_id+':'+r.id,r])),byGrant=new Map(grants.map(r=>[r.account_id+':'+r.media_id+':'+r.photo_version,r])),byObject=new Map(objects.map(r=>[r.key,r])),byRef=new Map()
 const positive=v=>Number.isSafeInteger(v)&&v>0,fail=()=>{throw new Error('Gift photo source, binding, metadata or object differs')}
 let activeReferenceCount=0
 for(const ref of refs){
  const d=byDelivery.get(ref.delivery_id),p=d&&byPerson.get(d.person_id),refKey=ref.account_id+':'+ref.delivery_id
  if(!d||d.account_id!==ref.account_id||d.status!=='arrived'||!p||p.account_id!==ref.account_id||!['active','removed'].includes(p.status)||byRef.has(refKey)||!positive(ref.version)||ref.version<2||!positive(ref.media_version)||ref.origin!=='journey_capture'||ref.mime_type!=='image/webp'||!['byte_size','width','height','account_access_version','gift_authorization_version','photo_authorization_version'].every(k=>positive(ref[k])))fail()
  byRef.set(refKey,ref)
  // People removal makes the current source unavailable. Its historical photo
  // receipt may outlive already-collected bytes; consent withdrawal does not.
  if(p.status!=='active')continue
  const m=byMedia.get(ref.account_id+':'+ref.media_id),g=byGrant.get(ref.account_id+':'+ref.media_id+':'+ref.version),o=m&&byObject.get(m.object_key)
  if(!m||m.purpose!=='gift_delivery_photo'||m.status!=='ready'||m.gift_delivery_id!==ref.delivery_id||m.client_post_id!=null||m.person_draft_id!=null||m.storage_authorization_version!=null||!positive(m.gift_storage_authorization_version)||m.version!==ref.media_version||!g||g.state!=='active'||g.delivery_id!==ref.delivery_id||g.photo_version!==ref.version||g.media_version!==ref.media_version||!o||o.sha256!==m.sha256||o.byteSize!==m.byte_size||o.contentType!=='image/webp'||!m.object_key.startsWith('ready/'+ref.account_id+'/'+ref.media_id+'/')||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(m.object_key.split('/').at(-1))||['mime_type','byte_size','width','height'].some(k=>ref[k]!==m[k]))fail()
  activeReferenceCount++
 }
 const byCommands=new Map(),acceptanceKeys=new Set()
 for(const command of commands){
  const refKey=command.account_id+':'+command.delivery_id,ref=byRef.get(refKey),key=command.account_id+':'+command.acceptance_key
  if(!ref||!positive(command.expected_version)||!positive(command.result_version)||command.result_version!==command.expected_version+1||command.result_version>ref.version||typeof command.acceptance_key!=='string'||!command.acceptance_key||acceptanceKeys.has(key)||typeof command.requested_media_id!=='string'||!command.requested_media_id)fail()
  const fingerprint=createHash('sha256').update(JSON.stringify({deliveryId:command.delivery_id,expectedVersion:command.expected_version,mediaId:command.requested_media_id})).digest('hex')
  if(command.request_hash!==fingerprint)fail()
  acceptanceKeys.add(key)
  const chain=byCommands.get(refKey)??[];chain.push(command);byCommands.set(refKey,chain)
 }
 for(const [key,ref]of byRef){
  const chain=(byCommands.get(key)??[]).sort((a,b)=>a.result_version-b.result_version)
  // Every successful replacement advances exactly once from the virtual v1.
  // Old media may be collected, but its permanent accepted command cannot be.
  if(chain.length!==ref.version-1||chain.some((command,index)=>command.result_version!==index+2)||chain.at(-1)?.requested_media_id!==ref.media_id)fail()
 }
 return{applicable:true,referenceCount:refs.length,activeReferenceCount,sourceCount:byRef.size,verified:true}
}
