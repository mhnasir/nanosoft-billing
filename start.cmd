@echo off
cd /d "%~dp0"
if not exist .env ( echo .env not found - run setup.cmd first. & pause & exit /b 1 )
if not exist node_modules ( echo Packages missing - run setup.cmd first. & pause & exit /b 1 )
echo Starting NanoSoft Billing...  (close this window to stop)
for /f "tokens=2 delims==" %%p in ('findstr /b "PORT=" .env') do set PORT_NUM=%%p
if "%PORT_NUM%"=="" set PORT_NUM=3000
start "" "http://localhost:%PORT_NUM%"
node server\index.js
pause
