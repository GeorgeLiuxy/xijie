import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'

const worldIds={courtyard:randomUUID(),tide:randomUUID(),isles:randomUUID()}
const worlds=Object.entries(worldIds).map(([code,id])=>({id,code,enabled:true}))
const person=(world='courtyard',id=randomUUID(),version=1)=>({id,worldId:worldIds[world],displayName:'合成人物',status:'active',version,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),relationship:'挚友',story:'合成资料',mediaLinks:[]})
const view=p=>({id:300,serverId:p.id,serverVersion:p.version,name:p.displayName,world:'courtyard'})
const json=data=>new Response(JSON.stringify({data}),{headers:{'Content-Type':'application/json'}})
const defer=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
// Exercise the real adapter with an isolated hook lifetime; browser UI acceptance
// is separate and does not use these transport or scheduling stubs.
const code=ts.transpileModule(await readFile(new URL('../src/servicePeople.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
async function harness(fetcher){
 let refIndex=0,effectIndex=0;const refs=[],effects=[],pending=[]
 const context=vm.createContext({fetch:(...args)=>fetcher(...args),crypto:globalThis.crypto,AbortController,DOMException,URLSearchParams,window:{setTimeout,clearTimeout},console})
 const react=new vm.SyntheticModule(['useRef','useEffect'],function(){
  this.setExport('useRef',value=>{const index=refIndex++;return refs[index]??(refs[index]={current:value})})
  this.setExport('useEffect',(fn,deps)=>{const index=effectIndex++,previous=effects[index];if(!previous||deps.some((value,i)=>value!==previous.deps[i]))pending.push(()=>{previous?.cleanup?.();effects[index]={deps:[...deps],cleanup:fn()}})})
 },{context})
 const i18n=new vm.SyntheticModule(['WORLD_IDS'],function(){this.setExport('WORLD_IDS',['courtyard','tide','isles'])},{context})
 const module=new vm.SourceTextModule(code,{context})
 await module.link(spec=>spec==='react'?react:spec==='./i18n'?i18n:Promise.reject(new Error('Unexpected runtime import '+spec)));await module.evaluate()
 const log={saved:[],removed:[],unauthorized:0,before:0}
 const callbacks={onSaved:(p,w)=>log.saved.push({id:p.id,version:p.version,world:w}),onRemoved:id=>log.removed.push(id),onUnauthorized:()=>log.unauthorized++,beforeWrite:()=>log.before++}
 return {log,api:module.namespace,flush(){while(pending.length)pending.shift()()},render(session,p,flush=true,photos,accountId){refIndex=0;effectIndex=0;callbacks.accountId=accountId;const value=module.namespace.usePersonManagement(session,p,callbacks,photos);if(flush)this.flush();return value},unmount(){effects.forEach(value=>value?.cleanup?.())}}
}

test('voice metadata alone establishes ready state, and management exposes only the real verified account and stable draft target',async()=>{
 const p=person(),account=randomUUID(),session=randomUUID(),target={kind:'person_draft',id:randomUUID()},voice={id:randomUUID(),version:1,durationMs:1200,mimeType:'audio/wav',byteSize:57644,sha256:'a'.repeat(64)},calls=[]
 const h=await harness(async(route,init)=>{calls.push({route,...init});if(route==='/v1/persons/'+p.id)return json({...p,version:2,voiceId:voice.id,readyVoice:voice,voiceTarget:target,conversationTone:'quiet',voiceTimbre:'deep'});if(route==='/v1/worlds/'+p.worldId)return json(worlds[0]);throw Error('Unexpected request')})
 assert.equal(h.api.displayConfirmedPerson({...p,hasVoice:true},'courtyard',1).hasVoice,false)
 const displayed=h.api.displayConfirmedPerson({...p,voiceId:voice.id,readyVoice:voice,voiceTarget:target,conversationTone:'quiet',voiceTimbre:'deep'},'courtyard',1);assert.equal(displayed.hasVoice,true);assert.equal(displayed.voiceTarget.id,target.id)
 assert.throws(()=>h.api.displayConfirmedPerson({...p,voiceId:voice.id},'courtyard',1),e=>e.code==='INVALID_RESPONSE')
 assert.throws(()=>h.api.displayConfirmedPerson({...p,readyVoice:{...voice,id:'-'.repeat(36)}},'courtyard',1),e=>e.code==='INVALID_RESPONSE')
 assert.equal(h.render(session,displayed).voiceContext,undefined)
 assert.equal(h.render(session,{...displayed,voiceTarget:{kind:'person_draft',id:'synthetic'}},true,undefined,account).voiceContext,undefined)
 const managed=h.render(session,displayed,true,undefined,account);assert.equal(managed.voiceContext.accountId,account);assert.equal(managed.voiceContext.sessionId,session);assert.equal(managed.voiceContext.draftId,target.id)
 await managed.save({voiceId:voice.id,conversationTone:'quiet',voiceTimbre:'deep'});const write=calls.find(c=>c.method==='PATCH');assert.deepEqual(JSON.parse(write.body),{voiceId:voice.id,conversationTone:'quiet',voiceTimbre:'deep'});assert.equal(write.headers['X-Xijie-Expected-Session'],session)
 h.render(randomUUID(),displayed,false,undefined,randomUUID());managed.voiceContext.onUnauthorized();assert.equal(h.log.unauthorized,0);h.flush();h.unmount()
})

test('move uses authoritative directory IDs, request guards, replay keys and returned current world',async()=>{
 const p=person(),session=randomUUID(),requests=[],h=await harness(async(route,init)=>{
  requests.push({route,...init})
  if(route.startsWith('/v1/worlds?'))return json(worlds)
  if(route.endsWith('/world'))return json({...p,worldId:worldIds.tide,version:2})
  if(route==='/v1/worlds/'+worldIds.tide)return json({...worlds[1],enabled:false})
  throw new Error('Unexpected route '+route)
 })
 const managed=h.render(session,view(p));await managed.move('tide');await managed.move('tide')
 const posts=requests.filter(req=>req.method==='POST')
 assert.equal(posts.length,2);assert.equal(posts[0].route,'/v1/persons/'+p.id+'/world')
 assert.deepEqual(JSON.parse(posts[0].body),{worldId:worldIds.tide})
 assert.equal(posts[0].headers['If-Match'],'"v1"');assert.equal(posts[0].headers['X-Xijie-Expected-Session'],session)
 assert.equal(posts[0].headers['Idempotency-Key'],posts[1].headers['Idempotency-Key'])
 assert.deepEqual(h.log.saved,[{id:p.id,version:2,world:'tide'},{id:p.id,version:2,world:'tide'}]);h.unmount()
})

test('structured portrait fields round trip independently from the original story and reject invalid limits',async()=>{
 const p={...person(),personality:['温和'],life:['清晨散步'],unknowns:['尚不确定的偏好'],catchphrase:'慢慢来'},calls=[]
 const h=await harness(async(route,init)=>{calls.push({route,...init});if(route==='/v1/persons/'+p.id)return json({...p,version:2});if(route==='/v1/worlds/'+p.worldId)return json(worlds[0]);throw Error('Unexpected route')})
 const display=h.api.displayConfirmedPerson(p,'courtyard',3);assert.deepEqual(Array.from(display.life),['清晨散步']);assert.equal(display.sourceStory,'合成资料');assert.equal(display.catchphrase,'慢慢来')
 const legacy=h.api.displayConfirmedPerson(person(),'courtyard',4);assert.deepEqual(Array.from(legacy.life),[]);assert.equal(legacy.sourceStory,'合成资料')
 const input={personality:[' 温和 '],life:[' 清晨散步 '],unknowns:[],catchphrase:''};assert.deepEqual(JSON.parse(JSON.stringify(h.api.personProfileInput(input))),{personality:['温和'],life:['清晨散步'],unknowns:[],catchphrase:null})
 for(const input of [{life:Array(101).fill('x')},{personality:['x'.repeat(201)]},{unknowns:['x'.repeat(501)]},{life:['\ud800']}])assert.throws(()=>h.api.personProfileInput(input),e=>e.code==='INVALID_ARGUMENT')
 assert.throws(()=>h.api.displayConfirmedPerson({...p,life:'not an array'},'courtyard',3),e=>e.code==='INVALID_RESPONSE')
 await h.render(randomUUID(),view(p)).save(input);assert.deepEqual(JSON.parse(calls[0].body),{personality:['温和'],life:['清晨散步'],unknowns:[],catchphrase:null});assert.equal(calls[0].headers['If-Match'],'"v1"');h.unmount()
})

test('lost acknowledgement retries the same mutation instead of committing a new client intent',async()=>{
 const p=person(),session=randomUUID(),keys=[];let post=0
 const h=await harness(async(route,init)=>{
  if(route.startsWith('/v1/worlds?'))return json(worlds)
  if(route.endsWith('/world')){keys.push(init.headers['Idempotency-Key']);if(++post===1)throw new TypeError('Synthetic lost acknowledgement');return json({...p,worldId:worldIds.isles,version:2})}
  if(route==='/v1/worlds/'+worldIds.isles)return json(worlds[2])
  throw new Error('Unexpected route')
 })
 const managed=h.render(session,view(p));await assert.rejects(()=>managed.move('isles'));assert.equal(h.log.saved.length,0)
 await managed.move('isles');assert.equal(keys[0],keys[1]);assert.equal(h.log.saved[0].world,'isles');h.unmount()
})

test('edit and reload resolve the actual world, and a missing directory entry never removes the person',async()=>{
 const p=person(),session=randomUUID();let directoryMissing=false
 const h=await harness(async(route,init)=>{
  if(route==='/v1/persons/'+p.id)return json({...p,worldId:worldIds.tide,version:4})
  if(route==='/v1/worlds/'+worldIds.tide)return directoryMissing?new Response('{}',{status:404}):json({...worlds[1],enabled:false})
  throw new Error('Unexpected route '+route)
 })
 const managed=h.render(session,view(p));await managed.save({name:'合成新称呼'});await managed.reload()
 assert.deepEqual(h.log.saved.map(row=>row.world),['tide','tide'])
 directoryMissing=true;await assert.rejects(()=>managed.reload(),error=>error.code==='INVALID_RESPONSE'&&error.status===502)
 assert.deepEqual(h.log.removed,[]);h.unmount()
})

test('a replay for an old destination applies current authority without reporting an old move success',async()=>{
 const p=person(),session=randomUUID()
 const h=await harness(async route=>route.startsWith('/v1/worlds?')?json(worlds):route.endsWith('/world')?json({...p,worldId:worldIds.isles,version:7}):route==='/v1/worlds/'+worldIds.isles?json(worlds[2]):Promise.reject(new Error('Unexpected route')))
 await assert.rejects(()=>h.render(session,view(p)).move('tide'),error=>error.code==='WORLD_CHANGED')
 assert.deepEqual(h.log.saved,[{id:p.id,version:7,world:'isles'}]);h.unmount()
})

test('render-time ownership rejects late old-account responses even before effect cleanup',async()=>{
 const a=person(),b=person(),wait=defer();let started
 const entered=new Promise(resolve=>{started=resolve})
 const h=await harness(async(route,init)=>{
  if(route.startsWith('/v1/worlds?'))return json(worlds)
  if(route==='/v1/persons/'+a.id+'/world'){started();return wait.promise}
  throw new Error('A stale request must not fetch or publish in the new scope')
 })
 const old=h.render(randomUUID(),view(a)),running=old.move('tide');await entered
 h.render(randomUUID(),view(b),false)
 wait.resolve(new Response(JSON.stringify({error:{code:'UNAUTHENTICATED'}}),{status:401}))
 await assert.rejects(()=>running);assert.equal(h.log.unauthorized,0);assert.deepEqual(h.log.saved,[])
 await assert.rejects(()=>old.move('isles'),error=>error.name==='AbortError');h.flush();h.unmount()
})

test('an unmounted profile and unknown or disabled worlds produce no mutation or late callback',async()=>{
 const p=person(),session=randomUUID(),wait=defer(),routes=[];let started
 const entered=new Promise(resolve=>{started=resolve})
 const h=await harness(async(route,init)=>{
  routes.push({route,method:init.method})
  if(route.startsWith('/v1/worlds?'))return json(worlds.map(row=>({...row,enabled:row.code==='courtyard'})))
  if(route==='/v1/persons/'+p.id){started();return wait.promise}
  throw new Error('Unavailable targets must not mutate')
 })
 const managed=h.render(session,view(p));await assert.rejects(()=>managed.move('tide'),error=>error.code==='WORLD_UNAVAILABLE')
 assert(!routes.some(req=>req.method==='POST'))
 const loading=managed.reload();await entered;h.unmount();wait.resolve(json({...p,worldId:worldIds.tide,version:9}))
 await assert.rejects(()=>loading,error=>error.name==='AbortError');assert.deepEqual(h.log.saved,[])
 await assert.rejects(()=>managed.reload(),error=>error.name==='AbortError')
})

test('the initial people read can resolve shared retired current homes without inventing a destination',async()=>{
 const a=person('tide'),b=person('tide');let detailReads=0
 const h=await harness(async route=>{
  if(route.startsWith('/v1/persons?'))return json([a,b])
  if(route.startsWith('/v1/worlds?'))return json([worlds[0]])
  if(route==='/v1/worlds/'+worldIds.tide){detailReads++;return json({...worlds[1],enabled:false})}
  throw new Error('Unexpected route')
 })
 const result=await h.api.readConfirmedPeople(randomUUID(),new AbortController().signal)
 assert.deepEqual(Array.from(result,row=>row.world),['tide','tide']);assert.equal(detailReads,1);h.unmount()
})


test('gathering world resolution reads retired worlds without any current person and rejects a mismatched directory identity',async()=>{
 let mismatched=false;const paths=[]
 const h=await harness(async route=>{paths.push(route);if(route.startsWith('/v1/worlds?'))return json([worlds[0]]);if(route==='/v1/worlds/'+worldIds.tide)return json({...worlds[1],id:mismatched?randomUUID():worldIds.tide,enabled:false});throw Error('No person read is needed')})
 const result=await h.api.readConversationWorlds(randomUUID(),new AbortController().signal,[worldIds.tide,worldIds.tide]);assert.equal(result.length,2);assert.equal(result[1].enabled,false);assert.equal(paths.length,2)
 mismatched=true;await assert.rejects(h.api.readConversationWorlds(randomUUID(),new AbortController().signal,[worldIds.tide]),error=>error.status===502);h.unmount()
})

test('person photo replacement preserves original mutation on lost receipt and uses stable draft upload target',async()=>{
 const p=person(),draftId=randomUUID(),existing={id:randomUUID()},newId=randomUUID(),calls=[],uploads=[];let patches=0
 const h=await harness(async(route,init)=>{
  if(route==='/v1/persons/'+p.id){calls.push({key:init.headers['Idempotency-Key'],match:init.headers['If-Match'],body:JSON.parse(init.body)});if(++patches===1)throw new TypeError('Lost photo receipt');return json({...p,version:2,mediaIds:[newId,existing.id]})}
  if(route==='/v1/worlds/'+p.worldId)return json(worlds[0])
  throw Error('Unexpected request')
 })
 const adapter={client:{async upload(prepared,target){uploads.push({prepared,target});return [newId]}},prepare:async sources=>sources}
 const managed=h.render(randomUUID(),{...view(p),photoTarget:{kind:'person_draft',id:draftId}},true,adapter)
 const selection=['data:image/jpeg;base64,c3ludGhldGlj',existing]
 await assert.rejects(()=>managed.replacePhotos(selection));assert.equal(h.log.saved.length,0)
 await managed.replacePhotos(selection)
 assert.equal(calls[0].key,calls[1].key);assert.equal(calls[0].match,'"v1"');assert.deepEqual(calls[0].body,{mediaIds:[newId,existing.id]})
 assert(uploads.every(item=>item.target===draftId));assert.equal(h.log.saved.length,1);h.unmount()
})

test('person photo removal sends empty authoritative list without uploading or needing photo bytes',async()=>{
 const p=person(),calls=[]
 const h=await harness(async(route,init)=>{
  if(route==='/v1/persons/'+p.id){calls.push(JSON.parse(init.body));return json({...p,version:2,mediaIds:[],media:[]})}
  if(route==='/v1/worlds/'+p.worldId)return json(worlds[0])
  throw Error('Unexpected request')
 })
 const managed=h.render(randomUUID(),{...view(p),photoTarget:{kind:'person_draft',id:randomUUID()}},true,{client:{upload(){throw Error('Removal cannot upload')}},prepare(){throw Error('Removal cannot process bytes')}})
 await managed.replacePhotos([]);assert.deepEqual(calls,[{mediaIds:[]}]);h.unmount()
})

test('a switched person scope fences late uploaded photo before any profile mutation',async()=>{
 const p=person(),wait=defer();const h=await harness(()=>{throw Error('Stale upload must not write')})
 const managed=h.render(randomUUID(),{...view(p),photoTarget:{kind:'person_draft',id:randomUUID()}},true,{client:{upload:()=>wait.promise},prepare:async sources=>sources})
 const pending=managed.replacePhotos(['synthetic']);await Promise.resolve();await Promise.resolve()
 h.render(randomUUID(),view(person()),false);wait.resolve([randomUUID()])
 await assert.rejects(()=>pending,error=>error.name==='AbortError');assert.equal(h.log.saved.length,0);h.flush();h.unmount()
})
