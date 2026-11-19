import {useEffect,useRef,useState,type MutableRefObject} from 'react'
import {isZh,useI18n} from './i18n'
import {I} from './ui'
import {PersonVoiceStoragePermission} from './auth/AiTextPermission'
import {createPersonVoiceRecorder,type VoiceRecorderState} from './personVoiceRecorder'
import {createPersonVoiceClient,PersonVoiceError,type PersonVoiceContext,type ReadyPersonVoice} from './servicePersonVoices'

type Props={context:Omit<PersonVoiceContext,'draftId'>;targetId?:string;readyVoice?:ReadyPersonVoice|null;ensureTarget:()=>Promise<PersonVoiceContext>;onBind:(id:string|null)=>Promise<void>;submitRef?:MutableRefObject<(()=>Promise<boolean>)|null>;onBusy?:(busy:boolean)=>void;onSaved?:()=>void}
type VoiceClient=ReturnType<typeof createPersonVoiceClient>
type Work={kind:'save'|'play'|'remove'|'discard'|'cleanup';controller:AbortController}

// Fence the previous owner at render time. The real target first saved by this
// editor may join its scope; changing an existing target starts a clean editor.
export function PersonVoiceInput(props:Props){
 const ownerKey=JSON.stringify([props.context.accountId,props.context.sessionId])
 const scope=useRef({ownerKey,targetId:props.targetId,version:0})
 if(scope.current.ownerKey!==ownerKey||scope.current.targetId!==undefined&&scope.current.targetId!==props.targetId)scope.current={ownerKey,targetId:props.targetId,version:scope.current.version+1}
 else if(props.targetId)scope.current.targetId=props.targetId
 const captured=scope.current
 return <VoiceEditor key={ownerKey+':'+captured.version} {...props} current={()=>scope.current===captured}/>
}

function VoiceEditor(props:Props&{current:()=>boolean}){
 const{lang}=useI18n(),zh=isZh(lang),latest=useRef(props);latest.current=props
 const[file,setFile]=useState<Blob>(),[localURL,setLocalURL]=useState(''),[playURL,setPlayURL]=useState(''),[recording,setRecording]=useState<VoiceRecorderState>('idle'),[seconds,setSeconds]=useState(0),[busy,setBusy]=useState(false),[pending,setPending]=useState(false),[bindingPending,setBindingPending]=useState(false),[notice,setNotice]=useState(''),[permission,setPermission]=useState(false)
 const[cleanupCount,setCleanupCount]=useState(0)
 const alive=useRef(true),work=useRef<Work|null>(null),client=useRef<{key:string;api:VoiceClient}|null>(null),recorder=useRef<ReturnType<typeof createPersonVoiceRecorder>|null>(null),recordingState=useRef<VoiceRecorderState>('idle'),picker=useRef<HTMLInputElement>(null),player=useRef<HTMLAudioElement>(null),localPlayer=useRef<HTMLAudioElement>(null),networkURL=useRef(''),captureURL=useRef('')
 const owns=()=>alive.current&&props.current()
 const saveAction=props.submitRef?(zh?'完成':'Done'):(zh?'继续保存':'Continue saving')
 const check=(job?:Work)=>{if(!owns()||job&&(work.current!==job||job.controller.signal.aborted))throw new DOMException('The voice editor changed','AbortError')}
 const clearPlayback=()=>{player.current?.pause();if(networkURL.current)URL.revokeObjectURL(networkURL.current);networkURL.current='';if(owns())setPlayURL('')}
 function finish(job:Work){if(work.current!==job)return;work.current=null;if(owns()){setBusy(false);latest.current.onBusy?.(recordingState.current!=='idle')}}
 function begin(kind:Work['kind']){if(!owns()||work.current||recordingState.current!=='idle')return;const job={kind,controller:new AbortController()};work.current=job;setBusy(true);latest.current.onBusy?.(true);setNotice('');return job}
 function cancelPlay(){const job=work.current;if(job?.kind==='play'){job.controller.abort();finish(job)}clearPlayback()}
 function failure(error:unknown){
  if(!owns()||error instanceof DOMException&&error.name==='AbortError')return
  const code=error instanceof PersonVoiceError?error.code:String(error)
  if(error instanceof PersonVoiceError&&code==='PERSON_VOICE_STORAGE_PERMISSION_REQUIRED')setPermission(true)
  const messages:Record<string,[string,string]>={
   MICROPHONE_DENIED:['没有开启麦克风。可以在手机设置中允许录音，或选择一段已有音频。','Microphone access is off. Allow recording in your phone settings, or choose an existing audio file.'],
   RECORDING_UNAVAILABLE:['这台设备暂时不能录音，可以选择一段已有音频。','Recording is unavailable on this device. You can choose an existing audio file.'],
   NO_AUDIO_CAPTURED:['这次没有录到声音，请重新按住按钮录制。','No sound was recorded. Hold the record button to try again.'],
   PERSON_VOICE_STORAGE_PERMISSION_REQUIRED:['声音还没保存。请到「我」里的「隐私与 AI 说明」同意相关说明，再回来保存。','The voice is not saved. Agree to the statement in Me → Privacy & AI, then return to save it.'],
   VOICE_ORIGINAL_FILE_REQUIRED:['请重新选择刚才那段音频，再点保存；也可以放弃这次保存。','Choose the same audio again and save it, or discard this save.'],
   VOICE_BINDING_UNCONFIRMED:[`还没收到声音保存结果。请点「${saveAction}」查看；如果不想保留，可以移除声音。`,`The save is not yet confirmed. Select ${saveAction} to check, or remove the voice if you no longer want it.`],
   VOICE_UPLOAD_RENEWED:['已准备好重新上传，请再点一次保存。','Ready to upload again. Select Save once more.'],
   VOICE_VERIFICATION_PENDING:[`这段声音还在处理，请稍后点「${saveAction}」查看结果。`,`The voice is still being processed. Select ${saveAction} shortly to check the result.`],
  }
  const invalid=['INVALID_AUDIO','AUDIO_MIME_MISMATCH','AUDIO_TOO_LONG','UPLOAD_CONTENT_MISMATCH'].includes(code)
  setNotice(messages[code]?.[zh?0:1]??(invalid?(zh?'这段音频没能打开。请换一段30秒以内、文件不超过8MB的音频，再试一次。':'This audio could not be opened. Choose another clip up to 30 seconds and 8 MB, then try again.'):(zh?'这次操作还没完成。已选的声音仍保留，请再试一次。':'The action is not yet complete. Your selected audio is kept; try again.')))
 }
 function syncPending(api:VoiceClient){check();const intent=api.pending;setPending(!!intent);setBindingPending(!!intent?.bindingStarted);setCleanupCount(api.pendingDeletions.length)}
 function attach(context:PersonVoiceContext){const key=JSON.stringify([context.accountId,context.sessionId,context.draftId]);if(client.current?.key!==key){client.current?.api.dispose();client.current={key,api:createPersonVoiceClient({...context,onUnauthorized:()=>{if(owns())context.onUnauthorized()}})}}return client.current.api}
 async function getClient(job:Work){
  check(job);const p=latest.current,context=p.targetId?{...p.context,draftId:p.targetId}:await p.ensureTarget();check(job)
  if(context.accountId!==p.context.accountId||context.sessionId!==p.context.sessionId||latest.current.targetId&&latest.current.targetId!==context.draftId)throw new DOMException('The voice target changed','AbortError')
  return attach(context)
 }
 useEffect(()=>{
  alive.current=true
  const fresh=createPersonVoiceRecorder({mediaDevices:navigator.mediaDevices,Recorder:typeof MediaRecorder==='undefined'?undefined:MediaRecorder,onState:state=>{if(owns()){recordingState.current=state;setRecording(state);latest.current.onBusy?.(state!=='idle'||!!work.current)}},onBlob:blob=>{if(owns()){setFile(blob);setNotice(zh?'已录下这段声音，完成后才会保存。':'Recorded. Complete this step to save the sample.')}},onError:failure});recorder.current=fresh
  const invalidate=()=>{fresh.cancel();cancelPlay();localPlayer.current?.pause();if(captureURL.current)URL.revokeObjectURL(captureURL.current);captureURL.current='';if(owns())setLocalURL('')},hidden=()=>{if(document.visibilityState==='hidden')invalidate()},erased=(event:Event)=>{if((event as CustomEvent<{accountId:string}>).detail?.accountId!==props.context.accountId||!owns())return;const job=work.current;job?.controller.abort();if(job)finish(job);fresh.dispose();client.current?.api.dispose();client.current=null;invalidate();setFile(undefined);setPending(false);setBindingPending(false);setCleanupCount(0)}
  window.addEventListener('xijie:consents-changed',invalidate);window.addEventListener('xijie:private-drafts-erased',erased);document.addEventListener('visibilitychange',hidden)
  return()=>{alive.current=false;fresh.dispose();work.current?.controller.abort();work.current=null;client.current?.api.dispose();client.current=null;player.current?.pause();if(networkURL.current)URL.revokeObjectURL(networkURL.current);networkURL.current='';window.removeEventListener('xijie:consents-changed',invalidate);window.removeEventListener('xijie:private-drafts-erased',erased);document.removeEventListener('visibilitychange',hidden);props.onBusy?.(false)}
 },[])
 useEffect(()=>{if(!props.targetId||!owns())return;try{syncPending(attach({...props.context,draftId:props.targetId}))}catch(error){failure(error)}},[props.targetId])
 useEffect(()=>{cancelPlay()},[props.readyVoice?.id,props.readyVoice?.version])
 useEffect(()=>{const url=file?URL.createObjectURL(file):'';captureURL.current=url;setLocalURL(url);return()=>{localPlayer.current?.pause();if(url)URL.revokeObjectURL(url);if(captureURL.current===url)captureURL.current=''}},[file])
 useEffect(()=>{if(recording!=='recording'){setSeconds(0);return}const start=Date.now(),timer=window.setInterval(()=>{if(owns())setSeconds(Math.min(30,Math.floor((Date.now()-start)/1000)))},250);return()=>clearInterval(timer)},[recording])
 useEffect(()=>{if(owns())props.onBusy?.(busy||recording!=='idle')},[busy,recording,props.onBusy])
 async function save(){
  const job=begin('save');if(!job)return false
  if(!file&&!pending){finish(job);return true}
  try{const api=await getClient(job);check(job);setPending(true);let value=await api.save(file);check(job)
   const deadline=Date.now()+45000
   while(value.status==='verifying'){if(Date.now()>=deadline)throw new PersonVoiceError(503,'VOICE_VERIFICATION_PENDING');await new Promise<void>(resolve=>{const done=()=>{window.clearTimeout(timer);job.controller.signal.removeEventListener('abort',done);resolve()},timer=window.setTimeout(done,750);job.controller.signal.addEventListener('abort',done,{once:true})});check(job);value=await api.read(value.id);check(job)}
   if(value.status!=='ready')throw new PersonVoiceError(409,value.failureCode??'VOICE_NOT_READY')
   api.markBinding(value.id);setBindingPending(true);const prior=latest.current.readyVoice;await latest.current.onBind(value.id);check(job);api.acknowledgeBound(value.id);setFile(undefined);syncPending(api);clearPlayback();setNotice(zh?'这段声音已保存。':'This voice sample is saved.');latest.current.onSaved?.()
   if(prior&&prior.id!==value.id)try{await api.remove(prior);check(job)}catch{check(job);setNotice(zh?'新声音已保存，旧录音还没删除完成。可点「继续删除旧录音」重试。':'The new voice is saved. The old recording has not been fully deleted; select Continue deleting old recordings to retry.')}
   return true
  }catch(error){if(owns()){try{if(client.current)syncPending(client.current.api)}catch{}failure(error)}return false}finally{finish(job)}
 }
 const submit=useRef(save);submit.current=save
 useEffect(()=>{const ref=props.submitRef;if(!ref)return;const action=()=>submit.current();ref.current=action;return()=>{if(ref.current===action)ref.current=null}},[props.submitRef])
 async function play(){const ready=latest.current.readyVoice;if(!ready)return;const job=begin('play');if(!job)return;clearPlayback();try{const api=await getClient(job),blob=await api.playback(ready,job.controller.signal);check(job);if(latest.current.readyVoice?.id!==ready.id||latest.current.readyVoice.version!==ready.version)throw new DOMException('The voice source changed','AbortError');const url=URL.createObjectURL(blob);networkURL.current=url;setPlayURL(url)}catch(error){failure(error)}finally{finish(job)}}
 async function remove(){const job=begin('remove');if(!job)return;try{const api=await getClient(job),current=latest.current.readyVoice;await latest.current.onBind(null);check(job);clearPlayback();if(current){await api.remove(current);check(job)}if(api.pending){await api.discard(true);check(job)}setFile(undefined);syncPending(api);setNotice(zh?'声音已移除。':'The voice sample was removed.')}catch(error){if(owns()&&client.current)try{syncPending(client.current.api)}catch{}failure(error)}finally{finish(job)}}
 async function discard(){const job=begin('discard');if(!job)return;try{const api=await getClient(job);check(job);if(api.pending?.bindingStarted)throw new PersonVoiceError(409,'VOICE_BINDING_UNCONFIRMED');await api.discard();check(job);setFile(undefined);syncPending(api);setNotice(zh?'已放弃这次保存。':'This save was discarded.')}catch(error){failure(error)}finally{finish(job)}}
 async function retryCleanup(){const job=begin('cleanup');if(!job)return;try{const api=await getClient(job),context=latest.current.context,target=latest.current.targetId;if(!target)throw new PersonVoiceError(409,'VOICE_TARGET_REQUIRED');const response=await fetch('/v1/person-drafts/'+encodeURIComponent(target),{credentials:'same-origin',cache:'no-store',signal:job.controller.signal,headers:{'X-Xijie-Expected-Session':context.sessionId}});check(job);if(!response.ok){if(response.status===401)context.onUnauthorized();throw new PersonVoiceError(response.status,'VOICE_SOURCE_UNAVAILABLE')}const data=(await response.json())?.data;check(job);if(data?.id!==target||!Number.isSafeInteger(data.version)||data.version<1||!['draft','confirmed'].includes(data.status)||data.voiceId!==null&&typeof data.voiceId!=='string')throw new PersonVoiceError(502,'INVALID_VOICE_RESPONSE');await api.retryDeletions(data.voiceId?[data.voiceId]:[]);check(job);syncPending(api);setNotice(zh?'已清理移除的声音。':'Removed samples have been cleaned up.')}catch(error){failure(error)}finally{finish(job)}}
 function select(value:File|undefined){if(!value||!owns()||work.current||recordingState.current!=='idle')return;if(value.size<1||value.size>8*1024*1024){setNotice(zh?'音频文件为空或太大，请选择不超过8MB的音频。':'The audio file is empty or too large. Choose one no larger than 8 MB.');return}cancelPlay();setFile(value);setNotice(zh?'已选好音频，点「完成」或「保存」后才会保存。':'Audio selected. Select Done or Save to keep it.')}
 function startRecording(){if(!owns()||work.current||pending)return;cancelPlay();setNotice('');void recorder.current?.start()}
 return <div className="space-y-4"><p className="text-[13px] leading-relaxed text-ink-soft">{zh?'录制或选择一段想留住的声音，最长30秒，文件不超过8MB。这里只保存和播放原声，不用于声音克隆或 AI 通话。':'Record or choose a voice you want to keep, up to 30 seconds and 8 MB. It is saved for playback, not voice cloning or AI calls.'}</p>
  {props.readyVoice&&<div className="rounded-2xl bg-cloud px-4 py-3"><p className="text-sm text-ink">{zh?'已保存的声音':'Saved voice'} · {Math.ceil(props.readyVoice.durationMs/1000)}″</p><button disabled={busy||recording!=='idle'} onClick={()=>void play()} className="mt-2 min-h-11 rounded-full ring-1 ring-line px-4 text-sm text-ink disabled:opacity-50">{zh?'聆听原声':'Listen to original voice'}</button>{playURL&&<audio ref={player} controls src={playURL} className="mt-3 w-full" aria-label={zh?'已保存声音播放器':'Saved voice player'}/>}</div>}
  <div className="flex flex-col items-center gap-3"><button aria-label={zh?'按住录音':'Hold to record'} aria-pressed={recording!=='idle'} disabled={busy||pending} onPointerDown={event=>{event.currentTarget.setPointerCapture?.(event.pointerId);startRecording()}} onPointerUp={()=>recorder.current?.stop()} onPointerCancel={()=>recorder.current?.cancel()} onBlur={()=>recorder.current?.cancel()} onKeyDown={event=>{if((event.key===' '||event.key==='Enter')&&!event.repeat){event.preventDefault();startRecording()}}} onKeyUp={event=>{if(event.key===' '||event.key==='Enter'){event.preventDefault();recorder.current?.stop()}}} className="seek-panel-control relative grid h-24 w-24 touch-none place-items-center rounded-full disabled:opacity-50"><I.Mic className="h-8 w-8"/></button><span className="text-sm text-ink-soft">{recording==='requesting'?zh?'正在开启麦克风…':'Opening microphone…':recording==='recording'?(zh?'正在录音':'Recording')+' · '+seconds+'″':zh?'按住录音，松手结束':'Hold to record; release to finish'}</span><button disabled={busy||recording!=='idle'} onClick={()=>picker.current?.click()} className="seek-chip min-h-11 rounded-full px-4 text-sm disabled:opacity-50">{zh?'选择音频文件':'Choose audio file'}</button><input ref={picker} aria-label={zh?'人物声音文件':'Person voice audio file'} className="hidden" type="file" accept="audio/wav,audio/mpeg,audio/ogg,audio/webm,audio/mp4,.m4a" onChange={event=>{select(event.target.files?.[0]);event.target.value=''}}/></div>
  {localURL&&<div><p className="mb-2 text-xs text-muted">{zh?'本次录音或文件 · 尚未保存':'Current recording or file · not saved yet'}</p><audio ref={localPlayer} controls src={localURL} className="w-full" aria-label={zh?'待保存声音播放器':'Unsaved voice player'}/></div>}
  {pending&&!file&&<p className="text-sm text-ink-soft">{zh?`上次保存还没收到结果，点「${saveAction}」即可查看。需要重新选音频时，会在这里提示。`:`The previous save is not yet confirmed. Select ${saveAction} to check. If the audio is needed again, this panel will ask for it.`}</p>}
  {!props.submitRef&&(file||pending)&&<button disabled={busy||recording!=='idle'} onClick={()=>void save()} className="w-full rounded-full btn-dark py-3 text-sm text-paper disabled:opacity-50">{busy?zh?'正在保存…':'Saving…':pending?zh?'继续保存':'Continue saving':zh?'保存这段声音':'Save this voice sample'}</button>}
  {pending&&!bindingPending&&<button disabled={busy||recording!=='idle'} onClick={()=>void discard()} className="min-h-11 rounded-full ring-1 ring-line px-4 text-sm text-ink disabled:opacity-50">{zh?'放弃这次保存':'Discard this save'}</button>}
  {(props.readyVoice||pending)&&<div><button disabled={busy||recording!=='idle'} onClick={()=>void remove()} className="min-h-11 rounded-full px-4 text-sm text-coral disabled:opacity-50">{zh?'移除声音':'Remove voice'}</button><p className="text-xs text-muted">{zh?'会同时移除已保存的声音和待保存的录音。':'This removes the saved voice and any recording waiting to be saved.'}</p></div>}
  {cleanupCount>0&&<button disabled={busy||recording!=='idle'} onClick={()=>void retryCleanup()} className="min-h-11 rounded-full px-4 text-sm text-ink disabled:opacity-50">{zh?'继续删除旧录音':'Continue deleting old recordings'}</button>}
  <details open={permission||undefined} onToggle={event=>setPermission(event.currentTarget.open)}><summary className="min-h-11 cursor-pointer py-2 text-sm text-sky-deep">{zh?'保存与使用说明':'Storage and use details'}</summary>{permission&&<PersonVoiceStoragePermission sessionId={props.context.sessionId} onUnauthorized={props.context.onUnauthorized}/>}</details>
  {notice&&<p role="status" className="text-sm leading-relaxed text-ink-soft">{notice}</p>}
 </div>
}

