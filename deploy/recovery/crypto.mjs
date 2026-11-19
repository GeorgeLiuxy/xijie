import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto'
import {createReadStream,createWriteStream} from 'node:fs'
import {lstat,readFile,realpath,stat} from 'node:fs/promises'
import path from 'node:path'
import {Readable,Transform,Writable} from 'node:stream'
import {pipeline} from 'node:stream/promises'

export const sha256=value=>createHash('sha256').update(value).digest('hex')
export async function safeArtifact(directory,file){
 if(typeof file!=='string'||!/^[-a-z0-9]+\.enc$/.test(file))throw new Error('Invalid encrypted artifact name')
 const base=await realpath(directory),candidate=path.join(base,file),info=await lstat(candidate)
 if(!info.isFile()||info.isSymbolicLink()||path.dirname(await realpath(candidate))!==base)throw new Error('Artifact must be a regular file inside the backup directory')
 return candidate
}
export async function seal(input,destination,key,aad){
 if(!Buffer.isBuffer(key)||key.length!==32)throw new Error('Backup encryption key must be 256 bits')
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),plainHash=createHash('sha256'),cipherHash=createHash('sha256');let bytes=0
 cipher.setAAD(Buffer.from(aad))
 const plain=new Transform({transform(chunk,_enc,next){plainHash.update(chunk);next(null,chunk)}})
 const encrypted=new Transform({transform(chunk,_enc,next){bytes+=chunk.length;cipherHash.update(chunk);next(null,chunk)}})
 await pipeline(input,plain,cipher,encrypted,createWriteStream(destination,{flags:'wx',mode:0o600}))
 return {file:path.basename(destination),iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),cipherSha256:cipherHash.digest('hex'),plainSha256:plainHash.digest('hex'),bytes}
}
export async function verifyCipher(directory,meta){
 if(!meta||!Number.isSafeInteger(meta.bytes)||meta.bytes<0||!/^[a-f0-9]{64}$/.test(meta.cipherSha256??'')||!/^[a-f0-9]{64}$/.test(meta.plainSha256??'')||!/^[a-f0-9]{24}$/.test(meta.iv??'')||!/^[a-f0-9]{32}$/.test(meta.tag??''))throw new Error('Invalid encrypted artifact metadata')
 const file=await safeArtifact(directory,meta.file)
 if((await stat(file)).size!==meta.bytes)throw new Error('Encrypted artifact length mismatch')
 const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk)
 if(hash.digest('hex')!==meta.cipherSha256)throw new Error('Encrypted artifact checksum mismatch')
 return file
}
// The caller must stage plaintext in an isolated target file. Never execute it before this promise succeeds.
export async function openTo(directory,meta,key,aad,output){
 const file=await verifyCipher(directory,meta),decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(meta.iv,'hex')),hash=createHash('sha256')
 decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(Buffer.from(meta.tag,'hex'))
 const plain=new Transform({transform(chunk,_enc,next){hash.update(chunk);next(null,chunk)}})
 await pipeline(createReadStream(file),decipher,plain,output)
 if(hash.digest('hex')!==meta.plainSha256)throw new Error('Decrypted artifact checksum mismatch')
}
export async function openBytes(directory,meta,key,aad,maxBytes=64*1024*1024){
 const chunks=[];let bytes=0
 await openTo(directory,meta,key,aad,new Writable({write(chunk,_enc,next){bytes+=chunk.length;if(bytes>maxBytes){next(new Error('Encrypted metadata exceeds supported size'));return}chunks.push(chunk);next()}}))
 return Buffer.concat(chunks)
}
export const sealBytes=(bytes,destination,key,aad)=>seal(Readable.from([bytes]),destination,key,aad)
export async function loadKey(file){const value=(await readFile(file,'utf8')).trim();if(!/^[a-f0-9]{64}$/.test(value))throw new Error('Invalid backup key file');return Buffer.from(value,'hex')}
