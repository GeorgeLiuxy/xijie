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

test('live voice enforces its actual deadline and stale authorization watchdog, and rejects forged client connection state',async t=>{
 const f=await fixture(t),a=f.account(),grant={allowed:true,authorizationVersion:1};f.accounts.get(a.id).voiceCalls=grant;f.sessions.get(a.credential).voiceCalls=grant
 const cookie='xijie_dev_session='+a.credential,conversation=(await f.store.ensure(a.id,a.person.id,randomUUID())).conversation.id,config={serviceToken:randomBytes(32).toString('hex'),webOrigin:'http://127.0.0.1:1'},settings={enabled:true,model:'gpt-realtime-2.1',maxSeconds:1},calls=new VoiceCallStore(f.store,settings,config.serviceToken),connections=[]
 const provider={available(){},connect(_input,callbacks){connections.push(callbacks);return{audio(){},interrupt(){},close:()=>queueMicrotask(()=>callbacks.closed(true)),terminate:()=>queueMicrotask(()=>callbacks.closed(false))}}},hub=new VoiceHub(calls,provider,config,{claim:async()=>{},finish:async()=>{}}),app=await NestFactory.create(ConversationsModule.register(config,f.store,hub),{logger:false,abortOnError:false});app.use(conversationHeaders);app.useGlobalFilters(new ConversationErrors());await app.listen(0,'127.0.0.1');config.webOrigin=await app.getUrl();await hub.attach(app.getHttpServer());const headers={Origin:config.webOrigin,Cookie:cookie,'X-Xijie-Expected-Session':a.sessionId,'Content-Type':'application/json'},post=async(path,body={})=>(await(await fetch(config.webOrigin+path,{method:'POST',headers:{...headers,'Idempotency-Key':randomUUID()},body:JSON.stringify(body)})).json()).data,until=async check=>{for(let i=0;i<250;i++){const result=await check();if(result)return result;await new Promise(r=>setTimeout(r,25))}throw Error('Expected trusted state was not observed')},row=async id=>(await f.pool.query('SELECT * FROM call_sessions WHERE id=$1',[id])).rows[0];let client;const session=f.dependencies.session
 const begin=async()=>{const call=await post('/v1/conversations/'+conversation+'/call-sessions',{mode:'voice'}),access=await post('/v1/call-sessions/'+call.id+'/grants');client=new WebSocket(access.url,['xijie.voice.v1','xijie.grant.'+access.token],{headers:{Cookie:cookie,Origin:config.webOrigin}});await once(client,'open');await until(()=>connections.length&&row(call.id).then(v=>v.state==='connecting'));return call}
 try{
  const limited=await begin();await connections[0].ready({sessionId:'sess_limited',model:settings.model,voice:'marin'});const ended=await until(async()=>{const value=await row(limited.id);return value.state==='ended'?value:null});assert.equal(ended.stop_reason,'VOICE_TIME_LIMIT');assert.ok(ended.started_at&&ended.ended_at);assert.ok(ended.ended_at-ended.started_at>=950&&ended.ended_at-ended.started_at<4000)
  settings.maxSeconds=60;const stalled=await begin();await until(()=>connections.length===2);await connections[1].ready({sessionId:'sess_auth_stalled',model:settings.model,voice:'marin'});f.dependencies.session=async()=>new Promise(()=>{});const closed=await until(async()=>{const value=await row(stalled.id);return value.state==='ended'?value:null});assert.equal(closed.stop_reason,'VOICE_AUTHORIZATION_STALE');assert.ok(closed.ended_at-closed.started_at>=2900&&closed.ended_at-closed.started_at<6000);f.dependencies.session=session
  const forged=await begin();await until(()=>connections.length===3);client.send(JSON.stringify({type:'state',state:'connected',startedAt:new Date().toISOString()}));const rejected=await until(async()=>{const value=await row(forged.id);return value.state==='failed'?value:null});assert.equal(rejected.started_at,null);assert.equal(rejected.ended_at,null);assert.equal(rejected.failure_code,'VOICE_CONTROL_INVALID');await assert.rejects(connections[2].ready({sessionId:'sess_late_forged',model:settings.model,voice:'marin'}));assert.equal((await row(forged.id)).state,'failed')
 }finally{f.dependencies.session=session;client?.terminate();await hub.close();await app.close()}
})
