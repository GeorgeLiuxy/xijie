import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { LangProvider, isZh, useI18n } from '../i18n'
import { destination } from '../study/journeys'
import { I, chime, haptic } from '../ui'
import { useNativeBack } from '../mobile/back'
import { PublicGiftFrame } from './PublicGiftFrame'
import type { GiftGoal, GiftTarget, GoalKind } from './types'
import './goals.css'
import { claimGoalReward, GoalError, goalRequest, getGiftGoal, goalUrl } from './client'
export { getGiftGoal, goalUrl } from './client'
const GiftGoalScene=lazy(()=>import('./GiftGoalScene').then(m=>({default:m.GiftGoalScene})))

const goalNames = {
  flight: ['一起寄成', 'A shared departure'],
  home: ['一起建成', 'A place together'],
  album: ['一起创作', 'A shared memory book'],
} as const
const homeParts = ['门牌', '窗', '灯', '长椅', '花箱', '屋顶']
const homePartsEn = ['Nameplate', 'Window', 'Lamp', 'Bench', 'Flower box', 'Roof']

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

export function GoalComposer({ target, onClose, onCreated, initialKind = 'flight' }: {
  target: GiftTarget
  onClose: () => void
  onCreated: (goal: GiftGoal) => void
  initialKind?: GoalKind
}) {
  const { lang } = useI18n(), zh = isZh(lang)
  const [kind, setKind] = useState<GoalKind>(initialKind)
  const [name, setName] = useState(target.name.slice(0, 40))
  const [message, setMessage] = useState('')
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
    firstField.current?.focus({ preventScroll: true })
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return
      event.preventDefault(); event.stopPropagation()
      if (!lock.current) closeRef.current()
    }
    document.addEventListener('keydown', escape)
    return () => { mounted.current = false; document.removeEventListener('keydown', escape) }
  }, [])

  async function publish() {
    if (lock.current || !name.trim() || !message.trim()) return
    const payload = { kind, world: target.world, name: name.trim(), message: message.trim() }
    const fingerprint = JSON.stringify(payload)
    if (request.current.fingerprint !== fingerprint) request.current = { id: crypto.randomUUID(), fingerprint }
    lock.current = true; setBusy(true); setError('')
    try {
      const goal = await goalRequest<GiftGoal>('new', {
        id: request.current.id, ...payload,
      })
      if (!mounted.current) return
      haptic(12); chime('connect'); onCreated(goal)
    } catch {
      if (mounted.current) setError(zh ? '暂未确认发布结果。保持内容重试只创建一次；修改内容会发布新邀请。' : 'Could not confirm publication. Retry unchanged to keep this invitation; edited content creates a new one.')
    } finally {
      lock.current = false
      if (mounted.current) setBusy(false)
    }
  }

  const first = kind === 'flight'
    ? (zh ? '发布时，你先投入 4 份启动补给。目标共 20 份，每位同行者补给 2 份。' : 'Start with 4 launch charges. The goal is 20. Each traveller adds 2.')
    : kind === 'home'
      ? (zh ? '先安放门牌，再一起添窗、灯、长椅、花箱和屋顶。共 6 个部件。' : 'Place the nameplate first, then add a window, lamp, bench, flower box and roof.')
      : (zh ? '你的这段话是第一段回忆。邀请朋友，一起留下 6 段故事。' : 'Your note is the first memory. Invite friends to collect six stories.')

  return <section ref={root} className="gg-overlay" role="dialog" aria-modal="true" aria-label={zh ? '发起共同目标' : 'Create a shared goal'}>
    <Header title={zh ? '一起做成一件事' : 'Make something together'} onClose={close} disabled={busy} />
    <main className="gg-scroll gg-composer">
      <div className="gg-intro"><span className="gg-eyebrow">MAKE IT TOGETHER</span><h1>{zh ? '把邀请留给一个具体心愿' : 'An invitation with a purpose'}</h1><p>{zh ? '让朋友知道为什么想完成它，也看得见自己的贡献。' : 'Let friends understand your wish and see what they add.'}</p></div>
      <div className="gg-kind-picker" role="group" aria-label={zh ? '共同目标类型' : 'Goal type'}>
        {((initialKind === 'flight' ? ['flight', 'home', 'album'] : ['home', 'album']) as GoalKind[]).map(value => <button key={value} aria-pressed={kind === value} disabled={busy} onClick={() => setKind(value)}>
          {value === 'flight' ? <I.PaperBird /> : value === 'home' ? <I.Place /> : <I.Story />}<span>{goalNames[value][zh ? 0 : 1]}</span>
        </button>)}
      </div>
      <div className="gg-recipe"><I.Signal aria-hidden="true"/><p>{first}</p></div>
      <form onSubmit={event => { event.preventDefault(); void publish() }}>
        <label className="gg-label">{zh ? '公开使用的名称' : 'Public name'}<input ref={firstField} value={name} maxLength={40} onChange={event => setName(event.target.value)} disabled={busy} autoComplete="off" /></label>
        <label className="gg-label">{kind === 'album' ? (zh ? '你记得的第一段故事' : 'Your first memory') : (zh ? '想让同行者知道的一句话' : 'A note to fellow travellers')}
          <textarea value={message} maxLength={120} onChange={event => setMessage(event.target.value)} disabled={busy}
            placeholder={zh ? (kind === 'home' ? '想给它留一处可以躲雨的小屋。你愿意添一扇窗吗？' : kind === 'album' ? '那次一起出门，你还记得哪一个瞬间？' : '以前，它最喜欢追那颗球。我想再给它寄一次。') : 'Tell friends why this matters to you.'} />
        </label>
        <section className="gg-public-preview" aria-label={zh ? '公开邀请预览' : 'Public invitation preview'}>
          <small>{zh ? '分享范围 · 名称、目的地、这句留言与贡献记录' : 'Shared · name, destination, note and contributions'}</small>
          <h2>{publicTitle({ name: name || target.name, kind }, zh)}</h2>
          <p>{message || (zh ? '你写下的这句话，会出现在邀请里。' : 'Your note will appear in the invitation.')}</p>
          <span>{destination(target.world, lang).place}</span>
        </section>
        <p className="gg-caption">{zh ? '体验中的虚拟共寄。好友完成一次贡献，可获得一份基础回程邮资。' : 'A virtual shared gift. Each completed contribution earns one basic return postage.'}</p>
        {error && <p className="gg-error" role="alert">{error}</p>}
        <button className="gg-primary" disabled={busy || !name.trim() || !message.trim()} type="submit">{busy ? (zh ? '正在发布…' : 'Publishing…') : (zh ? '发布这张邀请' : 'Publish invitation')}</button>
      </form>
    </main>
  </section>
}

export function GiftGoalView({ id, owner, onClose, onReward, onAdopt, adopted = [] }: {
  id: string
  owner?: string
  onClose: () => void
  onReward?: (token: string) => void
  onAdopt?: (goalId: string, seat: number, text: string) => void
  adopted?: string[]
}) {
  const { lang } = useI18n(), zh = isZh(lang)
  const [goal, setGoal] = useState<GiftGoal | null>(null)
  const [loading, setLoading] = useState(true), [failed, setFailed] = useState(false)
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const [text, setText] = useState(''), [retry, setRetry] = useState(0)
  const [rewardStored, setRewardStored] = useState(false), [manualShare, setManualShare] = useState(false)
  const lock = useRef(false), mounted = useRef(true), rewardedCallback = useRef(''), activeId = useRef(id)
  activeId.current = id
  const rewardCallback = useRef(onReward)
  rewardCallback.current = onReward
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let live = true, reading = false
    setLoading(true); setGoal(null); setText(''); setNotice(''); setRewardStored(false); setManualShare(false)
    async function read() {
      if (reading) return
      reading = true
      try {
        const next = await getGiftGoal(id)
        if (live) { setGoal(old => old && old.current > next.current ? old : next); setFailed(false) }
      } catch { if (live) setFailed(true) }
      finally { reading = false; if (live) setLoading(false) }
    }
    void read()
    const timer = window.setInterval(() => { if (!document.hidden) void read() }, 1500)
    const focus = () => { if (!document.hidden) void read() }
    document.addEventListener('visibilitychange', focus)
    return () => { live = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', focus) }
  }, [id, retry])

  useEffect(() => {
    const token = goal?.rewardToken
    if (!owner || !token) return
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

  const unit = goal?.kind === 'flight' ? (zh ? '份补给' : 'charges') : goal?.kind === 'home' ? (zh ? '个部件' : 'parts') : (zh ? '段回忆' : 'memories')
  const amount = goal?.kind === 'flight' ? 2 : 1
  const defaultText = zh ? '愿你沿路有光。' : 'May light follow you.'
  const contributionText = text.trim() || (goal?.kind === 'album' ? '' : defaultText)
  const remaining = goal ? Math.max(0, goal.target - goal.current) : 0

  async function help() {
    if (lock.current || !goal?.canHelp || !contributionText) return
    lock.current = true; setBusy(true); setNotice('')
    try {
      const next = await goalRequest<GiftGoal>(encodeURIComponent(id) + '/help', { text: contributionText })
      if (!mounted.current || activeId.current !== id) return
      setGoal(next); haptic([10, 30, 20]); chime('connect')
      setNotice(zh ? '你的贡献与祝愿已收好。' : 'Your contribution and wish are saved.')
    } catch (error) {
      if (!mounted.current || activeId.current !== id) return
      if (error instanceof GoalError && error.goal) {
        setGoal(error.goal)
        setNotice(zh ? '这份目标刚刚已完成，可以看看大家留下的成果。' : 'The goal just completed. You can view the shared result.')
      } else setNotice(zh ? '暂未确认贡献结果，可以重试。重复操作只记一次。' : 'Could not confirm. Retrying only counts once.')
    } finally { lock.current = false; if (mounted.current) setBusy(false) }
  }

  async function share() {
    if (!goal) return
    const detail = goal.completed
      ? (zh ? `${publicTitle(goal, true)}已完成，一起看看大家的贡献。` : `${publicTitle(goal, false)} is complete. See what everyone added.`)
      : (zh ? `${goal.message}\n还差 ${remaining} ${unit}，你的这次参与会增加 ${amount} ${unit}。` : `${goal.message}\n${remaining} ${unit} remaining. Your contribution adds ${amount}.`)
    try {
      if (navigator.share) await navigator.share({ title: publicTitle(goal, zh), text: detail, url: goalUrl(id) })
      else { await navigator.clipboard.writeText(detail + '\n' + goalUrl(id)); setNotice(zh ? '邀请与地址已复制。' : 'Invitation and link copied.') }
    } catch (error) { if ((error as Error).name !== 'AbortError') setManualShare(true) }
  }

  function claim() {
    if (!goal?.rewardToken) return
    try { sessionStorage.setItem('elysium.giftReward', goal.rewardToken) } catch { /* The link also carries the earned token. */ }
    location.assign(import.meta.env.BASE_URL + '?giftReward=' + encodeURIComponent(goal.rewardToken))
  }

  let content
  if (loading && !goal) content = <div className="gg-empty"><I.Signal /><h1>{zh ? '读取这份邀请…' : 'Opening invitation…'}</h1></div>
  else if (!goal) content = <div className="gg-empty"><I.Mail /><h1>{zh ? '暂未找到这份邀请' : 'Invitation unavailable'}</h1><p>{zh ? '可以重新读取，或回到西界继续。' : 'Try loading it again or return to Elysium.'}</p><button className="gg-primary" onClick={() => setRetry(value => value + 1)}>{zh ? '重新读取' : 'Reload'}</button></div>
  else content = <>
    <section className="gg-hero gg-hero-interactive">
      <Suspense fallback={<div style={{height:220}}/>}><GiftGoalScene kind={goal.kind} current={goal.current} target={goal.target} parts={goal.parts} world={goal.world}/></Suspense>
      <div className="gg-hero-caption">
      <small>{goal.isOwner ? (zh ? '你发起的共同心愿' : 'Your shared wish') : (zh ? '一份邀请，等你的那一份心意' : 'An invitation to add something of your own')}</small>
      <h1>{publicTitle(goal, zh)}</h1><span>{destination(goal.world, lang).place}</span>
      </div>
    </section>
    <div className="gg-content">
      <blockquote>{goal.message}</blockquote>
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
        <label className="gg-label">{goal.kind === 'album' ? (zh ? '你记得的那一段' : 'The part you remember') : (zh ? '捎上的祝愿（可改写）' : 'Your enclosed wish (optional)')}
          <textarea value={text} maxLength={120} onChange={event => setText(event.target.value)} placeholder={goal.kind === 'album' ? (zh ? '那时，我们一起……' : 'I remember when we…') : defaultText} disabled={busy} />
        </label>
        <div className="gg-reward-note"><I.Mailbox /><p>{zh ? '贡献完成后，你会得到一份基础回程邮资，可为自己的对象寄一件礼物。' : 'After contributing, receive one basic return postage for a gift of your own.'}</p></div>
        <button className="gg-primary" type="submit" disabled={busy || !contributionText}>{busy ? (zh ? '正在接入…' : 'Connecting…') : goal.kind === 'flight' ? (zh ? '捎祝愿并补给 +2' : 'Enclose wish & add 2 charges') : goal.kind === 'home' ? (zh ? '添上一个部件' : 'Add one part') : (zh ? '留下这段共同回忆' : 'Add this memory')}</button>
      </form>}
      {goal.helped && <section className="gg-postage">
        <small>RETURN POSTAGE / {id.slice(0, 6).toUpperCase()}</small><h2>{zh ? '也给你的一次寄件' : 'A parcel of your own'}</h2>
        <p>{rewardStored ? (zh ? '回程邮资已存入你的背包。' : 'Return postage is in your backpack.') : (zh ? '这次帮助已记入，一份基础回程邮资已为你保留。' : 'Your contribution is recorded and one basic return postage is reserved.')}</p>
        {owner ? <button className="gg-primary" onClick={onClose}>{zh ? '回去挑一件自己的礼物' : 'Choose a gift of my own'}</button> : <button className="gg-primary" onClick={claim}>{zh ? '用回程邮资挑礼物' : 'Use my return postage'}</button>}
      </section>}
      {goal.isOwner && <div className="gg-owner-note"><I.Keep /><p>{goal.completed ? (zh ? '共同成果与每一份贡献已保存在这张邀请里。' : 'The shared result and every contribution are saved here.') : (zh ? '你的第一份投入已记入。把邀请交给愿意一起完成它的人。' : 'Your first contribution is recorded. Invite someone to help complete it.')}</p></div>}
      <button className={goal.isOwner && !goal.completed ? 'gg-primary' : 'gg-secondary'} onClick={share}>{goal.completed ? (zh ? '分享这份共同成果' : 'Share the result') : (zh ? '把邀请递给下一位' : 'Pass the invitation on')}</button>
      {manualShare && <label className="gg-label">{zh ? '复制邀请地址' : 'Copy invitation link'}<input readOnly value={goalUrl(id)} onFocus={event => event.target.select()} /></label>}
      <p className="gg-notice" role="status">{notice || (failed ? (zh ? '连接中断，正在重新核对进度。' : 'Reconnecting to shared progress.') : '')}</p>
      <section className="gg-contributions"><h2>{zh ? '每个人留下的那一份' : 'What everyone added'}</h2>{goal.contributions.map(entry => <article key={entry.seat}>
        <span>{String(entry.seat + 1).padStart(2, '0')}</span><div><strong>{entry.seat === 0 ? (zh ? '发起人' : 'Sender') : (zh ? `同行者 ${entry.seat + 1}` : `Traveller ${entry.seat + 1}`)}<em>{entry.part ? (zh ? entry.part : homePartsEn[homeParts.indexOf(entry.part)]) : `+${entry.value} ${unit}`}</em></strong><p>{entry.text}</p>
          {goal.kind === 'album' && goal.isOwner && owner && onAdopt && <button className="gg-secondary" disabled={adopted.includes(goal.id + ':' + entry.seat)}
            onClick={() => onAdopt(goal.id, entry.seat, entry.text)}>{adopted.includes(goal.id + ':' + entry.seat)
              ? (zh ? '已收进记忆' : 'Saved to memories') : (zh ? '收进 TA 的记忆' : 'Save to their memories')}</button>}
        </div>
      </article>)}</section>
      <p className="gg-caption">{zh ? '虚拟共寄体验 · 同一浏览器在每个目标中贡献一次。回程邮资适用于基础虚拟寄件。' : 'Virtual shared-gift pilot. One contribution per browser per goal. Return postage covers a basic virtual parcel.'}</p>
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
