# Checks that close a slice: addon tests and types, the Python reference tests and linter.
# From the repository root: pwsh plus/scripts/check.ps1
$ErrorActionPreference = 'Stop'
$root = Resolve-Path "$PSScriptRoot/../.."
$env:PYTHONIOENCODING = 'utf-8'
$failed = @()

function Step([string]$name, [string]$dir, [scriptblock]$command) {
  Write-Host "`n== $name" -ForegroundColor Cyan
  Push-Location $dir
  try {
    & $command
    if ($LASTEXITCODE -ne 0) { $script:failed += $name }
  } finally { Pop-Location }
}

Step 'addon: vitest' "$root/plus/addon" { pnpm test }
Step 'addon: tsc' "$root/plus/addon" { pnpm type-check }
Step 'python: pytest' "$root/plus/python" { .venv/Scripts/python -m pytest -q }
Step 'python: ruff' "$root/plus/python" { .venv/Scripts/python -m ruff check . }

if ($failed.Count -gt 0) {
  Write-Host "`nFailed: $($failed -join ', ')" -ForegroundColor Red
  exit 1
}
Write-Host "`nAll checks passed" -ForegroundColor Green
