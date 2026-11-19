import { Pool } from "pg"
import { readConfig } from "./config.js"
import { Dependencies } from "./dependencies.js"
import { S3Storage } from "./storage.js"
import { MediaStore } from "./store.js"
import { MediaEngine } from "./engine.js"
import {PersonVoiceEngine} from './voice-engine.js'
const config = readConfig(),
  pool = new Pool({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  }),
  storage = new S3Storage(config),
  engine = new MediaEngine(
    new MediaStore(pool, new Dependencies(config), storage, config),
  )
const voiceEngine=new PersonVoiceEngine(engine.store.voices)
pool.on("error", () => console.error("Media worker database interrupted."))
let stopped = false,
  active: Promise<void> | undefined,
  timer: NodeJS.Timeout | undefined,
  lastReconcile = 0
async function tick() {
  if (stopped || active) return
  active = (async () => {
    try {
      if (Date.now() - lastReconcile > 5000) {
        await engine.reconcile()
        await voiceEngine.reconcile()
        lastReconcile = Date.now()
      }
      const job = await engine.claim()
      if (job) await engine.run(job)
      const voice=await voiceEngine.claim();if(voice)await voiceEngine.run(voice)
    } catch {
      console.error("Media worker operation will be retried.")
    }
  })()
  try {
    await active
  } finally {
    active = undefined
  }
}
async function stop() {
  if (stopped) return
  stopped = true
  engine.stop()
  voiceEngine.stop()
  clearInterval(timer)
  await active
  storage.close()
  await pool.end()
}
try {
  await pool.query("SELECT 1 FROM media_jobs LIMIT 1")
  await pool.query('SELECT 1 FROM media_conversation_grants LIMIT 1')
  await pool.query('SELECT 1 FROM person_voice_jobs LIMIT 1')
  await storage.ready()
  process.once("SIGINT", () => {
    void stop()
  })
  process.once("SIGTERM", () => {
    void stop()
  })
  timer = setInterval(() => {
    void tick()
  }, 750)
  await tick()
  console.log("Media processing worker listening.")
} catch (e) {
  await stop().catch(() => {})
  console.error(
    "Media worker startup failed.",
    e instanceof Error ? e.name : "UnknownError",
  )
  process.exitCode = 1
}
