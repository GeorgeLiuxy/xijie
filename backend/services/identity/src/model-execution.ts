import {type Pool} from 'pg'
import {ConsentStore} from './consent-store.js'
import {modelAccountAllowed,type ModelAttemptUsage} from '../../../runtime/model-execution.mjs'

export const modelPurposes={conversations:['text_reply','world_action','letter_reply','gather_reply','photo_reply','story_branch','offline_life','voice_call','speech_reply'],memories:['memory_suggest','automatic_memory'],social:['memory_echo'],gifts:['gift_return']} as const
export type ModelService=keyof typeof modelPurposes
export class ModelExecutionError extends Error{constructor(readonly status:number,readonly code:string){super(code)}}
const knownPurposes = new Set<string>(Object.values(modelPurposes).flat())
function modelPurposeAllowed(purpose: string) {
 const configured = process.env.MODEL_ALLOWED_PURPOSES
 if (configured === undefined) return true
 const purposes = configured.split(',').map(value => value.trim()).filter(Boolean)
 return purposes.every(value => knownPurposes.has(value)) && purposes.includes(purpose)
}
const required:Record<string,string[]>={speech_reply:['storyStorage','chatReplySpeech'],voice_call:['storyStorage','voiceCalls'],text_reply:['storyStorage','aiTextProcessing'],world_action:['storyStorage','aiTextProcessing','worldActionProcessing'],letter_reply:['storyStorage','letterStorage','letterReplies'],gather_reply:['storyStorage','gatherReplies'],photo_reply:['storyStorage','chatPhotoStorage','chatImageReplies'],story_branch:['storyStorage','aiTextProcessing','storyBranches'],offline_life:['storyStorage','aiTextProcessing','worldActionProcessing','offlineLife'],memory_suggest:['storyStorage','aiTextProcessing'],automatic_memory:['storyStorage','aiTextProcessing'],memory_echo:['storyStorage','aiTextProcessing'],gift_return:['giftStorage','giftReturns']}
const positive=(name:string,fallback:number,max:number)=>{const v=process.env[name]??String(fallback);if(!/^[1-9][0-9]*$/.test(v)||Number(v)>max)throw new Error('Invalid '+name);return Number(v)}
const modelGrants=(grants:Record<string,any>,purpose:string)=>{
 const {personVoiceStorage,chatReplySpeech,...model}=grants
 return purpose==='speech_reply'?{storyStorage:model.storyStorage,chatReplySpeech,productionModelExecution:model.productionModelExecution}:model
}
export class ModelExecutionStore{
 constructor(private readonly pool:Pool,private readonly consents:ConsentStore){}
 private valid(purpose:string,grants:Record<string,any>){return (required[purpose]??[]).every(key=>grants[key]?.allowed===true)&&Boolean(required[purpose])&&(purpose!=='automatic_memory'||grants.aiTextProcessing?.automaticMemoryAllowed===true)&&(purpose!=='memory_echo'||grants.aiTextProcessing?.privateFeedProcessingAllowed===true)&&(process.env.NODE_ENV!=='production'||grants.productionModelExecution?.allowed===true)}
 async eligible(service:ModelService,purpose:string,after?:string){
  if(!['automatic_memory','memory_echo'].includes(purpose)||!(modelPurposes[service] as readonly string[]).includes(purpose))throw new ModelExecutionError(403,'FORBIDDEN')
  if (!modelPurposeAllowed(purpose)) return {items: [], nextCursor: null}
  const rows=await this.pool.query("SELECT id FROM accounts WHERE status='active' AND ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT 100",[after??null])
  const items:string[]=[]
  for(const row of rows.rows)if(modelAccountAllowed(row.id)&&this.valid(purpose,await this.consents.authorizations(row.id)))items.push(row.id)
  return{items,nextCursor:rows.rowCount===100?rows.rows.at(-1)!.id as string:null}
 }
 async claim(service:ModelService,input:{accountId:string;jobId:string;attemptId:string;purpose:string}){
  if(!(modelPurposes[service] as readonly string[]).includes(input.purpose))throw new ModelExecutionError(403,'AI_PERMISSION_REQUIRED')
  if(!modelPurposeAllowed(input.purpose)||!modelAccountAllowed(input.accountId))throw new ModelExecutionError(503,'MODEL_EXECUTION_UNAVAILABLE')
  const max=positive('MODEL_MAX_CONCURRENT',4,100),daily=positive('MODEL_DAILY_ACCOUNT_LIMIT',100,10000),db=await this.pool.connect()
  try{
   await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(921737341)')
   const active=await db.query("SELECT id FROM accounts WHERE id=$1 AND status='active' FOR UPDATE",[input.accountId]);if(!active.rowCount)throw new ModelExecutionError(403,'AI_PERMISSION_REQUIRED')
   const grants=modelGrants(await this.consents.authorizations(input.accountId,db),input.purpose);if(!this.valid(input.purpose,grants))throw new ModelExecutionError(403,'AI_PERMISSION_REQUIRED')
   const prior=await db.query('SELECT 1 FROM model_executions WHERE id=$1',[input.attemptId]);if(prior.rowCount)throw new ModelExecutionError(409,'MODEL_ATTEMPT_ALREADY_CLAIMED')
   const count=await db.query("SELECT count(*)::integer AS n FROM model_executions WHERE finished_at IS NULL AND lease_until>clock_timestamp()");if(count.rows[0].n>=max)throw new ModelExecutionError(429,'MODEL_BUDGET_EXCEEDED')
   const budget=await db.query(`INSERT INTO model_execution_days(account_id,utc_day,attempts) VALUES($1,(clock_timestamp() AT TIME ZONE 'UTC')::date,1) ON CONFLICT(account_id,utc_day) DO UPDATE SET attempts=model_execution_days.attempts+1 WHERE model_execution_days.attempts<$2 RETURNING attempts`,[input.accountId,daily]);if(!budget.rowCount)throw new ModelExecutionError(429,'MODEL_BUDGET_EXCEEDED')
   await db.query(`INSERT INTO model_executions(id,account_id,job_id,service,purpose,authorizations,lease_until) VALUES($1,$2,$3,$4,$5,$6::jsonb,clock_timestamp()+$7::int*interval '1 second')`,[input.attemptId,input.accountId,input.jobId,service,input.purpose,JSON.stringify(grants),input.purpose==='voice_call'?150:45])
   await db.query('COMMIT');return{id:input.attemptId}
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
 }
 async finish(service:ModelService,id:string,succeeded:boolean,usage?:ModelAttemptUsage){
  const db=await this.pool.connect();try{
   await db.query('BEGIN')
   // Lock account first, matching consent/session mutation lock ordering.
   const owner=await db.query('SELECT account_id FROM model_executions WHERE id=$1 AND service=$2',[id,service]);if(!owner.rowCount)throw new ModelExecutionError(404,'NOT_FOUND')
   const account=await db.query("SELECT id FROM accounts WHERE id=$1 AND status='active' FOR UPDATE",[owner.rows[0].account_id])
   const row=(await db.query('SELECT *,lease_until>clock_timestamp() AS live FROM model_executions WHERE id=$1 AND service=$2 FOR UPDATE',[id,service])).rows[0]
   if(!row)throw new ModelExecutionError(404,'NOT_FOUND')
   if(row.finished_at){await db.query('COMMIT');return{allowed:false}}
   const grants=modelGrants(await this.consents.authorizations(row.account_id,db),row.purpose)
   // JSONB key order differs from JavaScript insertion order; compare in SQL.
   const same=(await db.query('SELECT $1::jsonb=$2::jsonb AS same',[JSON.stringify(row.authorizations),JSON.stringify(grants)])).rows[0].same
   const result=succeeded&&row.live&&Boolean(account.rowCount)&&modelPurposeAllowed(row.purpose)&&modelAccountAllowed(row.account_id)&&this.valid(row.purpose,grants)&&same
   if(usage)await db.query('UPDATE model_executions SET finished_at=clock_timestamp(),result_allowed=$2,usage=$3::jsonb WHERE id=$1',[id,result,JSON.stringify(usage)])
   else await db.query('UPDATE model_executions SET finished_at=clock_timestamp(),result_allowed=$2 WHERE id=$1',[id,result])
   await db.query('COMMIT');return{allowed:result}
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
 }
}
