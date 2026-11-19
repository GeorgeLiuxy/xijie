import {AlbumStore} from './albums.js'
import "reflect-metadata"
import { NestFactory } from "@nestjs/core"
import { Pool } from "pg"
import { readConfig } from "./config.js"
import { Dependencies } from "./dependencies.js"
import { SocialStore } from "./store.js"
import { SocialModule, SocialErrors, socialHeaders } from "./http.js"
import {EchoQueue} from './echo-queue.js'
import {EchoStore} from './echo-store.js'
const config = readConfig(),
  pool = new Pool({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  })
pool.on("error", () => console.error("Social database connection interrupted."))
let queue:EchoQueue|undefined
try {
  await pool.query("SELECT 1 FROM social_schema_migrations LIMIT 1")
  await pool.query("SELECT 1 FROM posts LIMIT 1")
  await pool.query('SELECT 1 FROM social_generation_jobs LIMIT 1')
  if(config.albums.enabled)await pool.query('SELECT kind,rules_version,capacity FROM shared_albums LIMIT 1')
  const deps=new Dependencies(config),store=new SocialStore(pool,deps)
  store.albums=new AlbumStore(store,config.albums,deps)
  store.queueSchema=config.queueSchema
  if(config.echoEnabled){if(!config.memoriesOrigin)throw new Error('Missing memory source');queue=await new EchoQueue(config.databaseUrl,config.queueSchema).start();store.generations=new EchoStore(store,queue)}
  const app = await NestFactory.create(
    SocialModule.register(
      config,
      store,
    ),
    { abortOnError: false, logger: ["warn", "error"] },
  )
  const http = app.getHttpAdapter().getInstance()
  http.disable("x-powered-by")
  http.disable("etag")
  app.use(socialHeaders)
  app.useGlobalFilters(new SocialErrors())
  app.enableShutdownHooks()
  app.getHttpServer().once("close", () => {
    void (queue?.stop()??Promise.resolve()).finally(()=>pool.end())
  })
  await app.listen(config.port, config.host)
  console.log("Social service listening on " + config.host + ":" + config.port)
} catch (e) {
  await queue?.stop().catch(()=>{});await pool.end()
  console.error(
    "Social startup failed. Verify migration and configuration.",
    e instanceof Error ? e.name : typeof e,
  )
  process.exitCode = 1
}
