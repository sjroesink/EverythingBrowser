#!/usr/bin/env pwsh
# EverythingBrowser installer for Windows
# Usage: irm https://everythingbrowser.roesink.dev/install.ps1 | iex

$ErrorActionPreference = "Stop"
$repo = "sjroesink/EverythingBrowser"
$name = "EverythingBrowser"

Write-Host ""
Write-Host "  Installing $name..." -ForegroundColor Cyan
Write-Host ""

$release = Invoke-RestMethod `
  -Uri "https://api.github.com/repos/$repo/releases/latest" `
  -Headers @{
    "Accept" = "application/vnd.github+json"
    "User-Agent" = "$name-Installer"
  }

$assets = @($release.assets)
if (-not $assets -or $assets.Count -eq 0) {
  throw "No release assets found."
}

$installer = $assets |
  Where-Object { $_.name -match "\.msi$" } |
  Select-Object -First 1

if (-not $installer) {
  $installer = $assets |
    Where-Object { $_.name -match "\.exe$" } |
    Select-Object -First 1
}

if (-not $installer) {
  throw "No Windows installer asset (.msi/.exe) found."
}

$targetPath = Join-Path $env:TEMP $installer.name

Write-Host "  Downloading $($installer.name)..." -ForegroundColor Gray
Invoke-WebRequest -Uri $installer.browser_download_url -OutFile $targetPath

Write-Host "  Running installer..." -ForegroundColor Gray
if ($targetPath.EndsWith(".msi")) {
  Start-Process "msiexec.exe" -ArgumentList "/i `"$targetPath`"" -Wait
} else {
  Start-Process -FilePath $targetPath -Wait
}

Write-Host ""
Write-Host "  $name installer finished." -ForegroundColor Green
Write-Host ""
