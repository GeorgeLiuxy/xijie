import {Pool} from 'pg'
import {readConfig} from './config.js'
import {readReportConfig,ReportGateway} from './report-dependencies.js'
import {ReportStore} from './content-reports.js'
const base=readConfig(),config=readReportConfig(base.origin)
if(!config.enabled)throw Error('Content reports worker is not enabled')
const pool=new Pool({connectionString:base.databaseUrl,connectionTimeoutMillis:5000,statement_timeout:10000,max:3}),store=new ReportStore(pool,new ReportGateway(config))
let stopped=false,running:Promise<void>|undefined
async function tick(){if(stopped||running)return;running=store.reconcile().catch(()=>{console.error('Content report actions remain pending.')});try{await running}finally{running=undefined}}
const timer=setInterval(()=>void tick(),5000)
async function stop(){if(stopped)return;stopped=true;clearInterval(timer);await running;await pool.end()}
process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());await tick();console.log('Content reports worker listening.')
