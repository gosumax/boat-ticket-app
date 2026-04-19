@echo off
chcp 65001 >nul
setlocal

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
rem set "CLOUDFLARED_EXE=C:\tools\cloudflared\cloudflared.exe"
set "CLOUDFLARED_WAIT_SECONDS=60"
set "CLOUDFLARED_MAX_DISCOVERY_ATTEMPTS=3"
set "CLOUDFLARED_RETRY_DELAY_SECONDS=5"
set "TELEGRAM_BOT_TOKEN_VALUE=8662427941:AAHW5ws7URgZuJMH1BH0NO1mdc3w0PHmQco"
set "TELEGRAM_WEBHOOK_SECRET_TOKEN_VALUE=telegram_webhook_secret_test_2026_abc123"
set "MINI_APP_TEST_USER_ID=777123456"
set "MINI_APP_VERSION=live1"
set "LAUNCHER_HELPER=scripts\start-telegram-miniapp-live.cjs"

if not exist "%LAUNCHER_HELPER%" (
  echo [ERROR] Launcher helper not found: %LAUNCHER_HELPER%
  echo.
  if not defined NO_PAUSE pause
  exit /b 1
)

node.exe "%LAUNCHER_HELPER%"
set "LAUNCHER_EXIT_CODE=%ERRORLEVEL%"

echo.
if not defined NO_PAUSE pause
popd >nul
exit /b %LAUNCHER_EXIT_CODE%
