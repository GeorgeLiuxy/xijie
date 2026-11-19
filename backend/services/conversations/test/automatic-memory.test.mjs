import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {test} from 'node:test'
import {fixture,text} from './fixture.mjs'
import {GenerationEngine} from '../dist/engine.js'

const entry=()=>({id:randomUUID(),version:1,body:'合成用户每周三在南岸天文馆值班。',topic:'用户每周安排',timeDescription:'每周三',evidence:'我每周三在南岸天文馆值班',sourceKind:'message',sourceId:randomUUID(),sourceVersion:1,sourceAuthor:'self',reality:'user_reported',sourceCreatedAt:new Date().toISOString(),sourceSequence:'1',sources:[{id:randomUUID(),version:1}]})
async function prepare(f){const a=f.account(),{conversation}=await f.store.ensure(a.id,a.person.id,randomUUID()),sent=await f.store.send(a.id,conversation.id,randomUUID(),text('合成用户的每周安排是什么？'),randomUUID());return {a,conversation,sent}}

test('automatic memories reach the original reply path and persist the actual references without a cherish action',async t=>{
 const f=await fixture(t),{a,sent}=await prepare(f),selected=[entry()]
 let validationCalls=0,reads=0
 f.dependencies.automaticMemories=async(accountId,personId)=>{assert.equal(accountId,a.id);assert.equal(personId,a.person.id);reads++;return structuredClone(selected)}
 f.dependencies.validateAutomaticMemories=async(accountId,personId,refs)=>{assert.equal(accountId,a.id);assert.equal(personId,a.person.id);assert.deepEqual(refs,selected.map(({id,version})=>({id,version})));validationCalls++;return true}
 await new GenerationEngine(f.store,{async generate(input){assert.deepEqual(input.automaticMemories,selected);assert.deepEqual(input.memories,[]);return {text:'合成回复：周三去南岸天文馆值班。'}}}).run(sent.generationJobId)
 assert.equal((await f.store.getJob(a.id,sent.generationJobId)).state,'succeeded')
 const row=(await f.pool.query('SELECT memory_context_refs FROM generation_jobs WHERE id=$1',[sent.generationJobId])).rows[0]
 assert.deepEqual(row.memory_context_refs,selected.map(value=>({kind:'automatic',id:value.id,version:value.version,sourceKind:value.sourceKind,sourceId:value.sourceId,sourceVersion:value.sourceVersion,sources:value.sources})))
 assert.equal(reads,1);assert.equal(validationCalls,2)
})

test('only the automatic references actually used may veto a reply, including the final commit check',async t=>{
 const f=await fixture(t)
 for(const mode of ['new-unrelated-entry','used-entry-retracted','changed-at-final-check'])await t.test(mode,async()=>{
  const {a,sent}=await prepare(f),used=entry();let values=[used],valid=true,calls=0
  f.dependencies.automaticMemories=async()=>structuredClone(values)
  f.dependencies.validateAutomaticMemories=async(_account,_person,refs)=>{assert.deepEqual(refs,[{id:used.id,version:used.version}]);calls++;return mode==='changed-at-final-check'?calls<2:valid}
  await new GenerationEngine(f.store,{async generate(){if(mode==='new-unrelated-entry')values.push(entry());if(mode==='used-entry-retracted')valid=false;return {text:'受控的合成回复'}}}).run(sent.generationJobId)
  const job=await f.store.getJob(a.id,sent.generationJobId)
  assert.equal(job.state,mode==='new-unrelated-entry'?'succeeded':'blocked')
  if(mode!=='new-unrelated-entry')assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM messages WHERE generation_job_id=$1 AND author_kind='persona'",[sent.generationJobId])).rows[0].n,0)
 })
})
