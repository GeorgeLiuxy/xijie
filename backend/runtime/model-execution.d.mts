export function modelAccountIds():string[]
export function claimVoiceExecution(input:{accountId:string;jobId:string;attemptId:string}):Promise<void>
export function finishVoiceExecution(id:string):Promise<void>
export function eligibleModelAccounts(service:'memories'|'social',purpose:'automatic_memory'|'memory_echo',after?:string):Promise<{items:string[];nextCursor:string|null}>
export function modelAccountAllowed(accountId:string):boolean
export function modelApiKey():string|undefined
export function personModelProfile(person:unknown):{userResponsePreferences:{conversationTone:'gentle'|'witty'|'quiet'|'stern'|null;voiceTimbre:'warm'|'bright'|'deep'|null};personality:string[];life:string[];catchphrase:string|null;unknownsToExploreNotFacts:string[]}
export class ModelExecutionError extends Error{readonly code:string;constructor(code:string)}
export type ModelAttemptUsage={
 provider:'openai'
 model:string|null
 resolvedModel:string|null
 state:'returned'|'failed'|'canceled'|'not_started'
 elapsedMs:number|null
 inputTokens:number|null
 outputTokens:number|null
 cachedInputTokens:number|null
}
export function isModelAttemptUsage(value:unknown):value is ModelAttemptUsage
export function executeModel<T>(input:{accountId:string;jobId:string;attemptId:string;signal?:AbortSignal},service:'conversations'|'memories'|'social'|'gifts',purpose:string,operation:()=>Promise<T>,meter?:{provider:'openai';model:string}):Promise<T>
export function configuredTextModel(purpose:string): string | undefined
