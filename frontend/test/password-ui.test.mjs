import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'
const compile = async name => ts.transpileModule(await readFile(new URL('../src/auth/' + name, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React } }).outputText
const [code, policyCode] = await Promise.all([compile('PasswordSetup.tsx'), compile('password.ts')])
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)) }
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve } }
const all = n => n && typeof n === 'object' ? [n, ...(n.props?.children ?? []).flat(Infinity).flatMap(all)] : []
const text = n => typeof n === 'string' ? n : n && typeof n === 'object' ? (n.props?.children ?? []).flat(Infinity).map(text).join('') : ''
const policy = () => ({ enabled: true, resetEnabled: true, policy: { minimumLength: 8, maximumLength: 256, minimumCharacterTypes: 1, asciiOnly: true, rejectsPwned: true, rejectsRepetition: true, rejectsUserInfo: true } })
const failure = code => Object.assign(Error('Controlled error'), { code })
function service(overrides = {}) {
  const calls = [], challenge = { id: randomUUID(), purpose: 'manage', expiresAt: '2099-01-01T00:00:00Z', resendAt: '2000-01-01T00:00:00Z' }
  return { calls, challengeValue: challenge, scopeKey: 'owner/session', policy: async () => policy(), authentication: async () => ({ password: { canManage: true, phoneBound: true, maskedPhone: '+86 138****0000' }, reauthenticationMethods: { sms: true, social: [] } }),
    challenge: async (input, key) => { calls.push({ action: 'challenge', input, key }); return { ...challenge, purpose: input.purpose } },
    verify: async (id, code, key) => { calls.push({ action: 'verify', id, code, key }); return { status: 'verified' } },
    save: async (id, password, key) => { calls.push({ action: 'save', id, password, key }); return { status: 'completed', requiresSignIn: true } },
    status: async () => ({ ...challenge, status: 'unknown' }), cancel: async id => calls.push({ action: 'cancel', id }), changed: async () => {}, refresh: async () => {},
    signIn: async (input, key) => { calls.push({ action: 'signIn', input, key }); return { status: 'verified' } }, ...overrides }
}
async function harness(name, props, lang = 'zh-CN') {
  let si = 0, ri = 0, ei = 0, ii = 0, tree
  const states = [], refs = [], effects = [], queued = []
  const focused = []
  const context = vm.createContext({ React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) }, AbortController, Date, crypto: { randomUUID }, window: { setInterval: () => 1, clearInterval() {} } })
  const synthetic = values => new vm.SyntheticModule(Object.keys(values), function () { for (const [k, v] of Object.entries(values)) this.setExport(k, v) }, { context })
  const react = synthetic({ useId() { return `test-${ii++}` }, useState(v) { const i = si++; if (!(i in states)) states[i] = typeof v === 'function' ? v() : v; return [states[i], v => states[i] = typeof v === 'function' ? v(states[i]) : v] }, useRef(v) { const i = ri++; return refs[i] ?? (refs[i] = { current: v }) }, useEffect(fn, deps) { const i = ei++, old = effects[i]; if (!old || deps.some((v, j) => v !== old.deps[j])) queued.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: fn() } }) } })
  const policyModule = new vm.SourceTextModule(policyCode, { context }); await policyModule.link(() => assert.fail('Unexpected policy import')); await policyModule.evaluate()
  const mod = new vm.SourceTextModule(code, { context })
  await mod.link(n => n === 'react' ? react : n === '@phosphor-icons/react' ? synthetic({ Eye: 'Eye', EyeSlash: 'EyeSlash' }) : n === '../i18n' ? synthetic({ useI18n: () => ({ lang }), isZh: () => lang !== 'en' }) : n === './password' ? policyModule : assert.fail('Unexpected import ' + n))
  await mod.evaluate()
  const render = next => {
    if (next) props = next
    si = ri = ei = ii = 0
    tree = mod.namespace[name](props)
    const form = all(tree).find(n => n.type === 'form')
    if (form?.props.ref) form.props.ref.current = { querySelector: selector => ({ focus: () => focused.push(selector) }) }
    while (queued.length) queued.shift()()
    return tree
  }
  const api = {
    render, focused,
    get tree() { return render() }, get text() { return text(render()) },
    button(label) { const n = all(render()).find(n => n.type === 'button' && (n.props['aria-label'] ?? text(n)) === label); assert(n, 'Missing button ' + label); return n },
    field(label) {
      const nodes = all(render()), associated = nodes.find(n => n.type === 'label' && text(n) === label)
      const n = nodes.find(n => n.type === 'input' && n.props.id === associated?.props.htmlFor)
      assert(n, 'Missing input ' + label)
      return n
    },
    input(label, value) { const n = this.field(label); n.props.onChange({ currentTarget: { value } }); render(); return n },
    async submit() { const form = all(render()).find(n => n.type === 'form'); assert(form); form.props.onSubmit({ preventDefault() {} }); await settle(); render() },
    unmount() { effects.forEach(e => e?.cleanup?.()) },
  }
  render(); await settle(); render(); return api
}
async function verified(h) { h.button('获取验证码').props.onClick?.(); await h.submit(); h.input('验证码', '123456'); await h.submit() }

test('password management uses the original masked phone, verifies before accepting a new password, and never sends confirmation', async () => {
  let completed = 0; const s = service(), h = await harness('PasswordSetup', { service: s, mode: 'manage', onBack() {}, onComplete() { completed++ } })
  assert.match(h.text, /138\*\*\*\*0000/); assert(!all(h.tree).some(n => n.type === 'input'))
  await verified(h); assert.deepEqual(JSON.parse(JSON.stringify(s.calls[0].input)), { purpose: 'manage' }); assert.equal(s.calls.filter(c => c.action === 'save').length, 0)
  assert.equal(h.field('新密码').props.type, 'password')
  h.button('显示新密码').props.onClick()
  assert.equal(h.field('新密码').props.type, 'text')
  assert.equal(h.field('确认新密码').props.type, 'password')
  h.input('新密码', '  safe-new-12!  '); h.input('确认新密码', 'different'); await h.submit(); assert.match(h.text, /不一致/); assert.equal(completed, 0)
  assert.equal(h.field('确认新密码').props['aria-invalid'], true)
  assert.equal(h.field('新密码').props['aria-invalid'], undefined)
  assert.equal(h.focused.at(-1), `[id="${h.field('确认新密码').props.id}"]`)
  h.input('确认新密码', '  safe-new-12!  '); await h.submit()
  const saved = s.calls.find(c => c.action === 'save'); assert.equal(saved.password, '  safe-new-12!  '); assert.equal(completed, 1); assert(!all(h.tree).some(n => n.type === 'input' && n.props.value === saved.password)); h.unmount()
})

test('an unknown password save stays unconfirmed and retries the same new password and write key', async () => {
  let completed = 0, attempts = 0; const saved = [], s = service({ save: async (id, password, key) => { saved.push({ id, password, key }); if (++attempts === 1) throw failure('AUTH_RESULT_UNKNOWN'); return { status: 'completed', requiresSignIn: true } } }), h = await harness('PasswordSetup', { service: s, mode: 'manage', onBack() {}, onComplete() { completed++ } })
  await verified(h); h.input('新密码', 'safe-password-12!'); h.input('确认新密码', 'safe-password-12!')
  h.button('显示新密码').props.onClick(); h.button('显示确认的新密码').props.onClick(); await h.submit()
  assert.equal(completed, 0); assert.match(h.text, /还没能确认/); assert(all(h.tree).filter(n => n.type === 'input' && n.props.autoComplete === 'new-password').every(n => n.props.readOnly && n.props.type === 'password'))
  await h.button('查看保存结果').props.onClick(); await settle(); assert.equal(completed, 0)
  await h.submit(); assert.deepEqual(saved[0], saved[1]); assert.equal(completed, 1); h.unmount()
})

test('a confirmed policy rejection unlocks correction with a new key instead of trapping an unknown save', async () => {
  const saves = []; let completed = 0; const s = service({ save: async (id, password, key) => { saves.push({ id, password, key }); if (saves.length === 1) throw failure('AUTH_PASSWORD_POLICY_REJECTED'); return { status: 'completed', requiresSignIn: true } } }), h = await harness('PasswordSetup', { service: s, mode: 'manage', onBack() {}, onComplete() { completed++ } })
  await verified(h); h.input('新密码', 'common-pass-12'); h.input('确认新密码', 'common-pass-12'); await h.submit(); assert.equal(completed, 0); assert.match(h.text, /安全要求/)
  h.input('新密码', 'another-password-92!'); h.input('确认新密码', 'another-password-92!'); await h.submit(); assert.notEqual(saves[0].key, saves[1].key); assert.equal(completed, 1); h.unmount()
})

test('a third-party-only account has an honest no-phone result and cannot start a password challenge', async () => {
  const s = service({ authentication: async () => ({ password: { canManage: false, phoneBound: false, maskedPhone: null }, reauthenticationMethods: { sms: false, social: ['google'] } }) }), h = await harness('PasswordSetup', { service: s, mode: 'manage', onBack() {}, onComplete() { assert.fail('No password was saved') } })
  assert.match(h.text, /当前账号未绑定手机号/); assert(!all(h.tree).some(n => n.type === 'button' && text(n) === '获取验证码')); assert.equal(s.calls.length, 0); h.unmount()
})

test('reset is a separate SMS challenge and success does not create or sign in an account', async () => {
  let done = 0, signin = 0; const s = service({ signIn: async () => { signin++; assert.fail('Reset must never sign in') } }), h = await harness('PasswordSetup', { service: s, mode: 'reset', initial: { dial: '+86', phone: '13800000000' }, onBack() {}, onComplete() { done++ } })
  await verified(h); assert.deepEqual(JSON.parse(JSON.stringify(s.calls[0].input)), { purpose: 'reset', dial: '+86', phone: '13800000000' })
  h.input('新密码', 'new-password-42!'); h.input('确认新密码', 'new-password-42!'); await h.submit(); assert.equal(done, 1); assert.equal(signin, 0); h.unmount()
})

test('reset shows phone and OTP errors by their fields and offers a fresh code after definitive expiry', async () => {
  let calls = 0
  const s = service({ verify: async () => {
    if (calls++ === 0) return { status: 'incorrect' }
    throw Object.assign(failure('AUTH_CHALLENGE_EXPIRED'), { status: 410 })
  } })
  const h = await harness('PasswordSetup', { service: s, mode: 'reset', onBack() {}, onComplete() { assert.fail('No code was verified') } })
  await h.submit()
  assert.equal(h.field('手机号').props['aria-invalid'], true)
  assert.match(h.text, /请输入手机号/)
  assert.equal(s.calls.length, 0)
  h.input('手机号', '13800000000')
  await h.submit()
  h.input('验证码', '23')
  await h.submit()
  assert.equal(calls, 0)
  assert.equal(h.field('验证码').props['aria-invalid'], true)
  h.input('验证码', '123456')
  await h.submit()
  assert.match(h.text, /验证码不正确/)
  assert.equal(h.field('验证码').props['aria-invalid'], true)
  h.input('验证码', '123457')
  await h.submit()
  assert.match(text(all(h.tree).find(n => n.props.role === 'status')), /验证码已过期/)
  assert.equal(h.field('手机号').props.value, '13800000000')
  await h.submit()
  const challenges = s.calls.filter(call => call.action === 'challenge')
  assert.equal(challenges.length, 2)
  assert.notEqual(challenges[0].key, challenges[1].key)
  assert.equal(h.field('验证码').props.value, '')
  h.unmount()
})

test('a late password challenge after close does not expose a code form or report success', async () => {
  const gate = deferred(); let completed = 0; const s = service({ challenge: () => gate.promise }), h = await harness('PasswordSetup', { service: s, mode: 'manage', onBack() {}, onComplete() { completed++ } })
  const form = all(h.tree).find(n => n.type === 'form'); form.props.onSubmit({ preventDefault() {} }); h.unmount(); gate.resolve(s.challengeValue); await settle(); assert.equal(completed, 0); assert(!h.text.includes('短信中的六位')); assert.equal(s.calls.length, 0)
})

test('password sign-in waits for the real result, keeps one unknown retry identity, and clears secrets after success', async () => {
  let completed = 0, attempts = 0; const calls = [], s = service({ signIn: async (input, key) => { calls.push({ input, key }); if (++attempts === 1) throw failure('AUTH_RESULT_UNKNOWN'); return { status: 'verified' } } }), props = { service: s, purpose: 'sign_in', dial: '+86', phone: '13800000000', onDial() {}, onPhone() {}, agreement: null, canProceed: () => true, onSuccess() { completed++ }, onBack() {} }, h = await harness('PasswordLogin', props)
  h.input('密码', ' unchanged password! '); await h.submit(); assert.equal(completed, 0)
  await h.submit(); assert.equal(completed, 1); assert.deepEqual(calls[0], calls[1]); assert.equal(calls[0].input.password, ' unchanged password! '); assert(all(h.tree).filter(n => n.type === 'input' && n.props.autoComplete === 'current-password').every(n => n.props.value === '')); h.unmount()
})

test('password login keeps the value, attaches invalid credential feedback to the password, and leaves access errors at form level', async () => {
  let attempts = 0
  const s = service({ signIn: async () => {
    if (attempts++ === 0) throw failure('AUTH_INVALID_CREDENTIALS')
    throw Object.assign(failure('FORBIDDEN'), { status: 403 })
  } })
  const h = await harness('PasswordLogin', { service: s, purpose: 'sign_in', dial: '+86', phone: '13800000000', onDial() {}, onPhone() {}, agreement: null, canProceed: () => true, onSuccess() {}, onBack() {} })
  await h.submit()
  assert.match(h.text, /请输入密码/)
  assert.equal(attempts, 0)
  h.input('密码', 'mistyped-password')
  const show = h.button('显示密码')
  assert.equal(text(show), '')
  assert.equal(show.props['aria-controls'], h.field('密码').props.id)
  show.props.onClick()
  assert.equal(h.field('密码').props.type, 'text')
  h.button('隐藏密码').props.onClick()
  assert.equal(h.field('密码').props.type, 'password')
  h.button('显示密码').props.onClick()
  await h.submit()
  const password = h.field('密码').props
  const error = all(h.tree).find(n => n.props.role === 'alert')
  assert.equal(password['aria-invalid'], true)
  assert.equal(password['aria-describedby'], error.props.id)
  assert.match(text(error), /手机号或密码不正确/)
  assert.equal(h.field('手机号').props['aria-invalid'], undefined)
  assert.equal(password.value, 'mistyped-password')
  assert.equal(password.type, 'password')
  assert.equal(h.focused.at(-1), `[id="${password.id}"]`)
  h.input('密码', 'retry-password')
  assert.equal(h.field('密码').props['aria-invalid'], undefined)
  await h.submit()
  assert.equal(h.field('密码').props['aria-invalid'], undefined)
  assert.match(text(all(h.tree).find(n => n.props.role === 'status')), /当前页面无法完成/)
  h.unmount()
})

test('changing the account while a password challenge is pending clears its busy state and fences the old form', async () => {
  const gate = deferred(), old = service({ challenge: () => gate.promise }), next = service({ scopeKey: 'second-owner/session' })
  let completed = 0
  const props = { service: old, mode: 'manage', onBack() {}, onComplete() { completed++ } }, h = await harness('PasswordSetup', props)
  const sending = h.submit(); assert(h.button('正在处理…').props.disabled)
  h.render({ ...props, service: next }); await settle(); h.render()
  assert.equal(h.button('获取验证码').props.disabled, false)
  gate.resolve(old.challengeValue); await sending
  assert.equal(completed, 0); assert(!h.text.includes('短信中的六位'))
  await h.submit(); assert.equal(next.calls[0].action, 'challenge'); h.unmount()
})

test('changing the account during password login clears the password and permits a fresh operation', async () => {
  const gate = deferred(), old = service({ signIn: () => gate.promise }), next = service({ scopeKey: 'second-owner/session' })
  let completed = 0
  const props = { service: old, purpose: 'switch', dial: '+86', phone: '13800000000', onDial() {}, onPhone() {}, agreement: null, canProceed: () => true, onSuccess() { completed++ }, onBack() {} }, h = await harness('PasswordLogin', props)
  h.input('密码', 'old-secret-password'); const sending = h.submit()
  h.render({ ...props, service: next }); await settle(); h.render()
  gate.resolve({ status: 'verified' }); await sending; assert.equal(completed, 0)
  assert(all(h.tree).filter(n => n.type === 'input' && n.props.autoComplete === 'current-password').every(n => n.props.value === ''))
  h.input('密码', 'new-secret-password'); assert.equal(h.button('登录').props.disabled, false)
  await h.submit(); assert.equal(completed, 1); assert.equal(next.calls[0].action, 'signIn'); h.unmount()
})

test('a confirmed password save clears plaintext even when the following account refresh fails', async () => {
  const s = service(), h = await harness('PasswordSetup', { service: s, mode: 'manage', onBack() {}, onComplete() { throw Error('Controlled refresh unavailable') } })
  await verified(h); h.input('新密码', 'saved-password-12!'); h.input('确认新密码', 'saved-password-12!'); await h.submit()
  assert.equal(s.calls.filter(c => c.action === 'save').length, 1)
  assert(!h.text.includes('还没能确认')); assert(!all(h.tree).some(n => n.type === 'input' && n.props.value === 'saved-password-12!')); h.unmount()
})

test('forgotten password keeps the existing single agreement requirement before any SMS reset flow', async () => {
  let agreed = false, checks = 0
  const s = service(), h = await harness('PasswordLogin', { service: s, purpose: 'sign_in', dial: '+86', phone: '13800000000', onPhone() {}, onDial() {}, agreement: null, canProceed() { checks++; return agreed }, onSuccess() {}, onBack() {} })
  h.button('忘记密码').props.onClick(); assert.equal(checks, 1); assert.equal(s.calls.length, 0); assert.notEqual(h.tree.type.name, 'PasswordSetup')
  agreed = true; h.button('忘记密码').props.onClick(); assert.equal(checks, 2); assert.equal(h.tree.type.name, 'PasswordSetup'); assert.equal(h.tree.props.mode, 'reset'); h.unmount()
})

test('anonymous reset returns to the same password form and success message without a session refresh that unmounts it', async () => {
  for (const purpose of ['sign_in', 'switch']) {
    let reads = 0
    const s = service({ refresh: async () => { reads++ } }), h = await harness('PasswordLogin', { service: s, purpose, dial: '+86', phone: '13800000000', onPhone() {}, onDial() {}, agreement: null, canProceed: () => true, onSuccess() { assert.fail('Reset must not log in') }, onBack() {} })
    h.input('密码', 'must-be-cleared'); h.button('忘记密码').props.onClick(); await h.tree.props.onComplete(); h.render()
    assert.equal(reads, purpose === 'switch' ? 1 : 0); assert.match(h.text, /密码已更新/)
    assert.equal(all(h.tree).find(n => n.type === 'input' && n.props.autoComplete === 'username').props.value, '13800000000')
    assert(all(h.tree).filter(n => n.type === 'input' && n.props.autoComplete === 'current-password').every(n => n.props.value === '')); h.unmount()
  }
})
