param(
    [Parameter(Mandatory = $true)][string]$Backup,
    [switch]$RestoreEnvironment
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'stop-dev.ps1')
$arguments = @('--prefix', (Join-Path $projectRoot 'backend'), 'run', 'restore', '--', "--backup=$Backup", '--force')
if ($RestoreEnvironment) { $arguments += '--restore-env' }
& npm.cmd @arguments
if ($LASTEXITCODE -ne 0) { throw 'AnimeUta restore failed' }
