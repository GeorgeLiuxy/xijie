"""Operate only one explicitly prepared, pinned local Jeepay deployment.

The deployment manifest and all secrets remain in its private .tmp directory.
Stop removes this project's containers/network while preserving every volume.
"""
import argparse, hashlib, ipaddress, json, os, re, shutil, subprocess, sys, uuid
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
DEPLOY = Path(__file__).resolve().parent
SERVICES = {'mysql','redis','rocketmq-namesrv','rocketmq-broker','payment','manager','merchant','ui-payment','ui-manager','ui-merchant'}


def require(value, message):
    if not value:
        raise RuntimeError(message)


def call(args, *, env=None, log=None, capture=False):
    if log:
        with log.open('w', encoding='utf-8') as stream:
            result = subprocess.run(args, cwd=ROOT, env=env, stdout=stream, stderr=subprocess.STDOUT)
        require(result.returncode == 0, 'Command failed; inspect private log: ' + log.name)
        return ''
    result = subprocess.run(args, cwd=ROOT, env=env, text=True, encoding='utf-8', capture_output=capture)
    require(result.returncode == 0, 'Command failed: ' + str(args[0]))
    return result.stdout if capture else ''


def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=('build','start','stop','status'))
    parser.add_argument('--deployment', type=Path, required=True)
    args = parser.parse_args()
    home = args.deployment.resolve()
    require(home.parent == (ROOT/'.tmp').resolve() and re.fullmatch(r'jeepay-local-[a-f0-9]{10}',home.name), 'Use a fresh private Jeepay task directory')
    manifest = json.loads((home/'deployment.json').read_text(encoding='utf-8-sig'))
    project = manifest['project']
    require(manifest['format'] == 1 and Path(manifest['home']).resolve() == home and project == 'xijie-'+home.name.replace('jeepay-local-','jeepay-'), 'Deployment manifest mismatch')
    lock = json.loads((DEPLOY/'source-lock.json').read_text(encoding='utf-8-sig'))
    require(manifest['mavenCache'] == project+'-maven', 'Build cache must belong to this deployment')
    require(manifest['backendCommit'] == lock['backend']['commit'] and manifest['uiCommit'] == lock['ui']['commit'], 'Manifest source pins differ from source-lock')
    for repo,pin in (('jeepay',lock['backend']['commit']),('jeepay-ui',lock['ui']['commit'])):
        require(call(['git','-C',str(home/repo),'rev-parse','HEAD'],capture=True).strip() == pin, 'Source commit mismatch')
        call(['git','-C',str(home/repo),'-c','core.autocrlf=false','diff','--quiet','HEAD'])
    values = {}
    for line in (home/'checkout.env').read_text(encoding='utf-8-sig').splitlines():
        if line.strip() and not line.lstrip().startswith('#'):
            key,value=line.split('=',1)
            require(key not in values, 'Duplicate deployment option')
            values[key]=value
    secret_names = ('JEEPAY_DB_ROOT_PASSWORD','JEEPAY_DB_PASSWORD','JEEPAY_REDIS_PASSWORD','JEEPAY_MANAGER_JWT_SECRET','JEEPAY_MERCHANT_JWT_SECRET')
    require(all(re.fullmatch(r'[a-f0-9]{64}', values.get(key,'')) for key in secret_names), 'Independent private secrets are required')
    require(len({values[key] for key in secret_names}) == len(secret_names), 'Do not reuse infrastructure secrets')
    require(values['JEEPAY_IMAGE_PREFIX'] == project, 'Image prefix must belong to this deployment')
    pins = {key:values[key] for key in ('MYSQL_IMAGE','REDIS_IMAGE','ROCKETMQ_IMAGE','JEEPAY_JRE_IMAGE','JEEPAY_NODE_IMAGE','JEEPAY_NGINX_IMAGE')}
    require(all(re.fullmatch(r'[a-z0-9/._-]+@sha256:[a-f0-9]{64}', value) for value in pins.values()), 'Use digest-pinned base images')
    require(all(value == lock['images'][key] for key,value in pins.items()) and manifest['mavenImage'] == lock['images']['MAVEN_IMAGE'], 'Base images differ from source-lock')
    env = dict(os.environ)
    for key in values:
        env.pop(key,None)  # A shell variable must not override this private file.
    compose = ['docker','compose','--env-file',str(home/'checkout.env'),'--project-directory',str(home/'jeepay'),'--project-name',project,'-f',str(home/'jeepay/docker-compose.yml'),'-f',str(DEPLOY/'compose.override.yml'),'-f',str(home/'local.override.yml')]
    config = json.loads(call(compose+['config','--format','json'],env=env,capture=True))
    require(set(config['services']) == SERVICES, 'Unexpected service set')
    observed_ports=[]
    for name, service in config['services'].items():
        require(not service.get('privileged') and not service.get('network_mode') and not service.get('container_name'), 'Unsafe shared runtime setting')
        require(set(service.get('networks',{})) == {'jeepay'}, 'A service must use only its independent network')
        for port in service.get('ports',[]):
            require(port.get('host_ip') == '127.0.0.1', 'Only loopback publication is allowed')
            observed_ports.append(int(port['published']))
        for volume in service.get('volumes',[]):
            if volume['type'] == 'bind':
                path=Path(volume['source']).resolve()
                require(path.is_relative_to(home) or path.is_relative_to(DEPLOY), 'A bind mount leaves the task directories')
    require(sorted(observed_ports) == sorted(manifest['ports']) and len(observed_ports) == 4, 'Unexpected published ports')
    require(all(not volume.get('external') and volume['name'].startswith(project+'_') for volume in config.get('volumes',{}).values()), 'A volume leaves this project')
    network=config['networks']['jeepay']
    require(not network.get('external') and network['name'] == project+'_jeepay', 'A network leaves this project')
    require(args.action == 'build' or (home/'bootstrap.sql').is_file(), 'First-boot operator password SQL is required')
    if args.action == 'build':
        maven=manifest['mavenImage']
        require(re.fullmatch(r'maven@sha256:[a-f0-9]{64}',maven), 'Maven image must be pinned')
        for index,image in enumerate(dict.fromkeys([maven,*pins.values()])):
            if subprocess.run(['docker','image','inspect',image],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode:
                call(['docker','pull',image],log=home/('pull-base-'+str(index)+'.log'))
        call(['docker','run','--rm','--name',project+'-build','--label','com.xijie.task='+home.name,'--cpus','2','--memory','2g','--mount','type=bind,source='+str(home/'jeepay')+',target=/workspace','--mount','type=volume,source='+manifest['mavenCache']+',target=/root/.m2','-w','/workspace','-e','MAVEN_OPTS=-Xms128m -Xmx1024m',maven,'mvn','-B','-ntp','-T1','-DskipTests','clean','package'],log=home/'build-maven.log')
        if not (home/'bootstrap.sql').exists():
            require(re.fullmatch(r'[a-f0-9]{64}',(home/'bootstrap-password').read_text().strip()), 'Private first-boot password is missing')
            classpath='/root/.m2/repository/org/springframework/security/spring-security-crypto/6.3.6/spring-security-crypto-6.3.6.jar:/root/.m2/repository/org/springframework/spring-jcl/6.1.16/spring-jcl-6.1.16.jar'
            call(['docker','run','--rm','--label','com.xijie.task='+home.name,'--mount','type=bind,source='+str(home)+',target=/private','--mount','type=bind,source='+str(DEPLOY)+',target=/deployment,readonly','--mount','type=volume,source='+manifest['mavenCache']+',target=/root/.m2,readonly',maven,'java','-cp',classpath,'/deployment/BootstrapPassword.java','/private/bootstrap-password','/private/bootstrap.sql'],log=home/'bootstrap-generation.log')
        legacy=dict(env,DOCKER_BUILDKIT='0')
        for part in ('payment','manager','merchant'):
            call(['docker','build','--pull=false','--label','org.opencontainers.image.source='+lock['backend']['repository'],'--label','org.opencontainers.image.revision='+lock['backend']['commit'],'--build-arg','BASE_IMAGE='+pins['JEEPAY_JRE_IMAGE'],'-t',project+'-'+part+':'+lock['backend']['commit'][:12],str(home/'jeepay'/('jeepay-'+part))],env=legacy,log=home/('build-'+part+'-legacy.log'))
        for part in ('cashier','manager','merchant'):
            build_source=home/'ui-build-sources'/(part+'-'+uuid.uuid4().hex[:10])
            shutil.copytree(home/'jeepay-ui'/('jeepay-ui-'+part),build_source,ignore=shutil.ignore_patterns('node_modules','dist','.git'))
            call(['docker','run','--rm','--name',project+'-ui-'+part+'-build','--label','com.xijie.task='+home.name,'--cpus','2','--memory','2g','--mount','type=bind,source='+str(build_source)+',target=/workspace','--mount','type=bind,source='+str(DEPLOY)+',target=/deployment,readonly','--mount','type=volume,source='+project+'-'+part+'-node-modules,target=/workspace/node_modules','--mount','type=volume,source='+project+'-npm,target=/root/.npm','-w','/workspace','-e','NODE_OPTIONS=--max-old-space-size=1536','-e','VITE_BASE_URL=/cashier/','-e','VITE_APP_BASE_URL=/','-e','VITE_API_BASE_URL=',pins['JEEPAY_NODE_IMAGE'],'sh','-c','node /deployment/registry-lock.mjs package-lock.json && npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org && npm run build'],log=home/('build-ui-'+part+'.log'))
            artifact=home/'artifacts'/(part+'-'+uuid.uuid4().hex[:10])
            artifact.mkdir(parents=True)
            shutil.copytree(build_source/'dist',artifact/'public')
            shutil.copy2(DEPLOY/'default.conf.template',artifact/'default.conf.template')
            shutil.copy2(home/'jeepay-ui/LICENSE',artifact/'LICENSE')
            call(['docker','build','--pull=false','-f',str(DEPLOY/'ui-static.Dockerfile'),'--label','org.opencontainers.image.source='+lock['ui']['repository'],'--label','org.opencontainers.image.revision='+lock['ui']['commit'],'--build-arg','NGINX_IMAGE='+pins['JEEPAY_NGINX_IMAGE'],'-t',project+'-ui-'+part+':'+lock['ui']['commit'][:12],str(artifact)],env=legacy,log=home/('build-ui-'+part+'-image.log'))
        proof={'completed':True,'builder':'private Maven and Node containers; local legacy static packaging fallback','backendCommit':lock['backend']['commit'],'uiCommit':lock['ui']['commit'],'baseImages':pins,'images':{}}
        for name,service in config['services'].items():
            value=json.loads(call(['docker','image','inspect',service['image'],'--format','{{json .Id}}'],capture=True))
            proof['images'][name]=value
        (home/'image-build-proof.json').write_text(json.dumps(proof,indent=2),encoding='utf-8')
    elif args.action == 'start':
        subnet=ipaddress.ip_network(network['ipam']['config'][0]['subnet'])
        if os.name == 'nt':
            routes=json.loads(call(['powershell.exe','-NoProfile','-Command','(Get-NetRoute -AddressFamily IPv4).DestinationPrefix | ConvertTo-Json'],capture=True))
            for value in routes if isinstance(routes,list) else [routes]:
                route=ipaddress.ip_network(value)
                require(route.prefixlen == 0 or not subnet.overlaps(route), 'Choose a subnet outside host routes')
        ids=call(['docker','network','ls','-q'],capture=True).split()
        for other in json.loads(call(['docker','network','inspect',*ids],capture=True)):
            if other.get('Labels',{}).get('com.docker.compose.project') == project:
                continue
            for address in other.get('IPAM',{}).get('Config',[]) or []:
                if address.get('Subnet'):
                    require(not subnet.overlaps(ipaddress.ip_network(address['Subnet'])), 'Choose a subnet outside every existing Docker network')
        # No build or credential regeneration is performed on a restart.
        call(compose+['up','-d','--no-build','--wait','--wait-timeout','360'],env=env,log=home/'startup.log')
    elif args.action == 'stop':
        call(compose+['down'],env=env,log=home/'stop.log')  # Deliberately no -v.
    else:
        result=call(compose+['ps','--format','json'],env=env,capture=True).strip()
        entries=json.loads(result) if result.startswith('[') else [json.loads(line) for line in result.splitlines() if line.strip()]
        print(json.dumps([{'service':row['Service'],'state':row['State'],'health':row.get('Health',''),'ports':row.get('Publishers',[])} for row in entries],indent=2))
    print(json.dumps({'completed':True,'action':args.action,'project':project,'secretsPrinted':False}))


if __name__ == '__main__':
    main()

