import { randomUUID, timingSafeEqual } from 'node:crypto';
import { ArgumentsHost, Body, Catch, Controller, ExceptionFilter, Get, HttpCode, HttpException, Inject, Module, Param, Patch, Post, Put, Query, Req, Res, type DynamicModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded, type Request, type Response } from 'express';
import type { GiftsConfig } from './config.js';
import { GiftsStore } from './store.js';
import { GiftsDataRights } from './data-rights.js';
import { GiftReturnsStore } from './returns.js';
import { GiftPhotosStore } from './photos.js';
import { AlbumRewardsStore } from './promotions.js';
import { CommerceStore } from './commerce.js';
import { GiftsError, missing, invalid, unavailable, identifier, object, sendInput } from './contracts.js';
const CONFIG = Symbol('GiftsConfig');
export function giftsHeaders(_req: Request, res: Response, next: () => void) { res.setHeader('X-Request-Id', randomUUID()); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff'); next(); }
@Catch()
export class GiftsErrors implements ExceptionFilter {
    catch(error: unknown, host: ArgumentsHost) { const res = host.switchToHttp().getResponse<Response>(); if (res.headersSent)
        return; let e = error instanceof GiftsError ? error : new GiftsError(500, 'INTERNAL_ERROR'); if (error instanceof HttpException && error.getStatus() < 500)
        e = error.getStatus() === 404 ? missing() : invalid(); if(error&&typeof error==='object'&&'type' in error&&error.type==='entity.too.large')e=new GiftsError(413,'REQUEST_TOO_LARGE');if(error&&typeof error==='object'&&'type' in error&&error.type==='entity.parse.failed')e=invalid(); if (error && typeof error === 'object' && 'code' in error && ['42501', '40001'].includes(String(error.code)))
        e = missing(); if (e.status === 500)
        console.error('Gifts request failed.', { requestId: res.getHeader('X-Request-Id'), type: error instanceof Error ? error.name : 'UnknownError' }); res.status(e.status).json({ error: { code: e.code, message: e.message, requestId: res.getHeader('X-Request-Id') } }); }
}
const single = (res: Response, data: {
    version: number;
}) => { res.setHeader('ETag', '"v' + data.version + '"'); return { data }; };
function token(req: Request, key: string) { const candidate = /^Bearer ([a-f0-9]{64})$/i.exec(req.get('Authorization') ?? '')?.[1]; if (!candidate || !timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(key, 'hex')))
    throw new GiftsError(403, 'FORBIDDEN'); }
function page(q: Record<string, unknown>, fields: string[] = []) { object(q, ['limit', 'cursor', ...fields]); const limit = q.limit === undefined ? 20 : Number(q.limit); if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || q.limit !== undefined && !/^[1-9][0-9]*$/.test(String(q.limit)))
    throw invalid(); return { limit, cursor: q.cursor === undefined ? undefined : identifier(q.cursor) }; }
function expected(r:Request){const value=r.get('If-Match');if(!value)throw new GiftsError(428,'PRECONDITION_REQUIRED');const m=/^"v([1-9][0-9]*)"$/.exec(value);if(!m||!Number.isSafeInteger(Number(m[1])))throw invalid();return Number(m[1]);}
function photosEnabled(config:GiftsConfig){if(!config.mediaOrigin||!config.mediaToken)throw unavailable();}
@Controller('v1')
class GiftsController {
    constructor(
    @Inject(CONFIG)
    readonly config: GiftsConfig, 
    @Inject(GiftsStore)
    readonly store: GiftsStore,
    @Inject(CommerceStore)
    readonly commerce: CommerceStore) { }
    @Get('products')
    async products(@Req() r:Request,@Query() q:Record<string,unknown>){object(q,[]);return this.commerce.products((await this.session(r)).accountId);}
    @Post('purchase-quotes')
    async purchaseQuote(@Req() r:Request,@Body() body:unknown){const a=await this.write(r);return{data:await this.commerce.quote(a.accountId,identifier(r.get('Idempotency-Key')),body)};}
    @Post('orders')
    async createOrder(@Req() r:Request,@Body() body:unknown){const x=object(body,['quoteId']),a=await this.write(r);return{data:await this.commerce.create(a.accountId,identifier(r.get('Idempotency-Key')),identifier(x.quoteId))};}
    @Get('orders')
    async orders(@Req() r:Request,@Query() q:Record<string,unknown>){const a=await this.session(r),p=page(q);return this.commerce.list(a.accountId,p.limit,p.cursor);}
    @Get('orders/:id')
    async order(@Req() r:Request,@Param('id') id:string){return{data:await this.commerce.get((await this.session(r)).accountId,identifier(id))};}
    @Post('orders/:id/payment-attempts')
    async paymentAttempt(@Req() r:Request,@Param('id') id:string,@Body() body:unknown){object(body,[]);const a=await this.write(r);return{data:await this.commerce.attempt(a.accountId,identifier(id),identifier(r.get('Idempotency-Key')))};}
    @Post('orders/:id/close')
    @HttpCode(200)
    async closeOrder(@Req() r:Request,@Param('id') id:string,@Body() body:unknown){object(body,[]);const a=await this.write(r);return{data:await this.commerce.close(a.accountId,identifier(id),identifier(r.get('Idempotency-Key')))};}
    @Post('orders/:id/refunds')
    async refundOrder(@Req() r:Request,@Param('id') id:string,@Body() body:unknown){object(body,[]);const a=await this.write(r);return{data:await this.commerce.refund(a.accountId,identifier(id),identifier(r.get('Idempotency-Key')))};}
    @Post('callbacks/payments/jeepay')
    @HttpCode(200)
    async paymentNotification(@Body() body:unknown,@Res() res:Response){await this.commerce.notification('payment',body,'jeepay');res.type('text/plain').send('success');}
    @Post('callbacks/refunds/jeepay')
    @HttpCode(200)
    async refundNotification(@Body() body:unknown,@Res() res:Response){await this.commerce.notification('refund',body,'jeepay');res.type('text/plain').send('success');}
    @Post('callbacks/payments/hyperswitch')
    @HttpCode(200)
    async internationalPaymentNotification(@Req() req:Request&{rawBody?:Buffer},@Body() body:unknown,@Res() res:Response){await this.commerce.notification('all',body,'hyperswitch',req.rawBody,Object.fromEntries(Object.entries(req.headers).map(([k,v])=>[k,typeof v==='string'?v:undefined])));res.type('text/plain').send('success');}
    @Post('callbacks/refunds/hyperswitch')
    @HttpCode(200)
    async internationalRefundNotification(@Req() req:Request&{rawBody?:Buffer},@Body() body:unknown,@Res() res:Response){await this.commerce.notification('all',body,'hyperswitch',req.rawBody,Object.fromEntries(Object.entries(req.headers).map(([k,v])=>[k,typeof v==='string'?v:undefined])));res.type('text/plain').send('success');}
    session(r: Request) { return this.store.dependencies.session(r.get('cookie') ?? '', r.get('X-Xijie-Expected-Session')); }
    async write(r:Request){if(r.get('origin')!==this.config.webOrigin)throw new GiftsError(403,'FORBIDDEN');if(!r.get('X-Xijie-Expected-Session'))throw invalid();return this.session(r);}
    @Get('gift-delivery-photos')
    async photoList(@Req() r:Request,@Query() q:Record<string,unknown>){photosEnabled(this.config);const a=await this.session(r),p=page(q),v=await new GiftPhotosStore(this.store).list(a.accountId,p.limit,p.cursor);return{data:v.items,meta:{nextCursor:v.next}};}
    @Get('gift-deliveries/:id/photo')
    async photo(@Req() r:Request,@Param('id') id:string,@Query() q:Record<string,unknown>,@Res({passthrough:true}) res:Response){photosEnabled(this.config);object(q,[]);return single(res,await new GiftPhotosStore(this.store).get((await this.session(r)).accountId,identifier(id)));}
    @Put('gift-deliveries/:id/photo')
    async savePhoto(@Req() r:Request,@Param('id') id:string,@Body() body:unknown,@Res({passthrough:true}) res:Response){photosEnabled(this.config);const x=object(body,['mediaId']),a=await this.write(r);return single(res,await new GiftPhotosStore(this.store).put(a.accountId,identifier(id),identifier(r.get('Idempotency-Key')),expected(r),identifier(x.mediaId)));}
    @Get('received-gifts')
    async receivedList(@Req() r:Request,@Query() q:Record<string,unknown>){const a=await this.session(r),p=page(q,['personId','placement']);if(q.placement!==undefined&&!['record','space'].includes(String(q.placement)))throw invalid();const v=await new GiftReturnsStore(this.store).list(a.accountId,p.limit,{cursor:p.cursor,personId:q.personId===undefined?undefined:identifier(q.personId),placement:q.placement as string|undefined});return{data:v.items,meta:{nextCursor:v.next}};}
    @Get('received-gifts/:id')
    async received(@Req() r:Request,@Param('id') id:string,@Res({passthrough:true}) res:Response){return single(res,await new GiftReturnsStore(this.store).get((await this.session(r)).accountId,identifier(id)));}
    @Post('received-gifts/:id/open')
    @HttpCode(200)
    async openReceived(@Req() r:Request,@Param('id') id:string,@Body() body:unknown,@Res({passthrough:true}) res:Response){object(body,[]);const a=await this.write(r),v=await new GiftReturnsStore(this.store).mutate(a.accountId,identifier(id),identifier(r.get('Idempotency-Key')),'open');single(res,v.data);return v;}
    @Patch('received-gifts/:id')
    async placeReceived(@Req() r:Request,@Param('id') id:string,@Body() body:unknown,@Res({passthrough:true}) res:Response){const x=object(body,['placement']);if(!['record','space'].includes(String(x.placement)))throw invalid();const a=await this.write(r),v=await new GiftReturnsStore(this.store).mutate(a.accountId,identifier(id),identifier(r.get('Idempotency-Key')),'placement',x.placement as 'record'|'space',expected(r));single(res,v.data);return v;}
    @Get('notifications')
    async notifications(@Req() r:Request,@Query() q:Record<string,unknown>){const a=await this.session(r),p=page(q,['unread','type']);if(q.unread!==undefined&&!['true','false'].includes(String(q.unread))||q.type!==undefined&&!['gift_arrived','gift_failed','gift_received'].includes(String(q.type)))throw invalid();return new GiftReturnsStore(this.store).notifications(a.accountId,p.limit,{cursor:p.cursor,unread:q.unread===undefined?undefined:q.unread==='true',type:q.type as string|undefined});}
    @Patch('notifications/:id')
    async readNotification(@Req() r:Request,@Param('id') id:string,@Body() body:unknown,@Res({passthrough:true}) res:Response){const x=object(body,['read']);if(x.read!==true)throw invalid();const a=await this.write(r),v=await new GiftReturnsStore(this.store).readNotification(a.accountId,identifier(id),identifier(r.get('Idempotency-Key')),expected(r));single(res,v.data);return v;}
    @Get('gift-catalog')
    async catalog(
    @Req()
    r: Request, 
    @Query()
    q: Record<string, unknown>) { object(q, ['limit', 'cursor', 'personId', 'category']); const limit = q.limit === undefined ? 100 : Number(q.limit); if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || q.cursor !== undefined && (typeof q.cursor !== 'string' || !/^[a-z0-9-]{1,80}$/.test(q.cursor)))
        throw invalid(); const a = await this.session(r), items = (await this.store.catalog(a.accountId, q.personId === undefined ? undefined : identifier(q.personId))).filter(g => (q.category === undefined || g.category === q.category) && (q.cursor === undefined || g.id > String(q.cursor))); return { data: items.slice(0, limit), meta: { nextCursor: items.length > limit ? items[limit - 1].id : null } }; }
    @Get('wallet')
    async wallet(
    @Req()
    r: Request, 
    @Res({ passthrough: true })
    res: Response, 
    @Query()
    q: Record<string, unknown>) { object(q, []); return single(res, await this.store.wallet((await this.session(r)).accountId)); }
    @Get('wallet/ledger')
    async ledger(
    @Req()
    r: Request, 
    @Query()
    q: Record<string, unknown>) { const a = await this.session(r), p = page(q), items = await this.store.ledger(a.accountId, p.limit + 1, p.cursor); return { data: items.slice(0, p.limit), meta: { nextCursor: items.length > p.limit ? items[p.limit - 1].transactionId : null } }; }
    @Get('gift-deliveries')
    async list(
    @Req()
    r: Request, 
    @Query()
    q: Record<string, unknown>) { const a = await this.session(r), p = page(q, ['personId', 'status', 'displayable']); if (q.status !== undefined && !['in_transit', 'arrived', 'delivery_failed'].includes(String(q.status)) || q.displayable !== undefined && !['true', 'false'].includes(String(q.displayable)))
        throw invalid(); const value = await this.store.list(a.accountId, p.limit, { ...p, personId: q.personId === undefined ? undefined : identifier(q.personId), status: q.status as string | undefined, displayable: q.displayable === 'true' }); return { data: value.items, meta: { nextCursor: value.next } }; }
    @Get('gift-deliveries/:id')
    async get(
    @Req()
    r: Request, 
    @Param('id')
    id: string, 
    @Res({ passthrough: true })
    res: Response) { return single(res, await this.store.get((await this.session(r)).accountId, identifier(id))); }
    @Post('gift-deliveries')
    async send(
    @Req()
    r: Request, 
    @Body()
    body: unknown, 
    @Res({ passthrough: true })
    res: Response) { if (r.get('origin') !== this.config.webOrigin)
        throw new GiftsError(403, 'FORBIDDEN'); if (!r.get('X-Xijie-Expected-Session'))
        throw invalid(); const a = await this.session(r); return single(res, await this.store.send(a.accountId, identifier(r.get('Idempotency-Key')), sendInput(body))); }
}
@Controller('internal/v1')
class InternalGiftsController {
    constructor(
    @Inject(CONFIG)
    readonly config: GiftsConfig, 
    @Inject(GiftsStore)
    readonly store: GiftsStore) { }
    @Get('promotions/shared-albums/:id/reward')
    async albumRewardReceipt(@Req() r:Request,@Param('id') id:string,@Query() q:Record<string,unknown>){if(!this.config.socialToken)throw unavailable();token(r,this.config.socialToken);object(q,[]);return{data:await new AlbumRewardsStore(this.store).get(identifier(r.get('X-Xijie-Account-Id')),identifier(id))};}
    @Post('promotions/shared-albums/:id/reward')
    @HttpCode(200)
    async albumReward(@Req() r:Request,@Param('id') id:string,@Body() body:unknown,@Query() q:Record<string,unknown>){if(!this.config.socialToken)throw unavailable();token(r,this.config.socialToken);object(q,[]);object(body,[]);return{data:await new AlbumRewardsStore(this.store).reward(identifier(r.get('X-Xijie-Account-Id')),identifier(id))};}
    @Get('media/gifts/deliveries/:id')
    async photoSource(@Req() r:Request,@Param('id') id:string,@Query() q:Record<string,unknown>){photosEnabled(this.config);token(r,this.config.mediaToken!);object(q,[]);return{data:await new GiftPhotosStore(this.store).source(identifier(r.get('X-Xijie-Account-Id')),identifier(id))};}
    @Post('media/gifts/validate')
    @HttpCode(200)
    async validatePhotos(@Req() r:Request,@Body() body:unknown){photosEnabled(this.config);token(r,this.config.mediaToken!);const x=object(body,['refs']);if(!Array.isArray(x.refs)||x.refs.length>100)throw invalid();const refs=x.refs.map(value=>{const ref=object(value,['deliveryId','photoVersion','mediaId','version']);for(const key of ['photoVersion','version'])if(!Number.isSafeInteger(ref[key])||Number(ref[key])<1||Number(ref[key])>2147483647)throw invalid();return{deliveryId:identifier(ref.deliveryId),photoVersion:Number(ref.photoVersion),mediaId:identifier(ref.mediaId),version:Number(ref.version)};});return{data:await new GiftPhotosStore(this.store).validate(identifier(r.get('X-Xijie-Account-Id')),refs)};}
    @Get('gifts/received/:id')
    async received(@Req() r:Request,@Param('id') id:string,@Query() q:Record<string,unknown>){token(r,this.config.conversationsToken);object(q,['accountId']);const accountId=identifier(q.accountId);return{data:{accountId,...await new GiftReturnsStore(this.store).get(accountId,identifier(id))}};}
    @Get('gifts/deliveries/:id')
    async get(
    @Req()
    r: Request, 
    @Param('id')
    id: string, 
    @Query()
    q: Record<string, unknown>) { token(r, this.config.conversationsToken); object(q, ['accountId']); const accountId = identifier(q.accountId); return { data: { accountId, ...await this.store.source(accountId, identifier(id)) } }; }
    @Get('accounts/:id/data-export')
    async export(
    @Req()
    r: Request, 
    @Param('id')
    id: string, 
    @Query()
    q: Record<string, unknown>) { token(r, this.config.rightsToken); object(q, ['scope', 'requestId']); if (!['interaction_data', 'account_data'].includes(String(q.scope)))
        throw invalid(); return { data: await new GiftsDataRights(this.store).export(identifier(id), identifier(q.requestId), String(q.scope)) }; }
    @Post('accounts/:id/erase')
    @HttpCode(200)
    async erase(
    @Req()
    r: Request, 
    @Param('id')
    id: string, 
    @Body()
    body: unknown) { token(r, this.config.rightsToken); const x = object(body, ['requestId']), request = identifier(x.requestId); if (r.get('Idempotency-Key') !== request)
        throw invalid(); return { data: await new GiftsDataRights(this.store).erase(identifier(id), request) }; }
    @Post('accounts/:id/erase-preflight')
    @HttpCode(200)
    async erasePreflight(@Req() r:Request,@Param('id') id:string,@Body() body:unknown){token(r,this.config.rightsToken);const x=object(body,['requestId']),request=identifier(x.requestId);if(r.get('Idempotency-Key')!==request)throw invalid();return{data:await new GiftsDataRights(this.store).preflight(identifier(id),request)};}
}
@Module({})
export class GiftsModule {
    static register(config: GiftsConfig, store: GiftsStore, commerce:CommerceStore): DynamicModule { return { module: GiftsModule, controllers: [GiftsController, InternalGiftsController], providers: [{ provide: CONFIG, useValue: config }, { provide: GiftsStore, useValue: store },{provide:CommerceStore,useValue:commerce}] }; }
}
export async function createGiftsApp(config: GiftsConfig, store: GiftsStore, commerce=new CommerceStore(store)) { const app = await NestFactory.create(GiftsModule.register(config, store,commerce), { logger: ['error', 'warn'], abortOnError: false,bodyParser:false,rawBody:true }); app.getHttpAdapter().getInstance().disable('x-powered-by');app.use(giftsHeaders);app.use(json({limit:'32kb',verify(req,_res,bytes){(req as Request&{rawBody?:Buffer}).rawBody=Buffer.from(bytes)}}));app.use(urlencoded({extended:false,limit:'32kb',parameterLimit:100})); app.useGlobalFilters(new GiftsErrors()); return app; }
