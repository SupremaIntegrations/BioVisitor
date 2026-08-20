@echo off
setlocal EnableDelayedExpansion
chcp 65001 > nul

:: ============================================================
::  Suprema LATAM BioVisitor — Generador de Certificado SSL
::  Empresa : Suprema LATAM
::  App     : BioVisitor
::  Vigencia: 7 años (2555 días)
::  Requiere: OpenSSL (Git for Windows lo incluye)
:: ============================================================

echo.
echo ╔═══════════════════════════════════════════════════════════╗
echo ║   Suprema LATAM BioVisitor — Generador de Certificado    ║
echo ╚═══════════════════════════════════════════════════════════╝
echo.

:: ---- Verificar Administrador ----
net session >nul 2>&1 || (
    echo [ERROR] Ejecutar como Administrador.
    pause & exit /b 1
)

:: ---- Detectar OpenSSL ----
set OPENSSL=
where openssl >nul 2>&1 && set OPENSSL=openssl
if "!OPENSSL!"=="" if exist "C:\Program Files\Git\usr\bin\openssl.exe" set "OPENSSL=C:\Program Files\Git\usr\bin\openssl.exe"
if "!OPENSSL!"=="" if exist "C:\Program Files\OpenSSL-Win64\bin\openssl.exe" set "OPENSSL=C:\Program Files\OpenSSL-Win64\bin\openssl.exe"
if "!OPENSSL!"=="" (
    echo [ERROR] OpenSSL no encontrado.
    echo Instala Git for Windows desde https://git-scm.com/download/win
    echo OpenSSL viene incluido con Git.
    pause & exit /b 1
)
echo [OK] OpenSSL: !OPENSSL!
echo.

:: ---- Directorio de instalacion ----
set "DEFAULT_DIR=%PROGRAMFILES%\SupremaLATAM\BioVisitor"
set /p INSTALL_DIR="Directorio de instalacion [default: !DEFAULT_DIR!]: "
if "!INSTALL_DIR!"=="" set "INSTALL_DIR=!DEFAULT_DIR!"

set "SSL_DIR=!INSTALL_DIR!\frontend\cert"
if not exist "!SSL_DIR!" mkdir "!SSL_DIR!"

:: ---- IP / Hostname del servidor ----
set /p SERVER_IP="IP o hostname del servidor [ej: 192.168.1.100]: "
if "!SERVER_IP!"=="" set SERVER_IP=localhost

:: ---- Codigo de pais ----
set /p COUNTRY="Codigo de pais ISO 2 letras [default: CO]: "
if "!COUNTRY!"=="" set COUNTRY=CO

echo.
echo Generando certificado SSL para: !SERVER_IP!
echo Empresa  : Suprema LATAM
echo App      : BioVisitor
echo Vigencia : 7 años (2555 dias)
echo Destino  : !SSL_DIR!
echo.

:: ---- Archivo de configuracion OpenSSL ----
set "CONF=%TEMP%\bvx_ssl.cnf"
(
echo [req]
echo default_bits       = 2048
echo default_md         = sha256
echo prompt             = no
echo distinguished_name = dn
echo x509_extensions    = v3_req
echo.
echo [dn]
echo C  = !COUNTRY!
echo ST = LATAM
echo L  = LATAM
echo O  = Suprema LATAM
echo OU = BioVisitor
echo CN = !SERVER_IP!
echo.
echo [v3_req]
echo subjectAltName = @alt_names
echo keyUsage = critical, digitalSignature, keyEncipherment
echo extendedKeyUsage = serverAuth
echo basicConstraints = CA:FALSE
echo.
echo [alt_names]
echo IP.1  = 127.0.0.1
echo DNS.1 = localhost
echo DNS.2 = !SERVER_IP!
) > "!CONF!"

:: Agregar IP o DNS segun el tipo de valor
echo !SERVER_IP! | findstr /r "^[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*$" >nul 2>&1
if !errorlevel! == 0 (
    echo IP.2 = !SERVER_IP! >> "!CONF!"
) else (
    echo DNS.3 = !SERVER_IP! >> "!CONF!"
)

:: ---- Generar clave privada y certificado ----
"!OPENSSL!" req -x509 -newkey rsa:2048 -sha256 -days 2555 ^
    -nodes ^
    -keyout "!SSL_DIR!\server.key" ^
    -out    "!SSL_DIR!\server.crt" ^
    -config "!CONF!" 2>&1

del "!CONF!" >nul 2>&1

if not exist "!SSL_DIR!\server.crt" (
    echo.
    echo [ERROR] Fallo la generacion del certificado. Revisa el output anterior.
    pause & exit /b 1
)

echo.
echo ╔═══════════════════════════════════════════════════════════════╗
echo ║  Certificado SSL generado correctamente                       ║
echo ╠═══════════════════════════════════════════════════════════════╣
echo ║  Clave privada : !SSL_DIR!\server.key
echo ║  Certificado   : !SSL_DIR!\server.crt
echo ║  Vigencia      : 7 años
echo ║  Empresa       : Suprema LATAM
echo ║  Aplicación    : BioVisitor
echo ╚═══════════════════════════════════════════════════════════════╝
echo.

:: ---- Importar al almacen de confianza de Windows ----
set /p IMPORT="Importar como CA de confianza en este equipo? (S/N): "
if /i "!IMPORT!"=="S" (
    certutil -addstore -f "Root" "!SSL_DIR!\server.crt" >nul 2>&1
    if !errorlevel! == 0 (
        echo [OK] Certificado importado — los navegadores de este equipo no mostraran advertencia.
    ) else (
        echo [WARN] Ejecuta como Administrador para importar automaticamente.
    )
)

echo.
echo Siguiente paso: scripts\2-install-services.bat
pause
