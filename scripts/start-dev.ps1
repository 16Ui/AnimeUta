param(
    [switch]$Install,
    [string]$FrontendHost = '0.0.0.0',
    [int]$FrontendPort = 5173,
    [switch]$StrictFrontendPort
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot '.codex-runtime'
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null

foreach ($name in @('backend', 'frontend')) {
    $directory = Join-Path $projectRoot $name
    if ($Install -or -not (Test-Path -LiteralPath (Join-Path $directory 'node_modules'))) {
        & npm.cmd --prefix $directory install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed for $name" }
    }
}

$dictionary = Join-Path $projectRoot 'backend\data\dictionaries\tomoshi-dict-open.db'
if ($Install -or -not (Test-Path -LiteralPath $dictionary)) {
    & npm.cmd --prefix (Join-Path $projectRoot 'backend') run dictionary:setup
    if ($LASTEXITCODE -ne 0) { throw 'Tomoshi dictionary setup failed' }
}

$backendEnv = Join-Path $projectRoot 'backend\.env'
if (-not (Test-Path -LiteralPath $backendEnv)) {
    Copy-Item -LiteralPath (Join-Path $projectRoot 'backend\.env.example') -Destination $backendEnv
}

$envContent = Get-Content -LiteralPath $backendEnv -Raw
if ($envContent -match '(?m)^MEDIA_SIGNING_SECRET=(?:replace-with-a-long-random-secret)?\s*$') {
    $secret = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
    $envContent = [Regex]::Replace($envContent, '(?m)^MEDIA_SIGNING_SECRET=.*$', "MEDIA_SIGNING_SECRET=$secret")
    Set-Content -LiteralPath $backendEnv -Value $envContent -NoNewline
}

& npm.cmd --prefix (Join-Path $projectRoot 'backend') run migrate
if ($LASTEXITCODE -ne 0) { throw 'Database migration failed' }

$frontendArguments = @('run', 'dev', '--', '--host', $FrontendHost, '--port', $FrontendPort.ToString())
if ($StrictFrontendPort) {
    $frontendArguments += '--strictPort'
}

$processes = @(
    @{ Name = 'backend'; Directory = (Join-Path $projectRoot 'backend'); Arguments = @('run', 'dev') },
    @{ Name = 'frontend'; Directory = (Join-Path $projectRoot 'frontend'); Arguments = $frontendArguments }
)

foreach ($entry in $processes) {
    $pidPath = Join-Path $runtimeRoot "$($entry.Name).pid"
    if (Test-Path -LiteralPath $pidPath) {
        $existingPid = [int](Get-Content -LiteralPath $pidPath -Raw)
        if (Get-Process -Id $existingPid -ErrorAction SilentlyContinue) {
            Write-Host "$($entry.Name) is already running (PID $existingPid)."
            continue
        }
    }
    $stdout = Join-Path $runtimeRoot "$($entry.Name).out.log"
    $stderr = Join-Path $runtimeRoot "$($entry.Name).err.log"
    $process = Start-Process -FilePath 'npm.cmd' -ArgumentList $entry.Arguments -WorkingDirectory $entry.Directory -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
    Set-Content -LiteralPath $pidPath -Value $process.Id
    Write-Host "$($entry.Name) started (PID $($process.Id))."
}

Write-Host "AnimeUta: http://127.0.0.1:$FrontendPort"
Write-Host 'API health: http://127.0.0.1:8080/api/v1/health'
$connectedInterfaceIndexes = Get-NetConnectionProfile -ErrorAction SilentlyContinue |
    Where-Object { $_.IPv4Connectivity -ne 'Disconnected' } |
    Select-Object -ExpandProperty InterfaceIndex -Unique
$lanAddresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
        $_.IPAddress -notlike '127.*' -and
        $_.IPAddress -notlike '169.254*' -and
        $_.InterfaceIndex -in $connectedInterfaceIndexes
    } |
    Select-Object -ExpandProperty IPAddress -Unique
foreach ($lanAddress in $lanAddresses) {
    Write-Host "LAN Web: http://${lanAddress}:$FrontendPort"
    Write-Host "LAN API: http://${lanAddress}:8080"
}
