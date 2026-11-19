import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'

const source = Object.fromEntries(await Promise.all(['consentPurposes', 'consentBundle'].map(async name => [name,
  ts.transpileModule(await readFile(new URL('../src/auth/' + name + '.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText,
])))
const json = (data, meta) => new Response(JSON.stringify({ data, ...(meta ? { meta } : {}) }), { headers: { 'Content-Type': 'application/json' } })
const deny = (status, code) => new Response(JSON.stringify({ error: { code } }), { status })
const copy = value => JSON.parse(JSON.stringify(value))
const storage = () => {
  const map = new Map()
  return { map, getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) }
}

async function harness(store = storage()) {
  const calls = [], events = [], changed = [], unauthorized = []
  let fetcher
  const sandbox = vm.createContext({
    fetch: (...args) => fetcher(...args), Headers, Response, AbortSignal, AbortController, DOMException, crypto: globalThis.crypto, Event,
    sessionStorage: store, window: { dispatchEvent: event => events.push(event.type) },
  })
  const modules = Object.fromEntries(Object.entries(source).map(([name, code]) => [name, new vm.SourceTextModule(code, { context: sandbox })]))
  await modules.consentBundle.link(name => { assert.equal(name, './consentPurposes'); return modules.consentPurposes })
  await modules.consentBundle.evaluate()
  const definitions = copy(modules.consentPurposes.namespace.consentPurposes)
  const purposes = ['privacy_notice', ...definitions.map(item => item.purpose)]
  const policies = new Map(purposes.map(kind => [kind, { id: randomUUID(), kind, version: 1, ...(kind === 'ai_text_processing' ? { privateFeedProcessingEnabled: true } : {}) }]))
  const accounts = new Map(), receipts = new Map(), writes = []
  const sessionId = randomUUID()
  let cookieSession = sessionId, afterPost, beforeFetch, metaTransform = value => value, policyTransform = value => value
  const state = id => {
    if (!accounts.has(id)) accounts.set(id, new Map())
    return accounts.get(id)
  }
  const record = (id, purpose) => state(id).get(purpose)
  const active = (id, purpose) => {
    const value = record(id, purpose), policy = policies.get(purpose)
    return value?.policyId === policy.id && value.version === policy.version ? value : undefined
  }
  const meta = id => {
    const currentAuthorizationVersions = {}, currentDecisions = {}, result = { currentAuthorizationVersions, currentDecisions }
    for (const purpose of purposes) {
      currentAuthorizationVersions[purpose] = record(id, purpose)?.authorizationVersion ?? 0
      const current = active(id, purpose)
      if (current) currentDecisions[purpose] = current.decision
    }
    const notice = active(id, 'privacy_notice')
    for (const { purpose, authority } of definitions) {
      const current = active(id, purpose)
      const allowed = !!notice && notice.decision === 'acknowledge' && current?.decision === 'grant' && current.noticeVersion === notice.authorizationVersion
      result[authority] = { allowed, authorizationVersion: currentAuthorizationVersions[purpose],
        ...(allowed && purpose === 'private_story_storage' ? { privateFeedAllowed: true } : {}),
        ...(allowed && purpose === 'ai_text_processing' ? { privateFeedProcessingAllowed: true } : {}),
      }
    }
    return metaTransform(result)
  }
  fetcher = async (path, init = {}) => {
    const headers = new Headers(init.headers), id = headers.get('X-Xijie-Expected-Session')
    assert.equal(init.credentials, 'same-origin')
    assert.equal(init.cache, 'no-store')
    const call = { path, method: init.method ?? 'GET', expectedSession: id, key: headers.get('Idempotency-Key'), ...(init.body ? { body: JSON.parse(init.body) } : {}) }
    calls.push(call)
    const override = await beforeFetch?.(call)
    if (override) return override
    if (path.startsWith('/v1/policies/current?locale=')) {
      const locale = path.split('locale=')[1]
      return json(policyTransform([...policies.values()].map(value => ({ ...value, documentUrl: '/v1/policies/' + value.id + '/' + value.version + '?locale=' + locale }))))
    }
    if (path.startsWith('/v1/policies/')) {
      const wanted = [...policies.values()].find(policy => path.startsWith('/v1/policies/' + policy.id + '/' + policy.version + '?locale='))
      return wanted ? new Response('Current policy for ' + wanted.kind, { headers: { 'Content-Type': 'text/plain' } }) : deny(404, 'NOT_FOUND')
    }
    if (id !== cookieSession) return deny(401, 'UNAUTHENTICATED')
    if (path === '/v1/accounts/me/consents?limit=1') return json([], meta(id))
    assert.equal(path, '/v1/accounts/me/consents')
    assert.equal(call.method, 'POST')
    const body = call.body, existing = receipts.get(id + ':' + call.key)
    if (existing) return JSON.stringify(existing.body) === JSON.stringify(body) ? json(existing.result) : deny(409, 'IDEMPOTENCY_CONFLICT')
    const policy = policies.get(body.purpose)
    if (!policy || body.policyId !== policy.id || body.version !== policy.version || body.expectedAuthorizationVersion !== (record(id, body.purpose)?.authorizationVersion ?? 0)) return deny(412, 'VERSION_CONFLICT')
    if (body.decision === 'grant' && active(id, 'privacy_notice')?.decision !== 'acknowledge') return deny(403, 'FORBIDDEN')
    const result = { id: randomUUID(), policyId: body.policyId, version: body.version, purpose: body.purpose, decision: body.decision, authorizationVersion: body.expectedAuthorizationVersion + 1 }
    state(id).set(body.purpose, { ...result, noticeVersion: body.decision === 'grant' ? record(id, 'privacy_notice').authorizationVersion : null })
    receipts.set(id + ':' + call.key, { body: copy(body), result })
    writes.push({ sessionId: id, body: copy(body), key: call.key })
    await afterPost?.(call, result)
    return json(result)
  }
  const context = (id = sessionId) => ({ sessionId: id, onUnauthorized: () => unauthorized.push(id), onChanged: () => changed.push(id) })
  const client = (id = sessionId, controller = new AbortController()) => ({
    api: modules.consentBundle.namespace.consentBundle(context(id), controller.signal, 'zh-CN'), controller,
  })
  const seed = (purpose, id = sessionId) => {
    const policy = policies.get(purpose), version = (record(id, purpose)?.authorizationVersion ?? 0) + 1
    state(id).set(purpose, { policyId: policy.id, version: policy.version, purpose, decision: purpose === 'privacy_notice' ? 'acknowledge' : 'grant', authorizationVersion: version,
      noticeVersion: purpose === 'privacy_notice' ? null : record(id, 'privacy_notice').authorizationVersion })
  }
  const seedAll = (id = sessionId) => purposes.forEach(purpose => seed(purpose, id))
  return {
    client, sessionId, purposes, definitions, policies, store, calls, writes, changed, unauthorized, events, seed, seedAll, record,
    pendingKey: id => 'xijie.consent-bundle.intent.' + id,
    legacyKey: (id, purpose) => modules.consentPurposes.namespace.permissionIntentKey(id, purpose),
    set afterPost(value) { afterPost = value }, set beforeFetch(value) { beforeFetch = value },
    set metaTransform(value) { metaTransform = value }, set policyTransform(value) { policyTransform = value },
    switchSession(id) { cookieSession = id },
    async sendLegacy(id, key, body) { return fetcher('/v1/accounts/me/consents', { method: 'POST', headers: { 'X-Xijie-Expected-Session': id, 'Idempotency-Key': key }, body: JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' }) },
  }
}

test('loading is read-only; one explicit agreement records all 19 real decisions and does not re-acknowledge on later use', async () => {
  const h = await harness(), { api } = h.client()
  const shown = await api.load()
  assert.equal(shown.complete, false)
  assert.equal(shown.documents.length, 19)
  assert.equal(h.calls.filter(call => call.method === 'POST').length, 0)
  assert.equal((await api.grant(shown)).complete, true)
  assert.equal(h.writes.length, 19)
  assert.equal(h.writes[0].body.purpose, 'privacy_notice')
  assert.equal(h.writes[0].body.decision, 'acknowledge')
  assert.equal(new Set(h.writes.map(call => call.key)).size, 19)
  assert.equal(new Set(h.writes.map(call => call.body.purpose)).size, 19)
  assert(h.writes.every(call => call.sessionId === h.sessionId && call.body.expectedAuthorizationVersion === 0))
  assert.equal(h.changed.length, 1)
  assert.equal(h.events.filter(name => name === 'xijie:consents-changed').length, 1)
  assert.equal(api.hasPending, false)
  assert.equal((await api.grant(await api.load())).complete, true)
  assert.equal(h.writes.length, 19)
  assert.equal(h.record(h.sessionId, 'privacy_notice').authorizationVersion, 1)
})

test('a current notice acknowledged elsewhere is reused while missing purposes receive independent grants', async () => {
  const h = await harness(); h.seed('privacy_notice')
  const { api } = h.client(), shown = await api.load()
  assert.equal(shown.noticeAcknowledged, true)
  assert.equal((await api.grant(shown)).complete, true)
  assert.equal(h.writes.length, 18)
  assert(h.writes.every(call => call.body.decision === 'grant'))
  assert.equal(h.record(h.sessionId, 'privacy_notice').authorizationVersion, 1)
})

test('a lost committed response resumes the original step identity after remount without duplicating any grant', async () => {
  const h = await harness(), target = 'virtual_gift_storage'
  let lose = true
  h.afterPost = call => { if (call.body.purpose === target && lose) { lose = false; throw TypeError('Lost accepted response') } }
  let { api } = h.client()
  await assert.rejects(api.grant(await api.load()), /Lost accepted response/)
  assert.equal(api.hasPending, true)
  const saved = JSON.parse(h.store.getItem(h.pendingKey(h.sessionId)))
  assert.equal(saved.steps[0].body.purpose, target)
  assert.equal(h.record(h.sessionId, target).authorizationVersion, 1)
  ;({ api } = h.client())
  assert.equal(api.hasPending, true)
  assert.equal((await api.retry()).complete, true)
  const sent = h.calls.filter(call => call.method === 'POST' && call.body.purpose === target)
  assert.equal(sent.length, 2)
  assert.equal(sent[0].key, sent[1].key)
  assert.deepEqual(sent[0].body, sent[1].body)
  assert.equal(h.writes.length, 19)
  assert.equal(api.hasPending, false)
  assert.equal(h.store.getItem(h.pendingKey(h.sessionId)), null)
})

test('changed policy requires a newly displayed statement and click; stale pending operations cannot grant its new scope', async () => {
  const h = await harness(), { api } = h.client(), shown = await api.load()
  h.policies.get('ai_text_processing').version++
  await assert.rejects(api.grant(shown), error => error.status === 412 && error.code === 'CONSENT_CHANGED')
  assert.equal(h.writes.length, 0)
  assert.equal(api.hasPending, false)
  let lose = true
  h.afterPost = () => { if (lose) { lose = false; throw TypeError('Lost notice response') } }
  await assert.rejects(api.grant(await api.load()), /Lost notice response/)
  const accepted = h.writes.length
  h.policies.get('private_person_voice_storage').version++
  await assert.rejects(api.retry(), error => error.status === 412 && error.code === 'CONSENT_CHANGED')
  assert.equal(api.hasPending, false)
  assert.equal(h.store.getItem(h.pendingKey(h.sessionId)), null)
  assert.equal(h.writes.length, accepted)
  assert.equal((await api.grant(await api.load())).complete, true)
  assert.equal(h.record(h.sessionId, 'private_person_voice_storage').version, 2)
  assert.equal(h.record(h.sessionId, 'privacy_notice').authorizationVersion, 1)
})

test('stored grant decisions do not override false authority after a notice renewal', async () => {
  const h = await harness(); h.seedAll(); h.seed('privacy_notice')
  const { api } = h.client(), shown = await api.load()
  assert.equal(shown.noticeAcknowledged, true)
  assert.equal(shown.complete, false)
  assert(h.definitions.every(({ purpose }) => shown.allowed[purpose] === false))
  assert.equal((await api.grant(shown)).complete, true)
  assert.equal(h.writes.length, 18)
  assert(h.writes.every(call => call.body.decision === 'grant' && call.body.expectedAuthorizationVersion === 1))
  assert.equal(h.record(h.sessionId, 'privacy_notice').authorizationVersion, 2)
})

test('a policy replaced during submission stops the remaining old-scope grants without declaring success', async () => {
  const h = await harness(), { api } = h.client()
  h.afterPost = call => { if (call.body.purpose === 'privacy_notice') h.policies.get('ai_text_processing').version++ }
  await assert.rejects(api.grant(await api.load()), error => error.status === 412 && error.code === 'VERSION_CONFLICT')
  assert.equal(api.hasPending, false)
  assert(h.writes.length > 1 && h.writes.length < 19)
  assert.equal(h.writes.filter(call => call.body.purpose === 'ai_text_processing').length, 0)
  assert.equal(h.changed.length, 0)
  assert.equal(h.events.length, 0)
  const reviewed = await api.load()
  assert.equal(reviewed.complete, false)
  assert.equal((await api.grant(reviewed)).complete, true)
  assert.equal(h.record(h.sessionId, 'ai_text_processing').version, 2)
  assert.equal(h.record(h.sessionId, 'privacy_notice').authorizationVersion, 1)
})

test('a failed final read keeps confirmation pending and retry verifies completion without repeating mutations', async () => {
  const h = await harness(), { api } = h.client()
  let fail = true
  h.beforeFetch = call => {
    if (fail && h.writes.length === 19 && call.path === '/v1/accounts/me/consents?limit=1') {
      fail = false; return deny(503, 'SERVICE_UNAVAILABLE')
    }
  }
  await assert.rejects(api.grant(await api.load()), error => error.status === 503)
  assert.equal(h.writes.length, 19)
  assert.equal(h.changed.length, 0)
  assert.equal(h.events.length, 0)
  assert.equal(api.hasPending, true)
  assert.equal(JSON.parse(h.store.getItem(h.pendingKey(h.sessionId))).steps.length, 0)
  const restored = h.client().api
  assert.equal((await restored.retry()).complete, true)
  assert.equal(h.writes.length, 19)
  assert.equal(h.changed.length, 1)
  assert.equal(h.events.length, 1)
  assert.equal(restored.hasPending, false)
})

test('abort after a possible commit stops later steps and a different session cannot resume that intent', async () => {
  const h = await harness(), { api, controller } = h.client()
  h.afterPost = () => controller.abort()
  await assert.rejects(api.grant(await api.load()), error => error.name === 'AbortError')
  assert.equal(h.writes.length, 1)
  assert.equal(h.changed.length, 0)
  assert.equal(h.events.length, 0)
  assert.equal(api.hasPending, true)
  const original = h.store.getItem(h.pendingKey(h.sessionId)), other = randomUUID()
  h.switchSession(other)
  const next = h.client(other).api
  assert.equal(next.hasPending, false)
  assert.equal((await next.load()).complete, false)
  await assert.rejects(next.retry(), error => error.code === 'CONSENT_INTENT_MISSING')
  assert.equal(h.store.getItem(h.pendingKey(h.sessionId)), original)
  assert.equal(h.writes.length, 1)
})

test('switching the cookie session rejects the old expected session before any later grant', async () => {
  const h = await harness(), { api } = h.client()
  h.afterPost = () => h.switchSession(randomUUID())
  await assert.rejects(api.grant(await api.load()), error => error.status === 401)
  assert.equal(h.writes.length, 1)
  assert.deepEqual(h.unauthorized, [h.sessionId])
  assert.equal(h.changed.length, 0)
  assert.equal(h.events.length, 0)
})

test('abort while decoding an old authorization error cannot notify the replacement session', async () => {
  const h = await harness(), { api, controller } = h.client()
  let decoding, finish
  const started = new Promise(resolve => { decoding = resolve })
  h.beforeFetch = call => {
    if (call.path === '/v1/accounts/me/consents?limit=1') return {
      ok: false, status: 401,
      json: () => { decoding(); return new Promise(resolve => { finish = resolve }) },
    }
  }
  const reading = api.load()
  await started
  controller.abort()
  finish({ error: { code: 'UNAUTHENTICATED' } })
  await assert.rejects(reading, error => error.name === 'AbortError')
  assert.equal(h.unauthorized.length, 0)
  assert.equal(h.writes.length, 0)
})

test('an unsubmitted legacy withdrawal is fenced by a new counter and only proven superseded keys are cleared', async () => {
  const h = await harness(); h.seedAll()
  const target = 'ai_text_processing', policy = h.policies.get(target), key = randomUUID()
  const body = { policyId: policy.id, version: policy.version, purpose: target, decision: 'revoke', expectedAuthorizationVersion: 1 }
  const oldKey = h.legacyKey(h.sessionId, target)
  h.store.setItem(oldKey, JSON.stringify({ decision: 'revoke', steps: [{ key, body }] }))
  const unknownKey = h.legacyKey(h.sessionId, 'person_voice_calls')
  h.store.setItem(unknownKey, JSON.stringify({ decision: 'revoke', steps: [{ key: randomUUID(), body: { ...body, purpose: 'person_voice_calls', policyId: h.policies.get('person_voice_calls').id, expectedAuthorizationVersion: 5 } }] }))
  const otherSessionKey = h.legacyKey(randomUUID(), target), malformedKey = h.legacyKey(h.sessionId, 'private_person_photo_storage')
  h.store.setItem(otherSessionKey, 'other session retained'); h.store.setItem(malformedKey, '{bad')
  const { api } = h.client(), shown = await api.load()
  assert.equal(shown.complete, false, 'a pending old withdrawal must leave the primary agreement action available')
  assert.equal((await api.grant(shown)).complete, true)
  assert.equal(h.record(h.sessionId, target).authorizationVersion, 2)
  assert.equal((await h.sendLegacy(h.sessionId, key, body)).status, 412)
  assert.equal(h.store.getItem(oldKey), null)
  assert.notEqual(h.store.getItem(unknownKey), null)
  assert.equal(h.store.getItem(otherSessionKey), 'other session retained')
  assert.equal(h.store.getItem(malformedKey), '{bad')
  assert.equal(h.record(h.sessionId, 'privacy_notice').authorizationVersion, 1)
})

test('a pending old notice acknowledgement is fenced before grants so it cannot invalidate the completed agreement later', async () => {
  const h = await harness(); h.seedAll()
  const purpose = 'private_story_storage', notice = h.policies.get('privacy_notice'), oldNoticeKey = randomUUID()
  const body = { policyId: notice.id, version: notice.version, purpose: 'privacy_notice', decision: 'acknowledge', expectedAuthorizationVersion: 1 }
  const key = h.legacyKey(h.sessionId, purpose)
  h.store.setItem(key, JSON.stringify({ decision: 'grant', steps: [{ key: oldNoticeKey, body }, { key: randomUUID(), body: { policyId: h.policies.get(purpose).id, version: 1, purpose, decision: 'grant', expectedAuthorizationVersion: 1 } }] }))
  const { api } = h.client(), shown = await api.load()
  assert.equal(shown.complete, false)
  assert.equal((await api.grant(shown)).complete, true)
  assert.equal(h.record(h.sessionId, 'privacy_notice').authorizationVersion, 2)
  assert.equal(h.writes.length, 19)
  assert.equal((await h.sendLegacy(h.sessionId, oldNoticeKey, body)).status, 412)
  assert.equal(h.store.getItem(key), null)
})

test('invalid policy metadata or missing authority cannot trigger any consent mutation', async () => {
  for (const broken of ['foreignDocument', 'missingAuthority', 'versionMismatch']) {
    const h = await harness(), { api } = h.client()
    if (broken === 'foreignDocument') h.policyTransform = values => values.map(value => value.kind === 'person_voice_calls' ? { ...value, documentUrl: 'https://elsewhere.example/policy' } : value)
    else h.metaTransform = value => { if (broken === 'missingAuthority') delete value.voiceCalls; else value.voiceCalls.authorizationVersion = 5; return value }
    await assert.rejects(api.load(), error => error.code === 'INVALID_RESPONSE')
    assert.equal(h.calls.filter(call => call.method === 'POST').length, 0)
    assert.equal(h.store.getItem(h.pendingKey(h.sessionId)), null)
  }
})
