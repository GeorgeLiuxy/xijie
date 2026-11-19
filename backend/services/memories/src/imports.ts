import {createHash,randomUUID} from 'node:crypto'
import type {PoolClient} from 'pg'
import {MemoryError,invalid,conflict,notFound,uuid} from './contracts.js'
import type {MemoryStore} from './store.js'
export type ImportInput={batchId:string;sourceSha256:string;items:{itemId:string;title:string;body:string}[]}
export type ImportReceipt={batchId:string;personId:string;itemCount:number;items:{itemId:string;memoryId:string;version:number;status:'active'|'removed'}[]}
export function memoryImportInput(body:unknown):ImportInput{
 if(!body||typeof body!=='object'||Array.isArray(body))throw invalid();const v=body as ImportInput
 if(Object.keys(v).some(k=>!['batchId','sourceSha256','items'].includes(k))||typeof v.batchId!=='string'||!uuid.test(v.batchId)||typeof v.sourceSha256!=='string'||!/^[a-f0-9]{64}$/.test(v.sourceSha256)||!Array.isArray(v.items)||v.items.length<1||v.items.length>50)throw invalid()
 const text=(v:unknown,max:number)=>{if(typeof v!=='string'||!v.trim()||[...v.trim()].length>max||v.includes('\0')||/\p{Surrogate}/u.test(v))throw invalid();return v.trim()}
 const items=v.items.map(item=>{if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(k=>!['itemId','title','body'].includes(k))||typeof item.itemId!=='string'||!uuid.test(item.itemId))throw invalid();return {itemId:item.itemId.toLowerCase(),title:text(item.title,120),body:text(item.body,10000)}})
 if(new Set(items.map(v=>v.itemId)).size!==items.length||items.reduce((n,v)=>n+[...v.title].length+[...v.body].length,0)>100000)throw invalid()
 return {batchId:v.batchId.toLowerCase(),sourceSha256:v.sourceSha256,items}
}
export class MemoryImports{
 constructor(readonly store:MemoryStore){}
 private async scope(accountId:string,personId:string){const value=await this.store.access(accountId,personId);if(value.account.accountId!==accountId||value.account.status!=='active'||value.person.accountId!==accountId||value.person.id!==personId||value.person.status!=='active')throw notFound();if([value.person.version,value.person.accessVersion,value.account.accessVersion,value.account.storyStorage.authorizationVersion].some(v=>!Number.isSafeInteger(v)||v<1))throw new MemoryError(503,'DEPENDENCY_UNAVAILABLE','The import destination is unavailable.');return value}
 private same(first:Awaited<ReturnType<MemoryImports['scope']>>,next:Awaited<ReturnType<MemoryImports['scope']>>){return first.person.version===next.person.version&&first.person.accessVersion===next.person.accessVersion&&first.account.accessVersion===next.account.accessVersion&&first.account.storyStorage.authorizationVersion===next.account.storyStorage.authorizationVersion}
 private changed(){return new MemoryError(409,'SOURCE_CHANGED','The import destination changed. Review it and retry.')}
 private async receipt(db:PoolClient,account:string,person:string,batch:string):Promise<ImportReceipt>{const rows=(await db.query<{item_id:string;memory_id:string;version:number;removed_at:Date|null}>(`SELECT i.item_id,i.memory_id,m.version,m.removed_at FROM memory_import_items i JOIN memories m ON m.account_id=i.account_id AND m.person_id=i.person_id AND m.id=i.memory_id WHERE i.account_id=$1 AND i.person_id=$2 AND i.batch_id=$3 ORDER BY m.confirmed_seq`,[account,person,batch])).rows;return {batchId:batch,personId:person,itemCount:rows.length,items:rows.map(r=>({itemId:r.item_id,memoryId:r.memory_id,version:r.version,status:r.removed_at?'removed':'active'}))}}
 async create(accountId:string,personId:string,key:string,expected:number,input:ImportInput,requestId:string=randomUUID()){
  const authority=await this.scope(accountId,personId),hash=createHash('sha256').update(JSON.stringify({personId,expected,input})).digest('hex')
  const after=await this.scope(accountId,personId)
  if(!this.same(authority,after))throw this.changed()
  const db=await this.store.pool.connect()
  try{
   await db.query('BEGIN')
   await db.query('INSERT INTO memory_account_cursors(account_id) VALUES($1) ON CONFLICT DO NOTHING',[accountId]);await db.query('SELECT account_id FROM memory_account_cursors WHERE account_id=$1 FOR UPDATE',[accountId])
   const prior=(await db.query<{id:string;person_id:string;request_hash:string;idempotency_key:string}>('SELECT id,person_id,request_hash,idempotency_key FROM memory_import_batches WHERE account_id=$1 AND (id=$2 OR idempotency_key=$3)',[accountId,input.batchId,key])).rows
   if(prior.length){if(prior.length!==1||prior[0].id!==input.batchId||prior[0].person_id!==personId||prior[0].request_hash!==hash||prior[0].idempotency_key!==key)throw conflict();const receipt=await this.receipt(db,accountId,personId,input.batchId);await db.query('COMMIT');if(!this.same(after,await this.scope(accountId,personId)))throw this.changed();return receipt}
   if(after.person.version!==expected)throw new MemoryError(412,'VERSION_CONFLICT','The person changed. Review the import destination before retrying.')
   const ids=input.items.map(item=>item.itemId)
   if((await db.query('SELECT 1 FROM memories WHERE account_id=$1 AND client_memory_id=ANY($2::uuid[])',[accountId,ids])).rowCount||(await db.query('SELECT 1 FROM memory_import_items WHERE account_id=$1 AND item_id=ANY($2::uuid[])',[accountId,ids])).rowCount)throw conflict()
   await db.query('INSERT INTO memory_import_batches(account_id,id,person_id,idempotency_key,request_hash,source_sha256,person_version,item_count,character_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[accountId,input.batchId,personId,key,hash,input.sourceSha256,expected,input.items.length,input.items.reduce((n,v)=>n+[...v.title].length+[...v.body].length,0)])
   for(const item of input.items){
    const seq=(await db.query<{last_confirmed_seq:string}>('UPDATE memory_account_cursors SET last_confirmed_seq=last_confirmed_seq+1,updated_at=clock_timestamp() WHERE account_id=$1 RETURNING last_confirmed_seq',[accountId])).rows[0].last_confirmed_seq
    const fingerprint=createHash('sha256').update(JSON.stringify({batchId:input.batchId,item})).digest('hex')
    const row=(await db.query<{id:string;version:number;confirmed_at:Date}>(`INSERT INTO memories(account_id,person_id,client_memory_id,request_hash,confirmed_seq,title,body,origin,created_at,confirmed_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'import',statement_timestamp(),statement_timestamp(),statement_timestamp()) RETURNING id,version,confirmed_at`,[accountId,personId,item.itemId,fingerprint,seq,item.title,item.body])).rows[0]
    await db.query('INSERT INTO memory_import_items(account_id,batch_id,person_id,item_id,memory_id) VALUES($1,$2,$3,$4,$5)',[accountId,input.batchId,personId,item.itemId,row.id])
    await db.query("INSERT INTO outbox_events(type,account_id,aggregate_type,aggregate_id,aggregate_version,request_id,payload) VALUES('MemoryConfirmed.v1',$1,'memory',$2,1,$3,$4)",[accountId,row.id,requestId,{memoryId:row.id,personId,version:1,confirmedAt:row.confirmed_at.toISOString(),confirmedSeq:seq,origin:'import',qualifiesForReferral:false,echoAiAuthorizationVersion:0}])
   }
   const receipt=await this.receipt(db,accountId,personId,input.batchId);await db.query('COMMIT');if(!this.same(after,await this.scope(accountId,personId)))throw this.changed();return receipt
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
 }
}
