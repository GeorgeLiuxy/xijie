// A separate process using the real queue/engine and synthetic dependency/model fixtures.
import pg from "pg"
import { ConversationQueue } from "../dist/queue.js"
import { ConversationStore } from "../dist/store.js"
import { GenerationEngine } from "../dist/engine.js"
const fixture = JSON.parse(process.env.CHAT_CRASH_CONTEXT)
const pool = new pg.Pool({
  connectionString: process.env.XIJIE_TEST_DATABASE_URL,
  options: "-c search_path=" + process.env.CHAT_CRASH_SCHEMA,
})
const queue = await new ConversationQueue(
  process.env.XIJIE_TEST_DATABASE_URL,
  process.env.CHAT_CRASH_QUEUE_SCHEMA,
).start()
const dependencies = {
  async account() {
    return fixture.account
  },
  async person() {
    return fixture.person
  },
}
const engine = new GenerationEngine(
  new ConversationStore(pool, dependencies, queue),
  {
    async generate(input) {
      process.send({ stage: "model-started" })
      return new Promise((_resolve,reject) => {input.signal.addEventListener('abort',()=>reject(new Error('Synthetic shutdown abort')),{once:true})})
    },
  },
)
await queue.work((id) => {
 if(process.env.CHAT_CRASH_BEFORE_CLAIM==='true'){process.send({stage:'fetched'});return new Promise(()=>{})}
 return engine.run(id)
})
let stopping=false
async function stop(){if(stopping)return;stopping=true;engine.stop();await queue.stop();await pool.end();process.disconnect()}
process.once('SIGTERM',()=>{void stop()})
// IPC calls the same shutdown handler on Windows, whose process.kill terminates directly.
process.on('message',value=>{if(value?.shutdown)void stop()})
