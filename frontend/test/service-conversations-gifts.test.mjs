import assert from 'node:assert/strict'
import {createHash,randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'
const compile=async name=>ts.transpileModule(await readFile(new URL('../src/'+name,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const [giftCode,chatCode,textCode,mediaCode,photoCode,captureCode]=await Promise.all([compile('serviceGifts.ts'),compile('serviceConversations.ts'),compile('gifts/messageText.ts'),compile('serviceMedia.ts'),compile('serviceChatPhotos.ts'),compile('mobile/chatCapture.ts')])
const response=data=>new Response(JSON.stringify({data,meta:{nextCursor:null,afterCursor:null}}))
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r))}
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
test('home letter polling ignores cross-session and pre-withdrawal responses',async()=>{
 const a=randomUUID(),b=randomUUID(),item={personId:randomUUID(),letterId:randomUUID(),createdAt:'2026-11-18T01:00:00.000Z'},requests=[]
 const h=await harness((path,init)=>{
  assert.equal(path,'/v1/conversations/letters/unread')
  const request=defer();requests.push({...request,signal:init.signal,sessionId:init.headers.get('X-Xijie-Expected-Session')});return request.promise
 })
 h.renderUnread(a);const old=requests[0]
 assert.equal(old.sessionId,a)
 h.renderUnread(b);assert.equal(old.signal.aborted,true)
 assert.equal(requests[1].sessionId,b)
 old.resolve(response([item]));requests[1].resolve(response([]));await settle()
 assert.equal(h.renderUnread(b),undefined)
 h.dispatch('focus');requests[2].resolve(response([item]));await settle()
 assert.equal(h.renderUnread(b).letterId,item.letterId)
 h.dispatch('focus');const beforeWithdrawal=requests[3]
 h.dispatch('xijie:consents-changed');assert.equal(beforeWithdrawal.signal.aborted,true);assert.equal(h.renderUnread(b),undefined)
 beforeWithdrawal.resolve(response([item]));requests[4].resolve(new Response(JSON.stringify({error:{code:'LETTER_STORAGE_PERMISSION_REQUIRED'}}),{status:403}));await settle()
 assert.equal(h.renderUnread(b),undefined)
 h.dispatch('focus');requests[5].resolve(response([item,item]));await settle();assert.equal(h.renderUnread(b),undefined)
 h.unmount()
})
test('lost voice-to-text acceptance preserves the real transcript mode and exact original keys across remount',async()=>{
 const f=fixture(),storage=new Map(),calls=[];let posted=0,rows=[]
 const transport=async(path,init={})=>{
  if(path==='/v1/conversations')return response({id:f.conversationId,kind:'direct',personId:f.personId})
  if(path.includes('/messages?')){if(posted===1)throw Error('Unknown read');return response(rows)}
  if(path==='/v1/conversations/'+f.conversationId+'/messages'){const body=JSON.parse(init.body),jobId=randomUUID();calls.push({body,key:init.headers.get('Idempotency-Key')});const message={...f.text,clientMessageId:body.clientMessageId,text:body.text,inputMode:body.inputMode,generationJobId:jobId};rows=[message];if(++posted===1)throw Error('Lost acceptance');return response({message,generationJobId:jobId})}
  if(path.startsWith('/v1/generation-jobs/'))return response({id:path.split('/').at(-1),state:'succeeded',version:1})
  throw Error('Unexpected '+path)
 }
 let h=await harness(transport,storage);h.render(f.context);await settle();assert.equal(await h.render(f.context).send('真正识别的最终文字','transcribed'),false);h.unmount();h=await harness(transport,storage);h.render(f.context);await settle();let remote=h.render(f.context);assert.equal(remote.pendingText,'真正识别的最终文字');assert.equal(await remote.send('不得替换的键盘文字','typed'),true);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[1].body.inputMode,'transcribed');assert.equal(storage.size,0);remote=h.render(f.context);assert.equal(remote.messages.find(m=>m.serverId===f.text.id).voice,true);h.unmount()
})

test('storyline sends use a distinct transcript and preserve the exact branch after unknown acceptance',async()=>{
 const f=fixture(),branchId=randomUUID(),otherBranch=randomUUID(),storage=new Map(),calls=[],ctx={...f.context,storyBranchId:branchId,storyBranchName:'另一条路'};let posted=0,rows=[]
 const transport=async(path,init={})=>{
  assert.ok(!path.startsWith('/v1/conversations'),'Branch work cannot create or access a main transcript')
  if(path==='/v1/story-branches/'+branchId||path==='/v1/story-branches/'+otherBranch)return response({id:path.split('/').at(-1),conversationId:path.split('/').at(-1),personId:f.personId,canSend:true})
  if(path.includes('/messages?')){if(posted===1&&path.includes(branchId))throw TypeError('Recovery read is temporarily unavailable');return response(path.includes(branchId)?rows:[])}
  if(path==='/v1/story-branches/'+branchId+'/messages'){
   const body=JSON.parse(init.body),jobId=randomUUID();calls.push({path,body,key:init.headers.get('Idempotency-Key')})
   const message={...f.text,id:randomUUID(),conversationId:branchId,clientMessageId:body.clientMessageId,text:body.text,sequence:'1',generationJobId:jobId,generationKind:'story_reply',canSuggestMemory:false};rows=[message]
   if(++posted===1)throw TypeError('Lost accepted result')
   return response({message,generationJobId:jobId,generationKind:'story_reply'})
  }
  if(path.startsWith('/v1/story-generation-jobs/'))return response({id:path.split('/').at(-1),kind:'story_reply',state:'succeeded',version:1})
  throw Error('Unexpected '+path)
 }
 let h=await harness(transport,storage),remote=h.render(ctx);await settle();assert.equal(await remote.send('分支里的原请求'),false);h.unmount()
 h=await harness(transport,storage);h.render({...ctx,storyBranchId:otherBranch});await settle();assert.equal(h.render({...ctx,storyBranchId:otherBranch}).pendingText,undefined)
 h.render(ctx);await settle();remote=h.render(ctx);assert.equal(remote.pendingText,'分支里的原请求');assert.equal(await remote.send('不能替换'),true)
 assert.deepEqual(calls[0],calls[1]);assert.equal(storage.size,0);assert.equal(h.render(ctx).messages[0].canSuggestMemory,false);h.unmount()
})
const fixture=()=>{
 const personId=randomUUID(),conversationId=randomUUID(),createdAt='2026-11-13T00:00:10.000Z'
 const giftSnapshot={id:'flowers',version:1,name:'鲜花',en:'Flowers',category:'care',icon:'flower-2',cost:3,effect:'prop',outcome:'一束花',outcomeEn:'A bouquet',audience:['person'],stackable:true,available:true,render:'flower'}
 const personSnapshot={id:personId,displayName:'合成TA',worldId:randomUUID(),version:1,worldVersion:1,accessVersion:1,audience:'person'}
 const delivery={id:randomUUID(),personId,conversationId,version:1,giftSnapshot,personSnapshot,quantity:1,note:'合成赠言',source:'trial',cost:3,status:'arrived',createdAt,scheduledArrivalAt:createdAt,arrivedAt:createdAt,failedAt:null,debitTransactionId:randomUUID(),reversalTransactionId:null}
 const received={id:randomUUID(),personId,conversationId,sourceDeliveryId:delivery.id,personSnapshot,giftSnapshot,quantity:1,note:'真实生成来源',version:1,createdAt,openedAt:null,placement:null,displayable:true,origin:{kind:'persona_return',contentOrigin:'ai_generated',policyVersion:'person-gift-returns-v1',generationJobId:randomUUID()}}
 const base={conversationId,version:1,createdAt,kind:'gift',text:'',canSuggestMemory:false}
 const outgoing={...base,id:randomUUID(),sequence:'1',author:{kind:'self'},gift:{deliveryId:delivery.id,...delivery}}
 const incoming={...base,id:randomUUID(),sequence:'2',author:{kind:'persona',personId,displayName:'合成TA',aiGenerated:true},gift:{direction:'received',receivedGiftId:received.id,...received}}
 const text={id:randomUUID(),conversationId,sequence:'3',kind:'text',text:'保留的普通文字',version:1,createdAt,author:{kind:'self'}}
 return {personId,conversationId,outgoing,incoming,text,context:{accountId:randomUUID(),sessionId:randomUUID(),personId,onUnauthorized(){}}}
}
async function harness(fetcher,storage=new Map(),nativeBridge){
 let si=0,ri=0,ei=0,uid=100;const states=[],refs=[],effects=[],pending=[],listeners=new Map()
 const add=(n,f)=>{const list=listeners.get(n)??new Set();list.add(f);listeners.set(n,list)},remove=(n,f)=>listeners.get(n)?.delete(f)
 const context=vm.createContext({fetch:fetcher,crypto:globalThis.crypto,Headers,Response,Blob,TextEncoder,atob,AbortSignal,AbortController,DOMException,URLSearchParams,setTimeout,clearTimeout,sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},window:{Capacitor:nativeBridge,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},addEventListener:add,removeEventListener:remove},document:{visibilityState:'visible',addEventListener:add,removeEventListener:remove}})
 const synthetic=values=>new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v)},{context})
 const react=synthetic({useState(v){const i=si++;if(!(i in states))states[i]=typeof v==='function'?v():v;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useRef(v){const i=ri++;return refs[i]??(refs[i]={current:v})},useEffect(fn,deps){const i=ei++,old=effects[i];if(!old||deps.some((v,j)=>v!==old.deps[j]))pending.push(()=>{old?.cleanup?.();effects[i]={deps,fn,cleanup:fn()}})},useMemo(fn){return fn()},useCallback(fn){return fn}})
 const imports={react,'./model':synthetic({nid:()=>++uid,fileToDataUrl:async file=>file.source}),'./i18n':synthetic({WORLD_IDS:['courtyard','tide','isles'],useI18n:()=>({lang:'zh-CN'}),isZh:()=>true,fmtTime:()=> '00:00'})}
 const media=new vm.SourceTextModule(mediaCode,{context});await media.link(n=>imports[n]);await media.evaluate();imports['./serviceMedia']=media
 const photo=new vm.SourceTextModule(photoCode,{context});await photo.link(n=>imports[n]);await photo.evaluate();imports['./serviceChatPhotos']=photo
 const capture=new vm.SourceTextModule(captureCode,{context});await capture.link(n=>n==='../serviceChatPhotos'?photo:imports[n]);await capture.evaluate()
 const gifts=new vm.SourceTextModule(giftCode,{context});await gifts.link(n=>imports[n]);await gifts.evaluate();imports['./serviceGifts']=gifts
 const text=new vm.SourceTextModule(textCode,{context});await text.link(n=>imports[n]);await text.evaluate();imports['./gifts/messageText']=text
 const chat=new vm.SourceTextModule(chatCode,{context});await chat.link(n=>imports[n]);await chat.evaluate()
 const personSource=await readFile(new URL('../src/person.tsx',import.meta.url),'utf8'),personAst=ts.createSourceFile('person.tsx',personSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),talk=personAst.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='TalkTab')
 const captureEffect=talk.body.statements.find(n=>ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(personAst)==='useEffect'&&n.getText(personAst).includes('consumedCaptures.current.has'))
 const recoveryCode=ts.transpileModule("import {useRef,useEffect} from 'react'; import {useServiceConversation} from './serviceConversations'; export function renderCapture(serviceConversation,{captureOperationId,captureRequestId,onCaptureConsumed}){const remote=useServiceConversation(serviceConversation);const consumedCaptures=useRef(new Set());"+captureEffect.getText(personAst)+";return remote}",{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
 const recovery=new vm.SourceTextModule(recoveryCode,{context});await recovery.link(n=>n==='react'?react:chat);await recovery.evaluate()
 const flush=()=>{while(pending.length)pending.shift()()}
 return {api:chat.namespace,media:media.namespace,capture:capture.namespace,storage,render(value){si=ri=ei=0;const result=chat.namespace.useServiceConversation(value);flush();return result},renderUnread(sessionId){si=ri=ei=0;const result=chat.namespace.useUnreadLetterReply(sessionId);flush();return result},renderCapture(value,route){si=ri=ei=0;const result=recovery.namespace.renderCapture(value,route);flush();return result},strictReplay(){effects.forEach(e=>e.cleanup?.());effects.forEach(e=>e.cleanup=e.fn())},dispatch(name){for(const fn of listeners.get(name)??[])fn()},unmount(){effects.forEach(e=>e.cleanup?.())}}
}

const photoFixture=()=>{
 const f=fixture(),mediaId=randomUUID(),jobId=randomUUID(),clientMessageId=randomUUID(),slot=randomUUID()
 const metadata={id:mediaId,version:3,mimeType:'image/webp',byteSize:4,width:24,height:24}
 const photo={...f.text,id:randomUUID(),sequence:'4',kind:'photo',text:'',clientMessageId,generationJobId:jobId,generationKind:'photo_reply',canSuggestMemory:false,photo:{mediaId,...Object.fromEntries(Object.entries(metadata).filter(([k])=>k!=='id'))}}
 const reply={...f.text,id:randomUUID(),sequence:'5',text:'图中有一个蓝色方块',author:{kind:'persona',personId:f.personId,displayName:'合成TA',aiGenerated:true},generationJobId:jobId,generationKind:'photo_reply',canSuggestMemory:false}
 return {...f,metadata,photo,reply,mediaId,jobId,slot,file:{type:'image/jpeg',size:4,source:'data:image/jpeg;base64,dGVzdA=='},job:{id:jobId,kind:'photo_reply',state:'succeeded',version:1}}
}
function photoTransport(f,{posted=()=>{},loseComplete=false}={}){
 let status='awaiting_upload',completeLost=false,rows=[],inputSize=4;const requests=[]
 const resource=()=>({id:f.mediaId,purpose:'conversation_attachment',status,mimeType:status==='ready'?'image/webp':'image/jpeg',byteSize:status==='ready'?4:inputSize,version:status==='ready'?3:1,authorizationVersion:1,createdAt:f.text.createdAt,updatedAt:f.text.createdAt,...(status==='ready'?{width:24,height:24}:{})})
 const upload={id:f.slot,method:'PUT',url:'/v1/media/'+f.mediaId+'/uploads/'+f.slot,requiredHeaders:{'Content-Type':'image/jpeg'},expiresAt:'2099-01-01T00:00:00Z'}
 const fetcher=async(path,init={})=>{
  requests.push({path,method:init.method??'GET',body:typeof init.body==='string'?init.body:undefined,key:init.headers?.get?.('Idempotency-Key')})
  if(path==='/v1/conversations')return response({id:f.conversationId,kind:'direct',personId:f.personId})
  if(path.includes('/messages?'))return response(rows)
  if(path==='/v1/media'){const input=JSON.parse(init.body);inputSize=input.byteSize;assert.equal(input.purpose,'conversation_attachment');assert.equal(input.target.kind,'conversation_message');assert.equal(input.target.conversationId,f.conversationId);f.photo.clientMessageId=input.target.id;return response({media:resource(),upload})}
  if(path===upload.url){status='awaiting_upload';return new Response('')}
  if(path==='/v1/media/'+f.mediaId+'/complete'){status='ready';if(loseComplete&&!completeLost){completeLost=true;throw Error('lost complete response')}return response(resource())}
  if(path==='/v1/media/'+f.mediaId)return response(resource())
  if(path==='/v1/conversations/'+f.conversationId+'/messages'){const body=JSON.parse(init.body);assert.deepEqual(body.media,{id:f.mediaId,version:3});assert.equal(body.kind,'photo');assert.equal('text'in body,false);assert.equal('inputMode'in body,false);f.photo.clientMessageId=body.clientMessageId;rows=[f.photo];const result=await posted(requests.at(-1));return result??response({message:f.photo,generationJobId:f.jobId})}
  if(path==='/v1/generation-jobs/'+f.jobId+'?kind=photo_reply')return response(f.job)
  throw Error('Unexpected photo path '+path)
 }
 return {fetcher,requests,get rows(){return rows},set rows(value){rows=value}}
}

test('single photo intent survives unknown acceptance and refresh with the exact media, body and key',async()=>{
 const f=photoFixture(),storage=new Map(),posts=[];let lost=true
 const transport=photoTransport(f,{posted:request=>{posts.push(request);if(lost){lost=false;throw Error('dropped accepted photo response')}}})
 let h=await harness(transport.fetcher,storage);h.render(f.context);await settle();assert.equal(await h.render(f.context).sendPhoto(f.file),false)
 const saved=[...storage.entries()].find(([key])=>key.startsWith('xijie.chat-photo.intent.'));assert(saved);assert(!saved[1].includes('base64'));assert(!saved[1].includes('readProof'));assert.equal(JSON.parse(saved[1]).media.id,f.mediaId)
 h.unmount();h=await harness(transport.fetcher,storage);h.render(f.context);await settle();assert.equal(h.render(f.context).pendingPhoto,true);assert.equal(await h.render(f.context).sendPhoto(),true);await settle()
 assert.equal(posts.length,2);assert.equal(posts[0].key,posts[1].key);assert.equal(posts[0].body,posts[1].body);assert.equal(transport.requests.filter(r=>r.path==='/v1/media').length,1)
 assert.equal(h.render(f.context).pendingPhoto,false);assert.equal(h.render(f.context).messages[0].kind,'photo');assert(![...storage.keys()].some(key=>key.startsWith('xijie.chat-photo.intent.')));h.unmount()
})

test('unknown completed upload resumes by metadata after refresh and never allocates another photo',async()=>{
 const f=photoFixture(),storage=new Map(),transport=photoTransport(f,{loseComplete:true});let h=await harness(transport.fetcher,storage)
 h.render(f.context);await settle();assert.equal(await h.render(f.context).sendPhoto(f.file),false);h.unmount()
 h=await harness(transport.fetcher,storage);h.render(f.context);await settle();assert.equal(await h.render(f.context).sendPhoto(),true)
 assert.equal(transport.requests.filter(r=>r.path==='/v1/media').length,1);assert.equal(transport.requests.filter(r=>r.method==='PUT').length,1);assert.equal(transport.requests.filter(r=>r.path.endsWith('/complete')).length,1);h.unmount()
})

async function missingOriginalPhoto(storage=new Map()){
 const f=photoFixture(),transport=photoTransport(f);let allowBytes=false,requests=0,paused
 const fetcher=async(path,init={})=>{requests++;if(paused&&path==='/v1/media/'+f.mediaId){const gate=paused;paused=undefined;await gate.promise}if(init.method==='PUT'&&!allowBytes)throw Error('Offline before the camera bytes were uploaded');if(path.endsWith('/complete')&&!allowBytes)return new Response(JSON.stringify({error:{code:'UPLOAD_NOT_COMPLETE'}}),{status:409});return transport.fetcher(path,init)}
 let h=await harness(fetcher,storage);h.render(f.context);await settle();assert.equal(await h.render(f.context).sendPhoto(f.file),false);h.unmount()
 h=await harness(fetcher,storage);h.render(f.context);await settle();assert.equal(await h.render(f.context).sendPhoto(),false)
 const remote=h.render(f.context);assert.equal(remote.pendingPhoto,true);assert.equal(remote.photoNeedsSelection,true)
 return {f,h,storage,transport,fetcher,get requests(){return requests},allowBytes(){allowBytes=true},pauseNextResume(){paused=defer();return paused}}
}

test('a camera photo lost before upload can stop only its local retry after remount and then accept a different photo',async()=>{
 const x=await missingOriginalPhoto(),original=JSON.parse([...x.storage.entries()].find(([key])=>key.startsWith('xijie.chat-photo.intent.'))[1])
 const unrelatedKey='xijie.media.intent.'+randomUUID()+'.unrelated',unrelatedValue='keep another account journal';x.storage.set(unrelatedKey,unrelatedValue)
 const before=x.requests,remote=x.h.render(x.f.context)
 assert.equal(await remote.stopPhotoRetry(),true);assert.equal(x.requests,before,'Stopping is entirely local')
 assert.equal(x.h.render(x.f.context).pendingPhoto,false);assert.equal(x.h.render(x.f.context).photoNeedsSelection,false)
 assert.equal(x.storage.size,1);assert.equal(x.storage.get(unrelatedKey),unrelatedValue)
 assert.match(x.h.render(x.f.context).feedback.text,/不会撤回|仍会留在聊天/)
 x.allowBytes();assert.equal(await x.h.render(x.f.context).sendPhoto({...x.f.file,source:'data:image/jpeg;base64,bmV3IQ=='}),true)
 const created=x.transport.requests.filter(item=>item.path==='/v1/media').at(-1),body=JSON.parse(created.body)
 assert.notEqual(body.target.id,original.clientMessageId);assert.equal(x.h.render(x.f.context).pendingPhoto,false);x.h.unmount()
})

test('a stale photo recovery action cannot clear another account or a later image in the same chat',async()=>{
 const x=await missingOriginalPhoto(),oldRemote=x.h.render(x.f.context),original=[...x.storage.entries()].find(([key])=>key.startsWith('xijie.chat-photo.intent.'))
 x.h.render({...x.f.context,accountId:randomUUID(),sessionId:randomUUID()});await settle()
 assert.equal(await oldRemote.stopPhotoRetry(),false);assert.equal(x.storage.get(original[0]),original[1])
 x.h.render(x.f.context);await settle();assert.equal(await x.h.render(x.f.context).sendPhoto(),false)
 const previous=x.h.render(x.f.context);assert.equal(await previous.stopPhotoRetry(),true)
 assert.equal(await x.h.render(x.f.context).sendPhoto({...x.f.file,source:'data:image/jpeg;base64,bmV3IQ=='}),false)
 const newer=[...x.storage.entries()].find(([key])=>key.startsWith('xijie.chat-photo.intent.'))
 assert.notEqual(JSON.parse(newer[1]).key,JSON.parse(original[1]).key)
 assert.equal(await previous.stopPhotoRetry(),false);assert.equal(x.storage.get(newer[0]),newer[1]);x.h.unmount()
})

test('failed persistent photo cleanup keeps a resumable marker and never reports that retry stopped',async()=>{
 for(const prefix of ['xijie.media.intent.','xijie.chat-photo.intent.']){
  const storage=new Map(),x=await missingOriginalPhoto(storage),prior=[...storage.entries()].find(([key])=>key.startsWith('xijie.chat-photo.intent.')),allBefore=[...storage.entries()]
  const remove=storage.delete.bind(storage);storage.delete=key=>key.startsWith(prefix)?false:remove(key)
  assert.equal(await x.h.render(x.f.context).stopPhotoRetry(),false)
  assert.equal(storage.get(prior[0]),prior[1]);assert.deepEqual([...storage.entries()].sort(),allBefore.sort());assert.equal(x.h.render(x.f.context).pendingPhoto,true)
  assert.match(x.h.render(x.f.context).feedback.text,/暂时无法停止/)
  storage.delete=remove;assert.equal(await x.h.render(x.f.context).stopPhotoRetry(),true);assert.equal(storage.size,0);x.h.unmount()
 }
})

test('switching owner while a local retirement is deriving its journal key leaves the original markers intact',async()=>{
 const x=await missingOriginalPhoto(),remote=x.h.render(x.f.context),before=[...x.storage.entries()]
 const stopping=remote.stopPhotoRetry();x.h.render({...x.f.context,accountId:randomUUID(),sessionId:randomUUID()})
 assert.equal(await stopping,false);assert.deepEqual([...x.storage.entries()],before);assert.equal(x.h.render({...x.f.context,accountId:randomUUID(),sessionId:randomUUID()}).pendingPhoto,undefined);x.h.unmount()
})

test('a consent refresh hides a disposed photo recovery action while preserving its exact pending marker for deliberate retry',async()=>{
 const x=await missingOriginalPhoto(),old=x.h.render(x.f.context),before=[...x.storage.entries()]
 x.h.dispatch('xijie:consents-changed');await settle();const refreshed=x.h.render(x.f.context)
 assert.equal(refreshed.pendingPhoto,true);assert.equal(refreshed.photoNeedsSelection,false)
 assert.equal(await old.stopPhotoRetry(),false);assert.deepEqual([...x.storage.entries()],before)
 assert.equal(await refreshed.sendPhoto(),false);const recovered=x.h.render(x.f.context)
 assert.equal(recovered.photoNeedsSelection,true);assert.deepEqual([...x.storage.entries()],before)
 assert.equal(await recovered.stopPhotoRetry(),true);assert.equal(x.storage.size,0);x.h.unmount()
})

test('sending blocks local photo retirement and a late send result cannot be canceled by an older recovery callback',async()=>{
 const x=await missingOriginalPhoto(),idle=x.h.render(x.f.context),before=[...x.storage.entries()],gate=x.pauseNextResume()
 const pending=idle.sendPhoto();await settle();assert.equal(x.h.render(x.f.context).sending,true)
 assert.equal(await idle.stopPhotoRetry(),false);assert.deepEqual([...x.storage.entries()],before)
 x.allowBytes();gate.resolve();assert.equal(await pending,true);await settle()
 assert.equal(await idle.stopPhotoRetry(),false);assert.equal(x.h.render(x.f.context).messages.filter(m=>m.kind==='photo').length,1)
 assert.equal(x.transport.requests.filter(item=>item.path.endsWith('/messages')&&item.method==='POST').length,1);x.h.unmount()
})

test('local retirement locks out a new send until both original journals have been checked and cleared',async()=>{
 const x=await missingOriginalPhoto(),remote=x.h.render(x.f.context),before=x.requests
 const stopping=remote.stopPhotoRetry();assert.equal(x.h.render(x.f.context).sending,true)
 assert.equal(await remote.sendPhoto({...x.f.file,source:'data:image/jpeg;base64,bmV3IQ=='}),false)
 assert.equal(await stopping,true);assert.equal(x.requests,before);assert.equal(x.storage.size,0);x.h.unmount()
})

test('a ready photo with an unknown message result retains exact retry identity and does not offer local retirement',async()=>{
 const f=photoFixture(),storage=new Map(),transport=photoTransport(f,{posted:()=>{throw Error('Accepted result lost')}}),h=await harness(transport.fetcher,storage)
 h.render(f.context);await settle();assert.equal(await h.render(f.context).sendPhoto(f.file),false)
 const before=[...storage.entries()],remote=h.render(f.context);assert.equal(remote.photoNeedsSelection,false)
 assert.equal(await remote.stopPhotoRetry(),false);assert.deepEqual([...storage.entries()],before);h.unmount()
})

test('stopping missing-file recovery never removes a photo already accepted while the local media marker write was lost',async()=>{
 const f=photoFixture(),storage=new Map(),save=storage.set.bind(storage);let mediaReadsOffline=false
 storage.set=(key,value)=>key.startsWith('xijie.chat-photo.intent.')&&JSON.parse(value).media?storage:save(key,value)
 const transport=photoTransport(f,{posted:()=>{throw Error('Accepted message response lost')}})
 const fetcher=async(path,init)=>{if(mediaReadsOffline&&path==='/v1/media/'+f.mediaId)throw Error('Media status is temporarily unavailable');return transport.fetcher(path,init)}
 let h=await harness(fetcher,storage);h.render(f.context);await settle();assert.equal(await h.render(f.context).sendPhoto(f.file),false);h.unmount()
 storage.set=save;mediaReadsOffline=true;h=await harness(fetcher,storage);h.render(f.context);await settle()
 assert.equal(h.render(f.context).messages.filter(m=>m.kind==='photo').length,1)
 assert.equal(await h.render(f.context).sendPhoto(),false);const remote=h.render(f.context);assert.equal(remote.photoNeedsSelection,true)
 const before=transport.requests.length;assert.equal(await remote.stopPhotoRetry(),true);assert.equal(transport.requests.length,before)
 assert.equal(h.render(f.context).messages.filter(m=>m.kind==='photo').length,1);assert.equal(storage.size,0);h.unmount()
})

test('chat journal helper derives the existing single upload without allocation and refuses changed journals or other purposes',async()=>{
 const x=await missingOriginalPhoto(),intent=JSON.parse([...x.storage.entries()].find(([key])=>key.startsWith('xijie.chat-photo.intent.'))[1])
 const mediaEntry=[...x.storage.entries()].find(([key])=>key.startsWith('xijie.media.intent.')),context={...x.f.context,live:()=>true}
 const client=new x.h.media.MediaClient(context,'conversation_attachment',x.f.conversationId),before=x.requests
 const absent=await client.conversationUploadJournal(intent.metadata,randomUUID(),randomUUID());assert.equal(x.storage.size,2);absent.remove();assert.equal(x.storage.size,2)
 const known=await client.conversationUploadJournal(intent.metadata,intent.clientMessageId,intent.key);known.remove();assert.equal(x.storage.has(mediaEntry[0]),false);known.restore();assert.equal(x.storage.get(mediaEntry[0]),mediaEntry[1])
 const changed=await client.conversationUploadJournal(intent.metadata,intent.clientMessageId,intent.key);x.storage.set(mediaEntry[0],'a newer journal value')
 assert.throws(()=>changed.remove(),e=>e.code==='PHOTO_RETRY_CHANGED');assert.equal(x.storage.get(mediaEntry[0]),'a newer journal value')
 const otherPurpose=new x.h.media.MediaClient(context,'post_attachment')
 await assert.rejects(otherPurpose.conversationUploadJournal(intent.metadata,intent.clientMessageId,intent.key),e=>e.code==='INVALID_PHOTO_INPUT')
 assert.equal(x.requests,before);client.dispose();otherPurpose.dispose();x.h.unmount()
})

test('a native capture retains one media allocation after completion response loss and all browser storage is lost',async()=>{
 const f=photoFixture(),operationId=randomUUID(),storage=new Map(),allocations=new Map(),createKeys=[];let durable,first=true
 const resources=new Map(),resource=(id)=>({id,purpose:'conversation_attachment',status:resources.get(id),mimeType:resources.get(id)==='ready'?'image/webp':'image/jpeg',byteSize:4,version:resources.get(id)==='ready'?3:1,authorizationVersion:1,createdAt:f.text.createdAt,updatedAt:f.text.createdAt,...(resources.get(id)==='ready'?{width:24,height:24}:{})})
 const fetcher=async(path,init={})=>{
  if(path==='/v1/media'){const key=init.headers.get('Idempotency-Key');createKeys.push(key);let id=allocations.get(key);if(!id){id=randomUUID();allocations.set(key,id);resources.set(id,'awaiting_upload')}return response({media:resource(id),upload:{id:f.slot,method:'PUT',url:'/v1/media/'+id+'/uploads/'+f.slot,requiredHeaders:{'Content-Type':'image/jpeg'},expiresAt:'2099-01-01T00:00:00Z'}})}
  const id=path.split('/')[3]
  if(init.method==='PUT')return new Response('')
  if(path.endsWith('/complete')){resources.set(id,'ready');if(first){first=false;throw Error('Completed but the host process died before receiving the response')}return response(resource(id))}
  if(path==='/v1/media/'+id)return response(resource(id))
  throw Error('Unexpected path')
 }
 let h=await harness(fetcher,storage),client=new h.media.MediaClient({...f.context,live:()=>true},'conversation_attachment',f.conversationId,{operationId,read:()=>durable,write:async value=>{durable=JSON.parse(JSON.stringify(value))},key:async label=>({allocate:'06f69c46-844f-890e-90a2-09860135deaa',upload:'897b5983-53a0-8f4f-a14d-ac26a57e5384',complete:'1989e00b-d632-8f76-b750-e4f368429b65'}[label]??randomUUID())})
 const prepared=await h.media.preparePhotos([f.file.source]);await assert.rejects(client.upload(prepared,operationId,operationId));const original=[...allocations.values()][0];client.dispose();h.unmount();storage.clear()
 h=await harness(fetcher,storage);client=new h.media.MediaClient({...f.context,live:()=>true},'conversation_attachment',f.conversationId,{operationId,read:()=>durable,write:async value=>{durable=JSON.parse(JSON.stringify(value))},key:async()=>{throw Error('The durable identities must win over a new seed')}})
 assert.equal((await client.upload(prepared,operationId,operationId))[0],original)
 assert.equal(allocations.size,1);assert.equal(createKeys.length,1);client.dispose();h.unmount()
})

function nativeCaptureProtocol(f){
 const bytes=Buffer.from([255,216,255,0,1,2,255,217]),sha256=createHash('sha256').update(bytes).digest('hex'),calls=[];let record,failStage,failRelease=false,readGate
 const bridge={isNativePlatform:()=>true,getPlatform:()=> 'android',isPluginAvailable:()=>true,nativePromise:async(plugin,method,data)=>{
  assert.equal(plugin,'ChatCapture');calls.push({method,data:JSON.parse(JSON.stringify(data))})
  if(method==='capture'){const createdAtMs=Date.now();record={operationId:data.operationId,owner:data.owner,pageId:data.pageId,state:'ready',revision:1,createdAtMs,expiresAtMs:createdAtMs+3600000,restored:false,prepared:{mimeType:'image/jpeg',byteSize:bytes.length,sha256,width:24,height:24}};return JSON.parse(JSON.stringify(record))}
  if(method==='getPending')return record?{pending:true,capture:{...JSON.parse(JSON.stringify(record)),restored:record.pageId!==data.pageId}}:{pending:false}
  if(method==='read'){if(readGate){const gate=readGate;readGate=undefined;await gate.promise}return {...record.prepared,operationId:record.operationId,revision:record.revision,base64:bytes.toString('base64')}}
  if(method==='checkpoint'){
   assert.equal(data.expectedRevision,record.revision);assert.equal(data.plan.photoIntent.key,record.operationId);assert.equal(data.plan.photoIntent.clientMessageId,record.operationId)
   if(failStage?.(data.plan)){failStage=undefined;throw Object.assign(Error('Native durable checkpoint blocked'),{code:'CAPTURE_STORAGE_UNAVAILABLE',data:{status:503}})}
   record={...record,plan:JSON.parse(JSON.stringify(data.plan)),revision:record.revision+1};return {operationId:record.operationId,revision:record.revision}
  }
  if(method==='release'){if(failRelease){failRelease=false;throw Object.assign(Error('Native file cleanup failed'),{code:'CAPTURE_STORAGE_UNAVAILABLE',data:{status:503}})}if(record){assert.equal(data.operationId,record.operationId);if(data.reason==='sent'){assert.equal(data.receipt.messageId,f.photo.id);assert.equal(data.receipt.mediaId,record.plan.photoIntent.media.id);assert.equal(data.receipt.mediaVersion,record.plan.photoIntent.media.version)}}record=undefined;return {operationId:data.operationId,cleared:true}}
  if(method==='reconcileOwner')return {cleared:false}
  throw Error('Unexpected native method')
 }}
 const guardMutation=(path,init)=>{
  if(path==='/v1/media'&&init.method==='POST')assert.equal(init.headers.get('Idempotency-Key'),record.plan.mediaIntent.allocateKey)
  if(init.method==='PUT'){assert.equal(record.plan.mediaIntent.uploadSlotId,f.slot);assert.equal(init.headers.get('Idempotency-Key'),record.plan.mediaIntent.uploadKey)}
  if(path.endsWith('/complete'))assert.equal(init.headers.get('Idempotency-Key'),record.plan.mediaIntent.completeKey)
  if(path.endsWith('/messages')&&init.method==='POST'){assert.equal(record.plan.messageAttempted,true);assert.equal(JSON.parse(init.body).media.id,record.plan.photoIntent.media.id);assert.equal(init.headers.get('Idempotency-Key'),record.operationId)}
 }
 return {bridge,calls,guardMutation,get record(){return record},retire(){record=undefined},failCheckpoint(predicate){failStage=predicate},failCleanup(){failRelease=true},pauseRead(){readGate=defer();return readGate}}
}

test('a cold Talk keeps its continuation through StrictMode setup-cleanup-setup until the actual conversation is loaded',async()=>{
 const f=photoFixture(),native=nativeCaptureProtocol(f),storage=new Map(),transport=photoTransport(f),historyGate=defer(),operationId=randomUUID()
 const fetcher=async(path,init={})=>{native.guardMutation(path,init);if(path.includes('/messages?'))await historyGate.promise;return transport.fetcher(path,init)}
 await native.bridge.nativePromise('ChatCapture','capture',{owner:{accountId:f.context.accountId,sessionId:f.context.sessionId,personId:f.personId,conversationId:f.conversationId},operationId,pageId:randomUUID()})
 const h=await harness(fetcher,storage,native.bridge);h.capture.setChatCaptureIdentity(f.context);const client=new h.capture.ChatCaptureClient(f.context,()=>true),context={...f.context,chatCapture:client};let consumed=0,route={captureOperationId:operationId,captureRequestId:randomUUID(),onCaptureConsumed(){consumed++;route={}}}
 const initial=h.renderCapture(context,route);h.strictReplay();await settle();h.renderCapture(context,route)
 assert.equal(consumed,0,'The first render cannot claim a route request before its live conversation is loaded');assert.equal(native.calls.filter(c=>c.method==='read').length,0)
 historyGate.resolve();await settle();h.renderCapture(context,route);h.renderCapture(context,route);for(let i=0;i<40&&!transport.rows.length;i++)await settle()
 assert.equal(consumed,1);assert.equal(transport.rows.length,1,JSON.stringify({native:native.calls.map(c=>c.method),requests:transport.requests,feedback:h.renderCapture(context,route).feedback}));assert.equal(transport.rows[0].clientMessageId,operationId);assert.equal(native.calls.filter(c=>c.method==='read').length,1);assert.equal(native.record,undefined);h.unmount()
})

test('the live camera sends immediately, while a new document with no browser storage waits and replays the identical accepted body',async()=>{
 const f=photoFixture(),native=nativeCaptureProtocol(f),storage=new Map(),posts=[];let lost=true
 const transport=photoTransport(f,{posted:request=>{posts.push(request);if(lost){lost=false;throw Error('Message accepted while host response was lost')}}})
 const fetcher=(path,init={})=>{native.guardMutation(path,init);return transport.fetcher(path,init)}
 let h=await harness(fetcher,storage,native.bridge);h.capture.setChatCaptureIdentity(f.context);let client=new h.capture.ChatCaptureClient(f.context,()=>true),context={...f.context,chatCapture:client}
 h.render(context);await settle();assert.equal(await h.render(context).takePhoto(),false);assert.equal(posts.length,1);assert(native.record.plan.photoIntent.media);assert.equal(native.record.plan.messageAttempted,true)
 const operationId=native.record.operationId,hash=native.record.prepared.sha256;h.unmount();storage.clear()
 h=await harness(fetcher,storage,native.bridge);h.capture.setChatCaptureIdentity(f.context);client=new h.capture.ChatCaptureClient(f.context,()=>true);context={...f.context,chatCapture:client};h.render(context);await settle()
 const pending=await client.refresh();assert.equal(pending.restored,true);assert.equal(posts.length,1,'Cold pending metadata must not send or read image bytes')
 const reads=native.calls.filter(c=>c.method==='read').length;await settle();assert.equal(native.calls.filter(c=>c.method==='read').length,reads)
 assert.equal(await h.render(context).resumeCapture(operationId),true);assert.equal(posts.length,2);assert.equal(posts[0].key,posts[1].key);assert.equal(posts[0].body,posts[1].body)
 assert.equal(transport.requests.filter(r=>r.path==='/v1/media').length,1);assert.equal(native.calls.filter(c=>c.method==='capture').length,1);assert.equal(pending.prepared.sha256,hash);assert.equal(native.record,undefined);assert.equal(storage.size,0);h.unmount()
})

test('native checkpoint failure cannot allocate media or submit a photo until the same durable operation is explicitly continued',async()=>{
 for(const stage of ['upload','message']){
  const f=photoFixture(),native=nativeCaptureProtocol(f),storage=new Map(),transport=photoTransport(f),fetcher=(path,init={})=>{native.guardMutation(path,init);return transport.fetcher(path,init)}
  native.failCheckpoint(plan=>stage==='upload'?!!plan.mediaIntent:plan.messageAttempted)
  const h=await harness(fetcher,storage,native.bridge);h.capture.setChatCaptureIdentity(f.context);const client=new h.capture.ChatCaptureClient(f.context,()=>true),context={...f.context,chatCapture:client};h.render(context);await settle()
  assert.equal(await h.render(context).takePhoto(),false);assert.equal(transport.requests.filter(r=>r.path.endsWith('/messages')&&r.method==='POST').length,0)
  if(stage==='upload')assert.equal(transport.requests.filter(r=>r.path==='/v1/media').length,0)
  const operation=native.record.operationId;assert.equal(await h.render(context).resumeCapture(operation),true)
  assert.equal(transport.requests.filter(r=>r.path==='/v1/media').length,1);assert.equal(native.record,undefined);h.unmount()
 }
})

test('a retired native original with a ready browser media marker exposes a bounded local stop instead of retrying a missing native record forever',async()=>{
 const f=photoFixture(),native=nativeCaptureProtocol(f),storage=new Map(),transport=photoTransport(f,{posted:()=>{throw Error('Accepted result was lost')}}),fetcher=(path,init={})=>{native.guardMutation(path,init);return transport.fetcher(path,init)}
 const h=await harness(fetcher,storage,native.bridge);h.capture.setChatCaptureIdentity(f.context);const client=new h.capture.ChatCaptureClient(f.context,()=>true),context={...f.context,chatCapture:client};h.render(context);await settle()
 assert.equal(await h.render(context).takePhoto(),false);const operation=native.record.operationId,marker=JSON.parse([...storage.entries()].find(([key])=>key.startsWith('xijie.chat-photo.intent.'))[1]);assert(marker.media)
 native.retire();await settle();assert.equal(await h.render(context).sendPhoto(),false);const missing=h.render(context);assert.equal(missing.photoCaptureMissing,true)
 const before=transport.requests.length;assert.equal(await missing.stopPhotoRetry(),true);assert.equal(transport.requests.length,before);assert.equal(storage.size,0);assert.equal(h.render(context).pendingPhoto,false)
 assert.equal(marker.key,operation);assert.equal(native.record,undefined);assert.equal(transport.rows[0].id,f.photo.id);h.unmount()
})

test('a validated message whose native cleanup fails keeps both journals and retries only its exact original receipt',async()=>{
 const f=photoFixture(),native=nativeCaptureProtocol(f),storage=new Map(),posts=[],transport=photoTransport(f,{posted:request=>{posts.push(request)}}),fetcher=(path,init={})=>{native.guardMutation(path,init);return transport.fetcher(path,init)}
 const h=await harness(fetcher,storage,native.bridge);h.capture.setChatCaptureIdentity(f.context);const client=new h.capture.ChatCaptureClient(f.context,()=>true),context={...f.context,chatCapture:client};h.render(context);await settle();native.failCleanup()
 assert.equal(await h.render(context).takePhoto(),false);const operation=native.record.operationId
 assert([...storage.keys()].some(key=>key.startsWith('xijie.chat-photo.intent.')));assert([...storage.keys()].some(key=>key.startsWith('xijie.media.intent.')));assert.equal(transport.rows[0].id,f.photo.id)
 assert.equal(await h.render(context).resumeCapture(operation),true);assert.equal(posts[0].key,posts[1].key);assert.equal(posts[0].body,posts[1].body);assert.equal(native.record,undefined);assert.equal(storage.size,0);h.unmount()
})

test('consuming a route request while native bytes are delayed does not cancel the owned replay, and a completed capture permits another camera action',async()=>{
 const f=photoFixture(),native=nativeCaptureProtocol(f),storage=new Map(),transport=photoTransport(f),fetcher=(path,init={})=>{native.guardMutation(path,init);return transport.fetcher(path,init)}
 const h=await harness(fetcher,storage,native.bridge);h.capture.setChatCaptureIdentity(f.context);const client=new h.capture.ChatCaptureClient(f.context,()=>true),context={...f.context,chatCapture:client};h.render(context);await settle()
 const gate=native.pauseRead(),sending=h.render(context).takePhoto();await settle();assert(native.record)
 h.render({...context,onMessages(){},captureRequestId:undefined});gate.resolve();assert.equal(await sending,true)
 const first=native.calls.find(c=>c.method==='capture').data.operationId;assert.equal(await h.render(context).takePhoto(),true)
 const captures=native.calls.filter(c=>c.method==='capture');assert.equal(captures.length,2);assert.notEqual(captures[1].data.operationId,first);assert.equal(h.render(context).pendingPhoto,false);h.unmount()
})

test('native renewal recovery keeps the captured expected version and promotes keys with the new slot in one durable checkpoint',async()=>{
 const f=photoFixture(),operationId=randomUUID(),storage=new Map(),nextSlot=randomUUID(),renewals=[];let durable,version=1,status='awaiting_upload',createCount=0,loseRenewal=true,puts=0
 const resource=()=>({id:f.mediaId,purpose:'conversation_attachment',status,mimeType:status==='ready'?'image/webp':'image/jpeg',byteSize:4,version:status==='ready'?3:version,authorizationVersion:1,createdAt:f.text.createdAt,updatedAt:f.text.createdAt,...(status==='ready'?{width:24,height:24}:{})})
 const slot=(id,expiresAt)=>({id,method:'PUT',url:'/v1/media/'+f.mediaId+'/uploads/'+id,requiredHeaders:{'Content-Type':'image/jpeg'},expiresAt})
 const fetcher=async(path,init={})=>{
  if(path==='/v1/media'){createCount++;return response({media:resource(),upload:slot(f.slot,'2000-01-01T00:00:00Z')})}
  if(path==='/v1/media/'+f.mediaId+'/upload-slots'){renewals.push({key:init.headers.get('Idempotency-Key'),version:init.headers.get('If-Match'),body:init.body});version=2;if(loseRenewal){loseRenewal=false;throw Error('Renewal was accepted before the host died')}return response({media:resource(),upload:slot(nextSlot,'2099-01-01T00:00:00Z')})}
  if(init.method==='PUT'){puts++;assert.equal(durable.uploadSlotId,nextSlot);assert.equal(durable.renewal,undefined);return new Response('')}
  if(path.endsWith('/complete')){status='ready';return response(resource())}
  if(path==='/v1/media/'+f.mediaId)return response(resource())
  throw Error('Unexpected capture renewal path')
 }
 const write=async value=>{if(durable&&value.uploadKey!==durable.uploadKey){assert(durable.renewal);assert.equal(value.uploadKey,durable.renewal.uploadKey);assert.equal(value.completeKey,durable.renewal.completeKey);assert.equal(value.uploadSlotId,nextSlot);assert.equal(value.renewal,undefined)}durable=JSON.parse(JSON.stringify(value))}
 let h=await harness(fetcher,storage),client=new h.media.MediaClient({...f.context,live:()=>true},'conversation_attachment',f.conversationId,{operationId,read:()=>durable,write,key:label=>h.capture.captureKey(operationId,label)}),prepared=await h.media.preparePhotos([f.file.source])
 await assert.rejects(client.upload(prepared,operationId,operationId),e=>e.code==='UPLOAD_SLOT_EXPIRED');assert.equal(durable.renewal.version,1);client.dispose();h.unmount();storage.clear()
 h=await harness(fetcher,storage);client=new h.media.MediaClient({...f.context,live:()=>true},'conversation_attachment',f.conversationId,{operationId,read:()=>durable,write,key:label=>h.capture.captureKey(operationId,label)})
 await assert.rejects(client.upload(prepared,operationId,operationId));assert.equal(durable.renewal.version,1);client.dispose();h.unmount();storage.clear()
 h=await harness(fetcher,storage);client=new h.media.MediaClient({...f.context,live:()=>true},'conversation_attachment',f.conversationId,{operationId,read:()=>durable,write,key:label=>h.capture.captureKey(operationId,label)})
 assert.equal((await client.upload(prepared,operationId,operationId))[0],f.mediaId);assert.deepEqual(renewals[0],renewals[1]);assert.equal(renewals[0].version,'"v1"');assert.equal(createCount,1);assert.equal(puts,1);client.dispose();h.unmount()
})

test('post-commit photo authorization failures retain the submitted identity and reject replacing its image',async()=>{
 for(const [status,code]of [[403,'CHAT_IMAGE_REPLY_PERMISSION_REQUIRED'],[409,'AUTHORIZATION_CHANGED']]){
  const f=photoFixture(),posts=[],storage=new Map();let denied=true
  const transport=photoTransport(f,{posted:request=>{posts.push(request);if(denied)return error(status,code)}}),h=await harness(transport.fetcher,storage)
  h.render(f.context);await settle();assert.equal(await h.render(f.context).sendPhoto(f.file),false)
  assert.equal(await h.render(f.context).sendPhoto({...f.file,source:'data:image/jpeg;base64,bmV3IQ=='}),false);assert.equal(posts.length,1);assert(h.render(f.context).feedback.text.includes('上一张照片'))
  denied=false;assert.equal(await h.render(f.context).sendPhoto(),true);assert.equal(posts[0].key,posts[1].key);assert.equal(posts[0].body,posts[1].body);h.unmount()
 }
})

test('an old ready photo rejected before acceptance after regrant retires its intent and permits a newly selected image',async()=>{
 const f=photoFixture(),storage=new Map(),posts=[];let phase='unknown'
 const transport=photoTransport(f,{posted:request=>{posts.push(request);if(phase==='unknown')return error(503,'DEPENDENCY_UNAVAILABLE');if(phase==='regranted')return error(409,'PHOTO_SELECTION_INVALID')}})
 let h=await harness(transport.fetcher,storage);h.render(f.context);await settle();assert.equal(await h.render(f.context).sendPhoto(f.file),false)
 const pending=[...storage.values()].map(value=>JSON.parse(value)).find(value=>value.personId===f.personId);assert.equal(pending.media.id,f.mediaId);h.unmount()
 phase='regranted';h=await harness(transport.fetcher,storage);h.render(f.context);await settle();assert.equal(await h.render(f.context).sendPhoto(),false)
 assert.equal(posts[0].key,posts[1].key);assert.equal(posts[0].body,posts[1].body);assert.equal(h.render(f.context).pendingPhoto,false)
  assert.equal(h.render(f.context).feedback.text,'这张照片未能发出，请重新选择。')
 assert(![...storage.keys()].some(key=>key.startsWith('xijie.chat-photo.intent.')));assert(![...storage.keys()].some(key=>key.startsWith('xijie.media.intent.')))
 phase='new-selection';assert.equal(await h.render(f.context).sendPhoto({...f.file,source:'data:image/jpeg;base64,bmV3IQ=='}),true)
 assert.notEqual(posts[2].key,posts[0].key);assert.notEqual(JSON.parse(posts[2].body).clientMessageId,JSON.parse(posts[0].body).clientMessageId)
 assert.equal(transport.requests.filter(request=>request.path==='/v1/media').length,2);h.unmount()
})

test('mixed photo history uses dedicated jobs, private proofs and exact source deletion without memory eligibility',async()=>{
 const f=photoFixture(),paths=[];let removed=false
 const h=await harness(async(path,init={})=>{
  paths.push(path)
  if(path==='/v1/conversations')return response({id:f.conversationId,kind:'direct',personId:f.personId})
  if(path.includes('/messages?'))return response(removed?[f.text,f.reply]:[f.text,f.photo,f.reply])
  if(path.includes('/generation-jobs/')){assert(path.endsWith('?kind=photo_reply'));return response(f.job)}
  if(path.endsWith('/read-url')){assert.deepEqual(JSON.parse(init.body),{purpose:'conversation_attachment',target:{kind:'conversation_message',id:f.photo.clientMessageId,conversationId:f.conversationId}});return response({mode:'authorized_stream',url:'/v1/media/'+f.mediaId+'/content',expiresAt:'2099-01-01T00:00:00Z',authorizationVersion:1,readProof:'abc.'+'a'.repeat(43)})}
  if(path.endsWith('/content')){assert.equal(init.headers.get('X-Media-Read-Proof'),'abc.'+'a'.repeat(43));return new Response(new Blob(['webp'],{type:'image/webp'}))}
  if(init.method==='DELETE'){assert.equal(init.headers.get('If-Match'),'"v1"');removed=true;return response({id:f.photo.id,version:2,removedAt:f.text.createdAt})}
  throw Error('Unexpected request')
 })
 h.render(f.context);await settle();let view=h.render(f.context);const photo=view.messages.find(m=>m.kind==='photo'),reply=view.messages.find(m=>m.serverId===f.reply.id)
 assert.equal(reply.generationKind,'photo_reply');assert.equal(reply.canSuggestMemory,false);assert.equal(photo.serverId,f.photo.id);assert.equal((await view.readPhoto(photo.id,photo.photo,new AbortController().signal)).size,4)
 assert.equal(await view.remove(photo),true);view=h.render(f.context);assert(!view.messages.some(m=>m.kind==='photo'));assert(view.messages.some(m=>m.serverId===f.reply.id))
 await assert.rejects(view.readPhoto(photo.id,photo.photo,new AbortController().signal),error=>error.code==='NOT_FOUND');h.unmount()
})

test('permission changes and account switches fence late photo upload acceptance and private bytes',{timeout:10000},async()=>{
 for(const transition of ['permission','account']){
  const f=photoFixture(),gate=defer(),submitted=defer(),transport=photoTransport(f,{posted:()=>{submitted.resolve();return gate.promise}}),h=await harness(transport.fetcher)
  h.render(f.context);await settle();const pending=h.render(f.context).sendPhoto(f.file)
  await submitted.promise
  assert(transport.requests.some(r=>r.path==='/v1/conversations/'+f.conversationId+'/messages'))
  const target=transition==='account'?{...f.context,accountId:randomUUID(),sessionId:randomUUID()}:f.context
  if(transition==='permission')h.dispatch('xijie:consents-changed');else h.render(target)
  transport.rows=[];gate.resolve(response({message:f.photo,generationJobId:f.jobId}));assert.equal(await pending,false);await settle()
  assert(!h.render(target).messages.some(m=>m.serverId===f.photo.id));assert([...h.storage.keys()].some(k=>k.startsWith('xijie.chat-photo.intent.'+f.context.accountId)));h.unmount()
 }
})

test('expired chat upload renews a slot on the same media and replays an unknown renewal with its fixed version and key',async()=>{
 const f=photoFixture(),storage=new Map(),newSlot=randomUUID(),renewals=[];let renewLost=true,ready=false,allocations=0
 const resource=()=>({id:f.mediaId,purpose:'conversation_attachment',status:ready?'ready':'awaiting_upload',mimeType:ready?'image/webp':'image/jpeg',byteSize:4,version:ready?3:1,authorizationVersion:1,createdAt:f.text.createdAt,updatedAt:f.text.createdAt,...(ready?{width:24,height:24}:{})})
 const upload=(id,expiresAt)=>({id,method:'PUT',url:'/v1/media/'+f.mediaId+'/uploads/'+id,requiredHeaders:{'Content-Type':'image/jpeg'},expiresAt})
 const fetcher=async(path,init={})=>{
  if(path==='/v1/media'){allocations++;return response({media:resource(),upload:upload(f.slot,'2000-01-01T00:00:00Z')})}
  if(path==='/v1/media/'+f.mediaId)return response(resource())
  if(path.endsWith('/upload-slots')){renewals.push({key:init.headers.get('Idempotency-Key'),version:init.headers.get('If-Match'),body:init.body});if(renewLost){renewLost=false;throw Error('lost slot response')}return response({media:resource(),upload:upload(newSlot,'2099-01-01T00:00:00Z')})}
  if(path.endsWith('/uploads/'+newSlot))return new Response('')
  if(path.endsWith('/complete')){assert.equal(JSON.parse(init.body).uploadSlotId,newSlot);ready=true;return response(resource())}
  throw Error('Unexpected path')
 }
 let h=await harness(fetcher,storage),client=new h.media.MediaClient({...f.context,live:()=>true},'conversation_attachment',f.conversationId)
 const photos=await h.media.preparePhotos([f.file.source]),operation=randomUUID(),target=f.photo.clientMessageId
 await assert.rejects(client.upload(photos,target,operation),e=>e.code==='UPLOAD_SLOT_EXPIRED');await assert.rejects(client.upload(photos,target,operation));client.dispose()
 h=await harness(fetcher,storage);client=new h.media.MediaClient({...f.context,live:()=>true},'conversation_attachment',f.conversationId)
 assert.equal((await client.upload(photos,target,operation))[0],f.mediaId);assert.equal(allocations,1);assert.equal(renewals.length,2);assert.deepEqual(renewals[0],renewals[1]);assert.equal(renewals[0].version,'"v1"');client.dispose()
})

test('a revoked source fences private content that arrives after its proof was issued',async()=>{
 const f=photoFixture(),gate=defer();let denied=false,contentRequested=false
 const h=await harness(async(path)=>{
  if(path==='/v1/conversations')return response({id:f.conversationId,kind:'direct',personId:f.personId})
  if(path.includes('/messages?'))return response(denied?[f.reply]:[f.photo,f.reply])
  if(path.includes('/generation-jobs/'))return response(f.job)
  if(path.endsWith('/read-url'))return response({mode:'authorized_stream',url:'/v1/media/'+f.mediaId+'/content',expiresAt:'2099-01-01T00:00:00Z',authorizationVersion:1,readProof:'abc.'+'a'.repeat(43)})
  if(path.endsWith('/content')){contentRequested=true;return gate.promise}
  throw Error('Unexpected path')
 })
 h.render(f.context);await settle();const view=h.render(f.context),photo=view.messages.find(m=>m.kind==='photo'),pending=view.readPhoto(photo.id,photo.photo,new AbortController().signal)
 await settle();assert(contentRequested);denied=true;h.dispatch('xijie:consents-changed');gate.resolve(new Response(new Blob(['webp'],{type:'image/webp'})))
 await assert.rejects(pending,e=>e.name==='AbortError');await settle();assert(!h.render(f.context).messages.some(m=>m.kind==='photo'));h.unmount()
})

test('real incoming and outgoing gift DTOs retain distinct directions and stable message UUIDs without ordinary generation',async()=>{
 const f=fixture(),paths=[];const h=await harness(async(path,init)=>{paths.push(path);if(path==='/v1/conversations')return response({id:f.conversationId,kind:'direct',personId:f.personId});if(path.includes('/messages?'))return response([f.incoming,f.outgoing,f.text]);throw Error('Unexpected generation request')})
 h.render(f.context);await settle();const view=h.render(f.context);assert.equal(view.messages.length,3);assert.deepEqual(Array.from(view.messages.map(m=>m.kind)),['gift','gift','me']);assert.equal(view.messages[0].direction,'sent');assert.equal(view.messages[1].direction,'received');assert.equal(view.messages[1].giftId,f.incoming.gift.id);assert.equal(view.messages[1].serverId,f.incoming.id);assert.equal(view.messages[1].generationJobId,undefined);assert(paths.every(path=>path==='/v1/conversations'||path.includes('/messages?')));h.unmount()
})

test('incoming gift rejects wrong author, template provenance and memory eligibility',async()=>{
 const f=fixture()
 for(const malformed of [{...f.incoming,author:{...f.incoming.author,personId:randomUUID()}},{...f.incoming,gift:{...f.incoming.gift,origin:{...f.incoming.gift.origin,contentOrigin:'template'}}},{...f.incoming,canSuggestMemory:true}]){
  const h=await harness(async path=>path==='/v1/conversations'?response({id:f.conversationId,kind:'direct',personId:f.personId}):response([malformed]));h.render(f.context);await settle();const view=h.render(f.context);assert.equal(view.messages.length,0);assert(view.feedback);h.unmount()
 }
})

test('permission changes clear every purpose and fence an already running history response',async()=>{
 const f=fixture(),gate=defer();let delayed=false
 const h=await harness(async path=>path==='/v1/conversations'?response({id:f.conversationId,kind:'direct',personId:f.personId}):delayed?gate.promise:response([f.outgoing,f.incoming,f.text]));h.render(f.context);await settle();assert.equal(h.render(f.context).messages.length,3)
 delayed=true;h.dispatch('focus');await settle();h.dispatch('xijie:consents-changed');assert.equal(h.render(f.context).messages.length,0)
 gate.resolve(response([f.outgoing,f.incoming,f.text]));await settle();const view=h.render(f.context);assert.equal(view.messages.length,0);h.unmount()
})

const page=(data,nextCursor=null,afterCursor=null)=>new Response(JSON.stringify({data,meta:{nextCursor,afterCursor}}))
const error=(status,code)=>new Response(JSON.stringify({error:{code}}),{status})
const history=f=>Array.from({length:180},(_,i)=>({...f.text,id:randomUUID(),sequence:String(i+1),text:'合成历史 '+(i+1)}))

const gatherFixture=()=>{
 const f=fixture(),worldId=randomUUID(),jobId=randomUUID()
 const context={accountId:f.context.accountId,sessionId:f.context.sessionId,target:{kind:'gather',worldId},onUnauthorized(){}}
 const detail={id:f.conversationId,kind:'gather',worldId,personId:null,canSend:true,createdAt:f.text.createdAt,version:1}
 const source={...f.text,generationJobId:jobId,generationKind:'gather_reply',clientMessageId:randomUUID()}
 const reply={...source,id:randomUUID(),sequence:'4',clientMessageId:undefined,text:'已提交的真实槽回复',author:{kind:'persona',personId:f.personId,displayName:'服务端历史署名',aiGenerated:true}}
 const job={id:jobId,kind:'gather_reply',targetId:f.conversationId,state:'succeeded',version:1,replyIds:[reply.id],participants:[]}
 return {...f,worldId,jobId,context,detail,source,reply,job}
}

test('gather parent polling retains partial replies and refreshes redacted names and links even at the same message version',async()=>{
 const f=gatherFixture();let removed=false;const paths=[]
 const h=await harness(async path=>{
  paths.push(path)
  if(path==='/v1/conversations'||path==='/v1/conversations/'+f.conversationId)return response(f.detail)
  if(path.includes('/generation-jobs/')){assert(path.endsWith('?kind=gather_reply'));return response({...f.job,state:'failed',failure:{code:'SOURCE_CHANGED',retryable:false}})}
  return page([f.source,removed?{...f.reply,author:{kind:'persona',displayName:'曾在这里的人物',aiGenerated:true}}:f.reply])
 })
 h.render(f.context);await settle();let view=h.render(f.context)
 assert.equal(view.messages.length,2);assert.equal(view.typing,false);assert.equal(view.messages[1].speakerDisplayName,'服务端历史署名');assert.equal(view.messages[1].speakerPersonId,f.personId);assert(view.feedback)
 removed=true;h.dispatch('focus');await settle();view=h.render(f.context)
 assert.equal(view.messages[1].speakerDisplayName,'曾在这里的人物');assert.equal(view.messages[1].speakerPersonId,undefined);assert.equal(view.messages[1].serverId,f.reply.id);assert.equal(view.messages[1].serverVersion,1)
 assert(paths.filter(path=>path.includes('/generation-jobs/')).length===1);h.unmount()
})

test('unknown gather acceptance survives reload and replays its complete original intent after residents leave',async()=>{
 const f=gatherFixture(),storage=new Map(),sent=[];let accepted,failRead=false,replaying=false
 const fetcher=async(path,init)=>{
  if(path==='/v1/conversations'||path==='/v1/conversations/'+f.conversationId)return response({...f.detail,canSend:!replaying})
  if(init?.method==='POST'){
   const body=JSON.parse(init.body),key=init.headers.get('Idempotency-Key');sent.push({body,key})
   if(!accepted)accepted={...f.source,id:randomUUID(),text:body.text,clientMessageId:body.clientMessageId}
   if(!replaying){failRead=true;throw new TypeError('accepted response lost')}
   return response({message:accepted,generationJobId:f.jobId,generationKind:'gather_reply'})
  }
  if(path.includes('/generation-jobs/'))return response({...f.job,state:'blocked',replyIds:[]})
  return failRead?error(503,'DEPENDENCY_UNAVAILABLE'):page(accepted?[accepted]:[])
 }
 let h=await harness(fetcher,storage);h.render(f.context);await settle()
 assert.equal(await h.render(f.context).send('固定的完整输入'),false);assert.equal(storage.size,1);assert.equal(h.render(f.context).pendingText,'固定的完整输入')
 const original=JSON.parse([...storage.values()][0]);assert.equal(original.target.worldId,f.worldId);assert.equal(original.body.inputMode,'typed');assert.equal(original.key,original.body.clientMessageId);h.unmount()
 replaying=true;failRead=false;h=await harness(fetcher,storage);h.render(f.context);await settle();let view=h.render(f.context)
 assert.equal(view.canSend,false);assert.equal(view.pendingText,'固定的完整输入');assert.equal(await view.send('不能改成另一个名单'),true)
 assert.deepEqual(sent[1],sent[0]);assert.equal(storage.size,0);assert.equal(h.render(f.context).pendingText,undefined);h.unmount()
})

test('post-commit gather permission and source errors keep the original key and body until accepted replay',async()=>{
 for(const [status,code]of [[403,'GATHER_PERMISSION_REQUIRED'],[409,'SOURCE_CHANGED']]){
  const f=gatherFixture(),sent=[];let accepted=false
  const h=await harness(async(path,init)=>{
   if(path==='/v1/conversations'||path==='/v1/conversations/'+f.conversationId)return response(f.detail)
   if(init?.method==='POST'){
    const body=JSON.parse(init.body);sent.push({body,key:init.headers.get('Idempotency-Key')})
    return accepted?response({message:{...f.source,text:body.text,clientMessageId:body.clientMessageId},generationJobId:f.jobId,generationKind:'gather_reply'}):error(status,code)
   }
   if(path.includes('/generation-jobs/'))return response({...f.job,state:'blocked',replyIds:[]})
   return page([])
  })
  h.render(f.context);await settle();assert.equal(await h.render(f.context).send('原始意图'),false);assert.equal(h.storage.size,1)
  accepted=true;assert.equal(await h.render(f.context).send('新输入不能替换'),true);assert.deepEqual(sent[0],sent[1]);h.unmount()
 }
})

test('unknown direct acceptance restores its complete locked intent and cannot change text or conversation on refresh',async()=>{
 const f=fixture(),storage=new Map(),sent=[],jobId=randomUUID();let replay=false,wrongTarget=false
 const fetcher=async(path,init={})=>{
  if(path==='/v1/conversations')return response({id:wrongTarget?randomUUID():f.conversationId,kind:'direct',personId:f.personId})
  if(path.endsWith('/messages')&&init.method==='POST'){
   const body=JSON.parse(init.body);sent.push({path,key:init.headers.get('Idempotency-Key'),body})
   if(!replay)throw new TypeError('accepted response lost')
   return response({message:{...f.text,text:body.text,clientMessageId:body.clientMessageId,generationJobId:jobId,sourceDomain:'virtual_context',canSuggestMemory:false},generationJobId:jobId})
  }
  if(path.includes('/generation-jobs/'))return response({id:jobId,state:'queued',version:1})
  return replay?page([]):error(503,'DEPENDENCY_UNAVAILABLE')
 }
 let h=await harness(fetcher,storage);h.render(f.context);await settle();assert.equal(await h.render(f.context).send('  请执行这一次虚拟行动  '),false)
 const original=JSON.parse([...storage.values()][0]);assert.equal(original.accountId,f.context.accountId);assert.equal(original.target.personId,f.personId);assert.equal(original.conversationId,f.conversationId)
 assert.equal(original.key,original.clientMessageId);assert.deepEqual(original.body,{clientMessageId:original.clientMessageId,kind:'text',text:'请执行这一次虚拟行动',inputMode:'typed'});h.unmount()
 replay=true;wrongTarget=true;h=await harness(fetcher,storage);h.render(f.context);await settle();assert.equal(await h.render(f.context).send('不能替换的新动作'),false);assert.equal(sent.length,1);assert.equal(storage.size,1);h.unmount()
 wrongTarget=false;h=await harness(fetcher,storage);h.render(f.context);await settle();assert.equal(h.render(f.context).pendingText,original.text)
 assert.equal(await h.render(f.context).send('不能替换的新动作'),true);assert.deepEqual(sent[1],sent[0]);assert.equal(storage.size,0);assert.equal(h.render(f.context).pendingText,undefined);h.unmount()
})

test('direct post-commit authority errors keep the locked request while a definite input rejection releases it',async()=>{
 for(const [status,code,retained]of [[403,'AI_PERMISSION_REQUIRED',true],[403,'STORAGE_PERMISSION_REQUIRED',true],[409,'AUTHORIZATION_CHANGED',true],[409,'WORLD_EVENT_CONTEXT_CHANGED',true],[400,'INVALID_ARGUMENT',false]]){
  const f=fixture(),sent=[],jobId=randomUUID();let retry=false
  const h=await harness(async(path,init={})=>{
   if(path==='/v1/conversations')return response({id:f.conversationId,kind:'direct',personId:f.personId})
   if(path.endsWith('/messages')&&init.method==='POST'){
    const body=JSON.parse(init.body);sent.push({key:init.headers.get('Idempotency-Key'),body})
    return retry?response({message:{...f.text,text:body.text,clientMessageId:body.clientMessageId,generationJobId:jobId},generationJobId:jobId}):error(status,code)
   }
   if(path.includes('/generation-jobs/'))return response({id:jobId,state:'queued',version:1})
   return page([])
  })
  h.render(f.context);await settle();assert.equal(await h.render(f.context).send('完整原意图'),false);assert.equal(h.storage.size,retained?1:0);assert.equal(h.render(f.context).pendingText,retained?'完整原意图':undefined)
  retry=true;assert.equal(await h.render(f.context).send('用户更正的文字'),true)
  if(retained)assert.deepEqual(sent[1],sent[0]);else{assert.notEqual(sent[1].key,sent[0].key);assert.equal(sent[1].body.text,'用户更正的文字')}
  h.unmount()
 }
})

test('legacy direct intents upgrade without changing the original request identity',async()=>{
 const f=fixture(),clientMessageId=randomUUID(),jobId=randomUUID(),storage=new Map([['xijie.chat.intent.'+f.context.accountId+'.'+f.personId,JSON.stringify({text:'旧版本未知原文',clientMessageId})]])
 const h=await harness(async(path,init={})=>{
  if(path==='/v1/conversations')return response({id:f.conversationId,kind:'direct',personId:f.personId})
  if(path.endsWith('/messages')&&init.method==='POST'){
   assert.equal(init.headers.get('Idempotency-Key'),clientMessageId);assert.deepEqual(JSON.parse(init.body),{clientMessageId,kind:'text',text:'旧版本未知原文',inputMode:'typed'})
   return response({message:{...f.text,text:'旧版本未知原文',clientMessageId,generationJobId:jobId},generationJobId:jobId})
  }
  if(path.includes('/generation-jobs/'))return response({id:jobId,state:'queued',version:1})
  return page([])
 },storage)
 h.render(f.context);await settle();assert.equal(h.render(f.context).pendingText,'旧版本未知原文');assert.equal(await h.render(f.context).send('新的文字不能换掉它'),true);assert.equal(storage.size,0);h.unmount()
})

test('direct ensure rejects another person or a gathering before binding or posting the locked text',async()=>{
 for(const targetKind of ['wrong-person','gather']){
  const f=fixture(),paths=[],jobId=randomUUID();let corrected=false
  const h=await harness(async(path,init={})=>{
   paths.push({path,method:init.method??'GET'})
   if(path==='/v1/conversations')return response(corrected?{id:f.conversationId,kind:'direct',personId:f.personId}:targetKind==='wrong-person'?{id:randomUUID(),kind:'direct',personId:randomUUID()}:{id:randomUUID(),kind:'gather',personId:null,worldId:randomUUID(),canSend:true,version:1})
   if(path.endsWith('/messages')&&init.method==='POST'){
    const body=JSON.parse(init.body);return response({message:{...f.text,text:body.text,clientMessageId:body.clientMessageId,generationJobId:jobId},generationJobId:jobId})
   }
   if(path.includes('/generation-jobs/'))return response({id:jobId,state:'queued',version:1})
   return page([])
  })
  h.render(f.context);await settle();assert.equal(await h.render(f.context).send('必须属于当前人物的请求'),false)
  assert(!paths.some(p=>p.path.includes('/messages')));const original=JSON.parse([...h.storage.values()][0]);assert.equal(original.conversationId,undefined);assert.equal(original.target.personId,f.personId)
  corrected=true;assert.equal(await h.render(f.context).send('不能换新意图'),true);assert.equal(h.storage.size,0);assert.equal(paths.filter(p=>p.method==='POST'&&p.path.endsWith('/messages')).length,1);h.unmount()
 }
})

test('direct accepted response cannot clear an intent or poll a different outer generation job',async()=>{
 const f=fixture(),jobId=randomUUID(),foreignJob=randomUUID(),sent=[],polled=[];let corrected=false
 const h=await harness(async(path,init={})=>{
  if(path==='/v1/conversations')return response({id:f.conversationId,kind:'direct',personId:f.personId})
  if(path.endsWith('/messages')&&init.method==='POST'){
   const body=JSON.parse(init.body);sent.push({key:init.headers.get('Idempotency-Key'),body})
   return response({message:{...f.text,text:body.text,clientMessageId:body.clientMessageId,generationJobId:jobId},generationJobId:corrected?jobId:foreignJob})
  }
  if(path.includes('/generation-jobs/')){polled.push(path);return response({id:jobId,state:'queued',version:1})}
  return page([])
 })
 h.render(f.context);await settle();assert.equal(await h.render(f.context).send('需要精确任务身份的原文'),false);assert.equal(h.storage.size,1);assert.equal(h.render(f.context).messages.length,0);assert.equal(polled.length,0)
 corrected=true;assert.equal(await h.render(f.context).send('不能换新意图'),true);await settle();assert.deepEqual(sent[1],sent[0]);assert.equal(h.storage.size,0);assert(polled.every(path=>path==='/v1/generation-jobs/'+jobId));h.unmount()
})

test('direct consent and session changes fence late accepted responses without clearing the durable intent',async()=>{
 for(const change of ['consent','session','account']){
  const f=fixture(),gate=defer(),jobId=randomUUID();let posted,denied=false
  const h=await harness(async(path,init={})=>{
   if(path==='/v1/conversations')return response({id:f.conversationId,kind:'direct',personId:f.personId})
   if(path.endsWith('/messages')&&init.method==='POST'){posted=JSON.parse(init.body);return gate.promise}
   return denied?error(403,'STORAGE_PERMISSION_REQUIRED'):page([])
  })
  h.render(f.context);await settle();const sending=h.render(f.context).send('等待确认的原文');await settle();assert(posted)
  denied=true;const next=change==='consent'?f.context:{...f.context,sessionId:randomUUID(),...(change==='account'?{accountId:randomUUID()}:{})}
  if(change==='consent')h.dispatch('xijie:consents-changed');else h.render(next)
  gate.resolve(response({message:{...f.text,text:posted.text,clientMessageId:posted.clientMessageId,generationJobId:jobId},generationJobId:jobId}));assert.equal(await sending,false);await settle()
  const view=h.render(next);assert.equal(view.messages.length,0);assert.equal(h.storage.size,1);assert.equal(view.pendingText,change==='account'?undefined:'等待确认的原文');h.unmount()
 }
})

test('virtual source domains survive projection and refresh while ordinary text remains distinct',async()=>{
 const f=fixture(),jobId=randomUUID(),source={...f.text,clientMessageId:randomUUID(),generationJobId:jobId,sourceDomain:'virtual_context',canSuggestMemory:false}
 const reply={...f.text,id:randomUUID(),sequence:'4',author:{kind:'persona',personId:f.personId,displayName:'合成TA',aiGenerated:true},generationJobId:jobId,sourceDomain:'virtual_action',canSuggestMemory:false}
 let rows=[source,reply]
 const h=await harness(async path=>path==='/v1/conversations'?response({id:f.conversationId,kind:'direct',personId:f.personId}):path.includes('/generation-jobs/')?response({id:jobId,state:'blocked',version:1,failure:{code:'WORLD_ACTION_PERMISSION_REQUIRED',retryable:false}}):page(rows))
 h.render(f.context);await settle();let view=h.render(f.context);assert.deepEqual(Array.from(view.messages,m=>m.sourceDomain),['virtual_context','virtual_action']);assert(view.feedback.text.includes('重新发起行动'));assert.equal(view.pendingText,undefined)
 rows=[{...source,sourceDomain:undefined}, {...reply,sourceDomain:'virtual_context'}];h.dispatch('focus');await settle();view=h.render(f.context)
 assert.deepEqual(Array.from(view.messages,m=>m.sourceDomain),[undefined,'virtual_context']);assert.equal(view.messages[0].canSuggestMemory,false);h.unmount()
})

test('empty-resident gathering keeps server history while refusing a new send and rejecting foreign anchors',async()=>{
 const f=gatherFixture(),paths=[],service={...f.context,anchor:{conversationId:randomUUID(),messageId:randomUUID()}}
 const h=await harness(async(path,init)=>{paths.push({path,method:init?.method});if(path==='/v1/conversations'||path==='/v1/conversations/'+f.conversationId)return response({...f.detail,canSend:false});return page([f.text])})
 h.render(service);await settle();let view=h.render(service);assert.equal(view.messages.length,1);assert.equal(view.focusServerId,undefined);assert.equal(view.canSend,false)
 assert.equal(await view.send('新发言'),false);assert.equal(h.storage.size,0);assert(h.render(service).feedback.text.includes('围坐至少需要两位人物'));assert(!paths.some(p=>p.path.includes('/context?')));assert(!paths.some(p=>p.method==='POST'&&p.path.endsWith('/messages')));h.unmount()
})

test('gather consent withdrawal fences late detail/history and retains a locked unknown send for the original account only',async()=>{
 const f=gatherFixture(),gate=defer();let delayed=false,denied=false
 const h=await harness(async(path,init)=>{
  if(path==='/v1/conversations')return response(f.detail)
  if(path==='/v1/conversations/'+f.conversationId)return delayed?gate.promise:response(f.detail)
  if(init?.method==='POST')return error(503,'DEPENDENCY_UNAVAILABLE')
  return denied?error(403,'STORAGE_PERMISSION_REQUIRED'):page([f.text])
 })
 h.render(f.context);await settle();denied=true;assert.equal(await h.render(f.context).send('撤回时保留输入'),false)
 delayed=true;h.dispatch('focus');await settle();h.dispatch('xijie:consents-changed');assert.equal(h.render(f.context).messages.length,0)
 gate.resolve(response(f.detail));await settle();let view=h.render(f.context);assert.equal(view.messages.length,0);assert.equal(view.pendingText,'撤回时保留输入')
 const other={...f.context,accountId:randomUUID(),sessionId:randomUUID()};h.render(other);await settle();assert.equal(h.render(other).pendingText,undefined);assert.equal(h.render(other).messages.length,0);assert.equal(h.storage.size,1);h.unmount()
})

test('UUID context expands both directions with limit 50 and polls the same bounded window',async()=>{
 const f=fixture(),all=history(f),paths=[],anchor=all[89]
 const service={...f.context,anchor:{conversationId:f.conversationId,messageId:anchor.id}}
 const h=await harness(async path=>{
  paths.push(path)
  if(path==='/v1/conversations')return response({id:f.conversationId,kind:'direct',personId:f.personId})
  if(path.includes('/context?'))return response({anchorMessageId:anchor.id,items:all.slice(65,115),beforeCursor:'before65',afterCursor:'after115'})
  const u=new URL(path,'http://synthetic'),direction=u.searchParams.get('direction'),cursor=u.searchParams.get('cursor');assert.equal(u.searchParams.get('limit'),'50')
  if(direction==='older'&&cursor==='before65')return page(all.slice(15,65),'before15')
  if(direction==='newer'&&cursor==='after115')return page(all.slice(115,165),'after165','after165')
  throw Error('Unexpected unbounded or recent history read')
 })
 h.render(service);await settle();let view=h.render(service);assert.equal(view.messages.length,50);assert.equal(view.focusServerId,anchor.id);assert(view.hasOlder&&view.hasNewer)
 await view.loadOlder();view=h.render(service);assert.equal(view.messages.length,100);assert.equal(view.messages[0].sequence,'16')
 await view.loadNewer();view=h.render(service);assert.equal(view.messages.length,150);assert.equal(view.messages.at(-1).sequence,'165');const numericId=view.messages.find(m=>m.serverId===anchor.id).id
 h.dispatch('focus');await settle();view=h.render(service);assert.equal(view.messages.length,150);assert.equal(view.messages.find(m=>m.serverId===anchor.id).id,numericId);assert.equal(view.messages.at(-1).sequence,'165');assert(paths.filter(p=>p.includes('/context?limit=50')).length>=4);h.unmount()
})

test('missing context falls back to recent without treating the person as missing; cross-person anchors never read their context',async()=>{
 for(const crossPerson of [false,true]){
  const f=fixture(),all=history(f),paths=[];let missing=0
  const service={...f.context,onMissing(){missing++},anchor:{conversationId:crossPerson?randomUUID():f.conversationId,messageId:all[10].id}}
  const h=await harness(async path=>{paths.push(path);if(path==='/v1/conversations')return response({id:f.conversationId,kind:'direct',personId:f.personId});if(path.includes('/context?'))return error(404,'NOT_FOUND');return page(all.slice(-50))})
  h.render(service);await settle();const view=h.render(service);assert.equal(view.messages.length,50);assert.equal(view.focusServerId,undefined);assert.equal(missing,0);assert(view.feedback.text.includes('当前会话'));assert.equal(paths.some(p=>p.includes('/context?')), !crossPerson);h.unmount()
 }
})

test('a text anchor denied after story withdrawal returns to currently readable outgoing gifts',async()=>{
 const f=fixture(),service={...f.context,anchor:{conversationId:f.conversationId,messageId:f.text.id}};let missing=0,denied=false,contexts=0
 service.onMissing=()=>missing++
 const h=await harness(async path=>{
  if(path==='/v1/conversations')return response({id:f.conversationId,kind:'direct',personId:f.personId})
  if(path.includes('/context?')){contexts++;return denied?error(403,'STORY_PERMISSION_REQUIRED'):response({anchorMessageId:f.text.id,items:[f.text],beforeCursor:null,afterCursor:null})}
  return page([f.outgoing])
 })
 h.render(service);await settle();assert.equal(h.render(service).messages[0].kind,'me');denied=true;h.dispatch('xijie:consents-changed');await settle();let view=h.render(service)
 assert.equal(view.messages.length,1);assert.equal(view.messages[0].kind,'gift');assert.equal(view.focusServerId,undefined);assert.equal(missing,0)
 h.dispatch('focus');await settle();view=h.render(service);assert.equal(view.messages[0].serverId,f.outgoing.id);assert.equal(contexts,2);h.unmount()
})

test('context rejects a foreign conversation item or a missing anchor rather than substituting another message',async()=>{
 for(const wrongConversation of [false,true]){
  const f=fixture(),anchor=f.text.id,service={...f.context,anchor:{conversationId:f.conversationId,messageId:anchor}}
  const h=await harness(async path=>path==='/v1/conversations'?response({id:f.conversationId,kind:'direct',personId:f.personId}):response({anchorMessageId:anchor,items:[{...f.text,...(wrongConversation?{conversationId:randomUUID()}:{id:randomUUID()})}],beforeCursor:null,afterCursor:null}))
  h.render(service);await settle();const view=h.render(service);assert.equal(view.messages.length,0);assert(view.feedback);h.unmount()
 }
})

test('old context responses cannot refill a changed account or revoked permission',async()=>{
 const f=fixture(),gate=defer(),service={...f.context,anchor:{conversationId:f.conversationId,messageId:f.text.id}}
 const h=await harness(async path=>path==='/v1/conversations'?response({id:f.conversationId,kind:'direct',personId:f.personId}):path.includes('/context?')?gate.promise:page([]))
 h.render(service);await settle();h.dispatch('xijie:consents-changed');gate.resolve(response({anchorMessageId:f.text.id,items:[f.text],beforeCursor:null,afterCursor:null}));await settle();assert.equal(h.render(service).messages.length,0)
 const other={...f.context,accountId:randomUUID(),sessionId:randomUUID()};h.render(other);await settle();assert.equal(h.render(other).messages.length,0);h.unmount()
})

test('accepted send leaves an anchored window and loads recent history; gift visible text includes direction, quantity and note',async()=>{
 const f=fixture(),all=history(f),anchor=all[10],job=randomUUID(),service={...f.context,anchor:{conversationId:f.conversationId,messageId:anchor.id}};let accepted
 const h=await harness(async(path,init)=>{
  if(path==='/v1/conversations')return response({id:f.conversationId,kind:'direct',personId:f.personId})
  if(path.includes('/context?'))return response({anchorMessageId:anchor.id,items:all.slice(0,50),beforeCursor:null,afterCursor:'later'})
  if(init?.method==='POST'){const body=JSON.parse(init.body);accepted={...f.text,id:randomUUID(),sequence:'181',clientMessageId:body.clientMessageId,generationJobId:job,text:body.text};return response({message:accepted,generationJobId:job})}
  if(path.includes('/generation-jobs/'))return response({id:job,state:'queued',version:1})
  return page([...all.slice(-47),f.outgoing,f.incoming,...(accepted?[accepted]:[])])
 })
 h.render(service);await settle();assert.equal(await h.render(service).send('新的真实输入'),true);await settle();const view=h.render(service);assert.equal(view.focusServerId,undefined);assert.equal(view.hasNewer,false);assert(view.messages.some(m=>m.sequence==='180'));assert.equal(view.messages.find(m=>m.serverId===f.outgoing.id).text,'[礼物] 送出 鲜花 ×1 · 合成赠言');assert.equal(view.messages.find(m=>m.serverId===f.incoming.id).text,'[礼物] 收到 鲜花 ×1 · 真实生成来源');h.unmount()
})
