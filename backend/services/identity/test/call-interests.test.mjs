import 'reflect-metadata'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { NestFactory } from '@nestjs/core'
import { ConsentStore } from '../dist/consent-store.js'
import { IdentityModule, IdentityErrors, identityHeaders } from '../dist/http.js'
import { IdentityStore } from '../dist/store.js'

test('call reminder preferences survive reopen, cancel by kind, and cannot be restored by a stale request', async t => {
  const connectionString = process.env.XIJIE_TEST_DATABASE_URL
  assert(connectionString)
  const schema = 'call_interests_' + randomUUID().replaceAll('-', '')
  const admin = new pg.Pool({ connectionString })
  const pool = new pg.Pool({ connectionString, options: '-c search_path=' + schema })
  await admin.query('CREATE SCHEMA ' + schema)
  let app
  t.after(async () => {
    await app?.close()
    await pool.end()
    await admin.query('DROP SCHEMA ' + schema + ' CASCADE')
    await admin.end()
  })
  for (const file of ['001_identity.sql', '002_consents.sql', '003_embedded_auth.sql', '004_ai_text_processing.sql', '005_data_rights.sql', '033_call_interests.sql'])
    await pool.query(await readFile(new URL('../db/' + file, import.meta.url), 'utf8'))

  const store = new IdentityStore(pool)
  async function actor() {
    const id = randomUUID(), browserHash = randomUUID(), stateHash = randomUUID(), claimId = randomUUID()
    const proof = randomBytes(32).toString('base64url'), hash = createHash('sha256').update(proof).digest('hex')
    await store.begin({ id, browserHash, key: randomUUID(), purpose: 'sign_in', sessionHash: null, stateHash,
      nonce: randomUUID(), verifier: randomUUID(), authorizationUrl: 'https://id.example.test/auth', expiresAt: new Date(Date.now() + 60000) })
    await store.claim({ browserHash, stateHash, claimId })
    await store.finish({ browserHash, attemptId: id, claimId, sessionHash: hash,
      principal: { issuer: 'https://id.example.test', subject: randomUUID(), authenticatedAt: new Date() } })
    return { proof, session: await store.current(hash) }
  }
  const first = await actor(), second = await actor()
  const config = { secure: false, origin: 'http://localhost:5184', clientSecret: randomUUID() }
  app = await NestFactory.create(IdentityModule.register(config, store, {}, new ConsentStore(pool, store)), { logger: false, abortOnError: false })
  app.use(identityHeaders)
  app.useGlobalFilters(new IdentityErrors())
  await app.listen(0, '127.0.0.1')
  const endpoint = await app.getUrl() + '/v1/accounts/me/call-interests'
  const call = (who, body, overrides = {}) => fetch(endpoint, {
    method: body ? 'PATCH' : 'GET',
    headers: { Cookie: 'xijie_dev_session=' + who.proof, Origin: config.origin, 'X-Xijie-Expected-Session': who.session.id, 'Content-Type': 'application/json', ...overrides },
    ...(body && { body: JSON.stringify(body) }),
  })
  const read = async who => (await (await call(who)).json()).data
  const initial = { version: 1, voice: null, video: null }
  assert.deepEqual(await read(first), initial)
  const register = { version: 1, kind: 'voice', registered: true }
  assert.equal((await call(first, register, { Origin: 'https://other.example' })).status, 403)
  assert.equal((await call(first, register, { 'X-Xijie-Expected-Session': second.session.id })).status, 401)
  const registered = (await (await call(first, register)).json()).data
  assert.equal(registered.version, 2)
  assert.ok(Date.parse(registered.voice) > 0)
  assert.equal(registered.video, null)
  assert.deepEqual(await read(second), initial)
  assert.deepEqual((await (await call(first, register)).json()).data, registered)
  const both = (await (await call(first, { version: 2, kind: 'video', registered: true })).json()).data
  assert.ok(Date.parse(both.video) > 0)
  assert.equal((await call(first, { version: 3, kind: 'voice', registered: false })).status, 200)
  assert.equal((await call(first, register)).status, 412)
  assert.deepEqual(await read(first), { version: 4, voice: null, video: both.video })

  await pool.query("UPDATE accounts SET status='deletion_pending',deletion_requested_at=now() WHERE id=$1", [first.session.accountId])
  assert.equal((await call(first)).status, 401)
  await pool.query("UPDATE accounts SET status='deleted',deleted_at=now() WHERE id=$1", [first.session.accountId])
  const saved = await pool.query('SELECT call_interest_version,voice_call_interest_at,video_call_interest_at FROM accounts WHERE id=$1', [first.session.accountId])
  assert.deepEqual(saved.rows[0], { call_interest_version: 1, voice_call_interest_at: null, video_call_interest_at: null })
})
