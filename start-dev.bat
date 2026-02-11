@echo off
echo Starting Boat Ticket App Development Servers...
echo.

cd /d "%~dp0"

echo Starting backend server on port 3001 and frontend server on port 5173...
echo.
npm run dev

pause