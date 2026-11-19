import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { test } from 'node:test'
import pg from 'pg'
import { ConsentStore } from '../dist/consent-store.js'
import { IdentityStore } from '../dist/store.js'
import { ModelExecutionStore } from '../dist/model-execution.js'

test('migration and Identity keep reply speech out of existing permissions and stop publication on withdrawal', async t => {
  const connectionString = process.env.XIJIE_TEST_DATABASE_URL
  assert(connectionString)
  const schema = 'speech_consent_' + randomUUID().replaceAll('-', '')
  const management = new pg.Pool({ connectionString })
  const pool = new pg.Pool({ connectionString, options: '-c search_path=' + schema })
  await management.query('CREATE SCHEMA ' + schema)
  t.after(async () => { await pool.end(); await management.query('DROP SCHEMA ' + schema + ' CASCADE'); await management.end() })
  const directory = new URL('../db/', import.meta.url)
  for (const file of (await readdir(directory)).filter(file => /^\d+_.+\.sql$/.test(file) && Number(file.slice(0,3)) <= 35).sort()) {
    await pool.query(await readFile(new URL(file,directory),'utf8'))
  }
  const identity = new IdentityStore(pool), consents = new ConsentStore(pool, identity)
  const id = randomUUID(), browserHash = randomUUID(), stateHash = randomUUID(), claimId = randomUUID()
  const proof = randomBytes(32).toString('base64url'), sessionHash = createHash('sha256').update(proof).digest('hex')
  await identity.begin({ id, browserHash, key:randomUUID(), purpose:'sign_in', sessionHash:null, stateHash, nonce:randomUUID(),
    verifier:randomUUID(), authorizationUrl:'https://id.example.test/oidc/auth', expiresAt:new Date(Date.now()+60_000) })
  await identity.claim({ browserHash, stateHash, claimId })
  assert(await identity.finish({ browserHash, attemptId:id, claimId, sessionHash,
    principal:{ issuer:'https://id.example.test/oidc', subject:'synthetic-reply-speech', authenticatedAt:new Date() } }))
  const actor = await identity.current(sessionHash)
  const record = async (purpose, decision, expectedAuthorizationVersion = 0) => {
    const policy = (await consents.policies('en')).find(value=>value.kind===purpose)
    return consents.record(sessionHash,actor.id,randomUUID(),randomUUID(),{
      policyId:policy.id, version:policy.version, purpose, decision, expectedAuthorizationVersion,
    })
  }
  await record('privacy_notice','acknowledge')
  await record('private_story_storage','grant')
  await record('ai_text_processing','grant')
  assert.deepEqual((await consents.authorizations(actor.accountId)).chatReplySpeech,{allowed:false,authorizationVersion:0})

  const configured = { NODE_ENV:'test', MODEL_EXECUTION_ENABLED:'true', MODEL_ALLOWED_ACCOUNT_IDS:actor.accountId,
    MODEL_MAX_CONCURRENT:'4', MODEL_DAILY_ACCOUNT_LIMIT:'8' }
  const previous = Object.fromEntries(Object.keys(configured).map(key => [key, process.env[key]]))
  Object.assign(process.env, configured)
  t.after(() => { for (const [key,value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  } })
  const models = new ModelExecutionStore(pool,consents)
  const input = purpose => ({accountId:actor.accountId,jobId:randomUUID(),attemptId:randomUUID(),purpose})
  await assert.rejects(models.claim('conversations',input('speech_reply')),{ code:'AI_PERMISSION_REQUIRED' })
  await record('private_chat_reply_speech','grant')
  const text = input('text_reply'), speech = input('speech_reply')
  await models.claim('conversations',text)
  await models.claim('conversations',speech)
  const ttl = await pool.query('SELECT authorizations FROM model_executions WHERE id=$1',[speech.attemptId])
  assert.deepEqual(ttl.rows[0].authorizations.chatReplySpeech,{ allowed:true,authorizationVersion:1 })
  await record('private_chat_reply_speech','revoke',1)
  assert.deepEqual(await models.finish('conversations',speech.attemptId,true),{ allowed:false })
  assert.deepEqual(await models.finish('conversations',text.attemptId,true),{ allowed:true })
  const events = await pool.query("SELECT aggregate_type FROM outbox_events WHERE account_id=$1 AND type='ChatReplySpeechRevoked.v1'",[actor.accountId])
  assert.deepEqual(events.rows,[{aggregate_type:'chat_reply_speech_authorization'}])
})
