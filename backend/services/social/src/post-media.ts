import {createHash} from 'node:crypto'
import {identifier,object,positive,invalid,unavailable,type PostMedia,type PostMediaRef} from './contracts.js'

/** This is a stable resource identifier, never a substitute for ownership authorization. */
export function photoPostId(accountId:string,clientPostId:string){
 const bytes=createHash('sha256').update('xijie-social-photo-post-v1\0'+identifier(accountId)+'\0'+identifier(clientPostId)).digest().subarray(0,16)
 bytes[6]=(bytes[6]!&0x0f)|0x50;bytes[8]=(bytes[8]!&0x3f)|0x80
 const hex=bytes.toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
}
export function mediaRefsInput(value:unknown):PostMediaRef[]{
 const x=object(value,['refs']);if(!Array.isArray(x.refs)||x.refs.length>100)throw invalid()
 const refs=x.refs.map(value=>{const r=object(value,['postId','mediaId','version']);if(!positive(r.version))throw invalid();return {postId:identifier(r.postId),mediaId:identifier(r.mediaId),version:r.version}})
 if(new Set(refs.map(ref=>`${ref.postId}:${ref.mediaId}:${ref.version}`)).size!==refs.length)throw invalid()
 return refs
}
export function postMediaMetadata(value:unknown,ids:string[]):PostMedia[]{
 if(!Array.isArray(value)||value.length!==ids.length)throw unavailable()
 return value.map((item,index)=>{
  if(!item||typeof item!=='object'||item.id!==ids[index]||!positive(item.version)||item.mimeType!=='image/webp'||!positive(item.byteSize)||item.byteSize>1048576||!positive(item.width)||item.width>2048||!positive(item.height)||item.height>2048)throw unavailable()
  return {id:item.id,version:item.version,mimeType:item.mimeType,byteSize:item.byteSize,width:item.width,height:item.height}
 })
}
