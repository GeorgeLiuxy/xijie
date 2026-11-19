import { useEffect, useRef, useState } from 'react'
import { fmtDate, isZh, useI18n } from './i18n'
import { MemoryError, type AutomaticMemory, type AutomaticMemoryCorrection, type AutomaticMemoryPage, type MemoryService } from './serviceMemories'

type Props = { personId: string; service: MemoryService }
type Edit = { memory: AutomaticMemory; correction: AutomaticMemoryCorrection }
const emptyPage: AutomaticMemoryPage = { items: [], nextCursor: null }
const controlClass = 'min-h-11 rounded-full px-3 text-[13px] text-sky-deep disabled:opacity-50'

export function AutomaticMemoryControls(props: Props) {
  return <AutomaticMemorySection key={props.personId} {...props} />
}

function AutomaticMemorySection({ personId, service }: Props) {
  const { lang } = useI18n()
  const zh = isZh(lang)
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState<{ service: MemoryService; page: AutomaticMemoryPage }>()
  const page = loaded?.service === service ? loaded.page : emptyPage
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [notice, setNotice] = useState('')
  const [edit, setEdit] = useState<Edit>()
  const [stopping, setStopping] = useState<AutomaticMemory>()
  const [busy, setBusy] = useState(false)
  const [refreshRequired, setRefreshRequired] = useState(false)
  const active = useRef<AbortController | undefined>(undefined)
  const pending = useRef<{ intent: string; key: string } | undefined>(undefined)

  const problem = (error: unknown) => error instanceof MemoryError && error.code === 'AI_PERMISSION_REQUIRED'
    ? zh ? '自动记忆授权未开启。' : 'Automatic memory permission is off.'
    : error instanceof MemoryError && [409, 412].includes(error.status)
      ? zh ? '这条记忆已变化，请刷新后重新查看。' : 'This memory changed. Refresh and review it again.'
      : zh ? '暂时没能完成，请稍后重试。' : 'This could not be completed. Try again shortly.'
  const clearAction = () => {
    pending.current = undefined
    setEdit(undefined)
    setStopping(undefined)
  }
  const load = (cursor: string | null = null, confirmation = '') => {
    active.current?.abort()
    const controller = new AbortController()
    active.current = controller
    setStatus('loading')
    setNotice(confirmation)
    setRefreshRequired(false)
    if (!cursor) setLoaded(undefined)
    void service.listAutomatic(personId, cursor, controller.signal).then(result => {
      if (controller.signal.aborted) return
      setLoaded(previous => {
        const items = cursor && previous?.service === service ? previous.page.items : []
        return { service, page: { items: [...items, ...result.items.filter(item => !items.some(old => old.id === item.id))], nextCursor: result.nextCursor } }
      })
      setStatus('ready')
    }, error => {
      if (controller.signal.aborted) return
      if (error instanceof MemoryError && [401, 403, 404].includes(error.status)) setLoaded(undefined)
      setNotice(problem(error))
      setStatus('error')
    })
  }
  useEffect(() => {
    active.current?.abort()
    clearAction()
    setBusy(false)
    if (!open) return
    load()
    const permissionChanged = () => {
      clearAction()
      setBusy(false)
      load()
    }
    window.addEventListener('xijie:consents-changed', permissionChanged)
    return () => {
      active.current?.abort()
      window.removeEventListener('xijie:consents-changed', permissionChanged)
    }
  }, [open, personId, service]) // Scope changes replace data, including in-flight reads and writes.

  const control = async (memory: AutomaticMemory, correction?: AutomaticMemoryCorrection) => {
    if (busy || status !== 'ready' || refreshRequired) return
    const intent = JSON.stringify([memory.id, memory.version, correction ?? null])
    if (pending.current?.intent !== intent) pending.current = { intent, key: crypto.randomUUID() }
    const controller = new AbortController()
    active.current?.abort()
    active.current = controller
    setBusy(true)
    setNotice('')
    try {
      await service.controlAutomatic(memory, pending.current.key, correction, controller.signal)
      if (controller.signal.aborted) return
      clearAction()
      setBusy(false)
      load(null, correction ? (zh ? '这条记忆已更正。' : 'This memory was corrected.') : (zh ? '这条记忆已停用。' : 'This memory was turned off.'))
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error instanceof MemoryError && [401, 403, 404].includes(error.status)) {
          clearAction()
          setLoaded(undefined)
          setStatus('error')
        } else if (error instanceof MemoryError && [409, 412].includes(error.status)) setRefreshRequired(true)
        setNotice(problem(error))
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  const values = edit ? { title: edit.correction.title.trim(), body: edit.correction.body.trim() } : undefined
  const canSave = !!values?.title && !!values?.body && [...values.title].length <= 120 && [...values.body].length <= 600
  return <section className="rounded-2xl border border-line">
    <button type="button" aria-expanded={open} onClick={() => { setLoaded(undefined); setStatus('loading'); setNotice(''); setOpen(!open) }} className="flex w-full min-h-12 items-center justify-between gap-3 rounded-2xl px-4 text-left text-[14px] text-ink">
      <span>{zh ? '自动记忆' : 'Automatic memories'}</span>
      <span className="text-[12px] text-ink-soft">{open ? (zh ? '收起' : 'Collapse') : (zh ? '查看与更正' : 'Review and edit')}</span>
    </button>
    {open && <div className="border-t border-line px-4 py-3">
      <p className="text-[12px] leading-relaxed text-ink-soft">{zh ? '从人物资料和聊天整理的线索。可以查看来源、更正或停用单条记录。' : 'Notes drawn from profile details and chats. Review a source, correct a note, or turn it off.'}</p>
      {notice && <p role="status" className="mt-2 text-[13px] text-ink">{notice}</p>}
      {status === 'loading' && <p role="status" className="mt-3 text-[13px] text-ink-soft">{zh ? '正在打开…' : 'Opening…'}</p>}
      {(status === 'error' || refreshRequired) && <button type="button" onClick={() => { clearAction(); load() }} className={controlClass}>{zh ? '刷新列表' : 'Reload list'}</button>}
      {status === 'ready' && !page.items.length && <p className="mt-3 text-[13px] text-ink-soft">{zh ? '这里还没有可查看的自动记忆。' : 'There are no automatic memories to review yet.'}</p>}
      <div className="divide-y divide-line">
        {page.items.map(memory => <article key={memory.id} className="py-3">
          <h3 className="font-serif text-[16px] text-ink [overflow-wrap:anywhere]">{memory.topic}</h3>
          {memory.userCorrected && <p className="text-[11px] text-ink-soft">{zh ? '你已更正' : 'Corrected by you'}</p>}
          <p className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-ink [overflow-wrap:anywhere]">{memory.body}</p>
          <details className="mt-2 text-[12px] text-ink-soft">
            <summary className="cursor-pointer py-2">{zh ? '查看来源' : 'View source'}</summary>
            <p>{memory.source.kind === 'profile' ? (zh ? '人物资料' : 'Profile details') : (zh ? '聊天原文' : 'Original chat')} · {fmtDate(lang, new Date(memory.source.createdAt))}</p>
            <blockquote className="mt-1 whitespace-pre-wrap border-l border-line pl-2 [overflow-wrap:anywhere]">{memory.source.excerpt}</blockquote>
          </details>
          {edit?.memory.id === memory.id && <form onSubmit={event => { event.preventDefault(); if (canSave) void control(memory, values) }} className="mt-2 space-y-2">
            <label className="block text-[12px] text-ink-soft">{zh ? '标题' : 'Title'}
              <input aria-label={zh ? '标题' : 'Title'} value={edit.correction.title} disabled={busy} onChange={event => setEdit({ memory, correction: { ...edit.correction, title: event.target.value } })} className="mt-1 min-h-10 w-full rounded-xl border border-line bg-paper px-3 text-[14px] text-ink" />
            </label>
            <label className="block text-[12px] text-ink-soft">{zh ? '线索内容' : 'Memory text'}
              <textarea aria-label={zh ? '线索内容' : 'Memory text'} value={edit.correction.body} disabled={busy} onChange={event => setEdit({ memory, correction: { ...edit.correction, body: event.target.value } })} rows={3} className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2 text-[14px] text-ink" />
            </label>
            <p className="text-[11px] text-ink-soft">{zh ? '标题最多 120 字，内容最多 600 字。' : 'Up to 120 characters for the title and 600 for the text.'}</p>
            <button type="submit" disabled={busy || refreshRequired || !canSave} className={controlClass}>{zh ? '保存更正' : 'Save correction'}</button>
            <button type="button" disabled={busy} onClick={clearAction} className={controlClass}>{zh ? '取消' : 'Cancel'}</button>
          </form>}
          {stopping?.id === memory.id && <div className="mt-2">
            <p className="text-[12px] leading-relaxed text-ink-soft">{zh ? '停用后不会再引用这条记录。人物资料和聊天原文仍按你的授权使用。' : 'This entry will stop being used. Profile details and original messages remain available under your permissions.'}</p>
            <button type="button" disabled={busy || refreshRequired} onClick={() => void control(memory)} className={controlClass}>{zh ? '确认停用' : 'Turn off this entry'}</button>
            <button type="button" disabled={busy} onClick={clearAction} className={controlClass}>{zh ? '取消' : 'Cancel'}</button>
          </div>}
          {!edit && !stopping && status === 'ready' && <div className="flex gap-1">
            <button type="button" onClick={() => { setNotice(''); setEdit({ memory, correction: { title: memory.topic, body: memory.body } }) }} className={controlClass}>{zh ? '更正' : 'Correct'}</button>
            <button type="button" onClick={() => { setNotice(''); setStopping(memory) }} className={controlClass}>{zh ? '停用' : 'Turn off'}</button>
          </div>}
        </article>)}
      </div>
      {status === 'ready' && page.nextCursor && !edit && !stopping && <button type="button" onClick={() => load(page.nextCursor)} className={controlClass}>{zh ? '查看更多' : 'Show more'}</button>}
    </div>}
  </section>
}
