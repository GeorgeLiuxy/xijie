import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { fixture, text, eventually } from './fixture.mjs'
import { GenerationEngine } from '../dist/engine.js'
import { worldContextRevision, virtualWorldUse } from '../dist/virtual-world.js'

async function setup(t) {
  const f = await fixture(t), actor = f.account()
  f.accounts.get(actor.id).worldActionProcessing = { allowed: true, authorizationVersion: 1 }
  f.people.get(actor.person.id).worldVersion = 1
  const person = await f.dependencies.person(actor.id, actor.person.id)
  const core = { accountId: actor.id, personId: person.id, personVersion: person.version, worldVersion: 1, reality: 'virtual', branch: 'main', currentWorld: { id: person.worldId, code: 'courtyard', displayName: 'Synthetic courtyard', enabled: true, catalogVersion: 1 }, recentMovements: [] }
  const world = { ...core, revision: worldContextRevision(core) }
  f.dependencies.virtualWorld = async () => structuredClone(world)
  const { conversation } = await f.store.ensure(actor.id, person.id, randomUUID())
  const accepted = await f.store.send(actor.id, conversation.id, randomUUID(), text('现在请独自在虚拟庭院里看一会儿云。'), randomUUID())
  return { ...f, actor, person, world, conversation, accepted }
}

test('world action stop while the real SQL claim is pending releases the claim without a model call', { timeout: 15000 }, async t => {
  const f = await setup(t), original = f.store.claim.bind(f.store)
  let entered, release
  const claimed = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  f.store.claim = async id => { const row = await original(id); entered(); await gate; return row }
  let calls = 0
  const engine = new GenerationEngine(f.store, { generate: async () => { calls++; throw new Error('A stopped worker must never call the model') } })
  const running = engine.run(f.accepted.generationJobId)
  const rejected = assert.rejects(running, /stopped while claiming/)
  await claimed
  engine.stop(); release()
  await rejected
  const job = await f.store.findJob(f.accepted.generationJobId)
  assert.equal(calls, 0); assert.equal(job.state, 'queued'); assert.equal(job.attempt_id, null); assert.equal(job.lease_until, null)
  assert.equal(job.attempt_count, 1); assert.equal(job.reply_id, null); assert.equal(job.world_action_decision, 'pending')
  assert.equal((await f.pool.query('SELECT count(*)::int n FROM person_world_events')).rows[0].n, 0)
  assert.equal((await f.pool.query("SELECT count(*)::int n FROM messages WHERE author_kind='persona'")).rows[0].n, 0)
})

test('world action commit rechecks the database lease after an actual source-row lock wait', { timeout: 15000 }, async t => {
  const f = await setup(t), job = await f.store.claim(f.accepted.generationJobId)
  assert(job)
  const action = { requestQuote: f.accepted.message.text, summary: '在当前虚拟庭院独自看了一会儿云。', memory: '这次看云只属于当前世界的虚拟经历。' }
  const output = { text: '我在虚拟庭院独自看了一会儿云。', decision: 'execute', action, provenance: { model: 'synthetic-model', responseId: 'synthetic-response', promptVersion: 'person-world-actions-v1' } }
  const context = { revision: await f.store.worldActions.revision(job), events: [], refs: [], memoryUses: [] }
  await f.pool.query("UPDATE generation_jobs SET lease_until=clock_timestamp()+interval '1 second' WHERE id=$1", [job.id])
  const blocker = await f.pool.connect()
  let outcome
  try {
    await blocker.query('BEGIN')
    const blockerPid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    await blocker.query('SELECT id FROM messages WHERE id=$1 FOR UPDATE', [f.accepted.message.id])
    outcome = f.store.complete(job, output.text, f.person.displayName, [{ id: f.accepted.message.id, version: f.accepted.message.version }], [], virtualWorldUse(f.world), { output, context })
      .then(value => ({ value }), error => ({ error }))
    // Observe the actual blocked query, rather than merely assuming a delay hit
    // the critical section. Every candidate here is blocked by our own client.
    await eventually(async () => (await f.pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::integer=ANY(pg_blocking_pids(pid)) AND query LIKE 'SELECT id,text FROM messages%') AS waiting", [blockerPid])).rows[0].waiting)
    await eventually(async () => (await f.pool.query('SELECT lease_until<=clock_timestamp() AS expired FROM generation_jobs WHERE id=$1', [job.id])).rows[0].expired)
    await blocker.query('COMMIT')
  } finally {
    await blocker.query('ROLLBACK'); blocker.release()
  }
  const result = await outcome
  assert.equal(result.error, undefined); assert.equal(result.value, false)
  const saved = await f.store.findJob(job.id)
  assert.equal(saved.reply_id, null); assert.equal(saved.world_action_decision, 'pending'); assert.equal(saved.state, 'running')
  assert.equal((await f.pool.query('SELECT count(*)::int n FROM person_world_events')).rows[0].n, 0)
  assert.equal((await f.pool.query("SELECT count(*)::int n FROM messages WHERE author_kind='persona'")).rows[0].n, 0)
  const conversation = (await f.pool.query('SELECT world_event_revision::text,last_sequence::text FROM conversations WHERE id=$1', [f.conversation.id])).rows[0]
  assert.deepEqual(conversation, { world_event_revision: '0', last_sequence: f.accepted.message.sequence })
})
