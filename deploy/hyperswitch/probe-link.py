"""One private synthetic merchant, no connectors, one UNCONFIRMED intent. Never calls confirm."""
import argparse
import json
import pathlib
import re
import urllib.error
import urllib.request
import urllib.parse
import uuid

parser=argparse.ArgumentParser()
parser.add_argument('--home',required=True,type=pathlib.Path)
args=parser.parse_args()
home=args.home.resolve()
descriptor=json.loads((home/'deployment.json').read_text(encoding='utf-8'))
token=re.fullmatch(r'hyperswitch-local-([a-f0-9]{10})',home.name)
if not token or descriptor['project']!='xijie-hs-'+token.group(1) or descriptor['home']!=str(home) or home.parent!=(pathlib.Path(__file__).resolve().parents[2]/'.tmp').resolve():raise ValueError('Unowned local gateway')
origin=descriptor['apiOrigin']
parsed=urllib.parse.urlsplit(origin)
if parsed.scheme!='http' or parsed.hostname!='127.0.0.1' or parsed.username or parsed.password or not parsed.port or parsed.path or parsed.query or parsed.fragment:raise ValueError('Only the exact private loopback origin may be probed')
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
secrets=json.loads((home/'secrets.json').read_text(encoding='utf-8'))
state_file=home/'unconfirmed-link-private.json'
state=json.loads(state_file.read_text(encoding='utf-8')) if state_file.exists() else {'merchantId':'xijie_local_'+descriptor['project'].split('-')[-1],'paymentId':'pay_local_'+uuid.uuid4().hex[:18]}
def save():state_file.write_text(json.dumps(state,indent=2),encoding='utf-8')
def request(path,body=None,key=None,admin=False):
    headers={'Content-Type':'application/json'}
    if admin:headers['Authorization']='admin-api-key='+secrets['admin']
    if key:headers['api-key']=key
    req=urllib.request.Request(origin+path,headers=headers,data=None if body is None else json.dumps(body).encode(),method='GET' if body is None else 'POST')
    try:
        with opener.open(req,timeout=20) as response:return response.status,json.load(response)
    except urllib.error.HTTPError as error:
        raw=error.read()
        try:value=json.loads(raw)
        except json.JSONDecodeError:value={'nonJsonError':True,'byteSize':len(raw)}
        (home/'last-probe-error-private.json').write_text(json.dumps({'path':path,'status':error.code,'response':value},indent=2),encoding='utf-8')
        return error.code,value
save()
status,merchant=request('/accounts/'+state['merchantId'],admin=True)
if status==404 or status==401 and not state.get('merchantCreated'):
    status,merchant=request('/accounts',{'merchant_id':state['merchantId'],'merchant_name':'Local verification only - no connectors'},admin=True)
if status!=200 or merchant.get('merchant_id')!=state['merchantId']:raise RuntimeError('Synthetic merchant setup failed; see private response metadata')
state['merchantCreated']=True;save()
if 'apiKey' not in state:
    status,value=request('/api_keys/'+state['merchantId'],{'name':'Local unconfirmed-link verification','expiration':'never'},admin=True)
    if status!=200 or not value.get('api_key'):raise RuntimeError('Synthetic API key setup failed; see private response metadata')
    state['apiKey']=value['api_key'];save()
status,profiles=request('/account/'+state['merchantId']+'/business_profile',key=state['apiKey'])
if status!=200 or not isinstance(profiles,list):raise RuntimeError('Synthetic profile query failed')
if not profiles:
    status,profile=request('/account/'+state['merchantId']+'/business_profile',{'profile_name':'Local static verification','return_url':origin+'/health'},key=state['apiKey'])
    if status!=200:raise RuntimeError('Synthetic profile setup failed')
else:profile=profiles[0]
state['profileId']=profile['profile_id'];save()
status,connectors=request('/account/'+state['merchantId']+'/connectors',key=state['apiKey'])
if status!=200 or not isinstance(connectors,list) or connectors:raise RuntimeError('Synthetic merchant must have no configured connector')
status,payment=request('/payments/'+state['paymentId'],key=state['apiKey'])
if status==404:
    status,payment=request('/payments',{'payment_id':state['paymentId'],'amount':1000,'currency':'USD','profile_id':state['profileId'],'payment_link':True,'confirm':False,'capture_method':'automatic','return_url':origin+'/health'},key=state['apiKey'])
if status!=200 or payment.get('status') not in ['requires_payment_method','requires_confirmation'] or payment.get('amount_received') not in [None,0]:raise RuntimeError('Synthetic intent is not a safe unconfirmed payment')
url=(payment.get('payment_link') or {}).get('link')
if not isinstance(url,str) or not url.startswith(origin+'/'):raise RuntimeError('Gateway did not produce its own local Payment Link')
state['url']=url;state['paymentStatus']=payment['status'];save()
print(json.dumps({'unconfirmedLinkCreated':True,'status':payment['status'],'amountReceived':payment.get('amount_received'),'connectorsConfigured':False,'paymentExecuted':False}))
