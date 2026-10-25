param([switch]$Install)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot '.codex-runtime'
. (Join-Path $PSScriptRoot 'desktop-env.ps1')

if ($Install) {
    & (Join-Path $PSScriptRoot 'setup-desktop.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Desktop toolchain setup failed.' }
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw 'Rust is not configured. Run .\scripts\setup-desktop.ps1 first.'
}

& (Join-Path $PSScriptRoot 'start-dev.ps1') -Install:$Install -FrontendHost '127.0.0.1' -FrontendPort 5174 -StrictFrontendPort

$pidPath = Join-Path $runtimeRoot 'desktop.pid'
if (Test-Path -LiteralPath $pidPath) {
    $existingPid = [int](Get-Content -LiteralPath $pidPath -Raw)
    if (Get-Process -Id $existingPid -ErrorAction SilentlyContinue) {
        Write-Host "desktop is already running (PID $existingPid)."
        exit 0
    }
}

$stdout = Join-Path $runtimeRoot 'desktop.out.log'
$stderr = Join-Path $runtimeRoot 'desktop.err.log'
$process = Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'desktop:dev') -WorkingDirectory (Join-Path $projectRoot 'frontend') -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
Set-Content -LiteralPath $pidPath -Value $process.Id
Write-Host "AnimeUta desktop client is starting (PID $($process.Id))." -ForegroundColor Green
Write-Output "Logs: $stdout"
