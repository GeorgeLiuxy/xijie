"""Verify the generated package without connecting to an Android device."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import sys
import zipfile

sys.stdout.reconfigure(encoding='utf-8')

root = Path(__file__).resolve().parent
artifact = root / 'artifacts/xijie-figma-usb-debug.apk'
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

badging = run(aapt, 'dump', 'badging', artifact)
assert "package: name='app.elysium.figma.dev'" in badging
assert 'application-debuggable' in badging
assert "launchable-activity: name='app.elysium.figma.dev.MainActivity'" in badging
assert "application-label:'西界·Figma调试'" in badging
assert "minSdkVersion:'24'" in badging and "targetSdkVersion:'36'" in badging
manifest = run(aapt, 'dump', 'xmltree', artifact, '--file', 'AndroidManifest.xml')
assert 'windowSoftInputMode' in manifest and '0x00000010' in manifest
network = run(aapt, 'dump', 'xmltree', artifact, '--file', 'res/xml/network_security_config.xml')
assert '127.0.0.1' in network and 'includeSubdomains' in network

with zipfile.ZipFile(artifact) as package:
    config = json.loads(package.read('assets/capacitor.config.json'))
    assert config['appId'] == 'app.elysium.figma.dev'
    assert config['server']['url'] == 'http://127.0.0.1:5174'
    assert config['server']['errorPath'] == 'usb-offline.html'
    assert config['android']['webContentsDebuggingEnabled'] is True
    assert config['android']['allowMixedContent'] is False
    assert config.get('includePlugins') == []
    assert json.loads(package.read('assets/capacitor.plugins.json')) == []
    assert 'assets/public/usb-offline.html' in package.namelist()

main = json.loads((root / 'android/app/src/main/assets/capacitor.config.json').read_text(encoding='utf-8'))
assert 'server' not in main and not main['android']['webContentsDebuggingEnabled']
main_xml = (root / 'android/app/src/main/res/xml/network_security_config.xml').read_text()
assert 'cleartextTrafficPermitted="false"' in main_xml
debug_xml = (root / 'android/app/src/debug/res/xml/network_security_config.xml').read_text()
assert debug_xml.count('<domain ') == 1 and 'includeSubdomains="false">127.0.0.1' in debug_xml
assert 'base-config cleartextTrafficPermitted="false"' in debug_xml
gradle = (root / 'android/app/build.gradle').read_text()
assert "withBuildType('release')" in gradle and 'variant.enable = false' in gradle
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
    'releaseVariant': 'disabled; main configuration contains no development URL',
    'deviceInstallation': 'NOT_RUN', 'deviceUserPaths': 'NOT_RUN'
}
(root / 'artifacts/verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
