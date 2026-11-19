import "reflect-metadata"
import { Pool } from "pg"
import { readConfig } from "./config.js"
import { Dependencies } from "./dependencies.js"
import { S3Storage } from "./storage.js"
import { MediaStore } from "./store.js"
import { createMediaApp } from "./http.js"
const config = readConfig(),
  pool = new Pool({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  }),
  storage = new S3Storage(config)
pool.on("error", () => console.error("Media database interrupted."))
try {
  await pool.query("SELECT 1 FROM media_schema_migrations LIMIT 1")
  await pool.query("SELECT 1 FROM media_objects LIMIT 1")
  await pool.query('SELECT 1 FROM media_conversation_grants LIMIT 1')
  await pool.query('SELECT 1 FROM person_voice_assets LIMIT 1')
  await storage.ready()
  const app = await createMediaApp(
    config,
    new MediaStore(pool, new Dependencies(config), storage, config),
  )
  app.enableShutdownHooks()
  app.getHttpServer().once("close", () => {
    storage.close()
    void pool.end()
  })
  await app.listen(config.port, config.host)
  console.log("Media service listening on " + config.host + ":" + config.port)
} catch (e) {
  storage.close()
  await pool.end()
  console.error(
    "Media startup failed.",
    e instanceof Error ? e.name : "UnknownError",
  )
  process.exitCode = 1
}
