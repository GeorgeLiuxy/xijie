import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { ContextProvider } from './dependencies.js';
import { giftCatalog } from './catalog.js';
import { GiftsError, missing, invalid, hash, dto, permitted, voucherEligible, displayable, type Account, type SendInput, type DeliveryRow, type GiftDefinition } from './contracts.js';
import type {FinancialRetentionPolicy} from './financial-rights.js';
export type Job = {
    id: string;
    account_id: string;
    delivery_id: string;
    kind: 'deliver' | 'project';
    delivery_version: number;
    attempt_id: string;
};
export class GiftsStore {
    constructor(readonly pool: Pool, readonly dependencies: ContextProvider,readonly options:{returnEnabled?:boolean;financialRetention?:FinancialRetentionPolicy}={}) { }
    async gate(db: PoolClient, id: string) { await db.query('INSERT INTO gifts_account_write_gates(account_id) VALUES($1) ON CONFLICT DO NOTHING', [id]); const r = (await db.query('SELECT * FROM gifts_account_write_gates WHERE account_id=$1 FOR UPDATE', [id])).rows[0]; if (r.erased_at)
        throw missing(); return r; }
    async tx<T>(id: string, fn: (db: PoolClient) => Promise<T>) { const db = await this.pool.connect(); try {
        await db.query('BEGIN');
        await this.gate(db, id);
        const v = await fn(db);
        await db.query('COMMIT');
        return v;
    }
    catch (e) {
        await db.query('ROLLBACK');
        throw e;
    }
    finally {
        db.release();
    } }
    async seedCatalog() { for (const g of giftCatalog)
        await this.pool.query('INSERT INTO gift_catalog_items(id,version,snapshot) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING', [g.id, g.version, g]); }
    async authority(id: string) { return permitted(await this.dependencies.account(id)); }
    same(a: Account, b: Account) { permitted(b); if (a.accessVersion !== b.accessVersion || a.giftStorage?.authorizationVersion !== b.giftStorage?.authorizationVersion)
        throw new GiftsError(409, 'AUTHORIZATION_CHANGED'); }
    async row(account: string, id: string, db: Pool | PoolClient = this.pool): Promise<DeliveryRow> { const r = (await db.query('SELECT d.* FROM gift_deliveries d JOIN gifts_account_write_gates g ON g.account_id=d.account_id WHERE d.account_id=$1 AND d.id=$2 AND g.erased_at IS NULL', [account, id])).rows[0]; if (!r)
        throw missing(); return r; }
    async get(account: string, id: string) { const a = await this.authority(account); const r = await this.row(account, id); await this.dependencies.person(account, r.person_id); this.same(a, await this.dependencies.account(account)); return dto(r); }
    async source(account: string, id: string) { const a = await this.authority(account), r = await this.row(account, id); if (r.gift_authorization_version !== a.giftStorage!.authorizationVersion || r.account_access_version !== a.accessVersion)
        throw missing(); await this.dependencies.person(account, r.person_id); this.same(a, await this.dependencies.account(account)); return dto(r); }
    async catalog(account: string, personId?: string) { await this.authority(account); if (personId)
        await this.dependencies.person(account, personId); const wallet = await this.wallet(account); return (await this.pool.query('SELECT snapshot FROM gift_catalog_items ORDER BY id')).rows.map(r => { const g = r.snapshot as GiftDefinition, sendable = g.available && g.audience.includes('person') && ['keepsake', 'prop'].includes(g.effect); return { ...g, unitPostage: g.cost, acceptsVoucher: voucherEligible(g), availableSources: sendable ? ['trial', ...(wallet.balances.some((b: any) => b.assetType === 'inventory' && b.assetId === g.id && b.availableUnits > 0) ? ['inventory'] : []), ...(voucherEligible(g) && wallet.balances.some((b: any) => b.assetType === 'voucher' && b.assetId === 'return-stamp' && b.availableUnits > 0) ? ['voucher'] : [])] : [], ...(!sendable ? { unavailableReason: 'GIFT_UNAVAILABLE' } : {}) }; }); }
    async wallet(account: string) { await this.authority(account); const result = await this.pool.query(`SELECT g.version,clock_timestamp() AS now,COALESCE((SELECT jsonb_agg(x) FROM(SELECT asset_type AS "assetType",asset_id AS "assetId",source,sum(balance_units-reserved_units)::int AS "availableUnits",min(expires_at) AS "nearestExpiryAt" FROM asset_lots WHERE account_id=$1 AND(expires_at IS NULL OR expires_at>statement_timestamp()) GROUP BY asset_type,asset_id,source ORDER BY asset_type,asset_id,source)x),'[]'::jsonb) AS balances FROM gifts_account_write_gates g WHERE account_id=$1 AND erased_at IS NULL`, [account]); if (!result.rows[0])
        return { version: 1, asOf: new Date().toISOString(), balances: [] }; const r = result.rows[0]; return { version: r.version, asOf: r.now.toISOString(), balances: r.balances }; }
    async ledger(account: string, limit: number, before?: string) { await this.authority(account); return (await this.pool.query(`SELECT t.id AS "transactionId",t.reason,t.source_id AS "sourceId",t.created_at AS "createdAt",t.policy_version AS "policyVersion",t.original_transaction_id AS "originalTransactionId",COALESCE((SELECT jsonb_agg(jsonb_build_object('assetType',l.asset_type,'assetId',l.asset_id,'source',l.source,'direction',e.direction,'units',e.units,'lotId',e.lot_id) ORDER BY e.line_no) FROM ledger_entries e JOIN asset_lots l ON(l.account_id,l.id)=(e.account_id,e.lot_id) WHERE e.account_id=t.account_id AND e.transaction_id=t.id),'[]'::jsonb) AS entries FROM ledger_transactions t JOIN gifts_account_write_gates g ON g.account_id=t.account_id WHERE t.account_id=$1 AND g.erased_at IS NULL AND($2::uuid IS NULL OR(t.created_at,t.id)<(SELECT created_at,id FROM ledger_transactions WHERE account_id=$1 AND id=$2)) ORDER BY t.created_at DESC,t.id DESC LIMIT $3`, [account, before ?? null, limit])).rows; }
    async list(account: string, limit: number, filter: {
        personId?: string;
        status?: string;
        displayable?: boolean;
        cursor?: string;
    }) { await this.authority(account); if (filter.personId)
        await this.dependencies.person(account, filter.personId); const rows = (await this.pool.query<DeliveryRow>(`SELECT d.* FROM gift_deliveries d JOIN gifts_account_write_gates g ON g.account_id=d.account_id WHERE d.account_id=$1 AND g.erased_at IS NULL AND($2::uuid IS NULL OR d.person_id=$2) AND($3::text IS NULL OR d.status=$3) AND($4::uuid IS NULL OR(d.created_at,d.id)<(SELECT created_at,id FROM gift_deliveries WHERE account_id=$1 AND id=$4)) ORDER BY d.created_at DESC,d.id DESC LIMIT $5`, [account, filter.personId ?? null, filter.status ?? null, filter.cursor ?? null, limit])).rows; const visible = []; for (const r of rows) {
        try {
            await this.dependencies.person(account, r.person_id);
        }
        catch (e) {
            if (e instanceof GiftsError && e.status === 404)
                continue;
            throw e;
        }
        if (filter.displayable && (r.status !== 'arrived' || !displayable(r.gift_snapshot)))
            continue;
        visible.push(dto(r));
    } return { items: visible, next: rows.length === limit ? rows.at(-1)!.id : null }; }
    async event(db: PoolClient, account: string, type: string, id: string, version: number, payload: unknown) { const inserted=await db.query('INSERT INTO outbox_events(id,account_id,type,aggregate_id,aggregate_version,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id', [randomUUID(), account, type, id, version, payload]);return inserted.rows[0]?.id??(await db.query('SELECT id FROM outbox_events WHERE account_id=$1 AND type=$2 AND aggregate_id=$3 AND aggregate_version=$4',[account,type,id,version])).rows[0].id; }
    async bump(db: PoolClient, account: string) { return (await db.query('UPDATE gifts_account_write_gates SET version=version+1,updated_at=clock_timestamp() WHERE account_id=$1 RETURNING version', [account])).rows[0].version as number; }
    async audit(db: PoolClient, account: string) { const invalid = (await db.query(`SELECT 1 FROM asset_lots l WHERE l.account_id=$1 AND l.balance_units<>(SELECT COALESCE(sum(CASE WHEN e.direction='credit' THEN e.units ELSE -e.units END),0) FROM ledger_entries e WHERE e.account_id=l.account_id AND e.lot_id=l.id) LIMIT 1`, [account])).rowCount; if (invalid)
        throw new GiftsError(503, 'LEDGER_INCONSISTENT'); }
    async grantTrial(account: string, key: string, input: {
        postage: number;
        vouchers: number;
        inventory: Record<string, number>;
        expiresAt?: string;
    }) { await this.dependencies.account(account); const fp = hash(JSON.stringify(input)), policy = 'synthetic-trial-v1'; if (![input.postage, input.vouchers, ...Object.values(input.inventory)].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 1000) || Object.keys(input.inventory).some(id => !giftCatalog.some(g => g.id === id)) || input.expiresAt !== undefined && !Number.isFinite(Date.parse(input.expiresAt)))
        throw invalid(); return this.tx(account, async (db) => { const prior = (await db.query('SELECT id,request_hash FROM ledger_transactions WHERE account_id=$1 AND reason=\'trial_grant\' AND source_id=$2', [account, key])).rows[0]; if (prior) {
        if (prior.request_hash !== fp)
            throw new GiftsError(409, 'IDEMPOTENCY_CONFLICT');
        return { transactionId: prior.id };
    } if (input.expiresAt && !(await db.query('SELECT $1::timestamptz>clock_timestamp() AS valid', [input.expiresAt])).rows[0].valid)
        throw invalid(); const parts = [['postage', 'postage', input.postage], ['voucher', 'return-stamp', input.vouchers], ...Object.entries(input.inventory).map(([id, n]) => ['inventory', id, n])].filter(p => Number(p[2]) > 0); if (!parts.length)
        throw invalid(); const id = randomUUID(); await db.query("INSERT INTO ledger_transactions(id,account_id,reason,source_id,request_hash,policy_version) VALUES($1,$2,'trial_grant',$3,$4,$5)", [id, account, key, fp, policy]); for (const [i, [type, asset, units]] of parts.entries()) {
        const lot = randomUUID();
        await db.query("INSERT INTO asset_lots(id,account_id,asset_type,asset_id,source,balance_units,expires_at,policy_version,issuance_transaction_id) VALUES($1,$2,$3,$4,'trial',$5,$6,$7,$8)", [lot, account, type, asset, units, input.expiresAt ?? null, policy, id]);
        await db.query("INSERT INTO ledger_entries(account_id,transaction_id,line_no,lot_id,direction,units) VALUES($1,$2,$3,$4,'credit',$5)", [account, id, i + 1, lot, units]);
    } await this.audit(db, account); const walletVersion=await this.bump(db, account); await this.event(db, account, 'AssetLedgerCommitted.v1', id, 1, {transactionId:id,walletVersion,reason:'trial_grant',sourceId:key}); await this.event(db, account, 'TrialAssetsGranted.v1', id, 1, { transactionId: id, policyVersion: policy }); return { transactionId: id }; }); }
    private async debit(db: PoolClient, account: string, id: string, input: SendInput, g: GiftDefinition) { const amount = input.source === 'trial' ? g.cost * input.quantity : input.source === 'voucher' ? 1 : input.quantity; if (!amount)
        return null; const type = input.source === 'trial' ? 'postage' : input.source === 'voucher' ? 'voucher' : 'inventory', asset = type === 'postage' ? 'postage' : type === 'voucher' ? 'return-stamp' : g.id; const locked = (await db.query("SELECT * FROM asset_lots WHERE account_id=$1 AND asset_type=$2 AND asset_id=$3 AND (source IN('trial','paid') OR($4::boolean AND source='promotion')) AND balance_units>reserved_units AND(expires_at IS NULL OR expires_at>clock_timestamp()) ORDER BY id FOR UPDATE", [account, type, asset, input.source === 'voucher'])).rows; const now = (await db.query('SELECT clock_timestamp() AS now')).rows[0].now.getTime(); const lots = locked.filter(l => !l.expires_at || l.expires_at.getTime() > now).sort((a, b) => (a.expires_at?.getTime() ?? Infinity) - (b.expires_at?.getTime() ?? Infinity) || a.issued_at - b.issued_at || a.id.localeCompare(b.id)); if (lots.reduce((n, l) => n + l.balance_units - l.reserved_units, 0) < amount)
        throw new GiftsError(409, 'INSUFFICIENT_ASSET'); const tx = randomUUID(); await db.query("INSERT INTO ledger_transactions(id,account_id,reason,source_id,request_hash,policy_version) VALUES($1,$2,'gift_debit',$3,$4,'gift-trial-v1')", [tx, account, id, hash(JSON.stringify(input))]); let remaining = amount, line = 0; for (const l of lots) {
        const units = Math.min(remaining, l.balance_units-l.reserved_units);
        if (!units)
            break;
        await db.query('UPDATE asset_lots SET balance_units=balance_units-$3,updated_at=clock_timestamp() WHERE account_id=$1 AND id=$2', [account, l.id, units]);
        await db.query("INSERT INTO ledger_entries(account_id,transaction_id,line_no,lot_id,direction,units) VALUES($1,$2,$3,$4,'debit',$5)", [account, tx, ++line, l.id, units]);
        remaining -= units;
    } await this.audit(db, account); const walletVersion=await this.bump(db, account); await this.event(db, account, 'AssetLedgerCommitted.v1', tx, 1, {transactionId:tx,walletVersion,reason:'gift_debit',sourceId:id}); return tx; }
    async send(account: string, key: string, input: SendInput) { const a = await this.authority(account), fp = hash(JSON.stringify(input)); const existing = (await this.pool.query('SELECT * FROM gift_deliveries WHERE account_id=$1 AND acceptance_key=$2', [account, key])).rows[0]; if (existing) {
        if (existing.request_hash !== fp)
            throw new GiftsError(409, 'IDEMPOTENCY_CONFLICT');
        return this.get(account, existing.id);
    } const person = await this.dependencies.person(account, input.personId), conversation = await this.dependencies.ensure(account, input.personId); this.same(a, await this.dependencies.account(account)); const result = await this.tx(account, async (db) => { const retry = (await db.query('SELECT * FROM gift_deliveries WHERE account_id=$1 AND acceptance_key=$2', [account, key])).rows[0]; if (retry) {
        if (retry.request_hash !== fp)
            throw new GiftsError(409, 'IDEMPOTENCY_CONFLICT');
        return dto(retry);
    } const catalog = (await db.query('SELECT * FROM gift_catalog_items WHERE id=$1 FOR SHARE', [input.giftId])).rows[0]; if (!catalog)
        throw new GiftsError(422, 'GIFT_UNAVAILABLE'); if (catalog.version !== input.catalogVersion)
        throw new GiftsError(409, 'CATALOG_VERSION_CHANGED'); const g = catalog.snapshot as GiftDefinition; if (!g.available || ['build', 'fuel', 'service', 'scene'].includes(g.effect) || !g.audience.includes('person'))
        throw new GiftsError(422, 'GIFT_UNAVAILABLE'); if (!g.stackable && input.quantity !== 1)
        throw invalid(); if (input.source === 'voucher' && (!voucherEligible(g) || input.quantity !== 1))
        throw new GiftsError(422, 'VOUCHER_NOT_APPLICABLE'); const returnAllowed=a.giftReturns?.allowed===true&&Number.isSafeInteger(a.giftReturns.authorizationVersion)&&a.giftReturns.authorizationVersion>0&&a.storyStorage?.allowed===true&&Number.isSafeInteger(a.storyStorage.authorizationVersion)&&a.storyStorage.authorizationVersion>0; const id = randomUUID(), debit = await this.debit(db, account, id, input, g), { accountId, status, ...snapshot } = person; const r = (await db.query("INSERT INTO gift_deliveries(id,account_id,acceptance_key,request_hash,person_id,conversation_id,person_snapshot,gift_snapshot,quantity,note,source,cost,scheduled_arrival_at,debit_transaction_id,account_access_version,gift_authorization_version,return_authorization_version,story_authorization_version,return_policy_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,clock_timestamp()+interval '8 seconds',$13,$14,$15,$16,$17,$18) RETURNING *", [id, account, key, fp, input.personId, conversation.id, snapshot, g, input.quantity, input.note, input.source, input.source === 'trial' ? g.cost * input.quantity : 0, debit, a.accessVersion, a.giftStorage!.authorizationVersion,returnAllowed?a.giftReturns!.authorizationVersion:null,returnAllowed?a.storyStorage!.authorizationVersion:null,returnAllowed?'person-gift-returns-v1':null])).rows[0]; await db.query("INSERT INTO gifts_jobs(id,account_id,delivery_id,kind,delivery_version,retry_at) VALUES($1,$2,$3,'deliver',1,$4)", [randomUUID(), account, id, r.scheduled_arrival_at]); await this.projectJob(db, r); await this.event(db, account, 'GiftDeliveryAccepted.v1', id, 1, { deliveryId: id, personId: input.personId, conversationId: conversation.id,acceptedAt:r.created_at.toISOString(),scheduledArrivalAt:r.scheduled_arrival_at.toISOString() }); return dto(r); }); this.same(a, await this.dependencies.account(account)); return result; }
    private async projectJob(db: PoolClient, r: DeliveryRow) { await db.query("INSERT INTO gifts_jobs(id,account_id,delivery_id,kind,delivery_version) VALUES($1,$2,$3,'project',$4) ON CONFLICT DO NOTHING", [randomUUID(), r.account_id, r.id, r.version]); }
    async claim(): Promise<Job | undefined> { return (await this.pool.query("WITH candidate AS(SELECT j.id FROM gifts_jobs j JOIN gifts_account_write_gates g ON g.account_id=j.account_id WHERE g.erased_at IS NULL AND((j.state IN('queued','failed') AND j.retry_at<=clock_timestamp()) OR(j.state='running' AND j.lease_until<=clock_timestamp())) ORDER BY j.retry_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1) UPDATE gifts_jobs j SET state='running',attempt_id=$1,attempt_count=attempt_count+1,lease_until=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp(),version=version+1 FROM candidate c WHERE j.id=c.id RETURNING j.*", [randomUUID()])).rows[0]; }
    async settle(job: Job, failed = false, reason = 'TARGET_UNAVAILABLE') { return this.tx(job.account_id, async (db) => { const j = (await db.query("SELECT * FROM gifts_jobs WHERE id=$1 AND attempt_id=$2 AND state='running' AND lease_until>clock_timestamp() FOR UPDATE", [job.id, job.attempt_id])).rows[0]; if (!j)
        return; const r = await this.row(job.account_id, job.delivery_id, db); if (r.status === 'in_transit') {
        if (!(await db.query('SELECT scheduled_arrival_at<=clock_timestamp() AS due FROM gift_deliveries WHERE account_id=$1 AND id=$2', [job.account_id, r.id])).rows[0].due)
            throw new GiftsError(409, 'DELIVERY_NOT_DUE');
        let reversal: string | null = null;
        if (failed && r.debit_transaction_id) {
            reversal = randomUUID();
            await db.query("INSERT INTO ledger_transactions(id,account_id,reason,source_id,request_hash,policy_version,original_transaction_id) VALUES($1,$2,'gift_reversal',$3,$4,'gift-trial-v1',$5)", [reversal, job.account_id, 'gift_reversal:' + r.id, hash(r.id), r.debit_transaction_id]);
            const entries = (await db.query('SELECT * FROM ledger_entries WHERE account_id=$1 AND transaction_id=$2 ORDER BY line_no', [job.account_id, r.debit_transaction_id])).rows;
            for (const e of entries) {
                await db.query('UPDATE asset_lots SET balance_units=balance_units+$3,updated_at=clock_timestamp() WHERE account_id=$1 AND id=$2', [job.account_id, e.lot_id, e.units]);
                await db.query("INSERT INTO ledger_entries(account_id,transaction_id,line_no,lot_id,direction,units) VALUES($1,$2,$3,$4,'credit',$5)", [job.account_id, reversal, e.line_no, e.lot_id, e.units]);
            }
            await this.audit(db, job.account_id);
            const walletVersion=await this.bump(db, job.account_id);
            await this.event(db, job.account_id, 'AssetLedgerCommitted.v1', reversal, 1, {transactionId:reversal,walletVersion,reason:'gift_reversal',sourceId:'gift_reversal:'+r.id});
        }
        const changed = (await db.query("UPDATE gift_deliveries SET status=$3,arrived_at=CASE WHEN $3='arrived' THEN clock_timestamp() ELSE NULL END,failed_at=CASE WHEN $3='delivery_failed' THEN clock_timestamp() ELSE NULL END,updated_at=clock_timestamp(),version=version+1,reversal_transaction_id=$4,failure_code=CASE WHEN $3='delivery_failed' THEN $5 ELSE NULL END WHERE account_id=$1 AND id=$2 AND status='in_transit' RETURNING *", [job.account_id, r.id, failed ? 'delivery_failed' : 'arrived', reversal, reason])).rows[0];
        await this.projectJob(db, changed);
        const eventId=await this.event(db, job.account_id, failed ? 'GiftDeliveryFailed.v1' : 'GiftDeliveryArrived.v1', r.id, changed.version, { deliveryId: r.id, personId: r.person_id, conversationId: r.conversation_id,...(failed?{failedAt:changed.failed_at.toISOString()}:{arrivedAt:changed.arrived_at.toISOString()}) });
        await db.query("INSERT INTO gift_notifications(id,account_id,type,source_event_id,object_id,person_id,object_kind) VALUES($1,$2,$3,$4,$5,$6,'delivery') ON CONFLICT DO NOTHING",[randomUUID(),job.account_id,failed?'gift_failed':'gift_arrived',eventId,r.id,r.person_id]);
        if(!failed&&this.options.returnEnabled&&r.return_authorization_version&&r.story_authorization_version)await db.query("INSERT INTO gift_return_jobs(id,account_id,source_delivery_id,source_delivery_version,account_access_version,gift_authorization_version,story_authorization_version,return_authorization_version,policy_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING",[randomUUID(),r.account_id,r.id,changed.version,r.account_access_version,r.gift_authorization_version,r.story_authorization_version,r.return_authorization_version,r.return_policy_version]);
    } await this.finish(db, job); }); }
    async finish(db: Pool | PoolClient, job: Job) { await db.query("UPDATE gifts_jobs SET state='succeeded',attempt_id=NULL,lease_until=NULL,finished_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE id=$1 AND attempt_id=$2 AND state='running'", [job.id, job.attempt_id]); }
    async block(job: Job, code: string) { await this.tx(job.account_id, async (db) => { await db.query("UPDATE gifts_jobs SET state='blocked',attempt_id=NULL,lease_until=NULL,finished_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1,failure_code=$3 WHERE id=$1 AND attempt_id=$2 AND state='running'", [job.id, job.attempt_id, code]); }); }
    async run(job: Job) {
        try {
            const r = await this.row(job.account_id, job.delivery_id), before = await this.dependencies.account(job.account_id);
            const permissionInvalid = (a: Account) => !a.giftStorage?.allowed || a.giftStorage.authorizationVersion !== r.gift_authorization_version || a.accessVersion !== r.account_access_version;
            if (job.kind === 'project') {
                if (permissionInvalid(before)) {
                    await this.block(job, 'AUTHORIZATION_CHANGED');
                    return;
                }
                try {
                    await this.dependencies.person(job.account_id, r.person_id);
                }
                catch (e) {
                    if (e instanceof GiftsError && e.status === 404) {
                        await this.block(job, 'TARGET_UNAVAILABLE');
                        return;
                    }
                    throw e;
                }
                if (permissionInvalid(await this.dependencies.account(job.account_id))) {
                    await this.block(job, 'AUTHORIZATION_CHANGED');
                    return;
                }
                await this.dependencies.project(job.account_id, dto(r));
                await this.tx(job.account_id, db => this.finish(db, job));
                return;
            }
            let invalidTarget = false;
            if (!permissionInvalid(before))
                try {
                    const p = await this.dependencies.person(job.account_id, r.person_id);
                    invalidTarget = p.accessVersion !== r.person_snapshot.accessVersion;
                }
                catch (e) {
                    if (e instanceof GiftsError && e.status === 404)
                        invalidTarget = true;
                    else
                        throw e;
                }
            const changed = permissionInvalid(before) || permissionInvalid(await this.dependencies.account(job.account_id));
            await this.settle(job, invalidTarget || changed, changed ? 'AUTHORIZATION_CHANGED' : 'TARGET_UNAVAILABLE');
        }
        catch (e) {
            const code = e instanceof GiftsError ? e.code : 'DEPENDENCY_UNAVAILABLE';
            await this.pool.query("UPDATE gifts_jobs j SET state='failed',attempt_id=NULL,lease_until=NULL,retry_at=clock_timestamp()+interval '5 seconds',updated_at=clock_timestamp(),version=j.version+1,failure_code=$3 FROM gifts_account_write_gates g WHERE g.account_id=j.account_id AND g.erased_at IS NULL AND j.id=$1 AND j.attempt_id=$2", [job.id, job.attempt_id, code]).catch(() => { });
        }
    }
}
