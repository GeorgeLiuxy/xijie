import { useCallback, useEffect, useRef, useState } from 'react'

type Track = 'video' | 'audio'
type MediaState = {
  videoReady: boolean
  videoFailed: boolean
  audioFailed: boolean
  videoPaused: boolean
  audioOn: boolean
}
type Controller = {
  element: (track: Track) => HTMLMediaElement | null
  mayPlay: (track: Track) => boolean
  sync: () => void
  toggleVideo: () => void
  toggleAudio: () => void
}
const INITIAL: MediaState = {
  videoReady: false, videoFailed: false, audioFailed: false, videoPaused: true, audioOn: false,
}

/** A visit owns its media; returning from a conversation starts with sound off. */
export function useWorldMedia({ src, calm = false, suspended = false, ducked = false }: {
  src?: string
  calm?: boolean
  suspended?: boolean
  ducked?: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const controller = useRef<Controller | null>(null)
  const options = useRef({ calm, suspended, ducked })
  options.current = { calm, suspended, ducked }
  const [state, setState] = useState<MediaState>(INITIAL)

  useEffect(() => {
    setState(INITIAL)
    if (!src) return
    const video = videoRef.current
    const audio = audioRef.current
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let alive = true
    let previousCalm = options.current.calm
    let previousReduced = motion.matches
    const wanted = { video: !previousCalm && !previousReduced, audio: false }
    const failed = { video: false, audio: false }
    const pending = { video: false, audio: false }
    const sequence = { video: 0, audio: 0 }
    let volumeFrame = 0
    let volumeTarget = 0
    const element = (track: Track): HTMLMediaElement | null => track === 'video' ? video : audio
    const blocked = () => !alive || options.current.suspended || document.hidden
    const mayPlay = (track: Track) => !!element(track) && wanted[track] && !failed[track] && !blocked()
    const update = (patch: Partial<MediaState>) => {
      if (!alive) return
      setState(current => Object.entries(patch).every(([key, value]) => current[key as keyof MediaState] === value)
        ? current : { ...current, ...patch })
    }
    const reflectPlayback = (track: Track, playing: boolean) => update(track === 'video'
      ? { videoPaused: !playing } : { audioOn: playing })

    function fadeVolume() {
      if (!audio || !mayPlay('audio')) return
      const target = options.current.ducked ? 0.1 : 0.25
      if (target === volumeTarget && (volumeFrame || audio.volume === target)) return
      cancelAnimationFrame(volumeFrame)
      volumeTarget = target
      const from = audio.volume
      const started = performance.now()
      const tick = (now: number) => {
        if (!alive || !mayPlay('audio')) { volumeFrame = 0; return }
        const progress = Math.min(1, (now - started) / 550)
        audio.volume = from + (target - from) * progress
        if (progress < 1) volumeFrame = requestAnimationFrame(tick)
        else volumeFrame = 0
      }
      volumeFrame = requestAnimationFrame(tick)
    }

    function stop(track: Track) {
      sequence[track]++
      pending[track] = false
      const media = element(track)
      media?.pause()
      if (track === 'audio') {
        cancelAnimationFrame(volumeFrame)
        volumeFrame = 0
        volumeTarget = 0
        if (audio) audio.volume = 0
      }
      reflectPlayback(track, false)
    }

    // A stale play() may settle after a pause, unmount, or source replacement.
    // Only the current owner is allowed to leave that element playing.
    function stopIfUnowned(track: Track, media: HTMLMediaElement) {
      const owner = controller.current
      if (!owner || owner.element(track) !== media || !owner.mayPlay(track)) media.pause()
    }

    function start(track: Track) {
      const media = element(track)
      if (!media || !mayPlay(track)) { stop(track); return }
      if (!media.paused || pending[track]) { if (track === 'audio') fadeVolume(); return }
      const attempt = ++sequence[track]
      pending[track] = true
      const rejected = () => {
        if (!alive || attempt !== sequence[track]) { stopIfUnowned(track, media); return }
        pending[track] = false
        wanted[track] = false
        media.pause()
        if (track === 'audio') {
          cancelAnimationFrame(volumeFrame); volumeFrame = 0; volumeTarget = 0; media.volume = 0
          update({ audioFailed: true, audioOn: false })
        } else update({ videoPaused: true })
      }
      try {
        Promise.resolve(media.play()).then(() => {
          if (!alive || attempt !== sequence[track] || !mayPlay(track)) { stopIfUnowned(track, media); return }
          pending[track] = false
          reflectPlayback(track, !media.paused)
          if (track === 'audio') fadeVolume()
        }, rejected)
      } catch { rejected() }
    }

    function sync() {
      if (!alive) return
      if ((options.current.calm && !previousCalm) || (motion.matches && !previousReduced)) wanted.video = false
      previousCalm = options.current.calm
      previousReduced = motion.matches
      for (const track of ['video', 'audio'] as const) {
        if (mayPlay(track)) start(track)
        else stop(track)
      }
    }

    function toggle(track: Track) {
      if (!alive || !element(track)) return
      wanted[track] = !wanted[track]
      if (wanted[track]) {
        if (track === 'audio') update({ audioFailed: false })
        if (failed[track]) {
          failed[track] = false
          if (track === 'video') update({ videoFailed: false, videoReady: false })
          element(track)?.load()
        }
      }
      // Invoked synchronously by the click, preserving browser user activation.
      sync()
    }

    const engine: Controller = {
      element, mayPlay, sync,
      toggleVideo: () => toggle('video'), toggleAudio: () => toggle('audio'),
    }
    controller.current = engine
    const cleanups: (() => void)[] = []
    for (const track of ['video', 'audio'] as const) {
      const media = element(track)
      if (!media) continue
      media.loop = true
      if (track === 'video') { media.muted = true; media.volume = 0 }
      else { media.muted = false; media.volume = 0 }
      const onPlaying = () => {
        if (!mayPlay(track)) { media.pause(); reflectPlayback(track, false); return }
        reflectPlayback(track, true)
        if (track === 'video') update({ videoReady: true })
        else fadeVolume()
      }
      const onPause = () => reflectPlayback(track, false)
      const onError = () => {
        failed[track] = true; wanted[track] = false; stop(track)
        update(track === 'video' ? { videoFailed: true, videoReady: false } : { audioFailed: true })
      }
      media.addEventListener('playing', onPlaying)
      media.addEventListener('pause', onPause)
      media.addEventListener('error', onError)
      cleanups.push(() => {
        media.removeEventListener('playing', onPlaying)
        media.removeEventListener('pause', onPause)
        media.removeEventListener('error', onError)
      })
    }
    const onReady = () => { if (video && video.readyState >= 2 && !failed.video) update({ videoReady: true }) }
    video?.addEventListener('loadeddata', onReady)
    video?.addEventListener('canplay', onReady)
    document.addEventListener('visibilitychange', sync)
    if (motion.addEventListener) motion.addEventListener('change', sync)
    else motion.addListener(sync)
    onReady()
    sync()
    return () => {
      alive = false
      if (controller.current === engine) controller.current = null
      for (const cleanup of cleanups) cleanup()
      video?.removeEventListener('loadeddata', onReady)
      video?.removeEventListener('canplay', onReady)
      document.removeEventListener('visibilitychange', sync)
      if (motion.removeEventListener) motion.removeEventListener('change', sync)
      else motion.removeListener(sync)
      stop('video'); stop('audio')
    }
  }, [src])

  useEffect(() => { controller.current?.sync() }, [calm, suspended, ducked])
  const toggleVideo = useCallback(() => controller.current?.toggleVideo(), [])
  const toggleAudio = useCallback(() => controller.current?.toggleAudio(), [])
  return { videoRef, audioRef, ...state, toggleVideo, toggleAudio }
}
