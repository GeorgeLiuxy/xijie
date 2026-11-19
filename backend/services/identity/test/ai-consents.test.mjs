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
if (!connectionString) throw new Error('Set XIJIE_TEST_DATABASE_URL to an isolated PostgreSQL test database.')
const hash = value => createHash('sha256').update(value).digest('hex')

async function session(store, subject) {
  const browserHash = randomUUID(), attemptId = randomUUID(), stateHash = randomUUID(), claimId = randomUUID()
  await store.begin({ id: attemptId, browserHash, key: randomUUID(), purpose: 'sign_in', sessionHash: null,
    stateHash, nonce: randomUUID(), verifier: randomUUID(), authorizationUrl: 'https://id.example.test/oidc/auth', expiresAt: new Date(Date.now() + 60_000) })
  assert.equal((await store.claim({ browserHash, stateHash, claimId })).id, attemptId)
  const proof = randomBytes(32).toString('base64url'), sessionHash = hash(proof)
  assert.equal(await store.finish({ browserHash, attemptId, claimId, sessionHash,
    principal: { issuer: 'https://id.example.test/oidc', subject, authenticatedAt: new Date() } }), true)
  const current = await store.current(sessionHash)
  return { id: current.id, accountId: current.accountId, cookie: 'xijie_dev_session=' + proof, sessionHash }
}

test('AI text permission is explicit, account-scoped, replay-safe and bound to the exact notice acknowledgement', async () => {
  const admin = new pg.Pool({ connectionString })
  const schema = 'xijie_ai_consent_test_' + randomUUID().replaceAll('-', '')
  const pool = new pg.Pool({ connectionString, options: '-c search_path=' + schema })
  let app
  try {
    await admin.query('CREATE SCHEMA ' + schema)
    for (const name of ['001_identity.sql', '002_consents.sql']) await pool.query(await readFile(new URL('../db/' + name, import.meta.url), 'utf8'))
    const identity = new IdentityStore(pool)
    const alice = await session(identity, 'alice'), otherDevice = await session(identity, 'alice'), bob = await session(identity, 'bob')
    assert.equal(alice.accountId, otherDevice.accountId)
    assert.notEqual(alice.id, otherDevice.id)
    // A real pre-upgrade account acknowledged notice v1 and allowed storage. Neither grants AI.
    for (const [purpose, policyId, decision] of [
      ['privacy_notice', '014ab349-a7c7-4764-98ec-c00cbec15e15', 'acknowledge'],
      ['private_story_storage', '0133ea0a-4d27-465c-8544-42bce81c68e9', 'grant'],
    ]) {
      await pool.query(`INSERT INTO consent_events(account_id,purpose,policy_id,policy_version,decision,authorization_version,idempotency_key,request_fingerprint)
        VALUES($1,$2,$3,1,$4,1,$5,'legacy')`, [alice.accountId, purpose, policyId, decision, randomUUID()])
      await pool.query('INSERT INTO current_consents(account_id,purpose,authorization_version,updated_at) VALUES($1,$2,1,clock_timestamp())', [alice.accountId, purpose])
    }
    await pool.query(await readFile(new URL('../db/004_ai_text_processing.sql', import.meta.url), 'utf8'))
    const consents = new ConsentStore(pool, identity)
    const serviceToken = randomBytes(32).toString('hex')
    const config = { secure: false, origin: 'http://localhost:5184', clientSecret: randomUUID(), peopleServiceToken: serviceToken, conversationsServiceToken: serviceToken }
    app = await NestFactory.create(IdentityModule.register(config, identity, {}, consents), { logger: false, abortOnError: false })
    app.use(identityHeaders); app.useGlobalFilters(new IdentityErrors()); await app.listen(0, '127.0.0.1')
    const origin = await app.getUrl()
    const auth = actor => ({ Cookie: actor.cookie, 'X-Xijie-Expected-Session': actor.id })
    const history = async actor => {
      const result = await fetch(origin + '/v1/accounts/me/consents?limit=1', { headers: auth(actor) })
      assert.equal(result.status, 200); return result.json()
    }
    const context = async actor => {
      const result = await fetch(origin + '/internal/v1/session-context', { headers: { ...auth(actor), Authorization: 'Bearer ' + serviceToken } })
      assert.equal(result.status, 200); return (await result.json()).data
    }
    const accountContext = async actor => {
      const result = await fetch(origin + '/internal/v1/accounts/' + actor.accountId + '/context', { headers: { Authorization: 'Bearer ' + serviceToken } })
      assert.equal(result.status, 200); return (await result.json()).data
    }
    const policies = (await (await fetch(origin + '/v1/policies/current?locale=en')).json()).data
    const notice = policies.find(row => row.kind === 'privacy_notice'), ai = policies.find(row => row.kind === 'ai_text_processing'), storage = policies.find(row => row.kind === 'private_story_storage')
    assert.equal(notice.version, 2); assert.equal(ai.version, 1); assert.equal(storage.version, 1)
    const aiDoc = await (await fetch(origin + ai.documentUrl)).text()
    assert.match(aiDoc, /OpenAI/); assert.match(aiDoc, /does not cover photos/)
    const legacyDoc = await fetch(origin + '/v1/policies/' + notice.id + '/1?locale=en')
    assert.equal(legacyDoc.status, 200); assert.match(await legacyDoc.text(), /not used for AI/)
    const decision = (policy, choice, expectedAuthorizationVersion) => ({ policyId: policy.id, version: policy.version, purpose: policy.kind, decision: choice, expectedAuthorizationVersion })
    const record = (actor, body, key = randomUUID(), requestOrigin = config.origin) => fetch(origin + '/v1/accounts/me/consents', {
      method: 'POST', headers: { ...auth(actor), Origin: requestOrigin, 'Idempotency-Key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const accepted = async (actor, body, key) => {
      const response = await record(actor, body, key); assert.equal(response.status, 201); return (await response.json()).data
    }
    const initial = await history(alice)
    assert.equal(initial.meta.currentDecisions.privacy_notice, undefined)
    assert.equal(initial.meta.currentDecisions.private_story_storage, 'grant')
    assert.deepEqual(initial.meta.aiTextProcessing, { allowed: false, authorizationVersion: 0 })
    assert.deepEqual((await context(alice)).aiTextProcessing, initial.meta.aiTextProcessing)
    assert.equal((await record(alice, decision(ai, 'grant', 0))).status, 403)
    assert.equal((await record(alice, decision(ai, 'acknowledge', 0))).status, 400)
    assert.equal((await record(alice, decision(ai, 'grant', 0), randomUUID(), 'https://wrong.example')).status, 403)
    assert.equal((await record({ ...alice, id: bob.id }, decision(ai, 'grant', 0))).status, 401)
    assert.equal((await accepted(alice, decision(notice, 'acknowledge', 1))).authorizationVersion, 2)
    assert.equal((await context(alice)).storyStorage.allowed, true)
    assert.deepEqual((await context(alice)).aiTextProcessing, { allowed: false, authorizationVersion: 0 })
    const key = randomUUID(), input = decision(ai, 'grant', 0)
    const grants = await Promise.all([accepted(alice, input, key), accepted(otherDevice, input, key)])
    assert.deepEqual(grants[0], grants[1]); assert.equal(grants[0].authorizationVersion, 1)
    assert.deepEqual((await context(otherDevice)).aiTextProcessing, { allowed: true, authorizationVersion: 1 })
    assert.deepEqual((await accountContext(alice)).aiTextProcessing, { allowed: true, authorizationVersion: 1 })
    assert.deepEqual((await history(bob)).meta.aiTextProcessing, { allowed: false, authorizationVersion: 0 })
    assert.equal((await record(otherDevice, decision(ai, 'revoke', 0))).status, 412)
    assert.equal((await record(alice, decision(ai, 'revoke', 1), key)).status, 409)
    assert.equal((await accepted(otherDevice, decision(ai, 'revoke', 1))).authorizationVersion, 2)
    assert.deepEqual((await context(alice)).aiTextProcessing, { allowed: false, authorizationVersion: 2 })
    assert.deepEqual((await context(alice)).storyStorage, { allowed: true, authorizationVersion: 1 })
    assert.deepEqual(await accepted(alice, input, key), grants[0])
    assert.equal((await context(alice)).aiTextProcessing.allowed, false)
    assert.equal((await accepted(alice, decision(ai, 'grant', 2))).authorizationVersion, 3)

    // Publishing a notice and acknowledging it again must not restore the previous grant (ABA).
    await pool.query(`INSERT INTO policy_versions(id,kind,version,document_zh_cn,document_en)
      SELECT id,kind,3,document_zh_cn,document_en FROM policy_versions WHERE id=$1 AND version=2`, [notice.id])
    assert.deepEqual((await context(otherDevice)).aiTextProcessing, { allowed: false, authorizationVersion: 3 })
    assert.equal((await accepted(otherDevice, decision({ ...notice, version: 3 }, 'acknowledge', 2))).authorizationVersion, 3)
    assert.deepEqual((await history(alice)).meta.aiTextProcessing, { allowed: false, authorizationVersion: 3 })
    assert.equal((await history(alice)).meta.currentDecisions.ai_text_processing, 'grant')
    assert.equal((await accepted(alice, decision(ai, 'grant', 3))).authorizationVersion, 4)
    assert.deepEqual((await context(otherDevice)).aiTextProcessing, { allowed: true, authorizationVersion: 4 })
    // Revocation stays possible without acknowledging a newly published notice.
    await pool.query(`INSERT INTO policy_versions(id,kind,version,document_zh_cn,document_en)
      SELECT id,kind,4,document_zh_cn,document_en FROM policy_versions WHERE id=$1 AND version=3`, [notice.id])
    assert.equal((await accepted(otherDevice, decision(ai, 'revoke', 4))).authorizationVersion, 5)
    assert.equal((await record(alice, decision(ai, 'grant', 5))).status, 403)
    const events = (await pool.query("SELECT type,payload,aggregate_version FROM outbox_events WHERE account_id=$1 AND type='AiTextProcessingRevoked.v1' ORDER BY aggregate_version", [alice.accountId])).rows
    assert.deepEqual(events.map(event => event.aggregate_version), [2, 5])
    assert.equal(events.every(event => event.payload.purpose === 'ai_text_processing'), true)
    assert.equal((await pool.query("SELECT count(*)::int n FROM outbox_events WHERE type='StoryStorageRevoked.v1' AND account_id=$1", [alice.accountId])).rows[0].n, 0)
    const bindings = (await pool.query("SELECT authorization_version,notice_authorization_version,notice_purpose FROM consent_events WHERE account_id=$1 AND purpose='ai_text_processing' ORDER BY authorization_version", [alice.accountId])).rows
    assert.deepEqual(bindings.map(row => [row.authorization_version, row.notice_authorization_version]), [[1, 2], [2, null], [3, 2], [4, 3], [5, null]])
    // The database itself rejects a cross-account or wrong-kind notice reference.
    await assert.rejects(pool.query(`INSERT INTO consent_events(account_id,purpose,policy_id,policy_version,decision,authorization_version,idempotency_key,request_fingerprint,notice_authorization_version)
      VALUES($1,'ai_text_processing',$2,1,'grant',1,$3,'invalid',3)`, [bob.accountId, ai.id, randomUUID()]), error => error.code === '23503')
    assert.deepEqual((await history(bob)).meta.aiTextProcessing, { allowed: false, authorizationVersion: 0 })
    // AI permission itself does not grant storage; the two current decisions remain separate.
    await accepted(bob, decision({ ...notice, version: 4 }, 'acknowledge', 0))
    await accepted(bob, decision(ai, 'grant', 0))
    assert.deepEqual((await context(bob)).aiTextProcessing, { allowed: true, authorizationVersion: 1 })
    assert.deepEqual((await context(bob)).storyStorage, { allowed: false, authorizationVersion: 0 })
    // A provider/scope policy update also invalidates prior AI permission without resetting its counter.
    await pool.query(`INSERT INTO policy_versions(id,kind,version,document_zh_cn,document_en)
      SELECT id,kind,2,document_zh_cn,document_en FROM policy_versions WHERE id=$1 AND version=1`, [ai.id])
    assert.deepEqual((await history(bob)).meta.aiTextProcessing, { allowed: false, authorizationVersion: 1 })
    assert.equal((await record(bob, decision(ai, 'grant', 1))).status, 412)
    const competing = await Promise.all([
      record(bob, decision({ ...ai, version: 2 }, 'grant', 1)),
      record(bob, decision({ ...ai, version: 2 }, 'revoke', 1)),
    ])
    assert.deepEqual(competing.map(response => response.status).sort(), [201, 412])
    assert.equal((await history(bob)).meta.aiTextProcessing.authorizationVersion, 2)
  } finally {
    try { await app?.close() } finally {
      await pool.end()
      try { await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE') } finally { await admin.end() }
    }
  }
})
