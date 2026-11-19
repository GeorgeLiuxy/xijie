import { useEffect, useRef, useState } from 'react'
import { isZh, useI18n } from './i18n'
import { ChatReplySpeechPermission } from './auth/AiTextPermission'

type Props = {
  conversationId: string
  messageId: string
  messageVersion: number
  sessionId: string
  onUnauthorized: () => void
}
type SpeechState = 'queued' | 'running' | 'ready' | 'failed' | 'blocked'
const maximumBytes = 2_160_044
class SpeechError extends Error {
  constructor(readonly status: number, readonly code?: string) { super('Reply speech request failed') }
}

export function ChatReplySpeech(props: Props) {
  if (import.meta.env.VITE_CONVERSATIONS_SPEECH_ENABLED !== 'true') return null
  const key = JSON.stringify([props.sessionId, props.conversationId, props.messageId, props.messageVersion])
  return <SpeechControl key={key} {...props}/>
}

function SpeechControl({ conversationId, messageId, messageVersion, sessionId, onUnauthorized }: Props) {
  const zh = isZh(useI18n().lang)
  const [busy, setBusy] = useState(false)
  const [permissionRequired, setPermissionRequired] = useState(false)
  const [url, setUrl] = useState<string>()
  const [notice, setNotice] = useState('')
  const request = useRef<AbortController | undefined>(undefined)
  const audioUrl = useRef<string | undefined>(undefined)
  const player = useRef<HTMLAudioElement>(null)
  const key = useRef<string | undefined>(undefined)

  function clearAudio() {
    player.current?.pause()
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current)
    audioUrl.current = undefined
  }
  useEffect(() => {
    const changed = () => {
      request.current?.abort()
      request.current = undefined
      clearAudio(); setUrl(undefined); setNotice(''); setBusy(false); setPermissionRequired(false)
    }
    window.addEventListener('xijie:consents-changed', changed)
    return () => {
      window.removeEventListener('xijie:consents-changed', changed)
      request.current?.abort()
      request.current = undefined
      clearAudio()
    }
  }, [])

  async function generate() {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true); setNotice(''); setPermissionRequired(false)
    const root = '/v1/conversations/' + encodeURIComponent(conversationId) + '/messages/' + encodeURIComponent(messageId) + '/speech'
    const scope = () => request.current === controller && !controller.signal.aborted
    const fetchSpeech = async (suffix = '', init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      headers.set('X-Xijie-Expected-Session', sessionId)
      headers.set('If-Match', '"v' + messageVersion + '"')
      const response = await fetch(root + suffix, { ...init, headers,
        credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      })
      if (!response.ok) {
        const problem = await response.json().catch(() => null)
        throw new SpeechError(response.status, problem?.error?.code)
      }
      return response
    }
    const state = async (response: Response) => {
      const value = (await response.json()).data
      if (value === null) return null
      if (!value || !['queued','running','ready','failed','blocked'].includes(value.state)) throw new SpeechError(502)
      return value.state as SpeechState
    }
    try {
      let current = await state(await fetchSpeech())
      if (current === null) {
        key.current ??= crypto.randomUUID()
        current = await state(await fetchSpeech('', { method: 'POST', headers: {
          'Content-Type': 'application/json', 'Idempotency-Key': key.current,
        }, body: '{}' }))
      }
      for (let i = 0; scope() && i < 21 && (current === 'queued' || current === 'running'); i++) {
        await new Promise(resolve => window.setTimeout(resolve, 1300))
        if (!scope()) return
        current = await state(await fetchSpeech())
      }
      if (!scope()) return
      if (current === 'ready') {
        const response = await fetchSpeech('/audio')
        const expected = Number(response.headers.get('Content-Length'))
        if (response.headers.get('Content-Type') !== 'audio/wav' || !Number.isSafeInteger(expected)
          || expected < 46 || expected > maximumBytes) throw new SpeechError(502)
        const blob = await response.blob()
        if (!scope()) return
        if (blob.size !== expected || blob.type !== 'audio/wav') throw new SpeechError(502)
        clearAudio()
        audioUrl.current = URL.createObjectURL(blob); setUrl(audioUrl.current)
      } else {
        setNotice(current === 'queued' || current === 'running'
          ? (zh ? '正在准备语音，稍后可再查看。' : 'Speech is being prepared. Check again shortly.')
          : (zh ? '这条回应的语音暂时无法合成。' : 'Speech could not be prepared for this reply.'))
      }
    } catch (error) {
      if (!scope()) return
      const problem = error instanceof SpeechError ? error : undefined
      if (problem?.status === 401) onUnauthorized()
      setPermissionRequired(problem?.code === 'REPLY_SPEECH_PERMISSION_REQUIRED')
      setNotice(problem?.code === 'REPLY_SPEECH_PERMISSION_REQUIRED'
        ? (zh ? '请先选择是否允许合成朗读。' : 'Choose whether to allow synthesized speech first.')
        : problem?.code === 'REPLY_SPEECH_LIMIT'
          ? (zh ? '已达到当前可保存的朗读数量。' : 'Your current saved speech limit has been reached.')
          : problem?.code === 'REPLY_SPEECH_DISABLED'
            ? (zh ? '合成朗读暂未开放。' : 'Synthesized speech is currently unavailable.')
            : (zh ? '现在无法读取语音，请稍后再试。' : 'Speech could not be loaded. Try again shortly.'))
    } finally {
      if (scope()) { request.current = undefined; setBusy(false) }
    }
  }

  return <div className="ml-11 mt-1 max-w-[80%] text-[12px] text-ink-soft" onClick={event => event.stopPropagation()}>
    {url ? <>
      <p className="mb-1">{zh ? 'AI 合成语音' : 'AI-generated speech'}</p>
      <audio ref={player} controls preload="metadata" className="h-10 w-full max-w-[240px]" src={url}
        aria-label={zh ? 'AI 合成朗读播放器' : 'AI speech player'}/>
    </> : <button type="button" disabled={busy} onClick={() => void generate()} className="min-h-11 px-1 text-left text-sky-deep disabled:text-ink-soft">
      {busy ? (zh ? '正在准备语音…' : 'Preparing speech…') : (zh ? '听 AI 朗读' : 'Listen to AI speech')}
    </button>}
    {notice && <p role="status">{notice}</p>}
    {permissionRequired && <details className="mt-1">
      <summary>{zh ? '合成朗读权限' : 'Synthesized speech permission'}</summary>
      <ChatReplySpeechPermission sessionId={sessionId} onUnauthorized={onUnauthorized}/>
    </details>}
  </div>
}
