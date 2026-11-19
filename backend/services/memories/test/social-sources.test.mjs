import 'reflect-metadata'
import assert from 'node:assert/strict'
import {createHash,randomUUID} from 'node:crypto'
import {test} from 'node:test'
import {NestFactory} from '@nestjs/core'
import {fixture,input} from './fixture.mjs'
import {SocialMemorySources,socialEventQuery,socialSourceVersions,socialRefs} from '../dist/social-sources.js'
import {MemoryDataRights} from '../dist/data-rights.js'
import {MemoriesModule,MemoryErrors,memoryHeaders} from '../dist/http.js'
import {MemoryError} from '../dist/contracts.js'

const permit=(f,a,version=2)=>{const account=f.accounts.get(a.id);account.storyStorage.privateFeedAllowed=true;account.aiTextProcessing={allowed:true,authorizationVersion:version,privateFeedProcessingAllowed:true};return account}
function rights(f,a,kind='delete_account'){
 const requestId=randomUUID();f.dependencies.dataRequest=async id=>{assert.equal(id,requestId);return {requestId,accountId:a.id,kind,scope:'account_data',status:'processing',accountStatus:kind==='export'?'active':'deletion_pending',accountAccessVersion:kind==='export'?1:2}}
 return {requestId,service:new MemoryDataRights(f.pool,f.dependencies)}
}

test('only a newly confirmed or revised original captures the current explicit AI feed purpose',async t=>{
 const f=await fixture(t),a=f.account(),sources=new SocialMemorySources(f.store)
 const old=await f.store.create(a.id,a.person.id,randomUUID(),input('Synthetic old original without AI feed scope'))
 let events=await sources.events([a.id]);assert.equal(events[0].echoAiAuthorizationVersion,0)
 await f.pool.query("UPDATE outbox_events SET payload=payload-'echoAiAuthorizationVersion' WHERE aggregate_id=$1",[old.id]);assert.equal((await sources.events([a.id]))[0].echoAiAuthorizationVersion,0)
 permit(f,a);await assert.rejects(sources.context(a.id,a.person.id,old.id,1,2),{code:'AI_PERMISSION_REQUIRED'})
 const current=await f.store.create(a.id,a.person.id,randomUUID(),input('Synthetic explicitly scoped original'))
 events=await sources.events([a.id]);const created=events.find(event=>event.memoryId===current.id);assert.equal(created.echoAiAuthorizationVersion,2);assert.equal(created.sourceVersion,1)
 const body=await sources.context(a.id,a.person.id,current.id,1,2);assert.equal(body.body,current.body);assert.equal(body.origin,'manual');assert.deepEqual(Object.keys(body).sort(),['accountId','body','confirmedAt','id','origin','personId','title','updatedAt','version'])
 assert(!JSON.stringify(events).includes(current.body));assert(!JSON.stringify(events).includes(current.title))
 const grant=permit(f,a,4)
 assert.equal((await sources.context(a.id,a.person.id,current.id,1,4)).id,current.id,'A new manual comment may use the current grant with a legitimate old echo source')
 await assert.rejects(sources.context(a.id,a.person.id,current.id,1,2),{code:'AI_PERMISSION_REQUIRED'})
 grant.aiTextProcessing.allowed=false
 assert.deepEqual((await sources.validate(a.id,a.person.id,[{id:current.id,version:1}])).valid,[{id:current.id,version:1}])
 await assert.rejects(sources.context(a.id,a.person.id,current.id,1,4),{code:'AI_PERMISSION_REQUIRED'})
 grant.storyStorage.allowed=false;assert.equal((await sources.validate(a.id,a.person.id,[{id:current.id,version:1}])).valid.length,1)
 grant.storyStorage.allowed=true
 const edited=await f.store.patch(a.id,a.person.id,current.id,randomUUID(),1,{body:'Synthetic revision while AI feed purpose is withdrawn'})
 assert.equal((await sources.events([a.id])).find(event=>event.memoryId===current.id&&event.sourceVersion===2).echoAiAuthorizationVersion,0)
 permit(f,a,6);await assert.rejects(sources.context(a.id,a.person.id,current.id,2,6),{code:'AI_PERMISSION_REQUIRED'})
 await assert.rejects(sources.context(a.id,a.person.id,current.id,1,6),{code:'SOURCE_CHANGED'})
 const latest=await f.store.patch(a.id,a.person.id,current.id,randomUUID(),edited.version,{body:'Synthetic new explicit revision'})
 assert.equal((await sources.context(a.id,a.person.id,current.id,latest.version,6)).body,latest.body)
 assert.deepEqual((await sources.validate(a.id,a.person.id,[{id:current.id,version:1}])).valid,[])
 f.accounts.get(a.id).aiTextProcessing.privateFeedProcessingAllowed=false
 await assert.rejects(sources.context(a.id,a.person.id,current.id,latest.version,6),{code:'AI_PERMISSION_REQUIRED'})
 const unscoped=await f.store.create(a.id,a.person.id,randomUUID(),input());assert.equal((await sources.events([a.id])).find(event=>event.memoryId===unscoped.id).echoAiAuthorizationVersion,0)
 delete f.accounts.get(a.id).aiTextProcessing.privateFeedProcessingAllowed
 await assert.rejects(sources.context(a.id,a.person.id,current.id,latest.version,6),{code:'AI_PERMISSION_REQUIRED'})
 const missing=await f.store.create(a.id,a.person.id,randomUUID(),input());assert.equal((await sources.events([a.id])).find(event=>event.memoryId===missing.id).echoAiAuthorizationVersion,0)
})

test('confirmed originals stay independent from removed chat provenance, and update/removal revoke exact metadata references',async t=>{
 const f=await fixture(t),a=f.account(),b=f.account();permit(f,a)
 const chat=f.source(a),memory=await f.store.create(a.id,a.person.id,randomUUID(),{...input(),sourceMessageId:chat.id,sourceMessageVersion:chat.version}),sources=new SocialMemorySources(f.store)
 f.sources.clear();f.dependencies.source=async()=>{throw new MemoryError(503,'DEPENDENCY_UNAVAILABLE','Synthetic unavailable optional conversation source')}
 assert.equal((await sources.context(a.id,a.person.id,memory.id,1,2)).body,memory.body)
 await assert.rejects(sources.context(b.id,b.person.id,memory.id,1,2),e=>[403,404].includes(e.status))
 const updated=await f.store.patch(a.id,a.person.id,memory.id,randomUUID(),1,{title:'Synthetic updated title'})
 assert.deepEqual((await sources.validate(a.id,a.person.id,[{id:memory.id,version:1}])).valid,[])
 assert.equal((await sources.validate(a.id,a.person.id,[{id:memory.id,version:updated.version}])).valid.length,1)
 const originalAccount=f.dependencies.account;let reads=0
 f.dependencies.account=async id=>{const value=await originalAccount(id);if(++reads===2)value.aiTextProcessing.allowed=false;return value}
 await assert.rejects(sources.context(a.id,a.person.id,memory.id,updated.version,2),{code:'AI_PERMISSION_REQUIRED'});f.dependencies.account=originalAccount
 await f.store.remove(a.id,a.person.id,memory.id,randomUUID(),updated.version)
 const removed=(await sources.events([a.id])).find(event=>event.change==='remove');assert.equal(removed.echoAiAuthorizationVersion,0)
 assert.deepEqual((await sources.validate(a.id,a.person.id,[{id:memory.id,version:updated.version}])).valid,[])
 await assert.rejects(sources.context(a.id,a.person.id,memory.id,updated.version,2),{code:'NOT_FOUND'})
 f.people.delete(a.person.id);await assert.rejects(sources.validate(a.id,a.person.id,[]),{code:'NOT_FOUND'})
})

test('consumer-local receipt polling never skips a late committed older event and repeated acknowledgement does not touch originals',async t=>{
 const f=await fixture(t),a=f.account(),b=f.account();permit(f,a);permit(f,b)
 const first=await f.store.create(a.id,a.person.id,randomUUID(),input()),sources=new SocialMemorySources(f.store)
 for(const event of await sources.events([a.id]))await sources.ack(event.eventId)
 const pending=await f.pool.connect(),eventId=randomUUID()
 try{
  await pending.query('BEGIN')
  await pending.query('UPDATE memories SET version=2,updated_at=clock_timestamp() WHERE account_id=$1 AND id=$2',[a.id,first.id])
  await pending.query("INSERT INTO outbox_events(event_id,type,account_id,aggregate_type,aggregate_id,aggregate_version,occurred_at,request_id,payload) VALUES($1,'MemoryUpdated.v1',$2,'memory',$3,2,clock_timestamp()-interval '1 hour',$4,$5)",[eventId,a.id,first.id,randomUUID(),{personId:a.person.id,memoryId:first.id,version:2,echoAiAuthorizationVersion:2}])
  await f.store.create(b.id,b.person.id,randomUUID(),input())
  const visible=await sources.events([a.id,b.id]);assert(visible.length);assert(visible.every(event=>event.accountId===b.id));for(const event of visible)await sources.ack(event.eventId)
  await pending.query('COMMIT')
 }finally{await pending.query('ROLLBACK');pending.release()}
 const late=await sources.events([a.id,b.id]);assert.equal(late.length,1);assert.equal(late[0].eventId,eventId)
 const before=(await f.pool.query('SELECT count(*)::int n FROM memories')).rows[0].n
 assert.deepEqual(await sources.ack(eventId),{eventId});assert.deepEqual(await sources.ack(eventId),{eventId});assert.deepEqual(await sources.events([a.id,b.id]),[])
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM social_memory_event_acks WHERE event_id=$1',[eventId])).rows[0].n,1);assert.equal((await f.pool.query('SELECT count(*)::int n FROM memories')).rows[0].n,before)
 assert.equal((await f.pool.query('SELECT last_confirmed_seq FROM memory_account_cursors WHERE account_id=$1',[a.id])).rows[0].last_confirmed_seq,'1')
})

test('acknowledgements enter rights export and cascade on erasure; stale readers and acknowledgements cannot restore erased data',async t=>{
 const f=await fixture(t),a=f.account();permit(f,a);const memory=await f.store.create(a.id,a.person.id,randomUUID(),input()),sources=new SocialMemorySources(f.store),event=(await sources.events([a.id]))[0]
 await sources.ack(event.eventId)
 const exporter=rights(f,a,'export'),exported=await exporter.service.export(a.id,exporter.requestId,'account_data')
 assert.equal(exported.data.socialSourceAcknowledgements.length,1);assert.equal(exported.data.socialSourceAcknowledgements[0].eventId,event.eventId);assert.equal(exported.revision,createHash('sha256').update(JSON.stringify(exported.data)).digest('hex'))
 const eraser=rights(f,a),db=await f.pool.connect()
 try{
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await db.query('SELECT * FROM memory_account_write_gates WHERE account_id=$1',[a.id])
  await eraser.service.erase(a.id,eraser.requestId)
  await assert.rejects(db.query('INSERT INTO social_memory_event_acks(event_id,account_id) VALUES($1,$2) ON CONFLICT(event_id) DO UPDATE SET acknowledged_at=clock_timestamp()',[event.eventId,a.id]),error=>['40001','42501'].includes(error.code))
 }finally{await db.query('ROLLBACK');db.release()}
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM social_memory_event_acks WHERE account_id=$1',[a.id])).rows[0].n,0)
 await assert.rejects(sources.ack(event.eventId),{code:'NOT_FOUND'});await assert.rejects(sources.context(a.id,a.person.id,memory.id,1,2),{code:'NOT_FOUND'});await assert.rejects(sources.validate(a.id,a.person.id,[]),{code:'NOT_FOUND'})
 assert.deepEqual(await sources.events([a.id]),[])
})

test('Social internal HTTP uses its independent role, exact query contracts and metadata-only validation after withdrawal',async t=>{
 const f=await fixture(t),a=f.account();permit(f,a);const memory=await f.store.create(a.id,a.person.id,randomUUID(),input()),socialToken='ab'.repeat(32),conversationToken='bc'.repeat(32),rightsToken='cd'.repeat(32)
 const config={serviceToken:'de'.repeat(32),socialToken,conversationsToken:conversationToken,dataRightsToken:rightsToken,webOrigin:'http://localhost:5184',queueSchema:'memory_queue'}
 const app=await NestFactory.create(MemoriesModule.register(config,f.store),{logger:false,abortOnError:false});app.use(memoryHeaders);app.useGlobalFilters(new MemoryErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close());const origin=await app.getUrl(),headers={Authorization:'Bearer '+socialToken,'X-Xijie-Account-Id':a.id,'Content-Type':'application/json'}
 const base='/internal/v1/social/persons/'+a.person.id+'/memories',source=base+'/'+memory.id+'/context?expectedVersion=1&expectedAiVersion=2',events='/internal/v1/social/memory-events?accountIds='+a.id
 const read=await fetch(origin+source,{headers});assert.equal(read.status,200);assert.equal((await read.json()).data.body,memory.body)
 for(const token of [undefined,conversationToken,rightsToken,'0'.repeat(64)])assert.equal((await fetch(origin+source,{headers:{...headers,Authorization:token?'Bearer '+token:''}})).status,403)
 assert.equal((await fetch(origin+'/internal/v1/persons/'+a.person.id+'/memories/context',{headers})).status,403)
 assert.equal((await fetch(origin+'/internal/v1/persons/'+a.person.id+'/automatic-memories/context',{headers})).status,403)
 const list=await fetch(origin+events,{headers});assert.equal(list.status,200);const event=(await list.json()).data[0];assert.equal(event.echoAiAuthorizationVersion,2)
 for(const suffix of ['','?expectedVersion=0&expectedAiVersion=2','?expectedVersion=1&expectedAiVersion=2&body=extra'])assert.equal((await fetch(origin+base+'/'+memory.id+'/context'+suffix,{headers})).status,400)
 f.accounts.get(a.id).aiTextProcessing.allowed=false;f.accounts.get(a.id).storyStorage.allowed=false
 const validation=await fetch(origin+base+'/validate',{method:'POST',headers,body:JSON.stringify({refs:[{id:memory.id,version:1}]})});assert.equal(validation.status,200);assert.deepEqual((await validation.json()).data,{personId:a.person.id,valid:[{id:memory.id,version:1}]})
 assert.equal((await fetch(origin+source,{headers})).status,403)
 assert.equal((await fetch(origin+'/internal/v1/social/memory-events/'+event.eventId+'/ack',{method:'POST',headers,body:'{}'})).status,200)
 assert.equal((await fetch(origin+'/internal/v1/social/memory-events/'+event.eventId+'/ack',{method:'POST',headers,body:'{"extra":true}'})).status,400)
 config.socialToken=null;assert.equal((await fetch(origin+events,{headers})).status,404)
 for(const query of [{},{accountIds:a.id+','+a.id},{accountIds:a.id,after:'x'},{accountIds:a.id,limit:'101'}])assert.throws(()=>socialEventQuery(query),{code:'INVALID_ARGUMENT'})
 assert.throws(()=>socialSourceVersions({expectedVersion:'1',expectedAiVersion:'0'}),{code:'INVALID_ARGUMENT'});assert.throws(()=>socialRefs({refs:Array.from({length:65},()=>({id:randomUUID(),version:1}))}),{code:'INVALID_ARGUMENT'});assert.throws(()=>socialRefs({refs:[{id:memory.id,version:1},{id:memory.id,version:1}]}),{code:'INVALID_ARGUMENT'})
})
