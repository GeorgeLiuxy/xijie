import 'reflect-metadata'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,randomBytes} from 'node:crypto'
import {fork} from 'node:child_process'
import {once} from 'node:events'
import {NestFactory} from '@nestjs/core'
import {fixture,eventually} from './fixture.mjs'
import {letterInput} from '../dist/letters.js'
import {LetterEngine} from '../dist/letter-engine.js'
import {GenerationError} from '../dist/provider.js'
import {worldContextRevision} from '../dist/virtual-world.js'
import {ConversationsModule,ConversationErrors,conversationHeaders} from '../dist/http.js'
import {exportConversations,eraseConversations} from '../dist/data-rights.js'

const provenance={provider:'openai',model:'synthetic-intercept',responseId:'synthetic-response',promptVersion:'person-letter-replies-v1'}
const output={text:'合成测试回信。',provenance}
const input=(mode='none')=>({clientLetterId:randomUUID(),body:'合成原信，沿河散步。',replyMode:mode,...(mode==='next_morning'?{timeZone:'Asia/Shanghai'}:{})})
function enable(f,a){const account=f.accounts.get(a.id);account.letterStorage={allowed:true,authorizationVersion:1};account.letterReplies={allowed:true,authorizationVersion:1};f.people.get(a.person.id).worldVersion=1;f.dependencies.virtualWorld=async(accountId,personId)=>{const p=await f.dependencies.person(accountId,personId),v={accountId,personId,personVersion:p.version,worldVersion:p.worldVersion,reality:'virtual',branch:'main',currentWorld:{id:p.worldId,code:'courtyard',displayName:'合成庭院',catalogVersion:1,enabled:true},recentMovements:[]};return{...v,revision:worldContextRevision(v)}};return account}
const create=(f,a,value=input(),key=randomUUID())=>f.store.letters.create(a.id,a.person.id,key,value,randomUUID())
async function due(f,id){await f.pool.query("UPDATE letter_reply_jobs SET scheduled_at=clock_timestamp()-interval '1 second',next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);await f.pool.query('UPDATE letters SET reply_at=(SELECT scheduled_at FROM letter_reply_jobs WHERE id=$1) WHERE reply_job_id=$1',[id])}
async function server(t,f){const config={webOrigin:'http://localhost',serviceToken:randomBytes(32).toString('hex'),queueSchema:f.queueSchema};const app=await NestFactory.create(ConversationsModule.register(config,f.store),{logger:false});app.use(conversationHeaders);app.useGlobalFilters(new ConversationErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close());const origin=await app.getUrl();return async(a,path,method='GET',body,extra={})=>{const r=await fetch(origin+path,{method,headers:{Origin:config.webOrigin,Cookie:'xijie_dev_session='+a.credential,'X-Xijie-Expected-Session':a.sessionId,...(method!=='GET'?{'Idempotency-Key':randomUUID()}:{}),...(body?{'Content-Type':'application/json'}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,...await r.json()}}}

test('letters HTTP keeps one accepted intent, full revision pages, permissions and exact person ownership',async t=>{
 const f=await fixture(t),a=f.account(),b=f.account(),account=enable(f,a);enable(f,b);const read=await server(t,f),base='/v1/persons/'+a.person.id+'/letters',v=input('now'),key=randomUUID()
 account.aiTextProcessing={allowed:false,authorizationVersion:2}
 let r=await read(a,base,'POST',v,{'Idempotency-Key':key});assert.equal(r.status,201);const accepted=r.data;assert.equal(accepted.replyJobState,'queued')
 assert.equal((await read(a,base,'POST',v,{'Idempotency-Key':key})).data.id,accepted.id)
 assert.equal((await read(a,base,'POST',{...v,body:'different'},{'Idempotency-Key':key})).status,409)
 assert.equal((await read(a,base,'POST',v)).data.id,accepted.id,'clientLetterId survives a different command key')
 account.letterReplies={allowed:false,authorizationVersion:2};assert.equal((await read(a,base,'POST',v,{'Idempotency-Key':key})).data.id,accepted.id,'unknown accepted replay does not require AI again')
 assert.equal((await read(a,base,'POST',input('now'))).error.code,'LETTER_REPLY_PERMISSION_REQUIRED')
 account.storyStorage={allowed:false,authorizationVersion:2};const plain=await read(a,base,'POST',input());assert.equal(plain.status,201);assert.equal(plain.data.replyJobId,undefined)
 assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM letter_reply_jobs WHERE account_id=$1',[a.id])).rows[0].n,1)
 const page=await read(a,base+'?limit=1');assert.equal(page.data.length,1);assert(page.meta.nextCursor)
 const cursor=encodeURIComponent(page.meta.nextCursor);assert.equal((await read(a,base+'?limit=1&cursor='+cursor)).status,200)
 assert.equal((await read(a,base+'?limit=2&cursor='+cursor)).status,400);assert.equal((await read(b,'/v1/persons/'+b.person.id+'/letters?limit=1&cursor='+cursor)).status,400)
 assert.equal((await read(b,base+'/'+accepted.id)).status,404)
 const other={...a.person,id:randomUUID(),worldVersion:1};f.people.set(other.id,other);assert.equal((await read(a,'/v1/persons/'+other.id+'/letters/'+accepted.id)).status,404)
 await create(f,a);assert.equal((await read(a,base+'?limit=1&cursor='+cursor)).error.code,'SOURCE_CHANGED')
 for(const body of [{...input(),body:' '},{...input(),body:'x'.repeat(10001)},{...input(),body:'bad\0'},{...input(),replyMode:['none']},{...input(),replyMode:{toString:'none'}},{...input('next_morning'),timeZone:'Not/A_Zone'},{...input(),timeZone:'UTC'}])assert.equal((await read(a,base,'POST',body)).status,400)
 assert.equal((await read(a,base+'?limit=0')).status,400);assert.equal((await read(a,base+'?cursor=bad')).status,400)
 account.letterStorage={allowed:false,authorizationVersion:2};assert.equal((await read(a,base)).error.code,'LETTER_STORAGE_PERMISSION_REQUIRED')
 const removed=await read(a,base+'/'+plain.data.id,'DELETE',undefined,{'If-Match':'"v1"'});assert.equal(removed.status,200,'rights delete works after storage withdrawal')
})

test('home reply projection returns only the latest readable unread letter across owned people',async t=>{
 const f=await fixture(t),a=f.account(),b=f.account(),account=enable(f,a);enable(f,b)
 const read=await server(t,f),path='/v1/conversations/letters/unread'
 const other={...f.people.get(a.person.id),id:randomUUID()};f.people.set(other.id,other)
 const send=async owner=>{
  const sent=await create(f,owner,input('now'))
  await new LetterEngine(f.store.letters,{generate:async()=>output}).run(sent.replyJobId)
  return f.store.letters.get(owner.id,owner.person.id,sent.id)
 }
 assert.deepEqual((await read(a,path)).data,[])
 const first=await send(a),second=await send({...a,person:other}),foreign=await send(b)
 const expected=(item)=>({personId:item.personId,letterId:item.id,createdAt:item.reply.createdAt})
 const projection=await read(a,path)
 assert.equal(projection.status,200)
 assert.deepEqual(projection.data,[expected(second)])
 assert.deepEqual((await read(b,path)).data,[expected(foreign)])
 assert.equal((await read(a,path+'?personId='+b.person.id)).status,400)
 assert.equal((await read(a,path,'GET',undefined,{'X-Xijie-Expected-Session':b.sessionId})).status,401)
 const person=f.dependencies.person
 try{
  f.dependencies.person=async(...args)=>{
   const value=await person(...args)
   account.letterStorage={allowed:false,authorizationVersion:2}
   return value
  }
  assert.equal((await read(a,path)).error.code,'LETTER_STORAGE_PERMISSION_REQUIRED','withdrawal is rechecked after projection')
 }finally{
  f.dependencies.person=person
  account.letterStorage={allowed:true,authorizationVersion:3}
 }
 await f.store.letters.read(a.id,other.id,randomUUID(),second.reply.id)
 assert.deepEqual((await read(a,path)).data,[expected(first)])
 await f.store.letters.remove(a.id,a.person.id,first.id,randomUUID(),first.version,randomUUID())
 assert.deepEqual((await read(a,path)).data,[])
 account.letterStorage={allowed:false,authorizationVersion:4}
 assert.equal((await read(a,path)).error.code,'LETTER_STORAGE_PERMISSION_REQUIRED')
})

test('linked letters seal only the current owned reference and preserve idempotent accepted originals',async t=>{
 const f=await fixture(t),a=f.account(),b=f.account(),account=enable(f,a);enable(f,b)
 const peer={...f.people.get(a.person.id),id:randomUUID()};f.people.set(peer.id,peer)
 const ref={id:randomUUID(),version:2};let valid=true,checks=0
 f.dependencies.validateLetterMemory=async(accountId,personId,source)=>{checks++;return valid&&accountId===a.id&&personId===a.person.id&&source.id===ref.id&&source.version===ref.version}
 account.aiTextProcessing={allowed:false,authorizationVersion:2}
 const read=await server(t,f),route=p=>'/v1/persons/'+p.id+'/letters',base=route(a.person),value={...input(),sourceMemory:ref},key=randomUUID()
 for(const sourceMemory of [null,[],{...ref,body:'unexpected'},{id:ref.id,version:0},{id:ref.id,version:2147483648}])assert.equal((await read(a,base,'POST',{...value,sourceMemory})).status,400)
 assert.equal((await read(a,base,'POST',{...value,sourceMemory:{...ref,version:1}})).error.code,'LETTER_MEMORY_SOURCE_CHANGED')
 assert.equal((await read(a,route(peer),'POST',value)).error.code,'LETTER_MEMORY_SOURCE_CHANGED')
 assert.equal((await read(b,route(b.person),'POST',value)).error.code,'LETTER_MEMORY_SOURCE_CHANGED')
 const accepted=await read(a,base,'POST',value,{'Idempotency-Key':key});assert.equal(accepted.status,201);assert.deepEqual(accepted.data.sourceMemory,ref)
 valid=false
 assert.equal((await read(a,base,'POST',value,{'Idempotency-Key':key})).data.id,accepted.data.id)
 assert.equal((await read(a,base,'POST',value)).data.id,accepted.data.id)
 assert.equal((await read(a,base,'POST',{...value,sourceMemory:{...ref,version:3}},{'Idempotency-Key':key})).error.code,'IDEMPOTENCY_CONFLICT')
 assert.deepEqual((await read(a,base+'/'+accepted.data.id)).data.sourceMemory,ref)
 assert.equal(checks,4,'accepted replays and history do not reauthorize the historical source')
 assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM letters')).rows[0].n,1)
})

test('linked replies recheck the exact reference before dispatch and at commit, and retain committed letters',async t=>{
 const f=await fixture(t),a=f.account(),account=enable(f,a),ref={id:randomUUID(),version:1}
 let version=1,calls=0;const link=mode=>({...input(mode),sourceMemory:ref})
 f.dependencies.validateLetterMemory=async(accountId,personId,source)=>accountId===a.id&&personId===a.person.id&&source.id===ref.id&&source.version===version
 const early=await create(f,a,link('now')),scheduled=await create(f,a,link('next_morning'))
 version=2
 const engine=new LetterEngine(f.store.letters,{generate:async()=>{calls++;return output}})
 await engine.run(early.replyJobId);await f.store.letters.reconcile()
 for(const item of [early,scheduled]){
  const current=await f.store.letters.get(a.id,a.person.id,item.id)
  assert.equal(current.replyJobState,'blocked');assert.deepEqual(current.failure,{code:'LETTER_MEMORY_SOURCE_CHANGED',retryable:false});assert.equal(current.reply,undefined);assert.equal(current.body,item.body)
 }
 assert.equal(calls,0)
 version=1
 const pending=await create(f,a,link('now'))
 await new LetterEngine(f.store.letters,{generate:async call=>{calls++;assert.deepEqual(call.letter,{id:pending.id,body:pending.body,version:1});assert.equal(call.sourceMemory,undefined);assert.equal(call.memories,undefined);version=0;return output}}).run(pending.replyJobId)
 const interrupted=await f.store.letters.get(a.id,a.person.id,pending.id)
 assert.equal(interrupted.failure.code,'LETTER_MEMORY_SOURCE_CHANGED');assert.equal(interrupted.reply,undefined)
 version=1
 const committed=await create(f,a,link('now'));await engine.run(committed.replyJobId);assert.equal(calls,2)
 version=0;account.storyStorage={allowed:false,authorizationVersion:2}
 const old=await f.store.letters.get(a.id,a.person.id,committed.id);assert.equal(old.reply.body,output.text);assert.equal(old.body,committed.body)
 const exported=await exportConversations(f.pool,f.dependencies,a.id,'interaction_data')
 assert.equal(exported.data.letters.find(l=>l.id===committed.id).source_memory_id,ref.id)
 assert.equal(exported.data.letters.find(l=>l.id===committed.id).source_memory_version,ref.version)
 const independent=await create(f,a);assert.equal(independent.sourceMemory,undefined)
})

test('PostgreSQL schedules the first actual local 08:00 strictly after acceptance including skipped dates',async t=>{
 const f=await fixture(t),db=await f.pool.connect()
 try{
 for(const [at,zone,expected]of[
  ['2026-11-12T23:59:59.999Z','Asia/Shanghai','2026-11-13T00:00:00.000Z'],
  ['2026-11-13T00:00:00.000Z','Asia/Shanghai','2026-11-14T00:00:00.000Z'],
  ['2026-03-08T06:59:00.000Z','America/New_York','2026-03-08T12:00:00.000Z'],
  ['2011-12-30T09:00:00.000Z','Pacific/Apia','2011-12-30T18:00:00.000Z'],
 ])assert.equal((await f.store.letters.schedule(db,'next_morning',zone,new Date(at))).replyAt.toISOString(),expected)
 await assert.rejects(f.store.letters.schedule(db,'next_morning','Not/A_Zone'),{code:'INVALID_ARGUMENT'})
 assert.throws(()=>letterInput({...input(),body:'\ud800'}),{code:'INVALID_ARGUMENT'})
 }finally{db.release()}
})

test('future letter is not claimed early, current profile is captured at execution, and reply commits once without chat side effects',async t=>{
 const f=await fixture(t),a=f.account();enable(f,a);const sent=await create(f,a,input('next_morning'));let calls=0
 const engine=new LetterEngine(f.store.letters,{async generate(v){calls++;assert.equal(v.person.displayName,'Edited before due');assert.equal(v.letter.body,sent.body);assert.equal(v.messages,undefined);assert.equal(v.memories,undefined);return output}})
 await engine.run(sent.replyJobId);assert.equal(calls,0)
 const p=f.people.get(a.person.id);p.displayName='Edited before due';p.version++
 await due(f,sent.replyJobId);await engine.run(sent.replyJobId);await engine.run(sent.replyJobId);assert.equal(calls,1)
 const current=await f.store.letters.get(a.id,a.person.id,sent.id);assert.equal(current.version,2);assert.equal(current.reply.sequence,'1');assert.equal(current.unread,true);assert.equal(current.replyJobState,'succeeded')
 const job=await f.store.letters.find(sent.replyJobId);assert.equal(job.attempt_id,null);assert.equal(job.person_context_ref.version,2);assert.deepEqual(job.provider_provenance,provenance)
 assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM messages')).rows[0].n,0);assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM generation_jobs')).rows[0].n,0)
 assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM outbox_events WHERE type='LetterReplyCommitted.v1'")).rows[0].n,1)
})

test('reply read cursor follows committed sequence rather than original letter order and never consumes a later arrival',async t=>{
 const f=await fixture(t),a=f.account();enable(f,a);const old=await create(f,a,input('now')),newer=await create(f,a,input('now')),engine=new LetterEngine(f.store.letters,{generate:async()=>output})
 await engine.run(newer.replyJobId);await engine.run(old.replyJobId)
 const group=await f.store.letters.snapshot(a.id,a.person.id);assert.equal(group.items[0].id,newer.id);assert.deepEqual(group.items.map(v=>v.reply.sequence),['1','2'])
 const oldReply=group.items[1].reply.id,newReply=group.items[0].reply.id,key=randomUUID()
 await f.store.letters.read(a.id,a.person.id,key,oldReply)
 const late=await create(f,a,input('now'));await engine.run(late.replyJobId)
 await f.store.letters.read(a.id,a.person.id,randomUUID(),newReply);const repeated=await f.store.letters.read(a.id,a.person.id,key,oldReply);assert.equal(repeated.lastReadReplyId,oldReply)
 assert.equal((await f.store.letters.get(a.id,a.person.id,late.id)).unread,true);assert.equal((await f.store.letters.get(a.id,a.person.id,old.id)).unread,false)
 await assert.rejects(f.store.letters.read(a.id,a.person.id,key,newReply),{code:'IDEMPOTENCY_CONFLICT'})
})

test('future withdrawal/regrant, provider-stage permission and source changes terminate without restoring old tasks',async t=>{
 const f=await fixture(t)
 for(const mode of ['future-regrant','storage','story','reply','person','deleted-letter','deleted-person'])await t.test(mode,async()=>{
  const a=f.account(),account=enable(f,a),sent=await create(f,a,input(mode==='future-regrant'?'next_morning':'now'));let calls=0
  if(mode==='future-regrant'){account.letterReplies={allowed:true,authorizationVersion:3};await f.store.letters.reconcile();assert.equal((await f.store.letters.find(sent.replyJobId)).state,'blocked');return}
  const engine=new LetterEngine(f.store.letters,{async generate(){calls++;if(mode==='storage')account.letterStorage={allowed:false,authorizationVersion:2};if(mode==='story')account.storyStorage={allowed:true,authorizationVersion:3};if(mode==='reply')account.letterReplies={allowed:true,authorizationVersion:3};if(mode==='person')f.people.get(a.person.id).version++;if(mode==='deleted-letter')await f.store.letters.remove(a.id,a.person.id,sent.id,randomUUID(),1,randomUUID());if(mode==='deleted-person')f.people.delete(a.person.id);return output}})
  await engine.run(sent.replyJobId);assert.equal(calls,1);assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM letter_replies WHERE letter_id=$1',[sent.id])).rows[0].n,0)
  const j=await f.store.letters.find(sent.replyJobId);assert.equal(j.state,mode==='deleted-letter'?'canceled':'blocked');assert.equal(j.attempt_id,null);assert.equal(j.lease_until,null)
 })
})

test('temporary model failures, graceful stop and expired leases recover within a three-attempt budget',async t=>{
 const f=await fixture(t),a=f.account();enable(f,a);const sent=await create(f,a,input('now'));let calls=0
 const engine=new LetterEngine(f.store.letters,{async generate(){calls++;throw new GenerationError('MODEL_REQUEST_FAILED',true)}})
 for(let i=1;i<=3;i++){await due(f,sent.replyJobId);await engine.run(sent.replyJobId);const j=await f.store.letters.find(sent.replyJobId);assert.equal(j.state,i===3?'failed':'queued');assert.equal(j.attempt_count,i);assert.equal(j.attempt_id,null)}
 await engine.run(sent.replyJobId);assert.equal(calls,3)
 const graceful=await create(f,a,input('now'));let started=false;const stopping=new LetterEngine(f.store.letters,{generate:async v=>{started=true;return new Promise((resolve,reject)=>v.signal.addEventListener('abort',()=>reject(new Error('stop')),{once:true}))}})
 const running=stopping.run(graceful.replyJobId);await eventually(()=>started);stopping.stop();await running;assert.equal((await f.store.letters.find(graceful.replyJobId)).state,'queued')
 await due(f,graceful.replyJobId);const lease=await f.store.letters.claim(graceful.replyJobId);await f.pool.query("UPDATE letter_reply_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[lease.id]);await f.store.letters.reconcile();assert.equal((await f.store.letters.find(lease.id)).state,'queued')
 await due(f,graceful.replyJobId);await new LetterEngine(f.store.letters,{generate:async()=>output}).run(graceful.replyJobId);assert.equal((await f.store.letters.find(lease.id)).state,'succeeded')
})

test('letter export is consent-independent and erasure removes queued work and fences a late model result',async t=>{
 const f=await fixture(t),a=f.account(),account=enable(f,a),sent=await create(f,a,input('now'));await new LetterEngine(f.store.letters,{generate:async()=>output}).run(sent.replyJobId)
 const pending=await create(f,a,input('now')),held=await f.store.letters.claim(pending.replyJobId)
 account.letterStorage={allowed:false,authorizationVersion:2};account.letterReplies={allowed:false,authorizationVersion:2}
 const exported=await exportConversations(f.pool,f.dependencies,a.id,'interaction_data');assert.equal(exported.data.letters.length,2);assert.equal(exported.data.letterReplies.length,1);assert.equal(exported.data.letterReplyJobs.length,2);assert.equal(exported.data.letterReadCursors.length,1)
 await eraseConversations(f.pool,f.queueSchema,a.id,randomUUID())
 for(const table of ['letters','letter_reply_jobs','letter_replies','letter_read_cursors','conversation_commands','outbox_events'])assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM '+table+' WHERE account_id=$1',[a.id])).rows[0].n,0)
 assert.equal((await f.pool.query(`SELECT count(*)::int AS n FROM "${f.queueSchema}".job WHERE data->>'jobId'=ANY($1::text[])`,[[sent.replyJobId,pending.replyJobId]])).rows[0].n,0)
 await assert.rejects(f.store.letters.complete(held,output.text,provenance,a.person,{}),{code:'NOT_FOUND'})
 account.letterStorage={allowed:true,authorizationVersion:3};await assert.rejects(create(f,a),{code:'NOT_FOUND'})
})

test('complete letter snapshot rejects excess count and bytes rather than returning partial history',async t=>{
 const f=await fixture(t),a=f.account();enable(f,a);await f.pool.query(`INSERT INTO letters(id,account_id,person_id,client_letter_id,request_hash,body,reply_mode,account_access_version,storage_authorization_version) SELECT gen_random_uuid(),$1,$2,gen_random_uuid(),repeat('a',64),'synthetic','none',1,1 FROM generate_series(1,1001)`,[a.id,a.person.id]);await assert.rejects(f.store.letters.snapshot(a.id,a.person.id),{code:'LETTER_HISTORY_TOO_LARGE'})
 await f.pool.query('DELETE FROM letters WHERE account_id=$1',[a.id]);await f.pool.query(`INSERT INTO letters(id,account_id,person_id,client_letter_id,request_hash,body,reply_mode,account_access_version,storage_authorization_version) SELECT gen_random_uuid(),$1,$2,gen_random_uuid(),repeat('a',64),repeat('中',10000),'none',1,1 FROM generate_series(1,300)`,[a.id,a.person.id]);await assert.rejects(f.store.letters.snapshot(a.id,a.person.id),{code:'LETTER_HISTORY_TOO_LARGE'})
})

test('real letter queue survives a killed process and commits through a fresh bounded attempt',async t=>{
 const f=await fixture(t),a=f.account();enable(f,a);const sent=await create(f,a,input('now'))
 const child=fork(new URL('./letter-crash-worker.mjs',import.meta.url),[],{silent:true,execArgv:[],env:{...process.env,LETTER_CRASH_SCHEMA:f.schema,LETTER_CRASH_QUEUE_SCHEMA:f.queueSchema,LETTER_CRASH_CONTEXT:JSON.stringify({account:f.accounts.get(a.id),person:f.people.get(a.person.id),world:await f.dependencies.virtualWorld(a.id,a.person.id)})}})
 const timeout=setTimeout(()=>child.kill('SIGKILL'),10000);t.after(()=>{clearTimeout(timeout);if(child.exitCode===null)child.kill('SIGKILL')})
 assert.equal((await once(child,'message'))[0].stage,'model-started');const held=await f.store.letters.find(sent.replyJobId)
 const exited=once(child,'exit');child.kill('SIGKILL');await exited;clearTimeout(timeout)
 await f.pool.query("UPDATE letter_reply_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[sent.replyJobId])
 await f.pool.query('UPDATE '+f.queueSchema+".job SET started_on=clock_timestamp()-interval '2 minutes' WHERE data->>'jobId'=$1",[sent.replyJobId])
 let calls=0;await f.queue.workLetters(id=>new LetterEngine(f.store.letters,{generate:async()=>{calls++;return output}}).run(id))
 await eventually(async()=>{await f.queue.boss.supervise();return(await f.store.letters.find(sent.replyJobId)).state==='succeeded'})
 const recovered=await f.store.letters.find(sent.replyJobId);assert.equal(recovered.attempt_count,2);assert.equal(recovered.attempt_id,null);assert.equal(calls,1)
 assert.equal(await f.store.letters.complete(held,output.text,provenance,f.people.get(a.person.id),await f.dependencies.virtualWorld(a.id,a.person.id)).catch(e=>e.code),'NOT_FOUND','old attempt source version cannot commit again')
 assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM letter_replies WHERE letter_id=$1',[sent.id])).rows[0].n,1)
})

test('withdrawal during final People RPC or persisted context capture cannot leak a read or dispatch a model',async t=>{
 const f=await fixture(t),a=f.account(),account=enable(f,a),sent=await create(f,a,input('now')),original=f.dependencies.person
 let reads=0
 f.dependencies.person=async(...args)=>{const value=await original(...args);if(++reads===2)account.letterStorage={allowed:false,authorizationVersion:2};return value}
 await assert.rejects(f.store.letters.snapshot(a.id,a.person.id),{code:'LETTER_STORAGE_PERMISSION_REQUIRED'})
 account.letterStorage={allowed:true,authorizationVersion:1};f.dependencies.person=original
 const store=f.store.letters,capture=store.capture.bind(store);let calls=0
 store.capture=async(...args)=>{const result=await capture(...args);account.letterReplies={allowed:false,authorizationVersion:2};return result}
 await new LetterEngine(store,{generate:async()=>{calls++;return output}}).run(sent.replyJobId)
 assert.equal(calls,0);assert.equal((await store.find(sent.replyJobId)).state,'blocked')
})

test('future permission reconciliation advances beyond the first fifty schedules without treating outages as revocation',async t=>{
 const f=await fixture(t),a=f.account(),account=enable(f,a)
 for(let i=0;i<51;i++)await create(f,a,input('next_morning'))
 const last=(await f.pool.query('SELECT id FROM letter_reply_jobs WHERE account_id=$1 ORDER BY id DESC LIMIT 1',[a.id])).rows[0].id
 assert.equal(f.store.letters,f.store.letters,'the worker retains its bounded audit cursor')
 await f.store.letters.reconcile()
 account.letterReplies={allowed:false,authorizationVersion:2}
 const original=f.dependencies.account;f.dependencies.account=async()=>{throw new (await import('../dist/contracts.js')).ConversationError(503,'DEPENDENCY_UNAVAILABLE','Synthetic outage')}
 await f.store.letters.reconcile();assert.equal((await f.store.letters.find(last)).state,'queued')
 f.dependencies.account=original
 await f.store.letters.reconcile();await f.store.letters.reconcile()
 assert.equal((await f.store.letters.find(last)).state,'blocked')
 assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM letter_reply_jobs WHERE account_id=$1 AND state='queued'",[a.id])).rows[0].n,0)
})

test('shutdown while claim is awaiting cannot begin a later model transmission',async t=>{
 const f=await fixture(t),a=f.account();enable(f,a);const sent=await create(f,a,input('now')),store=f.store.letters,claim=store.claim.bind(store)
 let release,claimed=false,calls=0
 store.claim=async id=>{const value=await claim(id);claimed=true;await new Promise(resolve=>{release=resolve});return value}
 const engine=new LetterEngine(store,{generate:async()=>{calls++;return output}}),running=engine.run(sent.replyJobId)
 await eventually(()=>claimed);engine.stop();release();await running
 const job=await store.find(sent.replyJobId);assert.equal(calls,0);assert.equal(job.state,'queued');assert.equal(job.failure_code,'WORKER_INTERRUPTED');assert.equal(job.attempt_id,null)
})
