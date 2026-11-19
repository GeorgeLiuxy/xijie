import pg from 'pg'
import {CandidateStore} from '../dist/candidates.js'
import {CandidateQueue} from '../dist/queue.js'
import {SuggestionEngine} from '../dist/engine.js'
const context=JSON.parse(process.env.MEMORY_CRASH_CONTEXT),pool=new pg.Pool({connectionString:process.env.XIJIE_TEST_DATABASE_URL,options:'-c search_path='+process.env.MEMORY_CRASH_SCHEMA})
const queue=await new CandidateQueue(process.env.XIJIE_TEST_DATABASE_URL,process.env.MEMORY_CRASH_QUEUE_SCHEMA).start()
const dependencies={async account(){return structuredClone(context.account)},async person(){return structuredClone(context.person)},async memoryContext(){return structuredClone(context.source)}}
const engine=new SuggestionEngine(new CandidateStore(pool,dependencies,queue),{async generate(input){process.send({stage:'model-started'});return new Promise((_resolve,reject)=>input.signal.addEventListener('abort',()=>reject(new Error('Synthetic shutdown')),{once:true}))}})
await queue.work(dispatch=>{if(process.env.MEMORY_CRASH_BEFORE_CLAIM==='true'){process.send({stage:'fetched'});return new Promise(()=>{})}return engine.run(dispatch)})
let stopping=false
async function stop(){if(stopping)return;stopping=true;engine.stop();await queue.stop();await pool.end();process.disconnect()}
process.once('SIGTERM',()=>{void stop()});process.on('message',value=>{if(value?.shutdown)void stop()})
