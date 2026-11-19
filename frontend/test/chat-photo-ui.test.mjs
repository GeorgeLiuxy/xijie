import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'
const source=await readFile(new URL('../src/person.tsx',import.meta.url),'utf8')
const ast=ts.createSourceFile('person.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
const code=ts.transpileModule(['TalkTab','Bubble'].map(name=>ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(ast).replace(/^export /,'')).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React}}).outputText
const voiceCode=ts.transpileModule(await readFile(new URL('../src/voiceInput.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const voice=await import('data:text/javascript,'+encodeURIComponent(voiceCode))
const element=(type,props,...children)=>({type,props:{...props,children:children.flat()}})
const all=node=>node&&typeof node==='object'?[node,...(node.props?.children??[]).flatMap(all)]:[]
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r))}
function harness(remote,lang='zh-CN',runEffects=false){
 let si=0,ri=0,ei=0,draft='保留的文字草稿',writes=0,templateCalls=0;const states=[],refs=[],timers=[],effects=[],queued=[],I=new Proxy({},{get:(_,key)=>String(key)})
 const hooks={useState(v){const i=si++;if(!(i in states))states[i]=typeof v==='function'?v():v;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useRef(v){const i=ri++;return refs[i]??(refs[i]={current:v})},useEffect(fn,deps){if(!runEffects)return;const i=ei++,old=effects[i];if(!old||deps.some((v,j)=>v!==old.deps[j]))queued.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:fn()}})},useLayoutEffect(){},useMemo:fn=>fn()}
 const context=vm.createContext({...hooks,React:{createElement:element},useI18n:()=>({lang,t:k=>k}),isZh:()=>lang!=='en',quickReplies:()=>[],useNativeBack(){},useConversationHistory:(_initial,_persist,intro)=>[intro(),()=>writes++],useServiceConversation:()=>remote,useConversationDraft:()=>[draft,v=>{draft=v}],useThreadScroll:()=>({scroller:{current:null},highlighted:null}),nid:()=>1,fmtTime:()=>'',fmtDuration:()=>'',fxPrefs:{calm:true},haptic(){},photoReply(){templateCalls++;throw Error('No service template')},fileToDataUrl(){throw Error('No local service photo')},I,Gift:'Gift',Lens:'Lens',PrivatePhoto:'PrivatePhoto',Act:'Act',HorizonSignal:'HorizonSignal',MessageRow:'MessageRow',GiftMessageCard:'GiftMessageCard',Toast:'Toast',window:{setTimeout(fn,ms){timers.push({fn,ms});return timers.length}},clearTimeout(){}})
 context.CallOverlay='CallOverlay';context.CallInterestSheet='CallInterestSheet';context.StoryReview='StoryReview';context.useContentReports=()=>remote.reports;context.browserRecognition=()=>remote.Recognition;context.startVoiceInput=voice.startVoiceInput;context.VoiceInputError=voice.VoiceInputError;context.Sheet='Sheet';context.speechLang=()=> 'zh-CN';context.useVoiceCallRecords=()=>({messages:[],loading:false,hasOlder:false,loadOlder:async()=>{},error:'',retry:async()=>{}})
 const component=vm.runInContext(code+'\n({TalkTab,Bubble})',context)
 return {render(props){si=ri=ei=0;const tree=component.TalkTab(props);while(queued.length)queued.shift()();return tree},bubble:component.Bubble,get draft(){return draft},set draft(v){draft=v},get writes(){return writes},get templateCalls(){return templateCalls},timers}
}
const props=()=>({person:{id:1,serverId:'synthetic',name:'合成TA',world:'courtyard',memories:[]},neighbors:[],draftOwner:'account.synthetic',serviceAccount:true,serviceConversation:{},overlayRoot:{current:null},onUpdate(){throw Error('local person update')},onPersist(){throw Error('local transcript write')},onLetter(){},onGather(){},onGift(){},onProfile(){},onEcho(){}})
const remoteState=()=>({conversationId:'bound-service-conversation',messages:[],loading:false,sending:false,typing:false,feedback:null,clearFeedback(){},readPhoto:async()=>{},sendPhoto:async()=>false})

test('reply failure stays next to the composer and clears when a new message is edited', () => {
 const text = '消息已保存，TA 暂时无法回复。'
 const remote = { ...remoteState(), feedback: { id: 1, text, placement: 'composer' }, clearFeedback() { this.feedback = null } }
 const h = harness(remote, 'zh-CN', true), p = props()
 h.render(p)
 const elements = all(h.render(p))
 const status = elements.find(node => node.props?.id === 'chat-composer-status')
 const input = elements.find(node => node.type === 'textarea')
 assert.equal(status.props.role, 'status')
 assert.equal(status.props.children.join(''), text)
 assert.equal(input.props['aria-describedby'], status.props.id)
 assert(!elements.some(node => node.type === 'Toast'))
 assert.equal(h.timers.length, 0)
 input.props.onChange({ target: { value: '下一条消息' } })
 assert.equal(h.draft, '下一条消息')
 assert(!all(h.render(p)).some(node => node.props?.id === status.props.id))
})

test('original photo and camera inputs send only the first file without caption or preview and keep the text draft on success and failure',async()=>{
 const remote=remoteState(),sent=[],h=harness(remote),p=props();let accepted=false
 remote.sendPhoto=async file=>{sent.push(file);return accepted}
 let tree=h.render(p),inputs=all(tree).filter(node=>node.type==='input'&&node.props.type==='file');assert.equal(inputs.length,2);assert(inputs.every(node=>!node.props.multiple));assert.equal(inputs[1].props.capture,'environment')
 const a={name:'first'},b={name:'second'},event={target:{files:[a,b],value:'selected'}}
 inputs[0].props.onChange(event);await settle();assert.equal(event.target.value,'');assert.equal(sent[0],a);assert.equal(h.draft,'保留的文字草稿');assert.equal(h.writes,0);assert.equal(h.templateCalls,0)
 accepted=true;tree=h.render(p);inputs=all(tree).filter(node=>node.type==='input'&&node.props.type==='file');inputs[1].props.onChange({target:{files:[b],value:'camera'}});await settle();assert.equal(sent[1],b);assert.equal(h.draft,'保留的文字草稿');assert.equal(h.writes,0);assert.equal(h.templateCalls,0);assert.equal(h.timers.length,0)
 inputs[0].props.onChange({target:{files:[],value:''}});await settle();assert.equal(sent.length,2)
})

test('the existing Photos action retries a pending intent without opening a new picker or requiring a new control',async()=>{
 const sent=[],remote={...remoteState(),pendingPhoto:true,sendPhoto:async file=>{sent.push(file);return true}},h=harness(remote),p=props();h.draft=''
 let tree=h.render(p);all(tree).find(n=>n.type==='button'&&n.props['aria-label']==='talk.more').props.onClick();tree=h.render(p)
 const action=all(tree).find(n=>n.type==='button'&&n.props.key==='photo');assert(action);action.props.onClick();await settle();assert.equal(sent.length,1);assert.equal(sent[0],undefined);assert.equal(h.writes,0)
})

test('only a photo missing its original file shows recovery controls and neither control can act during sending',async()=>{
 for(const lang of ['zh-CN','en']){
  let stopped=0;const remote={...remoteState(),pendingPhoto:true,photoNeedsSelection:true,stopPhotoRetry:async()=>{stopped++;return true}},h=harness(remote,lang),p=props()
  let tree=h.render(p),buttons=all(tree).filter(n=>n.type==='button'),retry=buttons.find(n=>(n.props.children??[]).join('')===(lang==='en'?'Choose original photo again':'重选原照片')),stop=buttons.find(n=>(n.props.children??[]).join('')===(lang==='en'?'Stop retrying this photo':'停止重试这张照片'))
  assert(retry&&stop);assert.equal(retry.props.disabled,false);assert.equal(stop.props.disabled,false)
  await stop.props.onClick();assert.equal(stopped,1);assert.equal(h.draft,'保留的文字草稿')
  remote.sending=true;tree=h.render(p);buttons=all(tree).filter(n=>n.type==='button');const disabled=buttons.filter(n=>[lang==='en'?'Choose original photo again':'重选原照片',lang==='en'?'Stop retrying this photo':'停止重试这张照片'].includes((n.props.children??[]).join('')));assert(disabled.every(n=>n.props.disabled));for(const control of disabled)await control.props.onClick();assert.equal(stopped,1)
  remote.sending=false;remote.photoNeedsSelection=false;assert(!all(h.render(p)).some(n=>n.props?.className==='chat-photo-recovery'))
 }
})

test('a native photo with unavailable original and ready media has a real local-stop control without a misleading reselect action',async()=>{
 let stopped=0;const remote={...remoteState(),pendingPhoto:true,photoNeedsSelection:false,photoCaptureMissing:true,stopPhotoRetry:async()=>{stopped++;return true}},h=harness(remote),tree=h.render(props())
 const controls=all(tree).filter(n=>n.type==='button'),stop=controls.find(n=>(n.props.children??[]).join('')==='停止重试这张照片')
 assert(stop);assert(!controls.some(n=>(n.props.children??[]).join('')==='重选原照片'));await stop.props.onClick();assert.equal(stopped,1);assert.equal(h.draft,'保留的文字草稿')
})

test('consuming a capture navigation does not cancel its asynchronous send, and a later explicit continuation retries the same operation',async()=>{
 let resolve,completed=0;const wait=new Promise(r=>resolve=r),calls=[],consumed=[],remote={...remoteState(),resumeCapture:async operation=>{calls.push(operation);await wait;completed++;return false}},h=harness(remote,'zh-CN',true),p=props(),operation='same-server-operation'
 p.serviceConversation={accountId:'account',sessionId:'session',personId:'synthetic',chatCapture:{}};p.captureOperationId=operation;p.captureRequestId='request-one';p.onCaptureConsumed=id=>consumed.push(id)
 h.render(p);h.render(p);assert.deepEqual(calls,[operation]);assert.deepEqual(consumed,['request-one'])
 p.captureOperationId=undefined;p.captureRequestId=undefined;h.render(p);resolve();await settle();assert.equal(completed,1)
 p.captureOperationId=operation;p.captureRequestId='request-two';h.render(p);await settle();assert.deepEqual(calls,[operation,operation]);assert.equal(completed,2)
 p.captureRequestId='request-three';h.render(p);h.render(p);await settle();assert.deepEqual(calls,[operation,operation,operation]);assert.deepEqual(consumed,['request-one','request-two','request-three']);assert.equal(completed,3);assert.equal(h.writes,0);assert.equal(h.draft,'保留的文字草稿')
})

test('a continuation waits for the actual bound conversation even when its first-render loading flag is false',async()=>{
 const calls=[],consumed=[],remote={...remoteState(),conversationId:undefined,resumeCapture:async op=>{calls.push(op);return true}},h=harness(remote,'zh-CN',true),p=props()
 p.serviceConversation={accountId:'account',sessionId:'session',personId:'synthetic',chatCapture:{}};p.captureOperationId='original-operation';p.captureRequestId='one-ui-request';p.onCaptureConsumed=id=>consumed.push(id)
 h.render(p);h.render(p);assert.equal(calls.length,0);assert.equal(consumed.length,0)
 remote.conversationId='confirmed-original-conversation';h.render(p);h.render(p);await settle();assert.deepEqual(calls,['original-operation']);assert.deepEqual(consumed,['one-ui-request'])
})

test('private photo bubble keeps original remove affordance and vision text cannot become a treasure',()=>{
 const h=harness(remoteState()),common={who:{name:'合成TA',world:'courtyard'},selected:true,onSelect(){},onSpeak(){},onCopy(){},onRemember(){},onDelete(){},readPhoto:async()=>{}}
 const photo=h.bubble({...common,m:{id:5,kind:'photo',time:'00:00',photo:{id:'media'}}});assert(all(photo).some(n=>n.type==='PrivatePhoto'));assert(!all(photo).some(n=>n.type==='img'));assert(all(photo).some(n=>n.type==='Act'&&n.props.label==='talk.delete'))
 const reply={id:6,kind:'him',text:'真实图片回复',time:'00:00',generationKind:'photo_reply',canSuggestMemory:false}
 assert(!all(h.bubble({...common,m:reply})).some(n=>n.type==='Act'&&n.props.label==='talk.remember'))
 assert(all(h.bubble({...common,m:{...reply,generationKind:undefined,canSuggestMemory:false}})).some(n=>n.type==='Act'&&n.props.label==='talk.remember'))
 for(const sourceDomain of ['virtual_action','virtual_context']){
  const virtual=all(h.bubble({...common,m:{...reply,generationKind:undefined,sourceDomain}}))
  assert(!virtual.some(n=>n.type==='Act'&&n.props.label==='talk.remember'));assert(virtual.some(n=>n.type==='Act'&&n.props.label==='talk.delete'))
 }
})

test('direct unknown sends restore and lock the original input and retry through the unchanged send control',async()=>{
 const sent=[],remote={...remoteState(),pendingText:'锁定的完整行动请求',send:async text=>{sent.push(text);return false}},h=harness(remote),p=props();h.draft=''
 let tree=h.render(p),field=all(tree).find(n=>n.type==='textarea'),send=all(tree).find(n=>n.type==='button'&&n.props['aria-label']==='talk.send')
 assert.equal(field.props.value,remote.pendingText);assert.equal(field.props.readOnly,true);assert.equal(send.props.disabled,false)
 send.props.onClick();await settle();assert.deepEqual(sent,[remote.pendingText]);assert.equal(h.writes,0);assert.equal(h.templateCalls,0)
 remote.sending=true;tree=h.render(p);assert.equal(all(tree).find(n=>n.props?.['aria-label']==='talk.send').props.disabled,true)
 remote.pendingText=undefined;remote.sending=false;h.draft='被明确拒绝后保留的草稿';tree=h.render(p);field=all(tree).find(n=>n.type==='textarea');assert.equal(field.props.readOnly,false);assert.equal(field.props.value,h.draft)
})
test('original hold control confirms browser recognition, waits for final results and sends real text without clearing the typed draft',async()=>{
 let engine;class Recognition{constructor(){engine=this}start(){}stop(){}abort(){}result(text,isFinal){const item=[{transcript:text}];item.isFinal=isFinal;this.onresult({results:[item]})}}
 const sent=[],remote={...remoteState(),Recognition,send:async(text,mode)=>{sent.push({text,mode});return true}},h=harness(remote),p=props();let tree=h.render(p);all(tree).find(n=>n.props?.['aria-label']==='talk.voiceMode').props.onClick();tree=h.render(p);assert(all(tree).some(n=>n.type==='Sheet'));all(tree).find(n=>n.type==='Sheet').props.footer.props.onClick();tree=h.render(p);const hold=all(tree).find(n=>n.props?.onPointerDown);hold.props.onPointerDown({currentTarget:{setPointerCapture(){}},pointerId:1,clientY:200});engine.onstart();engine.result('临时识别',false);assert.equal(sent.length,0);hold.props.onPointerUp();assert.equal(sent.length,0);engine.result('松手后最终识别',true);engine.onend();await settle();assert.deepEqual(sent,[{text:'松手后最终识别',mode:'transcribed'}]);assert.equal(h.draft,'保留的文字草稿');assert.equal(h.templateCalls,0);assert.equal(h.writes,0)
})
test('sliding up cancels before the next React render, so late browser speech never creates a message',async()=>{
 let engine;class Recognition{constructor(){engine=this}start(){}stop(){}abort(){}result(){const item=[{transcript:'迟到文字'}];item.isFinal=true;this.onresult({results:[item]})}}
 const sent=[],remote={...remoteState(),Recognition,send:async text=>{sent.push(text);return true}},h=harness(remote),p=props();let tree=h.render(p);all(tree).find(n=>n.props?.['aria-label']==='talk.voiceMode').props.onClick();tree=h.render(p);all(tree).find(n=>n.type==='Sheet').props.footer.props.onClick();tree=h.render(p);const hold=all(tree).find(n=>n.props?.onPointerDown);hold.props.onPointerDown({currentTarget:{setPointerCapture(){}},pointerId:1,clientY:200});hold.props.onPointerMove({clientY:0});hold.props.onPointerUp();engine.result();engine.onend();await settle();assert.equal(sent.length,0);assert.equal(h.draft,'保留的文字草稿')
})
test('speech service network failure keeps the draft and offers typing without claiming a microphone permission failure',async()=>{
 for(const lang of ['zh-CN','en']){
  let engine;class Recognition{constructor(){engine=this}start(){}stop(){}abort(){}}
  const sent=[],remote={...remoteState(),Recognition,send:async text=>{sent.push(text);return true}},h=harness(remote,lang),p=props();let tree=h.render(p)
  all(tree).find(n=>n.props?.['aria-label']==='talk.voiceMode').props.onClick();tree=h.render(p);all(tree).find(n=>n.type==='Sheet').props.footer.props.onClick();tree=h.render(p)
  const hold=all(tree).find(n=>n.props?.onPointerDown);hold.props.onPointerDown({currentTarget:{setPointerCapture(){}},pointerId:1,clientY:200});engine.onstart();engine.onerror({error:'network'});engine.onend();hold.props.onPointerUp();await settle();tree=h.render(p)
  const feedback=all(tree).find(n=>n.type==='Toast').props.text
  assert.match(feedback,lang==='en'?/speech recognition service.*not be reached/i:/语音识别服务.*连不上/);assert.match(feedback,lang==='en'?/nothing was sent/i:/没有发送/);assert.match(feedback,lang==='en'?/type your message/i:/直接打字/);assert.doesNotMatch(feedback,/麦克风|microphone/i)
  assert.equal(sent.length,0);assert.equal(h.draft,'保留的文字草稿');assert.equal(h.writes,0);assert.equal(h.templateCalls,0);assert.equal(all(tree).find(n=>n.props?.onPointerDown).props['aria-busy'],false)
 }
})
test('retrying a pending transcript through the keyboard control preserves the separate handwritten draft',async()=>{const calls=[],remote={...remoteState(),pendingText:'待核转写',pendingInputMode:'transcribed',send:async(text,mode)=>{calls.push({text,mode});return true}},h=harness(remote),p=props(),tree=h.render(p);assert.equal(all(tree).find(n=>n.type==='textarea').props.value,'待核转写');all(tree).find(n=>n.props?.['aria-label']==='talk.send').props.onClick();await settle();assert.deepEqual(calls,[{text:'待核转写',mode:'transcribed'}]);assert.equal(h.draft,'保留的文字草稿')})


test('profile call routes open distinct reminder settings with the verified session and an explicit photo preview',()=>{
 for(const mode of ['voice','video']){
  const remote=remoteState(),h=harness(remote),p=props()
  p.startCall=mode;p.serviceConversation={accountId:'account-id',sessionId:'session-id',personId:'synthetic',onUnauthorized(){}}
  const tree=all(h.render(p)),reminder=tree.find(n=>n.type==='CallInterestSheet')
  assert.ok(reminder);assert.equal(reminder.props.kind,mode);assert.equal(reminder.props.context.sessionId,'session-id')
  assert.equal(tree.some(n=>n.type==='CallOverlay'),false)
  if(mode==='video'){
   reminder.props.onPhotoPreview()
   const preview=all(h.render(p)).find(n=>n.type==='CallOverlay')
   assert.equal(preview.props.mode,'video');assert.equal(preview.props.serviceAccount,true);assert.equal(preview.props.voiceService,undefined)
   preview.props.onClose()
   assert.ok(all(h.render(p)).some(n=>n.type==='CallInterestSheet'))
  }else assert.equal(reminder.props.onPhotoPreview,undefined)
  assert.equal(h.writes,0)
 }
 const h=harness(remoteState()),p=props();p.startCall='voice';p.serviceConversation.storyBranchId='unselected-branch-extension'
 assert.equal(all(h.render(p)).some(n=>['CallOverlay','CallInterestSheet'].includes(n.type)),false)
})
