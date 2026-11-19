export const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export class MemoryError extends Error {
 constructor(readonly status:number,readonly code:string,message:string){super(message)}
}
export const invalid=()=>new MemoryError(400,'INVALID_ARGUMENT','The memory request is invalid.')
export const notFound=()=>new MemoryError(404,'NOT_FOUND','The requested record was not found.')
export const unauthorized=()=>new MemoryError(401,'UNAUTHENTICATED','Sign in to continue.')
export const unavailable=()=>new MemoryError(503,'DEPENDENCY_UNAVAILABLE','A required service is unavailable.')
export const forbidden=()=>new MemoryError(403,'FORBIDDEN','Saving or reading private stories is not permitted.')
export const conflict=()=>new MemoryError(409,'IDEMPOTENCY_CONFLICT','This operation identity was already used with different input.')
export type Memory={id:string;personId:string;title:string;body:string;origin:'manual'|'ai_candidate'|'shared_contribution'|'import';source?:{kind:'message';messageId:string}|{kind:'shared_contribution';albumId:string;contributionId:string};confirmedAt:string;createdAt:string;updatedAt:string;version:number}
export type CreateInput={clientMemoryId:string;title:string;body:string;sourceMessageId?:string;sourceMessageVersion?:number;candidateId?:string;candidateVersion?:number}
export type PatchInput={title?:string;body?:string}
export type SearchHit={kind:'person'|'memory'|'world';id:string;title:string;excerpt?:string;personId?:string;memoryId?:string;worldId?:string;worldCode?:string;version?:number}
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();return value as Record<string,unknown>}
function text(value:unknown,max:number){if(typeof value!=='string'||value.includes('\0')||/\p{Surrogate}/u.test(value))throw invalid();const result=value.trim();if(!result||[...result].length>max)throw invalid();return result}
export function createInput(value:unknown):CreateInput{
 const input=record(value)
 if(Object.keys(input).some(key=>!['clientMemoryId','title','body','sourceMessageId','sourceMessageVersion','candidateId','candidateVersion'].includes(key))||typeof input.clientMemoryId!=='string'||!uuid.test(input.clientMemoryId))throw invalid()
 const source=input.sourceMessageId!==undefined||input.sourceMessageVersion!==undefined
 if(source&&(typeof input.sourceMessageId!=='string'||!uuid.test(input.sourceMessageId)||!Number.isSafeInteger(input.sourceMessageVersion)||Number(input.sourceMessageVersion)<1))throw invalid()
 const candidate=input.candidateId!==undefined||input.candidateVersion!==undefined
 if(candidate&&(source||typeof input.candidateId!=='string'||!uuid.test(input.candidateId)||!Number.isSafeInteger(input.candidateVersion)||Number(input.candidateVersion)<1))throw invalid()
 return {clientMemoryId:input.clientMemoryId.toLowerCase(),title:text(input.title,120),body:text(input.body,10000),...(source?{sourceMessageId:String(input.sourceMessageId).toLowerCase(),sourceMessageVersion:Number(input.sourceMessageVersion)}:{}),...(candidate?{candidateId:String(input.candidateId).toLowerCase(),candidateVersion:Number(input.candidateVersion)}:{})}
}
export function suggestionInput(value:unknown){const input=record(value);if(Object.keys(input).some(key=>key!=='sourceMessageId')||typeof input.sourceMessageId!=='string'||!uuid.test(input.sourceMessageId))throw invalid();return {sourceMessageId:input.sourceMessageId.toLowerCase()}}
export function emptyInput(value:unknown){if(value!==undefined&&value!==null&&!(typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===0))throw invalid()}
export type CandidateState='ready'|'consumed'|'expired'|'withdrawn'
export type MemoryCandidate={id:string;personId:string;state:CandidateState;version:number;expiresAt:string;sourceMessageId?:string;title?:string;body?:string;consumedByMemoryId?:string}
export type SuggestionState='queued'|'running'|'succeeded'|'failed'|'blocked'|'canceled'
export type SuggestionJob={id:string;kind:'memory_suggestion';targetId:string;state:SuggestionState;version:number;resultRef?:{kind:'memory_candidate';id:string};failure?:{code:string;retryable:boolean};updatedAt:string}
export function patchInput(value:unknown):PatchInput{
 const input=record(value);if(!Object.keys(input).length||Object.keys(input).some(key=>!['title','body'].includes(key)))throw invalid()
 if(input.title===undefined&&input.body===undefined)throw invalid()
 return {...(input.title!==undefined?{title:text(input.title,120)}:{}),...(input.body!==undefined?{body:text(input.body,10000)}:{})}
}
export function queryText(value:unknown){return text(value,160)}
