# CONTEXTO MAESTRO: BioVisitor X

Este documento es la referencia absoluta del proyecto. Debe consultarse antes de cualquier decisión de diseño, implementación o cambio arquitectónico.

---

## 1. Visión del Producto

BioVisitor X es un **Sistema de Gestión de Visitantes de nivel corporativo** diseñado para integrarse de forma nativa e invisible con las plataformas **BioStar 2** y **BioStar X** de Suprema a través de sus APIs REST/JSON.

El objetivo es construir un VMS que recopile las mejores prácticas a nivel mundial en seguridad y experiencia de usuario, para ser distribuido a los clientes de Suprema como solución complementaria a sus sistemas de control de acceso biométrico.

---

## 2. Funcionalidades Clave

### 2.1 Registro en Recepción (Walk-in)
- Registro presencial de visitantes por el recepcionista
- Enrolamiento facial vía WebCam o lectores Suprema de reconocimiento facial
- Enrolamiento de huella dactilar vía lectores/enroladores Suprema
- Enrolamiento de tarjeta RFID vía lectores Suprema o lectores USB de terceros
- Captura de foto del visitante mediante cámara web
- Lectura de pasaportes/DNI con OCR para llenado automático de campos
- Lectura de código de barras/QR de documentos de identidad
- Impresión de stickers/gafetes de identificación en recepción

### 2.2 Portal de Pre-registro
- Enlace público con token único donde los visitantes agendados completan sus datos antes de llegar
- Captura de selfie (foto de rostro) desde el móvil del visitante
- Sincronización automática con BioStar al completar el pre-registro
- Formulario multi-paso (datos personales, documento, foto)

### 2.3 Automatización de Accesos (Integración BioStar)
- Al hacer Check-in: enrolar al visitante en los dispositivos Suprema seleccionados
- Al hacer Check-out: eliminar automáticamente al visitante de los dispositivos Suprema para no saturar la memoria del hardware
- Soporte para múltiples métodos de acceso: facial, huella, RFID, QR dinámico, manual

### 2.4 Credenciales Ágiles
- Generación de Códigos QR Dinámicos (temporales, de uso único) almacenados en Redis con TTL
- Envío automático de QR por correo electrónico al visitante
- Impresión de badges/gafetes de identificación formato CR80 (54x85mm)

### 2.5 Reportes y Auditoría
- Exportación de reportes de visitas en CSV y PDF
- Logs de auditoría estructurados (persistencia dual: consola + base de datos)
- Registro de eventos de seguridad (login, check-in, check-out, pre-registro)

### 2.6 Dashboard en Tiempo Real
- Visualización de visitantes esperados (Scheduled) y en el edificio (In Building)
- Actualización en tiempo real vía WebSockets
- Estadísticas: visitantes activos, checked-in, agendados, excepciones

---

## 3. Arquitectura Técnica

### 3.1 Stack Tecnológico (NO MODIFICAR)

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Backend | NestJS (Node.js) | 11.x |
| Lenguaje | TypeScript | Estricto |
| Base de Datos | PostgreSQL + TypeORM | Sincronización automática en dev |
| Caché/Colas | Redis + Bull/BullMQ | Para tokens QR, bs-session-id, jobs |
| Frontend | Next.js (React) | 16.x |
| Estilos | Tailwind CSS | 4.x |
| Comunicación API | Axios con interceptores | Para manejo de sesiones y JWT |
| WebSockets | Socket.IO (NestJS Gateway) | Eventos en tiempo real |
| Autenticación | JWT + bcrypt | Tokens con expiración |
| Cifrado | AES-256-GCM | Para credenciales BioStar almacenadas |

### 3.2 Estructura del Proyecto

```
biovisitor-backend/                    # NestJS API (puerto 3001, prefijo /api/v1)
  src/
    core/                              # Configuración, seguridad, crypto, logging
      config/                          # Configuración de la app y seguridad
      crypto/                          # Servicio de cifrado AES-256-GCM
      logging/                         # Logger estructurado (3 categorías)
    database/
      entities/                        # Entidades TypeORM
        visitor.entity.ts              # Visitante (datos personales, documento, foto)
        visit.entity.ts                # Visita (check-in/out, método acceso, status)
        user.entity.ts                 # Usuarios del VMS (admin, recepcionista)
        tenant.entity.ts               # Multi-tenancy
        audit-log.entity.ts            # Logs de auditoría
        qr-token.entity.ts             # Tokens QR dinámicos
        pre-registration-token.entity  # Tokens de pre-registro
    modules/
      auth/                            # Login JWT, Passport strategies
      visitors/                        # CRUD visitantes, check-in/out, pre-registro
      qr-engine/                       # Generación de QR dinámicos con TTL
      suprema-gateway/                 # Abstracción BioStar 2 / BioStar X (Strategy/Facade)
      events/                          # WebSocket Gateway para tiempo real
      notifications/                   # Notificaciones por email (Nodemailer)
      reports/                         # Generación CSV y PDF
      i18n/                            # Internacionalización (es/en)
      job-queue/                       # Colas asíncronas Bull para sync con BioStar

biovisitor-frontend/                   # Next.js (puerto 5000 en Replit, 3000 en local)
  src/
    app/                               # App Router (páginas)
      page.tsx                         # Login
      dashboard/
        page.tsx                       # Overview (estadísticas, arrivals recientes)
        layout.tsx                     # Sidebar + header
        visitors/page.tsx              # Gestión de visitantes (tabla, acciones)
        logs/page.tsx                  # Access Logs (placeholder)
        settings/page.tsx              # Settings (placeholder)
        reports/page.tsx               # Reportes
      pre-register/[token]/page.tsx    # Portal público de pre-registro
    components/
      RegisterWalkInModal.tsx          # Modal de registro presencial con cámara
      PrintBadgeModal.tsx              # Modal de impresión de gafete CR80
    hooks/
      useSocket.ts                     # Hook WebSocket con cleanup
    lib/
      api.ts                           # Cliente Axios centralizado con interceptores
```

### 3.3 Módulo Suprema Gateway (Pieza Central)

Este módulo es la capa de abstracción que maneja la integración con BioStar:

- **Patrón Strategy/Facade:** Permite cambiar entre BioStar 2 y BioStar X sin modificar el resto del código
- **Gestión de `bs-session-id`:** Token obligatorio en el header de cada petición a BioStar. Se almacena en Redis con TTL para auto-refresco
- **BioStar 2:** Login vía `POST /api/login`, sesión cookie-based
- **BioStar X:** Arquitectura de microservicios local, autenticación basada en tokens
- **Endpoints clave:**
  - Enrolamiento facial: `/api/users/{id}/face`
  - Enrolamiento huella: `/api/users/{id}/fingerprint` o `scan_fingerprint`
  - Gestión de usuarios: CRUD completo en BioStar
  - Grupos de acceso: Asignar/remover visitantes de grupos de dispositivos

### 3.4 Flujo de Datos Principal

```
[Visitante llega] → [Recepcionista registra en VMS]
    → [VMS crea Visitor + Visit en PostgreSQL]
    → [VMS llama a Suprema Gateway]
        → [Gateway enrola usuario en BioStar 2/X]
        → [Gateway asigna grupo de acceso temporal]
    → [VMS genera QR dinámico (Redis TTL)]
    → [VMS imprime badge / envía email con QR]
    → [WebSocket notifica al dashboard]

[Visitante hace Check-out] → [VMS actualiza Visit]
    → [Bull Job: Gateway elimina usuario de BioStar]
    → [Redis: invalida QR token]
    → [WebSocket: actualiza dashboard]
```

---

## 4. API Backend - Endpoints Actuales

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/v1/auth/login` | Login (devuelve JWT + datos usuario) |
| GET | `/api/v1/auth/me` | Datos del usuario autenticado |
| POST | `/api/v1/visitors` | Crear visitante (fullName, documento, empresa) |
| POST | `/api/v1/visitors/schedule` | Agendar visita (visitorId, reason, horarios, accessMethod) |
| GET | `/api/v1/visitors/active` | Listar visitas activas (scheduled + checked-in) |
| PUT | `/api/v1/visitors/checkout/:visitId` | Check-out de visitante |
| POST | `/api/v1/pre-registration/generate` | Generar link de pre-registro (visitId) |
| GET | `/api/v1/pre-registration/token/:token` | Validar token de pre-registro |
| POST | `/api/v1/pre-registration/token/:token/complete` | Completar pre-registro |
| GET | `/api/v1/reports/visits/csv` | Exportar reporte CSV |
| GET | `/api/v1/reports/visits/pdf` | Exportar reporte PDF |

---

## 5. Modelos de Datos Clave

### Visitor (Visitante)
- `fullName`, `firstName`, `lastName` (separados automáticamente)
- `email`, `phone`, `company`, `position`, `nationality`
- `documentType`: NATIONAL_ID, PASSPORT, FOREIGN_ID, DRIVERS_LICENSE
- `documentNumber`, `photoPath`, `ocrData` (JSON)
- `tenantId` (multi-tenancy)

### Visit (Visita)
- `visitorId`, `hostUserId`, `tenantId`
- `purpose`, `department`
- `scheduledAt`, `expectedEndAt`, `checkedInAt`, `checkedOutAt`
- `accessMethod`: FACE, FINGERPRINT, RFID, QR_DYNAMIC, MANUAL
- `status`: SCHEDULED, PRE_REGISTERED, CHECKED_IN, CHECKED_OUT, CANCELLED
- `supremaUserRefId` (ID del usuario temporal creado en BioStar)
- `syncStatus`: PENDING, SYNCED, FAILED, NOT_REQUIRED

---

## 6. Identidad Visual (Manual de Marca Suprema)

### Colores Principales
- **Infinite Burgundy:** RGB(161, 41, 68) - Color primario, CTAs, acentos
- **Classy Gray (900):** Para textos y fondos oscuros
- **Classy Gray (100):** Para fondos claros y bordes

### Principios de Diseño
- Premium, institucional, moderno
- Glassmorphism sutil (backdrop-blur, transparencias)
- Transiciones suaves en interacciones
- Bordes redondeados (rounded-xl, rounded-2xl)
- Sombras con tinte burgundy en botones principales
- Tipografía bold para títulos, semibold para labels

### Clases Tailwind del Proyecto
- `bg-suprema-burgundy` / `bg-suprema-burgundy-dark` / `text-suprema-burgundy`
- `bg-suprema-gray-900` / `bg-suprema-gray-800` / `bg-suprema-gray-100`
- `shadow-suprema-burgundy/20` (sombras con color)

---

## 7. Reglas Inquebrantables

### 7.1 Arquitectura
- **NUNCA** migrar frameworks, cambiar TypeORM por otro ORM, ni alterar la estructura modular de NestJS
- **NUNCA** hardcodear configuraciones que rompan la ejecución local vía `.env`
- La arquitectura debe ser **stateless** para escalar horizontalmente
- Todo dato sensible (credenciales BioStar) se cifra con AES-256-GCM

### 7.2 Entorno Replit
- Replit es **ÚNICAMENTE** un entorno de desarrollo temporal
- El producto final siempre será **On-Premise** (servidores físicos del cliente)
- Cualquier adaptación específica de Replit debe documentarse en `REPLIT_TO_LOCAL.md`
- El proxy de Next.js (`rewrites` en next.config.ts) es adaptación de Replit y debe removerse en on-premise

### 7.3 Frontend
- Todo componente nuevo debe seguir la identidad visual Suprema
- Usar la paleta de colores definida (burgundy + gray)
- Diseño responsive (mobile-first para portal de pre-registro)
- Componentes no implementados deben mostrar "Coming Soon" en lugar de estar rotos

### 7.4 Seguridad
- Comunicación con BioStar siempre por **HTTPS**
- JWT en todas las rutas protegidas
- Tenant isolation en todas las queries
- Whitelist de DTOs estricta (class-validator con whitelist + transform)
- Rate limiting (Throttler) en endpoints públicos

---

## 8. Credenciales de Desarrollo

- **Admin:** admin@supremainc.com / Suprema2026!
- **Tenant:** Suprema HQ
- **Backend:** http://localhost:3001/api/v1
- **Frontend:** http://localhost:5000 (Replit) / http://localhost:3000 (local)

---

## 9. Próximos Módulos por Implementar

1. **Integración real con BioStar 2/X:** Conectar el Suprema Gateway con un servidor BioStar real
2. **OCR de documentos:** Lectura automática de pasaportes/DNI
3. **Enrolamiento biométrico:** Captura facial y de huella desde el frontend
4. **Lectura de SmartCard/RFID:** Integración con lectores USB
5. **QR Scanner:** Escaneo de QR para check-in rápido
6. **Colas Bull:** Re-habilitar job-queue para sincronización asíncrona con BioStar
7. **Multi-idioma funcional:** i18n real (es/en/pt/ko)
8. **Búsqueda global:** Buscar visitantes por nombre, empresa, documento
9. **Access Logs:** Visualización de eventos de acceso de BioStar
10. **Settings:** Panel de configuración del tenant (dispositivos, grupos, políticas)
