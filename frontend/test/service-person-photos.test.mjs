import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'

const json = data => new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } })
const settle = () => new Promise(resolve => setImmediate(resolve))
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const photo = () => ({ id: randomUUID(), version: 1, mimeType: 'image/webp', byteSize: 4, width: 24, height: 24 })
const sources = {}
for (const name of ['serviceMedia.ts', 'servicePersonPhotos.ts']) sources[name] = ts.transpileModule(await readFile(new URL('../src/' + name, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText

async function harness(fetcher) {
  let stateIndex = 0, refIndex = 0, memoIndex = 0, effectIndex = 0, afterUnmount = 0, unmounted = false
  const states = [], refs = [], memos = [], effects = [], pending = [], listeners = new Map(), storage = new Map(), created = [], revoked = []
  const add = (name, callback) => { const set = listeners.get(name) ?? new Set(); set.add(callback); listeners.set(name, set) }
  const remove = (name, callback) => listeners.get(name)?.delete(callback)
  class BrowserURL extends URL {
    static createObjectURL(blob) { const url = 'blob:person-' + created.length; created.push({ url, blob }); return url }
    static revokeObjectURL(url) { revoked.push(url) }
  }
  const document = { visibilityState: 'visible', addEventListener: add, removeEventListener: remove }
  const context = vm.createContext({ fetch: fetcher, crypto: globalThis.crypto, Blob, Headers, Response, AbortController, AbortSignal, DOMException, TextEncoder, URL: BrowserURL, atob, setTimeout, clearTimeout, document,
    window: { addEventListener: add, removeEventListener: remove }, sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } })
  const react = new vm.SyntheticModule(['useState', 'useRef', 'useMemo', 'useEffect'], function () {
    this.setExport('useState', initial => { const index = stateIndex++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial; return [states[index], value => { if (unmounted) afterUnmount++; states[index] = typeof value === 'function' ? value(states[index]) : value }] })
    this.setExport('useRef', initial => { const index = refIndex++; return refs[index] ?? (refs[index] = { current: initial }) })
    this.setExport('useMemo', (fn, deps) => { const index = memoIndex++, old = memos[index]; if (!old || deps.some((value, i) => value !== old.deps[i])) memos[index] = { deps: [...deps], value: fn() }; return memos[index].value })
    this.setExport('useEffect', (fn, deps) => { const index = effectIndex++, old = effects[index]; if (!old || deps.some((value, i) => value !== old.deps[i])) pending.push(() => { old?.cleanup?.(); effects[index] = { deps: [...deps], cleanup: fn() } }) })
  }, { context })
  const media = new vm.SourceTextModule(sources['serviceMedia.ts'], { context }); await media.link(() => { throw Error('Unexpected media import') }); await media.evaluate()
  const module = new vm.SourceTextModule(sources['servicePersonPhotos.ts'], { context }); await module.link(name => name === 'react' ? react : name === './serviceMedia' ? media : Promise.reject(Error('Unexpected import'))); await module.evaluate()
  const flush = () => { while (pending.length) pending.shift()() }
  return { api: module.namespace, media: media.namespace, storage, created, revoked, document,
    render(ctx, records, runEffects = true) { stateIndex = refIndex = memoIndex = effectIndex = 0; const result = module.namespace.usePersonPhotoMedia(ctx, records); if (runEffects) flush(); return result }, flush,
    dispatch(name) { for (const fn of [...(listeners.get(name) ?? [])]) fn() },
    get afterUnmount() { return afterUnmount }, unmount() { unmounted = true; effects.forEach(effect => effect?.cleanup?.()) } }
}
const ctx = () => ({ accountId: randomUUID(), sessionId: randomUUID(), onUnauthorized() {} })

test('private person descriptors reject mismatched order, duplicate refs and more than six', async () => {
  const h = await harness(() => { throw Error('No network') }), a = photo(), b = photo()
  assert.equal(h.api.personPhotos({ mediaIds: [a.id, b.id], media: [a, b] }).length, 2)
  for (const value of [{ mediaIds: [b.id, a.id], media: [a, b] }, { mediaIds: [a.id, a.id], media: [a, a] }, { mediaIds: [a.id], media: [] }, (() => { const items = Array.from({ length: 7 }, photo); return { mediaIds: items.map(item => item.id), media: items } })()]) assert.throws(() => h.api.personPhotos(value), error => error.code === 'INVALID_PERSON_PHOTOS')
})

test('person reads use exact stable draft target and clear every blob on withdrawal and unmount', async () => {
  const a = photo(), draftId = randomUUID(), calls = [], owner = ctx(); let revokedPermission = false
  const h = await harness(async (path, init) => {
    calls.push({ path, init })
    if (revokedPermission) return new Response(JSON.stringify({ error: { code: 'FORBIDDEN' } }), { status: 403 })
    if (path.endsWith('/read-url')) return json({ mode: 'authorized_stream', url: '/v1/media/' + a.id + '/content', expiresAt: new Date(Date.now() + 60000).toISOString(), authorizationVersion: 1, readProof: 'synthetic.' + 'a'.repeat(43) })
    return new Response(new Blob(['test'], { type: 'image/webp' }))
  })
  const records = [{ target: draftId, media: [a] }]
  h.render(owner, records); for (let i = 0; i < 10 && !h.created.length; i++) await settle(); const ready = h.render(owner, records)
  assert.equal(ready.urls[a.id], 'blob:person-0')
  assert.deepEqual(JSON.parse(calls[0].init.body), { purpose: 'person_photo', target: { kind: 'person_draft', id: draftId } })
  assert(calls.every(call => call.init.headers.get('X-Xijie-Expected-Session') === owner.sessionId))
  assert.equal(h.storage.size, 0, 'No private bytes or read proofs in storage')
  revokedPermission = true; h.dispatch('xijie:consents-changed'); assert(h.revoked.includes('blob:person-0'))
  assert.deepEqual(Object.keys(h.render(owner, records).urls), []); await settle(); assert.equal(h.created.length, 1)
  h.unmount(); assert.equal(h.afterUnmount, 0)
})

test('new session render and source replacement fence pending old photo bytes before effect cleanup', async () => {
  const a = photo(), draftId = randomUUID(), gate = defer(), owner = ctx(); let entered
  const started = new Promise(resolve => { entered = resolve })
  const h = await harness(async path => {
    if (path.endsWith('/read-url')) return json({ mode: 'authorized_stream', url: '/v1/media/' + a.id + '/content', expiresAt: new Date(Date.now() + 60000).toISOString(), authorizationVersion: 1, readProof: 'synthetic.' + 'a'.repeat(43) })
    entered(); return gate.promise
  })
  h.render(owner, [{ target: draftId, media: [a] }]); await started
  const next = h.render(ctx(), [], false); assert.deepEqual(Object.keys(next.urls), [])
  gate.resolve(new Response(new Blob(['test'], { type: 'image/webp' }))); await settle()
  assert.equal(h.created.length, 0); h.flush(); h.unmount(); assert.equal(h.afterUnmount, 0)
})

test('person allocation and complete acknowledgements use distinct purpose while ready retry does not reupload', async () => {
  const owner = ctx(), draftId = randomUUID(), a = photo(), slot = randomUUID(), requests = []; let ready = false
  const descriptor = () => ({ ...a, purpose: 'person_photo', status: ready ? 'ready' : 'awaiting_upload', authorizationVersion: 1, mimeType: ready ? 'image/webp' : 'image/jpeg', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
  const h = await harness(async (path, init) => {
    requests.push({ path, init })
    if (path === '/v1/media') return json({ media: descriptor(), upload: { id: slot, method: 'PUT', url: '/v1/media/' + a.id + '/uploads/' + slot, requiredHeaders: { 'Content-Type': 'image/jpeg' }, expiresAt: new Date(Date.now() + 60000).toISOString() } })
    if (init.method === 'PUT') { assert.equal(init.body.size, 4); return new Response(null, { status: 204 }) }
    if (path.endsWith('/complete')) { ready = true; return json(descriptor()) }
    return json(descriptor())
  })
  const client = new h.media.MediaClient({ ...owner, live: () => true }, 'person_photo')
  const prepared = await h.media.preparePhotos(['data:image/jpeg;base64,dGVzdA=='])
  assert.deepEqual(Array.from(await client.upload(prepared, draftId)), [a.id]); assert.deepEqual(Array.from(await client.upload(prepared, draftId)), [a.id])
  const body = JSON.parse(requests[0].init.body); assert.equal(body.purpose, 'person_photo'); assert.deepEqual(body.target, { kind: 'person_draft', id: draftId })
  assert.equal(requests.filter(item => item.init.method === 'PUT').length, 1)
  await assert.rejects(() => client.upload(Array.from({ length: 7 }, () => prepared[0]), draftId), error => error.code === 'INVALID_PHOTO_INPUT')
  assert(![...h.storage.values()].some(value => value.includes('dGVzdA==') || value.includes('readProof')))
  client.dispose()
})

test('readding a removed person photo retires a gone upload receipt and allocates a fresh photo', async () => {
  const owner = ctx(), draftId = randomUUID(), a = photo(), b = photo(), allocations = []; let gone = false
  const descriptor = item => ({ ...item, purpose: 'person_photo', status: 'ready', authorizationVersion: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
  const h = await harness(async (path, init) => {
    if (path === '/v1/media') { allocations.push(init.headers.get('Idempotency-Key')); return json({ media: descriptor(gone ? b : a) }) }
    if (gone) return new Response(JSON.stringify({ error: { code: 'NOT_FOUND' } }), { status: 404 })
    return json(descriptor(a))
  })
  const client = new h.media.MediaClient({ ...owner, live: () => true }, 'person_photo'), prepared = await h.media.preparePhotos(['data:image/jpeg;base64,dGVzdA=='])
  assert.deepEqual(Array.from(await client.upload(prepared, draftId)), [a.id]); gone = true
  assert.deepEqual(Array.from(await client.upload(prepared, draftId)), [b.id]); assert.notEqual(allocations[0], allocations[1])
  client.dispose()
})
