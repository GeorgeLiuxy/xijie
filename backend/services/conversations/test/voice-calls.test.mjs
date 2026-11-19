import 'reflect-metadata'
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {once} from 'node:events'
import {randomUUID,randomBytes} from 'node:crypto'
import {NestFactory} from '@nestjs/core'
import WebSocket from 'ws'
import {fixture} from './fixture.mjs'
import {ConversationsModule,ConversationErrors,conversationHeaders} from '../dist/http.js'
import {VoiceCallStore} from '../dist/voice-store.js'
import {VoiceHub} from '../dist/voice-hub.js'
import {exportConversations,eraseConversations} from '../dist/data-rights.js'

test('real call HTTP/WebSocket state comes only from the provider and fences permissions, grants, audio, teardown and erasure',async t=>{
 const f=await fixture(t),a=f.account(),other=f.account(),cookie='xijie_dev_session='+a.credential,foreign='xijie_dev_session='+other.credential,grant={allowed:true,authorizationVersion:1}
 f.accounts.get(a.id).voiceCalls=grant;f.sessions.get(a.credential).voiceCalls=grant
 const conversation=(await f.store.ensure(a.id,a.person.id,randomUUID())).conversation.id,config={serviceToken:randomBytes(32).toString('hex'),webOrigin:'http://127.0.0.1:1'},settings={enabled:true,model:'gpt-realtime-2.1',maxSeconds:60},calls=new VoiceCallStore(f.store,settings,config.serviceToken),connections=[],budgets=[]
 const provider={available(){},connect(input,callbacks){const record={input,callbacks,audio:[],interrupts:0};connections.push(record);return{audio:bytes=>record.audio.push(bytes),interrupt:()=>record.interrupts++,close:()=>queueMicrotask(()=>callbacks.closed(true)),terminate:()=>queueMicrotask(()=>callbacks.closed(false))}}}
 const hub=new VoiceHub(calls,provider,config,{claim:async input=>budgets.push(input),finish:async id=>{}}),app=await NestFactory.create(ConversationsModule.register(config,f.store,hub),{logger:false,abortOnError:false});app.use(conversationHeaders);app.useGlobalFilters(new ConversationErrors());await app.listen(0,'127.0.0.1');config.webOrigin=await app.getUrl();await hub.attach(app.getHttpServer())
 const headers={Origin:config.webOrigin,Cookie:cookie,'X-Xijie-Expected-Session':a.sessionId,'Content-Type':'application/json'}
 const post=async(path,body={},key=randomUUID(),extra={})=>fetch(config.webOrigin+path,{method:'POST',headers:{...headers,'Idempotency-Key':key,...extra},body:JSON.stringify(body)})
 const read=async id=>(await(await fetch(config.webOrigin+'/v1/call-sessions/'+id,{headers})).json()).data
 const until=async(id,state)=>{for(let i=0;i<100;i++){const value=await read(id);if(value?.state===state)return value;await new Promise(r=>setTimeout(r,30))}throw new Error('Call did not reach '+state)}
 let client
 try{
  const key=randomUUID(),created=await post('/v1/conversations/'+conversation+'/call-sessions',{mode:'voice'},key);assert.equal(created.status,201);const call=(await created.json()).data;assert.equal(call.state,'created');assert.equal(call.startedAt,null);assert.equal(call.durationSeconds,null)
  assert.equal((await(await post('/v1/conversations/'+conversation+'/call-sessions',{mode:'voice'},key)).json()).data.id,call.id)
  assert.equal((await post('/v1/conversations/'+conversation+'/call-sessions',{mode:'voice'})).status,409)
  assert.equal((await post('/v1/conversations/'+conversation+'/call-sessions',{mode:'video'})).status,400)
  assert.equal((await fetch(config.webOrigin+'/v1/call-sessions/'+call.id,{headers:{Cookie:foreign,'X-Xijie-Expected-Session':other.sessionId}})).status,404)
  const grantResponse=await post('/v1/call-sessions/'+call.id+'/grants'),access=(await grantResponse.json()).data;assert.equal(grantResponse.status,200);assert.equal(new URL(access.url).search,'');assert.equal(access.url.includes(access.token),false)
  client=new WebSocket(access.url,['xijie.voice.v1','xijie.grant.'+access.token],{headers:{Cookie:cookie,Origin:config.webOrigin}});await once(client,'open');assert.equal(client.protocol,'xijie.voice.v1');await until(call.id,'connecting');assert.equal((await read(call.id)).startedAt,null);assert.equal(connections.length,1);assert.equal(budgets.length,1)
  await connections[0].callbacks.ready({sessionId:'sess_test_provider',model:settings.model,voice:'marin'});const connected=await until(call.id,'connected');assert.ok(connected.startedAt);assert.equal(connected.durationSeconds,null)
  client.send(Buffer.from([1,0,2,0]));await new Promise(r=>setTimeout(r,25));assert.deepEqual(connections[0].audio,[Buffer.from([1,0,2,0])])
  client.send(JSON.stringify({type:'mute',muted:true}));await new Promise(r=>setTimeout(r,20));client.send(Buffer.from([3,0,4,0]));const pong=once(client,'pong');client.ping();await pong;assert.equal(connections[0].audio.length,1)
  const received=once(client,'message');connections[0].callbacks.audio(Buffer.from([5,0,6,0]));const [bytes,binary]=await received;assert.equal(binary,true);assert.deepEqual(bytes,Buffer.from([5,0,6,0]))
  const stop=await post('/v1/call-sessions/'+call.id+'/end');assert.equal(stop.status,200);assert.equal((await stop.json()).data.state,'ending');const ended=await until(call.id,'ended');assert.ok(ended.endedAt);assert.equal(ended.durationSeconds,Math.floor((Date.parse(ended.endedAt)-Date.parse(ended.startedAt))/1000))
  const exported=await exportConversations(f.pool,f.dependencies,a.id,'interaction_data');assert.equal(exported.data.callSessions.length,1);assert.equal(JSON.stringify(exported).includes(access.token),false);assert.equal(JSON.stringify(exported).includes('token_cipher'),false)
  const next=(await(await post('/v1/conversations/'+conversation+'/call-sessions',{mode:'voice'})).json()).data,nextGrant=(await(await post('/v1/call-sessions/'+next.id+'/grants')).json()).data
  client=new WebSocket(nextGrant.url,['xijie.voice.v1','xijie.grant.'+nextGrant.token],{headers:{Cookie:cookie,Origin:config.webOrigin}});await once(client,'open');await until(next.id,'connecting');await connections[1].callbacks.ready({sessionId:'sess_second_provider',model:settings.model,voice:'marin'});await until(next.id,'connected')
  grant.allowed=false;await until(next.id,'ended');grant.allowed=true;assert.equal((await read(next.id)).voice,'marin')
  const third=(await(await post('/v1/conversations/'+conversation+'/call-sessions',{mode:'voice'})).json()).data;await f.pool.query("UPDATE call_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[third.id]);await calls.recover();const expired=await read(third.id);assert.equal(expired.state,'expired');assert.equal(expired.durationSeconds,null)
  await eraseConversations(f.pool,f.queueSchema,a.id,randomUUID());assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM call_sessions WHERE account_id=$1',[a.id])).rows[0].n,0);assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM call_grants WHERE account_id=$1',[a.id])).rows[0].n,0)
  await assert.rejects(calls.create(cookie,a.sessionId,conversation,randomUUID()))
 }finally{client?.terminate();await hub.close();await app.close()}
})
