import {createHash} from 'node:crypto'
import {z} from 'zod'
import {dependencyUnavailable,uuid} from './contracts.js'

const id=z.string().regex(uuid),version=z.number().int().min(1).max(2147483647)
const instant=z.string().max(40).refine(value=>Number.isFinite(Date.parse(value)))
const card=z.object({id,code:z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/),displayName:z.string().min(1).max(200),catalogVersion:version,enabled:z.boolean()})
export type VirtualWorldCard=z.infer<typeof card>
const stage=z.object({worldVersion:version,world:card,basis:z.enum(['current_catalog','arrival_snapshot','departure_snapshot'])}).strict()
export type WorldStage=z.infer<typeof stage>
export type WorldStageRef={worldId:string;worldVersion:number}
const movement=z.object({id,worldVersion:version,personVersion:version,fromWorld:card,toWorld:card,occurredAt:instant,recordedAt:instant})
const context=z.object({accountId:id,personId:id,personVersion:version,worldVersion:version,reality:z.literal('virtual'),branch:z.literal('main'),currentWorld:card,recentMovements:z.array(movement).max(8),revision:z.string().regex(/^[a-f0-9]{64}$/)})
export type VirtualWorldContext=z.infer<typeof context>
const ref=z.object({accountId:id,personId:id,personVersion:version,worldVersion:version,worldId:id,catalogVersion:version,reality:z.literal('virtual'),branch:z.literal('main'),movementIds:z.array(id).max(8),revision:z.string().regex(/^[a-f0-9]{64}$/)})
export type VirtualWorldUse=z.infer<typeof ref>
export function decodeWorldStages(value:unknown,current:VirtualWorldContext,refs:WorldStageRef[]):WorldStage[]{
 const result=z.object({accountId:id,personId:id,personVersion:version,currentWorldVersion:version,stages:z.array(stage).min(1).max(32)}).strict().safeParse(value)
 if(!result.success)throw dependencyUnavailable()
 const data=result.data
 if(data.accountId!==current.accountId||data.personId!==current.personId||data.personVersion!==current.personVersion||data.currentWorldVersion!==current.worldVersion||data.stages.length!==refs.length||new Set(data.stages.map(s=>s.worldVersion)).size!==refs.length||data.stages.some(s=>!refs.some(r=>r.worldVersion===s.worldVersion&&r.worldId===s.world.id)||s.worldVersion>current.worldVersion||s.basis!==(s.worldVersion===current.worldVersion?'current_catalog':s.worldVersion===1?'departure_snapshot':'arrival_snapshot')||s.worldVersion===current.worldVersion&&JSON.stringify(s.world)!==JSON.stringify(card.parse(current.currentWorld))))throw dependencyUnavailable()
 return data.stages
}
const stable=(value:unknown):string=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(stable).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable((value as Record<string,unknown>)[key])).join(',')+'}'

export function worldContextRevision(value:Omit<VirtualWorldContext,'revision'>){
 return createHash('sha256').update(stable({accountId:value.accountId,personId:value.personId,worldVersion:value.worldVersion,reality:value.reality,branch:value.branch,currentWorld:value.currentWorld,recentMovements:value.recentMovements})).digest('hex')
}
export function decodeVirtualWorldContext(value:unknown,accountId:string,personId:string):VirtualWorldContext{
 const parsed=context.safeParse(value)
 if(!parsed.success)throw dependencyUnavailable()
 const result=parsed.data,moves=result.recentMovements
 if(result.accountId!==accountId||result.personId!==personId||result.worldVersion>result.personVersion||moves.length!==Math.min(8,result.worldVersion-1)||new Set(moves.map(move=>move.id)).size!==moves.length||new Set(moves.map(move=>move.worldVersion)).size!==moves.length||moves.some((move,index)=>move.worldVersion<2||move.worldVersion>result.worldVersion||move.personVersion>result.personVersion||move.worldVersion>move.personVersion||move.fromWorld.id===move.toWorld.id||Date.parse(move.recordedAt)<Date.parse(move.occurredAt)||index>0&&(moves[index-1].worldVersion!==move.worldVersion+1||moves[index-1].fromWorld.id!==move.toWorld.id))||result.worldVersion===1&&moves.length>0||result.worldVersion>1&&(!moves.length||moves[0].worldVersion!==result.worldVersion||moves[0].toWorld.id!==result.currentWorld.id)||worldContextRevision(result)!==result.revision)throw dependencyUnavailable()
 return result
}
export function virtualWorldUse(value:VirtualWorldContext):VirtualWorldUse{
 return {accountId:value.accountId,personId:value.personId,personVersion:value.personVersion,worldVersion:value.worldVersion,worldId:value.currentWorld.id,catalogVersion:value.currentWorld.catalogVersion,reality:value.reality,branch:value.branch,movementIds:value.recentMovements.map(move=>move.id),revision:value.revision}
}
export function sameVirtualWorldUse(value:unknown,current:VirtualWorldContext):boolean{
 const parsed=ref.safeParse(value)
 if(!parsed.success)return false
 const previous=parsed.data,next=virtualWorldUse(current)
 // Profile-only changes do not rewrite the world history. The generation's
 // independent person_version fence still protects the current model input.
 return previous.accountId===next.accountId&&previous.personId===next.personId&&previous.worldVersion===next.worldVersion&&previous.worldId===next.worldId&&previous.catalogVersion===next.catalogVersion&&previous.revision===next.revision&&JSON.stringify(previous.movementIds)===JSON.stringify(next.movementIds)
}
