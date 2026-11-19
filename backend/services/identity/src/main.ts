import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { Pool } from 'pg'
import { readConfig } from './config.js'
import { ConsentStore } from './consent-store.js'
import { EmbeddedAuth } from './embedded.js'
import { IdentityErrors, IdentityModule, identityHeaders } from './http.js'
import { createOidcProvider } from './oidc.js'
import { IdentityStore } from './store.js'
import {readRightsConfig} from './rights-config.js'
import {RightsQueue} from './rights-queue.js'
import {RightsStore} from './rights.js'
import {ReferralsStore} from './referrals.js'
import {ModelExecutionStore} from './model-execution.js'
import {NativeAuthStore} from './native-auth.js'
import {PasswordAuth} from './password.js'
import {NativeWechatAuth} from './native-wechat.js'

const config = readConfig()
const rightsConfig=readRightsConfig(config)
let rightsQueue:RightsQueue|undefined
const pool = new Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5000, statement_timeout: 5000 })
pool.on('error', () => console.error('Identity database connection was interrupted.'))

try {
  await pool.query('SELECT 1 FROM policy_versions LIMIT 1')
  const store = new IdentityStore(pool)
  const referrals=new ReferralsStore(pool,store,config.referrals)
  await store.sweepExpired()
  const oidc = await createOidcProvider(config)
  const embedded = new EmbeddedAuth(pool, config, store, oidc)
  if(rightsConfig.enabled)rightsQueue=await new RightsQueue(config.databaseUrl,rightsConfig.queueSchema).start()
  const rights=rightsQueue?new RightsStore(pool,store,rightsConfig,rightsQueue):undefined
  await embedded.sweep()
  const consents=new ConsentStore(pool,store)
  const models=new ModelExecutionStore(pool,consents)
  const native=new NativeAuthStore(pool,store,oidc,config)
  const passwords=new PasswordAuth(pool,config,store,oidc)
  const wechat=new NativeWechatAuth(pool,store,native,oidc,config)
  await passwords.sweep()
  await native.sweep()
  const app = await NestFactory.create(IdentityModule.register(config, store, oidc, consents, embedded,rights,referrals,models,native,passwords,wechat), {
    abortOnError: false, logger: ['warn', 'error'],
  })
  app.getHttpAdapter().getInstance().disable('x-powered-by')
  app.use(identityHeaders)
  app.useGlobalFilters(new IdentityErrors())
  app.enableShutdownHooks()
  await app.listen(config.port, config.host)
  const cleanup = setInterval(() => {
    void passwords.sweep().catch(()=>console.error('Expired password operations could not be cleared.'))
    void native.sweep().catch(()=>console.error('Expired native sign-in requests could not be cleared.'))
    void store.sweepExpired().catch(() => console.error('Expired authentication attempts could not be cleared.'))
    void embedded.sweep().catch(() => console.error('Expired phone sign-in requests could not be cleared.'))
  }, 60_000).unref()
  app.getHttpServer().once('close', () => { clearInterval(cleanup);void passwords.close(); void rightsQueue?.stop().finally(()=>pool.end());if(!rightsQueue)void pool.end() })
  console.log('Identity service listening on ' + config.host + ':' + config.port)
} catch (error) {
  await pool.end()
  const kind = error instanceof Error ? error.name : typeof error
  console.error('Identity startup failed. Verify the database migration and provider configuration.', kind)
  process.exitCode = 1
}
