param([switch]$Install)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$frontendRoot = Join-Path $projectRoot 'frontend'
. (Join-Path $PSScriptRoot 'desktop-env.ps1')

if ($Install -or -not (Test-Path -LiteralPath (Join-Path $frontendRoot 'node_modules'))) {
    & npm.cmd --prefix $frontendRoot install
    if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw 'Rust is not configured. Run .\scripts\setup-desktop.ps1 first.'
}

& npm.cmd --prefix $frontendRoot run desktop:build
if ($LASTEXITCODE -ne 0) { throw 'Tauri desktop build failed.' }

$artifactRoot = Join-Path $projectRoot 'artifacts\desktop'
New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null
$binary = Join-Path $env:CARGO_TARGET_DIR 'release\animeuta-desktop.exe'
if (-not (Test-Path -LiteralPath $binary)) { throw 'Tauri completed without producing animeuta-desktop.exe.' }
Copy-Item -LiteralPath $binary -Destination (Join-Path $artifactRoot 'AnimeUta.exe') -Force

$installer = Get-ChildItem -LiteralPath (Join-Path $env:CARGO_TARGET_DIR 'release\bundle\nsis') -Filter '*-setup.exe' -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if (-not $installer) { throw 'Tauri completed without producing an NSIS installer.' }
Copy-Item -LiteralPath $installer.FullName -Destination (Join-Path $artifactRoot 'AnimeUta-Setup.exe') -Force

$portableHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $artifactRoot 'AnimeUta.exe')).Hash.ToLowerInvariant()
$installerHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $artifactRoot 'AnimeUta-Setup.exe')).Hash.ToLowerInvariant()
Write-Host 'AnimeUta Windows desktop client created.' -ForegroundColor Green
Write-Output "Portable: $artifactRoot\AnimeUta.exe"
Write-Output "Installer: $artifactRoot\AnimeUta-Setup.exe"
Write-Output "Portable SHA-256: $portableHash"
Write-Output "Installer SHA-256: $installerHash"
