import {readCommerceConfig} from './commerce-config.js'
import {readFinancialRetention} from './financial-rights.js'
export function requiredEnv(k: string) { const v = process.env[k]?.trim(); if (!v)
    throw Error('Missing configuration: ' + k); return v; }
const local = new Set(['127.0.0.1', 'localhost', '[::1]']);
function origin(k: string) { const u = new URL(requiredEnv(k)); if (u.username || u.password || u.pathname !== '/' || u.hash || u.search || (u.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && u.protocol === 'http:' && local.has(u.hostname))))
    throw Error('Invalid origin: ' + k); return u.origin; }
export function readConfig() { const serviceToken = requiredEnv('XIJIE_GIFTS_SERVICE_TOKEN'), conversationsToken = requiredEnv('XIJIE_CONVERSATIONS_SERVICE_TOKEN'), rightsToken = requiredEnv('XIJIE_DATA_RIGHTS_SERVICE_TOKEN');
    const mediaToken=process.env.XIJIE_MEDIA_SERVICE_TOKEN?.trim()||undefined,mediaUrl=process.env.XIJIE_MEDIA_URL?.trim()||undefined;
    if(Boolean(mediaToken)!==Boolean(mediaUrl))throw Error('Gifts Media origin and credential must be configured together');
    const socialToken=process.env.XIJIE_SOCIAL_SERVICE_TOKEN?.trim()||undefined;
    const credentials=[serviceToken,conversationsToken,rightsToken,...(mediaToken?[mediaToken]:[]),...(socialToken?[socialToken]:[])];
    if (credentials.some(v => !/^[a-f0-9]{64}$/i.test(v)) || new Set(credentials.map(v=>v.toLowerCase())).size !== credentials.length)
    throw Error('Invalid Gifts credentials'); const host = process.env.GIFTS_HOST || '127.0.0.1', port = Number(process.env.GIFTS_PORT || 3107), webOrigin = origin('GIFTS_WEB_ORIGIN'); if (!Number.isSafeInteger(port) || port < 1 || port > 65535 || webOrigin.startsWith('http:') && !local.has(host))
    throw Error('Invalid Gifts listener'); if(process.env.GIFTS_AI_ENABLED!==undefined&&!['true','false'].includes(process.env.GIFTS_AI_ENABLED))throw Error('Invalid GIFTS_AI_ENABLED'); return { commerce:readCommerceConfig(),financialRetention:readFinancialRetention(), databaseUrl: requiredEnv('DATABASE_URL'), serviceToken, conversationsToken, rightsToken, mediaToken, socialToken, mediaOrigin:mediaUrl?origin('XIJIE_MEDIA_URL'):undefined, host, port, webOrigin, returnEnabled:process.env.GIFTS_AI_ENABLED==='true', memoriesOrigin:process.env.XIJIE_MEMORIES_URL?.trim()?origin('XIJIE_MEMORIES_URL'):undefined, identityOrigin: origin('XIJIE_IDENTITY_URL'), peopleOrigin: origin('XIJIE_PEOPLE_URL'), conversationsOrigin: origin('XIJIE_CONVERSATIONS_URL'), sessionCookie: webOrigin.startsWith('https:') ? '__Host-xijie_session' : 'xijie_dev_session' }; }
export type GiftsConfig = ReturnType<typeof readConfig>;
