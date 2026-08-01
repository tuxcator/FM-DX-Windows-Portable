@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Update-GitHub.ps1" %*
set "FM_DX_EXIT=%ERRORLEVEL%"
pause
exit /b %FM_DX_EXIT%
