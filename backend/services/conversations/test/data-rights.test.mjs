import 'reflect-metadata'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { NestFactory } from '@nestjs/core'
import { fixture, text } from './fixture.mjs'
import { ConversationsModule, ConversationErrors, conversationHeaders } from '../dist/http.js'
import { exportConversations, eraseConversations } from '../dist/data-rights.js'
import { GenerationEngine } from '../dist/engine.js'

test('conversation data rights enforce request scope, full queue erasure and stale-worker fencing',async t=>{
  const f=await fixture(t),a=f.account(),b=f.account(),token=randomBytes(32).toString('hex'),serviceToken=randomBytes(32).toString('hex')
  const ca=(await f.store.ensure(a.id,a.person.id,randomUUID())).conversation.id,cb=(await f.store.ensure(b.id,b.person.id,randomUUID())).conversation.id
  const first=await f.store.send(a.id,ca,randomUUID(),text('Synthetic visible original'),randomUUID())
  const hidden=await f.store.send(a.id,ca,randomUUID(),text('Synthetic removed original'),randomUUID())
  const other=await f.store.send(b.id,cb,randomUUID(),text('Other account private text'),randomUUID())
  await f.store.removeMessage(a.id,ca,hidden.message.id,randomUUID(),hidden.message.version,randomUUID())
  const contexts=new Map();let malformed=false
  const identity=createServer((req,res)=>{
    assert.equal(req.headers.authorization,'Bearer '+serviceToken)
    const requestId=new URL(req.url,'http://localhost').pathname.split('/')[4],data=contexts.get(requestId)
    res.writeHead(data?200:404,{'Content-Type':'application/json'});res.end(JSON.stringify(malformed?{data:{}}:{data}))
  });identity.listen(0,'127.0.0.1');await once(identity,'listening')
  const config={identityOrigin:'http://127.0.0.1:'+identity.address().port,serviceToken,dataRightsServiceToken:token,queueSchema:f.queueSchema,webOrigin:'http://localhost',sessionCookie:'xijie_dev_session'}
  const app=await NestFactory.create(ConversationsModule.register(config,f.store),{logger:false,abortOnError:false})
  app.use(conversationHeaders);app.useGlobalFilters(new ConversationErrors());await app.listen(0,'127.0.0.1');const origin=await app.getUrl()
  t.after(async()=>{await app.close();identity.closeAllConnections();await new Promise(r=>identity.close(r))})
  const requestId=randomUUID();contexts.set(requestId,{requestId,accountId:a.id,kind:'export',scope:'interaction_data',status:'processing',accountStatus:'active',accountAccessVersion:1})
  const auth={Authorization:'Bearer '+token}
  const exportURL=(account=a.id,request=requestId,scope='interaction_data')=>origin+'/internal/v1/accounts/'+account+'/data-export?requestId='+request+'&scope='+scope
  const erase=(account,request,key=request)=>fetch(origin+'/internal/v1/accounts/'+account+'/erase',{method:'POST',headers:{...auth,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({requestId:request})})
  await t.test('internal endpoints reject foreign callers, wrong request ownership and malformed authority',async()=>{
    assert.equal((await fetch(exportURL())).status,403)
    assert.equal((await fetch(exportURL(),{headers:{Authorization:'Bearer '+serviceToken}})).status,403)
    assert.equal((await fetch(exportURL(b.id),{headers:auth})).status,403)
    assert.equal((await fetch(exportURL(a.id,randomUUID()),{headers:auth})).status,404)
    assert.equal((await fetch(exportURL(a.id,requestId,'account_data'),{headers:auth})).status,403)
    assert.equal((await fetch(exportURL()+'&requestId='+requestId,{headers:auth})).status,400)
    malformed=true;assert.equal((await fetch(exportURL(),{headers:auth})).status,503);malformed=false
    assert.equal((await erase(a.id,requestId)).status,403)
  })
  await t.test('export hashes actual visible text and references, independently from capture time',async()=>{
    const response=await fetch(exportURL(),{headers:auth});assert.equal(response.status,200);const original=(await response.json()).data
    assert.equal(original.domain,'conversations');assert.equal(original.schemaVersion,1)
    assert.equal(original.data.messages.length,1);assert.equal(original.data.messages[0].id,first.message.id)
    assert.equal(original.data.messages[0].text,'Synthetic visible original');assert.equal(original.data.conversations[0].personId,a.person.id)
    assert.equal(original.revision,createHash('sha256').update(JSON.stringify(original.data)).digest('hex'))
    assert.equal((await exportConversations(f.pool,f.dependencies,a.id,'interaction_data')).revision,original.revision)
    for(const term of ['Other account private text','Synthetic removed original','request_hash','authorization_version','attempt_id'])assert.equal(JSON.stringify(original).includes(term),false)
    const update=await f.store.send(a.id,ca,randomUUID(),text('Later visible text'),randomUUID())
    assert.notEqual((await exportConversations(f.pool,f.dependencies,a.id,'account_data')).revision,original.revision)
    await f.store.removeMessage(a.id,ca,update.message.id,randomUUID(),update.message.version,randomUUID())
    f.people.delete(a.person.id)
    assert.deepEqual((await exportConversations(f.pool,f.dependencies,a.id,'interaction_data')).data,{callSessions:[],storyBranches:[],storyMessages:[],storyJobs:[],storyEvents:[],offlineLifePlans:[],offlineLifeRuns:[],conversations:[],messages:[],messageMedia:[],photoReplyJobs:[],worldEvents:[],worldActionJobs:[],letters:[],letterReplies:[],letterReplyJobs:[],letterReadCursors:[],gatherReplyJobs:[],gatherReplyParticipants:[],gatherReplySlots:[]})
    f.people.set(a.person.id,a.person)
  })
  let held
  await t.test('erase removes physical dispatches, cyclic job/message references and all private caches atomically',async()=>{
    held=await f.store.claim(first.generationJobId);assert.ok(held)
    const deletion=randomUUID();contexts.set(deletion,{requestId:deletion,accountId:a.id,kind:'delete_account',scope:'account_data',status:'processing',accountStatus:'deletion_pending',accountAccessVersion:2})
    assert.equal((await erase(a.id,deletion,randomUUID())).status,400)
    assert.ok((await f.pool.query(`SELECT id FROM "${f.queueSchema}".job WHERE data->>'jobId'=$1`,[first.generationJobId])).rowCount)
    const response=await erase(a.id,deletion);assert.equal(response.status,200);const erased=(await response.json()).data
    assert.equal(erased.alreadyErased,false)
    const repeated=(await (await erase(a.id,deletion)).json()).data;assert.equal(repeated.alreadyErased,true);assert.equal(repeated.erasedAt,erased.erasedAt)
    for(const table of ['conversations','messages','generation_jobs','conversation_commands','outbox_events'])assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM '+table+' WHERE account_id=$1',[a.id])).rows[0].n,0,table)
    assert.equal((await f.pool.query(`SELECT id FROM "${f.queueSchema}".job WHERE data->>'jobId'=$1`,[first.generationJobId])).rowCount,0)
    assert.ok((await f.pool.query(`SELECT id FROM "${f.queueSchema}".job WHERE data->>'jobId'=$1`,[other.generationJobId])).rowCount)
    assert.equal((await f.store.messages(b.id,cb,'older',undefined,100))[0].text,'Other account private text')
    await assert.rejects(exportConversations(f.pool,f.dependencies,a.id,'interaction_data'),{code:'NOT_FOUND'})
  })
  await t.test('old actor and worker snapshots cannot restore an erased account',async()=>{
    await assert.rejects(f.store.ensure(a.id,a.person.id,randomUUID()),{code:'42501'})
    let calls=0;const engine=new GenerationEngine(f.store,{generate:async()=>{calls++;return {text:'Must not happen'}}})
    await engine.run(first.generationJobId);assert.equal(calls,0)
    assert.equal(await f.store.complete(held,'A stale model result','Synthetic person',[]),false)
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM messages WHERE account_id=$1',[a.id])).rows[0].n,0)
  })
  await t.test('RR transactions opened before deletion fail instead of seeing an obsolete live gate',async()=>{
    const account=f.account();await f.store.ensure(account.id,account.person.id,randomUUID());const stale=await f.pool.connect()
    try{
      await stale.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await stale.query('SELECT * FROM account_erasure_fences WHERE account_id=$1',[account.id])
      await eraseConversations(f.pool,f.queueSchema,account.id,randomUUID())
      await assert.rejects(stale.query('INSERT INTO conversations(account_id,person_id) VALUES($1,$2)',[account.id,account.person.id]),error=>['40001','42501'].includes(error.code))
    }finally{await stale.query('ROLLBACK');stale.release()}
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM conversations WHERE account_id=$1',[account.id])).rows[0].n,0)
  })
  await t.test('oversized history is rejected explicitly rather than truncated',async()=>{
    const account=f.account(),cid=(await f.store.ensure(account.id,account.person.id,randomUUID())).conversation.id
    await f.pool.query("INSERT INTO messages(account_id,conversation_id,sequence,author_kind,text,client_message_id) SELECT $1,$2,n,'self',repeat('x',4000),gen_random_uuid() FROM generate_series(1,5400) n",[account.id,cid])
    await assert.rejects(exportConversations(f.pool,f.dependencies,account.id,'interaction_data'),{status:413,code:'EXPORT_TOO_LARGE'})
  })
})
