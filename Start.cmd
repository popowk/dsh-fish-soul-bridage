@echo off
setlocal EnableExtensions DisableDelayedExpansion
pushd "%~dp0" || exit /b 1
title dsh-fish-soul-bridage v1.0.0
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Start-All.ps1"
set "code=%ERRORLEVEL%"
if not "%code%"=="0" (
  echo.
  echo [ERROR] Startup failed with exit code %code%.
  pause
)
popd
exit /b %code%
