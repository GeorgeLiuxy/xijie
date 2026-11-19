import { createHash } from 'node:crypto'

const DOMAINS = new Set(['identity', 'people', 'conversations', 'memories', 'social', 'media', 'gifts', 'logto'])
const hash = value => createHash('sha256').update(value).digest('hex')
const ident = value => '"' + String(value).replaceAll('"', '""') + '"'
const literal = value => "'" + String(value).replaceAll("'", "''") + "'"
const qualified = (schema, name) => ident(schema) + '.' + ident(name)
// These are provider session stores verified in the deployed Logto schema, not user profiles.
const logtoSessionTables = new Set(['oidc_model_instances','oidc_session_extensions','idp_initiated_saml_sso_sessions','saml_application_sessions'])
const states = new Set(['active','restricted','deletion_pending','deleted','disabled','removed','pending','completed','cancelled','expired','preparing','ready','verifying','failed','queued','running','succeeded','blocked','canceled','consumed','withdrawn','superseded','awaiting_upload','rejected','revoked','in_transit','arrived','delivery_failed'])
const stable = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? '[' + value.map(stable).join(',') + ']'
    : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}'
const digestRecords = records => hash([...records].sort().map(row => row.length + ':' + row).join('\n'))
const decoded = (record, name) => { try { return JSON.parse(record) } catch { throw new Error('Invalid database row encoding in ' + name) } }
const schemaFilter = domain => domain === 'logto'
  ? "n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'"
  : "n.nspname = 'public'"

// Native dump/reparse can distribute array coercions into element coercions.
// Ask the same PostgreSQL major to normalize the projection, without ANALYZE or
// a table scan. Keep index keys/opclasses/ordering exact; never strip SQL tokens.
async function canonicalIndex(runtime,target,row) {
  const {predicate,definition,...metadata}=row
  if(predicate==null)return {...metadata,definition,predicate:null}
  const suffix=' WHERE '+predicate
  if(!definition.endsWith(suffix))throw new Error('Unexpected PostgreSQL index predicate encoding')
  const plan=await runtime.json(target,`EXPLAIN (FORMAT JSON,VERBOSE,COSTS OFF) SELECT (${predicate}) AS recovery_predicate FROM ${qualified(row.schema,row.name)}`)
  const output=plan?.[0]?.Plan?.Output
  if(!Array.isArray(output)||output.length!==1||typeof output[0]!=='string')throw new Error('Unexpected PostgreSQL index projection encoding')
  return {...metadata,definition:definition.slice(0,-suffix.length),predicate:output[0]}
}

async function catalog(runtime, target) {
  if (!DOMAINS.has(target.domain)) throw new Error('Unsupported recovery domain')
  const tables = await runtime.query(target, `SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE (${schemaFilter(target.domain)}) AND c.relkind IN ('r','p') ORDER BY n.nspname,c.relname`)
  const queues = await runtime.query(target, `SELECT DISTINCT n.nspname AS schema FROM pg_namespace n
    JOIN pg_class c ON c.relnamespace=n.oid AND c.relname='job' AND c.relkind IN ('r','p')
    WHERE n.nspname <> 'public' AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
    AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='data' AND a.attnum>0 AND NOT a.attisdropped)
    AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='state' AND a.attnum>0 AND NOT a.attisdropped)
    AND EXISTS(SELECT 1 FROM pg_class v WHERE v.relnamespace=n.oid AND v.relname='version') ORDER BY n.nspname`)
  const schemas = await runtime.query(target, `SELECT n.nspname AS name FROM pg_namespace n WHERE ${schemaFilter(target.domain)} ORDER BY n.nspname`)
  return { tables: tables.filter(t => !queues.some(q => q.schema === t.schema)), queues, schemas }
}

async function schemaMetadata(runtime, target, tables, queues, namespacesInScope) {
  const schemas = [...new Set([...namespacesInScope.map(n => n.name), ...tables.map(t => t.schema), ...queues.map(q => q.schema)])]
  const selected = schemas.length ? 'n.nspname IN (' + schemas.map(literal).join(',') + ')' : 'false'
  const columns = await runtime.query(target, `SELECT n.nspname AS schema,c.relname AS name,a.attname AS column,a.attnum AS position,
      format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,a.attidentity AS identity,a.attgenerated AS generated,
      pg_get_expr(d.adbin,d.adrelid) AS default_expression
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE (${selected}) AND c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY n.nspname,c.relname,a.attnum`)
  const relations = await runtime.query(target, `SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind,
      pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls,
      CASE WHEN c.relispartition THEN pg_get_expr(c.relpartbound,c.oid) END AS partition_bound,
      CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,true) END AS definition
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (${selected}) AND c.relkind IN ('r','p','v','m','S')
    ORDER BY n.nspname,c.relname`)
  const constraints = await runtime.query(target, `SELECT n.nspname AS schema,c.relname AS name,k.conname AS constraint_name,
      k.contype AS type,k.condeferrable AS deferrable,k.condeferred AS deferred,k.convalidated AS validated,
      pg_get_constraintdef(k.oid,true) AS definition FROM pg_constraint k
    JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${selected}
    ORDER BY n.nspname,c.relname,k.conname`)
  const indexRows = await runtime.query(target, `SELECT n.nspname AS schema,c.relname AS name,i.relname AS index_name,
      pg_get_indexdef(x.indexrelid) AS definition,pg_get_expr(x.indpred,x.indrelid,false) AS predicate FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid
    JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${selected}
    ORDER BY n.nspname,c.relname,i.relname`)
  const indexes=[]
  for(const row of indexRows)indexes.push(await canonicalIndex(runtime,target,row))
  const policies = await runtime.query(target, `SELECT n.nspname AS schema,c.relname AS name,p.polname AS policy_name,
      p.polcmd AS command,p.polpermissive AS permissive,
      ARRAY(SELECT CASE WHEN role_id=0 THEN 'public' ELSE pg_get_userbyid(role_id)::text END FROM unnest(p.polroles) role_id ORDER BY 1) AS roles,
      pg_get_expr(p.polqual,p.polrelid) AS using_expression,pg_get_expr(p.polwithcheck,p.polrelid) AS check_expression
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${selected}
    ORDER BY n.nspname,c.relname,p.polname`)
  const triggers = await runtime.query(target, `SELECT n.nspname AS schema,c.relname AS name,t.tgname AS trigger_name,
      t.tgenabled AS enabled,pg_get_triggerdef(t.oid,true) AS definition
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE (${selected}) AND NOT t.tgisinternal ORDER BY n.nspname,c.relname,t.tgname`)
  const functions = await runtime.query(target, `SELECT n.nspname AS schema,p.proname AS name,pg_get_userbyid(p.proowner) AS owner,
      pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (${selected}) AND p.prokind IN ('f','p')
    ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)`)
  const roles = await runtime.query(target, `WITH RECURSIVE seeds(oid) AS (
      SELECT n.nspowner FROM pg_namespace n WHERE ${selected}
      UNION SELECT c.relowner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${selected}
      UNION SELECT d.datdba FROM pg_database d WHERE d.datname=current_database()
      UNION SELECT p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE ${selected}
      UNION SELECT unnest(p.polroles) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${selected}
      UNION SELECT unnest(ARRAY[a.grantee,a.grantor]) FROM pg_namespace n,LATERAL aclexplode(n.nspacl) a WHERE ${selected}
      UNION SELECT unnest(ARRAY[a.grantee,a.grantor]) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(c.relacl) a WHERE ${selected}
      UNION SELECT unnest(ARRAY[a.grantee,a.grantor]) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,LATERAL aclexplode(p.proacl) a WHERE ${selected}
    ), needed(oid) AS(SELECT oid FROM seeds WHERE oid<>0 UNION SELECT m.roleid FROM pg_auth_members m JOIN needed n ON m.member=n.oid)
    SELECT r.rolname AS name,r.rolsuper AS superuser,r.rolinherit AS inherit,r.rolcreaterole AS create_role,
      r.rolcreatedb AS create_database,r.rolcanlogin AS login,r.rolreplication AS replication,r.rolbypassrls AS bypass_rls,
      r.rolconnlimit AS connection_limit,r.rolvaliduntil::text AS valid_until
    FROM pg_roles r JOIN needed n ON n.oid=r.oid ORDER BY r.rolname`)
  const names = roles.map(r => literal(r.name)).join(',') || "''"
  const memberships = await runtime.query(target, `SELECT parent.rolname AS role,child.rolname AS member,m.admin_option AS admin,
      m.inherit_option AS inherit,m.set_option AS set_role
    FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid JOIN pg_roles child ON child.oid=m.member
    WHERE parent.rolname IN(${names}) AND child.rolname IN(${names}) ORDER BY parent.rolname,child.rolname`)
  const grants = await runtime.query(target, `SELECT n.nspname AS schema,c.relname AS name,
      CASE WHEN a.grantee=0 THEN 'public' ELSE pg_get_userbyid(a.grantee)::text END AS grantee,
      pg_get_userbyid(a.grantor) AS grantor,a.privilege_type AS privilege,a.is_grantable AS grantable
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,
      LATERAL aclexplode(COALESCE(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a
    WHERE (${selected}) AND c.relkind IN ('r','p','v','m','S') ORDER BY 1,2,3,4,5,6`)
  const namespaces = await runtime.query(target, `SELECT n.nspname AS name,pg_get_userbyid(n.nspowner) AS owner FROM pg_namespace n WHERE ${selected} ORDER BY n.nspname`)
  const schemaGrants = await runtime.query(target, `SELECT n.nspname AS schema,
      CASE WHEN a.grantee=0 THEN 'public' ELSE pg_get_userbyid(a.grantee)::text END AS grantee,
      pg_get_userbyid(a.grantor) AS grantor,a.privilege_type AS privilege,a.is_grantable AS grantable
    FROM pg_namespace n,LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n'::"char",n.nspowner))) a
    WHERE ${selected} ORDER BY 1,2,3,4,5`)
  const functionGrants = await runtime.query(target, `SELECT n.nspname AS schema,p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,
      CASE WHEN a.grantee=0 THEN 'public' ELSE pg_get_userbyid(a.grantee)::text END AS grantee,
      pg_get_userbyid(a.grantor) AS grantor,a.privilege_type AS privilege,a.is_grantable AS grantable
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
      LATERAL aclexplode(COALESCE(p.proacl,acldefault('f'::"char",p.proowner))) a
    WHERE (${selected}) AND p.prokind IN ('f','p') ORDER BY 1,2,3,4,5,6,7`)
  return { columns, relations, constraints, indexes, policies, triggers, functions, roles, memberships, grants, namespaces, schemaGrants, functionGrants }
}

function securityMetadata(domain, rowsByTable) {
  const accounts = [], resources = [], migrations = [], core = []
  const operational = new Set(['chat_reply_speech','call_sessions','call_grants','person_voice_assets','person_voice_jobs','person_voice_upload_slots','model_executions','content_reports','person_reminder_settings','commerce_operator_commands','financial_retention_records','shared_album_adoptions','shared_album_rewards','shared_album_source_cleanup','referral_links','referral_join_intents','referral_auth_bindings','story_jobs','offline_life_plans','offline_life_runs','commerce_reconciliation_jobs','app_sessions','auth_attempts','app_session_slots','auth_sms_challenges','generation_jobs','photo_reply_jobs','letter_reply_jobs','gather_reply_jobs','gather_reply_slots','memory_generation_jobs','automatic_memory_jobs','social_generation_jobs','memory_candidates','data_exports','data_export_grants','data_request_receipts','data_requests','media_jobs','media_upload_slots','gifts_jobs','gift_return_jobs','gift_received_projection_jobs'])
  for(const name of ['native_auth_handoffs','native_wechat_transactions','auth_password_logins','auth_password_challenges','auth_credential_fences'])operational.add(name)
  const resourceKinds = { shared_albums:'shared_album',shared_album_contributions:'shared_album_contribution',shared_album_commands:'shared_album_command',shared_album_decisions:'shared_album_decision',shared_album_adoptions:'shared_album_adoption',shared_album_rewards:'shared_album_reward',shared_album_source_cleanup:'shared_album_source_cleanup',shared_memory_receipts:'shared_memory_receipt', referral_links:'referral_link',referral_commands:'referral_command',referral_join_intents:'referral_join_intent',referral_auth_bindings:'referral_auth_binding',referral_attributions:'referral_attribution',referral_reward_awards:'referral_reward_award',referral_reward_receipts:'referral_reward_receipt',album_reward_receipts:'album_reward_receipt',commerce_quotes:'commerce_quote',commerce_orders:'commerce_order',commerce_payment_attempts:'commerce_payment_attempt',commerce_refunds:'commerce_refund',commerce_refund_reservations:'commerce_refund_reservation',commerce_verified_evidence:'commerce_verified_evidence',commerce_commands:'commerce_command',commerce_reconciliation_jobs:'commerce_reconciliation_job',story_branches:'story_branch',story_messages:'story_message',story_jobs:'story_job',story_events:'story_event',offline_life_plans:'offline_life_plan',offline_life_runs:'offline_life_run', person_world_events:'person_world_event',persons:'person',person_drafts:'person_draft',person_world_movements:'person_world_movement',messages:'message',memories:'memory',memory_candidates:'memory_candidate',generation_jobs:'generation_job',memory_generation_jobs:'memory_generation_job',automatic_memory_sources:'automatic_memory_source',automatic_memory_entries:'automatic_memory_entry',automatic_memory_jobs:'automatic_memory_job',automatic_memory_receipts:'automatic_memory_receipt',data_requests:'data_request',auth_identities:'identity',account_erasure_fences:'erasure',memory_account_write_gates:'erasure',memory_erasure_receipts:'erasure_receipt',posts:'post',post_comments:'post_comment',post_reactions:'post_reaction',social_person_sync:'social_person_sync',social_account_write_gates:'erasure',social_generation_jobs:'social_generation_job',social_memory_sources:'social_memory_source',social_memory_receipts:'social_memory_receipt',social_memory_event_acks:'social_memory_event_ack' }
  Object.assign(resourceKinds,{call_sessions:'voice_call',call_grants:'voice_call_grant',person_draft_voice:'person_voice_binding',person_draft_voice_epochs:'person_voice_epoch',person_voice_assets:'person_voice',person_voice_jobs:'person_voice_job',person_voice_upload_slots:'person_voice_upload_slot',person_voice_grants:'person_voice_grant',person_voice_commands:'person_voice_command',memory_import_batches:'memory_import_batch',memory_import_items:'memory_import_item',account_profile_commands:'account_profile_command',model_execution_days:'model_execution_day',model_executions:'model_execution',content_reports:'content_report',content_report_commands:'content_report_command',content_report_audit:'content_report_audit',person_reminder_settings:'person_reminder_setting',person_reminder_notifications:'person_reminder_notification',person_reminder_commands:'person_reminder_command',commerce_operator_commands:'commerce_operator_command',financial_retention_records:'financial_retention',social_commands:'social_command'})
  for (const [name, records] of rowsByTable) {
    const table = name.split('.').at(-1)
    if(table==='chat_reply_speech')core.push({name:name+':provenance',count:records.length,digest:digestRecords(records.map(record=>{const row=decoded(record,name);delete row.recovery_blocked;return stable(row)}))})
    if(table==='person_voice_assets')core.push({name:name+':provenance',count:records.length,digest:digestRecords(records.map(record=>{const row=decoded(record,name);delete row.recovery_blocked;return stable(row)}))})
    if(table==='call_sessions'){
      const normalized=(record,operational)=>{const row=decoded(record,name);for(const k of ['provider_session_id','attempt_id','server_owner','lease_until',...(operational?['state','failure_code','version','updated_at']:[])])delete row[k];return stable(row)}
      core.push({name:name+':provenance',count:records.length,digest:digestRecords(records.map(r=>normalized(r,true)))})
      const completed=records.filter(r=>{const v=decoded(r,name);return !['created','connecting','connected','ending'].includes(v.state)&&v.failure_code!=='RESTORE_RECONCILIATION_REQUIRED'});core.push({name:name+':completed',count:completed.length,digest:digestRecords(completed.map(r=>normalized(r,false)))})
    }
    if (!operational.has(table) && table !== 'accounts' && !(domain === 'logto' && logtoSessionTables.has(table))) core.push({ name, count: records.length, digest: digestRecords(records) })
    for (const record of records) {
      const row = decoded(record, name)
      if (table.endsWith('_schema_migrations')) migrations.push({ table:name, name:row.name, sha256:row.sha256, appliedAt:row.applied_at })
      if (domain === 'identity' && table === 'accounts') accounts.push({ id:row.id, status:states.has(row.status)?row.status:'unknown', version:row.version, accessVersion:row.access_version })
      const kind = resourceKinds[table] ?? ({photo_reply_jobs:'photo_reply_job',message_media:'message_media',media_conversation_grants:'media_conversation_grant',gather_reply_jobs:'gather_reply_job',gather_reply_participants:'gather_participant',gather_reply_slots:'gather_reply_slot',letters:'letter',letter_reply_jobs:'letter_reply_job',letter_replies:'letter_reply',letter_read_cursors:'letter_read_cursor',gift_delivery_photos:'gift_delivery_photo',gift_photo_commands:'gift_photo_command',gift_return_jobs:'gift_return_job',gift_received_projection_jobs:'gift_received_projection_job',received_gifts:'received_gift',gift_notifications:'gift_notification',gift_mutation_receipts:'gift_mutation_receipt',gifts_jobs:'gift_job',gift_deliveries:'gift_delivery',asset_lots:'asset_lot',ledger_transactions:'ledger_transaction',ledger_entries:'ledger_entry',gifts_account_write_gates:'erasure',gifts_erase_receipts:'erasure_receipt',media_objects:'media',media_upload_slots:'media_upload_slot',media_use_grants:'media_use_grant',media_person_grants:'media_person_grant',media_gift_grants:'media_gift_grant',person_draft_media:'person_draft_media',media_jobs:'media_job',media_account_write_gates:'erasure',media_erase_receipts:'erasure_receipt',post_media:'post_media'}[table]) ?? (domain === 'logto' && table === 'users' ? 'provider_user' : undefined)
      if (kind) resources.push({ accountId:row.account_id ?? (table === 'users' ? row.id : null), kind, id:row.id ?? (['person_draft_voice','person_draft_voice_epochs'].includes(table)?row.draft_id:table==='person_voice_grants'?row.voice_id:table==='person_voice_commands'?row.operation+':'+row.idempotency_key:table==='memory_import_items'?row.batch_id+':'+row.item_id:table==='model_execution_days'?row.utc_day:table==='person_reminder_settings'?row.person_id:['account_profile_commands','person_reminder_commands'].includes(table)?row.idempotency_key:table==='content_report_commands'?row.operation+':'+row.idempotency_key:table==='social_commands'?row.operation+':'+row.target+':'+row.idempotency_key:table==='shared_album_commands'?hash(stable([row.actor,row.idempotency_key])):table==='shared_album_rewards'?row.album_id:['shared_album_adoptions','shared_album_source_cleanup','shared_memory_receipts'].includes(table)?row.contribution_id:table==='referral_commands'?row.idempotency_key:table==='referral_auth_bindings'?row.attempt_id:table==='referral_reward_receipts'?(domain==='identity'?row.attribution_id:row.referral_id)+':'+row.role:table==='commerce_commands'?row.acceptance_key:table==='commerce_refund_reservations'?row.refund_id+':'+row.lot_id:table==='offline_life_plans'?row.person_id:table==='message_media'?row.message_id:table==='media_conversation_grants'?row.media_id:table==='gather_reply_participants'||table==='gather_reply_slots'?row.job_id+':'+row.person_id:table==='letter_read_cursors'?row.person_id:table==='gift_mutation_receipts'||table==='gift_photo_commands'?row.acceptance_key:table==='gift_delivery_photos'?row.delivery_id:table==='ledger_entries'?row.transaction_id+':'+row.line_no:table==='automatic_memory_receipts'?row.origin+':'+row.event_id:table==='social_person_sync'?row.person_id:table==='post_reactions'?row.post_id:table==='post_media'?row.post_id+':'+row.media_id:table==='media_gift_grants'?row.media_id+':'+row.photo_version:table==='media_use_grants'||table==='media_person_grants'?row.media_id:table==='person_draft_media'?row.draft_id+':'+row.media_id:table==='social_memory_sources'?row.memory_id:table==='social_memory_receipts'||table==='social_memory_event_acks'?row.event_id:row.account_id),
        version:table==='person_world_movements'?row.world_version:row.version ?? 0, state:table==='person_world_movements'?'committed':table==='post_reactions'?(row.active?'active':'inactive'):row.erased_at ? 'erased' : row.removed_at ? 'removed' : states.has(row.status ?? row.state) ? row.status ?? row.state : 'recorded', digest:hash(record) })
      if (table === 'current_consents') resources.push({ accountId:row.account_id,kind:'consent',id:row.purpose,version:row.authorization_version,state:'recorded',digest:hash(record) })
    }
    if(['model_executions','content_reports','person_reminder_settings','commerce_operator_commands','financial_retention_records'].includes(table))core.push({name:name+':provenance',count:records.length,digest:digestRecords(records.map(record=>{const row=decoded(record,name),fields=table==='model_executions'?['lease_until']:table==='content_reports'?['recovery_blocked','updated_at']:table==='person_reminder_settings'?['enabled','next_check_at','version','updated_at']:table==='commerce_operator_commands'?['state','lease_until','finished_at','result_code']:['recovery_blocked'];for(const field of fields)delete row[field];return stable(row)}))})
    if(table==='commerce_operator_commands'){const completed=records.filter(r=>{const v=decoded(r,name);return v.state!=='running'&&v.result_code!=='RESTORE_REVIEW_REQUIRED'});core.push({name:name+':completed',count:completed.length,digest:digestRecords(completed)})}
    if (['referral_links','referral_join_intents','offline_life_plans','shared_album_adoptions','shared_album_rewards','shared_album_source_cleanup'].includes(table)) core.push({name:name+':provenance',count:records.length,digest:digestRecords(records.map(record=>{
      const row=decoded(record,name)
      const fields=table.startsWith('shared_album_')?['recovery_blocked']:table==='referral_links'?['version','revoked_at']:table==='referral_join_intents'?['closed_at']:['enabled','version','next_run_at','updated_at']
      for(const field of fields)delete row[field]
      return stable(row)
    }))})
    if (table === 'accounts') core.push({name:name+':profile',count:records.length,digest:digestRecords(records.map(record=>{
      const row=decoded(record,name);for(const field of ['status','version','access_version','updated_at'])delete row[field];return stable(row)
    }))})
    if (table === 'memory_candidates') core.push({name:name+':content',count:records.length,digest:digestRecords(records.map(record=>{
      const row=decoded(record,name);for(const field of ['state','version','state_changed_at'])delete row[field];return stable(row)
    }))})
    if (table === 'person_voice_jobs' || table==='person_voice_upload_slots' || table === 'story_jobs' || table === 'offline_life_runs' || table === 'commerce_reconciliation_jobs' || table === 'generation_jobs' || table === 'photo_reply_jobs' || table === 'letter_reply_jobs' || table === 'gather_reply_jobs' || table === 'gather_reply_slots' || table === 'memory_generation_jobs' || table === 'automatic_memory_jobs' || table === 'social_generation_jobs' || table === 'media_jobs' || table === 'gifts_jobs' || table === 'gift_return_jobs' || table === 'gift_received_projection_jobs') core.push({name:name+':succeeded',count:records.filter(r=>decoded(r,name).state==='succeeded').length,digest:digestRecords(records.filter(r=>decoded(r,name).state==='succeeded'))})
    if (table === 'person_voice_jobs' || table==='person_voice_upload_slots' || table === 'story_jobs' || table === 'offline_life_runs' || table === 'commerce_reconciliation_jobs' || table === 'generation_jobs' || table === 'photo_reply_jobs' || table === 'gather_reply_jobs' || table === 'gather_reply_slots' || table === 'letter_reply_jobs' || table === 'automatic_memory_jobs' || table === 'social_generation_jobs' || table === 'media_jobs' || table === 'media_upload_slots' || table === 'gifts_jobs' || table === 'gift_return_jobs' || table === 'gift_received_projection_jobs') core.push({name:name+':provenance',count:records.length,digest:digestRecords(records.map(record=>{
      // Preserve bigint source sequences while omitting only quarantine control fields.
      const row=JSON.parse(record,(_key,value,context)=>{
        if(typeof value==='number'&&Number.isInteger(value)&&!Number.isSafeInteger(value)){
          if(!context?.source||!/^(-?[0-9]+)$/.test(context.source))throw new Error('Unsafe recovery integer encoding')
          return context.source
        }
        return value
      })
      for(const field of ['state','version','attempt_id','lease_until','failure_code','retryable','updated_at','finished_at','dispatch_generation'])delete row[field]
      if(table==='media_upload_slots'||table==='person_voice_upload_slots')delete row.ended_at
      if(table==='commerce_reconciliation_jobs')delete row.recovery_blocked
      return stable(row)
    }))})
  }
  const byIdentity = (a,b) => stable([a.accountId,a.kind,a.id]).localeCompare(stable([b.accountId,b.kind,b.id]),'en')
  return { accounts:accounts.sort((a,b)=>a.id.localeCompare(b.id)), resources:resources.sort(byIdentity), migrations:migrations.sort((a,b)=>a.table.localeCompare(b.table)||a.name.localeCompare(b.name)), core:core.sort((a,b)=>a.name.localeCompare(b.name)) }
}

export async function capture(runtime, target) {
  const { tables, queues, schemas } = await catalog(runtime,target)
  const metadata = await schemaMetadata(runtime,target,tables,queues,schemas)
  const selects = tables.map(t=>`SELECT ${literal(t.schema+'.'+t.name)} AS name,COALESCE((SELECT jsonb_agg(to_jsonb(r)::text) FROM ${qualified(t.schema,t.name)} r),'[]'::jsonb) AS records`)
  const rows = selects.length ? await runtime.query(target,selects.join(' UNION ALL ')) : []
  const rowsByTable = new Map(rows.map(row=>[row.name,row.records]))
  if (rows.some(row=>!Array.isArray(row.records)||row.records.some(record=>typeof record!=='string'))) throw new Error('Unexpected snapshot encoding')
  const security = securityMetadata(target.domain,rowsByTable)
  const queueCounts = []
  for (const queue of queues) {
    const counts=await runtime.query(target,`SELECT state::text AS state,count(*)::text AS count FROM ${qualified(queue.schema,'job')} GROUP BY state ORDER BY state`)
    queueCounts.push({schema:queue.schema,states:counts})
  }
  return { domain:target.domain,capturedAt:new Date().toISOString(),tables:rows.map(row=>({name:row.name,count:row.records.length,digest:digestRecords(row.records)})).sort((a,b)=>a.name.localeCompare(b.name)),
    migrations:security.migrations,schemaDigest:hash(stable(metadata)),queueCounts,security:{accounts:security.accounts,resources:security.resources},core:security.core }
}

export function compareSnapshots(before, current) {
  if (Array.isArray(before) || Array.isArray(current)) {
    if (!Array.isArray(before)||!Array.isArray(current)) throw new Error('Snapshot collection shape mismatch')
    const old=new Map(before.map(v=>[v.domain,v])),now=new Map(current.map(v=>[v.domain,v])),differences=[]
    for(const domain of [...new Set([...old.keys(),...now.keys()])].sort()) {
      if(!old.has(domain)||!now.has(domain))differences.push({domain,kind:'domain',change:old.has(domain)?'removed':'added'})
      else differences.push(...compareSnapshots(old.get(domain),now.get(domain)).differences)
    }
    return {equal:differences.length===0,differences}
  }
  if (!before || !current || before.domain!==current.domain) throw new Error('Snapshot domains differ')
  const domain=before.domain,differences=[]
  if(before.schemaDigest!==current.schemaDigest)differences.push({domain,kind:'schema',change:'changed'})
  if(stable(before.migrations)!==stable(current.migrations))differences.push({domain,kind:'migrations',change:'changed'})
  if(stable(before.queueCounts)!==stable(current.queueCounts))differences.push({domain,kind:'queue',change:'changed'})
  const compare=(first,last,key,details)=>{
    const old=new Map((first??[]).map(item=>[key(item),item])),now=new Map((last??[]).map(item=>[key(item),item]))
    for(const id of [...new Set([...old.keys(),...now.keys()])].sort()) {
      if(stable(old.get(id))!==stable(now.get(id)))differences.push({domain,...details(now.get(id)??old.get(id)),change:old.has(id)?now.has(id)?'changed':'removed':'added'})
    }
  }
  compare(before.tables,current.tables,v=>v.name,v=>({kind:'table',table:v.name}))
  compare(before.security?.accounts,current.security?.accounts,v=>v.id,v=>({kind:'account',accountId:v.id}))
  compare(before.security?.resources,current.security?.resources,v=>stable([v.accountId,v.kind,v.id]),v=>({kind:'resource',accountId:v.accountId,resourceKind:v.kind,id:v.id}))
  return {equal:differences.length===0,differences}
}

export async function quarantine(runtime, target) {
  if(target.kind!=='target'||!target.runId)throw new Error('Quarantine requires an owned isolated recovery target')
  const before=await capture(runtime,target),{tables,queues}=await catalog(runtime,target)
  const available=new Set(tables.map(t=>t.schema+'.'+t.name)),commands=[],counts={}
  const required=(names)=>{for(const name of names)if(!available.has('public.'+name))throw new Error('Expected recovery table is missing: '+name)}
  if(target.domain==='identity'){
    required(['accounts','app_sessions','app_session_slots','auth_attempts','auth_sms_challenges','data_requests','data_request_receipts','data_exports','data_export_grants'])
    commands.push("UPDATE public.accounts SET status='restricted',access_version=access_version+1,version=version+1,updated_at=GREATEST(updated_at,clock_timestamp()) WHERE status='active'",
      "UPDATE public.app_sessions SET status='revoked',revoked_at=COALESCE(revoked_at,clock_timestamp()),reauthenticated_at=NULL,credential_hash=md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text)",
      'UPDATE public.app_session_slots SET generation=generation+1',
      "UPDATE public.auth_attempts SET state='cancelled',finished_at=GREATEST(created_at,clock_timestamp()),nonce=NULL,pkce_verifier=NULL,authorization_url=NULL,exchange_claim_id=NULL,exchange_lease_until=NULL WHERE state='pending'",
      'DELETE FROM public.auth_sms_challenges','DELETE FROM public.data_export_grants','DELETE FROM public.data_exports','DELETE FROM public.data_request_receipts',
      "UPDATE public.data_requests SET status='failed',attempt_id=NULL,lease_until=NULL,finished_at=GREATEST(requested_at,clock_timestamp()),updated_at=GREATEST(updated_at,clock_timestamp()),result_expires_at=NULL,failure_code='RESTORE_REVIEW_REQUIRED',version=version+1 WHERE kind='export' OR status IN ('accepted','processing')")
    const passwords=['auth_password_logins','auth_password_challenges','auth_credential_fences']
    if(passwords.some(n=>available.has('public.'+n))){
      required([...passwords,'auth_identities'])
      commands.push('DELETE FROM public.auth_password_logins','DELETE FROM public.auth_password_challenges',
        'UPDATE public.auth_credential_fences SET fenced_at=GREATEST(fenced_at,clock_timestamp()),password_pending=COALESCE(password_pending,gen_random_uuid())',
        "INSERT INTO public.auth_credential_fences(issuer,subject,fenced_at,password_pending) SELECT issuer,subject,clock_timestamp(),gen_random_uuid() FROM public.auth_identities WHERE status='active' ON CONFLICT(issuer,subject) DO NOTHING")
    }
    if(available.has('public.native_wechat_transactions')){required(['native_auth_handoffs']);commands.push('DELETE FROM public.native_wechat_transactions')}
    if(available.has('public.native_auth_handoffs'))commands.push('DELETE FROM public.native_auth_handoffs')
    const referralTables=['referral_links','referral_commands','referral_join_intents','referral_auth_bindings','referral_attributions','referral_reward_receipts']
    if(referralTables.some(name=>available.has('public.'+name))){
      required(referralTables)
      commands.push("UPDATE public.referral_links SET revoked_at=GREATEST(created_at,clock_timestamp()),version=version+1 WHERE revoked_at IS NULL",
        "UPDATE public.referral_join_intents SET closed_at=GREATEST(created_at,clock_timestamp()) WHERE closed_at IS NULL",'DELETE FROM public.referral_auth_bindings')
    }
    const modelTables=['model_execution_days','model_executions'];if(modelTables.some(n=>available.has('public.'+n))){required(modelTables);commands.push("UPDATE public.model_executions SET lease_until=claimed_at+interval '1 microsecond' WHERE finished_at IS NULL AND lease_until>clock_timestamp()")}
    const reportTables=['content_reports','content_report_commands','content_report_audit'];if(reportTables.some(n=>available.has('public.'+n))){required(reportTables);commands.push("UPDATE public.content_reports SET recovery_blocked=true,updated_at=GREATEST(updated_at,clock_timestamp()) WHERE state='reviewing' AND NOT recovery_blocked")}
  } else if(target.domain==='conversations') {
    required(['generation_jobs','messages','conversations'])
    const calls=['call_sessions','call_grants'];if(calls.some(n=>available.has('public.'+n))){required(calls);commands.push('DELETE FROM public.call_grants',"UPDATE public.call_sessions SET state='failed',failure_code='RESTORE_RECONCILIATION_REQUIRED',version=version+1,updated_at=GREATEST(updated_at,clock_timestamp()) WHERE state IN('created','connecting','connected','ending')",'UPDATE public.call_sessions SET provider_session_id=NULL,attempt_id=NULL,server_owner=NULL,lease_until=NULL WHERE provider_session_id IS NOT NULL OR attempt_id IS NOT NULL OR server_owner IS NOT NULL OR lease_until IS NOT NULL')}
    commands.push("UPDATE public.generation_jobs SET state='blocked',lease_until=NULL,attempt_id=NULL,failure_code='RESTORE_REVIEW_REQUIRED',retryable=false,version=version+1,updated_at=GREATEST(updated_at,clock_timestamp()) WHERE state IN ('queued','running','failed')")
    if(available.has('public.chat_reply_speech'))commands.push("UPDATE public.chat_reply_speech SET recovery_blocked=true WHERE NOT recovery_blocked")
    const chatPhotoTables=['photo_reply_jobs','message_media']
    if(chatPhotoTables.some(name=>available.has('public.'+name))){
      required(chatPhotoTables)
      commands.push("UPDATE public.photo_reply_jobs SET state='blocked',lease_until=NULL,attempt_id=NULL,failure_code='RESTORE_REVIEW_REQUIRED',retryable=false,version=version+1,updated_at=GREATEST(updated_at,clock_timestamp()) WHERE state IN ('queued','running','failed')")
    }
    const gatherTables=['gather_reply_jobs','gather_reply_participants','gather_reply_slots']
    if(gatherTables.some(name=>available.has('public.'+name))){
      required(gatherTables)
      commands.push("UPDATE public.gather_reply_slots SET state='blocked',lease_until=NULL,attempt_id=NULL,failure_code='RESTORE_REVIEW_REQUIRED',retryable=false,version=version+1,updated_at=GREATEST(updated_at,clock_timestamp()) WHERE state IN ('queued','running','failed')",
        "UPDATE public.gather_reply_jobs SET state='blocked',version=version+1,updated_at=GREATEST(updated_at,clock_timestamp()) WHERE state IN ('queued','running','failed')")
    }
    const letterTables=['letters','letter_reply_jobs','letter_replies','letter_read_cursors']
    if(letterTables.some(name=>available.has('public.'+name))){
      required(letterTables)
      commands.push("UPDATE public.letter_reply_jobs SET state='blocked',lease_until=NULL,attempt_id=NULL,failure_code='RESTORE_REVIEW_REQUIRED',retryable=false,version=version+1,updated_at=GREATEST(updated_at,clock_timestamp()) WHERE state IN ('queued','running','failed')")
    }
    const storyTables=['story_branches','story_messages','story_jobs','story_events','offline_life_plans','offline_life_runs']
    if(storyTables.some(name=>available.has('public.'+name))){
      required(storyTables)
      for(const name of ['story_jobs','offline_life_runs'])commands.push(`UPDATE public.${name} SET state='blocked',lease_until=NULL,attempt_id=NULL,failure_code='RESTORE_REVIEW_REQUIRED',retryable=false,version=version+1,updated_at=GREATEST(updated_at,clock_timestamp()) WHERE state IN ('queued','running','failed')`)
      commands.push("UPDATE public.offline_life_plans SET enabled=false,next_run_at=NULL,version=version+1,updated_at=GREATEST(updated_at,clock_timestamp()) WHERE enabled")
    }
  } else if(target.domain==='memories') {
    required(['memory_generation_jobs','memory_candidates','memories'])
    const importTables=['memory_import_batches','memory_import_items'];if(importTables.some(name=>available.has('public.'+name)))required(importTables)
    commands.push("UPDATE public.memory_generation_jobs SET state='blocked',lease_until=NULL,attempt_id=NULL,finished_at=GREATEST(created_at,clock_timestamp()),failure_code='RESTORE_REVIEW_REQUIRED',retryable=false,dispatch_generation=dispatch_generation+1,version=version+1,updated_at=GREATEST(updated_at,clock_timestamp()) WHERE state IN ('queued','running','failed')",
      "UPDATE public.memory_candidates SET state='withdrawn',version=version+1,state_changed_at=GREATEST(created_at,clock_timestamp()) WHERE state='ready'")
    const automaticTables=['automatic_memory_sources','automatic_memory_jobs','automatic_memory_entries','automatic_memory_receipts']
    if(automaticTables.some(name=>available.has('public.'+name))){
      // Pre-005 databases have none of these tables. A partial migration is unsafe.
      required(automaticTables)
      commands.push("UPDATE public.automatic_memory_jobs SET state='blocked',lease_until=NULL,attempt_id=NULL,finished_at=GREATEST(created_at,clock_timestamp()),failure_code='RESTORE_REVIEW_REQUIRED',retryable=false,dispatch_generation=dispatch_generation+1,version=version+1,updated_at=GREATEST(updated_at,clock_timestamp()) WHERE state IN ('queued','running','failed')")
    }
  } else if(target.domain==='social'){
    required(['posts','post_comments','post_reactions','social_person_sync','social_account_write_gates','social_commands','outbox_events'])
    const echoTables=['social_memory_sources','social_memory_receipts','social_generation_jobs']
    if(echoTables.some(name=>available.has('public.'+name))){
      required(echoTables)
      commands.push("UPDATE public.social_generation_jobs SET state='blocked',lease_until=NULL,attempt_id=NULL,finished_at=GREATEST(created_at,clock_timestamp()),failure_code='RESTORE_REVIEW_REQUIRED',retryable=false,dispatch_generation=dispatch_generation+1,version=version+1,updated_at=GREATEST(updated_at,clock_timestamp()) WHERE state IN ('queued','running','failed')")
    }
    const albumTables=['shared_albums','shared_album_contributions','shared_album_commands','shared_album_decisions','shared_album_adoptions','shared_album_rewards','shared_album_source_cleanup']
    if(albumTables.some(name=>available.has('public.'+name))){
      required(albumTables)
      for(const name of ['shared_album_adoptions','shared_album_rewards'])commands.push(`UPDATE public.${name} SET recovery_blocked=true WHERE status='pending' AND NOT recovery_blocked`)
      commands.push('UPDATE public.shared_album_source_cleanup SET recovery_blocked=true WHERE NOT recovery_blocked')
    }
  }
  else if(target.domain==='media'){
    required(['media_objects','media_upload_slots','media_use_grants','media_jobs','media_account_write_gates','media_commands','media_erase_receipts'])
    commands.push("UPDATE public.media_upload_slots SET state='revoked',attempt_id=NULL,lease_until=NULL,ended_at=GREATEST(created_at,clock_timestamp()),version=version+1 WHERE state IN ('active','uploading','uploaded')",
      "UPDATE public.media_jobs SET state='blocked',attempt_id=NULL,lease_until=NULL,finished_at=GREATEST(created_at,clock_timestamp()),updated_at=GREATEST(updated_at,clock_timestamp()),failure_code='RESTORE_REVIEW_REQUIRED',version=version+1 WHERE state IN ('queued','running','failed')")
    const voices=['person_voice_assets','person_voice_upload_slots','person_voice_jobs','person_voice_grants','person_voice_commands'];if(voices.some(n=>available.has('public.'+n))){required(voices);commands.push('UPDATE public.person_voice_assets SET recovery_blocked=true WHERE NOT recovery_blocked',"UPDATE public.person_voice_upload_slots SET state='revoked',attempt_id=NULL,lease_until=NULL,ended_at=GREATEST(created_at,clock_timestamp()) WHERE state IN('active','uploading','uploaded')","UPDATE public.person_voice_jobs SET state='blocked',attempt_id=NULL,lease_until=NULL,finished_at=GREATEST(created_at,clock_timestamp()),updated_at=GREATEST(updated_at,clock_timestamp()),failure_code='RESTORE_REVIEW_REQUIRED' WHERE state IN('queued','running','failed')")}
  }
  else if(target.domain==='gifts'){
    required(['gifts_account_write_gates','gift_catalog_items','asset_lots','ledger_transactions','ledger_entries','gift_deliveries','gifts_jobs','outbox_events','gifts_erase_receipts'])
    const returnTables=['gift_return_jobs','gift_received_projection_jobs','received_gifts','gift_notifications','gift_mutation_receipts']
    if(returnTables.some(name=>available.has('public.'+name)))required(returnTables)
    const photoTables=['gift_delivery_photos','gift_photo_commands']
    if(photoTables.some(name=>available.has('public.'+name)))required(photoTables)
    for(const name of ['gift_return_jobs','gift_received_projection_jobs'].filter(name=>available.has('public.'+name)))commands.push(`UPDATE public.${name} SET state='blocked',attempt_id=NULL,lease_until=NULL,finished_at=GREATEST(created_at,clock_timestamp()),updated_at=GREATEST(updated_at,clock_timestamp()),failure_code='RESTORE_REVIEW_REQUIRED',version=version+1 WHERE state IN ('queued','running','failed')`)
    const commerceTables=['commerce_quotes','commerce_orders','commerce_payment_attempts','commerce_refunds','commerce_refund_reservations','commerce_verified_evidence','commerce_commands','commerce_reconciliation_jobs']
    if(commerceTables.some(name=>available.has('public.'+name))){
      required(commerceTables)
      commands.push("UPDATE public.commerce_reconciliation_jobs SET state='blocked',attempt_id=NULL,lease_until=NULL,finished_at=GREATEST(created_at,clock_timestamp()),updated_at=GREATEST(updated_at,clock_timestamp()),failure_code='RESTORE_REVIEW_REQUIRED',version=version+1 WHERE state IN ('queued','running','failed')")
    }
    const financialTables=['financial_retention_records','commerce_operator_commands'];if(financialTables.some(n=>available.has('public.'+n))){required(financialTables);required(commerceTables);commands.push("UPDATE public.commerce_operator_commands SET state='blocked',lease_until=NULL,finished_at=GREATEST(created_at,clock_timestamp()),result_code='RESTORE_REVIEW_REQUIRED' WHERE state='running'","UPDATE public.commerce_reconciliation_jobs SET recovery_blocked=true WHERE state<>'succeeded' AND NOT recovery_blocked","UPDATE public.financial_retention_records SET recovery_blocked=true WHERE NOT recovery_blocked")}
    commands.push("UPDATE public.gifts_jobs SET state='blocked',attempt_id=NULL,lease_until=NULL,finished_at=GREATEST(created_at,clock_timestamp()),updated_at=GREATEST(updated_at,clock_timestamp()),failure_code='RESTORE_REVIEW_REQUIRED',version=version+1 WHERE state IN ('queued','running','failed')")
  }
  else if(target.domain==='people'){required(['persons','person_drafts']);const voices=['person_draft_voice','person_draft_voice_epochs'];if(voices.some(n=>available.has('public.'+n)))required(voices);const reminderTables=['person_reminder_settings','person_reminder_notifications','person_reminder_commands'];if(reminderTables.some(n=>available.has('public.'+n))){required(reminderTables);commands.push("UPDATE public.person_reminder_settings SET enabled=false,next_check_at=NULL,version=version+1,updated_at=GREATEST(updated_at,clock_timestamp()) WHERE enabled OR next_check_at IS NOT NULL")}}
  else if(target.domain==='logto') {
    counts.recognizedOidcStores=0
    counts.recognizedSessionExtensionStores=0
    for(const table of tables.filter(t=>logtoSessionTables.has(t.name)&&t.name!=='oidc_model_instances')){
      commands.push(`DELETE FROM ${qualified(table.schema,table.name)}`)
      counts.recognizedSessionExtensionStores++
    }
    for(const table of tables.filter(t=>t.name==='oidc_model_instances')){
      const columns=await runtime.query(target,`SELECT a.attname AS name FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${literal(table.schema)} AND c.relname=${literal(table.name)} AND a.attnum>0 AND NOT a.attisdropped`)
      if(columns.some(column=>column.name==='model_name')){
        // The dedicated provider adapter store includes Grant as well as Session and tokens.
        // Clearing the store prevents both known and future credential model types reviving.
        commands.push(`DELETE FROM ${qualified(table.schema,table.name)}`)
        counts.recognizedOidcStores++
      }
    }
  }
  for(const queue of queues)commands.push('DELETE FROM '+qualified(queue.schema,'job'))
  if(commands.length)await runtime.sql(target,'BEGIN;\n'+commands.join(';\n')+';\nCOMMIT;')
  const after=await capture(runtime,target)
  if(stable(before.core)!==stable(after.core))throw new Error('Recovery quarantine altered preserved business content')
  const assertions={ownedIsolatedTarget:true,coreContentUnchanged:true,queueJobsZero:after.queueCounts.every(queue=>queue.states.every(state=>state.count==='0'))}
  if(target.domain==='identity'){
    const rows=await runtime.query(target,`SELECT (SELECT count(*) FROM public.accounts WHERE status='active')::text AS active_accounts,
      (SELECT count(*) FROM public.app_sessions WHERE status<>'revoked' OR reauthenticated_at IS NOT NULL)::text AS usable_sessions,
      (SELECT count(*) FROM public.auth_attempts WHERE state='pending' OR nonce IS NOT NULL OR pkce_verifier IS NOT NULL OR authorization_url IS NOT NULL OR exchange_claim_id IS NOT NULL)::text AS usable_attempts,
      (SELECT count(*) FROM public.auth_sms_challenges)::text AS sms,
      (SELECT count(*) FROM public.data_export_grants)::text AS grants,(SELECT count(*) FROM public.data_exports)::text AS exports,
      (SELECT count(*) FROM public.data_request_receipts)::text AS receipts,
      (SELECT count(*) FROM public.data_requests WHERE status IN ('accepted','processing'))::text AS runnable_requests`)
    Object.assign(counts,rows[0]);assertions.credentialsAndAdmissionBlocked=Object.values(rows[0]).every(value=>value==='0'||value===0)
    const contexts=['auth_password_logins','auth_password_challenges','native_auth_handoffs','native_wechat_transactions'].filter(n=>available.has('public.'+n))
    if(contexts.length){const rows=await runtime.query(target,'SELECT ('+contexts.map(n=>'(SELECT count(*) FROM public.'+n+')').join('+')+')::text AS restored_auth_contexts');Object.assign(counts,rows[0]);assertions.passwordAndSocialContextsCleared=rows[0]?.restored_auth_contexts==='0'||rows[0]?.restored_auth_contexts===0}
    if(available.has('public.auth_credential_fences')){const rows=await runtime.query(target,"SELECT ((SELECT count(*) FROM public.auth_credential_fences WHERE password_pending IS NULL)+(SELECT count(*) FROM public.auth_identities i WHERE i.status='active' AND NOT EXISTS(SELECT 1 FROM public.auth_credential_fences f WHERE f.issuer=i.issuer AND f.subject=i.subject AND f.password_pending IS NOT NULL)))::text AS ungated_credentials");Object.assign(counts,rows[0]);assertions.credentialFencesRequireFreshProof=rows[0]?.ungated_credentials==='0'||rows[0]?.ungated_credentials===0}
  }
  if(target.domain==='conversations'||target.domain==='memories'||target.domain==='social'&&available.has('public.social_generation_jobs')){
    const names=target.domain==='conversations'?['generation_jobs']:target.domain==='social'?['social_generation_jobs']:['memory_generation_jobs',...(available.has('public.automatic_memory_jobs')?['automatic_memory_jobs']:[])]
    const pending=names.map(name=>`(SELECT count(*) FROM public.${name} WHERE state IN ('queued','running') OR (state='failed' AND retryable))`).join('+')
    const rows=await runtime.query(target,`SELECT (${pending})::text AS executable_jobs`)
    Object.assign(counts,rows[0]);assertions.noExecutableGeneration=rows[0].executable_jobs==='0'||rows[0].executable_jobs===0
  }
  if(target.domain==='conversations'&&available.has('public.letter_reply_jobs')){
    const rows=await runtime.query(target,"SELECT count(*)::text AS executable_letter_jobs FROM public.letter_reply_jobs WHERE state IN ('queued','running','failed') OR attempt_id IS NOT NULL OR lease_until IS NOT NULL")
    Object.assign(counts,rows[0]);assertions.letterJobsBlocked=rows[0].executable_letter_jobs==='0'||rows[0].executable_letter_jobs===0
  }
  if(target.domain==='conversations'&&available.has('public.call_sessions')){const rows=await runtime.query(target,"SELECT ((SELECT count(*) FROM public.call_grants)+(SELECT count(*) FROM public.call_sessions WHERE state IN('created','connecting','connected','ending') OR provider_session_id IS NOT NULL OR attempt_id IS NOT NULL OR server_owner IS NOT NULL OR lease_until IS NOT NULL))::text AS executable_voice_calls");Object.assign(counts,rows[0]);assertions.voiceCallsBlocked=String(rows[0].executable_voice_calls)==='0'}
  if(target.domain==='conversations'&&available.has('public.chat_reply_speech')){
    const rows=await runtime.query(target,"SELECT count(*)::text AS usable_reply_speech FROM public.chat_reply_speech WHERE NOT recovery_blocked")
    Object.assign(counts,rows[0]);assertions.replySpeechBlocked=String(rows[0].usable_reply_speech)==='0'
  }
  if(target.domain==='conversations'&&available.has('public.photo_reply_jobs')){
    const rows=await runtime.query(target,"SELECT count(*)::text AS executable_photo_jobs FROM public.photo_reply_jobs WHERE state IN ('queued','running','failed') OR attempt_id IS NOT NULL OR lease_until IS NOT NULL")
    Object.assign(counts,rows[0]);assertions.photoJobsBlocked=rows[0].executable_photo_jobs==='0'||rows[0].executable_photo_jobs===0
  }
  if(target.domain==='conversations'&&available.has('public.gather_reply_jobs')){
    const rows=await runtime.query(target,"SELECT ((SELECT count(*) FROM public.gather_reply_jobs WHERE state IN ('queued','running','failed'))+(SELECT count(*) FROM public.gather_reply_slots WHERE state IN ('queued','running','failed') OR attempt_id IS NOT NULL OR lease_until IS NOT NULL))::text AS executable_gather_jobs")
    Object.assign(counts,rows[0]);assertions.gatherJobsBlocked=rows[0].executable_gather_jobs==='0'||rows[0].executable_gather_jobs===0
  }
  if(target.domain==='social'&&available.has('public.shared_albums')){
    const rows=await runtime.query(target,"SELECT ((SELECT count(*) FROM public.shared_album_adoptions WHERE status='pending' AND NOT recovery_blocked)+(SELECT count(*) FROM public.shared_album_rewards WHERE status='pending' AND NOT recovery_blocked)+(SELECT count(*) FROM public.shared_album_source_cleanup WHERE NOT recovery_blocked))::text AS executable_album_jobs")
    Object.assign(counts,rows[0]);assertions.albumEffectsBlocked=rows[0].executable_album_jobs==='0'||rows[0].executable_album_jobs===0
  }
  if(target.domain==='identity'&&available.has('public.referral_links')){
    const rows=await runtime.query(target,"SELECT ((SELECT count(*) FROM public.referral_links WHERE revoked_at IS NULL)+(SELECT count(*) FROM public.referral_join_intents WHERE closed_at IS NULL)+(SELECT count(*) FROM public.referral_auth_bindings))::text AS usable_referrals")
    Object.assign(counts,rows[0]);assertions.referralAdmissionBlocked=rows[0].usable_referrals==='0'||rows[0].usable_referrals===0
  }
  if(target.domain==='identity'&&available.has('public.model_executions')){
    const rows=await runtime.query(target,"SELECT count(*)::text AS executable_model_leases FROM public.model_executions WHERE finished_at IS NULL AND lease_until>clock_timestamp()")
    Object.assign(counts,rows[0]);assertions.modelLeasesExpired=rows[0].executable_model_leases==='0'||rows[0].executable_model_leases===0
  }
  if(target.domain==='identity'&&available.has('public.content_reports')){
    const rows=await runtime.query(target,"SELECT count(*)::text AS executable_report_actions FROM public.content_reports WHERE state='reviewing' AND NOT recovery_blocked")
    Object.assign(counts,rows[0]);assertions.reportActionsBlocked=rows[0].executable_report_actions==='0'||rows[0].executable_report_actions===0
  }
  if(target.domain==='people'&&available.has('public.person_reminder_settings')){
    const rows=await runtime.query(target,"SELECT count(*)::text AS executable_reminders FROM public.person_reminder_settings WHERE enabled OR next_check_at IS NOT NULL")
    Object.assign(counts,rows[0]);assertions.reminderSchedulesStopped=rows[0].executable_reminders==='0'||rows[0].executable_reminders===0
  }
  if(target.domain==='conversations'&&available.has('public.story_jobs')){
    const rows=await runtime.query(target,"SELECT ((SELECT count(*) FROM public.story_jobs WHERE state IN ('queued','running','failed') OR attempt_id IS NOT NULL OR lease_until IS NOT NULL)+(SELECT count(*) FROM public.offline_life_runs WHERE state IN ('queued','running','failed') OR attempt_id IS NOT NULL OR lease_until IS NOT NULL)+(SELECT count(*) FROM public.offline_life_plans WHERE enabled))::text AS executable_story_jobs")
    Object.assign(counts,rows[0]);assertions.storyJobsAndLifePlansBlocked=rows[0].executable_story_jobs==='0'||rows[0].executable_story_jobs===0
  }
  if(target.domain==='logto'){
    const stores=after.tables.filter(table=>logtoSessionTables.has(table.name.split('.').at(-1)))
    counts.remainingSessionStoreRows=stores.reduce((sum,table)=>sum+table.count,0)
    assertions.recognizedSessionStoresCleared=counts.remainingSessionStoreRows===0
  }
  if(target.domain==='media'){
    const rows=await runtime.query(target,"SELECT (SELECT count(*) FROM public.media_upload_slots WHERE state IN ('active','uploading','uploaded') OR attempt_id IS NOT NULL OR lease_until IS NOT NULL)::text AS usable_uploads,(SELECT count(*) FROM public.media_jobs WHERE state IN ('queued','running','failed') OR attempt_id IS NOT NULL OR lease_until IS NOT NULL)::text AS executable_media_jobs")
    Object.assign(counts,rows[0]);assertions.mediaUploadsAndJobsBlocked=Object.values(rows[0]).every(value=>value==='0'||value===0)
    if(available.has('public.person_voice_assets')){const rows=await runtime.query(target,"SELECT ((SELECT count(*) FROM public.person_voice_assets WHERE NOT recovery_blocked)+(SELECT count(*) FROM public.person_voice_jobs WHERE state IN('queued','running','failed') OR attempt_id IS NOT NULL OR lease_until IS NOT NULL)+(SELECT count(*) FROM public.person_voice_upload_slots WHERE state IN('active','uploading','uploaded') OR attempt_id IS NOT NULL OR lease_until IS NOT NULL))::text AS executable_person_voices");Object.assign(counts,rows[0]);assertions.personVoicesBlocked=String(rows[0].executable_person_voices)==='0'}
  }
  if(target.domain==='gifts'){
    const names=['gifts_jobs','gift_return_jobs','gift_received_projection_jobs','commerce_reconciliation_jobs'].filter(name=>available.has('public.'+name))
    const pending=names.map(name=>`(SELECT count(*) FROM public.${name} WHERE state IN ('queued','running','failed') OR attempt_id IS NOT NULL OR lease_until IS NOT NULL)`).join('+')
    const rows=await runtime.query(target,`SELECT (${pending})::text AS executable_gift_jobs`)
    Object.assign(counts,rows[0]);assertions.giftJobsBlocked=rows[0].executable_gift_jobs==='0'||rows[0].executable_gift_jobs===0
    if(available.has('public.commerce_operator_commands')){
      const rows=await runtime.query(target,"SELECT ((SELECT count(*) FROM public.commerce_operator_commands WHERE state='running' OR lease_until IS NOT NULL)+(SELECT count(*) FROM public.commerce_reconciliation_jobs WHERE state<>'succeeded' AND NOT recovery_blocked)+(SELECT count(*) FROM public.financial_retention_records WHERE NOT recovery_blocked))::text AS executable_financial_operations")
      Object.assign(counts,rows[0]);assertions.financialOperationsBlocked=rows[0].executable_financial_operations==='0'||rows[0].executable_financial_operations===0
    }
  }
  if(Object.values(assertions).some(value=>value!==true))throw new Error('Recovery quarantine assertions failed')
  return {domain:target.domain,releaseReady:false,assertions,counts,beforeCoreDigest:hash(stable(before.core)),afterCoreDigest:hash(stable(after.core))}
}
