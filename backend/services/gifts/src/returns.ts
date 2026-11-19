import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {GiftsStore} from './store.js';
import {GiftsError,hash,missing,receivedDto,notificationDto,displayable,type Account,type ReceivedRow,type NotificationRow,type ReturnContext,type GiftDefinition,type DeliveryRow} from './contracts.js';
import type {ReturnGenerationProvider} from './return-provider.js';

type ReturnJob={id:string;account_id:string;source_delivery_id:string;source_delivery_version:number;account_access_version:number;gift_authorization_version:number;story_authorization_version:number;return_authorization_version:number;policy_version:string;attempt_id:string;attempt_count:number};
type ProjectionJob={id:string;account_id:string;received_gift_id:string;received_version:number;attempt_id:string};
const silentSource=(error:unknown)=>error instanceof GiftsError&&[403,404,409].includes(error.status);
const versionConflict=()=>new GiftsError(412,'VERSION_CONFLICT');
const validPermission=(p:Account['giftReturns'])=>p?.allowed===true&&Number.isSafeInteger(p.authorizationVersion)&&p.authorizationVersion>0;

export class GiftReturnsStore{
 constructor(readonly store:GiftsStore,readonly provider?:ReturnGenerationProvider){}
 async authority(account:string){const a=await this.store.dependencies.account(account);if(!validPermission(a.giftStorage)||!validPermission(a.storyStorage)||!validPermission(a.giftReturns))throw new GiftsError(403,'GIFT_RETURN_PERMISSION_REQUIRED');return a;}
 same(a:Account,b:Account){if(a.accessVersion!==b.accessVersion||!validPermission(b.giftStorage)||!validPermission(b.storyStorage)||!validPermission(b.giftReturns)||a.giftStorage!.authorizationVersion!==b.giftStorage!.authorizationVersion||a.storyStorage!.authorizationVersion!==b.storyStorage!.authorizationVersion||a.giftReturns!.authorizationVersion!==b.giftReturns!.authorizationVersion)throw new GiftsError(409,'AUTHORIZATION_CHANGED');}
 matches(a:Account,r:{account_access_version:number;gift_authorization_version:number;story_authorization_version:number;return_authorization_version:number}){return a.accessVersion===r.account_access_version&&a.giftStorage?.authorizationVersion===r.gift_authorization_version&&a.storyStorage?.authorizationVersion===r.story_authorization_version&&a.giftReturns?.authorizationVersion===r.return_authorization_version;}
 async row(account:string,id:string,db=this.store.pool as Pick<PoolClient,'query'>):Promise<ReceivedRow>{const r=(await db.query('SELECT r.* FROM received_gifts r JOIN gifts_account_write_gates g ON g.account_id=r.account_id WHERE r.account_id=$1 AND r.id=$2 AND g.erased_at IS NULL',[account,id])).rows[0];if(!r)throw missing();return r;}
 async visible(a:Account,r:ReceivedRow){if(!this.matches(a,r))throw missing();const source=await this.store.row(a.accountId,r.source_delivery_id);if(source.status!=='arrived'||source.person_id!==r.person_id||source.conversation_id!==r.conversation_id||source.gift_authorization_version!==r.gift_authorization_version||source.return_authorization_version!==r.return_authorization_version||source.story_authorization_version!==r.story_authorization_version)throw missing();await this.store.dependencies.person(a.accountId,r.person_id);}
 async get(account:string,id:string){const a=await this.authority(account),r=await this.row(account,id);await this.visible(a,r);this.same(a,await this.authority(account));return receivedDto(r);}
 async list(account:string,limit:number,filter:{personId?:string;placement?:string;cursor?:string}){
  const a=await this.authority(account);if(filter.personId)await this.store.dependencies.person(account,filter.personId);
  const items=[];let cursor=filter.cursor;const batch=Math.min(100,Math.max(limit+1,40));
  while(items.length<=limit){
   const rows=(await this.store.pool.query<ReceivedRow>(`SELECT r.* FROM received_gifts r JOIN gifts_account_write_gates g ON g.account_id=r.account_id WHERE r.account_id=$1 AND g.erased_at IS NULL AND($2::uuid IS NULL OR r.person_id=$2) AND($3::text IS NULL OR r.placement=$3) AND($4::uuid IS NULL OR(r.created_at,r.id)<(SELECT created_at,id FROM received_gifts WHERE account_id=$1 AND id=$4)) ORDER BY r.created_at DESC,r.id DESC LIMIT $5`,[account,filter.personId??null,filter.placement??null,cursor??null,batch])).rows;
   for(const r of rows){try{await this.visible(a,r);items.push(receivedDto(r));if(items.length>limit)break;}catch(e){if(!silentSource(e))throw e;}}
   if(rows.length<batch||items.length>limit)break;cursor=rows.at(-1)!.id;
  }
  this.same(a,await this.authority(account));return{items:items.slice(0,limit),next:items.length>limit?items[limit-1].id:null};
 }
 async projectJob(db:PoolClient,r:ReceivedRow){await db.query('INSERT INTO gift_received_projection_jobs(id,account_id,received_gift_id,received_version) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[randomUUID(),r.account_id,r.id,r.version]);}
 private async receipt(db:PoolClient,account:string,key:string,fp:string){const r=(await db.query('SELECT * FROM gift_mutation_receipts WHERE account_id=$1 AND acceptance_key=$2',[account,key])).rows[0];if(r&&r.request_hash!==fp)throw new GiftsError(409,'IDEMPOTENCY_CONFLICT');return r;}
 private async saveReceipt(db:PoolClient,account:string,key:string,kind:string,id:string,fp:string,expected:number|null,version:number){await db.query('INSERT INTO gift_mutation_receipts(account_id,acceptance_key,kind,resource_id,request_hash,expected_version,result_version) VALUES($1,$2,$3,$4,$5,$6,$7)',[account,key,kind,id,fp,expected,version]);}
 async mutate(account:string,id:string,key:string,kind:'open'|'placement',placement?:'record'|'space',expected?:number){
  const a=await this.authority(account),before=await this.row(account,id);await this.visible(a,before);this.same(a,await this.authority(account));
  const fp=hash(JSON.stringify({kind,id,placement:placement??null,expected:expected??null}));
  const result=await this.store.tx(account,async db=>{
   const prior=await this.receipt(db,account,key,fp),r=await this.row(account,id,db);if(prior)return{row:r,acceptedVersion:prior.result_version,replayed:true};
   if(!this.matches(a,r))throw missing();if(kind==='placement'&&r.version!==expected)throw versionConflict();
   if(kind==='placement'&&!r.opened_at)throw new GiftsError(409,'GIFT_NOT_OPENED');
   if(placement==='space'&&(!r.gift_snapshot.available||!displayable(r.gift_snapshot)))throw new GiftsError(422,'GIFT_NOT_DISPLAYABLE');
   let changed=r;
   if(kind==='open'&&!r.opened_at)changed=(await db.query("UPDATE received_gifts SET opened_at=clock_timestamp(),placement='record',version=version+1,updated_at=clock_timestamp() WHERE account_id=$1 AND id=$2 RETURNING *",[account,id])).rows[0];
   if(kind==='placement'&&r.placement!==placement)changed=(await db.query('UPDATE received_gifts SET placement=$3,version=version+1,updated_at=clock_timestamp() WHERE account_id=$1 AND id=$2 RETURNING *',[account,id,placement])).rows[0];
   if(changed.version!==r.version){await this.projectJob(db,changed);await this.store.event(db,account,kind==='open'?'ReceivedGiftOpened.v1':'ReceivedGiftPlacementChanged.v1',id,changed.version,{receivedGiftId:id});}
   await this.saveReceipt(db,account,key,kind,id,fp,expected??null,changed.version);return{row:changed,acceptedVersion:changed.version,replayed:false};
  });this.same(a,await this.authority(account));await this.visible(a,result.row);return{data:receivedDto(result.row),meta:{acceptedVersion:result.acceptedVersion,replayed:result.replayed}};
 }
 async notificationRow(account:string,id:string,db=this.store.pool as Pick<PoolClient,'query'>):Promise<NotificationRow>{const r=(await db.query('SELECT n.* FROM gift_notifications n JOIN gifts_account_write_gates g ON g.account_id=n.account_id WHERE n.account_id=$1 AND n.id=$2 AND g.erased_at IS NULL',[account,id])).rows[0];if(!r)throw missing();return r;}
 async notificationVisible(account:string,r:NotificationRow){if(r.object_kind==='received_gift')await this.get(account,r.object_id);else await this.store.get(account,r.object_id);}
 async notifications(account:string,limit:number,filter:{cursor?:string;unread?:boolean;type?:string}){
  const a=await this.store.authority(account),rows=(await this.store.pool.query<NotificationRow>('SELECT n.* FROM gift_notifications n JOIN gifts_account_write_gates g ON g.account_id=n.account_id WHERE n.account_id=$1 AND g.erased_at IS NULL ORDER BY n.created_at DESC,n.id DESC',[account])).rows;
  let visible:NotificationRow[]=[];for(const r of rows){try{await this.notificationVisible(account,r);visible.push(r);}catch(e){if(!silentSource(e))throw e;}}
  const after=await this.store.authority(account);this.store.same(a,after);
  if(!validPermission(after.storyStorage)||!validPermission(after.giftReturns)||a.storyStorage?.authorizationVersion!==after.storyStorage?.authorizationVersion||a.giftReturns?.authorizationVersion!==after.giftReturns?.authorizationVersion)visible=visible.filter(r=>r.object_kind!=='received_gift');
  const cursor=filter.cursor?rows.find(r=>r.id===filter.cursor):undefined;if(filter.cursor&&!cursor)throw missing();
  const matching=visible.filter(r=>(filter.type===undefined||r.type===filter.type)&&(filter.unread===undefined||(r.read_at===null)===filter.unread));
  const page=matching.filter(r=>!cursor||r.created_at<cursor.created_at||r.created_at.getTime()===cursor.created_at.getTime()&&r.id<cursor.id).slice(0,limit+1);
  return{data:page.slice(0,limit).map(notificationDto),meta:{nextCursor:page.length>limit?page[limit-1].id:null,totalCount:visible.length,unreadCount:visible.filter(r=>!r.read_at).length}};
 }
 async readNotification(account:string,id:string,key:string,expected:number){
  const a=await this.store.authority(account),before=await this.notificationRow(account,id);await this.notificationVisible(account,before);this.store.same(a,await this.store.authority(account));
  const fp=hash(JSON.stringify({kind:'read',id,expected}));const result=await this.store.tx(account,async db=>{
   const prior=await this.receipt(db,account,key,fp),r=await this.notificationRow(account,id,db);if(prior)return{row:r,replayed:true,acceptedVersion:prior.result_version};
   if(r.version!==expected)throw versionConflict();const changed=r.read_at?r:(await db.query('UPDATE gift_notifications SET read_at=clock_timestamp(),version=version+1 WHERE account_id=$1 AND id=$2 RETURNING *',[account,id])).rows[0];
   await this.saveReceipt(db,account,key,'read',id,fp,expected,changed.version);return{row:changed,replayed:false,acceptedVersion:changed.version};
  });this.store.same(a,await this.store.authority(account));await this.notificationVisible(account,result.row);return{data:notificationDto(result.row),meta:{acceptedVersion:result.acceptedVersion,replayed:result.replayed}};
 }
 async claim():Promise<ReturnJob|undefined>{if(!this.store.options.returnEnabled)return;return(await this.store.pool.query("WITH exhausted AS(UPDATE gift_return_jobs j SET state='blocked',attempt_id=NULL,lease_until=NULL,finished_at=clock_timestamp(),updated_at=clock_timestamp(),version=j.version+1,failure_code='MODEL_RETRY_EXHAUSTED' FROM gifts_account_write_gates g WHERE g.account_id=j.account_id AND g.erased_at IS NULL AND j.attempt_count>=3 AND(j.state IN('queued','failed') OR j.state='running' AND j.lease_until<=clock_timestamp()) RETURNING j.id),candidate AS(SELECT j.id FROM gift_return_jobs j JOIN gifts_account_write_gates g ON g.account_id=j.account_id WHERE g.erased_at IS NULL AND j.attempt_count<3 AND((j.state IN('queued','failed') AND j.retry_at<=clock_timestamp()) OR(j.state='running' AND j.lease_until<=clock_timestamp())) ORDER BY j.retry_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1) UPDATE gift_return_jobs j SET state='running',attempt_id=$1,attempt_count=attempt_count+1,lease_until=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp(),version=version+1 FROM candidate c WHERE j.id=c.id RETURNING j.*",[randomUUID()])).rows[0];}
 private async currentJob(db:PoolClient,j:ReturnJob){return(await db.query("SELECT * FROM gift_return_jobs WHERE id=$1 AND account_id=$2 AND attempt_id=$3 AND state='running' AND lease_until>clock_timestamp() FOR UPDATE",[j.id,j.account_id,j.attempt_id])).rows[0];}
 private async generationContext(j:ReturnJob){
  const a=await this.authority(j.account_id);if(!this.matches(a,j))throw new GiftsError(409,'AUTHORIZATION_CHANGED');const d=await this.store.row(j.account_id,j.source_delivery_id);
  if(d.status!=='arrived'||d.version!==j.source_delivery_version||d.return_authorization_version!==j.return_authorization_version||d.story_authorization_version!==j.story_authorization_version||d.gift_authorization_version!==j.gift_authorization_version)throw missing();
  const c=await this.store.dependencies.returnContext(j.account_id,d.person_id,j.return_authorization_version,j.story_authorization_version),p=c.person;
  if(c.accountAccessVersion!==j.account_access_version||p.accessVersion!==d.person_snapshot.accessVersion||p.version!==d.person_snapshot.version||p.worldVersion!==d.person_snapshot.worldVersion||p.worldId!==d.person_snapshot.worldId)throw new GiftsError(409,'SOURCE_CHANGED');
  this.same(a,await this.authority(j.account_id));return{account:a,delivery:d,context:c};
 }
 private sameContext(a:ReturnContext,b:ReturnContext){if(JSON.stringify(a)!==JSON.stringify(b))throw new GiftsError(409,'SOURCE_CHANGED');}
 private async allowedGifts(){return(await this.store.pool.query('SELECT snapshot FROM gift_catalog_items WHERE (snapshot->>\'available\')::boolean ORDER BY id')).rows.map(r=>r.snapshot as GiftDefinition).filter(g=>g.audience.includes('person')&&['keepsake','prop'].includes(g.effect));}
 async run(j:ReturnJob){
  try{
   if(!this.provider||!this.store.options.returnEnabled)throw new GiftsError(403,'GIFT_RETURN_PERMISSION_REQUIRED');
   const initial=await this.generationContext(j),allowedGifts=await this.allowedGifts();
   const ready=await this.store.tx(j.account_id,async db=>{if(!await this.currentJob(db,j))return false;await db.query('UPDATE gift_return_jobs SET person_context=$3,updated_at=clock_timestamp() WHERE id=$1 AND attempt_id=$2',[j.id,j.attempt_id,initial.context]);return true;});if(!ready)return;
   const before=await this.generationContext(j);this.sameContext(initial.context,before.context);
   const result=await this.provider.generate({accountId:j.account_id,jobId:j.id,attemptId:j.attempt_id,authorizationVersion:j.return_authorization_version,giftReturns:before.account.giftReturns!,sourceDelivery:{id:before.delivery.id,giftSnapshot:before.delivery.gift_snapshot,quantity:before.delivery.quantity,note:before.delivery.note},person:before.context.person,allowedGifts,signal:AbortSignal.timeout(40000)});
   const after=await this.generationContext(j);this.sameContext(before.context,after.context);
   const selected=result.decision==='gift'?allowedGifts.find(g=>g.id===result.giftId):undefined;
   if(result.decision!=='none'&&(result.decision!=='gift'||!selected||typeof result.note!=='string'||[...result.note].length>120||result.note.includes('\0')||/\p{Surrogate}/u.test(result.note)))throw new GiftsError(422,'MODEL_INVALID_OUTPUT');
   await this.store.tx(j.account_id,async db=>{
    if(!await this.currentJob(db,j))return;const source=await this.store.row(j.account_id,j.source_delivery_id,db);if(source.status!=='arrived'||source.version!==j.source_delivery_version)throw missing();
    if(selected){const catalog=(await db.query('SELECT * FROM gift_catalog_items WHERE id=$1 FOR SHARE',[selected.id])).rows[0];if(!catalog||catalog.version!==selected.version||JSON.stringify(catalog.snapshot)!==JSON.stringify(selected))throw new GiftsError(409,'CATALOG_VERSION_CHANGED');
     const {accountId,status,relationship,calledMe,story,...snapshot}=after.context.person;
     const r=(await db.query("INSERT INTO received_gifts(id,account_id,source_delivery_id,generation_job_id,person_id,conversation_id,person_snapshot,gift_snapshot,note,policy_version,account_access_version,gift_authorization_version,story_authorization_version,return_authorization_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(account_id,source_delivery_id) DO NOTHING RETURNING *",[randomUUID(),j.account_id,source.id,j.id,source.person_id,source.conversation_id,snapshot,selected,result.decision==='gift'?result.note:'',j.policy_version,j.account_access_version,j.gift_authorization_version,j.story_authorization_version,j.return_authorization_version])).rows[0];
     if(r){const event=await this.store.event(db,j.account_id,'PersonaGiftReceived.v1',r.id,1,{receivedGiftId:r.id,personId:r.person_id,conversationId:r.conversation_id,sourceDeliveryId:r.source_delivery_id,receivedAt:r.created_at.toISOString()});await db.query("INSERT INTO gift_notifications(id,account_id,type,source_event_id,object_id,person_id,object_kind) VALUES($1,$2,'gift_received',$3,$4,$5,'received_gift') ON CONFLICT DO NOTHING",[randomUUID(),j.account_id,event,r.id,r.person_id]);await this.projectJob(db,r);}
    }
    await db.query("UPDATE gift_return_jobs SET state='succeeded',decision=$3,provider_provenance=$4,attempt_id=NULL,lease_until=NULL,finished_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1,failure_code=NULL WHERE id=$1 AND attempt_id=$2",[j.id,j.attempt_id,result.decision,result.provenance]);
   });
   const committed=await this.generationContext(j);this.sameContext(after.context,committed.context);
  }catch(e){await this.fail('gift_return_jobs',j,e);}
 }
 private async fail(table:'gift_return_jobs'|'gift_received_projection_jobs',j:{id:string;account_id:string;attempt_id:string},e:unknown){
  const code=e instanceof GiftsError?e.code:e&&typeof e==='object'&&'code'in e?String(e.code):'DEPENDENCY_UNAVAILABLE';
  const permanent=silentSource(e)||e instanceof GiftsError&&e.status===422||e&&typeof e==='object'&&('blocked'in e&&e.blocked===true||'retryable'in e&&e.retryable===false);
  const exhausted=table==='gift_return_jobs'?'j.attempt_count>=3':'false';
  await this.store.pool.query(`UPDATE ${table} j SET state=CASE WHEN $3='blocked' OR ${exhausted} THEN 'blocked' ELSE 'failed' END,attempt_id=NULL,lease_until=NULL,retry_at=clock_timestamp()+interval '10 seconds',finished_at=CASE WHEN $3='blocked' OR ${exhausted} THEN clock_timestamp() ELSE NULL END,updated_at=clock_timestamp(),version=j.version+1,failure_code=CASE WHEN $3<>'blocked' AND ${exhausted} THEN 'MODEL_RETRY_EXHAUSTED' ELSE $4 END FROM gifts_account_write_gates g WHERE g.account_id=j.account_id AND g.erased_at IS NULL AND j.id=$1 AND j.attempt_id=$2 AND j.state='running'`,[j.id,j.attempt_id,permanent?'blocked':'failed',code]).catch(()=>{});
 }
 async claimProjection():Promise<ProjectionJob|undefined>{return(await this.store.pool.query("WITH candidate AS(SELECT j.id FROM gift_received_projection_jobs j JOIN gifts_account_write_gates g ON g.account_id=j.account_id WHERE g.erased_at IS NULL AND((j.state IN('queued','failed') AND j.retry_at<=clock_timestamp()) OR(j.state='running' AND j.lease_until<=clock_timestamp())) ORDER BY j.retry_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1) UPDATE gift_received_projection_jobs j SET state='running',attempt_id=$1,attempt_count=attempt_count+1,lease_until=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp(),version=version+1 FROM candidate c WHERE j.id=c.id RETURNING j.*",[randomUUID()])).rows[0];}
 async runProjection(j:ProjectionJob){try{const r=await this.get(j.account_id,j.received_gift_id);await this.store.dependencies.projectReceived(j.account_id,r);await this.store.tx(j.account_id,async db=>{await db.query("UPDATE gift_received_projection_jobs SET state='succeeded',attempt_id=NULL,lease_until=NULL,finished_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE id=$1 AND attempt_id=$2 AND state='running' AND lease_until>clock_timestamp()",[j.id,j.attempt_id]);});}catch(e){await this.fail('gift_received_projection_jobs',j,e);}}
}
