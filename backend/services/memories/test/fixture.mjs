import {randomUUID} from 'node:crypto'
import {readFile,readdir} from 'node:fs/promises'
import pg from 'pg'
import {MemoryStore} from '../dist/store.js'
import {MemoryError} from '../dist/contracts.js'
export async function fixture(t){
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL;if(!connectionString)throw new Error('Set XIJIE_TEST_DATABASE_URL to an integration database.')
 const schema='memory_test_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString});await admin.query('CREATE SCHEMA '+schema)
 const pool=new pg.Pool({connectionString,options:'-c search_path='+schema});for(const name of (await readdir(new URL('../db/',import.meta.url))).filter(value=>/^\d+_.+\.sql$/.test(value)).sort())await pool.query(await readFile(new URL('../db/'+name,import.meta.url),'utf8'))
 t.after(async()=>{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()})
 const accounts=new Map(),people=new Map(),sessions=new Map(),sources=new Map(),world={id:randomUUID(),code:'courtyard',displayName:'日光庭院',enabled:true,catalogVersion:1}
 const absent=()=>new MemoryError(404,'NOT_FOUND','Missing')
 const dependencies={
  async session(cookie,expected){const credential=/xijie_dev_session=([^;]+)/.exec(cookie)?.[1],value=sessions.get(credential);if(!value||expected!==undefined&&value.sessionId!==expected)throw new MemoryError(401,'UNAUTHENTICATED','Sign in');return structuredClone(value)},
  async account(id){const value=accounts.get(id);if(!value)throw absent();return structuredClone(value)},
  async person(aid,id){const value=people.get(id);if(!value||value.accountId!==aid)throw absent();return structuredClone(value)},
  async persons(aid){return [...people.values()].filter(value=>value.accountId===aid).map(value=>structuredClone(value))},
  async worlds(){return [structuredClone(world)]},
  async source(aid,id){const value=sources.get(id);if(!value||value.accountId!==aid)throw absent();return structuredClone(value)},
  async memoryContext(aid,id){const value=sources.get(id),parent=sources.get(value?.replyToMessageId);if(!value||!parent||value.accountId!==aid||parent.accountId!==aid||value.author.kind!=='persona'||parent.author.kind!=='self')throw absent();return structuredClone({source:value,messages:[parent,value]})},
 }
 function account(){const id=randomUUID(),sid=randomUUID(),credential=randomUUID().replaceAll('-','').padEnd(43,'x'),account={accountId:id,status:'active',accessVersion:1,storyStorage:{allowed:true,authorizationVersion:1},aiTextProcessing:{allowed:true,authorizationVersion:1}};accounts.set(id,account);sessions.set(credential,{accountId:id,sessionId:sid,expiresAt:new Date(Date.now()+3600000).toISOString(),storyStorage:account.storyStorage,aiTextProcessing:account.aiTextProcessing});const person={id:randomUUID(),accountId:id,displayName:'小远',relationship:'挚友',story:'我们在杭州生活。',worldId:world.id,status:'active',version:1,accessVersion:1};people.set(person.id,person);return {id,person,sid,cookie:'xijie_dev_session='+credential}}
 function source(a){const parent={id:randomUUID(),accountId:a.id,personId:a.person.id,conversationId:randomUUID(),kind:'text',author:{kind:'self'},text:'毕业那年夏天，我们一起去河边散步。',version:1,createdAt:new Date().toISOString()};const value={...parent,id:randomUUID(),author:{kind:'persona',personId:a.person.id,displayName:'小远',aiGenerated:true},replyToMessageId:parent.id,text:'合成聊天回复'};sources.set(parent.id,parent);sources.set(value.id,value);return value}
 return {pool,dependencies,store:new MemoryStore(pool,dependencies),account,source,accounts,people,sessions,sources,world,schema,connectionString}
}
export const input=(body='毕业那年夏天，我们一起去河边散步。')=>({clientMemoryId:randomUUID(),title:'河边散步',body})
