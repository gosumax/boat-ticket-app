@echo off
chcp 65001 >nul
cd /d "d:\Проэкты\МОре\boat-ticket-app"
echo Running test: tests/server/selling-delete-guard.test.js
npx vitest run tests/server/selling-delete-guard.test.js --reporter=verbose
echo Test completed with exit code: %ERRORLEVEL%
