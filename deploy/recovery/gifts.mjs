// Read-only consistency checks across separately owned databases. Pending
// projections may be absent; a projection that exists must reference real facts.
import {validateGiftCommerceReferences} from './gifts-commerce.mjs'
export async function validateGiftReferences(runtime,targets){
 const gifts=targets.find(t=>t.domain==='gifts'),conversations=targets.find(t=>t.domain==='conversations'),people=targets.find(t=>t.domain==='people')
 if(!gifts)return{applicable:false,reason:'legacy_without_gifts'}
 if(!conversations||!people)throw new Error('Gift references require Conversations and People')
 const [lots,transactions,entries,deliveries,cards,persons,chats]=await Promise.all([
  runtime.query(gifts,'SELECT * FROM public.asset_lots'),runtime.query(gifts,'SELECT * FROM public.ledger_transactions'),runtime.query(gifts,'SELECT * FROM public.ledger_entries'),runtime.query(gifts,'SELECT * FROM public.gift_deliveries'),
  runtime.query(conversations,"SELECT m.*,c.person_id FROM public.messages m JOIN public.conversations c ON(c.account_id,c.id)=(m.account_id,m.conversation_id) WHERE m.kind='gift'"),
  runtime.query(people,'SELECT id,account_id FROM public.persons'),runtime.query(conversations,'SELECT id,account_id,person_id FROM public.conversations')])
 const byLot=new Map(lots.map(v=>[v.id,v])),byTx=new Map(transactions.map(v=>[v.id,v])),byDelivery=new Map(deliveries.map(v=>[v.id,v])),sums=new Map(),byEntries=new Map()
 const fail=()=>{throw new Error('Gift ledger, receipt or conversation projection differs')}
 const byPerson=new Map(persons.map(v=>[v.id,v])),byChat=new Map(chats.map(v=>[v.id,v]))
 const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}'
 const sameTime=(a,b)=>a==null&&b==null||Number.isFinite(Date.parse(a))&&Date.parse(a)===Date.parse(b)
 const positive=v=>Number.isSafeInteger(v)&&v>0
 const returnTables=['gift_return_jobs','received_gifts','gift_received_projection_jobs','gift_notifications','gift_mutation_receipts']
 const schema=await runtime.query(gifts,"SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('gift_return_jobs','received_gifts','gift_received_projection_jobs','gift_notifications','gift_mutation_receipts')")
 const hasReturns=schema.length===returnTables.length&&returnTables.every(name=>schema.some(row=>row.table_name===name))
 if(schema.length&&!hasReturns)fail()
 const [returnJobs,received,projections,notifications,receipts,events]=hasReturns?await Promise.all([
  ...returnTables.map(table=>runtime.query(gifts,'SELECT * FROM public.'+table)),runtime.query(gifts,'SELECT * FROM public.outbox_events')]):[[],[],[],[],[],[]]
 const byReturn=new Map(returnJobs.map(v=>[v.id,v])),byReceived=new Map(received.map(v=>[v.id,v])),bySource=new Map(),byEvent=new Map(events.map(v=>[v.id,v]))
 for(const e of entries){const l=byLot.get(e.lot_id),t=byTx.get(e.transaction_id);if(!l||!t||l.account_id!==e.account_id||t.account_id!==e.account_id||!Number.isSafeInteger(e.units)||e.units<=0||!['credit','debit'].includes(e.direction))fail();sums.set(l.id,(sums.get(l.id)??0)+(e.direction==='credit'?e.units:-e.units));byEntries.set(t.id,[...(byEntries.get(t.id)??[]),e])}
 for(const l of lots)if(l.balance_units!==(sums.get(l.id)??0)||l.balance_units<0||!({trial:['trial_grant'],promotion:['referral_reward','album_reward'],paid:['purchase_credit']}[l.source]??[]).includes(byTx.get(l.issuance_transaction_id)?.reason)||byTx.get(l.issuance_transaction_id)?.account_id!==l.account_id)fail()
 for(const t of transactions)if(['trial_grant','referral_reward','album_reward','purchase_credit'].includes(t.reason)){
  const es=byEntries.get(t.id);if(!es?.length||es.some(e=>e.direction!=='credit'||byLot.get(e.lot_id)?.issuance_transaction_id!==t.id))fail()
 }
 for(const l of lots)if((byEntries.get(l.issuance_transaction_id)??[]).filter(e=>e.lot_id===l.id).length!==1)fail()
 const canonical=es=>JSON.stringify(es.map(e=>[e.lot_id,e.units]).sort((a,b)=>a[0].localeCompare(b[0])))
 for(const d of deliveries){
  if(d.person_snapshot.id!==d.person_id||!['in_transit','arrived','delivery_failed'].includes(d.status))fail()
  if(byPerson.get(d.person_id)?.account_id!==d.account_id||byChat.get(d.conversation_id)?.account_id!==d.account_id||byChat.get(d.conversation_id)?.person_id!==d.person_id)fail()
  if(hasReturns&&![d.return_authorization_version,d.story_authorization_version,d.return_policy_version].every(v=>v==null)
    &&(!positive(d.return_authorization_version)||!positive(d.story_authorization_version)||d.return_policy_version!=='person-gift-returns-v1'))fail()
  const debit=d.debit_transaction_id&&byTx.get(d.debit_transaction_id),reversal=d.reversal_transaction_id&&byTx.get(d.reversal_transaction_id)
  const expected=d.source==='trial'?d.gift_snapshot.cost*d.quantity:d.source==='voucher'?1:d.quantity
  if(d.cost!==(d.source==='trial'?expected:0))fail()
  if(expected===0){if(debit||d.cost!==0)fail()}else{
   const es=debit&&byEntries.get(debit.id);if(!debit||debit.account_id!==d.account_id||debit.reason!=='gift_debit'||debit.source_id!==d.id||!es?.length||es.some(e=>e.direction!=='debit')||es.reduce((n,e)=>n+e.units,0)!==expected)fail()
   for(const e of es){const l=byLot.get(e.lot_id);if(!(d.source==='voucher'?['trial','promotion','paid']:['trial','paid']).includes(l.source)||l.asset_type!==(d.source==='trial'?'postage':d.source==='voucher'?'voucher':'inventory')||l.asset_id!==(d.source==='trial'?'postage':d.source==='voucher'?'return-stamp':d.gift_snapshot.id))fail()}
  }
  if(d.status==='delivery_failed'&&debit){const es=reversal&&byEntries.get(reversal.id);if(!reversal||reversal.account_id!==d.account_id||reversal.reason!=='gift_reversal'||reversal.source_id!=='gift_reversal:'+d.id||reversal.original_transaction_id!==debit.id||!es?.length||es.some(e=>e.direction!=='credit')||canonical(es)!==canonical(byEntries.get(debit.id)))fail()}
  else if(reversal)fail()
 }
 for(const t of transactions){if(t.reason==='gift_debit'&&byDelivery.get(t.source_id)?.debit_transaction_id!==t.id)fail();if(t.reason==='gift_reversal'&&byDelivery.get(t.source_id.replace(/^gift_reversal:/,''))?.reversal_transaction_id!==t.id)fail()}
 const captured=['account_access_version','gift_authorization_version','story_authorization_version','return_authorization_version']
 for(const j of returnJobs){
  const d=byDelivery.get(j.source_delivery_id)
  if(!d||j.account_id!==d.account_id||d.status!=='arrived'||j.source_delivery_version!==d.version||j.policy_version!=='person-gift-returns-v1'||j.policy_version!==d.return_policy_version||captured.some(k=>!positive(j[k])||j[k]!==d[k]))fail()
  if((j.state==='succeeded')!==['none','gift'].includes(j.decision))fail()
  if(j.person_context){const c=j.person_context,p=c.person,s=d.person_snapshot;if(!p||p.accountId!==d.account_id||c.accountAccessVersion!==j.account_access_version||c.storyAuthorizationVersion!==j.story_authorization_version||c.returnAuthorizationVersion!==j.return_authorization_version||['id','version','accessVersion','worldId','worldVersion'].some(k=>p[k]!==s[k]))fail()}
  if(j.state==='succeeded'&&(!j.person_context||j.provider_provenance?.provider!=='openai'||typeof j.provider_provenance.model!=='string'||!j.provider_provenance.model||j.provider_provenance.promptVersion!=='person-gift-returns-v1'||j.provider_provenance.responseId!==null&&typeof j.provider_provenance.responseId!=='string'))fail()
 }
 for(const r of received){
  const d=byDelivery.get(r.source_delivery_id),j=byReturn.get(r.generation_job_id)
  if(!d||!j||j.state!=='succeeded'||j.decision!=='gift'||j.source_delivery_id!==d.id||j.account_id!==r.account_id||d.account_id!==r.account_id||r.person_id!==d.person_id||r.conversation_id!==d.conversation_id||r.policy_version!==j.policy_version||captured.some(k=>r[k]!==j[k])||bySource.has(d.id)||!positive(r.version)||r.quantity!==1||typeof r.note!=='string'||[...r.note].length>120||r.note.includes('\0')||/\p{Surrogate}/u.test(r.note))fail()
  if(stable(r.person_snapshot)!==stable(d.person_snapshot)||!r.gift_snapshot?.available||!['keepsake','prop'].includes(r.gift_snapshot.effect)||!r.gift_snapshot.audience?.includes('person')||!sameTime(r.created_at,r.created_at)||(r.opened_at==null)!==(r.placement==null)||r.opened_at!=null&&(!['record','space'].includes(r.placement)||!sameTime(r.opened_at,r.opened_at)))fail()
  bySource.set(d.id,r)
 }
 for(const j of returnJobs)if((j.decision==='gift')!==bySource.has(j.source_delivery_id))fail()
 for(const j of projections){const r=byReceived.get(j.received_gift_id);if(!r||j.account_id!==r.account_id||!positive(j.received_version)||j.received_version>r.version)fail()}
 for(const n of notifications){
  const r=n.object_kind==='received_gift'?byReceived.get(n.object_id):byDelivery.get(n.object_id),e=byEvent.get(n.source_event_id)
  const eventType={gift_received:'PersonaGiftReceived.v1',gift_arrived:'GiftDeliveryArrived.v1',gift_failed:'GiftDeliveryFailed.v1'}[n.type]
  if(!r||!e||!eventType||r.account_id!==n.account_id||r.person_id!==n.person_id||e.account_id!==n.account_id||e.type!==eventType||e.aggregate_id!==r.id||e.payload?.personId!==n.person_id||e.payload?.conversationId!==r.conversation_id||!positive(e.aggregate_version)||e.aggregate_version>r.version)fail()
  if(n.type==='gift_received'?(n.object_kind!=='received_gift'||e.payload.receivedGiftId!==r.id||e.payload.sourceDeliveryId!==r.source_delivery_id):(n.object_kind!=='delivery'||e.payload.deliveryId!==r.id||r.status!==(n.type==='gift_arrived'?'arrived':'delivery_failed')))fail()
 }
 const byNotification=new Map(notifications.map(v=>[v.id,v]))
 for(const receipt of receipts){const r=receipt.kind==='read'?byNotification.get(receipt.resource_id):byReceived.get(receipt.resource_id);if(!r||r.account_id!==receipt.account_id||!['read','open','placement'].includes(receipt.kind)||!positive(receipt.result_version)||receipt.result_version>r.version||receipt.expected_version!=null&&(!positive(receipt.expected_version)||receipt.expected_version>receipt.result_version))fail()}
 const displayable=g=>Boolean(g.available&&(['flowers','ball','cloth','cushion','sun-mat','star-lamp','path-lamp','beacon'].includes(g.id)||g.effect==='prop'&&g.render==='plant'&&g.id!=='feather'))
 for(const m of cards){
  const incoming=Boolean(m.gift_received_id),d=incoming?byReceived.get(m.gift_received_id):byDelivery.get(m.gift_delivery_id),p=m.gift_projection
  if(!d||!p||m.account_id!==d.account_id||m.person_id!==d.person_id||m.conversation_id!==d.conversation_id||p.id!==d.id||p.accountId!==d.account_id||p.personId!==d.person_id||p.conversationId!==d.conversation_id||!positive(p.version)||p.version>d.version)fail()
  for(const [a,b]of [['giftSnapshot','gift_snapshot'],['personSnapshot','person_snapshot'],['quantity','quantity'],['note','note']])if(stable(p[a])!==stable(d[b]))fail()
  if(!sameTime(p.createdAt,d.created_at))fail()
  if(incoming){
   if(m.gift_delivery_id!=null||m.author_kind!=='persona'||m.speaker_person_id!==d.person_id||m.display_name!==d.person_snapshot.displayName||p.sourceDeliveryId!==d.source_delivery_id||stable(p.origin)!==stable({kind:'persona_return',contentOrigin:'ai_generated',policyVersion:d.policy_version,generationJobId:d.generation_job_id})||p.displayable!==displayable(d.gift_snapshot))fail()
   if(p.openedAt!=null&&!sameTime(p.openedAt,d.opened_at)||(p.openedAt==null)!==(p.placement==null)||p.placement==='space'&&!p.displayable||p.version===d.version&&(!sameTime(p.openedAt,d.opened_at)||p.placement!==d.placement))fail()
  }else{
   for(const [a,b]of [['source','source'],['cost','cost'],['debitTransactionId','debit_transaction_id']])if(stable(p[a])!==stable(d[b]))fail()
   if(!sameTime(p.scheduledArrivalAt,d.scheduled_arrival_at))fail()
   if(p.version===d.version&&(p.status!==d.status||p.reversalTransactionId!==d.reversal_transaction_id||(p.failureCode??null)!==(d.failure_code??null)||!sameTime(p.arrivedAt,d.arrived_at)||!sameTime(p.failedAt,d.failed_at)))fail()
  }
 }
 const commerce=await validateGiftCommerceReferences(runtime,targets);if(!commerce.applicable&&lots.some(l=>l.source!=='trial'||(l.reserved_units??0)!==0))fail()
 return{applicable:true,verified:true,lotCount:lots.length,transactionCount:transactions.length,entryCount:entries.length,deliveryCount:deliveries.length,cardCount:cards.length,returnsApplicable:hasReturns,returnJobCount:returnJobs.length,receivedCount:received.length,notificationCount:notifications.length,commerce}
}
