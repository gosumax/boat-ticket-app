@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0" >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Failed to enter project directory.
  echo.
  if not defined NO_PAUSE pause
  exit /b 1
)

echo [START] Boat Ticket App one-click dev start
echo.

if not exist ".env" (
  echo [ERROR] .env file is missing in the project root.
  echo [HINT] Add these required keys:
  echo        TELEGRAM_BOT_TOKEN
  echo        TELEGRAM_WEBHOOK_SECRET_TOKEN
  echo        TELEGRAM_PUBLIC_BASE_URL
  echo.
  if not defined NO_PAUSE pause
  exit /b 1
)

set "MISSING_ENV="
findstr /R /C:"^TELEGRAM_BOT_TOKEN=.*" ".env" >nul || set "MISSING_ENV=!MISSING_ENV! TELEGRAM_BOT_TOKEN"
findstr /R /C:"^TELEGRAM_WEBHOOK_SECRET_TOKEN=.*" ".env" >nul || set "MISSING_ENV=!MISSING_ENV! TELEGRAM_WEBHOOK_SECRET_TOKEN"
findstr /R /C:"^TELEGRAM_PUBLIC_BASE_URL=https://.*" ".env" >nul || set "MISSING_ENV=!MISSING_ENV! TELEGRAM_PUBLIC_BASE_URL(https://...)"

if defined MISSING_ENV (
  echo [ERROR] Missing or invalid required Telegram keys in .env:
  echo        !MISSING_ENV!
  echo [HINT] TELEGRAM_PUBLIC_BASE_URL must start with https://
  echo.
  if not defined NO_PAUSE pause
  exit /b 1
)

echo [CHECK] Releasing stale node listeners on ports 3001 and 5173 (if any)...
call :free_port 3001
if errorlevel 2 goto :non_node_blocker
call :free_port 5173
if errorlevel 2 goto :non_node_blocker

echo.
echo [START] Launching frontend + backend + Telegram runtime...
echo.
npm run dev
set "DEV_EXIT_CODE=%ERRORLEVEL%"

echo.
if %DEV_EXIT_CODE% neq 0 (
  echo [ERROR] Dev startup failed with exit code %DEV_EXIT_CODE%.
  echo [HINT] Review logs above and run start-dev.bat again.
) else (
  echo [INFO] Dev startup finished.
)
echo.
if not defined NO_PAUSE pause
exit /b %DEV_EXIT_CODE%

:non_node_blocker
echo [ERROR] Required dev port is busy by a non-node process.
echo [HINT] Stop that process and run start-dev.bat again.
echo.
if not defined NO_PAUSE pause
exit /b 1

:free_port
set "TARGET_PORT=%~1"
set "HAS_NON_NODE_BLOCKER="
set "SEEN_PIDS=;"

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%TARGET_PORT% .*LISTENING"') do (
  if "!SEEN_PIDS:;%%P;=!"=="!SEEN_PIDS!" (
    set "SEEN_PIDS=!SEEN_PIDS!%%P;"
    set "PROCESS_NAME="
    for /f "tokens=1 delims=," %%N in ('tasklist /FI "PID eq %%P" /FO CSV /NH') do (
      set "PROCESS_NAME=%%~N"
    )

    if /I "!PROCESS_NAME!"=="node.exe" (
      taskkill /PID %%P /T /F >nul 2>nul
      echo [PORT] freed %TARGET_PORT% ^(node PID %%P^)
    ) else (
      if /I "!PROCESS_NAME:~-4!"==".exe" (
        set "HAS_NON_NODE_BLOCKER=1"
        echo [PORT] blocked %TARGET_PORT% by !PROCESS_NAME! ^(PID %%P^)
      )
    )
  )
)

if defined HAS_NON_NODE_BLOCKER exit /b 2
exit /b 0
