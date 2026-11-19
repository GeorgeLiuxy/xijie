import'reflect-metadata'
import{test}from'node:test'
import assert from'node:assert/strict'
import{randomUUID,randomBytes}from'node:crypto'
import{NestFactory}from'@nestjs/core'
import{fixture}from'./fixture.mjs'
import{ConversationError,historyQuery}from'../dist/contracts.js'
import{historyVisibleText}from'../dist/history.js'
import{GiftProjectionStore}from'../dist/gifts.js'
import{ConversationsModule,ConversationErrors,conversationHeaders}from'../dist/http.js'

async function seed(f,a,texts,{base=0n,at='2026-11-12T00:00:00.000Z'}={}){
 const {conversation}=await f.store.ensure(a.id,a.person.id,randomUUID()),rows=texts.map((text,index)=>({id:randomUUID(),client:randomUUID(),text,sequence:String(base+BigInt(index+1)),at:new Date(Date.parse(at)+index).toISOString()}))
 await f.pool.query(`INSERT INTO messages(id,account_id,conversation_id,sequence,author_kind,text,client_message_id,request_hash,created_at)
 SELECT x.id,$1,$2,x.sequence,'self',x.text,x.client,'synthetic-history',x.at FROM jsonb_to_recordset($3::jsonb) AS x(id uuid,client uuid,text text,sequence bigint,at timestamptz)`,[a.id,conversation.id,JSON.stringify(rows)])
 await f.pool.query('UPDATE conversations SET last_sequence=$3,version=version+1 WHERE account_id=$1 AND id=$2',[a.id,conversation.id,rows.at(-1)?.sequence??'0'])
 return{id:conversation.id,rows}
}
async function server(t,f){
 const config={webOrigin:'http://localhost',serviceToken:randomBytes(32).toString('hex'),queueSchema:f.queueSchema}
 const app=await NestFactory.create(ConversationsModule.register(config,f.store),{logger:false});app.use(conversationHeaders);app.useGlobalFilters(new ConversationErrors());await app.listen(0,'127.0.0.1');t.after(()=>app.close());const origin=await app.getUrl()
 return async(a,path)=>{const response=await fetch(origin+path,{headers:{Cookie:'xijie_dev_session='+a.credential,'X-Xijie-Expected-Session':a.sessionId}});return{status:response.status,...await response.json()}}
}
const searchPath=(q,extra={})=>'/v1/search?'+new URLSearchParams({scope:'conversations',q,...extra})
async function gift(f,a,conversationId,note,{incoming=false}={}){
 f.accounts.get(a.id).giftStorage={allowed:true,authorizationVersion:1};f.accounts.get(a.id).giftReturns={allowed:true,authorizationVersion:1}
 const now=new Date().toISOString(),id=randomUUID(),common={id,accountId:a.id,personId:a.person.id,conversationId,version:1,giftSnapshot:{id:'paper-crane',name:'纸鹤',en:'Paper Crane'},personSnapshot:{id:a.person.id,displayName:a.person.displayName,worldId:a.person.worldId,version:1,worldVersion:1,accessVersion:1,audience:'person'},quantity:1,note,createdAt:now}
 const source=incoming?{...common,sourceDeliveryId:randomUUID(),openedAt:null,placement:null,displayable:true,origin:{kind:'persona_return',contentOrigin:'ai_generated',policyVersion:'person-gift-returns-v1',generationJobId:randomUUID()}}:{...common,source:'trial',cost:1,status:'in_transit',scheduledArrivalAt:now,arrivedAt:null,failedAt:null,debitTransactionId:randomUUID(),reversalTransactionId:null}
 const previous=incoming?f.dependencies.receivedGift:f.dependencies.gift
 f.dependencies[incoming?'receivedGift':'gift']=async(account,key)=>{if(account===a.id&&key===id)return structuredClone(source);if(previous)return previous(account,key);throw new ConversationError(404,'NOT_FOUND','Missing synthetic gift')}
 const store=new GiftProjectionStore(f.pool,f.dependencies,f.store),row=incoming?await store.projectReceived(id,source):await store.project(id,source)
 return{source,row}
}

test('SQL searches older than 50 across full history, keeps latest match per conversation and literal Unicode/symbol semantics',async t=>{
 const f=await fixture(t),a=f.account(),b=f.account(),texts=['河边约定 100%_x\\ A  B 🤍','更晚的河边约定',...Array.from({length:5000},(_,i)=>'无关的合成日常 '+i)]
 const chat=await seed(f,a,texts);await seed(f,b,['另一个账号的河边约定'])
 const found=await f.store.searchHistory(a.id,historyQuery(' 河边约定 '),'zh-CN');assert.equal(found.items.length,1);assert.equal(found.items[0].messageId,chat.rows[1].id);assert.equal(found.items[0].lastActivityAt,chat.rows.at(-1).at)
 for(const q of ['100%_x\\','a  b','🤍','%','_'])assert.equal((await f.store.searchHistory(a.id,historyQuery(q),'zh-CN')).items[0].messageId,chat.rows[0].id,q)
 assert.equal((await f.store.searchHistory(a.id,'a b','en')).items.length,0)
 assert.equal((await f.store.searchHistory(a.id,'１００','zh-CN')).items.length,0,'No NFKC semantic expansion')
 const plan=(await f.pool.query("EXPLAIN (ANALYZE,FORMAT JSON) SELECT DISTINCT ON(conversation_id) id FROM messages WHERE account_id=$1 AND removed_at IS NULL AND kind='text' AND strpos(lower(text),$2)>0 ORDER BY conversation_id,sequence DESC",[a.id,'河边约定'])).rows[0]['QUERY PLAN'][0]
 assert.equal(plan.Plan['Actual Rows'],1);t.diagnostic('Synthetic full-history SQL: '+JSON.stringify({rows:5002,resultRows:plan.Plan['Actual Rows'],executionMs:plan['Execution Time'],plan:plan.Plan['Node Type']}))
 const q=await server(t,f);for(const value of ['', ' ', '\0','x'.repeat(161)])assert.equal((await q(a,searchPath(value))).status,400)
 for(const value of ['scope=atlas&q=河边','scope=conversations&q=河边&locale=tr','scope=conversations&q=河边&unknown=1'])assert.equal((await q(a,'/v1/search?'+value)).status,400)
 assert.throws(()=>historyQuery('\ud800'),{code:'INVALID_ARGUMENT'})
})

test('search revision prevents mixed pages across hidden page/person/grant changes while AI withdrawal remains irrelevant',async t=>{
 const f=await fixture(t),a=f.account(),other={...a,person:{...a.person,id:randomUUID(),displayName:'Second friend'}};f.people.set(other.person.id,other.person)
 const first=await seed(f,a,['needle older','latest unmatched'],{at:'2026-11-11T00:00:00.000Z'}),second=await seed(f,other,['needle newest'],{at:'2026-11-12T00:00:00.000Z'}),read=await server(t,f)
 let page=await read(a,searchPath('needle',{limit:'1'}));assert.equal(page.data[0].messageId,second.rows[0].id);assert(page.meta.nextCursor)
 let cursor=page.meta.nextCursor
 f.accounts.get(a.id).aiTextProcessing={allowed:false,authorizationVersion:2}
 let next=await read(a,searchPath('needle',{limit:'1',cursor}));assert.equal(next.status,200);assert.equal(next.data[0].messageId,first.rows[0].id);assert.equal(next.meta.nextCursor,null)
 for(const extra of [{q:'other',limit:'1',cursor},{limit:'2',cursor},{limit:'1',locale:'en',cursor}])assert.equal((await read(a,searchPath('needle',extra))).status,400)
 const foreign=f.account();assert.equal((await read(foreign,searchPath('needle',{limit:'1',cursor}))).status,400)
 await f.pool.query('UPDATE messages SET version=version+1,text=$2 WHERE id=$1',[first.rows[0].id,'needle changed on the other page'])
 assert.equal((await read(a,searchPath('needle',{limit:'1',cursor}))).status,409)
 page=await read(a,searchPath('needle',{limit:'1'}));cursor=page.meta.nextCursor;f.people.get(a.person.id).version++
 assert.equal((await read(a,searchPath('needle',{limit:'1',cursor}))).error.code,'SOURCE_CHANGED')
 page=await read(a,searchPath('needle',{limit:'1'}));cursor=page.meta.nextCursor;f.accounts.get(a.id).storyStorage={allowed:false,authorizationVersion:2}
 assert.equal((await read(a,searchPath('needle',{limit:'1',cursor}))).status,403)
 f.accounts.get(a.id).storyStorage={allowed:true,authorizationVersion:3};assert.equal((await read(a,searchPath('needle',{limit:'1',cursor}))).error.code,'SOURCE_CHANGED')
})

test('UUID context uses exact bigint order, fills boundaries and issues direction/limit-bound cursors',async t=>{
 const f=await fixture(t),a=f.account(),b=f.account(),chat=await seed(f,a,Array.from({length:12},(_,i)=>'line '+i),{base:9007199254740990n}),read=await server(t,f),base='/v1/conversations/'+chat.id+'/messages/'
 const context=await read(a,base+chat.rows[5].id+'/context?limit=5');assert.equal(context.status,200)
 assert.deepEqual(context.data.items.map(row=>row.id),chat.rows.slice(3,8).map(row=>row.id));assert.equal(context.data.anchorMessageId,chat.rows[5].id)
 const older=await read(a,'/v1/conversations/'+chat.id+'/messages?'+new URLSearchParams({limit:'5',cursor:context.data.beforeCursor,direction:'older'}));assert.deepEqual(older.data.map(row=>row.id),chat.rows.slice(0,3).reverse().map(row=>row.id))
 const newer=await read(a,'/v1/conversations/'+chat.id+'/messages?'+new URLSearchParams({limit:'5',cursor:context.data.afterCursor,direction:'newer'}));assert.deepEqual(newer.data.map(row=>row.id),chat.rows.slice(8).map(row=>row.id))
 assert.equal((await read(a,'/v1/conversations/'+chat.id+'/messages?'+new URLSearchParams({limit:'5',cursor:context.data.beforeCursor,direction:'newer'}))).status,400)
 assert.equal((await read(a,'/v1/conversations/'+chat.id+'/messages?'+new URLSearchParams({limit:'4',cursor:context.data.beforeCursor,direction:'older'}))).status,400)
 const first=await read(a,base+chat.rows[0].id+'/context?limit=5');assert.equal(first.data.beforeCursor,null);assert.deepEqual(first.data.items.map(row=>row.id),chat.rows.slice(0,5).map(row=>row.id))
 const last=await read(a,base+chat.rows.at(-1).id+'/context?limit=5');assert.equal(last.data.afterCursor,null);assert.deepEqual(last.data.items.map(row=>row.id),chat.rows.slice(-5).map(row=>row.id))
 const one=await read(a,base+chat.rows[5].id+'/context?limit=1');assert.equal(one.data.items.length,1);assert(one.data.beforeCursor&&one.data.afterCursor)
 assert.equal((await read(b,base+chat.rows[5].id+'/context?limit=5')).status,404)
 assert.equal((await read(a,base+randomUUID()+'/context?limit=5')).status,404)
 for(const tail of ['?limit=101','?cursor=bad','?limit=0'])assert.equal((await read(a,base+chat.rows[5].id+'/context'+tail)).status,400)
 await f.pool.query('UPDATE messages SET removed_at=clock_timestamp(),version=version+1 WHERE id=$1',[chat.rows[5].id]);assert.equal((await read(a,base+chat.rows[5].id+'/context')).status,404)
})

test('gift search uses live localized visible text, skips unavailable latest sources and rejects source outages',async t=>{
 const f=await fixture(t),a=f.account(),chat=await seed(f,a,['较早的合成赠言']),outgoing=await gift(f,a,chat.id,'合成赠言'),incoming=await gift(f,a,chat.id,'后来的合成赠言',{incoming:true})
 const initial=await f.store.searchHistory(a.id,'合成赠言','zh-CN');assert.equal(initial.items[0].messageId,incoming.row.id);assert.match(initial.items[0].excerpt,/后来的合成赠言/)
 assert.equal((await f.store.searchHistory(a.id,'[gift] received paper crane ×1','en')).items[0].messageId,incoming.row.id)
 assert.equal(historyVisibleText((await f.store.messages(a.id,chat.id,'older',undefined,1))[0],'en'),'[Gift] Received Paper Crane ×1 · 后来的合成赠言')
 const source=f.dependencies.receivedGift;f.dependencies.receivedGift=async()=>{throw new ConversationError(404,'NOT_FOUND','Synthetic removed source')}
 assert.equal((await f.store.searchHistory(a.id,'合成赠言','zh-CN')).items[0].messageId,outgoing.row.id)
 f.dependencies.gift=async()=>{throw new ConversationError(403,'GIFT_PERMISSION_REQUIRED','Synthetic denied source')}
 assert.equal((await f.store.searchHistory(a.id,'合成赠言','zh-CN')).items[0].messageId,chat.rows[0].id)
 f.dependencies.receivedGift=async()=>{throw new ConversationError(503,'DEPENDENCY_UNAVAILABLE','Synthetic outage')};await assert.rejects(f.store.searchHistory(a.id,'合成赠言','zh-CN'),{status:503})
 f.dependencies.receivedGift=source
})

test('history permissions separate text from outgoing and incoming gifts, with no AI read gate',async t=>{
 const f=await fixture(t),a=f.account(),chat=await seed(f,a,['Private text']),outgoing=await gift(f,a,chat.id,'outgoing'),incoming=await gift(f,a,chat.id,'incoming',{incoming:true}),account=f.accounts.get(a.id)
 account.aiTextProcessing={allowed:false,authorizationVersion:2};assert.equal((await f.store.messages(a.id,chat.id,'older',undefined,20)).length,3)
 account.storyStorage={allowed:false,authorizationVersion:2}
 assert.deepEqual((await f.store.messages(a.id,chat.id,'older',undefined,20)).map(row=>row.id),[outgoing.row.id]);assert.equal((await f.store.summaries(a.id))[0].lastMessage.id,outgoing.row.id)
 assert.equal((await f.store.historyContext(a.id,chat.id,outgoing.row.id,20)).items[0].id,outgoing.row.id)
 await assert.rejects(f.store.historyContext(a.id,chat.id,chat.rows[0].id,20),{status:403});await assert.rejects(f.store.historyContext(a.id,chat.id,incoming.row.id,20),{status:404});await assert.rejects(f.store.searchHistory(a.id,'private','en'),{status:403})
 account.giftStorage={allowed:false,authorizationVersion:2};await assert.rejects(f.store.messages(a.id,chat.id,'older',undefined,20),{status:403});await assert.rejects(f.store.summaries(a.id),{status:403})
 account.storyStorage={allowed:true,authorizationVersion:3};assert.deepEqual((await f.store.messages(a.id,chat.id,'older',undefined,20)).map(row=>row.id),[chat.rows[0].id])
})

test('late deletion or permission/source changes cannot return stale anchor, text or search excerpts',async t=>{
 const f=await fixture(t),a=f.account(),chat=await seed(f,a,['race anchor']),original=f.dependencies.person
 let reads=0;f.dependencies.person=async(...args)=>{const person=await original(...args);if(++reads===2)await f.pool.query('UPDATE messages SET removed_at=clock_timestamp(),version=version+1 WHERE id=$1',[chat.rows[0].id]);return person}
 await assert.rejects(f.store.historyContext(a.id,chat.id,chat.rows[0].id,20),{code:'NOT_FOUND'});f.dependencies.person=original
 const other={...a,person:{...a.person,id:randomUUID()}};f.people.set(other.person.id,other.person);const second=await seed(f,other,['race authority']),account=f.dependencies.account;let calls=0
 f.dependencies.account=async(...args)=>{if(++calls===2)f.accounts.get(a.id).storyStorage={allowed:false,authorizationVersion:2};return account(...args)}
 await assert.rejects(f.store.messages(a.id,second.id,'older',undefined,20),{code:'SOURCE_CHANGED'});f.dependencies.account=account;f.accounts.get(a.id).storyStorage={allowed:true,authorizationVersion:3}
 const outgoing=await gift(f,other,second.id,'race gift'),source=f.dependencies.gift;let sourceReads=0
 f.dependencies.gift=async(...args)=>{const value=await source(...args);if(++sourceReads===2)value.version++;return value}
 await assert.rejects(f.store.searchHistory(a.id,'race gift','en'),{code:'SOURCE_CHANGED'})
 assert(outgoing.row.id)
})

test('gift candidate budget fails explicitly instead of returning incomplete history',async t=>{
 const f=await fixture(t),a=f.account(),chat=await seed(f,a,['baseline']),one=await gift(f,a,chat.id,'bounded'),source=(await f.pool.query('SELECT * FROM messages WHERE id=$1',[one.row.id])).rows[0]
 await f.pool.query(`WITH synthetic AS(SELECT x,gen_random_uuid() AS gift_id FROM generate_series(1,1000)x)
 INSERT INTO messages(account_id,conversation_id,sequence,kind,author_kind,text,gift_delivery_id,gift_projection,created_at)
 SELECT $1,$2,100+x,'gift','self','',gift_id,jsonb_set($3::jsonb,'{id}',to_jsonb(gift_id::text)),clock_timestamp() FROM synthetic`,[a.id,chat.id,JSON.stringify(source.gift_projection)])
 await assert.rejects(f.store.searchHistory(a.id,'baseline','en'),{code:'HISTORY_TOO_LARGE',status:413})
})

test('withdrawal while the final People RPC is awaiting blocks all old text responses',async t=>{
 const f=await fixture(t),a=f.account(),chat=await seed(f,a,['Final authority needle']),persons=f.dependencies.persons,person=f.dependencies.person
 for(const operation of ['search','summaries','context','messages']){
  f.accounts.get(a.id).storyStorage={allowed:true,authorizationVersion:10};let reads=0
  const intercept=original=>async(...args)=>{const value=await original(...args);if(++reads===2)f.accounts.get(a.id).storyStorage={allowed:false,authorizationVersion:11};return value}
  f.dependencies.persons=intercept(persons);f.dependencies.person=intercept(person)
  const run=operation==='search'?()=>f.store.searchHistory(a.id,'needle','en'):operation==='summaries'?()=>f.store.summaries(a.id):operation==='context'?()=>f.store.historyContext(a.id,chat.id,chat.rows[0].id,20):()=>f.store.messages(a.id,chat.id,'older',undefined,20)
  await assert.rejects(run(),{code:'SOURCE_CHANGED'},operation)
 }
 f.dependencies.persons=persons;f.dependencies.person=person
})
