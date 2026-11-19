import{test}from'node:test'
import assert from'node:assert/strict'
import{createHash}from'node:crypto'
import{validateGatherReferences}from'./gathers.mjs'
const targets=['identity','people','memories','conversations'].map(domain=>({domain})),at='2026-11-14T01:00:00.000Z',later='2026-11-14T01:00:01.000Z'
const hash=value=>createHash('sha256').update(value).digest('hex'),privateText='PRIVATE_GATHER_EXCLUDED_FROM_REPORT'
function fixture(){
 const source={id:'source',account_id:'owner',conversation_id:'room',conversation_kind:'gather',gather_reply_job_id:'job',generation_job_id:null,sequence:'1',kind:'text',author_kind:'self',text:privateText,client_message_id:'client',version:1,created_at:at,removed_at:null}
 source.request_hash=hash(JSON.stringify({clientMessageId:'client',kind:'text',text:privateText,inputMode:'typed'}))
 const roster=['person-a','person-b'].sort((a,b)=>hash('client:'+a).localeCompare(hash('client:'+b)))
 const rows={conversations:[{id:'room',account_id:'owner',world_id:'world',person_id:null,kind:'gather',last_sequence:'2'}],messages:[source,{...source,id:'reply',sequence:'2',author_kind:'persona',text:'A real model reply.',client_message_id:null,request_hash:null,speaker_person_id:roster[0],display_name:'Character',reply_to_message_id:'source',created_at:later}],
  gather_reply_jobs:[{id:'job',account_id:'owner',conversation_id:'room',conversation_kind:'gather',world_id:'world',source_message_id:'source',source_version:1,roster_revision:'a'.repeat(64),eligible_count:2,state:'queued',version:4,account_access_version:1,story_authorization_version:1,gather_authorization_version:1,memory_ai_authorization_version:1,created_at:at}],
  gather_reply_participants:roster.map((person_id,i)=>({account_id:'owner',job_id:'job',person_id,position:i+1,display_name:'Character',person_version:1,person_access_version:1,world_version:1})),
  gather_reply_slots:roster.map((person_id,i)=>({account_id:'owner',job_id:'job',person_id,conversation_id:'room',state:i?'queued':'succeeded',version:i?1:3,attempt_count:i?0:1,attempt_id:null,lease_until:null,reply_id:i?null:'reply',retryable:false,person_context_ref:i?null:{id:person_id,version:1,accessVersion:1,worldId:'world',worldVersion:1},world_context_ref:i?null:{accountId:'owner',personId:person_id,personVersion:1,worldVersion:1,worldId:'world',catalogVersion:1,reality:'virtual',branch:'main',movementIds:[],revision:'b'.repeat(64)},context_message_refs:i?[]:[{id:'source',version:1}],memory_context_refs:i?[]:[{kind:'cherished',personId:person_id,id:'memory',version:1}],provider_provenance:i?null:{provider:'openai',model:'test-model',responseId:'response',promptVersion:'person-gather-replies-v1'}})),
  accounts:[{id:'owner',access_version:1}],persons:roster.map(id=>({id,account_id:'owner',version:1,access_version:1,world_id:'world',world_version:1})),worlds:[{id:'world',catalog_version:1},{id:'world-b',catalog_version:1}],person_world_movements:[],
  consent_events:[{account_id:'owner',purpose:'privacy_notice',decision:'acknowledge',authorization_version:1,recorded_at:at},...['private_story_storage','person_gather_replies','ai_text_processing'].map(purpose=>({account_id:'owner',purpose,decision:'grant',authorization_version:1,notice_authorization_version:1,recorded_at:at}))],
  memories:[{id:'memory',account_id:'owner',person_id:roster[0],version:1}],automatic_memory_entries:[],
  conversation_commands:[{account_id:'owner',operation:'gather.send',target:'room',request_hash:source.request_hash,response:{id:'source',jobId:'job'}}],
  outbox_events:[{account_id:'owner',aggregate_id:'job',aggregate_version:1,type:'GatherAccepted.v1',payload:{jobId:'job',kind:'gather_reply',targetId:'room',messageId:'source',clientMessageId:'client',state:'queued'}},
   {account_id:'owner',aggregate_type:'message',aggregate_id:'reply',aggregate_version:1,type:'GatherReplyCommitted.v1',payload:{conversationId:'room',messageId:'reply',jobId:'job',personId:roster[0],sourceMessageId:'source'}}]
 }
 return rows
}
function runtime(rows){return{async query(target,sql){
 if(sql.includes('information_schema.tables'))return['gather_reply_jobs','gather_reply_participants','gather_reply_slots'].filter(t=>Object.hasOwn(rows,t)).map(table_name=>({table_name}))
 const name=sql.match(/FROM public\.(\w+)/)?.[1];assert.ok(name&&Object.hasOwn(rows,name),'known read-only source')
 if(target.domain==='memories')assert.doesNotMatch(sql,/\b(?:body|text|story|topic)\b/)
 assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE)\b/)
 return structuredClone(rows[name])
}}}
const check=rows=>validateGatherReferences(runtime(rows),targets)
function sharedHistory(){
 const rows=fixture(),first=rows.gather_reply_slots[0],speaker=rows.persons[1].id
 rows.gather_reply_jobs[0].state='canceled';rows.gather_reply_slots[1].state='canceled'
 const source={...rows.messages[0],id:'source-2',gather_reply_job_id:'job-2',sequence:'3',client_message_id:'client-2',created_at:later}
 source.request_hash=hash(JSON.stringify({clientMessageId:source.client_message_id,kind:'text',text:source.text,inputMode:'typed'}))
 const reply={...rows.messages[1],id:'reply-2',gather_reply_job_id:'job-2',sequence:'4',speaker_person_id:speaker,reply_to_message_id:source.id}
 rows.messages.push(source,reply);rows.conversations[0].last_sequence='4'
 rows.gather_reply_jobs.push({...rows.gather_reply_jobs[0],id:'job-2',source_message_id:source.id,state:'queued',created_at:later})
 const roster=rows.persons.map(p=>p.id).sort((a,b)=>hash('client-2:'+a).localeCompare(hash('client-2:'+b)))
 for(const [i,person_id]of roster.entries()){
  rows.gather_reply_participants.push({...rows.gather_reply_participants[0],job_id:'job-2',person_id,position:i+1})
  const done=person_id===speaker,slot=structuredClone(done?first:rows.gather_reply_slots[1])
  Object.assign(slot,{job_id:'job-2',person_id,state:done?'succeeded':'queued',reply_id:done?'reply-2':null})
  if(done){slot.person_context_ref.id=person_id;slot.world_context_ref.personId=person_id;slot.context_message_refs=[{id:'source-2',version:1},{id:'reply',version:1},{id:'source',version:1}]}
  rows.gather_reply_slots.push(slot)
 }
 rows.conversation_commands.push({...rows.conversation_commands[0],request_hash:source.request_hash,response:{id:source.id,jobId:'job-2'}})
 rows.outbox_events.push({...rows.outbox_events[0],aggregate_id:'job-2',payload:{...rows.outbox_events[0].payload,jobId:'job-2',messageId:source.id,clientMessageId:source.client_message_id}})
 rows.outbox_events.push({...rows.outbox_events[1],aggregate_id:'reply-2',payload:{...rows.outbox_events[1].payload,messageId:'reply-2',jobId:'job-2',personId:speaker,sourceMessageId:source.id}})
 return rows
}
test('gather recovery verifies partial success with historical authority and never exposes private content',async()=>{
 const proof=await check(fixture());assert.equal(proof.verified,true);assert.equal(proof.replyCount,1);assert.equal(proof.slotCount,2);assert.equal(JSON.stringify(proof).includes(privateText),false)
 const rows=fixture();rows.consent_events.push({account_id:'owner',purpose:'person_gather_replies',decision:'withdraw',authorization_version:2,recorded_at:later})
 rows.persons[0].world_id='world-b';rows.persons[0].world_version=2;rows.persons[0].version=3;rows.persons[0].access_version=2
 rows.person_world_movements.push({id:'move',account_id:'owner',person_id:rows.persons[0].id,world_version:2,person_version:2,from_world_id:'world',to_world_id:'world-b'})
 rows.messages[1].removed_at=later;rows.messages[1].version=2;rows.memories[0].version=2
 assert.equal((await check(rows)).verified,true)
})
test('gather recovery rejects missing schema and preserves pre-gather legacy boundary',async()=>{
 const rows=fixture();delete rows.gather_reply_slots;await assert.rejects(()=>check(rows),/schema is incomplete/)
 delete rows.gather_reply_jobs;delete rows.gather_reply_participants;assert.equal((await check(rows)).applicable,false)
 await assert.rejects(()=>validateGatherReferences(runtime(fixture()),targets.filter(t=>t.domain!=='memories')),/authority/)
})
test('gather recovery rejects source substitutions, roster changes, duplicate replies and stale execution claims',async()=>{
 for(const mutate of [
  x=>x.gather_reply_jobs[0].source_version=2,
  x=>x.gather_reply_jobs[0].world_id='world-b',
  x=>x.gather_reply_jobs[0].eligible_count=3,
  x=>x.gather_reply_participants.reverse().forEach((p,i)=>p.position=i+1),
  x=>x.gather_reply_participants[0].person_access_version=2,
  x=>x.gather_reply_slots[0].attempt_count=4,
  x=>x.gather_reply_slots[0].attempt_id='stale',
  x=>x.gather_reply_slots[1].reply_id='reply',
  x=>x.gather_reply_slots[0].provider_provenance.promptVersion='person-letter-replies-v1',
  x=>x.gather_reply_slots[0].person_context_ref.story='unnecessary private body',
  x=>x.messages[0].text='substituted',
  x=>x.conversation_commands[0].target='other-room',
  x=>x.outbox_events[0].payload.clientMessageId='other',
  x=>x.conversations[0].last_sequence='3',
  x=>x.gather_reply_jobs[0].state='succeeded'
  ,x=>x.outbox_events[1].payload.sourceMessageId='other-source'
  ,x=>x.outbox_events.pop()
  ,x=>x.conversation_commands[0].response=JSON.stringify(x.conversation_commands[0].response)
 ]){const rows=fixture();mutate(rows);await assert.rejects(()=>check(rows),/Gather source/)}
})
test('accepted world version cannot predate its actual movement person version',async()=>{
 const rows=fixture(),p=rows.gather_reply_participants[0],s=rows.gather_reply_slots[0],person=rows.persons[0]
 Object.assign(person,{world_version:2,version:3});p.world_version=2
 rows.person_world_movements.push({id:'move',account_id:'owner',person_id:person.id,world_version:2,person_version:3,from_world_id:'world-b',to_world_id:'world'})
 Object.assign(s.person_context_ref,{version:3,worldVersion:2});Object.assign(s.world_context_ref,{personVersion:3,worldVersion:2,movementIds:['move']})
 await assert.rejects(()=>check(rows),/Gather source/)
 p.person_version=2;await assert.rejects(()=>check(rows),/Gather source/)
 p.person_version=3;assert.equal((await check(rows)).verified,true)
})
test('gather recovery rejects cross-owner private references, unaccepted grants and same-round sibling input',async()=>{
 for(const mutate of [
  x=>x.memories[0].person_id=x.persons[1].id,
  x=>x.memories[0].account_id='other',
  x=>x.gather_reply_slots[0].memory_context_refs[0].version=2,
  x=>x.gather_reply_jobs[0].memory_ai_authorization_version=null,
  x=>x.gather_reply_jobs[0].gather_authorization_version=2,
  x=>x.consent_events.find(e=>e.purpose==='person_gather_replies').recorded_at=later,
  x=>x.consent_events.find(e=>e.purpose==='person_gather_replies').notice_authorization_version=8,
  x=>x.gather_reply_slots[0].context_message_refs.push({id:'reply',version:1}),
  x=>x.gather_reply_slots[0].context_message_refs=[]
 ]){const rows=fixture();mutate(rows);await assert.rejects(()=>check(rows),/Gather source/)}
})
test('shared replies retain complete inherited dependencies under the original owner and AI grant',async()=>{
 const rows=sharedHistory();assert.equal((await check(rows)).replyCount,2)
 for(const mutate of [
  s=>s.context_message_refs=s.context_message_refs.filter(r=>r.id!=='source'),
  s=>s.memory_context_refs=[],
  s=>s.memory_context_refs[0].personId=s.person_id
 ]){const changed=sharedHistory();mutate(changed.gather_reply_slots.find(s=>s.reply_id==='reply-2'));await assert.rejects(()=>check(changed),/Gather source/)}
 const changed=sharedHistory();changed.consent_events.push({...changed.consent_events.find(c=>c.purpose==='ai_text_processing'),authorization_version:2});changed.gather_reply_jobs[1].memory_ai_authorization_version=2
 await assert.rejects(()=>check(changed),/Gather source/)
})
