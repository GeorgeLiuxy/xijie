import { test } from 'node:test'
import assert from 'node:assert/strict'
import { capture, compareSnapshots, quarantine } from './policy.mjs'

const privateNote = 'PRIVATE_GIFT_NOTE_NEVER_IN_RECOVERY_REPORT'
const privateName = 'PRIVATE_GIFT_PERSON_NAME_NEVER_IN_RECOVERY_REPORT'
const target = { domain: 'gifts', kind: 'target', runId: 'gifts-recovery-unit' }

function fixture() {
  return {
    gifts_account_write_gates: [{ account_id: 'account-a', version: 4, erased_at: null, request_id: null }],
    gift_catalog_items: [{ id: 'flowers', version: 1, snapshot: { name: 'Flowers', cost: 3 } }],
    asset_lots: [{ id: 'lot-a', account_id: 'account-a', asset_type: 'postage', asset_id: 'postage', source: 'trial', balance_units: 17, issued_at: 'before', expires_at: null, policy_version: 'synthetic-trial-v1', issuance_transaction_id: 'credit' }],
    ledger_transactions: [
      { id: 'credit', account_id: 'account-a', reason: 'trial_grant', source_id: 'synthetic-trial-v1:unit', request_hash: 'credit-fingerprint', policy_version: 'synthetic-trial-v1', original_transaction_id: null },
      { id: 'debit', account_id: 'account-a', reason: 'gift_debit', source_id: 'delivery-a', request_hash: 'debit-fingerprint', policy_version: 'gift-trial-v1', original_transaction_id: null },
    ],
    ledger_entries: [
      { account_id: 'account-a', transaction_id: 'credit', line_no: 1, lot_id: 'lot-a', direction: 'credit', units: 20 },
      { account_id: 'account-a', transaction_id: 'debit', line_no: 1, lot_id: 'lot-a', direction: 'debit', units: 2 },
      { account_id: 'account-a', transaction_id: 'debit', line_no: 2, lot_id: 'lot-a', direction: 'debit', units: 1 },
    ],
    gift_deliveries: [{ id: 'delivery-a', account_id: 'account-a', acceptance_key: 'original-operation', request_hash: 'request-fingerprint', person_id: 'person-a', conversation_id: 'conversation-a', person_snapshot: { displayName: privateName, accessVersion: 1 }, gift_snapshot: { id: 'flowers', name: 'Flowers', cost: 3 }, quantity: 1, note: privateNote, source: 'trial', cost: 3, status: 'in_transit', version: 1, account_access_version: 1, gift_authorization_version: 1, created_at: 'before', scheduled_arrival_at: 'future', arrived_at: null, failed_at: null, debit_transaction_id: 'debit', reversal_transaction_id: null }],
    gifts_jobs: ['queued', 'running', 'failed', 'succeeded', 'blocked'].map((state, i) => ({
      id: 'job-' + state, account_id: 'account-a', delivery_id: 'delivery-a', kind: i % 2 ? 'project' : 'deliver', delivery_version: 1,
      state, version: i + 1, attempt_id: state === 'running' ? 'attempt' : null, attempt_count: i,
      lease_until: state === 'running' ? 'future' : null, retry_at: 'scheduled', created_at: 'before', updated_at: 'before',
      finished_at: ['succeeded', 'blocked'].includes(state) ? 'before' : null,
      failure_code: state === 'failed' ? 'DEPENDENCY_UNAVAILABLE' : state === 'blocked' ? 'AUTHORIZATION_CHANGED' : null,
    })),
    outbox_events: [{ id: 'event-a', account_id: 'account-a', type: 'GiftDeliveryAccepted.v1', aggregate_id: 'delivery-a', aggregate_version: 1, payload: { deliveryId: 'delivery-a' } }],
    gifts_erase_receipts: [],
  }
}

function runtime(records) {
  return {
    statements: [],
    async query(_target, sql) {
      if (sql.includes('SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind')) return Object.keys(records).map(name => ({ schema: 'public', name, kind: 'r' }))
      if (sql.includes('AS records')) return Object.entries(records).map(([name, rows]) => ({ name: 'public.' + name, records: rows.map(row => JSON.stringify(row)) }))
      if (sql.includes('AS executable_gift_jobs')) return [{ executable_gift_jobs: String(['gifts_jobs','gift_return_jobs','gift_received_projection_jobs'].flatMap(name=>records[name]??[]).filter(j => ['queued', 'running', 'failed'].includes(j.state) || j.attempt_id !== null || j.lease_until !== null).length) }]
      return []
    },
    async sql(_target, sql) {
      this.statements.push(sql)
      assert.match(sql, /UPDATE public\.gifts_jobs SET state='blocked'/)
      assert.match(sql, /WHERE state IN \('queued','running','failed'\)/)
      assert.equal((sql.match(/UPDATE /g) ?? []).length, records.gift_return_jobs ? 3 : 1)
      assert.doesNotMatch(sql, /(?:DELETE|INSERT)\s|UPDATE public\.(?:asset_lots|ledger_transactions|ledger_entries|gift_deliveries)/)
      for (const job of ['gifts_jobs','gift_return_jobs','gift_received_projection_jobs'].flatMap(name=>records[name]??[])) if (['queued', 'running', 'failed'].includes(job.state)) Object.assign(job, {
        state: 'blocked', attempt_id: null, lease_until: null, finished_at: 'restore-time', updated_at: 'restore-time', failure_code: 'RESTORE_REVIEW_REQUIRED', version: job.version + 1,
      })
    },
  }
}

const core = (snapshot, name) => snapshot.core.find(row => row.name === 'public.' + name)

test('journey photo state and permanent commands survive quarantine and source changes are visible',async()=>{
 const records=fixture()
 records.gift_delivery_photos=[{account_id:'account-a',delivery_id:'delivery-a',version:3,media_id:'media-a',media_version:2,metadata:{width:800,height:600},gift_authorization_version:1,photo_authorization_version:1}]
 records.gift_photo_commands=[{account_id:'account-a',acceptance_key:'photo-operation',delivery_id:'delivery-a',media_id:'media-a',expected_version:2,result_version:3}]
 const original=structuredClone(records),before=await capture(runtime(records),target)
 const report=await quarantine(runtime(records),target),after=await capture(runtime(records),target)
 assert.equal(report.assertions.coreContentUnchanged,true);assert.deepEqual(before.core,after.core)
 for(const table of ['gift_delivery_photos','gift_photo_commands'])assert.deepEqual(records[table],original[table])
 assert.equal(before.security.resources.find(r=>r.kind==='gift_delivery_photo').id,'delivery-a')
 assert.equal(before.security.resources.find(r=>r.kind==='gift_photo_command').id,'photo-operation')
 for(const field of ['version','media_id','photo_authorization_version']){
  const changed=structuredClone(records);changed.gift_delivery_photos[0][field]=field==='media_id'?'media-b':4
  assert.equal(compareSnapshots(before,await capture(runtime(changed),target)).equal,false)
 }
 const partial=structuredClone(records);delete partial.gift_photo_commands
 await assert.rejects(()=>quarantine(runtime(partial),target))
})

test('Gifts quarantine blocks pending jobs and changes only controls while preserving complete business facts and successful jobs', async () => {
  const records = fixture(), original = structuredClone(records), rt = runtime(records)
  const before = await capture(rt, target), report = await quarantine(rt, target), after = await capture(rt, target)
  assert.equal(report.assertions.giftJobsBlocked, true)
  assert.equal(report.assertions.coreContentUnchanged, true)
  assert.equal(report.counts.executable_gift_jobs, '0')
  assert.deepEqual(before.core, after.core)
  assert.equal(rt.statements.length, 1)
  for (const table of Object.keys(records).filter(name => name !== 'gifts_jobs')) assert.deepEqual(records[table], original[table])
  for (const state of ['succeeded', 'blocked']) assert.deepEqual(records.gifts_jobs.find(j => j.id === 'job-' + state), original.gifts_jobs.find(j => j.id === 'job-' + state))
  for (const state of ['queued', 'running', 'failed']) {
    const job = records.gifts_jobs.find(j => j.id === 'job-' + state)
    assert.equal(job.state, 'blocked'); assert.equal(job.attempt_id, null); assert.equal(job.lease_until, null)
  }
  assert.equal(JSON.stringify({ before, report, after }).includes(privateNote), false)
  assert.equal(JSON.stringify({ before, report, after }).includes(privateName), false)
})

test('return recovery preserves opened placement, read times and actual AI evidence while blocking all pending generation and projection',async()=>{
 const records=fixture()
 records.received_gifts=[{id:'received-a',account_id:'account-a',source_delivery_id:'delivery-a',generation_job_id:'return-a',note:privateNote,opened_at:'first-opening',placement:'space',return_authorization_version:1,version:3}]
 records.gift_notifications=[{id:'notification-a',account_id:'account-a',type:'gift_received',object_id:'received-a',read_at:'first-reading',version:2}]
 records.gift_mutation_receipts=[{account_id:'account-a',acceptance_key:'operation-a',resource_id:'received-a',kind:'placement',result_version:3}]
 records.gift_return_jobs=records.gifts_jobs.map(j=>({...j,id:'return-'+j.id,source_delivery_id:'delivery-a',person_context:{story:privateNote},provider_provenance:j.state==='succeeded'?{provider:'openai',model:'test-model',responseId:'provider-response'}:null,decision:j.state==='succeeded'?'gift':null,return_authorization_version:1}))
 records.gift_received_projection_jobs=records.gifts_jobs.map(j=>({...j,id:'projection-'+j.id,received_gift_id:'received-a',received_version:3}))
 const before=await capture(runtime(records),target),original=structuredClone(records),report=await quarantine(runtime(records),target),after=await capture(runtime(records),target)
 assert.equal(report.assertions.giftJobsBlocked,true);assert.deepEqual(before.core,after.core)
 for(const table of ['received_gifts','gift_notifications','gift_mutation_receipts'])assert.deepEqual(records[table],original[table])
 for(const table of ['gift_return_jobs','gift_received_projection_jobs']){
  assert.equal(records[table].some(j=>['queued','running','failed'].includes(j.state)),false)
  assert.deepEqual(records[table].find(j=>j.state==='succeeded'),original[table].find(j=>j.state==='succeeded'))
  const tampered=structuredClone(original);tampered[table][0].source_delivery_id='different-source'
  assert.notEqual(core(before,table+':provenance').digest,core(await capture(runtime(tampered),target),table+':provenance').digest)
 }
 assert.equal(before.security.resources.find(r=>r.kind==='gift_mutation_receipt').id,'operation-a')
 assert.equal(JSON.stringify({before,report,after}).includes(privateNote),false)
 const partial=structuredClone(original);delete partial.gift_notifications
 await assert.rejects(()=>quarantine(runtime(partial),target))
})

test('Gifts checkpoint provenance detects target, funding, grant version, expiry and successful-job changes', async () => {
  const before = await capture(runtime(fixture()), target)
  for (const [table, field, value] of [
    ['asset_lots', 'balance_units', 18], ['asset_lots', 'expires_at', 'changed-expiry'],
    ['ledger_transactions', 'source_id', 'different-fact'], ['ledger_entries', 'units', 19],
    ['gift_deliveries', 'gift_authorization_version', 2], ['gift_deliveries', 'conversation_id', 'other-conversation'],
    ['gift_deliveries', 'debit_transaction_id', 'other-debit'], ['gift_deliveries', 'note', 'corrected-private-note'],
  ]) {
    const changed = fixture(); changed[table][0][field] = value
    const snapshot = await capture(runtime(changed), target)
    assert.notEqual(core(before, table).digest, core(snapshot, table).digest)
    assert.equal(compareSnapshots(before, snapshot).equal, false)
  }
  for (const [field, value] of [['delivery_id', 'other-delivery'], ['delivery_version', 2], ['kind', 'project'], ['attempt_count', 50], ['retry_at', 'changed-schedule']]) {
    const changed = fixture(); changed.gifts_jobs[0][field] = value
    assert.notEqual(core(before, 'gifts_jobs:provenance').digest, core(await capture(runtime(changed), target), 'gifts_jobs:provenance').digest)
  }
  const success = fixture(); success.gifts_jobs.find(j => j.state === 'succeeded').finished_at = 'different-completion'
  assert.notEqual(core(before, 'gifts_jobs:succeeded').digest, core(await capture(runtime(success), target), 'gifts_jobs:succeeded').digest)
})

test('ledger composite resource identities retain every line and exact delivery state without exposing private notes', async () => {
  const records = fixture(), before = await capture(runtime(records), target)
  assert.deepEqual(before.security.resources.filter(r => r.kind === 'ledger_entry').map(r => r.id).sort(), ['credit:1', 'debit:1', 'debit:2'])
  assert.equal(before.security.resources.find(r => r.kind === 'gift_delivery').state, 'in_transit')
  records.ledger_entries.pop()
  const after = await capture(runtime(records), target), changes = compareSnapshots(before, after).differences
  assert(changes.some(r => r.resourceKind === 'ledger_entry' && r.id === 'debit:2' && r.change === 'removed'))
  assert(!changes.some(r => r.resourceKind === 'ledger_entry' && r.id === 'debit:1'))
  assert.equal(JSON.stringify({ before, after, changes }).includes(privateNote), false)
  assert.equal(JSON.stringify({ before, after, changes }).includes(privateName), false)
})
