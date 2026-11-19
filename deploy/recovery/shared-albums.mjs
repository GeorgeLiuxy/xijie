// Read-only cross-domain closure. Quarantine must preserve these business facts;
// only the three Social recovery_blocked execution flags may change.
import {createHash} from 'node:crypto'
const tables=['shared_albums','shared_album_contributions','shared_album_commands','shared_album_decisions','shared_album_adoptions','shared_album_rewards','shared_album_source_cleanup']
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const fail=()=>{throw new Error('Shared album source, participation, cleanup or reward differs')}
const positive=value=>Number.isSafeInteger(value)&&value>0
const present=value=>typeof value==='string'&&value.length>0
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
const time=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))
const sameTime=(a,b)=>time(a)&&time(b)&&Date.parse(a)===Date.parse(b)
const text=(value,min,max)=>typeof value==='string'&&[...value].length>=min&&[...value].length<=max
const key=(...parts)=>JSON.stringify(parts)
const unique=(rows,identity)=>{const map=new Map();for(const row of rows){const id=identity(row);if(map.has(id))fail();map.set(id,row)}return map}
const rules=a=>{const fields=['kind','rules_version','capacity'],present=fields.filter(k=>a[k]!==undefined).length;if(present&&present!==3)fail();const kind=a.kind??'album',version=a.rules_version??1,capacity=a.capacity??5;if(!['album','home','flight'].includes(kind)||![1,2].includes(version)||kind!=='album'&&version!==2||capacity!==(kind==='flight'?8:5))fail();return{kind,version,capacity}}

export function verifySharedAlbumFacts(f){
 const accounts=unique(f.accounts,r=>r.id),persons=unique(f.persons,r=>r.id),albums=unique(f.albums,r=>r.id),contributions=unique(f.contributions,r=>r.id)
 const adoptions=unique(f.adoptions,r=>r.contribution_id),rewards=unique(f.rewards,r=>key(r.album_id,r.account_id)),cleanup=unique(f.cleanup,r=>r.contribution_id)
 const receipts=unique(f.receipts,r=>key(r.account_id,r.contribution_id)),memories=unique(f.memories,r=>key(r.account_id,r.id)),giftReceipts=unique(f.giftReceipts,r=>key(r.account_id,r.album_id))
 const socialErased=new Set(f.socialGates.filter(r=>r.erased_at).map(r=>r.account_id)),memoryErased=new Set(f.memoryGates.filter(r=>r.erased_at).map(r=>r.account_id)),giftErased=new Set(f.giftGates.filter(r=>r.erased_at).map(r=>r.account_id))
 const account=id=>{const a=accounts.get(id);if(!a||!['active','restricted','deletion_pending','deleted'].includes(a.status))fail();return a}
 for(const id of new Set([...socialErased,...memoryErased,...giftErased]))if(!['deletion_pending','deleted'].includes(account(id).status))fail()
 const person=(id,owner)=>{const p=persons.get(id);if(p){if(p.account_id!==owner||!['active','removed'].includes(p.status))fail()}else if(!f.peopleFences.some(r=>r.account_id===owner&&r.erased_at)||!['deletion_pending','deleted'].includes(account(owner).status))fail()}
 const decisionsFor=(album,id,decision)=>f.decisions.filter(r=>r.album_id===album&&r.contribution_id===(id??null)&&r.decision===decision)
 const redacted=c=>c.status==='withdrawn'&&c.body===''&&c.author_account_id==null&&!f.decisions.some(d=>d.contribution_id===c.id)
 const matchSource=(row,version)=>{
  const a=albums.get(row.album_id),c=contributions.get(row.contribution_id)
  if(!positive(version))fail()
  if(a){if(!c||c.album_id!==a.id||a.account_id!==row.account_id||row.person_id&&a.person_id!==row.person_id)fail();if(c.status==='approved'){if(c.version!==version)fail()}else if(c.status!=='withdrawn'||c.version<=version)fail()}
  else if(!socialErased.has(row.account_id))fail()
  return {a,c}
 }
 for(const a of f.albums){
  rules(a)
  account(a.account_id);person(a.person_id,a.account_id)
  if(socialErased.has(a.account_id)||!text(a.title,1,40)||!text(a.message,1,500)||!hash(a.token_hash)||typeof a.token_cipher!=='string'||!/^[A-Za-z0-9_-]{95}$/.test(a.token_cipher)||!positive(a.version)||!time(a.created_at)||!time(a.updated_at)||!['active','closed'].includes(a.status)||(a.status==='closed')!==time(a.closed_at))fail()
  if(decisionsFor(a.id,null,'create').length!==1||a.status==='closed'&&decisionsFor(a.id,null,'close').length!==1||a.status==='active'&&decisionsFor(a.id,null,'close').length)fail()
 }
 unique(f.albums,r=>r.token_hash);unique(f.contributions,r=>key(r.album_id,r.visitor_hash));unique(f.contributions.filter(r=>r.author_account_id),r=>key(r.album_id,r.author_account_id));unique(f.contributions.filter(r=>r.seat!=null),r=>key(r.album_id,r.seat))
 for(const c of f.contributions){
  const a=albums.get(c.album_id);if(!a||!hash(c.visitor_hash)||c.allow_adoption!==true||!positive(c.version)||!time(c.created_at)||!time(c.updated_at)||!['pending','approved','rejected','withdrawn'].includes(c.status)||!text(c.body,c.status==='withdrawn'?0:1,500))fail()
  if(c.author_account_id){account(c.author_account_id);if(c.author_account_id===a.account_id||socialErased.has(c.author_account_id))fail()}
  if((c.status==='approved')!==(c.seat!=null)||c.seat!=null&&(!positive(c.seat)||c.seat>rules(a).capacity)||c.status==='withdrawn'&&c.body!=='')fail()
  if(!redacted(c)&&decisionsFor(a.id,c.id,'submit_allow_adoption').length!==1)fail()
  if(decisionsFor(a.id,c.id,'approve').length+decisionsFor(a.id,c.id,'reject').length>1)fail()
  if(decisionsFor(a.id,c.id,'owner_approve').length+decisionsFor(a.id,c.id,'owner_reject').length>1)fail()
  if(decisionsFor(a.id,c.id,'approve').length+decisionsFor(a.id,c.id,'owner_approve').length>0&&decisionsFor(a.id,c.id,'reject').length+decisionsFor(a.id,c.id,'owner_reject').length>0)fail()
  if(c.status==='pending'&&(c.version!==1||c.rejection_reason!=null)||c.status==='approved'&&(c.version!==2||c.rejection_reason!=null||decisionsFor(a.id,c.id,'approve').length+decisionsFor(a.id,c.id,'owner_approve').length<1)||c.status==='rejected'&&(c.version!==2||!['not_suitable','unsafe','capacity'].includes(c.rejection_reason)||decisionsFor(a.id,c.id,'reject').length+decisionsFor(a.id,c.id,'owner_reject').length<1)||c.status==='withdrawn'&&c.version<2)fail()
  if(c.author_account_id&&!rewards.has(key(a.id,c.author_account_id))&&!decisionsFor(a.id,c.id,'submit_allow_adoption').some(d=>d.actor_account_id===c.author_account_id))fail()
 }
 unique(f.decisions,r=>r.id)
 for(const d of f.decisions){
  const a=albums.get(d.album_id),c=d.contribution_id&&contributions.get(d.contribution_id)
  if(!a||d.rules_version!==rules(a).version||!time(d.created_at)||d.contribution_id&&(!c||c.album_id!==a.id))fail()
  if(['create','close'].includes(d.decision)){if(c||d.actor_account_id!==a.account_id||d.visitor_hash!=null||d.reviewer!=null)fail()}
  else if(['submit_allow_adoption','withdraw'].includes(d.decision)){if(!c||d.actor_account_id!=null&&d.actor_account_id!==c.author_account_id||d.visitor_hash!==c.visitor_hash||d.reviewer!=null||d.decision==='withdraw'&&c.status!=='withdrawn')fail()}
  else if(['approve','reject'].includes(d.decision)){if(!c||!text(d.reviewer,1,80)||!d.reviewer.trim()||d.actor_account_id!=null||d.visitor_hash!=null||d.decision==='approve'&&!['approved','withdrawn'].includes(c.status)||d.decision==='reject'&&(!['rejected','withdrawn'].includes(c.status)||!['not_suitable','unsafe','capacity'].includes(d.reason)))fail()}
  else if(['owner_approve','owner_reject'].includes(d.decision)){if(!c||d.actor_account_id!==a.account_id||d.reviewer!=null||d.visitor_hash!=null||d.decision==='owner_approve'&&!['approved','withdrawn'].includes(c.status)||d.decision==='owner_reject'&&(!['rejected','withdrawn'].includes(c.status)||d.reason!=='not_suitable'))fail()}
  else if(d.decision==='adopt'){if(!c||d.actor_account_id!==a.account_id||!adoptions.has(c.id)||d.visitor_hash!=null)fail()}
  else if(d.decision==='claim_reward'){if(!c||d.actor_account_id!==c.author_account_id||d.actor_account_id===a.account_id||d.visitor_hash!==c.visitor_hash||!rewards.has(key(a.id,d.actor_account_id)))fail()}
  else if(d.decision==='moderate'){if(!c||c.status!=='withdrawn'||d.actor_account_id!=null||d.visitor_hash!=null||!text(d.reviewer,1,80)||d.reason!=='content_restricted'||!f.commands.some(command=>command.album_id===a.id&&command.resource_id===c.id&&command.operation==='moderate'&&command.actor==='moderator:'+d.reviewer))fail()}
  else fail()
 }
 unique(f.commands,r=>key(r.actor,r.idempotency_key))
 for(const command of f.commands){
  const a=albums.get(command.album_id),c=contributions.get(command.resource_id);if(!a||!hash(command.request_hash)||!present(command.idempotency_key)||!time(command.created_at))fail()
  let request,actor
  if(command.operation==='create'){request={personId:a.person_id,title:a.title,message:a.message,...(rules(a).version===2?{kind:a.kind}:{})};actor='owner:'+a.account_id;if(command.resource_id!==a.id)fail()}
  else if(command.operation==='close'){request={id:a.id};actor='owner:'+a.account_id;if(command.resource_id!==a.id||a.status!=='closed')fail()}
  else{
   if(!c||c.album_id!==a.id)fail()
   if(command.operation==='submit'){const bound=decisionsFor(a.id,c.id,'submit_allow_adoption').find(d=>d.actor_account_id!=null);request=c.status==='withdrawn'?null:{albumId:a.id,text:c.body,allowAdoption:true,...(bound?{accountId:bound.actor_account_id}:{})};actor='visitor:'+c.visitor_hash}
   else if(command.operation==='withdraw'){request={id:c.id};actor='visitor:'+c.visitor_hash;if(c.status!=='withdrawn')fail()}
   else if(command.operation==='adopt'){request={albumId:a.id,id:c.id};actor='owner:'+a.account_id;if(!adoptions.has(c.id))fail()}
   else if(command.operation==='claim_reward'){request={albumId:a.id,contributionId:c.id};actor='owner:'+c.author_account_id;if(!c.author_account_id||!rewards.has(key(a.id,c.author_account_id)))fail()}
   else if(command.operation==='owner_review'){actor='owner:'+a.account_id;const ds=f.decisions.filter(d=>d.contribution_id===c.id&&['owner_approve','owner_reject'].includes(d.decision)),decisions=redacted(c)?['approve','reject']:ds.map(d=>d.decision==='owner_approve'?'approve':'reject');if(!decisions.length||c.status==='pending'||!decisions.flatMap(decision=>[1,2].map(version=>digest(['owner_review',{albumId:a.id,id:c.id,version,decision}]))).includes(command.request_hash))fail()}
   else if(command.operation==='moderate'){const reviewer=command.actor?.replace(/^moderator:/,'');if(command.actor!=='moderator:'+reviewer||!text(reviewer,1,80)||c.status!=='withdrawn'||!decisionsFor(a.id,c.id,'moderate').some(d=>d.reviewer===reviewer))fail();actor=command.actor;const hashes=[c.version-1,c.version].filter(positive).map(version=>digest(['moderate',{albumId:a.id,id:c.id,version}]));if(!hashes.includes(command.request_hash))fail()}
   else fail()
  }
  if(command.actor!==actor||request&&command.request_hash!==digest([command.operation,request]))fail()
 }
 // Each decision accepted through a browser has at least one permanent command.
 // A replay with a new key may add a command without adding a second decision.
 const operation={create:'create',close:'close',submit_allow_adoption:'submit',withdraw:'withdraw',adopt:'adopt',claim_reward:'claim_reward',owner_approve:'owner_review',owner_reject:'owner_review'}
 for(const d of f.decisions){if(operation[d.decision]&&!f.commands.some(c=>c.album_id===d.album_id&&c.resource_id===(d.contribution_id??d.album_id)&&c.operation===operation[d.decision]))fail()}
 for(const r of f.cleanup){
  account(r.account_id);const a=albums.get(r.album_id),c=contributions.get(r.contribution_id)
  if(typeof r.recovery_blocked!=='boolean'||!time(r.created_at)||!Array.isArray(r.erasing_account_ids)||new Set(r.erasing_account_ids).size!==r.erasing_account_ids.length||a&&(a.account_id!==r.account_id||!c||c.album_id!==a.id||c.status!=='withdrawn')||!a&&!socialErased.has(r.account_id))fail()
  if(!a&&!r.erasing_account_ids.includes(r.account_id))fail()
  for(const eraser of r.erasing_account_ids){if(!socialErased.has(eraser)||!['deletion_pending','deleted'].includes(account(eraser).status))fail()}
 }
 for(const r of f.receipts){
  account(r.account_id);if(memoryErased.has(r.account_id)||!['fulfilled','revoked'].includes(r.state)||!time(r.created_at)||!time(r.updated_at)||r.source_version!=null&&!positive(r.source_version))fail()
  const m=r.memory_id&&memories.get(key(r.account_id,r.memory_id)),a=albums.get(r.album_id),c=contributions.get(r.contribution_id)
  if(a&&(a.account_id!==r.account_id||!c||c.album_id!==a.id)||!a&&!socialErased.has(r.account_id))fail()
  if(r.state==='fulfilled'){
   if(!positive(r.source_version)||!present(r.person_id)||!m||m.source_contribution_id!==r.contribution_id||m.source_album_id!==r.album_id||m.source_contribution_version!==r.source_version||m.person_id!==r.person_id)fail()
   const source=matchSource(r,r.source_version)
   const pendingCleanup=cleanup.get(r.contribution_id)
   if(a&&!adoptions.has(r.contribution_id)||source.c?.status!=='approved'&&(!pendingCleanup||pendingCleanup.album_id!==r.album_id||pendingCleanup.account_id!==r.account_id))fail()
  }else if(m||c&&c.status!=='withdrawn')fail()
 }
 for(const m of f.memories){
  account(m.account_id);person(m.person_id,m.account_id);const r=receipts.get(key(m.account_id,m.source_contribution_id)),a=albums.get(m.source_album_id),c=contributions.get(m.source_contribution_id)
  if(memoryErased.has(m.account_id)||m.origin!=='shared_contribution'||m.source_message_id!=null||m.candidate_id!=null||!positive(m.source_contribution_version)||!positive(m.version)||!r||r.state!=='fulfilled'||r.memory_id!==m.id||!hash(m.request_hash)||m.client_memory_id!==m.source_contribution_id)fail()
  if(c?.status==='approved'&&(m.request_hash!==digest([a.id,c.id,m.source_contribution_version,a.title,c.body])||m.version===1&&(m.title!==a.title||m.body!==c.body)))fail()
  const events=f.memoryEvents.filter(e=>e.account_id===m.account_id&&e.aggregate_id===m.id&&e.type==='MemoryConfirmed.v1')
  if(events.length!==1)fail();const e=events[0],p=e.payload
  if(e.aggregate_type!=='memory'||e.aggregate_version!==1||p?.memoryId!==m.id||p.personId!==m.person_id||p.version!==1||p.origin!=='shared_contribution'||p.qualifiesForReferral!==false||p.echoAiAuthorizationVersion!==0||String(p.confirmedSeq)!==String(m.confirmed_seq)||!sameTime(p.confirmedAt,m.confirmed_at))fail()
 }
 for(const row of f.adoptions){
  const {a,c}=matchSource(row,row.source_version),r=receipts.get(key(row.account_id,row.contribution_id))
  if(!a||!c||row.person_id!==a.person_id||typeof row.recovery_blocked!=='boolean'||!time(row.created_at)||!time(row.updated_at)||!['pending','fulfilled','revoked'].includes(row.status)||!redacted(c)&&decisionsFor(a.id,c.id,'adopt').length!==1)fail()
  if(c.status==='withdrawn'&&row.status!=='revoked'||row.status==='fulfilled'&&!present(row.memory_id)||row.memory_id&&r&&row.memory_id!==r.memory_id||r?.source_version!=null&&r.source_version!==row.source_version||r?.person_id!=null&&r.person_id!==row.person_id)fail()
  if(row.status==='fulfilled'&&(!r||r.state!=='fulfilled')&&!memoryErased.has(row.account_id))fail()
  if(row.status==='revoked'&&c.status==='approved'&&(!r||r.state!=='fulfilled'||!memories.get(key(row.account_id,r.memory_id))?.removed_at))fail()
  if(row.memory_id&&!r&&!memoryErased.has(row.account_id))fail()
 }
 unique(f.rewards,r=>r.contribution_id)
 for(const row of f.rewards){
  const a=albums.get(row.album_id),c=contributions.get(row.contribution_id),g=giftReceipts.get(key(row.account_id,row.album_id));account(row.account_id)
  if(!a||!c||c.album_id!==a.id||c.author_account_id!==row.account_id||row.account_id===a.account_id||socialErased.has(row.account_id)||typeof row.recovery_blocked!=='boolean'||!time(row.created_at)||!['pending','fulfilled','canceled'].includes(row.status)||!['approved','withdrawn'].includes(c.status)||decisionsFor(a.id,c.id,'claim_reward').length!==1)fail()
  if(row.dispatch_started_at!=null&&(!time(row.dispatch_started_at)||Date.parse(row.dispatch_started_at)<Date.parse(row.created_at)||a.closed_at&&Date.parse(row.dispatch_started_at)>Date.parse(a.closed_at)))fail()
  if(row.status==='fulfilled'){if(!g||row.receipt_id!==g.id||!sameTime(row.granted_at,g.created_at)||!time(row.dispatch_started_at))fail()}
  else if(row.receipt_id!=null||row.granted_at!=null)fail()
  if(row.status==='pending'&&g&&!time(row.dispatch_started_at)||row.status==='canceled'&&(g||row.dispatch_started_at!=null||a.status==='active'&&c.status==='approved'))fail()
 }
 const transactions=unique(f.giftTransactions,r=>r.id),lots=unique(f.giftLots,r=>r.id)
 unique(f.giftReceipts,r=>r.id);unique(f.giftReceipts,r=>r.transaction_id);unique(f.giftReceipts,r=>r.lot_id)
 for(const g of f.giftReceipts){
  account(g.account_id);const tx=transactions.get(g.transaction_id),lot=lots.get(g.lot_id),entries=f.giftEntries.filter(e=>e.transaction_id===g.transaction_id)
  if(albums.has(g.album_id)&&!socialErased.has(g.account_id)&&!rewards.has(key(g.album_id,g.account_id)))fail()
  if(giftErased.has(g.account_id)||g.campaign!=='shared-album-v1'||!positive(g.account_access_version)||!time(g.created_at)||!tx||!lot||tx.account_id!==g.account_id||tx.reason!=='album_reward'||tx.source_id!=='album:'+g.album_id+':participant:'+g.account_id||tx.policy_version!==g.campaign||tx.request_hash!==digest({accountId:g.account_id,albumId:g.album_id,campaign:g.campaign})||lot.account_id!==g.account_id||lot.source!=='promotion'||lot.asset_type!=='voucher'||lot.asset_id!=='return-stamp'||lot.expires_at!=null||lot.policy_version!==g.campaign||lot.issuance_transaction_id!==tx.id||entries.length!==1||entries[0].account_id!==g.account_id||entries[0].lot_id!==lot.id||entries[0].direction!=='credit'||String(entries[0].units)!=='1'||entries[0].line_no!==1)fail()
  // The source aggregate may have been erased by its initiator. Earned assets
  // remain the survivor's own ledger facts, checked by the Gifts verifier too.
 }
 return{applicable:true,verified:true,albumCount:f.albums.length,contributionCount:f.contributions.length,decisionCount:f.decisions.length,adoptionCount:f.adoptions.length,rewardClaimCount:f.rewards.length,cleanupCount:f.cleanup.length,sharedMemoryCount:f.memories.length,memoryReceiptCount:f.receipts.length,giftReceiptCount:f.giftReceipts.length}
}

export async function validateSharedAlbumReferences(runtime,targets){
 const byDomain=new Map(targets.map(t=>[t.domain,t])),social=byDomain.get('social'),memories=byDomain.get('memories'),gifts=byDomain.get('gifts'),identity=byDomain.get('identity'),people=byDomain.get('people')
 if(!social)return{applicable:false,reason:'legacy_without_social'}
 const found=await runtime.query(social,"SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('"+tables.join("','")+"')")
 if(!found.length)return{applicable:false,reason:'legacy_without_shared_albums'}
 if(found.length!==tables.length||!tables.every(name=>found.some(r=>r.table_name===name)))throw new Error('Shared album schema is incomplete')
 if(!memories||!gifts||!identity||!people)throw new Error('Shared albums require Identity, People, Memories and Gifts authority')
 const [flags,memoryColumns,memorySchema,giftSchema,goalColumns]=await Promise.all([
  runtime.query(social,"SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('shared_album_adoptions','shared_album_rewards','shared_album_source_cleanup') AND column_name='recovery_blocked'"),
  runtime.query(memories,"SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='memories' AND column_name IN ('source_album_id','source_contribution_id','source_contribution_version')"),
  runtime.query(memories,"SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='shared_memory_receipts'"),
  runtime.query(gifts,"SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='album_reward_receipts'"),
  runtime.query(social,"SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='shared_albums' AND column_name IN('kind','rules_version','capacity')")])
 if(goalColumns.length&&(goalColumns.length!==3||!['kind','rules_version','capacity'].every(c=>goalColumns.some(r=>r.column_name===c&&r.data_type===(c==='kind'?'text':'integer')&&r.is_nullable==='NO'))))throw new Error('Shared goal schema is incomplete')
 if(flags.length!==3||!['shared_album_adoptions','shared_album_rewards','shared_album_source_cleanup'].every(t=>flags.some(r=>r.table_name===t&&r.data_type==='boolean'&&r.is_nullable==='NO'))||memoryColumns.length!==3||!['source_album_id','source_contribution_id','source_contribution_version'].every(c=>memoryColumns.some(r=>r.column_name===c))||memorySchema.length!==1||giftSchema.length!==1)throw new Error('Shared album schema is incomplete')
 const queries={accounts:[identity,'SELECT id,status FROM public.accounts'],persons:[people,'SELECT id,account_id,status FROM public.persons'],peopleFences:[people,'SELECT account_id,erased_at FROM public.account_erasure_fences'],socialGates:[social,'SELECT account_id,erased_at FROM public.social_account_write_gates'],memoryGates:[memories,'SELECT account_id,erased_at FROM public.memory_account_write_gates'],giftGates:[gifts,'SELECT account_id,erased_at FROM public.gifts_account_write_gates'],
  albums:[social,'SELECT * FROM public.shared_albums'],contributions:[social,'SELECT * FROM public.shared_album_contributions'],commands:[social,'SELECT * FROM public.shared_album_commands'],decisions:[social,'SELECT * FROM public.shared_album_decisions'],adoptions:[social,'SELECT * FROM public.shared_album_adoptions'],rewards:[social,'SELECT * FROM public.shared_album_rewards'],cleanup:[social,'SELECT * FROM public.shared_album_source_cleanup'],
  receipts:[memories,'SELECT * FROM public.shared_memory_receipts'],memories:[memories,"SELECT *,confirmed_seq::text AS confirmed_seq FROM public.memories WHERE origin='shared_contribution'"],memoryEvents:[memories,"SELECT account_id,aggregate_type,aggregate_id,aggregate_version,type,payload FROM public.outbox_events WHERE type='MemoryConfirmed.v1' AND payload->>'origin'='shared_contribution'"],
  giftReceipts:[gifts,'SELECT * FROM public.album_reward_receipts'],giftTransactions:[gifts,"SELECT * FROM public.ledger_transactions WHERE reason='album_reward'"],giftLots:[gifts,"SELECT * FROM public.asset_lots WHERE policy_version='shared-album-v1'"],giftEntries:[gifts,"SELECT e.*,e.units::text AS units FROM public.ledger_entries e JOIN public.album_reward_receipts r ON r.transaction_id=e.transaction_id"]}
 const facts=Object.fromEntries(await Promise.all(Object.entries(queries).map(async([name,[target,sql]])=>[name,await runtime.query(target,sql)])))
 return verifySharedAlbumFacts(facts)
}
