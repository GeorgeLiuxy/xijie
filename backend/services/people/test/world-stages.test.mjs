import 'reflect-metadata'
import assert from 'node:assert/strict'
import {randomUUID,randomBytes} from 'node:crypto'
import {readFile,readdir} from 'node:fs/promises'
import {createServer} from 'node:http'
import {test} from 'node:test'
import pg from 'pg'
import {NestFactory} from '@nestjs/core'
import {PeopleStore} from '../dist/store.js'
import {worldStagesInput} from '../dist/contracts.js'
import {PeopleModule,PeopleErrors,peopleHeaders} from '../dist/http.js'
import {erasePeople} from '../dist/data-rights.js'

async function fixture(t){
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL;assert(connectionString,'Integration database required')
 const schema='world_stages_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString})
 await admin.query('CREATE SCHEMA '+schema)
 const pool=new pg.Pool({connectionString,options:'-c search_path='+schema,application_name:schema}),store=new PeopleStore(pool)
 t.after(async()=>{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()})
 for(const file of(await readdir(new URL('../db/',import.meta.url))).filter(file=>/^\d+_.+\.sql$/.test(file)).sort())await pool.query(await readFile(new URL('../db/'+file,import.meta.url),'utf8'))
 const worlds=await store.worlds(undefined,100)
 async function seed(accountId=randomUUID()){
  const draft=await store.create(accountId,1,randomUUID(),{displayName:'Synthetic stage owner',story:'Private profile must never enter stage metadata',relationship:'friend'})
  const preview=await store.createPreview(accountId,draft.id,1,randomUUID(),draft.version,{worldPreferenceId:worlds[0].id,previousPreviewId:null})
  return {accountId,person:await store.confirm(accountId,draft.id,1,randomUUID(),draft.version,{previewId:preview.id,worldId:worlds[0].id},randomUUID())}
 }
 async function move(a,world){a.person=await store.movePerson(a.accountId,a.person.id,randomUUID(),a.person.version,world.id,randomUUID());return a.person}
 const request=(a,stages=[{worldId:a.person.worldId,worldVersion:a.person.worldVersion}])=>({expectedPersonVersion:a.person.version,expectedWorldVersion:a.person.worldVersion,stages})
 return {pool,admin,store,worlds,seed,move,request,schema}
}

test('stage input is exact and bounded by unique migration versions, not unique worlds',()=>{
 const worldId=randomUUID(),body={expectedPersonVersion:8,expectedWorldVersion:3,stages:[{worldId:worldId.toUpperCase(),worldVersion:1},{worldId,worldVersion:3}]}
 assert.deepEqual(worldStagesInput(body),{...body,stages:body.stages.map(stage=>({...stage,worldId}))})
 const valid={expectedPersonVersion:32,expectedWorldVersion:32,stages:Array.from({length:32},(_,i)=>({worldId,worldVersion:i+1}))}
 assert.equal(worldStagesInput(valid).stages.length,32)
 for(const change of [null,[],{}, {...body,extra:true},{...body,expectedPersonVersion:'8'},{...body,expectedPersonVersion:0},{...body,expectedWorldVersion:2147483648},{...body,stages:[]},{...valid,stages:[...valid.stages,{worldId,worldVersion:33}]},{...body,stages:[body.stages[0],body.stages[0]]},{...body,stages:[{worldId,worldVersion:1,story:'private'}]},{...body,stages:[{worldId:'invalid',worldVersion:1}]},{...body,stages:[{worldId,worldVersion:1.5}]}])assert.throws(()=>worldStagesInput(change),{status:400,code:'INVALID_ARGUMENT'})
})

test('historical stages resolve beyond recent eight moves and preserve A to B to A identities and snapshots',async t=>{
 const f=await fixture(t),a=await f.seed(),initial=a.person
 const initialResult=await f.store.resolveWorldStages(a.accountId,a.person.id,f.request(a))
 assert.deepEqual(initialResult,{accountId:a.accountId,personId:a.person.id,personVersion:1,currentWorldVersion:1,stages:[{worldVersion:1,world:f.worlds[0],basis:'current_catalog'}]})
 // A profile edit changes personVersion without inventing a migration stage.
 a.person=await f.store.updatePerson(a.accountId,a.person.id,randomUUID(),a.person.version,{calledMe:'Synthetic friend'},randomUUID())
 for(let i=0;i<10;i++)await f.move(a,f.worlds[(i+1)%2])
 assert.equal(a.person.worldVersion,11);assert.equal(a.person.version,12)
 assert.equal((await f.store.worldContext(a.accountId,a.person.id)).recentMovements.length,8)
 const stages=[{worldId:f.worlds[1].id,worldVersion:2},{worldId:f.worlds[0].id,worldVersion:11},{worldId:f.worlds[0].id,worldVersion:1},{worldId:f.worlds[0].id,worldVersion:3}]
 const result=await f.store.resolveWorldStages(a.accountId,a.person.id,f.request(a,stages))
 assert.deepEqual(result.stages.map(stage=>stage.worldVersion),[2,11,1,3])
 assert.deepEqual(result.stages.map(stage=>stage.basis),['arrival_snapshot','current_catalog','departure_snapshot','arrival_snapshot'])
 assert.deepEqual(result.stages.map(stage=>stage.world),[f.worlds[1],f.worlds[0],f.worlds[0],f.worlds[0]])
 assert(!JSON.stringify(result).includes(initial.story));assert(!JSON.stringify(result).includes(initial.displayName))
 for(const item of result.stages)assert.deepEqual(Object.keys(item).sort(),['basis','world','worldVersion'])
 await f.pool.query("UPDATE worlds SET display_name='Changed catalog',enabled=false,catalog_version=catalog_version+1 WHERE id=ANY($1::uuid[])",[[f.worlds[0].id,f.worlds[1].id]])
 const disabled=await f.store.resolveWorldStages(a.accountId,a.person.id,f.request(a,stages))
 assert.deepEqual(disabled.stages[0],result.stages[0]);assert.deepEqual(disabled.stages[2],result.stages[2]);assert.deepEqual(disabled.stages[3],result.stages[3])
 assert.equal(disabled.stages[1].world.enabled,false);assert.equal(disabled.stages[1].world.displayName,'Changed catalog');assert.equal(disabled.stages[1].world.catalogVersion,2)
})

test('foreign, unavailable and stale phases fail without disclosing another owner',async t=>{
 const f=await fixture(t),a=await f.seed(),foreign=await f.seed(),old=f.request(a)
 await assert.rejects(()=>f.store.resolveWorldStages(foreign.accountId,a.person.id,old),{status:404,code:'NOT_FOUND'})
 await assert.rejects(()=>f.store.resolveWorldStages(a.accountId,randomUUID(),old),{status:404,code:'NOT_FOUND'})
 await assert.rejects(()=>f.store.resolveWorldStages(a.accountId,a.person.id,f.request(a,[{worldId:f.worlds[1].id,worldVersion:1}])),{status:409,code:'SOURCE_CHANGED'})
 await assert.rejects(()=>f.store.resolveWorldStages(a.accountId,a.person.id,f.request(a,[{worldId:f.worlds[1].id,worldVersion:2}])),{status:409,code:'SOURCE_CHANGED'})
 await f.move(a,f.worlds[1])
 await assert.rejects(()=>f.store.resolveWorldStages(a.accountId,a.person.id,old),{status:409,code:'SOURCE_CHANGED'})
 await assert.rejects(()=>f.store.resolveWorldStages(a.accountId,a.person.id,{...f.request(a),expectedWorldVersion:1}),{status:409,code:'SOURCE_CHANGED'})
 await f.store.removePerson(a.accountId,a.person.id,randomUUID(),a.person.version,randomUUID())
 await assert.rejects(()=>f.store.resolveWorldStages(a.accountId,a.person.id,f.request(a)),{status:404,code:'NOT_FOUND'})
 await erasePeople(f.pool,foreign.accountId,randomUUID())
 await assert.rejects(()=>f.store.resolveWorldStages(foreign.accountId,foreign.person.id,f.request(foreign)),{status:404,code:'NOT_FOUND'})
})

test('a missing or inconsistent entry/departure boundary is not silently reconstructed',async t=>{
 const f=await fixture(t)
 for(const mode of ['gap','wrong-neighbor','future-person-version']){
  const a=await f.seed();await f.move(a,f.worlds[1]);await f.move(a,f.worlds[0]);await f.move(a,f.worlds[1])
  const row=(await f.pool.query('DELETE FROM person_world_movements WHERE account_id=$1 AND person_id=$2 AND world_version=3 RETURNING *',[a.accountId,a.person.id])).rows[0]
  if(mode!=='gap'){
   if(mode==='wrong-neighbor'){row.from_world_id=f.worlds[2].id;row.from_world=f.worlds[2]}
   else row.person_version=a.person.version+1
   await f.pool.query('INSERT INTO person_world_movements SELECT (jsonb_populate_record(NULL::person_world_movements,$1::jsonb)).*',[JSON.stringify(row)])
  }
  await assert.rejects(()=>f.store.resolveWorldStages(a.accountId,a.person.id,f.request(a,[{worldId:f.worlds[1].id,worldVersion:2}])),{status:503,code:'DEPENDENCY_UNAVAILABLE'})
 }
})

test('a resolution uses one repeatable-read snapshot across a concurrent move and catalog change',async t=>{
 const f=await fixture(t),a=await f.seed();await f.move(a,f.worlds[1])
 const input=f.request(a,[{worldId:f.worlds[0].id,worldVersion:1},{worldId:f.worlds[1].id,worldVersion:2}]),before=await f.store.resolveWorldStages(a.accountId,a.person.id,input)
 let changed=false
 const store=new PeopleStore({connect:async()=>{const db=await f.pool.connect();return {release:()=>db.release(),query:async(sql,args)=>{
  const result=await db.query(sql,args)
  if(!changed&&sql.startsWith('SELECT world_version,person_version,from_world_id')){
   changed=true;await f.move(a,f.worlds[0]);await f.pool.query('UPDATE worlds SET enabled=false,catalog_version=catalog_version+1 WHERE id=$1',[f.worlds[1].id])
  }
  return result
 }}}})
 assert.deepEqual(await store.resolveWorldStages(a.accountId,a.person.id,input),before)
 await assert.rejects(()=>f.store.resolveWorldStages(a.accountId,a.person.id,input),{status:409,code:'SOURCE_CHANGED'})
})

test('stage HTTP accepts only Conversations and detects Identity, migration, catalog and erasure races outside SQL transactions',async t=>{
 const f=await fixture(t),a=await f.seed(),foreign=await f.seed(),token=()=>randomBytes(32).toString('hex')
 const conversations=token(),memories=token(),social=token(),people=token()
 let active=true,accessVersion=1,reads=0,onSecond
 const identity=createServer((req,res)=>{(async()=>{
  assert.equal(req.headers.authorization,'Bearer '+people)
  assert.equal((await f.admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND state='idle in transaction'",[f.schema])).rowCount,0)
  if(++reads===2&&onSecond)await onSecond()
  res.writeHead(active?200:404,{'Content-Type':'application/json'});res.end(JSON.stringify({data:{accountId:req.url.split('/')[4],status:'active',accessVersion}}))
 })().catch(error=>{res.writeHead(500);res.end();throw error})})
 await new Promise(resolve=>identity.listen(0,'127.0.0.1',resolve));t.after(()=>{identity.closeAllConnections();return new Promise(resolve=>identity.close(resolve))})
 const config={conversationsServiceToken:conversations,memoriesServiceToken:memories,socialServiceToken:social,serviceToken:people,identityContextUrl:new URL('http://127.0.0.1:'+identity.address().port+'/internal/v1/session-context')}
 const app=await NestFactory.create(PeopleModule.register(config,f.store),{logger:false,abortOnError:false})
 app.use(peopleHeaders);app.useGlobalFilters(new PeopleErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close())
 const origin=await app.getUrl(),path='/internal/v1/persons/'+a.person.id+'/world-stages/resolve'
 const post=({accountId=a.accountId,credential=conversations,body=f.request(a),suffix=''}={})=>{reads=0;return fetch(origin+path+suffix,{method:'POST',headers:{Authorization:'Bearer '+credential,'X-Xijie-Account-Id':accountId,'Content-Type':'application/json'},body:JSON.stringify(body)})}
 for(const credential of [memories,social,people,'0'.repeat(64),'']){assert.equal((await post({credential})).status,403);assert.equal(reads,0)}
 assert.equal((await post({accountId:'invalid'})).status,400)
 assert.equal((await post({body:{...f.request(a),extra:1}})).status,400)
 assert.equal((await post({suffix:'?limit=1'})).status,400)
 assert.equal((await post({accountId:foreign.accountId})).status,404)
 const first=await post();assert.equal(first.status,200);assert.equal(reads,2);assert.deepEqual((await first.json()).data,await f.store.resolveWorldStages(a.accountId,a.person.id,f.request(a)))
 active=false;assert.equal((await post()).status,404);active=true
 onSecond=async()=>{accessVersion++};assert.equal((await post()).status,404);onSecond=undefined
 onSecond=async()=>{await f.move(a,f.worlds[1])};const moved=await post();assert.equal(moved.status,409);assert.equal((await moved.json()).error.code,'SOURCE_CHANGED');onSecond=undefined
 onSecond=async()=>{await f.pool.query('UPDATE worlds SET catalog_version=catalog_version+1 WHERE id=$1',[a.person.worldId])};const catalog=await post();assert.equal(catalog.status,409);assert.equal((await catalog.json()).error.code,'SOURCE_CHANGED');onSecond=undefined
 onSecond=async()=>{active=false};assert.equal((await post()).status,404);onSecond=undefined;active=true
 onSecond=async()=>{await erasePeople(f.pool,a.accountId,randomUUID())};assert.equal((await post()).status,404);onSecond=undefined
 assert.equal((await post()).status,404)
})
