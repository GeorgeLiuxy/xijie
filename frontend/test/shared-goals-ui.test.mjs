import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'
const code=ts.transpileModule((await readFile(new URL('../src/gifts/GiftGoals.tsx',import.meta.url),'utf8')).replaceAll('import.meta.env.VITE_XIJIE_AUTH_MODE',"'service'"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React}}).outputText
const defer=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)}},settle=async()=>{for(let n=0;n<12;n++)await Promise.resolve()}
const flatten=tree=>tree&&typeof tree==='object'?[tree,...(tree.props.children??[]).flat(Infinity).flatMap(flatten)]:[]
const text=tree=>typeof tree==='string'?tree:tree&&typeof tree==='object'?(tree.props.children??[]).flat(Infinity).map(text).join(''):''
async function fixture(){
 const accountId=randomUUID(),sessionId=randomUUID(),id=randomUUID(),cid=randomUUID(),pending={id,kind:'home',name:'合成心愿',message:'公开附言',world:'courtyard',current:1,target:6,parts:['门牌'],isOwner:true,canHelp:false,helped:false,completed:false,contributions:[{seat:-1,text:'PRIVATE_AUTHOR_A',value:0,contributionId:cid,status:'pending',version:1}],album:{url:'http://localhost/gifts/'+'b'.repeat(43),version:1,status:'active'}},approved={...pending,current:2,parts:['门牌','窗'],contributions:[{...pending.contributions[0],seat:1,value:1,status:'approved',version:2}]}
 let si=0,ri=0,ei=0,tree,props,reads=0,interval;const states=[],refs=[],effects=[],queued=[],reviews=[],lateRead=defer(),reviewing=defer()
 const context=vm.createContext({AbortController,DOMException,URLSearchParams,crypto:globalThis.crypto,location:{search:'',origin:'http://localhost'},console,React:{createElement:(type,props,...children)=>({type,props:{...props,children}})},window:{setInterval:fn=>{interval=fn;return 1},clearInterval(){}},document:{hidden:false,addEventListener(){},removeEventListener(){}}})
 const synth=values=>new vm.SyntheticModule(Object.keys(values),function(){for(const[k,v]of Object.entries(values))this.setExport(k,v)},{context})
 const react=synth({lazy:()=>function Scene(){},Suspense(){},useState(value){const i=si++;if(!(i in states))states[i]=typeof value==='function'?value():value;return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v}]},useRef(value){const i=ri++;return refs[i]??(refs[i]={current:value})},useEffect(fn,deps){const i=ei++,old=effects[i];if(!old||deps.some((v,j)=>v!==old.deps[j]))queued.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:fn()}})}})
 class AlbumError extends Error{};class GoalError extends Error{}
 const noop=()=>{},albums={AlbumError,createAlbum:noop,readAlbum:async()=>{reads++;return reads===1?pending:lateRead.promise},contributeAlbum:noop,withdrawAlbum:noop,adoptAlbum:noop,closeAlbum:noop,claimAlbum:noop,albumPending:noop,albumCreateKey:noop,albumContributionKey:noop,pendingAlbumReviews:()=>[],retireRejectedAlbumReview:noop,reviewAlbum:async(ctx,album,snapshot,decision)=>{reviews.push({accountId:ctx.accountId,album,snapshot,decision});return reviewing.promise}}
 const module=new vm.SourceTextModule(code,{context});await module.link(name=>name==='react'?react:name==='../ContentReports'?synth({useContentReports:()=>null}):name==='../i18n'?synth({LangProvider(){},useI18n:()=>({lang:'zh-CN'}),isZh:()=>true}):name==='../study/journeys'?synth({destination:()=>({place:'合成目的地'})}):name==='../ui'?synth({I:new Proxy({},{get:()=>function Icon(){}}),haptic:noop,chime:noop}):name==='../mobile/back'?synth({useNativeBack:noop}):name==='./PublicGiftFrame'?synth({PublicGiftFrame(){}}):name==='./goals.css'?synth({}):name==='./client'?synth({claimGoalReward:noop,GoalError,goalRequest:noop,getGiftGoal:noop,goalUrl:noop}):name==='../serviceAlbums'?synth(albums):Promise.reject(Error('Unexpected import '+name)));await module.evaluate()
 props={id,serviceContext:{accountId,sessionId,onUnauthorized:noop},onClose:noop}
 const render=(next={},flush=true)=>{props={...props,...next};si=ri=ei=0;tree=module.namespace.GiftGoalView(props);if(flush)while(queued.length)queued.shift()();return tree}
 const find=name=>flatten(tree).find(node=>node.type==='button'&&text(node)===name)
 render();await settle();render()
 return {pending,approved,reviews,lateRead,reviewing,render,find,text:()=>text(tree),tick:()=>interval(),flush(){while(queued.length)queued.shift()()},dispose(){effects.forEach(e=>e.cleanup?.())}}
}
test('an owner account switch hides private contribution text at render and refuses the old review handler before effects clean up',async()=>{
 const f=await fixture(),old=f.find('接受这份心意');assert(old);assert(f.text().includes('PRIVATE_AUTHOR_A'));f.render({serviceContext:{accountId:randomUUID(),sessionId:randomUUID(),onUnauthorized(){}}},false);assert(!f.text().includes('PRIVATE_AUTHOR_A'));old.props.onClick();await settle();assert.equal(f.reviews.length,0);f.flush();f.dispose()
})
test('a poll begun during owner review cannot overwrite acknowledged approval with its earlier pending snapshot',async()=>{
 const f=await fixture();f.find('接受这份心意').props.onClick();await settle();f.tick();await settle();f.reviewing.resolve(f.approved);await settle();f.render();assert(!f.find('接受这份心意'));f.lateRead.resolve(f.pending);await settle();f.render();assert(!f.find('接受这份心意'));assert(f.text().includes('审核通过'));f.dispose()
})

