#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[1/7] Backend-Syntax"
(cd backend && node scripts/check-syntax.js)

echo "[2/7] Kritische dependency-freie Tests und Lokalisierung"
(cd backend && node --test test-node/*.test.mjs)
(cd frontend && node --test src/i18n/*.test.mjs)

echo "[3/7] Core-Smoke-Test"
node scripts/core-smoke-test.mjs

echo "[4/7] Reliability-Regression"
node scripts/reliability-regression-test.mjs

echo "[5/7] Updater-Regression"
node --test updater/test/*.test.js

if [[ "${QUALITY_GATE_FULL:-0}" == "1" ]]; then
  echo "[6/7] Backend npm ci, Tests und Lint"
  (cd backend && npm ci && npm test && npm run lint)
  echo "[7/7] Frontend npm ci, Tests, Lint und Build"
  (cd frontend && npm ci && npm test && npm run lint && npm run build)
else
  echo "[6/7] Vollstaendige npm-Pruefung uebersprungen (QUALITY_GATE_FULL=1 aktiviert sie)."
  echo "[7/7] Quality Gate abgeschlossen."
fi
