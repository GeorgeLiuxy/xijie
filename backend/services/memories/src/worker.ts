import {Pool} from 'pg'
import {readConfig} from './config.js'
import {Dependencies} from './dependencies.js'
import {CandidateStore} from './candidates.js'
import {CandidateQueue} from './queue.js'
import {SuggestionEngine} from './engine.js'
import {createSuggestionProvider} from './provider.js'
const config=readConfig(),pool=new Pool({connectionString:config.databaseUrl,connectionTimeoutMillis:5000,statement_timeout:5000}),queue=new CandidateQueue(config.databaseUrl,config.queueSchema)
pool.on('error',()=>console.error('Memory worker database connection was interrupted.'))
let engine:SuggestionEngine|undefined,timer:NodeJS.Timeout|undefined,stopping=false
async function stop(){if(stopping)return;stopping=true;clearInterval(timer);engine?.stop();await queue.stop();await pool.end()}
try{
 await pool.query('SELECT 1 FROM memory_generation_jobs LIMIT 1');await queue.start();const store=new CandidateStore(pool,new Dependencies(config),queue);await store.reconcileDeliveries();let checking=false
 timer=setInterval(()=>{if(checking||stopping)return;checking=true;void store.reconcileDeliveries().catch(()=>console.error('Memory task recovery was interrupted.')).finally(()=>{checking=false})},10000).unref()
 engine=new SuggestionEngine(store,createSuggestionProvider());await queue.work(dispatch=>engine!.run(dispatch))
 process.once('SIGINT',()=>{void stop()});process.once('SIGTERM',()=>{void stop()});console.log('Memory suggestion worker listening.')
}catch(error){await stop().catch(()=>{});console.error('Memory worker startup failed.',error instanceof Error?error.name:typeof error);process.exitCode=1}
