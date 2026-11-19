import type {PgBoss} from 'pg-boss'
import type {PoolClient} from 'pg'
export const PHOTO_QUEUE='photo.reply.v1'
export interface PhotoQueueSender{
 sendPhoto?(db:PoolClient,jobId:string,dispatchId:string,at:Date):Promise<void>
 isPhotoPending?(db:PoolClient,jobId:string):Promise<boolean>
}
export function createPhotoQueue(boss:PgBoss){return{
 async start(){await boss.createQueue(PHOTO_QUEUE,{retryLimit:3,retryDelay:2,expireInSeconds:60,deleteAfterSeconds:86400})},
 async sendPhoto(db:PoolClient,jobId:string,dispatchId:string,at:Date){const id=await boss.send(PHOTO_QUEUE,{jobId},{id:dispatchId,startAfter:at,db:{executeSql:(sql,values)=>db.query(sql,values)},retryLimit:3,retryDelay:2,expireInSeconds:60});if(!id)throw new Error('Photo reply could not be enqueued')},
 async workPhoto(handler:(jobId:string)=>Promise<void>){await boss.work<{jobId:string}>(PHOTO_QUEUE,{batchSize:1,pollingIntervalSeconds:0.5},async jobs=>{for(const item of jobs)await handler(item.data.jobId)})},
 async isPhotoPending(db:PoolClient,jobId:string){const jobs=await boss.findJobs<{jobId:string}>(PHOTO_QUEUE,{data:{jobId},limit:10,db:{executeSql:(sql,values)=>db.query(sql,values)}});return jobs.length===10||jobs.some(job=>['created','retry','active'].includes(job.state))},
}}
