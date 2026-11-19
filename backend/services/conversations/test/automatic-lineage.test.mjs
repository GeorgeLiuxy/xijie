import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {test} from 'node:test'
import {fixture,text} from './fixture.mjs'
import {GenerationEngine} from '../dist/engine.js'
import {Dependencies} from '../dist/dependencies.js'

test('indirect AI retellings retain automatic provenance and stop entering new prompts after their source is removed',async t=>{
 const f=await fixture(t),a=f.account(),{conversation}=await f.store.ensure(a.id,a.person.id,randomUUID())
 const knowledge={id:randomUUID(),version:1,body:'合成固定安排',topic:'安排',timeDescription:'',evidence:'合成',sourceKind:'message',sourceId:randomUUID(),sourceVersion:1,sourceAuthor:'self',reality:'user_reported',sourceCreatedAt:new Date().toISOString(),sources:[]}
 let selected=[knowledge],valid=true
 f.dependencies.automaticMemories=async()=>structuredClone(selected)
 f.dependencies.validateAutomaticMemories=async(_a,_p,refs)=>refs.every(ref=>valid&&ref.id===knowledge.id&&ref.version===knowledge.version)
 const send=body=>f.store.send(a.id,conversation.id,randomUUID(),text(body),randomUUID())
 const first=await send('第一条合成原始资料')
 await new GenerationEngine(f.store,{async generate(){return {text:'合成 AI A：从有效长期线索接续。'}}}).run(first.generationJobId)
 selected=[]
 const second=await send('继续刚才的话题。')
 await new GenerationEngine(f.store,{async generate(input){assert(input.messages.some(row=>row.text.includes('合成 AI A')));return {text:'合成 AI B：通过近期 A 的内容继续。'}}}).run(second.generationJobId)
 const row=(await f.pool.query('SELECT memory_context_refs FROM generation_jobs WHERE id=$1',[second.generationJobId])).rows[0]
 assert(row.memory_context_refs.some(ref=>ref.kind==='automatic'&&ref.id===knowledge.id))
 await f.store.removeMessage(a.id,conversation.id,first.message.id,randomUUID(),1,randomUUID());valid=false
 const third=await send('还有依据吗？')
 await new GenerationEngine(f.store,{async generate(input){
  assert(!input.messages.some(row=>row.id===first.message.id||row.text.includes('合成 AI A')||row.text.includes('合成 AI B')))
  assert(input.messages.some(row=>row.id===second.message.id));assert(input.messages.some(row=>row.id===third.message.id))
  return {text:'合成回复：不再使用失效资料。'}
 }}).run(third.generationJobId)
 assert.equal((await f.store.getJob(a.id,third.generationJobId)).state,'succeeded')
 const history=await f.store.messages(a.id,conversation.id,'older',undefined,100)
 assert(history.some(row=>row.text.includes('合成 AI A'))&&history.some(row=>row.text.includes('合成 AI B')),'History remains independently readable')
})

test('withdrawal during an inherited-only reply blocks the late result even when direct retrieval is empty',async t=>{
 const f=await fixture(t),a=f.account(),{conversation}=await f.store.ensure(a.id,a.person.id,randomUUID()),ref={id:randomUUID(),version:1}
 let selected=[{...ref,body:'合成条目',topic:'主题',timeDescription:'',evidence:'合成',sourceKind:'message',sourceId:randomUUID(),sourceVersion:1,sourceAuthor:'self',reality:'user_reported',sourceCreatedAt:new Date().toISOString(),sources:[]}],valid=true
 f.dependencies.automaticMemories=async()=>selected
 f.dependencies.validateAutomaticMemories=async()=>valid
 const first=await f.store.send(a.id,conversation.id,randomUUID(),text('合成资料'),randomUUID())
 await new GenerationEngine(f.store,{async generate(){return {text:'合成 AI A'}}}).run(first.generationJobId)
 selected=[]
 const second=await f.store.send(a.id,conversation.id,randomUUID(),text('请继续'),randomUUID())
 await new GenerationEngine(f.store,{async generate(){valid=false;return {text:'这条迟到的合成回复不能保存'}}}).run(second.generationJobId)
 assert.equal((await f.store.getJob(a.id,second.generationJobId)).state,'blocked')
 assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM messages WHERE generation_job_id=$1 AND author_kind='persona'",[second.generationJobId])).rows[0].n,0)
})

test('inherited reference verification keeps every private HTTP batch within eight entries',async()=>{
 const accountId=randomUUID(),personId=randomUUID(),refs=Array.from({length:25},()=>({id:randomUUID(),version:1})),batches=[]
 const server=createServer(async(req,res)=>{
  let content='';for await(const chunk of req)content+=chunk
  const body=JSON.parse(content);assert.equal(req.headers['x-xijie-account-id'],accountId);assert(body.refs.length<=8)
  batches.push(body.refs);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:{personId,valid:true}}))
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 try{
  const deps=new Dependencies({memoriesOrigin:'http://127.0.0.1:'+server.address().port,serviceToken:'ab'.repeat(32)})
  assert.equal(await deps.validateAutomaticMemories(accountId,personId,refs),true)
  assert.deepEqual(batches.map(batch=>batch.length),[8,8,8,1]);assert.deepEqual(batches.flat(),refs)
 }finally{await new Promise(resolve=>server.close(resolve))}
})
