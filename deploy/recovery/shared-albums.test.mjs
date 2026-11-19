import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {verifySharedAlbumFacts,validateSharedAlbumReferences} from './shared-albums.mjs'
const at='2026-11-15T00:00:00.000Z',later='2026-11-15T00:01:00.000Z',last='2026-11-15T00:02:00.000Z'
const privateText='PRIVATE_ALBUM_BODY_NOT_IN_REPORT',visitor='a'.repeat(64),digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
const tables=['shared_albums','shared_album_contributions','shared_album_commands','shared_album_decisions','shared_album_adoptions','shared_album_rewards','shared_album_source_cleanup']
function decision(f,kind,id,actor=null,visit=null,reviewer=null,reason=null){f.decisions.push({id:'decision-'+f.decisions.length,album_id:'album',contribution_id:id,actor_account_id:actor,visitor_hash:visit,decision:kind,rules_version:1,reviewer,reason,created_at:at})}
function command(f,operation,resource,actor,request){f.commands.push({actor,idempotency_key:'key-'+f.commands.length,operation,request_hash:digest([operation,request]),album_id:'album',resource_id:resource,created_at:at})}
function fixture(){
 const f={accounts:[{id:'owner',status:'active'},{id:'guest',status:'active'}],persons:[{id:'person',account_id:'owner',status:'active'}],peopleFences:[],socialGates:[],memoryGates:[],giftGates:[],
  albums:[{id:'album',account_id:'owner',person_id:'person',title:'Album',message:'An invitation.',token_hash:'b'.repeat(64),token_cipher:'x'.repeat(95),status:'active',version:2,created_at:at,updated_at:at,closed_at:null}],
  contributions:[{id:'contribution',album_id:'album',visitor_hash:visitor,author_account_id:null,body:privateText,status:'approved',seat:1,version:2,rejection_reason:null,allow_adoption:true,created_at:at,updated_at:at}],commands:[],decisions:[],adoptions:[],rewards:[],cleanup:[],receipts:[],memories:[],memoryEvents:[],giftReceipts:[],giftTransactions:[],giftLots:[],giftEntries:[]}
 decision(f,'create',null,'owner');command(f,'create','album','owner:owner',{personId:'person',title:'Album',message:'An invitation.'})
 decision(f,'submit_allow_adoption','contribution',null,visitor);command(f,'submit','contribution','visitor:'+visitor,{albumId:'album',text:privateText,allowAdoption:true})
 decision(f,'approve','contribution',null,null,'human-reviewer')
 return f
}
function goal(kind,f=rewarded()){Object.assign(f.albums[0],{kind,rules_version:2,capacity:kind==='flight'?8:5});for(const d of f.decisions)d.rules_version=2;f.commands.find(c=>c.operation==='create').request_hash=digest(['create',{personId:'person',title:'Album',message:'An invitation.',kind}]);const d=f.decisions.find(d=>d.decision==='approve');Object.assign(d,{decision:'owner_approve',actor_account_id:'owner',reviewer:null});command(f,'owner_review','contribution','owner:owner',{albumId:'album',id:'contribution',version:1,decision:'approve'});return f}
test('home and flight rules, manual owner decisions and the same earned voucher/memory closure survive recovery without inventing progress',()=>{for(const kind of ['home','flight']){const f=goal(kind);assert.equal(verifySharedAlbumFacts(f).giftReceiptCount,1);for(const change of [f=>f.albums[0].capacity=6,f=>delete f.albums[0].kind,f=>f.albums[0].rules_version=1,f=>f.decisions.find(d=>d.decision==='owner_approve').actor_account_id='guest',f=>f.commands=f.commands.filter(c=>c.operation!=='owner_review'),f=>f.commands.find(c=>c.operation==='owner_review').request_hash=digest(['owner_review',{albumId:'album',id:'contribution',version:3,decision:'approve'}])]){const bad=structuredClone(f);change(bad);assert.throws(()=>verifySharedAlbumFacts(bad),/differs/)}}})
test('a preserved owner-review receipt cannot revive private author facts after withdrawal and erasure',()=>{const f=withdrawn(goal('flight'));f.accounts[1].status='deletion_pending';f.socialGates=[{account_id:'guest',erased_at:last}];Object.assign(f.contributions[0],{author_account_id:null,visitor_hash:'c'.repeat(64),version:4});f.decisions=f.decisions.filter(d=>d.contribution_id==null);f.commands=f.commands.filter(c=>c.operation==='create'||c.operation==='owner_review'||c.operation==='adopt');f.rewards=[];f.cleanup[0].erasing_account_ids=['guest'];assert.equal(verifySharedAlbumFacts(f).verified,true)})
test('withdrawn history rejects opposing operator and owner decisions while allowing the same genuine decision to be acknowledged by both',()=>{for(const operatorFirst of [true,false]){const f=withdrawn(fixture());if(!operatorFirst){const op=f.decisions.find(d=>d.decision==='approve');Object.assign(op,{decision:'owner_approve',actor_account_id:'owner',reviewer:null});command(f,'owner_review','contribution','owner:owner',{albumId:'album',id:'contribution',version:1,decision:'approve'});decision(f,'reject','contribution',null,null,'operator','not_suitable')}else{decision(f,'owner_reject','contribution','owner',null,null,'not_suitable');command(f,'owner_review','contribution','owner:owner',{albumId:'album',id:'contribution',version:2,decision:'reject'})}assert.throws(()=>verifySharedAlbumFacts(f),/differs/)}const valid=withdrawn(fixture());decision(valid,'owner_approve','contribution','owner');command(valid,'owner_review','contribution','owner:owner',{albumId:'album',id:'contribution',version:2,decision:'approve'});assert.equal(verifySharedAlbumFacts(valid).verified,true)})
function adopted(f=fixture(),ack=true){
 f.adoptions.push({contribution_id:'contribution',album_id:'album',account_id:'owner',person_id:'person',source_version:2,status:ack?'fulfilled':'pending',memory_id:ack?'memory':null,recovery_blocked:false,created_at:at,updated_at:at})
 decision(f,'adopt','contribution','owner');command(f,'adopt','contribution','owner:owner',{albumId:'album',id:'contribution'})
 f.receipts.push({account_id:'owner',album_id:'album',contribution_id:'contribution',source_version:2,person_id:'person',memory_id:'memory',state:'fulfilled',created_at:at,updated_at:at})
 f.memories.push({id:'memory',account_id:'owner',person_id:'person',client_memory_id:'contribution',request_hash:digest(['album','contribution',2,'Album',privateText]),confirmed_seq:'9007199254740993',confirmed_at:at,origin:'shared_contribution',title:'Album',body:privateText,source_album_id:'album',source_contribution_id:'contribution',source_contribution_version:2,source_message_id:null,candidate_id:null,version:1,removed_at:null})
 f.memoryEvents.push({account_id:'owner',aggregate_id:'memory',aggregate_type:'memory',aggregate_version:1,type:'MemoryConfirmed.v1',payload:{memoryId:'memory',personId:'person',version:1,confirmedAt:at,confirmedSeq:'9007199254740993',origin:'shared_contribution',qualifiesForReferral:false,echoAiAuthorizationVersion:0}})
 return f
}
function rewarded(f=adopted(),ack=true){
 f.contributions[0].author_account_id='guest';decision(f,'claim_reward','contribution','guest',visitor);command(f,'claim_reward','contribution','owner:guest',{albumId:'album',contributionId:'contribution'})
 f.rewards.push({account_id:'guest',album_id:'album',contribution_id:'contribution',status:ack?'fulfilled':'pending',receipt_id:ack?'gift-receipt':null,granted_at:ack?later:null,dispatch_started_at:at,recovery_blocked:false,created_at:at})
 f.giftReceipts.push({id:'gift-receipt',account_id:'guest',album_id:'album',transaction_id:'transaction',lot_id:'lot',campaign:'shared-album-v1',account_access_version:1,created_at:later})
 f.giftTransactions.push({id:'transaction',account_id:'guest',reason:'album_reward',source_id:'album:album:participant:guest',policy_version:'shared-album-v1',request_hash:digest({accountId:'guest',albumId:'album',campaign:'shared-album-v1'})})
 f.giftLots.push({id:'lot',account_id:'guest',source:'promotion',asset_type:'voucher',asset_id:'return-stamp',balance_units:1,expires_at:null,policy_version:'shared-album-v1',issuance_transaction_id:'transaction'})
 f.giftEntries.push({account_id:'guest',transaction_id:'transaction',line_no:1,lot_id:'lot',direction:'credit',units:'1'})
 return f
}
function closed(f){Object.assign(f.albums[0],{status:'closed',closed_at:at,version:f.albums[0].version+1});decision(f,'close',null,'owner');command(f,'close','album','owner:owner',{id:'album'});return f}
function withdrawn(f){Object.assign(f.contributions[0],{status:'withdrawn',body:'',seat:null,version:3,updated_at:last});for(const r of f.adoptions)r.status='revoked';decision(f,'withdraw','contribution',null,visitor);command(f,'withdraw','contribution','visitor:'+visitor,{id:'contribution'});f.cleanup=[{contribution_id:'contribution',album_id:'album',account_id:'owner',erasing_account_ids:[],recovery_blocked:false,created_at:last}];return f}
function cleaned(f){f.cleanup=[];f.memories=[];f.memoryEvents=[];for(const r of f.receipts)r.state='revoked';return f}

test('complete approved manual participation has real memory and one real promotional voucher without leaking text or token',()=>{
 const f=rewarded(),proof=verifySharedAlbumFacts(f)
 assert.equal(proof.verified,true);assert.equal(proof.sharedMemoryCount,1);assert.equal(proof.giftReceiptCount,1)
 for(const secret of [privateText,visitor,f.albums[0].token_cipher,f.albums[0].token_hash])assert.equal(JSON.stringify(proof).includes(secret),false)
 // The owner may subsequently edit or soft-remove a cherished copy; the
 // immutable request still points to the original manually approved source.
 f.memories[0].version=2;f.memories[0].body='Edited private copy';f.memories[0].removed_at=last
 assert.equal(verifySharedAlbumFacts(f).verified,true)
})
test('unknown adoption and reward responses, closed links, restricted accounts and removed people remain valid historical facts',()=>{
 const f=closed(rewarded(adopted(fixture(),false),false));f.accounts.forEach(r=>r.status='restricted');f.persons[0].status='removed'
 for(const r of [...f.adoptions,...f.rewards])r.recovery_blocked=true
 assert.equal(verifySharedAlbumFacts(f).verified,true)
 assert.ok(Date.parse(f.giftReceipts[0].created_at)>Date.parse(f.albums[0].closed_at),'an already dispatched grant may finish after close')
 const waiting=adopted();waiting.adoptions[0].status='pending';waiting.adoptions[0].memory_id=null;waiting.receipts=[];waiting.memories=[];waiting.memoryEvents=[]
 assert.equal(verifySharedAlbumFacts(waiting).verified,true)
})
test('source withdrawal retains a guarded cleanup until the real memory tombstone, including never-adopted sources',()=>{
 const f=withdrawn(rewarded());assert.equal(verifySharedAlbumFacts(f).verified,true)
 const missing=structuredClone(f);missing.cleanup=[];assert.throws(()=>verifySharedAlbumFacts(missing),/differs/)
 assert.equal(verifySharedAlbumFacts(cleaned(f)).verified,true)
 const never=cleaned(withdrawn(fixture()));never.receipts=[{account_id:'owner',album_id:'album',contribution_id:'contribution',source_version:null,person_id:null,memory_id:null,state:'revoked',created_at:last,updated_at:last}]
 assert.equal(verifySharedAlbumFacts(never).verified,true)
})
test('moderation preserves the original reviewer command and guarded source cleanup without making a withdrawn contribution public',()=>{
 const f=withdrawn(adopted());f.decisions=f.decisions.filter(d=>d.decision!=='withdraw');f.commands=f.commands.filter(c=>c.operation!=='withdraw');decision(f,'moderate','contribution',null,null,'report-uuid','content_restricted');command(f,'moderate','contribution','moderator:report-uuid',{albumId:'album',id:'contribution',version:2})
 assert.equal(verifySharedAlbumFacts(f).verified,true)
 for(const damage of [r=>r.decisions.at(-1).reviewer='other',r=>r.commands.at(-1).actor='owner:owner',r=>r.commands.at(-1).request_hash=digest(['moderate',{albumId:'album',id:'contribution',version:1}]),r=>r.decisions.at(-1).reason='wrong',r=>r.contributions[0].status='approved']){const bad=structuredClone(f);damage(bad);assert.throws(()=>verifySharedAlbumFacts(bad),/differs/)}
})
test('signed submissions bind one author before reward while legacy anonymous-then-claim fingerprints stay unchanged',()=>{
 const f=fixture();f.contributions[0].author_account_id='guest';f.decisions.find(d=>d.decision==='submit_allow_adoption').actor_account_id='guest';f.commands.find(c=>c.operation==='submit').request_hash=digest(['submit',{albumId:'album',text:privateText,allowAdoption:true,accountId:'guest'}]);assert.equal(verifySharedAlbumFacts(f).verified,true)
 for(const change of [r=>r.decisions.find(d=>d.decision==='submit_allow_adoption').actor_account_id='owner',r=>r.commands.find(c=>c.operation==='submit').request_hash=digest(['submit',{albumId:'album',text:privateText,allowAdoption:true,accountId:'owner'}]),r=>r.decisions.find(d=>d.decision==='submit_allow_adoption').actor_account_id=null]){const bad=structuredClone(f);change(bad);assert.throws(()=>verifySharedAlbumFacts(bad),/differs/)}
 const out=withdrawn(f);const decision=out.decisions.find(d=>d.decision==='withdraw');decision.actor_account_id='guest';assert.equal(verifySharedAlbumFacts(out).verified,true)
})
test('author erasure removes private authorship while both erasers wait on the same source cleanup',()=>{
 const f=withdrawn(rewarded());f.accounts[1].status='deletion_pending';f.socialGates=[{account_id:'guest',erased_at:last}]
 Object.assign(f.contributions[0],{author_account_id:null,visitor_hash:'c'.repeat(64),version:4})
 f.decisions=f.decisions.filter(r=>r.contribution_id==null);f.commands=f.commands.filter(r=>r.resource_id==='album');f.rewards=[];f.cleanup[0].erasing_account_ids=['guest']
 assert.equal(verifySharedAlbumFacts(f).verified,true)
 const invalid=structuredClone(f);invalid.cleanup[0].erasing_account_ids=['owner'];assert.throws(()=>verifySharedAlbumFacts(invalid),/differs/)
 f.accounts[0].status='deletion_pending';f.socialGates.push({account_id:'owner',erased_at:last});f.cleanup[0].erasing_account_ids.push('owner');f.albums=[];f.contributions=[];f.commands=[];f.decisions=[];f.adoptions=[]
 assert.equal(verifySharedAlbumFacts(f).verified,true)
 assert.equal(verifySharedAlbumFacts(cleaned(f)).verified,true)
})
test('initiator erasure may leave a survivor earned voucher and pending source cleanup without a public album',()=>{
 const f=rewarded();f.accounts[0].status='deletion_pending';f.socialGates=[{account_id:'owner',erased_at:last}];f.peopleFences=[{account_id:'owner',erased_at:last}];f.persons=[]
 f.cleanup=[{contribution_id:'contribution',album_id:'album',account_id:'owner',erasing_account_ids:['owner'],recovery_blocked:true,created_at:last}]
 for(const k of ['albums','contributions','commands','decisions','adoptions','rewards'])f[k]=[]
 assert.equal(verifySharedAlbumFacts(f).verified,true)
 assert.equal(verifySharedAlbumFacts(cleaned(f)).giftReceiptCount,1)
 f.receipts=[];f.memoryGates=[{account_id:'owner',erased_at:last}]
 assert.equal(verifySharedAlbumFacts(f).verified,true)
 f.giftGates=[{account_id:'guest',erased_at:last}];assert.throws(()=>verifySharedAlbumFacts(f),/differs/)
})
test('native shape, exact sources, manual decisions and stable accepted fingerprints reject substitutions',()=>{
 for(const change of [
  f=>f.albums[0].title='x'.repeat(41),f=>f.albums[0].token_cipher='plaintext',f=>f.albums[0].account_id='guest',f=>f.persons[0].account_id='guest',f=>f.contributions[0].allow_adoption=false,
  f=>f.contributions[0].version=3,f=>f.contributions[0].seat=6,f=>f.contributions.push({...f.contributions[0],id:'other'}),f=>f.decisions=f.decisions.filter(d=>d.decision!=='approve'),f=>f.decisions.find(d=>d.decision==='approve').reviewer=null,
  f=>f.commands[0].request_hash='0'.repeat(64),f=>f.commands=f.commands.filter(c=>c.operation!=='adopt'),f=>f.adoptions[0].source_version=1,f=>f.adoptions[0].person_id='other',f=>f.adoptions[0].recovery_blocked=null,
  f=>f.receipts[0].source_version=null,f=>f.receipts[0].account_id='guest',f=>f.memories[0].source_contribution_id='other',f=>f.memories[0].body='forged',f=>f.memories[0].request_hash='0'.repeat(64),
  f=>f.memories[0].source_message_id='chat-source',f=>f.memoryEvents[0].payload.qualifiesForReferral=true,f=>f.memoryEvents[0].payload.echoAiAuthorizationVersion=1,f=>f.memoryEvents[0].payload.confirmedSeq='9007199254740992',
  f=>{f.adoptions=[];f.decisions=f.decisions.filter(d=>d.decision!=='adopt');f.commands=f.commands.filter(c=>c.operation!=='adopt')},
 ]){const f=rewarded();change(f);assert.throws(()=>verifySharedAlbumFacts(f),/differs/)}
})
test('reward receipt, dispatch evidence and fixed ledger units cannot be guessed from contribution status',()=>{
 for(const change of [f=>f.giftReceipts=[],f=>f.rewards[0].receipt_id='other',f=>f.rewards[0].granted_at=at,f=>f.rewards[0].dispatch_started_at=null,f=>f.giftReceipts[0].account_id='owner',f=>f.giftTransactions[0].request_hash='0'.repeat(64),f=>f.giftLots[0].asset_id='postage',f=>f.giftEntries[0].units='2',f=>f.giftEntries.push({...f.giftEntries[0],line_no:2})]){const f=rewarded();change(f);assert.throws(()=>verifySharedAlbumFacts(f),/differs/)}
 const pending=rewarded(adopted(),false);pending.rewards[0].dispatch_started_at=null;assert.throws(()=>verifySharedAlbumFacts(pending),/differs/)
 const canceled=withdrawn(rewarded());Object.assign(canceled.rewards[0],{status:'canceled',receipt_id:null,granted_at:null,dispatch_started_at:null});assert.throws(()=>verifySharedAlbumFacts(canceled),/differs/)
 for(const k of ['giftReceipts','giftLots','giftTransactions','giftEntries'])canceled[k]=[]
 assert.equal(verifySharedAlbumFacts(canceled).verified,true)
 const late=closed(rewarded());late.rewards[0].dispatch_started_at=last;assert.throws(()=>verifySharedAlbumFacts(late),/differs/)
 const unclaimed=rewarded();unclaimed.rewards=[];unclaimed.contributions[0].author_account_id=null;unclaimed.decisions=unclaimed.decisions.filter(r=>r.decision!=='claim_reward');unclaimed.commands=unclaimed.commands.filter(r=>r.operation!=='claim_reward');assert.throws(()=>verifySharedAlbumFacts(unclaimed),/differs/)
})
test('cleanup checks the owner, precise source and every concurrent erasure waiter',()=>{
 for(const change of [f=>f.cleanup[0].account_id='guest',f=>f.cleanup[0].album_id='other',f=>f.cleanup[0].recovery_blocked=null,f=>f.cleanup[0].erasing_account_ids=['guest'],f=>f.cleanup[0].contribution_id='other',f=>f.receipts[0].state='revoked']){const f=withdrawn(adopted());change(f);assert.throws(()=>verifySharedAlbumFacts(f),/differs/)}
})
const targets=['identity','people','social','memories','gifts'].map(domain=>({domain}))
function runtime(f,options={}){return{async query(target,sql){
 assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE)\b/)
 if(sql.includes('information_schema.tables')){if(target.domain==='social')return tables.filter(t=>!(options.missing??[]).includes(t)).map(table_name=>({table_name}));return[{table_name:target.domain==='memories'?'shared_memory_receipts':'album_reward_receipts'}]}
 if(sql.includes('information_schema.columns')){if(sql.includes("table_name='shared_albums'"))return f.albums.some(a=>a.kind!==undefined)||options.partialGoal?['kind','rules_version','capacity'].filter(c=>c!==options.partialGoal).map(column_name=>({column_name,data_type:column_name==='kind'?'text':'integer',is_nullable:'NO'})):[];return target.domain==='social'?tables.slice(4).filter(t=>t!==options.missingFlag).map(table_name=>({table_name,column_name:'recovery_blocked',data_type:'boolean',is_nullable:options.nullableFlag?'YES':'NO'})):['source_album_id','source_contribution_id','source_contribution_version'].filter(c=>c!==options.missingColumn).map(column_name=>({column_name}))}
 const name=sql.match(/FROM public\.(\w+)/)?.[1],names={accounts:'accounts',persons:'persons',account_erasure_fences:'peopleFences',social_account_write_gates:'socialGates',memory_account_write_gates:'memoryGates',gifts_account_write_gates:'giftGates',shared_albums:'albums',shared_album_contributions:'contributions',shared_album_commands:'commands',shared_album_decisions:'decisions',shared_album_adoptions:'adoptions',shared_album_rewards:'rewards',shared_album_source_cleanup:'cleanup',shared_memory_receipts:'receipts',memories:'memories',outbox_events:'memoryEvents',album_reward_receipts:'giftReceipts',ledger_transactions:'giftTransactions',asset_lots:'giftLots',ledger_entries:'giftEntries'}
 assert.ok(names[name],'known source query');if(name==='memories')assert.match(sql,/confirmed_seq::text/);return structuredClone(f[names[name]])
}}}
test('read-only adapter requires complete new schema and exact execution flags, preserving all-legacy absence',async()=>{
 const f=rewarded();assert.equal((await validateSharedAlbumReferences(runtime(f),targets)).verified,true)
 for(const options of [{missing:['shared_album_rewards']},{missingFlag:'shared_album_source_cleanup'},{nullableFlag:true},{missingColumn:'source_contribution_version'}])await assert.rejects(()=>validateSharedAlbumReferences(runtime(f,options),targets),/schema is incomplete/)
 assert.equal((await validateSharedAlbumReferences(runtime(f,{missing:tables}),targets)).applicable,false)
 await assert.rejects(()=>validateSharedAlbumReferences(runtime(f),targets.filter(t=>t.domain!=='gifts')),/authority/)
 assert.equal((await validateSharedAlbumReferences(runtime(goal('flight')),targets)).verified,true);await assert.rejects(validateSharedAlbumReferences(runtime(f,{partialGoal:'capacity'}),targets),/goal schema is incomplete/)
})
