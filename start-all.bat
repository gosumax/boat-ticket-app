@echo off
chcp 65001 >nul
setlocal EnableExtensions

pushd "%~dp0" >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Failed to enter launcher directory.
  echo.
  if not defined NO_PAUSE pause
  exit /b 1
)

set "PROJECT_DIR=%CD%"
if exist "%LOCALAPPDATA%\cloudflared\cloudflared.exe" (
  set "CLOUDFLARED_EXE=%LOCALAPPDATA%\cloudflared\cloudflared.exe"
) else (
  set "CLOUDFLARED_EXE=cloudflared"
)

set "CLOUDFLARED_WAIT_SECONDS=60"
set "CLOUDFLARED_MAX_DISCOVERY_ATTEMPTS=3"
set "CLOUDFLARED_RETRY_DELAY_SECONDS=5"
rem Optional: set "MINI_APP_TEST_USER_ID=123456789"
set "UNIFIED_LAUNCHER_HELPER=scripts\start-unified-live.cjs"

if not exist "%UNIFIED_LAUNCHER_HELPER%" (
  echo [ERROR] Unified launcher helper not found: %UNIFIED_LAUNCHER_HELPER%
  echo.
  if not defined NO_PAUSE pause
  exit /b 1
)

node.exe "%UNIFIED_LAUNCHER_HELPER%"
set "LAUNCHER_EXIT_CODE=%ERRORLEVEL%"

echo.
if not defined NO_PAUSE pause
popd >nul
exit /b %LAUNCHER_EXIT_CODE%
