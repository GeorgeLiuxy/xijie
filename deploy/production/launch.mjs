import {readFile,stat,lstat} from 'node:fs/promises'
import {resolve,dirname,isAbsolute} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {parseEnv} from 'node:util'
import {spawn} from 'node:child_process'

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
const entrypoints={identity:['main','rights-worker','reports-worker'],people:['main'],conversations:['main','worker'],memories:['main','worker','automatic-worker'],social:['main','echo-worker','albums-worker'],media:['main','worker'],gifts:['main','worker','return-worker']}
const inherited=['PATH','Path','SystemRoot','WINDIR','COMSPEC','TEMP','TMP','HOME','USERPROFILE']
export async function plan(filename){
 const configPath=resolve(filename),manifest=JSON.parse(await readFile(configPath,'utf8'))
 if(manifest.version!==1||!Array.isArray(manifest.processes)||manifest.processes.length>25||Object.keys(manifest).some(k=>!['version','processes'].includes(k)))throw new Error('Invalid runtime manifest')
 const result=[],ids=new Set(),databases=new Map(),serviceDatabases=new Map(),ports=new Set(),roleTokens=new Map(),tokenRoles=new Map()
 for(const p of manifest.processes){
  if(Object.keys(p).some(k=>!['id','service','entry','envFile','enabled'].includes(k))||typeof p.id!=='string'||!/^[a-z][a-z0-9-]{0,49}$/.test(p.id)||ids.has(p.id)||typeof p.enabled!=='boolean'||!entrypoints[p.service]?.includes(p.entry)||typeof p.envFile!=='string')throw new Error('Invalid or duplicate runtime process')
  ids.add(p.id);if(!p.enabled)continue
  const envPath=isAbsolute(p.envFile)?p.envFile:resolve(dirname(configPath),p.envFile),info=await lstat(envPath)
  if(!info.isFile()||info.isSymbolicLink()||info.size>65536||process.platform!=='win32'&&(info.mode&0o077)!==0)throw new Error('Runtime environment must be a private regular file')
  const env=Object.fromEntries(inherited.filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]))
  Object.assign(env,parseEnv(await readFile(envPath,'utf8')))
  if(env.NODE_ENV!=='production'||env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw new Error('Runtime requires verified production TLS')
  if(env.MODEL_API_KEY)throw new Error('Production model credentials must use MODEL_API_KEY_FILE')
  const kind=p.service.toUpperCase(),host=env[kind+'_HOST']??'127.0.0.1'
  if(!['127.0.0.1','::1','localhost'].includes(host))throw new Error('The host launcher only permits loopback API listeners')
  if(p.entry==='main'){
   const port=Number(env[kind+'_PORT']??({identity:3101,people:3102,conversations:3103,memories:3104,social:3105,media:3106,gifts:3107}[p.service]))
   if(!Number.isSafeInteger(port)||port<1024||port>65535||ports.has(port))throw new Error('Invalid or shared API listener')
   ports.add(port)
  }
  const database=new URL(env.DATABASE_URL??'');if(!['postgres:','postgresql:'].includes(database.protocol)||!database.pathname.slice(1)||database.hash||database.search)throw new Error('A dedicated service database is required')
  const destination=database.hostname+':'+(database.port||5432)+database.pathname,other=databases.get(destination)
  if(other&&other!==p.service)throw new Error('Different services must not share a database')
  if(serviceDatabases.has(p.service)&&serviceDatabases.get(p.service)!==destination)throw new Error('A service and its workers must use the same dedicated database')
  serviceDatabases.set(p.service,destination)
  databases.set(destination,p.service)
  for(const [key,value]of Object.entries(env))if(key.endsWith('_SERVICE_TOKEN')&&value){
   if(!/^[a-f0-9]{64}$/i.test(value))throw new Error('Invalid independent service credential')
   const normalized=value.toLowerCase()
   if(roleTokens.has(key)&&roleTokens.get(key)!==normalized||tokenRoles.has(normalized)&&tokenRoles.get(normalized)!==key)throw new Error('Service role credentials must be independent and consistent across processes')
   roleTokens.set(key,normalized);tokenRoles.set(normalized,key)
  }
  const cwd=resolve(repo,'backend/services',p.service),entry=resolve(cwd,'dist',p.entry+'.js')
  await stat(entry)
  result.push({...p,cwd,entry,env})
 }
 if(!result.length)throw new Error('No runtime process is enabled')
 return result
}
async function check(items){
 for(const item of items){
  const code=`try{const m=await import(${JSON.stringify(pathToFileURL(resolve(item.cwd,'dist/config.js')).href)});m.readConfig();}catch{console.error('Configuration validation failed for ${item.id}. Check private environment fields.');process.exitCode=1}`
  await new Promise((ok,bad)=>{const child=spawn(process.execPath,['--input-type=module','-e',code],{cwd:item.cwd,env:item.env,windowsHide:true,stdio:['ignore','ignore','inherit']});child.on('error',bad);child.on('exit',n=>n===0?ok():bad(new Error('Service configuration rejected')))})
 }
}
async function main(){
 const [command,...args]=process.argv.slice(2),index=args.indexOf('--config')
 if(!['check','start','migrate'].includes(command)||index<0||!args[index+1]||args.length!==2)throw new Error('Usage: node deploy/production/launch.mjs check|start|migrate --config ABSOLUTE_PRIVATE_RUNTIME_JSON')
 const items=await plan(args[index+1]);await check(items)
 if(command==='check'){console.log('Production static configuration passed for '+items.length+' processes. No network, database migration or process was started.');return}
 if(command==='migrate'){
  const done=new Set();for(const item of items){if(done.has(item.service))continue;done.add(item.service)
   await new Promise((ok,bad)=>{const child=spawn(process.execPath,['dist/migrate.js'],{cwd:item.cwd,env:item.env,windowsHide:true,stdio:'inherit'});child.on('error',bad);child.on('exit',n=>n===0?ok():bad(new Error('Migration failed for '+item.service)))})
  }return
 }
 const children=[],completed=[];let stopping=false
 const stop=()=>{if(stopping)return;stopping=true;for(const child of children)if(child.exitCode===null)child.kill('SIGTERM')}
 process.once('SIGINT',stop);process.once('SIGTERM',stop)
 for(const item of items){const child=spawn(process.execPath,[item.entry],{cwd:item.cwd,env:item.env,windowsHide:true,stdio:'inherit'});children.push(child);completed.push(new Promise(resolve=>{child.once('error',()=>{process.exitCode=1;stop();resolve()});child.once('exit',code=>{if(!stopping){process.exitCode=code||1;console.error('Runtime process exited: '+item.id);stop()}resolve()})}))}
 console.log('Private production processes launched; loopback listeners only. TLS ingress is managed separately.')
 await Promise.all(completed)
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Production launcher rejected configuration or execution. Inspect the named configuration fields locally; secrets are never printed.');process.exitCode=1})
