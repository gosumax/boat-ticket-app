@echo off
cd /d D:\Проэкты\МОре\boat-ticket-app
set NODE_ENV=test
set DB_FILE=:memory:
npx vitest run tests/dispatcher --reporter=verbose
