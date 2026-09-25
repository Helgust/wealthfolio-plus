# Runs the fork in addon dev mode: the addon dev server (separate window) + Wealthfolio.
# From the repository root: pwsh plus/scripts/dev.ps1
# Data lives in %APPDATA%\com.helgust.wealthfolio-plus.dev (see plus/tauri.dev.conf.json).
$ErrorActionPreference = 'Stop'
$root = Resolve-Path "$PSScriptRoot/../.."
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"

# Leftovers of a previous run hold the ports and break the new one.
Get-NetTCPConnection -LocalPort 1420, 3001 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

Start-Process pwsh -WorkingDirectory "$root/plus/addon" -ArgumentList '-NoExit', '-Command', 'pnpm dev:server'

# Wealthfolio looks for the addon dev server only at startup — wait until it answers.
$deadline = (Get-Date).AddSeconds(60)
while ($true) {
  try { Invoke-WebRequest http://localhost:3001/health -UseBasicParsing -TimeoutSec 2 | Out-Null; break }
  catch {
    if ((Get-Date) -gt $deadline) { throw 'Addon dev server did not start on :3001 — check its window.' }
    Start-Sleep 1
  }
}

Set-Location $root
$env:VITE_ENABLE_ADDON_DEV_MODE = 'true'
pnpm tauri dev --config plus/tauri.dev.conf.json
