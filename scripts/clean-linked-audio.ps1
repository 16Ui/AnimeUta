param([Parameter(Mandatory = $true)][string]$ReportPath)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$projectPrefix = $projectRoot.TrimEnd('\') + '\'
$plan = Get-Content -LiteralPath $ReportPath -Raw | ConvertFrom-Json
if (-not $plan.applied) { throw 'Apply the audio linking plan before removing duplicates.' }
if (-not $plan.snapshots -or @($plan.snapshots | Where-Object { -not (Test-Path -LiteralPath $_) }).Count -gt 0) {
    throw 'The database recovery snapshots are missing.'
}

$validated = @()
$sourceHashes = @{}
foreach ($file in $plan.cleanup) {
    $target = [System.IO.Path]::GetFullPath($file.path)
    $source = [System.IO.Path]::GetFullPath($file.source)
    if (-not $target.StartsWith($projectPrefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Target is outside the project: $target" }
    $relativeTarget = $target.Substring($projectPrefix.Length)
    if ($relativeTarget -notmatch '^(backend\\data\\media\\audio\\[^\\]+|backups\\[^\\]+\\media\\audio\\[^\\]+)$') { throw "Unexpected audio cleanup target: $target" }
    if ($source.StartsWith($projectPrefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Original audio must be outside the project.' }
    if (-not (Test-Path -LiteralPath $target)) { continue }
    $targetItem = Get-Item -LiteralPath $target
    if ($targetItem.PSIsContainer -or ($targetItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) { throw "Target is not a regular file: $target" }
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Original audio is missing: $source" }
    if ($targetItem.Length -ne $file.sizeBytes -or (Get-Item -LiteralPath $source).Length -ne $file.sizeBytes) { throw "Audio size changed: $target" }
    if (-not $sourceHashes.ContainsKey($source)) { $sourceHashes[$source] = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() }
    if ($sourceHashes[$source] -ne $file.sha256 -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw "Audio content changed: $target" }
    $validated += [pscustomobject]@{ Path = $target; SizeBytes = $targetItem.Length }
    if ($validated.Count % 100 -eq 0) { Write-Output "Verified $($validated.Count) duplicate files." }
}

$removedBytes = 0L
foreach ($file in $validated) {
    Remove-Item -LiteralPath $file.Path -Force
    $removedBytes += $file.SizeBytes
}
Write-Output "Removed $($validated.Count) verified duplicate audio files. Freed $([math]::Round($removedBytes / 1GB, 3)) GiB."
