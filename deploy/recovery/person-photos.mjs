// Read-only cross-domain validation. No database is treated as the other's FK owner.
export async function validatePersonPhotoReferences(runtime,targets,objects){
 const people=targets.find(t=>t.domain==='people'),media=targets.find(t=>t.domain==='media')
 if(!people)return {applicable:false,reason:'legacy_without_people'}
 const present=(await runtime.query(people,"SELECT to_regclass('public.person_draft_media') IS NOT NULL AS present"))[0]?.present
 if(!present)return {applicable:false,reason:'legacy_without_person_photos'}
 if(!media)throw new Error('Person photos require the Media database and object archive')
 const refs=await runtime.query(people,`SELECT r.*,d.confirmed_at,p.status AS person_status FROM public.person_draft_media r
 JOIN public.person_drafts d ON(d.account_id,d.id)=(r.account_id,r.draft_id)
 LEFT JOIN public.persons p ON(p.account_id,p.source_draft_id)=(d.account_id,d.id)
 WHERE (d.confirmed_at IS NULL AND d.expires_at>statement_timestamp()) OR(d.confirmed_at IS NOT NULL AND p.status='active') ORDER BY r.account_id,r.draft_id,r.position`)
 const photos=await runtime.query(media,"SELECT * FROM public.media_objects WHERE purpose='person_photo'"),grants=await runtime.query(media,'SELECT * FROM public.media_person_grants')
 const byMedia=new Map(photos.map(r=>[r.account_id+':'+r.id,r])),byGrant=new Map(grants.map(r=>[r.account_id+':'+r.media_id,r])),byObject=new Map(objects.map(r=>[r.key,r]))
 const groups=new Map()
 for(const ref of refs){
  const k=ref.account_id+':'+ref.media_id,m=byMedia.get(k),g=byGrant.get(k),o=m&&byObject.get(m.object_key),group=ref.account_id+':'+ref.draft_id,n=(groups.get(group)??0)+1
  if(n>6||ref.position!==n||!m||m.status!=='ready'||m.person_draft_id!==ref.draft_id||m.version!==ref.media_version||!g||g.state!=='active'||g.draft_id!==ref.draft_id||g.media_version!==ref.media_version||!o||o.sha256!==m.sha256||o.byteSize!==m.byte_size||o.contentType!=='image/webp'||!m.object_key.startsWith('ready/'+ref.account_id+'/'+ref.media_id+'/')||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(m.object_key.split('/').at(-1))||['mime_type','byte_size','width','height'].some(f=>ref[f]!==m[f]))throw new Error('Person photo source, binding, metadata or object differs')
  groups.set(group,n)
 }
 return {applicable:true,referenceCount:refs.length,sourceCount:groups.size,verified:true}
}
