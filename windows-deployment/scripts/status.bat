@echo off
setlocal EnableDelayedExpansion
chcp 65001 > nul

set "SVC_BACKEND=Suprema LATAM BioVisitor Service"
set "SVC_FRONTEND=Suprema LATAM BioVisitor Web GUI"

set NSSM=nssm
where nssm >nul 2>&1 || (
    for /f "tokens=*" %%i in ('dir /s /b "%PROGRAMFILES%\SupremaLATAM\BioVisitor\tools\nssm.exe" 2^>nul') do set NSSM=%%i
)

echo.
echo ════ Estado de BioVisitor X ════════════════════════════
echo.
echo [Backend]  !SVC_BACKEND!:
"!NSSM!" status "!SVC_BACKEND!"
echo.
echo [Frontend] !SVC_FRONTEND!:
"!NSSM!" status "!SVC_FRONTEND!"
echo.
pause
