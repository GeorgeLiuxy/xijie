import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {test} from 'node:test'
import {fixture,text} from './fixture.mjs'
import {GenerationEngine} from '../dist/engine.js'

test('memory-candidate source contains exactly the selected AI reply and its visible user evidence',async t=>{
  const f=await fixture(t),a=f.account(),b=f.account()
  const {conversation}=await f.store.ensure(a.id,a.person.id,randomUUID())
  const sent=await f.store.send(a.id,conversation.id,randomUUID(),text('用户明确提供：我们喜欢傍晚沿河散步。'),randomUUID())
  await new GenerationEngine(f.store,{async generate(){return {text:'一起聊聊河边散步吧。'}}}).run(sent.generationJobId)
  const job=await f.store.getJob(a.id,sent.generationJobId),replyId=job.replyIds[0]
  const future=await f.store.send(a.id,conversation.id,randomUUID(),text('这条较晚的私密消息不应进入旧建议。'),randomUUID())
  const result=await f.store.memorySourceContext(a.id,replyId)
  assert.equal(result.source.id,replyId)
  assert.equal(result.source.accountId,a.id)
  assert.equal(result.source.personId,a.person.id)
  assert.deepEqual(result.messages.map(value=>value.id),[sent.message.id,replyId])
  assert.deepEqual(result.messages.map(value=>value.author.kind),['self','persona'])
  assert.ok(result.messages.every(value=>value.id!==future.message.id&&value.version===1))
  await assert.rejects(f.store.memorySourceContext(b.id,replyId),{code:'NOT_FOUND'})
  await assert.rejects(f.store.memorySourceContext(a.id,sent.message.id),{code:'NOT_FOUND'})
  await f.store.removeMessage(a.id,conversation.id,sent.message.id,randomUUID(),sent.message.version,randomUUID())
  await assert.rejects(f.store.memorySourceContext(a.id,replyId),{code:'NOT_FOUND'})
  // An already confirmed manual original can still validate its optional AI source independently.
  assert.equal((await f.store.sourceContext(a.id,replyId)).id,replyId)
})
