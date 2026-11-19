import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'

const code = ts.transpileModule(await readFile(new URL('../src/auth/PrivacyStatement.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React },
}).outputText
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)) }
const deferred = () => { let resolve; return { promise: new Promise(accept => { resolve = accept }), resolve: value => resolve(value) } }
const nodes = node => node && typeof node === 'object' ? [node, ...(node.props?.children ?? []).flat(Infinity).flatMap(nodes)] : []
const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? (node.props?.children ?? []).flat(Infinity).map(text).join('') : ''
const snapshot = (complete = true) => ({ complete, documents: [{ purpose: 'privacy_notice', text: '当前版本的完整说明正文' }] })

async function harness(options = {}) {
  let si = 0, ri = 0, ei = 0, props, tree
  const states = [], refs = [], effects = [], queued = [], listeners = new Map(), calls = [], clients = []
  const add = (name, fn) => { const values = listeners.get(name) ?? new Set(); values.add(fn); listeners.set(name, values) }
  const remove = (name, fn) => listeners.get(name)?.delete(fn)
  const context = vm.createContext({ React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) }, AbortController,
    document: { visibilityState: 'visible', addEventListener: add, removeEventListener: remove },
    window: { addEventListener: add, removeEventListener: remove },
  })
  const synthetic = values => new vm.SyntheticModule(Object.keys(values), function () { for (const [name, value] of Object.entries(values)) this.setExport(name, value) }, { context })
  class ConsentError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code } }
  const react = synthetic({
    useState(value) { const i = si++; if (!(i in states)) states[i] = typeof value === 'function' ? value() : value; return [states[i], next => { states[i] = typeof next === 'function' ? next(states[i]) : next }] },
    useRef(value) { const i = ri++; return refs[i] ?? (refs[i] = { current: value }) },
    useEffect(fn, deps) { const i = ei++, old = effects[i]; if (!old || deps.some((value, n) => value !== old.deps[n])) queued.push(() => { old?.cleanup?.(); effects[i] = { deps: [...deps], cleanup: fn() } }) },
  })
  const bundle = synthetic({ ConsentError, consentBundle(owner, signal, locale) {
    const client = { owner, signal, locale, hasPending: false,
      async load() { calls.push(['load', owner.sessionId]); return options.load ? options.load(client) : snapshot() },
      async grant(shown) { calls.push(['grant', owner.sessionId]); return options.grant ? options.grant(client, shown) : snapshot() },
      async retry() { calls.push(['retry', owner.sessionId]); return options.retry ? options.retry(client) : snapshot() },
    }
    clients.push(client); return client
  } })
  const module = new vm.SourceTextModule(code, { context })
  await module.link(name => name === 'react' ? react : name === '../i18n' ? synthetic({ useI18n: () => ({ lang: 'zh-CN' }), isZh: () => true }) : name === './consentBundle' ? bundle : Promise.reject(Error('Unexpected import ' + name)))
  await module.evaluate()
  props = { sessionId: randomUUID(), onUnauthorized() {} }
  const render = (next = {}) => {
    props = { ...props, ...next }; si = ri = ei = 0
    tree = module.namespace.PrivacyStatement(props)
    while (queued.length) queued.shift()()
    return tree
  }
  const find = label => { const result = nodes(render()).find(node => node.type === 'button' && text(node) === label); assert(result, 'Expected button ' + label); return result }
  const unmount = () => { for (const effect of effects) effect?.cleanup?.() }
  render(options.props)
  return { render, find, calls, clients, unmount, get text() { return text(render()) }, get sessionId() { return props.sessionId } }
}

test('an existing agreement does not automatically resume the caller; explicit Continue performs readback without grant or retry', async () => {
  let continued = 0
  const h = await harness({ props: { onAgreed() { continued++ } } })
  await settle()
  assert.equal(continued, 0)
  assert.equal(h.clients.length, 1)
  assert.equal(h.find('继续').props.disabled, false)
  assert.equal(nodes(h.render()).filter(node => node.type === 'input').length, 0)
  h.find('继续').props.onClick(); await settle()
  assert.equal(continued, 1)
  assert.equal(h.calls.filter(([kind]) => kind === 'load').length, 2)
  assert.equal(h.calls.filter(([kind]) => kind === 'grant' || kind === 'retry').length, 0)
  h.unmount()
})

test('a failed continuation keeps the saved agreement and allows another explicit Continue without writing permission again', async () => {
  let attempts = 0
  const h = await harness({ props: { async onAgreed() { if (++attempts === 1) throw Error('Next feature is temporarily unavailable') } } })
  await settle()
  h.find('继续').props.onClick(); await settle()
  assert.equal(attempts, 1)
  assert(h.text.includes('同意已保存，下一步暂时无法完成'))
  assert.equal(h.find('继续').props.disabled, false)
  h.find('继续').props.onClick(); await settle()
  assert.equal(attempts, 2)
  assert.equal(h.calls.filter(([kind]) => kind === 'grant' || kind === 'retry').length, 0)
  h.unmount()
})

test('a session switch fences an old Continue readback before it can call the replacement callback', async () => {
  const gate = deferred(), continued = []
  let reads = 0
  const h = await harness({ load: () => ++reads === 2 ? gate.promise : snapshot(), props: { onAgreed() { continued.push('old') } } })
  await settle()
  h.find('继续').props.onClick(); await settle()
  const old = h.clients[0]
  h.render({ sessionId: randomUUID(), onAgreed() { continued.push('new') } }); await settle()
  assert.equal(old.signal.aborted, true)
  gate.resolve(snapshot()); await settle()
  assert.deepEqual(continued, [])
  assert.equal(h.find('继续').props.disabled, false)
  h.find('继续').props.onClick(); await settle()
  assert.deepEqual(continued, ['new'])
  assert.equal(h.calls.filter(([kind]) => kind === 'grant' || kind === 'retry').length, 0)
  h.unmount()
})

test('a late grant from a departed session cannot resume either caller or update the replacement statement', async () => {
  const gate = deferred(), continued = [], originalSession = randomUUID()
  const h = await harness({
    load: client => snapshot(client.owner.sessionId !== originalSession),
    grant: () => gate.promise,
    props: { sessionId: originalSession, onAgreed() { continued.push('old') } },
  })
  await settle()
  h.find('同意并继续').props.onClick(); await settle()
  const previous = h.clients[0]
  h.render({ sessionId: randomUUID(), onAgreed() { continued.push('new') } }); await settle()
  gate.resolve(snapshot()); await settle()
  assert.equal(previous.signal.aborted, true)
  assert.deepEqual(continued, [])
  assert.equal(h.find('继续').props.disabled, false)
  assert.equal(h.calls.filter(([kind]) => kind === 'grant').length, 1)
  assert.deepEqual(h.calls.filter(([kind]) => kind === 'grant').map(([, id]) => id), [originalSession])
  h.unmount()
})

test('settings shows one disabled Agreed action after readback and does not auto-grant or mount fine-grained controls', async () => {
  const h = await harness({ props: { children: 'Advanced controls are optional' } })
  await settle()
  assert.equal(h.find('已同意').props.disabled, true)
  assert.equal(nodes(h.render()).filter(node => node.type === 'button').length, 1)
  assert.equal(h.text.includes('Advanced controls are optional'), false)
  assert.equal(h.calls.filter(([kind]) => kind === 'grant' || kind === 'retry').length, 0)
  h.unmount()
})
