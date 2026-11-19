import 'reflect-metadata';
import { Pool } from 'pg';
import { readConfig } from './config.js';
import { Dependencies } from './dependencies.js';
import { GiftsStore } from './store.js';
import { createGiftsApp } from './http.js';
import {CommerceStore} from './commerce.js';
import {createCommerceIntegration} from './jeepay-provider.js';
const config = readConfig(), pool = new Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5000, statement_timeout: 10000 }), store = new GiftsStore(pool, new Dependencies(config),{returnEnabled:config.returnEnabled,financialRetention:config.financialRetention});
pool.on('error', () => console.error('Gifts database interrupted.'));
try {
    await pool.query('SELECT 1 FROM gifts_schema_migrations LIMIT 1');
    await pool.query('SELECT 1 FROM referral_reward_awards a FULL JOIN referral_reward_receipts r ON false LIMIT 0');
    await pool.query('SELECT l.reserved_units FROM asset_lots l FULL JOIN album_reward_receipts a ON false FULL JOIN commerce_reconciliation_jobs j ON false LIMIT 0');
    await store.seedCatalog();
    const commerce=new CommerceStore(store,createCommerceIntegration(config.commerce));
    const app = await createGiftsApp(config, store,commerce);
    app.enableShutdownHooks();
    app.getHttpServer().once('close', () => { commerce.stop();void pool.end(); });
    await app.listen(config.port, config.host);
    console.log('Gifts service listening on ' + config.host + ':' + config.port);
}
catch {
    await pool.end();
    console.error('Gifts startup failed.');
    process.exitCode = 1;
}
