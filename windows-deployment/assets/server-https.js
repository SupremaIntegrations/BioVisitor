'use strict';
/**
 * BioVisitor X — Frontend HTTPS entry point
 *
 * Terminates HTTPS/HTTP on the public ports and reverse-proxies everything
 * (including WebSocket upgrades, used by Socket.IO for live notifications
 * and access-log events) to the Next.js standalone server, which this
 * script starts internally on a loopback-only port. Next's own rewrites
 * (see next.config.ts) then forward /api/v1 and /socket.io to the backend.
 *
 * Only Node.js built-in modules are used — no external dependencies, so
 * this runs unmodified from the packaged standalone output.
 *
 * Copied next to server.js (the Next.js standalone entry point) by the
 * installer / build-installer.bat, and run by NSSM as the
 * "Suprema LATAM BioVisitor Web GUI" service.
 *
 * Environment variables:
 *   PORT                 Public HTTPS port          (default 443)
 *   HTTP_PORT            Public HTTP port (redirect) (default 80)
 *   NEXT_INTERNAL_PORT   Internal Next.js port       (default 3000)
 */

process.chdir(__dirname);

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const net = require('net');
const { spawn } = require('child_process');

const HTTPS_PORT = parseInt(process.env.PORT, 10) || 443;
const HTTP_PORT = parseInt(process.env.HTTP_PORT, 10) || 80;
const INTERNAL_PORT = parseInt(process.env.NEXT_INTERNAL_PORT, 10) || 3000;
const INTERNAL_HOST = '127.0.0.1';

const CERT_PATH = path.join(__dirname, 'cert', 'server.crt');
const KEY_PATH = path.join(__dirname, 'cert', 'server.key');

function log(msg) {
  process.stdout.write(`[${new Date().toISOString()}] ${msg}\n`);
}

if (!fs.existsSync(CERT_PATH) || !fs.existsSync(KEY_PATH)) {
  console.error(
    `ERROR: certificado SSL no encontrado (${CERT_PATH}).\n` +
      'Este archivo lo genera el instalador; reinstala o coloca ' +
      'server.crt / server.key en la carpeta cert\\ manualmente.',
  );
  process.exit(1);
}

// ── Arrancar Next.js internamente, solo accesible en loopback ─────────────
const nextChild = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
  cwd: __dirname,
  env: {
    ...process.env,
    PORT: String(INTERNAL_PORT),
    HOSTNAME: INTERNAL_HOST,
  },
  stdio: ['ignore', 'inherit', 'inherit'],
  windowsHide: true,
});

nextChild.on('exit', (code, signal) => {
  log(`Next.js terminó (código: ${code}, señal: ${signal}) — deteniendo servidor HTTPS.`);
  shutdown();
});

// ── Proxy HTTP → Next interno ──────────────────────────────────────────────
function proxyRequest(clientReq, clientRes) {
  const proxyReq = http.request(
    {
      host: INTERNAL_HOST,
      port: INTERNAL_PORT,
      method: clientReq.method,
      path: clientReq.url,
      headers: clientReq.headers,
    },
    (proxyRes) => {
      clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(clientRes);
    },
  );

  proxyReq.on('error', (err) => {
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    clientRes.end('BioVisitor X está iniciando, intenta de nuevo en unos segundos.');
    log(`WARN proxy: ${err.code || err.message}`);
  });

  clientReq.pipe(proxyReq);
}

// ── Proxy de upgrades (WebSocket / Socket.IO) ──────────────────────────────
function proxyUpgrade(req, clientSocket, head) {
  const proxySocket = net.connect(INTERNAL_PORT, INTERNAL_HOST, () => {
    let rawHeaders = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      rawHeaders += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
    }
    rawHeaders += '\r\n';

    proxySocket.write(rawHeaders);
    if (head && head.length) proxySocket.write(head);
    proxySocket.pipe(clientSocket);
    clientSocket.pipe(proxySocket);
  });

  proxySocket.on('error', (err) => {
    log(`WARN proxy upgrade: ${err.code || err.message}`);
    clientSocket.destroy();
  });
  clientSocket.on('error', () => proxySocket.destroy());
}

// ── Servidor HTTPS público ─────────────────────────────────────────────────
const httpsServer = https.createServer(
  {
    cert: fs.readFileSync(CERT_PATH),
    key: fs.readFileSync(KEY_PATH),
  },
  proxyRequest,
);
httpsServer.on('upgrade', proxyUpgrade);
httpsServer.on('error', (err) => {
  console.error(`ERROR: no se pudo iniciar HTTPS en el puerto ${HTTPS_PORT}: ${err.message}`);
  process.exit(1);
});
httpsServer.listen(HTTPS_PORT, () => {
  log(`HTTPS escuchando en puerto ${HTTPS_PORT} (proxy → ${INTERNAL_HOST}:${INTERNAL_PORT})`);
});

// ── Servidor HTTP público — redirige todo a HTTPS ──────────────────────────
const httpServer = http.createServer((req, res) => {
  const hostHeader = (req.headers.host || '').split(':')[0];
  const suffix = HTTPS_PORT !== 443 ? `:${HTTPS_PORT}` : '';
  res.writeHead(301, { Location: `https://${hostHeader}${suffix}${req.url}` });
  res.end();
});
httpServer.on('error', (err) => {
  log(`WARN: no se pudo iniciar el redirector HTTP en el puerto ${HTTP_PORT}: ${err.message}`);
});
httpServer.listen(HTTP_PORT, () => {
  log(`HTTP (redirección a HTTPS) escuchando en puerto ${HTTP_PORT}`);
});

// ── Apagado ordenado (NSSM stop / Windows service stop) ────────────────────
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log('Cerrando servidor HTTPS...');

  httpsServer.close();
  httpServer.close();

  if (nextChild.exitCode === null && nextChild.signalCode === null) {
    nextChild.kill('SIGTERM');
    setTimeout(() => {
      if (nextChild.exitCode === null && nextChild.signalCode === null) {
        nextChild.kill('SIGKILL');
      }
    }, 5000);
  }

  setTimeout(() => process.exit(0), 6000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
