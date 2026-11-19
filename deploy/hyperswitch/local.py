"""Private loopback Hyperswitch lifecycle. Never targets a Xijie database or removes volumes."""
import argparse
import hashlib
import ipaddress
import json
import os
import pathlib
import re
import secrets
import shutil
import subprocess
import tarfile
import tomllib
import urllib.request
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[2]
HERE = pathlib.Path(__file__).resolve().parent
LOCK = json.loads((HERE / 'source-lock.json').read_text(encoding='utf-8'))
PINS = {
    'rust': 'rust:1.94.1-trixie@sha256:652612f07bfbbdfa3af34761c1e435094c00dde4a98036132fca28c7bb2b165c',
    'runtime': 'debian:trixie-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2',
    'node': 'node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5',
    'nginx': 'nginx:1.28-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236',
    'pg': 'postgres:16-alpine@sha256:81e77a4833487b8132fe4b00bedd39dc3f74b8641e387f19312a48f7de218c2e',
    'redis': 'redis:7-alpine@sha256:7f7d30b7fdd09467bac58198a1f166dd69789d348d4fe859cccb20e0cf287fbe',
    'superposition':'ghcr.io/juspay/superposition-demo@sha256:51f3a310016879b7419ab64e6b6dbc81c739cdf5985f8f4cc19ba6f9384b2c6d',
}

def write(path, value):
    path.write_text(value if isinstance(value, str) else json.dumps(value, indent=2), encoding='utf-8')

def command(args, **kwargs):
    if kwargs.get('text'):kwargs.setdefault('encoding','utf-8');kwargs.setdefault('errors','replace')
    return subprocess.run(args, check=True, **kwargs)

def source_manifest(home):
    return {str(path.relative_to(home)).replace('\\','/'):hashlib.file_digest(path.open('rb'),'sha256').hexdigest() for name in ['backend','webSdk'] for path in sorted((home/name).rglob('*')) if path.is_file() and '.git' not in path.parts}

def lock_images(home,value):
    compose=json.loads((home/'compose.json').read_text(encoding='utf-8'))
    images={}
    for service,tag in {'router':'router:8e75ce7c','sdk':'sdk:f6f83b9c','migration':'migrations:diesel2.3.5'}.items():
        raw=json.loads(command(['docker','image','inspect',value['project']+'-'+tag],capture_output=True,text=True).stdout)[0]
        images[service]={k:raw[k] for k in ['Id','RepoTags','RepoDigests','Descriptor'] if k in raw}
        compose['services'][service]['image']=raw['Id']
        compose['services'][service]['pull_policy']='never'
    write(home/'built-images.json',images)
    write(home/'compose.json',compose)
    value['composeSha256']=hashlib.sha256((home/'compose.json').read_bytes()).hexdigest()
    write(home/'deployment.json',value)

def archive(home, repo, pin, dest):
    target = home / (dest.name + '-source.tar.gz')
    with urllib.request.urlopen('https://codeload.github.com/juspay/' + repo + '/tar.gz/' + pin, timeout=90) as response, target.open('wb') as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
    with tarfile.open(target) as source:
        for member in source.getmembers():
            parts = pathlib.PurePosixPath(member.name).parts
            if parts[0] != repo + '-' + pin or '..' in parts or member.issym() or member.islnk():
                raise ValueError('Unsafe pinned source archive')
            if len(parts) < 2:
                continue
            output = dest.joinpath(*parts[1:])
            output.parent.mkdir(parents=True, exist_ok=True)
            if member.isdir():
                output.mkdir(exist_ok=True)
            elif member.isfile():
                output.write_bytes(source.extractfile(member).read())
    write(home / (dest.name + '-source-proof.json'), {'repository': repo, 'commit': pin, 'archiveSha256': hashlib.file_digest(target.open('rb'), 'sha256').hexdigest()})

def prepare(home, api_port, sdk_port):
    if not(1024<=api_port<=65535 and 1024<=sdk_port<=65535 and api_port!=sdk_port):raise ValueError('Use distinct unprivileged loopback ports')
    if (home / 'deployment.json').exists():
        raise ValueError('Already prepared: credentials and existing data must be preserved')
    token = re.fullmatch(r'hyperswitch-local-([a-f0-9]{10})', home.name)
    if not token or home.parent != (ROOT / '.tmp').resolve():
        raise ValueError('Use a new workspace .tmp/hyperswitch-local-<10 random hex> directory')
    if home.exists() and any(home.iterdir()):raise ValueError('Prepare requires an empty new directory; it never overwrites another checkout')
    architecture=command(['docker','info','--format','{{.Architecture}}'],capture_output=True,text=True).stdout.strip()
    if architecture not in ['x86_64','amd64']:raise ValueError('This pinned local toolchain requires a Linux amd64 Docker engine')
    if shutil.disk_usage(home.parent).free<25*1024**3:raise ValueError('Keep at least 25 GiB free before preparing a new gateway build')
    home.mkdir(exist_ok=True)
    if os.name == 'nt':
        command(['icacls', str(home), '/inheritance:r', '/grant:r', os.environ['USERNAME'] + ':(OI)(CI)F', 'SYSTEM:(OI)(CI)F'], stdout=subprocess.DEVNULL)
    if not (home / 'backend/Cargo.lock').exists():
        archive(home, 'hyperswitch', LOCK['backend']['commit'], home / 'backend')
    if not (home / 'webSdk/package-lock.json').exists():
        archive(home, 'hyperswitch-web', LOCK['webSdk']['commit'], home / 'webSdk')
    if not (home / 'webSdk/shared-code/sdk-utils').exists():
        archive(home, 'hyperswitch-sdk-utils', LOCK['webSdk']['sharedCodeCommit'], home / 'webSdk/shared-code')
    # Official release binary, verified against its independently published digest.
    diesel = home / 'diesel'
    if not diesel.exists():
        name = 'diesel_cli-x86_64-unknown-linux-gnu.tar.xz'
        with urllib.request.urlopen('https://github.com/diesel-rs/diesel/releases/download/v2.3.5/' + name, timeout=90) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != '264d6f71426d9cf25ce389d1669ef9a18df0bc8f1807736be76a757843ee1645':
            raise ValueError('Official Diesel binary checksum differs')
        asset = home / name
        asset.write_bytes(data)
        with tarfile.open(asset) as source:
            matches = [m for m in source.getmembers() if m.isfile() and pathlib.PurePosixPath(m.name).name == 'diesel']
            if len(matches) != 1:
                raise ValueError('Official Diesel archive differs')
            diesel.write_bytes(source.extractfile(matches[0]).read())
    config = (home / 'backend/config/development.toml').read_text(encoding='utf-8')
    values = {k: secrets.token_hex(32) for k in ['db', 'redis', 'admin', 'jwt', 'master', 'hash', 'auth', 'pm','sp_db','sp_token']}
    def set_value(section, key, value):
        nonlocal config
        pattern = re.compile(r'(?ms)^\[' + re.escape(section) + r'\]\s*\n(.*?)(?=^\[|\Z)')
        match = pattern.search(config)
        line = key + ' = ' + json.dumps(value)
        if match is None:
            config += '\n[' + section + ']\n' + line + '\n'
            return
        body = match.group(1)
        field = re.compile(r'(?m)^' + re.escape(key) + r'\s*=.*$')
        body = field.sub(line, body) if field.search(body) else body + line + '\n'
        config = config[:match.start(1)] + body + config[match.end(1):]
    api, sdk = 'http://127.0.0.1:' + str(api_port), 'http://127.0.0.1:' + str(sdk_port)
    for section in ['master_database', 'replica_database', 'accounts_database', 'global_database', 'analytics.sqlx']:
        for key, value in {'username': 'hyperswitch', 'password': values['db'], 'host': 'pg', 'dbname': 'hyperswitch', 'port': 5432}.items():
            set_value(section, key, value)
    for section, fields in {
        'redis': {'host': 'redis', 'port': 6379, 'primary_password': values['redis'], 'cluster_enabled': False},
        'server': {'host': '0.0.0.0', 'port': 8080,'workers':2},
        'secrets': {'admin_api_key': values['admin'], 'jwt_secret': values['jwt'], 'master_enc_key': values['master']},
        'api_keys': {'hash_key': values['hash']}, 'user_auth_methods': {'encryption_key': values['auth']},
        'payment_method_auth': {'pm_auth_key': values['pm']}, 'payment_link': {'sdk_url': sdk + '/HyperLoader.js'},
        'log.console': {'level': 'ERROR'}, 'log.telemetry': {'metrics_enabled': False},
        'cors': {'wildcard_origin': False, 'origins': api + ',' + sdk},
        'multitenancy.tenants.public': {'base_url': api, 'mtls_base_url': api},
        'internal_services': {'payments_base_url': 'http://router:8080'},
        'superposition':{'endpoint':'http://superposition:8080','token':values['sp_token']},
    }.items():
        for key, value in fields.items():
            set_value(section, key, value)
    write(home / 'local.toml', config)
    seed=(home/'backend/config/superposition_seed.toml').read_text(encoding='utf-8')
    corrected,count=re.subn(r'(?m)^(merchant_connector_id\s*=\s*\{\s*position\s*=\s*)21\b',r'\g<1>22',seed)
    positions=[v['position'] for v in tomllib.loads(corrected)['dimensions'].values()]
    if count!=1 or len(set(positions))!=len(positions):raise ValueError('Pinned Superposition seed correction no longer applies')
    write(home/'superposition_seed.local.toml',corrected)
    write(home/'seed-correction.json',{'originalSha256':hashlib.sha256(seed.encode()).hexdigest(),'configuredSha256':hashlib.sha256(corrected.encode()).hexdigest(),'correction':'merchant_connector_id dimension position 21 -> 22; duplicate 21 rejected by upstream provider'})
    write(home/'seed.json',tomllib.loads(corrected))
    shutil.copyfile(HERE/'superposition-bootstrap.sh',home/'superposition-bootstrap.sh')
    shutil.copyfile(HERE/'seed-config.mjs',home/'seed-config.mjs')
    upstream_env=command(['docker','run','--rm','--network','none','--read-only','--entrypoint','/bin/cat',PINS['superposition'],'/app/.env'],capture_output=True,text=True).stdout
    sp_env=re.sub(r'(?m)^DATABASE_URL=.*$','DATABASE_URL=postgres://postgres:'+values['sp_db']+'@localhost/config',upstream_env)
    sp_env+='\nDB_PASSWORD='+values['sp_db']+'\nSUPERPOSITION_TOKEN='+values['sp_token']+'\n'
    write(home/'superposition-private.env',sp_env)
    write(home/'superposition.env','SP_DB_PASSWORD='+values['sp_db']+'\nDB_PASSWORD='+values['sp_db']+'\nSUPERPOSITION_TOKEN='+values['sp_token']+'\nDATABASE_URL=postgres://postgres:'+values['sp_db']+'@localhost/config\nREDIS_URL=redis://:'+values['redis']+'@redis:6379\nAPI_HOSTNAME=http://superposition:8080\nRUST_LOG=error\n')
    write(home/'seed.env','SUPERPOSITION_TOKEN='+values['sp_token']+'\n')
    write(home / 'secrets.json', values)
    write(home / 'database.env', 'POSTGRES_USER=hyperswitch\nPOSTGRES_DB=hyperswitch\nPOSTGRES_PASSWORD=' + values['db'] + '\n')
    write(home / 'migration.env', 'DATABASE_URL=postgresql://hyperswitch:' + values['db'] + '@pg:5432/hyperswitch\n')
    write(home / 'redis.env', 'REDISCLI_AUTH=' + values['redis'] + '\n')
    write(home / 'redis.conf', 'bind 0.0.0.0\nport 6379\nrequirepass ' + values['redis'] + '\nappendonly yes\ndir /data\n')
    write(home/'proxy.conf','resolver 127.0.0.11 valid=5s;\nserver { listen 8080; server_name _; location / { set $upstream http://router:8080; proxy_pass $upstream; proxy_set_header Host $http_host; } }\nserver { listen 9050; server_name _; location / { set $upstream http://sdk:80; proxy_pass $upstream; proxy_set_header Host $http_host; } }\n')
    project = 'xijie-hs-' + token.group(1)
    health = lambda test: {'test': test, 'interval': '5s', 'timeout': '3s', 'retries': 30}
    network_ids=command(['docker','network','ls','-q'],capture_output=True,text=True).stdout.split()
    network_data=json.loads(command(['docker','network','inspect',*network_ids],capture_output=True,text=True).stdout)
    existing=[ipaddress.ip_network(c['Subnet']) for n in network_data for c in (n.get('IPAM',{}).get('Config') or []) if c.get('Subnet')]
    if os.name=='nt':
        routes=command(['powershell','-NoProfile','-Command',"Get-NetRoute -AddressFamily IPv4 | Select-Object -ExpandProperty DestinationPrefix -Unique"],capture_output=True,text=True).stdout.split()
        existing.extend(ipaddress.ip_network(r) for r in routes if r!='0.0.0.0/0')
    subnets=[f'10.253.{n}.0/24' for n in range(243,200,-1) if not any(ipaddress.ip_network(f'10.253.{n}.0/24').overlaps(v) for v in existing)][:2]
    if len(subnets)!=2:raise ValueError('No free isolated local subnets; no old network was removed')
    compose = {'services': {
        'pg': {'image': PINS['pg'], 'env_file': ['database.env'], 'volumes': ['pg_data:/var/lib/postgresql/data'], 'networks': ['private'], 'healthcheck': health(['CMD-SHELL', 'pg_isready -U hyperswitch -d hyperswitch'])},
        'redis': {'image': PINS['redis'], 'command': ['redis-server', '/usr/local/etc/redis/redis.conf'], 'env_file': ['redis.env'], 'volumes': ['redis_data:/data', './redis.conf:/usr/local/etc/redis/redis.conf:ro'], 'networks': ['private'], 'healthcheck': health(['CMD', 'redis-cli', 'ping'])},
        'migration': {'image': project + '-migrations:diesel2.3.5', 'env_file': ['migration.env'], 'volumes': ['./backend/migrations:/migrations:ro'], 'networks': ['private'], 'depends_on': {'pg': {'condition': 'service_healthy'}}, 'profiles': ['tools']},
        'superposition':{'image':PINS['superposition'],'command':['/bin/sh','/private/bootstrap.sh'],'env_file':['superposition.env'],'volumes':['superposition_data:/var/lib/postgresql','./superposition-bootstrap.sh:/private/bootstrap.sh:ro','./superposition-private.env:/app/.env:ro'],'networks':['private'],'depends_on':{'redis':{'condition':'service_healthy'}},'healthcheck':health(['CMD-SHELL','curl --fail --silent http://127.0.0.1:8080/health >/dev/null'])},
        'seed':{'image':PINS['node'],'command':['node','/private/seed-config.mjs'],'env_file':['seed.env'],'volumes':['./seed.json:/private/seed.json:ro','./seed-config.mjs:/private/seed-config.mjs:ro'],'networks':['private'],'depends_on':{'superposition':{'condition':'service_healthy'}},'profiles':['tools']},
        'router': {'image': project + '-router:8e75ce7c','environment':{'RUST_MIN_STACK':'67108864'}, 'volumes': ['./local.toml:/local/config/local.toml:ro','./superposition_seed.local.toml:/local/config/superposition_seed.toml:ro'], 'networks': ['private'], 'depends_on': {'pg': {'condition': 'service_healthy'}, 'redis': {'condition': 'service_healthy'}}, 'healthcheck': health(['CMD', 'curl', '--fail', '--silent', 'http://127.0.0.1:8080/health'])},
        'sdk': {'image': project + '-sdk:f6f83b9c', 'networks': ['private'], 'healthcheck': health(['CMD', 'wget','--spider', '-q', 'http://127.0.0.1/HyperLoader.js'])},
        'proxy':{'image':PINS['nginx'],'volumes':['./proxy.conf:/etc/nginx/conf.d/default.conf:ro'],'networks':['private','edge'],'ports':['127.0.0.1:'+str(api_port)+':8080','127.0.0.1:'+str(sdk_port)+':9050'],'depends_on':{'sdk':{'condition':'service_healthy'}},'healthcheck':health(['CMD','wget','--spider','-q','http://127.0.0.1:9050/HyperLoader.js'])},
    }, 'networks': {'private': {'internal': True,'ipam':{'config':[{'subnet':subnets[0]}]}},'edge':{'ipam':{'config':[{'subnet':subnets[1]}]}}}, 'volumes': {'pg_data': {}, 'redis_data': {},'superposition_data':{}}}
    compose['services']['router']['depends_on']['superposition']={'condition':'service_healthy'}
    write(home / 'compose.json', compose)
    write(home/'source-manifest.json',source_manifest(home))
    write(home / 'deployment.json', {'format': 1, 'project': project, 'home': str(home), 'apiOrigin': api, 'sdkOrigin': sdk, 'sourceLock': LOCK,'composeSha256':hashlib.sha256((home/'compose.json').read_bytes()).hexdigest()})
    print('Private deployment prepared; no credentials printed.')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['prepare', 'build','lock-images', 'start', 'stop', 'status', 'verify'])
    parser.add_argument('--home', required=True, type=pathlib.Path)
    parser.add_argument('--api-port', type=int, default=28180)
    parser.add_argument('--sdk-port', type=int, default=28150)
    args = parser.parse_args()
    home = args.home.resolve()
    if args.action == 'prepare':
        prepare(home, args.api_port, args.sdk_port)
        return
    value = json.loads((home / 'deployment.json').read_text(encoding='utf-8'))
    token=re.fullmatch(r'hyperswitch-local-([a-f0-9]{10})',home.name)
    if value['home'] != str(home) or not token or value['project']!='xijie-hs-'+token.group(1) or home.parent != (ROOT / '.tmp').resolve():
        raise ValueError('Unowned deployment descriptor')
    if value.get('composeSha256')!=hashlib.sha256((home/'compose.json').read_bytes()).hexdigest():
        raise ValueError('Deployment topology changed; inspect it before any lifecycle action')
    project = value['project']
    compose = ['docker', 'compose', '--project-name', project, '--project-directory', str(home), '-f', str(home / 'compose.json')]
    if args.action == 'build':
        if json.loads((home/'source-manifest.json').read_text(encoding='utf-8'))!=source_manifest(home):raise ValueError('Pinned source changed after preparation')
        for dockerfile, context, tag, extra in [('Backend.Dockerfile', 'backend', 'router:8e75ce7c', []), ('Sdk.Dockerfile', 'webSdk', 'sdk:f6f83b9c', ['--build-arg', 'API_ORIGIN=' + value['apiOrigin'], '--build-arg', 'SDK_ORIGIN=' + value['sdkOrigin']]), ('Migration.Dockerfile', '.', 'migrations:diesel2.3.5', [])]:
            command(['docker', 'build', '--progress', 'plain', '-f', str(HERE / dockerfile), '-t', project + '-' + tag, *extra, str(home / context)])
        lock_images(home,value)
    elif args.action=='lock-images':
        lock_images(home,value)
    elif args.action == 'start':
        images=json.loads((home/'built-images.json').read_text(encoding='utf-8'))
        topology=json.loads((home/'compose.json').read_text(encoding='utf-8'))
        for service,metadata in images.items():
            if topology['services'][service]['image']!=metadata['Id']:raise ValueError('Built image identity changed')
            command(['docker','image','inspect',metadata['Id']],stdout=subprocess.DEVNULL)
        command(compose + ['config', '--quiet'])
        command(compose + ['up', '-d', '--wait', 'pg', 'redis', 'sdk','proxy','superposition'])
        command(compose + ['run', '--rm', 'migration'])
        command(compose+['exec','-T','pg','psql','-U','hyperswitch','-d','hyperswitch','-v','ON_ERROR_STOP=1','-c',"INSERT INTO configs (key,config) VALUES ('payment_callback','{\"mode\":\"enforced\"}') ON CONFLICT(key) DO NOTHING"])
        # Invalidate only the exact bootstrap key, including an earlier cached miss.
        command(compose+['exec','-T','redis','redis-cli','DEL','payment_callback'])
        seed_hash=hashlib.sha256((home/'seed.json').read_bytes()).hexdigest()
        psql=compose+['exec','-T','superposition','psql','-U','postgres','-d','config','-v','ON_ERROR_STOP=1','-Atc']
        present=command(psql+["SELECT to_regclass('public.xijie_local_seed') IS NOT NULL"],capture_output=True,text=True).stdout.strip()
        accepted=command(psql+['SELECT seed_sha256 FROM public.xijie_local_seed WHERE version=1'],capture_output=True,text=True).stdout.strip() if present=='t' else ''
        if accepted and accepted!=seed_hash:raise ValueError('Previously accepted configuration seed changed; existing configuration was preserved')
        if not accepted:
            command(compose+['run','--rm','seed'])
            command(psql+["CREATE TABLE IF NOT EXISTS public.xijie_local_seed(version integer PRIMARY KEY,seed_sha256 text NOT NULL); INSERT INTO public.xijie_local_seed VALUES(1,'"+seed_hash+"') ON CONFLICT(version) DO NOTHING"])
        command(compose + ['up', '-d', '--wait', 'router'])
    elif args.action == 'stop':
        command(compose + ['down'])  # Deliberately no --volumes, no prune.
    elif args.action == 'status':
        command(compose + ['ps'])
    else:
        evidence = {'format': 1, 'project': project, 'sources': LOCK,'baseImages':PINS, 'merchantPaymentVerified': False, 'walletDeviceVerified': False}
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        for name, url in {'health': value['apiOrigin'] + '/health', 'sdkLoader': value['sdkOrigin'] + '/HyperLoader.js', 'sdkPage': value['sdkOrigin'] + '/index.html','sdkApp':value['sdkOrigin']+'/app.js'}.items():
            with opener.open(url, timeout=15) as response:
                if response.geturl()!=url:raise ValueError('Local gateway unexpectedly redirected')
                data = response.read()
                if name in ['sdkLoader','sdkApp'] and not all(origin.encode() in data for origin in [value['apiOrigin'],value['sdkOrigin']]):raise ValueError('SDK does not embed this private API and SDK origin')
                if name=='sdkPage' and value['apiOrigin'].encode() not in data:raise ValueError('SDK CSP omits the private API origin')
                evidence[name] = {'status': response.status, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),'contentType':response.headers.get('Content-Type')}
        output=command(compose + ['ps', '--format', 'json'], capture_output=True, text=True).stdout
        evidence['containers'] = [json.loads(line) for line in output.splitlines() if line.strip()]
        evidence['images']=[]
        for tag in ['router:8e75ce7c','sdk:f6f83b9c','migrations:diesel2.3.5']:
            raw=json.loads(command(['docker','image','inspect',project+'-'+tag],capture_output=True,text=True).stdout)[0]
            evidence['images'].append({k:raw[k] for k in ['Id','RepoTags','RepoDigests','Descriptor'] if k in raw})
        write(home / 'verification.json', evidence)
        print('Health and self-hosted SDK bytes verified; no payment executed.')

if __name__ == '__main__':
    main()
