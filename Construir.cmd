@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Build-Portable.ps1"
if errorlevel 1 (
  echo.
  echo La construccion fallo. Revise el mensaje anterior.
  pause
  exit /b 1
)
echo.
echo Construccion terminada.
pause
