import {createHash,timingSafeEqual} from 'node:crypto'
import {readFileSync,lstatSync} from 'node:fs'
import {isAbsolute} from 'node:path'
import {ReportError,type ReportDependencies,type ReportSubject} from './content-reports.js'
export type ReportConfig={enabled:boolean;origin:string;serviceToken:string;conversationsOrigin:string;socialOrigin:string;operators:{id:string;tokenHash:string;scopes:string[]}[]}
const origin=(v:string)=>{const u=new URL(v);if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||!(u.protocol==='https:'||process.env.NODE_ENV!=='production'&&u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)))throw Error('Invalid report service origin');return u.origin}
export function readReportConfig(webOrigin:string):ReportConfig{
 const setting=process.env.CONTENT_REPORTS_ENABLED??'false';if(!['true','false'].includes(setting))throw Error('Invalid CONTENT_REPORTS_ENABLED')
 if(setting==='false')return{enabled:false,origin:webOrigin,serviceToken:'',conversationsOrigin:'',socialOrigin:'',operators:[]}
 const serviceToken=process.env.XIJIE_CONTENT_REVIEW_SERVICE_TOKEN??'';if(!/^[a-f0-9]{64}$/i.test(serviceToken))throw Error('Missing content review service credential')
 const file=process.env.CONTENT_REVIEW_OPERATORS_FILE??'';if(!isAbsolute(file))throw Error('Operator credential file must be an absolute private path')
 let operators:ReportConfig['operators'];try{const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536||process.platform!=='win32'&&(stat.mode&0o077)!==0)throw Error();operators=JSON.parse(readFileSync(file,'utf8'))}catch{throw Error('Report operators require a private regular credential file')}
 if(!Array.isArray(operators)||!operators.length||operators.length>100||operators.some(o=>!o||Object.keys(o).some(k=>!['id','tokenHash','scopes'].includes(k))||!/^[A-Za-z0-9_.-]{1,80}$/.test(o.id)||!/^[a-f0-9]{64}$/.test(o.tokenHash)||!Array.isArray(o.scopes)||!o.scopes.length||o.scopes.some(s=>!['reports:read','reports:resolve','reports:evidence'].includes(s)))||new Set(operators.map(o=>o.id)).size!==operators.length||new Set(operators.map(o=>o.tokenHash)).size!==operators.length)throw Error('Invalid report operators')
 const serviceHashes=new Set(Object.entries(process.env).filter(([key,value])=>key.endsWith('_SERVICE_TOKEN')&&!!value).map(([,value])=>createHash('sha256').update(value!).digest('hex')));if(operators.some(o=>serviceHashes.has(o.tokenHash)))throw Error('Report operator credentials must be independent of service credentials')
 return{enabled:true,origin:webOrigin,serviceToken,operators,conversationsOrigin:origin(process.env.XIJIE_CONVERSATIONS_URL??''),socialOrigin:origin(process.env.XIJIE_SOCIAL_URL??'')}
}
export function reportOperator(config:ReportConfig,authorization:string|undefined,scope:string){const token=/^Bearer ([a-f0-9]{64})$/i.exec(authorization??'')?.[1];if(!token)throw new ReportError(403,'FORBIDDEN');const digest=createHash('sha256').update(token).digest();const actor=config.operators.find(o=>timingSafeEqual(digest,Buffer.from(o.tokenHash,'hex')));if(!actor||!actor.scopes.includes(scope))throw new ReportError(403,'FORBIDDEN');return actor.id}
export class ReportGateway implements ReportDependencies{
 constructor(readonly config:ReportConfig,readonly fetcher:typeof fetch=fetch){}
 private async request(domain:string,path:string,account:string,method:string,body?:object){
  let response:Response;try{response=await this.fetcher(new URL(path,domain==='conversations'?this.config.conversationsOrigin:this.config.socialOrigin),{method,redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+this.config.serviceToken,'X-Xijie-Account-Id':account,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})}catch{throw new ReportError(503,'SOURCE_UNAVAILABLE')}
  if(!response.ok)throw new ReportError([403,404,409,412].includes(response.status)?response.status:503,response.status===404?'SOURCE_UNAVAILABLE':response.status===412?'SOURCE_CHANGED':'SOURCE_UNAVAILABLE')
  let data:any;try{const reader=response.body?.getReader();if(!reader)throw Error();const chunks:Uint8Array[]=[];let bytes=0;while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>65536){await reader.cancel();throw Error()}chunks.push(next.value)}data=JSON.parse(Buffer.concat(chunks).toString('utf8')).data}catch{throw new ReportError(503,'SOURCE_UNAVAILABLE')};if(!data)throw new ReportError(503,'SOURCE_UNAVAILABLE');return data
 }
 async source(account:string,type:ReportSubject['subjectType'],id:string):Promise<ReportSubject>{return this.request(type==='message'?'conversations':'social','/internal/v1/content-review/'+type+'/'+id,account,'GET')}
 async evidence(account:string,type:ReportSubject['subjectType'],id:string){return this.request(type==='message'?'conversations':'social','/internal/v1/content-review/'+type+'/'+id+'/evidence',account,'GET')}
 async restrict(report:any){return this.request(report.source_domain,'/internal/v1/content-review/'+report.subject_type+'/'+report.subject_id+'/restrict',report.owner_account_id,'POST',{reportId:report.id,operationId:report.action_key,containerId:report.container_id,sourceKind:report.source_kind,version:report.source_version,sourceHash:report.source_hash})}
}
