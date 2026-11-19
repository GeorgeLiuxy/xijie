param(
    [Parameter(Mandatory=$true)][string]$Origin,
    [Parameter(Mandatory=$true)][ValidateRange(1,999999999)][int]$VersionCode,
    [Parameter(Mandatory=$true)][ValidateLength(1,80)][string]$VersionName,
    [string]$Jdk = $env:JAVA_HOME,
    [string]$Sdk = $env:ANDROID_HOME,
    [string]$WechatAppId = $env:XIJIE_WECHAT_ANDROID_APP_ID,
    [switch]$Unsigned,
    [switch]$Offline
)
$ErrorActionPreference = 'Stop'
if ($WechatAppId -and $WechatAppId -cnotmatch '^wx[0-9a-fA-F]{16}$') { throw 'WechatAppId must be the approved public WeChat mobile AppID or empty.' }
$appOrigin = [Uri]$Origin
if (-not $appOrigin.IsAbsoluteUri -or $appOrigin.Scheme -ne 'https' -or $appOrigin.UserInfo -or $appOrigin.Query -or $appOrigin.Fragment -or $appOrigin.AbsolutePath -ne '/' -or $appOrigin.IsLoopback) { throw 'Origin must be the public first-party HTTPS app origin, without a path or credentials.' }
$mobileRoot = $PSScriptRoot
$repoRoot = Split-Path -Parent $mobileRoot
if (-not $Jdk) { throw 'Pass -Jdk with JDK 21.' }
if (-not $Sdk) { $Sdk = $env:ANDROID_SDK_ROOT }
if (-not $Sdk) { $Sdk = Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
foreach ($required in @("$Jdk/bin/java.exe", "$Sdk/platforms/android-36/android.jar")) { if (-not (Test-Path -LiteralPath $required)) { throw "Required local build input missing: $required" } }
if (-not $Unsigned) { foreach ($key in @('XIJIE_ANDROID_KEYSTORE','XIJIE_ANDROID_KEY_ALIAS','XIJIE_ANDROID_STORE_PASSWORD','XIJIE_ANDROID_KEY_PASSWORD')) { if (-not [Environment]::GetEnvironmentVariable($key,'Process')) { throw "Set $key privately or use -Unsigned for verification." } } }
$assets = Join-Path $mobileRoot '.tmp/release-assets'
$webOutput = Join-Path $mobileRoot '.tmp/release-web'
foreach ($folder in @($assets,$webOutput,(Join-Path $mobileRoot '.android-user-home'),(Join-Path $mobileRoot 'artifacts'))) { New-Item -ItemType Directory -Force -Path $folder | Out-Null }
# Clear only the two resolved staging directories inside this mobile workspace.
foreach ($folder in @($assets,$webOutput)) {
    $absolute = [IO.Path]::GetFullPath($folder)
    if (-not $absolute.StartsWith([IO.Path]::GetFullPath((Join-Path $mobileRoot '.tmp')) + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid release staging path.' }
    Get-ChildItem -LiteralPath $absolute -Force | Remove-Item -Recurse -Force
}
$names = @('JAVA_HOME','ANDROID_HOME','ANDROID_SDK_ROOT','ANDROID_USER_HOME','CAP_PUBLISH','TEMP','TMP','VITE_XIJIE_AUTH_MODE','XIJIE_IDENTITY_URL','FIGMA_PUBLIC_URL')
$before = @{}
foreach ($name in $names) { $before[$name] = [Environment]::GetEnvironmentVariable($name,'Process') }
$signing = @('XIJIE_ANDROID_KEYSTORE','XIJIE_ANDROID_KEY_ALIAS','XIJIE_ANDROID_STORE_PASSWORD','XIJIE_ANDROID_KEY_PASSWORD')
foreach ($name in $signing) { $before[$name] = [Environment]::GetEnvironmentVariable($name,'Process') }
try {
    $env:JAVA_HOME=$Jdk; $env:ANDROID_HOME=$Sdk; $env:ANDROID_SDK_ROOT=$Sdk
    $env:ANDROID_USER_HOME=Join-Path $mobileRoot '.android-user-home'; $env:CAP_PUBLISH='false'
    $env:TEMP=Join-Path $mobileRoot '.tmp'; $env:TMP=$env:TEMP
    $env:VITE_XIJIE_AUTH_MODE='service'; $env:XIJIE_IDENTITY_URL=$appOrigin.GetLeftPart([UriPartial]::Authority)
    Remove-Item Env:FIGMA_PUBLIC_URL -ErrorAction SilentlyContinue
    if ($Unsigned) { foreach ($name in $signing) { [Environment]::SetEnvironmentVariable($name,$null,'Process') } }
    Push-Location $repoRoot
    try { & node node_modules/vite/bin/vite.js build --mode production --outDir $webOutput 2>&1 | Tee-Object -FilePath (Join-Path $mobileRoot 'artifacts/build-release-web.log'); if ($LASTEXITCODE -ne 0) { throw 'Service frontend build failed.' } } finally { Pop-Location }
    $public=Join-Path $assets 'public'; New-Item -ItemType Directory -Force -Path $public | Out-Null
    Get-ChildItem -LiteralPath $webOutput -Force | Copy-Item -Destination $public -Recurse -Force
    @{'appId'='app.elysium.xijie';'appName'='西界';'webDir'='public';'loggingBehavior'='none';'android'=@{'allowMixedContent'=$false;'webContentsDebuggingEnabled'=$false};'includePlugins'=@();'server'=@{'url'=$appOrigin.GetLeftPart([UriPartial]::Authority);'errorPath'='release-offline.html'}} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $assets 'capacitor.config.json') -Encoding utf8NoBOM
    '[]' | Set-Content -LiteralPath (Join-Path $assets 'capacitor.plugins.json') -Encoding utf8NoBOM
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>西界</title><body style="font-family:system-ui;padding:48px 24px;background:#faf9f6;color:#24241e"><h1>暂时无法连接</h1><p>请检查网络连接后重新打开西界。你的已保存内容仍由账号安全保管。</p></body></html>' | Set-Content -LiteralPath (Join-Path $public 'release-offline.html') -Encoding utf8NoBOM
    ('sdk.dir=' + $Sdk.Replace('\','/')) | Set-Content -LiteralPath (Join-Path $mobileRoot 'android/local.properties') -Encoding utf8NoBOM
    Push-Location (Join-Path $mobileRoot 'android')
    try {
        $buildArgs=@('--no-daemon','--console=plain','--max-workers=2','-PxijieRelease=true',"-PxijieVersionCode=$VersionCode","-PxijieVersionName=$VersionName","-PxijieReleaseAssetsDir=$($assets.Replace('\','/'))",':app:assembleRelease',':app:bundleRelease')
        if ($WechatAppId) { $buildArgs=@("-PxijieWechatAppId=$WechatAppId")+$buildArgs }
        if ($Offline) { $buildArgs=@('--offline')+$buildArgs }
        & ./gradlew.bat @buildArgs 2>&1 | Tee-Object -FilePath (Join-Path $mobileRoot 'artifacts/build-release.log')
        if ($LASTEXITCODE -ne 0) { throw 'Android release compilation failed.' }
    } finally { Pop-Location }
    $apkName=if($Unsigned){'app-release-unsigned.apk'}else{'app-release.apk'}
    $label=if($Unsigned){'unsigned'}else{'signed'}
    Copy-Item -LiteralPath (Join-Path $mobileRoot "android/app/build/outputs/apk/release/$apkName") -Destination (Join-Path $mobileRoot "artifacts/xijie-$VersionCode-$label.apk") -Force
    Copy-Item -LiteralPath (Join-Path $mobileRoot 'android/app/build/outputs/bundle/release/app-release.aab') -Destination (Join-Path $mobileRoot "artifacts/xijie-$VersionCode-$label.aab") -Force
    Get-FileHash -LiteralPath (Join-Path $mobileRoot "artifacts/xijie-$VersionCode-$label.apk") -Algorithm SHA256
    Write-Output "Release package built ($label). HTTPS service reachability, real device paths and distribution signatures require separate verification."
} finally { foreach ($name in ($names+$signing)) { [Environment]::SetEnvironmentVariable($name,$before[$name],'Process') } }
