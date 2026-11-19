import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import {useContentReports} from '../ContentReports'
import { LangProvider, isZh, useI18n } from '../i18n'
import { destination } from '../study/journeys'
import { I, chime, haptic } from '../ui'
import { useNativeBack } from '../mobile/back'
import { PublicGiftFrame } from './PublicGiftFrame'
import type { GiftGoal, GiftTarget, GoalKind } from './types'
import './goals.css'
import { claimGoalReward, GoalError, goalRequest, getGiftGoal, goalUrl } from './client'
import {createAlbum,readAlbum,contributeAlbum,withdrawAlbum,adoptAlbum,closeAlbum,claimAlbum,albumPending,albumCreateKey,albumContributionKey,reviewAlbum,pendingAlbumReviews,retireRejectedAlbumReview,type AlbumReviewSnapshot,AlbumError} from '../serviceAlbums'
import type {ReferralContext} from '../serviceReferrals'
export { getGiftGoal, goalUrl } from './client'
const GiftGoalScene=lazy(()=>import('./GiftGoalScene').then(m=>({default:m.GiftGoalScene})))

const goalNames = {
  flight: ['一起寄成', 'A shared departure'],
  home: ['一起建成', 'A place together'],
  album: ['一起创作', 'A shared memory book'],
} as const
const homeParts = ['门牌', '窗', '灯', '长椅', '花箱', '屋顶']
const homePartsEn = ['Nameplate', 'Window', 'Lamp', 'Bench', 'Flower box', 'Roof']

function albumIssue(error: unknown, zh: boolean, fallback: string) {
  if (!(error instanceof AlbumError)) return fallback
  if (error.status === 401) return zh ? '请返回西界登录，再打开这张邀请继续。' : 'Return to Elysium to sign in, then reopen this invitation.'
  if (['ALBUM_VIEWER_CHANGED', 'VIEWER_SCOPE_CHANGED'].includes(error.code)) return zh ? '账号已切换，请刷新邀请后再操作。' : 'Your account changed. Refresh the invitation before continuing.'
  if (error.code === 'ALBUM_CLOSED') return zh ? '这张邀请已关闭，不能再投稿或领取新的赠礼券。' : 'This invitation is closed. New contributions and vouchers are no longer available.'
  if (error.code === 'CONTRIBUTION_NOT_APPROVED') return zh ? '这份投稿尚未通过审核，暂时不能领取赠礼券。' : 'This contribution has not been approved, so its voucher cannot be collected yet.'
  if (error.code === 'SELF_REWARD_NOT_ALLOWED') return zh ? '发起人不能领取自己心愿的参与回礼。' : 'You cannot collect a participation reward from your own wish.'
  if (['GIFT_STORAGE_PERMISSION_REQUIRED', 'GIFT_PERMISSION_REQUIRED', 'STORY_STORAGE_PERMISSION_REQUIRED'].includes(error.code)) return zh ? '请到「我」里的「隐私与 AI 说明」同意说明，再回来继续。' : 'Agree to the statement in Me → Privacy & AI, then return to continue.'
  return fallback
}

function publicTitle(goal: Pick<GiftGoal, 'name' | 'kind'>, zh: boolean) {
  if (goal.kind === 'flight') return zh ? `给${goal.name}的一班邮船` : `A shared flight for ${goal.name}`
  if (goal.kind === 'home') return zh ? `给${goal.name}的一处小屋` : `A place for ${goal.name}`
  return zh ? `关于${goal.name}的共同回忆` : `Shared memories of ${goal.name}`
}

function Header({ title, onClose, disabled = false }: { title: string; onClose: () => void; disabled?: boolean }) {
  const { lang } = useI18n()
  return <header className="gg-header">
    <button disabled={disabled} onClick={onClose} aria-label={isZh(lang) ? '返回' : 'Back'}><I.Back /></button>
    <span>{title}<small>ELYSIUM / TOGETHER</small></span>
    <I.Gather className="gg-header-mark" aria-hidden="true" />
  </header>
}

export function GoalComposer(props:Parameters<typeof ScopedGoalComposer>[0]){return <ScopedGoalComposer key={JSON.stringify([props.serviceContext?.accountId,props.serviceContext?.sessionId,props.target.identity??props.target.id,props.initialKind])} {...props}/>}

function ScopedGoalComposer({ target, onClose, onCreated, initialKind = 'flight',serviceContext }: {
  target: GiftTarget
  onClose: () => void
  onCreated: (goal: GiftGoal) => void
  initialKind?: GoalKind
  serviceContext?:ReferralContext
}) {
  const { lang } = useI18n(), zh = isZh(lang)
  const pending=serviceContext&&target.identity?albumPending(albumCreateKey(serviceContext.accountId,target.identity)):undefined
  const [kind, setKind] = useState<GoalKind>(pending?('kind'in pending.body&&['album','home','flight'].includes(String(pending.body.kind))?pending.body.kind as GoalKind:'album'):initialKind)
  const [name, setName] = useState(pending&&'title'in pending.body?String(pending.body.title):target.name.slice(0, 40))
  const [message, setMessage] = useState(pending&&'message'in pending.body?String(pending.body.message):'')
  const lifetime=useRef<AbortController|undefined>(undefined)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const request = useRef({ id: '', fingerprint: '' }), lock = useRef(false), mounted = useRef(true)
  const root = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const close = () => { if (!lock.current) closeRef.current() }
  useNativeBack(() => { close(); return true }, true, 35, root)
  const firstField = useRef<HTMLInputElement>(null)
  useEffect(() => {
    mounted.current = true
    lifetime.current=new AbortController()
    firstField.current?.focus({ preventScroll: true })
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return
      event.preventDefault(); event.stopPropagation()
      if (!lock.current) closeRef.current()
    }
    document.addEventListener('keydown', escape)
    return () => { mounted.current = false;lifetime.current?.abort(); document.removeEventListener('keydown', escape) }
  }, [])

  async function publish() {
    if (lock.current || !name.trim() || !message.trim()) return
    const payload = { kind, world: target.world, name: name.trim(), message: message.trim() }
    const fingerprint = JSON.stringify(payload)
    if (request.current.fingerprint !== fingerprint) request.current = { id: crypto.randomUUID(), fingerprint }
    lock.current = true; setBusy(true); setError('')
    try {
      const goal = serviceContext?await createAlbum(serviceContext,target,name.trim(),message.trim(),lifetime.current?.signal,kind):await goalRequest<GiftGoal>('new', {
        id: request.current.id, ...payload,
      })
      if (!mounted.current) return
      haptic(12); chime('connect'); onCreated(goal)
    } catch {
      if (mounted.current) setError(serviceContext?(zh?'暂时看不到邀请是否发布成功，内容已保留。再点「发布这张邀请」继续，不会重复发布。':'We could not check whether the invitation was published. Select Publish invitation to continue without creating a duplicate.'):(zh ? '暂未确认发布结果。保持内容重试只创建一次；修改内容会发布新邀请。' : 'Could not confirm publication. Retry unchanged to keep this invitation; edited content creates a new one.'))
    } finally {
      lock.current = false
      if (mounted.current) setBusy(false)
    }
  }

  const first = kind === 'flight'
    ? (zh ? '发布时，你先投入 4 份启动补给。目标共 20 份，每位同行者补给 2 份。' : 'Start with 4 supply packs. The goal is 20. Each traveller adds 2.')
    : kind === 'home'
      ? (zh ? '先安放门牌，再一起添窗、灯、长椅、花箱和屋顶。共 6 个部件。' : 'Place the nameplate first, then add a window, lamp, bench, flower box and roof.')
      : (zh ? '你的这段话是第一段回忆。邀请朋友，一起留下 6 段故事。' : 'Your note is the first memory. Invite friends to collect six stories.')

  return <section ref={root} className="gg-overlay" role="dialog" aria-modal="true" aria-label={zh ? '发起共同目标' : 'Create a shared goal'}>
    <Header title={zh ? '一起做成一件事' : 'Make something together'} onClose={close} disabled={busy} />
    <main className="gg-scroll gg-composer">
      <div className="gg-intro"><span className="gg-eyebrow">MAKE IT TOGETHER</span><h1>{zh ? '把邀请留给一个具体心愿' : 'An invitation with a purpose'}</h1><p>{zh ? '让朋友知道为什么想完成它，也看得见自己的贡献。' : 'Let friends understand your wish and see what they add.'}</p></div>
      <div className="gg-kind-picker" role="group" aria-label={zh ? '共同目标类型' : 'Goal type'}>
        {(((!!serviceContext||initialKind === 'flight'||kind==='flight') ? ['flight', 'home', 'album'] : ['home', 'album']) as GoalKind[]).map(value => <button key={value} aria-pressed={kind === value} disabled={busy||!!pending} onClick={() => {if(!pending)setKind(value)}}>
          {value === 'flight' ? <I.PaperBird /> : value === 'home' ? <I.Place /> : <I.Story />}<span>{goalNames[value][zh ? 0 : 1]}</span>
        </button>)}
      </div>
      <div className="gg-recipe"><I.Signal aria-hidden="true"/><p>{first}</p></div>
      <form onSubmit={event => { event.preventDefault(); void publish() }}>
        <label className="gg-label">{zh ? '邀请中 TA 的称呼' : 'Name shown for them'}<input ref={firstField} value={name} maxLength={40} onChange={event => setName(event.target.value)} disabled={busy||!!pending} autoComplete="off" /></label>
        <label className="gg-label">{kind === 'album' ? (zh ? '你记得的第一段故事' : 'Your first memory') : (zh ? '想让同行者知道的一句话' : 'A note to fellow travellers')}
          <textarea value={message} maxLength={120} onChange={event => setMessage(event.target.value)} disabled={busy||!!pending}
            placeholder={zh ? (kind === 'home' ? '想给它留一处可以躲雨的小屋。你愿意添一扇窗吗？' : kind === 'album' ? '那次一起出门，你还记得哪一个瞬间？' : '以前，它最喜欢追那颗球。我想再给它寄一次。') : 'Tell friends why this matters to you.'} />
        </label>
        <section className="gg-public-preview" aria-label={zh ? '公开邀请预览' : 'Public invitation preview'}>
          <small>{serviceContext?(zh?'分享范围 · 仅公开名称和这句留言，投稿正文不公开':'Shared · only the title and note. Contributions stay private.'):(zh ? '分享范围 · 名称、目的地、这句留言与贡献记录' : 'Shared · name, destination, note and contributions')}</small>
          <h2>{publicTitle({ name: name || target.name, kind }, zh)}</h2>
          <p>{message || (zh ? '你写下的这句话，会出现在邀请里。' : 'Your note will appear in the invitation.')}</p>
          {!serviceContext&&<span>{destination(target.world, lang).place}</span>}
        </section>
        <p className="gg-caption">{serviceContext?(zh?'朋友投稿后，由你决定是否接受，再选择是否收进 TA 的记忆。通过后，参与者可为自己的账号领取一次基础赠礼券。':'You decide whether to accept each contribution and whether to save it to their memories. Approved participants can collect one basic gift voucher for their account.'):(zh ? '体验中的虚拟共寄。好友完成一次贡献，可获得一份基础回程邮资。' : 'A virtual shared gift. Each completed contribution earns one basic return postage.')}</p>
        {error && <p className="gg-error" role="alert">{error}</p>}
        <button className="gg-primary" disabled={busy || !name.trim() || !message.trim()} type="submit">{busy ? (zh ? '正在发布…' : 'Publishing…') : (zh ? '发布这张邀请' : 'Publish invitation')}</button>
      </form>
    </main>
  </section>
}

export function GiftGoalView({ id, owner, onClose, onReward, onAdopt, adopted = [],serviceContext,onServiceAdopted }: {
  id: string
  owner?: string
  onClose: () => void
  onReward?: (token: string) => void
  onAdopt?: (goalId: string, seat: number, text: string) => void
  adopted?: string[]
  serviceContext?:ReferralContext
  onServiceAdopted?:()=>void
}) {
  const { lang } = useI18n(), zh = isZh(lang)
  const reports=useContentReports()
  const service=import.meta.env.VITE_XIJIE_AUTH_MODE==='service'
  const lifetime=useRef<AbortController|undefined>(undefined),autoClaimed=useRef(false),mutationEpoch=useRef(0),reviewScope=useRef('')
  const viewKey=JSON.stringify([id,serviceContext?.accountId,serviceContext?.sessionId]);reviewScope.current=viewKey
  const [storedGoal,setStoredGoal]=useState<{key:string;value:GiftGoal|null}>({key:viewKey,value:null})
  const goal=storedGoal.key===viewKey?storedGoal.value:null
  const setGoal=(value:GiftGoal|null|((previous:GiftGoal|null)=>GiftGoal|null))=>setStoredGoal(previous=>reviewScope.current!==viewKey?previous:{key:viewKey,value:typeof value==='function'?value(previous.key===viewKey?previous.value:null):value})
  const [loading, setLoading] = useState(true), [failed, setFailed] = useState(false)
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const [text, setTextValue] = useState(''),[textScope,setTextScope]=useState(''), [retry, setRetry] = useState(0)
  const viewer=goal?.album?.viewerScope
  const setText=(value:string)=>{setTextValue(value);setTextScope(viewer?.id??'')}
  useEffect(()=>{if(service&&viewer?.id&&viewer.id!==textScope){setTextValue('');setTextScope(viewer.id)}},[viewer?.id,service,textScope])
  const [rewardStored, setRewardStored] = useState(false), [manualShare, setManualShare] = useState(false)
  const lock = useRef(false), mounted = useRef(true), rewardedCallback = useRef(''), activeId = useRef(id)
  activeId.current = id
  const adoptedSignature=useRef(''),adoptionCallback=useRef(onServiceAdopted)
  adoptionCallback.current=onServiceAdopted
  const rewardCallback = useRef(onReward)
  rewardCallback.current = onReward
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let live = true, reading = false
    const controller=new AbortController();lifetime.current=controller
    mutationEpoch.current++;lock.current=false;setBusy(false);setLoading(true); setGoal(null); setText(''); setNotice(''); setRewardStored(false); setManualShare(false)
    async function read() {
      if (reading||lock.current) return
      reading = true;const epoch=mutationEpoch.current
      try {
        const next = service?await readAlbum(id,serviceContext,controller.signal):await getGiftGoal(id)
        if (live&&!lock.current&&epoch===mutationEpoch.current) { setGoal(old => !service&&old && old.current > next.current ? old : next); setFailed(false) }
      } catch { if (live&&!lock.current&&epoch===mutationEpoch.current) {setFailed(true);if(service)setGoal(null)} }
      finally { reading = false; if (live) setLoading(false) }
    }
    void read()
    const timer = window.setInterval(() => { if (!document.hidden) void read() }, 1500)
    const focus = () => { if (!document.hidden) void read() }
    document.addEventListener('visibilitychange', focus)
    return () => { live = false;controller.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', focus) }
  }, [id, retry,serviceContext?.sessionId,serviceContext?.accountId])

  useEffect(() => {
    const token = goal?.rewardToken
    if (service||!owner || !token) return
    let live = true
    void claimGoalReward(owner, token).then(() => {
      if (!live) return
      setRewardStored(true)
      if (rewardedCallback.current !== owner + token) {
        rewardedCallback.current = owner + token
        rewardCallback.current?.(token)
      }
    }).catch((error: unknown) => {
      if (!live) return
      setNotice(error instanceof GoalError && error.code === 'already-claimed'
        ? (zh ? '这份贡献回礼已存入另一个本机账号。' : 'Another local account already collected this contribution reward.')
        : (zh ? '回程邮资尚未存入背包，仍为你保留。重新读取本页可重试。' : 'Your return postage is reserved. Reopen this page to try saving it again.'))
    })
    return () => { live = false }
  }, [owner, goal?.rewardToken, retry, zh])
  useEffect(()=>{if(service)setRewardStored(goal?.album?.ownContribution?.reward?.status==='fulfilled')},[goal,service])
  useEffect(()=>{if(service&&!serviceContext&&goal?.helped&&new URLSearchParams(location.search).get('claim')==='1'&&!autoClaimed.current){autoClaimed.current=true;void claim()}},[goal?.helped,serviceContext])

  useEffect(()=>{if(!service||!serviceContext||!goal)return;const signature=JSON.stringify(goal.contributions.filter(c=>c.adoption?.status==='fulfilled').map(c=>c.contributionId).sort());if(adoptedSignature.current!==signature){adoptedSignature.current=signature;adoptionCallback.current?.()}},[goal,service,serviceContext?.accountId])

  const unit = goal?.kind === 'flight' ? (zh ? '份补给' : 'supply packs') : goal?.kind === 'home' ? (zh ? '个部件' : 'parts') : (zh ? '段回忆' : 'memories')
  const amount = goal?.kind === 'flight' ? 2 : 1
  const defaultText = zh ? '愿你沿路有光。' : 'May light follow you.'
  const pendingReviews=service&&serviceContext&&goal?.isOwner?pendingAlbumReviews(serviceContext,id):[]
  const contributionIntent=service&&viewer?albumPending(albumContributionKey(id,viewer),viewer):undefined
  const enteredText=contributionIntent&&'text'in contributionIntent.body?String(contributionIntent.body.text):!service||textScope===viewer?.id?text:''
  const contributionText = enteredText.trim() || (goal?.kind === 'album' ? '' : defaultText)
  const remaining = goal ? Math.max(0, goal.target - goal.current) : 0

  async function help() {
    if (lock.current || !goal?.canHelp || !contributionText) return
    lock.current = true; setBusy(true); setNotice('')
    try {
      const next = service?await contributeAlbum(id,contributionText,lifetime.current?.signal,viewer):await goalRequest<GiftGoal>(encodeURIComponent(id) + '/help', { text: contributionText })
      if (!mounted.current || activeId.current !== id) return
      setGoal(next); haptic([10, 30, 20]); chime('connect')
      const contributionStatus = next.album?.ownContribution?.status
      setNotice(service ? contributionStatus === 'withdrawn' ? (zh ? '你的投稿已撤回。' : 'Your contribution has been withdrawn.')
        : contributionStatus === 'rejected' ? (zh ? '本次投稿未通过审核。' : 'This contribution was not approved.')
        : contributionStatus === 'approved' ? (zh ? '你的投稿已保存并通过审核。' : 'Your contribution is saved and approved.')
        : (zh ? '你的投稿已保存，正在等待审核。' : 'Your contribution is saved and awaiting review.')
        : (zh ? '你的贡献与祝愿已收好。' : 'Your contribution and wish are saved.'))
    } catch (error) {
      if (!mounted.current || activeId.current !== id) return
      if(error instanceof AlbumError&&['ALBUM_VIEWER_CHANGED','VIEWER_SCOPE_CHANGED'].includes(error.code)){setText('');setGoal(null);setLoading(true);setNotice(zh?'账号已切换，请刷新邀请后重新填写。':'Your account changed. Refresh the invitation before entering a new contribution.')}
      else if (error instanceof GoalError && error.goal) {
        setGoal(error.goal)
        setNotice(zh ? '这份目标刚刚已完成，可以看看大家留下的成果。' : 'The goal just completed. You can view the shared result.')
      } else setNotice(albumIssue(error,zh,zh ? '暂时看不到投稿是否成功。可以再提交一次，不会重复计入。' : 'We could not check whether your contribution was saved. Submit again; it will only count once.'))
    } finally { lock.current = false; if (mounted.current) setBusy(false) }
  }

  async function share() {
    if (!goal||goal.album&&!goal.album.url) return
    const detail = goal.album?goal.message:goal.completed
      ? (zh ? `${publicTitle(goal, true)}已完成，一起看看大家的贡献。` : `${publicTitle(goal, false)} is complete. See what everyone added.`)
      : (zh ? `${goal.message}\n还差 ${remaining} ${unit}，你的这次参与会增加 ${amount} ${unit}。` : `${goal.message}\n${remaining} ${unit} remaining. Your contribution adds ${amount}.`)
    try {
      if (navigator.share) await navigator.share({ title: publicTitle(goal, zh), text: detail, url: goal.album?.url??goalUrl(id) })
      else { await navigator.clipboard.writeText(detail + '\n' + (goal.album?.url??goalUrl(id))); setNotice(zh ? '邀请与地址已复制。' : 'Invitation and link copied.') }
    } catch (error) { if ((error as Error).name !== 'AbortError') setManualShare(true) }
  }

  async function claim() {
    if(service){if(busy)return;setBusy(true);try{const result=await claimAlbum(id,lifetime.current?.signal,viewer);if(mounted.current&&result){setRewardStored(result.status==='fulfilled');setNotice(result.status==='fulfilled'?(zh?'赠礼券已到账。':'Your voucher has arrived.'):(zh?'正在存入赠礼券，请稍后回看。':'Your voucher is being delivered.'));setRetry(v=>v+1)}}catch(error){if(mounted.current){if(error instanceof AlbumError&&['ALBUM_VIEWER_CHANGED','VIEWER_SCOPE_CHANGED'].includes(error.code)){setText('');setGoal(null);setLoading(true)}setNotice(albumIssue(error,zh,zh?'暂时看不到赠礼券是否到账，请再点「领取赠礼券」。同一份心愿不会重复发券。':'We could not check whether the voucher arrived. Select Collect gift voucher again; each wish only awards it once.'))}}finally{if(mounted.current)setBusy(false)}return}
    if (!goal?.rewardToken) return
    try { sessionStorage.setItem('elysium.giftReward', goal.rewardToken) } catch { /* The link also carries the earned token. */ }
    location.assign(import.meta.env.BASE_URL + '?giftReward=' + encodeURIComponent(goal.rewardToken))
  }
  async function adopt(contributionId:string){if(!serviceContext||busy)return;setBusy(true);try{const result=await adoptAlbum(serviceContext,id,contributionId,lifetime.current?.signal);if(mounted.current){setNotice(result.status==='fulfilled'?(zh?'已收进 TA 的记忆。':'Saved to their memories.'):(zh?'正在收好这段记忆，请稍后查看。':'The memory is being saved.'));if(result.status==='fulfilled')onServiceAdopted?.();setRetry(v=>v+1)}}catch{if(mounted.current)setNotice(zh?'暂时看不到这段记忆是否保存成功，请再试一次。':'We could not check whether this memory was saved. Please retry.')}finally{if(mounted.current)setBusy(false)}}
  async function withdraw(){const c=goal?.album?.ownContribution;if(!c||busy)return;setBusy(true);try{const next=await withdrawAlbum(id,c.id,lifetime.current?.signal,viewer);if(mounted.current)setGoal(next)}catch(error){if(mounted.current){if(error instanceof AlbumError&&['ALBUM_VIEWER_CHANGED','VIEWER_SCOPE_CHANGED'].includes(error.code)){setText('');setGoal(null);setLoading(true)}setNotice(albumIssue(error,zh,zh?'暂时看不到撤回是否完成，请再点「撤回我的投稿及后续使用」。':'We could not check whether the contribution was withdrawn. Select Withdraw my contribution and future use again.'))}}finally{if(mounted.current)setBusy(false)}}
  async function review(snapshot:AlbumReviewSnapshot,decision:'approve'|'reject'){
    if(!serviceContext||!goal?.isOwner||reviewScope.current!==viewKey||busy||lock.current)return
    const scope=viewKey;lock.current=true;setBusy(true);setNotice('');mutationEpoch.current++
    try{const next=await reviewAlbum(serviceContext,id,snapshot,decision,lifetime.current?.signal);if(mounted.current&&reviewScope.current===scope){setGoal(next);const current=next.contributions.find(c=>c.contributionId===snapshot.id);setNotice(current?.status==='approved'?(zh?'已接受这份心意，完成进度已更新。':'Accepted. The shared progress has been updated.'):current?.status==='rejected'?(zh?'这份投稿已拒绝，不会增加进度。':'Rejected. This contribution does not add progress.'):(zh?'这份投稿已被撤回或无法查看，不再计入进度。':'This contribution was withdrawn or is no longer available and does not add progress.'))}}
    catch(error){if(mounted.current&&reviewScope.current===scope)setNotice(error instanceof AlbumError&&error.status===412?(zh?'这份投稿刚刚有变化，请在下方查看最新投稿后重新选择。':'This contribution changed. View the latest contribution below before deciding again.'):(zh?'上次处理还没有完成，已保留你的选择。请点下方「继续处理」。':'Your previous choice is kept. Select Continue below to finish the same review.'))}
    finally{if(reviewScope.current===scope){mutationEpoch.current++;lock.current=false;if(mounted.current)setBusy(false)}}
  }
  async function closePublic(){if(!serviceContext||busy)return;setBusy(true);try{const next=await closeAlbum(serviceContext,id,lifetime.current?.signal);if(mounted.current)setGoal(next)}catch{if(mounted.current)setNotice(zh?'暂时看不到邀请是否已关闭，请再试一次。':'We could not check whether the invitation was closed. Please retry.')}finally{if(mounted.current)setBusy(false)}}

  let content
  if (loading && !goal) content = <div className="gg-empty"><I.Signal /><h1>{zh ? '正在打开邀请…' : 'Opening invitation…'}</h1></div>
  else if (!goal) content = <div className="gg-empty"><I.Mail /><h1>{zh ? '暂未找到这份邀请' : 'Invitation unavailable'}</h1><p>{zh ? '可以刷新再试，或返回西界。' : 'Refresh to try again or return to Elysium.'}</p><button className="gg-primary" onClick={() => setRetry(value => value + 1)}>{zh ? '刷新' : 'Refresh'}</button></div>
  else content = <>
    <section className="gg-hero gg-hero-interactive">
      <Suspense fallback={<div style={{height:220}}/>}><GiftGoalScene kind={goal.kind} current={goal.current} target={goal.target} parts={goal.parts} world={goal.world}/></Suspense>
      <div className="gg-hero-caption">
      <small>{goal.isOwner ? (zh ? '你发起的共同心愿' : 'Your shared wish') : (zh ? '一份邀请，等你的那一份心意' : 'An invitation to add something of your own')}</small>
      <h1>{goal.album?.status==='closed'?(zh?'这张邀请已关闭':'This invitation is closed'):publicTitle(goal, zh)}</h1>{!service&&<span>{destination(goal.world, lang).place}</span>}
      </div>
    </section>
    <div className="gg-content">
      {goal.message&&<blockquote>{goal.message}</blockquote>}
      {goal.album?.status==='closed'&&<p className="gg-caption">{zh?'你的投稿仍可在此查看或撤回。':'You can still view or withdraw your contribution here.'}</p>}
      <section className="gg-goal" aria-label={zh ? '共同进度' : 'Shared progress'}>
        <div className="gg-count"><strong>{goal.completed ? (zh ? '这份心愿已完成' : 'Together, complete') : (zh ? `还差 ${remaining} ${unit}` : `${remaining} ${unit} remaining`)}</strong><span>{goal.current} / {goal.target}</span></div>
        {goal.kind === 'home'
          ? <div className="gg-parts">{homeParts.map((part, index) => <div key={part} data-done={goal.parts.includes(part)}><span>{goal.parts.includes(part) ? <I.Check /> : <I.Plus />}</span>{zh ? part : homePartsEn[index]}</div>)}</div>
          : goal.kind === 'album'
            ? <div className="gg-memory-cells">{Array.from({ length: goal.target }, (_, index) => <span key={index} data-done={index < goal.current}><I.Story />{String(index + 1).padStart(2, '0')}</span>)}</div>
            : <div className="gg-fuel" role="progressbar" aria-label={zh ? '补给进度' : 'Fuel progress'} aria-valuenow={goal.current} aria-valuemin={0} aria-valuemax={goal.target}>{Array.from({ length: goal.target }, (_, index) => <i key={index} data-done={index < goal.current} />)}</div>}
        <p className="gg-rule">{goal.kind === 'flight' ? (zh ? '发起人已投入 4 份，每位同行者固定补给 2 份。' : 'The sender contributes 4. Each traveller adds exactly 2.') : goal.kind === 'home' ? (zh ? '每位同行者添一个部件，完成后保留每一份贡献。' : 'Each traveller adds one part. The finished work keeps every contribution.') : (zh ? '每位同行者留一段回忆，一起做成一份可回看的故事集。' : 'Each traveller adds a memory to a book you can revisit.')}</p>
      </section>
      {goal.canHelp && <form className="gg-help" onSubmit={event => { event.preventDefault(); void help() }}>
        {service&&<p className="gg-caption">{zh?'只有你和发起人能看到投稿。提交后，发起人可在审核通过后把它收进 TA 的记忆；TA 今后的 AI 回应可能提到这段内容。你可在此撤回投稿，并停止后续使用。':'Only you and the sender can read your contribution. After approval, the sender may save it to the character’s memories, and future AI replies may mention it. You can withdraw your contribution and stop future use here.'}</p>}
        <label className="gg-label">{goal.kind === 'album' ? (zh ? '你记得的那一段' : 'The part you remember') : (zh ? '捎上的祝愿（可改写）' : 'Your enclosed wish (optional)')}
          <textarea value={enteredText} maxLength={120} onChange={event => setText(event.target.value)} placeholder={goal.kind === 'album' ? (zh ? '那时，我们一起……' : 'I remember when we…') : defaultText} disabled={busy||!!contributionIntent} />
        </label>
        <div className="gg-reward-note"><I.Mailbox /><p>{service?(zh?'审核通过后可领取一张基础赠礼券，为想念的 TA 寄一件基础礼物。':'After approval, collect one basic gift voucher to send an eligible gift to someone you miss.'):(zh ? '贡献完成后，你会得到一份基础回程邮资，可为自己的对象寄一件礼物。' : 'After contributing, receive one basic return postage for a gift of your own.')}</p></div>
        <button className="gg-primary" type="submit" disabled={busy || !contributionText}>{busy ? (zh ? '正在提交…' : 'Submitting…') : goal.kind === 'flight' ? (zh ? '捎祝愿并补给 +2' : 'Enclose wish & add 2 supply packs') : goal.kind === 'home' ? (zh ? '添上一个部件' : 'Add one part') : (zh ? '留下这段共同回忆' : 'Add this memory')}</button>
      </form>}
      {goal.helped && <section className="gg-postage">
        <small>RETURN POSTAGE / {id.slice(0, 6).toUpperCase()}</small><h2>{zh ? '也给你的一次寄件' : 'A parcel of your own'}</h2>
        <p>{service?(rewardStored?(zh?'基础赠礼券已到账，可以用来寄一件基础礼物。':'Your basic gift voucher has arrived. Use it to send one eligible gift.'):(zh?'这次投稿已通过审核，可以领取一张基础赠礼券。':'Your contribution has been approved. You can collect one basic gift voucher.')):rewardStored ? (zh ? '回程邮资已存入你的背包。' : 'Return postage is in your backpack.') : (zh ? '这次帮助已记入，一份基础回程邮资已为你保留。' : 'Your contribution is recorded and one basic return postage is reserved.')}</p>
        {owner ? <button className="gg-primary" onClick={onClose}>{zh ? '回去挑一件自己的礼物' : 'Choose a gift of my own'}</button> : <button className="gg-primary" onClick={service && rewardStored ? onClose : claim}>{service ? rewardStored ? (zh ? '去挑礼物' : 'Choose a gift') : (zh ? '领取赠礼券' : 'Collect gift voucher') : (zh ? '用回程邮资挑礼物' : 'Use my return postage')}</button>}
      </section>}
      {goal.isOwner && goal.album?.status!=='closed' && <div className="gg-owner-note"><I.Keep /><p>{goal.completed ? (zh ? '共同成果与每一份贡献已保存在这张邀请里。' : 'The shared result and every contribution are saved here.') : (zh ? '你的第一份投入已记入。把邀请交给愿意一起完成它的人。' : 'Your first contribution is recorded. Invite someone to help complete it.')}</p></div>}
      <button disabled={!!goal.album&&!goal.album.url} className={goal.isOwner && !goal.completed ? 'gg-primary' : 'gg-secondary'} onClick={share}>{goal.completed ? (zh ? '分享这份共同成果' : 'Share the result') : (zh ? '把邀请递给下一位' : 'Pass the invitation on')}</button>
      {manualShare && <label className="gg-label">{zh ? '复制邀请地址' : 'Copy invitation link'}<input readOnly value={goal.album?.url??goalUrl(id)} onFocus={event => event.target.select()} /></label>}
      {serviceContext&&goal.album?.url&&<button disabled={busy} className="gg-secondary" onClick={closePublic}>{zh?'关闭这张公开邀请':'Close this public invitation'}</button>}
      {goal.album?.ownContribution&&goal.album.ownContribution.status!=='withdrawn'&&<button disabled={busy} className="gg-secondary" onClick={withdraw}>{zh?'撤回我的投稿及后续使用':'Withdraw my contribution and future use'}</button>}
      <p className="gg-notice" role="status">{notice || (failed ? (zh ? '暂时连接不上，正在重新加载进度。' : 'Connection lost. Reloading the shared progress.') : '')}</p>
      <section className="gg-contributions"><h2>{service&&!goal.isOwner?(zh?'你留下的那一份':'Your contribution'):(zh ? '每个人留下的那一份' : 'What everyone added')}</h2>{goal.contributions.map(entry => <article key={entry.contributionId??entry.seat}>
        <span>{entry.seat<0?'…':String(entry.seat + 1).padStart(2, '0')}</span><div><strong>{entry.seat<0?(zh?'投稿者':'Contributor'):entry.seat === 0 ? (zh ? '发起人' : 'Sender') : (zh ? `同行者 ${entry.seat + 1}` : `Traveller ${entry.seat + 1}`)}<em>{entry.part ? (zh ? entry.part : homePartsEn[homeParts.indexOf(entry.part)]) : `+${entry.value} ${unit}`}</em></strong><p>{entry.text}</p>
          {service&&entry.status&&<small>{entry.status==='pending'?(zh?'等待审核':'Awaiting review'):entry.status==='rejected'?(zh?'本次投稿未通过审核':'This contribution was not approved'):(zh?'审核通过':'Approved')}</small>}
          {reports&&serviceContext&&entry.contributionId&&<button className="gg-secondary" onClick={()=>reports.open({subjectType:'contribution',subjectId:entry.contributionId!})}>{zh?'举报':'Report'}</button>}
          {serviceContext&&entry.status==='pending'&&entry.contributionId&&entry.version&&!pendingReviews.some(p=>p.contributionId===entry.contributionId)&&<div className="flex gap-2"><button className="gg-secondary" disabled={busy||goal.completed||goal.album?.status==='closed'} onClick={()=>void review({id:entry.contributionId!,text:entry.text,status:'pending',version:entry.version!},'approve')}>{zh?'接受这份心意':'Accept this contribution'}</button><button className="gg-secondary" disabled={busy||goal.album?.status==='closed'} onClick={()=>void review({id:entry.contributionId!,text:entry.text,status:'pending',version:entry.version!},'reject')}>{zh?'不接受这份投稿':'Reject this contribution'}</button></div>}
          {serviceContext&&entry.status==='approved'&&entry.contributionId&&<button className="gg-secondary" disabled={busy||entry.adoption?.status==='fulfilled'||entry.adoption?.status==='pending'} onClick={()=>void adopt(entry.contributionId!)}>{entry.adoption?.status==='fulfilled'?(zh?'已收进记忆':'Saved to memories'):entry.adoption?.status==='pending'?(zh?'正在收好…':'Saving…'):(zh?'收进 TA 的记忆':'Save to their memories')}</button>}
          {!service&&goal.kind === 'album' && goal.isOwner && owner && onAdopt && <button className="gg-secondary" disabled={adopted.includes(goal.id + ':' + entry.seat)}
            onClick={() => onAdopt(goal.id, entry.seat, entry.text)}>{adopted.includes(goal.id + ':' + entry.seat)
              ? (zh ? '已收进记忆' : 'Saved to memories') : (zh ? '收进 TA 的记忆' : 'Save to their memories')}</button>}
        </div>
      </article>)}</section>
      {pendingReviews.length>0&&<section className="gg-contributions" aria-label={zh?'尚未完成的处理':'Unfinished reviews'}><h2>{zh?'继续上次的处理':'Continue your previous review'}</h2>{pendingReviews.map(pending=><article key={pending.key}><span>…</span><div><strong>{pending.body.decision==='approve'?(zh?'上次选择：接受':'Previous choice: accept'):(zh?'上次选择：不接受':'Previous choice: reject')}</strong>{goal.contributions.some(c=>c.contributionId===pending.contributionId)?<p>{pending.snapshot.text}</p>:<p>{zh?'这份投稿暂时看不到，仍可继续查询上次的处理结果。':'This contribution is not available. You can still check the outcome of your previous review.'}</p>}{pending.rejectedCode?<><p>{zh?'上次选择没有保存，请查看最新投稿后重新选择。':'Your previous choice was not saved. View the latest contribution before deciding again.'}</p><button className="gg-secondary" disabled={busy} onClick={()=>{if(!serviceContext)return;try{retireRejectedAlbumReview(serviceContext,id,pending.contributionId);setRetry(v=>v+1)}catch{setNotice(zh?'暂时无法重新打开投稿，请再试一次。':'The contribution could not be reopened. Please retry.')}}}>{zh?'查看最新投稿':'View latest contribution'}</button></>:<button className="gg-secondary" disabled={busy} onClick={()=>void review(pending.snapshot,pending.body.decision)}>{zh?'继续处理':'Continue'}</button>}</div></article>)}</section>}
      <p className="gg-caption">{service?(zh?'只有标题和附言公开。虚拟进度不扣邮资；每位参与者在这份心愿中可领取一次基础赠礼券。':'Only the title and note are public. Virtual progress does not spend postage; each participant can receive one basic gift voucher per wish.'):(zh ? '虚拟共寄体验 · 同一浏览器在每个目标中贡献一次。回程邮资适用于基础虚拟寄件。' : 'Virtual shared-gift pilot. One contribution per browser per goal. Return postage covers a basic virtual parcel.')}</p>
    </div>
  </>

  return <section className="gg-overlay" aria-label={zh ? '共同心愿' : 'Shared wish'}>
    <Header title={zh ? '共同心愿' : 'A shared wish'} onClose={onClose} />
    <main className="gg-scroll">{content}</main>
  </section>
}

export function GiftGoalEntry() {
  const id = location.pathname.match(/\/gifts\/([^/]+)\/?$/)?.[1] ?? ''
  return <LangProvider><PublicGiftFrame><GiftGoalView id={id} onClose={() => location.assign(import.meta.env.BASE_URL)} /></PublicGiftFrame></LangProvider>
}
