$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap(164, 314)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.Color]::FromArgb(24, 24, 30))
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$pink = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 59, 95))
$gray = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(170, 170, 185))
$title = New-Object System.Drawing.Font('Segoe UI', 19, ([System.Drawing.FontStyle]::Bold))
$body = New-Object System.Drawing.Font('Segoe UI', 9)
$graphics.FillRectangle($pink, 20, 30, 34, 4)
$graphics.DrawString('AnimeUta', $title, [System.Drawing.Brushes]::White, 16, 51)
$graphics.DrawString("MUSIC`n& JAPANESE", $body, $gray, 20, 92)
$graphics.DrawString("DESKTOP EDITION", $body, $gray, 20, 274)
$output = Join-Path $PSScriptRoot '../frontend/src-tauri/icons/installer-sidebar.bmp'
$bitmap.Save([System.IO.Path]::GetFullPath($output), [System.Drawing.Imaging.ImageFormat]::Bmp)
$graphics.Dispose()
$bitmap.Dispose()
$pink.Dispose()
$gray.Dispose()
$title.Dispose()
$body.Dispose()
