import { PgBoss } from "pg-boss"
import type { PoolClient } from "pg"
import type { Dispatch, RightsQueueSender } from "./rights.js"
export const RIGHTS_QUEUE = "data-rights.process.v1"
export class RightsQueue implements RightsQueueSender {
  readonly boss: PgBoss
  constructor(connectionString: string, schema = "identity_rights_queue") {
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema))
      throw new Error("Invalid rights schema")
    this.boss = new PgBoss({
      connectionString,
      schema,
      monitorIntervalSeconds: 1,
    })
    this.boss.on("error", () =>
      console.error("Data rights queue connection interrupted."),
    )
  }
  async start() {
    await this.boss.start()
    await this.boss.createQueue(RIGHTS_QUEUE, {
      retryLimit: 3,
      retryDelay: 2,
      expireInSeconds: 120,
      deleteAfterSeconds: 86400,
    })
    return this
  }
  async send(db: PoolClient, value: Dispatch) {
    const id = await this.boss.send(RIGHTS_QUEUE, value, {
      id: value.dispatchId,
      retryLimit: 3,
      retryDelay: 2,
      expireInSeconds: 120,
      db: { executeSql: (sql, params) => db.query(sql, params) },
    })
    if (!id) throw new Error("Data rights enqueue failed")
  }
  async work(handler: (value: Dispatch) => Promise<void>) {
    await this.boss.work<Dispatch>(
      RIGHTS_QUEUE,
      { batchSize: 1, pollingIntervalSeconds: 0.5 },
      async (jobs) => {
        for (const item of jobs) await handler(item.data)
      },
    )
  }
  async isPending(db: PoolClient, value: Dispatch) {
    const jobs = await this.boss.findJobs<Dispatch>(RIGHTS_QUEUE, {
      data: value,
      limit: 10,
      db: { executeSql: (sql, params) => db.query(sql, params) },
    })
    return (
      jobs.length === 10 ||
      jobs.some((job) => ["created", "retry", "active"].includes(job.state))
    )
  }
  async stop() {
    await this.boss.stop({ graceful: true, timeout: 10000 })
  }
}
