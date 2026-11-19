import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'
const code=ts.transpileModule(await readFile(new URL('../src/auth/AiTextPermission.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React}}).outputText
const settle=async()=>{for(let i=0;i<7;i++)await new Promise(r=>setImmediate(r))}
const element=(type,props,...children)=>({type,props:{...props,children:children.flat()}})
const all=node=>node&&typeof node==='object'?[node,...(node.props?.children??[]).flatMap(all)]:[]
const text=node=>typeof node==='string'?node:node&&typeof node==='object'?(node.props?.children??[]).map(text).join(''):''
async function harness(purpose,authorityName,componentName){
 let si=0,ri=0,ei=0,version=0,allowed=false;const states=[],refs=[],effects=[],pending=[],storage=new Map(),posts=[],listeners=new Map(),sessionId=randomUUID()
 const policy={id:randomUUID(),kind:purpose,version:1},privacy={id:randomUUID(),kind:'privacy_notice',version:1}
 const add=(n,f)=>{const group=listeners.get(n)??new Set();group.add(f);listeners.set(n,group)},remove=(n,f)=>listeners.get(n)?.delete(f)
 const fetcher=async(path,init)=>{
  assert.equal(init.headers.get('X-Xijie-Expected-Session'),sessionId)
  if(init.method==='POST'){const body=JSON.parse(init.body);posts.push(body);version++;allowed=body.decision==='grant';return new Response(JSON.stringify({data:{id:randomUUID(),purpose,decision:body.decision,authorizationVersion:version}}))}
  if(path.startsWith('/v1/policies/current'))return new Response(JSON.stringify({data:[privacy,policy].map(p=>({...p,documentUrl:'/v1/policies/'+p.id+'/1?locale=zh-CN'}))}))
  if(path.startsWith('/v1/accounts/me/consents'))return new Response(JSON.stringify({data:[],meta:{currentAuthorizationVersions:{privacy_notice:1,ai_text_processing:0,private_story_storage:0,[purpose]:version},currentDecisions:{privacy_notice:'acknowledge',...(version?{[purpose]:allowed?'grant':'revoke'}:{})},[authorityName]:{allowed,authorizationVersion:version}}}))
  return new Response('当前独立政策正文')
 }
 const context=vm.createContext({React:{createElement:element},fetch:fetcher,Headers,AbortSignal,AbortController,crypto:globalThis.crypto,Event,sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},window:{setInterval:()=>1,clearInterval(){},addEventListener:add,removeEventListener:remove,dispatchEvent(event){for(const f of listeners.get(event.type)??[])f()}},document:{visibilityState:'visible',addEventListener:add,removeEventListener:remove}})
 const synthetic=values=>new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v)},{context})
 const imports={react:synthetic({useState(v){const i=si++;if(!(i in states))states[i]=typeof v==='function'?v():v;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useRef(v){const i=ri++;return refs[i]??(refs[i]={current:v})},useEffect(fn,deps){const i=ei++,old=effects[i];if(!old||deps.some((v,j)=>v!==old.deps[j]))pending.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:fn()}})}}),'../i18n':synthetic({useI18n:()=>({lang:'zh-CN'}),isZh:()=>true})}
 const purposes=new vm.SourceTextModule(ts.transpileModule(await readFile(new URL('../src/auth/consentPurposes.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context});await purposes.link(()=>assert.fail('Unexpected purpose import'));await purposes.evaluate()
 const module=new vm.SourceTextModule(code,{context});await module.link(n=>n==='./consentPurposes'?purposes:imports[n]);await module.evaluate()
 return {posts,render(){si=ri=ei=0;const wrapper=module.namespace[componentName]({sessionId,onUnauthorized(){throw Error('unexpected auth')}}),tree=wrapper.type(wrapper.props);while(pending.length)pending.shift()();return tree},unmount(){effects.forEach(e=>e.cleanup?.())}}
}
test('letter storage, letter replies and gathering replies use separate original privacy regions and independent grants',async()=>{
 for(const [purpose,authority,component,region,grant,revoke]of [
  ['private_letter_storage','letterStorage','LetterStoragePermission','书信保存授权','允许保存书信','撤回书信保存授权'],
  ['person_letter_replies','letterReplies','LetterRepliesPermission','AI书信回信授权','允许AI书信回信','撤回AI书信回信授权'],
  ['person_gather_replies','gatherReplies','GatherRepliesPermission','AI围坐回应授权','允许AI围坐回应','撤回AI围坐回应授权'],
  ['private_chat_photo_storage','chatPhotoStorage','ChatPhotoStoragePermission','聊天照片保存授权','允许保存聊天照片','撤回聊天照片保存授权'],
  ['person_chat_image_replies','chatImageReplies','ChatImageRepliesPermission','AI看图回应授权','允许AI看图回应','撤回AI看图回应授权'],
  ['person_world_actions','worldActionProcessing','WorldActionPermission','世界行动授权','允许世界行动','撤回世界行动授权'],
 ]){
  const h=await harness(purpose,authority,component);h.render();await settle();let tree=h.render();assert.equal(tree.props['aria-label'],region);assert(text(tree).includes('当前独立政策正文'));assert(text(tree).includes('尚未允许'))
  assert.equal(h.posts.length,0)
  const action=all(tree).find(n=>n.type==='button'&&text(n)===grant);assert(action);action.props.onClick();await settle();tree=h.render();assert.equal(h.posts.length,1);assert.equal(h.posts[0].purpose,purpose);assert.equal(h.posts[0].expectedAuthorizationVersion,0);assert(text(tree).includes('已允许'));assert(all(tree).some(n=>n.type==='button'&&text(n)===revoke))
  if(purpose==='person_world_actions'){
   assert(text(tree).includes('OpenAI'));assert(text(tree).includes('不会自动珍藏'));assert(text(tree).includes('再次同意不会自动重做已停止的操作'))
   all(tree).find(n=>n.type==='button'&&text(n)===revoke).props.onClick();await settle();assert.equal(h.posts.length,2);assert.equal(h.posts[1].purpose,purpose);assert.equal(h.posts[1].decision,'revoke');assert.equal(h.posts[1].expectedAuthorizationVersion,1);assert(text(h.render()).includes('尚未允许'))
  }
  h.unmount()
 }
})
