import {readFileSync,lstatSync} from 'node:fs'
import {isAbsolute} from 'node:path'
import {timingSafeEqual} from 'node:crypto'
import {Pool} from 'pg'
import {readConfig} from './config.js'
import {GiftsStore} from './store.js'
import {Dependencies} from './dependencies.js'
import {CommerceStore} from './commerce.js'
import {createCommerceIntegration} from './jeepay-provider.js'
import {FinancialOperations,type OperatorInput} from './financial-operations.js'
import {GiftsError} from './contracts.js'

let pool:Pool|undefined,commerce:CommerceStore|undefined
try{
 const expected=process.env.XIJIE_FINANCIAL_OPERATOR_TOKEN,file=process.env.GIFTS_OPERATOR_CREDENTIAL_FILE
 if(process.env.GIFTS_OPERATOR_ENABLED!=='true'||!expected||!/^[a-f0-9]{64}$/i.test(expected)||!file||!isAbsolute(file))throw new GiftsError(403,'OPERATOR_CREDENTIAL_REQUIRED')
 const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>256||process.platform!=='win32'&&(stat.mode&0o077)!==0)throw new GiftsError(403,'OPERATOR_CREDENTIAL_REQUIRED')
 const supplied=readFileSync(file,'utf8').trim();if(!/^[a-f0-9]{64}$/i.test(supplied)||!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(supplied,'hex')))throw new GiftsError(403,'OPERATOR_CREDENTIAL_REQUIRED')
 const config=readConfig();if([config.serviceToken,config.rightsToken,config.conversationsToken,config.socialToken,config.mediaToken].some(v=>v?.toLowerCase()===expected.toLowerCase()))throw new GiftsError(403,'OPERATOR_CREDENTIAL_MUST_BE_INDEPENDENT')
 pool=new Pool({connectionString:config.databaseUrl,connectionTimeoutMillis:5000,statement_timeout:10000});const store=new GiftsStore(pool,new Dependencies(config),{financialRetention:config.financialRetention});commerce=new CommerceStore(store,createCommerceIntegration(config.commerce));const ops=new FinancialOperations(store,commerce)
 const[action,id,accountId,kind,resourceId,reviewer,reasonCode,deletionRequestId,...extra]=process.argv.slice(2)
 let result:unknown
 if(action==='purge_retention'){if([resourceId,reviewer,reasonCode,deletionRequestId].some(v=>v!==undefined)||extra.length)throw new GiftsError(422,'VALIDATION_FAILED');result=await ops.purge(id,accountId,kind)}
 else if(action==='retention_read'){if([reviewer,reasonCode,deletionRequestId].some(v=>v!==undefined)||extra.length)throw new GiftsError(422,'VALIDATION_FAILED');result=await ops.retentionRead(id,accountId,kind,resourceId)}
 else{if(extra.length)throw new GiftsError(422,'VALIDATION_FAILED');result=await ops.execute({action:action==='retry'?'recheck':action,id,accountId,kind,resourceId,reviewer,reasonCode,...(deletionRequestId?{deletionRequestId}:{})} as OperatorInput)}
 console.log(JSON.stringify(result))
}catch(cause){console.error(JSON.stringify({completed:false,code:cause instanceof GiftsError?cause.code:'OPERATOR_COMMAND_FAILED'}));process.exitCode=1}finally{commerce?.stop();await pool?.end()}
