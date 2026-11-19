import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createHash,randomBytes} from 'node:crypto'
import {readReportConfig} from '../dist/report-dependencies.js'
test('enabled content review validates a bounded regular private operator registry and independently scoped credentials without connecting services',async()=>{
 const base=resolve(tmpdir()),dir=await mkdtemp(join(base,'xijie-review-config-')),file=join(dir,'operators.json'),token=randomBytes(32).toString('hex'),old={...process.env}
 const operator={id:'synthetic-review',tokenHash:createHash('sha256').update(randomBytes(32)).digest('hex'),scopes:['reports:read']}
 try{
  Object.assign(process.env,{CONTENT_REPORTS_ENABLED:'true',XIJIE_CONTENT_REVIEW_SERVICE_TOKEN:token,CONTENT_REVIEW_OPERATORS_FILE:file,XIJIE_CONVERSATIONS_URL:'http://127.0.0.1:1',XIJIE_SOCIAL_URL:'http://127.0.0.1:2'});delete process.env.NODE_ENV
  await writeFile(file,JSON.stringify([operator]),{mode:0o600})
  assert.equal(readReportConfig('http://127.0.0.1:5184').operators[0].id,operator.id)
  await writeFile(file,' '.repeat(65537),{mode:0o600});assert.throws(()=>readReportConfig('http://127.0.0.1:5184'),/private regular/)
  process.env.CONTENT_REVIEW_OPERATORS_FILE=dir;assert.throws(()=>readReportConfig('http://127.0.0.1:5184'),/private regular/)
  process.env.CONTENT_REVIEW_OPERATORS_FILE=file
  await writeFile(file,JSON.stringify([{...operator,tokenHash:createHash('sha256').update(token).digest('hex')}]),{mode:0o600});assert.throws(()=>readReportConfig('http://127.0.0.1:5184'),/independent/)
  process.env.CONTENT_REPORTS_ENABLED='false';assert.equal(readReportConfig('http://127.0.0.1:5184').enabled,false)
 }finally{for(const key of Object.keys(process.env))if(!(key in old))delete process.env[key];Object.assign(process.env,old);assert.equal(resolve(dir,'..'),base);assert.ok(dir.startsWith(join(base,'xijie-review-config-')));await rm(dir,{recursive:true,force:true})}
})
