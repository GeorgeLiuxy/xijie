import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {test} from 'node:test'
import {fixture,text} from './fixture.mjs'
import {GenerationEngine} from '../dist/engine.js'
import {worldContextRevision} from '../dist/virtual-world.js'
import {exportConversations,eraseConversations} from '../dist/data-rights.js'

async function setup(t){
 const f=await fixture(t),a=f.account();a.person.worldVersion=1;f.people.set(a.person.id,a.person)
 f.accounts.get(a.id).worldActionProcessing={allowed:true,authorizationVersion:1}
 f.dependencies.virtualWorld=async()=>{const person=f.people.get(a.person.id),value={accountId:a.id,personId:person.id,personVersion:person.version,worldVersion:person.worldVersion,reality:'virtual',branch:'main',currentWorld:{id:person.worldId,code:'courtyard',displayName:'合成庭院',catalogVersion:1,enabled:true},recentMovements:[]};return{...value,revision:worldContextRevision(value)}}
 const cid=(await f.store.ensure(a.id,a.person.id,randomUUID())).conversation.id
 return{f,a,cid,send:body=>f.store.send(a.id,cid,randomUUID(),text(body),randomUUID())}
}
const provenance={model:'synthetic-test-model',responseId:'synthetic-response-id',promptVersion:'person-world-actions-v1'}
const action=(quote)=>({text:'合成测试：我在虚拟庭院挥了两次手，说了青舟到岸。',decision:'execute',action:{requestQuote:quote,summary:'人物在当前虚拟庭院挥了两次手。',memory:'在虚拟庭院，我按用户明确要求挥手两次，并说青舟到岸。'},provenance})
const chat=(body='合成普通文字回复')=>({text:body,decision:'chat',provenance})
const count=async(f,table,account)=>Number((await f.pool.query('SELECT count(*) AS n FROM '+table+' WHERE account_id=$1',[account])).rows[0].n)

test('explicit action, episodic memory, reply and receipt form one atomic original-chat result',async t=>{
 const {f,a,cid,send}=await setup(t),body='现在请你在这里挥两次手，并说青舟到岸。',input=text(body),key=randomUUID()
 const first=await f.store.send(a.id,cid,key,input,randomUUID())
 assert.equal(first.message.sourceDomain,'virtual_context')
 assert.equal((await f.store.send(a.id,cid,key,input,randomUUID())).message.id,first.message.id)
 assert.equal((await f.store.send(a.id,cid,randomUUID(),input,randomUUID())).message.id,first.message.id)
 let calls=0
 const engine=new GenerationEngine(f.store,{async generate(i){calls++;assert.equal(i.worldActionAuthorizationVersion,1);assert.deepEqual(i.worldEvents,[]);return action(body)}})
 await engine.run(first.generationJobId);await engine.run(first.generationJobId)
 assert.equal(calls,1);assert.equal(await count(f,'person_world_events',a.id),1)
 const event=(await f.pool.query('SELECT * FROM person_world_events WHERE account_id=$1',[a.id])).rows[0]
 assert.equal(event.source_message_id,first.message.id);assert.equal(event.reality,'virtual');assert.equal(event.sequence,'1')
 const history=await f.store.messages(a.id,cid,'older',undefined,100)
 assert.equal(history.length,2);assert(history.every(m=>m.sourceDomain==='virtual_action'))
 assert.equal(f.people.get(a.person.id).worldVersion,1)
 await assert.rejects(f.store.sourceContext(a.id,event.source_message_id),{code:'NOT_FOUND'})
 await assert.rejects(f.store.memorySourceContext(a.id,event.reply_id),{code:'NOT_FOUND'})
 const recall=await send('刚才你挥了几次手，说了什么？')
 await new GenerationEngine(f.store,{async generate(i){assert(i.worldEvents.some(e=>e.id===event.id&&e.memory.includes('青舟到岸')));return chat('记得，虚拟庭院里挥了两次手，说青舟到岸。')}}).run(recall.generationJobId)
 const row=(await f.pool.query('SELECT * FROM generation_jobs WHERE id=$1',[recall.generationJobId])).rows[0]
 assert.equal(row.state,'succeeded');assert(row.world_event_context_refs.some(r=>r.id===event.id))
 assert.equal(await count(f,'person_world_events',a.id),1)
 const exported=await exportConversations(f.pool,f.dependencies,a.id,'account_data')
 assert.equal(exported.data.worldEvents.length,1);assert.equal(exported.data.worldActionJobs.length,2)
 assert.equal(exported.data.worldEvents[0].memory,event.memory)
 await assert.rejects(f.pool.query("UPDATE person_world_events SET memory='rewritten' WHERE id=$1",[event.id]),{code:'P0001'})
})

test('ordinary/ambiguous/non-execution output never writes an event and pending sources stay isolated',async t=>{
 const {f,a,cid,send}=await setup(t)
 for(const decision of ['chat','clarify']){
  const sent=await send('只是设想；不要执行任何动作。')
  await assert.rejects(f.store.sourceContext(a.id,sent.message.id),{code:'NOT_FOUND'})
  await new GenerationEngine(f.store,{async generate(){return{text:'我理解这只是设想，没有执行。',decision,provenance}}}).run(sent.generationJobId)
  assert.equal((await f.store.getJob(a.id,sent.generationJobId)).state,'succeeded')
  assert.equal(await count(f,'person_world_events',a.id),0)
  if(decision==='chat')assert.equal((await f.store.sourceContext(a.id,sent.message.id)).text,'只是设想；不要执行任何动作。')
  else await assert.rejects(f.store.sourceContext(a.id,sent.message.id),{code:'NOT_FOUND'})
 }
 assert.equal((await f.pool.query('SELECT world_event_revision FROM conversations WHERE id=$1',[cid])).rows[0].world_event_revision,'0')
})

test('permission withdrawal, source deletion and malformed proposals fence actual event commits',async t=>{
 for(const mode of ['revoke-before','revoke-in-model','regrant-in-model','delete-source','malformed-quote','missing-structure'])await t.test(mode,async t=>{
  const {f,a,send}=await setup(t),body='现在请你挥手两次。',sent=await send(body);let calls=0
  if(mode==='revoke-before')f.accounts.get(a.id).worldActionProcessing={allowed:false,authorizationVersion:2}
  await new GenerationEngine(f.store,{async generate(){calls++
   if(mode==='revoke-in-model')f.accounts.get(a.id).worldActionProcessing={allowed:false,authorizationVersion:2}
   if(mode==='regrant-in-model')f.accounts.get(a.id).worldActionProcessing={allowed:true,authorizationVersion:3}
   if(mode==='delete-source')await f.store.removeMessage(a.id,sent.message.conversationId,sent.message.id,randomUUID(),1,randomUUID())
   if(mode==='malformed-quote')return action('not in the original message')
   if(mode==='missing-structure')return{text:'This is not a structured action result'}
   return action(body)
  }}).run(sent.generationJobId)
  assert.notEqual((await f.store.getJob(a.id,sent.generationJobId)).state,'succeeded');assert.equal(await count(f,'person_world_events',a.id),0)
  assert.equal(Number((await f.pool.query("SELECT count(*) AS n FROM messages WHERE account_id=$1 AND author_kind='persona'",[a.id])).rows[0].n),0)
  if(mode==='revoke-before')assert.equal(calls,0)
 })
})

test('two concurrent candidates cannot both commit against the same narrative revision',async t=>{
 const {f,a,send}=await setup(t),one=await send('现在请你挥手一次。'),two=await send('现在请你向我点头一次。')
 let arrivals=0,release;const barrier=new Promise(r=>release=r)
 const engine=new GenerationEngine(f.store,{async generate(i){if(++arrivals===2)release();await barrier;return action(i.messages.at(-1).text)}})
 await Promise.all([engine.run(one.generationJobId),engine.run(two.generationJobId)])
 const states=await Promise.all([one,two].map(s=>f.store.getJob(a.id,s.generationJobId)))
 assert.equal(states.filter(s=>s.state==='succeeded').length,1);assert.equal(states.filter(s=>s.state==='blocked').length,1)
 assert.equal(await count(f,'person_world_events',a.id),1)
})

test('deleting a source or event reply invalidates dependent episodes and recalled history',async t=>{
 for(const side of ['source_message_id','reply_id'])await t.test(side,async t=>{
  const {f,a,cid,send}=await setup(t),body='现在请你挥手两次。',one=await send(body)
  await new GenerationEngine(f.store,{async generate(){return action(body)}}).run(one.generationJobId)
  const first=(await f.pool.query('SELECT * FROM person_world_events WHERE account_id=$1',[a.id])).rows[0]
  const two=await send('现在请你向我点头一次。')
  await new GenerationEngine(f.store,{async generate(i){assert.equal(i.worldEvents.length,1);return action(i.messages.at(-1).text)}}).run(two.generationJobId)
  assert.equal(await count(f,'person_world_events',a.id),2)
  await f.store.removeMessage(a.id,cid,first[side],randomUUID(),1,randomUUID())
  assert.equal(Number((await f.pool.query('SELECT count(*) AS n FROM person_world_events WHERE account_id=$1 AND removed_at IS NULL',[a.id])).rows[0].n),0)
  const recall=await send('你还记得刚才的动作吗？')
  await new GenerationEngine(f.store,{async generate(i){assert.equal(i.worldEvents.length,0);assert(!i.messages.some(m=>m.id===first.source_message_id||m.id===first.reply_id));return chat('相关来源已经不再可用。')}}).run(recall.generationJobId)
  assert.equal((await f.store.getJob(a.id,recall.generationJobId)).state,'succeeded')
  assert.equal((await exportConversations(f.pool,f.dependencies,a.id,'account_data')).data.worldEvents.length,0)
 })
})

test('withdrawal removes virtual context from new ordinary AI and regrant never revives old work',async t=>{
 const {f,a,send}=await setup(t),body='现在请你挥手两次。',one=await send(body)
 await new GenerationEngine(f.store,{async generate(){return action(body)}}).run(one.generationJobId)
 const pending=await send('现在请你点头。');f.accounts.get(a.id).worldActionProcessing={allowed:false,authorizationVersion:2}
 await new GenerationEngine(f.store,{async generate(){assert.fail('revoked work must not call a model')}}).run(pending.generationJobId)
 const ordinary=await send('你好。')
 await new GenerationEngine(f.store,{async generate(i){assert.equal(i.worldEvents,undefined);assert(!i.messages.some(m=>m.sourceDomain));return{text:'普通回复。'}}}).run(ordinary.generationJobId)
 f.accounts.get(a.id).worldActionProcessing={allowed:true,authorizationVersion:3}
 await assert.rejects(f.store.retry(a.id,pending.generationJobId,randomUUID(),randomUUID()),{code:'GENERATION_NOT_RETRYABLE'})
 assert.equal(await count(f,'person_world_events',a.id),1)
})

test('account erasure clears event authority and all physical action dispatches',async t=>{
 const {f,a,send}=await setup(t),body='现在请你挥手两次。',one=await send(body)
 await new GenerationEngine(f.store,{async generate(){return action(body)}}).run(one.generationJobId)
 const pending=await send('现在请你点头。')
 await eraseConversations(f.pool,f.queueSchema,a.id,randomUUID())
 for(const table of ['person_world_events','generation_jobs','messages','conversations'])assert.equal(await count(f,table,a.id),0)
 assert.equal((await f.pool.query(`SELECT id FROM "${f.queueSchema}".job WHERE data->>'jobId'=$1`,[pending.generationJobId])).rowCount,0)
})
