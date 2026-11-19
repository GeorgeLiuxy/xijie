import 'reflect-metadata'
import assert from 'node:assert/strict'
import {randomUUID,randomBytes} from 'node:crypto'
import {test} from 'node:test'
import {NestFactory} from '@nestjs/core'
import {fixture,text} from './fixture.mjs'
import {AutomaticSourceStore,automaticEventQuery,automaticReferences} from '../dist/automatic-sources.js'
import {ConversationErrors,ConversationsModule,conversationHeaders} from '../dist/http.js'
import {eraseConversations} from '../dist/data-rights.js'

test('automatic source request boundaries reject broad scans, duplicate IDs and malformed versions',()=>{
 const id=randomUUID()
 assert.deepEqual(automaticEventQuery({accountIds:id}),{accountIds:[id],limit:50})
 assert.deepEqual(automaticReferences({personId:id,refs:[]}),{personId:id,refs:[]})
 for(const query of [{},{accountIds:''},{accountIds:id+','+id},{accountIds:id,limit:'0'},{accountIds:id,limit:'101'},{accountIds:id,cursor:'time'}])assert.throws(()=>automaticEventQuery(query),{code:'INVALID_ARGUMENT'})
 for(const refs of [[{id,version:0}],[{id,version:1.5}],[{id,version:1,accountId:id}],[{id,version:1},{id,version:2}],Array.from({length:65},()=>({id:randomUUID(),version:1}))])assert.throws(()=>automaticReferences({personId:id,refs}),{code:'INVALID_ARGUMENT'})
})

test('automatic chat sources deliver exact committed events and validate original provenance without treasured memories',{timeout:60000},async t=>{
 const f=await fixture(t),sources=new AutomaticSourceStore(f.pool,f.dependencies),a=f.account(),b=f.account()
 const ca=(await f.store.ensure(a.id,a.person.id,randomUUID())).conversation
 const cb=(await f.store.ensure(b.id,b.person.id,randomUUID())).conversation
 const send=(account,conversation,value)=>f.store.send(account.id,conversation.id,randomUUID(),text(value),randomUUID())
 const first=await send(a,ca,'Synthetic input with no treasured-memory action')
 const other=await send(b,cb,'Synthetic unrelated account input')
 await t.test('events contain source metadata only and acknowledge one consumer without touching other account events',async()=>{
  const before=await sources.events([a.id])
  assert.equal(before.length,1);assert.equal(before[0].sourceId,first.message.id);assert.equal(before[0].personId,a.person.id)
  assert.equal(before[0].sourceKind,'message');assert.equal(before[0].change,'upsert');assert.equal('text' in before[0],false)
  await assert.rejects(f.pool.query('INSERT INTO automatic_memory_event_acks(event_id,account_id) VALUES($1,$2)',[before[0].eventId,b.id]),{code:'23503'})
  assert.deepEqual(await sources.ack(before[0].eventId),{eventId:before[0].eventId})
  assert.deepEqual(await sources.ack(before[0].eventId),{eventId:before[0].eventId})
  assert.deepEqual(await sources.events([a.id]),[])
  assert.equal((await sources.events([b.id]))[0].sourceId,other.message.id)
 })
 await t.test('a committed-late older event remains visible after another account newer event was acknowledged',async()=>{
  const pending=await f.pool.connect(),late=randomUUID()
  try{
   await pending.query('BEGIN')
   await pending.query("INSERT INTO outbox_events(event_id,type,account_id,aggregate_type,aggregate_id,aggregate_version,occurred_at,request_id,payload) VALUES($1,'MessageAccepted.v1',$2,'message',$3,2,clock_timestamp()-interval '1 day',$4,'{}')",[late,a.id,first.message.id,randomUUID()])
   assert.equal((await sources.events([a.id,b.id])).some(event=>event.eventId===late),false)
   for(const event of await sources.events([b.id]))await sources.ack(event.eventId)
   await pending.query('COMMIT')
   assert.equal((await sources.events([a.id,b.id])).some(event=>event.eventId===late),true)
  }finally{await pending.query('ROLLBACK');pending.release()}
 })
 await t.test('current self source keeps the original AI grant and exact bigint sequence; persona text is never a fact source',async()=>{
  await f.pool.query('UPDATE messages SET sequence=$2 WHERE id=$1',[first.message.id,'9007199254740993'])
  await f.pool.query('UPDATE conversations SET last_sequence=$2 WHERE id=$1',[ca.id,'9007199254740993'])
  const raw=await sources.source(a.id,first.message.id)
  assert.equal(raw.sequence,'9007199254740993');assert.equal(raw.aiAuthorizationVersion,1)
  assert.equal(raw.accountId,a.id);assert.equal(raw.personId,a.person.id);assert.deepEqual(raw.context,[])
  await f.pool.query('UPDATE generation_jobs SET ai_authorization_version=0 WHERE id=$1',[first.generationJobId])
  assert.equal((await sources.source(a.id,first.message.id)).aiAuthorizationVersion,0)
  await assert.rejects(sources.source(b.id,first.message.id),{status:404})
  await f.pool.query('UPDATE generation_jobs SET ai_authorization_version=1 WHERE id=$1',[first.generationJobId])
  const running=await f.store.claim(first.generationJobId)
  await f.store.complete(running,'Synthetic AI output for context only',a.person.displayName,await f.store.context(running))
  const reply=(await f.store.messages(a.id,ca.id,'older',undefined,20)).find(message=>message.author.kind==='persona')
  await assert.rejects(sources.source(a.id,reply.id),{status:404})
  assert.equal((await sources.events([a.id])).some(event=>event.sourceId===reply.id&&event.change==='upsert'),false)
  const valid=await sources.validate(a.id,a.person.id,[{id:first.message.id,version:1},{id:reply.id,version:1},{id:other.message.id,version:1}])
  assert.deepEqual(valid.valid,[{id:first.message.id,version:1},{id:reply.id,version:1}])
  await f.store.removeMessage(a.id,ca.id,first.message.id,randomUUID(),1,randomUUID())
  assert.deepEqual((await sources.validate(a.id,a.person.id,[{id:first.message.id,version:1},{id:reply.id,version:1}])).valid,[])
  await assert.rejects(sources.source(a.id,first.message.id),{status:404})
 })
 await t.test('context is bounded to six earlier messages of the same grant and excludes future or removed-origin AI text',async()=>{
  for(let i=0;i<8;i++)await send(a,ca,'Synthetic earlier context '+i)
  const anchor=await send(a,ca,'Synthetic current source')
  const future=await send(a,ca,'Synthetic future message')
  let raw=await sources.source(a.id,anchor.message.id)
  assert.equal(raw.context.length,6);assert.equal(raw.context.some(message=>message.id===future.message.id),false)
  assert.equal(raw.context.some(message=>message.id===first.message.id),false)
  assert.equal(raw.context.some(message=>message.authorKind==='persona'),false)
  await f.pool.query('UPDATE generation_jobs SET ai_authorization_version=2 WHERE source_message_id=$1',[anchor.message.id])
  raw=await sources.source(a.id,anchor.message.id)
  assert.deepEqual(raw.context,[])
  const secondPerson={...a.person,id:randomUUID()};f.people.set(secondPerson.id,secondPerson)
  assert.deepEqual((await sources.validate(a.id,secondPerson.id,[{id:anchor.message.id,version:1}])).valid,[])
  f.accounts.get(a.id).storyStorage.allowed=false
  await assert.rejects(sources.source(a.id,anchor.message.id),{status:403})
  const metadata=await sources.validate(a.id,a.person.id,[{id:anchor.message.id,version:1},{id:anchor.message.id,version:2},{id:first.message.id,version:1},{id:other.message.id,version:1}])
  assert.deepEqual(metadata,{personId:a.person.id,valid:[{id:anchor.message.id,version:1}]})
  assert.equal(JSON.stringify(metadata).includes('Synthetic'),false)
  await assert.rejects(sources.validate(b.id,a.person.id,[{id:anchor.message.id,version:1}]),{status:404})
  assert.deepEqual((await sources.validate(a.id,secondPerson.id,[{id:anchor.message.id,version:1}])).valid,[])
  f.accounts.get(a.id).status='restricted'
  await assert.rejects(sources.validate(a.id,a.person.id,[]),{status:404})
  f.accounts.get(a.id).status='active'
  f.accounts.get(a.id).storyStorage.allowed=true
  const original=f.dependencies.account
  let reads=0
  f.dependencies.account=async id=>{
   const account=await original(id)
   if(id===a.id&&++reads>1)account.storyStorage.allowed=false
   return account
  }
  try{await assert.rejects(sources.source(a.id,anchor.message.id),{status:403})}finally{f.dependencies.account=original}
 })
 await t.test('only the dedicated memory service may poll, read or acknowledge source events',async()=>{
  const token=randomBytes(32).toString('hex'),wrong=randomBytes(32).toString('hex')
  const config={memoriesServiceToken:token,serviceToken:wrong,webOrigin:'http://127.0.0.1:5184',sessionCookie:'xijie_dev_session',queueSchema:f.queueSchema}
  const app=await NestFactory.create(ConversationsModule.register(config,f.store),{logger:false,abortOnError:false})
  app.use(conversationHeaders);app.useGlobalFilters(new ConversationErrors());await app.listen(0,'127.0.0.1')
  try{
   const origin=await app.getUrl(),url=origin+'/internal/v1/automatic-memory/events?accountIds='+a.id
   assert.equal((await fetch(url)).status,403)
   assert.equal((await fetch(url,{headers:{Authorization:'Bearer '+wrong}})).status,403)
   assert.equal((await fetch(url,{headers:{Authorization:'Bearer '+token}})).status,200)
   assert.equal((await fetch(origin+'/internal/v1/automatic-memory/events',{headers:{Authorization:'Bearer '+token}})).status,400)
   const event=(await sources.events([a.id]))[0]
   assert.equal((await fetch(origin+'/internal/v1/automatic-memory/events/'+event.eventId+'/ack',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}'})).status,200)
   assert.equal((await fetch(origin+'/internal/v1/automatic-memory/validate',{method:'POST',headers:{Authorization:'Bearer '+token,'X-Xijie-Account-Id':a.id,'Content-Type':'application/json'},body:JSON.stringify({personId:a.person.id,refs:[]})})).status,200)
   const current=(await f.store.messages(a.id,ca.id,'older',undefined,20)).find(message=>message.author.kind==='self')
   f.accounts.get(a.id).storyStorage.allowed=false
   try{
    const metadata=await fetch(origin+'/internal/v1/automatic-memory/validate',{method:'POST',headers:{Authorization:'Bearer '+token,'X-Xijie-Account-Id':a.id,'Content-Type':'application/json'},body:JSON.stringify({personId:a.person.id,refs:[{id:current.id,version:current.version}]})})
    assert.equal(metadata.status,200)
    assert.deepEqual((await metadata.json()).data,{personId:a.person.id,valid:[{id:current.id,version:current.version}]})
    assert.equal((await fetch(origin+'/internal/v1/automatic-memory/messages/'+current.id,{headers:{Authorization:'Bearer '+token,'X-Xijie-Account-Id':a.id}})).status,403)
   }finally{f.accounts.get(a.id).storyStorage.allowed=true}
  }finally{await app.close()}
 })
 await t.test('account erasure cascades exact acknowledgements and rejects a late consumer acknowledgement',async()=>{
  const event=(await sources.events([a.id]))[0];await sources.ack(event.eventId)
  assert.ok((await f.pool.query('SELECT count(*)::int AS n FROM automatic_memory_event_acks WHERE account_id=$1',[a.id])).rows[0].n>0)
  await eraseConversations(f.pool,f.queueSchema,a.id,randomUUID())
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM automatic_memory_event_acks WHERE account_id=$1',[a.id])).rows[0].n,0)
  await assert.rejects(sources.ack(event.eventId),{status:404})
  await assert.rejects(sources.validate(a.id,a.person.id,[]),{status:404})
  assert.deepEqual(await sources.events([a.id]),[])
  assert.equal((await f.store.messages(b.id,cb.id,'older',undefined,20))[0].id,other.message.id)
 })
})
