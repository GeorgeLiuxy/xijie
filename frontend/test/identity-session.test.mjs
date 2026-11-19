import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'

const code = ts.transpileModule(await readFile(new URL('../src/auth/useIdentitySession.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const passwordCode = ts.transpileModule(await readFile(new URL('../src/auth/password.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const data = value => new Response(JSON.stringify({ data: value }))
const denied = () => new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }), { status: 401 })
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve } }
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)) }
const actor = () => ({ session: { id: randomUUID(), accountId: randomUUID(), expiresAt: '2099-01-01T00:00:00Z' }, account: { id: '', displayName: 'Synthetic' } })

async function harness({ native = false, nativeHandler, providers = [{ id: 'apple', enabled: false }, { id: 'wechat', enabled: false }, { id: 'google', enabled: true }], fetcher = () => assert.fail('Unexpected request') } = {}) {
  let si = 0, ri = 0, ei = 0, ci = 0, currentActor, last
  const states = [], refs = [], effects = [], callbacks = [], queued = [], storage = new Map(), requests = [], nativeCalls = [], assigned = [], listeners = new Map()
  const context = vm.createContext({ AbortController, AbortSignal, DOMException, URLSearchParams, URL, Date, crypto: globalThis.crypto,
    sessionStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    location: { search: '', pathname: '/', assign: value => assigned.push(value) },
    history: { replaceState() {} },
    window: { setTimeout: () => 1, clearTimeout() {},setInterval:()=>1,clearInterval(){}, addEventListener: (name, fn) => { const all = listeners.get(name) ?? new Set(); all.add(fn); listeners.set(name, all) }, removeEventListener: (name, fn) => listeners.get(name)?.delete(fn) },
    document:{addEventListener(){},removeEventListener(){}},
    fetch: async (path, init = {}) => {
      requests.push({ path, init })
      if (path === '/v1/auth/providers') return data(providers)
      if (path === '/v1/sessions/current') return currentActor ? data(currentActor.session) : denied()
      if (path === '/v1/accounts/me') return currentActor ? data(currentActor.account) : denied()
      return fetcher(path, init)
    },
  })
  const synthetic = values => new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value) }, { context })
  const react = synthetic({
    useState(initial) { const i = si++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], next => states[i] = typeof next === 'function' ? next(states[i]) : next] },
    useRef(initial) { const i = ri++; return refs[i] ?? (refs[i] = { current: initial }) },
    useCallback(fn, deps) { const i = ci++, old = callbacks[i]; if (!old || deps.some((v, j) => v !== old.deps[j])) callbacks[i] = { fn, deps }; return callbacks[i].fn },
    useEffect(fn, deps) { const i = ei++, old = effects[i]; if (!old || deps.some((v, j) => v !== old.deps[j])) queued.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: fn() } }) },
  })
  const passwordModule=new vm.SourceTextModule(passwordCode,{context});await passwordModule.link(()=>assert.fail('Unexpected password import'));await passwordModule.evaluate()
  const imports = { react, './password':passwordModule, '../mobile/back': synthetic({ isNativeRuntime: () => native }), './nativeAuth': synthetic({ nativeAuth: async (...args) => { nativeCalls.push(args);if(nativeHandler)return nativeHandler(...args);throw Object.assign(Error('Legacy bridge method unavailable'),{code:'UNIMPLEMENTED'}) } }), '../mobile/chatCapture': synthetic({ clearKnownChatCapture: async () => {} }) }
  const module = new vm.SourceTextModule(code, { context }); await module.link(name => imports[name] ?? assert.fail('Unexpected import: ' + name)); await module.evaluate()
  const render = () => { si = ri = ei = ci = 0; last = module.namespace.useIdentitySession(); while (queued.length) queued.shift()(); return last }
  render(); await settle(); render()
  return { render, storage, requests, nativeCalls, assigned, get current() { return last },setServerActor(next){if(next)next.account.id=next.session.accountId;currentActor=next},async focus(){for(const fn of listeners.get('focus')??[])fn();await settle();render()}, async useActor(next) { next.account.id = next.session.accountId; currentActor = next; await last.refresh(); render() }, unmount() { effects.forEach(effect => effect?.cleanup?.()) } }
}

test('web capabilities accept Google without assuming exactly two providers and route the real attempt with its fixed selection', async () => {
  const attempt = randomUUID(), h = await harness({ fetcher: (path, init) => { assert.equal(path, '/v1/auth/attempts'); assert.equal(JSON.parse(init.body).provider, 'google'); assert.equal(init.redirect, 'error'); return data({ attemptId: attempt, expiresAt: '2099-01-01T00:00:00Z', authorizationUrl: 'https://identity.example/oidc/auth?direct_sign_in=social%3Agoogle' }) } })
  assert.equal(h.current.providers.google, true); assert.equal(h.current.providers.apple, false)
  await h.current.startProvider('google', 'sign_in', new AbortController().signal)
  assert.equal(h.assigned.length, 1); assert.equal(h.current.pending, null); assert.equal(JSON.parse(h.storage.get('xijie.identity.web.attempt')).attemptId, attempt)
  h.unmount()
})

test('a legacy two-provider response remains usable and a native bridge without Google capability cannot start Google', async () => {
  const old = await harness({ providers: [{ id: 'apple', enabled: true }, { id: 'wechat', enabled: false }] })
  assert.equal(old.current.providers.apple, true); assert.equal(old.current.providers.google, false); old.unmount()
  const native = await harness({ native: true }); assert.equal(native.current.providers.google, false)
  await assert.rejects(native.current.startProvider('google', 'sign_in', new AbortController().signal), error => error.code === 'AUTH_PROVIDER_UNAVAILABLE')
  assert(native.nativeCalls.every(call=>call[0]==='getCapabilities')); native.unmount()
})

test('a canceled SMS response cannot restore an attempt even when its transport ignores cancellation', async () => {
  const gate = deferred(), id = randomUUID(), h = await harness({ fetcher: () => gate.promise }), controller = new AbortController()
  const sending = h.current.requestCode('sign_in', '+86', '13800000000', controller.signal); controller.abort()
  gate.resolve(data({ id, expiresAt: '2099-01-01T00:00:00Z', resendAt: '2098-01-01T00:00:00Z' }))
  await assert.rejects(sending, error => error.name === 'AbortError'); assert.equal(h.storage.size, 0); assert.equal(h.render().pending, null); h.unmount()
})

test('switching the verified account fences both a late SMS response and an old callable before either writes pending state', async () => {
  const gate = deferred(), h = await harness({ fetcher: () => gate.promise }), first = actor(), second = actor()
  await h.useActor(first); const old = h.current, sending = old.requestCode('switch', '+86', '13800000000', new AbortController().signal)
  await settle(); await h.useActor(second)
  gate.resolve(data({ id: randomUUID(), expiresAt: '2099-01-01T00:00:00Z', resendAt: '2098-01-01T00:00:00Z' }))
  await assert.rejects(sending, error => error.name === 'AbortError'); assert.equal(h.storage.size, 0)
  const before = h.requests.length; await assert.rejects(old.requestCode('switch', '+86', '13900000000', new AbortController().signal), error => error.name === 'AbortError')
  assert.equal(h.requests.length, before); assert.equal(h.render().pending, null); h.unmount()
})

test('modern native Google requires both server and bridge capability and launches the original first-party handoff',async()=>{
  const startKey=randomUUID(),id=randomUUID(),native={pending:true,provider:'google',purpose:'sign_in',startKey,redeemKey:randomUUID(),verifierChallenge:'a'.repeat(64),launchProof:'b'.repeat(43),expiresAt:Date.now()+300000},caps={version:1,browserProviders:['apple','google','wechat'],wechatNative:{configured:false,installed:false}}
  const h=await harness({native:true,providers:[{id:'google',enabled:true,nativeHandoffEnabled:true}],nativeHandler:(method)=>method==='getCapabilities'?caps:method==='getPending'?{pending:false}:method==='prepare'?native:method==='launch'?{}:assert.fail(method),fetcher:(path,init)=>{assert.equal(path,'/v1/auth/native-attempts');assert.equal(JSON.parse(init.body).provider,'google');assert.equal(init.headers['Idempotency-Key'],startKey);return data({attemptId:id,expiresAt:new Date(native.expiresAt).toISOString(),launchUrl:'https://app.example/v1/auth/native-launch/'+id})}})
  assert.equal(h.current.providers.google,true);await h.current.startProvider('google','sign_in',new AbortController().signal)
  const launch=h.nativeCalls.find(c=>c[0]==='launch')[1];assert.equal(launch.attemptId,id);assert.equal(launch.startKey,startKey);assert.equal(launch.expiresAt,native.expiresAt);h.unmount()
})

test('WeChat SDK routing is enabled only by all server, configured-AppID and installed-app capabilities',async()=>{
  for(const [server,configured,installed]of [[false,true,true],[true,false,true],[true,true,false],[true,true,true]]){
    const id=randomUUID(),startKey=randomUUID(),h=await harness({native:true,providers:[{id:'wechat',enabled:false,nativeHandoffEnabled:true,nativeSdkEnabled:server}],nativeHandler:(method)=>method==='getCapabilities'?{version:1,browserProviders:[],wechatNative:{configured,installed}}:method==='getPending'?{pending:false}:method==='prepare'?{pending:true,provider:'wechat',purpose:'sign_in',transport:'wechat_sdk',startKey,redeemKey:randomUUID(),verifierChallenge:'a'.repeat(64),launchProof:'b'.repeat(43),expiresAt:Date.now()+300000}:method==='launch'?{}:assert.fail(method),fetcher:(path,init)=>{assert.equal(path,'/v1/auth/native-attempts');assert.equal(JSON.parse(init.body).transport,'wechat_sdk');return data({attemptId:id,expiresAt:new Date(Date.now()+300000).toISOString()})}})
    assert.equal(h.current.providers.wechat,server&&configured&&installed)
    if(server&&configured&&installed){await h.current.startProvider('wechat','sign_in',new AbortController().signal);assert.equal(h.nativeCalls.find(c=>c[0]==='launch')[1].transport,'wechat_sdk')}
    else{await assert.rejects(h.current.startProvider('wechat','sign_in',new AbortController().signal),e=>e.code==='AUTH_PROVIDER_UNAVAILABLE');assert(!h.nativeCalls.some(c=>c[0]==='prepare'))}h.unmount()
  }
})

test('a pending native completion continues its original operation instead of deleting it and creating a second attempt',async()=>{
  const old={pending:true,provider:'wechat',purpose:'sign_in',transport:'wechat_sdk',stage:'completing',attemptId:randomUUID(),startKey:randomUUID(),redeemKey:randomUUID(),expiresAt:Date.now()+300000}
  const h=await harness({native:true,providers:[{id:'wechat',enabled:false,nativeHandoffEnabled:true,nativeSdkEnabled:true}],nativeHandler:method=>method==='getCapabilities'?{version:1,browserProviders:[],wechatNative:{configured:true,installed:true}}:method==='getPending'?old:method==='prepare'?old:assert.fail('No clear or launch: '+method)})
  await h.current.startProvider('wechat','sign_in',new AbortController().signal)
  assert(!h.requests.some(r=>r.path==='/v1/auth/native-attempts'||r.init.method==='DELETE'));assert(!h.nativeCalls.some(c=>c[0]==='clear'||c[0]==='launch'));assert.equal(h.render().pending.attemptId,old.attemptId);h.unmount()
})

test('password APIs preserve the exact password only in the request body, and sign-in refreshes the verified account',async()=>{
  const person=actor();let h;h=await harness({fetcher:(path,init)=>{assert.equal(path,'/v1/auth/password-attempts');assert.equal(init.redirect,'error');assert.equal(JSON.parse(init.body).password,'  private test password!  ');assert(!path.includes('private'));h.setServerActor(person);return data({status:'verified'})}})
  await h.current.password.signIn({dial:'+86',phone:'13800000000',password:'  private test password!  ',purpose:'sign_in'},randomUUID(),new AbortController().signal)
  assert.equal(h.current.view.kind,'signed-out');assert.equal(h.storage.size,0)
  h.current.completePassword();await settle();assert.equal(h.render().view.account.id,person.session.accountId);assert(![...h.storage.values()].some(v=>v.includes('password')));h.unmount()
})

test('a late password challenge cannot enter a new account and the manage body never repeats or replaces its phone',async()=>{
  const gate=deferred();let body;const h=await harness({fetcher:(path,init)=>{assert.equal(path,'/v1/auth/password-challenges');body=JSON.parse(init.body);return gate.promise}}),first=actor(),second=actor();await h.useActor(first)
  const result=h.current.password.challenge({purpose:'manage'},randomUUID(),new AbortController().signal);await h.useActor(second);gate.resolve(data({id:randomUUID(),purpose:'manage',expiresAt:'2099-01-01T00:00:00Z',resendAt:'2098-01-01T00:00:00Z'}))
  await assert.rejects(result,e=>e.name==='AbortError');assert.deepEqual(body,{purpose:'manage'});assert.equal(h.storage.size,0);h.unmount()
})

test('native reauthentication accepts only its special result and the original verified account/session', async () => {
  for (const outcome of ['same-owner', 'login-result', 'different-session', 'changed-server-owner']) {
    const original = actor(), changed = actor(); let ready = false
    const pending = { pending: true, provider: 'google', purpose: 'reauthenticate', stage: 'verified', attemptId: randomUUID(), startKey: randomUUID(), redeemKey: randomUUID(), previousAccountId: original.session.accountId, expectedSessionId: original.session.id, expiresAt: Date.now() + 300000, verifier: 'v'.repeat(43), ticket: 't'.repeat(43) }
    const h = await harness({ native: true, providers: [{ id: 'google', enabled: true, nativeHandoffEnabled: true }], nativeHandler: method => method === 'getCapabilities' ? { version: 1, browserProviders: ['google'], wechatNative: { configured: false, installed: false } } : method === 'getPending' ? ready ? pending : { pending: false } : method === 'clear' ? (ready = false, {}) : assert.fail('Unexpected native ' + method), fetcher: (path, init) => {
      assert.equal(path, '/v1/auth/native-attempts/' + pending.attemptId + '/redeem'); assert.equal(init.headers['X-Xijie-Expected-Session'], original.session.id); assert.equal(init.headers['Idempotency-Key'], pending.redeemKey)
      return data({ status: outcome === 'login-result' ? 'verified' : 'reauthenticated', sessionId: outcome === 'different-session' ? changed.session.id : original.session.id, reauthenticatedAt: new Date().toISOString() })
    } })
    await h.useActor(original); ready = true
    if (outcome === 'changed-server-owner') h.setServerActor(changed)
    await h.focus(); await settle(); h.render()
    assert.equal(h.current.reauthenticated, outcome === 'same-owner' ? 1 : 0, outcome)
    assert.equal(h.current.view.session.id, original.session.id, outcome); assert.equal(h.current.view.account.id, original.session.accountId, outcome)
    assert(!h.requests.some(r => r.path === '/v1/auth/attempts' || r.path === '/v1/auth/native-attempts'), 'Reauthentication must not start a new sign-in')
    h.unmount()
  }
})

test('password challenge cancellation carries its required UUID operation key and cannot cross the original account scope', async () => {
  const id = randomUUID(), first = actor(), second = actor(), gate = deferred()
  let calls = 0
  const h = await harness({ fetcher: (path, init) => {
    assert.equal(path, '/v1/auth/password-challenges/' + id); assert.equal(init.method, 'DELETE')
    assert.match(init.headers['Idempotency-Key'] ?? '', /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    assert.equal(init.headers['X-Xijie-Expected-Session'], first.session.id); assert.equal(init.body, undefined); assert.equal(init.credentials, 'same-origin'); assert.equal(init.redirect, 'error')
    return ++calls === 1 ? new Response(null, { status: 204 }) : gate.promise
  } })
  await h.useActor(first); const old = h.current
  await old.password.cancel(id, new AbortController().signal); assert.equal(calls, 1)
  const cancel = old.password.cancel(id, new AbortController().signal)
  await h.useActor(second); gate.resolve(new Response(null, { status: 204 }))
  await assert.rejects(cancel, error => error.name === 'AbortError')
  const before = h.requests.length; await assert.rejects(old.password.cancel(id, new AbortController().signal), error => error.name === 'AbortError')
  assert.equal(h.requests.length, before); assert.equal(h.current.view.account.id, second.session.accountId); h.unmount()
})
