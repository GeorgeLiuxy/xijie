export type SocialProvider = 'apple' | 'google' | 'wechat'
export type AuthPurpose = 'sign_in' | 'switch' | 'reauthenticate'
export type PasswordPolicy = {
  enabled: boolean; resetEnabled: boolean
  policy: { minimumLength: number; maximumLength: number; minimumCharacterTypes: number; asciiOnly: boolean; rejectsPwned: boolean; rejectsRepetition: boolean; rejectsUserInfo: boolean }
}
export type AuthenticationMethods = { password: { canManage: boolean; phoneBound: boolean; maskedPhone: string | null }; reauthenticationMethods: { sms: boolean; social: SocialProvider[] } }
export type PasswordChallenge = { id: string; purpose: 'manage' | 'reset'; expiresAt: string; resendAt: string }
export type PasswordProgress = { id: string; purpose: PasswordChallenge['purpose']; status: 'awaiting_code' | 'verified' | 'saving' | 'unknown' | 'completed' | 'expired'; expiresAt: string }
export type AccountAuthenticationControls = { service: PasswordService; providers: Record<SocialProvider, boolean>; reauthenticate(provider: SocialProvider, signal: AbortSignal): Promise<void>; completed: number }
export type PasswordService = {
  scopeKey: string
  policy(signal: AbortSignal): Promise<PasswordPolicy>
  authentication(signal: AbortSignal): Promise<AuthenticationMethods>
  signIn(input: { dial: string; phone: string; password: string; purpose: 'sign_in' | 'switch' }, key: string, signal: AbortSignal): Promise<{ status: 'verified' }>
  challenge(input: { purpose: 'manage' } | { purpose: 'reset'; dial: string; phone: string }, key: string, signal: AbortSignal): Promise<PasswordChallenge>
  verify(id: string, code: string, key: string, signal: AbortSignal): Promise<{ status: 'verified' | 'incorrect' | 'expired' }>
  save(id: string, password: string, key: string, signal: AbortSignal): Promise<{ status: 'completed'; requiresSignIn: true }>
  status(id: string, signal: AbortSignal): Promise<PasswordProgress>
  cancel(id: string, signal: AbortSignal): Promise<void>
  changed(): Promise<void>
  refresh(): Promise<void>
}

export const authUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const provider = (value: unknown): value is SocialProvider => ['apple', 'google', 'wechat'].includes(String(value))
export function validPasswordPolicy(v: unknown): v is PasswordPolicy {
  if (!record(v) || typeof v.enabled !== 'boolean' || typeof v.resetEnabled !== 'boolean' || !record(v.policy)) return false
  const p = v.policy
  return Number.isSafeInteger(p.minimumLength) && p.minimumLength > 0 && Number.isSafeInteger(p.maximumLength) && p.maximumLength >= p.minimumLength && p.maximumLength <= 4096
    && Number.isSafeInteger(p.minimumCharacterTypes) && p.minimumCharacterTypes >= 0 && p.minimumCharacterTypes <= 4
    && ['asciiOnly', 'rejectsPwned', 'rejectsRepetition', 'rejectsUserInfo'].every(key => typeof p[key] === 'boolean')
}
export function validAuthentication(v: unknown): v is AuthenticationMethods {
  return record(v) && record(v.password) && typeof v.password.canManage === 'boolean' && typeof v.password.phoneBound === 'boolean'
    && (v.password.maskedPhone === null || typeof v.password.maskedPhone === 'string' && v.password.maskedPhone.length <= 80)
    && record(v.reauthenticationMethods) && typeof v.reauthenticationMethods.sms === 'boolean' && Array.isArray(v.reauthenticationMethods.social)
    && v.reauthenticationMethods.social.every(provider) && new Set(v.reauthenticationMethods.social).size === v.reauthenticationMethods.social.length
}
export function validChallenge(v: unknown): v is PasswordChallenge {
  return record(v) && authUuid.test(v.id) && ['manage', 'reset'].includes(v.purpose) && Number.isFinite(Date.parse(v.expiresAt)) && Number.isFinite(Date.parse(v.resendAt))
}
export function validProgress(v: unknown): v is PasswordProgress {
  return record(v) && authUuid.test(v.id) && ['manage', 'reset'].includes(v.purpose) && ['awaiting_code', 'verified', 'saving', 'unknown', 'completed', 'expired'].includes(v.status) && Number.isFinite(Date.parse(v.expiresAt))
}
export function passwordFailure(error: unknown, zh: boolean) {
  const value = error as { code?: string; status?: number; retryAfter?: number }
  if (value?.code === 'AUTH_INVALID_CREDENTIALS') return zh ? '手机号或密码不正确，请重新输入。' : 'The phone number or password is incorrect. Try again.'
  if (value?.code === 'AUTH_PHONE_NOT_BOUND') return zh ? '当前账号未绑定手机号，请使用原第三方方式登录。' : 'This account has no linked phone number. Use your original sign-in method.'
  if (value?.code === 'AUTH_PASSWORD_POLICY_REJECTED') return zh ? '这个密码未符合安全要求，请参考密码规则修改，避免常见密码和个人信息。' : 'This password does not meet the security requirements. Follow the password rules and avoid common passwords and personal information.'
  if (value?.code === 'AUTH_RESULT_UNKNOWN') return zh ? '这次操作的结果暂未确认，请保留当前页面重试。' : 'The result is not confirmed yet. Keep this page open and retry.'
  if (value?.code === 'AUTH_CHALLENGE_EXPIRED' || value?.status === 410) return zh ? '验证已过期，请重新获取验证码。' : 'Verification expired. Request a new code.'
  if (value?.code === 'AUTH_RATE_LIMITED' || value?.status === 429) return zh ? '操作太频繁，请稍后再试。' : 'Too many attempts. Try again shortly.'
  if (value?.code === 'IDENTITY_SCOPE_CHANGED' || value?.status === 401) return zh ? '登录状态已变化，请返回后重新验证。' : 'Your sign-in status changed. Go back and verify again.'
  return zh ? '账号服务暂时无法处理，请稍后重试。' : 'The account service is unavailable. Please try again.'
}
export function passwordRules(value: PasswordPolicy, zh: boolean) {
  const p = value.policy
  return zh ? `密码长度 ${p.minimumLength}–${p.maximumLength} 位${p.minimumCharacterTypes > 1 ? `，至少包含 ${p.minimumCharacterTypes} 类字符` : ''}。${p.asciiOnly ? '支持英文字母、数字和常用符号（包括空格）。' : ''}请勿使用常见密码或个人信息。`
    : `Use ${p.minimumLength}–${p.maximumLength} characters${p.minimumCharacterTypes > 1 ? ` from at least ${p.minimumCharacterTypes} character groups` : ''}. ${p.asciiOnly ? 'English letters, numbers and standard symbols, including spaces, are supported. ' : ''}Avoid common passwords and personal information.`
}
export function socialFailure(error: unknown, zh: boolean) {
  const code=(error as {code?:string})?.code
  if(code==='WECHAT_NOT_INSTALLED')return zh?'手机上还没有安装微信，请先安装，或使用手机号登录。':'WeChat is not installed. Install it or sign in with your phone number.'
  if(code==='WEBVIEW_OUTDATED')return zh?'请更新 Android System WebView 或 Chrome 后重试。':'Update Android System WebView or Chrome, then try again.'
  if(code==='AUTH_CANCELLED')return zh?'已取消这次授权，可以重新选择登录方式。':'Authorization was cancelled. You can choose a sign-in method again.'
  if(code==='AUTH_DENIED')return zh?'授权未获允许，还没有登录。可以重新授权，或使用手机号。':'Authorization was denied; you have not signed in. Try again or use your phone number.'
  if(code==='AUTH_RESTART_REQUIRED')return zh?'这次授权已无法继续，请取消后重新授权。':'This authorization cannot be continued. Cancel it and start again.'
  if(code==='AUTH_RESULT_UNKNOWN')return zh?'授权结果尚未确认，会继续检查这一次授权，请稍后回来查看。':'Authorization is not confirmed yet. This same attempt will be checked again; return shortly.'
  if(code==='WECHAT_NOT_CONFIGURED'||code==='AUTH_PROVIDER_UNAVAILABLE')return zh?'这个登录方式暂未开通，请使用手机号登录。':'This sign-in method is not available yet. Use your phone number.'
  return zh?'这次授权未能完成，请重试或使用手机号登录。':'Authorization did not complete. Try again or use your phone number.'
}
