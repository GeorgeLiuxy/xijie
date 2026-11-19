import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {test} from 'node:test'
import {fixture,text} from './fixture.mjs'
import {ConversationError} from '../dist/contracts.js'
import {Dependencies} from '../dist/dependencies.js'
import {GenerationEngine} from '../dist/engine.js'

const memory = (body='用户确认：放学后沿河散步。') => ({id:randomUUID(),version:1,title:'河边散步',body})
async function prepare(f,value='你还记得沿河散步吗？') {
  const account=f.account()
  const {conversation}=await f.store.ensure(account.id,account.person.id,randomUUID())
  const sent=await f.store.send(account.id,conversation.id,randomUUID(),text(value),randomUUID())
  return {account,conversation,sent}
}
async function noReply(f,jid) {
  const result=await f.pool.query("SELECT count(*)::int AS n FROM messages WHERE generation_job_id=$1 AND author_kind='persona'",[jid])
  assert.equal(result.rows[0].n,0)
}

test('confirmed memory context is used and revalidated before a chat reply commits', {timeout:30000}, async t=>{
  const f=await fixture(t)
  await t.test('the provider receives exactly the current confirmed records selected for this person and query',async()=>{
    const {account,conversation,sent}=await prepare(f)
    const confirmed=[memory()]
    const requests=[];let calls=0
    f.dependencies.memories=async(accountId,personId,query)=>{
      requests.push({accountId,personId,query})
      return structuredClone(confirmed)
    }
    const engine=new GenerationEngine(f.store,{async generate(input){
      calls++
      assert.equal(input.accountId,account.id)
      assert.equal(input.person.id,account.person.id)
      assert.deepEqual(input.memories,confirmed)
      assert.equal(input.messages.at(-1).id,sent.message.id)
      return {text:'Controlled test response using the supplied confirmed-memory context.'}
    }})
    await engine.run(sent.generationJobId)
    await engine.run(sent.generationJobId)
    const job=await f.store.getJob(account.id,sent.generationJobId)
    assert.equal(job.state,'succeeded')
    assert.equal(job.replyIds.length,1)
    assert.equal(calls,1)
    assert.deepEqual(requests,Array.from({length:2},()=>({accountId:account.id,personId:account.person.id,query:sent.message.text})))
    const saved=await f.store.messages(account.id,conversation.id,'older',undefined,20)
    assert.equal(saved.filter(value=>value.author.kind==='persona').length,1)
  })

  for(const mode of ['edited-version','deleted','replaced-selection','new-selection']) {
    await t.test('memory '+mode+' during generation blocks the late reply',async()=>{
      const {account,sent}=await prepare(f)
      let selected=[memory()]
      f.dependencies.memories=async()=>structuredClone(selected)
      let entered,release
      const started=new Promise(resolve=>{entered=resolve})
      const barrier=new Promise(resolve=>{release=resolve})
      let captured
      const engine=new GenerationEngine(f.store,{async generate(input){
        captured=structuredClone(input.memories)
        entered()
        await barrier
        return {text:'This stale test output must never become a saved reply.'}
      }})
      const running=engine.run(sent.generationJobId)
      try {
        await started
        assert.equal(captured.length,1)
        if(mode==='edited-version')selected=[{...selected[0],version:2,body:'已经更正的原文。'}]
        if(mode==='deleted')selected=[]
        if(mode==='replaced-selection')selected=[memory('这是当前查询选中的另一条已确认原文。')]
        if(mode==='new-selection')selected=[...selected,memory('新确认的相关原文进入了选择集。')]
      } finally {release()}
      await running
      const job=await f.store.getJob(account.id,sent.generationJobId)
      assert.equal(job.state,'blocked')
      assert.deepEqual(job.failure,{code:'MEMORY_CONTEXT_CHANGED',retryable:false})
      assert.deepEqual(job.replyIds,[])
      await noReply(f,sent.generationJobId)
    })
  }

  await t.test('a memory dependency failure before generation does not call the provider or fall back to no memories',async()=>{
    const {account,sent}=await prepare(f)
    f.dependencies.memories=async()=>{throw new ConversationError(503,'DEPENDENCY_UNAVAILABLE','Synthetic dependency outage')}
    let calls=0
    await new GenerationEngine(f.store,{async generate(){calls++;return {text:'Must not be used'}}}).run(sent.generationJobId)
    const job=await f.store.getJob(account.id,sent.generationJobId)
    assert.equal(calls,0)
    assert.equal(job.state,'failed')
    assert.deepEqual(job.failure,{code:'DEPENDENCY_UNAVAILABLE',retryable:true})
    await noReply(f,sent.generationJobId)
  })

  await t.test('a memory dependency failure after generation keeps the unverified output out of history',async()=>{
    const {account,sent}=await prepare(f)
    let reads=0,calls=0
    const confirmed=[memory()]
    f.dependencies.memories=async()=>{
      if(++reads>1)throw new ConversationError(503,'DEPENDENCY_UNAVAILABLE','Synthetic dependency outage')
      return structuredClone(confirmed)
    }
    await new GenerationEngine(f.store,{async generate(){calls++;return {text:'Unverified late fixture response'}}}).run(sent.generationJobId)
    const job=await f.store.getJob(account.id,sent.generationJobId)
    assert.equal(calls,1)
    assert.equal(reads,2)
    assert.equal(job.state,'failed')
    assert.deepEqual(job.failure,{code:'DEPENDENCY_UNAVAILABLE',retryable:true})
    await noReply(f,sent.generationJobId)
  })

  await t.test('the K03 ContextProvider without the optional memory capability remains compatible',async()=>{
    delete f.dependencies.memories
    const {account,sent}=await prepare(f,'Legacy K03 synthetic message')
    await new GenerationEngine(f.store,{async generate(input){
      assert.deepEqual(input.memories,[])
      return {text:'Controlled legacy-compatible test reply'}
    }}).run(sent.generationJobId)
    const job=await f.store.getJob(account.id,sent.generationJobId)
    assert.equal(job.state,'succeeded')
    assert.equal(job.replyIds.length,1)
  })

  await t.test('message source context enforces current account, person, storage access and deletion',async()=>{
    const {account,conversation,sent}=await prepare(f)
    const other=f.account()
    const source=await f.store.sourceContext(account.id,sent.message.id)
    assert.equal(source.accountId,account.id)
    assert.equal(source.personId,account.person.id)
    assert.equal(source.conversationId,conversation.id)
    assert.equal(source.text,sent.message.text)
    assert.equal(source.version,1)
    await assert.rejects(f.store.sourceContext(other.id,sent.message.id),{status:404,code:'NOT_FOUND'})
    await assert.rejects(f.store.sourceContext(account.id,randomUUID()),{status:404,code:'NOT_FOUND'})
    f.accounts.get(account.id).storyStorage.allowed=false
    await assert.rejects(f.store.sourceContext(account.id,sent.message.id),{status:403,code:'FORBIDDEN'})
    f.accounts.get(account.id).storyStorage.allowed=true
    f.people.delete(account.person.id)
    await assert.rejects(f.store.sourceContext(account.id,sent.message.id),{status:404,code:'NOT_FOUND'})
    f.people.set(account.person.id,account.person)
    await f.store.removeMessage(account.id,conversation.id,sent.message.id,randomUUID(),1,randomUUID())
    await assert.rejects(f.store.sourceContext(account.id,sent.message.id),{status:404,code:'NOT_FOUND'})
  })
})

test('the memory internal HTTP adapter bounds its request and rejects invalid or unavailable context',async t=>{
  const accountId=randomUUID(),personId=randomUUID(),serviceToken='ab'.repeat(32)
  const rows=[memory()]
  let status=200,data={personId,memories:rows}
  const requests=[]
  const server=createServer((request,response)=>{
    requests.push({url:request.url,headers:request.headers})
    response.writeHead(status,{'Content-Type':'application/json'})
    response.end(JSON.stringify({data}))
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())))
  const dependencies=new Dependencies({memoriesOrigin:'http://127.0.0.1:'+server.address().port,serviceToken})
  const query='😀'.repeat(170)
  assert.deepEqual(await dependencies.memories(accountId,personId,query),rows)
  const request=requests[0],url=new URL(request.url,'http://127.0.0.1')
  assert.equal(url.pathname,'/internal/v1/persons/'+personId+'/memories/context')
  assert.equal([...url.searchParams.get('q')].length,160)
  assert.equal(request.headers['x-xijie-account-id'],accountId)
  assert.equal(request.headers.authorization,'Bearer '+serviceToken)
  for(const malformed of [
    {personId:randomUUID(),memories:rows},
    {personId,memories:[rows[0],rows[0]]},
    {personId,memories:[{...rows[0],version:0}]},
    {personId,memories:[{...rows[0],body:'x'.repeat(1201)}]},
    {personId,memories:Array.from({length:9},()=>memory())},
  ]) {
    data=malformed
    await assert.rejects(dependencies.memories(accountId,personId,'test'),{status:503,code:'DEPENDENCY_UNAVAILABLE'})
  }
  status=503
  await assert.rejects(dependencies.memories(accountId,personId,'test'),{status:503,code:'DEPENDENCY_UNAVAILABLE'})
  const before=requests.length
  assert.deepEqual(await new Dependencies({serviceToken}).memories(accountId,personId,'legacy'),[])
  assert.equal(requests.length,before)
})
