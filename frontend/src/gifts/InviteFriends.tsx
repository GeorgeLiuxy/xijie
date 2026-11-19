import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { LangProvider, isZh, useI18n } from '../i18n'
import { I, NightCtx, useStatusTone } from '../ui'
import { PublicGiftFrame } from './PublicGiftFrame'
import { ContextSheet } from '../mobile/ContextSheet'
import { getPublicInvite, inviteStatus, inviteUrl, syncInviteRewards, type InviteStatus } from './client'
import {createReferralClient,publicReferral,joinReferral,type ReferralContext} from '../serviceReferrals'
import './goals.css'
import './invite.css'

function RewardRules() {
  const { lang } = useI18n(), zh = isZh(lang)
  return <ol className="gi-rules">
    <li><span>1</span><p>{zh ? '朋友从邀请首次加入西界' : 'Your friend joins Elysium for the first time through the invitation.'}</p></li>
    <li><span>2</span><p>{zh ? '找到想念的 TA，保存第一段记忆' : 'They find someone they miss and save their first memory.'}</p></li>
  </ol>
}

export function InviteFriends({ owner, nickname, onClose, onUseReward, rewardActionLabel, presentation = 'page',serviceContext }: {
  owner: string; nickname?: string; onClose: () => void; onUseReward: () => void; rewardActionLabel?: string; presentation?: 'sheet' | 'page';serviceContext?:ReferralContext
}) {
  const { lang } = useI18n(), zh = isZh(lang)
  useStatusTone(useContext(NightCtx) ? 'light' : 'dark')
  const [status, setStatus] = useState<InviteStatus | null>(null)
  const [name, setName] = useState((nickname || (zh ? '一位朋友' : 'A friend')).slice(0, 32))
  const [refresh, setRefresh] = useState(0), [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false), [stored, setStored] = useState(false)
  const [shareNote, setShareNote] = useState(''), [manual, setManual] = useState(false)
  const [ticketOpen, setTicketOpen] = useState(false), [ticketMessage, setTicketMessage] = useState('')
  const back = useRef<HTMLButtonElement>(null)
  const service=useMemo(()=>serviceContext?createReferralClient(serviceContext):undefined,[serviceContext?.accountId,serviceContext?.sessionId])
  useEffect(()=>{service?.activate();return()=>service?.dispose()},[service])
  useEffect(() => { if (presentation === 'page') back.current?.focus({ preventScroll: true }) }, [presentation])
  useEffect(() => {
    let live = true, reading = false
    async function read() {
      if (reading || document.hidden) return
      reading = true
      try {
        const next = service?await service.status():await inviteStatus(owner)
        if (!live) return
        setStatus(next)
        if(!service)await syncInviteRewards(owner, next)
        if (live) { setStored(true); setFailed(false) }
      } catch { if (live) { setFailed(true); setStored(false) } }
      finally { reading = false }
    }
    void read()
    const timer = window.setInterval(read, 3500)
    document.addEventListener('visibilitychange', read)
    return () => { live = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', read) }
  }, [owner, refresh,service])
  async function create() {
    if (busy || !name.trim()) return
    setBusy(true)
    try { setStatus(service?await service.create(name.trim()):await inviteStatus(owner, name.trim())); setFailed(false); setRefresh(n => n + 1) }
    catch { setFailed(true) } finally { setBusy(false) }
  }
  async function share(message?: string) {
    if (!status?.inviteId) return
    const url = status.shareUrl??inviteUrl(status.inviteId)
    const title = zh ? status.publicName + '邀请你加入西界' : status.publicName + ' invites you to Elysium'
    const text = message === undefined ? undefined : [title, message.trim()].filter(Boolean).join('\n')
    try {
      if (navigator.share) await navigator.share({ title, url, ...(text && { text }) })
      else {
        await navigator.clipboard.writeText(text ? text + '\n' + url : url)
        setShareNote(text ? (zh ? '邀请船票已复制。' : 'Invitation ticket copied.')
          : (zh ? '邀请链接已复制。' : 'Invitation link copied.'))
      }
    } catch (error) { if ((error as Error).name !== 'AbortError') setManual(true) }
  }
  async function revoke(){if(!service||!status?.inviteId||!status.linkVersion||busy)return;setBusy(true);try{setStatus(await service.revoke(status.inviteId,status.linkVersion));setShareNote('');setManual(false);setTicketOpen(false);setTicketMessage('');setFailed(false)}catch{setFailed(true)}finally{setBusy(false)}}
  const friends = status?.friends ?? []
  const sheet = presentation === 'sheet'
  const title = zh ? '邀请朋友' : 'Invite friends'
  const close = () => { if (!busy) onClose() }
  const content = <section className={sheet ? 'gi-page gi-sheet-layout' : 'gg-overlay gi-page'} role={sheet ? undefined : 'dialog'} aria-modal={sheet ? undefined : true} aria-label={sheet ? undefined : title} onKeyDown={sheet ? undefined : event => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); event.stopPropagation(); close() }
  }}>
    <header className="gg-header"><button ref={back} data-context-close disabled={busy} onClick={close} aria-label={zh ? '返回' : 'Back'}><I.Back /></button><span>{title}</span></header>
    <main className="gg-scroll gi-content">
      <h1>{zh ? '邀请朋友，得赠礼券' : 'Invite a friend. Share a gift.'}</h1>
      <p className="gi-benefit"><strong>{zh ? '你和朋友各得 1 张基础赠礼券。' : 'You each receive 1 basic gift voucher.'}</strong><span>{zh ? '可寄一件不超过 8 邮资的基础礼物。' : 'Each voucher sends one basic gift worth up to 8 postage.'}</span></p>
      <h2 className="gi-conditions-title">{zh ? '朋友完成这两步后到账' : 'Awarded after your friend completes both steps'}</h2>
      <RewardRules />
      {status && <div className="gi-share">
        {!status.inviteId && <label className="gg-label">{zh ? '邀请中展示的称呼' : 'Your name on the invitation'}
          <input maxLength={32} value={service?.pendingName??name} disabled={busy||!!service?.pendingName} onChange={event => setName(event.target.value)} /></label>}
        <div className="gi-preview"><I.Mail /><div><b>{(status.publicName || name.trim() || '…') + (zh ? '邀请你加入西界' : ' invites you to Elysium')}</b>
          <small>{zh ? '分享卡只展示这个称呼和参与规则。' : 'Only this name and the invitation rules are shared.'}</small></div></div>
        {status.inviteId
          ? <button className="gg-primary" onClick={() => void share()}>{zh ? '分享邀请链接' : 'Share invitation'}</button>
          : <button className="gg-primary" disabled={busy || !name.trim()} onClick={create}>{busy ? (zh ? '正在生成…' : 'Creating…') : service?.pendingName ? (zh ? '继续生成邀请' : 'Continue creating invitation') : (zh ? '生成我的邀请' : 'Create my invitation')}</button>}
        {service && status.inviteId && <button type="button" className="gg-secondary" aria-expanded={ticketOpen} onClick={() => setTicketOpen(!ticketOpen)}>
          {ticketOpen ? (zh ? '收起邀请船票' : 'Close ticket preview') : (zh ? '预览邀请船票' : 'Preview invitation ticket')}
        </button>}
        {service && status.inviteId && ticketOpen && <section className="gi-ticket" aria-label={zh ? '邀请船票预览' : 'Invitation ticket preview'}>
          <div className="gi-ticket__paper">
            <I.PaperBird aria-hidden />
            <p>{zh ? '西界 · 邀请船票' : 'Elysium · Invitation ticket'}</p>
            <h3>{status.publicName + (zh ? '邀请你来到西界' : ' invites you to Elysium')}</h3>
            {ticketMessage.trim() && <p className="gi-ticket__message">{ticketMessage.trim()}</p>}
          </div>
          <label className="gg-label">{zh ? '给朋友的留言（可选）' : 'Message for your friend (optional)'}
            <input value={ticketMessage} maxLength={120} onChange={event => setTicketMessage(event.target.value)} />
          </label>
          <button type="button" className="gg-secondary" onClick={() => void share(ticketMessage)}>{zh ? '分享这张船票' : 'Share this ticket'}</button>
        </section>}
        {service&&status.inviteId&&<button className="gg-secondary" disabled={busy} onClick={revoke}>{zh?'停止使用此邀请链接':'Stop using this invitation link'}</button>}
        {manual && status.inviteId && <label className="gg-label">{zh ? '复制此链接' : 'Copy this link'}<input readOnly value={status.shareUrl??inviteUrl(status.inviteId)} onFocus={e => e.currentTarget.select()} /></label>}
        {shareNote && <p role="status">{shareNote}</p>}
      </div>}
      {status ? <details className="gi-records">
        <summary><span>{zh ? '邀请记录' : 'Your invitations'}</span><span className="gi-record-count">{friends.length}</span><I.Chevron aria-hidden /></summary>
        <div className="gi-record-content">
        {!friends.length && <p>{zh ? '朋友从邀请首次加入后，进度会出现在这里。' : 'Progress appears here when a new friend joins.'}</p>}
        {friends.map((friend, index) => <div className="gi-entry" key={friend.joinedAt + '-' + index}>
          {friend.memoryAt ? <I.Check /> : <I.Time />}<span><b>{friend.memoryAt ? (zh ? '已保存第一段记忆' : 'First memory saved') : (zh ? '已加入 · 等待第一段记忆' : 'Joined · awaiting a first memory')}</b>
            <small>{new Date(friend.joinedAt).toLocaleDateString(lang)}</small></span></div>)}
        </div>
      </details> : !failed && <p role="status">{zh ? '正在读取邀请…' : 'Loading invitations…'}</p>}
      {stored && !!(status?.rewardedCount??status?.rewards.length) && <button className="gg-secondary gi-reward-action" onClick={onUseReward}>{rewardActionLabel ?? (zh ? '查看我的赠礼券' : 'View my gift vouchers')}</button>}
      {failed && <div className="gg-error" role="status">{service?.pendingName ? (zh ? '邀请链接暂时还没生成完成，称呼已保留。请点「继续生成邀请」。' : 'The invitation is not finished. Your name is kept; select Continue creating invitation.') : (zh ? '邀请和赠礼券暂时更新不了，进度会保留。请刷新再试。' : 'Invitation and voucher updates are unavailable. Your progress is kept; refresh to try again.')}
        <button className="gg-secondary" onClick={() => setRefresh(n => n + 1)}>{zh ? '刷新' : 'Refresh'}</button></div>}
      <p className="gg-caption">{service?(zh?'生成邀请后，只记录朋友是否首次加入、保存首段记忆和奖励到账进度。双方的故事不会公开。':'Creating an invitation records joining, first-memory and reward progress. Your stories stay private.'):(zh ? '本地体验：以首次使用的浏览器和演示登录身份记录邀请。' : 'Local preview: invitations use a new browser and its local demo login.')}</p>
    </main>
  </section>
  return sheet ? <ContextSheet label={title} onClose={onClose} closeDisabled={busy} className="gi-context-sheet">{content}</ContextSheet> : content
}

function PublicInvite({ id }: { id: string }) {
  const { lang } = useI18n(), zh = isZh(lang)
  const [result, setResult] = useState<{ publicName: string } | null>(null), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0)
  const service=import.meta.env.VITE_XIJIE_AUTH_MODE==='service'
  const [joining,setJoining]=useState(false),[joinFailed,setJoinFailed]=useState(false)
  const joinController=useRef<AbortController|undefined>(undefined)
  useEffect(()=>()=>joinController.current?.abort(),[])
  useEffect(() => {
    let live = true; setFailed(false)
    const controller=new AbortController()
    void (service?publicReferral(id,controller.signal):getPublicInvite(id)).then(info => { if (live) setResult(info) }).catch(() => { if (live) setFailed(true) })
    return () => { live = false;controller.abort() }
  }, [id, retry])
  async function enter(){if(joining)return;setJoining(true);setJoinFailed(false);const controller=new AbortController();joinController.current=controller;try{await joinReferral(id,controller.signal);if(!controller.signal.aborted)location.assign(import.meta.env.BASE_URL)}catch{if(!controller.signal.aborted){setJoinFailed(true);setJoining(false)}}}
  return <main className="gg-overlay gi-page"><div className="gg-scroll gi-content gi-public">
    {result ? <><span className="gi-seal"><I.PaperBird /></span>
      <p>{result.publicName || (zh ? '一位朋友' : 'A friend')}{zh ? '邀请你来到西界' : ' invites you to Elysium'}</p>
      <h1>{zh ? '为想念的人，留下一段记忆。' : 'Keep a memory of someone you miss.'}</h1><RewardRules />
      <p>{zh ? '完成后，你和邀请人各得一张基础赠礼券。' : 'After both steps, you and your friend each receive a basic gift voucher.'}</p>
      {service?<button className="gg-primary gi-link" disabled={joining} onClick={enter}>{joining?(zh?'正在进入…':'Entering…'):(zh?'进入西界':'Enter Elysium')}</button>:<a className="gg-primary gi-link" href={import.meta.env.BASE_URL + '?invite=' + encodeURIComponent(id)}>{zh ? '进入西界' : 'Enter Elysium'}</a>}
      {joinFailed&&<p role="status" className="gg-error">{zh?'暂时无法记录邀请，请再试一次。':'We could not record this invitation. Please try again.'}</p>}
      <p className="gg-caption">{service?(zh?'进入即参与邀请：记录首次加入与首段正式记忆的保存进度，不公开故事。已有账号也可进入，奖励仅面向首次加入的新用户。':'Entering records invitation progress without sharing stories. Existing accounts can enter; rewards are for new users.'):(zh ? '已有演示账号也可以进入西界。邀请奖励面向首次加入的本机用户。' : 'Existing accounts can also enter. The offer is for first-time local preview users.')}</p>
    </> : failed ? <><h1>{zh ? '暂时无法打开邀请' : 'Invitation unavailable'}</h1><button className="gg-secondary" onClick={() => setRetry(n => n + 1)}>{zh ? '重新读取' : 'Try again'}</button><a className="gi-link" href={import.meta.env.BASE_URL}>{zh ? '回到西界' : 'Open Elysium'}</a></> : <p role="status">{zh ? '正在读取邀请…' : 'Opening invitation…'}</p>}
  </div></main>
}
export function InviteEntry() {
  const id = location.pathname.match(/\/invite\/([^/]+)\/?$/)?.[1] ?? ''
  return <LangProvider><PublicGiftFrame><PublicInvite id={id} /></PublicGiftFrame></LangProvider>
}
