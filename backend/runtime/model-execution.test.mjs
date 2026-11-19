import assert from 'node:assert/strict'
import {test} from 'node:test'
import {randomUUID} from 'node:crypto'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {configuredTextModel,executeModel,isModelAttemptUsage,modelAccountIds,modelApiKey,eligibleModelAccounts,personModelProfile} from './model-execution.mjs'

test('a configured purpose picks its own model while existing workers keep the default', () => {
 const keys=['MODEL_NAME','MODEL_NAME_LETTER_REPLY'], saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]))
 try {
  process.env.MODEL_NAME='gpt-default'
  process.env.MODEL_NAME_LETTER_REPLY='  gpt-letter-quality  '
  assert.equal(configuredTextModel('text_reply'),'gpt-default')
  assert.equal(configuredTextModel('letter_reply'),'gpt-letter-quality')
  process.env.MODEL_NAME_LETTER_REPLY='invalid model'
  assert.throws(()=>configuredTextModel('letter_reply'),/Invalid configured model name/)
 } finally {
  for(const [key,value] of Object.entries(saved)) value===undefined?delete process.env[key]:process.env[key]=value
 }
})

test('production model transport is explicitly enabled, privately credentialed and centrally fenced, including late denial',async()=>{
 const names=['NODE_ENV','MODEL_EXECUTION_ENABLED','MODEL_PRODUCTION_APPROVED','MODEL_ALLOWED_ACCOUNT_IDS','MODEL_API_KEY','MODEL_API_KEY_FILE','XIJIE_IDENTITY_URL','XIJIE_CONVERSATIONS_SERVICE_TOKEN','XIJIE_MEMORIES_SERVICE_TOKEN'],saved=Object.fromEntries(names.map(k=>[k,process.env[k]])),original=globalThis.fetch,dir=mkdtempSync(join(tmpdir(),'xijie-model-policy-'))
 try{
  const input={accountId:randomUUID(),jobId:randomUUID(),attemptId:randomUUID(),signal:new AbortController().signal},keyfile=join(dir,'model.key');writeFileSync(keyfile,'synthetic-test-key',{mode:0o600})
  Object.assign(process.env,{NODE_ENV:'production',MODEL_EXECUTION_ENABLED:'true',MODEL_ALLOWED_ACCOUNT_IDS:input.accountId,MODEL_API_KEY:'inline-must-not-authorize',XIJIE_IDENTITY_URL:'https://identity.example.test',XIJIE_CONVERSATIONS_SERVICE_TOKEN:'1'.repeat(64),XIJIE_MEMORIES_SERVICE_TOKEN:'2'.repeat(64)})
  delete process.env.MODEL_API_KEY_FILE;delete process.env.MODEL_PRODUCTION_APPROVED
  assert.equal(modelApiKey(),undefined)
  let calls=0,transports=0,allow=true;globalThis.fetch=async(url,init)=>{calls++;assert.equal(init.redirect,'error');assert.ok(String(url).startsWith('https://identity.example.test/internal/v1/model-executions/'));if(String(url).includes('/accounts?'))return Response.json({data:{items:[input.accountId],nextCursor:null}});const body=JSON.parse(init.body);if(String(url).endsWith('/claim')){assert.equal(body.purpose,'text_reply');assert.equal(body.accountId,input.accountId);return Response.json({data:{id:input.attemptId}})}return Response.json({data:{allowed:body.succeeded&&allow}})}
  const run=()=>executeModel(input,'conversations','text_reply',async()=>{transports++;return 'actual-model-result'})
  await assert.rejects(run(),{code:'AI_PERMISSION_REQUIRED'});assert.equal(calls,0);assert.equal(transports,0)
  process.env.MODEL_PRODUCTION_APPROVED='true';process.env.MODEL_API_KEY_FILE=keyfile;assert.equal(modelApiKey(),'synthetic-test-key')
  assert.equal(await run(),'actual-model-result');assert.equal(calls,2);assert.equal(transports,1)
  allow=false;await assert.rejects(run(),{code:'AI_PERMISSION_REQUIRED'});assert.equal(transports,2)
  delete process.env.MODEL_EXECUTION_ENABLED;await assert.rejects(run(),{code:'AI_PERMISSION_REQUIRED'});assert.equal(transports,2)
  process.env.MODEL_EXECUTION_ENABLED='true';process.env.MODEL_ALLOWED_ACCOUNT_IDS='*';assert.deepEqual(modelAccountIds(),['*'])
  assert.deepEqual(await eligibleModelAccounts('memories','automatic_memory'),{items:[input.accountId],nextCursor:null})
  process.env.NODE_ENV='test';assert.throws(()=>modelAccountIds(),/production approval/)
  assert.deepEqual(personModelProfile({conversationTone:'injected',voiceTimbre:'custom-clone'}).userResponsePreferences,{conversationTone:null,voiceTimbre:null});assert.deepEqual(personModelProfile({conversationTone:'witty',voiceTimbre:'deep'}).userResponsePreferences,{conversationTone:'witty',voiceTimbre:'deep'})
  assert.deepEqual(personModelProfile({personality:['patient'],life:['user-confirmed'],catchphrase:'hello',unknowns:['birthplace'],photos:['private'],secret:'excluded'}),{userResponsePreferences:{conversationTone:null,voiceTimbre:null},personality:['patient'],life:['user-confirmed'],catchphrase:'hello',unknownsToExploreNotFacts:['birthplace']})
 }finally{globalThis.fetch=original;for(const[k,v]of Object.entries(saved))v===undefined?delete process.env[k]:process.env[k]=v;rmSync(dir,{recursive:true,force:true})}
})

test('model transport meters only observed counts and keeps returned usage when writeback is denied',async t=>{
 const accountId=randomUUID()
 const env={NODE_ENV:'production',MODEL_EXECUTION_ENABLED:'true',MODEL_PRODUCTION_APPROVED:'true',MODEL_ALLOWED_ACCOUNT_IDS:accountId,XIJIE_IDENTITY_URL:'https://identity.example.test',XIJIE_CONVERSATIONS_SERVICE_TOKEN:'1'.repeat(64)}
 for(const [key,value] of Object.entries(env)){
  const previous=process.env[key]
  process.env[key]=value
  t.after(()=>{if(previous===undefined)delete process.env[key];else process.env[key]=previous})
 }
 const controller=new AbortController(),calls=[]
 let allowed=true,abortOnClaim=false,loseFinish=false
 t.mock.method(globalThis,'fetch',async(url,request)=>{
  const body=JSON.parse(request.body)
  if(url.pathname.endsWith('/claim')){
   if(abortOnClaim)controller.abort()
   return Response.json({data:{id:body.attemptId}})
  }
  assert.equal(isModelAttemptUsage(body.usage),true)
  calls.push(body)
  if(loseFinish){loseFinish=false;throw new TypeError('finish response lost')}
  return Response.json({data:{allowed:allowed&&body.succeeded}})
 })
 const run=(operation,signal)=>executeModel({accountId,jobId:randomUUID(),attemptId:randomUUID(),signal},'conversations','text_reply',operation,{provider:'openai',model:'gpt-5-mini'})
 const generated={
  text:'PRIVATE RESPONSE',
  response:{modelId:'gpt-5-mini-2025-08-07',id:'PRIVATE RESPONSE ID'},
  steps:[{usage:{raw:{prompt_tokens:120,completion_tokens:14,prompt_tokens_details:{cached_tokens:0},unrelated:'PRIVATE'}}}],
 }
 assert.equal(await run(async()=>generated),generated)
 let completion=calls.pop()
 assert.equal(completion.succeeded,true)
 assert.deepEqual(completion.usage,{provider:'openai',model:'gpt-5-mini',resolvedModel:'gpt-5-mini-2025-08-07',state:'returned',elapsedMs:completion.usage.elapsedMs,inputTokens:120,outputTokens:14,cachedInputTokens:0})
 assert.doesNotMatch(JSON.stringify(completion),/PRIVATE/)

 allowed=false
 await assert.rejects(run(async()=>({...generated,steps:[{usage:{raw:{prompt_tokens:12}}},{usage:{raw:{prompt_tokens:8,completion_tokens:0}}}]})),{code:'AI_PERMISSION_REQUIRED'})
 assert.equal(calls.length,1)
 completion=calls.pop()
 assert.deepEqual([completion.succeeded,completion.usage.state,completion.usage.inputTokens,completion.usage.outputTokens,completion.usage.cachedInputTokens],[true,'returned',20,null,null])

 const failure=new Error('PRIVATE TRANSPORT ERROR')
 await assert.rejects(run(async()=>{throw failure}),error=>error===failure)
 completion=calls.pop()
 assert.deepEqual([completion.succeeded,completion.usage.state,completion.usage.inputTokens,completion.usage.outputTokens,completion.usage.cachedInputTokens],[false,'failed',null,null,null])
 assert.doesNotMatch(JSON.stringify(completion),/PRIVATE/)

 loseFinish=true
 await assert.rejects(run(async()=>generated),/finish response lost/)
 assert.equal(calls.length,2)
 assert.deepEqual(calls.map(call=>call.succeeded),[true,false])
 assert.deepEqual(calls[0].usage,calls[1].usage)
 calls.length=0

 abortOnClaim=true
 await assert.rejects(run(async()=>assert.fail('canceled claim dispatched a model call'),controller.signal),{code:'AI_PERMISSION_REQUIRED'})
 completion=calls.pop()
 assert.deepEqual([completion.succeeded,completion.usage.state,completion.usage.elapsedMs],[false,'not_started',null])
})
