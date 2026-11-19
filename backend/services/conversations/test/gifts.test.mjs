import 'reflect-metadata'
import assert from 'node:assert/strict'
import {randomUUID,randomBytes} from 'node:crypto'
import {test} from 'node:test'
import {NestFactory} from '@nestjs/core'
import {fixture,text} from './fixture.mjs'
import {GiftProjectionStore} from '../dist/gifts.js'
import {ConversationError} from '../dist/contracts.js'
import {AutomaticSourceStore} from '../dist/automatic-sources.js'
import {exportConversations,eraseConversations} from '../dist/data-rights.js'
import {ConversationsModule,ConversationErrors,conversationHeaders} from '../dist/http.js'

test('gift projections are one authentic card, with independent permissions, no model or memory source and data rights',async t=>{
 const f=await fixture(t),a=f.account(),b=f.account(),gifts=new GiftProjectionStore(f.pool,f.dependencies,f.store)
 f.accounts.get(a.id).giftStorage={allowed:true,authorizationVersion:1}
 f.accounts.get(a.id).aiTextProcessing.allowed=false
 const ensured=await gifts.ensure(a.id,a.person.id)
 assert.deepEqual(await gifts.ensure(a.id,a.person.id),ensured)
 for(const projection of [null,{}])await assert.rejects(f.pool.query("INSERT INTO messages(account_id,conversation_id,sequence,kind,author_kind,text,gift_delivery_id,gift_projection) VALUES($1,$2,99,'gift','self','',$3,$4)",[a.id,ensured.id,randomUUID(),projection]),{code:'23514'})
 await assert.rejects(gifts.ensure(b.id,a.person.id),{code:'GIFT_PERMISSION_REQUIRED'})
 const now=new Date().toISOString(),id=randomUUID()
 let source={id,accountId:a.id,personId:a.person.id,conversationId:ensured.id,version:1,giftSnapshot:{id:'paper-crane',name:['纸鹤','Crane']},personSnapshot:{id:a.person.id,displayName:a.person.displayName,worldId:a.person.worldId,version:1,worldVersion:1,accessVersion:1,audience:'person'},quantity:1,note:'Synthetic private gift note',source:'trial',cost:1,status:'in_transit',createdAt:now,scheduledArrivalAt:now,arrivedAt:null,failedAt:null,debitTransactionId:randomUUID(),reversalTransactionId:null}
 f.dependencies.gift=async(account,delivery)=>{assert.equal(account,a.id);assert.equal(delivery,source.id);const db=await f.pool.connect();try{await db.query('BEGIN');assert.equal((await db.query("SELECT pg_try_advisory_xact_lock(hashtextextended('xijie:conversations:erasure:' || $1,0)) AS unlocked",[a.id])).rows[0].unlocked,true);await db.query('ROLLBACK')}finally{db.release()}return structuredClone(source)}
 const first=await gifts.project(id,source);assert.deepEqual(await gifts.project(id,source),first)
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM messages')).rows[0].n,1)
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM generation_jobs')).rows[0].n,0)
 const initial=(await f.store.messages(a.id,ensured.id,'older',undefined,20))[0]
 assert.equal(initial.kind,'gift');assert.equal(initial.gift.deliveryId,id);assert.equal(initial.gift.note,source.note);assert.equal(initial.canSuggestMemory,false);assert.equal(initial.generationJobId,undefined)
 assert.equal((await f.store.summaries(a.id))[0].lastMessage.kind,'gift')
 const automatic=new AutomaticSourceStore(f.pool,f.dependencies)
 assert.deepEqual(await automatic.events([a.id],50),[])
 await assert.rejects(automatic.source(a.id,first.id),{code:'NOT_FOUND'})
 await assert.rejects(f.store.sourceContext(a.id,first.id),{code:'NOT_FOUND'})
 await assert.rejects(f.store.memorySourceContext(a.id,first.id),{code:'NOT_FOUND'})
 const old=source;source={...source,version:2,status:'arrived',arrivedAt:now}
 await assert.rejects(gifts.project(id,old),{code:'SOURCE_CHANGED'})
 const arrived=await gifts.project(id,source);assert.equal(arrived.id,first.id);assert.equal(arrived.version,2)
 assert.equal((await f.store.messages(a.id,ensured.id,'older',undefined,20))[0].sequence,initial.sequence)
 await assert.rejects(gifts.project(id,{...source,note:'tampered'}),{code:'SOURCE_CHANGED'})
 f.accounts.get(a.id).giftStorage={allowed:false,authorizationVersion:2}
 assert.deepEqual(await f.store.messages(a.id,ensured.id,'older',undefined,20),[])
 assert.equal((await f.store.summaries(a.id))[0].lastMessage,null)
 await assert.rejects(gifts.project(id,source),{code:'GIFT_PERMISSION_REQUIRED'})
 const exported=await exportConversations(f.pool,f.dependencies,a.id,'account_data')
 assert.equal(exported.data.messages[0].kind,'gift');assert.equal(exported.data.messages[0].giftDeliveryId,id)
 f.accounts.get(a.id).giftStorage={allowed:true,authorizationVersion:3};f.accounts.get(a.id).aiTextProcessing.allowed=true
 const sent=await f.store.send(a.id,ensured.id,randomUUID(),text('User text after gift'),randomUUID())
 const job=(await f.pool.query('SELECT * FROM generation_jobs WHERE id=$1',[sent.generationJobId])).rows[0]
 const context=await f.store.context(job);assert.equal(context.length,1);assert.equal(context[0].kind,'text');assert(!JSON.stringify(context).includes(source.note))
 assert.deepEqual((await automatic.validate(a.id,a.person.id,[{id:first.id,version:2}])).valid,[])
 await f.store.removeMessage(a.id,ensured.id,first.id,randomUUID(),2,randomUUID())
 assert.equal((await gifts.project(id,source)).removed,true)
 assert.equal((await f.store.messages(a.id,ensured.id,'older',undefined,20)).length,1)
 // Arrival may be projected only after the user has removed its in-transit card.
 source={...old,id:randomUUID(),debitTransactionId:randomUUID()}
 const pending=await gifts.project(source.id,source)
 await f.store.removeMessage(a.id,ensured.id,pending.id,randomUUID(),pending.version,randomUUID())
 source={...source,version:2,status:'arrived',arrivedAt:now}
 assert.equal((await gifts.project(source.id,source)).removed,true)
 const tombstone=(await f.pool.query('SELECT removed_at,gift_projection FROM messages WHERE id=$1',[pending.id])).rows[0]
 assert(tombstone.removed_at);assert.equal(tombstone.gift_projection.status,'in_transit')
 assert.equal((await f.store.messages(a.id,ensured.id,'older',undefined,20)).length,1)
 await eraseConversations(f.pool,f.queueSchema,a.id,randomUUID())
 await assert.rejects(gifts.project(source.id,source),{code:'NOT_FOUND'})
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM messages WHERE account_id=$1',[a.id])).rows[0].n,0)
})

test('gift internal HTTP rejects other roles and untrusted delivery updates',async t=>{
 const f=await fixture(t),a=f.account(),token=randomBytes(32).toString('hex')
 f.accounts.get(a.id).giftStorage={allowed:true,authorizationVersion:1}
 const app=await NestFactory.create(ConversationsModule.register({giftsServiceToken:token,webOrigin:'http://localhost',queueSchema:f.queueSchema},f.store),{logger:false});app.use(conversationHeaders);app.useGlobalFilters(new ConversationErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close())
 const origin=await app.getUrl(),body={accountId:a.id,personId:a.person.id}
 const ensure=headers=>fetch(origin+'/internal/v1/gifts/conversations/ensure',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)})
 assert.equal((await ensure()).status,403)
 assert.equal((await ensure({Authorization:'Bearer '+'0'.repeat(64)})).status,403)
 const result=await ensure({Authorization:'Bearer '+token});assert.equal(result.status,200);const direct=(await result.json()).data;assert.equal(direct.personId,a.person.id)
 assert.equal((await fetch(origin+'/internal/v1/gifts/deliveries/'+randomUUID(),{method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:'{}'})).status,400)
 const source={id:randomUUID(),accountId:a.id,personId:a.person.id,conversationId:direct.id,sourceDeliveryId:randomUUID(),personSnapshot:{id:a.person.id,displayName:a.person.displayName,worldId:a.person.worldId,version:1,worldVersion:1,accessVersion:1,audience:'person'},giftSnapshot:{id:'paper-crane',name:'Crane'},quantity:1,note:'Synthetic model gift',version:1,createdAt:new Date().toISOString(),openedAt:null,placement:null,displayable:true,origin:{kind:'persona_return',contentOrigin:'ai_generated',policyVersion:'person-gift-returns-v1',generationJobId:randomUUID()}}
 f.accounts.get(a.id).giftReturns={allowed:true,authorizationVersion:1};f.dependencies.receivedGift=async()=>source
 const incoming=authorization=>fetch(origin+'/internal/v1/gifts/received/'+source.id,{method:'PUT',headers:{'Content-Type':'application/json',Authorization:authorization},body:JSON.stringify(source)})
 assert.equal((await incoming('Bearer '+'0'.repeat(64))).status,403);const accepted=await incoming('Bearer '+token);assert.equal(accepted.status,200);assert((await accepted.json()).data.id)
})

test('unavailable old-purpose gift cards do not hide text or stall either pagination direction',async t=>{
 const f=await fixture(t),a=f.account(),gifts=new GiftProjectionStore(f.pool,f.dependencies,f.store)
 f.accounts.get(a.id).giftStorage={allowed:true,authorizationVersion:3}
 const direct=await gifts.ensure(a.id,a.person.id),first=await f.store.send(a.id,direct.id,randomUUID(),text('Earlier text'),randomUUID()),now=new Date().toISOString()
 const source={id:randomUUID(),accountId:a.id,personId:a.person.id,conversationId:direct.id,version:1,giftSnapshot:{id:'paper-crane',name:['纸鹤','Crane']},personSnapshot:{id:a.person.id,displayName:a.person.displayName,worldId:a.person.worldId,version:1,worldVersion:1,accessVersion:1,audience:'person'},quantity:1,note:'Old purpose gift',source:'trial',cost:1,status:'in_transit',createdAt:now,scheduledArrivalAt:now,arrivedAt:null,failedAt:null,debitTransactionId:randomUUID(),reversalTransactionId:null,failureCode:null}
 let denied=0
 f.dependencies.gift=async()=>{if(denied)throw new ConversationError(denied,'SOURCE_UNAVAILABLE','Synthetic source unavailable');return source}
 await gifts.project(source.id,source)
 for(const status of [403,404]){
  denied=status
  assert.equal((await f.store.messages(a.id,direct.id,'older',undefined,1))[0].id,first.message.id)
  assert.equal((await f.store.summaries(a.id))[0].lastMessage.id,first.message.id)
 }
 const later=await f.store.send(a.id,direct.id,randomUUID(),text('Later text'),randomUUID())
 assert.equal((await f.store.messages(a.id,direct.id,'newer',first.message.sequence,1))[0].id,later.message.id)
 assert.equal((await f.store.messages(a.id,direct.id,'older',later.message.sequence,1))[0].id,first.message.id)
 denied=503;await assert.rejects(f.store.messages(a.id,direct.id,'older',later.message.sequence,1),{status:503})
})

test('received AI gifts use an independent authentic source, preserve one card and never enter ordinary generation or memory',async t=>{
 const f=await fixture(t),a=f.account(),b=f.account(),gifts=new GiftProjectionStore(f.pool,f.dependencies,f.store),account=f.accounts.get(a.id)
 account.giftStorage={allowed:true,authorizationVersion:1};account.giftReturns={allowed:true,authorizationVersion:2};account.aiTextProcessing.allowed=false
 const direct=await gifts.ensure(a.id,a.person.id),now=new Date().toISOString()
 let source={id:randomUUID(),accountId:a.id,personId:a.person.id,conversationId:direct.id,sourceDeliveryId:randomUUID(),personSnapshot:{id:a.person.id,displayName:a.person.displayName,worldId:a.person.worldId,version:1,worldVersion:1,accessVersion:1,audience:'person'},giftSnapshot:{id:'paper-crane',name:'Crane'},quantity:1,note:'Synthetic model return',version:1,createdAt:now,openedAt:null,placement:null,displayable:true,origin:{kind:'persona_return',contentOrigin:'ai_generated',policyVersion:'person-gift-returns-v1',generationJobId:randomUUID()}}
 let sourceStatus=0
 f.dependencies.receivedGift=async(owner,id)=>{
  if(owner!==a.id||id!==source.id)throw new ConversationError(404,'NOT_FOUND','Missing')
  if(sourceStatus)throw new ConversationError(sourceStatus,'SOURCE_UNAVAILABLE','Unavailable')
  const db=await f.pool.connect();try{await db.query('BEGIN');assert.equal((await db.query("SELECT pg_try_advisory_xact_lock(hashtextextended('xijie:conversations:erasure:' || $1,0)) AS unlocked",[a.id])).rows[0].unlocked,true);await db.query('ROLLBACK')}finally{db.release()}
  return structuredClone(source)
 }
 const first=await gifts.projectReceived(source.id,source);assert.deepEqual(await gifts.projectReceived(source.id,source),first)
 const initial=(await f.store.messages(a.id,direct.id,'older',undefined,20))[0]
 assert.deepEqual(initial.author,{kind:'persona',personId:a.person.id,displayName:a.person.displayName,aiGenerated:true});assert.equal(initial.kind,'gift');assert.equal(initial.text,'');assert.equal(initial.gift.direction,'received');assert.equal(initial.gift.receivedGiftId,source.id);assert.equal(initial.gift.note,source.note);assert.equal(initial.canSuggestMemory,false);assert.equal(initial.generationJobId,undefined)
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM generation_jobs')).rows[0].n,0)
 for(const changed of [{...source,note:'tampered'},{...source,accountId:b.id},{...source,origin:{...source.origin,contentOrigin:'template'}}])await assert.rejects(gifts.projectReceived(source.id,changed))
 const automatic=new AutomaticSourceStore(f.pool,f.dependencies);assert.deepEqual(await automatic.events([a.id],50),[]);await assert.rejects(f.store.sourceContext(a.id,first.id),{code:'NOT_FOUND'});await assert.rejects(f.store.memorySourceContext(a.id,first.id),{code:'NOT_FOUND'});await assert.rejects(automatic.source(a.id,first.id),{code:'NOT_FOUND'})
 source={...source,version:2,openedAt:now,placement:'record'};const opened=await gifts.projectReceived(source.id,source);assert.equal(opened.id,first.id);assert.equal(opened.version,2);assert.equal((await f.store.messages(a.id,direct.id,'older',undefined,20))[0].sequence,initial.sequence)
 const exported=await exportConversations(f.pool,f.dependencies,a.id,'account_data');assert.equal(exported.data.messages[0].receivedGiftId,source.id);assert.equal(exported.data.messages[0].giftDeliveryId,null)
 // Native constraints keep text persona tied to a real chat job, and reject malformed incoming provenance.
 await assert.rejects(f.pool.query("INSERT INTO messages(account_id,conversation_id,sequence,kind,author_kind,text,speaker_person_id,display_name) VALUES($1,$2,99,'text','persona','synthetic',$3,'Synthetic')",[a.id,direct.id,a.person.id]),{code:'23514'})
 for(const projection of [null,{}, {...source,origin:{...source.origin,contentOrigin:'template'}}])await assert.rejects(f.pool.query("INSERT INTO messages(account_id,conversation_id,sequence,kind,author_kind,text,gift_received_id,gift_projection,speaker_person_id,display_name) VALUES($1,$2,99,'gift','persona','',$3,$4,$5,'Synthetic')",[a.id,direct.id,randomUUID(),projection,a.person.id]),{code:'23514'})
 account.aiTextProcessing.allowed=true;const sent=await f.store.send(a.id,direct.id,randomUUID(),text('Ordinary user text'),randomUUID()),job=(await f.pool.query('SELECT * FROM generation_jobs WHERE id=$1',[sent.generationJobId])).rows[0]
 assert.deepEqual((await f.store.context(job)).map(m=>m.id),[sent.message.id]);assert.deepEqual((await automatic.validate(a.id,a.person.id,[{id:first.id,version:2}])).valid,[])
 for(const permission of ['giftReturns','storyStorage']){const saved=account[permission];account[permission]={allowed:false,authorizationVersion:saved.authorizationVersion+1};await assert.rejects(gifts.projectReceived(source.id,source),{code:'GIFT_RETURN_PERMISSION_REQUIRED'});assert.equal((await f.store.messages(a.id,direct.id,'older',sent.message.sequence,1)).length,0);account[permission]=saved}
 sourceStatus=404;assert.equal((await f.store.summaries(a.id))[0].lastMessage.id,sent.message.id);assert.equal((await f.store.messages(a.id,direct.id,'older',sent.message.sequence,1)).length,0);sourceStatus=503;await assert.rejects(f.store.messages(a.id,direct.id,'older',sent.message.sequence,1),{status:503});sourceStatus=0
 await f.store.removeMessage(a.id,direct.id,first.id,randomUUID(),opened.version,randomUUID());source={...source,version:3,placement:'space'};assert.equal((await gifts.projectReceived(source.id,source)).removed,true);assert((await f.pool.query('SELECT removed_at FROM messages WHERE id=$1',[first.id])).rows[0].removed_at)
 await eraseConversations(f.pool,f.queueSchema,a.id,randomUUID());await assert.rejects(gifts.projectReceived(source.id,source),{code:'NOT_FOUND'})
})
