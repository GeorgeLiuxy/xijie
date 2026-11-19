import {randomBytes,randomUUID,createHmac,timingSafeEqual} from 'node:crypto'
import {mkdir,lstat,readFile,writeFile,rename,open,unlink} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {once} from 'node:events'
import {DockerRuntime,SOURCE_SPECS,privateFilePermissions} from './runtime.mjs'
import {capture,compareSnapshots,quarantine} from './policy.mjs'
import {loadKey,seal,sealBytes,openBytes,openTo,sha256} from './crypto.mjs'
import {captureSecurityReplay,validateReplayDomain,replaySecurity} from './security-replay.mjs'

export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
const PRIVATE=path.join(ROOT,'.tmp/recovery-dev'),ARCHIVES=path.join(PRIVATE,'archives'),KEY=path.join(PRIVATE,'keys/backup.key')
const CONFIGS=[...['identity','people','conversations','memories','social','media','gifts'].flatMap(name=>[`.tmp/${name}-dev/server.env`,`.tmp/${name}-dev/compose.env`]),'.tmp/gift-return-dev/scope.env']
const objectTools=()=>import('./object-storage.mjs')
const aad=(id,purpose)=>`xijie-backup:v1:${id}:${purpose}`
const checkpointHead=(backupId,capturedAt,artifact)=>({format:1,backupId,capturedAt,cipherSha256:artifact.cipherSha256,plainSha256:artifact.plainSha256})
const signHead=(head,key)=>createHmac('sha256',key).update(JSON.stringify(head)).digest('hex')
async function readHead(backupId,key){
 const file=await contained(path.join(PRIVATE,'checkpoints',backupId+'.json'));let value
 try{const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink())throw Error();value=JSON.parse(await readFile(file,'utf8'))}catch{throw new Error('Trusted latest checkpoint head is unavailable')}
 const {signature,...head}=value,expected=signHead(head,key)
 if(head.format!==1||head.backupId!==backupId||!/^[a-f0-9]{64}$/.test(signature??'')||!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(expected,'hex')))throw new Error('Trusted checkpoint head authentication failed')
 return head
}
async function publishHead(head,key){
 const directory=await contained(path.join(PRIVATE,'checkpoints'));await mkdir(directory,{recursive:true});await privateFilePermissions(directory)
 const file=await contained(path.join(directory,head.backupId+'.json'))
 const lockPath=await contained(path.join(directory,head.backupId+'.lock')),lock=await open(lockPath,'wx',0o600)
 try{try{await lstat(file);const old=await readHead(head.backupId,key);if(Date.parse(old.capturedAt)>=Date.parse(head.capturedAt))throw new Error('Checkpoint head must advance monotonically')}catch(e){if(e.code!=='ENOENT')throw e}
  const staged=await contained(path.join(directory,head.backupId+'-'+randomUUID()+'.tmp'));await writeFile(staged,JSON.stringify({...head,signature:signHead(head,key)}),{flag:'wx',mode:0o600});await rename(staged,file)
 }finally{await lock.close();await unlink(lockPath)}
}
function childDone(child){
 // Drain native diagnostics without exposing SQL/configuration or blocking a full stderr pipe.
 child.stderr?.resume()
 if(child.exitCode!==null)return child.exitCode===0?Promise.resolve():Promise.reject(new Error('Native database tool failed'))
 return once(child,'exit').then(([code])=>{if(code!==0)throw new Error('Native database tool failed')})
}
async function contained(file,base=PRIVATE){
 const absolute=path.resolve(ROOT,file),allowed=path.resolve(base)
 if(absolute!==allowed&&!absolute.startsWith(allowed+path.sep))throw new Error('Recovery path is outside its private workspace')
 let current=ROOT
 for(const segment of path.relative(ROOT,absolute).split(path.sep)){
  current=path.join(current,segment)
  try{if((await lstat(current)).isSymbolicLink())throw new Error('Recovery paths cannot use links or junctions')}catch(error){if(error.code!=='ENOENT')throw error}
 }
 return absolute
}
async function keyFile(file=KEY,create=false){
 const keyPath=path.resolve(ROOT,file)
 if(keyPath===PRIVATE||keyPath.startsWith(PRIVATE+path.sep))await contained(keyPath)
 if(keyPath===ARCHIVES||keyPath.startsWith(ARCHIVES+path.sep))throw new Error('Backup key must be stored separately from backup packages')
 if(create&&path.dirname(keyPath)===path.dirname(KEY)){
  await mkdir(path.dirname(keyPath),{recursive:true})
  // Windows ignores POSIX mode bits: protect the managed parent before creating a key.
  await privateFilePermissions(path.dirname(keyPath))
  try{await writeFile(keyPath,randomBytes(32).toString('hex')+'\n',{flag:'wx',mode:0o600})}catch(error){if(error.code!=='EEXIST')throw error}
 }
 const info=await lstat(keyPath);if(!info.isFile()||info.isSymbolicLink())throw new Error('Backup key must be a regular private file')
 await privateFilePermissions(keyPath)
 return loadKey(keyPath)
}
export function validateSourceDomains(domains){
 const sorted=[...domains].sort(),current=SOURCE_SPECS.map(spec=>spec.domain).sort(),seven=current.filter(domain=>domain!=='gifts'),six=seven.filter(domain=>domain!=='media'),five=six.filter(domain=>domain!=='social')
 if(![current,seven,six,five].some(set=>JSON.stringify(sorted)===JSON.stringify(set)))throw new Error('Backup database set mismatch')
 return sorted
}
async function sourceSet(runtime){
 const configured={social:false,media:false,gifts:false}
 for(const domain of ['social','media','gifts'])try{const info=await lstat(path.join(ROOT,`.tmp/${domain}-dev/server.env`));if(!info.isFile()||info.isSymbolicLink())throw new Error('Optional configuration must be a regular workspace file');configured[domain]=true}catch(error){if(error.code!=='ENOENT')throw error}
 if(configured.media&&!configured.social)throw new Error('Media backup requires its Social source')
 const sources=[];for(const spec of SOURCE_SPECS.filter(spec=>!(spec.domain in configured)||configured[spec.domain]))sources.push(await runtime.inspectSource(spec));return sources
}
async function configs(){
 const files=[]
 for(const relative of CONFIGS){const candidate=path.join(ROOT,relative);try{const info=await lstat(candidate);if(!info.isFile()||info.isSymbolicLink())throw new Error('Configuration must be a regular workspace file');const bytes=await readFile(candidate);files.push({path:relative,sha256:sha256(bytes),content:bytes.toString('base64')})}catch(error){if(error.code!=='ENOENT')throw error}}
 return {format:1,files}
}
async function readIndex(directory,key){
 const dir=await contained(directory,ARCHIVES),manifest=JSON.parse(await readFile(path.join(dir,'manifest.json'),'utf8'))
 if(manifest.format!==1||!/^[-a-z0-9]+$/.test(manifest.backupId??'')||!Number.isFinite(Date.parse(manifest.completedAt)))throw new Error('Incomplete or invalid backup manifest')
 const bytes=await openBytes(dir,manifest.index,key,aad(manifest.backupId,'index')),index=JSON.parse(bytes)
 if(index.format!==1||index.backupId!==manifest.backupId||index.completedAt!==manifest.completedAt||!Array.isArray(index.sources))throw new Error('Backup manifest authentication mismatch')
 validateSourceDomains(index.sources.map(value=>value?.source?.domain))
 if(index.sources.some(value=>value?.source?.domain==='media')!==Boolean(index.objectStorage))throw new Error('Media database and private object archive must be backed up together')
 for(const {source,snapshot}of index.sources){const spec=SOURCE_SPECS.find(value=>value.domain===source.domain);if(!spec||source.name!==spec.name||source.db!==spec.db||source.user!==spec.user||source.major!==spec.major||!/^sha256:[a-f0-9]{64}$/.test(source.imageId??'')||snapshot?.domain!==source.domain)throw new Error('Unsupported backup source identity')}
 return {dir,index,manifest}
}
export async function backup({keyPath=KEY}={}){
 const runtime=new DockerRuntime(ROOT),key=await keyFile(keyPath,true),id=new Date().toISOString().replace(/[^0-9]/g,'')+'-'+randomUUID().slice(0,8)
 const directory=await contained(path.join(ARCHIVES,id),ARCHIVES);await mkdir(ARCHIVES,{recursive:true});await mkdir(directory)
 const index={format:1,backupId:id,startedAt:new Date().toISOString(),sources:[],configuration:null}
 try{
  for(const source of await sourceSet(runtime)){
   const before=await capture(runtime,source),child=runtime.spawnDump(source),done=childDone(child)
   const [archive]=await Promise.all([seal(child.stdout,path.join(directory,source.domain+'.enc'),key,aad(id,source.domain)),done])
   const roles=await sealBytes(Buffer.from(await runtime.roles(source)),path.join(directory,source.domain+'-roles.enc'),key,aad(id,source.domain+':roles'))
   const after=await capture(runtime,source)
   if(!compareSnapshots(before,after).equal)throw new Error('Source changed during backup; retry during a stable interval')
   index.sources.push({source,archive,roles,snapshot:after})
  }
  const media=index.sources.find(value=>value.source.domain==='media')
  if(media){
   index.objectStorage=await(await objectTools()).backupObjectStore({root:ROOT,directory,backupId:id,key})
   const objects=new Map(index.objectStorage.snapshot.objects.map(item=>[item.key,item]))
   for(const ref of await runtime.query(media.source,"SELECT object_key AS key,byte_size AS bytes,sha256 FROM public.media_objects WHERE status='ready'")){
    const object=objects.get(ref.key);if(!object||object.byteSize!==ref.bytes||object.sha256!==ref.sha256)throw new Error('Verified photo metadata and private object bytes differ')
   }
   index.personPhotoReferences=await (await import('./person-photos.mjs')).validatePersonPhotoReferences(runtime,index.sources.map(v=>v.source),index.objectStorage.snapshot.objects)
  }
  index.giftReferences=await(await import('./gifts.mjs')).validateGiftReferences(runtime,index.sources.map(v=>v.source))
  index.letterReferences=await(await import('./letters.mjs')).validateLetterReferences(runtime,index.sources.map(v=>v.source))
  index.gatherReferences=await(await import('./gathers.mjs')).validateGatherReferences(runtime,index.sources.map(v=>v.source))
  index.chatPhotoReferences=await(await import('./chat-photos.mjs')).validateChatPhotoReferences(runtime,index.sources.map(v=>v.source),index.objectStorage?.snapshot.objects??[])
  index.storyControls=await(await import('./story-controls.mjs')).validateStoryControls(runtime,index.sources.map(v=>v.source))
  index.referralReferences=await(await import('./referrals.mjs')).validateReferralReferences(runtime,index.sources.map(v=>v.source))
  index.sharedAlbumReferences=await(await import('./shared-albums.mjs')).validateSharedAlbumReferences(runtime,index.sources.map(v=>v.source))
  index.worldActionReferences=await(await import('./world-actions.mjs')).validateWorldActionReferences(runtime,index.sources.map(v=>v.source))
  index.giftPhotoReferences=await(await import('./gift-photos.mjs')).validateGiftPhotoReferences(runtime,index.sources.map(v=>v.source),index.objectStorage?.snapshot.objects??[])
  index.memoryImportReferences=await(await import('./memory-imports.mjs')).validateMemoryImportReferences(runtime,index.sources.map(v=>v.source))
  index.personVoiceReferences=await(await import('./person-voices.mjs')).validatePersonVoiceReferences(runtime,index.sources.map(v=>v.source),index.objectStorage?.snapshot.objects??[])
  const configuration=Buffer.from(JSON.stringify(await configs()))
  index.configuration=await sealBytes(configuration,path.join(directory,'configuration.enc'),key,aad(id,'configuration'));configuration.fill(0)
  // The source/ref check happens after sequential dumps. Reject any drift across
  // that whole interval instead of sealing a package whose domains disagree.
  for(const item of index.sources)if(!compareSnapshots(item.snapshot,await capture(runtime,item.source)).equal)throw new Error('Source changed across backup domains; retry during a stable interval')
  if(index.objectStorage&&index.objectStorage.snapshot.digest!==(await(await objectTools()).captureObjectStore(ROOT)).digest)throw new Error('Private objects changed across backup domains')
  index.completedAt=new Date().toISOString()
  const encrypted=await sealBytes(Buffer.from(JSON.stringify(index)),path.join(directory,'index.enc'),key,aad(id,'index'))
  await writeFile(path.join(directory,'manifest.json'),JSON.stringify({format:1,backupId:id,completedAt:index.completedAt,index:encrypted},null,2),{flag:'wx',mode:0o600})
  return {backupId:id,directory,databases:index.sources.length}
 }catch(error){await writeFile(path.join(directory,'FAILED.json'),JSON.stringify({completed:false,failedAt:new Date().toISOString(),reason:'Backup did not satisfy integrity/stability checks'}));throw error}
}
export async function checkpoint(directory,{keyPath=KEY}={}){
 const runtime=new DockerRuntime(ROOT),key=await keyFile(keyPath),{dir,index}=await readIndex(directory,key),snapshots=[],replay=[],sources=[]
 for(const item of index.sources){const source=await runtime.inspectSource(SOURCE_SPECS.find(spec=>spec.domain===item.source.domain));if(source.id!==item.source.id)throw new Error('Checkpoint source incarnation differs from the backup');const before=await capture(runtime,source);replay.push(await captureSecurityReplay(runtime,source));const after=await capture(runtime,source);if(!compareSnapshots(before,after).equal)throw new Error('Source changed during security checkpoint');snapshots.push(after);sources.push(source)}
 const objects=index.objectStorage?await(await objectTools()).captureObjectStore(ROOT):undefined
 if(objects&&objects.source.id!==index.objectStorage.snapshot.source.id)throw new Error('Checkpoint object-store incarnation differs from the backup')
 for(const source of sources)if(!compareSnapshots(snapshots.find(s=>s.domain===source.domain),await capture(runtime,source)).equal)throw new Error('Source changed across security checkpoint domains')
 if(objects&&objects.digest!==(await(await objectTools()).captureObjectStore(ROOT)).digest)throw new Error('Objects changed during security checkpoint')
 const payload={format:1,backupId:index.backupId,capturedAt:new Date().toISOString(),snapshots,securityReplay:{format:1,domains:replay},...(objects?{objectStorage:objects}:{})},file='checkpoint-'+randomUUID().slice(0,8)+'.enc'
 const meta=await sealBytes(Buffer.from(JSON.stringify(payload)),path.join(dir,file),key,aad(index.backupId,'checkpoint'))
 const descriptor={format:1,backupId:index.backupId,artifact:meta}
 const pointer='checkpoint-'+randomUUID().slice(0,8)+'.json';await writeFile(path.join(dir,pointer),JSON.stringify(descriptor),{flag:'wx',mode:0o600})
 await publishHead(checkpointHead(index.backupId,payload.capturedAt,meta),key)
 return {file:path.join(dir,pointer),capturedAt:payload.capturedAt}
}
export async function restore(directory,{keyPath=KEY,checkpointPath}={}){
 const runtime=new DockerRuntime(ROOT),key=await keyFile(keyPath),{dir,index}=await readIndex(directory,key),runId=randomUUID().replaceAll('-','').slice(0,16),targets=[]
 if(!checkpointPath)throw new Error('An authenticated security checkpoint is required for this drill')
 const pointFile=await contained(checkpointPath,dir);if(path.dirname(pointFile)!==dir||(await lstat(pointFile)).isSymbolicLink())throw new Error('Checkpoint must be inside the same backup package')
 const descriptor=JSON.parse(await readFile(pointFile,'utf8'));if(descriptor.format!==1||descriptor.backupId!==index.backupId)throw new Error('Checkpoint package mismatch')
 const point=JSON.parse(await openBytes(dir,descriptor.artifact,key,aad(index.backupId,'checkpoint')))
 const captured=Date.parse(point.capturedAt),age=Date.now()-captured
 if(point.format!==1||!Number.isFinite(captured)||point.backupId!==index.backupId||age<0||age>3600000||captured<Date.parse(index.completedAt)||!Array.isArray(point.snapshots)||point.snapshots.length!==index.sources.length)throw new Error('Checkpoint is stale or does not follow the backup')
 if(JSON.stringify(point.snapshots.map(value=>value?.domain).sort())!==JSON.stringify(index.sources.map(value=>value.source.domain).sort()))throw new Error('Checkpoint database set mismatch')
 if(Boolean(index.objectStorage)!==Boolean(point.objectStorage))throw new Error('Checkpoint object-store set mismatch')
 const oldAccounts=index.sources.find(s=>s.source.domain==='identity')?.snapshot.security?.accounts??[],newAccounts=new Map((point.snapshots.find(s=>s.domain==='identity')?.security?.accounts??[]).map(a=>[a.id,a]));if(oldAccounts.some(a=>a.status==='deleted'&&newAccounts.has(a.id)&&newAccounts.get(a.id).status!=='deleted'))throw new Error('Checkpoint deletion status moved backwards')
 if(point.securityReplay){if(point.securityReplay.format!==1||!Array.isArray(point.securityReplay.domains)||JSON.stringify(point.securityReplay.domains.map(d=>d.domain).sort())!==JSON.stringify(index.sources.map(v=>v.source.domain).sort()))throw new Error('Security replay domain set mismatch');for(const d of point.securityReplay.domains)validateReplayDomain(d);for(const item of index.sources)if(item.snapshot.schemaDigest!==point.snapshots.find(s=>s.domain===item.source.domain).schemaDigest)throw new Error('Security replay schema changed since backup');const head=await readHead(index.backupId,key);if(JSON.stringify(head)!==JSON.stringify(checkpointHead(index.backupId,point.capturedAt,descriptor.artifact)))throw new Error('Checkpoint was superseded by a newer trusted checkpoint')}
 const configuration=JSON.parse(await openBytes(dir,index.configuration,key,aad(index.backupId,'configuration')))
 if(configuration.format!==1||!Array.isArray(configuration.files))throw new Error('Invalid configuration archive')
 for(const file of configuration.files)if(!CONFIGS.includes(file.path)||sha256(Buffer.from(file.content,'base64'))!==file.sha256)throw new Error('Configuration archive failed integrity checks')
 const report={format:1,backupId:index.backupId,runId,startedAt:new Date().toISOString(),completed:false,releaseReady:false,quarantined:true,configurationFilesVerified:configuration.files.length,databases:[],cleanupComplete:false}
 let stopping=false
 const stop=()=>{stopping=true}
 const requireRunning=()=>{if(stopping)throw new Error('Recovery interrupted; cleaning isolated targets')}
 process.on('SIGINT',stop);process.on('SIGTERM',stop)
 try{
  for(const item of index.sources){
   requireRunning()
   const target=await runtime.createTarget(item.source,runId);targets.push(target)
   requireRunning()
   const roles=(await openBytes(dir,item.roles,key,aad(index.backupId,item.source.domain+':roles'))).toString('utf8')
   const writer=runtime.writeArchive(target),done=childDone(writer)
   await Promise.all([openTo(dir,item.archive,key,aad(index.backupId,item.source.domain),writer.stdin),done])
   await runtime.restore(target,roles)
   requireRunning()
   const restored=await capture(runtime,target),original=compareSnapshots(item.snapshot,restored)
   if(!original.equal)throw new Error('Restored database differs from its recorded snapshot: '+item.source.domain)
   const latest=point.snapshots.find(value=>value.domain===item.source.domain)
   if(!latest)throw new Error('Checkpoint database set mismatch')
   const changes=compareSnapshots(item.snapshot,latest)
   report.databases.push({domain:item.source.domain,major:item.source.major,rawSnapshotVerified:true,tableCount:restored.tables.length,checkpointMatches:changes.equal,checkpointDifferences:changes.differences})
  }
  report.giftReferences=await(await import('./gifts.mjs')).validateGiftReferences(runtime,targets)
  report.letterReferences=await(await import('./letters.mjs')).validateLetterReferences(runtime,targets)
  report.gatherReferences=await(await import('./gathers.mjs')).validateGatherReferences(runtime,targets)
  if(index.objectStorage){requireRunning();report.objectStorage=await(await objectTools()).restoreObjectStore({root:ROOT,directory:dir,backupId:index.backupId,key,descriptor:index.objectStorage,runId,checkpointSnapshot:point.objectStorage});if(!report.objectStorage.completed||!report.objectStorage.cleanupComplete)throw new Error('Private object restoration did not complete');report.personPhotoReferences=await(await import('./person-photos.mjs')).validatePersonPhotoReferences(runtime,targets,index.objectStorage.snapshot.objects)}
  report.chatPhotoReferences=await(await import('./chat-photos.mjs')).validateChatPhotoReferences(runtime,targets,index.objectStorage?.snapshot.objects??[])
  report.storyControls=await(await import('./story-controls.mjs')).validateStoryControls(runtime,targets)
  report.referralReferences=await(await import('./referrals.mjs')).validateReferralReferences(runtime,targets)
  report.sharedAlbumReferences=await(await import('./shared-albums.mjs')).validateSharedAlbumReferences(runtime,targets)
  report.worldActionReferences=await(await import('./world-actions.mjs')).validateWorldActionReferences(runtime,targets)
  report.giftPhotoReferences=await(await import('./gift-photos.mjs')).validateGiftPhotoReferences(runtime,targets,index.objectStorage?.snapshot.objects??[])
  report.memoryImportReferences=await(await import('./memory-imports.mjs')).validateMemoryImportReferences(runtime,targets)
  report.personVoiceReferences=await(await import('./person-voices.mjs')).validatePersonVoiceReferences(runtime,targets,index.objectStorage?.snapshot.objects??[])
  if(point.securityReplay){
   const identity=point.snapshots.find(s=>s.domain==='identity'),oldIdentity=index.sources.find(s=>s.source.domain==='identity')?.snapshot
   const latestAccounts=new Map((identity.security?.accounts??[]).map(a=>[a.id,a])),deletedAccounts=[...new Set([...(oldIdentity?.security?.accounts??[]).filter(a=>!latestAccounts.has(a.id)).map(a=>a.id),...[...latestAccounts.values()].filter(a=>a.status==='deleted').map(a=>a.id)])]
   report.securityReplay={applied:true,releaseReady:false,domains:[]}
   for(const target of targets){requireRunning();report.securityReplay.domains.push(await replaySecurity(runtime,target,point.securityReplay.domains.find(d=>d.domain===target.domain),{deletedAccounts,capturedAt:point.capturedAt}))}
  }else report.securityReplay={applied:false,reason:'legacy_digest_only_checkpoint',releaseReady:false}
  for(const target of targets){requireRunning();report.databases.find(d=>d.domain===target.domain).safety=await quarantine(runtime,target)}
  requireRunning();report.completed=true
 }finally{
  let cleanupError
  for(const target of targets.reverse())try{await runtime.remove(target,runId)}catch(error){cleanupError=error}
  // Also inspect the run label: createTarget may have failed before returning a descriptor.
  try{await runtime.cleanupRun(runId)}catch(error){cleanupError=error}
  if(index.objectStorage)try{await(await objectTools()).cleanupObjectRun(ROOT,runId)}catch(error){cleanupError=error}
  report.cleanupComplete=!cleanupError;report.finishedAt=new Date().toISOString()
  process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop)
  if(stopping)report.completed=false
  if(cleanupError)report.completed=false
  await writeFile(path.join(dir,'restore-'+runId+'.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600})
  if(cleanupError)throw new Error('Owned recovery target cleanup failed')
 }
 return report
}
export async function drill({keyPath=KEY}={}){
 const saved=await backup({keyPath}),point=await checkpoint(saved.directory,{keyPath})
 const restored=await restore(saved.directory,{keyPath,checkpointPath:point.file})
 const runtime=new DockerRuntime(ROOT),key=await keyFile(keyPath),{index,dir}=await readIndex(saved.directory,key),sourceChecks=[]
 for(const item of index.sources){
  const source=await runtime.inspectSource(SOURCE_SPECS.find(spec=>spec.domain===item.source.domain))
  const unchanged=source.id===item.source.id&&compareSnapshots(item.snapshot,await capture(runtime,source)).equal
  sourceChecks.push({domain:item.source.domain,unchanged})
 }
 if(index.objectStorage){const current=await(await objectTools()).captureObjectStore(ROOT);sourceChecks.push({domain:'media_objects',unchanged:current.source.id===index.objectStorage.snapshot.source.id&&current.digest===index.objectStorage.snapshot.digest})}
 const sourceUnchanged=sourceChecks.every(check=>check.unchanged)
 const report={format:1,backupId:saved.backupId,runId:restored.runId,completed:restored.completed&&restored.cleanupComplete&&sourceUnchanged,
  releaseReady:false,quarantined:true,cleanupComplete:restored.cleanupComplete,sourceUnchanged,sourceChecks,
  databaseCount:restored.databases.length,...(restored.objectStorage?{objectStorage:restored.objectStorage}:{}),restoreReport:'restore-'+restored.runId+'.json',finishedAt:new Date().toISOString()}
 await writeFile(path.join(dir,'drill-'+restored.runId+'.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600})
 if(!report.completed)throw new Error('Recovery drill did not satisfy restore, cleanup or source stability checks')
 return {...report,directory:dir}
}
async function cli(){
 const [command,...args]=process.argv.slice(2),options={}
 for(let i=0;i<args.length;i+=2){if(!['--backup','--checkpoint','--key-file','--run'].includes(args[i])||!args[i+1])throw new Error('Invalid recovery option');options[args[i]]=args[i+1]}
 const keyPath=options['--key-file']??KEY
 if(command==='cleanup'){
  const databases=await new DockerRuntime(ROOT).cleanupRun(options['--run']),objects=await(await objectTools()).cleanupObjectRun(ROOT,options['--run'])
  console.log(JSON.stringify({databases,objects}))
 }
 else if(command==='backup')console.log(JSON.stringify(await backup({keyPath})))
 else if(command==='checkpoint')console.log(JSON.stringify(await checkpoint(options['--backup'],{keyPath})))
 else if(command==='restore'){
  const result=await restore(options['--backup'],{keyPath,checkpointPath:options['--checkpoint']});console.log(JSON.stringify({completed:result.completed,releaseReady:false,quarantined:true,databases:result.databases.length,cleanupComplete:result.cleanupComplete}))
 }else if(command==='drill'){
  console.log(JSON.stringify(await drill({keyPath})))
 }else throw new Error('Use backup, checkpoint, restore, drill or cleanup')
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))cli().catch(error=>{console.error('Recovery stopped: '+(error.message??'validation failed'));process.exitCode=1})
