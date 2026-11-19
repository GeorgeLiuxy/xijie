import 'reflect-metadata'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { NestFactory } from '@nestjs/core'
import { fixture } from './fixture.mjs'
import { GenerationEngine } from '../dist/engine.js'
import { ConversationErrors, ConversationsModule, conversationHeaders } from '../dist/http.js'
import { ReplySpeechStore } from '../dist/reply-speech.js'
import { pcmWav, replySpeechConfig, ReplySpeechProvider } from '../dist/reply-speech-provider.js'
import { eraseConversations, exportConversations } from '../dist/data-rights.js'

const model = 'gpt-realtime-2.1-mini'
const words = '你的围巾还放在窗边。'
const syntheticAudio = Buffer.from([0, 0, 5, 0, 8, 0, 0, 0])

function speechEnvironment(t, accountId) {
  const current = { NODE_ENV: 'test', CONVERSATIONS_SPEECH_ENABLED: 'true', CONVERSATIONS_SPEECH_MODEL: model,
    MODEL_EXECUTION_ENABLED: 'true', MODEL_ALLOWED_ACCOUNT_IDS: accountId, MODEL_API_KEY: 'synthetic-transport-key' }
  const previous = Object.fromEntries(Object.keys(current).map(key => [key, process.env[key]]))
  Object.assign(process.env, current)
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  } })
}

test('isolated speech transport accepts a complete correlated WAV and rejects an altered transcript', async t => {
  const account = randomUUID()
  speechEnvironment(t, account)
  assert.deepEqual(replySpeechConfig(), { enabled: true, model })
  assert.throws(() => new ReplySpeechProvider('tts-1'))
  const transcript = ['你的围巾还放在窗边！', '你的帽子早已拿走。']
  class Socket extends EventEmitter {
    stopped = false
    send(value) {
      const event = JSON.parse(value)
      if (event.type === 'session.update') {
        this.emit('message', JSON.stringify({ type: 'session.updated', session: { ...event.session, id: 'sess_test' } }))
      } else {
        assert.equal(event.type, 'response.create')
        assert.equal(event.response.conversation, 'none')
        assert.deepEqual(event.response.input, [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: words }] }])
        for (const reply of [
          { type: 'response.created', response: { id: 'resp_test' } },
          { type: 'response.output_audio.delta', response_id: 'resp_test', item_id: 'item_test', output_index: 0, content_index: 0, delta: syntheticAudio.toString('base64') },
          { type: 'response.done', response: { id: 'resp_test', status: 'completed',
            usage: { input_tokens: 17, output_tokens: 23, input_token_details: { cached_tokens: 0 } },
            output: [{ id: 'item_test', type: 'message', role: 'assistant', content: [{ type: 'output_audio', transcript: transcript.shift() }] }] } },
        ]) this.emit('message', JSON.stringify(reply))
      }
    }
    terminate() { this.stopped = true }
  }
  const sockets = []
  const provider = new ReplySpeechProvider(model, (url, config) => {
    assert.equal(url, 'wss://api.openai.com/v1/realtime?model=' + model)
    assert.equal(config.followRedirects, false)
    const socket = new Socket(); sockets.push(socket)
    queueMicrotask(() => {
      socket.emit('open')
    })
    // The real Realtime service emits its initial session before confirming configuration.
    const original = socket.send.bind(socket)
    socket.send = value => {
      if (JSON.parse(value).type === 'session.update') socket.emit('message', JSON.stringify({ type: 'session.created', session: { id: 'sess_test' } }))
      original(value)
    }
    return socket
  })
  const result = await provider.speak(account, words, AbortSignal.timeout(2000))
  assert(result.wav.equals(pcmWav(syntheticAudio)))
  assert.deepEqual(result.usage.raw, { prompt_tokens: 17, completion_tokens: 23, prompt_tokens_details: { cached_tokens: 0 } })
  await assert.rejects(provider.speak(account, words, AbortSignal.timeout(2000)), { code: 'REPLY_SPEECH_PROVIDER_FAILED' })
  assert(sockets.every(socket => socket.stopped))
})

test('real HTTP and PostgreSQL bind one audio to exact text and grant, fence withdrawal, export and erasure', async t => {
  const f = await fixture(t)
  await f.pool.query(await readFile(new URL('../db/016_chat_reply_speech.sql', import.meta.url),'utf8'))
  const actor = f.account(), outsider = f.account()
  speechEnvironment(t, actor.id)
  const grant = { allowed: true, authorizationVersion: 1 }
  f.accounts.get(actor.id).chatReplySpeech = grant
  f.accounts.get(outsider.id).chatReplySpeech = { ...grant }
  const cid = (await f.store.ensure(actor.id, actor.person.id, randomUUID())).conversation.id
  const engine = new GenerationEngine(f.store, { async generate() { return { text: words } } })
  const source = await f.store.send(actor.id,cid,randomUUID(),{ clientMessageId: randomUUID(), kind:'text', text:'Any updates?', inputMode:'typed' },randomUUID())
  await engine.run(source.generationJobId)
  const replyId = (await f.store.getJob(actor.id, source.generationJobId)).replyIds[0]
  const config = { serviceToken: randomBytes(32).toString('hex'), webOrigin: 'http://127.0.0.1:1' }
  const app = await NestFactory.create(ConversationsModule.register(config, f.store), { logger: false, abortOnError: false })
  app.use(conversationHeaders); app.useGlobalFilters(new ConversationErrors()); await app.listen(0,'127.0.0.1')
  config.webOrigin = await app.getUrl()
  const resource = config.webOrigin + '/v1/conversations/' + cid + '/messages/' + replyId + '/speech'
  const headersFor = a => ({ Cookie:'xijie_dev_session='+a.credential, 'X-Xijie-Expected-Session':a.sessionId, Origin:config.webOrigin, 'If-Match':'"v1"' })
  const headers = headersFor(actor), request = (version=1) => fetch(resource,{ method:'POST',
    headers:{ ...headers, 'If-Match':'"v'+version+'"', 'Idempotency-Key':randomUUID(), 'Content-Type':'application/json' }, body:'{}' })
  const speech = new ReplySpeechStore(f.store)
  try {
    assert.equal((await fetch(resource,{ headers: headersFor(outsider) })).status,404)
    assert.deepEqual((await (await fetch(resource,{ headers })).json()).data,null)
    assert.equal((await fetch(resource,{ headers:{ ...headers,'If-Match':'"v9"' } })).status,409)
    assert.equal((await request(9)).status,409)
    assert.equal((await request()).status,202)
    assert.equal((await request()).status,202)
    assert.equal((await f.pool.query('SELECT COUNT(*)::int AS count FROM chat_reply_speech')).rows[0].count,1)
    const task = await speech.candidate()
    assert.equal(await speech.sourceText(task),words)
    grant.allowed = false
    await assert.rejects(speech.complete(task,model,pcmWav(syntheticAudio)),{ code:'REPLY_SPEECH_PERMISSION_REQUIRED' })
    assert.equal((await fetch(resource+'/audio',{ headers })).status,403)
    await speech.fail(task,'blocked')
    grant.allowed = true; grant.authorizationVersion = 3
    assert.deepEqual((await (await fetch(resource,{ headers })).json()).data,null)
    assert.equal((await request()).status,202)
    const next = await speech.candidate()
    assert.notEqual(task.id,next.id)
    const wav = pcmWav(syntheticAudio)
    assert.equal(await speech.complete(next,model,wav),true)
    const response = await fetch(resource+'/audio',{ headers })
    assert.equal(response.status,200)
    assert.equal(response.headers.get('content-type'),'audio/wav')
    assert.equal(response.headers.get('cache-control'),'private, no-store')
    assert(Buffer.from(await response.arrayBuffer()).equals(wav))
    assert.equal((await speech.candidate()),undefined)
    const pkg = await exportConversations(f.pool,f.dependencies,actor.id,'interaction_data')
    assert.equal(pkg.data.replySpeech.length,1)
    assert(Buffer.from(pkg.data.replySpeech[0].audio,'base64').equals(wav))
    await f.pool.query('UPDATE chat_reply_speech SET recovery_blocked=true WHERE id=$1',[next.id])
    assert.equal((await fetch(resource+'/audio',{ headers })).status,409)
    assert.equal(await speech.candidate(),undefined)
    // Production has another permission epoch. Regrant cannot revive the old attempt.
    process.env.NODE_ENV = 'production'
    f.accounts.get(actor.id).productionModelExecution = { allowed:true,authorizationVersion:1 }
    assert.deepEqual(await speech.request(actor.id,cid,replyId,1),{state:'queued'})
    const production = await speech.candidate()
    f.accounts.get(actor.id).productionModelExecution.authorizationVersion = 3
    await assert.rejects(speech.complete(production,model,wav),{code:'REPLY_SPEECH_SOURCE_CHANGED'})
    await speech.fail(production,'blocked')
    await eraseConversations(f.pool,f.queueSchema,actor.id,randomUUID())
    assert.equal((await f.pool.query('SELECT COUNT(*)::int AS count FROM chat_reply_speech')).rows[0].count,0)
    assert.equal((await fetch(resource+'/audio',{ headers })).status,404)
  } finally { await app.close() }
})
