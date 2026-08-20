@echo off
setlocal enabledelayedexpansion

echo ============================================================
echo  BioVisitor X - Build ejecutable Windows (.exe)
echo  Target: node24-win-x64 / bytecode protegido
echo ============================================================
echo.

REM Verificar Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js no esta instalado o no esta en el PATH.
    echo         Instala Node.js 22+ desde https://nodejs.org
    exit /b 1
)

REM Verificar que estemos en el directorio correcto
if not exist "package.json" (
    echo [ERROR] Ejecuta este script desde biovisitor-backend\
    echo         Ejemplo: cd biovisitor-backend ^&^& scripts\build-exe.bat
    exit /b 1
)

REM Crear directorio de salida
if not exist "release" mkdir release

echo [1/3] Compilando TypeScript (nest build)...
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] Fallo en nest build. Revisa los errores de TypeScript.
    exit /b 1
)
echo       OK - dist\ generado.
echo.

echo [2/3] Instalando @yao-pkg/pkg si no esta disponible...
call npx @yao-pkg/pkg --version >nul 2>&1
if %errorlevel% neq 0 (
    call npm install --save-dev @yao-pkg/pkg
)
echo       OK
echo.

echo [3/3] Empaquetando con pkg (bytecode - sin codigo fuente)...
echo       Target: node24-win-x64
echo       Output: release\biovisitor-backend.exe
echo.
call npx @yao-pkg/pkg dist/main.js ^
    -c package.json ^
    --target node24-win-x64 ^
    --output release/biovisitor-backend.exe
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Fallo el empaquetado con pkg.
    echo         Causas comunes:
    echo           - Modulos nativos (.node) no encontrados para Windows x64
    echo           - Error de memoria (cierra otras aplicaciones)
    echo           - Permiso denegado en release\
    exit /b 1
)

echo.
echo ============================================================
echo  BUILD EXITOSO
echo  Archivo: release\biovisitor-backend.exe
for %%I in (release\biovisitor-backend.exe) do echo  Tamano:  %%~zI bytes
echo ============================================================
echo.
echo  El .exe es autocontenido: sharp y bcrypt van embebidos, no se
echo  necesita copiar ningun .node ni node_modules\ junto al binario.
echo.
echo  IMPORTANTE - Archivos requeridos en produccion:
echo  1. biovisitor-backend.exe  (este archivo)
echo  2. .env                    (variables de entorno)
echo  3. uploads\                (se crea automaticamente al iniciar)
echo ============================================================

endlocal
