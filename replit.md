# BioVisitor X

## Documento Maestro
**SIEMPRE consultar `PROJECT_CONTEXT.md` para la visión completa del proyecto, reglas inquebrantables, flujos de datos, identidad visual y próximos módulos.**

## Overview
BioVisitor X is a full-stack Visitor Management System (VMS) built for on-premise deployment. It consists of a NestJS backend and a Next.js frontend, designed to integrate with Suprema BioStar 2 and BioStar X biometric access control systems via their REST/JSON APIs.

## Key Features Implemented
- **Visitor Registration**: Walk-in + pre-registration with biometric photo validation
- **BioStar Integration**: Auto-sync with Suprema BioStar 2/X for physical access control (QR, RFID, face, fingerprint)
- **Thermal Badge Printing (Sewoo LK-B30IIE)**: PrintBadgeModal with react-to-print v3, format selector (62×100mm / 4"×3" Sewoo / CR80), landscape layout for 4"×3", setup tips, audit log
- **Fingerprint Enrollment (BioMini Slim 2)**: `useBioMiniScanner` hook (WebSocket ws://127.0.0.1:14578), `FingerprintEnrollModal` with 10-finger hand diagram, quality score, 3-sample capture flow, LGPD/GDPR notice, backend `POST /visitors/visit/:visitId/fingerprints` → BioStar `enrollFingerprint`
- **Visitor Assets Module**: Declare and verify assets (laptops, tablets, tools, etc.) that visitors bring in — verified during check-out. Entity: `visitor_assets`. Endpoints: GET/POST/PATCH-verify/DELETE assets on `/visitors/visit/:visitId/assets`
- **Audit Trail**: Immutable audit log with filters, pagination, diff viewer (admin-only)
- **Reports**: CSV/PDF export with audit logging
- **Real-time Events**: Socket.IO broadcasts for live dashboard updates

## Architecture
- **Frontend**: Next.js 16 (React 19) with Tailwind CSS 4, running on port 5000
- **Backend**: NestJS 11 with TypeORM, running on port 3001 (API prefix: `/api/v1`)
- **Database**: PostgreSQL (Replit provisioned, mapped to DB_* env vars)
- **Cache/Queue**: Redis (local instance on 127.0.0.1:6379)
- **Auth**: JWT-based authentication with bcrypt password hashing
- **Encryption**: AES-256-GCM for BioStar credentials
- **WebSockets**: Socket.IO via NestJS Gateway (namespace: /events)

## Project Structure
```
biovisitor-frontend/     # Next.js frontend (port 5000)
  src/app/               # App router pages
  src/components/        # React components (RegisterWalkInModal, PrintBadgeModal)
  src/hooks/             # Custom hooks (useSocket)
  src/lib/               # API client (axios with interceptors)

biovisitor-backend/      # NestJS backend (port 3001)
  src/core/              # Config, security, crypto, logging
  src/database/          # TypeORM entities (visitor, visit, user, tenant, audit-log, qr-token, pre-reg-token)
  src/modules/           # Feature modules:
    settings/            # Settings module: SupremaConnections CRUD + test
    auth/                # Login, JWT, passport strategies
    visitors/            # Visitor CRUD, check-in/out, pre-registration, BioStar hybrid sync
    qr-engine/           # Dynamic QR code generation (Redis TTL)
    suprema-gateway/     # BioStar 2/X integration (Strategy/Facade pattern)
    events/              # WebSocket events gateway
    notifications/       # Email notifications (Nodemailer)
    reports/             # CSV/PDF report generation
    i18n/                # Internationalization (es/en)
    job-queue/           # Bull/BullMQ job processing (disabled — needs Redis 6.2+)
```

## Startup
`start.sh` launches Redis, the NestJS backend (watch mode), and the Next.js frontend in a single workflow.

## Replit-Specific Adaptations
- `next.config.ts` has `rewrites` proxy: `/api/v1/*` → `localhost:3001` (remove for on-premise)
- `NEXT_PUBLIC_API_URL` set to `/api/v1` (relative, uses proxy). On-premise: set to `http://localhost:3001/api/v1`
- `allowedDevOrigins` in next.config.ts for Replit dev domain
- Frontend runs on port 5000 (Replit). On-premise: port 3000
- Full revert guide in `REPLIT_TO_LOCAL.md`

## Key Environment Variables
- `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME` — PostgreSQL
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` — Redis
- `JWT_SECRET`, `ENCRYPTION_MASTER_KEY`, `QR_JWT_SECRET` — Security
- `NEXT_PUBLIC_API_URL` — Frontend API base URL (currently `/api/v1`)
- `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS` — CORS config
- `SMTP_USER`, `SMTP_PASSWORD` — Email (optional)

## Dev Credentials
- **Email:** admin@supremainc.com
- **Password:** Suprema2026!

## Changes Log
### Session 14 — Fix Auto-Checkout por Dispositivo de Salida no se disparaba con tarjeta
- **Causa raíz**: la detección de "acceso concedido" (`isGranted`) sólo reconocía `event_type_id.code` en la familia `0x1300–0x13FF` (IDENTIFY_SUCCESS, 1:N — ej. rostro). Pero el acceso por tarjeta RFID/QR genera eventos `VERIFY_SUCCESS` (1:1) en la familia `0x1000–0x10FF` (confirmado con 3 pasadas reales de tarjeta en BioStation 3, code `4102` / `0x1006`). Como esa familia no estaba incluida, el poller (`EnrollerDevicesService.getRecentAccessEvents`, usado por `BiostarWsService.pollExitDeviceEvents`) nunca marcaba el evento como concedido y el auto-checkout no se disparaba.
- **Fix**: `isGranted` ahora acepta ambas familias (`mainCode === 0x13 || mainCode === 0x10`) en `enroller-devices.service.ts`.
- **Fix adicional (efecto secundario)**: al pasar la tarjeta varias veces seguidas, cada evento "concedido" programaba su propio checkout en paralelo, causando checkout duplicado y correo de encuesta de salida duplicado. Se agregó una guarda en memoria (`exitCheckoutScheduled` Set) en `BiostarWsService.checkoutOnExitDevice` para que solo se programe/ejecute un checkout automático por visita a la vez.
- Verificado end-to-end en vivo: 3 pasadas reales de la tarjeta de Cristian Ramos en el dispositivo de salida (538155116) → detectado por el poller → checkout automático aplicado una sola vez → usuario eliminado de BioStar → correo de encuesta enviado una sola vez → evento WS `visit.checked_out` emitido. `tsc --noEmit` limpio en backend.

### Session 13 — Fix visibilidad de "Falsa Salida" + Pestaña dedicada + Campana de alertas
- **Bug corregido**: `getActiveVisits()` no incluía `VisitStatus.FALSE_EXIT_REPORTED` en `baseStatuses`, por lo que una visita reportada como falsa salida desaparecía del dashboard (`/visitors/active`). Ahora ese estado se incluye siempre.
- **Nueva pestaña "Falsa Salida"** en `dashboard/visitors/page.tsx`: solo visible cuando hay al menos un caso pendiente, con contador y ícono pulsante en rojo. Las demás pestañas (Esperados/En Edificio/No-Show) ya no muestran estas visitas por error — cada una filtra su propio estado y "Falsa Salida" tiene su propia pestaña (la pestaña "Todos" sigue mostrando todo).
- **Deep link**: `/dashboard/visitors?filter=falseexit` abre directamente la pestaña de Falsa Salida.
- **Nuevo endpoint** `GET /visitors/alerts/false-exits` — lista liviana (`visitId`, `visitorName`, `falseExitReportedAt`) de visitas con reporte pendiente, para el badge de notificaciones.
- **Campana de notificaciones** (antes vacía/decorativa) en `dashboard/layout.tsx`: ahora consulta el endpoint cada 30s + se actualiza en tiempo real vía WebSocket (`visit.false_exit_reported`, `visit.temporary_reenabled`, `visit.false_exit_dismissed`). Muestra badge rojo con el conteo, dropdown con la lista de casos y un acceso directo a la pestaña de Falsa Salida por cada ítem.
- Verificado vía API: `/visitors/active` y `/visitors/alerts/false-exits` devuelven correctamente el caso de prueba (Cristian Ramos); `tsc --noEmit` limpio en backend y frontend (los errores preexistentes de `equipment/page.tsx`, `layout.tsx` (nav comingSoon), `FingerprintEnrollModal.tsx` y `VisitorDetailModal.tsx` no están relacionados).

### Session 12 — Encuesta de Salida por Email + Reporte de "Falsa Salida"
- **Objetivo**: cuando un visitante es auto-checked-out por un dispositivo de salida, se le envía un correo con una encuesta de satisfacción y la opción de reportar que en realidad sigue dentro (falsa salida). El operador puede entonces re-habilitar el acceso temporalmente sobre la MISMA visita (nunca crea una segunda visita) o descartar el reporte.
- **Visit entity**: nuevos campos `surveyRating`, `surveyComment`, `surveyRespondedAt`, `falseExitReportedAt`, `falseExitResolvedAt`, `falseExitResolvedByUserId`, `falseExitResolutionNote`, `temporaryReenableUntil`, `wasTemporaryReenabled`. Nuevo status `FALSE_EXIT_REPORTED`.
- **ExitLinksService**: genera/valida JWT de un solo uso para los links públicos de encuesta y de reporte de falsa salida (enviados por email, sin necesidad de login).
- **AutoCheckoutService**: cron adicional que cierra automáticamente las habilitaciones temporales vencidas (`temporaryReenableUntil` pasado); config de encuesta de salida (on/off) persistida en Redis por tenant (`GET/PUT /visitors/settings/exit-survey`).
- **VisitorsService**: `submitExitSurvey` (rating + comentario opcional), `reportFalseExit` (marca la visita y dispara evento WS), `dismissFalseExit` (operador descarta el reporte con nota), `temporaryReenableVisit` (preserva `checkedInAt` original, restaura `status=CHECKED_IN`, recrea el usuario/credencial en BioStar vía `supremaSync.syncVisit`, aplica `temporaryReenableUntil` explícito y permite togglear `autoCheckoutEnabled`).
- **Endpoints públicos** (sin JWT de sesión, usan el token del link): `POST /visitor-portal/survey/:token`, `POST /visitor-portal/false-exit/:token`.
- **Endpoints de operador**: `PUT visitors/visit/:visitId/false-exit/dismiss`, `PUT visitors/visit/:visitId/temporary-reenable`.
- **Email**: plantilla `exit-survey.hbs` + `NotificationsService.sendExitSurvey`; disparado desde `biostar-ws.service.ts` inmediatamente después de un auto-checkout exitoso por dispositivo de salida, solo si el toggle de encuesta está habilitado para el tenant.
- **Frontend público**: `/visitor/survey/[token]` (estrellas + comentario) y `/visitor/false-exit/[token]` (requiere click explícito en "Confirmar" antes de reportar, para evitar reportes accidentales por apertura de link).
- **Frontend operador** (`dashboard/visitors/page.tsx`): banner en vivo + badge de estado "Falsa salida" (pulsante) al recibir el evento WS `visit.false_exit_reported`; botón de acción abre `FalseExitAlertModal` con dos flujos — reactivar (datetime-local para expiry + checkbox autoCheckoutEnabled + nota) o descartar (nota).
- **Settings** (`auto-checkout/page.tsx`): toggle "Encuesta de salida por correo" añadido a la card de Dispositivos de Salida.
- **VisitorDetailModal**: nuevas secciones de solo-lectura mostrando el resultado de la encuesta (estrellas + comentario) y el historial de reporte de falsa salida (fechas, nota de resolución, aviso de re-habilitación temporal).
- Verificado: `tsc --noEmit` limpio en backend; frontend sin errores nuevos (los 4 errores de tsc preexistentes en `equipment/page.tsx`, `layout.tsx`, `FingerprintEnrollModal.tsx` y `VisitorDetailModal.tsx` (uso de `.fullName` inexistente) no están relacionados con este trabajo). Probado end-to-end vía API: login, `/visitors/active`, `/visitors/settings/exit-survey`, y `/visitors/visit/:id` confirmando que todos los campos nuevos llegan al frontend.

### Session 11 — Settings UI: Merge Exit Devices into Autocheckout
- Merged the "Dispositivos de Salida" settings section into the "Autocheckout" settings page since they are functionally related (exit-device auth triggers real-time auto-checkout).
- `auto-checkout/page.tsx` now includes a new "Dispositivos de salida" card: device list (from BioStar), configured exit-devices list, add/remove actions, and the checkout delay-in-seconds config — all moved from the old standalone page.
- Removed the separate "Dispositivos de Salida" entry from the settings menu (`settings/page.tsx`); updated the Autocheckout entry's description to mention it now includes exit-device configuration.
- `settings/exit-devices/page.tsx` converted into a redirect stub (`router.replace('/dashboard/settings/auto-checkout')`) to avoid breaking old bookmarks/links; backend endpoints (`/settings/exit-devices*`) unchanged.

### Session 6 — Visitor Detail, Edit & Photo Pipeline
- Added `GET /api/v1/visitors/visit/:visitId` endpoint — returns full visit + visitor + hostUser data
- Added `PATCH /api/v1/visitors/:visitorId` endpoint — updates visitor personal information
- Added `GET /api/v1/visitors/:visitorId/photo` endpoint — serves visitor photo as JPEG
- Created `UpdateVisitorDto` with validation for all editable visitor fields
- Added `photoBase64` field to `CreateVisitorDto` — accepts base64 photo during registration
- Photos saved to `uploads/photos/{visitorId}.jpg` on disk, path stored in `visitor.photoPath`
- Created `VisitorDetailModal.tsx` component:
  - Shows visitor photo (or initials fallback if no photo)
  - Shows full visit information (purpose, host, scheduled times, check-in/out, access method, status)
  - Shows full visitor personal data (name, email, phone, company, position, document, nationality)
  - Edit mode allows modifying visitor fields inline with save/cancel
  - Toast notifications for save success/error
  - Fully translated in 4 languages (ES, EN, PT, KO) — 35+ new translation keys
- RegisterWalkInModal now sends captured photo to backend during visitor creation
- Visitor list table now shows photo thumbnails (round avatar) for visitors with photos
- Made visitor rows clickable in the visitors table to open the detail modal
- Action buttons (print, check-in, check-out) use `stopPropagation` to avoid conflict
- Fixed field name mismatches in `VisitResponse` interface: `scheduledStartTime` → `scheduledAt`, `host` → `hostUser`, `name` → `fullName`
- Fixed `Invalid time value` error on Print Badge button caused by undefined date field

### Session 10 — Credential Enrollment: QR Barcode 2-step + Visual Face Templates
- **Visual Face (FaceStation F2 / BioStation 3)** — flujo de 2 pasos integrado en `syncWithConnection`:
  - Paso 1: `PUT /api/users/check/upload_picture` con la foto del visitante en Base64 (leída del disco, `uploads/photos/`). BioStar valida la calidad del rostro y devuelve `template_ex_normalized_image` + array `templates[]`.
  - Paso 2: Los templates se incluyen en `POST /api/users` en el nodo exacto `User.credentials.visualFaces[{template_ex_normalized_image, templates}]`.
  - Si BioStar devuelve 400 (foto de mala calidad), se lanza `VisualFaceQualityError` y se registra en log con `[VISUAL_FACE]` sin bloquear la creación del usuario local (soft-fail).
  - Nuevo método privado `extractVisualFaceTemplates(apiUrl, headers, httpsAgent, photoBase64): Promise<VisualFaceData>`.
  - Nueva interfaz `VisualFaceData { template_ex_normalized_image, templates[] }`.
- **QR Barcode enrollment 2 pasos** — reemplaza el antiguo `assignQrCard` (que usaba `card_type.id=2` y era 1-paso):
  - Paso 1: `POST /api/cards` con `card_type: { id: '6', type: '6' }` (QR/Barcode estándar BioStar). Captura el ID interno retornado.
  - Paso 2: `PUT /api/users/:supremaUserId` con `User.cards: [{ id: internalCardId }]`.
  - Nuevo método privado `enrollQrCard(apiUrl, headers, httpsAgent, supremaUserId, qrJti)`.
- **`createBioStarUser`** acepta ahora el parámetro opcional `visualFaceTemplates?: VisualFaceData`.
- Añadido `import * as path from 'path'` al sync service.

### Session 9 — Access Groups (Grupos de Acceso BioStar)
- **`GET /api/v1/access-groups`** — nuevo endpoint; autenticado por JWT; consulta BioStar 2 (`GET /api/access_groups`), cachea resultado en Redis (TTL 1 h) con clave `accessgroups:{tenantId}`; retorna `{ id: number, name: string }[]`.
- **`Visit.accessGroups`** — nueva columna JSONB en la entidad `visits`; almacena `{ id, name }[]` para visualización rápida sin lookups adicionales.
- **`CreateVisitDto.accessGroups`** — campo opcional `AccessGroupDto[]`; validado con `class-validator`.
- **`SupremaSyncService.getAccessGroups(tenantId)`** — método público con caché Redis (1 h); maneja auth BioStar, parseo de `AccessGroupCollection.rows`, y logs de auditoría (`SYNC_ERROR`/`access_groups.fetched`).
- **`SupremaSyncService.syncWithConnection`** — pasa `accessGroups` a `createBioStarUser`; el nodo `access_groups: [{ id: String(id) }]` se incluye en el payload `POST /api/users` de BioStar 2.
- **`forceSyncVisit`** — restaura y pasa los `accessGroups` guardados en la visita al re-sincronizar.
- **`AccessGroupsController`** — `access-groups.controller.ts` en VisitorsModule.
- **Frontend `AccessGroupSelect.tsx`** — multi-select dropdown; skeleton loader mientras carga; alerta roja si API falla; badges con `×` para remover; dropdown cierra al click fuera.
- **`RegisterWalkInModal.tsx`** — fetcha grupos al abrir modal; sección "4. Niveles de Acceso Permitidos" entre foto y credenciales; `canSubmit` bloqueado si `accessGroupsError`; envía `accessGroups` en payload de `POST /visitors/schedule`.
- **`dashboard/visitors/page.tsx`** — columna "Grupos de Acceso" (defaultVisible: true); badges azules con ícono Shield por cada grupo; texto "Sin acceso" en gris cuando no hay grupos asignados.

### Session 7 — Check-in real, Auto-checkout & Overtime
- `PUT /visitors/visit/:visitId/checkin` — endpoint de check-in manual (SCHEDULED/PRE_REGISTERED → CHECKED_IN). Registra `checkedInAt`, `checkedInByUserId`, emite evento WebSocket `visit.checked_in`.
- `POST /visitors/bulk-checkout` — checkout masivo de todas las visitas activas del tenant.
- `AutoCheckoutService` — cron `@nestjs/schedule` que se ejecuta cada minuto. Configuración por tenant en Redis (`autocheckout:{tenantId}`): `enabled`, `hour`, `minute`, `defaultMaxStayMinutes`.
- Endpoints de settings: `GET/PUT /visitors/settings/auto-checkout`, `POST /visitors/settings/auto-checkout/trigger`.
- `ScheduleModule.forRoot()` añadido a `app.module.ts`.
- `lookupByDocument` retorna ahora `activeVisit` (objeto con `id`, `status`, `checkedInAt`, `scheduledAt`, `maxStayMinutes`).
- **Hard-block CHECKED_IN en RegisterWalkInModal**: si el visitante ya está dentro (status=CHECKED_IN), el modal bloquea el registro y muestra la hora de check-in. No hay opción de "force-register".
- **Soft-block visita duplicada**: mantiene el bypass por confirmación del operador para status SCHEDULED/PRE_REGISTERED.
- **Dashboard de visitantes**:
  - Botón check-in ahora llama al API real (reemplaza "coming soon")
  - Badge de overtime en rojo para visitas CHECKED_IN que excedieron `maxStayMinutes`
  - Banner de alerta si hay visitantes en overtime
  - Panel de configuración de auto-checkout (toggle on/off, hora, minuto, estadía máx., botón "ejecutar ahora")
  - Columna status muestra hora de ingreso para visitas CHECKED_IN
  - `PRE_REGISTERED` aparece correctamente en tabs y botones

### Session 5 — Full i18n System
- Implemented complete frontend internationalization (4 languages: ES, EN, PT, KO)
- Created `src/i18n/translations.ts` with ~120+ translation keys per language covering all UI strings
- Created `src/i18n/I18nContext.tsx` with React Context provider + `useI18n()` hook
- Created `src/app/providers.tsx` to wrap the app with `I18nProvider`
- Language preference persisted in `localStorage` (`biovisitor_lang` key)
- Language selector in dashboard header now fully functional (switches all UI text)
- Updated all pages: login, dashboard, visitors, reports
- Updated all components: RegisterWalkInModal, FaceCaptureModal, PrintBadgeModal, dashboard layout
- Default language: Spanish (ES)
- `t()` function supports parameter interpolation (e.g., `{name}`, `{count}`)

### Session 4 — Facial Capture Module
- Created `FaceCaptureModal.tsx` component with oval guide overlay (react-webcam + face-api.js)
- **Comprehensive client-side face quality validation** using face-api.js (SSD MobileNet V1 + FaceLandmark68 full + FaceExpression):
  - Face detection with SSD MobileNet V1 (more accurate than TinyFaceDetector)
  - Yaw estimation (head turned left/right) — rejects if >20° off center
  - Pitch estimation (head tilted up/down) — rejects if >15° off center
  - Facial symmetry analysis — catches side-angle faces the pose check might miss
  - Eye Aspect Ratio (EAR) — rejects closed eyes (threshold 0.19)
  - Expression detection — rejects non-neutral expressions (happy/angry/sad/etc >0.6 confidence)
  - Multiple face detection — rejects if more than one person in frame
  - Forehead visibility check — rejects if forehead/eyebrows are obscured
  - Face size check (must be >= 6% of image area)
  - Face centering check (within 28% offset tolerance)
  - Brightness/lighting analysis — rejects too dark (<40) or overexposed (>230)
  - On-screen instructions panel with all requirements listed
  - Models served from `public/models/` (~6.5MB total: ssd_mobilenetv1 + landmarks68 + expressions)
  - Validation logic extracted to `src/lib/face-quality.ts` (clean separation)
- Added `POST /api/v1/visitors/validate-face` backend endpoint
- `ValidateFaceDto` DTO validates base64 image input
- `VisitorsService.validateFaceImage()` strips data URI prefix, validates size (10 MB max), sends to BioStar via SupremaGateway
- `ISupremaClient.validateFaceTemplate()` added to interface + BioStar2Client + BioStarXClient implementations
- `FaceValidationResult` interface with `valid`, `image`, `imageTemplate`, `imageTemplate2`, `errorMessage` fields
- When BioStar is unreachable or not configured, client-side face-api.js validation is the primary quality gate
- Backend returns HTTP 400 on BioStar validation failure; connection errors fall through gracefully
- Error state forces retake (no skip button) — user must provide a quality photo
- Integrated `FaceCaptureModal` into `RegisterWalkInModal` Step 2 — replaces raw video/canvas camera code
- Fixed tailwindcss resolution: symlinked `node_modules/tailwindcss` from frontend to root workspace
- Dependencies added: `react-webcam`, `face-api.js` (frontend)

### Session 3 — API Proxy Fix
- Added Next.js rewrites proxy in `next.config.ts` for `/api/v1/*` and `/socket.io/*`
- Changed `NEXT_PUBLIC_API_URL` from external Replit URL to `/api/v1` (relative path)
- Created `PROJECT_CONTEXT.md` as the master reference document

### Session 2 — Full Audit & Fix
- Dashboard fetches real data from `/visitors/active` API
- Placeholder pages for Access Logs and Settings (no more 404s)
- All non-functional buttons show "Coming Soon" toasts
- Pre-registration validates token via API and submits to real backend
- useSocket memory leak fixed
- Login "Remember me" and "Forgot password" wired up
- REPLIT_TO_LOCAL.md updated

## Important Notes
- This is a temporary Replit workspace; the project is designed for on-premise deployment
- Do NOT modify the architecture or how services connect — see PROJECT_CONTEXT.md section 7
- TypeORM synchronize is enabled in development mode (auto-creates tables)
- The `JobQueueModule` is commented out (requires Redis 6.2+)
- Identity visual: Infinite Burgundy RGB(161,41,68) + Classy Gray palette
