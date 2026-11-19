import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes,randomUUID} from 'node:crypto'
import {mkdtemp,readFile,writeFile,rm,readdir,realpath,lstat} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {OBJECT_LIMITS,validateObjectKey,objectSnapshot,validateObjectSnapshot,restoreObjectStore,cleanupObjectRun} from './object-storage.mjs'
import {sealBytes,sha256} from './crypto.mjs'

const run=promisify(execFile),root=path.resolve(import.meta.dirname,'../..')
async function removeFixture(directory){const resolved=await realpath(directory),base=await realpath(tmpdir());assert(!(await lstat(directory)).isSymbolicLink()&&path.dirname(resolved)===base&&path.basename(resolved).startsWith('xijie-object-'));await rm(resolved,{recursive:true,force:true})}
const source={name:'xijie-media-dev-object-store-1',id:'1'.repeat(64),imageId:'sha256:'+'2'.repeat(64),helperImageId:'sha256:'+'3'.repeat(64),bucket:'xijie-private-photos'}
const data=Buffer.from('Synthetic object only. Not a user photo.'),entry={key:'ready/synthetic.webp',byteSize:data.length,sha256:sha256(data),contentType:'image/webp'}

test('manifest accepts only safe keys, complete sorted unique bounded entries and exact source/digest identities',()=>{
 assert.equal(validateObjectKey('staging/1234/input.jpeg'),'staging/1234/input.jpeg')
 for(const key of ['../private','ready/../x','/absolute','ready//x','https://host/x','ready/a?token=x','ready/a#x','ready/%2e%2e/x','ready\\x','ready/./x','ready/'])assert.throws(()=>validateObjectKey(key))
 const snapshot=objectSnapshot(source,[entry]);assert.deepEqual(validateObjectSnapshot(snapshot),snapshot)
 for(const changed of [{...snapshot,digest:'0'.repeat(64)},{...snapshot,source:{...source,name:'not-an-allowed-source'}},{...snapshot,objects:[{...entry,byteSize:entry.byteSize+1}]},{...snapshot,objects:[entry,entry]}])assert.throws(()=>validateObjectSnapshot(changed))
 assert.throws(()=>objectSnapshot(source,[{...entry,byteSize:OBJECT_LIMITS.objectBytes+1}]))
 assert.throws(()=>objectSnapshot(source,Array.from({length:OBJECT_LIMITS.count+1},(_,i)=>({...entry,key:'ready/'+i}))))
 assert.throws(()=>objectSnapshot(source,Array.from({length:25},(_,i)=>({...entry,key:'ready/'+i,byteSize:OBJECT_LIMITS.objectBytes}))))
 const reordered=objectSnapshot(source,[{...entry,key:'ready/z'},entry]);assert.equal(reordered.objects[0].key,entry.key)
 assert.throws(()=>validateObjectSnapshot({...reordered,objects:[...reordered.objects].reverse()}))
 assert(!JSON.stringify(snapshot).includes('secretAccessKey'))
})

test('artifact metadata, ciphertext and AAD tampering fail before any target is created',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'xijie-object-tamper-'));t.after(()=>removeFixture(directory))
 const key=randomBytes(32),backupId='synthetic-backup-12345678',artifact=await sealBytes(data,path.join(directory,'object-0000.enc'),key,`${backupId}:media-object:${entry.key}`),snapshot=objectSnapshot(source,[entry]),descriptor={format:1,snapshot,objects:[{...entry,artifact}]},runId=randomUUID().replaceAll('-','').slice(0,16)
 const call=extra=>restoreObjectStore({root,directory,backupId,key,descriptor,runId,checkpointSnapshot:snapshot,...extra})
 await assert.rejects(call({descriptor:{...descriptor,objects:[]}}),/count mismatch/)
 await assert.rejects(call({descriptor:{...descriptor,objects:[{...entry,artifact:{...artifact,plainSha256:'0'.repeat(64)}}]}}),/identity mismatch/)
 await assert.rejects(call({backupId:'another-backup-12345678'}))
 const encrypted=await readFile(path.join(directory,artifact.file));assert(!encrypted.includes(data));encrypted[0]^=1;await writeFile(path.join(directory,artifact.file),encrypted)
 await assert.rejects(call({}))
 assert.deepEqual((await readdir(directory)).sort(),['object-0000.enc'])
})

test('actual pinned Seaweed and Node helper restore encrypted bytes over shared network-none, reject anonymous reads and clean all owned targets',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'xijie-object-restore-'));t.after(()=>removeFixture(directory))
 const image=async name=>(await run('docker',['image','inspect','--format','{{.Id}}',name],{cwd:root,windowsHide:true})).stdout.trim()
 const pinned={...source,imageId:await image('ghcr.io/chrislusf/seaweedfs:4.53'),helperImageId:await image('node:22-alpine')},key=randomBytes(32),backupId='synthetic-roundtrip-12345678',runId=randomUUID().replaceAll('-','').slice(0,16)
 const objects=[{...entry,bytes:data},{key:'staging/synthetic/input.png',bytes:randomBytes(2048),contentType:'image/png'}].map(v=>({...v,byteSize:v.bytes.length,sha256:sha256(v.bytes)}))
 const snapshot=objectSnapshot(pinned,objects),records=[]
 for(const [i,v]of snapshot.objects.entries()){const bytes=objects.find(o=>o.key===v.key).bytes;records.push({...v,artifact:await sealBytes(bytes,path.join(directory,'object-'+i+'.enc'),key,`${backupId}:media-object:${v.key}`)})}
 const report=await restoreObjectStore({root,directory,backupId,key,descriptor:{format:1,snapshot,objects:records},runId,checkpointSnapshot:snapshot})
 assert.equal(report.completed,true);assert.equal(report.rawSnapshotVerified,true);assert.equal(report.checkpointMatches,true);assert.equal(report.objectCount,2);assert.equal(report.bytes,data.length+2048);assert.equal(report.cleanupComplete,true);assert.equal(report.releaseReady,false);assert.equal(report.anonymousReadBlocked,true);assert.equal(report.networkIsolated,true)
 assert.deepEqual(await cleanupObjectRun(root,runId),{completed:true,cleanupComplete:true,removed:0})
 assert(!(JSON.stringify(report).includes(data.toString())||JSON.stringify(report).includes('AWS_')))
 const newer=objectSnapshot(pinned,[snapshot.objects[0],{...snapshot.objects[1],sha256:'a'.repeat(64)},{...entry,key:'ready/new-not-in-backup.webp'}]),changedRun=runId+'-new',changed=await restoreObjectStore({root,directory,backupId,key,descriptor:{format:1,snapshot,objects:records},runId:changedRun,checkpointSnapshot:newer})
 assert.equal(changed.checkpointMatches,false);assert.deepEqual(changed.securityReplay,{applied:true,scope:'invalidate_old_versions_only',invalidatedObjects:1,retainedObjects:1,newObjectsRestored:0,oldInvalidBytesAbsent:true});assert.equal(changed.cleanupComplete,true)
})
