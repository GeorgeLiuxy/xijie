import type {PoolClient} from 'pg'
import type {Account,Storage} from './dependencies.js'
import type {PersonMeta} from './contracts.js'
import type {VirtualWorldContext} from './virtual-world.js'
export type AiPermission=Storage&{privateFeedProcessingAllowed?:boolean}
export type MemoryRef={id:string;version:number}
export type EchoEvent={eventId:string;accountId:string;personId:string;memoryId:string;sourceVersion:number;change:'upsert'|'remove';echoAiAuthorizationVersion:number;occurredAt:string}
export type EchoMemory={accountId:string;personId:string;id:string;title:string;body:string;origin:'manual'|'ai_candidate'|'shared_contribution';version:number;confirmedAt:string;updatedAt:string}
export type EchoPerson=PersonMeta&{accountId:string;relationship:string;calledMe?:string;story:string;conversationTone?:'gentle'|'witty'|'quiet'|'stern'|null;voiceTimbre?:'warm'|'bright'|'deep'|null;personality?:string[];life?:string[];unknowns?:string[];catchphrase?:string|null}
export type Dispatch={jobId:string;dispatchId:string;dispatchGeneration:number}
export interface EchoQueueSender{send(db:PoolClient,dispatch:Dispatch):Promise<void>;isPending?(db:PoolClient,dispatch:Dispatch):Promise<boolean>;erase?(db:PoolClient,ids:string[],jobIds?:string[]):Promise<void>}
export type JobRow={id:string;account_id:string;person_id:string;memory_id:string;memory_version:number;kind:'memory_echo'|'feed_reaction';post_id:string|null;source_comment_id:string|null;source_comment_version:number|null;person_version:number;person_access_version:number;account_access_version:number;authorization_version:number;ai_authorization_version:number;state:string;version:number;dispatch_id:string;dispatch_generation:number;attempt_id:string|null;attempt_count:number;lease_until:Date|null;failure_code:string|null;retryable:boolean;result_id:string|null;world_context_ref:VirtualWorldContext|null;context_comment_refs:MemoryRef[];created_at:Date;updated_at:Date}
export type EchoInput={jobId:string;attemptId:string;accountId:string;kind:JobRow['kind'];aiAuthorizationVersion:number;account:Account;person:EchoPerson;memory:EchoMemory;world:VirtualWorldContext;post?:{id:string;text:string};comment?:{id:string;text:string};target?:{id:string;authorKind:string;text:string};signal:AbortSignal}
export interface EchoProvider{generate(input:EchoInput):Promise<{text:string}>}
