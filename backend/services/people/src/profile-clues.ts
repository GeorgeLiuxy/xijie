const clueLabels = '性格|个性|说话方式|说话风格|说话习惯|语气|口头禅|personality|communication style|speaking style|speech style|catchphrase'
const explicitClue = new RegExp(`^(?:[-*•][ \\t]*)?(${clueLabels})[ \\t]*[:：][ \\t]*(.+)$`, 'iu')
const entryBoundary = new RegExp(`[\\r\\n]|[；;](?=[ \\t]*(?:[-*•][ \\t]*)?(?:${clueLabels})[ \\t]*[:：])`, 'iu')
const quoted = /^(?:“(.+)”|「(.+)」|『(.+)』|"(.+)")$/u
const spokenStyle = /^(?:TA|他|她)[ \t]*说话[ \t]*(?:很|比较|非常|特别|有点)?(?:温和|温柔|平静|轻柔|幽默|风趣|直接|简短|简洁|严谨|干脆|有条理|不紧不慢|慢条斯理|轻声细语|轻|慢|快)$/iu
const spokenStyleEnglish = /^(?:they|he|she) (?:speak|speaks|talk|talks) (?:very |quite )?(?:gently|softly|calmly|directly|briefly|clearly|quietly|slowly|quickly)$/iu
const unspecified = /^(?:无|没有|未知|不清楚|不确定|暂不了解|none|unknown|not sure|unsure|n\/a)[。.]?$/iu

/** Project only language the user supplied. Story remains the source of these profile clues. */
export function profileClues(story: string) {
  const personality: string[] = []
  const seen = new Set<string>()
  let catchphrase: string | null = null

  function addPersonality(clue: string) {
    if (personality.length >= 6 || !clue || [...clue].length > 80 || unspecified.test(clue)) return
    const key = clue.normalize('NFKC').toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    personality.push(clue)
  }

  for (const fragment of story.split(entryBoundary)) {
    const entry = explicitClue.exec(fragment.trim())
    if (entry) {
      const label = entry[1].toLowerCase()
      const value = entry[2].trim()
      if (label === '口头禅' || label === 'catchphrase') {
        const quotation = quoted.exec(value)?.slice(1).find(Boolean)?.trim()
        const phrase = quotation ?? value
        if (!catchphrase && phrase && [...phrase].length <= 120 && (quotation !== undefined || !unspecified.test(phrase))) catchphrase = phrase
      } else {
        const traits = value.split('、').map(trait => trait.trim())
        if (traits.length > 1 && traits.every(trait => trait && [...trait].length <= 16 && !/[“”「」『』"。！？]/u.test(trait))) {
          traits.forEach(addPersonality)
        } else {
          addPersonality(value)
        }
      }
      continue
    }
    for (const [, sentence, end] of fragment.matchAll(/([^。！？.!?；;]+)([。！？.!?；;]|$)/gu)) {
      if (end === '?' || end === '？') continue
      const clue = sentence.trim()
      if (spokenStyle.test(clue) || spokenStyleEnglish.test(clue)) addPersonality(clue)
    }
  }

  return { personality, catchphrase }
}
