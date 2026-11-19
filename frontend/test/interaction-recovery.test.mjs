import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'

const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React } }).outputText
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)) }
const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? (node.props?.children ?? []).flat(Infinity).map(text).join('') : ''
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...(node.props?.children ?? []).flat(Infinity).flatMap(nodes), ...nodes(node.props?.footer)]
const response = (data, meta) => new Response(JSON.stringify({ data, ...(meta ? { meta } : {}) }))
const actor = () => ({ accountId: randomUUID(), sessionId: randomUUID(), personId: randomUUID(), onUnauthorized() {} })

async function ui(file, name, { fetch, storage = new Map(), imports = {}, globals = {}, transform = code => code } = {}) {
  let si = 0, ri = 0, ei = 0, mi = 0, props, tree, rendering = false, changedDuringRender = false
  const states = [], refs = [], effects = [], memos = [], queued = []
  const context = vm.createContext({ React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
    fetch, Headers, URLSearchParams, URL, DOMException, AbortController, AbortSignal, crypto: globalThis.crypto,
    sessionStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    document: { hidden: false, visibilityState: 'visible' },
    window: { setInterval: () => 1, clearInterval() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} }, ...globals })
  const synthetic = values => new vm.SyntheticModule(Object.keys(values), function () { for (const [k, v] of Object.entries(values)) this.setExport(k, v) }, { context })
  const react = synthetic({
    createContext: value => ({ value, Provider: 'Provider' }), useContext: value => value.value,
    useState(value) { const n = si++; if (!(n in states)) states[n] = typeof value === 'function' ? value() : value; return [states[n], next => { states[n] = typeof next === 'function' ? next(states[n]) : next; if(rendering)changedDuringRender = true }] },
    useRef(value) { const n = ri++; return refs[n] ?? (refs[n] = { current: value }) },
    useMemo(fn, deps) { const n = mi++, old = memos[n]; if (!old || deps.some((v, i) => v !== old.deps[i])) memos[n] = { deps, value: fn() }; return memos[n].value },
    useEffect(fn, deps) { const n = ei++, old = effects[n]; if (!old || deps.some((v, i) => v !== old.deps[i])) queued.push(() => { old?.cleanup?.(); effects[n] = { deps, cleanup: fn() } }) },
  })
  const cache = new Map()
  async function load(path) {
    if (cache.has(path)) return cache.get(path)
    const source = await readFile(new URL('../src/' + path, import.meta.url), 'utf8')
    const module = new vm.SourceTextModule(compile(path === file ? transform(source) : source), { context }); cache.set(path, module)
    await module.link(async specifier => {
      if (specifier === 'react') return react
      if (specifier.endsWith('/i18n')) return synthetic({ useI18n: () => ({ lang: 'zh-CN' }), isZh: () => true, fmtTime: () => '' })
      if (imports[specifier]) return synthetic(imports[specifier])
      if (specifier.endsWith('serviceStoryControls')) return load('serviceStoryControls.ts')
      if (specifier.endsWith('serviceReports')) return load('serviceReports.ts')
      if (specifier.endsWith('/model')) return synthetic({ nid: () => 1 })
      throw Error('Unexpected import ' + specifier)
    })
    await module.evaluate(); return module
  }
  const module = await load(file)
  return {
    storage,
    render(next) { if (next) props = next; let passes=0; do { assert(++passes<8);si = ri = ei = mi = 0; changedDuringRender=false;const queuedBefore=queued.length;rendering=true;tree = module.namespace[name](props);rendering=false;if(changedDuringRender)queued.splice(queuedBefore) }while(changedDuringRender); while (queued.length) queued.shift()(); return tree },
    get tree() { return tree },
    find(label, type = 'button') { const found = nodes(this.render()).find(n => n.type === type && (text(n) === label || n.props['aria-label'] === label)); assert(found, 'Missing ' + label); return found },
    unmount() { effects.forEach(effect => effect?.cleanup?.()) },
  }
}

const permissions = { TextStoragePermission() {}, AiTextPermission() {}, WorldActionPermission() {}, StoryBranchesPermission() {}, OfflineLifePermission() {} }
const offline = (a, enabled, version) => ({ personId: a.personId, enabled, timeZone: enabled ? 'Asia/Shanghai' : null, version, nextRunAt: enabled ? new Date().toISOString() : null, lastRunAt: null })

test('an unknown offline enable result offers its original action before a new pause can be requested', async () => {
  const a = actor(), key = randomUUID(), path = '/v1/persons/' + a.personId + '/offline-life', storage = new Map(), writes = []
  storage.set('xijie.story.controls.' + a.accountId + '.' + a.personId, JSON.stringify({ key, path, method: 'PUT', version: 1, body: { enabled: true, timeZone: 'Asia/Shanghai' } }))
  const h = await ui('world/StoryControls.tsx', 'StoryControls', { storage, imports: { '../auth/AiTextPermission': permissions }, fetch: async (url, init) => {
    if (init.method === 'PUT') { const body = JSON.parse(init.body); writes.push({ body, key: init.headers.get('Idempotency-Key'), version: init.headers.get('If-Match') }); return response(offline(a, body.enabled, body.enabled ? 2 : 3)) }
    return response(url.endsWith('/offline-life') ? offline(a, true, 2) : [])
  } })
  h.render({ context: a, name: 'TA', onOpen() {} }); await settle()
  assert.equal(h.find('暂停离线生活').props.disabled, true)
  assert.equal(writes.length, 0)
  h.find('继续开启离线生活').props.onClick(); await settle()
  assert.equal(writes[0].body.enabled, true); assert.equal(writes[0].key, key); assert.equal(writes[0].version, '"v1"')
  assert.equal(h.find('暂停离线生活').props.disabled, false)
  h.find('暂停离线生活').props.onClick(); await settle()
  assert.equal(writes[1].body.enabled, false); assert.notEqual(writes[1].key, key); assert.equal(writes[1].version, '"v2"'); h.unmount()
})

test('retrying a storyline after a lost response keeps its name and operation identity', async () => {
  const a = actor(), writes = [], opened = []
  const branch = { id: randomUUID(), personId: a.personId, conversationId: randomUUID(), name: '另一种可能', version: 1, createdAt: new Date().toISOString(), scene: { world: { id: randomUUID(), code: 'tide', displayName: '潮汐' }, worldVersion: 1 }, fork: { conversationId: randomUUID(), messageSequence: '1', eventRevision: '0' }, canSend: true }
  const h = await ui('world/StoryControls.tsx', 'StoryControls', { imports: { '../auth/AiTextPermission': permissions }, fetch: async (path, init) => {
    if (init.method === 'POST') { writes.push({ body: init.body, key: init.headers.get('Idempotency-Key') }); if (writes.length === 1) throw Error('Lost response'); return response(branch) }
    return response(path.endsWith('/offline-life') ? offline(a, false, 1) : [])
  } })
  h.render({ context: a, name: 'TA', onOpen: b => opened.push(b) }); await settle()
  nodes(h.render()).find(n => n.type === 'input').props.onChange({ target: { value: branch.name } }); h.find('另开一条故事线').props.onClick(); await settle()
  assert.equal(h.find('另开一条故事线').props.disabled, true); assert.equal(opened.length, 0)
  h.find('继续创建这条故事线').props.onClick(); await settle()
  assert.deepEqual(writes[0], writes[1]); assert.equal(opened.length, 1); assert.equal(h.storage.size, 0); h.unmount()
})

async function reports(fetch) {
  const h = await ui('ContentReports.tsx', 'ContentReports', { fetch, imports: { './ui': { Sheet() {} } } })
  h.render({ context: actor(), children: null }); return h
}
const reportRow = () => ({ id: randomUUID(), status: 'open', version: 1, createdAt: new Date().toISOString() })

test('changing accounts clears the previous report form and fences its delayed history without remounting children', async () => {
  let complete
  const h=await reports(()=>new Promise(resolve=>complete=resolve)), oldApi=h.tree.props.value
  oldApi.open({subjectType:'message',subjectId:randomUUID()});h.render()
  h.find('补充说明（选填）','textarea').props.onChange({target:{value:'Only the previous account should see this note'}});h.render()
  assert(h.find('补充说明（选填）','textarea').props.value.includes('previous account'))
  oldApi.history();const child={type:'main',props:{children:['current application']}}
  h.render({context:actor(),children:child});complete(response([reportRow()],{nextCursor:null}));await settle()
  const next=h.render();assert(!nodes(next).some(n=>n.type==='textarea'));assert(!text(next).includes('previous account'));assert(!text(next).includes('已收到'));assert(nodes(next).includes(child));h.unmount()
})

test('report pagination does not replace the separate refresh-progress action', async () => {
  const cursor = randomUUID(), first = reportRow(), second = reportRow(), urls = []
  const h = await reports(async url => { urls.push(url); return response([url.includes('&cursor=') ? second : first], { nextCursor: url.includes('&cursor=') ? null : cursor }) })
  h.tree.props.value.history(); await settle(); h.render()
  h.find('刷新进度').props.onClick(); await settle(); assert(!urls.at(-1).includes('&cursor='))
  h.find('查看更多记录').props.onClick(); await settle(); assert(urls.at(-1).endsWith('&cursor=' + cursor))
  assert.equal(nodes(h.render()).filter(n => n.type === 'p' && text(n) === '已收到').length, 2); h.unmount()
})

test('a rejected report can be edited while an unknown report retries the original body and key', async () => {
  for (const rejected of [true, false]) {
    const writes = [], h = await reports(async (path, init) => {
      writes.push({ body: init.body, key: init.headers['Idempotency-Key'] })
      if (writes.length === 1) { if (!rejected) throw Error('Lost response'); return new Response(JSON.stringify({ error: { code: 'INVALID_ARGUMENT' } }), { status: 400 }) }
      return response(reportRow())
    })
    h.tree.props.value.open({ subjectType: 'message', subjectId: randomUUID() }); h.render()
    h.find('补充说明（选填）', 'textarea').props.onChange({ target: { value: '保留说明' } }); h.find('提交').props.onClick(); await settle()
    const field = h.find('补充说明（选填）', 'textarea'); assert.equal(field.props.value, '保留说明'); assert.equal(field.props.disabled, !rejected)
    if (rejected) { field.props.onChange({ target: { value: '修改后的说明' } }); h.find('提交').props.onClick() }
    else h.find('重试这次提交').props.onClick()
    await settle()
    if (rejected) { assert.notEqual(writes[0].key, writes[1].key); assert.notEqual(writes[0].body, writes[1].body) }
    else assert.deepEqual(writes[0], writes[1])
    assert(h.find('查看处理进度')); h.unmount()
  }
})

test('microphone denial stops before a call is created; unavailable service releases the microphone', async () => {
  for (const denied of [true, false]) {
    let requests = 0, stopped = 0
    const h = await ui('voiceCalls.ts', 'useVoiceCall', {
      fetch: async () => { requests++; return new Response(JSON.stringify({ error: { code: 'VOICE_CALLS_DISABLED' } }), { status: 503 }) },
      globals: { AudioContext: class { async resume() {} async close() {} }, navigator: { mediaDevices: { async getUserMedia() { if (denied) throw new DOMException('Denied', 'NotAllowedError'); return { getTracks: () => [{ stop() { stopped++ } }] } } } } },
    })
    h.render({ ...actor(), conversationId: randomUUID() }); await settle(); await h.tree.start(); const view = h.render()
    assert.equal(view.phase, 'primer'); assert.equal(view.call, undefined); assert.equal(view.seconds, 0)
    if (denied) { assert.equal(requests, 0); assert(view.error.includes('麦克风')) }
    else { assert.equal(requests, 1); assert(stopped > 0); assert(view.error.includes('暂时不可用')); assert(!view.error.includes('同意')) }
    h.unmount()
  }
})
