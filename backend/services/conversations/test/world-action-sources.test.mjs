import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {test} from 'node:test'
import {fixture,text} from './fixture.mjs'
import {AutomaticSourceStore} from '../dist/automatic-sources.js'
import {virtualWorldUse,worldContextRevision} from '../dist/virtual-world.js'
import {validateWorldActionReferences} from '../../../../deploy/recovery/world-actions.mjs'

const reference=value=>({id:value.message.id,version:value.message.version})
async function setup(t){
 const f=await fixture(t),a=f.account(),c=(await f.store.ensure(a.id,a.person.id,randomUUID())).conversation,sources=new AutomaticSourceStore(f.pool,f.dependencies)
 const person={...a.person,worldVersion:1};f.people.set(person.id,person)
 const core={accountId:a.id,personId:person.id,personVersion:person.version,worldVersion:1,reality:'virtual',branch:'main',currentWorld:{id:person.worldId,code:'courtyard',displayName:'Synthetic courtyard',catalogVersion:1,enabled:true},recentMovements:[]}
 const world={...core,revision:worldContextRevision(core)};f.dependencies.virtualWorld=async()=>structuredClone(world)
 async function complete(item,decision=null,contextRefs=[]){
  const job=await f.store.claim(item.generationJobId);assert(job)
  const body='Synthetic reply '+item.message.text
  const action=decision==='execute'?{requestQuote:item.message.text,summary:'Synthetic virtual event',memory:'Synthetic virtual experience'}:undefined
  const worldAction=decision===null?undefined:{output:{text:body,decision,...(action?{action}:{}),provenance:{model:'synthetic-model',responseId:'synthetic-response',promptVersion:'person-world-actions-v1'}},context:{revision:await f.store.worldActions.revision(job),events:[],refs:contextRefs,memoryUses:[]}}
  assert.equal(await f.store.complete(job,body,person.displayName,[reference(item)],[],virtualWorldUse(world),worldAction),true)
  item.reply=(await f.pool.query("SELECT id,version FROM messages WHERE generation_job_id=$1 AND author_kind='persona'",[job.id])).rows[0]
  if(decision==='execute'){
   const event=(await f.pool.query('SELECT id,version,person_id,world_id,world_version FROM person_world_events WHERE job_id=$1',[job.id])).rows[0]
   item.event={id:event.id,version:event.version,personId:event.person_id,worldId:event.world_id,worldVersion:event.world_version,reality:'virtual',branch:'main'}
  }
  return item
 }
 async function send(label,{decision=null,state='queued',refs=[],finish=false}={}){
  f.accounts.get(a.id).worldActionProcessing={allowed:decision!==null,authorizationVersion:1}
  const result=await f.store.send(a.id,c.id,randomUUID(),text('Synthetic '+label),randomUUID())
  if(finish)return complete(result,decision,refs)
  if(state!=='queued')await f.pool.query(`UPDATE generation_jobs SET state=$2,lease_until=CASE WHEN $2='running' THEN clock_timestamp()+interval '45 seconds' ELSE NULL END,
   attempt_id=CASE WHEN $2='running' THEN gen_random_uuid() ELSE NULL END,retryable=false WHERE id=$1`,[result.generationJobId,state])
  return result
 }
 return{...f,a,c,sources,send,complete}
}

test('automatic events and exact source reads wait for successful chat classification without event lineage',{timeout:60000},async t=>{
 const f=await setup(t),allowed=[],denied=[]
 allowed.push(await f.send('legacy queued'))
 allowed.push(await f.send('legacy failed',{state:'failed'}))
 allowed.push(await f.send('new plain chat',{decision:'chat',finish:true}))
 for(const state of ['queued','running','failed','blocked','canceled'])denied.push(await f.send('undecided '+state,{decision:'pending',state}))
 denied.push(await f.send('clarified',{decision:'clarify',finish:true}))
 const action=await f.send('executed',{decision:'execute',finish:true});denied.push(action)
 denied.push(await f.send('chat with virtual lineage',{decision:'chat',finish:true,refs:[action.event]}))
 const events=await f.sources.events([f.a.id],100)
 assert.deepEqual(events.map(e=>e.sourceId).sort(),allowed.map(v=>v.message.id).sort())
 for(const item of allowed)assert.equal((await f.sources.source(f.a.id,item.message.id)).id,item.message.id)
 for(const item of denied){await assert.rejects(f.sources.source(f.a.id,item.message.id),{status:404});if(item.reply)await assert.rejects(f.sources.source(f.a.id,item.reply.id),{status:404})}
 const allRefs=[...allowed,...denied].flatMap(v=>[reference(v),...(v.reply?[v.reply]:[])])
 assert.deepEqual((await f.sources.validate(f.a.id,f.a.person.id,allRefs)).valid.map(r=>r.id).sort(),allowed.flatMap(v=>[v.message.id,...(v.reply?[v.reply.id]:[])]).sort())
 assert(!JSON.stringify(events).includes('Synthetic'))
})

test('pending acceptance is not acknowledged early and becomes discoverable only after a successful plain chat decision',{timeout:60000},async t=>{
 const f=await setup(t),item=await f.send('pending commit race',{decision:'pending'})
 const accepted=(await f.pool.query("SELECT event_id FROM outbox_events WHERE aggregate_id=$1 AND type='MessageAccepted.v1'",[item.message.id])).rows[0].event_id
 assert.deepEqual(await f.sources.events([f.a.id]),[])
 assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM automatic_memory_event_acks WHERE event_id=$1',[accepted])).rows[0].n,0)
 await f.complete(item,'chat')
 const events=await f.sources.events([f.a.id]);assert.equal(events.length,1);assert.equal(events[0].eventId,accepted)
 await f.sources.ack(accepted);assert.deepEqual(await f.sources.events([f.a.id]),[])
 assert.equal((await f.sources.source(f.a.id,item.message.id)).id,item.message.id)
})

test('automatic context filters before its six-row limit and cannot include executed, clarified or inherited event text',{timeout:60000},async t=>{
 const f=await setup(t),old=await f.send('earlier ordinary',{finish:true});let action
 for(let i=0;i<7;i++){const value=await f.send('excluded virtual '+i,{decision:i%2?'execute':'clarify',finish:true});if(value.event)action=value}
 await f.send('event-dependent plain reply',{decision:'chat',finish:true,refs:[action.event]})
 const anchor=await f.send('ordinary anchor'),future=await f.send('future ordinary')
 const value=await f.sources.source(f.a.id,anchor.message.id)
 assert.deepEqual(value.context.map(r=>r.id),[old.message.id,old.reply.id])
 assert(!value.context.some(r=>r.id===future.message.id));assert(!JSON.stringify(value).includes('excluded virtual'))
 const other=f.account()
 await assert.rejects(f.sources.source(other.id,anchor.message.id),{status:404})
 assert.deepEqual((await f.sources.validate(other.id,other.person.id,[reference(anchor)])).valid,[])
})

test('source removal during a read rejects the captured context instead of returning stale text',{timeout:60000},async t=>{
 const f=await setup(t),older=await f.send('eligible prior',{decision:'chat',finish:true}),anchor=await f.send('current ordinary')
 const original=f.dependencies.account;let reads=0
 f.dependencies.account=async accountId=>{
  if(accountId===f.a.id&&++reads===2)await f.store.removeMessage(f.a.id,f.c.id,older.message.id,randomUUID(),1,randomUUID())
  return original(accountId)
 }
 try{await assert.rejects(f.sources.source(f.a.id,anchor.message.id),{status:404})}finally{f.dependencies.account=original}
 assert.deepEqual((await f.sources.source(f.a.id,anchor.message.id)).context,[])
 assert.deepEqual((await f.sources.validate(f.a.id,f.a.person.id,[reference(older),older.reply])).valid,[])
})

test('plain-classified removal invalidates automatic refs while revoked storage metadata checks keep virtual sources excluded',{timeout:60000},async t=>{
 const f=await setup(t),plain=await f.send('plain classified',{decision:'chat',finish:true}),action=await f.send('virtual executed',{decision:'execute',finish:true})
 for(const e of await f.sources.events([f.a.id]))await f.sources.ack(e.eventId)
 await f.store.removeMessage(f.a.id,f.c.id,plain.message.id,randomUUID(),1,randomUUID())
 const events=await f.sources.events([f.a.id]);assert.equal(events.length,1);assert.equal(events[0].sourceId,plain.message.id);assert.equal(events[0].change,'remove')
 assert.deepEqual((await f.sources.validate(f.a.id,f.a.person.id,[reference(plain),plain.reply])).valid,[])
 f.accounts.get(f.a.id).storyStorage.allowed=false
 assert.deepEqual((await f.sources.validate(f.a.id,f.a.person.id,[reference(action),action.reply])).valid,[])
 assert.deepEqual((await f.sources.validate(f.a.id,f.a.person.id,[])).valid,[])
})

test('message source domain independently blocks malformed classification exposure',{timeout:60000},async t=>{
 const f=await setup(t),plain=await f.send('plain classified',{decision:'chat',finish:true})
 await f.pool.query("UPDATE messages SET source_domain='virtual_context' WHERE id=ANY($1::uuid[])",[[plain.message.id,plain.reply.id]])
 assert.deepEqual(await f.sources.events([f.a.id]),[])
 await assert.rejects(f.sources.source(f.a.id,plain.message.id),{status:404})
 assert.deepEqual((await f.sources.validate(f.a.id,f.a.person.id,[reference(plain),plain.reply])).valid,[])
})

test('recovery projections run against the native schema and reproduce exact Unicode request fingerprints',{timeout:60000},async t=>{
 const f=await setup(t)
 await f.send('中文、emoji 😀、quote "、slash \\、换行\nnext',{decision:'execute',finish:true})
 const person=f.people.get(f.a.person.id),targets=['identity','people','conversations','memories'].map(domain=>({domain}))
 const runtime={query:async(target,sql)=>{
  if(target.domain==='conversations')return(await f.pool.query(sql.replaceAll("table_schema='public'","table_schema='"+f.schema+"'").replaceAll('public.',f.schema+'.'))).rows
  if(target.domain==='identity'){
   if(sql.includes('FROM public.accounts'))return[{id:f.a.id,access_version:1}]
   return[{account_id:f.a.id,purpose:'privacy_notice',authorization_version:1,decision:'acknowledge',recorded_at:'2000-01-01T00:00:00Z'},...['private_story_storage','ai_text_processing','person_world_actions'].map(purpose=>({account_id:f.a.id,purpose,authorization_version:1,decision:'grant',notice_authorization_version:1,recorded_at:'2000-01-01T00:00:00Z',policy_id:randomUUID(),policy_version:1,world_event_history_enabled:false}))]
  }
  if(target.domain==='people'){
   if(sql.includes('FROM public.persons'))return[{id:person.id,account_id:f.a.id,status:person.status,version:person.version,access_version:person.accessVersion,world_id:person.worldId,world_version:person.worldVersion}]
   if(sql.includes('FROM public.worlds'))return[{id:person.worldId,catalog_version:1}]
   return[]
  }
  if(target.domain==='memories')return[]
  throw Error('Unexpected synthetic authority')
 }}
 assert.deepEqual(await validateWorldActionReferences(runtime,targets),{applicable:true,jobCount:1,eventCount:1,removedEventCount:0,replyCount:1,verified:true})
})

