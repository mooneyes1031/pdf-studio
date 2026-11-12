@echo off
setlocal
cd /d "%~dp0"
rem One-shot publish to GitHub. All console text is ASCII to avoid cmd codepage issues.
rem Chinese walkthrough: README.md -> "Ñ0 GitHub".

echo ============================================================
echo  PDF Studio - publish to GitHub
echo ============================================================
echo.

if /I "%~1"=="--dry" (
  echo [DRY] Preview only. Nothing will be written or pushed.
  node build\prepare-publish.cjs --dry
  echo.
  echo [DRY] Planned steps:
  echo   1. gh auth status
  echo   2. fill product.config.json + replace doc placeholders + commit
  echo   3. create public repo ^<owner^>/pdf-studio and push main
  echo   4. push tag v1.0.0 to trigger .github/workflows/release.yml
  echo   5. enable GitHub Pages (main / docs)
  exit /b 0
)

echo [1/5] Checking GitHub CLI and login ...
where gh >nul 2>&1
if errorlevel 1 (
  echo [ERROR] GitHub CLI not found. Install: https://cli.github.com/
  pause
  exit /b 1
)
gh auth status >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Not logged in. Run this first:
  echo     gh auth login
  pause
  exit /b 1
)
echo       OK

echo [2/5] Filling publish info and committing ...
node build\prepare-publish.cjs --prepare
if errorlevel 1 (
  echo [ERROR] prepare-publish failed, stopped before pushing.
  pause
  exit /b 1
)
for /f "usebackq delims=" %%i in (`node -p "require('./product.config.json').repository"`) do set "REPO=%%i"
echo       Repository: %REPO%

echo [3/5] Creating public repository and pushing main ...
gh repo view "%REPO%" >nul 2>&1
if errorlevel 1 (
  gh repo create "%REPO%" --public --source=. --remote=origin --push
) else (
  git remote get-url origin >nul 2>&1
  if errorlevel 1 git remote add origin "https://github.com/%REPO%.git"
  git push -u origin main
)
if errorlevel 1 (
  echo [ERROR] Push failed. Check the output above.
  pause
  exit /b 1
)
echo       OK

echo [4/5] Pushing tag v1.0.0 (triggers Release build) ...
git rev-parse "v1.0.0" >nul 2>&1
if errorlevel 1 git tag "v1.0.0"
git push origin "v1.0.0"
if errorlevel 1 (
  echo [WARN] Tag push failed. You can retry: git push origin v1.0.0
) else (
  echo       OK
)

echo [5/5] Enabling GitHub Pages ...
gh api --method POST "repos/%REPO%/pages" -f "source[branch]=main" -f "source[path]=/docs" >nul 2>&1
if errorlevel 1 (
  echo       [SKIP] Enable manually: Settings -^> Pages -^> main / docs
) else (
  echo       OK
)

echo.
echo ============================================================
echo  Done.
echo   Repo     : https://github.com/%REPO%
echo   Release  : https://github.com/%REPO%/releases/tag/v1.0.0
echo   Build log: https://github.com/%REPO%/actions
echo   Site     : https://github.com/%REPO%/settings/pages
echo.
echo  The Windows release build takes a few minutes. The Release
echo  page will contain the NSIS installer, portable exe and the
echo  two optional file-association scripts.
echo ============================================================
pause
endlocal
