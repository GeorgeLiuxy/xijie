export type RightsContext = { sessionId: string; accountId: string; onUnauthorized: () => void }
export type DataRequest = {
  id: string; kind: 'export' | 'delete_account'; scope?: 'interaction_data' | 'account_data'
  status: 'accepted' | 'processing' | 'completed' | 'failed'; requestedAt: string; updatedAt: string
  resultExpiresAt?: string; failureCode?: string
  financialRetention?:{status:'none'}|{status:'retained';archiveId:string;policyVersion:string;retainUntil:string}
}
export type DeletionReceipt = { accountId: string; receiptId: string; statusProof: string; key: string; createdAt: string; requestId?: string }
export type ExportIntent = { key: string; scope: 'interaction_data' | 'account_data' }
export class RightsError extends Error { constructor(readonly status: number, readonly code: string, readonly retryAfter?: number) { super(code) } }
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const receiptKey = 'xijie.data-rights.deletion.v1'
const receiptArchiveKey = 'xijie.data-rights.deletion-receipts.v1'
const receiptEvent = 'xijie:data-rights-receipt'
const exportKey = (accountId: string) => 'xijie.data-rights.export.' + accountId
export function validRequest(value: DataRequest): boolean {
  return !!value && uuid.test(value.id) && ['export', 'delete_account'].includes(value.kind)
    && ['accepted', 'processing', 'completed', 'failed'].includes(value.status)
    && Number.isFinite(Date.parse(value.requestedAt)) && Number.isFinite(Date.parse(value.updatedAt))
    && (value.financialRetention===undefined||!!value.financialRetention&&(value.financialRetention.status==='none'||value.financialRetention.status==='retained'&&uuid.test(value.financialRetention.archiveId)&&typeof value.financialRetention.policyVersion==='string'&&/^[-a-zA-Z0-9._]{1,80}$/.test(value.financialRetention.policyVersion)&&Number.isFinite(Date.parse(value.financialRetention.retainUntil))))
}
export function deletionProgressText(request:DataRequest|undefined,zh:boolean){
 if(request?.status==='completed'){
  const retention=request.financialRetention
  if(retention?.status==='retained'){const until=new Intl.DateTimeFormat(zh?'zh-CN':'en',{dateStyle:'long',timeZone:'UTC'}).format(new Date(retention.retainUntil));return zh?`此账号的私人资料已清理，现已无法登录此账号。最小交易记录将按保留规则保存至 ${until}。`:`This account’s private data has been erased and it can no longer be used to sign in. Minimal transaction records will be retained under the retention policy until ${until}.`}
  return zh?'此账号的私人资料已清理，现已无法登录此账号。':'This account’s private data has been erased and it can no longer be used to sign in.'
 }
 if(request?.status==='failed'&&request.failureCode==='FINANCIAL_RETENTION_POLICY_REQUIRED')return zh?'交易记录的保留设置尚未准备好，私人资料还未开始清理。请稍后重试。':'Transaction record retention is not ready. Private data cleanup has not started. Please retry later.'
 if(request?.status==='failed'&&request.failureCode==='FINANCIAL_RECONCILIATION_REQUIRED')return zh?'仍有交易需要完成核对，私人资料还未开始清理。请稍后重试。':'Some transactions still need to be reconciled. Private data cleanup has not started. Please retry later.'
 return zh?'注销申请收到后，所有设备都会退出这个账号。清理可能需要一点时间，你可以在这台设备继续查看进度。':'Once the deletion request is received, this account is signed out on all devices. Cleanup may take a little time. You can keep checking progress on this device.'
}
function validReceipt(value: DeletionReceipt | null): value is DeletionReceipt {
  return !!value && uuid.test(value.accountId) && uuid.test(value.receiptId) && uuid.test(value.key) && /^[A-Za-z0-9_-]{43}$/.test(value.statusProof)
    && Number.isFinite(Date.parse(value.createdAt)) && (!value.requestId || uuid.test(value.requestId))
}
function archivedReceipts(): DeletionReceipt[] {
  try {
    const list = JSON.parse(localStorage.getItem(receiptArchiveKey) ?? '[]') as DeletionReceipt[]
    return Array.isArray(list) ? list.filter(validReceipt) : []
  } catch { return [] }
}
export function readDeletionReceipt(accountId?: string): DeletionReceipt | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(receiptKey) ?? 'null') as DeletionReceipt | null
    if (validReceipt(value) && (!accountId || value.accountId === accountId)) return value
    return archivedReceipts().filter(item => !accountId || item.accountId === accountId).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
  } catch { /* A receipt only grants access to that application's progress. */ }
}
export function saveDeletionReceipt(value: DeletionReceipt) {
  // Persist before the irreversible request. If the browser cannot retain its receipt, do not submit it.
  const archive = archivedReceipts().filter(item => item.receiptId !== value.receiptId)
  localStorage.setItem(receiptArchiveKey, JSON.stringify([...archive, value]))
  localStorage.setItem(receiptKey, JSON.stringify(value))
  window.dispatchEvent(new Event(receiptEvent))
}
export function clearDeletionReceipt(receiptId: string) {
  localStorage.setItem(receiptArchiveKey, JSON.stringify(archivedReceipts().filter(item => item.receiptId !== receiptId)))
  if (readDeletionReceipt()?.receiptId === receiptId) {
    localStorage.removeItem(receiptKey)
  }
  window.dispatchEvent(new Event(receiptEvent))
}
export function observeDeletionReceipt(callback: () => void) {
  window.addEventListener(receiptEvent, callback); window.addEventListener('storage', callback)
  return () => { window.removeEventListener(receiptEvent, callback); window.removeEventListener('storage', callback) }
}
export function createDeletionReceipt(accountId: string): DeletionReceipt {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const statusProof = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return { accountId, receiptId: crypto.randomUUID(), statusProof, key: crypto.randomUUID(), createdAt: new Date().toISOString() }
}
export function readExportIntent(accountId: string): ExportIntent | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(exportKey(accountId)) ?? 'null') as ExportIntent | null
    if (value && uuid.test(value.key) && ['account_data', 'interaction_data'].includes(value.scope)) return value
  } catch { /* A live component can still retain its request identity. */ }
}
export function saveExportIntent(accountId: string, value?: ExportIntent) {
  try {
    if (value) sessionStorage.setItem(exportKey(accountId), JSON.stringify(value))
    else sessionStorage.removeItem(exportKey(accountId))
  } catch { /* The current panel also retains the original key. */ }
}

export async function rightsFetch(path: string, signal: AbortSignal, context?: RightsContext, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  if (context) headers.set('X-Xijie-Expected-Session', context.sessionId)
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { code?: string; details?: { retryAfter?: number } } } | null
    throw new RightsError(response.status, body?.error?.code ?? 'REQUEST_FAILED', body?.error?.details?.retryAfter)
  }
  return response
}
export async function rightsData<T>(path: string, signal: AbortSignal, context?: RightsContext, init?: RequestInit): Promise<T> {
  const value = await (await rightsFetch(path, signal, context, init)).json() as { data?: T }
  if (value.data == null) throw new RightsError(502, 'INVALID_RESPONSE')
  return value.data
}
export const jsonWrite = (body: unknown, key: string): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) })
export function clearPrivateOperationDrafts(accountId:string){
 if(!uuid.test(accountId))return
 const owner='account.'+accountId,prefixes=['xijie.voice-call.intent.v1.','xijie.content-report.','xijie.person-voice.intent.','xijie.person-voice.delete.','xijie.person-reminders.','xijie.memory-import.','xijie.chat.intent.','xijie.chat-photo.intent.','xijie.letter.','xijie.story.controls.','xijie.memory.intent.','xijie.memory.candidate.job.','xijie.social.intent.','xijie.gift.intent.','xijie.gift.mutation.','xijie.gift-photo.intent.','xijie.media.intent.','xijie.album.review.','xijie.album.create.','xijie.album.adopt.','xijie.album.close.','xijie.album.submit.account.','xijie.album.withdraw.account.'],singletons=['xijie.account-profile.'+accountId,'xijie.referral.create.'+accountId,exportKey(accountId),'elysium.account.v1.'+owner,'elysium.gifts.v1.'+owner]
 const revoke=(raw:string|null)=>{if(!raw)return;try{const todo:unknown[]=[JSON.parse(raw)];while(todo.length){const item=todo.pop();if(typeof item==='string'&&item.startsWith('blob:')&&typeof URL!=='undefined'&&typeof URL.revokeObjectURL==='function')URL.revokeObjectURL(item);else if(Array.isArray(item))todo.push(...item);else if(item&&typeof item==='object')todo.push(...Object.values(item))}}catch{/* Malformed private drafts are still removed by their verified account key. */}}
 for(const kind of ['localStorage','sessionStorage'] as const){try{
  const storage=window[kind],keys:string[]=[]
  for(let i=0;i<storage.length;i++){
   const key=storage.key(i);if(!key)continue
   let own=singletons.includes(key)||prefixes.some(prefix=>key.startsWith(prefix+accountId+'.'))||key.startsWith('elysium.invites.pending.')&&key.endsWith('.'+owner)
   if(key.startsWith('xijie.conversation.draft.')){try{const tuple=JSON.parse(key.slice('xijie.conversation.draft.'.length));own=Array.isArray(tuple)&&tuple[0]===owner}catch{/* Do not guess a malformed or unowned legacy key. */}}
   if(key==='elysium.giftResume.v1'||key.startsWith('xijie.album.submit.')||key.startsWith('xijie.album.withdraw.')){try{const value=JSON.parse(storage.getItem(key)??'null');own=own||!!value&&(value.owner===owner||value.accountId===accountId||value.viewer?.accountId===accountId)}catch{/* Unscoped visitor drafts belong to the visitor until proved otherwise. */}}
   if(own)keys.push(key)
  }
  for(const key of keys){revoke(storage.getItem(key));storage.removeItem(key)}
  if(storage.getItem('elysium.legacy-owner.v1')===owner){try{const old=JSON.parse(storage.getItem('elysium.v1')??'{}'),preferences=Object.fromEntries(['large','readAloud','theme','calm','haptics','sound'].filter(k=>Object.prototype.hasOwnProperty.call(old,k)).map(k=>[k,old[k]]));revoke(old.people?JSON.stringify(old.people):null);storage.setItem('elysium.v1',JSON.stringify(preferences))}catch{storage.removeItem('elysium.v1')}}
 }catch{/* A blocked browser store cannot be cleared by this page. No other account is touched. */}}
 try{if(localStorage.getItem('xijie.private-drafts-erased.'+accountId)!=='1')localStorage.setItem('xijie.private-drafts-erased.'+accountId,'1')}catch{/* Live draft cleanup still runs when browser storage is blocked. */}
 if(typeof window.dispatchEvent==='function'&&typeof CustomEvent!=='undefined')window.dispatchEvent(new CustomEvent('xijie:private-drafts-erased',{detail:{accountId}}))
}
if(typeof window!=='undefined'&&typeof window.addEventListener==='function')window.addEventListener('storage',event=>{const prefix='xijie.private-drafts-erased.';if(event.key?.startsWith(prefix)&&event.newValue==='1')clearPrivateOperationDrafts(event.key.slice(prefix.length))})
export async function receiptStatus(receipt: DeletionReceipt, signal: AbortSignal, retryKey?: string): Promise<DataRequest> {
  const path = '/v1/data-request-receipts/' + receipt.receiptId + (retryKey ? '/retry' : '')
  const value = await rightsData<DataRequest>(path, signal, undefined, retryKey
    ? { ...jsonWrite({}, retryKey), headers: { ...jsonWrite({}, retryKey).headers, 'X-Data-Request-Proof': receipt.statusProof } }
    : { headers: { 'X-Data-Request-Proof': receipt.statusProof } })
  if (!validRequest(value) || value.kind !== 'delete_account' || receipt.requestId && value.id !== receipt.requestId) throw new RightsError(502, 'INVALID_RESPONSE')
  clearPrivateOperationDrafts(receipt.accountId)
  return value
}
