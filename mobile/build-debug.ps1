param(
    [string]$Jdk = $env:JAVA_HOME,
    [string]$Sdk = $env:ANDROID_HOME,
    [string]$Origin = 'http://127.0.0.1:5174',
    [string]$WechatAppId = $env:XIJIE_WECHAT_ANDROID_APP_ID,
    [switch]$Offline
)
$ErrorActionPreference = 'Stop'
$mobileRoot = $PSScriptRoot
if ($WechatAppId -and $WechatAppId -cnotmatch '^wx[0-9a-fA-F]{16}$') { throw 'WechatAppId must be the approved public WeChat mobile AppID or empty.' }
if ($Origin -cnotmatch '^http://127\.0\.0\.1:([1-9][0-9]{0,4})/?$' -or [int]$Matches[1] -gt 65535) {
    throw 'Debug Origin must be an HTTP 127.0.0.1 origin with an explicit port (1-65535), without credentials, a path, query or fragment.'
}
$Origin = $Origin.TrimEnd('/')
if (-not $Jdk) { throw 'Set JAVA_HOME or pass -Jdk with the JDK 21 installation path.' }
if (-not $Sdk) { $Sdk = $env:ANDROID_SDK_ROOT }
if (-not $Sdk) { $Sdk = Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
foreach ($required in @("$Jdk/bin/java.exe", "$Sdk/platforms/android-36/android.jar")) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Required local build input missing: $required" }
}
foreach ($folder in @('.android-user-home', '.tmp', 'artifacts')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $mobileRoot $folder) | Out-Null
}
# Stage only the debug overlay; keep the checked-in default and release assets intact.
$debugAssets = Join-Path $mobileRoot ('.tmp/debug-assets-' + [guid]::NewGuid().ToString('N'))
Copy-Item -LiteralPath (Join-Path $mobileRoot 'android/app/src/debug/assets') -Destination $debugAssets -Recurse
$debugConfigPath = Join-Path $debugAssets 'capacitor.config.json'
$debugConfig = Get-Content -LiteralPath $debugConfigPath -Raw | ConvertFrom-Json
$debugConfig.server.url = $Origin
[IO.File]::WriteAllText($debugConfigPath, ($debugConfig | ConvertTo-Json -Depth 10) + "`n", [Text.UTF8Encoding]::new($false))
$vars = @('JAVA_HOME', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'ANDROID_USER_HOME', 'CAP_PUBLISH', 'TEMP', 'TMP')
$before = @{}
foreach ($name in $vars) { $before[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$log = Join-Path $mobileRoot 'artifacts/build-debug.log'
try {
    $env:JAVA_HOME = $Jdk
    $env:ANDROID_HOME = $Sdk
    $env:ANDROID_SDK_ROOT = $Sdk
    $env:ANDROID_USER_HOME = Join-Path $mobileRoot '.android-user-home'
    $env:CAP_PUBLISH = 'false'
    $env:TEMP = Join-Path $mobileRoot '.tmp'
    $env:TMP = $env:TEMP
    ('sdk.dir=' + $Sdk.Replace('\', '/')) | Set-Content -LiteralPath (Join-Path $mobileRoot 'android/local.properties') -Encoding utf8
    Push-Location (Join-Path $mobileRoot 'android')
    try {
        $buildArgs = @('--no-daemon', '--console=plain', '--stacktrace', '--max-workers=2', "-PxijieDebugAssetsDir=$debugAssets", ':app:assembleDebug')
        if ($WechatAppId) { $buildArgs = @("-PxijieWechatAppId=$WechatAppId") + $buildArgs }
        if ($Offline) { $buildArgs = @('--offline') + $buildArgs }
        & ./gradlew.bat @buildArgs 2>&1 | Tee-Object -FilePath $log
        $buildExit = $LASTEXITCODE
    } finally { Pop-Location }
    if ($buildExit -ne 0) { throw "Debug build failed ($buildExit). See $log" }
    $built = Join-Path $mobileRoot 'android/app/build/outputs/apk/debug/app-debug.apk'
    $artifact = Join-Path $mobileRoot 'artifacts/xijie-figma-usb-debug.apk'
    Copy-Item -LiteralPath $built -Destination $artifact -Force
    Write-Output "APK: $artifact"
    Get-FileHash -LiteralPath $artifact -Algorithm SHA256
} finally {
    foreach ($name in $vars) { [Environment]::SetEnvironmentVariable($name, $before[$name], 'Process') }
}
