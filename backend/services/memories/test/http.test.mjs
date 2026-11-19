import 'reflect-metadata'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {test} from 'node:test'
import {NestFactory} from '@nestjs/core'
import {fixture,input} from './fixture.mjs'
import {MemoriesModule,MemoryErrors,memoryHeaders} from '../dist/http.js'
import {Dependencies} from '../dist/dependencies.js'

test('actual Nest HTTP preserves original-client DTO, signed pages and conditional authenticated commands',async t=>{
 const f=await fixture(t),a=f.account(),b=f.account(),serviceToken='a'.repeat(64),conversationsToken='b'.repeat(64),webOrigin='http://127.0.0.1:5184'
 const app=await NestFactory.create(MemoriesModule.register({webOrigin,serviceToken,conversationsToken},f.store),{logger:false,abortOnError:false})
 app.getHttpAdapter().getInstance().disable('etag');app.use(memoryHeaders);app.useGlobalFilters(new MemoryErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close())
 const origin=await app.getUrl(),base='/v1/persons/'+a.person.id+'/memories'
 const get=async(path,headers={})=>fetch(origin+path,{headers:{Cookie:a.cookie,'X-Xijie-Expected-Session':a.sid,...headers}})
 const command=async(method,path,body,headers={})=>fetch(origin+path,{method,headers:{Cookie:a.cookie,'X-Xijie-Expected-Session':a.sid,Origin:webOrigin,'Idempotency-Key':randomUUID(),'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})})
 assert.equal((await fetch(origin+base)).status,401)
 assert.equal((await get(base,{'X-Xijie-Expected-Session':b.sid})).status,401)
 assert.equal((await command('POST',base,input(),{Origin:'https://untrusted.invalid'})).status,403)
 const text=input(),key=randomUUID(),created=await command('POST',base,text,{'Idempotency-Key':key})
 assert.equal(created.status,201);assert.equal(created.headers.get('etag'),'"v1"');assert.equal(created.headers.get('cache-control'),'no-store')
 const memory=(await created.json()).data
 const duplicate=await command('POST',base,text,{'Idempotency-Key':key});assert.equal((await duplicate.json()).data.id,memory.id)
 const leaked=await get(base+'/'+memory.id,{Cookie:b.cookie,'X-Xijie-Expected-Session':b.sid});assert.equal(leaked.status,404)
 await command('POST',base,input('另一个原文'))
 const page=await get(base+'?limit=1&include=body'),first=(await page.json());assert.ok(first.data[0].body);assert.ok(first.meta.nextCursor)
 const second=await get(base+'?limit=1&include=body&cursor='+encodeURIComponent(first.meta.nextCursor));assert.equal(second.status,200);assert.notEqual((await second.json()).data[0].id,first.data[0].id)
 assert.equal((await get(base+'?limit=2&include=body&cursor='+encodeURIComponent(first.meta.nextCursor))).status,400)
 const summary=(await (await get(base)).json()).data[0];assert.ok(summary.excerpt);assert.equal(summary.body,undefined)
 assert.equal((await command('PATCH',base+'/'+memory.id,{title:'修改'})).status,428)
 const changed=await command('PATCH',base+'/'+memory.id,{title:'修改'},{'If-Match':'"v1"'});assert.equal(changed.status,200);assert.equal(changed.headers.get('etag'),'"v2"')
 const change=(await changed.json()).data;assert.equal(change.confirmedAt,memory.confirmedAt)
 assert.equal((await command('DELETE',base+'/'+memory.id,undefined,{'If-Match':'"v1"'})).status,412)
 const search=await get('/v1/search?scope=atlas&q='+encodeURIComponent('修改')+'&limit=1');assert.equal(search.status,200);assert.equal((await search.json()).data[0].memoryId,memory.id)
 assert.equal((await get('/v1/search?scope=conversations&q=修改')).status,400)
 assert.equal((await get('/v1/search?scope=atlas&q='+encodeURIComponent('！！！'))).status,200)
 const internal='/internal/v1/persons/'+a.person.id+'/memories/context'
 assert.equal((await get(internal,{'X-Xijie-Account-Id':a.id,Authorization:'Bearer '+serviceToken})).status,403)
 const context=await get(internal,{'X-Xijie-Account-Id':a.id,Authorization:'Bearer '+conversationsToken});assert.equal(context.status,200);assert.equal((await context.json()).data.personId,a.person.id)
 const removed=await command('DELETE',base+'/'+memory.id,undefined,{'If-Match':'"v2"'});assert.equal(removed.status,200)
 assert.equal((await get(base+'/'+memory.id)).status,404)
 assert.equal((await command('POST',base,text,{'Idempotency-Key':key})).status,404)
 const events=(await f.pool.query('SELECT type,payload FROM outbox_events WHERE aggregate_id=$1 ORDER BY aggregate_version',[memory.id])).rows
 assert.equal(events[1].payload.updatedAt,change.updatedAt);assert.equal(events[2].payload.removedAt,(await removed.json()).data.removedAt)
})

test('real internal HTTP adapter accepts legitimate ungranted version zero and fails closed on unavailable dependencies',async t=>{
 const accountId=randomUUID(),sessionId=randomUUID(),personId=randomUUID(),worldId=randomUUID(),credential='x'.repeat(43)
 let allowed=false,unavailable=false
 const server=createServer((request,response)=>{
  if(unavailable){response.writeHead(503);response.end('{}');return}
  assert.equal(request.headers.authorization,'Bearer '+'a'.repeat(64))
  if(request.url==='/internal/v1/session-context'){assert.equal(request.headers.cookie,'xijie_dev_session='+credential);response.end(JSON.stringify({data:{accountId,sessionId,expiresAt:new Date(Date.now()+60000).toISOString(),storyStorage:{allowed,authorizationVersion:allowed?1:0},aiTextProcessing:{allowed:false,authorizationVersion:0}}}));return}
  if(request.url==='/internal/v1/accounts/'+accountId+'/context'){response.end(JSON.stringify({data:{accountId,status:'active',accessVersion:1,storyStorage:{allowed,authorizationVersion:allowed?1:0},aiTextProcessing:{allowed:false,authorizationVersion:0}}}));return}
  response.writeHead(404);response.end('{}')
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)))
 const origin='http://127.0.0.1:'+server.address().port,deps=new Dependencies({identityOrigin:origin,peopleOrigin:origin,conversationsOrigin:origin,serviceToken:'a'.repeat(64),sessionCookie:'xijie_dev_session'})
 assert.deepEqual((await deps.session('xijie_dev_session='+credential,sessionId)).storyStorage,{allowed:false,authorizationVersion:0})
 assert.equal((await deps.account(accountId)).storyStorage.allowed,false)
 await assert.rejects(deps.session('xijie_dev_session='+credential,randomUUID()),{status:401})
 allowed=true;assert.equal((await deps.account(accountId)).storyStorage.authorizationVersion,1)
 unavailable=true;await assert.rejects(deps.account(accountId),{status:503})
})
