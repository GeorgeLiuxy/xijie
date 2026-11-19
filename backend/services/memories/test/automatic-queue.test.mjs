import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {setTimeout as sleep} from 'node:timers/promises'
import {test} from 'node:test'
import pg from 'pg'
import {fixture} from './automatic-fixture.mjs'
import {AutomaticMemoryQueue} from '../dist/automatic-queue.js'
import {AutomaticMemoryStore} from '../dist/automatic-store.js'
import {AutomaticMemoryEngine} from '../dist/automatic-engine.js'

test('native automatic queue commits only references and a real worker stores an independent automatic fact',async t=>{
 const f=await fixture(t),schema='auto_queue_'+randomUUID().replaceAll('-',''),queue=await new AutomaticMemoryQueue(f.connectionString,schema).start()
 t.after(async()=>{await queue.stop();const admin=new pg.Pool({connectionString:f.connectionString});try{await admin.query('DROP SCHEMA '+schema+' CASCADE')}finally{await admin.end()}})
 const a=f.account(),m={id:randomUUID(),accountId:a.id,personId:a.person.id,conversationId:randomUUID(),version:1,createdAt:new Date().toISOString(),sequence:'9223372036854775000',text:'我喜欢在院子里种花。',aiAuthorizationVersion:1,context:[]}
 f.dependencies.automaticMessage=async()=>structuredClone(m)
 f.dependencies.validAutomaticRefs=async(_aid,_pid,refs)=>refs.filter(ref=>ref.id===m.id&&ref.version===m.version)
 const store=new AutomaticMemoryStore(f.pool,f.dependencies,queue)
 const accepted=await store.ingest('conversations',{eventId:randomUUID(),accountId:a.id,personId:a.person.id,sourceKind:'message',sourceId:m.id,sourceVersion:1,change:'upsert',occurredAt:m.createdAt})
 const data=(await f.pool.query(`SELECT data FROM "${schema}".job WHERE data->>'jobId'=$1`,[accepted.jobId])).rows[0].data
 assert.deepEqual(Object.keys(data).sort(),['dispatchGeneration','dispatchId','jobId']);assert.ok(!JSON.stringify(data).includes(m.text))
 let calls=0;const engine=new AutomaticMemoryEngine(store,{async generate(){calls++;return {facts:[{body:'用户喜欢在院子里种花。',topic:'种花',timeDescription:'',evidence:m.text,supersedes:[]}]}}})
 await queue.work(value=>engine.run(value))
 const deadline=Date.now()+10000;let job
 do{job=await store.findJob(accepted.jobId);if(job.state==='succeeded')break;await sleep(50)}while(Date.now()<deadline)
 assert.equal(job.state,'succeeded');assert.equal(calls,1);assert.equal((await store.context(a.id,a.person.id,'种花')).length,1)
 assert.equal((await f.pool.query('SELECT count(*) FROM memories')).rows[0].count,'0')
})
