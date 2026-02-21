@echo off
chcp 65001 >nul
cd /d "d:\Проэкты\МОре\boat-ticket-app"
npx vitest run tests/owner/20-owner-settings-contract.test.js tests/owner/21-motivation-day-snapshot.test.js tests/owner/22-motivation-mode-points-gating.test.js tests/owner/23-adaptive-recalc-parameters.test.js tests/owner/24-streak-calibration.test.js --reporter=verbose
