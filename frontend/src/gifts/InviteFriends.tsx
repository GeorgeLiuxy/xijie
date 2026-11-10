import { useContext, useEffect, useRef, useState } from 'react'
import { LangProvider, isZh, useI18n } from '../i18n'
import { I, NightCtx, useStatusTone } from '../ui'
import { PublicGiftFrame } from './PublicGiftFrame'
import { ContextSheet } from '../mobile/ContextSheet'
import { getPublicInvite, inviteStatus, inviteUrl, syncInviteRewards, type InviteStatus } from './client'
import './goals.css'
import './invite.css'

function RewardRules() {
  const { lang } = useI18n(), zh = isZh(lang)
  return <ol className="gi-rules">
    <li><span>1</span><p>{zh ? '朋友从邀请首次加入西界' : 'Your friend joins Elysium for the first time through the invitation.'}</p></li>
    <li><span>2</span><p>{zh ? '找到想念的 TA，保存第一段记忆' : 'They find someone they miss and save their first memory.'}</p></li>
  </ol>
}

export function InviteFriends({ owner, nickname, onClose, onUseReward, rewardActionLabel, presentation = 'page' }: {
  owner: string; nickname?: string; onClose: () => void; onUseReward: () => void; rewardActionLabel?: string; presentation?: 'sheet' | 'page'
}) {
  const { lang } = useI18n(), zh = isZh(lang)
  useStatusTone(useContext(NightCtx) ? 'light' : 'dark')
  const [status, setStatus] = useState<InviteStatus | null>(null)
  const [name, setName] = useState((nickname || (zh ? '一位朋友' : 'A friend')).slice(0, 32))
  const [refresh, setRefresh] = useState(0), [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false), [stored, setStored] = useState(false)
  const [shareNote, setShareNote] = useState(''), [manual, setManual] = useState(false)
  const back = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (presentation === 'page') back.current?.focus({ preventScroll: true }) }, [presentation])
  useEffect(() => {
    let live = true, reading = false
    async function read() {
      if (reading || document.hidden) return
      reading = true
      try {
        const next = await inviteStatus(owner)
        if (!live) return
        setStatus(next)
        await syncInviteRewards(owner, next)
        if (live) { setStored(true); setFailed(false) }
      } catch { if (live) { setFailed(true); setStored(false) } }
      finally { reading = false }
    }
    void read()
    const timer = window.setInterval(read, 3500)
    document.addEventListener('visibilitychange', read)
    return () => { live = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', read) }
  }, [owner, refresh])
  async function create() {
    if (busy || !name.trim()) return
    setBusy(true)
    try { setStatus(await inviteStatus(owner, name.trim())); setFailed(false); setRefresh(n => n + 1) }
    catch { setFailed(true) } finally { setBusy(false) }
  }
  async function share() {
    if (!status?.inviteId) return
    const url = inviteUrl(status.inviteId)
    const title = zh ? status.publicName + '邀请你加入西界' : status.publicName + ' invites you to Elysium'
    try {
      if (navigator.share) await navigator.share({ title, url })
      else { await navigator.clipboard.writeText(url); setShareNote(zh ? '邀请链接已复制。' : 'Invitation link copied.') }
    } catch (error) { if ((error as Error).name !== 'AbortError') setManual(true) }
  }
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
          <input maxLength={32} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>}
        <div className="gi-preview"><I.Mail /><div><b>{(status.publicName || name.trim() || '…') + (zh ? '邀请你加入西界' : ' invites you to Elysium')}</b>
          <small>{zh ? '分享卡只展示这个称呼和参与规则。' : 'Only this name and the invitation rules are shared.'}</small></div></div>
        {status.inviteId
          ? <button className="gg-primary" onClick={share}>{zh ? '分享邀请链接' : 'Share invitation'}</button>
          : <button className="gg-primary" disabled={busy || !name.trim()} onClick={create}>{busy ? (zh ? '正在生成…' : 'Creating…') : (zh ? '生成我的邀请' : 'Create my invitation')}</button>}
        {manual && status.inviteId && <label className="gg-label">{zh ? '复制此链接' : 'Copy this link'}<input readOnly value={inviteUrl(status.inviteId)} onFocus={e => e.currentTarget.select()} /></label>}
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
      {stored && !!status?.rewards.length && <button className="gg-secondary gi-reward-action" onClick={onUseReward}>{rewardActionLabel ?? (zh ? '查看我的礼物券' : 'View my gift coupons')}</button>}
      {failed && <div className="gg-error" role="status">{zh ? '暂时未能同步邀请或礼物券，进度会保留。' : 'Your invitation or coupons could not sync. Your progress is kept.'}
        <button className="gg-secondary" onClick={() => setRefresh(n => n + 1)}>{zh ? '重试' : 'Retry'}</button></div>}
      <p className="gg-caption">{zh ? '本地体验：以首次使用的浏览器和演示登录身份记录邀请。' : 'Local preview: invitations use a new browser and its local demo login.'}</p>
    </main>
  </section>
  return sheet ? <ContextSheet label={title} onClose={onClose} closeDisabled={busy} className="gi-context-sheet">{content}</ContextSheet> : content
}

function PublicInvite({ id }: { id: string }) {
  const { lang } = useI18n(), zh = isZh(lang)
  const [result, setResult] = useState<{ publicName: string } | null>(null), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0)
  useEffect(() => {
    let live = true; setFailed(false)
    void getPublicInvite(id).then(info => { if (live) setResult(info) }).catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [id, retry])
  return <main className="gg-overlay gi-page"><div className="gg-scroll gi-content gi-public">
    {result ? <><span className="gi-seal"><I.PaperBird /></span>
      <p>{result.publicName || (zh ? '一位朋友' : 'A friend')}{zh ? '邀请你来到西界' : ' invites you to Elysium'}</p>
      <h1>{zh ? '为想念的人，留下一段记忆。' : 'Keep a memory of someone you miss.'}</h1><RewardRules />
      <p>{zh ? '完成后，你和邀请人各得一张基础赠礼券。' : 'After both steps, you and your friend each receive a basic gift coupon.'}</p>
      <a className="gg-primary gi-link" href={import.meta.env.BASE_URL + '?invite=' + encodeURIComponent(id)}>{zh ? '进入西界' : 'Enter Elysium'}</a>
      <p className="gg-caption">{zh ? '已有演示账号也可以进入西界。邀请奖励面向首次加入的本机用户。' : 'Existing accounts can also enter. The offer is for first-time local preview users.'}</p>
    </> : failed ? <><h1>{zh ? '暂时无法打开邀请' : 'Invitation unavailable'}</h1><button className="gg-secondary" onClick={() => setRetry(n => n + 1)}>{zh ? '重新读取' : 'Try again'}</button><a className="gi-link" href={import.meta.env.BASE_URL}>{zh ? '回到西界' : 'Open Elysium'}</a></> : <p role="status">{zh ? '正在读取邀请…' : 'Opening invitation…'}</p>}
  </div></main>
}
export function InviteEntry() {
  const id = location.pathname.match(/\/invite\/([^/]+)\/?$/)?.[1] ?? ''
  return <LangProvider><PublicGiftFrame><PublicInvite id={id} /></PublicGiftFrame></LangProvider>
}
