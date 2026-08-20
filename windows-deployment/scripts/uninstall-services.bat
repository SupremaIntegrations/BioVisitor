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
echo ADVERTENCIA: Se eliminaran los servicios de Windows de BioVisitor X.
echo Los archivos, base de datos y configuracion NO seran eliminados.
echo.
set /p CONFIRM="Escribe CONFIRMAR para continuar: "
if /i not "!CONFIRM!"=="CONFIRMAR" (echo Cancelado. & pause & exit /b 0)

echo.
"!NSSM!" stop   "!SVC_FRONTEND!" >nul 2>&1
"!NSSM!" remove "!SVC_FRONTEND!" confirm
"!NSSM!" stop   "!SVC_BACKEND!"  >nul 2>&1
"!NSSM!" remove "!SVC_BACKEND!"  confirm

netsh advfirewall firewall delete rule name="BioVisitor HTTPS" >nul 2>&1
netsh advfirewall firewall delete rule name="BioVisitor HTTP"  >nul 2>&1

echo [OK] Servicios eliminados y reglas de firewall removidas.
pause
