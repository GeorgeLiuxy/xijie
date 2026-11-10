import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Plugin } from 'vite'

type Account = {
  browser: string
  joinedAt: number
  invite?: string
  publicName?: string
  referredBy?: string
  referralId?: string
  firstMemoryAt?: number
}
type Accounts = Record<string, Account>
const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const folder = join(tmpdir(), 'elysium-preview-invites-' + digest(resolve('.')).slice(0, 16))
const filename = join(folder, 'accounts.json')
const validOwner = (value: unknown): value is string => typeof value === 'string' && value.length <= 256 &&
  /^(?:tel\.\+?\d{1,5}\.\d{6,16}|login\.[a-zA-Z0-9_-]{1,128})$/.test(value)

function read(): Accounts {
  try { return JSON.parse(readFileSync(filename, 'utf8')) as Accounts }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error }
}
function save(accounts: Accounts) {
  mkdirSync(folder, { recursive: true })
  writeFileSync(filename + '.part', JSON.stringify(accounts), { mode: 0o600 })
  renameSync(filename + '.part', filename)
}
function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}
function browserId(req: IncomingMessage, res: ServerResponse) {
  const existing = req.headers.cookie?.match(/(?:^|;\s*)xj-preview-visitor=([^;]+)/)?.[1]
  if (existing && uuid.test(existing)) return existing
  const id = randomUUID()
  res.setHeader('Set-Cookie', 'xj-preview-visitor=' + id + '; Path=/api/invites; HttpOnly; SameSite=Lax; Max-Age=31536000')
  return id
}
function summary(accounts: Accounts, key: string) {
  const account = accounts[key]
  const guests = Object.values(accounts).filter(a => a.referredBy === key).sort((a, b) => b.joinedAt - a.joinedAt)
  const rewards = guests.filter(a => a.firstMemoryAt).map(a => 'invite:' + a.referralId + ':host')
  if (account.referredBy && account.firstMemoryAt) rewards.push('invite:' + account.referralId + ':guest')
  return { inviteId: account.invite ?? null, publicName: account.publicName ?? '', rewards,
    friends: guests.map(a => ({ joinedAt: a.joinedAt, memoryAt: a.firstMemoryAt ?? null })) }
}
async function handle(req: IncomingMessage, res: ServerResponse) {
  const path = (req.url ?? '').split('?')[0]
  const get = req.method === 'GET'
  if (req.method !== 'POST' && !get) return send(res, 405, { error: 'method' })
  if (get) {
    if (path === '/session') { browserId(req, res); return send(res, 200, { ok: true }) }
    const id = path.slice('/public/'.length)
    const host = path.startsWith('/public/') && uuid.test(id) && Object.values(read()).find(account => account.invite === id)
    if (!host) return send(res, 404, { error: 'missing' })
    return send(res, 200, { valid: true, publicName: host.publicName ?? '' })
  }
  if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host))
    return send(res, 403, { error: 'origin' })
  if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, { error: 'format' })
  let raw = ''
  req.setEncoding('utf8')
  for await (const chunk of req) {
    raw += chunk
    if (Buffer.byteLength(raw) > 2048) return send(res, 413, { error: 'size' })
  }
  let body: { owner?: string; inviteId?: string; existing?: boolean; publicName?: string }
  try { body = JSON.parse(raw) } catch { return send(res, 400, { error: 'invalid' }) }
  if (!body || !validOwner(body.owner)) return send(res, 400, { error: 'owner' })
  const visitor = browserId(req, res)
  const key = digest(body.owner), accounts = read()
  let account: Account | undefined = accounts[key]
  if (account && account.browser !== visitor) return send(res, 403, { error: 'other-browser' })

  // The only asynchronous work precedes this point. Registration attribution and both
  // reward grants are committed in one atomic file replacement in the preview server.
  if (path === '/login') {
    if (!account) {
      const referral = body.inviteId && uuid.test(body.inviteId) ? Object.entries(accounts).find(([, a]) => a.invite === body.inviteId) : null
      const firstLoginInBrowser = !Object.values(accounts).some(a => a.browser === visitor)
      account = { browser: visitor, joinedAt: Date.now() }
      if (referral && referral[0] !== key && !body.existing && firstLoginInBrowser) {
        account.referredBy = referral[0]
        account.referralId = randomUUID()
      }
      accounts[key] = account
      save(accounts)
    }
    return send(res, 200, { ok: true })
  }
  if (!account) return send(res, 403, { error: 'login-required' })
  if (path === '/create') {
    if (!account.invite) {
      if (typeof body.publicName !== 'string' || !body.publicName.trim() || body.publicName.length > 32)
        return send(res, 400, { error: 'public-name' })
      account.publicName = body.publicName.trim()
      account.invite = randomUUID()
      save(accounts)
    }
  } else if (path === '/memory') {
    if (!account.firstMemoryAt) { account.firstMemoryAt = Date.now(); save(accounts) }
  } else if (path !== '/status') return send(res, 404, { error: 'missing' })
  return send(res, 200, summary(accounts, key))
}
export function inviteService(): Plugin {
  const middleware = (req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res).catch(() => { if (!res.headersSent) send(res, 500, { error: 'service' }) })
  }
  return { name: 'elysium-preview-invitations',
    configureServer(server) { server.middlewares.use('/api/invites', middleware) },
    configurePreviewServer(server) { server.middlewares.use('/api/invites', middleware) } }
}
