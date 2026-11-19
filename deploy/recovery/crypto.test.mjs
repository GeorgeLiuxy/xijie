import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {mkdtemp,readFile,writeFile,rm,realpath} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {sealBytes,openBytes} from './crypto.mjs'

test('encrypted archives reject a wrong key, modified bytes, swapped identity, traversal and truncation',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'xijie-recovery-crypto-')),key=randomBytes(32),original=Buffer.concat([Buffer.from('PGDMP\0'),randomBytes(32768)])
 try{
  const meta=await sealBytes(original,path.join(dir,'test.enc'),key,'backup:one')
  assert.deepEqual(await openBytes(dir,meta,key,'backup:one'),original)
  await assert.rejects(openBytes(dir,meta,randomBytes(32),'backup:one'))
  await assert.rejects(openBytes(dir,meta,key,'backup:two'))
  await assert.rejects(openBytes(dir,{...meta,file:'../test.enc'},key,'backup:one'))
  const bytes=await readFile(path.join(dir,'test.enc'));bytes[100]^=1;await writeFile(path.join(dir,'test.enc'),bytes)
  await assert.rejects(openBytes(dir,meta,key,'backup:one'),/checksum/)
  await writeFile(path.join(dir,'test.enc'),bytes.subarray(0,40));await assert.rejects(openBytes(dir,meta,key,'backup:one'),/length/)
 }finally{const resolved=await realpath(dir),base=await realpath(os.tmpdir());assert.equal(path.dirname(resolved),base);assert.match(path.basename(resolved),/^xijie-recovery-crypto-/);await rm(resolved,{recursive:true,force:true})}
})
