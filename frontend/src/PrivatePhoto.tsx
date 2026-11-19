import { useEffect, useRef, useState } from 'react'
import type { PostPhoto } from './model'
import { isZh, useI18n } from './i18n'
import { MediaError } from './serviceMedia'

export type ReadPrivatePhoto = (postId: number, photo: PostPhoto, signal: AbortSignal) => Promise<Blob>

// Private bytes are loaded only near the viewport, never stored with a post or
// in browser persistence. Leaving the viewport, permission changes and unmount
// all invalidate the object URL and fence late downloads.
export function PrivatePhoto({ postId, photo, read, className, contain = false, label, onOpen, permissionLabel }: {
  postId: number; photo: PostPhoto; read: ReadPrivatePhoto; className: string; contain?: boolean; label: string; onOpen?: () => void; permissionLabel?: string
}) {
  const { lang } = useI18n(), zh = isZh(lang)
  const host = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined')
  const [revision, setRevision] = useState(0)
  const [loaded, setLoaded] = useState<{ key: string; url: string }>()
  const [failed, setFailed] = useState<{ key: string; permission: boolean }>()
  const key = JSON.stringify([postId, photo.id, photo.version, photo.mimeType, photo.byteSize, photo.width, photo.height])
  const active = useRef<() => void>(() => {})
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !host.current) return
    const observer = new IntersectionObserver(entries => { setVisible(entries.some(entry => entry.isIntersecting)) }, { rootMargin: '160px' })
    observer.observe(host.current); return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const refresh = () => { active.current(); setLoaded(undefined); setFailed(undefined); setRevision(value => value + 1) }
    window.addEventListener('xijie:consents-changed', refresh); window.addEventListener('focus', refresh)
    return () => { window.removeEventListener('xijie:consents-changed', refresh); window.removeEventListener('focus', refresh) }
  }, [])
  useEffect(() => {
    if (!visible) return
    const controller = new AbortController(); let live = true, url: string | undefined
    const stop = () => { live = false; controller.abort(); if (url) URL.revokeObjectURL(url) }
    active.current = stop; setLoaded(undefined); setFailed(undefined)
    void read(postId, photo, controller.signal).then(blob => {
      if (!live || controller.signal.aborted) return
      url = URL.createObjectURL(blob)
      if (!live) { URL.revokeObjectURL(url); return }
      setLoaded({ key, url })
    }).catch(error => {
      if (live && !controller.signal.aborted) setFailed({ key, permission: error instanceof MediaError && error.status === 403 })
    })
    return stop
  }, [key, read, visible, revision])
  const source = visible && loaded?.key === key ? loaded.url : undefined, error = failed?.key === key ? failed : undefined
  const retry = () => { active.current(); setLoaded(undefined); setFailed(undefined); setRevision(value => value + 1) }
  return <div ref={host} className={'relative overflow-hidden bg-cloud ' + className}>
    <button type="button" aria-label={error ? zh ? '重新读取照片' : 'Retry photo' : label} className="relative block h-full w-full text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-deep"
      onClick={() => error ? retry() : onOpen?.()}>
      {source ? <img src={source} alt="" draggable={false} onError={() => { active.current(); setLoaded(undefined); setFailed({ key, permission: false }) }} className={'h-full w-full ' + (contain ? 'object-contain' : 'object-cover')} />
        : error ? <span role="status" className="absolute inset-0 flex items-center justify-center px-3 text-center text-[12px] leading-relaxed text-ink-soft">{error.permission ? permissionLabel ?? (zh ? '允许私人照片保存后查看' : 'Allow private photo storage to view') : zh ? '照片暂时无法显示，点击重试' : 'Photo unavailable. Tap to retry.'}</span>
          : <span role="status" aria-label={zh ? '正在读取照片' : 'Loading photo'} className="absolute inset-0 animate-pulse bg-cloud" />}
    </button>
  </div>
}
