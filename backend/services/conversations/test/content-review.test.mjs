import 'reflect-metadata'
import assert from 'node:assert/strict'
import {randomUUID,randomBytes} from 'node:crypto'
import {test} from 'node:test'
import {fixture,text} from './fixture.mjs'
import {ConversationReviewController} from '../dist/content-review.js'
test('trusted review uses real readable message authority, tombstones once, blocks its pending job and hides history/search',async t=>{
 const f=await fixture(t),a=f.account(),b=f.account(),c=(await f.store.ensure(a.id,a.person.id,randomUUID())).conversation,accepted=await f.store.send(a.id,c.id,randomUUID(),text('仅合成举报正文'),randomUUID()),id=accepted.message.id,api=new ConversationReviewController(f.store),token=randomBytes(32).toString('hex'),old=process.env.XIJIE_CONTENT_REVIEW_SERVICE_TOKEN;process.env.XIJIE_CONTENT_REVIEW_SERVICE_TOKEN=token;t.after(()=>{if(old===undefined)delete process.env.XIJIE_CONTENT_REVIEW_SERVICE_TOKEN;else process.env.XIJIE_CONTENT_REVIEW_SERVICE_TOKEN=old})
 const request=(account=a.id,credential=token)=>({query:{},get(name){return({'Authorization':'Bearer '+credential,'X-Xijie-Account-Id':account})[name]}})
 await assert.rejects(api.read(request(a.id,'f'.repeat(64)),id),{code:'FORBIDDEN'});await assert.rejects(api.read(request(b.id),id),{code:'NOT_FOUND'})
 const source=(await api.read(request(),id)).data;assert.equal(source.subjectId,id);assert.equal(source.version,1);assert(!JSON.stringify(source).includes('仅合成举报正文'));assert.equal((await api.evidence(request(),id)).data.text,'仅合成举报正文')
 const input={reportId:randomUUID(),operationId:randomUUID(),containerId:c.id,sourceKind:'message',version:1,sourceHash:source.hash};assert.equal((await api.restrict(request(),id,input)).data.restricted,true);assert.equal((await api.restrict(request(),id,input)).data.restricted,true)
 await assert.rejects(api.read(request(),id),{code:'NOT_FOUND'});assert.equal((await f.pool.query('SELECT version,removed_at FROM messages WHERE id=$1',[id])).rows[0].version,2);assert.equal((await f.pool.query('SELECT state FROM generation_jobs WHERE id=$1',[accepted.generationJobId])).rows[0].state,'canceled');assert.equal((await f.store.searchHistory(a.id,'仅合成举报正文','zh-CN')).items.length,0)
})
test('evidence never returns a captured body after its source was removed while authority was being rechecked',async t=>{
 const f=await fixture(t),a=f.account(),c=(await f.store.ensure(a.id,a.person.id,randomUUID())).conversation,m=await f.store.send(a.id,c.id,randomUUID(),text('合成迟到证据'),randomUUID()),api=new ConversationReviewController(f.store),token=randomBytes(32).toString('hex'),old=process.env.XIJIE_CONTENT_REVIEW_SERVICE_TOKEN;process.env.XIJIE_CONTENT_REVIEW_SERVICE_TOKEN=token;t.after(()=>{if(old===undefined)delete process.env.XIJIE_CONTENT_REVIEW_SERVICE_TOKEN;else process.env.XIJIE_CONTENT_REVIEW_SERVICE_TOKEN=old});const request={query:{},get:k=>({Authorization:'Bearer '+token,'X-Xijie-Account-Id':a.id})[k]},original=api.source.bind(api);let removed=false;api.source=async(...args)=>{const result=await original(...args);if(!removed){removed=true;await f.store.removeMessage(a.id,c.id,m.message.id,randomUUID(),m.message.version,randomUUID())}return result};await assert.rejects(api.evidence(request,m.message.id),{code:'NOT_FOUND'})
})
