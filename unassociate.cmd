@echo off
setlocal
rem Undo associate.cmd for the CURRENT USER only.

set "BK=%APPDATA%\pdf-studio-assoc"
reg delete "HKCU\Software\Classes\pdfstudio.pdf" /f >nul 2>&1

if exist "%BK%\pdf-before.reg" (
  reg import "%BK%\pdf-before.reg" >nul 2>&1
  reg delete "HKCU\Software\Classes\.pdf\OpenWithProgids" /v "pdfstudio.pdf" /f >nul 2>&1
  del "%BK%\pdf-before.reg" >nul 2>&1
  echo [OK] Previous .pdf association restored.
) else (
  reg delete "HKCU\Software\Classes\.pdf" /f >nul 2>&1
  if exist "%BK%\no-before.txt" del "%BK%\no-before.txt" >nul 2>&1
  echo [OK] PDF Studio .pdf association removed ^(system default now applies^).
)
pause
endlocal
