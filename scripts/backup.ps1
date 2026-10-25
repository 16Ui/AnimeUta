param([string]$Output)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$arguments = @('--prefix', (Join-Path $projectRoot 'backend'), 'run', 'backup')
if ($Output) { $arguments += @('--', "--output=$Output") }
& npm.cmd @arguments
if ($LASTEXITCODE -ne 0) { throw 'AnimeUta backup failed' }
