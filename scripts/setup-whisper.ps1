param(
    [string]$WhisperRoot,
    [string]$FfmpegRoot,
    [int]$Port = 8178,
    [switch]$SkipStart
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $WhisperRoot) { $WhisperRoot = Join-Path $env:LOCALAPPDATA 'AnimeUta\tools\whisper' }
if (-not $FfmpegRoot) { $FfmpegRoot = Join-Path $env:LOCALAPPDATA 'AnimeUta\tools\ffmpeg' }
$WhisperRoot = [System.IO.Path]::GetFullPath($WhisperRoot)
$FfmpegRoot = [System.IO.Path]::GetFullPath($FfmpegRoot)

$whisperVersion = 'v1.9.2'
$whisperArchiveName = 'whisper-bin-x64.zip'
$whisperArchiveHash = '49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a'
$whisperArchiveUrl = "https://github.com/ggml-org/whisper.cpp/releases/download/$whisperVersion/$whisperArchiveName"
$modelName = 'ggml-large-v3-turbo-q5_0.bin'
$modelHash = 'e050f7970618a659205450ad97eb95a18d69c9ee'
$modelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$modelName"
$ffmpegVersion = '9.0.1'
$ffmpegArchiveName = "ffmpeg-$ffmpegVersion-essentials_build.zip"
$ffmpegArchiveHash = 'fec81ae03971d9dd4be3ebe02e263bd2ec1d789483f931bdba5f5715e65da2e9'
$ffmpegArchiveUrl = "https://github.com/GyanD/codexffmpeg/releases/download/$ffmpegVersion/$ffmpegArchiveName"

function Get-VerifiedDownload {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][string]$ExpectedHash,
        [ValidateSet('SHA1', 'SHA256')][string]$Algorithm = 'SHA256'
    )

    $parent = Split-Path -Parent $Destination
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    $valid = $false
    if (Test-Path -LiteralPath $Destination) {
        $valid = (Get-FileHash -Algorithm $Algorithm -LiteralPath $Destination).Hash.ToLowerInvariant() -eq $ExpectedHash
    }
    if (-not $valid) {
        & curl.exe -L --fail --retry 3 --retry-delay 2 -o $Destination $Uri
        if ($LASTEXITCODE -ne 0) { throw "Download failed: $Uri" }
    }
    $actual = (Get-FileHash -Algorithm $Algorithm -LiteralPath $Destination).Hash.ToLowerInvariant()
    if ($actual -ne $ExpectedHash) { throw "Checksum mismatch for $Destination" }
}

function Set-DotEnvValue {
    param([string]$Path, [string]$Name, [string]$Value)
    $content = if (Test-Path -LiteralPath $Path) { Get-Content -LiteralPath $Path -Raw } else { '' }
    $line = "$Name=$Value"
    if ($content -match "(?m)^$([Regex]::Escape($Name))=") {
        $content = [Regex]::Replace($content, "(?m)^$([Regex]::Escape($Name))=.*$", $line)
    } else {
        if ($content -and -not $content.EndsWith("`n")) { $content += "`r`n" }
        $content += "$line`r`n"
    }
    Set-Content -LiteralPath $Path -Value $content -NoNewline
}

$whisperArchive = Join-Path $WhisperRoot "downloads\$whisperArchiveName"
Get-VerifiedDownload -Uri $whisperArchiveUrl -Destination $whisperArchive -ExpectedHash $whisperArchiveHash
$whisperBinRoot = Join-Path $WhisperRoot "bin\$whisperVersion-cpu"
New-Item -ItemType Directory -Force -Path $whisperBinRoot | Out-Null
$whisperServer = Get-ChildItem -LiteralPath $whisperBinRoot -Recurse -Filter 'whisper-server.exe' | Select-Object -First 1 -ExpandProperty FullName
if (-not $whisperServer) {
    Expand-Archive -LiteralPath $whisperArchive -DestinationPath $whisperBinRoot -Force
    $whisperServer = Get-ChildItem -LiteralPath $whisperBinRoot -Recurse -Filter 'whisper-server.exe' | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $whisperServer) { throw 'whisper-server.exe was not found after extraction.' }

$modelPath = Join-Path $WhisperRoot "models\$modelName"
Get-VerifiedDownload -Uri $modelUrl -Destination $modelPath -ExpectedHash $modelHash -Algorithm SHA1

$ffmpegArchive = Join-Path $FfmpegRoot "downloads\$ffmpegArchiveName"
Get-VerifiedDownload -Uri $ffmpegArchiveUrl -Destination $ffmpegArchive -ExpectedHash $ffmpegArchiveHash
$ffmpegBinRoot = Join-Path $FfmpegRoot "bin\$ffmpegVersion"
New-Item -ItemType Directory -Force -Path $ffmpegBinRoot | Out-Null
$ffmpeg = Get-ChildItem -LiteralPath $ffmpegBinRoot -Recurse -Filter 'ffmpeg.exe' | Select-Object -First 1 -ExpandProperty FullName
if (-not $ffmpeg) {
    Expand-Archive -LiteralPath $ffmpegArchive -DestinationPath $ffmpegBinRoot -Force
    $ffmpeg = Get-ChildItem -LiteralPath $ffmpegBinRoot -Recurse -Filter 'ffmpeg.exe' | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $ffmpeg) { throw 'ffmpeg.exe was not found after extraction.' }

$backendEnv = Join-Path $projectRoot 'backend\.env'
if (-not (Test-Path -LiteralPath $backendEnv)) {
    Copy-Item -LiteralPath (Join-Path $projectRoot 'backend\.env.example') -Destination $backendEnv
}
Set-DotEnvValue -Path $backendEnv -Name 'TRANSCRIPTION_BASE_URL' -Value "http://127.0.0.1:$Port/v1"
Set-DotEnvValue -Path $backendEnv -Name 'TRANSCRIPTION_MODEL' -Value 'whisper-1'
Set-DotEnvValue -Path $backendEnv -Name 'TRANSCRIPTION_TIMEOUT_SECONDS' -Value '1800'
Set-DotEnvValue -Path $backendEnv -Name 'WHISPER_SERVER_PATH' -Value $whisperServer
Set-DotEnvValue -Path $backendEnv -Name 'WHISPER_MODEL_PATH' -Value $modelPath
Set-DotEnvValue -Path $backendEnv -Name 'FFMPEG_PATH' -Value $ffmpeg

Write-Host 'Local Whisper runtime is installed and configured.' -ForegroundColor Green
Write-Output "Server: $whisperServer"
Write-Output "Model: $modelPath"
Write-Output "FFmpeg: $ffmpeg"
if (-not $SkipStart) {
    & (Join-Path $PSScriptRoot 'start-whisper.ps1') -Port $Port -ServerPath $whisperServer -ModelPath $modelPath -FfmpegPath $ffmpeg
}
