import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'

const code = ts.transpileModule(await readFile(new URL('../src/MemoryImport.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React },
}).outputText
const settle = async () => { for (let n = 0; n < 7; n++) await new Promise(resolve => setImmediate(resolve)) }
const deferred = () => { let resolve; return { promise: new Promise(done => { resolve = done }), resolve: value => resolve(value) } }
const nodes = value => value && typeof value === 'object' ? [value, ...(value.props?.children ?? []).flat(Infinity).flatMap(nodes), ...nodes(value.props?.footer)] : []
const content = value => typeof value === 'string' ? value : value && typeof value === 'object' ? (value.props?.children ?? []).flat(Infinity).map(content).join('') : ''
const makeIntent = (personId, personVersion = 1) => ({ key: randomUUID(), personId, personVersion, batch: { batchId: randomUUID(), sourceSha256: 'a'.repeat(64), items: [{ itemId: randomUUID(), title: '窗边', body: '蓝色窗前有一只纸船。' }] } })

async function harness(options = {}) {
  let stateIndex = 0, refIndex = 0, effectIndex = 0, props
  const states = [], refs = [], effects = [], queue = [], changed = [], opened = [], busy = [], calls = []
  const createElement = (type, props, ...children) => ({ type, props: { ...props, children } })
  const context = vm.createContext({ React: { createElement }, crypto: globalThis.crypto })
  const synthetic = values => new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value) }, { context })
  const imports = {
    react: synthetic({
      useState(value) { const i = stateIndex++; if (!(i in states)) states[i] = typeof value === 'function' ? value() : value; return [states[i], next => { states[i] = typeof next === 'function' ? next(states[i]) : next }] },
      useRef(value) { const i = refIndex++; return refs[i] ?? (refs[i] = { current: value }) },
      useEffect(run, deps) { const i = effectIndex++, old = effects[i]; if (!old || deps.some((value, n) => value !== old.deps[n])) queue.push(() => { old?.cleanup?.(); effects[i] = { deps: [...deps], cleanup: run() } }) },
    }),
    'react-dom': synthetic({ createPortal: element => element }),
    './ui': synthetic({ Sheet: 'Sheet' }),
    './i18n': synthetic({ useI18n: () => ({ lang: 'zh-CN' }), isZh: () => true }),
  }
  const module = new vm.SourceTextModule(code, { context }); await module.link(name => imports[name]); await module.evaluate()
  const service = { pending: () => undefined, async prepare(file, id, version) { return options.prepare ? options.prepare(file, id, version) : makeIntent(id, version) }, async submit(intent) { calls.push(intent); return options.submit ? options.submit(intent) : { items: [{ status: 'active' }] } } }
  props = { personId: randomUUID(), personName: '青舟', personVersion: 1, service, layer: { current: { closest: () => ({}) } }, onChanged: value => changed.push(value), onOpen: value => opened.push(value), onBusy: value => busy.push(value), ...options.props }
  const render = (next = {}) => {
    props = { ...props, ...next }; stateIndex = refIndex = effectIndex = 0
    const tree = module.namespace.MemoryImport(props); while (queue.length) queue.shift()(); return tree
  }
  const button = name => { const node = nodes(render()).find(node => node.type === 'button' && content(node) === name); assert(node, 'Expected button ' + name); return node }
  const choose = async () => { const input = nodes(render()).find(node => node.type === 'input'); const target = { files: [{ name: '记忆.txt' }], value: 'selected' }; input.props.onChange({ currentTarget: target }); assert.equal(target.value, ''); await settle() }
  render(); return { render, button, choose, calls, opened, busy, changed, service, get personId() { return props.personId }, get text() { return content(render()) }, unmount() { effects.forEach(effect => effect?.cleanup?.()) } }
}

test('a selected file is reviewed before writing and an unknown save retries the exact same batch', async () => {
  let attempts = 0
  const h = await harness({ async submit() { if (++attempts === 1) throw Error('Lost acknowledgement'); return { items: [{ status: 'active' }] } } })
  await h.choose(); assert.equal(h.calls.length, 0); assert(h.text.includes('青舟')); assert(h.opened.includes(true))
  h.button('添加到记忆').props.onClick(); await settle()
  assert.equal(h.calls.length, 1); assert(h.text.includes('还没能确认是否已保存')); assert.equal(h.changed.length, 0)
  h.button('重试添加').props.onClick(); await settle()
  assert.equal(h.calls.length, 2); assert.equal(h.calls[1], h.calls[0]); assert.equal(h.calls[1].key, h.calls[0].key)
  assert.equal(h.changed.length, 1); assert(h.changed[0].includes('已保存1段记忆')); assert.equal(h.opened.at(-1), false)
  h.unmount()
})

test('a changed destination needs an explicit profile refresh before another save', async () => {
  let refreshes = 0, attempts = 0
  const h = await harness({ props: { async reload() { refreshes++ } }, async submit() { if (++attempts === 1) throw { code: 'VERSION_CONFLICT' }; return { items: [{ status: 'active' }] } } })
  await h.choose(); h.button('添加到记忆').props.onClick(); await settle()
  assert.equal(h.button('重试添加').props.disabled, true); assert.equal(refreshes, 0)
  h.button('刷新 TA 的资料').props.onClick(); await settle(); h.render({ personVersion: 2 })
  h.button('添加到记忆').props.onClick(); await settle()
  assert.equal(refreshes, 1); assert.equal(h.calls.length, 2); assert.notEqual(h.calls[1].key, h.calls[0].key)
  assert.equal(h.calls[1].personVersion, 2); assert.equal(h.calls[1].batch, h.calls[0].batch)
  h.unmount()
})

test('a replacement service for the same person fences late file reads and releases the old busy state', async () => {
  const wait = deferred(), h = await harness({ prepare: () => wait.promise })
  const selecting = h.choose(); await settle(); const oldPerson = h.personId
  h.render({ service: { ...h.service } }); h.render()
  assert.equal(h.button('从文件添加记忆').props.disabled, false)
  wait.resolve(makeIntent(oldPerson)); await selecting
  assert.equal(h.opened.includes(true), false); assert.equal(h.calls.length, 0); assert(!nodes(h.render()).some(node => node.type === 'Sheet'))
  h.unmount()
})

test('a replacement person cannot receive a previous save result or success message', async () => {
  const wait = deferred(), h = await harness({ submit: () => wait.promise })
  await h.choose(); h.button('添加到记忆').props.onClick(); await settle()
  h.render({ personId: randomUUID(), personName: '新人物' }); h.render()
  wait.resolve({ items: [{ status: 'active' }] }); await settle()
  assert.equal(h.changed.length, 0); assert.equal(h.opened.at(-1), false); assert.equal(h.button('从文件添加记忆').props.disabled, false)
  h.unmount()
})
