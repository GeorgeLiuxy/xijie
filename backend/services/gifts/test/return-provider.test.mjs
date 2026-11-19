import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { createReturnGenerationProvider } from '../dist/return-provider.js'

const names=['MODEL_BASE_URL','MODEL_NAME','MODEL_API_KEY','MODEL_EXECUTION_ENABLED','MODEL_ALLOWED_ACCOUNT_IDS','GIFTS_AI_ENABLED','NODE_ENV']
function fixture(t){
 const previous=new Map(names.map(k=>[k,process.env[k]]));t.after(()=>{for(const[k,v]of previous)v===undefined?delete process.env[k]:process.env[k]=v})
 const gift={id:'flower',name:'A flower',outcome:'A fictional keepsake',available:true,effect:'keepsake',audience:['person'],version:1}
 const input={accountId:randomUUID(),jobId:randomUUID(),attemptId:randomUUID(),authorizationVersion:2,giftReturns:{allowed:true,authorizationVersion:2},sourceDelivery:{id:randomUUID(),giftSnapshot:gift,quantity:1,note:'Synthetic note'},person:{id:randomUUID(),displayName:'Synthetic person',relationship:'Fictional friend',story:'Invented fixture only',worldId:randomUUID(),version:1,worldVersion:1,accessVersion:1,photo:'NEVER_SEND_PHOTO'},allowedGifts:[gift],signal:new AbortController().signal}
 for(const n of names)delete process.env[n]
 Object.assign(process.env,{MODEL_EXECUTION_ENABLED:'true',NODE_ENV:'test',MODEL_BASE_URL:'https://api.openai.com/v1',MODEL_NAME:'gpt-6-luna',MODEL_API_KEY:'synthetic-only-key',MODEL_ALLOWED_ACCOUNT_IDS:input.accountId,GIFTS_AI_ENABLED:'true'})
 return input
}
test('return provider requires its own exact purpose, explicit sandbox switch and authorized OpenAI endpoint before transmission',async t=>{
 const input=fixture(t);let calls=0
 const options={async fetch(){calls++;throw Error('Unexpected transmission')}}
 for(const giftReturns of [undefined,{allowed:false,authorizationVersion:2},{allowed:true,authorizationVersion:1},{allowed:true,authorizationVersion:'2'}])await assert.rejects(createReturnGenerationProvider(options).generate({...input,giftReturns}),{code:'GIFT_RETURN_PERMISSION_REQUIRED'})
 delete process.env.GIFTS_AI_ENABLED;await assert.rejects(createReturnGenerationProvider(options).generate(input),{code:'GIFTS_AI_DISABLED'});process.env.GIFTS_AI_ENABLED='true'
 delete process.env.MODEL_ALLOWED_ACCOUNT_IDS;await assert.rejects(createReturnGenerationProvider(options).generate(input),{code:'GIFT_RETURN_PERMISSION_REQUIRED'});process.env.MODEL_ALLOWED_ACCOUNT_IDS=input.accountId
 for(const url of ['https://other.invalid/v1','http://127.0.0.1:12345/v1','https://api.openai.com/v2','https://api.openai.com:8443/v1']){process.env.MODEL_BASE_URL=url;await assert.rejects(createReturnGenerationProvider(options).generate(input),{code:'GIFT_RETURN_PERMISSION_REQUIRED'})}
 process.env.MODEL_BASE_URL='https://api.openai.com/v1';process.env.NODE_ENV='production';await assert.rejects(createReturnGenerationProvider(options).generate(input),{code:'MODEL_NOT_CONFIGURED'});assert.equal(calls,0)
})
test('real SDK transport uses minimal context and validates none, catalog choice, Unicode bounds and provenance without template fallback',async t=>{
 const input=fixture(t);let content='{"decision":"none"}',calls=0,status=200
 const provider=createReturnGenerationProvider({async fetch(url,options){calls++;assert.equal(String(url),'https://api.openai.com/v1/chat/completions');assert.equal(options.redirect,'error');const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.max_tokens,undefined);assert.equal(body.max_completion_tokens,1000);assert.equal(body.reasoning_effort,'none');assert.equal(options.body.includes('NEVER_SEND_PHOTO'),false);assert.equal(options.body.includes(input.accountId),false);assert.equal(options.body.includes('synthetic-only-key'),false);assert.deepEqual(Object.keys(JSON.parse(body.messages.at(-1).content)).sort(),['allowedGifts','person','sourceGift']);return Response.json({id:'synthetic-response',object:'chat.completion',created:1,model:'actual-model',choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}]},{status})}})
 const none=await provider.generate(input);assert.equal(none.decision,'none');assert.deepEqual(none.provenance,{provider:'openai',model:'actual-model',responseId:'synthetic-response',promptVersion:'person-gift-returns-v1'});assert.equal('giftId'in none,false)
 content=JSON.stringify({decision:'gift',giftId:'flower',note:'🌸'.repeat(120)});assert.equal((await provider.generate(input)).note,'🌸'.repeat(120))
 for(const output of [{decision:'gift',giftId:'not-allowed',note:'x'},{decision:'gift',giftId:'flower',note:'🌸'.repeat(121)},{decision:'gift',giftId:'flower',note:'\ud800'},{decision:'gift',giftId:'flower',note:''},{decision:'gift',giftId:'flower',note:'x',quantity:99},{decision:'none',note:'x'}]){content=JSON.stringify(output);await assert.rejects(provider.generate(input),{code:'MODEL_INVALID_OUTPUT'})}
 for(const output of ['', '```json\n{"decision":"none"}\n```']){content=output;await assert.rejects(provider.generate(input),{code:'MODEL_INVALID_OUTPUT'})}
 status=503;const before=calls;await assert.rejects(provider.generate(input),{code:'MODEL_REQUEST_FAILED'});assert.equal(calls,before+1)
})
