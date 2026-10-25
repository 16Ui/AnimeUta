param(
    [string]$ServerPath,
    [string]$ModelPath,
    [string]$FfmpegPath,
    [int]$Port = 8178
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot '.codex-runtime'
$backendEnv = Join-Path $projectRoot 'backend\.env'
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null

function Get-DotEnvValue {
    param([string]$Path, [string]$Name)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $line = Get-Content -LiteralPath $Path | Where-Object { $_ -match "^$([Regex]::Escape($Name))=" } | Select-Object -Last 1
    if (-not $line) { return $null }
    return ($line -split '=', 2)[1].Trim()
}

if (-not $ServerPath) { $ServerPath = Get-DotEnvValue -Path $backendEnv -Name 'WHISPER_SERVER_PATH' }
if (-not $ModelPath) { $ModelPath = Get-DotEnvValue -Path $backendEnv -Name 'WHISPER_MODEL_PATH' }
if (-not $FfmpegPath) { $FfmpegPath = Get-DotEnvValue -Path $backendEnv -Name 'FFMPEG_PATH' }
if (-not $ServerPath -or -not (Test-Path -LiteralPath $ServerPath)) { throw 'Whisper server is not installed. Run scripts\setup-whisper.ps1 first.' }
if (-not $ModelPath -or -not (Test-Path -LiteralPath $ModelPath)) { throw 'Whisper model is not installed. Run scripts\setup-whisper.ps1 first.' }
if (-not $FfmpegPath -or -not (Test-Path -LiteralPath $FfmpegPath)) { throw 'FFmpeg is not installed. Run scripts\setup-whisper.ps1 first.' }

$pidPath = Join-Path $runtimeRoot 'whisper.pid'
if (Test-Path -LiteralPath $pidPath) {
    $existingPid = [int](Get-Content -LiteralPath $pidPath -Raw)
    if (Get-Process -Id $existingPid -ErrorAction SilentlyContinue) {
        Write-Host "whisper is already running (PID $existingPid)."
        exit 0
    }
    Remove-Item -LiteralPath $pidPath -Force
}
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listener) { throw "Port $Port is already used by PID $($listener[0].OwningProcess)." }

$env:Path = "$(Split-Path -Parent $FfmpegPath);$env:Path"
$arguments = @(
    '-m', "`"$ModelPath`"",
    '--host', '127.0.0.1',
    '--port', $Port,
    '--request-path', '/v1/audio',
    '--inference-path', '/transcriptions',
    '--convert',
    '-l', 'ja'
)
$stdout = Join-Path $runtimeRoot 'whisper.out.log'
$stderr = Join-Path $runtimeRoot 'whisper.err.log'
$process = Start-Process -FilePath $ServerPath -ArgumentList $arguments -WorkingDirectory (Split-Path -Parent $ServerPath) -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
Set-Content -LiteralPath $pidPath -Value $process.Id

$deadline = (Get-Date).AddSeconds(90)
$ready = $false
do {
    Start-Sleep -Milliseconds 500
    if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) { break }
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/v1/audio/health" -TimeoutSec 2
        $ready = $health.status -eq 'ok'
    } catch {
        $ready = $false
    }
} while (-not $ready -and (Get-Date) -lt $deadline)

if (-not $ready) {
    if (Get-Process -Id $process.Id -ErrorAction SilentlyContinue) { Stop-Process -Id $process.Id -Force }
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
    $details = if (Test-Path -LiteralPath $stderr) { (Get-Content -LiteralPath $stderr -Tail 40) -join "`n" } else { 'No error log was produced.' }
    throw "Whisper did not become ready.`n$details"
}

Write-Host "whisper started (PID $($process.Id))." -ForegroundColor Green
Write-Output "Transcription API: http://127.0.0.1:$Port/v1/audio/transcriptions"
