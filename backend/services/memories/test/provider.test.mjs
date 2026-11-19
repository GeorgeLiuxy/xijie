import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {test} from 'node:test'
import {createSuggestionProvider} from '../dist/provider.js'
test('structured memory SDK adapter separates user evidence and AI context, bounds work and requires explicit local permission',async t=>{
 const names=['MODEL_BASE_URL','MODEL_NAME','MODEL_API_KEY','MODEL_EXECUTION_ENABLED','MODEL_ALLOWED_ACCOUNT_IDS','NODE_ENV'],previous=new Map(names.map(name=>[name,process.env[name]]));t.after(()=>{for(const [name,value]of previous)value===undefined?delete process.env[name]:process.env[name]=value})
 const accountId=randomUUID(),parentId=randomUUID(),sourceId=randomUUID(),personId=randomUUID();process.env.MODEL_EXECUTION_ENABLED='true';process.env.NODE_ENV='test';process.env.MODEL_BASE_URL='https://api.openai.com/v1';process.env.MODEL_NAME='gpt-6-luna';process.env.MODEL_API_KEY='synthetic-key-not-a-real-credential';process.env.MODEL_ALLOWED_ACCOUNT_IDS=accountId
 const input={accountId,jobId:randomUUID(),attemptId:randomUUID(),aiAuthorizationVersion:1,signal:new AbortController().signal,snapshot:{account:{accountId,aiTextProcessing:{allowed:true,authorizationVersion:1}},person:{displayName:'小远',relationship:'挚友',story:'用户提供的合成故事。'},context:{messages:[{id:parentId,author:{kind:'self'},text:'毕业那年夏天，我们在河边散步。'},{id:sourceId,author:{kind:'persona'},text:'AI的辅助回应，不可当作事实依据。'}]}}}
 let calls=0,result={kind:'suggestion',title:'那年夏天',body:'毕业那年夏天，我们在河边散步。'}
 const provider=createSuggestionProvider({fetch:async(url,request)=>{
  calls++;assert.equal(String(url),'https://api.openai.com/v1/chat/completions');assert.equal(request.redirect,'error');const body=JSON.parse(request.body)
  assert.equal(body.max_tokens,undefined);assert.equal(body.max_completion_tokens,1600);assert.equal(body.reasoning_effort,'none');assert.equal(body.store,false);assert.equal(body.response_format.type,'json_schema')
  const evidence=JSON.parse(body.messages.find(message=>message.role==='user').content);assert.equal(evidence.userMessage,input.snapshot.context.messages[0].text);assert.equal(evidence.aiReplyForContextOnly,input.snapshot.context.messages[1].text);assert.ok(!JSON.stringify(body).includes(process.env.MODEL_API_KEY))
  return new Response(JSON.stringify({id:'synthetic-completion',object:'chat.completion',created:1,model:'gpt-6-luna',choices:[{index:0,message:{role:'assistant',content:JSON.stringify(result)},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}),{headers:{'Content-Type':'application/json'}})
 }})
 assert.deepEqual(await provider.generate(input),result);assert.equal(calls,1)
 for(const grant of [undefined,{allowed:false,authorizationVersion:2},{allowed:true,authorizationVersion:3},{allowed:true,authorizationVersion:0},{allowed:'true',authorizationVersion:1}]){
  const denied=structuredClone({...input,signal:undefined});denied.signal=input.signal;denied.snapshot.account.aiTextProcessing=grant
  await assert.rejects(provider.generate(denied),{code:'AI_PERMISSION_REQUIRED'});assert.equal(calls,1)
 }
 await assert.rejects(provider.generate({...input,aiAuthorizationVersion:0}),{code:'AI_PERMISSION_REQUIRED'});assert.equal(calls,1)
 await assert.rejects(provider.generate({...input,accountId:randomUUID()}),{code:'AI_PERMISSION_REQUIRED'});assert.equal(calls,1)
 result={kind:'insufficient_evidence',title:'',body:''};assert.deepEqual(await provider.generate(input),{kind:'insufficient_evidence'})
 process.env.MODEL_ALLOWED_ACCOUNT_IDS='';await assert.rejects(createSuggestionProvider({fetch:async()=>{throw new Error('Should never send')}}).generate(input),{code:'AI_PERMISSION_REQUIRED'});assert.equal(calls,2)
 process.env.MODEL_ALLOWED_ACCOUNT_IDS=accountId;process.env.NODE_ENV='production';await assert.rejects(createSuggestionProvider().generate(input),{code:'MODEL_NOT_CONFIGURED'})
 delete process.env.MODEL_API_KEY;await assert.rejects(createSuggestionProvider().generate(input),{code:'MODEL_NOT_CONFIGURED'})
})
