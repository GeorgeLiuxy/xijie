import 'reflect-metadata'
import assert from 'node:assert/strict'
import {randomBytes,randomUUID} from 'node:crypto'
import {readFile,readdir} from 'node:fs/promises'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {test} from 'node:test'
import pg from 'pg'
import {NestFactory} from '@nestjs/core'
import {PeopleStore} from '../dist/store.js'
import {PeopleModule,PeopleErrors,peopleHeaders} from '../dist/http.js'
import {draftFields,personFields} from '../dist/contracts.js'
import {exportPeople,erasePeople} from '../dist/data-rights.js'

const photo=()=>({id:randomUUID(),version:2,mimeType:'image/webp',byteSize:400,width:20,height:20})
const binding=media=>({media,expiresAt:new Date(Date.now()+60000).toISOString()})
async function fixture(t){
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL;assert(connectionString)
 const schema='people_photos_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString})
 await admin.query('CREATE SCHEMA '+schema)
 const pool=new pg.Pool({connectionString,options:'-c search_path='+schema})
 t.after(async()=>{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()})
 for(const file of(await readdir(new URL('../db/',import.meta.url))).filter(f=>/^\d+_.+\.sql$/.test(f)).sort())await pool.query(await readFile(new URL('../db/'+file,import.meta.url),'utf8'))
 return {pool,store:new PeopleStore(pool)}
}

test('ordered person photos survive reopening and confirmation, with authoritative replacement and rights',async t=>{
 const {pool,store}=await fixture(t),account=randomUUID(),other=randomUUID(),photos=Array.from({length:6},photo)
 let draft=await store.create(account,1,randomUUID(),{displayName:'Synthetic photo person',story:'Synthetic text only'})
 const initial=draft,key=randomUUID(),input={mediaIds:photos.map(p=>p.id)}
 assert.equal(draft.photoTarget.id,draft.id)
 await assert.rejects(store.update(account,draft.id,1,randomUUID(),draft.version,input),{code:'MEDIA_UNAVAILABLE'})
 await assert.rejects(store.update(account,draft.id,1,randomUUID(),draft.version,input,{media:photos,expiresAt:new Date(Date.now()-1).toISOString()}),{code:'MEDIA_BINDING_EXPIRED'})
 assert.equal((await store.get(account,draft.id)).version,1)
 draft=await store.update(account,draft.id,1,key,draft.version,input,binding(photos))
 assert.deepEqual(draft.media,photos);assert.deepEqual((await store.get(account,draft.id)).mediaIds,input.mediaIds)
 assert.deepEqual((await store.list(account,'draft',undefined,20))[0].media,photos)
 assert.deepEqual(await store.update(account,draft.id,1,key,initial.version,input,binding(photos)),draft)
 assert.equal(await store.photoWriteSource(account,draft.id,'draft',key,initial.version,input),undefined)
 await assert.rejects(store.photoWriteSource(account,draft.id,'draft',randomUUID(),1,input),{code:'VERSION_CONFLICT'})
 await assert.rejects(store.get(other,draft.id),{code:'NOT_FOUND'})
 const refs=photos.map(p=>({draftId:draft.id,mediaId:p.id,version:p.version}))
 assert.deepEqual(await store.validPhotos(account,refs),refs);assert.deepEqual(await store.validPhotos(other,refs),[])
 assert.deepEqual(await store.validPhotos(account,[{...refs[0],version:3}]),[])
 const world=(await store.worlds(undefined,1))[0],preview=await store.createPreview(account,draft.id,1,randomUUID(),draft.version,{worldPreferenceId:world.id,previousPreviewId:null})
 let person=await store.confirm(account,draft.id,1,randomUUID(),draft.version,{previewId:preview.id,worldId:world.id,relationship:'friend'},randomUUID())
 assert.deepEqual(person.mediaIds,input.mediaIds);assert.equal(person.avatarMediaLinkId,photos[0].id);assert.equal(person.photoTarget.id,draft.id)
 assert.deepEqual((await store.listPersons(account,undefined,undefined,20))[0].media,photos)
 // Confirmation owns the same references even after the original draft deadline.
 await pool.query("UPDATE person_drafts SET expires_at=updated_at+interval '1 millisecond' WHERE account_id=$1 AND id=$2",[account,draft.id])
 assert.deepEqual(await store.validPhotos(account,refs),refs);assert.deepEqual(await store.photoTarget(account,draft.id),{id:draft.id})
 for(const context of [await store.personContext(account,person.id),...(await store.personContexts(account))]){
  assert(!Object.hasOwn(context,'media'));assert(!Object.hasOwn(context,'mediaIds'));assert(!Object.hasOwn(context,'photoTarget'));assert.deepEqual(context.mediaLinks,[])
 }
 const exported=await exportPeople(pool,account,'interaction_data');assert.equal(exported.data.photoRefs.length,6);assert.deepEqual(exported.data.photoRefs.map(p=>p.mediaId),input.mediaIds)
 const newPhoto=photo(),replacement=[newPhoto,photos[2]],oldPerson=person,replaceKey=randomUUID()
 person=await store.updatePerson(account,person.id,replaceKey,person.version,{mediaIds:replacement.map(p=>p.id)},randomUUID(),binding(replacement))
 assert.equal(person.avatarMediaLinkId,newPhoto.id);assert.deepEqual(await store.validPhotos(account,refs),[refs[2]])
 assert.equal((await store.get(account,draft.id)).mediaIds[0],newPhoto.id)
 const replayedPhotoDraft=await store.update(account,draft.id,1,key,initial.version,input,binding(photos))
 assert.deepEqual(replayedPhotoDraft,await store.get(account,draft.id))
 assert.deepEqual(replayedPhotoDraft.mediaIds,person.mediaIds)
 assert.equal(replayedPhotoDraft.status,'confirmed');assert.equal(replayedPhotoDraft.version,draft.version+1)
 assert.notEqual((await exportPeople(pool,account,'interaction_data')).revision,exported.revision)
 await assert.rejects(store.updatePerson(account,person.id,randomUUID(),oldPerson.version,{mediaIds:[]},randomUUID(),{media:[]}),{code:'VERSION_CONFLICT'})
 person=await store.updatePerson(account,person.id,randomUUID(),person.version,{mediaIds:[]},randomUUID(),{media:[]})
 assert.deepEqual(person.mediaIds,[]);assert.equal(person.avatarMediaLinkId,undefined)
 assert.deepEqual(await store.validPhotos(account,refs),[])
 person=await store.updatePerson(account,person.id,randomUUID(),person.version,{mediaIds:[newPhoto.id]},randomUUID(),binding([newPhoto]))
 await store.removePerson(account,person.id,randomUUID(),person.version,randomUUID())
 assert.deepEqual(await store.validPhotos(account,[{draftId:draft.id,mediaId:newPhoto.id,version:2}]),[])
 await assert.rejects(store.photoTarget(account,draft.id),{code:'NOT_FOUND'})
 assert.equal((await exportPeople(pool,account,'account_data')).data.photoRefs.length,0)
 const alive=await store.create(other,1,randomUUID(),{}),p=photo()
 await store.update(other,alive.id,1,randomUUID(),alive.version,{mediaIds:[p.id]},binding([p]))
 const dead=await store.create(account,1,randomUUID(),{}),deadPhoto=photo()
 await store.update(account,dead.id,1,randomUUID(),dead.version,{mediaIds:[deadPhoto.id]},binding([deadPhoto]))
 await erasePeople(pool,account,randomUUID())
 assert.equal((await pool.query('SELECT count(*)::int n FROM person_draft_media WHERE account_id=$1',[account])).rows[0].n,0)
 assert.equal((await store.get(other,alive.id)).mediaIds.length,1)
 await assert.rejects(store.update(account,dead.id,1,randomUUID(),2,{mediaIds:[deadPhoto.id]},binding([deadPhoto])),{code:'NOT_FOUND'})
})

test('photo contract rejects duplicate, over-limit, unknown fields and creation-time foreign references',()=>{
 const id=randomUUID()
 for(const value of [null,'x',[id,id],Array.from({length:7},()=>randomUUID()),['wrong']]){
  assert.throws(()=>draftFields({mediaIds:value},true),{code:'INVALID_ARGUMENT'})
  assert.throws(()=>personFields({mediaIds:value}),{code:'INVALID_ARGUMENT'})
 }
 assert.throws(()=>draftFields({mediaIds:[id]},false),{code:'INVALID_ARGUMENT'})
 assert.deepEqual(draftFields({mediaIds:[]},true),{mediaIds:[]})
 assert.deepEqual(personFields({mediaIds:[id]}),{mediaIds:[id]})
})

test('photo HTTP boundaries recheck independent consent, session and source ownership outside SQL locks',async t=>{
 const {pool,store}=await fixture(t),account=randomUUID(),sessionId=randomUUID(),serviceToken=randomBytes(32).toString('hex'),mediaToken=randomBytes(32).toString('hex')
 const credential=randomBytes(32).toString('base64url'),metadata=photo();let allowed=false,authVersion=1,bindCount=0,revokeDuringBind=false,malformed=false
 const identity=createServer((req,res)=>{
  const context=req.url.startsWith('/internal/v1/accounts/')?{accountId:account,status:'active',accessVersion:1}:{accountId:account,sessionId,expiresAt:new Date(Date.now()+60000).toISOString(),storyStorage:{allowed:true,authorizationVersion:1},personPhotoStorage:{allowed,authorizationVersion:authVersion}}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:context}))
 });identity.listen(0,'127.0.0.1');await once(identity,'listening')
 const media=createServer(async(req,res)=>{
  bindCount++;assert.equal(req.headers.authorization,'Bearer '+serviceToken);assert.equal(req.headers['x-xijie-account-id'],account)
  const db=await pool.connect();try{await db.query('BEGIN');assert.equal((await db.query("SELECT pg_try_advisory_xact_lock(hashtextextended('xijie:people:erasure:' || $1,0)) AS available",[account])).rows[0].available,true);await db.query('ROLLBACK')}finally{db.release()}
  if(revokeDuringBind){allowed=false;authVersion++}
  const draftId=req.url.split('/')[5]
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:{draftId,media:[{...metadata,...(malformed?{byteSize:0}:{})}],expiresAt:new Date(Date.now()+60000).toISOString()}}))
 });media.listen(0,'127.0.0.1');await once(media,'listening')
 const config={identityContextUrl:new URL('http://127.0.0.1:'+identity.address().port+'/internal/v1/session-context'),serviceToken,mediaServiceToken:mediaToken,mediaOrigin:'http://127.0.0.1:'+media.address().port,webOrigin:'http://localhost',sessionCookie:'xijie_dev_session'}
 const app=await NestFactory.create(PeopleModule.register(config,store),{logger:false,abortOnError:false});app.use(peopleHeaders);app.useGlobalFilters(new PeopleErrors());await app.listen(0,'127.0.0.1')
 t.after(async()=>{await app.close();for(const s of [identity,media]){s.closeAllConnections();await new Promise(r=>s.close(r))}})
 const origin=await app.getUrl(),draft=await store.create(account,1,randomUUID(),{displayName:'Synthetic',story:'Synthetic text'})
 const headers={Cookie:'xijie_dev_session='+credential,Origin:config.webOrigin,'X-Xijie-Expected-Session':sessionId,'Content-Type':'application/json'}
 const patch=(body,version=1,extra={})=>fetch(origin+'/v1/person-drafts/'+draft.id,{method:'PATCH',headers:{...headers,'If-Match':'"v'+version+'"','Idempotency-Key':randomUUID(),...extra},body:JSON.stringify(body)})
 assert.equal((await patch({mediaIds:[metadata.id]})).status,403);assert.equal(bindCount,0)
 allowed=true
 assert.equal((await patch({mediaIds:[metadata.id]},1,{'X-Xijie-Expected-Session':randomUUID()})).status,401);assert.equal(bindCount,0)
 malformed=true;assert.equal((await patch({mediaIds:[metadata.id]})).status,503);malformed=false
 revokeDuringBind=true;assert.equal((await patch({mediaIds:[metadata.id]})).status,403);assert.equal((await store.get(account,draft.id)).version,1)
 revokeDuringBind=false;allowed=true
 const acceptedKey=randomUUID(),acceptedBody={mediaIds:[metadata.id]}
 const response=await patch(acceptedBody,1,{'Idempotency-Key':acceptedKey});assert.equal(response.status,200);assert.deepEqual((await response.json()).data.mediaIds,[metadata.id])
 const refs=[{draftId:draft.id,mediaId:metadata.id,version:metadata.version}],internal={Authorization:'Bearer '+mediaToken,'X-Xijie-Account-Id':account,'Content-Type':'application/json'}
 const validate=extra=>fetch(origin+'/internal/v1/media/people/validate',{method:'POST',headers:{...internal,...extra},body:JSON.stringify({refs})})
 assert.equal((await validate({Authorization:'Bearer '+serviceToken})).status,403)
 assert.deepEqual((await(await validate()).json()).data.valid,refs)
 assert.deepEqual((await(await fetch(origin+'/internal/v1/media/people/drafts/'+draft.id,{headers:internal})).json()).data,{id:draft.id})
 allowed=false;authVersion++
 assert.deepEqual((await(await validate()).json()).data.valid,refs)
 const count=bindCount
 assert.equal((await patch({mediaIds:[]},2)).status,200);assert.equal(bindCount,count)
 assert.equal((await patch({story:'Text still saves'},3)).status,200);assert.equal(bindCount,count)
 assert.deepEqual((await(await validate()).json()).data.valid,[])
 // Accepted retries use their receipt even if the old object is now unavailable and permission withdrawn.
 malformed=true
 const replay=await patch(acceptedBody,1,{'Idempotency-Key':acceptedKey});assert.equal(replay.status,200)
 const replayed=(await replay.json()).data
 assert.deepEqual(replayed.mediaIds,[]);assert.equal(replayed.version,4);assert.equal(replayed.story,'Text still saves');assert.equal(bindCount,count)
})
