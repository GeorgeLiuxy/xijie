// Mechanism tests with explicit synthetic providers, not evidence of model quality.
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {test} from 'node:test'
import {fixture,text} from './fixture.mjs'
import {GenerationEngine} from '../dist/engine.js'
import {worldContextRevision} from '../dist/virtual-world.js'
import {exportConversations} from '../dist/data-rights.js'

const provenance={model:'synthetic-history-provider',responseId:'synthetic-history-response',promptVersion:'person-world-actions-v1',promptRevision:'history-v3'}
const chat=()=>({text:'Synthetic recollection; no new event.',decision:'chat',provenance})
const action=input=>({text:'Synthetic committed action at '+input.virtualWorld.currentWorld.code+'.',decision:'execute',action:{requestQuote:input.messages.at(-1).text,summary:'Synthetic finite action at '+input.virtualWorld.currentWorld.code+'.',memory:'Synthetic remembered action at '+input.virtualWorld.currentWorld.code+'.'},provenance})

async function setup(t,history=true){
 const f=await fixture(t),a=f.account()
 const worlds=[{id:a.person.worldId,code:'courtyard',displayName:'Synthetic courtyard',catalogVersion:1,enabled:true},{id:randomUUID(),code:'tide',displayName:'Synthetic tide',catalogVersion:1,enabled:true}]
 let person={...a.person,worldVersion:1},moves=[],resolutions=0
 f.people.set(person.id,person)
 const grant=(allowed=true,version=1,historical=history)=>{f.accounts.get(a.id).worldActionProcessing={allowed,authorizationVersion:version,...(allowed&&historical?{historicalWorldEventsAllowed:true}:{})}}
 grant()
 const snapshot=()=>{const value={accountId:a.id,personId:person.id,personVersion:person.version,worldVersion:person.worldVersion,reality:'virtual',branch:'main',currentWorld:worlds.find(world=>world.id===person.worldId),recentMovements:moves.slice(0,8)};return structuredClone({...value,revision:worldContextRevision(value)})}
 const move=()=>{const from=worlds.find(world=>world.id===person.worldId),to=worlds.find(world=>world.id!==person.worldId),now=new Date().toISOString();person={...person,worldId:to.id,version:person.version+1,worldVersion:person.worldVersion+1};f.people.set(person.id,person);moves.unshift({id:randomUUID(),worldVersion:person.worldVersion,personVersion:person.version,fromWorld:structuredClone(from),toWorld:structuredClone(to),occurredAt:now,recordedAt:now})}
 const resolve=async(current,refs)=>{resolutions++;assert.equal(current.accountId,a.id);assert.equal(current.personId,person.id);return refs.map(ref=>{
  const basis=ref.worldVersion===current.worldVersion?'current_catalog':ref.worldVersion===1?'departure_snapshot':'arrival_snapshot'
  const world=basis==='current_catalog'?current.currentWorld:basis==='departure_snapshot'?moves.find(m=>m.worldVersion===2).fromWorld:moves.find(m=>m.worldVersion===ref.worldVersion).toWorld
  assert.equal(ref.worldId,world.id)
  return {worldVersion:ref.worldVersion,world:structuredClone(world),basis}
 })}
 f.dependencies.virtualWorld=async()=>snapshot();f.dependencies.resolveWorldStages=resolve
 const cid=(await f.store.ensure(a.id,a.person.id,randomUUID())).conversation.id
 const send=body=>f.store.send(a.id,cid,randomUUID(),text(body),randomUUID())
 const job=async id=>(await f.pool.query('SELECT * FROM generation_jobs WHERE id=$1',[id])).rows[0]
 const events=async()=> (await f.pool.query('SELECT * FROM person_world_events WHERE account_id=$1 ORDER BY sequence',[a.id])).rows
 async function turn(body,output=chat){
  const sent=await send(body);let input,calls=0
  await new GenerationEngine(f.store,{async generate(value){calls++;input=value;return output(value)}}).run(sent.generationJobId)
  const saved=await job(sent.generationJobId)
  assert.equal(saved.state,'succeeded');assert.equal(calls,1)
  return {sent,job:saved,input}
 }
 return {f,a,cid,worlds,person:()=>person,snapshot,move,resolve,resolutions:()=>resolutions,grant,send,job,events,turn}
}

test('A to B to A recalls immutable origin stages while new execution uses only the current world',async t=>{
 const s=await setup(t),first=await s.turn('Perform one bounded action in A.',action),oldRecall=await s.turn('Recall the earlier action in A.')
 const eventA=(await s.events())[0]
 s.move()
 const recallB=await s.turn('Recall the earlier action after moving to B.')
 assert.deepEqual(recallB.input.worldEvents.map(e=>[e.id,e.worldId,e.worldVersion,e.origin.basis]),[[eventA.id,s.worlds[0].id,1,'departure_snapshot']])
 assert.equal(recallB.input.virtualWorld.currentWorld.id,s.worlds[1].id)
 const second=await s.turn('Perform another bounded action in current B.',action)
 const eventB=(await s.events())[1]
 assert.equal(eventB.world_id,s.worlds[1].id);assert.equal(eventB.world_version,2)
 assert.deepEqual(second.job.world_event_context_refs.map(r=>r.id),[eventA.id])
 s.move()
 const back=await s.turn('Recall A and B after returning to A.')
 assert.equal(back.input.virtualWorld.currentWorld.id,s.worlds[0].id);assert.equal(back.input.virtualWorld.worldVersion,3)
 assert.deepEqual(back.input.worldEvents.map(e=>[e.id,e.worldVersion,e.origin.world.id,e.origin.basis]),[[eventA.id,1,s.worlds[0].id,'departure_snapshot'],[eventB.id,2,s.worlds[1].id,'arrival_snapshot']])
 const prior=[first,oldRecall,recallB,second].flatMap(turn=>[turn.sent.message.id,turn.job.reply_id])
 assert(!back.input.messages.some(message=>prior.includes(message.id)),'neither side of old action/recall becomes the current transcript')
 const third=await s.turn('Perform one bounded action during this new stay in A.',action),all=await s.events()
 assert.deepEqual(all.map(e=>[e.world_id,e.world_version,e.version]),[[s.worlds[0].id,1,1],[s.worlds[1].id,2,1],[s.worlds[0].id,3,1]])
 assert.equal(third.job.world_context_ref.worldVersion,3)
 assert.deepEqual(third.job.world_event_context_refs.map(r=>r.id),[eventA.id,eventB.id])
 const history=await s.f.store.messages(s.a.id,s.cid,'older',undefined,100)
 assert(prior.every(id=>history.some(message=>message.id===id)),'displayed history remains intact')
 const exported=await exportConversations(s.f.pool,s.f.dependencies,s.a.id,'account_data')
 assert.deepEqual(exported.data.worldEvents.map(e=>e.world_version),[1,2,3])
})

test('history retrieval resolves an event older than the recent eight moves without changing its phase',async t=>{
 const s=await setup(t);await s.turn('Perform the original finite action.',action)
 const original=(await s.events())[0]
 for(let i=0;i<10;i++)s.move()
 const recalled=await s.turn('Recall the very first action before all those moves.')
 assert.equal(recalled.input.virtualWorld.worldVersion,11);assert.equal(recalled.input.virtualWorld.recentMovements.length,8)
 assert.deepEqual(recalled.input.worldEvents.map(e=>[e.id,e.worldVersion,e.origin.basis]),[[original.id,1,'departure_snapshot']])
 assert.equal(s.resolutions(),1);assert.equal((await s.events()).length,1)
})

test('old v1 permission and an explicit false capability never import past-stage events',async t=>{
 for(const flag of [undefined,false])await t.test(String(flag),async t=>{
  const s=await setup(t,false);await s.turn('Perform one old-policy action.',input=>({...action(input),provenance:{...provenance,promptRevision:'recipient-v2'}}))
  s.move()
  if(flag===false)s.f.accounts.get(s.a.id).worldActionProcessing.historicalWorldEventsAllowed=false
  s.f.dependencies.resolveWorldStages=async()=>assert.fail('old permission must not resolve past stages')
  const next=await s.turn('What happened before the move?',input=>({...chat(),provenance:{...provenance,promptRevision:'recipient-v2'}}))
  assert.deepEqual(next.input.worldEvents,[]);assert.equal(next.input.messages.length,1)
  assert.deepEqual(next.job.world_event_context_refs,[])
 })
})

test('missing or forged historical origin fails before the provider and produces no new reply or event',async t=>{
 for(const mode of ['absent','world','future','basis','duplicate'])await t.test(mode,async t=>{
  const s=await setup(t);await s.turn('Perform the original bounded action.',action);s.move()
  if(mode==='absent')delete s.f.dependencies.resolveWorldStages
  else s.f.dependencies.resolveWorldStages=async(world,refs)=>{
   const values=await s.resolve(world,refs)
   if(mode==='world')values[0].world.id=randomUUID()
   if(mode==='future')values[0].worldVersion=world.worldVersion+1
   if(mode==='basis')values[0].basis='current_catalog'
   if(mode==='duplicate')values.push(values[0])
   return values
  }
  let calls=0;const sent=await s.send('Recall the original action.')
  await new GenerationEngine(s.f.store,{async generate(){calls++;return chat()}}).run(sent.generationJobId)
  const job=await s.job(sent.generationJobId)
  assert.equal(calls,0);assert.notEqual(job.state,'succeeded');assert.equal(job.reply_id,null);assert.equal((await s.events()).length,1)
  assert.equal((await s.f.pool.query("SELECT count(*)::int n FROM messages WHERE generation_job_id=$1 AND author_kind='persona'",[job.id])).rows[0].n,0)
 })
})

test('moving during origin resolution or a model attempt cannot commit an action in the former scene',async t=>{
 for(const mode of ['during-resolution','during-model','aba-during-model'])await t.test(mode,async t=>{
  const s=await setup(t);await s.turn('Perform the original bounded action.',action);s.move()
  if(mode==='during-resolution')s.f.dependencies.resolveWorldStages=async(world,refs)=>{const value=await s.resolve(world,refs);s.move();return value}
  let calls=0;const sent=await s.send('Perform a new bounded action in the current world.')
  await new GenerationEngine(s.f.store,{async generate(input){calls++;s.move();if(mode==='aba-during-model')s.move();return action(input)}}).run(sent.generationJobId)
  const job=await s.job(sent.generationJobId)
  assert.equal(job.state,'blocked');assert.equal(calls,mode==='during-resolution'?0:1);assert.equal(job.reply_id,null);assert.equal((await s.events()).length,1)
 })
})

test('deleting either original endpoint invalidates dependent events across stages and leaves readable history',async t=>{
 for(const side of ['source_message_id','reply_id'])await t.test(side,async t=>{
  const s=await setup(t);await s.turn('Perform the first action in A.',action);const first=(await s.events())[0]
  s.move();const second=await s.turn('Perform the dependent action in B.',action)
  assert.deepEqual(second.job.world_event_context_refs.map(r=>r.id),[first.id])
  await s.f.store.removeMessage(s.a.id,s.cid,first[side],randomUUID(),1,randomUUID())
  assert((await s.events()).every(event=>event.removed_at!==null))
  s.move();const recall=await s.turn('Recall the unavailable earlier actions.')
  assert.deepEqual(recall.input.worldEvents,[])
  assert(!recall.input.messages.some(m=>[first.source_message_id,first.reply_id,second.sent.message.id,second.job.reply_id].includes(m.id)))
  const history=await s.f.store.messages(s.a.id,s.cid,'older',undefined,100)
  assert(history.some(m=>m.id===second.job.reply_id));assert(!history.some(m=>m.id===first[side]))
  assert.equal((await exportConversations(s.f.pool,s.f.dependencies,s.a.id,'account_data')).data.worldEvents.length,0)
 })
})

test('cross-stage withdrawal blocks pending work and ordinary chat cannot inherit events; regrant only affects new work',async t=>{
 const s=await setup(t);await s.turn('Perform a saved action before withdrawal.',action);s.move()
 const pending=await s.send('Recall the past-stage action.');s.grant(false,2)
 let revokedCalls=0
 await new GenerationEngine(s.f.store,{async generate(){revokedCalls++;return chat()}}).run(pending.generationJobId)
 const blocked=await s.job(pending.generationJobId)
 assert.equal(revokedCalls,0);assert.equal(blocked.state,'blocked');assert.equal(blocked.failure_code,'WORLD_ACTION_PERMISSION_REQUIRED')
 const ordinary=await s.send('An ordinary greeting.');let ordinaryInput
 await new GenerationEngine(s.f.store,{async generate(input){ordinaryInput=input;return {text:'Synthetic ordinary reply.'}}}).run(ordinary.generationJobId)
 assert.equal((await s.job(ordinary.generationJobId)).state,'succeeded');assert.equal(ordinaryInput.worldEvents,undefined)
 assert(!ordinaryInput.messages.some(m=>m.sourceDomain||m.worldEventContextRefs?.length))
 s.grant(true,3)
 await assert.rejects(s.f.store.retry(s.a.id,pending.generationJobId,randomUUID(),randomUUID()),{code:'GENERATION_NOT_RETRYABLE'})
 const renewed=await s.turn('Recall the earlier action under renewed permission.')
 assert.equal(renewed.input.worldEvents.length,1);assert.equal((await s.events()).length,1)
 assert.equal((await s.job(pending.generationJobId)).state,'blocked')
})

test('v2 excludes fresh profile projections and old events carrying direct or inherited profile references',async t=>{
 const s=await setup(t,false)
 const entry=kind=>({id:randomUUID(),version:1,body:kind==='profile'?'PROFILE_PRIVATE_PROJECTION':'Authorized direct message fact',topic:'Synthetic fact',timeDescription:'',evidence:'Synthetic evidence',sourceKind:kind,sourceId:kind==='profile'?s.a.person.id:randomUUID(),sourceVersion:1,sourceAuthor:'self',reality:kind==='profile'?'user_provided_profile':'user_reported',sourceCreatedAt:new Date().toISOString(),sources:[]})
 const profile=entry('profile'),message=entry('message')
 s.f.dependencies.automaticMemories=async()=>[profile]
 s.f.dependencies.validateAutomaticMemories=async(accountId,personId)=>{assert.equal(accountId,s.a.id);assert.equal(personId,s.a.person.id);return true}
 const first=await s.turn('Perform an old-policy action using a profile projection.',input=>({...action(input),provenance:{...provenance,promptRevision:'recipient-v2'}}))
 assert.equal(first.input.automaticMemories[0].id,profile.id)
 s.f.dependencies.automaticMemories=async()=>[]
 const child=await s.turn('Perform another old-policy action inheriting that event.',input=>({...action(input),provenance:{...provenance,promptRevision:'recipient-v2'}}))
 assert(child.job.world_event_context_refs.length>0);assert(child.job.memory_context_refs.some(ref=>ref.id===profile.id))
 s.grant(true,2,true);s.move()
 s.f.dependencies.automaticMemories=async()=>[{...profile,sourceVersion:s.person().version},message]
 const current=await s.turn('What event memory is actually available under the new scope?')
 assert.deepEqual(current.input.worldEvents,[])
 assert.deepEqual(current.input.automaticMemories.map(ref=>ref.id),[message.id])
 assert(!JSON.stringify(current.input).includes('PROFILE_PRIVATE_PROJECTION'))
 assert(current.job.memory_context_refs.every(ref=>ref.sourceKind==='message'))
 assert.equal((await s.events()).length,2);assert((await s.events()).every(event=>event.removed_at===null),'excluded model sources remain historical facts')
})
