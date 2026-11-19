import { createRequire } from 'node:module'
import { parseArgs } from 'node:util'

const require = createRequire(new URL('../../backend/services/identity/package.json', import.meta.url))
const { Pool } = require('pg')
const day = 86400000
const connectionKeys = ['IDENTITY', 'PEOPLE', 'CONVERSATIONS', 'MEMORIES']

function date(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) throw new Error('Use YYYY-MM-DD for both cohort boundaries')
  const instant = new Date(value + 'T00:00:00.000Z')
  if (!Number.isFinite(+instant) || instant.toISOString().slice(0, 10) !== value) throw new Error('Invalid UTC date')
  return instant
}

function durations(accounts, times) {
  const minutes = accounts.flatMap(row => {
    const stamp = times.get(row.id)
    return stamp && +stamp >= +row.registered_at ? [(+stamp - +row.registered_at) / 60000] : []
  }).sort((a, b) => a - b)
  if (!minutes.length) return null
  const lower = minutes[Math.floor((minutes.length - 1) / 2)]
  const upper = minutes[Math.floor(minutes.length / 2)]
  return Math.round((lower + upper) * 5) / 10
}

async function main() {
  const { values } = parseArgs({ options: { since: { type: 'string' }, until: { type: 'string' } } })
  const since = date(values.since), until = date(values.until), measuredAt = new Date()
  if (+since >= +until || +until - +since > 31 * day || +until > +measuredAt) throw new Error('Choose a completed cohort window of at most 31 UTC days')
  const urls = connectionKeys.map(key => process.env['XIJIE_METRICS_' + key + '_DATABASE_URL'])
  if (urls.some(value => !value)) throw new Error('All four read-only metrics connections must be configured')
  const pools = urls.map(connectionString => new Pool({
    connectionString, max: 1, connectionTimeoutMillis: 5000,
    options: '-c default_transaction_read_only=on -c statement_timeout=10000',
  }))
  const [identity, people, conversations, memories] = pools
  try {
    const accounts = (await identity.query(`
      SELECT id,registered_at FROM accounts
      WHERE status='active' AND registered_at>=$1 AND registered_at<$2 ORDER BY registered_at,id LIMIT 10001
    `, [since, until])).rows
    if (accounts.length > 10000) throw new Error('Choose a smaller cohort window')
    const ids = accounts.map(row => row.id)
    const cohortTimes = accounts.map(row => row.registered_at)
    const [personRows, messageRows, memoryRows, letterRows, viewedRows, revisitRows] = await Promise.all([
      people.query("SELECT account_id,min(created_at) AS first FROM persons WHERE account_id=ANY($1::uuid[]) AND created_at<=$2 GROUP BY account_id", [ids, measuredAt]),
      conversations.query(`SELECT account_id,
        min(created_at) FILTER(WHERE author_kind='self') AS first_send,
        min(created_at) FILTER(WHERE author_kind='persona') AS first_reply
        FROM messages WHERE account_id=ANY($1::uuid[]) AND conversation_kind='direct' AND kind='text' AND created_at<=$2 GROUP BY account_id`, [ids, measuredAt]),
      memories.query("SELECT account_id,min(confirmed_at) AS first FROM memories WHERE account_id=ANY($1::uuid[]) AND origin IN('manual','ai_candidate') AND confirmed_at<=$2 GROUP BY account_id", [ids, measuredAt]),
      conversations.query("SELECT account_id,min(created_at) AS first FROM letter_replies WHERE account_id=ANY($1::uuid[]) AND created_at<=$2 GROUP BY account_id", [ids, measuredAt]),
      conversations.query("SELECT DISTINCT account_id FROM letter_read_cursors WHERE account_id=ANY($1::uuid[]) AND read_at<=$2 AND last_read_sequence>0", [ids, measuredAt]),
      conversations.query(`SELECT DISTINCT m.account_id FROM unnest($1::uuid[],$2::timestamptz[]) a(id,registered_at)
        JOIN messages m ON m.account_id=a.id AND m.created_at>=a.registered_at+interval '168 hours'
         AND m.created_at<a.registered_at+interval '192 hours'
        WHERE a.registered_at+interval '192 hours'<=$3 AND m.conversation_kind='direct' AND m.kind='text' AND m.author_kind='self'`,
      [ids, cohortTimes, measuredAt]),
    ])
    const map = (result, field = 'first') => new Map(result.rows.flatMap(row => row[field] ? [[row.account_id, row[field]]] : []))
    const built = map(personRows), sent = map(messageRows, 'first_send'), replied = map(messageRows, 'first_reply'), kept = map(memoryRows)
    const keptAfterReply = accounts.filter(row => {
      const save = kept.get(row.id), reply = replied.get(row.id)
      return save && reply && +save >= +reply
    }).length
    console.log(JSON.stringify({
      window: { since: since.toISOString(), until: until.toISOString(), measuredAt: measuredAt.toISOString(), zone: 'UTC', activeAccountsOnly: true },
      accounts: accounts.length,
      createdPerson: built.size, sentDirectText: sent.size, receivedDirectAIText: replied.size,
      confirmedOriginalMemory: kept.size, confirmedFirstMemoryAfterFirstAIText: keptAfterReply,
      receivedLetterReply: letterRows.rowCount, acknowledgedAnyLetterReply: viewedRows.rowCount,
      minutesToFirstConfirmedMemoryMedian: durations(accounts, kept),
      day7: { matureAccounts: accounts.filter(row => +row.registered_at + 8 * day <= +measuredAt).length,
        accountsSendingDirectText: revisitRows.rowCount },
    }, null, 2))
  } finally { await Promise.all(pools.map(pool => pool.end())) }
}

main().catch(error => {
  // Query drivers may include connection details on failure.
  console.error(error.code ? 'Metrics query failed (' + error.code + ')' : 'Metrics could not be read. Check the UTC date arguments and read-only connections.')
  process.exitCode = 1
})
