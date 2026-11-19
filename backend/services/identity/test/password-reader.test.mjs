import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {test} from 'node:test'
import {Pool} from 'pg'
import {PasswordMetadata} from '../dist/password-provider.js'

test('self-hosted phone reader uses the fixed tenant view and exact subject, with unavailable distinct from no phone',async t=>{
 const connectionString=process.env.XIJIE_TEST_DATABASE_URL;if(!connectionString)throw Error('Isolated test database required')
 const writer=new Pool({connectionString}),schema='reader_fixture_'+randomUUID().replaceAll('-','');let created=false,metadata
 // A fixed production view name is tested only in this explicitly created isolated database.
 assert.match((await writer.query('SELECT current_database() n')).rows[0].n,/^xijie_login_test_[a-z0-9_]+$/)
 t.after(async()=>{await metadata?.close();if(created){await writer.query('DROP SCHEMA xijie_auth_reader CASCADE');await writer.query('DROP SCHEMA '+schema+' CASCADE')}await writer.end()})
 assert.equal((await writer.query("SELECT 1 FROM pg_namespace WHERE nspname='xijie_auth_reader'")).rowCount,0,'refuse to replace a view owned by another test or service')
 await writer.query('CREATE SCHEMA '+schema);await writer.query('CREATE SCHEMA xijie_auth_reader');created=true
 await writer.query('CREATE TABLE '+schema+'.users(tenant text,subject text,phone text)')
 await writer.query('INSERT INTO '+schema+".users VALUES('default','original-subject','+16505550199'),('other','original-subject','16505550999'),('default','social-only',NULL),('default','bad-format','invalid-phone')")
 await writer.query('CREATE VIEW xijie_auth_reader.bound_phones WITH(security_barrier=true) AS SELECT subject,phone FROM '+schema+".users WHERE tenant='default'")
 metadata=new PasswordMetadata({issuer:new URL('https://id.example.test/oidc'),accountReader:{databaseUrl:connectionString}})
 assert.equal(await metadata.boundPhone('original-subject'),'16505550199')
 assert.equal(await metadata.boundPhone('social-only'),null)
 for(const subject of ['missing-subject',"original-subject' OR TRUE --",'bad-format'])await assert.rejects(metadata.boundPhone(subject),e=>e.code==='AUTH_PROVIDER_UNAVAILABLE')
 await writer.query('INSERT INTO '+schema+".users VALUES('default','original-subject','16505550888')")
 await assert.rejects(metadata.boundPhone('original-subject'),e=>e.code==='AUTH_PROVIDER_UNAVAILABLE')
 await writer.query('DELETE FROM '+schema+".users WHERE phone='16505550888'")
 assert.equal(await metadata.boundPhone('original-subject'),'16505550199','a fresh read follows the original subject after a prior provider error')
 await writer.query('UPDATE '+schema+".users SET phone='16505550200' WHERE tenant='default' AND subject='original-subject'")
 assert.equal(await metadata.boundPhone('original-subject'),'16505550200','phone bindings are not cached from an old login')
 await writer.query('ALTER VIEW xijie_auth_reader.bound_phones RENAME TO temporarily_unavailable')
 await assert.rejects(metadata.boundPhone('original-subject'),e=>e.code==='AUTH_PROVIDER_UNAVAILABLE')
 assert.equal((await writer.query('SELECT count(*)::int n FROM '+schema+'.users')).rows[0].n,4,'the reader never mutates a provider user')
})
