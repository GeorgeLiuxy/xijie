import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {Dependencies} from '../dist/dependencies.js'

test('Media prebinding terminal selection rejection is preserved while authorization and unknown conflicts keep the same intent',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original})
 const accountId=randomUUID(),conversationId=randomUUID(),clientMessageId=randomUUID(),mediaId=randomUUID(),dependencies=new Dependencies({mediaOrigin:'http://127.0.0.1:3199',serviceToken:'a'.repeat(64)})
 let code='PHOTO_SELECTION_INVALID',calls=0
 globalThis.fetch=async(url,options)=>{calls++;assert.equal(String(url),`http://127.0.0.1:3199/internal/v1/conversations/${conversationId}/messages/${clientMessageId}/media-bindings`);assert.equal(options.redirect,'error');assert.equal(options.headers['X-Xijie-Account-Id'],accountId);assert.deepEqual(JSON.parse(options.body),{mediaId,version:1});return new Response(JSON.stringify({error:{code}}),{status:409,headers:{'Content-Type':'application/json'}})}
 for(const [sent,expected]of [['PHOTO_SELECTION_INVALID','PHOTO_SELECTION_INVALID'],['MEDIA_BINDING_CONFLICT','PHOTO_SELECTION_INVALID'],['AUTHORIZATION_CHANGED','AUTHORIZATION_CHANGED'],['SOURCE_CHANGED','SOURCE_CHANGED'],['UNKNOWN_FUTURE_CONFLICT','SOURCE_CHANGED']]){code=sent;await assert.rejects(dependencies.photoBind(accountId,conversationId,clientMessageId,mediaId,1),{status:409,code:expected})}
 assert.equal(calls,5)
})
