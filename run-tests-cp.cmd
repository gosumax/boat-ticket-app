@echo off
chcp 65001 >nul
echo Creating test directory...
if not exist "C:\temp\boat-tests\dispatcher" mkdir "C:\temp\boat-tests\dispatcher"
echo Copying test files...
copy "tests\dispatcher\*.js" "C:\temp\boat-tests\dispatcher\"
copy "vitest.config.js" "C:\temp\boat-tests\"
copy "package.json" "C:\temp\boat-tests\"
echo Listing copied files:
dir "C:\temp\boat-tests\dispatcher"
echo.
echo Running tests...
cd /d C:\temp\boat-tests
set NODE_ENV=test
set DB_FILE=:memory:
npx vitest run tests\dispatcher --reporter=verbose
