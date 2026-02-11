Write-Host "Starting Boat Ticket App Development Servers..." -ForegroundColor Green
Write-Host ""

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -Path $ScriptDir

Write-Host "Starting backend server on port 3001 and frontend server on port 5173..." -ForegroundColor Yellow
Write-Host ""
npm run dev