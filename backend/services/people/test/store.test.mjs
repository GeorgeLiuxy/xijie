import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import pg from 'pg'
import { draftFields } from '../dist/contracts.js'
import { PeopleStore } from '../dist/store.js'

const connectionString = process.env.XIJIE_TEST_DATABASE_URL
if (!connectionString) throw new Error('Set XIJIE_TEST_DATABASE_URL to a PostgreSQL integration test database.')

test('text drafts persist with account isolation, idempotency, and optimistic concurrency', async t => {
  const admin = new pg.Pool({ connectionString })
  const schema = 'xijie_people_test_' + randomUUID().replaceAll('-', '')
  t.after(async () => {
    try { await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE') } finally { await admin.end() }
  })
  await admin.query('CREATE SCHEMA ' + schema)
  const pool = new pg.Pool({ connectionString, options: '-c search_path=' + schema })
  try {
    await pool.query(await readFile(new URL('../db/001_person_drafts.sql', import.meta.url), 'utf8'))
    await pool.query(await readFile(new URL('../db/002_person_confirmation.sql', import.meta.url), 'utf8'))
    await pool.query(await readFile(new URL('../db/003_person_lifecycle.sql', import.meta.url), 'utf8'))
    await pool.query(await readFile(new URL('../db/004_original_seek_fields.sql', import.meta.url), 'utf8'))
    await pool.query(await readFile(new URL('../db/005_data_rights.sql', import.meta.url), 'utf8'))
    await pool.query(await readFile(new URL('../db/006_automatic_memory_sources.sql', import.meta.url), 'utf8'))
    await pool.query(await readFile(new URL('../db/007_world_movements.sql', import.meta.url), 'utf8'))
    await pool.query(await readFile(new URL('../db/008_person_photos.sql', import.meta.url), 'utf8'))
    await pool.query(await readFile(new URL('../db/009_structured_profile.sql', import.meta.url), 'utf8'))
    await pool.query(await readFile(new URL('../db/010_person_reminders.sql', import.meta.url), 'utf8'))
    await pool.query(await readFile(new URL('../db/011_voice_samples_and_preferences.sql', import.meta.url), 'utf8'))
    const store = new PeopleStore(pool)
    const a = randomUUID()
    const b = randomUUID()
    const key = randomUUID()
    const payload = draftFields({ story: '  Synthetic first line.\nSecond line.  ', displayName: ' Draft A ' }, false)
    assert.throws(() => draftFields({ accountId: a }, false), { code: 'INVALID_ARGUMENT' })
    assert.throws(() => draftFields({ displayName: '\ud800' }, false), { code: 'INVALID_ARGUMENT' })
    assert.equal(draftFields({ displayName: '😀'.repeat(80) }, false).displayName.length, 160)
    const writes = await Promise.allSettled(Array.from({ length: 4 }, () => store.create(a, 1, key, payload)))
    const first = writes.find(result => result.status === 'fulfilled').value
    for (const result of writes) {
      if (result.status === 'rejected') assert.equal(result.reason.code, 'REQUEST_IN_PROGRESS')
      else assert.deepEqual(result.value, first)
    }
    assert.equal(first.story, 'Synthetic first line.\nSecond line.')
    assert.equal(first.displayName, 'Draft A')
    assert.equal(first.version, 1)
    assert.equal((await store.list(a, 'draft', undefined, 2)).length, 1)
    assert.deepEqual(await store.create(a, 1, key, payload), first)
    await assert.rejects(store.create(a, 1, key, { story: 'different' }), { code: 'IDEMPOTENCY_CONFLICT' })

    const isolated = await store.create(b, 1, key, { story: 'Draft B' })
    assert.notEqual(isolated.id, first.id)
    assert.deepEqual(await store.list(b, 'draft', undefined, 2), [isolated])
    await assert.rejects(store.get(b, first.id), { code: 'NOT_FOUND' })
    await assert.rejects(store.update(b, first.id, 1, randomUUID(), 1, { story: 'different' }), { code: 'NOT_FOUND' })

    const editA = randomUUID()
    const editB = randomUUID()
    const changes = [{ relationship: 'friend' }, { relationship: 'neighbor' }]
    const editKeys = [editA, editB]
    const competing = await Promise.allSettled(editKeys.map((key, i) => store.update(a, first.id, 2, key, 1, changes[i])))
    assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1)
    const winner = competing.findIndex(result => result.status === 'fulfilled')
    const saved = competing[winner].value
    const lost = competing[1 - winner].reason
    assert.equal(lost.code, 'VERSION_CONFLICT')
    assert.deepEqual(lost.details, { currentVersion: 2 })
    assert.equal(saved.version, 2)
    assert.equal(saved.story, first.story)
    const cleared = await store.update(a, first.id, 3, randomUUID(), 2, { story: null })
    assert.equal(cleared.version, 3)
    assert.equal(cleared.story, undefined)
    assert.deepEqual(await store.update(a, first.id, 3, editKeys[winner], 1, changes[winner]), saved)
    assert.deepEqual(await store.get(a, first.id), cleared)
    const persisted = await pool.query('SELECT authorization_version FROM person_drafts WHERE id = $1', [first.id])
    assert.equal(persisted.rows[0].authorization_version, 3)

    const other = await store.create(a, 3, randomUUID(), {})
    const page = await store.list(a, 'draft', undefined, 1)
    const following = await store.list(a, 'draft', page[0], 1)
    assert.deepEqual(new Set([...page, ...following].map(item => item.id)), new Set([first.id, other.id]))
    await pool.query(
      "UPDATE person_drafts SET created_at = now() - interval '32 days', updated_at = now() - interval '31 days', expires_at = now() - interval '1 day' WHERE id = $1",
      [first.id],
    )
    assert.equal((await store.get(a, first.id)).status, 'expired')
    assert.deepEqual(await store.list(a, 'draft', undefined, 2), [other])
    await assert.rejects(store.update(a, first.id, 3, randomUUID(), 3, { story: 'late edit' }), { code: 'CONFLICT' })

    await t.test('a current authorized preview confirms one person and one event', async () => {
      const account = randomUUID()
      const otherAccount = randomUUID()
      const worlds = await store.worlds(undefined, 10)
      assert.deepEqual(worlds.map(world => world.code), ['courtyard', 'tide', 'isles'])
      assert.deepEqual(await store.worlds(worlds[0].id, 1), [worlds[1]])
      const draft = await store.create(account, 1, randomUUID(), {
        displayName: 'Test person', relationship: 'friend', story: 'Synthetic account story.',
      })
      const previewKey = randomUUID()
      const input = { worldPreferenceId: worlds[1].id, previousPreviewId: null }
      const first = await store.createPreview(account, draft.id, 1, previewKey, 1, input)
      assert.deepEqual(await store.createPreview(account, draft.id, 1, previewKey, 1, input), first)
      const current = await store.getPreview(account, draft.id, first.id, 1)
      assert.equal(current.summary, draft.story)
      assert.equal(current.suggestedWorldId, worlds[1].id)
      await assert.rejects(store.getPreview(otherAccount, draft.id, first.id, 1), { code: 'NOT_FOUND' })
      const revoked = await store.getPreview(account, draft.id, first.id, null)
      assert.equal(revoked.status, 'stale')
      assert.equal(revoked.summary, undefined)
      assert.deepEqual(revoked.sourceRefs, [])
      await assert.rejects(store.confirm(account, draft.id, 2, randomUUID(), 1, {
        previewId: first.id, worldId: worlds[1].id,
      }, randomUUID()), { code: 'CONFLICT' })

      const edited = await store.update(account, draft.id, 2, randomUUID(), 1, { story: 'Edited synthetic story.' })
      assert.equal((await store.getPreview(account, draft.id, first.id, 2)).status, 'stale')
      const candidate = await store.createPreview(account, draft.id, 2, randomUUID(), edited.version, {
        worldPreferenceId: null, previousPreviewId: null,
      })
      const replacement = await store.createPreview(account, draft.id, 2, randomUUID(), edited.version, {
        worldPreferenceId: null, previousPreviewId: candidate.id,
      })
      assert.equal((await store.getPreview(account, draft.id, candidate.id, 2)).status, 'stale')
      await assert.rejects(store.confirm(account, draft.id, 2, randomUUID(), edited.version, {
        previewId: candidate.id, worldId: worlds[2].id,
      }, randomUUID()), { code: 'CONFLICT' })
      const key = randomUUID()
      const confirm = { previewId: replacement.id, worldId: worlds[2].id }
      const results = await Promise.all([
        store.confirm(account, draft.id, 2, key, edited.version, confirm, randomUUID()),
        store.confirm(account, draft.id, 2, randomUUID(), edited.version, confirm, randomUUID()),
      ])
      assert.deepEqual(results[0], results[1])
      const person = results[0]
      assert.equal(person.story, edited.story)
      assert.deepEqual(await store.confirm(account, draft.id, 2, key, edited.version, confirm, randomUUID()), person)
      await assert.rejects(store.confirm(account, draft.id, 2, key, edited.version, {
        ...confirm, worldId: worlds[0].id,
      }, randomUUID()), { code: 'IDEMPOTENCY_CONFLICT' })
      assert.equal((await store.get(account, draft.id)).confirmedPersonId, person.id)
      assert.equal((await store.get(account, draft.id)).status, 'confirmed')
      assert.deepEqual(await store.list(account, 'draft', undefined, 10), [])
      assert.deepEqual(await store.listPersons(account, worlds[2].id, undefined, 10), [person])
      assert.deepEqual(await store.listPersons(otherAccount, undefined, undefined, 10), [])
      await assert.rejects(store.getPerson(otherAccount, person.id), { code: 'NOT_FOUND' })
      assert.equal((await store.getPreview(account, draft.id, replacement.id, 2)).status, 'stale')
      const events = await pool.query("SELECT payload FROM outbox_events WHERE type = 'PersonConfirmed.v1'")
      assert.deepEqual(events.rows, [{
        payload: { accountId: account, personId: person.id, personVersion: person.version, worldId: person.worldId },
      }])
    })
  } finally {
    await pool.end()
  }
})
