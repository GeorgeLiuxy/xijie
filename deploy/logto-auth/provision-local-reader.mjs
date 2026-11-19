import {readFile,writeFile} from 'node:fs/promises'
import {randomBytes} from 'node:crypto'
import {parseEnv} from 'node:util'
import {spawnSync} from 'node:child_process'
import {resolve} from 'node:path'
import {readerViolationSql} from './reader-policy.mjs'
// Explicit local-development helper. Production SQL and permissions are documented separately.
const args=process.argv.slice(2)
if(args.length!==2||args[0]!=='--env'||!args[1])throw Error('Usage: node provision-local-reader.mjs --env PRIVATE_IDENTITY_ENV')
const file=resolve(args[1]),text=await readFile(file,'utf8'),env=parseEnv(text)
if(!['http://localhost:3001/oidc','http://127.0.0.1:3001/oidc'].includes(env.OIDC_ISSUER))throw Error('This helper is restricted to the local development Logto')
const role='xijie_phone_reader',prior=env.LOGTO_ACCOUNT_READ_DATABASE_URL?new URL(env.LOGTO_ACCOUNT_READ_DATABASE_URL):null
if(prior&&(prior.hostname!=='127.0.0.1'||prior.port!=='5441'||prior.pathname!=='/logto'||decodeURIComponent(prior.username)!==role||prior.search||prior.hash))throw Error('Existing reader endpoint is not owned by this helper')
const secret=prior?decodeURIComponent(prior.password):randomBytes(32).toString('hex')
if(!/^[a-f0-9]{64}$/.test(secret))throw Error('Existing reader configuration is not owned by this helper')
const sql=`BEGIN;
DO $block$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; ELSIF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}' AND(rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication)) OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='${role}')) THEN RAISE EXCEPTION 'Existing reader role has unrelated privileges'; END IF; END $block$;
DO $block$ BEGIN IF (${readerViolationSql("'"+role+"'")}) OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='xijie_auth_reader' AND c.relname='bound_phones' AND c.relowner<>'logto'::regrole) OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='xijie_auth_reader' AND nspowner<>'logto'::regrole) THEN RAISE EXCEPTION 'Existing reader or view is not limited to the expected ownership and SELECT grant'; END IF; END $block$;
ALTER ROLE ${role} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${secret}';
ALTER ROLE ${role} SET default_transaction_read_only=on;
ALTER ROLE ${role} SET statement_timeout='5s';
CREATE SCHEMA IF NOT EXISTS xijie_auth_reader AUTHORIZATION logto;
CREATE OR REPLACE VIEW xijie_auth_reader.bound_phones WITH (security_barrier=true) AS SELECT id::text AS subject,primary_phone::text AS phone FROM public.users WHERE tenant_id='default';
REVOKE ALL ON SCHEMA xijie_auth_reader FROM PUBLIC;
REVOKE ALL ON xijie_auth_reader.bound_phones FROM PUBLIC;
GRANT CONNECT ON DATABASE logto TO ${role};
GRANT USAGE ON SCHEMA xijie_auth_reader TO ${role};
GRANT SELECT ON xijie_auth_reader.bound_phones TO ${role};
COMMIT;`
const result=spawnSync('docker',['exec','-i','xijie-identity-dev-logto-db-1','psql','-q','-U','logto','-d','logto','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'})
if(result.status!==0)throw Error('Local Logto reader provisioning failed; no credentials printed')
const url=new URL('postgresql://127.0.0.1:5441/logto');url.username=role;url.password=secret
const line='LOGTO_ACCOUNT_READ_DATABASE_URL='+url.href,pattern=/^LOGTO_ACCOUNT_READ_DATABASE_URL=.*$/m
await writeFile(file,pattern.test(text)?text.replace(pattern,line):text.trimEnd()+'\n'+line+'\n',{mode:0o600})
console.log('Local phone reader provisioned: SELECT on the two-column default-tenant view only; independent read-only credentials saved privately.')
