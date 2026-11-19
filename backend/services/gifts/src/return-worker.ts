import {Pool} from 'pg';
import {readConfig} from './config.js';
import {Dependencies} from './dependencies.js';
import {GiftsStore} from './store.js';
import {GiftReturnsStore} from './returns.js';
import {createReturnGenerationProvider} from './return-provider.js';
const config=readConfig(),pool=new Pool({connectionString:config.databaseUrl,connectionTimeoutMillis:5000,statement_timeout:10000}),store=new GiftsStore(pool,new Dependencies(config),{returnEnabled:config.returnEnabled}),returns=new GiftReturnsStore(store,createReturnGenerationProvider());
pool.on('error',()=>console.error('Gift return worker database interrupted.'));
let stopped=false,active:Promise<void>|undefined,timer:NodeJS.Timeout|undefined;
async function tick(){if(stopped||active)return;active=(async()=>{try{const projection=await returns.claimProjection();if(projection)await returns.runProjection(projection);const job=await returns.claim();if(job)await returns.run(job);}catch{console.error('Gift return task will retry.');}})();try{await active;}finally{active=undefined;}}
async function stop(){stopped=true;clearInterval(timer);await active;await pool.end();}
try{await pool.query('SELECT 1 FROM gift_return_jobs LIMIT 1');process.once('SIGINT',()=>{void stop();});process.once('SIGTERM',()=>{void stop();});timer=setInterval(()=>{void tick();},500);await tick();console.log('Gift return worker listening.');}catch{await stop().catch(()=>{});console.error('Gift return worker startup failed.');process.exitCode=1;}
