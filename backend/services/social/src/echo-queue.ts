import {PgBoss} from 'pg-boss'
import type {PoolClient} from 'pg'
import type {Dispatch,EchoQueueSender} from './echo-contracts.js'
export const ECHO_QUEUE='social.generate.v1'
export class EchoQueue implements EchoQueueSender{
 readonly boss:PgBoss
 constructor(url:string,readonly schema='social_queue'){if(!/^[a-z_][a-z0-9_]{0,62}$/.test(schema))throw new Error('Invalid social queue schema');this.boss=new PgBoss({connectionString:url,schema,monitorIntervalSeconds:1});this.boss.on('error',()=>console.error('Social generation queue interrupted.'))}
 async start(){await this.boss.start();await this.boss.createQueue(ECHO_QUEUE,{retryLimit:3,retryDelay:2,expireInSeconds:60,deleteAfterSeconds:86400});return this}
 async send(db:PoolClient,dispatch:Dispatch){const id=await this.boss.send(ECHO_QUEUE,dispatch,{id:dispatch.dispatchId,db:{executeSql:(s,v)=>db.query(s,v)},retryLimit:3,retryDelay:2,expireInSeconds:60});if(!id)throw new Error('Social generation could not be enqueued')}
 async isPending(db:PoolClient,dispatch:Dispatch){const rows=await this.boss.findJobs<Dispatch>(ECHO_QUEUE,{data:{jobId:dispatch.jobId,dispatchGeneration:dispatch.dispatchGeneration},limit:10,db:{executeSql:(s,v)=>db.query(s,v)}});return rows.length===10||rows.some(v=>['active','created','retry'].includes(v.state))}
 async work(handler:(d:Dispatch)=>Promise<void>){await this.boss.work<Dispatch>(ECHO_QUEUE,{batchSize:1,pollingIntervalSeconds:0.5},async jobs=>{for(const j of jobs)await handler(j.data)})}
 async erase(db:PoolClient,ids:string[],jobIds:string[]=[]){if(ids.length||jobIds.length)await db.query('DELETE FROM "'+this.schema+'".job WHERE name=$1 AND (id=ANY($2::uuid[]) OR data->>\'jobId\'=ANY($3::text[]))',[ECHO_QUEUE,ids,jobIds])}
 async stop(){await this.boss.stop({graceful:true,timeout:10000})}
}
