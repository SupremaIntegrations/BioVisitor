'use strict';
/**
 * BioVisitor X — Supervisor de procesos
 *
 * Arranca backend y frontend, los reinicia si crashean,
 * escribe logs, y se cierra limpio con SIGTERM/SIGINT.
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
const net   = require('net');

const BASE = process.env.BIOVISITOR_DIR || 'C:\\BioVisitor';
const LOGS = process.env.LOG_DIR        || path.join(BASE, 'logs');

// ── Utilidades de log ──────────────────────────────────────────────────────
function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

ensureDir(path.join(LOGS, 'backend'));
ensureDir(path.join(LOGS, 'frontend'));

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
  {
    name:         'frontend',
    cmd:          process.execPath,
    args:         [path.join(BASE, 'frontend', 'server-https.js')],
    cwd:          path.join(BASE, 'frontend'),
    env: {
      ...process.env,
      NODE_ENV:              'production',
      PORT:                  '443',
      HTTP_PORT:             '80',
      NEXT_INTERNAL_PORT:    '3000',
      NEXT_PUBLIC_API_URL:   '/api/v1',
    },
    startAfterBackend: true,
    restartDelay:      6000,
    maxRestarts:       10,
  },
];

// ── Control de procesos ────────────────────────────────────────────────────
const running = new Map();
let   shuttingDown = false;

function waitPort(port, retries, delay) {
  return new Promise((resolve, reject) => {
    function attempt(n) {
      const sock = net.createConnection(port, '127.0.0.1');
      sock.on('connect', () => { sock.destroy(); resolve(); });
      sock.on('error', () => {
        sock.destroy();
        if (n <= 0) return reject(new Error(`Puerto ${port} no responde`));
        setTimeout(() => attempt(n - 1), delay);
      });
    }
    attempt(retries);
  });
}

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
  const backend  = services.find(s => s.name === 'backend');
  const frontend = services.find(s => s.name === 'frontend');

  // Iniciar backend
  startService(backend);

  // Esperar a que el backend esté listo antes del frontend
  if (backend.healthPort) {
    supervisorLog(`Esperando a que el backend responda en puerto ${backend.healthPort}...`);
    try {
      await waitPort(backend.healthPort, 60, 1000);
      supervisorLog('Backend listo.');
    } catch {
      supervisorLog('WARN: Backend no respondió en 60s. Iniciando frontend de todos modos.');
    }
  }

  startService(frontend);
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
