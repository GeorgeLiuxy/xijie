import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {test} from 'node:test'
import {fixture,input} from './fixture.mjs'
import {createInput,patchInput} from '../dist/contracts.js'
import {MemoryError} from '../dist/contracts.js'
test('memory creation keeps permanent client identity, account cursor, references and events atomic',async t=>{
 const f=await fixture(t),a=f.account(),b=f.account(),text=input(),key=randomUUID()
 const first=await f.store.create(a.id,a.person.id,key,text)
 assert.equal((await f.store.create(a.id,a.person.id,key,text)).id,first.id)
 assert.equal((await f.store.create(a.id,a.person.id,randomUUID(),text)).id,first.id)
 await assert.rejects(f.store.create(a.id,a.person.id,key,{...text,title:'changed'}),{code:'IDEMPOTENCY_CONFLICT'})
 await assert.rejects(f.store.create(a.id,a.person.id,randomUUID(),{...text,body:'changed'}),{code:'IDEMPOTENCY_CONFLICT'})
 await assert.rejects(f.store.detail(b.id,a.person.id,first.id),{code:'NOT_FOUND'})
 const state=(await f.pool.query('SELECT (SELECT count(*) FROM memories)::int AS memories,(SELECT count(*) FROM outbox_events)::int AS events,(SELECT last_confirmed_seq FROM memory_account_cursors WHERE account_id=$1) AS seq',[a.id])).rows[0]
 assert.deepEqual(state,{memories:1,events:1,seq:'1'})
 const commands=(await f.pool.query('SELECT response FROM memory_commands')).rows
 assert.ok(commands.every(value=>!JSON.stringify(value).includes(text.body)))
 assert.ok(!(await f.pool.query('SELECT payload FROM outbox_events')).rows.some(value=>JSON.stringify(value).includes(text.body)))
})
test('concurrent confirmations have unique committed order and failed Outbox rolls back cursor and original',async t=>{
 const f=await fixture(t),a=f.account()
 await Promise.all(Array.from({length:12},(_,index)=>f.store.create(a.id,a.person.id,randomUUID(),input('并发原文'+index))))
 const rows=(await f.pool.query('SELECT confirmed_seq FROM memories WHERE account_id=$1 ORDER BY confirmed_seq',[a.id])).rows
 assert.deepEqual(rows.map(row=>row.confirmed_seq),Array.from({length:12},(_,i)=>String(i+1)))
 await f.pool.query("CREATE FUNCTION fail_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$; CREATE TRIGGER fail_event BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION fail_event()")
 await assert.rejects(f.store.create(a.id,a.person.id,randomUUID(),input('应回滚的原文')))
 const state=(await f.pool.query('SELECT last_confirmed_seq,(SELECT count(*) FROM memories WHERE account_id=$1)::int AS count FROM memory_account_cursors WHERE account_id=$1',[a.id])).rows[0]
 assert.deepEqual(state,{last_confirmed_seq:'12',count:12})
})
test('revision and tombstone preserve first confirmation, reject stale mutations and suppress old cached success',async t=>{
 const f=await fixture(t),a=f.account(),text=input(),createKey=randomUUID(),first=await f.store.create(a.id,a.person.id,createKey,text)
 const updateKey=randomUUID(),next=await f.store.patch(a.id,a.person.id,first.id,updateKey,1,{title:'更正标题'})
 assert.equal(next.version,2);assert.equal(next.confirmedAt,first.confirmedAt)
 assert.equal((await f.store.patch(a.id,a.person.id,first.id,updateKey,1,{title:'更正标题'})).version,2)
 await assert.rejects(f.store.patch(a.id,a.person.id,first.id,randomUUID(),1,{title:'过期更新'}),{status:412})
 const deleteKey=randomUUID(),removed=await f.store.remove(a.id,a.person.id,first.id,deleteKey,2)
 assert.equal(removed.version,3)
 assert.deepEqual(await f.store.remove(a.id,a.person.id,first.id,deleteKey,2),removed)
 await assert.rejects(f.store.detail(a.id,a.person.id,first.id),{status:404})
 await assert.rejects(f.store.create(a.id,a.person.id,createKey,text),{status:404})
 await assert.rejects(f.store.patch(a.id,a.person.id,first.id,updateKey,1,{title:'更正标题'}),{status:404})
 await f.pool.query("UPDATE memory_commands SET expires_at=created_at+interval '1 second',created_at=created_at-interval '2 days'")
 await f.store.sweepCommands()
 await assert.rejects(f.store.create(a.id,a.person.id,randomUUID(),text),{status:404})
 assert.equal((await f.pool.query('SELECT last_confirmed_seq FROM memory_account_cursors WHERE account_id=$1',[a.id])).rows[0].last_confirmed_seq,'1')
})
test('source provenance is verified but confirmed original survives removed source; removed person blocks all reads',async t=>{
 const f=await fixture(t),a=f.account(),b=f.account(),source=f.source(a),text={...input(),sourceMessageId:source.id,sourceMessageVersion:1}
 const original=await f.store.create(a.id,a.person.id,randomUUID(),text)
 assert.deepEqual(original.source,{kind:'message',messageId:source.id})
 await assert.rejects(f.store.create(b.id,b.person.id,randomUUID(),{...input(),sourceMessageId:source.id,sourceMessageVersion:1}),{code:'SOURCE_CHANGED'})
 await assert.rejects(f.store.create(a.id,a.person.id,randomUUID(),{...input(),sourceMessageId:source.id,sourceMessageVersion:7}),{code:'SOURCE_CHANGED'})
 f.sources.delete(source.id)
 const reread=await f.store.detail(a.id,a.person.id,original.id)
 assert.equal(reread.body,original.body);assert.equal(reread.source,undefined)
 assert.equal((await f.store.create(a.id,a.person.id,randomUUID(),text)).id,original.id)
 f.people.delete(a.person.id)
 await assert.rejects(f.store.detail(a.id,a.person.id,original.id),{status:404})
 await assert.rejects(f.store.list(a.id,a.person.id,undefined,10,true),{status:404})
 await assert.rejects(f.store.create(a.id,a.person.id,randomUUID(),text),{status:404})
 assert.equal((await f.store.search(a.id,'河边')).length,0)
})
test('revoked story storage blocks private reading while cleanup remains available; cursor pages contain real originals',async t=>{
 const f=await fixture(t),a=f.account(),first=await f.store.create(a.id,a.person.id,randomUUID(),input())
 await f.store.create(a.id,a.person.id,randomUUID(),input('另一份正文'))
 const latest=await f.store.list(a.id,a.person.id,undefined,1,true)
 const older=await f.store.list(a.id,a.person.id,{at:latest[0].confirmedAt,id:latest[0].id},1,true)
 assert.equal(older.length,1);assert.notEqual(older[0].id,latest[0].id)
 f.accounts.get(a.id).storyStorage.allowed=false
 await assert.rejects(f.store.detail(a.id,a.person.id,first.id),{status:403})
 await assert.rejects(f.store.search(a.id,'河边'),{status:403})
 await assert.rejects(f.store.context(a.id,a.person.id),{status:403})
 assert.equal((await f.store.remove(a.id,a.person.id,first.id,randomUUID(),1)).version,2)
})
test('atlas matching preserves explicit negatives, exact names and single-sentence evidence with current records',async t=>{
 const f=await fixture(t),a=f.account(),b=f.account()
 const negative=await f.store.create(a.id,a.person.id,randomUUID(),{...input('他不爱下棋，但是喜欢沿着河边散步。'),title:'习惯'})
 const positive=await f.store.create(a.id,a.person.id,randomUUID(),{...input('他喜欢下棋。'),title:'棋局'})
 await f.store.create(b.id,b.person.id,randomUUID(),input('他爱下棋。'))
 assert.ok(!(await f.store.search(a.id,'爱下棋的人')).some(hit=>hit.memoryId===negative.id))
 assert.ok((await f.store.search(a.id,'不爱下棋的人')).some(hit=>hit.memoryId===negative.id))
 assert.ok((await f.store.search(a.id,'喜欢下棋')).some(hit=>hit.memoryId===positive.id))
 assert.deepEqual((await f.store.search(a.id,'小远')).map(hit=>hit.kind),['person'])
 assert.equal((await f.store.search(a.id,'！！！')).length,0)
 assert.equal((await f.store.search(a.id,'ＥＬＹ·０１')).find(hit=>hit.kind==='world')?.worldCode,'courtyard')
 await f.store.remove(a.id,a.person.id,negative.id,randomUUID(),1)
 assert.ok(!(await f.store.search(a.id,'不爱下棋的人')).some(hit=>hit.memoryId===negative.id))
})
test('confirmed memory context is bounded, versioned and never invokes source-message or model services',async t=>{
 const f=await fixture(t),a=f.account()
 for(let i=0;i<12;i++)await f.store.create(a.id,a.person.id,randomUUID(),{...input('湖边长椅'+('记忆'.repeat(900))),title:'湖边'+i})
 f.dependencies.source=async()=>{throw new Error('Must not call Conversation from context')}
 const recent=await f.store.context(a.id,a.person.id);assert.equal(recent.memories.length,4)
 const relevant=await f.store.context(a.id,a.person.id,'湖边');assert.equal(relevant.memories.length,8)
 assert.ok(relevant.memories.every(memory=>[...memory.body].length<=1200&&memory.version===1))
 const picked=relevant.memories[0];await f.store.patch(a.id,a.person.id,picked.id,randomUUID(),1,{body:'被纠正的内容'})
 assert.equal((await f.store.detail(a.id,a.person.id,picked.id)).version,2)
})
test('optional source outage does not hide independent confirmed original, but current authority still governs it',async t=>{
 const f=await fixture(t),a=f.account(),source=f.source(a),original=await f.store.create(a.id,a.person.id,randomUUID(),{...input(),sourceMessageId:source.id,sourceMessageVersion:1})
 f.dependencies.source=async()=>{throw new MemoryError(503,'DEPENDENCY_UNAVAILABLE','Source unavailable')}
 const read=await f.store.detail(a.id,a.person.id,original.id)
 assert.equal(read.body,original.body);assert.equal(read.source,undefined)
 assert.equal((await f.store.list(a.id,a.person.id,undefined,10,true))[0].body,original.body)
 f.dependencies.source=async()=>{f.accounts.get(a.id).storyStorage.allowed=false;throw new MemoryError(503,'DEPENDENCY_UNAVAILABLE','Source unavailable')}
 await assert.rejects(f.store.detail(a.id,a.person.id,original.id),{status:403})
})
test('boundary parser rejects identity injection, invalid source pairing, empty/oversize and surrogate content',()=>{
 assert.throws(()=>createInput({...input(),accountId:randomUUID()}),{status:400})
 assert.throws(()=>createInput({...input(),sourceMessageId:randomUUID()}),{status:400})
 assert.throws(()=>createInput({...input(),body:'\ud800'}),{status:400})
 assert.throws(()=>createInput({...input(),title:'x'.repeat(121)}),{status:400})
 assert.throws(()=>patchInput({}),{status:400})
 assert.equal(createInput({...input(),body:'  正文  '}).body,'正文')
})
