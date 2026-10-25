$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot

function Invoke-NpmScript {
    param(
        [Parameter(Mandatory = $true)][string]$Directory,
        [Parameter(Mandatory = $true)][string]$Script
    )

    Write-Host "`n==> $Directory : npm run $Script" -ForegroundColor Cyan
    & npm.cmd --prefix (Join-Path $projectRoot $Directory) run $Script
    if ($LASTEXITCODE -ne 0) { throw "$Directory npm run $Script failed" }
}

Invoke-NpmScript -Directory 'backend' -Script 'test'
Invoke-NpmScript -Directory 'backend' -Script 'check'
Invoke-NpmScript -Directory 'backend' -Script 'build'
Invoke-NpmScript -Directory 'frontend' -Script 'lint'

Write-Host "`n==> frontend : i18n audit" -ForegroundColor Cyan
& node (Join-Path $PSScriptRoot 'check-i18n.mjs')
if ($LASTEXITCODE -ne 0) { throw 'frontend i18n audit failed' }

Invoke-NpmScript -Directory 'frontend' -Script 'mobile:sync'

Write-Host "`n==> frontend : non-PWA build audit" -ForegroundColor Cyan
& node (Join-Path $PSScriptRoot 'check-web-build.mjs')
if ($LASTEXITCODE -ne 0) { throw 'frontend non-PWA build audit failed' }

Write-Host "`n==> frontend : Android configuration audit" -ForegroundColor Cyan
& node (Join-Path $PSScriptRoot 'check-android.mjs')
if ($LASTEXITCODE -ne 0) { throw 'frontend Android configuration audit failed' }

Write-Host "`n==> frontend : brand asset audit" -ForegroundColor Cyan
& node (Join-Path $PSScriptRoot 'check-brand-assets.mjs')
if ($LASTEXITCODE -ne 0) { throw 'frontend brand asset audit failed' }

Write-Host "`n==> desktop : Tauri release build" -ForegroundColor Cyan
. (Join-Path $PSScriptRoot 'desktop-env.ps1')
Invoke-NpmScript -Directory 'frontend' -Script 'desktop:build'

Write-Host "`n==> git diff --check" -ForegroundColor Cyan
& git -C $projectRoot diff --check
if ($LASTEXITCODE -ne 0) { throw 'git diff --check failed' }

Write-Host "`nAnimeUta verification passed." -ForegroundColor Green
