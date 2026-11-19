import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {test} from 'node:test'
import {createAutomaticMemoryProvider} from '../dist/automatic-provider.js'

test('automatic extraction SDK adapter preserves evidence identity, bounded work and exact independent AI permission',async t=>{
 const names=['MODEL_BASE_URL','MODEL_NAME','MODEL_API_KEY','MODEL_EXECUTION_ENABLED','MODEL_ALLOWED_ACCOUNT_IDS','NODE_ENV'],previous=new Map(names.map(name=>[name,process.env[name]]));t.after(()=>{for(const [name,value]of previous)value===undefined?delete process.env[name]:process.env[name]=value})
 const accountId=randomUUID(),personId=randomUUID();process.env.MODEL_EXECUTION_ENABLED='true';process.env.NODE_ENV='test';process.env.MODEL_BASE_URL='https://api.openai.com/v1';process.env.MODEL_NAME='gpt-6-luna';process.env.MODEL_API_KEY='synthetic-key-not-a-real-credential';process.env.MODEL_ALLOWED_ACCOUNT_IDS=accountId
 const input={accountId,jobId:randomUUID(),attemptId:randomUUID(),aiAuthorizationVersion:1,signal:new AbortController().signal,snapshot:{account:{accountId,aiTextProcessing:{allowed:true,authorizationVersion:1}},person:{id:personId,accountId},source:{kind:'message',id:randomUUID(),version:1,createdAt:'2026-11-12T01:00:00.000Z',sequence:'9007199254740993',body:'我喜欢在河边散步。',aiAuthorizationVersion:1,contextRefs:[]},context:[{id:randomUUID(),version:1,authorKind:'persona',text:'AI说的话只能作语境。',createdAt:'2026-11-12T00:59:00.000Z'}],previousEntries:[]}}
 input.snapshot.account.aiTextProcessing.automaticMemoryAllowed=true
 let calls=0,mode='success'
 const result={facts:[{body:'用户喜欢在河边散步。',topic:'散步',timeDescription:'',evidence:'我喜欢在河边散步。',supersedes:[]}]}
 const provider=createAutomaticMemoryProvider({fetch:async(url,request)=>{
  calls++;if(mode==='failure')throw new Error('Synthetic provider unavailable')
  assert.equal(String(url),'https://api.openai.com/v1/chat/completions');assert.equal(request.redirect,'error');const body=JSON.parse(request.body)
  assert.equal(body.max_tokens,undefined);assert.equal(body.max_completion_tokens,2400);assert.equal(body.reasoning_effort,'none');assert.equal(body.store,false);assert.equal(body.response_format.type,'json_schema')
  const evidence=JSON.parse(body.messages.find(message=>message.role==='user').content)
  assert.equal(evidence.currentUserProvidedSource.body,input.snapshot.source.body);assert.deepEqual(evidence.contextOnly,input.snapshot.context);assert.deepEqual(evidence.existingEntries,[])
  assert.ok(!JSON.stringify(body).includes(process.env.MODEL_API_KEY))
  return new Response(JSON.stringify({id:'synthetic-completion',object:'chat.completion',created:1,model:'gpt-6-luna',choices:[{index:0,message:{role:'assistant',content:JSON.stringify(result)},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}),{headers:{'Content-Type':'application/json'}})
 }})
 assert.deepEqual(await provider.generate(input),result);assert.equal(calls,1)
 for(const grant of [undefined,{allowed:false,authorizationVersion:2},{allowed:true,authorizationVersion:3},{allowed:true,authorizationVersion:0},{allowed:true,authorizationVersion:1},{allowed:true,authorizationVersion:1,automaticMemoryAllowed:false}]){
  const denied=structuredClone({...input,signal:undefined});denied.signal=input.signal;denied.snapshot.account.aiTextProcessing=grant
  await assert.rejects(provider.generate(denied),{code:'AI_PERMISSION_REQUIRED'});assert.equal(calls,1)
 }
 const oldSource=structuredClone({...input,signal:undefined});oldSource.signal=input.signal;oldSource.snapshot.source.aiAuthorizationVersion=0
 await assert.rejects(provider.generate(oldSource),{code:'AI_PERMISSION_REQUIRED'});assert.equal(calls,1)
 const wrongPerson=structuredClone({...input,signal:undefined});wrongPerson.signal=input.signal;wrongPerson.snapshot.person.accountId=randomUUID()
 await assert.rejects(provider.generate(wrongPerson),{code:'AI_PERMISSION_REQUIRED'});assert.equal(calls,1)
 mode='failure';await assert.rejects(provider.generate(input),{code:'MODEL_REQUEST_FAILED'});assert.equal(calls,2,'SDK does not retry a failed paid request')
 process.env.NODE_ENV='production';await assert.rejects(provider.generate(input),{code:'AI_PERMISSION_REQUIRED'});assert.equal(calls,2)
})
