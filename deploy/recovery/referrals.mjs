import {createHash} from 'node:crypto'
const tables=['referral_links','referral_commands','referral_join_intents','referral_auth_bindings','referral_attributions','referral_reward_receipts']
const campaign='first-memory-v1',digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const fail=()=>{throw new Error('Referral registration, qualification or reward closure differs')}
const positive=v=>Number.isSafeInteger(v)&&v>0
const stamp=v=>{const n=Date.parse(v);if(!Number.isFinite(n))fail();return n}
const same=(a,b)=>stamp(a)===stamp(b)
const unique=(rows,key)=>{const m=new Map();for(const r of rows){const k=key(r);if(m.has(k))fail();m.set(k,r)}return m}
const bigint=v=>{if(typeof v!=='string'||!/^[1-9][0-9]{0,18}$/.test(v)||BigInt(v)>9223372036854775807n)fail();return BigInt(v)}

/** Pure metadata verifier. No token, browser hash, name or memory text is needed. */
export function verifyReferralFacts(f){
 const accounts=unique(f.accounts,r=>r.id),links=unique(f.links,r=>r.id),intents=unique(f.intents,r=>r.id),attributions=unique(f.attributions,r=>r.id),registrations=unique(f.registrations,r=>r.account_id),awards=unique(f.awards??[],r=>r.referral_id),identityReceipts=unique(f.receipts,r=>r.account_id+':'+r.attribution_id),giftReceipts=unique(f.giftReceipts??[],r=>r.account_id+':'+r.referral_id),milestones=unique(f.milestones??[],r=>r.event_id)
 const live=id=>{const a=accounts.get(id);if(!a||a.status==='deleted'||!['active','restricted','deletion_pending'].includes(a.status))fail();return a}
 const activeLinks=new Set(),registrationIds=new Set(),invitees=new Set(),intentAttributions=new Set()
 for(const l of links.values()){
  const account=live(l.account_id);if(l.campaign!==campaign||!positive(l.version)||l.public_name_valid!==true||l.token_shape_valid!==true||stamp(l.created_at)<stamp(account.registered_at)||stamp(l.rules_accepted_at)<stamp(l.created_at)||l.revoked_at!=null&&stamp(l.revoked_at)<stamp(l.created_at)||l.revoked_at==null&&l.version!==1||l.revoked_at!=null&&l.version<2)fail()
  if(l.revoked_at==null){const key=l.account_id+':'+l.campaign;if(activeLinks.has(key))fail();activeLinks.add(key)}
 }
 const commands=unique(f.commands,r=>r.account_id+':'+r.idempotency_key)
 for(const c of commands.values()){const l=links.get(c.link_id);if(!l||l.account_id!==c.account_id||!['create','revoke'].includes(c.operation)||c.fingerprint_valid!==true||stamp(c.created_at)<stamp(l.created_at)||c.operation==='revoke'&&l.revoked_at==null)fail()}
 for(const l of links.values())if(!f.commands.some(c=>c.link_id===l.id&&c.operation==='create'))fail()
 for(const i of intents.values()){
  const l=links.get(i.link_id);if(!l||i.campaign!==campaign||i.browser_binding_valid!==true||stamp(i.created_at)<stamp(l.created_at)||stamp(i.expires_at)<=stamp(i.created_at)||stamp(i.rules_accepted_at)<stamp(i.created_at)||i.closed_at!=null&&stamp(i.closed_at)<stamp(i.created_at)||(i.consumed_account_id==null)!==(i.consumed_at==null))fail()
  if(i.consumed_account_id!=null){live(i.consumed_account_id);if(i.consumed_account_id===l.account_id||i.closed_at==null||stamp(i.consumed_at)<stamp(i.rules_accepted_at)||stamp(i.consumed_at)>=stamp(i.expires_at)||stamp(i.closed_at)<stamp(i.consumed_at))fail()}
 }
 unique(f.bindings,r=>r.attempt_id)
 for(const b of f.bindings){const i=intents.get(b.intent_id);if(!i||b.attempt_exists!==true||b.same_browser!==true||b.purpose!=='sign_in'||!['pending','completed','cancelled','expired'].includes(b.state)||stamp(b.created_at)<stamp(i.created_at)||stamp(b.created_at)>=stamp(i.expires_at))fail()}
 for(const r of attributions.values()){
  const l=links.get(r.link_id),i=intents.get(r.intent_id),account=live(r.invitee_account_id),host=live(r.inviter_account_id),event=registrations.get(r.invitee_account_id)
  // registration_id belongs to the account row. Neither auth-attempt IDs nor
  // AccountRegistered event IDs substitute for that immutable identity.
  if(!l||!i||r.campaign!==campaign||r.inviter_account_id===r.invitee_account_id||l.account_id!==host.id||i.link_id!==l.id||i.consumed_account_id!==account.id||r.registration_id!==account.registration_id||registrationIds.has(r.registration_id)||invitees.has(account.id)||intentAttributions.has(i.id)||!same(r.registered_at,account.registered_at)||!same(r.registered_at,i.consumed_at)||l.revoked_at!=null&&stamp(l.revoked_at)<stamp(r.registered_at))fail()
  registrationIds.add(r.registration_id);invitees.add(account.id);intentAttributions.add(i.id)
  if(!event||event.aggregate_type!=='account'||event.aggregate_id!==account.id||event.aggregate_version!==1||event.schema_version!==1||event.payload_account_id!==account.id||event.referral_attribution_id!==r.id||!same(event.occurred_at,r.registered_at)||!same(event.registered_at,r.registered_at))fail()
  const own=[...identityReceipts.values()].filter(x=>x.attribution_id===r.id),award=awards.get(r.id)
  if(r.state==='rewarded'){
   if(!r.receipt_id||r.qualified_at==null||r.rewarded_at==null||stamp(r.qualified_at)<stamp(r.registered_at)||stamp(r.rewarded_at)<stamp(r.qualified_at)||own.length!==2||!award||award.id!==r.receipt_id||!same(award.qualified_at,r.qualified_at))fail()
   for(const role of ['inviter','invitee']){const receipt=own.find(x=>x.role===role);if(!receipt||receipt.account_id!==(role==='inviter'?r.inviter_account_id:r.invitee_account_id)||receipt.receipt_id!==r.receipt_id||!same(receipt.qualified_at,r.qualified_at)||!same(receipt.rewarded_at,r.rewarded_at))fail()}
  }else if(r.state!=='awaiting_memory'||r.receipt_id!=null||r.qualified_at!=null||r.rewarded_at!=null||own.length)fail()
 }
 for(const i of intents.values())if(i.consumed_account_id!=null&&!intentAttributions.has(i.id))fail()
 for(const m of milestones.values()){bigint(String(m.confirmed_seq));if(!['manual','ai_candidate'].includes(m.origin)||m.qualifies!==true)fail();stamp(m.confirmed_at)}
 for(const a of awards.values()){
  const r=attributions.get(a.referral_id),m=milestones.get(a.qualification_event_id),host=giftReceipts.get(a.inviter_account_id+':'+a.referral_id),guest=giftReceipts.get(a.invitee_account_id+':'+a.referral_id)
  if(!r||a.campaign!==campaign||a.inviter_account_id!==r.inviter_account_id||a.invitee_account_id!==r.invitee_account_id||!same(a.registered_at,r.registered_at)||!m||m.account_id!==r.invitee_account_id||m.origin!==a.qualification_origin||String(m.confirmed_seq)!==String(a.confirmed_seq)||!same(m.confirmed_at,a.qualified_at)||stamp(a.qualified_at)<stamp(r.registered_at)||stamp(a.created_at)<stamp(a.qualified_at)||!positive(a.inviter_access_version)||!positive(a.invitee_access_version)||!host||!guest||host.role!=='host'||guest.role!=='guest'||host.receipt_id!==a.id||guest.receipt_id!==a.id)fail()
  const first=[...milestones.values()].filter(m=>m.account_id===r.invitee_account_id).sort((x,y)=>bigint(String(x.confirmed_seq))<bigint(String(y.confirmed_seq))?-1:bigint(String(x.confirmed_seq))>bigint(String(y.confirmed_seq))?1:x.event_id.localeCompare(y.event_id))[0]
  if(first?.event_id!==m.event_id)fail()
  const p={id:r.id,campaign,inviterAccountId:r.inviter_account_id,inviteeAccountId:r.invitee_account_id,registeredAt:new Date(stamp(r.registered_at)).toISOString()},q={eventId:m.event_id,confirmedAt:new Date(stamp(m.confirmed_at)).toISOString(),confirmedSeq:String(m.confirmed_seq),origin:m.origin}
  if(a.request_hash!==digest({referral:p,qualification:q}))fail()
 }
 const orphanReceipts=new Map()
 for(const r of identityReceipts.values()){
  live(r.account_id);if(!['inviter','invitee'].includes(r.role)||stamp(r.rewarded_at)<stamp(r.qualified_at))fail()
  const gift=giftReceipts.get(r.account_id+':'+r.attribution_id);if(!gift||gift.receipt_id!==r.receipt_id||gift.role!==(r.role==='inviter'?'host':'guest')||!same(gift.qualified_at,r.qualified_at))fail()
  if(!attributions.has(r.attribution_id)){const list=orphanReceipts.get(r.attribution_id)??[];list.push(r);orphanReceipts.set(r.attribution_id,list)}
 }
 // Counterparty erasure removes shared attribution and leaves one recipient's
 // own receipt. No deleted peer identity is inferred or reconstructed.
 for(const rs of orphanReceipts.values())if(rs.length!==1||awards.has(rs[0].attribution_id))fail()
 const orphanGiftGroups=new Map()
 for(const g of giftReceipts.values()){
  live(g.account_id);if(!['host','guest'].includes(g.role))fail();const r=attributions.get(g.referral_id),a=awards.get(g.referral_id)
  if(r&&(!a||g.account_id!==(g.role==='host'?r.inviter_account_id:r.invitee_account_id)||g.receipt_id!==a.id||!same(g.qualified_at,a.qualified_at)))fail()
  if(r?.state==='rewarded'&&!identityReceipts.has(g.account_id+':'+g.referral_id))fail()
  if(!r){const n=(orphanGiftGroups.get(g.referral_id)??0)+1;orphanGiftGroups.set(g.referral_id,n);if(n>1)fail()}
 }
 return{verified:true,linkCount:links.size,commandCount:commands.size,intentCount:intents.size,bindingCount:f.bindings.length,attributionCount:attributions.size,rewardedAttributionCount:[...attributions.values()].filter(r=>r.state==='rewarded').length,identityReceiptCount:identityReceipts.size,giftAwardCount:awards.size,giftReceiptCount:giftReceipts.size,survivingPrivateReceiptCount:[...orphanReceipts.values()].length}
}

export async function validateReferralReferences(runtime,targets){
 const identity=targets.find(t=>t.domain==='identity');if(!identity)return{applicable:false,reason:'legacy_without_identity'}
 const schema=await runtime.query(identity,"SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ("+tables.map(t=>"'"+t+"'").join(',')+")"),names=new Set(schema.map(r=>r.table_name).filter(t=>tables.includes(t)))
 if(!names.size)return{applicable:false,reason:'legacy_without_referrals'}
 if(names.size!==tables.length)fail()
 const f={}
 ;[f.accounts,f.links,f.commands,f.intents,f.bindings,f.attributions,f.receipts,f.registrations]=await Promise.all([
  runtime.query(identity,'SELECT id,registration_id,status,registered_at FROM public.accounts'),
  runtime.query(identity,"SELECT id,account_id,campaign,version,created_at,rules_accepted_at,revoked_at,char_length(public_name) BETWEEN 1 AND 32 AND btrim(public_name)<>'' AS public_name_valid,token_hash~'^[a-f0-9]{64}$' AND token_cipher~'^[A-Za-z0-9_-]{95}$' AS token_shape_valid FROM public.referral_links"),
  runtime.query(identity,`SELECT c.account_id,c.operation,c.idempotency_key,c.link_id,c.created_at,
   CASE WHEN c.operation='create' THEN c.request_hash=encode(sha256(convert_to('["create",'||to_json(l.public_name)::text||']','UTF8')),'hex')
   ELSE c.request_hash IN(encode(sha256(convert_to('["revoke",'||to_json(c.link_id::text)::text||',1]','UTF8')),'hex'),encode(sha256(convert_to('["revoke",'||to_json(c.link_id::text)::text||',2]','UTF8')),'hex')) END AS fingerprint_valid
   FROM public.referral_commands c LEFT JOIN public.referral_links l ON l.id=c.link_id`),
  runtime.query(identity,"SELECT id,link_id,campaign,created_at,expires_at,rules_accepted_at,closed_at,consumed_account_id,consumed_at,browser_hash~'^[a-f0-9]{64}$' AS browser_binding_valid FROM public.referral_join_intents"),
  runtime.query(identity,'SELECT b.attempt_id,b.intent_id,a.id IS NOT NULL AS attempt_exists,a.purpose,a.state,a.created_at,s.binding_hash=i.browser_hash AS same_browser FROM public.referral_auth_bindings b LEFT JOIN public.auth_attempts a ON a.id=b.attempt_id LEFT JOIN public.app_session_slots s ON s.id=a.slot_id LEFT JOIN public.referral_join_intents i ON i.id=b.intent_id'),
  runtime.query(identity,'SELECT id,link_id,intent_id,inviter_account_id,invitee_account_id,registration_id,campaign,registered_at,state,receipt_id,qualified_at,rewarded_at FROM public.referral_attributions'),
  runtime.query(identity,'SELECT account_id,attribution_id,receipt_id,role,qualified_at,rewarded_at FROM public.referral_reward_receipts'),
  runtime.query(identity,"SELECT event_id,account_id,aggregate_type,aggregate_id,aggregate_version,schema_version,occurred_at,payload->>'accountId' AS payload_account_id,payload->>'registeredAt' AS registered_at,payload->>'referralAttributionId' AS referral_attribution_id FROM public.outbox_events WHERE type='AccountRegistered.v1'")
 ])
 const gifts=targets.find(t=>t.domain==='gifts');f.awards=[];f.giftReceipts=[];f.milestones=[]
 if(gifts){const gs=await runtime.query(gifts,"SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN('referral_reward_awards','referral_reward_receipts')");if(gs.length&&(!gs.some(r=>r.table_name==='referral_reward_awards')||!gs.some(r=>r.table_name==='referral_reward_receipts')))fail();if(gs.length)[f.awards,f.giftReceipts]=await Promise.all([runtime.query(gifts,'SELECT id,referral_id,campaign,inviter_account_id,invitee_account_id,inviter_access_version,invitee_access_version,registered_at,qualification_event_id,qualified_at,confirmed_seq::text AS confirmed_seq,qualification_origin,request_hash,created_at FROM public.referral_reward_awards'),runtime.query(gifts,'SELECT account_id,referral_id,receipt_id,role,qualified_at FROM public.referral_reward_receipts')])}
 if(f.awards.length){const memories=targets.find(t=>t.domain==='memories');if(!memories)fail();f.milestones=await runtime.query(memories,"SELECT event_id,account_id,payload->>'confirmedAt' AS confirmed_at,payload->>'confirmedSeq' AS confirmed_seq,payload->>'origin' AS origin,true AS qualifies FROM public.outbox_events WHERE type='MemoryConfirmed.v1' AND aggregate_type='memory' AND aggregate_version=1 AND payload->>'qualifiesForReferral'='true' AND payload->>'origin' IN('manual','ai_candidate')")}
 return{applicable:true,...verifyReferralFacts(f)}
}
