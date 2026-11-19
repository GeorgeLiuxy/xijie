import assert from 'node:assert/strict'
import {randomBytes,randomUUID,createHash,createHmac} from 'node:crypto'
import {EventEmitter} from 'node:events'
import {lstat,mkdir,readFile,realpath,rm,writeFile,unlink} from 'node:fs/promises'
import path from 'node:path'
import {Writable} from 'node:stream'
import {test} from 'node:test'
import {ROOT,restore} from './recovery.mjs'
import {sealBytes} from './crypto.mjs'
import {DockerRuntime,SOURCE_SPECS} from './runtime.mjs'
// These fixtures intentionally exercise legacy PostgreSQL-only packages.
// Seven-database photo packages also require an authenticated object archive.
const LEGACY_SPECS=SOURCE_SPECS.filter(spec=>spec.domain!=='media'&&spec.domain!=='gifts')

const privateRoot=path.join(ROOT,'.tmp','recovery-dev')
const archives=path.join(privateRoot,'archives')

async function assertNoLinks(absolute){
 let current=ROOT
 for(const segment of path.relative(ROOT,absolute).split(path.sep)){
  current=path.join(current,segment)
  try{assert.equal((await lstat(current)).isSymbolicLink(),false,'test path cannot contain links')}
  catch(error){if(error.code!=='ENOENT')throw error}
 }
}
async function removeOwned(directory,base,prefix){
 const resolved=await realpath(directory),parent=await realpath(base)
 assert.equal(path.dirname(resolved),parent)
 assert.ok(path.basename(resolved).startsWith(prefix))
 await rm(resolved,{recursive:true,force:true})
}

test('restore preflight rejects malformed, stale, future and mismatched checkpoint metadata without starting a target',async t=>{
 const suffix=randomUUID().replaceAll('-',''),backupId='cli-test-'+suffix
 const directory=path.join(archives,backupId),keys=path.join(privateRoot,'cli-test-key-'+suffix),keyPath=path.join(keys,'test.key')
 await assertNoLinks(directory);await assertNoLinks(keys)
 await mkdir(directory,{recursive:true});await mkdir(keys,{recursive:true})
 const key=randomBytes(32)
 await writeFile(keyPath,key.toString('hex')+'\n',{flag:'wx',mode:0o600})
 const completedAt=new Date(Date.now()-120000).toISOString()
 const snapshots=LEGACY_SPECS.map(spec=>({domain:spec.domain,capturedAt:completedAt,tables:[],migrations:[],schemaDigest:'test',queueCounts:[],security:{accounts:[],resources:[]}}))
 const aad=purpose=>'xijie-backup:v1:'+backupId+':'+purpose
 const configuration=await sealBytes(Buffer.from(JSON.stringify({format:1,files:[]})),path.join(directory,'configuration.enc'),key,aad('configuration'))
 const index={format:1,backupId,completedAt,configuration,sources:LEGACY_SPECS.map((spec,i)=>({
  source:{...spec,id:String(i+1).repeat(64),image:'postgres:'+spec.major+'-alpine',imageId:'sha256:'+'0'.repeat(64)},
  snapshot:snapshots[i],archive:{file:spec.domain+'.enc'},roles:{file:spec.domain+'-roles.enc'},
 }))}
 const encryptedIndex=await sealBytes(Buffer.from(JSON.stringify(index)),path.join(directory,'index.enc'),key,aad('index'))
 await writeFile(path.join(directory,'manifest.json'),JSON.stringify({format:1,backupId,completedAt,index:encryptedIndex}),{flag:'wx',mode:0o600})
 let targetStarts=0
 const actualCreate=DockerRuntime.prototype.createTarget
 DockerRuntime.prototype.createTarget=async()=>{targetStarts++;throw new Error('Invalid metadata reached target creation')}
 try{
  const valid={format:1,backupId,capturedAt:new Date(Date.now()-30000).toISOString(),snapshots}
  await t.test('photo database without encrypted object bytes is rejected before target creation',async()=>{
   const spec=SOURCE_SPECS.find(source=>source.domain==='media'),photoIndex={...index,sources:[...index.sources,{source:{...spec,id:'7'.repeat(64),image:'postgres:16-alpine',imageId:'sha256:'+'0'.repeat(64)},snapshot:{domain:'media'},archive:{file:'media.enc'},roles:{file:'media-roles.enc'}}]}
   const photoArtifact=await sealBytes(Buffer.from(JSON.stringify(photoIndex)),path.join(directory,'photo-index.enc'),key,aad('index'))
   const manifestPath=path.join(directory,'manifest.json'),original=await readFile(manifestPath)
   try{await writeFile(manifestPath,JSON.stringify({format:1,backupId,completedAt,index:photoArtifact}));await assert.rejects(restore(directory,{keyPath}),/database and private object archive must be backed up together/);assert.equal(targetStarts,0)}finally{await writeFile(manifestPath,original)}
  })
  const cases=[
   ['invalid-time',{...valid,capturedAt:'not-a-date'}],
   ['expired',{...valid,capturedAt:new Date(Date.now()-7200000).toISOString()}],
   ['future',{...valid,capturedAt:new Date(Date.now()+300000).toISOString()}],
   ['pre-backup',{...valid,capturedAt:new Date(Date.now()-240000).toISOString()}],
   ['wrong-format',{...valid,format:99}],
   ['wrong-payload-package',{...valid,backupId:'another-backup'}],
   ['duplicate-domain',{...valid,snapshots:snapshots.map(()=>snapshots[0])}],
  ]
  for(const [name,payload]of cases)await t.test(name,async()=>{
   const artifact=await sealBytes(Buffer.from(JSON.stringify(payload)),path.join(directory,'checkpoint-'+name+'.enc'),key,aad('checkpoint'))
   const pointer=path.join(directory,'checkpoint-'+name+'.json')
   await writeFile(pointer,JSON.stringify({format:1,backupId,artifact}),{flag:'wx',mode:0o600})
   await assert.rejects(restore(directory,{keyPath,checkpointPath:pointer}),name==='duplicate-domain'?/database set mismatch/:/stale or does not follow/)
   assert.equal(targetStarts,0,'preflight failure must not create any restore target')
  })
  await t.test('modern replay rejects a missing trusted head, superseded checkpoint, forged head and schema drift before creating a target',async()=>{
   const modern={...valid,securityReplay:{format:1,domains:LEGACY_SPECS.map(s=>({domain:s.domain,schemaHash:createHash('sha256').update(JSON.stringify({domain:s.domain,tables:[]})).digest('hex'),tables:[],revocations:[]}))}},artifact=await sealBytes(Buffer.from(JSON.stringify(modern)),path.join(directory,'checkpoint-modern.enc'),key,aad('checkpoint')),pointer=path.join(directory,'checkpoint-modern.json');await writeFile(pointer,JSON.stringify({format:1,backupId,artifact}),{flag:'wx',mode:0o600})
   await assert.rejects(restore(directory,{keyPath,checkpointPath:pointer}),/latest checkpoint head is unavailable/)
   const heads=path.join(privateRoot,'checkpoints'),file=path.join(heads,backupId+'.json');await assertNoLinks(file);await mkdir(heads,{recursive:true});const head={format:1,backupId,capturedAt:modern.capturedAt,cipherSha256:'0'.repeat(64),plainSha256:'0'.repeat(64)},signed={...head,signature:createHmac('sha256',key).update(JSON.stringify(head)).digest('hex')};await writeFile(file,JSON.stringify(signed),{flag:'wx',mode:0o600})
   try{await assert.rejects(restore(directory,{keyPath,checkpointPath:pointer}),/superseded/);await writeFile(file,JSON.stringify({...signed,signature:'0'.repeat(64)}));await assert.rejects(restore(directory,{keyPath,checkpointPath:pointer}),/head authentication/)
    const drift={...modern,snapshots:modern.snapshots.map((s,i)=>i? s:{...s,schemaDigest:'changed'})},driftArtifact=await sealBytes(Buffer.from(JSON.stringify(drift)),path.join(directory,'checkpoint-drift.enc'),key,aad('checkpoint'));await writeFile(pointer,JSON.stringify({format:1,backupId,artifact:driftArtifact}));await assert.rejects(restore(directory,{keyPath,checkpointPath:pointer}),/schema changed/)
   }finally{await unlink(file)}
   assert.equal(targetStarts,0)
  })
  await t.test('wrong-descriptor-package',async()=>{
   const pointer=path.join(directory,'wrong-descriptor.json')
   await writeFile(pointer,JSON.stringify({format:1,backupId:'another-backup',artifact:{}}),{flag:'wx',mode:0o600})
   await assert.rejects(restore(directory,{keyPath,checkpointPath:pointer}),/package mismatch/)
   assert.equal(targetStarts,0)
  })
  await t.test('missing-checkpoint',async()=>{
   await assert.rejects(restore(directory,{keyPath}),/checkpoint is required/)
   assert.equal(targetStarts,0)
  })
  await t.test('tampered-index',async()=>{
   const file=path.join(directory,'index.enc'),bytes=await readFile(file);bytes[0]^=1;await writeFile(file,bytes)
   await assert.rejects(restore(directory,{keyPath,checkpointPath:path.join(directory,'wrong-descriptor.json')}),/checksum/)
   assert.equal(targetStarts,0)
  })
 }finally{
  DockerRuntime.prototype.createTarget=actualCreate
  await removeOwned(directory,archives,'cli-test-')
  await removeOwned(keys,privateRoot,'cli-test-key-')
 }
})

test('restore never executes an unauthenticated archive and records cleanup failures without touching source databases',async t=>{
 const suffix=randomUUID().replaceAll('-',''),backupId='cli-test-'+suffix
 const directory=path.join(archives,backupId),keys=path.join(privateRoot,'cli-test-key-'+suffix),keyPath=path.join(keys,'test.key')
 await assertNoLinks(directory);await assertNoLinks(keys)
 await mkdir(directory,{recursive:true});await mkdir(keys,{recursive:true})
 const key=randomBytes(32),completedAt=new Date(Date.now()-120000).toISOString(),aad=purpose=>'xijie-backup:v1:'+backupId+':'+purpose
 await writeFile(keyPath,key.toString('hex')+'\n',{flag:'wx',mode:0o600})
 const snapshots=LEGACY_SPECS.map(spec=>({domain:spec.domain,capturedAt:completedAt,tables:[],migrations:[],schemaDigest:'test',queueCounts:[],security:{accounts:[],resources:[]}}))
 const configuration=await sealBytes(Buffer.from(JSON.stringify({format:1,files:[]})),path.join(directory,'configuration.enc'),key,aad('configuration'))
 const archive=await sealBytes(randomBytes(8192),path.join(directory,'identity.enc'),key,aad('identity'))
 // The ciphertext checksum remains valid. Only GCM authentication must reject it.
 archive.tag=(archive.tag[0]==='0'?'1':'0')+archive.tag.slice(1)
 const roles=await sealBytes(Buffer.from('-- fixture roles\n'),path.join(directory,'identity-roles.enc'),key,aad('identity:roles'))
 const index={format:1,backupId,completedAt,configuration,sources:LEGACY_SPECS.map((spec,i)=>({
  source:{...spec,id:String(i+1).repeat(64),image:'postgres:'+spec.major+'-alpine',imageId:'sha256:'+'0'.repeat(64)},snapshot:snapshots[i],archive,roles,
 }))}
 const encryptedIndex=await sealBytes(Buffer.from(JSON.stringify(index)),path.join(directory,'index.enc'),key,aad('index'))
 await writeFile(path.join(directory,'manifest.json'),JSON.stringify({format:1,backupId,completedAt,index:encryptedIndex}),{flag:'wx',mode:0o600})
 const point=await sealBytes(Buffer.from(JSON.stringify({format:1,backupId,capturedAt:new Date(Date.now()-30000).toISOString(),snapshots})),path.join(directory,'checkpoint.enc'),key,aad('checkpoint'))
 const checkpointPath=path.join(directory,'checkpoint.json')
 await writeFile(checkpointPath,JSON.stringify({format:1,backupId,artifact:point}),{flag:'wx',mode:0o600})
 const methods=['createTarget','writeArchive','restore','remove','cleanupRun','sql','json','query']
 const originals=Object.fromEntries(methods.map(name=>[name,DockerRuntime.prototype[name]]))
 let runId,target,starts,staged,executed,removed,swept,sourceCalls
 const reset=()=>{
  starts=staged=executed=removed=swept=sourceCalls=0
  DockerRuntime.prototype.createTarget=async(source,currentRun)=>{starts++;runId=currentRun;target={...source,id:'a'.repeat(64),kind:'target',runId};return target}
  DockerRuntime.prototype.writeArchive=()=>{
   staged++
   const child=new EventEmitter();child.exitCode=null
   child.stdin=new Writable({write(_chunk,_encoding,next){next()}})
   const finish=code=>{if(child.exitCode!==null)return;child.exitCode=code;child.emit('exit',code)}
   child.stdin.on('finish',()=>finish(0));child.stdin.on('error',()=>finish(1))
   return child
  }
  DockerRuntime.prototype.restore=async()=>{executed++;throw new Error('Unauthenticated bytes reached the SQL executor')}
  DockerRuntime.prototype.remove=async(value,currentRun)=>{assert.equal(value,target);assert.equal(currentRun,runId);removed++}
  DockerRuntime.prototype.cleanupRun=async currentRun=>{assert.equal(currentRun,runId);swept++;return {removed:0}}
  for(const name of ['sql','json','query'])DockerRuntime.prototype[name]=async()=>{sourceCalls++;throw new Error('Unexpected database access in isolated failure test')}
 }
 const report=async()=>JSON.parse(await readFile(path.join(directory,'restore-'+runId+'.json'),'utf8'))
 try{
  await t.test('invalid authentication tag is staged but never executed and the target is cleaned',async()=>{
   reset()
   await assert.rejects(restore(directory,{keyPath,checkpointPath}),/authenticate|Native database tool failed/)
   assert.equal(starts,1);assert.equal(staged,1);assert.equal(executed,0);assert.equal(removed,1);assert.equal(swept,1);assert.equal(sourceCalls,0)
   const value=await report();assert.equal(value.completed,false);assert.equal(value.cleanupComplete,true);assert.equal(value.releaseReady,false)
  })
  await t.test('target creation failure still discovers partially created targets',async()=>{
   reset()
   DockerRuntime.prototype.createTarget=async(_source,currentRun)=>{starts++;runId=currentRun;throw new Error('Fixture target creation failure')}
   await assert.rejects(restore(directory,{keyPath,checkpointPath}),/Fixture target creation failure/)
   assert.equal(starts,1);assert.equal(staged,0);assert.equal(executed,0);assert.equal(removed,0);assert.equal(swept,1);assert.equal(sourceCalls,0)
   const value=await report();assert.equal(value.completed,false);assert.equal(value.cleanupComplete,true)
  })
  await t.test('cleanup failure cannot be reported as completed or cleaned',async()=>{
   reset()
   DockerRuntime.prototype.remove=async()=>{removed++;throw new Error('Fixture removal failure')}
   DockerRuntime.prototype.cleanupRun=async()=>{swept++;throw new Error('Fixture orphan cleanup failure')}
   await assert.rejects(restore(directory,{keyPath,checkpointPath}),/Owned recovery target cleanup failed/)
   assert.equal(executed,0);assert.equal(removed,1);assert.equal(swept,1);assert.equal(sourceCalls,0)
   const value=await report();assert.equal(value.completed,false);assert.equal(value.cleanupComplete,false);assert.equal(value.releaseReady,false)
  })
 }finally{
  for(const name of methods)DockerRuntime.prototype[name]=originals[name]
  await removeOwned(directory,archives,'cli-test-')
  await removeOwned(keys,privateRoot,'cli-test-key-')
 }
})
