-- ============================================================
--  BioVisitor X — Schema DDL
--  Generado para: PostgreSQL 14+
--  Empresa: Suprema LATAM
--  Versión: 1.0.0
--
--  Ejecutar como superuser o con el usuario biovisitor_admin:
--    psql -U postgres -d biovisitor_db -f schema.sql
-- ============================================================

-- Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid(), bcrypt
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements"; -- (opcional, monitoreo)

-- ─── Tipos ENUM ────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE biostar_platform_enum AS ENUM ('BIOSTAR_2','BIOSTAR_X');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE user_role_enum AS ENUM ('ADMIN','OPERATOR','HOST');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE document_type_enum AS ENUM (
    'NATIONAL_ID','PASSPORT','FOREIGN_ID','DRIVERS_LICENSE','OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE access_method_enum AS ENUM (
    'FACE','FINGERPRINT','RFID','QR_DYNAMIC','MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE visit_status_enum AS ENUM (
    'SCHEDULED','PRE_REGISTERED','CHECKED_IN','CHECKED_OUT',
    'CANCELLED','NO_SHOW','FALSE_EXIT_REPORTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE connection_test_status_enum AS ENUM (
    'NEVER_TESTED','SUCCESS','FAILED','PENDING');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE asset_category_enum AS ENUM (
    'LAPTOP','TABLET','PHONE','CAMERA','TOOL','USB_DRIVE','OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE credential_type_enum AS ENUM (
    'QR_JWT','RFID','SMART_CARD','MOBILE_CARD',
    'FACE_TEMPLATE_REF','FINGERPRINT_REF','VISUAL_FACE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE credential_sync_status_enum AS ENUM (
    'SYNCED','PENDING','FAILED','NOT_APPLICABLE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE host_source_enum AS ENUM ('LOCAL','BIOSTAR2','BIOSTAR_X');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE equipment_category_enum AS ENUM (
    'LAPTOP','TABLET','PHONE','CAMERA','STORAGE','TOOL','BIOMETRIC','OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE equipment_status_enum AS ENUM (
    'PENDING_AUTH','AUTHORIZED','INSIDE','EXITED','REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE visitor_document_type_enum AS ENUM (
    'PHOTO','PASSPORT_SCAN','ID_SCAN','SIGNATURE','OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE vehicle_type_enum AS ENUM (
    'CAR','MOTORCYCLE','TRUCK','BICYCLE','OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 1. tenants ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenants (
  id                            UUID        NOT NULL DEFAULT gen_random_uuid(),
  name                          VARCHAR(255) NOT NULL,
  code                          VARCHAR(100) NOT NULL,
  "biostarPlatform"             biostar_platform_enum NOT NULL,
  "biostarApiUrl"               VARCHAR(500) NOT NULL,
  "biostarCredentialsEncrypted" TEXT         NOT NULL,
  "biostarCaCertPath"           VARCHAR(500),
  "brandingConfig"              JSONB        NOT NULL DEFAULT '{}',
  timezone                      VARCHAR(100) NOT NULL DEFAULT 'America/Bogota',
  "defaultLanguage"             VARCHAR(5)   NOT NULL DEFAULT 'es',
  "isActive"                    BOOLEAN      NOT NULL DEFAULT TRUE,
  "maxConcurrentVisitors"       INT          NOT NULL DEFAULT 500,
  "createdAt"                   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "updatedAt"                   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT "PK_tenants" PRIMARY KEY (id),
  CONSTRAINT "UQ_tenants_code" UNIQUE (code)
);

-- ─── 2. users ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id                    UUID         NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"            UUID         NOT NULL,
  email                 VARCHAR(255) NOT NULL,
  "passwordHash"        VARCHAR(255) NOT NULL,
  "fullName"            VARCHAR(255) NOT NULL,
  role                  user_role_enum NOT NULL DEFAULT 'OPERATOR',
  department            VARCHAR(255),
  phone                 VARCHAR(50),
  notes                 TEXT,
  language              VARCHAR(5)   NOT NULL DEFAULT 'es',
  "isActive"            BOOLEAN      NOT NULL DEFAULT TRUE,
  permissions           JSONB,
  "allowedSites"        JSONB                 DEFAULT '[]',
  "securityConfig"      JSONB,
  "mustChangePassword"  BOOLEAN      NOT NULL DEFAULT FALSE,
  "passwordChangedAt"   TIMESTAMPTZ,
  "lastLoginAt"         TIMESTAMPTZ,
  "failedLoginAttempts" INT          NOT NULL DEFAULT 0,
  "lockedUntil"         TIMESTAMPTZ,
  "createdAt"           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT "PK_users" PRIMARY KEY (id),
  CONSTRAINT "FK_users_tenant" FOREIGN KEY ("tenantId") REFERENCES tenants(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_users_tenant_email"
  ON users ("tenantId", email);

-- ─── 3. visitors ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS visitors (
  id               UUID          NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"       UUID          NOT NULL,
  "documentType"   document_type_enum NOT NULL DEFAULT 'NATIONAL_ID',
  "documentNumber" VARCHAR(50)   NOT NULL,
  "firstName"      VARCHAR(255)  NOT NULL,
  "lastName"       VARCHAR(255)  NOT NULL,
  email            VARCHAR(255),
  phone            VARCHAR(50),
  company          VARCHAR(255),
  position         VARCHAR(255),
  nationality      VARCHAR(5),
  "dateOfBirth"    DATE,
  "photoPath"      VARCHAR(500),
  "ocrData"        JSONB,
  "isActive"       BOOLEAN       NOT NULL DEFAULT TRUE,
  "createdAt"      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "updatedAt"      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT "PK_visitors" PRIMARY KEY (id),
  CONSTRAINT "FK_visitors_tenant" FOREIGN KEY ("tenantId") REFERENCES tenants(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_visitors_tenant_doc"
  ON visitors ("tenantId", "documentNumber");

-- ─── 4. hosts ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hosts (
  id                    UUID         NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"            UUID         NOT NULL,
  "fullName"            VARCHAR(255) NOT NULL,
  email                 VARCHAR(255),
  phone                 VARCHAR(50),
  department            VARCHAR(255),
  "jobTitle"            VARCHAR(255),
  source                host_source_enum NOT NULL DEFAULT 'LOCAL',
  "isActive"            BOOLEAN      NOT NULL DEFAULT TRUE,
  "supremaUserId"       VARCHAR(255),
  "supremaLoginId"      VARCHAR(255),
  "supremaConnectionId" UUID,
  "syncStatus"          VARCHAR(50),
  "lastSyncAt"          TIMESTAMPTZ,
  "lastSyncError"       TEXT,
  "userId"              UUID,
  "createdAt"           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT "PK_hosts" PRIMARY KEY (id),
  CONSTRAINT "FK_hosts_tenant" FOREIGN KEY ("tenantId") REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS "IDX_hosts_tenant_email"    ON hosts ("tenantId", email);
CREATE INDEX IF NOT EXISTS "IDX_hosts_tenant_suprema"  ON hosts ("tenantId", "supremaUserId");
CREATE INDEX IF NOT EXISTS "IDX_hosts_tenant_active"   ON hosts ("tenantId", "isActive");

-- ─── 5. visits ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS visits (
  id                          UUID           NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"                  UUID           NOT NULL,
  "visitorId"                 UUID           NOT NULL,
  "hostUserId"                UUID,
  "hostId"                    UUID,
  purpose                     VARCHAR(500),
  department                  VARCHAR(255),
  "scheduledAt"               TIMESTAMPTZ    NOT NULL,
  "expectedEndAt"             TIMESTAMPTZ,
  "checkedInAt"               TIMESTAMPTZ,
  "checkedOutAt"              TIMESTAMPTZ,
  "accessMethod"              access_method_enum NOT NULL DEFAULT 'MANUAL',
  status                      visit_status_enum  NOT NULL DEFAULT 'SCHEDULED',
  "supremaUserRefId"          VARCHAR(255),
  "syncStatus"                VARCHAR(50),
  "lastSyncError"             TEXT,
  "lastSyncAttemptAt"         TIMESTAMPTZ,
  "checkedInByUserId"         UUID,
  "expectedCheckoutAt"        TIMESTAMPTZ,
  "maxStayMinutes"            INT,
  "autoCheckoutEnabled"       BOOLEAN        NOT NULL DEFAULT FALSE,
  "hasAssets"                 BOOLEAN        NOT NULL DEFAULT FALSE,
  "hasVehicles"               BOOLEAN        NOT NULL DEFAULT FALSE,
  notes                       TEXT,
  "serviceOrder"              VARCHAR(100),
  "visitorType"               VARCHAR(50)    NOT NULL DEFAULT 'WALK_IN',
  "badgeNumber"               VARCHAR(100),
  "accessGroups"              JSONB,
  "portalToken"               VARCHAR(36)    UNIQUE,
  "onboardingToken"           VARCHAR(36)    UNIQUE,
  "invitedEmail"              VARCHAR(255),
  "surveyRating"              INT,
  "surveyComment"             TEXT,
  "surveyRespondedAt"         TIMESTAMPTZ,
  "falseExitReportedAt"       TIMESTAMPTZ,
  "falseExitResolvedAt"       TIMESTAMPTZ,
  "falseExitResolvedByUserId" UUID,
  "falseExitResolutionNote"   TEXT,
  "temporaryReenableUntil"    TIMESTAMPTZ,
  "wasTemporaryReenabled"     BOOLEAN        NOT NULL DEFAULT FALSE,
  "createdAt"                 TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  "updatedAt"                 TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  CONSTRAINT "PK_visits" PRIMARY KEY (id),
  CONSTRAINT "FK_visits_tenant"   FOREIGN KEY ("tenantId")  REFERENCES tenants(id),
  CONSTRAINT "FK_visits_visitor"  FOREIGN KEY ("visitorId") REFERENCES visitors(id),
  CONSTRAINT "FK_visits_host_user" FOREIGN KEY ("hostUserId") REFERENCES users(id),
  CONSTRAINT "FK_visits_host"     FOREIGN KEY ("hostId")    REFERENCES hosts(id),
  CONSTRAINT "FK_visits_checkin_by" FOREIGN KEY ("checkedInByUserId") REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS "IDX_visits_tenant_status_scheduled"
  ON visits ("tenantId", status, "scheduledAt");
CREATE INDEX IF NOT EXISTS "IDX_visits_tenant_checkedin"
  ON visits ("tenantId", "checkedInAt");

-- ─── 6. audit_logs ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_logs (
  id              UUID         NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"      UUID,
  "userId"        VARCHAR(255) NOT NULL,
  "userName"      VARCHAR(255),
  category        VARCHAR(50)  NOT NULL,
  action          VARCHAR(255) NOT NULL,
  "entityType"    VARCHAR(100),
  "entityId"      VARCHAR(255),
  details         JSONB,
  "ipAddress"     VARCHAR(45),
  "userAgent"     VARCHAR(500),
  "correlationId" VARCHAR(100),
  "createdAt"     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT "PK_audit_logs" PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS "IDX_audit_tenant_created" ON audit_logs ("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "IDX_audit_user_created"   ON audit_logs ("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "IDX_audit_action"         ON audit_logs (action);

-- ─── 7. suprema_api_connections ───────────────────────────

CREATE TABLE IF NOT EXISTS suprema_api_connections (
  id                   UUID          NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"           UUID,
  name                 VARCHAR(255)  NOT NULL,
  description          TEXT,
  platform             biostar_platform_enum NOT NULL,
  "apiUrl"             VARCHAR(500)  NOT NULL,
  "loginIdEncrypted"   TEXT          NOT NULL,
  "passwordEncrypted"  TEXT          NOT NULL,
  "caCertPath"         VARCHAR(500),
  "isActive"           BOOLEAN       NOT NULL DEFAULT TRUE,
  "lastTestedAt"       TIMESTAMPTZ,
  "lastTestStatus"     connection_test_status_enum NOT NULL DEFAULT 'NEVER_TESTED',
  "lastTestMessage"    TEXT,
  "serverMetadata"     JSONB,
  "createdAt"          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "updatedAt"          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT "PK_suprema_api_connections" PRIMARY KEY (id),
  CONSTRAINT "FK_suprema_connections_tenant"
    FOREIGN KEY ("tenantId") REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_suprema_conn_tenant_name"
  ON suprema_api_connections ("tenantId", name)
  WHERE "tenantId" IS NOT NULL;

-- ─── 8. pre_registrations ──────────────────────────────────

CREATE TABLE IF NOT EXISTS pre_registrations (
  id              UUID        NOT NULL DEFAULT gen_random_uuid(),
  "visitId"       UUID        NOT NULL,
  token           UUID        NOT NULL,
  "formCompleted" BOOLEAN     NOT NULL DEFAULT FALSE,
  "photoUploaded" BOOLEAN     NOT NULL DEFAULT FALSE,
  "expiresAt"     TIMESTAMPTZ NOT NULL,
  "formData"      JSONB,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "PK_pre_registrations" PRIMARY KEY (id),
  CONSTRAINT "FK_prereg_visit" FOREIGN KEY ("visitId") REFERENCES visits(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_prereg_token" ON pre_registrations (token);

-- ─── 9. visitor_assets ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS visitor_assets (
  id                   UUID          NOT NULL DEFAULT gen_random_uuid(),
  "visitId"            UUID          NOT NULL,
  "visitorId"          UUID          NOT NULL,
  "tenantId"           UUID          NOT NULL,
  description          VARCHAR(500)  NOT NULL,
  "serialNumber"       VARCHAR(255),
  category             asset_category_enum NOT NULL DEFAULT 'OTHER',
  "verifiedAtCheckout" BOOLEAN       NOT NULL DEFAULT FALSE,
  "createdAt"          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT "PK_visitor_assets" PRIMARY KEY (id),
  CONSTRAINT "FK_assets_visit"   FOREIGN KEY ("visitId")   REFERENCES visits(id)   ON DELETE CASCADE,
  CONSTRAINT "FK_assets_visitor" FOREIGN KEY ("visitorId") REFERENCES visitors(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "IDX_assets_visit"  ON visitor_assets ("visitId");
CREATE INDEX IF NOT EXISTS "IDX_assets_tenant" ON visitor_assets ("tenantId");

-- ─── 10. access_credentials ────────────────────────────────

CREATE TABLE IF NOT EXISTS access_credentials (
  id                    UUID         NOT NULL DEFAULT gen_random_uuid(),
  "visitId"             UUID         NOT NULL,
  type                  credential_type_enum NOT NULL,
  "tokenHash"           VARCHAR(255),
  "cardNumber"          VARCHAR(255),
  "cardSubtype"         VARCHAR(20),
  "supremaCardId"       VARCHAR(255),
  "encryptedData"       TEXT,
  "supremaTemplateCount" SMALLINT    NOT NULL DEFAULT 0,
  "syncStatus"          VARCHAR(30),
  "lastSyncError"       TEXT,
  "lastSyncAttemptAt"   TIMESTAMPTZ,
  "expiresAt"           TIMESTAMPTZ,
  "usedAt"              TIMESTAMPTZ,
  "isRevoked"           BOOLEAN      NOT NULL DEFAULT FALSE,
  "revokeReason"        VARCHAR(500),
  "createdAt"           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT "PK_access_credentials" PRIMARY KEY (id),
  CONSTRAINT "FK_credentials_visit" FOREIGN KEY ("visitId") REFERENCES visits(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_credentials_token_hash"
  ON access_credentials ("tokenHash")
  WHERE "tokenHash" IS NOT NULL;

-- ─── 11. blacklist ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS blacklist (
  id                UUID        NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"        UUID        NOT NULL,
  "visitorId"       UUID        NOT NULL,
  reason            TEXT        NOT NULL,
  "blockedByUserId" UUID        NOT NULL,
  "blockedAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "expiresAt"       TIMESTAMPTZ,
  "isActive"        BOOLEAN     NOT NULL DEFAULT TRUE,
  CONSTRAINT "PK_blacklist" PRIMARY KEY (id),
  CONSTRAINT "FK_blacklist_tenant"  FOREIGN KEY ("tenantId")  REFERENCES tenants(id),
  CONSTRAINT "FK_blacklist_visitor" FOREIGN KEY ("visitorId") REFERENCES visitors(id),
  CONSTRAINT "FK_blacklist_user"    FOREIGN KEY ("blockedByUserId") REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_blacklist_tenant_visitor"
  ON blacklist ("tenantId", "visitorId");

-- ─── 12. equipment_entries ─────────────────────────────────

CREATE TABLE IF NOT EXISTS equipment_entries (
  id                  UUID           NOT NULL DEFAULT gen_random_uuid(),
  "serialNumber"      VARCHAR(100)   NOT NULL,
  brand               VARCHAR(80)    NOT NULL,
  model               VARCHAR(120)   NOT NULL,
  category            equipment_category_enum NOT NULL DEFAULT 'OTHER',
  "responsibleName"   VARCHAR(200)   NOT NULL,
  "visitId"           UUID,
  "hostArea"          VARCHAR(200)   NOT NULL,
  "entryAt"           TIMESTAMPTZ    NOT NULL,
  "exitAt"            TIMESTAMPTZ,
  status              equipment_status_enum NOT NULL DEFAULT 'INSIDE',
  "authorizationCode" VARCHAR(80),
  "authorizedById"    VARCHAR(255),
  "authorizedAt"      TIMESTAMPTZ,
  "rejectedReason"    VARCHAR(500),
  "photoPath"         VARCHAR(500),
  notes               TEXT,
  "maxStayHours"      INT            NOT NULL DEFAULT 8,
  "overtimeAlertSent" BOOLEAN        NOT NULL DEFAULT FALSE,
  "tenantId"          UUID           NOT NULL,
  "createdById"       VARCHAR(255)   NOT NULL,
  "createdByName"     VARCHAR(255),
  "createdAt"         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  "updatedAt"         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  CONSTRAINT "PK_equipment_entries" PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS "IDX_equipment_tenant_status"  ON equipment_entries ("tenantId", status);
CREATE INDEX IF NOT EXISTS "IDX_equipment_tenant_entry"   ON equipment_entries ("tenantId", "entryAt");
CREATE INDEX IF NOT EXISTS "IDX_equipment_serial_tenant"  ON equipment_entries ("serialNumber", "tenantId");

-- ─── 13. visitor_documents ─────────────────────────────────

CREATE TABLE IF NOT EXISTS visitor_documents (
  id                  UUID        NOT NULL DEFAULT gen_random_uuid(),
  "visitorId"         UUID        NOT NULL,
  "documentType"      visitor_document_type_enum NOT NULL,
  "filePathEncrypted" TEXT        NOT NULL,
  "ocrDataJson"       JSONB,
  "fileSizeBytes"     INT,
  "mimeType"          VARCHAR(100),
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "PK_visitor_documents" PRIMARY KEY (id),
  CONSTRAINT "FK_documents_visitor" FOREIGN KEY ("visitorId") REFERENCES visitors(id)
);

-- ─── 14. visitor_vehicles ──────────────────────────────────

CREATE TABLE IF NOT EXISTS visitor_vehicles (
  id                   UUID         NOT NULL DEFAULT gen_random_uuid(),
  "visitId"            UUID         NOT NULL,
  "visitorId"          UUID         NOT NULL,
  "tenantId"           UUID         NOT NULL,
  "licensePlate"       VARCHAR(20)  NOT NULL,
  brand                VARCHAR(100),
  model                VARCHAR(100),
  color                VARCHAR(50),
  "vehicleType"        vehicle_type_enum NOT NULL DEFAULT 'CAR',
  "parkingZone"        VARCHAR(100),
  "hasEntered"         BOOLEAN      NOT NULL DEFAULT FALSE,
  "verifiedAtCheckout" BOOLEAN      NOT NULL DEFAULT FALSE,
  "createdAt"          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "updatedAt"          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT "PK_visitor_vehicles" PRIMARY KEY (id),
  CONSTRAINT "FK_vehicles_visit"   FOREIGN KEY ("visitId")   REFERENCES visits(id)   ON DELETE CASCADE,
  CONSTRAINT "FK_vehicles_visitor" FOREIGN KEY ("visitorId") REFERENCES visitors(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "IDX_vehicles_visit"   ON visitor_vehicles ("visitId");
CREATE INDEX IF NOT EXISTS "IDX_vehicles_tenant"  ON visitor_vehicles ("tenantId");
CREATE INDEX IF NOT EXISTS "IDX_vehicles_plate"   ON visitor_vehicles ("licensePlate", "tenantId");

-- ─── Fin del schema ─────────────────────────────────────────
SELECT 'Schema BioVisitor X creado correctamente — ' || NOW() AS status;
