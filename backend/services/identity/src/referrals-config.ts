export type ReferralsConfig={enabled:boolean;publicOrigin:string;tokenKey:Buffer|null}
export function readReferralsConfig(origin:string):ReferralsConfig{
 const enabled=process.env.REFERRALS_ENABLED==='true'
 if(!enabled)return{enabled:false,publicOrigin:origin,tokenKey:null}
 if(process.env.NODE_ENV==='production'&&process.env.REFERRALS_PRODUCTION_APPROVED!=='true')throw new Error('REFERRALS_PRODUCTION_APPROVED must explicitly approve release')
 const raw=process.env.REFERRALS_TOKEN_KEY?.trim()
 if(!raw||!/^[a-f0-9]{64}$/i.test(raw))throw new Error('Invalid REFERRALS_TOKEN_KEY')
 const url=new URL(process.env.REFERRALS_PUBLIC_ORIGIN?.trim()||origin)
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||url.protocol!=='https:'&&!(process.env.NODE_ENV!=='production'&&url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('Invalid REFERRALS_PUBLIC_ORIGIN')
 return{enabled:true,publicOrigin:url.origin,tokenKey:Buffer.from(raw,'hex')}
}
