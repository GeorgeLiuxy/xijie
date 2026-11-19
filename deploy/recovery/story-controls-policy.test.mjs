import {test} from 'node:test'
import assert from 'node:assert/strict'
import {capture,quarantine} from './policy.mjs'

const target={domain:'conversations',kind:'target',runId:'story-policy-unit'}
const marker='PRIVATE_STORY_AND_LIFE_CONTENT'
const states=['queued','running','failed','succeeded','blocked','canceled']
function fixture(){
 const jobs=prefix=>states.map(state=>({id:prefix+state,account_id:'owner',person_id:'person',state,version:4,attempt_count:2,attempt_id:state==='running'?'attempt':null,lease_until:state==='running'?'lease':null,retryable:state==='failed',updated_at:'before',permission_version:7,ai_version:3,source_hash:'source-fingerprint',message_refs:[{id:'original-source',version:1}],event_refs:[{id:'original-event',version:1}],memory_refs:[{id:'original-memory',version:1}],provider_provenance:state==='succeeded'?{provider:'openai',model:'synthetic',responseId:'actual-response',promptVersion:prefix==='story-'?'person-story-branches-v1':'person-offline-life-v1'}:null}))
 return{conversations:[{id:'main',account_id:'owner',kind:'direct'}],messages:[],generation_jobs:[],
  story_branches:[{id:'branch',account_id:'owner',person_id:'person',name:marker,fork_sequence:'9007199254740993',fork_event_revision:'7',scene:{world:{id:'world'},worldVersion:1},version:2}],
  story_messages:[{id:'message',account_id:'owner',branch_id:'branch',text:marker,version:1}],
  story_jobs:jobs('story-'),story_events:[{id:'event',account_id:'owner',branch_id:'branch',summary:marker,memory:marker,version:1}],
  offline_life_plans:[{account_id:'owner',person_id:'person',enabled:true,version:2,next_run_at:'tomorrow',last_run_at:'yesterday',updated_at:'before',time_zone:'UTC',permission_version:7,ai_version:3}],
  offline_life_runs:jobs('life-').map(j=>({...j,plan_version:2,day_key:'2026-11-15',local_day:'2026-11-15',scheduled_at:'due',plan_snapshot:{enabled:true,version:2,time_zone:'UTC',permission_version:7,ai_version:3,summary:marker}})),
  person_world_events:[{id:'life-event',account_id:'owner',source_kind:'offline_life',life_run_id:'life-succeeded',summary:marker,memory:marker,version:1}],
  conversation_commands:[{account_id:'owner',operation:'life.set',response:{personId:'person'}}],outbox_events:[{account_id:'owner',type:'OfflineLifeCommitted.v1',aggregate_id:'life-succeeded'}],
 }
}
function runtime(rows,{damage,skip=false}={}){return{
 async query(_target,sql){
  if(sql.includes('SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind'))return Object.keys(rows).map(name=>({schema:'public',name,kind:'r'}))
  if(sql.includes('AS records'))return Object.entries(rows).map(([name,data])=>({name:'public.'+name,records:data.map(row=>JSON.stringify(row))}))
  if(sql.includes('AS executable_story_jobs'))return[{executable_story_jobs:String([...rows.story_jobs,...rows.offline_life_runs].filter(j=>['queued','running','failed'].includes(j.state)||j.attempt_id||j.lease_until).length+rows.offline_life_plans.filter(p=>p.enabled).length)}]
  if(sql.includes('AS executable_jobs'))return[{executable_jobs:'0'}]
  return[]
 },
 async sql(_target,sql){
  for(const table of ['story_jobs','offline_life_runs'])assert.match(sql,new RegExp('UPDATE public\\.'+table+" SET state='blocked'"))
  assert.match(sql,/UPDATE public\.offline_life_plans SET enabled=false,next_run_at=NULL,version=version\+1/)
  assert.doesNotMatch(sql,/(?:DELETE|INSERT)\s|UPDATE public\.(?:story_branches|story_messages|story_events|person_world_events|conversation_commands)\s/)
  if(skip)return
  for(const table of ['story_jobs','offline_life_runs'])for(const j of rows[table])if(['queued','running','failed'].includes(j.state))Object.assign(j,{state:'blocked',attempt_id:null,lease_until:null,failure_code:'RESTORE_REVIEW_REQUIRED',retryable:false,version:j.version+1,updated_at:'restored'})
  for(const p of rows.offline_life_plans)if(p.enabled)Object.assign(p,{enabled:false,next_run_at:null,version:p.version+1,updated_at:'restored'})
  damage?.(rows)
 },
}}

test('story recovery blocks pending jobs and disables schedules while preserving successful facts, snapshots and all source lineage',async()=>{
 const rows=fixture(),original=structuredClone(rows),rt=runtime(rows),before=await capture(rt,target),proof=await quarantine(rt,target),after=await capture(rt,target)
 assert.equal(proof.assertions.storyJobsAndLifePlansBlocked,true);assert.deepEqual(before.core,after.core)
 for(const table of ['story_branches','story_messages','story_events','person_world_events','conversation_commands','outbox_events'])assert.deepEqual(rows[table],original[table])
 for(const table of ['story_jobs','offline_life_runs'])for(const state of states){const j=rows[table].find(j=>j.state===state&&j.id.endsWith(state))??rows[table].find(j=>j.id.endsWith(state)),old=original[table].find(x=>x.id===j.id);if(['succeeded','blocked','canceled'].includes(state))assert.deepEqual(j,old);else{assert.equal(j.state,'blocked');assert.equal(j.attempt_count,old.attempt_count);assert.equal(j.permission_version,old.permission_version);assert.deepEqual(j.plan_snapshot,old.plan_snapshot);assert.deepEqual(j.event_refs,old.event_refs)}}
 assert.equal(rows.offline_life_plans[0].enabled,false);assert.equal(rows.offline_life_plans[0].last_run_at,'yesterday')
 const expected={story_branch:'branch',story_message:'message',story_job:'story-succeeded',story_event:'event',offline_life_plan:'person',offline_life_run:'life-succeeded'}
 for(const [kind,id]of Object.entries(expected))assert(before.security.resources.some(r=>r.kind===kind&&r.id===id&&r.accountId==='owner'))
 assert(!JSON.stringify({before,after,proof}).includes(marker));assert(!JSON.stringify(proof).includes('actual-response'))
})

test('quarantine cannot mutate captured plans, permission versions, budgets or successful history',async()=>{
 const changes=[r=>r.offline_life_runs[0].plan_snapshot.permission_version++,r=>r.offline_life_runs[0].plan_snapshot.enabled=false,r=>r.offline_life_runs[0].day_key='2026-11-16',r=>r.offline_life_runs[0].attempt_count++,r=>r.story_jobs[0].memory_refs=[],r=>r.story_jobs[0].event_refs=[],r=>r.story_jobs[0].message_refs=[],r=>r.story_jobs[0].permission_version++,r=>r.story_jobs.find(j=>j.state==='succeeded').version++,r=>r.offline_life_plans[0].time_zone='Asia/Shanghai',r=>r.offline_life_plans[0].permission_version++,r=>r.story_events[0].summary='changed',r=>r.person_world_events=[]]
 for(const damage of changes)await assert.rejects(quarantine(runtime(fixture(),{damage}),target),/preserved business content/,damage.toString())
 await assert.rejects(quarantine(runtime(fixture(),{skip:true}),target),/assertions failed/)
 const missing=fixture();delete missing.story_events
 await assert.rejects(quarantine(runtime(missing),target),/Expected recovery table is missing/)
})
