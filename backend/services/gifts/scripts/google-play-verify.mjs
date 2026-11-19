import { lstat, open } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { GiftsError } from '../dist/contracts.js'
import { inspectGooglePlayPurchase, readGooglePlayVerificationConfig } from '../dist/google-play-verifier.js'

async function privateText(path, limit) {
 if (!path || !isAbsolute(path)) throw new GiftsError(422, 'GOOGLE_PLAY_PRIVATE_FILE_REQUIRED')
 const expected = await lstat(path)
 if (!expected.isFile()) throw new GiftsError(422, 'GOOGLE_PLAY_PRIVATE_FILE_REQUIRED')
 const handle = await open(path, 'r')
 try {
  const actual = await handle.stat()
  if (!actual.isFile() || actual.dev !== expected.dev || actual.ino !== expected.ino
    || actual.size < 1 || actual.size > limit || process.platform !== 'win32' && (actual.mode & 0o077) !== 0)
   throw new GiftsError(422, 'GOOGLE_PLAY_PRIVATE_FILE_REQUIRED')
  const buffer = Buffer.alloc(limit + 1)
  let length = 0
  for (;;) {
   const {bytesRead} = await handle.read(buffer, length, buffer.length - length)
   if (!bytesRead) break
   length += bytesRead
   if (length > limit) throw new GiftsError(422, 'GOOGLE_PLAY_PRIVATE_FILE_REQUIRED')
  }
  return new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,length))
 } finally { await handle.close() }
}

try {
 const config = readGooglePlayVerificationConfig()
 if (!config) throw new GiftsError(503, 'GOOGLE_PLAY_VERIFICATION_UNAVAILABLE')
 if (process.argv.length !== 3) throw new GiftsError(422, 'GOOGLE_PLAY_PRIVATE_FILE_REQUIRED')
 const input = JSON.parse(await privateText(process.argv[2],8192))
 const token = (await privateText(config.accessTokenFile,8192)).trim()
 console.log(JSON.stringify(await inspectGooglePlayPurchase(config,token,input)))
} catch (error) {
 console.error(JSON.stringify({ code: error instanceof GiftsError ? error.code : 'GOOGLE_PLAY_VERIFICATION_UNAVAILABLE' }))
 process.exitCode = 1
}
