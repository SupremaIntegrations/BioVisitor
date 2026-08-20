================================================================
  Suprema LATAM BioVisitor X
  Guía de Instalación On-Premise — Windows
  HTTPS nativo por Node.js
================================================================

SERVICIOS DE WINDOWS
────────────────────────────────────────────────────────────
  "Suprema LATAM BioVisitor Service"   — API NestJS  :3001
  "Suprema LATAM BioVisitor Web GUI"   — HTTPS Next.js :443/:80

ARQUITECTURA
────────────────────────────────────────────────────────────
  Browser / LAN
      │
      ▼  puerto 443 (HTTPS) / 80 → redirect 301
  ┌───────────────────────────────────────────────────────┐
  │  "Suprema LATAM BioVisitor Web GUI"  (NSSM Service)  │
  │  Node.js → server-https.js                           │
  │  • Termina TLS  (certificado Suprema LATAM / 7 años) │
  │  • Next.js interno en localhost:3000                  │
  │  • Proxy /api/v1/* y /socket.io/* → backend :3001    │
  └───────────────────────────────────────────────────────┘
      │ localhost:3001 (solo interno)
      ▼
  ┌───────────────────────────────────────────────────────┐
  │  "Suprema LATAM BioVisitor Service"  (NSSM Service)  │
  │  biovisitor-backend.exe (NestJS)                     │
  └───────────────────────────────────────────────────────┘
      │
      ▼
  PostgreSQL 15+ + Redis for Windows

DIRECTORIO DE INSTALACION SUGERIDO
────────────────────────────────────────────────────────────
  C:\Program Files\SupremaLATAM\BioVisitor\
  ├── backend\
  │   ├── biovisitor-backend.exe  (autocontenido — bcrypt y sharp van embebidos)
  │   ├── .env                 ← copiar de config\backend.env.example
  │   └── uploads\
  ├── frontend\
  │   ├── server-https.js      ← copiar de windows-deployment\assets\server-https.js
  │   ├── server.js            (Next.js interno — no ejecutar directo)
  │   ├── cert\
  │   │   ├── server.crt       ← generado por 1-generate-ssl.bat
  │   │   └── server.key       ← generado por 1-generate-ssl.bat
  │   ├── .next\
  │   ├── node_modules\
  │   └── public\
  ├── tools\
  │   └── nssm.exe             ← https://nssm.cc/download
  └── logs\
      ├── backend\
      └── frontend\

PRERREQUISITOS
────────────────────────────────────────────────────────────
  1. Node.js 24 LTS           https://nodejs.org
  2. NSSM                     https://nssm.cc/download
  3. Git for Windows           https://git-scm.com (incluye OpenSSL)
  4. PostgreSQL 15+            https://www.postgresql.org/download/windows
  5. Redis for Windows         https://github.com/tporadowski/redis/releases

PASOS DE INSTALACION
────────────────────────────────────────────────────────────
  1. Crear estructura de directorios y copiar archivos:
       - biovisitor-backend\biovisitor-backend.exe        → backend\
       - biovisitor-frontend\.next\standalone\*            → frontend\
       - windows-deployment\assets\server-https.js         → frontend\
  2. Configurar C:\...\backend\.env (copiar backend.env.example)
  3. scripts\1-generate-ssl.bat       (como Administrador)
  4. scripts\2-install-services.bat   (como Administrador)
  5. scripts\3-start-all.bat          (como Administrador)
  6. Abrir https://[IP-SERVIDOR] en el navegador

OPERACION
────────────────────────────────────────────────────────────
  Los servicios arrancan AUTOMATICAMENTE con Windows.
  Iniciar:   3-start-all.bat
  Detener:   stop-all.bat
  Reiniciar: restart-all.bat
  Estado:    status.bat

LOGS
────────────────────────────────────────────────────────────
  Backend:   logs\backend\backend.log
  Frontend:  logs\frontend\frontend.log

PRIMER INICIO DE SESION
────────────────────────────────────────────────────────────
  La tabla de usuarios queda vacia tras la instalacion. Al abrir
  BioVisitor X por primera vez, la aplicacion detecta que no
  existe ningun administrador y muestra su propio asistente de
  configuracion inicial, donde defines el correo y la contraseña
  del administrador.

DESINSTALAR
────────────────────────────────────────────────────────────
  scripts\uninstall-services.bat (como Administrador)
  Los datos NO son eliminados automaticamente.

================================================================
