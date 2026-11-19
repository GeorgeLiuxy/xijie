import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import pg from 'pg'
import { IdentityStore, StoreError } from '../dist/store.js'

const connectionString = process.env.XIJIE_TEST_DATABASE_URL
if (!connectionString) throw new Error('Set XIJIE_TEST_DATABASE_URL to a PostgreSQL integration test database.')

const { Pool } = pg

function makeAttempt(browserHash, overrides = {}) {
  const id = randomUUID()
  return {
    id, browserHash, sessionHash: null, key: randomUUID(), purpose: 'sign_in',
    clientRegistrationKey: 'web-test', stateHash: randomUUID(), nonce: randomUUID(),
    verifier: randomUUID(), authorizationUrl: 'https://id.example.test/oidc/auth',
    expiresAt: new Date(Date.now() + 60_000), ...overrides,
  }
}

test('PostgreSQL identity store maintains account and session invariants', async t => {
  const admin = new Pool({ connectionString })
  const schema = 'xijie_identity_test_' + randomUUID().replaceAll('-', '')
  t.after(async () => {
    try { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`) } finally { await admin.end() }
  })
  await admin.query(`CREATE SCHEMA ${schema}`)
  const pool = new Pool({ connectionString, options: '-c search_path=' + schema })
  try {
    await pool.query(await readFile(new URL('../db/001_identity.sql', import.meta.url), 'utf8'))
    const store = new IdentityStore(pool)
    const principal = {
      issuer: 'https://id.example.test/oidc', subject: 'subject-a', authenticatedAt: new Date(),
    }
    const first = makeAttempt('browser-a')
    const second = makeAttempt('browser-b')
    const firstClaim = { browserHash: first.browserHash, stateHash: first.stateHash, claimId: randomUUID() }
    const secondClaim = { browserHash: second.browserHash, stateHash: second.stateHash, claimId: randomUUID() }

    const initial = await store.begin(first)
    const replay = await store.begin(makeAttempt(first.browserHash, { key: first.key }))
    assert.deepEqual(replay, initial)
    await assert.rejects(
      store.begin(makeAttempt(first.browserHash, { key: first.key, clientRegistrationKey: 'other-web' })),
      error => error instanceof StoreError && error.code === 'IDEMPOTENCY_CONFLICT',
    )
    await store.begin(second)
    assert.equal(await store.claim({ ...firstClaim, browserHash: second.browserHash }), null)
    const claimed = await store.claim(firstClaim)
    assert.equal(claimed.clientRegistrationKey, first.clientRegistrationKey)
    assert.equal(await store.claim({ ...firstClaim, claimId: randomUUID() }), null)
    assert.equal((await store.claim(secondClaim)).id, second.id)
    assert.deepEqual(await Promise.all([
      store.finish({ ...firstClaim, attemptId: first.id, principal, sessionHash: 'session-a' }),
      store.finish({ ...secondClaim, attemptId: second.id, principal, sessionHash: 'session-b' }),
    ]), [true, true])
    const firstSession = await store.current('session-a')
    assert.equal(firstSession.accountId, (await store.current('session-b')).accountId)
    const counts = await pool.query(`SELECT (SELECT count(*)::int FROM accounts) AS accounts,
      (SELECT count(*)::int FROM auth_identities) AS identities,
      (SELECT count(*)::int FROM outbox_events) AS events`)
    assert.deepEqual(counts.rows[0], { accounts: 1, identities: 1, events: 1 })
    assert.equal(await store.claim(firstClaim), 'completed')
    assert.equal(await store.cancel({ browserHash: first.browserHash, attemptId: first.id }), 'completed')

    const switchAttempt = makeAttempt(first.browserHash, { purpose: 'switch', sessionHash: 'session-a' })
    const switchClaim = {
      browserHash: switchAttempt.browserHash, stateHash: switchAttempt.stateHash, claimId: randomUUID(),
    }
    const other = { ...principal, subject: 'subject-b' }
    await store.begin(switchAttempt)
    assert.equal((await store.claim(switchClaim)).id, switchAttempt.id)
    assert.equal(await store.cancel({ browserHash: second.browserHash, attemptId: switchAttempt.id }), 'missing')
    assert.equal(await store.cancel({ browserHash: first.browserHash, attemptId: switchAttempt.id }), 'cancelled')
    assert.equal(await store.finish({
      ...switchClaim, attemptId: switchAttempt.id, principal: other, sessionHash: 'unused',
    }), false)
    assert.equal((await store.current('session-a')).accountId, firstSession.accountId)

    const successful = makeAttempt(first.browserHash, { purpose: 'switch', sessionHash: 'session-a' })
    const finishInput = {
      browserHash: successful.browserHash, stateHash: successful.stateHash, attemptId: successful.id,
      claimId: randomUUID(), principal: other, sessionHash: 'session-next',
    }
    await store.begin(successful)
    assert.equal((await store.claim(finishInput)).id, successful.id)
    assert.equal(await store.finish(finishInput), true)
    assert.equal(await store.current('session-a'), null)
    assert.notEqual((await store.current('session-next')).accountId, firstSession.accountId)
    assert.equal((await store.current('session-b')).accountId, firstSession.accountId)
    await store.logout('session-a')
    assert.ok(await store.current('session-next'))

    const lateSwitch = makeAttempt(first.browserHash, { purpose: 'switch', sessionHash: 'session-next' })
    const lateClaim = {
      browserHash: lateSwitch.browserHash, stateHash: lateSwitch.stateHash, attemptId: lateSwitch.id,
      claimId: randomUUID(), principal, sessionHash: 'session-late',
    }
    await store.begin(lateSwitch)
    assert.equal((await store.claim(lateClaim)).id, lateSwitch.id)
    await store.logout('session-next')
    await store.logout('session-next')
    assert.equal(await store.finish(lateClaim), false)
    assert.equal(await store.current('session-next'), null)
    assert.equal(await store.current('session-late'), null)

    const rollback = makeAttempt('browser-rollback')
    const rollbackInput = {
      browserHash: rollback.browserHash, stateHash: rollback.stateHash, attemptId: rollback.id,
      claimId: randomUUID(), principal: { ...principal, subject: 'subject-rollback' },
      sessionHash: 'session-b',
    }
    await store.begin(rollback)
    await store.claim(rollbackInput)
    await assert.rejects(store.finish(rollbackInput), { code: '23505' })
    const rolledBack = await pool.query(`SELECT (SELECT count(*)::int FROM accounts) AS accounts,
      (SELECT count(*)::int FROM auth_identities) AS identities,
      (SELECT count(*)::int FROM outbox_events) AS events`)
    assert.deepEqual(rolledBack.rows[0], { accounts: 2, identities: 2, events: 2 })
    await store.fail(rollbackInput)

    await pool.query('UPDATE accounts SET access_version = access_version + 1 WHERE id = $1', [firstSession.accountId])
    assert.equal(await store.current('session-b'), null)

    const expired = makeAttempt('browser-expiry')
    await store.begin(expired)
    await pool.query(`UPDATE auth_attempts
      SET created_at = clock_timestamp() - interval '1 minute',
          expires_at = clock_timestamp() - interval '1 second' WHERE id = $1`, [expired.id])
    await store.sweepExpired()
    assert.equal(await store.claim({
      browserHash: expired.browserHash, stateHash: expired.stateHash, claimId: randomUUID(),
    }), null)
    const terminal = await pool.query(`SELECT state, nonce, pkce_verifier, authorization_url, exchange_claim_id
      FROM auth_attempts WHERE id = $1`, [expired.id])
    assert.deepEqual(terminal.rows[0], {
      state: 'expired', nonce: null, pkce_verifier: null, authorization_url: null, exchange_claim_id: null,
    })
  } finally {
    await pool.end()
  }
})
