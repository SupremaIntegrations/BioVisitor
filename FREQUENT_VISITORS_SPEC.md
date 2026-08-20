# Especificación Técnica: Módulo de Gestión y Monitoreo de Visitantes Frecuentes
**BioVisitor X — Versión 2.0 | Documento Confidencial**
**Clasificación: INTERNO — Solo personal autorizado**

---

## Resumen Ejecutivo

El presente documento define la especificación técnica, funcional y de cumplimiento normativo para la implementación del **Módulo de Gestión y Monitoreo de Visitantes Frecuentes** dentro de la plataforma BioVisitor X. El diseño sigue el principio de **Privacy by Design (ISO 31700)**, garantizando que los controles de privacidad estén integrados desde la arquitectura y no aplicados como capas posteriores.

**Audiencia:** Arquitecto Principal, DPO, Responsable de Seguridad Física, Equipo de Desarrollo.

---

## Posicionamiento en la Interfaz de Usuario (UI/UX)

### Directriz de Maquetación — Obligatoria

El módulo de **Visitantes Frecuentes** se ubicará en el **Menú de Visitantes** como la **última pestaña, al extremo derecho** de todas las opciones de navegación disponibles. Esta posición es un requerimiento de gobernanza de información: la mayor sensibilidad de los datos agregados (perfiles de comportamiento, patrones de acceso) justifica su segregación visual y de acceso respecto a las vistas operativas cotidianas.

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ MENÚ VISITANTES                                                                     │
│                                                                                     │
│  [ Esperados ]  [ En Instalaciones ]  [ Todos ]  [ No-Show ]  ★ [ Frec. ]          │
│                                                                  ▲ EXTREMO DERECHO   │
│                                                                  Acceso restringido  │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

**Justificación:** El principio de mínima exposición dicta que los perfiles de visitantes recurrentes —que contienen datos agregados de comportamiento— no deben ser accesibles de forma inmediata en el flujo operativo de un operador de recepción. La posición al extremo derecho, con estilo visual diferenciado (color dorado/estrella), actúa como señalizador visual de "zona de datos sensibles".

---

## Eje 1 — Motor de Reglas: Clasificación de Visitante Frecuente

### 1.1 Parámetros Configurables por Tenant

| Parámetro | Clave Redis | Valor por Defecto | Rango Válido | Descripción |
|---|---|---|---|---|
| `minVisits` | `frequent:config:{tenantId}:minVisits` | `3` | `2 – 50` | Umbral mínimo de visitas N para clasificar como frecuente |
| `windowDays` | `frequent:config:{tenantId}:windowDays` | `180` | `7 – 730` | Ventana de tiempo móvil T en días (rolling window) |
| `cacheMinutes` | `frequent:config:{tenantId}:cacheTTL` | `15` | `1 – 60` | TTL del caché Redis para el conteo de visitas |

### 1.2 Segmentación por Tipo de Visitante

| Tipo (`visitorType`) | Umbral Recomendado | Justificación de Negocio |
|---|---|---|
| `CONTRACTOR` | N ≥ 3 en 90 días | Contratistas recurrentes requieren credenciales temporales preconfiguradas |
| `SUPPLIER` | N ≥ 5 en 180 días | Proveedores frecuentes → candidatos a pre-autorización de acceso |
| `VIP` | N ≥ 2 en 365 días | VIPs no requieren umbral alto; cualquier recurrencia activa el perfil |
| `INTERVIEW` | N ≥ 2 en 30 días | Candidatos con múltiples entrevistas → flag de proceso activo |
| `WALK_IN` | N ≥ 3 en 30 días | Walk-ins sin agendar con alta recurrencia → candidatos a pre-registro |

### 1.3 Fórmula Lógica de Clasificación

```
FUNCIÓN clasificar_frecuente(visitorId, tenantId, config):

  config = OBTENER_DESDE_REDIS("frequent:config:{tenantId}") 
           ?? { minVisits: 3, windowDays: 180 }

  windowStart = AHORA() - config.windowDays días

  visitCount = CONTAR(visits) DONDE:
    visits.visitorId = visitorId
    AND visits.tenantId = tenantId
    AND visits.scheduledAt >= windowStart
    AND visits.status IN ['CHECKED_IN', 'CHECKED_OUT', 'SCHEDULED']

  isFrecuent = (visitCount >= config.minVisits)

  RETORNAR {
    isFrecuent,
    visitCount,
    windowDays: config.windowDays,
    evaluatedAt: AHORA()
  }
```

### 1.4 Caché y Consistencia

- El `visitCount` por visitante se almacena en Redis con clave `visitcount:{tenantId}:{visitorId}` y TTL de 15 minutos.
- Se invalida inmediatamente ante eventos `visit.checked_in`, `visit.checked_out` y `visit.cancelled` vía el sistema de eventos WebSocket interno.
- La clasificación "frecuente" se persiste como campo desnormalizado `isFrecuent: boolean` en la tabla `visitors` y se recalcula en cada check-in/check-out para mantener coherencia.

---

## Eje 2 — Máscaras de Privacidad y Desidentificación en Reportes

### 2.1 Tabla de Visibilidad por Campo y Rol

| Campo | ADMIN | SUPERVISOR | OPERATOR | HOST | AUDITOR / DPO |
|---|---|---|---|---|---|
| ID Interno (UUID) | ✅ Completo | ✅ Completo | ✅ Completo | ❌ Oculto | ✅ Completo |
| ID Anonimizado (SHA-256 truncado) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Nombre Completo | ✅ | ✅ | 🔶 `Jua* Pér*` | ✅ (solo sus visitas) | ✅ |
| Número de Documento | ✅ | 🔶 `***-5678` | ❌ Oculto | ❌ Oculto | ✅ |
| Tipo de Documento | ✅ | ✅ | ❌ Oculto | ❌ Oculto | ✅ |
| Email | ✅ | ✅ | ❌ Oculto | ❌ Oculto | ✅ |
| Teléfono | ✅ | 🔶 `+57 *** ***1234` | ❌ Oculto | ❌ Oculto | ✅ |
| Empresa / Organización | ✅ | ✅ | ✅ | ✅ | ✅ |
| Foto / Biométrico | ✅ | ✅ Vista previa | ❌ Oculto | ❌ Oculto | ✅ Metadato |
| Área Visitada | ✅ | ✅ | ✅ | ✅ | ✅ |
| Anfitrión | ✅ | ✅ | ✅ | Solo el propio | ✅ |
| Número de Visitas (N) | ✅ | ✅ | ❌ Oculto | ❌ Oculto | ✅ |
| Fecha Primera/Última Visita | ✅ | ✅ | ❌ Oculto | ❌ Oculto | ✅ |
| Grupos de Acceso BioStar | ✅ | ✅ | ❌ Oculto | ❌ Oculto | ✅ |

**Leyenda:** ✅ Dato completo | 🔶 Enmascarado / Tokenizado | ❌ No visible

### 2.2 Algoritmo de Enmascaramiento

```typescript
function maskField(value: string, role: UserRole, strategy: 'name' | 'document' | 'phone' | 'email'): string {
  if (['ADMIN', 'SUPERVISOR'].includes(role)) return value;
  switch (strategy) {
    case 'name':     return value.split(' ').map(w => w[0] + '*'.repeat(w.length - 1)).join(' ');
    case 'document': return '***-' + value.slice(-4);
    case 'phone':    return value.slice(0, 4) + ' *** ***' + value.slice(-4);
    case 'email':    return value[0] + '***@' + value.split('@')[1];
    default:         return '[PROTEGIDO]';
  }
}
```

### 2.3 Exportación de Reportes

- Los reportes **CSV** para `OPERATOR` y `HOST` se generan con datos ya enmascarados en origen (servidor).
- Los reportes **PDF** incluyen marca de agua con el nombre del usuario que exportó y timestamp.
- Toda exportación se registra inmutablemente en `audit_logs` con `eventType: 'frequent_visitors.report_exported'`.

---

## Eje 3 — Matriz de Control de Acceso Basado en Roles (RBAC)

### 3.1 Definición de Permisos

| Operación | ADMIN | SUPERVISOR | OPERATOR | HOST | DPO | SUPPORT |
|---|---|---|---|---|---|---|
| Ver panel Visitantes Frecuentes | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| Ver lista con datos completos | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| Ver lista con datos enmascarados | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| Exportar CSV / PDF | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| Configurar umbral (N, T) | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Ver historial de visitas de un frecuente | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| Ver detalle completo (modal) | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| Revocar clasificación de frecuente | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Consultar logs de auditoría del módulo | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Configurar alertas de anomalías | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |

### 3.2 Justificación de Privilegios

- **OPERATOR / HOST**: Acceso denegado. Un operador de recepción no necesita analítica de comportamiento histórico. El principio de mínimo privilegio impide la exposición de patrones que podrían revelar información sensible (frecuencia de visitas médicas, reuniones confidenciales).
- **SUPERVISOR**: Lectura completa justificada por necesidad operativa de planificación de recursos y coordinación de visitas.
- **DPO**: Acceso de auditoría total incluyendo datos crudos para cumplir con funciones de DPA (Data Protection Authority) según GDPR Art. 37-39 y legislaciones locales (Ley 1581 CO, LGPD BR).

### 3.3 Implementación en NestJS (Guard)

```typescript
@Get('frequent')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'SUPERVISOR', 'DPO')
async getFrequentVisitors(@Req() req, @Query() query: FrequentQueryDto) {
  const role = req.user.role;
  const applyMask = !['ADMIN', 'DPO'].includes(role);
  return this.visitorsService.getFrequentVisitors(req.user.tenantId, query, applyMask);
}
```

---

## Eje 4 — Arquitectura de Datos e Integridad de Conteos

### 4.1 Modelo de Datos

```sql
-- Vista materializada para conteos frecuentes (refresh cada 15 min)
CREATE MATERIALIZED VIEW mv_frequent_visitors AS
SELECT
  v.id            AS visitor_id,
  v.tenant_id,
  v.first_name,
  v.last_name,
  v.company,
  v.visitor_type,
  COUNT(vt.id)    AS visit_count,
  MAX(vt.scheduled_at)  AS last_visit_date,
  MIN(vt.scheduled_at)  AS first_visit_date
FROM visitors v
INNER JOIN visits vt ON vt.visitor_id = v.id
  AND vt.scheduled_at >= NOW() - INTERVAL '180 days'
  AND vt.status IN ('CHECKED_IN', 'CHECKED_OUT', 'SCHEDULED')
GROUP BY v.id, v.tenant_id, v.first_name, v.last_name, v.company, v.visitor_type
HAVING COUNT(vt.id) >= 3;

-- Índice para performance
CREATE UNIQUE INDEX ON mv_frequent_visitors (visitor_id, tenant_id);
CREATE INDEX ON mv_frequent_visitors (tenant_id, visit_count DESC);
```

### 4.2 Mecanismos de Integridad

| Riesgo | Mecanismo de Mitigación | Implementación |
|---|---|---|
| Doble check-in | Constraint `UNIQUE(visitId, status='CHECKED_IN')` + guard en servicio | `visitors.service.ts: checkInVisit()` |
| Registro huérfano | FK con `ON DELETE CASCADE` en `visits.visitorId → visitors.id` | TypeORM `@JoinColumn` + migraciones |
| Conteo corrupto por rollback | Transacciones ACID en `DataSource.transaction()` | `EntityManager` wrapping |
| Race condition en bulk-checkout | Row-level locking `SELECT … FOR UPDATE` | TypeORM `pessimisticWrite` |
| Invalidación de caché | Pub/Sub Redis en eventos de visita | `EventsGateway` → Redis invalidate |

### 4.3 Flujo ACID para Check-in con Actualización de Contador

```
BEGIN TRANSACTION
  1. SELECT visit FOR UPDATE WHERE id = :visitId AND tenantId = :tenantId
  2. VERIFICAR status ∈ {SCHEDULED, PRE_REGISTERED} — ERROR si CHECKED_IN
  3. UPDATE visits SET status='CHECKED_IN', checkedInAt=NOW()
  4. UPDATE visitors SET lastVisitDate=NOW() WHERE id = :visitorId
  5. INSERT INTO audit_logs (eventType='visit.checked_in', ...)
  6. REDIS DEL visitcount:{tenantId}:{visitorId}  ← invalida caché
COMMIT
  → EMIT WebSocket 'visit.checked_in'
  → FIRE-AND-FORGET: BioStar sync
```

---

## Eje 5 — Motor de Alertas y Detección de Anomalías

### 5.1 Reglas de Detección

| ID Alerta | Condición | Criticidad | Canal de Notificación |
|---|---|---|---|
| `FREQ-001` | Ingreso fuera de horario permitido (antes 07:00 o después de 20:00) | 🟡 MEDIA | Dashboard WebSocket + Email Admin |
| `FREQ-002` | Intento de acceso a zona no autorizada (evento BioStar `accessDenied`) | 🔴 ALTA | Dashboard + Email Admin + SMS (opcional) |
| `FREQ-003` | Estadía excesiva: permanencia > 2× `maxStayMinutes` configurado | 🟡 MEDIA | Dashboard WebSocket |
| `FREQ-004` | Pico de frecuencia: +50% visitas en últimos 7 días vs. promedio móvil 30 días | 🟠 MEDIA-ALTA | Email Admin + Registro Auditoría |
| `FREQ-005` | Visitante frecuente ingresa sin pre-registro (walk-in inesperado) | 🔵 BAJA | Nota en Dashboard |
| `FREQ-006` | Visitante frecuente sin check-out después de cierre de instalaciones | 🔴 ALTA | Email Admin + Seguridad Física |
| `FREQ-007` | Documento de identidad marcado como expirado en base de datos | 🟡 MEDIA | Dashboard + Email Operador |

### 5.2 Fórmula de Detección — Pico de Frecuencia (FREQ-004)

```
promedio30d = COUNT(visits) WHERE scheduledAt >= NOW()-30d / 30  [visitas/día]
tasa7d      = COUNT(visits) WHERE scheduledAt >= NOW()-7d  / 7   [visitas/día]

SI (tasa7d - promedio30d) / promedio30d > 0.50 ENTONCES:
  EMITIR alerta FREQ-004 con payload:
    { visitorId, tasa7d, promedio30d, incrementoPct, evaluatedAt }
```

### 5.3 Flujo de Notificación

```
[Cron cada 15 min]
       │
       ▼
  EvalAlertasService.evaluar(tenantId)
       │
       ├─→ [FREQ-001,003,006] ──→ EventsGateway.emit('visitor.alert', payload)
       │                                │
       │                                ▼
       │                        Dashboard (WebSocket, badge rojo)
       │
       └─→ [FREQ-002,004,007] ──→ NotificationsService.sendEmail(adminEmails, template)
                                   + AuditLogService.log('anomaly.detected', payload)
```

---

## Eje 6 — Ecosistema de Integración y Analítica Avanzada

### 6.1 Mapa de Integraciones

| Sistema | Protocolo | Datos Compartidos | Dirección | Frecuencia |
|---|---|---|---|---|
| BioStar 2 / BioStar X | REST HTTPS + WebSocket | Eventos de acceso, zonas, credenciales | Bidireccional | Tiempo real |
| Audit Log (PostgreSQL) | TypeORM / SQL | Todos los eventos del módulo | Solo escritura | Por evento |
| Redis | TCP | Caché de conteos, cola de alertas | Bidireccional | Por evento / TTL |
| Socket.IO (Frontend) | WebSocket | Alertas, actualizaciones de contador | Unidireccional (push) | Tiempo real |
| SIEM Externo | Syslog / JSON HTTP | Logs de auditoría estructurados | Solo push | Por evento |
| BI / Analytics | REST API paginada | Métricas agregadas anonimizadas | Solo lectura | On-demand |

### 6.2 Endpoint de Analítica para BI

```
GET /api/v1/visitors/frequent/metrics?from=2025-01-01&to=2025-12-31&groupBy=month

Respuesta (datos anonimizados — sin PII):
{
  "period": "monthly",
  "data": [
    { "month": "2025-01", "count": 47, "avgVisits": 5.2, "topType": "CONTRACTOR" },
    ...
  ],
  "totalFrequent": 312,
  "totalVisits": 1847
}
```

### 6.3 Integración con BioStar (Webhook de Eventos)

```
BioStar → POST /api/v1/events/biostar-webhook
  payload: { eventType: 'access_denied', userId: '...', doorId: '...', timestamp: '...' }
       │
       ▼
  BiostarEventHandler.handle(event)
       │
       ├─→ Buscar visitante por supremaUserId
       ├─→ Si isFrecuent → EMITIR alerta FREQ-002
       └─→ Registrar en audit_logs
```

### 6.4 Inmutabilidad del Audit Log

Todos los eventos del módulo se registran con los siguientes campos no modificables:

```sql
audit_logs: {
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenantId    UUID NOT NULL,
  eventType   VARCHAR(120) NOT NULL,
  actorId     UUID,
  actorName   VARCHAR(255),
  entityType  VARCHAR(60),
  entityId    UUID,
  payload     JSONB,
  ipAddress   INET,
  userAgent   TEXT,
  createdAt   TIMESTAMPTZ DEFAULT NOW() NOT NULL
  -- Sin columna updatedAt — registro append-only
}
```

Política: `REVOKE UPDATE, DELETE ON audit_logs FROM application_role;`

---

## Eje 7 — Escalabilidad y Abstracción de Filtros

### 7.1 Arquitectura de Filtros Dinámicos (Filter DSL)

Los filtros del módulo se implementan mediante un **DSL JSON** que el frontend envía como query params serializados. El backend los interpreta sin necesidad de cambios en el esquema.

```typescript
// Definición de un filtro dinámico
interface DynamicFilter {
  field: string;           // Campo a filtrar (ej: 'visitorType', 'company', 'hostId')
  operator: 'eq' | 'in' | 'gte' | 'lte' | 'contains' | 'between';
  value: any;              // Valor o array de valores
  source?: 'visitor' | 'visit' | 'credential';  // Entidad origen
}

// Ejemplo de query con filtros dinámicos
GET /api/v1/visitors/frequent
  ?filters=[
    {"field":"visitorType","operator":"in","value":["CONTRACTOR","SUPPLIER"]},
    {"field":"company","operator":"contains","value":"Acme"},
    {"field":"lastVisitDate","operator":"gte","value":"2025-01-01"}
  ]
  &minVisits=5
  &windowDays=90
  &orderBy=visitCount
  &orderDir=DESC
  &limit=50
  &offset=0
```

### 7.2 Motor de Interpretación de Filtros

```typescript
class DynamicFilterBuilder {
  apply(qb: SelectQueryBuilder<Visitor>, filters: DynamicFilter[]): SelectQueryBuilder<Visitor> {
    for (const filter of filters) {
      const param = `fp_${filter.field}_${Math.random().toString(36).slice(2)}`;
      switch (filter.operator) {
        case 'eq':       qb.andWhere(`v.${filter.field} = :${param}`, { [param]: filter.value }); break;
        case 'in':       qb.andWhere(`v.${filter.field} IN (:...${param})`, { [param]: filter.value }); break;
        case 'contains': qb.andWhere(`v.${filter.field} ILIKE :${param}`, { [param]: `%${filter.value}%` }); break;
        case 'gte':      qb.andWhere(`v.${filter.field} >= :${param}`, { [param]: filter.value }); break;
        case 'lte':      qb.andWhere(`v.${filter.field} <= :${param}`, { [param]: filter.value }); break;
      }
    }
    return qb;
  }
}
```

**Ventaja:** Añadir un nuevo filtro (ej: `areaVisitada`, `departamentoAnfitrion`, `nivelCriticidad`) requiere únicamente:
1. Asegurarse de que el campo existe en la entidad (o en una relación ya joinada).
2. El frontend envía el nuevo campo en el array `filters`.
3. **No se requiere refactorización del backend ni cambios de esquema**.

### 7.3 Escalabilidad de Base de Datos

- **Particionamiento**: La tabla `visits` se particiona por `tenant_id` usando `PARTITION BY HASH (tenant_id)` para soportar múltiples organizaciones en instalación compartida.
- **Índice compuesto**: `CREATE INDEX CONCURRENTLY idx_visits_freq ON visits(visitor_id, tenant_id, scheduled_at DESC) WHERE status IN ('CHECKED_IN','CHECKED_OUT')`.
- **Vista Materializada**: `mv_frequent_visitors` se refresca cada 15 minutos con `REFRESH MATERIALIZED VIEW CONCURRENTLY`, sin bloquear lecturas.

---

## Eje 8 — Marco de Cumplimiento Normativo y Gobernanza

### 8.1 Legislaciones Aplicables

| Regulación | Jurisdicción | Artículos Clave | Requerimiento en este módulo |
|---|---|---|---|
| GDPR | Unión Europea | Art. 5, 13, 17, 25, 30, 37 | Minimización de datos, Privacy by Design, registro de actividades, DPO |
| Ley 1581 de 2012 | Colombia | Art. 4, 7, 12, 17 | Consentimiento informado, habeas data, medidas de seguridad |
| LGPD (Lei 13.709/2018) | Brasil | Art. 6, 18, 46, 50 | Base legal de tratamiento, anonimización, DPIA |
| ISO 27001:2022 | Internacional | A.8, A.9, A.12 | Control de acceso, criptografía, gestión de activos |

### 8.2 Política de Retención de Datos

```
Ciclo de vida del dato personal en el módulo Visitantes Frecuentes:

[Registro] ──(activo 2 años)──→ [Archivo] ──(12 meses adicionales)──→ [Purga automática]
     │                               │                                        │
     │                          datos PII                               eliminación
     │                         enmascarados                             irreversible
     │                                                                  AES-256 wipe
     ▼
Consentimiento digital firmado con:
  - Timestamp UTC
  - IP de origen
  - Hash SHA-256 del texto de política mostrado
  - Versión de política (semver)
```

| Categoría de Dato | Retención Activa | Retención Archivo | Método de Purga |
|---|---|---|---|
| Datos de visita (fecha, propósito, anfitrión) | 2 años | 1 año adicional | `DELETE + VACUUM` |
| PII (nombre, documento, email) | 2 años | Enmascarados en archivo | Sobreescritura + `DELETE` |
| Fotos / datos biométricos | Duración del contrato | No archivados | Eliminación inmediata de disco |
| Logs de auditoría | 5 años | 2 años adicionales | Solo exportación, sin eliminación en caliente |
| Alertas de anomalías | 1 año | No archivadas | `DELETE` automático |

### 8.3 Consentimiento Informado Digital

El consentimiento se captura en el flujo de registro de visitante con los siguientes elementos:

```typescript
interface DigitalConsent {
  visitorId: string;
  consentVersion: string;         // ej: "v2.1.0"
  policyHash: string;             // SHA-256 del texto mostrado
  acceptedAt: Date;               // UTC timestamp
  ipAddress: string;              // IP del terminal de recepción
  collectionPurposes: string[];   // ['access_control', 'security', 'frequent_tracking']
  retentionPeriodDays: number;    // 730 (2 años)
  dataCategories: string[];       // ['identification', 'biometric_photo', 'visit_history']
  thirdPartySharing: boolean;     // false por defecto
  rightToErasure: boolean;        // true — GDPR Art. 17
}
```

### 8.4 Cifrado

| Capa | Algoritmo | Implementación |
|---|---|---|
| Datos en reposo — credenciales BioStar | AES-256-GCM | `EncryptionService` (ya implementado) |
| Datos en reposo — fotos biométricas | Cifrado de filesystem (dm-crypt/LUKS en servidor on-premise) | Responsabilidad del operador |
| Datos en tránsito — API | TLS 1.3 mínimo | Nginx reverse proxy con `ssl_protocols TLSv1.3` |
| Datos en tránsito — WebSocket | WSS (TLS 1.3) | Socket.IO sobre HTTPS |
| Tokens JWT | HS256 / RS256 | `JWT_SECRET` con longitud mínima 256 bits |
| QR de acceso | JWT + HMAC-SHA256 | `QR_JWT_SECRET` con TTL configurable |
| Backup de base de datos | AES-256-CBC | Responsabilidad del operador de infraestructura |

### 8.5 Registro de Actividades de Tratamiento (GDPR Art. 30)

El módulo mantiene automáticamente el registro requerido en `audit_logs`:

```
Actividad: "Consulta de Visitantes Frecuentes"
Responsable: {actorId, actorName, role}
Base legal: Interés legítimo / Seguridad de instalaciones
Categorías de datos: Identificación, datos de comportamiento de acceso
Destinatarios: Administradores del tenant, DPO
Transferencias internacionales: Ninguna (on-premise)
Plazos de supresión: 2 años desde último acceso
Medidas de seguridad: AES-256, TLS 1.3, RBAC, audit log inmutable
```

---

## Resumen de Implementación Técnica

| Componente | Archivo | Estado |
|---|---|---|
| Endpoint `GET /api/v1/visitors/frequent` | `visitors.controller.ts` | ✅ Implementado |
| Método `getFrequentVisitors()` | `visitors.service.ts` | ✅ Implementado |
| Tab UI "Visitantes Frecuentes" (extremo derecho) | `visitors/page.tsx` | ✅ Implementado |
| Panel de tarjetas con RBAC visual | `visitors/page.tsx` | ✅ Implementado |
| Configuración de umbral por tenant | `frequent:config:{tenantId}` Redis | 🔄 Fase 2 |
| Motor de alertas de anomalías (Cron) | `frequent-alerts.service.ts` | 🔄 Fase 2 |
| Vista materializada PostgreSQL | Migración SQL | 🔄 Fase 2 |
| Enmascaramiento de PII por rol | `visitors.service.ts` | 🔄 Fase 2 |
| Exportación CSV/PDF con marca de agua | `visitors.controller.ts` | 🔄 Fase 2 |

---

*Documento generado para BioVisitor X. Clasificación: INTERNO — No distribuir externamente.*
*Próxima revisión: 180 días desde publicación o ante cambio normativo significativo.*
