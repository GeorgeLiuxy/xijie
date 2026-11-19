import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {test} from 'node:test'
import {fixture,text} from './fixture.mjs'
import {GenerationEngine} from '../dist/engine.js'
import {worldContextRevision} from '../dist/virtual-world.js'

test('deleting an event reply while memory retrieval waits prevents the stale event from reaching the provider',{timeout:15000},async t=>{
 const f=await fixture(t),a=f.account()
 f.accounts.get(a.id).worldActionProcessing={allowed:true,authorizationVersion:1}
 const person={...a.person,worldVersion:1};f.people.set(person.id,person)
 const core={accountId:a.id,personId:person.id,personVersion:person.version,worldVersion:1,reality:'virtual',branch:'main',currentWorld:{id:person.worldId,code:'courtyard',displayName:'Synthetic courtyard',catalogVersion:1,enabled:true},recentMovements:[]}
 f.dependencies.virtualWorld=async()=>({...structuredClone(core),revision:worldContextRevision(core)})
 const conversation=(await f.store.ensure(a.id,person.id,randomUUID())).conversation
 const body='现在请你独自在虚拟庭院看一会儿云。',first=await f.store.send(a.id,conversation.id,randomUUID(),text(body),randomUUID())
 const provenance={model:'synthetic-model',responseId:'synthetic-response',promptVersion:'person-world-actions-v1'}
 await new GenerationEngine(f.store,{generate:async()=>({text:'合成测试：在虚拟庭院看了一会儿云。',decision:'execute',action:{requestQuote:body,summary:'在虚拟庭院看云。',memory:'这是当前虚拟世界中一次看云的经历。'},provenance})}).run(first.generationJobId)
 assert.equal((await f.store.findJob(first.generationJobId)).state,'succeeded')
 const event=(await f.pool.query('SELECT id,reply_id FROM person_world_events WHERE job_id=$1',[first.generationJobId])).rows[0]
 const next=await f.store.send(a.id,conversation.id,randomUUID(),text('刚才那段虚拟经历是什么？'),randomUUID())
 let entered,release,captured=false,calls=0
 const waiting=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve)
 const context=f.store.worldActions.context.bind(f.store.worldActions)
 f.store.worldActions.context=async(...args)=>{const value=await context(...args);captured=value.refs.some(ref=>ref.id===event.id);return value}
 f.dependencies.memories=async()=>{entered();await gate;return[]}
 const engine=new GenerationEngine(f.store,{generate:async()=>{calls++;return{text:'This stale private event must not be dispatched.',decision:'chat',provenance}}})
 const run=engine.run(next.generationJobId)
 try{
  await waiting;assert.equal(captured,true)
  await f.store.removeMessage(a.id,conversation.id,event.reply_id,randomUUID(),1,randomUUID())
  assert.equal((await f.pool.query('SELECT removed_at IS NOT NULL AS removed FROM person_world_events WHERE id=$1',[event.id])).rows[0].removed,true)
 }finally{release();await run}
 assert.equal(calls,0)
 const saved=await f.store.findJob(next.generationJobId)
 assert.equal(saved.state,'blocked');assert.equal(saved.failure_code,'WORLD_EVENT_CONTEXT_CHANGED');assert.equal(saved.world_action_decision,'pending');assert.equal(saved.reply_id,null)
 assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM messages WHERE generation_job_id=$1 AND author_kind='persona'",[next.generationJobId])).rows[0].n,0)
 assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM person_world_events WHERE account_id=$1',[a.id])).rows[0].n,1)
})
