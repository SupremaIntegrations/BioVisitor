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

echo Deteniendo servicios de BioVisitor X...
"!NSSM!" stop "!SVC_FRONTEND!"
"!NSSM!" stop "!SVC_BACKEND!"
echo [OK] Servicios detenidos.
pause
