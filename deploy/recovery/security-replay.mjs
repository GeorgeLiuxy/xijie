import {createHash} from 'node:crypto'
import {verifyFinancialOperations} from './financial-operations.mjs'
import {isModelAttemptUsage} from '../../backend/runtime/model-execution.mjs'

const ident=s=>'"'+String(s).replaceAll('"','""')+'"',lit=s=>"'"+String(s).replaceAll("'","''")+"'",table=t=>ident(t.schema)+'.'+ident(t.name)
const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v)
const hash=v=>createHash('sha256').update(stable(v)).digest('hex'),key=r=>stable(r.key),fail=m=>{throw Error('Security replay '+m)}
const digest=/^[a-f0-9]{64}$/,uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const tokenStores=new Set(['oidc_model_instances','oidc_session_extensions','idp_initiated_saml_sso_sessions','saml_application_sessions'])
const transientIdentity=new Set(['auth_sms_challenges','native_auth_handoffs','native_wechat_transactions','auth_password_challenges','auth_password_logins'])
const fences=new Set(['account_erasure_fences','memory_account_write_gates','memory_erasure_receipts','social_account_write_gates','media_account_write_gates','media_erase_receipts','gifts_account_write_gates','gifts_erase_receipts'])
const safeColumns=new Set(['account_id','request_id','version','created_at','updated_at','erased_at','completed_at','state','financial_retention'])
const accountColumns=new Set(['id','registration_id','status','display_name','locale','version','access_version','memory_confirmation_seq','registered_at','updated_at','deletion_requested_at','deleted_at','credential_fenced_at','credential_password_pending','call_interest_version','voice_call_interest_at','video_call_interest_at'])
const credentialColumns=new Set(['issuer','subject','fenced_at','password_pending'])
const eventColumns=new Set(['id','account_id','purpose','policy_id','policy_version','decision','authorization_version','recorded_at','idempotency_key','request_fingerprint','notice_authorization_version','notice_purpose'])
const currentColumns=new Set(['account_id','purpose','authorization_version','updated_at'])
const dayColumns=new Set(['account_id','utc_day','attempts']),executionColumns=new Set(['id','account_id','job_id','service','purpose','authorizations','claimed_at','lease_until','finished_at','result_allowed','usage'])
const operatorColumns=new Set(['id','account_id','order_id','kind','resource_id','deletion_request_id','action','reviewer','reason_code','request_hash','ordinal','state','lease_until','result_code','created_at','finished_at','applied_txid'])
const authorizationNames=new Set(['productionModelExecution','voiceCalls','storyStorage','aiTextProcessing','photoStorage','giftStorage','giftReturns','personPhotoStorage','giftPhotoStorage','letterStorage','letterReplies','gatherReplies','chatPhotoStorage','worldActionProcessing','storyBranches','offlineLife','chatImageReplies','chatReplySpeech']),authorizationFields=new Set(['allowed','authorizationVersion','privateFeedAllowed','automaticMemoryAllowed','privateFeedProcessingAllowed','historicalWorldEventsAllowed'])
const metadataTables=new Set(['financial_retention_records','model_execution_days','model_executions','commerce_operator_commands','auth_credential_fences'])
// Reviewed application schemas. A new table needs an explicit ownership review
// before a checkpoint may authorize deletion or carry safe metadata from it.
const knownTables=Object.fromEntries(Object.entries({
 identity:'account_profile_commands accounts app_session_slots app_sessions auth_attempts auth_identities auth_sms_challenges auth_credential_fences auth_password_challenges auth_password_logins consent_events content_report_audit content_report_commands content_reports current_consents data_export_grants data_exports data_request_receipts data_requests data_rights_commands model_execution_days model_executions native_auth_handoffs native_wechat_transactions outbox_events policy_versions referral_attributions referral_auth_bindings referral_commands referral_join_intents referral_links referral_reward_receipts',
 people:'account_erasure_fences automatic_memory_event_acks outbox_events person_draft_commands person_draft_media person_draft_voice person_draft_voice_epochs person_drafts person_previews person_reminder_commands person_reminder_notifications person_reminder_settings person_world_movements persons worlds',
 conversations:'account_erasure_fences automatic_memory_event_acks call_sessions call_grants chat_reply_speech conversation_commands conversations gather_reply_jobs gather_reply_participants gather_reply_slots generation_jobs letter_read_cursors letter_replies letter_reply_jobs letters message_media messages offline_life_plans offline_life_runs outbox_events person_world_events photo_reply_jobs story_branches story_events story_jobs story_messages',
 memories:'automatic_memory_entries automatic_memory_jobs automatic_memory_receipts automatic_memory_sources candidate_commands memories memory_account_cursors memory_account_write_gates memory_candidates memory_commands memory_erasure_receipts memory_generation_jobs memory_import_batches memory_import_items outbox_events shared_memory_receipts social_memory_event_acks',
 social:'outbox_events post_comments post_media post_reactions posts shared_album_adoptions shared_album_commands shared_album_contributions shared_album_decisions shared_album_rewards shared_album_source_cleanup shared_albums social_account_write_gates social_commands social_generation_jobs social_memory_receipts social_memory_sources social_person_sync',
 media:'media_account_write_gates media_commands media_conversation_grants media_erase_receipts media_gift_grants media_jobs media_objects media_person_grants media_upload_slots media_use_grants person_voice_assets person_voice_upload_slots person_voice_jobs person_voice_grants person_voice_commands',
 gifts:'album_reward_receipts asset_lots commerce_commands commerce_operator_commands commerce_orders commerce_payment_attempts commerce_quotes commerce_reconciliation_jobs commerce_refund_reservations commerce_refunds commerce_verified_evidence financial_retention_records gift_catalog_items gift_deliveries gift_delivery_photos gift_mutation_receipts gift_notifications gift_photo_commands gift_received_projection_jobs gift_return_jobs gifts_account_write_gates gifts_erase_receipts gifts_jobs ledger_entries ledger_transactions outbox_events received_gifts referral_reward_awards referral_reward_receipts',
}).map(([domain,list])=>[domain,new Set([...list.split(' '),domain+'_schema_migrations'])]))
const scalar=v=>v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isSafeInteger(v)
function validateSafe(t,r){
 if(t.name==='financial_retention_records'){verifyFinancialOperations({financial_retention_records:[r]});return}
 const allowed=t.name==='accounts'?accountColumns:t.name==='auth_credential_fences'?credentialColumns:t.name==='consent_events'?eventColumns:t.name==='current_consents'?currentColumns:t.name==='model_execution_days'?dayColumns:t.name==='model_executions'?executionColumns:t.name==='commerce_operator_commands'?operatorColumns:safeColumns
 if(!r||Object.keys(r).some(k=>!allowed.has(k)||!['financial_retention','authorizations','usage'].includes(k)&&!scalar(r[k])))fail('safe metadata shape is unsupported')
 if(t.name==='accounts'&&(r.status!=='deleted'||r.display_name!==''||r.locale!=='und'||r.voice_call_interest_at!=null||r.video_call_interest_at!=null||r.call_interest_version!==undefined&&r.call_interest_version!==1))fail('deleted identity is not scrubbed')
 if(t.name==='accounts'&&(r.credential_fenced_at!=null||r.credential_password_pending!=null))fail('deleted identity retained a credential operation')
 if(t.name==='auth_credential_fences'){
  let issuer;try{issuer=new URL(r.issuer)}catch{fail('credential fence issuer differs')}
  if(!['http:','https:'].includes(issuer.protocol)||issuer.username||issuer.password||issuer.hash||issuer.search||typeof r.subject!=='string'||!r.subject||r.subject.length>256||/[\x00-\x20\x7f]/.test(r.subject)||!Number.isFinite(Date.parse(r.fenced_at))||r.password_pending!==null&&!uuid.test(r.password_pending))fail('credential fence metadata differs')
 }
 if(t.name==='consent_events'&&(r.decision!=='revoke'||!uuid.test(r.account_id)||!Number.isSafeInteger(r.authorization_version)))fail('cannot import an authorization grant')
 if(t.name==='model_execution_days'&&(!uuid.test(r.account_id)||!Number.isSafeInteger(r.attempts)||r.attempts<1||!/^\d{4}-\d{2}-\d{2}$/.test(r.utc_day)))fail('model budget metadata differs')
 if(t.name==='model_executions'&&(!uuid.test(r.id)||!uuid.test(r.account_id)||!uuid.test(r.job_id)||!['conversations','memories','social','gifts'].includes(r.service)||!['voice_call','speech_reply','text_reply','world_action','letter_reply','gather_reply','photo_reply','story_branch','offline_life','memory_suggest','automatic_memory','memory_echo','gift_return'].includes(r.purpose)||!r.authorizations||Object.entries(r.authorizations).some(([k,v])=>!authorizationNames.has(k)||!v||typeof v!=='object'||Array.isArray(v)||Object.entries(v).some(([name,value])=>!authorizationFields.has(name)||(name==='authorizationVersion'?!Number.isSafeInteger(value)||value<0:typeof value!=='boolean')))))fail('model attempt metadata differs')
 if(t.name==='model_executions'&&r.usage!=null&&(!isModelAttemptUsage(r.usage)||!r.finished_at||r.result_allowed&&r.usage.state!=='returned'))fail('model usage metadata differs')
 if(t.name==='commerce_operator_commands'&&(!uuid.test(r.id)||!/^[-a-zA-Z0-9._@]{1,80}$/.test(r.reviewer)||!/^[-a-zA-Z0-9._]{1,80}$/.test(r.reason_code)||!digest.test(r.request_hash)))fail('operator metadata differs')
 if(r.financial_retention!=null){const v=r.financial_retention;if(v.status==='none'){if(Object.keys(v).length!==1)fail('financial receipt shape differs')}else if(v.status!=='retained'||!uuid.test(v.archiveId)||!/^[-a-zA-Z0-9._]{1,80}$/.test(v.policyVersion)||!Number.isFinite(Date.parse(v.retainUntil))||Object.keys(v).some(k=>!['status','archiveId','policyVersion','retainUntil'].includes(k)))fail('financial receipt shape differs')}
}
function shape(domain,tables){return hash({domain,tables:tables.map(({schema,name,pk,columns,foreignKeys,skip})=>({schema,name,pk,columns,foreignKeys,skip}))})}
const keySql=(t,alias='r')=>'jsonb_build_array('+t.pk.map(k=>alias+'.'+ident(k)+'::text').join(',')+')'
export async function captureSecurityReplay(runtime,target){
 const selected=target.domain==='logto'?"n.nspname<>'information_schema' AND n.nspname!~'^pg_'":"n.nspname='public'"
 const defs=await runtime.query(target,`SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind,
  COALESCE((SELECT json_agg(a.attname ORDER BY x.ordinality) FROM pg_constraint k CROSS JOIN LATERAL unnest(k.conkey) WITH ORDINALITY x(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=x.attnum WHERE k.conrelid=c.oid AND k.contype='p'),'[]'::json) AS pk,
  (SELECT json_agg(json_build_object('name',a.attname,'generated',a.attgenerated<>'') ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns,
  COALESCE((SELECT json_agg(json_build_object('name',k.conname,'parentSchema',pn.nspname,'parentTable',pc.relname,'match',k.confmatchtype,'columns',(SELECT json_agg(a.attname ORDER BY x.ordinality) FROM unnest(k.conkey) WITH ORDINALITY x(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=x.attnum),'parentColumns',(SELECT json_agg(a.attname ORDER BY x.ordinality) FROM unnest(k.confkey) WITH ORDINALITY x(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=pc.oid AND a.attnum=x.attnum)) ORDER BY k.conname) FROM pg_constraint k JOIN pg_class pc ON pc.oid=k.confrelid JOIN pg_namespace pn ON pn.oid=pc.relnamespace WHERE k.conrelid=c.oid AND k.contype='f'),'[]'::json) AS "foreignKeys"
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (${selected}) AND c.relkind IN('r','p') ORDER BY n.nspname,c.relname`)
 const tables=[]
 for(const d of defs){
  if(target.domain!=='logto'&&(!knownTables[target.domain]?.has(d.name)||d.schema!=='public'))fail('schema contains an unsupported table')
  if(d.kind!=='r')fail('does not support partitioned tables')
  const t={schema:d.schema,name:d.name,pk:d.pk,columns:d.columns,foreignKeys:d.foreignKeys,skip:target.domain==='logto'&&tokenStores.has(d.name),rows:[],safeRows:[]}
  if(!Array.isArray(t.pk)||!Array.isArray(t.columns)||!Array.isArray(t.foreignKeys))fail('catalog differs')
  if(!t.skip){
   if(!t.pk.length){if((await runtime.query(target,'SELECT 1 FROM '+table(t)+' LIMIT 1')).length)fail('nonempty table has no primary key')}
   else{
    const owner=target.domain==='logto'?'NULL::text':t.columns.some(c=>c.name==='account_id')?'r.account_id::text':target.domain==='identity'&&t.name==='accounts'?'r.id::text':target.domain==='identity'&&t.name==='auth_credential_fences'?'(SELECT i.account_id::text FROM '+ident(t.schema)+'.auth_identities i WHERE i.issuer=r.issuer AND i.subject=r.subject LIMIT 1)':'NULL::text'
    t.rows=await runtime.query(target,`SELECT ${keySql(t)} AS key,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') AS hash,${owner} AS "accountId" FROM ${table(t)} r ORDER BY ${t.pk.map(k=>'r.'+ident(k)).join(',')}`)
    if(t.rows.length>100000)fail('row metadata exceeds supported bound')
    if(fences.has(t.name)||metadataTables.has(t.name)||target.domain==='identity'&&t.name==='accounts'){
     const rows=await runtime.query(target,'SELECT to_jsonb(r) AS value FROM '+table(t)+' r'+(t.name==='accounts'?" WHERE status='deleted'":''))
     t.safeRows=rows.map(r=>r.value);for(const r of t.safeRows)validateSafe(t,r)
    }
   }
  }
  tables.push(t)
 }
 let revocations=[]
 if(target.domain==='identity'&&tables.some(t=>t.name==='current_consents')){revocations=(await runtime.query(target,"SELECT to_jsonb(e) AS event,to_jsonb(c) AS current FROM public.current_consents c JOIN public.consent_events e USING(account_id,purpose,authorization_version) WHERE e.decision='revoke' ORDER BY c.account_id,c.purpose"));for(const r of revocations){validateSafe({name:'consent_events'},r.event);validateSafe({name:'current_consents'},r.current)}}
 const result={domain:target.domain,schemaHash:shape(target.domain,tables),tables,revocations};validateReplayDomain(result);return result
}
export function validateReplayDomain(d){
 if(!d||typeof d.domain!=='string'||!digest.test(d.schemaHash)||!Array.isArray(d.tables)||d.tables.length>1000||!Array.isArray(d.revocations))fail('metadata is invalid')
 const names=new Set()
 for(const t of d.tables){const name=t.schema+'.'+t.name;if(names.has(name)||typeof t.schema!=='string'||typeof t.name!=='string'||!Array.isArray(t.pk)||!Array.isArray(t.columns)||!Array.isArray(t.foreignKeys)||!Array.isArray(t.rows)||!Array.isArray(t.safeRows)||typeof t.skip!=='boolean')fail('table metadata is invalid');names.add(name);const keys=new Set();for(const r of t.rows){if(!Array.isArray(r.key)||!t.pk.length||r.key.length!==t.pk.length||r.key.some(k=>typeof k!=='string'||k.length>4096)||!digest.test(r.hash)||r.accountId!=null&&!uuid.test(r.accountId)||keys.has(key(r)))fail('row metadata is invalid');keys.add(key(r))}for(const r of t.safeRows)validateSafe(t,r);if(t.skip&&(d.domain!=='logto'||!tokenStores.has(t.name)||t.rows.length||t.safeRows.length))fail('table skip is unsupported')}
 if(shape(d.domain,d.tables)!==d.schemaHash)fail('schema metadata authentication differs')
 for(const t of d.tables)for(const fk of t.foreignKeys)if(!names.has(fk.parentSchema+'.'+fk.parentTable)||!['s','f'].includes(fk.match)||!Array.isArray(fk.columns)||!fk.columns.length||!Array.isArray(fk.parentColumns)||fk.columns.length!==fk.parentColumns.length)fail('foreign reference closure is unsupported')
 for(const r of d.revocations){validateSafe({name:'consent_events'},r.event);validateSafe({name:'current_consents'},r.current);if(r.current.account_id!==r.event.account_id||r.current.purpose!==r.event.purpose||r.current.authorization_version!==r.event.authorization_version)fail('revocation reference differs')}
 return d
}
function dangling(t,fk){const columns=fk.columns.map(c=>'r.'+ident(c)),nulls=columns.map(c=>c+' IS NULL').join(' OR '),nonnull=columns.map(c=>c+' IS NOT NULL').join(fk.match==='f'?' OR ':' AND '),join=fk.columns.map((c,i)=>'p.'+ident(fk.parentColumns[i])+'=r.'+ident(c)).join(' AND ');return '('+nonnull+') AND ('+(fk.match==='f'?'('+nulls+') OR ':'')+'NOT EXISTS(SELECT 1 FROM '+ident(fk.parentSchema)+'.'+ident(fk.parentTable)+' p WHERE '+join+'))'}
function insertSafe(t,rows){if(!rows.length)return[];const cols=t.columns.filter(c=>!c.generated).map(c=>c.name);return rows.map(r=>'INSERT INTO '+table(t)+'('+cols.map(ident).join(',')+') SELECT '+cols.map(c=>'v.'+ident(c)).join(',')+' FROM jsonb_populate_record(NULL::'+table(t)+','+lit(JSON.stringify(r))+'::jsonb) v ON CONFLICT('+t.pk.map(ident).join(',')+') DO NOTHING')}
export async function replaySecurity(runtime,target,latest,{deletedAccounts=[],baseline,capturedAt=new Date().toISOString()}={}){
 if(target?.kind!=='target'||!target.runId)fail('requires an owned isolated target')
 // DockerRuntime rechecks the exact random run label, image, network=none,
 // absence of ports/binds and source-vs-target ownership before every write.
 if(typeof runtime.assertIsolatedTarget!=='function')fail('runtime cannot prove target ownership')
 await runtime.assertIsolatedTarget(target)
 validateReplayDomain(latest);const before=baseline??await captureSecurityReplay(runtime,target);validateReplayDomain(before)
 if(before.domain!==latest.domain||target.domain!==latest.domain||before.schemaHash!==latest.schemaHash)fail('schema changed since backup')
 const removed=new Set(deletedAccounts);if([...removed].some(id=>!uuid.test(id)))fail('deleted account metadata is invalid')
 if(!Number.isFinite(Date.parse(capturedAt)))fail('checkpoint capture time is invalid')
 for(const t of before.tables)if(t.name==='auth_credential_fences'){
  const next=latest.tables.find(n=>n.schema===t.schema&&n.name===t.name)
  for(const old of t.safeRows){const current=next.safeRows.find(r=>r.issuer===old.issuer&&r.subject===old.subject),owner=t.rows.find(r=>r.key[0]===old.issuer&&r.key[1]===old.subject)?.accountId;if(!current&&(!owner||!removed.has(owner))||current&&Date.parse(current.fenced_at)<Date.parse(old.fenced_at))fail('credential fence moved backwards')}
 }
 for(const t of before.tables)if(fences.has(t.name))for(const old of t.safeRows)if(old.erased_at){const current=latest.tables.find(n=>n.schema===t.schema&&n.name===t.name).safeRows.find(r=>r.account_id===old.account_id);if(!current||current.request_id!==old.request_id||Date.parse(current.erased_at)!==Date.parse(old.erased_at))fail('erasure fence moved backwards')}
 for(const t of before.tables)if(['model_execution_days','model_executions','commerce_operator_commands'].includes(t.name)){
  const next=latest.tables.find(n=>n.schema===t.schema&&n.name===t.name)
  for(const old of t.safeRows){if(old.account_id&&removed.has(old.account_id))continue;const current=next.safeRows.find(r=>t.pk.every(k=>String(r[k])===String(old[k])));if(!current)fail('accepted attempt or audit disappeared')
   if(t.name==='model_execution_days'){if(current.attempts<old.attempts)fail('model budget moved backwards')}
   else{const mutable=t.name==='model_executions'?['lease_until','finished_at','result_allowed','usage']:['state','lease_until','finished_at','result_code'],frozen=r=>Object.fromEntries(Object.entries(r).filter(([k])=>!mutable.includes(k)));if(stable(frozen(old))!==stable(frozen(current))||(t.name==='model_executions'?old.finished_at!=null:old.state!=='running')&&stable(old)!==stable(current))fail('accepted attempt or audit was rewritten')}
  }
 }
 const commands=['BEGIN',"SET LOCAL session_replication_role='replica'"],expected=new Map()
 for(const t of before.tables){const next=latest.tables.find(n=>n.schema===t.schema&&n.name===t.name),allowed=new Map(next.rows.map(r=>[key(r),r]));expected.set(t.schema+'.'+t.name,allowed)
  if(t.skip||!t.pk.length)continue
  const invalid=t.rows.filter(r=>{const v=allowed.get(key(r));return target.domain==='identity'&&transientIdentity.has(t.name)||!v||v.hash!==r.hash||r.accountId&&removed.has(r.accountId)&&!fences.has(t.name)&&t.name!=='financial_retention_records'&&t.name!=='accounts'})
  if(t.name==='financial_retention_records'&&invalid.some(r=>allowed.has(key(r))))fail('retained financial archive changed')
  if(t.name==='financial_retention_records')for(const r of invalid){const old=t.safeRows.find(v=>t.pk.every((k,i)=>String(v[k])===r.key[i])),gate=latest.tables.find(t=>t.name==='gifts_account_write_gates')?.safeRows.find(g=>g.account_id===r.accountId);if(!old||Date.parse(old.retain_until)>Date.parse(capturedAt)||!gate?.erased_at)fail('financial archive disappeared before its retention expired')}
  for(const r of invalid)commands.push('DELETE FROM '+table(t)+' r WHERE '+keySql(t)+'='+lit(JSON.stringify(r.key))+'::jsonb')
  if(next.safeRows.length){for(const r of next.safeRows){if(t.name==='accounts'&&!removed.has(r.id))fail('unexpected deleted identity metadata')};commands.push(...insertSafe(t,next.safeRows))}
 }
 if(latest.revocations.length){const events=before.tables.find(t=>t.schema==='public'&&t.name==='consent_events'),current=before.tables.find(t=>t.schema==='public'&&t.name==='current_consents');if(!events||!current)fail('revocation schema missing');for(const r of latest.revocations)if(!removed.has(r.event.account_id)){commands.push(...insertSafe(events,[r.event]));commands.push('DELETE FROM '+table(current)+' WHERE account_id='+lit(r.current.account_id)+'::uuid AND purpose='+lit(r.current.purpose));commands.push(...insertSafe(current,[r.current]))}}
 // Generic FK pruning never follows a mere text source ID across databases.
 // Thus a separately confirmed unchanged memory survives deletion of a chat.
 const deletes=[];for(const t of before.tables)if(!t.skip)for(const fk of t.foreignKeys)deletes.push('DELETE FROM '+table(t)+' r WHERE '+dangling(t,fk))
 commands.push('DO $replay$ DECLARE changed bigint; n bigint; rounds integer:=0; BEGIN LOOP changed:=0;'+deletes.map(sql=>sql+';GET DIAGNOSTICS n=ROW_COUNT;changed:=changed+n;').join('')+'EXIT WHEN changed=0;rounds:=rounds+1;IF rounds>1000 THEN RAISE EXCEPTION \'Security replay reference closure exceeded bound\';END IF;END LOOP;END $replay$')
 commands.push('COMMIT');await runtime.sql(target,commands.join(';\n')+';')
 const after=await captureSecurityReplay(runtime,target),kept=new Map(after.tables.map(t=>[t.schema+'.'+t.name,t]));let invalidated=0,preserved=0
 for(const t of before.tables){const got=kept.get(t.schema+'.'+t.name),allowed=expected.get(t.schema+'.'+t.name),previous=new Map(t.rows.map(r=>[key(r),r])),current=new Map(got.rows.map(r=>[key(r),r]));for(const r of got.rows){const a=allowed.get(key(r));if(!a||a.hash!==r.hash)fail('old or untrusted row survived');if(r.accountId&&removed.has(r.accountId)&&!fences.has(t.name)&&!['financial_retention_records','accounts'].includes(t.name))fail('deleted account private row survived');if(previous.has(key(r)))preserved++}invalidated+=t.rows.filter(r=>current.get(key(r))?.hash!==r.hash).length}
 const foreign=before.tables.flatMap(t=>t.skip?[]:t.foreignKeys.map(fk=>'(SELECT count(*) FROM '+table(t)+' r WHERE '+dangling(t,fk)+')')).join('+')||'0'
 const count=(await runtime.query(target,'SELECT ('+foreign+')::text AS dangling_references'))[0];if(!count||String(count.dangling_references)!=='0')fail('foreign reference closure is incomplete')
 return{applied:true,releaseReady:false,scope:'invalidate_old_versions_only',invalidatedRows:invalidated,preservedRows:preserved,deletedAccountCount:removed.size,revocationsCaptured:latest.revocations.length,foreignReferencesClosed:true}
}
