export const ATLAS_INTENT_PX = 8
export const ATLAS_RELEASE_INTENT_PX = 14
export const ATLAS_FLICK_PX_MS = 0.45

export function clampAtlasIndex(index: number, count: number): number {
  return Math.max(0, Math.min(Math.max(0, count - 1), Math.round(index)))
}

/** Delta is in CSS pixels; scale converts stage/ruler distance to the shared step. */
export function atlasDragPosition(index: number, count: number, delta: number, step: number, scale = 1, visualStart = index): number {
  const position = visualStart - delta * scale / Math.max(1, step)
  const last = Math.max(0, count - 1)
  // Stay near the adjacent worlds even on the ruler's amplified travel. Include
  // a still-animating starting position so interrupting it never jumps on down.
  const first = Math.min(visualStart, Math.max(0, index - 1))
  const final = Math.max(visualStart, Math.min(last, index + 1))
  if (position < first) return first - Math.min(0.22, (first - position) * 0.22)
  if (position > final) return final + Math.min(0.22, (position - final) * 0.22)
  return position
}

export function atlasReleaseIndex({ index, count, delta, velocity, step, scale = 1, canceled = false }: {
  index: number
  count: number
  delta: number
  /** Recent velocity in unscaled CSS pixels per millisecond. */
  velocity: number
  step: number
  scale?: number
  canceled?: boolean
}): number {
  const start = clampAtlasIndex(index, count)
  if (canceled || Math.abs(delta) < ATLAS_RELEASE_INTENT_PX) return start
  const crossed = Math.abs(delta * scale) >= Math.max(1, step) * 0.25
  const flicked = Math.abs(velocity) >= ATLAS_FLICK_PX_MS && Math.sign(velocity) === Math.sign(delta)
  return crossed || flicked ? clampAtlasIndex(start + (delta < 0 ? 1 : -1), count) : start
}
