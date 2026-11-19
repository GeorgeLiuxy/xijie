import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {fixture} from './fixture.mjs'
import pg from 'pg'
import {EchoQueue,ECHO_QUEUE} from '../dist/echo-queue.js'
test('the real pg-boss dispatch is transaction-bound, discoverable for recovery and erased without keeping payloads',async t=>{
 const f=await fixture(t),schema='social_queue_test_'+randomUUID().replaceAll('-',''),queue=await new EchoQueue(process.env.XIJIE_TEST_DATABASE_URL,schema).start()
 t.after(async()=>{await queue.stop();const cleanup=new pg.Pool({connectionString:process.env.XIJIE_TEST_DATABASE_URL});try{await cleanup.query('DROP SCHEMA '+schema+' CASCADE')}finally{await cleanup.end()}})
 const d={jobId:randomUUID(),dispatchId:randomUUID(),dispatchGeneration:1},db=await f.pool.connect()
 try{await db.query('BEGIN');await queue.send(db,d);await db.query('ROLLBACK');assert.equal((await queue.boss.findJobs(ECHO_QUEUE,{data:{jobId:d.jobId},limit:10})).length,0)
  await db.query('BEGIN');await queue.send(db,d);await db.query('COMMIT');assert.equal(await queue.isPending(db,d),true)
  const found=await queue.boss.findJobs(ECHO_QUEUE,{data:{jobId:d.jobId},limit:10});assert.deepEqual(found[0].data,d)
  await db.query('BEGIN');await queue.erase(db,[d.dispatchId]);await db.query('COMMIT');assert.equal(await queue.isPending(db,d),false)
 }finally{db.release()}
})
