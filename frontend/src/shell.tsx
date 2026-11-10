import { useContext, useEffect, useRef, useState } from 'react'
import { AppleLogo, ArrowsLeftRight, MoonStars, ShieldCheck, SignOut, Wallet, UserPlus, WechatLogo } from '@phosphor-icons/react'
import { useI18n, fmtClock, LANGS, COUNTRIES, isZh, type WorldId } from './i18n'
import type { Theme, User } from './model'
import { WORLDS } from './worlds'
import { DeepField, Veil } from './fx'
import { I, Sheet, Switch, haptic, chime, fxPrefs, useStatusTone, NightCtx, type BarTone } from './ui'
import { isNativeRuntime, useNativeBack } from './mobile/back'
import { ContextSheet } from './mobile/ContextSheet'
import { authorizeDemoProvider, DEMO_SMS_CODE, requestDemoSms, verifyDemoSms, type PreviewProvider, type SmsChallenge } from './auth/preview'
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
export function AuthFlow({ intro, onDone, onCancel }: { intro: boolean; onDone: (u: User) => void; onCancel?: () => void }) {
  const { t, lang } = useI18n()
  const night = useContext(NightCtx)
  useStatusTone(night ? 'light' : 'dark')
  const [playing, setPlaying] = useState(intro && !fxPrefs.calm)
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [country, setCountry] = useState(() => COUNTRIES.find(c => c.iso === (lang === 'en' ? 'US' : 'CN')) ?? COUNTRIES[0])
  const { dial } = country
  const [phone, setPhone] = useState('')
  const [agree, setAgree] = useState(false)
  const [hint, setHint] = useState(0)
  const [code, setCode] = useState('')
  const [challenge, setChallenge] = useState<SmsChallenge | null>(null)
  const [now, setNow] = useState(Date.now)
  const [focus, setFocus] = useState(false)
  const [sheet, setSheet] = useState<null | 'region' | 'lang' | 'methods'>(null)
  const [provider, setProvider] = useState<PreviewProvider | null>(null)
  const [success, setSuccess] = useState(false)
  const [notice, setNotice] = useState<'agreement' | 'unavailable' | 'incorrect' | 'expired' | 'canceled' | null>(null)
  const [providerError, setProviderError] = useState(false)
  const [pending, setPending] = useState<'sms' | 'verify' | 'provider' | null>(null)
  const activeRequest = useRef<AbortController | null>(null)
  const finishTimer = useRef(0)
  const finishing = useRef(false)
  const authRoot = useRef<HTMLDivElement>(null)
  const codeInput = useRef<HTMLInputElement>(null)
  const providerConfirm = useRef<HTMLButtonElement>(null)
  const matchingChallenge = challenge?.dial === dial && challenge.phone === phone ? challenge : null
  const resendIn = matchingChallenge ? Math.max(0, Math.ceil((matchingChallenge.resendAt - now) / 1000)) : 0
  const expired = !!matchingChallenge && now >= matchingChallenge.expiresAt
  useEffect(() => { if (!playing) return; const id = window.setTimeout(() => setPlaying(false), 2700); return () => clearTimeout(id) }, [playing])
  useEffect(() => () => {
    activeRequest.current?.abort()
    clearTimeout(finishTimer.current)
  }, [])
  useEffect(() => {
    if (step !== 'code' || !matchingChallenge) return
    const updateTime = () => setNow(Date.now())
    updateTime()
    const id = window.setInterval(updateTime, 1000)
    document.addEventListener('visibilitychange', updateTime)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', updateTime)
    }
  }, [step, matchingChallenge])
  useEffect(() => {
    if (step === 'code') codeInput.current?.focus({ preventScroll: true })
  }, [step])
  useEffect(() => {
    if (provider) providerConfirm.current?.focus({ preventScroll: true })
  }, [provider])

  function cancelRequest() {
    activeRequest.current?.abort()
    activeRequest.current = null
    setPending(null)
  }

  async function runPreview<T>(
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
    } catch {
      if (!controller.signal.aborted) {
        if (action === 'provider') setProviderError(true)
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
    if (finishing.current) return
    cancelRequest()
    codeInput.current?.blur()
    setStep('phone')
    setNotice(null)
  }
  function backFromAuth() {
    if (finishing.current) return
    if (step === 'code') backToPhone()
    else onCancel?.()
  }
  useNativeBack(() => { backFromAuth(); return true }, !!onCancel || step === 'code' && !success, 20, authRoot)

  const phoneOk = phone.length >= 6
  function canProceed() {
    if (agree) return true
    setNotice('agreement')
    setHint((h) => h + 1)
    haptic(24)
    return false
  }

  function getCode() {
    if (!phoneOk || !canProceed()) return
    if (step === 'phone' && matchingChallenge && Date.now() < matchingChallenge.expiresAt) {
      setStep('code')
      setNotice(null)
      return
    }
    if (matchingChallenge && Date.now() < matchingChallenge.resendAt) return
    void runPreview('sms', (signal) => requestDemoSms(dial, phone, signal), (value) => {
      setChallenge(value)
      setNow(Date.now())
      setCode('')
      setStep('code')
      haptic(8)
    })
  }

  function finish(user: User) {
    if (finishing.current) return
    finishing.current = true
    codeInput.current?.blur()
    setSuccess(true)
    haptic([10, 40, 20])
    chime('connect')
    finishTimer.current = window.setTimeout(() => onDone(user), fxPrefs.calm ? 150 : 820)
  }

  function verify(codeToVerify: string) {
    if (codeToVerify.length !== 6 || !matchingChallenge) return
    void runPreview('verify', (signal) => verifyDemoSms(matchingChallenge, codeToVerify, signal), (result) => {
      if (result.status === 'verified') {
        finish({ ...result.identity, nick: t('auth.nick.default') })
      } else {
        setNotice(result.status)
        haptic(24)
      }
    })
  }

  function onCode(value: string) {
    if (finishing.current) return
    const next = value.replace(/\D/g, '').slice(0, 6)
    if (pending === 'verify') cancelRequest()
    setCode(next)
    setNotice(null)
    if (next.length > code.length) haptic(4)
    if (next.length === 6) verify(next)
  }

  function openMethods() {
    if (finishing.current) return
    cancelRequest()
    codeInput.current?.blur()
    setProvider(null)
    setProviderError(false)
    setNotice(null)
    setSheet('methods')
  }

  function closeMethods() {
    if (finishing.current) return
    cancelRequest()
    if (provider) setNotice('canceled')
    setSheet(null)
    setProvider(null)
    setProviderError(false)
  }

  function confirmProvider() {
    if (!provider || !canProceed()) return
    void runPreview('provider', (signal) => authorizeDemoProvider(provider, signal), (identity) => {
      setSheet(null)
      finish({ phone: '', dial: '', nick: t(`auth.nick.${provider}`), ...identity })
    })
  }

  const noticeText = notice ? t(`auth.feedback.${notice}`) : expired && step === 'code' ? t('auth.feedback.expired') : ''
  const isAlert = !!noticeText && notice !== 'canceled'
  const invalidCode = notice === 'incorrect' || notice === 'expired' || expired
  const feedback = noticeText && <p className={isAlert ? 'auth-feedback auth-feedback--error' : 'auth-feedback'} role={isAlert ? 'alert' : 'status'}>{noticeText}</p>
  const methodButton = <button onClick={openMethods} disabled={success} aria-haspopup="dialog" aria-expanded={sheet === 'methods'} className="auth-accent auth-method-link">
    {t('auth.methods.other')} <I.Chevron className="h-3.5 w-3.5" />
  </button>
  const agreementButton = <button key={hint} onClick={() => { setAgree((value) => !value); setNotice(null) }} disabled={success} aria-pressed={agree}
    className={`auth-secondary mx-auto flex min-h-11 items-center gap-2 text-left ${hint && !agree ? 'glow-hint' : ''}`}>
    <span className="auth-agree-mark h-4 w-4 shrink-0 rounded-full flex items-center justify-center transition-colors" aria-hidden>{agree && <I.Check className="h-3 w-3" />}</span>
    <span className="text-[12px] leading-relaxed">{t('auth.agree')}</span>
  </button>
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
          <button onClick={backFromAuth} aria-label={t(step === 'code' ? 'common.back' : 'me.switch.cancel')}
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
              <p className="auth-preview-mark" style={anim('fade', 2.0, 0.6)}>{t('auth.preview')}</p>
            </div>
          )}

          {success && <span className="sr-only" role="status">{t('auth.feedback.success')}</span>}
          {/* 门 */}
          <div className="auth-form relative mt-auto shrink-0 px-6 pt-4 pb-8" style={anim('riseIn', 2.15, 0.7)}>
            {step === 'phone' ? (
              <div className="animate-fade">
                <div className="relative flex items-center gap-3 h-14">
                  <button onClick={() => setSheet('region')} disabled={pending === 'sms' || success} aria-label={`${t('auth.region.title')} · ${dial}`} aria-haspopup="dialog" aria-expanded={sheet === 'region'} className="flex min-h-11 shrink-0 items-center gap-1 text-[17px] active:opacity-60">{dial}<I.Chevron className="auth-secondary h-3.5 w-3.5 rotate-90" /></button>
                  <span className="auth-divider h-5 w-px" aria-hidden />
                  <input value={phone} onChange={(e) => { setPhone(e.target.value.replace(/\D/g, '').slice(0, 14)); setNotice(null) }}
                    onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
                    onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) getCode() }}
                    readOnly={pending === 'sms' || success} inputMode="numeric" type="tel" autoComplete="tel-national"
                    aria-label={t('auth.phone.ph')} placeholder={t('auth.phone.ph')} className="auth-phone min-h-11 min-w-0 flex-1 bg-transparent outline-none text-[19px] tracking-[0.08em] placeholder:tracking-normal" />
                  <span className="auth-divider absolute inset-x-0 bottom-0 h-px" aria-hidden />
                  <span className="auth-field-active absolute inset-x-0 bottom-0 h-px origin-left transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]" aria-hidden style={{ transform: `scaleX(${focus || phone ? 1 : 0})` }} />
                </div>
                <button onClick={getCode} disabled={!phoneOk || !!pending || success} aria-busy={pending === 'sms'}
                  className="auth-primary mt-4 w-full min-h-14 rounded-full px-4 py-2 text-[17px] font-semibold transition-all active:scale-[0.98]">
                  {t(success ? 'auth.feedback.success' : pending === 'sms' ? 'auth.feedback.sending' : matchingChallenge && Date.now() < matchingChallenge.expiresAt ? 'auth.code.continue' : 'auth.getCode')}
                </button>
                {methodButton}
                {agreementButton}
                {feedback}
              </div>
            ) : (
              <div className="rise-in">
                <div className="text-center">
                  <p className="auth-brand font-serif text-[25px]">{t('auth.code.title')}</p>
                  <p className="auth-secondary mt-1 text-[13.5px]">{t('auth.code.sentTo', { dial, phone: phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone })}</p>
                </div>
                <div className="auth-code relative mt-4 grid grid-cols-6 gap-1.5" data-invalid={invalidCode}>
                  {Array.from({ length: 6 }).map((_, i) => {
                    const filled = i < code.length; const active = i === code.length && !success
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
                    readOnly={pending === 'sms' || success} inputMode="numeric" autoComplete="one-time-code" aria-label={t('auth.code.title')}
                    aria-describedby="auth-code-preview" aria-invalid={invalidCode} className="absolute inset-0 h-full w-full opacity-0" />
                </div>
                <div className="auth-secondary mt-1 flex min-h-11 flex-wrap items-center justify-between gap-x-3 text-[12.5px]">
                  <span id="auth-code-preview">{t('auth.code.hint', { code: DEMO_SMS_CODE })}</span>
                  {resendIn > 0 ? <span className="tabular-nums">{t('auth.code.resendIn', { s: resendIn })}</span> :
                    <button onClick={getCode} disabled={!!pending || success} className="auth-accent min-h-11 font-medium">{t(pending === 'sms' ? 'auth.feedback.sending' : 'auth.code.resend')}</button>}
                </div>
                {feedback}
                <button onClick={() => verify(code)} disabled={code.length !== 6 || !!pending || expired || success} aria-busy={pending === 'verify'}
                  className="auth-primary mt-2 w-full min-h-[50px] rounded-full px-4 py-2 text-[16px] font-semibold transition-all active:scale-[0.98]">
                  {t(success ? 'auth.feedback.success' : pending === 'verify' ? 'auth.feedback.verifying' : 'auth.code.signIn')}
                </button>
                <div className="auth-switch-row">
                  <button onClick={backToPhone} disabled={success} className="auth-accent auth-method-link">{t('auth.code.changeNumber')}</button>
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
            <p className="auth-secondary auth-provider-note">{t('auth.methods.hint')}</p>
            <div className="auth-provider-list">
              {(['apple', 'wechat'] as const).map((method) => {
                const ProviderIcon = method === 'apple' ? AppleLogo : WechatLogo
                return <button key={method} className="auth-provider-row" onClick={() => { setProvider(method); setNotice(null) }}>
                  <ProviderIcon size={23} aria-hidden="true" />
                  <span>{t(`auth.${method}`)}</span>
                  <I.Chevron className="auth-secondary h-4 w-4" />
                </button>
              })}
            </div>
          </> : <div className="auth-provider-confirm">
            <p className="auth-secondary auth-provider-note">{t('auth.methods.preview', { provider: t(`auth.${provider}`) })}</p>
            {!agree && agreementButton}
            {notice === 'agreement' && feedback}
            {providerError && <p className="auth-feedback auth-feedback--error" role="alert">{t('auth.feedback.unavailable')}</p>}
            <button ref={providerConfirm} onClick={confirmProvider} disabled={pending === 'provider'} aria-busy={pending === 'provider'} className="auth-primary w-full min-h-[50px] rounded-full px-4 py-2 text-[16px] font-semibold">
              {t(pending === 'provider' ? 'auth.feedback.authorizing' : providerError ? 'auth.methods.retry' : 'auth.methods.confirm')}
            </button>
            <button onClick={closeMethods} className="auth-accent auth-method-link">{t('common.cancel')}</button>
          </div>}
        </Sheet>
      )}
      {sheet === 'region' && (
        <Sheet dark={night} onClose={() => setSheet(null)} title={t('auth.region.title')}>
          <div className="auth-options divide-y">
            {COUNTRIES.map((c) => (
              <button key={c.iso} onClick={() => { setCountry(c); setSheet(null) }} aria-pressed={country.iso === c.iso} className="w-full flex items-center gap-3 py-3.5 text-left">
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
  return (
    <div className={`divide-y ${dark ? 'divide-white/10' : 'divide-line'}`}>
      {LANGS.map((l) => (
        <button key={l.code} onClick={() => { setLang(l.code); onSelect() }} aria-pressed={lang === l.code} className="w-full flex items-center gap-3 py-3.5 text-left">
          <span className="flex-1"><span className="block text-[16px]">{l.native}</span><span className={`block text-[12px] ${dark ? 'text-pearl/75' : 'text-muted'}`}>{l.sub}</span></span>
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
type MePanel = 'account' | 'appearance' | 'language' | 'preferences' | 'privacy' | 'logout'

export function MePage({ user, postage, vouchers, onNick, onLogout, onSwitchAccount, large, onToggleLarge, readAloud, onToggleRead, calm, onToggleCalm, haptics, onToggleHaptics, sound, onToggleSound, theme, onTheme, onGifts, onInvite }: {
  user: User; postage: number; vouchers: number; onNick: (n: string) => void; onLogout: () => void
  onSwitchAccount: (trigger: HTMLButtonElement | null) => void
  large: boolean; onToggleLarge: () => void; readAloud: boolean; onToggleRead: () => void; calm: boolean; onToggleCalm: () => void
  haptics: boolean; onToggleHaptics: () => void; sound: boolean; onToggleSound: () => void; theme: Theme; onTheme: (t: Theme) => void
  onGifts: (trigger: HTMLButtonElement) => void; onInvite: () => void
}) {
  const { t, lang } = useI18n()
  const night = useContext(NightCtx)
  useStatusTone(night ? 'light' : 'dark')
  const [scrolled, setScrolled] = useState(false)
  const [panel, setPanel] = useState<MePanel | null>(null)
  const [nick, setNick] = useState(user.nick)
  const panelBack = useRef<HTMLButtonElement>(null)
  const signOut = useRef<HTMLButtonElement>(null)
  const manageAccount = useRef<HTMLButtonElement>(null)
  const native = LANGS.find(item => item.code === lang)?.native ?? lang
  const zh = isZh(lang)
  const assetTitle = zh ? '资产与记录' : 'Assets and records'
  const settingsTitle = zh ? '设置' : 'Settings'
  const titles: Record<MePanel, string> = {
    account: t('me.account.manage'),
    appearance: t('me.group.look'),
    language: zh ? '语言' : 'Language',
    preferences: zh ? '易用性与声音' : 'Accessibility & sound',
    privacy: zh ? '隐私与 AI 说明' : 'Privacy & AI',
    logout: t('me.logout.title'),
  }
  const phone = user.phone ?? ''
  const maskedPhone = phone.length >= 7 ? phone.slice(0, 3) + '****' + phone.slice(-4) : phone

  function closePanel() {
    if (panel === 'logout') {
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
          <button className="me-wallet" aria-haspopup="dialog" onClick={event => onGifts(event.currentTarget)}>
            <span className="me-wallet-title"><Wallet aria-hidden /><span>{assetTitle}</span><I.Chevron aria-hidden /></span>
            <span className="me-balances">
              <span><span>{zh ? '试用邮资' : 'Trial postage'}</span><b>{postage}</b></span>
              <span><span>{zh ? '基础赠礼券' : 'Gift vouchers'}</span><b>{vouchers}</b></span>
            </span>
          </button>
          <button className="me-invite-link" aria-haspopup="dialog" onClick={onInvite}>
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
          <button ref={panelBack} data-context-close onClick={closePanel} aria-label={t(panel === 'logout' ? 'common.back' : 'common.close')}>
            {panel === 'logout' ? <I.Back /> : <I.X />}
          </button>
        </header>
        <div className="me-panel-content">
          {panel === 'account' && <>
            <form className="me-account-form" onSubmit={event => {
              event.preventDefault()
              onNick(nick.trim() || user.nick)
              setPanel(null)
            }}>
              <label className="me-field">
                <span>{t('me.nick.ph')}</span>
                <input value={nick} maxLength={12} onChange={event => setNick(event.currentTarget.value)} />
              </label>
              <button type="submit" className="me-primary btn-dark">{t('common.save')}</button>
            </form>
            <div className="me-account-actions">
              <button className="me-setting-row" onClick={() => {
                setPanel(null)
                onSwitchAccount(manageAccount.current)
              }}>
                <span className="me-setting-icon" aria-hidden><ArrowsLeftRight /></span>
                <span className="me-setting-name">{t('me.switch')}</span>
                <I.Chevron className="me-setting-chevron" aria-hidden />
              </button>
              <button ref={signOut} className="me-setting-row" onClick={() => {
                setPanel('logout')
                panelBack.current?.focus({ preventScroll: true })
              }}>
                <span className="me-setting-icon" aria-hidden><SignOut /></span>
                <span className="me-setting-name">{t('me.logout')}</span>
                <I.Chevron className="me-setting-chevron" aria-hidden />
              </button>
            </div>
          </>}
          {panel === 'logout' && <>
            <p className="me-reading">{t('me.logout.body')}</p>
            <div className="me-confirm">
              <button className="me-secondary" onClick={closePanel}>{t('me.logout.cancel')}</button>
              <button className="me-primary btn-dark" onClick={onLogout}>{t('me.logout.confirm')}</button>
            </div>
          </>}
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
            <h3>{t('me.group.privacy')}</h3>
            <p>{zh ? '当前版本的对话和个人记忆保存在这台设备上。邀请链接和共创礼物由你主动分享。' : 'In this version, chats and personal memories are stored on this device. You choose when to share invitation links and collaborative gifts.'}</p>
            <h3>{t('me.group.ai')}</h3>
            <p>{t('ai.body')}</p>
            <small>{t('me.footer')}</small>
          </div>}
        </div>
      </ContextSheet>}
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
