import{createHash}from'node:crypto'
import type{Pool}from'pg'
import{ConversationError,notFound,type Message,type Summary,type HistorySearchHit}from'./contracts.js'
import type{AccountContext,ContextProvider,PersonContext}from'./dependencies.js'
import type{MessageRow}from'./store.js'
import type{GatherContext}from'./gather-context.js'
import{giftMessage}from'./gifts.js'

const MAX_SCAN=1000,MAX_RESPONSE=2*1024*1024
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const changed=()=>new ConversationError(409,'SOURCE_CHANGED','The visible history changed. Reload it before continuing.')
const denied=()=>new ConversationError(403,'STORAGE_PERMISSION_REQUIRED','Reading this history requires its current storage permission.')
const tooLarge=()=>new ConversationError(413,'HISTORY_TOO_LARGE','The history exceeds the supported scan or response size.')
type ConversationRecord={id:string;person_id:string|null;world_id:string|null;kind:'direct'|'gather';version:number}
type Observed={row:MessageRow;value?:Message}
function bounded<T>(value:T):T{if(Buffer.byteLength(JSON.stringify(value))>MAX_RESPONSE)throw tooLarge();return value}
export function historyVisibleText(value:Message,locale='zh-CN'){
 if(value.kind==='text')return value.text
 if(value.kind==='photo')return locale==='zh-CN'?'一张照片':'A photo'
 const gift=value.gift!,snapshot=gift.giftSnapshot,zh=locale==='zh-CN',incoming='direction'in gift&&gift.direction==='received'
 const name=typeof snapshot.name==='string'?(zh?snapshot.name:typeof snapshot.en==='string'?snapshot.en:snapshot.name):Array.isArray(snapshot.name)?String(snapshot.name[zh?0:1]??snapshot.name[0]):''
 return`${zh?(incoming?'[礼物] 收到':'[礼物] 送出'):(incoming?'[Gift] Received':'[Gift] Sent')} ${name} ×${gift.quantity}${gift.note?' · '+gift.note:''}`
}
function excerpt(text:string,needle:string){
 // Map lower-case expansion back to original code points, preserving exact text.
 const chars=[...text],lower:string[]=[],owners:number[]=[]
 chars.forEach((char,index)=>{for(const unit of char.toLowerCase()){for(const codeUnit of unit.split('')){lower.push(codeUnit);owners.push(index)}}})
 const at=text.toLowerCase().indexOf(needle),from=at<0?0:owners[at],through=at<0?0:(owners[at+needle.length-1]??from)+1
 const start=from>12?from-6:0,end=Math.min(chars.length,Math.max(start+60,through))
 return(start?'…':'')+chars.slice(start,end).join('')+(end<chars.length?'…':'')
}

// A read operation owns one short-lived authorization/observation set. All RPCs
// run outside SQL transactions; final checks fence stale rows and source facts.
class ReadScope{
 readonly observed=new Map<string,Observed>()
 readonly observedCalls=new Map<string,number>()
 readonly people=new Map<string,PersonContext>()
 readonly conversations=new Map<string,ConversationRecord>()
 readonly gathers=new Map<string,GatherContext>()
 scanned=0;useStory=false;useGift=false;useReturns=false;usePhoto=false
 constructor(readonly owner:ConversationHistory,readonly account:AccountContext,public all:boolean){}
 async observe(row:MessageRow):Promise<Message|undefined>{
  const cached=this.observed.get(row.id);if(cached)return cached.value
  if(++this.scanned>MAX_SCAN)throw tooLarge()
  let value:Message|undefined
  if(row.kind==='text'){
   if(this.account.storyStorage.allowed){this.useStory=true;value=this.owner.text(row);if(row.conversation_kind==='gather'&&value.author.kind==='persona'&&!this.people.has(row.speaker_person_id!))value={...value,author:{kind:'persona',displayName:'已移除的人物',aiGenerated:true}}}
  }else if(row.kind==='photo'){
   if(this.account.storyStorage.allowed&&this.account.chatPhotoStorage?.allowed){this.useStory=true;this.usePhoto=true;try{value=await this.owner.photo?.(this.account.accountId,row.id)}catch(error){if(!(error instanceof ConversationError&&[403,404].includes(error.status)))throw error}}
  }else if(row.kind==='gift'&&this.account.giftStorage?.allowed){
   this.useGift=true
   if(row.gift_received_id){this.useStory=true;this.useReturns=true}
   try{value=await giftMessage(this.owner.dependencies,row)}catch(error){if(!(error instanceof ConversationError&&[403,404].includes(error.status)))throw error}
  }
  this.observed.set(row.id,{row,value});return value
 }
 async finish(anchor?:string,checkConversations=false){
  const d=this.owner.dependencies,accountId=this.account.accountId
  // The source may change without its conversation projection arriving yet.
  for(const {row,value}of this.observed.values())if(value?.kind==='gift'){
   let current:Message
   try{current=await giftMessage(d,row)}catch(error){if(error instanceof ConversationError&&[403,404].includes(error.status)){if(row.id===anchor)throw error;throw changed()}throw error}
   if(digest(current)!==digest(value))throw changed()
  }
  const persons=this.all?await d.persons(accountId):await Promise.all([...this.people.keys()].map(id=>d.person(accountId,id)))
  const byId=new Map(persons.map(person=>[person.id,person]))
  if(this.all&&persons.length!==this.people.size)throw changed()
  for(const before of this.people.values()){
   const now=byId.get(before.id)
   if(!now||now.accountId!==accountId||now.status!=='active')throw notFound()
   if(now.version!==before.version||now.accessVersion!==before.accessVersion)throw changed()
  }
  for(const [worldId,before]of this.gathers){const now=await d.gatherContext?.(accountId,worldId);if(!now||now.revision!==before.revision)throw changed()}
  const after=await d.account(accountId)
  if(after.status!=='active'||after.accessVersion!==this.account.accessVersion)throw changed()
  for(const field of [this.useStory?'storyStorage':null,this.useGift?'giftStorage':null,this.useReturns?'giftReturns':null,this.usePhoto?'chatPhotoStorage':null] as const){
   if(!field)continue
   const before=this.account[field],now=after[field]
   if(before?.allowed!==now?.allowed||before?.authorizationVersion!==now?.authorizationVersion)throw changed()
  }
  if(checkConversations){
   const current=await this.owner.records(accountId,[...this.people.keys()],this.account.storyStorage.allowed)
   if(digest(current)!==digest([...this.conversations.values()]))throw changed()
  }
  const ids=[...this.observed.keys()]
  if(this.observedCalls.size){const rows=(await this.owner.pool.query<{id:string;version:number}>('SELECT id,version FROM call_sessions WHERE account_id=$1 AND id=ANY($2::uuid[]) AND state=\'ended\' AND started_at IS NOT NULL AND ended_at IS NOT NULL',[accountId,[...this.observedCalls.keys()]])).rows,current=new Map(rows.map(row=>[row.id,row.version]));for(const[id,version]of this.observedCalls)if(current.get(id)!==version)throw changed()}
  if(ids.length){
   const rows=(await this.owner.pool.query<{id:string;version:number}>('SELECT id,version FROM messages WHERE account_id=$1 AND id=ANY($2::uuid[]) AND removed_at IS NULL',[accountId,ids])).rows,current=new Map(rows.map(row=>[row.id,row.version]))
   for(const [id,{row}]of this.observed)if(current.get(id)!==row.version){if(id===anchor)throw notFound();throw changed()}
  }
 }
}

export class ConversationHistory{
 constructor(readonly pool:Pool,readonly dependencies:ContextProvider,readonly text:(row:MessageRow)=>Message,readonly photo?:(accountId:string,messageId:string)=>Promise<Message>){}
 async records(accountId:string,personIds:string[],gathers=true){
  return(await this.pool.query<ConversationRecord>("SELECT id,person_id,world_id,kind,version FROM conversations WHERE account_id=$1 AND (person_id=ANY($2::uuid[]) OR(kind='gather' AND $3)) ORDER BY id",[accountId,personIds,gathers])).rows
 }
 private async start(accountId:string,id?:string,search=false){
  const account=await this.dependencies.account(accountId)
  if(account.status!=='active')throw notFound()
  const permitted=search?account.storyStorage.allowed:account.storyStorage.allowed||account.giftStorage?.allowed===true
  if(!id&&!permitted)throw denied()
  const scope=new ReadScope(this,account,id===undefined)
  if(search)scope.useStory=true
  if(id){
   const row=(await this.pool.query<ConversationRecord>('SELECT id,person_id,world_id,kind,version FROM conversations WHERE account_id=$1 AND id=$2',[accountId,id])).rows[0]
   if(!row)throw notFound()
   if(!permitted)throw denied()
   if(row.kind==='gather'){
    if(!account.storyStorage.allowed)throw denied()
    const world=await this.dependencies.gatherContext?.(accountId,row.world_id!);if(!world)throw notFound()
    scope.gathers.set(row.world_id!,world);scope.all=true
    for(const person of await this.dependencies.persons(accountId))scope.people.set(person.id,person)
   }else{const person=await this.dependencies.person(accountId,row.person_id!);scope.people.set(person.id,person)}
   scope.conversations.set(row.id,row)
  }else{
   const people=await this.dependencies.persons(accountId)
   if(people.length>MAX_SCAN)throw tooLarge()
   for(const person of people)scope.people.set(person.id,person)
   for(const row of await this.records(accountId,[...scope.people.keys()],account.storyStorage.allowed)){scope.conversations.set(row.id,row);if(row.kind==='gather'){const world=await this.dependencies.gatherContext?.(accountId,row.world_id!);if(!world)throw notFound();scope.gathers.set(row.world_id!,world)}}
  }
  return scope
 }
 private async scan(scope:ReadScope,id:string,direction:'older'|'newer',boundary:string|undefined,limit:number){
  const result:Message[]=[];let position=boundary
  while(result.length<limit){
   const batch=Math.min(100,limit-result.length),rows=(await this.pool.query<MessageRow>(`SELECT * FROM messages WHERE account_id=$1 AND conversation_id=$2 AND removed_at IS NULL AND ((kind='text' AND $5) OR(kind='gift' AND $6) OR(kind='photo' AND $5 AND $7)) AND($3::bigint IS NULL OR sequence ${direction==='older'?'<':'>'} $3) ORDER BY sequence ${direction==='older'?'DESC':'ASC'} LIMIT $4`,[scope.account.accountId,id,position??null,batch,scope.account.storyStorage.allowed,scope.account.giftStorage?.allowed===true,scope.account.chatPhotoStorage?.allowed===true])).rows
   for(const row of rows){position=row.sequence;const value=await scope.observe(row);if(value)result.push(value)}
   if(rows.length<batch)break
  }
  return result
 }
 async messages(accountId:string,id:string,direction:'older'|'newer',boundary:string|undefined,limit:number){
  const scope=await this.start(accountId,id),items=await this.scan(scope,id,direction,boundary,limit)
  await scope.finish();return bounded(items)
 }
 async summaries(accountId:string):Promise<Summary[]>{
  const scope=await this.start(accountId),byPerson=new Map([...scope.conversations.values()].filter(r=>r.kind==='direct').map(row=>[row.person_id,row])),items:Summary[]=[]
  const callRows=scope.account.storyStorage.allowed?(await this.pool.query<{id:string;conversation_id:string;version:number;started_at:Date;ended_at:Date}>("SELECT DISTINCT ON(conversation_id) id,conversation_id,version,started_at,ended_at FROM call_sessions WHERE account_id=$1 AND conversation_id=ANY($2::uuid[]) AND state='ended' AND started_at IS NOT NULL AND ended_at IS NOT NULL ORDER BY conversation_id,ended_at DESC,id DESC",[accountId,[...byPerson.values()].map(c=>c.id)])).rows:[],calls=new Map(callRows.map(c=>[c.conversation_id,c]))
  for(const person of scope.people.values()){
   const conversation=byPerson.get(person.id),latest=conversation?(await this.scan(scope,conversation.id,'older',undefined,1))[0]:undefined
   let lastMessage:Summary['lastMessage']=null
   if(latest){const names=latest.gift?.giftSnapshot.name,preview=latest.kind==='photo'?'一张照片':latest.kind==='text'?[...latest.text].slice(0,120).join(''):typeof names==='string'?names:Array.isArray(names)&&typeof names[0]==='string'?names[0]:'礼物';lastMessage={id:latest.id,kind:latest.kind,preview,createdAt:latest.createdAt,author:latest.author}}
   const call=conversation?calls.get(conversation.id):undefined,lastCall=call?{id:call.id,mode:'voice' as const,endedAt:call.ended_at.toISOString(),durationSeconds:Math.floor((call.ended_at.getTime()-call.started_at.getTime())/1000)}:undefined
   if(call){scope.useStory=true;scope.observedCalls.set(call.id,call.version)}
   items.push({kind:'direct',conversationId:conversation?.id??null,personId:person.id,worldId:person.worldId,title:person.displayName,lastMessage,...(lastCall?{lastCall}:{}),lastActivityAt:lastCall&&(!lastMessage||lastCall.endedAt>lastMessage.createdAt)?lastCall.endedAt:lastMessage?.createdAt??null})
  }
  for(const conversation of scope.conversations.values())if(conversation.kind==='gather'){
   const latest=(await this.scan(scope,conversation.id,'older',undefined,1))[0],world=scope.gathers.get(conversation.world_id!)!
   items.push({kind:'gather',conversationId:conversation.id,personId:null,worldId:conversation.world_id!,title:world.world.displayName,lastMessage:latest?{id:latest.id,kind:'text',preview:[...latest.text].slice(0,120).join(''),createdAt:latest.createdAt,author:latest.author}:null,lastActivityAt:latest?.createdAt??null})
  }
  await scope.finish(undefined,true)
  return bounded(items.sort((a,b)=>(b.lastActivityAt??'').localeCompare(a.lastActivityAt??'')||(a.personId??a.conversationId!).localeCompare(b.personId??b.conversationId!)))
 }
 async context(accountId:string,id:string,anchorId:string,limit:number){
  const scope=await this.start(accountId,id),row=(await this.pool.query<MessageRow>('SELECT * FROM messages WHERE account_id=$1 AND conversation_id=$2 AND id=$3 AND removed_at IS NULL',[accountId,id,anchorId])).rows[0]
  if(!row)throw notFound()
  if(row.kind==='text'&&!scope.account.storyStorage.allowed)throw denied()
  const anchor=await scope.observe(row);if(!anchor)throw notFound()
  // Read bounded potential sides before choosing; this supports edge refill and
  // proves whether either continuation exists, including a one-item window.
  const before=await this.scan(scope,id,'older',anchor.sequence,limit),after=await this.scan(scope,id,'newer',anchor.sequence,limit)
  let older=Math.min(before.length,Math.floor((limit-1)/2)),newer=Math.min(after.length,limit-1-older)
  older=Math.min(before.length,limit-1-newer)
  const items=[...before.slice(0,older).reverse(),anchor,...after.slice(0,newer)]
  await scope.finish(anchorId)
  return bounded({anchorMessageId:anchorId,items,before:before.length>older?items[0].sequence:null,after:after.length>newer?items.at(-1)!.sequence:null})
 }
 private candidates(accountId:string,ids:string[],needle:string,gifts:boolean,photos:boolean){
  // SQL filters the entire text history before selecting its newest match.
  // Gift projection text is never treated as current source authority.
  return this.pool.query<MessageRow>(`SELECT * FROM(
   (SELECT DISTINCT ON(conversation_id) * FROM messages WHERE account_id=$1 AND conversation_id=ANY($2::uuid[]) AND removed_at IS NULL AND kind='text' AND strpos(lower(text),$3)>0 ORDER BY conversation_id,sequence DESC)
   UNION ALL
   (SELECT * FROM messages WHERE account_id=$1 AND conversation_id=ANY($2::uuid[]) AND removed_at IS NULL AND kind='gift' AND $4)
   UNION ALL
   (SELECT DISTINCT ON(conversation_id) * FROM messages WHERE account_id=$1 AND conversation_id=ANY($2::uuid[]) AND removed_at IS NULL AND kind='photo' AND $6 ORDER BY conversation_id,sequence DESC)
  ) candidates ORDER BY conversation_id,sequence DESC LIMIT $5`,[accountId,ids,needle,gifts,MAX_SCAN+1,photos])
 }
 async search(accountId:string,needle:string,locale:string){
  const scope=await this.start(accountId,undefined,true),ids=[...scope.conversations.keys()],snapshot=(await this.candidates(accountId,ids,needle,scope.account.giftStorage?.allowed===true,scope.account.chatPhotoStorage?.allowed===true)).rows
  if(snapshot.length>MAX_SCAN)throw tooLarge()
  const matches=new Map<string,Message>()
  for(const row of snapshot){
   const value=await scope.observe(row)
   if(value&&!matches.has(row.conversation_id)&&historyVisibleText(value,locale).toLowerCase().includes(needle))matches.set(row.conversation_id,value)
  }
  const hits:HistorySearchHit[]=[],sources:unknown[]=[]
  for(const [id,value]of matches){
   const conversation=scope.conversations.get(id)!,person=conversation.person_id?scope.people.get(conversation.person_id):undefined,world=conversation.world_id?scope.gathers.get(conversation.world_id):undefined,latest=(await this.scan(scope,id,'older',undefined,1))[0]
   if(!latest)throw changed()
   hits.push({kind:'message',id:value.id,conversationKind:conversation.kind,personId:person?.id??null,...(world?{worldId:world.world.id}:{}),conversationId:id,messageId:value.id,sequence:value.sequence,version:value.version,messageKind:value.kind,title:person?.displayName??world!.world.displayName,excerpt:excerpt(historyVisibleText(value,locale),needle),author:value.author,createdAt:value.createdAt,lastActivityAt:latest.createdAt})
   sources.push({id,latest:latest.id,latestVersion:latest.version,latestGift:latest.gift??null,matchGift:value.gift??null,personVersion:person?.version,personAccessVersion:person?.accessVersion,worldRevision:world?.revision})
  }
  await scope.finish(undefined,true)
  const final=(await this.candidates(accountId,ids,needle,scope.account.giftStorage?.allowed===true,scope.account.chatPhotoStorage?.allowed===true)).rows
  if(digest(snapshot.map(row=>[row.id,row.version]))!==digest(final.map(row=>[row.id,row.version])))throw changed()
  hits.sort((a,b)=>b.lastActivityAt.localeCompare(a.lastActivityAt)||(a.personId??a.conversationId).localeCompare(b.personId??b.conversationId))
  bounded(hits)
  const sourceRefs=[...scope.observed.values()].filter(row=>row.value).map(({row,value})=>({id:row.id,version:row.version,giftVersion:value?.gift?.version??null})).sort((a,b)=>a.id.localeCompare(b.id))
  return{items:hits,revision:digest({hits,sources,sourceRefs,worlds:[...scope.gathers.values()].map(w=>[w.world.id,w.revision]),accessVersion:scope.account.accessVersion,story:scope.account.storyStorage,gift:scope.useGift?scope.account.giftStorage:null,returns:scope.useReturns?scope.account.giftReturns:null,photo:scope.usePhoto?scope.account.chatPhotoStorage:null})}
 }
}
