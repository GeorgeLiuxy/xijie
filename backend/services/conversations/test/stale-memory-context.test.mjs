import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {test} from 'node:test'
import {fixture,text} from './fixture.mjs'
import {ConversationError} from '../dist/contracts.js'
import {GenerationEngine} from '../dist/engine.js'

async function conversation(f,account){return (await f.store.ensure(account.id,account.person.id,randomUUID())).conversation}
async function send(f,account,chat,value){return f.store.send(account.id,chat.id,randomUUID(),text(value),randomUUID())}
async function reply(f,account,chat,uses=[],value='Synthetic assistant context'){
 const sent=await send(f,account,chat,'Synthetic prior user input')
 const job=await f.store.claim(sent.generationJobId)
 assert.equal(await f.store.complete(job,value,account.person.displayName,await f.store.context(job),uses),true)
 const history=await f.store.messages(account.id,chat.id,'older',undefined,20)
 return {sent,message:history.find(message=>message.generationJobId===job.id&&message.author.kind==='persona')}
}

test('generation context revalidates historical automatic references without altering readable history',{timeout:30000},async t=>{
 const f=await fixture(t),account=f.account(),chat=await conversation(f,account)
 const refs=[{id:randomUUID(),version:1},{id:randomUUID(),version:2}]
 const uses=refs.map(ref=>({kind:'automatic',...ref,sourceKind:'message',sourceId:randomUUID(),sourceVersion:1,sources:[{id:randomUUID(),version:1}]}))
 f.dependencies.validateAutomaticMemories=async()=>true
 const first=await reply(f,account,chat,uses,'Synthetic assistant response using now-withdrawable facts')
 const second=await reply(f,account,chat,[...uses].reverse(),'Synthetic later assistant response using the same references')
 const source=await send(f,account,chat,'Synthetic new valid user source')
 const job=await f.store.findJob(source.generationJobId)
 const expected=[...refs].sort((a,b)=>a.id.localeCompare(b.id)||a.version-b.version)
 const assertHistoryPreserved=async()=>{
  const history=await f.store.messages(account.id,chat.id,'older',undefined,20)
  for(const item of [first.message,second.message,source.message])assert.ok(history.some(message=>message.id===item.id))
 }
 await t.test('real committed replies retain their exact original references and valid groups are checked once',async()=>{
  const persisted=(await f.pool.query('SELECT memory_context_refs FROM generation_jobs WHERE id=$1',[first.sent.generationJobId])).rows[0]
  assert.deepEqual(persisted.memory_context_refs,uses)
  let calls=0
  f.dependencies.validateAutomaticMemories=async(accountId,personId,actual)=>{
   calls++;assert.equal(accountId,account.id);assert.equal(personId,account.person.id);assert.deepEqual(actual,expected);return true
  }
  const context=await f.store.context(job)
  assert.equal(calls,1)
  for(const item of [first.message,second.message,source.message])assert.ok(context.some(message=>message.id===item.id))
  assert.deepEqual(context.find(message=>message.id===first.message.id).memoryContextRefs,uses)
  assert.deepEqual(context.find(message=>message.id===second.message.id).memoryContextRefs,[...uses].reverse())
  assert.equal('memoryContextRefs' in context.find(message=>message.id===source.message.id),false)
  assert.equal((await f.store.messages(account.id,chat.id,'older',undefined,20)).some(message=>'memoryContextRefs' in message),false)
 })
 await t.test('withdrawn or superseded references exclude old assistant text while retaining effective user messages and history',async()=>{
  let calls=0
  f.dependencies.validateAutomaticMemories=async(_account,_person,actual)=>{calls++;assert.deepEqual(actual,expected);return false}
  const context=await f.store.context(job)
  assert.equal(calls,1,'Negative results for the same reference group must also be cached')
  assert.equal(context.some(message=>message.id===first.message.id||message.id===second.message.id),false)
  for(const item of [first.sent.message,second.sent.message,source.message])assert.ok(context.some(message=>message.id===item.id))
  await assertHistoryPreserved()
 })
 await t.test('missing metadata capability excludes unverifiable assistant text without dropping the current user source',async()=>{
  delete f.dependencies.validateAutomaticMemories
  const context=await f.store.context(job)
  assert.deepEqual(context.map(message=>message.id),[first.sent.message.id,second.sent.message.id,source.message.id])
  await assertHistoryPreserved()
 })
 await t.test('metadata dependency outage fails generation before any provider call instead of silently using stale text',async()=>{
  f.dependencies.validateAutomaticMemories=async()=>{throw new ConversationError(503,'DEPENDENCY_UNAVAILABLE','Synthetic metadata outage')}
  await assert.rejects(f.store.context(job),{status:503,code:'DEPENDENCY_UNAVAILABLE'})
  let calls=0
  await new GenerationEngine(f.store,{async generate(){calls++;return {text:'Must not become a reply'}}}).run(job.id)
  assert.equal(calls,0)
  const failed=await f.store.getJob(account.id,job.id)
  assert.equal(failed.state,'failed');assert.deepEqual(failed.failure,{code:'DEPENDENCY_UNAVAILABLE',retryable:true})
  assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM messages WHERE generation_job_id=$1 AND author_kind='persona'",[job.id])).rows[0].n,0)
  await assertHistoryPreserved()
 })
})

test('historical AI lineage has a latest-first distinct budget and never silently merges conflicting versions',{timeout:30000},async t=>{
 const f=await fixture(t)
 f.dependencies.validateAutomaticMemories=async()=>true
 const makeUses=count=>Array.from({length:count},()=>({kind:'automatic',id:randomUUID(),version:1}))
 await t.test('the latest three disjoint eight-ref replies fit; an older whole reply is excluded without dropping its user source',async()=>{
  const account=f.account(),chat=await conversation(f,account),past=[]
  for(let i=0;i<4;i++)past.push(await reply(f,account,chat,makeUses(8),'Synthetic budgeted assistant '+i))
  const source=await send(f,account,chat,'Synthetic current input at the lineage budget')
  let calls=0
  f.dependencies.validateAutomaticMemories=async(_account,_person,refs)=>{calls++;assert.equal(refs.length,8);return true}
  const context=await f.store.context(await f.store.findJob(source.generationJobId))
  assert.equal(calls,3)
  assert.equal(context.some(message=>message.id===past[0].message.id),false)
  for(const previous of past){
   assert.ok(context.some(message=>message.id===previous.sent.message.id))
   if(previous!==past[0])assert.ok(context.some(message=>message.id===previous.message.id))
  }
  assert.equal(new Set(context.flatMap(message=>(message.memoryContextRefs??[]).map(ref=>ref.id))).size,24)
  assert.ok(context.some(message=>message.id===source.message.id))
 })
 await t.test('one 24-ref historical group is valid, while a 25-ref group is excluded as a whole before an RPC',async()=>{
  for(const count of [24,25]){
   f.dependencies.validateAutomaticMemories=async()=>true
   const account=f.account(),chat=await conversation(f,account),past=await reply(f,account,chat,makeUses(count),'Synthetic whole lineage group')
   const source=await send(f,account,chat,'Synthetic current user input')
   let calls=0
   f.dependencies.validateAutomaticMemories=async(_account,_person,refs)=>{calls++;assert.equal(refs.length,24);return true}
   const context=await f.store.context(await f.store.findJob(source.generationJobId))
   assert.equal(calls,count===24?1:0)
   assert.equal(context.some(message=>message.id===past.message.id),count===24)
   for(const item of [past.sent.message,source.message])assert.ok(context.some(message=>message.id===item.id))
  }
 })
 await t.test('a newer verified version wins and an older conflicting AI group cannot replace it',async()=>{
  f.dependencies.validateAutomaticMemories=async()=>true
  const account=f.account(),chat=await conversation(f,account),id=randomUUID()
  const old=await reply(f,account,chat,[{kind:'automatic',id,version:1}],'Synthetic older version')
  const latest=await reply(f,account,chat,[{kind:'automatic',id,version:2}],'Synthetic newer version')
  const source=await send(f,account,chat,'Synthetic current version question')
  const seen=[]
  f.dependencies.validateAutomaticMemories=async(_account,_person,refs)=>{seen.push(refs);return true}
  const context=await f.store.context(await f.store.findJob(source.generationJobId))
  assert.deepEqual(seen,[[{id,version:2}]])
  assert.equal(context.some(message=>message.id===old.message.id),false)
  assert.ok(context.some(message=>message.id===latest.message.id))
  assert.deepEqual(context.find(message=>message.id===latest.message.id).memoryContextRefs,[{kind:'automatic',id,version:2}])
  for(const item of [old.sent.message,latest.sent.message,source.message])assert.ok(context.some(message=>message.id===item.id))
 })
})

test('generation-only history filtering honors removed parents and exact account/conversation boundaries',{timeout:30000},async t=>{
 const f=await fixture(t),account=f.account(),chat=await conversation(f,account)
 const original=await reply(f,account,chat,[],'Synthetic assistant whose user evidence will be removed')
 await f.store.removeMessage(account.id,chat.id,original.sent.message.id,randomUUID(),original.sent.message.version,randomUUID())
 const source=await send(f,account,chat,'Synthetic current user input after source removal')
 const job=await f.store.findJob(source.generationJobId)
 const context=await f.store.context(job)
 assert.deepEqual(context.map(message=>message.id),[source.message.id])
 assert.equal((await f.store.messages(account.id,chat.id,'older',undefined,20)).some(message=>message.id===original.message.id),true)

 const foreign=f.account(),other=await conversation(f,foreign)
 const outside=await reply(f,foreign,other,[],'Synthetic other-account content')
 await assert.rejects(f.store.context({...job,source_message_id:outside.sent.message.id}),{status:404})
 const otherPerson={...account.person,id:randomUUID()};f.people.set(otherPerson.id,otherPerson)
 const sameAccount={...account,person:otherPerson},otherChat=await conversation(f,sameAccount)
 const otherSource=await send(f,sameAccount,otherChat,'Synthetic other-conversation source')
 await assert.rejects(f.store.context({...job,source_message_id:otherSource.message.id}),{status:404})
 assert.equal((await f.store.context(job)).some(message=>message.id===outside.message.id||message.id===otherSource.message.id),false)
})
