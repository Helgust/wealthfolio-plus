# Запуск форка в режиме разработки аддонов: dev-сервер аддона (отдельное окно) + Wealthfolio.
# Из корня репозитория: pwsh plus/scripts/dev.ps1
# Данные — в %APPDATA%\com.helgust.wealthfolio-plus.dev (см. plus/tauri.dev.conf.json).
$ErrorActionPreference = 'Stop'
$root = Resolve-Path "$PSScriptRoot/../.."
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"

# Остатки прошлого запуска держат порты и ломают новый.
Get-NetTCPConnection -LocalPort 1420, 3001 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

Start-Process pwsh -WorkingDirectory "$root/plus/addon" -ArgumentList '-NoExit', '-Command', 'pnpm dev:server'

# Wealthfolio ищет dev-сервер аддона только при старте — ждём, пока он ответит.
$deadline = (Get-Date).AddSeconds(60)
while ($true) {
  try { Invoke-WebRequest http://localhost:3001/health -UseBasicParsing -TimeoutSec 2 | Out-Null; break }
  catch {
    if ((Get-Date) -gt $deadline) { throw 'Dev-сервер аддона не поднялся на :3001 — смотри его окно.' }
    Start-Sleep 1
  }
}

Set-Location $root
$env:VITE_ENABLE_ADDON_DEV_MODE = 'true'
pnpm tauri dev --config plus/tauri.dev.conf.json
