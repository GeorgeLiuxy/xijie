"""Verify the generated package without connecting to an Android device."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import zipfile
from native_auth_package_checks import aapt_manifest, verify_auth_manifest, verify_auth_dex

sys.stdout.reconfigure(encoding='utf-8')

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--origin', default='http://127.0.0.1:5174',
                    help='Expected debug HTTP 127.0.0.1 origin; defaults to port 5174.')
parser.add_argument('--apk', type=Path, help='Package to inspect; defaults to the current debug artifact.')
args = parser.parse_args()
origin = re.fullmatch(r'http://127\.0\.0\.1:([1-9][0-9]{0,4})/?', args.origin)
if not origin or int(origin.group(1)) > 65535:
    parser.error('--origin must be an HTTP 127.0.0.1 origin with an explicit port (1-65535).')
expected_origin = args.origin.rstrip('/')

root = Path(__file__).resolve().parent
artifact = args.apk.resolve() if args.apk else root / 'artifacts/xijie-figma-usb-debug.apk'
sdk = Path(os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT')
           or Path(os.environ['LOCALAPPDATA']) / 'Android' / 'Sdk')
aapt = sdk / 'build-tools/36.0.0/aapt2.exe'

def run(*args):
    result = subprocess.run([str(x) for x in args], capture_output=True)
    output = result.stdout.decode('utf-8', errors='replace')
    error = result.stderr.decode('utf-8', errors='replace')
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed ({result.returncode}): {error or output}')
    return output + error

def camera_query_declared(xmltree):
    elements = []
    for line in xmltree.splitlines():
        element = re.match(r'^(\s*)E: (\S+)', line)
        if element:
            indent, name = len(element.group(1)), element.group(2)
            while elements and elements[-1][0] >= indent:
                elements.pop()
            elements.append((indent, name))
        elif 'android.media.action.IMAGE_CAPTURE' in line:
            if [name for _, name in elements][-3:] == ['queries', 'intent', 'action']:
                return True
    return False

badging = run(aapt, 'dump', 'badging', artifact)
assert "package: name='app.elysium.figma.dev'" in badging
assert 'application-debuggable' in badging
assert "launchable-activity: name='app.elysium.figma.dev.MainActivity'" in badging
assert "application-label:'西界·Figma调试'" in badging
assert "minSdkVersion:'24'" in badging and "targetSdkVersion:'36'" in badging
manifest = run(aapt, 'dump', 'xmltree', artifact, '--file', 'AndroidManifest.xml')
auth_manifest = verify_auth_manifest(aapt_manifest(manifest), 'app.elysium.figma.dev')
assert 'windowSoftInputMode' in manifest and '0x00000010' in manifest
assert 'android.permission.RECORD_AUDIO' in manifest, 'Microphone capture requires RECORD_AUDIO.'
assert 'android.permission.MODIFY_AUDIO_SETTINGS' in manifest, 'Capacitor audio capture also requires MODIFY_AUDIO_SETTINGS.'
assert camera_query_declared(manifest), 'The external camera intent must be visible inside manifest queries.'
assert 'android.permission.CAMERA' not in manifest, 'External camera capture does not request direct camera permission.'
assert 'android.permission.QUERY_ALL_PACKAGES' not in manifest, 'Camera discovery must use a scoped intent query.'
network = run(aapt, 'dump', 'xmltree', artifact, '--file', 'res/xml/network_security_config.xml')
assert '127.0.0.1' in network and 'includeSubdomains' in network

with zipfile.ZipFile(artifact) as package:
    config = json.loads(package.read('assets/capacitor.config.json'))
    assert config['appId'] == 'app.elysium.figma.dev'
    assert config['server']['url'] == expected_origin
    assert config['server']['errorPath'] == 'usb-offline.html'
    assert config['android']['webContentsDebuggingEnabled'] is True
    assert config['android']['allowMixedContent'] is False
    assert config.get('includePlugins') == []
    assert json.loads(package.read('assets/capacitor.plugins.json')) == []
    assert 'assets/public/usb-offline.html' in package.namelist()
    dex = b''.join(package.read(name) for name in package.namelist() if name.endswith('.dex'))
    assert b'Lapp/elysium/figma/dev/ChatCapturePlugin;' in dex, 'Native camera recovery plugin is missing.'
    assert all(value in dex for value in [b'reconcileOwner', b'CAPTURE_VERSION_CONFLICT', b'xijie-chat-capture']), 'Native camera recovery protocol is incomplete.'
    auth_dex = verify_auth_dex(package, sdk, application_id='app.elysium.figma.dev')

main = json.loads((root / 'android/app/src/main/assets/capacitor.config.json').read_text(encoding='utf-8'))
assert 'server' not in main and not main['android']['webContentsDebuggingEnabled']
main_xml = (root / 'android/app/src/main/res/xml/network_security_config.xml').read_text()
assert 'cleartextTrafficPermitted="false"' in main_xml
debug_xml = (root / 'android/app/src/debug/res/xml/network_security_config.xml').read_text()
assert debug_xml.count('<domain ') == 1 and 'includeSubdomains="false">127.0.0.1' in debug_xml
assert 'base-config cleartextTrafficPermitted="false"' in debug_xml
gradle = (root / 'android/app/build.gradle').read_text()
assert "withBuildType('release')" in gradle and 'variant.enable = releaseRequested' in gradle
assert "implementation 'com.tencent.mm.opensdk:wechat-sdk-android:6.8.40'" in gradle, 'The official SDK dependency must remain pinned.'
signature = run(sdk / 'build-tools/36.0.0/apksigner.bat', 'verify', '--verbose', artifact)
assert 'Verifies' in signature

for name, text in [('apk-badging.txt', badging), ('apk-manifest.txt', manifest), ('apk-network-config.txt', network), ('apk-signature.txt', signature)]:
    (root / 'artifacts' / name).write_text(text, encoding='utf-8')
report = {
    'result': 'PASS', 'apk': str(artifact), 'bytes': artifact.stat().st_size,
    'sha256': hashlib.sha256(artifact.read_bytes()).hexdigest(),
    'package': 'app.elysium.figma.dev', 'label': '西界·Figma调试',
    'debuggable': True, 'launcher': 'app.elysium.figma.dev.MainActivity',
    'minSdk': 24, 'targetSdk': 36, 'adjustResize': True,
    'developmentUrl': config['server']['url'],
    'cleartextScope': 'debug only, 127.0.0.1 without subdomains',
    'webViewDebugging': True, 'additionalPlugins': [],
    'microphonePermissionDeclared': True, 'audioSettingsPermissionDeclared': True,
    'cameraCaptureQueryDeclared': True, 'directCameraPermissionDeclared': False,
    'nativeChatCaptureBridgeCompiled': True,
    'releaseVariant': 'disabled; main configuration contains no development URL',
    'deviceInstallation': 'NOT_RUN', 'deviceUserPaths': 'NOT_RUN'
}
report.update(auth_manifest)
report.update(auth_dex)
report['wechatSdkDeclaredVersion'] = '6.8.40'
report['permissionSetUnchanged'] = True
(root / 'artifacts/verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
