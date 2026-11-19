import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { AutomaticSourceStore } from '../dist/automatic-sources.js'
import { SELF_HARM_SUPPORT_REQUIRED } from '../dist/conversation-safety.js'
import { GenerationEngine } from '../dist/engine.js'
import { fixture, text } from './fixture.mjs'

const supportFailure={code:SELF_HARM_SUPPORT_REQUIRED,retryable:false}

test('direct imminent text is stored exactly, with a terminal support signal and no model dispatch or later reuse',async t=>{
 const f=await fixture(t),a=f.account(),other=f.account()
 Object.assign(f.accounts.get(a.id),{worldActionProcessing:{allowed:true,authorizationVersion:1}})
 const {conversation}=await f.store.ensure(a.id,a.person.id,randomUUID())
 const original=text('我现在就要自杀。'),key=randomUUID()
 const sent=await f.store.send(a.id,conversation.id,key,original,randomUUID())
 assert.equal(sent.message.text,original.text)
 assert.deepEqual(await f.store.send(a.id,conversation.id,key,original,randomUUID()),sent)
 assert.equal(await f.queue.isPending(f.pool,sent.generationJobId),false)
 const job=await f.store.getJob(a.id,sent.generationJobId)
 assert.equal(job.state,'blocked')
 assert.deepEqual(job.failure,supportFailure)
 assert.deepEqual(job.replyIds,[])
 await assert.rejects(f.store.getJob(other.id,sent.generationJobId),{code:'NOT_FOUND'})
 await assert.rejects(f.store.retry(a.id,sent.generationJobId,randomUUID(),randomUUID()),{code:'GENERATION_NOT_RETRYABLE'})
 const sources=new AutomaticSourceStore(f.pool,f.dependencies)
 assert.deepEqual(await sources.events([a.id]),[])
 await assert.rejects(sources.source(a.id,sent.message.id),{code:'NOT_FOUND'})
 assert.deepEqual((await sources.validate(a.id,a.person.id,[{id:sent.message.id,version:sent.message.version}])).valid,[])

 delete f.accounts.get(a.id).worldActionProcessing
 let generated=0
 const engine=new GenerationEngine(f.store,{async generate(input){
  generated++
  assert.equal(input.messages.some(message=>message.id===sent.message.id),false)
  assert.equal(input.messages.at(-1).text,'今天很难过，但我现在很安全。')
  return {text:'Synthetic integration reply.'}
 }})
 await engine.run(sent.generationJobId)
 assert.equal(generated,0)
 const follow=await f.store.send(a.id,conversation.id,randomUUID(),text('今天很难过，但我现在很安全。'),randomUUID())
 await engine.run(follow.generationJobId)
 assert.equal((await f.store.getJob(a.id,follow.generationJobId)).state,'succeeded')
 assert.equal(generated,1)
 const stored=await f.store.messages(a.id,conversation.id,'older',undefined,20)
 assert.equal(stored.find(message=>message.id===sent.message.id).text,original.text)
 assert.equal(stored.some(message=>message.replyToMessageId===sent.message.id),false)
 const auto=await sources.source(a.id,follow.message.id)
 assert.equal(auto.context.some(message=>message.id===sent.message.id),false)
})

test('a previously queued direct message is still checked in the engine before model and memory lookup',async t=>{
 const f=await fixture(t),a=f.account()
 Object.assign(f.accounts.get(a.id),{worldActionProcessing:{allowed:true,authorizationVersion:1}})
 const {conversation}=await f.store.ensure(a.id,a.person.id,randomUUID())
 const sent=await f.store.send(a.id,conversation.id,randomUUID(),text('Synthetic message queued before the revision.'),randomUUID())
 assert.equal((await f.store.getJob(a.id,sent.generationJobId)).state,'queued')
 // Model what the pre-release send path could already have queued.
 const original="I'm about to end my life."
 await f.pool.query('UPDATE messages SET text=$2 WHERE id=$1',[sent.message.id,original])
 let invoked=0
 f.dependencies.memories=async()=>{invoked++;return []}
 f.dependencies.automaticMemories=async()=>{invoked++;return []}
 const engine=new GenerationEngine(f.store,{async generate(){invoked++;throw new Error('Unexpected model call')}})
 await engine.run(sent.generationJobId)
 const job=await f.store.getJob(a.id,sent.generationJobId)
 assert.equal(invoked,0)
 assert.equal(job.state,'blocked')
 assert.deepEqual(job.failure,supportFailure)
 assert.deepEqual(job.replyIds,[])
 assert.equal((await f.store.messages(a.id,conversation.id,'older',undefined,20))[0].text,original)
})
