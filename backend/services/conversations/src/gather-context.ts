import {createHash} from 'node:crypto'
import {z} from 'zod'
import {dependencyUnavailable,uuid} from './contracts.js'
const id=z.string().regex(uuid),version=z.number().int().positive().max(2147483647)
const schema=z.object({accountId:id,world:z.object({id,code:z.string().min(1).max(64),displayName:z.string().min(1).max(200),enabled:z.boolean(),catalogVersion:version}),residents:z.array(z.object({id,displayName:z.string().min(1).max(200),version,accessVersion:version,worldVersion:version,createdAt:z.string().refine(v=>Number.isFinite(Date.parse(v)))})).max(1000),revision:z.string().regex(/^[a-f0-9]{64}$/)})
export type GatherContext=z.infer<typeof schema>
const canonical=(v:unknown):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}'
export function gatherRevision(value:Omit<GatherContext,'revision'>){return createHash('sha256').update(canonical(value)).digest('hex')}
export function decodeGatherContext(value:unknown,accountId:string,worldId:string):GatherContext{
 const parsed=schema.safeParse(value);if(!parsed.success)throw dependencyUnavailable()
 const result=parsed.data,{revision,...core}=result
 if(result.accountId!==accountId||result.world.id!==worldId||new Set(result.residents.map(p=>p.id)).size!==result.residents.length||result.residents.some((p,i)=>p.worldVersion>p.version||i>0&&(result.residents[i-1].createdAt>p.createdAt||result.residents[i-1].createdAt===p.createdAt&&result.residents[i-1].id>p.id))||gatherRevision(core)!==revision)throw dependencyUnavailable()
 return result
}
