import 'reflect-metadata'
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { NestFactory } from '@nestjs/core'
import pg from 'pg'
import { ConsentStore } from '../dist/consent-store.js'
import { IdentityErrors, IdentityModule, identityHeaders } from '../dist/http.js'
import { IdentityStore } from '../dist/store.js'

const connectionString = process.env.XIJIE_TEST_DATABASE_URL
if (!connectionString) throw new Error('Set XIJIE_TEST_DATABASE_URL to a PostgreSQL integration test database.')

const { Pool } = pg
const hash = value => createHash('sha256').update(value).digest('hex')

async function session(store, subject) {
  const browserHash = randomUUID()
  const attemptId = randomUUID()
  const stateHash = randomUUID()
  const claimId = randomUUID()
  await store.begin({
    id: attemptId, browserHash, key: randomUUID(), purpose: 'sign_in', sessionHash: null,
    stateHash, nonce: randomUUID(), verifier: randomUUID(), authorizationUrl: 'https://id.example.test/oidc/auth',
    expiresAt: new Date(Date.now() + 60_000),
  })
  assert.equal((await store.claim({ browserHash, stateHash, claimId })).id, attemptId)
  const proof = randomBytes(32).toString('base64url')
  const sessionHash = hash(proof)
  assert.equal(await store.finish({
    browserHash, attemptId, claimId, sessionHash,
    principal: { issuer: 'https://id.example.test/oidc', subject, authenticatedAt: new Date() },
  }), true)
  const current = await store.current(sessionHash)
  return { id: current.id, accountId: current.accountId, cookie: 'xijie_dev_session=' + proof, sessionHash }
}

test('Policy and session-context endpoints enforce versioned, account-scoped authorization', async () => {
  const admin = new Pool({ connectionString })
  const schema = 'xijie_consent_test_' + randomUUID().replaceAll('-', '')
  const pool = new Pool({ connectionString, options: '-c search_path=' + schema })
  let app
  try {
    await admin.query('CREATE SCHEMA ' + schema)
    for (const migration of ['001_identity.sql', '002_consents.sql', '004_ai_text_processing.sql']) {
      await pool.query(await readFile(new URL('../db/' + migration, import.meta.url), 'utf8'))
    }
    const identity = new IdentityStore(pool)
    const consents = new ConsentStore(pool, identity)
    const peopleServiceToken = randomBytes(32).toString('hex')
    const config = { secure: false, origin: 'http://localhost:5184', clientSecret: randomUUID(), peopleServiceToken }
    app = await NestFactory.create(IdentityModule.register(config, identity, {}, consents), { logger: false, abortOnError: false })
    app.use(identityHeaders)
    app.useGlobalFilters(new IdentityErrors())
    await app.listen(0, '127.0.0.1')
    const origin = await app.getUrl()
    const alice = await session(identity, 'alice')
    const bob = await session(identity, 'bob')
    const auth = actor => ({ Cookie: actor.cookie, 'X-Xijie-Expected-Session': actor.id })
    const policies = async locale => {
      const result = await fetch(origin + '/v1/policies/current?locale=' + locale)
      assert.equal(result.status, 200)
      return (await result.json()).data
    }
    const zh = await policies('zh-CN')
    const en = await policies('en-US')
    assert.deepEqual(zh.map(p => p.id), en.map(p => p.id))
    assert.equal(zh.length, 3)
    const docs = await fetch(origin + en[0].documentUrl)
    assert.equal(docs.status, 200)
    assert.equal(docs.headers.get('content-language'), 'en')
    assert.match(await docs.text(), /sandbox/i)
    const cnDoc = await fetch(origin + zh[0].documentUrl)
    assert.equal(cnDoc.headers.get('content-language'), 'zh-CN')
    assert.notEqual(await cnDoc.text(), '')
    const notice = zh.find(policy => policy.kind === 'privacy_notice')
    const storage = zh.find(policy => policy.kind === 'private_story_storage')
    const decision = (policy, choice, authorizationVersion) => ({
      policyId: policy.id, version: policy.version, purpose: policy.kind, decision: choice,
      expectedAuthorizationVersion: authorizationVersion,
    })
    const record = (actor, body, key = randomUUID(), requestOrigin = config.origin) => fetch(origin + '/v1/accounts/me/consents', {
      method: 'POST',
      headers: { ...auth(actor), Origin: requestOrigin, 'Idempotency-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const history = (actor, query = '') => fetch(origin + '/v1/accounts/me/consents' + query, { headers: auth(actor) })
    const context = (actor, token = peopleServiceToken) => fetch(origin + '/internal/v1/session-context', {
      headers: { Cookie: actor.cookie, Authorization: 'Bearer ' + token },
    })

    assert.equal((await context(alice, '00'.repeat(32))).status, 403)
    const initial = await context(alice)
    assert.equal(initial.headers.get('cache-control'), 'no-store')
    assert.deepEqual((await initial.json()).data.storyStorage, { allowed: false, authorizationVersion: 0 })
    assert.equal((await record(alice, decision(storage, 'grant', 0))).status, 403)
    assert.equal((await record(alice, decision(notice, 'acknowledge', 0), randomUUID(), 'http://wrong.example')).status, 403)
    assert.equal((await record({ ...alice, id: bob.id }, decision(notice, 'acknowledge', 0))).status, 401)
    assert.equal((await record(alice, decision(notice, 'acknowledge', 0))).status, 201)
    assert.equal((await (await context(alice)).json()).data.storyStorage.allowed, false)

    const key = randomUUID()
    const grantBody = decision(storage, 'grant', 0)
    const responses = await Promise.all([record(alice, grantBody, key), record(alice, grantBody, key)])
    assert.deepEqual(responses.map(result => result.status), [201, 201])
    const [grant, replay] = await Promise.all(responses.map(async result => (await result.json()).data))
    assert.equal(grant.authorizationVersion, 1)
    assert.deepEqual(grant, replay)
    assert.equal((await record(alice, decision(storage, 'revoke', 1), key)).status, 409)
    const stale = await record(alice, decision(storage, 'revoke', 0))
    assert.equal(stale.status, 412)
    assert.equal((await stale.json()).error.details.currentAuthorizationVersion, 1)
    const allowed = (await (await context(alice)).json()).data
    assert.equal(allowed.accountId, alice.accountId)
    assert.equal(allowed.sessionId, alice.id)
    assert.deepEqual(allowed.storyStorage, { allowed: true, authorizationVersion: 1 })
    assert.equal((await (await context(bob)).json()).data.storyStorage.allowed, false)

    const firstPage = await (await history(alice, '?limit=1')).json()
    assert.deepEqual(firstPage.meta.currentDecisions, { privacy_notice: 'acknowledge', private_story_storage: 'grant' })
    assert.equal(firstPage.data[0].id, grant.id)
    const secondPage = '?limit=1&cursor=' + encodeURIComponent(firstPage.meta.nextCursor)
    assert.equal((await (await history(alice, secondPage)).json()).data[0].purpose, 'privacy_notice')
    assert.equal((await history(bob, secondPage)).status, 400)
    assert.equal((await history(bob, '?cursor=' + encodeURIComponent('a'.repeat(36) + '.' + '你'.repeat(43)))).status, 400)

    const revoke = await record(alice, decision(storage, 'revoke', 1))
    assert.equal(revoke.status, 201)
    assert.deepEqual((await (await context(alice)).json()).data.storyStorage, { allowed: false, authorizationVersion: 2 })
    const revocations = await pool.query("SELECT payload FROM outbox_events WHERE type = 'StoryStorageRevoked.v1' AND account_id = $1", [alice.accountId])
    assert.equal(revocations.rows.length, 1)
    assert.equal(revocations.rows[0].payload.authorizationVersion, 2)

    // A replacement policy invalidates prior permission without resetting the concurrency counter.
    await pool.query(`INSERT INTO policy_versions (id, kind, version, document_zh_cn, document_en)
      SELECT id, kind, 2, document_zh_cn, document_en FROM policy_versions WHERE id = $1 AND version = 1`, [storage.id])
    const replaced = await (await history(alice)).json()
    assert.equal(replaced.meta.currentDecisions.private_story_storage, undefined)
    assert.equal(replaced.meta.currentAuthorizationVersions.private_story_storage, 2)
    assert.equal((await record(alice, decision(storage, 'grant', 2))).status, 412)

    await identity.logout(alice.sessionHash)
    assert.equal((await context(alice)).status, 401)
    assert.equal((await record(alice, decision({ ...storage, version: 2 }, 'grant', 2))).status, 401)
    assert.equal((await context(bob)).status, 200)
    const profile = () => fetch(origin + '/v1/accounts/me', { headers: auth(bob) })
    assert.equal((await (await profile()).json()).data.capabilities.privateStoryDrafts, true)
    config.peopleServiceToken = null
    assert.equal((await context(bob)).status, 404)
    assert.equal((await (await profile()).json()).data.capabilities.privateStoryDrafts, false)
  } finally {
    try { await app?.close() } finally {
      await pool.end()
      try { await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE') } finally { await admin.end() }
    }
  }
})

test('account-context accepts independently configured People credentials and rejects inactive accounts', async () => {
  const admin = new Pool({ connectionString })
  const schema = 'xijie_account_context_test_' + randomUUID().replaceAll('-', '')
  const pool = new Pool({ connectionString, options: '-c search_path=' + schema })
  let app
  try {
    await admin.query('CREATE SCHEMA ' + schema)
    for (const migration of ['001_identity.sql', '002_consents.sql', '004_ai_text_processing.sql']) {
      await pool.query(await readFile(new URL('../db/' + migration, import.meta.url), 'utf8'))
    }
    const identity = new IdentityStore(pool)
    const roleTokens = {
      peopleServiceToken: randomBytes(32).toString('hex'),
      conversationsServiceToken: randomBytes(32).toString('hex'),
      memoriesServiceToken: randomBytes(32).toString('hex'),
      socialServiceToken: randomBytes(32).toString('hex'),
    }
    const config = { secure: false, origin: 'http://localhost:5184', clientSecret: randomUUID(), ...roleTokens }
    app = await NestFactory.create(IdentityModule.register(config, identity, {}, new ConsentStore(pool, identity)), { logger: false, abortOnError: false })
    app.use(identityHeaders)
    app.useGlobalFilters(new IdentityErrors())
    await app.listen(0, '127.0.0.1')
    const origin = await app.getUrl()
    const alice = await session(identity, 'world-context-fixture')
    const context = (serviceToken, accountId = alice.accountId) => fetch(origin + '/internal/v1/accounts/' + accountId + '/context', {
      headers: serviceToken ? { Authorization: 'Bearer ' + serviceToken } : {},
    })

    // Separate role credentials expose omissions that a shared test token would conceal.
    for (const serviceToken of Object.values(roleTokens)) {
      const result = await context(serviceToken)
      assert.equal(result.status, 200)
      assert.equal(result.headers.get('cache-control'), 'no-store')
      const data = (await result.json()).data
      assert.equal(data.accountId, alice.accountId)
      assert.equal(data.status, 'active')
      assert.equal(data.accessVersion, 1)
      assert.deepEqual(data.storyStorage, { allowed: false, authorizationVersion: 0 })
      assert.equal(data.aiTextProcessing.allowed, false)
    }
    assert.equal((await context(randomBytes(32).toString('hex'))).status, 403)
    assert.equal((await context(undefined)).status, 403)
    assert.equal((await context('not-a-service-token')).status, 403)
    assert.equal((await context(roleTokens.peopleServiceToken, randomUUID())).status, 404)
    assert.equal((await context(roleTokens.peopleServiceToken, 'invalid')).status, 400)

    config.peopleServiceToken = null
    assert.equal((await context(roleTokens.peopleServiceToken)).status, 403)
    assert.equal((await context(roleTokens.conversationsServiceToken)).status, 200)
    config.peopleServiceToken = roleTokens.peopleServiceToken

    // This permission reads account state only; a service token cannot act as a user session.
    assert.equal((await fetch(origin + '/v1/accounts/me/consents', {
      method: 'POST', headers: { Authorization: 'Bearer ' + roleTokens.peopleServiceToken, Origin: config.origin, 'Idempotency-Key': randomUUID(), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })).status, 401)
    for (const status of ['restricted', 'deletion_pending', 'deleted']) {
      await pool.query('UPDATE accounts SET status=$2,access_version=access_version+1 WHERE id=$1', [alice.accountId, status])
      assert.equal((await context(roleTokens.peopleServiceToken)).status, 404)
    }
  } finally {
    try { await app?.close() } finally {
      await pool.end()
      try { await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE') } finally { await admin.end() }
    }
  }
})
