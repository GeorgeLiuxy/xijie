import {useEffect,useRef,useState} from 'react'
import {fmtTime,isZh,useI18n} from './i18n'
import {nid,type Msg} from './model'

export type VoiceCallContext={accountId:string;sessionId:string;personId:string;conversationId?:string;onUnauthorized:()=>void}
export type VoiceCall={id:string;conversationId:string;personId:string;mode:'voice';state:'created'|'connecting'|'connected'|'ending'|'ended'|'failed'|'expired';version:number;createdAt:string;expiresAt:string;startedAt:string|null;endedAt:string|null;durationSeconds:number|null;endsBy?:string;maxSeconds:number;model:string;voice:'marin'|'coral'|'cedar';failure?:{code:string}}
type Intent={accountId:string;sessionId:string;personId:string;ensureKey:string;createKey:string;grantKey:string;endKey:string;callId?:string;conversationId?:string}
class VoiceRequestError extends Error{constructor(readonly status:number,readonly code:string){super(code)}}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const terminal=(call:VoiceCall)=>['ended','failed','expired'].includes(call.state)
const storageKey=(c:VoiceCallContext)=>'xijie.voice-call.intent.v1.'+c.accountId+'.'+c.sessionId+'.'+c.personId
function intent(c:VoiceCallContext):Intent{try{const value=JSON.parse(sessionStorage.getItem(storageKey(c))??'null');if(value?.accountId===c.accountId&&value.sessionId===c.sessionId&&value.personId===c.personId&&['ensureKey','createKey','grantKey','endKey'].every(k=>uuid.test(value[k]))&&(!value.callId||uuid.test(value.callId)))return value}catch{}return{accountId:c.accountId,sessionId:c.sessionId,personId:c.personId,ensureKey:crypto.randomUUID(),createKey:crypto.randomUUID(),grantKey:crypto.randomUUID(),endKey:crypto.randomUUID()}}
function remember(c:VoiceCallContext,value?:Intent){try{if(value)sessionStorage.setItem(storageKey(c),JSON.stringify(value));else sessionStorage.removeItem(storageKey(c))}catch{}}
function validCall(v:VoiceCall){return!!v&&uuid.test(v.id)&&uuid.test(v.conversationId)&&uuid.test(v.personId)&&v.mode==='voice'&&['marin','coral','cedar'].includes(v.voice)&&['created','connecting','connected','ending','ended','failed','expired'].includes(v.state)&&Number.isInteger(v.version)&&v.version>0&&Number.isFinite(Date.parse(v.createdAt))&&Number.isFinite(Date.parse(v.expiresAt))&&(v.startedAt===null||Number.isFinite(Date.parse(v.startedAt)))&&(v.endedAt===null||v.startedAt!==null&&Number.isFinite(Date.parse(v.endedAt)))&&(v.durationSeconds===null||v.startedAt!==null&&v.endedAt!==null&&v.durationSeconds===Math.floor((Date.parse(v.endedAt)-Date.parse(v.startedAt))/1000))}
async function request<T>(c:VoiceCallContext,path:string,signal:AbortSignal,init:RequestInit={},envelope=false):Promise<T>{
 signal.throwIfAborted()
 const headers=new Headers(init.headers);headers.set('X-Xijie-Expected-Session',c.sessionId)
 const response=await fetch(path,{...init,headers,signal:AbortSignal.any([signal,AbortSignal.timeout(10000)]),credentials:'same-origin',cache:'no-store',redirect:'error'}),body=await response.json().catch(()=>null)
 signal.throwIfAborted()
 if(!response.ok){if(response.status===401)c.onUnauthorized();throw new VoiceRequestError(response.status,body?.error?.code??'VOICE_UNAVAILABLE')}
 if(body?.data===undefined)throw new VoiceRequestError(502,'INVALID_RESPONSE');return(envelope?body:body.data) as T
}
const captureCode=`class VoiceCapture extends AudioWorkletProcessor{constructor(){super();this.phase=0;this.buffer=[]}process(inputs){const channel=inputs[0]&&inputs[0][0];if(channel){const step=sampleRate/24000;for(let i=0;i<channel.length;i++){this.phase+=1;if(this.phase>=step){this.phase-=step;this.buffer.push(Math.max(-1,Math.min(1,channel[i])));if(this.buffer.length===2400){const bytes=new ArrayBuffer(4800),view=new DataView(bytes);for(let j=0;j<this.buffer.length;j++)view.setInt16(j*2,Math.round(this.buffer[j]*32767),true);this.port.postMessage(bytes,[bytes]);this.buffer=[]}}}}return true}}registerProcessor('xijie-voice-capture',VoiceCapture)`

export function useVoiceCall(service:VoiceCallContext|undefined){
 const {lang}=useI18n(),zh=isZh(lang),[call,setCall]=useState<VoiceCall>(),[phase,setPhase]=useState<'primer'|'connecting'|'listening'|'thinking'|'replying'>('primer'),[error,setError]=useState(''),[caption,setCaption]=useState(''),[muted,setMutedState]=useState(false),[loud,setLoudState]=useState(true),[seconds,setSeconds]=useState(0),[busy,setBusy]=useState(false)
 const lifetime=useRef<AbortController|null>(null),socket=useRef<WebSocket|null>(null),microphone=useRef<MediaStream|null>(null),audio=useRef<AudioContext|null>(null),gain=useRef<GainNode|null>(null),processor=useRef<AudioWorkletNode|null>(null),sources=useRef(new Set<AudioBufferSourceNode>()),playAt=useRef(0),mutedRef=useRef(false),current=useRef<Intent|undefined>(undefined),record=useRef<VoiceCall|undefined>(undefined),captionId=useRef(''),working=useRef(false),scope=useRef(service);scope.current=service
 const revision=useRef(0)
 const key=service?storageKey(service):''
 const clearPlayback=()=>{for(const source of sources.current){try{source.stop()}catch{}}sources.current.clear();playAt.current=0}
 const stopMedia=()=>{microphone.current?.getTracks().forEach(track=>track.stop());microphone.current=null;processor.current?.disconnect();processor.current=null;clearPlayback();if(audio.current)void audio.current.close().catch(()=>{});audio.current=null;gain.current=null;socket.current?.close(1000);socket.current=null}
 const message=(problem:unknown)=>{
  if(problem instanceof DOMException&&problem.name==='NotAllowedError')return zh?'没有开启麦克风。请在设备设置中允许西界使用麦克风，再试一次。':'Microphone access is off. Allow Elysium to use it in your device settings, then retry.'
  if(problem instanceof DOMException&&['NotFoundError','NotReadableError'].includes(problem.name))return zh?'暂时无法使用麦克风，可以先发文字消息。':'The microphone is unavailable. You can send a text message instead.'
  if(problem instanceof VoiceRequestError){
   if(['VOICE_CALL_PERMISSION_REQUIRED','STORAGE_PERMISSION_REQUIRED','AI_PERMISSION_REQUIRED'].includes(problem.code))return zh?'这次通话暂时无法开始。请到「我」里的「隐私与 AI 说明」查看同意状态；如果已同意，请稍后再试。':'The call cannot start. Review your agreement in Me → Privacy & AI. If you already agreed, try again later.'
   if(['VOICE_CALLS_DISABLED','MODEL_NOT_CONFIGURED','MODEL_EXECUTION_UNAVAILABLE'].includes(problem.code))return zh?'AI 语音通话暂时不可用，可以先发文字消息。':'AI voice calls are unavailable right now. You can send a text message instead.'
   if(problem.code==='MODEL_BUDGET_EXCEEDED')return zh?'暂时无法开始更多通话，请稍后再试。':'No more calls can start right now. Please try again later.'
  }
  return zh?'通话暂时未能完成，请再试一次。':'The call could not complete. Please try again.'
 }
 function accept(value:VoiceCall){if(!service||!validCall(value)||value.personId!==service.personId||current.current?.callId&&value.id!==current.current.callId)throw new VoiceRequestError(502,'INVALID_RESPONSE');record.current=value;setCall(value);if(terminal(value)){stopMedia();setBusy(false);setPhase('primer');remember(service);window.dispatchEvent(new CustomEvent('xijie:call-records-changed',{detail:{conversationId:value.conversationId}}))}}
 useEffect(()=>{
  revision.current++;const controller=new AbortController();lifetime.current=controller;current.current=service?intent(service):undefined;record.current=undefined;setCall(undefined);setPhase('primer');setCaption('');setError('');setMutedState(false);mutedRef.current=false;setSeconds(0);working.current=false;setBusy(false)
  let polling=false
  const read=async()=>{if(!service||!current.current?.callId||polling||controller.signal.aborted)return;polling=true;try{const wanted=current.current.callId,value=await request<VoiceCall>(service,'/v1/call-sessions/'+wanted,controller.signal);if(!controller.signal.aborted&&current.current?.callId===wanted){if(terminal(value)&&!record.current){remember(service);current.current=undefined;setCall(undefined)}else accept(value)}}catch(e){if(!controller.signal.aborted){setError(message(e));if(e instanceof VoiceRequestError&&[401,403,404].includes(e.status)){stopMedia();setPhase('primer')}}}finally{polling=false}}
  void read();const timer=window.setInterval(()=>{void read()},1500)
  const erased=(event:Event)=>{if((event as CustomEvent<{accountId?:string}>).detail?.accountId===service?.accountId){stopMedia();remember(service!);controller.abort()}}
  window.addEventListener('xijie:private-drafts-erased',erased)
  return()=>{controller.abort();window.clearInterval(timer);window.removeEventListener('xijie:private-drafts-erased',erased);stopMedia();const saved=current.current,prior=record.current;if(service&&saved?.callId&&prior&&!terminal(prior)){void fetch('/v1/call-sessions/'+saved.callId+'/end',{method:'POST',credentials:'same-origin',keepalive:true,headers:{'Content-Type':'application/json','X-Xijie-Expected-Session':service.sessionId,'Idempotency-Key':saved.endKey},body:'{}'}).catch(()=>{})}}
 },[key])
 useEffect(()=>{if(!call?.startedAt||terminal(call)){setSeconds(call?.durationSeconds??0);return}const update=()=>setSeconds(Math.max(0,Math.min(call.maxSeconds,Math.floor((Date.now()-Date.parse(call.startedAt!))/1000))));update();const timer=window.setInterval(update,1000);return()=>window.clearInterval(timer)},[call?.id,call?.startedAt,call?.state,call?.durationSeconds])
 async function start(){
  if(!service||working.current||!lifetime.current||lifetime.current.signal.aborted)return
  working.current=true;setBusy(true);setError('');setCaption('');const attemptRevision=revision.current,signal=lifetime.current.signal,live=()=>!signal.aborted&&scope.current?.sessionId===service.sessionId&&scope.current?.personId===service.personId
  try{
   window.speechSynthesis?.cancel();stopMedia();if(record.current&&terminal(record.current)){current.current=undefined;remember(service)}const saved=current.current??intent(service);current.current=saved;remember(service,saved)
   const context=new AudioContext({sampleRate:24000});audio.current=context;await context.resume();const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});if(!live()){stream.getTracks().forEach(t=>t.stop());return}microphone.current=stream
   if(!saved.conversationId){const detail=await request<{id:string}>(service,'/v1/conversations',signal,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':saved.ensureKey},body:JSON.stringify({kind:'direct',personId:service.personId})});if(!live())return;if(!uuid.test(detail.id))throw new VoiceRequestError(502,'INVALID_RESPONSE');saved.conversationId=detail.id;remember(service,saved)}
   let value:VoiceCall
   if(saved.callId)value=await request<VoiceCall>(service,'/v1/call-sessions/'+saved.callId,signal)
   else{value=await request<VoiceCall>(service,'/v1/conversations/'+saved.conversationId+'/call-sessions',signal,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':saved.createKey},body:JSON.stringify({mode:'voice'})});if(!live())return;if(!validCall(value))throw new VoiceRequestError(502,'INVALID_RESPONSE');saved.callId=value.id;remember(service,saved)}
   if(!live())return;accept(value);if(value.state!=='created'||Date.parse(value.expiresAt)<=Date.now())throw new VoiceRequestError(409,'CALL_NOT_JOINABLE')
   const access=await request<{url:string;token:string;expiresAt:string}>(service,'/v1/call-sessions/'+value.id+'/grants',signal,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':saved.grantKey},body:'{}'})
   if(Number.isFinite(Date.parse(access.expiresAt))&&Date.parse(access.expiresAt)<=Date.now()){saved.grantKey=crypto.randomUUID();remember(service,saved);throw new VoiceRequestError(409,'CALL_GRANT_EXPIRED')}
   const url=new URL(access.url),origin=new URL(location.origin);origin.protocol=origin.protocol==='https:'?'wss:':'ws:'
   if(url.origin!==origin.origin||url.pathname!=='/v1/call-sessions/'+value.id+'/stream'||url.search||url.hash||! /^[A-Za-z0-9_-]{43}$/.test(access.token)||Date.parse(access.expiresAt)<=Date.now())throw new VoiceRequestError(502,'INVALID_RESPONSE')
   const blob=URL.createObjectURL(new Blob([captureCode],{type:'text/javascript'}));try{await context.audioWorklet.addModule(blob)}finally{URL.revokeObjectURL(blob)}if(!live())return
   const output=context.createGain();output.gain.value=loud?1:0;output.connect(context.destination);gain.current=output
   const ws=new WebSocket(url.href,['xijie.voice.v1','xijie.grant.'+access.token]);ws.binaryType='arraybuffer';socket.current=ws;setPhase('connecting')
   const capture=new AudioWorkletNode(context,'xijie-voice-capture');processor.current=capture;const silent=context.createGain();silent.gain.value=0;context.createMediaStreamSource(stream).connect(capture);capture.connect(silent).connect(context.destination)
   capture.port.onmessage=event=>{if(live()&&!mutedRef.current&&ws.readyState===WebSocket.OPEN&&record.current?.state==='connected'&&ws.bufferedAmount<24000)ws.send(event.data)}
   ws.onmessage=event=>{
    if(!live())return
    if(event.data instanceof ArrayBuffer){if(record.current?.state!=='connected'||event.data.byteLength%2)return;const raw=new DataView(event.data),buffer=context.createBuffer(1,event.data.byteLength/2,24000),channel=buffer.getChannelData(0);for(let i=0;i<channel.length;i++)channel[i]=raw.getInt16(i*2,true)/32768;if(playAt.current-context.currentTime>15){clearPlayback();ws.send(JSON.stringify({type:'interrupt'}));return}const source=context.createBufferSource();source.buffer=buffer;source.connect(output);sources.current.add(source);source.onended=()=>{sources.current.delete(source);if(!sources.current.size&&live())setPhase('listening')};const when=Math.max(context.currentTime+0.02,playAt.current);source.start(when);playAt.current=when+buffer.duration;setPhase('replying');return}
    let eventData:any;try{eventData=JSON.parse(event.data)}catch{return}
    if(eventData.type==='state'){try{accept(eventData.call);if(eventData.call.state==='connected'){setPhase('listening');setBusy(false)}}catch{setError(message(null));stopMedia()}return}
    if(eventData.type==='caption'&&typeof eventData.delta==='string'){if(captionId.current!==eventData.responseId){captionId.current=eventData.responseId;setCaption('')}setCaption(prior=>(prior+eventData.delta).slice(-6000));return}
    if(eventData.type==='listening'||eventData.type==='thinking'){setPhase(eventData.type);if(eventData.type==='listening')clearPlayback();return}
    if(eventData.type==='interrupted'){clearPlayback();setPhase('listening');return}
    if(eventData.type==='error'){setError(message(typeof eventData.code==='string'?new VoiceRequestError(503,eventData.code):null));stopMedia()}
   }
   ws.onerror=()=>{if(live()){setError(message(null));stopMedia();setBusy(false)}}
   ws.onclose=()=>{if(live()){microphone.current?.getTracks().forEach(t=>t.stop());microphone.current=null;clearPlayback();setBusy(false);setPhase('primer')}}
  }catch(e){if(live()){setError(message(e));stopMedia();setBusy(false);setPhase('primer')}}finally{if(attemptRevision===revision.current)working.current=false}
 }
 async function end(){if(!service||!current.current?.callId||!lifetime.current)return;stopMedia();setBusy(true);try{const value=await request<VoiceCall>(service,'/v1/call-sessions/'+current.current.callId+'/end',lifetime.current.signal,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':current.current.endKey},body:'{}'});accept(value)}catch(e){setError(message(e))}finally{setBusy(false)}}
 const mute=()=>{mutedRef.current=!mutedRef.current;setMutedState(mutedRef.current);microphone.current?.getAudioTracks().forEach(t=>t.enabled=!mutedRef.current);if(socket.current?.readyState===WebSocket.OPEN)socket.current.send(JSON.stringify({type:'mute',muted:mutedRef.current}))}
 const speaker=()=>{setLoudState(v=>{if(gain.current)gain.current.gain.value=v?0:1;return!v})}
 const interrupt=()=>{clearPlayback();setCaption('');if(socket.current?.readyState===WebSocket.OPEN)socket.current.send(JSON.stringify({type:'interrupt'}))}
 return{call,phase,error,caption,seconds,muted,loud,busy,start,end,mute,speaker,interrupt,listen:()=>{void audio.current?.resume()}}
}

export function useVoiceCallRecords(service:VoiceCallContext|undefined,conversationId:string|undefined){
 const{lang}=useI18n(),[view,setView]=useState<{key:string;messages:Msg[];hasOlder:boolean;loading:boolean;error:string}>({key:'',messages:[],hasOlder:false,loading:false,error:''}),loader=useRef<{key:string;read:(older:boolean)=>Promise<void>}|undefined>(undefined),key=service&&conversationId?service.accountId+':'+service.sessionId+':'+conversationId:''
 useEffect(()=>{
  if(!service||!conversationId)return
  const controller=new AbortController(),ids=new Map<string,number>(),records=new Map<string,VoiceCall>();let busy=false,cursor:string|null=null,loadedOlder=false
  const read=async(older=false)=>{
   if(busy||controller.signal.aborted||older&&!cursor)return;busy=true
   if(older)setView(prior=>prior.key===key?{...prior,loading:true}:prior)
   try{
    const page=await request<{data:VoiceCall[];meta:{nextCursor:string|null}}>(service,'/v1/conversations/'+conversationId+'/call-sessions'+(older?'?after='+encodeURIComponent(cursor!):''),controller.signal,{},true)
    if(!Array.isArray(page.data)||page.data.length>100||page.data.some(c=>!validCall(c)||c.conversationId!==conversationId||c.personId!==service.personId)||!page.meta||!(page.meta.nextCursor===null||typeof page.meta.nextCursor==='string')||older&&page.meta.nextCursor===cursor)throw new Error('Invalid call records')
    if(controller.signal.aborted)return
    if(older)loadedOlder=true
    if(older||!loadedOlder)cursor=page.meta.nextCursor
    for(const item of page.data)records.set(item.id,item)
    const messages:Msg[]=[...records.values()].filter(c=>c.startedAt&&c.endedAt&&c.durationSeconds!==null).map(c=>{if(!ids.has(c.id))ids.set(c.id,nid());return{id:ids.get(c.id)!,serverId:c.id,serverVersion:c.version,at:Date.parse(c.endedAt!),kind:'call',time:fmtTime(lang,new Date(c.endedAt!)),mode:'voice',secs:c.durationSeconds!,canSuggestMemory:false}})
    setView(prior=>prior.key===key&&prior.hasOlder===!!cursor&&!prior.loading&&!prior.error&&JSON.stringify(prior.messages)===JSON.stringify(messages)?prior:{key,messages,hasOlder:!!cursor,loading:false,error:''})
   }catch(e){if(!controller.signal.aborted)setView(prior=>({key,messages:prior.key===key&&!(e instanceof VoiceRequestError&&[401,403,404].includes(e.status))?prior.messages:[],hasOlder:!!cursor,loading:false,error:isZh(lang)?'暂时无法读取通话记录，请稍后重试。':'Call records could not be loaded. Please try again.'}))}finally{busy=false}
  }
  loader.current={key,read};void read();const timer=window.setInterval(()=>{void read()},3000),changed=()=>{void read()};window.addEventListener('xijie:call-records-changed',changed)
  return()=>{controller.abort();window.clearInterval(timer);window.removeEventListener('xijie:call-records-changed',changed);if(loader.current?.key===key)loader.current=undefined}
 },[key,lang])
 const current=view.key===key?view:{messages:[],hasOlder:false,loading:false,error:''}
 return{...current,loadOlder:()=>loader.current?.key===key?loader.current.read(true):Promise.resolve()}
}
