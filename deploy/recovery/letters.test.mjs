import{test}from'node:test'
import assert from'node:assert/strict'
import{createHash}from'node:crypto'
import{validateLetterReferences}from'./letters.mjs'

const targets=[{domain:'identity'},{domain:'people'},{domain:'conversations'}]
const before='2026-11-13T01:00:00.000Z',due=before,morningDue='2026-11-14T00:00:00.000Z',after='2026-11-13T01:01:00.000Z'
const privateBody='PRIVATE_LETTER_BODY_EXCLUDED_FROM_REPORT'
function fixture(){
 const base={account_id:'account',person_id:'person',request_hash:'a'.repeat(64),body:privateBody,account_access_version:1,storage_authorization_version:3,version:1,created_at:before,updated_at:before,removed_at:null}
 const rows={
  accounts:[{id:'account'}],persons:[{id:'person',account_id:'account',world_id:'world',world_version:1,version:4}],worlds:[{id:'world',catalog_version:1},{id:'world-b',catalog_version:1}],person_world_movements:[],
  consent_events:[{account_id:'account',purpose:'privacy_notice',decision:'acknowledge',authorization_version:1,recorded_at:before},...['private_letter_storage','private_story_storage','person_letter_replies'].map((purpose,i)=>({account_id:'account',purpose,decision:'grant',authorization_version:[3,2,1][i],notice_authorization_version:1,recorded_at:before}))],
  letters:[{...base,id:'none',client_letter_id:'client-none',reply_mode:'none',time_zone:null,reply_at:null,reply_job_id:null,story_authorization_version:null,reply_authorization_version:null},
   {...base,id:'letter',client_letter_id:'client-now',reply_mode:'now',time_zone:null,reply_at:due,reply_job_id:'job',story_authorization_version:2,reply_authorization_version:1,version:2},
   {...base,id:'scheduled',client_letter_id:'client-later',reply_mode:'next_morning',time_zone:'Asia/Shanghai',reply_at:morningDue,reply_job_id:'later',story_authorization_version:2,reply_authorization_version:1}],
  letter_reply_jobs:[{id:'job',account_id:'account',person_id:'person',letter_id:'letter',source_version:1,scheduled_at:due,next_attempt_at:due,state:'succeeded',version:3,attempt_count:1,attempt_id:null,lease_until:null,reply_id:'reply',
   person_context_ref:{id:'person',version:4,accessVersion:1,worldId:'world',worldVersion:1},
   world_context_ref:{accountId:'account',personId:'person',personVersion:4,worldVersion:1,worldId:'world',catalogVersion:1,reality:'virtual',branch:'main',movementIds:[],revision:'b'.repeat(64)},
   provider_provenance:{provider:'openai',model:'example-model',responseId:'response',promptVersion:'person-letter-replies-v1'}},
   {id:'later',account_id:'account',person_id:'person',letter_id:'scheduled',source_version:1,scheduled_at:morningDue,next_attempt_at:morningDue,state:'queued',version:1,attempt_count:0,attempt_id:null,lease_until:null,reply_id:null}],
  letter_replies:[{id:'reply',account_id:'account',person_id:'person',letter_id:'letter',job_id:'job',sequence:'1',body:'A saved reply.',created_at:after}],
  letter_read_cursors:[{account_id:'account',person_id:'person',last_sequence:'1',last_read_sequence:'1',last_read_reply_id:'reply',read_at:after}],
  outbox_events:[],conversation_commands:[]
 }
 for(const l of rows.letters){l.request_hash=createHash('sha256').update(JSON.stringify({clientLetterId:l.client_letter_id,body:l.body,replyMode:l.reply_mode,...(l.time_zone?{timeZone:l.time_zone}:{})})).digest('hex');rows.conversation_commands.push({account_id:l.account_id,target:l.person_id,idempotency_key:l.client_letter_id,request_hash:l.request_hash,response:l.id});rows.outbox_events.push({type:'LetterAccepted.v1',account_id:l.account_id,aggregate_id:l.id,aggregate_version:1,payload:{letterId:l.id,personId:l.person_id}})}
 rows.outbox_events.push({type:'LetterReplyCommitted.v1',account_id:'account',aggregate_id:'letter',aggregate_version:2,payload:{letterId:'letter',personId:'person',replyId:'reply',jobId:'job',sequence:'1'}})
 return rows
}
function runtime(rows){return{async query(target,sql){
 if(sql.includes('information_schema.tables'))return['letters','letter_reply_jobs','letter_replies','letter_read_cursors'].filter(t=>Object.hasOwn(rows,t)).map(table_name=>({table_name}))
 if(sql.includes('AS expected_reply_at')){
  assert.equal(target.domain,'conversations')
  assert.match(sql,/FROM generate_series\(0,370\)n/)
  assert.match(sql,/at>l\.created_at AND at AT TIME ZONE l\.time_zone=local ORDER BY at LIMIT 1/)
  // This adapter supplies known fixed-offset fixture times. Real timezone/DST
  // evaluation belongs to PostgreSQL during the native drill, not this unit test.
  const offsets={'Asia/Shanghai':8,'Etc/GMT+5':-5,UTC:0}
  return structuredClone(rows.letters).map(row=>{
   let expected=null
   if(row.reply_mode==='now')expected=row.created_at
   if(row.reply_mode==='next_morning'&&Object.hasOwn(offsets,row.time_zone)){
    const offset=offsets[row.time_zone]*3600000,accepted=Date.parse(row.created_at),local=new Date(accepted+offset)
    let at=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate(),8)-offset
    if(at<=accepted)at+=86400000
    expected=new Date(at).toISOString()
   }
   return{...row,expected_reply_at:expected}
  })
 }
 const table=/FROM public\.([a-z_]+)/.exec(sql)?.[1]
 if(!table||!Object.hasOwn(rows,table))throw Error('Unexpected fixture query')
 assert.equal(target.domain,['accounts','consent_events'].includes(table)?'identity':['persons','worlds','person_world_movements'].includes(table)?'people':'conversations')
 return structuredClone(rows[table])
}}}
test('letter recovery verifies original, delayed task, committed provenance and monotonic reads without reporting content',async()=>{
 const value=await validateLetterReferences(runtime(fixture()),targets)
 assert.deepEqual(value,{applicable:true,letterCount:3,replyCount:1,jobCount:2,readCursorCount:1,verified:true})
 assert.equal(JSON.stringify(value).includes(privateBody),false)
})

test('linked original recovery includes its immutable memory version in the acceptance digest',async()=>{
 const rows=fixture(),l=rows.letters.find(row=>row.id==='none'),sourceMemory={id:'551b6f0b-3ff1-4bd8-874e-f30fa85d65d6',version:2}
 l.source_memory_id=sourceMemory.id;l.source_memory_version=sourceMemory.version
 l.request_hash=createHash('sha256').update(JSON.stringify({clientLetterId:l.client_letter_id,body:l.body,replyMode:l.reply_mode,sourceMemory})).digest('hex')
 rows.conversation_commands.find(row=>row.response===l.id).request_hash=l.request_hash
 assert.equal((await validateLetterReferences(runtime(rows),targets)).verified,true)
 l.source_memory_version++;await assert.rejects(()=>validateLetterReferences(runtime(rows),targets),/differs/)
 l.source_memory_version=null;await assert.rejects(()=>validateLetterReferences(runtime(rows),targets),/differs/)
})
test('legacy missing all letter tables is supported; partial migration or missing authority is rejected',async()=>{
 assert.equal((await validateLetterReferences(runtime({}),targets)).applicable,false)
 for(const table of ['letters','letter_reply_jobs','letter_replies','letter_read_cursors']){const rows=fixture();delete rows[table];await assert.rejects(()=>validateLetterReferences(runtime(rows),targets),/schema is incomplete/)}
 await assert.rejects(()=>validateLetterReferences(runtime(fixture()),targets.slice(1)),/authority/)
})
test('letter references reject cross-account/person, missing jobs, duplicate results and altered model provenance',async()=>{
 const mutations=[
  x=>x.persons[0].account_id='other',x=>x.letters[1].person_id='other',x=>x.letters[0].reply_job_id='job',
  x=>x.letters[1].reply_authorization_version=0,x=>x.letter_reply_jobs[0].letter_id='none',x=>x.letter_reply_jobs[0].account_id='other',
  x=>x.letter_reply_jobs[0].source_version=7,x=>x.letter_reply_jobs[0].scheduled_at=after,
  x=>x.letter_reply_jobs[0].provider_provenance.promptVersion='chat',x=>x.letter_reply_jobs[0].world_context_ref.personVersion=3,
  x=>x.letter_reply_jobs[0].person_context_ref.id='other',x=>x.letter_reply_jobs[0].attempt_id='stale',
  x=>x.letter_replies.push({...x.letter_replies[0],id:'duplicate'}),x=>x.letter_replies[0].person_id='other',
  x=>x.letter_replies[0].created_at=new Date(Date.parse(before)-1).toISOString(),x=>x.letter_reply_jobs.splice(1,1),
  x=>{x.letters[2].removed_at=after},x=>x.letters[1].body='\0',
 ]
 for(const mutate of mutations){const rows=fixture();mutate(rows);await assert.rejects(()=>validateLetterReferences(runtime(rows),targets),/differs/)}
})
test('read positions preserve exact bigint sequences and reject missing, foreign or forward anchors',async()=>{
 const rows=fixture(),large='9007199254740993'
 rows.letter_replies[0].sequence=large;rows.letter_read_cursors[0].last_sequence=large;rows.letter_read_cursors[0].last_read_sequence=large
 rows.outbox_events.at(-1).payload.sequence=large
 assert.equal((await validateLetterReferences(runtime(rows),targets)).verified,true)
 for(const mutate of [x=>x.letter_read_cursors[0].last_sequence='0',x=>x.letter_read_cursors[0].last_read_sequence='2',x=>x.letter_read_cursors[0].last_read_reply_id='missing',x=>x.letter_read_cursors[0].person_id='other',x=>x.letter_read_cursors.splice(0),x=>x.letter_replies[0].sequence=Number.MAX_SAFE_INTEGER+1]){
  const sample=fixture();mutate(sample);await assert.rejects(()=>validateLetterReferences(runtime(sample),targets),/differs/)
 }
})
test('a committed reply cannot cite the letter version created by that same reply',async()=>{
 const rows=fixture()
 assert.equal(rows.letters.find(letter=>letter.id==='letter').version,2)
 assert.equal(rows.letter_reply_jobs[0].state,'succeeded')
 rows.letter_reply_jobs[0].source_version=2
 await assert.rejects(()=>validateLetterReferences(runtime(rows),targets),/differs/)
})

test('letter schedules retain accepted-now and the first strictly later local 08:00',async()=>{
 const adjust=(rows,{zone,createdAt,replyAt})=>{
  const letter=rows.letters.find(row=>row.id==='scheduled'),job=rows.letter_reply_jobs.find(row=>row.id==='later')
  Object.assign(letter,{time_zone:zone,created_at:createdAt,updated_at:createdAt,reply_at:replyAt})
  Object.assign(job,{scheduled_at:replyAt,next_attempt_at:replyAt})
  letter.request_hash=createHash('sha256').update(JSON.stringify({clientLetterId:letter.client_letter_id,body:letter.body,replyMode:letter.reply_mode,timeZone:letter.time_zone})).digest('hex')
  rows.conversation_commands.find(row=>row.response===letter.id).request_hash=letter.request_hash
 }
 for(const [zone,createdAt,replyAt]of [
  ['Asia/Shanghai','2026-11-14T00:00:00.000Z','2026-11-15T00:00:00.000Z'],
  ['Asia/Shanghai','2026-11-13T23:59:59.999Z','2026-11-14T00:00:00.000Z'],
  ['Etc/GMT+5',before,'2026-11-13T13:00:00.000Z'],
 ]){const rows=fixture();adjust(rows,{zone,createdAt,replyAt});assert.equal((await validateLetterReferences(runtime(rows),targets)).verified,true)}
 for(const [zone,createdAt,replyAt]of [
  ['Asia/Shanghai','2026-11-14T00:00:00.000Z','2026-11-14T00:00:00.000Z'],
  ['Asia/Shanghai',before,'2026-11-13T00:00:00.000Z'],
  ['Asia/Shanghai',before,'2026-11-14T00:00:00.001Z'],
  ['Asia/Shanghai',before,'2026-11-15T00:00:00.000Z'],
  ['Etc/GMT+5',before,'2026-11-13T08:00:00.000Z'],
  ['Unknown/Zone',before,morningDue],
 ]){const rows=fixture();adjust(rows,{zone,createdAt,replyAt});await assert.rejects(()=>validateLetterReferences(runtime(rows),targets),/differs/)}
 const delayedNow=fixture(),later=new Date(Date.parse(before)+1).toISOString()
 delayedNow.letters.find(row=>row.id==='letter').reply_at=later
 Object.assign(delayedNow.letter_reply_jobs[0],{scheduled_at:later,next_attempt_at:later})
 await assert.rejects(()=>validateLetterReferences(runtime(delayedNow),targets),/differs/)
})

test('historical permission grants and immutable world references remain valid after later changes',async()=>{
 const rows=fixture(),job=rows.letter_reply_jobs[0]
 rows.consent_events.push({account_id:'account',purpose:'person_letter_replies',decision:'revoke',authorization_version:2,recorded_at:after})
 // The successful letter used world 1; a later move does not invalidate its provenance.
 rows.persons[0].world_version=2;rows.persons[0].world_id='world-b';rows.persons[0].version=5
 rows.person_world_movements.push({id:'move',account_id:'account',person_id:'person',world_version:2,person_version:5,from_world_id:'world',to_world_id:'world-b'})
 assert.equal((await validateLetterReferences(runtime(rows),targets)).verified,true)
 job.person_context_ref.version=5;job.person_context_ref.worldId='world-b';job.person_context_ref.worldVersion=2
 Object.assign(job.world_context_ref,{personVersion:5,worldVersion:2,worldId:'world-b',movementIds:['move']})
 assert.equal((await validateLetterReferences(runtime(rows),targets)).verified,true)
 for(const mutate of [x=>x.person_world_movements[0].account_id='foreign',x=>x.person_world_movements.splice(0),x=>x.letter_reply_jobs[0].world_context_ref.movementIds=['move','move'],x=>x.letter_reply_jobs[0].world_context_ref.movementIds=['foreign'],x=>x.consent_events.splice(1,1),x=>x.consent_events[1].decision='revoke',x=>x.consent_events[0].account_id='foreign',x=>x.outbox_events.splice(0,1),x=>x.outbox_events.at(-1).payload.sequence='2',x=>x.letters[0].request_hash='b'.repeat(64),x=>x.conversation_commands.splice(0,1),x=>x.conversation_commands[0].response='unknown',x=>x.conversation_commands[0].request_hash='b'.repeat(64)]){
  const changed=structuredClone(rows);mutate(changed);await assert.rejects(()=>validateLetterReferences(runtime(changed),targets),/differs/)
 }
})
