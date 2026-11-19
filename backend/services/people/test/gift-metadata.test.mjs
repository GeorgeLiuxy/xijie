import 'reflect-metadata'
import assert from 'node:assert/strict'
import {randomUUID,randomBytes} from 'node:crypto'
import {readFile,readdir} from 'node:fs/promises'
import {createServer} from 'node:http'
import {test} from 'node:test'
import pg from 'pg'
import {NestFactory} from '@nestjs/core'
import {PeopleStore} from '../dist/store.js'
import {PeopleModule,PeopleErrors,peopleHeaders} from '../dist/http.js'
test('Gifts metadata has a distinct role, current account/person ownership, and no private story or photo',async t=>{
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL;assert(connectionString)
 const schema='people_gift_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString});await admin.query('CREATE SCHEMA '+schema)
 const pool=new pg.Pool({connectionString,options:'-c search_path='+schema}),store=new PeopleStore(pool)
 t.after(async()=>{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()})
 for(const file of(await readdir(new URL('../db/',import.meta.url))).filter(f=>/^\d+_.+\.sql$/.test(f)).sort())await pool.query(await readFile(new URL('../db/'+file,import.meta.url),'utf8'))
 const account=randomUUID(),draft=await store.create(account,1,randomUUID(),{displayName:'Synthetic recipient',story:'Never gift metadata',relationship:'friend'}),world=(await store.worlds(undefined,1))[0],preview=await store.createPreview(account,draft.id,1,randomUUID(),draft.version,{worldPreferenceId:world.id,previousPreviewId:null}),person=await store.confirm(account,draft.id,1,randomUUID(),draft.version,{previewId:preview.id,worldId:world.id},randomUUID())
 const giftToken=randomBytes(32).toString('hex'),peopleToken=randomBytes(32).toString('hex');let active=true
 const identity=createServer((req,res)=>{assert.equal(req.headers.authorization,'Bearer '+peopleToken);res.writeHead(active?200:404,{'Content-Type':'application/json'});res.end(JSON.stringify({data:{accountId:req.url.split('/')[4],status:'active',accessVersion:1}}))});await new Promise(r=>identity.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>identity.close(r)))
 const app=await NestFactory.create(PeopleModule.register({giftsServiceToken:giftToken,serviceToken:peopleToken,identityContextUrl:new URL('http://127.0.0.1:'+identity.address().port+'/internal/v1/session-context')},store),{logger:false});app.use(peopleHeaders);app.useGlobalFilters(new PeopleErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close())
 const origin=await app.getUrl(),get=(actor=account,token=giftToken)=>fetch(origin+'/internal/v1/gifts/persons/'+person.id+'?accountId='+actor,{headers:{Authorization:'Bearer '+token}})
 assert.equal((await get(account,peopleToken)).status,403);assert.equal((await get(randomUUID())).status,404)
 const response=await get();assert.equal(response.status,200);const data=(await response.json()).data
 assert.deepEqual(Object.keys(data).sort(),['id','accountId','displayName','worldId','version','worldVersion','accessVersion','status','audience'].sort());assert.equal(data.audience,'person');assert.equal(data.accountId,account)
 active=false;assert.equal((await get()).status,404);active=true
 await store.removePerson(account,person.id,randomUUID(),person.version,randomUUID());assert.equal((await get()).status,404)
})
