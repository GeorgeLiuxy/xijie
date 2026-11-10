import type { Person } from '../model'

export type ContactMatch = { person: Person; evidence: string; memoryId?: number }
type EvidenceLine = { text: string; memoryId?: number; normalizedTitle?: string }

const han = /\p{Script=Han}/u
const englishFillers = new Set('a an and are at by did do does find for from he her him his i in is it me my of on or our person she that the their them there this to was we who with would you'.split(' '))
const chineseFillers = /帮我找|我想找|我记得|我想起|我记起|那个人|的那位|那位|那个|是谁|的人|经常|总是|曾经|我们|我的|[我你她他的在]/gu
// Only recognize explicit negative predicates. A fuzzy overlap must not turn
// “不爱下棋” into “爱下棋”, or borrow an unrelated negation later in a memory.
const negation = /从来没(?:有)?|从未|从不|没有|[不没](?=爱|喜欢|来|去|在|等|接|会|想|能|是|愿|要|擅长|记得|曾|见|下棋)|\b(?:no longer|not|never|cannot|without)\b|n['’]t\b/iu
const clauseBreak = /[,，;；。.!！？?]|但是|不过|却|但|\b(?:but|however)\b/iu

function normalized(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function splitEvidence(text: string | undefined, memoryId?: number, isTitle = false): EvidenceLine[] {
  if (typeof text !== 'string' || !text.trim()) return []
  const normalizedTitle = isTitle ? normalized(text) : undefined
  return (text.match(/[^。！？!?\n]+[。！？!?]?/gu) ?? [])
    .map(line => ({ text: line.trim(), memoryId, normalizedTitle }))
    .filter(line => line.text)
}

function evidenceLines(person: Person): EvidenceLine[] {
  // Keep the original wording for the result card. Generated greetings, imagined
  // stories, and missing details are not sources for a remembered event.
  return [
    ...(person.memories ?? []).flatMap(memory => [
      ...splitEvidence(memory.body, memory.id),
      ...(negation.test(memory.body) ? [] : splitEvidence(memory.title, memory.id, true)),
    ]),
    ...[...(person.life ?? []), person.catchphrase, person.place, person.birthday, person.years]
      .flatMap(line => splitEvidence(line)),
  ]
}

function clueTerms(text: string): Set<string> {
  const terms = new Set<string>()
  for (const match of text.replace(chineseFillers, ' ').matchAll(/\p{Script=Han}+|[\p{Script=Latin}\p{N}]+|\p{L}+/gu)) {
    const word = match[0]
    if (han.test(word)) {
      // Character pairs let 校门口 match even when adjacent words differ or a
      // segmenter splits 在校 / 门口 in the query and 来校 / 门口 in the memory.
      const chars = Array.from(word)
      for (let i = 1; i < chars.length; i++) terms.add(chars[i - 1] + chars[i])
    } else if (!englishFillers.has(word)) {
      terms.add(word)
    }
  }
  return terms
}

function phraseMatch(line: string, query: string): boolean {
  if (han.test(query)) return line.includes(query)
  return (' ' + line + ' ').includes(' ' + query + ' ')
}

function overlapScore(line: string, query: string, terms: Set<string>): number {
  const value = normalized(line)
  if (value === query) return 85
  if (terms.size && phraseMatch(value, query)) return 85
  if (!terms.size) return 0
  const words = clueTerms(value)
  let hits = 0
  for (const term of terms) if (words.has(term)) hits++
  // Reject isolated fragments of a long recollection. Require the overlap to
  // occur in one evidence line so two unrelated facts cannot invent an event.
  const coverage = hits / terms.size
  return coverage >= 0.6 ? 40 + 30 * coverage : 0
}

function negativeTail(text: string): string | null {
  const cue = negation.exec(text)
  return cue ? normalized(text.slice(cue.index + cue[0].length).replace(/的人[？?。!！]?$/u, '')) : null
}

function evidenceScore(line: string, query: string, terms: Set<string>, predicate: string | null): number {
  if (predicate === null && !negation.test(line)) return overlapScore(line, query, terms)
  let score = 0
  for (const clause of line.split(clauseBreak)) {
    const tail = negativeTail(clause)
    if (predicate === null && tail === null) score = Math.max(score, overlapScore(clause, query, terms))
    if (predicate && tail !== null) {
      // A negated recollection requires the same explicit predicate after the
      // negation, not just related vocabulary somewhere in the source.
      const agrees = han.test(predicate) ? tail.startsWith(predicate) : (tail + ' ').startsWith(predicate + ' ')
      if (agrees) score = 85
    }
  }
  return score
}

export function searchContacts(people: Person[], query: string, worldLabel?: (world: Person['world']) => string): ContactMatch[] {
  const text = normalized(query)
  if (!text) return []
  const terms = clueTerms(text)
  const predicate = negativeTail(query.trim())
  const candidates = people.map((person): ContactMatch & { score: number } => {
    const names = [person.name, person.realName].filter((name): name is string => !!name)
    const exact = names.find(name => normalized(name) === text)
    if (exact) return { person, evidence: exact, score: 120 }
    let evidence = '', score = 0
    for (const name of names) {
      const value = normalized(name)
      if (han.test(text) ? value.includes(text) : (' ' + value).includes(' ' + text)) {
        evidence = name; score = 105; break
      }
    }
    if (person.relation && score < 100) {
      const relation = normalized(person.relation)
      if (relation === text || (terms.size && phraseMatch(relation, text))) {
        evidence = person.relation; score = 100
      }
    }
    const world = worldLabel?.(person.world)
    if (world && score < 95 && normalized(world) === text) {
      evidence = world; score = 95
    }
    let memoryId: number | undefined
    let exactMemoryTitle = false
    for (const line of evidenceLines(person)) {
      const weight = evidenceScore(line.text, text, terms, predicate)
      const isExactTitle = line.normalizedTitle === text
      if (weight > score || (weight > 0 && weight === score && isExactTitle && !exactMemoryTitle)) {
        evidence = line.text
        score = weight
        memoryId = line.memoryId
        exactMemoryTitle = isExactTitle
      }
    }
    return { person, evidence, score, ...(memoryId === undefined ? {} : { memoryId }) }
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score)
  const exactName = candidates[0]?.score === 120
  return candidates.filter(item => !exactName || item.score === 120).map(({ score: _score, ...match }) => match)
}

export function suggestClues(people: Person[]): string[] {
  const suggestions: string[] = []
  const groups = people.map(person => {
    const lines = evidenceLines(person).map(line => line.text)
    const savedKeywords = (person.keywords ?? []).filter(keyword => lines.some(line => line.includes(keyword)))
    const options = [...savedKeywords, ...lines.flatMap(line =>
      line.replace(/^.{1,16}[：:]/u, '').split(/[。！？!?，,；;：:\n]+/u))]
    return options.map(item => item.trim()).filter(item => {
      if (item.length < 2 || item.length > (han.test(item) ? 12 : 32)) return false
      const query = normalized(item), terms = clueTerms(query), predicate = negativeTail(item)
      return terms.size > 0 && lines.some(line => evidenceScore(line, query, terms, predicate) > 0)
    })
  })
  // Give different people a turn before offering another detail from one person.
  while (suggestions.length < 3) {
    const before = suggestions.length
    for (const group of groups) {
      const next = group.find(item => !suggestions.includes(item))
      if (next) suggestions.push(next)
      if (suggestions.length === 3) break
    }
    if (before === suggestions.length) break
  }
  return suggestions
}
