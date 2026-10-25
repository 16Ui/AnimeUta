$projectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$buildCache = Join-Path $projectRoot '.build-cache'

$env:CARGO_HOME = Join-Path $buildCache 'cargo-home'
$env:RUSTUP_HOME = Join-Path $buildCache 'rustup-home'
$env:CARGO_TARGET_DIR = Join-Path $buildCache 'tauri-target'
$env:Path = "$(Join-Path $env:CARGO_HOME 'bin');$env:Path"

New-Item -ItemType Directory -Force -Path $env:CARGO_HOME, $env:RUSTUP_HOME, $env:CARGO_TARGET_DIR | Out-Null
