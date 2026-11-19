import 'reflect-metadata'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile,readdir} from 'node:fs/promises'
import {createServer} from 'node:http'
import pg from 'pg'
import {NestFactory} from '@nestjs/core'
import {PeopleStore} from '../dist/store.js'
import {ReminderStore,reminderInput,reminderAccount} from '../dist/reminders.js'
import {PeopleModule,PeopleErrors,peopleHeaders} from '../dist/http.js'
import {exportPeople,erasePeople} from '../dist/data-rights.js'

test('durable opt-in reminders honor local dates, yearly uniqueness, current authorization, receipts and erasure',async t=>{
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL;assert(connectionString)
 const schema='people_reminder_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString}),pool=new pg.Pool({connectionString,options:'-c search_path='+schema})
 await admin.query('CREATE SCHEMA '+schema);t.after(async()=>{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()})
 for(const file of(await readdir(new URL('../db/',import.meta.url))).filter(n=>/^\d+.*\.sql$/.test(n)).sort())await pool.query(await readFile(new URL('../db/'+file,import.meta.url),'utf8'))
 const store=new PeopleStore(pool),reminders=new ReminderStore(pool),account=randomUUID(),grant={allowed:true,authorizationVersion:1},session=randomUUID(),world=(await store.worlds(undefined,1))[0]
 async function make(name,birthday){const d=await store.create(account,1,randomUUID(),{displayName:name,relationship:'合成朋友',story:'仅测试用资料'}),p=await store.createPreview(account,d.id,1,randomUUID(),d.version,{worldPreferenceId:world.id,previousPreviewId:null});const person=await store.confirm(account,d.id,1,randomUUID(),d.version,{previewId:p.id,worldId:world.id},randomUUID());await pool.query("UPDATE persons SET created_at='2026-06-01T00:00:00Z' WHERE id=$1",[person.id]);return store.updatePerson(account,person.id,randomUUID(),1,{birthMonthDay:birthday},randomUUID())}
 const person=await make('合成提醒','11-16'),tokyo=await make('东京合成','11-17'),leap=await make('闰日合成','02-29')
 assert.deepEqual(await reminders.get(account,person.id,grant),{personId:person.id,enabled:false,timeZone:null,version:1})
 assert.equal(await reminders.tick(async()=>grant,100,new Date('2028-11-16T04:00:00Z')),0)
 const key=randomUUID(),body=reminderInput({enabled:true,timeZone:'Asia/Shanghai'}),enabled=await reminders.update(account,person.id,grant,key,1,body)
 assert.equal(enabled.version,2);assert.equal(enabled.enabled,true)
 assert.deepEqual(await reminders.update(account,person.id,grant,key,1,body),enabled)
 await assert.rejects(reminders.update(account,person.id,grant,key,1,{enabled:false}),{code:'IDEMPOTENCY_CONFLICT'})
 await assert.rejects(reminders.update(account,person.id,grant,randomUUID(),1,body),{code:'VERSION_CONFLICT'})
 await assert.rejects(reminders.update(account,person.id,grant,randomUUID(),2,{enabled:true,timeZone:'America/New_York'}),{code:'TIME_ZONE_FROZEN'})
 await assert.rejects(reminders.update(randomUUID(),person.id,grant,randomUUID(),1,body),{code:'NOT_FOUND'})
 for(const input of [{enabled:'yes'},{enabled:true,timeZone:'fake/nope'},{enabled:true,unknown:1},[]])assert.throws(()=>reminderInput(input),{code:'INVALID_ARGUMENT'})
 await assert.rejects(pool.query("UPDATE person_reminder_settings SET time_zone='Etc/UTC' WHERE person_id=$1",[person.id]),{code:'23514'})
 await reminders.update(account,tokyo.id,grant,randomUUID(),1,{enabled:true,timeZone:'Asia/Tokyo'})
 await reminders.update(account,leap.id,grant,randomUUID(),1,{enabled:true,timeZone:'UTC'})
 assert.equal(await reminders.tick(async()=>{throw Error('Identity temporarily unavailable')},100,new Date('2028-11-16T04:00:00Z')),0)
 // Two concurrent workers cannot duplicate one birthday or consume the next day.
 const made=await Promise.all([reminders.tick(async()=>grant,100,new Date('2028-11-16T04:00:00Z')),new ReminderStore(pool).tick(async()=>grant,100,new Date('2028-11-16T04:00:00Z'))]);assert.equal(made.reduce((a,b)=>a+b),1)
 let notices=await reminders.list(account,grant,10);assert.equal(notices.length,1);assert.equal(notices[0].localDate,'2028-11-16');assert.equal(notices[0].personName,'合成提醒');assert.equal(notices[0].kind,'birthday')
 assert.equal(await reminders.tick(async()=>grant,100,new Date('2028-11-16T23:00:00Z')),1) // Tokyo is Nov 17, 08:00.
 assert.equal(await reminders.tick(async()=>grant,100,new Date('2028-11-17T02:00:00Z')),0)
 notices=await reminders.list(account,grant,10);assert.equal(notices.length,2)
 assert.equal((await reminders.list(account,grant,10,{createdAt:notices[0].createdAt,id:notices[0].id}))[0].id,notices[1].id)
 const readKey=randomUUID(),read=await reminders.read(account,notices[0].id,grant,readKey,1);assert.equal(read.version,2);assert(read.readAt)
 assert.deepEqual(await reminders.read(account,notices[0].id,grant,readKey,1),read)
 await assert.rejects(reminders.read(randomUUID(),notices[0].id,grant,randomUUID(),1),{code:'NOT_FOUND'})
 assert.equal((await reminders.list(account,{allowed:true,authorizationVersion:2},10)).length,0)
 assert.equal((await reminders.get(account,person.id,{allowed:false,authorizationVersion:2})).enabled,false)
 // A revoked/regranted purpose never silently reactivates the old schedule.
 await reminders.tick(async()=>({allowed:true,authorizationVersion:2}),100,new Date('2029-11-16T04:00:00Z'))
 const disabled=await reminders.get(account,person.id,{allowed:true,authorizationVersion:2});assert.equal(disabled.enabled,false);assert.equal(disabled.version,3)
 const off=await reminders.update(account,person.id,{allowed:true,authorizationVersion:2},randomUUID(),3,{enabled:false});assert.equal(off.timeZone,'Asia/Shanghai')
 // Confirmed-at anniversary shares the opt-in; no fabricated birthday needed.
 const meeting=await make('相见合成',null)
 await pool.query("UPDATE persons SET created_at='2026-11-16T00:00:00Z',updated_at=GREATEST(updated_at,'2026-11-16T00:00:00Z') WHERE id=$1",[meeting.id])
 await reminders.update(account,meeting.id,grant,randomUUID(),1,{enabled:true,timeZone:'UTC'})
 assert.equal(await reminders.tick(async()=>grant,100,new Date('2030-11-16T10:00:00Z')),1)
 assert.equal((await reminders.list(account,grant,10))[0].kind,'meeting_anniversary')
 // Leap day is sent on Feb 29 only, never shifted to an unrelated date.
 const leapSettings=await reminders.get(account,leap.id,grant)
 await reminders.update(account,leap.id,grant,randomUUID(),leapSettings.version,{enabled:true})
 assert.equal(await reminders.tick(async()=>grant,100,new Date('2031-02-28T10:00:00Z')),0)
 assert.equal(await reminders.tick(async()=>grant,100,new Date('2032-02-29T07:59:00Z')),0)
 assert.equal(await reminders.tick(async()=>grant,100,new Date('2032-02-29T08:00:00Z')),1)

 let currentGrant=grant
 const identity=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:req.url.startsWith('/internal/v1/accounts/')?{accountId:account,status:'active',accessVersion:1,storyStorage:currentGrant}:{accountId:account,sessionId:session,expiresAt:'2099-01-01T00:00:00Z',storyStorage:currentGrant}}))})
 await new Promise(resolve=>identity.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>identity.close(resolve)))
 const config={identityContextUrl:new URL('http://127.0.0.1:'+identity.address().port+'/internal/v1/session-context'),serviceToken:'a'.repeat(64),sessionCookie:'xijie_dev_session',webOrigin:'http://127.0.0.1:4444'}
 assert.deepEqual(await reminderAccount(config,account),grant)
 const app=await NestFactory.create(PeopleModule.register(config,store),{logger:false});app.use(peopleHeaders);app.useGlobalFilters(new PeopleErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close())
 const base=await app.getUrl(),headers={cookie:'xijie_dev_session='+'A'.repeat(43),'X-Xijie-Expected-Session':session,Origin:config.webOrigin,'Content-Type':'application/json','If-Match':'"v'+off.version+'"','Idempotency-Key':randomUUID()}
 let r=await fetch(base+'/v1/persons/'+person.id+'/reminder',{headers});assert.equal(r.status,200);assert.equal(r.headers.get('ETag'),'"v'+off.version+'"')
 r=await fetch(base+'/v1/persons/'+person.id+'/reminder',{method:'PUT',headers,body:'{"enabled":true}'});assert.equal(r.status,200)
 r=await fetch(base+'/v1/persons/'+person.id+'/reminder',{method:'PUT',headers:{...headers,Origin:'https://wrong.test'},body:'{"enabled":false}'});assert.equal(r.status,403)
 const missingMatch={...headers};delete missingMatch['If-Match'];r=await fetch(base+'/v1/persons/'+person.id+'/reminder',{method:'PUT',headers:missingMatch,body:'{"enabled":false}'});assert.equal(r.status,428)
 r=await fetch(base+'/v1/person-reminders?limit=1',{headers});assert.equal(r.status,200);let page=await r.json();assert.equal(page.data.length,1);assert(page.meta.nextCursor)
 r=await fetch(base+'/v1/person-reminders?limit=1&cursor='+encodeURIComponent(page.meta.nextCursor),{headers});assert.equal(r.status,200);assert.notEqual((await r.json()).data[0].id,page.data[0].id)
 r=await fetch(base+'/v1/person-reminders/'+page.data[0].id+'/read',{method:'POST',headers:{...headers,'Idempotency-Key':randomUUID(),'If-Match':'"v1"'},body:'{}'});assert.equal(r.status,200)
 currentGrant={allowed:false,authorizationVersion:2};r=await fetch(base+'/v1/person-reminders',{headers});assert.equal((await r.json()).data.length,0)
 const exported=await exportPeople(pool,account,'account_data');assert(exported.data.reminderSettings.length);assert(exported.data.reminderNotifications.length)
 await store.removePerson(account,meeting.id,randomUUID(),meeting.version,randomUUID());assert(!(await reminders.list(account,grant,100)).some(v=>v.personId===meeting.id))
 await erasePeople(pool,account,randomUUID());for(const table of ['person_reminder_settings','person_reminder_notifications','person_reminder_commands'])assert.equal((await pool.query('SELECT 1 FROM '+table+' WHERE account_id=$1',[account])).rowCount,0)
 await assert.rejects(reminders.update(account,person.id,grant,randomUUID(),1,body),{code:'NOT_FOUND'})
})
