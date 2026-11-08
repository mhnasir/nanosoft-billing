@echo off
setlocal
cd /d "%~dp0"
echo === NanoSoft Billing setup ===

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed. Install the LTS version from https://nodejs.org then run setup.cmd again.
  pause
  exit /b 1
)

echo Installing packages...
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 ( echo npm install failed. & pause & exit /b 1 )

if not exist dist\index.html (
  echo The "dist" folder is missing - building the web app...
  call npm install --no-audit --no-fund
  call npm run build
  if errorlevel 1 ( echo Build failed. & pause & exit /b 1 )
)

call node scripts\init-env.js

echo.
echo Next:
echo   1. Open .env in Notepad (the defaults match the Docker database; change PG_PASSWORD for real use).
echo   1b. Run   docker compose up -d db     to start PostgreSQL in Docker.
echo   2. Run   npm run db:init     to create the database and tables.
echo   3. Run   export-from-mssql.cmd  then  npm run import   to bring over your old NVS data (one time).
echo   4. Run   start.cmd
pause
