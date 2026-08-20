#!/usr/bin/env bash
# =============================================================
#  BioVisitor X - Build ejecutable Linux/macOS
#  Target: node24-linux-x64 | node24-macos-x64
#  Uso: bash scripts/build-exe.sh [linux|macos]  (default: linux)
# =============================================================
set -e

TARGET_OS="${1:-linux}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"

cd "$BACKEND_DIR"

case "$TARGET_OS" in
  linux)
    PKG_TARGET="node24-linux-x64"
    OUTPUT="release/biovisitor-backend-linux"
    ;;
  macos|mac|darwin)
    PKG_TARGET="node24-macos-x64"
    OUTPUT="release/biovisitor-backend-macos"
    ;;
  windows|win)
    PKG_TARGET="node24-win-x64"
    OUTPUT="release/biovisitor-backend.exe"
    ;;
  *)
    echo "Uso: $0 [linux|macos|windows]"
    exit 1
    ;;
esac

echo "============================================================"
echo " BioVisitor X - Build ejecutable"
echo " Target : $PKG_TARGET"
echo " Output : $OUTPUT"
echo "============================================================"
echo ""

# Verificar que estemos en el directorio correcto
if [ ! -f "package.json" ]; then
  echo "[ERROR] Ejecuta desde biovisitor-backend/"
  exit 1
fi

# Crear directorio de salida
mkdir -p release

# Paso 1: Compilar TypeScript
echo "[1/3] Compilando TypeScript (nest build)..."
npm run build
echo "      OK - dist/ generado."
echo ""

# Paso 2: Verificar @yao-pkg/pkg
echo "[2/3] Verificando @yao-pkg/pkg..."
if ! npx @yao-pkg/pkg --version > /dev/null 2>&1; then
  npm install --save-dev @yao-pkg/pkg
fi
echo "      OK"
echo ""

# Paso 3: Empaquetar con bytecode
echo "[3/3] Empaquetando (bytecode - sin codigo fuente)..."
npx @yao-pkg/pkg dist/main.js \
  -c package.json \
  --target "$PKG_TARGET" \
  --output "$OUTPUT"

echo ""
echo "============================================================"
echo " BUILD EXITOSO"
echo " Archivo: $OUTPUT"
if command -v du &>/dev/null; then
  du -sh "$OUTPUT"
fi
echo "============================================================"
echo ""
echo " El binario es autocontenido: sharp y bcrypt van embebidos, no"
echo " se necesita copiar ningun .node ni node_modules/ junto a el."
echo ""
echo " Archivos requeridos en produccion:"
echo "  1. $OUTPUT"
echo "  2. .env"
echo "  3. uploads/ (se crea automaticamente)"
echo "============================================================"
