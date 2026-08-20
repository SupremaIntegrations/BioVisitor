@echo off
setlocal EnableDelayedExpansion
chcp 65001 > nul

:: ============================================================
::  Suprema LATAM BioVisitor — Instalador de Servicios Windows
::
::  Servicios que instala:
::    "Suprema LATAM BioVisitor Service"   — API backend NestJS
::    "Suprema LATAM BioVisitor Web GUI"   — Frontend HTTPS Next.js
::
::  Herramienta: NSSM (Non-Sucking Service Manager)
::  Prerrequisitos:
::    - Ejecutar como Administrador
::    - nssm.exe descargado en {INSTALL_DIR}\tools\
::    - Node.js 24+ instalado
::    - Certificado SSL generado (script 1-generate-ssl.bat)
::    - {INSTALL_DIR}\backend\.env configurado
:: ============================================================

set "SVC_BACKEND=Suprema LATAM BioVisitor Service"
set "SVC_FRONTEND=Suprema LATAM BioVisitor Web GUI"
set "DEFAULT_DIR=%PROGRAMFILES%\SupremaLATAM\BioVisitor"

echo.
echo ╔═══════════════════════════════════════════════════════════╗
echo ║   Suprema LATAM BioVisitor — Instalador de Servicios     ║
echo ╚═══════════════════════════════════════════════════════════╝
echo.
echo Servicios a instalar:
echo   [1] !SVC_BACKEND!
echo   [2] !SVC_FRONTEND!
echo.

:: ---- Verificar Administrador ----
net session >nul 2>&1 || (
    echo [ERROR] Ejecutar como Administrador.
    pause & exit /b 1
)

:: ---- Directorio de instalacion ----
set /p INSTALL_DIR="Directorio de instalacion [default: !DEFAULT_DIR!]: "
if "!INSTALL_DIR!"=="" set "INSTALL_DIR=!DEFAULT_DIR!"

echo.
echo Usando directorio: !INSTALL_DIR!

:: ---- Detectar NSSM ----
set NSSM=
where nssm >nul 2>&1 && set NSSM=nssm
if "!NSSM!"=="" if exist "!INSTALL_DIR!\tools\nssm.exe" set "NSSM=!INSTALL_DIR!\tools\nssm.exe"
if "!NSSM!"=="" (
    echo [ERROR] nssm.exe no encontrado.
    echo Descarga NSSM en https://nssm.cc/download
    echo y coloca nssm.exe en: !INSTALL_DIR!\tools\nssm.exe
    pause & exit /b 1
)
echo [OK] NSSM: !NSSM!

:: ---- Detectar Node.js ----
set NODE_EXE=
for /f "tokens=*" %%i in ('where node 2^>nul') do set NODE_EXE=%%i
if "!NODE_EXE!"=="" (
    echo [ERROR] node.exe no encontrado. Instala Node.js 24 LTS: https://nodejs.org
    pause & exit /b 1
)
echo [OK] Node.js: !NODE_EXE!

:: ---- Verificar archivos clave ----
if not exist "!INSTALL_DIR!\backend\biovisitor-backend.exe" (
    echo [ERROR] No encontrado: !INSTALL_DIR!\backend\biovisitor-backend.exe
    pause & exit /b 1
)
if not exist "!INSTALL_DIR!\frontend\server-https.js" (
    echo [ERROR] No encontrado: !INSTALL_DIR!\frontend\server-https.js
    echo Copia windows-deployment\assets\server-https.js a esa carpeta primero.
    pause & exit /b 1
)
if not exist "!INSTALL_DIR!\frontend\cert\server.crt" (
    echo [ERROR] Certificado SSL no encontrado.
    echo Ejecuta primero: 1-generate-ssl.bat
    pause & exit /b 1
)
if not exist "!INSTALL_DIR!\backend\.env" (
    echo [ERROR] !INSTALL_DIR!\backend\.env no encontrado.
    echo Copia config\backend.env.example a esa ruta y edita las variables.
    pause & exit /b 1
)

:: ---- Crear directorios de logs ----
if not exist "!INSTALL_DIR!\logs\backend"  mkdir "!INSTALL_DIR!\logs\backend"
if not exist "!INSTALL_DIR!\logs\frontend" mkdir "!INSTALL_DIR!\logs\frontend"

:: ============================================================
::  Servicio 1: "Suprema LATAM BioVisitor Service" (Backend)
:: ============================================================
echo.
echo [1/2] Instalando "!SVC_BACKEND!"...

"!NSSM!" stop   "!SVC_BACKEND!" >nul 2>&1
"!NSSM!" remove "!SVC_BACKEND!" confirm >nul 2>&1

"!NSSM!" install "!SVC_BACKEND!" "!INSTALL_DIR!\backend\biovisitor-backend.exe"
"!NSSM!" set "!SVC_BACKEND!" AppDirectory           "!INSTALL_DIR!\backend"
"!NSSM!" set "!SVC_BACKEND!" DisplayName            "Suprema LATAM BioVisitor Service"
"!NSSM!" set "!SVC_BACKEND!" Description            "API Backend de BioVisitor X — Suprema LATAM"
"!NSSM!" set "!SVC_BACKEND!" Start                  SERVICE_AUTO_START
"!NSSM!" set "!SVC_BACKEND!" AppStdout              "!INSTALL_DIR!\logs\backend\backend.log"
"!NSSM!" set "!SVC_BACKEND!" AppStderr              "!INSTALL_DIR!\logs\backend\backend-error.log"
"!NSSM!" set "!SVC_BACKEND!" AppStdoutCreationDisposition OPEN_ALWAYS
"!NSSM!" set "!SVC_BACKEND!" AppStderrCreationDisposition OPEN_ALWAYS
"!NSSM!" set "!SVC_BACKEND!" AppRotateFiles         1
"!NSSM!" set "!SVC_BACKEND!" AppRotateOnline        1
"!NSSM!" set "!SVC_BACKEND!" AppRotateBytes         10485760
"!NSSM!" set "!SVC_BACKEND!" AppRestartDelay        3000
"!NSSM!" set "!SVC_BACKEND!" AppThrottle            5000

echo [OK] "!SVC_BACKEND!" instalado.

:: ============================================================
::  Servicio 2: "Suprema LATAM BioVisitor Web GUI" (Frontend)
:: ============================================================
echo.
echo [2/2] Instalando "!SVC_FRONTEND!"...

"!NSSM!" stop   "!SVC_FRONTEND!" >nul 2>&1
"!NSSM!" remove "!SVC_FRONTEND!" confirm >nul 2>&1

"!NSSM!" install "!SVC_FRONTEND!" "!NODE_EXE!"
"!NSSM!" set "!SVC_FRONTEND!" AppParameters          "server-https.js"
"!NSSM!" set "!SVC_FRONTEND!" AppDirectory           "!INSTALL_DIR!\frontend"
"!NSSM!" set "!SVC_FRONTEND!" DisplayName            "Suprema LATAM BioVisitor Web GUI"
"!NSSM!" set "!SVC_FRONTEND!" Description            "Interfaz Web HTTPS de BioVisitor X — Suprema LATAM"
"!NSSM!" set "!SVC_FRONTEND!" Start                  SERVICE_AUTO_START
"!NSSM!" set "!SVC_FRONTEND!" AppEnvironmentExtra    "NODE_ENV=production" "NEXT_PUBLIC_API_URL=/api/v1" "PORT=443" "HTTP_PORT=80" "NEXT_INTERNAL_PORT=3000"
"!NSSM!" set "!SVC_FRONTEND!" AppStdout              "!INSTALL_DIR!\logs\frontend\frontend.log"
"!NSSM!" set "!SVC_FRONTEND!" AppStderr              "!INSTALL_DIR!\logs\frontend\frontend-error.log"
"!NSSM!" set "!SVC_FRONTEND!" AppStdoutCreationDisposition OPEN_ALWAYS
"!NSSM!" set "!SVC_FRONTEND!" AppStderrCreationDisposition OPEN_ALWAYS
"!NSSM!" set "!SVC_FRONTEND!" AppRotateFiles         1
"!NSSM!" set "!SVC_FRONTEND!" AppRotateOnline        1
"!NSSM!" set "!SVC_FRONTEND!" AppRotateBytes         10485760
"!NSSM!" set "!SVC_FRONTEND!" AppRestartDelay        5000
"!NSSM!" set "!SVC_FRONTEND!" AppThrottle            10000
"!NSSM!" set "!SVC_FRONTEND!" DependOnService        "!SVC_BACKEND!"

echo [OK] "!SVC_FRONTEND!" instalado.

:: ---- Windows Firewall ----
echo.
echo Configurando firewall...
netsh advfirewall firewall delete rule name="BioVisitor HTTPS" >nul 2>&1
netsh advfirewall firewall delete rule name="BioVisitor HTTP"  >nul 2>&1
netsh advfirewall firewall add rule name="BioVisitor HTTPS" dir=in action=allow protocol=TCP localport=443 >nul
netsh advfirewall firewall add rule name="BioVisitor HTTP"  dir=in action=allow protocol=TCP localport=80  >nul
echo [OK] Puertos 80 y 443 abiertos.

echo.
echo ╔═══════════════════════════════════════════════════════════════╗
echo ║  Servicios instalados correctamente                           ║
echo ╠═══════════════════════════════════════════════════════════════╣
echo ║  "Suprema LATAM BioVisitor Service"    → localhost:3001       ║
echo ║  "Suprema LATAM BioVisitor Web GUI"    → HTTPS :443 / :80     ║
echo ╚═══════════════════════════════════════════════════════════════╝
echo.
echo Siguiente paso: 3-start-all.bat
pause
