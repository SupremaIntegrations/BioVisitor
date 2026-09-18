'use strict';
/**
 * BioVisitor X — Supervisor de procesos
 *
 * Arranca el backend, lo reinicia si crashea, escribe logs, y se cierra
 * limpio con SIGTERM/SIGINT. El frontend (nginx) ya NO se supervisa aquí:
 * es un servicio Windows independiente (via NSSM, ver
 * windows-deployment/setup/biovisitor-setup.iss), igual que PostgreSQL y
 * Redis — no un proceso Node.js hijo de este script.
 *
 * Usar solo módulos nativos de Node.js — sin dependencias externas.
 *
 * Uso:
 *   node supervisor.js
 *
 * Variables de entorno opcionales:
 *   BIOVISITOR_DIR   Directorio raíz   (default: C:\BioVisitor)
 *   LOG_DIR          Directorio logs   (default: {BIOVISITOR_DIR}\logs)
 */

process.chdir(__dirname);

const { spawn } = require('child_process');
const path  = require('path');
const fs    = require('fs');

const BASE = process.env.BIOVISITOR_DIR || 'C:\\BioVisitor';
const LOGS = process.env.LOG_DIR        || path.join(BASE, 'logs');

// ── Utilidades de log ──────────────────────────────────────────────────────
function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

ensureDir(path.join(LOGS, 'backend'));

function makeLogger(name) {
  const file = path.join(LOGS, name, `${name}.log`);
  return function log(msg) {
    const line = `[${new Date().toISOString()}] [${name}] ${msg}\n`;
    process.stdout.write(line);
    fs.appendFileSync(file, line);
  };
}

// ── Definición de servicios ────────────────────────────────────────────────
const services = [
  {
    name:         'backend',
    cmd:          path.join(BASE, 'backend', 'biovisitor-backend.exe'),
    args:         [],
    cwd:          path.join(BASE, 'backend'),
    env:          { ...process.env, NODE_ENV: 'production' },
    healthPort:   3001,
    restartDelay: 3000,
    maxRestarts:  10,
  },
];

// ── Control de procesos ────────────────────────────────────────────────────
const running = new Map();
let   shuttingDown = false;

function startService(svc, restartCount = 0) {
  if (shuttingDown) return;

  const log = makeLogger(svc.name);

  if (!fs.existsSync(svc.cmd)) {
    log(`ERROR: ejecutable no encontrado: ${svc.cmd}`);
    return;
  }

  log(`Iniciando (intento ${restartCount + 1})...`);

  const outFile = path.join(LOGS, svc.name, `${svc.name}.log`);
  const errFile = path.join(LOGS, svc.name, `${svc.name}-error.log`);
  const out = fs.openSync(outFile, 'a');
  const err = fs.openSync(errFile, 'a');

  const child = spawn(svc.cmd, svc.args, {
    cwd:   svc.cwd,
    env:   svc.env,
    stdio: ['ignore', out, err],
    windowsHide: true,
  });

  running.set(svc.name, child);
  log(`PID: ${child.pid}`);

  child.on('exit', (code, signal) => {
    fs.closeSync(out);
    fs.closeSync(err);
    running.delete(svc.name);

    if (shuttingDown) return;

    log(`Proceso terminó (código: ${code}, señal: ${signal})`);

    if (restartCount >= svc.maxRestarts) {
      log(`ERROR: máximo de reinicios alcanzado (${svc.maxRestarts}). Detenido.`);
      return;
    }

    const delay = Math.min(svc.restartDelay * (restartCount + 1), 30000);
    log(`Reiniciando en ${delay / 1000}s...`);
    setTimeout(() => startService(svc, restartCount + 1), delay);
  });
}

// ── Inicio del supervisor ──────────────────────────────────────────────────
const supervisorLog = makeLogger('supervisor');
supervisorLog('BioVisitor X Supervisor iniciado');
supervisorLog(`Directorio base: ${BASE}`);

async function main() {
  const backend = services.find(s => s.name === 'backend');
  startService(backend);
}

// ── Cierre limpio ──────────────────────────────────────────────────────────
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  supervisorLog(`Señal ${signal} recibida — cerrando procesos...`);

  for (const [name, child] of running) {
    supervisorLog(`Deteniendo ${name} (PID ${child.pid})...`);
    try { child.kill('SIGTERM'); } catch (_) {}
  }

  setTimeout(() => {
    for (const [, child] of running) {
      try { child.kill('SIGKILL'); } catch (_) {}
    }
    process.exit(0);
  }, 8000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGHUP',  () => shutdown('SIGHUP'));

main().catch(err => {
  supervisorLog(`ERROR: ${err.message}`);
  process.exit(1);
});
