================================================================
  Suprema LATAM BioVisitor X
  Guía de Instalación On-Premise — Windows
  Frontend SPA estático servido por nginx
================================================================

SERVICIOS DE WINDOWS
────────────────────────────────────────────────────────────
  "Suprema LATAM BioVisitor Service"   — API NestJS  :3001
  "Suprema LATAM BioVisitor Web GUI"   — nginx (HTTPS) :443/:80
  "Suprema-LATAM-BioVisitor-Database-Service" — PostgreSQL dedicado :55432

ARQUITECTURA
────────────────────────────────────────────────────────────
  Browser / LAN
      │
      ▼  puerto 443 (HTTPS) / 80 → redirect 301
  ┌───────────────────────────────────────────────────────┐
  │  "Suprema LATAM BioVisitor Web GUI"  (NSSM Service)  │
  │  nginx.exe                                            │
  │  • Termina TLS  (certificado Suprema LATAM / 7 años) │
  │  • Sirve el frontend como SPA estática (frontend\out)│
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
  "Suprema-LATAM-BioVisitor-Database-Service" (PostgreSQL) + Redis for Windows

  El frontend no requiere Node.js en producción — es una build
  estática (next build, output: 'export') y el backend es un .exe
  autocontenido (pkg). Node.js solo hace falta en la máquina de
  build, no en el servidor de destino.

DIRECTORIO DE INSTALACION SUGERIDO
────────────────────────────────────────────────────────────
  C:\Program Files\SupremaLATAM\BioVisitor\
  ├── backend\
  │   ├── biovisitor-backend.exe  (autocontenido — bcrypt y sharp van embebidos)
  │   ├── .env                 ← copiar de config\backend.env.example
  │   └── uploads\
  ├── frontend\
  │   ├── out\                 ← build estática (next build, output: 'export')
  │   └── cert\
  │       ├── server.crt       ← generado por 1-generate-ssl.bat
  │       └── server.key       ← generado por 1-generate-ssl.bat
  ├── nginx\
  │   ├── nginx.exe            ← https://nginx.org/en/download.html (Windows)
  │   └── conf\nginx.conf      ← generado desde assets\nginx.conf.template
  ├── tools\
  │   └── nssm.exe             ← https://nssm.cc/download
  └── logs\
      ├── backend\
      └── frontend\            ← incluye los logs de nginx

PRERREQUISITOS
────────────────────────────────────────────────────────────
  1. NSSM                     https://nssm.cc/download
  2. nginx for Windows         https://nginx.org/en/download.html
  3. Git for Windows           https://git-scm.com (incluye OpenSSL)
  4. PostgreSQL 15+            https://www.postgresql.org/download/windows
  5. Redis for Windows         https://github.com/tporadowski/redis/releases

  (Node.js 24 LTS solo se necesita en la máquina donde se compila
   el instalador — ver windows-deployment\setup\build-installer.bat —
   no en el servidor donde se instala BioVisitor X.)

PASOS DE INSTALACION
────────────────────────────────────────────────────────────
  1. Crear estructura de directorios y copiar archivos:
       - biovisitor-backend\biovisitor-backend.exe   → backend\
       - biovisitor-frontend\out\*                    → frontend\out\
       - nginx for Windows (descomprimido)            → nginx\
  2. Configurar C:\...\backend\.env (copiar backend.env.example)
  3. scripts\1-generate-ssl.bat       (como Administrador)
  4. Generar nginx\conf\nginx.conf desde
     windows-deployment\assets\nginx.conf.template (sustituir
     {{PORT_HTTPS}}, {{PORT_HTTP}}, {{PORT_API}}, {{INSTALL_DIR}})
  5. scripts\2-install-services.bat   (como Administrador)
  6. scripts\3-start-all.bat          (como Administrador)
  7. Abrir https://[IP-SERVIDOR] en el navegador

  (El instalador gráfico — biovisitor-setup.iss — hace todos estos
   pasos automáticamente; esta sección es para instalación manual.)

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
  Frontend:  logs\frontend\frontend.log (nginx)

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
