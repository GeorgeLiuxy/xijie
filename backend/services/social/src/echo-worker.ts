import {eligibleModelAccounts} from '../../../runtime/model-execution.mjs'
import {Pool} from 'pg'
import {readConfig} from './config.js'
import {Dependencies} from './dependencies.js'
import {SocialStore} from './store.js'
import {EchoStore} from './echo-store.js'
import {EchoQueue} from './echo-queue.js'
import {EchoEngine} from './echo-engine.js'
import {echoAllowedAccounts,createEchoProvider} from './echo-provider.js'
const config=readConfig();if(!config.echoEnabled)throw new Error('Social AI worker is disabled')
const accounts=echoAllowedAccounts();if(!accounts.length)throw new Error('Explicit model scope is required')
const pool=new Pool({connectionString:config.databaseUrl,connectionTimeoutMillis:5000,statement_timeout:10000}),queue=new EchoQueue(config.databaseUrl,config.queueSchema);pool.on('error',()=>console.error('Social worker database interrupted.'))
let engine:EchoEngine|undefined,timer:NodeJS.Timeout|undefined,stopping=false,polling=false,pollDone:Promise<void>|undefined,cursor:string|undefined
async function stop(){if(stopping)return;stopping=true;clearInterval(timer);engine?.stop();await pollDone;await queue.stop();await pool.end()}
try{
 await pool.query('SELECT 1 FROM social_generation_jobs LIMIT 1');await queue.start();const deps=new Dependencies(config),store=new EchoStore(new SocialStore(pool,deps),queue);engine=new EchoEngine(store,createEchoProvider())
 const poll=async()=>{if(stopping||polling)return;polling=true;try{await store.reconcile();const page=accounts.includes('*')?await eligibleModelAccounts('social','memory_echo',cursor):undefined;const scoped=page?.items??accounts;const active:string[]=[];for(const id of scoped){if(stopping)break;try{await deps.account(id);active.push(id)}catch{}}if(active.length&&!stopping){for(const event of await deps.memoryEvents(active)){if(stopping)break;await store.ingest(event);await deps.ackMemoryEvent(event.eventId)}}cursor=page?.nextCursor??undefined}catch{console.error('Social memory sources will be retried.')}finally{polling=false}}
 await queue.work(d=>engine!.run(d));pollDone=poll();await pollDone;timer=setInterval(()=>{if(!polling&&!stopping)pollDone=poll()},5000).unref();process.once('SIGINT',()=>{void stop()});process.once('SIGTERM',()=>{void stop()});console.log('Social echo worker listening.')
}catch(e){await stop().catch(()=>{});console.error('Social echo worker startup failed.',e instanceof Error?e.name:typeof e);process.exitCode=1}
