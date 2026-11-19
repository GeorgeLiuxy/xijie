import assert from 'node:assert/strict'
import {test} from 'node:test'
import {RightsEngine} from '../dist/rights-engine.js'
test('shutdown during an in-flight claim releases the attempt without reading or sending private data',async()=>{
 let claim,called=0,released=0
 const pending=new Promise(resolve=>{claim=resolve})
 const engine=new RightsEngine({claim:()=>pending,release:async()=>{released++},ownSnapshot:async()=>{called++;throw new Error('must not read')}},{snapshot:async()=>{called++;throw new Error('must not send')}})
 const running=engine.run({requestId:'fixture',dispatchId:'fixture',dispatchGeneration:1});engine.stop();claim({kind:'export'})
 await assert.rejects(running,/Worker stopped during claim/);assert.equal(called,0);assert.equal(released,1)
})
