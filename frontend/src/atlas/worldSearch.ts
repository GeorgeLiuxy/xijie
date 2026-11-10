export type SearchableWorld = { id: string; name: string; code: string; law: string }
export type WorldResident = { world: string; name: string; realName?: string; relation?: string }
export type WorldMatch<T extends SearchableWorld> = { world: T; residentCount: number }

const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const codeKey = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Only registered worlds participate; residents enrich their existing directory rows. */
export function searchWorlds<T extends SearchableWorld>(
  worlds: readonly T[], people: readonly WorldResident[], query: string,
  options: { connectedOnly?: boolean; currentWorld?: string } = {},
): WorldMatch<T>[] {
  const residents = new Map<string, WorldResident[]>()
  for (const person of people) {
    const list = residents.get(person.world) ?? []
    list.push(person)
    residents.set(person.world, list)
  }
  const text = normalize(query)
  if (query.trim() && !text) return []
  const completeCode = /^ely[\s·._-]*\d+$/i.test(query.normalize('NFKC').trim())
  const terms = completeCode ? [codeKey(query)] : text.split(' ').filter(Boolean)
  const matches = worlds.flatMap(world => {
    const living = residents.get(world.id) ?? []
    if (options.connectedOnly && !living.length) return []
    const fields = [world.name, world.law, ...living.flatMap(person => [person.name, person.realName ?? '', person.relation ?? ''])].map(normalize)
    const code = codeKey(world.code)
    const matched = terms.every(term => fields.some(field => field.includes(term))
      || (/^ely\d+$/.test(term) ? code === term : !!codeKey(term) && code.includes(codeKey(term))))
    return matched ? [{ world, residentCount: living.length }] : []
  })
  // A query keeps registry order; the resting directory starts with the current world.
  if (!text && options.currentWorld) {
    const current = matches.findIndex(match => match.world.id === options.currentWorld)
    if (current > 0) matches.unshift(...matches.splice(current, 1))
  }
  return matches
}

/** Bound both result groups and clamp a stale page after their source data changes. */
export function resultPage<T>(items: readonly T[], requestedPage: number, pageSize: number) {
  const size = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : 24
  const pages = Math.ceil(items.length / size)
  const requested = Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0
  const page = Math.max(0, Math.min(requested, Math.max(0, pages - 1)))
  const start = page * size
  return { items: items.slice(start, start + size), page, pages, total: items.length,
    start: items.length ? start + 1 : 0, end: Math.min(start + size, items.length) }
}
