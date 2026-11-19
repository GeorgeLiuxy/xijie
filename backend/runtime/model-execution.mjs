import {readFileSync,lstatSync} from 'node:fs'
import {isAbsolute} from 'node:path'

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function modelAccountIds(){
 const ids=(process.env.MODEL_ALLOWED_ACCOUNT_IDS??'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean)
 if(ids.length===1&&ids[0]==='*'){
  if(process.env.NODE_ENV!=='production'||process.env.MODEL_PRODUCTION_APPROVED!=='true')throw new Error('Wildcard model scope requires explicit production approval')
  return ids
 }
 if(ids.some(v=>!uuid.test(v))||ids.length>100)throw new Error('MODEL_ALLOWED_ACCOUNT_IDS must contain up to 100 explicit account UUIDs or an approved production wildcard')
 return [...new Set(ids)]
}
export function modelAccountAllowed(accountId){const ids=modelAccountIds();return uuid.test(accountId)&&process.env.MODEL_EXECUTION_ENABLED==='true'&&(process.env.NODE_ENV!=='production'||process.env.MODEL_PRODUCTION_APPROVED==='true')&&(ids.includes('*')||ids.includes(accountId.toLowerCase()))}
export function configuredTextModel(purpose){
 const override=process.env['MODEL_NAME_'+purpose.toUpperCase()]?.trim()
 const name=override||process.env.MODEL_NAME?.trim()
 if(name&&!/^[a-zA-Z0-9._:-]{1,200}$/.test(name))throw new Error('Invalid configured model name for '+purpose)
 return name||undefined
}
export function modelApiKey(){
 const file=process.env.MODEL_API_KEY_FILE?.trim()
 if(file){
  if(!isAbsolute(file))throw new Error('MODEL_API_KEY_FILE must be an absolute private secret file')
  const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8192||process.platform!=='win32'&&(stat.mode&0o077)!==0)throw new Error('MODEL_API_KEY_FILE must be a private regular file')
  const key=readFileSync(file,'utf8').trim();if(!key||key.includes('\n')||key.includes('\0'))throw new Error('Invalid model credential file')
  return key
 }
 // Production credentials are never read from the ordinary process environment.
 return process.env.NODE_ENV==='production'?undefined:process.env.MODEL_API_KEY?.trim()
}
export function personModelProfile(person){
 const conversationTone=['gentle','witty','quiet','stern'].includes(person?.conversationTone)?person.conversationTone:null,voiceTimbre=['warm','bright','deep'].includes(person?.voiceTimbre)?person.voiceTimbre:null
 return {userResponsePreferences:{conversationTone,voiceTimbre},personality:Array.isArray(person?.personality)?person.personality:[],life:Array.isArray(person?.life)?person.life:[],catchphrase:typeof person?.catchphrase==='string'?person.catchphrase:null,unknownsToExploreNotFacts:Array.isArray(person?.unknowns)?person.unknowns:[]}
}
export class ModelExecutionError extends Error{constructor(code){super(code);this.code=code}}
const localDay=new Map(),localActive=new Set()
const int=(name,fallback,max)=>{const raw=process.env[name]??String(fallback);if(!/^[1-9][0-9]*$/.test(raw)||Number(raw)>max)throw new Error('Invalid '+name);return Number(raw)}
async function identityCall(service,path,body){
 const raw=process.env.XIJIE_IDENTITY_URL,credential=process.env['XIJIE_'+service.toUpperCase()+'_SERVICE_TOKEN']
 if(!raw||!credential||!/^[a-f0-9]{64}$/i.test(credential))throw new ModelExecutionError('MODEL_EXECUTION_UNAVAILABLE')
 const origin=new URL(raw),local=['localhost','127.0.0.1','[::1]'].includes(origin.hostname)
 if(origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/'||origin.protocol!=='https:'&&!(process.env.NODE_ENV!=='production'&&local&&origin.protocol==='http:'))throw new ModelExecutionError('MODEL_EXECUTION_UNAVAILABLE')
 const response=await fetch(new URL('/internal/v1/model-executions/'+path,origin),{method:body===undefined?'GET':'POST',redirect:'error',headers:{authorization:'Bearer '+credential,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(5000)})
 if(!response.ok)throw new ModelExecutionError(response.status===429?'MODEL_BUDGET_EXCEEDED':response.status===403?'AI_PERMISSION_REQUIRED':'MODEL_EXECUTION_UNAVAILABLE')
 return (await response.json()).data
}
export async function eligibleModelAccounts(service,purpose,after){
 const value=await identityCall(service,'accounts?purpose='+encodeURIComponent(purpose)+(after?'&after='+encodeURIComponent(after):''))
 if(!value||!Array.isArray(value.items)||value.items.length>100||value.items.some(id=>typeof id!=='string'||!uuid.test(id))||!(value.nextCursor===null||typeof value.nextCursor==='string'&&uuid.test(value.nextCursor))||value.items.some((id,i)=>i?id<=value.items[i-1]:after&&id<=after)||value.nextCursor!==null&&after&&value.nextCursor<=after)throw new ModelExecutionError('MODEL_EXECUTION_UNAVAILABLE')
 return value
}
export async function claimVoiceExecution(input){
 if(!modelAccountAllowed(input.accountId)||!uuid.test(input.jobId)||!uuid.test(input.attemptId))throw new ModelExecutionError('AI_PERMISSION_REQUIRED')
 const result=await identityCall('conversations','claim',{accountId:input.accountId,jobId:input.jobId,attemptId:input.attemptId,purpose:'voice_call'})
 if(result?.id!==input.attemptId)throw new ModelExecutionError('MODEL_EXECUTION_UNAVAILABLE')
}
export async function finishVoiceExecution(id){await identityCall('conversations',id+'/finish',{succeeded:false})}

const modelName=/^(?!sk-)[a-z0-9][a-z0-9._:-]{0,127}$/i
const meterKeys=['provider','model','resolvedModel','state','elapsedMs','inputTokens','outputTokens','cachedInputTokens']
const quantity=value=>Number.isSafeInteger(value)&&value>=0&&value<=2147483647
const nullableName=value=>value===null||typeof value==='string'&&modelName.test(value)
export function isModelAttemptUsage(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==meterKeys.length||meterKeys.some(key=>!Object.hasOwn(value,key)))return false
 const {provider,model,resolvedModel,state,elapsedMs,inputTokens,outputTokens,cachedInputTokens}=value
 return provider==='openai'&&nullableName(model)&&nullableName(resolvedModel)
  &&['returned','failed','canceled','not_started'].includes(state)
  &&(state==='not_started'?elapsedMs===null&&resolvedModel===null&&inputTokens===null&&outputTokens===null&&cachedInputTokens===null:quantity(elapsedMs))
  &&[inputTokens,outputTokens,cachedInputTokens].every(count=>count===null||quantity(count))
  &&(inputTokens===null||cachedInputTokens===null||cachedInputTokens<=inputTokens)
}
function reportedTotal(records,field){
 if(!records.length)return null
 let total=0
 for(const usage of records){
  const count=field(usage)
  if(!quantity(count))return null
  total+=count
  if(!quantity(total))return null
 }
 return total
}
function attemptUsage(config,state,elapsedMs,result){
 // The OpenAI-compatible SDK normalizes missing token counts to zero. Read
 // each provider-reported usage object so missing and explicit zero differ.
 const records=Array.isArray(result?.steps)&&result.steps.length
  ? result.steps.map(step=>step?.usage?.raw)
  : result?.usage?.raw?[result.usage.raw]:[]
 const inputTokens=reportedTotal(records,usage=>usage?.prompt_tokens)
 const outputTokens=reportedTotal(records,usage=>usage?.completion_tokens)
 const cached=reportedTotal(records,usage=>usage?.prompt_tokens_details?.cached_tokens)
 const validModel=value=>typeof value==='string'&&modelName.test(value)?value:null
 return {
  provider:config.provider,model:validModel(config.model),resolvedModel:validModel(result?.response?.modelId),
  state,elapsedMs,inputTokens,outputTokens,
  cachedInputTokens:inputTokens!==null&&cached!==null&&cached>inputTokens?null:cached,
 }
}

// Every actual transport invocation is claimed once. Model errors still consume a daily attempt.
// The test-only path exercises the same default-off, scope and budget rules without a service.
export async function executeModel(input,service,purpose,operation,meter){
 if(!modelAccountAllowed(input.accountId))throw new ModelExecutionError('AI_PERMISSION_REQUIRED')
 if(!uuid.test(input.attemptId)||!uuid.test(input.jobId)||input.signal?.aborted)throw new ModelExecutionError('AI_PERMISSION_REQUIRED')
 let finish
 if(process.env.NODE_ENV==='test'){
  const day=new Date().toISOString().slice(0,10),key=day+':'+input.accountId,used=localDay.get(key)??0
  if(localActive.size>=int('MODEL_MAX_CONCURRENT',4,100)||used>=int('MODEL_DAILY_ACCOUNT_LIMIT',100,10000))throw new ModelExecutionError('MODEL_BUDGET_EXCEEDED')
  localDay.set(key,used+1);localActive.add(input.attemptId)
  finish=async()=>{localActive.delete(input.attemptId);return true}
 }else{
  const call=(path,body)=>identityCall(service,path,body)
  const claim=await call('claim',{accountId:input.accountId,jobId:input.jobId,attemptId:input.attemptId,purpose})
  if(claim?.id!==input.attemptId)throw new ModelExecutionError('MODEL_EXECUTION_UNAVAILABLE')
  finish=async(succeeded,usage)=>{const result=await call(input.attemptId+'/finish',{succeeded,...(usage?{usage}:{})});return result?.allowed===true}
 }
 const measure=(state,started,result)=>meter&&attemptUsage(meter,state,started===undefined?null:Math.min(2147483647,Math.round(performance.now()-started)),result)
 let result,usage,finalized=false
 try{
  if(input.signal?.aborted){
   usage=measure('not_started')
   throw new ModelExecutionError('AI_PERMISSION_REQUIRED')
  }
  // Transport timeouts stay below the durable 45-second lease. No result may commit after it.
  const started=performance.now()
  try{result=await operation()}catch(error){
   usage=measure(input.signal?.aborted?'canceled':'failed',started,error)
   throw error
  }
  usage=measure('returned',started,result)
  const accepted=await finish(!input.signal?.aborted,usage);finalized=true
  if(!accepted||input.signal?.aborted)throw new ModelExecutionError('AI_PERMISSION_REQUIRED')
  return result
 }catch(error){if(!finalized)try{await finish(false,usage)}catch{}throw error}
}
