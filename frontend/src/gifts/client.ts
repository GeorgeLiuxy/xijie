import type { GiftGoal } from './types'
import { applyGiftReward, getGiftState } from './store'

export class GoalError extends Error {
  constructor(public code:string,public goal?:GiftGoal){super(code)}
}
async function request<T>(path:string,body?:object):Promise<T>{
  const response=await fetch(path,{
    method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',
    ...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),
  })
  if(!response.headers.get('Content-Type')?.includes('application/json'))throw new GoalError('offline')
  const value=await response.json()
  if(!response.ok)throw new GoalError(value.error||'service',value.goal)
  return value as T
}
export const goalRequest = <T>(path: string, body?: object) => request<T>('/api/gifts/' + path, body)
export const getGiftGoal=(id:string)=>goalRequest<GiftGoal>(encodeURIComponent(id))
export const goalUrl=(id:string)=>new URL(import.meta.env.BASE_URL+'gifts/'+encodeURIComponent(id),location.origin).href

export async function claimGoalReward(owner: string, token: string) {
  await goalRequest('reward/' + encodeURIComponent(token), { owner })
  await applyGiftReward(owner, token)
}

export type InviteStatus = {
  inviteId: string | null
  publicName: string
  rewards: string[]
  friends: { joinedAt: number; memoryAt: number | null }[]
}
const inviteRequest = <T>(path: string, body?: object) => request<T>('/api/invites/' + path, body)
let visitorSession: Promise<unknown> | undefined
const logins = new Map<string, Promise<void>>()
const pendingMemories = new Set<string>()
const pendingKey = (owner: string, event: string) => 'elysium.invites.pending.' + event + '.' + owner
function pending(owner: string, event: string): string {
  try { return localStorage.getItem(pendingKey(owner, event)) ?? '' } catch { return '' }
}
function setPending(owner: string, event: string, value: string) {
  try {
    if (value) localStorage.setItem(pendingKey(owner, event), value)
    else localStorage.removeItem(pendingKey(owner, event))
  } catch { /* The current request can still finish with storage disabled. */ }
}

export function recordPreviewLogin(owner: string, inviteId?: string, existing = false): Promise<void> {
  const firstInvite = pending(owner, 'signup') || (!existing ? inviteId : '')
  if (firstInvite) setPending(owner, 'signup', firstInvite)
  // Establish the HttpOnly browser cookie before two overlapping mount effects register.
  visitorSession ??= inviteRequest('session').catch(error => { visitorSession = undefined; throw error })
  const login = visitorSession.then(() => inviteRequest<void>('login', {
    owner, inviteId: firstInvite || inviteId, existing: firstInvite ? false : existing,
  })).then(() => setPending(owner, 'signup', ''))
  logins.set(owner, login)
  const clear = () => { if (logins.get(owner) === login) logins.delete(owner) }
  void login.then(clear, clear)
  return login
}
export async function recordPreviewMemory(owner: string): Promise<void> {
  pendingMemories.add(owner)
  setPending(owner, 'memory', '1')
  await logins.get(owner)
  await inviteRequest('memory', { owner })
  pendingMemories.delete(owner)
  setPending(owner, 'memory', '')
}
export async function inviteStatus(owner: string, publicName?: string): Promise<InviteStatus> {
  await logins.get(owner)
  const read = () => inviteRequest<InviteStatus>(publicName === undefined ? 'status' : 'create', { owner, publicName })
  try { return await read() }
  catch (error) {
    if (!(error instanceof GoalError) || error.code !== 'login-required') throw error
    await recordPreviewLogin(owner, undefined, true)
    return read()
  }
}
export async function syncInviteRewards(owner: string, known?: InviteStatus): Promise<void> {
  if (pendingMemories.has(owner) || pending(owner, 'memory')) {
    await recordPreviewMemory(owner)
    known = undefined
  }
  const status = known ?? await inviteStatus(owner)
  for (const token of status.rewards) {
    if (!getGiftState(owner).usedRewards.includes(token)) await applyGiftReward(owner, token)
  }
}
export const inviteUrl = (id: string) => new URL(import.meta.env.BASE_URL + 'invite/' + encodeURIComponent(id), location.origin).href
export const getPublicInvite = (id: string) => inviteRequest<{valid: true; publicName: string}>('public/' + encodeURIComponent(id))
