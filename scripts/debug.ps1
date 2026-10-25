param(
    [ValidateSet('All', 'Services', 'Web', 'Desktop', 'Android')]
    [string[]]$Target = @('All'),
    [switch]$Install,
    [switch]$SkipAndroidBuild,
    [string]$SdkRoot,
    [string]$JavaHome
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$webUrl = 'http://127.0.0.1:5173'
$apiUrl = 'http://127.0.0.1:8080/api/v1/health'
$allRequested = $Target -contains 'All'

function Wait-AnimeUtaEndpoint {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
            if ($response.StatusCode -eq 200) {
                Write-Host "$Name is ready: $Url" -ForegroundColor Green
                return
            }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    } while ([DateTime]::UtcNow -lt $deadline)

    throw "$Name did not become ready within 30 seconds: $Url"
}

& (Join-Path $PSScriptRoot 'start-dev.ps1') -Install:$Install
Wait-AnimeUtaEndpoint -Url $apiUrl -Name 'Backend'
Wait-AnimeUtaEndpoint -Url $webUrl -Name 'Frontend'

if ($allRequested -or $Target -contains 'Web') {
    Start-Process $webUrl
    Write-Host 'Web client opened in the default browser.'
}

if ($allRequested -or $Target -contains 'Desktop') {
    . (Join-Path $PSScriptRoot 'desktop-env.ps1')
    if ($Install) {
        & (Join-Path $PSScriptRoot 'setup-desktop.ps1')
        if ($LASTEXITCODE -ne 0) { throw 'Desktop toolchain setup failed.' }
    }
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        throw 'Rust is not configured. Run .\scripts\setup-desktop.ps1 first.'
    }

    $runtimeRoot = Join-Path $projectRoot '.codex-runtime'
    $pidPath = Join-Path $runtimeRoot 'desktop.pid'
    $desktopRunning = $false
    if (Test-Path -LiteralPath $pidPath) {
        $existingPid = [int](Get-Content -LiteralPath $pidPath -Raw)
        $desktopRunning = [bool](Get-Process -Id $existingPid -ErrorAction SilentlyContinue)
    }
    if ($desktopRunning) {
        Write-Host "Desktop client is already running (PID $existingPid)."
    } else {
        $stdout = Join-Path $runtimeRoot 'desktop.out.log'
        $stderr = Join-Path $runtimeRoot 'desktop.err.log'
        $process = Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'desktop:dev') -WorkingDirectory (Join-Path $projectRoot 'frontend') -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
        Set-Content -LiteralPath $pidPath -Value $process.Id
        Write-Host "Tauri desktop client is starting (PID $($process.Id))."
    }
}

if ($allRequested -or $Target -contains 'Android') {
    if (-not $SdkRoot) {
        $SdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { 'D:\develop\Android\Sdk' }
    }
    $adb = Join-Path ([System.IO.Path]::GetFullPath($SdkRoot)) 'platform-tools\adb.exe'
    if (-not (Test-Path -LiteralPath $adb)) {
        throw "Android platform-tools were not found at $SdkRoot."
    }

    & $adb start-server | Out-Null
    $devices = @(& $adb devices | Select-Object -Skip 1 | Where-Object { $_ -match '^([^\s]+)\s+device$' })
    if ($devices.Count -eq 0 -and $allRequested) {
        Write-Warning 'Android was skipped because no running emulator or authorized device was found.'
        Write-Host 'Start an Android emulator (USB is optional), then run: .\scripts\debug.ps1 -Target Android'
    } elseif ($devices.Count -eq 0) {
        throw 'No running Android emulator or authorized device was found.'
    } else {
        $androidArguments = @{
            SdkRoot = $SdkRoot
            BackendPort = 8080
            SkipBuild = $SkipAndroidBuild
        }
        if ($JavaHome) { $androidArguments.JavaHome = $JavaHome }
        & (Join-Path $PSScriptRoot 'install-android.ps1') @androidArguments
    }
}

Write-Host "`nAnimeUta debug services are running." -ForegroundColor Cyan
Write-Output "Web: $webUrl"
if ($allRequested -or $Target -contains 'Desktop') {
    Write-Output 'Desktop: native Tauri window'
}
Write-Output "API health: $apiUrl"
Write-Output 'Stop everything with: .\scripts\stop-dev.ps1'
