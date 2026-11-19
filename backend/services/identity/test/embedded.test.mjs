import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { Pool } from 'pg'
import { EmbeddedAuth, EmbeddedError } from '../dist/embedded.js'
import { IdentityStore } from '../dist/store.js'

const connectionString = process.env.XIJIE_TEST_DATABASE_URL
if (!connectionString) throw new Error('Set XIJIE_TEST_DATABASE_URL to a PostgreSQL integration test database.')
const digest = value => createHash('sha256').update(value).digest('hex')
const goodCode = '782941'

// This fixture exercises the real HTTP adapter and PostgreSQL bridge. It is not an SMS delivery test.
async function providerFixture() {
  const interactions = new Map()
  const codes = new Map()
  const users = new Set()
  const counts = { sends: 0, checks: 0 }
  let barrier = null
  let origin
  const clientId = 'xijie-test-client'
  const callbackUrl = 'http://127.0.0.1:5184/v1/auth/callback'
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url, origin)
      const json = (status, value) => {
        response.writeHead(status, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify(value))
      }
      if (request.method === 'GET' && url.pathname === '/oidc/auth') {
        assert.equal(url.searchParams.get('client_id'), clientId)
        assert.equal(url.searchParams.get('scope'), 'openid')
        assert.equal(url.searchParams.get('response_type'), 'code')
        const id = randomUUID()
        interactions.set(id, { id, state: url.searchParams.get('state'), event: 'SignIn', verified: false })
        response.writeHead(303, { Location: '/sign-in', 'Set-Cookie': `_interaction=${id}; Path=/; HttpOnly` })
        response.end()
        return
      }
      if (request.method === 'GET' && url.pathname.startsWith('/oidc/auth/')) {
        const item = interactions.get(url.pathname.split('/').at(-1))
        if (!item?.identified || !item.verified) return json(400, { code: 'session.not_found' })
        const code = randomUUID()
        codes.set(code, { state: item.state, subject: 'phone:' + item.phone })
        const callback = new URL(callbackUrl)
        callback.searchParams.set('state', item.state)
        callback.searchParams.set('code', code)
        response.writeHead(303, { Location: callback.href })
        response.end()
        return
      }
      const cookie = /(?:^|;\s*)_interaction=([^;]+)/.exec(request.headers.cookie || '')?.[1]
      const item = interactions.get(cookie)
      if (!item) return json(400, { code: 'session.not_found' })
      let text = ''
      for await (const chunk of request) text += chunk
      const body = text ? JSON.parse(text) : {}
      if (url.pathname === '/api/experience' && request.method === 'PUT') {
        item.event = body.interactionEvent
        response.writeHead(204)
        response.end()
      } else if (url.pathname === '/api/experience/interaction-event') {
        item.event = body.interactionEvent
        response.writeHead(204)
        response.end()
      } else if (url.pathname === '/api/experience/verification/verification-code') {
        assert.equal(body.identifier.type, 'phone')
        assert.match(body.identifier.value, /^[1-9]\d{6,14}$/)
        item.phone = body.identifier.value
        item.verificationId = randomUUID()
        counts.sends++
        json(200, { verificationId: item.verificationId })
      } else if (url.pathname === '/api/experience/verification/verification-code/verify') {
        counts.checks++
        assert.equal(body.identifier.value, item.phone)
        assert.equal(body.verificationId, item.verificationId)
        if (barrier) {
          const current = barrier
          barrier = null
          current.reached()
          await current.wait
        }
        if (body.code !== goodCode) return json(400, { code: 'verification_code.code_mismatch' })
        item.verified = true
        json(200, { verificationId: item.verificationId })
      } else if (url.pathname === '/api/experience/identification') {
        if (!item.verified) return json(400, { code: 'verification_record.not_verified' })
        if (item.event === 'SignIn' && !users.has(item.phone)) return json(404, { code: 'user.user_not_exist' })
        item.identified = true
        json(200, {})
      } else if (url.pathname === '/api/experience/submit') {
        assert.equal(item.identified, true)
        users.add(item.phone)
        json(200, { redirectTo: origin + '/oidc/auth/' + item.id })
      } else {
        json(404, { code: 'not_found' })
      }
    })().catch(error => {
      response.writeHead(500, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ code: 'test.fixture_failure' }))
      console.error(error.message)
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = 'http://127.0.0.1:' + server.address().port
  return {
    counts, users, callbackUrl, clientId, issuer: new URL(origin + '/oidc'),
    oidc: {
      async authorize({ state, nonce, verifier }) {
        const url = new URL(origin + '/oidc/auth')
        url.searchParams.set('client_id', clientId)
        url.searchParams.set('scope', 'openid')
        url.searchParams.set('response_type', 'code')
        url.searchParams.set('redirect_uri', callbackUrl)
        url.searchParams.set('state', state)
        url.searchParams.set('nonce', nonce)
        url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'))
        url.searchParams.set('code_challenge_method', 'S256')
        return url.href
      },
      async exchange(callback, { state }) {
        assert.equal(callback.searchParams.get('state'), state)
        const result = codes.get(callback.searchParams.get('code'))
        assert.ok(result)
        assert.equal(result.state, state)
        codes.delete(callback.searchParams.get('code'))
        return { issuer: origin + '/oidc', subject: result.subject, authTime: Math.floor(Date.now() / 1000) }
      },
    },
    pauseNextCheck() {
      let reached, release
      const entered = new Promise(resolve => { reached = resolve })
      const wait = new Promise(resolve => { release = resolve })
      barrier = { reached, wait }
      return { entered, release }
    },
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
      server.closeIdleConnections()
    }),
  }
}

const rejectsCode = (promise, code) => assert.rejects(promise, error => error instanceof EmbeddedError && error.code === code)

test('embedded authentication keeps provider verification and application-session state consistent', async t => {
  const schema = 'xijie_embedded_test_' + randomUUID().replaceAll('-', '')
  const admin = new Pool({ connectionString })
  const provider = await providerFixture()
  let pool
  t.after(async () => {
    await provider.close()
    if (pool) await pool.end()
    try { await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE') } finally { await admin.end() }
  })
  await admin.query('CREATE SCHEMA ' + schema)
  pool = new Pool({ connectionString, options: '-c search_path=' + schema })
  for (const migration of ['001_identity.sql', '003_embedded_auth.sql', '005_data_rights.sql']) {
    await pool.query(await readFile(new URL('../db/' + migration, import.meta.url), 'utf8'))
  }
  const store = new IdentityStore(pool)
  const config = { issuer: provider.issuer, callbackUrl: provider.callbackUrl, clientId: provider.clientId, clientSecret: 'test-only-' + randomUUID(), clientRegistrationKey: 'web-test' }
  const embedded = new EmbeddedAuth(pool, config, store, provider.oidc)
  const start = (browser, phone, overrides = {}) => embedded.start({ browserHash: browser, sessionHash: null, key: randomUUID(), phone, purpose: 'sign_in', ...overrides })
  const verify = (challenge, browser, overrides = {}) => embedded.verify({ id: challenge.id, browserHash: browser, code: goodCode, key: randomUUID(), requestId: randomUUID(), ...overrides })
  const clearCooldown = async browser => pool.query(
    "UPDATE auth_sms_challenges SET created_at=clock_timestamp()-interval '70 seconds',resend_at=clock_timestamp()-interval '10 seconds' WHERE browser_hash=$1", [browser],
  )

  await t.test('same send key and wrong-code key replay without repeated provider calls; browser and code binding hold', async () => {
    const browser = 'browser-a', key = randomUUID(), phone = '+16505550101'
    const before = { ...provider.counts }
    const challenge = await start(browser, phone, { key })
    assert.deepEqual(await start(browser, phone, { key }), challenge)
    assert.equal(provider.counts.sends, before.sends + 1)
    await rejectsCode(start(browser, '+16505550102', { key }), 'IDEMPOTENCY_CONFLICT')
    await rejectsCode(verify(challenge, 'other-browser'), 'NOT_FOUND')
    assert.equal(provider.counts.checks, before.checks)
    const wrongKey = randomUUID()
    assert.deepEqual(await verify(challenge, browser, { key: wrongKey, code: '000000' }), { status: 'incorrect' })
    assert.deepEqual(await verify(challenge, browser, { key: wrongKey, code: '000000' }), { status: 'incorrect' })
    assert.equal(provider.counts.checks, before.checks + 1)
    await rejectsCode(verify(challenge, browser, { key: wrongKey }), 'IDEMPOTENCY_CONFLICT')
    const goodKey = randomUUID()
    const result = await verify(challenge, browser, { key: goodKey })
    assert.equal(result.status, 'verified')
    assert.deepEqual(await verify(challenge, browser, { key: goodKey }), result)
    assert.equal(provider.counts.checks, before.checks + 2)
    const counts = (await pool.query('SELECT (SELECT count(*)::int FROM accounts) AS accounts,(SELECT count(*)::int FROM app_sessions) AS sessions,(SELECT count(*)::int FROM outbox_events) AS events')).rows[0]
    assert.deepEqual(counts, { accounts: 1, sessions: 1, events: 1 })
    await store.logout(digest(result.session))
    await rejectsCode(verify(challenge, browser, { key: goodKey }), 'AUTH_CHALLENGE_EXPIRED')
    assert.equal(await store.current(digest(result.session)), null)
    assert.equal(provider.counts.checks, before.checks + 2)
  })

  await t.test('cooldown covers another key and another browser for the same recipient', async () => {
    const browser = 'browser-limits', phone = '+16505550103'
    await start(browser, phone)
    await rejectsCode(start(browser, '+16505550104'), 'AUTH_RATE_LIMITED')
    await rejectsCode(start('other-limit-browser', phone), 'AUTH_RATE_LIMITED')
  })

  await t.test('SMS operation keys are isolated from the former hosted flow', async () => {
    const browser = 'browser-namespace', key = randomUUID(), id = randomUUID()
    await store.begin({
      id, browserHash: browser, sessionHash: null, key, purpose: 'sign_in',
      clientRegistrationKey: config.clientRegistrationKey, stateHash: randomUUID(), nonce: randomUUID(), verifier: randomUUID(),
      authorizationUrl: provider.issuer.origin + '/oidc/auth', expiresAt: new Date(Date.now() + 60_000),
    })
    const challenge = await start(browser, '+16505550105', { key })
    assert.notEqual(challenge.id, id)
    assert.equal((await pool.query('SELECT state FROM auth_attempts WHERE id=$1', [id])).rows[0].state, 'cancelled')
    assert.equal((await verify(challenge, browser)).status, 'verified')
  })

  await t.test('cancelling a switch before or during verification preserves the current account', async () => {
    const browser = 'browser-switch'
    const initial = await start(browser, '+16505550106')
    const first = await verify(initial, browser)
    const firstSession = await store.current(digest(first.session))
    await clearCooldown(browser)
    const cancelled = await start(browser, '+16505550107', { purpose: 'switch', sessionHash: digest(first.session) })
    assert.equal(await store.cancel({ browserHash: browser, attemptId: cancelled.id }), 'cancelled')
    const before = provider.counts.checks
    await rejectsCode(verify(cancelled, browser), 'AUTH_CHALLENGE_EXPIRED')
    assert.equal(provider.counts.checks, before)
    assert.equal((await store.current(digest(first.session))).accountId, firstSession.accountId)
    await clearCooldown(browser)
    const racing = await start(browser, '+16505550108', { purpose: 'switch', sessionHash: digest(first.session) })
    const pause = provider.pauseNextCheck()
    const verifying = verify(racing, browser)
    try {
      await pause.entered
      assert.equal(await store.cancel({ browserHash: browser, attemptId: racing.id }), 'cancelled')
    } finally { pause.release() }
    await rejectsCode(verifying, 'AUTH_CHALLENGE_EXPIRED')
    assert.equal((await store.current(digest(first.session))).accountId, firstSession.accountId)
  })

  await t.test('expired challenges fail before contacting the provider and cleanup removes sensitive context', async () => {
    const browser = 'browser-expired'
    const challenge = await start(browser, '+16505550109')
    await pool.query("UPDATE auth_sms_challenges SET created_at=clock_timestamp()-interval '10 minutes',resend_at=clock_timestamp()-interval '9 minutes',expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [challenge.id])
    const before = provider.counts.checks
    await rejectsCode(verify(challenge, browser), 'AUTH_CHALLENGE_EXPIRED')
    assert.equal(provider.counts.checks, before)
    await embedded.sweep()
    const row = (await pool.query('SELECT phase,context_cipher,result_cipher FROM auth_sms_challenges WHERE id=$1', [challenge.id])).rows[0]
    assert.deepEqual(row, { phase: 'expired', context_cipher: null, result_cipher: null })
  })

  await t.test('application session, registration event and bridge completion commit or roll back together', async () => {
    const browser = 'browser-atomic', id = randomUUID(), key = randomUUID(), claimId = randomUUID(), stateHash = randomUUID()
    await store.begin({
      id, browserHash: browser, sessionHash: null, key, purpose: 'sign_in', stateHash,
      nonce: randomUUID(), verifier: randomUUID(), authorizationUrl: provider.issuer.origin + '/oidc/auth',
      expiresAt: new Date(Date.now() + 60_000),
    })
    await store.claim({ browserHash: browser, stateHash, claimId })
    await pool.query("INSERT INTO auth_sms_challenges(id,browser_hash,idempotency_key,phone_hash,purpose,attempt_id,phase,lease_until) VALUES($1,$2,$3,'phone-atomic','sign_in',$1,'verifying',clock_timestamp()+interval '30 seconds')", [id, browser, key])
    const input = { browserHash: browser, attemptId: id, claimId, sessionHash: 'session-atomic', principal: { issuer: provider.issuer.href, subject: 'atomic-subject', authenticatedAt: new Date() } }
    const before = (await pool.query('SELECT (SELECT count(*)::int FROM accounts) AS accounts,(SELECT count(*)::int FROM app_sessions) AS sessions,(SELECT count(*)::int FROM outbox_events) AS events')).rows[0]
    const mark = client => client.query("UPDATE auth_sms_challenges SET phase='completed',result_cipher='fixture-only',lease_until=NULL WHERE id=$1", [id])
    await assert.rejects(store.finish(input, async client => { await mark(client); throw new Error('force atomic rollback') }), /force atomic rollback/)
    assert.deepEqual((await pool.query('SELECT (SELECT count(*)::int FROM accounts) AS accounts,(SELECT count(*)::int FROM app_sessions) AS sessions,(SELECT count(*)::int FROM outbox_events) AS events')).rows[0], before)
    assert.equal((await pool.query('SELECT phase FROM auth_sms_challenges WHERE id=$1', [id])).rows[0].phase, 'verifying')
    assert.equal((await pool.query('SELECT state FROM auth_attempts WHERE id=$1', [id])).rows[0].state, 'pending')
    assert.equal(await store.finish(input, mark), true)
    assert.equal(await store.finish(input, mark), false)
    assert.ok(await store.current('session-atomic'))
  })
  await t.test('reauthentication uses the same session, requires it at verification and cannot register an unknown phone',async()=>{
    const browser='browser-reauth',phone='+16505550111',firstChallenge=await start(browser,phone),first=await verify(firstChallenge,browser),session=await store.current(digest(first.session))
    await clearCooldown(browser)
    const challenge=await start(browser,phone,{purpose:'reauthenticate',sessionHash:digest(first.session)}),key=randomUUID()
    const before=provider.counts.checks
    await rejectsCode(verify(challenge,browser,{key}),'UNAUTHENTICATED');assert.equal(provider.counts.checks,before)
    const result=await verify(challenge,browser,{key,sessionHash:digest(first.session),expectedSessionId:session.id})
    assert.equal(result.status,'reauthenticated');assert.equal(result.sessionId,session.id);assert.equal(result.session,undefined);assert.equal((await store.current(digest(first.session))).id,session.id)
    assert.deepEqual(await verify(challenge,browser,{key,sessionHash:digest(first.session),expectedSessionId:session.id}),result)
    await clearCooldown(browser)
    const unknown=await start(browser,'+16505550112',{purpose:'reauthenticate',sessionHash:digest(first.session)})
    await assert.rejects(verify(unknown,browser,{sessionHash:digest(first.session),expectedSessionId:session.id}));assert.equal(provider.users.has('16505550112'),false)
    assert.equal((await store.current(digest(first.session))).id,session.id)
  })


})
