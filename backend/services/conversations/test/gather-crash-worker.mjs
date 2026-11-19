import pg from 'pg'
import {ConversationQueue} from '../dist/queue.js'
import {GatherStore} from '../dist/gather.js'
import {GatherEngine} from '../dist/gather-engine.js'
const fixture=JSON.parse(process.env.GATHER_CRASH_CONTEXT)
const pool=new pg.Pool({connectionString:process.env.XIJIE_TEST_DATABASE_URL,options:'-c search_path='+process.env.GATHER_CRASH_SCHEMA})
const queue=await new ConversationQueue(process.env.XIJIE_TEST_DATABASE_URL,process.env.GATHER_CRASH_QUEUE_SCHEMA).start()
const dependencies={account:async()=>fixture.account,person:async(_a,id)=>fixture.people.find(p=>p.id===id),persons:async()=>fixture.people,gatherContext:async()=>fixture.directory,virtualWorld:async(_a,id)=>fixture.worlds.find(w=>w.personId===id),memories:async()=>[],automaticMemories:async()=>[]}
const engine=new GatherEngine(new GatherStore(pool,dependencies,queue),{generate:async input=>{process.send({stage:'model-started'});return new Promise((resolve,reject)=>input.signal.addEventListener('abort',()=>reject(new Error('Controlled shutdown')),{once:true}))}})
await queue.workGather((id,p)=>engine.run(id,p))
