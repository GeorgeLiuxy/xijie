import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createEchoProvider} from '../dist/echo-provider.js'
import {worldContextRevision} from '../dist/virtual-world.js'
test('actual SDK sends only fresh scoped memory/echo comment inputs with authorized provider controls and no action tools',async()=>{
 const names=['MODEL_BASE_URL','MODEL_NAME','MODEL_API_KEY','MODEL_EXECUTION_ENABLED','MODEL_ALLOWED_ACCOUNT_IDS','NODE_ENV'],old=Object.fromEntries(names.map(k=>[k,process.env[k]])),id=randomUUID(),personId=randomUUID(),worldId=randomUUID()
 Object.assign(process.env,{MODEL_BASE_URL:'https://api.openai.com/v1',MODEL_NAME:'gpt-5-mini',MODEL_API_KEY:'synthetic-not-a-real-secret',MODEL_ALLOWED_ACCOUNT_IDS:id,MODEL_EXECUTION_ENABLED:'true',NODE_ENV:'test'})
 let calls=0,wire
 try{
  const provider=createEchoProvider({fetch:async(url,request)=>{calls++;assert.equal(String(url),'https://api.openai.com/v1/chat/completions');wire=JSON.parse(request.body);return Response.json({id:'chatcmpl-synthetic',object:'chat.completion',created:1,model:'gpt-5-mini',choices:[{index:0,message:{role:'assistant',content:'真实SDK合成传输结果'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}})}})
  const world={accountId:id,personId,personVersion:1,worldVersion:1,reality:'virtual',branch:'main',currentWorld:{id:worldId,code:'courtyard',displayName:'日光庭院',catalogVersion:1,enabled:true},recentMovements:[]};world.revision=worldContextRevision(world)
  const input={jobId:randomUUID(),attemptId:randomUUID(),accountId:id,kind:'memory_echo',aiAuthorizationVersion:1,account:{accountId:id,accessVersion:1,storyStorage:{allowed:true,authorizationVersion:1,privateFeedAllowed:true},aiTextProcessing:{allowed:true,authorizationVersion:1,privateFeedProcessingAllowed:true}},person:{id:personId,accountId:id,displayName:'合成角色',version:1,accessVersion:1,worldVersion:1,worldId,story:'用户原始故事',relationship:'friend'},memory:{id:randomUUID(),accountId:id,personId,body:'明确确认的珍藏原文'},world,signal:new AbortController().signal}
  assert.equal((await provider.generate(input)).text,'真实SDK合成传输结果');assert.equal(wire.store,false);assert.equal(wire.reasoning_effort,'none');assert.equal(wire.max_completion_tokens,1000);assert.equal(wire.max_tokens,undefined);assert.equal(wire.tools,undefined)
  const sent=JSON.parse(wire.messages.find(m=>m.role==='user').content);assert.equal(sent.userConfirmedMemory.body,input.memory.body);assert.equal(sent.virtualWorld.reality,'virtual');assert.equal(sent.userPosts,undefined)
  for(const modify of [v=>{v.account.aiTextProcessing.privateFeedProcessingAllowed=false},v=>{v.aiAuthorizationVersion=2},v=>{v.memory.accountId=randomUUID()},v=>{v.accountId=randomUUID()}]){const candidate=structuredClone({...input,signal:undefined});candidate.signal=input.signal;modify(candidate);await assert.rejects(provider.generate(candidate))}
  assert.equal(calls,1)
  process.env.MODEL_BASE_URL='https://not-allowed.example/v1';assert.throws(()=>createEchoProvider());assert.equal(calls,1)
 }finally{for(const [k,v]of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v}
})

test('actual SDK failure diagnostics keep HTTP status without token, prompt, error message or response payload',async()=>{
 const names=['MODEL_BASE_URL','MODEL_NAME','MODEL_API_KEY','MODEL_ALLOWED_ACCOUNT_IDS','NODE_ENV'],old=Object.fromEntries(names.map(k=>[k,process.env[k]])),id=randomUUID(),personId=randomUUID(),worldId=randomUUID(),logs=[],original=console.error
 const token='synthetic-token-must-never-be-logged',prompt='synthetic-user-prompt-must-never-be-logged',message='synthetic-error-message-must-never-be-logged'
 Object.assign(process.env,{MODEL_BASE_URL:'https://api.openai.com/v1',MODEL_NAME:'gpt-5-mini',MODEL_API_KEY:token,MODEL_ALLOWED_ACCOUNT_IDS:id,MODEL_EXECUTION_ENABLED:'true',NODE_ENV:'test'});console.error=(...args)=>logs.push(args)
 try{
  const provider=createEchoProvider({fetch:async()=>Response.json({error:{message:message+' '+token+' '+prompt,type:'bad_request',code:'synthetic_failure'}},{status:400,headers:{'X-Private-Test':token}})})
  const world={accountId:id,personId,personVersion:1,worldVersion:1,reality:'virtual',branch:'main',currentWorld:{id:worldId,code:'courtyard',displayName:'合成世界',catalogVersion:1,enabled:true},recentMovements:[]};world.revision=worldContextRevision(world)
  const input={jobId:randomUUID(),attemptId:randomUUID(),accountId:id,kind:'feed_reaction',aiAuthorizationVersion:1,account:{accountId:id,storyStorage:{allowed:true,authorizationVersion:1,privateFeedAllowed:true},aiTextProcessing:{allowed:true,authorizationVersion:1,privateFeedProcessingAllowed:true}},person:{id:personId,accountId:id,version:1,story:prompt},memory:{id:randomUUID(),accountId:id,personId,body:prompt},world,comment:{id:randomUUID(),text:prompt},signal:new AbortController().signal}
  await assert.rejects(provider.generate(input),{code:'MODEL_REQUEST_FAILED',retryable:true})
  assert.deepEqual(logs,[['Social model request failed.',{type:'AI_APICallError',statusCode:400}]])
  const encoded=JSON.stringify(logs);for(const sensitive of [token,prompt,message,'https://','authorization','requestBodyValues','responseHeaders','responseBody','synthetic_failure'])assert.equal(encoded.includes(sensitive),false)
 }finally{console.error=original;for(const [k,v]of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v}
})
