import { useEffect, useRef, useState, type FormEvent } from 'react'
import { isZh, useI18n } from './i18n'
import type { Person } from './model'
import type { MemoryService } from './serviceMemories'
import { I, Sheet } from './ui'
import { useNativeBack } from './mobile/back'
import { acceptGuestPerson, beginGuestTransfer, completeGuestPerson, completeGuestTransfer, readGuestJournal, saveGuestOriginal, saveGuestPerson, watchGuestJournal, type GuestJournal, type GuestPersonSeed } from './guestJournal'

const fieldClass = 'mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2 text-[15px] text-ink'
const action = 'inline-flex min-h-11 items-center justify-center rounded-full px-5 text-[14px] disabled:opacity-50'
type JournalState = { status: 'loading' | 'ready' | 'error'; journal?: GuestJournal }

function useJournal() {
  const [state, setState] = useState<JournalState>({ status: 'loading' })
  useEffect(() => {
    let active = true
    let revision = 0
    const refresh = () => {
      const current = ++revision
      void readGuestJournal().then(journal => {
        if (active && current === revision) setState({ status: 'ready', journal })
      }, () => {
        if (active && current === revision) setState({ status: 'error' })
      })
    }
    refresh()
    const unsubscribe = watchGuestJournal(refresh)
    return () => { active = false; unsubscribe() }
  }, [])
  return state
}

export function useGuestTransferAvailable(accountId?: string) {
  const { journal } = useJournal()
  return !!(accountId && journal && (!journal.owner || journal.owner === accountId) && (!journal.personHandoff || journal.original))
}

export function GuestJourney({ onClose, onSignIn }: { onClose: () => void; onSignIn: () => void }) {
  const { lang } = useI18n(), zh = isZh(lang)
  const { status, journal } = useJournal()
  const [name, setName] = useState('')
  const [story, setStory] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [editing, setEditing] = useState<'person' | 'memory'>()
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const layer = useRef<HTMLDivElement>(null)
  useNativeBack(() => { onClose(); return true }, true, 52, layer)

  async function preserve(event: FormEvent, kind: 'person' | 'memory') {
    event.preventDefault()
    if (busy || status !== 'ready') return
    setBusy(true)
    setNotice('')
    try {
      if (kind === 'person') await saveGuestPerson(name, story)
      else if (journal) await saveGuestOriginal(journal.guestId, title, body)
      setEditing(undefined)
      setNotice(zh ? '已保存在此设备。' : 'Saved on this device.')
    } catch { setNotice(zh ? '没能保存，请保留页面并重试。' : 'Saving failed. Keep this page open and try again.') }
    finally { setBusy(false) }
  }
  return <div ref={layer} className="absolute inset-0 z-[100] flex flex-col bg-canvas text-ink" role="dialog" aria-modal="true" aria-label={zh ? '本机体验' : 'Try on this device'}>
    <header className="px-5 pt-[calc(var(--app-status-height)+8px)]">
      <button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full glass-light" aria-label={zh ? '返回登录' : 'Back to sign in'}><I.Back className="h-5 w-5" /></button>
    </header>
    <div className="scroll-quiet flex-1 overflow-y-auto px-6 pb-8">
      <h1 className="mt-4 font-serif text-[29px]">{zh ? '从一段回忆开始' : 'Begin with a memory'}</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{zh ? '先在这台设备记录 TA 和一段回忆。登录后，你可以选择带进自己的账号。' : 'Write about someone and a memory on this device. You can choose to bring them into your account when you sign in.'}</p>
      {status === 'loading' && <p role="status" className="mt-4">{zh ? '正在读取本机内容…' : 'Loading from this device…'}</p>}
      {status === 'error' && <p role="alert" className="mt-4">{zh ? '暂时无法读取本机内容。' : 'Content on this device is unavailable.'}</p>}
      {status === 'ready' && (journal?.owner
        ? <p className="mt-5 rounded-2xl border border-line p-4 text-[14px]">{zh ? '这台设备的资料已关联一个账号。登录后可继续。' : 'The material on this device is linked to an account. Sign in to continue.'}</p>
        : <>
          {(!journal || editing === 'person') ? <form onSubmit={event => void preserve(event, 'person')} className="mt-5 space-y-3 rounded-2xl border border-line p-4">
            <label className="block text-[13px]">{zh ? '称呼' : 'Name'}<input aria-label={zh ? '称呼' : 'Name'} value={name} maxLength={80} onChange={event => setName(event.target.value)} className={fieldClass} required /></label>
            <label className="block text-[13px]">{zh ? '一段故事' : 'A story'}<textarea aria-label={zh ? '一段故事' : 'A story'} value={story} maxLength={20000} onChange={event => setStory(event.target.value)} className={fieldClass} rows={3} required /></label>
            <button type="submit" disabled={busy || !name.trim() || !story.trim()} className={action + ' btn-dark w-full'}>{zh ? '在本机保存人物' : 'Save person on this device'}</button>
          </form> : <article className="mt-5 rounded-2xl border border-line bg-paper p-4">
            <h2 className="font-serif text-[21px] [overflow-wrap:anywhere]">{journal.name}</h2>
            <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed [overflow-wrap:anywhere]">{journal.story}</p>
            <button type="button" className={action + ' -ml-3 text-sky-deep'} onClick={() => { setName(journal.name); setStory(journal.story); setEditing('person') }}>{zh ? '编辑人物' : 'Edit person'}</button>
          </article>}
          {journal && (!journal.original || editing === 'memory'
            ? <form onSubmit={event => void preserve(event, 'memory')} className="mt-3 space-y-3 rounded-2xl border border-line p-4">
              <h2 className="font-serif text-[18px]">{zh ? '留下一段回忆' : 'Keep a memory'}</h2>
              <label className="block text-[13px]">{zh ? '回忆标题' : 'Memory title'}<input aria-label={zh ? '回忆标题' : 'Memory title'} value={title} maxLength={120} onChange={event => setTitle(event.target.value)} className={fieldClass} required /></label>
              <label className="block text-[13px]">{zh ? '回忆原文' : 'Original memory'}<textarea aria-label={zh ? '回忆原文' : 'Original memory'} value={body} maxLength={10000} onChange={event => setBody(event.target.value)} className={fieldClass} rows={3} required /></label>
              <button type="submit" disabled={busy || !title.trim() || !body.trim()} className={action + ' btn-dark w-full'}>{zh ? '在本机珍藏' : 'Keep on this device'}</button>
            </form>
            : <article className="mt-3 rounded-2xl border border-line bg-paper p-4">
              <h2 className="font-serif text-[19px] [overflow-wrap:anywhere]">{journal.original.title}</h2>
              <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed [overflow-wrap:anywhere]">{journal.original.body}</p>
              <button type="button" className={action + ' -ml-3 text-sky-deep'} onClick={() => { setTitle(journal.original!.title); setBody(journal.original!.body); setEditing('memory') }}>{zh ? '编辑回忆' : 'Edit memory'}</button>
            </article>)}
        </>)}
      {notice && <p role="status" className="mt-3 text-[13px]">{notice}</p>}
      <button type="button" onClick={onSignIn} disabled={busy} className={action + ' mt-3 w-full glass-light'}>{zh ? '返回登录' : 'Sign in'}</button>
    </div>
  </div>
}

type TransferProps = { accountId: string; accountLabel: string; people: Person[]; service: MemoryService; onClose: () => void; onSeek: (seed: GuestPersonSeed) => void }
export function GuestTransfer(props: TransferProps) {
  return <GuestTransferDialog key={props.accountId} {...props} />
}

function GuestTransferDialog({ accountId, accountLabel, people, service, onClose, onSeek }: TransferProps) {
  const { lang } = useI18n(), zh = isZh(lang)
  const { status, journal } = useJournal()
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const live = useRef<MemoryService | undefined>(service)
  useEffect(() => { live.current = service; return () => { live.current = undefined } }, [service])
  const owned = journal && (!journal.owner || journal.owner === accountId) ? journal : undefined
  const personId = owned?.transfer?.personId ?? target
  const verifiedPeople = people.filter(person => !!person.serverId)
  const selected = verifiedPeople.find(person => person.serverId === personId)
  const draft = owned?.personDraft
  const draftId = draft && 'id' in draft ? draft.id : undefined
  const verifiedHandoff = !!draftId && verifiedPeople.some(person => person.photoTarget?.id === draftId)
  const handoffComplete = owned?.personHandoff || verifiedHandoff
  useEffect(() => {
    if (!owned || owned.personHandoff || !verifiedHandoff) return
    void completeGuestPerson(owned.guestId, accountId, draftId).catch(() => {})
  }, [owned?.guestId, owned?.personHandoff, accountId, draftId, verifiedHandoff])
  const interrupted = zh ? '带入结果尚未确认。已保留本机原文，可以继续重试。' : 'The transfer is unconfirmed. The original is kept on this device and you may retry.'

  async function fillPerson() {
    if (busy || !owned || handoffComplete) return
    setBusy(true)
    try {
      const accepted = await acceptGuestPerson(owned.guestId, accountId)
      if (accepted && live.current === service) onSeek({ guestId: accepted.guestId, name: accepted.name, story: accepted.story })
    } catch { if (live.current === service) setNotice(interrupted) }
    finally { if (live.current === service) setBusy(false) }
  }

  async function transferOriginal() {
    if (busy || !owned?.original || !selected?.serverId) return
    const destination = selected.serverId
    setBusy(true)
    setNotice('')
    try {
      const accepted = await beginGuestTransfer(owned.guestId, accountId, destination)
      if (!accepted?.original || live.current !== service) return
      const saved = await service.saveGuestOriginal(destination, { id: 0, title: accepted.original.title, body: accepted.original.body }, accepted.original.id)
      if (live.current !== service) return
      if (!saved?.serverId) { setNotice(interrupted); return }
      await completeGuestTransfer(accepted.guestId, accountId, destination, saved.serverId)
      if (live.current === service) setNotice(zh ? '回忆已带入，可在 TA 的记忆中查看。' : 'Memory transferred. You can find it in their memories.')
    } catch { if (live.current === service) setNotice(interrupted) }
    finally { if (live.current === service) setBusy(false) }
  }

  return <Sheet title={zh ? '带入本机资料' : 'Bring in local material'} onClose={() => { if (!busy) onClose() }} tall>
    <p className="text-[13px] text-ink-soft">{zh ? '将带入账号' : 'Transfer to account'} <strong className="text-ink">{accountLabel}</strong></p>
    {status === 'loading' && <p role="status" className="mt-3">{zh ? '正在读取本机内容…' : 'Loading from this device…'}</p>}
    {status === 'error' && <p role="alert" className="mt-3">{zh ? '暂时无法读取本机内容。' : 'Content on this device is unavailable.'}</p>}
    {status === 'ready' && !owned && <p className="mt-3">{zh ? '当前账号没有待带入的本机资料。' : 'There is no local material to bring into this account.'}</p>}
    {owned && <>
      {!handoffComplete && <article className="mt-3 rounded-2xl border border-line bg-paper p-4">
        <h3 className="font-serif text-[19px] [overflow-wrap:anywhere]">{owned.name}</h3>
        <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed [overflow-wrap:anywhere]">{owned.story}</p>
        <button type="button" onClick={() => void fillPerson()} disabled={busy} className={action + ' btn-dark mt-3 w-full'}>{zh ? '带入「寻找 TA」' : 'Use in Find someone'}</button>
      </article>}
      {owned.original && <article className="mt-3 rounded-2xl border border-line bg-paper p-4">
        <h3 className="font-serif text-[19px] [overflow-wrap:anywhere]">{owned.original.title}</h3>
        <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed [overflow-wrap:anywhere]">{owned.original.body}</p>
        <label className="mt-3 block text-[13px]">{zh ? '保存到哪位 TA？' : 'Whose memories should this go in?'}
          <select aria-label={zh ? '保存到哪位 TA？' : 'Whose memories should this go in?'} value={personId} onChange={event => setTarget(event.target.value)} disabled={busy || !!owned.transfer} className={fieldClass}>
            <option value="">{zh ? '选择人物' : 'Choose someone'}</option>
            {owned.transfer && !selected && <option value={personId}>{zh ? '原人物暂不可用' : 'Original person unavailable'}</option>}
            {verifiedPeople.map(person => <option key={person.serverId} value={person.serverId}>{person.name}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => void transferOriginal()} disabled={busy || !selected} className={action + ' btn-dark mt-3 w-full'}>{owned.transfer ? (zh ? '继续带入回忆' : 'Resume memory transfer') : (zh ? '确认带入回忆' : 'Transfer this memory')}</button>
      </article>}
    </>}
    {notice && <p role="status" className="mt-3 text-[13px]">{notice}</p>}
  </Sheet>
}
