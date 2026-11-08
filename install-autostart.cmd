@echo off
rem Starts NanoSoft Billing automatically when Windows starts (runs hidden, as SYSTEM).
rem Run this file as Administrator. To remove:  schtasks /delete /tn "NanoSoft Billing" /f
cd /d "%~dp0"
schtasks /create /tn "NanoSoft Billing" /sc onstart /ru SYSTEM /rl HIGHEST /f /tr "cmd /c cd /d \"%~dp0\" && node server\index.js >> server.log 2>&1"
if errorlevel 1 ( echo Failed - right-click this file and choose Run as administrator. ) else ( echo Done. It will start at the next boot. To start now: schtasks /run /tn "NanoSoft Billing" )
pause
