import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {test} from 'node:test'
import {fixture,text} from './fixture.mjs'
import {GenerationEngine} from '../dist/engine.js'
import {Dependencies} from '../dist/dependencies.js'
import {decodeVirtualWorldContext,worldContextRevision,virtualWorldUse} from '../dist/virtual-world.js'
import {exportConversations} from '../dist/data-rights.js'
import {createGenerationProvider} from '../dist/provider.js'

const card=(id,code)=>({id,code,displayName:code==='courtyard'?'日光庭院':'潮汐回廊',catalogVersion:1,enabled:true})
function scene(f,a){
 const worlds=[card(a.person.worldId,'courtyard'),card(randomUUID(),'tide')]
 let person={...a.person,worldVersion:1},moves=[]
 f.people.set(person.id,person)
 const snapshot=()=>{const result={accountId:a.id,personId:person.id,personVersion:person.version,worldVersion:person.worldVersion,reality:'virtual',branch:'main',currentWorld:worlds.find(world=>world.id===person.worldId),recentMovements:moves.slice(0,8)};return structuredClone({...result,revision:worldContextRevision(result)})}
 const move=()=>{const from=worlds.find(world=>world.id===person.worldId),to=worlds.find(world=>world.id!==person.worldId),now=new Date().toISOString();person={...person,worldId:to.id,version:person.version+1,worldVersion:person.worldVersion+1};f.people.set(person.id,person);moves.unshift({id:randomUUID(),worldVersion:person.worldVersion,personVersion:person.version,fromWorld:structuredClone(from),toWorld:structuredClone(to),occurredAt:now,recordedAt:now})}
 f.dependencies.virtualWorld=async()=>snapshot()
 return {worlds,snapshot,move,person:()=>person}
}
const send=async(f,a,cid,body='你现在在哪个虚拟世界？')=>f.store.send(a.id,cid,randomUUID(),text(body),randomUUID())

test('a committed virtual scene reaches the existing chat path and its exact reference survives export',async t=>{
 const f=await fixture(t),a=f.account(),s=scene(f,a),{conversation}=await f.store.ensure(a.id,a.person.id,randomUUID());s.move()
 const before=s.snapshot(),sent=await send(f,a,conversation.id)
 await new GenerationEngine(f.store,{async generate(input){assert.deepEqual(input.virtualWorld,before);assert.equal(input.virtualWorld.reality,'virtual');return {text:'合成场景回复：当前在潮汐回廊。'}}}).run(sent.generationJobId)
 assert.equal((await f.store.getJob(a.id,sent.generationJobId)).state,'succeeded')
 const row=(await f.pool.query('SELECT world_context_ref FROM generation_jobs WHERE id=$1',[sent.generationJobId])).rows[0]
 assert.deepEqual(row.world_context_ref,virtualWorldUse(before))
 const exported=await exportConversations(f.pool,f.dependencies,a.id,'account_data')
 const reply=exported.data.messages.find(row=>row.authorKind==='persona')
 assert.deepEqual(reply.virtualWorld,row.world_context_ref)
 assert.equal((await f.store.ensure(a.id,a.person.id,randomUUID())).conversation.id,conversation.id)
 for(const malformed of [{},{reality:'virtual',branch:'main'},{...row.world_context_ref,accountId:randomUUID()},{...row.world_context_ref,reality:'real'}])await assert.rejects(f.pool.query('UPDATE generation_jobs SET world_context_ref=$2 WHERE id=$1',[sent.generationJobId,malformed]),{code:'23514'})
})

test('moving worlds, an ABA round trip and catalog drift fence stale model output at each boundary',async t=>{
 const f=await fixture(t)
 for(const mode of ['move-in-model','aba-in-model','catalog-in-model','catalog-before-commit','snapshot-mismatch'])await t.test(mode,async()=>{
  const a=f.account(),s=scene(f,a),{conversation}=await f.store.ensure(a.id,a.person.id,randomUUID()),sent=await send(f,a,conversation.id)
  let reads=0,calls=0
  f.dependencies.virtualWorld=async()=>{reads++;const value=s.snapshot();if(mode==='catalog-before-commit'&&reads===3){s.worlds[0].catalogVersion++;return s.snapshot()}if(mode==='snapshot-mismatch')return {...value,personVersion:value.personVersion+1};return value}
  await new GenerationEngine(f.store,{async generate(){calls++;if(mode==='move-in-model')s.move();if(mode==='aba-in-model'){s.move();s.move()}if(mode==='catalog-in-model')s.worlds[0].catalogVersion++;return {text:'不可写回的旧场景合成回复'}}}).run(sent.generationJobId)
  const job=await f.store.getJob(a.id,sent.generationJobId)
  assert.equal(job.state,'blocked');assert.equal(calls,mode==='snapshot-mismatch'?0:1)
  assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM messages WHERE generation_job_id=$1 AND author_kind='persona'",[sent.generationJobId])).rows[0].n,0)
 })
})

test('world changes filter legacy and prior-scene AI from prompts while preserving user messages and displayed history',async t=>{
 const f=await fixture(t),a=f.account(),s=scene(f,a),{conversation}=await f.store.ensure(a.id,a.person.id,randomUUID())
 delete f.dependencies.virtualWorld
 const legacy=await send(f,a,conversation.id)
 await new GenerationEngine(f.store,{async generate(){return {text:'旧版本合成 AI 场景正文'}}}).run(legacy.generationJobId)
 f.dependencies.virtualWorld=async()=>s.snapshot()
 const first=await send(f,a,conversation.id)
 await new GenerationEngine(f.store,{async generate(input){assert(input.messages.some(row=>row.text.includes('旧版本合成')));return {text:'版本一的合成 AI 场景正文'}}}).run(first.generationJobId)
 s.move();s.move()
 const next=await send(f,a,conversation.id)
 await new GenerationEngine(f.store,{async generate(input){assert.equal(input.virtualWorld.worldVersion,3);assert(!input.messages.some(row=>row.author.kind==='persona'));assert(input.messages.some(row=>row.id===legacy.message.id));return {text:'当前主线世界的合成回复'}}}).run(next.generationJobId)
 const history=await f.store.messages(a.id,conversation.id,'older',undefined,100)
 assert(history.some(row=>row.text.includes('旧版本合成'))&&history.some(row=>row.text.includes('版本一的合成')))
})

test('world decoder checks scope, canonical revision and complete history, not JSON key insertion order',async t=>{
 const f=await fixture(t),a=f.account(),s=scene(f,a)
 s.move();s.move();const value=s.snapshot()
 assert.deepEqual(decodeVirtualWorldContext(value,a.id,a.person.id),value)
 const reorder=Object.fromEntries(Object.entries(value).reverse());reorder.currentWorld=Object.fromEntries(Object.entries(value.currentWorld).reverse())
 assert.deepEqual(decodeVirtualWorldContext(reorder,a.id,a.person.id),value)
 for(const mode of ['foreign-account','foreign-person','bad-revision','missing-event','gap','wrong-current','real','other-branch']){
  const malformed=structuredClone(value)
  if(mode==='foreign-account')malformed.accountId=randomUUID()
  if(mode==='foreign-person')malformed.personId=randomUUID()
  if(mode==='bad-revision')malformed.revision='0'.repeat(64)
  if(mode==='missing-event')malformed.recentMovements.pop()
  if(mode==='gap')malformed.recentMovements[1].worldVersion=3
  if(mode==='wrong-current')malformed.currentWorld=s.worlds[1]
  if(mode==='real')malformed.reality='real'
  if(mode==='other-branch')malformed.branch='sibling'
  assert.throws(()=>decodeVirtualWorldContext(malformed,a.id,a.person.id),{code:'DEPENDENCY_UNAVAILABLE'},mode)
 }
})

test('the real People world HTTP adapter rejects unavailable or malformed authority without substituting a scene',async t=>{
 const f=await fixture(t),a=f.account(),s=scene(f,a);let value=s.snapshot(),status=200,redirect=false,calls=0
 const server=createServer((req,res)=>{calls++;assert.equal(req.headers['x-xijie-account-id'],a.id);if(redirect){res.writeHead(302,{Location:'http://example.invalid/'});res.end();return}res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({data:value}))})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 try{
  const dependencies=new Dependencies({peopleOrigin:'http://127.0.0.1:'+server.address().port,serviceToken:'ab'.repeat(32)})
  assert.deepEqual(await dependencies.virtualWorld(a.id,a.person.id),value)
  value={...value,accountId:randomUUID()};await assert.rejects(dependencies.virtualWorld(a.id,a.person.id),{code:'DEPENDENCY_UNAVAILABLE'})
  status=503;await assert.rejects(dependencies.virtualWorld(a.id,a.person.id),{code:'DEPENDENCY_UNAVAILABLE'})
  redirect=true;await assert.rejects(dependencies.virtualWorld(a.id,a.person.id),{code:'DEPENDENCY_UNAVAILABLE'})
  assert.equal(calls,4)
 }finally{await new Promise(resolve=>server.close(resolve))}
})

test('the SDK transmits only the authorized committed virtual scene and exposes no world-action tools',async t=>{
 const names=['NODE_ENV','MODEL_BASE_URL','MODEL_NAME','MODEL_API_KEY','MODEL_EXECUTION_ENABLED','MODEL_ALLOWED_ACCOUNT_IDS'],previous=new Map(names.map(name=>[name,process.env[name]]))
 t.after(()=>{for(const [name,value]of previous)value===undefined?delete process.env[name]:process.env[name]=value})
 const f=await fixture(t),a=f.account(),s=scene(f,a);s.move()
 Object.assign(process.env,{MODEL_EXECUTION_ENABLED:'true',NODE_ENV:'test',MODEL_BASE_URL:'https://api.openai.com/v1',MODEL_NAME:'gpt-6-luna',MODEL_API_KEY:'synthetic-only-key',MODEL_ALLOWED_ACCOUNT_IDS:a.id})
 let calls=0
 const provider=createGenerationProvider({async fetch(_url,options){calls++;const body=JSON.parse(options.body);assert.equal(options.redirect,'error');assert.equal(body.store,false);assert.equal(body.tools,undefined);const prompt=body.messages.map(row=>row.content).join('\n');assert(prompt.includes('"reality":"virtual"')&&prompt.includes('潮汐回廊'));assert(!prompt.includes('synthetic-only-key'));return new Response(JSON.stringify({id:'world-sdk-fixture',object:'chat.completion',created:1,model:body.model,choices:[{index:0,message:{role:'assistant',content:'合成虚拟场景回复'},finish_reason:'stop'}]}),{status:200,headers:{'Content-Type':'application/json'}})}})
 const input={jobId:randomUUID(),attemptId:randomUUID(),accountId:a.id,aiTextProcessing:{allowed:true,authorizationVersion:1},person:s.person(),messages:[{author:{kind:'self'},text:'你现在在哪个世界？'}],virtualWorld:s.snapshot(),signal:new AbortController().signal}
 assert.deepEqual(await provider.generate(input),{text:'合成虚拟场景回复'})
 for(const virtualWorld of [{...input.virtualWorld,accountId:randomUUID()},{...input.virtualWorld,personId:randomUUID()},{...input.virtualWorld,reality:'real'}])await assert.rejects(provider.generate({...input,virtualWorld}),{code:'WORLD_CONTEXT_CHANGED'})
 assert.equal(calls,1)
})
