import { useEffect, useRef, useState } from 'react'
import { isZh, useI18n } from '../i18n'
import { ContextSheet } from '../mobile/ContextSheet'
import { I } from '../ui'
import { downloadDataExport, type ExportDownload } from './downloadDataExport'
import { passwordFailure, type AccountAuthenticationControls, type AuthenticationMethods, type SocialProvider } from './password'
import {
  RightsError, clearDeletionReceipt, createDeletionReceipt, jsonWrite, readDeletionReceipt, readExportIntent,
  receiptStatus, rightsData, saveDeletionReceipt, saveExportIntent, uuid, validRequest,deletionProgressText,clearPrivateOperationDrafts,
  type DataRequest, type DeletionReceipt, type ExportIntent, type RightsContext,
} from './dataRightsClient'

const requestPath = '/v1/accounts/me/data-requests'
type VerificationField = 'dial' | 'phone' | 'code'
const statusText = (status: DataRequest['status'], zh: boolean) => ({
  accepted: zh ? '申请已受理' : 'Request accepted', processing: zh ? '正在处理' : 'Processing',
  completed: zh ? '已完成' : 'Completed', failed: zh ? '暂未完成' : 'Not completed',
})[status]

export function DataRights({ context, mode, authentication }: { context: RightsContext; mode: 'export' | 'delete'; authentication?: AccountAuthenticationControls }) {
  const { lang } = useI18n(), zh = isZh(lang)
  const [request, setRequest] = useState<DataRequest>()
  const [scope, setScope] = useState<ExportIntent['scope']>('account_data')
  const [step, setStep] = useState<'main' | 'phone' | 'code' | 'reauth'>('main')
  const [methods,setMethods]=useState<AuthenticationMethods>(),[methodsError,setMethodsError]=useState(''),[methodsLoading,setMethodsLoading]=useState(false),[methodsRetry,setMethodsRetry]=useState(0)
  const firstReauth=useRef(authentication?.completed??0)
  const [phone, setPhone] = useState(''), [dial, setDial] = useState('+86'), [code, setCode] = useState('')
  const [challenge, setChallenge] = useState<{ id: string; expiresAt: string; resendAt: string }>()
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(mode === 'export')
  const [message, setMessage] = useState(''), [stale, setStale] = useState(false)
  const [fieldError, setFieldError] = useState<{ field: VerificationField; text: string }>()
  const [exportIntent, setExportIntent] = useState(() => readExportIntent(context.accountId))
  const [receipt, setReceipt] = useState(() => {
    return readDeletionReceipt(context.accountId)
  })
  const [receiptKnown, setReceiptKnown] = useState(() => !!readDeletionReceipt(context.accountId))
  const lifetime = useRef<AbortController | null>(null), operating = useRef(false)
  const callbacks = useRef(context); callbacks.current = context
  const session = useRef(context.sessionId); session.current = context.sessionId
  const smsIntent = useRef<{ signature: string; key: string } | undefined>(undefined)
  const verifyIntent = useRef<{ signature: string; key: string } | undefined>(undefined)
  const retryKeys = useRef(new Map<string, string>())
  const heading = useRef<HTMLHeadingElement>(null)
  const live = (signal: AbortSignal) => !signal.aborted && session.current === context.sessionId
  useEffect(()=>{
    if(step!=='reauth'||!authentication)return
    const controller=new AbortController();setMethodsLoading(true);setMethodsError('')
    void authentication.service.authentication(controller.signal).then(value=>{if(!controller.signal.aborted)setMethods(value)}).catch(error=>{if(!controller.signal.aborted)setMethodsError(passwordFailure(error,zh))}).finally(()=>{if(!controller.signal.aborted)setMethodsLoading(false)})
    return()=>controller.abort()
  },[step,context.accountId,context.sessionId,methodsRetry])
  useEffect(()=>{if(authentication&&authentication.completed!==firstReauth.current){firstReauth.current=authentication.completed;if(step==='reauth'){setStep('main');setConfirmed(false);setMessage(zh?'当前账号已验证，请确认后继续。':'The current account is verified. Confirm to continue.')}}},[authentication?.completed])

  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller
    if (mode === 'export') void readLatest(controller.signal)
    return () => controller.abort()
  }, [context.sessionId, context.accountId, mode])
  useEffect(() => {
    if (!request || !['accepted', 'processing'].includes(request.status)) return
    const controller = lifetime.current
    if (!controller) return
    let reading = false
    const refresh = () => {
      if (reading || operating.current || document.visibilityState === 'hidden' || controller.signal.aborted) return
      reading = true
      void rightsData<DataRequest>(requestPath + '/' + request.id, controller.signal, context).then(next => {
        if (!validRequest(next) || next.id !== request.id) throw new RightsError(502, 'INVALID_RESPONSE')
        if (live(controller.signal)) setRequest(next)
      }).catch(error => { if (live(controller.signal) && error instanceof RightsError && error.status === 401) callbacks.current.onUnauthorized() }).finally(() => { reading = false })
    }
    const timer = window.setInterval(refresh, 1500); window.addEventListener('focus', refresh)
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [request?.id, request?.status, context.sessionId])
  useEffect(() => { if (step !== 'main') heading.current?.scrollIntoView({ block: 'nearest' }) }, [step])

  async function readLatest(signal: AbortSignal) {
    try {
      const list = await rightsData<DataRequest[]>(requestPath + '?limit=10', signal, context)
      if (!Array.isArray(list) || list.some(item => !validRequest(item))) throw new RightsError(502, 'INVALID_RESPONSE')
      if (live(signal)) setRequest(list.find(item => item.kind === 'export'))
    } catch (error) { if (live(signal)) explain(error) }
    finally { if (live(signal)) setLoading(false) }
  }
  function explain(error: unknown) {
    if (error instanceof RightsError && error.code === 'REAUTHENTICATION_REQUIRED') {
      setStep(authentication?'reauth':'phone'); setMessage(zh ? '为保护你的资料，请先验证当前账号，再继续。原选择已保留。' : 'To protect your data, verify the current account to continue. Your selection is kept.')
    } else if (step === 'code' && error instanceof RightsError && error.code === 'AUTH_CHALLENGE_EXPIRED') {
      requestNewCode()
    } else if (error instanceof RightsError && error.code === 'EXPORT_WEBVIEW_OUTDATED') {
      setMessage(zh ? '手机的网页组件版本较旧，暂时无法保存资料文件。请在应用商店更新 Android System WebView 或 Chrome，重新打开西界后再试。' : 'Your phone’s WebView is too old to save this file. Update Android System WebView or Chrome in your app store, reopen Xijie and try again.')
    } else if (error instanceof RightsError && error.status === 401) {
      callbacks.current.onUnauthorized(); setMessage(zh ? '登录已失效，请重新登录后继续。' : 'Your session expired. Sign in again to continue.')
    } else if (error instanceof RightsError && error.code === 'EXPORT_STALE') {
      setStale(true); setMessage(zh ? '资料已发生变化，请重新准备资料副本。' : 'Your data changed. Prepare a new copy.')
    } else if (error instanceof RightsError && error.code === 'EXPORT_EXPIRED') {
      setStale(true); setMessage(zh ? '这份资料文件已过期，请点击「重新准备一份副本」。' : 'This file expired. Select Prepare a new copy.')
    } else if (error instanceof RightsError && error.status === 429) {
      setMessage(zh ? '操作较频繁，请稍后再试。' : 'Too many attempts. Try again shortly.')
    } else if (error instanceof RightsError && error.code === 'EXPORT_CANCELLED') {
      setMessage(zh ? '已取消保存导出文件。' : 'Saving the export was cancelled.')
    } else if (error instanceof RightsError && ['NATIVE_EXPORT_UNAVAILABLE', 'UNIMPLEMENTED', 'UNAVAILABLE'].includes(error.code)) {
      setMessage(zh ? '当前应用暂时无法保存导出文件，请更新应用后重试。' : 'This app cannot save the export. Update the app and try again.')
    } else setMessage(zh ? '这次操作还没能完成，原选择已保留，请重试。' : 'This action could not be completed. Your selection is kept; please retry.')
  }
  async function run(work: (signal: AbortSignal) => Promise<void>) {
    const signal = lifetime.current?.signal
    if (!signal || signal.aborted || operating.current) return
    operating.current = true; setBusy(true); setMessage('')
    try { await work(signal) } catch (error) { if (live(signal)) explain(error) }
    finally { operating.current = false; if (live(signal)) setBusy(false) }
  }
  function keyFor(action: string) {
    let key = retryKeys.current.get(action)
    if (!key) { key = crypto.randomUUID(); retryKeys.current.set(action, key) }
    return key
  }
  async function startExport() {
    await run(async signal => {
      const intent = exportIntent ?? { key: crypto.randomUUID(), scope }
      setExportIntent(intent); saveExportIntent(context.accountId, intent)
      const value = await rightsData<DataRequest>(requestPath, signal, context, jsonWrite({ kind: 'export', scope: intent.scope }, intent.key))
      if (!validRequest(value) || value.kind !== 'export') throw new RightsError(502, 'INVALID_RESPONSE')
      if (!live(signal)) return
      saveExportIntent(context.accountId); setExportIntent(undefined); setRequest(value); setStale(false)
    })
  }
  async function download() {
    if (!request) return
    await run(async signal => {
      const grantKey = 'download:' + request.id
      let value: { downloadUrl: string; expiresAt: string }, result: ExportDownload
      try {
        value = await rightsData<{ downloadUrl: string; expiresAt: string }>(requestPath + '/' + request.id + '/download', signal, context, jsonWrite({}, keyFor(grantKey)))
        const expected = requestPath + '/' + request.id + '/content?grant='
        if (!value || !value.downloadUrl.startsWith(expected) || !uuid.test(value.downloadUrl.slice(expected.length)) || !Number.isFinite(Date.parse(value.expiresAt))) throw new RightsError(502, 'INVALID_RESPONSE')
        result = await downloadDataExport(request.id, value.downloadUrl, context, signal)
      } catch (error) {
        if (live(signal) && error instanceof RightsError && error.code === 'DOWNLOAD_GRANT_EXPIRED') {
          retryKeys.current.delete(grantKey)
          setMessage(zh ? '下载链接已过期，请再次点击下载获取新链接。' : 'The download link expired. Click download again for a new link.')
          return
        }
        throw error
      }
      if (!live(signal)) return
      retryKeys.current.delete('download:' + request.id)
      setMessage(result.kind === 'saved' ? zh ? '导出文件已保存。' : 'The export file is saved.' : zh ? '导出文件已交给浏览器下载。' : 'The export was sent to your browser for download.')
    })
  }
  async function retryExport() {
    if (!request) return
    await run(async signal => {
      const value = await rightsData<DataRequest>(requestPath + '/' + request.id + '/retry', signal, context, jsonWrite({}, keyFor('retry:' + request.id)))
      if (!validRequest(value) || value.id !== request.id) throw new RightsError(502, 'INVALID_RESPONSE')
      if (live(signal)) { setRequest(value); retryKeys.current.delete('retry:' + request.id) }
    })
  }
  async function sendCode() {
    await run(async signal => {
      if (!/^\+[1-9]\d{0,3}$/.test(dial)) {
        setFieldError({ field: 'dial', text: zh ? '请输入有效的国家或地区代码。' : 'Enter a valid country calling code.' })
        return
      }
      if (!/^\d{6,14}$/.test(phone) || !/^\+[1-9]\d{6,14}$/.test(dial + phone)) {
        setFieldError({ field: 'phone', text: zh ? '请检查手机号位数。' : 'Check the number of digits in your phone number.' })
        return
      }
      setFieldError(undefined)
      const signature = dial + phone
      if (smsIntent.current?.signature !== signature) smsIntent.current = { signature, key: crypto.randomUUID() }
      const value = await rightsData<typeof challenge>('/v1/auth/sms-challenges', signal, context, jsonWrite({ dial, phone, purpose: 'reauthenticate' }, smsIntent.current.key))
      if (!value || !uuid.test(value.id) || !Number.isFinite(Date.parse(value.expiresAt)) || !Number.isFinite(Date.parse(value.resendAt))) throw new RightsError(502, 'INVALID_RESPONSE')
      if (live(signal)) { setChallenge(value); setCode(''); setStep('code'); smsIntent.current = undefined }
    })
  }
  async function socialReauth(provider:SocialProvider){
    if(!authentication||!methods?.reauthenticationMethods.social.includes(provider)||!authentication.providers[provider])return
    await run(async signal=>{
      try{sessionStorage.setItem('xijie.identity.rights-return',JSON.stringify({accountId:context.accountId,sessionId:context.sessionId,mode}))}catch{/* The original panel stays available when storage is blocked. */}
      await authentication.reauthenticate(provider,signal)
      if(live(signal))setMessage(zh?'请完成原登录方式的验证，回来后继续。':'Complete verification with your original sign-in method, then return to continue.')
    })
  }
  async function verifyCode() {
    if (!challenge || !/^\d{6}$/.test(code)) return
    await run(async signal => {
      setFieldError(undefined)
      const signature = challenge.id + ':' + code
      if (verifyIntent.current?.signature !== signature) verifyIntent.current = { signature, key: crypto.randomUUID() }
      const value = await rightsData<{ status: string; sessionId?: string; reauthenticatedAt?: string }>('/v1/auth/sms-challenges/' + challenge.id + '/verify', signal, context, jsonWrite({ code }, verifyIntent.current.key))
      if (!live(signal)) return
      if (value.status === 'incorrect') {
        setFieldError({ field: 'code', text: zh ? '验证码不正确，请重新填写。' : 'The verification code is incorrect. Please try again.' })
        return
      }
      if (value.status === 'expired') { requestNewCode(); return }
      if (value.status !== 'reauthenticated' || value.sessionId !== context.sessionId || !value.reauthenticatedAt || !Number.isFinite(Date.parse(value.reauthenticatedAt))) throw new RightsError(502, 'INVALID_RESPONSE')
      setStep('main'); setCode(''); setConfirmed(false); setMessage(zh ? '当前账号已验证，请确认后继续。' : 'The current account is verified. Confirm to continue.')
    })
  }
  function requestNewCode() {
    setChallenge(undefined)
    setCode('')
    setStep('phone')
    setMessage(zh ? '验证码已过期，请重新获取。' : 'The code expired. Request a new one.')
  }
  function clearFieldError(field: VerificationField) {
    if (fieldError?.field === field) setFieldError(undefined)
  }
  function fieldAttributes(field: VerificationField) {
    const id = `data-rights-${mode}-${field}`
    const invalid = fieldError?.field === field
    return {
      id,
      'aria-invalid': invalid || undefined,
      'aria-describedby': invalid ? `${id}-error` : undefined,
      className: invalid ? 'border-[var(--auth-danger,#913d38)]! [.night_&]:border-[var(--auth-danger,#ffb2a9)]!' : undefined,
    }
  }
  function fieldMessage(field: VerificationField) {
    if (fieldError?.field !== field) return null
    return <span id={`data-rights-${mode}-${field}-error`} role="alert" className="text-xs leading-relaxed text-[var(--auth-danger,#913d38)] [.night_&]:text-[var(--auth-danger,#ffb2a9)]">{fieldError.text}</span>
  }
  async function checkDeletion(value: DeletionReceipt) {
    await run(async signal => {
      const status = await receiptStatus(value, signal)
      if (!live(signal)) return
      saveDeletionReceipt({ ...value, requestId: status.id }); setReceipt({ ...value, requestId: status.id }); callbacks.current.onUnauthorized()
    })
  }
  async function deleteAccount() {
    if (!confirmed) return
    await run(async signal => {
      const value = receipt ?? createDeletionReceipt(context.accountId)
      saveDeletionReceipt(value); setReceipt(value)
      setReceiptKnown(true)
      try {
        const status = await rightsData<DataRequest>(requestPath, signal, context, jsonWrite({ kind: 'delete_account', scope: 'account_data', deletionReceiptId: value.receiptId, statusProof: value.statusProof }, value.key))
        if (!validRequest(status) || status.kind !== 'delete_account') throw new RightsError(502, 'INVALID_RESPONSE')
        if (!live(signal)) return
        saveDeletionReceipt({ ...value, requestId: status.id })
        clearPrivateOperationDrafts(context.accountId)
        if (live(signal)) callbacks.current.onUnauthorized()
      } catch (error) {
        if (!live(signal)) return
        if (error instanceof RightsError && error.code === 'REAUTHENTICATION_REQUIRED') {
          // The server definitively rejected this unauthenticated action; keep its original identity for an explicit retry.
          clearDeletionReceipt(value.receiptId)
          setReceiptKnown(false)
          explain(error); return
        }
        try {
          const status = await receiptStatus(value, signal)
          if (!live(signal)) return
          saveDeletionReceipt({ ...value, requestId: status.id }); callbacks.current.onUnauthorized(); return
        } catch { /* A missing acknowledgement cannot prove that deletion was not accepted. */ }
        throw error
      }
    })
  }

  if(step==='reauth'&&authentication)return <section className="me-rights" aria-busy={busy||methodsLoading}>
    <h3 ref={heading}>{zh?'验证当前账号':'Verify current account'}</h3>
    <p>{zh?'使用这个账号已绑定的登录方式确认是你本人。':'Confirm it is you using a sign-in method linked to this account.'}</p>
    {methodsLoading?<p role="status">{zh?'正在读取登录方式…':'Loading sign-in methods…'}</p>:<>
      {methods?.reauthenticationMethods.sms&&<button className="me-primary btn-dark" disabled={busy} onClick={()=>setStep('phone')}>{zh?'使用手机号验证码':'Use a phone verification code'}</button>}
      {methods?.reauthenticationMethods.social.map(provider=><button key={provider} className="me-primary btn-dark" disabled={busy||!authentication.providers[provider]} onClick={()=>void socialReauth(provider)}>{zh?`使用 ${provider==='wechat'?'微信':provider==='apple'?'Apple': 'Google'} 验证`:`Verify with ${provider==='wechat'?'WeChat':provider==='apple'?'Apple':'Google'}`}{!authentication.providers[provider]?(zh?' · 暂未开通':' · Not available'):''}</button>)}
      {methods&&!methods.reauthenticationMethods.sms&&!methods.reauthenticationMethods.social.length&&<p>{zh?'当前账号暂无可用的重新验证方式，请稍后重试。':'No verification method is available for this account right now. Try again later.'}</p>}
    </>}
    {methodsError&&<><p role="status">{methodsError}</p><button className="me-secondary btn-ghost" onClick={()=>setMethodsRetry(value=>value+1)}>{zh?'重新读取':'Try again'}</button></>}
    {message&&<p role="status">{message}</p>}
    <button className="me-secondary btn-ghost" disabled={busy} onClick={()=>setStep('main')}>{zh?'返回':'Back'}</button>
  </section>
  if (step !== 'main') return <section className="me-rights" aria-busy={busy}>
    <h3 ref={heading}>{zh ? '验证手机号' : 'Verify your phone number'}</h3>
    <p>{zh ? '请用当前账号的手机号接收验证码，确认是你本人在操作。' : 'Receive a code on this account’s phone number to confirm it is you.'}</p>
    <form className="me-account-form" onSubmit={event => { event.preventDefault(); void (step === 'phone' ? sendCode() : verifyCode()) }}>
      {step === 'phone' ? <>
        <div className="me-field">
          <label htmlFor={`data-rights-${mode}-dial`}>{zh ? '国家或地区代码' : 'Country calling code'}</label>
          <input {...fieldAttributes('dial')} value={dial} onChange={event => { setDial(event.currentTarget.value); clearFieldError('dial') }} inputMode="tel" autoComplete="tel-country-code" disabled={busy} />
          {fieldMessage('dial')}
        </div>
        <div className="me-field">
          <label htmlFor={`data-rights-${mode}-phone`}>{zh ? '当前账号手机号' : 'Current account phone number'}</label>
          <input {...fieldAttributes('phone')} value={phone} onChange={event => { setPhone(event.currentTarget.value.replace(/\D/g, '')); clearFieldError('phone') }} inputMode="tel" autoComplete="tel-national" maxLength={14} disabled={busy} />
          {fieldMessage('phone')}
        </div>
      </> : <div className="me-field">
        <label htmlFor={`data-rights-${mode}-code`}>{zh ? '输入验证码' : 'Verification code'}</label>
        <input {...fieldAttributes('code')} value={code} onChange={event => { setCode(event.currentTarget.value.replace(/\D/g, '').slice(0, 6)); clearFieldError('code') }} inputMode="numeric" autoComplete="one-time-code" maxLength={6} disabled={busy} />
        {fieldMessage('code')}
      </div>}
      <button className="me-primary btn-dark" type="submit" disabled={busy || step === 'phone' && !phone || step === 'code' && code.length !== 6}>
        {busy ? zh ? '正在验证…' : 'Verifying…' : step === 'phone' ? zh ? '获取验证码' : 'Get verification code' : zh ? '验证手机号' : 'Verify phone number'}
      </button>
      <button type="button" className="me-secondary btn-ghost" disabled={busy} onClick={() => { setStep('main'); setCode(''); setFieldError(undefined) }}>{zh ? '返回' : 'Back'}</button>
      {step === 'code' && <button type="button" className="me-secondary btn-ghost" disabled={busy} onClick={() => { setStep('phone'); setCode(''); setFieldError(undefined) }}>{zh ? '更改号码或重新获取' : 'Change number or request a new code'}</button>}
    </form>
    {message && <p role="status">{message}</p>}
  </section>

  return <section className="me-rights" aria-label={mode === 'export' ? zh ? '下载我的资料' : 'Download my data' : zh ? '注销账号' : 'Delete account'} aria-busy={busy || loading}>
    {mode === 'export' ? <>
      <p>{zh ? '将现有资料整理成一份文件保存，包含文字和已保存的照片、声音等附件。下载不会删除账号里的内容。' : 'Save a file containing your available text, saved photos, voice samples and other data. Downloading does not delete anything from your account.'}</p>
      <label className="me-field"><span>{zh ? '要保存哪些资料' : 'What to include'}</span><select disabled={busy || !!exportIntent} value={exportIntent?.scope ?? scope} onChange={event => setScope(event.currentTarget.value as ExportIntent['scope'])}>
        <option value="account_data">{zh ? '账号资料、人物、对话、珍藏与动态' : 'Account details, characters, chats, treasured memories and posts'}</option>
        <option value="interaction_data">{zh ? '人物、对话、珍藏与动态' : 'Characters, chats, treasured memories and posts'}</option>
      </select></label>
      {loading && <p role="status">{zh ? '正在读取申请…' : 'Loading requests…'}</p>}
      {request && <div className="me-rights-progress" role="status">
        <p>{statusText(request.status, zh)}</p>
        <small>{new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(request.requestedAt))}</small>
        {request.resultExpiresAt && Number.isFinite(Date.parse(request.resultExpiresAt)) && <small>{zh ? '下载有效至：' : 'Download available until: '}{new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(request.resultExpiresAt))}</small>}
        {request.status === 'completed' && <button className="me-primary btn-dark" disabled={busy || stale} onClick={() => void download()}>{zh ? '下载资料文件' : 'Download data file'}</button>}
        {request.status === 'failed' && <button className="me-secondary btn-ghost" disabled={busy} onClick={() => void retryExport()}>{zh ? '重新准备资料' : 'Prepare the file again'}</button>}
      </div>}
      <button className="me-secondary btn-ghost" disabled={busy || loading || !!request && ['accepted', 'processing'].includes(request.status)} onClick={() => void startExport()}>
        {busy ? zh ? '正在提交…' : 'Submitting…' : exportIntent ? zh ? '继续准备资料' : 'Continue preparing the file' : request ? zh ? '重新准备一份副本' : 'Prepare a new copy' : zh ? '准备资料副本' : 'Prepare data copy'}
      </button>
    </> : <>
      <h3>{zh ? '注销当前账号' : 'Delete the current account'}</h3>
      <p>{zh ? '受理后将立即退出所有设备，并开始清除这个账号的人物、对话、珍藏和私人动态。这个操作无法撤销。' : 'Once accepted, all devices lose access and this account’s characters, chats, treasured memories and private posts are erased. This cannot be undone.'}</p>
      <p>{zh ? '如需保留副本，请先到「隐私与 AI 说明」导出数据。' : 'To keep a copy, export your data from Privacy & AI first.'}</p>
      <label className="me-ai-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.currentTarget.checked)} /><span>{zh ? '我了解注销影响，确认删除当前账号' : 'I understand and confirm deletion of the current account'}</span></label>
      <button className="me-secondary me-destructive" disabled={busy || !confirmed} onClick={() => void deleteAccount()}>{busy ? zh ? '正在提交…' : 'Submitting…' : zh ? '确认注销账号' : 'Confirm account deletion'}</button>
      {receipt && receiptKnown && <button className="me-secondary btn-ghost" disabled={busy} onClick={() => void checkDeletion(receipt)}>{zh ? '查看上次注销进度' : 'View previous deletion progress'}</button>}
    </>}
    {message && <p role="status">{message}</p>}
  </section>
}

export function DeletionProgress({ receipt, onClose }: { receipt: DeletionReceipt; onClose: () => void }) {
  const { lang } = useI18n(), zh = isZh(lang)
  const [request, setRequest] = useState<DataRequest>(), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const controller = useRef<AbortController | null>(null), retryKey = useRef<string | undefined>(undefined)
  useEffect(() => {
    const active = new AbortController(); controller.current = active; let reading = false, finished = false
    const read = async () => {
      if (reading || finished || active.signal.aborted || document.visibilityState === 'hidden') return
      reading = true
      try {
        const next = await receiptStatus(receipt, active.signal)
        if (!active.signal.aborted) { setRequest(next); setMessage(''); finished = next.status === 'completed' }
      } catch (error) {
        if (!active.signal.aborted) setMessage(error instanceof RightsError && error.status === 404
          ? zh ? '暂时查不到这次注销申请，请稍后再查看。' : 'This deletion request cannot be found yet. Please check again shortly.'
          : zh ? '暂时无法查看进度。进度记录仍保留在这台设备上，请稍后再试。' : 'Progress is unavailable right now. The record is kept on this device; please try again later.')
      } finally { reading = false }
    }
    void read(); const timer = window.setInterval(() => void read(), 3000)
    return () => { active.abort(); clearInterval(timer) }
  }, [receipt.receiptId, receipt.statusProof, lang])
  async function retry() {
    const signal = controller.current?.signal
    if (!signal || signal.aborted || busy) return
    retryKey.current ??= crypto.randomUUID(); setBusy(true)
    try { const next = await receiptStatus(receipt, signal, retryKey.current); if (!signal.aborted) { setRequest(next); retryKey.current = undefined; setMessage('') } }
    catch { if (!signal.aborted) setMessage(zh ? '暂时无法确认清理是否继续，请稍后再次点击「继续清理」。' : 'We could not confirm whether cleanup resumed. Select Resume cleanup again shortly.') }
    finally { if (!signal.aborted) setBusy(false) }
  }
  const title = zh ? '账号注销进度' : 'Account deletion progress'
  const close = () => { if (request?.status === 'completed') clearDeletionReceipt(receipt.receiptId); onClose() }
  return <ContextSheet label={title} onClose={close} className="me-settings-sheet">
    <header className="me-panel-heading"><h2>{title}</h2><button data-context-close onClick={close} aria-label={zh ? '关闭' : 'Close'}><I.X /></button></header>
    <div className="me-panel-content me-reading">
      <h3>{request ? statusText(request.status, zh) : zh ? '正在查询进度' : 'Checking progress'}</h3>
      <p>{deletionProgressText(request,zh)}</p>
      {request?.status === 'failed' && <button className="me-secondary btn-ghost" disabled={busy} onClick={() => void retry()}>{zh ? '继续清理' : 'Resume cleanup'}</button>}
      {message && <p role="status">{message}</p>}
      <button className="me-primary btn-dark" onClick={close}>{zh ? '返回登录' : 'Return to sign-in'}</button>
    </div>
  </ContextSheet>
}
