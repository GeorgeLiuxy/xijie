import 'reflect-metadata'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,randomBytes,createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import pg from 'pg'
import {NestFactory} from '@nestjs/core'
import {IdentityStore} from '../dist/store.js'
import {AccountProfileStore,accountProfileInput} from '../dist/account-profile.js'
import {IdentityModule,IdentityErrors,identityHeaders} from '../dist/http.js'
import {ConsentStore} from '../dist/consent-store.js'
test('account nickname updates own current profile with session/version fences and permanent receipts',async t=>{
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL;assert(connectionString);const schema='profile_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString}),pool=new pg.Pool({connectionString,options:'-c search_path='+schema})
 await admin.query('CREATE SCHEMA '+schema);t.after(async()=>{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()})
 for(const file of['001_identity.sql','002_consents.sql','003_embedded_auth.sql','022_account_profile.sql'])await pool.query(await readFile(new URL('../db/'+file,import.meta.url),'utf8'))
 const store=new IdentityStore(pool),profiles=new AccountProfileStore(store),browserHash=randomUUID(),attemptId=randomUUID(),stateHash=randomUUID(),claimId=randomUUID(),proof=randomBytes(32).toString('base64url'),sessionHash=createHash('sha256').update(proof).digest('hex')
 await store.begin({id:attemptId,browserHash,key:randomUUID(),purpose:'sign_in',sessionHash:null,stateHash,nonce:randomUUID(),verifier:randomUUID(),authorizationUrl:'https://id.example.test/auth',expiresAt:new Date(Date.now()+60000)})
 await store.claim({browserHash,stateHash,claimId});await store.finish({browserHash,attemptId,claimId,sessionHash,principal:{issuer:'https://id.example.test',subject:randomUUID(),authenticatedAt:new Date()}})
 const session=await store.current(sessionHash),key=randomUUID(),input=accountProfileInput({displayName:'  合成新昵称 '})
 const saved=await profiles.update(sessionHash,session.id,key,session.version,input);assert.equal(saved.displayName,'合成新昵称');assert.equal(saved.version,session.version+1);assert.equal((await store.current(sessionHash)).displayName,'合成新昵称')
 assert.deepEqual(await profiles.update(sessionHash,session.id,key,session.version,input),saved);await assert.rejects(profiles.update(sessionHash,session.id,key,session.version,{displayName:'其他'}),{code:'IDEMPOTENCY_CONFLICT'})
 const changed=await profiles.update(sessionHash,session.id,randomUUID(),saved.version,{displayName:'后来的名字'});assert.equal((await profiles.update(sessionHash,session.id,key,session.version,input)).displayName,'后来的名字');assert.equal(changed.version,saved.version+1)
 await assert.rejects(profiles.update(sessionHash,session.id,randomUUID(),saved.version,input),{code:'VERSION_CONFLICT'});await assert.rejects(profiles.update(sessionHash,randomUUID(),randomUUID(),changed.version,input),{code:'UNAUTHENTICATED'})
 for(const name of['','x'.repeat(13),'\0','\ud800','带\n控制'])assert.throws(()=>accountProfileInput({displayName:name}),{code:'INVALID_ARGUMENT'})
 assert.equal([...accountProfileInput({displayName:'😀'.repeat(12)}).displayName].length,12)
 const config={secure:false,origin:'http://localhost:5184',clientSecret:randomUUID()},app=await NestFactory.create(IdentityModule.register(config,store,{},new ConsentStore(pool,store)),{logger:false,abortOnError:false});app.use(identityHeaders);app.useGlobalFilters(new IdentityErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close());const origin=await app.getUrl(),headers={Cookie:'xijie_dev_session='+proof,Origin:config.origin,'X-Xijie-Expected-Session':session.id,'Content-Type':'application/json','Idempotency-Key':randomUUID(),'If-Match':'"v'+changed.version+'"'}
 const response=await fetch(origin+'/v1/accounts/me',{method:'PATCH',headers,body:JSON.stringify({displayName:'HTTP昵称'})});assert.equal(response.status,200);const data=(await response.json()).data;assert.equal(data.displayName,'HTTP昵称');assert.equal(response.headers.get('etag'),'"v'+data.version+'"')
 const get=await fetch(origin+'/v1/accounts/me',{headers});assert.equal((await get.json()).data.displayName,'HTTP昵称')
 for(const override of[{Origin:'https://evil.example'},{'X-Xijie-Expected-Session':randomUUID()},{'If-Match':''},{'Idempotency-Key':'bad'}]){const r=await fetch(origin+'/v1/accounts/me',{method:'PATCH',headers:{...headers,...override},body:JSON.stringify({displayName:'不能保存'})});assert(r.status>=400)}
 await pool.query("UPDATE accounts SET status='deletion_pending' WHERE id=$1",[session.accountId]);await assert.rejects(profiles.update(sessionHash,session.id,randomUUID(),data.version,{displayName:'注销后'}),{code:'UNAUTHENTICATED'});await pool.query('DELETE FROM account_profile_commands WHERE account_id=$1',[session.accountId]);assert.equal((await pool.query('SELECT 1 FROM account_profile_commands WHERE account_id=$1',[session.accountId])).rowCount,0)
})
