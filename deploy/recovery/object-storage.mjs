import {spawn} from 'node:child_process'
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto'
import {lstat,readFile,realpath} from 'node:fs/promises'
import path from 'node:path'
import {Readable} from 'node:stream'
import {parseEnv} from 'node:util'
import {S3Client,ListObjectsV2Command,GetObjectCommand,PutObjectCommand,CreateBucketCommand,DeleteObjectCommand} from '@aws-sdk/client-s3'
import {S3RequestPresigner} from '@aws-sdk/s3-request-presigner'
import {sealBytes,openBytes,sha256} from './crypto.mjs'

export const OBJECT_LIMITS=Object.freeze({count:1000,objectBytes:11*1024*1024,totalBytes:256*1024*1024})
const STORE_IMAGE='ghcr.io/chrislusf/seaweedfs:4.53',HELPER_IMAGE='node:22-alpine',SOURCE_NAME='xijie-media-dev-object-store-1',LABEL='xijie.recovery.objects.run'
const RUN=/^[a-z0-9][a-z0-9-]{7,63}$/,ID=/^[a-f0-9]{64}$/,IMAGE=/^sha256:[a-f0-9]{64}$/,BUCKET=/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/
const sourceFields=['name','id','imageId','helperImageId','bucket']
class ObjectStorageError extends Error{}
const fail=message=>new ObjectStorageError(message)
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
const pause=ms=>new Promise(r=>setTimeout(r,ms))

export function validateObjectKey(key){
 if(typeof key!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/.test(key)||key.split('/').some(v=>!v||v==='.'||v==='..'))throw fail('Invalid object manifest key')
 return key
}
const contentType=value=>{if(typeof value!=='string'||!value.length||value.length>128||!/^[\x20-\x7e]+$/.test(value))throw fail('Invalid object content type');return value}
function sourceMetadata(source){
 if(!source||Object.keys(source).some(k=>!sourceFields.includes(k))||source.name!==SOURCE_NAME||!ID.test(source.id??'')||!IMAGE.test(source.imageId??'')||!IMAGE.test(source.helperImageId??'')||!BUCKET.test(source.bucket??''))throw fail('Invalid object source identity')
 return Object.fromEntries(sourceFields.map(k=>[k,source[k]]))
}
function entriesMetadata(entries){
 if(!Array.isArray(entries)||entries.length>OBJECT_LIMITS.count)throw fail('Object manifest exceeds supported count')
 const result=entries.map(v=>{
  if(!v||!Number.isSafeInteger(v.byteSize)||v.byteSize<0||v.byteSize>OBJECT_LIMITS.objectBytes||!/^[a-f0-9]{64}$/.test(v.sha256??''))throw fail('Invalid object manifest entry')
  return {key:validateObjectKey(v.key),byteSize:v.byteSize,sha256:v.sha256,contentType:contentType(v.contentType)}
 }).sort((a,b)=>a.key.localeCompare(b.key,'en'))
 if(new Set(result.map(v=>v.key)).size!==result.length||result.reduce((n,v)=>n+v.byteSize,0)>OBJECT_LIMITS.totalBytes)throw fail('Invalid or oversized object manifest')
 return result
}
export function objectSnapshot(source,objects){
 const normalized={source:sourceMetadata(source),objects:entriesMetadata(objects)}
 return {...normalized,digest:sha256(JSON.stringify(normalized))}
}
export function validateObjectSnapshot(value){
 const current=objectSnapshot(value?.source,value?.objects)
 if(value?.digest!==current.digest||!same(value.objects,current.objects))throw fail('Object manifest authentication mismatch')
 return current
}
async function privateEnv(root){
 const base=await realpath(root);let current=base
 for(const segment of ['.tmp','media-dev','server.env']){current=path.join(current,segment);const info=await lstat(current);if(info.isSymbolicLink()||(segment==='server.env'?!info.isFile():!info.isDirectory())||await realpath(current)!==current)throw fail('Invalid Media configuration path')}
 const env=parseEnv(await readFile(current,'utf8')),url=new URL(env.MEDIA_S3_ENDPOINT??'https://disabled.invalid')
 if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.port!=='8333'||url.pathname!=='/'||url.username||url.password||url.search||url.hash||!BUCKET.test(env.MEDIA_S3_BUCKET??'')||!/^[a-z0-9-]{1,64}$/.test(env.MEDIA_S3_REGION??'us-east-1')||!env.MEDIA_S3_ACCESS_KEY||env.MEDIA_S3_ACCESS_KEY.length>256||!env.MEDIA_S3_SECRET_KEY||env.MEDIA_S3_SECRET_KEY.length>512)throw fail('Invalid private object-store configuration')
 return {endpoint:url.origin,bucket:env.MEDIA_S3_BUCKET,region:env.MEDIA_S3_REGION??'us-east-1',credentials:{accessKeyId:env.MEDIA_S3_ACCESS_KEY,secretAccessKey:env.MEDIA_S3_SECRET_KEY}}
}
async function docker(root,args,input,{env=process.env,limit=32*1024*1024}={}){
 return await new Promise((resolve,reject)=>{
  const child=spawn('docker',args,{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']}),chunks=[];let bytes=0,oversized=false
  child.stderr.resume();child.stdin.on('error',()=>{})
  child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>limit){oversized=true;child.kill()}else chunks.push(chunk)})
  child.once('error',()=>reject(fail('Object-store Docker operation could not start')))
  child.once('close',code=>code!==0||oversized?reject(fail('Object-store Docker operation failed')):resolve(Buffer.concat(chunks)))
  child.stdin.end(input)
 })
}
async function inspect(root,id){
 const format='{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Config.Image}},"imageId":{{json .Image}},"labels":{{json .Config.Labels}},"running":{{json .State.Running}},"networkMode":{{json .HostConfig.NetworkMode}},"readOnly":{{json .HostConfig.ReadonlyRootfs}},"ports":{{json .HostConfig.PortBindings}},"tmpfs":{{json (index .HostConfig "Tmpfs")}},"mounts":{{json .Mounts}}}'
 let value;try{value=JSON.parse((await docker(root,['inspect','--format',format,id],undefined,{limit:1024*1024})).toString())}catch{throw fail('Object-store container inspection failed')}
 if(!ID.test(value.id??'')||!IMAGE.test(value.imageId??''))throw fail('Invalid object-store container identity')
 return {...value,name:value.name?.replace(/^\//,'')}
}
async function imageInfo(root,id,role){
 if(!IMAGE.test(id??''))throw fail('Invalid isolated object image identity')
 let value;try{const raw=JSON.parse((await docker(root,['image','inspect',id],undefined,{limit:1024*1024})).toString())[0];value={id:raw.Id,entrypoint:raw.Config?.Entrypoint,cmd:raw.Config?.Cmd,labels:raw.Config?.Labels,env:raw.Config?.Env}}catch{throw fail('Object-store image is not available locally')}
 if(value.id!==id||role==='store'&&(value.labels?.['org.opencontainers.image.version']!=='4.53'||value.labels?.['org.opencontainers.image.source']!=='https://github.com/seaweedfs/seaweedfs'||!same(value.entrypoint,['/entrypoint.sh']))||role==='io'&&(!value.env?.some(v=>/^NODE_VERSION=22\./.test(v))||!same(value.entrypoint,['docker-entrypoint.sh'])||!same(value.cmd,['node'])))throw fail('Unexpected isolated object-store image')
}
async function localImage(root,name){
 const id=(await docker(root,['image','inspect','--format','{{.Id}}',name],undefined,{limit:1024})).toString().trim();if(!IMAGE.test(id))throw fail('Required object-store helper image is unavailable');return id
}
async function source(root,config){
 const value=await inspect(root,SOURCE_NAME),published=Object.entries(value.ports??{}).filter(([,bindings])=>Array.isArray(bindings)&&bindings.length)
 if(!value.running||value.name!==SOURCE_NAME||value.image!==STORE_IMAGE||value.labels?.['com.docker.compose.project']!=='xijie-media-dev'||value.labels?.['com.docker.compose.service']!=='object-store'||String(value.labels?.['com.docker.compose.oneoff']).toLowerCase()==='true'||published.length!==1||published[0][0]!=='8333/tcp'||published[0][1].some(p=>p.HostPort!=='8333'||!['127.0.0.1','::1'].includes(p.HostIp)))throw fail('Object-store source differs from its Compose allowlist')
 await imageInfo(root,value.imageId,'store');const helperImageId=await localImage(root,HELPER_IMAGE);await imageInfo(root,helperImageId,'io')
 return {name:value.name,id:value.id,imageId:value.imageId,helperImageId,bucket:config.bucket}
}
function client(config,extra={}){return new S3Client({...config,forcePathStyle:true,maxAttempts:1,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',...extra})}
async function bytesFrom(body){
 if(body===undefined||body===null)return Buffer.alloc(0)
 if(typeof body==='string'||body instanceof Uint8Array){const bytes=Buffer.from(body);if(bytes.length>OBJECT_LIMITS.objectBytes)throw fail('Object exceeds supported bytes');return bytes}
 const chunks=[];let total=0
 try{for await(const raw of body){const chunk=Buffer.from(raw);total+=chunk.length;if(total>OBJECT_LIMITS.objectBytes)throw fail('Object exceeds supported bytes');chunks.push(chunk)}}catch{body.destroy?.();throw fail('Object stream could not be verified')}
 return Buffer.concat(chunks)
}
async function list(client,bucket){
 const entries=[];let cursor;const seen=new Set()
 for(let page=0;page<100;page++){
  const response=await client.send(new ListObjectsV2Command({Bucket:bucket,MaxKeys:1000,...(cursor?{ContinuationToken:cursor}:{})}),{abortSignal:AbortSignal.timeout(20000)})
  for(const row of response.Contents??[]){validateObjectKey(row.Key);if(!Number.isSafeInteger(row.Size)||row.Size<0||row.Size>OBJECT_LIMITS.objectBytes)throw fail('Unsupported object source size');entries.push({key:row.Key,size:row.Size});if(entries.length>OBJECT_LIMITS.count)throw fail('Object source exceeds supported count')}
  if(entries.reduce((n,v)=>n+v.size,0)>OBJECT_LIMITS.totalBytes)throw fail('Object source exceeds supported total bytes')
  if(!response.IsTruncated){if(new Set(entries.map(v=>v.key)).size!==entries.length)throw fail('Duplicate object source entry');return entries.sort((a,b)=>a.key.localeCompare(b.key,'en'))}
  cursor=response.NextContinuationToken;if(typeof cursor!=='string'||!cursor||seen.has(cursor))throw fail('Object source pagination is invalid');seen.add(cursor)
 }
 throw fail('Object source pagination exceeds supported bound')
}
async function readObject(s3,bucket,key){
 const response=await s3.send(new GetObjectCommand({Bucket:bucket,Key:validateObjectKey(key)}),{abortSignal:AbortSignal.timeout(20000)})
 if(!Number.isSafeInteger(response.ContentLength)||response.ContentLength<0||response.ContentLength>OBJECT_LIMITS.objectBytes){response.Body?.destroy?.();throw fail('Object source length is unsupported')}
 const bytes=await bytesFrom(response.Body);if(bytes.length!==response.ContentLength)throw fail('Object source length mismatch')
 return {bytes,entry:{key,byteSize:bytes.length,sha256:sha256(bytes),contentType:contentType(response.ContentType??'application/octet-stream')}}
}
async function manifest(s3,bucket){
 const result=[]
 for(const listed of await list(s3,bucket)){const {entry}=await readObject(s3,bucket,listed.key);if(entry.byteSize!==listed.size)throw fail('Object changed during capture');result.push(entry)}
 return entriesMetadata(result)
}
export async function captureObjectStore(root){
 let s3
 try{const config=await privateEnv(root),identity=await source(root,config);s3=client(config);return objectSnapshot(identity,await manifest(s3,config.bucket))}catch(error){throw error instanceof ObjectStorageError?error:fail('Object-store capture failed')}finally{s3?.destroy()}
}
function backupArgs(backupId,key){if(typeof backupId!=='string'||!/^[-a-z0-9]{8,100}$/.test(backupId)||!Buffer.isBuffer(key)||key.length!==32)throw fail('Invalid object backup identity or encryption key')}
async function artifactDirectory(directory){const actual=await realpath(directory),stat=await lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink()||path.resolve(directory)!==actual)throw fail('Object backup directory must be a regular directory');return actual}
export async function backupObjectStore({root,directory,backupId,key}){
 backupArgs(backupId,key);const dir=await artifactDirectory(directory),snapshot=await captureObjectStore(root),config=await privateEnv(root),objects=[];const s3=client(config)
 try{
  for(const [index,expected]of snapshot.objects.entries()){
   const {entry,bytes}=await readObject(s3,config.bucket,expected.key);if(!same(entry,expected))throw fail('Object changed during backup')
   const artifact=await sealBytes(bytes,path.join(dir,'object-'+String(index).padStart(4,'0')+'.enc'),key,`${backupId}:media-object:${expected.key}`);objects.push({...entry,artifact})
  }
  if((await captureObjectStore(root)).digest!==snapshot.digest)throw fail('Object source changed during backup')
  return {format:1,snapshot,objects}
 }catch{throw fail('Object-store backup failed')}finally{s3.destroy()}
}

class NativeSha256{constructor(secret){this.hash=secret?createHmac('sha256',secret):createHash('sha256')}update(bytes){this.hash.update(bytes)}async digest(){return this.hash.digest()}}
const IO_SCRIPT=String.raw`let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',v=>{input+=v;if(input.length>17000000)process.exit(2)});process.stdin.on('end',async()=>{try{const x=JSON.parse(input),u=new URL(x.url);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.port!=='8333'||!['GET','HEAD','PUT','DELETE'].includes(x.method))throw Error();const r=await fetch(u,{method:x.method,headers:x.headers,body:x.body?Buffer.from(x.body,'base64'):undefined,redirect:'error',signal:AbortSignal.timeout(15000)});const chunks=[];let size=0;if(r.body)for await(const v of r.body){size+=v.length;if(size>11534336)throw Error();chunks.push(v)}process.stdout.write(JSON.stringify({status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.concat(chunks).toString('base64')}))}catch{process.stdout.write(JSON.stringify({failed:true}));process.exitCode=1}})`
function isolatedShape(actual,runId){
 if(!RUN.test(runId??'')||actual.labels?.[LABEL]!==runId||!['store','io'].includes(actual.labels?.['xijie.recovery.objects.role'])||actual.imageId!==actual.labels?.['xijie.recovery.objects.image']||!actual.readOnly||Object.keys(actual.ports??{}).length||(actual.mounts??[]).some(v=>v.Type!=='tmpfs')||!new RegExp('^xijie-objects-'+runId+'-'+actual.labels['xijie.recovery.objects.role']+'-[a-f0-9]{8}$').test(actual.name??''))throw fail('Object restore target ownership or isolation changed')
 const role=actual.labels['xijie.recovery.objects.role']
 if(role==='store'&&actual.networkMode!=='none'||role==='io'&&(!ID.test(actual.labels?.['xijie.recovery.objects.target']??'')||actual.networkMode!=='container:'+actual.labels['xijie.recovery.objects.target']))throw fail('Object restore target network isolation changed')
 if(!actual.tmpfs?.['/tmp']||role==='store'&&!actual.tmpfs?.['/data'])throw fail('Object restore target scratch isolation changed')
 return role
}
async function assertTarget(root,id,runId){const value=await inspect(root,id),role=isolatedShape(value,runId);await imageInfo(root,value.imageId,role);return value}
export async function cleanupObjectRun(root,runId){
 if(!RUN.test(runId??''))throw fail('Invalid object cleanup run')
 const output=(await docker(root,['ps','-aq','--no-trunc','--filter','label='+LABEL+'='+runId],undefined,{limit:1024*1024})).toString().trim(),ids=output?output.split(/\r?\n/):[]
 if(ids.some(id=>!ID.test(id)))throw fail('Invalid object cleanup inventory')
 const targets=[];for(const id of ids)targets.push(await assertTarget(root,id,runId))
 const stores=new Set(targets.filter(v=>v.labels['xijie.recovery.objects.role']==='store').map(v=>v.id))
 for(const target of targets)if(target.labels['xijie.recovery.objects.role']==='io'&&!stores.has(target.labels['xijie.recovery.objects.target']))throw fail('Object restore helper has no verified isolated owner')
 targets.sort((a,b)=>a.labels['xijie.recovery.objects.role']==='io'?-1:b.labels['xijie.recovery.objects.role']==='io'?1:0)
 for(const target of targets){await assertTarget(root,target.id,runId);await docker(root,['rm','-f',target.id],undefined,{limit:4096})}
 const remaining=(await docker(root,['ps','-aq','--filter','label='+LABEL+'='+runId],undefined,{limit:1024*1024})).toString().trim();if(remaining)throw fail('Object restore cleanup is incomplete')
 return {completed:true,cleanupComplete:true,removed:targets.length}
}
async function createTarget(root,snapshot,runId){
 await imageInfo(root,snapshot.source.imageId,'store');await imageInfo(root,snapshot.source.helperImageId,'io')
 const suffix=randomUUID().slice(0,8),storeName=`xijie-objects-${runId}-store-${suffix}`,ioName=`xijie-objects-${runId}-io-${suffix}`
 const credentials={accessKeyId:'restore-'+randomBytes(12).toString('hex'),secretAccessKey:randomBytes(32).toString('hex')}
 const common=['--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','256','--tmpfs','/tmp:rw,nosuid,nodev,size=67108864']
 const storeId=(await docker(root,['run','-d','--name',storeName,'--label',LABEL+'='+runId,'--label','xijie.recovery.objects.role=store','--label','xijie.recovery.objects.image='+snapshot.source.imageId,'--network','none',...common,'--cap-add','CHOWN','--cap-add','SETUID','--cap-add','SETGID','--tmpfs','/data:rw,nosuid,nodev,size=536870912','-e','AWS_ACCESS_KEY_ID','-e','AWS_SECRET_ACCESS_KEY','-e','S3_BUCKET',snapshot.source.imageId,'mini','-dir=/data','-ip.bind=0.0.0.0','-s3.port=8333','-s3.port.iceberg=0','-s3.port.lance=0'],undefined,{env:{...process.env,AWS_ACCESS_KEY_ID:credentials.accessKeyId,AWS_SECRET_ACCESS_KEY:credentials.secretAccessKey,S3_BUCKET:snapshot.source.bucket},limit:4096})).toString().trim()
 if(!ID.test(storeId))throw fail('Isolated object store did not start');await assertTarget(root,storeId,runId)
 const ioId=(await docker(root,['run','-d','--name',ioName,'--label',LABEL+'='+runId,'--label','xijie.recovery.objects.role=io','--label','xijie.recovery.objects.image='+snapshot.source.helperImageId,'--label','xijie.recovery.objects.target='+storeId,'--network','container:'+storeId,...common,'--entrypoint','node',snapshot.source.helperImageId,'-e','setInterval(()=>{},60000)'],undefined,{limit:4096})).toString().trim()
 if(!ID.test(ioId))throw fail('Isolated object helper did not start');await assertTarget(root,ioId,runId)
 return {storeId,ioId,credentials}
}
function formatUrl(request){const url=new URL('http://127.0.0.1:8333');url.pathname=request.path;for(const [key,values]of Object.entries(request.query??{}))for(const value of Array.isArray(values)?values:[values])if(value!==undefined)url.searchParams.append(key,String(value));return url.href}
async function ioRequest(root,target,runId,request){
 await assertTarget(root,target.ioId,runId);await assertTarget(root,target.storeId,runId)
 let value;try{value=JSON.parse((await docker(root,['exec','-i',target.ioId,'node','-e',IO_SCRIPT],JSON.stringify(request),{limit:17*1024*1024})).toString())}catch{throw fail('Isolated object-store transport failed')}
 if(!value||!Number.isInteger(value.status)||value.status<100||value.status>599||typeof value.body!=='string'||!value.headers||value.body.length>16*1024*1024)throw fail('Invalid isolated object-store response')
 return {response:{statusCode:value.status,headers:value.headers,body:Readable.from([Buffer.from(value.body,'base64')])}}
}
function targetClient(root,target,runId){
 const config={endpoint:'http://127.0.0.1:8333',region:'us-east-1',credentials:target.credentials}
 const presigner=new S3RequestPresigner({region:config.region,credentials:config.credentials,sha256:NativeSha256})
 const requestHandler={async handle(request){
  const headers={...request.headers};for(const name of Object.keys(headers))if(['authorization','x-amz-date','x-amz-content-sha256'].includes(name.toLowerCase()))delete headers[name]
  const signed=await presigner.presign({...request,headers},{expiresIn:60}),bytes=await bytesFrom(request.body)
  return ioRequest(root,target,runId,{url:formatUrl(signed),method:request.method,headers:signed.headers,...(bytes.length?{body:bytes.toString('base64')}:{})})
 },destroy(){}}
 return client(config,{requestHandler})
}
function descriptorMetadata(descriptor){
 if(descriptor?.format!==1)throw fail('Invalid object backup descriptor')
 const snapshot=validateObjectSnapshot(descriptor.snapshot)
 if(!Array.isArray(descriptor.objects)||descriptor.objects.length!==snapshot.objects.length)throw fail('Object backup artifact count mismatch')
 const files=new Set()
 for(const [index,record]of descriptor.objects.entries()){
  if(!same(entriesMetadata([record])[0],snapshot.objects[index])||!record.artifact||record.artifact.plainSha256!==record.sha256||record.artifact.bytes!==record.byteSize||files.has(record.artifact.file))throw fail('Object backup artifact identity mismatch')
  files.add(record.artifact.file)
 }
 return snapshot
}
export async function restoreObjectStore({root,directory,backupId,key,descriptor,runId,checkpointSnapshot}){
 backupArgs(backupId,key);if(!RUN.test(runId??''))throw fail('Invalid isolated object restore run')
 const snapshot=descriptorMetadata(descriptor),checkpoint=validateObjectSnapshot(checkpointSnapshot),dir=await artifactDirectory(directory)
 // Authenticate every byte before launching a service or writing a target. No plaintext is written to the host.
 for(const record of descriptor.objects){const bytes=await openBytes(dir,record.artifact,key,`${backupId}:media-object:${record.key}`,OBJECT_LIMITS.objectBytes);if(bytes.length!==record.byteSize||sha256(bytes)!==record.sha256)throw fail('Object artifact content mismatch')}
 const existing=(await docker(root,['ps','-aq','--filter','label='+LABEL+'='+runId],undefined,{limit:4096})).toString().trim();if(existing)throw fail('Object restore run already owns targets')
 let s3,report,primaryError,cleanupComplete=false
 try{
  const target=await createTarget(root,snapshot,runId);s3=targetClient(root,target,runId)
  // A successful CreateBucket response is only acceptance. Seaweed mini can
  // publish that response before its filer makes the bucket usable. Require the
  // same signed list operation used by restoration before writing any bytes.
  let ready=false,lastFailure='unknown'
  for(let attempt=0;attempt<40;attempt++){
   try{
    try{await s3.send(new CreateBucketCommand({Bucket:snapshot.source.bucket}))}
    catch(error){if(!['BucketAlreadyOwnedByYou','BucketAlreadyExists','NotImplemented'].includes(error?.name))throw error}
    await list(s3,snapshot.source.bucket);ready=true;break
   }catch(error){
    lastFailure=error instanceof ObjectStorageError?error.message:/^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(error?.name??'')?error.name:'unknown'
    const status=error?.$metadata?.httpStatusCode
    if(Number.isInteger(status)&&status>=400&&status<500&&!(status===404&&error?.name==='NoSuchBucket'))throw fail('Isolated object initialization rejected: '+lastFailure+' '+status)
    if(!(await inspect(root,target.storeId)).running)throw fail('Isolated object store exited before readiness')
    await pause(250)
   }
  }
  if(!ready)throw fail('Isolated object store did not become ready: '+lastFailure)
  for(const record of descriptor.objects){const bytes=await openBytes(dir,record.artifact,key,`${backupId}:media-object:${record.key}`,OBJECT_LIMITS.objectBytes);await s3.send(new PutObjectCommand({Bucket:snapshot.source.bucket,Key:record.key,Body:bytes,ContentLength:bytes.length,ContentType:record.contentType}))}
  const restored=await manifest(s3,snapshot.source.bucket);if(!same(restored,snapshot.objects))throw fail('Restored object bytes differ from the snapshot')
  const latest=new Map(checkpoint.objects.map(o=>[o.key,o])),retained=restored.filter(o=>{const current=latest.get(o.key);return current&&current.sha256===o.sha256&&current.byteSize===o.byteSize&&current.contentType===o.contentType})
  for(const object of restored)if(!retained.includes(object))await s3.send(new DeleteObjectCommand({Bucket:snapshot.source.bucket,Key:object.key}))
  const afterReplay=await manifest(s3,snapshot.source.bucket);if(!same(afterReplay,retained))throw fail('Old deleted or corrected object bytes survived security replay')
  const anonymousPath=snapshot.objects.length?'/'+snapshot.source.bucket+'/'+snapshot.objects[0].key.split('/').map(encodeURIComponent).join('/'):'/'+snapshot.source.bucket+'?list-type=2'
  const probe=await ioRequest(root,target,runId,{url:'http://127.0.0.1:8333'+anonymousPath,method:'GET',headers:{}});const status=probe.response.statusCode;if(status!==401&&status!==403)throw fail('Anonymous object-store access was not blocked')
  report={completed:true,rawSnapshotVerified:true,checkpointMatches:checkpoint.digest===snapshot.digest,objectCount:restored.length,bytes:restored.reduce((n,v)=>n+v.byteSize,0),releaseReady:false,anonymousReadBlocked:true,networkIsolated:true,objectManifestDigest:sha256(JSON.stringify(restored)),securityReplay:{applied:true,scope:'invalidate_old_versions_only',invalidatedObjects:restored.length-retained.length,retainedObjects:retained.length,newObjectsRestored:0,oldInvalidBytesAbsent:true}}
 }catch(error){const name=/^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(error?.name??'')?error.name:'unknown',status=error?.$metadata?.httpStatusCode;primaryError=error instanceof ObjectStorageError?error:fail('Isolated object-store restoration failed: '+name+(Number.isInteger(status)?' '+status:''))}
 finally{s3?.destroy();try{await cleanupObjectRun(root,runId);cleanupComplete=true}catch{primaryError=fail('Isolated object-store cleanup failed')}}
 if(primaryError)throw primaryError
 return {...report,cleanupComplete}
}
