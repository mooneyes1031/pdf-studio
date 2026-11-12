@echo off
setlocal
rem Register PDF Studio as the .pdf handler for the CURRENT USER only (HKCU).
rem Put this script next to the portable .exe (or next to the win-unpacked folder).
rem Use --dry to print the generated .reg without touching the registry.
rem Undo with unassociate.cmd. Do NOT run as administrator.

set "BASE=%~dp0"
set "TARGET="
rem NSIS ‰ÅH,îUô¥1/ PDF Studio.exe
if exist "%BASE%PDF Studio.exe" set "TARGET=%BASE%PDF Studio.exe"
if not defined TARGET if exist "%BASE%win-unpacked\PDF Studio.exe" set "TARGET=%BASE%win-unpacked\PDF Studio.exe"
if not defined TARGET if exist "%BASE%PDF-Studio-1.0.0-portable.exe" set "TARGET=%BASE%PDF-Studio-1.0.0-portable.exe"
if not defined TARGET (
  echo [ERROR] PDF Studio executable not found next to this script.
  echo Keep this .cmd together with the portable .exe or the win-unpacked folder.
  pause
  exit /b 1
)

set "REG=%TEMP%\pdf-studio-assoc.reg"
set "E=%TARGET:\=\\%"

>  "%REG%" echo Windows Registry Editor Version 5.00
>> "%REG%" echo.
>> "%REG%" echo [HKEY_CURRENT_USER\Software\Classes\pdfstudio.pdf]
>> "%REG%" echo @="PDF Studio Document"
>> "%REG%" echo.
>> "%REG%" echo [HKEY_CURRENT_USER\Software\Classes\pdfstudio.pdf\DefaultIcon]
>> "%REG%" echo @="\"%E%\",0"
>> "%REG%" echo.
>> "%REG%" echo [HKEY_CURRENT_USER\Software\Classes\pdfstudio.pdf\shell\open\command]
>> "%REG%" echo @="\"%E%\" \"%%1\""
>> "%REG%" echo.
>> "%REG%" echo [HKEY_CURRENT_USER\Software\Classes\.pdf\OpenWithProgids]
>> "%REG%" echo "pdfstudio.pdf"=""
>> "%REG%" echo.
>> "%REG%" echo [HKEY_CURRENT_USER\Software\Classes\.pdf]
>> "%REG%" echo @="pdfstudio.pdf"
>> "%REG%" echo.

if /I "%~1"=="--dry" (
  echo TARGET=%TARGET%
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
  echo [ERROR] Registry import failed. Import manually:
  echo   %REG%
  pause
  exit /b 1
)

echo [OK] PDF Studio is now the .pdf handler for this user.
echo Target: %TARGET%
echo If double-click still opens another app: right-click a .pdf ^> Open with ^>
echo Choose another app ^> PDF Studio ^> Always.
echo Run unassociate.cmd to restore the previous association.
pause
endlocal
