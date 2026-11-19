export const SELF_HARM_SUPPORT_REQUIRED = 'SELF_HARM_SUPPORT_REQUIRED'

const quotations = /“[^”\n]*”|‘[^’\n]*’|「[^」\n]*」|『[^』\n]*』|"[^"\n]*"|`[^`\n]*`|(?<![\p{L}\p{N}])'[^'\n]*'(?![\p{L}\p{N}])/gu
const statementBoundary = /[。！？!?；;.\n]+|\b(?:but|however)\b|但是|可是|不过|然而|但(?=我|现在|此刻|今晚)/u

const zhNear = '(?:现在|此刻|马上|立刻|这就|这会儿|今天|今晚|今夜|一会儿|等会儿)(?:就)?'
const zhAction = '(?:自杀|自残|结束(?:我|自己)?的?生命|伤害(?:我)?自己)'
const zhImminent = new RegExp(
  `^(?:(?:我(?:真的)?${zhNear}|${zhNear}我)(?:要|想要?|准备|打算|计划|决定|正在)${zhAction}|我(?:真的)?(?:马上(?:就)?|立刻|这就(?:要)?|即将|正要|正在|已经决定)${zhAction}|我(?:真的)?要${zhAction}(?:了|$))`, 'u',
)
const zhIntentNear = new RegExp(`^我(?:真的)?(?:要|想要?|准备|打算|计划|决定)${zhNear}${zhAction}`, 'u')
const zhFiction = /(?:(?:这|那)(?:是|只是一?句)(?:电影|小说|游戏|角色)?(?:台词|对白|示例|例句)|(?:在|是|只是)(?:游戏|梦|剧本|小说|故事)(?:里|中)|(?:只是|是在)(?:开玩笑|打个比方|举例))/u
const zhFrame = /^(?:如果|假如|假设|设想|例如|比如|举个例子|请(?:翻译|引用|解释)|(?:在|这是)(?:游戏|剧本|小说|故事|电影)|(?:我)?(?:昨天|昨晚|以前|从前|去年|那时|刚才)(?:[，,]|说|想|写|问)|(?:他|她|他们|朋友|同事)[^，,]{0,12}(?:说|写|问))/u

const enNear = '(?:right now|now|tonight|today|very soon|in a few minutes)'
const enAction = '(?:kill myself|end my (?:own )?life|(?:die by|commit) suicide|hurt myself|harm myself|self-harm)'
const enIntending = "(?:i will|i'll|i(?: am|'m) (?:going to|planning to|ready to)|i (?:intend|plan|want) to)"
const enCurrent = new RegExp(`^(?:i(?: am|'m) about to ${enAction}|i(?: am|'m) going to (?:kill myself|end my (?:own )?life|(?:die by|commit) suicide))\\b`, 'u')
const enIntentNear = new RegExp(
  `^(?:${enNear}\\s*,?\\s+${enIntending}\\s+${enAction}|${enIntending}\\s+(?:${enNear}\\s+${enAction}|${enAction}\\s+${enNear}))\\b`, 'u',
)
const enInProgress = /^(?:i am|i'm) (?:(?:deliberately |intentionally )?harming myself|self-harming)(?: right)? now\b/u
const enFictionOrLater = /\b(?:in (?:the|a|this|my) (?:story|game|book|movie|script|dream)|(?:a|the) (?:quote|line of dialogue|hypothetical|example)|role[- ]play(?:ing)?|metaphorically|if|when|(?:some|one)day|next (?:week|month|year)|in (?:a few|several|two|three) (?:days|weeks|months|years))\b/u
const enFrame = /^(?:(?:if|suppose|imagine|for example|quote|translate|yesterday|last (?:year|month|week|night))\b|(?:i|he|she|they|my friend|my colleague) (?:said|wrote|asked|heard|remember|used to)\b)/u

/**
 * Recognizes a limited set of direct, first-person statements of imminent harm.
 * A result only controls this reply path. It says nothing about clinical risk
 * or what a user should infer from text outside these cases.
 */
export function needsCurrentSelfHarmSupport(text: string): boolean {
  const statements = text.normalize('NFKC')
    .replace(quotations, ' ')
    .replaceAll('’', "'")
    .toLowerCase()
    .split(statementBoundary)

  return statements.some(value => {
    const statement = value.trim().replace(/\s+/gu, ' ')
    if (statement.includes('我') && !zhFrame.test(statement) && !zhFiction.test(statement)
      && statement.split(/[,，]/u).some(value => {
        const clause=value.trim()
        return zhImminent.test(clause)||zhIntentNear.test(clause)
      })) return true
    return !enFrame.test(statement) && !enFictionOrLater.test(statement)
      && (enCurrent.test(statement)||enIntentNear.test(statement)||enInProgress.test(statement))
  })
}
