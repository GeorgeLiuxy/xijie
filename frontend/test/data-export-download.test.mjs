import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'

const code = ts.transpileModule(await readFile(new URL('../src/auth/downloadDataExport.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
class RightsError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code } }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const requestId = randomUUID(), grantId = randomUUID(), sessionId = randomUUID()
const path = '/v1/accounts/me/data-requests/' + requestId + '/content?grant=' + grantId
const context = { sessionId, accountId: randomUUID(), onUnauthorized() {} }
const saved = { fileName: 'xijie-data-' + requestId + '.json', bytes: 25, sha256: 'a'.repeat(64) }
async function harness({ native = false, bridge, fetch } = {}) {
  const calls = [], clicked = [], revoked = [], timers = []
  const sandbox = vm.createContext({ crypto: globalThis.crypto, DOMException, AbortController, Response,
    window: { Capacitor: bridge === null ? undefined : { nativePromise: bridge ? async (...args) => { calls.push(args); return bridge(...args) } : undefined }, setTimeout: fn => timers.push(fn) },
    URL: { createObjectURL: blob => { assert(blob.size > 0); return 'blob:local-export' }, revokeObjectURL: url => revoked.push(url) },
    document: { createElement: tag => { assert.equal(tag, 'a'); const anchor = { click() { clicked.push({ href: this.href, download: this.download }) } }; return anchor } },
  })
  const module = new vm.SourceTextModule(code, { context: sandbox })
  await module.link(specifier => {
    const names = specifier.endsWith('/back') ? ['isNativeRuntime'] : ['RightsError', 'rightsFetch', 'uuid']
    return new vm.SyntheticModule(names, function () {
      if (specifier.endsWith('/back')) this.setExport('isNativeRuntime', () => native)
      else { this.setExport('RightsError', RightsError); this.setExport('uuid', uuid); this.setExport('rightsFetch', fetch ?? (() => assert.fail('Unexpected web fetch'))) }
    }, { context: sandbox })
  })
  await module.evaluate()
  return { run: signal => module.namespace.downloadDataExport(requestId, path, context, signal ?? new AbortController().signal), api: module.namespace, calls, clicked, revoked, timers }
}
test('web retains JSON Blob filename and does not invoke a native bridge', async () => {
  const h = await harness({ fetch: async (url, signal, owner) => { assert.equal(url, path); assert.equal(owner.sessionId, sessionId); return new Response('{"schemaVersion":1}', { headers: { 'content-type': 'application/json; charset=utf-8' } }) } })
  assert.equal((await h.run()).kind, 'browser')
  assert.deepEqual(h.clicked, [{ href: 'blob:local-export', download: saved.fileName }]); assert.equal(h.calls.length, 0)
  h.timers[0](); assert.deepEqual(h.revoked, ['blob:local-export'])
})
test('native waits for file receipt and sends only fixed UUID identifiers, never URL, cookies or JSON', async () => {
  let complete
  const h = await harness({ native: true, bridge: () => new Promise(resolve => { complete = resolve }) })
  let settled = false; const pending = h.run().then(result => { settled = true; return result })
  await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false); assert.equal(h.clicked.length, 0)
  const [plugin, method, body] = h.calls[0]; assert.equal(plugin, 'DataExport'); assert.equal(method, 'save')
  assert.deepEqual(Object.keys(body).sort(), ['expectedSessionId', 'grantId', 'operationId', 'requestId']); assert.equal(body.expectedSessionId, sessionId); assert.equal(body.requestId, requestId); assert.equal(body.grantId, grantId); assert(uuid.test(body.operationId))
  complete(saved); const result = await pending; assert.equal(result.kind, 'saved'); assert.equal(result.sha256, saved.sha256); assert.equal(result.bytes, saved.bytes)
})
test('native missing plugin and rejected receipt never fall back to a Blob or success', async () => {
  for (const bridge of [null, async () => { throw { code: 'UNIMPLEMENTED' } }, async () => ({ ...saved, sha256: '' }), async () => ({ ...saved, bytes: 0 }), async () => ({ ...saved, fileName: '../private.json' })]) {
    const h = await harness({ native: true, bridge })
    await assert.rejects(h.run(), error => error instanceof RightsError); assert.equal(h.clicked.length, 0)
  }
})
test('native HTTP errors retain the original reauth, stale and grant-expiry contracts', async () => {
  for (const [status, code] of [[401, 'UNAUTHENTICATED'], [403, 'REAUTHENTICATION_REQUIRED'], [409, 'EXPORT_STALE'], [410, 'DOWNLOAD_GRANT_EXPIRED'], [499, 'EXPORT_CANCELLED']]) {
    const h = await harness({ native: true, bridge: async () => { throw { code, data: { status } } } })
    await assert.rejects(h.run(), error => error.status === status && error.code === code); assert.equal(h.clicked.length, 0)
  }
})

test('known outdated WebView stays an export compatibility error without a browser fallback or reauthentication status', async () => {
  for (const status of [undefined, 401, 503]) {
    const h = await harness({ native: true, bridge: async () => { throw { code: 'EXPORT_WEBVIEW_OUTDATED', data: { status } } } })
    await assert.rejects(h.run(), error => error instanceof RightsError && error.code === 'EXPORT_WEBVIEW_OUTDATED' && error.status === 503)
    assert.equal(h.calls.length, 1); assert.equal(h.calls[0][1], 'save'); assert.equal(h.clicked.length, 0); assert.equal(h.timers.length, 0)
  }
})
test('aborting a native export cancels the same operation and fences a late file receipt', async () => {
  let complete
  const h = await harness({ native: true, bridge: async (plugin, method) => method === 'save' ? new Promise(resolve => { complete = resolve }) : {} })
  const controller = new AbortController(), pending = h.run(controller.signal)
  controller.abort(); complete(saved)
  await assert.rejects(pending, error => error.name === 'AbortError')
  assert.equal(h.calls[1][1], 'cancel'); assert.equal(h.calls[1][2].operationId, h.calls[0][2].operationId); assert.equal(h.calls[1][2].expectedSessionId, sessionId); assert.equal(h.clicked.length, 0)
})
test('invalid paths or session UUIDs are rejected before native or network access', async () => {
  const h = await harness({ native: true, bridge: () => assert.fail('Unexpected bridge') })
  for (const candidate of [path + '&other=1', 'https://other.test' + path, path.replace(grantId, 'not-a-uuid')]) await assert.rejects(h.api.downloadDataExport(requestId, candidate, context, new AbortController().signal), { code: 'INVALID_RESPONSE' })
  await assert.rejects(h.api.downloadDataExport(requestId, path, { ...context, sessionId: 'bad' }, new AbortController().signal), { code: 'INVALID_RESPONSE' }); assert.equal(h.calls.length, 0)
})
