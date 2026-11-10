import type { CSSProperties } from 'react'

/** Older WebViews report unzoomed bounds, which also breaks touch hit tests. */
export function hasLegacyZoomBounds(): boolean {
  if (typeof document === 'undefined' || !document.body) return false
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;left:0;top:0;width:10px;height:10px;zoom:2;visibility:hidden;pointer-events:none'
  document.body.appendChild(probe)
  const width = probe.getBoundingClientRect().width
  probe.remove()
  return width > 0 && width < 15
}

export function contentZoomStyle(zoom: number, legacyBounds: boolean): CSSProperties {
  if (!legacyBounds || zoom === 1) return { zoom }
  return {
    zoom: 1,
    width: `${100 / zoom}%`, height: `${100 / zoom}%`,
    right: 'auto', bottom: 'auto',
    transform: `scale(${zoom})`, transformOrigin: 'top left',
  }
}
