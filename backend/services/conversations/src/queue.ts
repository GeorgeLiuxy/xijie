import { PgBoss } from "pg-boss"
import type { PoolClient } from "pg"
import type { QueueSender } from "./store.js"
import {createPhotoQueue} from "./photo-queue.js"
export const REPLY_QUEUE = "conversation.reply.v1"
export const LETTER_QUEUE = 'letter.reply.v1'
export const GATHER_QUEUE='gather.reply.v1'
export class ConversationQueue implements QueueSender {
  readonly boss: PgBoss
  private readonly photos: ReturnType<typeof createPhotoQueue>
  constructor(connectionString: string, schema = "conversation_queue") {
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema))
      throw new Error("Invalid queue schema")
    this.boss = new PgBoss({
      connectionString,
      schema,
      monitorIntervalSeconds: 1,
    })
    this.photos=createPhotoQueue(this.boss)
    this.boss.on("error", () =>
      console.error("Conversation queue connection was interrupted."),
    )
  }
  async start() {
    await this.boss.start()
    await this.boss.createQueue(REPLY_QUEUE, {
      retryLimit: 3,
      retryDelay: 2,
      expireInSeconds: 60,
      deleteAfterSeconds: 86400,
    })
    await this.boss.createQueue(LETTER_QUEUE,{retryLimit:3,retryDelay:2,expireInSeconds:60,deleteAfterSeconds:86400})
    await this.boss.createQueue(GATHER_QUEUE,{retryLimit:3,retryDelay:2,expireInSeconds:60,deleteAfterSeconds:86400})
    for(const name of ['story.reply.v1','world.life.v1'])await this.boss.createQueue(name,{retryLimit:3,retryDelay:2,expireInSeconds:60,deleteAfterSeconds:86400})
    await this.photos.start()
    return this
  }
  async send(db: PoolClient, jobId: string, dispatchId: string) {
    const id = await this.boss.send(REPLY_QUEUE, { jobId }, {
      id: dispatchId,
      db: { executeSql: (sql, values) => db.query(sql, values) },
      retryLimit: 3,
      retryDelay: 2,
      expireInSeconds: 60,
    })
    if (!id) throw new Error("Conversation reply could not be enqueued")
  }
  async work(handler: (jobId: string) => Promise<void>) {
    await this.boss.work<{ jobId: string }>(
      REPLY_QUEUE,
      { batchSize: 1, pollingIntervalSeconds: 0.5 },
      async (jobs) => {
        for (const item of jobs) await handler(item.data.jobId)
      },
    )
  }
  async sendLetter(db:PoolClient,jobId:string,dispatchId:string,at:Date){
    const id=await this.boss.send(LETTER_QUEUE,{jobId},{id:dispatchId,startAfter:at,db:{executeSql:(sql,values)=>db.query(sql,values)},retryLimit:3,retryDelay:2,expireInSeconds:60})
    if(!id)throw new Error('Letter reply could not be enqueued')
  }
  async sendGather(db:PoolClient,jobId:string,personId:string,dispatchId:string,at:Date){const id=await this.boss.send(GATHER_QUEUE,{jobId,personId},{id:dispatchId,startAfter:at,db:{executeSql:(sql,values)=>db.query(sql,values)},retryLimit:3,retryDelay:2,expireInSeconds:60});if(!id)throw new Error('Gather reply could not be enqueued')}
  async workGather(handler:(jobId:string,personId:string)=>Promise<void>){await this.boss.work<{jobId:string;personId:string}>(GATHER_QUEUE,{batchSize:1,pollingIntervalSeconds:0.5},async jobs=>{for(const item of jobs)await handler(item.data.jobId,item.data.personId)})}
  async isGatherPending(db:PoolClient,jobId:string,personId:string){const jobs=await this.boss.findJobs<{jobId:string;personId:string}>(GATHER_QUEUE,{data:{jobId,personId},limit:10,db:{executeSql:(sql,values)=>db.query(sql,values)}});return jobs.length===10||jobs.some(job=>['created','retry','active'].includes(job.state))}
  async workLetters(handler:(jobId:string)=>Promise<void>){await this.boss.work<{jobId:string}>(LETTER_QUEUE,{batchSize:1,pollingIntervalSeconds:0.5},async jobs=>{for(const item of jobs)await handler(item.data.jobId)})}
  async isLetterPending(db:PoolClient,jobId:string){const jobs=await this.boss.findJobs<{jobId:string}>(LETTER_QUEUE,{data:{jobId},limit:10,db:{executeSql:(sql,values)=>db.query(sql,values)}});return jobs.length===10||jobs.some(job=>['created','retry','active'].includes(job.state))}
  async isPending(db: PoolClient, jobId: string) {
    const jobs=await this.boss.findJobs<{jobId:string}>(REPLY_QUEUE,{data:{jobId},limit:10,db:{executeSql:(text,values)=>db.query(text,values)}})
    // At most three business dispatches are created today. A future larger history must
    // conservatively remain pending rather than mistake a truncated query for exhaustion.
    return jobs.length===10||jobs.some(job=>job.state==='created'||job.state==='retry'||job.state==='active')
  }
  async sendPhoto(db:PoolClient,jobId:string,dispatchId:string,at:Date){return this.photos.sendPhoto(db,jobId,dispatchId,at)}
  async workPhoto(handler:(jobId:string)=>Promise<void>){return this.photos.workPhoto(handler)}
  async isPhotoPending(db:PoolClient,jobId:string){return this.photos.isPhotoPending(db,jobId)}
  async sendStory(db:PoolClient,mode:'branch'|'offline',jobId:string,dispatchId:string,at:Date){const id=await this.boss.send(mode==='branch'?'story.reply.v1':'world.life.v1',{jobId},{id:dispatchId,startAfter:at,db:{executeSql:(sql,values)=>db.query(sql,values)},retryLimit:3,retryDelay:2,expireInSeconds:60});if(!id)throw new Error('Story could not be enqueued')}
  async workStories(handler:(mode:'branch'|'offline',id:string)=>Promise<void>){for(const mode of ['branch','offline'] as const)await this.boss.work<{jobId:string}>(mode==='branch'?'story.reply.v1':'world.life.v1',{batchSize:1,pollingIntervalSeconds:0.5},async jobs=>{for(const j of jobs)await handler(mode,j.data.jobId)})}
  async isStoryPending(db:PoolClient,mode:'branch'|'offline',jobId:string){const jobs=await this.boss.findJobs<{jobId:string}>(mode==='branch'?'story.reply.v1':'world.life.v1',{data:{jobId},limit:10,db:{executeSql:(sql,values)=>db.query(sql,values)}});return jobs.length===10||jobs.some(j=>['created','retry','active'].includes(j.state))}
  async stop() {
    await this.boss.stop({ graceful: true, timeout: 10000 })
  }
}
