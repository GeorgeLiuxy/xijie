import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {readConfig} from '../dist/config.js'
test('optional voice decoder configuration performs metadata-only absolute regular-file checks while photos remain available when unset',async t=>{
 const old=process.env.MEDIA_FFMPEG_PATH,dir=await mkdtemp(join(tmpdir(),'xijie-voice-config-'));t.after(async()=>{if(old===undefined)delete process.env.MEDIA_FFMPEG_PATH;else process.env.MEDIA_FFMPEG_PATH=old;await rm(dir,{recursive:true,force:true})});delete process.env.MEDIA_FFMPEG_PATH;assert.equal(readConfig().ffmpegPath,undefined)
 for(const value of ['relative-ffmpeg.exe',dir,join(dir,'missing.exe')]){process.env.MEDIA_FFMPEG_PATH=value;assert.throws(()=>readConfig(),/Invalid configuration: MEDIA_FFMPEG_PATH/)}
 const file=join(dir,'metadata-only-never-execute.bin');await writeFile(file,Buffer.alloc(0));process.env.MEDIA_FFMPEG_PATH=file;assert.equal(readConfig().ffmpegPath,file)
 const link=join(dir,'symlink.bin');let supported=true;try{await symlink(file,link,'file')}catch(e){if(!['EPERM','ENOTSUP','EACCES'].includes(e.code))throw e;supported=false}if(supported){process.env.MEDIA_FFMPEG_PATH=link;assert.throws(()=>readConfig(),/Invalid configuration: MEDIA_FFMPEG_PATH/)}
})
