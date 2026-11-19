export type AlbumConfig={enabled:boolean;tokenKey:Buffer|null;publicOrigin:string;memoriesToken:string|null;giftsOrigin:string|null}
export function albumConfig(webOrigin:string):AlbumConfig{
 const setting=process.env.SHARED_ALBUMS_ENABLED||'false';if(!['true','false'].includes(setting))throw new Error('Invalid album feature setting')
 const enabled=setting==='true',key=process.env.SHARED_ALBUMS_TOKEN_KEY||'',memoriesToken=process.env.XIJIE_MEMORIES_SERVICE_TOKEN||null
 if(memoriesToken&&!/^[a-f0-9]{64}$/i.test(memoriesToken))throw new Error('Invalid album source credential')
 if(enabled&&process.env.NODE_ENV==='production'&&process.env.SHARED_ALBUMS_PRODUCTION_APPROVED!=='true')throw new Error('SHARED_ALBUMS_PRODUCTION_APPROVED must explicitly approve release')
 if(enabled&&(!/^[a-f0-9]{64}$/i.test(key)||!memoriesToken||!/^[a-f0-9]{64}$/i.test(memoriesToken)))throw new Error('Missing album credentials')
 const raw=process.env.XIJIE_GIFTS_URL;let giftsOrigin:string|null=null
 if(raw){const u=new URL(raw);if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||u.protocol!=='https:'&&!(process.env.NODE_ENV!=='production'&&u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)))throw new Error('Invalid Gifts origin');giftsOrigin=u.origin}
 if(enabled&&(!giftsOrigin||!process.env.XIJIE_MEMORIES_URL))throw new Error('Missing album services')
 if(enabled&&process.env.NODE_ENV==='production'&&new URL(webOrigin).protocol!=='https:')throw new Error('Production albums require an HTTPS public origin')
 return {enabled,tokenKey:enabled?Buffer.from(key,'hex'):null,publicOrigin:webOrigin,memoriesToken,giftsOrigin}
}
