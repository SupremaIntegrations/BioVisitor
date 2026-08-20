@echo off
setlocal EnableDelayedExpansion
chcp 65001 > nul

set "SVC_BACKEND=Suprema LATAM BioVisitor Service"
set "SVC_FRONTEND=Suprema LATAM BioVisitor Web GUI"

net session >nul 2>&1 || (echo [ERROR] Ejecutar como Administrador. & pause & exit /b 1)

set NSSM=nssm
where nssm >nul 2>&1 || (
    for /f "tokens=*" %%i in ('dir /s /b "%PROGRAMFILES%\SupremaLATAM\BioVisitor\tools\nssm.exe" 2^>nul') do set NSSM=%%i
)

echo.
echo Iniciando servicios de BioVisitor X...
echo.
echo [1/2] !SVC_BACKEND!...
"!NSSM!" start "!SVC_BACKEND!"
timeout /t 5 /nobreak >nul

echo [2/2] !SVC_FRONTEND!...
"!NSSM!" start "!SVC_FRONTEND!"
timeout /t 8 /nobreak >nul

echo.
echo ---- Estado ----
"!NSSM!" status "!SVC_BACKEND!"
"!NSSM!" status "!SVC_FRONTEND!"

echo.
echo ╔════════════════════════════════════════════════════╗
echo ║  BioVisitor X disponible en:                       ║
echo ║  https://[IP-DEL-SERVIDOR]                         ║
echo ╚════════════════════════════════════════════════════╝
echo.
pause
