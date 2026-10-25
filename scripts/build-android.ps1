param(
    [string]$SdkRoot,
    [string]$JavaHome
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$androidRoot = Join-Path $projectRoot 'frontend\android'
$artifactRoot = Join-Path $projectRoot 'artifacts\android'
$artifactApk = Join-Path $artifactRoot 'AnimeUta-debug.apk'
$gradleUserHome = if ($env:GRADLE_USER_HOME) { $env:GRADLE_USER_HOME } else { Join-Path $projectRoot '.build-cache\gradle' }

if (-not $SdkRoot) { $SdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { 'D:\develop\Android\Sdk' } }
if (-not $JavaHome) {
    $localJdk = 'D:\develop\Java\microsoft-jdk-21'
    $JavaHome = if (Test-Path -LiteralPath (Join-Path $localJdk 'bin\java.exe')) { $localJdk } else { $env:JAVA_HOME }
}
if (-not $JavaHome) { throw 'JDK 21 was not configured. Pass -JavaHome or set JAVA_HOME.' }
$SdkRoot = [System.IO.Path]::GetFullPath($SdkRoot)
$JavaHome = [System.IO.Path]::GetFullPath($JavaHome)

$androidJar = Join-Path $SdkRoot 'platforms\android-36\android.jar'
$java = Join-Path $JavaHome 'bin\java.exe'
if (-not (Test-Path -LiteralPath $androidJar)) {
    throw "Android SDK 36 was not found at $SdkRoot. Pass -SdkRoot or set ANDROID_HOME."
}
if (-not (Test-Path -LiteralPath $java)) {
    throw "JDK 21 was not found at $JavaHome. Pass -JavaHome or set JAVA_HOME."
}

$javaVersion = (& $java -version 2>&1 | Select-Object -First 1).ToString()
if ($javaVersion -notmatch 'version "21\.') {
    throw "AnimeUta Android requires JDK 21; found: $javaVersion"
}

$env:ANDROID_HOME = $SdkRoot
$env:ANDROID_SDK_ROOT = $SdkRoot
$env:JAVA_HOME = $JavaHome
$env:GRADLE_USER_HOME = $gradleUserHome
$env:Path = "$(Join-Path $JavaHome 'bin');$(Join-Path $SdkRoot 'platform-tools');$env:Path"

New-Item -ItemType Directory -Force -Path $artifactRoot, $gradleUserHome | Out-Null

& npm.cmd --prefix (Join-Path $projectRoot 'frontend') run mobile:sync
if ($LASTEXITCODE -ne 0) { throw 'Capacitor asset sync failed.' }

Push-Location $androidRoot
try {
    & .\gradlew.bat assembleDebug
    if ($LASTEXITCODE -ne 0) { throw 'Android debug build failed.' }
} finally {
    Pop-Location
}

$apk = Join-Path $androidRoot 'app\build\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path -LiteralPath $apk)) { throw 'Gradle completed without producing app-debug.apk.' }
$buildTools = Get-ChildItem -LiteralPath (Join-Path $SdkRoot 'build-tools') -Directory |
    Sort-Object { [version]$_.Name } -Descending |
    Select-Object -First 1
if (-not $buildTools) { throw 'Android Build Tools were not found.' }
$apksigner = Join-Path $buildTools.FullName 'apksigner.bat'
$aapt = Join-Path $buildTools.FullName 'aapt.exe'
if (-not (Test-Path -LiteralPath $apksigner)) { throw 'Android apksigner was not found.' }
if (-not (Test-Path -LiteralPath $aapt)) { throw 'Android aapt was not found.' }

& $apksigner verify --verbose --print-certs $apk
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
$badging = (& $aapt dump badging $apk) -join "`n"
if ($LASTEXITCODE -ne 0) { throw 'APK metadata inspection failed.' }
if ($badging -notmatch "package: name='app\.animeuta\.mobile'") { throw 'APK package id is incorrect.' }
if ($badging -notmatch "sdkVersion:'24'") { throw 'APK minimum SDK is incorrect.' }
if ($badging -notmatch "targetSdkVersion:'36'") { throw 'APK target SDK is incorrect.' }
if ($badging -notmatch 'application-debuggable') { throw 'APK is not marked as a debug build.' }
Copy-Item -LiteralPath $apk -Destination $artifactApk -Force
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $artifactApk).Hash.ToLowerInvariant()
$sizeMb = [math]::Round((Get-Item -LiteralPath $artifactApk).Length / 1MB, 2)
Write-Host "`nAnimeUta Android debug APK created." -ForegroundColor Green
Write-Output "Path: $artifactApk"
Write-Output "Gradle output: $apk"
Write-Output "Size: $sizeMb MB"
Write-Output "SHA-256: $hash"
Write-Output 'Package: app.animeuta.mobile (minSdk 24, targetSdk 36)'
