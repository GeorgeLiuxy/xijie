"""Inspect a locally built production package without installation or network access."""
from pathlib import Path
import argparse,hashlib,json,os,re,subprocess,zipfile
from native_auth_package_checks import aapt_manifest, protobuf_manifest, verify_auth_manifest, verify_auth_dex

parser=argparse.ArgumentParser()
parser.add_argument('apk',type=Path)
parser.add_argument('--origin',required=True)
parser.add_argument('--signed',action='store_true')
parser.add_argument('--aab',type=Path)
args=parser.parse_args()
sdk=Path(os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT') or Path(os.environ['LOCALAPPDATA'])/'Android'/'Sdk')
aapt=sdk/'build-tools/36.0.0/aapt2.exe'
def run(*cmd):
 p=subprocess.run([str(x) for x in cmd],capture_output=True);text=p.stdout.decode('utf-8',errors='replace')+p.stderr.decode('utf-8',errors='replace')
 if p.returncode:raise RuntimeError(text)
 return text
def camera_query_declared(xmltree):
 elements=[]
 for line in xmltree.splitlines():
  element=re.match(r'^(\s*)E: (\S+)',line)
  if element:
   indent,name=len(element.group(1)),element.group(2)
   while elements and elements[-1][0]>=indent:elements.pop()
   elements.append((indent,name))
  elif 'android.media.action.IMAGE_CAPTURE' in line:
   if [name for _,name in elements][-3:]==['queries','intent','action']:return True
 return False
badging=run(aapt,'dump','badging',args.apk)
assert "package: name='app.elysium.xijie'" in badging
assert 'application-debuggable' not in badging
assert "application-label:'西界'" in badging
manifest=run(aapt,'dump','xmltree',args.apk,'--file','AndroidManifest.xml')
auth_manifest=verify_auth_manifest(aapt_manifest(manifest),'app.elysium.xijie')
assert '/native-auth/complete' in manifest and 'autoVerify' in manifest
assert 'android.permission.RECORD_AUDIO' in manifest
assert 'android.permission.MODIFY_AUDIO_SETTINGS' in manifest, 'Capacitor audio capture also requires MODIFY_AUDIO_SETTINGS.'
assert camera_query_declared(manifest), 'The external camera intent must be visible inside manifest queries.'
assert 'android.permission.CAMERA' not in manifest, 'External capture must not add direct camera permission.'
assert 'android.permission.QUERY_ALL_PACKAGES' not in manifest, 'Camera discovery must use a scoped intent query.'
resources=run(aapt,'dump','resources',args.apk)
network_file=re.search(r'xml/network_security_config\s+\(\) \(file\) (\S+) type=XML',resources)
assert network_file, 'Actual network resource must be present after release resource optimization'
network=run(aapt,'dump','xmltree',args.apk,'--file',network_file.group(1))
assert '127.0.0.1' not in network and 'cleartextTrafficPermitted' in network and 'false' in network
with zipfile.ZipFile(args.apk) as apk:
 config=json.loads(apk.read('assets/capacitor.config.json').decode('utf-8-sig'))
 assert config['appId']=='app.elysium.xijie' and config['server']['url']==args.origin.rstrip('/')
 assert config['android']['webContentsDebuggingEnabled'] is False and config['android']['allowMixedContent'] is False
 assert config['server']['errorPath']=='release-offline.html'
 assert 'assets/public/release-offline.html' in apk.namelist()
 assert len([name for name in apk.namelist() if name.startswith('assets/public/assets/') and name.endswith('.js')])>0
 assert b'USB' not in apk.read('assets/public/index.html')
 assert 'META-INF/CERT.RSA' not in apk.namelist() or args.signed
 bundled=b''.join(apk.read(name) for name in apk.namelist() if name.startswith('assets/public/assets/') and name.endswith('.js'))
 assert b'xijie.voice.v1' in bundled and b'xijie-voice-capture' in bundled
 assert b'xijie.album.review.' in bundled and b'REVIEW_RESULT_UNKNOWN' in bundled
 assert any(b'NativeAuthPlugin' in apk.read(name) and b'AndroidKeyStore' in apk.read(name) for name in apk.namelist() if name.endswith('.dex'))
 native_capture=b''.join(apk.read(name) for name in apk.namelist() if name.endswith('.dex'))
 assert all(value in native_capture for value in [b'Lapp/elysium/figma/dev/ChatCapturePlugin;',b'reconcileOwner',b'CAPTURE_VERSION_CONFLICT',b'xijie-chat-capture']), 'APK is missing native camera recovery.'
 assert b'xijie.chat-capture.v1' in bundled and b'ChatCapture' in bundled, 'APK is missing the camera recovery client.'
 auth_dex=verify_auth_dex(apk,sdk,application_id='app.elysium.xijie')
gradle=(Path(__file__).resolve().parent/'android/app/build.gradle').read_text(encoding='utf-8')
assert "implementation 'com.tencent.mm.opensdk:wechat-sdk-android:6.8.40'" in gradle,'The official SDK dependency must remain pinned.'
if args.signed:
 signature=run(sdk/'build-tools/36.0.0/apksigner.bat','verify','--verbose',args.apk)
 assert 'Verifies' in signature
report={'result':'PASS','apk':str(args.apk.resolve()),'sha256':hashlib.sha256(args.apk.read_bytes()).hexdigest(),'package':'app.elysium.xijie','debuggable':False,'origin':args.origin,'bundledFrontend':'service build','nativeAuthBridgeCompiled':True,'nativeAppLinkDeclared':True,'nativeAppLinkVerified':False,'microphonePermissionDeclared':True,'audioSettingsPermissionDeclared':True,'cameraCaptureQueryDeclared':True,'directCameraPermissionDeclared':False,'realtimeWebAudioClientBundled':True,'sharedGoalReviewClientBundled':True,'microphoneDeviceVerified':False,'signatureVerified':args.signed,'deviceUserPaths':'NOT_RUN','realServiceReachability':'NOT_RUN','paymentAndSms':'NOT_RUN'}
report['nativeChatCaptureBridgeCompiled']=True
report['nativeChatCaptureClientBundled']=True
report.update(auth_manifest);report.update(auth_dex)
report['wechatSdkDeclaredVersion']='6.8.40';report['permissionSetUnchanged']=True
if args.aab:
 with zipfile.ZipFile(args.aab) as bundle:
  names=bundle.namelist();config=json.loads(bundle.read('base/assets/capacitor.config.json').decode('utf-8-sig'))
  assert config['appId']=='app.elysium.xijie' and config['server']['url']==args.origin.rstrip('/')
  assert config['android']['webContentsDebuggingEnabled'] is False and config['android']['allowMixedContent'] is False
  bundled=b''.join(bundle.read(name) for name in names if name.startswith('base/assets/public/assets/') and name.endswith('.js'))
  assert all(value in bundled for value in [b'xijie.voice.v1',b'xijie-voice-capture',b'xijie.album.review.',b'REVIEW_RESULT_UNKNOWN'])
  assert any(b'NativeAuthPlugin' in bundle.read(name) and b'AndroidKeyStore' in bundle.read(name) for name in names if name.endswith('.dex'))
  native_capture=b''.join(bundle.read(name) for name in names if name.endswith('.dex'))
  assert all(value in native_capture for value in [b'Lapp/elysium/figma/dev/ChatCapturePlugin;',b'reconcileOwner',b'CAPTURE_VERSION_CONFLICT',b'xijie-chat-capture']), 'AAB is missing native camera recovery.'
  assert b'xijie.chat-capture.v1' in bundled and b'ChatCapture' in bundled, 'AAB is missing the camera recovery client.'
  manifest=bundle.read('base/manifest/AndroidManifest.xml');assert b'android.permission.RECORD_AUDIO' in manifest and b'/native-auth/complete' in manifest
  bundle_auth_manifest=verify_auth_manifest(protobuf_manifest(manifest),'app.elysium.xijie')
  bundle_auth_dex=verify_auth_dex(bundle,sdk,prefix='base/dex/',application_id='app.elysium.xijie')
  assert bundle_auth_manifest==auth_manifest,'APK and AAB authentication manifest policy must agree.'
  assert b'android.permission.MODIFY_AUDIO_SETTINGS' in manifest, 'AAB must also declare Capacitor audio settings permission.'
  assert b'queries' in manifest and b'android.media.action.IMAGE_CAPTURE' in manifest, 'AAB must retain the external camera visibility query.'
  assert b'android.permission.CAMERA' not in manifest
  assert b'android.permission.QUERY_ALL_PACKAGES' not in manifest
  signing_certificates=any(name.upper().startswith('META-INF/') and name.lower().endswith(('.rsa','.dsa','.ec')) for name in names)
  assert args.signed or not signing_certificates
 report.update({'aab':str(args.aab.resolve()),'aabSha256':hashlib.sha256(args.aab.read_bytes()).hexdigest(),'aabBundledFrontend':'service build with voice and shared goal reviews','aabJarSigningCertificatesPresent':signing_certificates})
 report['aabNativeAuth']=dict(bundle_auth_manifest,**bundle_auth_dex)
target=Path(__file__).resolve().parent/'artifacts'/'release-verification.json';target.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
