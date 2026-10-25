param([switch]$SkipBuildTools)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'desktop-env.ps1')

$toolsRoot = Join-Path $projectRoot '.build-cache\tools'
New-Item -ItemType Directory -Force -Path $toolsRoot | Out-Null

if (-not (Get-Command rustc -ErrorAction SilentlyContinue)) {
    $rustupInstaller = Join-Path $toolsRoot 'rustup-init.exe'
    if (-not (Test-Path -LiteralPath $rustupInstaller)) {
        Write-Host 'Downloading the official Rust installer...' -ForegroundColor Cyan
        Invoke-WebRequest -UseBasicParsing -Uri 'https://win.rustup.rs/x86_64' -OutFile $rustupInstaller
    }
    & $rustupInstaller -y --no-modify-path --profile minimal --default-host x86_64-pc-windows-msvc --default-toolchain stable
    if ($LASTEXITCODE -ne 0) { throw 'Rust installation failed.' }
}

$programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
$vswhere = Join-Path $programFilesX86 'Microsoft Visual Studio\Installer\vswhere.exe'
$cppRoot = if (Test-Path -LiteralPath $vswhere) {
    & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
}

if (-not $cppRoot -and -not $SkipBuildTools) {
    $vsInstaller = Join-Path $toolsRoot 'vs_BuildTools.exe'
    if (-not (Test-Path -LiteralPath $vsInstaller)) {
        Write-Host 'Downloading Microsoft C++ Build Tools installer...' -ForegroundColor Cyan
        Invoke-WebRequest -UseBasicParsing -Uri 'https://aka.ms/vs/17/release/vs_BuildTools.exe' -OutFile $vsInstaller
    }
    Write-Host 'Installing Microsoft C++ Build Tools. This machine-level prerequisite can take several minutes.' -ForegroundColor Cyan
    $process = Start-Process -FilePath $vsInstaller -ArgumentList @(
        '--quiet', '--wait', '--norestart', '--nocache',
        '--add', 'Microsoft.VisualStudio.Workload.VCTools',
        '--includeRecommended'
    ) -Wait -PassThru
    if ($process.ExitCode -notin @(0, 3010)) {
        throw "Microsoft C++ Build Tools installation failed with exit code $($process.ExitCode)."
    }
    $cppRoot = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
}

if (-not $cppRoot) {
    throw 'Microsoft C++ Build Tools with Desktop development with C++ is required. Run this script without -SkipBuildTools.'
}

& rustc --version
& cargo --version
Write-Host 'AnimeUta desktop toolchain is ready.' -ForegroundColor Green
