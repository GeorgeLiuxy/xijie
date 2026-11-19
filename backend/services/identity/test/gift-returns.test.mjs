import 'reflect-metadata'
import assert from 'node:assert/strict'
import {createHash,randomBytes,randomUUID} from 'node:crypto'
import {readFile,readdir} from 'node:fs/promises'
import {test} from 'node:test'
import pg from 'pg'
import {NestFactory} from '@nestjs/core'
import {IdentityStore} from '../dist/store.js'
import {ConsentStore} from '../dist/consent-store.js'
import {IdentityModule,IdentityErrors,identityHeaders} from '../dist/http.js'

test('AI gift returns are an independent notice-bound purpose; prior grants and policies are unchanged',async t=>{
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL;assert(connectionString)
 const schema='gift_returns_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString});await admin.query('CREATE SCHEMA '+schema)
 const pool=new pg.Pool({connectionString,options:'-c search_path='+schema});t.after(async()=>{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()})
 for(const file of(await readdir(new URL('../db/',import.meta.url))).filter(f=>/^(00[1-9]|010|011)_/.test(f)).sort())await pool.query(await readFile(new URL('../db/'+file,import.meta.url),'utf8'))
 const identity=new IdentityStore(pool),consents=new ConsentStore(pool,identity),browserHash=randomUUID(),id=randomUUID(),stateHash=randomUUID(),claimId=randomUUID(),proof=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(proof).digest('hex')
 await identity.begin({id,browserHash,key:randomUUID(),purpose:'sign_in',sessionHash:null,stateHash,nonce:randomUUID(),verifier:randomUUID(),authorizationUrl:'https://id.example.test/oidc/auth',expiresAt:new Date(Date.now()+60000)})
 await identity.claim({browserHash,stateHash,claimId});assert(await identity.finish({browserHash,attemptId:id,claimId,sessionHash:hash,principal:{issuer:'https://id.example.test/oidc',subject:'gift-return-synthetic',authenticatedAt:new Date()}}));const actor=await identity.current(hash)
 const record=async(purpose,decision,expectedAuthorizationVersion)=>{const p=(await consents.policies('en')).find(p=>p.kind===purpose);return consents.record(hash,actor.id,randomUUID(),randomUUID(),{policyId:p.id,version:p.version,purpose,decision,expectedAuthorizationVersion})}
 await record('privacy_notice','acknowledge',0);await record('private_story_storage','grant',0);await record('ai_text_processing','grant',0);await record('virtual_gift_storage','grant',0)
 const before=await consents.authorizations(actor.accountId),policies=(await pool.query('SELECT * FROM policy_versions ORDER BY kind,version')).rows
 await pool.query(await readFile(new URL('../db/012_person_gift_returns.sql',import.meta.url),'utf8'))
 assert.deepEqual((await pool.query("SELECT * FROM policy_versions WHERE kind<>'person_gift_returns' ORDER BY kind,version")).rows,policies)
 let auth=await consents.authorizations(actor.accountId);assert.deepEqual(auth,{...before,giftReturns:{allowed:false,authorizationVersion:0}})
 const token=randomBytes(32).toString('hex'),config={secure:false,origin:'http://localhost:5184',clientSecret:randomUUID(),giftsServiceToken:token}
 const app=await NestFactory.create(IdentityModule.register(config,identity,{},consents),{logger:false,abortOnError:false});app.use(identityHeaders);app.useGlobalFilters(new IdentityErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close());const origin=await app.getUrl()
 const headers={Cookie:'xijie_dev_session='+proof,'X-Xijie-Expected-Session':actor.id},policy=(await consents.policies('en')).find(p=>p.kind==='person_gift_returns'),key=randomUUID(),body={policyId:policy.id,version:policy.version,purpose:policy.kind,decision:'grant',expectedAuthorizationVersion:0}
 const submit=(payload=body,idempotencyKey=key)=>fetch(origin+'/v1/accounts/me/consents',{method:'POST',headers:{...headers,Origin:config.origin,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify(payload)})
 const first=await submit();assert.equal(first.status,201);const receipt=(await first.json()).data;assert.equal((await(await submit()).json()).data.id,receipt.id)
 assert.equal((await submit({...body,decision:'revoke'})).status,409)
 assert.equal((await submit(body,randomUUID())).status,412)
 auth=await consents.authorizations(actor.accountId);assert.deepEqual(auth,{...before,giftReturns:{allowed:true,authorizationVersion:1}})
 for(const path of ['/internal/v1/session-context','/internal/v1/accounts/'+actor.accountId+'/context']){
  const response=await fetch(origin+path,{headers:{...headers,Authorization:'Bearer '+token}});assert.equal(response.status,200);assert.deepEqual((await response.json()).data.giftReturns,auth.giftReturns)
 }
 await record('person_gift_returns','revoke',1);assert.deepEqual(await consents.authorizations(actor.accountId),{...before,giftReturns:{allowed:false,authorizationVersion:2}})
 assert.equal((await pool.query("SELECT count(*)::int n FROM outbox_events WHERE account_id=$1 AND type='GiftReturnsRevoked.v1'",[actor.accountId])).rows[0].n,1)
 const history=await consents.history(actor.accountId,1,null);assert.deepEqual(history.giftReturns,{allowed:false,authorizationVersion:2});assert.equal(history.currentAuthorizationVersions.person_gift_returns,2)
 await record('person_gift_returns','grant',2);assert.deepEqual((await consents.authorizations(actor.accountId)).giftReturns,{allowed:true,authorizationVersion:3})
 await record('privacy_notice','acknowledge',1);assert.equal((await consents.authorizations(actor.accountId)).giftReturns.allowed,false)
})
