import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { STORE, isNight, type Theme } from '../model'
import { NightCtx, fxPrefs } from '../ui'
import { isNativeRuntime, useNativeBack } from '../mobile/back'
import { contentZoomStyle, hasLegacyZoomBounds } from '../mobile/layout'
import './goals.css'

function preferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}')
    const theme: Theme = saved.theme === 'day' || saved.theme === 'night' ? saved.theme : 'auto'
    return { theme, large: saved.large === true, calm: saved.calm === true, haptics: saved.haptics !== false, sound: saved.sound === true }
  } catch { return { theme: 'auto' as Theme, large: false, calm: false, haptics: true, sound: false } }
}

/** Public links bypass App, but still respect this browser's display preferences. */
export function PublicGiftFrame({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState(preferences)
  const [legacyZoom, setLegacyZoom] = useState(false)
  const frame = useRef<HTMLDivElement>(null)
  const night = isNight(prefs.theme)
  useLayoutEffect(() => { setLegacyZoom(hasLegacyZoomBounds()) }, [])
  useLayoutEffect(() => {
    const before = { ...fxPrefs }
    fxPrefs.calm = prefs.calm || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    fxPrefs.haptics = prefs.haptics
    fxPrefs.sound = prefs.sound
    return () => { Object.assign(fxPrefs, before) }
  }, [prefs])
  useEffect(() => {
    const update = (event: StorageEvent) => { if (event.key === STORE || event.key === null) setPrefs(preferences()) }
    window.addEventListener('storage', update)
    return () => window.removeEventListener('storage', update)
  }, [])
  useEffect(() => {
    if (!isNativeRuntime()) return
    const bridge = (window as Window & { Capacitor?: { nativePromise?: (plugin: string, method: string, options: object) => Promise<unknown> } }).Capacitor
    if (!bridge?.nativePromise) return
    let active = true
    const sync = () => {
      const color = getComputedStyle(frame.current ?? document.documentElement).getPropertyValue('--color-canvas').trim()
      void bridge.nativePromise!('SystemBars', 'setStyle', { style: night ? 'DARK' : 'LIGHT' })
        .then(() => active ? bridge.nativePromise!('WindowSurface', 'setBackground', { color }) : undefined).catch(() => {})
    }
    sync()
    window.addEventListener('resize', sync)
    return () => { active = false; window.removeEventListener('resize', sync) }
  }, [night])
  useNativeBack(() => { location.assign(import.meta.env.BASE_URL); return true }, true, 0, frame)
  return <NightCtx.Provider value={night}>
    <div ref={frame} className={`gg-standalone${night ? ' night' : ''}${prefs.calm ? ' calm' : ''}`}>
      <div className="gg-device app-device-frame"><div className="gg-public-content" style={contentZoomStyle(prefs.large ? 1.14 : 1, legacyZoom)}>{children}</div></div>
    </div>
  </NightCtx.Provider>
}
