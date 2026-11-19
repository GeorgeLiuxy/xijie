// Explicit manual browser harness. It runs only with a supplied isolated test DB;
// no production entry imports it and it never calls a real model or user account.
import 'reflect-metadata'
import {writeFile,mkdir} from 'node:fs/promises'
import {randomBytes} from 'node:crypto'
import {NestFactory} from '@nestjs/core'
import {fixture} from './fixture.mjs'
import {ConversationsModule,ConversationErrors,conversationHeaders} from '../dist/http.js'
import {VoiceCallStore} from '../dist/voice-store.js'
import {VoiceHub} from '../dist/voice-hub.js'
const cleanup=[],f=await fixture({after:fn=>cleanup.push(fn)}),a=f.account(),grant={allowed:true,authorizationVersion:1};f.accounts.get(a.id).voiceCalls=grant;f.sessions.get(a.credential).voiceCalls=grant
const model='gpt-realtime-2.1',counts={inputBytes:0,outputBytes:0,interrupts:0,providerConnections:0},settings={enabled:true,model,maxSeconds:60},config={serviceToken:randomBytes(32).toString('hex'),webOrigin:'http://127.0.0.1:5198'}
const provider={available(){},connect(_input,callbacks){counts.providerConnections++;let ended=false;const output=Buffer.alloc(4800);for(let i=0;i<2400;i++)output.writeInt16LE(Math.round(Math.sin(i*Math.PI/32)*1200),i*2);const send=()=>{if(!ended){counts.outputBytes+=output.length;callbacks.audio(output)}};setTimeout(()=>{void callbacks.ready({sessionId:'sess_browser_synthetic',model,voice:'marin'}).then(()=>{if(!ended){send();callbacks.caption?.('合成协议验证声音','resp_browser_synthetic')}}).catch(()=>callbacks.failed('SYNTHETIC_SETUP_FAILED'))},40);return{audio(bytes){counts.inputBytes+=bytes.length;send()},interrupt(){counts.interrupts++},close(){if(!ended){ended=true;queueMicrotask(()=>callbacks.closed(true))}},terminate(){if(!ended){ended=true;queueMicrotask(()=>callbacks.closed(false))}}}}}
const calls=new VoiceCallStore(f.store,settings,config.serviceToken),hub=new VoiceHub(calls,provider,config,{claim:async()=>{},finish:async()=>{}}),app=await NestFactory.create(ConversationsModule.register(config,f.store,hub),{logger:false,abortOnError:false})
app.use(conversationHeaders);app.useGlobalFilters(new ConversationErrors())
app.use('/__fixture/status',async(_req,res)=>res.json({counts,calls:(await f.pool.query('SELECT id,state,started_at,ended_at FROM call_sessions ORDER BY created_at')).rows}))
const closeToken=randomBytes(32).toString('base64url');let closing=false
app.use('/__fixture/shutdown',(req,res)=>{if(req.method!=='POST'||req.headers['x-fixture-close']!==closeToken)return res.status(403).end();res.json({closing:true});if(!closing){closing=true;void(async()=>{await hub.close();await app.close();for(const run of cleanup)await run()})()}})
await app.listen(0,'127.0.0.1');await hub.attach(app.getHttpServer());const origin=await app.getUrl(),conversation=(await f.store.ensure(a.id,a.person.id,crypto.randomUUID())).conversation.id
await mkdir(new URL('../../../../.tmp/voice-browser-check/',import.meta.url),{recursive:true})
await writeFile(new URL('../../../../.tmp/voice-browser-check/context.json',import.meta.url),JSON.stringify({origin,closeToken,accountId:a.id,sessionId:a.sessionId,personId:a.person.id,conversationId:conversation,cookie:'xijie_dev_session='+a.credential}))
console.log('Isolated voice browser fixture is ready; provider audio is synthetic.')
