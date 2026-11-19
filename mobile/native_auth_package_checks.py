"""Read packaged Android manifests and native capability code, without device access."""
from pathlib import Path
import json
import re
import struct
import subprocess
import tempfile
import zipfile

ANDROID = 'http://schemas.android.com/apk/res/android'


def aapt_manifest(text):
    """Keep element/attribute ownership; a string elsewhere cannot satisfy exported/permissions."""
    roots, stack = [], []
    for line in text.splitlines():
        element = re.match(r'^(\s*)E: (\S+)', line)
        if element:
            indent, tag = len(element[1]), element[2]
            while stack and stack[-1][0] >= indent:
                stack.pop()
            node = {'tag': tag, 'attrs': {}, 'children': []}
            (stack[-1][1]['children'] if stack else roots).append(node)
            stack.append((indent, node))
            continue
        attr = re.match(r'^\s*A: ([^\s(=]+)(?:\([^)]*\))?=(.*)$', line)
        if attr and stack:
            key, raw = attr[1].replace(ANDROID + ':', 'android:'), attr[2]
            if raw.startswith('"'):
                value = json.JSONDecoder().raw_decode(raw)[0]
            elif raw in ('true', 'false'):
                value = raw == 'true'
            elif re.fullmatch(r'0x[0-9a-fA-F]+|[0-9]+', raw):
                value = int(raw, 16 if raw.startswith('0x') else 10)
            else:
                value = raw
            assert key not in stack[-1][1]['attrs'], 'Duplicate manifest attribute.'
            stack[-1][1]['attrs'][key] = value
    assert len(roots) == 1 and roots[0]['tag'] == 'manifest', 'Missing actual manifest root.'
    return roots[0]


def _varint(data, offset):
    value = 0
    for shift in range(0, 70, 7):
        assert offset < len(data), 'Truncated protobuf varint.'
        byte = data[offset]; offset += 1; value |= (byte & 127) << shift
        if byte < 128:
            return value, offset
    raise AssertionError('Invalid protobuf varint.')


def _fields(data):
    offset, count = 0, 0
    while offset < len(data):
        tag, offset = _varint(data, offset); number, wire = tag >> 3, tag & 7
        assert number and count < 10000, 'Invalid or excessive protobuf fields.'
        count += 1
        if wire == 0:
            value, offset = _varint(data, offset)
        elif wire == 2:
            size, offset = _varint(data, offset)
            assert size <= len(data) - offset, 'Truncated protobuf field.'
            value = data[offset:offset + size]; offset += size
        elif wire in (1, 5):
            size = 8 if wire == 1 else 4
            assert size <= len(data) - offset, 'Truncated fixed protobuf field.'
            value = data[offset:offset + size]; offset += size
        else:
            raise AssertionError('Unsupported protobuf field type.')
        yield number, wire, value


def protobuf_manifest(data):
    """AAB XmlNode/XmlElement/XmlAttribute fields follow AOSP aapt2/Resources.proto.

    https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/tools/aapt2/Resources.proto
    Only the XML tree and literal/compiled bool/int/string attribute values are needed.
    """
    assert len(data) <= 4 * 1024 * 1024, 'Manifest is unexpectedly large.'

    def attribute(raw):
        values = {n: v for n, _, v in _fields(raw)}
        name = values.get(2, b'').decode('utf-8'); uri = values.get(1, b'').decode('utf-8')
        assert name, 'Unnamed manifest attribute.'
        key = ('android:' if uri == ANDROID else uri + ':' if uri else '') + name
        value = values.get(3, b'').decode('utf-8')
        if 6 in values:
            for number, wire, item in _fields(values[6]):
                if number in (2, 3) and wire == 2:
                    strings = {n: v for n, _, v in _fields(item)}
                    value = strings.get(1, b'').decode('utf-8')
                if number == 7 and wire == 2:
                    for kind, primitive_wire, primitive in _fields(item):
                        if primitive_wire == 0 and kind in (6, 7, 8):
                            value = bool(primitive) if kind == 8 else primitive
        return key, value

    def node(raw, depth=0):
        assert depth < 48, 'Manifest nesting exceeds expected bounds.'
        elements = [v for n, w, v in _fields(raw) if n == 1 and w == 2]
        assert len(elements) <= 1, 'Duplicate XML element.'
        if not elements:
            return None  # Text node.
        result = {'tag': '', 'attrs': {}, 'children': []}
        for number, wire, value in _fields(elements[0]):
            if wire != 2:
                continue
            if number == 3:
                result['tag'] = value.decode('utf-8')
            elif number == 4:
                key, attr = attribute(value)
                assert key not in result['attrs'], 'Duplicate manifest attribute.'
                result['attrs'][key] = attr
            elif number == 5:
                child = node(value, depth + 1)
                if child:
                    result['children'].append(child)
        assert result['tag'], 'Missing XML element name.'
        return result

    result = node(data)
    assert result and result['tag'] == 'manifest', 'Missing actual AAB manifest root.'
    return result


def verify_auth_manifest(manifest, application_id):
    assert manifest['attrs'].get('package') == application_id, 'Wrong actual manifest package.'
    private_permission = application_id + '.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'
    expected = {'android.permission.INTERNET', 'android.permission.RECORD_AUDIO',
                'android.permission.MODIFY_AUDIO_SETTINGS', private_permission}
    permissions = [c for c in manifest['children'] if c['tag'].startswith('uses-permission')]
    names = [c['attrs'].get('android:name') for c in permissions]
    assert len(names) == len(expected) and set(names) == expected, 'Packaged permission set changed: ' + repr(names)
    assert all('android:maxSdkVersion' not in c['attrs'] for c in permissions), 'Required permissions must not expire by SDK.'
    declared = [c for c in manifest['children'] if c['tag'].startswith('permission')]
    assert len(declared) == 1 and declared[0]['attrs'].get('android:name') == private_permission, 'Unexpected custom permission.'
    assert declared[0]['attrs'].get('android:protectionLevel') in (2, 'signature'), 'Receiver permission must remain signature-only.'
    queries = [c for c in manifest['children'] if c['tag'] == 'queries']
    assert len(queries) == 1 and any(c['tag'] == 'package' and c['attrs'].get('android:name') == 'com.tencent.mm' for c in queries[0]['children']), 'Missing scoped WeChat package query.'
    applications = [c for c in manifest['children'] if c['tag'] == 'application']
    assert len(applications) == 1, 'One application is required.'
    callbacks = [c for c in applications[0]['children'] if c['tag'] in ('activity', 'activity-alias') and str(c['attrs'].get('android:name', '')).endswith('.wxapi.WXEntryActivity')]
    expected_callback = application_id + '.wxapi.WXEntryActivity'
    assert len(callbacks) == 1 and callbacks[0]['tag'] == 'activity' and callbacks[0]['attrs'].get('android:name') == expected_callback, 'Only this variant may declare its WeChat callback.'
    callback = callbacks[0]
    assert callback['attrs'].get('android:exported') is True, 'Official WeChat must be able to return to the exact callback.'
    assert not any(c['tag'] == 'intent-filter' for c in callback['children']), 'WeChat callback must not expose a general URI filter.'
    assert 'android:permission' not in callback['attrs'], 'Callback cannot depend on an unrelated caller permission.'
    return {'permissions': sorted(expected), 'wechatCallback': expected_callback,
            'wechatCallbackExported': True, 'otherVariantWechatCallbackDeclared': False}


def verify_auth_dex(package, sdk, prefix='', application_id='app.elysium.figma.dev'):
    names = sorted(n for n in package.namelist() if n.startswith(prefix) and re.fullmatch(r'classes(?:(?:[2-9]|[1-9][0-9]+))?\.dex', n[len(prefix):]))
    assert names, 'Missing packaged DEX.'
    descriptors = [b'Lcom/tencent/mm/opensdk/openapi/WXAPIFactory;', b'Lcom/tencent/mm/opensdk/modelmsg/SendAuth$Req;',
                   b'Lcom/tencent/mm/opensdk/modelmsg/SendAuth$Resp;', b'Lapp/elysium/figma/dev/NativeAuthState;',
                   b'Lapp/elysium/figma/dev/WechatAuthActivity;', ('L' + application_id.replace('.', '/') + '/wxapi/WXEntryActivity;').encode()]
    defined = set()
    for name in names:
        data = package.read(name)
        assert len(data) >= 112 and data[:4] == b'dex\n', 'Invalid packaged DEX header.'
        strings, strings_offset = struct.unpack_from('<II', data, 0x38)
        types, types_offset = struct.unpack_from('<II', data, 0x40)
        classes, classes_offset = struct.unpack_from('<II', data, 0x60)
        assert strings_offset + 4 * strings <= len(data) and types_offset + 4 * types <= len(data) and classes_offset + 32 * classes <= len(data), 'Truncated DEX class tables.'
        for index in range(classes):
            type_index = struct.unpack_from('<I', data, classes_offset + 32 * index)[0]
            assert type_index < types, 'Invalid DEX class index.'
            string_index = struct.unpack_from('<I', data, types_offset + 4 * type_index)[0]
            assert string_index < strings, 'Invalid DEX type index.'
            offset = struct.unpack_from('<I', data, strings_offset + 4 * string_index)[0]
            _, start = _varint(data, offset)
            end = data.find(b'\0', start)
            assert end >= start, 'Truncated DEX descriptor.'
            defined.add(data[start:end])
    assert all(value in defined for value in descriptors), 'Official SDK/native private callback classes are not defined in DEX.'
    analyzer = Path(sdk) / 'cmdline-tools/latest/bin/apkanalyzer.bat'
    assert analyzer.is_file(), 'The installed Android SDK apkanalyzer is required for native capability verification.'
    with tempfile.TemporaryDirectory(prefix='xijie-native-dex-') as temp:
        # AAB DEX has a base/dex prefix; the official tool accepts a DEX-only APK container.
        target = Path(temp) / 'native-dex.apk'
        with zipfile.ZipFile(target, 'w') as archive:
            for name in names:
                archive.writestr(name[len(prefix):], package.read(name))
        result = subprocess.run([str(analyzer), 'dex', 'code', '--class', 'app.elysium.figma.dev.NativeAuthPlugin', str(target)], capture_output=True)
        assert result.returncode == 0, 'Official apkanalyzer could not read NativeAuthPlugin code.'
        code = result.stdout.decode('utf-8', errors='strict')
    assert re.search(r'^\.method public getCapabilities\(Lcom/getcapacitor/PluginCall;\)V$', code, re.M), 'Native capability method is missing.'
    methods = re.findall(r'^\.method[^\n]*getCapabilities[^\n]*\n.*?^\.end method', code, re.M | re.S)
    assert any(all(re.search(r'const-string(?:/jumbo)?\s+[^\n]*"' + value + '"', method) for value in ('apple', 'google', 'wechat', 'browserProviders', 'wechatNative')) for method in methods), 'Actual native capability implementation must contain all three browser providers.'
    for method in ('prepare', 'launch', 'getPending', 'resume', 'clear'):
        assert re.search(r'^\.method public ' + method + r'\(Lcom/getcapacitor/PluginCall;\)V$', code, re.M), 'Native auth method missing: ' + method
    return {'nativeAuthBridgeCompiled': True, 'officialWechatSdkClassesCompiled': True,
            'nativeGoogleCapabilityCodeVerified': True, 'nativeWechatPrivateRecoveryCompiled': True,
            'realProviderAuthorization': 'NOT_RUN'}
