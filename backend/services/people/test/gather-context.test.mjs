import 'reflect-metadata'
import assert from 'node:assert/strict'
import {randomUUID,randomBytes,createHash} from 'node:crypto'
import {readFile,readdir} from 'node:fs/promises'
import {createServer} from 'node:http'
import {test} from 'node:test'
import pg from 'pg'
import {NestFactory} from '@nestjs/core'
import {PeopleStore} from '../dist/store.js'
import {PeopleModule,PeopleErrors,peopleHeaders} from '../dist/http.js'
import {erasePeople} from '../dist/data-rights.js'

const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}'
async function fixture(t){
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL;assert(connectionString,'Integration database required')
 const schema='gather_context_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString})
 await admin.query('CREATE SCHEMA '+schema)
 const pool=new pg.Pool({connectionString,options:'-c search_path='+schema,application_name:schema}),store=new PeopleStore(pool)
 t.after(async()=>{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()})
 for(const file of(await readdir(new URL('../db/',import.meta.url))).filter(file=>/^\d+_.+\.sql$/.test(file)).sort())await pool.query(await readFile(new URL('../db/'+file,import.meta.url),'utf8'))
 const worlds=await store.worlds(undefined,100)
 async function seed(accountId=randomUUID(),worldId=worlds[0].id){
  const draft=await store.create(accountId,1,randomUUID(),{displayName:'Synthetic resident',story:'Never part of a resident directory',relationship:'friend'})
  const preview=await store.createPreview(accountId,draft.id,1,randomUUID(),draft.version,{worldPreferenceId:worldId,previousPreviewId:null})
  const person=await store.confirm(accountId,draft.id,1,randomUUID(),draft.version,{previewId:preview.id,worldId},randomUUID())
  return {accountId,person}
 }
 async function bulk(accountId,worldId,count){
  await pool.query(`WITH drafts AS (
   INSERT INTO person_drafts(account_id,display_name,relationship,story,authorization_version,created_at,updated_at,expires_at)
   SELECT $1,'Synthetic bounded resident','friend','Private source',1,statement_timestamp(),statement_timestamp(),statement_timestamp()+interval '1 day' FROM generate_series(1,$3::integer) RETURNING account_id,id
  ), previews AS (
   INSERT INTO person_previews(account_id,draft_id,draft_version,authorization_version,suggested_world_id,created_at,expires_at)
   SELECT account_id,id,1,1,$2,statement_timestamp(),statement_timestamp()+interval '1 hour' FROM drafts RETURNING account_id,draft_id,id
  ) INSERT INTO persons(account_id,source_draft_id,source_preview_id,display_name,relationship,story,world_id,created_at,updated_at)
  SELECT account_id,draft_id,id,'Synthetic bounded resident','friend','Private source',$2,statement_timestamp(),statement_timestamp() FROM previews`,[accountId,worldId,count])
 }
 return {pool,admin,store,worlds,seed,bulk,schema}
}

test('gather directory is account/world scoped, metadata only, complete and ordered even with a disabled world',async t=>{
 const f=await fixture(t),a=await f.seed(),b=await f.seed(a.accountId),earlier=await f.seed(a.accountId),foreign=await f.seed(),elsewhere=await f.seed(a.accountId,f.worlds[1].id)
 const at='2026-11-14T01:00:00.000Z'
 await f.pool.query('UPDATE persons SET created_at=$1 WHERE id=ANY($2::uuid[])',[at,[a.person.id,b.person.id]])
 await f.pool.query('UPDATE persons SET created_at=$1 WHERE id=$2',['2026-11-14T00:00:00.000Z',earlier.person.id])
 const data=await f.store.gatherContext(a.accountId,f.worlds[0].id)
 assert.deepEqual(Object.keys(data).sort(),['accountId','residents','revision','world'])
 assert.deepEqual(data.residents.map(row=>row.id),[earlier.person.id,...[a.person.id,b.person.id].sort()])
 assert(data.residents.slice(1).every(row=>row.createdAt===at))
 for(const row of data.residents)assert.deepEqual(Object.keys(row).sort(),['accessVersion','createdAt','displayName','id','version','worldVersion'])
 assert(!JSON.stringify(data).includes(a.person.story))
 assert.deepEqual(data.world,f.worlds[0]);assert(!('worldVersion' in data));assert(!('version' in data.world))
 const {revision,...core}=data
 assert.equal(revision,createHash('sha256').update(canonical(core)).digest('hex'))
 assert.deepEqual(await f.store.gatherContext(a.accountId,f.worlds[0].id),data)
 assert.deepEqual((await f.store.gatherContext(foreign.accountId,f.worlds[0].id)).residents.map(row=>row.id),[foreign.person.id])
 assert.deepEqual((await f.store.gatherContext(a.accountId,f.worlds[1].id)).residents.map(row=>row.id),[elsewhere.person.id])
 assert.deepEqual((await f.store.gatherContext(randomUUID(),f.worlds[0].id)).residents,[])
 await f.pool.query('UPDATE worlds SET enabled=false WHERE id=$1',[f.worlds[0].id])
 const disabled=await f.store.gatherContext(a.accountId,f.worlds[0].id)
 assert.equal(disabled.world.enabled,false);assert.deepEqual(disabled.residents,data.residents);assert.notEqual(disabled.revision,revision)
 await assert.rejects(()=>f.store.gatherContext(a.accountId,randomUUID()),{status:404,code:'NOT_FOUND'})
})

test('resident revision follows per-person changes without inventing a shared world version',async t=>{
 const f=await fixture(t),a=await f.seed(),b=await f.seed(a.accountId),foreign=await f.seed()
 const initial=await f.store.gatherContext(a.accountId,f.worlds[0].id)
 await f.store.updatePerson(foreign.accountId,foreign.person.id,randomUUID(),1,{displayName:'Foreign edit'},randomUUID())
 assert.equal((await f.store.gatherContext(a.accountId,f.worlds[0].id)).revision,initial.revision)
 const edited=await f.store.updatePerson(a.accountId,a.person.id,randomUUID(),1,{displayName:'Updated resident'},randomUUID())
 const afterEdit=await f.store.gatherContext(a.accountId,f.worlds[0].id);assert.notEqual(afterEdit.revision,initial.revision)
 const moved=await f.store.movePerson(a.accountId,a.person.id,randomUUID(),edited.version,f.worlds[1].id,randomUUID())
 const departed=await f.store.gatherContext(a.accountId,f.worlds[0].id);assert.deepEqual(departed.residents.map(row=>row.id),[b.person.id]);assert.notEqual(departed.revision,afterEdit.revision)
 const returned=await f.store.movePerson(a.accountId,a.person.id,randomUUID(),moved.version,f.worlds[0].id,randomUUID())
 const back=await f.store.gatherContext(a.accountId,f.worlds[0].id)
 assert.equal(back.residents.find(row=>row.id===a.person.id).worldVersion,3)
 assert.equal(back.residents.find(row=>row.id===b.person.id).worldVersion,1)
 assert.equal(back.residents.find(row=>row.id===a.person.id).accessVersion,1)
 assert.notEqual(back.revision,initial.revision)
 await f.store.removePerson(a.accountId,a.person.id,randomUUID(),returned.version,randomUUID())
 const removed=await f.store.gatherContext(a.accountId,f.worlds[0].id);assert.deepEqual(removed.residents.map(row=>row.id),[b.person.id]);assert.notEqual(removed.revision,back.revision)
 await erasePeople(f.pool,a.accountId,randomUUID())
 await assert.rejects(()=>f.store.gatherContext(a.accountId,f.worlds[0].id),{status:404,code:'NOT_FOUND'})
})

test('gather directory returns all 1000 residents and fails above the bound instead of truncating',async t=>{
 const f=await fixture(t),accountId=randomUUID(),worldId=f.worlds[0].id
 await f.bulk(accountId,worldId,1000)
 const data=await f.store.gatherContext(accountId,worldId)
 assert.equal(data.residents.length,1000);assert.equal(new Set(data.residents.map(row=>row.id)).size,1000)
 await f.bulk(accountId,worldId,1)
 await assert.rejects(()=>f.store.gatherContext(accountId,worldId),{status:413,code:'HISTORY_TOO_LARGE'})
 assert.deepEqual((await f.store.gatherContext(accountId,f.worlds[1].id)).residents,[])
})

test('world and residents are read from one repeatable-read snapshot during a concurrent move and catalog update',async t=>{
 const f=await fixture(t),a=await f.seed(),initial=await f.store.gatherContext(a.accountId,f.worlds[0].id)
 let changed=false
 const observer=new PeopleStore({connect:async()=>{
  const client=await f.pool.connect()
  return {release:()=>client.release(),query:async(sql,args)=>{
   const result=await client.query(sql,args)
   if(!changed&&sql==='SELECT id,code,display_name,enabled,catalog_version FROM worlds WHERE id=$1'){
    changed=true
    await f.store.movePerson(a.accountId,a.person.id,randomUUID(),1,f.worlds[1].id,randomUUID())
    await f.pool.query('UPDATE worlds SET enabled=false,catalog_version=catalog_version+1 WHERE id=$1',[f.worlds[0].id])
   }
   return result
  }}
 }})
 assert.deepEqual(await observer.gatherContext(a.accountId,f.worlds[0].id),initial)
 const latest=await f.store.gatherContext(a.accountId,f.worlds[0].id)
 assert.deepEqual(latest.residents,[]);assert.equal(latest.world.enabled,false);assert.notEqual(latest.revision,initial.revision)
})

test('gather HTTP reuses only Conversations credentials and rejects account, source and erasure races outside transactions',async t=>{
 const f=await fixture(t),a=await f.seed(),foreign=await f.seed()
 const token=()=>randomBytes(32).toString('hex'),conversationToken=token(),peopleToken=token(),memoryToken=token(),socialToken=token()
 let active=true,accessVersion=1,reads=0,onSecond
 const identity=createServer((req,res)=>{(async()=>{
  assert.equal(req.headers.authorization,'Bearer '+peopleToken)
  const inTransaction=await f.admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND state='idle in transaction'",[f.schema])
  assert.equal(inTransaction.rowCount,0,'Identity HTTP must not hold a source SQL transaction')
  reads++
  if(reads===2&&onSecond)await onSecond()
  res.writeHead(active?200:404,{'Content-Type':'application/json'})
  res.end(JSON.stringify({data:{accountId:req.url.split('/')[4],status:'active',accessVersion}}))
 })().catch(error=>{res.writeHead(500);res.end();throw error})})
 await new Promise(resolve=>identity.listen(0,'127.0.0.1',resolve))
 t.after(()=>{identity.closeAllConnections();return new Promise(resolve=>identity.close(resolve))})
 const config={conversationsServiceToken:conversationToken,memoriesServiceToken:memoryToken,socialServiceToken:socialToken,serviceToken:peopleToken,identityContextUrl:new URL('http://127.0.0.1:'+identity.address().port+'/internal/v1/session-context')}
 const app=await NestFactory.create(PeopleModule.register(config,f.store),{logger:false,abortOnError:false})
 app.use(peopleHeaders);app.useGlobalFilters(new PeopleErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close())
 const origin=await app.getUrl(),path='/internal/v1/worlds/'+f.worlds[0].id+'/gather-context'
 const get=(accountId=a.accountId,credential=conversationToken,suffix='')=>{reads=0;return fetch(origin+path+suffix,{headers:{Authorization:'Bearer '+credential,'X-Xijie-Account-Id':accountId}})}
 for(const credential of [memoryToken,socialToken,peopleToken,'0'.repeat(64),''])assert.equal((await get(a.accountId,credential)).status,403)
 assert.equal((await get('invalid')).status,400)
 assert.equal((await get(a.accountId,conversationToken,'?limit=1')).status,400)
 const own=await get();assert.equal(own.status,200);assert.equal(reads,2);assert.deepEqual((await own.json()).data.residents.map(row=>row.id),[a.person.id])
 assert.deepEqual((await(await get(foreign.accountId)).json()).data.residents.map(row=>row.id),[foreign.person.id])
 assert.deepEqual((await(await get(randomUUID())).json()).data.residents,[])
 active=false;assert.equal((await get()).status,404);active=true
 onSecond=async()=>{active=false};assert.equal((await get()).status,404);active=true;onSecond=undefined
 onSecond=async()=>{accessVersion++};assert.equal((await get()).status,404);onSecond=undefined
 onSecond=async()=>{await f.store.movePerson(a.accountId,a.person.id,randomUUID(),1,f.worlds[1].id,randomUUID())}
 const moved=await get();assert.equal(moved.status,409);assert.equal((await moved.json()).error.code,'SOURCE_CHANGED');onSecond=undefined
 assert.deepEqual((await(await get()).json()).data.residents,[])
 onSecond=async()=>{await erasePeople(f.pool,a.accountId,randomUUID())}
 assert.equal((await get()).status,404);onSecond=undefined
 assert.equal((await get()).status,404)
})
