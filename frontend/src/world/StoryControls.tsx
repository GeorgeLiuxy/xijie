import {useEffect,useRef,useState} from 'react'
import {isZh,useI18n} from '../i18n'
import {AiTextPermission,TextStoragePermission,WorldActionPermission,StoryBranchesPermission,OfflineLifePermission} from '../auth/AiTextPermission'
import {storyClient,StoryError,type StoryBranch,type StoryContext,type OfflineLife,type StoryEvent} from '../serviceStoryControls'

export function StoryControls({context,name,onOpen}:{context:StoryContext;name:string;onOpen:(branch?:StoryBranch)=>void}){
 const {lang}=useI18n(),zh=isZh(lang),[branches,setBranches]=useState<StoryBranch[]>([]),[offline,setOffline]=useState<OfflineLife>(),[title,setTitle]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0),[readFailed,setReadFailed]=useState(false),[permissionsOpen,setPermissionsOpen]=useState(false)
 const client=useRef<ReturnType<typeof storyClient>|undefined>(undefined),life=useRef<AbortController|undefined>(undefined)
 useEffect(()=>{const controller=new AbortController();life.current=controller;const api=storyClient(context,controller.signal);client.current=api;setBusy(false);setBranches([]);setOffline(undefined)
  void Promise.all([api.branches(),api.offline()]).then(([items,settings])=>{if(!controller.signal.aborted){setBranches(items);setOffline(settings);setReadFailed(false);if(api.pending?.body.name)setTitle(String(api.pending.body.name))}}).catch(()=>{if(!controller.signal.aborted)setReadFailed(true)})
  return()=>controller.abort()
 },[context.accountId,context.sessionId,context.personId,revision])
 useEffect(()=>{setNotice('');setTitle('');setPermissionsOpen(false)},[context.accountId,context.sessionId,context.personId])
 async function act(run:(api:ReturnType<typeof storyClient>)=>Promise<void>){
  if(busy||!client.current)return
  const current=life.current;setBusy(true);setNotice('')
  try{await run(client.current)}catch(error){
   if(current?.signal.aborted)return
   if(error instanceof StoryError&&error.status===412){setRevision(v=>v+1);setNotice(zh?'设置刚刚有变化，正在更新。请查看后再试一次。':'The settings changed. They are being refreshed; review them and try again.')}
   else if(error instanceof StoryError&&['STORAGE_PERMISSION_REQUIRED','AI_PERMISSION_REQUIRED','STORY_BRANCH_PERMISSION_REQUIRED','OFFLINE_LIFE_PERMISSION_REQUIRED','WORLD_ACTION_PERMISSION_REQUIRED'].includes(error.code))setNotice(zh?'请到「我」里的「隐私与 AI 说明」同意相关说明，再回来继续。填写的内容已保留。':'Agree to the statement in Me → Privacy & AI, then return to continue. Your entries are kept.')
   else if(error instanceof StoryError&&error.status===400)setNotice(zh?'请检查故事线名称和所选设置，再试一次。':'Check the storyline name and selected settings, then try again.')
   else setNotice(zh?'这次操作还没收到结果，填写内容已保留。请再试一次。':'The result has not arrived yet. Your entries are kept; try again.')
  }finally{if(!current?.signal.aborted)setBusy(false)}
 }
 const pending=client.current?.pending,pendingBranch=typeof pending?.body.name==='string'
 const openBranch=(api:ReturnType<typeof storyClient>,value:string)=>{const current=life.current;return api.create(value).then(branch=>{if(current?.signal.aborted||life.current!==current)return;setBranches(previous=>[...previous.filter(v=>v.id!==branch.id),branch]);setTitle('');onOpen(branch)})}
 const saveOffline=async(api:ReturnType<typeof storyClient>,enabled:boolean)=>{if(!offline)return;const current=life.current,value=await api.setOffline(enabled,offline.version,offline.timeZone??Intl.DateTimeFormat().resolvedOptions().timeZone);if(!current?.signal.aborted&&life.current===current)setOffline(value)}
 const continuePending=()=>void act(async api=>{const old=api.pending;if(!old)return;if(typeof old.body.name==='string')await openBranch(api,old.body.name);else await saveOffline(api,old.body.enabled===true)})
 const primary='gg-primary min-h-11 w-full rounded-full btn-dark px-4 py-2 text-sm disabled:opacity-50',secondary='gg-secondary min-h-11 w-full rounded-full px-4 py-2 text-sm ring-1 ring-line disabled:opacity-50'
 const permission={sessionId:context.sessionId,onUnauthorized:context.onUnauthorized,onChanged:()=>setRevision(v=>v+1)}
 return <div className="space-y-5">
  {readFailed&&<p role="status" className="text-sm text-coral">{zh?'故事设置暂时没能打开，请再试一次。':'Story settings could not be opened. Please try again.'}<button className={secondary+' mt-2'} disabled={busy} onClick={()=>setRevision(v=>v+1)}>{zh?'重新打开设置':'Reload settings'}</button></p>}
  {pending&&<div className="space-y-2 rounded-xl bg-cloud p-3 text-sm"><p>{zh?'上次操作的结果还没确认，可以继续查看。不会重复创建或更改。':'The previous result is not yet confirmed. Continue checking it without creating or changing it twice.'}</p><button className={primary} disabled={busy||!pendingBranch&&!offline} onClick={continuePending}>{pendingBranch?(zh?'继续创建这条故事线':'Continue creating this storyline'):pending.body.enabled?(zh?'继续开启离线生活':'Continue enabling life while away'):(zh?'继续暂停离线生活':'Continue pausing life while away')}</button></div>}
  <section className="space-y-3"><h3 className="font-serif text-xl">{name}{zh?'的故事线':"’s storylines"}</h3><p className="text-sm opacity-70">{zh?'从此刻另开一条线，保留之前共同的经历和此刻的场景。往后各自继续，结局不会合并。':'Start a separate line from now, keeping the shared past and this scene. Later experiences and endings stay separate.'}</p>
   <button className={secondary} disabled={busy} onClick={()=>onOpen()}>{zh?'回到主线':'Return to main story'}</button>
   {branches.map(branch=><button className={secondary} key={branch.id} disabled={busy} onClick={()=>onOpen(branch)}>{branch.name}<small className="block opacity-65">{branch.scene.world.displayName}</small></button>)}
   <label className="gg-label block space-y-2 text-sm"><span>{zh?'新故事线名称':'New storyline name'}</span><input className="min-h-11 w-full rounded-xl bg-cloud px-3 py-2 text-ink" value={title} placeholder={zh?'给另一种可能起个名字':'Name another possibility'} maxLength={40} disabled={busy||!!pending} onChange={e=>setTitle(e.target.value)}/></label>
   <button className={primary} disabled={busy||!title.trim()||!!pending} onClick={()=>void act(api=>openBranch(api,title.trim()))}>{zh?'另开一条故事线':'Start another storyline'}</button>
  </section>
  <section className="space-y-3"><h3 className="font-serif text-xl">{zh?'不在时的生活':'Life while you are away'}</h3><p className="text-sm opacity-70">{zh?'默认关闭。开启后，TA 在主线中每天最多留下一段虚拟经历。不会花费资产、替你发消息或公开发布，回来可在聊天回顾。':'Off by default. When enabled, they may have one virtual experience per day in the main story. No spending, messages as you or public posts. Revisit it in chat.'}</p>
   {offline&&<button className={secondary} disabled={busy||!!pending} onClick={()=>void act(api=>saveOffline(api,!offline.enabled))}>{offline.enabled?(zh?'暂停离线生活':'Pause offline life'):(zh?'开启离线生活':'Enable offline life')}</button>}
   {offline?.enabled&&<p className="text-xs opacity-60">{zh?'已开启，按开启时的当地时间安排，可随时暂停。':'Enabled, using the local time zone from when you turned it on. Pause at any time.'}</p>}
  </section>
  {notice&&<p role="status" className="gg-error text-sm">{notice}</p>}
  <details open={permissionsOpen} onToggle={event=>setPermissionsOpen(event.currentTarget.open)}><summary className="min-h-11 cursor-pointer py-2 text-sm">{zh?'查看或调整使用设置':'Review usage settings'}</summary>{permissionsOpen&&<div className="space-y-4 pt-4"><TextStoragePermission {...permission}/><AiTextPermission {...permission}/><StoryBranchesPermission {...permission}/><WorldActionPermission {...permission}/><OfflineLifePermission {...permission}/></div>}</details>
 </div>
}

export function StoryReview({context,branchId,branchName}:{context:StoryContext;branchId?:string;branchName?:string}){
 const {lang}=useI18n(),zh=isZh(lang),[items,setItems]=useState<StoryEvent[]>([]),[failed,setFailed]=useState(false),[open,setOpen]=useState(false),[revision,setRevision]=useState(0),[next,setNext]=useState<string|null>(null)
 const client=useRef<ReturnType<typeof storyClient>|undefined>(undefined),life=useRef<AbortController|undefined>(undefined),pageCount=useRef(1)
 useEffect(()=>{pageCount.current=1},[context.accountId,context.sessionId,context.personId,branchId])
 useEffect(()=>{const controller=new AbortController();life.current=controller;client.current=storyClient(context,controller.signal);let reading=false
  const load=async()=>{if(reading||document.hidden)return;reading=true;try{const items:StoryEvent[]=[];let cursor:string|undefined;for(let i=0;i<pageCount.current;i++){const page=await client.current!.events(branchId,cursor);items.push(...page.items);cursor=page.next??undefined;if(!cursor)break};if(!controller.signal.aborted){setItems(items);setNext(cursor??null);setFailed(false)}}catch{if(!controller.signal.aborted){setItems([]);setNext(null);setFailed(true)}}finally{reading=false}}
  void load();const timer=window.setInterval(load,10000);return()=>{controller.abort();window.clearInterval(timer)}
 },[context.accountId,context.sessionId,context.personId,branchId,revision])
 if(!branchId&&!items.length&&!failed)return null
 return <details open={open} onToggle={event=>setOpen(event.currentTarget.open)} className="mx-4 rounded-xl bg-paper/80 px-4 py-2 text-ink text-sm">
  <summary>{branchId?(branchName|| (zh?'平行故事线':'Parallel storyline')):(zh?'TA 不在时的近况':'While you were away')}</summary>
  <div className="max-h-60 overflow-auto py-2 space-y-3">{branchId&&<p className="text-xs opacity-65">{zh?'这条线保留分开前的共同经历，后来的故事不会与主线合并。':'This line retains the shared past. Later stories do not merge into the main story.'}</p>}
   {items.map(item=><article key={item.id}><small className="opacity-60">{item.origin==='inherited_main'?(zh?'分开前的共同经历':'Before the fork'):new Date(item.occurredAt).toLocaleString(lang)}</small><p>{item.summary}</p></article>)}
   {!items.length&&!failed&&<p>{zh?'这里还没有已发生的经历。':'No experiences recorded here yet.'}</p>}
   {failed&&<button onClick={()=>setRevision(v=>v+1)}>{zh?'暂时无法读取，点此重试':'Unable to load. Try again.'}</button>}
   {next&&<button onClick={()=>{pageCount.current++;setRevision(v=>v+1)}}>{zh?'更早的经历':'Earlier experiences'}</button>}
  </div>
 </details>
}
