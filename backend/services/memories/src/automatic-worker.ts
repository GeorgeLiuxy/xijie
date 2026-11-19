import {eligibleModelAccounts} from '../../../runtime/model-execution.mjs'
import {Pool} from 'pg'
import {readConfig} from './config.js'
import {Dependencies} from './dependencies.js'
import type {AutoDependencies,AutomaticOrigin} from './automatic-contracts.js'
import {AutomaticMemoryStore} from './automatic-store.js'
import {AutomaticMemoryQueue} from './automatic-queue.js'
import {AutomaticMemoryEngine} from './automatic-engine.js'
import {automaticAllowedAccountIds,createAutomaticMemoryProvider} from './automatic-provider.js'
const config=readConfig()
let pool:Pool|undefined,queue:AutomaticMemoryQueue|undefined,engine:AutomaticMemoryEngine|undefined,timer:NodeJS.Timeout|undefined,stopping=false
async function stop(){if(stopping)return;stopping=true;clearInterval(timer);engine?.stop();await queue?.stop();await pool?.end()}
try{
 if(!config.automaticMemoryEnabled){console.log('Automatic memory worker is disabled.')}else{
  const accountIds=automaticAllowedAccountIds()
  if(!accountIds.length||accountIds.length>100)throw new Error('Automatic memory requires an explicit allowlist of 1 to 100 accounts')
  pool=new Pool({connectionString:config.databaseUrl,connectionTimeoutMillis:5000,statement_timeout:5000});pool.on('error',()=>console.error('Automatic memory database connection was interrupted.'))
  await pool.query('SELECT 1 FROM automatic_memory_jobs LIMIT 1')
  await pool.query('SELECT corrected_body FROM automatic_memory_entries LIMIT 0')
  queue=await new AutomaticMemoryQueue(config.databaseUrl,config.queueSchema).start()
  const dependencies=new Dependencies(config) as AutoDependencies,store=new AutomaticMemoryStore(pool,dependencies,queue)
  engine=new AutomaticMemoryEngine(store,createAutomaticMemoryProvider())
  let polling=false,cursor:string|undefined
  const poll=async()=>{
   if(polling||stopping)return;polling=true
   try{
    await store.reconcileDeliveries()
    // Keep ungranted accounts out of the event page, without acknowledging their sources.
    // A later explicit grant makes them eligible on the next poll; old message grants are
    // still fenced separately when their authoritative source is loaded.
    const page=accountIds.includes('*')?await eligibleModelAccounts('memories','automatic_memory',cursor):undefined
    const scoped=page?.items??accountIds
    const eligibleAccounts:string[]=[]
    for(const accountId of scoped)try{
     const account=await dependencies.account(accountId)
     if(account.storyStorage.allowed&&account.aiTextProcessing.allowed&&account.aiTextProcessing.automaticMemoryAllowed===true)eligibleAccounts.push(accountId)
    }catch{/* Restricted/deleted or temporarily unavailable accounts remain unacknowledged. */}
    if(!eligibleAccounts.length){cursor=page?.nextCursor??undefined;return}
    for(const origin of ['people','conversations']as AutomaticOrigin[]){
     const events=await dependencies.sourceEvents(origin,eligibleAccounts)
     for(const event of events){
      if(stopping)break
      if(!eligibleAccounts.includes(event.accountId))throw new Error('Unexpected automatic memory source account')
      try{await store.ingest(origin,event);await dependencies.ackSourceEvent(origin,event.eventId)}catch{console.error('Automatic memory source will be retried.')}
     }
    }
    cursor=page?.nextCursor??undefined
   }catch{console.error('Automatic memory source polling was interrupted.')}finally{polling=false}
  }
  await queue.work(dispatch=>engine!.run(dispatch));await poll()
  timer=setInterval(()=>{void poll()},5000).unref()
  process.once('SIGINT',()=>{void stop()});process.once('SIGTERM',()=>{void stop()});console.log('Automatic memory worker listening.')
 }
}catch(error){await stop().catch(()=>{});console.error('Automatic memory worker startup failed.',error instanceof Error?error.name:typeof error);process.exitCode=1}
