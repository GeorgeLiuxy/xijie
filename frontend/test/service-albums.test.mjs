import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'
const code=ts.transpileModule(await readFile(new URL('../src/serviceAlbums.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const response=data=>new Response(JSON.stringify({data,meta:{nextCursor:null}}))
async function harness(fetch,storage=new Map()){
 const context=vm.createContext({fetch,crypto:globalThis.crypto,URL,Headers,URLSearchParams,DOMException,AbortSignal,location:{origin:'http://localhost',assign(){}},sessionStorage:{get length(){return storage.size},key:i=>[...storage.keys()][i]??null,getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}})
 const module=new vm.SourceTextModule(code,{context});await module.link(()=>{throw Error('Unexpected import')});await module.evaluate();return{api:module.namespace,storage}
}
const contribution=()=>({id:randomUUID(),text:'投稿人主动写下的正文',status:'pending',version:1,seat:null,reward:null})
const album=()=>({id:randomUUID(),personId:randomUUID(),title:'公开标题',message:'公开附言',url:'http://localhost/gifts/'+'b'.repeat(43),status:'active',version:1,createdAt:new Date().toISOString(),current:1,target:6,contributions:[]})
test('public album renders only its explicit public fields and the current visitor contribution',async()=>{
 const h=await harness(()=>{}),c=contribution(),v=h.api.publicAlbum({title:'公开标题',message:'公开附言',status:'active',current:1,target:6,contribution:c,contributions:[{text:'不应出现的他人正文'}],personId:randomUUID(),world:'tide'},'b'.repeat(43))
 assert.equal(v.contributions.length,1);assert.equal(v.contributions[0].text,c.text);assert.equal(v.helped,false);assert.equal(v.canHelp,false);assert.equal(v.world,'courtyard');assert.ok(!JSON.stringify(v).includes('不应出现'))
 assert.equal(h.api.publicAlbum({title:'标题',message:'附言',status:'active',current:2,target:6,contribution:{...c,status:'approved',seat:1}},'b'.repeat(43)).helped,true)
})
test('unknown creation freezes both public fields and the owned recipient through reload',async()=>{
 const v=album(),ctx={accountId:randomUUID(),sessionId:randomUUID(),onUnauthorized(){}},target={identity:v.personId,world:'tide'},storage=new Map(),calls=[];let attempts=0
 const transport=async(path,init)=>{calls.push({path,key:init.headers.get('Idempotency-Key'),body:init.body});if(++attempts===1)throw TypeError('Unknown result');return response(v)}
 let h=await harness(transport,storage);await assert.rejects(h.api.createAlbum(ctx,target,'原公开标题','原公开附言'))
 h=await harness(transport,storage);const saved=await h.api.createAlbum(ctx,target,'改动不应替换','改动不应替换')
 assert.deepEqual(calls[0],calls[1]);assert.equal(saved.id,v.id);assert.equal(storage.size,0)
})
test('adoption carries only the contribution identity and never client edited memory text',async()=>{
 const v=album(),c=contribution(),calls=[],ctx={accountId:randomUUID(),sessionId:randomUUID(),onUnauthorized(){}}
 const h=await harness(async(path,init)=>{calls.push({path,body:init.body,session:init.headers.get('X-Xijie-Expected-Session')});return response({albumId:v.id,contributionId:c.id,status:'pending'})})
 const value=await h.api.adoptAlbum(ctx,v.id,c.id)
 assert.equal(value.status,'pending');assert.equal(calls[0].body,'{}');assert.equal(calls[0].session,ctx.sessionId);assert.ok(calls[0].path.endsWith('/'+c.id+'/adopt'))
})
test('closing and withdrawal may lower progress and source content without a monotonic preview projection',async()=>{
 const h=await harness(()=>{}),v=album(),c=contribution()
 const before=h.api.ownerAlbum({...v,current:2,contributions:[{...c,status:'approved',seat:1}]})
 const after=h.api.ownerAlbum({...v,current:1,status:'closed',url:v.url,contributions:[{...c,status:'withdrawn',text:''}]})
 assert.equal(before.contributions.length,1);assert.equal(after.current,1);assert.equal(after.contributions.length,0);assert.equal(after.album.url,null)
})

test('closed invitation retains only the visitor own withdrawal path and cannot share or begin a reward',async()=>{
 const h=await harness(()=>{}),c={...contribution(),status:'approved',seat:1},v=h.api.publicAlbum({title:'',message:'',status:'closed',current:2,target:6,contribution:c},'b'.repeat(43))
 assert.equal(v.canHelp,false);assert.equal(v.helped,false);assert.equal(v.album.url,null);assert.equal(v.album.ownContribution.id,c.id);assert.equal(v.contributions[0].text,c.text)
 assert.throws(()=>h.api.publicAlbum({title:'stale public title',message:'',status:'closed',current:2,target:6,contribution:c},'b'.repeat(43)))
})

test('post-commit authority errors and malformed acknowledgements retain the original album command',async()=>{
 for(const first of [()=>new Response(JSON.stringify({error:{code:'AUTHORIZATION_CHANGED'}}),{status:403}),()=>response({})]){
  const v=album(),ctx={accountId:randomUUID(),sessionId:randomUUID(),onUnauthorized(){}},target={identity:v.personId,world:'tide'},storage=new Map(),calls=[];let n=0
  const fetch=async(path,init)=>{calls.push({path,key:init.headers.get('Idempotency-Key'),body:init.body});return ++n===1?first():response(v)}
  let h=await harness(fetch,storage);await assert.rejects(h.api.createAlbum(ctx,target,'原公开标题','原公开附言'))
  h=await harness(fetch,storage);await h.api.createAlbum(ctx,target,'新的标题','新的附言');assert.deepEqual(calls[0],calls[1]);assert.equal(storage.size,0)
 }
})

test('wrong recipient or album and malformed mutation acknowledgements never retire the recovery command',async()=>{
 const v=album(),ctx={accountId:randomUUID(),sessionId:randomUUID(),onUnauthorized(){}},c=contribution(),storage=new Map()
 let h=await harness(()=>response({...v,personId:randomUUID()}),storage)
 await assert.rejects(h.api.createAlbum(ctx,{identity:v.personId,world:'tide'},'title','note'));assert.equal(storage.size,1)
 h=await harness(()=>response({...v,id:randomUUID()}));await assert.rejects(h.api.readAlbum(v.id,ctx))
 for(const run of [api=>api.contributeAlbum('b'.repeat(43),'body'),api=>api.withdrawAlbum('b'.repeat(43),c.id),api=>api.adoptAlbum(ctx,v.id,c.id),api=>api.closeAlbum(ctx,v.id)]){
  const state=new Map(),bad=await harness((path,init)=>path==='/v1/sessions/current'?response({id:ctx.sessionId,accountId:ctx.accountId}):path==='/v1/public/shared-albums/'+'b'.repeat(43)?response({title:'标题',message:'附言',current:1,target:6,status:'active',contribution:null,viewerScope:{kind:'account',id:'a'.repeat(64)}}):response({}),state);await assert.rejects(run(bad.api));assert.equal(state.size,1)
 }
})

test('anonymous submissions retain visitor flow and retry their exact scoped command after acknowledgement loss',async()=>{
 const token='b'.repeat(43),viewer={kind:'anonymous',id:'c'.repeat(64)},c=contribution(),calls=[],storage=new Map();let attempts=0,own=null
 const transport=async(path,init)=>{calls.push({path,method:init.method??'GET',session:init.headers.get('X-Xijie-Expected-Session'),viewer:init.headers.get('X-Xijie-Album-Viewer'),key:init.headers.get('Idempotency-Key'),body:init.body});if(path==='/v1/sessions/current')return new Response(JSON.stringify({error:{code:'UNAUTHENTICATED'}}),{status:401});if(path.endsWith('/contributions')){own=c;if(++attempts===1)throw TypeError('Lost acknowledgement');return response(c)}if(path.includes('/submission-commands/'))return response({state:'accepted',contribution:c});return response({title:'公开标题',message:'公开附言',status:'active',current:1,target:6,contribution:own,viewerScope:viewer})}
 let h=await harness(transport,storage);await assert.rejects(h.api.contributeAlbum(token,'原匿名投稿',undefined,viewer));assert.equal(storage.size,1)
 h=await harness(transport,storage);const result=await h.api.contributeAlbum(token,'修改不能覆盖原投稿',undefined,viewer),posts=calls.filter(c=>c.method==='POST');assert.equal(posts.length,2);assert.equal(posts[0].session,null);assert.equal(posts[0].viewer,viewer.id);assert.equal(posts[0].key,posts[1].key);assert.equal(posts[0].body,posts[1].body);assert.equal(result.album.ownContribution.id,c.id);assert.equal(storage.size,0)
})

test('account or anonymous scope changes before submitting cannot send a previous visitor draft as the new account',async()=>{
 const id='b'.repeat(43),a={accountId:randomUUID(),sessionId:randomUUID()},b={accountId:randomUUID(),sessionId:randomUUID()},av={kind:'account',id:'a'.repeat(64),...a},bv={kind:'account',id:'b'.repeat(64),...b},storage=new Map(),legacyKey='xijie.album.submit.'+id,legacy={key:randomUUID(),body:{text:'OLD_UNKNOWN_VISITOR',allowAdoption:true}},calls=[],accepted=new Map();let actor=a,viewer=av,own=null,lost=true
 storage.set(legacyKey,JSON.stringify(legacy))
 const fetch=async(path,init)=>{calls.push({path,method:init.method??'GET',body:init.body,headers:init.headers});if(path==='/v1/sessions/current')return response({id:actor.sessionId,accountId:actor.accountId});if(path.endsWith('/contributions')){if(lost){lost=false;throw TypeError('Lost A reply')};own={...contribution(),text:JSON.parse(init.body).text};accepted.set(init.headers.get('Idempotency-Key'),own);return response(own)}if(path.includes('/submission-commands/')){const c=accepted.get(path.split('/').at(-1));return c?response({state:'accepted',contribution:c}):new Response(JSON.stringify({error:{code:'NOT_FOUND'}}),{status:404})}return response({title:'标题',message:'附言',status:'active',current:1,target:6,contribution:own,viewerScope:viewer})}
 const h=await harness(fetch,storage);await assert.rejects(h.api.contributeAlbum(id,'PRIVATE_A',undefined,av));const oldA=[...storage.entries()].find(([k])=>k!==legacyKey)
 actor=b;viewer=bv
 await assert.rejects(h.api.contributeAlbum(id,'PRIVATE_A',undefined,av),e=>e.code==='ALBUM_VIEWER_CHANGED');assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.equal(h.api.albumPending(h.api.albumContributionKey(id,bv),bv),undefined)
 const read=await h.api.readAlbum(id);assert.equal(read.contributions.length,0);assert(!JSON.stringify(read).includes('PRIVATE_A'));assert(!JSON.stringify(read).includes('OLD_UNKNOWN_VISITOR'))
 await h.api.contributeAlbum(id,'EXPLICIT_B',undefined,bv);const posts=calls.filter(c=>c.method==='POST');assert.equal(posts[1].headers.get('X-Xijie-Expected-Session'),b.sessionId);assert.equal(posts[1].headers.get('X-Xijie-Album-Viewer'),bv.id);assert.equal(JSON.parse(posts[1].body).text,'EXPLICIT_B');assert.equal(storage.get(oldA[0]),oldA[1]);assert.equal(storage.get(legacyKey),JSON.stringify(legacy))
 await assert.rejects(h.api.contributeAlbum(id,'anonymous original',undefined,{kind:'anonymous',id:'c'.repeat(64)}),e=>e.code==='ALBUM_VIEWER_CHANGED');assert.equal(calls.filter(c=>c.method==='POST').length,2)
})

test('only the current visitor/account server command proof can retire an unscoped legacy submission',async()=>{
 const id='b'.repeat(43),ctx={accountId:randomUUID(),sessionId:randomUUID()},viewer={kind:'account',id:'a'.repeat(64)},c=contribution(),storage=new Map(),key=randomUUID(),old=JSON.stringify({key,body:{text:'LEGACY_UNKNOWN_BODY',allowAdoption:true}});let accepted=false,proofReads=0
 storage.set('xijie.album.submit.'+id,old)
 const h=await harness((path,init)=>{assert.equal(init.method??'GET','GET');if(path==='/v1/sessions/current')return response({id:ctx.sessionId,accountId:ctx.accountId});if(path.includes('/submission-commands/')){proofReads++;assert.equal(init.headers.get('X-Xijie-Album-Viewer'),viewer.id);assert.equal(init.headers.get('X-Xijie-Expected-Session'),ctx.sessionId);return accepted?response({state:'accepted',contribution:c}):new Response(JSON.stringify({error:{code:'NOT_FOUND'}}),{status:404})}return response({title:'公开标题',message:'公开附言',status:'active',current:1,target:6,contribution:c,viewerScope:viewer})},storage)
 const unknown=await h.api.readAlbum(id);assert(!JSON.stringify(unknown).includes('LEGACY_UNKNOWN_BODY'));assert.equal(storage.get('xijie.album.submit.'+id),old)
 accepted=true;await h.api.readAlbum(id);assert.equal(proofReads,2);assert.equal(storage.size,0)
})

test('a foreign successful submit acknowledgement cannot clear the journal before its current command proof matches',async()=>{
 const id='b'.repeat(43),ctx={accountId:randomUUID(),sessionId:randomUUID()},viewer={kind:'account',id:'a'.repeat(64)},storage=new Map(),wrong=contribution(),owned=contribution()
 const h=await harness((path)=>path==='/v1/sessions/current'?response({id:ctx.sessionId,accountId:ctx.accountId}):path.endsWith('/contributions')?response(wrong):path.includes('/submission-commands/')?response({state:'accepted',contribution:owned}):response({title:'标题',message:'附言',status:'active',current:1,target:6,contribution:null,viewerScope:viewer}),storage)
 await assert.rejects(h.api.contributeAlbum(id,'my input'),e=>e.code==='INVALID_RESPONSE');assert.equal(storage.size,1)
})

test('home and flight map only fixed server progress while legacy albums remain compatible and private contributions stay private',async()=>{
 const h=await harness(()=>{}),v=album(),c={...contribution(),status:'approved',seat:1,version:2}
 const home=h.api.ownerAlbum({...v,kind:'home',rulesVersion:2,capacity:5,current:2,contributions:[c]});assert.equal(home.kind,'home');assert.deepEqual([...home.parts],['门牌','窗']);assert.equal(home.contributions[0].value,1)
 const flight=h.api.publicAlbum({kind:'flight',rulesVersion:2,capacity:8,title:'标题',message:'附言',status:'active',current:6,target:20,contribution:c,contributions:[{text:'PRIVATE_OTHER'}]},'b'.repeat(43));assert.equal(flight.current,6);assert.equal(flight.target,20);assert.equal(flight.contributions[0].value,2);assert.equal(flight.helped,true);assert(!JSON.stringify(flight).includes('PRIVATE_OTHER'));assert.equal(h.api.ownerAlbum(v).kind,'album')
 for(const invalid of [{...v,kind:'flight',target:6},{...v,kind:'flight',target:20,current:5},{...v,kind:'home',capacity:8},{...v,kind:'home',contributions:[{...c,seat:6}]}])assert.throws(()=>h.api.ownerAlbum(invalid))
})

test('unknown shared goal creation freezes the original kind as well as its public fields and UUID',async()=>{
 const v={...album(),kind:'home',rulesVersion:2,capacity:5},ctx={accountId:randomUUID(),sessionId:randomUUID(),onUnauthorized(){}},target={identity:v.personId,world:'tide'},storage=new Map(),calls=[];let n=0
 const transport=async(path,init)=>{calls.push({path,key:init.headers.get('Idempotency-Key'),body:init.body});if(++n===1)throw Error('Lost acceptance');return response(v)};let h=await harness(transport,storage);await assert.rejects(h.api.createAlbum(ctx,target,'原标题','原留言',undefined,'home'));h=await harness(transport,storage);const saved=await h.api.createAlbum(ctx,target,'新标题','新留言',undefined,'flight');assert.equal(saved.kind,'home');assert.deepEqual(calls[0],calls[1]);assert.equal(JSON.parse(calls[0].body).kind,'home');assert.equal(storage.size,0)
 const wrong=await harness(()=>response({...v,kind:'album'}));await assert.rejects(wrong.api.createAlbum(ctx,target,'标题','留言',undefined,'home'));assert.equal(wrong.storage.size,1)
})

test('unknown owner review persists the exact decision, CAS, UUID and original snapshot across remount without adoption or reward',async()=>{
 const c=contribution(),v={...album(),kind:'home',rulesVersion:2,capacity:5,contributions:[c]},ctx={accountId:randomUUID(),sessionId:randomUUID(),onUnauthorized(){}},storage=new Map(),calls=[];let n=0
 const transport=async(path,init)=>{calls.push({path,key:init.headers.get('Idempotency-Key'),cas:init.headers.get('If-Match'),body:init.body});assert.ok(path.endsWith('/'+c.id+'/review'));if(++n===1)throw TypeError('Lost reply');return response({...v,current:2,contributions:[{...c,status:'approved',seat:1,version:2}]})}
 let h=await harness(transport,storage);await assert.rejects(h.api.reviewAlbum(ctx,v.id,c,'approve'));const pending=h.api.pendingAlbumReviews(ctx,v.id)[0];assert.equal(pending.snapshot.text,c.text);assert.equal(pending.version,1);assert.equal(pending.body.decision,'approve');h=await harness(transport,storage);const result=await h.api.reviewAlbum(ctx,v.id,{...c,text:'不得替换原快照',version:99},'reject');assert.deepEqual(calls[0],calls[1]);assert.equal(calls[1].cas,'"v1"');assert.equal(JSON.parse(calls[1].body).decision,'approve');assert.equal(result.current,2);assert.equal(storage.size,0);assert.equal(calls.length,2)
})

test('only explicitly rejected owner reviews may be retired, while unknown or malformed acknowledgements keep the journal',async()=>{
 const c=contribution(),v={...album(),contributions:[c]},ctx={accountId:randomUUID(),sessionId:randomUUID(),onUnauthorized(){}}
 for(const [status,code]of [[412,'VERSION_CONFLICT'],[409,'REVIEW_ALREADY_DECIDED'],[409,'ALBUM_COMPLETE'],[409,'ALBUM_CLOSED']]){const h=await harness(()=>new Response(JSON.stringify({error:{code}}),{status}));await assert.rejects(h.api.reviewAlbum(ctx,v.id,c,'reject'));assert.equal(h.api.pendingAlbumReviews(ctx,v.id)[0].rejectedCode,code);h.api.retireRejectedAlbumReview(ctx,v.id,c.id);assert.equal(h.storage.size,0)}
 for(const reply of [()=>new Response(JSON.stringify({error:{code:'SOURCE_CHANGED'}}),{status:409}),()=>response(v),()=>response({...v,id:randomUUID(),contributions:[{...c,status:'approved',version:2,seat:1}]})]){const h=await harness(reply);await assert.rejects(h.api.reviewAlbum(ctx,v.id,c,'approve'));assert.equal(h.storage.size,1);assert.throws(()=>h.api.retireRejectedAlbumReview(ctx,v.id,c.id));const other={...ctx,accountId:randomUUID()};assert.equal(h.api.pendingAlbumReviews(other,v.id).length,0)}
})
