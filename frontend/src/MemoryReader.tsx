import { useEffect, useRef, useState } from 'react'
import { isZh, useI18n } from './i18n'
import type { Memory } from './model'
import { ContextSheet } from './mobile/ContextSheet'
import { I, Sheet } from './ui'
import { MemorySheet } from './person'
import type { MemoryService } from './serviceMemories'
import './memory-reader.css'

export function MemoryReader({ memory, personName, personId, service, onClose, onWriteLetter }: { memory: Memory; personName: string; personId?: string; service?: MemoryService; onClose: () => void; onWriteLetter?: (memory: Memory) => void }) {
  const { t, lang } = useI18n()
  const zh = isZh(lang), remote = !!(service && personId && memory.serverId)
  const label = zh ? '回忆原文' : 'Original memory'
  const [loaded, setLoaded] = useState<Memory | null>(remote ? null : memory)
  const [loadedFor, setLoadedFor] = useState<{ service: MemoryService; personId: string; id: string; version: number } | null>(null)
  const [menu, setMenu] = useState(false), [editing, setEditing] = useState<Memory | null>(null), [deleting, setDeleting] = useState<Memory | null>(null), [busy, setBusy] = useState(false)
  const [actionsFor, setActionsFor] = useState<{ service: MemoryService; personId: string; id: string } | null>(null)
  const actionsCurrent = actionsFor?.service === service && actionsFor?.personId === personId && actionsFor?.id === memory.serverId
  const close = useRef(onClose); close.current = onClose
  useEffect(() => {
    let live = true
    if (!remote) { setLoaded(memory); return }
    setLoaded(null)
    void service!.read(personId!, memory).then(result => {
      if (!live) return
      if (result) {
        setLoaded(result)
        setLoadedFor({ service: service!, personId: personId!, id: result.serverId!, version: result.serverVersion! })
      }
      else close.current()
    })
    return () => { live = false }
  }, [remote, service, personId, memory.serverId, memory.serverVersion])
  const value = remote ? loadedFor?.service === service && loadedFor?.personId === personId
    && loadedFor?.id === memory.serverId && loadedFor?.version === memory.serverVersion ? loaded : null : memory
  const reader = <ContextSheet label={label} onClose={onClose} className="memory-reader-sheet">
    <header className="memory-reader-heading">
      <h2 className="mr-auto">{label}</h2>
      {remote && value && <button onClick={() => { setActionsFor({ service: service!, personId: personId!, id: memory.serverId! }); setMenu(true) }} aria-label={zh ? '记忆操作' : 'Memory actions'}><I.More /></button>}
      <button data-context-close onClick={onClose} aria-label={t('common.close')}><I.X /></button>
    </header>
    {value ? <>
      <article className="memory-reader-content">
        <p>{personName}</p>
        <h3>{value.title}</h3>
        {value.body && <p className="memory-reader-original">{value.body}</p>}
      </article>
      {onWriteLetter && value.body.trim() && <div className="mx-5 mb-5">
        <button type="button" className="min-h-11 w-full inline-flex items-center justify-center gap-2 rounded-full btn-dark px-4 text-[14px]" onClick={() => {
          onClose()
          onWriteLetter(value)
        }}><I.Mail className="h-[17px] w-[17px] shrink-0" />{zh ? '用这段回忆写信' : 'Write from this memory'}</button>
      </div>}
    </> : <p role="status" className="px-5 py-6 text-sm text-ink-soft">{zh ? '正在打开…' : 'Opening…'}</p>}
  </ContextSheet>
  return <>
    <div hidden={actionsCurrent && (menu || !!editing || !!deleting)}>{reader}</div>
    {actionsCurrent && menu && <Sheet title={label} onClose={() => setMenu(false)}>
      <button onClick={() => { setMenu(false); setEditing(value) }} className="w-full min-h-12 rounded-2xl glass-light px-4 text-left text-[15px] text-ink">{t('mem.edit')}</button>
      <button onClick={() => { setMenu(false); setDeleting(value) }} className="mt-2 w-full min-h-12 rounded-2xl glass-light px-4 text-left text-[15px] text-coral">{t('talk.delete')}</button>
    </Sheet>}
    {actionsCurrent && editing && <MemorySheet title={t('mem.edit')} draft={editing} editing onClose={() => setEditing(null)} onConfirm={async draft => {
      const result = await service!.update(personId!, editing, draft)
      if (!result) return false
      setLoaded(result); setLoadedFor({ service: service!, personId: personId!, id: result.serverId!, version: result.serverVersion! }); setEditing(result); return true
    }} />}
    {actionsCurrent && deleting && <Sheet title={zh ? '删除这段记忆？' : 'Delete this memory?'} onClose={() => { if (!busy) setDeleting(null) }}
      footer={<div className="flex gap-2.5"><button disabled={busy} onClick={() => setDeleting(null)} className="flex-1 rounded-full ring-1 ring-line py-3 text-[16px] text-ink disabled:opacity-50">{t('del.cancel')}</button><button disabled={busy} aria-busy={busy} onClick={() => {
        setBusy(true); void service!.remove(personId!, deleting).then(removed => { if (removed) close.current() }).finally(() => setBusy(false))
      }} className="rounded-full bg-coral text-white px-7 py-3 text-[15px] font-semibold disabled:opacity-50">{t('del.confirm')}</button></div>}>
      <p className="text-[14px] leading-relaxed text-ink-soft">{deleting.title}</p>
      <p className="mt-3 text-[14px] leading-relaxed text-ink-soft">{zh ? '确认后，这段记忆会从 TA 的珍藏中删除。' : 'Confirming will remove this memory from their treasures.'}</p>
    </Sheet>}
  </>
}
