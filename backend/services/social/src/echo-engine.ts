import {SocialError} from './contracts.js'
import {EchoError} from './echo-provider.js'
import type {EchoProvider,Dispatch,JobRow} from './echo-contracts.js'
import type {EchoStore} from './echo-store.js'
export class EchoEngine{
 private stopping=false;private controllers=new Set<AbortController>()
 constructor(readonly store:EchoStore,readonly provider:EchoProvider){}
 async run(dispatch:Dispatch){if(this.stopping)throw new Error('Worker stopping');const row=await this.store.claim(dispatch);if(!row)return;const abort=new AbortController();this.controllers.add(abort);const timer=setTimeout(()=>abort.abort(),35000).unref();let checking=false;const monitor=setInterval(()=>{if(checking)return;checking=true;void this.store.pool.query('SELECT state,attempt_id FROM social_generation_jobs WHERE id=$1',[row.id]).then(result=>{const v=result.rows[0];if(!v||v.state!=='running'||v.attempt_id!==row.attempt_id)abort.abort()}).catch(()=>abort.abort()).finally(()=>{checking=false})},250).unref();try{
  const {input,refs}=await this.store.input(row,abort.signal);await this.store.authority(row)
  if(abort.signal.aborted||!await this.store.active(row))throw new EchoError('CONTEXT_REVOKED',false,true)
  const result=await this.provider.generate(input);if(abort.signal.aborted)throw new EchoError('MODEL_TIMEOUT',true)
  await this.store.authority(row);if(!await this.store.validComments(row,refs))throw new SocialError(404,'CONTEXT_REVOKED','The source changed.')
  if(!await this.store.complete(row,result.text,input,refs))await this.store.fail(row,'LEASE_EXPIRED',true)
 }catch(e){if(this.stopping){await this.store.release(row);throw new Error('Worker stopping')}
  try{if(e instanceof EchoError)await this.store.fail(row,e.code,e.retryable,e.blocked);else if(e instanceof SocialError&&[401,403,404,409].includes(e.status))await this.store.fail(row,e.code,false,true);else await this.store.fail(row,'DEPENDENCY_UNAVAILABLE',true)}catch{/* Erasure or a replaced attempt cannot be restored by error handling. */}
 }finally{clearTimeout(timer);clearInterval(monitor);this.controllers.delete(abort)}}
 stop(){this.stopping=true;for(const c of this.controllers)c.abort()}
}
