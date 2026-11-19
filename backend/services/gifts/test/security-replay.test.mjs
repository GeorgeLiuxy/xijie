import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import pg from 'pg'
import {captureSecurityReplay,replaySecurity,validateReplayDomain} from '../../../../deploy/recovery/security-replay.mjs'

async function fixture(t,domain='gifts'){
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL;assert(connectionString)
 const schema='security_replay_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString}),pool=new pg.Pool({connectionString,options:'-c search_path='+schema})
 await admin.query('CREATE SCHEMA '+schema);t.after(async()=>{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()})
 const target={domain,kind:'target',runId:randomUUID()},convert=sql=>sql.replaceAll("n.nspname='public'","n.nspname='"+schema+"'").replaceAll('"public".','"'+schema+'".')
 const runtime={async query(_target,sql){assert.equal(_target,target);const rows=(await pool.query(convert(sql))).rows;return sql.includes('c.relkind AS kind')?rows.map(r=>({...r,schema:'public',foreignKeys:r.foreignKeys.map(f=>({...f,parentSchema:'public'}))})):rows},async sql(_target,sql){assert.equal(_target,target);assert.equal(_target.kind,'target');return pool.query(convert(sql))},async assertIsolatedTarget(value){assert.equal(value,target);assert.equal((await pool.query('SELECT current_schema() n')).rows[0].n,schema)}}
 return{pool,runtime,target}
}
test('actual PostgreSQL replay deletes corrected and removed originals, follows real FK closure and preserves an unchanged independent cherished copy',async t=>{
 const f=await fixture(t,'memories'),owner=randomUUID(),source=randomUUID(),copy=randomUUID(),child=randomUUID()
 await f.pool.query('CREATE TABLE memory_candidates(id uuid PRIMARY KEY,account_id uuid NOT NULL,body text NOT NULL);CREATE TABLE candidate_commands(id uuid PRIMARY KEY,message_id uuid NOT NULL REFERENCES memory_candidates(id),body text);CREATE TABLE memories(id uuid PRIMARY KEY,account_id uuid NOT NULL,source_message_id uuid,body text NOT NULL)')
 await f.pool.query("INSERT INTO memory_candidates VALUES($1,$2,'OLD_PRIVATE_ORIGINAL')",[source,owner]);await f.pool.query("INSERT INTO candidate_commands VALUES($1,$2,'PRIVATE_DERIVATIVE')",[child,source]);await f.pool.query("INSERT INTO memories VALUES($1,$2,$3,'INDEPENDENT_CHERISHED_COPY')",[copy,owner,source])
 const old=await captureSecurityReplay(f.runtime,f.target);await f.pool.query("UPDATE memory_candidates SET body='NEW_PRIVATE_CORRECTION' WHERE id=$1",[source]);const latest=await captureSecurityReplay(f.runtime,f.target)
 assert(!JSON.stringify(latest).includes('PRIVATE'));assert(!JSON.stringify(latest).includes('CHERISHED'))
 await f.pool.query("UPDATE memory_candidates SET body='OLD_PRIVATE_ORIGINAL' WHERE id=$1",[source]);const proof=await replaySecurity(f.runtime,f.target,latest)
 assert.equal(proof.foreignReferencesClosed,true);assert.equal(proof.invalidatedRows,2);assert.equal((await f.pool.query('SELECT count(*)::integer n FROM memory_candidates')).rows[0].n,0);assert.equal((await f.pool.query('SELECT count(*)::integer n FROM candidate_commands')).rows[0].n,0);assert.equal((await f.pool.query('SELECT body FROM memories')).rows[0].body,'INDEPENDENT_CHERISHED_COPY')
 assert.equal(proof.releaseReady,false);assert.equal((await f.pool.query('SHOW session_replication_role')).rows[0].session_replication_role,'origin')
 const rerun=await replaySecurity(f.runtime,f.target,latest);assert.equal(rerun.invalidatedRows,0)
 await f.pool.query("INSERT INTO memory_candidates VALUES($1,$2,'OLD_PRIVATE_ORIGINAL')",[source,owner]);await f.pool.query("INSERT INTO candidate_commands VALUES($1,$2,'PRIVATE_DERIVATIVE')",[child,source]);const incomplete={...f.runtime,sql:(target,sql)=>f.runtime.sql(target,sql.replace(/DO \$replay\$[\s\S]+?END \$replay\$/,'SELECT 1'))};await assert.rejects(replaySecurity(incomplete,f.target,latest),/foreign reference closure is incomplete/)
 const bad=structuredClone(latest);bad.tables.find(t=>t.name==='memory_candidates').rows[0].key=[];assert.throws(()=>validateReplayDomain(bad),/row metadata/)
 const unsafe={...f.target,kind:'source'};await assert.rejects(replaySecurity(f.runtime,unsafe,latest),/owned isolated target/)
 const schemaChanged=structuredClone(latest);schemaChanged.schemaHash='0'.repeat(64);await assert.rejects(replaySecurity(f.runtime,f.target,schemaChanged),/schema metadata/)
 assert(old.tables.find(t=>t.name==='memory_candidates').rows[0].hash!==latest.tables.find(t=>t.name==='memory_candidates').rows[0].hash)
})
test('replay rejects nonempty tables without PK and prunes cross-domain deleted-account data even if its bytes did not change',async t=>{
 const f=await fixture(t),account=randomUUID();await f.pool.query('CREATE TABLE gift_deliveries(id uuid PRIMARY KEY,account_id uuid,body text);CREATE TABLE gift_notifications(body text)');await f.pool.query("INSERT INTO gift_deliveries VALUES($1,$2,'OLD_DELETED_PRIVATE')",[randomUUID(),account]);await f.pool.query("INSERT INTO gift_notifications VALUES('PRIVATE_UNKNOWN_KEY')");await assert.rejects(captureSecurityReplay(f.runtime,f.target),/no primary key/);await f.pool.query('DELETE FROM gift_notifications');const latest=await captureSecurityReplay(f.runtime,f.target),proof=await replaySecurity(f.runtime,f.target,latest,{deletedAccounts:[account]});assert.equal(proof.invalidatedRows,1);assert.equal((await f.pool.query('SELECT count(*)::integer n FROM gift_deliveries')).rows[0].n,0)
 await f.pool.query('CREATE TABLE unknown_sensitive_rows(id uuid PRIMARY KEY)');await assert.rejects(captureSecurityReplay(f.runtime,f.target),/unsupported table/)
})
