import {spawn} from 'node:child_process'
import {lstat} from 'node:fs/promises'
import {isAbsolute} from 'node:path'
import {MediaError} from './contracts.js'
export const VOICE_MAX_INPUT=8*1024*1024,VOICE_MAX_PCM=24000*30*2,VOICE_MAX_OUTPUT=VOICE_MAX_PCM+44
export const VOICE_MIMES=['audio/wav','audio/mpeg','audio/ogg','audio/webm','audio/mp4'] as const
const error=(code:string)=>new MediaError(422,code,'The voice sample could not be verified.')
function format(bytes:Buffer,mime:string){
 const valid=mime==='audio/wav'?bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE':mime==='audio/ogg'?bytes.toString('ascii',0,4)==='OggS':mime==='audio/webm'?bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])):mime==='audio/mp4'?bytes.length>=12&&bytes.toString('ascii',4,8)==='ftyp':mime==='audio/mpeg'?bytes.toString('ascii',0,3)==='ID3'||bytes.length>1&&bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0:false
 if(!valid)throw error('AUDIO_MIME_MISMATCH')
 return mime==='audio/wav'?'wav':mime==='audio/mpeg'?'mp3':mime==='audio/ogg'?'ogg':mime==='audio/webm'?'matroska,webm':'mov,mp4,m4a,3gp,3g2,mj2'
}
export async function normalizeVoice(bytes:Buffer,mime:string,executable:string|undefined,signal?:AbortSignal){
 if(!bytes.length||bytes.length>VOICE_MAX_INPUT)throw error('INVALID_AUDIO');const demuxer=format(bytes,mime)
 try{if(!executable||!isAbsolute(executable))throw Error();const stat=await lstat(executable);if(!stat.isFile()||stat.isSymbolicLink())throw Error()}catch{throw new MediaError(503,'AUDIO_DECODER_UNAVAILABLE','The voice decoder is unavailable.')}
 if(signal?.aborted)throw error('PROCESSING_STOPPED')
 const pcm=await new Promise<Buffer>((resolve,reject)=>{
  let done=false,size=0;const chunks:Buffer[]=[],child=spawn(executable!,['-hide_banner','-loglevel','error','-nostdin','-threads','1','-filter_threads','1','-filter_complex_threads','1','-max_alloc','33554432','-protocol_whitelist','pipe','-probesize','1048576','-analyzeduration','1000000','-f',demuxer,'-i','pipe:0','-map','0:a:0','-vn','-sn','-dn','-t','30.002','-ac','1','-ar','24000','-c:a','pcm_s16le','-f','s16le','pipe:1'],{windowsHide:true,stdio:['pipe','pipe','pipe']})
  const finish=(cause?:MediaError)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(cause){child.kill();reject(cause)}else resolve(Buffer.concat(chunks))},abort=()=>finish(error('PROCESSING_STOPPED')),timer=setTimeout(()=>finish(error('AUDIO_DECODE_TIMEOUT')),20000)
  child.stderr.resume();child.stdin.on('error',()=>{});child.on('error',()=>finish(new MediaError(503,'AUDIO_DECODER_UNAVAILABLE')));child.stdout.on('data',(b:Buffer)=>{size+=b.length;if(size>VOICE_MAX_PCM)finish(error('AUDIO_TOO_LONG'));else chunks.push(b)});child.on('close',code=>finish(code===0&&size>0&&size%2===0?undefined:error('INVALID_AUDIO')));signal?.addEventListener('abort',abort,{once:true});child.stdin.end(bytes)
 })
 const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(36+pcm.length,4);header.write('WAVE',8);header.write('fmt ',12);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(24000,24);header.writeUInt32LE(48000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40)
 return{bytes:Buffer.concat([header,pcm]),durationMs:Math.ceil(pcm.length*1000/48000),mimeType:'audio/wav' as const}
}
