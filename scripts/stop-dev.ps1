$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot '.codex-runtime'

function Stop-AnimeUtaProcessTree {
    param([int]$TargetProcessId)

    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $TargetProcessId" -ErrorAction SilentlyContinue
    foreach ($child in $children) {
        Stop-AnimeUtaProcessTree -TargetProcessId ([int]$child.ProcessId)
    }
    if (Get-Process -Id $TargetProcessId -ErrorAction SilentlyContinue) {
        Stop-Process -Id $TargetProcessId -Force
        Wait-Process -Id $TargetProcessId -Timeout 10 -ErrorAction SilentlyContinue
    }
}

foreach ($name in @('desktop', 'backend', 'frontend', 'whisper')) {
    $pidPath = Join-Path $runtimeRoot "$name.pid"
    if (-not (Test-Path -LiteralPath $pidPath)) { continue }
    $processId = [int](Get-Content -LiteralPath $pidPath -Raw)
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process) {
        Stop-AnimeUtaProcessTree -TargetProcessId $processId
        Write-Host "$name stopped."
    }
    Remove-Item -LiteralPath $pidPath -Force
}
