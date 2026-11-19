import {createHash,randomUUID} from 'node:crypto'
import type {Pool,PoolClient} from 'pg'

export class ReportError extends Error{constructor(readonly status:number,readonly code:string){super(code)}}
export type ReportSubject={subjectType:'message'|'post'|'comment'|'contribution';subjectId:string;containerId:string;ownerAccountId:string;sourceDomain:'conversations'|'social';sourceKind:string;version:number;hash:string}
export interface ReportDependencies{source(accountId:string,type:ReportSubject['subjectType'],id:string):Promise<ReportSubject>;evidence?(accountId:string,type:ReportSubject['subjectType'],id:string):Promise<{source:ReportSubject;text:string}>;restrict(report:any):Promise<{subjectId:string;restricted:true}>}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const invalid=()=>new ReportError(400,'INVALID_ARGUMENT'),missing=()=>new ReportError(404,'NOT_FOUND')
export const reportId=(x:unknown)=>{if(typeof x!=='string'||!uuid.test(x))throw invalid();return x.toLowerCase()}
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex')
export function reportInput(x:unknown){
 if(!x||typeof x!=='object'||Array.isArray(x))throw invalid();const v=x as Record<string,any>
 if(Object.keys(v).some(k=>!['subjectType','subjectId','reason','note'].includes(k))||!['message','post','comment','contribution'].includes(v.subjectType)||!['harmful','privacy','impersonation','spam','other'].includes(v.reason)||v.note!==undefined&&(typeof v.note!=='string'||[...v.note].length>500||/\p{C}/u.test(v.note.replace(/[\n\r\t]/g,'') )))throw invalid()
 return{subjectType:v.subjectType as ReportSubject['subjectType'],subjectId:reportId(v.subjectId),reason:v.reason as string,note:(v.note??'').trim() as string}
}
export function resolutionInput(x:unknown){
 if(!x||typeof x!=='object'||Array.isArray(x))throw invalid();const v=x as Record<string,any>
 if(Object.keys(v).some(k=>!['decision','reasonCode','publicResolution','reviewedSourceVersion','reviewedSourceHash'].includes(k))||!['dismiss','restrict_visibility'].includes(v.decision)||typeof v.reasonCode!=='string'||!/^[a-z][a-z0-9_]{0,79}$/.test(v.reasonCode)||v.publicResolution!==undefined&&(typeof v.publicResolution!=='string'||[...v.publicResolution].length>500||/\p{C}/u.test(v.publicResolution.replace(/[\n\r\t]/g,'') )))throw invalid()
 if((v.reviewedSourceVersion===undefined)!==(v.reviewedSourceHash===undefined)||v.reviewedSourceVersion!==undefined&&(!Number.isSafeInteger(v.reviewedSourceVersion)||v.reviewedSourceVersion<1||typeof v.reviewedSourceHash!=='string'||!/^[a-f0-9]{64}$/.test(v.reviewedSourceHash)))throw invalid()
 return{decision:v.decision as 'dismiss'|'restrict_visibility',reasonCode:v.reasonCode,publicResolution:(v.publicResolution??'').trim() as string,...(v.reviewedSourceVersion!==undefined?{reviewedSourceVersion:v.reviewedSourceVersion as number,reviewedSourceHash:v.reviewedSourceHash as string}:{})}
}
const dto=(r:any)=>({id:r.id,status:r.state,createdAt:r.created_at.toISOString(),version:r.version,...(r.resolved_at?{resolvedAt:r.resolved_at.toISOString(),resolution:r.resolution}: {})})
export class ReportStore{
 constructor(readonly pool:Pool,readonly dependencies:ReportDependencies){}
 private async tx<T>(work:(db:PoolClient)=>Promise<T>){const db=await this.pool.connect();try{await db.query('BEGIN');const result=await work(db);await db.query('COMMIT');return result}catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}}
 private async account(db:Pool|PoolClient,account:string,write=false){if(!(await db.query("SELECT id FROM accounts WHERE id=$1 AND status='active'"+(write?' FOR UPDATE':''),[account])).rowCount)throw missing()}
 private async old(db:Pool|PoolClient,account:string,operation:string,key:string,fingerprint:string){const r=(await db.query('SELECT * FROM content_report_commands WHERE account_id=$1 AND operation=$2 AND idempotency_key=$3',[account,operation,key])).rows[0];if(r&&r.request_hash!==fingerprint)throw new ReportError(409,'IDEMPOTENCY_CONFLICT');return r}
 async create(account:string,key:string,input:ReturnType<typeof reportInput>){
  const fp=hash(input),previous=await this.old(this.pool,account,'create',key,fp);if(previous)return this.read(account,previous.report_id)
  const source=await this.dependencies.source(account,input.subjectType,input.subjectId)
  if(source.subjectType!==input.subjectType||source.subjectId!==input.subjectId||!uuid.test(source.ownerAccountId)||!uuid.test(source.containerId)||!Number.isSafeInteger(source.version)||source.version<1||!/^[a-f0-9]{64}$/.test(source.hash))throw new ReportError(503,'SOURCE_UNAVAILABLE')
  const id=await this.tx(async db=>{
   await this.account(db,account,true);const old=await this.old(db,account,'create',key,fp);if(old)return old.report_id
   if(Number((await db.query("SELECT count(*) AS n FROM content_reports WHERE account_id=$1 AND created_at>clock_timestamp()-interval '1 hour'",[account])).rows[0].n)>=20)throw new ReportError(429,'RATE_LIMITED')
   const id=randomUUID();await db.query('INSERT INTO content_reports(id,account_id,owner_account_id,subject_type,subject_id,container_id,source_domain,source_kind,source_version,source_hash,reason,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[id,account,source.ownerAccountId,input.subjectType,input.subjectId,source.containerId,source.sourceDomain,source.sourceKind,source.version,source.hash,input.reason,input.note])
   await db.query("INSERT INTO content_report_commands(account_id,operation,idempotency_key,request_hash,report_id) VALUES($1,'create',$2,$3,$4)",[account,key,fp,id]);await db.query("INSERT INTO content_report_audit(account_id,report_id,actor,action) VALUES($1,$2,'self','created')",[account,id]);return id
  });return this.read(account,id)
 }
 async read(account:string,id:string){await this.account(this.pool,account);const r=(await this.pool.query('SELECT * FROM content_reports WHERE account_id=$1 AND id=$2',[account,id])).rows[0];if(!r)throw missing();return dto(r)}
 async list(account:string,limit:number,cursor?:string){await this.account(this.pool,account);const rows=(await this.pool.query('SELECT * FROM content_reports WHERE account_id=$1 AND($2::uuid IS NULL OR(created_at,id)<(SELECT created_at,id FROM content_reports WHERE account_id=$1 AND id=$2)) ORDER BY created_at DESC,id DESC LIMIT $3',[account,cursor??null,limit+1])).rows;return{data:rows.slice(0,limit).map(dto),meta:{nextCursor:rows.length>limit?rows[limit-1].id:null}}}
 async operations(status:string|undefined,limit:number,cursor?:string){
  const rows=(await this.pool.query("SELECT id,subject_type,subject_id,reason,state,version,created_at FROM content_reports WHERE ($1::text IS NULL OR state=$1) AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3",[status??null,cursor??null,limit+1])).rows
  return{data:rows.slice(0,limit).map(r=>({id:r.id,subjectType:r.subject_type,subjectId:r.subject_id,reason:r.reason,status:r.state,version:r.version,createdAt:r.created_at.toISOString()})),meta:{nextCursor:rows.length>limit?rows[limit-1].id:null}}
 }
 async resolve(id:string,key:string,version:number,input:ReturnType<typeof resolutionInput>,operator:string){
  if(!/^[a-zA-Z0-9_.-]{1,80}$/.test(operator))throw invalid()
  const current=(await this.pool.query('SELECT * FROM content_reports WHERE id=$1',[id])).rows[0];if(!current)throw missing()
  const fp=hash({id,version,input,operator})
  const previous=await this.old(this.pool,current.account_id,'resolve',key,fp);if(previous)return this.fulfill(id)
  let reviewed:ReportSubject|undefined
  if(input.decision==='restrict_visibility'){
   reviewed=await this.dependencies.source(current.account_id,current.subject_type,current.subject_id)
   if(reviewed.ownerAccountId!==current.owner_account_id||reviewed.containerId!==current.container_id||reviewed.sourceKind!==current.source_kind||reviewed.version!==(input.reviewedSourceVersion??current.source_version)||reviewed.hash!==(input.reviewedSourceHash??current.source_hash))throw new ReportError(412,'SOURCE_CHANGED')
  }
  await this.tx(async db=>{
   await this.account(db,current.account_id,true);const r=(await db.query('SELECT * FROM content_reports WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!r)throw missing()
   const old=await this.old(db,r.account_id,'resolve',key,fp);if(old)return
   if(r.recovery_blocked)throw new ReportError(409,'RESTORE_REVIEW_REQUIRED')
   if(r.version!==version)throw new ReportError(412,'VERSION_CONFLICT')
   if(r.state!=='open'&&!(r.state==='reviewing'&&reviewed&&input.reviewedSourceVersion!==undefined&&reviewed.version>r.source_version))throw new ReportError(409,'REPORT_ALREADY_REVIEWING')
   await db.query("INSERT INTO content_report_commands(account_id,operation,idempotency_key,request_hash,report_id) VALUES($1,'resolve',$2,$3,$4)",[r.account_id,key,fp,id])
   await db.query("UPDATE content_reports SET state='reviewing',decision=$2,reason_code=$3,resolution=$4,reviewer_id=$5,action_key=$6,source_version=$7,source_hash=$8,version=version+1,updated_at=clock_timestamp() WHERE id=$1",[id,input.decision,input.reasonCode,input.publicResolution,operator,key,reviewed?.version??r.source_version,reviewed?.hash??r.source_hash]);await db.query("INSERT INTO content_report_audit(account_id,report_id,actor,action,reason_code) VALUES($1,$2,$3,'reviewing',$4)",[r.account_id,id,operator,input.reasonCode])
  })
  return this.fulfill(id)
 }
 async fulfill(id:string){
  const r=(await this.pool.query('SELECT * FROM content_reports WHERE id=$1',[id])).rows[0];if(!r)throw missing();if(r.state==='resolved')return dto(r);if(r.state!=='reviewing'||r.recovery_blocked)throw new ReportError(409,'RESTORE_REVIEW_REQUIRED')
  if(r.decision==='restrict_visibility'){
   const value=await this.dependencies.restrict(r);if(value.subjectId!==r.subject_id||value.restricted!==true)throw new ReportError(503,'SOURCE_UNAVAILABLE')
  }
  return this.tx(async db=>{await this.account(db,r.account_id,true);const latest=(await db.query('SELECT * FROM content_reports WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!latest)throw missing();if(latest.state==='resolved')return dto(latest);if(latest.action_key!==r.action_key||latest.recovery_blocked)throw new ReportError(409,'RESTORE_REVIEW_REQUIRED')
   const result=(await db.query("UPDATE content_reports SET state='resolved',resolved_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE id=$1 RETURNING *",[id])).rows[0];await db.query("INSERT INTO content_report_audit(account_id,report_id,actor,action,reason_code) VALUES($1,$2,$3,'resolved',$4)",[r.account_id,id,r.reviewer_id,r.reason_code]);return dto(result)})
 }
 async reconcile(){const rows=(await this.pool.query("SELECT id FROM content_reports WHERE state='reviewing' AND NOT recovery_blocked ORDER BY updated_at,id LIMIT 20")).rows;for(const r of rows)try{await this.fulfill(r.id)}catch{await this.pool.query("UPDATE content_reports SET updated_at=clock_timestamp() WHERE id=$1 AND state='reviewing'",[r.id])}}
 async evidence(id:string,operator:string){
  const r=(await this.pool.query('SELECT * FROM content_reports WHERE id=$1',[id])).rows[0];if(!r)throw missing()
  await this.tx(async db=>{await this.account(db,r.account_id,true);await db.query("INSERT INTO content_report_audit(account_id,report_id,actor,action) VALUES($1,$2,$3,'evidence_read')",[r.account_id,id,operator])})
  if(!this.dependencies.evidence)throw new ReportError(503,'SOURCE_UNAVAILABLE')
  const evidence=await this.dependencies.evidence(r.account_id,r.subject_type,r.subject_id)
  if(evidence.source.subjectId!==r.subject_id||evidence.source.ownerAccountId!==r.owner_account_id||typeof evidence.text!=='string'||evidence.text.length>12000)throw new ReportError(503,'SOURCE_UNAVAILABLE')
  return{reportId:id,version:r.version,reason:r.reason,note:r.note,sourceVersion:evidence.source.version,sourceHash:evidence.source.hash,text:evidence.text}
 }
}
export async function exportReports(db:PoolClient,account:string){return{contentReports:(await db.query('SELECT id,subject_type AS "subjectType",subject_id AS "subjectId",reason,note,state AS status,resolution,created_at AS "createdAt",resolved_at AS "resolvedAt" FROM content_reports WHERE account_id=$1 ORDER BY created_at,id',[account])).rows}}
export async function eraseReports(db:PoolClient,account:string){await db.query('DELETE FROM content_reports WHERE account_id=$1 OR owner_account_id=$1',[account])}
