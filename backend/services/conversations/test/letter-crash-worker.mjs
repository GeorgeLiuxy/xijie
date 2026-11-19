// A child process with real PostgreSQL/pg-boss and a controlled model interruption.
import pg from 'pg'
import {ConversationQueue} from '../dist/queue.js'
import {LetterStore} from '../dist/letters.js'
import {LetterEngine} from '../dist/letter-engine.js'
const fixture=JSON.parse(process.env.LETTER_CRASH_CONTEXT)
const pool=new pg.Pool({connectionString:process.env.XIJIE_TEST_DATABASE_URL,options:'-c search_path='+process.env.LETTER_CRASH_SCHEMA})
const queue=await new ConversationQueue(process.env.XIJIE_TEST_DATABASE_URL,process.env.LETTER_CRASH_QUEUE_SCHEMA).start()
const dependencies={account:async()=>fixture.account,person:async()=>fixture.person,virtualWorld:async()=>fixture.world}
const engine=new LetterEngine(new LetterStore(pool,dependencies,queue),{generate:async input=>{process.send({stage:'model-started'});return new Promise((resolve,reject)=>input.signal.addEventListener('abort',()=>reject(new Error('Controlled shutdown')),{once:true}))}})
await queue.workLetters(id=>engine.run(id))
let stopping=false
async function stop(){if(stopping)return;stopping=true;engine.stop();await queue.stop();await pool.end();process.disconnect()}
process.once('SIGTERM',()=>void stop())
process.on('message',value=>{if(value?.shutdown)void stop()})
