param(
    [string]$SdkRoot,
    [string]$JavaHome,
    [int]$BackendPort = 8080,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $SdkRoot) { $SdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { 'D:\develop\Android\Sdk' } }
$SdkRoot = [System.IO.Path]::GetFullPath($SdkRoot)
$adb = Join-Path $SdkRoot 'platform-tools\adb.exe'
$apk = Join-Path $projectRoot 'artifacts\android\AnimeUta-debug.apk'

if (-not (Test-Path -LiteralPath $adb)) {
    throw "Android platform-tools were not found at $SdkRoot. Pass -SdkRoot or set ANDROID_HOME."
}
if (-not $SkipBuild) {
    & (Join-Path $PSScriptRoot 'build-android.ps1') -SdkRoot $SdkRoot -JavaHome $JavaHome
    if ($LASTEXITCODE -ne 0) { throw 'Android debug build failed.' }
}
if (-not (Test-Path -LiteralPath $apk)) {
    throw "Packaged APK was not found at $apk. Run scripts\build-android.ps1 first."
}

& $adb start-server | Out-Null
$devices = @(& $adb devices | Select-Object -Skip 1 | ForEach-Object {
    if ($_ -match '^([^\s]+)\s+device$') { $Matches[1] }
})
if ($devices.Count -eq 0) {
    throw 'No authorized Android device was found. Connect one with USB debugging enabled and accept the authorization prompt.'
}
if ($devices.Count -gt 1) {
    throw "More than one Android device is connected ($($devices -join ', ')). Disconnect extras before running this script."
}

$serial = $devices[0]
& $adb -s $serial reverse "tcp:$BackendPort" "tcp:$BackendPort"
if ($LASTEXITCODE -ne 0) { throw "Could not map device port $BackendPort to the local AnimeUta backend." }
& $adb -s $serial install -r $apk
if ($LASTEXITCODE -ne 0) { throw 'APK installation failed.' }
& $adb -s $serial shell am force-stop app.animeuta.mobile
& $adb -s $serial shell am start -n app.animeuta.mobile/.MainActivity
if ($LASTEXITCODE -ne 0) { throw 'AnimeUta was installed but could not be launched.' }

Write-Host "`nAnimeUta is running on Android device $serial." -ForegroundColor Green
Write-Output "The debug app can reach the host backend at http://127.0.0.1:$BackendPort through adb reverse."
Write-Output 'Release builds continue to require HTTPS because cleartext traffic is enabled only in src/debug.'
