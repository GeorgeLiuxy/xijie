import 'reflect-metadata'
import assert from 'node:assert/strict'
import {randomUUID,createHash} from 'node:crypto'
import {readFile,readdir} from 'node:fs/promises'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {test} from 'node:test'
import pg from 'pg'
import {NestFactory} from '@nestjs/core'
import {PeopleStore} from '../dist/store.js'
import {worldInput} from '../dist/contracts.js'
import {exportPeople,erasePeople} from '../dist/data-rights.js'
import {PeopleModule,PeopleErrors,peopleHeaders} from '../dist/http.js'
const stable=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(stable).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}'

async function fixture(t){
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL;assert(connectionString,'Integration database required')
 const schema='world_moves_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString})
 await admin.query('CREATE SCHEMA '+schema)
 const pool=new pg.Pool({connectionString,options:'-c search_path='+schema,application_name:schema}),store=new PeopleStore(pool)
 for(const file of (await readdir(new URL('../db/',import.meta.url))).filter(file=>/^\d+_.+\.sql$/.test(file)).sort())await pool.query(await readFile(new URL('../db/'+file,import.meta.url),'utf8'))
 t.after(async()=>{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()})
 const worlds=await store.worlds(undefined,100)
 async function seed(accountId=randomUUID()){
  const draft=await store.create(accountId,1,randomUUID(),{displayName:'Synthetic friend',story:'User-provided original story',relationship:'friend'})
  const preview=await store.createPreview(accountId,draft.id,1,randomUUID(),draft.version,{worldPreferenceId:worlds[0].id,previousPreviewId:null})
  const confirmKey=randomUUID(),input={previewId:preview.id,worldId:worlds[0].id}
  const person=await store.confirm(accountId,draft.id,1,confirmKey,draft.version,input,randomUUID())
  return {accountId,draft,preview,confirmKey,input,person}
 }
 return {pool,admin,store,worlds,seed,schema}
}

test('committed world changes preserve identity, explicit source history, exact versions and current-state replays',async t=>{
 const f=await fixture(t),a=await f.seed(),key=randomUUID(),trace=randomUUID()
 const initial=await f.store.worldContext(a.accountId,a.person.id)
 assert.equal(initial.worldVersion,1);assert.deepEqual(initial.recentMovements,[])
 const profileKey=randomUUID(),edited=await f.store.updatePerson(a.accountId,a.person.id,profileKey,1,{displayName:'Updated name'},randomUUID())
 assert.equal(edited.worldVersion,1);assert.equal((await f.store.worldContext(a.accountId,a.person.id)).revision,initial.revision)
 const moved=await f.store.movePerson(a.accountId,a.person.id,key,edited.version,f.worlds[1].id,trace)
 assert.equal(moved.id,a.person.id);assert.equal(moved.worldVersion,2);assert.equal(moved.version,3);assert.equal(moved.story,a.person.story)
 assert.equal(moved.createdAt,a.person.createdAt)
 const context=await f.store.worldContext(a.accountId,a.person.id),first=context.recentMovements[0]
 assert.equal(context.branch,'main');assert.equal(context.reality,'virtual');assert.equal(context.currentWorld.id,f.worlds[1].id)
 assert.equal(first.worldVersion,2);assert.equal(first.personVersion,3);assert.deepEqual(first.fromWorld,f.worlds[0]);assert.deepEqual(first.toWorld,f.worlds[1])
 const {revision,personVersion,...snapshot}=context
 assert.equal(revision,createHash('sha256').update(stable(snapshot)).digest('hex'))
 assert.equal((await f.store.personContext(a.accountId,a.person.id)).accessVersion,1)
 const events=(await f.pool.query('SELECT type,payload,request_id FROM outbox_events WHERE aggregate_id=$1 AND aggregate_version=$2 ORDER BY type',[a.person.id,moved.version])).rows
 assert.deepEqual(events.map(event=>event.type),['PersonUpdated.v1','PersonWorldChanged.v1'])
 assert(events.every(event=>event.request_id===trace))
 assert(!JSON.stringify(events).includes(a.person.story))
 const before=(await f.pool.query('SELECT count(*)::int AS n FROM outbox_events')).rows[0].n
 assert.deepEqual(await f.store.movePerson(a.accountId,a.person.id,randomUUID(),moved.version,moved.worldId,randomUUID()),moved)
 assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM outbox_events')).rows[0].n,before)
 const later=await f.store.movePerson(a.accountId,a.person.id,randomUUID(),moved.version,f.worlds[2].id,randomUUID())
 assert.deepEqual(await f.store.movePerson(a.accountId,a.person.id,key,edited.version,f.worlds[1].id,randomUUID()),later)
 assert.deepEqual(await f.store.confirm(a.accountId,a.draft.id,1,a.confirmKey,a.draft.version,a.input,randomUUID()),later)
 assert.deepEqual(await f.store.updatePerson(a.accountId,a.person.id,profileKey,1,{displayName:'Updated name'},randomUUID()),later)
 assert.equal((await f.store.worldMovements(a.accountId,a.person.id,undefined,100)).length,2)
 await assert.rejects(()=>f.store.movePerson(a.accountId,a.person.id,key,edited.version,f.worlds[2].id,randomUUID()),{code:'IDEMPOTENCY_CONFLICT'})
 await assert.rejects(()=>f.store.movePerson(a.accountId,a.person.id,randomUUID(),moved.version,f.worlds[0].id,randomUUID()),{code:'VERSION_CONFLICT'})
})

test('invalid worlds, foreign people, concurrent moves and failed event commits cannot manufacture history',async t=>{
 const f=await fixture(t),a=await f.seed()
 await assert.rejects(()=>f.store.movePerson(randomUUID(),a.person.id,randomUUID(),1,f.worlds[1].id,randomUUID()),{code:'NOT_FOUND'})
 await assert.rejects(()=>f.store.movePerson(a.accountId,a.person.id,randomUUID(),1,randomUUID(),randomUUID()),{code:'INVALID_ARGUMENT'})
 await f.pool.query('UPDATE worlds SET enabled=false WHERE id=$1',[f.worlds[1].id])
 await assert.rejects(()=>f.store.movePerson(a.accountId,a.person.id,randomUUID(),1,f.worlds[1].id,randomUUID()),{code:'INVALID_ARGUMENT'})
 await f.pool.query('UPDATE worlds SET enabled=true WHERE id=$1',[f.worlds[1].id])
 const race=await Promise.allSettled([f.worlds[1],f.worlds[2]].map(world=>f.store.movePerson(a.accountId,a.person.id,randomUUID(),1,world.id,randomUUID())))
 assert.equal(race.filter(row=>row.status==='fulfilled').length,1);assert.equal(race.find(row=>row.status==='rejected').reason.code,'VERSION_CONFLICT')
 assert.equal((await f.store.worldMovements(a.accountId,a.person.id,undefined,100)).length,1)
 const b=await f.seed(),key=randomUUID()
 await f.pool.query("CREATE FUNCTION reject_world_update() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.type='PersonUpdated.v1' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END$$")
 await f.pool.query('CREATE TRIGGER reject_world_update BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION reject_world_update()')
 await assert.rejects(()=>f.store.movePerson(b.accountId,b.person.id,key,1,f.worlds[1].id,randomUUID()))
 assert.equal((await f.store.getPerson(b.accountId,b.person.id)).version,1);assert.deepEqual(await f.store.worldMovements(b.accountId,b.person.id,undefined,100),[])
 assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_id=$1 AND type='PersonWorldChanged.v1'",[b.person.id])).rows[0].n,0)
 await f.pool.query('DROP TRIGGER reject_world_update ON outbox_events');await f.pool.query('DROP FUNCTION reject_world_update()')
 assert.equal((await f.store.movePerson(b.accountId,b.person.id,key,1,f.worlds[1].id,randomUUID())).worldVersion,2)
})

test('current disabled worlds stay readable and movement snapshots remain immutable, complete and virtual',async t=>{
 const f=await fixture(t),a=await f.seed(),moved=await f.store.movePerson(a.accountId,a.person.id,randomUUID(),1,f.worlds[1].id,randomUUID())
 const previous=await f.store.worldContext(a.accountId,a.person.id)
 await f.pool.query("UPDATE worlds SET enabled=false,display_name='Renamed catalog',catalog_version=catalog_version+1 WHERE id=$1",[moved.worldId])
 const current=await f.store.worldContext(a.accountId,a.person.id)
 assert.equal(current.currentWorld.enabled,false);assert.equal(current.currentWorld.displayName,'Renamed catalog');assert.notEqual(current.revision,previous.revision)
 assert.deepEqual(current.recentMovements,previous.recentMovements)
 assert.deepEqual(await f.store.getWorld(moved.worldId),current.currentWorld)
 assert.deepEqual(await f.store.movePerson(a.accountId,a.person.id,randomUUID(),moved.version,moved.worldId,randomUUID()),moved)
 await assert.rejects(f.pool.query("UPDATE person_world_movements SET reality='virtual' WHERE id=$1",[current.recentMovements[0].id]),{code:'23514'})
 await assert.rejects(f.pool.query('UPDATE persons SET world_version=version+1 WHERE id=$1',[a.person.id]),{code:'23514'})
 const insert=`INSERT INTO person_world_movements(account_id,person_id,world_version,person_version,from_world_id,to_world_id,from_world,to_world,actor_account_id,request_id,occurred_at,recorded_at)
 VALUES($1,$2,3,3,$3,$4,$5,$6,$1,$7,statement_timestamp(),statement_timestamp())`
 for(const bad of [{}, {...f.worlds[0],displayName:''}])await assert.rejects(f.pool.query(insert,[a.accountId,a.person.id,f.worlds[0].id,f.worlds[2].id,JSON.stringify(bad),JSON.stringify(f.worlds[2]),randomUUID()]),{code:'23514'})
 for(const payload of [{worldId:f.worlds[0].id,actor:'ai'},{worldId:f.worlds[0].id,branch:'other'},{worldId:f.worlds[0].id,reality:'real'},{}])assert.throws(()=>worldInput(payload),{code:'INVALID_ARGUMENT'})
})

test('Social sources expose only current person metadata and page the complete immutable history to a fixed horizon',async t=>{
 const f=await fixture(t),a=await f.seed(),b=await f.seed()
 assert.deepEqual(await f.store.socialWorldMovements(a.accountId,a.person.id,1,1,100),{accountId:a.accountId,person:{id:a.person.id,displayName:a.person.displayName,worldId:a.person.worldId,version:1,accessVersion:1,worldVersion:1},items:[],nextAfterVersion:1,hasMore:false})
 let current=a.person
 for(let i=0;i<11;i++)current=await f.store.movePerson(a.accountId,a.person.id,randomUUID(),current.version,f.worlds[(i%2)+1].id,randomUUID())
 const directory=await f.store.socialPersons(a.accountId);assert.equal(directory.persons.length,1);assert.equal(directory.persons[0].worldVersion,12);assert(!JSON.stringify(directory).includes(a.person.story));assert.deepEqual(Object.keys(directory.persons[0]).sort(),['accessVersion','displayName','id','version','worldId','worldVersion'])
 const first=await f.store.socialWorldMovements(a.accountId,a.person.id,1,10,3);assert.deepEqual(first.items.map(row=>row.worldVersion),[2,3,4]);assert(first.hasMore);assert.equal(first.nextAfterVersion,4)
 // New committed facts cannot extend the captured horizon of an in-progress sync.
 current=await f.store.movePerson(a.accountId,a.person.id,randomUUID(),current.version,f.worlds[0].id,randomUUID())
 const seen=[...first.items],horizon=10;let after=first.nextAfterVersion
 while(after<horizon){const page=await f.store.socialWorldMovements(a.accountId,a.person.id,after,horizon,3);seen.push(...page.items);after=page.nextAfterVersion;assert.equal(page.hasMore,after<horizon)}
 assert.deepEqual(seen.map(row=>row.worldVersion),[2,3,4,5,6,7,8,9,10]);assert.equal(new Set(seen.map(row=>row.id)).size,9)
 const rest=await f.store.socialWorldMovements(a.accountId,a.person.id,10,current.worldVersion,100);assert.deepEqual(rest.items.map(row=>row.worldVersion),[11,12,13]);assert.equal(rest.nextAfterVersion,13);assert.equal(rest.hasMore,false)
 await assert.rejects(f.store.socialWorldMovements(b.accountId,a.person.id,1,1,100),{code:'NOT_FOUND'})
 for(const args of [[0,1,100],[2,1,100],[1,99,100],[1,13,101],[1,13,0],[1.5,13,10]])await assert.rejects(f.store.socialWorldMovements(a.accountId,a.person.id,...args),{code:'INVALID_ARGUMENT'})
 await f.pool.query('DELETE FROM person_world_movements WHERE account_id=$1 AND person_id=$2 AND world_version=5',[a.accountId,a.person.id])
 await assert.rejects(f.store.socialWorldMovements(a.accountId,a.person.id,1,10,100),{code:'DEPENDENCY_UNAVAILABLE'})
 await assert.rejects(f.store.socialWorldMovements(a.accountId,a.person.id,5,10,100),{code:'DEPENDENCY_UNAVAILABLE'})
 await f.store.removePerson(a.accountId,a.person.id,randomUUID(),current.version,randomUUID());assert.deepEqual((await f.store.socialPersons(a.accountId)).persons,[])
 await assert.rejects(f.store.socialWorldMovements(a.accountId,a.person.id,10,13,100),{code:'NOT_FOUND'})
 await erasePeople(f.pool,a.accountId,randomUUID());await assert.rejects(f.store.socialPersons(a.accountId),{code:'NOT_FOUND'})
})

test('Social person metadata fails explicitly above the supported bound instead of hiding remaining people',async t=>{
 const f=await fixture(t),a=await f.seed()
 await f.pool.query(`WITH drafts AS (
  INSERT INTO person_drafts(account_id,display_name,relationship,story,authorization_version,created_at,updated_at,expires_at)
  SELECT $1,'Synthetic bounded person','friend','Synthetic source',1,statement_timestamp(),statement_timestamp(),statement_timestamp()+interval '1 day' FROM generate_series(1,1000) RETURNING account_id,id
 ), previews AS (
  INSERT INTO person_previews(account_id,draft_id,draft_version,authorization_version,suggested_world_id,created_at,expires_at)
  SELECT account_id,id,1,1,$2,statement_timestamp(),statement_timestamp()+interval '1 hour' FROM drafts RETURNING account_id,draft_id,id
 ) INSERT INTO persons(account_id,source_draft_id,source_preview_id,display_name,relationship,story,world_id,created_at,updated_at)
 SELECT account_id,draft_id,id,'Synthetic bounded person','friend','Synthetic source',$2,statement_timestamp(),statement_timestamp() FROM previews`,[a.accountId,f.worlds[0].id])
 await assert.rejects(f.store.socialPersons(a.accountId),{status:413,code:'SOURCE_TOO_LARGE'})
 assert.equal((await f.store.socialPersons(randomUUID())).persons.length,0)
})

test('Social AI portrait and world sources require the new exact purpose and recheck person, account and storage',async t=>{
 const f=await fixture(t),a=await f.seed(),socialToken='ab'.repeat(32),peopleToken='bc'.repeat(32),conversationToken='cd'.repeat(32),memoryToken='de'.repeat(32)
 let state={active:true,available:true,accessVersion:1,storyStorage:{allowed:true,authorizationVersion:1,privateFeedAllowed:true},aiTextProcessing:{allowed:true,authorizationVersion:5,privateFeedProcessingAllowed:true}},reads=0,onSecond
 const identity=createServer((req,res)=>{void (async()=>{
  if(req.headers.authorization!=='Bearer '+peopleToken){res.writeHead(403);res.end();return}
  reads++;if(reads===2&&onSecond)await onSecond()
  if(!state.available){res.writeHead(503);res.end();return}if(!state.active){res.writeHead(404);res.end();return}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:{accountId:a.accountId,status:'active',accessVersion:state.accessVersion,storyStorage:state.storyStorage,aiTextProcessing:state.aiTextProcessing}}))
 })().catch(()=>{res.writeHead(500);res.end()})});identity.listen(0,'127.0.0.1');await once(identity,'listening');t.after(()=>{identity.closeAllConnections();return new Promise(resolve=>identity.close(resolve))})
 const config={identityContextUrl:new URL('http://127.0.0.1:'+identity.address().port+'/internal/v1/session-context'),serviceToken:peopleToken,socialServiceToken:socialToken,conversationsServiceToken:conversationToken,memoriesServiceToken:memoryToken,webOrigin:'http://localhost:5184'}
 const app=await NestFactory.create(PeopleModule.register(config,f.store),{logger:false,abortOnError:false});app.use(peopleHeaders);app.useGlobalFilters(new PeopleErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close());const origin=await app.getUrl(),headers={Authorization:'Bearer '+socialToken,'X-Xijie-Account-Id':a.accountId}
 const source=(kind='ai-context',query='?expectedAiVersion=5',h=headers)=>{reads=0;return fetch(origin+'/internal/v1/social/persons/'+a.person.id+'/'+kind+query,{headers:h})}
 const portrait=await source();assert.equal(portrait.status,200);const p=(await portrait.json()).data;assert.equal(p.story,a.person.story);assert.deepEqual(Object.keys(p).sort(),['accessVersion','accountId','catchphrase','conversationTone','displayName','id','life','personality','relationship','story','unknowns','version','voiceTimbre','worldId','worldVersion'])
 const world=await source('world-context');assert.equal(world.status,200);const w=(await world.json()).data;assert.equal(w.reality,'virtual');assert.equal(w.branch,'main');assert.equal(w.worldVersion,1);assert.equal(w.personVersion,1);assert.deepEqual(w.recentMovements,[])
 for(const other of [peopleToken,conversationToken,memoryToken,'0'.repeat(64)])assert.equal((await source('ai-context','?expectedAiVersion=5',{...headers,Authorization:'Bearer '+other})).status,403)
 for(const query of ['', '?expectedAiVersion=0','?expectedAiVersion=1','?expectedAiVersion=5&body=anything','?expectedAiVersion=5&expectedAiVersion=5'])assert([400,403].includes((await source('ai-context',query)).status))
 for(const flag of [false,undefined]){state.aiTextProcessing.privateFeedProcessingAllowed=flag;assert.equal((await source()).status,403);assert.equal((await source('world-context')).status,403)}state.aiTextProcessing.privateFeedProcessingAllowed=true
 state.storyStorage.privateFeedAllowed=false;assert.equal((await source()).status,403);assert.equal((await fetch(origin+'/internal/v1/social/persons',{headers})).status,200);state.storyStorage.privateFeedAllowed=true
 state.aiTextProcessing.allowed=false;assert.equal((await source()).status,403);state.aiTextProcessing.allowed=true
 state.aiTextProcessing.privateFeedProcessingAllowed='true';assert.equal((await source()).status,503);state.aiTextProcessing.privateFeedProcessingAllowed=true
 onSecond=async()=>{state.storyStorage.authorizationVersion++};assert.equal((await source()).status,403);onSecond=undefined
 onSecond=async()=>{state.accessVersion++};assert.equal((await source()).status,403);onSecond=undefined
 onSecond=async()=>{await f.store.movePerson(a.accountId,a.person.id,randomUUID(),1,f.worlds[1].id,randomUUID())};assert.equal((await source('world-context')).status,409);onSecond=undefined
 state.active=false;assert.equal((await source()).status,404);state.active=true;state.available=false;assert.equal((await source()).status,503);state.available=true
 await f.store.removePerson(a.accountId,a.person.id,randomUUID(),2,randomUUID());assert.equal((await source()).status,404)
})

test('Social-only HTTP source roles, account status and malformed ranges never fall back to cached or broader story context',async t=>{
 const f=await fixture(t),a=await f.seed(),token='1a'.repeat(32),socialToken='2b'.repeat(32),conversationToken='3c'.repeat(32),memoryToken='4d'.repeat(32)
 let active=true,available=true,badAccount=false,reads=0,revokeAfterRead=false
 const identity=createServer((req,res)=>{
  if(req.headers.authorization!=='Bearer '+token){res.writeHead(403);res.end();return}
  if(!available){res.writeHead(503);res.end();return}
  reads++
  if(!active||revokeAfterRead&&reads>1){res.writeHead(404);res.end();return}
  const accountId=badAccount?randomUUID():req.url.split('/')[4]
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:{accountId,status:'active',accessVersion:1}}))
 });identity.listen(0,'127.0.0.1');await once(identity,'listening');t.after(()=>{identity.closeAllConnections();return new Promise(resolve=>identity.close(resolve))})
 const config={identityContextUrl:new URL('http://127.0.0.1:'+identity.address().port+'/internal/v1/session-context'),serviceToken:token,socialServiceToken:socialToken,conversationsServiceToken:conversationToken,memoriesServiceToken:memoryToken,webOrigin:'http://localhost:5184'}
 const app=await NestFactory.create(PeopleModule.register(config,f.store),{logger:false,abortOnError:false});app.use(peopleHeaders);app.useGlobalFilters(new PeopleErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close());const origin=await app.getUrl(),headers={Authorization:'Bearer '+socialToken,'X-Xijie-Account-Id':a.accountId}
 const list=()=>fetch(origin+'/internal/v1/social/persons',{headers})
 const response=await list();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const data=(await response.json()).data;assert.equal(data.accountId,a.accountId);assert(!JSON.stringify(data).includes(a.person.story));assert.equal(data.persons.length,1)
 for(const other of [undefined,token,conversationToken,memoryToken,'0'.repeat(64)])assert.equal((await fetch(origin+'/internal/v1/social/persons',{headers:{...headers,Authorization:other?'Bearer '+other:''}})).status,403)
 for(const suffix of ['context','world-context'])assert.equal((await fetch(origin+'/internal/v1/persons/'+a.person.id+'/'+suffix,{headers})).status,403)
 assert.equal((await fetch(origin+'/internal/v1/persons',{headers})).status,403)
 const pagePath='/internal/v1/social/persons/'+a.person.id+'/world-movements'
 const initial=await fetch(origin+pagePath+'?afterVersion=1&throughVersion=1&limit=100',{headers});assert.equal(initial.status,200);assert.deepEqual((await initial.json()).data.items,[])
 for(const query of ['', '?afterVersion=0&throughVersion=1','?afterVersion=1&throughVersion=2','?afterVersion=1&throughVersion=1&limit=101','?afterVersion=1&throughVersion=1&cursor=anything','?afterVersion=1.0&throughVersion=1','?afterVersion=1&afterVersion=2&throughVersion=2'])assert.equal((await fetch(origin+pagePath+query,{headers})).status,400)
 assert.equal((await fetch(origin+'/internal/v1/social/persons?limit=1',{headers})).status,400)
 available=false;assert.equal((await list()).status,503);available=true
 active=false;assert.equal((await list()).status,404);active=true
 reads=0;revokeAfterRead=true;assert.equal((await list()).status,404);revokeAfterRead=false
 badAccount=true;assert.equal((await list()).status,503);badAccount=false
 config.socialServiceToken=null;assert.equal((await list()).status,404);config.socialServiceToken=socialToken
 await f.store.removePerson(a.accountId,a.person.id,randomUUID(),1,randomUUID());assert.deepEqual((await (await list()).json()).data.persons,[])
 assert.equal((await fetch(origin+pagePath+'?afterVersion=1&throughVersion=1',{headers})).status,404)
 await erasePeople(f.pool,a.accountId,randomUUID());assert.equal((await list()).status,404)
})

test('world history participates in rights revisions and erasure, while removed people and late writes never revive it',async t=>{
 const f=await fixture(t),a=await f.seed(),b=await f.seed()
 const before=await exportPeople(f.pool,a.accountId,'account_data')
 const moved=await f.store.movePerson(a.accountId,a.person.id,randomUUID(),1,f.worlds[1].id,randomUUID())
 const exported=await exportPeople(f.pool,a.accountId,'account_data')
 assert.notEqual(exported.revision,before.revision);assert.equal(exported.data.worldMovements.length,1)
 assert.equal(exported.data.worldMovements[0].reality,'virtual');assert.equal(exported.data.persons[0].worldVersion,2)
 assert.equal(exported.revision,createHash('sha256').update(JSON.stringify(exported.data)).digest('hex'))
 await f.store.removePerson(a.accountId,a.person.id,randomUUID(),moved.version,randomUUID())
 await assert.rejects(()=>f.store.worldContext(a.accountId,a.person.id),{code:'NOT_FOUND'});await assert.rejects(()=>f.store.worldMovements(a.accountId,a.person.id,undefined,100),{code:'NOT_FOUND'})
 assert.deepEqual((await exportPeople(f.pool,a.accountId,'account_data')).data.worldMovements,[])
 await erasePeople(f.pool,a.accountId,randomUUID())
 assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM person_world_movements WHERE account_id=$1',[a.accountId])).rows[0].n,0)
 await assert.rejects(()=>f.store.create(a.accountId,1,randomUUID(),{displayName:'Cannot revive'}),{code:'NOT_FOUND'})
 assert.equal((await f.store.getPerson(b.accountId,b.person.id)).id,b.person.id)
})

test('private writes acquire the erasure account gate before a person row, avoiding inverted lock order',async t=>{
 const f=await fixture(t),a=await f.seed(),blocker=await f.pool.connect()
 let pending
 try{
  await blocker.query('BEGIN');await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('xijie:people:erasure:' || $1,0))",[a.accountId])
  pending=f.store.movePerson(a.accountId,a.person.id,randomUUID(),1,f.worlds[1].id,randomUUID())
  const deadline=Date.now()+3000;let waiting=false
  while(Date.now()<deadline){const found=await f.admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%'",[f.schema]);if(found.rowCount){waiting=true;break}await new Promise(resolve=>setTimeout(resolve,10))}
  assert(waiting,'Writer must reach the account lock')
  await blocker.query('SELECT id FROM persons WHERE id=$1 FOR UPDATE NOWAIT',[a.person.id])
  await blocker.query('COMMIT');assert.equal((await pending).worldVersion,2)
 }finally{await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>{})}
})

test('world context rejects a gapped committed mainline rather than presenting partial facts as complete history',async t=>{
 const f=await fixture(t),a=await f.seed()
 let current=a.person
 for(let index=0;index<10;index++)current=await f.store.movePerson(a.accountId,a.person.id,randomUUID(),current.version,f.worlds[(index%2)+1].id,randomUUID())
 const snapshot=await f.store.worldContext(a.accountId,a.person.id)
 assert.equal(snapshot.worldVersion,11);assert.deepEqual(snapshot.recentMovements.map(row=>row.worldVersion),[11,10,9,8,7,6,5,4])
 await f.pool.query('DELETE FROM person_world_movements WHERE account_id=$1 AND person_id=$2 AND world_version=9',[a.accountId,a.person.id])
 await assert.rejects(()=>f.store.worldContext(a.accountId,a.person.id),{code:'DEPENDENCY_UNAVAILABLE'})
})

test('a concurrent catalog withdrawal is locked and rechecked before a move can commit',async t=>{
 const f=await fixture(t),a=await f.seed(),catalog=await f.pool.connect();let pending
 try{
  await catalog.query('BEGIN');await catalog.query('UPDATE worlds SET enabled=false WHERE id=$1',[f.worlds[1].id])
  pending=f.store.movePerson(a.accountId,a.person.id,randomUUID(),1,f.worlds[1].id,randomUUID())
  const deadline=Date.now()+3000;let waiting=false
  while(Date.now()<deadline){const result=await f.admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE '%ORDER BY id FOR SHARE%'",[f.schema]);if(result.rowCount){waiting=true;break}await new Promise(resolve=>setTimeout(resolve,10))}
  assert(waiting,'Move must wait on the locked catalog snapshot')
  await catalog.query('COMMIT');await assert.rejects(pending,{code:'INVALID_ARGUMENT'})
  assert.equal((await f.store.getPerson(a.accountId,a.person.id)).worldVersion,1)
  assert.deepEqual(await f.store.worldMovements(a.accountId,a.person.id,undefined,10),[])
 }finally{await catalog.query('ROLLBACK');catalog.release();await pending?.catch(()=>{})}
})

test('original HTTP move uses conditional ownership, metadata-only world context and authenticated historical catalog reads',async t=>{
 const f=await fixture(t),a=await f.seed(),token='ac'.repeat(32),conversationsToken='bd'.repeat(32),memoryToken='ce'.repeat(32)
 let active=true,storage=true,accountId=a.accountId
 const identity=createServer((req,res)=>{const isAccount=req.url.startsWith('/internal/v1/accounts/');const data=isAccount?{accountId,status:active?'active':'restricted',accessVersion:1}:{accountId,sessionId:'0d000000-0000-4000-8000-000000000001',expiresAt:new Date(Date.now()+60000).toISOString(),storyStorage:{allowed:storage,authorizationVersion:1}};res.writeHead(active?200:404,{'Content-Type':'application/json'});res.end(JSON.stringify({data}))})
 identity.listen(0,'127.0.0.1');await once(identity,'listening')
 const config={identityContextUrl:new URL('http://127.0.0.1:'+identity.address().port+'/internal/v1/session-context'),serviceToken:token,conversationsServiceToken:conversationsToken,memoriesServiceToken:memoryToken,sessionCookie:'xijie_dev_session',webOrigin:'http://localhost:5184'}
 const app=await NestFactory.create(PeopleModule.register(config,f.store),{logger:false,abortOnError:false});app.use(peopleHeaders);app.useGlobalFilters(new PeopleErrors());await app.listen(0,'127.0.0.1');const origin=await app.getUrl()
 t.after(async()=>{await app.close();identity.closeAllConnections();await new Promise(resolve=>identity.close(resolve))})
 const user={Cookie:'xijie_dev_session='+'x'.repeat(43),Origin:config.webOrigin,'Idempotency-Key':randomUUID(),'Content-Type':'application/json','If-Match':'"v1"'}
 const move=(headers=user,body={worldId:f.worlds[1].id})=>fetch(origin+'/v1/persons/'+a.person.id+'/world',{method:'POST',headers,body:JSON.stringify(body)})
 assert.equal((await move({...user,'If-Match':''})).status,428)
 assert.equal((await move({...user,Origin:'http://other.test'})).status,403)
 assert.equal((await move(user,{worldId:f.worlds[1].id,branch:'other'})).status,400)
 storage=false;assert.equal((await move()).status,403);storage=true
 const result=await move();assert.equal(result.status,200);assert.equal((await result.json()).data.worldVersion,2)
 assert.equal(result.headers.get('etag'),'"v2"')
 const contextURL=origin+'/internal/v1/persons/'+a.person.id+'/world-context',headers={Authorization:'Bearer '+conversationsToken,'X-Xijie-Account-Id':a.accountId}
 assert.equal((await fetch(contextURL)).status,403)
 storage=false;const source=await fetch(contextURL,{headers});assert.equal(source.status,200);assert.equal((await source.json()).data.currentWorld.id,f.worlds[1].id)
 assert.equal((await fetch(contextURL,{headers:{...headers,Authorization:'Bearer '+memoryToken}})).status,200)
 assert.equal((await fetch(contextURL,{headers:{...headers,'X-Xijie-Account-Id':randomUUID()}})).status,503)
 accountId=randomUUID();assert.equal((await fetch(contextURL,{headers:{...headers,'X-Xijie-Account-Id':accountId}})).status,404);accountId=a.accountId
 active=false;assert.equal((await fetch(contextURL,{headers})).status,404);active=true
 await f.pool.query('UPDATE worlds SET enabled=false WHERE id=$1',[f.worlds[1].id])
 const detail=await fetch(origin+'/v1/worlds/'+f.worlds[1].id,{headers:user});assert.equal(detail.status,200);assert.equal((await detail.json()).data.enabled,false)
 const history=await fetch(origin+'/v1/persons/'+a.person.id+'/world-movements?limit=1',{headers:user});assert.equal(history.status,200);assert.equal((await history.json()).data.length,1)
 storage=true
 const second=await move({...user,'If-Match':'"v2"','Idempotency-Key':randomUUID()},{worldId:f.worlds[2].id});assert.equal(second.status,200)
 const firstPage=await (await fetch(origin+'/v1/persons/'+a.person.id+'/world-movements?limit=1',{headers:user})).json()
 assert.equal(firstPage.data[0].worldVersion,3);assert(firstPage.meta.nextCursor)
 const next=await (await fetch(origin+'/v1/persons/'+a.person.id+'/world-movements?limit=1&cursor='+encodeURIComponent(firstPage.meta.nextCursor),{headers:user})).json()
 assert.equal(next.data[0].worldVersion,2);assert.equal(next.meta.nextCursor,null)
 assert.equal((await fetch(origin+'/v1/persons/'+a.person.id+'/world-movements?limit=2&cursor='+encodeURIComponent(firstPage.meta.nextCursor),{headers:user})).status,400)
})
