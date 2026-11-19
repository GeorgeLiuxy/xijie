import { GiftsError, hash, missing } from './contracts.js';
import type { GiftsStore } from './store.js';
import {financialRetentionPlan,type FinancialRetention} from './financial-rights.js';
export class GiftsDataRights {
    constructor(readonly store: GiftsStore) { }
    async authorize(account: string, request: string, kind: 'export' | 'delete_account', scope?: string) { const r = await this.store.dependencies.dataRequest(request); if (r.accountId !== account || r.requestId !== request || r.kind !== kind || scope && r.scope !== scope || kind === 'export' && r.accountStatus !== 'active' || kind === 'delete_account' && (r.scope !== 'account_data' || !['deletion_pending', 'deleted'].includes(r.accountStatus)))
        throw new GiftsError(403, 'FORBIDDEN'); return r; }
    async preflight(account:string,request:string){const context=await this.authorize(account,request,'delete_account');if(context.accountStatus!=='deletion_pending'||!['accepted','processing'].includes(context.status))throw new GiftsError(403,'FORBIDDEN');const db=await this.store.pool.connect();try{await db.query('BEGIN');await db.query('INSERT INTO gifts_account_write_gates(account_id) VALUES($1) ON CONFLICT DO NOTHING',[account]);const gate=(await db.query('SELECT erased_at,request_id FROM gifts_account_write_gates WHERE account_id=$1 FOR UPDATE',[account])).rows[0];let financialRetention:FinancialRetention;if(gate.erased_at){if(gate.request_id!==request)throw new GiftsError(409,'IDEMPOTENCY_CONFLICT');financialRetention=(await db.query('SELECT financial_retention FROM gifts_erase_receipts WHERE account_id=$1',[account])).rows[0]?.financial_retention??{status:'none'}}else financialRetention=await financialRetentionPlan(db,account,request,this.store.options.financialRetention);await db.query('COMMIT');return{accountId:account,requestId:request,allowed:true,checkedAt:new Date().toISOString(),financialRetention}}catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}}
    async snapshot(account: string) { const db = await this.store.pool.connect(); try {
        await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        if ((await db.query('SELECT 1 FROM gifts_account_write_gates WHERE account_id=$1 AND erased_at IS NOT NULL', [account])).rowCount)
            throw missing();
        const tables=['asset_lots','ledger_transactions','ledger_entries','referral_reward_receipts','album_reward_receipts','gift_deliveries','gift_return_jobs','received_gifts','gift_received_projection_jobs','gift_notifications','gift_mutation_receipts','gift_delivery_photos','gift_photo_commands','outbox_events','commerce_quotes','commerce_orders','commerce_payment_attempts','commerce_refunds','commerce_refund_reservations','commerce_verified_evidence','commerce_commands','commerce_reconciliation_jobs'];
        const estimated=(await db.query('SELECT '+tables.map(table=>"COALESCE((SELECT sum(octet_length((to_jsonb(t)-'request_hash'-'acceptance_key'-'launch_url')::text)+1) FROM "+table+' t WHERE account_id=$1),0)').join('+')+' AS bytes',[account])).rows[0].bytes;
        if(Number(estimated)+256>20*1024*1024)throw new GiftsError(413,'EXPORT_TOO_LARGE');
        const data: Record<string, unknown> = {financialRetentionPolicy:this.store.options.financialRetention?{policyVersion:this.store.options.financialRetention.version,days:this.store.options.financialRetention.days,startsAt:'deletion_preflight',scope:'minimal_financial_records'}:null};
        for (const [name, table, order] of [['lots', 'asset_lots', 'id'], ['transactions', 'ledger_transactions', 'created_at,id'], ['entries', 'ledger_entries', 'transaction_id,line_no'], ['referralRewards','referral_reward_receipts','created_at,referral_id'], ['albumRewards','album_reward_receipts','created_at,album_id'], ['deliveries', 'gift_deliveries', 'created_at,id'], ['returnJobs','gift_return_jobs','created_at,id'], ['receivedGifts','received_gifts','created_at,id'], ['receivedProjectionJobs','gift_received_projection_jobs','created_at,id'], ['notifications','gift_notifications','created_at,id'], ['mutationReceipts','gift_mutation_receipts','created_at,acceptance_key'],['deliveryPhotos','gift_delivery_photos','delivery_id'],['photoCommands','gift_photo_commands','created_at,acceptance_key'],['commerceQuotes','commerce_quotes','created_at,id'],['orders','commerce_orders','created_at,id'],['paymentAttempts','commerce_payment_attempts','created_at,id'],['refunds','commerce_refunds','created_at,id'],['refundReservations','commerce_refund_reservations','refund_id,lot_id'],['paymentEvidence','commerce_verified_evidence','verified_at,id'],['commerceCommands','commerce_commands','created_at,acceptance_key'],['commerceJobs','commerce_reconciliation_jobs','created_at,id'],['events','outbox_events','occurred_at,id']])
            data[name] = (await db.query('SELECT to_jsonb(t)-\'request_hash\'-\'acceptance_key\'-\'launch_url\' AS value FROM ' + table + ' t WHERE account_id=$1 ORDER BY ' + order, [account])).rows.map(r => r.value);
        await db.query('COMMIT');
        return data;
    }
    catch (e) {
        await db.query('ROLLBACK');
        throw e;
    }
    finally {
        db.release();
    } }
    async export(account: string, request: string, scope: string) { const before = await this.authorize(account, request, 'export', scope), data = await this.snapshot(account), revision = hash(JSON.stringify(data)); if (Buffer.byteLength(JSON.stringify(data)) > 20 * 1024 * 1024)
        throw new GiftsError(413, 'EXPORT_TOO_LARGE'); const after = await this.authorize(account, request, 'export', scope); if (before.accountAccessVersion !== after.accountAccessVersion || revision !== hash(JSON.stringify(await this.snapshot(account))))
        throw new GiftsError(409, 'EXPORT_STALE'); return { schemaVersion: 1, domain: 'gifts', accountId: account, capturedAt: new Date().toISOString(), revision, data }; }
    async erase(account: string, request: string) { await this.authorize(account, request, 'delete_account'); const db = await this.store.pool.connect(); try {
        await db.query('BEGIN');
        await db.query('INSERT INTO gifts_account_write_gates(account_id) VALUES($1) ON CONFLICT DO NOTHING', [account]);
        const gate = (await db.query('SELECT * FROM gifts_account_write_gates WHERE account_id=$1 FOR UPDATE', [account])).rows[0];
        if (gate.erased_at) {
            if (gate.request_id !== request)
                throw new GiftsError(409, 'IDEMPOTENCY_CONFLICT');
            await db.query('COMMIT');
            const receipt=(await this.store.pool.query('SELECT financial_retention FROM gifts_erase_receipts WHERE account_id=$1',[account])).rows[0];return { accountId: account, requestId: request, erasedAt: gate.erased_at.toISOString(), alreadyErased: true,financialRetention:receipt?.financial_retention??{status:'none'} };
        }
        const financialRetention=await financialRetentionPlan(db,account,request,this.store.options.financialRetention);
        const stamp = (await db.query('UPDATE gifts_account_write_gates SET erased_at=clock_timestamp(),request_id=$2,version=version+1,updated_at=clock_timestamp() WHERE account_id=$1 RETURNING erased_at', [account, request])).rows[0].erased_at;
        await db.query('DELETE FROM referral_reward_awards WHERE inviter_account_id=$1 OR invitee_account_id=$1',[account]);
        for (const table of ['gift_received_projection_jobs','gift_notifications','gift_mutation_receipts','received_gifts','gift_return_jobs','gift_photo_commands','gift_delivery_photos','gifts_jobs', 'outbox_events', 'gift_deliveries', 'referral_reward_receipts', 'album_reward_receipts','commerce_operator_commands', 'commerce_reconciliation_jobs','commerce_commands','commerce_verified_evidence','commerce_refund_reservations','commerce_refunds','commerce_payment_attempts','commerce_orders','commerce_quotes','ledger_entries', 'asset_lots', 'ledger_transactions'])
            await db.query('DELETE FROM ' + table + ' WHERE account_id=$1', [account]);
        await db.query('INSERT INTO gifts_erase_receipts(account_id,request_id,erased_at,financial_retention) VALUES($1,$2,$3,$4)', [account, request, stamp,financialRetention]);
        await db.query('COMMIT');
        return { accountId: account, requestId: request, erasedAt: stamp.toISOString(), alreadyErased: false,financialRetention };
    }
    catch (e) {
        await db.query('ROLLBACK');
        throw e;
    }
    finally {
        db.release();
    } }
}
