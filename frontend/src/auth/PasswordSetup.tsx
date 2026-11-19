import { Eye, EyeSlash } from '@phosphor-icons/react'
import { useEffect, useId, useRef, useState } from 'react'
import { isZh, useI18n } from '../i18n'
import { passwordFailure, passwordRules, type AuthenticationMethods, type PasswordChallenge, type PasswordPolicy, type PasswordService } from './password'

type Field = 'dial' | 'phone' | 'code' | 'password' | 'confirmation'
const invalidBorder = 'border-[var(--auth-danger,#913d38)]! [.night_&]:border-[var(--auth-danger,#ffb2a9)]!'

function useFieldFeedback() {
  const id = useId()
  const form = useRef<HTMLFormElement>(null)
  const [error, setError] = useState<{ field: Field; text: string }>()
  return {
    form,
    invalid: (field: Field) => error?.field === field,
    clear: (...fields: Field[]) => setError(previous => !previous || fields.length === 0 || fields.includes(previous.field) ? undefined : previous),
    fail(field: Field, text: string) {
      setError({ field, text })
      form.current?.querySelector<HTMLInputElement>(`[id="${id}-${field}"]`)?.focus()
    },
    attributes(field: Field, description?: string) {
      const invalid = error?.field === field
      return {
        id: `${id}-${field}`,
        'aria-invalid': invalid || undefined,
        'aria-describedby': [description, invalid ? `${id}-${field}-error` : undefined].filter(Boolean).join(' ') || undefined,
      }
    },
    message(field: Field) {
      if (error?.field !== field) return null
      return <p id={`${id}-${field}-error`} role="alert" className="text-left text-xs leading-relaxed text-[var(--auth-danger,#913d38)] [.night_&]:text-[var(--auth-danger,#ffb2a9)]">{error.text}</p>
    },
  }
}

function phoneError(dial: string, phone: string, zh: boolean): { field: 'dial' | 'phone'; text: string } | undefined {
  if (!/^\+[1-9]\d{0,3}$/.test(dial)) return { field: 'dial', text: zh ? '请输入有效的国家或地区代码。' : 'Enter a valid country calling code.' }
  if (!phone) return { field: 'phone', text: zh ? '请输入手机号。' : 'Enter your phone number.' }
  if (!/^\d{6,14}$/.test(phone) || dial.length + phone.length > 16) return { field: 'phone', text: zh ? '请检查手机号位数。' : 'Check the number of digits in your phone number.' }
}

function operationFailure(error: unknown, zh: boolean) {
  const value = error as { status?: number; code?: string } | undefined
  if (value?.status === 403 || value?.code === 'FORBIDDEN') {
    return zh ? '当前页面无法完成这项操作，请返回后重试。' : 'This action is unavailable here. Go back and try again.'
  }
  return passwordFailure(error, zh)
}

function passwordField(input: React.ComponentPropsWithRef<'input'>, label: string, visible: boolean, toggle: () => void) {
  const Icon = visible ? EyeSlash : Eye
  return <div className="relative">
    <input {...input} type={visible ? 'text' : 'password'} spellCheck={false} autoCapitalize="none" className={`${input.className ?? ''} pe-12! [&::-ms-reveal]:hidden`} />
    <button type="button" aria-label={label} aria-controls={input.id} title={label}
      className="absolute inset-y-0 end-0 grid min-w-11 place-items-center rounded-md text-[var(--auth-muted,var(--color-ink-soft))] hover:text-[var(--auth-accent,var(--color-ink))] focus-visible:outline-2 focus-visible:outline-offset-[-3px]"
      onMouseDown={event => { if (document.activeElement?.id === input.id) event.preventDefault() }} onClick={toggle}>
      <Icon size={21} aria-hidden="true" />
    </button>
  </div>
}

export function PasswordSetup({ service, mode, initial, onComplete, onBack, variant = 'account', onBusyChange, registerBack }: { service: PasswordService; mode: 'manage' | 'reset'; initial?: { dial: string; phone: string }; onComplete: () => void | Promise<void>; onBack: () => void; variant?: 'auth' | 'account'; onBusyChange?:(busy:boolean)=>void;registerBack?:(back:(()=>void)|undefined)=>void }) {
  const { lang } = useI18n(), zh = isZh(lang)
  const feedback = useFieldFeedback()
  const [policy, setPolicy] = useState<PasswordPolicy>(), [account, setAccount] = useState<AuthenticationMethods>()
  const [loading, setLoading] = useState(true), [reload, setReload] = useState(0), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const [step, setStep] = useState<'phone' | 'code' | 'password'>('phone'), [dial, setDial] = useState(initial?.dial ?? '+86'), [phone, setPhone] = useState(initial?.phone ?? '')
  const [code, setCode] = useState(''), [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState(''), [visible, setVisible] = useState(false), [confirmationVisible, setConfirmationVisible] = useState(false), [unknown, setUnknown] = useState(false)
  const [challenge, setChallenge] = useState<PasswordChallenge>(), [now, setNow] = useState(Date.now)
  const callbacks = useRef({ service, onComplete, onBack, onBusyChange,registerBack }); callbacks.current = { service, onComplete, onBack,onBusyChange,registerBack }
  const lifetime = useRef<AbortController | null>(null), active = useRef<AbortSignal | null>(null), submitted = useRef(false), currentChallenge = useRef(challenge); currentChallenge.current = challenge
  const sendKey = useRef<string | undefined>(undefined), verifyKey = useRef<{ code: string; key: string } | undefined>(undefined), saveKey = useRef<string | undefined>(undefined)
  const scope = service.scopeKey
  useEffect(()=>{active.current=null;setBusy(false);setMessage('');feedback.clear();setPassword('');setConfirmation('');setCode('');setChallenge(undefined);currentChallenge.current=undefined;setStep('phone');setUnknown(false);setVisible(false);setConfirmationVisible(false);submitted.current=false;sendKey.current=undefined;verifyKey.current=undefined;saveKey.current=undefined},[scope,mode])
  function back(){if(active.current)return;setPassword('');setConfirmation('');setCode('');callbacks.current.onBack()}
  useEffect(()=>{callbacks.current.registerBack?.(back);return()=>{callbacks.current.registerBack?.(undefined);callbacks.current.onBusyChange?.(false)}},[scope])
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller
    setLoading(true); setMessage('')
    void Promise.all([service.policy(controller.signal), mode === 'manage' ? service.authentication(controller.signal) : Promise.resolve(undefined)]).then(([next, metadata]) => {
      if (!controller.signal.aborted) { setPolicy(next); setAccount(metadata) }
    }).catch(error => { if (!controller.signal.aborted) setMessage(operationFailure(error, zh)) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => {
      controller.abort()
      const old = currentChallenge.current
      if (old && !submitted.current) void service.cancel(old.id, new AbortController().signal).catch(() => {})
    }
  }, [scope, mode, reload])
  useEffect(() => { if (!challenge) return; const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id) }, [challenge?.id])
  const live = (signal: AbortSignal) => !signal.aborted && callbacks.current.service.scopeKey === scope
  async function run(job: (signal: AbortSignal) => Promise<void>) {
    const signal = lifetime.current?.signal
    if (!signal || !live(signal) || active.current) return
    active.current = signal; callbacks.current.onBusyChange?.(true);setBusy(true); setMessage(''); feedback.clear()
    try { await job(signal) } catch (error) { if (live(signal)) setMessage(operationFailure(error, zh)) }
    finally { if(active.current===signal){active.current=null;if (live(signal)) {callbacks.current.onBusyChange?.(false);setBusy(false)}} }
  }
  async function completed(signal: AbortSignal) {
    if (!live(signal)) return
    setPassword(''); setConfirmation(''); setVisible(false); setConfirmationVisible(false); setCode(''); setUnknown(false); setChallenge(undefined); currentChallenge.current = undefined
    await callbacks.current.onComplete()
  }
  function expired(text: string) {
    setStep('phone'); setCode(''); setPassword(''); setConfirmation(''); setVisible(false); setConfirmationVisible(false)
    setChallenge(undefined); currentChallenge.current = undefined; sendKey.current = undefined; verifyKey.current = undefined; saveKey.current = undefined; submitted.current = false; setUnknown(false)
    setMessage(text)
  }
  const ready = !!policy && policy.resetEnabled && (mode !== 'manage' || !!account?.password.canManage)
  async function sendCode() {
    if (!ready || challenge && now < Date.parse(challenge.resendAt)) return
    const issue = mode === 'reset' ? phoneError(dial, phone, zh) : undefined
    if (issue) { setMessage(''); feedback.fail(issue.field, issue.text); return }
    await run(async signal => {
      sendKey.current ??= crypto.randomUUID()
      const result = await service.challenge(mode === 'manage' ? { purpose: 'manage' } : { purpose: 'reset', dial, phone }, sendKey.current, signal)
      if (!live(signal)) return
      setChallenge(result); currentChallenge.current = result; sendKey.current = undefined; verifyKey.current = undefined; saveKey.current = undefined; submitted.current = false
      setCode(''); setPassword(''); setConfirmation(''); setUnknown(false); setStep('code'); setNow(Date.now())
    })
  }
  async function verifyCode() {
    if (!challenge) return
    if (!/^\d{6}$/.test(code)) { setMessage(''); feedback.fail('code', zh ? '请输入六位验证码。' : 'Enter the six-digit verification code.'); return }
    await run(async signal => {
      if (verifyKey.current?.code !== code) verifyKey.current = { code, key: crypto.randomUUID() }
      const result = await service.verify(challenge.id, code, verifyKey.current.key, signal).catch(error => {
        const value = error as { code?: string; status?: number } | undefined
        if (value?.code === 'AUTH_CHALLENGE_EXPIRED' || value?.status === 410) return { status: 'expired' } as const
        throw error
      })
      if (!live(signal)) return
      if (result.status === 'incorrect') { feedback.fail('code', zh ? '验证码不正确，请重新填写。' : 'The verification code is incorrect.'); return }
      if (result.status === 'expired') { expired(zh ? '验证码已过期，请重新获取。' : 'The code expired. Request a new one.'); return }
      setCode(''); verifyKey.current = undefined; setStep('password')
    })
  }
  async function save() {
    if (!challenge || !policy) return
    setMessage('')
    if (!password) { feedback.fail('password', zh ? '请输入新密码。' : 'Enter a new password.'); return }
    if (password.length < policy.policy.minimumLength || password.length > policy.policy.maximumLength) {
      feedback.fail('password', zh ? `请输入 ${policy.policy.minimumLength}–${policy.policy.maximumLength} 位密码。` : `Use ${policy.policy.minimumLength}–${policy.policy.maximumLength} characters.`); return
    }
    if (policy.policy.asciiOnly && /[^\x20-\x7e]/.test(password)) { feedback.fail('password', zh ? '请使用英文字母、数字或常用符号。' : 'Use English letters, numbers, or standard symbols.'); return }
    if (!confirmation) { feedback.fail('confirmation', zh ? '请再次输入新密码。' : 'Confirm your new password.'); return }
    if (password !== confirmation) { feedback.fail('confirmation', zh ? '两次输入的密码不一致。' : 'The passwords do not match.'); return }
    await run(async signal => {
      setVisible(false); setConfirmationVisible(false)
      const wasSubmitted = submitted.current
      saveKey.current ??= crypto.randomUUID(); submitted.current = true
      try { await service.save(challenge.id, password, saveKey.current, signal) }
      catch (error) {
        if (!live(signal)) return
        const value = error as { code?: string; status?: number } | undefined
        if (value?.code === 'AUTH_PASSWORD_POLICY_REJECTED') { submitted.current = false; saveKey.current = undefined; setUnknown(false); feedback.fail('password', passwordFailure(error, zh)); return }
        if (value?.code === 'AUTH_CHALLENGE_EXPIRED' || value?.status === 410) { expired(passwordFailure(error, zh)); return }
        if (value?.code === 'FORBIDDEN' || value?.status === 403) { submitted.current = wasSubmitted; setMessage(operationFailure(error, zh)); return }
        setUnknown(true); setMessage(zh ? '密码是否保存还没能确认，请先查看结果。重试会继续这次保存。' : 'We could not confirm whether your password was saved. Check the result first; retrying continues this save.');return
      }
      await completed(signal)
    })
  }
  async function checkResult() {
    if (!challenge) return
    await run(async signal => {
      const status = await service.status(challenge.id, signal)
      if (!live(signal)) return
      if (status.status === 'completed') await completed(signal)
      else if (status.status === 'expired') expired(zh ? '验证已过期，请重新获取验证码。' : 'Verification expired. Request a new code.')
      else setMessage(zh ? '暂时还不能确认结果。可以继续用刚才的新密码重试，或返回后重新验证手机号。' : 'The result is still unconfirmed. Retry with the same new password, or go back and verify your phone again.')
    })
  }
  const primary = variant === 'auth' ? 'auth-primary w-full min-h-[50px] rounded-full px-4 py-2 text-[16px] font-semibold' : 'me-primary btn-dark'
  const secondary = variant === 'auth' ? 'auth-accent auth-method-link' : 'me-secondary btn-ghost'
  const field = variant === 'auth' ? 'grid gap-1 text-left text-sm auth-secondary' : 'me-field'
  const inputClass = (field: Field) => `${variant === 'auth' ? 'auth-phone min-h-12 w-full bg-transparent border-b border-current/30 text-base outline-none focus:border-(--auth-accent)' : ''} ${feedback.invalid(field) ? invalidBorder : ''}`
  const dialField = feedback.attributes('dial'), phoneField = feedback.attributes('phone'), codeField = feedback.attributes('code')
  const passwordId = feedback.attributes('password').id
  const passwordInput = feedback.attributes('password', `${passwordId}-rules`), confirmationInput = feedback.attributes('confirmation')
  const feedbackClass = variant === 'auth' ? 'auth-feedback text-left!' : 'text-sm text-(--color-ink-soft)'
  const cooldown = challenge ? Math.max(0, Math.ceil((Date.parse(challenge.resendAt) - now) / 1000)) : 0
  return <section className="space-y-4" aria-busy={busy || loading} aria-label={mode === 'manage' ? zh ? '设置或修改登录密码' : 'Set or change sign-in password' : zh ? '找回密码' : 'Reset password'}>
    <h3 className="font-serif text-xl">{mode === 'manage' ? zh ? '设置或修改登录密码' : 'Set or change sign-in password' : zh ? '找回密码' : 'Reset password'}</h3>
    {loading ? <p role="status">{zh ? '正在读取账号设置…' : 'Loading account settings…'}</p> : !policy ? <button className={secondary} onClick={() => setReload(v => v + 1)}>{zh ? '重新读取' : 'Try again'}</button>
      : !policy.resetEnabled ? <p>{zh ? '密码设置暂未开通，请使用原登录方式。' : 'Password setup is not available yet. Use your original sign-in method.'}</p>
      : mode === 'manage' && !account?.password.canManage ? <p>{account && !account.password.phoneBound ? zh ? '当前账号未绑定手机号，请使用原第三方方式登录。' : 'This account has no linked phone number. Use your original sign-in method.' : zh ? '暂时无法读取当前账号的登录方式，请返回后重试。' : 'Your sign-in methods could not be read. Go back and try again.'}</p>
      : <form ref={feedback.form} className="space-y-4" onSubmit={event => { event.preventDefault(); void (step === 'phone' ? sendCode() : step === 'code' ? verifyCode() : save()) }}>
        {step === 'phone' ? mode === 'manage' ? <p>{zh ? `验证码将发送至 ${account?.password.maskedPhone ?? '当前绑定手机号'}。` : `A code will be sent to ${account?.password.maskedPhone ?? 'your linked phone number'}.`}</p> : <>
          <div className={field}>
            <label htmlFor={dialField.id}>{zh ? '国家或地区代码' : 'Country calling code'}</label>
            <input {...dialField} className={inputClass('dial')} value={dial} onChange={e => { setDial(e.currentTarget.value); feedback.clear('dial'); sendKey.current = undefined }} autoComplete="tel-country-code" inputMode="tel" readOnly={busy} />
            {feedback.message('dial')}
          </div>
          <div className={field}>
            <label htmlFor={phoneField.id}>{zh ? '手机号' : 'Phone number'}</label>
            <input {...phoneField} className={inputClass('phone')} value={phone} onChange={e => { setPhone(e.currentTarget.value.replace(/\D/g, '').slice(0, 14)); feedback.clear('phone'); sendKey.current = undefined }} autoComplete="tel-national" inputMode="tel" readOnly={busy} />
            {feedback.message('phone')}
          </div>
        </> : step === 'code' ? <>
          <p className="text-sm">{zh ? '请输入短信中的六位验证码。' : 'Enter the six-digit code from your text message.'}</p>
          <div className={field}>
            <label htmlFor={codeField.id}>{zh ? '验证码' : 'Verification code'}</label>
            <input {...codeField} className={inputClass('code')} value={code} onChange={e => { setCode(e.currentTarget.value.replace(/\D/g, '').slice(0, 6)); feedback.clear('code') }} autoComplete="one-time-code" inputMode="numeric" maxLength={6} readOnly={busy} />
            {feedback.message('code')}
          </div>
          <button className={secondary} type="button" disabled={busy || cooldown > 0} onClick={() => void sendCode()}>{cooldown > 0 ? zh ? `${cooldown}s 后重发` : `Resend in ${cooldown}s` : zh ? '重新获取验证码' : 'Request another code'}</button>
        </> : <>
          <p id={`${passwordId}-rules`} className="text-sm leading-relaxed">{passwordRules(policy, zh)}</p>
          <div className={field}>
            <label htmlFor={passwordInput.id}>{zh ? '新密码' : 'New password'}</label>
            {passwordField({ ...passwordInput, className: inputClass('password'), autoComplete: 'new-password', value: password, maxLength: policy.policy.maximumLength, onChange: e => { setPassword(e.currentTarget.value); feedback.clear('password', 'confirmation') }, readOnly: busy || unknown }, visible ? zh ? '隐藏新密码' : 'Hide new password' : zh ? '显示新密码' : 'Show new password', visible, () => setVisible(value => !value))}
            {feedback.message('password')}
          </div>
          <div className={field}>
            <label htmlFor={confirmationInput.id}>{zh ? '确认新密码' : 'Confirm new password'}</label>
            {passwordField({ ...confirmationInput, className: inputClass('confirmation'), autoComplete: 'new-password', value: confirmation, maxLength: policy.policy.maximumLength, onChange: e => { setConfirmation(e.currentTarget.value); feedback.clear('confirmation') }, readOnly: busy || unknown }, confirmationVisible ? zh ? '隐藏确认的新密码' : 'Hide confirmation password' : zh ? '显示确认的新密码' : 'Show confirmation password', confirmationVisible, () => setConfirmationVisible(value => !value))}
            {feedback.message('confirmation')}
          </div>
        </>}
        {message && <p role="status" className={feedbackClass}>{message}</p>}
        <button className={primary} type="submit" disabled={busy}>{busy ? zh ? '正在处理…' : 'Working…' : step === 'phone' ? zh ? '获取验证码' : 'Get verification code' : step === 'code' ? zh ? '验证手机号' : 'Verify phone number' : unknown ? zh ? '继续保存这次密码' : 'Continue this password save' : zh ? '保存新密码' : 'Save new password'}</button>
        {unknown && <button className={secondary} type="button" disabled={busy} onClick={() => void checkResult()}>{zh ? '查看保存结果' : 'Check save result'}</button>}
      </form>}
    {message && !ready && <p role="status" className={feedbackClass}>{message}</p>}
    <button className={secondary} type="button" disabled={busy} onClick={back}>{zh ? '返回' : 'Back'}</button>
  </section>
}

export function PasswordLogin({ service, purpose, dial, phone, onPhone, onDial, agreement, canProceed, onSuccess, onBack, onBusyChange, registerBack }: { service: PasswordService; purpose: 'sign_in' | 'switch'; dial: string; phone: string; onPhone: (value: string) => void; onDial: (value: string) => void; agreement: React.ReactNode; canProceed: () => boolean; onSuccess: () => void; onBack: () => void;onBusyChange?:(busy:boolean)=>void;registerBack?:(back:(()=>void)|undefined)=>void }) {
  const { lang } = useI18n(), zh = isZh(lang)
  const feedback = useFieldFeedback()
  const [policy, setPolicy] = useState<PasswordPolicy>(), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0), [password, setPassword] = useState(''), [visible, setVisible] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [reset, setReset] = useState(false)
  const current = useRef({ service, dial, phone,onBack,onBusyChange,registerBack }); current.current = { service, dial, phone,onBack,onBusyChange,registerBack }
  const resetCurrent=useRef(reset);resetCurrent.current=reset;const resetBack=useRef<(()=>void)|undefined>(undefined)
  const operation = useRef<{ password: string; dial: string; phone: string; key: string } | undefined>(undefined), active = useRef<AbortController | null>(null), lifetime = useRef<AbortController | null>(null)
  useEffect(()=>{active.current?.abort();active.current=null;setBusy(false);setMessage('');feedback.clear();setPassword('');setVisible(false);setReset(false);operation.current=undefined},[service.scopeKey])
  function back(){if(active.current)return;if(resetCurrent.current){resetBack.current?.();return};setPassword('');operation.current=undefined;current.current.onBack()}
  useEffect(()=>{current.current.registerBack?.(back);return()=>{current.current.registerBack?.(undefined);current.current.onBusyChange?.(false)}},[service.scopeKey])
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; setLoading(true); setMessage(''); void service.policy(controller.signal).then(value => { if (!controller.signal.aborted) setPolicy(value) }).catch(error => { if (!controller.signal.aborted) setMessage(operationFailure(error, zh)) }).finally(() => { if (!controller.signal.aborted) setLoading(false) }); return () => { controller.abort(); active.current?.abort(); operation.current = undefined } }, [service.scopeKey, retry])
  async function signIn() {
    if (active.current || loading || !policy?.enabled) return
    setMessage('')
    const issue = phoneError(dial, phone, zh)
    if (issue) { feedback.fail(issue.field, issue.text); return }
    if (!password) { feedback.fail('password', zh ? '请输入密码。' : 'Enter your password.'); return }
    if (!canProceed()) return
    feedback.clear()
    const controller = new AbortController(); active.current = controller; current.current.onBusyChange?.(true);setBusy(true); setVisible(false)
    if (!operation.current || operation.current.password !== password || operation.current.dial !== dial || operation.current.phone !== phone) operation.current = { password, dial, phone, key: crypto.randomUUID() }
    try { await service.signIn({ password, dial, phone, purpose }, operation.current.key, controller.signal); if (!controller.signal.aborted && lifetime.current && !lifetime.current.signal.aborted && current.current.service.scopeKey === service.scopeKey) { setPassword(''); operation.current = undefined; onSuccess() } }
    catch (error) {
      if (!controller.signal.aborted && current.current.service.scopeKey === service.scopeKey) {
        if ((error as { code?: string } | undefined)?.code === 'AUTH_INVALID_CREDENTIALS') {
          operation.current = undefined
          feedback.fail('password', passwordFailure(error, zh))
        } else setMessage(operationFailure(error, zh))
      }
    }
    finally { if (active.current === controller) { active.current = null; if (!controller.signal.aborted) {current.current.onBusyChange?.(false);setBusy(false)} } }
  }
  if (reset) return <PasswordSetup service={service} mode="reset" variant="auth" initial={{ dial, phone }} onBusyChange={value=>current.current.onBusyChange?.(value)} registerBack={value=>{resetBack.current=value}} onBack={() => setReset(false)} onComplete={async () => { setPassword(''); operation.current = undefined; setReset(false); setMessage(zh ? '密码已更新，请使用新密码登录。' : 'Password updated. Sign in with your new password.'); if(purpose==='switch')await service.refresh() }} />
  const dialField = feedback.attributes('dial'), phoneField = feedback.attributes('phone'), passwordInput = feedback.attributes('password')
  const phoneInvalid = feedback.invalid('dial') || feedback.invalid('phone')
  return <section className="space-y-4" aria-label={zh ? '密码登录' : 'Sign in with password'} aria-busy={busy || loading}>
    <h3 className="font-serif text-xl">{zh ? '密码登录' : 'Sign in with password'}</h3>
    <form ref={feedback.form} className="space-y-4" onSubmit={event => { event.preventDefault(); void signIn() }}>
      <div className="grid gap-1">
        <div className={`flex items-center gap-3 border-b border-current/30 focus-within:border-(--auth-accent) ${phoneInvalid ? invalidBorder : ''}`}>
          <label className="sr-only" htmlFor={dialField.id}>{zh ? '国家或地区代码' : 'Country calling code'}</label>
          <input {...dialField} className="auth-phone min-h-12 w-16 bg-transparent outline-none" value={dial} onChange={e => { onDial(e.currentTarget.value); feedback.clear('dial', 'password'); operation.current = undefined }} inputMode="tel" autoComplete="tel-country-code" readOnly={busy} />
          <label className="sr-only" htmlFor={phoneField.id}>{zh ? '手机号' : 'Phone number'}</label>
          <input {...phoneField} className="auth-phone min-h-12 min-w-0 flex-1 bg-transparent text-lg outline-none" value={phone} onChange={e => { onPhone(e.currentTarget.value.replace(/\D/g, '').slice(0, 14)); feedback.clear('phone', 'password'); operation.current = undefined }} placeholder={zh ? '手机号' : 'Phone number'} type="tel" autoComplete="username" readOnly={busy} />
        </div>
        {feedback.message('dial')}
        {feedback.message('phone')}
      </div>
      <div className="grid gap-1">
        <label className="text-left text-sm auth-secondary" htmlFor={passwordInput.id}>{zh ? '密码' : 'Password'}</label>
        {passwordField({ ...passwordInput, className: `auth-phone min-h-12 w-full bg-transparent border-b border-current/30 text-lg outline-none focus:border-(--auth-accent) ${feedback.invalid('password') ? invalidBorder : ''}`, autoComplete: 'current-password', value: password, maxLength: policy?.policy.maximumLength ?? 256, onChange: e => { setPassword(e.currentTarget.value); feedback.clear('password'); operation.current = undefined }, readOnly: busy }, visible ? zh ? '隐藏密码' : 'Hide password' : zh ? '显示密码' : 'Show password', visible, () => setVisible(value => !value))}
        {feedback.message('password')}
      </div>
      <div className="flex justify-end"><button type="button" className="auth-accent auth-method-link me-0! ms-0!" disabled={busy || !policy?.resetEnabled} onClick={() => { if (!canProceed()) return; setPassword(''); setVisible(false); feedback.clear(); operation.current = undefined; setReset(true); setMessage('') }}>{zh ? '忘记密码' : 'Forgot password'}</button></div>
      {agreement}
      {message && policy && <p className="auth-feedback text-left!" role="status">{message}</p>}
      <button className="auth-primary w-full min-h-[50px] rounded-full px-4 py-2 text-[16px] font-semibold" type="submit" disabled={busy || loading || !policy?.enabled}>{busy ? zh ? '正在登录…' : 'Signing in…' : zh ? '登录' : 'Sign in'}</button>
    </form>
    {!loading && policy && !policy.enabled && <p className="auth-feedback">{zh ? '密码登录暂未开通，请使用验证码登录。' : 'Password sign-in is not available yet. Use a verification code.'}</p>}
    {message && !policy && <p className="auth-feedback" role="status">{message}</p>}
    {!loading && !policy && <button className="auth-accent auth-method-link" onClick={() => setRetry(v => v + 1)}>{zh ? '重新读取' : 'Try again'}</button>}
    <button type="button" className="auth-accent auth-method-link" disabled={busy} onClick={back}>{zh ? '使用验证码登录' : 'Use a verification code'}</button>
  </section>
}

