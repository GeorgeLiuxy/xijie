import {readFile} from 'node:fs/promises'
import {isAbsolute} from 'node:path'
// Operator credentials and decisions stay in private files, never command arguments.
const [command,file]=process.argv.slice(2),base=new URL(process.env.REPORTS_OPERATOR_ORIGIN??'http://127.0.0.1:3101')
if(!['list','evidence','resolve'].includes(command)||base.username||base.password||base.search||base.hash||base.pathname!=='/'||!(base.protocol==='https:'||base.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(base.hostname)))throw Error('Use list, evidence <report-id>, or resolve <absolute-private-request-file>; configure an HTTPS or loopback origin.')
const credential=process.env.REPORTS_OPERATOR_TOKEN_FILE
if(!credential||!isAbsolute(credential))throw Error('REPORTS_OPERATOR_TOKEN_FILE must be an absolute private file.')
const token=(await readFile(credential,'utf8')).trim();if(!/^[a-f0-9]{64}$/i.test(token))throw Error('Invalid operator credential file.')
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
let path='/v1/ops/content-reports',body,headers={Authorization:'Bearer '+token}
if(command==='evidence'){if(!uuid.test(file??''))throw Error('A report UUID is required.');path+='/'+file+'/evidence'}
if(command==='resolve'){
 if(!file||!isAbsolute(file))throw Error('The request must be preserved in an absolute private file for safe retries.')
 const v=JSON.parse(await readFile(file,'utf8'));if(!v||Object.keys(v).some(k=>!['reportId','key','version','decision'].includes(k))||!uuid.test(v.reportId)||!uuid.test(v.key)||!Number.isSafeInteger(v.version)||v.version<1||!v.decision||typeof v.decision!=='object')throw Error('Invalid decision file. Expected reportId, key, version and decision.')
 path+='/'+v.reportId+'/resolve';headers={...headers,'Content-Type':'application/json','Idempotency-Key':v.key,'If-Match':'"v'+v.version+'"'};body=JSON.stringify(v.decision)
}
try{
 const response=await fetch(new URL(path,base),{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers,...(body?{body}:{})}),value=await response.json()
 if(!response.ok){console.error(JSON.stringify({status:response.status,code:value?.error?.code??'UNAVAILABLE'}));process.exitCode=1}
 else console.log(JSON.stringify(value,null,2))
}catch{console.error('Result is not confirmed. Preserve the exact decision file and retry; no replacement action was created.');process.exitCode=1}
