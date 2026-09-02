$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Push-Location $Root
try {
  Push-Location backend
  node scripts/check-syntax.js
  node --test test-node/*.test.mjs
  Pop-Location
  Push-Location frontend
  node --test src/i18n/i18n.test.mjs
  Pop-Location
  node scripts/core-smoke-test.mjs
  node scripts/reliability-regression-test.mjs
  node --test updater/test/*.test.js
  if ($env:QUALITY_GATE_FULL -eq "1") {
    Push-Location backend
    npm ci
    npm test
    npm run lint
    Pop-Location
    Push-Location frontend
    npm ci
    npm test
    npm run lint
    npm run build
    Pop-Location
  } else {
    Write-Host "Vollstaendige npm-Pruefung uebersprungen. Setzen Sie QUALITY_GATE_FULL=1."
  }
} finally {
  Pop-Location
}
