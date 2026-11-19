import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createPhotoGenerationProvider,photoOutput} from '../dist/photo-provider.js'
import {worldContextRevision} from '../dist/virtual-world.js'

test('real SDK photo transport sends one normalized image and whitelisted profile/world without old text or private memory',async t=>{
 const names=['MODEL_BASE_URL','MODEL_NAME','MODEL_API_KEY','MODEL_EXECUTION_ENABLED','MODEL_ALLOWED_ACCOUNT_IDS','NODE_ENV'],prior=new Map(names.map(n=>[n,process.env[n]]));t.after(()=>{for(const[n,v]of prior)v===undefined?delete process.env[n]:process.env[n]=v})
 const accountId=randomUUID(),person={id:randomUUID(),accountId,displayName:'Synthetic friend',relationship:'friend',story:'A fictional profile',worldId:randomUUID(),worldVersion:1,version:1,accessVersion:1,status:'active',photos:['OTHER_PHOTO_SENTINEL'],memory:'MEMORY_SENTINEL'}
 const w={accountId,personId:person.id,personVersion:1,worldVersion:1,reality:'virtual',branch:'main',currentWorld:{id:person.worldId,code:'courtyard',displayName:'Synthetic courtyard',catalogVersion:1,enabled:true},recentMovements:[]},world={...w,revision:worldContextRevision(w)},image=Buffer.from('RIFF\x04\0\0\0WEBP')
 const input={accountId,jobId:randomUUID(),attemptId:randomUUID(),authorizationVersion:3,chatImageReplies:{allowed:true,authorizationVersion:3},photoAuthorizationVersion:2,chatPhotoStorage:{allowed:true,authorizationVersion:2},storyAuthorizationVersion:1,storyStorage:{allowed:true,authorizationVersion:1},image,person,virtualWorld:world,signal:new AbortController().signal,messages:['CHAT_SENTINEL'],memories:['TREASURE_SENTINEL'],caption:'DRAFT_SENTINEL'}
 Object.assign(process.env,{MODEL_EXECUTION_ENABLED:'true',NODE_ENV:'test',MODEL_BASE_URL:'https://api.openai.com/v1',MODEL_NAME:'gpt-6-luna',MODEL_API_KEY:'synthetic-secret',MODEL_ALLOWED_ACCOUNT_IDS:accountId})
 let calls=0,text='图中有一只合成纸船。'
 const provider=createPhotoGenerationProvider({fetch:async(url,options)=>{calls++;assert.equal(String(url),'https://api.openai.com/v1/chat/completions');assert.equal(options.redirect,'error');const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.max_completion_tokens,3000);assert.equal(body.max_tokens,undefined);assert.equal(body.reasoning_effort,'none');assert.deepEqual(body.messages.at(-1).content,[{type:'image_url',image_url:{url:'data:image/webp;base64,'+image.toString('base64')}}]);for(const forbidden of ['OTHER_PHOTO_SENTINEL','MEMORY_SENTINEL','CHAT_SENTINEL','TREASURE_SENTINEL','DRAFT_SENTINEL',accountId,input.jobId,input.attemptId,person.id,person.worldId,'synthetic-secret'])assert.equal(options.body.includes(forbidden),false,forbidden);return new Response(JSON.stringify({id:'fixture-response',object:'chat.completion',created:1,model:'fixture-model',choices:[{index:0,message:{role:'assistant',content:text},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}})}})
 for(const field of ['chatImageReplies','chatPhotoStorage','storyStorage'])for(const permission of [undefined,{allowed:false,authorizationVersion:3},{allowed:true,authorizationVersion:99}])await assert.rejects(provider.generate({...input,[field]:permission,aiTextProcessing:{allowed:true,authorizationVersion:1}}),error=>error.blocked)
 assert.equal(calls,0)
 assert.deepEqual(await provider.generate(input),{text,provenance:{provider:'openai',model:'fixture-model',responseId:'fixture-response',promptVersion:'person-chat-image-replies-v1'}})
 for(const invalid of [' ','x'.repeat(4001),'bad\0']){text=invalid;await assert.rejects(provider.generate(input),{code:'MODEL_INVALID_OUTPUT'})}
 assert.throws(()=>photoOutput('\ud800'),{code:'MODEL_INVALID_OUTPUT'})
 await assert.rejects(provider.generate({...input,image:Buffer.from('not normalized')}),{code:'PHOTO_SELECTION_INVALID'})
 process.env.MODEL_ALLOWED_ACCOUNT_IDS='';await assert.rejects(createPhotoGenerationProvider().generate(input),{code:'CHAT_IMAGE_REPLY_PERMISSION_REQUIRED'})
 process.env.MODEL_ALLOWED_ACCOUNT_IDS=accountId;process.env.MODEL_BASE_URL='https://other-provider.example/v1';await assert.rejects(createPhotoGenerationProvider().generate(input),{code:'CHAT_IMAGE_REPLY_PERMISSION_REQUIRED'})
 assert.equal(calls,4)
})

test('photo SDK failure performs one attempt with no hidden HTTP retries',async t=>{
 const names=['MODEL_BASE_URL','MODEL_NAME','MODEL_API_KEY','MODEL_ALLOWED_ACCOUNT_IDS','NODE_ENV'],prior=new Map(names.map(n=>[n,process.env[n]]));t.after(()=>{for(const[n,v]of prior)v===undefined?delete process.env[n]:process.env[n]=v})
 const a=randomUUID(),p={id:randomUUID(),accountId:a,displayName:'Synthetic',relationship:'friend',story:'Synthetic',worldId:randomUUID(),worldVersion:1,version:1,accessVersion:1,status:'active'},w={accountId:a,personId:p.id,personVersion:1,worldVersion:1,reality:'virtual',branch:'main',currentWorld:{id:p.worldId,code:'courtyard',displayName:'Synthetic',catalogVersion:1,enabled:true},recentMovements:[]}
 Object.assign(process.env,{MODEL_EXECUTION_ENABLED:'true',NODE_ENV:'test',MODEL_BASE_URL:'https://api.openai.com/v1',MODEL_NAME:'gpt-6-luna',MODEL_API_KEY:'synthetic-secret',MODEL_ALLOWED_ACCOUNT_IDS:a});let calls=0
 const provider=createPhotoGenerationProvider({fetch:async()=>{calls++;return new Response(JSON.stringify({error:{message:'synthetic failure'}}),{status:503,headers:{'Content-Type':'application/json'}})}}),yes={allowed:true,authorizationVersion:1}
 await assert.rejects(provider.generate({accountId:a,jobId:randomUUID(),attemptId:randomUUID(),authorizationVersion:1,chatImageReplies:yes,photoAuthorizationVersion:1,chatPhotoStorage:yes,storyAuthorizationVersion:1,storyStorage:yes,image:Buffer.from('RIFF\x04\0\0\0WEBP'),person:p,virtualWorld:{...w,revision:worldContextRevision(w)},signal:new AbortController().signal}),{code:'MODEL_REQUEST_FAILED'});assert.equal(calls,1)
})
