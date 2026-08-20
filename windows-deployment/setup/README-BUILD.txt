================================================================
  BioVisitor X — Guía de Construcción del Installer
  Suprema LATAM
================================================================

PRERREQUISITOS EN EL EQUIPO DE BUILD
─────────────────────────────────────────────────────────────
  1. Node.js 24 LTS      https://nodejs.org
  2. Inno Setup 6        https://jrsoftware.org/isdownload.php
  3. Git (con OpenSSL)   https://git-scm.com/download/win

ARCHIVOS DE REDISTRIBUCIÓN (descargar y colocar en redist\)
─────────────────────────────────────────────────────────────
  Los siguientes archivos NO están incluidos en el repositorio
  por razones de tamaño y licencias. Descárgalos y colócalos
  exactamente con estos nombres en la carpeta windows-deployment\redist\

  1. PostgreSQL 16 (Windows x64, Interactive Installer)
     URL: https://www.enterprisedb.com/downloads/postgres-postgresql-downloads
     Nombre archivo: postgresql-16.14-2-windows-x64.exe
     (versión exacta puede variar — actualiza el .iss si cambia)

  2. Redis for Windows (unofficial port, MSI)
     URL: https://github.com/tporadowski/redis/releases
     Nombre archivo: Redis-x64-5.0.14.1.msi

  3. Node.js 24 LTS (Windows x64 MSI)
     URL: https://nodejs.org/en/download/
     Nombre archivo: node-v24.19.0-x64.msi
     (versión exacta puede variar — actualiza el .iss si cambia)

  4. NSSM (Non-Sucking Service Manager)
     URL: https://nssm.cc/download  → NSSM 2.24 o superior
     Extrae nssm.exe (x64) y colócalo en: windows-deployment\tools\nssm.exe

Estructura final requerida antes del build:
  windows-deployment\
  ├── redist\
  │   ├── postgresql-16.14-2-windows-x64.exe  ← descargar
  │   ├── Redis-x64-5.0.14.1.msi              ← descargar
  │   └── node-v24.19.0-x64.msi               ← descargar
  ├── tools\
  │   └── nssm.exe                            ← extraer de NSSM zip
  ├── db\
  │   ├── schema.sql                          ← incluido en repo
  │   └── seed.sql                            ← incluido en repo
  └── setup\
      ├── biovisitor-setup.iss               ← incluido en repo
      ├── build-installer.bat                ← ejecutar este
      ├── License.txt                        ← incluido en repo
      └── README-BUILD.txt                   ← este archivo

CONSTRUIR EL INSTALLER
─────────────────────────────────────────────────────────────
  1. Abre un terminal en windows-deployment\setup\
  2. Ejecuta: build-installer.bat
  3. El proceso:
     a) Compila el backend NestJS  (~2 min)
     b) Compila el frontend Next.js (~3 min)
     c) Genera biovisitor-setup.exe (~1 min con Inno Setup)
  4. El installer final estará en: windows-deployment\output\

ACTUALIZAR VERSIONES DE REDISTRIBUIBLES
─────────────────────────────────────────────────────────────
  Si descargaste versiones diferentes de Node.js, Redis o
  PostgreSQL, actualiza las siguientes líneas en biovisitor-setup.iss:

    #define PostgreSQLInstaller "postgresql-16.14-2-windows-x64.exe"
    #define RedisInstaller      "Redis-x64-5.0.14.1.msi"
    #define NodeInstaller       "node-v24.19.0-x64.msi"
    #define PostgreSQLVersion   "16"     ; solo el número mayor

NOTAS IMPORTANTES
─────────────────────────────────────────────────────────────
  - El installer crea dos servicios de Windows:
      "Suprema LATAM BioVisitor Service"   (backend, :3001)
      "Suprema LATAM BioVisitor Web GUI"   (frontend, :443)
  - Los certificados SSL se generan durante la instalación
    con vigencia de 7 años.
  - La tabla users queda vacía; BioVisitor X pide crear el
    administrador inicial la primera vez que se abre la URL.
  - La base de datos se crea como: biovisitor_db
  - El backend se conecta con el superusuario de PostgreSQL "postgres"
    (no se crea un usuario de aplicación aparte)

================================================================
