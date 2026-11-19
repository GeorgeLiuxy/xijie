import { useEffect, useRef, useState } from 'react'
import { isZh, useI18n } from './i18n'
import { Sheet } from './ui'

type Kind = 'voice' | 'video'
type Interests = { voice: string | null; video: string | null; version: number }
type InterestContext = { sessionId: string; onUnauthorized: () => void }

class CallInterestError extends Error {
  constructor(readonly status: number) { super('Call reminder preference unavailable') }
}

const validInstant = (value: unknown) => value === null || typeof value === 'string' && Number.isFinite(Date.parse(value))

async function request(context: InterestContext, signal: AbortSignal, intent?: {
  kind: Kind; registered: boolean; version: number
}): Promise<Interests> {
  const response = await fetch('/v1/accounts/me/call-interests', {
    method: intent ? 'PATCH' : 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: {
      'X-Xijie-Expected-Session': context.sessionId,
      ...(intent ? { 'Content-Type': 'application/json' } : {}),
    },
    signal,
    ...(intent ? { body: JSON.stringify(intent) } : {}),
  })
  if (!response.ok) throw new CallInterestError(response.status)
  const value = (await response.json())?.data
  if (!value || !Number.isSafeInteger(value.version) || value.version < 1
    || !validInstant(value.voice) || !validInstant(value.video)) throw new CallInterestError(502)
  return { voice: value.voice, video: value.video, version: value.version }
}

export function CallInterestSheet({ kind, context, onClose, onPhotoPreview }: {
  kind: Kind; context: InterestContext; onClose: () => void; onPhotoPreview?: () => void
}) {
  const { lang } = useI18n()
  const zh = isZh(lang)
  const [view, setView] = useState<{ sessionId: string; data?: Interests; busy: boolean; error?: boolean }>()
  const requestRef = useRef<AbortController | null>(null)
  const currentContext = useRef(context)
  currentContext.current = context
  const sessionId = context.sessionId
  const current = view?.sessionId === sessionId ? view : undefined
  const refresh = async (intent?: { kind: Kind; registered: boolean; version: number }) => {
    if (requestRef.current) return
    const controller = new AbortController()
    requestRef.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 12000)
    const live = () => requestRef.current === controller && currentContext.current.sessionId === sessionId
    setView({ sessionId, busy: true, data: current?.data })
    try {
      let data: Interests
      try { data = await request(currentContext.current, controller.signal, intent) }
      catch (error) {
        if (!(error instanceof CallInterestError) || error.status !== 412 || !live()) throw error
        data = await request(currentContext.current, controller.signal)
      }
      if (live()) setView({ sessionId, data, busy: false })
    } catch (error) {
      if (live()) {
        setView({ sessionId, busy: false, error: true })
        if (error instanceof CallInterestError && error.status === 401) currentContext.current.onUnauthorized()
      }
    } finally {
      window.clearTimeout(timeout)
      if (requestRef.current === controller) requestRef.current = null
    }
  }
  useEffect(() => {
    void refresh()
    return () => { requestRef.current?.abort(); requestRef.current = null }
  }, [sessionId])

  const title = kind === 'voice' ? (zh ? '语音通话' : 'Voice calls') : (zh ? '视频通话' : 'Video calls')
  const data = current?.data
  const registered = !!data?.[kind]
  return <Sheet title={title} onClose={onClose} footer={<div className="space-y-2">
    <button type="button" className="w-full min-h-12 rounded-full btn-dark px-4 text-[15px] disabled:opacity-60"
      disabled={!current || current.busy} aria-busy={current?.busy ?? true}
      onClick={() => void refresh(data ? { kind, registered: !registered, version: data.version } : undefined)}>
      {current?.error ? (zh ? '重新读取状态' : 'Check status again')
        : registered ? (zh ? '取消开通提醒' : 'Cancel reminder')
        : (zh ? '登记开通提醒' : 'Request a reminder')}
    </button>
    {onPhotoPreview && <button type="button" onClick={onPhotoPreview} className="w-full min-h-11 text-[14px] text-sky-deep">
      {zh ? '查看动态照片' : 'View moving photo'}
    </button>}
  </div>}>
    <p className="text-[15px] leading-relaxed text-ink-soft">{zh
      ? '实时通话暂未开放。你可以登记开通提醒，也可以随时取消。'
      : 'Live calls are not available yet. You can request an opening reminder and cancel it at any time.'}</p>
    <div className="mt-3 min-h-5 text-[13px] text-ink-soft" role="status">
      {(!current || current.busy) ? (zh ? '正在确认状态…' : 'Checking status…')
        : current.error ? (zh ? '暂时无法确认，请重新读取状态。' : 'Status is unavailable. Check again.')
        : registered ? (zh ? '已登记提醒。' : 'Reminder requested.') : null}
    </div>
  </Sheet>
}
