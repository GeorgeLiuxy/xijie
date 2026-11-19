import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {validateWorldActionReferences} from './world-actions.mjs'
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
const A=id(1),P=id(2),C=id(3),S=id(4),R=id(5),J=id(6),E=id(7),W=id(8),CLIENT=id(9),MEM=id(10),AUTO=id(11)
const T='2026-11-14T00:00:00.000Z',BEFORE='2026-11-13T23:59:00.000Z',AFTER='2026-11-14T00:00:02.000Z',LATER='2026-11-14T00:00:04.000Z',REMOVED='2026-11-14T00:00:06.000Z'
const targets=['identity','people','conversations','memories'].map(domain=>({domain})),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
const ref={id:E,version:1,personId:P,worldId:W,worldVersion:1,reality:'virtual',branch:'main'}
function fixture(){
 const fingerprint=hash({clientMessageId:CLIENT,kind:'text',text:'Synthetic finite virtual action',inputMode:'typed'})
 const source={id:S,account_id:A,conversation_id:C,conversation_kind:'direct',sequence:'1',kind:'text',author_kind:'self',client_message_id:CLIENT,reply_to_message_id:null,generation_job_id:J,photo_reply_job_id:null,gather_reply_job_id:null,speaker_person_id:null,has_display_name:false,request_hash:fingerprint,expected_request_hash:fingerprint,version:1,created_at:T,removed_at:null,source_domain:'virtual_action',text_length:31}
 const reply={...source,id:R,sequence:'2',author_kind:'persona',client_message_id:null,reply_to_message_id:S,speaker_person_id:P,has_display_name:true,request_hash:null,expected_request_hash:null,created_at:AFTER}
 return{
  schema:[{table_name:'person_world_events',column_name:'id'},{table_name:'messages',column_name:'source_domain'},{table_name:'conversations',column_name:'world_event_revision'},...['world_action_authorization_version','world_action_decision','world_event_context_refs','world_action_message_refs','world_event_revision','world_action_provenance'].map(column_name=>({table_name:'generation_jobs',column_name}))],
  rooms:[{id:C,account_id:A,person_id:P,kind:'direct',last_sequence:'2',world_event_revision:'1'}],messages:[source,reply],
  jobs:[{id:J,account_id:A,conversation_id:C,person_id:P,source_message_id:S,kind:'chat_reply',state:'succeeded',version:3,attempt_id:id(12),attempt_count:1,lease_until:null,retryable:false,reply_id:R,person_version:1,person_access_version:1,account_access_version:1,authorization_version:2,ai_authorization_version:2,memory_context_refs:[{kind:'cherished',id:MEM,version:1},{kind:'automatic',id:AUTO,version:1,sourceKind:'profile',sourceId:P,sourceVersion:1,sources:[]}],world_context_ref:{accountId:A,personId:P,personVersion:1,worldVersion:1,worldId:W,catalogVersion:1,reality:'virtual',branch:'main',movementIds:[],revision:'b'.repeat(64)},world_action_authorization_version:2,world_action_decision:'execute',world_event_context_refs:[],world_action_message_refs:[{id:S,version:1}],world_event_revision:'0',world_action_provenance:{model:'synthetic-model',responseId:'synthetic-response',promptVersion:'person-world-actions-v1'},created_at:T,updated_at:AFTER}],
  episodes:[{id:E,account_id:A,conversation_id:C,person_id:P,job_id:J,source_message_id:S,source_version:1,reply_id:R,world_id:W,world_version:1,sequence:'1',version:1,reality:'virtual',branch:'main',source_author:'self',source_kind:'text',created_at:AFTER,removed_at:null,quote_length:31,summary_length:20,memory_length:20,request_quote_valid:true}],
  accounts:[{id:A,access_version:1}],persons:[{id:P,account_id:A,status:'active',version:1,access_version:1,world_id:W,world_version:1}],worlds:[{id:W,catalog_version:1}],movements:[],
   consents:[{account_id:A,purpose:'privacy_notice',authorization_version:1,decision:'acknowledge',recorded_at:BEFORE},...['private_story_storage','ai_text_processing','person_world_actions'].map(purpose=>({account_id:A,purpose,authorization_version:2,decision:'grant',notice_authorization_version:1,recorded_at:BEFORE,policy_id:id(14),policy_version:1,world_event_history_enabled:false}))],
  memories:[{id:MEM,account_id:A,person_id:P,version:1,source_message_id:null}],automatic:[{id:AUTO,account_id:A,person_id:P,version:1,source_kind:'profile',source_id:P,source_version:1,sources:[]}],autoSources:[],autoJobs:[],memoryJobs:[],candidates:[],
  commands:[{account_id:A,operation:'send',target:C,idempotency_key:id(13),request_hash:fingerprint,created_at:T,job_id:J,message_id:S,result_client_id:CLIENT,result_kind:'text'}],
  events:[{account_id:A,aggregate_type:'message',aggregate_id:S,aggregate_version:1,type:'MessageAccepted.v1',payload:{conversationId:C,messageId:S,acceptedAt:T}},
   {account_id:A,aggregate_type:'message',aggregate_id:R,aggregate_version:1,type:'ReplyCommitted.v1',payload:{conversationId:C,messageId:R,replyToMessageId:S,jobId:J,committedAt:AFTER}},
   {account_id:A,aggregate_type:'generation_job',aggregate_id:J,aggregate_version:3,type:'GenerationChanged.v1',payload:{jobId:J,kind:'chat_reply',targetId:C,state:'succeeded'}},
   {account_id:A,aggregate_type:'person_world_event',aggregate_id:E,aggregate_version:1,type:'WorldActionCommitted.v1',payload:{conversationId:C,personId:P,eventId:E,sourceMessageId:S,replyId:R}}]
 }
}
function runtime(f,seen=[]){return{query:async(t,sql)=>{
 seen.push(sql)
 if(sql.includes('information_schema.columns'))return f.schema
 for(const [table,key]of [['offline_life_runs','lifeRuns'],['conversation_commands','commands'],['outbox_events','events'],['conversations','rooms'],['messages','messages'],['generation_jobs','jobs'],['person_world_events','episodes'],['accounts','accounts'],['consent_events','consents'],['persons','persons'],['worlds','worlds'],['person_world_movements','movements'],['memories','memories'],['automatic_memory_entries','automatic'],['automatic_memory_sources','autoSources'],['automatic_memory_jobs','autoJobs'],['memory_generation_jobs','memoryJobs'],['memory_candidates','candidates']])if(new RegExp('FROM public\\.'+table+'(?:\\s|$)').test(sql))return f[key]
 throw Error('Unexpected world action recovery query')
}}}
const verify=f=>validateWorldActionReferences(runtime(f),targets)
async function rejects(changes){for(const change of changes){const f=fixture();change(f);await assert.rejects(verify(f),/differs/,change.toString())}}
function pending(f){
 f.messages.pop();f.messages[0].source_domain='world_action_pending';f.events.splice(1);f.episodes=[];f.rooms[0].world_event_revision='0';f.rooms[0].last_sequence='1'
 Object.assign(f.jobs[0],{state:'queued',version:1,attempt_id:null,attempt_count:0,reply_id:null,memory_context_refs:[],world_context_ref:null,world_action_decision:'pending',world_event_context_refs:[],world_action_message_refs:[],world_event_revision:null,world_action_provenance:null,updated_at:T})
}
function remove(f,index){
 const m=f.messages[index];m.version=2;m.removed_at=REMOVED
 f.commands.push({account_id:A,operation:'remove',target:m.id,idempotency_key:id(40+index),request_hash:hash({conversationId:C,version:1}),result_id:m.id,result_version:'2',removed_at:REMOVED,created_at:REMOVED})
 f.events.push({account_id:A,aggregate_type:'message',aggregate_id:m.id,aggregate_version:2,type:'MessageRemoved.v1',payload:{conversationId:C,messageId:m.id,removedAt:REMOVED}})
 f.episodes.forEach(e=>e.removed_at=REMOVED);f.rooms[0].world_event_revision=String(BigInt(f.rooms[0].world_event_revision)+1n)
}
function followup(f){
 const source={...f.messages[0],id:id(20),client_message_id:id(21),generation_job_id:id(22),sequence:'3',created_at:LATER,source_domain:'virtual_context'},reply={...f.messages[1],id:id(23),reply_to_message_id:source.id,generation_job_id:source.generation_job_id,sequence:'4',created_at:LATER,source_domain:'virtual_context'}
 const job={...structuredClone(f.jobs[0]),id:source.generation_job_id,source_message_id:source.id,reply_id:reply.id,world_action_decision:'chat',world_event_context_refs:[{...ref}],world_event_revision:'1',world_action_message_refs:[{id:S,version:1},{id:R,version:1},{id:source.id,version:1}],created_at:LATER,updated_at:LATER}
 f.messages.push(source,reply);f.jobs.push(job);f.rooms[0].last_sequence='4'
 f.commands.push({...f.commands[0],idempotency_key:id(24),job_id:job.id,message_id:source.id,result_client_id:source.client_message_id,created_at:LATER})
 f.events.push({account_id:A,aggregate_type:'message',aggregate_id:source.id,aggregate_version:1,type:'MessageAccepted.v1',payload:{conversationId:C,messageId:source.id,acceptedAt:LATER}},
  {account_id:A,aggregate_type:'message',aggregate_id:reply.id,aggregate_version:1,type:'ReplyCommitted.v1',payload:{conversationId:C,messageId:reply.id,replyToMessageId:source.id,jobId:job.id,committedAt:LATER}},
  {account_id:A,aggregate_type:'generation_job',aggregate_id:job.id,aggregate_version:3,type:'GenerationChanged.v1',payload:{jobId:job.id,kind:'chat_reply',targetId:C,state:'succeeded'}})
 return job
}
function historical(f,stage=2){
 // Current profile is supplied directly. New historical-event processing does
 // not inherit redundant profile-derived automatic memory, even through events.
 f.jobs[0].memory_context_refs=f.jobs[0].memory_context_refs.filter(r=>r.kind!=='automatic')
 const job=followup(f),other=id(31)
 f.worlds.push({id:other,catalog_version:1})
 f.movements=[{id:id(30),account_id:A,person_id:P,world_version:2,person_version:2,from_world_id:W,to_world_id:other}]
 if(stage===3)f.movements.push({id:id(32),account_id:A,person_id:P,world_version:3,person_version:3,from_world_id:other,to_world_id:W})
 Object.assign(f.persons[0],{version:stage,world_version:stage,world_id:stage===3?W:other})
 f.consents.push({account_id:A,purpose:'person_world_actions',authorization_version:3,decision:'grant',notice_authorization_version:1,recorded_at:AFTER,policy_id:id(14),policy_version:2,world_event_history_enabled:true})
 Object.assign(job,{person_version:stage,world_action_authorization_version:3,world_action_message_refs:[{id:job.source_message_id,version:1}],world_context_ref:{...job.world_context_ref,personVersion:stage,worldVersion:stage,worldId:f.persons[0].world_id,movementIds:f.movements.map(m=>m.id).reverse()}})
 job.world_action_provenance.promptRevision='history-v3'
 return job
}

test('world-action recovery verifies committed narrative lineage without loading private text or reporting identifiers',async()=>{
 const f=fixture(),seen=[],report=await validateWorldActionReferences(runtime(f,seen),targets)
 assert.deepEqual(report,{applicable:true,jobCount:1,eventCount:1,removedEventCount:0,replyCount:1,verified:true})
 for(const privateValue of [A,P,S,'synthetic-model','synthetic-response'])assert(!JSON.stringify(report).includes(privateValue))
 assert(seen.every(sql=>!sql.includes('SELECT *')))
 const message=seen.find(sql=>sql.includes('FROM public.messages WHERE')),event=seen.find(sql=>sql.includes('FROM public.person_world_events e'))
 assert(message.includes('sha256(convert_to('));assert(message.includes('to_json(text)'));assert(event.includes('request_quote_valid'));assert(event.includes('char_length(e.memory)'))
 assert(!/SELECT[^]*\be\.summary\s*,/.test(event));assert(!seen.find(sql=>sql.includes('FROM public.persons')).includes('story'))
 const commands=seen.find(sql=>sql.includes('FROM public.conversation_commands'));assert(!commands.includes("->>'text'"));assert(!commands.includes('response,'))
  const grants=seen.find(sql=>sql.includes('FROM public.consent_events'))
  assert(grants.includes('p.id=c.policy_id AND p.version=c.policy_version AND p.kind=c.purpose'))
  assert(grants.includes("COALESCE((to_jsonb(p)->>'world_event_history_enabled')::boolean,false)"));assert(!grants.includes('document_'))
})

test('accepted source, exact fingerprint, permanent command and all commit events cannot disappear',async()=>{
 await rejects([f=>f.commands=[],f=>f.messages.shift(),f=>f.messages.pop(),f=>f.jobs=[],f=>f.episodes=[],f=>f.messages[0].expected_request_hash='f'.repeat(64),f=>f.commands[0].request_hash='f'.repeat(64),f=>f.commands[0].job_id=id(90),f=>f.commands[0].target=id(90),f=>f.commands[0].result_client_id=id(90),f=>f.messages[1].speaker_person_id=id(90),f=>f.messages[1].sequence='1',f=>f.messages[0].source_domain='private_text',f=>f.events.shift(),f=>f.events.splice(1,1),f=>f.events.splice(2,1),f=>f.events.pop(),f=>f.events.at(-1).aggregate_type='message',f=>f.events.at(-1).payload.replyId=id(90),f=>f.events.push({...f.events.at(-1),aggregate_id:id(90)})])
})

test('formal events require exact owner, world phase, quote membership and immutable virtual shape',async()=>{
 await rejects([f=>f.episodes[0].account_id=id(90),f=>f.episodes[0].person_id=id(90),f=>f.episodes[0].job_id=id(90),f=>f.episodes[0].source_version=2,f=>f.episodes[0].version=2,f=>f.episodes[0].world_id=id(90),f=>f.episodes[0].world_version=2,f=>f.episodes[0].branch='other',f=>f.episodes[0].reality='real',f=>f.episodes[0].source_author='persona',f=>f.episodes[0].request_quote_valid=false,f=>f.episodes[0].summary_length=601,f=>f.episodes[0].sequence='2',f=>f.episodes.push({...f.episodes[0]}),f=>f.jobs[0].world_action_provenance.responseId=null,f=>f.jobs[0].world_action_provenance.promptVersion='chat-v1',f=>f.jobs[0].world_context_ref.movementIds=[id(90)]])
 const f=fixture();f.jobs[0].world_action_provenance.responseId='x'.repeat(300);assert.equal((await verify(f)).verified,true)
 f.jobs[0].world_action_provenance.promptRevision='recipient-v2';assert.equal((await verify(f)).verified,true)
 f.jobs[0].world_action_provenance.promptRevision='unrecognized';await assert.rejects(verify(f),/differs/)
})

test('captured grants and their privacy notice remain exact across withdrawal and regrant',async()=>{
 await rejects([f=>f.consents.pop(),f=>f.consents.at(-1).decision='withdraw',f=>f.consents.at(-1).recorded_at=LATER,f=>f.consents.at(-1).notice_authorization_version=9,f=>f.consents[0].decision='grant',f=>f.jobs[0].world_action_authorization_version=0,f=>f.jobs[0].ai_authorization_version=7,f=>f.jobs[0].authorization_version=7,f=>f.jobs[0].account_access_version=2,f=>f.jobs[0].person_access_version=2,f=>f.persons[0].account_id=id(90)])
 const f=fixture();for(const purpose of ['person_world_actions','ai_text_processing'])f.consents.push({account_id:A,purpose,decision:'withdraw',authorization_version:3,notice_authorization_version:1,recorded_at:LATER},{account_id:A,purpose,decision:'grant',authorization_version:4,notice_authorization_version:1,recorded_at:REMOVED})
 f.accounts[0].access_version=2;assert.equal((await verify(f)).verified,true)
})

test('historical event recall uses the captured policy flag while preserving the event execution stage',async()=>{
 for(const stage of [2,3]){
  const f=fixture(),job=historical(f,stage),report=await verify(f)
  assert.equal(report.replyCount,2);assert.equal(report.eventCount,1)
  assert.equal(f.episodes[0].world_version,1);assert.equal(job.world_event_context_refs[0].worldVersion,1)
  // Authorization comes from the exact policy grant, never a prompt label.
  job.world_action_provenance.promptRevision='recipient-v2';assert.equal((await verify(f)).verified,true)
  delete job.world_action_provenance.promptRevision;assert.equal((await verify(f)).verified,true)
  job.world_action_provenance.promptRevision='history-v3';job.world_action_authorization_version=2
  await assert.rejects(verify(f),/differs/)
 }
 const legacy=fixture();followup(legacy);assert.equal((await verify(legacy)).verified,true)
})

test('historical recall rejects missing policy authority, future stages, foreign refs and rewritten return-to-world stages',async()=>{
 const changes=[
  f=>f.consents.at(-1).world_event_history_enabled=false,
  f=>delete f.consents.at(-1).world_event_history_enabled,
  f=>f.consents.at(-1).world_event_history_enabled='true',
  f=>f.consents.at(-1).policy_id=null,
  f=>f.consents.at(-1).policy_version=0,
  f=>f.consents.at(-1).decision='revoke',
  f=>f.consents.at(-1).recorded_at=REMOVED,
  f=>f.consents.pop(),
  f=>f.jobs[1].world_event_context_refs[0].personId=id(90),
  f=>f.jobs[1].world_event_context_refs[0].branch='other',
  f=>f.jobs[1].world_event_context_refs[0].worldVersion=3,
  f=>f.jobs[1].world_event_context_refs[0].worldId=f.jobs[1].world_context_ref.worldId,
  f=>f.episodes[0].world_id=f.jobs[1].world_context_ref.worldId,
  f=>f.jobs[1].memory_context_refs=[],
  f=>f.memories[0].person_id=id(90),
 ]
 for(const change of changes){const f=fixture();historical(f);change(f);await assert.rejects(verify(f),/differs/,change.toString())}
 const returned=fixture();historical(returned,3);returned.jobs[1].world_event_context_refs[0].worldVersion=3
 await assert.rejects(verify(returned),/differs/)
 // Even a self-consistent event/ref pair cannot precede the stage where it ran.
 const future=fixture(),job=historical(future,3)
 Object.assign(future.jobs[0],{person_version:3,world_context_ref:structuredClone(job.world_context_ref)})
 future.episodes[0].world_version=3;job.world_event_context_refs[0].worldVersion=3
 Object.assign(job,{person_version:2,world_context_ref:{...job.world_context_ref,personVersion:2,worldVersion:2,worldId:id(31),movementIds:[id(30)]}})
 await assert.rejects(verify(future),/differs/)
})

test('new historical policy cannot inherit profile automatic memory directly or through a prior event',async()=>{
 for(const sourceKind of ['profile',undefined]){
  const f=fixture(),profileRef=structuredClone(f.jobs[0].memory_context_refs[1]);historical(f)
  if(sourceKind===undefined)delete profileRef.sourceKind
  f.jobs[1].memory_context_refs.push(profileRef)
  await assert.rejects(verify(f),/differs/)
 }
 const inherited=fixture(),profileRef=structuredClone(inherited.jobs[0].memory_context_refs[1]);historical(inherited)
 inherited.jobs[0].memory_context_refs.push(profileRef)
 // Omitting the old dependency is not a way to make its event usable.
 await assert.rejects(verify(inherited),/differs/)
 inherited.jobs[1].memory_context_refs.push(profileRef)
 await assert.rejects(verify(inherited),/differs/)
 const legacy=fixture();followup(legacy);assert.equal((await verify(legacy)).verified,true)
})

test('historical event lineage remains exact after source deletion and later permission changes',async()=>{
 for(const removedIndex of [0,1]){
  const f=fixture();historical(f);remove(f,removedIndex)
  f.consents.push({account_id:A,purpose:'person_world_actions',authorization_version:4,decision:'revoke',recorded_at:REMOVED})
  assert.equal((await verify(f)).removedEventCount,1)
  const incomplete=structuredClone(f);incomplete.jobs[1].memory_context_refs=[];await assert.rejects(verify(incomplete),/differs/)
  const lostRemoval=structuredClone(f);lostRemoval.episodes[0].removed_at=null;await assert.rejects(verify(lostRemoval),/differs/)
  const lateConsumer=fixture();historical(lateConsumer)
  const late='2026-11-14T00:00:08.000Z',reply=lateConsumer.messages[3]
  reply.created_at=late;lateConsumer.jobs[1].updated_at=late
  lateConsumer.events.find(e=>e.type==='ReplyCommitted.v1'&&e.aggregate_id===reply.id).payload.committedAt=late
  assert.equal((await verify(lateConsumer)).verified,true)
  // All timestamps and receipts still match; the event was invalidated before
  // this response committed, which alone must make the archived lineage fail.
  remove(lateConsumer,removedIndex);await assert.rejects(verify(lateConsumer),/differs/)
 }
})

test('pending and quarantined jobs retain pending source classification without inventing a result',async()=>{
 const f=fixture();pending(f);assert.equal((await verify(f)).jobCount,1)
 Object.assign(f.jobs[0],{state:'running',attempt_id:id(12),attempt_count:2,lease_until:LATER});assert.equal((await verify(f)).verified,true)
 Object.assign(f.jobs[0],{state:'blocked',attempt_id:null,lease_until:null,version:4});assert.equal((await verify(f)).verified,true)
 for(const change of [x=>x.jobs[0].world_action_decision='chat',x=>x.jobs[0].world_event_context_refs=[ref],x=>x.jobs[0].world_action_provenance={model:'fake'},x=>x.messages[0].source_domain='private_text']){const x=structuredClone(f);change(x);await assert.rejects(verify(x),/differs/)}
})

test('event-based later replies retain exact closed event and private-memory lineage',async()=>{
 const f=fixture();followup(f);assert.equal((await verify(f)).replyCount,2)
 for(const change of [x=>x.jobs[1].world_event_context_refs=[],x=>x.jobs[1].world_event_context_refs[0].worldVersion=2,x=>x.jobs[1].world_event_context_refs[0].personId=id(90),x=>x.jobs[1].world_event_context_refs[0].reality='real',x=>x.jobs[1].world_event_context_refs.push({...ref}),x=>x.jobs[1].memory_context_refs=[],x=>x.jobs[1].world_action_message_refs.pop(),x=>x.messages[2].source_domain='private_text',x=>x.memories[0].person_id=id(90),x=>x.automatic[0].source_id=id(90)]){const x=structuredClone(f);change(x);await assert.rejects(verify(x),/differs/)}
 f.memories[0].version++;f.automatic[0].version++;assert.equal((await verify(f)).verified,true)
 // A removed person or later migration preserves the historical scene, never
 // rewrites that scene to the person's current world/version.
 f.persons[0].status='removed';f.persons[0].version=3;f.persons[0].access_version=2;f.persons[0].world_version=3
 f.movements=[{id:id(30),account_id:A,person_id:P,world_version:2,person_version:2,from_world_id:W,to_world_id:id(31)},{id:id(32),account_id:A,person_id:P,world_version:3,person_version:3,from_world_id:id(31),to_world_id:W}]
 assert.equal((await verify(f)).verified,true)
 f.movements=[];await assert.rejects(verify(f),/differs/)
})

test('deleting source or event reply requires permanent receipts and invalidates retained event usage',async()=>{
 for(const index of [0,1]){const f=fixture();followup(f);remove(f,index);assert.equal((await verify(f)).removedEventCount,1)
  for(const change of [x=>x.episodes[0].removed_at=null,x=>x.commands.pop(),x=>x.events.pop(),x=>x.events.at(-1).payload.removedAt=T]){const x=structuredClone(f);change(x);await assert.rejects(verify(x),/differs/)}}
 await rejects([f=>f.episodes[0].removed_at=REMOVED])
})

test('virtual source and inherited event text cannot leak into automatic or cherished-memory derivations',async()=>{
 await rejects([f=>f.autoSources.push({account_id:A,person_id:P,source_kind:'message',source_id:S}),f=>f.automatic[0].sources=[{id:S,version:1}],f=>f.autoJobs.push({source_kind:'profile',source_id:P,context_refs:[{id:R,version:1}]}),f=>f.memories[0].source_message_id=S,f=>f.memoryJobs.push({source_message_id:R,context_refs:[]}),f=>f.candidates.push({source_message_id:id(90),context_refs:[{id:S,version:1}]})])
 const f=fixture();followup(f);f.autoSources.push({source_kind:'message',source_id:id(20)});await assert.rejects(verify(f),/differs/)
 const ordinary=fixture();ordinary.episodes=[];ordinary.rooms[0].world_event_revision='0';ordinary.jobs[0].world_action_decision='chat';ordinary.messages.forEach(m=>m.source_domain='private_text');ordinary.events.pop();ordinary.autoSources.push({source_kind:'message',source_id:S});assert.equal((await verify(ordinary)).verified,true)
})

test('old packages are explicit while partial world-action schemas and absent authorities fail closed',async()=>{
 const f=fixture();f.schema=[];assert.deepEqual(await verify(f),{applicable:false,reason:'legacy_without_world_actions'})
 assert.deepEqual(await validateWorldActionReferences(runtime(f),[]),{applicable:false,reason:'legacy_without_conversations'})
 const partial=fixture();partial.schema.pop();await assert.rejects(verify(partial),/schema is incomplete/)
 await assert.rejects(validateWorldActionReferences(runtime(fixture()),targets.filter(t=>t.domain!=='memories')),/require Identity, People and Memories/)
})


test('offline events retain independent run authority and can be consumed by a later main reply without fake messages',async()=>{
 const make=()=>{const f=fixture(),job=followup(f),eid=id(60),run=id(61),episode={...f.episodes[0],id:eid,sequence:'2',job_id:null,source_message_id:null,reply_id:null,source_author:null,source_kind:'offline_life',life_run_id:run,request_quote_valid:null};f.episodes.push(episode);f.rooms[0].world_event_revision='2';job.world_event_revision='2';job.world_event_context_refs.push({...ref,id:eid});f.lifeRuns=[{id:run,account_id:A,person_id:P,conversation_id:C,state:'succeeded',decision:'event',event_id:eid,world_context_ref:structuredClone(f.jobs[0].world_context_ref),memory_refs:structuredClone(f.jobs[0].memory_context_refs),event_refs:[{...ref,kind:'main'}],created_at:T,updated_at:AFTER}];return f}
 assert.equal((await verify(make())).eventCount,2)
 for(const change of [f=>f.lifeRuns[0].person_id=id(90),f=>f.lifeRuns[0].event_id=id(90),f=>f.episodes[1].source_message_id=S,f=>f.episodes[1].world_id=id(90),f=>f.episodes[1].created_at=LATER,f=>f.jobs[1].world_event_context_refs.shift()]){const f=make();change(f);await assert.rejects(verify(f),/differs/)}
})
