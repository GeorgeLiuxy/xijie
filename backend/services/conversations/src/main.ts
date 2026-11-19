import "reflect-metadata"
import { NestFactory } from "@nestjs/core"
import { Pool } from "pg"
import { readConfig } from "./config.js"
import { Dependencies } from "./dependencies.js"
import { ConversationQueue } from "./queue.js"
import { ConversationStore } from "./store.js"
import {VoiceCallStore} from './voice-store.js'
import {VoiceHub} from './voice-hub.js'
import {OpenAIRealtimeVoice,voiceConfig} from './voice-provider.js'
import {
  ConversationErrors,
  ConversationsModule,
  conversationHeaders,
} from "./http.js"
const config = readConfig(),
  pool = new Pool({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
  })
const queue = new ConversationQueue(config.databaseUrl, config.queueSchema)
pool.on("error", () =>
  console.error("Conversations database connection was interrupted."),
)
try {
  await pool.query("SELECT 1 FROM conversations_schema_migrations LIMIT 1")
  await pool.query('SELECT world_context_ref FROM generation_jobs LIMIT 1')
  await pool.query('SELECT b.scene,r.plan_snapshot FROM story_branches b LEFT JOIN offline_life_runs r ON r.account_id=b.account_id LIMIT 0')
  await pool.query('SELECT m.conversation_kind,s.memory_context_refs FROM messages m LEFT JOIN gather_reply_slots s ON s.job_id=m.gather_reply_job_id LIMIT 0')
  await pool.query('SELECT l.storage_authorization_version,l.source_memory_id,l.source_memory_version,j.provider_provenance,r.sequence,c.last_read_sequence FROM letters l LEFT JOIN letter_reply_jobs j ON j.letter_id=l.id LEFT JOIN letter_replies r ON r.letter_id=l.id LEFT JOIN letter_read_cursors c ON c.account_id=l.account_id AND c.person_id=l.person_id LIMIT 0')
  await pool.query('SELECT m.photo_reply_job_id,p.media_version FROM messages m LEFT JOIN message_media p ON p.message_id=m.id LIMIT 0')
  await queue.start()
  const store = new ConversationStore(pool, new Dependencies(config), queue)
  const voiceSettings=voiceConfig(),voice=new VoiceHub(new VoiceCallStore(store,voiceSettings,config.serviceToken),new OpenAIRealtimeVoice(voiceSettings),config)
  const app = await NestFactory.create(
    ConversationsModule.register(config, store,voice),
    { abortOnError: false, logger: ["warn", "error"] },
  )
  app.getHttpAdapter().getInstance().disable("x-powered-by")
  app.getHttpAdapter().getInstance().disable("etag")
  app.use(conversationHeaders)
  app.useGlobalFilters(new ConversationErrors())
  app.enableShutdownHooks()
  await voice.attach(app.getHttpServer())
  process.once('SIGINT',()=>{void voice.close()});process.once('SIGTERM',()=>{void voice.close()})
  app.getHttpServer().once("close", () => {
    void voice.close().finally(()=>queue.stop()).finally(() => pool.end())
  })
  await app.listen(config.port, config.host)
  console.log(
    "Conversations service listening on " + config.host + ":" + config.port,
  )
} catch (error) {
  await queue.stop().catch(() => {})
  await pool.end()
  console.error(
    "Conversations startup failed. Verify migration and dependencies.",
    error instanceof Error ? error.name : typeof error,
  )
  process.exitCode = 1
}
