@echo off
setlocal
rem Register PDF Studio as the .pdf handler for the CURRENT USER only (HKCU).
rem Use --dry to just print the generated .reg file without touching the registry.

set "APP=%~dp0"
set "APP=%APP:~0,-1%"
set "EXE=%APP%\node_modules\electron\dist\electron.exe"
set "REG=%TEMP%\pdf-studio-assoc.reg"

if not exist "%EXE%" (
  echo [ERROR] Electron runtime not found:
  echo   %EXE%
  echo Please run: npm install
  pause
  exit /b 1
)

set "E=%EXE:\=\\%"
set "A=%APP:\=\\%"

>  "%REG%" echo Windows Registry Editor Version 5.00
>> "%REG%" echo.
>> "%REG%" echo [HKEY_CURRENT_USER\Software\Classes\pdfstudio.pdf]
>> "%REG%" echo @="PDF Studio Document"
>> "%REG%" echo.
>> "%REG%" echo [HKEY_CURRENT_USER\Software\Classes\pdfstudio.pdf\DefaultIcon]
>> "%REG%" echo @="\"%E%\",0"
>> "%REG%" echo.
>> "%REG%" echo [HKEY_CURRENT_USER\Software\Classes\pdfstudio.pdf\shell\open\command]
>> "%REG%" echo @="\"%E%\" \"%A%\" \"%%1\""
>> "%REG%" echo.
>> "%REG%" echo [HKEY_CURRENT_USER\Software\Classes\.pdf\OpenWithProgids]
>> "%REG%" echo "pdfstudio.pdf"=""
>> "%REG%" echo.
>> "%REG%" echo [HKEY_CURRENT_USER\Software\Classes\.pdf]
>> "%REG%" echo @="pdfstudio.pdf"
>> "%REG%" echo.

if /I "%~1"=="--dry" (
  type "%REG%"
  exit /b 0
)

set "BK=%APPDATA%\pdf-studio-assoc"
if not exist "%BK%" mkdir "%BK%" >nul 2>&1
if exist "%BK%\pdf-before.reg" del "%BK%\pdf-before.reg" >nul 2>&1
if exist "%BK%\no-before.txt" del "%BK%\no-before.txt" >nul 2>&1
reg export "HKCU\Software\Classes\.pdf" "%BK%\pdf-before.reg" /y >nul 2>&1
if errorlevel 1 echo. > "%BK%\no-before.txt"

reg import "%REG%" >nul
if errorlevel 1 (
  echo [ERROR] Registry import failed. Try running as the same user, or import manually:
  echo   %REG%
  pause
  exit /b 1
)

echo [OK] PDF Studio is now the .pdf handler for this user.
echo If double-click still opens another app, right-click a .pdf ^> Open with ^>
echo Choose another app ^> PDF Studio ^> Always.
echo Run unassociate.cmd to restore the previous association.
pause
endlocal
