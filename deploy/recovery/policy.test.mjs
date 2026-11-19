import assert from 'node:assert/strict'
import {test} from 'node:test'
import {capture,compareSnapshots,quarantine} from './policy.mjs'

function fakeRuntime(record) {
  return {query:async(_target,sql)=>{
    if(sql.includes('SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind'))return [{schema:'public',name:'persons',kind:'r'}]
    if(sql.includes('AS records'))return [{name:'public.persons',records:[record]}]
    return []
  },sql:async()=>{throw new Error('Unexpected mutation during capture')}}
}

test('capture keeps exact large integer changes and never returns private row text',async()=>{
  const privateText='PRIVATE_STORY_DO_NOT_REPORT'
  const record=n=>JSON.stringify({id:'11111111-1111-4111-8111-111111111111',account_id:'22222222-2222-4222-8222-222222222222',version:1,status:'active',story:privateText,sequence:'REPLACEME'}).replace(JSON.stringify('REPLACEME'),n)
  const one=await capture(fakeRuntime(record('9007199254740992')),{domain:'people'})
  const two=await capture(fakeRuntime(record('9007199254740993')),{domain:'people'})
  assert.notEqual(one.tables[0].digest,two.tables[0].digest)
  assert.notEqual(one.security.resources[0].digest,two.security.resources[0].digest)
  assert.equal(JSON.stringify(one).includes(privateText),false)
  assert.equal(JSON.stringify(compareSnapshots(one,two)).includes(privateText),false)
})

test('checkpoint comparison identifies resource removal, correction and consent changes',()=>{
  const before={domain:'memories',schemaDigest:'same',tables:[],migrations:[],queueCounts:[],security:{accounts:[],resources:[
    {accountId:'a',kind:'memory',id:'gone',version:1,state:'active',digest:'one'},
    {accountId:'a',kind:'memory',id:'edited',version:1,state:'active',digest:'two'},
    {accountId:'a',kind:'consent',id:'ai_text_processing',version:1,state:'recorded',digest:'three'},
  ]}}
  const current=structuredClone(before)
  current.security.resources.shift();current.security.resources[0].version=2;current.security.resources[0].digest='changed';current.security.resources[1].version=2
  const result=compareSnapshots([before],[current]);assert.equal(result.equal,false)
  assert.deepEqual(result.differences.map(item=>[item.id,item.change]).sort(),[['ai_text_processing','changed'],['edited','changed'],['gone','removed']])
  assert.equal(JSON.stringify(result).includes('digest'),false)
})

test('snapshot timestamps are not equality inputs, schema and queued work are',()=>{
  const one={domain:'identity',capturedAt:'old',schemaDigest:'same',tables:[],migrations:[],queueCounts:[],security:{accounts:[],resources:[]}}
  const two={...one,capturedAt:'new'};assert.equal(compareSnapshots(one,two).equal,true)
  assert.equal(compareSnapshots(one,{...two,schemaDigest:'changed'}).differences[0].kind,'schema')
  assert.equal(compareSnapshots(one,{...two,queueCounts:[{schema:'identity_rights_queue',states:[{state:'created',count:'1'}]}]}).differences[0].kind,'queue')
})

test('quarantine cannot act on a source or an unowned descriptor',async()=>{
  const runtime={query:async()=>{throw new Error('Should not inspect a forbidden target')},sql:async()=>{throw new Error('Should not mutate a forbidden target')}}
  await assert.rejects(quarantine(runtime,{domain:'identity',kind:'source'}),/owned isolated/)
  await assert.rejects(quarantine(runtime,{domain:'identity',kind:'target'}),/owned isolated/)
})

test('automatic memory checkpoint resources retain provenance, withdrawal and exact bigint sequences without exposing derived text',async()=>{
 const secret='PRIVATE_AUTOMATIC_BODY_DO_NOT_REPORT'
 const makeRows=(sequence,jobState='queued')=>({
  automatic_memory_sources:[JSON.stringify({id:'source',account_id:'a',state:'active',version:1})],
  automatic_memory_jobs:[JSON.stringify({id:'job',account_id:'a',source_record_id:'source',source_sequence:'BIGINT',source_version:1,state:jobState,version:jobState==='queued'?1:2,attempt_id:null,lease_until:null,retryable:false,finished_at:jobState==='queued'?null:'now',dispatch_generation:jobState==='queued'?1:2}).replace('"BIGINT"',sequence)],
  automatic_memory_entries:[JSON.stringify({id:'entry',account_id:'a',body:secret,state:'withdrawn',version:2})],
  automatic_memory_receipts:[JSON.stringify({event_id:'event',origin:'conversations',account_id:'a',outcome:'accepted'})],
 })
 const runtime=records=>({query:async(_target,sql)=>{
  if(sql.includes('SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind'))return Object.keys(records).map(name=>({schema:'public',name,kind:'r'}))
  if(sql.includes('AS records'))return Object.entries(records).map(([name,records])=>({name:'public.'+name,records}))
  return []
 }})
 const old=await capture(runtime(makeRows('9007199254740992')),{domain:'memories'})
 const blocked=await capture(runtime(makeRows('9007199254740992','blocked')),{domain:'memories'})
 const precise=await capture(runtime(makeRows('9007199254740993')),{domain:'memories'})
 const provenance=value=>value.core.find(item=>item.name==='public.automatic_memory_jobs:provenance').digest
 assert.equal(provenance(old),provenance(blocked))
 assert.notEqual(provenance(old),provenance(precise))
 assert.deepEqual(old.security.resources.map(row=>row.kind).sort(),['automatic_memory_entry','automatic_memory_job','automatic_memory_receipt','automatic_memory_source'])
 assert.equal(old.security.resources.find(row=>row.kind==='automatic_memory_entry').state,'withdrawn')
 assert.equal(old.security.resources.find(row=>row.kind==='automatic_memory_receipt').id,'conversations:event')
 const removed=structuredClone(old);removed.security.resources=removed.security.resources.filter(row=>row.kind!=='automatic_memory_entry')
 assert.ok(compareSnapshots(old,removed).differences.some(diff=>diff.resourceKind==='automatic_memory_entry'&&diff.change==='removed'))
 assert.equal(JSON.stringify({old,blocked,precise,differences:compareSnapshots(old,precise).differences}).includes(secret),false)
})

test('world movement checkpoints detect historical ABA and removals without exposing world snapshots',async()=>{
 const accountId='11111111-1111-4111-8111-111111111111',personId='22222222-2222-4222-8222-222222222222'
 const secret='PRIVATE_WORLD_SNAPSHOT_DO_NOT_REPORT'
 const records=versions=>({
  persons:[JSON.stringify({id:personId,account_id:accountId,status:'active',world_id:'world-a',version:versions.length+1,world_version:versions.length+1})],
  person_world_movements:versions.map((worldVersion,index)=>JSON.stringify({id:'move-'+worldVersion,account_id:accountId,person_id:personId,world_version:worldVersion,person_version:worldVersion,
   from_world_id:index%2?'world-b':'world-a',to_world_id:index%2?'world-a':'world-b',from_world:{displayName:secret},to_world:{displayName:secret},reality:'virtual',branch:'main'})),
 })
 const runtime=value=>({query:async(_target,sql)=>{
  if(sql.includes('SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind'))return Object.keys(value).map(name=>({schema:'public',name,kind:'r'}))
  if(sql.includes('AS records'))return Object.entries(value).map(([name,records])=>({name:'public.'+name,records}))
  return []
 }})
 const before=await capture(runtime(records([])),{domain:'people'})
 const after=await capture(runtime(records([2,3])),{domain:'people'})
 const resources=after.security.resources.filter(row=>row.kind==='person_world_movement')
 assert.deepEqual(resources.map(row=>[row.id,row.version,row.state]),[['move-2',2,'committed'],['move-3',3,'committed']])
 assert.ok(compareSnapshots(before,after).differences.some(row=>row.resourceKind==='person_world_movement'&&row.id==='move-3'&&row.change==='added'))
 const removed=structuredClone(after);removed.security.resources=removed.security.resources.filter(row=>row.id!=='move-2')
 assert.ok(compareSnapshots(after,removed).differences.some(row=>row.resourceKind==='person_world_movement'&&row.id==='move-2'&&row.change==='removed'))
 assert.equal(JSON.stringify({before,after,removed,differences:compareSnapshots(before,after).differences}).includes(secret),false)
})
