import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'

const sources = {}
for (const name of ['serviceMedia.ts', 'serviceGiftPhotos.ts']) sources[name] = ts.transpileModule(await readFile(new URL('../src/' + name, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const json = data => new Response(JSON.stringify({ data, meta: { nextCursor: null } }), { headers: { 'Content-Type': 'application/json' } })
const deny = (status, code) => new Response(JSON.stringify({ error: { code } }), { status })
const settle = () => new Promise(resolve => setImmediate(resolve))
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const definition = { id: 'paper-crane', version: 1, render: 'crane', effect: 'keepsake' }
const photo = () => ({ id: randomUUID(), version: 3, mimeType: 'image/webp', byteSize: 4, width: 24, height: 24 })
const fixture = () => { const id = randomUUID(); return { id, accountId: randomUUID(), sessionId: randomUUID(), metadata: photo(), slot: randomUUID(),
  receipt: { id, status: 'arrived', lines: [{ giftId: definition.id, quantity: 1, snapshot: definition }] }, view: { deliveryId: id, version: 1, photo: null, updatedAt: null, origin: 'journey_capture' } } }
const captured = 'data:image/jpeg;base64,dGVzdA=='
async function harness(fetcher, storage = new Map()) {
  const created = [], revoked = [], snapshots = []; let live = true
  let si = 0, ri = 0, mi = 0, ei = 0, unmounted = false, afterUnmount = 0
  const states = [], refs = [], memos = [], effects = [], pending = [], listeners = new Map()
  const add = (name, fn) => { const values = listeners.get(name) ?? new Set(); values.add(fn); listeners.set(name, values) }
  const remove = (name, fn) => listeners.get(name)?.delete(fn)
  class BrowserURL extends URL {
    static createObjectURL(blob) { const url = 'blob:gift-' + created.length; created.push({ url, blob }); return url }
    static revokeObjectURL(url) { revoked.push(url) }
  }
  const document = { visibilityState: 'visible', addEventListener: add, removeEventListener: remove }
  const context = vm.createContext({ fetch: fetcher, crypto: globalThis.crypto, Blob, Headers, Response, AbortController, AbortSignal, DOMException, TextEncoder, URL: BrowserURL, atob, setTimeout, clearTimeout, document,
    window: { addEventListener: add, removeEventListener: remove, setInterval: () => 1, clearInterval() {} },
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } })
  const synthetic = (names, values) => new vm.SyntheticModule(names, function () { for (const name of names) this.setExport(name, values[name]) }, { context })
  const react = synthetic(['useState','useRef','useMemo','useEffect'], {
    useState(initial) { const i = si++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], value => { if (unmounted) afterUnmount++; states[i] = typeof value === 'function' ? value(states[i]) : value }] },
    useRef(initial) { const i = ri++; return refs[i] ?? (refs[i] = { current: initial }) },
    useMemo(fn, deps) { const i = mi++, old = memos[i]; if (!old || deps.some((value, j) => value !== old.deps[j])) memos[i] = { deps: [...deps], value: fn() }; return memos[i].value },
    useEffect(fn, deps) { const i = ei++, old = effects[i]; if (!old || deps.some((value, j) => value !== old.deps[j])) pending.push(() => { old?.cleanup?.(); effects[i] = { deps: [...deps], cleanup: fn() } }) },
  })
  const catalog = synthetic(['getGift'], { getGift: id => id === definition.id ? definition : undefined })
  const media = new vm.SourceTextModule(sources['serviceMedia.ts'], { context }); await media.link(() => { throw Error('Unexpected import') }); await media.evaluate()
  const module = new vm.SourceTextModule(sources['serviceGiftPhotos.ts'], { context }); await module.link(name => name === 'react' ? react : name === './serviceMedia' ? media : name === './gifts/catalog' ? catalog : Promise.reject(Error('Unexpected import ' + name))); await module.evaluate()
  const flush = () => { while (pending.length) pending.shift()() }
  return { api: module.namespace, media: media.namespace, storage, created, revoked, snapshots, document,
    client(f) { return new module.namespace.GiftPhotoClient({ accountId: f.accountId, sessionId: f.sessionId, live: () => live, onUnauthorized() {} }, value => snapshots.push(value)) },
    leave() { live = false }, render(ctx, runEffects = true) { si = ri = mi = ei = 0; const result = module.namespace.useServiceGiftPhotos(ctx); if (runEffects) flush(); return result }, flush,
    dispatch(name) { for (const fn of [...(listeners.get(name) ?? [])]) fn() }, get afterUnmount() { return afterUnmount }, unmount() { unmounted = true; effects.forEach(effect => effect?.cleanup?.()) } }
}
function server(f, custom = {}) {
  const calls = []; let ready = false, uploaded = false, view = f.view
  const descriptor = () => ({ ...f.metadata, purpose: 'gift_delivery_photo', status: ready ? 'ready' : 'awaiting_upload', mimeType: ready ? 'image/webp' : 'image/jpeg', byteSize: 4,
    authorizationVersion: 1, createdAt: '2026-11-13T00:00:00.000Z', updatedAt: '2026-11-13T00:00:00.000Z' })
  const transport = async (path, init = {}) => {
    const call = { path, init }; calls.push(call)
    if (custom.before) { const result = await custom.before(call); if (result !== undefined) return result }
    if (path.startsWith('/v1/gift-delivery-photos?')) return json(view.photo ? [view] : [])
    if (path === '/v1/gift-deliveries/' + f.id + '/photo') {
      if (init.method === 'PUT') {
        const previous = view
        view = { ...view, version: 2, photo: f.metadata, updatedAt: '2026-11-13T00:01:00.000Z' }
        if (custom.bind) return custom.bind(call, view, previous)
      }
      return json(view)
    }
    if (path === '/v1/media') return json({ media: descriptor(), upload: { id: f.slot, method: 'PUT', url: '/v1/media/' + f.metadata.id + '/uploads/' + f.slot,
      requiredHeaders: { 'Content-Type': 'image/jpeg' }, expiresAt: new Date(Date.now() + 60000).toISOString() } })
    if (path.includes('/uploads/')) { uploaded = true; if (custom.upload) return custom.upload(call); return new Response(null, { status: 204 }) }
    if (path.endsWith('/complete')) {
      if (!uploaded) return deny(409, 'MEDIA_UPLOAD_NOT_COMPLETE')
      ready = true; if (custom.complete) return custom.complete(call, descriptor()); return json(descriptor())
    }
    if (path.endsWith('/read-url')) return json({ mode: 'authorized_stream', url: '/v1/media/' + f.metadata.id + '/content', expiresAt: new Date(Date.now() + 60000).toISOString(), authorizationVersion: 1, readProof: 'synthetic.' + 'a'.repeat(43) })
    if (path.endsWith('/content')) { if (custom.content) return custom.content(call); return new Response(new Blob(['test'], { type: 'image/webp' })) }
    if (path === '/v1/media/' + f.metadata.id) return json(descriptor())
    throw Error('Unexpected request ' + path)
  }
  return { transport, calls, get view() { return view }, set view(value) { view = value } }
}

test('journeys require authoritative arrival and a compatible historical render template', async () => {
  const h = await harness(() => { throw Error('Unexpected request') }), f = fixture(), client = h.client(f)
  assert.equal(h.api.compatibleJourney(f.receipt), true)
  for (const receipt of [{ ...f.receipt, status: 'in_transit' }, { ...f.receipt, lines: [] }, { ...f.receipt, lines: [{ ...f.receipt.lines[0], snapshot: { ...definition, render: 'flower' } }] }, { ...f.receipt, lines: [{ ...f.receipt.lines[0], snapshot: { ...definition, version: 2 } }] }]) {
    assert.equal(h.api.compatibleJourney(receipt), false)
    await assert.rejects(client.prepare(receipt), error => ['DELIVERY_NOT_ARRIVED','JOURNEY_UNAVAILABLE'].includes(error.code))
  }
  assert.throws(() => h.api.validateGiftPhoto({ ...f.view, version: 2 }), error => error.code === 'INVALID_GIFT_PHOTO_RESPONSE')
})

test('canvas capture uses one private gift target and independent CAS, without delivery or asset writes', async () => {
  const f = fixture(), s = server(f), h = await harness(s.transport), client = h.client(f)
  const view = await client.prepare(f.receipt); assert.equal(view.version, 1)
  await client.save(f.id, view.version, captured, 0)
  const allocation = JSON.parse(s.calls.find(call => call.path === '/v1/media').init.body)
  assert.deepEqual(allocation.target, { kind: 'gift_delivery', id: f.id }); assert.equal(allocation.purpose, 'gift_delivery_photo')
  const binding = s.calls.find(call => call.init.method === 'PUT' && call.path.endsWith('/photo'))
  assert.equal(binding.init.headers.get('If-Match'), '"v1"'); assert.deepEqual(JSON.parse(binding.init.body), { mediaId: f.metadata.id })
  assert.equal(h.snapshots.at(-1).urls[f.id], 'blob:gift-0')
  const read = s.calls.find(call => call.path.endsWith('/read-url'))
  assert.deepEqual(JSON.parse(read.init.body), { purpose: 'gift_delivery_photo', target: { kind: 'gift_delivery', id: f.id } })
  assert(s.calls.every(call => call.init.headers.get('X-Xijie-Expected-Session') === f.sessionId))
  assert(!s.calls.some(call => /wallet|notifications|received-gifts|conversations/.test(call.path)))
  assert.equal(client.pending(f.id), undefined); assert.equal(h.storage.size, 0)
  client.dispose(); assert.deepEqual(h.revoked, ['blob:gift-0'])
})

test('lost photo PUT is recovered after remount with original key, If-Match and media ID', async () => {
  const f = fixture(); let count = 0
  const s = server(f, { bind: (_call, view) => { if (++count === 1) throw new TypeError('Synthetic response loss'); return json(view) } })
  const h = await harness(s.transport), first = h.client(f)
  await assert.rejects(first.save(f.id, 1, captured, 0)); const intent = first.pending(f.id)
  assert.equal(intent.mediaId, f.metadata.id); assert(![...h.storage.values()].some(value => /dGVzdA|readProof|blob:/.test(value)))
  first.dispose(); const second = h.client(f); await second.retry(f.id)
  const puts = s.calls.filter(call => call.path.endsWith('/photo') && call.init.method === 'PUT')
  assert.equal(puts.length, 2); assert.equal(puts[0].init.headers.get('Idempotency-Key'), puts[1].init.headers.get('Idempotency-Key'))
  assert.equal(puts[1].init.headers.get('If-Match'), '"v1"'); assert.equal(puts[0].init.body, puts[1].init.body)
  assert.equal(s.calls.filter(call => call.path.includes('/uploads/')).length, 1)
  assert.equal(second.pending(f.id), undefined); assert.equal(h.snapshots.at(-1).urls[f.id], 'blob:gift-0'); second.dispose()
})

for (const stage of ['upload','complete']) test('lost ' + stage + ' acknowledgement resumes original upload metadata without bytes after remount', async () => {
  const f = fixture(); let lost = false
  const s = server(f, { [stage]: (_call, value) => { if (!lost) { lost = true; throw new TypeError('Synthetic response loss') }; return value ? json(value) : new Response(null, { status: 204 }) } })
  const h = await harness(s.transport), first = h.client(f)
  await assert.rejects(first.save(f.id, 1, captured, 0)); const intent = first.pending(f.id); assert(!intent.mediaId)
  first.dispose(); const second = h.client(f); await second.retry(f.id)
  assert.equal(s.calls.filter(call => call.path.includes('/uploads/')).length, 1)
  assert.equal(s.calls.find(call => call.path.endsWith('/photo') && call.init.method === 'PUT').init.headers.get('Idempotency-Key'), intent.key)
  assert.equal(second.pending(f.id), undefined); second.dispose()
})

test('postcommit authorization errors retain the binding command and replay current replacement rather than the old media', async () => {
  const f = fixture(), replacement = photo(); let count = 0
  const current = { ...f.view, version: 4, photo: replacement, updatedAt: '2026-11-13T00:03:00.000Z' }
  const s = server(f, { bind: () => ++count === 1 ? deny(409, 'AUTHORIZATION_CHANGED') : json(current), before: call => {
    if (call.path === '/v1/media/' + replacement.id + '/read-url') return json({ mode: 'authorized_stream', url: '/v1/media/' + replacement.id + '/content', expiresAt: new Date(Date.now() + 60000).toISOString(), authorizationVersion: 3, readProof: 'synthetic.' + 'a'.repeat(43) })
    if (call.path === '/v1/media/' + replacement.id + '/content') return new Response(new Blob(['new!'], { type: 'image/webp' }))
  } })
  const h = await harness(s.transport), client = h.client(f)
  await assert.rejects(client.save(f.id, 1, captured, 0), error => error.code === 'AUTHORIZATION_CHANGED')
  const intent = client.pending(f.id); client.invalidate(); await client.retry(f.id)
  assert.equal(s.calls.filter(call => call.path.endsWith('/photo') && call.init.method === 'PUT')[1].init.headers.get('Idempotency-Key'), intent.key)
  assert.equal(await h.created[0].blob.text(), 'new!'); assert.equal(client.pending(f.id), undefined); client.dispose()
})

test('replacement conflict preserves the authoritative photo and does not automatically rebase the write', async () => {
  const f = fixture(); const s = server(f, { bind: () => deny(412, 'VERSION_CONFLICT') }), h = await harness(s.transport), client = h.client(f)
  await assert.rejects(client.save(f.id, 1, captured, 0), error => error.code === 'VERSION_CONFLICT')
  for (let i = 0; i < 5; i++) await settle()
  assert.equal(client.pending(f.id), undefined); assert.equal(s.calls.filter(call => call.path.endsWith('/photo') && call.init.method === 'PUT').length, 1)
  assert(h.snapshots.at(-1).urls[f.id]); client.dispose()
})

test('withdrawal removes blobs and fences late private bytes, late writes, and an old journey capture', async () => {
  const f = fixture(), gate = defer(); let entered
  const started = new Promise(resolve => { entered = resolve })
  const s = server(f, { content: () => { entered(); return gate.promise } }); s.view = { ...f.view, version: 2, photo: f.metadata, updatedAt: '2026-11-13T00:01:00.000Z' }
  const h = await harness(s.transport), client = h.client(f), refresh = client.refresh(); await started
  client.invalidate(); gate.resolve(new Response(new Blob(['test'], { type: 'image/webp' }))); await refresh
  assert.equal(h.created.length, 0); assert.deepEqual(Object.keys(h.snapshots.at(-1).urls), [])
  await assert.rejects(client.save(f.id, 1, captured, 0), error => error.name === 'AbortError')
  const late = defer(), bindingStarted = defer(), secondFixture = fixture(), s2 = server(secondFixture, { bind: () => { bindingStarted.resolve(); return late.promise } }), h2 = await harness(s2.transport), second = h2.client(secondFixture)
  const saving = second.save(secondFixture.id, 1, captured, 0)
  await bindingStarted.promise
  assert(second.pending(secondFixture.id)?.mediaId)
  second.invalidate(); late.resolve(json({ ...secondFixture.view, version: 2, photo: secondFixture.metadata, updatedAt: '2026-11-13T00:01:00.000Z' }))
  await assert.rejects(saving, error => error.name === 'AbortError'); assert(second.pending(secondFixture.id)); assert.equal(h2.created.length, 0)
  client.dispose(); second.dispose()
})

test('new account fences pending old responses and missing photo permission reads no other business resources', async () => {
  const f = fixture(), gate = defer(), h = await harness(() => gate.promise), client = h.client(f), refresh = client.refresh()
  h.leave(); gate.resolve(json([{ ...f.view, version: 2, photo: f.metadata, updatedAt: '2026-11-13T00:01:00.000Z' }])); await refresh
  assert.equal(h.created.length, 0); assert.equal(h.snapshots.length, 0)
  const calls = [], denied = await harness(async path => { calls.push(path); return deny(403, 'GIFT_PHOTO_PERMISSION_REQUIRED') }), ungranted = denied.client(f)
  await ungranted.refresh(); assert.equal(denied.snapshots.at(-1).error, 'GIFT_PHOTO_PERMISSION_REQUIRED'); assert.equal(calls.length, 1)
  assert(calls[0].startsWith('/v1/gift-delivery-photos?')); client.dispose(); ungranted.dispose()
})

test('failed replacement keeps the existing private photo and a new completed watch uses a fresh capture identity', async () => {
  const f = fixture(); let fail = false
  const s = server(f, { before: call => { if (fail && call.path === '/v1/media') throw new TypeError('Offline') } }), h = await harness(s.transport), client = h.client(f)
  await client.save(f.id, 1, captured, 0); const original = h.snapshots.at(-1).urls[f.id]
  // A changed scene has different capture bytes; its failed upload must not
  // replace or clear the committed reference displayed by the old receipt.
  fail = true
  await assert.rejects(client.save(f.id, 2, 'data:image/jpeg;base64,bmV3IQ==', 0))
  assert.equal(h.snapshots.at(-1).urls[f.id], original); assert(client.pending(f.id))
  const allocations = s.calls.filter(call => call.path === '/v1/media')
  assert.equal(allocations.length, 2); assert.notEqual(allocations[0].init.headers.get('Idempotency-Key'), allocations[1].init.headers.get('Idempotency-Key'))
  client.dispose()
})

test('hook clears displayed URLs on withdrawal and on the first new-session render before effect cleanup', async () => {
  const f = fixture(), s = server(f); let allowed = true
  s.view = { ...f.view, version: 2, photo: f.metadata, updatedAt: '2026-11-13T00:01:00.000Z' }
  const h = await harness((path, init) => allowed ? s.transport(path, init) : Promise.resolve(deny(403, 'GIFT_PHOTO_PERMISSION_REQUIRED')))
  const owner = { accountId: f.accountId, sessionId: f.sessionId, onUnauthorized() {} }
  h.render(owner); for (let i = 0; i < 10 && !h.created.length; i++) await settle()
  assert(h.render(owner).urls[f.id]); allowed = false; h.dispatch('xijie:consents-changed')
  assert.equal(h.revoked.length, 1); assert.deepEqual(Object.keys(h.render(owner).urls), [])
  await settle(); allowed = true; h.dispatch('focus'); for (let i = 0; i < 10 && h.created.length < 2; i++) await settle()
  assert(h.render(owner).urls[f.id])
  const next = h.render({ ...owner, sessionId: randomUUID() }, false); assert.deepEqual(Object.keys(next.urls), [])
  h.flush(); h.unmount(); for (let i = 0; i < 3; i++) await settle(); assert.equal(h.afterUnmount, 0)
})

test('gift upload authorization change never silently allocates under a new permission', async () => {
  const f = fixture(), calls = [], h = await harness(async (path, init) => { calls.push({ path, init }); return deny(409, 'AUTHORIZATION_CHANGED') })
  const client = new h.media.MediaClient({ accountId: f.accountId, sessionId: f.sessionId, live: () => true, onUnauthorized() {} }, 'gift_delivery_photo')
  const prepared = await h.media.preparePhotos([captured]), operationKey = randomUUID()
  for (let i = 0; i < 2; i++) await assert.rejects(client.upload(prepared, f.id, operationKey), error => error.code === 'AUTHORIZATION_CHANGED')
  assert.equal(calls[0].init.headers.get('Idempotency-Key'), calls[1].init.headers.get('Idempotency-Key')); client.dispose()
})
