import {createHash,randomUUID} from 'node:crypto'
import type {Pool,PoolClient} from 'pg'
import {invalid,notFound,PeopleError} from './contracts.js'
import {resolveActiveAccount} from './session.js'
import type {PeopleConfig} from './config.js'

export type ReminderGrant={allowed:boolean;authorizationVersion:number}
export type ReminderSetting={personId:string;enabled:boolean;timeZone:string|null;version:number}
export type ReminderNotice={id:string;personId:string;personName:string;kind:'birthday'|'meeting_anniversary';localDate:string;createdAt:string;readAt:string|null;version:number}
type SettingRow={account_id:string;person_id:string;enabled:boolean;time_zone:string|null;authorization_version:number|null;version:number;next_check_at:Date|null}
type NoticeRow={id:string;person_id:string;display_name:string;kind:ReminderNotice['kind'];local_date:string;created_at:Date;read_at:Date|null;version:number}
const conflict=(v:number)=>new PeopleError(412,'VERSION_CONFLICT','The reminder has changed.',{currentVersion:v})
export function reminderInput(body:unknown){
 if(!body||typeof body!=='object'||Array.isArray(body))throw invalid()
 const v=body as Record<string,unknown>
 if(Object.keys(v).some(k=>k!=='enabled'&&k!=='timeZone')||typeof v.enabled!=='boolean'||v.timeZone!==undefined&&(typeof v.timeZone!=='string'||v.timeZone.length>100||!v.timeZone))throw invalid()
 if(v.timeZone!==undefined){try{new Intl.DateTimeFormat('en',{timeZone:v.timeZone as string})}catch{throw invalid()}}
 return {enabled:v.enabled,...(v.timeZone===undefined?{}:{timeZone:v.timeZone as string})}
}
export async function reminderAccount(config:PeopleConfig,id:string):Promise<ReminderGrant>{
 const account=await resolveActiveAccount(config,id,randomUUID()) as {storyStorage?:ReminderGrant}
 const grant=account.storyStorage
 if(!grant||typeof grant.allowed!=='boolean'||!Number.isSafeInteger(grant.authorizationVersion)||grant.authorizationVersion<(grant.allowed?1:0))throw new PeopleError(503,'SERVICE_UNAVAILABLE','The account service is temporarily unavailable.')
 return grant
}
export class ReminderStore{
 constructor(readonly pool:Pool){}
 private setting(row:SettingRow|undefined,personId:string,grant:ReminderGrant):ReminderSetting{return {personId,enabled:!!row?.enabled&&grant.allowed&&row.authorization_version===grant.authorizationVersion,timeZone:row?.time_zone??null,version:row?.version??1}}
 private async person(db:Pool|PoolClient,account:string,id:string,lock=false){const p=(await db.query(`SELECT id FROM persons WHERE account_id=$1 AND id=$2 AND status='active' AND NOT EXISTS(SELECT 1 FROM account_erasure_fences WHERE account_id=$1 AND erased_at IS NOT NULL)${lock?' FOR UPDATE':''}`,[account,id])).rows[0];if(!p)throw notFound()}
 async get(account:string,id:string,grant:ReminderGrant){await this.person(this.pool,account,id);return this.setting((await this.pool.query<SettingRow>('SELECT * FROM person_reminder_settings WHERE account_id=$1 AND person_id=$2',[account,id])).rows[0],id,grant)}
 private async write<T>(account:string,fn:(db:PoolClient)=>Promise<T>){const db=await this.pool.connect();try{await db.query('BEGIN');await db.query("SELECT pg_advisory_xact_lock(hashtextextended('xijie:people:erasure:'||$1,0))",[account]);if((await db.query('SELECT 1 FROM account_erasure_fences WHERE account_id=$1 AND erased_at IS NOT NULL',[account])).rowCount)throw notFound();const result=await fn(db);await db.query('COMMIT');return result}catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}}
 private async replay(db:PoolClient,account:string,key:string,body:unknown){const hash=createHash('sha256').update(JSON.stringify(body)).digest('hex'),row=(await db.query<{request_hash:string}>('SELECT request_hash FROM person_reminder_commands WHERE account_id=$1 AND idempotency_key=$2',[account,key])).rows[0];if(row&&row.request_hash!==hash)throw new PeopleError(409,'IDEMPOTENCY_CONFLICT','This key belongs to another change.');return {hash,exists:!!row}}
 async update(account:string,id:string,grant:ReminderGrant,key:string,version:number,input:ReturnType<typeof reminderInput>){
  return this.write(account,async db=>{
   await this.person(db,account,id,true);const command=await this.replay(db,account,key,{operation:'setting',id,version,input})
   const current=(await db.query<SettingRow>('SELECT * FROM person_reminder_settings WHERE account_id=$1 AND person_id=$2 FOR UPDATE',[account,id])).rows[0]
   if(command.exists)return this.setting(current,id,grant)
   if(version!==(current?.version??1))throw conflict(current?.version??1)
   if(input.enabled&&!grant.allowed)throw new PeopleError(403,'STORAGE_PERMISSION_REQUIRED','Permission to store a private story is required.')
   if(current?.time_zone&&input.timeZone!==undefined&&input.timeZone!==current.time_zone)throw new PeopleError(409,'TIME_ZONE_FROZEN','This reminder retains the time zone chosen when it was enabled.')
   const zone=current?.time_zone??input.timeZone??null
   if(!current?.time_zone&&!input.enabled&&input.timeZone!==undefined)throw invalid()
   if(input.enabled&&!zone)throw invalid()
   if(zone&&!(await db.query("SELECT 1 FROM pg_timezone_names WHERE name=$1 AND (name='UTC' OR name LIKE '%/%') AND name NOT LIKE 'posix/%' AND name NOT LIKE 'right/%'",[zone])).rowCount)throw invalid()
   const updated=(await db.query<SettingRow>(`INSERT INTO person_reminder_settings(account_id,person_id,enabled,time_zone,authorization_version,version,next_check_at) VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $3 THEN clock_timestamp() ELSE NULL END) ON CONFLICT(account_id,person_id) DO UPDATE SET enabled=EXCLUDED.enabled,time_zone=EXCLUDED.time_zone,authorization_version=EXCLUDED.authorization_version,version=EXCLUDED.version,next_check_at=EXCLUDED.next_check_at,updated_at=clock_timestamp() RETURNING *`,[account,id,input.enabled,zone,grant.allowed?grant.authorizationVersion:null,version+1])).rows[0]
   await db.query('INSERT INTO person_reminder_commands(account_id,idempotency_key,request_hash) VALUES($1,$2,$3)',[account,key,command.hash]);return this.setting(updated,id,grant)
  })
 }
 private notice(v:NoticeRow):ReminderNotice{return {id:v.id,personId:v.person_id,personName:v.display_name,kind:v.kind,localDate:v.local_date,createdAt:v.created_at.toISOString(),readAt:v.read_at?.toISOString()??null,version:v.version}}
 async list(account:string,grant:ReminderGrant,limit:number,after?:{createdAt:string;id:string}){
  if(!grant.allowed)return []
  const rows=(await this.pool.query<NoticeRow>(`SELECT n.*,n.local_date::text,p.display_name FROM person_reminder_notifications n JOIN persons p ON p.account_id=n.account_id AND p.id=n.person_id WHERE n.account_id=$1 AND p.status='active' AND n.authorization_version=$2 AND NOT EXISTS(SELECT 1 FROM account_erasure_fences WHERE account_id=$1 AND erased_at IS NOT NULL) AND ($3::timestamptz IS NULL OR (n.created_at,n.id)<($3,$4::uuid)) ORDER BY n.created_at DESC,n.id DESC LIMIT $5`,[account,grant.authorizationVersion,after?.createdAt??null,after?.id??null,limit])).rows;return rows.map(v=>this.notice(v))
 }
 async read(account:string,id:string,grant:ReminderGrant,key:string,version:number){
  return this.write(account,async db=>{
   if(!grant.allowed)throw notFound()
   const row=(await db.query<NoticeRow>(`SELECT n.*,n.local_date::text,p.display_name FROM person_reminder_notifications n JOIN persons p ON p.account_id=n.account_id AND p.id=n.person_id WHERE n.account_id=$1 AND n.id=$2 AND n.authorization_version=$3 AND p.status='active' FOR UPDATE OF n`,[account,id,grant.authorizationVersion])).rows[0];if(!row)throw notFound()
   const command=await this.replay(db,account,key,{operation:'read',id,version})
   if(command.exists)return this.notice(row)
   if(row.version!==version)throw conflict(row.version)
   if(!row.read_at){const saved=(await db.query<NoticeRow>('UPDATE person_reminder_notifications SET read_at=GREATEST(created_at,clock_timestamp()),version=version+1 WHERE account_id=$1 AND id=$2 RETURNING *,local_date::text',[account,id])).rows[0];Object.assign(row,saved)}
   await db.query('INSERT INTO person_reminder_commands(account_id,idempotency_key,request_hash) VALUES($1,$2,$3)',[account,key,command.hash]);return this.notice(row)
  })
 }
 // A persisted next check and yearly unique receipt make crash/restart and two
 // workers safe. Missed days are not retrospectively invented as new reminders.
 async tick(resolve:(account:string)=>Promise<ReminderGrant>,limit=100,at?:Date){
  const now=at??(await this.pool.query<{at:Date}>('SELECT clock_timestamp() AS at')).rows[0].at
  const due=(await this.pool.query<SettingRow>(`SELECT s.* FROM person_reminder_settings s JOIN persons p ON p.account_id=s.account_id AND p.id=s.person_id WHERE s.enabled AND s.next_check_at<=$1 AND p.status='active' ORDER BY s.next_check_at,s.account_id,s.person_id LIMIT $2`,[now,limit])).rows
  let made=0
  for(const source of due){
   let grant:ReminderGrant;try{grant=await resolve(source.account_id)}catch(error){if(error instanceof PeopleError&&error.status===404)grant={allowed:false,authorizationVersion:0};else continue}
   made+=await this.write(source.account_id,async db=>{
    await this.person(db,source.account_id,source.person_id,true)
    const current=(await db.query<SettingRow>('SELECT * FROM person_reminder_settings WHERE account_id=$1 AND person_id=$2 FOR UPDATE',[source.account_id,source.person_id])).rows[0]
    if(!current?.enabled||current.version!==source.version||!current.next_check_at||current.next_check_at>now)return 0
    if(!grant.allowed||current.authorization_version!==grant.authorizationVersion){await db.query('UPDATE person_reminder_settings SET enabled=false,next_check_at=NULL,version=version+1,updated_at=clock_timestamp() WHERE account_id=$1 AND person_id=$2',[source.account_id,source.person_id]);return 0}
    const created=await db.query(`WITH local AS(SELECT ($3::timestamptz AT TIME ZONE $4) AS t), kinds AS(SELECT 'birthday'::text AS kind FROM persons p,local WHERE p.account_id=$1 AND p.id=$2 AND p.birth_month_day=to_char(local.t,'MM-DD') UNION ALL SELECT 'meeting_anniversary' FROM persons p,local WHERE p.account_id=$1 AND p.id=$2 AND to_char(p.created_at AT TIME ZONE $4,'MM-DD')=to_char(local.t,'MM-DD') AND EXTRACT(YEAR FROM p.created_at AT TIME ZONE $4)<EXTRACT(YEAR FROM local.t)) INSERT INTO person_reminder_notifications(account_id,person_id,kind,local_date,local_year,authorization_version,created_at) SELECT $1,$2,kinds.kind,local.t::date,EXTRACT(YEAR FROM local.t)::int,$5,$3 FROM kinds,local WHERE local.t::time>=TIME '08:00' ON CONFLICT(account_id,person_id,kind,local_year) DO NOTHING`,[source.account_id,source.person_id,now,current.time_zone,grant.authorizationVersion])
    await db.query(`UPDATE person_reminder_settings SET next_check_at=(CASE WHEN ($3::timestamptz AT TIME ZONE time_zone)::time<TIME '08:00' THEN ($3::timestamptz AT TIME ZONE time_zone)::date+TIME '08:00' ELSE (($3::timestamptz AT TIME ZONE time_zone)::date+1)+TIME '08:00' END) AT TIME ZONE time_zone WHERE account_id=$1 AND person_id=$2`,[source.account_id,source.person_id,now]);return created.rowCount??0
   }).catch(error=>{if(error instanceof PeopleError&&error.status===404)return 0;throw error})
  }
  return made
 }
}
