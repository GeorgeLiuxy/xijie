import type { AuthPurpose, SocialProvider } from './password'
export type { SocialProvider } from './password'
export type NativePending={pending:boolean;provider:SocialProvider;purpose:AuthPurpose;transport?:'browser'|'wechat_sdk';expectedSessionId?:string;previousAccountId?:string;verifierChallenge:string;launchProof:string;startKey:string;launchKey?:string;completeKey?:string;stage?:'prepared'|'waiting_provider'|'callback_received'|'completing'|'verified'|'failed';failureCode?:string;redeemKey:string;expiresAt:number;attemptId?:string;ticket?:string;verifier?:string;failed?:boolean}
export type NativeCapabilities={version:1;browserProviders:SocialProvider[];wechatNative:{configured:boolean;installed:boolean}}
type Bridge={nativePromise?:(plugin:string,method:string,data:Record<string,unknown>)=>Promise<unknown>}
export async function nativeAuth<T=NativePending>(method:'prepare'|'launch'|'getPending'|'clear'|'getCapabilities',data:Record<string,unknown>={}):Promise<T>{
 const bridge=(window as Window&{Capacitor?:Bridge}).Capacitor
 if(!bridge?.nativePromise)throw new Error('Native authorization is unavailable')
 return await bridge.nativePromise('NativeAuth',method,data) as T
}
