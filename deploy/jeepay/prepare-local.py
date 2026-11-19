"""Prepare one private local deployment, optionally fetching exact public source commits."""
import argparse, ipaddress, json, os, re, secrets, socket, subprocess, urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
DEPLOY=Path(__file__).resolve().parent
def require(ok,message):
    if not ok:raise RuntimeError(message)
def output(args):return subprocess.check_output(args,text=True,encoding='utf-8',cwd=ROOT)
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--deployment',type=Path,required=True)
    parser.add_argument('--subnet',required=True)
    parser.add_argument('--fetch',action='store_true',help='Fetch the two exact public commits into new checkout directories')
    parser.add_argument('--ports',nargs=4,type=int,default=[29116,29226,29227,29228])
    args=parser.parse_args();home=args.deployment.resolve()
    require(home.parent==(ROOT/'.tmp').resolve() and re.fullmatch(r'jeepay-local-[a-f0-9]{10}',home.name),'Choose a fresh private .tmp/jeepay-local-<10hex> directory')
    require(home.is_dir() and not any((home/p).exists() for p in ('checkout.env','deployment.json','bootstrap-password','bootstrap.sql')),'Do not overwrite an existing deployment')
    if os.name=='nt':
        subprocess.run(['icacls',str(home),'/inheritance:r','/grant:r',os.environ['USERNAME']+':(OI)(CI)F','SYSTEM:(OI)(CI)F'],check=True,capture_output=True)
    lock=json.loads((DEPLOY/'source-lock.json').read_text(encoding='utf-8-sig'))
    if args.fetch:
        child_env=dict(os.environ)
        for scheme,value in urllib.request.getproxies().items():
            if scheme in ('http','https'):child_env[scheme.upper()+'_PROXY']=value
        hooks=home/'empty-hooks';hooks.mkdir(exist_ok=True)
        with (home/'source-fetch.log').open('w',encoding='utf-8') as log:
            for name,key in (('jeepay','backend'),('jeepay-ui','ui')):
                target=home/name;require(not target.exists(),'Source checkout already exists; do not overwrite it')
                for command in (['git','init',str(target)],['git','-C',str(target),'config','core.hooksPath',str(hooks)],['git','-C',str(target),'fetch','--depth=1',lock[key]['repository'],lock[key]['commit']],['git','-C',str(target),'checkout','--detach','FETCH_HEAD']):
                    subprocess.run(command,check=True,env=child_env,stdout=log,stderr=subprocess.STDOUT)
    for name,key in (('jeepay','backend'),('jeepay-ui','ui')):
        require(output(['git','-C',str(home/name),'rev-parse','HEAD']).strip()==lock[key]['commit'],'Pinned source commit mismatch')
        subprocess.run(['git','-C',str(home/name),'-c','core.autocrlf=false','diff','--quiet','HEAD'],check=True)
    net=ipaddress.ip_network(args.subnet)
    require(net.version==4 and net.is_private and net.prefixlen==24,'Select an unused private IPv4 /24')
    ids=output(['docker','network','ls','-q']).split()
    for network in json.loads(output(['docker','network','inspect',*ids])):
        for row in network.get('IPAM',{}).get('Config',[]) or []:
            require(not row.get('Subnet') or not net.overlaps(ipaddress.ip_network(row['Subnet'])),'Subnet overlaps an existing Docker network')
    if os.name=='nt':
        routes=json.loads(output(['powershell.exe','-NoProfile','-Command','(Get-NetRoute -AddressFamily IPv4).DestinationPrefix | ConvertTo-Json']))
        for value in routes if isinstance(routes,list) else [routes]:
            route=ipaddress.ip_network(value)
            require(route.prefixlen==0 or not net.overlaps(route),'Subnet overlaps a host route')
    require(len(set(args.ports))==4 and all(1024<=p<=65535 for p in args.ports),'Use four different high ports')
    for port in args.ports:
        with socket.socket() as probe:probe.bind(('127.0.0.1',port))
    project='xijie-'+home.name.replace('jeepay-local-','jeepay-')
    values={k:secrets.token_hex(32) for k in ('JEEPAY_DB_ROOT_PASSWORD','JEEPAY_DB_PASSWORD','JEEPAY_REDIS_PASSWORD','JEEPAY_MANAGER_JWT_SECRET','JEEPAY_MERCHANT_JWT_SECRET')}
    values.update({k:v for k,v in lock['images'].items() if k!='MAVEN_IMAGE'})
    values.update(UI_BASE_DIR='..',JEEPAY_IMAGE_PREFIX=project,JEEPAY_DEPLOY_DIR=DEPLOY.as_posix(),JEEPAY_UI_DOCKERFILE=(DEPLOY/'ui.Dockerfile').as_posix(),JEEPAY_BOOTSTRAP_SQL=(home/'bootstrap.sql').as_posix())
    for key,port in zip(('JEEPAY_API_PORT','JEEPAY_CASHIER_PORT','JEEPAY_MANAGER_UI_PORT','JEEPAY_MERCHANT_UI_PORT'),args.ports):values[key]=str(port)
    (home/'checkout.env').write_text('\n'.join(k+'='+v for k,v in values.items())+'\n',encoding='utf-8')
    (home/'bootstrap-password').write_text(secrets.token_hex(32),encoding='utf-8')
    (home/'local.override.yml').write_text('networks:\n  jeepay:\n    ipam:\n      config:\n        - subnet: '+str(net)+'\n',encoding='utf-8')
    manifest={'format':1,'project':project,'home':str(home),'ports':args.ports,'backendCommit':lock['backend']['commit'],'uiCommit':lock['ui']['commit'],'mavenImage':lock['images']['MAVEN_IMAGE'],'mavenCache':project+'-maven','credentials':'checkout.env; bootstrap-password'}
    (home/'deployment.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print(json.dumps({'completed':True,'project':project,'path':str(home),'secretsPrinted':False}))
if __name__=='__main__':main()

