import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {fixture,post,comment} from './fixture.mjs'
import {EchoStore} from '../dist/echo-store.js'
import {EchoEngine} from '../dist/echo-engine.js'
import {EchoError} from '../dist/echo-provider.js'
import {worldContextRevision} from '../dist/virtual-world.js'
import {SocialDataRights} from '../dist/data-rights.js'
import 'reflect-metadata'
import {NestFactory} from '@nestjs/core'
import {SocialModule,SocialErrors,socialHeaders} from '../dist/http.js'
import {EchoQueue,ECHO_QUEUE} from '../dist/echo-queue.js'
import pg from 'pg'

async function setup(t){
 const f=await fixture(t),a=f.account(),p=f.makePerson(a),memory={accountId:a,personId:p.person.id,id:randomUUID(),title:'独立合成原文',body:'我们在河边散步，停下来照顾了一盆蓝雪花。',origin:'manual',version:1,confirmedAt:new Date().toISOString(),updatedAt:new Date().toISOString()}
 f.accounts.get(a).aiTextProcessing={allowed:true,authorizationVersion:1,privateFeedProcessingAllowed:true}
 let removed=false,failQueue=false;const deliveries=[],queue={async send(db,d){assert(db.query);if(failQueue)throw new Error('Physical enqueue failed');deliveries.push(d)}}
 f.deps.echoMemory=async(accountId,personId,id,version,aiVersion)=>{const grant=f.accounts.get(accountId)?.aiTextProcessing;if(removed||id!==memory.id||personId!==memory.personId||version!==memory.version||!grant?.allowed||!grant.privateFeedProcessingAllowed||grant.authorizationVersion!==aiVersion)throw new EchoError('CONTEXT_REVOKED',false,true);return structuredClone(memory)}
 f.deps.validMemories=async(accountId,personId,refs)=>refs.filter(r=>!removed&&accountId===a&&personId===memory.personId&&r.id===memory.id&&r.version===memory.version)
 f.deps.echoPerson=async()=>({...structuredClone(p.person),accountId:a,relationship:'friend',story:'用户提供：合成朋友喜欢盆栽。'})
 f.deps.echoWorld=async()=>{const x={accountId:a,personId:p.person.id,personVersion:p.person.version,worldVersion:p.person.worldVersion,reality:'virtual',branch:'main',currentWorld:p.worlds.find(w=>w.id===p.person.worldId),recentMovements:[...f.histories.get(p.person.id)].reverse().slice(0,8)};return {...structuredClone(x),revision:worldContextRevision(x)}}
 const jobs=new EchoStore(f.store,queue);f.store.generations=jobs
 const event=(extra={})=>({eventId:randomUUID(),accountId:a,personId:p.person.id,memoryId:memory.id,sourceVersion:memory.version,change:'upsert',echoAiAuthorizationVersion:1,occurredAt:new Date().toISOString(),...extra})
 const run=async(fn)=>new EchoEngine(jobs,{async generate(input){return fn?await fn(input):{text:'合成模型输出：想起那盆蓝雪花，心里很暖。'}}}).run(deliveries.at(-1))
 const echo=async()=>{await jobs.ingest(event());await run();return (await f.store.feed(a,{},undefined,100)).find(p=>p.kind==='memory_echo')}
 return {...f,a,p,memory,jobs,deliveries,event,run,echo,remove(){removed=true},failQueue(){failQueue=true}}
}

test('confirmed originals create one actual source-bound echo, and only self comments on it schedule the source persona',async t=>{
 const f=await setup(t),event=f.event();await f.jobs.ingest(event);await f.jobs.ingest(event);assert.equal(f.deliveries.length,1)
 await f.run(async input=>{assert.equal(input.memory.body,f.memory.body);assert.equal(input.person.id,f.p.person.id);assert.equal(input.world.reality,'virtual');return {text:'来自实际合成provider的唯一回响。'}})
 const echo=(await f.store.feed(f.a,{},undefined,100))[0];assert.equal(echo.kind,'memory_echo');assert.equal(echo.author.kind,'persona');assert.equal(echo.author.personId,f.p.person.id);assert.equal(echo.sourceMemory.excerpt,f.memory.body);assert.equal(echo.worldSnapshot.id,f.p.person.worldId)
 const self=await f.store.comment(f.a,echo.id,randomUUID(),comment());assert.equal(self.author.kind,'self');assert.equal(f.deliveries.length,2)
 await f.run(async input=>{assert.equal(input.kind,'feed_reaction');assert.equal(input.comment.id,self.id);return {text:'合成角色对这条评论的真实任务输出。'}})
 const replies=await f.store.comments(f.a,echo.id,undefined,100);assert.equal(replies.length,2);assert.equal(replies[1].author.kind,'persona');assert.equal(replies[1].author.personId,f.p.person.id);assert.equal(replies[1].replyToCommentId,self.id);assert.equal(f.deliveries.length,2)
 const ordinary=await f.store.create(f.a,randomUUID(),post());await f.store.comment(f.a,ordinary.id,randomUUID(),comment());assert.equal(f.deliveries.length,2)
 const sameJob=f.deliveries[0];await new EchoEngine(f.jobs,{generate:async()=>{throw Error('No terminal model rerun')}}).run(sameJob)
 assert.equal((await f.pool.query("SELECT count(*)::int n FROM posts WHERE kind='memory_echo'")).rows[0].n,1)
})

test('old or missing new-purpose grants never backfill originals or old comments, but human comments remain saved',async t=>{
 const f=await setup(t);await f.jobs.ingest(f.event({echoAiAuthorizationVersion:0}));assert.equal(f.deliveries.length,0)
 f.memory.version=2;await f.jobs.ingest(f.event());await f.run();const echo=(await f.store.feed(f.a,{},undefined,100))[0]
 f.accounts.get(f.a).aiTextProcessing.privateFeedProcessingAllowed=false
 const user=await f.store.comment(f.a,echo.id,randomUUID(),comment());assert(user.id);assert.equal(f.deliveries.length,1)
 f.accounts.get(f.a).aiTextProcessing.privateFeedProcessingAllowed=true;await f.store.feed(f.a,{},undefined,100);assert.equal(f.deliveries.length,1)
 f.memory.version=3;await f.jobs.ingest(f.event({echoAiAuthorizationVersion:1}));f.accounts.get(f.a).aiTextProcessing.authorizationVersion=2
 let called=false;await f.run(async()=>{called=true;return {text:'late'}});assert.equal(called,false)
 assert.equal((await f.jobs.get(f.a,f.deliveries.at(-1).jobId)).state,'blocked')
})

test('source edits/removal immediately retract old quote and descendants without waiting for events; dependency failures never allow cache',async t=>{
 const f=await setup(t),echo=await f.echo();const self=await f.store.comment(f.a,echo.id,randomUUID(),comment());await f.run();assert.equal((await f.store.comments(f.a,echo.id,undefined,100)).length,2)
 f.memory.version=2;assert.equal((await f.store.feed(f.a,{},undefined,100)).length,0);await assert.rejects(f.store.detail(f.a,echo.id),e=>e.status===404)
 await f.jobs.ingest(f.event());await f.run();const newer=(await f.store.feed(f.a,{},undefined,100))[0];assert.notEqual(newer.id,echo.id)
 const current=f.deps.validMemories;f.deps.validMemories=async()=>{throw Error('Dependency unavailable')};await assert.rejects(f.store.feed(f.a,{},undefined,100));f.deps.validMemories=current
 f.remove();await assert.rejects(f.store.detail(f.a,newer.id),e=>e.status===404)
})

test('late output is blocked by current exact AI grant, ABA movement, source deletion and cancellation',async t=>{
 const f=await setup(t)
 for(const mode of ['ai-withdraw','ai-regrant','aba','memory-delete','cancel']){
  const a=f.accounts.get(f.a);a.aiTextProcessing={allowed:true,authorizationVersion:1,privateFeedProcessingAllowed:true};f.memory.version++
  await f.jobs.ingest(f.event());const id=f.deliveries.at(-1).jobId
  await f.run(async()=>{if(mode==='ai-withdraw')a.aiTextProcessing.allowed=false;if(mode==='ai-regrant')a.aiTextProcessing.authorizationVersion=2;if(mode==='aba'){f.p.move();f.p.move()}if(mode==='memory-delete')f.memory.version++;if(mode==='cancel'){const job=await f.jobs.get(f.a,id);await f.jobs.command(f.a,id,randomUUID(),job.version,'cancel')}return {text:'绝不能提交的迟到内容'}})
  const row=(await f.pool.query('SELECT state,result_id FROM social_generation_jobs WHERE id=$1',[id])).rows[0];assert(['blocked','canceled'].includes(row.state),mode+':'+row.state);assert.equal(row.result_id,null)
 }
})

test('unrelated likes/comments do not veto a response; deleting an actual source retires all inherited AI descendants',async t=>{
 const f=await setup(t),echo=await f.echo(),first=await f.store.comment(f.a,echo.id,randomUUID(),comment())
 let unrelated
 await f.run(async()=>{await f.store.react(f.a,echo.id,randomUUID(),true);unrelated=await f.store.comment(f.a,echo.id,randomUUID(),comment('无关新评论'));return {text:'不因无关点赞丢弃的回答'}})
 await f.store.removeComment(f.a,echo.id,unrelated.id,randomUUID(),unrelated.version)
 let comments=await f.store.comments(f.a,echo.id,undefined,100),ai=comments.find(c=>c.author.kind==='persona');assert(ai)
 const second=await f.store.comment(f.a,echo.id,randomUUID(),comment('追问',ai.id));await f.run();assert.equal((await f.store.comments(f.a,echo.id,undefined,100)).length,4)
 await f.store.removeComment(f.a,echo.id,first.id,randomUUID(),first.version)
 comments=await f.store.comments(f.a,echo.id,undefined,100);assert.equal(comments.length,1);assert.equal(comments[0].id,second.id)
 const third=await f.store.comment(f.a,echo.id,randomUUID(),comment());await f.run(async()=>{await f.store.removeComment(f.a,echo.id,third.id,randomUUID(),third.version);return {text:'源删除后不可保存'}})
 assert.equal((await f.jobs.get(f.a,f.deliveries.at(-1).jobId)).state,'blocked')
})

test('generation HTTP preserves ownership, session, exact version, empty DTO and replay rules',async t=>{
 const f=await setup(t);await f.jobs.ingest(f.event());await f.run(async()=>{throw new EchoError('MODEL_REQUEST_FAILED',true)})
 const id=f.deliveries[0].jobId,b=f.account(),web='http://127.0.0.1:5184',app=await NestFactory.create(SocialModule.register({webOrigin:web,serviceToken:'a'.repeat(64),dataRightsToken:'b'.repeat(64)},f.store),{logger:false})
 app.use(socialHeaders);app.useGlobalFilters(new SocialErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close())
 const origin='http://127.0.0.1:'+app.getHttpServer().address().port,path='/v1/social-generation-jobs/'+id
 const call=async(p,method='GET',headers={},body,account=f.a)=>{const r=await fetch(origin+p,{method,headers:{Cookie:'test='+account,Origin:web,'X-Xijie-Expected-Session':account,...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});return {status:r.status,...await r.json()}}
 const failed=await call(path);assert.equal(failed.data.state,'failed');assert.equal((await call(path,'GET',{},undefined,b)).status,404)
 const key=randomUUID(),headers={'Idempotency-Key':key,'If-Match':'"v'+failed.data.version+'"'}
 assert.equal((await call(path+'/retry','POST',{...headers,Origin:'https://wrong.invalid'},{})).status,403)
 assert.equal((await call(path+'/retry','POST',{...headers,'If-Match':'"v999"'},{})).status,412)
 assert.equal((await call(path+'/retry','POST',headers,{personId:randomUUID()})).status,422)
 assert.equal((await call(path+'/retry','POST',headers,{})).data.state,'queued');assert.equal(f.deliveries.length,2)
 assert.equal((await call(path+'/retry','POST',headers,{})).data.state,'queued');assert.equal(f.deliveries.length,2)
 const queued=await f.jobs.get(f.a,id);f.accounts.get(f.a).storyStorage.allowed=false
 assert.equal((await call(path+'/cancel','POST',{'Idempotency-Key':randomUUID(),'If-Match':'"v'+queued.version+'"'},{})).data.state,'canceled')
})

test('queue failure rolls back source receipts and jobs, and explicit retries keep exact version/idempotency without a new grant',async t=>{
 const f=await setup(t);f.failQueue();await assert.rejects(f.jobs.ingest(f.event()));assert.equal((await f.pool.query('SELECT count(*)::int n FROM social_memory_receipts')).rows[0].n,0)
 const g=await setup(t);await g.jobs.ingest(g.event());await g.run(async()=>{throw new EchoError('MODEL_REQUEST_FAILED',true)})
 const id=g.deliveries[0].jobId,failed=await g.jobs.get(g.a,id),key=randomUUID();assert.equal(failed.failure.retryable,true)
 const queued=await g.jobs.command(g.a,id,key,failed.version,'retry');assert.equal(queued.state,'queued');await g.jobs.command(g.a,id,key,failed.version,'retry');assert.equal(g.deliveries.length,2)
 await g.run();assert.equal((await g.jobs.get(g.a,id)).state,'succeeded')
})

test('raw SQL rejects missing world authority and a generated echo bound to a different persona',async t=>{
 const f=await setup(t),echo=await f.echo();await assert.rejects(f.pool.query("UPDATE posts SET world_context_ref='{}' WHERE id=$1",[echo.id]),e=>e.code==='23514')
 await assert.rejects(f.pool.query('UPDATE posts SET person_id=$2 WHERE id=$1',[echo.id,randomUUID()]),e=>['23503','23514'].includes(e.code))
 await assert.rejects(f.pool.query('UPDATE posts SET body=$2 WHERE id=$1',[echo.id,'未经新来源的篡改']),e=>e.code==='23514')
})

test('echo detail never performs authority RPC while holding its repeatable-read transaction',async t=>{
 const f=await setup(t),echo=await f.echo(),connect=f.pool.connect.bind(f.pool);let inTransaction=0
 f.pool.connect=callback=>callback?connect(callback):connect().then(db=>{const query=db.query.bind(db),release=db.release.bind(db);db.query=async(sql,...values)=>{if(typeof sql==='string'&&sql.startsWith('BEGIN'))inTransaction++;const result=await query(sql,...values);if(typeof sql==='string'&&['COMMIT','ROLLBACK'].includes(sql))inTransaction--;return result};db.release=(...args)=>{db.query=query;db.release=release;release(...args)};return db})
 for(const name of ['persons','validMemories']){const original=f.deps[name];f.deps[name]=async(...args)=>{assert.equal(inTransaction,0,'RPC inside transaction: '+name);return original(...args)}}
 try{assert.equal((await f.store.detail(f.a,echo.id)).id,echo.id)}finally{f.pool.connect=connect}
})

test('erasure removes every real pg-boss generation after two explicit retries, including old retained dispatches',async t=>{
 const f=await setup(t),schema='social_queue_test_'+randomUUID().replaceAll('-',''),queue=await new EchoQueue(process.env.XIJIE_TEST_DATABASE_URL,schema).start()
 t.after(async()=>{await queue.stop();const clean=new pg.Pool({connectionString:process.env.XIJIE_TEST_DATABASE_URL});try{await clean.query('DROP SCHEMA '+schema+' CASCADE')}finally{await clean.end()}})
 f.jobs.queue=queue;f.store.queueSchema=schema;await f.jobs.ingest(f.event())
 const row=(await f.pool.query('SELECT * FROM social_generation_jobs')).rows[0],id=row.id
 const engine=new EchoEngine(f.jobs,{generate:async()=>{throw new EchoError('MODEL_REQUEST_FAILED',true)}})
 for(let i=0;i<2;i++){const current=(await f.pool.query('SELECT * FROM social_generation_jobs WHERE id=$1',[id])).rows[0];await engine.run({jobId:id,dispatchId:current.dispatch_id,dispatchGeneration:current.dispatch_generation});const failed=await f.jobs.get(f.a,id);await f.jobs.command(f.a,id,randomUUID(),failed.version,'retry')}
 assert.equal((await queue.boss.findJobs(ECHO_QUEUE,{data:{jobId:id},limit:10})).length,3)
 await new SocialDataRights(f.store).erase(f.a,f.request(f.a,'delete_account'))
 assert.equal((await queue.boss.findJobs(ECHO_QUEUE,{data:{jobId:id},limit:10})).length,0)
})

test('cancellation and lease takeover during slow authority I/O make zero provider calls',async t=>{
 for(const mode of ['cancel','takeover']){
  const f=await setup(t);await f.jobs.ingest(f.event());let release,entered;const waiting=new Promise(r=>{entered=r}),hold=new Promise(r=>{release=r}),source=f.deps.echoMemory;let first=true
  f.deps.echoMemory=async(...args)=>{if(first){first=false;entered();await hold}return source(...args)}
  let calls=0;const running=f.run(async()=>{calls++;return {text:'不可调用的模型'}});await waiting
  const dispatch=f.deliveries[0],id=dispatch.jobId
  if(mode==='cancel'){const job=await f.jobs.get(f.a,id);await f.jobs.command(f.a,id,randomUUID(),job.version,'cancel')}
  else{await f.pool.query("UPDATE social_generation_jobs SET lease_until=clock_timestamp()-interval '1 second',started_at=clock_timestamp()-interval '50 seconds' WHERE id=$1",[id]);assert(await f.jobs.claim(dispatch))}
  release();await running;assert.equal(calls,0)
 }
})

test('echo provenance exports independently of a new AI grant and erasure prevents an in-flight result restoring content',async t=>{
 const f=await setup(t),echo=await f.echo();await f.store.comment(f.a,echo.id,randomUUID(),comment());f.accounts.get(f.a).aiTextProcessing.allowed=false
 const rights=new SocialDataRights(f.store),exported=await rights.export(f.a,f.request(f.a),'account_data');assert.equal(exported.data.posts[0].sourceExcerpt,f.memory.body);assert(exported.data.generationJobs.length>=1)
 f.memory.version++;const without=await rights.export(f.a,f.request(f.a),'account_data');assert.equal(without.data.posts.length,0);assert.equal(JSON.stringify(without).includes(f.memory.body),false)
 f.accounts.get(f.a).aiTextProcessing.allowed=true;await f.jobs.ingest(f.event());await f.run(async()=>{await rights.erase(f.a,f.request(f.a,'delete_account'));return {text:'账号擦除后绝不能复活'}})
 for(const table of ['posts','post_comments','social_memory_sources','social_memory_receipts','social_generation_jobs'])assert.equal((await f.pool.query('SELECT count(*)::int n FROM '+table+' WHERE account_id=$1',[f.a])).rows[0].n,0)
 assert((await f.pool.query('SELECT erased_at FROM social_account_write_gates WHERE account_id=$1',[f.a])).rows[0].erased_at)
})
