import { Pool } from 'pg';
import { readConfig } from './config.js';
import { Dependencies } from './dependencies.js';
import { GiftsStore } from './store.js';
import { ReferralRewardsStore, ReferralRewardsWorker } from './referrals.js';
import {CommerceStore} from './commerce.js';
import {createCommerceIntegration} from './jeepay-provider.js';
import {FinancialOperations} from './financial-operations.js';
const config = readConfig(), pool = new Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5000, statement_timeout: 10000 }), store = new GiftsStore(pool, new Dependencies(config),{returnEnabled:config.returnEnabled});
pool.on('error', () => console.error('Gifts worker database interrupted.'));
const referrals=config.memoriesOrigin?new ReferralRewardsWorker(new ReferralRewardsStore(store)):undefined;
const commerce=new CommerceStore(store,createCommerceIntegration(config.commerce));
const operations=new FinancialOperations(store,commerce);
let stopped = false, active: Promise<void> | undefined, timer: NodeJS.Timeout | undefined, referralTimer:NodeJS.Timeout|undefined, activeReferrals:Promise<void>|undefined,retentionTimer:NodeJS.Timeout|undefined,activeRetention:Promise<void>|undefined;
async function sweepRetention(){if(stopped||activeRetention)return;activeRetention=operations.purgeDue().then(()=>{}).catch(()=>{console.error('Financial retention cleanup will retry.')});try{await activeRetention}finally{activeRetention=undefined}}
async function pollReferrals(){if(stopped||!referrals||activeReferrals)return;activeReferrals=(async()=>{try{await referrals.poll()}catch{console.error('Gifts referral reconciliation will retry.')}})();try{await activeReferrals}finally{activeReferrals=undefined}}
async function tick() { if (stopped || active)
    return; active = (async () => { try {
    const job = await store.claim();
    if (job)
        await store.run(job);
    const financial=await commerce.claim();if(financial)await commerce.run(financial);
}
catch {
    console.error('Gifts job will retry.');
} })(); try {
    await active;
}
finally {
    active = undefined;
} }
async function stop() { if(stopped)return;stopped = true; clearInterval(timer);clearInterval(referralTimer);clearInterval(retentionTimer);referrals?.stop();commerce.stop(); await Promise.all([active,activeReferrals,activeRetention]); await pool.end(); }
try {
    await pool.query('SELECT 1 FROM gifts_jobs LIMIT 1');
    await pool.query('SELECT 1 FROM referral_reward_awards a FULL JOIN referral_reward_receipts r ON false LIMIT 0');
    await pool.query('SELECT l.reserved_units FROM asset_lots l FULL JOIN album_reward_receipts a ON false FULL JOIN commerce_reconciliation_jobs j ON false LIMIT 0');
    process.once('SIGINT', () => { void stop(); });
    process.once('SIGTERM', () => { void stop(); });
    timer = setInterval(() => { void tick(); }, 500);
    if(referrals){referralTimer=setInterval(()=>{void pollReferrals()},5000);void pollReferrals();}
    await tick();
    retentionTimer=setInterval(()=>{void sweepRetention()},60000);await sweepRetention();
    console.log('Gifts worker listening.');
}
catch {
    await stop().catch(() => { });
    console.error('Gifts worker startup failed.');
    process.exitCode = 1;
}
