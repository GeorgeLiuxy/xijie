import type {PoolClient} from 'pg'
import type {AccountContext,ContextProvider,PersonContext} from './dependencies.js'

export type AutomaticOrigin='people'|'conversations'
export type AutomaticSourceKind='profile'|'message'
export type AutomaticSourceEvent={eventId:string;accountId:string;personId:string;sourceKind:AutomaticSourceKind;sourceId:string;sourceVersion:number;change:'upsert'|'remove';occurredAt:string}
export type AutomaticRef={id:string;version:number}
export type AutomaticMessage={id:string;accountId:string;personId:string;conversationId:string;text:string;version:number;createdAt:string;sequence:string;aiAuthorizationVersion:number;context:{id:string;version:number;authorKind:'self'|'persona';text:string;createdAt:string}[]}
export interface AutoDependencies extends ContextProvider{
 sourceEvents(origin:AutomaticOrigin,accountIds:string[]):Promise<AutomaticSourceEvent[]>
 ackSourceEvent(origin:AutomaticOrigin,eventId:string):Promise<unknown>
 automaticMessage(accountId:string,id:string):Promise<AutomaticMessage>
 validAutomaticRefs(accountId:string,personId:string,refs:AutomaticRef[]):Promise<AutomaticRef[]>
}
export type AutoEntry={id:string;version:number;body:string;topic:string;timeDescription:string;sourceKind:AutomaticSourceKind;sourceId:string;sourceVersion:number;sourceAuthor:'self';reality:'user_reported'|'user_provided_profile';sourceCreatedAt:string;sourceSequence?:string;sources:AutomaticRef[];evidence:string;userCorrectedAt?:string}
export type AutomaticCorrection={topic:string;body:string}
export type AutomaticFact={body:string;topic:string;timeDescription:string;evidence:string;supersedes:string[]}
export type AutomaticSnapshot={account:AccountContext;person:PersonContext;source:{kind:AutomaticSourceKind;id:string;version:number;createdAt:string;sequence?:string;body:string;aiAuthorizationVersion:number;contextRefs:AutomaticRef[]};context:AutomaticMessage['context'];previousEntries:AutoEntry[]}
export type AutomaticDispatch={jobId:string;dispatchId:string;dispatchGeneration:number}
export interface AutomaticQueueSender{send(db:PoolClient,dispatch:AutomaticDispatch):Promise<void>;isPending?(db:PoolClient,dispatch:AutomaticDispatch):Promise<boolean>}
export type AutomaticState='queued'|'running'|'succeeded'|'failed'|'blocked'
export type AutomaticJob={id:string;account_id:string;person_id:string;source_record_id:string;source_kind:AutomaticSourceKind;source_id:string;source_version:number;source_created_at:Date;source_sequence:string|null;context_refs:AutomaticRef[];snapshot_hash:string;person_version:number;person_access_version:number;account_access_version:number;authorization_version:number;ai_authorization_version:number;state:AutomaticState;version:number;dispatch_id:string;dispatch_generation:number;attempt_id:string|null;attempt_count:number;lease_until:Date|null;failure_code:string|null;retryable:boolean;created_at:Date;updated_at:Date;queued_at:Date;run_after:Date;started_at:Date|null;finished_at:Date|null}
export interface AutomaticProvider{generate(input:{accountId:string;jobId:string;attemptId:string;aiAuthorizationVersion:number;snapshot:AutomaticSnapshot;signal:AbortSignal}):Promise<{facts:AutomaticFact[]}>}
export class AutomaticError extends Error{constructor(readonly code:string,readonly retryable:boolean){super(code)}}
