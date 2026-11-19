import 'reflect-metadata'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {NestFactory} from '@nestjs/core'
import {fixture,input} from './fixture.mjs'
import {MemoryImports,memoryImportInput} from '../dist/imports.js'
import {ReferralQualification} from '../dist/referrals.js'
import {MemoryDataRights} from '../dist/data-rights.js'
import {MemoriesModule,MemoryErrors,memoryHeaders} from '../dist/http.js'
const batch=()=>({batchId:randomUUID(),sourceSha256:'a'.repeat(64),items:[{itemId:randomUUID(),title:'合成导入A',body:'文件里的原文。'},{itemId:randomUUID(),title:'合成导入B',body:'另一段原文。'}]})
test('memory imports commit one atomic, permanently idempotent batch, retain provenance and never award referral qualification',async t=>{
 const f=await fixture(t),a=f.account(),b=f.account(),imports=new MemoryImports(f.store),value=memoryImportInput(batch()),key=randomUUID()
 const result=await imports.create(a.id,a.person.id,key,1,value);assert.equal(result.itemCount,2);assert(result.items.every(v=>v.status==='active'))
 assert.deepEqual(await imports.create(a.id,a.person.id,key,1,value),result)
 assert.equal((await f.pool.query("SELECT 1 FROM memories WHERE account_id=$1 AND origin='import'",[a.id])).rowCount,2)
 const events=(await f.pool.query("SELECT payload FROM outbox_events WHERE account_id=$1 AND type='MemoryConfirmed.v1'",[a.id])).rows;assert.equal(events.length,2);assert(events.every(v=>v.payload.origin==='import'&&v.payload.qualifiesForReferral===false&&v.payload.echoAiAuthorizationVersion===0))
 assert.equal((await new ReferralQualification(f.store).get(a.id)).qualification,null)
 await assert.rejects(imports.create(b.id,a.person.id,randomUUID(),1,value),{code:'NOT_FOUND'})
 await assert.rejects(imports.create(a.id,a.person.id,key,1,{...value,sourceSha256:'b'.repeat(64)}),{code:'IDEMPOTENCY_CONFLICT'})
 await assert.rejects(imports.create(a.id,a.person.id,randomUUID(),1,value),{code:'IDEMPOTENCY_CONFLICT'})
 await assert.rejects(imports.create(a.id,a.person.id,randomUUID(),2,batch()),{code:'VERSION_CONFLICT'})
 const removed=result.items[0];await f.store.remove(a.id,a.person.id,removed.memoryId,randomUUID(),1)
 const replay=await imports.create(a.id,a.person.id,key,1,value);assert.equal(replay.items[0].status,'removed');assert.equal(replay.items[0].version,2);assert.equal((await f.store.list(a.id,a.person.id,undefined,100,true)).length,1)
 await f.pool.query("UPDATE memory_commands SET expires_at=clock_timestamp()-interval '1second',created_at=clock_timestamp()-interval '2seconds' WHERE account_id=$1",[a.id]);await f.store.sweepCommands();assert.deepEqual(await imports.create(a.id,a.person.id,key,1,value),replay)
 await assert.rejects(f.pool.query('UPDATE memory_import_batches SET item_count=1 WHERE account_id=$1',[a.id]),{code:'23514'})
 await assert.rejects(f.pool.query('DELETE FROM memory_import_items WHERE account_id=$1',[a.id]),{code:'23514'})
 await f.store.create(a.id,a.person.id,randomUUID(),input('真正手动珍藏之后才有邀请资格'))
 assert.equal((await new ReferralQualification(f.store).get(a.id)).qualification.origin,'manual')
})
test('an item/event failure rolls back the entire import, cursor, receipt and no native orphan import can commit',async t=>{
 const f=await fixture(t),a=f.account(),imports=new MemoryImports(f.store),value=batch();value.items[1].title='Forcefail'
 await f.pool.query("CREATE FUNCTION import_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.title='Forcefail' THEN RAISE EXCEPTION 'isolated failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER import_test_fail BEFORE INSERT ON memories FOR EACH ROW EXECUTE FUNCTION import_test_fail()")
 await assert.rejects(imports.create(a.id,a.person.id,randomUUID(),1,value));for(const table of ['memories','memory_import_batches','memory_import_items','outbox_events','memory_account_cursors'])assert.equal((await f.pool.query('SELECT 1 FROM '+table+' WHERE account_id=$1',[a.id])).rowCount,0,table)
 await f.pool.query('DROP TRIGGER import_test_fail ON memories; DROP FUNCTION import_test_fail()')
 const okay=await imports.create(a.id,a.person.id,randomUUID(),1,batch());assert.equal(okay.itemCount,2)
 await assert.rejects(f.pool.query("INSERT INTO memories(account_id,person_id,client_memory_id,request_hash,confirmed_seq,title,body,origin,created_at,confirmed_at,updated_at) VALUES($1,$2,$3,$4,100,'orphan','orphan','import',now(),now(),now())",[a.id,a.person.id,randomUUID(),'c'.repeat(64)]),{code:'23514'})
})

test('a person change during the committed import withholds stale acknowledgement and retries only the accepted batch',async t=>{
 const f=await fixture(t),a=f.account(),imports=new MemoryImports(f.store),value=batch(),key=randomUUID(),original=f.dependencies.person;let reads=0
 f.dependencies.person=async(...args)=>{if(++reads===3)f.people.get(a.person.id).version=2;return original(...args)}
 await assert.rejects(imports.create(a.id,a.person.id,key,1,value),{code:'SOURCE_CHANGED'})
 assert.equal((await f.pool.query('SELECT 1 FROM memories WHERE account_id=$1',[a.id])).rowCount,2)
 const retry=await imports.create(a.id,a.person.id,key,1,value);assert.equal(retry.itemCount,2);assert.equal((await f.pool.query('SELECT 1 FROM memories WHERE account_id=$1',[a.id])).rowCount,2)
})
test('import parsing and HTTP require exact bounded originals, account session, origin and person version',async t=>{
 for(const change of [{items:[]},{items:Array.from({length:51},()=>({itemId:randomUUID(),title:'t',body:'b'}))},{sourceSha256:'fake'},{other:1},{items:[{itemId:randomUUID(),title:'t',body:'\ud800'}]},{items:[{itemId:randomUUID(),title:'t'.repeat(121),body:'b'}]}])assert.throws(()=>memoryImportInput({...batch(),...change}),{code:'INVALID_ARGUMENT'})
 const f=await fixture(t),a=f.account(),value=batch(),app=await NestFactory.create(MemoriesModule.register({webOrigin:'http://localhost:4444',serviceToken:'a'.repeat(64)},f.store),{logger:false});app.use(memoryHeaders);app.useGlobalFilters(new MemoryErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close());const base=await app.getUrl(),path='/v1/persons/'+a.person.id+'/memory-imports',headers={cookie:a.cookie,Origin:'http://localhost:4444','Content-Type':'application/json','X-Xijie-Expected-Session':a.sid,'Idempotency-Key':randomUUID(),'If-Match':'"v1"'}
 let r=await fetch(base+path,{method:'POST',headers,body:JSON.stringify(value)});assert.equal(r.status,200);const first=(await r.json()).data;assert.equal(first.itemCount,2)
 r=await fetch(base+path,{method:'POST',headers,body:JSON.stringify(value)});assert.equal(r.status,200);assert.deepEqual((await r.json()).data,first)
 r=await fetch(base+path,{method:'POST',headers:{...headers,Origin:'https://wrong.test'},body:JSON.stringify(value)});assert.equal(r.status,403)
 const noExpected={...headers};delete noExpected['X-Xijie-Expected-Session'];r=await fetch(base+path,{method:'POST',headers:noExpected,body:JSON.stringify(value)});assert.equal(r.status,400)
 const noMatch={...headers};delete noMatch['If-Match'];r=await fetch(base+path,{method:'POST',headers:noMatch,body:JSON.stringify(value)});assert.equal(r.status,428)
 f.accounts.get(a.id).storyStorage.allowed=false;r=await fetch(base+path,{method:'POST',headers,body:JSON.stringify(value)});assert.equal(r.status,403)
})
test('import receipts join export and erasure; removed persons and delayed import writes remain fenced',async t=>{
 const f=await fixture(t),a=f.account(),imports=new MemoryImports(f.store),value=batch();await imports.create(a.id,a.person.id,randomUUID(),1,value)
 const requests=new Map(),rid=randomUUID(),rights=new MemoryDataRights(f.pool,f.dependencies);f.dependencies.dataRequest=async id=>requests.get(id)
 requests.set(rid,{requestId:rid,accountId:a.id,kind:'export',scope:'account_data',status:'processing',accountStatus:'active',accountAccessVersion:1})
 const exported=await rights.export(a.id,rid,'account_data');assert.equal(exported.data.importReceipts[0].batchId,value.batchId);assert(exported.data.memories.every(v=>v.origin==='import'))
 const erasure=randomUUID();requests.set(erasure,{requestId:erasure,accountId:a.id,kind:'delete_account',scope:'account_data',status:'processing',accountStatus:'deletion_pending',accountAccessVersion:2});await rights.erase(a.id,erasure)
 for(const table of ['memories','memory_import_batches','memory_import_items'])assert.equal((await f.pool.query('SELECT 1 FROM '+table+' WHERE account_id=$1',[a.id])).rowCount,0)
 await assert.rejects(imports.create(a.id,a.person.id,randomUUID(),1,batch()),e=>e.code==='42501'||e.code==='NOT_FOUND')
 const other=f.account();f.people.get(other.person.id).status='removed';await assert.rejects(imports.create(other.id,other.person.id,randomUUID(),1,batch()),{code:'NOT_FOUND'})
})
