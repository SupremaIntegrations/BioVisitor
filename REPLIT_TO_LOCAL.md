# Guía de Reversión: Replit → On-Premise (Local)

Este documento detalla todos los cambios realizados para adaptar el proyecto BioVisitor X al entorno de Replit. Cuando descargues el código para ejecutarlo en tu infraestructura local, sigue estos pasos para revertirlos.

---

## 1. Frontend — `biovisitor-frontend/package.json`

### Cambio realizado
Los scripts `dev` y `start` fueron modificados para usar el puerto 5000 y escuchar en `0.0.0.0` (requisito de Replit):

```json
"dev": "next dev -p 5000 -H 0.0.0.0",
"start": "next start -p 5000 -H 0.0.0.0",
```

### Qué revertir
Restaura los scripts originales sin puerto ni host forzado (Next.js usa `localhost:3000` por defecto):

```json
"dev": "next dev",
"start": "next start",
```

---

## 2. Frontend — `biovisitor-frontend/next.config.ts`

### Cambio realizado
Se añadió `allowedDevOrigins` para evitar warnings de CORS en el entorno de desarrollo de Replit:

```typescript
const nextConfig: NextConfig = {
  allowedDevOrigins: ["*.picard.replit.dev", "127.0.0.1"],
};
```

### Qué revertir
Elimina la propiedad `allowedDevOrigins`, dejando el config limpio:

```typescript
const nextConfig: NextConfig = {
  /* config options here */
};
```

---

## 3. Script de arranque — `start.sh`

### Cambio realizado
Se creó un script `start.sh` en la raíz que arranca Redis local, el backend NestJS y el frontend Next.js en un solo proceso (requisito de Replit para su sistema de workflows).

### Qué revertir
**Elimina el archivo `start.sh`**. En tu entorno local, cada servicio se ejecuta por separado:

```bash
# Terminal 1 — Backend
cd biovisitor-backend
npm run start:dev

# Terminal 2 — Frontend
cd biovisitor-frontend
npm run dev

# Redis y PostgreSQL ya corren como servicios del sistema en on-premise
```

---

## 4. Archivo `.replit`

### Cambio realizado
Este archivo es exclusivo del entorno Replit y configura el workflow, puertos y módulos del contenedor.

### Qué revertir
**Elimina el archivo `.replit`**. No tiene ningún efecto fuera de Replit.

---

## 5. Archivo `replit.md`

### Cambio realizado
Documentación interna para el agente de Replit.

### Qué revertir
**Elimina el archivo `replit.md`**. Es documentación específica de Replit.

---

## 6. Variables de Entorno

### Cambio realizado
Las variables se configuraron en los Secrets de Replit apuntando a:
- PostgreSQL provisionado por Replit (`helium:5432`)
- Redis local temporal (`127.0.0.1:6379`)
- URLs del dominio `*.picard.replit.dev`

### Qué revertir
Restaura tu archivo `.env` en `biovisitor-backend/` con los valores de tu infraestructura local:

```env
# Aplicación
APP_PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

# Base de Datos (tu PostgreSQL local)
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=biovisitor
DB_PASSWORD=<tu_password_local>
DB_NAME=biovisitor_x

# Redis (tu Redis local)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=<tu_password_redis>

# JWT y Cifrado (genera claves fuertes para producción)
JWT_SECRET=<clave_segura_64_hex>
ENCRYPTION_MASTER_KEY=<clave_segura_64_hex>
QR_JWT_SECRET=<clave_segura_64_hex>

# CORS
CORS_ALLOWED_ORIGINS=http://localhost:3000

# SMTP
SMTP_USER=<tu_email>
SMTP_PASSWORD=<tu_password_email>

# NEXT_PUBLIC_API_URL (en el frontend)
NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
```

---

## 7. Este archivo — `REPLIT_TO_LOCAL.md`

**Elimínalo** una vez completada la reversión. No es necesario en tu entorno local.

---

## 8. Cambios funcionales (NO requieren reversión)

Los siguientes cambios son mejoras funcionales al código que **deben conservarse** en la versión on-premise. No son específicos de Replit:

| Archivo | Cambio |
|---|---|
| `biovisitor-frontend/src/app/dashboard/page.tsx` | Dashboard ahora consulta API real (`/visitors/active`) en vez de datos hardcodeados; muestra estados vacíos correctos; botón "View All" navega a `/dashboard/visitors` |
| `biovisitor-frontend/src/app/dashboard/logs/page.tsx` | **Nuevo** — Página placeholder "Coming Soon" para Access Logs (evita 404) |
| `biovisitor-frontend/src/app/dashboard/settings/page.tsx` | **Nuevo** — Página placeholder "Coming Soon" para Settings (evita 404) |
| `biovisitor-frontend/src/app/dashboard/layout.tsx` | Barra de búsqueda deshabilitada con indicador visual; selector de idioma funcional; campana de notificaciones con dropdown; badges "Soon" en nav items no implementados |
| `biovisitor-frontend/src/app/page.tsx` | "Remember me" guarda email en localStorage; "Forgot password" muestra banner informativo en vez de link muerto |
| `biovisitor-frontend/src/app/dashboard/visitors/page.tsx` | Botones no funcionales (Scan QR, Check In, Enable Camera, Upload File, Read SmartCard) muestran toast "Coming Soon"; búsqueda de visitantes funcional; cleanup de socket listeners |
| `biovisitor-frontend/src/app/pre-register/[token]/page.tsx` | Validación real de token vía API; submit llama al endpoint real; captura de selfie con cámara web funcional |
| `biovisitor-frontend/src/hooks/useSocket.ts` | `listenToEvent` envuelto en `useCallback` y retorna función de cleanup para evitar memory leak por listeners duplicados |

---

## Resumen de archivos a eliminar/revertir

| Archivo | Acción |
|---|---|
| `start.sh` | Eliminar |
| `.replit` | Eliminar |
| `replit.md` | Eliminar |
| `REPLIT_TO_LOCAL.md` | Eliminar |
| `biovisitor-frontend/package.json` | Revertir scripts `dev` y `start` |
| `biovisitor-frontend/next.config.ts` | Eliminar `allowedDevOrigins` |
| `biovisitor-backend/.env` | Crear con tus valores locales |
