import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'
import path from 'node:path'
import { DockerRuntime, SOURCE_SPECS, privateFilePermissions } from './runtime.mjs'

const enabled = process.env.XIJIE_RECOVERY_RUNTIME_TESTS === '1'
const root = fileURLToPath(new URL('../../', import.meta.url))
test('native runtime only creates isolated owned databases and rejects unsafe target metadata', { skip: !enabled, timeout: 90000 }, async () => {
  const live = new DockerRuntime(root), spec = SOURCE_SPECS.find(item => item.domain === 'identity')
  await assert.rejects(live.inspectSource({ ...spec, db: 'postgres' }), /allowlist/)
  const source = await live.inspectSource(spec)
  assert.equal(await live.sql(source, 'SHOW default_transaction_read_only'), 'on')
  await assert.rejects(live.remove(source, 'runtime-test-invalid'), /source/)

  // A fresh runtime knows no live source: recovery must work from authenticated metadata alone.
  const restore = new DockerRuntime(root), runId = 'runtime-test-' + randomBytes(6).toString('hex')
  await assert.rejects(restore.createTarget({ ...source, name: source.name + '-other' }, runId), /allowlist/)
  await assert.rejects(restore.sql(source, 'SELECT 1'), /inspected/)
  let target
  try {
    target = await restore.createTarget(structuredClone(source), runId)
    assert.equal(target.kind, 'target')
    await restore.sql(target, 'BEGIN; CREATE TABLE runtime_probe(id integer PRIMARY KEY,body text NOT NULL); INSERT INTO runtime_probe VALUES(1,\'synthetic\'); COMMIT;')
    assert.deepEqual(await restore.query(target, 'SELECT * FROM runtime_probe ORDER BY id'), [{ id: 1, body: 'synthetic' }])
    assert.equal(await restore.sql(target, 'SHOW timezone'), 'UTC')
    await assert.rejects(restore.remove(target, 'runtime-test-wrong-run'), /owned/)
    await assert.rejects(restore.sql({ ...target, name: 'not-the-owned-name' }, 'SELECT 1'), /inspected/)
    const scratch = path.join(root, '.tmp', 'recovery-dev', 'runtime', runId)
    assert.deepEqual(await fs.readdir(scratch), [], 'The password env file must be removed after container startup')
    const privateFile = path.join(scratch, 'permission-probe.txt')
    await fs.writeFile(privateFile, 'synthetic', { flag: 'wx', mode: 0o600 })
    try { await privateFilePermissions(privateFile); assert.equal(await fs.readFile(privateFile, 'utf8'), 'synthetic') }
    finally { await fs.unlink(privateFile) }
  } finally { if (target) await restore.remove(target, runId) }
  if (target) await assert.rejects(restore.sql(target, 'SELECT 1'), /inspected/)

  const orphan = await restore.createTarget(structuredClone(source), runId)
  const cleanup = new DockerRuntime(root)
  let removed = false
  try {
    assert.deepEqual(await cleanup.cleanupRun('runtime-test-unrelated'), { removed: 0 })
    assert.deepEqual(await cleanup.cleanupRun(runId), { removed: 1 }); removed = true
    assert.deepEqual(await cleanup.cleanupRun(runId), { removed: 0 })
  } finally { if (!removed) await restore.remove(orphan, runId) }
})
