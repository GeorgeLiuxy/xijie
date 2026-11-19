import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { Pool } from 'pg'
import { readConfig } from './config.js'
import { PeopleErrors, PeopleModule, peopleHeaders } from './http.js'
import { PeopleStore } from './store.js'
import type {NestExpressApplication} from '@nestjs/platform-express'
import {ReminderStore,reminderAccount} from './reminders.js'

const config = readConfig()
const pool = new Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5000, statement_timeout: 5000 })
pool.on('error', () => console.error('People database connection was interrupted.'))

try {
  await pool.query('SELECT 1 FROM people_schema_migrations LIMIT 1')
  const store = new PeopleStore(pool)
  await store.sweepCommands()
  const app = await NestFactory.create<NestExpressApplication>(PeopleModule.register(config, store), {
    abortOnError: false, logger: ['warn', 'error'],
  })
  app.useBodyParser('json',{limit:'1mb'})
  const http = app.getHttpAdapter().getInstance()
  http.disable('x-powered-by')
  http.disable('etag')
  app.use(peopleHeaders)
  app.useGlobalFilters(new PeopleErrors())
  app.enableShutdownHooks()
  await app.listen(config.port, config.host)
  const reminderStore=new ReminderStore(pool)
  let scanningReminders=false
  const scanReminders=async()=>{if(scanningReminders)return;scanningReminders=true;try{await reminderStore.tick(account=>reminderAccount(config,account))}catch{console.error('Due person reminders could not be checked. They will be retried.')}finally{scanningReminders=false}}
  void scanReminders()
  const reminderTimer=setInterval(()=>void scanReminders(),60_000).unref()
  const cleanup = setInterval(() => {
    void store.sweepCommands().catch(() => console.error('Expired draft idempotency records could not be cleared.'))
  }, 60 * 60_000).unref()
  app.getHttpServer().once('close', () => { clearInterval(cleanup);clearInterval(reminderTimer); void pool.end() })
  console.log('People service listening on ' + config.host + ':' + config.port)
} catch (error) {
  await pool.end()
  const kind = error instanceof Error ? error.name : typeof error
  console.error('People startup failed. Verify the database migration and configuration.', kind)
  process.exitCode = 1
}
