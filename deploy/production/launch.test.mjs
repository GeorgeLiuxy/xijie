import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {resolve,join,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
import {plan} from './launch.mjs'

test('production planning rejects ambient secrets, public bind, shared databases and reused role tokens without starting any service',async()=>{
 const base=resolve(dirname(fileURLToPath(import.meta.url)),'../../.tmp'),dir=await mkdtemp(join(base,'production-plan-')),config=join(dir,'runtime.json'),env=join(dir,'people.env')
 const token=randomBytes(32).toString('hex'),body=['NODE_ENV=production','DATABASE_URL=postgres://synthetic:unusable@127.0.0.1:1/production_plan_only','PEOPLE_WEB_ORIGIN=https://app.example.test','XIJIE_IDENTITY_URL=https://identity.example.test','XIJIE_PEOPLE_SERVICE_TOKEN='+token].join('\n')
 const manifest={version:1,processes:[{id:'people-api',service:'people',entry:'main',envFile:env,enabled:true}]}
 try{
  await writeFile(config,JSON.stringify(manifest),{mode:0o600});await writeFile(env,body,{mode:0o600})
  const items=await plan(config);assert.equal(items.length,1);assert.equal(items[0].env.MODEL_API_KEY,undefined)
  const checked=spawnSync(process.execPath,['deploy/production/launch.mjs','check','--config',config],{cwd:resolve(base,'..'),encoding:'utf8'});assert.equal(checked.status,0,checked.stderr);assert.match(checked.stdout,/No network/)
  for(const [suffix,pattern]of [['\nPEOPLE_HOST=0.0.0.0',/loopback/],['\nNODE_TLS_REJECT_UNAUTHORIZED=0',/TLS/],['\nMODEL_API_KEY=secret',/MODEL_API_KEY_FILE/],['\nXIJIE_MEMORIES_SERVICE_TOKEN='+token,/independent/]]){await writeFile(env,body+suffix);await assert.rejects(plan(config),pattern)}
  await writeFile(env,body);await writeFile(config,JSON.stringify({...manifest,processes:[...manifest.processes,{id:'arbitrary',service:'identity',entry:'shell',envFile:env,enabled:true}]}));await assert.rejects(plan(config),/runtime process/)
 }finally{assert.equal(dirname(dir),base);assert.ok(dir.startsWith(join(base,'production-plan-')));await rm(dir,{recursive:true,force:true})}
})

test('static check covers deferred voice and report/operator configuration before any database or provider connection',async()=>{
 const base=resolve(dirname(fileURLToPath(import.meta.url)),'../../.tmp'),dir=await mkdtemp(join(base,'production-plan-')),config=join(dir,'runtime.json'),env=join(dir,'service.env'),operators=join(dir,'operators.json'),token=randomBytes(32).toString('hex'),other=randomBytes(32).toString('hex')
 const common='NODE_ENV=production\nDATABASE_URL=postgres://synthetic:unusable@127.0.0.1:1/preflight_only\n',check=()=>spawnSync(process.execPath,['deploy/production/launch.mjs','check','--config',config],{cwd:resolve(base,'..'),encoding:'utf8',timeout:5000}),manifest=service=>({version:1,processes:[{id:service+'-api',service,entry:'main',envFile:env,enabled:true}]})
 try{
  await writeFile(config,JSON.stringify(manifest('conversations')),{mode:0o600});const voice=common+'CONVERSATIONS_WEB_ORIGIN=https://app.example.test\nXIJIE_IDENTITY_URL=https://identity.example.test\nXIJIE_PEOPLE_URL=https://people.example.test\nXIJIE_CONVERSATIONS_SERVICE_TOKEN='+token;await writeFile(env,voice,{mode:0o600});assert.equal(check().status,0)
  for(const invalid of ['VOICE_CALL_MAX_SECONDS=121','VOICE_CALLS_ENABLED=maybe','VOICE_MODEL=unrelated-model','MODEL_BASE_URL=https://other.example.test/v1','MODEL_API_KEY_FILE=relative.key']){await writeFile(env,voice+'\n'+invalid);const result=check();assert.equal(result.status,1,invalid);assert.match(result.stderr,/Configuration validation failed/)}
  await writeFile(config,JSON.stringify(manifest('identity')),{mode:0o600});const identity=common+'OIDC_CALLBACK_URL=https://app.example.test/v1/auth/callback\nOIDC_ISSUER=https://login.example.test/oidc\nOIDC_CLIENT_ID=synthetic\nOIDC_CLIENT_SECRET=synthetic';await writeFile(env,identity);assert.equal(check().status,0)
  for(const invalid of ['CONTENT_REPORTS_ENABLED=maybe','CONTENT_REPORTS_ENABLED=true']){await writeFile(env,identity+'\n'+invalid);assert.equal(check().status,1)}
  await writeFile(operators,JSON.stringify([{id:'local-synthetic-reviewer',tokenHash:'a'.repeat(64),scopes:['reports:read','reports:resolve']}]),{mode:0o600});const valid=identity+'\nCONTENT_REPORTS_ENABLED=true\nXIJIE_CONTENT_REVIEW_SERVICE_TOKEN='+other+'\nCONTENT_REVIEW_OPERATORS_FILE='+operators+'\nXIJIE_CONVERSATIONS_URL=https://conversations.example.test\nXIJIE_SOCIAL_URL=https://social.example.test';await writeFile(env,valid);assert.equal(check().status,0)
  await writeFile(operators,JSON.stringify([{id:'local-synthetic-reviewer',tokenHash:'a'.repeat(64),scopes:['arbitrary:admin']}]),{mode:0o600});assert.equal(check().status,1)
 }finally{assert.equal(dirname(dir),base);assert.ok(dir.startsWith(join(base,'production-plan-')));await rm(dir,{recursive:true,force:true})}
})
