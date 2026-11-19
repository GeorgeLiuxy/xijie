import type {PeopleConfig} from './config.js'
import {PeopleError,uuid,type PhotoMetadata,type PhotoBinding,type PhotoRef,invalid} from './contracts.js'

export function photoRefs(body:unknown):PhotoRef[]{
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1)throw invalid()
  const refs=(body as {refs?:unknown}).refs
  if(!Array.isArray(refs)||refs.length>100)throw invalid()
  if(refs.some(r=>!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).length!==3||!uuid.test(r.draftId)||!uuid.test(r.mediaId)||!Number.isSafeInteger(r.version)||r.version<1||r.version>2147483647)||new Set(refs.map(r=>r.draftId+':'+r.mediaId)).size!==refs.length)throw invalid()
  return refs.map(r=>({draftId:r.draftId.toLowerCase(),mediaId:r.mediaId.toLowerCase(),version:r.version}))
}

export async function bindPhotos(config:PeopleConfig,accountId:string,draftId:string,mediaIds:string[]):Promise<PhotoBinding>{
  if(!mediaIds.length)return {media:[]}
  const unavailable=()=>new PeopleError(503,'MEDIA_UNAVAILABLE','The selected photos could not be verified. Try again with the same selection.')
  if(!config.mediaOrigin)throw unavailable()
  let response:Response
  try{response=await fetch(new URL('/internal/v1/people/drafts/'+draftId+'/media-bindings',config.mediaOrigin),{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{Authorization:'Bearer '+config.serviceToken,'Content-Type':'application/json','X-Xijie-Account-Id':accountId},body:JSON.stringify({mediaIds})})}catch{throw unavailable()}
  if(!response.ok){
    const code=(await response.json().catch(()=>null))?.error?.code
    if(response.status===403)throw new PeopleError(403,'PHOTO_PERMISSION_REQUIRED','Permission to save person photos is required.')
    if(response.status===404||response.status===409||response.status===422)throw new PeopleError(response.status,'PHOTO_SELECTION_INVALID','The selected photos are unavailable or still processing.',{retryable:code==='MEDIA_NOT_READY'})
    throw unavailable()
  }
  const value=(await response.json().catch(()=>null))?.data
  if(!value||value.draftId!==draftId||!Array.isArray(value.media)||value.media.length!==mediaIds.length||value.media.some((p:any,i:number)=>p?.id!==mediaIds[i]||!Number.isSafeInteger(p.version)||p.version<1||p.version>2147483647||p.mimeType!=='image/webp'||!Number.isSafeInteger(p.byteSize)||p.byteSize<1||p.byteSize>1048576||!Number.isSafeInteger(p.width)||p.width<1||p.width>2048||!Number.isSafeInteger(p.height)||p.height<1||p.height>2048))throw unavailable()
  if(typeof value.expiresAt!=='string'||!Number.isFinite(Date.parse(value.expiresAt))||Date.parse(value.expiresAt)>Date.now()+120000)throw unavailable()
  return {expiresAt:value.expiresAt,media:value.media.map((p:PhotoMetadata)=>({id:p.id,version:p.version,mimeType:p.mimeType,byteSize:p.byteSize,width:p.width,height:p.height}))}
}
