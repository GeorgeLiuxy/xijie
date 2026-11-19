import {Pool} from 'pg'
import {readConfig} from './config.js'
import {Dependencies} from './dependencies.js'
import {SocialStore} from './store.js'
import {AlbumStore} from './albums.js'
const config=readConfig();if(!config.albums.enabled)throw new Error('Shared albums worker is disabled')
const pool=new Pool({connectionString:config.databaseUrl,connectionTimeoutMillis:5000,statement_timeout:10000}),deps=new Dependencies(config),albums=new AlbumStore(new SocialStore(pool,deps),config.albums,deps)
pool.on('error',()=>console.error('Shared albums database interrupted.'))
let stopping=false,pending:Promise<void>|undefined
const poll=()=>{if(!pending&&!stopping)pending=albums.reconcile().catch(()=>console.error('Shared album work will be retried.')).finally(()=>{pending=undefined})}
await pool.query('SELECT kind,rules_version,capacity FROM shared_albums LIMIT 1');poll();const timer=setInterval(poll,5000)
async function stop(){if(stopping)return;stopping=true;clearInterval(timer);await pending;await pool.end()}
process.once('SIGINT',()=>{void stop()});process.once('SIGTERM',()=>{void stop()});console.log('Shared albums worker listening.')
