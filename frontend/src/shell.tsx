import { useContext, useEffect, useId, useRef, useState } from 'react'
import {ReportHistoryButton} from './ContentReports'
import { AppleLogo, ArrowsLeftRight, GoogleLogo, MoonStars, Password as PasswordIcon, ShieldCheck, SignOut, Wallet, UserPlus, WechatLogo } from '@phosphor-icons/react'
import { useI18n, fmtClock, LANGS, COUNTRIES, isZh, type WorldId } from './i18n'
import type { Theme, User } from './model'
import { WORLDS } from './worlds'
import { DeepField, Veil } from './fx'
import { I, Sheet, Switch, Toast, haptic, chime, fxPrefs, useStatusTone, NightCtx, type BarTone } from './ui'
import { isNativeRuntime, useNativeBack } from './mobile/back'
import { ContextSheet } from './mobile/ContextSheet'
import { authorizeDemoProvider, DEMO_SMS_CODE, requestDemoSms, verifyDemoSms, type SmsChallenge } from './auth/preview'
import { IdentityRequestError, type IdentityNotice } from './auth/useIdentitySession'
import { AiTextPermission, TextStoragePermission, PersonVoiceStoragePermission, PhotoStoragePermission, PersonPhotoStoragePermission, GiftStoragePermission, GiftReturnsPermission, GiftPhotoStoragePermission, LetterStoragePermission, LetterRepliesPermission, GatherRepliesPermission, ChatPhotoStoragePermission, ChatImageRepliesPermission, WorldActionPermission, StoryBranchesPermission, OfflineLifePermission } from './auth/AiTextPermission'
import { PrivacyStatement } from './auth/PrivacyStatement'
import { DataRights } from './auth/DataRights'
import type { RightsContext } from './auth/dataRightsClient'
import type { SocialProvider } from './auth/nativeAuth'
import type { AccountAuthenticationControls, PasswordService } from './auth/password'
import { socialFailure } from './auth/password'
import { PasswordLogin, PasswordSetup } from './auth/PasswordSetup'
import './auth-theme.css'
import './me.css'

/* ------------------------------------------------------------------ *
 * 外壳：状态栏 · 启动（界启 / 回归）· 登录 · 标签栏 · 我
 * ------------------------------------------------------------------ */

export function StatusBar({ tone }: { tone: BarTone }) {
  const native = isNativeRuntime()
  const { lang } = useI18n()
  const [clock, setClock] = useState(() => fmtClock(lang))
  useEffect(() => {
    if (native) return
    setClock(fmtClock(lang))
    const id = window.setInterval(() => setClock(fmtClock(lang)), 15000)
    return () => clearInterval(id)
  }, [lang, native])
  if (native) return null
  return (
    <div data-preview-system-bar className={`absolute top-0 inset-x-0 z-[115] h-[44px] flex items-end justify-between px-7 pb-1 text-[13px] font-semibold pointer-events-none transition-colors duration-500 ${tone === 'light' ? 'text-pearl/90' : 'text-ink/80'}`}>
      <span>{clock}</span>
      <span className="flex items-center gap-1.5">
        <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor"><rect x="0" y="7" width="3" height="4" rx="1" /><rect x="4.5" y="4.5" width="3" height="6.5" rx="1" /><rect x="9" y="2" width="3" height="9" rx="1" /><rect x="13.5" y="0" width="3" height="11" rx="1" /></svg>
        <svg width="24" height="12" viewBox="0 0 24 12" fill="none"><rect x="0.5" y="0.5" width="20" height="11" rx="3" stroke="currentColor" opacity="0.5" /><rect x="2" y="2" width="15" height="8" rx="1.5" fill="currentColor" /><rect x="21.5" y="4" width="1.6" height="4" rx="0.8" fill="currentColor" opacity="0.5" /></svg>
      </span>
    </div>
  )
}

/* ------------------------- 回归：属于你的几粒光 ------------------------- */
export function ReturnSplash({ worlds }: { worlds: WorldId[] }) {
  return (
    <div className="absolute inset-0 z-0" aria-hidden>
      <DeepField />
      <div className="absolute left-1/2 top-[44%]">
        {worlds.map((w, i) => {
          const a = ((-150 + i * (120 / Math.max(1, worlds.length - 1 || 1))) * Math.PI) / 180
          const x = Math.cos(a) * 118; const y = Math.sin(a) * 118
          return <span key={w} className="absolute h-2.5 w-2.5 -ml-[5px] -mt-[5px] rounded-full dot-fly" style={{ left: x, top: y, background: WORLDS[w].accent, boxShadow: `0 0 16px 4px ${WORLDS[w].glow}`, ['--dx' as string]: `${-x}px`, ['--dy' as string]: `${-y}px`, animationDelay: `${0.2 + i * 0.06}s`, animationDuration: '0.5s' } as React.CSSProperties} />
        })}
        <span className="absolute h-3 w-3 -ml-1.5 -mt-1.5 rounded-full pop-in" style={{ background: '#fff7e6', boxShadow: '0 0 30px 10px rgba(235,201,149,0.75)' }} />
      </div>
    </div>
  )
}

/* ============================== 登录 ============================== */
/* 界启动画与登录是同一个连续画面：光点 → 地平线 → 两道分离 → 界膜 → 西界 */
export type EmbeddedAuthControls = {
  state: 'ready' | 'unavailable'
  providers:Record<SocialProvider,boolean>
  startProvider:(provider:SocialProvider,signal:AbortSignal)=>Promise<void>
  cancelProvider?:()=>Promise<void>
  requestCode: (dial: string, phone: string, signal: AbortSignal) => Promise<SmsChallenge>
  verifyCode: (challenge: SmsChallenge, code: string, signal: AbortSignal) => Promise<{ status: 'verified' | 'incorrect' | 'expired' }>
  onComplete: () => void
  onRetry: () => void
  password: PasswordService
  purpose: 'sign_in' | 'switch'
  onPasswordComplete: () => void
  providerPending?: boolean
  providerProgress?: 'waiting' | 'processing' | 'unconfirmed'
}

type AuthFlowProps = { intro: boolean; onCancel?: () => void; onGuest?: () => void; method?: 'sms' | 'password'; onMethodChange?: (method: 'sms' | 'password') => void; message?: string } & (
  | { onDone: (user: User) => void; embedded?: never }
  | { embedded: EmbeddedAuthControls; onDone?: never }
)

function hostedNotice(notice: IdentityNotice, zh: boolean) {
  if (notice === 'cancelled') return zh ? '已取消本次授权。' : 'Authorization was cancelled.'
  if (notice === 'failed') return zh ? '授权未完成，请重试。' : 'Authorization did not complete. Try again.'
  return zh ? '账号服务暂时无法处理，请重试。' : 'The account service is unavailable. Try again.'
}

export function AuthFlow({ intro, onDone, onCancel, onGuest, embedded, method = 'sms', onMethodChange, message: externalMessage }: AuthFlowProps) {
  const { t, lang } = useI18n()
  const night = useContext(NightCtx)
  useStatusTone(night ? 'light' : 'dark')
  const [playing, setPlaying] = useState(intro && !fxPrefs.calm)
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [country, setCountry] = useState(() => COUNTRIES.find(c => c.iso === (lang === 'en' ? 'US' : 'CN')) ?? COUNTRIES[0])
  const { dial } = country
  const [phone, setPhone] = useState('')
  const [agree, setAgree] = useState(false)
  const [code, setCode] = useState('')
  const [challenge, setChallenge] = useState<SmsChallenge | null>(null)
  const [now, setNow] = useState(Date.now)
  const [retryAt, setRetryAt] = useState(0)
  const [focus, setFocus] = useState(false)
  const [sheet, setSheet] = useState<null | 'region' | 'lang' | 'methods'>(null)
  const [provider, setProvider] = useState<SocialProvider | null>(null)
  const [success, setSuccess] = useState(false)
  const [notice, setNotice] = useState<'agreement' | 'unavailable' | 'incorrect' | 'expired' | 'canceled' | 'rate-limited' | 'invalid-phone' | null>(null)
  const [providerError, setProviderError] = useState<string | false>(false)
  const [pending, setPending] = useState<'sms' | 'verify' | 'provider' | null>(null)
  const [passwordBusy,setPasswordBusy]=useState(false),passwordBusyRef=useRef(false),passwordBack=useRef<(()=>void)|undefined>(undefined)
  const verifyingAccount = !!embedded && (pending === 'verify'||passwordBusy)
  const activeRequest = useRef<AbortController | null>(null)
  const finishTimer = useRef(0)
  const finishing = useRef(false)
  const authRoot = useRef<HTMLDivElement>(null)
  const phoneInput = useRef<HTMLInputElement>(null)
  const returnToPhoneInput = useRef(false)
  const codeInput = useRef<HTMLInputElement>(null)
  const agreementInput = useRef<HTMLButtonElement>(null)
  const providerConfirm = useRef<HTMLButtonElement>(null)
  const feedbackId = useId()
  const matchingChallenge = challenge?.dial === dial && challenge.phone === phone ? challenge : null
  const resendIn = matchingChallenge ? Math.max(0, Math.ceil((matchingChallenge.resendAt - now) / 1000)) : 0
  const retryIn = Math.max(0, Math.ceil((retryAt - now) / 1000))
  const expired = step === 'code' && (!matchingChallenge || now >= matchingChallenge.expiresAt)
  useEffect(() => { if (!playing) return; const id = window.setTimeout(() => setPlaying(false), 2700); return () => clearTimeout(id) }, [playing])
  useEffect(() => () => {
    activeRequest.current?.abort()
    clearTimeout(finishTimer.current)
  }, [])
  useEffect(() => {
    if ((step !== 'code' || !matchingChallenge) && !retryAt) return
    const updateTime = () => {
      const timestamp = Date.now()
      setNow(timestamp)
      if (retryAt && timestamp >= retryAt) setRetryAt(0)
    }
    updateTime()
    const id = window.setInterval(updateTime, 1000)
    document.addEventListener('visibilitychange', updateTime)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', updateTime)
    }
  }, [step, matchingChallenge, retryAt])
  useEffect(() => {
    if (step === 'code') codeInput.current?.focus({ preventScroll: true })
    else if (returnToPhoneInput.current) {
      returnToPhoneInput.current = false
      phoneInput.current?.focus({ preventScroll: true })
    }
  }, [step])
  useEffect(() => {
    if (provider) providerConfirm.current?.focus({ preventScroll: true })
  }, [provider])

  function cancelRequest() {
    activeRequest.current?.abort()
    activeRequest.current = null
    setPending(null)
  }

  async function runRequest<T>(
    action: 'sms' | 'verify' | 'provider',
    run: (signal: AbortSignal) => Promise<T>,
    complete: (value: T) => void,
  ) {
    if (activeRequest.current || finishing.current) return
    const controller = new AbortController()
    activeRequest.current = controller
    setPending(action)
    setNotice(null)
    if (action === 'provider') setProviderError(false)
    try {
      const value = await run(controller.signal)
      if (!controller.signal.aborted) complete(value)
    } catch (error) {
      if (!controller.signal.aborted) {
        if (action === 'provider') setProviderError(socialFailure(error,isZh(lang)))
        else if (error instanceof IdentityRequestError && (error.code === 'AUTH_RATE_LIMITED' || error.status === 429)) {
          const seconds = Number.isFinite(error.retryAfter) ? Math.max(1, Math.ceil(error.retryAfter!)) : 60
          const timestamp = Date.now()
          setNow(timestamp)
          setRetryAt(timestamp + seconds * 1000)
          setNotice('rate-limited')
        }
        else if (action === 'sms' && step === 'phone' && error instanceof IdentityRequestError && error.code === 'INVALID_ARGUMENT') {
          setNotice('invalid-phone')
          phoneInput.current?.focus({ preventScroll: true })
        }
        else if (step === 'code' && error instanceof IdentityRequestError && (error.code === 'AUTH_CHALLENGE_EXPIRED' || error.code === 'AUTH_RESTART_REQUIRED')) {
          setChallenge(null)
          setCode('')
          setNotice('expired')
        }
        else setNotice('unavailable')
      }
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null
        setPending(null)
      }
    }
  }

  function backToPhone() {
    if (finishing.current || verifyingAccount) return
    cancelRequest()
    codeInput.current?.blur()
    returnToPhoneInput.current = true
    setStep('phone')
    setNotice(null)
  }
  function backFromAuth() {
    if (finishing.current || verifyingAccount) return
    if (method === 'password') {if(!passwordBusyRef.current)passwordBack.current?.()}
    else if (step === 'code') backToPhone()
    else { cancelRequest(); onCancel?.() }
  }
  useNativeBack(() => { backFromAuth(); return true }, !!onCancel || method === 'password' || step === 'code' && !success, 20, authRoot)

  const phoneOk = phone.length >= 6
  function canProceed() {
    if (agree) return true
    setNotice('agreement')
    agreementInput.current?.focus()
    haptic(24)
    return false
  }

  function getCode() {
    if (verifyingAccount || !phoneOk || embedded?.state === 'unavailable' || Date.now() < retryAt || !canProceed()) return
    if (step === 'phone' && matchingChallenge && Date.now() < matchingChallenge.expiresAt) {
      setStep('code')
      setNotice(null)
      return
    }
    if (matchingChallenge && Date.now() < matchingChallenge.resendAt) return
    void runRequest('sms', (signal) => embedded ? embedded.requestCode(dial, phone, signal) : requestDemoSms(dial, phone, signal), (value) => {
      setChallenge(value)
      setNow(Date.now())
      setCode('')
      setStep('code')
      haptic(8)
    })
  }

  function finish(complete: () => void) {
    if (finishing.current) return
    finishing.current = true
    codeInput.current?.blur()
    setSuccess(true)
    haptic([10, 40, 20])
    chime('connect')
    finishTimer.current = window.setTimeout(complete, fxPrefs.calm ? 150 : 820)
  }

  function verify(codeToVerify: string) {
    if (codeToVerify.length !== 6 || !matchingChallenge || embedded?.state === 'unavailable' || Date.now() < retryAt || Date.now() >= matchingChallenge.expiresAt) return
    if (embedded) {
      void runRequest('verify', (signal) => embedded.verifyCode(matchingChallenge, codeToVerify, signal), (result) => {
        if (result.status === 'verified') finish(embedded.onComplete)
        else {
          if (result.status === 'expired') { setChallenge(null); setCode('') }
          setNotice(result.status)
          haptic(24)
        }
      })
      return
    }
    void runRequest('verify', (signal) => verifyDemoSms(matchingChallenge, codeToVerify, signal), (result) => {
      if (result.status === 'verified') {
        finish(() => onDone({ ...result.identity, nick: t('auth.nick.default') }))
      } else {
        setNotice(result.status)
        haptic(24)
      }
    })
  }

  function onCode(value: string) {
    if (finishing.current || verifyingAccount || expired) return
    const next = value.replace(/\D/g, '').slice(0, 6)
    if (pending === 'verify') cancelRequest()
    setCode(next)
    setNotice(null)
    if (next.length > code.length) haptic(4)
    if (next.length === 6) verify(next)
  }

  function openMethods() {
    if (finishing.current || verifyingAccount) return
    cancelRequest()
    codeInput.current?.blur()
    setProvider(null)
    setProviderError(false)
    setNotice(null)
    setSheet('methods')
  }

  function closeMethods() {
    if (finishing.current || verifyingAccount) return
    cancelRequest()
    if(provider&&embedded)void embedded.cancelProvider?.()
    if (provider && !embedded) setNotice('canceled')
    setSheet(null)
    setProvider(null)
    setProviderError(false)
  }

  function confirmProvider() {
    if (embedded) {
      if(!provider||!embedded.providers[provider]||embedded.providerPending||!canProceed())return
      void runRequest('provider',signal=>embedded.startProvider(provider,signal),()=>{})
      return
    }
    if (!provider || provider === 'google' || !canProceed()) return
    void runRequest('provider', (signal) => authorizeDemoProvider(provider, signal), (identity) => {
      setSheet(null)
      finish(() => onDone({ phone: '', dial: '', nick: t(`auth.nick.${provider}`), ...identity }))
    })
  }

  const zh = isZh(lang)
  const unavailable = embedded?.state === 'unavailable'
  const noticeText = unavailable || embedded && notice === 'unavailable'
    ? zh ? '账号服务暂时不可用，请稍后重试。' : 'The account service is unavailable. Please try again.'
    : notice === 'rate-limited'
      ? retryIn > 0 ? zh ? `操作太频繁，请 ${retryIn} 秒后重试。` : `Too many attempts. Try again in ${retryIn} seconds.` : zh ? '现在可以重新尝试。' : 'You can try again now.'
    : notice === 'unavailable' || notice === 'canceled' ? t(`auth.feedback.${notice}`) : ''
  const phoneError = notice === 'invalid-phone' ? zh ? '手机号格式不正确，请检查号码和国家或地区代码。' : 'Check your phone number and country or region code.' : ''
  const codeError = notice === 'expired' || expired ? t('auth.feedback.expired') : notice === 'incorrect' ? t('auth.feedback.incorrect') : ''
  const phoneErrorId = `${feedbackId}-phone`
  const codeErrorId = `${feedbackId}-code`
  const codeHintId = `${feedbackId}-code-hint`
  const isAlert = !!noticeText && notice !== 'canceled'
  const feedback = noticeText && <>
    <p className={isAlert ? 'auth-feedback auth-feedback--error' : 'auth-feedback'} role={isAlert ? 'alert' : 'status'}>{noticeText}</p>
    {embedded && (unavailable || notice === 'unavailable') && <button type="button" disabled={verifyingAccount} onClick={() => { if (verifyingAccount) return; cancelRequest(); setNotice(null); embedded.onRetry() }} className="auth-accent auth-method-link">{zh ? '重试' : 'Try again'}</button>}
  </>
  const methodButton = <button onClick={openMethods} disabled={success || verifyingAccount} aria-haspopup="dialog" aria-expanded={sheet === 'methods'} className="auth-accent auth-method-link">
    {t('auth.methods.other')} <I.Chevron className="h-3.5 w-3.5" />
  </button>
  function agreementControl(inProvider = false) {
    const active = inProvider === Boolean(provider)
    const invalid = active && notice === 'agreement'
    const errorId = `${feedbackId}-agreement`
    return <div>
      <button type="button" ref={active ? agreementInput : undefined} onClick={() => { setAgree((value) => !value); if (notice === 'agreement') setNotice(null) }}
        disabled={success} aria-pressed={agree} aria-describedby={invalid ? errorId : undefined} data-invalid={invalid}
        className="auth-agreement auth-secondary mx-auto flex min-h-11 items-center gap-2 text-left">
        <span className="auth-agree-mark h-4 w-4 shrink-0 rounded-full flex items-center justify-center transition-colors" aria-hidden>{agree && <I.Check className="h-3 w-3" />}</span>
        <span className="text-[12px] leading-relaxed">{t('auth.agree')}</span>
      </button>
      {invalid && <p id={errorId} className="auth-inline-error text-center" role="alert">{t('auth.feedback.agreement')}</p>}
    </div>
  }
  const anim = (name: string, delay: number, dur: number, extra = '') => (playing ? { animation: `${name} ${dur}s cubic-bezier(0.16,1,0.3,1) ${delay}s both${extra}` } : undefined)
  const langShort = LANGS.find((l) => l.code === lang)?.short ?? 'EN'

  return (
    <div ref={authRoot} className="auth-root absolute inset-0 overflow-hidden" data-tone={night ? 'night' : 'day'} onClick={() => playing && setPlaying(false)}
      onKeyDown={event => {
        if (onCancel && !sheet && event.key === 'Escape' && !event.nativeEvent.isComposing) {
          event.preventDefault()
          backFromAuth()
        }
      }}>
      {night && <DeepField />}

      {/* 界膜：两道地平线之间 */}
      <div className="absolute inset-x-0 top-[34%] pointer-events-none" aria-hidden>
        <div className="absolute inset-x-0 -top-[118px] h-[236px] origin-center" style={anim('bootVeil', 0.8, 0.7)}>
          <Veil tone={night ? 'deep' : 'light'} className="inset-0" style={{ maskImage: 'linear-gradient(to bottom, transparent, #000 22%, #000 78%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, transparent, #000 22%, #000 78%, transparent)' }} />
        </div>
        {[-118, 118].map((s) => (
          <div key={s} className="absolute inset-x-0" style={playing ? { ['--split' as string]: `${s}px`, animation: 'bootSplit 0.7s cubic-bezier(0.65,0,0.35,1) 0.8s both' } as React.CSSProperties : { transform: `translateY(${s}px)`, opacity: 0.45 }}>
            <div className="h-px w-full" style={{ background: 'linear-gradient(90deg, transparent, rgba(235,201,149,0.9) 30%, rgba(255,243,220,1) 50%, rgba(235,201,149,0.9) 70%, transparent)', boxShadow: '0 0 12px rgba(235,201,149,0.7)', ...(playing ? { animation: 'bootLine 0.55s cubic-bezier(0.65,0,0.35,1) 0.28s both' } : {}) }} />
          </div>
        ))}
        {playing && <span className="absolute left-1/2 -ml-1 -mt-1 h-2 w-2 rounded-full" style={{ background: '#fff7e6', boxShadow: '0 0 20px 6px rgba(235,201,149,0.85)', animation: 'bootPoint 0.9s ease-out both' }} />}
      </div>

      <div inert={!!sheet} className="contents">
        <button onClick={() => setSheet('lang')} aria-label={`${t('lang.title')} · ${langShort}`} aria-haspopup="dialog" aria-expanded={sheet === 'lang'} className="auth-surface absolute z-10 right-5 top-[calc(var(--app-status-height)+8px)] min-h-11 rounded-full px-3.5 inline-flex items-center gap-1.5 text-[13px]" style={anim('fade', 2.1, 0.6)}><I.Globe className="h-4 w-4" />{langShort}</button>

        {!success && (step === 'code' || onCancel) && (
          <button onClick={backFromAuth} disabled={verifyingAccount} aria-label={t(step === 'code' ? 'common.back' : 'me.switch.cancel')}
            autoFocus={!!onCancel && step === 'phone'} className="auth-surface absolute z-10 left-5 top-[calc(var(--app-status-height)+8px)] min-h-11 min-w-11 max-w-[57%] px-3 flex items-center gap-1.5 justify-center rounded-full animate-fade text-[13px]">
            <I.Back className="h-5 w-5 shrink-0" />{onCancel && step === 'phone' && t('me.switch.cancel')}
          </button>
        )}

        <div className="absolute inset-0 flex flex-col overflow-y-auto scroll-quiet pt-[calc(var(--app-status-height)+56px)]">
          {step === 'phone' && (
            <div className="auth-brand flex min-h-[148px] flex-1 shrink-0 flex-col justify-center px-5 py-4 text-center">
              {onCancel ? <>
                <h1 className="font-serif text-[34px] leading-tight">{t('me.switch')}</h1>
                <p className="auth-secondary mt-3 text-[14px]">{t('me.switch.body')}</p>
              </> : <>
                <h1 className="font-serif text-[46px] leading-none tracking-[0.34em] pl-[0.34em]" style={anim('bootMark', 1.35, 0.8)}>{t('brand.cn')}</h1>
                <div className="mt-4 text-[12px] tracking-[0.56em] pl-[0.56em]" style={anim('bootEn', 1.5, 0.9)}>{t('brand.en')}</div>
                <div className="mt-4 font-serif italic text-[17px]" style={anim('fade', 2.0, 0.6)}>{t('tagline')}</div>
              </>}
              {!embedded && <p className="auth-preview-mark" style={anim('fade', 2.0, 0.6)}>{t('auth.preview')}</p>}
            </div>
          )}

          {success && <span className="sr-only" role="status">{t('auth.feedback.success')}</span>}
          {/* 门 */}
          <div className="auth-form relative mt-auto shrink-0 px-6 pt-4 pb-8" style={anim('riseIn', 2.15, 0.7)}>
            {externalMessage && <p className="auth-feedback" role="status">{externalMessage}</p>}
            {method === 'password' && embedded ? <PasswordLogin key={embedded.password.scopeKey} service={embedded.password} purpose={embedded.purpose} dial={dial} phone={phone} onPhone={setPhone} onDial={value => setCountry(previous => ({ ...previous, dial: value }))} agreement={agreementControl()} canProceed={canProceed} onSuccess={() => finish(embedded.onPasswordComplete)} onBusyChange={value=>{passwordBusyRef.current=value;setPasswordBusy(value)}} registerBack={value=>{passwordBack.current=value}} onBack={() => { setStep('phone'); setNotice(null); onMethodChange?.('sms') }} /> : step === 'phone' ? (
              <div className="animate-fade">
                <div className="auth-phone-row relative flex items-center gap-3 h-14" data-invalid={!!phoneError}>
                  <button onClick={() => { if (!verifyingAccount) setSheet('region') }} disabled={pending === 'sms' || success || verifyingAccount} aria-label={`${t('auth.region.title')} · ${dial}`} aria-haspopup="dialog" aria-expanded={sheet === 'region'} className="flex min-h-11 shrink-0 items-center gap-1 text-[17px] active:opacity-60">{dial}<I.Chevron className="auth-secondary h-3.5 w-3.5 rotate-90" /></button>
                  <span className="auth-divider h-5 w-px" aria-hidden />
                  <input ref={phoneInput} value={phone} onChange={(e) => { setPhone(e.target.value.replace(/\D/g, '').slice(0, 14)); setNotice(null) }}
                    onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
                    onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) getCode() }}
                    readOnly={pending === 'sms' || success || verifyingAccount} inputMode="numeric" type="tel" autoComplete="tel-national"
                    aria-label={t('auth.phone.ph')} aria-invalid={!!phoneError} aria-describedby={phoneError ? phoneErrorId : undefined}
                    placeholder={t('auth.phone.ph')} className="auth-phone min-h-11 min-w-0 flex-1 bg-transparent outline-none text-[19px] tracking-[0.08em] placeholder:tracking-normal" />
                  <span className="auth-divider absolute inset-x-0 bottom-0 h-px" aria-hidden />
                  <span className="auth-field-active absolute inset-x-0 bottom-0 h-px origin-left transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]" aria-hidden style={{ transform: `scaleX(${focus || phone || phoneError ? 1 : 0})` }} />
                </div>
                {phoneError && <p id={phoneErrorId} className="auth-inline-error mt-1.5" role="alert">{phoneError}</p>}
                <button onClick={getCode} disabled={!phoneOk || !!pending || success || unavailable || retryIn > 0} aria-busy={pending === 'sms'}
                  className="auth-primary mt-4 w-full min-h-14 rounded-full px-4 py-2 text-[17px] font-semibold transition-all active:scale-[0.98]">
                  {t(success ? 'auth.feedback.success' : pending === 'sms' ? 'auth.feedback.sending' : matchingChallenge && Date.now() < matchingChallenge.expiresAt ? 'auth.code.continue' : 'auth.getCode')}
                </button>
                {onGuest && embedded?.purpose === 'sign_in'
                  ? <div className="auth-switch-row">
                    {methodButton}
                    <button type="button" disabled={!!pending || success || verifyingAccount} onClick={onGuest} className="auth-accent auth-method-link">{zh ? '本机体验' : 'Try on this device'}</button>
                  </div>
                  : methodButton}
                {agreementControl()}
                {feedback}
              </div>
            ) : (
              <div className="rise-in">
                <div className="text-center">
                  <p className="auth-brand font-serif text-[25px]">{t('auth.code.title')}</p>
                  <p className="auth-secondary mt-1 text-[13.5px]">{t('auth.code.sentTo', { dial, phone: phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone })}</p>
                </div>
                <div className="auth-code relative mt-4 grid grid-cols-6 gap-1.5" data-invalid={!!codeError}>
                  {Array.from({ length: 6 }).map((_, i) => {
                    const filled = i < code.length; const active = i === code.length && !success && !expired
                    return (
                      <span key={i} aria-hidden data-filled={filled} className="auth-surface relative h-[53px] min-w-0 rounded-2xl flex items-center justify-center font-serif text-[27px]"
                        style={{ transition: `transform .55s cubic-bezier(0.65,0,0.35,1) ${i * 0.04}s, opacity .5s ease ${0.2 + i * 0.04}s, box-shadow .3s`, transform: success && !fxPrefs.calm ? `translateX(${(2.5 - i) * 112}%) scale(0.2)` : undefined, opacity: success && !fxPrefs.calm ? 0 : 1 }}>
                        {code[i] ?? ''}
                        {active && <span className="auth-field-active absolute bottom-2 h-[2px] w-4 rounded-full fx breathe" />}
                      </span>
                    )
                  })}
                  {success && !fxPrefs.calm && <span className="absolute left-1/2 top-1/2 -ml-1.5 -mt-1.5 h-3 w-3 rounded-full pointer-events-none" style={{ background: '#fff7e6', boxShadow: '0 0 26px 10px rgba(235,201,149,0.8)', animation: 'popIn .4s cubic-bezier(0.34,1.56,0.64,1) .45s both' }} />}
                  <input ref={codeInput} value={code} onChange={(e) => onCode(e.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) verify(code) }}
                    readOnly={pending === 'sms' || success || verifyingAccount || expired} inputMode="numeric" autoComplete="one-time-code" aria-label={t('auth.code.title')}
                    aria-describedby={codeError ? codeErrorId : codeHintId} aria-invalid={!!codeError} className="absolute inset-0 h-full w-full opacity-0" />
                </div>
                {codeError && <p id={codeErrorId} className="auth-inline-error mt-1.5" role="alert">{codeError}</p>}
                <div className="auth-secondary mt-1 flex min-h-11 flex-wrap items-center justify-between gap-x-3 text-[12.5px]">
                  {(!codeError || !embedded) && <span id={codeHintId}>{embedded ? zh ? '请输入短信中的六位验证码' : 'Enter the six-digit code from your text message' : t('auth.code.hint', { code: DEMO_SMS_CODE })}</span>}
                  {Math.max(resendIn, retryIn) > 0 ? <span className="ml-auto tabular-nums">{t('auth.code.resendIn', { s: Math.max(resendIn, retryIn) })}</span> :
                    <button onClick={getCode} disabled={!!pending || success || unavailable} className="auth-accent ml-auto min-h-11 font-medium">{t(pending === 'sms' ? 'auth.feedback.sending' : 'auth.code.resend')}</button>}
                </div>
                {feedback}
                <button onClick={() => verify(code)} disabled={code.length !== 6 || !!pending || expired || success || unavailable || retryIn > 0} aria-busy={pending === 'verify'}
                  className="auth-primary mt-2 w-full min-h-[50px] rounded-full px-4 py-2 text-[16px] font-semibold transition-all active:scale-[0.98]">
                  {t(success ? 'auth.feedback.success' : pending === 'verify' ? 'auth.feedback.verifying' : 'auth.code.signIn')}
                </button>
                <div className="auth-switch-row">
                  <button onClick={backToPhone} disabled={success || verifyingAccount} className="auth-accent auth-method-link">{t('auth.code.changeNumber')}</button>
                  {methodButton}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {sheet === 'methods' && (
        <Sheet dark={night} onClose={closeMethods} title={t(provider ? 'auth.methods.provider' : 'auth.methods.choose', { provider: provider ? t(`auth.${provider}`) : '' })}>
          {!provider ? <>
            {!embedded && <p className="auth-secondary auth-provider-note">{t('auth.methods.hint')}</p>}
            <div className="auth-provider-list">
              {embedded && <button type="button" className="auth-provider-row" onClick={() => { cancelRequest(); setSheet(null); setProvider(null); onMethodChange?.('password') }}><PasswordIcon size={23} aria-hidden="true" /><span>{zh ? '密码登录' : 'Sign in with password'}</span><I.Chevron className="auth-secondary h-4 w-4" /></button>}
              {(embedded ? ['apple', 'google', 'wechat'] as const : ['apple', 'wechat'] as const).map((method) => {
                const ProviderIcon = method === 'apple' ? AppleLogo : method === 'google' ? GoogleLogo : WechatLogo
                const disabled = !!embedded && !embedded.providers[method]
                return <button key={method} type="button" className="auth-provider-row" disabled={disabled} onClick={() => { setProvider(method); setNotice(null) }}>
                  <ProviderIcon size={23} aria-hidden="true" />
                  <span>{t(`auth.${method}`)}</span>
                  {disabled ? <small className="auth-secondary text-[12px]">{zh ? '暂未开通' : 'Not available yet'}</small> : <I.Chevron className="auth-secondary h-4 w-4" />}
                </button>
              })}
            </div>
          </> : <div className="auth-provider-confirm">
            <p className="auth-secondary auth-provider-note">{embedded ? embedded.providers[provider] ? zh ? `确认后前往 ${t(`auth.${provider}`)} 授权，完成后返回西界。` : `Continue to ${t(`auth.${provider}`)} to authorize, then return to Xijie.` : zh ? `${t(`auth.${provider}`)} 登录暂未开通，请使用手机号登录。` : `${t(`auth.${provider}`)} sign-in is not available yet. Please use your phone number.` : t('auth.methods.preview', { provider: t(`auth.${provider}`) })}</p>
            {(!embedded||embedded.providers[provider]) && !agree && agreementControl(true)}
            {providerError && <p className="auth-feedback auth-feedback--error" role="alert">{providerError}</p>}
            {embedded?.providerPending&&<p role="status" className="auth-secondary auth-provider-note">{embedded.providerProgress==='unconfirmed'?zh?'授权结果尚未确认，会继续检查这一次授权，请稍后回来查看。':'Authorization is not confirmed yet. This same attempt will be checked again; return shortly.':zh?'请在原授权页面完成验证，返回后会自动继续。':'Finish verification in the original authorization screen. It will continue automatically when you return.'}</p>}
            <button ref={providerConfirm} onClick={confirmProvider} disabled={!!pending || embedded?.providerPending || !!embedded&&!embedded.providers[provider]} aria-busy={pending === 'provider'||embedded?.providerPending} className="auth-primary w-full min-h-[50px] rounded-full px-4 py-2 text-[16px] font-semibold">
              {embedded&&!embedded.providers[provider] ? zh ? '暂未开通' : 'Not available yet' : embedded?.providerPending?zh?'等待验证结果…':'Waiting for verification…':pending==='provider'?t('auth.feedback.authorizing'):providerError?t('auth.methods.retry'):embedded?zh?'继续授权':'Continue to authorize':t('auth.methods.confirm')}
            </button>
            <button onClick={closeMethods} className="auth-accent auth-method-link">{t('common.cancel')}</button>
          </div>}
        </Sheet>
      )}
      {sheet === 'region' && (
        <Sheet dark={night} onClose={() => setSheet(null)} title={t('auth.region.title')}>
          <div className="auth-options divide-y">
            {COUNTRIES.map((c) => (
              <button key={c.iso} disabled={verifyingAccount} onClick={() => { if (verifyingAccount) return; setCountry(c); if (notice === 'invalid-phone') setNotice(null); setSheet(null) }} aria-pressed={country.iso === c.iso} className="w-full flex items-center gap-3 py-3.5 text-left">
                <span className="auth-secondary w-9 shrink-0 font-mono text-[11px] tracking-[0.1em]">{c.iso}</span>
                <span className="min-w-0 flex-1 text-[15.5px]">{c.name}</span>
                <span className="auth-secondary font-mono text-[13px]">{c.dial}</span>
                <span className="auth-accent h-4 w-4 shrink-0" aria-hidden>{country.iso === c.iso && <I.Check className="h-full w-full" />}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {sheet === 'lang' && <LangSheet dark={night} onClose={() => setSheet(null)} />}
    </div>
  )
}

export function LangSheet({ dark, onClose }: { dark?: boolean; onClose: () => void }) {
  const { t } = useI18n()
  return <Sheet dark={dark} onClose={onClose} title={t('lang.title')}>
    <LanguageOptions dark={dark} onSelect={onClose} />
  </Sheet>
}

function LanguageOptions({ dark, onSelect }: { dark?: boolean; onSelect: () => void }) {
  const { lang, setLang } = useI18n()
  const zh = isZh(lang)
  return (
    <div className={`divide-y ${dark ? 'divide-white/10' : 'divide-line'}`}>
      {LANGS.map((l) => (
        <button key={l.code} disabled={l.code !== 'zh-CN' && l.code !== 'en'} onClick={() => { if (l.code === 'zh-CN' || l.code === 'en') { setLang(l.code); onSelect() } }} aria-pressed={lang === l.code} className="w-full flex items-center gap-3 py-3.5 text-left disabled:opacity-50">
          <span className="flex-1"><span className="block text-[16px]">{l.native}</span><span className={`block text-[12px] ${dark ? 'text-pearl/75' : 'text-muted'}`}>{l.code === 'zh-CN' || l.code === 'en' ? l.sub : zh ? '暂未提供，现可选择简体中文或 English' : 'Not available yet. Choose Simplified Chinese or English.'}</span></span>
          {lang === l.code && <I.Check className={`h-5 w-5 ${dark ? 'text-sun' : 'text-sky-deep'}`} />}
        </button>
      ))}
    </div>
  )
}

/* ============================== 标签栏 ============================== */
export type NavKey = 'home' | 'space' | 'atlas' | 'me'
export function BottomNav({ active, onGo, dark }: { active: NavKey; onGo: (s: NavKey) => void; dark: boolean }) {
  const { t } = useI18n()
  const items: { s: NavKey; label: string; icon: (p: { className?: string }) => React.ReactElement }[] = [
    { s: 'home', label: t('nav.meet'), icon: I.Meet },
    { s: 'space', label: t('nav.space'), icon: I.Space },
    { s: 'atlas', label: t('nav.atlas'), icon: I.Atlas },
    { s: 'me', label: t('nav.me'), icon: I.Me },
  ]
  const idx = items.findIndex((i) => i.s === active)
  return (
    <nav className={`app-bottom-nav absolute left-4 right-4 bottom-[22px] z-[60] h-[62px] rounded-[26px] flex transition-colors duration-500 ${dark ? 'glass-deep' : 'glass-light'}`}>
      <span className="absolute bottom-[7px] h-1 w-1 rounded-full bg-sun transition-[left] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]" style={{ left: `calc(${((idx + 0.5) * 100) / items.length}% - 2px)`, boxShadow: '0 0 8px rgba(235,201,149,0.95)' }} />
      {items.map((it) => {
        const on = active === it.s
        const Icon = it.icon as (p: { className?: string; weight?: 'fill' | 'duotone' }) => React.ReactElement
        return (
          <button key={it.s} onClick={() => { if (!on) { haptic(6); onGo(it.s) } }} aria-current={on ? 'page' : undefined}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${on ? (dark ? 'text-pearl' : 'text-ink') : dark ? 'text-pearl/65' : 'text-ink/55'}`}>
            <Icon className="h-[24px] w-[24px]" weight={on ? 'fill' : 'duotone'} />
            <span className="text-[11px] font-medium tracking-[0.08em]">{it.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

/* ================================ 我 ================================ */
type MePanel = 'account' | 'appearance' | 'language' | 'preferences' | 'privacy' | 'logout' | 'delete' | 'password'

export function MePage({ user, postage, vouchers, onNick, onLogout, onSwitchAccount, large, onToggleLarge, readAloud, onToggleRead, calm, onToggleCalm, haptics, onToggleHaptics, sound, onToggleSound, theme, onTheme, onGifts, onInvite, onUnavailable, serviceAccount = false, accountBusy = false, accountNotice, aiPermission, dataRights, authentication, rightsReturn, onRightsReturnConsumed }: {
  user: User; postage?: number; vouchers?: number; onNick?: (n: string) => void | boolean | Promise<void|boolean>; onLogout: () => void
  onSwitchAccount: (trigger: HTMLButtonElement | null) => void
  large: boolean; onToggleLarge: () => void; readAloud: boolean; onToggleRead: () => void; calm: boolean; onToggleCalm: () => void
  haptics: boolean; onToggleHaptics: () => void; sound: boolean; onToggleSound: () => void; theme: Theme; onTheme: (t: Theme) => void
  onGifts?: (trigger: HTMLButtonElement) => void; onInvite?: () => void
  onUnavailable?: () => void
  serviceAccount?: boolean; accountBusy?: boolean; accountNotice?: IdentityNotice | null
  aiPermission?: { sessionId: string; onUnauthorized: () => void; onChanged?: () => void }
  dataRights?: RightsContext
  authentication?: AccountAuthenticationControls
  rightsReturn?: { mode: 'export' | 'delete'; requestId: string }
  onRightsReturnConsumed?: (requestId: string) => void
}) {
  const { t, lang } = useI18n()
  const night = useContext(NightCtx)
  useStatusTone(night ? 'light' : 'dark')
  const [scrolled, setScrolled] = useState(false)
  const [panel, setPanel] = useState<MePanel | null>(null)
  const [exportOpen,setExportOpen]=useState(false)
  const exportDetails=useRef<HTMLDetailsElement>(null),returningToExport=useRef(false)
  const passwordBusy=useRef(false)
  const [nick, setNick] = useState(user.nick)
  const [nickBusy,setNickBusy]=useState(false),[nickError,setNickError]=useState('')
  const nickActive=useRef(true)
  useEffect(()=>{nickActive.current=true;return()=>{nickActive.current=false}},[])
  const [unavailableText, setUnavailableText] = useState('')
  const unavailableTimer = useRef(0)
  const panelBack = useRef<HTMLButtonElement>(null)
  const signOut = useRef<HTMLButtonElement>(null)
  const manageAccount = useRef<HTMLButtonElement>(null)
  const native = LANGS.find(item => item.code === lang)?.native ?? lang
  const zh = isZh(lang)
  const assetTitle = zh ? '资产与记录' : 'Assets and records'
  const settingsTitle = zh ? '设置' : 'Settings'
  const titles: Record<MePanel, string> = {
    account: t('me.account.manage'),
    password: zh ? '登录密码' : 'Sign-in password',
    appearance: t('me.group.look'),
    language: zh ? '语言' : 'Language',
    preferences: zh ? '易用性与声音' : 'Accessibility & sound',
    privacy: zh ? '隐私与 AI 说明' : 'Privacy & AI',
    logout: t('me.logout.title'),
    delete: zh ? '注销账号' : 'Delete account',
  }
  const phone = user.phone ?? ''
  useEffect(() => { if (rightsReturn) { setPanel(rightsReturn.mode === 'export' ? 'privacy' : 'delete');if(rightsReturn.mode==='export'){setExportOpen(true);returningToExport.current=true};onRightsReturnConsumed?.(rightsReturn.requestId) } }, [rightsReturn?.requestId])
  useEffect(()=>{if(panel==='privacy'&&exportOpen&&returningToExport.current){returningToExport.current=false;exportDetails.current?.scrollIntoView({block:'nearest'})}},[panel,exportOpen])
  const maskedPhone = phone.length >= 7 ? phone.slice(0, 3) + '****' + phone.slice(-4) : phone
  useEffect(() => () => clearTimeout(unavailableTimer.current), [])
  function unavailable() {
    if (onUnavailable) { onUnavailable(); return }
    setUnavailableText(zh ? '这项功能暂时无法使用，请稍后再试。' : 'This feature is unavailable right now. Please try again later.')
    clearTimeout(unavailableTimer.current)
    unavailableTimer.current = window.setTimeout(() => setUnavailableText(''), 2500)
  }

  function closePanel() {
    if(nickBusy)return
    if (panel === 'logout' || panel === 'delete' || panel === 'password') {
      if (accountBusy) return
      if(panel==='password'&&passwordBusy.current)return
      setPanel('account')
      requestAnimationFrame(() => signOut.current?.focus({ preventScroll: true }))
    } else setPanel(null)
  }

  return (
    <section className="me-page" aria-label={t('nav.me')}>
      <div className="me-scroll scroll-quiet" inert={!!panel} onScroll={event => setScrolled(event.currentTarget.scrollTop > 8)}>
        <header className="me-account">
          <div className="me-initial" aria-hidden>{Array.from(user.nick)[0]}</div>
          <div className="me-identity">
            <p>{zh ? '我的账号' : 'My account'}</p>
            <h1>{user.nick}</h1>
            {phone && <p>{user.dial} {maskedPhone}</p>}
          </div>
          <button ref={manageAccount} className="me-edit" aria-haspopup="dialog" onClick={() => {
            setNick(user.nick)
            setPanel('account')
          }}>{titles.account}<I.Chevron aria-hidden /></button>
        </header>

        <div className="me-assets">
          <button className="me-wallet" aria-haspopup="dialog" onClick={event => onGifts ? onGifts(event.currentTarget) : unavailable()}>
            <span className="me-wallet-title"><Wallet aria-hidden /><span>{assetTitle}</span><I.Chevron aria-hidden /></span>
            <span className="me-balances">
              <span><span>{zh ? serviceAccount?'邮资':'试用邮资' : serviceAccount?'Postage':'Trial postage'}</span><b>{postage ?? '—'}</b></span>
              <span><span>{zh ? '基础赠礼券' : 'Gift vouchers'}</span><b>{vouchers ?? '—'}</b></span>
            </span>
          </button>
          <button className="me-invite-link" aria-haspopup="dialog" onClick={onInvite ?? unavailable}>
            <UserPlus aria-hidden /><span>{zh ? '邀请与奖励' : 'Invitations & rewards'}</span><I.Chevron aria-hidden />
          </button>
        </div>

        <section className="me-settings" aria-labelledby="me-settings-heading">
          <h2 id="me-settings-heading">{settingsTitle}</h2>
          <div className="me-setting-list">
            <MeSettingRow label={titles.appearance} value={t('me.theme.' + theme)} icon={<MoonStars />} onClick={() => setPanel('appearance')} />
            <MeSettingRow label={titles.language} value={native} icon={<I.Globe />} onClick={() => setPanel('language')} />
            <MeSettingRow label={titles.preferences} icon={<I.Gear />} onClick={() => setPanel('preferences')} />
            <MeSettingRow label={titles.privacy} icon={<ShieldCheck />} onClick={() => setPanel('privacy')} />
          </div>
        </section>
      </div>

      {scrolled && <div aria-hidden className="me-status-cover" />}
      {panel && <ContextSheet className="me-settings-sheet" label={titles[panel]} onClose={closePanel}>
        <header className="me-panel-heading">
          <h2>{titles[panel]}</h2>
          <button ref={panelBack} data-context-close onClick={closePanel} aria-label={t(panel === 'logout' || panel === 'delete' ? 'common.back' : 'common.close')}>
            {panel === 'logout' || panel === 'delete' ? <I.Back /> : <I.X />}
          </button>
        </header>
        <div className="me-panel-content">
          {panel === 'account' && <>
            <form className="me-account-form" onSubmit={async event => {
              event.preventDefault()
              if (accountBusy||nickBusy) return
              if (!onNick) { unavailable(); return }
              setNickBusy(true);setNickError('')
              try{if(await onNick(nick.trim()||user.nick)===false)return;if(nickActive.current)setPanel(null)}catch(error){if(nickActive.current){if(error&&typeof error==='object'&&'pendingDisplayName'in error&&typeof error.pendingDisplayName==='string'){setNick(error.pendingDisplayName);setNickError(zh?'上次昵称是否保存还没能确认，已保留那次填写的内容，请点击「保存」重试。':'We could not confirm your previous name change. It has been restored here; select Save to retry.')}else setNickError(error&&typeof error==='object'&&'code'in error&&error.code==='VERSION_CONFLICT'?(zh?'账号资料已在另一处修改，请查看后重新保存昵称。':'Your profile changed elsewhere. Review it and save your name again.'):(zh?'还没能确认昵称是否保存，填写内容已保留，请再次点击「保存」。':'We could not confirm whether your name was saved. It is kept here; select Save again.'))}}finally{if(nickActive.current)setNickBusy(false)}
            }}>
              <label className="me-field">
                <span>{t('me.nick.ph')}</span>
                <input value={nick} maxLength={12} readOnly={accountBusy||nickBusy} onChange={event => setNick(event.currentTarget.value)} />
              </label>
              <button type="submit" disabled={accountBusy||nickBusy} className="me-primary btn-dark">{nickBusy?(zh?'正在保存…':'Saving…'):t('common.save')}</button>
              {nickError&&<p role="alert" className="me-reading">{nickError}</p>}
            </form>
            <div className="me-account-actions">
              {authentication && <button className="me-setting-row" disabled={accountBusy || nickBusy} onClick={() => setPanel('password')}><span className="me-setting-icon" aria-hidden><PasswordIcon /></span><span className="me-setting-name">{zh ? '设置或修改登录密码' : 'Set or change sign-in password'}</span><I.Chevron className="me-setting-chevron" aria-hidden /></button>}
              <button className="me-setting-row" disabled={accountBusy||nickBusy} onClick={() => {
                setPanel(null)
                onSwitchAccount(manageAccount.current)
              }}>
                <span className="me-setting-icon" aria-hidden><ArrowsLeftRight /></span>
                <span className="me-setting-name">{t('me.switch')}</span>
                <I.Chevron className="me-setting-chevron" aria-hidden />
              </button>
              <button ref={signOut} className="me-setting-row" disabled={accountBusy||nickBusy} onClick={() => {
                setPanel('logout')
                panelBack.current?.focus({ preventScroll: true })
              }}>
                <span className="me-setting-icon" aria-hidden><SignOut /></span>
                <span className="me-setting-name">{t('me.logout')}</span>
                <I.Chevron className="me-setting-chevron" aria-hidden />
              </button>
              {dataRights && <button className="me-setting-row" disabled={accountBusy||nickBusy} onClick={() => { setPanel('delete'); panelBack.current?.focus({ preventScroll: true }) }}>
                <span className="me-setting-icon" aria-hidden><ShieldCheck /></span><span className="me-setting-name">{zh ? '注销账号' : 'Delete account'}</span><I.Chevron className="me-setting-chevron" aria-hidden />
              </button>}
            </div>
          </>}
          {panel === 'password' && authentication && <PasswordSetup key={authentication.service.scopeKey} service={authentication.service} mode="manage" onBusyChange={value=>{passwordBusy.current=value}} onComplete={() => authentication.service.changed()} onBack={() => setPanel('account')} />}
          {panel === 'delete' && dataRights && <div className="me-reading"><DataRights key={dataRights.sessionId + ':delete'} context={dataRights} mode="delete" authentication={authentication} /></div>}
          {panel === 'logout' && <>
            <p className="me-reading">{serviceAccount ? zh ? '你的星图与记忆保存在当前账号中，重新登录即可回来。' : 'Your atlas and memories stay in your account. Sign back in to return.' : t('me.logout.body')}</p>
            <div className="me-confirm">
              <button className="me-secondary" disabled={accountBusy} onClick={closePanel}>{t('me.logout.cancel')}</button>
              <button className="me-primary btn-dark" disabled={accountBusy} aria-busy={accountBusy} onClick={onLogout}>{t('me.logout.confirm')}</button>
            </div>
          </>}
          {accountNotice && (panel === 'account' || panel === 'logout') && <p className="me-reading" role={accountNotice === 'cancelled' ? 'status' : 'alert'}>
            {hostedNotice(accountNotice, zh)}
          </p>}
          {panel === 'appearance' && <div className="me-theme-options" role="group" aria-label={titles.appearance}>
            {(['auto', 'day', 'night'] as const).map(value => <button key={value} aria-pressed={theme === value} onClick={() => onTheme(value)}>
              {t('me.theme.' + value)}
            </button>)}
          </div>}
          {panel === 'language' && <LanguageOptions onSelect={closePanel} />}
          {panel === 'preferences' && <div className="me-preferences">
            <section>
              <h3>{t('me.group.a11y')}</h3>
              <div>
                <Switch on={large} onToggle={onToggleLarge} label={t('me.large')} desc={t('me.large.desc')} />
                <Switch on={readAloud} onToggle={onToggleRead} label={t('me.read')} desc={t('me.read.desc')} />
                <Switch on={calm} onToggle={onToggleCalm} label={t('me.calm')} desc={t('me.calm.desc')} />
              </div>
            </section>
            <section>
              <h3>{t('me.group.sense')}</h3>
              <div>
                <Switch on={haptics} onToggle={onToggleHaptics} label={t('me.haptics')} desc={t('me.haptics.desc')} />
                <Switch on={sound} onToggle={onToggleSound} label={t('me.sound')} desc={t('me.sound.desc')} />
              </div>
            </section>
          </div>}
          {panel === 'privacy' && <div className="me-reading">
            {serviceAccount && aiPermission ? <>
              <PrivacyStatement key={aiPermission.sessionId} {...aiPermission}>
                <TextStoragePermission {...aiPermission} />
                <PersonVoiceStoragePermission {...aiPermission} />
                <GiftStoragePermission {...aiPermission} />
                <GiftReturnsPermission {...aiPermission} />
                <GiftPhotoStoragePermission {...aiPermission} />
                <LetterStoragePermission {...aiPermission} />
                <LetterRepliesPermission {...aiPermission} />
                <GatherRepliesPermission {...aiPermission} />
                <ChatPhotoStoragePermission {...aiPermission} />
                <ChatImageRepliesPermission {...aiPermission} />
                <PersonPhotoStoragePermission {...aiPermission} />
                <PhotoStoragePermission {...aiPermission} />
                <AiTextPermission {...aiPermission} />
                <WorldActionPermission {...aiPermission} />
                <StoryBranchesPermission {...aiPermission} />
                <OfflineLifePermission {...aiPermission} />
              </PrivacyStatement>
              <ReportHistoryButton />
            </> : <>
            <h3>{t('me.group.privacy')}</h3>
            <ReportHistoryButton/>
            <p>{serviceAccount
              ? zh ? '人物资料、对话、珍藏与私人动态属于当前账号。你可以分别管理文字、照片保存与 AI 文字处理授权。' : 'Character details, chats, treasured memories and private posts belong to the current account. Manage text storage, photo storage and AI processing separately.'
              : zh ? '当前版本的对话和个人记忆保存在这台设备上。邀请链接和共创礼物由你主动分享。' : 'In this version, chats and personal memories are stored on this device. You choose when to share invitation links and collaborative gifts.'}</p>
            {aiPermission && <TextStoragePermission key={aiPermission.sessionId + ':storage'} {...aiPermission} />}
            {aiPermission && <PersonVoiceStoragePermission key={aiPermission.sessionId + ':person-voice'} {...aiPermission} />}
            {aiPermission && <GiftStoragePermission key={aiPermission.sessionId + ':gifts'} {...aiPermission} />}
            {aiPermission && <GiftReturnsPermission key={aiPermission.sessionId + ':gift-returns'} {...aiPermission} />}
            {aiPermission && <GiftPhotoStoragePermission key={aiPermission.sessionId + ':gift-photos'} {...aiPermission} />}
            {aiPermission && <LetterStoragePermission key={aiPermission.sessionId + ':letter-storage'} {...aiPermission} />}
            {aiPermission && <LetterRepliesPermission key={aiPermission.sessionId + ':letter-replies'} {...aiPermission} />}
            {aiPermission && <GatherRepliesPermission key={aiPermission.sessionId + ':gather-replies'} {...aiPermission} />}
            {aiPermission && <ChatPhotoStoragePermission key={aiPermission.sessionId + ':chat-photo'} {...aiPermission} />}
            {aiPermission && <ChatImageRepliesPermission key={aiPermission.sessionId + ':chat-image-replies'} {...aiPermission} />}
            {aiPermission && <PersonPhotoStoragePermission key={aiPermission.sessionId + ':person-photos'} {...aiPermission} />}
            {aiPermission && <PhotoStoragePermission key={aiPermission.sessionId + ':photos'} {...aiPermission} />}
            <h3>{t('me.group.ai')}</h3>
            <p>{t('ai.body')}</p>
            {aiPermission && <AiTextPermission key={aiPermission.sessionId} {...aiPermission} />}
            {aiPermission && <WorldActionPermission key={aiPermission.sessionId + ':world-actions'} {...aiPermission} />}
            </>}
            {dataRights && <details ref={exportDetails} open={exportOpen} onToggle={event=>setExportOpen(event.currentTarget.open)} className="me-rights-disclosure"><summary>{zh ? '下载我的资料' : 'Download my data'}</summary><DataRights key={dataRights.sessionId + ':export'} context={dataRights} mode="export" authentication={authentication} /></details>}
            <small>{serviceAccount ? '西界 · ELYSIUM' : t('me.footer')}</small>
          </div>}
        </div>
      </ContextSheet>}
      {unavailableText && <div className="pointer-events-none absolute inset-0 z-[150]"><Toast text={unavailableText} dark={night} /></div>}
    </section>
  )
}

function MeSettingRow({ label, value, icon, onClick }: {
  label: string; value?: string; icon: React.ReactNode; onClick: () => void
}) {
  return <button className="me-setting-row" aria-haspopup="dialog" onClick={onClick}>
    <span className="me-setting-icon" aria-hidden>{icon}</span><span className="me-setting-name">{label}</span>
    {value && <span className="me-setting-value">{value}</span>}
    <I.Chevron className="me-setting-chevron" aria-hidden />
  </button>
}
