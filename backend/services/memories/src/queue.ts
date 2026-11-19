import {PgBoss} from 'pg-boss'
import type {PoolClient} from 'pg'
import type {CandidateQueueSender,Dispatch} from './candidates.js'
export const SUGGEST_QUEUE='memory.suggest.v1'
export class CandidateQueue implements CandidateQueueSender{
 readonly boss:PgBoss
 constructor(connectionString:string,schema='memory_queue'){
  if(!/^[a-z_][a-z0-9_]{0,62}$/.test(schema))throw new Error('Invalid memory queue schema')
  this.boss=new PgBoss({connectionString,schema,monitorIntervalSeconds:1});this.boss.on('error',()=>console.error('Memory queue connection was interrupted.'))
 }
 async start(){await this.boss.start();await this.boss.createQueue(SUGGEST_QUEUE,{retryLimit:3,retryDelay:2,expireInSeconds:60,deleteAfterSeconds:86400});return this}
 async send(db:PoolClient,dispatch:Dispatch){const id=await this.boss.send(SUGGEST_QUEUE,dispatch,{id:dispatch.dispatchId,db:{executeSql:(text,values)=>db.query(text,values)},retryLimit:3,retryDelay:2,expireInSeconds:60});if(!id)throw new Error('Memory suggestion could not be enqueued')}
 async isPending(db:PoolClient,dispatch:Dispatch){const rows=await this.boss.findJobs<Dispatch>(SUGGEST_QUEUE,{data:{jobId:dispatch.jobId,dispatchGeneration:dispatch.dispatchGeneration},limit:10,db:{executeSql:(text,values)=>db.query(text,values)}});return rows.length===10||rows.some(row=>['created','active','retry'].includes(row.state))}
 async work(handler:(dispatch:Dispatch)=>Promise<void>){await this.boss.work<Dispatch>(SUGGEST_QUEUE,{batchSize:1,pollingIntervalSeconds:0.5},async jobs=>{for(const job of jobs)await handler(job.data)})}
 async stop(){await this.boss.stop({graceful:true,timeout:10000})}
}
