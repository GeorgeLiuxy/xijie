import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'

const json = (data, meta) => new Response(JSON.stringify({ data, ...(meta ? { meta } : {}) }))
const denied = status => new Response('{}', { status })
const defer = () => { let resolve; const promise = new Promise(value => { resolve = value }); return { promise, resolve } }
const consent = (allowed = true) => ({
  currentAuthorizationVersions: { privacy_notice: 1, private_story_storage: 1 },
  currentDecisions: { privacy_notice: 'acknowledge', private_story_storage: 'grant' },
  storyStorage: { allowed, authorizationVersion: 1, ...(allowed ? { privateFeedAllowed: true } : {}) },
  personPhotoStorage: { allowed, authorizationVersion: 1 },
})
const policies = ['privacy_notice', 'private_story_storage'].map(kind => ({ id: randomUUID(), kind, version: 1, documentUrl: '/v1/policies/' + kind }))
const savedDraft = body => ({ id: randomUUID(), status: 'draft', version: 1, updatedAt: new Date().toISOString(), media: [], ...body })
const code = ts.transpileModule(await readFile(new URL('../src/auth/PeopleDraftExperience.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React },
}).outputText

// Exercise the real draft hook and Sheet element contract with controlled I/O.
// The shared statement's own agreement client and actual device are separate checks.
async function harness(fetcher, options = {}) {
  let stateIndex = 0, refIndex = 0, effectIndex = 0, unauthorized = 0
  const states = [], refs = [], effects = [], pending = [], calls = [], previews = []
  const createElement = (type, props, ...children) => ({ type, props: { ...props, children: children.length === 1 ? children[0] : children } })
  const context = vm.createContext({
    fetch: async (path, init) => { calls.push({ path, ...init, method: init?.method ?? 'GET' }); return fetcher(path, init) },
    Headers, URL, URLSearchParams, AbortController, DOMException, crypto: globalThis.crypto,
    location: { origin: 'http://localhost' }, document: { visibilityState: 'hidden', addEventListener() {}, removeEventListener() {} },
    window: { setTimeout, clearTimeout }, clearTimeout, console, React: { createElement },
  })
  const synthetic = values => new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value) }, { context })
  class MediaError extends Error { constructor(status) { super('Controlled media failure'); this.status = status } }
  function Sheet() {}
  function PrivacyStatement() {}
  const imports = {
    react: synthetic({
      useCallback: value => value,
      useState(initial) { const i = stateIndex++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value }] },
      useRef(initial) { const i = refIndex++; return refs[i] ?? (refs[i] = { current: initial }) },
      useEffect(fn, deps) { const i = effectIndex++, old = effects[i]; if (!old || deps.some((value, j) => value !== old.deps[j])) pending.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: fn() } }) },
    }),
    '../i18n': synthetic({ useI18n: () => ({ lang: 'zh-CN' }), isZh: () => true, WORLD_IDS: ['courtyard'] }),
    '../ui': synthetic({ Sheet }), './PrivacyStatement': synthetic({ PrivacyStatement }),
    '../serviceMedia': synthetic({ MediaError, preparePhotos: async photos => photos, socialPhotoDataUrl: async () => 'data:image/png;base64,cGhvdG8=' }),
    '../servicePersonPhotos': synthetic({ usePersonPhotoMedia: () => ({ urls: {}, client: options.photoDenied ? { upload: async () => { throw new MediaError(403) } } : undefined }), personPhotos: value => value.media ?? [] }),
    '../guestJournal': synthetic(Object.fromEntries(['prepareGuestPersonDraft','readGuestJournal','recordGuestPersonDraft'].map(key => [key, () => assert.fail('A normal draft must not touch guest storage')]))),
  }
  const module = new vm.SourceTextModule(code, { context })
  await module.link(spec => imports[spec] ?? Promise.reject(new Error('Unexpected import ' + spec))); await module.evaluate()
  const scope = { accountId: randomUUID(), sessionId: randomUUID(), onUnauthorized: () => { unauthorized++ } }
  const h = {
    scope, calls, previews, PrivacyStatement, Sheet,
    render(service = scope, flush = true) { stateIndex = refIndex = effectIndex = 0; const value = module.namespace.usePeopleDraft(service, () => {}, '', value => previews.push(value)); if (flush) h.flush(); return value },
    flush() { while (pending.length) pending.shift()() },
    sheets(api) { return module.namespace.PeopleDraftSheets({ draft: api, night: false }) },
    unmount() { effects.forEach(value => value?.cleanup?.()) },
    get unauthorized() { return unauthorized },
  }
  return h
}
const descendants = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(descendants) : [value, ...descendants(value.props?.children)]
function fill(h) { let api = h.render(); api.setField('displayName', '合成人物'); api.setField('story', '保留的原始故事'); return h.render() }
function statement(h, api) {
  const sheet = h.sheets(api), all = descendants(sheet), statements = all.filter(node => node.type === h.PrivacyStatement)
  assert.equal(sheet.type, h.Sheet); assert.equal(sheet.props.title, '隐私与 AI 使用声明')
  assert.equal(sheet.props.footer, undefined); assert.equal(statements.length, 1)
  assert.equal(all.filter(node => node.type === 'input' && node.props.type === 'checkbox').length, 0)
  assert.equal(statements[0].props.sessionId, h.scope.sessionId)
  assert.equal(statements[0].props.key, h.scope.sessionId)
  return statements[0]
}

test('a photo alone cannot start a service preview and a story can start without photos', async () => {
  const h = await harness(async route => { throw Error('Unexpected route ' + route) })
  let api = h.render()
  api.setField('displayName', '阿远')
  api.setField('story', '  ')
  api = h.render()
  await api.addPhotos([new File(['photo'], 'photo.png', { type: 'image/png' })])
  api = h.render()
  assert.equal(api.photos.length, 1)
  assert.equal(api.canPreview, false)
  await api.saveDraft('preview')
  api = h.render()
  assert.equal(api.feedback.kind, 'error')
  assert.equal(h.calls.length, 0)
  assert.equal(api.photos.length, 1)
  api.removePhoto(0)
  api.setField('story', 'TA 常在窗边看书。')
  api = h.render()
  assert.equal(api.photos.length, 0)
  assert.equal(api.canPreview, true)
  h.unmount()
})

test('one statement resumes the original save or preview only after a fresh authoritative read, without another grant', async t => {
  for (const mode of ['save', 'preview']) await t.test(mode, async () => {
    let allowed = false, draft
    const world = randomUUID(), preview = randomUUID()
    const h = await harness(async (route, init) => {
      if (route === '/v1/accounts/me/consents') return json([], consent(allowed))
      if (route.startsWith('/v1/policies/current')) return json(policies)
      if (route === '/v1/person-drafts' && init.method === 'POST') { draft = savedDraft(JSON.parse(init.body)); return json(draft) }
      if (route === '/v1/worlds') return json([{ id: world, code: 'courtyard', enabled: true }])
      if (route.endsWith('/previews') && init.method === 'POST') { assert.equal(JSON.parse(init.body).worldPreferenceId, world); return json({ id: preview }) }
      if (route.endsWith('/previews/' + preview)) return json({ id: preview, status: 'succeeded', renderMode: 'user_input', draftVersion: 1, suggestedWorldId: world })
      throw Error('Unexpected route ' + route)
    })
    let api = fill(h); await api.saveDraft(mode, 'courtyard'); api = h.render()
    assert.equal(api.permission.mode, mode); assert.equal(h.calls.filter(call => call.method !== 'GET').length, 0)
    const component = statement(h, api), before = h.calls.length
    allowed = true; await component.props.onAgreed(); api = h.render()
    assert.equal(h.calls[before].path, '/v1/accounts/me/consents')
    assert.equal(h.calls.filter(call => call.path === '/v1/person-drafts' && call.method === 'POST').length, 1)
    assert.equal(h.calls.filter(call => call.path === '/v1/accounts/me/consents' && call.method === 'POST').length, 0)
    assert.equal(api.fields.story, '保留的原始故事'); assert.equal(api.permission, null)
    assert.equal(api.journey?.preview.id, mode === 'preview' ? preview : undefined)
    assert.deepEqual(h.previews, mode === 'preview' ? ['courtyard'] : [])
    assert(h.calls.every(call => call.headers.get('X-Xijie-Expected-Session') === h.scope.sessionId))
    h.unmount()
  })
})

test('a grant decision alone, stale notice or stale authorization cannot resume a draft', async t => {
  const states = {
    allowedFalse: { ...consent(), storyStorage: { allowed: false, authorizationVersion: 1, privateFeedAllowed: true } },
    privateFeedFalse: { ...consent(), storyStorage: { allowed: true, authorizationVersion: 1, privateFeedAllowed: false } },
    noticeMissing: { ...consent(), currentDecisions: { private_story_storage: 'grant' } },
    noticeVersionZero: { ...consent(), currentAuthorizationVersions: { privacy_notice: 0, private_story_storage: 1 } },
    authorityVersionChanged: { ...consent(), storyStorage: { allowed: true, authorizationVersion: 2, privateFeedAllowed: true } },
  }
  for (const [name, current] of Object.entries(states)) await t.test(name, async () => {
    let state = consent(false)
    const h = await harness(async route => route === '/v1/accounts/me/consents' ? json([], state) : route.startsWith('/v1/policies/current') ? json(policies) : assert.fail('No write without current authority'))
    let api = fill(h); await api.saveDraft('preview'); api = h.render(); state = current
    await api.confirmAgreement(); api = h.render()
    assert.equal(api.permission.mode, 'preview'); assert.equal(api.fields.story, '保留的原始故事'); assert.equal(api.feedback.kind, 'error')
    assert.equal(h.calls.filter(call => call.method !== 'GET').length, 0); h.unmount()
  })
})

test('closing the statement preserves the draft and retires an already captured continuation', async () => {
  const h = await harness(async route => route === '/v1/accounts/me/consents' ? json([], consent(false)) : json(policies))
  let api = fill(h); await api.saveDraft('preview'); api = h.render(); const old = statement(h, api).props.onAgreed
  h.sheets(api).props.onClose(); const before = h.calls.length; await old(); api = h.render()
  assert.equal(h.calls.length, before); assert.equal(api.permission, null); assert.equal(api.fields.displayName, '合成人物'); assert.equal(api.fields.story, '保留的原始故事'); assert.equal(api.dirty, true); h.unmount()
})

test('rapid agreement callbacks serialize one continuation, and the completed callback cannot save twice', async () => {
  const gate = defer(); let reads = 0
  const h = await harness(async (route, init) => {
    if (route === '/v1/accounts/me/consents') return ++reads === 1 ? json([], consent(false)) : gate.promise
    if (route.startsWith('/v1/policies/current')) return json(policies)
    if (route === '/v1/person-drafts') return json(savedDraft(JSON.parse(init.body)))
    throw Error(route)
  })
  let api = fill(h); await api.saveDraft(); api = h.render(); const callback = api.confirmAgreement
  const first = callback(), second = callback(); gate.resolve(json([], consent())); await Promise.all([first, second]); await callback()
  assert.equal(h.calls.filter(call => call.method === 'POST').length, 1); assert.equal(reads, 2); h.unmount()
})

test('401 during agreement readback reports unauthorized and keeps entered fields', async () => {
  let reads = 0
  const h = await harness(async route => route === '/v1/accounts/me/consents' ? ++reads === 1 ? json([], consent(false)) : denied(401) : json(policies))
  let api = fill(h); await api.saveDraft(); api = h.render(); await api.confirmAgreement(); api = h.render()
  assert.equal(h.unauthorized, 1); assert.equal(api.fields.story, '保留的原始故事'); assert.equal(api.permission.mode, 'save'); assert.equal(h.calls.filter(call => call.method !== 'GET').length, 0); h.unmount()
})

test('a failed agreement read can be retried in the same mode without another grant or lost input', async () => {
  let reads = 0
  const h = await harness(async (route, init) => {
    if (route === '/v1/accounts/me/consents') return ++reads === 1 ? json([], consent(false)) : reads === 2 ? denied(503) : json([], consent())
    if (route.startsWith('/v1/policies/current')) return json(policies)
    if (route === '/v1/person-drafts') return json(savedDraft(JSON.parse(init.body)))
    throw Error(route)
  })
  let api = fill(h); await api.saveDraft(); api = h.render(); await api.confirmAgreement(); api = h.render()
  assert.equal(api.permission.mode, 'save'); assert.equal(api.fields.story, '保留的原始故事'); assert.equal(api.feedback.kind, 'error')
  assert.equal(h.calls.filter(call => call.method !== 'GET').length, 0)
  await api.confirmAgreement(); api = h.render(); assert.equal(api.permission, null); assert.equal(api.dirty, false)
  assert.equal(h.calls.filter(call => call.method === 'POST').length, 1); assert.equal(h.calls.filter(call => call.path === '/v1/accounts/me/consents' && call.method === 'POST').length, 0); h.unmount()
})

test('an old-session agreement cannot continue before effect cleanup or after a late read', async () => {
  const gate = defer(), started = defer(); let reads = 0
  const h = await harness(async route => {
    if (route === '/v1/accounts/me/consents') { if (++reads === 1) return json([], consent(false)); started.resolve(); return gate.promise }
    return json(policies)
  })
  let api = fill(h); await api.saveDraft('preview'); api = h.render(); const old = api, continuing = old.confirmAgreement(); await started.promise
  const next = { ...h.scope, sessionId: randomUUID() }; h.render(next, false)
  const before = h.calls.length; await old.confirmAgreement(); old.agreementContext.onUnauthorized(); assert.equal(h.calls.length, before); assert.equal(h.unauthorized, 0)
  gate.resolve(json([], consent())); await continuing
  api = h.render(next); assert.equal(h.calls.filter(call => call.method !== 'GET').length, 0); assert.equal(h.previews.length, 0); assert.equal(api.fields.story, '保留的原始故事'); h.unmount()
})

test('advanced management still withdraws with the original version and returns to the draft picker', async () => {
  let current = consent()
  const h = await harness(async (route, init) => {
    if (route === '/v1/accounts/me/consents' && init.method === 'POST') { const body = JSON.parse(init.body); assert.equal(body.purpose, 'private_story_storage'); assert.equal(body.decision, 'revoke'); assert.equal(body.expectedAuthorizationVersion, 1); assert.equal(body.policyId, policies[1].id); current = { ...consent(false), currentAuthorizationVersions: { privacy_notice: 1, private_story_storage: 2 }, currentDecisions: { privacy_notice: 'acknowledge', private_story_storage: 'revoke' }, storyStorage: { allowed: false, authorizationVersion: 2 } }; return json({}) }
    if (route === '/v1/accounts/me/consents') return json([], current)
    if (route.startsWith('/v1/policies/current')) return json(policies)
    throw Error(route)
  })
  let api = fill(h); await api.openPermissions(); api = h.render(); const sheet = h.sheets(api)
  assert.equal(api.permission.mode, 'manage'); assert.equal(descendants(sheet).filter(node => node.type === h.PrivacyStatement).length, 0)
  await api.withdrawPermission(); api = h.render(); assert.equal(api.permission.consent.currentDecisions.private_story_storage, 'revoke'); assert.equal(h.calls.filter(call => call.method === 'POST').length, 1)
  api.dismissPermission(); api = h.render(); assert.equal(api.picker, true); assert.equal(api.fields.story, '保留的原始故事'); h.unmount()
})

test('photo agreement uses the same statement, rechecks its purpose, and returns without retransmitting or discarding photos', async () => {
  let photoAllowed = false
  const h = await harness(async (route, init) => {
    if (route === '/v1/accounts/me/consents') return json([], { ...consent(), personPhotoStorage: { allowed: photoAllowed, authorizationVersion: 1 } })
    if (route === '/v1/person-drafts') return json(savedDraft(JSON.parse(init.body)))
    throw Error(route)
  }, { photoDenied: true })
  let api = fill(h); await api.addPhotos([{}]); api = h.render(); await api.saveDraft(); api = h.render()
  assert(api.photoPermission); statement(h, api); const savedPhotos = [...api.photos]
  await api.confirmPhotoAgreement(); api = h.render(); assert(api.photoPermission); assert.equal(api.feedback.kind, 'error')
  photoAllowed = true; const before = h.calls.length; await api.confirmPhotoAgreement(); api = h.render()
  assert.equal(h.calls[before].path, '/v1/accounts/me/consents'); assert.equal(api.photoPermission, undefined); assert.deepEqual(Array.from(api.photos), savedPhotos); assert.equal(api.fields.story, '保留的原始故事')
  assert.equal(h.calls.filter(call => call.method === 'POST').length, 1); h.unmount()
})

test('closing the photo statement aborts its continuation and keeps the selected photo and original draft', async () => {
  const gate = defer(), started = defer(); let reads = 0
  const h = await harness(async (route, init) => {
    if (route === '/v1/accounts/me/consents') { if (++reads === 1) return json([], consent()); started.resolve(); return gate.promise }
    if (route === '/v1/person-drafts') return json(savedDraft(JSON.parse(init.body)))
    throw Error(route)
  }, { photoDenied: true })
  let api = fill(h); await api.addPhotos([{}]); api = h.render(); await api.saveDraft(); api = h.render()
  const originalPhotos = [...api.photos], callback = statement(h, api).props.onAgreed, continuing = callback(); await started.promise
  api = h.render(); api.closePhotoPermission(); const before = h.calls.length; await callback(); gate.resolve(json([], consent())); await continuing; api = h.render()
  assert.equal(h.calls.length, before); assert.equal(api.photoPermission, undefined); assert.equal(api.busy, false); assert.equal(api.fields.story, '保留的原始故事'); assert.deepEqual(Array.from(api.photos), originalPhotos)
  assert.equal(h.calls.filter(call => call.method === 'POST').length, 1); h.unmount()
})
