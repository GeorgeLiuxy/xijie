import 'reflect-metadata'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {test} from 'node:test'
import {NestFactory} from '@nestjs/core'
import {fixture,post} from './fixture.mjs'
import {createInput,digest,SocialError} from '../dist/contracts.js'
import {photoPostId} from '../dist/post-media.js'
import {SocialModule,SocialErrors,socialHeaders} from '../dist/http.js'
import {SocialDataRights} from '../dist/data-rights.js'
import {Dependencies} from '../dist/dependencies.js'
import {readConfig} from '../dist/config.js'

const metadata=id=>({id,version:2,mimeType:'image/webp',byteSize:321,width:600,height:480})
function allow(f,a){f.accounts.get(a).photoStorage={allowed:true,authorizationVersion:1}}
function mediaInput(count=1,body=''){return {clientPostId:randomUUID(),body,mediaIds:Array.from({length:count},()=>randomUUID())}}
function binding(f){const calls=[];f.deps.bindPostMedia=async(accountId,postId,clientPostId,mediaIds)=>{calls.push({accountId,postId,clientPostId,mediaIds});return mediaIds.map(metadata)};return calls}

test('optional Media wiring requires both endpoint and an independent credential and rejects unsafe or aliased roles',()=>{
 const config={DATABASE_URL:'postgresql://synthetic',XIJIE_SOCIAL_SERVICE_TOKEN:'a'.repeat(64),XIJIE_DATA_RIGHTS_SERVICE_TOKEN:'b'.repeat(64),XIJIE_MEDIA_SERVICE_TOKEN:'c'.repeat(64),XIJIE_MEDIA_URL:'http://127.0.0.1:3106',XIJIE_IDENTITY_URL:'http://127.0.0.1:3101',XIJIE_PEOPLE_URL:'http://127.0.0.1:3102',SOCIAL_PORT:'3105',SOCIAL_HOST:'127.0.0.1',SOCIAL_WEB_ORIGIN:'http://127.0.0.1:5184',SOCIAL_AI_ENABLED:'false',SOCIAL_QUEUE_SCHEMA:'social_queue',NODE_ENV:'test'}
 const before=Object.fromEntries(Object.keys(config).map(k=>[k,process.env[k]]))
 try{
  Object.assign(process.env,config);assert.equal(readConfig().mediaOrigin,config.XIJIE_MEDIA_URL)
  for(const bad of [undefined,'a'.repeat(64),'A'.repeat(64),'b'.repeat(64),'not-a-key']){if(bad===undefined)delete process.env.XIJIE_MEDIA_SERVICE_TOKEN;else process.env.XIJIE_MEDIA_SERVICE_TOKEN=bad;assert.throws(readConfig)}
  Object.assign(process.env,config);process.env.XIJIE_MEDIA_URL='https://private.example/extra';assert.throws(readConfig)
  Object.assign(process.env,config);delete process.env.XIJIE_MEDIA_URL;delete process.env.XIJIE_MEDIA_SERVICE_TOKEN;assert.equal(readConfig().mediaOrigin,undefined)
 }finally{for(const [k,v]of Object.entries(before))if(v===undefined)delete process.env[k];else process.env[k]=v}
})

test('image-only and nine-image input is strict; empty media preserves existing text idempotency shape; IDs survive credential rotation',()=>{
 const old=post();assert.deepEqual(createInput({...old,mediaIds:[]}),old)
 const input=mediaInput(9,'  ');assert.equal(createInput(input).body,'');assert.equal(createInput(input).mediaIds.length,9)
 for(const bad of [{...input,mediaIds:[input.mediaIds[0],input.mediaIds[0]]},{...input,mediaIds:Array.from({length:10},()=>randomUUID())},{...input,mediaIds:[]},{...input,body:'x'.repeat(501)},{...input,mediaIds:['foreign']},{...input,objectKey:'forbidden'}])assert.throws(()=>createInput(bad))
 const a=randomUUID(),b=randomUUID(),id=photoPostId(a,input.clientPostId),oldEnv=process.env.XIJIE_SOCIAL_SERVICE_TOKEN
 try{process.env.XIJIE_SOCIAL_SERVICE_TOKEN='a'.repeat(64);assert.equal(photoPostId(a,input.clientPostId),id);process.env.XIJIE_SOCIAL_SERVICE_TOKEN='b'.repeat(64);assert.equal(photoPostId(a,input.clientPostId),id)}finally{if(oldEnv===undefined)delete process.env.XIJIE_SOCIAL_SERVICE_TOKEN;else process.env.XIJIE_SOCIAL_SERVICE_TOKEN=oldEnv}
 assert.equal(id[14],'5');assert.match(id,/^[a-f0-9-]{36}$/);assert.notEqual(photoPostId(b,input.clientPostId),id);assert.notEqual(photoPostId(a,randomUUID()),id)
})

test('nine ordered photos publish atomically with an empty caption, no in-transaction RPC and replay performs no new binding',async t=>{
 const f=await fixture(t),a=f.account(),input=mediaInput(9),key=randomUUID();allow(f,a)
 let calls=0
 f.deps.bindPostMedia=async(accountId,id,client,ids)=>{
  calls++;assert.equal(accountId,a);assert.equal(id,photoPostId(a,client));assert.deepEqual(ids,input.mediaIds)
  const locks=(await f.pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=(SELECT application_name FROM pg_stat_activity WHERE pid=pg_backend_pid()) AND state='idle in transaction'")).rows[0].n;assert.equal(locks,0)
  assert.deepEqual(await f.store.validatePostMedia(a,ids.map(mediaId=>({postId:id,mediaId,version:2}))),[])
  return ids.map(metadata)
 }
 const p=await f.store.create(a,key,input);assert.equal(p.body,'');assert.equal(p.id,photoPostId(a,input.clientPostId));assert.deepEqual(p.mediaIds,input.mediaIds);assert.deepEqual(p.media,input.mediaIds.map(metadata))
 const saved=(await f.pool.query('SELECT position,media_id FROM post_media WHERE account_id=$1 ORDER BY position',[a])).rows;assert.deepEqual(saved.map(r=>r.position),[1,2,3,4,5,6,7,8,9]);assert.deepEqual(saved.map(r=>r.media_id),input.mediaIds)
 f.accounts.get(a).photoStorage={allowed:false,authorizationVersion:2}
 assert.equal((await f.store.create(a,key,input)).id,p.id);assert.equal((await f.store.create(a,randomUUID(),input)).id,p.id);assert.equal(calls,1)
 await assert.rejects(f.store.create(a,key,{...input,mediaIds:[...input.mediaIds].reverse()}),{code:'IDEMPOTENCY_CONFLICT'})
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM posts')).rows[0].n,1);assert.equal((await f.pool.query("SELECT count(*)::int n FROM outbox_events WHERE type='PostPublished.v1'")).rows[0].n,1)
 assert.equal((await f.store.feed(a,{},undefined,20))[0].media.length,9)
 const plain=post();const q=await f.store.create(a,randomUUID(),plain);assert.deepEqual(q.media,[]);assert.equal((await f.pool.query('SELECT request_hash FROM posts WHERE id=$1',[q.id])).rows[0].request_hash,digest(plain));assert.equal((await f.store.create(a,randomUUID(),{...plain,mediaIds:[]})).id,q.id)
})

test('binding failure, missing photo grant and grant changes preserve no partial post; actual SQL failure leaves no readable prebinding',async t=>{
 const f=await fixture(t),a=f.account(),input=mediaInput(),calls=binding(f)
 await assert.rejects(f.store.create(a,randomUUID(),input),{code:'PHOTO_PERMISSION_REQUIRED'});assert.equal(calls.length,0)
 allow(f,a);f.deps.bindPostMedia=async()=>{throw new SocialError(409,'MEDIA_NOT_READY','Synthetic pending validation')};await assert.rejects(f.store.create(a,randomUUID(),input),{code:'MEDIA_NOT_READY'});assert.equal((await f.pool.query('SELECT count(*)::int n FROM posts')).rows[0].n,0)
 f.deps.bindPostMedia=async(_a,_p,_c,ids)=>{f.accounts.get(a).photoStorage={allowed:false,authorizationVersion:2};return ids.map(metadata)}
 await assert.rejects(f.store.create(a,randomUUID(),input),{code:'PHOTO_PERMISSION_REQUIRED'});assert.equal((await f.pool.query('SELECT count(*)::int n FROM post_media')).rows[0].n,0)
 allow(f,a);binding(f);const first=await f.store.create(a,randomUUID(),input),second={...input,clientPostId:randomUUID()}
 await assert.rejects(f.store.create(a,randomUUID(),second),e=>e.code==='23505')
 assert.deepEqual(await f.store.validatePostMedia(a,[{postId:photoPostId(a,second.clientPostId),mediaId:input.mediaIds[0],version:2}]),[])
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM posts')).rows[0].n,1);assert.equal((await f.pool.query('SELECT count(*)::int n FROM post_media')).rows[0].n,1);assert.equal((await f.store.detail(a,first.id)).media.length,1)
})

test('metadata source checks exact actor/post/media/version and immediately rejects deletion even when release fails',async t=>{
 const f=await fixture(t),a=f.account(),b=f.account(),input=mediaInput();allow(f,a);binding(f)
 const p=await f.store.create(a,randomUUID(),input),ref={postId:p.id,mediaId:input.mediaIds[0],version:2}
 assert.deepEqual(await f.store.validatePostMedia(a,[ref]),[ref]);assert.deepEqual(await f.store.validatePostMedia(b,[ref]),[])
 assert.deepEqual(await f.store.validatePostMedia(a,[{...ref,version:3},{...ref,postId:randomUUID()}]),[])
 f.accounts.get(a).storyStorage.privateFeedAllowed=false;f.accounts.get(a).photoStorage={allowed:false,authorizationVersion:2}
 assert.deepEqual(await f.store.validatePostMedia(a,[ref]),[ref])
 let releases=0;f.deps.releasePostMedia=async()=>{releases++;assert.deepEqual(await f.store.validatePostMedia(a,[ref]),[]);const locks=(await f.pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=(SELECT application_name FROM pg_stat_activity WHERE pid=pg_backend_pid()) AND state='idle in transaction'")).rows[0].n;assert.equal(locks,0);throw Error('Synthetic unavailable cleanup')}
 const key=randomUUID(),removed=await f.store.remove(a,p.id,key,p.version);assert.equal(removed.version,2);assert.equal(releases,1);assert.deepEqual(await f.store.validatePostMedia(a,[ref]),[])
 assert.deepEqual(await f.store.remove(a,p.id,key,p.version),removed);assert.equal(releases,2)
 await assert.rejects(f.store.create(a,randomUUID(),input),{code:'STORAGE_PERMISSION_REQUIRED'})
})

test('real deferred SQL constraints reject empty posts, wrong owner, gapped sets, mutation and non-user attachments',async t=>{
 const f=await fixture(t),a=f.account(),b=f.account();allow(f,a);binding(f);const input=mediaInput(),p=await f.store.create(a,randomUUID(),input),plain=await f.store.create(a,randomUUID(),post());await f.store.create(b,randomUUID(),post())
 await assert.rejects(f.pool.query("INSERT INTO posts(account_id,kind,body,client_post_id,request_hash) VALUES($1,'user','',$2,$3)",[a,randomUUID(),'a'.repeat(64)]),e=>e.code==='23514')
 await assert.rejects(f.pool.query("INSERT INTO posts(account_id,kind,body,client_post_id,request_hash) VALUES($1,'user',E' \\t\\n',$2,$3)",[a,randomUUID(),'a'.repeat(64)]),e=>e.code==='23514')
 const insert=(accountId,postId,position=1)=>f.pool.query("INSERT INTO post_media(account_id,post_id,media_id,position,media_version,mime_type,byte_size,width,height) VALUES($1,$2,$3,$4,2,'image/webp',120,100,100)",[accountId,postId,randomUUID(),position])
 await assert.rejects(insert(b,p.id),e=>e.code==='23503');await assert.rejects(insert(a,plain.id,2),e=>e.code==='23514')
 await assert.rejects(f.pool.query('UPDATE post_media SET width=1 WHERE post_id=$1',[p.id]),e=>e.code==='23514');await assert.rejects(f.pool.query('DELETE FROM post_media WHERE post_id=$1',[p.id]),e=>e.code==='23514')
 const person=f.makePerson(a);person.move();const world=(await f.store.feed(a,{},undefined,20)).find(p=>p.kind==='world_notice');await assert.rejects(insert(a,world.id),e=>e.code==='23514')
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM post_media')).rows[0].n,1)
})

test('photo associations are included in revisioned export and erased behind the existing write fence',async t=>{
 const f=await fixture(t),a=f.account(),input=mediaInput(2);allow(f,a);binding(f);const p=await f.store.create(a,randomUUID(),input),rights=new SocialDataRights(f.store),request=f.request(a)
 f.accounts.get(a).photoStorage={allowed:false,authorizationVersion:2}
 const snapshot=await rights.export(a,request,'account_data');assert.equal(snapshot.data.postMedia.length,2);assert.deepEqual(snapshot.data.postMedia.map(r=>r.mediaId),input.mediaIds);assert.equal(snapshot.revision,digest(snapshot.data));assert.notEqual(snapshot.revision,digest({...snapshot.data,postMedia:[]}));assert(!JSON.stringify(snapshot).includes('objectKey'))
 await f.store.remove(a,p.id,randomUUID(),p.version);assert.deepEqual((await rights.export(a,request,'account_data')).data.postMedia,[])
 const deletion=f.request(a,'delete_account');await rights.erase(a,deletion);assert.equal((await f.pool.query('SELECT count(*)::int n FROM post_media')).rows[0].n,0)
 assert.deepEqual(await f.store.validatePostMedia(a,[{postId:p.id,mediaId:input.mediaIds[0],version:2}]),[])
 await assert.rejects(f.pool.query("INSERT INTO post_media(account_id,post_id,media_id,position,media_version,mime_type,byte_size,width,height) VALUES($1,$2,$3,1,2,'image/webp',120,100,100)",[a,p.id,randomUUID()]),e=>e.code==='42501')
})

test('actual HTTP metadata source requires only Media credential and exact scoped refs; user photo publishing keeps normal origin/session/CAS',async t=>{
 const f=await fixture(t),a=f.account(),b=f.account();allow(f,a);binding(f)
 const config={webOrigin:'http://127.0.0.1:5184',serviceToken:'a'.repeat(64),dataRightsToken:'b'.repeat(64),mediaToken:'c'.repeat(64)}
 const app=await NestFactory.create(SocialModule.register(config,f.store),{logger:false});app.use(socialHeaders);app.useGlobalFilters(new SocialErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close())
 const base='http://127.0.0.1:'+app.getHttpServer().address().port,input=mediaInput(1)
 const response=await fetch(base+'/v1/posts',{method:'POST',headers:{Cookie:'test='+a,Origin:config.webOrigin,'X-Xijie-Expected-Session':a,'Idempotency-Key':randomUUID(),'Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal(response.status,201);const p=(await response.json()).data;assert.equal(p.body,'');assert.equal(p.media.length,1)
 const ref={postId:p.id,mediaId:input.mediaIds[0],version:2}
 const source=async({token=config.mediaToken,account=a,refs=[ref]}={})=>{const r=await fetch(base+'/internal/v1/media/posts/validate',{method:'POST',headers:{Authorization:'Bearer '+token,'X-Xijie-Account-Id':account,'Content-Type':'application/json'},body:JSON.stringify({refs})});return {status:r.status,body:await r.json(),cache:r.headers.get('cache-control')}}
 f.accounts.get(a).storyStorage.privateFeedAllowed=false;f.accounts.get(a).photoStorage={allowed:false,authorizationVersion:2}
 assert.deepEqual((await source()).body.data.valid,[ref]);assert.equal((await source()).cache,'no-store');assert.deepEqual((await source({account:b})).body.data.valid,[])
 assert.equal((await source({token:config.serviceToken})).status,403);assert.equal((await source({token:config.dataRightsToken})).status,403);assert.equal((await source({refs:[ref,ref]})).status,422);assert.equal((await source({refs:Array.from({length:101},()=>({...ref,postId:randomUUID()}))})).status,422)
 const removed=await fetch(base+'/v1/posts/'+p.id,{method:'DELETE',headers:{Cookie:'test='+a,Origin:config.webOrigin,'X-Xijie-Expected-Session':a,'Idempotency-Key':randomUUID(),'If-Match':'"v1"'}});assert.equal(removed.status,200);assert.deepEqual((await source()).body.data.valid,[])
})

test('actual Media HTTP wire uses Social role, bounded exact ordered metadata and preserves source failures',async t=>{
 const accountId=randomUUID(),clientPostId=randomUUID(),id=photoPostId(accountId,clientPostId),ids=[randomUUID(),randomUUID()],seen=[];let mode='valid'
 const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;seen.push({path:req.url,account:req.headers['x-xijie-account-id'],token:req.headers.authorization,body:JSON.parse(raw)});res.setHeader('Content-Type','application/json');if(mode==='not-ready'){res.writeHead(409);res.end(JSON.stringify({error:{code:'MEDIA_NOT_READY'}}));return}if(mode==='denied'){res.writeHead(403);res.end(JSON.stringify({error:{code:'PHOTO_PERMISSION_REQUIRED'}}));return}if(mode==='credential'){res.writeHead(403);res.end(JSON.stringify({error:{code:'FORBIDDEN'}}));return}if(mode==='redirect'){res.writeHead(302,{Location:'/elsewhere'});res.end('{}');return}res.end(JSON.stringify({data:{postId:id,media:mode==='reordered'?[...ids].reverse().map(metadata):ids.map(metadata)}}))})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const origin='http://127.0.0.1:'+server.address().port,deps=new Dependencies({mediaOrigin:origin,serviceToken:'d'.repeat(64)})
 assert.deepEqual(await deps.bindPostMedia(accountId,id,clientPostId,ids),ids.map(metadata));assert.deepEqual(seen[0],{path:'/internal/v1/social/posts/'+id+'/media-bindings',account:accountId,token:'Bearer '+'d'.repeat(64),body:{clientPostId,mediaIds:ids}})
 for(const [which,code]of [['reordered','DEPENDENCY_UNAVAILABLE'],['not-ready','MEDIA_NOT_READY'],['denied','PHOTO_PERMISSION_REQUIRED'],['credential','DEPENDENCY_UNAVAILABLE'],['redirect','DEPENDENCY_UNAVAILABLE']]){mode=which;await assert.rejects(deps.bindPostMedia(accountId,id,clientPostId,ids),{code})}
 mode='valid';await deps.releasePostMedia(accountId,id);assert.equal(seen.at(-1).path,'/internal/v1/social/posts/'+id+'/media-release');assert.deepEqual(seen.at(-1).body,{})
})
