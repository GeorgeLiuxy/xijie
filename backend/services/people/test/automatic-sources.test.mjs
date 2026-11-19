import 'reflect-metadata'
import assert from 'node:assert/strict'
import {randomBytes,randomUUID} from 'node:crypto'
import {readFile,readdir} from 'node:fs/promises'
import {test} from 'node:test'
import pg from 'pg'
import {NestFactory} from '@nestjs/core'
import {AutomaticSourceStore,automaticEventQuery} from '../dist/automatic-sources.js'
import {PeopleStore} from '../dist/store.js'
import {PeopleModule,PeopleErrors,peopleHeaders} from '../dist/http.js'
import {erasePeople} from '../dist/data-rights.js'

test('automatic profile source query requires an explicit bounded account set',()=>{
 const id=randomUUID()
 assert.deepEqual(automaticEventQuery({accountIds:id}),{accountIds:[id],limit:50})
 for(const input of [{},{accountIds:''},{accountIds:id+','+id},{accountIds:Array.from({length:101},()=>randomUUID()).join(',')},{accountIds:id,limit:'101'},{accountIds:id,after:'2026-01-01'}])assert.throws(()=>automaticEventQuery(input),{code:'INVALID_ARGUMENT'})
})

test('profile committed events have consumer-local acknowledgements and survive commit-order races',{timeout:60000},async t=>{
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL
 assert.ok(connectionString,'Set XIJIE_TEST_DATABASE_URL to an isolated integration database')
 const schema='profile_sources_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString})
 await admin.query('CREATE SCHEMA '+schema)
 const pool=new pg.Pool({connectionString,options:'-c search_path='+schema}),store=new PeopleStore(pool),sources=new AutomaticSourceStore(pool)
 t.after(async()=>{await pool.end();try{await admin.query('DROP SCHEMA '+schema+' CASCADE')}finally{await admin.end()}})
 for(const filename of (await readdir(new URL('../db/',import.meta.url))).filter(name=>/^\d+_.+\.sql$/.test(name)).sort())await pool.query(await readFile(new URL('../db/'+filename,import.meta.url),'utf8'))
 const a=randomUUID(),b=randomUUID(),world=(await store.worlds(undefined,1))[0]
 async function person(accountId){
  const draft=await store.create(accountId,1,randomUUID(),{displayName:'Synthetic profile',relationship:'friend',story:'Synthetic private profile source text'})
  const preview=await store.createPreview(accountId,draft.id,1,randomUUID(),draft.version,{worldPreferenceId:world.id,previousPreviewId:null})
  return store.confirm(accountId,draft.id,1,randomUUID(),draft.version,{previewId:preview.id,worldId:world.id},randomUUID())
 }
 const pa=await person(a),pb=await person(b)
 await t.test('confirmation and correction publish only metadata and never depend on a treasured-memory action',async()=>{
  const confirmed=(await sources.events([a],1))[0]
  assert.equal(confirmed.personId,pa.id);assert.equal(confirmed.sourceId,pa.id);assert.equal(confirmed.sourceKind,'profile')
  assert.equal(confirmed.change,'upsert');assert.equal(confirmed.sourceVersion,1)
  assert.equal(JSON.stringify(confirmed).includes('Synthetic private'),false)
  await assert.rejects(pool.query('INSERT INTO automatic_memory_event_acks(event_id,account_id) VALUES($1,$2)',[confirmed.eventId,b]),{code:'23503'})
  await sources.ack(confirmed.eventId);await sources.ack(confirmed.eventId)
  assert.deepEqual(await sources.events([a]),[])
  await store.updatePerson(a,pa.id,randomUUID(),1,{story:'Synthetic corrected story'},randomUUID())
  const update=(await sources.events([a]))[0]
  assert.equal(update.sourceVersion,2);assert.equal(update.change,'upsert');assert.equal(update.sourceId,pa.id)
  assert.equal((await sources.events([b]))[0].sourceId,pb.id)
 })
 await t.test('late commit with an older event time is not skipped after a later event is acknowledged',async()=>{
  const pending=await pool.connect(),eventId=randomUUID()
  try{
   await pending.query('BEGIN')
   await pending.query("INSERT INTO outbox_events(event_id,type,schema_version,account_id,aggregate_type,aggregate_id,aggregate_version,occurred_at,request_id,payload) VALUES($1,'PersonUpdated.v1',1,$2,'person',$3,3,clock_timestamp()-interval '1 day',$4,'{}')",[eventId,a,pa.id,randomUUID()])
   assert.equal((await sources.events([a])).some(event=>event.eventId===eventId),false)
   for(const event of await sources.events([b]))await sources.ack(event.eventId)
   await pending.query('COMMIT')
   assert.equal((await sources.events([a])).some(event=>event.eventId===eventId),true)
  }finally{await pending.query('ROLLBACK');pending.release()}
 })
 await t.test('access revocation remains deliverable after the original profile is no longer readable',async()=>{
  await store.removePerson(a,pa.id,randomUUID(),2,randomUUID())
  await assert.rejects(store.personContext(a,pa.id),{status:404})
  const removal=(await sources.events([a])).find(event=>event.change==='remove')
  assert.equal(removal.sourceId,pa.id);assert.equal(removal.sourceVersion,3)
  await sources.ack(removal.eventId)
 })
 await t.test('only Memories may use the automatic consumer; other trusted service tokens are insufficient',async()=>{
  const memoryToken=randomBytes(32).toString('hex'),chatToken=randomBytes(32).toString('hex')
  const config={memoriesServiceToken:memoryToken,conversationsServiceToken:chatToken,serviceToken:randomBytes(32).toString('hex')}
  const app=await NestFactory.create(PeopleModule.register(config,store),{logger:false,abortOnError:false})
  app.use(peopleHeaders);app.useGlobalFilters(new PeopleErrors());await app.listen(0,'127.0.0.1')
  try{
   const origin=await app.getUrl(),url=origin+'/internal/v1/automatic-memory/events?accountIds='+a
   assert.equal((await fetch(url)).status,403)
   assert.equal((await fetch(url,{headers:{Authorization:'Bearer '+chatToken}})).status,403)
   assert.equal((await fetch(url,{headers:{Authorization:'Bearer '+memoryToken}})).status,200)
   const event=(await sources.events([a]))[0]
   const ack=()=>fetch(origin+'/internal/v1/automatic-memory/events/'+event.eventId+'/ack',{method:'POST',headers:{Authorization:'Bearer '+memoryToken,'Content-Type':'application/json'},body:'{}'})
   assert.equal((await ack()).status,200);assert.equal((await ack()).status,200)
   assert.equal((await fetch(origin+'/internal/v1/automatic-memory/events',{headers:{Authorization:'Bearer '+memoryToken}})).status,400)
  }finally{await app.close()}
 })
 await t.test('erasure cascades acknowledgements and a late acknowledgement cannot recreate an erased account record',async()=>{
  const events=await sources.events([a]);assert.ok(events.length)
  await sources.ack(events[0].eventId)
  await erasePeople(pool,a,randomUUID())
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM automatic_memory_event_acks WHERE account_id=$1',[a])).rows[0].n,0)
  assert.deepEqual(await sources.events([a]),[])
  await assert.rejects(sources.ack(events[0].eventId),{status:404})
  assert.equal((await store.getPerson(b,pb.id)).id,pb.id)
 })
})
