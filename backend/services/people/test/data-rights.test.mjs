import 'reflect-metadata'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import pg from 'pg'
import { NestFactory } from '@nestjs/core'
import { PeopleStore } from '../dist/store.js'
import { PeopleModule, PeopleErrors, peopleHeaders } from '../dist/http.js'
import { exportPeople, erasePeople } from '../dist/data-rights.js'

test('people data rights preserve scope, snapshots, full erasure and the late-write fence', async t => {
  const connectionString=process.env.XIJIE_TEST_DATABASE_URL
  assert.ok(connectionString,'Set XIJIE_TEST_DATABASE_URL to an isolated integration database')
  const schema='people_rights_'+randomUUID().replaceAll('-',''), admin=new pg.Pool({connectionString})
  await admin.query('CREATE SCHEMA '+schema)
  const pool=new pg.Pool({connectionString,options:'-c search_path='+schema}), store=new PeopleStore(pool)
  for(const file of (await readdir(new URL('../db/',import.meta.url))).filter(x=>/^\d+_.+\.sql$/.test(x)).sort())await pool.query(await readFile(new URL('../db/'+file,import.meta.url),'utf8'))
  const contexts=new Map(), token=randomBytes(32).toString('hex'), serviceToken=randomBytes(32).toString('hex');let malformed=false
  const identity=createServer((req,res)=>{
    assert.equal(req.headers.authorization,'Bearer '+serviceToken)
    const id=new URL(req.url,'http://localhost').pathname.split('/')[4], data=contexts.get(id)
    res.writeHead(data?200:404,{'Content-Type':'application/json'});res.end(JSON.stringify(malformed?{data:{}}:{data}))
  });identity.listen(0,'127.0.0.1');await once(identity,'listening')
  const config={identityContextUrl:new URL('http://127.0.0.1:'+identity.address().port+'/internal/v1/session-context'),serviceToken,dataRightsServiceToken:token,webOrigin:'http://localhost',sessionCookie:'xijie_dev_session'}
  const app=await NestFactory.create(PeopleModule.register(config,store),{logger:false,abortOnError:false})
  app.use(peopleHeaders);app.useGlobalFilters(new PeopleErrors());await app.listen(0,'127.0.0.1');const origin=await app.getUrl()
  t.after(async()=>{await app.close();identity.closeAllConnections();await new Promise(r=>identity.close(r));await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()})
  const a=randomUUID(),b=randomUUID(),world=(await store.worlds(undefined,1))[0]
  async function person(accountId,name){
    const draft=await store.create(accountId,1,randomUUID(),{displayName:name,relationship:'friend',story:'Synthetic original story',calledMe:'Alex',birthMonthDay:'02-29',place:'Synthetic town'})
    const preview=await store.createPreview(accountId,draft.id,1,randomUUID(),draft.version,{worldPreferenceId:world.id,previousPreviewId:null})
    return store.confirm(accountId,draft.id,1,randomUUID(),draft.version,{previewId:preview.id,worldId:world.id},randomUUID())
  }
  const kept=await person(a,'Kept fixture'),removed=await person(a,'Removed fixture'),other=await person(b,'Other account')
  await store.removePerson(a,removed.id,randomUUID(),removed.version,randomUUID())
  const original=await store.create(a,1,randomUUID(),{displayName:'Unfinished fixture',story:'Unfinished text'})
  const requestId=randomUUID();contexts.set(requestId,{requestId,accountId:a,kind:'export',scope:'interaction_data',status:'processing',accountStatus:'active',accountAccessVersion:1})
  const exportURL=(id=a,request=requestId,scope='interaction_data')=>origin+'/internal/v1/accounts/'+id+'/data-export?requestId='+request+'&scope='+scope
  const auth={Authorization:'Bearer '+token}
  const erase=(accountId,request,key=request)=>fetch(origin+'/internal/v1/accounts/'+accountId+'/erase',{method:'POST',headers:{...auth,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({requestId:request})})
  await t.test('private routes require the independent token, exact request ownership and valid context',async()=>{
    assert.equal((await fetch(exportURL())).status,403)
    assert.equal((await fetch(exportURL(),{headers:{Authorization:'Bearer '+serviceToken}})).status,403)
    assert.equal((await fetch(exportURL(b),{headers:auth})).status,403)
    assert.equal((await fetch(exportURL(a,randomUUID()),{headers:auth})).status,404)
    assert.equal((await fetch(exportURL()+'&scope=account_data',{headers:auth})).status,400)
    malformed=true;assert.equal((await fetch(exportURL(),{headers:auth})).status,503);malformed=false
    assert.equal((await erase(a,requestId)).status,403)
  })
  await t.test('the repeatable domain snapshot is stable, complete and excludes removed records and internal state',async()=>{
    const first=(await (await fetch(exportURL(),{headers:auth})).json()).data
    const second=await exportPeople(pool,a,'interaction_data')
    assert.equal(first.domain,'people');assert.equal(first.schemaVersion,1);assert.equal(first.accountId,a)
    assert.deepEqual(first.data.persons.map(x=>x.id),[kept.id]);assert.ok(first.data.drafts.some(x=>x.id===original.id))
    assert.equal(first.data.persons[0].birthMonthDay,'02-29');assert.equal(first.data.persons[0].calledMe,'Alex')
    assert.equal(first.revision,second.revision)
    assert.equal(first.revision,createHash('sha256').update(JSON.stringify(first.data)).digest('hex'))
    assert.equal(JSON.stringify(first).includes('Removed fixture'),false);assert.equal(JSON.stringify(first).includes(other.id),false)
    for(const field of ['authorization_version','request_hash','idempotency_key','source_preview_id'])assert.equal(JSON.stringify(first).includes(field),false)
    await store.updatePerson(a,kept.id,randomUUID(),kept.version,{story:'Corrected synthetic story'},randomUUID())
    assert.notEqual((await exportPeople(pool,a,'account_data')).revision,first.revision)
  })
  await t.test('an accepted account erasure removes every private table, is idempotent and preserves the other account',async()=>{
    const deletion=randomUUID();contexts.set(deletion,{requestId:deletion,accountId:a,kind:'delete_account',scope:'account_data',status:'processing',accountStatus:'deletion_pending',accountAccessVersion:2})
    assert.equal((await erase(a,deletion,randomUUID())).status,400)
    const response=await erase(a,deletion);assert.equal(response.status,200);const first=(await response.json()).data
    assert.equal(first.alreadyErased,false);assert.equal(first.requestId,deletion)
    const replay=(await (await erase(a,deletion)).json()).data;assert.equal(replay.alreadyErased,true);assert.equal(replay.erasedAt,first.erasedAt)
    for(const table of ['person_drafts','person_previews','persons','person_world_movements','person_draft_commands','outbox_events'])assert.equal((await pool.query('SELECT count(*)::int AS n FROM '+table+' WHERE account_id=$1',[a])).rows[0].n,0,table)
    assert.equal((await store.getPerson(b,other.id)).displayName,'Other account')
    assert.equal((await fetch(exportURL(),{headers:auth})).status,404)
    // Shared writes now reject at the account gate before any resource lock;
    // bypassing that path is still covered by the native trigger test below.
    await assert.rejects(store.create(a,1,randomUUID(),{story:'Must not return'}),{code:'NOT_FOUND'})
    const next=randomUUID();contexts.set(next,{...contexts.get(deletion),requestId:next});assert.equal((await erase(a,next)).status,409)
    const fence=(await pool.query('SELECT * FROM account_erasure_fences WHERE account_id=$1',[a])).rows[0]
    assert.deepEqual(Object.keys(fence).sort(),['account_id','created_at','erased_at','request_id'].sort())
  })
  await t.test('a repeatable-read snapshot opened before erasure cannot insert after the gate changes',async()=>{
    const account=randomUUID();await store.create(account,1,randomUUID(),{story:'Before erasure'})
    const stale=await pool.connect()
    try{
      await stale.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await stale.query('SELECT * FROM account_erasure_fences WHERE account_id=$1',[account])
      await erasePeople(pool,account,randomUUID())
      await assert.rejects(stale.query("INSERT INTO person_drafts(account_id,story,authorization_version,created_at,updated_at,expires_at) VALUES($1,'Stale actor',1,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '1 day')",[account]),error=>['40001','42501'].includes(error.code))
    }finally{await stale.query('ROLLBACK');stale.release()}
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM person_drafts WHERE account_id=$1',[account])).rows[0].n,0)
  })
  await t.test('oversized account data fails explicitly before loading a partial export into Node',async()=>{
    const account=randomUUID()
    await pool.query("INSERT INTO person_drafts(account_id,story,authorization_version,created_at,updated_at,expires_at) SELECT $1,repeat('x',20000),1,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '1 day' FROM generate_series(1,1100)",[account])
    await assert.rejects(exportPeople(pool,account,'account_data'),{status:413,code:'EXPORT_TOO_LARGE'})
  })
  await t.test('erasure waits for an already accepted local writer then removes its result',async()=>{
    const account=randomUUID(),writer=await pool.connect();let completion
    try{
      await writer.query('BEGIN');await writer.query("SELECT pg_advisory_xact_lock(hashtextextended('xijie:people:erasure:' || $1,0))",[account])
      completion=erasePeople(pool,account,randomUUID())
      await writer.query("INSERT INTO person_drafts(account_id,story,authorization_version,created_at,updated_at,expires_at) VALUES($1,'Accepted before gate',1,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '1 day')",[account])
      await writer.query('COMMIT');await completion
    }finally{await writer.query('ROLLBACK');writer.release();if(completion)await completion}
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM person_drafts WHERE account_id=$1',[account])).rows[0].n,0)
  })
})
