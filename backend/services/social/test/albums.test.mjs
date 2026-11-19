import 'reflect-metadata'
import assert from 'node:assert/strict'
import {randomBytes,randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'
import {NestFactory} from '@nestjs/core'
import {fixture} from './fixture.mjs'
import {AlbumStore,visitorHash} from '../dist/albums.js'
import {SocialError} from '../dist/contracts.js'
import {albumInput} from '../dist/albums-contracts.js'
import {SocialModule,SocialErrors,socialHeaders} from '../dist/http.js'
import {SocialDataRights} from '../dist/data-rights.js'
import {albumExport,eraseAlbums} from '../dist/albums-rights.js'
import {fixture as memoryFixture} from '../../memories/test/fixture.mjs'
import {MemoriesModule,MemoryErrors,memoryHeaders} from '../../memories/dist/http.js'
import {Dependencies as MemoryDependencies} from '../../memories/dist/dependencies.js'
import {Dependencies as SocialDependencies} from '../dist/dependencies.js'
import {verifySharedAlbumFacts} from '../../../../deploy/recovery/shared-albums.mjs'
const unavailable=()=>new SocialError(503,'DEPENDENCY_UNAVAILABLE','Synthetic outage')
async function albums(t){
 const f=await fixture(t);await f.pool.query(await readFile(new URL('../db/004_shared_albums.sql',import.meta.url),'utf8'))
 const owner=f.account(),guest=f.account(),person=f.makePerson(owner).person,rewards=new Map(),memories=new Map(),calls={reward:0,adopt:0},faults={reward:false,adopt:false}
 const config={enabled:true,tokenKey:randomBytes(32),publicOrigin:'http://127.0.0.1:5184',memoriesToken:'c'.repeat(64),giftsOrigin:'http://127.0.0.1:3107'}
 const downstream={async albumReward(accountId,albumId){return rewards.get(accountId+albumId)??null},async rewardAlbum(accountId,albumId){calls.reward++;const key=accountId+albumId;if(!rewards.has(key))rewards.set(key,{receiptId:randomUUID(),albumId,accountId,assetType:'voucher',assetId:'return-stamp',units:1,grantedAt:new Date().toISOString()});if(faults.reward)throw unavailable();return rewards.get(key)},async adoptAlbum(accountId,albumId,contributionId,sourceVersion){calls.adopt++;if(!memories.has(contributionId))memories.set(contributionId,{albumId,contributionId,memoryId:randomUUID(),version:1,status:'fulfilled'});if(faults.adopt)throw unavailable();return memories.get(contributionId)},async revokeAlbumSource(_accountId,_albumId,id){if(memories.has(id))memories.get(id).status='revoked'}}
 const store=new AlbumStore(f.store,config,downstream);f.store.albums=store
 const create=()=>store.create(owner,randomUUID(),{personId:person.id,title:'合成六段相册',message:'只公开这句附言'})
 const submit=async album=>{const visitor=visitorHash(randomBytes(32).toString('base64url')),token=new URL(album.url).pathname.split('/').at(-1),c=await store.submit(token,visitor,randomUUID(),{text:'合成投稿正文',allowAdoption:true});return{visitor,token,c}}
 return{...f,social:f.store,owner,guest,person,config,store,downstream,rewards,memories,calls,faults,create,submit}
}
async function albumHttp(t,f){
 f.deps.session=async(cookie,expected)=>{const id=/(?:^|;\s*)test=([^;]+)/.exec(cookie)?.[1],a=f.accounts.get(id);if(!a||a.status!=='active'||expected!==id)throw new SocialError(401,'UNAUTHENTICATED','Synthetic session mismatch');return{accountId:id,sessionId:id,expiresAt:new Date(Date.now()+60000).toISOString(),storyStorage:a.storyStorage}}
 const config={webOrigin:f.config.publicOrigin,serviceToken:'a'.repeat(64),albums:f.config},app=await NestFactory.create(SocialModule.register(config,f.social),{logger:false});app.use(socialHeaders);app.useGlobalFilters(new SocialErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close());const origin=await app.getUrl(),base=randomBytes(32).toString('base64url'),visitorCookie='xijie_dev_album_visitor='+base
 const headers=(account,scope,key=randomUUID(),cookie=visitorCookie)=>({Cookie:cookie+(account?'; test='+account:''),Origin:config.webOrigin,'Content-Type':'application/json',...(account?{'X-Xijie-Expected-Session':account}:{}),...(scope?{'X-Xijie-Album-Viewer':scope}:{}),'Idempotency-Key':key}),read=async(token,account,cookie=visitorCookie)=>{const r=await fetch(origin+'/v1/public/shared-albums/'+token,{headers:headers(account,undefined,undefined,cookie)});assert.equal(r.status,200);return(await r.json()).data}
 return{origin,base,visitorCookie,headers,read}
}
test('real Nest viewer scopes isolate signed submissions across accounts sharing one visitor cookie and command lookup is read only',async t=>{
 const f=await albums(t),h=await albumHttp(t,f),a=await f.create(),token=new URL(a.url).pathname.split('/').at(-1),path=h.origin+'/v1/public/shared-albums/'+token,A=f.guest,B=f.account(),key=randomUUID(),input={text:'PRIVATE_SIGNED_A_SUBMISSION',allowAdoption:true},pubA=await h.read(token,A)
 assert.equal(pubA.viewerScope.kind,'account');assert.match(pubA.viewerScope.id,/^[a-f0-9]{64}$/);assert(!JSON.stringify(pubA.viewerScope).includes(A));const savedResponse=await fetch(path+'/contributions',{method:'POST',headers:h.headers(A,pubA.viewerScope.id,key),body:JSON.stringify(input)});assert.equal(savedResponse.status,201);const saved=(await savedResponse.json()).data
 assert.equal((await f.pool.query('SELECT author_account_id FROM shared_album_contributions WHERE id=$1',[saved.id])).rows[0].author_account_id,A);assert.equal((await f.pool.query('SELECT count(*)::int n FROM shared_album_rewards')).rows[0].n,0)
 const facts={accounts:[...f.accounts].map(([id,a])=>({id,status:a.status})),persons:[{id:f.person.id,account_id:f.owner,status:'active'}],peopleFences:[],memoryGates:[],giftGates:[],receipts:[],memories:[],memoryEvents:[],giftReceipts:[],giftTransactions:[],giftLots:[],giftEntries:[]};for(const [key,name]of Object.entries({albums:'shared_albums',contributions:'shared_album_contributions',commands:'shared_album_commands',decisions:'shared_album_decisions',adoptions:'shared_album_adoptions',rewards:'shared_album_rewards',cleanup:'shared_album_source_cleanup',socialGates:'social_account_write_gates'}))facts[key]=JSON.parse(JSON.stringify((await f.pool.query('SELECT * FROM '+name)).rows));assert.equal(verifySharedAlbumFacts(facts).contributionCount,1)
 const pubB=await h.read(token,B),anon=await h.read(token);assert.notEqual(pubB.viewerScope.id,pubA.viewerScope.id);assert.notEqual(anon.viewerScope.id,pubA.viewerScope.id);assert.equal(pubB.contribution,null);assert.equal(anon.contribution,null)
 let r=await fetch(path+'/contributions',{method:'POST',headers:h.headers(B,pubA.viewerScope.id,key),body:JSON.stringify(input)});assert.equal(r.status,409);assert.equal((await r.json()).error.code,'VIEWER_SCOPE_CHANGED');r=await fetch(path+'/contributions/'+saved.id+'/withdraw',{method:'POST',headers:h.headers(B,pubB.viewerScope.id),body:'{}'});assert.equal(r.status,404)
 const before=JSON.stringify((await f.pool.query('SELECT (SELECT count(*) FROM shared_album_commands) c,(SELECT count(*) FROM shared_album_decisions) d,(SELECT sum(version) FROM shared_album_contributions) v')).rows)
 r=await fetch(path+'/submission-commands/'+key,{headers:h.headers(B)});assert.equal(r.status,404);assert(!JSON.stringify(await r.json()).includes(input.text));r=await fetch(path+'/submission-commands/'+key,{headers:h.headers(A)});assert.equal(r.status,200);assert.deepEqual((await r.json()).data,{state:'accepted',contribution:saved});r=await fetch(path+'/submission-commands/'+randomUUID(),{headers:h.headers(A)});assert.equal(r.status,404);assert.equal(JSON.stringify((await f.pool.query('SELECT (SELECT count(*) FROM shared_album_commands) c,(SELECT count(*) FROM shared_album_decisions) d,(SELECT sum(version) FROM shared_album_contributions) v')).rows),before)
 r=await fetch(path,{headers:{...h.headers(B),'X-Xijie-Expected-Session':A}});assert.equal(r.status,401)
 const owner=await h.read(token,f.owner);r=await fetch(path+'/contributions',{method:'POST',headers:h.headers(f.owner,owner.viewerScope.id),body:JSON.stringify({text:'Owner second seat',allowAdoption:true})});assert.equal(r.status,409);assert.equal((await r.json()).error.code,'SELF_CONTRIBUTION_NOT_ALLOWED')
})
test('anonymous acceptance survives login until explicit claim, and original commands cannot expose the bound account to another viewer',async t=>{
 const f=await albums(t),h=await albumHttp(t,f),a=await f.create(),token=new URL(a.url).pathname.split('/').at(-1),path=h.origin+'/v1/public/shared-albums/'+token,key=randomUUID(),claimKey=randomUUID(),input={text:'PRIVATE_ANONYMOUS_THEN_A',allowAdoption:true};let r=await fetch(path+'/contributions',{method:'POST',headers:h.headers(undefined,undefined,key),body:JSON.stringify(input)});assert.equal(r.status,201);const saved=(await r.json()).data
 const signed=await h.read(token,f.guest);assert.equal(signed.contribution.id,saved.id);assert.equal((await f.pool.query('SELECT author_account_id FROM shared_album_contributions WHERE id=$1',[saved.id])).rows[0].author_account_id,null);await f.store.review(saved.id,'approved',undefined,'synthetic-reviewer')
 r=await fetch(path+'/reward',{method:'POST',headers:h.headers(f.guest,signed.viewerScope.id,claimKey),body:'{}'});assert.equal(r.status,200);assert.equal((await r.json()).data.status,'fulfilled');assert.equal(f.calls.reward,1)
 const B=f.account(),pubB=await h.read(token,B);assert.equal(pubB.contribution,null);assert.equal((await h.read(token)).contribution,null);r=await fetch(path+'/contributions',{method:'POST',headers:h.headers(undefined,undefined,key),body:JSON.stringify(input)});assert.equal(r.status,404);assert(!JSON.stringify(await r.json()).includes(input.text))
 r=await fetch(path+'/submission-commands/'+key,{headers:h.headers(B)});assert.equal(r.status,404);r=await fetch(path+'/submission-commands/'+key,{headers:h.headers(f.guest)});assert.equal(r.status,200);assert.equal((await r.json()).data.contribution.id,saved.id)
 const secondCookie='xijie_dev_album_visitor='+randomBytes(32).toString('base64url');r=await fetch(path+'/contributions',{method:'POST',headers:h.headers(undefined,undefined,randomUUID(),secondCookie),body:JSON.stringify({text:'A separate anonymous contribution',allowAdoption:true})});const other=(await r.json()).data;assert.equal(r.status,201);await f.store.review(other.id,'approved',undefined,'synthetic-reviewer')
 const current=await h.read(token,f.guest,secondCookie);r=await fetch(path+'/reward',{method:'POST',headers:h.headers(f.guest,current.viewerScope.id,claimKey,secondCookie),body:'{}'});assert.equal(r.status,200);assert.equal(f.calls.reward,1);r=await fetch(path+'/reward',{method:'POST',headers:h.headers(f.guest,current.viewerScope.id,randomUUID(),secondCookie),body:'{}'});assert.equal(r.status,409);assert.equal((await r.json()).error.code,'ALBUM_REWARD_ALREADY_CLAIMED')
 const currentB=await h.read(token,B,secondCookie);r=await fetch(path+'/contributions/'+other.id+'/withdraw',{method:'POST',headers:h.headers(B,currentB.viewerScope.id,randomUUID(),secondCookie),body:'{}'});assert.equal(r.status,200);assert.equal((await f.pool.query("SELECT actor_account_id FROM shared_album_decisions WHERE contribution_id=$1 AND decision='withdraw'",[other.id])).rows[0].actor_account_id,null)
})
test('a late anonymous receipt cannot return text after claim binding or account erasure crosses its final read',async t=>{
 const f=await albums(t),a=await f.create(),token=new URL(a.url).pathname.split('/').at(-1),visitor=visitorHash('SYNTHETIC_ORIGINAL_VISITOR'),key=randomUUID();let entered,release,once=true;const began=new Promise(r=>entered=r),wait=new Promise(r=>release=r),original=f.pool.query.bind(f.pool)
 f.pool.query=async(sql,...args)=>{if(once&&typeof sql==='string'&&sql.startsWith('SELECT status,receipt_id,granted_at FROM shared_album_rewards')){once=false;entered();await wait}return original(sql,...args)}
 const pending=f.store.submit(token,visitor,key,{text:'PRIVATE_LATE_ANONYMOUS_RECEIPT',allowAdoption:true}),outcome=pending.then(v=>({value:v}),error=>({error}));await began;const c=(await original('SELECT id FROM shared_album_contributions')).rows[0];await f.store.review(c.id,'approved',undefined,'reviewer');await f.store.claim(token,visitor,f.guest,randomUUID());release();assert.equal((await outcome).error.status,404);assert.equal((await f.store.submissionCommand(token,visitor,key,f.guest)).id,c.id)
 const b=await f.create(),bound=await f.store.submit(new URL(b.url).pathname.split('/').at(-1),visitorHash('SIGNED_VISITOR'),randomUUID(),{text:'PRIVATE_LATE_DELETED_ACCOUNT',allowAdoption:true},f.guest),boundToken=new URL(b.url).pathname.split('/').at(-1);let entered2,release2;const began2=new Promise(r=>entered2=r),wait2=new Promise(r=>release2=r);once=true;f.pool.query=async(sql,...args)=>{if(once&&typeof sql==='string'&&sql.startsWith('SELECT status,receipt_id,granted_at FROM shared_album_rewards')){once=false;entered2();await wait2}return original(sql,...args)}
 const read=f.store.publicView(boundToken,visitorHash('SIGNED_VISITOR'),f.guest).then(v=>({value:v}),error=>({error}));await began2;await new SocialDataRights(f.social).erase(f.guest,f.request(f.guest,'delete_account'));release2();const result=await read;assert(result.error);assert(!JSON.stringify(result.value??{}).includes('PRIVATE'));assert.equal((await original('SELECT body,author_account_id FROM shared_album_contributions WHERE id=$1',[bound.id])).rows[0].body,'')
})
test('album links preserve permanent identities and public projection hides person, world, owner and other submissions',async t=>{
 const f=await albums(t),key=randomUUID(),input={personId:f.person.id,title:'公开标题',message:'公开附言'}
 const [a,b]=await Promise.all([f.store.create(f.owner,key,input),f.store.create(f.owner,key,input)]);assert.equal(a.id,b.id);assert.equal(a.url,b.url)
 await assert.rejects(()=>f.store.create(f.owner,key,{...input,title:'changed'}),e=>e.code==='IDEMPOTENCY_CONFLICT')
 const one=await f.submit(a),two=await f.submit(a),pub=await f.store.publicView(one.token,one.visitor)
 assert.equal(pub.current,1);assert.equal(pub.contribution.status,'pending');assert.equal(pub.contribution.id,one.c.id)
 const json=JSON.stringify(pub);for(const privateValue of [f.owner,f.person.id,f.person.worldId,two.c.id])assert(!json.includes(privateValue))
 const row=(await f.pool.query('SELECT token_hash,token_cipher FROM shared_albums WHERE id=$1',[a.id])).rows[0];assert(!JSON.stringify(row).includes(one.token))
 await assert.rejects(()=>f.store.detail(f.guest,a.id),e=>e.status===404)
 assert.equal((await f.store.list(f.owner,undefined,1)).data.length,1)
 await assert.rejects(f.pool.query("UPDATE shared_album_decisions SET decision='close' WHERE album_id=$1",[a.id]),e=>e.code==='23514')
})
test('actual human review allocates only five contribution seats and concurrent last-seat decisions cannot overbook',async t=>{
 const f=await albums(t),a=await f.create(),entries=[];for(let i=0;i<6;i++)entries.push(await f.submit(a))
 for(const e of entries.slice(0,4))await f.store.review(e.c.id,'approved',undefined,'synthetic-reviewer')
 const results=await Promise.allSettled(entries.slice(4).map(e=>f.store.review(e.c.id,'approved',undefined,'synthetic-reviewer')))
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'ALBUM_COMPLETE')
 const detail=await f.store.detail(f.owner,a.id);assert.equal(detail.current,6);assert.equal(new Set(detail.contributions.filter(c=>c.seat).map(c=>c.seat)).size,5)
 assert.equal(f.calls.reward,0);assert.equal(f.calls.adopt,0)
 await assert.rejects(()=>f.store.review(entries[0].c.id,'rejected','unsafe','reviewer'),e=>e.code==='REVIEW_ALREADY_DECIDED')
 await f.store.withdraw(entries[0].token,entries[0].visitor,entries[0].c.id,randomUUID());assert.equal((await f.store.detail(f.owner,a.id)).current,5)
 const pending=detail.contributions.find(c=>c.status==='pending');await f.store.review(pending.id,'approved',undefined,'reviewer');assert.equal((await f.store.detail(f.owner,a.id)).current,6)
})
test('submission and source withdrawal replay without duplication, prior adoption survives normal link close',async t=>{
 const f=await albums(t),a=await f.create(),e=await f.submit(a)
 await assert.rejects(()=>f.store.adopt(f.owner,a.id,e.c.id,randomUUID()),e=>e.status===404)
 await f.store.review(e.c.id,'approved',undefined,'reviewer');await f.store.close(f.owner,a.id,randomUUID())
 assert.equal((await f.store.publicView(e.token,e.visitor)).status,'closed');await assert.rejects(()=>f.store.publicView(e.token,visitorHash('stranger')),e=>e.status===404)
 assert.equal((await f.store.source(f.owner,a.id,e.c.id,2)).body,'合成投稿正文')
 const adopted=await f.store.adopt(f.owner,a.id,e.c.id,randomUUID());assert.equal(adopted.status,'fulfilled')
 const key=randomUUID();assert.deepEqual(await f.store.withdraw(e.token,e.visitor,e.c.id,key),await f.store.withdraw(e.token,e.visitor,e.c.id,key))
 await assert.rejects(()=>f.store.source(f.owner,a.id,e.c.id,2),e=>e.status===404)
 await f.store.reconcile();assert.equal(f.memories.get(e.c.id).status,'revoked');assert.equal((await f.pool.query('SELECT count(*)::int n FROM shared_album_source_cleanup')).rows[0].n,0)
})
test('closed albums expose only the original visitor contribution and forbid new submissions and reward dispatch',async t=>{
 const f=await albums(t),a=await f.create(),e=await f.submit(a),other=await f.submit(a);await f.store.review(e.c.id,'approved',undefined,'reviewer');await f.store.close(f.owner,a.id,randomUUID())
 const own=await f.store.publicView(e.token,e.visitor);assert.equal(own.status,'closed');assert.equal(own.title,'');assert.equal(own.message,'');assert.equal(own.contribution.id,e.c.id);assert(!JSON.stringify(own).includes(other.c.id))
 await assert.rejects(()=>f.store.publicView(e.token,visitorHash('stranger')),e=>e.status===404)
 await assert.rejects(()=>f.store.submit(e.token,visitorHash('stranger'),randomUUID(),{text:'不得新增',allowAdoption:true}),e=>e.status===404)
 await assert.rejects(()=>f.store.claim(e.token,e.visitor,f.guest,randomUUID()),e=>e.code==='ALBUM_CLOSED');assert.equal(f.calls.reward,0)
 await f.store.withdraw(e.token,e.visitor,e.c.id,randomUUID());assert.equal((await f.store.publicView(e.token,e.visitor)).contribution.status,'withdrawn');assert.equal((await f.store.publicView(e.token,e.visitor)).contribution.text,'')
})
test('the original forty-character title control persists its full boundary and rejects the forty-first character',async t=>{
 const f=await albums(t),input=albumInput({personId:f.person.id,title:'甲'.repeat(40),message:'原附言'}),a=await f.store.create(f.owner,randomUUID(),input)
 assert.equal([...a.title].length,40);assert.throws(()=>albumInput({...input,title:input.title+'乙'}),e=>e.code==='VALIDATION_FAILED')
 await assert.rejects(f.pool.query('UPDATE shared_albums SET title=$2 WHERE id=$1',[a.id,input.title+'乙']),e=>e.code==='23514')
})
test('recovery blocks permanently stop adoption, reward and cleanup work without deleting their business identities',async t=>{
 const f=await albums(t),a=await f.create(),e=await f.submit(a);await f.store.review(e.c.id,'approved',undefined,'reviewer');f.faults.adopt=true;f.faults.reward=true
 await f.store.adopt(f.owner,a.id,e.c.id,randomUUID());await f.store.claim(e.token,e.visitor,f.guest,randomUUID());await f.store.withdraw(e.token,e.visitor,e.c.id,randomUUID(),f.guest)
 await f.pool.query('UPDATE shared_album_adoptions SET recovery_blocked=true');await f.pool.query('UPDATE shared_album_rewards SET recovery_blocked=true');await f.pool.query('UPDATE shared_album_source_cleanup SET recovery_blocked=true')
 const before={...f.calls};f.faults.adopt=false;f.faults.reward=false;let cleanup=0;f.downstream.revokeAlbumSource=async()=>{cleanup++}
 await f.store.reconcile();await f.store.fulfillAdoption(e.c.id);await f.store.fulfillReward(a.id,f.guest);assert.deepEqual(f.calls,before);assert.equal(cleanup,0)
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM shared_album_source_cleanup')).rows[0].n,1)
})
test('close racing before reward dispatch prevents POST, while a previously dispatched unknown only reads its original receipt',async t=>{
 const f=await albums(t),a=await f.create(),e=await f.submit(a);await f.store.review(e.c.id,'approved',undefined,'reviewer')
 const get=f.downstream.albumReward;let once=true
 f.downstream.albumReward=async(...args)=>{const r=await get(...args);if(once){once=false;await f.store.close(f.owner,a.id,randomUUID())}return r}
 const pending=await f.store.claim(e.token,e.visitor,f.guest,randomUUID());assert.equal(pending.status,'pending');assert.equal(f.calls.reward,0)
 await f.store.reconcile();assert.equal((await f.pool.query('SELECT status FROM shared_album_rewards')).rows[0].status,'canceled');assert.equal(f.calls.reward,0)
 const b=await f.create(),next=await f.submit(b);await f.store.review(next.c.id,'approved',undefined,'reviewer');f.faults.reward=true
 assert.equal((await f.store.claim(next.token,next.visitor,f.guest,randomUUID())).status,'pending');assert.equal(f.calls.reward,1)
 await f.store.close(f.owner,b.id,randomUUID());f.faults.reward=false;await f.store.reconcile();assert.equal((await f.store.publicView(next.token,next.visitor,f.guest)).contribution.reward.status,'fulfilled');assert.equal(f.calls.reward,1)
})
test('anonymous author login claim and accepted-but-lost downstream responses recover with one memory and one voucher',async t=>{
 const f=await albums(t),a=await f.create(),e=await f.submit(a);await f.store.review(e.c.id,'approved',undefined,'reviewer')
 f.faults.reward=true;f.faults.adopt=true
 const akey=randomUUID(),rkey=randomUUID();assert.equal((await f.store.adopt(f.owner,a.id,e.c.id,akey)).status,'pending');assert.equal((await f.store.claim(e.token,e.visitor,f.guest,rkey)).status,'pending')
 assert.equal(f.memories.size,1);assert.equal(f.rewards.size,1)
 f.faults.reward=false;f.faults.adopt=false;await f.store.reconcile()
 assert.equal((await f.store.adopt(f.owner,a.id,e.c.id,akey)).status,'fulfilled');assert.equal((await f.store.claim(e.token,e.visitor,f.guest,rkey)).status,'fulfilled');assert.equal(f.memories.size,1);assert.equal(f.rewards.size,1)
 const other=await f.submit(a);await f.store.review(other.c.id,'approved',undefined,'reviewer');await assert.rejects(()=>f.store.claim(other.token,other.visitor,f.guest,randomUUID()),e=>e.code==='ALBUM_REWARD_ALREADY_CLAIMED')
 await assert.rejects(()=>f.store.claim(e.token,e.visitor,f.owner,randomUUID()),e=>e.code==='SELF_REWARD_NOT_ALLOWED')
 const outsider=f.account();await assert.rejects(()=>f.store.claim(e.token,e.visitor,outsider,randomUUID()),e=>e.status===404)
 assert.equal(f.accounts.get(f.guest).giftStorage,undefined)
})
test('withdrawal before a delayed adoption commit cannot restore approved state or reward pending work',async t=>{
 const f=await albums(t),a=await f.create(),e=await f.submit(a);await f.store.review(e.c.id,'approved',undefined,'reviewer')
 const old=f.downstream.adoptAlbum;f.downstream.adoptAlbum=async(...args)=>{const result=await old(...args);await f.store.withdraw(e.token,e.visitor,e.c.id,randomUUID());return result}
 assert.equal((await f.store.adopt(f.owner,a.id,e.c.id,randomUUID())).status,'revoked');await f.store.reconcile();assert.equal(f.memories.get(e.c.id).status,'revoked')
 await assert.rejects(()=>f.store.claim(e.token,e.visitor,f.guest,randomUUID()),e=>e.code==='CONTRIBUTION_NOT_APPROVED')
})
test('withdrawal while the final owner authority is in flight prevents the source from returning earlier text',async t=>{
 const f=await albums(t),a=await f.create(),e=await f.submit(a);await f.store.review(e.c.id,'approved',undefined,'reviewer')
 let release,entered,count=0;const began=new Promise(resolve=>{entered=resolve}),wait=new Promise(resolve=>{release=resolve}),original=f.store.authority.bind(f.store)
 f.store.authority=async(...args)=>{const value=await original(...args);if(++count===2){entered();await wait}return value}
 const pending=f.store.source(f.owner,a.id,e.c.id,2);await began;await f.store.withdraw(e.token,e.visitor,e.c.id,randomUUID());release()
 await assert.rejects(()=>pending,e=>e.status===404)
})
test('owner detail cannot return a stale author body after withdrawal commits during its final authority read',async t=>{
 const f=await albums(t),a=await f.create(),e=await f.submit(a);await f.store.review(e.c.id,'approved',undefined,'reviewer')
 let release,entered,count=0;const began=new Promise(resolve=>{entered=resolve}),wait=new Promise(resolve=>{release=resolve}),original=f.store.authority.bind(f.store)
 f.store.authority=async(...args)=>{const value=await original(...args);if(++count===2){entered();await wait}return value}
 const pending=f.store.detail(f.owner,a.id);await began;await f.store.withdraw(e.token,e.visitor,e.c.id,randomUUID());release()
 await assert.rejects(()=>pending,e=>e.code==='SOURCE_CHANGED');assert.equal((await f.store.detail(f.owner,a.id)).contributions[0].text,'')
})
test('a dispatched reward remains unknown across withdrawal and a concurrent missing receipt until the original grant commits',async t=>{
 const f=await albums(t),a=await f.create(),e=await f.submit(a);await f.store.review(e.c.id,'approved',undefined,'reviewer')
 let release,entered;const began=new Promise(resolve=>{entered=resolve}),wait=new Promise(resolve=>{release=resolve}),original=f.downstream.rewardAlbum
 f.downstream.rewardAlbum=async(...args)=>{entered();await wait;await original(...args);throw unavailable()}
 const key=randomUUID(),pending=f.store.claim(e.token,e.visitor,f.guest,key);await began
 await f.store.withdraw(e.token,e.visitor,e.c.id,randomUUID(),f.guest);await f.store.reconcile()
 assert.equal((await f.pool.query('SELECT status FROM shared_album_rewards')).rows[0].status,'pending');assert.equal(f.rewards.size,0)
 release();assert.equal((await pending).status,'pending');assert.equal(f.rewards.size,1)
 assert.equal((await f.store.claim(e.token,e.visitor,f.guest,key)).status,'fulfilled');assert.equal((await f.pool.query('SELECT status FROM shared_album_rewards')).rows[0].status,'fulfilled');assert.equal(f.calls.reward,1)
})
test('data-rights erasure waits for source cleanup and resumes after committed local erasure without restoring private data',async t=>{
 const f=await albums(t),a=await f.create(),e=await f.submit(a);await f.store.review(e.c.id,'approved',undefined,'reviewer');await f.store.claim(e.token,e.visitor,f.guest,randomUUID());await f.store.adopt(f.owner,a.id,e.c.id,randomUUID())
 const requestId=randomUUID();f.requests.set(requestId,{requestId,accountId:f.guest,kind:'delete_account',scope:'account_data',status:'processing',accountStatus:'deletion_pending',accountAccessVersion:2})
 const rights=new SocialDataRights(f.social),old=f.downstream.revokeAlbumSource;f.downstream.revokeAlbumSource=async()=>{throw unavailable()}
 await assert.rejects(()=>rights.erase(f.guest,requestId),e=>e.status===503)
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM shared_album_source_cleanup WHERE $1=ANY(erasing_account_ids)',[f.guest])).rows[0].n,1)
 f.downstream.revokeAlbumSource=old;const result=await rights.erase(f.guest,requestId);assert.equal(result.alreadyErased,true)
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM shared_album_source_cleanup WHERE $1=ANY(erasing_account_ids)',[f.guest])).rows[0].n,0)
 assert.equal(f.memories.get(e.c.id).status,'revoked');assert.equal(f.rewards.size,1)
})
test('concurrent author and initiator erasure cannot overwrite each other source-cleanup completion dependency',async t=>{
 const f=await albums(t),a=await f.create(),e=await f.submit(a);await f.store.review(e.c.id,'approved',undefined,'reviewer');await f.store.claim(e.token,e.visitor,f.guest,randomUUID());await f.store.adopt(f.owner,a.id,e.c.id,randomUUID())
 const rights=new SocialDataRights(f.social),ids=new Map([f.owner,f.guest].map(accountId=>{const requestId=randomUUID();f.requests.set(requestId,{requestId,accountId,kind:'delete_account',scope:'account_data',status:'processing',accountStatus:'deletion_pending',accountAccessVersion:2});return[accountId,requestId]}))
 const old=f.downstream.revokeAlbumSource;f.downstream.revokeAlbumSource=async()=>{throw unavailable()}
 await assert.rejects(()=>rights.erase(f.guest,ids.get(f.guest)),e=>e.status===503)
 await assert.rejects(()=>rights.erase(f.owner,ids.get(f.owner)),e=>e.status===503)
 assert.deepEqual(new Set((await f.pool.query('SELECT erasing_account_ids FROM shared_album_source_cleanup')).rows[0].erasing_account_ids),new Set([f.owner,f.guest]))
 await assert.rejects(()=>rights.erase(f.guest,ids.get(f.guest)),e=>e.status===503)
 f.downstream.revokeAlbumSource=old;assert.equal((await rights.erase(f.guest,ids.get(f.guest))).alreadyErased,true);assert.equal((await rights.erase(f.owner,ids.get(f.owner))).alreadyErased,true)
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM shared_album_source_cleanup')).rows[0].n,0);assert.equal(f.memories.get(e.c.id).status,'revoked')
})
test('author deletion immediately hides source and later scrub retains only cleanup metadata without touching earned assets',async t=>{
 const f=await albums(t),a=await f.create(),e=await f.submit(a);await f.store.review(e.c.id,'approved',undefined,'reviewer');await f.store.claim(e.token,e.visitor,f.guest,randomUUID());await f.store.adopt(f.owner,a.id,e.c.id,randomUUID())
 f.accounts.delete(f.guest);await assert.rejects(()=>f.store.source(f.owner,a.id,e.c.id,2),e=>e.status===404);assert.equal((await f.store.detail(f.owner,a.id)).contributions[0].text,'')
 const db=await f.pool.connect();try{await db.query('BEGIN');const before=await albumExport(db,f.owner,[]);assert.equal(before.sharedAlbums.contributions[0].text,'');await eraseAlbums(db,f.guest);await db.query('COMMIT')}catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 const dumped=JSON.stringify((await f.pool.query('SELECT * FROM shared_album_contributions')).rows);assert(!dumped.includes(f.guest));assert(!dumped.includes('合成投稿正文'))
 await f.store.reconcile();assert.equal(f.memories.get(e.c.id).status,'revoked');assert.equal(f.rewards.size,1)
})
test('real HTTP gives anonymous HttpOnly ownership and checks Origin, exact session, source token and no forged review',async t=>{
 const f=await albums(t),config={webOrigin:f.config.publicOrigin,serviceToken:'a'.repeat(64),albums:f.config},app=await NestFactory.create(SocialModule.register(config,f.social),{logger:false})
 app.use(socialHeaders);app.useGlobalFilters(new SocialErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close());const origin=await app.getUrl(),a=await f.create(),token=new URL(a.url).pathname.split('/').at(-1)
 let r=await fetch(origin+'/v1/public/shared-albums/'+token);assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly/);const cookie=r.headers.get('set-cookie').split(';')[0]
 const path='/v1/public/shared-albums/'+token+'/contributions',key=randomUUID(),body={text:'访客合成投稿',allowAdoption:true},headers={Cookie:cookie,Origin:config.webOrigin,'Content-Type':'application/json','Idempotency-Key':key}
 r=await fetch(origin+path,{method:'POST',headers:{...headers,Origin:'https://foreign.example'},body:JSON.stringify(body)});assert.equal(r.status,403)
 r=await fetch(origin+path,{method:'POST',headers,body:JSON.stringify(body)});assert.equal(r.status,201);const saved=(await r.json()).data;assert.equal(saved.status,'pending')
 r=await fetch(origin+path,{method:'POST',headers,body:JSON.stringify(body)});assert.equal((await r.json()).data.id,saved.id)
 r=await fetch(origin+'/v1/shared-albums/'+a.id,{headers:{Cookie:'test='+f.owner,'X-Xijie-Expected-Session':f.guest}});assert.equal(r.status,404)
 r=await fetch(origin+'/internal/v1/shared-albums/'+a.id+'/contributions/'+saved.id+'/source?version=1',{headers:{Authorization:'Bearer '+'d'.repeat(64),'X-Xijie-Account-Id':f.owner}});assert.equal(r.status,403)
 r=await fetch(origin+path+'/'+saved.id+'/review',{method:'POST',headers,body:'{}'});assert.equal(r.status,404)
})
test('separate Social and Memories databases complete adoption over real controlled HTTP and revoke every readable copy',async t=>{
 const f=await albums(t),m=await memoryFixture(t),a=await f.create(),e=await f.submit(a);await f.store.review(e.c.id,'approved',undefined,'reviewer')
 m.accounts.set(f.owner,{accountId:f.owner,status:'active',accessVersion:1,storyStorage:{allowed:true,authorizationVersion:1},aiTextProcessing:{allowed:true,authorizationVersion:1}})
 m.people.set(f.person.id,{...f.person,accountId:f.owner,status:'active',story:'合成人物',relationship:'朋友'})
 const socialToken='a'.repeat(64),memoryToken=f.config.memoriesToken,config={webOrigin:f.config.publicOrigin,serviceToken:socialToken,albums:f.config}
 const socialApp=await NestFactory.create(SocialModule.register(config,f.social),{logger:false});socialApp.use(socialHeaders);socialApp.useGlobalFilters(new SocialErrors());await socialApp.listen(0,'127.0.0.1');t.after(()=>socialApp.close())
 const memoryConfig={webOrigin:f.config.publicOrigin,serviceToken:memoryToken,socialToken,conversationsToken:'d'.repeat(64),socialOrigin:await socialApp.getUrl()}
 const sourceAdapter=new MemoryDependencies(memoryConfig);m.dependencies.sharedSource=sourceAdapter.sharedSource.bind(sourceAdapter)
 const memoryApp=await NestFactory.create(MemoriesModule.register(memoryConfig,m.store),{logger:false});memoryApp.use(memoryHeaders);memoryApp.useGlobalFilters(new MemoryErrors());await memoryApp.listen(0,'127.0.0.1');t.after(()=>memoryApp.close())
 const targetAdapter=new SocialDependencies({...config,memoriesOrigin:await memoryApp.getUrl()});f.downstream.adoptAlbum=targetAdapter.adoptAlbum.bind(targetAdapter);f.downstream.revokeAlbumSource=targetAdapter.revokeAlbumSource.bind(targetAdapter)
 const result=await f.store.adopt(f.owner,a.id,e.c.id,randomUUID());assert.equal(result.status,'fulfilled');assert.equal((await m.store.detail(f.owner,f.person.id,result.memoryId)).body,'合成投稿正文')
 assert.equal((await m.pool.query("SELECT count(*)::int n FROM outbox_events WHERE payload->>'qualifiesForReferral'='true'")).rows[0].n,0)
 await f.store.withdraw(e.token,e.visitor,e.c.id,randomUUID());await assert.rejects(()=>m.store.detail(f.owner,f.person.id,result.memoryId),e=>e.status===404)
 await f.store.reconcile();assert.equal((await m.pool.query('SELECT count(*)::int n FROM memories')).rows[0].n,0);assert.equal((await m.pool.query('SELECT state FROM shared_memory_receipts')).rows[0].state,'revoked')
})
