import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createLetterGenerationProvider,letterOutput} from '../dist/letter-provider.js'
import {worldContextRevision} from '../dist/virtual-world.js'

test('real SDK letter transport uses only the independent purpose and whitelisted letter/profile/world fields',async t=>{
 const names=['MODEL_BASE_URL','MODEL_NAME','MODEL_API_KEY','MODEL_EXECUTION_ENABLED','MODEL_ALLOWED_ACCOUNT_IDS','NODE_ENV'],prior=new Map(names.map(n=>[n,process.env[n]]));t.after(()=>{for(const[n,v]of prior)v===undefined?delete process.env[n]:process.env[n]=v})
 const accountId=randomUUID(),person={id:randomUUID(),accountId,displayName:'Synthetic friend',relationship:'friend',story:'A fictional profile',worldId:randomUUID(),worldVersion:1,version:1,accessVersion:1,status:'active',photos:['PHOTO_SENTINEL'],memory:'MEMORY_SENTINEL'}
 const w={accountId,personId:person.id,personVersion:1,worldVersion:1,reality:'virtual',branch:'main',currentWorld:{id:person.worldId,code:'courtyard',displayName:'Synthetic courtyard',catalogVersion:1,enabled:true},recentMovements:[]},world={...w,revision:worldContextRevision(w)}
 const input={accountId,jobId:randomUUID(),attemptId:randomUUID(),letterReplies:{allowed:true,authorizationVersion:1},authorizationVersion:1,letter:{id:randomUUID(),body:'本封合成原信。',version:1},person,virtualWorld:world,signal:new AbortController().signal,chat:'CHAT_SENTINEL',otherLetters:['OTHER_LETTER_SENTINEL']}
 Object.assign(process.env,{MODEL_EXECUTION_ENABLED:'true',NODE_ENV:'test',MODEL_BASE_URL:'https://api.openai.com/v1',MODEL_NAME:'gpt-6-luna',MODEL_API_KEY:'synthetic-secret',MODEL_ALLOWED_ACCOUNT_IDS:accountId})
 let calls=0,text='本封合成回信。'
 const provider=createLetterGenerationProvider({fetch:async(url,options)=>{calls++;assert.equal(String(url),'https://api.openai.com/v1/chat/completions');assert.equal(options.redirect,'error');const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.max_completion_tokens,3000);assert.equal(body.max_tokens,undefined);assert.equal(body.reasoning_effort,'none');assert.equal(body.messages.at(-1).content,input.letter.body);for(const privateField of ['PHOTO_SENTINEL','MEMORY_SENTINEL','CHAT_SENTINEL','OTHER_LETTER_SENTINEL',accountId,input.jobId,input.attemptId,'synthetic-secret'])assert.equal(options.body.includes(privateField),false,privateField);return new Response(JSON.stringify({id:'fixture-response',object:'chat.completion',created:1,model:'fixture-model',choices:[{index:0,message:{role:'assistant',content:text},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}})}})
 for(const permission of [undefined,{allowed:false,authorizationVersion:1},{allowed:true,authorizationVersion:0},{allowed:true,authorizationVersion:2}])await assert.rejects(provider.generate({...input,letterReplies:permission,aiTextProcessing:{allowed:true,authorizationVersion:1}}),{code:'LETTER_REPLY_PERMISSION_REQUIRED'})
 assert.equal(calls,0)
 assert.deepEqual(await provider.generate(input),{text,provenance:{provider:'openai',model:'fixture-model',responseId:'fixture-response',promptVersion:'person-letter-replies-v1'}})
 for(const invalid of [' ','x'.repeat(4001),'bad\0']){text=invalid;await assert.rejects(provider.generate(input),{code:'MODEL_INVALID_OUTPUT'})}
 assert.throws(()=>letterOutput('\ud800'),{code:'MODEL_INVALID_OUTPUT'})
 process.env.MODEL_ALLOWED_ACCOUNT_IDS='';await assert.rejects(createLetterGenerationProvider().generate(input),{code:'LETTER_REPLY_PERMISSION_REQUIRED'})
 process.env.MODEL_ALLOWED_ACCOUNT_IDS=accountId;process.env.MODEL_BASE_URL='https://other-provider.example/v1';await assert.rejects(createLetterGenerationProvider().generate(input),{code:'LETTER_REPLY_PERMISSION_REQUIRED'})
 assert.equal(calls,4)
})
