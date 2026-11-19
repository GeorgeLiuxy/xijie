import type { Pool, PoolClient } from 'pg';
import { GiftsError, hash, invalid, missing, unavailable, type Account, type DeliveryPhoto, type DeliveryRow, type PhotoReference } from './contracts.js';
import type { GiftsStore } from './store.js';

type PhotoRow = {
    account_id:string; delivery_id:string; version:number; media_id:string; media_version:number;
    mime_type:'image/webp'; byte_size:number; width:number; height:number; updated_at:Date;
};
type Command = { request_hash:string; result_version:number };
const conflict=()=>new GiftsError(412,'VERSION_CONFLICT');
function permitted(a:Account){
    if(a.status!=='active')throw missing();
    if(!a.giftStorage?.allowed)throw new GiftsError(403,'GIFT_STORAGE_PERMISSION_REQUIRED');
    if(!a.giftPhotoStorage?.allowed)throw new GiftsError(403,'GIFT_PHOTO_PERMISSION_REQUIRED');
    return a;
}
function same(a:Account,b:Account){
    permitted(b);
    if(a.accessVersion!==b.accessVersion||a.giftStorage?.authorizationVersion!==b.giftStorage?.authorizationVersion||a.giftPhotoStorage?.authorizationVersion!==b.giftPhotoStorage?.authorizationVersion)throw new GiftsError(409,'AUTHORIZATION_CHANGED');
}
function state(d:Pick<DeliveryRow,'id'|'created_at'>,p?:PhotoRow):DeliveryPhoto{
    return {deliveryId:d.id,version:p?.version??1,photo:p?{id:p.media_id,version:p.media_version,mimeType:p.mime_type,byteSize:p.byte_size,width:p.width,height:p.height}:null,updatedAt:(p?.updated_at??d.created_at).toISOString(),origin:'journey_capture'};
}

export class GiftPhotosStore {
    constructor(readonly store:GiftsStore){}
    async row(account:string,id:string,db:Pool|PoolClient=this.store.pool):Promise<PhotoRow|undefined>{
        return (await db.query<PhotoRow>('SELECT p.* FROM gift_delivery_photos p JOIN gifts_account_write_gates g ON g.account_id=p.account_id WHERE p.account_id=$1 AND p.delivery_id=$2 AND g.erased_at IS NULL',[account,id])).rows[0];
    }
    private async snapshot(account:string,id:string):Promise<DeliveryPhoto>{
        const r=(await this.store.pool.query<PhotoRow&{source_id:string;source_created_at:Date;source_status:string}>(`SELECT p.*,d.id AS source_id,d.created_at AS source_created_at,d.status AS source_status FROM gift_deliveries d
            LEFT JOIN gift_delivery_photos p ON(p.account_id,p.delivery_id)=(d.account_id,d.id)
            JOIN gifts_account_write_gates g ON g.account_id=d.account_id WHERE d.account_id=$1 AND d.id=$2 AND g.erased_at IS NULL`,[account,id])).rows[0];
        if(!r)throw missing();
        if(r.source_status!=='arrived')throw new GiftsError(409,'DELIVERY_NOT_ARRIVED');
        return state({id:r.source_id,created_at:r.source_created_at},r.media_id?r:undefined);
    }
    async target(account:string,id:string){
        const delivery=await this.store.row(account,id);
        if(delivery.status!=='arrived')throw new GiftsError(409,'DELIVERY_NOT_ARRIVED');
        await this.store.dependencies.person(account,delivery.person_id);
        return delivery;
    }
    async get(account:string,id:string){
        const a=permitted(await this.store.dependencies.account(account));
        await this.target(account,id);
        const result=await this.snapshot(account,id);
        same(a,await this.store.dependencies.account(account));
        return result;
    }
    async list(account:string,limit:number,cursor?:string){
        const a=permitted(await this.store.dependencies.account(account));
        // Use immutable receipt creation order. Replacing a photo cannot reorder the list.
        const rows=(await this.store.pool.query<{id:string}>(`SELECT d.id FROM gift_delivery_photos p JOIN gift_deliveries d ON(d.account_id,d.id)=(p.account_id,p.delivery_id)
            JOIN gifts_account_write_gates g ON g.account_id=d.account_id WHERE d.account_id=$1 AND g.erased_at IS NULL AND d.status='arrived'
            AND($2::uuid IS NULL OR(d.created_at,d.id)<(SELECT created_at,id FROM gift_deliveries WHERE account_id=$1 AND id=$2))
            ORDER BY d.created_at DESC,d.id DESC LIMIT $3`,[account,cursor??null,limit])).rows;
        const items:DeliveryPhoto[]=[];
        for(const r of rows){try{items.push(await this.get(account,r.id));}catch(e){if(e instanceof GiftsError&&e.status===404)continue;throw e;}}
        same(a,await this.store.dependencies.account(account));
        return {items,next:rows.length===limit?rows.at(-1)!.id:null};
    }
    private async command(account:string,key:string,fp:string,db:Pool|PoolClient=this.store.pool):Promise<Command|undefined>{
        const r=(await db.query<Command>('SELECT request_hash,result_version FROM gift_photo_commands WHERE account_id=$1 AND acceptance_key=$2',[account,key])).rows[0];
        if(r&&r.request_hash!==fp)throw new GiftsError(409,'IDEMPOTENCY_CONFLICT');
        return r;
    }
    async put(account:string,id:string,key:string,expected:number,mediaId:string){
        if(!Number.isSafeInteger(expected)||expected<1||expected>=2147483647)throw invalid();
        const fp=hash(JSON.stringify({deliveryId:id,expectedVersion:expected,mediaId})),a=permitted(await this.store.dependencies.account(account));
        await this.target(account,id);
        // Permanent receipt recognition precedes CAS and remote prebind: the old media may already be collected.
        if(await this.command(account,key,fp))return this.get(account,id);
        if(((await this.row(account,id))?.version??1)!==expected)throw conflict();
        if(!this.store.dependencies.bindPhoto)throw unavailable();
        const binding=await this.store.dependencies.bindPhoto(account,id,mediaId,expected+1);
        if(binding.deliveryId!==id||binding.photoVersion!==expected+1||binding.media.id!==mediaId)throw unavailable();
        await this.target(account,id);
        same(a,await this.store.dependencies.account(account));
        await this.store.tx(account,async db=>{
            const delivery=await this.store.row(account,id,db);
            if(delivery.status!=='arrived')throw new GiftsError(409,'DELIVERY_NOT_ARRIVED');
            if(await this.command(account,key,fp,db))return;
            if(((await this.row(account,id,db))?.version??1)!==expected)throw conflict();
            if(!(await db.query('SELECT $1::timestamptz>clock_timestamp() AS valid',[binding.expiresAt])).rows[0].valid)throw new GiftsError(409,'MEDIA_BINDING_EXPIRED');
            const m=binding.media;
            await db.query(`INSERT INTO gift_delivery_photos(account_id,delivery_id,version,media_id,media_version,mime_type,byte_size,width,height,account_access_version,gift_authorization_version,photo_authorization_version)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(account_id,delivery_id) DO UPDATE SET version=EXCLUDED.version,media_id=EXCLUDED.media_id,media_version=EXCLUDED.media_version,mime_type=EXCLUDED.mime_type,byte_size=EXCLUDED.byte_size,width=EXCLUDED.width,height=EXCLUDED.height,account_access_version=EXCLUDED.account_access_version,gift_authorization_version=EXCLUDED.gift_authorization_version,photo_authorization_version=EXCLUDED.photo_authorization_version,updated_at=clock_timestamp()`,
                [account,id,expected+1,m.id,m.version,m.mimeType,m.byteSize,m.width,m.height,a.accessVersion,a.giftStorage!.authorizationVersion,a.giftPhotoStorage!.authorizationVersion]);
            await db.query('INSERT INTO gift_photo_commands(account_id,acceptance_key,delivery_id,requested_media_id,request_hash,expected_version,result_version) VALUES($1,$2,$3,$4,$5,$6,$7)',[account,key,id,mediaId,fp,expected,expected+1]);
            await this.store.event(db,account,'GiftDeliveryPhotoUpdated',id,expected+1,{deliveryId:id,photoVersion:expected+1,mediaId:m.id,mediaVersion:m.version,origin:'journey_capture'});
        });
        same(a,await this.store.dependencies.account(account));
        return this.get(account,id);
    }
    // These service-only reads validate existence and references, not normal storage consent.
    // Withdrawal cannot turn an owned saved object into an orphan for Media GC or data rights.
    async source(account:string,id:string){
        const before=await this.store.dependencies.account(account);
        if(before.status!=='active')throw missing();
        await this.target(account,id);
        const after=await this.store.dependencies.account(account);
        if(after.status!=='active'||before.accessVersion!==after.accessVersion)throw missing();
        const p=await this.snapshot(account,id);
        return {deliveryId:id,accountId:account,status:'arrived' as const,photoVersion:p.version};
    }
    async validate(account:string,refs:PhotoReference[]){
        let before:Account;
        try{before=await this.store.dependencies.account(account);}catch(e){if(e instanceof GiftsError&&e.status===404)return{valid:[]};throw e;}
        if(before.status!=='active')return {valid:[]};
        const available=new Set<string>();
        for(const id of new Set(refs.map(ref=>ref.deliveryId))){
            try{
                await this.source(account,id);available.add(id);
            }catch(e){if(e instanceof GiftsError&&(e.status===404||e.code==='DELIVERY_NOT_ARRIVED'))continue;throw e;}
        }
        const after=await this.store.dependencies.account(account);
        if(after.status!=='active'||before.accessVersion!==after.accessVersion)return {valid:[]};
        // Match the latest local references after external checks, including any concurrent replacement.
        const rows=(await this.store.pool.query<PhotoRow>('SELECT p.* FROM gift_delivery_photos p JOIN gift_deliveries d ON(d.account_id,d.id)=(p.account_id,p.delivery_id) JOIN gifts_account_write_gates g ON g.account_id=p.account_id WHERE p.account_id=$1 AND p.delivery_id=ANY($2::uuid[]) AND g.erased_at IS NULL AND d.status=\'arrived\'',[account,[...available]])).rows;
        const current=new Map(rows.map(row=>[row.delivery_id,row]));
        return {valid:refs.filter(ref=>{const p=current.get(ref.deliveryId);return p?.version===ref.photoVersion&&p.media_id===ref.mediaId&&p.media_version===ref.version;})};
    }
}
