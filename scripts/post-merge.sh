#!/bin/bash
set -e

echo "=== BioVisitor X — Post-Merge Setup ==="

echo "[1/2] Instalando dependencias del backend..."
cd biovisitor-backend
npm install --legacy-peer-deps --no-fund --no-audit 2>&1 | tail -5
cd ..

echo "[2/2] Instalando dependencias del frontend..."
cd biovisitor-frontend
npm install --legacy-peer-deps --no-fund --no-audit 2>&1 | tail -5
cd ..

echo "=== Post-merge completado ==="
