import { resonate, worldWeather, translate, echoLine, isZh, WORLD_IDS, type Age, type Lang, type WorldId } from './i18n'
import { WORLDS } from './worlds'

/* ------------------------------------------------------------------ *
 * 数据模型 · 持久化 · 迁移
 *
 * 一个账号 → 一个私人多元宇宙。每位联系人居于一个世界（WorldId）；
 * 多位联系人可以同在一个世界。不同账号的同名世界彼此独立。
 * ------------------------------------------------------------------ */

export type Memory = { id: number; title: string; body: string; source?: { kind: 'shared'; goalId: string; seat: number } }
export type Gift = string
export type Story = { id: number; title: string; text: string[]; imagined?: boolean }
export type Letter = { id: number; date: string; text: string; wantReply?: boolean; replyAt?: number; reply?: string; replyNew?: boolean }

export type Person = {
  id: number
  localId?: string
  name: string            // 你对 TA 的称呼（显示名）
  realName?: string
  relation: string
  calledMe?: string       // TA 对你的称呼
  age: Age
  avatar: string
  photos?: string[]
  accent: 'sky' | 'sun'
  hasVoice: boolean
  greeting: string
  personality: string[]
  catchphrase: string
  life: string[]
  memories: Memory[]
  unknowns: string[]
  stories: Story[]
  lastLine: string
  weather: string
  birthday?: string       // 'MM-DD'
  years?: string
  place?: string
  letters?: Letter[]
  pending?: string        // 旧版本遗留字段，仅做兼容
  world: WorldId
  keywords?: string[]
  foundAt?: number
  remind?: boolean
}

export function withPersonIdentity(person: Person): Person {
  return person.localId ? person : { ...person, localId: crypto.randomUUID() }
}

export type Msg = (
  | { id: number; kind: 'note'; text: string }
  | { id: number; kind: 'him'; text: string; time: string; canRemember?: Memory; who?: number }
  | { id: number; kind: 'me'; text: string; time: string; voice?: boolean }
  | { id: number; kind: 'photo'; time: string; src?: string }
  | { id: number; kind: 'call'; time: string; mode: 'voice' | 'video'; secs: number }
  | { id: number; kind: 'gift'; owner: string; time: string; direction: 'sent' | 'received'; giftId: string; text: string }
) & { at?: number }
export type Chats = Record<string, Msg[]>

export type User = { phone: string; dial: string; nick: string; localLoginId?: string }

export function withLocalIdentity(user: User): User {
  if (user.phone || user.localLoginId) return user
  return { ...user, localLoginId: crypto.randomUUID() }
}
export type Theme = 'auto' | 'day' | 'night'

/* --------------------- 空间：朋友圈式的诸世界动态 --------------------- */
/* 作者：联系人 id / 我 / 某个世界（世界时令） */
export type Author = number | 'me' | `world:${WorldId}`
export type PostComment = { id: number; author: Author; text: string; to?: Author; ai?: boolean; at: number }
export type Post = {
  id: number
  author: Author
  kind: 'echo' | 'status' | 'world' | 'mine'
  text: string
  quote?: string           // 记忆回响时引用的、你亲手珍藏的记忆原文
  images: string[]
  world?: WorldId
  at: number
  likes: Author[]
  comments: PostComment[]
}

let uid = 100
export const nid = () => ++uid

/* ------------------------------ persistence ---------------------------- */
export const STORE = 'elysium.v1'
export const USER_STORE = 'elysium.user.v1'
const LEGACY_OWNER_STORE = 'elysium.legacy-owner.v1'
export const accountStateKey = (owner: string) => `elysium.account.v1.${owner}`
export const accountOwner = (user: User) => user.phone ? `tel.${user.dial}.${user.phone}` : `login.${user.localLoginId}`
export type Saved = {
  people: Person[]; chats?: Chats; posts?: Post[]; nickname?: string
  large?: boolean; readAloud?: boolean; theme?: Theme; calm?: boolean; haptics?: boolean; sound?: boolean
}

export function loadUser(): User | null {
  try { const r = localStorage.getItem(USER_STORE); return r ? (JSON.parse(r) as User) : null } catch { return null }
}

export function loadState(lang: Lang, owner?: string, restoreLegacy = false): Saved | null {
  try {
    const device = JSON.parse(localStorage.getItem(STORE) || '{}') as Partial<Saved>
    let account: Partial<Saved> = {}
    if (owner) {
      const raw = localStorage.getItem(accountStateKey(owner))
      if (raw) account = JSON.parse(raw)
      else if (device.people?.length || Object.keys(device.chats ?? {}).length || device.posts?.length) {
        const claimed = localStorage.getItem(LEGACY_OWNER_STORE)
        // Only a session already present at upgrade can claim unscoped records.
        if (claimed === owner || (restoreLegacy && claimed === null)) {
          if (claimed === null) localStorage.setItem(LEGACY_OWNER_STORE, owner)
          account = device
        }
      }
    }
    const data: Saved = { ...device, nickname: account.nickname, chats: account.chats, posts: account.posts, people: (account.people ?? []).map(p => migrate(p, lang)) }
    for (const p of data.people) {
      const ids = [p.id, ...p.memories.map((m) => m.id), ...p.stories.map((s) => s.id), ...(p.letters ?? []).map((l) => l.id)]
      uid = Math.max(uid, ...ids.filter((n) => n < 1e12))
    }
    for (const list of Object.values(data.chats ?? {})) for (const m of list) if (m.id < 1e12) uid = Math.max(uid, m.id)
    for (const p of data.posts ?? []) { if (p.id < 1e12) uid = Math.max(uid, p.id); for (const c of p.comments) if (c.id < 1e12) uid = Math.max(uid, c.id) }
    return data
  } catch { return null }
}

/* 旧数据没有「世界」：依据 TA 自己的记忆内容共鸣出所在世界 */
function migrate(p: Person, lang: Lang): Person {
  const fixed: Person = { ...withPersonIdentity(p), memories: p.memories ?? [], stories: p.stories ?? [], life: p.life ?? [], personality: p.personality ?? [], unknowns: p.unknowns ?? [] }
  if (!fixed.world) {
    const text = [fixed.life.join('\n'), fixed.memories.map((m) => `${m.title} ${m.body}`).join('\n'), fixed.stories.map((s) => s.text.join(' ')).join('\n')].join('\n')
    const r = resonate(text)
    fixed.world = r.world
    fixed.keywords = fixed.keywords ?? r.keywords
    fixed.weather = worldWeather(lang, r.world)
  }
  if (!fixed.photos && fixed.avatar) fixed.photos = [fixed.avatar]
  return fixed
}

export const isNight = (theme: Theme) => {
  if (theme === 'night') return true
  if (theme === 'day') return false
  const h = new Date().getHours(); return h < 6 || h >= 19
}

/* ------------------------------- helpers ------------------------------- */
export const lastPreview = (msgs?: Msg[]): string | null => {
  if (!msgs?.length) return null
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m.kind === 'him' || m.kind === 'me') return m.text
    if (m.kind === 'photo' || m.kind === 'call') return null
  }
  return null
}
export const lastTime = (msgs?: Msg[]): string | null => {
  if (!msgs?.length) return null
  for (let i = msgs.length - 1; i >= 0; i--) { const m = msgs[i]; if (m.kind !== 'note') return m.time }
  return null
}
/* 用于排序：最近一次互动 */
export function lastActivity(p: Person, chats: Chats): number {
  const msgs = chats[String(p.id)]
  const last = msgs?.length ? msgs[msgs.length - 1].id : 0
  return Math.max(last, p.foundAt ? p.foundAt / 1e9 : 0, p.id / 1e6)
}

/* 六类坐标是否齐备：称呼 · 面容 · 声音 · 故事 · 时光 · 地点 */
export function clarity(p: Person): boolean[] {
  return [
    true,
    !!(p.photos?.length || p.avatar),
    p.hasVoice,
    p.memories.length + p.life.length + p.stories.length > 0 || !!p.keywords?.length,
    !!(p.birthday || p.years),
    !!p.place,
  ]
}

/* 人物页头部头像的位置（寻找 → 建立连接时，透镜落在这里） */
export const HEADER_AVATAR = { x: 79, y: 70, size: 34 }

/* 信件「慢递」：下一个早上 8:00 */
export function nextMorning(now = new Date()): number {
  const d = new Date(now)
  if (d.getHours() >= 8) d.setDate(d.getDate() + 1)
  d.setHours(8, 0, 0, 0)
  return d.getTime()
}
export const isTomorrow = (ts: number) => new Date(ts).toDateString() !== new Date().toDateString()

/* ------------------------- 空间：记忆回响的生成 ------------------------- */
/* 回响只引用用户珍藏的记忆与口头禅，并明确标注由 AI 生成 */
export function echoesFor(p: Person, lang: Lang, fresh = false, now = Date.now()): Post[] {
  const gap = (h: number) => (fresh ? h * 60e3 : h * 3600e3)
  const pics = [...new Set([...(p.photos ?? []).filter((s) => s !== p.avatar), WORLDS[p.world].img])]
  const res: Post[] = []
  p.memories.slice(0, 2).forEach((m, i) => res.push({
    id: nid(), author: p.id, kind: 'echo', text: echoLine(lang, p.id + i), quote: m.body,
    images: i === 0 ? [pics[0]] : [], world: p.world, at: now - gap(1 + i * 5), likes: [], comments: [],
  }))
  if (p.catchphrase) res.push({ id: nid(), author: p.id, kind: 'status', text: p.catchphrase, images: [], world: p.world, at: now - gap(9), likes: [], comments: [] })
  if (!res.length) res.push({ id: nid(), author: p.id, kind: 'echo', text: echoLine(lang, p.id), quote: p.greeting, images: [WORLDS[p.world].img], world: p.world, at: now - gap(1), likes: [], comments: [] })
  return res
}
export function echoForMemory(p: Person, m: Memory, lang: Lang): Post {
  return { id: nid(), author: p.id, kind: 'echo', text: echoLine(lang, m.title.length + p.id), quote: m.body, images: [], world: p.world, at: Date.now(), likes: [], comments: [] }
}
/* 补齐：每个已连接的世界一条「世界时令」，每位联系人至少一组回响 */
export function seedPosts(posts: Post[], people: Person[], lang: Lang): Post[] {
  const out = [...posts]; let changed = false
  const now = Date.now()
  WORLD_IDS.forEach((w, i) => {
    const author = `world:${w}` as const
    if (!people.some((p) => p.world === w) || out.some((x) => x.author === author)) return
    out.push({ id: nid(), author, kind: 'world', text: `${translate(lang, `world.${w}.law`)}${isZh(lang) ? '。' : '. '}${translate(lang, `world.${w}.lore`)}`, images: [WORLDS[w].img], world: w, at: now - (26 + i * 7) * 3600e3, likes: [], comments: [] })
    changed = true
  })
  for (const p of people) {
    if (out.some((x) => x.author === p.id)) continue
    out.push(...echoesFor(p, lang)); changed = true
  }
  return changed ? out : posts
}

/* 文件 → 压缩后的 dataURL（照片在本机保存为小图） */
export function fileToDataUrl(file: File, max = 480): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('image'))
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height))
        const c = document.createElement('canvas')
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s)
        c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height)
        resolve(c.toDataURL('image/jpeg', 0.82))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}
