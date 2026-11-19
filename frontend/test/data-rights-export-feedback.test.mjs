import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'

const code = ts.transpileModule(await readFile(new URL('../src/auth/DataRights.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React },
}).outputText
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)) }
const nodes = node => node && typeof node === 'object' ? [node, ...(node.props?.children ?? []).flat(Infinity).flatMap(nodes)] : []
const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? (node.props?.children ?? []).flat(Infinity).map(text).join('') : ''

async function harness(failureCode, lang = 'zh-CN', options = {}) {
  let si = 0, ri = 0, ei = 0, tree, unauthorized = 0, downloads = 0
  const states = [], refs = [], effects = [], queued = [], calls = [], storage=new Map()
  const request = { id: randomUUID(), kind: 'export', status: 'completed', requestedAt: '2026-11-16T00:00:00Z' }
  const context = vm.createContext({ React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) }, AbortController,
    crypto: { randomUUID }, document: { visibilityState: 'visible' },
    sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  })
  const synthetic = values => new vm.SyntheticModule(Object.keys(values), function () { for (const [name, value] of Object.entries(values)) this.setExport(name, value) }, { context })
  class RightsError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code } }
  const react = synthetic({
    useState(value) { const i = si++; if (!(i in states)) states[i] = typeof value === 'function' ? value() : value; return [states[i], next => { states[i] = typeof next === 'function' ? next(states[i]) : next }] },
    useRef(value) { const i = ri++; return refs[i] ?? (refs[i] = { current: value }) },
    useEffect(fn, deps) { const i = ei++, old = effects[i]; if (!old || deps.some((value, n) => value !== old.deps[n])) queued.push(() => { old?.cleanup?.(); effects[i] = { deps: [...deps], cleanup: fn() } }) },
  })
  const rights = {
    RightsError, readDeletionReceipt() {}, readExportIntent() {}, validRequest: value => value === request,
    jsonWrite: body => ({ method: 'POST', body }), uuid: { test: () => true },
    async rightsData(path) {
      calls.push(path)
      if (path.endsWith('?limit=10')) return [request]
      assert.equal(path, '/v1/accounts/me/data-requests/' + request.id + '/download')
      return { downloadUrl: '/v1/accounts/me/data-requests/' + request.id + '/content?grant=' + randomUUID(), expiresAt: '2026-11-16T01:00:00Z' }
    },
  }
  for (const name of ['clearDeletionReceipt', 'createDeletionReceipt', 'receiptStatus', 'saveDeletionReceipt', 'saveExportIntent', 'deletionProgressText', 'clearPrivateOperationDrafts']) rights[name] = () => assert.fail('Unexpected ' + name)
  const module = new vm.SourceTextModule(code, { context })
  await module.link(name => name === 'react' ? react : name === '../i18n' ? synthetic({ useI18n: () => ({ lang }), isZh: () => lang === 'zh-CN' })
    : name === './dataRightsClient' ? synthetic(rights)
      : name === './password' ? synthetic({ passwordFailure: () => 'Account verification is unavailable.' })
      : name === './downloadDataExport' ? synthetic({ downloadDataExport: async () => { downloads++;if(failureCode===null)return{kind:'saved'};throw new RightsError(failureCode === 'UNAUTHENTICATED' ? 401 : failureCode==='REAUTHENTICATION_REQUIRED'?403:503, failureCode) } })
        : name === '../mobile/ContextSheet' ? synthetic({ ContextSheet: 'sheet' }) : name === '../ui' ? synthetic({ I: {} }) : Promise.reject(Error('Unexpected import ' + name)))
  await module.evaluate()
  const render = () => {
    si = ri = ei = 0
    tree = module.namespace.DataRights({ context: { sessionId: 'session', accountId: 'account', onUnauthorized() { unauthorized++ } }, mode: 'export',authentication:options.authentication })
    while (queued.length) queued.shift()()
    return tree
  }
  const find = () => { const button = nodes(render()).find(node => node.type === 'button' && text(node) === (lang === 'zh-CN' ? '下载资料文件' : 'Download data file')); assert(button); return button }
  render(); await settle(); find().props.onClick(); await settle()
  return { calls,storage, render, find,setFailure:code=>failureCode=code, get text() { return text(render()) }, get unauthorized() { return unauthorized }, get downloads() { return downloads }, unmount() { for (const effect of effects) effect?.cleanup?.() } }
}

test('outdated WebView explains the system-component update, keeps the completed request and never signs the user out', async () => {
  for (const lang of ['zh-CN', 'en']) {
    const h = await harness('EXPORT_WEBVIEW_OUTDATED', lang)
    assert.match(h.text, /Android System WebView/); assert.match(h.text, /Chrome/)
    assert.equal(h.unauthorized, 0); assert.equal(h.downloads, 1); assert.equal(h.find().props.disabled, false)
    assert.equal(h.calls.length, 2)
    h.unmount()
  }
})

test('a real unauthenticated download still invokes the existing sign-in recovery', async () => {
  const h = await harness('UNAUTHENTICATED')
  assert.equal(h.unauthorized, 1); assert.equal(h.downloads, 1); assert.match(h.text, /重新登录/)
  h.unmount()
})

test('a social-only account can reauthenticate with its original provider and still explicitly confirm the original export afterward',async()=>{
  const started=[],authentication={service:{authentication:async()=>({password:{canManage:false,phoneBound:false,maskedPhone:null},reauthenticationMethods:{sms:false,social:['google']}})},providers:{google:true,apple:false,wechat:false},reauthenticate:async provider=>started.push(provider),completed:0}
  const h=await harness('REAUTHENTICATION_REQUIRED','zh-CN',{authentication});h.render();await settle();let tree=h.render()
  assert(!nodes(tree).some(n=>n.type==='input'));const google=nodes(tree).find(n=>n.type==='button'&&text(n)==='使用 Google 验证');assert(google);assert.equal(google.props.disabled,false)
  google.props.onClick();await settle();assert.deepEqual(started,['google']);assert.equal(h.downloads,1)
  assert.deepEqual(JSON.parse(h.storage.get('xijie.identity.rights-return')),{accountId:'account',sessionId:'session',mode:'export'})
  authentication.completed=1;h.render();h.render();assert.match(h.text,/当前账号已验证/);assert.equal(h.downloads,1,'Reauthentication must not automatically download or delete')
  h.setFailure(null);h.find().props.onClick();await settle();assert.equal(h.downloads,2);assert.match(h.text,/导出文件已保存/);h.unmount()
})
