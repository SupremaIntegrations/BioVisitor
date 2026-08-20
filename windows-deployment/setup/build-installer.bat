@echo off
setlocal EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
set "WD_DIR=%SCRIPT_DIR%.."
set "REPO_DIR=%WD_DIR%\.."

echo.
echo ==============================================================
echo   BioVisitor X - Build Installer - Suprema LATAM
echo ==============================================================
echo.

REM ---------------------------------------------------------------
REM 1. Find Inno Setup 7
REM    Use intermediate variables so CMD does not mistake the ")"
REM    in "Program Files (x86)" as a closing parenthesis token.
REM ---------------------------------------------------------------
set "ISCC="
set "_P1=C:\Program Files (x86)\Inno Setup 7\iscc.exe"
set "_P2=C:\Program Files\Inno Setup 7\iscc.exe"
if exist "!_P1!" set "ISCC=!_P1!"
if exist "!_P2!" set "ISCC=!_P2!"

if not defined ISCC (
  echo [ERROR] Inno Setup 7 not found.
  echo Download it from: https://jrsoftware.org/isdownload.php
  echo Then run this script again.
  pause
  exit /b 1
)
echo [OK] Inno Setup: !ISCC!

REM ---------------------------------------------------------------
REM 2. Check Node.js
REM ---------------------------------------------------------------
call node --version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH.
  echo Install Node.js 24 LTS from: https://nodejs.org
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('call node --version') do echo [OK] Node.js: %%v

REM ---------------------------------------------------------------
REM 3. pkg is installed as a devDependency of biovisitor-backend and
REM    is invoked via "npx @yao-pkg/pkg" below (step 8), so no global
REM    install is required.
REM ---------------------------------------------------------------

REM ---------------------------------------------------------------
REM 5. Check nssm.exe
REM ---------------------------------------------------------------
if not exist "%WD_DIR%\tools\nssm.exe" (
  echo [ERROR] Not found: windows-deployment\tools\nssm.exe
  echo Download NSSM from https://nssm.cc/download
  echo Extract win64\nssm.exe and place it in tools\
  pause
  exit /b 1
)
echo [OK] nssm.exe found.

REM ---------------------------------------------------------------
REM 6. Check redistributables
REM ---------------------------------------------------------------
set "MISSING=0"

if not exist "%WD_DIR%\redist\postgresql-16.14-2-windows-x64.exe" (
  echo [WARN] MISSING: redist\postgresql-16.14-2-windows-x64.exe
  set "MISSING=1"
)
if not exist "%WD_DIR%\redist\Redis-x64-5.0.14.1.msi" (
  echo [WARN] MISSING: redist\Redis-x64-5.0.14.1.msi
  set "MISSING=1"
)
if not exist "%WD_DIR%\redist\node-v24.19.0-x64.msi" (
  echo [INFO] OPTIONAL: redist\node-v24.19.0-x64.msi not found
)

if "!MISSING!"=="1" (
  echo.
  echo Some redistributables are missing. Run download-all.ps1 first.
  set /p "CONT=Continue anyway? (Y/N): "
  if /i not "!CONT!"=="Y" (
    pause
    exit /b 1
  )
)

REM ---------------------------------------------------------------
REM 7. Create output directory
REM ---------------------------------------------------------------
if not exist "%WD_DIR%\output" mkdir "%WD_DIR%\output"

REM ---------------------------------------------------------------
REM 8. Build Backend (NestJS -> .exe via pkg)
REM ---------------------------------------------------------------
echo.
echo [1/3] Building NestJS backend...
echo -------------------------------------------------------

pushd "%REPO_DIR%\biovisitor-backend"

if exist "biovisitor-backend.exe" (
  echo [OK] biovisitor-backend.exe ya existe en biovisitor-backend\ — se usara tal cual.
  echo      Borra ese archivo primero si quieres forzar una recompilacion.
  goto :backend_done
)

if exist "release\biovisitor-backend.exe" (
  echo [OK] Se encontro release\biovisitor-backend.exe de una compilacion previa.
  echo      Copiando a biovisitor-backend.exe en vez de recompilar...
  copy /Y "release\biovisitor-backend.exe" "biovisitor-backend.exe" >nul
  if errorlevel 1 (
    echo [ERROR] No se pudo copiar release\biovisitor-backend.exe.
    popd
    pause
    exit /b 1
  )
  goto :backend_done
)

if not exist "node_modules\.bin\nest.cmd" (
  echo Installing backend dependencies...
  echo This may take 10-20 minutes on first run. Please wait.
  call npm install --legacy-peer-deps --no-fund --no-audit --prefer-offline
  if errorlevel 1 (
    echo [WARN] prefer-offline failed, retrying with network...
    call npm install --legacy-peer-deps --no-fund --no-audit
    if errorlevel 1 (
      echo [ERROR] npm install failed for backend.
      popd
      pause
      exit /b 1
    )
  )
) else (
  echo [OK] Backend node_modules already installed, skipping.
)

echo Compiling TypeScript via local NestJS CLI...
call node_modules\.bin\nest.cmd build
if errorlevel 1 (
  echo [ERROR] TypeScript compilation failed.
  popd
  pause
  exit /b 1
)

echo Packaging to biovisitor-backend.exe...
call npx @yao-pkg/pkg dist/main.js -c package.json --target node24-win-x64 --output biovisitor-backend.exe
if errorlevel 1 (
  echo [ERROR] pkg packaging failed.
  popd
  pause
  exit /b 1
)

:backend_done
echo [OK] biovisitor-backend.exe listo.
popd

REM ---------------------------------------------------------------
REM 9. Build Frontend (Next.js standalone)
REM ---------------------------------------------------------------
echo.
echo [2/3] Building Next.js frontend...
echo -------------------------------------------------------

pushd "%REPO_DIR%\biovisitor-frontend"

if exist ".next\standalone\server.js" (
  echo [OK] .next\standalone ya existe — se usara tal cual, sin recompilar.
  echo      Borra la carpeta .next\standalone primero si quieres forzar una recompilacion.
  goto :frontend_static_check
)

if not exist "node_modules\.bin\next.cmd" (
  echo Installing frontend dependencies...
  echo This may take 10-20 minutes on first run. Please wait.
  call npm install --legacy-peer-deps --no-fund --no-audit --prefer-offline
  if errorlevel 1 (
    echo [WARN] prefer-offline failed, retrying with network...
    call npm install --legacy-peer-deps --no-fund --no-audit
    if errorlevel 1 (
      echo [ERROR] npm install failed for frontend.
      popd
      pause
      exit /b 1
    )
  )
) else (
  echo [OK] Frontend node_modules already installed, skipping.
)

set "NODE_ENV=production"
call npm run build
if errorlevel 1 (
  echo [ERROR] next build failed.
  popd
  pause
  exit /b 1
)

if not exist ".next\standalone" (
  echo [ERROR] .next\standalone was not created.
  echo Verify that next.config.ts contains: output: 'standalone'
  popd
  pause
  exit /b 1
)

:frontend_static_check
if not exist ".next\standalone\public" (
  xcopy /E /I /Q "public" ".next\standalone\public" >nul
)
if not exist ".next\standalone\.next\static" (
  xcopy /E /I /Q ".next\static" ".next\standalone\.next\static" >nul
)

echo [OK] Frontend standalone ready.
popd

REM ---------------------------------------------------------------
REM 10. Compile Inno Setup installer
REM ---------------------------------------------------------------
echo.
echo [3/3] Compiling installer with Inno Setup 7...
echo -------------------------------------------------------

"!ISCC!" "%SCRIPT_DIR%biovisitor-setup.iss" /O"%WD_DIR%\output"
if errorlevel 1 (
  echo [ERROR] Inno Setup compilation failed.
  pause
  exit /b 1
)

echo.
echo ==============================================================
echo   BUILD COMPLETE
echo   Output: windows-deployment\output\BioVisitorX-Setup-1.0.0.exe
echo ==============================================================
echo.

explorer "%WD_DIR%\output"
pause
endlocal
