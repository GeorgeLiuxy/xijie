import 'reflect-metadata'
import {NestFactory} from '@nestjs/core'
import {Pool} from 'pg'
import {readConfig} from './config.js'
import {Dependencies} from './dependencies.js'
import {MemoriesModule,MemoryErrors,memoryHeaders} from './http.js'
import {MemoryStore} from './store.js'
import {CandidateStore} from './candidates.js'
import {CandidateQueue} from './queue.js'
import {AutomaticMemoryStore} from './automatic-store.js'
import type {NestExpressApplication} from '@nestjs/platform-express'
const config=readConfig(),pool=new Pool({connectionString:config.databaseUrl,connectionTimeoutMillis:5000,statement_timeout:5000})
const queue=new CandidateQueue(config.databaseUrl,config.queueSchema)
pool.on('error',()=>console.error('Memories database connection was interrupted.'))
try{
 await pool.query('SELECT 1 FROM memory_generation_jobs LIMIT 1');await pool.query('SELECT corrected_body,last_control_key FROM automatic_memory_entries LIMIT 0');await queue.start();const dependencies=new Dependencies(config),candidates=new CandidateStore(pool,dependencies,queue),store=new MemoryStore(pool,dependencies,candidates);await store.sweepCommands()
 const automatic=new AutomaticMemoryStore(pool,dependencies)
 const app=await NestFactory.create<NestExpressApplication>(MemoriesModule.register(config,store,undefined,undefined,config.automaticMemoryEnabled?automatic:null,automatic),{abortOnError:false,logger:['warn','error']})
 app.useBodyParser('json',{limit:'1mb'})
 const http=app.getHttpAdapter().getInstance();http.disable('x-powered-by');http.disable('etag');app.use(memoryHeaders);app.useGlobalFilters(new MemoryErrors());app.enableShutdownHooks()
 await app.listen(config.port,config.host);const cleanup=setInterval(()=>{void store.sweepCommands().catch(()=>console.error('Expired memory commands could not be cleared.'))},3600000).unref()
 app.getHttpServer().once('close',()=>{clearInterval(cleanup);void queue.stop().finally(()=>pool.end())});console.log('Memories service listening on '+config.host+':'+config.port)
}catch(error){await queue.stop().catch(()=>{});await pool.end();console.error('Memories startup failed. Verify migration and configuration.',error instanceof Error?error.name:typeof error);process.exitCode=1}
