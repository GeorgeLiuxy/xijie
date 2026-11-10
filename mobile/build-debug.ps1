param(
    [string]$Jdk = $env:JAVA_HOME,
    [string]$Sdk = $env:ANDROID_HOME,
    [switch]$Offline
)
$ErrorActionPreference = 'Stop'
$mobileRoot = $PSScriptRoot
if (-not $Jdk) { throw 'Set JAVA_HOME or pass -Jdk with the JDK 21 installation path.' }
if (-not $Sdk) { $Sdk = $env:ANDROID_SDK_ROOT }
if (-not $Sdk) { $Sdk = Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
foreach ($required in @("$Jdk/bin/java.exe", "$Sdk/platforms/android-36/android.jar")) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Required local build input missing: $required" }
}
foreach ($folder in @('.android-user-home', '.tmp', 'artifacts')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $mobileRoot $folder) | Out-Null
}
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
        $buildArgs = @('--no-daemon', '--console=plain', '--stacktrace', '--max-workers=2', ':app:assembleDebug')
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
