@echo off
setlocal
set "APP=%~dp0."
set "EXE=%~dp0node_modules\electron\dist\electron.exe"
if not exist "%EXE%" (
  echo [ERROR] Electron runtime not found:
  echo   %EXE%
  echo Please run: npm install
  pause
  exit /b 1
)
if /I "%~1"=="--dry" (
  echo APP=%APP%
  echo EXE=%EXE%
  echo [OK] runtime resolved
  exit /b 0
)
start "" "%EXE%" "%APP%" %*
endlocal
