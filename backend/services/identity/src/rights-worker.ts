import { Pool } from "pg"
import { readConfig } from "./config.js"
import { readRightsConfig } from "./rights-config.js"
import { RightsQueue } from "./rights-queue.js"
import { RightsStore } from "./rights.js"
import { RightsDependencies } from "./rights-provider.js"
import { RightsEngine } from "./rights-engine.js"
import { IdentityStore } from "./store.js"
const identity = readConfig(),
  config = readRightsConfig(identity)
if (!config.enabled) throw new Error("Data rights is not enabled")
const pool = new Pool({
    connectionString: identity.databaseUrl,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  }),
  queue = new RightsQueue(identity.databaseUrl, config.queueSchema)
pool.on("error", () =>
  console.error("Data rights database connection interrupted."),
)
await queue.start()
const store = new RightsStore(pool, new IdentityStore(pool), config, queue),
  engine = new RightsEngine(store, new RightsDependencies(config))
await store.recover()
const running=new Set<Promise<void>>()
await queue.work((value) => {const operation=engine.run(value);running.add(operation);void operation.finally(()=>running.delete(operation)).catch(()=>{});return operation})
let recovering = false
const recovery = setInterval(() => {
  if (recovering) return
  recovering = true
  void store
    .recover()
    .catch(() => console.error("Data rights recovery could not finish."))
    .finally(() => {
      recovering = false
    })
}, 5000).unref()
let stopping = false
const stop = () => {
  if (stopping) return
  stopping = true
  clearInterval(recovery)
  engine.stop()
  void Promise.allSettled([...running])
    .then(()=>queue.stop())
    .finally(() => pool.end())
    .finally(() => {
      process.exitCode = 0
    })
}
process.on("SIGINT", stop)
process.on("SIGTERM", stop)
console.log("Identity data rights worker listening.")
