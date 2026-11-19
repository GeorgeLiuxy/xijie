import 'reflect-metadata'
import assert from 'node:assert/strict'
import {randomUUID,randomBytes} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'
import {fixture,post,comment} from './fixture.mjs'
import {SocialReviewController} from '../dist/content-review.js'
import {AlbumStore,visitorHash} from '../dist/albums.js'
async function setup(t){const f=await fixture(t);for(const name of['004_shared_albums.sql','005_content_moderation.sql'])await f.pool.query(await readFile(new URL('../db/'+name,import.meta.url),'utf8'));const token=randomBytes(32).toString('hex'),old=process.env.XIJIE_CONTENT_REVIEW_SERVICE_TOKEN;process.env.XIJIE_CONTENT_REVIEW_SERVICE_TOKEN=token;t.after(()=>{if(old===undefined)delete process.env.XIJIE_CONTENT_REVIEW_SERVICE_TOKEN;else process.env.XIJIE_CONTENT_REVIEW_SERVICE_TOKEN=old});return{...f,api:new SocialReviewController(f.store),request:(a,credential=token)=>({query:{},get(k){return{Authorization:'Bearer '+credential,'X-Xijie-Account-Id':a}[k]}})}}
test('source version changes during evidence reading reject the mixed snapshot instead of approving unreviewed text',async t=>{const f=await setup(t),a=f.account(),p=await f.store.create(a,randomUUID(),post()),original=f.api.subject.bind(f.api);let changed=false;f.api.subject=async(...args)=>{const result=await original(...args);if(!changed){changed=true;await f.store.react(a,p.id,randomUUID(),true)}return result};await assert.rejects(f.api.evidence(f.request(a),'post',p.id),{code:'SOURCE_CHANGED'})})
test('moderation really removes private posts, comments/reactions and world projections without rewriting committed facts',async t=>{
 const f=await setup(t),a=f.account(),b=f.account(),p=await f.store.create(a,randomUUID(),post());await f.store.comment(a,p.id,randomUUID(),comment());await f.store.react(a,p.id,randomUUID(),true);await assert.rejects(f.api.read(f.request(b),'post',p.id),{code:'NOT_FOUND'});await assert.rejects(f.api.read(f.request(a,'f'.repeat(64)),'post',p.id),{code:'FORBIDDEN'});const source=(await f.api.read(f.request(a),'post',p.id)).data;assert.equal((await f.api.evidence(f.request(a),'post',p.id)).data.text,p.body)
 const intent={reportId:randomUUID(),operationId:randomUUID(),containerId:p.id,sourceKind:'user',version:source.version,sourceHash:source.hash};await assert.rejects(f.api.restrict(f.request(a),'post',p.id,{...intent,version:1}),{code:'VERSION_CONFLICT'});await f.api.restrict(f.request(a),'post',p.id,intent);await f.api.restrict(f.request(a),'post',p.id,intent);await assert.rejects(f.store.detail(a,p.id),{code:'NOT_FOUND'});const row=(await f.pool.query('SELECT * FROM posts WHERE id=$1',[p.id])).rows[0];assert.equal(row.comment_count,0);assert.equal(row.reaction_count,0);assert.equal(row.version,source.version+1)
 const person=f.makePerson(a);person.move();const feed=await f.store.feed(a,{},undefined,20),movement=feed.find(p=>p.kind==='world_notice');assert(movement);const before=(await f.pool.query('SELECT source_hash FROM posts WHERE id=$1',[movement.id])).rows[0].source_hash;await f.api.restrict(f.request(a),'post',movement.id,{reportId:randomUUID(),operationId:randomUUID(),containerId:movement.id,sourceKind:'world_notice',version:movement.version});assert.equal((await f.pool.query('SELECT source_hash FROM posts WHERE id=$1',[movement.id])).rows[0].source_hash,before);await assert.rejects(f.store.detail(a,movement.id),{code:'NOT_FOUND'});assert(!(await f.store.feed(a,{},undefined,20)).some(p=>p.id===movement.id))
})
test('a report targets exactly one private comment, rejects a changed fingerprint and keeps the parent post', async t => {
 const f=await setup(t),owner=f.account(),other=f.account()
 const p=await f.store.create(owner,randomUUID(),post())
 const shown=await f.store.comment(owner,p.id,randomUUID(),comment('第一条合成评论'))
 const retained=await f.store.comment(owner,p.id,randomUUID(),comment('第二条合成评论'))
 await assert.rejects(f.api.read(f.request(other),'comment',shown.id),{code:'NOT_FOUND'})
 const review=(await f.api.evidence(f.request(owner),'comment',shown.id)).data
 assert.equal(review.source.subjectType,'comment')
 assert.equal(review.source.containerId,p.id)
 assert.equal(review.text,shown.body)
 const intent={reportId:randomUUID(),operationId:randomUUID(),containerId:p.id,sourceKind:'self',version:review.source.version,sourceHash:review.source.hash}
 await assert.rejects(f.api.restrict(f.request(owner),'comment',shown.id,{...intent,sourceHash:'f'.repeat(64)}),{code:'VERSION_CONFLICT'})
 assert.deepEqual((await f.api.restrict(f.request(owner),'comment',shown.id,intent)).data,{subjectId:shown.id,restricted:true})
 assert.deepEqual((await f.api.restrict(f.request(owner),'comment',shown.id,intent)).data,{subjectId:shown.id,restricted:true})
 await assert.rejects(f.api.evidence(f.request(owner),'comment',shown.id),{code:'NOT_FOUND'})
 assert.equal((await f.api.evidence(f.request(owner),'comment',retained.id)).data.text,retained.body)
 assert.equal((await f.store.detail(owner,p.id)).commentCount,1)
})
test('album moderation records its own decision, revokes adopted source immediately and cannot replay as a visitor withdrawal',async t=>{
 const f=await setup(t),owner=f.account(),guest=f.account(),person=f.makePerson(owner).person,revoked=[],albums=new AlbumStore(f.store,{enabled:true,tokenKey:randomBytes(32),publicOrigin:'http://127.0.0.1:5184'},{async adoptAlbum(_a,albumId,contributionId){return{albumId,contributionId,memoryId:randomUUID(),version:1,status:'fulfilled'}},async revokeAlbumSource(a,album,id){revoked.push(id)}});f.store.albums=albums;const album=await albums.create(owner,randomUUID(),{personId:person.id,title:'合成标题',message:'合成附言'}),token=new URL(album.url).pathname.split('/').at(-1),visitor=visitorHash(randomBytes(32).toString('base64url')),c=await albums.submit(token,visitor,randomUUID(),{text:'待核查合成投稿',allowAdoption:true});await albums.review(c.id,'approved',undefined,'synthetic-reviewer');await albums.adopt(owner,album.id,c.id,randomUUID());const current=(await f.api.read(f.request(owner),'contribution',c.id)).data;await assert.rejects(f.api.read(f.request(guest),'contribution',c.id),{code:'NOT_FOUND'});const intent={reportId:randomUUID(),operationId:randomUUID(),containerId:album.id,sourceKind:'contribution',version:current.version};await f.api.restrict(f.request(owner),'contribution',c.id,intent);await f.api.restrict(f.request(owner),'contribution',c.id,intent);await assert.rejects(albums.source(owner,album.id,c.id,current.version),{code:'NOT_FOUND'});assert.equal((await f.pool.query('SELECT status FROM shared_album_adoptions WHERE contribution_id=$1',[c.id])).rows[0].status,'revoked');assert.equal((await albums.publicView(token,visitor)).contribution.text,'');const audit=(await f.pool.query("SELECT * FROM shared_album_decisions WHERE contribution_id=$1 AND decision='moderate'",[c.id])).rows;assert.equal(audit.length,1);assert.equal(audit[0].visitor_hash,null);assert.equal(audit[0].reviewer,intent.reportId)
})
