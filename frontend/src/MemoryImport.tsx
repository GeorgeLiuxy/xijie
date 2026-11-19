import {useEffect,useRef,useState,type RefObject} from 'react'
import {createPortal} from 'react-dom'
import {Sheet} from './ui'
import {useI18n,isZh} from './i18n'
import type {MemoryImportIntent,MemoryImportService} from './serviceMemoryImports'

function fileProblem(failure:unknown,zh:boolean){
 const code=(failure as {code?:string})?.code
 if(code==='IMPORT_FILE_UNSUPPORTED')return zh?'暂时读不了这种文件。请选择记事本保存的文字文件，也可以把文字复制到「珍藏一段」里添加。':'This file type is not supported. Choose a text file saved in Notepad, or copy the words into “Keep a memory”.'
 if(code==='IMPORT_FILE_EMPTY')return zh?'这个文件里还没有文字。请写入内容后再选择。':'This file has no text yet. Add some words, then choose it again.'
 if(code==='IMPORT_FILE_TOO_LARGE')return zh?'这个文件太大。请只保留想添加的文字，或分成几个小文件再选择。':'This file is too large. Keep just the words you want to add, or split it into smaller files.'
 if(code==='IMPORT_CONTENT_TOO_LONG')return zh?'有一段记忆太长。标题最多120字、内容最多一万字，请缩短或分段后再选择。':'One memory is too long. Use up to 120 characters for its title and 10,000 for its text, then choose the file again.'
 if(code==='IMPORT_TOTAL_TOO_LONG')return zh?'这份文件里的文字太多。请分成几份文件再添加。':'This file contains too much text. Split it into a few files and add them separately.'
 if(code==='IMPORT_TOO_MANY_MEMORIES')return zh?'一次最多添加50段记忆。请分成几份文件再添加。':'You can add up to 50 memories at once. Split them into a few files and add them separately.'
 return zh?'这份文件里的文字暂时读不了。请换一个文件，或把内容复制到「珍藏一段」里添加。':'The words in this file could not be read. Choose another file, or copy the text into “Keep a memory”.'
}

export function MemoryImport({personId,personName,personVersion,service,layer,onChanged,onBusy,onOpen,reload}:{
 personId:string;personName?:string;personVersion:number;service:MemoryImportService;layer:RefObject<HTMLDivElement|null>
 onChanged:(text:string)=>void;onBusy:(busy:boolean)=>void;onOpen:(open:boolean)=>void;reload?:()=>Promise<void>
}){
 const {lang}=useI18n(),zh=isZh(lang),input=useRef<HTMLInputElement>(null),[intent,setIntent]=useState<MemoryImportIntent>(),[busy,setBusy]=useState(false),[frozen,setFrozen]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false),alive=useRef(true),binding=useRef({personId,service})
 binding.current={personId,service}
 const live=()=>alive.current&&binding.current.personId===personId&&binding.current.service===service
 useEffect(()=>{
  alive.current=true;setIntent(undefined);setBusy(false);setFrozen(false);setError('');setConflict(false);onBusy(false);onOpen(false)
  return()=>{alive.current=false}
 },[personId,service])
 const work=(v:boolean)=>{setBusy(v);onBusy(v)}
 const show=(v:MemoryImportIntent|undefined)=>{setIntent(v);onOpen(!!v)}
 async function choose(file:File|undefined){
  if(!file||busy)return;work(true);setError('')
  try{const value=await service.prepare(file,personId,personVersion);if(live()){show(value);setFrozen(false);setConflict(false)}}
  catch(failure){if(live())setError(fileProblem(failure,zh))}
  finally{if(live())work(false)}
 }
 function open(){
  if(busy)return;setError('')
  try{const old=service.pending(personId);if(old){show(old);setFrozen(true);setConflict(false)}else input.current?.click()}
  catch{setError(zh?'上次添加的内容暂时无法打开。请稍后再试，避免重复添加。':'The previous file could not be reopened. Try again shortly before adding the same memories again.')}
 }
 async function submit(){
  if(!intent||busy||conflict)return
  const attempt=intent.personVersion===0?{...intent,personVersion}:intent
  setIntent(attempt);work(true);setError('');setFrozen(true)
  try{const receipt=await service.submit(attempt);if(live()){
   const count=receipt.items.filter(item=>item.status==='active').length
   show(undefined);setFrozen(false)
   const removed=receipt.items.length-count
   onChanged(count?(zh?`已保存${count}段记忆。${removed?`另外${removed}段此前已删除，不会重复添加。`:''}`:`Saved ${count} ${count===1?'memory':'memories'}.${removed?` Another ${removed} had already been deleted and will not be added again.`:''}`):(zh?'这些记忆此前已删除，不会重新添加。':'These memories had already been deleted and will not be added again.'))
  }}catch(failure){if(live()){
   const stale=(failure as {code?:string}).code==='VERSION_CONFLICT';setConflict(stale)
   const code=(failure as {code?:string}).code,status=(failure as {status?:number}).status
   setError(stale?(zh?'TA 的资料刚有变化。请先刷新资料，再确认要添加的内容。':'Their profile has changed. Refresh it, then review these memories before adding them.')
    :code==='IMPORT_PENDING'?(zh?'还有一次添加需要确认。请关闭后重新打开「从文件添加记忆」，先完成上一次操作。':'A previous addition still needs confirmation. Close this preview and reopen “Add memories from a file” to finish it first.')
    :status===401?(zh?'请重新登录，再继续添加。已选择的内容会保留。':'Sign in again to continue. Your selected text is kept.')
    :status===403?(zh?'请到「我」的「隐私与 AI 说明」同意说明后再试。已选择的内容仍保留。':'Open Privacy & AI in Me, agree to the statement, then try again. Your selected text is kept.')
    :status===404?(zh?'这位 TA 暂时无法打开。请返回人物列表，再试一次。':'This character is unavailable. Return to your people and try again.')
    :(zh?'还没能确认是否已保存，内容已保留。点击「重试添加」继续，不会重复添加。':'We could not confirm whether the memories were saved. Your text is kept. Select “Retry adding” to continue without adding duplicates.'))
  }}finally{if(live())work(false)}
 }
 async function review(){
  if(!reload||busy||!intent)return;work(true)
  try{await reload();if(live()){setIntent({...intent,key:crypto.randomUUID(),personVersion:0});setConflict(false);setFrozen(false);setError('')}}
  catch{if(live())setError(zh?'TA 的资料暂时刷新不了。已选择的内容仍在，请稍后再试。':'Their profile could not be refreshed. Your selected text is still here; try again shortly.')}
  finally{if(live())work(false)}
 }
 const overlay=intent&&<Sheet title={zh?'看看要添加的记忆':'Review these memories'} onClose={()=>{if(!busy)show(undefined)}} footer={<button disabled={busy||conflict} className="w-full rounded-full btn-dark py-3 text-[15px] disabled:opacity-50" onClick={()=>void submit()}>{busy?zh?'正在添加…':'Adding…':frozen?zh?'重试添加':'Retry adding':zh?'添加到记忆':'Add to memories'}</button>}>
  <p className="mb-4 text-[13px] leading-relaxed text-muted">{zh?`请确认这是你想为${personName||'TA'}留下的内容。确认后，下方${intent.batch.items.length===1?'这段':`这${intent.batch.items.length}段`}文字会保存在${personName||'TA'}的记忆中。`:`Check that these are the memories you want to keep for ${personName||'this character'}. Only the text below will be saved when you confirm.`}</p>
  <div className="space-y-4">{intent.batch.items.map(item=><section key={item.itemId}><h3 className="font-serif text-[18px] text-ink">{item.title}</h3><p className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-ink-soft">{item.body}</p></section>)}</div>
  {error&&<p role="alert" className="mt-3 text-[13px] text-coral">{error}</p>}
  {conflict&&reload&&<button disabled={busy} onClick={()=>void review()} className="mt-3 min-h-11 text-sm underline">{zh?'刷新 TA 的资料':'Refresh their profile'}</button>}
 </Sheet>
 const destination=layer.current?.closest('.app-device-frame')??layer.current
 return <><button disabled={busy} onClick={open} className="mx-3 mb-2 w-[calc(100%-24px)] rounded-xl ring-1 ring-line px-4 py-3 text-left text-[13.5px] text-ink">{zh?'从文件添加记忆':'Add memories from a file'}</button>
  <p className="mx-4 mb-1 text-[13px] leading-relaxed text-muted">{zh?'选择记事本保存的文字记录，添加前会先给你看一遍。':'Choose a written record saved in Notepad. You can review it before adding anything.'}</p>
  <details className="mx-4 mb-3 text-[13px] leading-relaxed text-muted"><summary className="min-h-11 flex items-center cursor-pointer text-sky-deep">{zh?'支持哪些文件？':'Which files can I use?'}</summary>
   <p>{zh?'支持文字文件（.txt），每份最多一万字。也支持按标题和内容整理的记忆文件（.json），一次最多50段。每个文件大小不超过512 KB。':'Text files (.txt) can contain up to 10,000 characters. Structured memory files (.json) can hold up to 50 memories with titles and text. Each file must be no larger than 512 KB.'}</p>
   <p className="mt-2">{zh?'暂时读不了 Word 文档或 PDF；可以把其中的文字复制到「珍藏一段」里添加。':'Word documents and PDFs are not supported yet. You can copy their words into “Keep a memory” instead.'}</p>
  </details>
  <input ref={input} type="file" accept=".txt,.json,text/plain,application/json" className="hidden" onChange={event=>{void choose(event.currentTarget.files?.[0]);event.currentTarget.value=''}}/>{error&&!intent&&<p role="alert" className="px-4 pb-3 text-[13px] text-coral">{error}</p>}{overlay&&destination?createPortal(overlay,destination):null}</>
}
