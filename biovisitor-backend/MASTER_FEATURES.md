# BioVisitor X — Documento Maestro de Funcionalidades

> Este documento se actualiza con cada nueva funcionalidad implementada.
> Última actualización: 2026-02-26

---

## Módulos Implementados

### 1. Core — Configuración (`src/core/config/`)
| Funcionalidad | Archivo | Estado |
|---|---|---|
| Variables de entorno tipadas con 8 namespaces (database, redis, jwt, biostar2, biostarx, qr, email, app) | `env.config.ts` | ✅ Completo |
| Barrel export de configuraciones | `index.ts` | ✅ Completo |

---

### 2. Core — Ciberseguridad (`src/core/security/`)
| Funcionalidad | Archivo | Estado |
|---|---|---|
| Helmet (headers HTTP: CSP, HSTS, X-Frame-Options) | `security.config.ts` | ✅ Completo |
| CORS estricto con lista de orígenes | `security.config.ts` | ✅ Completo |
| Validación global de DTOs (whitelist + transform) | `security.config.ts` | ✅ Completo |
| Trust Proxy para IP real | `security.config.ts` | ✅ Completo |
| Rate Limiting 3 niveles (10/s, 100/min, 1000/h) | `app.module.ts` | ✅ Completo |

---

### 3. Core — Cifrado (`src/core/crypto/`)
| Funcionalidad | Archivo | Estado |
|---|---|---|
| Cifrado AES-256-GCM para datos en reposo | `encryption.service.ts` | ✅ Completo |
| IV aleatorio por operación | `encryption.service.ts` | ✅ Completo |
| Validación de clave maestra (64 hex chars) | `encryption.service.ts` | ✅ Completo |
| Generador de clave maestra | `encryption.service.ts` | ✅ Completo |
| Hash SHA-256 para tokens QR | `encryption.service.ts` | ✅ Completo |

---

### 4. Core — Logging Estructurado (`src/core/logging/`)
| Funcionalidad | Archivo | Estado |
|---|---|---|
| 3 categorías: USER_ACTION, OPERATIONAL, AUDIT_EVENT | `structured-logger.service.ts` | ✅ Completo |
| Winston con rotación de archivos (10MB × 30 archivos) | `structured-logger.service.ts` | ✅ Completo |
| Archivo separado para errores | `structured-logger.service.ts` | ✅ Completo |
| Archivo separado para auditoría (90 archivos) | `structured-logger.service.ts` | ✅ Completo |
| Formato JSON compatible con ELK/SIEM | `structured-logger.service.ts` | ✅ Completo |
| Correlation IDs para trazabilidad | `structured-logger.service.ts` | ✅ Completo |

---

### 5. Base de Datos — Entidades (`src/database/entities/`)
| Entidad | Archivo | Descripción | Estado |
|---|---|---|---|
| Tenant | `tenant.entity.ts` | Multi-tenancy con credenciales cifradas | ✅ Completo |
| User | `user.entity.ts` | Operadores VMS (Admin/Operator/Host) | ✅ Completo |
| Visitor | `visitor.entity.ts` | Datos personales reutilizables | ✅ Completo |
| Visit | `visit.entity.ts` | Ciclo de vida completo de visitas | ✅ Completo |
| AccessCredential | `access-credential.entity.ts` | QR tokens, RFID, biométricos | ✅ Completo |
| AuditLog | `audit-log.entity.ts` | Registro inmutable (append-only) | ✅ Completo |
| Blacklist | `blacklist.entity.ts` | Visitantes bloqueados | ✅ Completo |
| PreRegistration | `pre-registration.entity.ts` | Pre-registro remoto con tokens | ✅ Completo |
| VisitorDocument | `visitor-document.entity.ts` | Documentos con rutas cifradas | ✅ Completo |

---

### 6. Suprema Gateway (`src/modules/suprema-gateway/`)
| Funcionalidad | Archivo | Estado |
|---|---|---|
| Interfaz ISupremaClient (Strategy Pattern) | `interfaces/suprema-client.interface.ts` | ✅ Completo |
| BioStar 2 Client (bs-session-id + Redis cache) | `biostar2/biostar2.client.ts` | ✅ Completo |
| BioStar X Client (microservices auth) | `biostarx/biostarx.client.ts` | ✅ Completo |
| Circuit Breaker (CLOSED/OPEN/HALF_OPEN) | `circuit-breaker/circuit-breaker.service.ts` | ✅ Completo |
| Gateway Orchestrator (Facade + Strategy) | `suprema-gateway.service.ts` | ✅ Completo |
| Reintento automático en sesión expirada (401) | BioStar 2/X clients | ✅ Completo |

---

### 7. Motor QR Dinámico (`src/modules/qr-engine/`)
| Funcionalidad | Archivo | Estado |
|---|---|---|
| Generación JWT de uso único | `qr-engine.service.ts` | ✅ Completo |
| Invalidación atómica con Redis DEL | `qr-engine.service.ts` | ✅ Completo |
| Anti-compartición (segundo uso rechazado) | `qr-engine.service.ts` | ✅ Completo |
| QR en colores Suprema (Infinite Burgundy) | `qr-engine.service.ts` | ✅ Completo |
| Expiración configurable (default 15 min) | `qr-engine.service.ts` | ✅ Completo |
| Revocación manual de QR | `qr-engine.service.ts` | ✅ Completo |

---

### 8. Autenticación VMS (`src/modules/auth/`)
| Funcionalidad | Archivo | Estado |
|---|---|---|
| Login con bcrypt (12 rounds) | `auth.service.ts` | ✅ Completo |
| Bloqueo de cuenta (5 intentos → 15 min) | `auth.service.ts` | ✅ Completo |
| JWT con roles (Admin/Operator/Host) | `auth.service.ts` | ✅ Completo |
| Auditoría de logins (exitosos y fallidos) | `auth.service.ts` | ✅ Completo |

---

### 9. Infraestructura
| Funcionalidad | Archivo | Estado |
|---|---|---|
| Docker Compose (PostgreSQL 16 + Redis 7) | `docker-compose.yml` | ✅ Completo |
| Variables de entorno documentadas | `.env.example` | ✅ Completo |
| Bootstrap con seguridad | `src/main.ts` | ✅ Completo |
| Wiring de módulos | `src/app.module.ts` | ✅ Completo |

---

## Módulos Pendientes

| Módulo | Descripción | Estado |
|---|---|---|
| Visitors CRUD | Crear, buscar, actualizar, check-in/check-out | ✅ Completo |
| Pre-registro Portal | API de pre-registro con token único | ✅ Completo |
| Frontend Core | Setup Next.js, Tailwind v4, Inter font, Suprema Colors | ✅ Completo |
| Dashboard UI | Login, Layout, Panel principal con analíticas base | ✅ Completo |
| Reception App UI | Vista para administrar visitantes, check-in, simulador escaneo | ✅ Completo |
| Pre-registro UI | Portal público responsivo, selección de doc, placeholder foto | ✅ Completo |
| Hardware Integration | Webcam, RFID, huella, pasaporte, barcode | ⏳ Pendiente |
| Auditoría Persistente | Guardado de logs en PostgreSQL | ✅ Completo |
| Multi-language (i18n) | ES, EN, PT, KO | ⏳ Pendiente |
| Frontend Dashboard | Next.js con diseño Suprema | ✅ Completo |
| WebSockets Tiempo Real | Eventos de visitantes en vivo | ✅ Completo |
