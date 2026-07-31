@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0scripts\Configure-RemotePasswords.ps1"
if errorlevel 1 pause