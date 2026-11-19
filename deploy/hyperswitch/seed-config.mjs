import {readFile} from 'node:fs/promises'
const origin='http://superposition:8080',seed=JSON.parse(await readFile('/private/seed.json','utf8')),headers={'Content-Type':'application/json','x-org-id':'localorg','x-workspace':'dev'}
if(process.env.SUPERPOSITION_TOKEN)headers.Authorization='Bearer '+process.env.SUPERPOSITION_TOKEN
async function send(path,body,method='POST'){const response=await fetch(origin+path,{method,headers,body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(!response.ok&&response.status!==409){await response.text();throw Error('Local configuration initialization rejected '+path+' with HTTP '+response.status)}}
for(const [dimension,row]of Object.entries(seed.dimensions).sort((a,b)=>a[1].position-b[1].position))await send('/dimension',{dimension,position:row.position,schema:row.schema,description:row.description??dimension,change_reason:'Pinned local deployment seed'})
for(const [key,row]of Object.entries(seed['default-configs']))await send('/default-config',{key,value:row.value,schema:row.schema,description:row.description??key,change_reason:'Pinned local deployment seed'})
for(const {_context_,...override}of seed.overrides??[])await send('/context',{context:_context_,override,description:'Pinned local deployment context',change_reason:'Pinned local deployment seed'},'PUT')
console.log(JSON.stringify({configurationInitialized:true,dimensions:Object.keys(seed.dimensions).length,defaults:Object.keys(seed['default-configs']).length,contexts:(seed.overrides??[]).length}))
