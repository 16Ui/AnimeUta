param(
    [switch]$Runtime,
    [switch]$StaleTests,
    [switch]$Dependencies,
    [switch]$Artifacts
)

$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$separator = [System.IO.Path]::DirectorySeparatorChar
$projectPrefix = $projectRoot.TrimEnd($separator) + $separator

function Remove-ProjectItem {
    param([Parameter(Mandatory = $true)][string]$RelativePath)

    $fullPath = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $RelativePath))
    if (-not $fullPath.StartsWith($projectPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a path outside the project: $fullPath"
    }

    if (Test-Path -LiteralPath $fullPath) {
        Write-Host "Removing $RelativePath"
        Remove-Item -LiteralPath $fullPath -Recurse -Force
    }
}

$generatedPaths = @(
    'backend\dist',
    'frontend\dist',
    'frontend\android\.gradle',
    'frontend\android\build',
    'frontend\android\app\build',
    'frontend\android\capacitor-cordova-android-plugins\build',
    'frontend\ios\App\App\public',
    '.build-cache'
)

foreach ($path in $generatedPaths) {
    Remove-ProjectItem -RelativePath $path
}

if ($StaleTests) {
    $runtimeRoot = Join-Path $projectRoot '.codex-runtime'
    $stalePatterns = @(
        'android-emulator.pid',
        'backup-audit-*',
        'backup-online-*',
        'edge-metrics-*',
        'edge-mobile-profile',
        'format-audit-*',
        'import-song.mp3',
        'karakuri-sample.mp3',
        'karakuri-transcription.json',
        'mobile-*.png',
        'pre-009-*',
        'whisper.*.log'
    )

    if (Test-Path -LiteralPath $runtimeRoot) {
        foreach ($pattern in $stalePatterns) {
            Get-ChildItem -LiteralPath $runtimeRoot -Filter $pattern -Force -ErrorAction SilentlyContinue |
                ForEach-Object {
                    $relativePath = [System.IO.Path]::GetRelativePath($projectRoot, $_.FullName)
                    Remove-ProjectItem -RelativePath $relativePath
                }
        }

        Get-ChildItem -LiteralPath $projectRoot -Filter '.codex-*.log' -File -Force -ErrorAction SilentlyContinue |
            ForEach-Object { Remove-ProjectItem -RelativePath $_.Name }
    }
}

if ($Runtime) {
    $runningServices = @()
    foreach ($service in @('backend', 'frontend', 'desktop')) {
        $pidPath = Join-Path $projectRoot ".codex-runtime\$service.pid"
        if (-not (Test-Path -LiteralPath $pidPath)) {
            continue
        }

        $processId = (Get-Content -LiteralPath $pidPath -Raw).Trim()
        if ($processId -and (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
            $runningServices += $service
        }
    }

    if ($runningServices.Count -gt 0) {
        throw "Stop running services before removing runtime files: $($runningServices -join ', ')"
    }

    Remove-ProjectItem -RelativePath '.codex-runtime'
    Get-ChildItem -LiteralPath $projectRoot -Filter '.codex-*.log' -File -ErrorAction SilentlyContinue |
        ForEach-Object { Remove-ProjectItem -RelativePath $_.Name }
}

if ($Dependencies) {
    Remove-ProjectItem -RelativePath 'backend\node_modules'
    Remove-ProjectItem -RelativePath 'frontend\node_modules'
}

if ($Artifacts) {
    Remove-ProjectItem -RelativePath 'artifacts'
}

Write-Host 'Project cleanup completed.' -ForegroundColor Green
