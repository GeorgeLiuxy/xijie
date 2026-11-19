import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createGatherGenerationProvider,gatherOutput} from '../dist/gather-provider.js'
import {worldContextRevision} from '../dist/virtual-world.js'

function fixture(t){
 const names=['MODEL_BASE_URL','MODEL_NAME','MODEL_API_KEY','MODEL_EXECUTION_ENABLED','MODEL_ALLOWED_ACCOUNT_IDS','NODE_ENV'],prior=new Map(names.map(name=>[name,process.env[name]]))
 t.after(()=>{for(const[name,value]of prior)value===undefined?delete process.env[name]:process.env[name]=value})
 const accountId=randomUUID(),person={id:randomUUID(),accountId,displayName:'Synthetic speaker',relationship:'friend',story:'Current speaker profile',worldId:randomUUID(),worldVersion:2,version:3,accessVersion:1,status:'active',photos:['PHOTO_SENTINEL'],otherPersonStory:'OTHER_PROFILE_SENTINEL'}
 const card={id:person.worldId,code:'courtyard',displayName:'Synthetic courtyard',catalogVersion:1,enabled:true}
 const movement={id:randomUUID(),worldVersion:2,personVersion:3,fromWorld:{...card,id:randomUUID(),code:'tide',displayName:'Synthetic tide'},toWorld:card,occurredAt:'2026-11-14T01:00:00.000Z',recordedAt:'2026-11-14T01:00:00.000Z'}
 const core={accountId,personId:person.id,personVersion:3,worldVersion:2,reality:'virtual',branch:'main',currentWorld:card,recentMovements:[movement]},world={...core,revision:worldContextRevision(core)}
 const conversationId=randomUUID(),otherId=randomUUID(),at='2026-11-14T02:00:00.000Z'
 const message=(sequence,author,text)=>({id:randomUUID(),conversationId,sequence:String(sequence),kind:'text',author,text,createdAt:at,version:1,privateMemory:'SHARED_PRIVATE_BODY_SENTINEL'})
 const messages=[message(1,{kind:'self'},'Earlier shared user text'),message(2,{kind:'persona',personId:otherId,displayName:'Other fictional speaker',aiGenerated:true},'Other speaker shared AI expression'),message(3,{kind:'persona',personId:person.id,displayName:person.displayName,aiGenerated:true},'Current speaker earlier AI expression'),message(4,{kind:'self'},'本轮合成用户发言。')]
 const memories=[{id:randomUUID(),personId:person.id,version:1,title:'Own treasured original',body:'OWN_TREASURE_TEXT',unrelated:'OTHER_TREASURE_SENTINEL'}]
 const automaticMemories=[{id:randomUUID(),personId:person.id,version:1,body:'OWN_AUTOMATIC_TEXT',topic:'Preference',timeDescription:'Earlier',evidence:'Own user words',sourceKind:'message',sourceId:randomUUID(),sourceVersion:1,sourceAuthor:'self',reality:'user_reported',sourceCreatedAt:at,sourceSequence:'1',sources:[{id:randomUUID(),version:1}],other:'OTHER_AUTOMATIC_SENTINEL'}]
 const input={accountId,jobId:randomUUID(),attemptId:randomUUID(),authorizationVersion:4,gatherReplies:{allowed:true,authorizationVersion:4},aiTextProcessing:{allowed:true,authorizationVersion:7},memoryAiAuthorizationVersion:7,person,virtualWorld:world,messages,memories,automaticMemories,signal:new AbortController().signal,rawChat:'RAW_CHAT_SENTINEL',letter:'LETTER_SENTINEL'}
 Object.assign(process.env,{MODEL_EXECUTION_ENABLED:'true',NODE_ENV:'test',MODEL_BASE_URL:'https://api.openai.com/v1',MODEL_NAME:'gpt-6-luna',MODEL_API_KEY:'synthetic-key',MODEL_ALLOWED_ACCOUNT_IDS:accountId})
 return {input,otherId}
}
const response=(text='实际拦截测试回应。')=>new Response(JSON.stringify({id:'synthetic-response',object:'chat.completion',created:1,model:'synthetic-model',choices:[{index:0,message:{role:'assistant',content:text},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}})

test('gather SDK transport keeps speaker identity, private memory owner and whitelisted text without internal identifiers',async t=>{
 const {input,otherId}=fixture(t);let calls=0
 const provider=createGatherGenerationProvider({fetch:async(url,options)=>{
  calls++;assert.equal(String(url),'https://api.openai.com/v1/chat/completions');assert.equal(options.redirect,'error')
  const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.max_tokens,undefined);assert.equal(body.max_completion_tokens,3000);assert.equal(body.reasoning_effort,'none')
  const instructions=body.messages[0].content,context=JSON.parse(instructions.slice(instructions.indexOf('{"profile"')))
  assert.equal(context.profile.name,input.person.displayName)
  assert.deepEqual(context.confirmedMemories,[{title:'Own treasured original',body:'OWN_TREASURE_TEXT'}])
  assert.equal(context.automaticMemories[0].body,'OWN_AUTOMATIC_TEXT');assert.equal(context.automaticMemories[0].sourceAuthor,'self')
  assert.deepEqual(context.virtualWorld.currentWorld,{code:'courtyard',displayName:'Synthetic courtyard'})
  assert.deepEqual(Object.keys(context.virtualWorld.recentMovements[0]).sort(),['fromWorld','occurredAt','toWorld'])
  assert.equal(body.messages.length,2);assert.equal(body.messages.at(-1).role,'user')
  const transcript=JSON.parse(body.messages.at(-1).content)
  assert.equal(transcript.currentMessage.text,input.messages.at(-1).text)
  assert.deepEqual(transcript.sharedHistory[1].author,{kind:'persona',displayName:'Other fictional speaker',aiGenerated:true,isCurrentSpeaker:false})
  assert.equal(transcript.sharedHistory[2].author.isCurrentSpeaker,true)
  assert.equal(transcript.sharedHistory[0].author.kind,'self')
  assert(!body.messages.some(message=>message.role==='assistant'))
  for(const forbidden of ['PHOTO_SENTINEL','OTHER_PROFILE_SENTINEL','OTHER_TREASURE_SENTINEL','OTHER_AUTOMATIC_SENTINEL','SHARED_PRIVATE_BODY_SENTINEL','RAW_CHAT_SENTINEL','LETTER_SENTINEL','synthetic-key',input.accountId,input.person.id,otherId,input.jobId,input.attemptId,input.person.worldId,input.virtualWorld.recentMovements[0].id,input.virtualWorld.recentMovements[0].fromWorld.id,...input.messages.map(message=>message.id),...input.memories.map(memory=>memory.id),...input.automaticMemories.flatMap(memory=>[memory.id,memory.sourceId,...memory.sources.map(source=>source.id)])])assert.equal(options.body.includes(forbidden),false)
  return response()
 }})
 assert.deepEqual(await provider.generate(input),{text:'实际拦截测试回应。',provenance:{provider:'openai',model:'synthetic-model',responseId:'synthetic-response',promptVersion:'person-gather-replies-v1'}})
 assert.equal(calls,1)
})

test('gather and optional private-memory permissions and owner checks reject before any model transmission',async t=>{
 const {input,otherId}=fixture(t);let calls=0
 const provider=createGatherGenerationProvider({fetch:async()=>{calls++;return response()}})
 for(const permission of [undefined,{allowed:false,authorizationVersion:4},{allowed:1,authorizationVersion:4},{allowed:true,authorizationVersion:0},{allowed:true,authorizationVersion:'4'},{allowed:true,authorizationVersion:3}])await assert.rejects(provider.generate({...input,gatherReplies:permission}),{code:'GATHER_REPLY_PERMISSION_REQUIRED'})
 await assert.rejects(provider.generate({...input,authorizationVersion:0}),{code:'GATHER_REPLY_PERMISSION_REQUIRED'})
 for(const permission of [undefined,{allowed:false,authorizationVersion:7},{allowed:true,authorizationVersion:0},{allowed:true,authorizationVersion:'7'},{allowed:true,authorizationVersion:8}])await assert.rejects(provider.generate({...input,aiTextProcessing:permission}),{code:'AI_PERMISSION_REQUIRED'})
 for(const captured of [undefined,0,8,NaN])await assert.rejects(provider.generate({...input,memoryAiAuthorizationVersion:captured}),{code:'AI_PERMISSION_REQUIRED'})
 for(const field of ['memories','automaticMemories']){
  for(const owner of [undefined,otherId])await assert.rejects(provider.generate({...input,[field]:input[field].map(memory=>({...memory,personId:owner}))}),{code:'MEMORY_SOURCE_CHANGED'})
 }
 await assert.rejects(provider.generate({...input,person:{...input.person,accountId:randomUUID()}}),{code:'GATHER_CONTEXT_CHANGED'})
 await assert.rejects(provider.generate({...input,virtualWorld:{...input.virtualWorld,personVersion:2}}),{code:'WORLD_CONTEXT_CHANGED'})
 for(const change of [message=>({...message,kind:'gift'}),message=>({...message,author:{kind:'persona',displayName:'Fake',aiGenerated:false}})])await assert.rejects(provider.generate({...input,messages:[change(input.messages[0]),input.messages.at(-1)]}),{code:'GATHER_CONTEXT_CHANGED'})
 assert.equal(calls,0)
 const plain={...input,memories:[],automaticMemories:[],aiTextProcessing:undefined,memoryAiAuthorizationVersion:undefined}
 assert.equal((await provider.generate(plain)).text,'实际拦截测试回应。');assert.equal(calls,1)
 const unavailableName={...input.messages[1],author:{kind:'persona',displayName:'A former participant',aiGenerated:true}}
 assert.equal((await provider.generate({...plain,messages:[unavailableName,input.messages.at(-1)]})).text,'实际拦截测试回应。');assert.equal(calls,2)
})

test('gather SDK restricts provider and account, makes no SDK retry, and validates actual Unicode output',async t=>{
 const {input}=fixture(t);let calls=0,output='真实生成文本。',status=200
 const options={fetch:async()=>{calls++;return status===200?response(output):new Response(JSON.stringify({error:{message:'synthetic failure'}}),{status,headers:{'Content-Type':'application/json'}})}}
 process.env.MODEL_ALLOWED_ACCOUNT_IDS='';await assert.rejects(createGatherGenerationProvider(options).generate(input),{code:'GATHER_REPLY_PERMISSION_REQUIRED'})
 process.env.MODEL_ALLOWED_ACCOUNT_IDS=input.accountId
 for(const endpoint of ['https://other-provider.example/v1','https://api.openai.com:8443/v1','https://api.openai.com/v2']){process.env.MODEL_BASE_URL=endpoint;await assert.rejects(createGatherGenerationProvider(options).generate(input),{code:'GATHER_REPLY_PERMISSION_REQUIRED'})}
 process.env.MODEL_BASE_URL='http://127.0.0.1:1234/v1';assert.throws(()=>createGatherGenerationProvider(options),/Invalid MODEL_BASE_URL/)
 process.env.MODEL_BASE_URL='https://api.openai.com/v1';process.env.NODE_ENV='production';await assert.rejects(createGatherGenerationProvider(options).generate(input),{code:'MODEL_NOT_CONFIGURED'})
 process.env.MODEL_EXECUTION_ENABLED='true';process.env.NODE_ENV='test';assert.equal(calls,0)
 const provider=createGatherGenerationProvider(options)
 status=500;await assert.rejects(provider.generate(input),{code:'MODEL_REQUEST_FAILED'});assert.equal(calls,1,'maxRetries:0 prevents a second SDK request')
 status=200
 for(const invalid of [' ','x'.repeat(4001),'bad\0']){output=invalid;await assert.rejects(provider.generate(input),{code:'MODEL_INVALID_OUTPUT'})}
 assert.equal(calls,4)
 assert.throws(()=>gatherOutput('\ud800'),{code:'MODEL_INVALID_OUTPUT'})
 assert.equal(gatherOutput('😀'.repeat(4000)), '😀'.repeat(4000))
 output='  实际回应。  ';assert.equal((await provider.generate(input)).text,'实际回应。');assert.equal(calls,5)
})
