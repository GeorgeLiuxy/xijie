import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {test} from 'node:test'
import {fixture} from './automatic-fixture.mjs'
import {AutomaticMemoryStore} from '../dist/automatic-store.js'
import {AutomaticMemoryEngine} from '../dist/automatic-engine.js'
import {evidenceTerms} from '../dist/search.js'

test('query ranks all authorized history before its 200-candidate bound and retains account/person/state isolation',async t=>{
 const f=await fixture(t),messages=new Map(),store=new AutomaticMemoryStore(f.pool,f.dependencies,{async send(){}})
 f.dependencies.automaticMessage=async(_aid,id)=>structuredClone(messages.get(id))
 f.dependencies.validAutomaticRefs=async(aid,pid,refs)=>refs.filter(ref=>{const m=messages.get(ref.id);return m&&m.accountId===aid&&m.personId===pid&&m.version===ref.version})
 function message(a,text,sequence,at='2026-11-12T01:00:00.000Z'){
  const m={id:randomUUID(),accountId:a.id,personId:a.person.id,conversationId:randomUUID(),version:1,createdAt:at,sequence,text,aiAuthorizationVersion:1,context:[]};messages.set(m.id,m);return m
 }
 async function remember(a,m,supersedes=[]){
  const result=await store.ingest('conversations',{eventId:randomUUID(),accountId:a.id,personId:a.person.id,sourceKind:'message',sourceId:m.id,sourceVersion:1,change:'upsert',occurredAt:m.createdAt}),job=await store.findJob(result.jobId)
  await new AutomaticMemoryEngine(store,{async generate(){return {facts:[{body:m.text,topic:'约定地点',timeDescription:'',evidence:m.text,supersedes}]}}}).run({jobId:job.id,dispatchId:job.dispatch_id,dispatchGeneration:job.dispatch_generation})
  return (await f.pool.query('SELECT id FROM automatic_memory_entries WHERE generation_job_id=$1',[job.id])).rows[0].id
 }
 const a=f.account(),obsolete=await remember(a,message(a,'旧约定的地点不是霁蓝码头。','100'))
 const targetMessage=message(a,'更正：地点是霁蓝码头（ＡＺＵＲＥ　ＨＡＲＢＯＲ）。','101'),target=await remember(a,targetMessage,[obsolete])
 const b=f.account(),foreign=await remember(b,message(b,'另一个账号也提到霁蓝码头。','1','2026-11-12T02:30:00.000Z'))
 const otherPerson={...a.person,id:randomUUID()};f.people.set(otherPerson.id,otherPerson)
 const other=await remember({...a,person:otherPerson},message({...a,person:otherPerson},'另一个人物的霁蓝码头。','1','2026-11-12T02:30:00.000Z'))
 const noise=Array.from({length:225},(_,index)=>message(a,'无关的合成日常事项 '+index,String(1000+index),'2026-11-12T02:00:00.000Z'))
 // The retrieval fixture directly seeds many valid completed sources. It exercises
 // the real schema/foreign keys without paying for 225 irrelevant model requests.
 const records=noise.map(m=>({id:m.id,at:m.createdAt,sequence:m.sequence,body:m.text}))
 await f.pool.query(`INSERT INTO automatic_memory_sources(account_id,person_id,source_kind,source_id,source_version,state,source_created_at,source_sequence,last_event_at)
  SELECT $1,$2,'message',x.id,1,'active',x.at,x.sequence,x.at FROM jsonb_to_recordset($3::jsonb) AS x(id uuid,at timestamptz,sequence bigint,body text)`,[a.id,a.person.id,JSON.stringify(records)])
 await f.pool.query(`INSERT INTO automatic_memory_jobs(account_id,person_id,source_record_id,source_kind,source_id,source_version,source_created_at,source_sequence,context_refs,snapshot_hash,person_version,person_access_version,account_access_version,authorization_version,ai_authorization_version,dispatch_id,state,finished_at,entry_count,created_at,updated_at,queued_at,run_after)
  SELECT s.account_id,s.person_id,s.id,'message',s.source_id,1,s.source_created_at,s.source_sequence,jsonb_build_array(jsonb_build_object('id',s.source_id,'version',1)),$3,1,1,1,1,1,gen_random_uuid(),'succeeded',statement_timestamp(),1,statement_timestamp(),statement_timestamp(),statement_timestamp(),statement_timestamp()
  FROM automatic_memory_sources s WHERE s.account_id=$1 AND s.person_id=$2 AND s.source_id=ANY($4::uuid[])`,[a.id,a.person.id,'0'.repeat(64),noise.map(m=>m.id)])
 await f.pool.query(`INSERT INTO automatic_memory_entries(account_id,person_id,source_record_id,generation_job_id,fact_index,source_kind,source_id,source_version,reality,source_created_at,source_sequence,sources,topic,body,evidence,person_access_version,account_access_version,authorization_version,ai_authorization_version)
  SELECT j.account_id,j.person_id,j.source_record_id,j.id,0,'message',j.source_id,1,'user_reported',j.source_created_at,j.source_sequence,j.context_refs,'日常',x.body,x.body,1,1,1,1
  FROM automatic_memory_jobs j JOIN jsonb_to_recordset($3::jsonb) AS x(id uuid,at timestamptz,sequence bigint,body text) ON j.source_id=x.id WHERE j.account_id=$1 AND j.person_id=$2`,[a.id,a.person.id,JSON.stringify(records)])
 assert.ok(!(await store.context(a.id,a.person.id,'')).some(entry=>entry.id===target),'unqueried recent fallback remains bounded')
 for(const query of ['霁蓝码头','AZURE HARBOR']){
  const matches=await store.context(a.id,a.person.id,query)
  assert.equal(matches[0].id,target,query)
  assert.ok(matches.every(entry=>![obsolete,foreign,other].includes(entry.id)))
  assert.ok(matches.length<=8)
 }
 assert.equal((await f.pool.query('SELECT state FROM automatic_memory_entries WHERE id=$1',[obsolete])).rows[0].state,'superseded')
 assert.equal(evidenceTerms(Array.from({length:100},(_,index)=>'token'+index).join(' ')).length,64)
})
