import { useEffect, useMemo, useRef, useState } from 'react'
import type { PostPhoto } from './model'
import { MediaClient, MediaError, validatePostPhoto } from './serviceMedia'

export type PhotoChoice = PostPhoto | string
type Context = { accountId: string; sessionId: string; onUnauthorized: () => void }
export function personPhotos(value: { mediaIds?: string[]; media?: PostPhoto[] }): PostPhoto[] {
  const ids = value.mediaIds ?? [], photos = value.media ?? []
  if (!Array.isArray(ids) || !Array.isArray(photos) || ids.length > 6 || new Set(ids).size !== ids.length || ids.length !== photos.length
    || photos.some((photo, index) => validatePostPhoto(photo).id !== ids[index])) throw new MediaError(502, 'INVALID_PERSON_PHOTOS')
  return photos
}

// Bytes live only in this mounted session. No photo bytes, proof or object URL
// enter business persistence. Every refresh fences pending reads and revokes URLs.
export function usePersonPhotoMedia(context: Context | undefined, records: { target: string; media: PostPhoto[] }[]) {
  const latest = useRef(context); latest.current = context
  const key = context ? JSON.stringify([context.accountId, context.sessionId]) : ''
  const scope = useMemo(() => {
    if (!context) return undefined
    const owner = { live: true, client: null as unknown as MediaClient }
    owner.client = new MediaClient({ ...context, live: () => owner.live && latest.current?.sessionId === context.sessionId && latest.current?.accountId === context.accountId,
      onUnauthorized: () => latest.current?.onUnauthorized() }, 'person_photo')
    return owner
  }, [key])
  const [state, setState] = useState<{ key: string; signature: string; urls: Record<string, string> }>({ key: '', signature: '', urls: {} })
  const [revision, setRevision] = useState(0)
  const stop = useRef<() => void>(() => {})
  const signature = JSON.stringify(records)
  useEffect(() => {
    if (scope) scope.live = true
    return () => { stop.current(); if (scope) { scope.live = false; scope.client.dispose() } }
  }, [scope])
  useEffect(() => {
    const refresh = () => { stop.current(); setState({ key: '', signature: '', urls: {} }); setRevision(v => v + 1) }
    window.addEventListener('xijie:consents-changed', refresh); window.addEventListener('focus', refresh)
    const visible = () => { if (document.visibilityState === 'visible') refresh(); else { stop.current(); setState({ key: '', signature: '', urls: {} }) } }
    document.addEventListener('visibilitychange', visible)
    return () => { window.removeEventListener('xijie:consents-changed', refresh); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visible) }
  }, [])
  useEffect(() => {
    if (!scope || document.visibilityState === 'hidden') return
    const controller = new AbortController(), urls: Record<string, string> = {}
    let live = true
    const cancel = () => { live = false; controller.abort(); Object.values(urls).forEach(URL.revokeObjectURL) }
    stop.current = cancel
    setState({ key, signature, urls: {} })
    for (const record of records) for (const photo of record.media) {
      void scope.client.read(photo, record.target, controller.signal).then(blob => {
        if (!live) return
        urls[photo.id] = URL.createObjectURL(blob)
        setState({ key, signature, urls: { ...urls } })
      }).catch(() => { /* Keep the established initials/empty photo fallback; focus or consent changes retry. */ })
    }
    return cancel
  }, [scope, signature, revision])
  return { client: scope?.client, urls: state.key === key && state.signature === signature ? state.urls : {} }
}
