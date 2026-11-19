import { createHash } from 'node:crypto';
export const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export class GiftsError extends Error {
    constructor(readonly status: number, readonly code: string, message = 'The gift request could not be completed.') { super(message); }
}
export const invalid = () => new GiftsError(422, 'VALIDATION_FAILED'), missing = () => new GiftsError(404, 'NOT_FOUND'), unavailable = () => new GiftsError(503, 'DEPENDENCY_UNAVAILABLE');
export const hash = (v: string) => createHash('sha256').update(v).digest('hex');
export function identifier(v: unknown) { if (typeof v !== 'string' || !uuid.test(v))
    throw invalid(); return v.toLowerCase(); }
export function object(v: unknown, fields: string[]) { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !fields.includes(k)))
    throw invalid(); return v as Record<string, unknown>; }
export type Audience = 'person' | 'pet' | 'object';
export type GiftCategory = 'emotion' | 'care' | 'pet' | 'home' | 'collection' | 'scenery' | 'experience' | 'journey';
export type GiftDefinition = {
    id: string;
    version: number;
    name: string;
    en: string;
    category: GiftCategory;
    icon: string;
    cost: number;
    effect: 'keepsake' | 'prop' | 'scene' | 'build' | 'service' | 'fuel';
    outcome: string;
    outcomeEn: string;
    audience: Audience[];
    stackable: boolean;
    available: boolean;
    render: 'flower' | 'lamp' | 'plant' | 'cloth' | 'ball' | 'frame' | 'furniture' | 'keepsake' | 'scene' | 'package';
};
export type Permission = {
    allowed: boolean;
    authorizationVersion: number;
};
export type Account = {
    accountId: string;
    status: string;
    accessVersion: number;
    giftStorage?: Permission;
    storyStorage?: Permission;
    giftReturns?: Permission;
    giftPhotoStorage?: Permission;
};
export type Session = {
    accountId: string;
    sessionId: string;
    expiresAt: string;
    giftStorage?: Permission;
    storyStorage?: Permission;
    giftReturns?: Permission;
    giftPhotoStorage?: Permission;
};
export type PersonSnapshot = {
    id: string;
    accountId?: string;
    displayName: string;
    worldId: string;
    version: number;
    worldVersion: number;
    accessVersion: number;
    status?: string;
    audience: 'person';
};
export type SendInput = {
    personId: string;
    giftId: string;
    catalogVersion: number;
    quantity: number;
    source: 'trial' | 'inventory' | 'voucher';
    note: string;
};
export function sendInput(body: unknown): SendInput { const x = object(body, ['personId', 'giftId', 'catalogVersion', 'quantity', 'source', 'note']); if (typeof x.giftId !== 'string' || !/^[a-z0-9-]{1,80}$/.test(x.giftId) || !Number.isSafeInteger(x.catalogVersion) || Number(x.catalogVersion) < 1 || !Number.isSafeInteger(x.quantity) || Number(x.quantity) < 1 || Number(x.quantity) > 99 || !['trial', 'inventory', 'voucher'].includes(String(x.source)) || x.note !== undefined && (typeof x.note !== 'string' || x.note.includes('\0') || /\p{Surrogate}/u.test(x.note)))
    throw invalid(); const note = String(x.note ?? '').trim(); if ([...note].length > 120)
    throw invalid(); return { personId: identifier(x.personId), giftId: x.giftId, catalogVersion: Number(x.catalogVersion), quantity: Number(x.quantity), source: x.source as SendInput['source'], note }; }
export type DeliveryRow = {
    id: string;
    account_id: string;
    acceptance_key: string;
    request_hash: string;
    person_id: string;
    conversation_id: string;
    person_snapshot: PersonSnapshot;
    gift_snapshot: GiftDefinition;
    quantity: number;
    note: string;
    source: SendInput['source'];
    cost: number;
    status: 'in_transit' | 'arrived' | 'delivery_failed';
    version: number;
    account_access_version: number;
    gift_authorization_version: number;
    created_at: Date;
    scheduled_arrival_at: Date;
    arrived_at: Date | null;
    failed_at: Date | null;
    updated_at: Date;
    debit_transaction_id: string | null;
    reversal_transaction_id: string | null;
    failure_code: string | null;
    return_authorization_version: number | null;
    story_authorization_version: number | null;
    return_policy_version: string | null;
};
export function dto(r: DeliveryRow) { return { id: r.id, personId: r.person_id, conversationId: r.conversation_id, personSnapshot: r.person_snapshot, giftSnapshot: r.gift_snapshot, quantity: r.quantity, note: r.note, source: r.source, cost: r.cost, status: r.status, version: r.version, createdAt: r.created_at.toISOString(), scheduledArrivalAt: r.scheduled_arrival_at.toISOString(), arrivedAt: r.arrived_at?.toISOString() ?? null, failedAt: r.failed_at?.toISOString() ?? null, debitTransactionId: r.debit_transaction_id, reversalTransactionId: r.reversal_transaction_id, failureCode: r.failure_code }; }
export type Delivery = ReturnType<typeof dto>;
export type PhotoMetadata = { id:string; version:number; mimeType:'image/webp'; byteSize:number; width:number; height:number };
export type PhotoBinding = { deliveryId:string; photoVersion:number; media:PhotoMetadata; expiresAt:string };
export type PhotoReference = { deliveryId:string; photoVersion:number; mediaId:string; version:number };
export type DeliveryPhoto = { deliveryId:string; version:number; photo:PhotoMetadata|null; updatedAt:string; origin:'journey_capture' };
export type ReturnPerson = PersonSnapshot & { relationship: string; calledMe?: string; story: string;conversationTone?:'gentle'|'witty'|'quiet'|'stern'|null;voiceTimbre?:'warm'|'bright'|'deep'|null;personality?:string[];life?:string[];unknowns?:string[];catchphrase?:string|null };
export type ReturnContext = { person: ReturnPerson; accountAccessVersion: number; storyAuthorizationVersion: number; returnAuthorizationVersion: number };
export type ReceivedRow = {
    id: string; account_id: string; source_delivery_id: string; generation_job_id: string;
    person_id: string; conversation_id: string; person_snapshot: PersonSnapshot; gift_snapshot: GiftDefinition;
    quantity: 1; note: string; version: number; created_at: Date; updated_at: Date; opened_at: Date | null; placement: 'record' | 'space' | null;
    policy_version: 'person-gift-returns-v1'; account_access_version: number; gift_authorization_version: number;
    story_authorization_version: number; return_authorization_version: number;
};
export function receivedDto(r: ReceivedRow) { return { id:r.id,personId:r.person_id,conversationId:r.conversation_id,sourceDeliveryId:r.source_delivery_id,
    personSnapshot:r.person_snapshot,giftSnapshot:r.gift_snapshot,quantity:r.quantity,note:r.note,version:r.version,createdAt:r.created_at.toISOString(),
    openedAt:r.opened_at?.toISOString()??null,placement:r.placement,displayable:r.gift_snapshot.available&&displayable(r.gift_snapshot),
    origin:{kind:'persona_return' as const,contentOrigin:'ai_generated' as const,policyVersion:r.policy_version,generationJobId:r.generation_job_id} }; }
export type ReceivedGift = ReturnType<typeof receivedDto>;
export type NotificationRow = { id:string;account_id:string;type:'gift_arrived'|'gift_failed'|'gift_received';source_event_id:string;object_id:string;person_id:string;object_kind:'delivery'|'received_gift';version:number;created_at:Date;read_at:Date|null };
export function notificationDto(r:NotificationRow){return{id:r.id,version:r.version,type:r.type,createdAt:r.created_at.toISOString(),readAt:r.read_at?.toISOString()??null,sourceEventId:r.source_event_id,objectId:r.object_id,personId:r.person_id,target:{kind:r.object_kind,id:r.object_id}};}
export type Notification=ReturnType<typeof notificationDto>;
export type DataRequest = {
    status:'accepted'|'processing'|'failed'|'completed';
    accountId: string;
    requestId: string;
    kind: 'export' | 'delete_account';
    scope: 'interaction_data' | 'account_data';
    accountStatus: string;
    accountAccessVersion: number;
};
export const voucherEligible = (g: GiftDefinition) => g.available && g.cost > 0 && g.cost <= 8 && ['prop', 'keepsake'].includes(g.effect);
export const displayable = (g: GiftDefinition) => ['flowers', 'ball', 'cloth', 'cushion', 'sun-mat', 'star-lamp', 'path-lamp', 'beacon', 'blessing-river-lantern'].includes(g.id) || (g.effect === 'prop' && g.render === 'plant' && g.id !== 'feather');
export function permitted(a: Account) { if (a.status !== 'active')
    throw missing(); if (!a.giftStorage?.allowed)
    throw new GiftsError(403, 'GIFT_STORAGE_PERMISSION_REQUIRED'); return a; }
