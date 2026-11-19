const loopback=new Set(['127.0.0.1','localhost','[::1]'])
export function requiredEnv(name:string){const value=process.env[name]?.trim();if(!value)throw new Error('Missing configuration: '+name);return value}
function origin(value:string,name:string){const url=new URL(value),local=process.env.NODE_ENV!=='production'&&url.protocol==='http:'&&loopback.has(url.hostname);if((!local&&url.protocol!=='https:')||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Invalid origin: '+name);return url.origin}
export function readConfig(){
 const serviceToken=requiredEnv('XIJIE_MEMORIES_SERVICE_TOKEN'),conversationsToken=requiredEnv('XIJIE_CONVERSATIONS_SERVICE_TOKEN')
 if(!/^[a-f0-9]{64}$/i.test(serviceToken)||!/^[a-f0-9]{64}$/i.test(conversationsToken))throw new Error('Invalid service credentials')
 const dataRightsToken=process.env.XIJIE_DATA_RIGHTS_SERVICE_TOKEN?.trim()||null
 const socialToken=process.env.XIJIE_SOCIAL_SERVICE_TOKEN?.trim()||null
 const giftsToken=process.env.XIJIE_GIFTS_SERVICE_TOKEN?.trim()||null
 if(giftsToken&&(!/^[a-f0-9]{64}$/i.test(giftsToken)||[serviceToken,conversationsToken,dataRightsToken,socialToken].some(token=>token?.toLowerCase()===giftsToken.toLowerCase())))throw new Error('Invalid Gifts service credential')
 if(socialToken&&!/^[a-f0-9]{64}$/i.test(socialToken))throw new Error('Invalid Social service credential')
 const automaticMemorySetting=process.env.AUTOMATIC_MEMORY_ENABLED?.trim()||'false'
 if(!['true','false'].includes(automaticMemorySetting))throw new Error('Invalid AUTOMATIC_MEMORY_ENABLED')
 if(dataRightsToken&&!/^[a-f0-9]{64}$/i.test(dataRightsToken))throw new Error('Invalid data rights service credential')
 const webOrigin=origin(process.env.MEMORIES_WEB_ORIGIN||'http://127.0.0.1:5184','MEMORIES_WEB_ORIGIN'),host=process.env.MEMORIES_HOST||'127.0.0.1',port=Number(process.env.MEMORIES_PORT||3104)
 if(!Number.isInteger(port)||port<1||port>65535||webOrigin.startsWith('http:')&&!loopback.has(host))throw new Error('Invalid memories listener')
 return {socialOrigin:process.env.XIJIE_SOCIAL_URL?origin(process.env.XIJIE_SOCIAL_URL,'XIJIE_SOCIAL_URL'):undefined,databaseUrl:requiredEnv('DATABASE_URL'),host,port,webOrigin,serviceToken,conversationsToken,dataRightsToken,socialToken,giftsToken,automaticMemoryEnabled:automaticMemorySetting==='true',queueSchema:process.env.MEMORIES_QUEUE_SCHEMA||'memory_queue',identityOrigin:origin(requiredEnv('XIJIE_IDENTITY_URL'),'XIJIE_IDENTITY_URL'),peopleOrigin:origin(requiredEnv('XIJIE_PEOPLE_URL'),'XIJIE_PEOPLE_URL'),conversationsOrigin:origin(requiredEnv('XIJIE_CONVERSATIONS_URL'),'XIJIE_CONVERSATIONS_URL'),sessionCookie:webOrigin.startsWith('https:')?'__Host-xijie_session':'xijie_dev_session'}
}
export type MemoryConfig=ReturnType<typeof readConfig>
