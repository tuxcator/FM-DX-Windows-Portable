@echo off
setlocal
title Actualizar FM-DX desde GitHub
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Update-From-GitHub.ps1" %*
set "FM_DX_UPDATE_EXIT=%ERRORLEVEL%"
pause
exit /b %FM_DX_UPDATE_EXIT%