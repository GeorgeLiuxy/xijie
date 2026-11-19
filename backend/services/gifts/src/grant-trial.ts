import { Pool } from 'pg';
import { readConfig } from './config.js';
import { Dependencies } from './dependencies.js';
import { GiftsStore } from './store.js';
import { identifier } from './contracts.js';
const [accountArg, key, postageArg, vouchersArg, inventoryArg = '{}'] = process.argv.slice(2);
if (process.env.NODE_ENV === 'production' || process.env.GIFTS_TRIAL_ISSUANCE_ENABLED !== 'true')
    throw Error('Synthetic trial issuance is disabled');
const account = identifier(accountArg), allowed = (process.env.GIFTS_SYNTHETIC_ACCOUNT_IDS ?? '').split(',').map(v => v.trim());
if (!allowed.includes(account) || !/^synthetic-trial-v1:[a-z0-9-]{1,100}$/.test(key ?? ''))
    throw Error('Synthetic account and policy must be explicitly configured');
const config = readConfig(), pool = new Pool({ connectionString: config.databaseUrl }), store = new GiftsStore(pool, new Dependencies(config));
try {
    await store.grantTrial(account, key, { postage: Number(postageArg), vouchers: Number(vouchersArg), inventory: JSON.parse(inventoryArg) });
    console.log('Explicit synthetic trial grant recorded.');
}
finally {
    await pool.end();
}
