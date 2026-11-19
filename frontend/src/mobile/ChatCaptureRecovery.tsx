import { useEffect, useState } from 'react'
import { isZh, useI18n } from '../i18n'
import type { Person } from '../model'
import { captureFailure, type ChatCaptureClient, type CaptureRecord } from './chatCapture'

/** Only interrupted operations appear; normal live camera returns stay immediate. */
export function ChatCaptureRecovery({ client, people, ready, onContinue }: { client: ChatCaptureClient; people: Person[]; ready: boolean; onContinue: (capture: CaptureRecord) => void }) {
  const { lang } = useI18n(), zh = isZh(lang)
  const [, changed] = useState(0), [error, setError] = useState(''), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    const unsubscribe = client.subscribe(() => { if (active) changed(value => value + 1) })
    const refresh = async () => { if (document.visibilityState === 'hidden') return; try { await client.reconcile(); await client.refresh(); if (active) setError('') } catch (failure) { if (active && !(failure instanceof DOMException && failure.name === 'AbortError')) setError(captureFailure(failure, zh)) } }
    void refresh()
    const foreground = () => { void refresh() }
    window.addEventListener('focus', foreground); document.addEventListener('visibilitychange', foreground)
    return () => { active = false; unsubscribe(); window.removeEventListener('focus', foreground); document.removeEventListener('visibilitychange', foreground) }
  }, [client, zh, retry])
  const capture = client.pending()
  if (!capture) return error ? <aside className="absolute z-40 inset-x-4 bottom-[calc(84px+env(safe-area-inset-bottom))] rounded-2xl bg-paper p-4 shadow-lg ring-1 ring-line" role="status"><p className="text-[12px] leading-relaxed text-muted">{error}</p><div className="mt-2 flex gap-4 text-[13px] text-sky-deep"><button className="min-h-11" onClick={() => setRetry(value => value + 1)}>{zh ? '重试查看' : 'Try again'}</button><button className="min-h-11" onClick={() => setError('')}>{zh ? '收起' : 'Dismiss'}</button></div></aside> : null
  if (client.active(capture.operationId)) return null
  const person = people.find(value => value.serverId === capture.owner.personId)
  const discard = async () => {
    if (busy || client.active(capture.operationId)) return
    setBusy(true); setError('')
    try { await client.discard(capture) } catch (failure) { setError(captureFailure(failure, zh)) } finally { setBusy(false) }
  }
  return <aside className="absolute z-40 inset-x-4 bottom-[calc(84px+env(safe-area-inset-bottom))] rounded-2xl bg-paper p-4 shadow-lg ring-1 ring-line" aria-label={zh ? '待发照片' : 'Pending photo'}>
    <p className="text-[14px] font-medium text-ink">{zh ? `有一张${person ? `给${person.name}的` : ''}照片尚未处理完成` : `A photo${person ? ` for ${person.name}` : ''} still needs attention`}</p>
    <p className="mt-1 text-[12px] leading-relaxed text-muted">{zh ? `照片暂存在这台手机，最多保留一小时，可继续至 ${new Date(capture.expiresAtMs).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}。` : `This photo is kept on this phone for up to one hour. Continue before ${new Date(capture.expiresAtMs).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}.`}</p>
    <p className="mt-1 text-[12px] leading-relaxed text-muted">{capture.state === 'capturing' ? zh ? '还没有收到拍摄结果。请先在相机中完成拍摄，或丢弃这次拍摄后重试。' : 'The camera has not returned a photo yet. Finish taking the photo, or discard this capture before trying again.' : zh ? '继续时会回到原来的聊天。丢弃只清除本机待发照片，不会撤回可能已发送的照片。' : 'Continue in the original chat. Discarding removes this pending local photo and will not recall a photo that may already have been sent.'}</p>
    {error && <p className="mt-2 text-[12px] text-muted" role="status">{error}</p>}
    <div className="mt-2 flex flex-wrap gap-4 text-[13px] text-sky-deep">
      <button className="min-h-11 disabled:opacity-50" disabled={busy || !ready || !person || capture.state !== 'ready'} onClick={() => { if (!busy && person && ready && !client.active(capture.operationId)) onContinue(capture) }}>{zh ? '继续发给原 TA' : 'Continue to the original chat'}</button>
      <button className="min-h-11 disabled:opacity-50" disabled={busy} onClick={() => void discard()}>{zh ? '丢弃本机照片' : 'Discard local photo'}</button>
    </div>
  </aside>
}
