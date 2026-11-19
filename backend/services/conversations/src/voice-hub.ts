import {randomUUID} from 'node:crypto'
import type {Server,IncomingMessage} from 'node:http'
import WebSocket,{WebSocketServer} from 'ws'
import type {ConversationConfig} from './config.js'
import {VoiceCallStore,callDto,type CallRow} from './voice-store.js'
import {VoiceError,type VoiceProvider,type VoiceTransport} from './voice-provider.js'
import {claimVoiceExecution,finishVoiceExecution} from '../../../runtime/model-execution.mjs'

export class VoiceHub{
 readonly owner=randomUUID()
 private readonly sockets=new Set<()=>Promise<void>>()
 private server?:WebSocketServer
 private sweep?:NodeJS.Timeout
 constructor(readonly calls:VoiceCallStore,readonly provider:VoiceProvider,readonly config:ConversationConfig,private readonly budget={claim:claimVoiceExecution,finish:finishVoiceExecution}){}
 async prepare(cookie:string,expected:string|undefined,conversation:string,key:string){const session=await this.calls.store.dependencies.session(cookie,expected);this.provider.available(session.accountId);await this.calls.recover();return this.calls.create(cookie,expected,conversation,key)}
 async attach(server:Server){
  await this.calls.recover();const wss=new WebSocketServer({noServer:true,maxPayload:24576,perMessageDeflate:false,handleProtocols:protocols=>protocols.has('xijie.voice.v1')?'xijie.voice.v1':false});this.server=wss
  const upgrade=(request:IncomingMessage,socket:any,head:Buffer)=>{void(async()=>{
   const url=new URL(request.url??'/',this.config.webOrigin),match=/^\/v1\/call-sessions\/([0-9a-f-]{36})\/stream$/.exec(url.pathname)
   if(!match){socket.destroy();return}
   if(url.search||request.headers.origin!==this.config.webOrigin)throw new VoiceError(403,'FORBIDDEN')
   const protocols=String(request.headers['sec-websocket-protocol']??'').split(',').map(s=>s.trim())
   if(protocols.length!==2||protocols[0]!=='xijie.voice.v1'||!/^xijie\.grant\.[A-Za-z0-9_-]{43}$/.test(protocols[1]))throw new VoiceError(403,'CALL_GRANT_INVALID')
   const cookie=request.headers.cookie??'',row=await this.calls.claim(cookie,match[1],protocols[1].slice('xijie.grant.'.length),this.owner)
   try{this.provider.available(row.account_id);await this.budget.claim({accountId:row.account_id,jobId:row.id,attemptId:row.attempt_id!})}catch(error){await this.calls.finish(row,false,'VOICE_PERMISSION_OR_BUDGET_REQUIRED');throw error}
   if(socket.destroyed){await this.calls.finish(row,false,'VOICE_CLIENT_LEFT');await this.budget.finish(row.attempt_id!).catch(()=>{});return}
   try{wss.handleUpgrade(request,socket,head,client=>{void this.run(cookie,row,client)})}catch(error){await this.calls.finish(row,false,'VOICE_CLIENT_LEFT');await this.budget.finish(row.attempt_id!).catch(()=>{});throw error}
  })().catch(()=>{if(!socket.destroyed){socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy()}})}
  server.on('upgrade',upgrade)
  this.sweep=setInterval(()=>{void this.calls.recover().catch(()=>console.error('Voice call recovery was interrupted.'))},2000).unref()
  server.once('close',()=>{server.off('upgrade',upgrade);clearInterval(this.sweep)})
 }
 private async run(cookie:string,initial:CallRow,client:WebSocket){
  let row=initial,transport:VoiceTransport|undefined,stopping=false,finished=false,reason='VOICE_CONNECTION_INTERRUPTED',monitoring=false,muted=false,alive=true,bytesWindow=0,windowStart=Date.now(),authorizedAt=Date.now()
  const send=(value:unknown)=>{if(client.readyState===WebSocket.OPEN&&client.bufferedAmount<524288)client.send(JSON.stringify(value))}
  let timer:NodeJS.Timeout|undefined,force:NodeJS.Timeout|undefined,limit:NodeJS.Timeout|undefined,authWatch:NodeJS.Timeout|undefined
  const complete=async(confirmed:boolean)=>{
   if(finished)return;finished=true;stopping=true;clearInterval(timer);clearInterval(authWatch);clearTimeout(force);clearTimeout(limit)
   try{const saved=await this.calls.finish(row,confirmed,reason);if(saved)send({type:'state',call:callDto(saved)})}catch{/* Source erasure never recreates a record. */}
   await this.budget.finish(row.attempt_id!).catch(()=>{})
   if(client.readyState===WebSocket.OPEN)client.close(1000)
   this.sockets.delete(shutdown)
  }
  const stop=(why:string)=>{if(stopping)return;stopping=true;reason=why;if(!['user_hangup','VOICE_TIME_LIMIT'].includes(why))send({type:'error',code:why});if(!transport){void complete(false);return}force=setTimeout(()=>{transport?.terminate();void complete(false)},3000).unref();transport.close()}
  const shutdown=async()=>{stop('VOICE_SERVER_STOPPED');await new Promise<void>(resolve=>{const timer=setInterval(()=>{if(finished){clearInterval(timer);resolve()}},25);setTimeout(()=>{clearInterval(timer);resolve()},3500).unref()})}
  this.sockets.add(shutdown)
  client.on('pong',()=>{alive=true})
  client.on('close',()=>stop('user_hangup'));client.on('error',()=>stop('VOICE_CLIENT_CONNECTION_LOST'))
  client.on('message',(raw,binary)=>{
   if(stopping)return
   if(binary){
    if(Date.now()-authorizedAt>3000){stop('VOICE_AUTHORIZATION_STALE');return}
    if(row.started_at&&Date.now()>=row.started_at.getTime()+row.max_seconds*1000){stop('VOICE_TIME_LIMIT');return}
    const bytes=Buffer.isBuffer(raw)?raw:Buffer.from(raw as ArrayBuffer)
    if(!bytes.length||bytes.length>24000||bytes.length%2){stop('VOICE_AUDIO_INVALID');return}
    if(Date.now()-windowStart>=1000){windowStart=Date.now();bytesWindow=0}bytesWindow+=bytes.length;if(bytesWindow>96000){stop('VOICE_AUDIO_RATE_EXCEEDED');return}
    if(!muted&&row.state==='connected')transport?.audio(bytes);return
   }
   let control:any;try{control=JSON.parse(raw.toString())}catch{stop('VOICE_CONTROL_INVALID');return}
   if(control?.type==='mute'&&typeof control.muted==='boolean'&&Object.keys(control).length===2){muted=control.muted;send({type:'muted',muted});return}
   if(control?.type==='interrupt'&&Object.keys(control).length===1){transport?.interrupt();send({type:'interrupted'});return}
   if(control?.type==='end'&&Object.keys(control).length===1){stop('user_hangup');return}
   stop('VOICE_CONTROL_INVALID')
  })
  try{
   const person=await this.calls.source(cookie,row)
   if(client.readyState!==WebSocket.OPEN||!row.lease_until||row.lease_until.getTime()<=Date.now()){stop('VOICE_CLIENT_LEFT');return}
   authorizedAt=Date.now()
   transport=this.provider.connect({accountId:row.account_id,person},{
    ready:async source=>{if(stopping||client.readyState!==WebSocket.OPEN||source.model!==row.model||source.voice!==row.voice)throw new VoiceError(409,'VOICE_CLIENT_LEFT');row=await this.calls.connected(cookie,row,source.sessionId);authorizedAt=Date.now();if(stopping)throw new VoiceError(409,'CALL_ALREADY_ENDED');limit=setTimeout(()=>stop('VOICE_TIME_LIMIT'),Math.max(1,row.started_at!.getTime()+row.max_seconds*1000-Date.now())).unref();send({type:'state',call:callDto(row)})},
    audio:bytes=>{if(stopping||row.state!=='connected')return;if(Date.now()-authorizedAt>3000){stop('VOICE_AUTHORIZATION_STALE');return}if(row.started_at&&Date.now()>=row.started_at.getTime()+row.max_seconds*1000){stop('VOICE_TIME_LIMIT');return}if(client.bufferedAmount>524288){stop('VOICE_CLIENT_TOO_SLOW');return}if(client.readyState===WebSocket.OPEN)client.send(bytes,{binary:true})},
    speech:phase=>{if(!stopping)send({type:phase==='started'?'listening':'thinking'})},
    caption:(delta,responseId)=>{if(Date.now()-authorizedAt>3000){stop('VOICE_AUTHORIZATION_STALE');return}if(!stopping&&row.state==='connected')send({type:'caption',delta,responseId})},
    failed:code=>stop(code),closed:confirmed=>{void complete(confirmed)},
   })
   authWatch=setInterval(()=>{if(!stopping&&Date.now()-authorizedAt>3000)stop('VOICE_AUTHORIZATION_STALE')},250).unref()
   timer=setInterval(()=>{void(async()=>{
    if(stopping||monitoring)return;monitoring=true
    try{
     const current=await this.calls.beat(cookie,row)
     authorizedAt=Date.now()
     if(current.state==='ending'){stop('user_hangup');return}
     if(!['connecting','connected'].includes(current.state)||current.attempt_id!==row.attempt_id||current.server_owner!==this.owner){stop('VOICE_CONTEXT_CHANGED');return}
     row=current
     if(row.started_at&&Date.now()>=row.started_at.getTime()+row.max_seconds*1000){stop('VOICE_TIME_LIMIT');return}
     if(!alive){stop('VOICE_CLIENT_CONNECTION_LOST');return}alive=false;client.ping()
    }catch{stop('VOICE_CONTEXT_CHANGED')}finally{monitoring=false}
   })()},2000).unref()
  }catch{stop('VOICE_CONTEXT_CHANGED')}
 }
 async close(){clearInterval(this.sweep);await Promise.all([...this.sockets].map(stop=>stop()));this.server?.close()}
}
