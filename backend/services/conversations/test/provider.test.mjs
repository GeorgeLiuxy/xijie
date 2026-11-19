import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { createGenerationProvider } from '../dist/provider.js'

test('SDK requires independent AI consent and the authorized provider before transmitting text', async t => {
  const names = ['MODEL_BASE_URL','MODEL_NAME','MODEL_API_KEY','MODEL_EXECUTION_ENABLED','MODEL_ALLOWED_ACCOUNT_IDS','NODE_ENV']
  const previous = new Map(names.map(name => [name,process.env[name]]))
  t.after(() => { for (const [name,value] of previous) value === undefined ? delete process.env[name] : process.env[name] = value })
  const input = {
    jobId:randomUUID(), attemptId:randomUUID(), accountId:randomUUID(),
    aiTextProcessing:{allowed:true,authorizationVersion:1},
    person:{id:randomUUID(),displayName:'Synthetic fixture',relationship:'fictional',story:'说话常停顿一下再回应。',conversationTone:'quiet',personality:['用短句'],calledMe:'小禾',catchphrase:'慢慢来'},
    messages:[{author:{kind:'self'},text:'Synthetic test message'}], signal:new AbortController().signal,
  }
  for (const name of names) delete process.env[name]
  await assert.rejects(createGenerationProvider().generate({...input,aiTextProcessing:undefined}),{code:'AI_PERMISSION_REQUIRED'})
  await assert.rejects(createGenerationProvider().generate(input),{code:'MODEL_NOT_CONFIGURED'})
  Object.assign(process.env,{MODEL_EXECUTION_ENABLED:'true',NODE_ENV:'test',MODEL_BASE_URL:'https://api.openai.com/v1',MODEL_NAME:'gpt-6-luna',MODEL_API_KEY:'synthetic-key'})
  let calls=0
  const options={async fetch(url,options){
    calls++
    assert.equal(options.redirect,'error')
    assert.equal(String(url),'https://api.openai.com/v1/chat/completions')
    const body=JSON.parse(options.body)
    assert.equal(body.max_tokens,undefined)
    assert.equal(body.max_completion_tokens,1000)
    assert.equal(body.store,false)
    assert.equal(body.reasoning_effort,'none')
    assert.equal(options.body.includes('synthetic-key'),false)
    const instructions=body.messages[0].content
    const profile=JSON.parse(instructions.slice(instructions.indexOf('{"name"')))
    assert.equal(profile.userResponsePreferences.conversationTone,input.person.conversationTone)
    assert.deepEqual(profile.personality,input.person.personality)
    assert.equal(profile.story,input.person.story)
    assert.equal(profile.calledMe,input.person.calledMe)
    assert.equal(profile.catchphrase,input.person.catchphrase)
    assert.match(instructions,/优先采用用户在人物设置中明确选择的 conversationTone/u)
    assert.match(instructions,/只在合适时自然使用称呼和口头禅/u)
    assert.match(instructions,/不从年龄、照片或关系套用性格/u)
    assert.equal(body.messages.at(-1).content,'Synthetic test message')
    return new Response(JSON.stringify({id:'intercepted-sdk-fixture',object:'chat.completion',created:1,model:body.model,
      choices:[{index:0,message:{role:'assistant',content:'Intercepted request fixture.'},finish_reason:'stop'}]}),
      {status:200,headers:{'Content-Type':'application/json'}})
  }}
  await assert.rejects(createGenerationProvider(options).generate(input),{code:'MODEL_EXECUTION_UNAVAILABLE',retryable:false,blocked:true})
  process.env.MODEL_ALLOWED_ACCOUNT_IDS=input.accountId
  process.env.MODEL_EXECUTION_ENABLED='false'
  await assert.rejects(createGenerationProvider(options).generate(input),{code:'MODEL_EXECUTION_UNAVAILABLE',retryable:false,blocked:true})
  process.env.MODEL_EXECUTION_ENABLED='true'
  for (const permission of [undefined,{allowed:false,authorizationVersion:2},{allowed:1,authorizationVersion:1},{allowed:true,authorizationVersion:0},{allowed:true,authorizationVersion:'1'}, {allowed:true,authorizationVersion:NaN}]) {
    await assert.rejects(createGenerationProvider(options).generate({...input,aiTextProcessing:permission}),{code:'AI_PERMISSION_REQUIRED'})
  }
  assert.equal(calls,0)
  assert.deepEqual(await createGenerationProvider(options).generate(input),{text:'Intercepted request fixture.'})
  assert.equal(calls,1)
  process.env.MODEL_BASE_URL='https://api.openai.com/v1/'
  assert.deepEqual(await createGenerationProvider(options).generate(input),{text:'Intercepted request fixture.'})
  for (const url of ['https://another-provider.example/v1','http://127.0.0.1:12345/v1','https://api.openai.com/v2','https://api.openai.com:8443/v1']) {
    process.env.MODEL_BASE_URL=url
    await assert.rejects(createGenerationProvider(options).generate(input),{code:'MODEL_EXECUTION_UNAVAILABLE'})
  }
  assert.equal(calls,2)
  process.env.NODE_ENV='production'
  process.env.MODEL_BASE_URL='https://api.openai.com/v1'
  await assert.rejects(createGenerationProvider(options).generate(input),{code:'MODEL_NOT_CONFIGURED'})
  assert.equal(calls,2)
})

test('the real SDK transport meters reported usage without counting omitted cache or prompt quantities as zero', async t => {
  const accountId=randomUUID()
  const env={NODE_ENV:'development',MODEL_EXECUTION_ENABLED:'true',MODEL_ALLOWED_ACCOUNT_IDS:accountId,MODEL_BASE_URL:'https://api.openai.com/v1',MODEL_NAME:'gpt-5-mini',MODEL_API_KEY:'synthetic-key',MODEL_API_KEY_FILE:undefined,XIJIE_IDENTITY_URL:'http://127.0.0.1:2222',XIJIE_CONVERSATIONS_SERVICE_TOKEN:'1'.repeat(64)}
  for(const [key,value] of Object.entries(env)){
    const previous=process.env[key]
    if(value===undefined)delete process.env[key];else process.env[key]=value
    t.after(()=>{if(previous===undefined)delete process.env[key];else process.env[key]=previous})
  }
  const finishes=[]
  t.mock.method(globalThis,'fetch',async(url,request)=>{
    assert.equal(url.origin,'http://127.0.0.1:2222')
    const body=JSON.parse(request.body)
    if(url.pathname.endsWith('/claim'))return Response.json({data:{id:body.attemptId}})
    finishes.push(body)
    return Response.json({data:{allowed:body.succeeded}})
  })
  let usage={prompt_tokens:100,completion_tokens:10,prompt_tokens_details:{cached_tokens:40}},providerFailure=false
  const provider=createGenerationProvider({fetch:async url=>{
    assert.equal(String(url),'https://api.openai.com/v1/chat/completions')
    if(providerFailure)return Response.json({error:{message:'Private synthetic failure'}},{status:503})
    return Response.json({id:'synthetic-provider-response',object:'chat.completion',created:1,model:'gpt-5-mini-2025-08-07',
      choices:[{index:0,message:{role:'assistant',content:'Synthetic reply.'},finish_reason:'stop'}],usage})
  }})
  const input={
    accountId,jobId:randomUUID(),attemptId:randomUUID(),signal:new AbortController().signal,
    aiTextProcessing:{allowed:true,authorizationVersion:1},
    person:{id:randomUUID(),displayName:'Synthetic fixture',relationship:'fictional',story:'Invented test data only.'},
    messages:[{author:{kind:'self'},text:'Synthetic test message'}],
  }
  await provider.generate(input)
  usage={completion_tokens:0}
  await provider.generate({...input,attemptId:randomUUID()})
  providerFailure=true
  await assert.rejects(provider.generate({...input,attemptId:randomUUID()}),{code:'MODEL_REQUEST_FAILED'})
  assert.deepEqual(finishes.map(({succeeded,usage})=>[succeeded,usage.state,usage.resolvedModel,usage.inputTokens,usage.outputTokens,usage.cachedInputTokens]),[
    [true,'returned','gpt-5-mini-2025-08-07',100,10,40],
    [true,'returned','gpt-5-mini-2025-08-07',null,0,null],
    [false,'failed',null,null,null,null],
  ])
  assert.doesNotMatch(JSON.stringify(finishes),/Synthetic reply|Private synthetic failure|synthetic-provider-response|synthetic-key/)
})
