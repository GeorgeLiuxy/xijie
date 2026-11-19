import 'reflect-metadata'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { NestFactory } from '@nestjs/core'
import pg from 'pg'
import { personFields, draftFields, confirmInput } from '../dist/contracts.js'
import { PeopleStore } from '../dist/store.js'
import { PeopleErrors, PeopleModule, peopleHeaders } from '../dist/http.js'

const connectionString = process.env.XIJIE_TEST_DATABASE_URL
if (!connectionString) throw new Error('Set XIJIE_TEST_DATABASE_URL to a PostgreSQL integration test database.')

test('person lifecycle keeps updates, tombstones, source visibility and events consistent', async t => {
  const admin = new pg.Pool({ connectionString })
  const schema = 'xijie_lifecycle_test_' + randomUUID().replaceAll('-', '')
  await admin.query('CREATE SCHEMA ' + schema)
  const pool = new pg.Pool({ connectionString, options: '-c search_path=' + schema })
  t.after(async () => {
    await pool.end()
    try { await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE') } finally { await admin.end() }
  })
  for (const filename of ['001_person_drafts.sql', '002_person_confirmation.sql', '003_person_lifecycle.sql', '004_original_seek_fields.sql', '005_data_rights.sql','006_automatic_memory_sources.sql','007_world_movements.sql','008_person_photos.sql','009_structured_profile.sql','010_person_reminders.sql','011_voice_samples_and_preferences.sql']) {
    await pool.query(await readFile(new URL('../db/' + filename, import.meta.url), 'utf8'))
  }
  const store = new PeopleStore(pool)
  const world = (await store.worlds(undefined, 1))[0]
  async function seed(accountId = randomUUID()) {
    const createKey = randomUUID(), updateKey = randomUUID(), previewKey = randomUUID(), confirmKey = randomUUID()
    const source = { displayName: 'Synthetic person', relationship: 'friend', story: 'Synthetic story.\nOriginal second line.' }
    const initial = await store.create(accountId, 1, createKey, source)
    const draft = await store.update(accountId, initial.id, 1, updateKey, initial.version, { displayName: 'Synthetic contact' })
    const previewInput = { worldPreferenceId: world.id, previousPreviewId: null }
    const preview = await store.createPreview(accountId, draft.id, 1, previewKey, draft.version, previewInput)
    const confirmInput = { previewId: preview.id, worldId: world.id }
    const person = await store.confirm(accountId, draft.id, 1, confirmKey, draft.version, confirmInput, randomUUID())
    return { accountId, source, draft, preview, person, createKey, updateKey, previewKey, confirmKey, previewInput, confirmInput }
  }

  await t.test('field parsing preserves allowed Unicode, enforces complete month/day and rejects protected fields', async () => {
    const parsed = personFields({ displayName: ' 😀'.trim().repeat(80), story: ' first\nsecond ', birthMonthDay: '02-29', realName: null })
    assert.equal([...parsed.displayName].length, 80)
    assert.equal(parsed.story, 'first\nsecond')
    for (const body of [{}, [], { worldId: world.id }, { accountId: randomUUID() }, { status: 'removed' },
      { displayName: null }, { relationship: '' }, { story: null }, { realName: '' }, { place: '\ud800' },
      { birthMonthDay: '02-30' }, { birthMonthDay: '04-31' }, { birthMonthDay: '00-01' }, { birthMonthDay: '03-00' },
      { birthMonthDay: '3-01' }, { birthMonthDay: '12-32' }, { calledMe: '😀'.repeat(81) }]) {
      assert.throws(() => personFields(body), { code: 'INVALID_ARGUMENT' })
    }
    assert.equal(personFields({ birthMonthDay: '12-31' }).birthMonthDay, '12-31')
    assert.equal(personFields({ birthMonthDay: null }).birthMonthDay, null)
  })

  await t.test('original seek previews coordinates before choosing a relationship and confirms their exact metadata once', async () => {
    const account = randomUUID()
    const initial = await store.create(account, 1, randomUUID(), draftFields({
      displayName: '阿远', realName: '李远', story: '放学后沿河散步。\n这是用户原文。',
      birthMonthDay: '02-29', yearsText: '1938 — 2021', place: '杭州',
    }, false))
    assert.equal(initial.relationship, undefined)
    const preview = await store.createPreview(account, initial.id, 1, randomUUID(), initial.version, {
      worldPreferenceId: world.id, previousPreviewId: null,
    })
    const body = confirmInput({ previewId: preview.id, worldId: world.id, relationship: '朋友', calledMe: '小林' })
    const key = randomUUID()
    const confirmed = await store.confirm(account, initial.id, 1, key, initial.version, body, randomUUID())
    assert.equal(confirmed.relationship, '朋友')
    assert.equal(confirmed.calledMe, '小林')
    assert.equal(confirmed.realName, initial.realName)
    assert.equal(confirmed.birthMonthDay, '02-29')
    assert.equal(confirmed.yearsText, initial.yearsText)
    assert.equal(confirmed.place, initial.place)
    assert.equal(confirmed.story, initial.story)
    assert.deepEqual(await store.confirm(account, initial.id, 1, key, initial.version, body, randomUUID()), confirmed)
    assert.deepEqual(await store.confirm(account, initial.id, 1, randomUUID(), initial.version, body, randomUUID()), confirmed)
    await assert.rejects(store.confirm(account, initial.id, 1, key, initial.version, { ...body, relationship: '家人' }, randomUUID()), { code: 'IDEMPOTENCY_CONFLICT' })
    await assert.rejects(store.confirm(account, initial.id, 1, randomUUID(), initial.version, { ...body, calledMe: '另一人' }, randomUUID()), { code: 'CONFLICT' })
    const draft = await store.create(account, 1, randomUUID(), { displayName: '另一位', story: '原文', place: '原地点' })
    const old = await store.createPreview(account, draft.id, 1, randomUUID(), draft.version, { worldPreferenceId: world.id, previousPreviewId: null })
    const changed = await store.update(account, draft.id, 1, randomUUID(), draft.version, { place: '新地点', realName: null })
    assert.equal(changed.version, draft.version + 1)
    assert.equal((await store.getPreview(account, draft.id, old.id, 1)).status, 'stale')
    assert.throws(() => draftFields({ birthMonthDay: '02-30' }, false), { code: 'INVALID_ARGUMENT' })
    assert.throws(() => confirmInput({ previewId: preview.id, worldId: world.id, relationship: '' }), { code: 'INVALID_ARGUMENT' })
  })

  await t.test('save and retry return one update with stable identity, metadata and original story; optional null clears', async () => {
    const f = await seed()
    const key = randomUUID(), trace = randomUUID()
    const input = personFields({ displayName: '家人 😀', relationship: '亲人', realName: '合成人物', calledMe: '小朋友',
      birthMonthDay: '02-29', yearsText: '1938 — 2021', place: '虚构故乡' })
    const saved = await store.updatePerson(f.accountId, f.person.id, key, 1, input, trace)
    assert.equal(saved.id, f.person.id)
    assert.equal(saved.worldId, f.person.worldId)
    assert.equal(saved.story, f.person.story)
    assert.equal(saved.createdAt, f.person.createdAt)
    assert.equal(saved.version, 2)
    for (const [name, value] of Object.entries(input)) assert.equal(saved[name], value)
    assert.deepEqual(await store.getPerson(f.accountId, f.person.id), saved)
    assert.deepEqual(await store.updatePerson(f.accountId, f.person.id, key, 1, input, randomUUID()), saved)
    await assert.rejects(store.updatePerson(f.accountId, f.person.id, key, 1, { displayName: 'Different' }, randomUUID()), { code: 'IDEMPOTENCY_CONFLICT' })
    const events = await pool.query("SELECT request_id,payload FROM outbox_events WHERE aggregate_id=$1 AND type='PersonUpdated.v1'", [saved.id])
    assert.equal(events.rowCount, 1)
    assert.equal(events.rows[0].request_id, trace)
    assert.equal(events.rows[0].payload.personVersion, 2)
    const cleared = await store.updatePerson(f.accountId, saved.id, randomUUID(), 2, personFields({ realName: null, birthMonthDay: null, yearsText: null }), randomUUID())
    assert.equal(cleared.version, 3)
    for (const field of ['realName', 'birthMonthDay', 'yearsText']) assert.equal(Object.hasOwn(cleared, field), false)
    assert.equal(cleared.calledMe, saved.calledMe)
    await assert.rejects(store.updatePerson(randomUUID(), saved.id, randomUUID(), 3, { displayName: 'Stolen' }, randomUUID()), { code: 'NOT_FOUND' })
    await assert.rejects(store.removePerson(randomUUID(), saved.id, randomUUID(), 3, randomUUID()), { code: 'NOT_FOUND' })
    // Raw schema constraints are a second boundary when future writers bypass the HTTP parser.
    await assert.rejects(pool.query("UPDATE persons SET birth_month_day='02-30' WHERE id=$1", [saved.id]), { code: '23514' })
  })

  await t.test('concurrent changes use optimistic version checks and event failure rolls back the command', async () => {
    const f = await seed()
    const writes = await Promise.allSettled(['First', 'Second'].map(displayName =>
      store.updatePerson(f.accountId, f.person.id, randomUUID(), 1, { displayName }, randomUUID())))
    assert.equal(writes.filter(value => value.status === 'fulfilled').length, 1)
    const failure = writes.find(value => value.status === 'rejected').reason
    assert.equal(failure.status, 412)
    assert.deepEqual(failure.details, { currentVersion: 2 })
    const before = await store.getPerson(f.accountId, f.person.id)
    const key = randomUUID()
    await assert.rejects(store.updatePerson(f.accountId, f.person.id, key, 2, { displayName: 'Should roll back' }, 'invalid-request-uuid'), { code: '22P02' })
    assert.deepEqual(await store.getPerson(f.accountId, f.person.id), before)
    assert.equal((await pool.query('SELECT 1 FROM person_draft_commands WHERE idempotency_key=$1', [key])).rowCount, 0)
    const updated = await store.updatePerson(f.accountId, f.person.id, key, 2, { displayName: 'Should roll back' }, randomUUID())
    assert.equal(updated.version, 3)
  })

  await t.test('removal hides direct reads, world membership, sources and every old cached success without resurrection', async () => {
    const f = await seed()
    const patchKey = randomUUID(), patch = { displayName: 'Before removal' }
    const updated = await store.updatePerson(f.accountId, f.person.id, patchKey, 1, patch, randomUUID())
    const removalKey = randomUUID(), trace = randomUUID()
    assert.deepEqual(await store.removePerson(f.accountId, f.person.id, removalKey, updated.version, trace), {})
    assert.deepEqual(await store.removePerson(f.accountId, f.person.id, removalKey, updated.version, randomUUID()), {})
    await assert.rejects(store.removePerson(f.accountId, f.person.id, removalKey, 99, randomUUID()), { code: 'IDEMPOTENCY_CONFLICT' })
    await assert.rejects(store.removePerson(f.accountId, f.person.id, randomUUID(), updated.version, randomUUID()), { code: 'NOT_FOUND' })
    await assert.rejects(store.getPerson(f.accountId, f.person.id), { code: 'NOT_FOUND' })
    assert.deepEqual(await store.listPersons(f.accountId, undefined, undefined, 20), [])
    assert.deepEqual(await store.listPersons(f.accountId, world.id, undefined, 20), [])
    assert.deepEqual(await store.list(f.accountId, 'confirmed', undefined, 20), [])
    await assert.rejects(store.get(f.accountId, f.draft.id), { code: 'NOT_FOUND' })
    await assert.rejects(store.getPreview(f.accountId, f.draft.id, f.preview.id, 1), { code: 'NOT_FOUND' })
    await assert.rejects(store.create(f.accountId, 1, f.createKey, f.source), { code: 'NOT_FOUND' })
    await assert.rejects(store.update(f.accountId, f.draft.id, 1, f.updateKey, 1, { displayName: 'Synthetic contact' }), { code: 'NOT_FOUND' })
    await assert.rejects(store.createPreview(f.accountId, f.draft.id, 1, f.previewKey, f.draft.version, f.previewInput), { code: 'NOT_FOUND' })
    await assert.rejects(store.confirm(f.accountId, f.draft.id, 1, f.confirmKey, f.draft.version, f.confirmInput, randomUUID()), { code: 'NOT_FOUND' })
    await assert.rejects(store.confirm(f.accountId, f.draft.id, 1, randomUUID(), f.draft.version, f.confirmInput, randomUUID()), { code: 'NOT_FOUND' })
    await assert.rejects(store.updatePerson(f.accountId, f.person.id, patchKey, 1, patch, randomUUID()), { code: 'NOT_FOUND' })
    const stored = (await pool.query('SELECT status,version,access_version,removed_at,updated_at FROM persons WHERE id=$1', [f.person.id])).rows[0]
    assert.equal(stored.status, 'removed')
    assert.equal(stored.version, 3)
    assert.equal(stored.access_version, 2)
    assert.equal(stored.removed_at.toISOString(), stored.updated_at.toISOString())
    const events = await pool.query("SELECT request_id,payload FROM outbox_events WHERE aggregate_id=$1 AND type='PersonAccessRevoked.v1'", [f.person.id])
    assert.equal(events.rowCount, 1)
    assert.equal(events.rows[0].request_id, trace)
    assert.equal(events.rows[0].payload.accessVersion, 2)
    assert.equal(events.rows[0].payload.reason, 'person_removed')
    assert.equal(events.rows[0].payload.accountId, f.accountId)
    assert.equal(events.rows[0].payload.personId, f.person.id)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM persons WHERE account_id=$1', [f.accountId])).rows[0].n, 1)
  })

  await t.test('competing update and removal serialize; the loser cannot overwrite or revive a removed record', async () => {
    const f = await seed()
    const results = await Promise.allSettled([
      store.updatePerson(f.accountId, f.person.id, randomUUID(), 1, { displayName: 'Concurrent edit' }, randomUUID()),
      store.removePerson(f.accountId, f.person.id, randomUUID(), 1, randomUUID()),
    ])
    assert.equal(results.filter(value => value.status === 'fulfilled').length, 1)
    const failure = results.find(value => value.status === 'rejected').reason
    assert.ok(['VERSION_CONFLICT', 'NOT_FOUND'].includes(failure.code))
    if (results[1].status === 'fulfilled') await assert.rejects(store.getPerson(f.accountId, f.person.id), { code: 'NOT_FOUND' })
    else assert.equal((await store.getPerson(f.accountId, f.person.id)).version, 2)
  })

  await t.test('HTTP enforces origin, session, version and ownership; revoked storage still permits removal', async () => {
    const f = await seed(), other = await seed()
    const sessionId = randomUUID()
    let contextAccount = f.accountId, allowed = true
    const identity = createServer((request, response) => {
      assert.equal(request.headers.authorization, 'Bearer ' + 'a'.repeat(64))
      assert.equal(request.url, '/internal/v1/session-context')
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ data: {
        accountId: contextAccount, sessionId, expiresAt: new Date(Date.now() + 60000).toISOString(),
        storyStorage: { allowed, authorizationVersion: 2 },
      } }))
    })
    identity.listen(0, '127.0.0.1')
    await once(identity, 'listening')
    const config = { webOrigin: 'http://127.0.0.1:5184', sessionCookie: 'xijie_dev_session', serviceToken: 'a'.repeat(64),
      identityContextUrl: new URL(`http://127.0.0.1:${identity.address().port}/internal/v1/session-context`) }
    const app = await NestFactory.create(PeopleModule.register(config, store), { logger: false })
    app.use(peopleHeaders)
    app.useGlobalFilters(new PeopleErrors())
    await app.listen(0, '127.0.0.1')
    t.after(async () => { await app.close(); identity.close(); await once(identity, 'close') })
    const origin = await app.getUrl()
    const headers = { Origin: config.webOrigin, Cookie: 'xijie_dev_session=' + 'b'.repeat(43), 'Idempotency-Key': randomUUID(),
      'Content-Type': 'application/json', 'If-Match': '"v1"', 'X-Xijie-Expected-Session': sessionId }
    const patch = (overrides = {}, id = f.person.id, body = { displayName: 'HTTP edit' }) =>
      fetch(origin + '/v1/persons/' + id, { method: 'PATCH', headers: { ...headers, ...overrides }, body: JSON.stringify(body) })
    assert.equal((await patch({ Origin: 'https://untrusted.invalid' })).status, 403)
    assert.equal((await patch({ Cookie: '' })).status, 401)
    assert.equal((await patch({ 'If-Match': '' })).status, 428)
    assert.equal((await patch({ 'X-Xijie-Expected-Session': randomUUID() })).status, 401)
    assert.equal((await patch({}, other.person.id)).status, 404)
    assert.equal((await patch({}, f.person.id, { worldId: world.id })).status, 400)
    const saved = await patch({}, f.person.id, { displayName: 'HTTP edit', realName: '合成姓名', birthMonthDay: '03-15' })
    assert.equal(saved.status, 200)
    assert.equal(saved.headers.get('ETag'), '"v2"')
    assert.equal((await saved.json()).data.realName, '合成姓名')
    const updateEvent = (await pool.query("SELECT request_id FROM outbox_events WHERE aggregate_id=$1 AND type='PersonUpdated.v1'", [f.person.id])).rows[0]
    assert.equal(updateEvent.request_id, saved.headers.get('X-Request-Id'))
    headers['If-Match'] = '"v2"'
    headers['Idempotency-Key'] = randomUUID()
    allowed = false
    assert.equal((await patch()).status, 403)
    const key = randomUUID()
    const remove = () => fetch(origin + '/v1/persons/' + f.person.id, { method: 'DELETE', headers: { ...headers, 'Idempotency-Key': key } })
    const removed = await remove()
    assert.equal(removed.status, 204)
    assert.equal(await removed.text(), '')
    assert.equal((await remove()).status, 204)
    assert.equal((await fetch(origin + '/v1/persons/' + f.person.id, { headers })).status, 404)
    contextAccount = other.accountId
    assert.equal((await remove()).status, 404)
    assert.equal((await store.getPerson(other.accountId, other.person.id)).status, 'active')
  })
})
