import { Pool } from "pg"
import { readConfig } from "./config.js"
import { Dependencies } from "./dependencies.js"
import { ConversationQueue } from "./queue.js"
import { ConversationStore } from "./store.js"
import { createGenerationProvider } from "./provider.js"
import { GenerationEngine } from "./engine.js"
import {LetterEngine} from './letter-engine.js'
import {createLetterGenerationProvider} from './letter-provider.js'
import {PhotoEngine} from './photo-engine.js'
import {createPhotoGenerationProvider} from './photo-provider.js'
import {GatherEngine} from './gather-engine.js'
import {createGatherGenerationProvider} from './gather-provider.js'
import {StoryEngine} from './story-engine.js'
import {createStoryProvider} from './story-provider.js'
import { ReplySpeechStore } from './reply-speech.js'
import { ReplySpeechProvider, replySpeechConfig } from './reply-speech-provider.js'
import { executeModel } from '../../../runtime/model-execution.mjs'
const config = readConfig(),
  pool = new Pool({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
  })
const queue = new ConversationQueue(config.databaseUrl, config.queueSchema)
pool.on("error", () =>
  console.error("Conversation worker database connection was interrupted."),
)
let engine: GenerationEngine | undefined,
  stopping = false
let letterEngine:LetterEngine|undefined
let gatherEngine:GatherEngine|undefined
let photoEngine:PhotoEngine|undefined
let storyEngine:StoryEngine|undefined
let recoveryTimer:NodeJS.Timeout|undefined
let speechTimer: NodeJS.Timeout | undefined, speechWork: Promise<void> | undefined
const speechLifetime = new AbortController()
async function stop() {
  if (stopping) return
  stopping = true
  clearInterval(recoveryTimer)
  clearInterval(speechTimer)
  speechLifetime.abort()
  await speechWork
  engine?.stop()
  letterEngine?.stop()
  gatherEngine?.stop()
  photoEngine?.stop()
  storyEngine?.stop()
  await queue.stop()
  await pool.end()
}
try {
  await pool.query("SELECT 1 FROM conversations_schema_migrations LIMIT 1")
  await pool.query('SELECT world_context_ref FROM generation_jobs LIMIT 1')
  await pool.query('SELECT b.scene,r.plan_snapshot FROM story_branches b LEFT JOIN offline_life_runs r ON r.account_id=b.account_id LIMIT 0')
  await pool.query('SELECT m.conversation_kind,s.memory_context_refs FROM messages m LEFT JOIN gather_reply_slots s ON s.job_id=m.gather_reply_job_id LIMIT 0')
  await pool.query('SELECT l.storage_authorization_version,l.source_memory_id,l.source_memory_version,j.provider_provenance,r.sequence,c.last_read_sequence FROM letters l LEFT JOIN letter_reply_jobs j ON j.letter_id=l.id LEFT JOIN letter_replies r ON r.letter_id=l.id LEFT JOIN letter_read_cursors c ON c.account_id=l.account_id AND c.person_id=l.person_id LIMIT 0')
  await pool.query('SELECT m.photo_reply_job_id,p.media_version FROM messages m LEFT JOIN message_media p ON p.message_id=m.id LIMIT 0')
  await queue.start()
  const store=new ConversationStore(pool, new Dependencies(config), queue)
  const speechSettings = replySpeechConfig()
  if (speechSettings.enabled && speechSettings.model) {
    await pool.query('SELECT id FROM chat_reply_speech LIMIT 0')
    const speech = new ReplySpeechStore(store)
    const provider = new ReplySpeechProvider(speechSettings.model)
    speechTimer = setInterval(() => {
      if (stopping || speechWork) return
      speechWork = (async () => {
        const task = await speech.candidate()
        if (!task?.attempt_id) return
        const signal = AbortSignal.any([speechLifetime.signal, AbortSignal.timeout(33_000)])
        try {
          const source = await speech.sourceText(task)
          const accountId = task.account_id
          const result = await executeModel({ accountId, jobId: task.id, attemptId: task.attempt_id, signal }, 'conversations', 'speech_reply', async () => {
            if (await speech.sourceText(task) !== source || signal.aborted) throw new Error('Reply speech source changed.')
            return provider.speak(accountId, source, signal)
          }, { provider: 'openai', model: provider.model })
          if (!signal.aborted) await speech.complete(task, result.response.modelId, result.wav)
          else await speech.fail(task, 'failed')
        } catch (error) {
          const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined
          await speech.fail(task, status === 403 || status === 404 || status === 409 ? 'blocked' : 'failed')
        }
      })().catch(() => console.error('Reply speech processing was interrupted.')).finally(() => { speechWork = undefined })
    }, 800).unref()
  }
  await store.reconcileDeliveries()
  await store.letters.reconcile()
  await store.gather.reconcile()
  await store.photos.reconcile()
  await store.stories.reconcile()
  let reconciling=false
  recoveryTimer=setInterval(()=>{
    if(reconciling||stopping)return
    reconciling=true
    void Promise.all([store.reconcileDeliveries(),store.letters.reconcile(),store.gather.reconcile(),store.photos.reconcile(),store.stories.reconcile()]).catch(()=>console.error('Conversation delivery recovery was interrupted.')).finally(()=>{reconciling=false})
  },10000).unref()
  engine = new GenerationEngine(
    store,
    createGenerationProvider(),
  )
  await queue.work((id) => engine!.run(id))
  letterEngine=new LetterEngine(store.letters,createLetterGenerationProvider())
  await queue.workLetters(id=>letterEngine!.run(id))
  gatherEngine=new GatherEngine(store.gather,createGatherGenerationProvider())
  await queue.workGather((id,personId)=>gatherEngine!.run(id,personId))
  photoEngine=new PhotoEngine(store.photos,createPhotoGenerationProvider())
  await queue.workPhoto(id=>photoEngine!.run(id))
  storyEngine=new StoryEngine(store.stories,createStoryProvider())
  await queue.workStories((mode,id)=>storyEngine!.run(mode,id))
  process.once("SIGINT", () => {
    void stop()
  })
  process.once("SIGTERM", () => {
    void stop()
  })
  console.log("Conversations reply worker listening.")
} catch (error) {
  await stop().catch(() => {})
  console.error(
    "Conversation worker startup failed.",
    error instanceof Error ? error.name : typeof error,
  )
  process.exitCode = 1
}
