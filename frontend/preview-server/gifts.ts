import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Plugin } from 'vite'
import type { GiftGoal, GoalKind } from '../src/gifts/types'
import type { WorldId } from '../src/i18n'

type Contribution = {
  actor: string
  text: string
  value: number
  part?: string
  reward?: string
  rewardOwner?: string
}
type StoredGoal = {
  id: string
  kind: GoalKind
  name: string
  world: WorldId
  message: string
  contributions: Contribution[]
}

const uuid = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i
const parts = ['门牌', '窗', '灯', '长椅', '花箱', '屋顶']
const namespace = createHash('sha256').update(resolve('.')).digest('hex').slice(0, 14)
const directory = join(tmpdir(), 'elysium-gift-goals-' + namespace)
const cookieOptions = '; Path=/api/gifts; HttpOnly; SameSite=Lax; Max-Age=2592000'

function load(id: string | undefined): StoredGoal | null {
  if (!id || !uuid.test(id)) return null
  try {
    return JSON.parse(readFileSync(join(directory, id + '.json'), 'utf8')) as StoredGoal
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function save(goal: StoredGoal) {
  mkdirSync(directory, { recursive: true })
  const filename = join(directory, goal.id + '.json')
  writeFileSync(filename + '.part', JSON.stringify(goal), { mode: 0o600 })
  renameSync(filename + '.part', filename)
}

function snapshot(goal: StoredGoal, actor: string): GiftGoal {
  const current = goal.contributions.reduce((sum, entry) => sum + entry.value, 0)
  const target = goal.kind === 'flight' ? 20 : 6
  const mine = goal.contributions.find(entry => entry.actor === actor)
  const isOwner = goal.contributions[0].actor === actor
  return {
    id: goal.id,
    kind: goal.kind,
    name: goal.name,
    world: goal.world,
    message: goal.message,
    current,
    target,
    parts: goal.contributions.flatMap(entry => entry.part ? [entry.part] : []),
    contributions: goal.contributions.map((entry, index) => ({
      seat: index,
      text: entry.text,
      value: entry.value,
      ...(entry.part ? { part: entry.part } : {}),
    })),
    isOwner,
    canHelp: !isOwner && !mine && current < target,
    helped: !!mine && !isOwner,
    rewardToken: isOwner ? null : mine?.reward ?? null,
    completed: current >= target,
  }
}

function cookie(req: IncomingMessage, key: string) {
  return req.headers.cookie?.split(';').map(value => value.trim())
    .find(value => value.startsWith(key + '='))?.slice(key.length + 1)
}

function send(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}

function sameOrigin(req: IncomingMessage) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  if (!req.headers.origin) return true
  try { return new URL(req.headers.origin).host === req.headers.host }
  catch { return false }
}

function validWorld(value: unknown): value is WorldId {
  return value === 'isles' || value === 'courtyard' || value === 'tide'
}

function validKind(value: unknown): value is GoalKind {
  return value === 'flight' || value === 'home' || value === 'album'
}

// One preview process owns the files. Slot checks, contribution creation and
// atomic replacement run synchronously after the request body is fully read.
async function handle(req: IncomingMessage, res: ServerResponse) {
  const route = (req.url ?? '').split('?')[0]
  const post = req.method === 'POST'
  if (!post && req.method !== 'GET') return send(res, 405, { error: 'method' })
  let body: Record<string, unknown> = {}
  if (post) {
    if (!sameOrigin(req)) return send(res, 403, { error: 'origin' })
    if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, { error: 'format' })
    req.setEncoding('utf8')
    let raw = ''
    for await (const chunk of req) {
      raw += chunk
      if (Buffer.byteLength(raw, 'utf8') > 4096) return send(res, 413, { error: 'size' })
    }
    try {
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('invalid')
      body = parsed
    } catch { return send(res, 400, { error: 'invalid' }) }
  }

  let actor = cookie(req, 'xj-gift-actor')
  if (!actor || !uuid.test(actor)) {
    actor = randomUUID()
    res.setHeader('Set-Cookie', 'xj-gift-actor=' + actor + cookieOptions)
  }

  if (route === '/new' && post) {
    if (typeof body.id !== 'string' || !uuid.test(body.id) || !validKind(body.kind) || !validWorld(body.world) ||
      typeof body.name !== 'string' || !body.name.trim() || body.name.length > 40 ||
      typeof body.message !== 'string' || !body.message.trim() || body.message.length > 120) {
      return send(res, 400, { error: 'invalid' })
    }
    const existing = load(body.id)
    if (existing) {
      if (existing.contributions[0].actor !== actor) return send(res, 409, { error: 'unavailable' })
      return send(res, 200, snapshot(existing, actor))
    }
    const initial: Contribution = {
      actor,
      text: body.message.trim(),
      value: body.kind === 'flight' ? 4 : 1,
      ...(body.kind === 'home' ? { part: parts[0] } : {}),
    }
    const goal: StoredGoal = {
      id: body.id,
      kind: body.kind,
      name: body.name.trim(),
      world: body.world,
      message: body.message.trim(),
      contributions: [initial],
    }
    save(goal)
    return send(res, 200, snapshot(goal, actor))
  }

  const segments = route.split('/').filter(Boolean)
  if (segments.length === 2 && segments[0] === 'reward') {
    const [id, token] = segments[1].split('.')
    const goal = uuid.test(token ?? '') ? load(id) : null
    const earned = goal?.contributions.slice(1).find(entry => entry.actor === actor && entry.reward === segments[1])
    if (!goal || !earned) return send(res, 403, { error: 'unearned' })
    if (post) {
      if (typeof body.owner !== 'string' || !/^(?:tel\.\+?\d{1,5}\.\d{6,16}|login\.[a-zA-Z0-9_-]{1,128})$/.test(body.owner))
        return send(res, 400, { error: 'owner' })
      const account = createHash('sha256').update(body.owner).digest('hex')
      if (earned.rewardOwner && earned.rewardOwner !== account) return send(res, 409, { error: 'already-claimed' })
      if (!earned.rewardOwner) { earned.rewardOwner = account; save(goal) }
    }
    return send(res, 200, { valid: true })
  }

  if (segments.length < 1 || segments.length > 2) return send(res, 404, { error: 'missing' })
  const goal = load(segments[0])
  if (!goal) return send(res, 404, { error: 'missing' })
  if (!post && segments.length === 1) return send(res, 200, snapshot(goal, actor))
  if (!post || segments[1] !== 'help') return send(res, 404, { error: 'missing' })
  const mine = goal.contributions.find(entry => entry.actor === actor)
  if (mine) {
    if (mine === goal.contributions[0]) return send(res, 403, { error: 'owner' })
    return send(res, 200, snapshot(goal, actor))
  }
  const current = snapshot(goal, actor)
  if (current.completed) return send(res, 409, { error: 'complete', goal: current })
  if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 120) return send(res, 400, { error: 'text' })
  const contribution: Contribution = {
    actor,
    text: body.text.trim(),
    value: goal.kind === 'flight' ? Math.min(2, current.target - current.current) : 1,
    reward: goal.id + '.' + randomUUID(),
    ...(goal.kind === 'home' ? { part: parts.find(part => !current.parts.includes(part)) } : {}),
  }
  goal.contributions.push(contribution)
  save(goal)
  return send(res, 200, snapshot(goal, actor))
}

export function giftService(): Plugin {
  const middleware = (req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res).catch(() => { if (!res.headersSent) send(res, 500, { error: 'service' }) })
  }
  return {
    name: 'elysium-gift-goals',
    configureServer(server) { server.middlewares.use('/api/gifts', middleware) },
    configurePreviewServer(server) { server.middlewares.use('/api/gifts', middleware) },
  }
}
