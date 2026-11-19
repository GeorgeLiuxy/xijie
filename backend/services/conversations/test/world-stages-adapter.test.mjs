import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {test} from 'node:test'
import {Dependencies} from '../dist/dependencies.js'
import {decodeWorldStages} from '../dist/virtual-world.js'

function scope(){
 const card=(code)=>({id:randomUUID(),code,displayName:'Synthetic '+code,catalogVersion:1,enabled:true})
 const a=card('courtyard'),b=card('tide')
 const current={accountId:randomUUID(),personId:randomUUID(),personVersion:15,worldVersion:11,reality:'virtual',branch:'main',currentWorld:a,recentMovements:[],revision:'a'.repeat(64)}
 const refs=[{worldId:a.id,worldVersion:1},{worldId:b.id,worldVersion:2},{worldId:a.id,worldVersion:11}]
 const value={accountId:current.accountId,personId:current.personId,personVersion:current.personVersion,currentWorldVersion:current.worldVersion,stages:[{worldVersion:1,world:a,basis:'departure_snapshot'},{worldVersion:2,world:{...b,enabled:false},basis:'arrival_snapshot'},{worldVersion:11,world:a,basis:'current_catalog'}]}
 return {current,refs,value}
}

test('historical stage decoder binds owner, versions, exact coverage and snapshot basis while permitting disabled historical worlds',()=>{
 const {current,refs,value}=scope()
 assert.deepEqual(decodeWorldStages(value,current,refs),value.stages)
 for(const mutate of [
  v=>{v.accountId=randomUUID()},v=>{v.personId=randomUUID()},v=>{v.personVersion--},v=>{v.currentWorldVersion--},
  v=>{v.stages.pop()},v=>{v.stages[1]=structuredClone(v.stages[0])},v=>{v.stages.push(structuredClone(v.stages[0]))},
  v=>{v.stages[0].world.id=randomUUID()},v=>{v.stages[0].worldVersion=12},v=>{v.stages[0].basis='arrival_snapshot'},
  v=>{v.stages[1].basis='departure_snapshot'},v=>{v.stages[2].basis='arrival_snapshot'},v=>{v.stages[2].world.catalogVersion++},
  v=>{v.stages[2].world.displayName='Different current catalog'},v=>{v.stages[1].world.enabled='false'},
  v=>{v.stages[1].unexpected='private'},v=>{v.unexpected='private'},
 ]){const changed=structuredClone(value);mutate(changed);assert.throws(()=>decodeWorldStages(changed,current,refs),{code:'DEPENDENCY_UNAVAILABLE'})}
 const withExtraCard=structuredClone(value);withExtraCard.stages[0].world.story='Private extra field'
 assert(!JSON.stringify(decodeWorldStages(withExtraCard,current,refs)).includes('Private extra field'))
})

test('People stage adapter sends the exact account and expected versions and refuses malformed/error/redirect responses',async t=>{
 const {current,refs,value}=scope(),serviceToken='cb'.repeat(32)
 let result=value,status=200,redirect=false,calls=0
 const server=createServer((req,res)=>{(async()=>{
  calls++;assert.equal(req.method,'POST');assert.equal(req.url,'/internal/v1/persons/'+current.personId+'/world-stages/resolve')
  assert.equal(req.headers.authorization,'Bearer '+serviceToken);assert.equal(req.headers['x-xijie-account-id'],current.accountId)
  const chunks=[];for await(const chunk of req)chunks.push(chunk)
  assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()),{expectedPersonVersion:15,expectedWorldVersion:11,stages:refs})
  if(redirect){res.writeHead(302,{Location:'http://example.invalid/'});res.end();return}
  res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({data:result}))
 })().catch(error=>{res.writeHead(500);res.end();throw error})})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve))})
 const adapter=new Dependencies({peopleOrigin:'http://127.0.0.1:'+server.address().port,serviceToken})
 assert.deepEqual(await adapter.resolveWorldStages(current,refs),value.stages)
 result={...value,accountId:randomUUID()};await assert.rejects(adapter.resolveWorldStages(current,refs),{code:'DEPENDENCY_UNAVAILABLE'})
 result=value
 for(const [failure,code]of [[404,'NOT_FOUND'],[409,'WORLD_CONTEXT_CHANGED'],[403,'DEPENDENCY_UNAVAILABLE'],[503,'DEPENDENCY_UNAVAILABLE']]){
  status=failure;await assert.rejects(adapter.resolveWorldStages(current,refs),{code})
 }
 status=200;redirect=true;await assert.rejects(adapter.resolveWorldStages(current,refs),{code:'DEPENDENCY_UNAVAILABLE'})
 assert.equal(calls,7)
})
